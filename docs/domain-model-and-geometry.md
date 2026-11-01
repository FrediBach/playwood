# Domain model and geometry

[Documentation index](README.md)

The editor stores a furniture design as serializable panels, connections, and optional reusable assembly metadata. Geometry operations calculate new `Project` values; React owns when those values become committed edits. The domain layer uses Three.js math classes, but its saved data consists of plain objects, arrays, strings, and numbers.

The authoritative interfaces are in [`src/lib/types.ts`](../src/lib/types.ts). Most fundamental transforms, project parsing, geometric validation, and parts export live in [`src/lib/model.ts`](../src/lib/model.ts). The specialized modules below build on these functions rather than maintaining a separate geometry model.

## Coordinates and units

| Value | Convention |
| --- | --- |
| Panel dimensions, positions, connector spacing, offsets, and insets | Millimeters |
| Saved rotations | Euler angles in radians, in XYZ order |
| Panel local X | Width axis |
| Panel local Y | Height axis |
| Panel local Z | Thickness axis; the panel is centered about its local origin |
| World Y | Up; ground is Y = 0 |
| Custom outline vertices | Normalized 0–1 coordinates measured from the panel's top-left corner |
| Scene mesh coordinates | Meters; renderer and geometry creation convert from millimeters |
| Finish coverage | Stored range 0–1, defaulting to 0; painted panels display and export as full coverage |

Use quaternions or matrices to compose rotations, then convert back to Euler tuples for persistence. Do not add Euler components to rotate an already oriented object. `resolvePanels` and the movement functions work in millimeters; inserting scene-meter values there produces a thousandfold scale error.

`getProjectBounds` transforms the eight corners of each panel's rectangular bounding box into world space and returns axis-aligned bounds. Its width, height, and depth describe the overall world-space envelope, not necessarily a panel's local width and height. This distinction matters for rotated furniture, camera framing, grounding, and whole-project operations.

## Saved entities and their responsibilities

| Entity | Responsibility |
| --- | --- |
| `Project` | Version 1 document containing materialized `panels`, `connections`, project name, and optional assembly, palette, hardware override, and list metadata |
| `Panel` | Identity, cut dimensions, material and finish, pattern, outline, visibility, position, and orientation |
| `Connection` | One branch of a structural joint, with parent/child panel IDs, connector type, side, seam offset, inset, flip, and physical connector quantity |
| `ConnectorOverride` | Per-piece color, material, visual type, removal, or rail slide, keyed by stable hardware identity |
| `AssemblyDefinition` | Reusable source-local panels, connections, attachment ports, and optional configurable parameters |
| `AssemblyInstance` | Reference to a definition, world transform, stable local-to-project ID mappings, and optional finish and parameter overrides |
| `AssemblyLink` | Physical relationship between two attachment ports; at least one endpoint belongs to a linked instance |
| `AssemblyLoosePort` | Suppressed ordinary corner retained when an instance is disassembled while still attached to another instance |
| `ListGroup` | One level of panel or connector organization, independent of physical connectivity and assembly membership |
| `PaletteColor` | Named custom finish swatch stored with the project |

Saved panel arrays contain both ordinary panels and materialized assembly panels. Rendering, selection, validation, and parts lists can operate on this common representation. Assembly metadata remains authoritative for its managed subset: editing the materialized panels alone would leave the definition, instance, and physical geometry inconsistent.

## Driving attachments and supplemental supports

Connections have two distinct roles:

- A connection with no `role` determines its child's pose. Each child may have at most one driving parent, and driving connections must not contain cycles. They form a directed forest, so a project can have several unattached components.
- A connection with `role: 'support'` adds hardware between already positioned panels. It does not determine either panel's pose. Support joints allow closed structures and additional physical connections without introducing cycles into the transform resolver.

`resolvePanels(project)` indexes the driving connections by child ID and recursively resolves each parent before its child. Root panels retain their stored poses. A child's pose comes from the parent's resolved pose, panel dimensions, connector profile, and attachment options. Its stored `position` and `rotation` are therefore not authoritative while it has a driving connection.

