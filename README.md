# Pangolin

Pangolin is a design tool for building a compliant mechanism from a user-drawn skeleton over video frames.

You can access the app on https://lucaskmiyazaki.github.io/animotion/
or locally by using npx serve

## Core Idea

1. The user draws a skeleton (points + segments) on top of a video frame sequence.
2. Each skeleton segment becomes one compliant link (a trapezoid).
3. Adjacent links form joints with relative angles.
4. The mechanism is solved frame-by-frame to follow a target path while minimizing elastic cost.
5. A ruler calibration converts pixel geometry to real millimeters for DXF export.

## Geometry Model

A skeleton is an ordered polyline:

$$
\mathcal{S} = \{\mathbf{p}_0,\mathbf{p}_1,\ldots,\mathbf{p}_n\}
$$

with segments

$$
\mathbf{s}_i = \mathbf{p}_{i+1} - \mathbf{p}_i, \quad i=0,\ldots,n-1.
$$

For each segment, Pangolin builds a trapezoid link with:

- mean length from segment length,
- side angles from local skeleton turning geometry,
- user-controlled thickness.

So the mechanism has links

$$
\mathcal{L} = \{L_0, L_1, \ldots, L_{m-1}\}, \quad m=n.
$$

## Final Position (End State)

The final state is directly defined by the skeleton target geometry.

For link $i$:

$$
\mathbf{x}_i^{\text{final}} = \mathbf{p}_i,
$$

$$
\phi_i^{\text{final}} = \mathrm{atan2}(s_{i,y}, s_{i,x})
$$

where $\mathbf{x}_i$ is link position and $\phi_i$ is link orientation.

This means the mechanism endpoint arrangement is exactly tied to the user-drawn skeleton shape.

## Initial Position (Start State)

Pangolin computes a physically valid start state in two stages:

1. Flat construction:
   - Build links laid out from the first segment direction.
   - Use geometric offsets and pivot intersections to get a connected chain.
2. Start rotation fitting:
   - Compute $\phi_i^{\text{start}}$ by minimizing alignment error to a reference skeleton (typically frame 0), under joint constraints.

Relative joint angle limits are enforced for each joint:

$$
\theta_j \in [\theta_j^{\min},\theta_j^{\max}].
$$

After solving start rotations, all link positions are recomputed by forward positioning from pivots.

## Path Parameterization by Length

Pangolin uses a scalar path coordinate based on hole-network length $L$.

Total line length in a pose:

$$
L = \sum_{i}\|\mathbf{h}_{i,R}-\mathbf{h}_{i,L}\| + \sum_{i}\|\mathbf{h}_{i+1,L}-\mathbf{h}_{i,R}\|
$$

where $\mathbf{h}_{i,L},\mathbf{h}_{i,R}$ are left/right hole midpoints of link $i$.

For frame parameter $t\in[0,1]$:

$$
L^*(t)=L_0 + t\,(L_f-L_0)
$$

with $L_0$ from initial pose and $L_f$ from final pose.

## Elastic Energy Model

Each joint acts like a torsional spring with stiffness $k_j$.

Let:

- $\theta_j$ be current relative joint angle,
- $\theta_{j0}$ be initial relative joint angle.

Elastic energy:

$$
E(\boldsymbol{\theta}) = \sum_{j=1}^{m-1}\frac{1}{2}k_j\,(\theta_j-\theta_{j0})^2
$$

This is the core objective for compliant behavior.

## Frame Solve: Minimize Error While Following Path

For each frame, Pangolin solves joint angles by minimizing elastic cost while matching the target path coordinate $L^*(t)$.

A practical objective is:

$$
\min_{\boldsymbol{\theta}}\;E(\boldsymbol{\theta}) + \lambda\,\big(L(\boldsymbol{\theta})-L^*(t)\big)^2
$$

subject to joint bounds:

$$
\theta_j^{\min}\le \theta_j\le \theta_j^{\max}.
$$

After optimization, link transforms are updated and the mechanism is rigidly aligned to the skeleton root.

## Skeleton Tracking Error

To evaluate how well the mechanism follows the skeleton, Pangolin measures distance from mechanism mid-edge points to skeleton segments.

For a point $\mathbf{q}$ and segment line $\ell$:

$$
d(\mathbf{q},\ell)=\|\mathbf{q}-\Pi_{\ell}(\mathbf{q})\|
$$

where $\Pi_{\ell}$ is orthogonal projection (last segment can be treated as infinite line).

Frame error:

$$
\varepsilon_f = \sum_{i}\left[d(\mathbf{q}_{i,L},\ell_i)+d(\mathbf{q}_{i,R},\ell_i)\right]
$$

Global fitting error over annotated frames:

$$
\varepsilon_{\text{total}} = \sum_{f}\varepsilon_f.
$$

## Stiffness Identification ($k$ Fitting)

Pangolin fits stiffness values $\{k_j\}$ to reduce path error:

$$
\mathbf{k}^* = \mathrm{arg\,min}_{\mathbf{k}}\sum_f \varepsilon_f(\mathbf{k})
$$

with bounds (implemented in the app):

$$
k_j \in [k_{\min},k_{\max}] \;\;\text{(typically }[1,10]\text{ in UI)}.
$$

This links geometry and mechanics: the same drawn motion can produce different compliant behaviors depending on stiffness distribution.

## Ruler Calibration and DXF Units

If ruler endpoints are r1 and r2, and the user-entered physical length is L_mm:

$$
s = \frac{L_{\text{mm}}}{\|\mathbf{r}_2-\mathbf{r}_1\|} \quad [\text{mm/pixel}]
$$

Every exported DXF coordinate is scaled:

$$
(x_{\text{mm}},y_{\text{mm}})=s\,(x_{\text{px}},y_{\text{px}})
$$

(with Y sign convention adapted for CAD output).

## Summary

Pangolin turns a visual skeleton into a compliant mechanism by combining:

- geometric construction from skeleton segments,
- constrained joint kinematics,
- elastic energy minimization,
- path tracking through target length interpolation,
- stiffness fitting against observed skeleton frames,
- metric export using ruler calibration.

This makes it a practical bridge from video-traced motion to fabrication-ready compliant mechanism geometry.

## References

1. [X-String, ACM Digital Library, DOI: 10.1145/3706598.3714282](https://dl.acm.org/doi/10.1145/3706598.3714282)
