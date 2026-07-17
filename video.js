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
        this.series = window.appSeries;

        if (!this.series) {
            console.error('Shared Series instance was not found.');
            this.ready = false;
            return;
        }

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
            listener(this.currentFrameIndex, this.series.getMaxFrameIndex());
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
                        this.series.updateMaxFrameIndex(this.getVideoMaxFrameIndex());
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

    applyFrameVisuals() {
        const hasVideo = Boolean(this.video.src);
        const sourceFrameIndex = this.series.getSourceFrameIndex(this.currentFrameIndex);
        const isVideoFrame = hasVideo && Number.isInteger(sourceFrameIndex);

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
        this.currentFrameIndex = this.series.clampFrameIndex(frameIndex);
        this.applyFrameVisuals();
        this.syncCanvasFrame();
    }

    showFrameAt(time) {
        if (!this.video.src) return;

        this.video.pause();
        this.video.currentTime = this.clampTime(time);
        const sourceFrameIndex = Math.round(this.video.currentTime / this.FRAME_STEP);
        this.currentFrameIndex = this.series.findNearestLogicalFrameIndex(sourceFrameIndex);

        this.applyFrameVisuals();
        this.syncCanvasFrame();
    }

    removeFrameIndices(frameIndices) {
        this.series.removeFrameIndices(frameIndices);
        this.currentFrameIndex = this.series.clampFrameIndex(this.currentFrameIndex);
        this.applyFrameVisuals();
        this.emitFrameChange();
    }

    appendFrameSlot() {
        this.series.appendFrameSlot();
        this.emitFrameChange();
    }

    nextFrame() {
        const maxFrameIndex = this.series.getMaxFrameIndex();
        if (this.currentFrameIndex >= maxFrameIndex) {
            this.showFrameIndex(0);
        } else {
            this.showFrameIndex(this.currentFrameIndex + 1);
        }
    }

    prevFrame() {
        const maxFrameIndex = this.series.getMaxFrameIndex();
        if (this.currentFrameIndex <= 0) {
            this.showFrameIndex(maxFrameIndex);
        } else {
            this.showFrameIndex(this.currentFrameIndex - 1);
        }
    }

    playFrames() {
        if (this.playbackTimer !== null) return;

        const maxFrameIndex = this.series.getMaxFrameIndex();
        if (this.currentFrameIndex >= maxFrameIndex) {
            this.playbackDirection = -1;
        } else if (this.currentFrameIndex <= 0) {
            this.playbackDirection = 1;
        }

        this.playbackTimer = setInterval(() => {
            const maxFrameIndex = this.series.getMaxFrameIndex();
            if (maxFrameIndex <= 0) {
                return;
            }

            let nextIndex = this.currentFrameIndex + this.playbackDirection;
            if (nextIndex > maxFrameIndex) {
                this.playbackDirection = -1;
                nextIndex = Math.max(maxFrameIndex - 1, 0);
            } else if (nextIndex < 0) {
                this.playbackDirection = 1;
                nextIndex = Math.min(1, maxFrameIndex);
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
        const frameIndexMap = this.series.getFrameIndexMap();
        return {
            currentFrameIndex: this.currentFrameIndex,
            maxFrameIndex: this.series.getMaxFrameIndex(),
            frameIndexMap,
            frameRange: this.series.getFrameRange(),
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
        return this.series.getFrameIndexMap();
    }

    setFrameIndexMap(newFrameIndexMap) {
        this.series.setFrameIndexMap(newFrameIndexMap);
        this.currentFrameIndex = this.series.clampFrameIndex(this.currentFrameIndex);
        this.applyFrameVisuals();
        this.emitFrameChange();
    }

    setFrameRange(range) {
        this.series.setFrameRange(range, this.getVideoMaxFrameIndex());
        this.currentFrameIndex = this.series.clampFrameIndex(this.currentFrameIndex);
        this.applyFrameVisuals();
        this.emitFrameChange();
    }

    getCurrentFrameIndex() {
        return this.currentFrameIndex;
    }

    getMaxFrameIndex() {
        return this.series.getMaxFrameIndex();
    }

    updateMaxFrameIndex(newMaxFrameIndex) {
        this.series.updateMaxFrameIndex(newMaxFrameIndex);
        this.currentFrameIndex = this.series.clampFrameIndex(this.currentFrameIndex);
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