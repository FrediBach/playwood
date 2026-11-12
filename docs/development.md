# Development and verification

[Documentation index](README.md)

## Local setup

The project uses npm and commits [package-lock.json](../package-lock.json). Follow the root README's Node.js 22.12+ baseline; Node 25 is the version documented there as tested. There is no committed Node version-manager file or `engines` declaration in [package.json](../package.json).

For a fresh checkout using the locked dependency graph:

```sh
npm ci
npm run dev
```

Use `npm install` when intentionally updating dependencies and review the accompanying lockfile diff. The development script binds to `127.0.0.1`; use the URL Vite prints. No `.env`, account, database, or API key is required.

Local storage is scoped to the full origin. Development, production, and the browser-test port each have their own project save. Export a `.playwood.json` file when moving work between them.

Directory Sync also remembers its File System Access handle per origin in IndexedDB. It requires a secure context (localhost qualifies) and a browser with `showDirectoryPicker`; the existing upload/download controls remain available elsewhere. Reconnect a remembered folder with Resync after reloading.

## Commands provided by the repository

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts Vite on localhost |
| `npm run build` | Runs `tsc -b` and then creates the Vite production bundle in `dist/` |
| `npm run preview` | Serves an already-built `dist/` locally |
| `npm test` | Runs the Vitest suite once |
| `npm run test:e2e` | Runs Playwright browser tests |
| `npm run profile:startup` | Builds and profiles three throttled, fresh-context production loads |
| `npm run check:startup` | Builds, profiles, and enforces the startup JavaScript gzip budget; see [method and limits](startup-performance.md) |
| `npm run doctor` | Runs the installed React Doctor with `--yes --no-score` |

There is no `lint`, formatter, standalone `typecheck`, or library-build script. Do not refer to nonexistent commands in change reports or agent workflows. The build provides TypeScript checking for [tsconfig.json](../tsconfig.json)'s includes (`src` and `vite.config.ts`); it does not type-check the separate `tests/` directory through that configuration.

The `@/` import alias maps to `src/` in TypeScript, [vite.config.ts](../vite.config.ts), and [vitest.config.ts](../vitest.config.ts). If the alias changes, keep all three in sync. Browser specs commonly import source modules using relative paths.

## Choosing verification

Use checks that exercise the changed behavior. Documentation-only changes need source/link/command review and `git diff --check`; they do not require a WebGL test run. For code, start with the relevant domain tests and build. Run browser coverage when changing interaction, focus, rendering, persistence wiring, or layout. For broad changes, the existing full verification sequence is:

