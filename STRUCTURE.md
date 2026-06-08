# ADAM Demo — Architecture Plan

Single-page Kyiv air-quality map. Production-shaped frontend, real Python backend.
Backend owns all computation (interpolation, stats, ML). Frontend is a pure
render/query client. **This file is the single source of truth** (prior `.md`
briefs are superseded and will be removed).

---

## Ship Scope (current — host demo soon)

Two phases. **Phase 1 = what we host now. Phase 2 = post-host, designed but not built.**

| Feature | Phase | Notes |
|---|---|---|
| Single-bucket nav (live, jump-to-date, ±step) | **1 — ship** | Working (`/v1/grid/{p}/{t}.bin`). |
| Heatmap GPU shader | **1 — ship** | Primary render path. |
| Sensors, vehicles, alerts, point-pick, pollutant tabs | **1 — ship** | Working. |
| **Simple range:** preload window of buckets → play/pause | **1 — ship (lite)** | Naive per-bucket fetch + RAM hold + `texSubImage2D` swap. **NOT** the full delta+brotli+worker+ring-buffer engine. |
| **Full replay engine** (delta+keyframe+brotli blob, web worker decode, ring buffer, buffer-ahead) | **2 — shelved** | Section below kept as the build spec. Only needed when range/perf forces it. |
| **Road layer** (300k OSM segments, feature-state per bucket) | **2 — deferred** | Section below kept as spec. Perf at 300k features unmeasured (Open Item #7). Demo ships heatmap only. |
| Confidence grid (Uint8[512²]) | **2 — deferred** | Open Item #8. Honest-gaps UX, post-host. |

> Phase-2 sections retain full detail intentionally — they are the forward spec, not
> dead text. Build them when scale/perf demands, not before host.

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
| Grid resolution | **512²** | 256KB/bucket Uint8; 4× raw vs 256² but delta+brotli keeps wire ~30–100KB. Matches data accuracy floor (~60m/cell over 30km). Frontend reads dims from header — no hardcode. |
| Road layer | **OSM segments + per-bucket binary values** | Direct measurements where vehicles drove; confidence = pass count. Coexists with heatmap. Toggle: `heatmap \| roads \| both`. |
| Probe rate | **1 Hz (hardware target)** | 600 probes/bucket/vehicle vs 40 at 15 s. Changes coverage math: 50 vehicles fills full Kyiv road network in 6 weeks. Mock uses 15 s (40 probes) for demo. |
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
- Hard cap **2 weeks**. 2wk @ step 10m = 2016 buckets × 256KB = ~516MB raw — too big resident.
- **Never preload as textures.** Raw bytes in a RAM ring buffer (below).
- **Two independent bounds:**
  1. *Ring buffer* caps RESIDENT memory: fixed ~300 buckets ≈ 75MB @512², regardless of frame count.
  2. *Step clamp* caps TOTAL frames per request (wire + precompute + decode), see table.
- Default suggested range small (~3 days @ step 10m ≈ 110MB raw, <8MB wire).

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

> **⚠️ PHASE 2 — SHELVED for host demo.** This whole engine is deferred. Phase-1 demo
> ships **simple range** instead: preload a small bucket window via plain per-bucket
> `.bin` fetches, hold decoded grids in RAM, swap with `texSubImage2D` on play. No
> delta/keyframe/brotli blob, no web worker, no ring buffer, no buffer-ahead. Spec below
> is the build target for when range size / perf forces the upgrade — keep intact.

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
  last keyframe + applies deltas forward to target. 60 @512² = ~1 keyframe / 15.4MB raw —
  cheap vs seek latency.
- Delta + brotli: ~516MB raw → target <20MB wire for 2wk (MEASURE early — noisy ML
  output weakens delta). Backend precomputes + caches.
- **Immutable cache headers** on all historical buckets/ranges → replay #2 = 0 network.

### Network
- Split range into day-chunks; ≤3–6 parallel. Play starts on **first chunk**.
- Buffer-ahead queue: keep playhead N buckets behind download frontier; pause only if frontier caught.

### Memory — RAM ring buffer
- Decoded Uint8 grids held as `Uint8Array`s, fixed window (~300 buckets ≈ 75MB @512²).
- Evict oldest as playhead advances. Memory flat regardless of range length.
- GPU: exactly **2 textures** (current + next for tween), reused via `texSubImage2D`, never per-frame alloc.

### MapLibre redraw (critical)
- **Never** `addLayer`/`removeLayer`/`setData` on heatmap during playback (triggers style diff + full repaint).
- Custom layer holds 2 persistent `WebGLTexture`s. Per frame: `texSubImage2D` (~1–2ms for 256KB) → set `u_mix` → `triggerRepaint()`.

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
- **Wins:** GPU linear filtering smooths coarse grid (512²) into continuous heatmap
  for free; `mix()` tween between buckets; tiny payload; mobile-friendly (Uint8).
- **Per-pollutant grids, active-only fetch:** view one pollutant at a time → fetch
  only that pollutant's series on tab switch. Scales to ~14.

### Known shader gotchas (locked mitigations)
- **WebGL2 required** — `R8`/`RED` single-channel. Fail fast with message if absent.
- Grid dims **multiples of 4** (UNPACK_ALIGNMENT safety). 512² satisfies.
- Uint8 = 256 levels → mild banding possible on wide ranges; acceptable for demo.
- **Mercator skew** at Kyiv lat (~50.4°): grid is equal-lat-spacing; do mercator
  transform in vertex shader (or pre-project backend-side). Small but real.
- Context-loss handler → re-create textures on `webglcontextrestored`.
- **Bbox from header, never hardcoded.** Frontend reads `bbox` f32×4 from binary
  header and pins the quad to that. `KYIV_BBOX` constant is input to backend gen
  only; frontend must not duplicate it.

### gridView toggle
`uiStore.gridView: 'heatmap' | 'roads' | 'both'` (default `'heatmap'`). Persisted
in URL state. `'both'` renders heatmap first, road layer on top. Both use the same
time cursor and pollutant selection.

### Bounds-PNG fallback — built backend-side now, unwired
- One Kyiv-bounds PNG per bucket, dual-emitted cheaply from same grid. Zero-risk
  insurance if shader path breaks in demo. Endpoint exists; frontend wires only if needed.
- XYZ raster tiles: deferred, not built.

---

## Road Layer

> **⚠️ PHASE 2 — DEFERRED for host demo.** Not built for first host. Demo ships
> `gridView: 'heatmap'` only. Reason: 300k-segment feature-state perf unmeasured
> (Open Item #7), 3MB GeoJSON build, untested right before ship. Full spec kept below
> as the forward build target. When built, `gridView` toggle (`heatmap | roads | both`)
> and the binary/range contracts here apply unchanged.

Complements the heatmap. Shows **direct measurements on the actual road network**
rather than IDW-interpolated values. Honest: unsampled segments render transparent.
Coexists with heatmap (`gridView: 'both'`), or replaces it (`'roads'`).

### Two-part data model (geometry static, values per-bucket)

**Geometry — loaded once, long-cached:**
```
GET /v1/roads/geometry.geojson
→ GeoJSON FeatureCollection of LineString features
  Each feature: { id: uint32, highway: string }
  Derived from OSM + OSRM routes.json. Never changes.
  Simplified to ~300 000 Kyiv segments.
```

**Values — binary, per-bucket, per-pollutant:**
```
GET /v1/roads/{pollutant}/{t}.bin
  header: magic(u32) | ver(u16) | segmentCount(u32) | scaleMin(f32) | scaleMax(f32)
  values:     Uint8[segmentCount]   // pollution value, same scale as heatmap Uint8
  confidence: Uint8[segmentCount]   // pass count clamped 0–255; 0 = no data (transparent)
  // Index order = sorted segment id list (static, frontend holds it after geometry load)
```

All **4 MVP pollutants** carried independently (AQI, PM2.5, NO₂, CO). Active pollutant
fetched on tab switch — same pattern as heatmap.

Range/playback blob: same delta+brotli structure as grid range.
```
GET /v1/roads/{pollutant}/range?from=&to=&step=
→ packed [header][frames...] delta+brotli
```
Road deltas compress better than heatmap (most segments unchanged per 10-min bucket).
Expected: **5–15 KB/bucket** compressed vs ~30–100 KB for heatmap.

**Mock generation:** sample `true_field` at each segment centroid + noise ∝ (1/confidence).
Values consistent with vehicle probe readings from the same field.

### Frontend rendering

Road geometry → MapLibre `geojson` source, loaded once on mount.
Values per bucket → `map.setFeatureState()` — no geometry re-upload ever.

```typescript
// per-bucket update — fast path
segments.forEach((val, i) => {
  map.setFeatureState({ source: 'roads', id: sortedIds[i] },
    { value: val, confidence: confidence[i] })
})

// layer paint
'line-color':   interpolate on feature-state 'value' via active pollutant ramp
'line-opacity': ['/', ['feature-state', 'confidence'], 255]
'line-width':   ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 4]
```

`RoadLayer.tsx` — parallel to `HeatmapLayer.tsx`. Mounted when `gridView !== 'heatmap'`.

### Road → heatmap conversion (backend)

Used when ML is not yet trained or for background fill.
Inputs: road segment centroids + values + confidence → scipy cKDTree → IDW onto
512² grid (confidence = IDW weight) → Gaussian blur. Identical pipeline to
`grid_gen.py`, just different input point source. One afternoon of work.

### ML future path (autocalibration + elevation)

Road layer values are the **ML training targets** — high-confidence segments = ground truth.

ML replaces/augments IDW for heatmap generation:
```
Features per grid cell:
  - Nearest road segment values + confidence distances
  - Distance to road class (motorway / primary / residential / etc)
  - Time: hour-of-day, day-of-week, month
  - Elevation (SRTM 30m DEM — free, rasterio)
  - Relative topography: valley / ridge, wind-exposure index
  - Weather: wind speed/direction, temperature, humidity
  - Land use: industrial / park / residential (OSM)

Target: measured pollution at that cell
```

Elevation is critical for Kyiv: Pechersk hills (~200m) vs Podil riverside (~90m).
Inversion layers trap pollution in low areas; hilltop readings 20–40% cleaner.
SRTM DEM import: `rasterio.open('srtm_kyiv.tif')` → numpy array → align to 512² grid.

Autocalibration: cross-reference vehicle readings against OpenAQ reference stations
(3 Kyiv stations). Per-vehicle correction factor derived from co-location passes.

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

# Road layer
GET /v1/roads/geometry.geojson              → static OSM segment geometry (long cache, load once)
GET /v1/roads/{pollutant}/{t}.bin           → values + confidence per segment (same bucket cadence)
GET /v1/roads/{pollutant}/range?from=&to=&step=
                                            → delta+brotli packed frames (same structure as grid range)

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
- During playback: vehicle moves along its **road-snapped sub-point polyline** between
  bucket frames (not straight prev→next lerp) — see Vehicle Probe Model. No teleport.

---

## Vehicle Probe Model & Grid-from-Probes (mock realism)

Replaces the old disconnected mock (8 vehicles on straight waypoint lerps + grid from
5 fixed hotspots). Goal: mock the **real hardware data feed**, so swapping mock→real
hardware is a backend-internal change with identical downstream code.

### Reality being modeled
- **~50 vehicles** driving Kyiv roads.
- Each emits a probe **at 1 Hz** (hardware target): `{vid, lat, lng, ts, measurements}`.
  600 probes/bucket/vehicle. Mock uses 40 probes/bucket (15 s equivalent) for demo simplicity —
  pipeline is identical, only density changes.
- Probes **collected continuously**, but **processed once per 10 min** — that 10-min
  pass is when the map grid updates (matches our 10-min bucket core concept).
- **Night (00:00–06:00 Kyiv):** vehicle parked, position frozen at depot, but probes
  still emitted (measurements continue, location constant).
- **No ML** for now — grid is honest IDW reconstruction from real probe points.

### Three-layer architecture
1. **Hidden "true field"** (never served raw). Repurpose existing `_HOTSPOTS` as the
   real pollution field `true_field(lat,lng,dt)` = IDW(hotspots) × traffic_factor + drift.
   This is the reality sensors sample.
2. **Raw probe stream** (the hardware feed). Per vehicle, 10 min / 15 s = **40 probes per
   bucket-leg**; 50 vehicles → **~2000 probes/bucket**. Position follows a real road
   polyline (below). `measurement = true_field(pos, ts) + sensor_noise` — readings spike
   naturally where the car drives through a high-emission zone, not by vehicle-type
   constant. Probe positions derived deterministically from `(vid, ts)` (like the old
   `_vehicle_pos`), so no need to persist 2000×N rows.
3. **Grid = IDW reconstruction from probes** (the 10-min processing step). For bucket
   `[T, T+10min)`: gather that bucket's ~2000 probe points, IDW onto 512² grid + a weak
   background field for zero-coverage cells. This *is* the real pipeline; replaces
   fixed-hotspot generation in `grid_gen.py`.
   - Moving-point IDW streaks along roads → mitigate with power ~1.5 + Gaussian-blur
     post-pass (or RBF). Acceptable + honest about mobile-sensing coverage.

### Road geometry — OSRM (locked; Google ruled out)
- **OSRM** (self-host Docker `osrm-backend`, or public demo server). OSM/ODbL: store
  geometry freely (attribution only), render on MapLibre, generate offline.
- **Google Directions API rejected:** ToS forbid (a) displaying its route geometry on a
  non-Google map (we use MapLibre), (b) pre-fetching/caching/storing route geometry to
  serve statically. Both are core to this demo. Legal + architectural mismatch.
- Flow: per vehicle, define **one stop per 10-min bucket** ("locations ~10 min apart").
  Route consecutive stops through OSRM → road polyline → **resample by time into 40
  points** (15 s spacing). Precompute once → commit GeoJSON. Generation reads geometry;
  no live API call at gen time.

### Display method (50 vehicles, MapLibre, "current step only")
1. **Marker per vehicle** = circle/symbol layer (NOT DOM markers — perf). Colored by
   current reading via active-pollutant ramp. WebGL, scales to N.
2. **Sub-bucket animation = the win.** Between sparse 10-min samples, animate the marker
   along the **40 road-snapped sub-points** over the bucket's display duration → car
   visibly drives on the road, no teleport / straight-lerp. Driven by `requestAnimationFrame`
   + `source.setData()` outside React (per Performance Plan). Throttle to 20–30 fps if 60
   strains; slow city driving hides it.
3. **Comet tail** = last ~1–2 min of sub-points behind the marker, opacity fading to 0.
   Direction + recent motion = "current step only" + minimal context. Cap vertices to
   bound `setData` payload.
4. **Bearing**: rotate symbol from consecutive sub-points → heading arrow.
5. **Full trail** (whole route, line-gradient by reading, clickable vertices via
   `/v1/vehicles/{id}/path`) shown **only on selection** — never all 50 at once. Detail view.

MapLibre limits handled: no built-in per-feature animation → rAF + setData; circle/symbol
not DOM markers; short tail = small payload; no layer-graph churn during animation.

### API impact (shapes unchanged)
- `/v1/vehicles?t=` and `?from=&to=` and `/vehicles/{id}/path` keep current schemas
  (`Vehicle`, `VehiclePathVertex`). Internals swap: road-polyline interp + field-sampled
  readings. Path endpoint may carry sub-point density for animation (TBD at build).
- Open Item #1 (vehicle count) → resolved to **~50**.

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
      RoadLayer.tsx      # OSM segment line layer, feature-state color+opacity per bucket
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

## Data Accuracy Floor & Coverage Model

### Honest accuracy bounds

Mobile sensor accuracy (low-cost optical/electrochemical):
- Raw: ±10–30% absolute for PM2.5, worse for gases
- After ≥30 averaged passes per segment: **±5–10 µg/m³** reliable long-term mean
- EU PM2.5 annual limit: 25 µg/m³ → product is pattern-grade, not compliance-grade
- Calibration against OpenAQ reference stations reduces systematic bias

What the product can honestly claim per deployment stage:

| Stage | Vehicles | Hz | Duration | Honest claim |
|---|---|---|---|---|
| Demo | 50 mock | 15 s sim | — | Corridor patterns, ±500m, illustrative |
| Pilot | 50 real | 1 Hz | 6 weeks | Full road network, confidence-mapped, ±100m |
| Research | 200 | 1 Hz | 3 months | Block-level corridors, significant for planning |
| Product | 500+ | 1 Hz | 12 months | Street-level temporal, city planning grade |

### Coverage math (1 Hz, 50 vehicles, road-only target)

Kyiv road network: ~5 000 km, ~40 km² total road area.
At 50m resolution: **~16 000 road cells** (vs 200 000 for full urban area).

At 50 km/h = 13.9 m/s → **14 probes per 50m segment per pass**.
50 vehicles × 400 km/day → 4 passes per road km per day average.
Per 50m cell: 4 passes × 14 probes = **56 probes/cell/day** (average).

Time to ≥30-pass statistical significance (per time-of-day category):
- Arterials (20% of roads): <1 day
- Secondary roads (60%): 3–5 days  
- Residential side streets (20%): ~25 days

Full road network, all time-of-day conditions: **4–6 weeks** at 50 vehicles 1 Hz.

### Confidence layer (required for honest rendering)

Both heatmap and road layer must expose per-cell/per-segment confidence:
- **Heatmap:** `confidence_grid` Uint8[512²] emitted alongside value grid.
  Low-confidence cells render at reduced opacity (not hidden, but visually distinct).
- **Road layer:** `confidence` Uint8[segmentCount] in binary (already in spec above).
  Zero-confidence segments render transparent — no IDW fantasy fill.

This is the key UX difference from competitors: **gaps are honest, not interpolated.**

---

## Demo Mock Strategy (backend-side)
- **Real:** OpenAQ sensors — **~3 Kyiv stations @ 1/hour**. Sparse + hourly. Backend
  maps hourly readings onto requested buckets (hold last). Don't fake 10-min sensor data.
- **Mock:** ~50 vehicles on OSRM road polylines, 15 s probes, readings = sampled hidden
  true-field + noise (see Vehicle Probe Model). Models the real hardware feed.
- **Computed:** grid = IDW reconstruction **from vehicle probes** (real pipeline) →
  add real ML later. (Old fixed-hotspot grid demoted to the hidden true-field source.)
- **Pre-generate** demo buckets to flat files, serve static (don't compute on-the-fly mid-demo)
- Frontend identical demo vs production; only backend internals swap

---

## Added Features (low-cost wins)
- **URL deep-link state** (`urlState.ts`): encode {pollutant,t,mode,range,gridView} → shareable,
  survives reload.
- **Confidence indicator** on point-pick: distance to nearest sensor.
- **Data-staleness banner** when live bucket lags.
- Loading/skeleton states for async grid + point fetches.

---

## Open Items
1. ✅ **Vehicle count** — LOCKED ~50 (Vehicle Probe Model). Design scales to any N (WebGL).
2. **Base map style** — CartoDB dark raster vs dark vector.
3. **Demo data span** — weeks of mock buckets to pre-generate (cap 2wk per range).
4. ✅ **Step→min-step clamp** — LOCKED: max 1500 frames/request, table in Range cap section.
5. ✅ **Keyframe interval** — LOCKED: `KEYFRAME_INTERVAL = 60` + after every gap.
6. **Brotli wire size** — measure actual heaviest dense blob (10d @10m = 1440 frames) on
   real ML output; verify <20MB target holds at 512² (delta weakens if frame-to-frame noisy).
   Decode is free (browser). Only remaining unknown that needs real data.
7. **Road geometry size** — simplify OSM Kyiv segments to target <3MB GeoJSON (Douglas-Peucker
   tolerance TBD); measure MapLibre perf with ~300 000 features + feature-state updates.
8. **Confidence grid emit** — add `confidence_grid` Uint8[512²] alongside heatmap value grid
   (probe density per cell); needed for honest low-coverage opacity rendering.
