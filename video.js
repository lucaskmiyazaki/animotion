// videoControls.js

class video {
    constructor(canvasId = 'canvas') {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error(`Canvas with id="${canvasId}" not found.`);
            this.ready = false;
            return;
        }

        this.DEFAULT_FPS = 30;
        this.FRAME_STEP = 1 / this.DEFAULT_FPS;
        this.PLAYBACK_FPS = 10;

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = 'video/*';
        this.fileInput.style.display = 'none';
        document.body.appendChild(this.fileInput);

        this.video = document.createElement('video');
        this.video.id = 'backgroundVideo';
        this.video.playsInline = true;
        this.video.muted = true;
        this.video.preload = 'auto';

        Object.assign(this.video.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            objectFit: 'contain',
            zIndex: '0',
            background: 'black',
            pointerEvents: 'none'
        });

        Object.assign(this.canvas.style, {
            position: 'relative',
            zIndex: '1',
            background: 'transparent'
        });

        document.body.prepend(this.video);

        this.currentVideoURL = null;
        this.currentVideoFile = null;
        this.currentFrameIndex = 0;
        this.maxFrameIndex = 0;
        this.frameIndexMap = [];
        this.frameChangeListeners = new Set();
        this.playbackChangeListeners = new Set();
        this.playbackTimer = null;
        this.playbackDirection = 1;
        this.framesVisible = true;

        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            this.loadVideoFile(file)?.catch((err) => {
                console.error('Failed to load video file:', err);
            });
        });

        this.ready = true;
    }

    emitFrameChange() {
        this.frameChangeListeners.forEach((listener) => {
            listener(this.currentFrameIndex, this.maxFrameIndex);
        });
    }

    emitPlaybackChange() {
        const playing = this.playbackTimer !== null;
        this.playbackChangeListeners.forEach((listener) => {
            listener(playing);
        });
    }

    syncCanvasFrame() {
        window.appActions?.setCurrentFrame?.(this.currentFrameIndex);
        this.emitFrameChange();
    }

    rebuildFrameIndexMap(frameIndicesToKeep) {
        this.frameIndexMap = frameIndicesToKeep.slice();
        this.maxFrameIndex = this.frameIndexMap.length > 0 ? this.frameIndexMap.length - 1 : 0;
        this.currentFrameIndex = this.clampFrameIndex(this.currentFrameIndex);
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

        const uniqueSorted = Array.from(new Set(normalized)).sort((a, b) => a - b);
        return uniqueSorted;
    }

    openVideoPicker() {
        this.fileInput.value = '';
        this.fileInput.click();
    }

    blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
            reader.readAsDataURL(blob);
        });
    }

    loadVideoFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('No file provided'));
                return;
            }

            this.pausePlayback();

            if (this.currentVideoURL) {
                URL.revokeObjectURL(this.currentVideoURL);
            }

            this.currentVideoFile = file;
            this.currentVideoURL = URL.createObjectURL(file);
            this.video.src = this.currentVideoURL;
            this.video.load();

            this.video.addEventListener(
                'loadeddata',
                () => {
                    try {
                        this.video.pause();
                        this.currentFrameIndex = 0;
                        this.rebuildFrameIndexMap(
                            Array.from({ length: this.getVideoMaxFrameIndex() + 1 }, (_, i) => i)
                        );
                        this.video.currentTime = 0;
                        this.applyFrameVisuals();
                        this.syncCanvasFrame();
                        resolve();
                    } catch (err) {
                        console.error('Could not initialize video:', err);
                        reject(err);
                    }
                },
                { once: true }
            );
        });
    }

    clampTime(t) {
        if (!isFinite(this.video.duration) || isNaN(this.video.duration)) {
            return Math.max(0, t);
        }
        return Math.min(Math.max(0, t), this.video.duration);
    }

    getVideoMaxFrameIndex() {
        if (!isFinite(this.video.duration) || isNaN(this.video.duration)) {
            return 0;
        }

        return Math.floor(this.video.duration / this.FRAME_STEP);
    }

    clampFrameIndex(frameIndex) {
        return Math.min(Math.max(0, frameIndex), this.maxFrameIndex);
    }

    applyFrameVisuals() {
        const hasVideo = Boolean(this.video.src);
        const sourceFrameIndex = this.frameIndexMap[this.currentFrameIndex];
        const isVideoFrame = hasVideo && sourceFrameIndex !== undefined;

        if (isVideoFrame) {
            this.video.style.visibility = this.framesVisible ? 'visible' : 'hidden';
            this.video.pause();
            this.video.currentTime = this.clampTime(sourceFrameIndex * this.FRAME_STEP);
            document.body.style.background = '';
        } else {
            this.video.pause();
            this.video.style.visibility = 'hidden';
            document.body.style.background = 'black';
        }
    }

    showFrameIndex(frameIndex) {
        this.currentFrameIndex = this.clampFrameIndex(frameIndex);
        this.applyFrameVisuals();
        this.syncCanvasFrame();
    }

    showFrameAt(time) {
        if (!this.video.src) return;

        this.video.pause();
        this.video.currentTime = this.clampTime(time);
        const sourceFrameIndex = Math.round(this.video.currentTime / this.FRAME_STEP);
        const exactLogicalIndex = this.frameIndexMap.indexOf(sourceFrameIndex);

        if (exactLogicalIndex !== -1) {
            this.currentFrameIndex = exactLogicalIndex;
        } else if (this.frameIndexMap.length > 0) {
            let nearestIndex = 0;
            let nearestDistance = Math.abs(this.frameIndexMap[0] - sourceFrameIndex);

            for (let i = 1; i < this.frameIndexMap.length; i++) {
                const distance = Math.abs(this.frameIndexMap[i] - sourceFrameIndex);
                if (distance < nearestDistance) {
                    nearestIndex = i;
                    nearestDistance = distance;
                }
            }

            this.currentFrameIndex = nearestIndex;
        }

        this.applyFrameVisuals();
        this.syncCanvasFrame();
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
        this.currentFrameIndex = this.clampFrameIndex(this.currentFrameIndex);
        this.applyFrameVisuals();
        this.emitFrameChange();
    }

    appendFrameSlot() {
        const lastSourceFrameIndex = this.frameIndexMap.length > 0
            ? this.frameIndexMap[this.frameIndexMap.length - 1]
            : -1;

        this.frameIndexMap.push(lastSourceFrameIndex + 1);
        this.maxFrameIndex = this.frameIndexMap.length - 1;
        this.emitFrameChange();
    }

    nextFrame() {
        if (this.currentFrameIndex >= this.maxFrameIndex) {
            this.showFrameIndex(0);
        } else {
            this.showFrameIndex(this.currentFrameIndex + 1);
        }
    }

    prevFrame() {
        if (this.currentFrameIndex <= 0) {
            this.showFrameIndex(this.maxFrameIndex);
        } else {
            this.showFrameIndex(this.currentFrameIndex - 1);
        }
    }

    playFrames() {
        if (this.playbackTimer !== null) return;

        if (this.currentFrameIndex >= this.maxFrameIndex) {
            this.playbackDirection = -1;
        } else if (this.currentFrameIndex <= 0) {
            this.playbackDirection = 1;
        }

        this.playbackTimer = setInterval(() => {
            if (this.maxFrameIndex <= 0) {
                return;
            }

            let nextIndex = this.currentFrameIndex + this.playbackDirection;
            if (nextIndex > this.maxFrameIndex) {
                this.playbackDirection = -1;
                nextIndex = Math.max(this.maxFrameIndex - 1, 0);
            } else if (nextIndex < 0) {
                this.playbackDirection = 1;
                nextIndex = Math.min(1, this.maxFrameIndex);
            }

            this.showFrameIndex(nextIndex);
        }, 1000 / this.PLAYBACK_FPS);

        this.emitPlaybackChange();
    }

    pausePlayback() {
        if (this.playbackTimer === null) return;

        clearInterval(this.playbackTimer);
        this.playbackTimer = null;
        this.emitPlaybackChange();
    }

    togglePlayback() {
        if (this.playbackTimer === null) {
            this.playFrames();
        } else {
            this.pausePlayback();
        }
    }

    async getSerializableState() {
        return {
            currentFrameIndex: this.currentFrameIndex,
            maxFrameIndex: this.maxFrameIndex,
            frameIndexMap: this.frameIndexMap.slice(),
            frameRange: this.frameIndexMap.length > 0
                ? {
                    startSourceFrame: this.frameIndexMap[0],
                    endSourceFrame: this.frameIndexMap[this.frameIndexMap.length - 1]
                }
                : null,
            video: this.currentVideoFile
                ? {
                    name: this.currentVideoFile.name,
                    type: this.currentVideoFile.type,
                    dataURL: await this.blobToDataURL(this.currentVideoFile)
                }
                : null
        };
    }

    getFrameIndexMap() {
        return this.frameIndexMap.slice();
    }

    setFrameIndexMap(newFrameIndexMap) {
        const normalizedMap = this.normalizeFrameIndexMap(newFrameIndexMap);
        if (normalizedMap.length > 0) {
            this.frameIndexMap = normalizedMap;
            this.maxFrameIndex = this.frameIndexMap.length - 1;
            this.currentFrameIndex = this.clampFrameIndex(this.currentFrameIndex);
            this.applyFrameVisuals();
            this.emitFrameChange();
        }
    }

    setFrameRange(range) {
        if (range && range.startSourceFrame !== undefined && range.endSourceFrame !== undefined) {
            const maxValidFrame = this.getVideoMaxFrameIndex();
            const start = Math.max(0, range.startSourceFrame);
            const end = Math.min(maxValidFrame, range.endSourceFrame);
            if (start <= end) {
                this.frameIndexMap = Array.from({ length: end - start + 1 }, (_, i) => start + i);
                this.maxFrameIndex = this.frameIndexMap.length - 1;
                this.currentFrameIndex = this.clampFrameIndex(this.currentFrameIndex);
                this.applyFrameVisuals();
                this.emitFrameChange();
            }
        }
    }

    getCurrentFrameIndex() {
        return this.currentFrameIndex;
    }

    getMaxFrameIndex() {
        return this.maxFrameIndex;
    }

    updateMaxFrameIndex(newMaxFrameIndex) {
        this.frameIndexMap = Array.from({ length: newMaxFrameIndex + 1 }, (_, i) => i);
        this.maxFrameIndex = newMaxFrameIndex;
        this.currentFrameIndex = this.clampFrameIndex(this.currentFrameIndex);
        this.applyFrameVisuals();
        this.emitFrameChange();
    }

    onFrameChange(listener) {
        this.frameChangeListeners.add(listener);
        return () => this.frameChangeListeners.delete(listener);
    }

    onPlaybackChange(listener) {
        this.playbackChangeListeners.add(listener);
        return () => this.playbackChangeListeners.delete(listener);
    }

    setFramesVisible(visible) {
        this.framesVisible = Boolean(visible);
        this.applyFrameVisuals();
    }

    getFramesVisible() {
        return this.framesVisible;
    }
}

