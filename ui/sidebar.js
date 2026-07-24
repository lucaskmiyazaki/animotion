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

    if (sectionEl === chainOptionsSection) {
        syncJointKInputEditability();
    }
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
    const rulerActive = window.appActions?.getRulerVisible?.() ?? false;
    const isCreateMode = mode === 'create';
    addPointButton.classList.toggle('draw-mode', isCreateMode);
    addPointButton.classList.toggle('move-mode', !isCreateMode);
    addPointButton.disabled = rulerActive;
    addPointButton.setAttribute('aria-pressed', isCreateMode ? 'true' : 'false');
    addPointButton.setAttribute('aria-label', rulerActive ? 'Mode switch disabled while ruler is active' : (isCreateMode ? 'Mode: Draw' : 'Mode: Move'));
}

const buildButton = createButton('Generate Chain', async () => {
    const hasAnySkeleton = (window.appActions?.getLastSkeletonFrameIndex?.() ?? -1) >= 0;
    if (!hasAnySkeleton) return;

    const setProgress = (value, text) => {
        chainBuildProgressWrap.style.display = 'grid';
        chainBuildProgressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
        chainBuildProgressText.textContent = text;
    };

    try {
        buildButton.disabled = true;
        setProgress(8, 'Building mechanism...');

        // Yield to let the progress UI paint before heavy work.
        await new Promise(resolve => setTimeout(resolve, 20));

        window.appActions?.buildChain?.();
        setProgress(82, manualFillCheckbox.checked ? 'Manual k mode' : 'Mechanism generated');

        setProgress(100, 'Done');

        await new Promise(resolve => setTimeout(resolve, 350));
    } catch (error) {
        console.error('Build/Fit error:', error);
        setProgress(100, 'Build failed');
        await new Promise(resolve => setTimeout(resolve, 600));
    } finally {
        chainBuildProgressWrap.style.display = 'none';
        updateBuildControls();
    }
});
buildButton.classList.add('build-cta');

const chainBuildProgressWrap = document.createElement('div');
chainBuildProgressWrap.className = 'chain-build-progress';

const chainBuildProgressTrack = document.createElement('div');
chainBuildProgressTrack.className = 'chain-build-progress-track';

const chainBuildProgressBar = document.createElement('div');
chainBuildProgressBar.className = 'chain-build-progress-bar';
chainBuildProgressBar.style.width = '0%';

const chainBuildProgressText = document.createElement('div');
chainBuildProgressText.className = 'chain-build-progress-text';
chainBuildProgressText.textContent = 'Preparing...';

chainBuildProgressTrack.append(chainBuildProgressBar);
chainBuildProgressWrap.append(chainBuildProgressTrack, chainBuildProgressText);
chainBuildProgressWrap.style.display = 'none';

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

const holePositionARow = document.createElement('div');
holePositionARow.className = 'joint-k-row';

const holePositionALabel = document.createElement('label');
holePositionALabel.className = 'joint-k-label';
holePositionALabel.textContent = 'Hole position A';

const holePositionAInput = document.createElement('input');
holePositionAInput.className = 'joint-k-input';
holePositionAInput.type = 'number';
holePositionAInput.min = '0';
holePositionAInput.step = '0.1';
holePositionAInput.value = String(window.appActions?.getHoleLinePositionA?.() ?? 0);
holePositionAInput.addEventListener('input', () => {
    const parsed = Number.parseFloat(holePositionAInput.value);
    if (Number.isFinite(parsed) && parsed >= 0) {
        window.appActions?.setHoleLinePositionA?.(parsed);
        updateEnergyAndLengthDisplay();
    }
});

holePositionARow.append(holePositionALabel, holePositionAInput);

const holePositionBRow = document.createElement('div');
holePositionBRow.className = 'joint-k-row';

const holePositionBLabel = document.createElement('label');
holePositionBLabel.className = 'joint-k-label';
holePositionBLabel.textContent = 'Hole position B';

const holePositionBInput = document.createElement('input');
holePositionBInput.className = 'joint-k-input';
holePositionBInput.type = 'number';
holePositionBInput.min = '0';
holePositionBInput.step = '0.1';
holePositionBInput.value = String(window.appActions?.getHoleLinePositionB?.() ?? 0);
holePositionBInput.addEventListener('input', () => {
    const parsed = Number.parseFloat(holePositionBInput.value);
    if (Number.isFinite(parsed) && parsed >= 0) {
        window.appActions?.setHoleLinePositionB?.(parsed);
        updateEnergyAndLengthDisplay();
    }
});

holePositionBRow.append(holePositionBLabel, holePositionBInput);

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

const mechanismRenderRow = document.createElement('div');
mechanismRenderRow.className = 'joint-k-row';

const mechanismRenderLabel = document.createElement('label');
mechanismRenderLabel.className = 'joint-k-label';
mechanismRenderLabel.textContent = 'Render chain';

const mechanismRenderToggle = document.createElement('div');
mechanismRenderToggle.className = 'toggle-row';

