# Focused quality assessment — 11 November 2026

[Documentation index](README.md)

The strongest weaknesses are at the boundaries between editing, saving, and reopening a project. The normal editing flows have substantial regression coverage, but some accepted edits produce files the app cannot reopen, and recovery can overwrite the only browser copy. Keyboard access to narrow drawers and feedback for rejected commands also need attention.

This is a focused review of the current checkout, covering project history and file operations, selected geometry commands, desktop/phone editing, and production output. It is a snapshot of findings and proposed work, not a record of implemented fixes. No application behavior was changed. Priorities reflect user impact: **P1** risks losing saved work, **P2** breaks or obscures a workflow, and **P3** is a measured improvement opportunity. Source references and reproduction steps below distinguish confirmed behavior from recommendations.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| QA-01 | P1 | Accepted edits can become unreadable saves; startup overwrites failed saves | Domain and browser reproductions |
| QA-02 | P1 | A stale tab can replace another tab's newer save | Two-tab browser reproduction |
| QA-03 | P2 | Delayed file imports can discard intervening work | Two command-level delayed-read reproductions |
| QA-04 | P2 | Removed connectors still impose minimum seam requirements | Domain reproduction |
| QA-05 | P2 | Phone drawers lose keyboard focus and leave the canvas active behind them | Browser reproduction at 390 × 844 |
| QA-06 | P2 | Rejected commands use brief success-style notifications | Source review and existing rejection coverage |
| QA-07 | P3 | Initial JavaScript payload is large | Production build measurement |

## QA-01 — Keep accepted projects reloadable and preserve failed saves

**Confirmed, high confidence.** [`parseProject`](../src/lib/model.ts) limits projects to 200 panels and 400 connections (line 462), and panel names to 120 characters (lines 443–466). Those bounds are not consistently enforced by editing commands or [`useProject.commit`](../src/hooks/use-project.ts). [`addDraftPanel`](../src/editor/attachment-commands.ts), lines 138–146, appends directly; `duplicatePanel` and `attachPanel` also allow the panel limit to be exceeded.

Two domain reproductions expose the mismatch:

- Start with a valid 200-panel project. Duplicate or attach one panel. The command returns 201 panels, but serializing and calling `parseProject` rejects the result.
- Start with a valid 120-character panel name. Duplicate it. Appending ` copy` creates a 125-character name that fails the same round trip.

The persistence consequence is worse than a rejected import. [`initialProject`](../src/hooks/use-project.ts), lines 14–16, catches read/parse failures and silently substitutes the starter shelf. The autosave and `pagehide` handlers at lines 52–53 then write that starter to the same key. The original failed save is neither retained for recovery nor included in Undo. The UI can report “Saved on this device” even though the preceding construction is gone from the browser save.

Browser probes confirmed both overwrites: a deliberately malformed startup save was replaced without an alert, and importing 200 panels, clearing selection, adding a loose panel, waiting for autosave, and reloading changed the stored count from 201 to the starter's seven panels.

**Recommended work:** share saved-format bounds between parsers and commands, reject over-limit edits atomically, and reserve room for generated name suffixes. Keep these structural/serialization checks separate from geometric diagnostics. Independently, retain the original bytes when startup parsing fails; provide a recovery notice and a download/reset choice before replacing the recovery copy.

**Regression coverage to add:** accepted command → JSON serialization → `parseProject` at panel, connection, and name limits; browser reload after boundary edits; malformed and schema-invalid startup saves that remain recoverable. Current parser tests do not establish that every successful editing command stays within parser bounds.

## QA-02 — Protect newer saves from stale browser tabs

**Confirmed in Chromium, high confidence.** [`use-project.ts`](../src/hooks/use-project.ts), lines 52–53, unconditionally saves each tab's current snapshot into one shared local-storage key. The `pagehide` handler writes even when that tab has not edited anything. There is no revision comparison or cross-tab notification; [state and persistence](state-and-persistence.md#browser-persistence) already documents the absence of reconciliation.

