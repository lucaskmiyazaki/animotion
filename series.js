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
}

window.Series = Series;
window.appSeries = window.appSeries || new Series();
