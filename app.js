const canvasView = new Canvas('canvas');
const canvas = canvasView.getElement();

let lastDisplayedVideoRect = null;
let observedBackgroundVideo = null;

// one chain per frame
const frameChains = {};
let liveMechanismBundle = null;
let liveMechanismBaseState = null;

// one skeleton per frame
const series = window.appSeries || new Series();
window.appSeries = series;
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
let mechanism1Visible = true;
let mechanism2Visible = true;
let skeletonVisible = true;
let skeletonBisectorVisible = false;
let skeletonPivot1Visible = false;
let skeletonPivot2Visible = false;
let chainVisible = true;
let mechanismNeedsRegeneration = false;
const jointKByIndex = {};
let companionJointWarning = '';

// Default trapezoid thickness
let chainThickness = 50;
let jointMinimumThickness = 5;
let companionSlack = 10;
let optimizationMaxBinaryIterations = 24;
let optimizationMaxBracketExpansions = 14;
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

function isRulerInteractionMode() {
    return ruler.visible;
}

function syncCreateModeCursorClass() {
    canvas.classList.toggle('create-mode', mode === 'create' && !isRulerInteractionMode());
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

    series.getSkeletons().forEach((skeleton) => {
        if (!skeleton || !Array.isArray(skeleton.points)) return;
        skeleton.points.forEach((point) => {
            canvasView.transformPointToNewVideoRect(point, oldRect, newRect, scaleX, scaleY);
        });
        skeleton.updateAllGeometry();
    });

    const uniformScale = (scaleX + scaleY) / 2;
    const scaleMechanism = (mechanism) => {
        if (!(mechanism instanceof Chain) || !Array.isArray(mechanism.links)) return;
        mechanism.links.forEach((link) => {
            link.position.x *= scaleX;
            link.position.y *= scaleY;
            link.localPoints.forEach((localPoint) => {
                localPoint.x *= uniformScale;
                localPoint.y *= uniformScale;
            });
        });
    };

    if (liveMechanismBundle) {
        const frameIndices = series.getFrameIndices().sort((a, b) => a - b);
        const startFrameIndex = frameIndices[0] ?? 0;
        syncLiveMechanismToFrame(startFrameIndex);
        scaleMechanism(liveMechanismBundle.mechanism1);
        scaleMechanism(liveMechanismBundle.mechanism2);
        liveMechanismBaseState = liveMechanismBundle.mechanism?._capturePoseState?.() || liveMechanismBaseState;
        syncLiveMechanismToFrame(currentFrameIndex);
    } else {
        Object.values(frameChains).forEach((entry) => {
            const bundle = normalizeMechanismFrameBundle(entry);
            scaleMechanism(bundle.mechanism1);
            scaleMechanism(bundle.mechanism2);
        });
    }

    chainThickness *= uniformScale;
    jointMinimumThickness *= uniformScale;
    companionSlack *= uniformScale;

    if (ruler.initialized) {
        canvasView.transformPointToNewVideoRect(ruler.start, oldRect, newRect, scaleX, scaleY);
        canvasView.transformPointToNewVideoRect(ruler.end, oldRect, newRect, scaleX, scaleY);
    }
}

function handleViewportResize() {
    const previousRect = lastDisplayedVideoRect;
    const nextRect = canvasView.getDisplayedVideoRect();

    canvasView.resizeToViewport();

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
    const video = canvasView.getBackgroundVideoElement();
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
    return series.getFrame(currentFrameIndex);
}

function emitChainStateChange() {
    chainStateListeners.forEach(listener => listener());
}

function emitModeChange() {
    modeChangeListeners.forEach(listener => listener(mode));
}

function markCurrentFrameChainDirty() {
    series.clearAllMechanisms();
    Object.keys(frameChains).forEach((key) => delete frameChains[key]);
    Object.keys(frameChainBuilt).forEach((key) => delete frameChainBuilt[key]);
    liveMechanismBundle = null;
    liveMechanismBaseState = null;
    mechanismNeedsRegeneration = true;
    emitChainStateChange();
}

function makeMechanismFrameBundle(mechanism1 = null, mechanism2 = null) {
    return {
        mechanism1: mechanism1 instanceof Chain ? mechanism1 : null,
        mechanism2: mechanism2 instanceof Chain ? mechanism2 : null,
        mechanism: null
    };
}

function normalizeMechanismFrameBundle(value) {
    if (!value) {
        return makeMechanismFrameBundle(null, null);
    }

    if (value instanceof Chain) {
        return makeMechanismFrameBundle(value, null);
    }

    const bundle = makeMechanismFrameBundle(value.mechanism1, value.mechanism2);
    if (value.mechanism instanceof Mechanism) {
        bundle.mechanism = value.mechanism;
    }
    return bundle;
}

