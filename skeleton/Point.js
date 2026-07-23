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

    findReferencePoints(prevPoint, nextPoint, referenceRadius) {
        const radius = Number(referenceRadius);

        if (!prevPoint || !nextPoint || !Number.isFinite(radius) || radius <= 0) {
            return null;
        }

        const bisector = this.findBisector(prevPoint, nextPoint);

        if (!bisector) {
            return null;
        }

        const offset = radius;
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


window.Point = Point;
