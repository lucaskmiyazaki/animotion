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


window.Line = Line;
