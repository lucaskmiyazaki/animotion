const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let lastDisplayedVideoRect = null;
let observedBackgroundVideo = null;

// one chain per frame
const frameChains = {};

// one skeleton per frame
const frameSkeletons = {};
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
let skeletonVisible = true;
let chainVisible = true;
const jointKByIndex = {};

// Default trapezoid thickness
let chainThickness = 50;
let jointMinimumThickness = 5;
let lastBisectorThicknessLogAt = 0;
let companionRigidModel = null;
const pointRadius = 5;
const hoverRadius = 9;
const hitRadius = 10;
const rulerHandleRadius = 10;
const rulerLabelPaddingX = 8;
const rulerLabelPaddingY = 5;

const rulerState = {
    visible: false,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    mmLength: 1000,
    initialized: false
};

let draggedRulerHandle = null;
let currentRulerLabelBounds = null;

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

function clampRulerMillimeters(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 1000;
    }
    return parsed;
}

function getRulerPixelLength() {
    return Math.hypot(rulerState.end.x - rulerState.start.x, rulerState.end.y - rulerState.start.y);
}

function getRulerScaleMmPerPixel() {
    const px = getRulerPixelLength();
    if (px <= 1e-8) {
        return 1;
    }
    return clampRulerMillimeters(rulerState.mmLength) / px;
}

function ensureRulerInitialized() {
    if (rulerState.initialized) {
        return;
    }

    const rect = getDisplayedVideoRect();
    const y = rect.top + rect.height * 0.15;
    rulerState.start.x = rect.left + rect.width * 0.2;
    rulerState.start.y = y;
    rulerState.end.x = rect.left + rect.width * 0.8;
    rulerState.end.y = y;
    rulerState.initialized = true;
}

function pointHitsRulerHandle(x, y, handlePoint) {
    return Math.hypot(x - handlePoint.x, y - handlePoint.y) <= rulerHandleRadius + 2;
}

function pointHitsRulerLabel(x, y) {
    if (!currentRulerLabelBounds) return false;
    return x >= currentRulerLabelBounds.left &&
        x <= currentRulerLabelBounds.right &&
        y >= currentRulerLabelBounds.top &&
        y <= currentRulerLabelBounds.bottom;
}

function tryStartRulerDrag(x, y) {
    if (!rulerState.visible) return false;
    ensureRulerInitialized();

    if (pointHitsRulerHandle(x, y, rulerState.start)) {
        draggedRulerHandle = 'start';
        return true;
    }
    if (pointHitsRulerHandle(x, y, rulerState.end)) {
        draggedRulerHandle = 'end';
        return true;
    }

    return false;
}

function tryHandleRulerClick(x, y) {
    if (!rulerState.visible) return false;
    ensureRulerInitialized();

    if (!pointHitsRulerLabel(x, y)) {
        return false;
    }

    const input = prompt('Ruler length (mm):', String(clampRulerMillimeters(rulerState.mmLength)));
    if (input === null) {
        return true;
    }

    const nextMm = Number.parseFloat(input);
    if (!Number.isFinite(nextMm) || nextMm <= 0) {
        alert('Please enter a positive numeric value in millimeters.');
        return true;
    }

    rulerState.mmLength = nextMm;
    redrawAll();
    return true;
}

function updateDraggedRulerHandle(mouseX, mouseY) {
    if (!draggedRulerHandle) return;
    rulerState[draggedRulerHandle].x = mouseX;
    rulerState[draggedRulerHandle].y = mouseY;
}

function isRulerInteractionMode() {
    return rulerState.visible;
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

    if (rulerState.initialized) {
        transformPointToNewVideoRect(rulerState.start, oldRect, newRect, scaleX, scaleY);
        transformPointToNewVideoRect(rulerState.end, oldRect, newRect, scaleX, scaleY);
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
    return frameSkeletons[currentFrameIndex] || null;
}

function getCurrentChain() {
    return frameChains[currentFrameIndex] || null;
}

function emitChainStateChange() {
    chainStateListeners.forEach(listener => listener());
}

function emitModeChange() {
    modeChangeListeners.forEach(listener => listener(mode));
}

function setFrameChainBuilt(frameIndex, built) {
    if (built) {
        frameChainBuilt[frameIndex] = true;
    } else {
        delete frameChainBuilt[frameIndex];
    }
    emitChainStateChange();
}

function markCurrentFrameChainDirty() {
    delete frameChains[currentFrameIndex];
    setFrameChainBuilt(currentFrameIndex, false);
}

function hasChainInFrame(frameIndex) {
    const frameChain = frameChains[frameIndex];
    return Boolean(frameChain && frameChain.getTrapezoids().length > 0 && frameChainBuilt[frameIndex]);
}

function hasRenderableChain() {
    return Boolean(getMainChain());
}

function getJointK(jointIndex) {
    const raw = Number(jointKByIndex[jointIndex]);
    return Number.isFinite(raw) ? raw : 1;
}

function setJointK(jointIndex, value) {
    const idx = Number.parseInt(jointIndex, 10);
    if (!Number.isInteger(idx) || idx < 0) return;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        delete jointKByIndex[idx];
    } else {
        jointKByIndex[idx] = Math.max(1, Math.min(10, parsed));
    }

    emitChainStateChange();
    redrawAll();
}

function getJointCount(chain) {
    const activeChain = chain || getMainChain();
    const links = activeChain?.getTrapezoids?.()?.length ?? 0;
    return Math.max(links - 1, 0);
}

function getJointKValues(chain) {
    const count = getJointCount(chain);
    const values = [];
    for (let i = 0; i < count; i++) {
        values.push(getJointK(i));
    }
    return values;
}

function getChainThickness() {
    return chainThickness;
}

function setChainThickness(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    chainThickness = parsed;
    emitChainStateChange();
    redrawAll();
}

function getJointMinimumThickness() {
    return jointMinimumThickness;
}

function setJointMinimumThickness(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    jointMinimumThickness = parsed;
    emitChainStateChange();
    redrawAll();
}

function getJointGammaDegrees(chain, linkIndex) {
    const activeChain = chain || getMainChain();
    const trapezoids = activeChain?.getTrapezoids?.() ?? [];
    if (!activeChain || linkIndex <= 0 || linkIndex >= trapezoids.length) {
        return 0;
    }

    const prev = trapezoids[linkIndex - 1];
    const curr = trapezoids[linkIndex];
    const theta = Math.abs(shortestAngleDifference(prev.rotation, curr.rotation));
    const a1 = (prev.trapezoid.angleRight * 360) / Math.PI;
    const a2 = (curr.trapezoid.angleLeft * 360) / Math.PI;
    const gamma = 180 - theta - a1 - a2;
    return Math.max(gamma, 0.001);
}

