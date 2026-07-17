class Ruler {
    // Initialize ruler state and transient interaction data.
    constructor(initialState = {}) {
        this.visible = Boolean(initialState.visible);
        this.start = {
            x: Number.isFinite(initialState.start?.x) ? Number(initialState.start.x) : 0,
            y: Number.isFinite(initialState.start?.y) ? Number(initialState.start.y) : 0
        };
        this.end = {
            x: Number.isFinite(initialState.end?.x) ? Number(initialState.end.x) : 0,
            y: Number.isFinite(initialState.end?.y) ? Number(initialState.end.y) : 0
        };
        this.mmLength = this.clampMillimeters(initialState.mmLength ?? 1000);
        this.initialized = Boolean(initialState.initialized);
        this.draggedHandle = null;
        this.labelBounds = null;
    }

    // Clamp physical length to a valid positive millimeter value.
    clampMillimeters(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return 1000;
        }
        return parsed;
    }

    // Current ruler segment length in pixels.
    getPixelLength() {
        return Math.hypot(this.end.x - this.start.x, this.end.y - this.start.y);
    }

    // Unit conversion from pixel distance to millimeters.
    getScaleMmPerPixel() {
        const px = this.getPixelLength();
        if (px <= 1e-8) {
            return 1;
        }
        return this.clampMillimeters(this.mmLength) / px;
    }

    // Place ruler at a default horizontal position inside a viewport rect.
    placeDefault(rect) {
        if (!rect) return;
        const y = rect.top + rect.height * 0.15;
        this.start.x = rect.left + rect.width * 0.2;
        this.start.y = y;
        this.end.x = rect.left + rect.width * 0.8;
        this.end.y = y;
        this.initialized = true;
    }

    // Detect whether both ruler handles and segment are outside the viewport.
    isCompletelyOffscreen(rect, handleRadius = 10) {
        if (!rect) return true;

        const isFinitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
        if (!isFinitePoint(this.start) || !isFinitePoint(this.end)) {
            return true;
        }

        const margin = handleRadius + 6;
        const inExpandedRect = (p) => (
            p.x >= rect.left - margin
            && p.x <= rect.left + rect.width + margin
            && p.y >= rect.top - margin
            && p.y <= rect.top + rect.height + margin
        );

        const startInside = inExpandedRect(this.start);
        const endInside = inExpandedRect(this.end);
        if (startInside || endInside) {
            return false;
        }

        const minX = Math.min(this.start.x, this.end.x);
        const maxX = Math.max(this.start.x, this.end.x);
        const minY = Math.min(this.start.y, this.end.y);
        const maxY = Math.max(this.start.y, this.end.y);

        const overlapsX = maxX >= rect.left && minX <= rect.left + rect.width;
        const overlapsY = maxY >= rect.top && minY <= rect.top + rect.height;
        return !(overlapsX && overlapsY);
    }

    // Ensure ruler has a valid on-screen placement.
    ensureInitialized(rect, handleRadius = 10) {
        if (!this.initialized) {
            this.placeDefault(rect);
            return;
        }

        if (this.isCompletelyOffscreen(rect, handleRadius)) {
            this.placeDefault(rect);
        }
    }

    // Hit-test a ruler handle.
    hitsHandle(x, y, handlePoint, handleRadius = 10) {
        return Math.hypot(x - handlePoint.x, y - handlePoint.y) <= handleRadius + 2;
    }

    // Hit-test the ruler label box cached during draw().
    hitsLabel(x, y) {
        if (!this.labelBounds) return false;
        return x >= this.labelBounds.left
            && x <= this.labelBounds.right
            && y >= this.labelBounds.top
            && y <= this.labelBounds.bottom;
    }

    // Start dragging a handle; returns handle name or null.
    tryStartDrag(x, y, handleRadius = 10) {
        if (!this.visible) return null;

        if (this.hitsHandle(x, y, this.start, handleRadius)) {
            this.draggedHandle = "start";
            return this.draggedHandle;
        }

        if (this.hitsHandle(x, y, this.end, handleRadius)) {
            this.draggedHandle = "end";
            return this.draggedHandle;
        }

        return null;
    }

    // Stop any active handle drag.
    stopDrag() {
        this.draggedHandle = null;
    }

    // Update dragged handle position to the latest pointer location.
    updateDraggedHandle(x, y) {
        if (!this.draggedHandle) return;
        this[this.draggedHandle].x = x;
        this[this.draggedHandle].y = y;
    }

    // Handle clicks on the label to edit ruler millimeter length.
    tryHandleLabelClick(x, y, promptFn = window.prompt, alertFn = window.alert) {
        if (!this.visible) return false;
        if (!this.hitsLabel(x, y)) return false;

        const input = promptFn(
            "Ruler length (mm):",
            String(this.clampMillimeters(this.mmLength))
        );

        if (input === null) {
            return true;
        }

        const nextMm = Number.parseFloat(input);
        if (!Number.isFinite(nextMm) || nextMm <= 0) {
            alertFn("Please enter a positive numeric value in millimeters.");
            return true;
        }

        this.mmLength = nextMm;
        return true;
    }

    // Render ruler geometry and label; caches and returns label bounds.
    draw(ctx, options = {}) {
        if (!ctx || !this.visible) {
            this.labelBounds = null;
            return this.labelBounds;
        }

        const handleRadius = Number.isFinite(options.handleRadius) ? options.handleRadius : 10;
        const labelPaddingX = Number.isFinite(options.labelPaddingX) ? options.labelPaddingX : 8;
        const labelPaddingY = Number.isFinite(options.labelPaddingY) ? options.labelPaddingY : 5;

        const start = this.start;
        const end = this.end;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);

        ctx.save();

        ctx.strokeStyle = options.strokeStyle || "rgba(255, 142, 38, 0.95)";
        ctx.fillStyle = options.fillStyle || "rgba(255, 142, 38, 0.28)";
        ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 3;

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        const drawHandle = (point) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, handleRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        };

        drawHandle(start);
        drawHandle(end);

        if (length > 1e-8) {
            const nx = -(dy / length);
            const ny = dx / length;
            const tickSize = 8;
            const tickCount = 10;

            for (let i = 0; i <= tickCount; i++) {
                const t = i / tickCount;
                const px = start.x + dx * t;
                const py = start.y + dy * t;
                const major = i % 5 === 0;
                const size = major ? tickSize : tickSize * 0.55;

                ctx.beginPath();
                ctx.moveTo(px - nx * size, py - ny * size);
                ctx.lineTo(px + nx * size, py + ny * size);
                ctx.stroke();
            }

            const label = `${Math.round(this.clampMillimeters(this.mmLength))} mm`;
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            const labelOffset = 22;
            const labelX = midX + nx * labelOffset;
            const labelY = midY + ny * labelOffset;

            ctx.font = options.labelFont || "700 14px Manrope, Segoe UI, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const textWidth = ctx.measureText(label).width;
            const textHeight = 14;
            const boxWidth = textWidth + labelPaddingX * 2;
            const boxHeight = textHeight + labelPaddingY * 2;
            const boxLeft = labelX - boxWidth / 2;
            const boxTop = labelY - boxHeight / 2;

            this.labelBounds = {
                left: boxLeft,
                top: boxTop,
                right: boxLeft + boxWidth,
                bottom: boxTop + boxHeight
            };

            ctx.fillStyle = options.labelBoxFillStyle || "rgba(255, 142, 38, 0.24)";
            ctx.strokeStyle = options.labelBoxStrokeStyle || "rgba(255, 142, 38, 0.95)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (typeof ctx.roundRect === "function") {
                ctx.roundRect(boxLeft, boxTop, boxWidth, boxHeight, 7);
            } else {
                ctx.rect(boxLeft, boxTop, boxWidth, boxHeight);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = options.labelTextFillStyle || "rgba(255, 255, 255, 0.98)";
            ctx.fillText(label, labelX, labelY + 0.5);
        } else {
            this.labelBounds = null;
        }

        ctx.restore();
        return this.labelBounds;
    }

    // Export ruler state for project serialization.
    toSerializable() {
        return {
            visible: Boolean(this.visible),
            mmLength: this.clampMillimeters(this.mmLength),
            initialized: Boolean(this.initialized),
            start: { x: Number(this.start.x) || 0, y: Number(this.start.y) || 0 },
            end: { x: Number(this.end.x) || 0, y: Number(this.end.y) || 0 }
        };
    }

    // Rebuild a Ruler instance from serialized snapshot data.
    static fromSerializable(snapshot) {
        return new Ruler(snapshot || {});
    }
}

window.Ruler = Ruler;
