const SpringOptimization = (() => {
    const MIN_X = -1;
    const MAX_X = 1;
    const SENSITIVITY_DELTA_X = 0.1;

    function clampX(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(MIN_X, Math.min(MAX_X, numeric));
    }

    function xToK(x) {
        return Math.pow(10, clampX(x));
    }

    function kToX(k) {
        const numeric = Number(k);
        if (!Number.isFinite(numeric) || numeric <= 0) return 0;
        return clampX(Math.log10(numeric));
    }

    function uniqueSortedFractions(values) {
        const seen = new Set();
        const out = [];

        (Array.isArray(values) ? values : []).forEach((value) => {
            const fraction = Number(value);
            if (!Number.isFinite(fraction)) return;
            const clamped = Math.max(0, Math.min(1, fraction));
            const key = clamped.toFixed(6);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(clamped);
        });

        return out.sort((a, b) => a - b);
    }

    function buildSymmetricFractions(level) {
        const denominator = Math.pow(2, Math.max(1, level));
        const list = [];
        for (let numerator = 1; numerator < denominator; numerator += 1) {
            list.push(numerator / denominator);
        }
        return uniqueSortedFractions(list);
    }

    function toSensitivityList(sensitivityByIndex, jointIndices) {
        return jointIndices
            .map((index) => {
                const value = Number(sensitivityByIndex[index]);
                return {
                    index,
                    sensitivity: Number.isFinite(value) ? Math.abs(value) : 0
                };
            })
            .sort((a, b) => b.sensitivity - a.sensitivity);
    }

    function chooseReferenceIndex(sensitivityByIndex, jointIndices) {
        const ascending = jointIndices
            .map((index) => {
                const value = Number(sensitivityByIndex[index]);
                return {
                    index,
                    sensitivity: Number.isFinite(value) ? Math.abs(value) : 0
                };
            })
            .sort((a, b) => a.sensitivity - b.sensitivity);

        if (ascending.length === 0) return null;
        return ascending[Math.floor(ascending.length / 2)].index;
    }

    function buildKByIndexFromX(xByIndex) {
        const kByIndex = {};
        Object.keys(xByIndex).forEach((key) => {
            const index = Number.parseInt(key, 10);
            if (!Number.isInteger(index) || index < 0) return;
            kByIndex[index] = xToK(xByIndex[index]);
        });
        return kByIndex;
    }

    function yieldToUi() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    async function measureSensitivity(options) {
        const {
            jointIndices,
            xByIndex,
            referenceIndex,
            evaluateError,
            poseFractions,
            movementOptions
        } = options;

        const sensitivityByIndex = {};
        for (let i = 0; i < jointIndices.length; i += 1) {
            const index = jointIndices[i];
            if (index === referenceIndex) {
                sensitivityByIndex[index] = 0;
                continue;
            }

            const baseX = clampX(xByIndex[index]);
            const xPlus = { ...xByIndex, [index]: clampX(baseX + SENSITIVITY_DELTA_X) };
            const xMinus = { ...xByIndex, [index]: clampX(baseX - SENSITIVITY_DELTA_X) };

            const errorPlus = await evaluateError({ xByIndex: xPlus, poseFractions, movementOptions });
            const errorMinus = await evaluateError({ xByIndex: xMinus, poseFractions, movementOptions });

            if (!Number.isFinite(errorPlus) || !Number.isFinite(errorMinus)) {
                sensitivityByIndex[index] = 0;
                continue;
            }

            sensitivityByIndex[index] = Math.abs(errorPlus - errorMinus) / (2 * SENSITIVITY_DELTA_X);

            if ((i + 1) % 2 === 0) {
                await yieldToUi();
            }
        }

        return sensitivityByIndex;
    }

    function buildGroupedSets(nonReferenceIndices, activeSet) {
        const grouped = nonReferenceIndices.filter((index) => !activeSet.has(index));
        return {
            grouped,
            variables: [
                ...Array.from(activeSet).map((index) => ({ type: 'single', index })),
                ...(grouped.length > 0 ? [{ type: 'group', indices: grouped.slice() }] : [])
            ]
        };
    }

    async function optimizeStage(options) {
        const {
            stageLabel,
            xByIndex,
            activeSet,
            nonReferenceIndices,
            referenceIndex,
            evaluateError,
            poseFractions,
            movementOptions,
            maxPasses,
            stepSize,
            minRelativeImprovement,
            progressPrefix,
            onProgress,
            progressStart,
            progressEnd
        } = options;

        const startPct = Number.isFinite(progressStart) ? progressStart : 0;
        const endPct = Number.isFinite(progressEnd) ? progressEnd : 100;
        const progressSpan = Math.max(0, endPct - startPct);

        const stageX = { ...xByIndex, [referenceIndex]: 0 };
        const { grouped, variables } = buildGroupedSets(nonReferenceIndices, activeSet);

        let bestError = await evaluateError({
            xByIndex: stageX,
            poseFractions,
            movementOptions
        });

        onProgress?.(startPct, `${progressPrefix} ${stageLabel}: starting`);

        if (!Number.isFinite(bestError)) {
            return {
                xByIndex: stageX,
                error: Number.POSITIVE_INFINITY,
                passes: 0,
                groupedIndices: grouped,
                stageLabel
            };
        }

        for (let pass = 0; pass < maxPasses; pass += 1) {
            const passStartError = bestError;
            let improvedThisPass = false;

            for (let variableIndex = 0; variableIndex < variables.length; variableIndex += 1) {
                const variable = variables[variableIndex];
                const targets = variable.type === 'single' ? [variable.index] : variable.indices;
                if (targets.length === 0) continue;

                const seedIndex = targets[0];
                const seedX = clampX(stageX[seedIndex]);
                const candidateXs = [
                    clampX(seedX + stepSize),
                    clampX(seedX - stepSize)
                ];

                for (let candidateIndex = 0; candidateIndex < candidateXs.length; candidateIndex += 1) {
                    const nextX = candidateXs[candidateIndex];
                    if (Math.abs(nextX - seedX) < 1e-12) continue;

                    const candidate = { ...stageX };
                    targets.forEach((index) => {
                        candidate[index] = nextX;
                    });
                    candidate[referenceIndex] = 0;

                    const candidateError = await evaluateError({
                        xByIndex: candidate,
                        poseFractions,
                        movementOptions
                    });

                    if (Number.isFinite(candidateError) && candidateError < bestError) {
                        bestError = candidateError;
                        Object.assign(stageX, candidate);
                        improvedThisPass = true;
                    }
                }

                await yieldToUi();
            }

            const denominator = Math.max(1e-9, Math.abs(passStartError));
            const relativeImprovement = (passStartError - bestError) / denominator;

            const passProgress = startPct + progressSpan * ((pass + 1) / Math.max(1, maxPasses));
            onProgress?.(passProgress, `${progressPrefix} ${stageLabel}: pass ${pass + 1}/${maxPasses}, error ${bestError.toFixed(4)}`);

            if (!improvedThisPass) {
                break;
            }

            if (relativeImprovement < minRelativeImprovement) {
                break;
            }
        }

        stageX[referenceIndex] = 0;

        return {
            xByIndex: stageX,
            error: bestError,
            groupedIndices: grouped,
            stageLabel
        };
    }

    function buildStageConfig(stageType) {
        if (stageType === 'early') {
            return {
                stepSize: 0.5,
                maxPasses: 3,
                minRelativeImprovement: 0.005,
                movementOptions: {
                    samplesPerJoint: 9,
                    sweepPasses: 1,
                    maxBinaryIterations: 10,
                    maxBracketExpansions: 6,
                    lengthTolerance: 0.05
                }
            };
        }

        if (stageType === 'middle') {
            return {
                stepSize: 0.25,
                maxPasses: 5,
                minRelativeImprovement: 0.001,
                movementOptions: {
                    samplesPerJoint: 13,
                    sweepPasses: 2,
                    maxBinaryIterations: 16,
                    maxBracketExpansions: 10,
                    lengthTolerance: 0.02
                }
            };
        }

        if (stageType === 'late') {
            return {
                stepSize: 0.1,
                maxPasses: 8,
                minRelativeImprovement: 0.001,
                movementOptions: {
                    samplesPerJoint: 17,
                    sweepPasses: 3,
                    maxBinaryIterations: 24,
                    maxBracketExpansions: 14,
                    lengthTolerance: 0.01
                }
            };
        }

        return {
            stepSize: 0.05,
            maxPasses: 12,
            minRelativeImprovement: 0.0001,
            movementOptions: {
                samplesPerJoint: 21,
                sweepPasses: 4,
                maxBinaryIterations: 32,
                maxBracketExpansions: 18,
                lengthTolerance: 0.005
            }
        };
    }

    function mergeMovementOptions(baseOptions, overrideOptions) {
        return {
            ...(baseOptions || {}),
            ...(overrideOptions || {})
        };
    }

    async function optimize(options = {}) {
        const jointCount = Number.isInteger(options.jointCount) ? options.jointCount : 0;
        const evaluateError = typeof options.evaluateError === 'function' ? options.evaluateError : null;
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

        if (!evaluateError || jointCount <= 0) {
            return {
                converged: false,
                reason: 'invalid-input',
                kByIndex: {},
                xByIndex: {},
                referenceIndex: null
            };
        }

        const allJointIndices = Array.from({ length: jointCount }, (_, index) => index);
        const initialKByIndex = options.initialKByIndex || {};
        const xByIndex = {};

        onProgress?.(2, 'Initializing spring optimization...');

        allJointIndices.forEach((index) => {
            xByIndex[index] = kToX(initialKByIndex[index] ?? 1);
        });

        const initialSensitivityConfig = buildStageConfig('early');
        const initialSensitivityFractions = uniqueSortedFractions(options.initialSensitivityFractions || [0.5]);
        const initialSensitivity = await measureSensitivity({
            jointIndices: allJointIndices,
            xByIndex,
            referenceIndex: null,
            evaluateError,
            poseFractions: initialSensitivityFractions,
            movementOptions: mergeMovementOptions(options.baseMovementOptions, initialSensitivityConfig.movementOptions)
        });

        onProgress?.(12, 'Initial sensitivity computed');

        const referenceIndex = chooseReferenceIndex(initialSensitivity, allJointIndices);
        if (!Number.isInteger(referenceIndex)) {
            return {
                converged: false,
                reason: 'no-reference-spring',
                kByIndex: buildKByIndexFromX(xByIndex),
                xByIndex,
                referenceIndex: null
            };
        }

        xByIndex[referenceIndex] = 0;
        const nonReferenceIndices = allJointIndices.filter((index) => index !== referenceIndex);
        const sensitivityRanking = toSensitivityList(initialSensitivity, nonReferenceIndices).map((entry) => entry.index);

        const activeSet = new Set(sensitivityRanking.slice(0, Math.min(2, sensitivityRanking.length)));
        let stageCounter = 0;
        let bestError = Number.POSITIVE_INFINITY;
        const totalStages = Math.max(1, Math.ceil(nonReferenceIndices.length / 2));

        const history = [];

        while (true) {
            const remainingCount = nonReferenceIndices.filter((index) => !activeSet.has(index)).length;
            const isFinalStage = remainingCount === 0;

            let stageType = 'middle';
            if (isFinalStage) {
                stageType = 'final';
            } else if (stageCounter <= 1) {
                stageType = 'early';
            } else if (remainingCount <= 2) {
                stageType = 'late';
            }

            const stageConfig = buildStageConfig(stageType);

            let poseFractions;
            if (stageType === 'final') {
                poseFractions = uniqueSortedFractions(options.finalPoseFractions || []);
            } else if (stageCounter === 0) {
                poseFractions = [0.5];
            } else if (stageCounter === 1) {
                poseFractions = [0.25, 0.5, 0.75];
            } else {
                poseFractions = buildSymmetricFractions(stageCounter + 1);
            }

            const stageIndex = Math.min(stageCounter, totalStages - 1);
            const stageStart = 12 + (84 * (stageIndex / totalStages));
            const stageEnd = 12 + (84 * ((stageIndex + 1) / totalStages));

            onProgress?.(stageStart, `Spring optimization stage ${stageCounter + 1} (${stageType})`);

            const stageResult = await optimizeStage({
                stageLabel: `Stage ${stageCounter + 1}`,
                xByIndex,
                activeSet,
                nonReferenceIndices,
                referenceIndex,
                evaluateError,
                poseFractions,
                movementOptions: mergeMovementOptions(options.baseMovementOptions, stageConfig.movementOptions),
                maxPasses: stageConfig.maxPasses,
                stepSize: stageConfig.stepSize,
                minRelativeImprovement: stageConfig.minRelativeImprovement,
                progressPrefix: 'Spring optimization',
                onProgress,
                progressStart: stageStart,
                progressEnd: stageEnd
            });

            Object.assign(xByIndex, stageResult.xByIndex);
            xByIndex[referenceIndex] = 0;
            bestError = stageResult.error;

            history.push({
                stage: stageCounter + 1,
                type: stageType,
                error: bestError,
                activeIndices: Array.from(activeSet).sort((a, b) => a - b),
                groupedIndices: stageResult.groupedIndices.slice()
            });

            if (stageType === 'final') {
                break;
            }

            const refreshedSensitivity = await measureSensitivity({
                jointIndices: nonReferenceIndices,
                xByIndex,
                referenceIndex,
                evaluateError,
                poseFractions,
                movementOptions: mergeMovementOptions(options.baseMovementOptions, stageConfig.movementOptions)
            });

            onProgress?.(Math.min(96, stageEnd), `Sensitivity refresh after stage ${stageCounter + 1}`);

            const refreshedRanking = toSensitivityList(refreshedSensitivity, nonReferenceIndices)
                .map((entry) => entry.index)
                .filter((index) => !activeSet.has(index));

            refreshedRanking.slice(0, 2).forEach((index) => activeSet.add(index));
            stageCounter += 1;

            await yieldToUi();
        }

        const kByIndex = buildKByIndexFromX(xByIndex);

        onProgress?.(100, 'Spring optimization complete');

        return {
            converged: true,
            referenceIndex,
            kByIndex,
            xByIndex: { ...xByIndex },
            finalError: bestError,
            history
        };
    }

    return {
        optimize,
        clampX,
        xToK,
        kToX
    };
})();

window.SpringOptimization = SpringOptimization;
