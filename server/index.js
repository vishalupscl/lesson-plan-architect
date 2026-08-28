import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "..", "dist");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini-2026-03-17";
// Optional: constrain reasoning effort on reasoning models (none|low|medium|high).
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "low";

// ---- Teacher profile records (the admin database) ----
// Submitted onboarding profiles are stored in one JSON file under DATA_DIR.
// On Fly, mount a volume and set DATA_DIR=/data so records survive deploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");
// Admin access requires ADMIN_PASSWORD (e.g. `fly secrets set ADMIN_PASSWORD=...`).
// Without it, the admin endpoints stay locked for everyone.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function loadEntries() {
  let raw;
  try {
    raw = fs.readFileSync(PROFILES_FILE, "utf8");
  } catch (err) {
    // Only a genuinely missing file means "no records yet". Any other read
    // problem (permissions, disk, corruption) must fail the request — the
    // upsert path would otherwise overwrite the store with a near-empty file.
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  const parsed = JSON.parse(raw); // a parse error throws → 500, never a wipe
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

const MAX_ENTRIES = 5000;

function saveEntries(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = PROFILES_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 2));
  fs.renameSync(tmp, PROFILES_FILE);
}

function passwordMatches(givenHeader) {
  if (!ADMIN_PASSWORD) return false;
  // The admin page URI-encodes the password so non-ASCII passwords survive
  // the header; plain ASCII passes through decode unchanged.
  let given = String(givenHeader || "");
  try { given = decodeURIComponent(given); } catch { /* keep as sent */ }
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Brute-force guard: after 10 straight failures, admin login locks for
// 15 minutes. In-memory — restarting the server clears it.
let adminFailCount = 0;
let adminLockUntil = 0;

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: "Admin access is not configured. Set the ADMIN_PASSWORD environment variable (on Fly: fly secrets set ADMIN_PASSWORD=...) and restart."
    });
  }
  if (Date.now() < adminLockUntil) {
    return res.status(429).json({ error: "Too many wrong attempts. Try again in a few minutes." });
  }
  if (passwordMatches(req.get("x-admin-password"))) {
    adminFailCount = 0;
    return next();
  }
  adminFailCount += 1;
  if (adminFailCount >= 10) {
    adminLockUntil = Date.now() + 15 * 60 * 1000;
    adminFailCount = 0;
  }
  setTimeout(() => res.status(401).json({ error: "Wrong password." }), 750);
}

// Teachers submit here when they finish onboarding (no password — the app is
// their submission form). One record per (email, subject), upserted.
app.post("/api/profiles", (req, res) => {
  const { teacher_name, email, school, grades, subject, profile } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || cleanEmail.length > 254 || !cleanEmail.includes("@") ||
      !subject || !profile || typeof profile !== "object" || Array.isArray(profile)) {
    return res.status(400).json({ error: "A valid email, subject and profile are required." });
  }
  if (JSON.stringify(profile).length > 100000) {
    return res.status(413).json({ error: "Profile too large." });
  }
  const id = `${cleanEmail}::${String(subject).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const now = new Date().toISOString();
  const entries = loadEntries();
  const existing = entries.find((e) => e.id === id);
  if (!existing && entries.length >= MAX_ENTRIES) {
    return res.status(507).json({ error: "Records store is full — contact the administrator." });
  }
  const entry = {
    id,
    email: cleanEmail,
    teacher_name: String(teacher_name || "").slice(0, 200),
    school: String(school || "").slice(0, 200),
    grades: Array.isArray(grades) ? grades.map(Number).filter(Number.isFinite).slice(0, 20) : [],
    subject: String(subject).slice(0, 100),
    profile,
    created_at: existing ? existing.created_at : now,
    updated_at: now
  };
  saveEntries([...entries.filter((e) => e.id !== id), entry]);
  res.json({ ok: true, id });
});

app.get("/api/profiles", requireAdmin, (req, res) => {
  res.json({ entries: loadEntries() });
});

app.delete("/api/profiles/:id", requireAdmin, (req, res) => {
  const entries = loadEntries();
  const next = entries.filter((e) => e.id !== req.params.id);
  if (next.length === entries.length) return res.status(404).json({ error: "Entry not found." });
  saveEntries(next);
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not set. Copy .env.example to .env and add your key."
    });
  }

  const { prompt, maxTokens } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "Missing 'prompt' in request body." });
  }

  try {
    // Reasoning models spend tokens on hidden reasoning that also counts against
    // max_completion_tokens, so add headroom to avoid truncating the visible answer.
    const outputBudget = (maxTokens || 1024) + 4096;

    const body = {
      model: MODEL,
      max_completion_tokens: outputBudget,
      messages: [{ role: "user", content: prompt }]
    };
    if (REASONING_EFFORT) body.reasoning_effort = REASONING_EFFORT;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "OpenAI API error" });
    }

    const text = (data.choices || []).map((c) => c.message?.content || "").join("\n");
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error" });
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distPath, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using model: ${MODEL}`);
  if (process.env.NODE_ENV === "production") {
    console.log(`Serving static files from ${distPath}`);
  }
});