The resolver has a recursion guard, but that is not input validation. `parseProject` rejects duplicate parents and cycles. Callers should use the existing parser and mutation functions rather than rely on the resolver to sanitize malformed graphs.

`attachPanel` creates the joint branches and returns resolved panels. `attachExistingPanel` checks ancestry, detaches the child, and attaches it again. `detachPanel` and `removePanel` resolve world poses before removing affected joint groups so surviving panels stay in place. Detaching one member of a shared joint may release several branches; these operations are not equivalent to deleting an arbitrary connection record.

### Multi-branch joint encoding

Connections belonging to one physical joint share an ID prefix and end in `:0`, `:1`, or `:2`. The code derives the joint ID by removing the trailing `:<number>` suffix.

| Connector type | Child branches | Branch meaning |
| --- | --- | --- |
| `90`, `105`, `150` | 1 | The angled child |
| `t` | 2 | Branch 0 is perpendicular; branch 1 continues straight |
| `cross` | 3 | Branch 0 is perpendicular, branch 1 is the opposite perpendicular arm, and branch 2 continues straight |

Only branch 0 carries a positive `count` for T/cross joints; the other branch records have count 0. The quantity describes physical pieces distributed along the shared seam, not the number of connected panel branches. Summing branch records as if each were a separate piece would overcount hardware.

`jointStructureIssues` verifies branch completeness and shared options. Explicit `partial: true` is allowed only for supplemental T/cross joints, allowing unoccupied clamp openings while retaining a consistent branch set that includes branch 0. Branch offsets can differ; the hardware must fit the intersection of all branch seams.

### Attachment frames

`side` refers to the parent's local frame, not the current camera view. `offset` moves along the seam tangent; `inset` changes the edge location in the parent's local plane. `flip` reverses the bend direction. `quarterTurn` turns the child's width/height axes by 90 degrees within its clamp plane, which changes which dimension participates in the seam.

`attachmentPose` places panel leading edges at the measured shoulders of the connector. It does not use a generic gap between panels. Front/back attachments use face-oriented placement and produce a warning that an accessible edge is needed.

## Connector dimensions, meshes, and individual hardware

[`connector-profile.ts`](../src/lib/connector-profile.ts) defines the geometric bend and seat depth derived from the bundled CAD model:

| Type | Bend used by the transform | Seat distance |
| --- | --- | --- |
| 90° | 90° | 17.5 mm |
| 105° | 75° | 17.5472 mm |
| 150° | 30° | 10.6613 mm |
| T | 90° | 17.5 mm |
| Cross | 90° | 17.5 mm |

The product angle and transform bend are not the same for 105° and 150°. Preserve these distinctions when changing connection code. T/cross continuation branches consume two seats, producing a 35 mm gap between inline panel ends.

[`connector-geometry.ts`](../src/lib/connector-geometry.ts) imports `resources/connectors-3d/Connettori sharing.obj` as raw text. On first use, it parses the source, selects the bodies and clamp jaws for each connector type, translates them to the slot-centerline intersection, rotates to a common local frame, and converts millimeters to meters. In that frame, +X points into the parent panel, +Z toward the first child, and +Y follows the 40 mm joint depth.

The resulting geometries are cached for the application's lifetime and shared by connector instances. Callers must not mutate or dispose them. This loader provides visual bodies; `CONNECTOR_PROFILES` provides the dimensions used by the structural transforms. Changing only one can make the rendered hardware disagree with panel placement.

[`connector-options.ts`](../src/lib/connector-options.ts) normalizes materials: metal is supported only for 90° hardware; all other types use plastic. Metal changes appearance, using the same 90° CAD geometry. The original plastic color can remain in saved state while the display color is metallic.

### Seams and rails

`getConnectorSeam` finds the overlapping straight edges of parent and child, subtracts corner-radius regions, and leaves 20 mm at each end for the 40 mm body. `getConnectionAnchors` and `getConnectorPlacements` distribute a connection's hardware evenly across its usable span.