const mechanismRenderAOption = document.createElement('label');
mechanismRenderAOption.className = 'checkbox-option';
const mechanismRenderAInput = document.createElement('input');
mechanismRenderAInput.type = 'radio';
mechanismRenderAInput.name = 'mechanism-render-chain';
mechanismRenderAInput.checked = (window.appActions?.getMechanismRenderChain?.() ?? 'A') === 'A';
mechanismRenderAInput.addEventListener('change', () => {
    if (mechanismRenderAInput.checked) {
        window.appActions?.setMechanismRenderChain?.('A');
    }
});
const mechanismRenderAText = document.createElement('span');
mechanismRenderAText.textContent = 'A';
mechanismRenderAOption.append(mechanismRenderAInput, mechanismRenderAText);

const mechanismRenderBOption = document.createElement('label');
mechanismRenderBOption.className = 'checkbox-option';
const mechanismRenderBInput = document.createElement('input');
mechanismRenderBInput.type = 'radio';
mechanismRenderBInput.name = 'mechanism-render-chain';
mechanismRenderBInput.checked = (window.appActions?.getMechanismRenderChain?.() ?? 'A') === 'B';
mechanismRenderBInput.addEventListener('change', () => {
    if (mechanismRenderBInput.checked) {
        window.appActions?.setMechanismRenderChain?.('B');
    }
});
const mechanismRenderBText = document.createElement('span');
mechanismRenderBText.textContent = 'B';
mechanismRenderBOption.append(mechanismRenderBInput, mechanismRenderBText);

mechanismRenderToggle.append(mechanismRenderAOption, mechanismRenderBOption);
mechanismRenderRow.append(mechanismRenderLabel, mechanismRenderToggle);

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

function syncThicknessInputs() {
    const liveChainThickness = window.appActions?.getChainThickness?.();
    if (Number.isFinite(liveChainThickness)) {
        chainThicknessInput.value = String(liveChainThickness);
    }

    const liveHolePositionA = Number(window.appActions?.getHoleLinePositionA?.());
    if (Number.isFinite(liveHolePositionA)) {
        holePositionAInput.value = String(liveHolePositionA);
    }

    const liveHolePositionB = Number(window.appActions?.getHoleLinePositionB?.());
    if (Number.isFinite(liveHolePositionB)) {
        holePositionBInput.value = String(liveHolePositionB);
    }

    const liveJointMinThickness = window.appActions?.getJointMinimumThickness?.();
    if (Number.isFinite(liveJointMinThickness)) {
        jointMinThicknessInput.value = String(liveJointMinThickness);
    }

    const liveSlack = window.appActions?.getCompanionSlack?.();
    if (Number.isFinite(liveSlack)) {
        slackInput.value = String(liveSlack);
    }
}

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

const slackRow = document.createElement('div');
slackRow.className = 'joint-k-row';

const slackLabel = document.createElement('label');
slackLabel.className = 'joint-k-label';
slackLabel.textContent = 'Slack';

const slackInput = document.createElement('input');
slackInput.className = 'joint-k-input';
slackInput.type = 'number';
slackInput.min = '0';
slackInput.step = '0.1';
slackInput.value = String(window.appActions?.getCompanionSlack?.() ?? 10);
slackInput.addEventListener('input', () => {
    const parsed = Number.parseFloat(slackInput.value);
    if (Number.isFinite(parsed) && parsed >= 0) {
        window.appActions?.setCompanionSlack?.(parsed);
        updateEnergyAndLengthDisplay();
    }
});

slackRow.append(slackLabel, slackInput);

const optimizeSpringKButton = createButton('Optimize spring k', async () => {
    const setProgress = (value, text) => {
        chainBuildProgressWrap.style.display = 'grid';
        chainBuildProgressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
        chainBuildProgressText.textContent = text;
    };

    optimizeSpringKButton.disabled = true;
    const previousText = optimizeSpringKButton.textContent;
    optimizeSpringKButton.textContent = 'Optimizing...';
    optimizeSpringKStatus.textContent = 'Preparing staged optimization...';
    setProgress(4, 'Preparing spring optimization...');

    try {
        const result = await window.appActions?.findKsMinimizingChainSkeletonDistance?.((percent, text) => {
            const pct = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
            setProgress(pct, text || 'Optimizing spring stiffness...');
            optimizeSpringKStatus.textContent = `${text || 'Optimizing spring stiffness...'} (${pct.toFixed(0)}%)`;
        });

        if (result?.kByIndex) {
            renderJointKInputs();
            updateEnergyAndLengthDisplay();
            optimizeSpringKStatus.textContent = 'Spring optimization complete';
            setProgress(100, 'Spring optimization complete');
        } else {
            optimizeSpringKStatus.textContent = 'No optimization result';
            setProgress(100, 'No optimization result');
        }
    } catch (error) {
        console.error('Spring optimization error:', error);
        optimizeSpringKStatus.textContent = 'Spring optimization failed';
        setProgress(100, 'Spring optimization failed');
    } finally {
        await new Promise(resolve => setTimeout(resolve, 350));
        chainBuildProgressWrap.style.display = 'none';
        optimizeSpringKButton.disabled = false;
        optimizeSpringKButton.textContent = previousText;
    }
});
optimizeSpringKButton.classList.add('project-button');