function isMechanismPoseState(value) {
    return Boolean(value && typeof value === 'object' && Array.isArray(value.thetaVector));
}

function makeMechanismPoseState(thetaVector = [], extras = {}) {
    return {
        thetaVector: Array.isArray(thetaVector) ? thetaVector.slice() : [],
        targetHoleLength: Number.isFinite(extras.targetHoleLength) ? Number(extras.targetHoleLength) : null,
        targetHoleLengthA: Number.isFinite(extras.targetHoleLengthA) ? Number(extras.targetHoleLengthA) : null,
        solveResult: extras.solveResult && typeof extras.solveResult === 'object'
            ? { ...extras.solveResult }
            : null
    };
}

function extractMechanismPoseState(value) {
    const bundle = normalizeMechanismFrameBundle(value);
    const thetaVector = bundle.mechanism instanceof Mechanism
        ? bundle.mechanism._getJointThetaVector()
        : [];
    return makeMechanismPoseState(thetaVector, {
        targetHoleLength: value?.targetHoleLength,
        targetHoleLengthA: value?.targetHoleLengthA,
        solveResult: value?.solveResult || null
    });
}

function setFramePoseState(frameIndex, poseState) {
    const normalized = isMechanismPoseState(poseState)
        ? makeMechanismPoseState(poseState.thetaVector, poseState)
        : makeMechanismPoseState();
    series.setMechanism(frameIndex, normalized);
    frameChains[frameIndex] = normalized;
    frameChainBuilt[frameIndex] = true;
    return normalized;
}

function getFramePoseState(frameIndex) {
    const stored = series.getMechanism(frameIndex) || frameChains[frameIndex] || null;
    if (isMechanismPoseState(stored)) return stored;
    if (stored) return extractMechanismPoseState(stored);
    return null;
}

function syncLiveMechanismToFrame(frameIndex) {
    if (!(liveMechanismBundle?.mechanism instanceof Mechanism) || !liveMechanismBaseState) {
        return null;
    }

    const poseState = getFramePoseState(frameIndex);
    const thetaVector = Array.isArray(poseState?.thetaVector) ? poseState.thetaVector : [];

    liveMechanismBundle.mechanism._applyJointThetaVector(thetaVector, liveMechanismBaseState);
    liveMechanismBundle.targetHoleLength = Number.isFinite(poseState?.targetHoleLength)
        ? Number(poseState.targetHoleLength)
        : null;
    liveMechanismBundle.targetHoleLengthA = Number.isFinite(poseState?.targetHoleLengthA)
        ? Number(poseState.targetHoleLengthA)
        : null;
    liveMechanismBundle.solveResult = poseState?.solveResult || null;

    return liveMechanismBundle;
}

function persistCurrentFramePose(overrides = {}) {
    if (!(liveMechanismBundle?.mechanism instanceof Mechanism)) return null;

    const currentState = getFramePoseState(currentFrameIndex) || {};
    const poseState = makeMechanismPoseState(liveMechanismBundle.mechanism._getJointThetaVector(), {
        targetHoleLength: Object.prototype.hasOwnProperty.call(overrides, 'targetHoleLength')
            ? overrides.targetHoleLength
            : currentState.targetHoleLength,
        targetHoleLengthA: Object.prototype.hasOwnProperty.call(overrides, 'targetHoleLengthA')
            ? overrides.targetHoleLengthA
            : currentState.targetHoleLengthA,
        solveResult: Object.prototype.hasOwnProperty.call(overrides, 'solveResult')
            ? overrides.solveResult
            : currentState.solveResult
    });

    return setFramePoseState(currentFrameIndex, poseState);
}

function buildJointMechanismForBundle(bundle, frameIndex = currentFrameIndex) {
    return series.buildJointMechanismForBundle(bundle, {
        frameIndex,
        jointKByIndex,
        ChainCtor: Chain,
        MechanismCtor: Mechanism
    }) || new Mechanism({ chains: [], joints: [] });
}

function getCurrentMechanismBundle() {
    if (liveMechanismBundle?.mechanism instanceof Mechanism) {
        return syncLiveMechanismToFrame(currentFrameIndex) || liveMechanismBundle;
    }

    const bundle = normalizeMechanismFrameBundle(series.getMechanism(currentFrameIndex) || frameChains[currentFrameIndex] || null);
    if (!(bundle.mechanism instanceof Mechanism)) {
        bundle.mechanism = buildJointMechanismForBundle(bundle, currentFrameIndex);
    }
    return bundle;
}

