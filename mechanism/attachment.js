function createAttachment(position, orientation, holeLength, wallThickness) {
    const cx = Number(position?.x);
    const cy = Number(position?.y);
    const ox = Number(orientation?.x);
    const oy = Number(orientation?.y);
    const innerLength = Number(holeLength);
    const wall = Number(wallThickness);

    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
    if (!Number.isFinite(innerLength) || innerLength <= 0) return null;
    if (!Number.isFinite(wall) || wall < 0) return null;

    const magnitude = Math.hypot(ox, oy);
    if (magnitude < 1e-8) return null;

    const ux = ox / magnitude;
    const uy = oy / magnitude;
    const vx = -uy;
    const vy = ux;

    const buildSquare = (sideLength) => {
        const half = sideLength / 2;
        return [
            { x: cx - ux * half - vx * half, y: cy - uy * half - vy * half },
            { x: cx + ux * half - vx * half, y: cy + uy * half - vy * half },
            { x: cx + ux * half + vx * half, y: cy + uy * half + vy * half },
            { x: cx - ux * half + vx * half, y: cy - uy * half + vy * half }
        ];
    };

    const outerLength = innerLength + 2 * wall;

    return {
        center: { x: cx, y: cy },
        orientation: { x: ux, y: uy },
        inner: buildSquare(innerLength),
        outer: buildSquare(outerLength)
    };
}

window.MechanismAttachment = {
    createAttachment
};
