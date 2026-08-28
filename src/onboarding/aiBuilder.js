// Teacher Onboarding — profile builder.
//
// Every narrative segment of the exported Teacher Profile JSON is built by the
// AI (via the existing /api/chat OpenAI proxy) from the teacher's plain-language
// answers: it cleans up phrasing, sorts struggles into the three tiers, and
// fills derived fields like `implication` — while never inventing content the
// teacher didn't say. If the API is unreachable, a deterministic fallback maps
// the answers verbatim so onboarding always completes (the app must stay fully
// usable standalone).

export const ONBOARDING_SUBJECTS = [
  "Mathematics",
  "Science",
  "English",
  "Social Science",
  "Literacy"
];

// School list is a placeholder until the real list is fed from the backend.
export const SCHOOLS = ["Demo School"];

export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const AID_OPTIONS = [
  "Blackboard",
  "Whiteboard",
  "Projector",
  "Smart TV",
  "Charts / posters",
  "Worksheets",
  "Science kit / lab",
  "Computers / tablets",
  "Speakers / audio"
];

export const MEDIUM_OPTIONS = [
  "English", "Hindi", "Tamil", "Telugu", "Kannada", "Marathi", "Bengali"
];

export const SESSION_FIELDS = [
  ["opener", "How do you usually start the class?", "e.g., I ask a quick question about the last lesson"],
  ["delivery", "How do you teach the main topic?", "e.g., I explain on the board, then work through one example"],
  ["aids", "What do you use while teaching?", "e.g., Blackboard, charts, a worksheet"],
  ["checkpoint", "How do you check that students are following?", "e.g., I ask 2–3 students to try one on the board"],
  ["practice_release", "How do students practise in class?", "e.g., They solve questions on their own while I walk around"],
  ["closer", "How do you end the class?", "e.g., One quick question before the bell"],
  ["homework", "What homework do you usually give?", "e.g., 2–3 questions from the same topic"],
  ["homework_review", "How do you check homework?", "e.g., I check a few notebooks the next morning"]
];

export const FACILITATION_FIELDS = [
  ["style", "In one or two lines, what is your way of teaching?", "e.g., I show one example fully, then students try a similar one"],
  ["engagement", "How do you keep students involved?", "e.g., I talk to students one by one while they work"],
  ["consolidation", "How do you help the lesson stick?", "e.g., A quick recap at the start of the next class"]
];

export const ASSESSMENT_FIELDS = [
  ["pre_test", "Before a new chapter, how do you check students are ready?", "e.g., A short 5-question check on what they should already know"],
  ["post_test", "After a chapter, how do you test?", "e.g., A mixed test — easy, medium and hard questions"],
  ["revision", "How do you handle revision?", "e.g., We re-practise the questions most students got wrong"]
];

// Subject-appropriate examples for the struggles step, so a teacher sees the
// kind of answer expected (handoff §10: examples matched to the subject).
export const STRUGGLE_EXAMPLES = {
  Mathematics: {
    topics: "e.g., Students mix up area and perimeter",
    habits: "e.g., They jump to formulas without reading the question",
    basics: "e.g., Some students are weak in multiplication tables"
  },
  Science: {
    topics: "e.g., Students confuse evaporation and boiling",
    habits: "e.g., They memorise definitions without understanding",
    basics: "e.g., Some students can't read simple measurements"
  },
  English: {
    topics: "e.g., Students struggle with tenses in longer sentences",
    habits: "e.g., They write the way they speak",
    basics: "e.g., Some students read very slowly"
  },
  "Social Science": {
    topics: "e.g., Students mix up dates and events across chapters",
    habits: "e.g., They copy from the book instead of answering in their own words",
    basics: "e.g., Some students can't read maps at all"
  },
  Literacy: {
    topics: "e.g., Students confuse similar-looking letters",
    habits: "e.g., They guess words instead of sounding them out",
    basics: "e.g., Some students don't yet know all letter sounds"
  }
};

// ---------------- small helpers ----------------

