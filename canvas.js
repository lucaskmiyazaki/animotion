class Canvas {
    constructor(elementId = 'canvas') {
        this.element = document.getElementById(elementId);
        if (!this.element) {
            throw new Error(`Canvas element not found: #${elementId}`);
        }

        this.ctx = this.element.getContext('2d');
        if (!this.ctx) {
            throw new Error('2D canvas context is not available');
        }
    }

    resizeToViewport() {
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;

        this.element.style.width = `${cssWidth}px`;
        this.element.style.height = `${cssHeight}px`;
        this.element.width = Math.max(1, Math.round(cssWidth * dpr));
        this.element.height = Math.max(1, Math.round(cssHeight * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    getViewportRect() {
        return {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight
        };
    }

    getBackgroundVideoElement() {
        return window.videoControls?.video || document.getElementById('backgroundVideo');
    }

    getDisplayedVideoRect() {
        const video = this.getBackgroundVideoElement();
        if (!video) {
            return this.getViewportRect();
        }

        const bounds = video.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) {
            return this.getViewportRect();
        }

        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        if (!videoWidth || !videoHeight) {
            return {
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height
            };
        }

        const fit = getComputedStyle(video).objectFit || 'fill';
        if (fit !== 'contain' && fit !== 'scale-down') {
            return {
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height
            };
        }

        const containerAspect = bounds.width / bounds.height;
        const mediaAspect = videoWidth / videoHeight;

        let renderedWidth = bounds.width;
        let renderedHeight = bounds.height;
        let offsetX = 0;
        let offsetY = 0;

        if (mediaAspect > containerAspect) {
            renderedWidth = bounds.width;
            renderedHeight = bounds.width / mediaAspect;
            offsetY = (bounds.height - renderedHeight) / 2;
        } else {
            renderedHeight = bounds.height;
            renderedWidth = bounds.height * mediaAspect;
            offsetX = (bounds.width - renderedWidth) / 2;
        }

        return {
            left: bounds.left + offsetX,
            top: bounds.top + offsetY,
            width: renderedWidth,
            height: renderedHeight
        };
    }

    transformPointToNewVideoRect(point, oldRect, newRect, scaleX, scaleY) {
        point.x = newRect.left + (point.x - oldRect.left) * scaleX;
        point.y = newRect.top + (point.y - oldRect.top) * scaleY;
    }

    findPointAt(points, x, y, hitRadius) {
        if (!Array.isArray(points)) return null;

        for (const point of points) {
            const dx = x - point.x;
            const dy = y - point.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= hitRadius) {
                return point;
            }
        }
        return null;
    }

    drawSkeletonOverlay(skeleton, options = {}) {
        if (!skeleton) return;

        const {
            hoveredPoint = null,
            selectedPoint = null,
            pointRadius = 5,
            hoverRadius = 9,
            showBisector = false,
            showPivot = false,
            pivotRadius = 50
        } = options;

        this.ctx.strokeStyle = 'blue';
        this.ctx.lineWidth = 2;

        skeleton.lines.forEach((line) => {
            this.ctx.beginPath();
            this.ctx.moveTo(line.start.x, line.start.y);
            this.ctx.lineTo(line.end.x, line.end.y);
            this.ctx.stroke();
        });

        if (showBisector && typeof skeleton.drawBisector === 'function') {
            skeleton.drawBisector(this.ctx, {
                length: 50,
                strokeStyle: 'rgba(0, 180, 0, 0.95)',
                lineWidth: 3
            });

            if (showPivot && typeof skeleton.drawPivot === 'function') {
                skeleton.drawPivot(this.ctx, pivotRadius, {
                    pointRadius: 4,
                    fillStyle: 'rgba(255, 120, 0, 0.9)'
                });
            }
        }

        skeleton.points.forEach((point, index) => {
            const radius = point === hoveredPoint ? hoverRadius : pointRadius;

            if (index === 0) {
                this.ctx.beginPath();
                this.ctx.strokeStyle = 'red';
                this.ctx.lineWidth = 2;
                this.ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
                this.ctx.stroke();
            }

            this.ctx.beginPath();
            this.ctx.fillStyle = point === selectedPoint ? 'gold' : 'red';
            this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
            if (point === selectedPoint) {
                this.ctx.strokeStyle = 'orange';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
        });
    }

    drawRulerOverlay(ruler, displayedVideoRect, options = {}) {
        if (!ruler) return;

        const {
            handleRadius = 10,
            labelPaddingX = 8,
            labelPaddingY = 5
        } = options;

        ruler.ensureInitialized(displayedVideoRect, handleRadius);
        ruler.draw(this.ctx, {
            handleRadius,
            labelPaddingX,
            labelPaddingY
        });
    }

    clearViewport() {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    getContext() {
        return this.ctx;
    }

    getElement() {
        return this.element;
    }
}

window.Canvas = Canvas;
