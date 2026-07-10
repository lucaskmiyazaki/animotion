// Create sidebar container
const sidebar = document.createElement('div');
sidebar.id = 'sidebar';

const sidebarHeader = document.createElement('div');
sidebarHeader.className = 'sidebar-header';
sidebarHeader.textContent = 'Pangolin';

const sidebarSubheader = document.createElement('div');
sidebarSubheader.className = 'sidebar-subheader';
sidebarSubheader.textContent = 'Skeleton Tools';

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

const addPointButton = createButton('Add Point', () => {
    const mode = window.appActions?.getMode?.() || 'move';
    if (mode === 'create') {
        window.appActions?.toggleMode?.();
    } else {
        window.appActions?.switchToCreateMode?.();
    }
});
addPointButton.classList.add('add-point-button');

function updateAddPointButtonState(mode = window.appActions?.getMode?.()) {
    const isCreateMode = mode === 'create';
    addPointButton.classList.toggle('active', isCreateMode);
    addPointButton.setAttribute('aria-pressed', isCreateMode ? 'true' : 'false');
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

const chainOptionsTitle = document.createElement('div');
chainOptionsTitle.className = 'section-title';
chainOptionsTitle.textContent = 'Chain';

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

function updateEnergyAndLengthDisplay() {
    const energy = window.appActions?.calculateTotalElasticEnergy?.() ?? 0;
    const totalL = window.appActions?.calculateTotalLineLength?.() ?? 0;
    const skeletonLength = window.appActions?.calculateCurrentSkeletonLength?.() ?? 0;
    energyDisplay.textContent = `Elastic Energy: ${energy.toFixed(2)}`;
    lineLengthDisplay.textContent = `L: ${totalL.toFixed(2)}`;
    skeletonLengthDisplay.textContent = `Skeleton Length: ${skeletonLength.toFixed(2)}`;
}

chainOptionsSection.append(
    chainOptionsTitle,
    holeOptionLabel,
    jointsOptionLabel,
    jointKContainer,
    fitKButton,
    energyDisplay,
    lineLengthDisplay,
    skeletonLengthDisplay
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

const frameSectionTitle = document.createElement('div');
frameSectionTitle.className = 'section-title';
frameSectionTitle.textContent = 'Frames';

const skeletonSection = document.createElement('div');
skeletonSection.className = 'skeleton-section';

const skeletonSectionTitle = document.createElement('div');
skeletonSectionTitle.className = 'section-title';
skeletonSectionTitle.textContent = 'Skeleton';

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

function updateBuildControls() {
    const hasChain = window.appActions?.hasRenderableChain?.() ?? false;
    buildButton.textContent = hasChain ? 'Regenerate Chain' : 'Generate Chain';
    bottomSecondaryActions.style.display = hasChain ? 'grid' : 'none';
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
});

window.appActions?.onChainStateChange?.(() => {
    updateBuildControls();
    renderJointKInputs();
    updateEnergyAndLengthDisplay();
});

window.appActions?.onModeChange?.((mode) => {
    updateAddPointButtonState(mode);
});

updateFrameInput();
updateBuildControls();
updateAddPointButtonState();
renderJointKInputs();
updateEnergyAndLengthDisplay();

const iconActionsRow = document.createElement('div');
iconActionsRow.className = 'icon-actions-row frame-icon-actions-row';

const skeletonIconActionsRow = document.createElement('div');
skeletonIconActionsRow.className = 'icon-actions-row skeleton-icon-actions-row';

const uploadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9h-4v4H7l5 5 5-5h-3zM5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5v-2h5V6H5v12h5v2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15V9h4v6h3l-5 5-5-5h3zM5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5v-2h5V6H5v12h5v2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
const videoIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12a2 2 0 0 1 2 2v1.5l2.8-2A1 1 0 0 1 22 8.3v7.4a1 1 0 0 1-1.2.8L18 14.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v8h12V8H4z"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h5v14H6zm7 0h5v14h-5z"/></svg>';

const importSkeletonIconButton = createIconButton(uploadIcon, 'Import Skeleton', () => {
    window.appActions?.importSkeleton();
});

const exportSkeletonIconButton = createIconButton(downloadIcon, 'Export Skeleton', () => {
    window.appActions?.exportSkeleton();
});

const uploadVideoIconButton = createIconButton(videoIcon, 'Upload Video', () => {
    window.videoControls?.openVideoPicker();
});

const playPauseButton = createIconButton(playIcon, 'Play', () => {
    window.videoControls?.togglePlayback?.();
});

function updatePlaybackButton() {
    const playing = window.videoControls?.isPlaying?.() ?? false;
    playPauseButton.innerHTML = playing ? pauseIcon : playIcon;
    playPauseButton.title = playing ? 'Pause' : 'Play';
    playPauseButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

window.videoControls?.onPlaybackChange?.(() => {
    updatePlaybackButton();
});

updatePlaybackButton();

skeletonIconActionsRow.append(importSkeletonIconButton, exportSkeletonIconButton);
iconActionsRow.append(uploadVideoIconButton, playPauseButton);

skeletonSection.append(skeletonSectionTitle, skeletonIconActionsRow, addPointButton);
frameSection.append(frameSectionTitle, iconActionsRow, frameControl);

// Add controls to sidebar
sidebar.append(
    sidebarHeader,
    sidebarSubheader,
    skeletonSection,
    frameSection,
    chainOptionsSection,
    projectActionsDiv,
    sideSpacer,
    bottomActions
);

// Add sidebar to page
document.body.appendChild(sidebar);