function getJointThicknesses(chain) {
    const activeChain = chain || getMainChain();
    const count = getJointCount(activeChain);
    if (!activeChain || count <= 0) {
        return [];
    }

    const raw = [];
    for (let i = 0; i < count; i++) {
        const gamma = getJointGammaDegrees(activeChain, i + 1);
        const tanHalfGamma = Math.tan((gamma * Math.PI / 180) / 2);
        const safeTan = Math.max(tanHalfGamma, 1e-6);
        const k = Math.max(getJointK(i), 1e-8);
        raw.push(Math.sqrt(k * safeTan));
    }

    const minRaw = Math.min(...raw);
    if (!Number.isFinite(minRaw) || minRaw <= 0) {
        return Array(count).fill(jointMinimumThickness);
    }

    const scale = jointMinimumThickness / minRaw;
    return raw.map(value => value * scale);
}

function updateJointKFromThicknessModel(chain) {
    const activeChain = chain || getMainChain();
    const count = getJointCount(activeChain);
    if (!activeChain || count <= 0) {
        return;
    }

    const thicknesses = getJointThicknesses(activeChain);
    for (let i = 0; i < count; i++) {
        const gamma = getJointGammaDegrees(activeChain, i + 1);
        const tanHalfGamma = Math.tan((gamma * Math.PI / 180) / 2);
        const safeTan = Math.max(tanHalfGamma, 1e-6);
        const k = (thicknesses[i] * thicknesses[i]) / safeTan;
        jointKByIndex[i] = Math.max(k, 1e-6);
    }
}

// Elastic potential energy at current frame:
// E_total = sum_j (1/2) * k_j * (theta_j - theta_j0)^2
function calculateTotalElasticEnergy() {
    const chain = getMainChain();
    if (!chain || chain.getTrapezoids().length <= 1) {
        return 0;
    }

    const trapezoids = chain.getTrapezoids();
    const maxFrameIndex = window.videoControls?.getMaxFrameIndex?.() ?? 0;
    const t = maxFrameIndex > 0 ? Math.min(currentFrameIndex / maxFrameIndex, 1) : 0;

    let totalEnergy = 0;
    for (let i = 1; i < trapezoids.length; i++) {
        const prev = trapezoids[i - 1];
        const item = trapezoids[i];

        const theta0 = shortestAngleDifference(prev.startRotation, item.startRotation);
        const thetaFinal = shortestAngleDifference(prev.finalRotation, item.finalRotation);
        const thetaDelta = shortestAngleDifference(theta0, thetaFinal);
        const theta = theta0 + thetaDelta * t;

        const k = getJointK(i - 1);
        const dTheta = theta - theta0;
        totalEnergy += 0.5 * k * dTheta * dTheta;
    }

    return totalEnergy;
}

// Hole-network length:
// L = sum(hole line lengths) + sum(connection lengths between adjacent hole lines)
function calculateTotalLineLength(chain = getMainChain()) {
    if (!chain || chain.getTrapezoids().length === 0) {
        return 0;
    }

    const trapezoids = chain.getTrapezoids();
    let totalLength = 0;

    const holeMids = trapezoids.map(item => {
        const pts = item.trapezoid.getPoints(item.position, item.rotation);
        const leftMid = {
            x: (pts[0].x + pts[3].x) / 2,
            y: (pts[0].y + pts[3].y) / 2
        };
        const rightMid = {
            x: (pts[1].x + pts[2].x) / 2,
            y: (pts[1].y + pts[2].y) / 2
        };

        // Hole line inside this trapezoid.
        totalLength += Math.hypot(rightMid.x - leftMid.x, rightMid.y - leftMid.y);

        return { leftMid, rightMid };
    });

    // Connection line from right end of link i hole line to left end of link i+1 hole line.
    for (let i = 0; i < holeMids.length - 1; i++) {
        const from = holeMids[i].rightMid;
        const to = holeMids[i + 1].leftMid;
        totalLength += Math.hypot(to.x - from.x, to.y - from.y);
    }

    return totalLength;
}

function snapshotChainPose(chain) {
    const trapezoids = chain?.getTrapezoids?.() ?? [];
    return trapezoids.map(item => ({
        rotation: item.rotation,
        position: { x: item.position.x, y: item.position.y }
    }));
}

function restoreChainPose(chain, snapshot) {
    const trapezoids = chain?.getTrapezoids?.() ?? [];
    if (!Array.isArray(snapshot) || snapshot.length !== trapezoids.length) return;

    trapezoids.forEach((item, i) => {
        item.rotation = snapshot[i].rotation;
        item.position.x = snapshot[i].position.x;
        item.position.y = snapshot[i].position.y;
    });
}

function calculateInitialAndFinalLineLengths() {
    const chain = getMainChain();
    if (!chain || chain.getTrapezoids().length === 0) {
        return { initialL: 0, finalL: 0 };
    }

    const savedPose = snapshotChainPose(chain);

    applyChainAtT(chain, 0);
    const initialL = calculateTotalLineLength(chain);

    applyChainAtT(chain, 1);
    const finalL = calculateTotalLineLength(chain);

    restoreChainPose(chain, savedPose);

    return { initialL, finalL };
}

function calculateInitialLineLength() {
    return calculateInitialAndFinalLineLengths().initialL;
}

function calculateFinalLineLength() {
    return calculateInitialAndFinalLineLengths().finalL;
}

function getJointAngleInitials(chain) {
    const activeChain = chain || getMainChain();
    const trapezoids = activeChain?.getTrapezoids?.() ?? [];
    const angles = [];

    for (let i = 1; i < trapezoids.length; i++) {
        const prev = trapezoids[i - 1];
        const item = trapezoids[i];
        angles.push(shortestAngleDifference(prev.startRotation, item.startRotation));
    }

    return angles;
}

function getCurrentJointAngles(chain) {
    const activeChain = chain || getMainChain();
    const trapezoids = activeChain?.getTrapezoids?.() ?? [];
    const angles = [];

    for (let i = 1; i < trapezoids.length; i++) {
        const prev = trapezoids[i - 1];
        const item = trapezoids[i];
        angles.push(shortestAngleDifference(prev.rotation, item.rotation));
    }

    return angles;
}

function getJointAngleLimits(chain, jointIndex) {
    const activeChain = chain || getMainChain();
    const trapezoids = activeChain?.getTrapezoids?.() ?? [];
    if (jointIndex < 0 || jointIndex >= trapezoids.length - 1) {
        return null;
    }

    const prev = trapezoids[jointIndex];
    const item = trapezoids[jointIndex + 1];
    const finalRel = shortestAngleDifference(prev.finalRotation, item.finalRotation);

    // Same rule as the existing constraint system:
    // the other bound is 90 degrees past straight in the direction away from finalRel.
    const dirTowardStraight = finalRel >= 0 ? -1 : 1;
    const otherLimit = finalRel + 90 * dirTowardStraight;
    return {
        minRel: Math.min(finalRel, otherLimit),
        maxRel: Math.max(finalRel, otherLimit)
    };
}

function clampJointAngles(chain, angles) {
    return angles.map((angle, jointIndex) => {
        const limits = getJointAngleLimits(chain, jointIndex);
        if (!limits) return angle;
        return Math.max(limits.minRel, Math.min(limits.maxRel, angle));
    });
}