For T/cross joints, [`getConnectorRail`](../src/lib/connector-movement.ts) intersects the usable seams of every branch. All participating panels must be visible for that rail to be available to preview interactions. `connectorSlide` clamps a per-piece slide offset to this shared rail. Keyboard movement additionally prevents pieces on the same connection from passing through or overlapping their neighbors, preserving 40 mm spacing.

[`connector-selection.ts`](../src/lib/connector-selection.ts) identifies a piece as `JSON.stringify([connectionId, placementIndex])`. `getPhysicalConnectors` expands positive connection counts, applies per-piece overrides, normalizes materials, and filters removed pieces. Use this helper for physical inventory and selection rather than summing connection counts.

Removing or changing an individual connector through an override does not erase or alter the structural attachment. `Connection.type` still controls joint geometry even if a piece has an overridden displayed type. Connector overrides and structural connections serve different purposes.

## Validation boundaries

`parseProject` validates the external document shape and reconstructs accepted fields. `validateProject` analyzes geometric and structural problems in an existing project and returns issues with IDs, severity, and affected panel IDs. These functions are complementary: `parseProject` does not simply call `validateProject`, and a successfully parsed project can still contain geometry warnings or errors.

Important parser limits include:

| Field | Accepted range or limit |
| --- | --- |
| Project version | Exactly 1 |
| Panels / connections | At most 200 / 400 |
| Panel width and height | 40–4,000 mm |
| Panel thickness | 3–100 mm before connector compatibility checks |
| Panel position components | −100,000 to 100,000 mm |
| Panel Euler components | −100π to 100π radians |
| Connection offset and inset | −10,000 to 10,000 mm, with additional geometric restrictions |
| Connector quantity | Integer 0–20, subject to branch rules |
| Hole size / pitch | 2–200 mm / 10–500 mm, with pitch also at least 15 mm and hole size + 5 mm |
| Perforation count | Parser estimate `floor(width / pitch) × floor(height / pitch)` must not exceed 5,000 for a perforated panel; mesh generation has a separate margin-aware grid limit |
| Custom outline | 3–128 finite, distinct points within 0–1, enclosing nonzero area without crossed or overlapping edges |

`validateProject` checks, among other things:

- Complete and consistent joint branches and existing parent/child panels.
- Connector-compatible thickness: 16–19 mm for angled connectors and 18–19 mm for T/cross.
- Accessible attachment edges, legal insets, enough straight overlap for the requested quantity, and common overlap across all T/cross branches.
- Support alignment against the expected attachment pose. A half-turn of a rectangular panel can occupy the same slot; a width/height quarter-turn is not interchangeable unless explicitly encoded.
- Valid outlines and perforation density.
- Pairwise overlap warnings using oriented rectangular bounding boxes.

Collision boxes shrink each half-extent by 0.5 mm, with a small minimum, to avoid reporting ordinary touching as overlap. They do not follow custom outlines, rounded corners, or holes. `getProjectBounds` also uses rectangular extents. Rendered cut geometry can therefore be more detailed than placement and collision calculations.

Mutation modules often compare issue IDs before and after an edit and reject newly introduced problems. Some operations additionally treat collisions as blockers, while general project validation labels them warnings. Preserve the operation's existing policy instead of assuming every warning should reject every edit.

## Structural movement and resizing

[`structure-edit.ts`](../src/lib/structure-edit.ts) handles connected changes through `movePanels`, `resizePanels`, `resizePanelEdge`, and `resizePanelDimensions`. Directly changing a connected panel's coordinates or dimensions bypasses its constraints.

The solver follows this flow:

1. Resolve current panel world poses and construct each panel's three world-space local axes.
2. Detect existing surface contacts. These act as implicit supports for loose inserts such as shelves, dividers, and doors.
3. Partition panels into connected components using both connection edges and detected contacts.
4. For each affected component, form sparse linear constraints for joint alignment, existing contacts, requested movement/dimensions, and fixed boundaries.
5. Solve for the minimum weighted change, re-resolve the result, and check limits, new errors, and continued insert support.