const optimizeSpringKStatus = document.createElement('div');
optimizeSpringKStatus.className = 'energy-display';
optimizeSpringKStatus.textContent = 'Optimize spring stiffness using staged fitting';

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
        input.className = 'joint-k-input joint-k-value-input';
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        const rawK = Number(window.appActions?.getJointK?.(i));
        input.value = Number.isFinite(rawK) ? rawK.toFixed(2) : '1.00';
        input.addEventListener('change', () => {
            const parsed = Number.parseFloat(input.value);
            const bounded = Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : (Number(window.appActions?.getJointK?.(i)) || 1);
            const nextValue = Math.round(bounded * 100) / 100;
            input.value = nextValue.toFixed(2);
            if (!manualFillCheckbox.checked) {
                return;
            }
            window.appActions?.setJointK?.(i, nextValue);
        });

        row.append(label, input);
        jointKContainer.append(row);
    }

    syncJointKInputEditability();
}

function syncJointKInputEditability() {
    const manualMode = manualFillCheckbox.checked;
    const sectionEnabled = !chainOptionsSection.classList.contains('section-disabled');
    const editable = manualMode && sectionEnabled;

    jointKContainer.querySelectorAll('.joint-k-value-input').forEach((input) => {
        input.disabled = !editable;
        input.classList.toggle('manual-disabled', !manualMode);
    });
}

const manualFillLabel = document.createElement('label');
manualFillLabel.className = 'checkbox-option';

const manualFillCheckbox = document.createElement('input');
manualFillCheckbox.type = 'checkbox';
manualFillCheckbox.checked = false;
manualFillCheckbox.addEventListener('change', () => {
    syncJointKInputEditability();
    window.appActions?.markMechanismNeedsRegeneration?.();
});

const manualFillText = document.createElement('span');
manualFillText.textContent = 'Manual fill k';

manualFillLabel.append(manualFillCheckbox, manualFillText);

const jointThetaDebugRow = document.createElement('div');
jointThetaDebugRow.className = 'joint-k-row';

const jointThetaDebugLabel = document.createElement('label');
jointThetaDebugLabel.className = 'joint-k-label';
jointThetaDebugLabel.textContent = 'Debug joint';

const jointThetaDebugIndexInput = document.createElement('input');
jointThetaDebugIndexInput.className = 'joint-k-input';
jointThetaDebugIndexInput.type = 'number';
jointThetaDebugIndexInput.min = '0';
jointThetaDebugIndexInput.step = '1';
jointThetaDebugIndexInput.value = '0';

jointThetaDebugRow.append(jointThetaDebugLabel, jointThetaDebugIndexInput);

const jointThetaSlider = document.createElement('input');
jointThetaSlider.className = 'joint-k-input';
jointThetaSlider.type = 'range';
jointThetaSlider.min = '0';
jointThetaSlider.max = '1';
jointThetaSlider.step = '0.001';
jointThetaSlider.value = '0';

const jointThetaValueDisplay = document.createElement('div');
jointThetaValueDisplay.className = 'energy-display';
jointThetaValueDisplay.textContent = 'Joint theta: 0.000';

