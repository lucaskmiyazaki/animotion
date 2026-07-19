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

        // Final link mirrors initial pattern at tail.
        if (points.length >= 3 && pivotByIndex[lastIndex - 1]) {
            const anchor = points[lastIndex];
            const second = points[lastIndex - 1];
            const pivotPoint = pivotByIndex[lastIndex - 1];
            const fourth = Chain._computeTerminalFourthPoint(anchor, second, pivotPoint);
            if (fourth) {
                const ordered = Chain._orderQuadWithoutIntersection([anchor, second, pivotPoint, fourth], anchor);
                this.addLinkFromWorldPoints(ordered, {
                    role: 'final',
                    anchorPointIndex: lastIndex,
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
        if (!(link instanceof Link)) return null;

        const points = link.getWorldPoints();
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

        // Choose the opposite-edge pair that is most parallel,
        // then draw the center line midway between them.
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

class Joint {
    constructor(options = {}) {
        this.k = Number.isFinite(options.k) ? Math.max(0, options.k) : 1;

        // Joint theta domain (driver variable).
        this.initialTheta = Number.isFinite(options.initialTheta) ? options.initialTheta : 0;
        this.finalTheta = Number.isFinite(options.finalTheta) ? options.finalTheta : 1;
        this._theta = Number.isFinite(options.theta) ? options.theta : 0;

        // Connected links (previous and following links for both mechanisms).
        this.prevLinkA = options.prevLinkA instanceof Link ? options.prevLinkA : null;
        this.nextLinkA = options.nextLinkA instanceof Link ? options.nextLinkA : null;
        this.prevLinkB = options.prevLinkB instanceof Link ? options.prevLinkB : null;
        this.nextLinkB = options.nextLinkB instanceof Link ? options.nextLinkB : null;

        // Per-mechanism theta references used to convert joint theta
        // into each mechanism's local relative theta.
        const currentRelA = this._readRelativeTheta(this.prevLinkA, this.nextLinkA);
        const currentRelB = this._readRelativeTheta(this.prevLinkB, this.nextLinkB);
        this.initialMechanismThetaA = Number.isFinite(options.initialMechanismThetaA)
            ? options.initialMechanismThetaA
            : currentRelA;
        this.finalMechanismThetaA = Number.isFinite(options.finalMechanismThetaA)
            ? options.finalMechanismThetaA
            : this.initialMechanismThetaA;
        this.initialMechanismThetaB = Number.isFinite(options.initialMechanismThetaB)
            ? options.initialMechanismThetaB
            : currentRelB;
        this.finalMechanismThetaB = Number.isFinite(options.finalMechanismThetaB)
            ? options.finalMechanismThetaB
            : this.initialMechanismThetaB;

        this._theta = this._clampTheta(this._theta);
        this._mechanism = null;
        this._index = -1;
    }

    get theta() {
        return this._theta;
    }

    set theta(value) {
        this._theta = this._clampTheta(value);
    }

    _readRelativeTheta(prevLink, nextLink) {
        if (!(prevLink instanceof Link) || !(nextLink instanceof Link)) return 0;
        return nextLink.theta - prevLink.theta;
    }

    _clampTheta(value) {
        const initial = Number.isFinite(this.initialTheta) ? this.initialTheta : 0;
        const final = Number.isFinite(this.finalTheta) ? this.finalTheta : initial;
        if (!Number.isFinite(value)) return initial;
        const minTheta = Math.min(initial, final);
        const maxTheta = Math.max(initial, final);
        if (value < minTheta) return minTheta;
        if (value > maxTheta) return maxTheta;
        return value;
    }

    _jointProgress() {
        const denom = this.finalTheta - this.initialTheta;
        if (!Number.isFinite(denom) || Math.abs(denom) < 1e-10) return 0;
        const t = (this.theta - this.initialTheta) / denom;
        return Math.min(1, Math.max(0, t));
    }

    _progressAt(thetaValue) {
        const denom = this.finalTheta - this.initialTheta;
        if (!Number.isFinite(denom) || Math.abs(denom) < 1e-10) return 0;
        const t = (thetaValue - this.initialTheta) / denom;
        return Math.min(1, Math.max(0, t));
    }

    _convertToMechanismTheta(initialValue, finalValue) {
        const t = this._jointProgress();
        return initialValue + (finalValue - initialValue) * t;
    }

    _convertToMechanismThetaAt(thetaValue, initialValue, finalValue) {
        const t = this._progressAt(thetaValue);
        return initialValue + (finalValue - initialValue) * t;
    }

    _applyToFollowingLinks() {
        const relA = this._convertToMechanismTheta(this.initialMechanismThetaA, this.finalMechanismThetaA);
        const relB = this._convertToMechanismTheta(this.initialMechanismThetaB, this.finalMechanismThetaB);

        if (this.prevLinkA instanceof Link && this.nextLinkA instanceof Link) {
            this.nextLinkA.theta = this.prevLinkA.theta + relA;
        }
        if (this.prevLinkB instanceof Link && this.nextLinkB instanceof Link) {
            this.nextLinkB.theta = this.prevLinkB.theta + relB;
        }
    }

    _bindMechanism(mechanism, index) {
        this._mechanism = mechanism instanceof Mechanism ? mechanism : null;
        this._index = Number.isInteger(index) ? index : -1;
    }

    // Updates this joint and propagates movement only to following links.
    setTheta(nextTheta) {
        const previousTheta = this.theta;
        const clampedTheta = this._clampTheta(nextTheta);
        if (Math.abs(clampedTheta - previousTheta) < 1e-12) {
            return this.theta;
        }

        const oldRelA = this._convertToMechanismThetaAt(
            previousTheta,
            this.initialMechanismThetaA,
            this.finalMechanismThetaA
        );
        const newRelA = this._convertToMechanismThetaAt(
            clampedTheta,
            this.initialMechanismThetaA,
            this.finalMechanismThetaA
        );
        const oldRelB = this._convertToMechanismThetaAt(
            previousTheta,
            this.initialMechanismThetaB,
            this.finalMechanismThetaB
        );
        const newRelB = this._convertToMechanismThetaAt(
            clampedTheta,
            this.initialMechanismThetaB,
            this.finalMechanismThetaB
        );

        this.theta = clampedTheta;
        if (this._mechanism instanceof Mechanism && this._index >= 0) {
            this._mechanism._propagateRigidFromJoint(this._index, {
                deltaA: newRelA - oldRelA,
                deltaB: newRelB - oldRelB,
                pivotA: this.nextLinkA ? { x: this.nextLinkA.position.x, y: this.nextLinkA.position.y } : null,
                pivotB: this.nextLinkB ? { x: this.nextLinkB.position.x, y: this.nextLinkB.position.y } : null
            });
        } else {
            this._applyToFollowingLinks();
        }
        return this.theta;
    }

    setK(nextK) {
        if (!Number.isFinite(nextK)) return this.k;
        this.k = Math.max(0, nextK);
        return this.k;
    }

    getElasticEnergy() {
        const delta = this.theta - this.initialTheta;
        return 0.5 * this.k * delta * delta;
    }
}

class Mechanism {
    constructor(options = {}) {
        this.chains = Array.isArray(options.chains)
            ? options.chains.filter((chain) => chain instanceof Chain)
            : [];
        this.joints = Array.isArray(options.joints)
            ? options.joints.filter((joint) => joint instanceof Joint)
            : [];

        this._bindJoints();
    }

    _bindJoints() {
        this.joints.forEach((joint, index) => {
            if (joint instanceof Joint) {
                joint._bindMechanism(this, index);
            }
        });
    }

    _findChainForLink(link) {
        if (!(link instanceof Link)) return null;
        for (let i = 0; i < this.chains.length; i++) {
            const chain = this.chains[i];
            if (chain instanceof Chain && Array.isArray(chain.links) && chain.links.includes(link)) {
                return chain;
            }
        }
        return null;
    }

    _rotateTailInChain(chain, startSegment, pivot, delta) {
        if (!(chain instanceof Chain) || !Array.isArray(chain.links)) return;
        if (!Number.isInteger(startSegment) || !pivot || !Number.isFinite(delta) || Math.abs(delta) < 1e-12) return;

        const c = Math.cos(delta);
        const s = Math.sin(delta);
        chain.links.forEach((link) => {
            if (!(link instanceof Link)) return;
            const seg = link.metadata?.segmentIndex;
            if (!Number.isInteger(seg) || seg < startSegment) return;

            const dx = link.position.x - pivot.x;
            const dy = link.position.y - pivot.y;
            link.position.x = pivot.x + (dx * c - dy * s);
            link.position.y = pivot.y + (dx * s + dy * c);
            link.theta += delta;
        });
    }

    _propagateRigidFromJoint(startIndex, motion = {}) {
        const joint = this.joints[startIndex];
        if (!(joint instanceof Joint)) return;

        if (joint.nextLinkA instanceof Link) {
            const chainA = this._findChainForLink(joint.nextLinkA);
            const segA = joint.nextLinkA.metadata?.segmentIndex;
            this._rotateTailInChain(chainA, segA, motion.pivotA, motion.deltaA);
        }

        if (joint.nextLinkB instanceof Link) {
            const chainB = this._findChainForLink(joint.nextLinkB);
            const segB = joint.nextLinkB.metadata?.segmentIndex;
            this._rotateTailInChain(chainB, segB, motion.pivotB, motion.deltaB);
        }
    }

    addChain(chain) {
        if (chain instanceof Chain) this.chains.push(chain);
    }

    addJoint(joint) {
        if (joint instanceof Joint) this.joints.push(joint);
    }

    setJointThetaByIndex(index, theta) {
        if (!Number.isInteger(index) || index < 0 || index >= this.joints.length) return null;
        return this.joints[index].setTheta(theta);
    }

    _capturePoseState() {
        return window.MechanismOptimization.capturePoseState(this);
    }

    _restorePoseState(state) {
        return window.MechanismOptimization.restorePoseState(this, state);
    }

    _getJointThetaVector() {
        return window.MechanismOptimization.getJointThetaVector(this);
    }

    _applyJointThetaVector(thetaVector, baseState = null) {
        return window.MechanismOptimization.applyJointThetaVector(this, thetaVector, baseState);
    }

    _objectiveForTargetHoleLength(targetLength, options = {}) {
        return window.MechanismOptimization.objectiveForTargetHoleLength(this, targetLength, options);
    }

    static _isBetterForHardConstraint(candidate, currentBest, tolerance) {
        return window.MechanismOptimization.isBetterForHardConstraint(candidate, currentBest, tolerance);
    }

    solveThetasForLength(targetLength, options = {}) {
        return window.MechanismOptimization.solveThetasForLength(this, targetLength, options);
    }

    findMinimumEnergyPoseForHoleLength(targetLength, options = {}) {
        return window.MechanismOptimization.findMinimumEnergyPoseForHoleLength(this, targetLength, options);
    }

    calculateTotalElasticEnergy() {
        return this.joints.reduce((sum, joint) => sum + joint.getElasticEnergy(), 0);
    }

    static buildRelativeThetaMap(chain) {
        const result = {};
        if (!(chain instanceof Chain) || !Array.isArray(chain.links)) return result;

        const bySegment = new Map();
        chain.links.forEach((link) => {
            const segmentIndex = link.metadata?.segmentIndex;
            if (Number.isInteger(segmentIndex)) {
                bySegment.set(segmentIndex, link);
            }
        });

        const sorted = Array.from(bySegment.keys()).sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
            const prevLink = bySegment.get(sorted[i - 1]);
            const nextLink = bySegment.get(sorted[i]);
            if (!(prevLink instanceof Link) || !(nextLink instanceof Link)) continue;
            result[sorted[i]] = nextLink.theta - prevLink.theta;
        }

        return result;
    }

    static fromTwinChains(options = {}) {
        const chainA = options.chainA instanceof Chain ? options.chainA : null;
        const chainB = options.chainB instanceof Chain ? options.chainB : null;
        const jointTheta = Number.isFinite(options.jointTheta) ? options.jointTheta : 0;

        const initialMapA = options.initialThetaBySegmentA || Mechanism.buildRelativeThetaMap(chainA);
        const finalMapA = options.finalThetaBySegmentA || initialMapA;
        const initialMapB = options.initialThetaBySegmentB || Mechanism.buildRelativeThetaMap(chainB);
        const finalMapB = options.finalThetaBySegmentB || initialMapB;
        const kByJointIndex = options.kByJointIndex || {};

        const bySegmentA = new Map();
        const bySegmentB = new Map();
        if (chainA instanceof Chain) {
            chainA.links.forEach((link) => {
                const idx = link.metadata?.segmentIndex;
                if (Number.isInteger(idx)) bySegmentA.set(idx, link);
            });
        }
        if (chainB instanceof Chain) {
            chainB.links.forEach((link) => {
                const idx = link.metadata?.segmentIndex;
                if (Number.isInteger(idx)) bySegmentB.set(idx, link);
            });
        }

        const allSegments = Array.from(new Set([...bySegmentA.keys(), ...bySegmentB.keys()])).sort((a, b) => a - b);
        const joints = [];

        for (let i = 1; i < allSegments.length; i++) {
            const prevSeg = allSegments[i - 1];
            const nextSeg = allSegments[i];

            const prevLinkA = bySegmentA.get(prevSeg) || null;
            const nextLinkA = bySegmentA.get(nextSeg) || null;
            const prevLinkB = bySegmentB.get(prevSeg) || null;
            const nextLinkB = bySegmentB.get(nextSeg) || null;

            if (!nextLinkA && !nextLinkB) continue;

            const jointIndex = joints.length;
            const k = Number.isFinite(kByJointIndex[jointIndex]) ? kByJointIndex[jointIndex] : 1;

            const initialTheta = Number.isFinite(initialMapA[nextSeg])
                ? initialMapA[nextSeg]
                : (Number.isFinite(initialMapB[nextSeg]) ? initialMapB[nextSeg] : 0);
            const finalTheta = Number.isFinite(finalMapA[nextSeg])
                ? finalMapA[nextSeg]
                : (Number.isFinite(finalMapB[nextSeg]) ? finalMapB[nextSeg] : initialTheta);
            const theta = initialTheta + (finalTheta - initialTheta) * jointTheta;

            joints.push(new Joint({
                k,
                initialTheta,
                finalTheta,
                theta,
                prevLinkA,
                nextLinkA,
                prevLinkB,
                nextLinkB,
                initialMechanismThetaA: Number.isFinite(initialMapA[nextSeg]) ? initialMapA[nextSeg] : 0,
                finalMechanismThetaA: Number.isFinite(finalMapA[nextSeg]) ? finalMapA[nextSeg] : (Number.isFinite(initialMapA[nextSeg]) ? initialMapA[nextSeg] : 0),
                initialMechanismThetaB: Number.isFinite(initialMapB[nextSeg]) ? initialMapB[nextSeg] : 0,
                finalMechanismThetaB: Number.isFinite(finalMapB[nextSeg]) ? finalMapB[nextSeg] : (Number.isFinite(initialMapB[nextSeg]) ? initialMapB[nextSeg] : 0)
            }));
        }

        return new Mechanism({
            chains: [chainA, chainB].filter(Boolean),
            joints
        });
    }
}

window.Link = Link;
window.Chain = Chain;
window.Joint = Joint;
window.Mechanism = Mechanism;
