/**
 * Polygon Rendering Utility
 *
 * Builds and renders a polygon containing:
 * - original polygon points;
 * - pivot points;
 * - twin reference points;
 * - own reference points;
 * - shape modifiers generated from pivots.
 *
 * The final polygon must:
 * - contain every valid input point;
 * - contain every generated shape modifier;
 * - form one closed cycle;
 * - not intersect itself;
 * - satisfy all point-neighbor rules.
 */

/**
 * Main public function.
 *
 * Keeps the same input and output behavior as the original function:
 *
 * Input:
 * - ctx: CanvasRenderingContext2D
 * - points: array of polygon point objects
 * - options: rendering and geometry options
 *
 * Output:
 * - no return value;
 * - draws directly to the supplied Canvas context.
 */
function drawPolygonFromPoints(ctx, points, options = {}) {
    if (!ctx) return;

    const config = normalizePolygonOptions(options);

    // 1. Clean the input points.
    const originalPoints = sanitizePolygonPoints(
        points,
        config.pointTolerance
    );

    if (originalPoints.length < 3) {
        logInvalidPolygonInput(originalPoints, config);
        return;
    }

    // 2. Find the two pivots.
    const pivotPoints = collectUniquePivotPoints(
        originalPoints,
        config.pointTolerance
    );

    if (pivotPoints.length !== 2) {
        if (config.logViolations) {
            console.log(
                `[Polygon Error] Expected 2 pivots, found ${pivotPoints.length}`
            );
        }

        return;
    }

    // 3. Generate one modifier for each pivot.
    const shapeModifiers = generateShapeModifiers(
        pivotPoints,
        config.slack,
        config.pointTolerance
    );

    if (shapeModifiers.length !== 2) {
        if (config.logViolations) {
            console.log(
                `[Polygon Error] Expected 2 shape modifiers, found ${shapeModifiers.length}`
            );
        }

        return;
    }

    // 4. Reconnect all points into one ordered polygon.
    const polygonPoints = reconnectPolygonPoints({
        originalPoints,
        pivotPoints,
        shapeModifiers,
        tolerance: config.pointTolerance
    });

    /*
     * Reconnection failed.
     *
     * Do not validate an empty cycle, because that would produce
     * misleading errors saying every original point and modifier
     * is missing.
     */
    if (polygonPoints.length === 0) {
        if (config.logViolations) {
            console.log(
                '[Polygon Error] Could not construct a valid polygon cycle'
            );
        }

        return;
    }

    // 5. Validate the reconstructed polygon.
    const violations = validatePolygonCycle({
        cycle: polygonPoints,
        originalPoints,
        shapeModifiers,
        tolerance: config.pointTolerance
    });

    if (violations.length > 0) {
        if (config.logViolations) {
            logPolygonViolations(violations, config);
        }

        return;
    }

    // 6. Draw the valid polygon.
    drawPolygonShape(ctx, polygonPoints, config);
    //drawShapeModifiers(ctx, shapeModifiers, config);

    // Optional debugging labels.
    // drawPolygonPointLabels(ctx, polygonPoints, config);
}

/**
 * Convert the options object into one normalized configuration object.
 *
 * Responsibilities:
 * - apply default colors;
 * - apply default line widths;
 * - normalize slack;
 * - normalize tolerances;
 * - preserve frame and link indexes for logging.
 */
function normalizePolygonOptions(options = {}) {
    return {
        strokeStyle:
            options.strokeStyle ||
            'rgba(57, 166, 255, 0.95)',

        fillStyle:
            options.fillStyle ||
            'rgba(57, 166, 255, 0.14)',

        lineWidth:
            Number.isFinite(options.lineWidth)
                ? Number(options.lineWidth)
                : 2,

        slack:
            Number.isFinite(options.slack)
                ? Number(options.slack)
                : null,

        pointTolerance:
            Number.isFinite(options.pointTolerance)
                ? Number(options.pointTolerance)
                : 1e-6,

        pivotHighlightRadius:
            Number.isFinite(options.pivotHighlightRadius)
                ? Number(options.pivotHighlightRadius)
                : 4.5,

        pivotHighlightStrokeStyle:
            options.pivotHighlightStrokeStyle ||
            'rgba(255, 215, 90, 0.98)',

        pivotHighlightFillStyle:
            options.pivotHighlightFillStyle ||
            'rgba(255, 245, 180, 0.98)',

        pivotHighlightInnerFillStyle:
            options.pivotHighlightInnerFillStyle ||
            'rgba(255, 255, 255, 0.98)',

        frameIndex:
            Number.isInteger(options.frameIndex)
                ? options.frameIndex
                : null,

        linkIndex:
            Number.isInteger(options.linkIndex)
                ? options.linkIndex
                : null,

        logViolations:
            Boolean(options.logViolations)
    };
}