function applyJointAngles(chain, jointAngles) {
    const trapezoids = chain?.getTrapezoids?.() ?? [];
    if (!chain || trapezoids.length === 0) return;

    trapezoids[0].rotation = trapezoids[0].startRotation;
    for (let i = 1; i < trapezoids.length; i++) {
        const prev = trapezoids[i - 1];
        const item = trapezoids[i];
        item.rotation = normalizeAngle(prev.rotation + jointAngles[i - 1]);
    }

    chain.positionAllLinksFromRotations();
}

function computeLengthGradients(chain, angles, epsilon = 0.25) {
    const activeChain = chain || getMainChain();
    const trapezoids = activeChain?.getTrapezoids?.() ?? [];
    if (!activeChain || trapezoids.length <= 1) {
        return [];
    }

    const gradients = [];
    for (let jointIndex = 0; jointIndex < angles.length; jointIndex++) {
        const testPlus = angles.slice();
        const testMinus = angles.slice();
        testPlus[jointIndex] = anglePlusMinusClamp(activeChain, jointIndex, angles[jointIndex] + epsilon);
        testMinus[jointIndex] = anglePlusMinusClamp(activeChain, jointIndex, angles[jointIndex] - epsilon);

        applyJointAngles(activeChain, testPlus);
        const lPlus = calculateTotalLineLength(activeChain);

        applyJointAngles(activeChain, testMinus);
        const lMinus = calculateTotalLineLength(activeChain);

        gradients.push((lPlus - lMinus) / (2 * epsilon));
    }

    return gradients;
}

function anglePlusMinusClamp(chain, jointIndex, angle) {
    const limits = getJointAngleLimits(chain, jointIndex);
    if (!limits) return angle;
    return Math.max(limits.minRel, Math.min(limits.maxRel, angle));
}

function projectAnglesToTargetL(chain, angles, targetL, maxProjectionIterations = 8) {
    const activeChain = chain || getMainChain();
    if (!activeChain || activeChain.getTrapezoids().length <= 1 || angles.length === 0) {
        return angles;
    }

    let projected = clampJointAngles(activeChain, angles.slice());

    for (let iteration = 0; iteration < maxProjectionIterations; iteration++) {
        applyJointAngles(activeChain, projected);
        const currentL = calculateTotalLineLength(activeChain);
        const error = currentL - targetL;
        if (Math.abs(error) < 0.25) break;

        const lengthGradients = computeLengthGradients(activeChain, projected, 0.25);
        const denominator = lengthGradients.reduce((sum, value) => sum + value * value, 0);
        if (denominator < 1e-8) break;

        const correction = error / denominator;
        projected = projected.map((angle, jointIndex) => {
            const nextAngle = angle - correction * lengthGradients[jointIndex];
            return anglePlusMinusClamp(activeChain, jointIndex, nextAngle);
        });
    }

    applyJointAngles(activeChain, projected);
    return projected;
}

function solveMinimalEnergyAnglesForTargetL(chain, targetL, maxIterations = 80) {
    const activeChain = chain || getMainChain();
    const trapezoids = activeChain?.getTrapezoids?.() ?? [];
    if (!activeChain || trapezoids.length <= 1) {
        return [];
    }

    const initialAngles = getJointAngleInitials(activeChain);
    const currentAngles = getCurrentJointAngles(activeChain);
    let angles = currentAngles.length === initialAngles.length
        ? currentAngles.slice()
        : initialAngles.slice();
    angles = clampJointAngles(activeChain, angles);

    const learningRate = 0.08;
    const penaltyWeight = 12;
    const epsilon = 0.25;
    const minIterations = 10;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        applyJointAngles(activeChain, angles);
        const currentL = calculateTotalLineLength(activeChain);
        const lError = currentL - targetL;

        if (iteration >= minIterations && Math.abs(lError) < 0.5) {
            break;
        }

        const gradients = angles.map((angle, jointIndex) => {
            const testPlus = angles.slice();
            const testMinus = angles.slice();
            testPlus[jointIndex] = angle + epsilon;
            testMinus[jointIndex] = angle - epsilon;

            applyJointAngles(activeChain, clampJointAngles(activeChain, testPlus));
            const lPlus = calculateTotalLineLength(activeChain);

            applyJointAngles(activeChain, clampJointAngles(activeChain, testMinus));
            const lMinus = calculateTotalLineLength(activeChain);

            const dL = (lPlus - lMinus) / (2 * epsilon);
            const dEnergy = getJointK(jointIndex) * (angle - initialAngles[jointIndex]);
            const dPenalty = 2 * penaltyWeight * lError * dL;
            return dEnergy + dPenalty;
        });

        angles = angles.map((angle, jointIndex) => {
            const nextAngle = angle - learningRate * gradients[jointIndex];
            const limits = getJointAngleLimits(activeChain, jointIndex);
            if (!limits) return nextAngle;
            return Math.max(limits.minRel, Math.min(limits.maxRel, nextAngle));
        });

        angles = projectAnglesToTargetL(activeChain, angles, targetL);
    }

    applyJointAngles(activeChain, angles);
    return angles;
}

function applyChainAtTargetL(chain, targetL) {
    solveMinimalEnergyAnglesForTargetL(chain, targetL);
}

function updateChainForCurrentFrameByLength(chain, frameIndex) {
    const maxFrameIndex = window.videoControls?.getMaxFrameIndex?.() ?? 0;
    const t = maxFrameIndex > 0 ? Math.min(frameIndex / maxFrameIndex, 1) : 0;
    const initialL = calculateInitialLineLength();
    const finalL = calculateFinalLineLength();
    const rawTargetL = initialL + (finalL - initialL) * t;
    const minL = Math.min(initialL, finalL);
    const maxL = Math.max(initialL, finalL);
    const targetL = Math.max(minL, Math.min(maxL, rawTargetL));
    applyChainAtTargetL(chain, targetL);
    return targetL;
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
    if (!frameSkeletons[currentFrameIndex]) {
        frameSkeletons[currentFrameIndex] = new Skeleton();
    }
    return frameSkeletons[currentFrameIndex];
}

