class Series {
    constructor() {
        // Unified per-frame store: each slot owns both skeleton and source frame.
        this.series = [];
    }

    _toIndex(frameIndex) {
        const index = Number.parseInt(frameIndex, 10);
        return Number.isInteger(index) && index >= 0 ? index : null;
    }

    _ensureSlot(index) {
        if (!this.series[index]) {
            this.series[index] = {
                skeleton: null,
                sourceFrame: index
            };
        }
        return this.series[index];
    }

    _shiftIndexedStoreLeft(store, startIndex) {
        if (!store || typeof store !== 'object') return;

        const keys = Object.keys(store)
            .map((k) => Number.parseInt(k, 10))
            .filter((k) => Number.isInteger(k) && k >= startIndex)
            .sort((a, b) => a - b);

        keys.forEach((key) => {
            if (key === startIndex) {
                delete store[key];
                return;
            }

            store[key - 1] = store[key];
            delete store[key];
        });
    }

    getFrame(frameIndex) {
        const index = this._toIndex(frameIndex);
        if (index === null) return null;
        return this.series[index]?.skeleton || null;
    }

    ensureFrame(frameIndex) {
        const index = this._toIndex(frameIndex);
        if (index === null) return null;

        const slot = this._ensureSlot(index);
        if (!slot.skeleton) {
            slot.skeleton = new Skeleton();
        }
        return slot.skeleton;
    }

    setFrame(frameIndex, skeleton) {
        const index = this._toIndex(frameIndex);
        if (index === null) return null;

        const slot = this._ensureSlot(index);
        slot.skeleton = skeleton;
        return skeleton;
    }

    deleteFrame(frameIndex) {
        this.removeFrameAndShift(frameIndex);
    }

    getFrameIndices() {
        const indices = [];
        this.series.forEach((slot, index) => {
            if (slot?.skeleton) {
                indices.push(index);
            }
        });
        return indices;
    }

    getLastFrameWithPoints() {
        const indices = this.getFrameIndices()
            .filter((idx) => this.getFrame(idx)?.points?.length > 0)
            .sort((a, b) => b - a);
        return indices.length > 0 ? indices[0] : -1;
    }

    getStoredFrameIndices(extraStores = []) {
        const allKeys = new Set();

        this.series.forEach((slot, index) => {
            if (slot) {
                allKeys.add(String(index));
            }
        });

        extraStores.forEach((store) => {
            if (!store || typeof store !== 'object') return;
            Object.keys(store).forEach((key) => allKeys.add(key));
        });

        return Array.from(allKeys)
            .map((k) => Number.parseInt(k, 10))
            .filter(Number.isInteger)
            .sort((a, b) => b - a);
    }

    removeFrameAndShift(frameIndex, extraStores = []) {
        const target = this._toIndex(frameIndex);
        if (target === null) return;

        if (target < this.series.length) {
            this.series.splice(target, 1);
        }

        extraStores
            .filter((s) => s && typeof s === 'object')
            .forEach((store) => this._shiftIndexedStoreLeft(store, target));
    }

    compactToFramesWithPoints(currentFrameIndex, extraStores = [], maxFrameIndex = -1) {
        const stores = extraStores.filter((s) => s && typeof s === 'object');
        const validCurrent = this.clampFrameIndex(currentFrameIndex);
        const currentMaxFrame = Math.max(this.series.length - 1, Number.isInteger(maxFrameIndex) ? maxFrameIndex : -1);

        if (currentMaxFrame < 0 || this.series.length === 0) {
            this.series = [];
            return { currentFrameIndex: 0, removedFrameIndices: [] };
        }

        const keepIndices = [];
        const removedFrameIndices = [];

        for (let i = 0; i <= currentMaxFrame; i++) {
            const skeleton = this.series[i]?.skeleton;
            if (skeleton && skeleton.points.length > 0) {
                keepIndices.push(i);
            } else {
                removedFrameIndices.push(i);
            }
        }

        if (keepIndices.length === 0) {
            this.series = [];
            stores.forEach((store) => {
                Object.keys(store).forEach((key) => delete store[key]);
            });
            return { currentFrameIndex: 0, removedFrameIndices: [] };
        }

        const indexMap = {};
        keepIndices.forEach((oldIdx, newIdx) => {
            indexMap[oldIdx] = newIdx;
        });

        this.series = keepIndices.map((oldIdx, newIdx) => {
            const slot = this.series[oldIdx] || {};
            return {
                skeleton: slot.skeleton || null,
                sourceFrame: Number.isInteger(slot.sourceFrame) ? slot.sourceFrame : oldIdx,
                logicalFrame: newIdx
            };
        });

        stores.forEach((store) => {
            const nextStore = {};
            Object.keys(store).forEach((oldKey) => {
                const oldIdx = Number.parseInt(oldKey, 10);
                if (!Number.isInteger(oldIdx)) return;
                const newIdx = indexMap[oldIdx];
                if (newIdx !== undefined) {
                    nextStore[newIdx] = store[oldIdx];
                }
            });

            Object.keys(store).forEach((key) => delete store[key]);
            Object.assign(store, nextStore);
        });

        return {
            currentFrameIndex: indexMap[validCurrent] !== undefined ? indexMap[validCurrent] : 0,
            removedFrameIndices
        };
    }

