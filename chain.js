class Trapezoid {
    /**
     * @param {number} meanLineLength
     * @param {number} angleLeft - degrees
     * @param {number} angleRight - degrees
     * @param {number} thickness
     */
    constructor(meanLineLength, angleLeft, angleRight, thickness) {
        this.meanLineLength = meanLineLength;
        //angleLeft = angleLeft/2;
        //angleRight = angleRight/2;
        this.angleLeft = angleLeft * Math.PI / 360;
        this.angleRight = angleRight * Math.PI / 360;
        this.thickness = thickness;

        const th2 = thickness / 2;

        // Precompute points at position=0, rotation=0
        this.localPoints = [
            { x: -th2 / Math.tan(this.angleLeft), y:  th2 },                          // top-left
            { x: meanLineLength + th2 / Math.tan(this.angleRight), y:  th2 },         // top-right
            { x: meanLineLength - th2 / Math.tan(this.angleRight), y: -th2 },         // bottom-right
            { x: th2 / Math.tan(this.angleLeft), y: -th2 }                            // bottom-left
        ];
    }

    getPoints(position, rotation) {
        const rot = rotation * Math.PI / 180;
        return this.localPoints.map(p => {
            const x = Math.cos(rot) * p.x - Math.sin(rot) * p.y + position.x;
            const y = Math.sin(rot) * p.x + Math.cos(rot) * p.y + position.y;
            return { x, y };
        });
    }

    getLeftExcess() {
        const midX = (this.localPoints[0].x + this.localPoints[3].x) / 2;
        const leftExcess = Math.max(
            Math.abs(this.localPoints[0].x - midX), // top-left
            Math.abs(this.localPoints[3].x - midX)  // bottom-left
        );
        return leftExcess;
    }

    getRightExcess() {
        const midX = (this.localPoints[1].x + this.localPoints[2].x) / 2;
        const rightExcess = Math.max(
            Math.abs(this.localPoints[1].x - midX), // top-right
            Math.abs(this.localPoints[2].x - midX)  // bottom-right
        );
        return rightExcess;
    }
}

class Chain {

    constructor() {
        this.trapezoids = [];
    }

    clear() {
        this.trapezoids = [];
    }

