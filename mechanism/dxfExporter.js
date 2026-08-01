class MechanismDXFExporter {
    static _isFinitePoint(point) {
        return Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
    }

    static _formatNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number.toFixed(6).replace(/\.?0+$/, '') : '0';
    }

    static _transformPoint(point, scale) {
        return {
            x: Number(point.x) * scale,
            y: -Number(point.y) * scale
        };
    }

    static _addLine(entities, layer, start, end, scale) {
        if (!this._isFinitePoint(start) || !this._isFinitePoint(end)) return;
        const a = this._transformPoint(start, scale);
        const b = this._transformPoint(end, scale);
        entities.push([
            '0', 'LINE',
            '8', layer,
            '10', this._formatNumber(a.x),
            '20', this._formatNumber(a.y),
            '30', '0',
            '11', this._formatNumber(b.x),
            '21', this._formatNumber(b.y),
            '31', '0'
        ].join('\n'));
    }

    static _addPolyline(entities, layer, points, scale, closed = true) {
        const validPoints = Array.isArray(points) ? points.filter((point) => this._isFinitePoint(point)) : [];
        if (validPoints.length < (closed ? 3 : 2)) return;

        const entity = [
            '0', 'LWPOLYLINE',
            '8', layer,
            '90', String(validPoints.length),
            '70', closed ? '1' : '0'
        ];

        validPoints.forEach((point) => {
            const transformed = this._transformPoint(point, scale);
            entity.push('10', this._formatNumber(transformed.x));
            entity.push('20', this._formatNumber(transformed.y));
        });

        entities.push(entity.join('\n'));
    }

    static _buildMergedPolygon(link, slack, tolerance) {
        if (!(link instanceof Link)) return [];

        const combined = Chain._collectTwinCombinedPoints(link, tolerance);
        const originalPoints = window.PolygonRenderer?.sanitizePolygonPoints?.(combined, tolerance) || [];
        const pivotPoints = window.PolygonRenderer?.collectUniquePivotPoints?.(originalPoints, tolerance) || [];
        const shapeModifiers = window.PolygonRenderer?.generateShapeModifiers?.(pivotPoints, slack, tolerance) || [];
        const polygon = window.PolygonRenderer?.reconnectPolygonPoints?.({
            originalPoints,
            pivotPoints,
            shapeModifiers,
            tolerance
        }) || [];

        return polygon.length >= 3 ? polygon : link.getWorldPoints();
    }

    static _collectMechanismOutlines(entities, chain, options) {
        if (!(chain instanceof Chain) || !Array.isArray(chain.links)) return;
        chain.links.forEach((link) => {
            const polygon = this._buildMergedPolygon(link, options.slack, options.pointTolerance);
            this._addPolyline(entities, 'MECHANISM', polygon, options.scale, true);
        });
    }

    static _collectHolePath(entities, chain, holePosition, layer, scale) {
        if (!(chain instanceof Chain) || !Array.isArray(chain.links)) return;
        const lines = chain.links
            .map((link) => link?.getHoleLine?.(holePosition))
            .filter((line) => this._isFinitePoint(line?.start) && this._isFinitePoint(line?.end));

        lines.forEach((line) => this._addLine(entities, layer, line.start, line.end, scale));
        for (let index = 0; index < lines.length - 1; index++) {
            const pair = Chain._nearestEndpointsBetweenLines(lines[index], lines[index + 1]);
            this._addLine(entities, layer, pair.a, pair.b, scale);
        }
    }

    static _collectJoints(entities, mechanism, minimumThickness, scale) {
        if (!(mechanism instanceof Mechanism) || !Array.isArray(mechanism.joints)) return;

        ['A', 'B'].forEach((chainKey) => {
            const thicknesses = mechanism.getNormalizedJointThicknesses(minimumThickness, chainKey);
            mechanism.joints.forEach((joint, index) => {
                const shape = joint?.getJointShape?.(thicknesses[index], chainKey);
                if (!shape) return;
                this._addPolyline(
                    entities,
                    `JOINT_${chainKey}`,
                    [shape.pivot, shape.leftBase, shape.rightBase],
                    scale,
                    true
                );
            });
        });
    }

    static _collectAttachments(entities, mechanism, options) {
        if (!(mechanism instanceof Mechanism)) return;
        const attachments = mechanism.createAttachments({
            holeLength: options.attachmentHoleLength,
            wallThickness: options.attachmentWallThickness,
            tolerance: options.pointTolerance
        });

        attachments.forEach((attachment) => {
            this._addPolyline(entities, 'ATTACHMENT_OUTER', attachment.outer, options.scale, true);
            this._addPolyline(entities, 'ATTACHMENT_INNER', attachment.inner, options.scale, true);
        });
    }

    static buildDXF(bundle, options = {}) {
        const mechanism = bundle?.mechanism;
        if (!(mechanism instanceof Mechanism)) return null;

        const scale = Number(options.scaleMmPerPixel);
        const resolvedOptions = {
            scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
            slack: Number.isFinite(options.slack) ? Number(options.slack) : 0,
            pointTolerance: Number.isFinite(options.pointTolerance) ? Number(options.pointTolerance) : 0.1,
            jointMinimumThickness: Number.isFinite(options.jointMinimumThickness)
                ? Number(options.jointMinimumThickness)
                : 2,
            attachmentHoleLength: Number.isFinite(options.attachmentHoleLength)
                ? Number(options.attachmentHoleLength)
                : 5,
            attachmentWallThickness: Number.isFinite(options.attachmentWallThickness)
                ? Number(options.attachmentWallThickness)
                : 2
        };

        const chainA = bundle.mechanism1 instanceof Chain ? bundle.mechanism1 : null;
        const chainB = bundle.mechanism2 instanceof Chain ? bundle.mechanism2 : null;
        const primaryChain = options.primaryChainKey === 'B' ? (chainB || chainA) : (chainA || chainB);
        if (!(primaryChain instanceof Chain)) return null;

        const entities = [];
        this._collectMechanismOutlines(entities, primaryChain, resolvedOptions);
        this._collectHolePath(entities, chainA, options.holePositionA, 'HOLE_A', resolvedOptions.scale);
        this._collectHolePath(entities, chainB, options.holePositionB, 'HOLE_B', resolvedOptions.scale);
        this._collectJoints(entities, mechanism, resolvedOptions.jointMinimumThickness, resolvedOptions.scale);
        this._collectAttachments(entities, mechanism, resolvedOptions);

        if (entities.length === 0) return null;

        return [
            '0', 'SECTION',
            '2', 'HEADER',
            '9', '$ACADVER',
            '1', 'AC1015',
            '9', '$INSUNITS',
            '70', '4',
            '0', 'ENDSEC',
            '0', 'SECTION',
            '2', 'ENTITIES',
            entities.join('\n'),
            '0', 'ENDSEC',
            '0', 'EOF'
        ].join('\n');
    }

    static download(bundle, options = {}) {
        const dxf = this.buildDXF(bundle, options);
        if (!dxf) return false;

        const blob = new Blob([dxf], { type: 'application/dxf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = options.fileName || 'pangolin-mechanism.dxf';
        link.click();
        URL.revokeObjectURL(url);
        return true;
    }
}

window.MechanismDXFExporter = MechanismDXFExporter;