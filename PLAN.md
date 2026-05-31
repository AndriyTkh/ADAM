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
| SETUP-1 | DONE | Create 2 git worktrees (frontend/backend), scaffold both projects (Vite+TS, FastAPI), root README pointing to PLAN | — | Sibling worktrees, branch-per-side (see Worktree layout below) |
| SETUP-2 | DONE | Local dev wiring: Vite dev-proxy → FastAPI, CORS origins, ports, `.env` for API base URL | SETUP-1 | Spec'd below (Dev wiring) |
| SETUP-3 | DONE | Shared binary header codec (encode py / decode ts) + round-trip test as parity contract | SETUP-1 | `binary.py`/`binaryHeader.ts`, golden fixtures, both suites green |

### Phase 1 — Backend core

| ID | Status | Task | Deps | Notes |
|---|---|---|---|---|
| BE-1 | DONE | `GET /v1/pollutants` catalog (drives FE tabs/scales) | SETUP-1 | MVP 4, `available` flag |
| BE-2 | DONE | Grid generator: mock hotspots → IDW/RBF (scipy) → 256² Uint8 grid per bucket | SETUP-1 | 5 hotspots, IDW p=2, traffic+drift modulation — algo locked in `grid_gen.py` |
| BE-3 | DONE | `GET /v1/grid/{pollutant}/{t}.bin` single-bucket + header | BE-2, SETUP-3 | immutable cache on historical |
| BE-4 | DONE | `GET /v1/grid/{pollutant}/range` packed delta+brotli blob, frameskip, KEYFRAME_INTERVAL=60 | BE-3 | Immutable cache headers |
| BE-5 | DONE | Step→stride + clamp-table enforcement (422 below min-step) | BE-4 | Table locked in STRUCTURE |
| BE-6 | DONE | `GET /v1/timerange` (bounds, steps, buckets) | BE-2 | 3-day demo span (Open Item 3 resolved) |
| BE-7 | DONE | OpenAQ wrapper: `/v1/sensors`, `/v1/sensors/readings` (hold hourly across buckets, datetimeLast) | SETUP-1 | Mock when key empty; real fetch skeleton wired |
| BE-8 | DONE | Mock vehicles: `/v1/vehicles`, `/v1/vehicles/{id}/path` w/ per-vertex readings | BE-2 | 8 vehicles (Open Item 1 resolved) |
| BE-9 | DONE | `GET /v1/point` interpolated all-pollutant reading + nearestSensor | BE-2 | Primary spatial interaction |
| BE-10 | DONE | `GET /v1/alerts` (WS demoted/optional) | BE-2 | threshold-based mock |
| BE-11 | DONE | Bounds-PNG fallback dual-emit (built, frontend unwired) | BE-2 | Insurance; needs Pillow (optional dep) |
| BE-12 | TODO | Pre-generate demo bucket span to flat files + static serve | BE-2..BE-9 | Span TBD (Open Item 3) |

### Phase 2 — Frontend core

