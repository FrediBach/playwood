# Resize intent benchmark — stage 0

Measured 11 November 2026 against the existing solver, before any intent-policy changes. Stage 0 of [the implementation plan](resize-solver-intent.md#implementation-sequence-and-completion-gates) is complete. Production behavior and saved formats are unchanged.

## Corpus and interpretation

[`resize-intent-corpus.ts`](../../src/test/resize-intent-corpus.ts) labels 17 cases with target, anchor, allowed adapting cuts, invariants, acceptable alternatives, and ambiguity. [`resize-intent-benchmark.test.ts`](../../src/lib/resize-intent-benchmark.test.ts) runs the public commands and records resolved cut/translation changes, validation issues, hardware movement, review outcomes, and timing.

The labels are engineering expectations, not collected user preferences. `compatibility` cases protect existing anchors, independent cuts, locks, stock bounds, and local hardware. `intent-gap` cases describe desired review behavior separately from `current`, which deliberately characterizes the old thresholds. When the planner is enabled, change those current-policy expectations deliberately; do not treat them as the desired result. Allowed adapting cuts are an upper bound, not permission to choose arbitrary changes within that set. In the synth/storage case the upright spans are eligible, while trays, stoppers, and shelf cuts remain protected.

Eight threshold cases are labeled ambiguous: three overlap values, three supported-insert occupancy values, and two setback values. All eight currently succeed without review. The locked-child case instead rejects the default and offers two valid one-end alternatives. The hard target lock and stock limit reject without alternatives. This separates solvability, review availability, and intent; a passing characterization suite is not an intent-quality score.

Every accepted default/review candidate is checked for exact target and anchor, unchanged unlisted cuts and rotations, stable panel/joint/installed-piece identities, preserved saved rules without increased measured violations, no new validation issues, serialization round trip, and source immutability. Local resize also checks fixed neighbors and hardware world positions. Repeated solves from the same source must agree exactly. Geometry assertions use 0.001 mm tolerance; reports round to six decimals. These checks complement existing support, hardware-fit, and constraint suites rather than replacing them.

## Reproduce

```sh
npm test -- src/lib/resize-intent-benchmark.test.ts
RESIZE_BENCHMARK_REPORT=/tmp/resize-baseline.json npm test -- src/lib/resize-intent-benchmark.test.ts
```

The optional JSON report contains all labels, changed panel cuts and world translations, errors, review candidates, validation issues, hardware summaries, and environment/timing metadata. Without the environment variable the suite writes no report and repeats each solve once; reporting uses 20 repetitions. Timing excludes fixture creation, assertions, explicit validation, and reporting; the public solver's internal validation remains included. Review time measures `getResizeAlternatives` once, including its repeated default solve. The first invocation is not a fresh-process cold measurement. These small-sample timings are observations, not CI latency gates or browser preview budgets.

## Recorded baseline

Environment: Node v25.5.0, darwin/arm64, Apple M3 Max. One benchmark test file in one Vitest worker. All source and accepted candidate validation issue lists were empty. All repeated solves matched; both rejected cases retained the source. No production code was modified.

| Case | Default | Reviews | First ms | Warm median ms | Warm p95 ms | Review ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| single-numeric | Accepted | 0 | 2.978 | 0.086 | 0.129 | 0.249 |
| single-edge | Accepted | 0 | 0.174 | 0.053 | 0.066 | 0.001 |
| single-local-edge | Accepted | 0 | 0.087 | 0.048 | 0.064 | 0.000 |
| connected-local-edge | Accepted | 0 | 1.917 | 0.190 | 0.263 | 0.001 |
| overlap-199.99 | Accepted | 0 | 0.193 | 0.138 | 0.177 | 0.148 |
| overlap-200 | Accepted | 0 | 0.149 | 0.086 | 0.139 | 0.136 |
| overlap-200.01 | Accepted | 0 | 0.331 | 0.119 | 0.140 | 0.127 |
| occupancy-319.99 | Accepted | 0 | 0.309 | 0.070 | 0.088 | 0.106 |
| occupancy-320 | Accepted | 0 | 0.074 | 0.049 | 0.067 | 0.081 |
| occupancy-320.01 | Accepted | 0 | 0.115 | 0.063 | 0.101 | 0.072 |
| setback-139.99 | Accepted | 0 | 0.161 | 0.091 | 0.107 | 0.101 |
| setback-140.01 | Accepted | 0 | 0.103 | 0.085 | 0.093 | 0.094 |
| locked-child | Rejected | 2 | 1.232 | 0.655 | 0.947 | 1.178 |
| stock-limit | Rejected | 0 | 0.009 | 0.009 | 0.013 | 0.006 |
| locked-target | Rejected | 0 | 0.713 | 0.708 | 0.738 | 2.197 |
| unrelated-equal-cut | Accepted | 0 | 0.120 | 0.095 | 0.151 | 0.088 |
| angled-trays | Accepted | 0 | 8.327 | 4.746 | 6.270 | 5.151 |

### Observed geometry

Cuts and world translations below are in millimeters. Unlisted cuts and panel positions did not change beyond 0.001 mm. Rotations, IDs, and rules remained unchanged. Hardware summaries give installed count, maximum world movement, and maximum normalized rail-position change; these are measurements, not a general promise that connected resizing fixes hardware.

**single-numeric**

Default

- Panel: width 400 → 500; translation [0, 0, 0].

Hardware: 0 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**single-edge**

Default

- Panel: width 400 → 500; translation [50, 0, 0].

Hardware: 0 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**single-local-edge**

Default

- Panel: width 400 → 500; translation [50, 0, 0].

Hardware: 0 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**connected-local-edge**

Default

- Parent: height 400 → 500; translation [0, 50, 0].

Hardware: 2 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**overlap-199.99**

Default

- Parent: height 400 → 500; translation [0, 0, 0].

Hardware: 2 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**overlap-200**

Default

- Parent: height 400 → 500; translation [0, 0, 0].

Hardware: 2 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**overlap-200.01**

Default

- Parent: height 400 → 500; translation [0, 0, 0].
- Child: height 200.01 → 300.01; translation [0, 0, 0].

Hardware: 2 installed; maximum movement 50 mm; maximum rail-fraction change 0.

**occupancy-319.99**

Default

- Support: width 400 → 500; translation [0, 0, 0].

Hardware: 0 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**occupancy-320**

Default

- Support: width 400 → 500; translation [0, 0, 0].

Hardware: 0 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**occupancy-320.01**

Default

- Support: width 400 → 500; translation [0, 0, 0].
- Insert: width 320.01 → 420.01; translation [0, 0, 0].

Hardware: 0 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**setback-139.99**

Default

- Parent: height 600 → 700; translation [0, 0, 0].
- Child: height 400 → 500; translation [0, 0, 0].

Hardware: 2 installed; maximum movement 50 mm; maximum rail-fraction change 0.

**setback-140.01**

Default

- Parent: height 600 → 700; translation [0, 0, 0].
- Child: cuts unchanged; translation [0, 50, 0].

Hardware: 2 installed; maximum movement 50 mm; maximum rail-fraction change 0.

**locked-child**

Default rejected: This edit cannot keep the design rules and joints satisfied. Child height: exactly 300 mm. Edit or pause a rule first.

Review 1: Parent / Child: preserve setback at the parent’s bottom cut edge

- Parent: height 400 → 500; translation [0, 0, 0].
- Child: cuts unchanged; translation [0, 50, 0].

Hardware: 2 installed; maximum movement 50 mm; maximum rail-fraction change 0.

Review 2: Parent / Child: preserve setback at the parent’s top cut edge

- Parent: height 400 → 500; translation [0, 0, 0].
- Child: cuts unchanged; translation [0, -50, 0].

Hardware: 2 installed; maximum movement 50 mm; maximum rail-fraction change 0.

**stock-limit**

Default rejected: This move would exceed the panel size limits (40–4,000 mm). Try a smaller step.

**locked-target**

Default rejected: This edit cannot keep the design rules and joints satisfied. Child height: exactly 300 mm. Edit or pause a rule first.

**unrelated-equal-cut**

Default

- Parent: height 400 → 500; translation [0, 0, 0].

Hardware: 2 installed; maximum movement 0 mm; maximum rail-fraction change 0.

**angled-trays**

Default

- Storage shelf 1.1: cuts unchanged; translation [0, 8.112316, 0].
- Storage shelf 1.2: cuts unchanged; translation [0, -16.038853, 0].
- Storage upright 1.1: width 181.307 → 157.156; translation [0, -3.963269, 0].
- Storage upright 2.1: width 181.307 → 157.156; translation [0, -3.963269, 0].
- Storage shelf 1.3: cuts unchanged; translation [0, -40.190021, 0].
- Storage upright 1.2: width 181.307 → 157.156; translation [0, -28.114437, 0].
- Storage upright 2.2: width 181.307 → 157.156; translation [0, -28.114437, 0].
- Storage shelf 2.1: cuts unchanged; translation [0, 8.112316, 0].
- Storage shelf 2.2: cuts unchanged; translation [0, -16.038853, 0].
- Storage upright 3.1: width 181.307 → 157.156; translation [0, -3.963269, 0].
- Storage shelf 2.3: cuts unchanged; translation [0, -40.190021, 0].
- Storage upright 3.2: width 181.307 → 157.156; translation [0, -28.114437, 0].
- Shelf 1.2: cuts unchanged; translation [0, 40.190021, 0].
- Upright 1.1: width 319.62 → 400; translation [0, 0, 0].
- Upright 2.1: width 319.62 → 400; translation [0, 0, 0].
- Upright 1.2: width 324.744 → 284.554; translation [0, 20.095011, 0].
- Upright 2.2: width 324.744 → 284.554; translation [0, 20.095011, 0].
- Synth tray 1: cuts unchanged; translation [0, 40.190021, 0].
- Front stopper 1: cuts unchanged; translation [0, 40.190021, 0].

Hardware: 56 installed; maximum movement 40.19 mm; maximum rail-fraction change 0.

## Coverage limits and next session

This is the initial corpus, not the release gate for a new planner. The real 27-panel synth/storage fixture exercises angled trays/stoppers and saved equal-opening rules. Small fixtures cover numeric versus edge anchors, connected local hardware, unrelated equal dimensions, successful policy cliffs at all three documented thresholds, inferred-versus-authored conflict, and stock rejection.

The existing H-table, rotated synth/storage, T/cross removed-hardware, and preview suites remain regression coverage; keep their project families outside planner tuning as an initial holdout. Future stages must add labeled multi-selection-average anchors, arbitrary supported permutations/ID renaming, equivalent driving forests, rotated anchors, compartment alternatives, build-space cascades, fitted outlines/TROFAST, and linked assemblies before claiming those intent gates. No permutation failure, global continuity, exhaustive search, 50/200-panel performance, or real-user intent accuracy is established here.

Next is stage 1: introduce transient request/analysis/result boundaries and adapter-equivalence coverage while retaining this baseline policy. Stage 2 can evaluate semantic alternatives against the labels without changing active behavior. The threshold cases must eventually expose ambiguity or a documented coherent choice, rather than merely continuing to pass the current-output assertions.

## Verification for this session

- Benchmark report run: 17 cases passed, including 20 repeated solves per case.
- Focused regression run: 9 files, 176 tests passed (`resize-intent-benchmark`, `structure-edit`, `structure-resize-preservation`, `structure-cut-preferences`, `structure-design-constraints`, `resize-alternatives`, `h-table-resize`, `connector-resize`, and `preview-resize`).
- `npm run build`: passed; Vite retained its existing large-chunk warning.
- `git diff --check` and new-file whitespace/link checks: passed.
- Browser tests and React Doctor were not run: this session adds test-only code and documentation, with no interaction, rendering, persistence wiring, or React changes.
