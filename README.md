# playwood. APP

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
- Choose **Create custom outline** in the panel inspector to open the vector editor. Drag points, double-click an edge (or use **Add point**) to insert a vertex, or enter exact X/Y coordinates in millimeters from the top left. Grid snapping, Shift to lock a drag axis, Alt to bypass snapping, arrow-key nudging, zoom/pan, and local undo/redo support precise edits. **Apply outline** saves one project edit; **Cancel** discards the draft. Outlines scale with panel width and height, and corner radius rounds both outward and inward corners. The inspector shows the finished shape; **Reset to rectangle** removes the custom outline. Project files retain the normalized vertices and cutting lists export their millimeter coordinates. Connector placement and overlap checks still use the panel’s rectangular bounds; automatic rectangular splitting is unavailable for custom outlines.
- Select a panel in the model or panel list. Change dimensions, position, and orientation in the inspector. Width and height edits apply on Enter or when leaving the field; connected panels adjust together to keep their joints aligned.
- Click a panel in the Studio or Realistic preview and use **arrow keys** to move it **1 cm**, or **Shift + arrow keys** for **10 cm**. Movement follows the current view and the panel’s rotated axes, including after orbiting behind or above the assembly. Connected panels resize while connector angles, thicknesses, and hardware sizes stay fixed. A move that cannot preserve the joints or panel limits leaves the project unchanged and explains why. Free panels and fully selected assemblies translate together. Holding a key forms one undo step. Arrow shortcuts are active only while the canvas has focus; fields and panel-list controls retain their own keys. Finish an attachment or close exploded view before moving panels.
- Press **X**, **Y**, or **Z** to rotate a selected panel or complete assembly by **90°** around that world axis through the selection’s center. Multiple selected objects turn together. Select all physically connected panels or detach them first; a partial connected selection stays unchanged and explains why. Each press is one undo step, with autosave and redo support. Rotation shortcuts pause during text editing, dialogs, attachment previews, dragging, assembly source editing, and exploded view.
- Drag a panel thumbnail to reorder the list. Hover or focus a row for rename, visibility, and remove controls; double-click a name to rename it in place. Amber markers identify overlaps and name the other panels on hover or focus. These changes autosave and support undo.
- Shift-click, Ctrl/⌘-click, or use the panel checkboxes to select multiple panels. Shared parameters stay editable and apply to the entire selection; differing values show **Mixed** and are disabled. Related edits preserve mixed finishes and perforation spacing. Select all with **⌘/Ctrl A**.
- Choose **Attach** to connect a new or existing panel to any of six sides. Explore 90°, 105°, 150°, T, and cross joints, offsets, insets, flip direction, connector color, and quantity. Ghost previews update as settings change.
- T and cross joints add the complete set of branches. Changes to a parent propagate to its connected descendants. Detaching preserves world positions.
- The Everyday shelf uses eight 90° connectors at its corners and four T connectors at the middle shelf. Each side has separate lower and upper panels with the 35 mm gap required by the T body. Recognized copies of the former five-panel template are repaired on load/import while preserving finishes, names, shelf positions, and overall dimensions; the load repair supports Undo.
- Thickness, shared-edge, and embedded edge-joint errors block new attachments. Panel overlaps, inaccessible face clamp positions, and supports that have moved out of alignment appear as review notes. The inspector and parts list identify the actual connector types.
- Use **Rotate creation** above the canvas to rotate the whole assembly by ±90° or ±45°. Choose Z to tilt sideways into a diagonal layout, X to tip forward/backward, or Y to turn left/right. Every panel (including hidden panels and separate pieces) and connector moves together around the assembly center; its lowest panel height stays unchanged. Rotation autosaves, supports undo/redo, and is preserved in exported projects and the room preview.
- Orbit, pan, zoom, inspect orthographic views, show dimensions, and explore the exploded view. Export editable JSON or a CSV cutting/parts list.
- Choose **Realistic preview** to see your assembled furniture at its actual scale in a modern room with daylight, oak flooring, and familiar furnishings. The 165 cm floor lamp provides a size reference; dimensions describe the visible assembly. Orbit and zoom to explore, press **F** to reset the room view, Click a panel and use arrow keys to adjust it here, or return to **Studio** (or press **Escape**) for the full inspector with your selection and view settings preserved. The room renders locally without external assets or API keys.

Keyboard: **Arrows** move the preview selection 1 cm; **Shift + arrows** move 10 cm; **X / Y / Z** rotate the selection 90°; **F** fits the view; **⌘/Ctrl Z** undoes; **⌘/Ctrl Shift Z** redoes; **⌘/Ctrl D** duplicates; **Delete** removes a panel; **Escape** cancels selection/preview. Text fields retain normal editing shortcuts. The keyboard button beside the view controls opens the navigation and selection shortcut reference.

