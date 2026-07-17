const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let lastDisplayedVideoRect = null;
let observedBackgroundVideo = null;

// one chain per frame
const frameChains = {};

// one skeleton per frame
const skeletonSeries = new SkeletonSeries();
const frameSkeletons = skeletonSeries.frames;
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
let companionEnabled = true;
let skeletonVisible = true;
let skeletonBisectorVisible = false;
let skeletonPivotVisible = false;
let chainVisible = true;
let mechanismNeedsRegeneration = false;
const jointKByIndex = {};
let companionJointWarning = '';

// Default trapezoid thickness
let chainThickness = 50;
let jointMinimumThickness = 5;
let companionSlack = 10;
let companionRigidModel = null;
const pointRadius = 5;
const hoverRadius = 9;
const hitRadius = 10;
const rulerHandleRadius = 10;
const rulerLabelPaddingX = 8;
const rulerLabelPaddingY = 5;
const ruler = new Ruler({
    visible: false,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    mmLength: 1000,
    initialized: false
});

function getViewportRect() {
    return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight
    };
}

function getBackgroundVideoElement() {
    return window.videoControls?.video || document.getElementById('backgroundVideo');
}

function isRulerInteractionMode() {
    return ruler.visible;
}

function syncCreateModeCursorClass() {
    canvas.classList.toggle('create-mode', mode === 'create' && !isRulerInteractionMode());
}

function getDisplayedVideoRect() {
    const video = getBackgroundVideoElement();
    if (!video) {
        return getViewportRect();
    }

    const bounds = video.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
        return getViewportRect();
    }

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) {
        return {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height
        };
    }

    const fit = getComputedStyle(video).objectFit || 'fill';
    if (fit !== 'contain' && fit !== 'scale-down') {
        return {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height
        };
    }

    const containerAspect = bounds.width / bounds.height;
    const mediaAspect = videoWidth / videoHeight;

    let renderedWidth = bounds.width;
    let renderedHeight = bounds.height;
    let offsetX = 0;
    let offsetY = 0;

    if (mediaAspect > containerAspect) {
        renderedWidth = bounds.width;
        renderedHeight = bounds.width / mediaAspect;
        offsetY = (bounds.height - renderedHeight) / 2;
    } else {
        renderedHeight = bounds.height;
        renderedWidth = bounds.height * mediaAspect;
        offsetX = (bounds.width - renderedWidth) / 2;
    }

    return {
        left: bounds.left + offsetX,
        top: bounds.top + offsetY,
        width: renderedWidth,
        height: renderedHeight
    };
}

function resizeCanvasToViewport() {
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function transformPointToNewVideoRect(point, oldRect, newRect, scaleX, scaleY) {
    point.x = newRect.left + (point.x - oldRect.left) * scaleX;
    point.y = newRect.top + (point.y - oldRect.top) * scaleY;
}

function transformAllGeometryToNewVideoRect(oldRect, newRect) {
    if (!oldRect || oldRect.width <= 0 || oldRect.height <= 0) {
        return;
    }

    const scaleX = newRect.width / oldRect.width;
    const scaleY = newRect.height / oldRect.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
        return;
    }

    Object.values(frameSkeletons).forEach((skeleton) => {
        if (!skeleton || !Array.isArray(skeleton.points)) return;
        skeleton.points.forEach((point) => {
            transformPointToNewVideoRect(point, oldRect, newRect, scaleX, scaleY);
        });
        skeleton.updateAllGeometry();
    });

    const uniformScale = (scaleX + scaleY) / 2;
    Object.values(frameChains).forEach((chain) => {
        if (!chain || typeof chain.getTrapezoids !== 'function') return;

        chain.getTrapezoids().forEach((item) => {
            [item.flatPosition, item.finalPosition, item.position, item.pivotPoint].forEach((point) => {
                if (!point) return;
                transformPointToNewVideoRect(point, oldRect, newRect, scaleX, scaleY);
            });

            const trapezoid = item.trapezoid;
            if (!trapezoid) return;
            if (Number.isFinite(trapezoid.meanLineLength)) {
                trapezoid.meanLineLength *= uniformScale;
            }
            if (Number.isFinite(trapezoid.thickness)) {
                trapezoid.thickness *= uniformScale;
            }
            if (Array.isArray(trapezoid.localPoints)) {
                trapezoid.localPoints.forEach((localPoint) => {
                    localPoint.x *= uniformScale;
                    localPoint.y *= uniformScale;
                });
            }
        });
    });

    chainThickness *= uniformScale;
    jointMinimumThickness *= uniformScale;
    companionSlack *= uniformScale;

    if (ruler.initialized) {
        transformPointToNewVideoRect(ruler.start, oldRect, newRect, scaleX, scaleY);
        transformPointToNewVideoRect(ruler.end, oldRect, newRect, scaleX, scaleY);
    }
}

