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
| `ConstructionObjects` | Optional source-volume forest of boxes and ordered Boolean operations; separate from physical panels, joints, and assembly definitions |
| `Panel` | Identity, cut dimensions, material and finish, pattern, outline, visibility, position, and orientation |
| `Connection` | One branch of a structural joint, with parent/child panel IDs, connector type, side, seam offset, inset, flip, and physical connector quantity |
| `ConnectorOverride` | Per-piece color, material, visual type, removal, or rail slide, keyed by stable hardware identity |
| `AssemblyDefinition` | Reusable source-local panels, connections, attachment ports, and optional configurable parameters |
| `AssemblyInstance` | Reference to a definition, world transform, stable local-to-project ID mappings, and optional finish and parameter overrides |
| `AssemblyLink` | Physical relationship between two attachment ports; at least one endpoint belongs to a linked instance |
| `AssemblyLoosePort` | Suppressed ordinary corner retained when an instance is disassembled while still attached to another instance |
| `ListGroup` | One level of panel or connector organization, independent of physical connectivity and assembly membership |
| `PaletteColor` | Named custom finish swatch stored with the project |
| `DesignConstraint` | Enabled or disabled project requirement for a cut dimension, floor elevation, matching dimensions/levels, or a gap between two panels |

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

Polygonal closing panels use the optional `Connection.outlineEdge` index into the child's normalized outline. These are supplemental connections from a rectangular rim panel's ordinary edge; they do not drive a rectangular attachment pose. A single outline uses a 90° joint. Two neighboring outlines can share a complete T joint: the rectangular rim occupies the stem, and branches 0 and 1 grip opposite outline edges along the T's crossbar. Both branches must carry an outline index; mixed rectangular/outline T branches and partial outline joints are rejected. [`outline-closures.ts`](../src/lib/outline-closures.ts) validates the actual world-space outline edge against both connector seats and derives its usable seam. This support format is specific to fitted outlines, not general attachment to arbitrary custom shapes.

## Connector dimensions, meshes, and individual hardware

`parseConnectorId` in [`connector-selection.ts`](../src/lib/connector-selection.ts) validates the JSON pair used for a physical hardware identity: a connection ID string and an integer piece index from 0 through 19. Project import, automatic joint upgrades, and repeated compartments share this decoder before using override keys. This preserves the existing saved format and index limits.

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

`getConnectorSeam` finds the overlapping straight edges of parent and child, subtracts corner-radius regions, and leaves 20 mm at each end for the 40 mm body. Ordinary attachments use rectangular edge extents; an `outlineEdge` support uses its actual child outline segment projected onto the parent's seam. `getConnectionAnchors` and `getConnectorPlacements` distribute a connection's hardware evenly across its usable span.

For T/cross joints, [`getConnectorRail`](../src/lib/connector-movement.ts) intersects the usable seams of every branch. All participating panels must be visible for that rail to be available to preview interactions. `connectorSlide` clamps a per-piece slide offset to this shared rail. Keyboard movement additionally prevents pieces on the same connection from passing through or overlapping their neighbors, preserving 40 mm spacing.

[`connector-selection.ts`](../src/lib/connector-selection.ts) identifies a piece as `JSON.stringify([connectionId, placementIndex])`. `getPhysicalConnectors` expands positive connection counts, applies per-piece overrides, normalizes materials, and filters removed pieces. Use this helper for physical inventory and selection rather than summing connection counts.

`getDefaultConnectorColor` counts the installed pieces' saved colors, including individual overrides and hidden construction, to choose the most-used color for new joints. Removed pieces and zero-count branches do not vote. Hex colors are grouped case-insensitively; ties keep the first encountered installed color, and an empty inventory uses red. Hole filling, automatic joints and splits, move-and-snap, paste attachment joints, and each newly opened attachment form use this project-wide default. Assembly hole filling chooses it from the materialized project before fitting its local source. Explicit attachment color choices, copied hardware finishes, matching infill, and preserved replacement hardware keep their existing behavior. The choice changes neither connector material nor the saved format.

Removing or changing an individual connector through an override does not erase or alter the structural attachment. `Connection.type` still controls joint geometry even if a piece has an overridden displayed type. Connector overrides and structural connections serve different purposes.

The inspector routes type choices through [`changeConnectorType`](../src/lib/connector-type-edit.ts). Choosing 90°, 105°, or 150° on an angled joint updates `Connection.type` for each selected joint, resolves the attached descendants from the existing parent pose, and clears conflicting type overrides across that seam, including removed pieces. All clamps on a seam share the new angle even when only one is selected. Colors, slides, removal state, counts, and IDs survive; unsupported metal becomes plastic. The complete multi-joint candidate is checked against support alignment, new panel collisions, joint fit, TROFAST placement, design constraints, build space, and position limits before it is returned. Rejections leave the source unchanged. Existing unrelated diagnostics may remain. This operation does not solve closed loops or rotate independently positioned support-only children; those joints must still align after resolution. Source-owned assembly joints and movement of assembly members require disassembly first, while ordinary extensions on stationary assembly panels can change. Occupied T/cross branches cannot become an angled joint. T/cross choices retain per-piece override behavior for the existing free-opening workflow; merely choosing them does not add panels or branches.

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
- Enabled user design requirements, measured from resolved panels including hidden parts. Unsatisfied or unsupported rules produce `constraint-<id>` errors.

Collision boxes shrink each half-extent by 0.5 mm, with a small minimum, to avoid reporting ordinary touching as overlap. They do not follow custom outlines, rounded corners, or holes. `getProjectBounds` also uses rectangular extents. Rendered cut geometry can therefore be more detailed than placement and collision calculations.

Mutation modules often compare issue IDs before and after an edit and reject newly introduced problems. Some operations additionally treat collisions as blockers, while general project validation labels them warnings. Preserve the operation's existing policy instead of assuming every warning should reject every edit.

The structural linear solver retains its best iterate when floating-point rotation and offset drift in imported closed loops causes later iterations to diverge. It uses that fallback only if the final iterate fails, and checks it against the same original equations and residual tolerance. This avoids rejecting feasible connected resizes without relaxing joint constraints.

## User-defined design constraints

`Project.constraints` is an optional array of `DesignConstraint` values. These rules express design intent without adding physical joints or changing the driving attachment graph. Each has a stable ID and an `enabled` flag. [`design-constraints.ts`](../src/lib/design-constraints.ts) parses and evaluates the rules without importing the model resolver; callers supply resolved panels. Derived measurements, numerical residuals, and unsupported-geometry messages are not persisted. Evaluation uses a 0.1 mm tolerance.

| Kind | Measurement |
| --- | --- |
| `floor` | World Y of the panel's minimum, center, or maximum reference meets an exact value, minimum, maximum, or range |
| `position` | One minimum/center/maximum stock reference stays at an exact signed world X/Y/Z coordinate |
| `setback` | Second chosen reference minus first chosen reference along X/Y/Z stays at an exact signed distance; zero aligns the references |
| `dimension` | One local cut `width` or `height` meets an exact value, minimum, maximum, or range |
| `equal-dimension` | Two independently chosen local cuts are equal: `dimension` on the first panel and `secondDimension` on the second (defaults to `dimension`) |
| `opening-ratio` | Two ordered stock-boundary gaps on one world axis remain nonnegative; the second equals `ratio` times the first (1 means equal) |
| `level` | Chosen minimum, center, or maximum Y references have equal elevation |
| `gap` | Ordered second-panel minimum minus first-panel maximum along world X, Y, or Z meets an exact value, minimum, maximum, or range |

