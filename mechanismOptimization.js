(function attachMechanismOptimization(globalScope) {
	const EPS = 1e-12;

	const MechanismOptimization = {
		capturePoseState(mechanism) {
			const ChainCtor = globalScope.Chain;
			return {
				chains: (mechanism.chains || []).map((chain) => {
					if (!ChainCtor || !(chain instanceof ChainCtor) || !Array.isArray(chain.links)) return [];
					return chain.links.map((link) => ({
						x: link.position.x,
						y: link.position.y,
						theta: link.theta
					}));
				}),
				jointThetas: (mechanism.joints || []).map((joint) => joint.theta)
			};
		},

		restorePoseState(mechanism, state) {
			const JointCtor = globalScope.Joint;

			if (!state || !Array.isArray(state.jointThetas)) return;

			const count = Math.min((mechanism.joints || []).length, state.jointThetas.length);
			for (let i = 0; i < count; i++) {
				const joint = mechanism.joints[i];
				const theta = state.jointThetas[i];
				if (!JointCtor || !(joint instanceof JointCtor) || !Number.isFinite(theta)) continue;
				mechanism.setJointThetaByIndex(i, theta);
			}
		},

		getJointThetaVector(mechanism) {
			const JointCtor = globalScope.Joint;
			return (mechanism.joints || []).map((joint) => {
				if (!JointCtor || !(joint instanceof JointCtor)) return 0;
				return Number.isFinite(joint.theta) ? joint.theta : 0;
			});
		},

		applyJointThetaVector(mechanism, thetaVector, baseState) {
			if (!Array.isArray(thetaVector)) return;
			if (baseState) {
				this.restorePoseState(mechanism, baseState);
			}

			const count = Math.min((mechanism.joints || []).length, thetaVector.length);
			for (let i = 0; i < count; i++) {
				if (!Number.isFinite(thetaVector[i])) continue;
				mechanism.setJointThetaByIndex(i, thetaVector[i]);
			}
		},

		objectiveForTargetHoleLength(mechanism, targetLength, options = {}) {
			const ChainCtor = globalScope.Chain;
			const chainIndex = Number.isInteger(options.chainIndex) ? options.chainIndex : 1;
			const targetChain = ChainCtor && mechanism.chains?.[chainIndex] instanceof ChainCtor
				? mechanism.chains[chainIndex]
				: null;

			const currentLength = targetChain ? targetChain.getHoleLineLength() : 0;
			const lengthError = Number.isFinite(targetLength) ? (currentLength - targetLength) : 0;
			const elastic = mechanism.calculateTotalElasticEnergy();
			const score = Math.abs(lengthError) + 1e-6 * elastic;
			return {
				score,
				elastic,
				currentLength,
				lengthError
			};
		},

		isBetterForHardConstraint(candidate, currentBest, tolerance) {
			if (!candidate) return false;
			if (!currentBest) return true;

			const candErr = Math.abs(candidate.lengthError);
			const bestErr = Math.abs(currentBest.lengthError);
			if (candErr + EPS < bestErr) return true;
			if (Math.abs(candErr - bestErr) <= EPS && candidate.elastic + EPS < currentBest.elastic) return true;
			return false;
		},

		solveThetasForLength(mechanism, targetLength, options = {}) {
			const result = this.findMinimumEnergyPoseForHoleLength(mechanism, targetLength, options);
			return {
				thetas: Array.isArray(result?.thetaVector) ? result.thetaVector.slice() : [],
				result
			};
		},

		findMinimumEnergyPoseForHoleLength(mechanism, targetLength, options = {}) {
			const ChainCtor = globalScope.Chain;
			const JointCtor = globalScope.Joint;
			const debugFrameIndex = Number.isInteger(options.debugFrameIndex) ? options.debugFrameIndex : null;

			if (!Number.isFinite(targetLength) || !Array.isArray(mechanism.joints) || mechanism.joints.length === 0) {
				console.warn('[Optimization] Invalid input or empty joints', {
					frameIndex: debugFrameIndex,
					targetLength
				});
				return {
					converged: false,
					iterations: 0,
					reason: 'invalid-input-or-empty-joints',
					targetLength,
					finalLength: ChainCtor && mechanism.chains?.[1] instanceof ChainCtor ? mechanism.chains[1].getHoleLineLength() : 0,
					finalEnergy: mechanism.calculateTotalElasticEnergy(),
					lengthError: 0,
					thetaVector: this.getJointThetaVector(mechanism),
					feasible: true,
					hardConstraint: false,
					method: 'incremental-greedy-local-refine'
				};
			}

			const chainIndex = Number.isInteger(options.chainIndex) ? options.chainIndex : 1;
			const maxIterations = Number.isInteger(options.maxIterations) ? Math.max(20, options.maxIterations) : 1500;
			const warmStartThetaVector = Array.isArray(options.warmStartThetaVector) ? options.warmStartThetaVector : null;
			const startFromInitial = options.startFromInitial !== undefined ? Boolean(options.startFromInitial) : true;
			const enforceMonotonic = options.enforceMonotonic !== undefined ? Boolean(options.enforceMonotonic) : true;
			const minStep = Number.isFinite(options.minIncrement) ? Math.max(1e-6, options.minIncrement) : 1e-4;
			const maxStep = Number.isFinite(options.maxIncrement) ? Math.max(minStep, options.maxIncrement) : 0.05;
			const initialStepRatio = Number.isFinite(options.initialStepRatio) ? Math.max(0.005, options.initialStepRatio) : 0.08;
			const crossOvershootRatio = Number.isFinite(options.crossOvershootRatio) ? Math.max(1e-5, options.crossOvershootRatio) : 0.002;

			const targetTolerance = Math.max(1e-6, Math.abs(targetLength) * 0.001);
			const closeThreshold = Math.max(targetTolerance * 10, Math.abs(targetLength) * 0.02);
			const targetAbs = Math.max(Math.abs(targetLength), 1e-9);

			const baseState = this.capturePoseState(mechanism);
			const currentTheta = this.getJointThetaVector(mechanism);
			const bounds = (mechanism.joints || []).map((joint, index) => {
				if (!JointCtor || !(joint instanceof JointCtor)) {
					return {
						min: currentTheta[index] || 0,
						max: currentTheta[index] || 0,
						span: 1e-6,
						direction: 0,
						initial: currentTheta[index] || 0,
						final: currentTheta[index] || 0
					};
				}
				const initial = Number.isFinite(joint.initialTheta) ? joint.initialTheta : (currentTheta[index] || 0);
				const final = Number.isFinite(joint.finalTheta) ? joint.finalTheta : initial;
				const min = Math.min(initial, final);
				const max = Math.max(initial, final);
				return {
					min,
					max,
					span: Math.max(1e-6, max - min),
					direction: Math.sign(final - initial),
					initial,
					final
				};
			});

			const clampThetaVector = (thetaVec) => bounds.map((bound, i) => {
				const raw = Array.isArray(thetaVec) && Number.isFinite(thetaVec[i]) ? thetaVec[i] : bound.initial;
				return Math.min(bound.max, Math.max(bound.min, raw));
			});

			let theta = startFromInitial
				? bounds.map((b) => b.initial)
				: currentTheta.slice();

			if (warmStartThetaVector) {
				theta = theta.map((value, i) => (Number.isFinite(warmStartThetaVector[i]) ? warmStartThetaVector[i] : value));
			}
			theta = clampThetaVector(theta);
			const monotonicAnchorTheta = theta.slice();

			const normalizeThetaVector = (thetaVec) => {
				let normalized = clampThetaVector(thetaVec);
				if (enforceMonotonic) {
					normalized = normalized.map((value, i) => {
						const direction = bounds[i].direction;
						const anchor = monotonicAnchorTheta[i];
						if (direction > 0) return Math.max(value, anchor);
						if (direction < 0) return Math.min(value, anchor);
						return value;
					});
				}
				return normalized;
			};

			const evaluateTheta = (thetaVec) => {
				const normalized = normalizeThetaVector(thetaVec);
				this.applyJointThetaVector(mechanism, normalized, baseState);
				return this.objectiveForTargetHoleLength(mechanism, targetLength, { chainIndex });
			};

			let currentEval = evaluateTheta(theta);
			let iterations = 0;
			let stepScale = 1;
			let stalled = false;
			let greedyStopReason = 'max-iterations';
			let refinementStopReason = 'not-started';
			const rejectionCounts = {
				zeroDirection: 0,
				atBoundary: 0,
				stepTooSmall: 0,
				outOfBounds: 0,
				wrongDirection: 0,
				overCrossLimit: 0,
				noValidCandidate: 0
			};

			// Phase 1: incremental greedy walk.
			for (let iter = 0; iter < maxIterations; iter++) {
				iterations = iter + 1;
				const currentError = currentEval.lengthError;
				const absError = Math.abs(currentError);
				if (absError <= targetTolerance) {
					greedyStopReason = 'target-tolerance-reached';
					break;
				}

				if (absError < closeThreshold) {
					stepScale = Math.max(0.05, stepScale * 0.7);
				}

				const wantedLengthDirection = Math.sign(targetLength - currentEval.currentLength);
				let bestCandidate = null;
				let crossedTooMuch = false;

				for (let i = 0; i < bounds.length; i++) {
					const bound = bounds[i];
					if (bound.direction === 0) {
						rejectionCounts.zeroDirection += 1;
						continue;
					}

					const atBoundary = bound.direction > 0
						? theta[i] >= bound.max - EPS
						: theta[i] <= bound.min + EPS;
					if (atBoundary) {
						rejectionCounts.atBoundary += 1;
						continue;
					}

					let localStep = Math.min(maxStep, Math.max(minStep, bound.span * initialStepRatio * stepScale));
					localStep = Math.min(localStep, bound.direction > 0 ? (bound.max - theta[i]) : (theta[i] - bound.min));
					if (!Number.isFinite(localStep) || localStep < minStep) {
						rejectionCounts.stepTooSmall += 1;
						continue;
					}

					const trialTheta = theta.slice();
					trialTheta[i] = theta[i] + bound.direction * localStep;

					if (trialTheta[i] < bound.min - EPS || trialTheta[i] > bound.max + EPS) {
						rejectionCounts.outOfBounds += 1;
						continue;
					}

					const normalizedTrialTheta = normalizeThetaVector(trialTheta);
					const trialEval = evaluateTheta(normalizedTrialTheta);
					const deltaLength = trialEval.currentLength - currentEval.currentLength;

					// Reject candidates moving string length in the wrong direction.
					if (wantedLengthDirection > 0 && deltaLength <= EPS) {
						rejectionCounts.wrongDirection += 1;
						continue;
					}
					if (wantedLengthDirection < 0 && deltaLength >= -EPS) {
						rejectionCounts.wrongDirection += 1;
						continue;
					}

					const crossed = Math.sign(currentEval.lengthError) !== 0
						&& Math.sign(trialEval.lengthError) !== 0
						&& Math.sign(currentEval.lengthError) !== Math.sign(trialEval.lengthError);

					// Reject large overshoot when crossing target.
					const overshootLimit = Math.max(targetTolerance * 2, targetAbs * crossOvershootRatio);
					if (crossed && Math.abs(trialEval.lengthError) > overshootLimit) {
						crossedTooMuch = true;
						rejectionCounts.overCrossLimit += 1;
						continue;
					}

					const candidate = {
						theta: normalizedTrialTheta,
						eval: trialEval
					};

					if (!bestCandidate) {
						bestCandidate = candidate;
						continue;
					}

					const trialAbsErr = Math.abs(candidate.eval.lengthError);
					const bestAbsErr = Math.abs(bestCandidate.eval.lengthError);
					if (trialAbsErr + EPS < bestAbsErr) {
						bestCandidate = candidate;
					} else if (Math.abs(trialAbsErr - bestAbsErr) <= EPS && candidate.eval.elastic + EPS < bestCandidate.eval.elastic) {
						bestCandidate = candidate;
					}
				}

				if (!bestCandidate) {
					rejectionCounts.noValidCandidate += 1;
					stepScale *= 0.5;
					if (stepScale < 0.02) {
						stalled = true;
						greedyStopReason = 'no-valid-candidate-min-step';
						break;
					}
					continue;
				}

				const wasCrossing = Math.sign(currentEval.lengthError) !== 0
					&& Math.sign(bestCandidate.eval.lengthError) !== 0
					&& Math.sign(currentEval.lengthError) !== Math.sign(bestCandidate.eval.lengthError);

				theta = bestCandidate.theta;
				currentEval = bestCandidate.eval;

				if (crossedTooMuch || wasCrossing) {
					stepScale = Math.max(0.05, stepScale * 0.5);
				}
			}

			// Phase 2: local refinement around current solution.
			let refineStep = Math.min(maxStep, Math.max(minStep, Math.max(...bounds.map((b) => b.span)) * 0.03));
			let refinementIterations = 0;
			refinementStopReason = 'min-refine-step-or-max-iters';
			while (refineStep >= minStep && refinementIterations < maxIterations) {
				refinementIterations += 1;
				const base = currentEval;
				let improved = false;

				for (let i = 0; i < bounds.length; i++) {
					const bound = bounds[i];
					if (bound.direction === 0) continue;
					const forwardCandidate = theta[i] + bound.direction * refineStep;
					const candidates = [Math.min(bound.max, Math.max(bound.min, forwardCandidate))];

					for (let c = 0; c < candidates.length; c++) {
						const candidateTheta = candidates[c];
						if (Math.abs(candidateTheta - theta[i]) <= EPS) continue;

						const trialTheta = theta.slice();
						trialTheta[i] = candidateTheta;
						const normalizedTrialTheta = normalizeThetaVector(trialTheta);
						const trialEval = evaluateTheta(normalizedTrialTheta);

						const better = this.isBetterForHardConstraint(trialEval, currentEval, targetTolerance);
						if (better) {
							theta = normalizedTrialTheta;
							currentEval = trialEval;
							improved = true;
						}
					}
				}

				if (!improved) {
					refineStep *= 0.5;
				}

				if (Math.abs(currentEval.lengthError) <= targetTolerance && Math.abs(base.lengthError - currentEval.lengthError) <= EPS) {
					refinementStopReason = 'refine-converged-or-flat';
					break;
				}
			}

			theta = normalizeThetaVector(theta);
			this.applyJointThetaVector(mechanism, theta, baseState);
			const finalEval = evaluateTheta(theta);
			const finalError = Math.abs(finalEval.lengthError);
			const converged = finalError <= targetTolerance;

			console.log('[Optimization] joint theta range', {
				frameIndex: debugFrameIndex,
				joints: bounds.map((bound, i) => ({
					jointIndex: i,
					minTheta: bound.min,
					maxTheta: bound.max,
					currentTheta: theta[i]
				}))
			});

			return {
				converged,
				iterations: iterations + refinementIterations,
				targetLength,
				finalLength: finalEval.currentLength,
				finalEnergy: finalEval.elastic,
				lengthError: finalEval.lengthError,
				thetaVector: theta.slice(),
				feasible: true,
				hardConstraint: false,
				tolerance: targetTolerance,
				stalled,
				method: 'incremental-greedy-local-refine'
			};
		}
	};

	globalScope.MechanismOptimization = MechanismOptimization;
})(window);