function getDebugJointIndex() {
    const parsed = Number.parseInt(jointThetaDebugIndexInput.value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function syncJointThetaDebugControls() {
    const count = window.appActions?.getJointCount?.() ?? 0;
    const hasJoint = count > 0;

    jointThetaDebugIndexInput.max = String(Math.max(0, count - 1));
    if (!hasJoint) {
        jointThetaDebugIndexInput.value = '0';
        jointThetaSlider.disabled = true;
        jointThetaSlider.min = '0';
        jointThetaSlider.max = '1';
        jointThetaSlider.value = '0';
        jointThetaValueDisplay.textContent = 'Joint theta: -';
        return;
    }

    let index = getDebugJointIndex();
    if (index >= count) {
        index = count - 1;
        jointThetaDebugIndexInput.value = String(index);
    }

    const bounds = window.appActions?.getJointThetaBounds?.(index) ?? { min: 0, max: 1 };
    const min = Number.isFinite(bounds.min) ? bounds.min : 0;
    const max = Number.isFinite(bounds.max) ? bounds.max : 1;
    const theta = Number(window.appActions?.getJointTheta?.(index));
    const safeTheta = Number.isFinite(theta) ? theta : min;

    jointThetaSlider.disabled = false;
    jointThetaSlider.min = String(Math.min(min, max));
    jointThetaSlider.max = String(Math.max(min, max));
    jointThetaSlider.value = String(safeTheta);
    jointThetaValueDisplay.textContent = `Joint theta: ${safeTheta.toFixed(3)} (j${index + 1})`;
}

jointThetaDebugIndexInput.addEventListener('change', () => {
    syncJointThetaDebugControls();
});

jointThetaSlider.addEventListener('input', () => {
    const index = getDebugJointIndex();
    const theta = Number.parseFloat(jointThetaSlider.value);
    if (!Number.isFinite(theta)) return;
    window.appActions?.setJointTheta?.(index, theta);
    const displayed = Number(window.appActions?.getJointTheta?.(index));
    const safeDisplayed = Number.isFinite(displayed) ? displayed : theta;
    jointThetaValueDisplay.textContent = `Joint theta: ${safeDisplayed.toFixed(3)} (j${index + 1})`;
});

const energyDisplay = document.createElement('div');
energyDisplay.className = 'energy-display';
energyDisplay.textContent = 'Elastic Energy: 0';

const lineLengthDisplay = document.createElement('div');
lineLengthDisplay.className = 'energy-display';
lineLengthDisplay.textContent = 'Chain A centerline: 0';
lineLengthDisplay.style.color = '#f58220';

const companionLineLengthDisplay = document.createElement('div');
companionLineLengthDisplay.className = 'energy-display';
companionLineLengthDisplay.textContent = 'Chain B centerline: 0';
companionLineLengthDisplay.style.color = '#f550aa';

const targetLineLengthADisplay = document.createElement('div');
targetLineLengthADisplay.className = 'energy-display';
targetLineLengthADisplay.textContent = 'Target Chain A centerline: -';
targetLineLengthADisplay.style.color = '#f58220';

const targetLineLengthBDisplay = document.createElement('div');
targetLineLengthBDisplay.className = 'energy-display';
targetLineLengthBDisplay.textContent = 'Target Chain B centerline: -';
targetLineLengthBDisplay.style.color = '#f550aa';

const targetLengthBRow = document.createElement('div');
targetLengthBRow.className = 'joint-k-row';
targetLengthBRow.style.alignItems = 'stretch';
targetLengthBRow.style.display = 'grid';
targetLengthBRow.style.gridTemplateColumns = '1fr';
targetLengthBRow.style.gap = '8px';

const targetLengthBLabel = document.createElement('label');
targetLengthBLabel.className = 'joint-k-label';
targetLengthBLabel.textContent = 'Target length B';
targetLengthBLabel.style.alignSelf = 'start';

const targetLengthBControls = document.createElement('div');
targetLengthBControls.style.display = 'flex';
targetLengthBControls.style.gap = '8px';
targetLengthBControls.style.alignItems = 'center';
targetLengthBControls.style.width = '100%';

const targetLengthBInput = document.createElement('input');
targetLengthBInput.className = 'joint-k-input';
targetLengthBInput.type = 'number';
targetLengthBInput.step = '0.01';
targetLengthBInput.placeholder = 'Chain B target';
targetLengthBInput.style.flex = '1 1 auto';
targetLengthBInput.style.minWidth = '0';
targetLengthBInput.style.padding = '10px 12px';
targetLengthBInput.style.fontSize = '14px';

const findTargetLengthBButton = document.createElement('button');
findTargetLengthBButton.type = 'button';
findTargetLengthBButton.textContent = 'Find';
findTargetLengthBButton.style.flex = '0 0 auto';
findTargetLengthBButton.style.minWidth = '64px';
findTargetLengthBButton.style.padding = '10px 14px';
findTargetLengthBButton.addEventListener('click', () => {
    const target = Number.parseFloat(targetLengthBInput.value);
    if (!Number.isFinite(target)) return;
    window.appActions?.optimizeCurrentMechanismForStringLength?.(target);
    updateEnergyAndLengthDisplay();
});

targetLengthBControls.append(targetLengthBInput, findTargetLengthBButton);
targetLengthBRow.append(targetLengthBLabel, targetLengthBControls);

const companionJointWarningDisplay = document.createElement('div');
companionJointWarningDisplay.className = 'energy-display';
companionJointWarningDisplay.style.color = '#b45309';
companionJointWarningDisplay.style.display = 'none';
companionJointWarningDisplay.textContent = '';

const maxBinaryIterationsRow = document.createElement('div');
maxBinaryIterationsRow.className = 'joint-k-row';
maxBinaryIterationsRow.classList.add('iteration-setting-row');

const maxBinaryIterationsLabel = document.createElement('label');
maxBinaryIterationsLabel.className = 'joint-k-label';
maxBinaryIterationsLabel.textContent = 'Max binary iterations';

const maxBinaryIterationsInput = document.createElement('input');
maxBinaryIterationsInput.className = 'joint-k-input';
maxBinaryIterationsInput.type = 'number';
maxBinaryIterationsInput.min = '1';
maxBinaryIterationsInput.step = '1';
maxBinaryIterationsInput.value = String(window.appActions?.getOptimizationMaxBinaryIterations?.() ?? 24);
maxBinaryIterationsInput.addEventListener('change', () => {
    const parsed = Number.parseInt(maxBinaryIterationsInput.value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        maxBinaryIterationsInput.value = String(window.appActions?.getOptimizationMaxBinaryIterations?.() ?? 24);
        return;
    }
    window.appActions?.setOptimizationMaxBinaryIterations?.(parsed);
});

maxBinaryIterationsRow.append(maxBinaryIterationsLabel, maxBinaryIterationsInput);

const maxBracketExpansionsRow = document.createElement('div');
maxBracketExpansionsRow.className = 'joint-k-row';
maxBracketExpansionsRow.classList.add('iteration-setting-row');

const maxBracketExpansionsLabel = document.createElement('label');
maxBracketExpansionsLabel.className = 'joint-k-label';
maxBracketExpansionsLabel.textContent = 'Max bracket expansions';

const maxBracketExpansionsInput = document.createElement('input');
maxBracketExpansionsInput.className = 'joint-k-input';
maxBracketExpansionsInput.type = 'number';
maxBracketExpansionsInput.min = '1';
maxBracketExpansionsInput.step = '1';
maxBracketExpansionsInput.value = String(window.appActions?.getOptimizationMaxBracketExpansions?.() ?? 14);
maxBracketExpansionsInput.addEventListener('change', () => {
    const parsed = Number.parseInt(maxBracketExpansionsInput.value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        maxBracketExpansionsInput.value = String(window.appActions?.getOptimizationMaxBracketExpansions?.() ?? 14);
        return;
    }
    window.appActions?.setOptimizationMaxBracketExpansions?.(parsed);
});

maxBracketExpansionsRow.append(maxBracketExpansionsLabel, maxBracketExpansionsInput);

function syncOptimizationIterationInputs() {
    const binary = Number(window.appActions?.getOptimizationMaxBinaryIterations?.());
    if (Number.isInteger(binary) && binary >= 1) {
        maxBinaryIterationsInput.value = String(binary);
    }

    const bracket = Number(window.appActions?.getOptimizationMaxBracketExpansions?.());
    if (Number.isInteger(bracket) && bracket >= 1) {
        maxBracketExpansionsInput.value = String(bracket);
    }
}

const advancedChainDetails = document.createElement('details');
advancedChainDetails.className = 'advanced-details';

const advancedChainSummary = document.createElement('summary');
advancedChainSummary.textContent = 'Advanced';

const advancedChainContent = document.createElement('div');
advancedChainContent.className = 'advanced-content';

function updateEnergyAndLengthDisplay() {
    const energy = window.appActions?.calculateTotalElasticEnergy?.() ?? 0;
    const holeLengths = window.appActions?.calculateHoleLineLengths?.() ?? { orangeLength: 0, pinkLength: 0 };
    const chainALength = Number.isFinite(holeLengths.orangeLength) ? holeLengths.orangeLength : 0;
    const chainBLengthDisplay = Number.isFinite(holeLengths.pinkLength) ? holeLengths.pinkLength : 0;
    const targetChainA = Number(window.appActions?.getCurrentTargetHoleLengthA?.());
    const targetChainB = Number(window.appActions?.getCurrentTargetHoleLength?.());
    const companionJointWarning = window.appActions?.getCompanionJointWarning?.() ?? '';
    energyDisplay.textContent = `Elastic Energy: ${energy.toFixed(2)}`;
    lineLengthDisplay.textContent = `Chain A centerline: ${chainALength.toFixed(2)}`;
    companionLineLengthDisplay.textContent = `Chain B centerline: ${chainBLengthDisplay.toFixed(2)}`;
    targetLineLengthADisplay.textContent = Number.isFinite(targetChainA)
        ? `Target Chain A centerline: ${targetChainA.toFixed(2)}`
        : 'Target Chain A centerline: -';
    targetLineLengthBDisplay.textContent = Number.isFinite(targetChainB)
        ? `Target Chain B centerline: ${targetChainB.toFixed(2)}`
        : 'Target Chain B centerline: -';
    targetLengthBInput.value = Number.isFinite(targetChainB)
        ? targetChainB.toFixed(2)
        : '';
    companionJointWarningDisplay.textContent = companionJointWarning ? `Companion Joint Warning: ${companionJointWarning}` : '';
    companionJointWarningDisplay.style.display = companionJointWarning ? '' : 'none';
    syncJointThetaDebugControls();
}

advancedChainContent.append(
    manualFillLabel,
    jointKContainer,
    jointThetaDebugRow,
    jointThetaSlider,
    jointThetaValueDisplay,
    targetLengthBRow,
    maxBinaryIterationsRow,
    maxBracketExpansionsRow,
    energyDisplay,
    lineLengthDisplay,
    companionLineLengthDisplay,
    targetLineLengthADisplay,
    targetLineLengthBDisplay,
    companionJointWarningDisplay
);

advancedChainDetails.append(advancedChainSummary, advancedChainContent);

chainOptionsSection.append(
    chainHeader.header,
    holeOptionLabel,
    holePositionARow,
    holePositionBRow,
    jointsOptionLabel,
    mechanismRenderRow,
    chainThicknessRow,
    jointMinThicknessRow,
    slackRow,
    optimizeSpringKButton,
    optimizeSpringKStatus,
    advancedChainDetails
);

const testsSection = document.createElement('div');
testsSection.className = 'chain-section';

const testsHeader = createSectionToggle(
    'Tests',
    window.appActions?.getMechanismErrorVisible?.() ?? false,
    (visible) => {
        window.appActions?.setMechanismErrorVisible?.(visible);
    }
);

const errorDistanceDisplay = document.createElement('div');
errorDistanceDisplay.className = 'energy-display';
errorDistanceDisplay.textContent = 'Total distance between simulated mechanism and skeleton: 0.00';

testsSection.append(testsHeader.header, errorDistanceDisplay);

// Cleanup for older UI state: remove any legacy energy row that was rendered
// outside the Advanced details block.
function removeLegacyMechanismEnergyField() {
    chainOptionsSection.querySelectorAll('.energy-display').forEach((node) => {
        const text = (node.textContent || '').trim();
        if (text.startsWith('Total Elastic Energy:')) {
            node.remove();
        }
    });
}

removeLegacyMechanismEnergyField();



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

const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
skeletonPointCountRow.append(skeletonPointCountLabel, skeletonPointCountInput, skeletonResampleButton);

const skeletonAdvancedDetails = document.createElement('details');
skeletonAdvancedDetails.className = 'advanced-details skeleton-advanced-details';

const skeletonAdvancedSummary = document.createElement('summary');
skeletonAdvancedSummary.textContent = 'Advanced';

const skeletonAdvancedContent = document.createElement('div');
skeletonAdvancedContent.className = 'advanced-content';

const skeletonBisectorOptionLabel = document.createElement('label');
skeletonBisectorOptionLabel.className = 'checkbox-option';

const skeletonBisectorCheckbox = document.createElement('input');
skeletonBisectorCheckbox.type = 'checkbox';
skeletonBisectorCheckbox.checked = window.appActions?.getSkeletonBisectorVisible?.() ?? false;
skeletonBisectorCheckbox.addEventListener('change', () => {
    window.appActions?.setSkeletonBisectorVisible?.(skeletonBisectorCheckbox.checked);
});

const skeletonBisectorOptionText = document.createElement('span');
skeletonBisectorOptionText.textContent = 'Bisector';

skeletonBisectorOptionLabel.append(skeletonBisectorCheckbox, skeletonBisectorOptionText);

const skeletonRef1OptionLabel = document.createElement('label');
skeletonRef1OptionLabel.className = 'checkbox-option';

const skeletonRef1Checkbox = document.createElement('input');
skeletonRef1Checkbox.type = 'checkbox';
skeletonRef1Checkbox.checked = window.appActions?.getSkeletonRef1Visible?.() ?? false;
skeletonRef1Checkbox.disabled = !skeletonBisectorCheckbox.checked;
skeletonRef1Checkbox.addEventListener('change', () => {
    window.appActions?.setSkeletonRef1Visible?.(skeletonRef1Checkbox.checked);
});

const skeletonRef1OptionText = document.createElement('span');
skeletonRef1OptionText.textContent = 'Ref 1';

skeletonRef1OptionLabel.append(skeletonRef1Checkbox, skeletonRef1OptionText);

const skeletonRef2OptionLabel = document.createElement('label');
skeletonRef2OptionLabel.className = 'checkbox-option';

const skeletonRef2Checkbox = document.createElement('input');
skeletonRef2Checkbox.type = 'checkbox';
skeletonRef2Checkbox.checked = window.appActions?.getSkeletonRef2Visible?.() ?? false;
skeletonRef2Checkbox.disabled = !skeletonBisectorCheckbox.checked;
skeletonRef2Checkbox.addEventListener('change', () => {
    window.appActions?.setSkeletonRef2Visible?.(skeletonRef2Checkbox.checked);
});

const skeletonRef2OptionText = document.createElement('span');
skeletonRef2OptionText.textContent = 'Ref 2';

skeletonRef2OptionLabel.append(skeletonRef2Checkbox, skeletonRef2OptionText);

skeletonBisectorCheckbox.addEventListener('change', () => {
    const enabled = skeletonBisectorCheckbox.checked;
    skeletonRef1Checkbox.disabled = !enabled;
    skeletonRef2Checkbox.disabled = !enabled;
    if (!enabled) {
        skeletonRef1Checkbox.checked = false;
        skeletonRef2Checkbox.checked = false;
        window.appActions?.setSkeletonRef1Visible?.(false);
        window.appActions?.setSkeletonRef2Visible?.(false);
    }
});

skeletonAdvancedContent.append(
    skeletonPointCountRow,
    skeletonBisectorOptionLabel,
    skeletonRef1OptionLabel,
    skeletonRef2OptionLabel
);

skeletonAdvancedDetails.append(skeletonAdvancedSummary, skeletonAdvancedContent);

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
let frameCopySkeletonButton = null;
let iconActionsRow = null;

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
    const hasAnySkeleton = (window.appActions?.getLastSkeletonFrameIndex?.() ?? -1) >= 0;
    buildButton.textContent = hasChain ? 'Regenerate Chain' : 'Generate Chain';
    bottomSecondaryActions.style.display = hasChain ? 'grid' : 'none';
    buildButton.disabled = !hasAnySkeleton;

}

function updateProgressiveVisibility() {
    const hasVideo = hasLoadedVideo();
    const pointCount = getCurrentSkeletonPointCount();
    const hasSkeleton = pointCount > 0;
    const hasMechanism = window.appActions?.hasRenderableChain?.() ?? false;

    if (!hasVideo && (window.appActions?.getRulerVisible?.() ?? false)) {
        window.appActions?.setRulerVisible?.(false);
    }

    const frameToggleControl = frameHeader.input?.parentElement;
    if (frameToggleControl) {
        frameToggleControl.style.display = hasVideo ? '' : 'none';
    }

    if (playPauseButton) {
        playPauseButton.style.display = hasVideo ? '' : 'none';
    }
    if (frameCopySkeletonButton) {
        frameCopySkeletonButton.style.display = hasVideo ? '' : 'none';
    }
    if (rulerButton) {
        rulerButton.style.display = hasVideo ? '' : 'none';
    }
    if (uploadVideoText) {
        uploadVideoText.style.display = hasVideo ? 'none' : '';
    }
    if (iconActionsRow) {
        iconActionsRow.classList.toggle('no-video', !hasVideo);
    }
    frameControl.style.display = hasVideo ? 'grid' : 'none';

    skeletonSection.style.display = hasVideo ? '' : 'none';
    chainOptionsSection.style.display = (hasVideo && hasSkeleton) ? '' : 'none';

    chainHeader.header.style.display = hasMechanism ? '' : 'none';
    holeOptionLabel.style.display = hasMechanism ? '' : 'none';
    holePositionARow.style.display = hasMechanism ? 'grid' : 'none';
    holePositionBRow.style.display = hasMechanism ? 'grid' : 'none';
    jointsOptionLabel.style.display = hasMechanism ? '' : 'none';
    mechanismRenderRow.style.display = hasMechanism ? '' : 'grid';
    optimizeSpringKButton.style.display = hasMechanism ? '' : 'none';
    optimizeSpringKStatus.style.display = hasMechanism ? '' : 'none';

    skeletonDrawHint.style.display = (hasVideo && !hasSkeleton) ? '' : 'none';
    addPointButton.style.display = hasSkeleton ? '' : 'none';
    skeletonAdvancedDetails.style.display = hasSkeleton ? '' : 'none';

    if (hasVideo && !hasSkeleton && window.appActions?.getMode?.() !== 'create') {
        window.appActions?.switchToCreateMode?.();
    }

    updateRulerButtonState();
}

bottomActions.append(buildButton, chainBuildProgressWrap, bottomSecondaryActions);

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
    syncThicknessInputs();
    syncOptimizationIterationInputs();
    updateBuildControls();
    renderJointKInputs();
    updateEnergyAndLengthDisplay();
    updateRulerButtonState();
    skeletonPointCountInput.value = String(Math.max(2, window.appActions?.getCurrentSkeletonPointCount?.() ?? 2));
    const skeletonVisible = window.appActions?.getSkeletonVisible?.() ?? true;
    const skeletonBisectorVisible = window.appActions?.getSkeletonBisectorVisible?.() ?? false;
    const skeletonRef1Visible = window.appActions?.getSkeletonRef1Visible?.() ?? false;
    const skeletonRef2Visible = window.appActions?.getSkeletonRef2Visible?.() ?? false;
    const framesVisible = window.appActions?.getFramesVisible?.() ?? true;
    const chainVisible = window.appActions?.getChainVisible?.() ?? true;
    const holeEnabled = window.appActions?.getHoleEnabled?.() ?? false;
    const jointsEnabled = window.appActions?.getJointsEnabled?.() ?? false;
    const mechanismRenderChain = window.appActions?.getMechanismRenderChain?.() ?? 'A';
    const mechanismErrorVisible = window.appActions?.getMechanismErrorVisible?.() ?? false;
    const mechanismErrorDistance = Number(window.appActions?.getMechanismSkeletonErrorDistance?.());

    skeletonHeader.sync(skeletonVisible);
    skeletonBisectorCheckbox.checked = skeletonBisectorVisible;
    skeletonRef1Checkbox.checked = skeletonRef1Visible;
    skeletonRef2Checkbox.checked = skeletonRef2Visible;
    skeletonRef1Checkbox.disabled = !skeletonBisectorVisible;
    skeletonRef2Checkbox.disabled = !skeletonBisectorVisible;
    frameHeader.sync(framesVisible);
    chainHeader.sync(chainVisible);
    holeCheckbox.checked = holeEnabled;
    jointsCheckbox.checked = jointsEnabled;
    testsHeader.sync(mechanismErrorVisible);
    mechanismRenderAInput.checked = mechanismRenderChain === 'A';
    mechanismRenderBInput.checked = mechanismRenderChain === 'B';
    errorDistanceDisplay.textContent = Number.isFinite(mechanismErrorDistance)
        ? `Total distance between simulated mechanism and skeleton: ${mechanismErrorDistance.toFixed(2)}`
        : 'Total distance between simulated mechanism and skeleton: -';

    setSectionInteractive(skeletonSection, skeletonHeader.input, skeletonVisible);
    setSectionInteractive(frameSection, frameHeader.input, framesVisible);
    const hasSkeleton = getCurrentSkeletonPointCount() > 0;
    const hasMechanism = window.appActions?.hasRenderableChain?.() ?? false;
    const mechanismSectionEnabled = hasSkeleton && (!hasMechanism || chainVisible);
    setSectionInteractive(chainOptionsSection, chainHeader.input, mechanismSectionEnabled);
    syncJointKInputEditability();
    updateProgressiveVisibility();
});

