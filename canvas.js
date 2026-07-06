const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// one chain per frame
const frameChains = {};

// one skeleton per frame
const frameSkeletons = {};
const frameChainBuilt = {};
const chainStateListeners = new Set();
const modeChangeListeners = new Set();
let currentFrameIndex = 0;

let drawingFinished = false;
let isAnimating = false;
let hoveredPoint = null;
let draggedPoint = null;
let selectedPoint = null;
let hasDragged = false;
let mode = 'move'; // 'create', 'edit', or 'move'
let holeEnabled = false;
let jointsEnabled = false;

// Default trapezoid thickness
const trapezoidThickness = 50;
const pointRadius = 5;
const hoverRadius = 9;
const hitRadius = 10;

function getCurrentSkeleton() {
    return frameSkeletons[currentFrameIndex] || null;
}

function getCurrentChain() {
    return frameChains[currentFrameIndex] || null;
}

function emitChainStateChange() {
    chainStateListeners.forEach(listener => listener());
}

function emitModeChange() {
    modeChangeListeners.forEach(listener => listener(mode));
}

function setFrameChainBuilt(frameIndex, built) {
    if (built) {
        frameChainBuilt[frameIndex] = true;
    } else {
        delete frameChainBuilt[frameIndex];
    }
    emitChainStateChange();
}

function markCurrentFrameChainDirty() {
    delete frameChains[currentFrameIndex];
    setFrameChainBuilt(currentFrameIndex, false);
}

function hasChainInFrame(frameIndex) {
    const frameChain = frameChains[frameIndex];
    return Boolean(frameChain && frameChain.getTrapezoids().length > 0 && frameChainBuilt[frameIndex]);
}

function hasRenderableChain() {
    return Boolean(getMainChain());
}

function ensureCurrentSkeleton() {
    if (!frameSkeletons[currentFrameIndex]) {
        frameSkeletons[currentFrameIndex] = new Skeleton();
    }
    return frameSkeletons[currentFrameIndex];
}

function setCurrentFrame(frameIndex) {
    currentFrameIndex = frameIndex;
    hoveredPoint = null;
    draggedPoint = null;

    // Interpolate the main chain (from the skeleton) for this frame
    const chain = getMainChain();
    if (chain) {
        const maxFrameIndex = window.videoControls?.getMaxFrameIndex?.() ?? 0;
        const t = maxFrameIndex > 0 ? Math.min(frameIndex / maxFrameIndex, 1) : 0;
        applyChainAtT(chain, t);
    }

    emitChainStateChange();
    redrawAll();
}

function getPointAt(x, y) {
    const skeleton = getCurrentSkeleton();
    if (!skeleton) return null;

    for (const point of skeleton.points) {
        const dx = x - point.x;
        const dy = y - point.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= hitRadius) {
            return point;
        }
    }
    return null;
}

function moveTailWithConstraints(skeleton, point, mouseX, mouseY) {
    const index = skeleton.points.indexOf(point);
    if (index < 0) return;

    if (index === 0) {
        const dx = mouseX - point.x;
        const dy = mouseY - point.y;

        skeleton.points.forEach(p => {
            p.x += dx;
            p.y += dy;
        });

        skeleton.updateAllGeometry();
        return;
    }

    const pivot = skeleton.points[index - 1];
    const oldVecX = point.x - pivot.x;
    const oldVecY = point.y - pivot.y;
    const oldLen = Math.hypot(oldVecX, oldVecY);
    if (oldLen < 1e-8) return;

    const mouseVecX = mouseX - pivot.x;
    const mouseVecY = mouseY - pivot.y;
    const mouseLen = Math.hypot(mouseVecX, mouseVecY);
    if (mouseLen < 1e-8) return;

    // Keep segment (index-1 -> index) length fixed while matching drag direction.
    const constrainedVecX = (mouseVecX / mouseLen) * oldLen;
    const constrainedVecY = (mouseVecY / mouseLen) * oldLen;

    const oldAngle = Math.atan2(oldVecY, oldVecX);
    const newAngle = Math.atan2(constrainedVecY, constrainedVecX);
    const delta = newAngle - oldAngle;

    const cos = Math.cos(delta);
    const sin = Math.sin(delta);

    for (let i = index; i < skeleton.points.length; i++) {
        const tailPoint = skeleton.points[i];
        const relX = tailPoint.x - pivot.x;
        const relY = tailPoint.y - pivot.y;

        tailPoint.x = pivot.x + relX * cos - relY * sin;
        tailPoint.y = pivot.y + relX * sin + relY * cos;
    }

    skeleton.updateAllGeometry();
}