```sh
npm run doctor
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The Chromium installation is a setup step; repeat it only when needed. React Doctor also supports `npm run doctor -- --verbose` and `npm run doctor -- --scope changed`. Treat its findings as diagnostics to investigate, and report remaining findings accurately.

### Focused unit and geometry tests

Vitest discovers `src/**/*.test.ts` and uses its default Node test environment. Domain modules are exercised without mounting the app; geometry tests inspect Three.js data directly. Some tests live beside rendering helpers in `src/components`.

```sh
npm test -- src/lib/model.test.ts src/lib/structure-edit.test.ts
npm test -- src/lib/assembly-parameters.test.ts
npm test -- src/lib/design-constraints.test.ts src/lib/structure-design-constraints.test.ts src/lib/design-constraint-commands.test.ts src/lib/design-constraint-interactions.test.ts
npm test -- src/components/scene-geometry.test.ts
```

Prefer assertions about the physical result: resolved positions and rotations, joint seats, connector quantities, preserved IDs, rejected constraints, and serialization round trips. For rotations, quaternion equivalence or geometric comparisons often express correctness better than exact Euler tuples. Use tolerances for floating-point geometry. Tests that repeat an implementation's intermediate calculations without checking behavior provide little protection.

Use `roundTripProject` from [`src/test/project-round-trip.ts`](../src/test/project-round-trip.ts) when testing save/reload compatibility. It deliberately stringifies, parses JSON, and validates through `parseProject`; `structuredClone` is appropriate for isolated fixture copies, but does not exercise the saved format. Keep direct parser calls for malformed imports and legacy fixtures, and explicit serialized values when assertions compare against JSON-normalized data. The helper centralizes the intentional JSON operation so React Doctor reports it once rather than flagging every persistence assertion as a cloning optimization.

### Resize intent benchmark

The test-only [resize corpus](../src/test/resize-intent-corpus.ts) separates physical/compatibility invariants from current inference-policy characterization. Run `npm test -- src/lib/resize-intent-benchmark.test.ts`. To record geometry, alternatives, validity, hardware movement, and timings, run `RESIZE_BENCHMARK_REPORT=/tmp/resize-baseline.json npm test -- src/lib/resize-intent-benchmark.test.ts`. Reports are optional; no timing threshold runs in CI. `npm test -- src/lib/resize-intent.test.ts src/lib/structural-solver.test.ts` covers the transient adapters, selection-average/edge anchors, simultaneous targets, source/session guards, row provenance, and numerical diagnostic distinctions. Run `npm test -- src/lib/numeric-resize.test.ts src/lib/resize-priority-solver.test.ts` for the active numeric command, authored references, ambiguity, final acceptance, overlap measures, and independent numerical reference cases. `RESIZE_NUMERIC_REPORT=/tmp/resize-numeric.json npm test -- src/lib/numeric-resize.test.ts` logs all 14 numeric corpus decisions, candidate counts, and single-run timings. `RESIZE_PRIORITY_REPORT=/tmp/resize-priorities.json npm test -- src/lib/numeric-resize.test.ts` records successful per-tier diagnostics for the synth/storage fixture. `npm run test:e2e -- tests/resize-alternatives.spec.ts` covers desktop/narrow cancellation, successful ambiguity, apply, history, exported JSON, and reload. Run `npm test -- src/lib/resize-planner.test.ts` for shadow candidates, threshold continuity, locked cuts, rotated openings, rigid trays, order invariance, and budgets. `RESIZE_SHADOW_REPORT=/tmp/resize-shadow.json npm test -- src/lib/resize-planner.test.ts` writes numeric-corpus explanations, score components, cuts, attempt diagnostics, and single-run elapsed times (not a latency guarantee). See [the recorded baseline and coverage limits](plans/resize-solver-benchmark.md) before treating passing current-output tests as desired intent behavior.

### Browser tests

[playwright.config.ts](../playwright.config.ts) points at `tests/`, defaults to `http://127.0.0.1:5174`, and starts Vite with `--strictPort`. It reuses an existing server at that address, so verify that the server belongs to this checkout. `fullyParallel` is disabled; the config does not explicitly set a worker count. The default viewport is 1440 × 1000, and individual specs also exercise smaller sizes.

Chromium launches with WebGL/ANGLE/SwiftShader flags for software rendering. The optional environment variables are:

| Variable | Purpose |
| --- | --- |
| `PLAYWRIGHT_PORT` | Overrides the browser suite's server port |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Uses an existing Chromium binary instead of the Playwright-managed one; also supported by brand-asset generation |

```sh
npm run test:e2e -- tests/editor.spec.ts
npm run test:e2e -- tests/preview-resize.spec.ts --workers=1
PLAYWRIGHT_PORT=5175 npm run test:e2e -- tests/assembly-files.spec.ts
```

Specs commonly create a real `Project` using domain helpers, load it through the file-import control, operate labeled controls, and read exported JSON or local storage. This verifies the browser wiring as well as the domain command. Use [tests/inspector-helpers.ts](../tests/inspector-helpers.ts) to open named inspector disclosures through their real controls. Prefer accessible roles and labels where possible.

Scene helpers that discover loaded Vite modules through Resource Timing use [tests/browser-fixture.ts](../tests/browser-fixture.ts). It enlarges the timing buffer before navigation so startup requests remain available and helpers reuse the existing React Three Fiber instance.

Persistence is debounced: wait for the saved state or poll the stored value before reloading. Rendering tests should wait for the expected scene or observable pixels, rather than relying on a fixed delay. Listen for page errors when a new flow risks runtime/WebGL failures. A click succeeding is insufficient evidence that a candidate project was actually committed.

