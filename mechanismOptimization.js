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

            const maxIterations = Number.isInteger(options.maxIterations) ? Math.max(1, options.maxIterations) : 40;
            const tolerance = Number.isFinite(options.lengthTolerance) ? Math.max(0, options.lengthTolerance) : 0.5;
            const minStep = Number.isFinite(options.minStep) ? Math.max(1e-6, options.minStep) : 1e-3;
            const stepDecay = Number.isFinite(options.stepDecay) ? Math.min(0.99, Math.max(0.2, options.stepDecay)) : 0.6;
            const chainIndex = Number.isInteger(options.chainIndex) ? options.chainIndex : 1;
            const holeWeight = Number.isFinite(options.holeLengthWeight) ? Math.max(0, options.holeLengthWeight) : 5;
            const hardConstraint = Boolean(options.hardConstraint);
            const restartCount = Number.isInteger(options.restartCount) ? Math.max(1, options.restartCount) : 24;

            const baseState = this.capturePoseState(mechanism);
            const initialTheta = this.getJointThetaVector(mechanism);
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

            const makeStepSizes = () => jointBounds.map((bound) => Math.max(minStep * 2, bound.span * 0.3));
            const evaluateTheta = (thetaVec) => {
                this.applyJointThetaVector(mechanism, thetaVec, baseState);
                return this.objectiveForTargetHoleLength(mechanism, targetLength, {
                    chainIndex,
                    holeLengthWeight: holeWeight
                });
            };
            const isLengthBetter = (candidate, best) => {
                if (!best) return true;
                const candErr = Math.abs(candidate.lengthError);
                const bestErr = Math.abs(best.lengthError);
                if (candErr + 1e-12 < bestErr) return true;
                if (Math.abs(candErr - bestErr) <= 1e-12 && candidate.elastic + 1e-12 < best.elastic) return true;
                return false;
            };

            const refineByLength = (seedTheta) => {
                let theta = seedTheta.slice();
                let steps = makeStepSizes();
                let bestLocal = evaluateTheta(theta);
                let usedIterations = 0;

                for (let iter = 0; iter < maxIterations; iter++) {
                    usedIterations = iter + 1;
                    let anyImprovement = false;

                    for (let i = 0; i < mechanism.joints.length; i++) {
                        const bound = jointBounds[i];
                        const baseTheta = theta[i];
                        const step = steps[i];
                        if (!Number.isFinite(step) || step < minStep) continue;

                        const randOffset = (Math.random() * 2 - 1) * step;
                        const randomCandidate = Math.min(bound.max, Math.max(bound.min, baseTheta + randOffset));
                        const candidates = [
                            Math.min(bound.max, Math.max(bound.min, baseTheta + step)),
                            Math.min(bound.max, Math.max(bound.min, baseTheta - step)),
                            randomCandidate,
                            bound.min,
                            bound.max
                        ];

                        let bestThetaForJoint = baseTheta;
                        let bestEvalForJoint = bestLocal;

                        for (let c = 0; c < candidates.length; c++) {
                            const candidateTheta = candidates[c];
                            if (!Number.isFinite(candidateTheta) || Math.abs(candidateTheta - baseTheta) < 1e-12) continue;

                            const trialTheta = theta.slice();
                            trialTheta[i] = candidateTheta;
                            const trial = evaluateTheta(trialTheta);

                            if (isLengthBetter(trial, bestEvalForJoint)) {
                                bestEvalForJoint = trial;
                                bestThetaForJoint = candidateTheta;
                            }
                        }

                        if (Math.abs(bestThetaForJoint - baseTheta) > 1e-12) {
                            theta[i] = bestThetaForJoint;
                            bestLocal = bestEvalForJoint;
                            anyImprovement = true;
                        } else {
                            steps[i] = Math.max(minStep, steps[i] * stepDecay);
                        }
                    }

                    if (Math.abs(bestLocal.lengthError) <= tolerance) {
                        break;
                    }
                    if (!anyImprovement && steps.every((step) => step <= minStep + 1e-12)) {
                        break;
                    }
                }

                return {
                    theta,
                    eval: bestLocal,
                    iterations: usedIterations
                };
            };

            const refineEnergyWithinFeasible = (seedTheta) => {
                let theta = seedTheta.slice();
                let steps = makeStepSizes();
                let bestLocal = evaluateTheta(theta);
                let usedIterations = 0;

                for (let iter = 0; iter < maxIterations; iter++) {
                    usedIterations = iter + 1;
                    let anyImprovement = false;

                    for (let i = 0; i < mechanism.joints.length; i++) {
                        const bound = jointBounds[i];
                        const baseTheta = theta[i];
                        const step = steps[i];
                        if (!Number.isFinite(step) || step < minStep) continue;

                        const candidates = [
                            Math.min(bound.max, Math.max(bound.min, baseTheta + step)),
                            Math.min(bound.max, Math.max(bound.min, baseTheta - step)),
                            bound.min,
                            bound.max
                        ];

                        let bestThetaForJoint = baseTheta;
                        let bestEvalForJoint = bestLocal;

                        for (let c = 0; c < candidates.length; c++) {
                            const candidateTheta = candidates[c];
                            if (!Number.isFinite(candidateTheta) || Math.abs(candidateTheta - baseTheta) < 1e-12) continue;

                            const trialTheta = theta.slice();
                            trialTheta[i] = candidateTheta;
                            const trial = evaluateTheta(trialTheta);
                            if (Math.abs(trial.lengthError) > tolerance) continue;

                            if (trial.elastic + 1e-12 < bestEvalForJoint.elastic) {
                                bestEvalForJoint = trial;
                                bestThetaForJoint = candidateTheta;
                            }
                        }

                        if (Math.abs(bestThetaForJoint - baseTheta) > 1e-12) {
                            theta[i] = bestThetaForJoint;
                            bestLocal = bestEvalForJoint;
                            anyImprovement = true;
                        } else {
                            steps[i] = Math.max(minStep, steps[i] * stepDecay);
                        }
                    }

                    if (!anyImprovement && steps.every((step) => step <= minStep + 1e-12)) {
                        break;
                    }
                }

                return {
                    theta,
                    eval: bestLocal,
                    iterations: usedIterations
                };
            };

            let bestTheta = initialTheta.slice();
            let best = evaluateTheta(bestTheta);
            let iterations = 0;

            if (hardConstraint) {
                const seeds = [initialTheta.slice()];
                const mins = jointBounds.map((bound) => bound.min);
                const maxs = jointBounds.map((bound) => bound.max);
                const mids = jointBounds.map((bound) => (bound.min + bound.max) / 2);
                seeds.push(mins, maxs, mids);

                for (let r = 0; r < restartCount; r++) {
                    const randomSeed = jointBounds.map((bound) => bound.min + Math.random() * bound.span);
                    seeds.push(randomSeed);
                }

                for (let s = 0; s < seeds.length; s++) {
                    const refined = refineByLength(seeds[s]);
                    iterations += refined.iterations;
                    if (this.isBetterForHardConstraint(refined.eval, best, tolerance)) {
                        best = refined.eval;
                        bestTheta = refined.theta.slice();
                    }
                }

                if (Math.abs(best.lengthError) <= tolerance) {
                    const feasibleRefined = refineEnergyWithinFeasible(bestTheta);
                    iterations += feasibleRefined.iterations;
                    best = feasibleRefined.eval;
                    bestTheta = feasibleRefined.theta.slice();
                }
            } else {
                let steps = makeStepSizes();

                for (let iter = 0; iter < maxIterations; iter++) {
                    iterations = iter + 1;
                    let anyImprovement = false;

                    for (let i = 0; i < mechanism.joints.length; i++) {
                        const bound = jointBounds[i];
                        const baseTheta = bestTheta[i];
                        const step = steps[i];
                        if (!Number.isFinite(step) || step < minStep) continue;

                        const candidates = [
                            Math.min(bound.max, Math.max(bound.min, baseTheta + step)),
                            Math.min(bound.max, Math.max(bound.min, baseTheta - step)),
                            bound.min,
                            bound.max
                        ];

                        let bestThetaForJoint = baseTheta;
                        let bestEvalForJoint = best;

                        for (let c = 0; c < candidates.length; c++) {
                            const candidateTheta = candidates[c];
                            if (!Number.isFinite(candidateTheta) || Math.abs(candidateTheta - baseTheta) < 1e-12) continue;

                            const trialTheta = bestTheta.slice();
                            trialTheta[i] = candidateTheta;
                            const trial = evaluateTheta(trialTheta);
                            if (trial.score + 1e-12 < bestEvalForJoint.score) {
                                bestEvalForJoint = trial;
                                bestThetaForJoint = candidateTheta;
                            }
                        }

                        if (Math.abs(bestThetaForJoint - baseTheta) > 1e-12) {
                            bestTheta[i] = bestThetaForJoint;
                            best = bestEvalForJoint;
                            anyImprovement = true;
                        } else {
                            steps[i] = Math.max(minStep, steps[i] * stepDecay);
                        }
                    }

                    if (Math.abs(best.lengthError) <= tolerance) {
                        break;
                    }
                    if (!anyImprovement && steps.every((step) => step <= minStep + 1e-12)) {
                        break;
                    }
                }
            }

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
                hardConstraint
            };
        }
    };

    globalScope.MechanismOptimization = MechanismOptimization;
})(window);
