# ADAM — Production Deploy Plan (live demo)

Host the Phase-1 demo (see STRUCTURE.md → Ship Scope). Frontend on **Vercel**,
backend on **Render**, spindown beaten with a **ping service**. Backend is a thin
static `.bin`/JSON file server — scipy runs only at local gen time, never per-request.

> Repo layout: backend = `ADAM-backend/`, frontend = `ADAM-frontend/` (2 worktrees).

---

## Grid resolution: 512 local → 256 demo

`grid_dim` is a single config var — no code change to switch.
[ADAM-backend/app/config.py](../ADAM-backend/app/config.py) → `grid_dim: int`.

| Stage | grid_dim | Why |
|---|---|---|
| Local A/B | **512** | Eyeball the visual quality gain vs 256. Generate a SHORT span only (1 day) — 512² = 256KB/bin, 4× disk. |
| Live demo | **256** | 64KB/bin. Sharp enough GPU-filtered, 4× lighter wire + disk + git. |

**512 local test (throwaway):**
```bash
cd ADAM-backend
# set grid_dim=512 in config.py (or ADAM_GRID_DIM=512 env)
python -m scripts.pregenerate --days 1 --force
# inspect map locally, compare to 256. Do NOT commit 512 grids.
```
Revert to `grid_dim=256` before generating demo data.

---

## ⚠️ Data size gate (do this first — 309MB already on disk)

Current `app/data/grid` = **309MB** (1153 buckets × 4 pollutants @256²). Too big to
ship in a git deploy. Bound it before deploy:

1. **Wipe + regen a tight span** for the demo:
   ```bash
   cd ADAM-backend
   rm -rf app/data/grid/*           # clear old wide span
   # grid_dim=256 confirmed
   python -m scripts.pregenerate --days 3 --force
   ```
   3 days @256² = 432 buckets × 4 × 64KB ≈ **110MB**. Still heavy for git.

2. **Pick ONE storage path:**
   - **A. Commit to git (simplest):** acceptable if ≤~100MB. Set demo span to **2 days**
     (~73MB) if 3 is too big. Render ships the repo into the container.
   - **B. Cloudflare R2 (cleaner, recommended if >100MB):** upload `app/data/grid/` to
     R2 (free 10GB, zero egress). Backend serves a redirect, or frontend hits R2 URL
     directly for `.bin`. Keeps git lean.
   - **C. Render Disk:** persistent disk, upload once. Free tier disk is limited; only if
     A/B don't fit.

   **Default: A with 2–3 day span.** Revisit only if git push chokes.

3. **(Optional) gzip `.bin` at rest** — single-bucket route currently serves raw 64KB.
   Smooth field gzips ~6×. Pre-gzip files + serve `Content-Encoding: gzip` (browser
   `DecompressionStream` decodes natively). Cuts disk + wire. Defer if A fits.

4. Set the demo window bounds so the FE time axis matches the generated span:
   `ADAM_DEMO_FROM` / `ADAM_DEMO_TO` (config.py `demo_from`/`demo_to`).

---

## Backend → Render

### 1. Add a start config
No Dockerfile/render.yaml yet. Use Render **native Python** (no Docker needed):
- **Build command:** `pip install -r requirements.txt`
- **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Root directory:** `ADAM-backend` (if deploying the monorepo) or point Render at the
  backend repo/worktree.

