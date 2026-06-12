# Planning: backend calc, ML interpolation, raster tiles

_AI tool: Claude (Claude Code, Anthropic). Session 0db2c26b. ADAM project._


**Claude:**

Reading brief + project state.

---

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\pitch_brief.md]_

---

**Claude:**

_[tool: Bash — ls -la && echo "---MD FILES---" && find . -maxdepth 2 -name "*.md" -not -path "*…]_

---

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\init.md]_

---

**Claude:**

Read both. Empty repo — only `init.md` (tech brief) + `pitch_brief.md`. No code yet. Pure planning stage. Good — full architecture open.

Went through brief. Weak points + conflicts found:

## Conflicts in brief

**1. "Production architecture" vs vanilla-Leaflet spec**
init.md assumes vanilla JS: global `DataProvider`, `L.canvas()`, raw `setInterval`. But goal says "production-ready, future release, performance." Vanilla DOM approach fights that. Biggest fork.

**2. Heatmap = static PNG over bounds → misalignment**
`canvas → toDataURL() → L.imageOverlay` pins flat raster to Kyiv bounds. Leaflet base is Web Mercator — flat image won't reproject. On zoom/pan blobs drift off real coords. Looks fake at city zoom. Real heatmaps = tile pyramid or GPU interpolation (IDW). 

**3. Vehicle count contradiction**
Line 55: "12 vehicles." Line 21: "up to 1000 without DOM lag." Demo = 12, but arch must scale. Canvas tops ~hundreds smooth; 1000+ animated → WebGL territory.

**4. Pull interface vs real-time push**
`DataProvider.getVehicles()` = pull model. Production air-monitoring = WebSocket/SSE push. Swapping mock→real "zero structural change" breaks here — poll≠subscribe. Interface should be subscription/observable, not getter.

**5. OpenAQ live data — 3 real blockers**
- API key hardcoded in frontend (init.md:44). Exposed to every browser. Leak.
- CORS: OpenAQ v3 browser requests may block → needs proxy → contradicts "no backend" demo.
- Poll `/latest` per location ×100-200 every 60s = 100-200 req/min → rate limit. Need batch endpoint or slower cadence.

**6. Missing assets/models**
- Kyiv 10-raion GeoJSON — no source named.
- `getReadingsAt()` "interpolated" — needs interp model even for mock.

---

Before I write full structure plan, 4 core forks decide everything downstream. Let me get your calls:

---

**Claude:**

_[tool: AskUserQuestion]_

---

**Claude:**

Got it. Locked: **React+TS**, **GPU interpolated heatmap**, **own backend proxy** (doubles as future calc/ingest layer). Map engine = needs comparison first.

Two things first, then the spec.

## Svelte — what it is

Compiler, not runtime framework. React ships a virtual-DOM diff engine to the browser; Svelte compiles components to plain DOM-mutating JS at build time — no VDOM, smaller bundle, faster first paint. Reactivity is syntax-level (`$state`/`$derived` in Svelte 5) instead of hooks. **Why it'd matter here:** map dashboard repaints often (vehicle ticks, polls) — less framework overhead per tick. **Why skip it:** smaller ecosystem (fewer map/chart bindings), smaller hiring pool, you already picked React. Verdict: React right call for a release product; Svelte's edge is marginal once the heavy lifting is on the GPU (MapLibre/deck.gl) not the framework.

## Key implication of your other 2 answers

**GPU interpolated heatmap rules out plain Leaflet.** Leaflet has no GPU layer — heatmap there = the flat-PNG hack you're rejecting. So real choice narrowed to **MapLibre GL** vs **deck.gl-over-MapLibre**. Comparison:

| Dimension | MapLibre GL JS (alone) | deck.gl + MapLibre base | Leaflet (ref only) |
|---|---|---|---|
| Render | WebGL vector tiles | WebGL data layers over MapLibre | Raster/canvas DOM |
| GPU heatmap | `heatmap` layer (built-in, KDE-style) | `HeatmapLayer`/`ScreenGridLayer` (richer, weighted IDW-ish) | ❌ none |
| 1000+ vehicles | Good (symbol/circle layers) | Excellent (`ScatterplotLayer`, instanced) | ~hundreds, then lag |
| Animated dots | Manual (update GeoJSON source / feature-state) | Native (`updateTriggers`, transitions) | canvas redraw |
| True interpolation | Heatmap-density only (not value-accurate IDW) | Better, but still density-weighted; value-accurate IDW needs custom layer/shader | ❌ |
| District polygons hover | fill+line layers, feature-state hover | GeoJsonLayer (or let MapLibre base do it) | GeoJSON layer |
| Bundle weight | ~200KB | +400-500KB (deck) | ~150KB |
| API complexity | Medium | Higher (two libs, coordinated) | Low |
| React binding | `react-map-gl` | `@deck.gl/react` + react-map-gl | react-leaflet |
| Backend synergy | client interpolates points from your API | same | same |
| Release/3D path | Strong (terrain, extrusion) | Strongest (3D layers, big data) | Weak |