function setCurrentFrame(frameIndex) {
    currentFrameIndex = frameIndex;
    hoveredPoint = null;
    draggedPoint = null;

    // Interpolate target L and solve for the minimum-energy theta values.
    const chain = getMainChain();
    if (chain) {
        updateChainForCurrentFrameByLength(chain, frameIndex);

        const skeleton = getCurrentSkeleton();
        alignChainRootToSkeleton(chain, skeleton);
    }

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
    if (tryHandleRulerClick(e.clientX, e.clientY)) {
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
    if (tryStartRulerDrag(e.clientX, e.clientY)) {
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

    if (draggedRulerHandle) {
        updateDraggedRulerHandle(mouseX, mouseY);
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
    draggedRulerHandle = null;
});

canvas.addEventListener('mouseleave', () => {
    hoveredPoint = null;
    draggedPoint = null;
    draggedRulerHandle = null;
    redrawAll();
});

function drawChain(chain) {
    const trapezoids = chain.getTrapezoids();

    trapezoids.forEach(item => {
        const pts = item.trapezoid.getPoints(item.position, item.rotation);

        ctx.fillStyle = 'rgba(0,200,0,0.3)';
        ctx.strokeStyle = 'green';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);

        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (holeEnabled) {
            // Center line parallel to the top/bottom edges of each link.
            const leftMid = {
                x: (pts[0].x + pts[3].x) / 2,
                y: (pts[0].y + pts[3].y) / 2
            };
            const rightMid = {
                x: (pts[1].x + pts[2].x) / 2,
                y: (pts[1].y + pts[2].y) / 2
            };

            ctx.beginPath();
            ctx.moveTo(leftMid.x, leftMid.y);
            ctx.lineTo(rightMid.x, rightMid.y);
            ctx.strokeStyle = 'rgba(0, 80, 0, 0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Keep for hole-to-hole connection drawing.
            item._holeLeftMid = leftMid;
            item._holeRightMid = rightMid;
        }
    });

    // Draw hole connection lines between adjacent links whenever Hole is enabled.
    if (holeEnabled && trapezoids.length >= 2) {
        ctx.strokeStyle = 'rgba(0, 100, 0, 0.6)';
        ctx.lineWidth = 1;

        for (let i = 0; i < trapezoids.length - 1; i++) {
            const curr = trapezoids[i];
            const next = trapezoids[i + 1];

            if (curr._holeRightMid && next._holeLeftMid) {
                ctx.beginPath();
                ctx.moveTo(curr._holeRightMid.x, curr._holeRightMid.y);
                ctx.lineTo(next._holeLeftMid.x, next._holeLeftMid.y);
                ctx.stroke();
            }
        }
    }

    if (trapezoids.length < 2) return;

    const cross = (a, b) => a.x * b.y - a.y * b.x;
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
    const mul = (v, s) => ({ x: v.x * s, y: v.y * s });
    const len = (v) => Math.hypot(v.x, v.y);
    const normalize = (v) => {
        const l = len(v);
        if (l < 1e-8) return { x: 1, y: 0 };
        return { x: v.x / l, y: v.y / l };
    };
    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const lineSegmentIntersection = (linePoint, lineDir, segA, segB) => {
        const segDir = sub(segB, segA);
        const denom = cross(lineDir, segDir);
        if (Math.abs(denom) < 1e-8) return null;

        const w = sub(segA, linePoint);
        const t = cross(w, segDir) / denom;
        const u = cross(w, lineDir) / denom;
        if (u < -1e-8 || u > 1 + 1e-8) return null;

        return add(linePoint, mul(lineDir, t));
    };

    const polygonIntersections = (pts, linePoint, lineDir) => {
        const edges = [
            [pts[0], pts[1]],
            [pts[1], pts[2]],
            [pts[2], pts[3]],
            [pts[3], pts[0]]
        ];
        const hits = [];
        edges.forEach(([a, b]) => {
            const hit = lineSegmentIntersection(linePoint, lineDir, a, b);
            if (hit) hits.push(hit);
        });
        return hits;
    };

    const drawBisectors = () => {
        const chainSideOffset = getChainThickness();
        const rays = [];
        const connectedPrev = [];
        const connectedNext = [];

        const lineLineIntersection = (p, r, q, s) => {
            const denom = cross(r, s);
            if (Math.abs(denom) < 1e-8) return null;
            const qp = sub(q, p);
            const t = cross(qp, s) / denom;
            return add(p, mul(r, t));
        };

        const worldToLinkLocal = (item, point) => {
            const rot = (item.rotation * Math.PI) / 180;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const dx = point.x - item.position.x;
            const dy = point.y - item.position.y;
            return {
                x: cos * dx + sin * dy,
                y: -sin * dx + cos * dy
            };
        };

        const linkLocalToWorld = (item, localPoint) => {
            const rot = (item.rotation * Math.PI) / 180;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            return {
                x: cos * localPoint.x - sin * localPoint.y + item.position.x,
                y: sin * localPoint.x + cos * localPoint.y + item.position.y
            };
        };

        const currentSegments = [];
        const addSegment = (ownerLink, start, end) => {
            if (ownerLink < 0 || ownerLink >= trapezoids.length) return;
            currentSegments.push({ ownerLink, start, end });
        };

        for (let i = 1; i < trapezoids.length; i++) {
            const prev = trapezoids[i - 1];
            const curr = trapezoids[i];

            const prevPts = prev.trapezoid.getPoints(prev.position, prev.rotation);
            const currPts = curr.trapezoid.getPoints(curr.position, curr.rotation);

            const pivot = lineSegmentIntersection(
                prevPts[1],
                sub(prevPts[2], prevPts[1]),
                currPts[0],
                currPts[3]
            ) || midpoint(midpoint(prevPts[1], prevPts[2]), midpoint(currPts[0], currPts[3]));

            const prevDir = normalize(sub(midpoint(prevPts[1], prevPts[2]), midpoint(prevPts[0], prevPts[3])));
            const currDir = normalize(sub(midpoint(currPts[1], currPts[2]), midpoint(currPts[0], currPts[3])));
            let bisector = normalize(add(prevDir, currDir));
            if (len(add(prevDir, currDir)) < 1e-8) {
                bisector = prevDir;
            }

            // Perpendicular guide ray from the edge pivot point.
            let guideDir = { x: -bisector.y, y: bisector.x };
            const prevCenter = midpoint(midpoint(prevPts[0], prevPts[3]), midpoint(prevPts[1], prevPts[2]));
            const currCenter = midpoint(midpoint(currPts[0], currPts[3]), midpoint(currPts[1], currPts[2]));
            const localCenter = midpoint(prevCenter, currCenter);
            const outwardHint = normalize(sub(pivot, localCenter));
            if (dot(guideDir, outwardHint) < 0) {
                guideDir = mul(guideDir, -1);
            }

            const pickAlignedVertex = (a, b) => {
                const da = dot(normalize(sub(a, pivot)), guideDir);
                const db = dot(normalize(sub(b, pivot)), guideDir);
                return da >= db ? a : b;
            };
            const prevSideVertex = pickAlignedVertex(prevPts[0], prevPts[3]);
            const nextSideVertex = pickAlignedVertex(currPts[1], currPts[2]);
            rays.push({
                rayOrigin: pivot,
                rayDir: guideDir,
                prevSideVertex,
                nextSideVertex
            });
            connectedPrev.push(false);
            connectedNext.push(false);
        }

        const now = Date.now();
        if (now - lastBisectorThicknessLogAt > 800 && rays.length > 0) {
            const distances = rays.map(() => Number(chainSideOffset.toFixed(3)));
            const uniqueDistances = Array.from(new Set(distances));
            console.log('[Bisector Thickness Debug]', {
                chainSideOffset,
                rayCount: rays.length,
                distances,
                uniqueDistances
            });
            lastBisectorThicknessLogAt = now;
        }

        // Build companion parallelograms in current pose (later captured as rigid local geometry).
        for (let i = 0; i < rays.length - 1; i++) {
            const a = rays[i];
            const b = rays[i + 1];

            if (dot(a.rayDir, b.rayDir) <= 0) continue;

            const baseVec = sub(b.rayOrigin, a.rayOrigin);
            if (len(baseVec) < 1e-8) continue;
            const baseDir = normalize(baseVec);
            let normal = { x: -baseDir.y, y: baseDir.x };
            const sideHint = normalize(add(a.rayDir, b.rayDir));
            if (dot(normal, sideHint) < 0) {
                normal = mul(normal, -1);
            }

            const offsetBasePoint = add(a.rayOrigin, mul(normal, chainSideOffset));
            const topA = lineLineIntersection(a.rayOrigin, a.rayDir, offsetBasePoint, baseDir);
            const topB = lineLineIntersection(b.rayOrigin, b.rayDir, offsetBasePoint, baseDir);
            if (!topA || !topB) continue;

            const ownerLink = i + 1;
            addSegment(ownerLink, a.rayOrigin, b.rayOrigin);
            addSegment(ownerLink, b.rayOrigin, topB);
            addSegment(ownerLink, topB, topA);
            addSegment(ownerLink, topA, a.rayOrigin);

            connectedNext[i] = true;
            connectedPrev[i + 1] = true;
        }

        // Triangle fallback for each unpaired side: one bisector + base edge + connector.
        const addTriangleFallback = (ray, vertex, ownerLink) => {
            if (!vertex) return;

            const baseVec = sub(vertex, ray.rayOrigin);
            if (len(baseVec) < 1e-8) return;
            const baseDir = normalize(baseVec);
            let normal = { x: -baseDir.y, y: baseDir.x };
            if (dot(normal, ray.rayDir) < 0) {
                normal = mul(normal, -1);
            }

            const offsetBasePoint = add(ray.rayOrigin, mul(normal, chainSideOffset));
            const tip = lineLineIntersection(ray.rayOrigin, ray.rayDir, offsetBasePoint, baseDir);
            if (!tip) return;

            addSegment(ownerLink, ray.rayOrigin, vertex);
            addSegment(ownerLink, vertex, tip);
            addSegment(ownerLink, tip, ray.rayOrigin);
        };

        for (let i = 0; i < rays.length; i++) {
            const ray = rays[i];

            // Previous-side companion piece belongs to link i.
            if (!connectedPrev[i]) {
                addTriangleFallback(ray, ray.prevSideVertex, i);
            }

            // Next-side companion piece belongs to link i+1.
            if (!connectedNext[i]) {
                addTriangleFallback(ray, ray.nextSideVertex, i + 1);
            }
        }

        const shouldCaptureRigid = currentFrameIndex === 0
            || !companionRigidModel
            || companionRigidModel.linkCount !== trapezoids.length;

        if (shouldCaptureRigid) {
            const localSegments = currentSegments.map((segment) => {
                const owner = trapezoids[segment.ownerLink];
                return {
                    ownerLink: segment.ownerLink,
                    startLocal: worldToLinkLocal(owner, segment.start),
                    endLocal: worldToLinkLocal(owner, segment.end)
                };
            });

            companionRigidModel = {
                linkCount: trapezoids.length,
                segments: localSegments
            };
        }

        const segmentsToDraw = companionRigidModel?.segments ?? currentSegments;
        segmentsToDraw.forEach((segment) => {
            const owner = trapezoids[segment.ownerLink];
            if (!owner) return;

            const start = segment.startLocal
                ? linkLocalToWorld(owner, segment.startLocal)
                : segment.start;
            const end = segment.endLocal
                ? linkLocalToWorld(owner, segment.endLocal)
                : segment.end;
            if (!start || !end) return;

            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.strokeStyle = 'rgba(0, 150, 0, 0.95)';
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    };

    if (!jointsEnabled) {
        drawBisectors();
        return;
    }

    for (let i = 1; i < trapezoids.length; i++) {
        const prev = trapezoids[i - 1];
        const curr = trapezoids[i];

        const prevPts = prev.trapezoid.getPoints(prev.position, prev.rotation);
        const currPts = curr.trapezoid.getPoints(curr.position, curr.rotation);

        // Current pivot: intersection of prev right edge and curr left edge.
        const pivot = lineSegmentIntersection(
            prevPts[1],
            sub(prevPts[2], prevPts[1]),
            currPts[0],
            currPts[3]
        ) || midpoint(midpoint(prevPts[1], prevPts[2]), midpoint(currPts[0], currPts[3]));

        // Link directions from left-mid to right-mid for each adjacent link.
        const prevDir = normalize(sub(midpoint(prevPts[1], prevPts[2]), midpoint(prevPts[0], prevPts[3])));
        const currDir = normalize(sub(midpoint(currPts[1], currPts[2]), midpoint(currPts[0], currPts[3])));
        let bisector = normalize(add(prevDir, currDir));
        if (len(add(prevDir, currDir)) < 1e-8) {
            bisector = prevDir;
        }

        // Shift the line outside the links by joint thickness.
        const thicknesses = getJointThicknesses(chain);
        const jointThickness = thicknesses[i - 1] ?? jointMinimumThickness;
        const normal = { x: -bisector.y, y: bisector.x };
        const anchorA = add(pivot, mul(normal, jointThickness));
        const anchorB = add(pivot, mul(normal, -jointThickness));

        const closestToAnchor = (hits) => hits.reduce((best, p) => {
            const d = Math.hypot(p.x - hits.anchor.x, p.y - hits.anchor.y);
            if (!best || d < best.d) return { p, d };
            return best;
        }, null).p;

        const buildSegment = (anchor) => {
            const prevHits = polygonIntersections(prevPts, anchor, bisector);
            const currHits = polygonIntersections(currPts, anchor, bisector);
            if (prevHits.length === 0 || currHits.length === 0) return null;

            prevHits.anchor = anchor;
            currHits.anchor = anchor;
            const start = closestToAnchor(prevHits);
            const end = closestToAnchor(currHits);
            if (!start || !end) return null;

            return {
                start,
                end,
                length: Math.hypot(end.x - start.x, end.y - start.y)
            };
        };

        const segmentA = buildSegment(anchorA);
        const segmentB = buildSegment(anchorB);
        if (!segmentA && !segmentB) continue;

        // Smaller-angle side produces the shorter bridge between adjacent links.
        const chosen = !segmentA ? segmentB : !segmentB ? segmentA : (segmentA.length <= segmentB.length ? segmentA : segmentB);
        const start = chosen.start;
        const end = chosen.end;

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = 'rgba(0, 90, 0, 0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    drawBisectors();
}

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
    if (!rulerState.visible) {
        currentRulerLabelBounds = null;
        return;
    }

    ensureRulerInitialized();

    const start = rulerState.start;
    const end = rulerState.end;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    ctx.save();

    ctx.strokeStyle = 'rgba(255, 142, 38, 0.95)';
    ctx.fillStyle = 'rgba(255, 142, 38, 0.28)';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    const drawHandle = (point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, rulerHandleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    };

    drawHandle(start);
    drawHandle(end);

    if (length > 1e-8) {
        const nx = -(dy / length);
        const ny = dx / length;
        const tickSize = 8;
        const tickCount = 10;

        for (let i = 0; i <= tickCount; i++) {
            const t = i / tickCount;
            const px = start.x + dx * t;
            const py = start.y + dy * t;
            const major = i % 5 === 0;
            const size = major ? tickSize : tickSize * 0.55;

            ctx.beginPath();
            ctx.moveTo(px - nx * size, py - ny * size);
            ctx.lineTo(px + nx * size, py + ny * size);
            ctx.stroke();
        }

        const label = `${Math.round(clampRulerMillimeters(rulerState.mmLength))} mm`;
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const labelOffset = 22;
        const labelX = midX + nx * labelOffset;
        const labelY = midY + ny * labelOffset;

        ctx.font = '700 14px Manrope, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textWidth = ctx.measureText(label).width;
        const textHeight = 14;
        const boxWidth = textWidth + rulerLabelPaddingX * 2;
        const boxHeight = textHeight + rulerLabelPaddingY * 2;
        const boxLeft = labelX - boxWidth / 2;
        const boxTop = labelY - boxHeight / 2;

        currentRulerLabelBounds = {
            left: boxLeft,
            top: boxTop,
            right: boxLeft + boxWidth,
            bottom: boxTop + boxHeight
        };

        ctx.fillStyle = 'rgba(255, 142, 38, 0.24)';
        ctx.strokeStyle = 'rgba(255, 142, 38, 0.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(boxLeft, boxTop, boxWidth, boxHeight, 7);
        } else {
            ctx.rect(boxLeft, boxTop, boxWidth, boxHeight);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
        ctx.fillText(label, labelX, labelY + 0.5);
    } else {
        currentRulerLabelBounds = null;
    }

    ctx.restore();
}

function redrawAll() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    drawSkeletonOverlay();
    const frameChain = getMainChain();
    if (chainVisible && frameChain) {
        drawChain(frameChain);
    }
    drawRulerOverlay();
}

function shortestAngleDifference(from, to) {
    let diff = to - from;
    diff = ((diff + 180) % 360 + 360) % 360 - 180;
    return diff;
}

function normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
}

function rotatePoint(point, center, angleDeg) {
    const rad = angleDeg * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos
    };
}

