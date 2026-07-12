// Create sidebar container
const sidebar = document.createElement('div');
sidebar.id = 'sidebar';

const sidebarHeader = document.createElement('div');
sidebarHeader.className = 'sidebar-header';
sidebarHeader.textContent = 'Pangolin';

const sidebarSubheader = document.createElement('div');
sidebarSubheader.className = 'sidebar-subheader';
sidebarSubheader.textContent = 'Skeleton Tools';

function createSectionToggle(title, initialValue, onToggle) {
    const header = document.createElement('div');
    header.className = 'section-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'section-title';
    titleEl.textContent = title;

    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';

    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = Boolean(initialValue);
    toggleInput.setAttribute('aria-label', `${title} visibility`);

    const slider = document.createElement('span');
    slider.className = 'slider';

    toggleInput.addEventListener('change', () => {
        onToggle(toggleInput.checked);
    });

    switchLabel.append(toggleInput, slider);
    header.append(titleEl, switchLabel);

    return {
        header,
        input: toggleInput,
        sync: (value) => {
            toggleInput.checked = Boolean(value);
        }
    };
}

function setSectionInteractive(sectionEl, toggleInput, enabled) {
    sectionEl.classList.toggle('section-disabled', !enabled);
    sectionEl.querySelectorAll('button, input, select, textarea').forEach((control) => {
        if (control === toggleInput) return;
        control.disabled = !enabled;
    });
}

