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

class Mechanism {
    constructor() {
        this.links = [];
    }

    clear() {
        this.links = [];
    }

    addLink(link) {
        if (link instanceof Link) {
            this.links.push(link);
        }
    }

    addLinkFromWorldPoints(worldPoints) {
        this.addLink(new Link(worldPoints));
    }

    static _normalize(vector) {
        const mag = Math.hypot(vector.x, vector.y);
        if (mag < 1e-8) return null;
        return { x: vector.x / mag, y: vector.y / mag };
    }

    static _centroid(points) {
        const total = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return {
            x: total.x / points.length,
            y: total.y / points.length
        };
    }

    static _rotateStart(points, startPoint) {
        if (!startPoint || !Array.isArray(points) || points.length === 0) return points;
        let bestIndex = 0;
        let bestDist = Number.POSITIVE_INFINITY;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const dist = Math.hypot(p.x - startPoint.x, p.y - startPoint.y);
            if (dist < bestDist) {
                bestDist = dist;
                bestIndex = i;
            }
        }

        return points.slice(bestIndex).concat(points.slice(0, bestIndex));
    }

    static _orderQuadWithoutIntersection(points, startPoint = null) {
        const center = Mechanism._centroid(points);
        const sorted = points.slice().sort((a, b) => {
            const aa = Math.atan2(a.y - center.y, a.x - center.x);
            const ab = Math.atan2(b.y - center.y, b.x - center.x);
            return aa - ab;
        });
        return Mechanism._rotateStart(sorted, startPoint);
    }

    static _directedAngleDeg(from, to, direction) {
        const aFrom = Math.atan2(from.y, from.x);
        const aTo = Math.atan2(to.y, to.x);
        const ccw = ((aTo - aFrom) * (180 / Math.PI) % 360 + 360) % 360;
        if (direction === 'counterclockwise') return ccw;
        if (direction === 'clockwise') return (360 - ccw) % 360;
        return Number.POSITIVE_INFINITY;
    }

    static _computeTerminalFourthPoint(anchorPoint, skeletonPoint, pivotPoint) {
        const axis = Mechanism._normalize({
            x: skeletonPoint.x - anchorPoint.x,
            y: skeletonPoint.y - anchorPoint.y
        });
        if (!axis) return null;

        // Intersect:
        // 1) line through pivot, parallel to anchor->skeleton axis
        // 2) line through anchor point, perpendicular to axis
        // This enforces:
        // - (anchor->skeleton) dot (anchor->new) = 0
        // - (anchor->skeleton) parallel (pivot->new)
        const t = (anchorPoint.x - pivotPoint.x) * axis.x + (anchorPoint.y - pivotPoint.y) * axis.y;
        return {
            x: pivotPoint.x + axis.x * t,
            y: pivotPoint.y + axis.y * t
        };
    }

    _selectPivot2Candidate(point, prevPoint, pivotCandidates, closingDirection) {
        if (!pivotCandidates || (closingDirection !== 'clockwise' && closingDirection !== 'counterclockwise')) {
            return null;
        }

        const toPrev = {
            x: prevPoint.x - point.x,
            y: prevPoint.y - point.y
        };

        const toPositive = {
            x: pivotCandidates.positive.x - point.x,
            y: pivotCandidates.positive.y - point.y
        };

        const toNegative = {
            x: pivotCandidates.negative.x - point.x,
            y: pivotCandidates.negative.y - point.y
        };

        const anglePositive = Mechanism._directedAngleDeg(toPrev, toPositive, closingDirection);
        const angleNegative = Mechanism._directedAngleDeg(toPrev, toNegative, closingDirection);

        // Pivot 1 is the smaller directed angle on closing direction.
        // Pivot 2 is the opposite candidate.
        return anglePositive <= angleNegative ? pivotCandidates.negative : pivotCandidates.positive;
    }

    _collectPivot2ByPointIndex(skeleton, directionByPoint, pivotRadius) {
        const map = {};

        for (let i = 1; i < skeleton.points.length - 1; i++) {
            const point = skeleton.points[i];
            const prev = skeleton.points[i - 1];
            const next = skeleton.points[i + 1];
            const pivot = point.findPivot(prev, next, pivotRadius);
            if (!pivot) continue;

            const closingDirection = directionByPoint?.[i]?.closingDirection;
            const pivot2 = this._selectPivot2Candidate(point, prev, pivot, closingDirection);
            if (!pivot2) continue;

            map[i] = { x: pivot2.x, y: pivot2.y };
        }

        return map;
    }

    generateFromSeries(series, options = {}) {
        this.clear();

        const pivotRadius = Number.isFinite(options.pivotRadius) ? options.pivotRadius : 50;
        const initialFrameIndex = Number.isInteger(options.frameIndex)
            ? options.frameIndex
            : 0;

        let skeleton = series?.getFrame?.(initialFrameIndex) || null;
        if (!skeleton) {
            const firstFrameIndex = (series?.getFrameIndices?.() || [])[0];
            skeleton = Number.isInteger(firstFrameIndex) ? series.getFrame(firstFrameIndex) : null;
        }

        if (!skeleton || !Array.isArray(skeleton.points) || skeleton.points.length < 2) {
            return this;
        }

        const comparison = series?.compareInitialToLastFrameAngles?.() || { pointDirections: {} };
        const directionByPoint = comparison.pointDirections || {};
        const pivot2ByIndex = this._collectPivot2ByPointIndex(skeleton, directionByPoint, pivotRadius);

        const points = skeleton.points;
        const lastIndex = points.length - 1;

        // Initial link: sk[0], sk[1], pivot2[1], derived 4th point.
        if (points.length >= 3 && pivot2ByIndex[1]) {
            const anchor = points[0];
            const second = points[1];
            const pivot2 = pivot2ByIndex[1];
            const fourth = Mechanism._computeTerminalFourthPoint(anchor, second, pivot2);
            if (fourth) {
                const ordered = Mechanism._orderQuadWithoutIntersection([anchor, second, pivot2, fourth], anchor);
                this.addLinkFromWorldPoints(ordered);
            }
        }

        // Middle links: sk[i], pivot2[i], sk[i+1], pivot2[i+1], ordered to avoid intersections.
        for (let i = 1; i <= lastIndex - 2; i++) {
            const pA = points[i];
            const pB = points[i + 1];
            const pivotA = pivot2ByIndex[i];
            const pivotB = pivot2ByIndex[i + 1];
            if (!pivotA || !pivotB) continue;

            const ordered = Mechanism._orderQuadWithoutIntersection([pA, pivotA, pB, pivotB], pA);
            this.addLinkFromWorldPoints(ordered);
        }

        // Final link mirrors initial pattern at tail.
        if (points.length >= 3 && pivot2ByIndex[lastIndex - 1]) {
            const anchor = points[lastIndex];
            const second = points[lastIndex - 1];
            const pivot2 = pivot2ByIndex[lastIndex - 1];
            const fourth = Mechanism._computeTerminalFourthPoint(anchor, second, pivot2);
            if (fourth) {
                const ordered = Mechanism._orderQuadWithoutIntersection([anchor, second, pivot2, fourth], anchor);
                this.addLinkFromWorldPoints(ordered);
            }
        }

        return this;
    }

    draw(ctx, options = {}) {
        if (!ctx) return;

        this.links.forEach((link) => {
            link.draw(ctx, {
                strokeStyle: options.strokeStyle,
                fillStyle: options.fillStyle,
                lineWidth: options.lineWidth
            });
        });
    }
}

window.Link = Link;
window.Mechanism = Mechanism;
