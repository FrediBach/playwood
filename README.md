# Playwood Studio

A local, full-window furniture design workspace built with Vite, React, TypeScript, Three.js, React Three Fiber, and shadcn/ui components backed by Radix. Warm neutral colors, restrained controls, and independent scrolling inspectors keep the assembly in view.

## Run

Requires Node.js 22.12+ (tested with Node 25).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. No accounts, API keys, backend, or external fonts are required. Projects autosave in this browser's local storage; export a JSON project to keep a portable copy.

## Design workflow

- Start with a shelf, desk, display, a resource example from the Library, or a blank project.
- Add your own panels with dimensions in millimeters, material, finish color, and thickness. Choose solid, pegboard, or rounded slots; holes are real openings through the mesh.
- Select a panel in the model or panel list. Change dimensions, position, and orientation in the inspector.
- Drag a panel thumbnail to reorder the list. Hover or focus a row for rename, visibility, and remove controls; double-click a name to rename it in place. Amber markers identify overlaps and name the other panels on hover or focus. These changes autosave and support undo.
- Shift-click, Ctrl/⌘-click, or use the panel checkboxes to select multiple panels. Shared parameters stay editable and apply to the entire selection; differing values show **Mixed** and are disabled. Related edits preserve mixed finishes and perforation spacing. Select all with **⌘/Ctrl A**.
- Choose **Attach** to connect a new or existing panel to any of six sides. Explore 90°, 105°, 150°, T, and cross joints, offsets, insets, flip direction, connector color, and quantity. Ghost previews update as settings change.
- T and cross joints add the complete set of branches. Changes to a parent propagate to its connected descendants. Detaching preserves world positions.
- The Everyday shelf uses eight 90° connectors at its corners and four T connectors at the middle shelf. Each side has separate lower and upper panels with the 35 mm gap required by the T body. Recognized copies of the former five-panel template are repaired on load/import while preserving finishes, names, shelf positions, and overall dimensions; the load repair supports Undo.
- Thickness, shared-edge, and embedded edge-joint errors block new attachments. Panel overlaps, inaccessible face clamp positions, and supports that have moved out of alignment appear as review notes. The inspector and parts list identify the actual connector types.
- Orbit, pan, zoom, inspect orthographic views, show dimensions, and explore the exploded view. Export editable JSON or a CSV cutting/parts list.
- Choose **Realistic preview** to see your assembled furniture at its actual scale in a modern room with daylight, oak flooring, and familiar furnishings. The 165 cm floor lamp provides a size reference; dimensions describe the visible assembly. Orbit and zoom to explore, press **F** to reset the room view, and return to **Studio** (or press **Escape**) to resume editing with your selection and view settings preserved. The room renders locally without external assets or API keys.

Keyboard: **F** fits the view; **⌘/Ctrl Z** undoes; **⌘/Ctrl Shift Z** redoes; **⌘/Ctrl D** duplicates; **Delete** removes a panel; **Escape** cancels selection/preview. Text fields retain normal editing shortcuts.

In the panel list, **F2** edits a focused name. Focus a thumbnail and press **Space** to pick it up, **↑/↓** (or **Home/End**) to choose its position, then **Space/Enter** to drop or **Escape** to cancel. Renaming accepts **Enter** to save and **Escape** to cancel.

## Resource examples

The Library and Templates chooser include 22 resource examples alongside the three original starters. Search or filter by category to find editable assemblies from `resources/library-3d`. Numbered CAD resources supply the totem, corner, shelf with doors, H-table 180, and promotional desk. The collection PDFs add shelves, tables, counters, a bench, a trade fair display, an island display, and individual exhibition plinths. Each thumbnail is generated from the assembly it opens; switching examples supports Undo.

Repeated plans across room collections appear once. The workshop-table PDF's H-table and cube are separate examples, as are the three closed plinths and the open tall and wide plinths. The open cube uses the same example as the standalone cube. The workshop table with shelves and Organizer Workstation 08 are the same build. The shelf with six doors and reception counter with four doors remain separate variants.

