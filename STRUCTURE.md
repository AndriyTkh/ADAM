# ADAM Demo — Architecture Plan

Single-page Kyiv air-quality map. Production-shaped frontend, real Python backend.
Backend owns all computation (interpolation, stats, ML). Frontend is a pure
render/query client. **This file is the single source of truth** (prior `.md`
briefs are superseded and will be removed).

---

## Locked Decisions

| Area | Choice | Why |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Typed contracts, component UI, release-grade |
| Map engine | MapLibre GL JS + `react-map-gl` | WebGL vector base, custom WebGL layer support, native raster overlay |
| GL target | **WebGL2 (required)** | Single-channel `R8` data texture, `texSubImage2D` fast path. Fail fast if unavailable. |
| Heatmap render | **GPU custom layer (shader)** | Backend ships value grid; shader colors it. Free spatial smoothing, tweening, tiny payload. |
| Heatmap fallback | **Bounds-PNG, backend dual-emit from day one** | Insurance. Endpoint built now, frontend unwired until needed. |
| Backend | Python + **FastAPI (confirmed)** | Async, pydantic typed contracts, geospatial, ML-ready |
| Interp lib | **scipy (IDW/RBF) → numpy → bytes** | Simplest path. datashader/rasterio only if scaling forces it. |
| Mock location | **Backend, not frontend** | Frontend talks to one API. Mock vehicles swap → real hardware = backend-only change |
| Repo | Monorepo, **2 git worktrees** | `frontend/` + `backend/` worktrees for parallel workflow |
| Data cadence | **10-minute buckets (our ML grid)** | Our own ML pipeline emits grids ~10 min apart. NOTE: OpenAQ sensors are independent — 3 Kyiv stations @ 1/hour (see Sensors). |
| AQI standard | **EU EAQI** | EU/CSRD context. Composite + per-pollutant EU/WHO scales |
| MVP pollutants | **AQI, PM2.5, NO₂, CO** | Manageable demo set; data-driven mechanism scales to ~14 by config, not rewrite |
| Grid resolution | **256²** | 64KB/bucket Uint8, tiny. Immutable caching makes payload a non-issue. |
| API versioning | **`/v1/` prefix** | Cheap now, painful later |

---

## Core Concept: Discrete 10-min Time Buckets

All data keyed to a 10-min grid (`T12:00`, `T12:10`, ...). Drives everything —
heatmap grid, sensor readings, vehicle positions, point queries — addressed by a
bucket timestamp.

Two navigation modes (global `timeState`):

| Mode | Behavior |
|---|---|
| **Single-bucket nav** | Live (latest bucket, poll ~10 min), jump-to-date (calendar), step ±10 min. |
| **Range playback** | Select start+end range (cap below) → batch preload → play / pause / rewind / speed scrub across that frozen window. |

Fast-forward-from-now dropped (interesting stress test, not scope-friendly).
Replaced by **bounded range playback** — user picks the window, backend batches it.

### Variable step size (nav + replay)
- **Step size is a first-class param**, range **10 min → 1 day**. Applies to BOTH:
  - *Single-bucket nav:* step ±step (10m / 30m / 1h / 6h / 1d), not fixed ±10 min.
  - *Range playback:* playback advances by step; server `stride` matches step.
- Step maps directly to server-side `stride` (decimate buckets at source). Smaller step
  = denser frames = more memory/wire; larger step = coarser, lighter.
- Step is clamped per range length to keep resident set bounded (see range cap).

### Range cap (memory-driven, range-dependent)
- Hard cap **2 weeks**. 2wk @ step 10m = 2016 buckets × 64KB = ~129MB raw — too big resident.
- **Never preload as textures.** Raw bytes in a RAM ring buffer (below).
- **Two independent bounds:**
  1. *Ring buffer* caps RESIDENT memory: fixed ~300 buckets ≈ 19MB, regardless of frame count.
  2. *Step clamp* caps TOTAL frames per request (wire + precompute + decode), see table.
