/**
 * Polygon Rendering Utility
 * 
 * Provides functionality to render complex merged polygons with validation,
 * slack-based modifiers, and rule checking. Extracted from Link class.
 */

/**
 * Sort points by angular position around centroid and deduplicate.
 * Preserves flags: isPivot, isTwin, isHighlight.
 */
function orderPointsNoCross(points) {
    if (!Array.isArray(points) || points.length < 3) return [];

    const unique = [];
    const eps = 1e-6;
    points.forEach((point) => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        const exists = unique.some((item) => Math.hypot(item.x - x, item.y - y) <= eps);
        if (!exists) {
            unique.push({
                x,
                y,
                isPivot: Boolean(point?.isPivot),
                isTwin: Boolean(point?.isTwin),
                isHighlight: Boolean(point?.isHighlight)
            });
        }
    });

    if (unique.length < 3) return [];

    const centroid = unique.reduce(
        (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
        { x: 0, y: 0 }
    );
    centroid.x /= unique.length;
    centroid.y /= unique.length;

    return unique.sort((a, b) => {
        const aa = Math.atan2(a.y - centroid.y, a.x - centroid.x);
        const ab = Math.atan2(b.y - centroid.y, b.x - centroid.x);
        return aa - ab;
    });
}

/**
 * Extract unique pivot points from a point list (with deduplication by tolerance).
 */
function collectUniquePivotPoints(points, tolerance = 1e-6) {
    if (!Array.isArray(points) || points.length === 0) return [];

    const uniquePivots = [];

    points.forEach((point) => {
        if (!point?.isPivot) return;

        const x = Number(point.x);
        const y = Number(point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        const exists = uniquePivots.some((existing) => Math.hypot(existing.x - x, existing.y - y) <= tolerance);
        if (!exists) {
            uniquePivots.push({ x, y, isPivot: true });
        }
    });

    return uniquePivots;
}

/**
 * Find the nearest pivot point to a given pivot (excluding the point itself).
 */
function closestOtherPivot(point, pivotPoints) {
    let closest = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

    pivotPoints.forEach((candidate) => {
        if (candidate === point) return;

        const dx = candidate.x - point.x;
        const dy = candidate.y - point.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            closest = candidate;
        }
    });

    return closest;
}

/**
 * Check if two line segments intersect (robust geometric test with collinear handling).
 */
function segmentsIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => {
        return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    };
    const onSegment = (p, q, r) => {
        return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
               q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
    };
    const collinear = (p, q, r) => {
        return Math.abs((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)) < 1e-10;
    };

    // Check if all points are collinear.
    if (collinear(p1, p2, p3) && collinear(p2, p3, p4)) {
        // All collinear; check for overlap.
        return onSegment(p1, p3, p2) || onSegment(p1, p4, p2) ||
               onSegment(p3, p1, p4) || onSegment(p3, p2, p4);
    }

    // General case: segments intersect if they straddle each other.
    const o1 = ccw(p1, p2, p3);
    const o2 = ccw(p1, p2, p4);
    const o3 = ccw(p3, p4, p1);
    const o4 = ccw(p3, p4, p2);

    if (o1 !== o2 && o3 !== o4) return true;

    // Collinear special cases.
    if (collinear(p1, p3, p2) && onSegment(p1, p3, p2)) return true;
    if (collinear(p1, p4, p2) && onSegment(p1, p4, p2)) return true;
    if (collinear(p3, p1, p4) && onSegment(p3, p1, p4)) return true;
    if (collinear(p3, p2, p4) && onSegment(p3, p2, p4)) return true;

    return false;
}

/**
 * Check if a polygon has any self-intersecting edges.
 */