export function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Filename-friendly: keep letters/numbers in any script (teachers may write
// their name in Devanagari, Tamil, …), join words with dashes.
function fileToken(s, fallback = "unknown") {
  return String(s || "").trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "") || fallback;
}

export function exportFileName(account, subject) {
  const grades = (account.grades || []).slice().sort((a, b) => a - b).join("-");
  const emailLocal = String(account.email || "").split("@")[0];
  const name = fileToken(account.name, fileToken(emailLocal, "teacher"));
  return `${fileToken(account.school)}_${name}_Grade-${grades || "NA"}_${fileToken(subject)}.json`;
}

function trimStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Deep-strip empty strings, nulls, empty arrays and empty objects so the
// exported JSON only carries what the teacher actually said (every field in
// the profile spec is optional).
export function stripEmpty(value) {
  if (Array.isArray(value)) {
    const arr = value.map(stripEmpty).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const sv = stripEmpty(v);
      if (sv !== undefined) out[k] = sv;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const t = value.trim();
    return t ? t : undefined;
  }
  if (typeof value === "boolean" || typeof value === "number") return value;
  return undefined;
}

// ---------------- active-mode input selection ----------------
// Each of the session/style steps offers "answer quick questions" OR "write in
// my own words". Only the mode the teacher left active counts — with a
// fallback to the other side if the active one is empty, so switching modes
// never silently loses everything she typed.

function activeInput(obj, keys, mode) {
  const fields = {};
  let any = false;
  for (const key of keys) {
    const v = trimStr(obj[key]);
    fields[key] = v;
    if (v) any = true;
  }
  const freehand = trimStr(obj.freehand);
  const useFreehand = mode === "freehand" ? !!freehand : !any && !!freehand;
  if (useFreehand) {
    for (const key of keys) fields[key] = "";
    return { fields, freehand };
  }
  return { fields, freehand: "" };
}

export function activeSessionInput(session) {
  return activeInput(session || {}, SESSION_FIELDS.map(([k]) => k), (session || {}).mode);
}

export function activeFacilitationInput(fac) {
  return activeInput(fac || {}, FACILITATION_FIELDS.map(([k]) => k), (fac || {}).mode);
}

// ---------------- deterministic fallback build ----------------
// Maps the teacher's answers into the profile segments exactly as written.
// Used as the base the AI result is merged over, and as the full result when
// the AI proxy is unavailable.

export function deterministicBuild(answers, shared, subject) {
  const sessionIn = activeSessionInput(answers.session);
  const session_shape = { ...sessionIn.fields };
  // A freehand description with no AI to split it lands in `delivery` so
  // nothing is lost; the teacher can move text around on the review screen.
  if (sessionIn.freehand) session_shape.delivery = sessionIn.freehand;

  const facIn = activeFacilitationInput(answers.facilitation);
  const facilitation = { ...facIn.fields };
  if (facIn.freehand) facilitation.style = facIn.freehand;

  const st = answers.struggles || {};
  const student_struggles = {
    // No per-chapter concept list is wired yet, so concept matches stay
    // unreviewed (handoff W4: mark "reviewed": false until concepts exist).
    concept_specific: (st.topics || []).map((s) => ({
      statement: trimStr(s),
      matched_concept_ids: [],
      confidence: "medium",
      reviewed: false
    })).filter((x) => x.statement),
    subject_general: (st.habits || []).map((s) => ({
      statement: trimStr(s),
      applies_to: `all sessions in ${subject}`
    })).filter((x) => x.statement),
    foundational: (st.basics || []).map((s) => ({
      statement: trimStr(s),
      implication: ""
    })).filter((x) => x.statement)
  };

  const asm = answers.assessment || {};
  const assessment_style = {
    pre_test: trimStr(asm.pre_test),
    post_test: trimStr(asm.post_test),
    revision: trimStr(asm.revision)
  };

  const prefs = answers.prefs || {};
  const plan_preferences = {
    detail_level: prefs.detail_level === "concise" ? "concise" : "detailed",
    tone: prefs.tone === "prescriptive" ? "prescriptive" : "suggestive",
    must_include: (prefs.must_include || []).map(trimStr).filter(Boolean)
  };

  const va = answers.variations || {};
  const variations = {
    grade_variation: trimStr(va.grade_variation),
    avoids: (va.avoids || []).map(trimStr).filter(Boolean)
  };

  const context = {
    class_size: toInt(shared.classSize),
    aids_available: (shared.aids || []).map(trimStr).filter(Boolean),
    medium: trimStr(shared.medium)
  };

  return { session_shape, facilitation, context, student_struggles, assessment_style, plan_preferences, variations };
}