- Default suggested range small (~3 days @ step 10m ≈ 28MB raw, <5MB wire).

### Step → min-step clamp table (locked)
Rule: **min allowed step = smallest step keeping total frames ≤ 1500** (`frames = range / step`),
snapped up to the next allowed step `[10m, 30m, 1h, 6h, 1d]`. User may always pick a
coarser step than the minimum.

| Range length | Frames @10m | Min step | Frames @min-step | Allowed steps |
|---|---|---|---|---|
| ≤ 1 day      | ≤144   | **10m** | ≤144  | 10m,30m,1h,6h,1d |
| ≤ 3 days     | ≤432   | **10m** | ≤432  | 10m,30m,1h,6h,1d |
| ≤ 7 days     | ≤1008  | **10m** | ≤1008 | 10m,30m,1h,6h,1d |
| ≤ 10 days    | ≤1440  | **10m** | ≤1440 | 10m,30m,1h,6h,1d |
| ≤ 14 days    | ≤2016  | **30m** | ≤672  | 30m,1h,6h,1d |

- Backend rejects (422) a `step` below the range's min-step. Frontend step selector
  greys out disallowed steps live as range changes.
- Frames ≤1500 → blob worst case (30m, 14d, 672 frames, mostly delta+brotli) stays small;
  10-day @10m = 1440 frames is the heaviest dense case — measure it (Open Item #6).

---

## Playback & Step-Switch Engine (the perf core)

Four bottlenecks, **each solved by a different layer** — never one fix for all.

| Bottleneck | Solution |
|---|---|
| HTTP req overload | 1 batched range request, day-chunked, ≤3–6 parallel |
| Loading speed | stream + play-when-first-chunk-buffered (not whole range) |
| Browser memory | raw bytes in RAM ring buffer; only 2 GPU textures ever |
| MapLibre redraw | `texSubImage2D` into persistent texture + `triggerRepaint`; never touch layer graph |

### Data flow
```
fetch (chunked, Content-Encoding: br → browser auto-decompresses)
  → Web Worker (delta-decode ONLY) → transfer Uint8Array (zero-copy)
  → RAM ring buffer (evicting)
  → render loop: texSubImage2D into 1-of-2 textures + mix() uniform + map.triggerRepaint()
```

> **Brotli decode = browser, not worker.** JS has no native brotli decompress
> (`DecompressionStream` = gzip/deflate only). Server sends `Content-Encoding: br`;
> browser transparently decompresses at the fetch layer. Worker receives already-
> decompressed bytes and only does delta-decode. Avoids bundling a brotli WASM lib.
> (If we ever need manual control, send raw `octet-stream` + `brotli-wasm` — not the
> default path.)

### Backend — one packed, compressed, delta-encoded blob
```
GET /v1/grid/{pollutant}/range?from=&to=&step=
→ [header][frame0][frame1]...   (Content-Encoding: br, browser auto-decompresses)
   header: magic, ver, dims(u16²), bbox(f32×4), scaleMin/Max(f32×2),
           bucketCount(u32), tIndex[] (per-frame ISO bucket),
           frameType[] (0=keyframe full, 1=delta vs prev present frame)
   frames: delta-encoded vs previous PRESENT bucket (slow spatial change → mostly zero → brotli crushes)
```
- **Missing buckets = frameskip.** Absent bucket is omitted from the blob entirely
  (not zero-filled). `tIndex[]` carries actual present timestamps; gaps are implicit.
  Delta is computed vs the previous *present* frame, so a skip never corrupts the chain.
  Playback holds last frame across a gap, advances on next present `tIndex`.
- **Keyframe rule:** first frame always keyframe; emit a keyframe after any gap and
  **every 60 frames** (`KEYFRAME_INTERVAL = 60`). Bounds error drift + lets scrub seek
  by decoding from nearest prior keyframe (≤59 deltas), not whole chain. Worker keeps
  last keyframe + applies deltas forward to target. 60 @256² = ~1 keyframe / 3.8MB raw —
  cheap vs seek latency.
- Delta + brotli: ~129MB raw → target <15MB wire for 2wk (MEASURE early — noisy ML
  output weakens delta). Backend precomputes + caches.
- **Immutable cache headers** on all historical buckets/ranges → replay #2 = 0 network.

### Network
- Split range into day-chunks; ≤3–6 parallel. Play starts on **first chunk**.
- Buffer-ahead queue: keep playhead N buckets behind download frontier; pause only if frontier caught.

### Memory — RAM ring buffer
- Decoded Uint8 grids held as `Uint8Array`s, fixed window (~300 buckets ≈ 19MB @256²).
- Evict oldest as playhead advances. Memory flat regardless of range length.
- GPU: exactly **2 textures** (current + next for tween), reused via `texSubImage2D`, never per-frame alloc.

### MapLibre redraw (critical)
- **Never** `addLayer`/`removeLayer`/`setData` on heatmap during playback (triggers style diff + full repaint).
- Custom layer holds 2 persistent `WebGLTexture`s. Per frame: `texSubImage2D` (~sub-ms for 64KB) → set `u_mix` → `triggerRepaint()`.

### Fast step-switch (±10 min) + scrub
- Same path: grab grid from ring buffer (RAM) → `texSubImage2D` → repaint. **Instant, no network** when buffered.
- Scrub outside window → single-bucket fetch (`/v1/grid/{pollutant}/{t}.bin`); hold last frame until it lands (no spinner flash).

### Decode off main thread
- **Delta-decode** in **Web Worker**, post transferable `Uint8Array`. Keeps 60fps render
  loop clean. (Brotli already handled by browser at fetch layer — see Data flow note.)

### Tween guards
- `mix()` only between adjacent `t` of **same pollutant**. Pollutant switch → hard swap, no tween (different scale).

---

## Heatmap: GPU Shader

### GPU value-grid + shader (MapLibre custom layer) — primary render path
- Backend taps interpolation pipeline **before rasterization** → per-pollutant
  **Uint8 single-channel value grid** per bucket (1 byte/cell), WebGL2 `R8`.
- Frontend uploads grid as data texture; fragment shader maps value → color via
  **per-pollutant color ramp**. Quad pinned to Kyiv mercator bounds.
- **Wins:** GPU linear filtering smooths coarse grid (256²) into continuous heatmap
  for free; `mix()` tween between buckets; tiny payload; mobile-friendly (Uint8).
- **Per-pollutant grids, active-only fetch:** view one pollutant at a time → fetch
  only that pollutant's series on tab switch. Scales to ~14.

### Known shader gotchas (locked mitigations)
- **WebGL2 required** — `R8`/`RED` single-channel. Fail fast with message if absent.
- Grid dims **multiples of 4** (UNPACK_ALIGNMENT safety). 256² satisfies.
- Uint8 = 256 levels → mild banding possible on wide ranges; acceptable for demo.
- **Mercator skew** at Kyiv lat (~50.4°): grid is equal-lat-spacing; do mercator
  transform in vertex shader (or pre-project backend-side). Small but real.
- Context-loss handler → re-create textures on `webglcontextrestored`.

### Bounds-PNG fallback — built backend-side now, unwired
- One Kyiv-bounds PNG per bucket, dual-emitted cheaply from same grid. Zero-risk
  insurance if shader path breaks in demo. Endpoint exists; frontend wires only if needed.
- XYZ raster tiles: deferred, not built.

---

## Pollutants — data-driven (not hardcoded)

```
GET /v1/pollutants → [{ key, label, unit, group, scale, available }]
  group:  "PM" | "NOx" | "SOx" | "carbon"        # sensor method / module
  scale:  ramp id → per-pollutant color mapping
  available: bool                                 # this deployment has the module
```
- Tabs render dynamically, grouped by sensor method. Adding a pollutant = backend change only.
- Full product ~14 pollutants (PM1/2.5/5/10, TSP, NO/NO₂/NOx/NH₃/O₃, SO₂/H₂S,
  CO/CO₂), **shipped separately** — coverage varies by deployment, hence `available`.
- **MVP ships: AQI, PM2.5, NO₂, CO.**

### Color scales — per-pollutant
- **EAQI defined for only 5** (PM2.5, PM10, NO₂, O₃, SO₂). Others have no EAQI band.
- **AQI tab** = composite EAQI (backend-computed, headline view).
- **Each gas tab** = own concentration scale w/ EU/WHO limit thresholds.
- `scale` field selects shader ramp per pollutant. One ramp active at a time.
- Legend (bottom-left) reads active pollutant's `scale` — never hardcoded.
- Colorblind note: green→red AQI ramp worst case; viridis-style optional later.

---

## Backend API Contract

Base `https://api.adam.in.ua` (dev: local proxy). `t` = 10-min bucket ISO or `live`.
All `.bin` endpoints: `Content-Type: application/octet-stream`, CORS enabled,
historical → `Cache-Control: immutable, max-age=large`; live → short max-age.

```
# Heatmap value grid — GPU shader source (primary render path)
GET /v1/grid/{pollutant}/{t}.bin            → Uint8 single-channel grid + header (dims,bbox,scaleMinMax)
GET /v1/grid/{pollutant}/range?from=&to=&stride=
                                            → packed [header][frames...] delta+brotli (playback)
# Fallback (built, unwired): /v1/heatmap/.../*.png bounds-PNG. Tiles deferred.

# Empty/missing bucket → 204 (single fetch). In range blob: bucket omitted = frameskip
#   (see header frameType[]/tIndex[]); playback holds last frame, advances on next present.

# Pollutant catalog (drives tabs + scales)
GET /v1/pollutants                          → [{ key,label,unit,group,scale,available }]

# Stationary sensors (backend wraps OpenAQ: hides key, CORS, batches, caches)
#   Kyiv reality: ~3 OpenAQ stations @ 1 reading/hour. Hourly, sparse — NOT 10-min.
#   Backend serves nearest hourly reading per requested bucket t (holds across the
#   10-min sub-buckets); readings carry their own datetimeLast for honest staleness.
GET /v1/sensors                             → [{ id,lat,lng,name,tier,provider }]
GET /v1/sensors/readings?t=                 → { [id]: { ...allPollutants, aqi, datetimeLast } }
GET /v1/sensors/readings?from=&to=          → batch over range (playback)

# Vehicles (mocked backend-side now; real hardware later, same shape)
GET /v1/vehicles?t=                         → [{ id,type,lat,lng,status,readings }]
GET /v1/vehicles?from=&to=                  → batch over range (playback; client lerps positions)
GET /v1/vehicles/{id}/path?from=&to=        → [{ lat,lng,t,readings }]  # colored + pickable trail

# Point query — backend interpolates (PRIMARY spatial-detail interaction)
GET /v1/point?lat=&lng=&t=                  → { ...allAvailablePollutants, aqi,
                                                nearestSensor:{id,distanceM}, interpolated:true }
# Returns ALL available pollutants (data-driven). Frontend highlights active tab.

# Time axis (slider/playback bounds)
GET /v1/timerange                           → { from,to, minStepMinutes:10,
                                                steps:[10,30,60,360,1440], buckets:[...] }

# Alerts / danger zones
GET /v1/alerts?t=                           → [{ severity,message,time,zone }]
WS  /v1/ws/alerts                           → danger-zone push only (DEMOTED, optional in demo)
```

### Binary header spec (lock)
Little-endian: `magic(u32) | ver(u16) | dims_w(u16) | dims_h(u16) | bbox(f32×4) |
scaleMin(f32) | scaleMax(f32)` then payload. Range blob inserts `bucketCount(u32)`
+ `tIndex[]` after header. **Frontend rejects mismatched `ver`.**

### Live transport — demoted
10-min cadence → polling latest bucket suffices. WS kept only for danger-zone/
threshold alerts (and future real-time hardware), behind a `LiveConnection` client.

---

## Dropped from earlier plan
- **District polygons removed.** Replaced by **point-pick**: click any coordinate →
  backend interpolated reading (all pollutants) in right panel. Main inspection tool.
- **MapTiler** — not used.
- **Fast-forward-from-now** — replaced by bounded range playback.

---

## Vehicle Trails
- Path = MapLibre `line` layer, **color varies along line by measurement**
  (line-gradient from per-vertex readings). Red where readings spiked.
- Per-vertex readings from `/v1/vehicles/{id}/path` (each vertex carries readings + t).
- **Pickable trail points:** click a trail vertex → right panel shows that vertex's
  readings + timestamp (same panel as point-pick).
- Pollutant tab switch recolors gradient to selected pollutant.
- During playback: vehicle positions lerp between bucket frames (prev+next), no teleport.

---

## Main Map Page UI

```
┌─────────────────────────────────────────────┐
│ [Nav window]                    [TopBar]     │  top-left nav over map; topbar logo/AQI/clock
│                                              │
│                FULL-PAGE MAP                 │
│                                  [PinPanel]→ │  right: point-pick / trail-vertex readings
│ [Legend]              [Pollutant bar]        │  legend bottom-left; pollutant tabs
└─────────────────────────────────────────────┘
```

- **Map** opens full page.
- **Nav window (top-left, over map):** two explicit sub-modes.
  - *Single-bucket nav:* calendar jump-to-date, Live toggle (snap latest + poll),
    step ±step. **Step selector (10m / 30m / 1h / 6h / 1d).** Always shows current-bucket
    timestamp (UTC+3, DST caveat below).
  - *Range playback:* select start+end on calendar → choose step (clamped by range
    length) → preload (progress X/N) → play / pause / rewind / speed scrub. Clearing
    range returns to single-bucket nav.
  - Play gated on buffer `ready` state.
- **Pin point-pick:** drop pin → precise interpolated reading across **all** pollutants;
  active-tab pollutant highlighted. `nearestSensor.distanceM` shown as confidence.
  AbortController latest-wins on rapid re-pin. Single pin (multi-pin = scope creep).
- **Legend (bottom-left):** active pollutant scale (EAQI or concentration).
- **Pollutant bar:** `/v1/pollutants`-driven tabs, grouped by sensor method.
- **TopBar:** logo, city, composite AQI badge, vehicle count, UTC+3 clock,
  data-staleness indicator (if live bucket older than 10 min, "data as of HH:MM").
- **DST caveat:** Kyiv = UTC+2 winter / UTC+3 summer. Historical scrub across DST
  boundary must label per-bucket offset, not a global +3.

---

## Frontend Folder Layout

```
frontend/src/
  api/
    client.ts            # fetch wrapper, base URL, errors, AbortController helpers
    queries.ts           # TanStack hooks: useSensors, useVehicles, usePoint, usePollutants, useTimerange
                         #   query keys include {pollutant, t, mode} — no live/historical bleed
    live.ts              # WS LiveConnection (alerts only)
    range.ts             # range batch fetch: chunked, parallel-capped, step→stride
    decodeWorker.ts      # Web Worker: delta-decode (frameskip-aware) → transferable Uint8Array
                         #   brotli handled by browser at fetch layer, NOT here
    types.ts             # shared API types, binary header parse
  store/
    uiStore.ts           # pollutant, timeState{mode,t,range}, selected entity, sidebar
  map/
    MapView.tsx
    layers/
      HeatmapLayer.tsx   # MapLibre custom WebGL2 layer: 2 persistent textures + shader
      heatmap.glsl.ts    # vertex (mercator transform) + fragment (per-pollutant ramp) shaders
      SensorsLayer.tsx   # circle layer, tier-styled, recolor on readings
      VehiclesLayer.tsx  # animated points (source-driven), lerp during playback
      TrailLayer.tsx     # line-gradient by reading, clickable vertices
    playback/
      ringBuffer.ts      # RAM ring buffer of Uint8 grids, evicting window
      engine.ts          # play clock, buffer-ahead queue, texSubImage2D + triggerRepaint loop
      buffer.ts          # double-buffer textures + mix() tween
    controls/
      NavWindow.tsx      # single-bucket nav + range playback (two sub-modes)
      PollutantTabs.tsx  # dynamic from /pollutants, grouped by sensor method
      Legend.tsx         # per-pollutant scale
      LiveIndicator.tsx
  ui/
    TopBar.tsx           # logo, city, AQI badge, vehicle count, clock, staleness
    FleetSidebar.tsx     # vehicle list, fly-to on click
    PointPanel.tsx       # right panel: point-pick OR trail-vertex readings (all pollutants)
  lib/
    scales.ts            # per-pollutant ramps (EAQI + concentration scales)
    geo.ts               # Kyiv bounds, fly-to, mercator helpers
    time.ts              # 10-min bucket snap, playback clock, DST-aware labels
    urlState.ts          # deep-link {pollutant,t,mode,range} ↔ URL query
  App.tsx / main.tsx
```

---

## Map Layers (bottom → top)
1. Dark base (CartoDB dark — confirm raster vs vector in Open Items)
2. **Heatmap** — GPU custom WebGL2 layer, 2 persistent data textures per pollutant
3. **Sensors** — circle layer, tier styling, recolor per bucket
4. **Vehicle trails** — line-gradient by reading, clickable vertices
5. **Vehicles** — circle/symbol, colored by AQI, animated per bucket

(Districts removed.)

---

## Performance Plan
- Heatmap: tiny Uint8 grid/bucket, GPU-filtered + tweened; `texSubImage2D` swap/frame
- Playback: RAM ring buffer + Web Worker decode + buffer-ahead → no stutter, flat memory
- Range fetch: 1 batched brotli+delta blob, chunked, immutable-cached → replay #2 free
- Vehicle/trail updates: `source.setData()` on map ref, outside React tree
- Sensors: one source, repaint per bucket, positions never redraw
- Point-pick: AbortController latest-wins; loading affordance
- All heatmap/vehicle/trail layers WebGL → no DOM markers; scales to any vehicle count

---

## Demo Mock Strategy (backend-side)
- **Real:** OpenAQ sensors — **~3 Kyiv stations @ 1/hour**. Sparse + hourly. Backend
  maps hourly readings onto requested buckets (hold last). Don't fake 10-min sensor data.
- **Mock:** vehicles + trails w/ per-vertex readings across bucket timeline
- **Computed:** grid from mock hotspots now → real IDW/ML later
- **Pre-generate** demo buckets to flat files, serve static (don't compute on-the-fly mid-demo)
- Frontend identical demo vs production; only backend internals swap

---

## Added Features (low-cost wins)
- **URL deep-link state** (`urlState.ts`): encode {pollutant,t,mode,range} → shareable,
  survives reload.
- **Confidence indicator** on point-pick: distance to nearest sensor.
- **Data-staleness banner** when live bucket lags.
- Loading/skeleton states for async grid + point fetches.

---

## Open Items
1. **Vehicle count** — TBD. Design scales to any N (WebGL). Pick demo number later.
2. **Base map style** — CartoDB dark raster vs dark vector.
3. **Demo data span** — weeks of mock buckets to pre-generate (cap 2wk per range).
4. ✅ **Step→min-step clamp** — LOCKED: max 1500 frames/request, table in Range cap section.
5. ✅ **Keyframe interval** — LOCKED: `KEYFRAME_INTERVAL = 60` + after every gap.
6. **Brotli wire size** — measure actual heaviest dense blob (10d @10m = 1440 frames) on
   real ML output; verify <15MB target holds (delta weakens if frame-to-frame noisy).
   Decode is free (browser). Only remaining unknown that needs real data.
