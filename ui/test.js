class Test {
    constructor(canvasId = 'canvas') {
        this.canvas = document.getElementById(canvasId);
        this.FRAME_STEP = 1 / 30;
        this.PLAYBACK_FPS = 10;
        this.enabled = false;
        this.currentFrameIndex = 0;
        this.maxFrameIndex = 0;
        this.playbackTimer = null;
        this.playbackDirection = 1;
        this.currentVideoURL = null;
        this.currentVideoFile = null;
        this.videoChangeListeners = new Set();
        this.frameChangeListeners = new Set();
        this.playbackChangeListeners = new Set();
        this.enabledChangeListeners = new Set();
        this.markerCache = new Map();
        this.trackedMarkerCache = new Map();
        this.nextMarkerId = 0;
        this.firstPointSelectionActive = false;
        this.selectionChangeListeners = new Set();
        this.detectionRequestId = 0;

        if (!this.canvas) {
            console.error('Test video canvas was not found.');
            this.ready = false;
            return;
        }

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = 'video/*';
        this.fileInput.style.display = 'none';
        document.body.appendChild(this.fileInput);

        this.video = document.createElement('video');
        this.video.id = 'testVideo';
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
            zIndex: '1',
            background: 'black',
            pointerEvents: 'none',
            opacity: '0',
            visibility: 'hidden'
        });

        this.canvas.style.zIndex = '2';

        document.body.insertBefore(this.video, this.canvas);

        this.alignedCanvas = document.createElement('canvas');
        this.alignedCanvas.id = 'alignedTestVideoCanvas';
        Object.assign(this.alignedCanvas.style, {
            position: 'fixed',
            inset: '0',
            width: '100vw',
            height: '100vh',
            zIndex: '1',
            background: 'transparent',
            pointerEvents: 'none',
            visibility: 'hidden'
        });
        document.body.insertBefore(this.alignedCanvas, this.canvas);
        this.alignedContext = this.alignedCanvas.getContext('2d');

        this.markerCanvas = document.createElement('canvas');
        this.markerCanvas.id = 'testMarkerCanvas';
        Object.assign(this.markerCanvas.style, {
            position: 'fixed',
            inset: '0',
            width: '100vw',
            height: '100vh',
            zIndex: '3',
            background: 'transparent',
            pointerEvents: 'none'
        });
        document.body.insertBefore(this.markerCanvas, this.canvas.nextSibling);
        this.markerContext = this.markerCanvas.getContext('2d');
        this.markerCanvas.addEventListener('click', (event) => {
            this.selectFirstMarkerAt(event.clientX, event.clientY);
        });

        this.processingCanvas = document.createElement('canvas');
        this.processingContext = this.processingCanvas.getContext('2d', {
            willReadFrequently: true
        });

        this.resizeMarkerCanvas = () => {
            const dpr = window.devicePixelRatio || 1;
            this.alignedCanvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
            this.alignedCanvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
            this.markerCanvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
            this.markerCanvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
            this.markerContext.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.renderAlignedFrame();
            this.drawMarkers(this.getDisplayMarkers(this.currentFrameIndex));
        };
        window.addEventListener('resize', this.resizeMarkerCanvas);
        this.resizeMarkerCanvas();

        this.fileInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            this.loadVideoFile(file)?.catch((error) => {
                console.error('Failed to load test video file:', error);
            });
        });

        this.ready = true;
    }

    openVideoPicker() {
        this.fileInput.value = '';
        this.fileInput.click();
    }

    loadVideoFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('No file provided'));
                return;
            }

            this.pausePlayback();
            const previousVideoURL = this.currentVideoURL;
            const candidateVideoURL = URL.createObjectURL(file);

            const cleanup = () => {
                this.video.removeEventListener('loadeddata', handleLoadedData);
                this.video.removeEventListener('error', handleError);
            };

            const handleLoadedData = () => {
                cleanup();
                if (previousVideoURL) {
                    URL.revokeObjectURL(previousVideoURL);
                }
                this.currentVideoFile = file;
                this.currentVideoURL = candidateVideoURL;
                this.video.pause();
                const duration = Number(this.video.duration);
                const testMaxFrameIndex = Number.isFinite(duration)
                    ? Math.floor(duration / this.FRAME_STEP)
                    : 0;
                this.maxFrameIndex = testMaxFrameIndex;
                this.currentFrameIndex = 0;
                this.markerCache.clear();
                this.resetMarkerTracking();
                this.showFrameIndex(0);
                this.emitVideoChange();
                resolve();
            };

            const handleError = () => {
                cleanup();
                const mediaErrorCode = this.video.error?.code;
                URL.revokeObjectURL(candidateVideoURL);
                if (previousVideoURL) {
                    this.video.src = previousVideoURL;
                    this.video.addEventListener('loadeddata', () => {
                        this.showFrameIndex(this.currentFrameIndex);
                    }, { once: true });
                    this.video.load();
                } else {
                    this.video.removeAttribute('src');
                    this.video.load();
                    this.currentVideoFile = null;
                    this.currentVideoURL = null;
                    this.maxFrameIndex = 0;
                    this.currentFrameIndex = 0;
                    this.markerCache.clear();
                    this.resetMarkerTracking();
                    this.showFrameIndex(0);
                }
                this.emitVideoChange();
                reject(new Error(
                    mediaErrorCode === 4
                        ? 'This video format or codec is not supported by the browser.'
                        : 'Could not decode the test video.'
                ));
            };

            this.video.addEventListener('loadeddata', handleLoadedData);
            this.video.addEventListener('error', handleError);
            this.video.src = candidateVideoURL;
            this.video.load();
        });
    }

    showFrameIndex(frameIndex) {
        const hasVideo = this.hasVideo();
        const parsedFrameIndex = Number.parseInt(frameIndex, 10);
        this.currentFrameIndex = Number.isInteger(parsedFrameIndex)
            ? Math.min(Math.max(0, parsedFrameIndex), this.maxFrameIndex)
            : 0;

        this.video.pause();
        this.video.style.opacity = hasVideo ? '0.5' : '0';
        this.updateVideoLayerVisibility();
        if (!hasVideo) {
            this.renderAlignedFrame();
            this.drawMarkers([]);
            this.emitFrameChange();
            return;
        }

        const targetTime = this.currentFrameIndex * this.FRAME_STEP;
        const duration = Number(this.video.duration);
        this.video.currentTime = Number.isFinite(duration)
            ? Math.min(Math.max(0, targetTime), duration)
            : Math.max(0, targetTime);
        this.scheduleMarkerDetection(this.currentFrameIndex);
        this.emitFrameChange();
    }

    scheduleMarkerDetection(frameIndex) {
        const requestId = ++this.detectionRequestId;
        const cachedCentroids = this.markerCache.get(frameIndex);
        if (cachedCentroids) {
            this.trackFrameMarkers(frameIndex, cachedCentroids);
            this.drawMarkers(this.getDisplayMarkers(frameIndex));
            const renderCachedFrame = () => {
                if (requestId !== this.detectionRequestId || frameIndex !== this.currentFrameIndex) return;
                if (this.video.seeking) {
                    this.video.addEventListener('seeked', renderCachedFrame, { once: true });
                    return;
                }
                this.renderAlignedFrame();
            };
            renderCachedFrame();
            return;
        }

        this.drawMarkers([]);
        let completed = false;
        let waitingForSeek = false;
        const detectCurrentFrame = () => {
            if (
                completed ||
                requestId !== this.detectionRequestId ||
                frameIndex !== this.currentFrameIndex
            ) return;
            if (this.video.seeking) {
                if (!waitingForSeek) {
                    waitingForSeek = true;
                    this.video.addEventListener('seeked', detectCurrentFrame, { once: true });
                }
                return;
            }
            completed = true;
            const centroids = this.detectGreenMarkerCentroids();
            this.markerCache.set(frameIndex, centroids);
            this.trackFrameMarkers(frameIndex, centroids);
            this.renderAlignedFrame();
            this.drawMarkers(this.getDisplayMarkers(frameIndex));
        };

        if (this.video.seeking) {
            waitingForSeek = true;
            this.video.addEventListener('seeked', detectCurrentFrame, { once: true });
        } else {
            requestAnimationFrame(detectCurrentFrame);
        }

        setTimeout(detectCurrentFrame, 80);
    }

    detectGreenMarkerCentroids() {
        const sourceWidth = this.video.videoWidth;
        const sourceHeight = this.video.videoHeight;
        if (!sourceWidth || !sourceHeight || !this.processingContext) return [];

        const scale = Math.min(1, 640 / sourceWidth);
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        this.processingCanvas.width = width;
        this.processingCanvas.height = height;
        this.processingContext.drawImage(this.video, 0, 0, width, height);

        const pixels = this.processingContext.getImageData(0, 0, width, height).data;
        const mask = new Uint8Array(width * height);
        for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
            const offset = pixelIndex * 4;
            const red = pixels[offset] / 255;
            const green = pixels[offset + 1] / 255;
            const blue = pixels[offset + 2] / 255;
            const max = Math.max(red, green, blue);
            const min = Math.min(red, green, blue);
            const delta = max - min;
            const saturation = max === 0 ? 0 : delta / max;
            let hue = 0;

            if (delta !== 0) {
                if (max === red) hue = 60 * (((green - blue) / delta) % 6);
                else if (max === green) hue = 60 * (((blue - red) / delta) + 2);
                else hue = 60 * (((red - green) / delta) + 4);
                if (hue < 0) hue += 360;
            }

            if (hue >= 70 && hue <= 170 && saturation >= 0.35 && max >= 0.25) {
                mask[pixelIndex] = 1;
            }
        }

        return this.findBlobCentroids(mask, width, height, scale);
    }

    findBlobCentroids(mask, width, height, scale) {
        const centroids = [];
        const minimumArea = Math.max(6, Math.round(width * height * 0.00002));
        const maximumArea = width * height * 0.08;
        const queue = new Int32Array(mask.length);

        for (let startIndex = 0; startIndex < mask.length; startIndex += 1) {
            if (mask[startIndex] !== 1) continue;

            let queueStart = 0;
            let queueEnd = 1;
            let area = 0;
            let sumX = 0;
            let sumY = 0;
            queue[0] = startIndex;
            mask[startIndex] = 2;

            while (queueStart < queueEnd) {
                const index = queue[queueStart++];
                const x = index % width;
                const y = Math.floor(index / width);
                area += 1;
                sumX += x;
                sumY += y;

                for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                    const nextY = y + offsetY;
                    if (nextY < 0 || nextY >= height) continue;
                    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                        const nextX = x + offsetX;
                        if ((offsetX === 0 && offsetY === 0) || nextX < 0 || nextX >= width) continue;
                        const nextIndex = nextY * width + nextX;
                        if (mask[nextIndex] !== 1) continue;
                        mask[nextIndex] = 2;
                        queue[queueEnd++] = nextIndex;
                    }
                }
            }

            if (area >= minimumArea && area <= maximumArea) {
                centroids.push({
                    x: (sumX / area) / scale,
                    y: (sumY / area) / scale,
                    area: area / (scale * scale)
                });
            }
        }

        return centroids;
    }

    beginFirstPointSelection() {
        if (!this.hasVideo()) return;
        this.pausePlayback();
        this.firstPointSelectionActive = true;
        this.markerCanvas.style.pointerEvents = 'auto';
        this.markerCanvas.style.cursor = 'crosshair';
        this.showFrameIndex(0);
        this.emitSelectionChange();
    }

    cancelFirstPointSelection() {
        this.firstPointSelectionActive = false;
        this.markerCanvas.style.pointerEvents = 'none';
        this.markerCanvas.style.cursor = '';
        this.emitSelectionChange();
    }

    selectFirstMarkerAt(clientX, clientY) {
        if (!this.firstPointSelectionActive || this.currentFrameIndex !== 0) return;

        const centroids = this.markerCache.get(0) || [];
        if (centroids.length === 0) return;

        const displayedRect = this.getDisplayedVideoRect();
        const scaleX = displayedRect.width / this.video.videoWidth;
        const scaleY = displayedRect.height / this.video.videoHeight;
        const sourceX = (clientX - displayedRect.left) / scaleX;
        const sourceY = (clientY - displayedRect.top) / scaleY;
        let closestIndex = -1;
        let closestDistance = Number.POSITIVE_INFINITY;

        centroids.forEach((centroid, index) => {
            const distance = Math.hypot(centroid.x - sourceX, centroid.y - sourceY);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        });

        const maximumDistance = 24 / Math.max(Math.min(scaleX, scaleY), 0.001);
        if (closestIndex < 0 || closestDistance > maximumDistance) return;

        this.initializeMarkerTracking(centroids, closestIndex);
        this.cancelFirstPointSelection();
        this.drawMarkers(this.getDisplayMarkers(0));
    }

    initializeMarkerTracking(centroids, firstIndex) {
        const remaining = centroids.map((centroid, index) => ({ centroid, index }));
        const ordered = [];
        let currentEntry = remaining.splice(
            remaining.findIndex((entry) => entry.index === firstIndex),
            1
        )[0];

        while (currentEntry) {
            ordered.push(currentEntry.centroid);
            if (remaining.length === 0) break;

            let nearestIndex = 0;
            let nearestDistance = Number.POSITIVE_INFINITY;
            remaining.forEach((entry, index) => {
                const distance = Math.hypot(
                    entry.centroid.x - currentEntry.centroid.x,
                    entry.centroid.y - currentEntry.centroid.y
                );
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });
            currentEntry = remaining.splice(nearestIndex, 1)[0];
        }

        this.trackedMarkerCache.clear();
        this.nextMarkerId = ordered.length;
        this.trackedMarkerCache.set(0, ordered.map((centroid, id) => ({
            ...centroid,
            id
        })));
        this.renderAlignedFrame();
    }

    trackFrameMarkers(frameIndex, centroids) {
        if (frameIndex === 0 || this.trackedMarkerCache.has(frameIndex)) return;

        const previousFrameIndex = [...this.trackedMarkerCache.keys()]
            .filter((trackedFrameIndex) => trackedFrameIndex < frameIndex)
            .sort((a, b) => b - a)[0];
        if (!Number.isInteger(previousFrameIndex)) return;

        const previousMarkers = this.trackedMarkerCache.get(previousFrameIndex);
        const availableCentroids = centroids.map((centroid, index) => ({ centroid, index }));
        const trackedMarkers = [];

        previousMarkers.forEach((previousMarker) => {
            if (availableCentroids.length === 0) return;

            let nearestIndex = 0;
            let nearestDistance = Number.POSITIVE_INFINITY;
            availableCentroids.forEach((entry, index) => {
                const distance = Math.hypot(
                    entry.centroid.x - previousMarker.x,
                    entry.centroid.y - previousMarker.y
                );
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });

            const matched = availableCentroids.splice(nearestIndex, 1)[0].centroid;
            trackedMarkers.push({ ...matched, id: previousMarker.id });
        });

        availableCentroids.forEach(({ centroid }) => {
            trackedMarkers.push({ ...centroid, id: this.nextMarkerId++ });
        });
        trackedMarkers.sort((a, b) => a.id - b.id);
        this.trackedMarkerCache.set(frameIndex, trackedMarkers);
    }

    resetMarkerTracking() {
        this.trackedMarkerCache.clear();
        this.nextMarkerId = 0;
        this.cancelFirstPointSelection();
    }

    getDisplayMarkers(frameIndex) {
        return this.trackedMarkerCache.get(frameIndex) || this.markerCache.get(frameIndex) || [];
    }

    getFrameAlignment(frameIndex = this.currentFrameIndex) {
        const markers = this.trackedMarkerCache.get(frameIndex) || [];
        const marker0 = markers.find((marker) => marker.id === 0);
        const referencePoints = window.appSeries?.getFrame?.(0)?.points || [];
        const point0 = referencePoints[0];
        if (!marker0 || !point0 || referencePoints.length < 2) return null;

        const orderedMarkers = [...markers].sort((a, b) => a.id - b.id);
        const sourceLength = orderedMarkers.slice(1).reduce((total, marker, index) => {
            const previousMarker = orderedMarkers[index];
            return total + Math.hypot(
                marker.x - previousMarker.x,
                marker.y - previousMarker.y
            );
        }, 0);
        const targetLength = referencePoints.slice(1).reduce((total, point, index) => {
            const previousPoint = referencePoints[index];
            return total + Math.hypot(
                point.x - previousPoint.x,
                point.y - previousPoint.y
            );
        }, 0);
        if (sourceLength <= 0 || targetLength <= 0) return null;

        const scale = targetLength / sourceLength;
        let dotSum = 0;
        let crossSum = 0;
        orderedMarkers.forEach((marker) => {
            const referencePoint = referencePoints[marker.id];
            if (!referencePoint) return;

            const sourceX = (marker.x - marker0.x) * scale;
            const sourceY = (marker.y - marker0.y) * scale;
            const targetX = referencePoint.x - point0.x;
            const targetY = referencePoint.y - point0.y;
            dotSum += sourceX * targetX + sourceY * targetY;
            crossSum += sourceX * targetY - sourceY * targetX;
        });
        if (Math.abs(dotSum) + Math.abs(crossSum) <= Number.EPSILON) return null;

        const angle = Math.atan2(crossSum, dotSum);
        const cosine = Math.cos(angle) * scale;
        const sine = Math.sin(angle) * scale;
        return {
            a: cosine,
            b: sine,
            c: -sine,
            d: cosine,
            e: point0.x - cosine * marker0.x + sine * marker0.y,
            f: point0.y - sine * marker0.x - cosine * marker0.y
        };
    }

    transformMarkerToViewport(marker, alignment = this.getFrameAlignment()) {
        if (alignment) {
            return {
                x: alignment.a * marker.x + alignment.c * marker.y + alignment.e,
                y: alignment.b * marker.x + alignment.d * marker.y + alignment.f
            };
        }

        const displayedRect = this.getDisplayedVideoRect();
        return {
            x: displayedRect.left + marker.x * displayedRect.width / this.video.videoWidth,
            y: displayedRect.top + marker.y * displayedRect.height / this.video.videoHeight
        };
    }

    renderAlignedFrame() {
        if (!this.alignedContext) return;

        const dpr = window.devicePixelRatio || 1;
        this.alignedContext.setTransform(1, 0, 0, 1, 0, 0);
        this.alignedContext.clearRect(0, 0, this.alignedCanvas.width, this.alignedCanvas.height);
        const alignment = this.getFrameAlignment();
        const canRender = this.enabled && this.hasVideo() && alignment && this.video.readyState >= 2;
        this.alignedCanvas.style.visibility = canRender ? 'visible' : 'hidden';
        if (!canRender) {
            this.updateVideoLayerVisibility();
            return;
        }

        this.alignedContext.save();
        this.alignedContext.globalAlpha = 0.5;
        this.alignedContext.setTransform(
            dpr * alignment.a,
            dpr * alignment.b,
            dpr * alignment.c,
            dpr * alignment.d,
            dpr * alignment.e,
            dpr * alignment.f
        );
        this.alignedContext.drawImage(this.video, 0, 0);
        this.alignedContext.restore();
        this.updateVideoLayerVisibility();
    }

    updateVideoLayerVisibility() {
        const hasVideo = this.hasVideo();
        const isAligned = Boolean(this.getFrameAlignment());
        this.video.style.visibility = this.enabled && hasVideo && !isAligned ? 'visible' : 'hidden';
        if (!this.enabled || !hasVideo) {
            this.alignedCanvas.style.visibility = 'hidden';
        }
    }

    getDisplayedVideoRect() {
        const bounds = this.video.getBoundingClientRect();
        const videoAspect = this.video.videoWidth / this.video.videoHeight;
        const boundsAspect = bounds.width / bounds.height;
        let width = bounds.width;
        let height = bounds.height;

        if (videoAspect > boundsAspect) height = width / videoAspect;
        else width = height * videoAspect;

        return {
            left: bounds.left + (bounds.width - width) / 2,
            top: bounds.top + (bounds.height - height) / 2,
            width,
            height
        };
    }

    drawMarkers(markers) {
        if (!this.markerContext) return;
        this.markerContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
        if (!this.enabled || !this.hasVideo() || markers.length === 0) return;

        const alignment = this.getFrameAlignment();
        const trackedMarkers = markers.filter((marker) => Number.isInteger(marker.id));

        if (trackedMarkers.length > 1) {
            this.markerContext.strokeStyle = '#1687ff';
            this.markerContext.lineWidth = 3;
            this.markerContext.beginPath();
            trackedMarkers.forEach((marker, index) => {
                const { x, y } = this.transformMarkerToViewport(marker, alignment);
                if (index === 0) this.markerContext.moveTo(x, y);
                else this.markerContext.lineTo(x, y);
            });
            this.markerContext.stroke();
        }

        this.markerContext.fillStyle = '#ff0000';
        markers.forEach((marker) => {
            const { x, y } = this.transformMarkerToViewport(marker, alignment);
            this.markerContext.beginPath();
            this.markerContext.arc(x, y, 5, 0, Math.PI * 2);
            this.markerContext.fill();

            if (Number.isInteger(marker.id)) {
                this.markerContext.fillStyle = '#ffffff';
                this.markerContext.font = 'bold 12px sans-serif';
                this.markerContext.fillText(String(marker.id), x + 8, y - 8);
                this.markerContext.fillStyle = '#ff0000';
            }
        });
    }

    nextFrame() {
        this.showFrameIndex(this.currentFrameIndex >= this.maxFrameIndex
            ? 0
            : this.currentFrameIndex + 1);
    }

    prevFrame() {
        this.showFrameIndex(this.currentFrameIndex <= 0
            ? this.maxFrameIndex
            : this.currentFrameIndex - 1);
    }

    playFrames() {
        if (this.playbackTimer !== null || !this.hasVideo()) return;

        this.playbackDirection = this.currentFrameIndex >= this.maxFrameIndex ? -1 : 1;
        this.playbackTimer = setInterval(() => {
            if (this.maxFrameIndex <= 0) return;

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

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        this.showFrameIndex(this.currentFrameIndex);
        this.enabledChangeListeners.forEach((listener) => listener(this.enabled));
    }

    getEnabled() {
        return this.enabled;
    }

    hasVideo() {
        return Boolean(this.video.currentSrc || this.video.src);
    }

    blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
            reader.readAsDataURL(blob);
        });
    }

    async getSerializableState() {
        return {
            enabled: this.enabled,
            currentFrameIndex: this.currentFrameIndex,
            video: this.currentVideoFile
                ? {
                    name: this.currentVideoFile.name,
                    type: this.currentVideoFile.type,
                    dataURL: await this.blobToDataURL(this.currentVideoFile)
                }
                : null
        };
    }

    onVideoChange(listener) {
        this.videoChangeListeners.add(listener);
        return () => this.videoChangeListeners.delete(listener);
    }

    emitVideoChange() {
        this.videoChangeListeners.forEach((listener) => listener(this.hasVideo()));
    }

    onFrameChange(listener) {
        this.frameChangeListeners.add(listener);
        return () => this.frameChangeListeners.delete(listener);
    }

    emitFrameChange() {
        this.frameChangeListeners.forEach((listener) => {
            listener(this.currentFrameIndex, this.maxFrameIndex);
        });
    }

    onPlaybackChange(listener) {
        this.playbackChangeListeners.add(listener);
        return () => this.playbackChangeListeners.delete(listener);
    }

    emitPlaybackChange() {
        const playing = this.playbackTimer !== null;
        this.playbackChangeListeners.forEach((listener) => listener(playing));
    }

    onEnabledChange(listener) {
        this.enabledChangeListeners.add(listener);
        return () => this.enabledChangeListeners.delete(listener);
    }

    onSelectionChange(listener) {
        this.selectionChangeListeners.add(listener);
        return () => this.selectionChangeListeners.delete(listener);
    }

    emitSelectionChange() {
        this.selectionChangeListeners.forEach((listener) => {
            listener(this.firstPointSelectionActive);
        });
    }
}