// ---------------- AI build ----------------

function countStruggles(st) {
  return (st.concept_specific || []).length + (st.subject_general || []).length + (st.foundational || []).length;
}

export function buildProfilePrompt(answers, shared, subject) {
  const sessionIn = activeSessionInput(answers.session);
  const facIn = activeFacilitationInput(answers.facilitation);
  const st = answers.struggles || {};
  const asm = answers.assessment || {};
  const prefs = answers.prefs || {};
  const va = answers.variations || {};

  const lines = [];
  lines.push(`SUBJECT: ${subject}`);
  lines.push(`SESSION (how a typical class flows):`);
  for (const [key, label] of SESSION_FIELDS) {
    if (sessionIn.fields[key]) lines.push(`- ${key} ("${label}"): ${sessionIn.fields[key]}`);
  }
  if (sessionIn.freehand) lines.push(`- described in her own words: ${sessionIn.freehand}`);
  lines.push(`TEACHING STYLE:`);
  for (const [key, label] of FACILITATION_FIELDS) {
    if (facIn.fields[key]) lines.push(`- ${key} ("${label}"): ${facIn.fields[key]}`);
  }
  if (facIn.freehand) lines.push(`- described in her own words: ${facIn.freehand}`);
  lines.push(`CLASSROOM: class_size=${toInt(shared.classSize) ?? "?"}; aids=${(shared.aids || []).join(", ") || "?"}; medium=${trimStr(shared.medium) || "?"}`);
  lines.push(`STRUGGLES — the teacher entered these under three headings:`);
  (st.topics || []).filter(trimStr).forEach((s) => lines.push(`- [specific topics that trip students] ${trimStr(s)}`));
  (st.habits || []).filter(trimStr).forEach((s) => lines.push(`- [habits/gaps across the whole subject] ${trimStr(s)}`));
  (st.basics || []).filter(trimStr).forEach((s) => lines.push(`- [missing basics from earlier years] ${trimStr(s)}`));
  lines.push(`ASSESSMENT: pre_test=${trimStr(asm.pre_test) || "?"}; post_test=${trimStr(asm.post_test) || "?"}; revision=${trimStr(asm.revision) || "?"}`);
  lines.push(`PLAN PREFERENCES: detail_level=${prefs.detail_level || "detailed"}; tone=${prefs.tone || "suggestive"}; must_include=${(prefs.must_include || []).join(" | ") || "(none)"}`);
  lines.push(`VARIATIONS: grade_variation=${trimStr(va.grade_variation) || "?"}; avoids=${(va.avoids || []).join(" | ") || "(none)"}`);

  return (
    `You turn a teacher's onboarding answers into the segments of a Teacher Profile JSON that a lesson-plan generator will read.\n` +
    `Return ONLY valid JSON — no markdown, no commentary — with exactly these top-level keys:\n` +
    `{\n` +
    `  "session_shape": { "opener": "", "delivery": "", "aids": "", "checkpoint": "", "practice_release": "", "closer": "", "homework": "", "homework_review": "" },\n` +
    `  "facilitation": { "style": "", "engagement": "", "consolidation": "" },\n` +
    `  "context": { "class_size": 0, "aids_available": [""], "medium": "" },\n` +
    `  "student_struggles": {\n` +
    `    "concept_specific": [ { "statement": "", "matched_concept_ids": [], "confidence": "high|medium|low", "reviewed": false } ],\n` +
    `    "subject_general": [ { "statement": "", "applies_to": "" } ],\n` +
    `    "foundational": [ { "statement": "", "implication": "" } ]\n` +
    `  },\n` +
    `  "assessment_style": { "pre_test": "", "post_test": "", "revision": "" },\n` +
    `  "plan_preferences": { "detail_level": "", "tone": "", "must_include": [""] },\n` +
    `  "variations": { "grade_variation": "", "avoids": [""] }\n` +
    `}\n\n` +
    `Rules:\n` +
    `- Preserve the teacher's meaning and voice. Lightly clean grammar and phrasing into short, clear directive strings. NEVER invent practices, aids, numbers or struggles she did not state.\n` +
    `- Anything she "described in her own words" must be split into the right fields of that segment.\n` +
    `- Leave a field as "" (or omit it) when she said nothing about it. Do not fill gaps with generic teaching advice.\n` +
    `- STRUGGLES: include every entered struggle exactly once. Keep it under the tier of its heading unless it clearly belongs elsewhere: "concept_specific" = tied to particular topics/concepts; "subject_general" = a habit or skill gap across the whole subject; "foundational" = missing earlier-year/prerequisite skills. For concept_specific always use "matched_concept_ids": [] and "reviewed": false (no concept list is available yet); set "confidence" by how clearly a specific topic is named. For subject_general set "applies_to" like "all sessions in ${subject}". For foundational write a one-line "implication": how plan LANGUAGE and scaffolding should adjust — never reducing academic content.\n` +
    `- "plan_preferences.detail_level" and "tone" must echo the given values verbatim; tidy "must_include" items into short phrases.\n` +
    `- "context.class_size" must be the given number (or omit it); echo aids and medium.\n\n` +
    `TEACHER'S ANSWERS:\n${lines.join("\n")}`
  );
}

