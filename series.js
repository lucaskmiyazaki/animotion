class Series {
    constructor() {
        // Logical-frame timeline store.
        // Each entry keeps both domains together:
        // - skeleton: drawing data for this logical frame
        // - sourceFrame: mapped source frame in the video
        this.frameEntries = [];
    }

    // ---------- Internal Helpers ----------

    _toIndex(frameIndex) {
        const parsed = Number.parseInt(frameIndex, 10);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    _makeEntry(defaultSourceFrame) {
        return {
            skeleton: null,
            mechanism: null,
            sourceFrame: defaultSourceFrame
        };
    }

    _getEntry(index) {
        return this.frameEntries[index] || null;
    }

    _ensureEntry(index) {
        if (!this.frameEntries[index]) {
            this.frameEntries[index] = this._makeEntry(index);
        }
        return this.frameEntries[index];
    }

    _validStores(extraStores = []) {
        return extraStores.filter((store) => store && typeof store === 'object');
    }

    _clearStore(store) {
        Object.keys(store).forEach((key) => delete store[key]);
    }

    _shiftStoreLeftFrom(store, deletedIndex) {
        if (!store || typeof store !== 'object') return;

        const keys = Object.keys(store)
            .map((k) => Number.parseInt(k, 10))
            .filter((k) => Number.isInteger(k) && k >= deletedIndex)
            .sort((a, b) => a - b);

        keys.forEach((key) => {
            if (key === deletedIndex) {
                delete store[key];
                return;
            }
            store[key - 1] = store[key];
            delete store[key];
        });
    }

    _remapStore(store, indexMap) {
        const nextStore = {};

        Object.keys(store).forEach((oldKey) => {
            const oldIndex = Number.parseInt(oldKey, 10);
            if (!Number.isInteger(oldIndex)) return;

            const newIndex = indexMap[oldIndex];
            if (newIndex !== undefined) {
                nextStore[newIndex] = store[oldIndex];
            }
        });

        this._clearStore(store);
        Object.assign(store, nextStore);
    }

    _classifyTrend(delta, epsilon = 1e-4) {
        if (!Number.isFinite(delta)) return 'unchanged';
        if (delta > epsilon) return 'increasing';
        if (delta < -epsilon) return 'decreasing';
        return 'unchanged';
    }

    // ---------- Skeleton API ----------

    getFrame(frameIndex) {
        const index = this._toIndex(frameIndex);
        if (index === null) return null;
        return this._getEntry(index)?.skeleton || null;
    }

    ensureFrame(frameIndex) {
        const index = this._toIndex(frameIndex);
        if (index === null) return null;

        const entry = this._ensureEntry(index);
        if (!entry.skeleton) {
            entry.skeleton = new Skeleton();
        }
        return entry.skeleton;
    }

    setFrame(frameIndex, skeleton) {
        const index = this._toIndex(frameIndex);
        if (index === null) return null;

        const entry = this._ensureEntry(index);
        entry.skeleton = skeleton;
        return skeleton;
    }

    getMechanism(frameIndex) {
        const index = this._toIndex(frameIndex);
        if (index === null) return null;
        return this._getEntry(index)?.mechanism || null;
    }

    setMechanism(frameIndex, mechanism) {
        const index = this._toIndex(frameIndex);
        if (index === null) return null;

        const entry = this._ensureEntry(index);
        entry.mechanism = mechanism;
        return mechanism;
    }

    clearMechanism(frameIndex) {
        return this.setMechanism(frameIndex, null);
    }

    clearAllMechanisms() {
        this.frameEntries.forEach((entry) => {
            if (entry) {
                entry.mechanism = null;
            }
        });
    }

    getMechanismFrameStore() {
        const store = {};
        this.frameEntries.forEach((entry, index) => {
            if (entry?.mechanism) {
                store[index] = entry.mechanism;
            }
        });
        return store;
    }

    deleteFrame(frameIndex) {
        this.removeFrameAndShift(frameIndex);
    }

    getFrameIndices() {
        const indices = [];
        this.frameEntries.forEach((entry, index) => {
            if (entry?.skeleton) indices.push(index);
        });
        return indices;
    }

    getLastFrameWithPoints() {
        const indices = this.getFrameIndices()
            .filter((idx) => this.getFrame(idx)?.points?.length > 0)
            .sort((a, b) => b - a);
        return indices.length > 0 ? indices[0] : -1;
    }

    getSkeletonFrameStore() {
        const store = {};
        this.frameEntries.forEach((entry, index) => {
            if (entry?.skeleton) {
                store[index] = entry.skeleton;
            }
        });
        return store;
    }

    getSkeletons() {
        return this.frameEntries.map((entry) => entry?.skeleton).filter(Boolean);
    }

    // ---------- Timeline / Frame Deletion ----------

    getStoredFrameIndices(extraStores = []) {
        const allKeys = new Set();

        this.frameEntries.forEach((entry, index) => {
            if (entry) allKeys.add(String(index));
        });

        this._validStores(extraStores).forEach((store) => {
            Object.keys(store).forEach((key) => allKeys.add(key));
        });

        return Array.from(allKeys)
            .map((k) => Number.parseInt(k, 10))
            .filter(Number.isInteger)
            .sort((a, b) => b - a);
    }

    removeFrameAndShift(frameIndex, extraStores = []) {
        const deletedIndex = this._toIndex(frameIndex);
        if (deletedIndex === null) return;

        if (deletedIndex < this.frameEntries.length) {
            this.frameEntries.splice(deletedIndex, 1);
        }

        this._validStores(extraStores).forEach((store) => {
            this._shiftStoreLeftFrom(store, deletedIndex);
        });
    }

    compactToFramesWithPoints(currentFrameIndex, extraStores = [], maxFrameIndex = -1) {
        const stores = this._validStores(extraStores);
        const clampedCurrent = this.clampFrameIndex(currentFrameIndex);
        const upperBound = Math.max(
            this.frameEntries.length - 1,
            Number.isInteger(maxFrameIndex) ? maxFrameIndex : -1
        );

        if (upperBound < 0 || this.frameEntries.length === 0) {
            this.frameEntries = [];
            return { currentFrameIndex: 0, removedFrameIndices: [] };
        }

        const keepIndices = [];
        const removedFrameIndices = [];

        for (let i = 0; i <= upperBound; i++) {
            const skeleton = this._getEntry(i)?.skeleton;
            if (skeleton && skeleton.points.length > 0) {
                keepIndices.push(i);
            } else {
                removedFrameIndices.push(i);
            }
        }

        if (keepIndices.length === 0) {
            this.frameEntries = [];
            stores.forEach((store) => this._clearStore(store));
            return { currentFrameIndex: 0, removedFrameIndices: [] };
        }

        const indexMap = {};
        keepIndices.forEach((oldIndex, newIndex) => {
            indexMap[oldIndex] = newIndex;
        });

        const previousEntries = this.frameEntries;
        this.frameEntries = keepIndices.map((oldIndex) => {
            const entry = previousEntries[oldIndex] || this._makeEntry(oldIndex);
            return {
                skeleton: entry.skeleton || null,
                mechanism: entry.mechanism || null,
                sourceFrame: Number.isInteger(entry.sourceFrame) ? entry.sourceFrame : oldIndex
            };
        });

        stores.forEach((store) => this._remapStore(store, indexMap));

        return {
            currentFrameIndex: indexMap[clampedCurrent] !== undefined ? indexMap[clampedCurrent] : 0,
            removedFrameIndices
        };
    }

    deleteLeadingEmptyFrames(currentFrameIndex, extraStores = []) {
        const current = this._toIndex(currentFrameIndex);
        if (current === null || current <= 0) {
            return { currentFrameIndex: current ?? 0, removedFrameIndices: [] };
        }

        for (let i = 0; i < current; i++) {
            const skeleton = this._getEntry(i)?.skeleton;
            if (skeleton && skeleton.points.length > 0) {
                return { currentFrameIndex: current, removedFrameIndices: [] };
            }
        }

        const removedCount = current;
        this.frameEntries.splice(0, removedCount);

        this._validStores(extraStores).forEach((store) => {
            const nextStore = {};
            Object.keys(store).forEach((key) => {
                const index = Number.parseInt(key, 10);
                if (Number.isInteger(index) && index >= removedCount) {
                    nextStore[index - removedCount] = store[index];
                }
            });
            this._clearStore(store);
            Object.assign(store, nextStore);
        });

        return {
            currentFrameIndex: 0,
            removedFrameIndices: Array.from({ length: removedCount }, (_, i) => i)
        };
    }

    // ---------- Video Frame-Map API ----------

    normalizeFrameIndexMap(rawMap) {
        if (!Array.isArray(rawMap)) return [];

        const normalized = [];
        rawMap.forEach((value) => {
            const frame = Number.parseInt(value, 10);
            if (Number.isInteger(frame) && frame >= 0) {
                normalized.push(frame);
            }
        });

        if (normalized.length <= 1) return normalized;

        const strictlyIncreasing = normalized.every(
            (value, index) => index === 0 || value > normalized[index - 1]
        );
        if (strictlyIncreasing) return normalized;

        return Array.from(new Set(normalized)).sort((a, b) => a - b);
    }

    rebuildFrameIndexMap(frameIndicesToKeep) {
        const nextMap = Array.isArray(frameIndicesToKeep) ? frameIndicesToKeep.slice() : [];
        const previousEntries = this.frameEntries;

        this.frameEntries = nextMap.map((sourceFrame, index) => ({
            skeleton: previousEntries[index]?.skeleton || null,
            mechanism: previousEntries[index]?.mechanism || null,
            sourceFrame: Number.isInteger(sourceFrame) ? sourceFrame : index
        }));
    }

    getFrameIndexMap() {
        return this.frameEntries.map((entry, index) => {
            if (!entry) return index;
            return Number.isInteger(entry.sourceFrame) ? entry.sourceFrame : index;
        });
    }

    setFrameIndexMap(newFrameIndexMap) {
        const normalized = this.normalizeFrameIndexMap(newFrameIndexMap);
        if (normalized.length === 0) return;
        this.rebuildFrameIndexMap(normalized);
    }

    setFrameRange(range, maxValidFrame = -1) {
        if (!range || range.startSourceFrame === undefined || range.endSourceFrame === undefined) {
            return;
        }

        const effectiveMax = Number.isInteger(maxValidFrame)
            ? maxValidFrame
            : Math.max(Number.parseInt(maxValidFrame, 10) || -1, -1);

        const start = Math.max(0, Number.parseInt(range.startSourceFrame, 10));
        const end = Math.min(effectiveMax, Number.parseInt(range.endSourceFrame, 10));

        if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
            this.rebuildFrameIndexMap(Array.from({ length: end - start + 1 }, (_, i) => start + i));
        }
    }

    getMaxFrameIndex() {
        return this.frameEntries.length > 0 ? this.frameEntries.length - 1 : 0;
    }

    clampFrameIndex(frameIndex) {
        const index = this._toIndex(frameIndex);
        const safe = Number.isInteger(index) ? index : 0;
        return Math.min(Math.max(0, safe), this.getMaxFrameIndex());
    }

    updateMaxFrameIndex(newMaxFrameIndex) {
        const max = Number.parseInt(newMaxFrameIndex, 10);
        if (!Number.isInteger(max) || max < 0) {
            this.frameEntries = [];
            return;
        }

        for (let i = 0; i <= max; i++) {
            const entry = this._ensureEntry(i);
            entry.sourceFrame = i;
        }
        this.frameEntries.length = max + 1;
    }

    appendFrameSlot() {
        const frameIndexMap = this.getFrameIndexMap();
        const lastSourceFrame = frameIndexMap.length > 0 ? frameIndexMap[frameIndexMap.length - 1] : -1;

        this.frameEntries.push({
            skeleton: null,
            mechanism: null,
            sourceFrame: lastSourceFrame + 1
        });
    }

    removeFrameIndices(frameIndices) {
        if (!Array.isArray(frameIndices) || frameIndices.length === 0) return;

        const sorted = Array.from(new Set(frameIndices))
            .filter((index) => Number.isInteger(index) && index >= 0)
            .sort((a, b) => b - a);

        sorted.forEach((index) => {
            if (index < this.frameEntries.length) {
                this.frameEntries.splice(index, 1);
            }
        });
    }

    getSourceFrameIndex(logicalFrameIndex) {
        const clamped = this.clampFrameIndex(logicalFrameIndex);
        return this._getEntry(clamped)?.sourceFrame;
    }

    findNearestLogicalFrameIndex(sourceFrameIndex) {
        const source = Number.parseInt(sourceFrameIndex, 10);
        const frameIndexMap = this.getFrameIndexMap();
        if (!Number.isInteger(source) || frameIndexMap.length === 0) {
            return 0;
        }

        const exact = frameIndexMap.indexOf(source);
        if (exact !== -1) return exact;

        let nearestIndex = 0;
        let nearestDistance = Math.abs(frameIndexMap[0] - source);

        for (let i = 1; i < frameIndexMap.length; i++) {
            const distance = Math.abs(frameIndexMap[i] - source);
            if (distance < nearestDistance) {
                nearestIndex = i;
                nearestDistance = distance;
            }
        }

        return nearestIndex;
    }

    getFrameRange() {
        const frameIndexMap = this.getFrameIndexMap();
        if (frameIndexMap.length === 0) return null;

        return {
            startSourceFrame: frameIndexMap[0],
            endSourceFrame: frameIndexMap[frameIndexMap.length - 1]
        };
    }

    buildJointMechanismForBundle(bundle, options = {}) {
        const frameIndex = Number.isInteger(options.frameIndex) ? options.frameIndex : 0;
        const jointKByIndex = options.jointKByIndex && typeof options.jointKByIndex === 'object'
            ? options.jointKByIndex
            : {};

        const ChainCtor = options.ChainCtor || window.Chain || null;
        const MechanismCtor = options.MechanismCtor || window.Mechanism || null;

        if (!MechanismCtor) return null;

        if (!ChainCtor || (!(bundle?.mechanism1 instanceof ChainCtor) && !(bundle?.mechanism2 instanceof ChainCtor))) {
            return new MechanismCtor({ chains: [], joints: [] });
        }

        const frameIndices = this.getFrameIndices().sort((a, b) => a - b);
        const firstFrameIndex = frameIndices[0];
        const lastFrameIndex = frameIndices[frameIndices.length - 1];

        let jointTheta = 0;
        if (Number.isFinite(firstFrameIndex) && Number.isFinite(lastFrameIndex) && lastFrameIndex > firstFrameIndex) {
            const t = (frameIndex - firstFrameIndex) / (lastFrameIndex - firstFrameIndex);
            jointTheta = Math.min(1, Math.max(0, t));
        }

        const firstBundle = options.initialBundle || this.getMechanism(firstFrameIndex) || null;
        const lastBundle = options.finalBundle || this.getMechanism(lastFrameIndex) || null;

        const mapAInitial = MechanismCtor.buildRelativeThetaMap(firstBundle?.mechanism1 || bundle.mechanism1);
        const mapAFinal = MechanismCtor.buildRelativeThetaMap(lastBundle?.mechanism1 || firstBundle?.mechanism1 || bundle.mechanism1);
        const mapBInitial = MechanismCtor.buildRelativeThetaMap(firstBundle?.mechanism2 || bundle.mechanism2);
        const mapBFinal = MechanismCtor.buildRelativeThetaMap(lastBundle?.mechanism2 || firstBundle?.mechanism2 || bundle.mechanism2);

        return MechanismCtor.fromTwinChains({
            chainA: bundle.mechanism1,
            chainB: bundle.mechanism2,
            initialThetaBySegmentA: mapAInitial,
            finalThetaBySegmentA: mapAFinal,
            initialThetaBySegmentB: mapBInitial,
            finalThetaBySegmentB: mapBFinal,
            jointTheta,
            kByJointIndex: jointKByIndex
        });
    }

    createMechanisms(options = {}) {
        const ChainCtor = options.ChainCtor || window.Chain || null;
        const MechanismCtor = options.MechanismCtor || window.Mechanism || null;
        const pivotRadius = Number.isFinite(options.chainThickness) ? options.chainThickness : 50;
        const jointKByIndex = options.jointKByIndex && typeof options.jointKByIndex === 'object'
            ? options.jointKByIndex
            : {};
        const optimizationOptions = options.optimizationOptions && typeof options.optimizationOptions === 'object'
            ? options.optimizationOptions
            : {};

        const makeBundle = (mechanism1 = null, mechanism2 = null) => ({
            mechanism1: ChainCtor && mechanism1 instanceof ChainCtor ? mechanism1 : null,
            mechanism2: ChainCtor && mechanism2 instanceof ChainCtor ? mechanism2 : null,
            mechanism: null
        });

        const frameIndices = this.getFrameIndices().sort((a, b) => a - b);
        if (!ChainCtor || !MechanismCtor || frameIndices.length === 0) {
            this.clearAllMechanisms();
            return {
                builtFrameIndices: [],
                displayedFrameIndex: 0,
                displayedBundle: makeBundle(null, null)
            };
        }

        this.clearAllMechanisms();

        const startFrameIndex = frameIndices[0];
        const endFrameIndex = frameIndices[frameIndices.length - 1];
        const startSkeleton = this.getFrame(startFrameIndex);
        const endSkeleton = this.getFrame(endFrameIndex);

        const mechanism1Initial = new ChainCtor();
        mechanism1Initial.generateFromSeries(this, {
            frameIndex: startFrameIndex,
            pivotKind: 'ref1',
            pivotRadius
        });

        const mechanism2LastFrame = new ChainCtor();
        mechanism2LastFrame.generateFromSeries(this, {
            frameIndex: endFrameIndex,
            pivotKind: 'ref2',
            pivotRadius
        });

        let mechanism2Initial = mechanism2LastFrame.clone();
        if (startSkeleton && endSkeleton && mechanism2Initial.links.length > 0) {
            mechanism2Initial.poseToSkeleton(endSkeleton, startSkeleton);
        }

        ChainCtor.pairTwinLinks(mechanism1Initial, mechanism2Initial);

        const startBundle = makeBundle(mechanism1Initial, mechanism2Initial);
        this.setMechanism(startFrameIndex, startBundle);

        let displayedFrameIndex = startFrameIndex;
        let displayedBundle = startBundle;
        const builtFrameIndices = frameIndices.slice();
        let endBundle = null;

        if (endFrameIndex !== startFrameIndex && startSkeleton && endSkeleton) {
            const mechanism1Last = mechanism1Initial.clone();
            if (mechanism1Last.links.length > 0) {
                mechanism1Last.poseToSkeleton(startSkeleton, endSkeleton);
            }

            const mechanism2Last = mechanism2LastFrame.clone();
            ChainCtor.pairTwinLinks(mechanism1Last, mechanism2Last);

            endBundle = makeBundle(mechanism1Last, mechanism2Last);
            this.setMechanism(endFrameIndex, endBundle);
            displayedFrameIndex = endFrameIndex;
            displayedBundle = endBundle;
        }

        const initialHoleLength = Number.isFinite(startBundle.mechanism2?.getHoleLineLength?.())
            ? startBundle.mechanism2.getHoleLineLength()
            : 0;
        const finalHoleLength = Number.isFinite((endBundle || startBundle).mechanism2?.getHoleLineLength?.())
            ? (endBundle || startBundle).mechanism2.getHoleLineLength()
            : initialHoleLength;
        const frameSpan = Math.max(1, endFrameIndex - startFrameIndex);

        const cloneBundle = (bundle) => {
            const cloned = makeBundle(
                bundle?.mechanism1 ? bundle.mechanism1.clone() : null,
                bundle?.mechanism2 ? bundle.mechanism2.clone() : null
            );
            if (cloned.mechanism1 && cloned.mechanism2) {
                ChainCtor.pairTwinLinks(cloned.mechanism1, cloned.mechanism2);
            }
            return cloned;
        };

        // Build and solve one mechanism per frame entry so it stays aligned with
        // frame deletion/remap operations.
        frameIndices.forEach((frameIndex) => {
            const t = frameSpan > 0 ? (frameIndex - startFrameIndex) / frameSpan : 0;
            const clampedT = Math.min(1, Math.max(0, t));
            const targetHoleLength = initialHoleLength + (finalHoleLength - initialHoleLength) * clampedT;

            const baseBundle = cloneBundle(startBundle);

            const mechanism = this.buildJointMechanismForBundle(baseBundle, {
                frameIndex,
                jointKByIndex,
                ChainCtor,
                MechanismCtor,
                initialBundle: startBundle,
                finalBundle: endBundle || startBundle
            });

            if (mechanism instanceof MechanismCtor) {
                mechanism.findMinimumEnergyPoseForHoleLength(targetHoleLength, {
                    chainIndex: 1,
                    maxIterations: Number.isInteger(optimizationOptions.maxIterations)
                        ? optimizationOptions.maxIterations
                        : 40,
                    lengthTolerance: Number.isFinite(optimizationOptions.lengthTolerance)
                        ? optimizationOptions.lengthTolerance
                        : 0.5,
                    holeLengthWeight: Number.isFinite(optimizationOptions.holeLengthWeight)
                        ? optimizationOptions.holeLengthWeight
                        : 5,
                    minStep: Number.isFinite(optimizationOptions.minStep)
                        ? optimizationOptions.minStep
                        : 1e-3,
                    stepDecay: Number.isFinite(optimizationOptions.stepDecay)
                        ? optimizationOptions.stepDecay
                        : 0.6
                });
            }

            const solvedBundle = makeBundle(
                mechanism?.chains?.[0] instanceof ChainCtor ? mechanism.chains[0] : baseBundle.mechanism1,
                mechanism?.chains?.[1] instanceof ChainCtor ? mechanism.chains[1] : baseBundle.mechanism2
            );
            solvedBundle.mechanism = mechanism;
            this.setMechanism(frameIndex, solvedBundle);
        });

        displayedBundle = this.getMechanism(displayedFrameIndex) || displayedBundle;

        return {
            builtFrameIndices,
            displayedFrameIndex,
            displayedBundle,
            startFrameIndex,
            endFrameIndex,
            initialHoleLength,
            finalHoleLength
        };
    }

    compareInitialToLastFrameAngles(options = {}) {
        const epsilon = Number.isFinite(options.epsilon) ? options.epsilon : 1e-4;
        const indices = this.getFrameIndices().sort((a, b) => a - b);
        if (indices.length < 2) {
            return {
                startFrameIndex: -1,
                endFrameIndex: -1,
                pointDirections: {}
            };
        }

        const startFrameIndex = indices[0];
        const endFrameIndex = indices[indices.length - 1];
        const firstSkeleton = this.getFrame(startFrameIndex);
        const lastSkeleton = this.getFrame(endFrameIndex);

        if (!firstSkeleton || !lastSkeleton) {
            return {
                startFrameIndex,
                endFrameIndex,
                pointDirections: {}
            };
        }

        const maxComparablePoints = Math.min(firstSkeleton.points.length, lastSkeleton.points.length);
        const pointDirections = {};

        for (let i = 1; i < maxComparablePoints - 1; i++) {
            const firstAngles = firstSkeleton.computeDirectedAnglesAtPoint(i);
            const lastAngles = lastSkeleton.computeDirectedAnglesAtPoint(i);
            if (!firstAngles || !lastAngles) continue;

            const clockwiseDelta = lastAngles.clockwise - firstAngles.clockwise;
            const counterclockwiseDelta = lastAngles.counterclockwise - firstAngles.counterclockwise;
            const clockwiseTrend = this._classifyTrend(clockwiseDelta, epsilon);
            const counterclockwiseTrend = this._classifyTrend(counterclockwiseDelta, epsilon);

            let closingDirection = null;
            if (clockwiseTrend === 'decreasing') {
                closingDirection = 'clockwise';
            } else if (counterclockwiseTrend === 'decreasing') {
                closingDirection = 'counterclockwise';
            }

            pointDirections[i] = {
                clockwise: {
                    initial: firstAngles.clockwise,
                    last: lastAngles.clockwise,
                    delta: clockwiseDelta,
                    trend: clockwiseTrend
                },
                counterclockwise: {
                    initial: firstAngles.counterclockwise,
                    last: lastAngles.counterclockwise,
                    delta: counterclockwiseDelta,
                    trend: counterclockwiseTrend
                },
                closingDirection
            };
        }

        return {
            startFrameIndex,
            endFrameIndex,
            pointDirections
        };
    }
}

window.Series = Series;
window.appSeries = window.appSeries || new Series();
