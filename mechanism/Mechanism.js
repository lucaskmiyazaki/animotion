class Mechanism {
    constructor(options = {}) {
        this.chains = Array.isArray(options.chains)
            ? options.chains.filter((chain) => chain instanceof Chain)
            : [];
        this.joints = Array.isArray(options.joints)
            ? options.joints.filter((joint) => joint instanceof Joint)
            : [];

        this.firstPoint = null;
        this.lastPoint = null;
        this.firstPivot = null;
        this.lastPivot = null;
        this.rotation = Number.isFinite(options.rotation) ? Number(options.rotation) : 0;

        this._bindJoints();
        this._syncEndpointReferences();
    }

    _bindJoints() {
        this.joints.forEach((joint, index) => {
            if (joint instanceof Joint) {
                joint._bindMechanism(this, index);
            }
        });
    }

    _findChainForLink(link) {
        if (!(link instanceof Link)) return null;
        for (let i = 0; i < this.chains.length; i++) {
            const chain = this.chains[i];
            if (chain instanceof Chain && Array.isArray(chain.links) && chain.links.includes(link)) {
                return chain;
            }
        }
        return null;
    }

    _getChainEndpointPoints(chain) {
        if (!(chain instanceof Chain) || !Array.isArray(chain.links) || chain.links.length === 0) {
            return { firstPoint: null, lastPoint: null };
        }

        const firstLink = chain.links[0];
        const lastLink = chain.links[chain.links.length - 1];
        const firstPoint = firstLink?.getWorldPoints?.()?.[0] || null;
        const lastPoints = lastLink?.getWorldPoints?.() || null;
        const lastPoint = Array.isArray(lastPoints) && lastPoints.length > 0 ? lastPoints[lastPoints.length - 1] : null;

        return { firstPoint, lastPoint };
    }

    _syncEndpointReferences() {
        const firstChain = this.chains.find((chain) => chain instanceof Chain && Array.isArray(chain.links) && chain.links.length > 0) || null;
        const lastChain = [...this.chains].reverse().find((chain) => chain instanceof Chain && Array.isArray(chain.links) && chain.links.length > 0) || null;

        const firstPoint = firstChain ? this._getChainEndpointPoints(firstChain).firstPoint : null;
        const lastPoint = lastChain ? this._getChainEndpointPoints(lastChain).lastPoint : null;
        const firstPivot = this.joints.length > 0 ? this.joints[0]?.pivotPoint || null : null;
        const lastPivot = this.joints.length > 0 ? this.joints[this.joints.length - 1]?.pivotPoint || null : null;

        this.firstPoint = firstPoint ? { x: Number(firstPoint.x), y: Number(firstPoint.y) } : null;
        this.lastPoint = lastPoint ? { x: Number(lastPoint.x), y: Number(lastPoint.y) } : null;
        this.firstPivot = firstPivot ? { x: Number(firstPivot.x), y: Number(firstPivot.y) } : null;
        this.lastPivot = lastPivot ? { x: Number(lastPivot.x), y: Number(lastPivot.y) } : null;

        return {
            firstPoint: this.firstPoint,
            lastPoint: this.lastPoint,
            firstPivot: this.firstPivot,
            lastPivot: this.lastPivot
        };
    }

    _rotateLinksAroundPivot(pivot, delta) {
        if (!pivot || !Number.isFinite(pivot.x) || !Number.isFinite(pivot.y) || !Number.isFinite(delta) || Math.abs(delta) < 1e-12) {
            return false;
        }

        const c = Math.cos(delta);
        const s = Math.sin(delta);
        const movedLinks = new Set();

        this.chains.forEach((chain) => {
            if (!(chain instanceof Chain) || !Array.isArray(chain.links)) return;
            chain.links.forEach((link) => {
                if (!(link instanceof Link) || movedLinks.has(link)) return;
                if (!link.position || !Number.isFinite(link.position.x) || !Number.isFinite(link.position.y)) return;

                const dx = link.position.x - pivot.x;
                const dy = link.position.y - pivot.y;
                link.position.x = pivot.x + (dx * c - dy * s);
                link.position.y = pivot.y + (dx * s + dy * c);
                link.theta += delta;
                movedLinks.add(link);
            });
        });

        this.joints.forEach((joint) => {
            if (!(joint instanceof Joint)) return;
            joint._syncPivotPointFromNextLinks?.();
        });

        this.rotation = Link.normalizeAngleSigned(Number(this.rotation) + delta);
        this._syncEndpointReferences();
        return true;
    }

    rotateBy(delta, pivot = null) {
        const amount = Number(delta);
        if (!Number.isFinite(amount) || Math.abs(amount) < 1e-12) return this.rotation;

        const rotationPivot = pivot && Number.isFinite(pivot.x) && Number.isFinite(pivot.y)
            ? { x: Number(pivot.x), y: Number(pivot.y) }
            : (this.firstPoint ? { x: this.firstPoint.x, y: this.firstPoint.y } : null);

        if (!rotationPivot) return this.rotation;
        this._rotateLinksAroundPivot(rotationPivot, amount);
        return this.rotation;
    }

    setRotation(nextRotation, pivot = null) {
        const target = Number(nextRotation);
        if (!Number.isFinite(target)) return this.rotation;
        const delta = target - Number(this.rotation || 0);
        return this.rotateBy(delta, pivot);
    }

    _rotateTailInChain(chain, startSegment, pivot, delta) {
        if (!(chain instanceof Chain) || !Array.isArray(chain.links)) return;
        if (!Number.isInteger(startSegment) || !pivot || !Number.isFinite(delta) || Math.abs(delta) < 1e-12) return;

        const c = Math.cos(delta);
        const s = Math.sin(delta);
        chain.links.forEach((link) => {
            if (!(link instanceof Link)) return;
            const seg = link.metadata?.segmentIndex;
            if (!Number.isInteger(seg) || seg < startSegment) return;

            const dx = link.position.x - pivot.x;
            const dy = link.position.y - pivot.y;
            link.position.x = pivot.x + (dx * c - dy * s);
            link.position.y = pivot.y + (dx * s + dy * c);
            link.theta += delta;
        });
    }

    _propagateRigidFromJoint(startIndex, motion = {}) {
        const joint = this.joints[startIndex];
        if (!(joint instanceof Joint)) return;

        if (joint.nextLinkA instanceof Link) {
            const chainA = this._findChainForLink(joint.nextLinkA);
            const segA = joint.nextLinkA.metadata?.segmentIndex;
            this._rotateTailInChain(chainA, segA, motion.pivotA, motion.deltaA);
        }

        if (joint.nextLinkB instanceof Link) {
            const chainB = this._findChainForLink(joint.nextLinkB);
            const segB = joint.nextLinkB.metadata?.segmentIndex;
            this._rotateTailInChain(chainB, segB, motion.pivotB, motion.deltaB);
        }

        this._syncEndpointReferences();
    }

    addChain(chain) {
        if (chain instanceof Chain) this.chains.push(chain);
    }

    addJoint(joint) {
        if (joint instanceof Joint) this.joints.push(joint);
    }

    setJointThetaByIndex(index, theta) {
        if (!Number.isInteger(index) || index < 0 || index >= this.joints.length) return null;
        return this.joints[index].setTheta(theta);
    }

    translateBy(dx, dy) {
        const tx = Number(dx);
        const ty = Number(dy);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;

        const movedLinks = new Set();
        this.chains.forEach((chain) => {
            if (!(chain instanceof Chain) || !Array.isArray(chain.links)) return;
            chain.links.forEach((link) => {
                if (!(link instanceof Link) || movedLinks.has(link)) return;
                if (!link.position || !Number.isFinite(link.position.x) || !Number.isFinite(link.position.y)) return;
                link.position.x += tx;
                link.position.y += ty;
                movedLinks.add(link);
            });
        });

        this.joints.forEach((joint) => {
            if (!(joint instanceof Joint)) return;
            const pivot = joint.pivotPoint;
            if (!pivot || !Number.isFinite(pivot.x) || !Number.isFinite(pivot.y)) return;
            joint.pivotPoint = {
                x: pivot.x + tx,
                y: pivot.y + ty
            };
        });

        this._syncEndpointReferences();

        return true;
    }

    _capturePoseState() {
        return window.MechanismOptimization.capturePoseState(this);
    }

    _restorePoseState(state) {
        return window.MechanismOptimization.restorePoseState(this, state);
    }

    _getJointThetaVector() {
        return window.MechanismOptimization.getJointThetaVector(this);
    }

    _applyJointThetaVector(thetaVector, baseState = null) {
        return window.MechanismOptimization.applyJointThetaVector(this, thetaVector, baseState);
    }

    _objectiveForTargetHoleLength(targetLength, options = {}) {
        return window.MechanismOptimization.objectiveForTargetHoleLength(this, targetLength, options);
    }

    static _isBetterForHardConstraint(candidate, currentBest, tolerance) {
        return window.MechanismOptimization.isBetterForHardConstraint(candidate, currentBest, tolerance);
    }

    solveThetasForLength(targetLength, options = {}) {
        return window.MechanismOptimization.solveThetasForLength(this, targetLength, options);
    }

    findMinimumEnergyPoseForHoleLength(targetLength, options = {}) {
        return window.MechanismOptimization.findMinimumEnergyPoseForHoleLength(this, targetLength, options);
    }

    calculateTotalElasticEnergy() {
        return this.joints.reduce((sum, joint) => sum + joint.getElasticEnergy(), 0);
    }

    getNormalizedJointThicknesses(minimumThickness = 5, chainKey = 'A') {
        const requestedMinimum = Number(minimumThickness);
        const safeMinimum = Number.isFinite(requestedMinimum) && requestedMinimum > 0 ? requestedMinimum : 5;

        const rawThicknesses = this.joints.map((joint) => {
            if (!(joint instanceof Joint) || typeof joint.getRawThickness !== 'function') {
                return Number.NaN;
            }
            return Number(joint.getRawThickness(chainKey));
        });

        const finiteRaw = rawThicknesses.filter((value) => Number.isFinite(value) && value > 0);
        const minRaw = finiteRaw.length > 0 ? Math.min(...finiteRaw) : Number.NaN;
        if (!Number.isFinite(minRaw) || minRaw <= 0) {
            return rawThicknesses.map(() => safeMinimum);
        }

        const scale = safeMinimum / minRaw;
        return rawThicknesses.map((value) => {
            if (!Number.isFinite(value) || value <= 0) return safeMinimum;
            return value * scale;
        });
    }

    drawJoints(ctx, options = {}) {
        if (!ctx || !Array.isArray(this.joints) || this.joints.length === 0) return;

        const minimumThickness = Number(options.minimumThickness);
        const lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : 1.5;
        const showChainA = options.showChainA !== false;
        const showChainB = options.showChainB === true;
        const fillStyleA = options.fillStyleA || 'rgba(255, 255, 255, 0.82)';
        const fillStyleB = options.fillStyleB || 'rgba(255, 255, 255, 0.6)';
        const strokeStyleA = options.strokeStyleA || 'rgba(76, 175, 80, 0.95)';
        const strokeStyleB = options.strokeStyleB || 'rgba(76, 175, 80, 0.95)';

        const thicknessesA = this.getNormalizedJointThicknesses(minimumThickness, 'A');
        const thicknessesB = this.getNormalizedJointThicknesses(minimumThickness, 'B');

        const drawShape = (shape, fillStyle, strokeStyle) => {
            if (!shape) return;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(shape.pivot.x, shape.pivot.y);
            ctx.lineTo(shape.leftBase.x, shape.leftBase.y);
            ctx.lineTo(shape.rightBase.x, shape.rightBase.y);
            ctx.closePath();
            ctx.fillStyle = fillStyle;
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = lineWidth;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        };

        this.joints.forEach((joint, index) => {
            if (!(joint instanceof Joint)) return;

            if (showChainA) {
                drawShape(joint.getJointShape(thicknessesA[index], 'A'), fillStyleA, strokeStyleA);
            }
            if (showChainB) {
                drawShape(joint.getJointShape(thicknessesB[index], 'B'), fillStyleB, strokeStyleB);
            }
        });
    }

    static buildRelativeThetaMap(chain) {
        const result = {};
        if (!(chain instanceof Chain) || !Array.isArray(chain.links)) return result;

        const bySegment = new Map();
        chain.links.forEach((link) => {
            const segmentIndex = link.metadata?.segmentIndex;
            if (Number.isInteger(segmentIndex)) {
                bySegment.set(segmentIndex, link);
            }
        });

        const sorted = Array.from(bySegment.keys()).sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
            const prevLink = bySegment.get(sorted[i - 1]);
            const nextLink = bySegment.get(sorted[i]);
            if (!(prevLink instanceof Link) || !(nextLink instanceof Link)) continue;
            result[sorted[i]] = Link.normalizeAngleSigned(nextLink.theta - prevLink.theta);
        }

        return result;
    }

    static fromTwinChains(options = {}) {
        const chainA = options.chainA instanceof Chain ? options.chainA : null;
        const chainB = options.chainB instanceof Chain ? options.chainB : null;
        const jointTheta = Number.isFinite(options.jointTheta) ? options.jointTheta : 0;

        const initialMapA = options.initialThetaBySegmentA || Mechanism.buildRelativeThetaMap(chainA);
        const finalMapA = options.finalThetaBySegmentA || initialMapA;
        const initialMapB = options.initialThetaBySegmentB || Mechanism.buildRelativeThetaMap(chainB);
        const finalMapB = options.finalThetaBySegmentB || initialMapB;
        const kByJointIndex = options.kByJointIndex || {};

        const bySegmentA = new Map();
        const bySegmentB = new Map();
        if (chainA instanceof Chain) {
            chainA.links.forEach((link) => {
                const idx = link.metadata?.segmentIndex;
                if (Number.isInteger(idx)) bySegmentA.set(idx, link);
            });
        }
        if (chainB instanceof Chain) {
            chainB.links.forEach((link) => {
                const idx = link.metadata?.segmentIndex;
                if (Number.isInteger(idx)) bySegmentB.set(idx, link);
            });
        }

        const allSegments = Array.from(new Set([...bySegmentA.keys(), ...bySegmentB.keys()])).sort((a, b) => a - b);
        const joints = [];

        for (let i = 1; i < allSegments.length; i++) {
            const prevSeg = allSegments[i - 1];
            const nextSeg = allSegments[i];

            const prevLinkA = bySegmentA.get(prevSeg) || null;
            const nextLinkA = bySegmentA.get(nextSeg) || null;
            const prevLinkB = bySegmentB.get(prevSeg) || null;
            const nextLinkB = bySegmentB.get(nextSeg) || null;

            if (!nextLinkA && !nextLinkB) continue;

            const jointIndex = joints.length;
            const k = Number.isFinite(kByJointIndex[jointIndex]) ? kByJointIndex[jointIndex] : 1;

            const initialTheta = Number.isFinite(initialMapA[nextSeg])
                ? initialMapA[nextSeg]
                : (Number.isFinite(initialMapB[nextSeg]) ? initialMapB[nextSeg] : 0);
            const finalTheta = Number.isFinite(finalMapA[nextSeg])
                ? finalMapA[nextSeg]
                : (Number.isFinite(finalMapB[nextSeg]) ? finalMapB[nextSeg] : initialTheta);
            const theta = initialTheta + (finalTheta - initialTheta) * jointTheta;

            joints.push(new Joint({
                k,
                initialTheta,
                finalTheta,
                theta,
                prevLinkA,
                nextLinkA,
                prevLinkB,
                nextLinkB
            }));
        }

        return new Mechanism({
            chains: [chainA, chainB].filter(Boolean),
            joints
        });
    }
}


window.Mechanism = Mechanism;
