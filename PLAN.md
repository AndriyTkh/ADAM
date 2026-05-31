# ADAM — Build Plan & Task Board

> **This is the working doc.** Day-to-day: read this. It carries app summary, repo/worktree
> setup, conventions, and the task board. Reach for [STRUCTURE.md](STRUCTURE.md) only when you
> need the deep spec for a task (API header bytes, clamp table, shader gotchas, folder layout).
> STRUCTURE = *what it is* (source of truth, changes rarely). PLAN = *what we're doing now*.

---

## App in one screen

Single-page Kyiv air-quality map. Production-shaped React frontend + real Python (FastAPI)
backend. **Backend owns all compute** (interpolation, stats, ML, mocks). Frontend is a pure
render/query client — talks to one versioned API (`/v1/`).

Core idea: everything keyed to **10-min time buckets**. Two nav modes — single-bucket
(live / jump / step) and bounded **range playback** (preload → play/scrub). Heatmap is a
**GPU custom WebGL2 layer** fed a Uint8 value grid per bucket; playback streams a delta+brotli
blob into a RAM ring buffer and swaps 2 textures via `texSubImage2D`.

MVP pollutants: **AQI, PM2.5, NO₂, CO**. EU EAQI standard. Demo data is backend-mocked
(real OpenAQ sensors @ ~3 stations/hour + mocked vehicles + computed grid).

Full detail → [STRUCTURE.md](STRUCTURE.md).

---

## Repo & worktrees

Monorepo, **2 git worktrees** for parallel front/back work — both on `main`, separate
checkouts so an agent on one side never blocks the other.

```
ADAM/                      # this checkout (docs, shared)
  STRUCTURE.md  PLAN.md
backend/                   # worktree — Python + FastAPI
frontend/                  # worktree — React 18 + TS + Vite
```

Setup (run once, see Task SETUP-1):
```
git worktree add ../ADAM-backend  main   # or a backend/ subtree per chosen layout
git worktree add ../ADAM-frontend main
```

> **Worktree rule for agents:** stay inside your assigned worktree. Cross-cutting changes
> (API contract shape) update STRUCTURE.md first, then both sides reference it. Never edit
> the other side's files from your worktree.

---

## Conventions

- **API is the contract.** Types in `frontend/src/api/types.ts` mirror FastAPI pydantic
  models. Change one → change both → bump `/v1`-level note in STRUCTURE if shape changes.
- **Binary little-endian**, header spec locked in STRUCTURE → "Binary header spec". Frontend
  rejects mismatched `ver`.
- Commit per task, message references task ID (`[BE-3] grid range blob endpoint`).
- Pre-generate demo buckets to flat files; never compute on-the-fly mid-demo.

---

## Status legend

| Mark | Meaning |
|---|---|
| `TODO` | Not started |
| `WIP` | In progress |
| `HOLD` | Blocked / paused (note why) |
| `DONE` | Complete + verified |
| `CANCEL` | Dropped (note why) |

---

## Task board

Each task is sized for one coding agent. **Deps** = task IDs that must land first.
Tasks marked `[FE]`/`[BE]` run in that worktree; `[INFRA]`/`[DOC]` in root.

### Phase 0 — Foundation

| ID | Status | Task | Deps | Notes |
|---|---|---|---|---|
| SETUP-1 | TODO | Create 2 git worktrees (frontend/backend), scaffold both projects (Vite+TS, FastAPI), root README pointing to PLAN | — | Decide subtree-vs-sibling worktree layout |
| SETUP-2 | TODO | Local dev wiring: Vite dev-proxy → FastAPI, CORS origins, ports, `.env` for API base URL | SETUP-1 | **Gap: not yet in STRUCTURE — spec here** |
| SETUP-3 | TODO | Shared binary header codec (encode py / decode ts) + round-trip test as parity contract | SETUP-1 | Header spec in STRUCTURE |

### Phase 1 — Backend core