Each panel contributes three translation variables and two size variables. Thickness is prescribed when requested, never a free solver variable. Rotations and connector seat dimensions remain fixed, which keeps the problem linear even for angled connectors. Connection offsets can adapt along seams. The internal solver uses conjugate gradients for the weighted constraint system and rejects nonfinite values or residual errors above tolerance.

Behavior depends on the operation:

- Moving every panel in a component translates it rigidly. Moving a subset can resize neighboring spans while retaining joints and outer boundaries.
- Numeric width/height changes anchor the selected center, or average center for a selection.
- An edge resize moves the center by half the growth to anchor the opposite edge.
- Local edge resizing additionally fixes other panels and computes connector slide overrides so existing hardware remains in its original world position. If the rail cannot preserve that position, the edit fails.
- Managed assembly panels and ordinary panels physically connected to assemblies cannot be deformed through the loose-panel solver. Use the assembly APIs or explicitly disconnect/disassemble first.

[`preview-resize.ts`](../src/lib/preview-resize.ts) builds resize sessions and constrains interactive movement using these operations. [`extend-to-ground.ts`](../src/lib/extend-to-ground.ts) uses edge resizing to extend a suitable panel down to world Y = 0. These features should share the structural rules rather than introduce independent geometry updates.

### Whole-project and selection transforms

`moveProject` translates resolved panels and instance origins together. `rotateProject` rotates around the resolved bounding-box center and then shifts vertically to retain the previous lowest panel height; connections stay in panel-local coordinates.

[`rotateSelection`](../src/lib/selection-rotation.ts) instead rotates a complete selection around its own bounding-box center. It requires every panel in a selected instance and every panel across an incident physical connection to be selected. It preserves unselected panels and updates selected instance transforms. It does not apply the whole-project grounding adjustment.

[`project-rescale.ts`](../src/lib/project-rescale.ts) replaces repeated measurements, including dimensions, thickness, corner radius, hole size, and pitch. It is not uniform mesh scaling: panel constraints and hardware dimensions still apply. It solves compatible dimensions together and restores the creation's horizontal center and lowest height afterward.

For projects containing assemblies, [`assembly-rescale.ts`](../src/lib/assembly-rescale.ts) solves the materialized construction, updates shared definitions and affine parameters, refits suppressed corners, and verifies that every instance is still exactly describable by its source and transform. Inconsistent source/instance changes fail atomically.

## Higher-level construction operations

| Operation | Main module | Architectural role |
| --- | --- | --- |
| Add hardware to matching panels | [`auto-connect.ts`](../src/lib/auto-connect.ts) | Finds compatible poses, handles interior T splits and shared-joint upgrades, and emits supplemental connections for positioned geometry |
| Propose a small edge correction | [`auto-connect-fit.ts`](../src/lib/auto-connect-fit.ts) | Prepares a valid correction of at most 50 mm while preserving the opposite edge, other panels, and existing hardware; the UI presents the proposed fit before commitment |
| Fit panels to selected hardware | [`connect-panel.ts`](../src/lib/connect-panel.ts) | Builds connections and fit proposals from selected physical connectors |
| Prepare shared hardware replacement | [`prepare-joint-upgrade.ts`](../src/lib/prepare-joint-upgrade.ts) | Preserves geometry and handles assembly ownership before replacing joint groups |
| Close an opening | [`close-holes.ts`](../src/lib/close-holes.ts), [`closure-connectors.ts`](../src/lib/closure-connectors.ts) | Finds rectangular openings in a common frame, checks obstacles, sizes an infill for connector seats, and fits boundary hardware |
| Insert equal dividers | [`parallel-panels.ts`](../src/lib/parallel-panels.ts) | Requires two matching aligned parallel panels; inserts dividers, splits boundaries, and fits T joints atomically |
| Divide a rectangular opening into a grid | [`grid-split.ts`](../src/lib/grid-split.ts) | Requires four matching sides; accounts for fixed connector gaps and fits boundary T/interior cross joints |
| Drag and snap | [`preview-drag.ts`](../src/lib/preview-drag.ts), [`preview-snap.ts`](../src/lib/preview-snap.ts) | Releases external joints in a candidate, translates the selection, and optionally fits a new attachment; alignment snapping adjusts the movement |