In the panel list, **F2** edits a focused name. Focus a thumbnail and press **Space** to pick it up, **↑/↓** (or **Home/End**) to choose its position, then **Space/Enter** to drop or **Escape** to cancel. Renaming accepts **Enter** to save and **Escape** to cancel.

## Reusable assemblies

Build a box once and reuse its construction as linked instances. Select the box's panels, enter an **Assembly name**, and choose **Create assembly**. The selected panels become its first instance, and the reusable design appears under **My assemblies** in the Library. The **Cube** library example is a four-panel starting point.

Select an assembly or the panels around a rectangular opening to **Close hole** in the inspector. One opening offers a direct action; multiple openings offer a choice such as Front or Back, with panel dimensions. Compartments are detected separately, including on rotated designs. Closing sizes and positions a solid panel for the connector slots and fits hardware along all four edges. Occupied joints are replaced with complete T or cross connectors where needed; an opening that cannot accept compatible hardware is left unchanged. For assemblies, the selected instance receives an independent design containing the new panel; other copies retain their openings. The closing panel participates in the connected geometry and follows compatible assembly size changes. Closing supports undo, redo, autosave, and export.

- Open **Editable values** when creating an assembly, or choose **Edit values** in **Edit assembly**, to add named controls. Choose the panel dimensions each value controls; one value can drive several panels and dimensions. For example, bind both dimensions of every cube panel to **Side length**. The first dimension sets the default, and further dimensions retain any size difference as an offset. **Relationships** lets you change each binding's multiplier and offset. Use **Save values** to apply shared control edits.
- The **Cube module** comes with one **Side length** control. **Wide shelf module**, tall boxes, and shallow boxes expose **Width**, **Height**, and **Depth** separately. Cubbies expose each column's width and each row's height, plus shared depth; columns run left to right and rows bottom to top. These values describe panel cut lengths in millimeters. Connector clearances and panel thickness add to the final outside dimensions.
- Configure a selected instance under **Instance values** in its inspector. Its dimensions change without changing the source defaults or other instances' configured values. Connected panels and connectors adjust together, and linked neighbors move as needed to keep shared corners aligned. Incompatible shared depths, closed loops, or panel limits reject the edit and keep the last valid model. **Reset to assembly defaults** restores its source dimensions.
- Select an instance as a whole from the canvas or the Assembly list. Expand its row to inspect individual panels. **Duplicate** (or **⌘/Ctrl D**) creates a linked copy; inserting from **My assemblies** uses the same definition.
- Choose **Attach a copy**, then hover or focus a **+** in the workspace to preview its placement and resulting hardware. Click the handle to attach. **Attach an existing instance** connects a copy already in the project. **Escape** cancels placement. The complete placement, including connector replacements and any additional matching corners, is one undo step.
- Compatible box corners automatically share cross connectors. Their original 90° hardware is replaced in the assembled creation without changing the reusable box definition. Removing or disconnecting an instance restores the affected corner hardware on its neighbors.
- **Edit assembly** enters an explicit shared editing mode. The breadcrumb identifies the assembly and how many instances will change. Edit its panels or configure the exposed values, then choose **Done editing**. Structural edits update every linked instance and keep valid attachments aligned; overrides for retained controls and instance colors are kept. Removing a control restores its dimensions to the shared source. An incompatible edit leaves the last valid construction unchanged.
- **Instance panel color** is a local finish override. **Reset** restores the shared assembly colors. **Make independent** gives the selected instance its own construction while preserving its panels and physical connections. **Disconnect from neighbors** removes its physical links and places that instance beside the creation; its neighbors stay in place.
- **Disassemble** turns the selected instance back into individually editable panels, retaining their positions, finishes, and physical connectors. Other instances stay linked, and the reusable design remains in **My assemblies**. The panels stay selected after disassembly; one Undo restores the instance.

Disassembled panels retain their physical joints. If a panel still connects to a linked instance, use **Detach for free placement** (or **Detach selected panels**) before changing its geometry independently. Detaching restores the affected corner hardware on the remaining instances.

The four-box Diamond arrangement has sixteen panels. Four separate boxes use thirty-two 90° connectors; joining their four shared corners replaces those with sixteen 90° and eight cross connectors. The middle compartment is the space enclosed between the four boxes. The final box can close two matching corners in the same placement.

Instances move as rigid units. Automatic assembly attachment currently handles compatible 90° corner pairs; it does not merge overlapping walls or remove duplicate panels. Definitions, instances, overrides, and physical links are saved with the project and survive undo, reload, JSON export, and import. The parts list counts the resulting physical panels and connectors once.

## Resource examples

The Library and Templates chooser include 22 resource examples alongside the three original starters and a photo-inspired Diamond shelf. Search or filter by category to find editable assemblies from `resources/library-3d`. Numbered CAD resources supply the totem, corner, shelf with doors, H-table 180, and promotional desk. The collection PDFs add shelves, tables, counters, a bench, a trade fair display, an island display, and individual exhibition plinths. Each thumbnail is generated from the assembly it opens; switching examples supports Undo.