/**
 * Generate shape modifiers from the pivot points.
 *
 * For each eligible pivot:
 * - find the other associated pivot;
 * - calculate the direction from this pivot toward the other pivot;
 * - place the modifier on that line;
 * - position it at the requested slack distance from its source pivot;
 * - record which pivot generated it.
 *
 * Each modifier should eventually contain source information such as:
 *
 * {
 *     x,
 *     y,
 *     isHighlight: true,
 *     sourcePivot: pivot
 * }
 */
/**
 * Generate one shape modifier from each of the two pivots.
 *
 * Each modifier:
 * - lies on the line connecting the two pivots;
 * - is placed `slack` units from its source pivot;
 * - stores the source pivot directly.
 */
function generateShapeModifiers(
    pivotPoints,
    slack,
    tolerance = 1e-6
) {
    if (!Array.isArray(pivotPoints)) return [];
    if (pivotPoints.length !== 2) return [];
    if (!Number.isFinite(slack)) return [];

    const slackDistance = Math.abs(Number(slack));

    if (slackDistance <= tolerance) {
        return [];
    }

    const pivotA = pivotPoints[0];
    const pivotB = pivotPoints[1];

    const dx = pivotB.x - pivotA.x;
    const dy = pivotB.y - pivotA.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= tolerance) {
        return [];
    }

    const unitX = dx / distance;
    const unitY = dy / distance;

    const modifierA = {
        x: pivotA.x + unitX * slackDistance,
        y: pivotA.y + unitY * slackDistance,

        isPivot: false,
        isTwin: false,
        isHighlight: true,

        sourcePivot: pivotA,
        modifierIndex: 0
    };

    const modifierB = {
        x: pivotB.x - unitX * slackDistance,
        y: pivotB.y - unitY * slackDistance,

        isPivot: false,
        isTwin: false,
        isHighlight: true,

        sourcePivot: pivotB,
        modifierIndex: 1
    };

    return [modifierA, modifierB];
}

/**
 * Reconstruct one ordered polygon cycle from all original points and modifiers.
 *
 * This is the central geometric helper that we will implement next.
 *
 * It must create a cycle satisfying these rules:
 *
 * 1. Every original point appears exactly once.
 * 2. Every shape modifier appears exactly once.
 * 3. Every shape modifier has exactly:
 *    - one pivot neighbor;
 *    - one twin-reference neighbor.
 * 4. The pivot neighbor must be the pivot that generated the modifier.
 * 5. Every reference point has exactly one reference-point neighbor.
 * 6. A reference may connect to:
 *    - an own reference;
 *    - a twin reference.
 * 7. No polygon edges intersect.
 * 8. No edge has zero length.
 * 9. The cycle is closed implicitly by connecting its final point to its first.
 *
 * Input:
 * {
 *     originalPoints,
 *     pivotPoints,
 *     shapeModifiers,
 *     tolerance
 * }
 *
 * Output:
 * - an ordered array of points representing the polygon boundary;
 * - returns an empty array when no valid complete cycle can be constructed.
 */
function sanitizePolygonPoints(points, tolerance = 1e-6) {
    if (!Array.isArray(points)) return [];

    const result = [];

    for (const point of points) {
        if (!point || typeof point !== 'object') continue;

        const x = Number(point.x);
        const y = Number(point.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }

        const duplicate = result.some((existing) =>
            pointsAreEqual(existing, { x, y }, tolerance)
        );

        if (duplicate) continue;

        result.push({
            ...point,
            x,
            y,
            isPivot: Boolean(point.isPivot),
            isTwin: Boolean(point.isTwin),
            isHighlight: Boolean(point.isHighlight)
        });
    }

    return result;
}

function collectUniquePivotPoints(points, tolerance = 1e-6) {
    if (!Array.isArray(points)) return [];

    const pivots = [];

    for (const point of points) {
        if (!point?.isPivot) continue;

        const duplicate = pivots.some((existing) =>
            pointsAreEqual(existing, point, tolerance)
        );

        if (!duplicate) {
            // Preserve the original object and all its metadata.
            pivots.push(point);
        }
    }

    return pivots;
}

function isPivotPoint(point) {
    return Boolean(point?.isPivot);
}

function isShapeModifier(point) {
    return Boolean(point?.isHighlight);
}

function isReferencePoint(point) {
    return (
        Boolean(point) &&
        !isPivotPoint(point) &&
        !isShapeModifier(point)
    );
}