canvas.addEventListener('click', (e) => {
    if (mode === 'create') {
        const skeleton = ensureCurrentSkeleton();

        const x = e.clientX;
        const y = e.clientY;

        const newPoint = skeleton.addPoint(x, y);

        if (skeleton.points.length > 1) {
            skeleton.addLine(
                skeleton.points[skeleton.points.length - 2],
                newPoint
            );
        }

        markCurrentFrameChainDirty();

        draw();
    } else if (mode === 'edit' || mode === 'move') {
        if (hasDragged) return;
        const x = e.clientX;
        const y = e.clientY;
        selectedPoint = getPointAt(x, y);
        redrawAll();
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (mode !== 'edit' && mode !== 'move') return;

    const x = e.clientX;
    const y = e.clientY;

    draggedPoint = getPointAt(x, y);
    hasDragged = false;
});

canvas.addEventListener('mousemove', (e) => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    hoveredPoint = getPointAt(mouseX, mouseY);

    if (mode === 'edit' && draggedPoint) {
        hasDragged = true;
        const skeleton = getCurrentSkeleton();
        if (skeleton) {
            skeleton.updatePoint(draggedPoint, mouseX, mouseY);
            markCurrentFrameChainDirty();
        }
    } else if (mode === 'move' && draggedPoint) {
        hasDragged = true;
        const skeleton = getCurrentSkeleton();
        if (skeleton) {
            moveTailWithConstraints(skeleton, draggedPoint, mouseX, mouseY);
            markCurrentFrameChainDirty();
        }
    }

    redrawAll();
});

canvas.addEventListener('mouseup', () => {
    draggedPoint = null;
});

canvas.addEventListener('mouseleave', () => {
    hoveredPoint = null;
    draggedPoint = null;
    redrawAll();
});

