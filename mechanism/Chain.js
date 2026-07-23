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

    static _withIsPivot(point, isPivot) {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
        }

        return {
            x,
            y,
            isPivot: Boolean(isPivot)
        };
    }

    static _computeTerminalFourthPoint(anchorPoint, skeletonPoint, refPoint) {
        const axis = Chain._normalize({
            x: skeletonPoint.x - anchorPoint.x,
            y: skeletonPoint.y - anchorPoint.y
        });
        if (!axis) return null;

        // Intersect:
        // 1) line through ref, parallel to anchor->skeleton axis
        // 2) line through anchor point, perpendicular to axis
        // This enforces:
        // - (anchor->skeleton) dot (anchor->new) = 0
        // - (anchor->skeleton) parallel (ref->new)
        const t = (anchorPoint.x - refPoint.x) * axis.x + (anchorPoint.y - refPoint.y) * axis.y;
        return {
            x: refPoint.x + axis.x * t,
            y: refPoint.y + axis.y * t
        };
    }

    _selectRefCandidate(point, prevPoint, refCandidates, closingDirection, refKind = 'ref1') {
        if (!refCandidates || (closingDirection !== 'clockwise' && closingDirection !== 'counterclockwise')) {
            return null;
        }

        const toPrev = {
            x: prevPoint.x - point.x,
            y: prevPoint.y - point.y
        };

        const toPositive = {
            x: refCandidates.positive.x - point.x,
            y: refCandidates.positive.y - point.y
        };

        const toNegative = {
            x: refCandidates.negative.x - point.x,
            y: refCandidates.negative.y - point.y
        };

        const anglePositive = Chain._directedAngleDeg(toPrev, toPositive, closingDirection);
        const angleNegative = Chain._directedAngleDeg(toPrev, toNegative, closingDirection);

        const refPrimary = anglePositive <= angleNegative ? refCandidates.positive : refCandidates.negative;
        const refSecondary = anglePositive <= angleNegative ? refCandidates.negative : refCandidates.positive;
        if (refKind === 'ref2') return refPrimary;
        return refSecondary;
    }

    _collectRefByPointIndex(skeleton, directionByPoint, refRadius, refKind = 'ref1') {
        const map = {};

        for (let i = 1; i < skeleton.points.length - 1; i++) {
            const point = skeleton.points[i];
            const prev = skeleton.points[i - 1];
            const next = skeleton.points[i + 1];
            const refCandidates = point.findReferencePoints(prev, next, refRadius);
            if (!refCandidates) continue;

            const closingDirection = directionByPoint?.[i]?.closingDirection;
            const chosenRef = this._selectRefCandidate(point, prev, refCandidates, closingDirection, refKind);
            if (!chosenRef) continue;

            map[i] = { x: chosenRef.x, y: chosenRef.y };
        }

        return map;
    }

    generateFromSeries(series, options = {}) {
        this.clear();

        const refRadius = Number.isFinite(options.refRadius) ? Number(options.refRadius) : 50;
        const refKind = options.refKind === 'ref2' ? 'ref2' : 'ref1';
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
        const refByIndex = this._collectRefByPointIndex(skeleton, directionByPoint, refRadius, refKind);

        const points = skeleton.points;
        const lastIndex = points.length - 1;

        // Initial link: sk[0], sk[1], ref[1], derived 4th point.
        if (points.length >= 3 && refByIndex[1]) {
            const anchor = Chain._withIsPivot(points[0], true);
            const second = Chain._withIsPivot(points[1], true);
            const refPoint = Chain._withIsPivot(refByIndex[1], false);
            if (anchor && second && refPoint) {
                const fourth = Chain._computeTerminalFourthPoint(anchor, second, refPoint);
                if (fourth) {
                    const ordered = Chain._orderQuadWithoutIntersection([
                        anchor,
                        second,
                        refPoint,
                        Chain._withIsPivot(fourth, false)
                    ], anchor);
                    this.addLinkFromWorldPoints(ordered, {
                        role: 'initial',
                        anchorPointIndex: 0,
                        segmentIndex: 0,
                        refKind
                    });
                }
            }
        }

        // Middle links: sk[i], ref[i], sk[i+1], ref[i+1], ordered to avoid intersections.
        for (let i = 1; i <= lastIndex - 2; i++) {
            const pA = Chain._withIsPivot(points[i], true);
            const pB = Chain._withIsPivot(points[i + 1], true);
            const refA = Chain._withIsPivot(refByIndex[i], false);
            const refB = Chain._withIsPivot(refByIndex[i + 1], false);
            if (!refA || !refB) continue;
            if (!pA || !pB) continue;

            const ordered = Chain._orderQuadWithoutIntersection([pA, refA, pB, refB], pA);
            this.addLinkFromWorldPoints(ordered, {
                role: 'middle',
                anchorPointIndex: i,
                segmentIndex: i,
                refKind
            });
        }

        // Final link keeps the same geometry but re-anchors to the
        // second-last skeleton point so the tail joint uses that ref point.
        if (points.length >= 3 && refByIndex[lastIndex - 1]) {
            const anchor = Chain._withIsPivot(points[lastIndex], true);
            const second = Chain._withIsPivot(points[lastIndex - 1], true);
            const refPoint = Chain._withIsPivot(refByIndex[lastIndex - 1], false);
            if (anchor && second && refPoint) {
                const fourth = Chain._computeTerminalFourthPoint(anchor, second, refPoint);
                if (fourth) {
                    const ordered = Chain._orderQuadWithoutIntersection([
                        anchor,
                        second,
                        refPoint,
                        Chain._withIsPivot(fourth, false)
                    ], anchor);
                    const reanchored = Chain._rotateStart(ordered, second);
                    this.addLinkFromWorldPoints(reanchored, {
                        role: 'final',
                        anchorPointIndex: lastIndex - 1,
                        segmentIndex: lastIndex - 1,
                        refKind
                    });
                }
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

    static _isSamePoint(a, b, tolerance = 1e-5) {
        if (!a || !b) return false;
        return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) <= tolerance;
    }

    static _collectTwinCombinedPoints(link, tolerance = 1e-5) {
        const ownPoints = Array.isArray(link?.getWorldPoints?.()) ? link.getWorldPoints() : [];
        const twinPoints = Array.isArray(link?.twin?.getWorldPoints?.()) ? link.twin.getWorldPoints() : [];

        const combined = ownPoints.map((point) => ({
            x: Number(point.x),
            y: Number(point.y),
            isPivot: Boolean(point?.isPivot)
        }));

        twinPoints.forEach((point) => {
            const pointCopy = {
                x: Number(point.x),
                y: Number(point.y),
                isPivot: Boolean(point?.isPivot)
            };
            if (!Number.isFinite(pointCopy.x) || !Number.isFinite(pointCopy.y)) return;

            const duplicate = combined.some((existing) => Chain._isSamePoint(existing, pointCopy, tolerance));
            if (!duplicate) {
                combined.push(pointCopy);
            }
        });

        return combined;
    }

    drawTwinCombined(ctx, options = {}) {
        if (!ctx) return;

        const baseStrokeStyle = options.baseStrokeStyle || 'rgba(132, 204, 22, 0.95)';
        const baseFillStyle = options.baseFillStyle || 'rgba(132, 204, 22, 0.20)';
        const mergedStrokeStyle = options.mergedStrokeStyle || 'rgba(132, 204, 22, 0.92)';
        const mergedFillStyle = options.mergedFillStyle || 'rgba(132, 204, 22, 0.16)';
        const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 2;
        const slack = Number.isFinite(options.slack) ? Number(options.slack) : null;

        this.links.forEach((link) => {
            if (!(link instanceof Link)) return;

            // Keep existing link visualization as the highlighted base.
            link.draw(ctx, {
                strokeStyle: baseStrokeStyle,
                fillStyle: baseFillStyle,
                lineWidth,
                pointStrokeStyle: baseStrokeStyle,
                anchorPointStrokeStyle: baseStrokeStyle
            });

            const combined = Chain._collectTwinCombinedPoints(link);
            link.drawPolygonFromPoints(ctx, combined, {
                strokeStyle: mergedStrokeStyle,
                fillStyle: mergedFillStyle,
                lineWidth,
                slack
            });
        });
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