function handleViewportResize() {
    const previousRect = lastDisplayedVideoRect;
    const nextRect = getDisplayedVideoRect();

    resizeCanvasToViewport();

    if (previousRect) {
        const moved = Math.abs(previousRect.left - nextRect.left) > 0.001 || Math.abs(previousRect.top - nextRect.top) > 0.001;
        const resized = Math.abs(previousRect.width - nextRect.width) > 0.001 || Math.abs(previousRect.height - nextRect.height) > 0.001;
        if (moved || resized) {
            transformAllGeometryToNewVideoRect(previousRect, nextRect);
        }
    }

    lastDisplayedVideoRect = nextRect;
    redrawAll();
}

function attachBackgroundVideoListenersIfNeeded() {
    const video = getBackgroundVideoElement();
    if (!video || video === observedBackgroundVideo) {
        return;
    }

    if (observedBackgroundVideo) {
        observedBackgroundVideo.removeEventListener('loadedmetadata', handleViewportResize);
        observedBackgroundVideo.removeEventListener('loadeddata', handleViewportResize);
    }

    observedBackgroundVideo = video;
    observedBackgroundVideo.addEventListener('loadedmetadata', handleViewportResize);
    observedBackgroundVideo.addEventListener('loadeddata', handleViewportResize);
}

window.addEventListener('resize', handleViewportResize);
const videoAttachTimer = setInterval(() => {
    attachBackgroundVideoListenersIfNeeded();
    if (observedBackgroundVideo) {
        clearInterval(videoAttachTimer);
    }
}, 150);

handleViewportResize();

function getCurrentSkeleton() {
    return skeletonSeries.getFrame(currentFrameIndex);
}

function emitChainStateChange() {
    chainStateListeners.forEach(listener => listener());
}

function emitModeChange() {
    modeChangeListeners.forEach(listener => listener(mode));
}

function markCurrentFrameChainDirty() {
    delete frameChains[currentFrameIndex];
    delete frameChainBuilt[currentFrameIndex];
    emitChainStateChange();
}

function getLastFrameWithSkeleton() {
    const indices = Object.keys(frameSkeletons)
        .map((k) => Number.parseInt(k, 10))
        .filter((idx) => Number.isInteger(idx) && frameSkeletons[idx]?.points?.length > 0)
        .sort((a, b) => b - a);
    return indices.length > 0 ? indices[0] : -1;
}

// Skeleton length at current frame: sum of all skeleton segment lengths.
function calculateCurrentSkeletonLength() {
    const skeleton = getCurrentSkeleton();
    if (!skeleton || !Array.isArray(skeleton.lines) || skeleton.lines.length === 0) {
        return 0;
    }

    let total = 0;
    skeleton.lines.forEach(line => {
        if (!line?.start || !line?.end) return;
        total += Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
    });

    return total;
}

function ensureCurrentSkeleton() {
    return skeletonSeries.ensureFrame(currentFrameIndex);
}

function setCurrentFrame(frameIndex) {
    currentFrameIndex = frameIndex;
    hoveredPoint = null;
    draggedPoint = null;

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
    ruler.ensureInitialized(getDisplayedVideoRect(), rulerHandleRadius);
    if (ruler.tryHandleLabelClick(e.clientX, e.clientY)) {
        redrawAll();
        return;
    }

    if (isRulerInteractionMode()) {
        return;
    }

    if (!isSkeletonEditable()) return;

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

        redrawAll();
    } else if (mode === 'edit' || mode === 'move') {
        if (hasDragged) return;
        const x = e.clientX;
        const y = e.clientY;
        selectedPoint = getPointAt(x, y);
        redrawAll();
    }
});

