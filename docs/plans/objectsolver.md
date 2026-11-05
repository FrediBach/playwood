Object Solver

Idea: Let's add a new way to construct furniture in this project, with an object solver. Basica idea: The user constructs a 3D object with 90° angled objects (different sized boxes, combined with boolean logic), than let the solver convert it into panels and connectors. To make openings, he can than remove panels. The boxes should be blue, semi transparent in the preview, and not visible in the realistic preview. The user should be able to move, scale, rotate etc. the rectangular box objects, freely combine them with boolean logic and than select all of them he wants to convert. Let's first create a plan.

Overview:

- Boxes move and resize freely, with **90° rotation steps**.
- Dimensions describe the **finished outside dimensions**.
- **Union removes internal walls**. Separate boxes preserve compartment boundaries.
- Construction objects appear **blue and translucent in Studio**, and disappear entirely in Realistic preview.

The proposed user workflow:

1. **Add and arrange boxes.** Enter width, height, depth and position; use move/resize handles, snapping, keyboard movement, duplication and multiselection. Transform selected boxes together.
2. **Combine shapes.** Select objects and choose **Union**, **Subtract**, or **Intersect**. A tree in the Objects list shows nested operations and makes subtraction order explicit. Original boxes remain editable.
3. **Review the shape.** Display the evaluated result in translucent blue. Selected operands—including subtraction cutters—remain accessible through outlines and the object tree.
4. **Convert selected objects.** Choose panel thickness, material, finish and connector appearance, then inspect the proposed panels, hardware, dimensions and any problems.
5. **Accept and refine.** Conversion creates ordinary panels and connectors. Remove panels using the existing commands to make openings, then continue editing normally.

I recommend retaining the source objects and hiding them after conversion. Initially, generated furniture should be independent of those sources: changing a box would not rebuild furniture or restore panels the user deliberately removed. Live regeneration can follow later with explicit rules for preserving manual edits.

The implementation plan has six stages.

1. **Prove the physical conversion first.**

   Start with a closed cuboid at specified outside dimensions. Generate all six panels, fit actual connectors, validate clearances, and verify that removing a face leaves a usable construction.

   Existing tests already cover six-panel box construction and fitted L-shaped closing panels. The next proof should be a complete L-shaped object, including its corner hardware and both closing faces.

   This establishes the solver’s dimensional rules before building the full interface. Connector gaps and panel thickness must be calculated together; surface extraction alone cannot determine the final boards.

2. **Add a saved construction-object model.**

   Add an optional object tree to [types.ts](/Users/fredibach/Projects/playwood/src/lib/types.ts), containing box dimensions, transforms, stable IDs, names and Boolean operations.

   Preserve `Project.version: 1` and the current storage key. Extend parsing to validate dimensions, references, operation order, tree depth and complexity limits. Older projects simply contain no objects.

   Object edits participate in undo/redo, autosave and project import/export. Duplication and copy/paste remap IDs. Construction objects stay outside parts lists, cutting exports and standalone panel-assembly files.

3. **Build object editing and Boolean previews.**

   Add an Objects list, object inspector and dedicated scene layer. Keep gesture handling in focused hooks rather than expanding `App.tsx` with geometry logic.

   Object editing needs deliberate selection routing so translucent volumes do not intercept panel editing. Include box selection, group transforms, exact numeric controls, snapping, Escape cancellation and one undo step per completed gesture. Camera framing must also work for projects containing only objects.

   For Boolean evaluation, use the boxes’ coordinate planes to divide space into exact rectangular regions. This avoids a coarse voxel resolution and suits the agreed orthogonal geometry. Run expensive evaluation in a worker with cancellation and complexity limits.

4. **Build the panel-and-connector solver.**

   The solver should:

   - Evaluate the selected Boolean trees and identify surfaces, cavities and disconnected components.
   - Choose panel layouts, preferring whole rectangles and supported custom outlines.
   - Calculate panel cuts and placement from the requested envelope, thickness and connector profiles.
   - Fit appropriate 90°, T and cross joints, then place physical hardware with clearance checks.
   - Verify both geometric validity **and that every required joint was actually created**.

   Reuse the existing connector profiles, closure fitting, clearance checks and validation. [Auto-connect](/Users/fredibach/Projects/playwood/src/lib/auto-connect.ts) is useful here, but it can skip joints that do not fit; it cannot serve as the complete solver.

   Support should expand through tested shape families: cuboids, common-depth L/U/stepped shapes, then differing-depth compositions, tunnels and internal cavities. Some layouts require extending custom-outline joint support.

   A key constraint is that the connector catalog has no simple straight connector for joining two coplanar tiles. Arbitrarily splitting every surface into rectangles can therefore produce an unbuildable result. The solver must try another layout or highlight the unsupported region.

5. **Define compartments and conversion transactions.**

   Multiple selected independent objects remain separate compartments unless explicitly unioned. At compatible shared boundaries, the solver should generate one dividing wall. Clear compartment dimensions are then derived from that wall’s thickness while preserving the combined outside envelope. Overlapping independent objects need an explicit Boolean operation to resolve their meaning.

   Conversion previews show generated panels, actual hardware counts, achieved dimensions and highlighted failures. Existing furniture participates in collision checks; conversion should not silently resize or attach it.

   Accept commits the complete result once through [useProject](/Users/fredibach/Projects/playwood/src/hooks/use-project.ts). Cancel changes nothing. Editing the project or inputs invalidates an outdated solver result. Dimensions must not silently change to make a solution fit.

6. **Verify the complete workflow and document it.**

   Geometry coverage should include Boolean operations, touching/coincident boxes, empty results, shared walls, concave shapes, thickness and connector gaps, hardware collisions, unsupported seams and project limits.

   Browser coverage should exercise object transforms, multiselection, cancellation, conversion, panel removal, undo/redo, reload, export/import, narrow layouts and the absence of construction objects from Realistic preview.

   Run relevant Vitest coverage, the build, React Doctor and focused Playwright workflows, then broader suites for integration. Update the domain, state and rendering documentation plus the README and illustrated guide.

The first implementation milestone would be **one editable blue box → validated six-panel construction → remove a panel → undo and reload correctly**. That provides a complete foundation for Boolean modeling and increasingly capable conversion.