// Rigidly align the current chain pose so link 0 matches the frame skeleton base.
function alignChainRootToSkeleton(chain, skeleton) {
    if (!chain || !skeleton || skeleton.points.length === 0 || skeleton.lines.length === 0) {
        return;
    }

    const trapezoids = chain.getTrapezoids();
    if (trapezoids.length === 0) return;

    const first = trapezoids[0];
    const targetPos = skeleton.points[0];
    const targetRot = skeleton.lines[0].angle;

    const sourcePos = { x: first.position.x, y: first.position.y };
    const deltaRot = shortestAngleDifference(first.rotation, targetRot);

    trapezoids.forEach(item => {
        const rotatedPos = rotatePoint(item.position, sourcePos, deltaRot);
        item.position.x = rotatedPos.x + (targetPos.x - sourcePos.x);
        item.position.y = rotatedPos.y + (targetPos.y - sourcePos.y);
        item.rotation = normalizeAngle(item.rotation + deltaRot);
    });
}

// Get the main chain (the one built from the skeleton)
function getMainChain() {
    // Find the frame that has a chain
    for (const frameIndex in frameChains) {
        if (frameChains[frameIndex]) {
            return frameChains[frameIndex];
        }
    }
    return null;
}

function isSkeletonEditable() {
    return skeletonVisible;
}