**Reproduction:** open the same origin in tabs A and B, change the project in A and wait for it to save, then navigate away from B. B's older snapshot replaces A's saved copy. A still displays the newer construction, so the overwrite is not apparent until a reload. Exporting or making another edit in A can preserve its still-open copy; closing it is not a dependable recovery strategy.

**Recommended work:** coordinate writers and use revision/conflict checks, including on page exit. A stale, unchanged tab should not write. Show a conflict notice and preserve both versions when tabs diverge; do not simply reload over unsaved edits.

**Regression coverage to add:** two tabs sharing an origin, with both delayed autosave and an unchanged stale tab exiting. Assert that the newer persisted revision survives and that conflicts are visible.

## QA-03 — Guard asynchronous file imports against stale state

**Confirmed, high confidence.** [`project-file-commands.ts`](../src/editor/project-file-commands.ts), lines 84–90, awaits `file.text()` and then inserts an assembly using the project captured before the read (lines 67–68). With no selection, an edit made while that read is pending can be discarded by the subsequent nonfunctional commit. The project import at line 128 also lacks a request identity: an older, slower import can finish after a newer import and replace it.

Temporary command-level probes delayed `File.text()` and confirmed both cases: a newly added panel disappeared after assembly insertion, and a slow first project import replaced the second completed import. The tests controlled promise completion; this is not a claim that typical small local files are visibly slow. Undo remains available until reload, making this less severe than QA-01.

**Recommended work:** capture document/request identity, reject obsolete results, and use an appropriate current snapshot for additive insertion. [`use-directory-sync.ts`](../src/hooks/use-directory-sync.ts), lines 156–160, already demonstrates a source-identity guard. Define whether an intervening edit cancels insertion or whether insertion safely applies to the latest project.

**Regression coverage to add:** delayed assembly reads with an intervening edit/replacement, and two project reads completing in reverse order. Existing import success/error tests do not exercise these races.

## QA-04 — Validate installed hardware when shrinking joints

**Confirmed, high confidence.** [`getPhysicalConnectors`](../src/lib/connector-selection.ts) excludes removed pieces, but [`validateProject`](../src/lib/model.ts) builds `jointQuantities` from stored `connection.count` (line 328). Its seam checks at lines 351–354 and shared-joint checks at lines 373–384 still use the nominal quantity.

**Reproduction:** join two 200 × 200 mm panels with four 90° pieces, remove pieces 1–3 through `editConnectors`, then resize both widths to 100 mm. There is one installed piece and the initial project validates, but resizing rejects the change with “Not enough shared edge for 4 connectors.” The equivalent construction with a stored count of one accepts the same resize. Removing surplus hardware therefore fails to free usable space in this case.

**Recommended work:** base physical fit on installed pieces and their actual placement while preserving the structural connection and removal overrides. Explicitly handle joints with every piece removed. Do not erase overrides or weaken joint-alignment checks just to pass the quantity check.

**Regression coverage to add:** shrink after removing hardware, including shared joints, followed by restore, undo, and reload. [`connector-resize.test.ts`](../src/lib/connector-resize.test.ts) already covers installed crowding and removed-piece expansion, but not this shrinking boundary.

## QA-05 — Give narrow drawers a complete keyboard lifecycle

**Confirmed in Chromium, high confidence.** At 390 × 844, focus **Open inspector** and press Enter. The inspector appears, its opener unmounts, and focus lands on `body`. Tab then focuses **3D preview canvas** behind the overlay. Escape clears the panel selection while leaving the drawer open.

[`AssemblyWorkspace.tsx`](../src/components/AssemblyWorkspace.tsx), lines 275–278, only toggles sidebar state. [`ProjectSidebar`](../src/components/ProjectSidebar.tsx) and [`InspectorSidebar`](../src/components/InspectorSidebar.tsx) render ordinary asides without drawer focus transfer/restoration. Narrow-screen rules in [`index.css`](../src/index.css) turn them into overlays, while [`editor-keyboard.ts`](../src/editor/editor-keyboard.ts), lines 147–152, routes Escape to editor modes/selection. The panel-list opener uses the same pattern; only the inspector sequence was explicitly reproduced in this assessment.