Examples preserve the supplied panel dimensions and connector layouts where available. The Totem retains the source panel sizes and connector quantities, but centers its deeper base beneath the stack instead of extending it forward; its clamp distribution is adapted to the editor's shared-joint geometry. The corner booth uses square panel corners in place of the source's rounded corners. Dividers, doors, and printed inserts are simplified accessories; their custom slots, folds, hinges, and print artwork are not fabrication geometry. The open-plinth plan's printed parts list disagrees with its drawing: its three four-panel frames require eight 350 × 350 mm panels and four 735 × 350 mm panels. Those examples follow the depicted frames. The supplied Bizu stool, Nordic chair, and Lean table use other construction systems and are excluded from the connector library. Printing templates and artwork instructions are supporting resources, not additional builds.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite starts/reuses port 5174. An existing Chromium binary can be selected through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Tests cover attachment transforms, all six sides, offsets and angles, shared joints, existing-panel reattachment, import validation, actual hole/slot geometry, browser persistence, exports, undo/redo, and fixed-viewport layouts.

## Geometry and source references

Manufacturer references:

- [Connector range and current thickness limits](https://www.playwood.it/en/diy-wooden-projects-connectors/)
- [Official metric technical drawings](https://www.playwood.it/site/assets/files/18237/technical_information_playwood_connectors.pdf)
- [Manuals and project inspiration](https://www.playwood.it/en/business-page-landing-post-login/manuals-catalogs/)

Angled connectors accept 16–19 mm panels. T/cross use the current product page's 18–19 mm range; the older technical PDF lists 17–19 mm. The supplied connector models have a 40 mm depth along the joint.

Connector meshes use the supplied CAD export in `resources/connectors-3d/Connettori sharing.obj`, including the distinct 90°, 105°, 150°, T, and cross profiles and their separate clamp parts. The original OBJ, 3DS, and STEP files are retained in `connectors-3d`; the OBJ is bundled locally, with no external model requests. The geometry is shared across connector instances and used in the studio, attachment previews, and room preview. Panel spacing follows the shoulders in each connector profile, including the continuation branches of T/cross joints. The supplied models depict nominal 18 mm slots and do not include separate screw geometry. Manufacturing tolerances, tightening, material strength, load capacity, and cut-through interference with connectors are not simulated. Front/back attachment previews may require an accessible edge. Starter assemblies are editable design studies, not certified construction plans. Check physical clearances against the official drawings before fabrication.

The app stores panels in local XY coordinates, with thickness on local Z. Project values are millimeters and Euler radians; the renderer converts to meters. Connections form a directed attachment tree, with optional non-driving supports for additional hardware between already positioned panels.

## Source map

- `src/App.tsx`: workspace and editing flows.
- `src/lib/model.ts`: attachment geometry, validation, templates, imports, and parts export.
- `src/lib/example-library.ts`: shared example catalog and resource references.
- `src/lib/cad-examples.ts`: editable assemblies based on the numbered CAD resources.
- `src/lib/pdf-examples.ts`: editable assemblies based on the collection plans.
- `src/lib/platform-examples.ts`: workshop table and tiered island assemblies.
- `src/components/ExampleBrowser.tsx`: resource example selection and previews.
- `src/lib/legacy-shelf.ts`: conservative repair of the original shelf's embedded middle connectors.
- `src/components/Scene.tsx`: cameras, panel materials, selection, and 3D rendering.
- `src/components/ConnectorMeshes.tsx`: placement and materials for the supplied connector models.
- `src/components/connector-geometry.ts`: imported connector parts, source normalization, and shared mesh geometry.
- `src/components/RoomEnvironment.tsx`: room architecture, furnishings, procedural materials, and lighting for realistic preview.
- `src/components/scene-geometry.ts`: solid/perforated panel geometry.
- `src/components/ui/`: editable shadcn-style Radix primitives; aliases in `components.json`.
- `src/hooks/use-project.ts`: undo/redo and browser-local persistence.