// Position chain at interpolation factor t (0 = initial, 1 = final)
function applyChainAtT(chain, t) {
    if (!chain || chain.getTrapezoids().length === 0) return;
    const trapezoids = chain.getTrapezoids();
    trapezoids.forEach((item, i) => {
        if (i === 0) {
            const dr = shortestAngleDifference(item.startRotation, item.finalRotation);
            item.rotation = item.startRotation + dr * t;
        } else {
            const prev = trapezoids[i - 1];
            const startRelativeRotation = shortestAngleDifference(prev.startRotation, item.startRotation);
            const finalRelativeRotation = shortestAngleDifference(prev.finalRotation, item.finalRotation);
            const relativeDelta = shortestAngleDifference(startRelativeRotation, finalRelativeRotation);
            const currentRelativeRotation = startRelativeRotation + relativeDelta * t;
            item.rotation = normalizeAngle(prev.rotation + currentRelativeRotation);
        }
    });
    chain.positionAllLinksFromRotations();
}

function animateTowardsFinal(chain, duration = 1000) {
    if (!chain || chain.getTrapezoids().length === 0) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const startTime = performance.now();
        const initialL = calculateInitialLineLength();
        const finalL = calculateFinalLineLength();

        function step(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1);
            const targetL = initialL + (finalL - initialL) * t;
            applyChainAtTargetL(chain, targetL);

            redrawAll();

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }

        requestAnimationFrame(step);
    });
}

function playPreviewAnimation() {
    window.videoControls?.togglePlayback?.();
}