**Recommended work:** move focus into an opened overlay, return it to its opener when closing, and give Escape a predictable drawer-close action when no nested task owns it. Prevent focus reaching obscured controls while an overlay is active. Preserve ordinary sidebar navigation on desktop and explicitly decide which visible background controls remain available on narrow layouts.

**Regression coverage to add:** keyboard opening, Tab/Shift+Tab traversal, Escape, collapse, focus restoration, and nested task cancellation at phone/tablet breakpoints. [`sidebar-layout.spec.ts`](../tests/sidebar-layout.spec.ts) currently checks visibility and workspace geometry, so it passes despite this issue.

## QA-06 — Make rejection feedback recognizable and recoverable

**Confirmed in source, high confidence.** Movement, distribution, and merge failures in [`selection-commands.ts`](../src/editor/selection-commands.ts), lines 127–136, use the same `notify` path as successful commands. [`App.tsx`](../src/App.tsx), line 268, renders every notification with a double-check icon, and [`useEditorNotifications`](../src/editor/use-editor-state.ts), line 118, removes it after 3.5 seconds.

For example, merging panels in different planes produces “The panels must lie in the same plane.” The existing [`panel-merge.spec.ts`](../tests/panel-merge.spec.ts), line 38, checks that message and unchanged geometry. It does not check severity or whether users can revisit the reason. The text is accurate, but the success symbol conflicts with it, and the explanation disappears while users inspect a complicated construction.

**Recommended work:** give notifications an explicit severity and retain actionable rejection details beside the relevant tool or in a dismissible notice. Keep brief confirmations for successful actions. Extend the existing rejection workflow to check persistent, correctly identified feedback without adding presentation-only assertions.

## QA-07 — Establish a startup performance budget

**Measured, high confidence about size; runtime impact not profiled.** `npm run build` emits a **2,639.65 kB** main JavaScript chunk (**791.98 kB gzip**) and Vite's greater-than-500-kB warning. The main CSS is 144.53 kB (28.82 kB gzip). These are build output sizes, not measured load times or production transfer measurements.

Some optional features already split well: [`ProjectDialogs.tsx`](../src/components/ProjectDialogs.tsx) lazily loads the building guide, and GLTF export and heavy workers have separate chunks. Realistic room/furnishing/vacuum components are still static imports in [`Scene.tsx`](../src/components/Scene.tsx) and [`SceneEnvironment.tsx`](../src/components/SceneEnvironment.tsx).

**Recommended work:** profile a cold production load and first interaction on a representative slower device, then set a payload/startup budget. Evaluate loading optional realistic-preview features on demand, including their shared dependencies and geometry. Preserve usable fallbacks and demand rendering; moving vendor code into another eagerly loaded chunk alone does not reduce total startup work.

## Verification and limits

- `npm run build` passed TypeScript checking and production bundling, with the chunk-size warning recorded above.
- `npm test -- src/lib/model.test.ts src/lib/connector-resize.test.ts src/lib/connector-selection.test.ts` passed: **3 files, 71 tests**.
- `npm run test:e2e -- tests/sidebar-layout.spec.ts tests/inspector-ux.spec.ts tests/editor.spec.ts --workers=1` passed: **21 tests**. Coverage includes editor creation/attachment, undo/reload, imports/exports, inspector behavior, and viewport layouts.
- Two temporary command-level delayed-import tests passed. Ad hoc domain probes reproduced the panel/name bounds and removed-hardware resize findings. Temporary probes are assessment evidence, not committed regression coverage; permanent tests are proposed with each finding.
- Four temporary browser probes passed after correcting the fixture's selection state and allowing longer startup assertions: malformed-save overwrite, adding panel 201 followed by reload, stale-tab exit overwriting a newer save, and phone-drawer focus/Escape behavior. Their assertions deliberately confirmed the current defects; these passes do not mean the defects are fixed.
- `npm run doctor -- --verbose` scanned 520 files and exited **1**, reporting **62 diagnostics: 4 errors and 58 warnings**. These counts are not confirmed defect counts. Review of the four cleanup errors found camera synchronization without acquired resources in `Scene.tsx`, and existing listener/timer/gesture cleanup in `use-vacuum-control.ts` and `PreviewResizeHandles.tsx`. JSON round-trip tests account for many performance warnings. The assessment does not propose blanket suppressions.
- Documentation validation checked **106 local links/anchors** across the changed documents; whitespace checks passed. Only documentation changes remain in the worktree.

