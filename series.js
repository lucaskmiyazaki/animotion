class Series {
    constructor() {
        // Frame-indexed skeleton store: { [frameIndex]: Skeleton }
        this.frames = {};

        // Logical frame index -> source video frame index.
        this.frameIndexMap = [];
        this.maxFrameIndex = 0;
    }

    getFrame(frameIndex) {
        const index = Number.parseInt(frameIndex, 10);
        if (!Number.isInteger(index)) return null;
        return this.frames[index] || null;
    }

    ensureFrame(frameIndex) {
        const index = Number.parseInt(frameIndex, 10);
        if (!Number.isInteger(index)) return null;
        if (!this.frames[index]) {
            this.frames[index] = new Skeleton();
        }
        return this.frames[index];
    }

    setFrame(frameIndex, skeleton) {
        const index = Number.parseInt(frameIndex, 10);
        if (!Number.isInteger(index)) return null;
        this.frames[index] = skeleton;
        return skeleton;
    }

    deleteFrame(frameIndex) {
        const index = Number.parseInt(frameIndex, 10);
        if (!Number.isInteger(index)) return;
        delete this.frames[index];
    }

    getFrameIndices() {
        return Object.keys(this.frames)
            .map((k) => Number.parseInt(k, 10))
            .filter(Number.isInteger)
            .sort((a, b) => a - b);
    }

    getLastFrameWithPoints() {
        const indices = this.getFrameIndices()
            .filter((idx) => this.frames[idx]?.points?.length > 0)
            .sort((a, b) => b - a);
        return indices.length > 0 ? indices[0] : -1;
    }

    getStoredFrameIndices(extraStores = []) {
        const allKeys = new Set(Object.keys(this.frames));

        extraStores.forEach((store) => {
            if (!store || typeof store !== 'object') return;
            Object.keys(store).forEach((key) => allKeys.add(key));
        });

        this.frameIndexMap.forEach((_, index) => {
            allKeys.add(String(index));
        });

        return Array.from(allKeys)
            .map((k) => Number.parseInt(k, 10))
            .filter(Number.isInteger)
            .sort((a, b) => b - a);
    }

    removeFrameAndShift(frameIndex, extraStores = []) {
        const target = Number.parseInt(frameIndex, 10);
        if (!Number.isInteger(target)) return;

        const stores = [this.frames, ...extraStores.filter((s) => s && typeof s === 'object')];
        const indices = this.getStoredFrameIndices(extraStores);
        const hasOwn = (store, index) => Object.prototype.hasOwnProperty.call(store, index);

        for (const index of indices) {
            if (index < target) continue;

            if (index === target) {
                stores.forEach((store) => {
                    delete store[index];
                });
                continue;
            }

            stores.forEach((store) => {
                if (hasOwn(store, index)) {
                    store[index - 1] = store[index];
                } else {
                    delete store[index - 1];
                }
                delete store[index];
            });
        }

        this.removeFrameIndices([target]);
    }

    compactToFramesWithPoints(currentFrameIndex, extraStores = [], maxFrameIndex = -1) {
        const stores = extraStores.filter((s) => s && typeof s === 'object');
        const currentMaxFrame = Math.max(
            ...Object.keys(this.frames).map((k) => Number.parseInt(k, 10)),
            ...stores.flatMap((store) => Object.keys(store).map((k) => Number.parseInt(k, 10))),
            this.getMaxFrameIndex(),
            Number.isInteger(maxFrameIndex) ? maxFrameIndex : -1,
            -1
        );

        if (currentMaxFrame < 0) {
            this.frameIndexMap = [];
            this.maxFrameIndex = 0;
            return { currentFrameIndex: 0, removedFrameIndices: [] };
        }

        const framesWithPoints = [];
        for (let i = 0; i <= currentMaxFrame; i++) {
            const skeleton = this.frames[i];
            if (skeleton && skeleton.points.length > 0) {
                framesWithPoints.push(i);
            }
        }

        if (framesWithPoints.length === 0) {
            this.frameIndexMap = [];
            this.maxFrameIndex = 0;
            return { currentFrameIndex: 0, removedFrameIndices: [] };
        }

        const indexMap = {};
        framesWithPoints.forEach((oldIdx, newIdx) => {
            indexMap[oldIdx] = newIdx;
        });

        const remapStore = (store) => {
            const nextStore = {};
            Object.keys(store).forEach((oldIdx) => {
                const newIdx = indexMap[oldIdx];
                if (newIdx !== undefined) {
                    nextStore[newIdx] = store[oldIdx];
                }
            });

            for (let i = 0; i <= currentMaxFrame; i++) {
                delete store[i];
            }
            Object.assign(store, nextStore);
        };

        remapStore(this.frames);
        stores.forEach(remapStore);

        this.frameIndexMap = framesWithPoints.map((oldIdx) => {
            const source = this.getSourceFrameIndex(oldIdx);
            return Number.isInteger(source) ? source : oldIdx;
        });
        this.maxFrameIndex = this.frameIndexMap.length > 0 ? this.frameIndexMap.length - 1 : 0;

        const removedFrameIndices = [];
        for (let i = 0; i <= currentMaxFrame; i++) {
            if (!framesWithPoints.includes(i)) {
                removedFrameIndices.push(i);
            }
        }

        return {
            currentFrameIndex: indexMap[currentFrameIndex] !== undefined ? indexMap[currentFrameIndex] : 0,
            removedFrameIndices
        };
    }

    deleteLeadingEmptyFrames(currentFrameIndex, extraStores = []) {
        const current = Number.parseInt(currentFrameIndex, 10);
        if (!Number.isInteger(current) || current <= 0) {
            return { currentFrameIndex: Number.isInteger(current) ? current : 0, removedFrameIndices: [] };
        }

        for (let i = 0; i < current; i++) {
            const skeleton = this.frames[i];
            if (skeleton && skeleton.points.length > 0) {
                return { currentFrameIndex: current, removedFrameIndices: [] };
            }
        }

        const numToDelete = current;
        const stores = [this.frames, ...extraStores.filter((s) => s && typeof s === 'object')];
        const allIndices = this.getStoredFrameIndices(extraStores);

        for (const idx of allIndices) {
            if (idx >= numToDelete) {
                const newIdx = idx - numToDelete;
                stores.forEach((store) => {
                    if (Object.prototype.hasOwnProperty.call(store, idx)) {
                        store[newIdx] = store[idx];
                        delete store[idx];
                    }
                });
            } else {
                stores.forEach((store) => {
                    delete store[idx];
                });
            }
        }

        this.removeFrameIndices(Array.from({ length: numToDelete }, (_, i) => i));

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
        this.frameIndexMap = Array.isArray(frameIndicesToKeep) ? frameIndicesToKeep.slice() : [];
        this.maxFrameIndex = this.frameIndexMap.length > 0 ? this.frameIndexMap.length - 1 : 0;
    }

    getFrameIndexMap() {
        return this.frameIndexMap.slice();
    }

    setFrameIndexMap(newFrameIndexMap) {
        const normalizedMap = this.normalizeFrameIndexMap(newFrameIndexMap);
        if (normalizedMap.length > 0) {
            this.frameIndexMap = normalizedMap;
            this.maxFrameIndex = this.frameIndexMap.length - 1;
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
            this.frameIndexMap = Array.from({ length: end - start + 1 }, (_, i) => start + i);
            this.maxFrameIndex = this.frameIndexMap.length - 1;
        }
    }

    getMaxFrameIndex() {
        return this.maxFrameIndex;
    }

    clampFrameIndex(frameIndex) {
        const index = Number.parseInt(frameIndex, 10);
        const safeIndex = Number.isInteger(index) ? index : 0;
        return Math.min(Math.max(0, safeIndex), this.maxFrameIndex);
    }

    updateMaxFrameIndex(newMaxFrameIndex) {
        const max = Number.parseInt(newMaxFrameIndex, 10);
        if (!Number.isInteger(max) || max < 0) {
            this.frameIndexMap = [];
            this.maxFrameIndex = 0;
            return;
        }

        this.frameIndexMap = Array.from({ length: max + 1 }, (_, i) => i);
        this.maxFrameIndex = max;
    }

    appendFrameSlot() {
        const lastSourceFrameIndex = this.frameIndexMap.length > 0
            ? this.frameIndexMap[this.frameIndexMap.length - 1]
            : -1;

        this.frameIndexMap.push(lastSourceFrameIndex + 1);
        this.maxFrameIndex = this.frameIndexMap.length - 1;
    }

    removeFrameIndices(frameIndices) {
        if (!frameIndices || frameIndices.length === 0) return;

        const sortedIndices = Array.from(new Set(frameIndices))
            .filter((index) => Number.isInteger(index) && index >= 0)
            .sort((a, b) => b - a);

        for (const index of sortedIndices) {
            if (index < this.frameIndexMap.length) {
                this.frameIndexMap.splice(index, 1);
            }
        }

        this.maxFrameIndex = this.frameIndexMap.length > 0 ? this.frameIndexMap.length - 1 : 0;
    }

    getSourceFrameIndex(logicalFrameIndex) {
        const idx = this.clampFrameIndex(logicalFrameIndex);
        return this.frameIndexMap[idx];
    }

    findNearestLogicalFrameIndex(sourceFrameIndex) {
        const source = Number.parseInt(sourceFrameIndex, 10);
        if (!Number.isInteger(source) || this.frameIndexMap.length === 0) {
            return 0;
        }

        const exact = this.frameIndexMap.indexOf(source);
        if (exact !== -1) {
            return exact;
        }

        let nearestIndex = 0;
        let nearestDistance = Math.abs(this.frameIndexMap[0] - source);
        for (let i = 1; i < this.frameIndexMap.length; i++) {
            const distance = Math.abs(this.frameIndexMap[i] - source);
            if (distance < nearestDistance) {
                nearestIndex = i;
                nearestDistance = distance;
            }
        }

        return nearestIndex;
    }

    getFrameRange() {
        if (this.frameIndexMap.length === 0) {
            return null;
        }

        return {
            startSourceFrame: this.frameIndexMap[0],
            endSourceFrame: this.frameIndexMap[this.frameIndexMap.length - 1]
        };
    }
}

window.Series = Series;
window.appSeries = window.appSeries || new Series();
