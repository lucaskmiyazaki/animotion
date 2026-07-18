const canvasView = new Canvas('canvas');
const canvas = canvasView.getElement();

let lastDisplayedVideoRect = null;
let observedBackgroundVideo = null;

// one chain per frame
const frameChains = {};

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

    Object.values(frameChains).forEach((entry) => {
        const bundle = normalizeMechanismFrameBundle(entry);
        scaleMechanism(bundle.mechanism1);
        scaleMechanism(bundle.mechanism2);
    });

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
    mechanismNeedsRegeneration = true;
    emitChainStateChange();
}

function makeMechanismFrameBundle(mechanism1 = null, mechanism2 = null) {
    return {
        mechanism1: mechanism1 instanceof Chain ? mechanism1 : null,
        mechanism2: mechanism2 instanceof Chain ? mechanism2 : null
    };
}

function normalizeMechanismFrameBundle(value) {
    if (!value) {
        return makeMechanismFrameBundle(null, null);
    }

    if (value instanceof Chain) {
        return makeMechanismFrameBundle(value, null);
    }

    return makeMechanismFrameBundle(value.mechanism1, value.mechanism2);
}

function getCurrentMechanismBundle() {
    return normalizeMechanismFrameBundle(series.getMechanism(currentFrameIndex) || frameChains[currentFrameIndex] || null);
}

function hasRenderableChain() {
    const bundle = getCurrentMechanismBundle();
    const m1 = bundle.mechanism1;
    const m2 = bundle.mechanism2;
    const hasM1 = Boolean(m1 && Array.isArray(m1.links) && m1.links.length > 0);
    const hasM2 = Boolean(m2 && Array.isArray(m2.links) && m2.links.length > 0);
    return hasM1 || hasM2;
}

function buildChain() {
    const frameIndices = series.getFrameIndices().sort((a, b) => a - b);
    if (frameIndices.length === 0) {
        return new Chain();
    }

    series.clearAllMechanisms();
    Object.keys(frameChains).forEach((key) => delete frameChains[key]);
    Object.keys(frameChainBuilt).forEach((key) => delete frameChainBuilt[key]);

    const startFrameIndex = frameIndices[0];
    const endFrameIndex = frameIndices[frameIndices.length - 1];
    const startSkeleton = series.getFrame(startFrameIndex);
    const endSkeleton = series.getFrame(endFrameIndex);

    const mechanism1Initial = new Chain();
    mechanism1Initial.generateFromSeries(series, {
        frameIndex: startFrameIndex,
        pivotKind: 'ref1',
        pivotRadius: chainThickness
    });

    const mechanism2LastFrame = new Chain();
    mechanism2LastFrame.generateFromSeries(series, {
        frameIndex: endFrameIndex,
        pivotKind: 'ref2',
        pivotRadius: chainThickness
    });

    let mechanism2Initial = mechanism2LastFrame.clone();
    if (startSkeleton && endSkeleton && mechanism2Initial.links.length > 0) {
        mechanism2Initial.poseToSkeleton(endSkeleton, startSkeleton);
        mechanism2Initial = mechanism2Initial.rebaseToCurrentPose();
    }

    Chain.pairTwinLinks(mechanism1Initial, mechanism2Initial);

    const startBundle = makeMechanismFrameBundle(mechanism1Initial, mechanism2Initial);
    series.setMechanism(startFrameIndex, startBundle);
    frameChains[startFrameIndex] = startBundle;
    frameChainBuilt[startFrameIndex] = Boolean(
        (startBundle.mechanism1?.links?.length || 0) > 0
        || (startBundle.mechanism2?.links?.length || 0) > 0
    );

    let displayedFrameIndex = startFrameIndex;
    let displayedBundle = startBundle;

    if (
        endFrameIndex !== startFrameIndex
        && startSkeleton
        && endSkeleton
    ) {
        const mechanism1Last = mechanism1Initial.clone();
        if (mechanism1Last.links.length > 0) {
            mechanism1Last.poseToSkeleton(startSkeleton, endSkeleton);
        }

        const mechanism2Last = mechanism2LastFrame.clone();

        Chain.pairTwinLinks(mechanism1Last, mechanism2Last);
        const endBundle = makeMechanismFrameBundle(mechanism1Last, mechanism2Last);
        series.setMechanism(endFrameIndex, endBundle);
        frameChains[endFrameIndex] = endBundle;
        frameChainBuilt[endFrameIndex] = true;
        displayedFrameIndex = endFrameIndex;
        displayedBundle = endBundle;
    }

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
        series.setMechanism(frameIndex, bundle);
        frameChains[frameIndex] = bundle;
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
        const orangeLength = Number.isFinite(bundle.mechanism2?.getHoleLineLength?.())
            ? bundle.mechanism2.getHoleLineLength()
            : 0;
        const pinkLength = Number.isFinite(bundle.mechanism1?.getHoleLineLength?.())
            ? bundle.mechanism1.getHoleLineLength()
            : 0;
        return { orangeLength, pinkLength };
    }
};

// Listen for video frame changes and sync canvas state
window.videoControls?.onFrameChange?.((videoFrameIndex) => {
    setCurrentFrame(videoFrameIndex);
});