> scipy/numpy install fine on Render (no 250MB function cap — it's a container). They're
> only needed at gen time but harmless in the runtime image.

### 2. Env vars (Render dashboard)
pydantic-settings, prefix `ADAM_`. **List/tuple vars need JSON syntax:**
```
ADAM_CORS_ORIGINS=["https://<your-vercel-app>.vercel.app"]
ADAM_GRID_DIM=256
ADAM_DEMO_FROM=<iso>
ADAM_DEMO_TO=<iso>
ADAM_OPENAQ_API_KEY=<key>        # if sensors wired
```
CORS currently allows only localhost:5173 — **must add the Vercel origin** or the FE
gets blocked.

### 3. Verify after deploy
```bash
curl -I https://<render-app>.onrender.com/v1/grid/pm25/<bucket>.bin   # 200, immutable cache
curl    https://<render-app>.onrender.com/v1/pollutants               # JSON
```
Check `Access-Control-Allow-Origin` header echoes the Vercel domain.

### 4. Beat spindown (ping)
Render free spins down after ~15 min idle (~50s cold wake). Add **UptimeRobot** (free)
HTTP monitor hitting a light endpoint every 5 min:
- Target: `https://<render-app>.onrender.com/v1/pollutants` (cheap, no compute)
- Keeps the instance warm through a live demo.

---

## Frontend → Vercel

### 1. Fix the dev hardcode (blocking)
[ADAM-frontend/src/main.tsx:12](../ADAM-frontend/src/main.tsx#L12) posts to
`http://localhost:8000/client-log` unconditionally. In prod this errors every load.
Guard it:
```ts
if (import.meta.env.DEV) { /* client-log fetch */ }
```

### 2. Vercel project
- Framework preset: **Vite**. Build: `npm run build`. Output: `dist`.
- Root directory: `ADAM-frontend`.
- **Env var:** `VITE_API_BASE_URL=https://<render-app>.onrender.com`
  (already consumed by [src/api/client.ts](../ADAM-frontend/src/api/client.ts#L2) — no
  code change, no rebuild lie).

### 3. Verify
- Load the Vercel URL → map renders, `/v1/grid/...bin` requests hit Render, 200.
- Network tab: no `localhost` calls, no CORS errors.

---

## Cutover order (do in this sequence)

1. ✅ Confirm `grid_dim=256` in config (after any 512 local test).
   — Already 256 in `config.py`. No change needed.
2. ⬜ Wipe + regen demo grid at chosen span (2–3 days). Confirm total size fits chosen
   storage path (git vs R2).
   — **BLOCKED: needs decision.** Current grid = 288MB spanning 2026-05-24→06-01 (8 days).
   — `app/data/` is in `.gitignore` — path A (commit to git) requires un-ignoring
     `app/data/grid/` explicitly. If git path: add `!app/data/grid/` exception to
     `.gitignore`, then regen 2 days (~73MB) and commit.
   — Path B (R2) keeps git clean — upload grid after regen.
3. ✅ Guard `main.tsx` client-log behind `import.meta.env.DEV`. — DONE.
4. ⬜ Deploy backend to Render. Set env vars (incl. CORS — but Vercel URL not known yet,
   use a placeholder then update in step 6).
   — `render.yaml` created with build/start commands + placeholder env vars.
   — Update `ADAM_CORS_ORIGINS` after Vercel URL is known.
5. ⬜ Verify backend endpoints + cache headers via curl.
6. ⬜ Deploy frontend to Vercel with `VITE_API_BASE_URL` = Render URL. Copy the Vercel
   domain back into `ADAM_CORS_ORIGINS` on Render, redeploy backend.
7. ⬜ Add UptimeRobot ping on the Render endpoint.
8. ⬜ Full smoke test on the live Vercel URL: map, pollutant tabs, point-pick, vehicles,
   alerts, simple range play, jump-to-date.

---

## Risks / watch list

| Risk | Mitigation |
|---|---|
| Git push chokes on grid size | Drop to 2-day span, or move grids to R2 (path B). |
| Render cold start mid-demo | UptimeRobot 5-min ping; warm it manually ~2 min before showing. |
| CORS blocked | `ADAM_CORS_ORIGINS` must list exact Vercel origin (https, no trailing slash). |
| `main.tsx` localhost log errors in prod | Guarded behind `import.meta.env.DEV` (step 3). |
| Demo span ≠ FE time axis | Set `ADAM_DEMO_FROM/TO` to match regenerated buckets. |

---

## Explicitly NOT in this deploy (Phase 2 — see STRUCTURE.md)
- Full delta+brotli replay engine (range route exists but unused by simple play).
- Road layer (300k segments).
- Confidence grid.
- WebSocket alerts (polling only).