function exportDXF() {
    // Export whichever chain is currently renderable in the viewport.
    const chain = getCurrentChain() || getMainChain();
    if (!chain || chain.getTrapezoids().length === 0) return;
    const scaleMmPerPixel = getRulerScaleMmPerPixel();
    chain.exportCurrentDXF('chain_current.dxf', holeEnabled, jointsEnabled, getJointKValues(chain), scaleMmPerPixel);
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

function buildChain() {
    const skeleton = getCurrentSkeleton();
    if (!skeleton || skeleton.points.length === 0) return;

    drawingFinished = true;

    skeleton.updateAllGeometry();

    const chain = new Chain();
    chain.buildFromSkeleton(
        skeleton,
        chainThickness,
        skeleton.points[0].x,
        skeleton.points[0].y
    );

    frameChains[currentFrameIndex] = chain;

    setFrameChainBuilt(currentFrameIndex, true);

    deleteAllFramesWithoutPoints();

    // frameSkeletons[0] is guaranteed to exist after deleteAllFramesWithoutPoints remaps frames
    chain.computeStartRotationsFromRefSkeleton(frameSkeletons[0]);

    // Show initial position (t=0) for current frame
    const maxFrameIndex = window.videoControls?.getMaxFrameIndex?.() ?? 0;
    const t = maxFrameIndex > 0 ? Math.min(currentFrameIndex / maxFrameIndex, 1) : 0;
    applyChainAtT(chain, t);

    redrawAll();
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
        jointKByIndex,
        rulerState,
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

// Computes total chain-skeleton error using both edge midpoints of each link.
// The last mapped skeleton segment is treated as an infinite imaginary line.
function computeChainSkeletonError(chain, skeleton) {
    const trapezoids = chain?.getTrapezoids?.() ?? [];
    const lines = skeleton?.lines ?? [];
    if (trapezoids.length === 0 || lines.length === 0) return 0;

    let totalError = 0;
    const count = Math.min(trapezoids.length, lines.length);
    for (let i = 0; i < count; i++) {
        const item = trapezoids[i];
        const pts = item.trapezoid.getPoints(item.position, item.rotation);
        const leftMid = {
            x: (pts[0].x + pts[3].x) / 2,
            y: (pts[0].y + pts[3].y) / 2
        };
        const rightMid = {
            x: (pts[1].x + pts[2].x) / 2,
            y: (pts[1].y + pts[2].y) / 2
        };

        const lineStart = lines[i].start;
        const lineEnd = lines[i].end;
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const lenSq = dx * dx + dy * dy;
        let dist;
        if (lenSq < 1e-10) {
            const dLeft = Math.hypot(leftMid.x - lineStart.x, leftMid.y - lineStart.y);
            const dRight = Math.hypot(rightMid.x - lineStart.x, rightMid.y - lineStart.y);
            dist = dLeft + dRight;
        } else {
            const rawTLeft = ((leftMid.x - lineStart.x) * dx + (leftMid.y - lineStart.y) * dy) / lenSq;
            const rawTRight = ((rightMid.x - lineStart.x) * dx + (rightMid.y - lineStart.y) * dy) / lenSq;
            const isLastMappedSegment = i === count - 1;

            const tLeft = isLastMappedSegment ? rawTLeft : Math.max(0, Math.min(1, rawTLeft));
            const tRight = isLastMappedSegment ? rawTRight : Math.max(0, Math.min(1, rawTRight));

            const projLeftX = lineStart.x + tLeft * dx;
            const projLeftY = lineStart.y + tLeft * dy;
            const projRightX = lineStart.x + tRight * dx;
            const projRightY = lineStart.y + tRight * dy;

            const dLeft = Math.hypot(leftMid.x - projLeftX, leftMid.y - projLeftY);
            const dRight = Math.hypot(rightMid.x - projRightX, rightMid.y - projRightY);
            dist = dLeft + dRight;
        }
        totalError += dist;
    }
    return totalError;
}

// Finds globally optimized k values (one per joint) minimizing summed
// chain-skeleton error across all available frames.
async function findKsMinimizingChainSkeletonDistance(onProgress) {
    const reportProgress = (percent, text) => {
        if (typeof onProgress !== 'function') return;
        try {
            onProgress(Math.max(0, Math.min(100, percent)), text);
        } catch {
            // Ignore progress callback errors so fitting can continue.
        }
    };

    const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));
    let yieldCounter = 0;
    const maybeYield = async (force = false) => {
        yieldCounter += 1;
        if (force || yieldCounter % 8 === 0) {
            await yieldToUI();
        }
    };

    reportProgress(2, 'Preparing fit...');

    const chain = getMainChain();
    if (!chain || chain.getTrapezoids().length <= 1) {
        reportProgress(100, 'No mechanism to fit');
        return;
    }

    const numJoints = getJointCount(chain);
    if (numJoints === 0) {
        reportProgress(100, 'No joints to fit');
        return;
    }

    // Collect frames that have skeletons with at least one segment.
    const framesWithSkeletons = Object.keys(frameSkeletons)
        .map(k => Number.parseInt(k, 10))
        .filter(f => Number.isInteger(f) && frameSkeletons[f]?.lines?.length > 0)
        .sort((a, b) => a - b);

    if (framesWithSkeletons.length === 0) {
        reportProgress(100, 'No skeleton frames to fit');
        return;
    }

    // Pre-compute endpoint lengths once – they are k-independent.
    const { initialL, finalL } = calculateInitialAndFinalLineLengths();
    const maxFrameIndex = window.videoControls?.getMaxFrameIndex?.() ?? 0;
    const minL = Math.min(initialL, finalL);
    const maxL = Math.max(initialL, finalL);

    // Save the current pose so we can restore it after optimization.
    const savedPose = snapshotChainPose(chain);

    function evaluateTotalError(kValues) {
        // Temporarily set k values.
        for (let i = 0; i < numJoints; i++) {
            jointKByIndex[i] = kValues[i];
        }

        let totalError = 0;
        for (const frameIndex of framesWithSkeletons) {
            // Keep each frame evaluation independent.
            restoreChainPose(chain, savedPose);

            const t = maxFrameIndex > 0 ? Math.min(frameIndex / maxFrameIndex, 1) : 0;
            const rawTargetL = initialL + (finalL - initialL) * t;
            const targetL = Math.max(minL, Math.min(maxL, rawTargetL));
            applyChainAtTargetL(chain, targetL);

            const skeleton = frameSkeletons[frameIndex];
            alignChainRootToSkeleton(chain, skeleton);
            totalError += computeChainSkeletonError(chain, skeleton);
        }

        return totalError;
    }

    let kValues = Array.from({ length: numJoints }, (_, i) => Math.max(1, Math.min(10, getJointK(i))));
    const initialError = evaluateTotalError(kValues);
    let bestError = initialError;

    // Global coordinate search over all joints.
    const maxPasses = 14;
    let additiveStep = 0.5;
    let multiplicativeStep = 0.35;

    const totalGlobalJoints = maxPasses * numJoints;
    let processedGlobalJoints = 0;

    console.log(`Fit k start: error=${bestError.toFixed(4)}, joints=${numJoints}, frames=${framesWithSkeletons.length}`);

    for (let pass = 0; pass < maxPasses; pass++) {
        let improvedInPass = false;
        const passStartError = bestError;

        for (let i = 0; i < numJoints; i++) {
            const base = Math.max(1, Math.min(10, kValues[i]));
            const candidates = [
                Math.max(1, Math.min(10, base - additiveStep)),
                Math.max(1, Math.min(10, base + additiveStep)),
                Math.max(1, Math.min(10, base * (1 - multiplicativeStep))),
                Math.max(1, Math.min(10, base * (1 + multiplicativeStep))),
                Math.max(1, Math.min(10, base * 0.5)),
                Math.max(1, Math.min(10, base * 1.8))
            ];

            let localBestK = base;
            let localBestError = bestError;

            for (const candidate of candidates) {
                if (!Number.isFinite(candidate)) continue;
                const testKValues = kValues.slice();
                testKValues[i] = candidate;
                const error = evaluateTotalError(testKValues);
                if (error + 1e-9 < localBestError) {
                    localBestError = error;
                    localBestK = candidate;
                }
            }

            if (localBestK !== base) {
                kValues[i] = localBestK;
                bestError = localBestError;
                improvedInPass = true;
            }

            processedGlobalJoints += 1;
            const globalProgress = 6 + (processedGlobalJoints / Math.max(totalGlobalJoints, 1)) * 74;
            reportProgress(
                globalProgress,
                `Fit k pass ${pass + 1}/${maxPasses} - joint ${i + 1}/${numJoints}`
            );
            await maybeYield();
        }

        if (!improvedInPass) {
            additiveStep *= 0.5;
            multiplicativeStep *= 0.6;
            if (additiveStep < 0.01 && multiplicativeStep < 0.05) {
                break;
            }
        }

        console.log(
            `Fit k pass ${pass + 1}: error ${passStartError.toFixed(4)} -> ${bestError.toFixed(4)}, ` +
            `improved=${improvedInPass}, addStep=${additiveStep.toFixed(4)}, mulStep=${multiplicativeStep.toFixed(4)}`
        );
    }

    // Fallback coarse absolute search.
    const absoluteCandidates = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
    const fallbackStartError = bestError;
    reportProgress(84, 'Refining fit...');
    for (let i = 0; i < numJoints; i++) {
        let localBestK = kValues[i];
        let localBestError = bestError;

        for (const candidate of absoluteCandidates) {
            const testKValues = kValues.slice();
            testKValues[i] = Math.max(1, Math.min(10, candidate));
            const error = evaluateTotalError(testKValues);
            if (error + 1e-9 < localBestError) {
                localBestError = error;
                localBestK = testKValues[i];
            }
        }

        if (localBestK !== kValues[i]) {
            kValues[i] = localBestK;
            bestError = localBestError;
        }

        const fallbackProgress = 84 + ((i + 1) / Math.max(numJoints, 1)) * 12;
        reportProgress(fallbackProgress, `Refining joint ${i + 1}/${numJoints}`);
        await maybeYield();
    }

    console.log(`Fit k fallback: error ${fallbackStartError.toFixed(4)} -> ${bestError.toFixed(4)}`);

    // Restore the chain to the state it was in before optimization.
    restoreChainPose(chain, savedPose);

    // Apply optimized k values in one batch to avoid repeated heavy redraws.
    reportProgress(97, 'Applying fitted k...');
    for (let i = 0; i < numJoints; i++) {
        jointKByIndex[i] = Math.max(1, Math.min(10, kValues[i]));
        await maybeYield();
    }
    emitChainStateChange();
    redrawAll();

    console.log(`Fit k error: ${initialError.toFixed(4)} -> ${bestError.toFixed(4)}`);
    console.log('Fit k values:', kValues.map(k => k.toFixed(4)).join(', '));
    reportProgress(100, 'Fit complete');
    return kValues;
}