function isTwinReferencePoint(point) {
    return (
        isReferencePoint(point) &&
        Boolean(point.isTwin)
    );
}

function pointsAreEqual(
    pointA,
    pointB,
    tolerance = 1e-6
) {
    if (!pointA || !pointB) return false;

    return Math.hypot(
        Number(pointA.x) - Number(pointB.x),
        Number(pointA.y) - Number(pointB.y)
    ) <= tolerance;
}

function reconnectPolygonPoints({
    originalPoints,
    pivotPoints,
    shapeModifiers,
    tolerance = 1e-6
}) {
    if (!Array.isArray(originalPoints)) return [];
    if (!Array.isArray(pivotPoints) || pivotPoints.length !== 2) return [];
    if (!Array.isArray(shapeModifiers) || shapeModifiers.length !== 2) return [];

    const references = originalPoints.filter(isReferencePoint);

    if (references.length !== 4) return [];

    const pivotA = pivotPoints[0];
    const pivotB = pivotPoints[1];

    const modifierA = shapeModifiers[0];
    const modifierB = shapeModifiers[1];

    for (const order of getPermutations(references)) {
        const [
            referenceA,
            referenceB,
            referenceC,
            referenceD
        ] = order;

        /*
         * OPTION 1
         *
         * Twin–twin and reference–reference:
         *
         * pivotA
         * → modifierA
         * → twin
         * → twin
         * → modifierB
         * → pivotB
         * → reference
         * → reference
         * → pivotA
         */
        if (referenceA.isTwin && referenceB.isTwin) {
            const candidate = [
                pivotA,
                modifierA,
                referenceA,
                referenceB,
                modifierB,
                pivotB,
                referenceC,
                referenceD
            ];

            const violations = [];

            validatePolygonIntersections(
                candidate,
                tolerance,
                violations
            );

            if (violations.length === 0) {
                return candidate;
            }
        }

        /*
         * OPTION 2
         *
         * Twin–reference and twin–reference:
         *
         * pivotA
         * → modifierA
         * → twin
         * → reference
         * → pivotB
         * → modifierB
         * → twin
         * → reference
         * → pivotA
         */
        if (referenceA.isTwin && referenceC.isTwin) {
            const candidate = [
                pivotA,
                modifierA,
                referenceA,
                referenceB,
                pivotB,
                modifierB,
                referenceC,
                referenceD
            ];

            const violations = [];

            validatePolygonIntersections(
                candidate,
                tolerance,
                violations
            );

            if (violations.length === 0) {
                return candidate;
            }
        }
    }

    console.log(
        '[Reconnect Error] No non-intersecting polygon order was found'
    );

    return [];
}

/**
 * Return every ordering of an array.
 *
 * Suitable here because the reference-point count is small.
 */
function getPermutations(points) {
    if (points.length <= 1) {
        return [points];
    }

    const permutations = [];

    points.forEach((point, index) => {
        const remaining = [
            ...points.slice(0, index),
            ...points.slice(index + 1)
        ];

        for (const permutation of getPermutations(remaining)) {
            permutations.push([
                point,
                ...permutation
            ]);
        }
    });

    return permutations;
}

/**
 * Check whether two points occupy the same geometric position.
 */
function pointsAreEqual(
    pointA,
    pointB,
    tolerance = 1e-6
) {
    if (!pointA || !pointB) {
        return false;
    }

    const ax = Number(pointA.x);
    const ay = Number(pointA.y);
    const bx = Number(pointB.x);
    const by = Number(pointB.y);

    if (
        !Number.isFinite(ax) ||
        !Number.isFinite(ay) ||
        !Number.isFinite(bx) ||
        !Number.isFinite(by)
    ) {
        return false;
    }

    return Math.hypot(
        ax - bx,
        ay - by
    ) <= tolerance;
}

/**
 * Find every position in `points` that geometrically
 * matches `targetPoint`.
 */
function findMatchingPointIndexes(
    points,
    targetPoint,
    tolerance = 1e-6
) {
    if (!Array.isArray(points)) {
        return [];
    }

    const matchingIndexes = [];

    points.forEach((point, index) => {
        if (
            pointsAreEqual(
                point,
                targetPoint,
                tolerance
            )
        ) {
            matchingIndexes.push(index);
        }
    });

    return matchingIndexes;
}

/**
 * CONDITION 1
 *
 * Validate that every original point and every generated
 * shape modifier appears exactly once in the final cycle.
 *
 * Violations:
 * - original-point-missing
 * - original-point-repeated
 * - modifier-missing
 * - modifier-repeated
 */
