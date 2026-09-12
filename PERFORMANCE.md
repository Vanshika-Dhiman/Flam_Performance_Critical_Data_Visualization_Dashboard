# PERFORMANCE.md

How the dashboard holds 60 fps with 10k–100k streaming points (and 59.6 fps at 250k), what was measured, and why it is
built this way.

All numbers below come from `scripts/benchmark.mjs` and the in-app benchmark, run against the **production build**
(`npm run build && npm start`). The raw JSON is in `benchmark-results/`.

**Test environment**

| | |
| --- | --- |
| Machine | Apple M5 (10 cores), 16 GB RAM, macOS 26.5 |
| Browser | Google Chrome 152.0.7977.83, **headless** via `playwright-core`, `--enable-precise-memory-info` |
| Viewport | 1440 × 2200 CSS px, DPR 1, so **all four charts and the table are on screen and drawing** |
| Build | `next build` (Next.js 15.5.25, React 19.2.0), served by `next start` |

> **How to read the FPS numbers.** Headless Chrome paces frames at 60 Hz and never exceeds that, so "60 fps" means no
> frame missed its deadline. The number that shows **headroom** is *draw ms*: main-thread time per frame spent in all
> render tasks, against a 16.7 ms budget. This is an inference, not measured here: the averages (1.8–4.3 ms) also fit a
> 120 Hz budget of 8.3 ms, but the 50k scenario's p95 (8.3 ms) is right at that edge. Run
> `npm run benchmark -- --headed` on a high-refresh display to measure it with real GPU compositing.

---

## 1. Benchmarking results

### 1.1 Load scenarios (in-app benchmark, 8 s of measured frames each, after buffer fill and 1.5 s warm-up)

Every frame interval is recorded by a render-loop task. *Draw ms* is the main-thread time spent inside all render tasks
in that frame: the four canvases, SVG axis patching and tooltips. *Worker ms* is the aggregation time on the worker
thread, which does not block frames.

| Scenario (buffer · ingest) | Avg FPS | 1% low FPS | p99 / max frame | Dropped frames | Draw ms avg (p95) | Worker ms | Long tasks | JS heap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **10k points · 100 pts/s** | **60.0** | 59.5 | 16.8 / 16.8 ms | 0 / 479 | 1.81 (4.3) | 0.26 | 0 | 15.3 MB |
| 10k points · 2.5k pts/s | 60.0 | 59.5 | 16.8 / 16.8 ms | 0 / 479 | 1.96 (5.0) | 0.19 | 0 | 18.8 MB |
| **50k points · 10k pts/s** | **60.0** | 59.5 | 16.8 / 16.8 ms | 0 / 479 | 2.51 (8.3) | 0.77 | 0 | 15.7 MB |
| **100k points · 10k pts/s** | **60.0** | 59.5 | 16.8 / 16.8 ms | 0 / 479 | 3.06 (4.2) | 1.46 | 0 | 19.4 MB |
| 250k points · 25k pts/s | 59.6 | 59.5 | 16.8 / **33.4** ms | **3 / 476** | 4.31 (4.4) | 2.69 | 0 | 19.5 MB |

These are from the final build (`benchmark-results/2026-09-11T12-36-14-143Z-headless.json`). An earlier run on the build
before the last two small changes (`…12-23-29-282Z-headless.json`) had 0 dropped frames in all five scenarios, including
250k, with draw averages of 2.01 / 1.94 / 2.84 / 3.77 / 5.89 ms. Run-to-run variation at the extreme load is therefore a
few frames per 8 s.

Against the assignment targets:

| Target | Required | Measured |
| --- | --- | --- |
| 10,000 points | 60 fps steady | 60 fps, 0 dropped frames, 1.8 ms draw per frame |
| Real-time updates | no frame drops | 0 dropped frames from 100 to 10,000 points/s ingest. At the extreme 250k points · 25k points/s, 3 of 476 frames dropped (worst frame 33 ms) in the final run and 0 in the earlier run |
| 50,000 points (stretch) | ≥ 30 fps | 60 fps, 0 dropped, 2.5 ms draw |
| 100,000 points (stretch) | ≥ 15 fps, usable | 60 fps, 0 dropped, 3.1 ms draw |
| Main thread | no blocking | 0 long tasks (> 50 ms) during every scenario |

Heap readings are `performance.memory` at the end of each scenario, taken without a forced GC, so they include
collectable garbage. Section 1.2 has GC-controlled numbers.

### 1.2 Memory

