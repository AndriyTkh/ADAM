# Architecture.md pre-mortem

_AI tool: Claude (Claude Code, Anthropic). Session abce8f48. ADAM project._

**You:**

go through architecture.md. 
think through it, try to preventivly guess what could go wrong with this plan and suggest changes. 
account for missed features and optimizations

---

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Read. Solid plan. Risks + gaps below.

## Heatmap shader — biggest risk concentration

**Shader-only = single point of failure.** Custom MapLibre WebGL layer is fiddly: mercator projection matrix math, context-loss handling, `prerender`/`render` lifecycle. If shader path breaks mid-demo, no fallback exists. Bounds-PNG is "deferred" but it's the cheap insurance. **Change: build PNG dual-emit in backend from day one** (same grid, ~5 lines). Don't wire frontend, just have the endpoint. De-risks demo for near-zero cost.

**Uint8 single-channel data texture gotchas:**
- WebGL1 vs WebGL2 matters. `R8` single-channel needs WebGL2 (`gl.R8`/`gl.RED`). WebGL1 path = `LUMINANCE` or pack into RGBA. MapLibre may give you WebGL1 context. **Decide + lock the GL version. Spec it in the plan.**
- `UNPACK_ALIGNMENT` — 128²/256² widths are fine (multiples of 4), but if grid dims ever go odd, texture upload corrupts. Pin dims to multiples of 4.
- GPU linear filtering on Uint8 quantizes to 256 levels. For smooth gradient over wide concentration range, 256 steps visible-banding possible. Probably fine for demo, note it.

**`mix()` tween between buckets needs BOTH textures resident.** That's the double-buffer in buffer.ts — good. But tween across a pollutant switch is undefined (different scales). Guard: no tween when pollutant changes, only when `t` changes.

**Mercator quad pinned to Kyiv bounds:** grid is lat/lng regular but mercator is nonlinear in Y. At Kyiv latitude (~50.4°) the distortion across the city span is small but nonzero. If grid cells are equal-lat-spacing and you map linearly to mercator-Y, heatmap skews slightly. **Either pre-project grid to mercator-equal-spacing backend-side, or do the mercator transform in vertex shader.** Cheap to ignore for demo, but note it.

## Playback / fast-forward

- **"one bucket per ~1 real second" + weeks of data.** Weeks × 144 buckets/day = ~1000 buckets/week. Fetching each as separate `.bin` HTTP req during playback = request storm. Prefetch queue helps but **batch endpoint missing**. Add `GET /grid/{pollutant}/range?from=&to=` → packed multi-bucket blob, or a manifest. Otherwise hover-prefetch can't keep ahead at 1 bucket/sec.
- **Buffer-ahead "advance only when next buffered"** — good, but define behavior on stall: pause vs slow vs skip. Spec it.
- **Vehicle animation tween during fast-forward**: positions come per-bucket from `/vehicles?t=`. At 1 bucket/sec you need interpolated lat/lng between buckets or vehicles teleport-jump. Plan says "tweened" — confirm frontend lerps positions; needs prev+next vehicle frame, same as heatmap double-buffer.

## API contract gaps

- **No batch readings.** `/sensors/readings?t=` is single-bucket. Playback needs ranges → add `?from=&to=`. Same for `/vehicles`. Without it, playback = N polls.
- **No grid header schema defined.** "header: dims, bbox, scale min/max" — lock exact byte layout (magic, version, dims u16, bbox f32×4, min/max f32, then bytes). Version field critical so frontend can reject mismatched format. **Add explicit binary spec.**
- **No error/empty-bucket contract.** What does `/grid` return for a bucket with no data? 404? empty grid? Frontend playback must handle holes in timeline gracefully.
- **No caching headers mentioned.** Historical buckets are immutable → `Cache-Control: immutable, max-age=large`. Live bucket → short. This makes playback re-scrub free after first pass. **Big win, add it.**
- **CORS / content-type for `.bin`** — `application/octet-stream` + CORS on binary endpoint. Easy to forget, breaks fetch.
- **Versioning:** prefix `/v1/`. Cheap now, painful later.

