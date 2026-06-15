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