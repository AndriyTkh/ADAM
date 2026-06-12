# PLAN.md task tracking + worktree

_AI tool: Claude (Claude Code, Anthropic). Session f967c9cc. ADAM project._

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\STRUCTURE.md]_

---

**Claude:**

_[tool: Read — c:\Users\andri\Documents\WebDev\ADAM\ARCHITECTURE.md]_

---

**Claude:**

_[tool: Bash — cd c:/Users/andri/Documents/WebDev/ADAM && git worktree list && echo "---" && ls…]_

---

**Claude:**

STRUCTURE.md read. ARCHITECTURE.md gone (only STRUCTURE.md exists). No worktrees yet, no `frontend/`/`backend/` dirs — fresh repo.

## Coverage review of STRUCTURE.md

Strong on: frontend layout, API contract, playback engine, heatmap shader, mock strategy, UI. **Gaps found:**

1. **Backend folder layout** — frontend tree is fully specced, backend has none. Big asymmetry given backend owns all compute.
2. **Local dev / run** — ports, Vite proxy → FastAPI, CORS origin, how to start each side. Mentioned `dev: local proxy` but never specced.
3. **Testing strategy** — zero mention. At least: binary header round-trip, delta encode/decode parity, clamp table.
4. **Build/deploy** — `api.adam.in.ua` named, no build or static-serve steps for pre-generated buckets.
5. **Grid-gen mock algorithm** — "mock hotspots → IDW" named but no shape/params.

These are PLAN-level (how to build) not STRUCTURE-level (what it is) — so they belong in PLAN.md anyway. STRUCTURE itself is complete as a source-of-truth spec. I'll fold the gaps into PLAN tasks.

Writing PLAN.md now — primary working doc, STRUCTURE referenced only when deep spec needed.

---

**Claude:**

_[tool: Write — c:\Users\andri\Documents\WebDev\ADAM\PLAN.md]_

---

**Claude:**

Done. PLAN.md created.

**STRUCTURE.md verdict:** complete as a spec (what-it-is). 5 gaps found, all *how-to-build* not *what-it-is* → folded into PLAN tasks (backend folder layout, dev wiring, grid-gen algo, test strategy, deploy). Listed explicitly under "Spec gaps to resolve in-task."

**PLAN.md contains:**
- One-screen app summary + pointer to STRUCTURE for deep detail
- Worktree section: 2 worktrees (frontend/backend on `main`), setup cmds, agent rule "stay in your worktree"
- Conventions (API contract, binary header, commit-per-task)
- Status legend: `TODO / WIP / HOLD / DONE / CANCEL`
- Task board, 31 agent-sized tasks across 4 phases (Foundation, Backend, Frontend, Hardening), each with ID, status, deps, notes
- Open items + spec-gap list

Designed so PLAN is the daily doc; STRUCTURE referenced only when a task needs deep spec — header at top states that split explicitly.

Note: no worktrees/`frontend`/`backend` dirs exist yet — `git worktree list` shows only this checkout. SETUP-1 creates them. Want me to run SETUP-1 (scaffold worktrees + projects) now?

---

**Claude:**

## Testing — what fits this build + Claude Code

Pick tests that give an **agent a fast pass/fail signal** without a browser. Layer them:

**Backend (pytest) — highest ROI, all headless:**
- **Header codec parity** — encode in py, assert bytes match the locked spec. Pairs with FE decode test (QA-2).
- **Delta round-trip** — `decode(encode(frames)) == frames`, including frameskip gaps + keyframe-every-60. This is your blob correctness net.
- **Clamp table** — table-driven (`pytest.mark.parametrize`) straight from STRUCTURE's range→min-step rows. 422 below min-step.
- **Grid shape** — 256², dims multiple-of-4, Uint8 range, bbox/scale in header.
- **FastAPI route contract** — `TestClient`, assert pydantic response shapes = `types.ts`. Cheap regression wall.

**Frontend — keep narrow, agents can't see WebGL:**
- **Vitest** for pure logic only: `decodeWorker` delta-decode, `time.ts` bucket-snap + DST labels, `scales.ts` ramps, `urlState` round-trip, clamp greying. These are deterministic → great agent signal.
- **Skip** unit-testing MapLibre/shader/ring-buffer-render — not worth the mock cost. Verify those by **running the app** (the `/run` + `/verify` skills, screenshot).
- Optional later: 1 Playwright smoke (map loads, tab switch, pin-pick) — defer, brittle early.

