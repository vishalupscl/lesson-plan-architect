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
// Generous enough for the page images of a scanned form (each request is
// additionally bounded per-endpoint below).
app.use(express.json({ limit: "24mb" }));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini-2026-03-17";
// Optional: constrain reasoning effort on reasoning models (none|low|medium|high).
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "low";

// ---- Teacher profile records (the admin database) ----
// Submitted onboarding profiles are stored in one JSON file under DATA_DIR.
// On Fly, mount a volume and set DATA_DIR=/data so records survive deploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");
const SCHOOLS_FILE = path.join(DATA_DIR, "schools.json");
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

// ---- The school list behind the sign-in dropdown ----
// Seeded with one placeholder until the real list is loaded; the admin
// manages it from the records page, and a teacher whose school is missing
// can add it herself while signing in.
const DEFAULT_SCHOOLS = ["Demo School"];
const MAX_SCHOOLS = 2000;

function loadSchools() {
  let raw;
  try {
    raw = fs.readFileSync(SCHOOLS_FILE, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return [...DEFAULT_SCHOOLS];
    throw err;
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.schools) ? parsed.schools : [...DEFAULT_SCHOOLS];
}

function saveSchools(schools) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SCHOOLS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ schools }, null, 2));
  fs.renameSync(tmp, SCHOOLS_FILE);
}

function sortedSchools(schools) {
  return [...schools].sort((a, b) => a.localeCompare(b));
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

// The sign-in dropdown reads this; no password (it is public information and
// the page needs it before anyone is identified).
app.get("/api/schools", (req, res) => {
  res.json({ schools: sortedSchools(loadSchools()) });
});

// Open like the profile submission: a teacher whose school is missing must be
// able to add it and carry on. The admin can delete anything stray.
app.post("/api/schools", (req, res) => {
  const name = String((req.body || {}).name || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) {
    return res.status(400).json({ error: "Please enter a school name between 2 and 120 characters." });
  }
  const schools = loadSchools();
  const existing = schools.find((s) => s.toLowerCase() === name.toLowerCase());
  if (existing) return res.json({ ok: true, name: existing, schools: sortedSchools(schools) });
  if (schools.length >= MAX_SCHOOLS) {
    return res.status(507).json({ error: "The school list is full — contact the administrator." });
  }
  const next = [...schools, name];
  saveSchools(next);
  res.json({ ok: true, name, schools: sortedSchools(next) });
});

app.delete("/api/schools/:name", requireAdmin, (req, res) => {
  const name = String(req.params.name || "");
  const schools = loadSchools();
  const next = schools.filter((s) => s.toLowerCase() !== name.toLowerCase());
  if (next.length === schools.length) return res.status(404).json({ error: "School not found." });
  saveSchools(next);
  res.json({ ok: true, schools: sortedSchools(next) });
});

// Page images of a scanned/photographed form. Bounded so one request can't
// push an unreasonable payload at the model.
const MAX_IMAGES = 8;
const MAX_IMAGE_CHARS = 4_000_000;   // ~3 MB per page once base64-encoded
const MAX_IMAGES_CHARS = 20_000_000;

function validateImages(images) {
  if (images === undefined || images === null) return { images: [] };
  if (!Array.isArray(images)) return { error: "'images' must be an array." };
  if (images.length > MAX_IMAGES) return { error: `At most ${MAX_IMAGES} page images can be read at once.` };
  let total = 0;
  for (const img of images) {
    if (typeof img !== "string" || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(img)) {
      return { error: "Each image must be a PNG, JPEG or WebP data URL." };
    }
    if (img.length > MAX_IMAGE_CHARS) return { error: "One of the pages is too large." };
    total += img.length;
  }
  if (total > MAX_IMAGES_CHARS) return { error: "Those pages are too large to read at once." };
  return { images };
}

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
  const checked = validateImages((req.body || {}).images);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const images = checked.images;

  try {
    // Reasoning models spend tokens on hidden reasoning that also counts against
    // max_completion_tokens, so add headroom to avoid truncating the visible answer.
    const outputBudget = (maxTokens || 1024) + 4096;

    // With images the message becomes multimodal content parts; plain prompts
    // keep the simple string form.
    const content = images.length
      ? [
          { type: "text", text: prompt },
          ...images.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } }))
        ]
      : prompt;

    const body = {
      model: MODEL,
      max_completion_tokens: outputBudget,
      messages: [{ role: "user", content }]
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