### Heatmap honesty note
Neither library does *scientifically accurate* IDW/kriging out-of-the-box — both do **density KDE** (point clustering → color). For air-quality you want **value-weighted** interpolation (a sensor reading 180 AQI should bleed red even if alone). Two paths:
- **Client GPU, value-weighted:** deck.gl `HeatmapLayer` with `getWeight` = AQI, or custom shader layer. Good enough, looks real.
- **Backend-computed:** your backend runs IDW grid (you're building backend anyway + want sensor data for calc) → serves either a grid GeoJSON or pre-rendered raster tiles → client just displays. **More accurate, matches "use sensor data in future calculation," and is the genuine production pattern.**

Since you committed to a backend that'll do calculations, the backend-IDW path is the architecturally honest one. Client GPU layer can still render the backend's grid output fast.

My recommendation: **MapLibre GL + react-map-gl**, heatmap = backend IDW grid → rendered as MapLibre layer (fill-extrusion or heatmap from weighted grid points). Add deck.gl *only if* vehicle count actually goes 1000+. Don't pay deck.gl's weight upfront for 12 demo vehicles.

---

**Claude:**

_[tool: AskUserQuestion]_

---

**You:**

all the calculations will be done on the backend; after this first frontend demo comes a complex and long algorythm for calculating proper interpolation with statisticals dbs and ml predicitions. so frontend here is just to render heatmaps, tell pollution per selected point, display vehicles paths, stationary sensors, gives ability to view past data for selected timeframes. live data updates.

backend is done with python. consider map engine with that in midn

---

**Claude:**

Clear. Frontend = **pure render client**. Zero math. Backend (Python) owns interpolation, stats DBs, ML. That simplifies frontend a lot and settles the engine.

## Map engine: MapLibre GL + react-map-gl — decided

Reasoning with Python-backend-does-everything in mind:
- Backend language is irrelevant to the JS engine — engine just renders whatever backend serves.
- Frontend does no interpolation → **deck.gl unnecessary** (its value was client-side GPU compute/big-data layers; you don't need it). Drop it. Saves ~500KB + API complexity.
- MapLibre does all 5 frontend jobs natively:
  - heatmap → **raster tile overlay** from backend (reprojects correctly per zoom — kills the imageOverlay misalignment problem)
  - vehicle paths → line layer + animated point (feature-state)
  - stationary sensors → circle layer
  - point query on click → call backend
  - historical timeframe → swap tile URL by timestamp + time slider
- Leaflet *could* show raster tiles too, but MapLibre wins on vector base quality, smooth zoom, future 3D, and animated vehicles without canvas hacks.

**Verdict: MapLibre GL JS via react-map-gl. No deck.gl.**

## One open contract decision — heatmap transport

Backend does the math, but it can hand the result to frontend two ways. This defines the API contract:

**A) Raster tiles (recommended)** — backend renders interpolated heatmap to XYZ PNG tile pyramid: `GET /heatmap/{pollutant}/{timestamp}/{z}/{x}/{y}.png`. Frontend adds one MapLibre raster source. Reprojects natively, multi-zoom sharp, frontend totally dumb, scales to any city size. Matches a clean `getHeatmapTileUrl()` interface. Backend owns rendering (Python: matplotlib/rasterio/datashader → tiles).

**B) Grid GeoJSON** — backend sends interpolated value grid as points/polygons, frontend renders via MapLibre heatmap/fill layer. Lighter backend (no tile render), but heavier payloads at city scale, frontend re-styles, less sharp. Better only if you want client-side restyle without backend re-render.

For ML-driven, multi-timeframe, city-scale, with backend already heavy → **A (raster tiles)** is the genuine production pattern.

---

If A sounds right, I'll write the full structure plan: frontend architecture (React+TS+Vite, MapLibre, folder layout, DataProvider/API contract with all endpoints incl. time-range + live, state mgmt, layer components), the backend API surface frontend depends on, live-update transport (WebSocket vs SSE vs poll), and the demo mock strategy. Confirm transport choice (A or B) and I'll draft it.

---

**You:**

raster tiles

---

**Claude:**

All locked. Writing full structure plan to a file you can reference.

---

**Claude:**