function hasRenderableChain() {
    const bundle = getCurrentMechanismBundle();
    const m1 = bundle.mechanism1;
    const m2 = bundle.mechanism2;
    const hasM1 = Boolean(m1 && Array.isArray(m1.links) && m1.links.length > 0);
    const hasM2 = Boolean(m2 && Array.isArray(m2.links) && m2.links.length > 0);
    return hasM1 || hasM2;
}

function solveMechanismBundleForTargetLength(bundle, targetLength, options = {}) {
    const target = Number(targetLength);
    if (!Number.isFinite(target)) return null;
    if (!(bundle?.mechanism instanceof Mechanism)) return null;

    const solve = bundle.mechanism.findMinimumEnergyPoseForHoleLength(target, {
        maxBinaryIterations: optimizationMaxBinaryIterations,
        maxBracketExpansions: optimizationMaxBracketExpansions,
        ...options
    });
    const result = solve?.result || null;

    bundle.targetHoleLength = target;
    bundle.solveResult = result;
    return result;
}

function buildChain() {
    Object.keys(frameChains).forEach((key) => delete frameChains[key]);
    Object.keys(frameChainBuilt).forEach((key) => delete frameChainBuilt[key]);
    liveMechanismBundle = null;
    liveMechanismBaseState = null;

    const created = series.createMechanisms({
        chainThickness,
        jointKByIndex,
        solveOptions: {
            maxBinaryIterations: optimizationMaxBinaryIterations,
            maxBracketExpansions: optimizationMaxBracketExpansions
        },
        ChainCtor: Chain,
        MechanismCtor: Mechanism
    });

    const storedMechanisms = series.getMechanismFrameStore();
    const startFrameIndex = Number.isInteger(created?.startFrameIndex)
        ? created.startFrameIndex
        : (series.getFrameIndices().sort((a, b) => a - b)[0] || 0);
    const templateBundle = normalizeMechanismFrameBundle(storedMechanisms[startFrameIndex] || null);

    if (templateBundle.mechanism1 || templateBundle.mechanism2) {
        if (!(templateBundle.mechanism instanceof Mechanism)) {
            templateBundle.mechanism = buildJointMechanismForBundle(templateBundle, startFrameIndex);
        }
        liveMechanismBundle = templateBundle;
        liveMechanismBaseState = templateBundle.mechanism?._capturePoseState?.() || null;
    }

    const frameIndices = Array.isArray(created?.builtFrameIndices)
        ? created.builtFrameIndices.slice().sort((a, b) => a - b)
        : series.getFrameIndices().sort((a, b) => a - b);
    const fallbackTargetB = Number.isFinite(liveMechanismBundle?.mechanism2?.getHoleLineLength?.())
        ? liveMechanismBundle.mechanism2.getHoleLineLength()
        : 0;
    const fallbackTargetA = Number.isFinite(liveMechanismBundle?.mechanism1?.getHoleLineLength?.())
        ? liveMechanismBundle.mechanism1.getHoleLineLength()
        : 0;
    const initialHoleLength = Number.isFinite(created?.initialHoleLength)
        ? Number(created.initialHoleLength)
        : fallbackTargetB;
    const finalHoleLength = Number.isFinite(created?.finalHoleLength)
        ? Number(created.finalHoleLength)
        : initialHoleLength;
    const initialHoleLengthA = Number.isFinite(created?.initialHoleLengthA)
        ? Number(created.initialHoleLengthA)
        : fallbackTargetA;
    const finalHoleLengthA = Number.isFinite(created?.finalHoleLengthA)
        ? Number(created.finalHoleLengthA)
        : initialHoleLengthA;
    const frameSpan = Math.max(1, (frameIndices.at(-1) ?? startFrameIndex) - (frameIndices[0] ?? startFrameIndex));

    frameIndices.forEach((frameIndex) => {
        const t = frameSpan > 0 ? ((frameIndex - (frameIndices[0] ?? startFrameIndex)) / frameSpan) : 0;
        const clampedT = Math.min(1, Math.max(0, t));
        const targetHoleLength = initialHoleLength + (finalHoleLength - initialHoleLength) * clampedT;
        const targetHoleLengthA = initialHoleLengthA + (finalHoleLengthA - initialHoleLengthA) * clampedT;

        if (liveMechanismBundle?.mechanism instanceof Mechanism) {
            const solveResult = solveMechanismBundleForTargetLength(liveMechanismBundle, targetHoleLength, {
                debugFrameIndex: frameIndex,
                startFromInitial: true
            });
            setFramePoseState(frameIndex, makeMechanismPoseState(
                liveMechanismBundle.mechanism._getJointThetaVector(),
                {
                    targetHoleLength,
                    targetHoleLengthA,
                    solveResult
                }
            ));
            return;
        }

        setFramePoseState(frameIndex, makeMechanismPoseState([], {
            targetHoleLength,
            targetHoleLengthA,
            solveResult: null
        }));
    });

    const displayedFrameIndex = Number.isInteger(created?.displayedFrameIndex)
        ? created.displayedFrameIndex
        : (series.getFrameIndices().sort((a, b) => a - b).at(-1) || 0);
    const displayedBundle = liveMechanismBundle?.mechanism instanceof Mechanism
        ? (syncLiveMechanismToFrame(displayedFrameIndex) || liveMechanismBundle)
        : getCurrentMechanismBundle();

    mechanismNeedsRegeneration = false;
    setCurrentFrame(displayedFrameIndex);
    emitChainStateChange();
    window.videoControls?.showFrameIndex?.(displayedFrameIndex);
    redrawAll();
    return displayedBundle;
}