(function () {
    const controller = new video('canvas');
    if (!controller.ready) return;

    window.videoControls = {
        openVideoPicker: () => controller.openVideoPicker(),
        loadVideoFile: (file) => controller.loadVideoFile(file),
        getSerializableState: () => controller.getSerializableState(),
        getFrameIndexMap: () => controller.getFrameIndexMap(),
        setFrameIndexMap: (newFrameIndexMap) => controller.setFrameIndexMap(newFrameIndexMap),
        setFrameRange: (range) => controller.setFrameRange(range),
        nextFrame: () => controller.nextFrame(),
        prevFrame: () => controller.prevFrame(),
        playFrames: () => controller.playFrames(),
        pausePlayback: () => controller.pausePlayback(),
        togglePlayback: () => controller.togglePlayback(),
        isPlaying: () => controller.playbackTimer !== null,
        showFrameAt: (time) => controller.showFrameAt(time),
        showFrameIndex: (frameIndex) => controller.showFrameIndex(frameIndex),
        getCurrentFrameIndex: () => controller.getCurrentFrameIndex(),
        getMaxFrameIndex: () => controller.getMaxFrameIndex(),
        appendFrameSlot: () => controller.appendFrameSlot(),
        removeFrameIndices: (frameIndices) => controller.removeFrameIndices(frameIndices),
        updateMaxFrameIndex: (newMaxFrameIndex) => controller.updateMaxFrameIndex(newMaxFrameIndex),
        onFrameChange: (listener) => controller.onFrameChange(listener),
        onPlaybackChange: (listener) => controller.onPlaybackChange(listener),
        setFramesVisible: (visible) => controller.setFramesVisible(visible),
        getFramesVisible: () => controller.getFramesVisible(),
        video: controller.video
    };
})();