## State / UX gaps

- **`uiStore` + TanStack:** timeState.t as query key is right, but live-poll + historical-scrub share cache. Make sure query keys include pollutant AND t AND mode. Stale "live" showing on historical scrub = classic bug.
- **No loading/skeleton states** in folder layout. Point query, grid fetch all async. Add loading affordance, especially point-pick (interpolation latency).
- **Point-pick race:** rapid clicks → out-of-order responses land in panel. Need request cancellation / latest-wins (AbortController in client.ts).
- **Legend must match active scale** — when pollutant has no EAQI (CO, others), legend shows concentration scale. Already noted, good. Ensure Legend reads from `/pollutants` scale field, not hardcoded.
- **Clock UTC+3** hardcoded — Kyiv is UTC+2 winter / UTC+3 summer (DST). Today 2026-05-31 = summer = +3, but historical scrub across DST boundary mislabels. Minor, note it.
- **Accessibility / colorblind:** AQI green→red ramp is the worst colorblind case. Consider viridis-style or patterns. Demo-optional.

## Missed features worth flagging

- **URL state / deep-link:** encode `{pollutant, t, mode}` in URL query. Free shareable demo states, survives reload. High value, low cost.
- **Comparison / diff view:** two buckets or two pollutants side-by-side — strong demo wow, but scope creep. Park it.
- **Sensor vs interpolated trust indicator:** point-pick returns `interpolated:true` + `nearestSensor`. Surface distance-to-nearest-sensor as confidence. Cheap credibility win.
- **No data-staleness indicator:** if live bucket is older than 10min (backend lag), show "data as of HH:MM". Already have `datetimeLast` — use it.

## Backend open-items — opinions

- **FastAPI: confirm yes.** Async + pydantic contracts match the typed-frontend goal. 
- **Grid lib:** `scipy.interpolate` (IDW/RBF) → numpy array → bytes is simplest. `datashader` overkill unless huge point counts. `rasterio` only if you need geotiff/CRS. **Start scipy, it's enough.**
- **Grid res: 256²** = 64KB/bucket Uint8. Tiny. With immutable caching, no reason to go 128². Pick 256².
- **Demo span:** generating weeks × 144 buckets × 14 pollutants grids = storage. MVP 4 pollutants × ~2 weeks × 144 = ~1100 grids × 64KB ≈ 70MB. Fine. Pre-generate to flat files, serve static. **Don't compute on-the-fly during demo.**

## Top priority changes

1. Build bounds-PNG dual-emit backend-side now (insurance), even if frontend unwired.
2. Lock GL version (WebGL2 assumed) + exact `.bin` binary header spec + version field.
3. Add range/batch endpoints for grid + readings + vehicles (playback needs it).
4. Immutable cache headers on historical buckets.
5. AbortController + latest-wins on point-pick and grid fetch.
6. URL deep-link state.

Want me to write these into ARCHITECTURE.md as a "Risks & Revisions" section, or fold into the relevant sections inline?

---

**Claude:**

Good. Bounded range + batch preload kills the request-storm risk I flagged. Cleaner scope. Implications:

## Bounded-range playback — refined

**Lifecycle = select → preload → play.** Three states matter:
- `idle` (no range), `loading` (fetching batch), `ready` (buffered, playable). UI must gate play button on `ready`, show preload progress bar (X/N buckets).
- **2-week cap math:** 2wk × 144 buckets/day = 2016 buckets. × 64KB (256² Uint8) = **~129MB per pollutant**. Too big to hold all textures in GPU/RAM at once. → **Don't preload as textures. Preload as raw bytes** (ArrayBuffers), upload to texture per-frame from RAM during play. 129MB ArrayBuffer is borderline on mobile. **Cap default range smaller (e.g. 3 days = ~28MB) or downsample buckets for long ranges** (play every Nth bucket when range > X). Spec the cap as range-dependent.
- **Batch endpoint required** (as flagged): `GET /grid/{pollutant}/range?from=&to=` → single packed blob: `[header][bucket0][bucket1]...`. One request, not 2016. Add bucket-count + per-bucket timestamp index in header.
- **Memory release:** drop ArrayBuffers when range changes / page leaves. Easy leak otherwise.