function ensureCurrentSkeleton() {
    return series.ensureFrame(currentFrameIndex);
}

function setCurrentFrame(frameIndex) {
    currentFrameIndex = series.clampFrameIndex(frameIndex);
    hoveredPoint = null;
    draggedPoint = null;

    if (liveMechanismBundle?.mechanism instanceof Mechanism) {
        syncLiveMechanismToFrame(currentFrameIndex);
    }

    emitChainStateChange();
    redrawAll();
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
    ruler.ensureInitialized(canvasView.getDisplayedVideoRect(), rulerHandleRadius);
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
        const skeleton = getCurrentSkeleton();
        const points = skeleton?.points ?? [];
        const x = e.clientX;
        const y = e.clientY;
        selectedPoint = canvasView.findPointAt(points, x, y, hitRadius);
        redrawAll();
    }
});

canvas.addEventListener('mousedown', (e) => {
    ruler.ensureInitialized(canvasView.getDisplayedVideoRect(), rulerHandleRadius);
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
    const skeleton = getCurrentSkeleton();
    const points = skeleton?.points ?? [];
    draggedPoint = canvasView.findPointAt(points, x, y, hitRadius);
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

    const points = getCurrentSkeleton()?.points ?? [];
    hoveredPoint = canvasView.findPointAt(points, mouseX, mouseY, hitRadius);

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

function redrawAll() {
    canvasView.clearViewport();

    if (chainVisible && hasRenderableChain()) {
        const bundle = getCurrentMechanismBundle();
        if (mechanism1Visible) {
            bundle.mechanism1?.drawWhole?.(canvasView.getContext(), {
                strokeStyle: 'rgba(34, 197, 94, 0.95)',
                fillStyle: 'rgba(34, 197, 94, 0.14)',
                lineWidth: 2,
                showHoles: holeEnabled,
                holeStrokeStyle: 'rgba(255, 80, 170, 0.95)',
                holeLineWidth: 2
            });
        }
        if (mechanism2Visible) {
            bundle.mechanism2?.drawWhole?.(canvasView.getContext(), {
                strokeStyle: 'rgba(34, 197, 94, 0.95)',
                fillStyle: 'rgba(34, 197, 94, 0.14)',
                lineWidth: 2,
                showHoles: holeEnabled,
                holeStrokeStyle: 'rgba(245, 130, 32, 0.95)',
                holeLineWidth: 2
            });
        }
    }

    if (skeletonVisible) {
        const skeleton = getCurrentSkeleton();
        if (skeleton) {
            const angleComparison = series.compareInitialToLastFrameAngles();
            canvasView.drawSkeletonOverlay(skeleton, {
                hoveredPoint,
                selectedPoint,
                pointRadius,
                hoverRadius,
                showBisector: skeletonBisectorVisible,
                showPivot1: skeletonPivot1Visible,
                showPivot2: skeletonPivot2Visible,
                pivotRadius: chainThickness,
                pivotDirectionByPoint: angleComparison.pointDirections
            });
        }
    }

    canvasView.drawRulerOverlay(ruler, canvasView.getDisplayedVideoRect(), {
        handleRadius: rulerHandleRadius,
        labelPaddingX: rulerLabelPaddingX,
        labelPaddingY: rulerLabelPaddingY
    });
}

function logPivotClosingDirections() {
    const comparison = series.compareInitialToLastFrameAngles();
    const rows = Object.entries(comparison.pointDirections || {}).map(([pointIndex, info]) => ({
        pointIndex: Number.parseInt(pointIndex, 10),
        closes: info?.closingDirection || 'none',
        cwTrend: info?.clockwise?.trend || 'unknown',
        cwDelta: Number.isFinite(info?.clockwise?.delta) ? Number(info.clockwise.delta.toFixed(4)) : null,
        ccwTrend: info?.counterclockwise?.trend || 'unknown',
        ccwDelta: Number.isFinite(info?.counterclockwise?.delta) ? Number(info.counterclockwise.delta.toFixed(4)) : null
    }));

    if (rows.length === 0) {
        console.log('Pivot direction analysis: no comparable points between initial and last skeleton frame.');
        return;
    }

    console.groupCollapsed(
        `Pivot direction analysis (frames ${comparison.startFrameIndex} -> ${comparison.endFrameIndex})`
    );
    console.table(rows);
    console.groupEnd();
}

function isSkeletonEditable() {
    return skeletonVisible;
}

function playPreviewAnimation() {
    window.videoControls?.togglePlayback?.();
}

function deleteAllFramesWithoutPoints() {
    const result = series.compactToFramesWithPoints(
        currentFrameIndex,
        [frameChains, frameChainBuilt],
        series.getMaxFrameIndex()
    );

    currentFrameIndex = result.currentFrameIndex;

    emitChainStateChange();
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
    const result = series.deleteLeadingEmptyFrames(currentFrameIndex, [frameChains, frameChainBuilt]);
    if (result.removedFrameIndices.length === 0) return;

    currentFrameIndex = result.currentFrameIndex;
    emitChainStateChange();
    window.videoControls?.showFrameIndex?.(currentFrameIndex);
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
        frameSkeletons: series.getSkeletonFrameStore(),
        frameChains: series.getMechanismFrameStore(),
        frameChainBuilt,
        companionRigidModel,
        companionEnabled: mechanism2Visible,
        mechanismNeedsRegeneration,
        chainThickness,
        jointMinimumThickness,
        companionSlack,
        jointKByIndex,
        rulerState: ruler.toSerializable(),
        currentFrameIndex,
        mode,
        selectedPoint,
        getCurrentSkeleton: () => series.getFrame(currentFrameIndex)
    };
}

function resampleCurrentSkeleton(targetPointCount) {
    if (!isSkeletonEditable()) return false;

    const skeleton = getCurrentSkeleton();
    const newSkeleton = skeleton?.resample?.(targetPointCount);
    if (!newSkeleton) return false;

    series.setFrame(currentFrameIndex, newSkeleton);
    hoveredPoint = null;
    draggedPoint = null;
    selectedPoint = null;
    markCurrentFrameChainDirty();
    redrawAll();
    return true;
}

function copyPreviousFrameSkeleton() {
    if (!isSkeletonEditable()) return;
    if (currentFrameIndex <= 0) return;

    const previousSkeleton = series.getFrame(currentFrameIndex - 1);
    if (!previousSkeleton) return;

    series.setFrame(currentFrameIndex, previousSkeleton.clone());
    markCurrentFrameChainDirty();

    hoveredPoint = null;
    draggedPoint = null;
    redrawAll();
}

function autoCopyPreviousSkeletonIfEmpty() {
    if (!isSkeletonEditable()) return;
    if (currentFrameIndex <= 0) return;
    
    const currentSkeleton = series.getFrame(currentFrameIndex);
    if (currentSkeleton) return; // Don't overwrite existing skeleton
    
    const previousSkeleton = series.getFrame(currentFrameIndex - 1);
    if (!previousSkeleton) return;
    
    series.setFrame(currentFrameIndex, previousSkeleton.clone());
    markCurrentFrameChainDirty();
    redrawAll();
}

function deleteCurrentFrame() {
    if (!(window.videoControls?.getFramesVisible?.() ?? true)) return;
    const deletedFrameIndex = currentFrameIndex;

    series.removeFrameAndShift(deletedFrameIndex, [frameChains, frameChainBuilt]);
    emitChainStateChange();

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
    exportSkeleton: () => {
        const skeleton = getCurrentSkeleton();
        if (!skeleton) return;
        SkeletonIO.exportSkeleton(skeleton, currentFrameIndex);
    },
    importSkeleton: () => {
        SkeletonIO.importSkeleton((newSkeleton) => {
            series.setFrame(currentFrameIndex, newSkeleton);
            markCurrentFrameChainDirty();
            hoveredPoint = null;
            draggedPoint = null;
            selectedPoint = null;
            redrawAll();
        });
    },
    deleteCurrentFrame,
    buildChain,
    hasRenderableChain,
    getMechanismNeedsRegeneration: () => mechanismNeedsRegeneration,
    findKsMinimizingChainSkeletonDistance: async () => {},
    rebuildCachedChainPoses: () => {},
    exportDXF: () => {
        console.warn('Export DXF is not implemented for the new Mechanism model yet.');
    },
    // Project state management
    getProjectStateRefs: exposeStateForSerialization,
    setSkeletonForFrame: (frameIndex, skeleton) => {
        series.setFrame(frameIndex, skeleton);
        emitChainStateChange();
        // Also redraw immediately so restored skeletons show up
        if (currentFrameIndex === frameIndex) {
            redrawAll();
        }
    },
    setChainForFrame: (frameIndex, chain, isBuilt) => {
        const bundle = normalizeMechanismFrameBundle(chain);
        bundle.mechanism = buildJointMechanismForBundle(bundle, frameIndex);
        if (!(liveMechanismBundle?.mechanism instanceof Mechanism) && (bundle.mechanism1 || bundle.mechanism2)) {
            liveMechanismBundle = bundle;
            liveMechanismBaseState = bundle.mechanism?._capturePoseState?.() || null;
        }
        setFramePoseState(frameIndex, extractMechanismPoseState(bundle));
        if (isBuilt !== undefined) frameChainBuilt[frameIndex] = isBuilt;
        emitChainStateChange();
        // Also redraw immediately so restored chains show up
        if (currentFrameIndex === frameIndex) {
            redrawAll();
        }
    },
    getLastSkeletonFrameIndex: () => series.getLastFrameWithPoints(),
    setSkeletonVisible: (visible) => {
        skeletonVisible = Boolean(visible);
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonVisible: () => skeletonVisible,
    setSkeletonBisectorVisible: (visible) => {
        skeletonBisectorVisible = Boolean(visible);
        if (!skeletonBisectorVisible) {
            skeletonPivot1Visible = false;
            skeletonPivot2Visible = false;
        }
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonBisectorVisible: () => skeletonBisectorVisible,
    setSkeletonPivot1Visible: (visible) => {
        skeletonPivot1Visible = Boolean(visible) && skeletonBisectorVisible;
        if (skeletonPivot1Visible) {
            logPivotClosingDirections();
        }
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonPivot1Visible: () => skeletonPivot1Visible,
    setSkeletonRef1Visible: (visible) => {
        // Swapped naming: ref1 maps to previous pivot2 behavior.
        skeletonPivot2Visible = Boolean(visible) && skeletonBisectorVisible;
        if (skeletonPivot2Visible) {
            logPivotClosingDirections();
        }
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonRef1Visible: () => skeletonPivot2Visible,
    setSkeletonPivot2Visible: (visible) => {
        skeletonPivot2Visible = Boolean(visible) && skeletonBisectorVisible;
        if (skeletonPivot2Visible) {
            logPivotClosingDirections();
        }
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonPivot2Visible: () => skeletonPivot2Visible,
    setSkeletonRef2Visible: (visible) => {
        // Swapped naming: ref2 maps to previous pivot1 behavior.
        skeletonPivot1Visible = Boolean(visible) && skeletonBisectorVisible;
        if (skeletonPivot1Visible) {
            logPivotClosingDirections();
        }
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonRef2Visible: () => skeletonPivot1Visible,
    logPivotClosingDirections,
    setChainVisible: (visible) => {
        chainVisible = Boolean(visible);
        emitChainStateChange();
        redrawAll();
    },
    getChainVisible: () => chainVisible,
    setHoleEnabled: (enabled) => {
        holeEnabled = Boolean(enabled);
        mechanismNeedsRegeneration = true;
        emitChainStateChange();
        redrawAll();
    },
    getHoleEnabled: () => holeEnabled,
    setJointsEnabled: (enabled) => {
        jointsEnabled = Boolean(enabled);
        mechanismNeedsRegeneration = true;
        emitChainStateChange();
        redrawAll();
    },
    getJointsEnabled: () => jointsEnabled,
    setChainThickness: (value) => {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        chainThickness = parsed;
        mechanismNeedsRegeneration = true;
        emitChainStateChange();
        redrawAll();
    },
    getChainThickness: () => chainThickness,
    setJointMinimumThickness: (value) => {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        jointMinimumThickness = parsed;
        mechanismNeedsRegeneration = true;
        emitChainStateChange();
        redrawAll();
    },
    getJointMinimumThickness: () => jointMinimumThickness,
    setCompanionSlack: (value) => {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed < 0) return;
        companionSlack = parsed;
        mechanismNeedsRegeneration = true;
        emitChainStateChange();
        redrawAll();
    },
    getCompanionSlack: () => companionSlack,
    getJointCount: () => {
        const bundle = getCurrentMechanismBundle();
        return bundle.mechanism instanceof Mechanism ? bundle.mechanism.joints.length : 0;
    },
    getJointK: (index) => {
        const i = Number.parseInt(index, 10);
        if (!Number.isInteger(i) || i < 0) return 1;
        const stored = Number(jointKByIndex[i]);
        if (Number.isFinite(stored) && stored > 0) return stored;

        const bundle = getCurrentMechanismBundle();
        const joint = bundle.mechanism?.joints?.[i];
        return Number.isFinite(joint?.k) ? joint.k : 1;
    },
    getJointTheta: (index) => {
        const i = Number.parseInt(index, 10);
        if (!Number.isInteger(i) || i < 0) return 0;

        const bundle = getCurrentMechanismBundle();
        const joint = bundle.mechanism?.joints?.[i];
        return Number.isFinite(joint?.theta) ? joint.theta : 0;
    },
    getJointAngleDebug: (index) => {
        const i = Number.parseInt(index, 10);
        if (!Number.isInteger(i) || i < 0) return null;

        const bundle = getCurrentMechanismBundle();
        const joint = bundle.mechanism?.joints?.[i];
        if (!(joint instanceof Joint)) return null;

        const absA_prev = Number(joint.prevLinkA?.theta);
        const absA_next = Number(joint.nextLinkA?.theta);
        const absB_prev = Number(joint.prevLinkB?.theta);
        const absB_next = Number(joint.nextLinkB?.theta);

        return {
            jointIndex: i,
            relativeTheta: Number.isFinite(joint.theta) ? joint.theta : null,
            absoluteA: {
                prev: Number.isFinite(absA_prev) ? absA_prev : null,
                next: Number.isFinite(absA_next) ? absA_next : null
            },
            absoluteB: {
                prev: Number.isFinite(absB_prev) ? absB_prev : null,
                next: Number.isFinite(absB_next) ? absB_next : null
            }
        };
    },
    getJointThetaBounds: (index) => {
        const i = Number.parseInt(index, 10);
        if (!Number.isInteger(i) || i < 0) {
            return { min: 0, max: 1 };
        }

        const bundle = getCurrentMechanismBundle();
        const joint = bundle.mechanism?.joints?.[i];
        const min = Number.isFinite(joint?.initialTheta) ? joint.initialTheta : 0;
        const max = Number.isFinite(joint?.finalTheta) ? joint.finalTheta : 1;
        return {
            min: Math.min(min, max),
            max: Math.max(min, max)
        };
    },
    setJointTheta: (index, value) => {
        const i = Number.parseInt(index, 10);
        const theta = Number.parseFloat(value);
        if (!Number.isInteger(i) || i < 0 || !Number.isFinite(theta)) return;

        const bundle = getCurrentMechanismBundle();
        if (!(bundle.mechanism instanceof Mechanism)) return;

        bundle.mechanism.setJointThetaByIndex(i, theta);
        persistCurrentFramePose();

        emitChainStateChange();
        redrawAll();
    },
    optimizeCurrentMechanismForStringLength: (targetLength, options = {}) => {
        const bundle = getCurrentMechanismBundle();
        const target = Number(targetLength);
        const result = solveMechanismBundleForTargetLength(bundle, target, options);
        if (!Number.isFinite(target)) return null;
        persistCurrentFramePose({ targetHoleLength: target, solveResult: result });

        emitChainStateChange();
        redrawAll();

        return result;
    },
    setJointK: (index, value) => {
        const i = Number.parseInt(index, 10);
        const k = Number.parseFloat(value);
        if (!Number.isInteger(i) || i < 0 || !Number.isFinite(k) || k <= 0) return;
        jointKByIndex[i] = k;

        const bundle = getCurrentMechanismBundle();
        const joint = bundle.mechanism?.joints?.[i];
        if (joint instanceof Joint) {
            joint.setK(k);
            persistCurrentFramePose();
        }

        emitChainStateChange();
        redrawAll();
    },
    setJointKValues: (values) => {
        Object.keys(jointKByIndex).forEach((key) => delete jointKByIndex[key]);
        if (values && typeof values === 'object') {
            Object.entries(values).forEach(([key, raw]) => {
                const i = Number.parseInt(key, 10);
                const k = Number(raw);
                if (Number.isInteger(i) && i >= 0 && Number.isFinite(k) && k > 0) {
                    jointKByIndex[i] = k;
                }
            });
        }

        const bundle = getCurrentMechanismBundle();
        if (bundle.mechanism instanceof Mechanism) {
            bundle.mechanism.joints.forEach((joint, index) => {
                const nextK = Number(jointKByIndex[index]);
                if (joint instanceof Joint && Number.isFinite(nextK) && nextK > 0) {
                    joint.setK(nextK);
                }
            });
            persistCurrentFramePose();
        }

        emitChainStateChange();
        redrawAll();
    },
    setOptimizationMaxBinaryIterations: (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) return;
        optimizationMaxBinaryIterations = parsed;
        emitChainStateChange();
    },
    getOptimizationMaxBinaryIterations: () => optimizationMaxBinaryIterations,
    setOptimizationMaxBracketExpansions: (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) return;
        optimizationMaxBracketExpansions = parsed;
        emitChainStateChange();
    },
    getOptimizationMaxBracketExpansions: () => optimizationMaxBracketExpansions,
    calculateTotalElasticEnergy: () => {
        const bundle = getCurrentMechanismBundle();
        return bundle.mechanism instanceof Mechanism
            ? bundle.mechanism.calculateTotalElasticEnergy()
            : 0;
    },
    markMechanismNeedsRegeneration: () => {
        mechanismNeedsRegeneration = true;
        emitChainStateChange();
        redrawAll();
    },
    clearMechanismNeedsRegeneration: () => {
        mechanismNeedsRegeneration = false;
        emitChainStateChange();
        redrawAll();
    },
    setCompanionEnabled: (enabled) => {
        mechanism2Visible = Boolean(enabled);
        emitChainStateChange();
        redrawAll();
    },
    getCompanionEnabled: () => mechanism2Visible,
    setMechanism1Visible: (enabled) => {
        mechanism1Visible = Boolean(enabled);
        emitChainStateChange();
        redrawAll();
    },
    getMechanism1Visible: () => mechanism1Visible,
    setMechanism2Visible: (enabled) => {
        mechanism2Visible = Boolean(enabled);
        emitChainStateChange();
        redrawAll();
    },
    getMechanism2Visible: () => mechanism2Visible,
    setFramesVisible: (visible) => {
        window.videoControls?.setFramesVisible?.(Boolean(visible));
        emitChainStateChange();
        redrawAll();
    },
    getFramesVisible: () => window.videoControls?.getFramesVisible?.() ?? true,
    toggleRulerVisible: () => {
        ruler.ensureInitialized(canvasView.getDisplayedVideoRect(), rulerHandleRadius);
        ruler.visible = !ruler.visible;
        syncCreateModeCursorClass();
        emitChainStateChange();
        redrawAll();
        return ruler.visible;
    },
    setRulerVisible: (visible) => {
        ruler.ensureInitialized(canvasView.getDisplayedVideoRect(), rulerHandleRadius);
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
    getCurrentSkeletonPointCount: () => series.getFrame(currentFrameIndex)?.points?.length ?? 0,
    resampleCurrentSkeleton: (pointCount) => resampleCurrentSkeleton(pointCount),
    calculateCurrentSkeletonLength: () => {
        const skeleton = series.getFrame(currentFrameIndex);
        return skeleton ? skeleton.getLength() : 0;
    },
    calculateHoleLineLengths: () => {
        const bundle = getCurrentMechanismBundle();
        const orangeLength = Number.isFinite(bundle.mechanism1?.getHoleLineLength?.())
            ? bundle.mechanism1.getHoleLineLength()
            : 0;
        const pinkLength = Number.isFinite(bundle.mechanism2?.getHoleLineLength?.())
            ? bundle.mechanism2.getHoleLineLength()
            : 0;
        return { orangeLength, pinkLength };
    },
    getCurrentStringLengthChainB: () => {
        const bundle = getCurrentMechanismBundle();
        const chainB = bundle.mechanism?.chains?.[1];
        const length = Number(chainB?.getHoleLineLength?.());
        return Number.isFinite(length) ? length : 0;
    },
    getCurrentTargetHoleLength: () => {
        const frameBundle = series.getMechanism(currentFrameIndex);
        const target = Number(frameBundle?.targetHoleLength);
        return Number.isFinite(target) ? target : null;
    },
    getCurrentTargetHoleLengthA: () => {
        const frameBundle = series.getMechanism(currentFrameIndex);
        const target = Number(frameBundle?.targetHoleLengthA);
        return Number.isFinite(target) ? target : null;
    },
    getCurrentStringLengthBounds: () => {
        const frameBundle = series.getMechanism(currentFrameIndex);
        const min = Number(frameBundle?.solveResult?.lengthBounds?.min);
        const max = Number(frameBundle?.solveResult?.lengthBounds?.max);
        if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
        return {
            min: Math.min(min, max),
            max: Math.max(min, max)
        };
    },
    getCurrentSolveDiagnostics: () => {
        const frameBundle = series.getMechanism(currentFrameIndex);
        const result = frameBundle?.solveResult;
        if (!result || typeof result !== 'object') return null;

        const lengthError = Number(result.lengthError);
        const feasible = Boolean(result.feasible);
        const converged = Boolean(result.converged);
        return {
            feasible,
            converged,
            lengthError: Number.isFinite(lengthError) ? lengthError : null
        };
    }
};

// Listen for video frame changes and sync canvas state
window.videoControls?.onFrameChange?.((videoFrameIndex) => {
    setCurrentFrame(videoFrameIndex);
});