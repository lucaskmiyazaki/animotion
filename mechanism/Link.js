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
                return {
                    x: 0,
                    y: 0,
                    isPivot: Boolean(point?.isPivot)
                };
            }
            return {
                x: (Number(point.x) || 0) - this.position.x,
                y: (Number(point.y) || 0) - this.position.y,
                isPivot: Boolean(point?.isPivot)
            };
        });
    }

    clone() {
        const clone = Object.create(Link.prototype);
        clone.position = { x: this.position.x, y: this.position.y };
        clone._theta = this._theta;
        clone.kind = this.kind;
        clone.localPoints = this.localPoints.map((p) => ({
            x: p.x,
            y: p.y,
            isPivot: Boolean(p?.isPivot)
        }));
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

    static _orderPointsNoCross(points) {
        if (!Array.isArray(points) || points.length < 3) return [];

        const unique = [];
        const eps = 1e-6;
        points.forEach((point) => {
            const x = Number(point?.x);
            const y = Number(point?.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;

            const exists = unique.some((item) => Math.hypot(item.x - x, item.y - y) <= eps);
            if (!exists) {
                unique.push({
                    x,
                    y,
                    isPivot: Boolean(point?.isPivot)
                });
            }
        });

        if (unique.length < 3) return [];

        const centroid = unique.reduce(
            (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
            { x: 0, y: 0 }
        );
        centroid.x /= unique.length;
        centroid.y /= unique.length;

        return unique.sort((a, b) => {
            const aa = Math.atan2(a.y - centroid.y, a.x - centroid.x);
            const ab = Math.atan2(b.y - centroid.y, b.x - centroid.x);
            return aa - ab;
        });
    }

    static _collectUniquePivotPoints(points, tolerance = 1e-6) {
        if (!Array.isArray(points) || points.length === 0) return [];

        const uniquePivots = [];

        points.forEach((point) => {
            if (!point?.isPivot) return;

            const x = Number(point.x);
            const y = Number(point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;

            const exists = uniquePivots.some((existing) => Math.hypot(existing.x - x, existing.y - y) <= tolerance);
            if (!exists) {
                uniquePivots.push({ x, y, isPivot: true });
            }
        });

        return uniquePivots;
    }

    static _closestOtherPivot(point, pivotPoints) {
        let closest = null;
        let bestDistanceSq = Number.POSITIVE_INFINITY;

        pivotPoints.forEach((candidate) => {
            if (candidate === point) return;

            const dx = candidate.x - point.x;
            const dy = candidate.y - point.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                closest = candidate;
            }
        });

        return closest;
    }

    getWorldPoints() {
        const c = Math.cos(this.theta);
        const s = Math.sin(this.theta);

        return this.localPoints.map((local) => ({
            x: this.position.x + local.x * c - local.y * s,
            y: this.position.y + local.x * s + local.y * c,
            isPivot: Boolean(local?.isPivot)
        }));
    }

    drawPolygonFromPoints(ctx, points, options = {}) {
        if (!ctx) return;

        const ordered = Link._orderPointsNoCross(points);
        if (ordered.length < 3) return;

        const strokeStyle = options.strokeStyle || 'rgba(57, 166, 255, 0.95)';
        const fillStyle = options.fillStyle || 'rgba(57, 166, 255, 0.14)';
        const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 2;
        const pivotSlack = Number.isFinite(options.slack) ? Number(options.slack) : null;
        const pivotHighlightRadius = Number.isFinite(options.pivotHighlightRadius)
            ? Number(options.pivotHighlightRadius)
            : 4.5;
        const pivotHighlightStrokeStyle = options.pivotHighlightStrokeStyle || 'rgba(255, 215, 90, 0.98)';
        const pivotHighlightFillStyle = options.pivotHighlightFillStyle || 'rgba(255, 245, 180, 0.98)';
        const pivotHighlightInnerFillStyle = options.pivotHighlightInnerFillStyle || 'rgba(255, 255, 255, 0.98)';
        const uniquePivots = Link._collectUniquePivotPoints(ordered);

        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.fillStyle = fillStyle;
        ctx.lineWidth = lineWidth;

        ctx.beginPath();
        ctx.moveTo(ordered[0].x, ordered[0].y);
        for (let i = 1; i < ordered.length; i++) {
            ctx.lineTo(ordered[i].x, ordered[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (Number.isFinite(pivotSlack) && uniquePivots.length >= 2) {
            const highlightPoints = [];

            uniquePivots.forEach((pivot) => {
                const otherPivot = Link._closestOtherPivot(pivot, uniquePivots);
                if (!otherPivot) return;

                const dx = otherPivot.x - pivot.x;
                const dy = otherPivot.y - pivot.y;
                const magnitude = Math.hypot(dx, dy);
                if (magnitude < 1e-8) return;

                const unitX = dx / magnitude;
                const unitY = dy / magnitude;
                highlightPoints.push({
                    x: pivot.x + unitX * pivotSlack,
                    y: pivot.y + unitY * pivotSlack
                });
            });

            ctx.lineWidth = Math.max(1, lineWidth * 0.75);
            highlightPoints.forEach((point) => {
                ctx.beginPath();
                ctx.fillStyle = pivotHighlightFillStyle;
                ctx.strokeStyle = pivotHighlightStrokeStyle;
                ctx.arc(point.x, point.y, pivotHighlightRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.beginPath();
                ctx.fillStyle = pivotHighlightInnerFillStyle;
                ctx.arc(point.x, point.y, Math.max(1.25, pivotHighlightRadius * 0.42), 0, Math.PI * 2);
                ctx.fill();
            });
        }

        ctx.restore();
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

        ctx.restore();
    }
}


window.Link = Link;
