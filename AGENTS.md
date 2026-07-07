# AGENTS.md

## Cursor Cloud specific instructions

Lesson Plan Architect — a React (Vite) SPA plus a small Express proxy. There is no
database (data lives in browser `localStorage`) and no lint or test tooling configured.

### Services
- **Vite dev server** (frontend) — port `5173`, `npm run client`.
- **Express AI proxy** (`server/index.js`) — port `8787`, `npm run server`. Holds the
  OpenAI key server-side and exposes `POST /api/chat`; Vite proxies `/api` → `:8787`.
- `npm run dev` runs both together via `concurrently`. Do not run it as a blocking
  foreground process; it is a long-lived dev server (use a background/tmux session).

### AI provider
- Uses the **OpenAI Chat Completions** API (`api.openai.com`). Requires `OPENAI_API_KEY`.
  Optional: `OPENAI_MODEL` (default `gpt-5.4-mini-2026-03-17`), `OPENAI_REASONING_EFFORT` (default `low`).
- Non-AI features (taxonomy, teacher profiles, Export JSON, prompt preview) work without a
  key. AI features (freehand decode, struggle sorting, plan generation) return HTTP 500
  without a valid key + egress to `api.openai.com`.
- `.env` is git-ignored; copy `.env.example` to `.env`. `server/index.js` uses `dotenv`,
  which does **not** override variables already present in the process environment — an
  `OPENAI_API_KEY` injected as an env var wins over the `.env` file value.
- `server/index.js` has no hot reload; restart the dev process after editing it. Frontend
  files hot-reload via Vite.

### Build
- `npm run build` (Vite production build). No lint/test scripts exist.