_[tool: Write — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Plan written → [ARCHITECTURE.md](ARCHITECTURE.md).

Covers: locked stack, full backend API contract frontend depends on, folder layout, map layers, live/historical time model, perf plan, mock strategy.

**Big structural improvement baked in:** mock moves backend-side. Frontend = one HTTP+WS client, zero mock/real branching. Hardware swap = backend-only. Cleaner than init.md.

6 open items at bottom of file. Most decisions point one way already — my picks:
1. Base style — **CartoDB dark raster** (matches brief, simplest)
2. Backend — **FastAPI** (async, geospatial, ML-ready)
3. Tile render — **datashader+rasterio** (fast IDW→PNG pyramid)
4. Districts GeoJSON — need source; I can hunt one
5. Repo — **monorepo**
6. AQI — brief uses EPA 0–500 buckets; but you're EU/CSRD → maybe **EU EAQI**. Real fork (colors + legend differ).

Two genuine forks left: **#6 AQI standard** (EPA vs EU — affects color scale + legend everywhere) and **#1 base style**. Rest I'll default to my picks unless you object.

Want me to proceed to scaffold (Vite+React+TS+MapLibre skeleton + folder layout + typed API stubs), or keep refining plan first?

---

**You:**

corrections: 
- move on from all prev .md files. they will be removed.
- drop districs display > replaced by picking point data for selected coordinate (interpolated)
- vehicle path > line needs to be able to change color to display measurements. needs for a way to pick-display data for that selected point in vehicle trail as well
- because of limitations caused by future implementing of ml processing it wont likely to be updated this fast. therefore 5-15 min intervals is what we mainly aim for. lets say 10 per this demo. 
- however that doesn't change that we need fast forward mode to look through several weeks of data with update speed being 1sec per change showing data 10 min apart. i guess will keep ws for live updates on danger zones or sth, not really used for now
- monorepo. separated to 2 gitworktrees for easier workflow
- amount of vehicles is still under the question

---

**Claude:**

Digested. Key shifts: 10-min data granularity (not seconds), districts gone → point-pick is primary, vehicle trails colored by reading + pickable, fast-forward playback is the star feature, WS demoted to alerts. Rewriting plan.

---

**Claude:**

_[tool: Write — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Updated → [ARCHITECTURE.md](ARCHITECTURE.md).

Changes locked in: 10-min buckets as core time unit, 3 modes (live/historical/fast-forward), districts dropped → point-pick primary, trails colored by reading + clickable vertices, WS demoted to alerts, monorepo+2 worktrees.

**Two new tensions worth flagging now** (added context, not blocking):

1. **Fast-forward cost.** Weeks of 10-min buckets = lots of pre-baked tile sets. 1 week ≈ 1,008 buckets; × zoom levels × tiles each = heavy to pre-generate + store for demo. Options: (a) limit demo span (open item #6), (b) lower max zoom during playback, (c) generate tiles on-demand + cache. Backend concern, but shapes demo data prep.

2. **Playback network.** Even with prefetch, pulling a full tile pyramid every ~1s strains network. Likely cap playback to 1–2 zoom levels or city-bbox tiles only. Noted in perf section conceptually.

**Remaining real fork: AQI standard (#5)** — EPA 0–500 vs EU EAQI. Changes color buckets + legend + trail gradient everywhere, so worth nailing before scaffold. Your EU/CSRD context leans EAQI.

Want to:
- **A)** decide AQI standard + backend framework now, then I scaffold, or
- **B)** scaffold the frontend skeleton now (MapLibre + folders + typed API stubs) and defer those?

I'd do A — AQI standard touches too many files to retrofit. Your call.

---

**You:**

-eu 
- considering that we aim to cover kyiv at this point of dev and that heatmaps are prerendered on backend, what would be our bottle neck for doing that fast forward feature

---

**Claude:**

EU EAQI locked. Now the fast-forward bottleneck — let me run real Kyiv numbers.

## What's NOT the bottleneck

Kyiv bounds ≈ 40×42 km. Tiles covering it, one pollutant shown at a time:

| Zoom | Tiles for Kyiv | PNG @ ~15KB |
|---|---|---|
| z11 (city overview) | ~12 | ~180 KB |
| z12 | ~35 | ~525 KB |
| z13 | ~140 | ~2 MB |
| z14 | ~500 | ~7.5 MB |

At playback you're in **city-overview (z11–12)** to watch trends → ~12–35 tiles/bucket, one pollutant. At 1 bucket/sec = **~0.2–0.5 MB/s**. Bandwidth is a non-issue.

Storage: 1 week = 1008 buckets × 4 pollutants × ~10MB(z11-14) ≈ 40GB. Disk-cheap. Backend pre-renders offline once — **generation isn't a runtime bottleneck** either.

## What IS the bottleneck

**MapLibre raster-source swapping, not the network.** Three real ones, in order:

**1. Tileset-swap flicker (biggest).** MapLibre raster sources aren't built to flip an entire tileset every second. Changing the tile URL template → source reloads → visible flash/re-fetch each frame. At 1 fps this stutters even from cache.

**2. PNG decode on main thread.** Decoding N tiles/sec blocks the UI thread. Fine at z11 (12 tiles), stalls at z14 (500).

**3. Per-bucket request latency.** N HTTP requests per frame; RTT can exceed the 1s budget on slow links if not pre-warmed.

## Fixes that kill all three

**A) Hybrid render — single bounds-PNG for playback.** Kyiv fits one image at overview zoom. Backend serves one pre-rendered Kyiv-bounds PNG per bucket (~80–150KB) for fast-forward; keep XYZ tiles only for interactive zoom/explore. Swapping **one image** = trivial decode, one request, no tileset reload. This is the clean answer — removes #1 and #2 entirely for playback.

**B) Double-buffer + crossfade.** Two raster layers; preload next bucket into the hidden one, swap opacity. No flash.

