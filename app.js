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
    Object.values(frameChains).forEach((chain) => {
        if (!chain || typeof chain.getTrapezoids !== 'function') return;

        chain.getTrapezoids().forEach((item) => {
            [item.flatPosition, item.finalPosition, item.position, item.pivotPoint].forEach((point) => {
                if (!point) return;
                canvasView.transformPointToNewVideoRect(point, oldRect, newRect, scaleX, scaleY);
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
    delete frameChains[currentFrameIndex];
    delete frameChainBuilt[currentFrameIndex];
    emitChainStateChange();
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

    if (skeletonVisible) {
        const skeleton = getCurrentSkeleton();
        if (skeleton) {
            canvasView.drawSkeletonOverlay(skeleton, {
                hoveredPoint,
                selectedPoint,
                pointRadius,
                hoverRadius,
                showBisector: skeletonBisectorVisible,
                showPivot: skeletonPivotVisible,
                pivotRadius: chainThickness
            });
        }
    }

    canvasView.drawRulerOverlay(ruler, canvasView.getDisplayedVideoRect(), {
        handleRadius: rulerHandleRadius,
        labelPaddingX: rulerLabelPaddingX,
        labelPaddingY: rulerLabelPaddingY
    });
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
        frameChains[frameIndex] = chain;
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
    }
};

// Listen for video frame changes and sync canvas state
window.videoControls?.onFrameChange?.((videoFrameIndex) => {
    setCurrentFrame(videoFrameIndex);
});