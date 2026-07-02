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
                rotation: initialAngle

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

            item.position.x = item.flatPosition.x;
            item.position.y = item.flatPosition.y;
            item.rotation = item.flatRotation;

        });

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