| ID | Status | Task | Deps | Notes |
|---|---|---|---|---|
| BE-1 | TODO | `GET /v1/pollutants` catalog (drives FE tabs/scales) | SETUP-1 | MVP 4, `available` flag |
| BE-2 | TODO | Grid generator: mock hotspots → IDW/RBF (scipy) → 256² Uint8 grid per bucket | SETUP-1 | **Gap: algo/params unspecced — define here** |
| BE-3 | TODO | `GET /v1/grid/{pollutant}/{t}.bin` single-bucket + header | BE-2, SETUP-3 | 204 on empty bucket |
| BE-4 | TODO | `GET /v1/grid/{pollutant}/range` packed delta+brotli blob, frameskip, KEYFRAME_INTERVAL=60 | BE-3 | Immutable cache headers |
| BE-5 | TODO | Step→stride + clamp-table enforcement (422 below min-step) | BE-4 | Table locked in STRUCTURE |
| BE-6 | TODO | `GET /v1/timerange` (bounds, steps, buckets) | BE-2 | |
| BE-7 | TODO | OpenAQ wrapper: `/v1/sensors`, `/v1/sensors/readings` (hold hourly across buckets, datetimeLast) | SETUP-1 | Hide key, cache, CORS |
| BE-8 | TODO | Mock vehicles: `/v1/vehicles`, `/v1/vehicles/{id}/path` w/ per-vertex readings | BE-2 | Count TBD (Open Item 1) |
| BE-9 | TODO | `GET /v1/point` interpolated all-pollutant reading + nearestSensor | BE-2 | Primary spatial interaction |
| BE-10 | TODO | `GET /v1/alerts` (WS demoted/optional) | BE-2 | |
| BE-11 | TODO | Bounds-PNG fallback dual-emit (built, frontend unwired) | BE-2 | Insurance |
| BE-12 | TODO | Pre-generate demo bucket span to flat files + static serve | BE-2..BE-9 | Span TBD (Open Item 3) |

### Phase 2 — Frontend core

| ID | Status | Task | Deps | Notes |
|---|---|---|---|---|
| FE-1 | TODO | API client + TanStack queries + types (mirror pydantic) | SETUP-2, SETUP-3 | query keys include {pollutant,t,mode} |
| FE-2 | TODO | MapView + dark base + Kyiv bounds | SETUP-1 | Base style TBD (Open Item 2) |
| FE-3 | TODO | HeatmapLayer: WebGL2 custom layer, 2 persistent textures, per-pollutant ramp shader | FE-2, BE-3 | Fail fast if no WebGL2 |
| FE-4 | TODO | Decode worker (delta-decode, frameskip-aware, transferable) | SETUP-3 | Brotli = browser, not worker |
| FE-5 | TODO | Playback engine: ring buffer + buffer-ahead + texSubImage2D loop + mix() tween | FE-3, FE-4, BE-4 | The perf core |
| FE-6 | TODO | NavWindow: single-bucket nav + range playback, step selector w/ live clamp greying | FE-5, BE-5, BE-6 | |
| FE-7 | TODO | PollutantTabs (dynamic from /pollutants) + Legend (per-pollutant scale) + scales.ts | FE-1, BE-1 | |
| FE-8 | TODO | SensorsLayer (circle, tier-styled, recolor per bucket) | FE-2, BE-7 | |
| FE-9 | TODO | VehiclesLayer (lerp during playback) + TrailLayer (line-gradient, pickable vertices) | FE-2, BE-8 | source.setData outside React |
| FE-10 | TODO | Point-pick pin → PointPanel (all pollutants, confidence, AbortController latest-wins) | FE-2, BE-9 | |
| FE-11 | TODO | TopBar (logo, AQI badge, vehicle count, UTC+3 clock, staleness) | FE-1 | DST-aware labels |
| FE-12 | TODO | URL deep-link state {pollutant,t,mode,range} | FE-6, FE-7 | |
| FE-13 | TODO | Loading/skeleton states + WebGL2 fail + context-loss recovery | FE-3, FE-5 | |

### Phase 3 — Hardening

