// videoControls.js

(function () {
    const canvas = document.getElementById('canvas');
    if (!canvas) {
        console.error('Canvas with id="canvas" not found.');
        return;
    }

    // ----- settings -----
    const DEFAULT_FPS = 30;
    const FRAME_STEP = 1 / DEFAULT_FPS;

    // ----- hidden file input -----
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // ----- video behind canvas -----
    const video = document.createElement('video');
    video.id = 'backgroundVideo';
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';

    Object.assign(video.style, {
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

    // make sure canvas stays above video
    Object.assign(canvas.style, {
        position: 'relative',
        zIndex: '1',
        background: 'transparent'
    });

    document.body.prepend(video);

    let currentVideoURL = null;
    let currentVideoFile = null;
    let currentFrameIndex = 0;
    let maxFrameIndex = 0;
    let frameIndexMap = [];
    const frameChangeListeners = new Set();
    const playbackChangeListeners = new Set();
    const PLAYBACK_FPS = 10;
    let playbackTimer = null;
    let framesVisible = true;

    function emitFrameChange() {
        frameChangeListeners.forEach(listener => {
            listener(currentFrameIndex, maxFrameIndex);
        });
    }

    function emitPlaybackChange() {
        const playing = playbackTimer !== null;
        playbackChangeListeners.forEach(listener => {
            listener(playing);
        });
    }

    function syncCanvasFrame() {
        window.appActions?.setCurrentFrame?.(currentFrameIndex);
        emitFrameChange();
    }

    function rebuildFrameIndexMap(frameIndicesToKeep) {
        frameIndexMap = frameIndicesToKeep.slice();
        maxFrameIndex = frameIndexMap.length > 0 ? frameIndexMap.length - 1 : 0;
        currentFrameIndex = clampFrameIndex(currentFrameIndex);
    }

    function openVideoPicker() {
        fileInput.value = '';
        fileInput.click();
    }

    function blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
            reader.readAsDataURL(blob);
        });
    }

    function loadVideoFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('No file provided'));
                return;
            }

            pausePlayback();

            if (currentVideoURL) {
                URL.revokeObjectURL(currentVideoURL);
            }

            currentVideoFile = file;
            currentVideoURL = URL.createObjectURL(file);
            video.src = currentVideoURL;
            video.load();

            video.addEventListener(
                'loadeddata',
                async () => {
                    try {
                        video.pause();
                        currentFrameIndex = 0;
                        rebuildFrameIndexMap(
                            Array.from({ length: getVideoMaxFrameIndex() + 1 }, (_, i) => i)
                        );
                        video.currentTime = 0;
                        applyFrameVisuals();
                        syncCanvasFrame();
                        resolve(); // Resolve when video is ready
                    } catch (err) {
                        console.error('Could not initialize video:', err);
                        reject(err);
                    }
                },
                { once: true }
            );
        });
    }

    function clampTime(t) {
        if (!isFinite(video.duration) || isNaN(video.duration)) {
            return Math.max(0, t);
        }
        return Math.min(Math.max(0, t), video.duration);
    }

    function getVideoMaxFrameIndex() {
        if (!isFinite(video.duration) || isNaN(video.duration)) {
            return 0;
        }

        return Math.floor(video.duration / FRAME_STEP);
    }

    function clampFrameIndex(frameIndex) {
        return Math.min(Math.max(0, frameIndex), maxFrameIndex);
    }

    function applyFrameVisuals() {
        const hasVideo = Boolean(video.src);
        const sourceFrameIndex = frameIndexMap[currentFrameIndex];
        const isVideoFrame = hasVideo && sourceFrameIndex !== undefined;

        if (isVideoFrame) {
            video.style.visibility = framesVisible ? 'visible' : 'hidden';
            video.pause();
            video.currentTime = clampTime(sourceFrameIndex * FRAME_STEP);
            document.body.style.background = '';
        } else {
            video.pause();
            video.style.visibility = 'hidden';
            document.body.style.background = 'black';
        }
    }

    function showFrameIndex(frameIndex) {
        currentFrameIndex = clampFrameIndex(frameIndex);
        applyFrameVisuals();
        syncCanvasFrame();
    }

    function showFrameAt(time) {
        if (!video.src) return;

        video.pause();
        video.currentTime = clampTime(time);
        const sourceFrameIndex = Math.round(video.currentTime / FRAME_STEP);
        const exactLogicalIndex = frameIndexMap.indexOf(sourceFrameIndex);

        if (exactLogicalIndex !== -1) {
            currentFrameIndex = exactLogicalIndex;
        } else if (frameIndexMap.length > 0) {
            let nearestIndex = 0;
            let nearestDistance = Math.abs(frameIndexMap[0] - sourceFrameIndex);

            for (let i = 1; i < frameIndexMap.length; i++) {
                const distance = Math.abs(frameIndexMap[i] - sourceFrameIndex);
                if (distance < nearestDistance) {
                    nearestIndex = i;
                    nearestDistance = distance;
                }
            }

            currentFrameIndex = nearestIndex;
        }

        applyFrameVisuals();
        syncCanvasFrame();
    }

    function removeFrameIndices(frameIndices) {
        if (!frameIndices || frameIndices.length === 0) return;

        const sortedIndices = Array.from(new Set(frameIndices))
            .filter(index => Number.isInteger(index) && index >= 0)
            .sort((a, b) => b - a);

        for (const index of sortedIndices) {
            if (index < frameIndexMap.length) {
                frameIndexMap.splice(index, 1);
            }
        }

        maxFrameIndex = frameIndexMap.length > 0 ? frameIndexMap.length - 1 : 0;
        currentFrameIndex = clampFrameIndex(currentFrameIndex);
        applyFrameVisuals();
        emitFrameChange();
    }

    function appendFrameSlot() {
        const lastSourceFrameIndex = frameIndexMap.length > 0
            ? frameIndexMap[frameIndexMap.length - 1]
            : -1;

        frameIndexMap.push(lastSourceFrameIndex + 1);
        maxFrameIndex = frameIndexMap.length - 1;
        emitFrameChange();
    }

    function nextFrame() {
        if (currentFrameIndex >= maxFrameIndex) {
            showFrameIndex(0);
        } else {
            showFrameIndex(currentFrameIndex + 1);
        }
        window.appActions?.autoCopyPreviousSkeletonIfEmpty?.();
    }

    function prevFrame() {
        if (currentFrameIndex <= 0) {
            showFrameIndex(maxFrameIndex);
        } else {
            showFrameIndex(currentFrameIndex - 1);
        }
    }

    function playFrames() {
        if (playbackTimer !== null) return;

        playbackTimer = setInterval(() => {
            if (currentFrameIndex >= maxFrameIndex) {
                showFrameIndex(0);
                return;
            }

            showFrameIndex(currentFrameIndex + 1);
        }, 1000 / PLAYBACK_FPS);

        emitPlaybackChange();
    }

    function pausePlayback() {
        if (playbackTimer === null) return;

        clearInterval(playbackTimer);
        playbackTimer = null;
        emitPlaybackChange();
    }

    function togglePlayback() {
        if (playbackTimer === null) {
            playFrames();
        } else {
            pausePlayback();
        }
    }

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        loadVideoFile(file)?.catch(err => {
            console.error('Failed to load video file:', err);
        });
    });

    async function getSerializableState() {
        return {
            currentFrameIndex,
            maxFrameIndex,
            frameIndexMap: frameIndexMap.slice(),
            frameRange: frameIndexMap.length > 0
                ? {
                    startSourceFrame: frameIndexMap[0],
                    endSourceFrame: frameIndexMap[frameIndexMap.length - 1]
                }
                : null,
            video: currentVideoFile
                ? {
                    name: currentVideoFile.name,
                    type: currentVideoFile.type,
                    dataURL: await blobToDataURL(currentVideoFile)
                }
                : null
        };
    }

    window.videoControls = {
        openVideoPicker,
        loadVideoFile,
        getSerializableState,
        getFrameIndexMap: () => frameIndexMap.slice(),
        setFrameIndexMap: (newFrameIndexMap) => {
            if (Array.isArray(newFrameIndexMap) && newFrameIndexMap.length > 0) {
                frameIndexMap = newFrameIndexMap.slice();
                maxFrameIndex = frameIndexMap.length - 1;
                currentFrameIndex = clampFrameIndex(currentFrameIndex);
                applyFrameVisuals();
                emitFrameChange();
            }
        },
        setFrameRange: (range) => {
            if (range && range.startSourceFrame !== undefined && range.endSourceFrame !== undefined) {
                const maxValidFrame = getVideoMaxFrameIndex();
                const start = Math.max(0, range.startSourceFrame);
                const end = Math.min(maxValidFrame, range.endSourceFrame);
                if (start <= end) {
                    frameIndexMap = Array.from({ length: end - start + 1 }, (_, i) => start + i);
                    maxFrameIndex = frameIndexMap.length - 1;
                    currentFrameIndex = clampFrameIndex(currentFrameIndex);
                    applyFrameVisuals();
                    emitFrameChange();
                }
            }
        },
        nextFrame,
        prevFrame,
        playFrames,
        pausePlayback,
        togglePlayback,
        isPlaying: () => playbackTimer !== null,
        showFrameAt,
        showFrameIndex,
        getCurrentFrameIndex: () => currentFrameIndex,
        getMaxFrameIndex: () => maxFrameIndex,
        appendFrameSlot,
        removeFrameIndices,
        updateMaxFrameIndex: (newMaxFrameIndex) => {
            frameIndexMap = Array.from({ length: newMaxFrameIndex + 1 }, (_, i) => i);
            maxFrameIndex = newMaxFrameIndex;
            currentFrameIndex = clampFrameIndex(currentFrameIndex);
            applyFrameVisuals();
            emitFrameChange();
        },
        onFrameChange: (listener) => {
            frameChangeListeners.add(listener);
            return () => frameChangeListeners.delete(listener);
        },
        onPlaybackChange: (listener) => {
            playbackChangeListeners.add(listener);
            return () => playbackChangeListeners.delete(listener);
        },
        setFramesVisible: (visible) => {
            framesVisible = Boolean(visible);
            applyFrameVisuals();
        },
        getFramesVisible: () => framesVisible,
        video
    };
})();