**Soak test**: `npm run benchmark -- --soak=600`. 10,000-point buffer, 50 samples per batch (500 points/s, so the whole
buffer turns over every 20 s), with all charts and the table on screen. The heap is read every 10 s **after a forced
garbage collection** (`HeapProfiler.collectGarbage` → `Runtime.getHeapUsage`), so it measures retained memory, not
garbage. The soak ran on the build just before the final two changes: a CSS fix for the mobile sparkline, and removing
two small per-frame array allocations in the line renderer. Neither should raise retained memory, but the soak has not
been repeated on the final build. Raw data: `benchmark-results/2026-09-11T12-23-29-282Z-headless.json`.

| Metric | Result |
| --- | --- |
| Duration / samples | 600 s / 60 heap readings |
| Retained heap, start → end | **7.08 MB → 7.05 MB** |
| Retained heap, min / max | 5.63 MB / 7.28 MB |
| Least-squares trend | **+1.29 MB / hour** |
| FPS during soak | avg 59.9, min 59 |

**Interpretation, stated honestly.** Over the 10 minutes, the retained heap ended slightly *below* where it started,
through about 30 full turnovers of the buffer. The regression slope is nominally above the 1 MB/hour target. But the
readings move within a ±0.8 MB band of collector noise, and ten minutes is too short to tell a real trend from that noise
at this resolution. I have not claimed the < 1 MB/hour target as met. A multi-hour run
(`npm run benchmark -- --soak=7200`) is the right way to settle it.

Why the design should stay flat regardless:

- The ring buffer is allocated once per capacity: 17 B × 10k = 170 KB, or 4.25 MB at 250k.
- Worker transfers recycle buffers in both directions.
- Per-frame scratch memory (M4 arrays, density grid, `ImageData`, tick arrays, SVG and tooltip nodes) is reused.
- Every history the performance HUD keeps is fixed-size.
- User Timing entries are cleared as soon as they are emitted.

Across the final-build load scenarios, heap sampled *without* forced GC stayed between 15.3 and 19.5 MB, including at
250k points.

### 1.3 Page load and interaction

**Page load** (production server on localhost, so network time is negligible; this isolates server and render cost):

| Metric | Result |
| --- | --- |
| TTFB | 7.4 ms (static ISR page) |
| First Contentful Paint | 76 ms |
| Largest Contentful Paint | 76 ms |
| Cumulative Layout Shift | 0.00003 |
| DOMContentLoaded / load | 47 ms / 74 ms |

Final-build run. The earlier run measured TTFB 6.5 ms, FCP/LCP 68 ms, and DOMContentLoaded/load 35 / 55 ms.

**Interaction latency** (target < 100 ms). The scripts perform 5 drag-pans and 5 Ctrl+wheel zooms on the line chart,
double-clicks, and aggregation, region and time-range changes (18 control clicks), plus 10 arrow-key pans.

| Measurement | Result |
| --- | --- |
| Event Timing API (input timestamp → next paint), all events ≥ 16 ms | max **48 ms** (n = 593) |
| In-app HUD "Input → frame" (event timestamp → end of the frame that drew it), worst in last 5 s | 46 ms |
| Input **delivery** delay (event timestamp → handler start) | keydown p50 0.1 ms, click p50 0.6 ms, pointermove p50 13 ms, **wheel p50 44 ms** |
| Handler start → start of the frame *after* the updated frame (a one-frame upper bound) | p50 15.6 ms, p95 29.4 ms, max 31.3 ms |

Every interaction came in under the 100 ms target, including the delivery delay. Most of the 46–48 ms is delivery: wheel
events injected by the automation protocol reach the page about 44 ms after their timestamp in headless Chrome, while
keydown arrives in 0.1 ms. The part the app controls is at most one frame plus draw time. The handler only mutates the
viewport store or dispatches, and the next animation frame draws the result, which is why the upper bound above is about
one frame (15.6 ms p50). I expect real-hardware input to be closer to the keydown figures, but that was not measured here.

### 1.4 Bundle

| Asset | Raw | gzip |
| --- | --- | --- |
| `/dashboard` page JS (charts, hooks, engines) | 89.8 KB | **29.0 KB** |
| Aggregation worker chunk | 3.3 KB | 1.6 KB |
| CSS | 15.4 KB | 4.1 KB |
| First-load JS for `/dashboard` (Next.js report, includes React + Next runtime) | — | **132 KB** (budget 500 KB) |
| HTML with the 10k-point initial dataset embedded | — | ~46 KB |

There are zero runtime dependencies besides `next`, `react` and `react-dom`.

---

## 2. React optimisation techniques

The guiding rule: **React owns structure, the render loop owns pixels.** Streaming data and pointer movement never go
through React state.