| ID | Status | Task | Deps | Notes |
|---|---|---|---|---|
| QA-1 | TODO | Measure heaviest dense blob (10d @10m = 1440 frames) on real-ish ML output, verify <15MB wire | BE-4 | Open Item 6 — only unknown needing real data |
| QA-2 | TODO | Test suite: header codec parity, delta round-trip, clamp table, frameskip chain | SETUP-3, BE-4 | **Gap: no test strategy in STRUCTURE** |
| QA-3 | TODO | Deploy: build FE static, serve pre-gen buckets, api.adam.in.ua | Phase 1+2 | **Gap: deploy steps unspecced** |

---

## Testing & Debug Hooks (reference — build in SETUP/QA tasks)

### Testing strategy
Pick tests that give an **agent a fast headless pass/fail**. Layer:

**Backend (pytest) — highest ROI, all headless:**
- **Header codec parity** — encode in py, assert bytes = locked spec (STRUCTURE → Binary header spec).
- **Delta round-trip** — `decode(encode(frames)) == frames`, incl. frameskip gaps + keyframe-every-60.
- **Clamp table** — `parametrize` straight from STRUCTURE range→min-step rows; 422 below min-step.
- **Grid invariants** — 256², dims mult-of-4, Uint8 range, bbox/scale in header.
- **Route contract** — FastAPI `TestClient`, assert response shapes mirror `types.ts`.

**Frontend (vitest) — pure logic only:**
- `decodeWorker` delta-decode, `time.ts` bucket-snap + DST labels, `scales.ts` ramps,
  `urlState` round-trip, clamp greying. Deterministic → good agent signal.
- **Skip** unit tests for MapLibre/shader/ring-buffer render — verify via `/run` + `/verify` (screenshot).
- Optional later: 1 Playwright smoke (map loads, tab switch, pin-pick). Defer — brittle early.

**Contract bridge (the key seam):** binary header + delta format spans both worktrees.
Commit **golden `.bin` fixtures**; py AND ts suites assert against the same files → catches drift.

### Debug hooks (Claude Code) — autosetup later
Two layers, do NOT conflate:
1. **Live dev servers** = background processes, not hooks. `npm run dev` (Vite HMR) +
   `uvicorn --reload`, launched `run_in_background`. They hot-rebuild on save already.
2. **Per-edit gate** = `PostToolUse` hook on `Write|Edit`, auto-runs check for the edited
   side, feeds errors back to the agent.

Hook plan (`.claude/settings.json`, **PowerShell** on this Windows box unless Git Bash):
- FE edits → `if: "Edit(frontend/**)"` → `tsc --noEmit` + `vitest related --run`.
- BE edits → `if: "Edit(backend/**)"` → `ruff check` + `pytest -q` on touched module.
- Use **`asyncRewake: true`**: runs in background, non-blocking, **wakes Claude on failure
  (exit 2)** with error output. Exit 0 = silent pass.
- Optional `SessionStart` hook → boot both dev servers in background.

Caveats:
- Settings watcher only picks up new hooks if `.claude/settings.json` existed at session
  start → first wire needs `/hooks` reopen or restart.
- Build hooks AFTER SETUP-1 — tsc/pytest need real projects to run against. → see QA-2.

## Open items (carried from STRUCTURE)

1. Vehicle count for demo — pick a number (BE-8).
2. Base map style — CartoDB dark raster vs vector (FE-2).
3. Demo data span to pre-generate (BE-12).
4. ✅ Step→min-step clamp — LOCKED.
5. ✅ Keyframe interval = 60 — LOCKED.
6. Brotli wire size on real data (QA-1) — last real unknown.

## Spec gaps to resolve in-task (not yet in STRUCTURE)

- Backend folder layout (counterpart to FE tree) — define during SETUP-1.
- Local dev wiring (proxy/ports/CORS) — SETUP-2.
- Grid-gen mock hotspot algorithm/params — BE-2.
- Test strategy — QA-2.
- Build/deploy steps — QA-3.