(function () {
    const controller = new Test('canvas');
    if (!controller.ready) return;

    window.testControls = {
        openVideoPicker: () => controller.openVideoPicker(),
        loadVideoFile: (file) => controller.loadVideoFile(file),
        setEnabled: (enabled) => controller.setEnabled(enabled),
        getEnabled: () => controller.getEnabled(),
        hasVideo: () => controller.hasVideo(),
        showFrameIndex: (frameIndex) => controller.showFrameIndex(frameIndex),
        getCurrentFrameIndex: () => controller.currentFrameIndex,
        getMaxFrameIndex: () => controller.maxFrameIndex,
        nextFrame: () => controller.nextFrame(),
        prevFrame: () => controller.prevFrame(),
        togglePlayback: () => controller.togglePlayback(),
        pausePlayback: () => controller.pausePlayback(),
        isPlaying: () => controller.playbackTimer !== null,
        beginFirstPointSelection: () => controller.beginFirstPointSelection(),
        cancelFirstPointSelection: () => controller.cancelFirstPointSelection(),
        getTrackedMarkers: (frameIndex) => (
            controller.trackedMarkerCache.get(frameIndex ?? controller.currentFrameIndex) || []
        ).map((marker) => ({ ...marker })),
        getSerializableState: () => controller.getSerializableState(),
        onVideoChange: (listener) => controller.onVideoChange(listener),
        onFrameChange: (listener) => controller.onFrameChange(listener),
        onPlaybackChange: (listener) => controller.onPlaybackChange(listener),
        onEnabledChange: (listener) => controller.onEnabledChange(listener),
        onSelectionChange: (listener) => controller.onSelectionChange(listener),
        video: controller.video
    };
})();