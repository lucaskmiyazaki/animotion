const MechanismOptimization = (() => {
	const DEFAULT_LENGTH_TOLERANCE = 1e-2;
	const DEFAULT_BINARY_ITERATIONS = 24;
	const DEFAULT_SWEEP_PASSES = 2;
	const DEFAULT_SAMPLES_PER_JOINT = 17;

	function getChainB(mechanism) {
		if (!(mechanism instanceof Mechanism) || !Array.isArray(mechanism.chains)) return null;
		return mechanism.chains[1] instanceof Chain ? mechanism.chains[1] : null;
	}

	function getChainBLength(mechanism) {
		const chainB = getChainB(mechanism);
		if (!(chainB instanceof Chain) || typeof chainB.getHoleLineLength !== 'function') return 0;
		const length = Number(chainB.getHoleLineLength());
		return Number.isFinite(length) ? length : 0;
	}

	function capturePoseState(mechanism) {
		if (!(mechanism instanceof Mechanism)) return null;

		const chainStates = Array.isArray(mechanism.chains)
			? mechanism.chains.map((chain) => {
				if (!(chain instanceof Chain) || !Array.isArray(chain.links)) {
					return { links: [] };
				}

				return {
					links: chain.links.map((link) => {
						if (!(link instanceof Link)) {
							return null;
						}
						return {
							position: {
								x: Number(link.position?.x) || 0,
								y: Number(link.position?.y) || 0
							},
							theta: Number(link.theta) || 0
						};
					})
				};
			})
			: [];

		const jointStates = Array.isArray(mechanism.joints)
			? mechanism.joints.map((joint) => {
				if (!(joint instanceof Joint)) return null;
				const pivot = joint.pivotPoint;
				return {
					theta: Number(joint.theta) || 0,
					pivotPoint: pivot && Number.isFinite(pivot.x) && Number.isFinite(pivot.y)
						? { x: Number(pivot.x), y: Number(pivot.y) }
						: null
				};
			})
			: [];

		return {
			chainStates,
			jointStates
		};
	}

	function restorePoseState(mechanism, state) {
		if (!(mechanism instanceof Mechanism) || !state) return false;

		if (Array.isArray(state.chainStates) && Array.isArray(mechanism.chains)) {
			for (let i = 0; i < mechanism.chains.length; i++) {
				const chain = mechanism.chains[i];
				const chainState = state.chainStates[i];
				if (!(chain instanceof Chain) || !chainState || !Array.isArray(chain.links)) continue;

				for (let j = 0; j < chain.links.length; j++) {
					const link = chain.links[j];
					const linkState = chainState.links?.[j];
					if (!(link instanceof Link) || !linkState) continue;
					if (!link.position) {
						link.position = { x: 0, y: 0 };
					}
					link.position.x = Number.isFinite(linkState.position?.x) ? Number(linkState.position.x) : link.position.x;
					link.position.y = Number.isFinite(linkState.position?.y) ? Number(linkState.position.y) : link.position.y;
					if (Number.isFinite(linkState.theta)) {
						link.theta = Number(linkState.theta);
					}
				}
			}
		}

		if (Array.isArray(state.jointStates) && Array.isArray(mechanism.joints)) {
			for (let i = 0; i < mechanism.joints.length; i++) {
				const joint = mechanism.joints[i];
				const jointState = state.jointStates[i];
				if (!(joint instanceof Joint) || !jointState) continue;

				if (jointState.pivotPoint && Number.isFinite(jointState.pivotPoint.x) && Number.isFinite(jointState.pivotPoint.y)) {
					joint.pivotPoint = {
						x: Number(jointState.pivotPoint.x),
						y: Number(jointState.pivotPoint.y)
					};
				}

				if (Number.isFinite(jointState.theta)) {
					joint.theta = Number(jointState.theta);
				}
			}
		}

		return true;
	}

	function getJointThetaVector(mechanism) {
		if (!(mechanism instanceof Mechanism) || !Array.isArray(mechanism.joints)) return [];
		return mechanism.joints.map((joint) => {
			if (!(joint instanceof Joint)) return 0;
			return Number.isFinite(joint.theta) ? Number(joint.theta) : 0;
		});
	}

	function applyJointThetaVector(mechanism, thetaVector, baseState = null) {
		if (!(mechanism instanceof Mechanism) || !Array.isArray(mechanism.joints)) return [];
		if (baseState) {
			restorePoseState(mechanism, baseState);
		}

		const thetas = Array.isArray(thetaVector) ? thetaVector : [];
		mechanism.joints.forEach((joint, index) => {
			if (!(joint instanceof Joint)) return;
			const theta = Number(thetas[index]);
			if (!Number.isFinite(theta)) return;
			joint.setTheta(theta);
		});

		return getJointThetaVector(mechanism);
	}

	function objectiveForTargetHoleLength(mechanism, targetLength, options = {}) {
		if (!(mechanism instanceof Mechanism)) return Number.POSITIVE_INFINITY;
		const target = Number(targetLength);
		const penaltyWeight = Number.isFinite(options.penaltyWeight) ? options.penaltyWeight : 1;
		const length = getChainBLength(mechanism);
		const energy = Number(mechanism.calculateTotalElasticEnergy?.()) || 0;

		if (!Number.isFinite(target)) return energy;
		const error = length - target;
		return energy + penaltyWeight * error * error;
	}

	function isBetterForHardConstraint(candidate, currentBest, tolerance = DEFAULT_LENGTH_TOLERANCE) {
		if (!candidate) return false;
		if (!currentBest) return true;

		const candErr = Math.abs(Number(candidate.lengthError));
		const bestErr = Math.abs(Number(currentBest.lengthError));
		const candEnergy = Number(candidate.totalEnergy);
		const bestEnergy = Number(currentBest.totalEnergy);

		const candErrFinite = Number.isFinite(candErr);
		const bestErrFinite = Number.isFinite(bestErr);

		if (!candErrFinite) return false;
		if (!bestErrFinite) return true;

		if (candErr <= tolerance && bestErr > tolerance) return true;
		if (bestErr <= tolerance && candErr > tolerance) return false;

		if (Math.abs(candErr - bestErr) > 1e-12) {
			return candErr < bestErr;
		}

		if (Number.isFinite(candEnergy) && Number.isFinite(bestEnergy)) {
			return candEnergy < bestEnergy;
		}

		return false;
	}

	function buildJointCandidates(joint, preferredTheta, sampleCount) {
		const minTheta = Math.min(joint.initialTheta, joint.finalTheta);
		const maxTheta = Math.max(joint.initialTheta, joint.finalTheta);

		if (!Number.isFinite(minTheta) || !Number.isFinite(maxTheta)) {
			return [Number(joint.theta) || 0];
		}

		if (Math.abs(maxTheta - minTheta) < 1e-12) {
			return [minTheta];
		}

		const count = Math.max(3, Number.isFinite(sampleCount) ? Math.floor(sampleCount) : DEFAULT_SAMPLES_PER_JOINT);
		const set = new Set();

		for (let i = 0; i < count; i++) {
			const t = i / (count - 1);
			set.add(minTheta + (maxTheta - minTheta) * t);
		}

		const currentTheta = Number(joint.theta);
		if (Number.isFinite(currentTheta)) set.add(currentTheta);
		if (Number.isFinite(preferredTheta)) {
			const clamped = Math.min(maxTheta, Math.max(minTheta, preferredTheta));
			set.add(clamped);
		}

		return Array.from(set).sort((a, b) => a - b);
	}

	function optimizeJointsForLambda(mechanism, lambda, options = {}) {
		const sampleCount = Math.max(3, Number.isFinite(options.samplesPerJoint)
			? Math.floor(options.samplesPerJoint)
			: DEFAULT_SAMPLES_PER_JOINT);
		const sweepPasses = Math.max(1, Number.isFinite(options.sweepPasses)
			? Math.floor(options.sweepPasses)
			: DEFAULT_SWEEP_PASSES);
		const preferredThetas = Array.isArray(options.preferredThetas) ? options.preferredThetas : [];

		for (let pass = 0; pass < sweepPasses; pass++) {
			for (let jointIndex = 0; jointIndex < mechanism.joints.length; jointIndex++) {
				const joint = mechanism.joints[jointIndex];
				if (!(joint instanceof Joint)) continue;

				const baselineLength = getChainBLength(mechanism);
				const baselineTheta = Number.isFinite(joint.theta) ? Number(joint.theta) : 0;

				let bestTheta = baselineTheta;
				let bestScore = Number.POSITIVE_INFINITY;

				const candidates = buildJointCandidates(
					joint,
					Number(preferredThetas[jointIndex]),
					sampleCount
				);

				for (let i = 0; i < candidates.length; i++) {
					const candidateTheta = candidates[i];
					joint.setTheta(candidateTheta);

					const length = getChainBLength(mechanism);
					const contribution = length - baselineLength;
					const jointEnergy = Number(joint.getElasticEnergy?.()) || 0;
					const score = jointEnergy - lambda * contribution;

					if (score < bestScore) {
						bestScore = score;
						bestTheta = Number.isFinite(joint.theta) ? Number(joint.theta) : candidateTheta;
					}
				}

				joint.setTheta(bestTheta);
			}
		}

		const thetaVector = getJointThetaVector(mechanism);
		const resultingLength = getChainBLength(mechanism);
		const totalEnergy = Number(mechanism.calculateTotalElasticEnergy?.()) || 0;

		return {
			lambda,
			thetaVector,
			resultingLength,
			totalEnergy
		};
	}

	function evaluateAtLambda(mechanism, baseState, lambda, targetLength, options = {}) {
		restorePoseState(mechanism, baseState);

		const seedThetas = Array.isArray(options.seedThetas) ? options.seedThetas : null;
		if (seedThetas) {
			applyJointThetaVector(mechanism, seedThetas);
		}

		const optimized = optimizeJointsForLambda(mechanism, lambda, {
			samplesPerJoint: options.samplesPerJoint,
			sweepPasses: options.sweepPasses,
			preferredThetas: seedThetas || options.preferredThetas
		});

		const lengthError = optimized.resultingLength - targetLength;
		return {
			...optimized,
			targetLength,
			lengthError,
			absLengthError: Math.abs(lengthError)
		};
	}

	function solveThetasForLength(mechanism, targetLength, options = {}) {
		return findMinimumEnergyPoseForHoleLength(mechanism, targetLength, options);
	}

	function findMinimumEnergyPoseForHoleLength(mechanism, targetLength, options = {}) {
		if (!(mechanism instanceof Mechanism)) {
			return {
				result: {
					converged: false,
					feasible: false,
					reason: 'invalid-mechanism',
					thetaVector: [],
					resultingLength: 0,
					totalEnergy: 0,
					lengthError: Number.POSITIVE_INFINITY
				}
			};
		}

		const target = Number(targetLength);
		if (!Number.isFinite(target)) {
			return {
				result: {
					converged: false,
					feasible: false,
					reason: 'invalid-target-length',
					thetaVector: getJointThetaVector(mechanism),
					resultingLength: getChainBLength(mechanism),
					totalEnergy: Number(mechanism.calculateTotalElasticEnergy?.()) || 0,
					lengthError: Number.POSITIVE_INFINITY
				}
			};
		}

		const lengthTolerance = Number.isFinite(options.lengthTolerance)
			? Math.max(0, Number(options.lengthTolerance))
			: DEFAULT_LENGTH_TOLERANCE;
		const maxBinaryIterations = Number.isFinite(options.maxBinaryIterations)
			? Math.max(4, Math.floor(options.maxBinaryIterations))
			: DEFAULT_BINARY_ITERATIONS;
		const maxBracketExpansions = Number.isFinite(options.maxBracketExpansions)
			? Math.max(2, Math.floor(options.maxBracketExpansions))
			: 14;
		const lambdaStep = Number.isFinite(options.initialLambdaStep)
			? Math.max(1e-8, Math.abs(options.initialLambdaStep))
			: 1;

		const baseState = capturePoseState(mechanism);
		const currentTheta = getJointThetaVector(mechanism);

		const warmStart = mechanism._lagrangeWarmStart && typeof mechanism._lagrangeWarmStart === 'object'
			? mechanism._lagrangeWarmStart
			: null;
		const warmLambda = Number.isFinite(options.initialLambda)
			? Number(options.initialLambda)
			: (Number.isFinite(warmStart?.lambda) ? Number(warmStart.lambda) : 0);
		const warmThetaVector = Array.isArray(options.warmStartThetaVector)
			? options.warmStartThetaVector.slice()
			: (Array.isArray(warmStart?.thetaVector) ? warmStart.thetaVector.slice() : currentTheta.slice());

		let lambdaLow = warmLambda - lambdaStep;
		let lambdaHigh = warmLambda + lambdaStep;
		let step = lambdaStep;

		let lowEval = evaluateAtLambda(mechanism, baseState, lambdaLow, target, {
			seedThetas: warmThetaVector,
			samplesPerJoint: options.samplesPerJoint,
			sweepPasses: options.sweepPasses
		});
		let highEval = evaluateAtLambda(mechanism, baseState, lambdaHigh, target, {
			seedThetas: lowEval.thetaVector,
			samplesPerJoint: options.samplesPerJoint,
			sweepPasses: options.sweepPasses
		});

		let best = isBetterForHardConstraint(lowEval, null, lengthTolerance) ? lowEval : highEval;
		if (isBetterForHardConstraint(highEval, best, lengthTolerance)) {
			best = highEval;
		}

		let monotonicDirection = Math.sign(highEval.resultingLength - lowEval.resultingLength);

		let expansion = 0;
		while (expansion < maxBracketExpansions) {
			if (Math.abs(monotonicDirection) < 1e-12) {
				step *= 2;
				lambdaLow -= step;
				lambdaHigh += step;
				lowEval = evaluateAtLambda(mechanism, baseState, lambdaLow, target, {
					seedThetas: lowEval.thetaVector,
					samplesPerJoint: options.samplesPerJoint,
					sweepPasses: options.sweepPasses
				});
				highEval = evaluateAtLambda(mechanism, baseState, lambdaHigh, target, {
					seedThetas: highEval.thetaVector,
					samplesPerJoint: options.samplesPerJoint,
					sweepPasses: options.sweepPasses
				});
				monotonicDirection = Math.sign(highEval.resultingLength - lowEval.resultingLength);
			}

			if (isBetterForHardConstraint(lowEval, best, lengthTolerance)) best = lowEval;
			if (isBetterForHardConstraint(highEval, best, lengthTolerance)) best = highEval;

			const lowErr = lowEval.resultingLength - target;
			const highErr = highEval.resultingLength - target;

			if (lowErr === 0 || highErr === 0 || lowErr * highErr <= 0) {
				break;
			}

			const shouldIncreaseLambda = (monotonicDirection >= 0 && highErr < 0)
				|| (monotonicDirection < 0 && highErr > 0);

			step *= 2;
			if (shouldIncreaseLambda) {
				lambdaLow = lambdaHigh;
				lowEval = highEval;
				lambdaHigh += step;
				highEval = evaluateAtLambda(mechanism, baseState, lambdaHigh, target, {
					seedThetas: lowEval.thetaVector,
					samplesPerJoint: options.samplesPerJoint,
					sweepPasses: options.sweepPasses
				});
			} else {
				lambdaHigh = lambdaLow;
				highEval = lowEval;
				lambdaLow -= step;
				lowEval = evaluateAtLambda(mechanism, baseState, lambdaLow, target, {
					seedThetas: highEval.thetaVector,
					samplesPerJoint: options.samplesPerJoint,
					sweepPasses: options.sweepPasses
				});
			}

			monotonicDirection = Math.sign(highEval.resultingLength - lowEval.resultingLength);
			expansion += 1;
		}

		let binaryIterations = 0;
		while (binaryIterations < maxBinaryIterations) {
			if (Math.abs(best.lengthError) <= lengthTolerance) {
				break;
			}

			const midLambda = 0.5 * (lambdaLow + lambdaHigh);
			const midEval = evaluateAtLambda(mechanism, baseState, midLambda, target, {
				seedThetas: best.thetaVector,
				samplesPerJoint: options.samplesPerJoint,
				sweepPasses: options.sweepPasses
			});

			if (isBetterForHardConstraint(midEval, best, lengthTolerance)) {
				best = midEval;
			}

			const lengthSlopeDirection = Math.sign(highEval.resultingLength - lowEval.resultingLength) || monotonicDirection || 1;
			const tooShort = midEval.resultingLength < target;

			if ((lengthSlopeDirection > 0 && tooShort) || (lengthSlopeDirection < 0 && !tooShort)) {
				lambdaLow = midLambda;
				lowEval = midEval;
			} else {
				lambdaHigh = midLambda;
				highEval = midEval;
			}

			binaryIterations += 1;
		}

		restorePoseState(mechanism, baseState);
		applyJointThetaVector(mechanism, best.thetaVector);

		mechanism._lagrangeWarmStart = {
			lambda: Number(best.lambda),
			thetaVector: best.thetaVector.slice(),
			targetLength: target
		};

		const boundsMin = Math.min(lowEval.resultingLength, highEval.resultingLength);
		const boundsMax = Math.max(lowEval.resultingLength, highEval.resultingLength);

		const result = {
			thetaVector: best.thetaVector.slice(),
			resultingLength: Number(best.resultingLength),
			totalEnergy: Number(best.totalEnergy),
			lengthError: Number(best.lengthError),
			converged: Math.abs(best.lengthError) <= lengthTolerance,
			feasible: target >= boundsMin - lengthTolerance && target <= boundsMax + lengthTolerance,
			lambda: Number(best.lambda),
			binaryIterations,
			lengthTolerance,
			lengthBounds: {
				min: Number(boundsMin),
				max: Number(boundsMax)
			}
		};

		return { result };
	}

	return {
		capturePoseState,
		restorePoseState,
		getJointThetaVector,
		applyJointThetaVector,
		objectiveForTargetHoleLength,
		isBetterForHardConstraint,
		solveThetasForLength,
		findMinimumEnergyPoseForHoleLength
	};
})();

window.MechanismOptimization = MechanismOptimization;