function drawChain(chain) {
    const trapezoids = chain.getTrapezoids();

    trapezoids.forEach(item => {
        const pts = item.trapezoid.getPoints(item.position, item.rotation);

        ctx.fillStyle = 'rgba(0,200,0,0.3)';
        ctx.strokeStyle = 'green';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);

        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (holeEnabled) {
            // Center line parallel to the top/bottom edges of each link.
            const leftMid = {
                x: (pts[0].x + pts[3].x) / 2,
                y: (pts[0].y + pts[3].y) / 2
            };
            const rightMid = {
                x: (pts[1].x + pts[2].x) / 2,
                y: (pts[1].y + pts[2].y) / 2
            };

            ctx.beginPath();
            ctx.moveTo(leftMid.x, leftMid.y);
            ctx.lineTo(rightMid.x, rightMid.y);
            ctx.strokeStyle = 'rgba(0, 80, 0, 0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    if (!jointsEnabled || trapezoids.length < 2) return;

    const cross = (a, b) => a.x * b.y - a.y * b.x;
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
    const mul = (v, s) => ({ x: v.x * s, y: v.y * s });
    const len = (v) => Math.hypot(v.x, v.y);
    const normalize = (v) => {
        const l = len(v);
        if (l < 1e-8) return { x: 1, y: 0 };
        return { x: v.x / l, y: v.y / l };
    };
    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const lineSegmentIntersection = (linePoint, lineDir, segA, segB) => {
        const segDir = sub(segB, segA);
        const denom = cross(lineDir, segDir);
        if (Math.abs(denom) < 1e-8) return null;

        const w = sub(segA, linePoint);
        const t = cross(w, segDir) / denom;
        const u = cross(w, lineDir) / denom;
        if (u < -1e-8 || u > 1 + 1e-8) return null;

        return add(linePoint, mul(lineDir, t));
    };

    const polygonIntersections = (pts, linePoint, lineDir) => {
        const edges = [
            [pts[0], pts[1]],
            [pts[1], pts[2]],
            [pts[2], pts[3]],
            [pts[3], pts[0]]
        ];
        const hits = [];
        edges.forEach(([a, b]) => {
            const hit = lineSegmentIntersection(linePoint, lineDir, a, b);
            if (hit) hits.push(hit);
        });
        return hits;
    };

    for (let i = 1; i < trapezoids.length; i++) {
        const prev = trapezoids[i - 1];
        const curr = trapezoids[i];

        const prevPts = prev.trapezoid.getPoints(prev.position, prev.rotation);
        const currPts = curr.trapezoid.getPoints(curr.position, curr.rotation);

        // Current pivot: intersection of prev right edge and curr left edge.
        const pivot = lineSegmentIntersection(
            prevPts[1],
            sub(prevPts[2], prevPts[1]),
            currPts[0],
            currPts[3]
        ) || midpoint(midpoint(prevPts[1], prevPts[2]), midpoint(currPts[0], currPts[3]));

        // Link directions from left-mid to right-mid for each adjacent link.
        const prevDir = normalize(sub(midpoint(prevPts[1], prevPts[2]), midpoint(prevPts[0], prevPts[3])));
        const currDir = normalize(sub(midpoint(currPts[1], currPts[2]), midpoint(currPts[0], currPts[3])));
        let bisector = normalize(add(prevDir, currDir));
        if (len(add(prevDir, currDir)) < 1e-8) {
            bisector = prevDir;
        }

        // Shift the line outside the links by joint thickness.
        const jointThickness = ((prev.trapezoid.thickness + curr.trapezoid.thickness) / 2) / 10;
        const normal = { x: -bisector.y, y: bisector.x };
        const anchorA = add(pivot, mul(normal, jointThickness));
        const anchorB = add(pivot, mul(normal, -jointThickness));

        const closestToAnchor = (hits) => hits.reduce((best, p) => {
            const d = Math.hypot(p.x - hits.anchor.x, p.y - hits.anchor.y);
            if (!best || d < best.d) return { p, d };
            return best;
        }, null).p;

        const buildSegment = (anchor) => {
            const prevHits = polygonIntersections(prevPts, anchor, bisector);
            const currHits = polygonIntersections(currPts, anchor, bisector);
            if (prevHits.length === 0 || currHits.length === 0) return null;

            prevHits.anchor = anchor;
            currHits.anchor = anchor;
            const start = closestToAnchor(prevHits);
            const end = closestToAnchor(currHits);
            if (!start || !end) return null;

            return {
                start,
                end,
                length: Math.hypot(end.x - start.x, end.y - start.y)
            };
        };

        const segmentA = buildSegment(anchorA);
        const segmentB = buildSegment(anchorB);
        if (!segmentA && !segmentB) continue;

        // Smaller-angle side produces the shorter bridge between adjacent links.
        const chosen = !segmentA ? segmentB : !segmentB ? segmentA : (segmentA.length <= segmentB.length ? segmentA : segmentB);
        const start = chosen.start;
        const end = chosen.end;

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = 'rgba(0, 90, 0, 0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const skeleton = getCurrentSkeleton();
    if (!skeleton) return;

    ctx.strokeStyle = 'blue';
    ctx.lineWidth = 2;

    skeleton.lines.forEach(line => {
        ctx.beginPath();
        ctx.moveTo(line.start.x, line.start.y);
        ctx.lineTo(line.end.x, line.end.y);
        ctx.stroke();
    });

    skeleton.points.forEach((point, index) => {
        const radius = point === hoveredPoint ? hoverRadius : pointRadius;

        // Mark the first point with an outer red ring.
        if (index === 0) {
            ctx.beginPath();
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.beginPath();
        if (point === selectedPoint) {
            ctx.fillStyle = 'gold';
        } else {
            ctx.fillStyle = 'red';
        }
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (point === selectedPoint) {
            ctx.strokeStyle = 'orange';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });
}

function redrawAll() {
    draw();
    const frameChain = getMainChain();
    if (frameChain) {
        console.log('redrawAll: drawing chain');
        drawChain(frameChain);
    } else {
        console.log('redrawAll: no chain to draw');
    }
}

function shortestAngleDifference(from, to) {
    let diff = to - from;
    diff = ((diff + 180) % 360 + 360) % 360 - 180;
    return diff;
}

function normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
}

// Get the main chain (the one built from the skeleton)
function getMainChain() {
    // Find the frame that has a chain
    for (const frameIndex in frameChains) {
        if (frameChains[frameIndex]) {
            console.log(`getMainChain found chain at frame ${frameIndex}`);
            return frameChains[frameIndex];
        }
    }
    console.log('getMainChain: no chain found in any frame');
    return null;
}

// Position chain at interpolation factor t (0 = initial, 1 = final)
function applyChainAtT(chain, t) {
    if (!chain || chain.getTrapezoids().length === 0) return;
    const trapezoids = chain.getTrapezoids();
    trapezoids.forEach((item, i) => {
        if (i === 0) {
            const dr = shortestAngleDifference(item.startRotation, item.finalRotation);
            item.rotation = item.startRotation + dr * t;
        } else {
            const prev = trapezoids[i - 1];
            const startRelativeRotation = shortestAngleDifference(prev.startRotation, item.startRotation);
            const finalRelativeRotation = shortestAngleDifference(prev.finalRotation, item.finalRotation);
            const relativeDelta = shortestAngleDifference(startRelativeRotation, finalRelativeRotation);
            const currentRelativeRotation = startRelativeRotation + relativeDelta * t;
            item.rotation = normalizeAngle(prev.rotation + currentRelativeRotation);
        }
    });
    chain.positionAllLinksFromRotations();
}

function animateTowardsFinal(chain, duration = 1000) {
    if (!chain || chain.getTrapezoids().length === 0) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const startTime = performance.now();

        function step(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1);

            const trapezoids = chain.getTrapezoids();

            // Update rotations: interpolate from start to final
            // positionAllLinksFromRotations will enforce range-of-motion constraints
            trapezoids.forEach((item, i) => {
                if (i === 0) {
                    const dr = shortestAngleDifference(item.startRotation, item.finalRotation);
                    item.rotation = item.startRotation + dr * t;
                } else {
                    const prev = trapezoids[i - 1];
                    const flatRelativeRotation = shortestAngleDifference(prev.startRotation, item.startRotation);
                    const finalRelativeRotation = shortestAngleDifference(prev.finalRotation, item.finalRotation);
                    const relativeDelta = shortestAngleDifference(flatRelativeRotation, finalRelativeRotation);
                    const currentRelativeRotation = flatRelativeRotation + relativeDelta * t;

                    item.rotation = normalizeAngle(prev.rotation + currentRelativeRotation);
                }
            });

            // Position all links - this enforces range-of-motion constraints on each link
            chain.positionAllLinksFromRotations();

            redrawAll();

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }

        requestAnimationFrame(step);
    });
}

function playPreviewAnimation() {
    window.videoControls?.togglePlayback?.();
}

function exportDXF() {
    // Export whichever chain is currently renderable in the viewport.
    const chain = getCurrentChain() || getMainChain();
    if (!chain || chain.getTrapezoids().length === 0) return;
    chain.exportCurrentDXF('chain_current.dxf', holeEnabled, jointsEnabled);
}

function getStoredFrameIndices() {
    return Object.keys(frameSkeletons)
        .concat(Object.keys(frameChains))
        .concat(Object.keys(frameChainBuilt))
        .map(k => Number.parseInt(k, 10))
        .filter((value, index, values) => Number.isInteger(value) && values.indexOf(value) === index)
        .sort((a, b) => b - a);
}

function removeLogicalFrameAt(frameIndex) {
    const storedFrameIndices = getStoredFrameIndices();
    const hasOwn = (store, index) => Object.prototype.hasOwnProperty.call(store, index);

    for (const index of storedFrameIndices) {
        if (index < frameIndex) {
            continue;
        }

        if (index === frameIndex) {
            delete frameSkeletons[index];
            delete frameChains[index];
            delete frameChainBuilt[index];
            continue;
        }

        if (hasOwn(frameSkeletons, index)) {
            frameSkeletons[index - 1] = frameSkeletons[index];
        } else {
            delete frameSkeletons[index - 1];
        }

        if (hasOwn(frameChains, index)) {
            frameChains[index - 1] = frameChains[index];
        } else {
            delete frameChains[index - 1];
        }

        if (hasOwn(frameChainBuilt, index)) {
            frameChainBuilt[index - 1] = frameChainBuilt[index];
        } else {
            delete frameChainBuilt[index - 1];
        }

        delete frameSkeletons[index];
        delete frameChains[index];
        delete frameChainBuilt[index];
    }
}

function deleteAllFramesWithoutPoints() {
    // Include logical frames that exist only in navigation, not just stored skeleton data.
    const currentMaxFrame = Math.max(
        ...Object.keys(frameSkeletons).map(k => parseInt(k)),
        ...Object.keys(frameChains).map(k => parseInt(k)),
        ...Object.keys(frameChainBuilt).map(k => parseInt(k)),
        window.videoControls?.getMaxFrameIndex?.() ?? -1,
        -1
    );

    if (currentMaxFrame < 0) return; // No frames at all

    // Check frames from 0 to currentMaxFrame to find which have points
    const framesWithPoints = [];
    for (let i = 0; i <= currentMaxFrame; i++) {
        const skeleton = frameSkeletons[i];
        if (skeleton && skeleton.points.length > 0) {
            framesWithPoints.push(i);
        }
    }

    if (framesWithPoints.length === 0) return; // No frames with points

    // Create mapping from old index to new index
    const indexMap = {};
    framesWithPoints.forEach((oldIdx, newIdx) => {
        indexMap[oldIdx] = newIdx;
    });

    // Create new storage with remapped indices
    const newFrameSkeletons = {};
    const newFrameChains = {};
    const newFrameChainBuilt = {};

    // Copy only frames that have points, remapped to new indices
    Object.keys(frameSkeletons).forEach(oldIdx => {
        const newIdx = indexMap[oldIdx];
        if (newIdx !== undefined) {
            newFrameSkeletons[newIdx] = frameSkeletons[oldIdx];
        }
    });

    Object.keys(frameChains).forEach(oldIdx => {
        const newIdx = indexMap[oldIdx];
        if (newIdx !== undefined) {
            newFrameChains[newIdx] = frameChains[oldIdx];
        }
    });

    Object.keys(frameChainBuilt).forEach(oldIdx => {
        const newIdx = indexMap[oldIdx];
        if (newIdx !== undefined) {
            newFrameChainBuilt[newIdx] = frameChainBuilt[oldIdx];
        }
    });

    // Clear all old data
    for (let i = 0; i <= currentMaxFrame; i++) {
        delete frameSkeletons[i];
        delete frameChains[i];
        delete frameChainBuilt[i];
    }

    // Assign new data
    Object.assign(frameSkeletons, newFrameSkeletons);
    Object.assign(frameChains, newFrameChains);
    Object.assign(frameChainBuilt, newFrameChainBuilt);

    // Update current frame index to match remapped frame
    const newCurrentFrameIndex = indexMap[currentFrameIndex];
    if (newCurrentFrameIndex !== undefined) {
        currentFrameIndex = newCurrentFrameIndex;
    } else {
        currentFrameIndex = 0;
    }

    const removedFrameIndices = [];

    for (let i = 0; i <= currentMaxFrame; i++) {
        if (!framesWithPoints.includes(i)) {
            removedFrameIndices.push(i);
        }
    }

    emitChainStateChange();
    window.videoControls?.removeFrameIndices?.(removedFrameIndices);
    window.videoControls?.showFrameIndex?.(currentFrameIndex);
}

function buildChain() {
    const skeleton = getCurrentSkeleton();
    if (!skeleton || skeleton.points.length === 0) return;

    drawingFinished = true;

    skeleton.updateAllGeometry();
    console.log(skeleton);

    const chain = new Chain();
    chain.buildFromSkeleton(
        skeleton,
        trapezoidThickness,
        skeleton.points[0].x,
        skeleton.points[0].y
    );

    frameChains[currentFrameIndex] = chain;

    setFrameChainBuilt(currentFrameIndex, true);

    deleteAllFramesWithoutPoints();

    // frameSkeletons[0] is guaranteed to exist after deleteAllFramesWithoutPoints remaps frames
    chain.computeStartRotationsFromRefSkeleton(frameSkeletons[0]);

    // Show initial position (t=0) for current frame
    const maxFrameIndex = window.videoControls?.getMaxFrameIndex?.() ?? 0;
    const t = maxFrameIndex > 0 ? Math.min(currentFrameIndex / maxFrameIndex, 1) : 0;
    applyChainAtT(chain, t);

    redrawAll();
}

function deleteSelectedPoint() {
    if (!selectedPoint) return;
    const skeleton = getCurrentSkeleton();
    if (!skeleton) return;
    skeleton.deletePoint(selectedPoint);
    selectedPoint = null;
    markCurrentFrameChainDirty();
    redrawAll();
}

function deleteAllEmptyPreviousFrames() {
    if (currentFrameIndex === 0) return;

    // Check if all frames before current are empty
    for (let i = 0; i < currentFrameIndex; i++) {
        const skeleton = frameSkeletons[i];
        if (skeleton && skeleton.points.length > 0) {
            return; // At least one previous frame has content
        }
    }

    // All previous frames are empty, delete and shift remaining frames down
    const numToDelete = currentFrameIndex;

    // Collect all frame indices across all storage objects
    const allIndices = Object.keys(frameSkeletons)
        .concat(Object.keys(frameChains))
        .concat(Object.keys(frameChainBuilt))
        .map(k => parseInt(k))
        .filter((v, i, a) => a.indexOf(v) === i) // unique values
        .sort((a, b) => b - a); // descending order

    // Shift frames down, processing from highest to lowest to avoid overwriting
    for (const idx of allIndices) {
        if (idx >= numToDelete) {
            const newIdx = idx - numToDelete;
            if (frameSkeletons[idx]) {
                frameSkeletons[newIdx] = frameSkeletons[idx];
                delete frameSkeletons[idx];
            }
            if (frameChains[idx]) {
                frameChains[newIdx] = frameChains[idx];
                delete frameChains[idx];
            }
            if (frameChainBuilt[idx]) {
                frameChainBuilt[newIdx] = frameChainBuilt[idx];
                delete frameChainBuilt[idx];
            }
        } else {
            // Delete empty frames
            delete frameSkeletons[idx];
            delete frameChains[idx];
            delete frameChainBuilt[idx];
        }
    }

    const removedFrameIndices = [];
    for (let i = 0; i < numToDelete; i++) {
        removedFrameIndices.push(i);
    }

    // Move to frame 0 and notify listeners
    currentFrameIndex = 0;
    emitChainStateChange();
    window.videoControls?.removeFrameIndices?.(removedFrameIndices);
    window.videoControls?.showFrameIndex?.(0);
}

function toggleMode() {
    if (mode === 'create') {
        mode = 'move';
        canvas.classList.remove('create-mode');
    } else if (mode === 'edit') {
        mode = 'move';
        canvas.classList.remove('create-mode');
    } else {
        mode = 'create';
        canvas.classList.add('create-mode');
    }
    draggedPoint = null;
    selectedPoint = null;
    emitModeChange();
    return mode;
}

function switchToCreateMode() {
    mode = 'create';
    canvas.classList.add('create-mode');
    draggedPoint = null;
    selectedPoint = null;
    emitModeChange();
    return mode;
}

function getMode() {
    return mode;
}

// Project state is now managed in projectState.js
// Expose state references for serialization
function exposeStateForSerialization() {
    return {
        frameSkeletons,
        frameChains,
        frameChainBuilt,
        currentFrameIndex,
        mode,
        selectedPoint,
        getCurrentSkeleton
    };
}

function cloneSkeleton(sourceSkeleton) {
    if (!sourceSkeleton) return null;

    const newSkeleton = new Skeleton();
    const pointMap = new Map();

    sourceSkeleton.points.forEach(oldPoint => {
        const newPoint = newSkeleton.addPoint(oldPoint.x, oldPoint.y);
        pointMap.set(oldPoint, newPoint);
    });

    sourceSkeleton.lines.forEach(oldLine => {
        const newStart = pointMap.get(oldLine.start);
        const newEnd = pointMap.get(oldLine.end);
        newSkeleton.addLine(newStart, newEnd);
    });

    newSkeleton.updateAllGeometry();
    return newSkeleton;
}

function exportSkeleton() {
    const skeleton = getCurrentSkeleton();
    if (!skeleton) return;

    const data = {
        points: skeleton.points.map(p => ({ id: skeleton.points.indexOf(p), x: p.x, y: p.y })),
        lines: skeleton.lines.map(l => ({
            start: skeleton.points.indexOf(l.start),
            end: skeleton.points.indexOf(l.end)
        }))
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skeleton_frame${currentFrameIndex}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function importSkeleton() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const newSkeleton = new Skeleton();
                const pointObjs = data.points.map(p => newSkeleton.addPoint(p.x, p.y));
                data.lines.forEach(l => newSkeleton.addLine(pointObjs[l.start], pointObjs[l.end]));
                newSkeleton.updateAllGeometry();
                frameSkeletons[currentFrameIndex] = newSkeleton;
                markCurrentFrameChainDirty();
                hoveredPoint = null;
                draggedPoint = null;
                selectedPoint = null;
                redrawAll();
            } catch {
                alert('Invalid skeleton file.');
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

function copyPreviousFrameSkeleton() {
    if (currentFrameIndex <= 0) return;

    const previousSkeleton = frameSkeletons[currentFrameIndex - 1];
    if (!previousSkeleton) return;

    frameSkeletons[currentFrameIndex] = cloneSkeleton(previousSkeleton);
    markCurrentFrameChainDirty();

    hoveredPoint = null;
    draggedPoint = null;
    redrawAll();
}

function autoCopyPreviousSkeletonIfEmpty() {
    if (currentFrameIndex <= 0) return;
    
    const currentSkeleton = frameSkeletons[currentFrameIndex];
    if (currentSkeleton) return; // Don't overwrite existing skeleton
    
    const previousSkeleton = frameSkeletons[currentFrameIndex - 1];
    if (!previousSkeleton) return;
    
    frameSkeletons[currentFrameIndex] = cloneSkeleton(previousSkeleton);
    markCurrentFrameChainDirty();
    redrawAll();
}

function deleteCurrentFrame() {
    const deletedFrameIndex = currentFrameIndex;

    removeLogicalFrameAt(deletedFrameIndex);
    emitChainStateChange();

    window.videoControls?.removeFrameIndices?.([deletedFrameIndex]);

    const newFrameIndex = deletedFrameIndex > 0 ? deletedFrameIndex - 1 : 0;
    window.videoControls?.showFrameIndex?.(newFrameIndex);
}

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (key === 'c' && !e.repeat) {
        copyPreviousFrameSkeleton();
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && (mode === 'edit' || mode === 'move')) {
        deleteSelectedPoint();
    }

    if (e.key === 'Escape' && mode === 'create') {
        mode = 'move';
        canvas.classList.remove('create-mode');
        draggedPoint = null;
        selectedPoint = null;
        emitModeChange();
    }
});

window.appActions = {
    playPreviewAnimation,
    exportDXF,
    buildChain,
    toggleMode,
    switchToCreateMode,
    getMode,
    setCurrentFrame,
    hasChainInCurrentFrame: () => hasChainInFrame(currentFrameIndex),
    hasRenderableChain,
    onChainStateChange: (listener) => {
        chainStateListeners.add(listener);
        return () => chainStateListeners.delete(listener);
    },
    onModeChange: (listener) => {
        modeChangeListeners.add(listener);
        return () => modeChangeListeners.delete(listener);
    },
    deleteSelectedPoint,
    copyPreviousFrameSkeleton,
    autoCopyPreviousSkeletonIfEmpty,
    exportSkeleton,
    importSkeleton,
    deleteCurrentFrame,
    // Project state management
    getProjectStateRefs: exposeStateForSerialization,
    setSkeletonForFrame: (frameIndex, skeleton) => {
        console.log(`setSkeletonForFrame: frame=${frameIndex}, has skeleton=${!!skeleton}`);
        frameSkeletons[frameIndex] = skeleton;
        emitChainStateChange();
        // Also redraw immediately so restored skeletons show up
        if (currentFrameIndex === frameIndex) {
            redrawAll();
        }
    },
    setChainForFrame: (frameIndex, chain, isBuilt) => {
        console.log(`setChainForFrame CALLED: frame=${frameIndex}, chain exists=${!!chain}, isBuilt=${isBuilt}`);
        if (chain) {
            console.log(`  trapezoids: ${chain.getTrapezoids().length}`);
        }
        frameChains[frameIndex] = chain;
        if (isBuilt !== undefined) frameChainBuilt[frameIndex] = isBuilt;
        console.log(`  frameChains[${frameIndex}] = ${!!frameChains[frameIndex]} (chain ${frameChains[frameIndex] ? 'stored' : 'NOT stored'})`);
        emitChainStateChange();
        // Also redraw immediately so restored chains show up
        if (currentFrameIndex === frameIndex) {
            console.log(`  Current frame matches, redrawing...`);
            redrawAll();
        } else {
            console.log(`  Frame mismatch: currentFrameIndex=${currentFrameIndex}, frameIndex=${frameIndex}`);
        }
    },
    setHoleEnabled: (enabled) => {
        holeEnabled = Boolean(enabled);
        redrawAll();
    },
    getHoleEnabled: () => holeEnabled,
    setJointsEnabled: (enabled) => {
        jointsEnabled = Boolean(enabled);
        redrawAll();
    },
    getJointsEnabled: () => jointsEnabled
};

// Listen for video frame changes and sync canvas state
window.videoControls?.onFrameChange?.((videoFrameIndex) => {
    setCurrentFrame(videoFrameIndex);
});