    deleteLeadingEmptyFrames(currentFrameIndex, extraStores = []) {
        const current = this._toIndex(currentFrameIndex);
        if (current === null || current <= 0) {
            return { currentFrameIndex: Number.isInteger(current) ? current : 0, removedFrameIndices: [] };
        }

        for (let i = 0; i < current; i++) {
            const skeleton = this.series[i]?.skeleton;
            if (skeleton && skeleton.points.length > 0) {
                return { currentFrameIndex: current, removedFrameIndices: [] };
            }
        }

        const numToDelete = current;
        this.series.splice(0, numToDelete);

        extraStores
            .filter((s) => s && typeof s === 'object')
            .forEach((store) => {
                const keys = Object.keys(store)
                    .map((k) => Number.parseInt(k, 10))
                    .filter((k) => Number.isInteger(k))
                    .sort((a, b) => a - b);

                const nextStore = {};
                keys.forEach((idx) => {
                    if (idx >= numToDelete) {
                        nextStore[idx - numToDelete] = store[idx];
                    }
                });

                Object.keys(store).forEach((key) => delete store[key]);
                Object.assign(store, nextStore);
            });

        return {
            currentFrameIndex: 0,
            removedFrameIndices: Array.from({ length: numToDelete }, (_, i) => i)
        };
    }

    normalizeFrameIndexMap(rawMap) {
        if (!Array.isArray(rawMap)) return [];

        const normalized = [];
        rawMap.forEach((value) => {
            const frame = Number.parseInt(value, 10);
            if (!Number.isInteger(frame) || frame < 0) return;
            normalized.push(frame);
        });

        if (normalized.length <= 1) {
            return normalized;
        }

        const isMonotonic = normalized.every((value, index) => index === 0 || value > normalized[index - 1]);
        if (isMonotonic) {
            return normalized;
        }

        return Array.from(new Set(normalized)).sort((a, b) => a - b);
    }

    rebuildFrameIndexMap(frameIndicesToKeep) {
        const nextMap = Array.isArray(frameIndicesToKeep) ? frameIndicesToKeep.slice() : [];
        this.series = nextMap.map((sourceFrame, index) => {
            const previous = this.series[index];
            return {
                skeleton: previous?.skeleton || null,
                sourceFrame: Number.isInteger(sourceFrame) ? sourceFrame : index,
                logicalFrame: index
            };
        });
    }

    getFrameIndexMap() {
        return this.series.map((slot, index) => {
            if (!slot) return index;
            return Number.isInteger(slot.sourceFrame) ? slot.sourceFrame : index;
        });
    }

    setFrameIndexMap(newFrameIndexMap) {
        const normalizedMap = this.normalizeFrameIndexMap(newFrameIndexMap);
        if (normalizedMap.length > 0) {
            this.rebuildFrameIndexMap(normalizedMap);
        }
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

        if (start <= end && Number.isFinite(start) && Number.isFinite(end)) {
            this.rebuildFrameIndexMap(Array.from({ length: end - start + 1 }, (_, i) => start + i));
        }
    }

    getMaxFrameIndex() {
        return this.series.length > 0 ? this.series.length - 1 : 0;
    }

    clampFrameIndex(frameIndex) {
        const index = this._toIndex(frameIndex);
        const safeIndex = Number.isInteger(index) ? index : 0;
        return Math.min(Math.max(0, safeIndex), this.getMaxFrameIndex());
    }

    updateMaxFrameIndex(newMaxFrameIndex) {
        const max = Number.parseInt(newMaxFrameIndex, 10);
        if (!Number.isInteger(max) || max < 0) {
            this.series = [];
            return;
        }

        for (let i = 0; i <= max; i++) {
            const slot = this._ensureSlot(i);
            slot.sourceFrame = i;
        }

        this.series.length = max + 1;
    }

    appendFrameSlot() {
        const frameIndexMap = this.getFrameIndexMap();
        const lastSourceFrameIndex = frameIndexMap.length > 0
            ? frameIndexMap[frameIndexMap.length - 1]
            : -1;

        this.series.push({
            skeleton: null,
            sourceFrame: lastSourceFrameIndex + 1,
            logicalFrame: this.series.length
        });
    }

    removeFrameIndices(frameIndices) {
        if (!frameIndices || frameIndices.length === 0) return;

        const sortedIndices = Array.from(new Set(frameIndices))
            .filter((index) => Number.isInteger(index) && index >= 0)
            .sort((a, b) => b - a);

        for (const index of sortedIndices) {
            if (index < this.series.length) {
                this.series.splice(index, 1);
            }
        }
    }

    getSourceFrameIndex(logicalFrameIndex) {
        const idx = this.clampFrameIndex(logicalFrameIndex);
        return this.series[idx]?.sourceFrame;
    }

    findNearestLogicalFrameIndex(sourceFrameIndex) {
        const source = Number.parseInt(sourceFrameIndex, 10);
        const frameIndexMap = this.getFrameIndexMap();
        if (!Number.isInteger(source) || frameIndexMap.length === 0) {
            return 0;
        }

        const exact = frameIndexMap.indexOf(source);
        if (exact !== -1) {
            return exact;
        }

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
        if (frameIndexMap.length === 0) {
            return null;
        }

        return {
            startSourceFrame: frameIndexMap[0],
            endSourceFrame: frameIndexMap[frameIndexMap.length - 1]
        };
    }

    getSkeletonFrameStore() {
        const store = {};
        this.series.forEach((slot, index) => {
            if (slot?.skeleton) {
                store[index] = slot.skeleton;
            }
        });
        return store;
    }

    getSkeletons() {
        return this.series
            .map((slot) => slot?.skeleton)
            .filter(Boolean);
    }
}

window.Series = Series;
window.appSeries = window.appSeries || new Series();