## Navigation window (top-left over map)

Controls list — lock these:
- Calendar date-picker (jump to date)
- Live toggle (snap to latest bucket, start polling)
- Step ±10min (single bucket nudge)
- Range select (start+end) → triggers preload → play/pause/rewind/speed scrubber
- **Add: current-bucket timestamp readout** (always show which bucket on screen, UTC+3 w/ DST caveat).

Two distinct modes in one window — **single-bucket nav** (live/step/jump) vs **range playback**. Make the mode switch explicit so step-buttons don't fight the playback scrubber. Suggest: range-select reveals the playback sub-controls; clearing range returns to single-bucket nav.

## Pin point-pick — all pollutants

- `/point` currently returns `pm25,no2,co,aqi`. Make it **return all available pollutants** (data-driven, not hardcoded 4) so panel shows full breakdown. Highlight the active-tab pollutant (bold/badge).
- Still need AbortController latest-wins (rapid re-pin).
- Show `nearestSensor` distance as confidence (cheap credibility).
- One pin at a time, or multiple? Decide. Single pin simplest; multi-pin = compare, scope creep.

## Legend (bottom-left) + pollutant bar
- Legend swaps with active pollutant scale (EAQI vs concentration). Already covered.
- Pollutant bar = the `/pollutants`-driven tabs, grouped by sensor method.

## Layout summary
```
┌─────────────────────────────────────┐
│ [Nav window]              [TopBar?]  │  ← top-left nav over map
│                                      │
│            FULL MAP                  │
│                          [PinPanel]→ │  ← point-pick readings right
│ [Legend]          [Pollutant bar]    │  ← legend bottom-left
└─────────────────────────────────────┘
```
Confirm: does TopBar (logo/AQI badge/clock) still exist, or did nav window absorb it? And pollutant bar — bottom or top?

Want me to rewrite ARCHITECTURE.md now folding in: bounded-range playback (replacing fast-forward), nav-window UI spec, all-pollutant point-pick, batch range endpoints, GL/binary-header lock, immutable caching, AbortController? Or hold for your TopBar/bar-placement answers first?

---

**You:**

yea, i agree with your layout. 
what solution do you suggest that allowes to avaid browser memory, loading speed, httpp req overload, maplibre redraw speed limitaions bottlenecks to allow past data replays as well as fast step switches

---

**Claude:**

Core insight: **separate the four bottlenecks, solve each with a different layer.** Don't let one solution (preload-everything) try to fix all — that's what blows memory.

## The 4 bottlenecks, mapped

| Bottleneck | Wrong fix | Right fix |
|---|---|---|
| HTTP req overload | one req/bucket | **1 batched range req**, chunked |
| Loading speed | wait for full range | **stream + play-when-buffered**, low-res first |
| Browser memory | all buckets as GPU textures | **raw bytes in RAM, ring buffer, 1-2 textures live** |
| MapLibre redraw | re-add layer/setData per frame | **upload to existing texture, `triggerRepaint`, never touch layer graph** |

## Solution: streaming ring-buffer + single live texture

### 1. Backend — one packed binary, server-compressed
```
GET /grid/{pollutant}/range?from=&to=&stride=
→ [header][delta-frame0][delta-frame1]...
   header: magic, ver, dims, bbox, scaleMinMax, bucketCount, t-index[]
   frames: gzip/brotli over the wire (Content-Encoding)
```
- **stride param** = server-side temporal downsample. Long range → return every Nth bucket. Client asks for stride matched to range length (2wk → stride 6 = hourly; 1 day → stride 1).
- **Delta encoding between consecutive buckets** before gzip: air quality changes slowly cell-to-cell → deltas are mostly zero → brotli crushes it. 129MB raw → likely <15MB wire for 2wk. Backend precomputes once, caches.
- **Immutable cache headers** → second replay = 0 bytes, served from disk cache.

