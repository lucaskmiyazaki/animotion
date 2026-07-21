class Skeleton {
    constructor() {
        this.points = [];
        this.lines = [];
    }

    addPoint(x, y) {
        const p = new Point(x, y);
        this.points.push(p);
        return p;
    }

    addLine(p1, p2) {
        const l = new Line(p1, p2);
        this.lines.push(l);

        p1.updateAngle();
        p2.updateAngle();

        return l;
    }

    updateAngles() {
        this.lines.forEach(l => l.updateAngle());
        this.points.forEach(p => p.updateAngle());
    }

    updatePoint(point, x, y) {
        point.x = x;
        point.y = y;

        // update connected lines
        point.lines.forEach(line => {
            line.updateAngle();
        });

        // update this point angle
        point.updateAngle();

        // update neighbor point angles
        point.lines.forEach(line => {
            const neighbor = line.getOtherPoint(point);
            neighbor.updateAngle();
        });
    }

    updateAllGeometry() {
        this.lines.forEach(line => line.updateAngle());
        this.points.forEach(point => point.updateAngle());
    }

    computeDirectedAnglesAtPoint(pointIndex) {
        const index = Number.parseInt(pointIndex, 10);
        if (!Number.isInteger(index) || index <= 0 || index >= this.points.length - 1) {
            return null;
        }

        const current = this.points[index];
        const prev = this.points[index - 1];
        const next = this.points[index + 1];
        if (!current || !prev || !next) {
            return null;
        }

        const toPrev = { x: prev.x - current.x, y: prev.y - current.y };
        const toNext = { x: next.x - current.x, y: next.y - current.y };
        if (Math.hypot(toPrev.x, toPrev.y) < 1e-8 || Math.hypot(toNext.x, toNext.y) < 1e-8) {
            return null;
        }

        const aPrev = Math.atan2(toPrev.y, toPrev.x);
        const aNext = Math.atan2(toNext.y, toNext.x);
        const ccw = ((aNext - aPrev) * (180 / Math.PI) % 360 + 360) % 360;
        const cw = (360 - ccw) % 360;

        return {
            clockwise: cw,
            counterclockwise: ccw
        };
    }

    getRelativeJointRotations(otherSkeleton) {
        if (!otherSkeleton || !Array.isArray(otherSkeleton.points)) {
            return null;
        }

        const count = Math.min(this.points.length, otherSkeleton.points.length);
        if (count < 2) {
            return null;
        }

        const normalizeSigned = (angleRad) => {
            let value = angleRad;
            while (value > Math.PI) value -= Math.PI * 2;
            while (value < -Math.PI) value += Math.PI * 2;
            return value;
        };

        const baseSegmentAngles = [];
        const targetSegmentAngles = [];
        const segmentRotationByIndex = {};

        for (let i = 0; i < count - 1; i++) {
            const b0 = this.points[i];
            const b1 = this.points[i + 1];
            const t0 = otherSkeleton.points[i];
            const t1 = otherSkeleton.points[i + 1];

            const baseAngle = Math.atan2(b1.y - b0.y, b1.x - b0.x);
            const targetAngle = Math.atan2(t1.y - t0.y, t1.x - t0.x);

            baseSegmentAngles.push(baseAngle);
            targetSegmentAngles.push(targetAngle);
            segmentRotationByIndex[i] = normalizeSigned(targetAngle - baseAngle);
        }

        const jointRotationByIndex = {};
        for (let i = 1; i < count - 1; i++) {
            const baseRelative = normalizeSigned(baseSegmentAngles[i] - baseSegmentAngles[i - 1]);
            const targetRelative = normalizeSigned(targetSegmentAngles[i] - targetSegmentAngles[i - 1]);
            jointRotationByIndex[i] = normalizeSigned(targetRelative - baseRelative);
        }

        return {
            pointCountCompared: count,
            rootRotation: segmentRotationByIndex[0] || 0,
            segmentRotationByIndex,
            jointRotationByIndex
        };
    }

    getLength() {
        if (!Array.isArray(this.lines) || this.lines.length === 0) {
            return 0;
        }

        let total = 0;
        this.lines.forEach((line) => {
            if (!line?.start || !line?.end) return;
            total += Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
        });

        return total;
    }

    clone() {
        const newSkeleton = new Skeleton();
        const pointMap = new Map();

        this.points.forEach((oldPoint) => {
            const newPoint = newSkeleton.addPoint(oldPoint.x, oldPoint.y);
            pointMap.set(oldPoint, newPoint);
        });

        this.lines.forEach((oldLine) => {
            const newStart = pointMap.get(oldLine.start);
            const newEnd = pointMap.get(oldLine.end);
            if (newStart && newEnd) {
                newSkeleton.addLine(newStart, newEnd);
            }
        });

        newSkeleton.updateAllGeometry();
        return newSkeleton;
    }

    resample(targetPointCount) {
        if (!Array.isArray(this.points) || this.points.length < 2) {
            return null;
        }

        const requestedCount = Math.round(Number(targetPointCount));
        if (!Number.isInteger(requestedCount) || requestedCount < 2) {
            return null;
        }

        const sourcePoints = this.points;
        const cumulative = [0];
        let totalLength = 0;

        for (let i = 1; i < sourcePoints.length; i++) {
            const prev = sourcePoints[i - 1];
            const curr = sourcePoints[i];
            totalLength += Math.hypot(curr.x - prev.x, curr.y - prev.y);
            cumulative.push(totalLength);
        }

        if (!Number.isFinite(totalLength) || totalLength <= 1e-8) {
            return null;
        }

        const sampledPoints = [];
        let segmentIndex = 1;

        for (let i = 0; i < requestedCount; i++) {
            const targetDistance = (totalLength * i) / (requestedCount - 1);

            while (segmentIndex < cumulative.length - 1 && cumulative[segmentIndex] < targetDistance) {
                segmentIndex += 1;
            }

            const startIdx = Math.max(segmentIndex - 1, 0);
            const endIdx = Math.min(segmentIndex, sourcePoints.length - 1);
            const startPoint = sourcePoints[startIdx];
            const endPoint = sourcePoints[endIdx];
            const segStartDistance = cumulative[startIdx];
            const segEndDistance = cumulative[endIdx];
            const segLength = Math.max(segEndDistance - segStartDistance, 1e-8);
            const t = Math.max(0, Math.min(1, (targetDistance - segStartDistance) / segLength));

            sampledPoints.push({
                x: startPoint.x + (endPoint.x - startPoint.x) * t,
                y: startPoint.y + (endPoint.y - startPoint.y) * t
            });
        }

        const newSkeleton = new Skeleton();
        sampledPoints.forEach((point) => {
            newSkeleton.addPoint(point.x, point.y);
        });
        for (let i = 1; i < newSkeleton.points.length; i++) {
            newSkeleton.addLine(newSkeleton.points[i - 1], newSkeleton.points[i]);
        }
        newSkeleton.updateAllGeometry();
        return newSkeleton;
    }

    drawBisector(ctx, options = {}) {
        if (!ctx || !Array.isArray(this.points) || this.points.length === 0) {
            return 0;
        }

        const length = Number.isFinite(options.length) ? options.length : 50;
        const strokeStyle = options.strokeStyle || 'rgba(0, 180, 0, 0.95)';
        const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 3;

        const normalize = (v) => {
            const mag = Math.hypot(v.x, v.y);
            if (mag < 1e-8) return null;
            return { x: v.x / mag, y: v.y / mag };
        };

        let drawnCount = 0;
        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;

        for (let i = 1; i < this.points.length - 1; i++) {
            const point = this.points[i];
            const prev = this.points[i - 1];
            const next = this.points[i + 1];
            const bisector = point.findBisector(prev, next);
            if (!bisector) {
                continue;
            }

            const start = {
                x: point.x - bisector.x * length,
                y: point.y - bisector.y * length
            };
            const end = {
                x: point.x + bisector.x * length,
                y: point.y + bisector.y * length
            };

            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
            drawnCount += 1;
        }

        ctx.restore();
        return drawnCount;
    }

    drawPivot(ctx, rotation_radius, options = {}) {
        if (!ctx || !Array.isArray(this.points) || this.points.length < 3) {
            return 0;
        }

        const radius = Number(rotation_radius);
        if (!Number.isFinite(radius) || radius <= 0) {
            return 0;
        }

        const pointRadius = Number.isFinite(options.pointRadius) ? options.pointRadius : 4;
        const fillStyle = options.fillStyle || 'rgba(255, 120, 0, 0.9)';

        let drawnCount = 0;
        ctx.save();
        ctx.fillStyle = fillStyle;

        for (let i = 1; i < this.points.length - 1; i++) {
            const point = this.points[i];
            const prev = this.points[i - 1];
            const next = this.points[i + 1];
            const pivot = point.findPivot(prev, next, radius);
            if (!pivot) {
                continue;
            }

            [pivot.positive, pivot.negative].forEach((p) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, pointRadius, 0, Math.PI * 2);
                ctx.fill();
                drawnCount += 1;
            });
        }

        ctx.restore();
        return drawnCount;
    }

    drawPivotByDirection(ctx, rotation_radius, options = {}) {
        if (!ctx || !Array.isArray(this.points) || this.points.length < 3) {
            return 0;
        }

        const radius = Number(rotation_radius);
        if (!Number.isFinite(radius) || radius <= 0) {
            return 0;
        }

        const pointRadius = Number.isFinite(options.pointRadius) ? options.pointRadius : 4;
        const fillStylePivot1 = options.fillStylePivot1 || 'rgba(255, 120, 0, 0.9)';
        const fillStylePivot2 = options.fillStylePivot2 || 'rgba(255, 205, 110, 0.95)';
        const showPivot1 = Boolean(options.showPivot1);
        const showPivot2 = Boolean(options.showPivot2);
        const directionByPoint = options.directionByPoint || {};

        const getDirectedAngleDeg = (fromVec, toVec, direction) => {
            const aFrom = Math.atan2(fromVec.y, fromVec.x);
            const aTo = Math.atan2(toVec.y, toVec.x);
            const ccw = ((aTo - aFrom) * (180 / Math.PI) % 360 + 360) % 360;
            if (direction === 'counterclockwise') return ccw;
            if (direction === 'clockwise') return (360 - ccw) % 360;
            return Number.POSITIVE_INFINITY;
        };

        const chooseClosingSide = (currentPoint, prevPoint, pivotCandidates, direction) => {
            if (direction !== 'clockwise' && direction !== 'counterclockwise') {
                return null;
            }

            const toPrev = {
                x: prevPoint.x - currentPoint.x,
                y: prevPoint.y - currentPoint.y
            };

            const toPositive = {
                x: pivotCandidates.positive.x - currentPoint.x,
                y: pivotCandidates.positive.y - currentPoint.y
            };
            const toNegative = {
                x: pivotCandidates.negative.x - currentPoint.x,
                y: pivotCandidates.negative.y - currentPoint.y
            };

            const positiveAngle = getDirectedAngleDeg(toPrev, toPositive, direction);
            const negativeAngle = getDirectedAngleDeg(toPrev, toNegative, direction);
            return positiveAngle <= negativeAngle ? 'positive' : 'negative';
        };

        const getOppositeSide = (side) => {
            if (side === 'positive') return 'negative';
            if (side === 'negative') return 'positive';
            return null;
        };

        let drawnCount = 0;

        for (let i = 1; i < this.points.length - 1; i++) {
            const point = this.points[i];
            const prev = this.points[i - 1];
            const next = this.points[i + 1];
            const pivot = point.findPivot(prev, next, radius);
            if (!pivot) continue;

            const analysis = directionByPoint[i];
            const closingSide = chooseClosingSide(point, prev, pivot, analysis?.closingDirection);
            const oppositeSide = getOppositeSide(closingSide);

            if (showPivot1 && closingSide && pivot[closingSide]) {
                const p = pivot[closingSide];
                ctx.save();
                ctx.fillStyle = fillStylePivot1;
                ctx.beginPath();
                ctx.arc(p.x, p.y, pointRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                drawnCount += 1;
            }

            if (showPivot2 && oppositeSide && pivot[oppositeSide]) {
                const p = pivot[oppositeSide];
                ctx.save();
                ctx.fillStyle = fillStylePivot2;
                ctx.beginPath();
                ctx.arc(p.x, p.y, pointRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                drawnCount += 1;
            }
        }

        return drawnCount;
    }

    deletePoint(point) {
        const connectedLines = [...point.lines];
        const neighbors = connectedLines.map(l => l.getOtherPoint(point));

        // Remove connected lines from skeleton and from neighbor point refs
        connectedLines.forEach(line => {
            this.lines = this.lines.filter(l => l !== line);
            line.start.lines = line.start.lines.filter(l => l !== line);
            line.end.lines = line.end.lines.filter(l => l !== line);
        });

        // Remove the point
        this.points = this.points.filter(p => p !== point);

        // If it had exactly 2 neighbors, connect them
        if (neighbors.length === 2) {
            this.addLine(neighbors[0], neighbors[1]);
        }

        this.updateAllGeometry();
    }
}

window.Skeleton = Skeleton;
