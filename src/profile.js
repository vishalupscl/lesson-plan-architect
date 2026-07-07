// Teacher Profile module — the layer that makes the app a personalisation tool.
// Self-contained: schema factory, storage keys, extraction prompts, and the
// four-layer prompt assembler + preview. Kept separate from the main component
// so the existing app is untouched.

export const PROFILE_PREFIX = "profile:"; // profile:{teacherId}:{subjectSlug}

export function profileKey(teacherId, subjectSlug) {
  return `${PROFILE_PREFIX}${teacherId}:${subjectSlug}`;
}

// ---- Empty profile factory (schema v1) ----
export function emptyProfile(teacherId, teacherName, subject) {
  return {
    version: 1,
    teacher_id: teacherId,
    teacher_name: teacherName,
    subject,
    grades: [],
    experience_years: null,
    session_shape: {
      opener: "", delivery: "", aids: "", checkpoint: "",
      practice_release: "", closer: "", homework: "", homework_review: ""
    },
    facilitation: { style: "", engagement: "", consolidation: "" },
    pedagogy: {
      session_flow_id: null,          // matched standard macro id
      teaching_move_ids: [],          // matched standard meso ids
      own_moves: [],                  // [{ name, description, verbatim:true }]
      overlays: [],                   // [{ base_id, adaptation }]
      candidate_session_flow: null    // { candidate_id, name, description, status, source }
    },
    context: { class_size: null, aids_available: [], medium: "" },
    student_struggles: {
      concept_specific: [],  // [{ statement, matched_concept_ids:[], confidence, reviewed }]
      subject_general: [],   // [{ statement, applies_to }]
      foundational: []       // [{ statement, implication }]
    },
    assessment_style: { pre_test: "", post_test: "", revision: "" },
    plan_preferences: { detail_level: "detailed", tone: "suggestive", must_include: [] },
    variations: { grade_variation: "", avoids: [] },
    uploaded_plans: [],      // [{ plan_id, chapter_name, usage_intent, extracted_text, style_summary, mapping_status }]
    change_log: [],          // [{ date, action, base_id, trigger, note }]
    updated_at: new Date().toISOString()
  };
}

export function logChange(profile, action, note, extra = {}) {
  profile.change_log = profile.change_log || [];
  profile.change_log.unshift({
    date: new Date().toISOString(), action, note, ...extra
  });
  profile.updated_at = new Date().toISOString();
  return profile;
}

// ---- Extraction prompt: freehand text for one section -> JSON fields ----
export function buildExtractPrompt(section, freehandText) {
  const shapes = {
    session_shape:
      `Fields: opener, delivery, aids, checkpoint, practice_release, closer, homework, homework_review. ` +
      `Each a short directive string describing what the teacher actually does; omit any field not mentioned.`,
    facilitation:
      `Fields: style, engagement, consolidation. Short strings; omit if not mentioned.`,
    assessment_style:
      `Fields: pre_test, post_test, revision. Short strings describing how she builds each in Clarius; omit if not mentioned.`,
    plan_preferences:
      `Fields: detail_level ("detailed" | "lean"), tone ("suggestive" | "prescriptive"), must_include (array of short strings). Omit if not mentioned.`
  };
  return (
    `You extract structured data from a teacher's freehand description of how she teaches.\n` +
    `Return ONLY valid JSON, no markdown, no commentary.\n` +
    `Extract into these fields only: ${shapes[section] || "the relevant fields"}\n` +
    `Never invent content not present in the text. Unknowns are simply omitted.\n\n` +
    `TEACHER TEXT:\n"""${freehandText}"""`
  );
}

// ---- Struggle categorisation prompt ----
export function buildStrugglePrompt(statement, subject, conceptList) {
  return (
    `You categorise a teacher's stated student struggle for the subject "${subject}".\n` +
    `Return ONLY valid JSON, no markdown.\n\n` +
    `Decide "kind":\n` +
    `- "concept_specific": tied to one/few specific topics or concepts.\n` +
    `- "subject_general": a skill gap across the whole subject, not one topic.\n` +
    `- "foundational": not about the subject at all (language, reading fluency, attention).\n\n` +
    `If concept_specific, also return matched_concept_ids (array, from the list below) and ` +
    `confidence ("high"|"medium"|"low").\n` +
    `If subject_general, return applies_to: "all sessions in ${subject}".\n` +
    `If foundational, return implication: a short note on how it changes the LANGUAGE of plans ` +
    `(simpler sentences, defined terms, visual/oral cues) — never reducing content.\n\n` +
    `CONCEPT LIST (id: name):\n${(conceptList || []).map(c => `${c.id}: ${c.name}`).join("\n") || "(none provided)"}\n\n` +
    `STATEMENT: "${statement}"\n\n` +
    `Return shape: { "kind": "...", "matched_concept_ids": [...], "confidence": "...", "applies_to": "...", "implication": "..." } ` +
    `— include only the keys relevant to the chosen kind.`
  );
}