**C) Prefetch playhead+N.** Warm browser cache via `Image()` preload ahead of the playhead → network never on critical path.

## Bottom line

For Kyiv-scale, prerendered: **the bottleneck is client-side raster-layer swap mechanics, not bandwidth, storage, or backend.** Solve it with the single-bounds-PNG-per-bucket playback path (A) + double-buffer (B) + prefetch (C). Bandwidth only becomes real if you let playback run at z14+ — so cap playback zoom.

Want me to fold this hybrid (tiles for explore / bounds-PNG for playback) into ARCHITECTURE.md and add EAQI as the locked standard?

---

**You:**

btw, explain to me why don't we use a single image backend rendered and shown per specific viewport?

---

**Claude:**

Good question — gets at the real tradeoff. Short answer: **a single image pinned to fixed Kyiv bounds = yes (that's option A). A single image rendered per dynamic viewport (whatever the user is currently looking at) = no.** The difference is fixed bbox vs arbitrary bbox.

Per-dynamic-viewport = the classic WMS `GetMap` pattern: backend renders exactly the current bbox+size on demand. Why it loses:

**1. Cache death.** Every viewport is a unique bbox+size+dpi → unique URL → ~0% cache hit. No CDN reuse, no precompute, nothing shared between users. Now multiply by every 10-min bucket × every pollutant × every pan position → uncacheable explosion. Tiles snap to a fixed grid → quantized, cacheable, precomputable once, served static.

**2. Interactive latency.** Every pan/zoom round-trips to the backend to re-render the whole frame. Pan 50px → full re-render request → wait. Tiles only fetch the new edge tiles; the rest is already on screen.

**3. Broken zoom animation.** A fixed-bbox bitmap can't reproject mid-pinch — MapLibre just stretches the stale bitmap until the new render arrives → blurry rubber-banding. Tiles zoom natively: parent tile scales instantly while child tiles stream in.

**4. Backend scaling.** Renders scale with **users × interactions** instead of with content. 100 users panning = 100× render load. Tiles: render once, infinite cheap static serves.

**When per-viewport IS fine:** static camera, low interaction, single user — i.e. **playback with a locked camera**. That's exactly our fast-forward case. But instead of "whatever arbitrary bbox the user stopped at," we pin it to **fixed Kyiv bounds** — which makes it precomputable + cacheable + shareable, while a dynamic per-viewport version would not be.

So the design is: **tiles for interactive explore (pan/zoom freely), fixed-Kyiv-bounds single PNG for playback.** Dynamic-per-viewport gives you the cost of on-demand rendering with none of the caching, which is the worst quadrant.

---

**You:**

how sth like google maps with their satelite view fix that issue?

---

**Claude:**

Google Maps satellite is exactly the tile model we picked — they don't render per-viewport, they pre-bake a tile pyramid. That's the whole trick. What they layer on:

**1. Static immutable tile pyramid.** Satellite imagery is rendered once into an XYZ/quadtree pyramid (z0 whole Earth → z20+ rooftops), offline. Each tile has a fixed URL and ~never changes → cached forever on a planetary CDN. A tile requested in Kyiv is the same bytes for every user, every session. Render cost = once, ever. Serve cost = static file.

**2. Parent-tile upscaling on zoom.** When you zoom, you instantly see a *blurry* image that sharpens — that's them scaling the already-loaded parent tile as a placeholder while the sharp child tiles stream in. No backend round-trip, no rubber-banding. That's the "broken zoom" problem solved by the grid, not by re-rendering.

**3. Prefetch + progressive load.** They fetch neighboring tiles and the next zoom level ahead of your interaction, low-res first then high-res.

**4. WebGL textures.** Tiles uploaded as GPU textures (MapLibre does the same) → smooth pan/zoom on the GPU, not redrawing on CPU.

So Google "fixes" it by **never doing per-viewport rendering at all** — quantize to a grid, precompute, cache, and use parent-tile scaling for the zoom gap. Validates our tile choice.

**The one axis Google's satellite layer does NOT have: time.** Earth's surface is basically one static dataset. Our heatmap is a tile pyramid **× every 10-min bucket** — that extra dimension is our real cost, and it's why we precompute per bucket, bound the demo span, and use the fixed-Kyiv-bounds PNG shortcut for playback (where the camera's locked anyway). Google's *live* layers (traffic, etc.) are separate dynamic overlays on top of the static tile base — same split we're doing: static-ish base + time-varying overlay.

---

**You:**

