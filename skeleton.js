class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.lines = [];
        this.angle = 180;
    }

    updateAngle() {
        if (this.lines.length === 0) {
            this.angle = 0;
        } else if (this.lines.length === 1) {
            this.angle = 180;
        } else if (this.lines.length === 2) {
            const [l1, l2] = this.lines;

            const p1 = l1.getOtherPoint(this);
            const p2 = l2.getOtherPoint(this);

            const v1 = { x: p1.x - this.x, y: p1.y - this.y };
            const v2 = { x: p2.x - this.x, y: p2.y - this.y };

            const angle1 = Math.atan2(v1.y, v1.x);
            const angle2 = Math.atan2(v2.y, v2.x);

            let deg = (angle2 - angle1) * (180 / Math.PI);
            deg = ((deg % 360) + 360) % 360;

            this.angle = deg;
        }
    }

    findBisector(prevPoint, nextPoint) {
        const normalize = (v) => {
            const mag = Math.hypot(v.x, v.y);
            if (mag < 1e-8) return null;
            return { x: v.x / mag, y: v.y / mag };
        };

        if (!prevPoint || !nextPoint) {
            return null;
        }

        const toPrev = normalize({
            x: prevPoint.x - this.x,
            y: prevPoint.y - this.y
        });
        const toNext = normalize({
            x: nextPoint.x - this.x,
            y: nextPoint.y - this.y
        });

        if (!toPrev || !toNext) {
            return null;
        }

        const sum = {
            x: toPrev.x + toNext.x,
            y: toPrev.y + toNext.y
        };

        return normalize(sum);
    }

    findPivot(prevPoint, nextPoint, rotation_radius) {
        const normalize = (v) => {
            const mag = Math.hypot(v.x, v.y);
            if (mag < 1e-8) return null;
            return { x: v.x / mag, y: v.y / mag };
        };

        const cross = (a, b) => a.x * b.y - a.y * b.x;
        const radius = Number(rotation_radius);

        if (!prevPoint || !nextPoint || !Number.isFinite(radius) || radius <= 0) {
            return null;
        }

        const toPrev = normalize({
            x: prevPoint.x - this.x,
            y: prevPoint.y - this.y
        });
        const toNext = normalize({
            x: nextPoint.x - this.x,
            y: nextPoint.y - this.y
        });
        const bisector = this.findBisector(prevPoint, nextPoint);

        if (!toPrev || !toNext || !bisector) {
            return null;
        }

        // For a point at distance d along the bisector, perpendicular distance to
        // each neighbor vector line is d * sin(theta/2). Solve for d = r / sin(theta/2).
        const sinHalfAngle = Math.abs(cross(bisector, toPrev));
        if (sinHalfAngle < 1e-8) {
            return null;
        }

        const offset = radius / sinHalfAngle;
        return {
            positive: {
                x: this.x + bisector.x * offset,
                y: this.y + bisector.y * offset
            },
            negative: {
                x: this.x - bisector.x * offset,
                y: this.y - bisector.y * offset
            },
            bisector,
            offset
        };
    }
}

class Line {
    constructor(startPoint, endPoint) {
        this.start = startPoint;
        this.end = endPoint;
        this.angle = this.computeAngle();

        this.start.lines.push(this);
        this.end.lines.push(this);
    }

    getOtherPoint(point) {
        return point === this.start ? this.end : this.start;
    }

    computeAngle() {
        const dx = this.end.x - this.start.x;
        const dy = this.end.y - this.start.y;

        let deg = Math.atan2(dy, dx) * (180 / Math.PI);
        deg = ((deg % 360) + 360) % 360;

        return deg;
    }

    updateAngle() {
        this.angle = this.computeAngle();
    }
}

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