The existing local Vite server was verified to belong to this checkout before reuse. Browser checks used the repository's Chromium/SwiftShader setup because the in-app browser connection could not initialize. This review did not run the full Vitest/Playwright suites, Safari/Firefox, assistive-technology testing, a sustained memory/load profile, or native directory-picker permission flows. Documented fabrication limitations remain limitations, not newly discovered defects.

Address QA-01 and QA-02 first, then add delayed-read guards and hardware shrink regressions. The drawer and error-feedback improvements are focused UX work that can proceed independently. Profile before undertaking a broader performance refactor.

## Implementation progress — 11 November 2026

- **QA-01, startup recovery addressed:** unreadable saved bytes now pause autosave/page-exit writes and remain downloadable. Explicit reset retains a separate browser backup before saving the workspace. Parser/command bounds and generated name limits remain outstanding.
- **QA-03 addressed:** project and assembly imports reject intervening project edits/replacements; a shared request counter ignores superseded reads, including late failures. Five command regression tests cover these races.
- QA-02 and QA-04 through QA-07 remain outstanding. This progress section supplements the original assessment above; its reproduction results describe the pre-fix checkout.

Validation for this first implementation batch: five delayed-import Vitest tests and five Playwright tests (recovery and existing assembly-file workflows) passed. Production build passed with the existing large-chunk warning; React Doctor changed-file scan reported no issues. `git diff --check` passed. Full suites were not run.

### Second implementation batch — saved-format bounds and cross-tab writes

- **QA-01 reported capacity/name cases addressed:** parsers and editing share panel/connection limits; commits check project, panel, and assembly name bounds before changing history. Core duplicate/attach operations reject excess capacity atomically. Generated duplicate, clipboard, shared-branch, and instance names reserve suffix space. The startup recovery protection from the first batch remains in place. These focused checks are not a claim that every conceivable command now satisfies every parser invariant.
- **QA-02 addressed for cooperating current-version tabs:** primary writes use an exclusive Web Lock and expected-content comparison. Storage events pause conflicting tabs and show download/open choices. Page exit writes only a tab-local draft; reload restores pending work. Conflicting work also has a durable separate recovery backup. Opening the browser save preserves the displaced workspace and supports Undo. Older app versions do not participate in this protocol, and automatic merging is not implemented.
- Full Vitest run: **1,904 passed, 3 failed** across 152 files. All three failures reproduce against the unmodified committed baseline in a separate temporary checkout: `assembly-parameters.test.ts` expects older rejection wording, `example-library.test.ts` rejects reused Cat tower IDs, and `preview-drag.test.ts` finds a hidden assembly corner target. No test expectations were weakened for this patch.
- QA-04 through QA-07 remain outstanding. Recovery backups currently have no in-app browser; export conflicting work for a readily reopenable copy.

Second-batch final checks: **9 Playwright tests passed**, covering conflicting and unchanged tabs, queued simultaneous autosaves, pending-edit reload, the 200-panel boundary, unreadable-save recovery, and new-project flows. Production build passed with the existing bundle-size warning. React Doctor changed-file scan reported no issues; whitespace checks passed. The full browser suite was not run.

### Third implementation batch — removed hardware and shrinking

