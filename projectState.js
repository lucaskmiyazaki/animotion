/**
 * Project State Management
 * Centralizes all project state serialization and deserialization logic
 */

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

function serializeSkeleton(skeleton) {
    if (!skeleton) return null;

    const points = skeleton.points.map((point, index) => ({
        id: index,
        x: point.x,
        y: point.y
    }));

    const lines = skeleton.lines.map(line => ({
        start: skeleton.points.indexOf(line.start),
        end: skeleton.points.indexOf(line.end),
        angle: line.angle
    }));

    return {
        points,
        lines,
        initialPoint: points[0] ? { x: points[0].x, y: points[0].y } : null
    };
}

function gatherSkeletonState(frameSkeletons) {
    const frameIndices = Array.from(new Set(Object.keys(frameSkeletons).map(k => parseInt(k, 10))))
        .filter(Number.isInteger)
        .sort((a, b) => a - b);

    return {
        frameCount: frameIndices.length,
        frames: frameIndices.map(frameIndex => ({
            frameIndex,
            skeleton: serializeSkeleton(frameSkeletons[frameIndex])
        }))
    };
}

function gatherChainState(frameChains, frameChainBuilt) {
    const frameIndices = Array.from(new Set(
        Object.keys(frameChains)
            .concat(Object.keys(frameChainBuilt))
            .map(k => parseInt(k, 10))
    ))
        .filter(Number.isInteger)
        .sort((a, b) => a - b);

    return {
        frameCount: frameIndices.length,
        frames: frameIndices.map(frameIndex => {
            const chain = frameChains[frameIndex];
            const chainBuilt = Boolean(frameChainBuilt[frameIndex]);
            const serialized = chain?.toSerializable?.();
            return {
                frameIndex,
                chainBuilt,
                chain: serialized ?? null
            };
        })
    };
}

// ============================================================================
// STATE SNAPSHOT
// ============================================================================

/**
 * Gather all project state into a single snapshot object
 * @param {Object} stateRefs - References to canvas and video state
 * @returns {Promise<Object>} Complete project snapshot
 */
async function getProjectStateSnapshot(stateRefs) {
    const {
        frameSkeletons,
        frameChains,
        frameChainBuilt,
        jointKByIndex,
        currentFrameIndex,
        mode,
        selectedPoint,
        getCurrentSkeleton
    } = stateRefs;

    const videoState = await window.videoControls?.getSerializableState?.();

    return {
        version: 1,
        ui: {
            currentFrameIndex,
            mode,
            selectedPointIndex: (() => {
                if (!selectedPoint) return null;
                const skeleton = getCurrentSkeleton();
                return skeleton ? skeleton.points.indexOf(selectedPoint) : null;
            })()
        },
        video: videoState ?? {
            currentFrameIndex: 0,
            maxFrameIndex: 0,
            frameIndexMap: [],
            frameRange: null,
            video: null
        },
        skeleton: gatherSkeletonState(frameSkeletons),
        chain: gatherChainState(frameChains, frameChainBuilt),
        kValues: {
            byIndex: Object.fromEntries(
                Object.entries(jointKByIndex || {})
                    .filter(([index, value]) => Number.isInteger(Number.parseInt(index, 10)) && Number.isFinite(Number(value)))
                    .map(([index, value]) => [Number.parseInt(index, 10), Number(value)])
            )
        }
    };
}

// ============================================================================
// SAVE FUNCTIONALITY
// ============================================================================

/**
 * Save project to .ani file
 * @param {Object} snapshot - Project snapshot from getProjectStateSnapshot
 * @param {string} fileName - Optional filename (without extension)
 */