**Contract bridge (the key one):** binary header + delta format is the front/back seam. Commit a few **golden `.bin` fixtures**; both py and ts test suites assert against the same files. Catches drift across the 2 worktrees.

→ This is QA-2 on the board. Want me to expand QA-2 into per-layer subtasks?

## Hooks for live build debugging

Yes — two mechanisms, both auto-settable.

**1. PostToolUse hooks** (settings.json) — auto-run typecheck/lint after every edit, feed errors back to the agent. Per-worktree via `cwd` match:

---

**Claude:**

_[tool: Skill]_

---

**Claude:**

Already covered testing above. Now hooks — key distinction first:

## Hooks vs live dev servers — two different things

**Hooks fire on Claude Code *events*** (after an edit, before a bash cmd, on stop). They can't "watch a live build" continuously. What you actually want is two layers:

1. **Live dev servers** → background processes, not hooks. `npm run dev` (Vite) + `uvicorn --reload` (FastAPI) launched with `run_in_background`. Vite HMR + uvicorn `--reload` already hot-rebuild on file change. Claude reads their logs on demand.
2. **Per-edit gate** → `PostToolUse` hook on `Write|Edit`. After Claude edits a file, auto-run typecheck/lint/test for *that* side, feed errors straight back into context. This is the autosetup-able debug loop.

## PostToolUse hook — the options that matter here

- **`matcher`**: `"Write|Edit"` — fires after file writes.
- **`if`**: permission-rule filter, e.g. `"Edit(frontend/**)"` vs `"Edit(backend/**)"` — lets you run **tsc** for FE edits and **ruff/mypy/pytest** for BE edits, two separate hooks, no cross-firing. Maps cleanly to your 2 worktrees.
- **`async: true`**: runs in background, non-blocking — good for a slow `pytest`.
- **`asyncRewake: true`**: runs async **and wakes Claude on failure (exit 2)** with the error output. This is the magic one — Claude keeps working, and if the background check breaks, it gets pulled back to fix it. Best fit for "debug live builds."
- **`exit code 2`** = blocking error → output fed to model. `0` = silent pass.
- **Windows note**: hooks default to **PowerShell** here (no Git Bash assumed). The skill's `jq`-based examples are bash — I'd write PowerShell equivalents, or use `shell: "bash"` if you have Git Bash.

## What I'd actually wire (autosetup)

In `.claude/settings.json`:
- FE edits → `tsc --noEmit` + `vitest related --run` (fast, `asyncRewake`)
- BE edits → `ruff check` + `pytest -q` on touched module (`asyncRewake`)
- `SessionStart` hook → optional: boot both dev servers in background.

Catch: the settings watcher only picks up hooks if `.claude/settings.json` existed at session start — first-time setup needs a `/hooks` reopen or restart to go live.

**Blocker:** worktrees/projects don't exist yet (SETUP-1). tsc/pytest have nothing to run against. Recommend: do SETUP-1 first, *then* wire hooks. Want me to:

---

**Claude:**

_[tool: AskUserQuestion]_

---

**Claude:**

Document only. Adding a "Testing & Debug Hooks" section to PLAN.md.

---

**Claude:**

_[tool: Edit — c:\Users\andri\Documents\WebDev\ADAM\PLAN.md]_

---

**Claude:**

Added. New **"Testing & Debug Hooks (reference)"** section in PLAN.md, before Open Items. Captures:

- **Testing strategy** — backend pytest (header parity, delta round-trip, clamp table, grid invariants, route contract), frontend vitest (pure logic only, skip WebGL → use `/run`+`/verify`), and the golden `.bin` fixture bridge across both worktrees.
- **Debug hooks** — the two-layer model: background dev servers (Vite HMR + uvicorn `--reload`) vs `PostToolUse` per-edit gate. Concrete config: `if:"Edit(frontend/**)"` → tsc+vitest, `if:"Edit(backend/**)"` → ruff+pytest, all `asyncRewake:true`. PowerShell note + watcher caveat + "build after SETUP-1".

Cross-linked to QA-2. Nothing wired into settings.json — pure reference, as chosen.

---
