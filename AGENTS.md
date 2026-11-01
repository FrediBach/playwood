# Working in Playwood

## Start here

This is a browser-only furniture editor built with React, TypeScript, Vite, Three.js, and React Three Fiber. Projects persist locally; there is no backend, authentication, database, or required environment configuration.

Read [docs/README.md](docs/README.md) for the architecture map and [README.md](README.md) for user-visible workflows. Read the relevant domain, state, or rendering document before changing those areas. Treat source code and tests as the authority when documentation drifts, and update the affected documentation with the implementation.

Before editing, inspect the worktree and nearby code/tests. Preserve unrelated user changes. Keep changes focused and follow the surrounding TypeScript and CSS conventions; avoid repository-wide formatting or dependency updates for an unrelated feature.

## Commands

Use npm and the committed `package-lock.json`. The documented baseline is Node.js 22.12+.

```sh
npm ci                         # Fresh checkout, locked dependencies
npm run dev                    # Local Vite server on 127.0.0.1
npm test -- src/lib/model.test.ts
npm run build                  # TypeScript check and production bundle
npm run doctor                 # React Doctor diagnostics
npx playwright install chromium  # Browser setup when needed
npm run test:e2e -- tests/editor.spec.ts
```

There is no `lint` or standalone `typecheck` script. Use the actual scripts in [package.json](package.json). Playwright starts/reuses port 5174; `PLAYWRIGHT_PORT` changes it and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an existing Chromium binary. Ensure a reused server belongs to this checkout. See [docs/development.md](docs/development.md) for focused commands and the coverage map.

## Code ownership

- `src/App.tsx` coordinates selection, modes, commands, dialogs, file operations, and feedback. Put reusable geometry logic in the relevant `src/lib` module, and gesture lifecycles in `src/hooks` or the existing interaction component.
- `src/lib/types.ts` defines serializable model contracts. `src/lib/model.ts` owns core attachment resolution, validation, parsing, starters, and cutting-list export.
- `src/lib/structure-edit.ts` handles constrained panel movement and resizing. Assembly operations belong in `assemblies.ts` and the associated parameter, placement, and rescale modules.
- `src/hooks/use-project.ts` owns project history and autosave. Other hooks manage attachment, drag, resize, clipboard, and assembly editing workflows.
- `src/components/Scene.tsx` owns the WebGL scene. Mesh/material helpers, room rendering, and scene interactions live alongside it. `src/lib/connector-geometry.ts` owns imported CAD geometry; the components file of the same name re-exports it.
- `src/components/ui` contains editable Radix-backed primitives. Reuse existing fields, inspector disclosures, list components, and styles when extending the UI.
- `resources/` holds original design references; `public/` holds served static assets. `src/lib` contains example factories and guide content. Do not modify generated `dist/` or test artifacts as source.

## Model and geometry rules

- Keep project lengths in **millimeters**, rotations in **Euler radians**, and panel geometry in local **XY** with thickness on **Z**. Scene adapters convert lengths to meters. Custom outline points are normalized from the panel's top-left corner.
- Use `resolvePanels(project)` when an operation needs actual world placement. Driving connections determine child transforms; support connections add physical joints without driving placement. Preserve the acyclic driving graph and valid joint branches.
- Use the existing domain commands for movement, resizing, rotation, splitting, and attachment. Directly patching a connected panel's transform can be ineffective or break its joints. Keyboard movement and connected resize preserve joints; Control-drag intentionally releases external joints in its candidate and can form new attachments. Preserve connector sizes, permitted thicknesses, joint angles, and the last valid project when an edit is rejected.
- Assembly definitions, instances, ID maps, ports, links, and materialized panels/connections must agree. Route linked edits through assembly APIs; distinguish shared-source edits, instance parameter/finish overrides, making independent, disconnecting, and disassembling.
- A connection is not one physical connector. Use `getPhysicalConnectors` or `orderedConnectors` for installed hardware, counts, selection, and per-piece edits. Per-piece overrides can remove hardware while keeping structural connections.
- Preserve stable panel, connection, and instance identities during edits. These IDs also support selection, grouping, hardware overrides, and assembly links.
- Reuse the connector profiles and CAD-derived offsets. Custom outlines and perforated meshes do not make collision or connector-fit checks fully shape-aware; retain documented limitations instead of claiming fabrication guarantees.

## State and compatibility rules

- Commit accepted project changes through `useProject`. Treat previous snapshots as immutable. Preview candidates and form drafts should remain separate until the workflow accepts them; cancellation must leave the committed construction intact.
- Preserve intended undo boundaries: a completed drag/resize is one edit, and repeated movement keys use the existing history grouping. Use functional commits for commands that depend on the latest project. Retain stale-source checks on preview acceptance.
- Keep `playwood-studio-project-v1` and `Project.version: 1` compatible with existing saves. Extend parsers with deliberate defaults for omitted legacy fields. Do not rename storage keys or change file formats incidentally.
- Validate untrusted JSON through `parseProject` or `parseAssemblyFile`. Type assertions do not validate imports. Schema/topology parsing and geometric `validateProject` diagnostics have different responsibilities; preserve that distinction.
- When adding a saved field, trace its defaults, parsing, assembly behavior, copy/duplicate behavior, export, undo/redo, and reload. Project files and standalone assembly files have different scopes; legacy repairs must remain conservative.
- Keep selection, camera settings, modal state, and gesture state separate from the persisted project unless the feature explicitly requires persistence. List groups organize rows and do not define physical assemblies.

## Rendering and interaction rules

- Preserve demand rendering and invalidate when imperative camera/scene changes require a frame. Avoid adding continuous animation work to static previews.
- Shared CAD connector geometries have application lifetime: do not mutate or dispose them per instance. Dispose component-owned panel geometry, materials, and textures according to existing ownership patterns. Effects and resource setup must tolerate React Strict Mode cleanup/recreation.
- Keep heavy split-feasibility work in the existing worker paths. Preserve worker termination and stale-result guards when selection, input, or project identity changes.
- Respect existing keyboard focus and mode guards. Text fields, dialogs, list navigation, canvas movement, dragging, box selection, attachment previews, and assembly editing must not steal each other's shortcuts. Preserve Escape cancellation and focus restoration.
- Maintain the fixed viewport and independently scrolling inspectors; check desktop and narrow drawers for UI changes. Preserve accessible names and keyboard alternatives used by the interface and browser tests.

## Verification and completion

Choose checks appropriate to the patch. Run relevant Vitest coverage and `npm run build` for code changes; include focused Playwright workflows for interaction, persistence wiring, rendering, or layout changes. Use `npm run doctor` for React changes and the full suites for broad changes. For documentation-only changes, verify source references, commands, links, and `git diff --check`.

Add meaningful regression coverage for changed behavior or fixed bugs, especially geometry constraints and saved-format compatibility. Do not add tests that only mirror implementation details or require elaborate scaffolding for trivial presentation changes. Existing browser tests can import a constructed project through the real file control and inspect exported JSON; use `tests/inspector-helpers.ts` for inspector sections.

Update the relevant architecture document when a boundary, invariant, command, or format changes. Update the user README and illustrated guide content when their described workflows change. Report what changed, which checks ran, their results, and any remaining limitations. Do not claim unrun checks passed.