**QA-04 addressed.** Single-seam and shared T/cross seam-capacity checks now count installed hardware, preserving nominal counts, stable piece IDs, slides, and removal/appearance overrides. Fully removed joints have no hardware capacity requirement; topology, thickness, and support/outline alignment checks remain. The existing actual-position spacing check still rejects crowding during connected resize. Auto-add restoration now includes removal overrides in its initial joint validation, allowing only the pieces whose saved positions still fit to return on a shortened seam.

Seven new domain cases cover 90°, T, and cross shrinking, partial restoration, expansion and complete restoration, fully removed joints, alignment rejection, source immutability, saved-format round trips, and actual-position crowding. The browser regression verifies a shortened T joint through Undo, Redo, and reload. User and architecture documentation and the illustrated guide were updated. QA-05 through QA-07 remain outstanding.

Third-batch validation: **142 focused unit tests and 2 browser tests passed**. Full Vitest: **1,911 passed, 3 failed**, with the same three previously baseline-confirmed failures recorded above. Production build and whitespace checks passed; the existing bundle-size warning remains. No React component changes were made.

### Fourth implementation batch — narrow drawer keyboard lifecycle

**QA-05 addressed.** Panel-list overlays (up to 900 px) and inspector overlays (up to 680 px) now receive dialog semantics and initial focus. Tab/Shift+Tab stay inside the drawer; background app-shell controls are inert. Escape respects nested dialogs, popovers, and editing-task cancellation before closing the drawer. Closing returns focus to the remounted opener, and desktop resizing releases the modal behavior. Global editor shortcuts are guarded even when a removed drawer control temporarily leaves focus on the body. At phone widths, opening the inspector closes the panel-list overlay.

Drawer-opener tooltips now appear below the toolbar: restored focus previously left a tooltip over the neighboring opener on narrow screens. Desktop sidebars keep their ordinary navigation and complementary roles. The README, rendering/interaction documentation, and illustrated guide describe the new behavior. QA-06 and QA-07 remain outstanding.

Fourth-batch validation: all **9 sidebar layout/keyboard tests** passed, including both phone drawers, the tablet panel list, nested filter/dialog cancellation, attachment cancellation, and return to desktop navigation. The combined editor/inspector/sidebar run passed 25 tests; its remaining phone test expected the old complementary role and passed on focused rerun after changing that assertion to dialog. **3 shortcut unit tests**, production build, React Doctor changed-file checks, and whitespace checks passed. The existing bundle-size warning remains; full suites and assistive-technology testing were not run for this batch.

### Fifth implementation batch — persistent rejection feedback

**QA-06 addressed.** Notifications have explicit information/success/error severities. Selection movement, distribution, merge, panel and connector edits, attachments, keyboard rotation, assembly/clipboard commands, constraints, object edits, and gesture rejections now identify failures. The latest error remains in a dismissible “Action not applied” alert with a warning icon. Brief confirmations use a separate state/timer, so a later success does not erase the rejection reason; unspecified legacy notifications use a neutral information icon. Errors are session-only and a newer error replaces the previous one.

The notice is hosted inside an active narrow drawer to preserve keyboard access, or over the workspace otherwise. Dismissing it restores usable focus. The phone merge regression also exposed premature inspector activation during list multiselection; the open panel list now keeps focus until collapsed, then hands over to an inspector opened by selection. This refines the drawer precedence described in the fourth batch.

README, state/interaction documentation, and guide content describe the behavior. QA-07 remains outstanding.

Fifth-batch validation: **15 browser tests passed** across merge/rejection feedback, capacity limits, drawers, and rejected keyboard rotation. Coverage checks unchanged exported geometry, persistence beyond the former timeout, a later confirmation not replacing the error, keyboard dismissal/focus, and phone multiselection. **78 focused unit tests passed**. Full Vitest remains **1,911 passed, 3 failed**, with the same baseline-confirmed failures recorded earlier. Production build, React Doctor changed-file scan, and whitespace checks passed; the existing bundle warning remains. The full browser suite was not run.