Parallel and grid splits reject custom outlines and panels connected to linked assemblies. Feasibility is bounded by minimum panel dimensions and document limits. Parallel count enumeration includes document limits; grid input maxima come from geometry, with document limits checked when evaluating the proposed split. Split feasibility is evaluated by attempting complete valid edits; a visually plausible divider count is insufficient if joints or hardware cannot fit.

## Reusable assemblies

[`assemblies.ts`](../src/lib/assemblies.ts) is the assembly lifecycle and materialization boundary. It intentionally collaborates closely with `model.ts`, `structure-edit.ts`, and parameter evaluation; these modules have mutual imports, so they are not independent layers that can be reordered without care.

### Source, instance, and materialized geometry

`createAssembly` accepts a complete connected set of at least two ordinary panels. It rejects selections already owned by an instance or selections with physical connections to unselected panels. The selected geometry is resolved, centered into source-local coordinates, and stored as a definition. The first instance retains the selected panels' project IDs and initial connection mappings.

New instances receive fresh panel IDs and stable connection mappings. A mapping includes suppressed corners so their identities survive attachment and restoration. Avoid reconstructing these IDs from array order.

Materialization proceeds as follows:

1. Preserve ordinary panels and connections while removing the previously managed geometry.
2. Evaluate each definition with its instance parameter values.
3. Resolve definition-local panel poses, apply the instance world transform, apply finish overrides, and map IDs into project space.
4. Emit internal connections as `support` records, because the instance transformation already determines all managed panel poses.
5. Suppress corner joints occupied by assembly links and generate shared cross joints for those links.
6. Restore ordinary loose corners whose links disappeared and enforce project limits.

The public `materializeAssemblies` exposes this rebuilding behavior. `parseAssemblyData` also rebuilds and compares materialized geometry against saved panels and connections, rejecting mismatched dimensions, appearance, identity mappings, poses, or hardware. A document must not contain two conflicting descriptions of one assembly.

### Ports and shared corners

Ports are inferred from positive-count 90° edge joints, excluding front/back attachments. A port references a definition connection. Its frame comes from that connector's placement.

Attaching compatible corners aligns their port frames, suppresses the two ordinary corner joints, and emits a complete cross joint in the project. Cross connectors require 18–19 mm panels. Matching additional corners can create more links during the same placement. The system does not merge coincident panels or remove overlapping walls.

An assembly endpoint normally contains `instanceId` and `portId`. When disassembly leaves an instance physically attached to ordinary panels, a `loosePorts` entry preserves the suppressed ordinary corner and its endpoint omits `instanceId`. This lets later detach/remove operations restore neighboring corner hardware correctly.

`solveInstancePlacements` traverses links to reposition neighboring instances after source or parameter edits. Rebuilding validates all linked corners, including already visited links in closed loops. A loop or depth mismatch that cannot remain aligned rejects the edit rather than stretching a connector.

### Assembly lifecycle operations

| Operation | Result |
| --- | --- |
| Duplicate / instantiate | Add another instance of the same shared source |
| Edit shared definition | Update source panels, rebuild all linked copies, preserve retained parameter and finish overrides, and realign neighbors |
| Make independent | Clone the definition and retarget one instance while preserving its physical connections |
| Disconnect | Remove that instance's assembly links and place it separately; neighboring corner hardware is restored |
| Disassemble | Remove instance ownership while keeping its panels and physical joints in place; retain the definition for later reuse |
| Remove instance | Remove its materialized panels and incident links, rebuilding surviving hardware |
| Close an instance opening | Fork that instance's evaluated source, add a fitted closing panel, and preserve physical links without closing other copies |
| Move instances | Translate the connected physical set, including linked neighbors and connected ordinary panels, as rigid objects |