canvas.addEventListener('mousedown', (e) => {
    ruler.ensureInitialized(getDisplayedVideoRect(), rulerHandleRadius);
    if (Boolean(ruler.tryStartDrag(e.clientX, e.clientY, rulerHandleRadius))) {
        return;
    }

    if (isRulerInteractionMode()) {
        draggedPoint = null;
        return;
    }

    if (!isSkeletonEditable()) return;
    if (mode !== 'edit' && mode !== 'move') return;

    const x = e.clientX;
    const y = e.clientY;

    draggedPoint = getPointAt(x, y);
    hasDragged = false;
});

canvas.addEventListener('mousemove', (e) => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    if (ruler.draggedHandle) {
        ruler.updateDraggedHandle(mouseX, mouseY);
        redrawAll();
        return;
    }

    if (isRulerInteractionMode()) {
        hoveredPoint = null;
        draggedPoint = null;
        hasDragged = false;
        redrawAll();
        return;
    }

    if (!isSkeletonEditable()) {
        hoveredPoint = null;
        draggedPoint = null;
        hasDragged = false;
        redrawAll();
        return;
    }

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
    ruler.stopDrag();
});

canvas.addEventListener('mouseleave', () => {
    hoveredPoint = null;
    draggedPoint = null;
    ruler.stopDrag();
    redrawAll();
});

function drawSkeletonOverlay() {
    if (!skeletonVisible) return;

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

    if (skeletonBisectorVisible && typeof skeleton.drawBisector === 'function') {
        skeleton.drawBisector(ctx, {
            length: 50,
            strokeStyle: 'rgba(0, 180, 0, 0.95)',
            lineWidth: 3
        });

        if (skeletonPivotVisible && typeof skeleton.drawPivot === 'function') {
            skeleton.drawPivot(ctx, chainThickness, {
                pointRadius: 4,
                fillStyle: 'rgba(255, 120, 0, 0.9)'
            });
        }
    }

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

function drawRulerOverlay() {
    ruler.ensureInitialized(getDisplayedVideoRect(), rulerHandleRadius);
    ruler.draw(ctx, {
        handleRadius: rulerHandleRadius,
        labelPaddingX: rulerLabelPaddingX,
        labelPaddingY: rulerLabelPaddingY
    });
}

function redrawAll() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    drawSkeletonOverlay();
    drawRulerOverlay();
}

function isSkeletonEditable() {
    return skeletonVisible;
}

function playPreviewAnimation() {
    window.videoControls?.togglePlayback?.();
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


function deleteSelectedPoint() {
    if (!isSkeletonEditable()) return;
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
    } else if (mode === 'edit') {
        mode = 'move';
    } else {
        mode = 'create';
    }
    syncCreateModeCursorClass();
    draggedPoint = null;
    selectedPoint = null;
    emitModeChange();
    return mode;
}

function switchToCreateMode() {
    mode = 'create';
    syncCreateModeCursorClass();
    draggedPoint = null;
    selectedPoint = null;
    emitModeChange();
    return mode;
}

function switchToEditMode() {
    mode = 'edit';
    syncCreateModeCursorClass();
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
        companionRigidModel,
        companionEnabled,
        mechanismNeedsRegeneration,
        chainThickness,
        jointMinimumThickness,
        companionSlack,
        jointKByIndex,
        rulerState: ruler.toSerializable(),
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

function resampleCurrentSkeleton(targetPointCount) {
    if (!isSkeletonEditable()) return false;

    const skeleton = getCurrentSkeleton();
    if (!skeleton || !Array.isArray(skeleton.points) || skeleton.points.length < 2) {
        return false;
    }

    const requestedCount = Math.round(Number(targetPointCount));
    if (!Number.isInteger(requestedCount) || requestedCount < 2) {
        return false;
    }

    const sourcePoints = skeleton.points;
    const cumulative = [0];
    let totalLength = 0;

    for (let i = 1; i < sourcePoints.length; i++) {
        const prev = sourcePoints[i - 1];
        const curr = sourcePoints[i];
        totalLength += Math.hypot(curr.x - prev.x, curr.y - prev.y);
        cumulative.push(totalLength);
    }

    if (!Number.isFinite(totalLength) || totalLength <= 1e-8) {
        return false;
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

    frameSkeletons[currentFrameIndex] = newSkeleton;
    hoveredPoint = null;
    draggedPoint = null;
    selectedPoint = null;
    markCurrentFrameChainDirty();
    redrawAll();
    return true;
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
    if (!isSkeletonEditable()) return;
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
    if (!isSkeletonEditable()) return;
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
    if (!(window.videoControls?.getFramesVisible?.() ?? true)) return;
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
        syncCreateModeCursorClass();
        draggedPoint = null;
        selectedPoint = null;
        emitModeChange();
    }
});