// Helper to create buttons
function createButton(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

function createIconButton(iconSVG, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'icon-button';
    btn.type = 'button';
    btn.innerHTML = iconSVG;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', onClick);
    return btn;
}

const addPointButton = document.createElement('button');
addPointButton.type = 'button';
addPointButton.className = 'draw-edit-toggle';
addPointButton.innerHTML = `
    <span class="draw-edit-thumb" aria-hidden="true"></span>
    <span class="draw-edit-label draw-label">Draw</span>
    <span class="draw-edit-label move-label">Move</span>
`;
addPointButton.addEventListener('click', () => {
    window.appActions?.toggleMode?.();
});

function updateAddPointButtonState(mode = window.appActions?.getMode?.()) {
    const isCreateMode = mode === 'create';
    addPointButton.classList.toggle('draw-mode', isCreateMode);
    addPointButton.classList.toggle('move-mode', !isCreateMode);
    addPointButton.setAttribute('aria-pressed', isCreateMode ? 'true' : 'false');
    addPointButton.setAttribute('aria-label', isCreateMode ? 'Mode: Draw' : 'Mode: Move');
}

const buildButton = createButton('Generate Chain', () => {
    window.appActions?.buildChain();
    updateBuildControls();
});
buildButton.classList.add('build-cta');

// Project Management Section (always visible)
const projectActionsDiv = document.createElement('div');
projectActionsDiv.className = 'project-actions';

const projectActionsTitle = document.createElement('div');
projectActionsTitle.className = 'section-title';
projectActionsTitle.textContent = 'Project';

const projectButtonsRow = document.createElement('div');
projectButtonsRow.className = 'project-buttons-row';

const saveProjectButton = createButton('Save', async () => {
    try {
        const stateRefs = window.appActions?.getProjectStateRefs?.();
        if (!stateRefs) {
            alert('Project state not available');
            return;
        }
        await window.projectState?.triggerSaveProject?.(stateRefs);
    } catch (error) {
        console.error('Save error:', error);
        alert('Error saving project');
    }
});
saveProjectButton.classList.add('project-button', 'save-button');

const openProjectButton = createButton('Open', () => {
    window.projectState?.triggerLoadProject?.(async (snapshot) => {
        try {
            await window.projectState?.restoreProjectSnapshot?.(snapshot);
        } catch (error) {
            console.error('Restore error:', error);
            alert('Error loading project');
        }
    });
});
openProjectButton.classList.add('project-button', 'open-button');

projectButtonsRow.append(openProjectButton, saveProjectButton);
projectActionsDiv.append(projectActionsTitle, projectButtonsRow);

const chainOptionsSection = document.createElement('div');
chainOptionsSection.className = 'chain-section';

const chainHeader = createSectionToggle(
    'Mechanism',
    window.appActions?.getChainVisible?.() ?? true,
    (visible) => {
        window.appActions?.setChainVisible?.(visible);
        setSectionInteractive(chainOptionsSection, chainHeader.input, visible);
        buildButton.disabled = !visible;
    }
);

const holeOptionLabel = document.createElement('label');
holeOptionLabel.className = 'checkbox-option';

const holeCheckbox = document.createElement('input');
holeCheckbox.type = 'checkbox';
holeCheckbox.checked = window.appActions?.getHoleEnabled?.() ?? false;
holeCheckbox.addEventListener('change', () => {
    window.appActions?.setHoleEnabled?.(holeCheckbox.checked);
});

const holeOptionText = document.createElement('span');
holeOptionText.textContent = 'Hole';

holeOptionLabel.append(holeCheckbox, holeOptionText);

const jointsOptionLabel = document.createElement('label');
jointsOptionLabel.className = 'checkbox-option';

const jointsCheckbox = document.createElement('input');
jointsCheckbox.type = 'checkbox';
jointsCheckbox.checked = window.appActions?.getJointsEnabled?.() ?? false;
jointsCheckbox.addEventListener('change', () => {
    window.appActions?.setJointsEnabled?.(jointsCheckbox.checked);
});

const jointsOptionText = document.createElement('span');
jointsOptionText.textContent = 'Joints';

jointsOptionLabel.append(jointsCheckbox, jointsOptionText);

const chainThicknessRow = document.createElement('div');
chainThicknessRow.className = 'joint-k-row';

const chainThicknessLabel = document.createElement('label');
chainThicknessLabel.className = 'joint-k-label';
chainThicknessLabel.textContent = 'Chain thickness';

const chainThicknessInput = document.createElement('input');
chainThicknessInput.className = 'joint-k-input';
chainThicknessInput.type = 'number';
chainThicknessInput.min = '0.1';
chainThicknessInput.step = '0.1';
chainThicknessInput.value = String(window.appActions?.getChainThickness?.() ?? 50);
chainThicknessInput.addEventListener('input', () => {
    const parsed = Number.parseFloat(chainThicknessInput.value);
    if (Number.isFinite(parsed) && parsed > 0) {
        window.appActions?.setChainThickness?.(parsed);
    }
});

chainThicknessRow.append(chainThicknessLabel, chainThicknessInput);

const jointMinThicknessRow = document.createElement('div');
jointMinThicknessRow.className = 'joint-k-row';

const jointMinThicknessLabel = document.createElement('label');
jointMinThicknessLabel.className = 'joint-k-label';
jointMinThicknessLabel.textContent = 'Joint min thickness';

const jointMinThicknessInput = document.createElement('input');
jointMinThicknessInput.className = 'joint-k-input';
jointMinThicknessInput.type = 'number';
jointMinThicknessInput.min = '0.1';
jointMinThicknessInput.step = '0.1';
jointMinThicknessInput.value = String(window.appActions?.getJointMinimumThickness?.() ?? 5);
jointMinThicknessInput.addEventListener('input', () => {
    const parsed = Number.parseFloat(jointMinThicknessInput.value);
    if (Number.isFinite(parsed) && parsed > 0) {
        window.appActions?.setJointMinimumThickness?.(parsed);
        renderJointKInputs();
        updateEnergyAndLengthDisplay();
    }
});

jointMinThicknessRow.append(jointMinThicknessLabel, jointMinThicknessInput);

const jointKContainer = document.createElement('div');
jointKContainer.className = 'joint-k-container';

function renderJointKInputs() {
    const count = window.appActions?.getJointCount?.() ?? 0;
    jointKContainer.innerHTML = '';

    if (count <= 0) {
        const empty = document.createElement('div');
        empty.className = 'joint-k-empty';
        empty.textContent = 'No joints yet';
        jointKContainer.append(empty);
        return;
    }

    for (let i = 0; i < count; i++) {
        const row = document.createElement('div');
        row.className = 'joint-k-row';

        const label = document.createElement('label');
        label.className = 'joint-k-label';
        label.textContent = `k${i + 1}`;

        const input = document.createElement('input');
        input.className = 'joint-k-input';
        input.type = 'number';
        input.step = '0.1';
        input.min = '0';
        input.value = String(window.appActions?.getJointK?.(i) ?? 1);
        input.addEventListener('change', () => {
            const parsed = Number.parseFloat(input.value);
            const nextValue = Number.isFinite(parsed) ? parsed : 1;
            window.appActions?.setJointK?.(i, nextValue);
        });

        row.append(label, input);
        jointKContainer.append(row);
    }
}

const fitKButton = createButton('Fit k to skeleton', () => {
    fitKButton.disabled = true;
    fitKButton.textContent = 'Fitting…';
    // Run asynchronously so the UI can repaint first.
    setTimeout(() => {
        window.appActions?.findKsMinimizingChainSkeletonDistance?.();
        renderJointKInputs();
        fitKButton.disabled = false;
        fitKButton.textContent = 'Fit k to skeleton';
    }, 20);
});
fitKButton.classList.add('fit-k-button');

const energyDisplay = document.createElement('div');
energyDisplay.className = 'energy-display';
energyDisplay.textContent = 'Elastic Energy: 0';

const lineLengthDisplay = document.createElement('div');
lineLengthDisplay.className = 'energy-display';
lineLengthDisplay.textContent = 'L: 0';

const skeletonLengthDisplay = document.createElement('div');
skeletonLengthDisplay.className = 'energy-display';
skeletonLengthDisplay.textContent = 'Skeleton Length: 0';

const jointThicknessDisplay = document.createElement('div');
jointThicknessDisplay.className = 'energy-display';
jointThicknessDisplay.textContent = 'Joint Thicknesses: -';

const advancedChainDetails = document.createElement('details');
advancedChainDetails.className = 'advanced-details';

const advancedChainSummary = document.createElement('summary');
advancedChainSummary.textContent = 'Advanced';

const advancedChainContent = document.createElement('div');
advancedChainContent.className = 'advanced-content';

function updateEnergyAndLengthDisplay() {
    const energy = window.appActions?.calculateTotalElasticEnergy?.() ?? 0;
    const totalL = window.appActions?.calculateTotalLineLength?.() ?? 0;
    const skeletonLength = window.appActions?.calculateCurrentSkeletonLength?.() ?? 0;
    const jointThicknesses = window.appActions?.getJointThicknesses?.() ?? [];
    energyDisplay.textContent = `Elastic Energy: ${energy.toFixed(2)}`;
    lineLengthDisplay.textContent = `L: ${totalL.toFixed(2)}`;
    skeletonLengthDisplay.textContent = `Skeleton Length: ${skeletonLength.toFixed(2)}`;
    jointThicknessDisplay.textContent = jointThicknesses.length > 0
        ? `Joint Thicknesses: ${jointThicknesses.map(v => v.toFixed(2)).join(', ')}`
        : 'Joint Thicknesses: -';
}

advancedChainContent.append(
    jointKContainer,
    fitKButton,
    energyDisplay,
    lineLengthDisplay,
    skeletonLengthDisplay,
    jointThicknessDisplay
);

advancedChainDetails.append(advancedChainSummary, advancedChainContent);

chainOptionsSection.append(
    chainHeader.header,
    holeOptionLabel,
    jointsOptionLabel,
    chainThicknessRow,
    jointMinThicknessRow,
    advancedChainDetails
);



const frameControl = document.createElement('div');
frameControl.className = 'frame-control';

const framePrevButton = document.createElement('button');
framePrevButton.textContent = '<';
framePrevButton.addEventListener('click', () => {
    window.videoControls?.prevFrame?.();
    updateFrameInput();
});

const frameInput = document.createElement('input');
frameInput.type = 'number';
frameInput.min = '0';
frameInput.step = '1';
frameInput.value = '0';
frameInput.className = 'frame-input';
frameInput.addEventListener('change', () => {
    const raw = Number.parseInt(frameInput.value, 10);
    const value = Number.isNaN(raw) ? 0 : Math.max(0, raw);
    window.videoControls?.showFrameIndex?.(value);
    updateFrameInput();
});

const frameNextButton = document.createElement('button');
frameNextButton.textContent = '>';
frameNextButton.addEventListener('click', () => {
    window.videoControls?.nextFrame?.();
    updateFrameInput();
});

const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-9l-1 1H5v2h14V4z"/></svg>';
const deleteFrameButton = createIconButton(trashIcon, 'Delete Frame', () => {
    window.appActions?.deleteCurrentFrame();
    updateFrameInput();
});

frameControl.append(framePrevButton, frameInput, deleteFrameButton, frameNextButton);

const frameSection = document.createElement('div');
frameSection.className = 'frame-section';

const frameHeader = createSectionToggle(
    'Video',
    window.appActions?.getFramesVisible?.() ?? true,
    (visible) => {
        window.appActions?.setFramesVisible?.(visible);
        setSectionInteractive(frameSection, frameHeader.input, visible);
    }
);

const skeletonSection = document.createElement('div');
skeletonSection.className = 'skeleton-section';

const skeletonHeader = createSectionToggle(
    'Skeleton',
    window.appActions?.getSkeletonVisible?.() ?? true,
    (visible) => {
        window.appActions?.setSkeletonVisible?.(visible);
        setSectionInteractive(skeletonSection, skeletonHeader.input, visible);
    }
);

const skeletonPointCountRow = document.createElement('div');
skeletonPointCountRow.className = 'point-count-row';

const skeletonDrawHint = document.createElement('div');
skeletonDrawHint.className = 'skeleton-draw-hint';
skeletonDrawHint.textContent = 'Click on the canvas to draw a skeleton';

const skeletonPointCountLabel = document.createElement('label');
skeletonPointCountLabel.className = 'joint-k-label';
skeletonPointCountLabel.classList.add('point-count-label');
skeletonPointCountLabel.textContent = 'Number of points';

const skeletonPointCountInput = document.createElement('input');
skeletonPointCountInput.className = 'joint-k-input';
skeletonPointCountInput.classList.add('point-count-input');
skeletonPointCountInput.type = 'number';
skeletonPointCountInput.min = '2';
skeletonPointCountInput.step = '1';
skeletonPointCountInput.value = String(Math.max(2, window.appActions?.getCurrentSkeletonPointCount?.() ?? 2));

const skeletonResampleButton = createButton('Change', () => {
    const count = Number.parseInt(skeletonPointCountInput.value, 10);
    if (!Number.isInteger(count) || count < 2) {
        alert('Number of points must be at least 2');
        return;
    }

    const ok = window.appActions?.resampleCurrentSkeleton?.(count);
    if (!ok) {
        alert('Could not regenerate skeleton. Draw at least 2 points first.');
        return;
    }

    skeletonPointCountInput.value = String(count);
});
skeletonResampleButton.classList.add('point-count-button');

skeletonPointCountRow.append(skeletonPointCountLabel, skeletonPointCountInput, skeletonResampleButton);

const sideSpacer = document.createElement('div');
sideSpacer.className = 'sidebar-spacer';

const bottomActions = document.createElement('div');
bottomActions.className = 'bottom-actions';

const exportBottomButton = createButton('Export DXF', () => {
    window.appActions?.exportDXF();
});
exportBottomButton.classList.add('bottom-export');

const previewBottomButton = createIconButton(
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    'Preview',
    () => {
        window.appActions?.playPreviewAnimation();
    }
);
previewBottomButton.classList.add('bottom-preview-icon');

const bottomSecondaryActions = document.createElement('div');
bottomSecondaryActions.className = 'bottom-secondary-actions';
bottomSecondaryActions.append(exportBottomButton, previewBottomButton);

let playPauseButton = null;
let uploadVideoText = null;

function hasLoadedVideo() {
    const videoEl = window.videoControls?.video;
    if (!videoEl) return false;
    return Boolean(videoEl.currentSrc || videoEl.src);
}

function getCurrentSkeletonPointCount() {
    return window.appActions?.getCurrentSkeletonPointCount?.() ?? 0;
}

function updateBuildControls() {
    const hasChain = window.appActions?.hasRenderableChain?.() ?? false;
    const hasSkeleton = getCurrentSkeletonPointCount() > 0;
    buildButton.textContent = hasChain ? 'Regenerate Chain' : 'Generate Chain';
    bottomSecondaryActions.style.display = hasChain ? 'grid' : 'none';
    buildButton.disabled = !hasSkeleton;
}

function updateProgressiveVisibility() {
    const hasVideo = hasLoadedVideo();
    const pointCount = getCurrentSkeletonPointCount();
    const hasSkeleton = pointCount > 0;
    const hasMechanism = window.appActions?.hasRenderableChain?.() ?? false;

    const frameToggleControl = frameHeader.input?.parentElement;
    if (frameToggleControl) {
        frameToggleControl.style.display = hasVideo ? '' : 'none';
    }

    if (playPauseButton) {
        playPauseButton.style.display = hasVideo ? '' : 'none';
    }
    if (uploadVideoText) {
        uploadVideoText.style.display = hasVideo ? 'none' : '';
    }
    frameControl.style.display = hasVideo ? 'grid' : 'none';

    skeletonSection.style.display = hasVideo ? '' : 'none';
    chainOptionsSection.style.display = (hasVideo && hasMechanism) ? '' : 'none';

    skeletonDrawHint.style.display = (hasVideo && !hasSkeleton) ? '' : 'none';
    addPointButton.style.display = hasSkeleton ? '' : 'none';
    skeletonPointCountRow.style.display = hasSkeleton ? 'grid' : 'none';

    if (hasVideo && !hasSkeleton && window.appActions?.getMode?.() !== 'create') {
        window.appActions?.switchToCreateMode?.();
    }
}

bottomActions.append(buildButton, bottomSecondaryActions);

function updateFrameInput() {
    const current = window.videoControls?.getCurrentFrameIndex?.() ?? 0;
    const max = window.videoControls?.getMaxFrameIndex?.() ?? current;
    frameInput.value = String(current);
    frameInput.max = String(max);
}

window.videoControls?.onFrameChange?.(() => {
    updateFrameInput();
    updateBuildControls();
    updateEnergyAndLengthDisplay();
    updateProgressiveVisibility();
});

window.appActions?.onChainStateChange?.(() => {
    updateBuildControls();
    renderJointKInputs();
    updateEnergyAndLengthDisplay();
    skeletonPointCountInput.value = String(Math.max(2, window.appActions?.getCurrentSkeletonPointCount?.() ?? 2));
    const skeletonVisible = window.appActions?.getSkeletonVisible?.() ?? true;
    const framesVisible = window.appActions?.getFramesVisible?.() ?? true;
    const chainVisible = window.appActions?.getChainVisible?.() ?? true;

    skeletonHeader.sync(skeletonVisible);
    frameHeader.sync(framesVisible);
    chainHeader.sync(chainVisible);

    setSectionInteractive(skeletonSection, skeletonHeader.input, skeletonVisible);
    setSectionInteractive(frameSection, frameHeader.input, framesVisible);
    setSectionInteractive(chainOptionsSection, chainHeader.input, chainVisible);
    if (!chainVisible) {
        buildButton.disabled = true;
    }
    updateProgressiveVisibility();
});

window.appActions?.onModeChange?.((mode) => {
    updateAddPointButtonState(mode);
});

updateFrameInput();
updateBuildControls();
updateAddPointButtonState();
renderJointKInputs();
updateEnergyAndLengthDisplay();
setSectionInteractive(
    skeletonSection,
    skeletonHeader.input,
    window.appActions?.getSkeletonVisible?.() ?? true
);
setSectionInteractive(
    frameSection,
    frameHeader.input,
    window.appActions?.getFramesVisible?.() ?? true
);
setSectionInteractive(
    chainOptionsSection,
    chainHeader.input,
    window.appActions?.getChainVisible?.() ?? true
);

const iconActionsRow = document.createElement('div');
iconActionsRow.className = 'icon-actions-row frame-icon-actions-row';

const videoIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5v2zM12 3l-5 5h3v6h4V8h3l-5-5z"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h5v14H6zm7 0h5v14h-5z"/></svg>';

const uploadVideoIconButton = createIconButton(videoIcon, 'Upload Video', () => {
    window.videoControls?.openVideoPicker();
});

const uploadVideoPrompt = document.createElement('div');
uploadVideoPrompt.className = 'upload-video-prompt';

uploadVideoText = document.createElement('span');
uploadVideoText.className = 'upload-video-text';
uploadVideoText.textContent = 'Upload video';

uploadVideoPrompt.append(uploadVideoIconButton, uploadVideoText);

playPauseButton = createIconButton(playIcon, 'Play', () => {
    window.videoControls?.togglePlayback?.();
});

function updatePlaybackButton() {
    const playing = window.videoControls?.isPlaying?.() ?? false;
    playPauseButton.innerHTML = playing ? pauseIcon : playIcon;
    playPauseButton.title = playing ? 'Pause' : 'Play';
    playPauseButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');

    previewBottomButton.innerHTML = playing ? pauseIcon : playIcon;
    previewBottomButton.title = playing ? 'Pause' : 'Preview';
    previewBottomButton.setAttribute('aria-label', playing ? 'Pause' : 'Preview');
}

window.videoControls?.onPlaybackChange?.(() => {
    updatePlaybackButton();
});

updatePlaybackButton();

iconActionsRow.append(uploadVideoPrompt, playPauseButton);

updateProgressiveVisibility();

skeletonSection.append(skeletonHeader.header, skeletonDrawHint, addPointButton, skeletonPointCountRow);
frameSection.append(frameHeader.header, iconActionsRow, frameControl);

// Add controls to sidebar
sidebar.append(
    sidebarHeader,
    sidebarSubheader,
    projectActionsDiv,
    frameSection,
    skeletonSection,
    chainOptionsSection,
    sideSpacer,
    bottomActions
);

// Add sidebar to page
document.body.appendChild(sidebar);