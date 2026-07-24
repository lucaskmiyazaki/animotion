class SkeletonIO {
    static exportSkeleton(skeleton, frameIndex = 0) {
        if (!skeleton) return false;

        const data = {
            points: skeleton.points.map((p, index) => ({ id: index, x: p.x, y: p.y })),
            originalPoints: Array.isArray(skeleton.originalPoints)
                ? skeleton.originalPoints.map((point, index) => ({ id: index, x: point.x, y: point.y }))
                : skeleton.points.map((point, index) => ({ id: index, x: point.x, y: point.y })),
            lines: skeleton.lines.map((line) => ({
                start: skeleton.points.indexOf(line.start),
                end: skeleton.points.indexOf(line.end)
            }))
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `skeleton_frame${frameIndex}.txt`;
        link.click();
        URL.revokeObjectURL(url);
        return true;
    }

    static importSkeleton(onLoaded) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt';

        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    const skeleton = new Skeleton();
                    const pointObjs = parsed.points.map((point) => skeleton.addPoint(point.x, point.y));
                    parsed.lines.forEach((line) => skeleton.addLine(pointObjs[line.start], pointObjs[line.end]));
                    if (Array.isArray(parsed.originalPoints) && parsed.originalPoints.length > 0) {
                        skeleton.setOriginalPoints(parsed.originalPoints);
                    } else {
                        skeleton.setOriginalPoints(parsed.points);
                    }
                    skeleton.updateAllGeometry();
                    if (typeof onLoaded === 'function') {
                        onLoaded(skeleton);
                    }
                } catch {
                    alert('Invalid skeleton file.');
                }
            };
            reader.readAsText(file);
        });

        input.click();
    }
}

window.SkeletonIO = SkeletonIO;