| Technique | Where | Effect |
| --- | --- | --- |
| **Mutable engines outside React** | `TimeSeriesStore`, `ViewportStore`, `AggregationEngine`, `RenderLoop` created once in `DataProvider` (`useState(() => createCore())`) | A 100 ms data tick costs 0 React renders. Charts compare `store.version` / `viewport.version` each frame. |
| **Context split by change frequency** | `CoreContext` (never changes), `ControlsContext` (user input only), `DispatchContext` (stable), `BackfillContext` | Buttons that only dispatch never re-render when filters change; nothing re-renders on data. |
| **`React.memo` on every chart and panel** | all `components/**` | The dashboard parent never cascades renders into charts. |
| **Latest-ref pattern** | `useChartRenderer` keeps `draw` / `needsDraw` in refs | The rAF registration, ResizeObserver and IntersectionObserver are created once per mount, not on every render. |
| **`useCallback` / `useMemo`** | chart draw callbacks, table index (`useMemo` keyed on deferred filters + throttled tick), theme context value | Stable identities for the loop and memoised children. |
| **`useTransition`** | `FilterPanel` (slider → global filter), aggregation and region toggles, window-size and stress-mode changes | Slider thumbs update urgently from local state; the global update and its re-render are interruptible. |
| **`useDeferredValue`** | `DataTable` filters | Re-indexing up to 250k rows renders at low priority, and the stale list is dimmed instead of blocking input. |
| **`useSyncExternalStore`** | `TimeRangeSelector` (viewport *mode* only), `useUiTick`, `useIsClient` | Tear-free subscriptions to external stores. The selector ignores per-frame domain changes. |
| **Batched low-frequency UI clock** | `lib/uiTicker.ts` | KPI tiles, legend values and the table update at ≤4 Hz in one batched commit, and not at all when data didn't change. |
| **Virtualisation** | `useVirtualization` + memoised `TableRow` with primitive props | About 20 DOM rows for 250k samples. State updates only when the first/last visible index changes. |
| **StrictMode-safe resource lifecycle** | Worker, rAF task, observers, timers attached in effects with cleanup | The mount → unmount → mount cycle in dev leaves no duplicate workers or loops (verified: no console errors, 8 commits/s in dev). |
| **Error boundaries** | `ChartErrorBoundary` per chart; render-loop exceptions re-thrown during render | One failing chart shows a retryable fallback; the rest keep running. |

**React commits during steady streaming** (dev build, Profiler API): about **8 per second** observed. That matches the
readouts that are designed to update: the ≤4 Hz UI ticker and the 2 Hz performance card. By construction, chart
components re-render only when controls or the theme change. I did not attribute each commit with the DevTools Profiler;
that is how to verify it. In production the `<Profiler>` callback is compiled out, so the HUD shows "dev/profile build";
use `npm run build:profile` to see it there.

---

## 3. Next.js performance features

| Feature | Decision |
| --- | --- |
| **Server Components** | `app/dashboard/layout.tsx`, `components/Dashboard.tsx` and `DashboardSkeleton` are Server Components: layout markup with zero client JS. Client islands are only the leaves that need state, effects or the DOM. |
| **Server data → client** | `lib/server/initialData.ts` (`server-only`, React `cache`) generates the first 10k samples. It sends them as base64 **Uint16 columns** (latency × 10, request counts; time and category are implied), about 54 KB instead of about 1.2 MB for 10k JSON objects. Measured: `/api/data?format=json` returns 588 KB for
5,000 points, and the binary format is 40 KB for 10,000. It also sends the serialised PRNG state, so the client stream continues seamlessly. |
| **SSG + ISR** | `/dashboard` has `revalidate = 60`: pre-rendered at build and regenerated at most once a minute. TTFB is a static-file hit. Staleness doesn't matter because the generator resumes from the embedded state. |
| **Streaming / Suspense** | `<Suspense fallback={<DashboardSkeleton/>}>` around the async data component, plus `loading.tsx` for client navigation. When the page renders on demand (e.g. `next dev`), the skeleton streams before the data. In production, ISR regenerates the page in the background, so visitors receive the finished HTML. The skeleton uses the same heights from static config, so CLS ≈ 0. |
| **Route Handlers** | `/api/data` on the **edge runtime**, binary or JSON, deterministic for `(points, end, seed)`, so it is CDN-cacheable with an explicit `end`. It sends `Server-Timing`. `/api/config` is **force-static**. |
| **Middleware** | Validates `/api/data` query parameters at the edge (400 before any work) and adds `X-Request-Id`. |
| **Bundling** | Worker code-split via `new Worker(new URL('../workers/aggregation.worker.ts', import.meta.url))`; `removeConsole` in production; no chart or state libraries; system font stack (no font request). |
| **Hydration hygiene** | Timezone-dependent text (table times, axis labels) is rendered only after hydration (`useIsClient` / imperative SVG). The theme is applied by an inline script before paint. |

