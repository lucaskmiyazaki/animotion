class Joint {
    constructor(options = {}) {
        this.k = Number.isFinite(options.k) ? Math.max(0, options.k) : 1;

        // Joint theta domain (driver variable, interpreted as relative angle).
        this.initialTheta = Number.isFinite(options.initialTheta) ? options.initialTheta : 0;
        this.finalTheta = Number.isFinite(options.finalTheta) ? options.finalTheta : 1;
        this._theta = Number.isFinite(options.theta) ? options.theta : 0;

        // Connected links (previous and following links for both mechanisms).
        this.prevLinkA = options.prevLinkA instanceof Link ? options.prevLinkA : null;
        this.nextLinkA = options.nextLinkA instanceof Link ? options.nextLinkA : null;
        this.prevLinkB = options.prevLinkB instanceof Link ? options.prevLinkB : null;
        this.nextLinkB = options.nextLinkB instanceof Link ? options.nextLinkB : null;

        // Shared pivot between mechanism A and B for this joint.
        // Must coincide across both mechanisms when both links exist.
        this._pivotPoint = null;

        // Per-mechanism theta references used to convert joint theta
        // into each mechanism's local relative theta.
        const currentRelA = this._readRelativeTheta(this.prevLinkA, this.nextLinkA);
        const currentRelB = this._readRelativeTheta(this.prevLinkB, this.nextLinkB);
        this.initialMechanismThetaA = Number.isFinite(options.initialMechanismThetaA)
            ? options.initialMechanismThetaA
            : currentRelA;
        this.finalMechanismThetaA = Number.isFinite(options.finalMechanismThetaA)
            ? options.finalMechanismThetaA
            : this.initialMechanismThetaA;
        this.initialMechanismThetaB = Number.isFinite(options.initialMechanismThetaB)
            ? options.initialMechanismThetaB
            : currentRelB;
        this.finalMechanismThetaB = Number.isFinite(options.finalMechanismThetaB)
            ? options.finalMechanismThetaB
            : this.initialMechanismThetaB;

        this._theta = this._clampTheta(this._theta);
        this._mechanism = null;
        this._index = -1;

        this._initializePivotPoint();
    }

    get theta() {
        return this._theta;
    }

    set theta(value) {
        this._theta = this._clampTheta(value);
    }

    get pivotPoint() {
        return this._pivotPoint ? { x: this._pivotPoint.x, y: this._pivotPoint.y } : null;
    }

    set pivotPoint(value) {
        const normalized = this._normalizePivotPoint(value);
        this._pivotPoint = normalized;
        this._applyPivotToNextLinks(normalized);
    }

    _normalizePivotPoint(value) {
        if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
            throw new Error('Joint pivotPoint must be a finite {x, y} point.');
        }
        return {
            x: Number(value.x),
            y: Number(value.y)
        };
    }

    _getNextLinkPivot(link) {
        if (!(link instanceof Link)) return null;
        if (!link.position || !Number.isFinite(link.position.x) || !Number.isFinite(link.position.y)) {
            throw new Error('Joint next link has invalid position for pivot.');
        }
        return {
            x: Number(link.position.x),
            y: Number(link.position.y)
        };
    }

    _assertCoincidentPivotPoints(pointA, pointB, tolerance = 1e-6) {
        if (!pointA || !pointB) return;
        const dx = pointA.x - pointB.x;
        const dy = pointA.y - pointB.y;
        if (Math.hypot(dx, dy) > tolerance) {
            throw new Error(`Joint pivot mismatch between mechanism A and B: A=(${pointA.x}, ${pointA.y}), B=(${pointB.x}, ${pointB.y})`);
        }
    }

    _applyPivotToNextLinks(pivot) {
        if (!pivot) return;
        if (this.nextLinkA instanceof Link) {
            this.nextLinkA.position.x = pivot.x;
            this.nextLinkA.position.y = pivot.y;
        }
        if (this.nextLinkB instanceof Link) {
            this.nextLinkB.position.x = pivot.x;
            this.nextLinkB.position.y = pivot.y;
        }
    }

    _initializePivotPoint() {
        const pivotA = this._getNextLinkPivot(this.nextLinkA);
        const pivotB = this._getNextLinkPivot(this.nextLinkB);

        this._assertCoincidentPivotPoints(pivotA, pivotB);

        const chosen = pivotA || pivotB;
        if (chosen) {
            this._pivotPoint = chosen;
            this._applyPivotToNextLinks(chosen);
        }
    }

    _syncPivotPointFromNextLinks() {
        const pivotA = this._getNextLinkPivot(this.nextLinkA);
        const pivotB = this._getNextLinkPivot(this.nextLinkB);

        this._assertCoincidentPivotPoints(pivotA, pivotB);

        const chosen = pivotA || pivotB || this._pivotPoint;
        if (chosen) {
            this._pivotPoint = {
                x: chosen.x,
                y: chosen.y
            };
            this._applyPivotToNextLinks(this._pivotPoint);
        }
    }

    _readRelativeTheta(prevLink, nextLink) {
        if (!(prevLink instanceof Link) || !(nextLink instanceof Link)) return 0;
        return nextLink.theta - prevLink.theta;
    }

    _clampTheta(value) {
        const initial = Number.isFinite(this.initialTheta) ? this.initialTheta : 0;
        const final = Number.isFinite(this.finalTheta) ? this.finalTheta : initial;
        if (!Number.isFinite(value)) return initial;
        const minTheta = Math.min(initial, final);
        const maxTheta = Math.max(initial, final);
        if (value < minTheta) return minTheta;
        if (value > maxTheta) return maxTheta;
        return value;
    }

    _jointProgress() {
        const denom = this.finalTheta - this.initialTheta;
        if (!Number.isFinite(denom) || Math.abs(denom) < 1e-10) return 0;
        const t = (this.theta - this.initialTheta) / denom;
        return Math.min(1, Math.max(0, t));
    }

    _progressAt(thetaValue) {
        const denom = this.finalTheta - this.initialTheta;
        if (!Number.isFinite(denom) || Math.abs(denom) < 1e-10) return 0;
        const t = (thetaValue - this.initialTheta) / denom;
        return Math.min(1, Math.max(0, t));
    }

    _convertToMechanismTheta(initialValue, finalValue) {
        const t = this._jointProgress();
        return initialValue + (finalValue - initialValue) * t;
    }

    _convertToMechanismThetaAt(thetaValue, initialValue, finalValue) {
        const t = this._progressAt(thetaValue);
        return initialValue + (finalValue - initialValue) * t;
    }

    _applyToFollowingLinks() {
        const relA = this._convertToMechanismTheta(this.initialMechanismThetaA, this.finalMechanismThetaA);
        const relB = this._convertToMechanismTheta(this.initialMechanismThetaB, this.finalMechanismThetaB);

        if (this.prevLinkA instanceof Link && this.nextLinkA instanceof Link) {
            this.nextLinkA.theta = this.prevLinkA.theta + relA;
        }
        if (this.prevLinkB instanceof Link && this.nextLinkB instanceof Link) {
            this.nextLinkB.theta = this.prevLinkB.theta + relB;
        }
    }

    _bindMechanism(mechanism, index) {
        this._mechanism = mechanism instanceof Mechanism ? mechanism : null;
        this._index = Number.isInteger(index) ? index : -1;
    }

    _debugLogAngles(previousTheta, nextTheta) {
        const prevA = this.prevLinkA instanceof Link ? this.prevLinkA.theta : null;
        const nextA = this.nextLinkA instanceof Link ? this.nextLinkA.theta : null;
        const prevB = this.prevLinkB instanceof Link ? this.prevLinkB.theta : null;
        const nextB = this.nextLinkB instanceof Link ? this.nextLinkB.theta : null;

        const fmt = (value) => (Number.isFinite(value) ? Number(value).toFixed(6) : 'n/a');
        const relA = this._readRelativeTheta(this.prevLinkA, this.nextLinkA);
        const relB = this._readRelativeTheta(this.prevLinkB, this.nextLinkB);

        console.log(
            `[Joint ${this._index}] theta(relative): ${fmt(previousTheta)} -> ${fmt(nextTheta)} | `
            + `A(abs prev/next): ${fmt(prevA)} / ${fmt(nextA)} | A(relative now): ${fmt(relA)} | `
            + `B(abs prev/next): ${fmt(prevB)} / ${fmt(nextB)} | B(relative now): ${fmt(relB)}`
        );
    }

    // Updates this joint and propagates movement only to following links.
    setTheta(nextTheta) {
        const previousTheta = this.theta;
        const clampedTheta = this._clampTheta(nextTheta);
        if (Math.abs(clampedTheta - previousTheta) < 1e-12) {
            return this.theta;
        }

        this._syncPivotPointFromNextLinks();

        const oldRelA = this._convertToMechanismThetaAt(
            previousTheta,
            this.initialMechanismThetaA,
            this.finalMechanismThetaA
        );
        const newRelA = this._convertToMechanismThetaAt(
            clampedTheta,
            this.initialMechanismThetaA,
            this.finalMechanismThetaA
        );
        const oldRelB = this._convertToMechanismThetaAt(
            previousTheta,
            this.initialMechanismThetaB,
            this.finalMechanismThetaB
        );
        const newRelB = this._convertToMechanismThetaAt(
            clampedTheta,
            this.initialMechanismThetaB,
            this.finalMechanismThetaB
        );

        this.theta = clampedTheta;
        if (this._mechanism instanceof Mechanism && this._index >= 0) {
            this._mechanism._propagateRigidFromJoint(this._index, {
                deltaA: newRelA - oldRelA,
                deltaB: newRelB - oldRelB,
                pivotA: this.pivotPoint,
                pivotB: this.pivotPoint
            });
        } else {
            this._applyToFollowingLinks();
        }

        this._debugLogAngles(previousTheta, this.theta);
        return this.theta;
    }

    setK(nextK) {
        if (!Number.isFinite(nextK)) return this.k;
        this.k = Math.max(0, nextK);
        return this.k;
    }

    getElasticEnergy() {
        const delta = this.theta - this.initialTheta;
        return 0.5 * this.k * delta * delta;
    }
}


window.Joint = Joint;