function polygonHasIntersections(cycle) {
    const n = cycle.length;
    for (let i = 0; i < n; i++) {
        const edgeStart = cycle[i];
        const edgeEnd = cycle[(i + 1) % n];

        for (let j = i + 2; j < n; j++) {
            if (j === n - 1 && i === 0) continue; // Skip last vs first (share endpoint).

            const otherStart = cycle[j];
            const otherEnd = cycle[(j + 1) % n];

            if (segmentsIntersect(edgeStart, edgeEnd, otherStart, otherEnd)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Comprehensive rule validation for merged polygons.
 * Checks: inclusion of all points, adjacency constraints, minimum count, intersections.
 */
function checkRuleViolations(cycle, allInputPoints, modifiers) {
    const violations = [];
    const n = cycle.length;

    // Helper to identify reference points (own-link non-pivot, non-twin, non-modifier vertices).
    const isReferencePoint = (p) => !p.isPivot && !p.isTwin && !p.isHighlight;

    // Condition 1: Check that all input points are present in the final polygon.
    const inputSet = new Set();
    allInputPoints.forEach((p) => {
        inputSet.add(JSON.stringify({ x: p.x.toFixed(6), y: p.y.toFixed(6) }));
    });
    const modifierSet = new Set();
    modifiers.forEach((p) => {
        modifierSet.add(JSON.stringify({ x: p.x.toFixed(6), y: p.y.toFixed(6) }));
    });

    const finalSet = new Set();
    cycle.forEach((p) => {
        finalSet.add(JSON.stringify({ x: p.x.toFixed(6), y: p.y.toFixed(6) }));
    });

    inputSet.forEach((key) => {
        if (!finalSet.has(key)) {
            violations.push({
                rule: 'point-dropped-from-polygon',
                message: 'Original vertex was dropped from polygon: ' + key
            });
        }
    });

    modifierSet.forEach((key) => {
        if (!finalSet.has(key)) {
            violations.push({
                rule: 'modifier-dropped-from-polygon',
                message: 'Shape modifier was dropped from polygon: ' + key
            });
        }
    });

    // Condition 2: Shape modifier adjacency rules.
    for (let i = 0; i < n; i++) {
        const point = cycle[i];
        const prev = cycle[(i - 1 + n) % n];
        const next = cycle[(i + 1) % n];

        // Shape modifiers cannot be adjacent to own-link non-pivot vertices.
        if (point.isHighlight && (!prev.isPivot && !prev.isTwin && !prev.isHighlight)) {
            violations.push({
                rule: 'shapeModifier-adjacentToOwnRef',
                pointIndex: i,
                message: 'Shape modifier at index ' + i + ' is adjacent to own reference point at prev index ' + ((i - 1 + n) % n)
            });
        }
        if (point.isHighlight && (!next.isPivot && !next.isTwin && !next.isHighlight)) {
            violations.push({
                rule: 'shapeModifier-adjacentToOwnRef',
                pointIndex: i,
                message: 'Shape modifier at index ' + i + ' is adjacent to own reference point at next index ' + ((i + 1) % n)
            });
        }

        // Shape modifiers cannot be adjacent to other shape modifiers.
        if (point.isHighlight && prev.isHighlight) {
            violations.push({
                rule: 'shapeModifier-adjacentToModifier',
                pointIndex: i,
                message: 'Shape modifier at index ' + i + ' is adjacent to another modifier at prev index ' + ((i - 1 + n) % n)
            });
        }
        if (point.isHighlight && next.isHighlight) {
            violations.push({
                rule: 'shapeModifier-adjacentToModifier',
                pointIndex: i,
                message: 'Shape modifier at index ' + i + ' is adjacent to another modifier at next index ' + ((i + 1) % n)
            });
        }
    }

    // Condition 3: Polygon needs at least 3 distinct points.
    if (cycle.length < 3) {
        violations.push({
            rule: 'insufficient-points',
            message: 'Polygon has only ' + cycle.length + ' point(s), need at least 3'
        });
    }

    // Condition 4: Check for self-intersecting polygon and degenerate edges.
    // First check for degenerate edges (zero-length).
    for (let i = 0; i < n; i++) {
        const p0 = cycle[i];
        const p1 = cycle[(i + 1) % n];

        if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-6) {
            violations.push({
                rule: 'degenerate-edge',
                pointIndex: i,
                message: 'Polygon has degenerate (zero-length) edge between index ' + i + ' and ' + ((i + 1) % n)
            });
        }
    }

    // Check for edge intersections: edges must not cross except at endpoints.
    for (let i = 0; i < n; i++) {
        const edgeStart = cycle[i];
        const edgeEnd = cycle[(i + 1) % n];

        // Check against all non-adjacent edges (skip adjacent edges which share a vertex).
        for (let j = i + 2; j < n; j++) {
            // Avoid checking the edge that comes right before us (j would be i-1).
            if (j === n - 1 && i === 0) continue; // Skip last edge vs first edge (they share endpoint 0).

            const otherStart = cycle[j];
            const otherEnd = cycle[(j + 1) % n];

            if (segmentsIntersect(edgeStart, edgeEnd, otherStart, otherEnd)) {
                violations.push({
                    rule: 'edge-intersection',
                    pointIndex: i,
                    message: 'Edge ' + i + ' (from index ' + i + ' to ' + ((i + 1) % n) + ') intersects edge ' + j + ' (from index ' + j + ' to ' + ((j + 1) % n) + ')'
                });
            }
        }
    }

    return violations;
}

/**
 * Render a merged polygon from supplied points with slack modifiers, validation, and labels.
 * 
 * Options:
 * - strokeStyle, fillStyle, lineWidth: Canvas styling
 * - slack: offset distance for shape modifier points
 * - pivotHighlightRadius, pivotHighlightStrokeStyle, pivotHighlightFillStyle: modifier circle styling
 * - frameIndex, linkIndex: for logging context
 * - logViolations: whether to log rule violations to console
 */
function drawPolygonFromPoints(ctx, points, options = {}) {
    if (!ctx) return;

    const strokeStyle = options.strokeStyle || 'rgba(57, 166, 255, 0.95)';
    const fillStyle = options.fillStyle || 'rgba(57, 166, 255, 0.14)';
    const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 2;
    const pivotSlack = Number.isFinite(options.slack) ? Number(options.slack) : null;
    const pivotHighlightRadius = Number.isFinite(options.pivotHighlightRadius)
        ? Number(options.pivotHighlightRadius)
        : 4.5;
    const pivotHighlightStrokeStyle = options.pivotHighlightStrokeStyle || 'rgba(255, 215, 90, 0.98)';
    const pivotHighlightFillStyle = options.pivotHighlightFillStyle || 'rgba(255, 245, 180, 0.98)';
    const pivotHighlightInnerFillStyle = options.pivotHighlightInnerFillStyle || 'rgba(255, 255, 255, 0.98)';

    // Order original points and compute shape modifier points.
    const ordered = orderPointsNoCross(points);
    if (ordered.length < 3) return;

    const uniquePivots = collectUniquePivotPoints(ordered);
    const shapeModifiers = [];
    if (Number.isFinite(pivotSlack) && uniquePivots.length >= 2) {
        uniquePivots.forEach((pivot) => {
            const otherPivot = closestOtherPivot(pivot, uniquePivots);
            if (!otherPivot) return;

            const dx = otherPivot.x - pivot.x;
            const dy = otherPivot.y - pivot.y;
            const magnitude = Math.hypot(dx, dy);
            if (magnitude < 1e-8) return;

            const unitX = dx / magnitude;
            const unitY = dy / magnitude;
            shapeModifiers.push({
                x: pivot.x + unitX * pivotSlack,
                y: pivot.y + unitY * pivotSlack,
                isHighlight: true
            });
        });
    }

    // Helper to check if a point is an own-link non-pivot vertex (reference point).
    const isOwnNonPivot = (p) => !p.isPivot && !p.isTwin && !p.isHighlight;

    // Helper to check if a point is a reference point.
    const isReferencePoint = (p) => !p.isPivot && !p.isTwin && !p.isHighlight;

    // Helper to check if a shape modifier can be placed between two vertices.
    // Shape modifiers cannot be adjacent to own-link non-pivot vertices or other shape modifiers.
    const canPlaceBetween = (prev, next) => !isOwnNonPivot(prev) && !isOwnNonPivot(next) && !prev.isHighlight && !next.isHighlight;

    // Helper to validate that all reference points are adjacent to at least one other reference point.
    const validateReferencePoints = (cycle) => {
        const n = cycle.length;
        for (let i = 0; i < n; i++) {
            if (isReferencePoint(cycle[i])) {
                const prev = cycle[(i - 1 + n) % n];
                const next = cycle[(i + 1) % n];
                if (!isReferencePoint(prev) && !isReferencePoint(next)) {
                    return false;
                }
            }
        }
        return true;
    };

    // Strategy 1: Try angular sort with all points (shape modifiers + original).
    // This preserves non-intersection. Validate that all shape modifiers
    // are in positions where both neighbors are allowed (pivot or twin),
    // and all reference points are adjacent to at least one other reference point.
    let polygonPoints = ordered;
    if (shapeModifiers.length > 0) {
        const allPointsCombined = orderPointsNoCross([
            ...ordered,
            ...shapeModifiers
        ]);

        // Validate: all shape modifiers must be adjacent only to allowed neighbors,
        // and all reference points must be adjacent to at least one other reference point.
        let allModifiersValid = true;
        const n = allPointsCombined.length;
        for (let i = 0; i < n && allModifiersValid; i++) {
            if (allPointsCombined[i].isHighlight) {
                const prev = allPointsCombined[(i - 1 + n) % n];
                const next = allPointsCombined[(i + 1) % n];
                if (!canPlaceBetween(prev, next)) {
                    allModifiersValid = false;
                }
            }
        }

        if (allModifiersValid && !validateReferencePoints(allPointsCombined)) {
            allModifiersValid = false;
        }

        // Also check for self-intersections before accepting this order.
        if (allModifiersValid && !polygonHasIntersections(allPointsCombined) && allPointsCombined.length >= 3) {
            polygonPoints = allPointsCombined;
        } else if (allPointsCombined.length >= 3) {
            // Strategy 2: Greedy insertion of shape modifiers at valid positions.
            // Start with original vertices and insert each modifier at the first
            // valid position where both neighbors are allowed.
            let workingCycle = [...ordered];

            for (const modifier of shapeModifiers) {
                let bestPosition = -1;
                const cn = workingCycle.length;

                // Find the first valid insertion position in the current cycle.
                for (let i = 0; i < cn; i++) {
                    const prev = workingCycle[i];
                    const next = workingCycle[(i + 1) % cn];
                    if (canPlaceBetween(prev, next)) {
                        bestPosition = (i + 1) % cn;
                        break;
                    }
                }

                // Insert modifier at the best position if one was found.
                if (bestPosition !== -1) {
                    workingCycle.splice(bestPosition, 0, modifier);
                }
            }

            // Only use greedy result if it passes adjacency, reference, and intersection checks.
            if (workingCycle.length >= 3 && validateReferencePoints(workingCycle) && !polygonHasIntersections(workingCycle)) {
                polygonPoints = workingCycle;
            }
            // Otherwise fall back to ordered (base without modifiers).
        }
    }

    const violations = checkRuleViolations(polygonPoints, ordered, shapeModifiers);
    const logViolations = options.logViolations;
    const frameIndex = Number.isInteger(options.frameIndex) ? options.frameIndex : null;
    const linkIndex = Number.isInteger(options.linkIndex) ? options.linkIndex : null;
    
    // Only log violations if the polygon was NOT fixed (i.e., has fewer than 3 points or critical violations exist).
    const isFixed = polygonPoints.length >= 3;
    const hasCriticalViolations = violations.some(v => 
        v.rule === 'insufficient-points' || v.rule === 'point-dropped-from-polygon'
    );
    
    if (logViolations && violations.length > 0 && (!isFixed || hasCriticalViolations)) {
        const frameStr = frameIndex !== null ? `frame ${frameIndex}` : 'unknown frame';
        const polygonStr = linkIndex !== null ? `polygon ${linkIndex}` : 'polygon';
        const statusStr = isFixed ? '(fixed)' : '(UNFIXED)';
        console.log(`[Rule Violations] ${frameStr}, ${polygonStr} ${statusStr}: ${violations.length} violation(s):`);
        violations.forEach((v, idx) => {
            console.log(`  ${idx + 1}. [${v.rule}] ${v.message}`);
        });
    }

    // Draw polygon.
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.fillStyle = fillStyle;
    ctx.lineWidth = lineWidth;

    ctx.beginPath();
    ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
    for (let i = 1; i < polygonPoints.length; i++) {
        ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw shape modifier circles.
    if (shapeModifiers.length > 0) {
        ctx.lineWidth = Math.max(1, lineWidth * 0.75);
        shapeModifiers.forEach((point) => {
            ctx.beginPath();
            ctx.fillStyle = pivotHighlightFillStyle;
            ctx.strokeStyle = pivotHighlightStrokeStyle;
            ctx.arc(point.x, point.y, pivotHighlightRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.fillStyle = pivotHighlightInnerFillStyle;
            ctx.arc(point.x, point.y, Math.max(1.25, pivotHighlightRadius * 0.42), 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Draw polygon point index labels.
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    polygonPoints.forEach((point, index) => {
        const label = String(index);
        ctx.strokeText(label, point.x, point.y);
        ctx.fillText(label, point.x, point.y);
    });

    ctx.restore();
}

// Export for use in other modules
window.PolygonRenderer = {
    drawPolygonFromPoints,
    orderPointsNoCross,
    collectUniquePivotPoints,
    closestOtherPivot,
    segmentsIntersect,
    polygonHasIntersections,
    checkRuleViolations
};