considering mvp approach where we'd likely have ~3 different zoom layers > city + district + street. if we prerender those with tiles, we would still run into client map bottle neck, right? 
btw whats maptiler? saw it elsewhere

---

**Claude:**

Two things.

## Does 3 zoom layers reintroduce the client bottleneck?

Depends which mode — and the key insight you're missing:

**Viewport tile count is ~constant across zoom levels.** A screen is ~1280×720 ≈ **15–25 tiles visible at any zoom**. The "z14 = 500 tiles" number was tiles to cover *all of Kyiv* — but the client only ever loads the **current viewport**, ~20 tiles, whether you're at city, district, or street zoom. So more zoom levels do **not** mean the client loads more per frame.

So:
- **Interactive explore (pan/zoom, fixed time):** no bottleneck at all. This is what tiles are built for. 3 levels = native, smooth, parent-tile upscaling fills zoom gaps. Solved.
- **Fast-forward playback:** the bottleneck persists but is **bounded by viewport (~20 tiles/frame), not by zoom level.** Playing back at street zoom is roughly the same client cost as city zoom — ~20 tile swaps + decodes per second + the tileset-swap flicker. Adding district/street levels doesn't worsen it.

What 3 zoom levels DOES multiply is **backend storage/precompute** (street-level pyramid for all Kyiv × every bucket = a lot of tiles) — but that's backend disk, not client.

**Bottom line:** 3 zoom layers are fine. Client playback cost stays ~constant (viewport-bounded); same fixes apply — double-buffer + crossfade + prefetch, or the locked-camera bounds-PNG. The cost that grows with zoom is backend storage, which for Kyiv-only is manageable.

## MapTiler

