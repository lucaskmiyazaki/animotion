(function attachMechanismOptimization(globalScope) {
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
            const ChainCtor = globalScope.Chain;
            const LinkCtor = globalScope.Link;
            const JointCtor = globalScope.Joint;

            if (!state || !Array.isArray(state.chains) || !Array.isArray(state.jointThetas)) return;

            (mechanism.chains || []).forEach((chain, chainIndex) => {
                const chainState = state.chains[chainIndex];
                if (!ChainCtor || !(chain instanceof ChainCtor) || !Array.isArray(chain.links) || !Array.isArray(chainState)) return;

                chain.links.forEach((link, linkIndex) => {
                    const linkState = chainState[linkIndex];
                    if (!LinkCtor || !(link instanceof LinkCtor) || !linkState) return;
                    if (Number.isFinite(linkState.x)) link.position.x = linkState.x;
                    if (Number.isFinite(linkState.y)) link.position.y = linkState.y;
                    if (Number.isFinite(linkState.theta)) link.theta = linkState.theta;
                });
            });

            (mechanism.joints || []).forEach((joint, jointIndex) => {
                const theta = state.jointThetas[jointIndex];
                if (JointCtor && joint instanceof JointCtor && Number.isFinite(theta) && typeof joint._clampTheta === 'function') {
                    joint.theta = joint._clampTheta(theta);
                }
            });
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
                const theta = thetaVector[i];
                if (!Number.isFinite(theta)) continue;
                mechanism.setJointThetaByIndex(i, theta);
            }
        },

        objectiveForTargetHoleLength(mechanism, targetLength, options = {}) {
            const ChainCtor = globalScope.Chain;
            const chainIndex = Number.isInteger(options.chainIndex) ? options.chainIndex : 1;
            const holeWeight = Number.isFinite(options.holeLengthWeight) ? Math.max(0, options.holeLengthWeight) : 1;
            const targetChain = ChainCtor && mechanism.chains?.[chainIndex] instanceof ChainCtor
                ? mechanism.chains[chainIndex]
                : null;

            const currentLength = targetChain ? targetChain.getHoleLineLength() : 0;
            const lengthError = Number.isFinite(targetLength) ? (currentLength - targetLength) : 0;
            const elastic = mechanism.calculateTotalElasticEnergy();
            return {
                score: elastic + holeWeight * lengthError * lengthError,
                elastic,
                currentLength,
                lengthError
            };
        },

        isBetterForHardConstraint(candidate, currentBest, tolerance) {
            if (!candidate) return false;
            if (!currentBest) return true;

            const candError = Math.abs(candidate.lengthError);
            const bestError = Math.abs(currentBest.lengthError);
            const candFeasible = candError <= tolerance;
            const bestFeasible = bestError <= tolerance;

            if (candFeasible && !bestFeasible) return true;
            if (!candFeasible && bestFeasible) return false;

            if (candFeasible && bestFeasible) {
                if (candidate.elastic + 1e-12 < currentBest.elastic) return true;
                if (Math.abs(candidate.elastic - currentBest.elastic) <= 1e-12 && candError + 1e-12 < bestError) return true;
                return false;
            }

            if (candError + 1e-12 < bestError) return true;
            if (Math.abs(candError - bestError) <= 1e-12 && candidate.elastic + 1e-12 < currentBest.elastic) return true;
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

            if (!Number.isFinite(targetLength) || !Array.isArray(mechanism.joints) || mechanism.joints.length === 0) {
                return {
                    converged: false,
                    iterations: 0,
                    reason: 'invalid-input-or-empty-joints',
                    targetLength,
                    finalLength: ChainCtor && mechanism.chains?.[1] instanceof ChainCtor ? mechanism.chains[1].getHoleLineLength() : 0,
                    finalEnergy: mechanism.calculateTotalElasticEnergy(),
                    thetaVector: this.getJointThetaVector(mechanism)
                };
            }

            const maxSteps = Number.isInteger(options.maxIterations) ? Math.max(1, options.maxIterations) : 600;
            const tolerance = Number.isFinite(options.lengthTolerance) ? Math.max(0, options.lengthTolerance) : 0.25;
            const minIncrement = Number.isFinite(options.minIncrement)
                ? Math.max(1e-6, options.minIncrement)
                : (Number.isFinite(options.minStep) ? Math.max(1e-6, options.minStep) : 1e-4);
            const maxIncrement = Number.isFinite(options.maxIncrement) ? Math.max(minIncrement, options.maxIncrement) : 0.05;
            const incrementRatio = Number.isFinite(options.incrementRatio) ? Math.max(1e-5, options.incrementRatio) : 0.02;
            const chainIndex = Number.isInteger(options.chainIndex) ? options.chainIndex : 1;
            const holeWeight = Number.isFinite(options.holeLengthWeight) ? Math.max(0, options.holeLengthWeight) : 5;
            const startFromInitial = options.startFromInitial !== undefined ? Boolean(options.startFromInitial) : true;
            const strictDirection = options.strictDirection !== undefined ? Boolean(options.strictDirection) : true;
            const warmStartThetaVector = Array.isArray(options.warmStartThetaVector)
                ? options.warmStartThetaVector
                : null;
            const hardConstraint = Boolean(options.hardConstraint);
            const improvementEpsilon = 1e-9;

            const baseState = this.capturePoseState(mechanism);
            const currentTheta = this.getJointThetaVector(mechanism);
            const jointBounds = (mechanism.joints || []).map((joint) => {
                if (!JointCtor || !(joint instanceof JointCtor)) {
                    return { min: 0, max: 0.05, span: 0.05 };
                }
                const minTheta = Math.min(joint.initialTheta, joint.finalTheta);
                const maxTheta = Math.max(joint.initialTheta, joint.finalTheta);
                return {
                    min: minTheta,
                    max: maxTheta,
                    span: Math.max(1e-6, maxTheta - minTheta)
                };
            });

            const initialTheta = (mechanism.joints || []).map((joint, index) => {
                if (!JointCtor || !(joint instanceof JointCtor)) return currentTheta[index] || 0;
                return Number.isFinite(joint.initialTheta) ? joint.initialTheta : currentTheta[index] || 0;
            });

            const clampThetaVector = (thetaVec) => {
                const safe = Array.isArray(thetaVec) ? thetaVec.slice() : [];
                return jointBounds.map((bound, index) => {
                    const raw = Number.isFinite(safe[index]) ? safe[index] : initialTheta[index] || bound.min;
                    return Math.min(bound.max, Math.max(bound.min, raw));
                });
            };

            let workingTheta = clampThetaVector(currentTheta.slice());
            if (startFromInitial) {
                workingTheta = clampThetaVector(initialTheta.slice());
            }
            if (warmStartThetaVector && warmStartThetaVector.length > 0) {
                workingTheta = workingTheta.map((value, index) => {
                    const warmValue = warmStartThetaVector[index];
                    return Number.isFinite(warmValue) ? warmValue : value;
                });
                workingTheta = clampThetaVector(workingTheta);
            }

            const evaluateTheta = (thetaVec) => {
                this.applyJointThetaVector(mechanism, thetaVec, baseState);
                return this.objectiveForTargetHoleLength(mechanism, targetLength, {
                    chainIndex,
                    holeLengthWeight: holeWeight
                });
            };
            let bestTheta = clampThetaVector(workingTheta.slice());
            let best = evaluateTheta(bestTheta);
            let iterations = 0;
            let stalled = false;

            for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
                const currentAbsError = Math.abs(best.lengthError);
                if (currentAbsError <= tolerance) break;

                let bestCandidate = null;

                for (let i = 0; i < (mechanism.joints || []).length; i++) {
                    const joint = mechanism.joints[i];
                    const bound = jointBounds[i];
                    const baseTheta = bestTheta[i];
                    const jointDirection = JointCtor && joint instanceof JointCtor
                        ? Math.sign(joint.finalTheta - joint.initialTheta)
                        : 0;

                    const directions = [];
                    if (jointDirection !== 0) {
                        directions.push(jointDirection);
                    } else if (!strictDirection) {
                        directions.push(1, -1);
                    }

                    if (directions.length === 0) continue;

                    const baseIncrement = Math.min(maxIncrement, Math.max(minIncrement, bound.span * incrementRatio));
                    const trialScales = [1, 0.5, 0.25];

                    for (let d = 0; d < directions.length; d++) {
                        const dir = directions[d];
                        for (let s = 0; s < trialScales.length; s++) {
                            const delta = dir * baseIncrement * trialScales[s];
                            const candidateTheta = Math.min(bound.max, Math.max(bound.min, baseTheta + delta));
                            if (!Number.isFinite(candidateTheta) || Math.abs(candidateTheta - baseTheta) < 1e-12) continue;

                            const trialTheta = bestTheta.slice();
                            trialTheta[i] = candidateTheta;
                            const clampedTrialTheta = clampThetaVector(trialTheta);
                            const trialEval = evaluateTheta(clampedTrialTheta);
                            const trialAbsError = Math.abs(trialEval.lengthError);
                            const lengthImprovement = currentAbsError - trialAbsError;
                            const crossesTarget = best.lengthError * trialEval.lengthError <= 0;

                            if (lengthImprovement <= improvementEpsilon && !crossesTarget && trialAbsError > tolerance) {
                                continue;
                            }

                            const energyIncrease = trialEval.elastic - best.elastic;
                            const candidate = {
                                theta: clampedTrialTheta,
                                eval: trialEval,
                                lengthImprovement,
                                energyIncrease,
                                absError: trialAbsError
                            };

                            if (!bestCandidate) {
                                bestCandidate = candidate;
                                continue;
                            }

                            const betterLength = candidate.lengthImprovement > bestCandidate.lengthImprovement + 1e-12;
                            const sameLength = Math.abs(candidate.lengthImprovement - bestCandidate.lengthImprovement) <= 1e-12;
                            const betterEnergy = candidate.energyIncrease < bestCandidate.energyIncrease - 1e-12;
                            const sameEnergy = Math.abs(candidate.energyIncrease - bestCandidate.energyIncrease) <= 1e-12;
                            const lowerAbsError = candidate.absError < bestCandidate.absError - 1e-12;
                            const lowerElastic = candidate.eval.elastic < bestCandidate.eval.elastic - 1e-12;

                            if (betterLength
                                || (sameLength && betterEnergy)
                                || (sameLength && sameEnergy && lowerAbsError)
                                || (sameLength && sameEnergy && !lowerAbsError && lowerElastic)) {
                                bestCandidate = candidate;
                            }
                        }
                    }
                }

                if (!bestCandidate) {
                    stalled = true;
                    break;
                }

                bestTheta = clampThetaVector(bestCandidate.theta);
                best = bestCandidate.eval;
                iterations = stepIndex + 1;
            }

            bestTheta = clampThetaVector(bestTheta);
            this.applyJointThetaVector(mechanism, bestTheta, baseState);
            const final = evaluateTheta(bestTheta);
            const converged = Math.abs(final.lengthError) <= tolerance;

            return {
                converged,
                iterations,
                targetLength,
                finalLength: final.currentLength,
                finalEnergy: final.elastic,
                lengthError: final.lengthError,
                thetaVector: bestTheta.slice(),
                feasible: Math.abs(final.lengthError) <= tolerance,
                hardConstraint,
                stalled,
                method: 'greedy-forward-increment'
            };
        }
    };

    globalScope.MechanismOptimization = MechanismOptimization;
})(window);