| ID | Status | Task | Deps | Notes |
|---|---|---|---|---|
| FE-1 | DONE | API client + TanStack queries + types (mirror pydantic) | SETUP-2, SETUP-3 | client.ts, queries.ts, types.ts, range.ts, live.ts |
| FE-2 | DONE | MapView + dark base + Kyiv bounds | SETUP-1 | CartoDB Dark Matter raster; MapContext for child layers |
| FE-3 | DONE | HeatmapLayer: WebGL2 custom layer, 2 persistent textures, per-pollutant ramp shader | FE-2, BE-3 | Fetches live from BE-3; context-loss recovery wired |
| FE-4 | DONE | Decode worker (delta-decode, frameskip-aware, transferable) | SETUP-3 | decodeWorker.ts; brotli stays browser-side |
| FE-5 | DONE | Playback engine: ring buffer + buffer-ahead + texSubImage2D loop + mix() tween | FE-3, FE-4, BE-4 | ringBuffer.ts, buffer.ts, engine.ts |
| FE-6 | TODO | NavWindow: single-bucket nav + range playback, step selector w/ live clamp greying | FE-5, BE-5, BE-6 | |
| FE-7 | DONE | PollutantTabs (dynamic from /pollutants) + Legend (per-pollutant scale) + scales.ts | FE-1, BE-1 | PollutantTabs.tsx, Legend.tsx, scales.ts (EAQI+conc ramps) |
| FE-8 | TODO | SensorsLayer (circle, tier-styled, recolor per bucket) | FE-2, BE-7 | |
| FE-9 | TODO | VehiclesLayer (lerp during playback) + TrailLayer (line-gradient, pickable vertices) | FE-2, BE-8 | source.setData outside React |
| FE-10 | TODO | Point-pick pin → PointPanel (all pollutants, confidence, AbortController latest-wins) | FE-2, BE-9 | |
| FE-11 | DONE | TopBar (logo, AQI badge, vehicle count, UTC+3 clock, staleness) | FE-1 | DST-aware via Intl; stale + alert badge |
| FE-12 | DONE | URL deep-link state {pollutant,t,mode,range} | FE-6, FE-7 | urlState.ts; uiStore pushes on every change |
| FE-13 | WIP | Loading/skeleton states + WebGL2 fail + context-loss recovery | FE-3, FE-5 | WebGL2 fail + context-loss in HeatmapLayer; skeletons pending |

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

1. ✅ Vehicle count — **8 vehicles** (2 trucks, 3 vans, 3 bikes). Locked in BE-8.
2. ✅ Base map style — CartoDB Dark Matter raster. LOCKED.
3. ✅ Demo data span — **3 days** (live rolling window). Locked in BE-6/BE-12.
4. ✅ Step→min-step clamp — LOCKED.
5. ✅ Keyframe interval = 60 — LOCKED.
6. Brotli wire size on real data (QA-1) — last real unknown.

## Worktree layout (SETUP-1, locked)

Sibling worktrees, one branch each (git refuses same branch in two worktrees):

```
ADAM/            main      docs/shared
ADAM-backend/    backend   Python 3.13 + FastAPI (.venv local)
ADAM-frontend/   frontend  React + TS + Vite
```

`git worktree add -b <branch> ../ADAM-<side> main`. Stay in your worktree;
contract changes go through STRUCTURE first.

### Backend folder layout (SETUP-1, counterpart to FE tree)
```
ADAM-backend/
  app/
    main.py            # FastAPI app, CORS, /v1 router mount, /health
    config.py          # pydantic-settings, env prefix ADAM_, Kyiv bbox/grid_dim
    api/v1/__init__.py # APIRouter; sub-routers added per BE task
    core/
      binary.py        # header codec (SETUP-3) — mirrors binaryHeader.ts
      grid_gen.py      # BE-2 (TODO)
      buckets.py       # 10-min bucket helpers (TODO)
    models/schemas.py  # pydantic mirrors of types.ts (TODO)
    data/              # pre-generated demo buckets (gitignored, BE-12)
  tests/
    fixtures/          # golden .bin shared w/ FE __fixtures__
    test_binary.py
  requirements.txt  .env.example  .venv/
```

### Dev wiring (SETUP-2, locked)
- Ports: FastAPI `:8000`, Vite `:5173`.
- Vite proxies `/v1` + `/health` → `VITE_API_PROXY_TARGET` (default
  `http://localhost:8000`) so dev browser is same-origin (no CORS in dev).
- Prod: FE hits `VITE_API_BASE_URL` (e.g. `https://api.adam.in.ua`) directly;
  backend `CORSMiddleware` allows `ADAM_CORS_ORIGINS`.
- Client rule: empty `VITE_API_BASE_URL` → request `/v1/...` (proxied);
  set → absolute base. Env templates: `.env.example` both sides.

## Spec gaps to resolve in-task (not yet in STRUCTURE)

- Grid-gen mock hotspot algorithm/params — BE-2.
- Test strategy — QA-2.
- Build/deploy steps — QA-3.