Screenshots are saved on failures, and some specs explicitly write diagnostic images to `test-results/`. Those images are evidence for inspection, not automatically approved visual snapshots. `test-results/` and `playwright-report/` are ignored.

### Coverage map

| Change area | Representative unit coverage | Representative browser coverage |
| --- | --- | --- |
| Attachments and connector profiles | `src/lib/model.test.ts`, `src/components/connector-geometry.test.ts` | `tests/connectors.spec.ts`, `tests/attachment-sides.spec.ts` |
| Nice-value settings and input completion | `src/lib/nice-values.test.ts`, `src/lib/preview-nice-values.test.ts` | `tests/nice-values.spec.ts`, `tests/rescale.spec.ts` |
| Constrained movement, resizing, and repetition | `src/lib/structure-edit.test.ts`, `src/lib/structure-resize-preservation.test.ts`, `src/lib/structure-cut-preferences.test.ts`, `src/lib/preview-resize.test.ts`, `src/lib/selection-stretch.test.ts`, `src/lib/selection-stretch-preview.test.ts`, `src/lib/structure-repeat.test.ts` | `tests/panel-movement.spec.ts`, `tests/synth-storage-resize.spec.ts`, `tests/preview-resize.spec.ts`, `tests/selection-stretch.spec.ts`, `tests/preview-repeat.spec.ts` |
| User design requirements, dimension locks, and rule previews | `src/lib/design-constraints.test.ts`, `src/lib/structure-design-constraints.test.ts`, `src/lib/design-constraint-commands.test.ts`, `src/lib/design-constraint-interactions.test.ts` | `tests/design-constraints.spec.ts`, `tests/dimension-locks.spec.ts`, `tests/synth-storage-resize.spec.ts` |
| Drag, snapping, and selection | `src/lib/preview-drag.test.ts`, `src/lib/preview-snap.test.ts`, `src/lib/box-selection.test.ts` | `tests/preview-drag.spec.ts`, `tests/preview-snap.spec.ts`, `tests/box-selection.spec.ts` |
| Assemblies and parameters | `src/lib/assemblies.test.ts`, `src/lib/assembly-parameters.test.ts`, `src/lib/assembly-placement.test.ts` | `tests/assemblies.spec.ts`, `tests/assembly-parameters.spec.ts`, `tests/assembly-placement.spec.ts` |
| Automatic construction tools | `src/lib/auto-connect.test.ts`, `src/lib/close-holes.test.ts`, `src/lib/grid-split.test.ts` | `tests/auto-connect.spec.ts`, `tests/close-holes.spec.ts`, `tests/split-panels.spec.ts` |
| File compatibility and copy/paste | `src/lib/assembly-file.test.ts`, `src/lib/clipboard.test.ts`, `src/lib/model.test.ts` | `tests/assembly-files.spec.ts`, `tests/copy-paste.spec.ts`, `tests/editor.spec.ts` |
| Local directory sync | `src/lib/directory-sync.test.ts` | `tests/directory-sync.spec.ts` |
| Appearance and outlines | `src/lib/custom-colors.test.ts`, `src/lib/finish-coverage.test.ts`, `src/lib/custom-outline.test.ts` | `tests/custom-colors.spec.ts`, `tests/finish-coverage.spec.ts`, `tests/custom-outlines.spec.ts` |
| List organization and hardware edits | `src/lib/list-groups.test.ts`, `src/lib/connector-selection.test.ts` | `tests/list-groups.spec.ts`, `tests/connector-selection.spec.ts` |
| Realistic preview | `src/components/room-layout.test.ts`, `src/components/robot-vacuum-navigation.test.ts`, `src/components/robot-vacuum-motion.test.ts`, `src/components/robot-vacuum-recovery.test.ts`, `src/lib/preview-furnishings.test.ts`, `src/lib/preview-furnishing-roles.test.ts`, `src/lib/preview-furnishing-variation.test.ts`, `src/lib/room-floor-style.test.ts` | `tests/realistic-preview.spec.ts`, `tests/robot-vacuum.spec.ts`, `tests/deferred-preview.spec.ts`, `tests/scene-switching.spec.ts` |
| Library and guide content | `src/lib/example-library.test.ts`, `src/lib/guide-scenes.test.ts` | `tests/library.spec.ts`, `tests/build-guide.spec.ts` |
| Layout, focus, and inspector behavior | Relevant helper tests where applicable | `tests/sidebar-layout.spec.ts`, `tests/inspector-ux.spec.ts`, `tests/editor.spec.ts` |

