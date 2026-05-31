# ADAM

Single-page Kyiv air-quality map. Production-shaped React frontend + FastAPI
backend. Backend owns all compute; frontend is a pure render/query client on a
versioned `/v1` API.

**Working doc → [PLAN.md](PLAN.md)** (task board, conventions, setup).
**Deep spec → [STRUCTURE.md](STRUCTURE.md)** (API, binary header, shader notes).

## Layout — monorepo, 3 git worktrees (one branch each)

| Path | Branch | What |
|---|---|---|
| `ADAM/` | `main` | docs, shared source-of-truth |
| `ADAM-frontend/` | `frontend` | React 18 + TS + Vite |
| `ADAM-backend/` | `backend` | Python 3.13 + FastAPI |

Sibling worktrees on separate branches so parallel agents never block each other.
Cross-cutting contract changes: edit STRUCTURE.md first, then both sides mirror it.

```
git worktree list   # see all three
```

## Run

Backend:
```
cd ADAM-backend
.venv/Scripts/python -m uvicorn app.main:app --reload   # :8000
```

Frontend (proxies /v1 → :8000 in dev):
```
cd ADAM-frontend
npm run dev                                              # :5173
```

## Test

```
cd ADAM-backend  && .venv/Scripts/python -m pytest -q
cd ADAM-frontend && npm test
```

Shared binary wire format lives in `app/core/binary.py` (encode) and
`src/api/binaryHeader.ts` (decode); golden `.bin` fixtures are asserted by both
suites to catch drift.
