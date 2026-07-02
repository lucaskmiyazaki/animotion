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
    let currentFrameIndex = 0;
    let maxFrameIndex = 0;
    const frameChangeListeners = new Set();
    const playbackChangeListeners = new Set();
    const PLAYBACK_FPS = 10;
    let playbackTimer = null;

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

    function openVideoPicker() {
        fileInput.value = '';
        fileInput.click();
    }

    function loadVideoFile(file) {
        if (!file) return;

        pausePlayback();

        if (currentVideoURL) {
            URL.revokeObjectURL(currentVideoURL);
        }

        currentVideoURL = URL.createObjectURL(file);
        video.src = currentVideoURL;
        video.load();

        video.addEventListener(
            'loadeddata',
            async () => {
                try {
                    video.pause();
                    currentFrameIndex = 0;
                    maxFrameIndex = getVideoMaxFrameIndex();
                    video.currentTime = 0;
                    applyFrameVisuals();
                    syncCanvasFrame();
                } catch (err) {
                    console.error('Could not initialize video:', err);
                }
            },
            { once: true }
        );
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
        const videoMaxFrame = getVideoMaxFrameIndex();
        const isVideoFrame = hasVideo && currentFrameIndex <= videoMaxFrame;

        if (isVideoFrame) {
            video.style.visibility = 'visible';
            video.pause();
            video.currentTime = clampTime(currentFrameIndex * FRAME_STEP);
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
        currentFrameIndex = Math.round(video.currentTime / FRAME_STEP);
        if (currentFrameIndex > maxFrameIndex) {
            maxFrameIndex = currentFrameIndex;
        }
        applyFrameVisuals();
        syncCanvasFrame();
    }

    function nextFrame() {
        if (currentFrameIndex >= maxFrameIndex) {
            maxFrameIndex += 1;
        }
        showFrameIndex(currentFrameIndex + 1);
        window.appActions?.autoCopyPreviousSkeletonIfEmpty?.();
    }

    function prevFrame() {
        showFrameIndex(currentFrameIndex - 1);
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
        loadVideoFile(file);
    });

    window.videoControls = {
        openVideoPicker,
        loadVideoFile,
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
        onFrameChange: (listener) => {
            frameChangeListeners.add(listener);
            return () => frameChangeListeners.delete(listener);
        },
        onPlaybackChange: (listener) => {
            playbackChangeListeners.add(listener);
            return () => playbackChangeListeners.delete(listener);
        },
        video
    };
})();