The **Diamond shelf** recreates the reference photo’s five compartments with four linked **Box** instances, white panels, and black connectors. The middle compartment is enclosed by the four boxes. Its five-cell cross is rotated 45° around Z using the same `rotateProject` operation as the editor. It uses sixteen 350 × 350 × 18 mm panels, sixteen 90° connectors, and eight cross connectors. Select any box and choose **Edit assembly** to update all four. These dimensions are an editable approximation from the photo, not measured source dimensions. The library thumbnail shows the actual rotated build.

Repeated plans across room collections appear once. The workshop-table PDF's H-table and cube are separate examples, as are the three closed plinths and the open tall and wide plinths. The open cube uses the same example as the standalone cube. The workshop table with shelves and Organizer Workstation 08 are the same build. The shelf with six doors and reception counter with four doors remain separate variants.

Accessory inserts fit the clear openings between frame panels, including the connector spacing. Dividers meet the floor and ceiling, insert shelves meet their supporting sides, and doors and display faces touch their backing. Known saved or imported examples with the original floating inserts are repaired when their geometry is unchanged, preserving names, finishes and identities. Repairs on load support Undo; examples with custom geometry are left alone.

Examples preserve the supplied panel dimensions and connector layouts where available. The Totem retains the source panel sizes and connector quantities, but centers its deeper base beneath the stack instead of extending it forward; its clamp distribution is adapted to the editor's shared-joint geometry. The corner booth uses square panel corners in place of the source's rounded corners. Dividers, doors, and printed inserts are simplified accessories; their custom slots, folds, hinges, and print artwork are not fabrication geometry. The open-plinth plan's printed parts list disagrees with its drawing: its three four-panel frames require eight 350 × 350 mm panels and four 735 × 350 mm panels. Those examples follow the depicted frames. The supplied Bizu stool, Nordic chair, and Lean table use other construction systems and are excluded from the connector library. Printing templates and artwork instructions are supporting resources, not additional builds.

## Production deployment

The public address is **https://playwood.app/**. Import this repository into Vercel and attach `playwood.app` in the project's domain settings, following the DNS records Vercel provides. `vercel.json` selects Vite, runs `npm run build`, serves `dist`, and sets security headers and immutable caching for hashed assets. The app has one URL (`/`) and needs no server or environment variables.

The HTML includes canonical, Open Graph, and Twitter card metadata. `public/` contains the 1200 × 630 sharing image, favicon, app icons, web manifest, robots rules, and sitemap. The manifest supports standalone launch; offline operation is not implemented. Browser saves retain the original storage key so existing projects survive the branding change.

The header and generated artwork share `public/favicon.svg`. After editing the logo or social card layout, regenerate the committed PNG assets with:

```sh
npx playwright install chromium
node scripts/generate-brand-assets.mjs
```

Asset generation is a development step; Vercel serves the committed files without needing Chromium during the build. Configuration reference: [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json).

## Verification

```sh
npm run doctor
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

React Doctor is installed as a development dependency. Run `npm run doctor -- --verbose` for all findings or `npm run doctor -- --scope changed` to check changes against the detected base branch. The scan skips the remote score and crash reporting. See the [CLI reference](https://www.react.doctor/docs/reference/cli-reference).

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
- `src/lib/assemblies.ts`: reusable definitions, linked instances, corner attachment, shared hardware, and metadata validation.
- `src/lib/structure-edit.ts`: constrained panel movement and connected resizing.
- `src/lib/panel-movement-direction.ts`: live camera projection and keyboard movement directions.
- `src/lib/example-library.ts`: shared example catalog and resource references.
- `src/lib/cad-examples.ts`: editable assemblies based on the numbered CAD resources.
- `src/lib/pdf-examples.ts`: editable assemblies based on the collection plans.
- `src/lib/platform-examples.ts`: workshop table and tiered island assemblies.
- `src/components/ExampleBrowser.tsx`: resource example selection and previews.
- `src/lib/legacy-shelf.ts`: conservative repair of the original shelf's embedded middle connectors.
- `src/lib/legacy-example-inserts.ts`: conservative repair of original floating library inserts.
- `src/components/Scene.tsx`: cameras, panel materials, selection, and 3D rendering.
- `src/components/ConnectorMeshes.tsx`: placement and materials for the supplied connector models.
- `src/components/connector-geometry.ts`: imported connector parts, source normalization, and shared mesh geometry.
- `src/components/RoomEnvironment.tsx`: room architecture, furnishings, procedural materials, and lighting for realistic preview.
- `src/components/scene-geometry.ts`: solid/perforated panel geometry.
- `src/components/ui/`: editable shadcn-style Radix primitives; aliases in `components.json`.
- `src/hooks/use-project.ts`: undo/redo and browser-local persistence.
