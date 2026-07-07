# Lesson Plan Architect

A local, runnable version of the lesson plan architect prototype: taxonomy
management, teacher response intake, AI-assisted classification, human
review, and lesson plan generation.

## What's in here

- `src/LessonPlanArchitect.jsx` — the app (same logic as the original
  artifact, with one change: it calls a local proxy instead of OpenAI
  directly).
- `src/profile.js` — **Teacher Profile module**: the schema (v1), the
  freehand extraction + struggle-categorisation prompts, the four-layer
  prompt assembler, and the renderer that turns a profile JSON into the
  compact `<teacher_profile>` block the backend prompt consumes.
- `src/ProfileView.jsx` — **Teacher Profiles tab**: onboard a teacher,
  capture session shape (with AI extraction from freehand), pick Session
  Flow + Teaching Moves, add personal overlays, log student struggles
  (auto-sorted into concept-specific / subject-general / foundational),
  set assessment style and plan preferences, then **Export JSON** (the
  file the backend stores per teacher) and **Preview prompt** (the
  assembled four-layer prompt, for demos).
- `src/storage-shim.js` — a localStorage-backed stand-in for the
  `window.storage` API the app was originally written against.
- `server/index.js` — a small Express server that holds your OpenAI API
  key and forwards requests to `api.openai.com`, so the key never reaches
  the browser.

## The Teacher Profile flow (what this app is for)

This app is the standalone authoring tool for the **teacher profile layer**
of lesson-plan personalisation. It does not connect to Clarius; the handoff
is a file:

1. **Onboard** a teacher in the Teacher Profiles tab.
2. **Capture** how she teaches — type freehand and let AI extract into
   fields, or fill directly. Pick from the standard library, or add a
   personal **overlay** on a standard entry (the base stays generic; her
   adaptation travels with her).
3. **Export JSON** — one blob per teacher per subject. This is stored under
   the teacher's record in your backend, injected into the prompt when
   present, ignored when absent (so nothing breaks for un-onboarded
   teachers).
4. **Preview prompt** shows the assembled four-layer prompt
   (master + profile + curriculum) so you can see and demo exactly what the
   backend would send — no Clarius needed.

The output lesson-plan JSON schema never changes; personalisation lives
entirely inside the existing fields. See the roadmap document for the full
architecture.

## 1. Prerequisites

- Node.js 18 or later (`node -v` to check)
- An OpenAI API key from https://platform.openai.com/api-keys

## 2. Install

```bash
npm install
```

## 3. Add your API key

```bash
cp .env.example .env
```

Open `.env` and paste your key in place of `sk-your-key-here`.

## 4. Run it

```bash
npm run dev
```

This starts both the Express proxy (port 8787) and the Vite dev server
(port 5173) together. Open:

```
http://localhost:5173
```

If you'd rather run them in two terminals: `npm run server` in one,
`npm run client` in the other.

## Notes

- **Data storage**: taxonomy and submissions are saved in your browser's
  localStorage, scoped to this app. Clearing your browser's site data for
  `localhost:5173` will reset everything. This is fine for local testing;
  it is not multi-user and won't sync across machines or browsers.
- **API key safety**: the key lives only in `.env` and is read by the
  Node server — it's never sent to or exposed in the browser. Don't commit
  `.env` (it's already in `.gitignore`).
- **Model**: defaults to `gpt-5.4-mini-2026-03-17`. Override with `OPENAI_MODEL`
  in `.env` if you want a different one (e.g. `gpt-5.4` for higher
  quality generation, or `gpt-5.4-nano` for cheaper/faster
  classification calls). `OPENAI_REASONING_EFFORT` (default `low`) tunes how
  much hidden reasoning the model does — raise it for tougher generation.
- **Taxonomy data**: Mathematics is seeded with two entries marked
  `(sample)` so you can see the shape of the data. Delete them from the
  Taxonomy Library tab and add your real Pedagogy Engine library.

## Going beyond local

This setup is for running on your own machine. For a real rollout with
multiple teachers and admins, you'd want to swap `storage-shim.js` for
calls to a real backend (Postgres or similar) with proper accounts and
roles — the rest of the app's logic (classify → review → prompt →
generate) carries over unchanged.
