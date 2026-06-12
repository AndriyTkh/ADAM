# Scope: brotli, ML cadence, openaq

_AI tool: Claude (Claude Code, Anthropic). Session b0b812c9. ADAM project._

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Read plan. Strong, production-shaped doc. Overall ~85% realistic. Few real holes. Breakdown:

## Confidence by area

**Solid (build as-is):**
- React+Vite+TS, FastAPI, MapLibre custom WebGL2 layer — all standard, proven.
- R8 single-channel data texture + `texSubImage2D` swap + `triggerRepaint` — correct WebGL2 pattern. 256² = 64KB, trivial.
- 2-texture tween via `mix()` uniform — right.
- RAM ring buffer + evict — sound. Memory math checks (~19MB @300 buckets).
- Point-pick replacing district polygons, data-driven pollutants, `available` flag — clean.
- Mercator skew in vertex shader — correctly flagged.
- Context-loss handler — good, often forgotten.

## Real problems — fix these

**1. Brotli in Web Worker = broken as written.** (line 70, 104, 354)
Browsers have NO native brotli decompress in JS. `DecompressionStream` supports gzip/deflate ONLY, not `br`. Two mutually-exclusive paths, plan mixes them:
- If server sends `Content-Encoding: br` → browser auto-decompresses at fetch layer. You never see compressed bytes. Worker gets raw, only does delta-decode. Fine — but then brotli is NOT in worker.
- If you want manual decode in worker → send raw body `application/octet-stream` (no Content-Encoding) → need brotli WASM lib (e.g. `brotli-wasm`) bundled. Adds weight + cost.

**Decision needed.** Cleanest: let browser do brotli (Content-Encoding: br), worker does delta-decode only. Drop "brotli decompress in worker" wording. Open Item #5 (brotli vs gzip decode cost) becomes moot if browser handles it.

**2. `<15MB for 2wk` is a guess, not a fact.** (line 83)
Delta+brotli on slowly-changing field → plausibly good, but 129MB→15MB = 8.6× is optimistic for noisy interpolated data. Don't lock the number. Frame as "target, measure early." Risk: if real ML output is noisy frame-to-frame, delta gives little. Mitigation already there (stride), keep it.

**3. OpenAQ Kyiv historical coverage = unverified risk.** (line 179, 332)
"Real: OpenAQ sensors" assumes Kyiv has stations with historical buckets at 10-min cadence. OpenAQ v3 cadence is often hourly, sparse, gaps. Your 10-min bucket model may have mostly-empty sensor buckets. Verify station count + cadence for Kyiv BEFORE committing sensors as "real." May need to mock sensors too, or interpolate sensor readings to buckets.

**4. `Cache-Control: immutable, max-age=large`** (line 165) — `large` is placeholder. Pick number (`max-age=31536000, immutable`). Minor.

## Smaller flags
- **Tab-hover prefetch** (line 121) for ~14 pollutant series × range = could nuke bandwidth budget. Cap to current range, single-bucket prefetch on hover, not whole range.
- **`mix()` only same pollutant** (line 107) — good, but also guard `scaleMin/Max` change mid-series (live recalibration). Hard-swap if scale shifts.
- **WS demoted but still listed** (line 199) — good call. Keep `LiveConnection` abstraction so demo runs zero WS.
- **Stride table empty** (Open Item #4) — this is load-bearing for the 2wk cap claim. Not optional; spec before backend range endpoint.
- **204 empty bucket** (line 174) — define behavior in delta stream too: a missing frame mid-range breaks delta chain (delta vs previous). Need keyframe/skip rule in blob header.

## Verdict
Architecture is realistic and well-reasoned. Two things would actually bite you in code:
1. **Brotli-in-worker contradiction** — resolve now (5 min decision).
2. **Delta-chain + missing buckets** — spec keyframe rule before backend builds range blob.

Everything else is tuning, not redesign. Want me to patch the doc for the brotli path + add a keyframe rule to the blob header spec?

---

**You:**

note your brotli fix in the docs

10 min cadence our own ml process only. openaq has 3 sensors at 1 per hour rate for Kyiv. remove tab-hover prefetch, i don't get that appeal at all.
handle missing buckets as frameskip, add functionality to support different step sizes for replay and navigation. could be from 10m to 1d. 

add those changes to the docs

---

**Claude:**

Edits planned. Going through doc.

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

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Done. 12 edits applied.

**Brotli fix** — Data flow + callout box: browser auto-decompresses `Content-Encoding: br`, worker does delta-decode only. Updated decodeWorker.ts comment, range.ts comment, "Decode off main thread", Open Item rewritten (decode free, only wire-size to measure).

**10-min = our ML only** — cadence row clarified, sensor section + mock strategy now state OpenAQ = ~3 Kyiv stations @ 1/hour, hourly hold-last mapping, "don't fake 10-min sensor data."

**Tab-hover prefetch removed** — gone from heatmap section + deleted prefetch.ts from folder layout.

**Missing buckets = frameskip** — blob header gains `frameType[]`, delta computed vs previous *present* frame, keyframe-after-gap rule, 204/omit note. New Open Item for keyframe interval N.

**Variable step (10m→1d)** — new "Variable step size" section, `step` param replaces `stride` in range endpoint, step maps to server stride + clamped by range length, `/v1/timerange` returns `steps[]`, NavWindow step selector for both nav + playback.

Two things still need a number before backend builds the range endpoint (Open Items #4 step→min-step clamp table, #5 keyframe interval). Want me to draft starting values for those?

---

**You:**

yea, finish this docs

---

**Claude:**

Drafting concrete values. Memory math first, then write into doc.

Resident-set target: keep ring buffer raw ≤ ~20MB (300 buckets @ 64KB). Wire target: keep blob small. Math:

---

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Allowed steps: 10m, 30m, 1h, 6h, 1d. Clamp rule: cap total frames in a request to bound wire + precompute; ring buffer caps resident memory independently. Writing table.

---

**Claude:**

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Now keyframe interval. Update Open Items #4, #5 → resolved values.

---

**Claude:**

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

Done. Doc complete.

**Locked values added:**

- **Step clamp** — rule: max 1500 frames/request. Table maps range-length → min-step. 14d forces 30m step (672 frames). Backend 422s sub-min steps; frontend greys out disallowed steps live. Two independent bounds split: ring buffer caps memory (~19MB), step caps frame count.
- **Keyframe interval** — `KEYFRAME_INTERVAL = 60` + forced after every gap. Scrub seeks from nearest keyframe (≤59 deltas), not whole chain. Decode strategy noted for worker.
- **Open Items #4, #5** marked ✅ resolved. #6 (wire size) left open — only thing needing real ML data to verify.

All earlier holes now either fixed or have concrete starting numbers. Sole remaining unknown is empirical (measure real blob size once ML emits real grids). Ready to build against.

---