---

## 4. Canvas integration

### 4.1 One render loop, dirty-checked charts

`lib/renderLoop.ts` runs **one** `requestAnimationFrame` loop for the page:

```
frame ─┬─ priority -100: viewport.advance(dt)          (eases the live edge toward newest sample)
       ├─ priority    0: LineChart   needsDraw? → draw  (store.version / viewport.version changed)
       ├─ priority    0: BarChart    needsDraw? → draw  (engine.version / viewport.version)
       ├─ priority    0: Heatmap     needsDraw? → draw
       ├─ priority    0: ScatterPlot needsDraw? → draw  (store.version / visible index range)
       └─ record frame interval + main-thread cost; resolve input→frame latency
```

- Charts skip the frame when nothing they depend on changed; a skipped chart does only a version comparison. Observed
  on the mobile screenshot run, where the charts were off-screen: the HUD read 0.01 ms of render-task time per frame.
- Charts scrolled out of view skip drawing (IntersectionObserver) and redraw once when they return.
- A task that throws is removed and its error is re-thrown into React, where an error boundary catches it.

### 4.2 `useChartRenderer` (React ↔ canvas bridge)

- `useRef` for canvas/container. The context is `getContext('2d', { alpha: false })`, so the compositor doesn't blend the
  canvas with the page.
- The ResizeObserver stores CSS size. The backing store is resized **inside the frame**, right before drawing, so a
  resize never shows a blank canvas. The DPR is capped at 2.
- `useEffect` cleanup unregisters the loop task and disconnects both observers and the window listener.

### 4.3 Canvas + SVG hybrid

| Layer | Content | Why |
| --- | --- | --- |
| Canvas | lines, bars, heat cells, density dots, gridlines | Thousands of marks; drawing cost is independent of DOM size. |
| SVG (`pointer-events: none`) | axis labels, crosshair, selection brush | Crisp text at any DPR, cheap to move, and uses CSS theme tokens. |
| HTML | tooltip | Text wrapping and theming; updated with `textContent` (never `innerHTML`). |

Axis labels move every frame while live. `lib/svgAxis.ts` keeps a pool of `<text>` nodes and writes an attribute only when
its value changed, so there is no React reconciliation per frame.

### 4.4 Level of detail per chart

| Chart | LOD strategy | Cost bound |
| --- | --- | --- |
| Line | ≥ 0.5 samples per device px → **M4** (first/min/max/last per pixel column per series), drawn pixel-exact; otherwise raw vertices | ≤ 4 × width × 5 vertices, whatever the point count |
| Bar | Buckets < 3 px merge into fixed index-aligned groups (no shimmer while panning) | ≤ width / 3 bars |
| Heatmap | Worker pre-renders RGBA (1 texel per bucket × band); main thread uploads once per result, then one `drawImage` per frame. Filtered when downscaling, crisp when upscaling | One GPU blit per frame |
| Scatter | Density grid (2×2 CSS px cells), log colour LUT, one `putImageData`; redraw only when the visible index range or data changed | O(visible samples + cells) |
| Table | Virtual rows | ~20 DOM rows |

### 4.5 Memory management

- **Ring buffer** (`lib/ringBuffer.ts`): four typed arrays (Float64 time, Float32 value, Float32 requests, Uint8
  category), 17 bytes per sample, allocated once per capacity. 250k samples use 4.25 MB. Eviction is an overwrite: no
  arrays grow, no objects are created per sample.
- **Zero-garbage worker transfer**: the main thread copies the buffer into pooled columns, **transfers** them to the
  worker, and the worker transfers them back with the results. Result buffers from the previous update are sent back for
  reuse (`createBufferPool`). In steady state neither side allocates large buffers.
- **Reused scratch memory**: M4 arrays, density grid, `ImageData`, tick arrays, tooltip nodes and axis nodes are all
  reused across frames.
- **Bounded instrumentation**: FPS, heap, long-task and latency histories are fixed-size `RollingSeries`. User Timing
  measures are cleared right after they are emitted, so the performance timeline doesn't grow.
- **Cleanup**: every `setInterval`, rAF task, observer, event listener, `AbortController` (backfill fetch) and the worker
  are released in effect cleanups. Streaming also pauses while the tab is hidden.

---

## 5. Scaling strategy: server vs. client

### 5.1 What runs where, and why