window.appActions = {
    playPreviewAnimation,
    toggleMode,
    switchToCreateMode,
    switchToEditMode,
    getMode,
    setCurrentFrame,
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
        skeletonSeries.setFrame(frameIndex, skeleton);
        emitChainStateChange();
        // Also redraw immediately so restored skeletons show up
        if (currentFrameIndex === frameIndex) {
            redrawAll();
        }
    },
    setChainForFrame: (frameIndex, chain, isBuilt) => {
        frameChains[frameIndex] = chain;
        if (isBuilt !== undefined) frameChainBuilt[frameIndex] = isBuilt;
        emitChainStateChange();
        // Also redraw immediately so restored chains show up
        if (currentFrameIndex === frameIndex) {
            redrawAll();
        }
    },
    getLastSkeletonFrameIndex: () => getLastFrameWithSkeleton(),
    setSkeletonVisible: (visible) => {
        skeletonVisible = Boolean(visible);
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonVisible: () => skeletonVisible,
    setSkeletonBisectorVisible: (visible) => {
        skeletonBisectorVisible = Boolean(visible);
        if (!skeletonBisectorVisible) {
            skeletonPivotVisible = false;
        }
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonBisectorVisible: () => skeletonBisectorVisible,
    setSkeletonPivotVisible: (visible) => {
        skeletonPivotVisible = Boolean(visible) && skeletonBisectorVisible;
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonPivotVisible: () => skeletonPivotVisible,
    setFramesVisible: (visible) => {
        window.videoControls?.setFramesVisible?.(Boolean(visible));
        emitChainStateChange();
        redrawAll();
    },
    getFramesVisible: () => window.videoControls?.getFramesVisible?.() ?? true,
    toggleRulerVisible: () => {
        ruler.ensureInitialized(getDisplayedVideoRect(), rulerHandleRadius);
        ruler.visible = !ruler.visible;
        syncCreateModeCursorClass();
        emitChainStateChange();
        redrawAll();
        return ruler.visible;
    },
    setRulerVisible: (visible) => {
        ruler.ensureInitialized(getDisplayedVideoRect(), rulerHandleRadius);
        ruler.visible = Boolean(visible);
        syncCreateModeCursorClass();
        emitChainStateChange();
        redrawAll();
    },
    getRulerVisible: () => ruler.visible,
    getRulerState: () => ruler.toSerializable(),
    setRulerState: (nextState) => {
        const nextRuler = Ruler.fromSerializable(nextState || {});
        ruler.visible = nextRuler.visible;
        ruler.mmLength = nextRuler.mmLength;
        ruler.initialized = nextRuler.initialized;
        ruler.start.x = nextRuler.start.x;
        ruler.start.y = nextRuler.start.y;
        ruler.end.x = nextRuler.end.x;
        ruler.end.y = nextRuler.end.y;
        syncCreateModeCursorClass();
        emitChainStateChange();
        redrawAll();
    },
    getRulerScaleMmPerPixel: () => ruler.getScaleMmPerPixel(),
    getCurrentSkeletonPointCount: () => getCurrentSkeleton()?.points?.length ?? 0,
    resampleCurrentSkeleton: (pointCount) => resampleCurrentSkeleton(pointCount),
    calculateCurrentSkeletonLength: () => calculateCurrentSkeletonLength()
};

// Listen for video frame changes and sync canvas state
window.videoControls?.onFrameChange?.((videoFrameIndex) => {
    setCurrentFrame(videoFrameIndex);
});