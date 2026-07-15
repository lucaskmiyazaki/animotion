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

    const builtFrames = frameIndices
        .filter((frameIndex) => Boolean(frameChainBuilt[frameIndex] && frameChains[frameIndex]))
        .sort((a, b) => a - b);

    if (builtFrames.length === 0) {
        return {
            format: 'template+poses',
            frameCount: 0,
            template: null,
            frames: []
        };
    }

    const firstSerialized = frameChains[builtFrames[0]]?.toSerializable?.();
    if (!firstSerialized || !Array.isArray(firstSerialized.trapezoids)) {
        return {
            format: 'legacy',
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

    const template = {
        trapezoids: firstSerialized.trapezoids.map((item) => ({
            trapezoid: item.trapezoid,
            flatOffset: item.flatOffset,
            flatPosition: item.flatPosition,
            flatRotation: item.flatRotation,
            finalPosition: item.finalPosition,
            finalRotation: item.finalRotation,
            startRotation: item.startRotation,
            pivotPoint: item.pivotPoint,
            position: item.position,
            rotation: item.rotation
        }))
    };

    return {
        format: 'template+poses',
        frameCount: builtFrames.length,
        template,
        frames: builtFrames.map((frameIndex) => {
            const serialized = frameChains[frameIndex]?.toSerializable?.();
            const pose = (serialized?.trapezoids ?? []).map((item) => ({
                position: item.position,
                rotation: item.rotation
            }));
            return {
                frameIndex,
                chainBuilt: true,
                pose
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
        companionRigidModel,
        companionEnabled,
        mechanismNeedsRegeneration,
        chainThickness,
        jointMinimumThickness,
        companionSlack,
        rulerState,
        currentFrameIndex,
        mode,
        selectedPoint,
        getCurrentSkeleton
    } = stateRefs;

    const videoState = await window.videoControls?.getSerializableState?.();

    return {
        version: 2,
        ui: {
            currentFrameIndex,
            mode,
            holeEnabled: window.appActions?.getHoleEnabled?.() ?? false,
            jointsEnabled: window.appActions?.getJointsEnabled?.() ?? false,
            companionEnabled: Boolean(companionEnabled),
            chainVisible: window.appActions?.getChainVisible?.() ?? true,
            skeletonVisible: window.appActions?.getSkeletonVisible?.() ?? true,
            framesVisible: window.appActions?.getFramesVisible?.() ?? true,
            mechanismNeedsRegeneration: Boolean(mechanismNeedsRegeneration),
            selectedPointIndex: (() => {
                if (!selectedPoint) return null;
                const skeleton = getCurrentSkeleton();
                return skeleton ? skeleton.points.indexOf(selectedPoint) : null;
            })()
        },
        mechanism: {
            chainThickness: Number(chainThickness) || 50,
            jointMinimumThickness: Number(jointMinimumThickness) || 5,
            companionSlack: Number(companionSlack) || 0
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
        companion: {
            model: companionRigidModel ?? null
        },
        ruler: rulerState
            ? {
                visible: Boolean(rulerState.visible),
                mmLength: Number(rulerState.mmLength) || 1000,
                initialized: Boolean(rulerState.initialized),
                start: rulerState.start ? { x: Number(rulerState.start.x) || 0, y: Number(rulerState.start.y) || 0 } : null,
                end: rulerState.end ? { x: Number(rulerState.end.x) || 0, y: Number(rulerState.end.y) || 0 } : null
            }
            : null,
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
                if (snapshot.version !== 1 && snapshot.version !== 2) {
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
        const ChainCtor = window.Chain || (typeof Chain !== 'undefined' ? Chain : null);
        if (!ChainCtor || !ChainCtor.fromSerializable) {
            return;
        }

        if (chainSnapshot.format === 'template+poses' && chainSnapshot.template && Array.isArray(chainSnapshot.frames)) {
            chainSnapshot.frames.forEach(({ frameIndex, chainBuilt, pose }) => {
                if (!chainBuilt || !Array.isArray(pose)) return;

                const serialized = {
                    trapezoids: (chainSnapshot.template.trapezoids ?? []).map((templateItem, idx) => ({
                        ...templateItem,
                        position: pose[idx]?.position ?? templateItem.position,
                        rotation: pose[idx]?.rotation ?? templateItem.rotation
                    }))
                };

                const restoredChain = ChainCtor.fromSerializable(serialized);
                window.appActions?.setChainForFrame?.(frameIndex, restoredChain, true);
            });
            return;
        }

        chainSnapshot.frames.forEach(({ frameIndex, chainBuilt, chain }) => {
            if (!chainBuilt || !chain) {
                return;
            }

            // Reconstruct chain from serialized data
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

        if (uiSnapshot.holeEnabled !== undefined) {
            window.appActions?.setHoleEnabled?.(uiSnapshot.holeEnabled);
        }
        if (uiSnapshot.jointsEnabled !== undefined) {
            window.appActions?.setJointsEnabled?.(uiSnapshot.jointsEnabled);
        }
        if (uiSnapshot.companionEnabled !== undefined) {
            window.appActions?.setCompanionEnabled?.(uiSnapshot.companionEnabled);
        }
        if (uiSnapshot.chainVisible !== undefined) {
            window.appActions?.setChainVisible?.(uiSnapshot.chainVisible);
        }
        if (uiSnapshot.skeletonVisible !== undefined) {
            window.appActions?.setSkeletonVisible?.(uiSnapshot.skeletonVisible);
        }
        if (uiSnapshot.framesVisible !== undefined) {
            window.appActions?.setFramesVisible?.(uiSnapshot.framesVisible);
        }
        if (uiSnapshot.mechanismNeedsRegeneration) {
            window.appActions?.markMechanismNeedsRegeneration?.();
        } else {
            window.appActions?.clearMechanismNeedsRegeneration?.();
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
        const targetFrameIndex =
            snapshot?.video?.currentFrameIndex ??
            snapshot?.ui?.currentFrameIndex ??
            0;

        // 1. Restore video first but DON'T seek yet (needed for frame context)
        await restoreVideoState(snapshot.video, false);

        // 2. Restore skeleton (before seeking so canvas can render them)
        restoreSkeletonState(snapshot.skeleton);

        // 3. Restore chain (before seeking so canvas can render them)
        restoreChainState(snapshot.chain);

        if (snapshot?.mechanism?.chainThickness !== undefined) {
            window.appActions?.setChainThickness?.(snapshot.mechanism.chainThickness);
        }
        if (snapshot?.mechanism?.jointMinimumThickness !== undefined) {
            window.appActions?.setJointMinimumThickness?.(snapshot.mechanism.jointMinimumThickness);
        }
        if (snapshot?.mechanism?.companionSlack !== undefined) {
            window.appActions?.setCompanionSlack?.(snapshot.mechanism.companionSlack);
        }

        if (snapshot?.companion?.model !== undefined) {
            window.appActions?.setCompanionRigidModel?.(snapshot.companion.model);
        }

        // 3b. Restore joint k values
        window.appActions?.setJointKValues?.(snapshot.kValues?.byIndex ?? {});

        // 3c. Restore ruler calibration and visibility
        if (snapshot.ruler) {
            window.appActions?.setRulerState?.(snapshot.ruler);
        }

        // Log initial and final L after the chain has been restored.
        window.appActions?.calculateInitialAndFinalLineLengths?.();

        // 4. Seek once using a single resolved frame target.
        window.videoControls?.showFrameIndex?.(targetFrameIndex);

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
