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

    _getChainLinks(chainKey = 'A') {
        if (chainKey === 'B') {
            return {
                prevLink: this.prevLinkB,
                nextLink: this.nextLinkB
            };
        }

        return {
            prevLink: this.prevLinkA,
            nextLink: this.nextLinkA
        };
    }

    _normalizeVector(vector) {
        if (!vector || !Number.isFinite(vector.x) || !Number.isFinite(vector.y)) return null;
        const magnitude = Math.hypot(vector.x, vector.y);
        if (magnitude < 1e-8) return null;
        return {
            x: vector.x / magnitude,
            y: vector.y / magnitude
        };
    }

    _distanceSquared(pointA, pointB) {
        if (!pointA || !pointB) return Number.POSITIVE_INFINITY;
        const dx = pointA.x - pointB.x;
        const dy = pointA.y - pointB.y;
        return dx * dx + dy * dy;
    }

    _getLinkReferencePoint(link, pivot) {
        if (!(link instanceof Link) || !pivot) return null;

        const holeCenterLine = typeof link.getHoleCenterLine === 'function'
            ? link.getHoleCenterLine()
            : null;

        if (holeCenterLine?.start && holeCenterLine?.end) {
            const startDistance = this._distanceSquared(holeCenterLine.start, pivot);
            const endDistance = this._distanceSquared(holeCenterLine.end, pivot);
            return startDistance <= endDistance ? holeCenterLine.start : holeCenterLine.end;
        }

        const points = link.getWorldPoints?.() || [];
        if (points.length < 2) return null;

        let bestMidpoint = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (let index = 0; index < points.length; index += 1) {
            const nextIndex = (index + 1) % points.length;
            const midpoint = {
                x: (points[index].x + points[nextIndex].x) / 2,
                y: (points[index].y + points[nextIndex].y) / 2
            };
            const score = this._distanceSquared(midpoint, pivot);
            if (score < bestScore) {
                bestScore = score;
                bestMidpoint = midpoint;
            }
        }

        return bestMidpoint;
    }

    _getReferenceGeometry(chainKey = 'A') {
        const pivot = this.pivotPoint;
        if (!pivot) return null;

        const primaryLinks = this._getChainLinks(chainKey);
        let prevLink = primaryLinks.prevLink;
        let nextLink = primaryLinks.nextLink;

        if (!(prevLink instanceof Link) || !(nextLink instanceof Link)) {
            const fallbackLinks = this._getChainLinks(chainKey === 'A' ? 'B' : 'A');
            prevLink = fallbackLinks.prevLink;
            nextLink = fallbackLinks.nextLink;
        }

        if (!(prevLink instanceof Link) || !(nextLink instanceof Link)) return null;

        const prevReferencePoint = this._getLinkReferencePoint(prevLink, pivot);
        const nextReferencePoint = this._getLinkReferencePoint(nextLink, pivot);
        if (!prevReferencePoint || !nextReferencePoint) return null;

        const prevVector = {
            x: prevReferencePoint.x - pivot.x,
            y: prevReferencePoint.y - pivot.y
        };
        const nextVector = {
            x: nextReferencePoint.x - pivot.x,
            y: nextReferencePoint.y - pivot.y
        };

        const prevDirection = this._normalizeVector(prevVector);
        const nextDirection = this._normalizeVector(nextVector);
        if (!prevDirection || !nextDirection) return null;

        const dot = Math.max(-1, Math.min(1, prevDirection.x * nextDirection.x + prevDirection.y * nextDirection.y));
        const angle = Math.acos(dot);
        const prevLength = Math.hypot(prevVector.x, prevVector.y);
        const nextLength = Math.hypot(nextVector.x, nextVector.y);

        return {
            pivot,
            prevReferencePoint,
            nextReferencePoint,
            prevDirection,
            nextDirection,
            prevLength,
            nextLength,
            angle
        };
    }

    getJointAngleRadians(chainKey = 'A') {
        const geometry = this._getReferenceGeometry(chainKey);
        return Number.isFinite(geometry?.angle) ? geometry.angle : 0;
    }

    getRawThickness(chainKey = 'A') {
        const angle = this.getJointAngleRadians(chainKey);
        const halfAngle = angle / 2;
        const tanHalfAngle = Math.tan(halfAngle);
        const safeTanHalfAngle = Math.max(tanHalfAngle, 1e-6);
        const safeK = Math.max(Number(this.k) || 0, 1e-8);
        return Math.sqrt(safeK * safeTanHalfAngle);
    }

    getJointShape(thickness, chainKey = 'A') {
        const geometry = this._getReferenceGeometry(chainKey);
        const requestedThickness = Number(thickness);
        if (!geometry || !Number.isFinite(requestedThickness) || requestedThickness <= 0) return null;

        const halfAngle = geometry.angle / 2;
        const tanHalfAngle = Math.tan(halfAngle);
        const cosHalfAngle = Math.cos(halfAngle);
        if (!Number.isFinite(tanHalfAngle) || tanHalfAngle <= 1e-6 || !Number.isFinite(cosHalfAngle) || cosHalfAngle <= 1e-6) {
            return null;
        }

        let bisectorDirection = this._normalizeVector({
            x: geometry.prevDirection.x + geometry.nextDirection.x,
            y: geometry.prevDirection.y + geometry.nextDirection.y
        });

        if (!bisectorDirection) {
            bisectorDirection = this._normalizeVector({
                x: -geometry.prevDirection.y,
                y: geometry.prevDirection.x
            });
        }

        if (!bisectorDirection) return null;

        const maxDistanceAlongBisector = Math.min(geometry.prevLength, geometry.nextLength) * cosHalfAngle * 0.8;
        const desiredDistanceAlongBisector = requestedThickness / (2 * tanHalfAngle);
        const distanceAlongBisector = Math.min(desiredDistanceAlongBisector, maxDistanceAlongBisector);
        if (!Number.isFinite(distanceAlongBisector) || distanceAlongBisector <= 1e-6) return null;

        const baseCenter = {
            x: geometry.pivot.x + bisectorDirection.x * distanceAlongBisector,
            y: geometry.pivot.y + bisectorDirection.y * distanceAlongBisector
        };

        const perpendicularDirection = {
            x: -bisectorDirection.y,
            y: bisectorDirection.x
        };

        const actualThickness = 2 * distanceAlongBisector * tanHalfAngle;
        const halfThickness = actualThickness / 2;

        return {
            pivot: { x: geometry.pivot.x, y: geometry.pivot.y },
            leftBase: {
                x: baseCenter.x - perpendicularDirection.x * halfThickness,
                y: baseCenter.y - perpendicularDirection.y * halfThickness
            },
            rightBase: {
                x: baseCenter.x + perpendicularDirection.x * halfThickness,
                y: baseCenter.y + perpendicularDirection.y * halfThickness
            },
            baseCenter,
            bisectorDirection,
            perpendicularDirection,
            actualThickness,
            angle: geometry.angle,
            prevReferencePoint: geometry.prevReferencePoint,
            nextReferencePoint: geometry.nextReferencePoint
        };
    }

    _applyToFollowingLinks() {
        const jointTheta = Number(this.theta) || 0;

        if (this.prevLinkA instanceof Link && this.nextLinkA instanceof Link) {
            this.nextLinkA.theta = this.prevLinkA.theta + jointTheta;
        }
        if (this.prevLinkB instanceof Link && this.nextLinkB instanceof Link) {
            this.nextLinkB.theta = this.prevLinkB.theta + jointTheta;
        }
    }

    _bindMechanism(mechanism, index) {
        this._mechanism = mechanism instanceof Mechanism ? mechanism : null;
        this._index = Number.isInteger(index) ? index : -1;
    }

    // Updates this joint and propagates movement only to following links.
    setTheta(nextTheta) {
        const previousTheta = this.theta;
        const clampedTheta = this._clampTheta(nextTheta);
        if (Math.abs(clampedTheta - previousTheta) < 1e-12) {
            return this.theta;
        }

        this._syncPivotPointFromNextLinks();

        const delta = clampedTheta - previousTheta;

        this.theta = clampedTheta;
        if (this._mechanism instanceof Mechanism && this._index >= 0) {
            this._mechanism._propagateRigidFromJoint(this._index, {
                deltaA: delta,
                deltaB: delta,
                pivotA: this.pivotPoint,
                pivotB: this.pivotPoint
            });
        } else {
            this._applyToFollowingLinks();
        }
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
