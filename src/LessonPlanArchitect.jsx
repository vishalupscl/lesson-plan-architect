import { useState, useEffect, useCallback } from "react";
import {
  Library, Inbox, ClipboardCheck, History as HistoryIcon, Plus, X, Check,
  Sparkles, Loader2, ChevronDown, ChevronRight, AlertTriangle, FileText,
  Trash2, RefreshCw, Wand2, UserRound
} from "lucide-react";
import ProfileView from "./ProfileView.jsx";

/* ---------------- storage helpers ---------------- */

const SUBJECTS_KEY = "subjects_list";
const TAXONOMY_PREFIX = "taxonomy:";
const SUBMISSION_PREFIX = "submission:";
const DEFAULT_SUBJECTS = ["Mathematics", "Science", "English", "Social Science", "Literacy"];

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function uid(prefix) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}
async function storageGet(key, shared = false) {
  try {
    const res = await window.storage.get(key, shared);
    return res ? res.value : null;
  } catch (e) {
    return null;
  }
}
async function storageSet(key, value, shared = false) {
  try {
    const payload = typeof value === "string" ? value : JSON.stringify(value);
    await window.storage.set(key, payload, shared);
    return true;
  } catch (e) {
    return false;
  }
}
async function storageListKeys(prefix, shared = false) {
  try {
    const res = await window.storage.list(prefix, shared);
    return res ? res.keys : [];
  } catch (e) {
    return [];
  }
}
function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}
function stripFences(s) {
  return (s || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

/* ---------------- LLM API ---------------- */

async function callLlm(prompt, maxTokens = 1000) {
  // Calls the local Express proxy (server/index.js) instead of OpenAI
  // directly, so your API key stays server-side and never reaches the browser.
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request to the proxy failed");
  return data.text;
}

function buildClassifyPrompt(sub, tax) {
  const macroLines = (tax.macros || [])
    .map((m) => `- id:${m.id} | ${m.name} — ${m.description}`)
    .join("\n") || "(none defined yet)";
  const mesoLines = (tax.mesos || [])
    .map((m) => `- id:${m.id} | ${m.name} — ${m.description}`)
    .join("\n") || "(none defined yet)";

  return `You are helping classify a teacher's described teaching approach against an existing pedagogy taxonomy for the subject "${sub.subject}".

The taxonomy has two layers:
- SESSION FLOW (macro level): how the whole class period is structured and run.
- TEACHING MOVE (meso level): how one specific concept is delivered within that structure.

EXISTING SESSION FLOWS:
${macroLines}

EXISTING TEACHING MOVES:
${mesoLines}

TEACHER'S OWN DESCRIPTION OF THEIR APPROACH:
"${sub.freehandText}"

CONCEPT THEY ARE TEACHING (for context only):
"${sub.conceptDescription}"

Decide whether this teacher's approach matches an existing Session Flow and Teaching Move(s), or represents something the current library doesn't capture. A Session Flow can match while a Teaching Move is new, or vice versa.

Respond with ONLY valid JSON and nothing else, in exactly this shape:
{
  "matchType": "existing" or "new",
  "matchedMacroId": "<id or null>",
  "matchedMesoIds": ["<id>", "..."],
  "newMacroSuggestion": {"name": "...", "description": "..."} or null,
  "newMesoSuggestions": [{"name": "...", "description": "..."}],
  "confidence": 0.0,
  "rationale": "one or two sentence explanation, plain language"
}

Rules: set matchType to "new" if either the flow or any move needs a new entry. Leave newMacroSuggestion null if the flow matches an existing one (put its id in matchedMacroId instead). Leave newMesoSuggestions as [] if all moves match existing ones.`;
}

function buildLessonPrompt(sub, tax) {
  const macro = (tax.macros || []).find((m) => m.id === sub.finalMacroId);
  const mesos = (tax.mesos || []).filter((m) => (sub.finalMesoIds || []).includes(m.id));
  const macroBlock = macro
    ? `${macro.name} — ${macro.description}`
    : "(no session flow specified)";
  const mesoBlock = mesos.length
    ? mesos.map((m) => `- ${m.name}: ${m.description}`).join("\n")
    : "(no teaching move specified)";

  return `You are an instructional designer generating a concept-specific lesson plan for a teacher.

SUBJECT: ${sub.subject}
CONCEPT: ${sub.conceptDescription}

SESSION FLOW to follow for the overall class structure (do not invent a different structure):
${macroBlock}

TEACHING MOVE(S) to use specifically at the concept-delivery stage:
${mesoBlock}

Additional context from the teacher (if any): ${sub.freehandText || sub.teacherName ? sub.freehandText : "none provided"}

Generate a concise, classroom-ready lesson plan that:
1. Follows the given Session Flow end-to-end (opening, main stages, closing) — use its own structure, don't substitute a generic one.
2. Embeds the given Teaching Move(s) specifically at the concept-delivery stage.
3. Includes one short in-class checkpoint moment (formal assessment is handled separately in Clarius at pre-test, post-test and block-revision stages, so keep this light — just a quick in-the-moment check).
4. Ends with a short homework or consolidation suggestion.
Use clear headers for each stage. Keep it practical, not generic.`;
}

/* ---------------- master prompt (for profile preview) ---------------- */

const MASTER_PROMPT = `You are an expert curriculum designer generating a detailed, teacher-usable lesson plan for a single concept, in valid JSON only.

Follow the school's selected Session Flow (overall class structure) and Teaching Move(s) (concept-delivery method) exactly. Preserve the fixed output schema; express all richness inside existing fields (description, whyImportant, teacherPreparationNotes, learningObjectives, assessmentSuggestions).

Honour the concept's Type/Case structure where present: a Type is a question family, a Case a sub-question-type reproduced verbatim from source. Enact every Type by name in plain language, use every Case's real content exactly, never invent or merge. Reflect any named Misconception and Achieving Mastery line in notes, objectives and assessment. Weight time by complexity — uniform allocation is a failure state. Assessment stages (pre-test, post-test, revision) are handled in Clarius; keep in-plan checks light.`;

/* ---------------- sample seed data ---------------- */

const SAMPLE_MATH_TAXONOMY = {
  macros: [
    { id: "mac-sample-1", name: "Concept-First Flow (sample)", description: "Open with the abstract idea, formalize with notation, then move to worked examples and guided practice before independent work." },
    { id: "mac-sample-2", name: "Problem-Anchored Flow (sample)", description: "Open with a real or puzzle-like problem, let students struggle briefly, then formalize the concept that solves it, followed by practice." }
  ],
  mesos: [
    { id: "mes-sample-1", name: "Worked Example \u2192 Fade (sample)", description: "Teacher solves a full example, then progressively removes steps for students to fill in, until fully independent.", alignedMacroIds: ["mac-sample-1"] },
    { id: "mes-sample-2", name: "Think-Pair-Share Derivation (sample)", description: "Students attempt to derive or reason toward the rule individually, compare with a partner, then the class converges on the formal version.", alignedMacroIds: ["mac-sample-2"] },
    { id: "mes-sample-3", name: "Visual-to-Symbolic Bridge (sample)", description: "Concept is introduced through a diagram or manipulative, then explicitly translated into symbolic or algebraic form.", alignedMacroIds: ["mac-sample-1", "mac-sample-2"] }
  ]
};

/* ---------------- pipeline stage helper ---------------- */

function getStageInfo(status) {
  const stages = ["Input", "Decode", "Map", "Plan"];
  let completed = 0, activeIdx = -1, errorIdx = -1;
  switch (status) {
    case "new": completed = 1; break;
    case "classifying": completed = 1; activeIdx = 1; break;
    case "classify_error": completed = 1; errorIdx = 1; break;
    case "needs_review": completed = 2; activeIdx = 2; break;
    case "approved": completed = 3; break;
    case "generating": completed = 3; activeIdx = 3; break;
    case "plan_generated": completed = 4; break;
    case "generate_error": completed = 3; errorIdx = 3; break;
    default: completed = 0;
  }
  return stages.map((label, i) => ({
    label,
    state: errorIdx === i ? "error" : activeIdx === i ? "active" : i < completed ? "done" : "pending"
  }));
}

const STATUS_META = {
  new: { text: "New", tone: "muted" },
  classifying: { text: "Decoding\u2026", tone: "amber" },
  classify_error: { text: "Decode failed", tone: "rust" },
  needs_review: { text: "Needs review", tone: "amber" },
  approved: { text: "Mapped \u2014 ready", tone: "sage" },
  generating: { text: "Generating plan\u2026", tone: "amber" },
  plan_generated: { text: "Plan ready", tone: "sage" },
  generate_error: { text: "Generation failed", tone: "rust" }
};

/* ---------------- small shared components ---------------- */

function PipelineTracker({ status }) {
  const stages = getStageInfo(status);
  return (
    <div className="lpa-tracker">
      {stages.map((s, i) => (
        <div key={s.label} className="lpa-tracker-item">
          <div className={`lpa-node lpa-node-${s.state}`}>
            {s.state === "done" ? <Check size={11} /> : s.state === "active" ? <Loader2 size={11} className="lpa-spin" /> : s.state === "error" ? <X size={11} /> : null}
          </div>
          <span className={`lpa-tracker-label lpa-tracker-label-${s.state}`}>{s.label}</span>
          {i < stages.length - 1 && <div className={`lpa-tracker-line ${s.state === "done" ? "lpa-tracker-line-done" : ""}`} />}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { text: status, tone: "muted" };
  return <span className={`lpa-badge lpa-badge-${meta.tone}`}>{meta.text}</span>;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className={`lpa-toast lpa-toast-${toast.tone || "sage"}`}>
      <span>{toast.msg}</span>
      <button className="lpa-toast-close" onClick={onClose}><X size={13} /></button>
    </div>
  );
}

/* ---------------- Taxonomy view ---------------- */

function TaxonomyCard({ item, kind, macros, onDelete }) {
  return (
    <div className="lpa-card lpa-catalog-card">
      <div className="lpa-catalog-tab" />
      <div className="lpa-card-top">
        <span className="lpa-mono lpa-id-badge">{item.id.slice(0, 10)}</span>
        <button className="lpa-icon-btn" onClick={() => onDelete(item.id)} title="Remove"><Trash2 size={13} /></button>
      </div>
      <div className="lpa-display lpa-card-title">{item.name}</div>
      <div className="lpa-card-desc">{item.description}</div>
      {kind === "meso" && item.alignedMacroIds && item.alignedMacroIds.length > 0 && (
        <div className="lpa-chip-row">
          {item.alignedMacroIds.map((mid) => {
            const m = macros.find((x) => x.id === mid);
            return m ? <span key={mid} className="lpa-chip">{m.name}</span> : null;
          })}
        </div>
      )}
    </div>
  );
}

function AddEntryForm({ kind, macros, onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [aligned, setAligned] = useState([]);

  return (
    <div className="lpa-card lpa-add-form">
      <div className="lpa-display lpa-card-title" style={{ marginBottom: 10 }}>
        {kind === "macro" ? "New Session Flow" : "New Teaching Move"}
      </div>
      <label className="lpa-label">Name</label>
      <input className="lpa-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "macro" ? "e.g. Problem-Anchored Flow" : "e.g. Worked Example \u2192 Fade"} />
      <label className="lpa-label">Description</label>
      <textarea className="lpa-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Plain-language description a teacher would recognize" />
      {kind === "meso" && macros.length > 0 && (
        <>
          <label className="lpa-label">Aligned session flow(s)</label>
          <div className="lpa-checkrow">
            {macros.map((m) => (
              <label key={m.id} className="lpa-checkbox-pill">
                <input type="checkbox" checked={aligned.includes(m.id)} onChange={(e) => {
                  setAligned((prev) => e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id));
                }} />
                {m.name}
              </label>
            ))}
          </div>
        </>
      )}
      <div className="lpa-btn-row">
        <button className="lpa-btn lpa-btn-primary" disabled={!name.trim() || !description.trim()} onClick={() => onSubmit({ name: name.trim(), description: description.trim(), alignedMacroIds: aligned })}>
          <Plus size={14} /> Add
        </button>
        <button className="lpa-btn lpa-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function TaxonomyView({ subjects, activeSubject, setActiveSubject, taxonomies, onAddMacro, onAddMeso, onDeleteMacro, onDeleteMeso, onAddSubject }) {
  const [addingMacro, setAddingMacro] = useState(false);
  const [addingMeso, setAddingMeso] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [showAddSubject, setShowAddSubject] = useState(false);
  const tax = taxonomies[activeSubject] || { macros: [], mesos: [] };

  return (
    <div>
      <div className="lpa-subject-tabs">
        {subjects.map((s) => (
          <button key={s} className={`lpa-subject-tab ${s === activeSubject ? "lpa-subject-tab-active" : ""}`} onClick={() => setActiveSubject(s)}>
            {s}
          </button>
        ))}
        {showAddSubject ? (
          <div className="lpa-inline-add">
            <input className="lpa-input lpa-input-sm" autoFocus value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Subject name" />
            <button className="lpa-icon-btn" onClick={() => { if (newSubject.trim()) { onAddSubject(newSubject.trim()); setNewSubject(""); setShowAddSubject(false); } }}><Check size={14} /></button>
            <button className="lpa-icon-btn" onClick={() => setShowAddSubject(false)}><X size={14} /></button>
          </div>
        ) : (
          <button className="lpa-subject-tab lpa-subject-tab-add" onClick={() => setShowAddSubject(true)}><Plus size={13} /> Subject</button>
        )}
      </div>

      <div className="lpa-hint" style={{ marginBottom: 18 }}>
        This is the frozen library teachers select from directly, and what freehand descriptions get decoded against. Entries marked (sample) are placeholders \u2014 replace them with your Pedagogy Engine library.
      </div>

      <div className="lpa-two-col">
        <div>
          <div className="lpa-col-header">
            <span className="lpa-display">Session Flows <span className="lpa-muted-sm">(macro)</span></span>
            {!addingMacro && <button className="lpa-btn lpa-btn-sm" onClick={() => setAddingMacro(true)}><Plus size={13} /> Add</button>}
          </div>
          <div className="lpa-card-list">
            {addingMacro && <AddEntryForm kind="macro" macros={tax.macros} onCancel={() => setAddingMacro(false)} onSubmit={(v) => { onAddMacro(activeSubject, v.name, v.description); setAddingMacro(false); }} />}
            {tax.macros.length === 0 && !addingMacro && <div className="lpa-empty">No session flows yet for {activeSubject}.</div>}
            {tax.macros.map((m) => <TaxonomyCard key={m.id} item={m} kind="macro" macros={tax.macros} onDelete={(id) => onDeleteMacro(activeSubject, id)} />)}
          </div>
        </div>
        <div>
          <div className="lpa-col-header">
            <span className="lpa-display">Teaching Moves <span className="lpa-muted-sm">(meso)</span></span>
            {!addingMeso && <button className="lpa-btn lpa-btn-sm" onClick={() => setAddingMeso(true)}><Plus size={13} /> Add</button>}
          </div>
          <div className="lpa-card-list">
            {addingMeso && <AddEntryForm kind="meso" macros={tax.macros} onCancel={() => setAddingMeso(false)} onSubmit={(v) => { onAddMeso(activeSubject, v.name, v.description, v.alignedMacroIds); setAddingMeso(false); }} />}
            {tax.mesos.length === 0 && !addingMeso && <div className="lpa-empty">No teaching moves yet for {activeSubject}.</div>}
            {tax.mesos.map((m) => <TaxonomyCard key={m.id} item={m} kind="meso" macros={tax.macros} onDelete={(id) => onDeleteMeso(activeSubject, id)} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- New Response view ---------------- */

function LibrarySelector({ tax, macroId, setMacroId, mesoIds, setMesoIds }) {
  return (
    <div>
      <label className="lpa-label">Session flow</label>
      <div className="lpa-radio-list">
        {tax.macros.length === 0 && <div className="lpa-empty">No session flows defined for this subject yet \u2014 add some in the Taxonomy Library tab, or describe the approach freehand instead.</div>}
        {tax.macros.map((m) => (
          <label key={m.id} className={`lpa-select-row ${macroId === m.id ? "lpa-select-row-active" : ""}`}>
            <input type="radio" name="macro" checked={macroId === m.id} onChange={() => setMacroId(m.id)} />
            <div>
              <div className="lpa-select-row-title">{m.name}</div>
              <div className="lpa-select-row-desc">{m.description}</div>
            </div>
          </label>
        ))}
      </div>
      <label className="lpa-label" style={{ marginTop: 14 }}>Teaching move(s) \u2014 pick 1 to 3</label>
      <div className="lpa-radio-list">
        {tax.mesos.map((m) => {
          const aligned = macroId && m.alignedMacroIds && m.alignedMacroIds.includes(macroId);
          return (
            <label key={m.id} className={`lpa-select-row ${mesoIds.includes(m.id) ? "lpa-select-row-active" : ""}`}>
              <input type="checkbox" checked={mesoIds.includes(m.id)} onChange={(e) => setMesoIds((prev) => e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id))} />
              <div>
                <div className="lpa-select-row-title">{m.name} {aligned && <span className="lpa-chip lpa-chip-sage">aligned</span>}</div>
                <div className="lpa-select-row-desc">{m.description}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function NewResponseView({ subjects, taxonomies, onCreate, lastCreated }) {
  const [subject, setSubject] = useState(subjects[0] || "");
  const [teacherName, setTeacherName] = useState("");
  const [conceptDescription, setConceptDescription] = useState("");
  const [mode, setMode] = useState("direct");
  const [macroId, setMacroId] = useState(null);
  const [mesoIds, setMesoIds] = useState([]);
  const [freehandText, setFreehandText] = useState("");
  const tax = taxonomies[subject] || { macros: [], mesos: [] };

  const canSubmit = subject && conceptDescription.trim() && (
    (mode === "direct" && macroId && mesoIds.length > 0) ||
    (mode === "freehand" && freehandText.trim().length > 10)
  );

  const reset = () => { setTeacherName(""); setConceptDescription(""); setMacroId(null); setMesoIds([]); setFreehandText(""); };

  return (
    <div className="lpa-two-col-40">
      <div>
        <label className="lpa-label">Subject</label>
        <select className="lpa-input" value={subject} onChange={(e) => { setSubject(e.target.value); setMacroId(null); setMesoIds([]); }}>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label className="lpa-label">Teacher name <span className="lpa-muted-sm">(optional)</span></label>
        <input className="lpa-input" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="e.g. Ms. Rao" />

        <label className="lpa-label">Concept / chapter being taught</label>
        <textarea className="lpa-textarea" rows={3} value={conceptDescription} onChange={(e) => setConceptDescription(e.target.value)} placeholder="e.g. Introducing linear equations in one variable" />

        <label className="lpa-label">How was this approach captured?</label>
        <div className="lpa-mode-toggle">
          <button className={`lpa-mode-btn ${mode === "direct" ? "lpa-mode-btn-active" : ""}`} onClick={() => setMode("direct")}>Select from library</button>
          <button className={`lpa-mode-btn ${mode === "freehand" ? "lpa-mode-btn-active" : ""}`} onClick={() => setMode("freehand")}>Describe approach</button>
        </div>

        {mode === "direct" ? (
          <LibrarySelector tax={tax} macroId={macroId} setMacroId={setMacroId} mesoIds={mesoIds} setMesoIds={setMesoIds} />
        ) : (
          <div>
            <label className="lpa-label">Teacher's freehand description</label>
            <textarea className="lpa-textarea" rows={6} value={freehandText} onChange={(e) => setFreehandText(e.target.value)} placeholder="Describe, in the teacher's own words, how they run the class and deliver this kind of concept\u2026" />
            <div className="lpa-hint">This gets decoded against the {subject} library. If nothing matches well, it's flagged so someone can add it as a new Session Flow or Teaching Move.</div>
          </div>
        )}

        <button className="lpa-btn lpa-btn-primary" style={{ marginTop: 16 }} disabled={!canSubmit} onClick={() => { onCreate({ subject, teacherName, conceptDescription, mode, macroId, mesoIds, freehandText }); reset(); }}>
          {mode === "freehand" ? <><Sparkles size={14} /> Submit for decoding</> : <><Check size={14} /> Map directly</>}
        </button>
      </div>

      <div>
        <div className="lpa-display" style={{ marginBottom: 10 }}>Last submitted</div>
        {lastCreated ? (
          <div className="lpa-card">
            <div className="lpa-card-title" style={{ fontSize: 14 }}>{lastCreated.conceptDescription}</div>
            <div className="lpa-hint" style={{ margin: "8px 0" }}>{lastCreated.subject} \u00b7 {lastCreated.mode === "direct" ? "direct selection" : "freehand, decoding"}</div>
            <PipelineTracker status={lastCreated.status} />
            <div style={{ marginTop: 10 }}><StatusBadge status={lastCreated.status} /></div>
          </div>
        ) : (
          <div className="lpa-empty">Nothing submitted yet this session.</div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Review Queue view ---------------- */

function EditableMapping({ tax, initialMacroId, initialMesoIds, onConfirm, onCancel }) {
  const [macroId, setMacroId] = useState(initialMacroId || null);
  const [mesoIds, setMesoIds] = useState(initialMesoIds || []);
  return (
    <div className="lpa-inset">
      <LibrarySelector tax={tax} macroId={macroId} setMacroId={setMacroId} mesoIds={mesoIds} setMesoIds={setMesoIds} />
      <div className="lpa-btn-row" style={{ marginTop: 12 }}>
        <button className="lpa-btn lpa-btn-primary" disabled={!macroId || mesoIds.length === 0} onClick={() => onConfirm(macroId, mesoIds)}><Check size={14} /> Confirm mapping</button>
        <button className="lpa-btn lpa-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ReviewItem({ sub, tax, onApproveExisting, onApproveNew, onManualMap, onRetry }) {
  const [editing, setEditing] = useState(false);
  const [macroName, setMacroName] = useState(sub.classification.newMacroSuggestion?.name || "");
  const [macroDesc, setMacroDesc] = useState(sub.classification.newMacroSuggestion?.description || "");
  const [mesoDrafts, setMesoDrafts] = useState((sub.classification.newMesoSuggestions || []).map((m) => ({ ...m })));

  const c = sub.classification;
  const matchedMacro = tax.macros.find((m) => m.id === c.matchedMacroId);
  const matchedMesos = tax.mesos.filter((m) => (c.matchedMesoIds || []).includes(m.id));
  const confidencePct = Math.round((c.confidence || 0) * 100);

  return (
    <div className="lpa-card lpa-ticket">
      <div className="lpa-ticket-edge" />
      <div className="lpa-card-top">
        <span className="lpa-mono lpa-id-badge">{sub.subject}</span>
        <StatusBadge status={sub.status} />
      </div>
      <div className="lpa-card-desc" style={{ marginBottom: 10 }}><strong>Concept:</strong> {sub.conceptDescription}</div>
      <div className="lpa-quote">\u201c{sub.freehandText}\u201d</div>

      <div className="lpa-suggestion-box">
        <div className="lpa-suggestion-head">
          <Wand2 size={14} />
          <span>{c.matchType === "existing" ? "Suggested match" : "Suggested as a new category"}</span>
          <span className="lpa-confidence">{confidencePct}% confidence</span>
        </div>

        {c.matchType === "existing" ? (
          <div className="lpa-suggestion-body">
            <div><span className="lpa-muted-sm">Session flow:</span> {matchedMacro ? matchedMacro.name : "(not found)"}</div>
            <div><span className="lpa-muted-sm">Teaching move(s):</span> {matchedMesos.length ? matchedMesos.map((m) => m.name).join(", ") : "(not found)"}</div>
          </div>
        ) : (
          <div className="lpa-suggestion-body">
            {c.newMacroSuggestion ? (
              <div>
                <span className="lpa-muted-sm">New session flow:</span>
                <input className="lpa-input lpa-input-sm" value={macroName} onChange={(e) => setMacroName(e.target.value)} />
                <textarea className="lpa-textarea" rows={2} value={macroDesc} onChange={(e) => setMacroDesc(e.target.value)} />
              </div>
            ) : (
              <div><span className="lpa-muted-sm">Session flow:</span> {matchedMacro ? matchedMacro.name : "(unspecified)"}</div>
            )}
            {mesoDrafts.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <span className="lpa-muted-sm">New teaching move(s):</span>
                {mesoDrafts.map((m, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <input className="lpa-input lpa-input-sm" value={m.name} onChange={(e) => setMesoDrafts((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <textarea className="lpa-textarea" rows={2} value={m.description} onChange={(e) => setMesoDrafts((prev) => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="lpa-rationale"><em>{c.rationale}</em></div>
      </div>

      {editing ? (
        <EditableMapping tax={tax} initialMacroId={c.matchedMacroId} initialMesoIds={c.matchedMesoIds} onConfirm={(macroId, mesoIds) => { onManualMap(sub.id, macroId, mesoIds); setEditing(false); }} onCancel={() => setEditing(false)} />
      ) : (
        <div className="lpa-btn-row" style={{ marginTop: 12 }}>
          {c.matchType === "existing" ? (
            <button className="lpa-btn lpa-btn-primary" onClick={() => onApproveExisting(sub.id, c.matchedMacroId, c.matchedMesoIds)}><Check size={14} /> Approve mapping</button>
          ) : (
            <button className="lpa-btn lpa-btn-primary" onClick={() => onApproveNew(sub.id, {
              matchedMacroId: c.matchedMacroId,
              newMacro: c.newMacroSuggestion ? { name: macroName, description: macroDesc } : null,
              newMesos: mesoDrafts
            })}><Plus size={14} /> Add to library & approve</button>
          )}
          <button className="lpa-btn lpa-btn-ghost" onClick={() => setEditing(true)}>Adjust mapping</button>
        </div>
      )}
    </div>
  );
}

function ReviewQueueView({ submissions, taxonomies, onApproveExisting, onApproveNew, onManualMap, onRetry }) {
  const pending = submissions.filter((s) => s.status === "needs_review");
  const errored = submissions.filter((s) => s.status === "classify_error");

  if (pending.length === 0 && errored.length === 0) {
    return <div className="lpa-empty-wide"><ClipboardCheck size={22} /><div>Nothing waiting on review. Freehand submissions that need a human decision will show up here.</div></div>;
  }

  return (
    <div className="lpa-stack">
      {errored.map((s) => (
        <div key={s.id} className="lpa-card lpa-ticket">
          <div className="lpa-ticket-edge lpa-ticket-edge-rust" />
          <div className="lpa-card-top"><span className="lpa-mono lpa-id-badge">{s.subject}</span><StatusBadge status={s.status} /></div>
          <div className="lpa-card-desc">{s.conceptDescription}</div>
          <div className="lpa-quote">\u201c{s.freehandText}\u201d</div>
          <div className="lpa-hint"><AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {s.errorMsg}</div>
          <button className="lpa-btn lpa-btn-sm" style={{ marginTop: 8 }} onClick={() => onRetry(s.id)}><RefreshCw size={13} /> Retry decoding</button>
        </div>
      ))}
      {pending.map((s) => (
        <ReviewItem key={s.id} sub={s} tax={taxonomies[s.subject] || { macros: [], mesos: [] }} onApproveExisting={onApproveExisting} onApproveNew={onApproveNew} onManualMap={onManualMap} onRetry={onRetry} />
      ))}
    </div>
  );
}

/* ---------------- History view ---------------- */

function HistoryRow({ sub, tax, onGenerate, onRetryGenerate }) {
  const [open, setOpen] = useState(false);
  const macro = tax.macros.find((m) => m.id === sub.finalMacroId);
  const mesos = tax.mesos.filter((m) => (sub.finalMesoIds || []).includes(m.id));

  return (
    <div className="lpa-card">
      <div className="lpa-history-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <div className="lpa-history-title">
          <div className="lpa-card-title" style={{ fontSize: 14 }}>{sub.conceptDescription}</div>
          <div className="lpa-hint">{sub.subject}{sub.teacherName ? ` \u00b7 ${sub.teacherName}` : ""} \u00b7 {new Date(sub.createdAt).toLocaleDateString()}</div>
        </div>
        <StatusBadge status={sub.status} />
      </div>
      {open && (
        <div className="lpa-inset">
          <PipelineTracker status={sub.status} />
          <div style={{ marginTop: 12 }}>
            <div><span className="lpa-muted-sm">Session flow:</span> {macro ? macro.name : "\u2014"}</div>
            <div><span className="lpa-muted-sm">Teaching move(s):</span> {mesos.length ? mesos.map((m) => m.name).join(", ") : "\u2014"}</div>
          </div>

          {sub.status === "approved" && (
            <button className="lpa-btn lpa-btn-primary" style={{ marginTop: 12 }} onClick={() => onGenerate(sub.id)}><Sparkles size={14} /> Generate prompt & plan</button>
          )}
          {sub.status === "generating" && <div className="lpa-hint" style={{ marginTop: 12 }}><Loader2 size={13} className="lpa-spin" style={{ verticalAlign: "-2px" }} /> Generating\u2026</div>}
          {sub.status === "generate_error" && (
            <div style={{ marginTop: 12 }}>
              <div className="lpa-hint"><AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {sub.errorMsg}</div>
              <button className="lpa-btn lpa-btn-sm" style={{ marginTop: 8 }} onClick={() => onRetryGenerate(sub.id)}><RefreshCw size={13} /> Retry</button>
            </div>
          )}

          {sub.prompt && (
            <div style={{ marginTop: 14 }}>
              <div className="lpa-muted-sm" style={{ marginBottom: 4 }}>Constructed AI prompt</div>
              <pre className="lpa-pre">{sub.prompt}</pre>
            </div>
          )}
          {sub.plan && (
            <div style={{ marginTop: 14 }}>
              <div className="lpa-muted-sm" style={{ marginBottom: 4 }}>Generated lesson plan</div>
              <div className="lpa-plan-box">{sub.plan}</div>
              <button className="lpa-btn lpa-btn-sm" style={{ marginTop: 8 }} onClick={() => onGenerate(sub.id)}><RefreshCw size={13} /> Regenerate</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryView({ submissions, taxonomies, onGenerate, onRetryGenerate }) {
  if (submissions.length === 0) {
    return <div className="lpa-empty-wide"><HistoryIcon size={22} /><div>No submissions yet. Once teacher responses come in, they'll be logged here.</div></div>;
  }
  return (
    <div className="lpa-stack">
      {submissions.map((s) => (
        <HistoryRow key={s.id} sub={s} tax={taxonomies[s.subject] || { macros: [], mesos: [] }} onGenerate={onGenerate} onRetryGenerate={onRetryGenerate} />
      ))}
    </div>
  );
}

/* ---------------- main app ---------------- */

export default function LessonPlanArchitect() {
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState(DEFAULT_SUBJECTS);
  const [taxonomies, setTaxonomies] = useState({});
  const [submissions, setSubmissions] = useState([]);
  const [activeSubject, setActiveSubject] = useState(DEFAULT_SUBJECTS[0]);
  const [view, setView] = useState("taxonomy");
  const [lastCreated, setLastCreated] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, tone = "sage") => { setToast({ msg, tone }); setTimeout(() => setToast(null), 3200); };

  useEffect(() => {
    (async () => {
      let subs = safeParse(await storageGet(SUBJECTS_KEY), null);
      if (!subs) { subs = DEFAULT_SUBJECTS; await storageSet(SUBJECTS_KEY, subs); }

      const tax = {};
      for (const s of subs) {
        const raw = await storageGet(TAXONOMY_PREFIX + slug(s));
        if (raw) { tax[s] = safeParse(raw, { macros: [], mesos: [] }); }
        else if (s === "Mathematics") { tax[s] = SAMPLE_MATH_TAXONOMY; await storageSet(TAXONOMY_PREFIX + slug(s), SAMPLE_MATH_TAXONOMY); }
        else { tax[s] = { macros: [], mesos: [] }; await storageSet(TAXONOMY_PREFIX + slug(s), tax[s]); }
      }

      const keys = await storageListKeys(SUBMISSION_PREFIX);
      const loaded = [];
      for (const k of keys) {
        const raw = await storageGet(k);
        if (raw) loaded.push(safeParse(raw, null));
      }
      const clean = loaded.filter(Boolean).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

      setSubjects(subs);
      setTaxonomies(tax);
      setSubmissions(clean);
      setActiveSubject(subs[0]);
      setLoading(false);
    })();
  }, []);

  const persistTaxonomy = async (subject, data) => {
    setTaxonomies((prev) => ({ ...prev, [subject]: data }));
    await storageSet(TAXONOMY_PREFIX + slug(subject), data);
  };

  const addSubject = async (name) => {
    if (subjects.includes(name)) { showToast("That subject already exists", "rust"); return; }
    const next = [...subjects, name];
    setSubjects(next);
    await storageSet(SUBJECTS_KEY, next);
    await persistTaxonomy(name, { macros: [], mesos: [] });
    setActiveSubject(name);
  };

  const addMacro = async (subject, name, description) => {
    const id = uid("mac-");
    const tax = taxonomies[subject] || { macros: [], mesos: [] };
    const next = { ...tax, macros: [...tax.macros, { id, name, description }] };
    await persistTaxonomy(subject, next);
    showToast("Session flow added to library");
    return id;
  };
  const addMeso = async (subject, name, description, alignedMacroIds) => {
    const id = uid("mes-");
    const tax = taxonomies[subject] || { macros: [], mesos: [] };
    const next = { ...tax, mesos: [...tax.mesos, { id, name, description, alignedMacroIds: alignedMacroIds || [] }] };
    await persistTaxonomy(subject, next);
    showToast("Teaching move added to library");
    return id;
  };
  const deleteMacro = async (subject, id) => {
    const tax = taxonomies[subject];
    await persistTaxonomy(subject, { ...tax, macros: tax.macros.filter((m) => m.id !== id) });
  };
  const deleteMeso = async (subject, id) => {
    const tax = taxonomies[subject];
    await persistTaxonomy(subject, { ...tax, mesos: tax.mesos.filter((m) => m.id !== id) });
  };

  const updateSubmission = async (sub) => {
    setSubmissions((prev) => {
      const exists = prev.some((s) => s.id === sub.id);
      return exists ? prev.map((s) => (s.id === sub.id ? sub : s)) : [sub, ...prev];
    });
    await storageSet(SUBMISSION_PREFIX + sub.id, sub);
    return sub;
  };

  const classifySubmission = useCallback(async (sub, taxSnapshot) => {
    await updateSubmission({ ...sub, status: "classifying" });
    try {
      const tax = taxSnapshot || taxonomies[sub.subject] || { macros: [], mesos: [] };
      const prompt = buildClassifyPrompt(sub, tax);
      const raw = await callLlm(prompt, 700);
      const parsed = safeParse(stripFences(raw), null);
      if (!parsed) throw new Error("bad json");
      await updateSubmission({ ...sub, status: "needs_review", classification: parsed });
    } catch (e) {
      await updateSubmission({ ...sub, status: "classify_error", errorMsg: "Could not decode this response. Try again." });
    }
  }, [taxonomies]);

  const createSubmission = async (form) => {
    const id = uid("sub-");
    let base = {
      id, createdAt: new Date().toISOString(), subject: form.subject, teacherName: form.teacherName || "",
      conceptDescription: form.conceptDescription, mode: form.mode,
      freehandText: form.mode === "freehand" ? form.freehandText : "",
      classification: null, finalMacroId: null, finalMesoIds: [],
      status: "new", errorMsg: null, prompt: null, plan: null
    };
    if (form.mode === "direct") {
      base.classification = { matchType: "existing", matchedMacroId: form.macroId, matchedMesoIds: form.mesoIds, confidence: 1, rationale: "Direct selection by teacher." };
      base.finalMacroId = form.macroId;
      base.finalMesoIds = form.mesoIds;
      base.status = "approved";
    }
    await updateSubmission(base);
    setLastCreated(base);
    if (form.mode === "freehand") {
      classifySubmission(base);
    } else {
      showToast("Mapped directly \u2014 ready to generate a plan in History");
    }
  };

  const onApproveExisting = async (id, macroId, mesoIds) => {
    const sub = submissions.find((s) => s.id === id);
    await updateSubmission({ ...sub, finalMacroId: macroId, finalMesoIds: mesoIds, status: "approved" });
    showToast("Mapping approved");
  };

  const onManualMap = async (id, macroId, mesoIds) => {
    const sub = submissions.find((s) => s.id === id);
    await updateSubmission({ ...sub, finalMacroId: macroId, finalMesoIds: mesoIds, status: "approved" });
    showToast("Mapping approved");
  };

  const onApproveNew = async (id, decision) => {
    const sub = submissions.find((s) => s.id === id);
    let finalMacroId = decision.matchedMacroId || null;
    let finalMesoIds = [];
    if (decision.newMacro && decision.newMacro.name) {
      finalMacroId = await addMacro(sub.subject, decision.newMacro.name, decision.newMacro.description);
    }
    if (decision.newMesos && decision.newMesos.length) {
      for (const m of decision.newMesos) {
        if (!m.name) continue;
        const mid = await addMeso(sub.subject, m.name, m.description, finalMacroId ? [finalMacroId] : []);
        finalMesoIds.push(mid);
      }
    }
    await updateSubmission({ ...sub, finalMacroId, finalMesoIds, status: "approved" });
    showToast("New category added to library and mapped");
  };

  const onRetryClassify = async (id) => {
    const sub = submissions.find((s) => s.id === id);
    classifySubmission(sub);
  };

  const generatePlan = async (id) => {
    const sub = submissions.find((s) => s.id === id);
    const tax = taxonomies[sub.subject] || { macros: [], mesos: [] };
    const promptText = buildLessonPrompt(sub, tax);
    await updateSubmission({ ...sub, status: "generating", prompt: promptText });
    try {
      const planText = await callLlm(promptText, 1000);
      await updateSubmission({ ...sub, status: "plan_generated", prompt: promptText, plan: planText });
      showToast("Lesson plan generated");
    } catch (e) {
      await updateSubmission({ ...sub, status: "generate_error", prompt: promptText, errorMsg: "Plan generation failed. Try again." });
    }
  };

  const needsReviewCount = submissions.filter((s) => s.status === "needs_review" || s.status === "classify_error").length;

  const NAV = [
    { id: "taxonomy", label: "Taxonomy Library", icon: Library },
    { id: "profiles", label: "Teacher Profiles", icon: UserRound },
    { id: "intake", label: "New Response", icon: Inbox },
    { id: "review", label: "Review Queue", icon: ClipboardCheck, badge: needsReviewCount },
    { id: "history", label: "History", icon: HistoryIcon }
  ];

  return (
    <div className="lpa-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

        .lpa-root {
          --ink: #12172A; --surface: #1B2140; --surface-2: #232B52;
          --paper: #E7E9F2; --muted: #8891B0; --line: rgba(231,233,242,0.12);
          --amber: #E0A845; --sage: #6FBF8B; --rust: #E2694F;
          background: var(--ink); color: var(--paper);
          font-family: 'Inter', sans-serif; border-radius: 18px;
          padding: 22px; max-width: 100%;
        }
        .lpa-display { font-family: 'Space Grotesk', sans-serif; font-weight: 600; }
        .lpa-mono { font-family: 'IBM Plex Mono', monospace; }
        .lpa-spin { animation: lpa-spin 1s linear infinite; }
        @keyframes lpa-spin { to { transform: rotate(360deg); } }

        .lpa-header { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:18px; flex-wrap:wrap; gap:8px; }
        .lpa-title { font-size: 22px; letter-spacing: -0.01em; }
        .lpa-subtitle { color: var(--muted); font-size: 12.5px; font-family:'IBM Plex Mono', monospace; }

        .lpa-nav { display:flex; gap:6px; margin-bottom:20px; flex-wrap:wrap; border-bottom:1px solid var(--line); padding-bottom:12px; }
        .lpa-nav-btn { display:flex; align-items:center; gap:6px; background:transparent; border:1px solid transparent; color: var(--muted); padding:7px 12px; border-radius:8px; font-size:13px; cursor:pointer; font-family:'Inter',sans-serif; }
        .lpa-nav-btn:hover { color: var(--paper); background: var(--surface); }
        .lpa-nav-btn-active { color: var(--paper); background: var(--surface-2); border-color: var(--line); }
        .lpa-nav-badge { background: var(--amber); color:#1b1305; border-radius:99px; font-size:10.5px; padding:1px 6px; font-family:'IBM Plex Mono',monospace; }

        .lpa-subject-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
        .lpa-subject-tab { background: var(--surface); border:1px solid var(--line); color: var(--muted); padding:6px 12px; border-radius:99px; font-size:12.5px; cursor:pointer; font-family:'Inter',sans-serif; }
        .lpa-subject-tab-active { color: var(--ink); background: var(--paper); border-color: var(--paper); }
        .lpa-subject-tab-add { display:flex; align-items:center; gap:4px; }
        .lpa-inline-add { display:flex; align-items:center; gap:4px; }

        .lpa-two-col { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
        .lpa-two-col-40 { display:grid; grid-template-columns: 1.4fr 1fr; gap:24px; }
        @media (max-width: 720px) { .lpa-two-col, .lpa-two-col-40 { grid-template-columns: 1fr; } }

        .lpa-col-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; font-size:14px; }
        .lpa-muted-sm { color: var(--muted); font-size:11.5px; font-weight:400; }
        .lpa-card-list { display:flex; flex-direction:column; gap:10px; }

        .lpa-card { background: var(--surface); border:1px solid var(--line); border-radius:10px; padding:14px; position:relative; }
        .lpa-catalog-card { padding-top:18px; }
        .lpa-catalog-tab { position:absolute; top:-1px; left:16px; width:30px; height:8px; background:var(--ink); border-left:1px solid var(--line); border-right:1px solid var(--line); border-bottom:1px solid var(--line); border-radius:0 0 5px 5px; }
        .lpa-card-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
        .lpa-id-badge { font-size:10.5px; color: var(--muted); }
        .lpa-card-title { font-size:14.5px; margin-bottom:4px; }
        .lpa-card-desc { font-size:12.5px; color:#C7CBE0; line-height:1.5; }
        .lpa-chip-row { display:flex; gap:5px; flex-wrap:wrap; margin-top:8px; }
        .lpa-chip { font-size:10.5px; background: var(--surface-2); border:1px solid var(--line); padding:2px 7px; border-radius:99px; color: var(--muted); }
        .lpa-chip-sage { color: var(--sage); border-color: rgba(111,191,139,0.4); }

        .lpa-icon-btn { background:transparent; border:none; color: var(--muted); cursor:pointer; padding:3px; border-radius:5px; display:flex; }
        .lpa-icon-btn:hover { color: var(--rust); background: var(--surface-2); }

        .lpa-label { display:block; font-size:11.5px; text-transform:uppercase; letter-spacing:0.04em; color: var(--muted); margin: 12px 0 5px; }
        .lpa-input, .lpa-textarea, select.lpa-input { width:100%; background: var(--ink); border:1px solid var(--line); color: var(--paper); border-radius:7px; padding:9px 10px; font-size:13px; font-family:'Inter',sans-serif; box-sizing:border-box; }
        .lpa-input-sm { padding:6px 8px; font-size:12.5px; margin-bottom:6px; }
        .lpa-textarea { resize:vertical; }
        .lpa-input:focus, .lpa-textarea:focus { outline:2px solid var(--amber); outline-offset:1px; }

        .lpa-checkrow { display:flex; flex-wrap:wrap; gap:6px; }
        .lpa-checkbox-pill { display:flex; align-items:center; gap:5px; background: var(--ink); border:1px solid var(--line); padding:5px 9px; border-radius:99px; font-size:12px; cursor:pointer; }

        .lpa-btn { display:inline-flex; align-items:center; gap:6px; border-radius:7px; padding:9px 14px; font-size:13px; cursor:pointer; border:1px solid var(--line); background: var(--surface-2); color: var(--paper); font-family:'Inter',sans-serif; }
        .lpa-btn:disabled { opacity:0.4; cursor:not-allowed; }
        .lpa-btn-primary { background: var(--amber); color:#1b1305; border-color:var(--amber); font-weight:600; }
        .lpa-btn-ghost { background:transparent; }
        .lpa-btn-sm { padding:6px 10px; font-size:12px; }
        .lpa-btn-row { display:flex; gap:8px; flex-wrap:wrap; }

        .lpa-add-form { border-style:dashed; border-color: var(--muted); }

        .lpa-mode-toggle { display:flex; gap:6px; margin-bottom:4px; }
        .lpa-mode-btn { flex:1; background: var(--ink); border:1px solid var(--line); color: var(--muted); padding:8px; border-radius:7px; font-size:12.5px; cursor:pointer; }
        .lpa-mode-btn-active { background: var(--surface-2); color: var(--paper); border-color: var(--amber); }

        .lpa-radio-list { display:flex; flex-direction:column; gap:6px; }
        .lpa-select-row { display:flex; gap:9px; background: var(--ink); border:1px solid var(--line); padding:9px 10px; border-radius:8px; cursor:pointer; align-items:flex-start; }
        .lpa-select-row-active { border-color: var(--amber); background: var(--surface-2); }
        .lpa-select-row-title { font-size:13px; }
        .lpa-select-row-desc { font-size:11.5px; color: var(--muted); margin-top:2px; }

        .lpa-hint { font-size:12px; color: var(--muted); line-height:1.5; }

        .lpa-empty, .lpa-empty-wide { color: var(--muted); font-size:12.5px; padding:14px; border:1px dashed var(--line); border-radius:8px; text-align:center; }
        .lpa-empty-wide { display:flex; flex-direction:column; align-items:center; gap:8px; padding:36px 20px; }

        .lpa-tracker { display:flex; align-items:center; }
        .lpa-tracker-item { display:flex; align-items:center; }
        .lpa-node { width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:1.5px solid var(--line); font-size:10px; }
        .lpa-node-done { background: var(--sage); border-color: var(--sage); color:#0d1f14; }
        .lpa-node-active { background: var(--amber); border-color: var(--amber); color:#1b1305; }
        .lpa-node-error { background: var(--rust); border-color: var(--rust); color:#2a0d06; }
        .lpa-node-pending { background: transparent; color: var(--muted); }
        .lpa-tracker-label { font-size:10.5px; color: var(--muted); margin: 0 6px 0 4px; font-family:'IBM Plex Mono',monospace; }
        .lpa-tracker-label-done, .lpa-tracker-label-active { color: var(--paper); }
        .lpa-tracker-line { width:18px; height:1px; background: var(--line); margin-right:2px; }
        .lpa-tracker-line-done { background: var(--sage); }

        .lpa-badge { font-size:10.5px; padding:3px 8px; border-radius:99px; font-family:'IBM Plex Mono',monospace; white-space:nowrap; }
        .lpa-badge-muted { background: var(--surface-2); color: var(--muted); }
        .lpa-badge-amber { background: rgba(224,168,69,0.18); color: var(--amber); }
        .lpa-badge-sage { background: rgba(111,191,139,0.18); color: var(--sage); }
        .lpa-badge-rust { background: rgba(226,105,79,0.18); color: var(--rust); }

        .lpa-stack { display:flex; flex-direction:column; gap:12px; }
        .lpa-ticket { padding-left:18px; }
        .lpa-ticket-edge { position:absolute; left:0; top:10px; bottom:10px; width:4px; border-radius:3px; background: var(--amber); }
        .lpa-ticket-edge-rust { background: var(--rust); }
        .lpa-quote { font-size:12.5px; font-style:italic; color:#C7CBE0; border-left:2px solid var(--line); padding-left:10px; margin:8px 0; }

        .lpa-suggestion-box { background: var(--ink); border:1px solid var(--line); border-radius:8px; padding:12px; margin-top:8px; }
        .lpa-suggestion-head { display:flex; align-items:center; gap:7px; font-size:12.5px; color: var(--paper); margin-bottom:8px; }
        .lpa-confidence { margin-left:auto; font-family:'IBM Plex Mono',monospace; color: var(--muted); font-size:11px; }
        .lpa-suggestion-body { font-size:12.5px; line-height:1.6; display:flex; flex-direction:column; gap:4px; }
        .lpa-rationale { font-size:11.5px; color: var(--muted); margin-top:8px; }
        .lpa-inset { background: rgba(0,0,0,0.15); border-radius:8px; padding:12px; margin-top:10px; }

        .lpa-history-head { display:flex; align-items:center; gap:10px; cursor:pointer; }
        .lpa-history-title { flex:1; }
        .lpa-pre { white-space:pre-wrap; font-family:'IBM Plex Mono',monospace; font-size:11px; background: var(--ink); border:1px solid var(--line); border-radius:8px; padding:12px; color:#C7CBE0; max-height:220px; overflow:auto; }
        .lpa-plan-box { white-space:pre-wrap; font-size:13px; line-height:1.65; background: var(--ink); border:1px solid var(--line); border-radius:8px; padding:14px; }

        .lpa-toast { position:sticky; bottom:0; margin-top:16px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 14px; border-radius:8px; font-size:12.5px; }
        .lpa-toast-sage { background: rgba(111,191,139,0.18); color: var(--sage); border:1px solid rgba(111,191,139,0.4); }
        .lpa-toast-rust { background: rgba(226,105,79,0.18); color: var(--rust); border:1px solid rgba(226,105,79,0.4); }
        .lpa-toast-close { background:transparent; border:none; color:inherit; cursor:pointer; display:flex; }
      `}</style>

      <div className="lpa-header">
        <div>
          <div className="lpa-display lpa-title">Lesson Plan Architect</div>
          <div className="lpa-subtitle">decode \u2192 map \u2192 prompt \u2192 plan</div>
        </div>
      </div>

      <div className="lpa-nav">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <button key={n.id} className={`lpa-nav-btn ${view === n.id ? "lpa-nav-btn-active" : ""}`} onClick={() => setView(n.id)}>
              <Icon size={14} /> {n.label} {n.badge > 0 && <span className="lpa-nav-badge">{n.badge}</span>}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="lpa-empty-wide"><Loader2 size={20} className="lpa-spin" /><div>Loading\u2026</div></div>
      ) : (
        <>
          {view === "taxonomy" && (
            <TaxonomyView subjects={subjects} activeSubject={activeSubject} setActiveSubject={setActiveSubject} taxonomies={taxonomies}
              onAddMacro={addMacro} onAddMeso={addMeso} onDeleteMacro={deleteMacro} onDeleteMeso={deleteMeso} onAddSubject={addSubject} />
          )}
          {view === "profiles" && (
            <ProfileView subjects={subjects} taxonomies={taxonomies} callLlm={callLlm} showToast={showToast} masterPrompt={MASTER_PROMPT} />
          )}
          {view === "intake" && (
            <NewResponseView subjects={subjects} taxonomies={taxonomies} onCreate={createSubmission} lastCreated={lastCreated} />
          )}
          {view === "review" && (
            <ReviewQueueView submissions={submissions} taxonomies={taxonomies} onApproveExisting={onApproveExisting} onApproveNew={onApproveNew} onManualMap={onManualMap} onRetry={onRetryClassify} />
          )}
          {view === "history" && (
            <HistoryView submissions={submissions} taxonomies={taxonomies} onGenerate={generatePlan} onRetryGenerate={generatePlan} />
          )}
        </>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