async function saveProjectToFile(snapshot, fileName = 'project') {
    try {
        const json = JSON.stringify(snapshot, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${fileName}.ani`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error saving project:', error);
        throw error;
    }
}

/**
 * Trigger file picker and save project
 */
async function triggerSaveProject(stateRefs) {
    try {
        // Get snapshot
        const snapshot = await getProjectStateSnapshot(stateRefs);

        // Generate filename with timestamp
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
        const fileName = `project-${timestamp}`;

        // Save
        await saveProjectToFile(snapshot, fileName);
    } catch (error) {
        console.error('Failed to save project:', error);
        throw error;
    }
}

// ============================================================================
// LOAD FUNCTIONALITY
// ============================================================================

/**
 * Load project from .ani file
 * @param {File} file - The .ani file to load
 * @returns {Promise<Object>} Parsed project snapshot
 */
async function loadProjectFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const snapshot = JSON.parse(e.target.result);
                if (snapshot.version !== 1) {
                    throw new Error(`Unsupported project version: ${snapshot.version}`);
                }
                resolve(snapshot);
            } catch (error) {
                reject(new Error('Invalid project file: ' + error.message));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

/**
 * Trigger file picker for loading project
 * @param {Function} onLoad - Callback when project is loaded
 */
function triggerLoadProject(onLoad) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ani,application/json';
    input.onchange = async (e) => {
        try {
            const file = e.target.files[0];
            if (!file) return;
            const snapshot = await loadProjectFromFile(file);
            await onLoad(snapshot);
        } catch (error) {
            console.error('Failed to load project:', error);
            alert('Error loading project: ' + error.message);
        }
    };
    input.click();
}

// ============================================================================
// DESERIALIZATION / RESTORATION
// ============================================================================

/**
 * Restore video from snapshot
 * @param {Object} videoSnapshot - Video section of project snapshot
 * @param {boolean} seekNow - Whether to seek immediately (default: false)
 */
async function restoreVideoState(videoSnapshot, seekNow = false) {
    if (!videoSnapshot || !videoSnapshot.video) {
        return;
    }

    const { name, type, dataURL } = videoSnapshot.video;
    const frameIndexMap = videoSnapshot.frameIndexMap || [];

    try {
        // Convert dataURL back to File
        const response = await fetch(dataURL);
        const blob = await response.blob();
        const file = new File([blob], name, { type });

        // Load video file and WAIT for it to fully load
        await window.videoControls?.loadVideoFile?.(file);

        // NOW restore frame index map (after video has initialized)
        if (frameIndexMap.length > 0) {
            window.videoControls?.setFrameIndexMap?.(frameIndexMap);
        }

        // Seek to saved frame (only if seekNow is true)
        if (seekNow && videoSnapshot.currentFrameIndex !== undefined) {
            window.videoControls?.showFrameIndex?.(videoSnapshot.currentFrameIndex);
        }
    } catch (error) {
        console.error('Error restoring video:', error);
    }
}

/**
 * Restore skeleton from snapshot
 * @param {Object} skeletonSnapshot - Skeleton section of project snapshot
 */
function restoreSkeletonState(skeletonSnapshot) {
    if (!skeletonSnapshot || !skeletonSnapshot.frames) return;

    try {
        skeletonSnapshot.frames.forEach(({ frameIndex, skeleton }) => {
            if (!skeleton) return;

            // Create new empty skeleton
            const newSkeleton = new Skeleton();

            // Add all points first
            skeleton.points.forEach((point) => {
                newSkeleton.addPoint(point.x, point.y);
            });

            // Add all lines
            skeleton.lines.forEach(({ start, end, angle }) => {
                if (start < newSkeleton.points.length && end < newSkeleton.points.length) {
                    const line = newSkeleton.addLine(
                        newSkeleton.points[start],
                        newSkeleton.points[end]
                    );
                    // Restore the angle
                    line.angle = angle;
                }
            });

            // Store in frame
            window.appActions?.setSkeletonForFrame?.(frameIndex, newSkeleton);
        });

    } catch (error) {
        console.error('Error restoring skeleton:', error);
    }
}

/**
 * Restore chain from snapshot
 * @param {Object} chainSnapshot - Chain section of project snapshot
 */
function restoreChainState(chainSnapshot) {
    if (!chainSnapshot || !chainSnapshot.frames) {
        return;
    }

    try {
        chainSnapshot.frames.forEach(({ frameIndex, chainBuilt, chain }) => {
            if (!chainBuilt || !chain) {
                return;
            }

            // Reconstruct chain from serialized data
            const ChainCtor = window.Chain || (typeof Chain !== 'undefined' ? Chain : null);
            if (ChainCtor && ChainCtor.fromSerializable) {
                const restoredChain = ChainCtor.fromSerializable(chain);
                window.appActions?.setChainForFrame?.(frameIndex, restoredChain, chainBuilt);
            } else {
                console.warn('Chain class not available for deserialization');
            }
        });
    } catch (error) {
        console.error('Error restoring chain:', error);
    }
}

/**
 * Restore UI state from snapshot
 * @param {Object} uiSnapshot - UI section of project snapshot
 */
function restoreUIState(uiSnapshot) {
    if (!uiSnapshot) return;

    try {
        if (uiSnapshot.mode && window.appActions?.switchMode) {
            window.appActions.switchMode(uiSnapshot.mode);
        }

        // Restore frame index (after video is loaded)
        if (uiSnapshot.currentFrameIndex !== undefined) {
            window.videoControls?.showFrameIndex?.(uiSnapshot.currentFrameIndex);
        }

    } catch (error) {
        console.error('Error restoring UI state:', error);
    }
}

/**
 * Restore entire project from snapshot
 * @param {Object} snapshot - Complete project snapshot
 */
async function restoreProjectSnapshot(snapshot) {
    try {
        // 1. Restore video first but DON'T seek yet (needed for frame context)
        await restoreVideoState(snapshot.video, false);

        // 2. Restore skeleton (before seeking so canvas can render them)
        restoreSkeletonState(snapshot.skeleton);

        // 3. Restore chain (before seeking so canvas can render them)
        restoreChainState(snapshot.chain);

        // 3b. Restore joint k values
        window.appActions?.setJointKValues?.(snapshot.kValues?.byIndex ?? {});

        // Log initial and final L after the chain has been restored.
        window.appActions?.calculateInitialAndFinalLineLengths?.();

        // 4. NOW seek to correct frame (triggers canvas redraw with skeletons/chains)
        if (snapshot.video && snapshot.video.currentFrameIndex !== undefined) {
            window.videoControls?.showFrameIndex?.(snapshot.video.currentFrameIndex);
        }

        // 5. Restore UI state
        restoreUIState(snapshot.ui);
    } catch (error) {
        console.error('Error restoring project:', error);
        throw error;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

window.projectState = {
    getProjectStateSnapshot,
    saveProjectToFile,
    triggerSaveProject,
    loadProjectFromFile,
    triggerLoadProject,
    restoreProjectSnapshot
};