// ---- Render the profile JSON into the compact directive block the AI reads ----
export function renderProfileBlock(profile, tax) {
  if (!profile) return "";
  const L = [];
  L.push("<teacher_profile>");
  L.push(`teacher: ${profile.teacher_name || "?"} | subject: ${profile.subject} | grades: ${(profile.grades || []).join(", ") || "?"} | experience_years: ${profile.experience_years ?? "?"}`);

  const ss = profile.session_shape || {};
  const ssLines = Object.entries(ss).filter(([, v]) => v);
  if (ssLines.length) {
    L.push("[SESSION SHAPE]");
    ssLines.forEach(([k, v]) => L.push(`${k}: ${v}`));
  }

  const fac = profile.facilitation || {};
  const facLines = Object.entries(fac).filter(([, v]) => v);
  if (facLines.length) {
    L.push("[FACILITATION]");
    facLines.forEach(([k, v]) => L.push(`${k}: ${v}`));
  }

  const ped = profile.pedagogy || {};
  L.push("[PEDAGOGY]");
  if (ped.session_flow_id) {
    const m = macroById(tax, profile.subject, ped.session_flow_id);
    L.push(`session_flow: ${m ? m.name : ped.session_flow_id}${m ? ` — ${m.description}` : ""}`);
  }
  if (ped.candidate_session_flow) {
    const c = ped.candidate_session_flow;
    L.push(`session_flow (candidate, ${c.status}): ${c.name} — ${c.description}`);
  }
  (ped.teaching_move_ids || []).forEach(id => {
    const m = mesoById(tax, profile.subject, id);
    if (m) L.push(`teaching_move: ${m.name} — ${m.description}`);
  });
  (ped.overlays || []).forEach(o => {
    const base = macroById(tax, profile.subject, o.base_id) || mesoById(tax, profile.subject, o.base_id);
    L.push(`personal adaptation of ${base ? base.name : o.base_id}: ${o.adaptation}`);
  });
  (ped.own_moves || []).forEach(o => L.push(`own move — ${o.name}: ${o.description}`));

  const ctx = profile.context || {};
  const ctxLines = [];
  if (ctx.class_size) ctxLines.push(`class_size: ${ctx.class_size}`);
  if ((ctx.aids_available || []).length) ctxLines.push(`aids_available: ${ctx.aids_available.join(", ")}`);
  if (ctx.medium) ctxLines.push(`medium: ${ctx.medium}`);
  if (ctxLines.length) { L.push("[CONTEXT]"); ctxLines.forEach(l => L.push(l)); }

  const st = profile.student_struggles || {};
  if ((st.concept_specific || []).length || (st.subject_general || []).length || (st.foundational || []).length) {
    L.push("[STUDENT STRUGGLES]");
    (st.concept_specific || []).forEach(s =>
      L.push(`concept-specific (${(s.matched_concept_ids || []).join(", ") || "unmatched"}): ${s.statement}`));
    (st.subject_general || []).forEach(s => L.push(`subject-general: ${s.statement}`));
    (st.foundational || []).forEach(s => L.push(`foundational: ${s.statement} [${s.implication || "simplify language"}]`));
  }

  const asm = profile.assessment_style || {};
  const asmLines = Object.entries(asm).filter(([, v]) => v);
  if (asmLines.length) { L.push("[ASSESSMENT STYLE — built in Clarius]"); asmLines.forEach(([k, v]) => L.push(`${k}: ${v}`)); }

  const pp = profile.plan_preferences || {};
  L.push("[PLAN PREFERENCES]");
  L.push(`detail_level: ${pp.detail_level || "detailed"} | tone: ${pp.tone || "suggestive"}`);
  if ((pp.must_include || []).length) L.push(`must_include: ${pp.must_include.join("; ")}`);

  const va = profile.variations || {};
  if (va.grade_variation || (va.avoids || []).length) {
    L.push("[VARIATIONS]");
    if (va.grade_variation) L.push(`grade_variation: ${va.grade_variation}`);
    if ((va.avoids || []).length) L.push(`avoids: ${va.avoids.join("; ")}`);
  }

  L.push("</teacher_profile>");
  return L.join("\n");
}

function macroById(tax, subject, id) {
  const t = tax && tax[subject];
  return t ? (t.macros || []).find(m => m.id === id) : null;
}
function mesoById(tax, subject, id) {
  const t = tax && tax[subject];
  return t ? (t.mesos || []).find(m => m.id === id) : null;
}

// ---- The rules delta appended to the master prompt when a profile is present ----
export const PROFILE_RULES = `
PROFILE ENACTMENT RULES (apply only when a <teacher_profile> block is present; if absent, ignore and use standard rules):
- SESSION SHAPE governs the period skeleton; reference her actual habits by name (her opener, her checkpoint) so the plan reads as an extension of how she teaches, not a foreign template.
- PLAN PREFERENCES govern detail level and tone of every field.
- TONE RULE: default is directional-suggestive — concrete, ordered guidance phrased as adaptable recommendation ("you could open with...", "a good next step is..."). If tone is "prescriptive", use firmer direct instructions ("open with...", "have students...") with the same level of detail.
- CONCEPT-SPECIFIC STRUGGLE: reference a struggle only in sessions whose concept_id is in its matched list.
- SUBJECT-GENERAL STRUGGLE: apply as a standing lens across every session — add scaffolding wherever the relevant skill appears, regardless of concept.
- FOUNDATIONAL STRUGGLE: adjust the LANGUAGE of every field — shorter sentences, simpler vocabulary, defined terms, more visual/oral cues. Never reduce academic content or expectations; change how it is said, not what is taught.
- OVERLAYS: base defines the pedagogy, the adaptation is her personal flavour of it.
- OWN MOVES: may be used as teaching moves wherever they fit the concept.
- OUTPUT VOICE: internal labels (Type NN, Case NN, rule names, ids) never appear in output; describe content in plain teacher language while preserving full structural coverage.
`.trim();

// ---- Four-layer prompt assembler (for preview / demo generation) ----
// masterPrompt (layer 1) + taxonomy block (layer 2, inside masterPrompt already)
// + profile block (layer 3) + curriculum payload (layer 4)
export function assemblePreviewPrompt({ masterPrompt, profileBlock, curriculumPayload }) {
  const parts = [masterPrompt.trim()];
  if (profileBlock) {
    parts.push("\n" + PROFILE_RULES);
    parts.push("\n" + profileBlock);
  }
  parts.push("\nCURRICULUM PAYLOAD:\n" + curriculumPayload.trim());
  return parts.join("\n");
}