function validatePointInclusion({
    cycle,
    originalPoints,
    shapeModifiers,
    tolerance = 1e-6,
    violations
}) {
    /*
     * Check all original points.
     */
    originalPoints.forEach((point, inputIndex) => {
        const matchingIndexes =
            findMatchingPointIndexes(
                cycle,
                point,
                tolerance
            );

        if (matchingIndexes.length === 0) {
            violations.push({
                rule: 'original-point-missing',
                inputIndex,
                message:
                    `Original point ${inputIndex} is missing ` +
                    'from the polygon cycle'
            });

            return;
        }

        if (matchingIndexes.length > 1) {
            violations.push({
                rule: 'original-point-repeated',
                inputIndex,
                pointIndexes: matchingIndexes,
                message:
                    `Original point ${inputIndex} appears ` +
                    `${matchingIndexes.length} times in the polygon cycle`
            });
        }
    });

    /*
     * Check all generated shape modifiers.
     */
    shapeModifiers.forEach((modifier, modifierIndex) => {
        const matchingIndexes =
            findMatchingPointIndexes(
                cycle,
                modifier,
                tolerance
            );

        if (matchingIndexes.length === 0) {
            violations.push({
                rule: 'modifier-missing',
                modifierIndex,
                message:
                    `Shape modifier ${modifierIndex} is missing ` +
                    'from the polygon cycle'
            });

            return;
        }

        if (matchingIndexes.length > 1) {
            violations.push({
                rule: 'modifier-repeated',
                modifierIndex,
                pointIndexes: matchingIndexes,
                message:
                    `Shape modifier ${modifierIndex} appears ` +
                    `${matchingIndexes.length} times in the polygon cycle`
            });
        }
    });
}

/**
 * Detect intersections between non-adjacent polygon edges.
 */
function validatePolygonIntersections(
    cycle,
    tolerance = 1e-6,
    violations
) {
    if (!Array.isArray(cycle) || cycle.length < 4) return;

    const n = cycle.length;

    for (let i = 0; i < n; i++) {
        const a = cycle[i];
        const b = cycle[(i + 1) % n];

        for (let j = i + 1; j < n; j++) {
            const c = cycle[j];
            const d = cycle[(j + 1) % n];

            // Adjacent edges share a vertex and should not be tested.
            const areAdjacent =
                j === i ||
                j === i + 1 ||
                (i === 0 && j === n - 1);

            if (areAdjacent) continue;

            if (segmentsIntersect(a, b, c, d, tolerance)) {
                violations.push({
                    rule: 'edge-intersection',
                    pointIndex: i,
                    otherPointIndex: j,
                    message: `Edge ${i} intersects edge ${j}`
                });
            }
        }
    }
}

/**
 * Check whether two line segments intersect.
 */
function segmentsIntersect(
    a,
    b,
    c,
    d,
    tolerance = 1e-6
) {
    const orientation = (p, q, r) => {
        const value =
            (q.x - p.x) * (r.y - p.y) -
            (q.y - p.y) * (r.x - p.x);

        if (Math.abs(value) <= tolerance) return 0;

        return value > 0 ? 1 : -1;
    };

    const onSegment = (p, q, r) =>
        q.x >= Math.min(p.x, r.x) - tolerance &&
        q.x <= Math.max(p.x, r.x) + tolerance &&
        q.y >= Math.min(p.y, r.y) - tolerance &&
        q.y <= Math.max(p.y, r.y) + tolerance;

    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);

    // Normal crossing.
    if (o1 !== o2 && o3 !== o4) {
        return true;
    }

    // Collinear overlap or contact.
    if (o1 === 0 && onSegment(a, c, b)) return true;
    if (o2 === 0 && onSegment(a, d, b)) return true;
    if (o3 === 0 && onSegment(c, a, d)) return true;
    if (o4 === 0 && onSegment(c, b, d)) return true;

    return false;
}

/**
 * Validate a completed polygon cycle.
 *
 * Must detect:
 * - missing original points;
 * - missing modifiers;
 * - duplicate points;
 * - invalid modifier neighbors;
 * - invalid reference neighbors;
 * - modifier connected to the wrong pivot;
 * - degenerate edges;
 * - self-intersections;
 * - fewer than three points.
 *
 * Returns:
 * [
 *     {
 *         rule: string,
 *         pointIndex?: number,
 *         message: string
 *     }
 * ]
 */
