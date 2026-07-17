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