| Work | Location | Reason |
| --- | --- | --- |
| Initial 10k samples | Server Component at build / ISR | First paint shows real data; the compact encoding keeps HTML at ~46 KB gzip. |
| History backfill (50k–250k) | Edge route handler, binary | Close to the user, cacheable, and doesn't bloat the HTML for visitors who never change the window. |
| Live stream | Client (main thread) | Simulates a socket. Generation is a few arithmetic operations per sample written straight into the typed arrays (not separately profiled); the 25k points/s scenario recorded no long tasks. |
| Aggregation (buckets, heat grid, percentiles) | Web Worker | O(n) over up to 250k samples every 100 ms must never compete with frames. |
| Rasterisation | Client canvas | Interactive zoom/pan at 60 fps needs local pixels. |

### 5.2 Bottlenecks found while building

**Where the frame budget goes now.** *Measured (final build):* total draw time per frame grows from 1.8 ms at 10k points to
4.3 ms at 250k, and worker aggregation from 0.26 to 2.69 ms. *Not measured per chart; inferred from the algorithms:* the
roughly constant part is canvas command recording for four charts plus SVG and tooltip patching. The part that grows
with point count should be the two O(visible samples) passes, the line chart's M4 bucketing and the scatter's density
binning, since bar and heatmap only read pre-aggregated buckets. A per-renderer timing breakdown is the next thing I would
add to the HUD to confirm this. The aggregation engine never queues more than one worker request, so a slower worker
lowers the update rate of bars and heatmap rather than the frame rate.

**Design choices and the problems they avoid.** Each row describes a cost the naive React + canvas approach pays. These
are reasoned from how each approach works; I did not build and benchmark the naive versions for comparison.

| Naive approach | Problem | What this project does instead |
| --- | --- | --- |
| Data in `useState`, `setData([...data, ...batch])` every 100 ms | Allocates a 10k–250k element array, re-renders every chart 10×/s, GC pauses over time | Typed-array ring buffer mutated in place; renderers compare a version number |
| One `requestAnimationFrame` per chart (the sample pattern in the brief) | N loops that restart on every render; charts in one frame read different data versions | One shared loop, priority-ordered, dirty-checked |
| `fillRect` per scatter point | ~250k draw calls per frame at the top scenario | Density grid + single `putImageData` |
| `putImageData` of the heatmap every frame | Megabyte-scale pixel upload per frame at 1-min buckets over 250k samples | Upload once per aggregation result to an off-screen bitmap; per frame only `drawImage` |
| Axis ticks as React children | Reconciling tick nodes on every frame while live-scrolling | Pooled SVG `<text>` nodes, attributes written only on change |
| Posting the buffer to the worker by structured clone | Clones megabytes 10×/s, producing main-thread GC sawtooth | Transfer + ping-pong buffer recycling |
| Live scroll by jumping the domain on each batch | A 10 s step jumps ≈ 3 px on a 1-hour window and ≈ 13 px on a 15-minute window (1,200 px plot), 10 times a second | Frame-rate-independent easing of the live edge (`viewport.advance`) |
| Measuring with a 1440 × 900 viewport | Charts below the fold skip drawing (IntersectionObserver), inflating results | Benchmarks use a 1440 × 2200 viewport so every renderer is measured |

**Found during testing.** A `next dev` server started in the same folder as a running `next start` overwrites `.next`
and breaks the production server's chunk loading. Benchmarks therefore always run from a clean `next build`.

### 5.3 Going further

- **1M+ points.** Keep the ring buffer in a `SharedArrayBuffer` (with COOP/COEP headers) so the worker reads it without
  copying. Make aggregation incremental (update only the newest bucket and subtract evicted samples) and build a min/max
  pyramid (multi-resolution M4) so the line chart touches O(pixels) samples instead of O(visible samples). Move line
  rendering to an `OffscreenCanvas` in a worker, or to WebGL instanced lines.
- **Updates every 10 ms.** Batching already coalesces work: charts draw at most once per frame and the aggregation engine
  keeps one request in flight. At 100 Hz ingest I would batch socket messages into the ring buffer and leave draw cadence
  at rAF.
- **SSR.** Static shell + ISR snapshot (as now). For per-user data, move to dynamic rendering with Partial Prerendering:
  static shell, streamed data hole.
- **Offline.** A service worker caching the app shell and `/api/config`, with the last buffer persisted to IndexedDB as
  the same binary columns, restored on load.
- **Real-time collaboration.** Share *viewport and filter state*, not data: broadcast `{mode, start, end, filters}` over a
  WebSocket or WebRTC data channel, apply it through the same `ViewportStore` / reducer actions, and show other users'
  cursors and brushes on the SVG overlay layer.