`designConstraintLimits` gives the permitted measurement interval. Exact rules and equality relationships have matching lower and upper limits; minimum and maximum rules have one limit; range rules have both. Evaluation measures distance outside this interval, with zero violation inside it. Reconciliation moves an out-of-range measurement to a feasible boundary without changing the saved limits. Equal-dimension and level rules retain their equality semantics. Cross-dimension equality can match width to height regardless of panel orientation; only the two named cuts gain permission to resize. Each measurement overlay follows its own local cut axis.

Opening relationships store four panel references: start/end of opening 1, then start/end of opening 2. Adjacent openings may share a divider; each pair must contain distinct panels and the complete rule must reference at least three panels. The solver adds one equality and a nonnegative bound for each opening. These rules preserve loose cuts and move boundaries, while connected spans can adapt during structural edits. A transient reference anchors one panel, not a whole opening; use exact gap or floor rules to preserve additional boundaries. Both openings appear in the measurement overlay.

Fixed positions are absolute and survive cut edits and whole-project rescale; rescale does not recenter a constrained world axis after solving. Setbacks are relative, permit negative values, and preserve loose cuts rather than authorizing recutting. Both are exact requirements; neither exposes minimum/maximum/range modes. Changing a direction or reference in the editor initializes the draft value from current resolved geometry.

Coordinate rules require rectangular outlines with panel axes aligned to world axes. Ninety-degree orientations are supported; arbitrary tilts and custom outlines are rejected explicitly. Local dimension rules remain valid for rotated panels and custom outlines. Gap measurements include thickness but use panel extents: they are directed axis distances, not a shortest-distance or obstacle-clearance calculation. Holes, rounded details, connectors, and other furniture do not reduce that measurement. Negative gaps identify overlap or reversed ordering along the chosen axis.

[`setDesignConstraint`](../src/lib/design-constraint-commands.ts) validates a rule draft, creates a candidate, and invokes `reconcileDesignConstraints` when the new requirement is unsatisfied. It returns the rule and adjusted geometry together. Relationship reconciliation accepts a transient reference panel for the initial adjustment: equal-dimension rules keep its selected cut dimension fixed, while level, gap, opening-ratio, and setback rules keep its center position fixed. This choice is not stored as a permanent driver. An incompatible reference choice rejects the preview. Reconciliation is scoped to the edited rule and its dependent component, leaving unrelated imported violations unchanged.

The structural solver joins panels related by enabled rules into the same solve component while retaining their separate physical component boundaries. It adds equalities for exact rules and inequalities for minimums, maximums, ranges, and panel size limits. Upper bounds negate the measured expression, including any prescribed thickness shift. Bounds can activate or release; a measurement inside its allowed interval is not forced to either boundary. Existing placement preferences can relax when necessary to satisfy hard rules, joints, and the requested edit. Loose peer cuts remain fixed unless an exact dimension or equal-dimension relationship controls them; minimum, maximum, and range rules alone do not authorize recutting. Reconciliation may resize a cut to repair an already violated dimension limit, and connected spans remain adaptable within their limits. A zero-width range acts as an exact dimension. Cut-preservation locks are retained when automatic placement preferences relax, so a blocked loose peer cannot shrink merely to satisfy a gap. Solving retains prescribed rotations, thicknesses, connector dimensions, and current physical supports. Control-drag explicitly releases external joints and incidental contacts at the selection boundary while still enforcing user rules.

[`assertDesignConstraintEdit`](../src/lib/design-constraint-edits.ts) checks the final candidate using actual measurements. Normal history commits and relevant domain transforms call it, so editing through another tool cannot silently bypass a rule. A valid imported project may contain unsatisfied rules: an unchanged rule may remain unsatisfied or improve, but cannot worsen. Unsupported rules can remain while their referenced geometry is unchanged. This comparison must use residuals and references, not only stable validation-issue IDs.