function stripFences(s) {
  return (s || "").replace(/```json|```/g, "").trim();
}

// Bounded so a hung upstream call can never strand the teacher on the
// "putting your profile together" spinner — on timeout the deterministic
// fallback takes over.
const AI_TIMEOUT_MS = 45000;

async function callChatProxy(prompt, maxTokens) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS) : null;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, maxTokens }),
      signal: ctrl ? ctrl.signal : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `AI request failed (${res.status})`);
    return data.text || "";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- validation of the AI's JSON, segment by segment ----

function vStr(v) { return typeof v === "string" ? v.trim() : undefined; }

function vStrObj(obj, keys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out = {};
  let any = false;
  for (const k of keys) {
    const s = vStr(obj[k]);
    out[k] = s || "";
    if (s) any = true;
  }
  return any ? out : null;
}

function vStrArray(v) {
  return Array.isArray(v) ? v.map(vStr).filter(Boolean) : [];
}

function vStruggles(obj, subject) {
  if (!obj || typeof obj !== "object") return null;
  const cs = Array.isArray(obj.concept_specific) ? obj.concept_specific : [];
  const sg = Array.isArray(obj.subject_general) ? obj.subject_general : [];
  const fo = Array.isArray(obj.foundational) ? obj.foundational : [];
  return {
    concept_specific: cs.map((x) => ({
      statement: vStr(x && x.statement) || "",
      matched_concept_ids: [],
      confidence: ["high", "medium", "low"].includes(x && x.confidence) ? x.confidence : "medium",
      reviewed: false
    })).filter((x) => x.statement),
    subject_general: sg.map((x) => ({
      statement: vStr(x && x.statement) || "",
      applies_to: vStr(x && x.applies_to) || `all sessions in ${subject}`
    })).filter((x) => x.statement),
    foundational: fo.map((x) => ({
      statement: vStr(x && x.statement) || "",
      implication: vStr(x && x.implication) || ""
    })).filter((x) => x.statement)
  };
}