function validatePolygonCycle({
    cycle,
    originalPoints,
    shapeModifiers,
    tolerance = 1e-6
}) {
    const violations = [];

    // The cycle itself must be an array.
    if (!Array.isArray(cycle)) {
        return [
            {
                rule: 'invalid-cycle',
                message: 'Polygon cycle must be an array'
            }
        ];
    }

    const safeOriginalPoints = Array.isArray(originalPoints)
        ? originalPoints
        : [];

    const safeShapeModifiers = Array.isArray(shapeModifiers)
        ? shapeModifiers
        : [];

    const resolvedTolerance = Number.isFinite(tolerance)
        ? Math.max(0, Number(tolerance))
        : 1e-6;

    // Rule 1: A polygon needs at least three points.
    if (cycle.length < 3) {
        violations.push({
            rule: 'insufficient-points',
            message:
                `Polygon has ${cycle.length} point(s); ` +
                'expected at least 3'
        });
    }

    // Rule 2: Every original point and modifier must appear exactly once.
    validatePointInclusion({
        cycle,
        originalPoints: safeOriginalPoints,
        shapeModifiers: safeShapeModifiers,
        tolerance: resolvedTolerance,
        violations
    });

    // Neighbor and edge validation requires a polygon-sized cycle.
    if (cycle.length >= 3) {

        // Rule 7:
        // Non-adjacent polygon edges cannot intersect.
        validatePolygonIntersections(
            cycle,
            resolvedTolerance,
            violations
        );
    }

    return violations;
}

/**
 * Draw the filled and stroked polygon boundary.
 */
function drawPolygonShape(ctx, polygonPoints, config) {
    ctx.save();

    ctx.strokeStyle = config.strokeStyle;
    ctx.fillStyle = config.fillStyle;
    ctx.lineWidth = config.lineWidth;

    ctx.beginPath();
    ctx.moveTo(
        polygonPoints[0].x,
        polygonPoints[0].y
    );

    for (let i = 1; i < polygonPoints.length; i++) {
        ctx.lineTo(
            polygonPoints[i].x,
            polygonPoints[i].y
        );
    }

    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
}

/**
 * Draw visual circles at all generated shape-modifier positions.
 *
 * This is debugging/rendering only.
 * It does not affect polygon topology.
 */
function drawShapeModifiers(ctx, shapeModifiers, config) {
    if (!Array.isArray(shapeModifiers)) return;
    if (shapeModifiers.length === 0) return;

    ctx.save();

    ctx.lineWidth = Math.max(
        1,
        config.lineWidth * 0.75
    );

    shapeModifiers.forEach((point) => {
        ctx.beginPath();
        ctx.fillStyle = config.pivotHighlightFillStyle;
        ctx.strokeStyle = config.pivotHighlightStrokeStyle;

        ctx.arc(
            point.x,
            point.y,
            config.pivotHighlightRadius,
            0,
            Math.PI * 2
        );

        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = config.pivotHighlightInnerFillStyle;

        ctx.arc(
            point.x,
            point.y,
            Math.max(
                1.25,
                config.pivotHighlightRadius * 0.42
            ),
            0,
            Math.PI * 2
        );

        ctx.fill();
    });

    ctx.restore();
}

/**
 * Log all polygon validation violations with frame and link context.
 */
function logPolygonViolations(violations, config) {
    const frameLabel =
        config.frameIndex !== null
            ? `frame ${config.frameIndex}`
            : 'unknown frame';

    const polygonLabel =
        config.linkIndex !== null
            ? `polygon ${config.linkIndex}`
            : 'polygon';

    console.log(
        `[Polygon Violations] ${frameLabel}, ${polygonLabel}: ` +
        `${violations.length} violation(s)`
    );

    violations.forEach((violation, index) => {
        console.log(
            `  ${index + 1}. ` +
            `[${violation.rule}] ` +
            violation.message
        );
    });
}

/**
 * Log malformed input that cannot form a polygon.
 */
function logInvalidPolygonInput(points, config) {
    if (!config.logViolations) return;

    const frameLabel =
        config.frameIndex !== null
            ? `frame ${config.frameIndex}`
            : 'unknown frame';

    const polygonLabel =
        config.linkIndex !== null
            ? `polygon ${config.linkIndex}`
            : 'polygon';

    console.log(
        `[Invalid Polygon Input] ${frameLabel}, ${polygonLabel}: ` +
        `received ${points.length} valid point(s), need at least 3`
    );
}

// Export for use in other browser modules.
window.PolygonRenderer = {
    drawPolygonFromPoints,

    // Geometry preparation
    sanitizePolygonPoints,
    collectUniquePivotPoints,
    generateShapeModifiers,
    reconnectPolygonPoints,

    // Validation
    validatePolygonCycle,

    // Rendering
    drawPolygonShape,
};