window.appActions = {
    playPreviewAnimation,
    exportDXF,
    buildChain,
    toggleMode,
    switchToCreateMode,
    switchToEditMode,
    getMode,
    setCurrentFrame,
    hasChainInCurrentFrame: () => hasChainInFrame(currentFrameIndex),
    hasRenderableChain,
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
        frameSkeletons[frameIndex] = skeleton;
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
    setHoleEnabled: (enabled) => {
        holeEnabled = Boolean(enabled);
        emitChainStateChange();
        redrawAll();
    },
    getHoleEnabled: () => holeEnabled,
    setJointsEnabled: (enabled) => {
        jointsEnabled = Boolean(enabled);
        emitChainStateChange();
        redrawAll();
    },
    getJointsEnabled: () => jointsEnabled,
    setSkeletonVisible: (visible) => {
        skeletonVisible = Boolean(visible);
        emitChainStateChange();
        redrawAll();
    },
    getSkeletonVisible: () => skeletonVisible,
    setChainVisible: (visible) => {
        chainVisible = Boolean(visible);
        emitChainStateChange();
        redrawAll();
    },
    getChainVisible: () => chainVisible,
    setFramesVisible: (visible) => {
        window.videoControls?.setFramesVisible?.(Boolean(visible));
        emitChainStateChange();
        redrawAll();
    },
    getFramesVisible: () => window.videoControls?.getFramesVisible?.() ?? true,
    toggleRulerVisible: () => {
        ensureRulerInitialized();
        rulerState.visible = !rulerState.visible;
        syncCreateModeCursorClass();
        emitChainStateChange();
        redrawAll();
        return rulerState.visible;
    },
    setRulerVisible: (visible) => {
        ensureRulerInitialized();
        rulerState.visible = Boolean(visible);
        syncCreateModeCursorClass();
        emitChainStateChange();
        redrawAll();
    },
    getRulerVisible: () => rulerState.visible,
    getRulerState: () => ({
        visible: rulerState.visible,
        mmLength: clampRulerMillimeters(rulerState.mmLength),
        initialized: rulerState.initialized,
        start: { x: rulerState.start.x, y: rulerState.start.y },
        end: { x: rulerState.end.x, y: rulerState.end.y }
    }),
    setRulerState: (nextState) => {
        if (!nextState || typeof nextState !== 'object') return;

        if (nextState.start && Number.isFinite(Number(nextState.start.x)) && Number.isFinite(Number(nextState.start.y))) {
            rulerState.start.x = Number(nextState.start.x);
            rulerState.start.y = Number(nextState.start.y);
        }

        if (nextState.end && Number.isFinite(Number(nextState.end.x)) && Number.isFinite(Number(nextState.end.y))) {
            rulerState.end.x = Number(nextState.end.x);
            rulerState.end.y = Number(nextState.end.y);
        }

        if (nextState.mmLength !== undefined) {
            rulerState.mmLength = clampRulerMillimeters(nextState.mmLength);
        }

        rulerState.visible = Boolean(nextState.visible);
        rulerState.initialized = Boolean(nextState.initialized) || Boolean(nextState.start && nextState.end);
        syncCreateModeCursorClass();
        emitChainStateChange();
        redrawAll();
    },
    getRulerScaleMmPerPixel: () => getRulerScaleMmPerPixel(),
    setJointKValues: (kMap) => {
        Object.keys(jointKByIndex).forEach((key) => {
            delete jointKByIndex[key];
        });

        if (kMap && typeof kMap === 'object') {
            Object.entries(kMap).forEach(([key, value]) => {
                const idx = Number.parseInt(key, 10);
                const parsed = Number(value);
                if (Number.isInteger(idx) && idx >= 0 && Number.isFinite(parsed)) {
                    jointKByIndex[idx] = Math.max(1, Math.min(10, parsed));
                }
            });
        }

        emitChainStateChange();
        redrawAll();
    },
    getCurrentSkeletonPointCount: () => getCurrentSkeleton()?.points?.length ?? 0,
    resampleCurrentSkeleton: (pointCount) => resampleCurrentSkeleton(pointCount),
    getJointCount: () => getJointCount(),
    getJointK: (jointIndex) => getJointK(jointIndex),
    setJointK: (jointIndex, value) => setJointK(jointIndex, value),
    getChainThickness: () => getChainThickness(),
    setChainThickness: (value) => setChainThickness(value),
    getJointMinimumThickness: () => getJointMinimumThickness(),
    setJointMinimumThickness: (value) => setJointMinimumThickness(value),
    getJointThicknesses: () => getJointThicknesses(),
    calculateTotalElasticEnergy: () => calculateTotalElasticEnergy(),
    calculateTotalLineLength: () => calculateTotalLineLength(),
    calculateCurrentSkeletonLength: () => calculateCurrentSkeletonLength(),
    calculateInitialLineLength: () => calculateInitialLineLength(),
    calculateFinalLineLength: () => calculateFinalLineLength(),
    calculateInitialAndFinalLineLengths: () => calculateInitialAndFinalLineLengths(),
    findKsMinimizingChainSkeletonDistance: (onProgress) => findKsMinimizingChainSkeletonDistance(onProgress)
};

// Listen for video frame changes and sync canvas state
window.videoControls?.onFrameChange?.((videoFrameIndex) => {
    setCurrentFrame(videoFrameIndex);
});