// Build the profile body for one subject. Tries the AI for every segment and
// merges each valid segment over the deterministic base; any segment the AI
// gets wrong falls back to the teacher's verbatim answers.
export async function buildProfileBody(answers, shared, subject) {
  const base = deterministicBuild(answers, shared, subject);
  // When the teacher described a step in her own words, the deterministic base
  // holds the whole description dumped into one field — that dump must never
  // leak back per-field once the AI has split it.
  const sessionFromFreehand = !!activeSessionInput(answers.session).freehand;
  const facFromFreehand = !!activeFacilitationInput(answers.facilitation).freehand;
  let accepted = 0;
  let aiError = null;

  try {
    const raw = await callChatProxy(buildProfilePrompt(answers, shared, subject), 2000);
    const parsed = JSON.parse(stripFences(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Merge field-by-field: an AI value wins, but a field the AI left empty
      // falls back to what the teacher typed in that exact field — the AI can
      // polish, never erase. (Not applicable to freehand: there the AI's split
      // is authoritative, since the base is one big dump.)
      const mergeFields = (aiObj, baseObj) => {
        const merged = {};
        for (const k of Object.keys(baseObj)) merged[k] = (aiObj && aiObj[k]) || baseObj[k];
        return merged;
      };
      const ss = vStrObj(parsed.session_shape, SESSION_FIELDS.map(([k]) => k));
      if (ss) { base.session_shape = sessionFromFreehand ? ss : mergeFields(ss, base.session_shape); accepted++; }
      const fac = vStrObj(parsed.facilitation, ["style", "engagement", "consolidation"]);
      if (fac) { base.facilitation = facFromFreehand ? fac : mergeFields(fac, base.facilitation); accepted++; }
      if (parsed.context && typeof parsed.context === "object" && !Array.isArray(parsed.context)) {
        base.context = {
          class_size: toInt(parsed.context.class_size) ?? base.context.class_size,
          aids_available: vStrArray(parsed.context.aids_available).length
            ? vStrArray(parsed.context.aids_available) : base.context.aids_available,
          medium: vStr(parsed.context.medium) || base.context.medium
        };
        accepted++;
      }
      const st = vStruggles(parsed.student_struggles, subject);
      // Only trust the AI's sorting if it kept every struggle (none dropped, none invented).
      if (st && countStruggles(st) === countStruggles(base.student_struggles)) {
        base.student_struggles = st;
        accepted++;
      }
      const asm = vStrObj(parsed.assessment_style, ["pre_test", "post_test", "revision"]);
      if (asm) { base.assessment_style = mergeFields(asm, base.assessment_style); accepted++; }
      if (parsed.plan_preferences && typeof parsed.plan_preferences === "object" && !Array.isArray(parsed.plan_preferences)) {
        base.plan_preferences = {
          detail_level: ["detailed", "concise"].includes(parsed.plan_preferences.detail_level)
            ? parsed.plan_preferences.detail_level : base.plan_preferences.detail_level,
          tone: ["suggestive", "prescriptive"].includes(parsed.plan_preferences.tone)
            ? parsed.plan_preferences.tone : base.plan_preferences.tone,
          must_include: vStrArray(parsed.plan_preferences.must_include).length
            ? vStrArray(parsed.plan_preferences.must_include) : base.plan_preferences.must_include
        };
        accepted++;
      }
      if (parsed.variations && typeof parsed.variations === "object" && !Array.isArray(parsed.variations)) {
        base.variations = {
          grade_variation: vStr(parsed.variations.grade_variation) || base.variations.grade_variation,
          avoids: vStrArray(parsed.variations.avoids).length
            ? vStrArray(parsed.variations.avoids) : base.variations.avoids
        };
        accepted++;
      }
    }
    if (!accepted) aiError = "The AI response couldn't be used.";
  } catch (err) {
    aiError = err && err.message ? err.message : "AI unavailable";
  }

  return { body: base, aiUsed: accepted > 0, aiError };
}

// ---------------- export assembly ----------------

// One export object per teacher + subject (handoff §8.2). Login details are
// included so the file carries everything collected; pedagogy, uploaded plans
// and change-log data are deliberately never part of the export (handoff §9).
export function buildExportObject(account, subject, body) {
  const full = {
    version: 1,
    teacher_id: String(account.email || "").trim().toLowerCase(),
    teacher_name: trimStr(account.name),
    email: String(account.email || "").trim().toLowerCase(),
    school: trimStr(account.school),
    subject,
    grades: (account.grades || []).slice().sort((a, b) => a - b),
    experience_years: toInt(account.experienceYears),
    session_shape: body.session_shape,
    facilitation: body.facilitation,
    context: body.context,
    student_struggles: body.student_struggles,
    assessment_style: body.assessment_style,
    plan_preferences: body.plan_preferences,
    variations: body.variations
  };
  const stripped = stripEmpty(full) || {};
  // Required identity keys survive even if empty-ish (spec: version/teacher_id/subject required).
  stripped.version = 1;
  stripped.teacher_id = full.teacher_id;
  stripped.subject = subject;
  return stripped;
}

// Also persist into the studio's profile store (profile:{teacherId}:{subjectSlug})
// so coordinators can open onboarded teachers in the existing Teacher Profiles
// view. An existing profile is updated in place — its change log grows, it is
// never wiped (handoff W7: every change is versioned).
export async function saveToStudioStore(account, subject, body) {
  try {
    const { emptyProfile, profileKey } = await import("../profile.js");
    const teacherId = String(account.email || "").trim().toLowerCase();
    const key = profileKey(teacherId, slug(subject));
    let prof = null;
    try {
      const existing = await window.storage.get(key);
      prof = JSON.parse(existing.value);
    } catch { /* no profile yet */ }
    const isNew = !prof || typeof prof !== "object";
    if (isNew) prof = emptyProfile(teacherId, trimStr(account.name), subject);
    // Only non-empty new values overwrite; a skipped optional step must not
    // blank out data a coordinator already has.
    const nonEmpty = (seg) => stripEmpty(seg) || {};
    // The teacher's latest list of struggles wins, but curation a coordinator
    // added to a kept statement (matched concepts, reviewed flags) survives.
    const mergeStruggles = (existing, incoming) =>
      (incoming || []).map((item) => {
        const prev = (existing || []).find((x) => x && x.statement === item.statement);
        if (!prev) return item;
        const kept = { ...item, ...(stripEmpty(prev) || {}) };
        if (typeof prev.reviewed === "boolean") kept.reviewed = prev.reviewed;
        return kept;
      });
    prof.teacher_name = trimStr(account.name) || prof.teacher_name;
    if ((account.grades || []).length) prof.grades = account.grades.slice().sort((a, b) => a - b);
    prof.experience_years = toInt(account.experienceYears) ?? prof.experience_years;
    prof.session_shape = { ...prof.session_shape, ...nonEmpty(body.session_shape) };
    prof.facilitation = { ...prof.facilitation, ...nonEmpty(body.facilitation) };
    prof.context = { ...prof.context, ...nonEmpty(body.context) };
    prof.student_struggles = {
      concept_specific: mergeStruggles(prof.student_struggles?.concept_specific, body.student_struggles.concept_specific),
      subject_general: mergeStruggles(prof.student_struggles?.subject_general, body.student_struggles.subject_general),
      foundational: mergeStruggles(prof.student_struggles?.foundational, body.student_struggles.foundational)
    };
    prof.assessment_style = { ...prof.assessment_style, ...nonEmpty(body.assessment_style) };
    prof.plan_preferences = {
      ...prof.plan_preferences,
      ...nonEmpty(body.plan_preferences),
      // The studio editor's options are "detailed"/"lean"; the export keeps
      // the spec's "concise" wording, only the mirror translates.
      detail_level: body.plan_preferences.detail_level === "concise" ? "lean" : "detailed"
    };
    prof.variations = { ...prof.variations, ...nonEmpty(body.variations) };
    prof.change_log = [
      {
        date: new Date().toISOString(),
        action: isNew ? "onboarded" : "onboarding_update",
        note: `${isNew ? "Created" : "Updated"} via teacher onboarding (${trimStr(account.school)})`
      },
      ...(Array.isArray(prof.change_log) ? prof.change_log : [])
    ];
    prof.updated_at = new Date().toISOString();
    await window.storage.set(key, JSON.stringify(prof));
  } catch {
    // Studio store is a convenience mirror; onboarding still succeeds without it.
  }
}