A maps platform, three things under one name:
1. **MapTiler Cloud** — hosted base-map tiles + styles (streets, dark, satellite) via API key. Direct alternative to Mapbox/CartoDB for your **base layer**.
2. **MapTiler Engine / tools** — desktop + CLI to **generate your own tile pyramids** from rasters/GeoJSON (GUI over gdal2tiles). Could bake heatmap tiles — though you're doing that in the Python backend, so not needed.
3. **MapTiler SDK** — a thin JS wrapper around **MapLibre GL** (they're a primary MapLibre maintainer/sponsor). Adds convenience + their hosted styles.

**Relevance to us:** only as a possible **dark base-map provider** (alt to CartoDB) — nicer vector styles, but adds an API key + cost. Not needed for the heatmap pipeline; that's ours. I'd note it as a base-style option alongside CartoDB and move on.

Fold the EAQI decision + this tiles/playback clarification into ARCHITECTURE.md now?

---

**You:**

no need for maptiler then. i get why bottleneck persists, but why does that increase backend storage costs? i though that if we render ~3 instead of like 20 that would reduce the cost largely

---

**Claude:**

You're right — I muddled it. Fewer zoom levels **does** slash storage hugely. Let me give the actual numbers and the one nuance.

## Yes, capping zoom is the big lever

Each zoom level +1 = **~4× more tiles** (geometric). Cumulative tiles to cover all Kyiv:

| Max zoom | Tiles for Kyiv (cumulative) |
|---|---|
| z11 (city) | ~12 |
| z12 | ~47 |
| z13 (district) | ~187 |
| z14 | ~690 |
| z15 (street) | ~2,700 |

So capping at **z13 vs z15 ≈ 187 vs 2,700 = ~14× less storage.** You were right. Limiting depth is exactly the saver.

Storage per week (×4 pollutants, ~15KB/tile, 1,008 buckets):
- **cap z13:** ~11 MB/bucket → **~11 GB/week**
- **cap z15:** ~160 MB/bucket → **~160 GB/week**

## The nuance I conflated

Two different meanings of "3 levels":

**(a) A contiguous range, minZoom→maxZoom (correct way).** You render every level from z11 up to your cap (e.g. z11,12,13). Client zooms smoothly, scaling parent tiles between. "City/district/street" = picking your **maxZoom cap** = z13 or so. This is what cuts cost: a shallow contiguous pyramid.

**(b) 3 *isolated* levels (z11, z13, z15, skipping z12/z14).** Saves the skipped intermediate levels — but those are the *cheap* ones (geometric). The deepest level dominates total count, so skipping z14 barely helps if you still render z15. **And** zooming to a missing level shows upscaled/blurry parent tiles. Bad tradeoff.

So: the cost isn't "number of levels," it's **how deep your deepest level goes** (because each level 4×'s). Render a contiguous shallow pyramid (z11→z13), don't render isolated stops.

## The multiplier that actually dominates

Storage = `tiles(maxzoom) × pollutants × buckets`. The **buckets (time axis)** is the real killer, not zoom — 1,008/week and growing. That's unique to us (Google's satellite has no time axis). So the two storage levers are: **(1) cap maxZoom shallow, (2) bound how much time history you pre-render.** For an MVP, z13 cap + a bounded demo window ≈ ~10GB, trivial.

So your instinct is correct: keep the pyramid shallow (≈3 contiguous levels, city→district), and street-level can stay on-demand or out-of-scope for MVP.

---

**You:**

going back to what could solve fast forward updates, now that i got the gist

---

**Claude:**

Right — now that the bottleneck's clear (per-frame heatmap swap: flicker + decode + latency, viewport-bounded ~20 tiles), here are the concrete ways to solve it, simplest → most powerful:

## Option 1 — Bounds-PNG + double-buffer + prefetch (MVP pick)
One pre-rendered Kyiv-bounds PNG per bucket. Two raster layers (A/B); show bucket N on A, preload N+1 into hidden B, crossfade opacity on tick, swap roles. Prefetch playhead+N via `Image()`.
- **Cost:** one ~100KB decode/sec. Trivial.
- **Win:** no flicker (crossfade), no tile-swap, dead simple.
- **Limit:** fixed overview zoom during playback (no street detail). Fine for trend-watching.

## Option 2 — Tile double-buffering + prefetch
Same A/B + crossfade, but with full tile sources → keeps zoom freedom during playback.
- **Win:** play back at any zoom, ~20 tiles/frame.
- **Cost:** more layer-management complexity, 20 decodes/sec vs 1.

## Option 3 — Heatmap time-series as **video** (WebM/MP4)
Encode the bucket sequence as a video, render frames to a canvas/texture pinned to Kyiv bounds, scrub via `currentTime`.
- **Win:** hardware-decoded, native seeking, tiny bandwidth (temporal compression — weeks in a few MB), buttery smooth.
- **Limit:** fixed bbox/zoom (flat overlay), regenerate on data change. Genuinely how you'd ship smooth weeks-of-playback.

## Option 4 — GPU grid texture + shader (production endgame)
Don't send images at all. Backend sends compact per-bucket **value grids** (small float arrays). Upload as a data texture; a fragment shader maps value→EAQI color live. Swap the tiny data texture per frame.
- **Win:** smallest payload, zero PNG decode, instant recolor, and you can **tween between buckets on GPU** → fluid motion instead of 10-min stepping. Pollutant switch = swap color ramp, no refetch.
- **Cost:** custom MapLibre WebGL layer — most engineering.

## Cross-cutting techniques (apply to any option)
- **Temporal tweening:** data is 10-min apart, playback is 1 frame/sec — crossfade/interpolate between consecutive frames so it flows, not jumps. Free with double-buffer (1,3); shader-native in (4).
- **Buffer-ahead queue:** playback advances only when next frame is buffered (like video buffering) → never stutters on slow net. Decouple playback clock from fetch.

## My recommendation
- **MVP now:** **Option 1** (bounds-PNG + double-buffer crossfade + prefetch + buffer-ahead). Solves it completely for locked-camera trend playback with ~zero complexity.
- **Keep interactive explore on tiles** (separate, non-playback path — already smooth).
- **Production target:** **Option 4** (GPU grid+shader) for fluid, zoomable, tweened playback at scale. Note it in the plan as the evolution, don't build it now.

Want this folded into ARCHITECTURE.md as the playback strategy (MVP = Opt 1, future = Opt 4), alongside locking EAQI?

---

**You:**

op 4 is quite an interesting one. would we send separate data or the same one that's used at backend to render heatmap itself? would it support mobile properly?

---

**Claude:**

Good instinct — Option 4 is the elegant one. Both answers are favorable:

## Same data or separate?

**Same data — tapped one step earlier.** Your backend pipeline does: `sensors → IDW/kriging → value grid → colorize+smooth → PNG`. The PNG is just that grid painted. For Option 4 you **skip the colorize step and ship the grid itself** — no extra computation, you're tapping the pipeline *before* rasterization.

Best packing trick: **4 pollutants in one RGBA texture.**
```
R = pm25, G = no2, B = co, A = aqi   (per grid cell)
```
- One fetch per bucket carries all 4 pollutants.
- **Pollutant tab switch = shader reads a different channel → zero refetch, instant.** (Tiles can't do this — each pollutant is a separate PNG set.)
- Color ramp (EAQI) lives in the shader, swappable without touching data.

Size: a 256×256 grid × RGBA × 1 byte = **256KB raw per bucket, ~tens of KB as PNG-packed**. Far smaller than a tile set, and it's *all* pollutants at once.

So the model: backend emits **both** for a while — PNG tiles (interactive explore + non-GPU fallback) and the grid (GPU playback). Same upstream grid feeds both.

## Mobile?

**Yes, with one rule: pack as 8-bit (Uint8) RGBA, not float textures.**

- MapLibre custom WebGL layers + data textures + fragment shaders = standard WebGL, runs on iOS Safari + Android Chrome.
- **Pitfall:** float textures need `OES_texture_float` (WebGL1) — spotty on older mobile. **Fix:** quantize grid values to Uint8 (AQI 0–500 → scale to 0–255; ~2 EAQI-bucket resolution, plenty for display). Uint8 RGBA textures are universally supported. Avoids the only real compat gap.
- Small grids (≤512²) → negligible GPU memory, cheap per-frame texture upload — **lighter on mobile than swapping PNG tiles** (less bandwidth, less decode).
- Watch only: continuous shader redraw during long playback uses GPU/battery — fine for typical playback bursts; pause-when-idle handles it.

**Net:** Option 4 is actually *more* mobile-friendly than the tile/PNG paths if you (a) pack 4 pollutants into one Uint8 RGBA grid and (b) keep the grid ≤512². It also unlocks instant pollutant switching and GPU tweening between 10-min buckets.

Caveat for MVP: it's the most engineering. So plan = **ship Opt 1 (bounds-PNG) for the demo, architect the data layer so the grid export is a natural addition, evolve to Opt 4.** Designing the backend to emit the grid from day one (even if frontend uses PNG first) keeps the door open cleanly.

Lock EAQI + write the playback strategy (MVP Opt 1 → future Opt 4, dual backend emit) into ARCHITECTURE.md now?

---

**You:**

and how much engeneering is that? we render value grid anyway at backend, so the whole thing is writing one shader? can you do that?

---

**Claude:**

Honest scope — it's a bit more than "one shader," but it's small and self-contained. And yes, I can build it.

## What it actually takes

**Backend (tiny — you already have the grid):**
- One endpoint that serializes the existing value grid to Uint8 RGBA (pack 4 pollutants into channels) → PNG or binary. ~half day. You're not computing anything new.

**Frontend (the real work):**
1. **MapLibre custom layer** (`type:'custom'`, `onAdd`/`render`) — the WebGL boilerplate: a quad over Kyiv mercator bounds, MapLibre hands you the projection matrix. ~the fiddly part.
2. **Two shaders:**
   - Vertex: place quad, pass UV — ~10 lines, trivial.
   - Fragment: sample data texture, pick channel by `pollutant` uniform, map value→EAQI color via a ramp, output. With tweening: sample two textures, `mix()` by a uniform. ~30–40 lines.
3. **Playback controller:** fetch buckets, double-buffer two textures, tween the `mix` uniform between frames, buffer-ahead queue.

**Total: ~150–300 lines of layer+shader + the controller.** Realistic effort ~3–5 days for the full GPU path, vs ~1 day for Option 1 (bounds-PNG).

## The free wins that make it worth it

- **Spatial smoothing is FREE.** GPU **linear texture filtering** auto-interpolates a coarse grid (even 128–256²) into a smooth continuous heatmap. The smoothing the backend PNG does by hand = a one-line texture sampler setting. So you can ship a *small* grid and the GPU makes it look high-res.
- **Pollutant switch = swap a uniform** (channel index), zero refetch.
- **Tweening = `mix()` uniform** between two buckets → fluid motion across 10-min steps.
- **EAQI ramp = swap a lookup** in the shader.

## Risk areas (where the engineering actually lives)
- Mercator quad coords + projection matrix (well-documented MapLibre custom-layer API).
- EAQI color ramp as a small lookup texture or stepped function.
- Uint8 packing for mobile (avoids float-texture gap).

None are research problems — all standard WebGL. I can write the whole thing.

## My call
Since the backend emits the grid **anyway**, building Option 1 first then replacing it is partly throwaway work. The marginal cost of going **straight to Option 4** is a few days, and you get pollutant-switching + tweening + mobile-friendliness immediately.

**Recommendation:** build Opt 4 directly, but have the backend **also** emit the bounds-PNG (one extra render of the same grid) as a zero-risk fallback if the WebGL layer misbehaves on some device. Backend dual-emit is cheap; frontend gets the good path with a safety net.

Want me to (1) lock EAQI + this playback strategy into ARCHITECTURE.md, then (2) scaffold and start on the custom layer + shaders?

---

**Claude:**

Good catch — that breaks the "4 pollutants in one RGBA texture" elegance, and it surfaces two deeper design points. Real pollutant set is ~14 (PM1, PM2.5, PM5, PM10, TSP, NO, NO2, NOx, NH3, O3, SO2, H2S, CO, CO2) + composite AQI, grouped by sensor method, **shipped separately** (not every vehicle has every module).

Three fixes:

## 1. Pollutant list must be data-driven, not hardcoded 4
The biggest structural fix. Frontend must **not** hardcode pollutants. Backend exposes them:
```
GET /pollutants → [{ key, label, unit, group, scale, available }]
  group: "PM" | "NOx" | "SOx" | "carbon" ...   (sensor method / module)
  available: bool  (this deployment actually has the module)
```
Tabs render dynamically from this, ideally **grouped by sensor method** (PM • NO/NO₂/NOx/NH₃/O₃ • SO₂/H₂S • CO/CO₂). Adding a pollutant later = backend change only, zero frontend edits. This matches "shipped separately" — coverage per pollutant varies by deployment.

## 2. GPU layer: one grid per pollutant, load active only
Drop the 4-in-RGBA packing as the primary model — doesn't scale to 14. Instead:
- **One Uint8 single-channel grid per pollutant per bucket** (1 byte/cell — even smaller).
- User views **one pollutant at a time** → only ever fetch the active pollutant's bucket series.
- Pollutant switch = fetch that series; **prefetch on tab hover** → feels instant.
- *Optional later:* pack the 4 most-used (AQI, PM2.5, NO₂, O₃) into one RGBA for zero-fetch switching among defaults. Premature now — defer.

Scales to any N cleanly. The shader stays the same; only which texture you bind changes.

## 3. Color scales must be per-pollutant — EAQI doesn't cover everything
Important: **EAQI is only defined for 5 pollutants** (PM2.5, PM10, NO₂, O₃, SO₂). The other ~9 (CO, CO₂, NH₃, H₂S, PM1, PM5, TSP, NOx, NO) have **no EAQI band** → you can't paint them with one universal AQI ramp.

So:
- **AQI tab** = composite EAQI (computed by backend, the headline view).
- **Each gas tab** = its own concentration scale with EU/WHO limit thresholds → its own color ramp.
- The `scale` field in `/pollutants` tells the frontend which ramp to use. Shader takes the ramp as a **lookup texture/uniform keyed per pollutant** — already in the Opt 4 design, just now driven per-pollutant instead of one EAQI ramp.

## Net architectural change
- Pollutant set + groups + color scales = **backend-defined data**, frontend renders dynamically.
- GPU heatmap = per-pollutant single-channel grid, active-only fetch + hover prefetch.
- Per-pollutant color ramps (EAQI for the 5, concentration scales for the rest, composite for AQI).
- For the **demo**: still ship a handful (say AQI, PM2.5, NO₂, CO) so it's manageable — but wire it through the data-driven `/pollutants` mechanism so scaling to 14 is config, not a rewrite.

This actually simplifies the shader story (one channel, one ramp at a time) at the cost of giving up the RGBA-switch trick — correct trade for 14 pollutants.

Want me to fold all of this (EAQI lock, playback Opt1→Opt4, data-driven pollutants, per-pollutant scales) into ARCHITECTURE.md now?

---

**Claude:**

Folding everything into ARCHITECTURE.md: EAQI lock, MVP pollutants (AQI/PM2.5/NO₂/CO), data-driven pollutant system, per-pollutant scales, playback strategy with shader-first Opt 4.

---

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

_[tool: Write — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

All folded into [ARCHITECTURE.md](ARCHITECTURE.md). Now reflects:

- **EAQI** locked; **MVP pollutants = AQI, PM2.5, NO₂, CO** (wired through data-driven `/pollutants` so scaling to ~14 is config).
- **Heatmap = shader-first** (GPU value-grid + custom layer) as primary; bounds-PNG fallback; tiles for explore only.
- **Per-pollutant grids** (Uint8, active-only fetch + hover prefetch), **per-pollutant color scales** (EAQI for the 5, concentration scales for gases, composite AQI).
- Playback bottleneck + fixes (texture swap + `mix()` tween + buffer-ahead).
- Districts dropped → point-pick. MapTiler dropped. Trails colored + pickable.
- Updated API contract (`/grid`, `/pollutants`, fallbacks), folder layout (custom layer + shaders + playback buffer), perf, mock strategy.

6 open items left (all deferrable): vehicle count, FastAPI confirm, backend interp lib, base style, demo data span, grid resolution.

Next move options:
- **A)** Scaffold monorepo (frontend Vite+React+TS+MapLibre + folder skeleton + typed API stubs; backend FastAPI skeleton + worktrees), then start the custom WebGL heatmap layer.
- **B)** Knock out the easy open items first (FastAPI, interp lib, grid res, base style) so scaffold is fully spec'd.

I'd do **A** — open items don't block scaffolding, and the shader layer is the riskiest piece worth proving early. Say go and I'll set up the repo structure + start the heatmap custom layer.

---

**Claude:**

Good call — simplifies the build. Shader-only now, PNG/tiles become a "later, only if needed" note. Updating the plan.

---

**Claude:**

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Done. Plan now **shader-only** — PNG/tiles fully deferred (marked "not built now," add only on shader failure or old-device need). [ARCHITECTURE.md](ARCHITECTURE.md) updated: decisions table, heatmap section, API contract (`/grid` is the sole render endpoint), perf section.

Heatmap path is now single + clean:
- Backend: `/grid/{pollutant}/{t}.bin` → Uint8 grid.
- Frontend: MapLibre custom WebGL layer, data texture + per-pollutant ramp shader, GPU-smoothed, tweened, buffer-ahead playback.

Ready to scaffold. Plan:
1. Monorepo + 2 worktrees (`frontend/`, `backend/`).
2. Frontend: Vite+React+TS+M

---
