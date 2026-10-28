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

- Start with a shelf, desk, display, or blank project.
- Add your own panels with dimensions in millimeters, material, finish color, and thickness. Choose solid, pegboard, or rounded slots; holes are real openings through the mesh.
- Select a panel in the model or panel list. Change dimensions, position, and orientation in the inspector.
- Shift-click, Ctrl/⌘-click, or use the panel checkboxes to select multiple panels. Shared parameters stay editable and apply to the entire selection; differing values show **Mixed** and are disabled. Related edits preserve mixed finishes and perforation spacing. Select all with **⌘/Ctrl A**.
- Choose **Attach** to connect a new or existing panel to any of six sides. Explore 90°, 105°, 150°, T, and cross joints, offsets, insets, flip direction, connector color, and quantity. Ghost previews update as settings change.
- T and cross joints add the complete set of branches. Changes to a parent propagate to its connected descendants. Detaching preserves world positions.
- Thickness and shared-edge errors block new attachments. Panel overlaps, inaccessible clamp positions, and supports that have moved out of alignment appear as review notes.
- Orbit, pan, zoom, inspect orthographic views, show dimensions, and explore the exploded view. Export editable JSON or a CSV cutting/parts list.

Keyboard: **F** fits the view; **⌘/Ctrl Z** undoes; **⌘/Ctrl Shift Z** redoes; **⌘/Ctrl D** duplicates; **Delete** removes a panel; **Escape** cancels selection/preview. Text fields retain normal editing shortcuts.

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

Angled connectors accept 16–19 mm panels. T/cross use the current product page's 18–19 mm range; the older technical PDF lists 17–19 mm. The drawings specify 40 mm depth along the joint and 35 mm spans for the 90° profile. Displayed clamp jaws use these nominal dimensions.

Connector meshes are **schematic**, not manufacturer CAD. The common 8.5 mm clearance is a drawing-based approximation, particularly for non-90° joints. Molded profiles, screw seats, manufacturing tolerances, actual clamp reach, material strength, load capacity, and cut-through interference with connectors are not simulated. Front/back attachment previews may require an accessible edge. Starter assemblies are editable design studies, not certified construction plans. Check physical clearances against the official drawings before fabrication.

The app stores panels in local XY coordinates, with thickness on local Z. Project values are millimeters and Euler radians; the renderer converts to meters. Connections form a directed attachment tree, with optional non-driving supports for additional hardware between already positioned panels.

## Source map

- `src/App.tsx`: workspace and editing flows.
- `src/lib/model.ts`: attachment geometry, validation, templates, imports, and parts export.
- `src/components/Scene.tsx`: cameras, materials, connectors, selection, and 3D rendering.
- `src/components/scene-geometry.ts`: solid/perforated panel geometry.
- `src/components/ui/`: editable shadcn-style Radix primitives; aliases in `components.json`.
- `src/hooks/use-project.ts`: undo/redo and browser-local persistence.