This is a navigation aid, not an exhaustive test list. Nearby specialized tests often cover important constraints beyond the main feature's filename.

Directory-sync browser tests replace the operating-system picker and permission responses with a fixture directory in the browser's origin-private filesystem. They still exercise real browser directory handles, writable streams, and IndexedDB structured cloning across reloads. This verifies application persistence and conflict handling; native chooser presentation and actual operating-system permission prompts require manual checking in a supported browser.

## Implementing common changes

### Add a saved property

Trace the property through [types.ts](../src/lib/types.ts), creation defaults, `parseProject`, and any assembly/file parser that serializes it. Define how older files with the property omitted should behave. Consider shared definitions, per-instance overrides, copy/paste, duplication, selection equality, palette normalization, JSON exports, and CSV only where relevant. Confirm import/export, undo/redo, and reload behavior instead of treating the inspector as the only entry point.

### Add a geometry operation

Implement the transformation in the appropriate `src/lib` module so the UI, previews, workers, and tests can reuse it. Work from resolved geometry where required, preserve structural and assembly identities, and return a candidate/result or a useful failure. Commit through `useProject` at the intended undo boundary. Add behavioral regression coverage for the valid case and the relevant rejected constraint, including rotated and connected cases when the algorithm depends on orientation or graph topology.

For user design rules, distinguish equality from minimum bounds, local cut dimensions from world references, and physical connectivity from solve-component relationships. Preserve rules through candidate reconstruction; explicit removal uses `constraints: []`. Normal edits must pass `assertDesignConstraintEdit`, while document replacement uses the explicit history replacement option. Cover imported unsatisfied rules numerically so an unchanged diagnostic ID cannot conceal a worsening result. Keep current joint/collision/insert checks alongside this guard.

### Add an interaction or inspector control

Keep transient drafts in a component or hook and persist the accepted result through the existing command path. Follow the existing focus, modal, attachment, exploded-view, and assembly-editing guards. Test cancellation, one-step undo, and keyboard behavior alongside pointer input. For multi-selection, preserve the existing mixed-value semantics. Check narrow layouts and whether the change affects both studio and realistic preview.

### Add examples or guides

Generate examples through domain functions, preserve source provenance, and document intentional approximations. Update the catalog and its geometry tests. Keep reusable module insertion separate from full-project replacement. Guide steps should refer to actual labels and controls, draw from model geometry, and stay read-only with respect to the active project. Update the root README if the user workflow changes.

## Assets and production checks

To regenerate committed brand PNGs after editing [public/favicon.svg](../public/favicon.svg) or the artwork script:

```sh
npx playwright install chromium
node scripts/generate-brand-assets.mjs
```

The script writes icons and `public/og-image.png`. Inspect those outputs and include intended asset updates in the change. Production builds serve these committed files and do not run Chromium for asset generation.

Use `npm run build` followed by `npm run preview` to inspect production output when changing imports, lazy modules, workers, or asset URLs. [vercel.json](../vercel.json) configures static hosting; domain changes also affect canonical/social metadata, robots rules, and the sitemap. [Architecture overview](architecture.md) describes the deployment boundary.

Generated `dist/`, `node_modules/`, `*.tsbuildinfo`, and test artifacts are ignored by [.gitignore](../.gitignore). Do not edit generated output as the implementation. Preserve supplied CAD/reference files unless a task explicitly changes the underlying resources.

### TROFAST coverage

