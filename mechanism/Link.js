class Link {
    static normalizeAngleSigned(angle) {
        if (!Number.isFinite(angle)) return 0;
        let value = Number(angle);
        while (value > Math.PI) value -= Math.PI * 2;
        while (value < -Math.PI) value += Math.PI * 2;
        return value;
    }

    constructor(worldPoints, options = {}) {
        if (!Array.isArray(worldPoints) || (worldPoints.length !== 3 && worldPoints.length !== 4)) {
            throw new Error('Link requires 3 (triangle) or 4 (trapezoid-like) points.');
        }

        const anchor = worldPoints[0];
        this.position = {
            x: Number(anchor.x) || 0,
            y: Number(anchor.y) || 0
        };
        this._theta = 0;
        this.theta = Number.isFinite(options.theta) ? Number(options.theta) : 0;
        this.kind = worldPoints.length === 3 ? 'triangle' : 'trapezoid';
        this.metadata = options.metadata && typeof options.metadata === 'object'
            ? { ...options.metadata }
            : {};
        this.twin = null;

        // Store shape in local coordinates with p0 fixed at origin.
        this.localPoints = worldPoints.map((point, index) => {
            if (index === 0) {
                return { x: 0, y: 0 };
            }
            return {
                x: (Number(point.x) || 0) - this.position.x,
                y: (Number(point.y) || 0) - this.position.y
            };
        });
    }

    clone() {
        const clone = Object.create(Link.prototype);
        clone.position = { x: this.position.x, y: this.position.y };
        clone._theta = this._theta;
        clone.kind = this.kind;
        clone.localPoints = this.localPoints.map((p) => ({ x: p.x, y: p.y }));
        clone.metadata = { ...(this.metadata || {}) };
        clone.twin = null;
        return clone;
    }

    get theta() {
        return this._theta;
    }

    set theta(value) {
        this._theta = Link.normalizeAngleSigned(Number(value) || 0);
    }

    setTwin(link) {
        this.twin = link instanceof Link ? link : null;
    }

    getWorldPoints() {
        const c = Math.cos(this.theta);
        const s = Math.sin(this.theta);

        return this.localPoints.map((local) => ({
            x: this.position.x + local.x * c - local.y * s,
            y: this.position.y + local.x * s + local.y * c
        }));
    }

    getHoleCenterLine() {
        const points = this.getWorldPoints();
        if (!Array.isArray(points) || points.length < 4) {
            return null;
        }

        const p0 = points[0];
        const p1 = points[1];
        const p2 = points[2];
        const p3 = points[3];

        const v01 = { x: p1.x - p0.x, y: p1.y - p0.y };
        const v12 = { x: p2.x - p1.x, y: p2.y - p1.y };
        const v23 = { x: p3.x - p2.x, y: p3.y - p2.y };
        const v30 = { x: p0.x - p3.x, y: p0.y - p3.y };

        const normalize = (v) => {
            const mag = Math.hypot(v.x, v.y);
            if (mag < 1e-8) return null;
            return { x: v.x / mag, y: v.y / mag };
        };

        const crossAbs = (a, b) => {
            const na = normalize(a);
            const nb = normalize(b);
            if (!na || !nb) return Number.POSITIVE_INFINITY;
            return Math.abs(na.x * nb.y - na.y * nb.x);
        };

        const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

        const scorePair01_23 = crossAbs(v01, v23);
        const scorePair12_30 = crossAbs(v12, v30);

        if (scorePair01_23 <= scorePair12_30) {
            return {
                start: midpoint(p0, p3),
                end: midpoint(p1, p2)
            };
        }

        return {
            start: midpoint(p0, p1),
            end: midpoint(p2, p3)
        };
    }

    draw(ctx, options = {}) {
        if (!ctx) return;

        const points = this.getWorldPoints();
        if (points.length < 3) return;

        const strokeStyle = options.strokeStyle || 'rgba(57, 166, 255, 0.95)';
        const fillStyle = options.fillStyle || 'rgba(57, 166, 255, 0.14)';
        const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 2;
        const pointRadius = Number.isFinite(options.pointRadius) ? options.pointRadius : 3.5;
        const anchorPointRadius = Number.isFinite(options.anchorPointRadius)
            ? options.anchorPointRadius
            : pointRadius + 1.5;
        const pointStrokeStyle = options.pointStrokeStyle || strokeStyle;
        const pointFillStyle = options.pointFillStyle || 'rgba(255, 255, 255, 0.92)';
        const anchorPointStrokeStyle = options.anchorPointStrokeStyle || strokeStyle;
        const anchorPointFillStyle = options.anchorPointFillStyle || 'rgba(255, 255, 255, 1)';
        const labelFillStyle = options.pointLabelFillStyle || 'rgba(17, 24, 39, 0.92)';
        const labelFont = options.pointLabelFont || '10px sans-serif';
        const labelOffsetX = Number.isFinite(options.pointLabelOffsetX) ? options.pointLabelOffsetX : 7;
        const labelOffsetY = Number.isFinite(options.pointLabelOffsetY) ? options.pointLabelOffsetY : -7;
        const labeledPoints = [2];

        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.fillStyle = fillStyle;
        ctx.lineWidth = lineWidth;

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.lineWidth = Math.max(1, lineWidth * 0.75);

        points.forEach((point, index) => {
            const isAnchorPoint = index === 0;
            const radius = isAnchorPoint ? anchorPointRadius : pointRadius;
            const labelNumber = index + 1;
            const shouldHighlight = labeledPoints.includes(labelNumber);

            if (!shouldHighlight) {
                return;
            }

            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = isAnchorPoint ? anchorPointFillStyle : pointFillStyle;
            ctx.strokeStyle = isAnchorPoint ? anchorPointStrokeStyle : pointStrokeStyle;
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = labelFillStyle;
            ctx.font = labelFont;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(labelNumber), point.x + labelOffsetX, point.y + labelOffsetY);
        });

        ctx.restore();
    }
}


window.Link = Link;