window.appActions?.onModeChange?.((mode) => {
    updateAddPointButtonState(mode);
});

updateFrameInput();
updateBuildControls();
updateAddPointButtonState();
syncThicknessInputs();
syncOptimizationIterationInputs();
renderJointKInputs();
updateEnergyAndLengthDisplay();
testsHeader.sync(window.appActions?.getMechanismErrorVisible?.() ?? false);
{
    const mechanismErrorDistance = Number(window.appActions?.getMechanismSkeletonErrorDistance?.());
    errorDistanceDisplay.textContent = Number.isFinite(mechanismErrorDistance)
        ? `Total distance between simulated mechanism and skeleton: ${mechanismErrorDistance.toFixed(2)}`
        : 'Total distance between simulated mechanism and skeleton: -';
}
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
    getCurrentSkeletonPointCount() > 0
);
syncJointKInputEditability();

iconActionsRow = document.createElement('div');
iconActionsRow.className = 'icon-actions-row frame-icon-actions-row';

const videoIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5v2zM12 3l-5 5h3v6h4V8h3l-5-5z"/></svg>';
const rulerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l9.94-9.94.92.92-9.94 9.94zm10.62-11.2l-.92-.92 1.27-1.27.92.92-1.27 1.27zM19.92 5.35L18.65 4.08 20.08 2.65c.36-.36.95-.36 1.31 0l.96.96c.36.36.36.95 0 1.31l-1.43 1.43z"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h5v14H6zm7 0h5v14h-5z"/></svg>';

