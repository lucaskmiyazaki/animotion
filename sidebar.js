// Create sidebar container
const sidebar = document.createElement('div');
sidebar.id = 'sidebar';

// Helper to create buttons
function createButton(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

// MODE TOGGLE BUTTON
const modeButton = document.createElement('button');

function updateModeButton() {
    const mode = window.appActions?.getMode?.() || 'create';
    modeButton.textContent = mode === 'create'
        ? 'Mode: Create'
        : 'Mode: Edit';
}

modeButton.addEventListener('click', () => {
    window.appActions?.toggleMode?.();
    updateModeButton();
});

// Initialize label
updateModeButton();

const buildButton = createButton('Build Chain', () => {
    window.appActions?.buildChain();
});

const deletePointButton = createButton('Delete Point', () => {
    window.appActions?.deleteSelectedPoint();
});

const previewButton = createButton('Preview', () => {
    window.appActions?.playPreviewAnimation();
});

const exportButton = createButton('Export DXF', () => {
    window.appActions?.exportDXF();
});

const uploadVideoButton = createButton('Upload Video', () => {
    window.videoControls?.openVideoPicker();
});

const copyPrevFrameButton = createButton('Copy Prev', () => {
    window.appActions?.copyPreviousFrameSkeleton();
});

const prevFrameButton = createButton('Prev Frame', () => {
    window.videoControls?.prevFrame();
});

const nextFrameButton = createButton('Next Frame', () => {
    window.videoControls?.nextFrame();
});

// Add buttons to sidebar
sidebar.append(
    modeButton,
    buildButton,
    deletePointButton,
    copyPrevFrameButton,
    previewButton,
    exportButton,
    uploadVideoButton,
    prevFrameButton,
    nextFrameButton
);

// Add sidebar to page
document.body.appendChild(sidebar);