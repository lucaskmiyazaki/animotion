class Chain {
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

    addLinkFromWorldPoints(worldPoints, metadata = {}) {
        this.addLink(new Link(worldPoints, { metadata }));
    }

    clone() {
        const clone = new Chain();
        clone.links = this.links.map((link) => link.clone());
        return clone;
    }

    // Rebuild links from their current world pose so local geometry matches
    // the current frame and theta can be reset to zero.
    rebaseToCurrentPose() {
        const rebased = new Chain();
        rebased.links = this.links.map((link) => {
            const worldPoints = link.getWorldPoints();
            return new Link(worldPoints, {
                metadata: { ...(link.metadata || {}) },
                theta: 0
            });
        });
        return rebased;
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
        const center = Chain._centroid(points);
        const sorted = points.slice().sort((a, b) => {
            const aa = Math.atan2(a.y - center.y, a.x - center.x);
            const ab = Math.atan2(b.y - center.y, b.x - center.x);
            return aa - ab;
        });
        return Chain._rotateStart(sorted, startPoint);
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
        const axis = Chain._normalize({
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

    _selectPivotCandidate(point, prevPoint, pivotCandidates, closingDirection, refKind = 'ref1') {
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

        const anglePositive = Chain._directedAngleDeg(toPrev, toPositive, closingDirection);
        const angleNegative = Chain._directedAngleDeg(toPrev, toNegative, closingDirection);

        // Historical pivot mapping:
        // - pivot1: smaller directed angle on closing direction
        // - pivot2: opposite candidate
        // Swapped naming requested:
        // - ref1 maps to pivot2
        // - ref2 maps to pivot1
        const pivot1 = anglePositive <= angleNegative ? pivotCandidates.positive : pivotCandidates.negative;
        const pivot2 = anglePositive <= angleNegative ? pivotCandidates.negative : pivotCandidates.positive;
        if (refKind === 'ref2' || refKind === 'pivot1') return pivot1;
        return pivot2;
    }

    _collectPivotByPointIndex(skeleton, directionByPoint, pivotRadius, refKind = 'ref1') {
        const map = {};

        for (let i = 1; i < skeleton.points.length - 1; i++) {
            const point = skeleton.points[i];
            const prev = skeleton.points[i - 1];
            const next = skeleton.points[i + 1];
            const pivot = point.findPivot(prev, next, pivotRadius);
            if (!pivot) continue;

            const closingDirection = directionByPoint?.[i]?.closingDirection;
            const chosenPivot = this._selectPivotCandidate(point, prev, pivot, closingDirection, refKind);
            if (!chosenPivot) continue;

            map[i] = { x: chosenPivot.x, y: chosenPivot.y };
        }

        return map;
    }

    generateFromSeries(series, options = {}) {
        this.clear();

        const pivotRadius = Number.isFinite(options.pivotRadius) ? options.pivotRadius : 50;
        const refKind = options.pivotKind === 'ref2' || options.pivotKind === 'pivot1' ? 'ref2' : 'ref1';
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
        const pivotByIndex = this._collectPivotByPointIndex(skeleton, directionByPoint, pivotRadius, refKind);

        const points = skeleton.points;
        const lastIndex = points.length - 1;

        // Initial link: sk[0], sk[1], pivot[1], derived 4th point.
        if (points.length >= 3 && pivotByIndex[1]) {
            const anchor = points[0];
            const second = points[1];
            const pivotPoint = pivotByIndex[1];
            const fourth = Chain._computeTerminalFourthPoint(anchor, second, pivotPoint);
            if (fourth) {
                const ordered = Chain._orderQuadWithoutIntersection([anchor, second, pivotPoint, fourth], anchor);
                this.addLinkFromWorldPoints(ordered, {
                    role: 'initial',
                    anchorPointIndex: 0,
                    segmentIndex: 0,
                    refKind
                });
            }
        }

        // Middle links: sk[i], pivot[i], sk[i+1], pivot[i+1], ordered to avoid intersections.
        for (let i = 1; i <= lastIndex - 2; i++) {
            const pA = points[i];
            const pB = points[i + 1];
            const pivotA = pivotByIndex[i];
            const pivotB = pivotByIndex[i + 1];
            if (!pivotA || !pivotB) continue;

            const ordered = Chain._orderQuadWithoutIntersection([pA, pivotA, pB, pivotB], pA);
            this.addLinkFromWorldPoints(ordered, {
                role: 'middle',
                anchorPointIndex: i,
                segmentIndex: i,
                refKind
            });
        }

        // Final link keeps the same geometry but re-anchors to the
        // second-last skeleton point so the tail joint uses that pivot.
        if (points.length >= 3 && pivotByIndex[lastIndex - 1]) {
            const anchor = points[lastIndex];
            const second = points[lastIndex - 1];
            const pivotPoint = pivotByIndex[lastIndex - 1];
            const fourth = Chain._computeTerminalFourthPoint(anchor, second, pivotPoint);
            if (fourth) {
                const ordered = Chain._orderQuadWithoutIntersection([anchor, second, pivotPoint, fourth], anchor);
                const reanchored = Chain._rotateStart(ordered, second);
                this.addLinkFromWorldPoints(reanchored, {
                    role: 'final',
                    anchorPointIndex: lastIndex - 1,
                    segmentIndex: lastIndex - 1,
                    refKind
                });
            }
        }

        return this;
    }

    poseToSkeleton(referenceSkeleton, targetSkeleton) {
        if (!referenceSkeleton || !targetSkeleton) {
            return false;
        }

        const relative = referenceSkeleton.getRelativeJointRotations(targetSkeleton);
        if (!relative || !relative.segmentRotationByIndex) {
            return false;
        }

        this.links.forEach((link) => {
            const anchorPointIndex = link.metadata?.anchorPointIndex;
            const segmentIndex = link.metadata?.segmentIndex;
            if (!Number.isInteger(anchorPointIndex) || !Number.isInteger(segmentIndex)) {
                return;
            }

            const anchor = targetSkeleton.points[anchorPointIndex];
            if (!anchor) {
                return;
            }

            link.position.x = anchor.x;
            link.position.y = anchor.y;
            link.theta = relative.segmentRotationByIndex[segmentIndex] || 0;
        });

        return true;
    }

    static pairTwinLinks(mechanismA, mechanismB) {
        if (!(mechanismA instanceof Chain) || !(mechanismB instanceof Chain)) {
            return;
        }

        const bySegment = new Map();
        mechanismB.links.forEach((link) => {
            const segmentIndex = link.metadata?.segmentIndex;
            if (Number.isInteger(segmentIndex)) {
                bySegment.set(segmentIndex, link);
            }
        });

        mechanismA.links.forEach((linkA) => {
            const segmentIndex = linkA.metadata?.segmentIndex;
            if (!Number.isInteger(segmentIndex)) return;
            const twin = bySegment.get(segmentIndex) || null;
            linkA.setTwin(twin);
            if (twin) {
                twin.setTwin(linkA);
            }
        });
    }

    _computeCenterLineForLink(link) {
        if (!(link instanceof Link) || typeof link.getHoleCenterLine !== 'function') return null;
        return link.getHoleCenterLine();
    }

    _getHoleCenterLines() {
        if (!Array.isArray(this.links) || this.links.length === 0) {
            return [];
        }

        return this.links
            .map((link) => this._computeCenterLineForLink(link))
            .filter(Boolean);
    }

    static _nearestEndpointsBetweenLines(lineA, lineB) {
        const distSq = (a, b) => {
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            return dx * dx + dy * dy;
        };

        const candidates = [
            { a: lineA.start, b: lineB.start },
            { a: lineA.start, b: lineB.end },
            { a: lineA.end, b: lineB.start },
            { a: lineA.end, b: lineB.end }
        ];

        let best = candidates[0];
        let bestScore = distSq(best.a, best.b);

        for (let i = 1; i < candidates.length; i++) {
            const score = distSq(candidates[i].a, candidates[i].b);
            if (score < bestScore) {
                best = candidates[i];
                bestScore = score;
            }
        }

        return best;
    }

    getHoleLineLength() {
        const centerLines = this._getHoleCenterLines();
        if (centerLines.length === 0) return 0;

        const segmentLength = (line) => Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);

        let total = centerLines.reduce((acc, line) => acc + segmentLength(line), 0);

        for (let i = 0; i < centerLines.length - 1; i++) {
            const pair = Chain._nearestEndpointsBetweenLines(centerLines[i], centerLines[i + 1]);
            total += Math.hypot(pair.b.x - pair.a.x, pair.b.y - pair.a.y);
        }

        return total;
    }

    drawHoles(ctx, options = {}) {
        if (!ctx || !Array.isArray(this.links) || this.links.length === 0) return;

        const strokeStyle = options.holeStrokeStyle || 'rgba(255, 80, 170, 0.95)';
        const lineWidth = Number.isFinite(options.holeLineWidth) ? options.holeLineWidth : 2;

        const centerLines = this._getHoleCenterLines();

        if (centerLines.length === 0) return;

        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;

        // Draw one center line per link.
        centerLines.forEach((line) => {
            ctx.beginPath();
            ctx.moveTo(line.start.x, line.start.y);
            ctx.lineTo(line.end.x, line.end.y);
            ctx.stroke();
        });

        // Draw lines connecting consecutive center lines.
        for (let i = 0; i < centerLines.length - 1; i++) {
            const pair = Chain._nearestEndpointsBetweenLines(centerLines[i], centerLines[i + 1]);
            ctx.beginPath();
            ctx.moveTo(pair.a.x, pair.a.y);
            ctx.lineTo(pair.b.x, pair.b.y);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawWhole(ctx, options = {}) {
        if (!ctx) return;
        this.draw(ctx, options);
        if (options.showHoles) {
            this.drawHoles(ctx, options);
        }
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


window.Chain = Chain;