const uploadVideoIconButton = createIconButton(videoIcon, 'Upload Video', () => {
    window.videoControls?.openVideoPicker();
});

frameCopySkeletonButton = createIconButton(copyIcon, 'Copy Previous Skeleton', () => {
    window.appActions?.copyPreviousFrameSkeleton?.();
    updateFrameInput();
    updateBuildControls();
    updateEnergyAndLengthDisplay();
    updateProgressiveVisibility();
});

const rulerButton = createIconButton(rulerIcon, 'Toggle Ruler', () => {
    window.appActions?.toggleRulerVisible?.();
    updateRulerButtonState();
});
rulerButton.classList.add('ruler-button');

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

function updateRulerButtonState() {
    const active = window.appActions?.getRulerVisible?.() ?? false;
    rulerButton.classList.toggle('active', active);
    rulerButton.setAttribute('aria-pressed', active ? 'true' : 'false');

    const hasSkeleton = (window.appActions?.getCurrentSkeletonPointCount?.() ?? 0) > 0;
    const canEditSkeleton = !active;
    addPointButton.disabled = !hasSkeleton || !canEditSkeleton;
    skeletonPointCountInput.disabled = !hasSkeleton || !canEditSkeleton;
    skeletonResampleButton.disabled = !hasSkeleton || !canEditSkeleton;
}

window.videoControls?.onPlaybackChange?.(() => {
    updatePlaybackButton();
});

updatePlaybackButton();

iconActionsRow.append(uploadVideoPrompt, frameCopySkeletonButton, rulerButton, playPauseButton);

updateRulerButtonState();

updateProgressiveVisibility();

skeletonSection.append(skeletonHeader.header, skeletonDrawHint, addPointButton, skeletonAdvancedDetails);
frameSection.append(frameHeader.header, iconActionsRow, frameControl);

// Add controls to sidebar
sidebar.append(
    sidebarHeader,
    sidebarSubheader,
    projectActionsDiv,
    frameSection,
    skeletonSection,
    chainOptionsSection,
    testsSection,
    sideSpacer,
    bottomActions
);

// Add sidebar to page
document.body.appendChild(sidebar);