New rule authoring currently excludes linked assembly members and ordinary panels connected to them. Use assembly configurable values for those dimensions; source-owned rules and general cross-instance solving are not implemented. Saved/imported project rules remain checked during assembly updates. Whole-project moves and rotations keep world references fixed rather than rewriting targets. Deletion, copying, and standalone assembly-file scope are described in [state and persistence](state-and-persistence.md#design-rule-lifecycle).

## TROFAST inserts and panel openings

[`trofast-catalog.ts`](../src/lib/trofast-catalog.ts) defines eight IKEA Switzerland box/tray variants and their product-specific colors, dimensions, and source links. Outer lengths are millimeters; color values, tapered body details, rim profiles, and cutout dimensions are approximations for visualization. They are not manufacturing measurements or a structural approval. Catalog item/color IDs are part of the saved contract; retain legacy entries if retail availability changes.

`Panel.trofastInserts` is optional. Each insert has an ID unique within its host panel, a catalog item/color ID, a center `x/y` in millimeters from the panel's top-left corner, an optional `quarterTurn`, and a `face` (+1 or −1) identifying the local Z side carrying its rim. The rim underside rests on that face; the box extends into the panel and below it. The installed footprint and height never scale with panel dimensions. Panel-local storage preserves relationships through copies, assemblies and transforms.

[`trofast.ts`](../src/lib/trofast.ts) resolves world placement and requires a solid rectangular panel parallel to ground with the opening upward. Rounded panel corners are checked conservatively. Fit reserves 20 mm around the rim and checks the box's outer oriented envelope against ground, other panels (including hidden panels), other inserts, and installed CAD connector bounds, including slides/removals. These are conservative envelopes, not a tapered-shell collision solver or load calculation. A bounded placement search suggests a location; precise positions remain editable. Adds/edits and structural operations reject newly introduced TROFAST issues. Source-definition checks skip world floor/orientation checks until the rebuilt instances are validated in the actual project.

Panel bounds include installed inserts. Splitting panels with inserts is unavailable; automatic hole-closing panels do not inherit neighboring inserts. Legacy template repairs skip designs containing inserts. `parseProject` validates catalog IDs/colors, finite coordinates, face and turn values, up to 24 inserts per panel, and duplicate IDs independently of geometric fit. Purchased items and explicitly approximate opening notes are included in CSV export.

## Structural movement and resizing

[`structure-edit.ts`](../src/lib/structure-edit.ts) handles connected changes through `movePanels`, `resizePanels`, `resizePanelEdge`, and `resizePanelDimensions`. Directly changing a connected panel's coordinates or dimensions bypasses its constraints.

The solver follows this flow:

1. Resolve current panel world poses and construct each panel's three world-space local axes.
2. Detect existing surface contacts. These act as implicit supports for loose inserts such as shelves, dividers, and doors.
3. Partition panels into solve components using connection edges, detected contacts, and enabled design-rule relationships.
4. For each affected component, form sparse linear constraints for joint alignment, existing contacts, requested movement/dimensions, design rules, and placement preferences. Stock-size bounds (40–4,000 mm on both cut dimensions) always participate, including when no design rules are saved and when retrying without local anchors. Minimum-gap bounds participate when authored.
5. Solve for the minimum weighted change, re-resolve the result, refit dependent polygonal closing panels, and check limits, new errors, and continued insert support.

Each panel contributes three translation variables and two size variables. Thickness is prescribed when requested, never a free solver variable. Rotations and connector seat dimensions remain fixed, which keeps the problem linear even for angled connectors. Connection offsets can adapt along seams. The internal solver uses conjugate gradients for the weighted constraint system and rejects nonfinite values or residual errors above tolerance.

Moving one panel along its normal (including a connected-resize arrow) preserves inferred joint-end setbacks on seams parallel to that movement. This keeps neighboring shelf and upright cuts aligned instead of allowing each joint to slide independently. The same overlap threshold as cut resizing applies, so split supports retain independent spans. Tangential movement, simultaneous placement targets, and reviewed movement scopes retain their existing offset behavior.

Stock bounds can activate and release as neighboring cuts adapt, allowing a feasible cascade when the unconstrained optimum would exceed a cut limit. They do not authorize releasing all automatic placement preferences; that fallback still requires enabled design rules. Impossible stock-bounded edits remain atomic and report size-limit diagnostics. Whole-component rigid translations retain their fast path because they do not change cuts.

Inferred joint-end setbacks, flush insert alignments, and compartment fits carry transient provenance distinct from physical contact and authored design-rule rows. They remain enforced by default, including the existing overlap threshold. After a failed numeric cut resize, `getResizeAlternatives` tries releasing one identified inference at a time (up to 16 attempts, prioritizing selected panels, returning at most four candidates). Each candidate passes the normal joint, stock, authored-rule, build-space, and support checks plus TROFAST checks and rejection of new rectangular-bound panel overlaps. Physical contacts and authored rules are never candidates for release. This is a bounded search, not a guarantee that every feasible alternative is found; it does not combine releases. Gesture resizing and assembly parameter edits retain their protective defaults.

The review lists the particular inferred relationship being released and all resulting cut, center-position, and outline changes. Edge labels use the panel’s local cut axes, avoiding assumptions about world front/back after rotation. `acceptResizeAlternative` requires the original project identity. The relaxation is transient: accepted geometry becomes the baseline for subsequent inferred fits, without adding a saved field or changing user rules.

`movePanelsWithReview` adds staged movement for one ordinary rectangular interior panel moving along its normal in an orthogonal connected construction (including a rotated whole construction). It builds physical adjacency from complete joint membership and surface contacts. The first solve allows only the selected panel and directly adjacent spans to change; continuous panels crossing its level and all other panels stay fixed. Transverse cuts/positions remain fixed. Scoped rows are hard and never use the legacy all-preference-release fallback.

If the local solve fails, the planner expands through successive parallel boundary levels in the movement direction, adding each boundary and its adjacent spans, and stops at the nearest feasible stage (at most eight levels searched). A separate outer-boundary option preserves cuts ahead of the selected panel while letting that region travel. Both retain the opposite outside face. The review lists actual panel changes and the before/after outside size along the movement axis. No candidate commits automatically after the local stage fails. Candidates enforce joints, authored rules, stock limits, support, TROFAST fit, build space, frozen-region checks, and no new rectangular-bound panel overlaps. Solver residuals on prescribed frozen values are snapped back to their exact targets before final validation.

Keyboard/viewport movement and single-panel editable position commands use this planner. Non-normal moves, multiple selections, external design-rule relationships, oblique geometry, fitted outlines, and assembly operations retain the established solver path. Gesture resizing, Control-drag, and numeric cut resizing do not use these movement stages. The boundary-level search is conservative, not a general compartment recognizer or exhaustive alternative search.

Behavior depends on the operation:

- Moving every panel in a component without user rules translates it rigidly. Moving a subset can resize neighboring spans while retaining joints and outer boundaries. Enabled rules add their own conditions and may require adapting other related panels or rejecting the edit.
- Moving a single interior panel along its normal first anchors the far edges of neighboring spans and both edges of continuous panels crossing its level. This lets a shelf resize split side sections while leaving full-height panels and the desktop in place. T/cross branch offsets adapt independently during movement. If a shared grid cannot keep those local anchors, the solver retries with its existing outer-boundary anchors; explicit design rules still take priority. When those rules require releasing outer anchors, movement first retries with only the trailing outer boundary and far edges of its outermost supports anchored (excluding internal sections with another panel wholly behind them along the movement axis). This lets fixed-gap shelves follow a raised tabletop without lifting its feet. These references remain preferences and can still yield if explicit rules require it.
- Numeric width/height changes anchor the selected center, or average center for a selection.
- An edge resize moves the center by half the growth to anchor the opposite edge.
- Local edge resizing additionally fixes other panels and computes connector slide overrides so existing hardware remains in its original world position. If the rail cannot preserve that position, the edit fails.
- Managed assembly panels and ordinary panels physically connected to assemblies cannot be deformed through the loose-panel solver. Use the assembly APIs or explicitly disconnect/disassemble first.

[`panel-distribution.ts`](../src/lib/panel-distribution.ts) sorts three or more parallel panels along their common local-Z world normal and computes equal face-to-face gaps, accounting for thickness. Opposite normals and in-plane rotations are allowed. End panels remain fixed; transverse coordinates and selected dimensions remain unchanged. `movePanelsToPositions` supplies simultaneous movement targets for the panels that actually move, avoiding resize-only seam setback locks and redundant zero-motion equations at stationary ends. It verifies the resolved/refitted result, and retains normal joint, contact and design-rule validation. Distribution additionally rejects new collisions and insert failures. Linked assembly members or panels connected to them require disassembly/disconnection. Inspector Placement and the preview context menu commit the same command as one undo step; no saved fields are added.

[`preview-resize.ts`](../src/lib/preview-resize.ts) builds resize sessions and constrains interactive movement using these operations. [`extend-to-ground.ts`](../src/lib/extend-to-ground.ts) uses edge resizing to extend a suitable panel down to world Y = 0. These features should share the structural rules rather than introduce independent geometry updates.

Control-pull uses [`structure-repeat.ts`](../src/lib/structure-repeat.ts) to add complete rectangular compartments. Preparation identifies one empty four-panel frame containing the selected panel and a repeat axis matching the pulled handle. Width, height, and depth are measured in the cell's common orthogonal frame, so rotated construction retains its own axes. A panel-normal handle must point outward from that boundary; ambiguous cells and inward normal pulls are rejected. The initial scope is ordinary matching rectangular panels with 18–19 mm stock and no custom outlines, TROFAST inserts, or connections to linked assemblies.

Width and height repeats share the leading boundary panel and add up to three missing panels. Depth repeats require a fitted divider and four translated frame panels, with a pitch of the frame depth plus the connector-body gap. Exact matches at the destination are reused after resolving placement: dimensions, thickness, and occupied orientation must agree, including equivalent local-axis representations. Reuse preserves the existing panel identity, finish, and world pose. Partial overlaps and larger or differently sized panels are rejected. Eligibility and assembly ownership checks also apply to reused panels. Panel-count limits use the number of actual additions after matching. Every divider seam must form a complete T joint joining the old rim, new rim, and divider; validating two individually sound but disconnected frames is insufficient. A depth pull can reuse an exactly matching closing panel on the outgoing face as its separator. A subsequent depth pull also accepts the exact trailing divider that joins the latest frame to the preceding one. These exceptions apply only to depth repetition; other closing faces and internal contents remain unsupported. The original construction remains in place. New outside 90° corners between newly created panels copy source quantities, connection settings, and per-piece overrides before final hardware-clearance fitting. Joints involving reused panels keep their fitted local geometry. Existing complete joints remain intact; shared-boundary upgrades use the existing joint-fitting rules and replace incompatible hardware settings. Eligible internal design rules involving at least one newly created panel are copied with remapped references; rules involving only reused panels remain the destination’s existing rules. Absolute floor rules and external relationships are excluded as with other copies. Local cut-dimension references account for reused panels with exchanged width/height axes; a mixed-axis equal-dimension rule that the current schema cannot represent rejects the candidate. Candidate counts derive from the initial snapshot, reuse cached valid counts, and stop before invalid joints, collisions, conflicting design rules, or the document limits. A fully existing valid bay can be traversed to reach an unbuilt destination; it does not create duplicate panels, joints, or design rules. This is a construction operation; it does not continuously stretch one board or apply nice-value rounding to the repeat pitch.

After joint fitting and copied hardware overrides, [`connector-clearance.ts`](../src/lib/connector-clearance.ts) fits newly added physical connectors along their shared rails. It uses the per-part CAD envelopes in [`connector-bounds.ts`](../src/lib/connector-bounds.ts), actual piece types, and installed slide/removal overrides, including hidden construction. Retained existing hardware is fixed; new hardware may slide to clear it and other new pieces. A bay is rejected if the pass cannot fit all its new hardware. Hole closing also uses this pass. These construction checks supplement general project validation, which does not detect every hardware-to-hardware collision. Their conservative oriented bounds do not simulate screws, tightening, manufacturing tolerances, or exact mesh contact.

### Whole-project and selection transforms

`moveProject` translates resolved panels and instance origins together. `rotateProject` rotates around the resolved bounding-box center and then shifts vertically to retain the previous lowest panel height; connections stay in panel-local coordinates.

[`rotateSelection`](../src/lib/selection-rotation.ts) instead rotates a complete selection around its own bounding-box center. It requires every panel in a selected instance and every panel across an incident physical connection to be selected. It preserves unselected panels and updates selected instance transforms. It does not apply the whole-project grounding adjustment.

[`mirrorSelection`](../src/lib/selection-mirror.ts) reflects complete selections across a world-axis plane through the same center. It composes world reflection, panel rotation, and local Z reflection to retain proper Euler rotations without changing XY cut geometry. Joint bend directions and front/back sides are reflected; insert faces reverse. Selected instances share a newly mirrored copy of each selected source definition, retaining IDs, parameters, ports, overrides and links while leaving unselected copies unchanged. Saved format version 1 is unchanged. New geometry diagnostics, insert failures and design-constraint violations reject the candidate atomically.

[`project-rescale.ts`](../src/lib/project-rescale.ts) replaces repeated measurements, including dimensions, thickness, corner radius, hole size, and pitch. It is not uniform mesh scaling: panel constraints and hardware dimensions still apply. It solves compatible dimensions together and restores the creation's horizontal center and lowest height afterward. An enabled floor-height rule takes precedence over the default vertical grounding shift.

The optional `Project.niceValues` setting applies nearest-multiple rounding to requested editable lengths at input completion. Enabling it or changing its step uses the same rescale solver, including unique panel measurements; stock thickness is excluded. Automatic pitch bounds account for the rounded hole size and panel area, and radius bounds use the rounded cut sizes. A conflicting fixed constraint or assembly relationship rejects the entire settings/rescale edit. Later derived dimensions and placement retain the exact values needed by their domain operations; this is an input policy, not an extra geometric constraint. `finishPreviewResize` solves a rounded final cut from the original gesture driver so an edge resize keeps its opposite edge fixed, trying adjacent legal multiples at a size limit.

For projects containing assemblies, [`assembly-rescale.ts`](../src/lib/assembly-rescale.ts) solves the materialized construction, updates shared definitions and affine parameters, refits suppressed corners, and verifies that every instance is still exactly describable by its source and transform. Inconsistent source/instance changes fail atomically.

## Higher-level construction operations

| Operation | Main module | Architectural role |
| --- | --- | --- |
| Add hardware to matching panels | [`auto-connect.ts`](../src/lib/auto-connect.ts) | Finds compatible poses, handles interior T splits and shared-joint upgrades, and emits supplemental connections for positioned geometry |
| Snap loose panels for explicit auto connect | [`auto-connect-nearby.ts`](../src/lib/auto-connect-nearby.ts) | Runs exact fitting first, then tries nearest compatible translations within 100 mm for visible, unconnected, unmanaged panels in scope. Uses constrained movement and validated exact fitting, including interior T splits; preserves other panels during movement and rejects new errors/collisions. Internal geometry callers retain exact-only fitting. |
| Propose edge corrections | [`auto-connect-fit.ts`](../src/lib/auto-connect-fit.ts) | Prefers a single edge correction of at most 50 mm, then tries coordinated fitting of two already connected panels within a 100 mm seam error. `fitPanelPair` solves both radial lengths together (at most 100 mm change each), with other panels and installed hardware fixed; all changed dimensions are presented before commitment |
| Fit panels to selected hardware | [`connect-panel.ts`](../src/lib/connect-panel.ts) | Builds connections and fit proposals from selected physical connectors |
| Prepare shared hardware replacement | [`prepare-joint-upgrade.ts`](../src/lib/prepare-joint-upgrade.ts) | Preserves geometry and handles assembly ownership before replacing joint groups |
| Close an opening | [`close-holes.ts`](../src/lib/close-holes.ts), [`polygon-holes.ts`](../src/lib/polygon-holes.ts), [`closure-connectors.ts`](../src/lib/closure-connectors.ts) | Finds rectangular and polygonal framed openings, checks obstacles, sizes a rectangular or custom-outline infill for connector seats, and fits boundary hardware |
| Insert equal dividers | [`parallel-panels.ts`](../src/lib/parallel-panels.ts) | Requires two matching aligned parallel panels; inserts dividers, splits boundaries, and fits T joints atomically |
| Divide a rectangular opening into a grid | [`grid-split.ts`](../src/lib/grid-split.ts) | Requires four matching sides; accounts for fixed connector gaps and fits boundary T/interior cross joints |
| Repeat a rectangular compartment | [`structure-repeat.ts`](../src/lib/structure-repeat.ts) | Infers one cell and handle axis, adds whole bays with shared boundaries or fitted depth dividers, and retains the last valid preview count |
| Drag and snap | [`preview-drag.ts`](../src/lib/preview-drag.ts), [`preview-snap.ts`](../src/lib/preview-snap.ts) | Releases external joints in a candidate, translates the selection, and optionally fits a new attachment; alignment snapping adjusts the movement |

Auto-connect treats collinear joints with disjoint usable rail spans as independent, even when they share two continuous panels. This permits lower and upper T joints against separate sections of a split leg without replacing existing hardware. Overlapping rails retain the complete-joint upgrade checks, and all new hardware still passes clearance fitting.

Coordinated auto-connect first tries simultaneous corrections of the two meeting edges (up to 50 mm each), keeping their opposite edges fixed. This handles extended 90° corners whose free pair solve would move existing hardware, and can adjust just the neighboring edge when only that cut needs correction. It then uses a temporary seam equation in the existing structural solver, joining the two solve components without persisting a speculative connection. It preserves seam widths, panel rotations, thicknesses, contacts, user rules, and installed hardware positions. Only the two candidate panels may change; linked assemblies and custom outlines are excluded. Exact auto-connect fits the resulting hardware after geometry validation. A single selection scopes candidate pairs to its neighbors, so the confirmation may include an unselected partner. Unsupported angles and fits requiring changes outside that pair remain unavailable.

Parallel and grid splits reject custom outlines and panels connected to linked assemblies. Feasibility is bounded by minimum panel dimensions and document limits. Parallel count enumeration includes document limits; grid input maxima come from geometry, with document limits checked when evaluating the proposed split. Split feasibility is evaluated by attempting complete valid edits; a visually plausible divider count is insufficient if joints or hardware cannot fit.

Polygonal hole detection walks bounded faces of the surrounding panels' planar line arrangement. Small endpoint gaps may bridge the measured connector seats; incomplete frames are not closed by a convex hull. The rim uses rectangular panels with matching end planes and distinct adjoining edge directions. Inward offsets reserve connector seats, then the resulting simple outline is normalized into the fill panel's bounding dimensions. Opening probes triangulate the polygon against conservative obstacle boxes, including hidden obstacles. This detection-specific check does not make general collision validation shape-aware. Polygonal closing edges use 90° clamps, promoting two opposing outlined fills to a shared T joint where their rails coincide. Rectangular closing joints can promote to T/cross hardware.

Closing-panel hardware is fitted against installed CAD envelopes, including both existing hardware and the other new clamps. Parallel overlapping rails identify shared joints independently of saved slide positions; nearby perpendicular rails remain distinct. New clamps slide along the common straight edge and can fall back from two pieces to one on a short joint. If even one cannot fit, the entire close operation is rejected. Retained original pieces keep their positions and overrides; promoted joints replace their superseded hardware. Assembly closures perform clearance after world materialization so linked neighbors and project-level overrides participate, and synchronize any reduced quantity into the forked source definition. Accepted slides use the existing per-piece override format and survive undo and full-project export/reload. This clearance pass belongs to the closing operation; duplicating or importing an assembly retains the existing instance-creation behavior, which does not copy project-level per-piece slides.

After collinear segments merge, a rectangular face with more than one board on an edge stays on the outline-support path. A four-vertex outline lets each split board retain its own support on the same edge. Only rectangles with one distinct board per edge defer to the original rectangular finder; external branches subdividing the same board do not create duplicate openings.

The closing UI uses `findClosingPanelHoles(project, selectedIds)`, while geometry-only callers such as repetition retain `findPanelHoles`. The UI finder also considers nearby unequal rim depths. [`close-hole-alignment.ts`](../src/lib/close-hole-alignment.ts) prepares outward-only extensions to the outermost end plane, bounded to 100 mm per edge. Its atomic `resizePanelEdges` command fixes each opposite edge, all other ordinary panel geometry, and existing frame hardware. Fully supported outline fillers already on that face expand the affected rim set and move with their own hardware. Their refit runs after every rim target has been solved, avoiding invalid intermediate planes. Ordinary legacy rectangular supports and linked assemblies retain their existing restrictions. The prepared project must introduce no collision/error and satisfy saved rules; the final cap must pass the normal obstacle and hardware checks. The inspector lists the concrete changes before acceptance, and context-menu requests open that review. Acceptance recalculates the fit from the current project and commits alignment plus filling together; no clamp tolerance or seat dimension is relaxed.

Fully supported outline fillers remain in the structural component but do not contribute their rectangular bounds as joint or contact equations. After the surrounding panels solve, `refitOutlineClosures` intersects the updated edge-seat lines, then updates the filler center, bounds, and normalized vertices while preserving its ID and edge order. Noncoplanar, crossed, reversed, undersized, or unsupported results reject the edit. Editing the surrounding panels therefore reshapes the cut, rather than merely stretching its old normalized outline. Direct edits that cannot preserve the fitted edges require detaching the filler first. The same structural path serves compatible project rescaling and assembly parameters.

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

Attaching compatible corners aligns their port frames, suppresses the two ordinary corner joints, and emits a complete cross joint in the project. Cross connectors require 18–19 mm panels. Matching additional corners can create more links during the same placement. Shared-panel placement candidates also use [`reconcileAssemblyPlacement`](../src/lib/assembly-placement.ts): coincident complete panels are merged while preserving existing identities and finishes, and shared hardware is refitted. Affected linked instances are disassembled because the changed construction no longer matches their source definition. Merging a panel referenced by a design rule is rejected.

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

`updateAssemblyParameterValuesBatch` accepts per-instance patches (including undefined entries to restore defaults). It validates all IDs and override ranges before rebuilding, then evaluates every configuration, solves linked placements, and materializes/validates the complete candidate once. The optional edited reference instance is visited first and keeps its placement origin and rotation; other connected instances may move. Disconnected components retain their existing roots. Closed loops can therefore accept coordinated changes that fail sequentially. Source defaults, unedited overrides, links, and panel/instance identities remain intact. Invalid ports, geometry, collisions, build space, or saved design rules reject the whole operation. The single-instance API delegates to this operation without changing its original placement policy. This is an explicit batch command, not automatic propagation of parameter values to neighboring instances.

Updating shared parameters preserves overrides for retained control IDs and removes overrides for deleted controls. Updating an instance's parameter values leaves shared defaults unchanged. Editing a panel dimension directly is rejected when a parameter owns it; edit the control instead. Changes that indirectly alter another controlled dimension are also rejected.

## Panel shape and fabrication limits

[`panel-shape.ts`](../src/lib/panel-shape.ts) validates normalized custom outlines and computes rounded corner paths shared by SVG previews and 3D geometry. Radius is clamped at use time to half the panel width/height, preserving compatibility with older documents and subsequent resizes. Custom outline fillets also respect nearby edges so narrow or concave features remain simple.

The shared `panel-cut-geometry.ts` builds the exact contour and opening paths used by both `panel-svg.ts` and the mesh, including the same perforation clipping and density limit. SVG export retains circular arcs rather than exporting the mesh tessellation. The detailed panel mesh is produced in [`scene-geometry.ts`](../src/components/scene-geometry.ts), including real pegboard/slot openings. Structural placement still reasons about the panel's rectangular bounds. It does not use a full boundary representation or simulate connector interference with arbitrary cuts.

The model is an editable geometric design system. It does not calculate structural strength, load capacity, manufacturing tolerance, tightening, or a separate measured metal connector shape. The source CAD depicts nominal 18 mm slots and no separate screw geometry. These limits should remain explicit when adding geometry or export features.

## Tests to consult when changing the domain

### Object solver geometry proof

[`object-solver.ts`](../src/lib/object-solver.ts) starts the object-solver plan with `solveCuboid`: a domain-only candidate generator for a closed, axis-aligned cuboid centered on X/Z and resting on the floor. Inputs describe the finished **panel** envelope, excluding projecting hardware. Each cut dimension subtracts the stock thickness and two measured 90° connector seats from its corresponding outside dimension. Stock must be 16–19 mm and resulting cuts must stay within the existing 40–4,000 mm limits.

The solver fits hardware with `autoConnect`, then explicitly requires an installed 90° joint between every adjacent face pair. It rejects incomplete hardware, validation issues, CAD-envelope overlaps, or a changed envelope rather than returning a partial construction. This is an independent six-panel project candidate; it does not evaluate Booleans. The conversion transaction described below inserts its result at a source box’s world bounds. The usual conservative geometry and fabrication limitations still apply.

The saved source model and immutable commands live separately in [`construction-objects.ts`](../src/lib/construction-objects.ts); see [construction object persistence](state-and-persistence.md#construction-object-sources) for format, limits, ownership, and copy semantics. Saving an object tree validates its structure, not its Boolean result or manufacturability.

`object-solver.test.ts` checks outside dimensions, all twelve joints, stock compatibility, hardware clearance, impossible dimensions, JSON parsing, and removal of every face without moving the survivors. `polygon-holes.test.ts` additionally proves a complete common-depth L-shaped shell with six rim corner joints and two fitted six-edge closing faces. The L-prism converter now builds on this shape-family proof. Clearance comparisons use the same numerical tolerance at stationary and moving separating axes so fitted hardware at the clearance boundary remains valid when rechecked.

### Existing domain coverage

Start with the behavior under change rather than copying a nearby implementation detail:

- [`model.test.ts`](../src/lib/model.test.ts) covers attachment transforms, joint rules, and project validation.
- [`structure-edit.test.ts`](../src/lib/structure-edit.test.ts), [`accessory-support.test.ts`](../src/lib/accessory-support.test.ts), and [`preview-resize.test.ts`](../src/lib/preview-resize.test.ts) cover constrained movement, inserts, and interactive resize limits.
- [`assemblies.test.ts`](../src/lib/assemblies.test.ts), [`assembly-parameters.test.ts`](../src/lib/assembly-parameters.test.ts), and [`assembly-rescale.test.ts`](../src/lib/assembly-rescale.test.ts) cover source/instance consistency and configurable geometry.
- [`auto-connect.test.ts`](../src/lib/auto-connect.test.ts), [`auto-connect-upgrades.test.ts`](../src/lib/auto-connect-upgrades.test.ts), [`auto-connect-fit.test.ts`](../src/lib/auto-connect-fit.test.ts), and [`auto-connect-nearby.test.ts`](../src/lib/auto-connect-nearby.test.ts) cover hardware fitting, upgrades, and nearby placement.
- [`connector-movement.test.ts`](../src/lib/connector-movement.test.ts), [`connector-selection.test.ts`](../src/lib/connector-selection.test.ts), and [`connector-geometry.test.ts`](../src/components/connector-geometry.test.ts) cover physical hardware identity, rails, and measured mesh placement.
- [`custom-outline.test.ts`](../src/lib/custom-outline.test.ts), [`panel-shape.test.ts`](../src/lib/panel-shape.test.ts), and [`scene-geometry.test.ts`](../src/components/scene-geometry.test.ts) distinguish persisted outline rules from rendered cut geometry.

## Build space

Build space is optional and saved as `Project.spaceConstraint` (enabled, width, height, depth, centerX, centerZ in millimeters). Legacy projects omit it. The box rests at world Y = 0; its X/Z center is configurable. All constraints opens its dimension draft form; Save build space commits dimensions once through history. Enable build space commits immediately using saved dimensions (or initial defaults), preserving unsaved dimension drafts. Each toggle is undoable; an invalid enable leaves the checkbox off and explains the conflict. An enabled box must contain the existing panels before it can be saved. Disable retains its dimensions. Undo/redo, autosave and project export retain it; standalone assembly files do not include it.

Resolved rectangular panel bounds, including hidden/rotated/custom-outline stock, determine containment. Hardware and accessories are excluded. The final constraint guard preserves omitted settings in reconstructed candidates and rejects new or worsened violations per panel and face; imported violations remain inspectable and can improve. Structure editing checks candidates so resize previews stop at the boundary. Studio draws the box (hidden in realistic preview and exploded view), highlighting edges within 10 mm of stock and labeling boundary contact or imported violations.

### Additional hardware between selected pieces

`connector-infill.ts` adds evenly spaced matching hardware between two physical endpoints on the same panel pair and straight rail. It appends indices to the first connection (maximum 20) and compensates all existing slides for the changed default spacing, preserving identities, removal overrides, groups, and world placement. Endpoint type, material, and color must match. CAD-envelope clearance checks reject any quantity requiring displacement from equal spacing; TROFAST clearance is also checked. Managed assembly joints require disassembly before changing their quantity. No saved fields or parser defaults change. The inspector and context menu share a quantity dialog; acceptance checks the source snapshot and commits one undoable edit.

### Connector overlap repair

`connector-clearance.ts` uses swept separating-axis intervals for conservative CAD-part envelopes. Auto-connect and interior T splits fit new hardware against retained pieces, including hidden hardware and per-piece types/slides, and retry with one clamp if two cannot fit. Blocked joints are skipped without committing their candidate. The preview context menu can repair selected overlapping pieces using the same solver; unselected and non-overlapping hardware remains fixed. It tries preferred positions, alternate rail orders, and packing from either end. This bounded search may miss feasible arrangements; failure leaves the entire project unchanged. Slides use existing per-piece overrides, preserve joint and assembly identities, and are checked against TROFAST inserts. No schema changes are required.

### Object conversion transaction

[`object-conversion.ts`](../src/lib/object-conversion.ts) converts selected top-level objects whose evaluated results are solid cuboids, single rectangular tunnels or blind recesses, corner-cut cuboids, three-axis crosses, or common-depth orthogonal prisms into ordinary furniture. Only selected trees are evaluated, regardless of root visibility; hidden operands retain their Boolean meaning. The evaluator counts occupied coordinate cells against the integer cell range spanned by the result, avoiding volume tolerances that could erase small cavities. A fully occupied cuboid uses the six-panel solver. Other results are checked for the supported orthogonal-prism family. Quarter-turn boxes and Boolean results use their exact evaluated world-axis bounds. It preserves the requested panel envelope, applies panel/connector appearance, and appends fresh identities while retaining existing parts, joints, overrides, assemblies, and constraints. It validates the saved contract, all diagnostics involving generated panels, added hardware clearance, cross-boundary hardware/stock clearance, TROFAST inserts, and design/build-space rules. Hidden existing stock also blocks conversion. Cross-boundary hardware checks use conservative per-part CAD boxes and rectangular panel stock; they may reject placements through custom cutouts. Existing unrelated diagnostics do not block acceptance.

The result retains and hides all selected source roots, with no saved regeneration relationship. A repeat conversion in the same place fails collision checks. Empty results, unsupported concave shapes, enclosed cavities, multiple/non-rectangular tunnels, nested operand selections, partial shared faces, and incomplete or three-dimensional compartment grids are explicitly unsupported; no partial layout is returned. Touching/coincident cuboid unions generate one shell without internal walls. Intersection and trimming subtraction may shrink the envelope; source/cutter bounds never substitute for result bounds.

[`object-prism.ts`](../src/lib/object-prism.ts) recognizes common-depth orthogonal prisms along any world axis using exact occupancy columns and a single orthogonal boundary with 6–12 corners. Every occupied column must have the same contiguous extrusion interval. Multiple loops, point-touching components, cavities, and changing depth are excluded. [`object-prism-solver.ts`](../src/lib/object-prism-solver.ts) offsets that boundary inward by half the stock thickness, subtracts measured seats from each rim cut, and fits both closing faces through the existing custom-outline closure commands. It requires one rim joint and two closure joints per boundary edge with installed 90° hardware, then checks validation, hardware clearance, and the conversion envelope. Narrow arms or steps may be rejected when cuts or hardware cannot fit. An N-edge result has N + 2 panels and 3N structural joints. U profiles and stepped profiles are covered at all supported stock thicknesses and quarter-turn orientations. Closure joint fitting checks the finite shared edge span before selecting an outline edge, so separate collinear edges (such as the two tops of a U) cannot be confused. Existing collision checks remain conservative around custom-outline stock bounds, including the L notch.

`object-compartments.ts` supports straight rows of cuboids with matching full faces on any world axis, including unequal lengths along the row. Each provisional cuboid extends half a stock thickness across each shared source plane, producing coincident divider stock that is retained once. A row of N cuboids produces 5N + 1 panels and 12N serialized connections. All hardware is fitted on the combined layout, requiring coverage of every original adjacent-face pair plus four complete T joints on each of the N − 1 dividers. Stock must be 18–19 mm. The combined outside envelope stays fixed; end compartments lose one exterior thickness plus half a divider thickness along the shared axis; middle compartments lose two half-divider thicknesses. Unshared axes lose two exterior thicknesses. Metal appearance is normalized to plastic for T joints.

Separated roots are solved independently and appended atomically, with hardware/stock checks between generated groups as well as against existing furniture. Source bounds that overlap or touch ambiguously are rejected conservatively, including profile-notch cases. Each supported touching component forms a straight row or a complete rectangular grid with common depth. Missing cells, three-dimensional arrays, and partial shared walls remain unsupported. A failure in any group returns no candidate. Selection-wide evaluator and project limits still apply, with aggregate panel and connection counts checked before solving.

`object-solids.ts` splits disconnected Boolean results by exact face connectivity during conversion only. Each occupied component is classified using its own coordinate-cell bounds; cavities are retained, and edge/corner contacts do not merge components. Cropped prism classification is bounded to 100,000 cells per root and component count to 33 before hardware fitting; aggregate project limits still apply. Each piece gets its own shell and review entry, while acceptance hides the original selected root once. All pieces participate in existing collision and hardware checks; one failure rejects the whole transaction. Conservative bounds can still reject components nested in another profile’s notch. Interactive surface previews retain one mesh and selection identity per root.

`object-grid.ts` recognizes complete rectangular compartment grids on any pair of world axes, including unequal row/column sizes. Source bounds must occupy every cell of one aligned coordinate lattice, with one common interval on the depth axis. Edge contacts are allowed only within that complete grid; disconnected edge/corner contacts still reject conversion. Provisional cuboids extend half the stock thickness across each shared face, then coincident divider panels are retained once. Hardware fitting must cover every original adjacent-face pair, every interior four-panel cross joint, and every boundary three-panel T joint. Closing faces use fitted T or paired 90° joints as clearance permits. An X-by-Y grid has `6XY − ((X−1)Y + X(Y−1))` panels and `12XY − (X−1)(Y−1)` serialized connections. Counts are checked before solving, and the completed candidate must match them. Each axis's clear interior subtracts one stock thickness per exterior face and half a thickness per shared face. Metal appearance applies only to 90° hardware. The solver validates the full construction, hardware overlaps, and unchanged outside envelope before conversion can commit it.

The optional conversion setting `rectangularOnly` defaults to false. When enabled, `rectangular-closures.ts` partitions each fitted prism closing outline into axis-aligned strips, merging adjacent equal intervals. It tries both strip orientations. A U can produce two full-height side rectangles and one shorter middle rectangle per face. Sub-micron fitting roundoff is coalesced at 0.0001 mm to avoid artificial slivers. Pieces cover the fitted outline and meet without connectors at internal seams. Every piece must fit the 40–4000 mm cut limits, attach to at least two distinct original rim walls, and carry installed 90° hardware on every overlapping boundary segment. No internal walls are introduced. A failed layout is discarded before trying the alternate orientation; failure of both rejects the complete conversion. Hardware fit, geometry validation, final aggregate project limits, and the outside envelope remain mandatory. A final guard rejects custom outlines among generated panels. Existing custom panels and the saved project format are unchanged.

`object-tunnel.ts` recognizes a cuboid whose missing coordinate cells form exactly one rectangular prism spanning two opposite faces and lying strictly inside the other four faces. Integer cell counts prevent small cavities, additional openings, and stepped passages from being mistaken for one tunnel. Classification also applies to disconnected components. `object-tunnel-solver.ts` builds four outer walls and four inner walls, placing the inner stock outside the requested passage. Each end closes with four ordinary rectangular pieces attached to the rims; bare seams need no connectors. All 32 required 90° joints must carry hardware, yielding 16 panels. The converter checks those counts against project limits before fitting, then checks collisions, hardware clearance, and the unchanged outside envelope. Off-center openings and all three world axes are supported at 16–19 mm thickness. Both settings of Rectangular panels only produce the same rectangular layout. Passage dimensions describe stock faces and exclude projecting hardware. Enclosed cavities, multiple/non-rectangular tunnels, and narrow rings without room for cuts or hardware remain unsupported.

The rectangular-void classifier also recognizes blind recesses: exactly one outer face meets a rectangular empty region, whose other five bounds remain inside the source box. `findObjectRecess` keeps enclosed cavities and irregular pockets distinct. `solveObjectRecess` uses the opening solver with one entry face, retains the outer back, and places an inner back panel outside the requested empty depth. Four front closing pieces join the inner and outer walls into one connected construction with 14 panels and 28 installed joints. Before closing, hardware/stock clearance is checked between the inner and outer shells; insufficient space behind the inner back rejects conversion. Recesses can enter from any of the six world-axis faces and use 16–19 mm stock. The panel contract, history boundary, and rectangular-only behavior are unchanged. This is a bounded differing-depth family; fully enclosed cavities and general varying-depth compositions are still unsupported.

`object-conversion-diagnostics.ts` carries transient `ObjectConversionError` regions through the worker. Unsupported evaluated pieces, conflicting source pairs, and group-solving failures provide their affected bounds and names; global candidate checks fall back to all selected roots. The diagnostic preview evaluates selected roots with display visibility enabled while preserving hidden operand semantics. Empty results and complexity failures use source bounds; failed diagnostics do not replace the original error. Regions locate affected source volumes, not exact faulty joints or collision intersections. Diagnostic data contains source surfaces and bounds only, never a partially generated furniture candidate, and cannot be accepted or persisted.

`object-notches.ts` recognizes a bounded changing-depth family after the existing prism/opening classifiers: up to four face-disconnected rectangular empty regions, each meeting exactly one exterior face on each axis (a corner cut). Cavities, irregular joined voids, and edge slots are excluded. `object-notch-solver.ts` extracts simple boundary loops of at most twelve edges per face, offsets panel planes into the solid, and trims cuts using convex/concave connector seats. The initial layouts partition each face into rectangles; eight combinations of strip directions across world axes are tried. Internal seams carry no hardware. In those initial layouts every boundary segment needs an attachment, every piece needs at least two neighboring faces, and the entire shell must be connected. Hardware fitting prefers two clamps and can retry with one per joint. Cut limits, validation, hardware overlap, aggregate project limits, and the outside envelope remain mandatory. Both rectangular-only settings prefer this rectangular layout; narrow cuts can use the bounded fallback described under stepped solid shells below. Source objects remain hidden after acceptance; no saved schema or live regeneration link is added. Three-axis crosses reuse this shell builder as described below; other changing-depth shapes remain unsupported.

### Three-axis cross shells

[`object-cross.ts`](../src/lib/object-cross.ts) recognizes a rectangular core with three to six full-face arms extending along all three world axes. It matches every occupied coordinate cell against the core-and-arms pattern, excluding cavities, bent arms, and partial-face branches. Recognition is per connected solid and does not depend on the source Boolean tree's operand order. Coordinate planes differing only by machine roundoff at the source bounds' scale are merged during evaluation; real small gaps and cavities remain distinct.

The shared `solveObjectShell` in [`object-notch-solver.ts`](../src/lib/object-notch-solver.ts) constructs both corner-cut and cross shells. It separates coplanar exposed patches by edge connectivity before tracing each boundary, so arm faces touching only at a vertex remain separate. Faces must have one simple loop with at most twelve edges. The existing convex/concave seat offsets, rectangular face partitions, minimum two neighboring faces per board, connected-shell check, required boundary joints, hardware fitting, and envelope validation still apply. Rectangular seams have no hardware between coplanar pieces. General changing-depth shapes remain unsupported.

[`object-cross.test.ts`](../src/lib/object-cross.test.ts) covers the supplied five-arm fixture at 16–19 mm stock in quarter-turn orientations, all three-to-six-arm variants, containment within the source union, hardware/validation checks, serialization, and invalid/narrow shapes. The browser conversion test imports the fixture, previews and accepts it through the worker, then verifies undo/redo and reload.

### Stepped solid shells

`object-stepped.ts` adds a conversion-only fallback for height fields along any world axis, with either direction as the base. Every occupied column must have one contiguous interval and all columns must share the same starting (or ending) plane. This recognizes stepped crosses and terraces independently of operand order or source-box decomposition. It is a candidate classification, not a guarantee of manufacturability: `solveObjectShell` still rejects face holes, non-simple boundaries, faces above twelve edges, undersized cuts, incomplete joints, disconnected shells, and hardware collisions. Rectangular layouts are preferred; the shell fallback described below can use fitted outlines when rectangular-only is off. Existing special-family solvers retain priority; no saved fields change.

The supplied stepped-cross fixture now converts at its original dimensions at 16–19 mm stock. The original all-connector layout leaves 28.3 mm cuts at 18 mm, but this is a layout restriction, not proof that the source must be widened. After the original layouts fail, the shell solver retries narrow rectangular cuts with paired bare butt seams on matching convex face edges: the narrow face reaches the original outside plane and its neighbor stops one thickness short. Matching whole edge endpoints are required; unmatched or partially shared edges are not modified. Both faces retain their original planes and source envelope.

When rectangular-only is off, the bounded search also tries keeping nonrectangular faces on combinations of world axes as fitted custom outlines, avoiding narrow or disconnected strip partitions. Only edges with the measured connector-seat spacing and at least 40 mm shared length become hardware candidates. Butt-seam layouts need not attach every boundary segment, but the preferred layouts still attach every panel to at least two distinct neighbors. If those fail, convex rectangular faces lying on a solid’s outside bounds may attach to one neighbor as end caps; other faces still need two. The hardware graph must remain connected. Clearance fitting first reduces clamps to one and tries the existing alternative rail orders and end packing. A blocked redundant 90° joint, or a redundant joint sharing one of its panels, can then be omitted only if support counts and graph connectivity remain valid. All retained joints must have installed hardware, and validation, hardware collision, project limits, and the outside envelope are still checked. The 40–4000 mm cut limits and saved format are unchanged. Rectangular-only failures suggest allowing outline faces.

Regression coverage exercises the original and larger versions at 16–19 mm in all quarter-turn orientations, verifies stock containment against exact occupancy (including custom outlines), envelope preservation, connected hardware, serialization, and source immutability. Browser coverage converts the unchanged fixture, checks the rectangular-only failure, and verifies undo/redo and reload. These bounded layouts do not guarantee fabrication or support every height field.

Repeated subtractions can require fitted faces on perpendicular axes. The shell search tries all eight axis subsets, preferring rectangles and then one-axis outlines. Outline-to-outline joints remain unsupported; these faces attach through rectangular boards. On shaped faces, narrow-cut relief stops once the strip reaches 40 mm, preserving remaining hardware seats; rectangular end caps may meet both ends without corner hardware. This avoids discarding unnecessary supports while fitting narrow return walls.

`object-shell-orientation.ts` supplies up to 23 alternative proper quarter-turn frames after the direct search fails. Coordinate cells are permuted and reversed exactly, without resampling or changing source dimensions. Solved positions and rotations are mapped back; local joints, outlines, and hardware overrides retain their meaning. This bounded retry avoids rejecting a layout solely because the world axes changed the greedy construction order. Existing final conversion validation still applies. No saved format changes are needed.

The transient conversion result reports `singleSupportPanelIds` for newly generated panels attached to one neighbor. The preview explicitly lists their count before acceptance. `double-stepped-object.json` covers the second reported subtraction; tests exercise rotations, thicknesses, rescaling, nearby cutter placements, exact stock containment, support counts, connected hardware, unchanged source data, and reload through the real browser workflow. End-cap attachment is a geometric fit, not a load-capacity calculation.


### Early object clearance warnings

While editing Objects, amber surface highlights and focusable warning icons identify narrow sections of the evaluated solid. Hover or focus an icon for details. The early check flags continuous solid spans below 91 mm (40 mm minimum panel cut, 16 mm stock, and two measured 17.5 mm connector seats), including Boolean remnants; operand subdivisions alone do not trigger it. It is advisory: fitted-face exceptions may work, and wider sections can still fail hardware clearance. Convert to panels performs the full check for the chosen thickness. Warnings update with drafts and gestures, remain outside saved projects, and disappear outside Objects mode. The bounded `object-clearance.ts` sweeps use occupied coordinate-cell runs on all three axes; they do not infer actual connector placements or inspect gaps between separate roots.

Resize-handle availability retains both failed ±1 mm probes as transient diagnostics. `StructureEditError` carries panel and connection identities for cut limits, validation failures, support contacts, and incompatible solver equations; residual equations identify implicated panels and their shared joints, rather than claiming a unique minimal blocking set. Handles map structural connections to installed physical pieces for hover highlights. These diagnostics do not change edit acceptance or saved formats.
