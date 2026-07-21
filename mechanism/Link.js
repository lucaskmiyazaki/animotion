class Link {
    constructor(worldPoints, options = {}) {
        if (!Array.isArray(worldPoints) || (worldPoints.length !== 3 && worldPoints.length !== 4)) {
            throw new Error('Link requires 3 (triangle) or 4 (trapezoid-like) points.');
        }

        const anchor = worldPoints[0];
        this.position = {
            x: Number(anchor.x) || 0,
            y: Number(anchor.y) || 0
        };
        this.theta = Number(options.theta) || 0;
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
        clone.theta = this.theta;
        clone.kind = this.kind;
        clone.localPoints = this.localPoints.map((p) => ({ x: p.x, y: p.y }));
        clone.metadata = { ...(this.metadata || {}) };
        clone.twin = null;
        return clone;
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

    draw(ctx, options = {}) {
        if (!ctx) return;

        const points = this.getWorldPoints();
        if (points.length < 3) return;

        const strokeStyle = options.strokeStyle || 'rgba(57, 166, 255, 0.95)';
        const fillStyle = options.fillStyle || 'rgba(57, 166, 255, 0.14)';
        const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 2;

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

        ctx.restore();
    }
}


window.Link = Link;