### Configurable dimensions

[`assembly-parameters.ts`](../src/lib/assembly-parameters.ts) defines affine dimension relationships:

```text
panel[binding.dimension] = parameterValue × binding.scale + binding.offset
```

A parameter can drive several panel dimensions. Each panel/dimension target belongs to at most one parameter. Scale must be positive, parameter names are unique ignoring case, and legal value ranges are the intersection of all bound dimension limits. Definitions store defaults; instances store only explicit overrides. Omitting an override inherits its default, and resetting a value removes the override.

`evaluateAssemblyDefinition` computes all controlled width/height targets together through `resizePanelDimensions`, applies prescribed thickness values, restores the source's horizontal center and lowest height, and rejects invalid geometry or collisions. A `WeakMap` caches evaluated results by definition object identity and ordered effective values; each definition's value cache is capped at 100 entries. Treat definitions immutably so cached configurations cannot become stale through in-place mutation.

Updating shared parameters preserves overrides for retained control IDs and removes overrides for deleted controls. Updating an instance's parameter values leaves shared defaults unchanged. Editing a panel dimension directly is rejected when a parameter owns it; edit the control instead. Changes that indirectly alter another controlled dimension are also rejected.

## Panel shape and fabrication limits

[`panel-shape.ts`](../src/lib/panel-shape.ts) validates normalized custom outlines and computes rounded corner paths shared by SVG previews and 3D geometry. Radius is clamped at use time to half the panel width/height, preserving compatibility with older documents and subsequent resizes. Custom outline fillets also respect nearby edges so narrow or concave features remain simple.

The detailed panel mesh is produced in [`scene-geometry.ts`](../src/components/scene-geometry.ts), including real pegboard/slot openings. Structural placement still reasons about the panel's rectangular bounds. It does not use a full boundary representation or simulate connector interference with arbitrary cuts.

The model is an editable geometric design system. It does not calculate structural strength, load capacity, manufacturing tolerance, tightening, or a separate measured metal connector shape. The source CAD depicts nominal 18 mm slots and no separate screw geometry. These limits should remain explicit when adding geometry or export features.

## Tests to consult when changing the domain

Start with the behavior under change rather than copying a nearby implementation detail:

- [`model.test.ts`](../src/lib/model.test.ts) covers attachment transforms, joint rules, and project validation.
- [`structure-edit.test.ts`](../src/lib/structure-edit.test.ts), [`accessory-support.test.ts`](../src/lib/accessory-support.test.ts), and [`preview-resize.test.ts`](../src/lib/preview-resize.test.ts) cover constrained movement, inserts, and interactive resize limits.
- [`assemblies.test.ts`](../src/lib/assemblies.test.ts), [`assembly-parameters.test.ts`](../src/lib/assembly-parameters.test.ts), and [`assembly-rescale.test.ts`](../src/lib/assembly-rescale.test.ts) cover source/instance consistency and configurable geometry.
- [`auto-connect.test.ts`](../src/lib/auto-connect.test.ts), [`auto-connect-upgrades.test.ts`](../src/lib/auto-connect-upgrades.test.ts), and [`auto-connect-fit.test.ts`](../src/lib/auto-connect-fit.test.ts) cover hardware fitting and upgrades.
- [`connector-movement.test.ts`](../src/lib/connector-movement.test.ts), [`connector-selection.test.ts`](../src/lib/connector-selection.test.ts), and [`connector-geometry.test.ts`](../src/components/connector-geometry.test.ts) cover physical hardware identity, rails, and measured mesh placement.
- [`custom-outline.test.ts`](../src/lib/custom-outline.test.ts), [`panel-shape.test.ts`](../src/lib/panel-shape.test.ts), and [`scene-geometry.test.ts`](../src/components/scene-geometry.test.ts) distinguish persisted outline rules from rendered cut geometry.