    // Returns the closest point on segment AB to point P
    _closestPointOnLine(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-10) return { x: lineStart.x, y: lineStart.y };
        const t = Math.max(0, Math.min(1,
            ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq
        ));
        return { x: lineStart.x + t * dx, y: lineStart.y + t * dy };
    }

    // Returns the distance from point P to segment AB
    _distancePointToLine(point, lineStart, lineEnd) {
        const Q = this._closestPointOnLine(point, lineStart, lineEnd);
        return Math.hypot(point.x - Q.x, point.y - Q.y);
    }

    // Returns the allowed [min, max] relative angle for link i relative to link i-1.
    // One limit is the final relative angle (max bend). The other limit is 90° past
    // straight (0°), in the same direction as going from final toward straight.
    // e.g. finalRel = -30°: direction toward straight is positive (+), so other limit
    // = -30° + 90° = +60°. Range = [-30°, +60°].
    _getRelativeAngleLimits(linkIndex) {
        if (linkIndex === 0) return null;

        const item = this.trapezoids[linkIndex];
        const prev = this.trapezoids[linkIndex - 1];

        const finalRel = this.shortestAngleDifference(prev.finalRotation, item.finalRotation);

        // Direction from final toward straight (0°): opposite sign of finalRel
        // Other limit: 90° past straight in the same direction
        const dirTowardStraight = finalRel >= 0 ? -1 : 1;
        const otherLimit = finalRel + 90 * dirTowardStraight;

        const minRel = Math.min(finalRel, otherLimit);
        const maxRel = Math.max(finalRel, otherLimit);

        return { minRel, maxRel };
    }

    // Clamps item.rotation so its relative angle to prev stays within limits.
    _applyRelativeAngleConstraint(linkIndex) {
        if (linkIndex === 0) return;

        const limits = this._getRelativeAngleLimits(linkIndex);
        if (!limits) return;

        const item = this.trapezoids[linkIndex];
        const prev = this.trapezoids[linkIndex - 1];

        const currentRel = this.shortestAngleDifference(prev.rotation, item.rotation);
        const clampedRel = Math.max(limits.minRel, Math.min(limits.maxRel, currentRel));

        item.rotation = prev.rotation + clampedRel;
    }

    _searchBestRotationForSegment(item, targetSegment, initialGuess) {
        if (!targetSegment) {
            return initialGuess;
        }

        const linkIndex = this.trapezoids.indexOf(item);
        const limits = this._getRelativeAngleLimits(linkIndex);

        const clampRotation = (rotation) => {
            if (!limits || linkIndex === 0) return rotation;
            const prev = this.trapezoids[linkIndex - 1];
            const rel = this.shortestAngleDifference(prev.rotation, rotation);
            const clampedRel = Math.max(limits.minRel, Math.min(limits.maxRel, rel));
            return prev.rotation + clampedRel;
        };

        const evaluate = (rotation) => {
            const previousRotation = item.rotation;
            item.rotation = clampRotation(rotation);
            this.positionAllLinksFromRotations();
            const nextPivot = this._getEndingEdgeMidpoint(item, item.position, item.rotation);
            item.rotation = previousRotation;

            return {
                error: this._distancePointToLine(nextPivot, targetSegment.start, targetSegment.end),
                nextPivot
            };
        };

        let bestRotation = initialGuess;
        let bestError = Infinity;
        let center = clampRotation(initialGuess);
        let range = 180;
        let step = 15;

        for (let pass = 0; pass < 4; pass++) {
            for (let rotation = center - range; rotation <= center + range + 1e-9; rotation += step) {
                const sample = evaluate(rotation);
                if (sample.error < bestError) {
                    bestError = sample.error;
                    bestRotation = rotation;
                }
            }

            center = clampRotation(bestRotation);
            range = step;
            step = Math.max(step / 3, 0.5);
        }

        item.rotation = clampRotation(bestRotation);
        this.positionAllLinksFromRotations();

        return item.rotation;
    }

    _getEndingEdgeMidpoint(item, position, rotation) {
        const pts = item.trapezoid.getPoints(position, rotation);
        return {
            x: (pts[1].x + pts[2].x) / 2,
            y: (pts[1].y + pts[2].y) / 2
        };
    }

    // Returns the intersection point of infinite lines through (p1,p2) and (p3,p4), or null if parallel
    _lineIntersection(p1, p2, p3, p4) {
        const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
        const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
        const denom = d1x * d2y - d1y * d2x;
        if (Math.abs(denom) < 1e-10) return null; // parallel
        const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
        return { x: p1.x + t * d1x, y: p1.y + t * d1y };
    }
    buildFromSkeleton(skeleton, thickness, startX = 0, baseY = 0) {

        this.clear();

        if (skeleton.lines.length === 0) return;

        const initialAngle = skeleton.lines[0].angle; // degrees
        const angleRad = initialAngle * Math.PI / 180;
        const dirX = Math.cos(angleRad);
        const dirY = Math.sin(angleRad);

        let prev = null;

        skeleton.lines.forEach(line => {

            const meanLength = Math.hypot(
                line.end.x - line.start.x,
                line.end.y - line.start.y
            );

            const trap = new Trapezoid(
                meanLength,
                line.start.angle,
                line.end.angle,
                thickness
            );

            // Compute flat offset (distance along initial direction)
            let flatOffset;

            if (!prev) {
                flatOffset = 0;
            }
            else {
                flatOffset =
                    prev.flatOffset +
                    prev.trapezoid.meanLineLength +
                    prev.trapezoid.getRightExcess() +
                    trap.getLeftExcess();
            }

            const item = {

                trapezoid: trap,
                skeletonLine: line,

                flatOffset: flatOffset,

                // flat state: laid out along the first line's direction
                flatPosition: {
                    x: startX + flatOffset * dirX,
                    y: baseY + flatOffset * dirY
                },
                flatRotation: initialAngle,

                // final state
                finalPosition: {
                    x: line.start.x,
                    y: line.start.y
                },

                finalRotation: line.angle,

                // current state initialized as flat
                position: {
                    x: startX + flatOffset * dirX,
                    y: baseY + flatOffset * dirY
                },
                rotation: initialAngle,

                // initial animation state (can be overridden by computeStartRotationsFromRefSkeleton)
                startRotation: initialAngle

            };

            this.trapezoids.push(item);

            prev = item;

        });

        // Compute pivot points: geometric intersection of right edge of link N with left edge of link N+1
        // For the first link there is no previous, so pivot = flatPosition
        this.trapezoids[0].pivotPoint = {
            x: this.trapezoids[0].flatPosition.x,
            y: this.trapezoids[0].flatPosition.y
        };
        for (let i = 1; i < this.trapezoids.length; i++) {
            const prevItem = this.trapezoids[i - 1];
            const currItem = this.trapezoids[i];
            const prevPts = prevItem.trapezoid.getPoints(prevItem.flatPosition, prevItem.flatRotation);
            const currPts = currItem.trapezoid.getPoints(currItem.flatPosition, currItem.flatRotation);
            // right edge of prev: pts[1] (top-right) to pts[2] (bottom-right)
            // left edge of curr:  pts[0] (top-left)  to pts[3] (bottom-left)
            const pivot = this._lineIntersection(prevPts[1], prevPts[2], currPts[0], currPts[3]);
            currItem.pivotPoint = pivot || { x: currItem.flatPosition.x, y: currItem.flatPosition.y };
        }
    }


    applyFinalLayout() {

        this.trapezoids.forEach(item => {

            item.position.x = item.finalPosition.x;
            item.position.y = item.finalPosition.y;
            item.rotation = item.finalRotation;

        });

    }


    shortestAngleDifference(from, to) {
        let diff = to - from;
        diff = ((diff + 180) % 360 + 360) % 360 - 180;
        return diff;
    }

    incrementTowardsFinal(fraction) {

        this.trapezoids.forEach(item => {

            const dx =
                item.finalPosition.x -
                item.flatPosition.x;

            const dy =
                item.finalPosition.y -
                item.flatPosition.y;

            const dr =
            this.shortestAngleDifference(
                item.flatRotation,
                item.finalRotation
            );

            item.position.x += dx * fraction;
            item.position.y += dy * fraction;

            console.log(dr)
            item.rotation += dr * fraction;

        });

    }


    resetToFlat() {
        this.trapezoids.forEach(item => {
            item.rotation = item.startRotation;
        });
        this.positionAllLinksFromRotations();
    }

    // Compute startRotation for each link by greedily fitting the chain to an
    // aligned version of refSkeleton. The error is the distance from the midpoint
    // of each link's ending edge to the closest point on the corresponding frame-0
    // skeleton segment, and the frame-0 theta values are used as the initial guess.
    computeStartRotationsFromRefSkeleton(refSkeleton) {
        const trapezoids = this.trapezoids;
        if (trapezoids.length === 0 || !refSkeleton || refSkeleton.lines.length === 0) return;

        // Frame 0 path: if chain was built from the same skeleton object used as
        // reference, initial pose should exactly equal final pose.
        const sameAsReference =
            trapezoids.length === refSkeleton.lines.length &&
            trapezoids.every((item, i) => item.skeletonLine === refSkeleton.lines[i]);

        if (sameAsReference) {
            trapezoids.forEach(item => {
                item.startRotation = item.finalRotation;
                item.rotation = item.startRotation;
            });
            this.positionAllLinksFromRotations();
            return;
        }

        const currentP0 = trapezoids[0].pivotPoint;
        const currentFirstAngle = trapezoids[0].flatRotation;
        const refP0 = refSkeleton.points[0];
        const refFirstAngle = refSkeleton.lines[0].angle;

        // Align ref skeleton: rotate by angleDelta around refP0, then translate to currentP0
        const angleDelta = currentFirstAngle - refFirstAngle;
        const cosA = Math.cos(angleDelta * Math.PI / 180);
        const sinA = Math.sin(angleDelta * Math.PI / 180);

        const alignedPoints = refSkeleton.points.map(pt => {
            const dx = pt.x - refP0.x;
            const dy = pt.y - refP0.y;
            return {
                x: currentP0.x + dx * cosA - dy * sinA,
                y: currentP0.y + dx * sinA + dy * cosA
            };
        });

        const alignedLineAngles = refSkeleton.lines.map(line =>
            ((line.angle + angleDelta) % 360 + 360) % 360
        );

        const alignedSegments = refSkeleton.lines.map((line, i) => ({
            start: alignedPoints[i],
            end: alignedPoints[i + 1],
            angle: alignedLineAngles[i]
        }));

        // Greedy forward pass: for each link i, choose startRotation[i] so the
        // midpoint of its ending edge is as close as possible to the aligned
        // frame-0 skeleton segment.

        trapezoids.forEach(item => {
            item.rotation = item.startRotation;
        });
        this.positionAllLinksFromRotations();

        for (let i = 0; i < trapezoids.length; i++) {
            const item = trapezoids[i];
            if (i >= alignedSegments.length) {
                item.startRotation = alignedSegments[i] ? alignedSegments[i].angle : item.flatRotation;
                item.rotation = item.startRotation;
                this.positionAllLinksFromRotations();
                break;
            }

            const targetSegment = alignedSegments[i];
            const initialGuess = targetSegment.angle;

            item.startRotation = this._searchBestRotationForSegment(item, targetSegment, initialGuess);
            // _searchBestRotationForSegment already constrains item.rotation; sync startRotation
            item.startRotation = item.rotation;
            this.positionAllLinksFromRotations();
        }
    }

    /**
     * Position all links using current rotation values.
     * Each link rotates around its pivot point, which depends on the previous link's state.
     * Uses the pivot-based rigid body mechanism.
     */
    positionAllLinksFromRotations() {
        let currentPivot = null;

        this.trapezoids.forEach((item, i) => {
            if (i === 0) {
                currentPivot = item.pivotPoint;
            } else {
                // Enforce range-of-motion constraint before positioning
                this._applyRelativeAngleConstraint(i);

                // Transform pivot through previous link's local frame
                const prev = this.trapezoids[i - 1];
                const flatRad = prev.flatRotation * Math.PI / 180;
                const dpx = item.pivotPoint.x - prev.flatPosition.x;
                const dpy = item.pivotPoint.y - prev.flatPosition.y;
                const localX = Math.cos(flatRad) * dpx + Math.sin(flatRad) * dpy;
                const localY = -Math.sin(flatRad) * dpx + Math.cos(flatRad) * dpy;
                const curRad = prev.rotation * Math.PI / 180;
                currentPivot = {
                    x: prev.position.x + Math.cos(curRad) * localX - Math.sin(curRad) * localY,
                    y: prev.position.y + Math.sin(curRad) * localX + Math.cos(curRad) * localY
                };
            }

            // Position this link around its pivot
            const flatRad = item.flatRotation * Math.PI / 180;
            const dpx = item.flatPosition.x - item.pivotPoint.x;
            const dpy = item.flatPosition.y - item.pivotPoint.y;
            const localX = Math.cos(flatRad) * dpx + Math.sin(flatRad) * dpy;
            const localY = -Math.sin(flatRad) * dpx + Math.cos(flatRad) * dpy;
            const curRad = item.rotation * Math.PI / 180;
            item.position.x = currentPivot.x + Math.cos(curRad) * localX - Math.sin(curRad) * localY;
            item.position.y = currentPivot.y + Math.sin(curRad) * localX + Math.cos(curRad) * localY;
        });
    }

    getTrapezoids() {
        return this.trapezoids;
    }

    toSerializable() {
        return {
            trapezoids: this.trapezoids.map(item => ({
                trapezoid: {
                    meanLineLength: item.trapezoid.meanLineLength,
                    angleLeft: item.trapezoid.angleLeft * 360 / Math.PI,
                    angleRight: item.trapezoid.angleRight * 360 / Math.PI,
                    thickness: item.trapezoid.thickness
                },
                flatOffset: item.flatOffset,
                flatPosition: item.flatPosition ? { ...item.flatPosition } : null,
                flatRotation: item.flatRotation,
                finalPosition: item.finalPosition ? { ...item.finalPosition } : null,
                finalRotation: item.finalRotation,
                position: item.position ? { ...item.position } : null,
                rotation: item.rotation,
                startRotation: item.startRotation,
                pivotPoint: item.pivotPoint ? { ...item.pivotPoint } : null
            }))
        };
    }

    static fromSerializable(data) {
        const chain = new Chain();
        if (!data || !Array.isArray(data.trapezoids)) {
            return chain;
        }

        chain.trapezoids = data.trapezoids.map(item => ({
            trapezoid: new Trapezoid(
                item.trapezoid.meanLineLength,
                item.trapezoid.angleLeft * Math.PI / 360,  // Convert degrees back to radians
                item.trapezoid.angleRight * Math.PI / 360, // Convert degrees back to radians
                item.trapezoid.thickness
            ),
            flatOffset: item.flatOffset,
            flatPosition: item.flatPosition ? { ...item.flatPosition } : { x: 0, y: 0 },
            flatRotation: item.flatRotation,
            finalPosition: item.finalPosition ? { ...item.finalPosition } : { x: 0, y: 0 },
            finalRotation: item.finalRotation,
            position: item.position ? { ...item.position } : { x: 0, y: 0 },
            rotation: item.rotation,
            startRotation: item.startRotation,
            pivotPoint: item.pivotPoint ? { ...item.pivotPoint } : { x: 0, y: 0 },
            skeletonLine: null
        }));

        return chain;
    }

    exportFlatDXF(filename = "chain_flat.dxf") {

        const trapezoids = this.trapezoids;
        if (trapezoids.length === 0) return;
        let dxf = "";

        // DXF HEADER
        dxf += "0\nSECTION\n2\nHEADER\n0\nENDSEC\n";

        // ENTITIES SECTION
        dxf += "0\nSECTION\n2\nENTITIES\n";

        trapezoids.forEach(item => {

            const pts = item.trapezoid.getPoints(
                item.flatPosition,
                item.flatRotation
            );

            // Draw 4 lines per trapezoid
            for (let i = 0; i < 4; i++) {

                const p1 = pts[i];
                const p2 = pts[(i + 1) % 4];

                dxf += "0\nLINE\n";
                dxf += "8\n0\n"; // layer

                dxf += "10\n" + p1.x + "\n";
                dxf += "20\n" + (-p1.y) + "\n"; // invert Y for CAD
                dxf += "30\n0\n";

                dxf += "11\n" + p2.x + "\n";
                dxf += "21\n" + (-p2.y) + "\n";
                dxf += "31\n0\n";

            }

        });

        // END ENTITIES
        dxf += "0\nENDSEC\n0\nEOF";

        // Download
        const blob = new Blob([dxf], { type: "application/dxf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);

    }

}