### 2. Network — chunked streaming, not one blob
- Don't `await` whole range. **Split into day-chunks** (`from`/`to` per request, ~3-6 parallel max). 
- Play starts when **first chunk** buffered, not last. Rest streams behind playhead.
- Buffer-ahead queue: keep playhead N buckets behind download frontier; pause playback only if frontier catches up.

### 3. Memory — RAM ring buffer, decode-on-demand
- Hold decoded **Uint8 grids in a fixed-size ring buffer in RAM** (JS `Uint8Array`s), e.g. window of 300 buckets ≈ 19MB at 256². Not GPU textures.
- Evict oldest as playhead advances. Long range never fully resident → memory flat regardless of range length.
- GPU side: **only 2 textures ever exist** (current + next for `mix()` tween). Reused, re-uploaded — never allocated per frame.

### 4. MapLibre redraw — the critical part
- **Never** call `addLayer`/`removeLayer`/`setData` on the heatmap during playback. That triggers style diff + full repaint = your bottleneck.
- Custom WebGL layer holds 2 persistent `WebGLTexture`s. Per frame:
  1. `gl.texSubImage2D` upload next grid bytes into the spare texture (sub-image reuses allocation, fast).
  2. set `u_mix` uniform for tween.
  3. `map.triggerRepaint()` — repaints only, no style recompute.
- `texSubImage2D` of 64KB is ~sub-millisecond. This is the whole trick — **decouple data swap from MapLibre's layer lifecycle.**

### 5. Fast step-switch (±10min) + scrub
- Step/scrub = same path: grab grid from ring buffer (already in RAM if within window) → `texSubImage2D` → repaint. **Instant, no network** when buffered.
- If scrub lands outside buffered window → fetch that single bucket (`/grid/{pollutant}/{t}.bin`), show last-frame until it lands (no spinner flash).

## Decode-cost watch
gzip/brotli decode of stream — do it in a **Web Worker**, not main thread, or playback hitches. Worker decodes chunk → posts `Uint8Array` (transferable, zero-copy) → main thread fills ring buffer. Keeps 60fps render loop clean.

## Data flow
```
fetch (chunked, brotli) → Worker (decompress+delta-decode)
   → transfer Uint8Array → ring buffer (RAM, evicting)
   → render loop: texSubImage2D into 1of2 textures + mix() + triggerRepaint
```

## Numbers (256², 2wk, stride applied)
- Wire: ~10-15MB brotli (vs 129MB raw)
- RAM resident: ~19MB ring (vs 129MB all-resident)
- GPU: 2 textures = 128KB
- Per-frame cost: 1 `texSubImage2D` + 1 uniform + repaint = sub-ms
- Replay #2: 0 network (immutable cache)

Every bottleneck isolated. Want this written into ARCHITECTURE.md as the playback/perf spec (replacing current "Playback bottleneck" + "Performance Plan" sections), plus the doc rewrite we discussed?

---

**You:**

upd architecture file

---

**Claude:**

Writing full update folding in all decisions.

---

**Claude:**

_[tool: Write — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

_[tool: Write — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

ARCHITECTURE.md rewritten. Key changes folded in:

- **Playback engine section** — 4 bottlenecks each isolated: batched brotli+delta blob, chunked stream-play, RAM ring buffer (flat memory), `texSubImage2D` into 2 persistent textures (never touch layer graph). Web Worker decode.
- **Range playback** replaces fast-forward — 2wk cap, range-dependent `stride` downsample.
- **Nav window UI** — two explicit sub-modes (single-bucket nav vs range playback), full layout diagram.
- **All-pollutant point-pick** + nearestSensor confidence + AbortController.
- **Locked:** WebGL2, FastAPI, scipy, 256², `/v1/`, binary header byte spec.
- **Bounds-PNG fallback** built backend-side now, unwired.
- **Immutable caching**, batch range endpoints, 204 empty-bucket contract.
- **Added wins:** URL deep-link, staleness banner, DST-aware clock, loading states.
- Open Items trimmed to real unknowns (added stride table + brotli/gzip measure).

Prior `init.md` / `pitch_brief.md` marked superseded in the header — want me to delete them, or leave until you confirm?

---
