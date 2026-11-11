# Startup performance

[Documentation index](README.md)

## Repeatable check

Run `npm run check:startup` with Playwright Chromium installed. It builds production output, serves it locally with gzip and no HTTP caching, then runs three fresh browser contexts. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an existing Chromium binary. The JSON report is written to `test-results/startup-performance.json` (generated, not committed).

`npm run profile:startup -- --runs 5 --output /tmp/playwood-profile.json` records a different sample count or destination. To profile an existing build, run `node scripts/profile-startup.mjs --check`. Budget values live in [`scripts/startup-budget.json`](../scripts/startup-budget.json):

| Metric | Limit | Enforcement |
| --- | ---: | --- |
| Requested JavaScript, gzip bytes | 830,000 | Fails `--check` |
| Median first scene draw | 8,500 ms | Advisory; `--check --check-timing` makes it mandatory |
| Median first interaction | 200 ms | Advisory; `--check --check-timing` makes it mandatory |

The payload budget includes synchronous room scenery with about 4% headroom over the restored baseline. Inspect the report's requested asset list when it grows. Timing is advisory on heterogeneous machines; use a stable runner before enforcing it. Browser exceptions fail profiling. Run `tests/deferred-preview.spec.ts` for export download failure recovery and `tests/scene-switching.spec.ts` for repeated switches with complete scenery and fitted cameras.

## Method and limits

The profiler uses Chromium, a 1440×900 viewport at DPR 1, 4× CPU slowdown, 1.6 Mbps download, 0.75 Mbps upload, 150 ms emulated latency, and SwiftShader. HTTP caching is disabled and each run has fresh browser storage. All runs share a Chromium process, so GPU/process caches may warm; the first run is reported separately in the JSON samples. This is a slower-device approximation, not a physical-device or deployed-CDN measurement.

First scene draw records the first WebGL draw submitted on the editor canvas. It does not prove every object is painted or the GPU has finished. The interaction clicks **Show dimensions** after the first draw and measures pointerdown through two animation frames following the button's pressed-state update; it is a next-paint approximation, not INP. FCP and observed main-thread long tasks are diagnostic. JavaScript bytes sum requested assets, including workers, through that interaction using local gzip compression; CSS, images, headers, and later optional downloads are excluded. The report preserves per-run asset sizes and timings.

## 2026-11-11 rejected scene-loading experiment

These historical measurements describe the lazy-room experiment, which was reverted after user testing found jumpy transitions. Three runs before and after deferring room scenery and the 3D export entry point, Chromium 156.0.8078.4 with the profile above:

| Median | Before | After |
| --- | ---: | ---: |
| Startup JS, gzip bytes | 796,682 | 679,781 |
| First scene draw | 6,178 ms | 5,672 ms |
| FCP | 5,188 ms | 4,648 ms |
| First interaction | 94 ms | 116 ms |
| Long-task total | 2,588 ms | 2,693 ms |
| Longest task | 1,013 ms | 1,046 ms |

First-draw samples were 9,101 / 6,164 / 6,178 ms before and 8,354 / 5,661 / 5,672 ms after. Startup gzip JavaScript fell 116,901 bytes (14.7%). The draw median improved by about 0.51 seconds in this sample; interaction and long-task results do not establish an improvement. Do not generalize these small samples into device-wide guarantees.

Room scenery is now synchronous again. Perspective switches reuse the camera and fit it in a layout effect before drawing. `LazyBlenderExport` defers only export controls; shared scenery is already in the initial graph. The 14.7% reduction above does **not** describe the current implementation. The main chunk still exceeds Vite's 500 kB warning threshold. A physical slower-device check and further editor/vendor profiling remain follow-up work.

A single production smoke profile after restoring synchronous scenery requested **795,381 gzip JS bytes**, submitted its first scene draw at **8,752 ms**, and measured the first interaction at **96 ms**. The payload budget passed; the 8,500 ms advisory draw target was exceeded. This single cold run is not comparable to the three-run medians above.