`npm test -- src/lib/trofast.test.ts src/components/trofast-geometry.test.ts src/components/scene-geometry.test.ts src/lib/preview-furnishings.test.ts` checks fit, parsing, assemblies, fixed-size geometry, real openings and furnishing clearance. `npm run test:e2e -- tests/trofast.spec.ts tests/trofast-renders.spec.ts` covers placement drafts, colors, undo/reload/export, clearance failures, narrow inspectors, and all catalog renders in both preview modes. The tests use real file import/export controls.

Stage 4 resize gesture checks: `npm test -- src/lib/resize-gesture.test.ts src/lib/resize-preview-worker.test.ts src/lib/preview-resize.test.ts src/lib/resize-planner.test.ts`. To record local preparation and twelve successive 8 mm samples for single-panel, threshold-seam, and synth/storage cases, run `RESIZE_GESTURE_REPORT=/private/tmp/resize-gesture.json npm test -- src/lib/resize-gesture.test.ts`. The optional timing test is skipped otherwise. Browser transaction coverage lives in `tests/preview-resize.spec.ts`, including H-Table and Island Display propagation on the main thread and worker, cancellation, history, and reload. `src/lib/connected-resize-intent.test.ts` checks connected propagation versus local Shift-resize, both edge sides, grow/shrink, and rotated constructions.

## Resize performance investigation

Run `RESCALE_PERFORMANCE_REPORT=/tmp/rescale-profile.json npm test -- src/lib/resize-performance.test.ts` to record grouping, first common-dimension solve, range discovery, arrow preparation, and three successive source-relative arrow samples. The optional test writes JSON plus a `.cpuprofile` that can be loaded in DevTools. It is skipped in ordinary runs and imposes no machine-dependent timing threshold.

On 11 November 2026, paired instrumented Node 25/macOS runs identified synchronous range discovery and handle preparation, repeated joint scans, and sparse matrix products as major costs. Observed before/after CPU timings for the same fixtures were:

| Operation | Before | After |
| --- | ---: | ---: |
| Synth/storage (27 panels), arrow preparation | 230 ms | 88 ms |
| Synth/storage, three successive arrow samples | 90–110 ms | 44–53 ms |
| Grid (178 panels), arrow preparation | 189 ms | 94 ms |
| Grid, three successive arrow samples | 44–45 ms | 23–24 ms |
| Grid, common-dimension range discovery | 1,249 ms | 570 ms |

These are single paired local CPU profiles, not browser p95 or frame-rate guarantees. The seven-panel shelf showed noisy small timings, so no small-project speedup is claimed. The solver keeps operation order, tolerances, objectives, and recovery policies; 100 deterministic systems matched the committed prior kernel exactly with and without bounds. Per-call/batch joint indices remove repeated scans without persistent model caches. Separately, projects with at least 12 panels prepare arrow handles and slider ranges in cancellable workers, so these CPU costs no longer block the UI. Drag solving retains its existing worker/coalescing policy. Remaining costs include geometry validation, rendering, worker startup, and synchronous slider samples.

A second performance pass caches source-only validation facts within prepared resize sessions and removes redundant attachment resolution, empty TROFAST resolution, and outline scans. In a paired local profile, repeated large-grid arrow samples fell from about 22 ms to 16–17 ms; synth/storage timings remained noisy. Solver policy, tolerances, and candidate checks are unchanged.

For exact before/after comparisons, copy `src/lib/resize-performance-equivalence.test.ts` into both checkouts and run `RESIZE_EQUIVALENCE_FIXTURES=/tmp/resize-fixtures.json RESIZE_EQUIVALENCE_REPORT=/tmp/resize-before.json npm test -- src/lib/resize-performance-equivalence.test.ts` in the baseline, then run with the **same fixture path** and a different report path in the updated checkout. The first run creates shared fixtures with stable IDs. Compare the reports’ `outcomes` fields exactly; timings are separate. This opt-in harness covers 19 corpus/complex-project fixtures, numeric edits, review alternatives, both edge sides and local modes, and successive arrow samples. It is skipped in ordinary runs.
