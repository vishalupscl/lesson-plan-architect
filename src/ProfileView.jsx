import { useState, useEffect } from "react";
import {
  Plus, X, Check, Sparkles, Loader2, Download, Eye, Trash2, ChevronRight, UserRound
} from "lucide-react";
import {
  emptyProfile, profileKey, PROFILE_PREFIX, renderProfileBlock,
  buildExtractPrompt, buildStrugglePrompt, assemblePreviewPrompt, logChange
} from "./profile.js";

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function uid(p) { return p + Math.random().toString(36).slice(2, 9); }
function safeParse(s, f) { try { return JSON.parse(s); } catch { return f; } }
function stripFences(s) { return (s || "").replace(/```json|```/g, "").trim(); }

async function sget(key) { try { const r = await window.storage.get(key); return r.value; } catch { return null; } }
async function sset(key, val) { await window.storage.set(key, typeof val === "string" ? val : JSON.stringify(val)); }
async function slist(prefix) { try { const r = await window.storage.list(prefix); return r.keys; } catch { return []; } }
async function sdel(key) { try { await window.storage.delete(key); } catch {} }

const SESSION_FIELDS = [
  ["opener", "How you begin the period"],
  ["delivery", "How content is delivered"],
  ["aids", "Aids used, and when"],
  ["checkpoint", "How you check understanding mid-class"],
  ["practice_release", "In-class practice pattern"],
  ["closer", "How you wrap up"],
  ["homework", "What you assign"],
  ["homework_review", "How you review it"]
];

export default function ProfileView({ subjects, taxonomies, callChatGPT, showToast, masterPrompt }) {
  const [profiles, setProfiles] = useState([]);      // list of {key, profile}
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState(null); // key of profile open in editor
  const [creating, setCreating] = useState(false);

  useEffect(() => { (async () => {
    const keys = await slist(PROFILE_PREFIX);
    const list = [];
    for (const k of keys) { const raw = await sget(k); if (raw) list.push({ key: k, profile: safeParse(raw, null) }); }
    setProfiles(list.filter(x => x.profile));
    setLoading(false);
  })(); }, []);

  const reload = async () => {
    const keys = await slist(PROFILE_PREFIX);
    const list = [];
    for (const k of keys) { const raw = await sget(k); if (raw) list.push({ key: k, profile: safeParse(raw, null) }); }
    setProfiles(list.filter(x => x.profile));
  };

  const editing = profiles.find(p => p.key === editingKey);

  if (loading) return <div className="lpa-empty-wide"><Loader2 size={20} className="lpa-spin" /><div>Loading profiles…</div></div>;

  if (creating) {
    return <CreateProfile subjects={subjects} onCancel={() => setCreating(false)} onCreate={async (teacherName, subject) => {
      const teacherId = uid("t-");
      const prof = emptyProfile(teacherId, teacherName, subject);
      const key = profileKey(teacherId, slug(subject));
      await sset(key, prof);
      await reload();
      setCreating(false);
      setEditingKey(key);
    }} />;
  }

  if (editing) {
    return <ProfileEditor
      entry={editing}
      taxonomies={taxonomies}
      callChatGPT={callChatGPT}
      showToast={showToast}
      masterPrompt={masterPrompt}
      onSave={async (updated) => { await sset(editing.key, updated); await reload(); showToast("Profile saved"); }}
      onClose={() => { setEditingKey(null); reload(); }}
    />;
  }

  return (
    <div>
      <div className="lpa-col-header">
        <div><span className="lpa-display" style={{ fontSize: 16 }}>Teacher Profiles</span>
          <div className="lpa-muted-sm">Capture how each teacher teaches → export JSON for the backend prompt.</div></div>
        <button className="lpa-btn lpa-btn-primary lpa-btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> New teacher</button>
      </div>

      {profiles.length === 0 ? (
        <div className="lpa-empty-wide"><UserRound size={20} /><div>No teacher profiles yet.</div>
          <button className="lpa-btn lpa-btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> Onboard your first teacher</button></div>
      ) : (
        <div className="lpa-card-list">
          {profiles.map(({ key, profile }) => {
            const filled = profileCompleteness(profile);
            return (
              <div key={key} className="lpa-card" style={{ cursor: "pointer" }} onClick={() => setEditingKey(key)}>
                <div className="lpa-card-top">
                  <div>
                    <div className="lpa-card-title">{profile.teacher_name} <span className="lpa-muted-sm">· {profile.subject}</span></div>
                    <div className="lpa-muted-sm">{filled}% captured · updated {new Date(profile.updated_at).toLocaleDateString()}</div>
                  </div>
                  <div className="lpa-btn-row">
                    <button className="lpa-icon-btn" title="Delete" onClick={async (e) => { e.stopPropagation(); if (confirm(`Delete ${profile.teacher_name}'s ${profile.subject} profile?`)) { await sdel(key); reload(); } }}><Trash2 size={15} /></button>
                    <ChevronRight size={16} style={{ color: "var(--muted)" }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function profileCompleteness(p) {
  let total = 0, done = 0;
  const ss = p.session_shape || {}; SESSION_FIELDS.forEach(([k]) => { total++; if (ss[k]) done++; });
  total++; if (p.pedagogy?.session_flow_id || p.pedagogy?.candidate_session_flow) done++;
  total++; if ((p.pedagogy?.teaching_move_ids || []).length) done++;
  total++; if ((p.student_struggles?.concept_specific || []).length + (p.student_struggles?.subject_general || []).length + (p.student_struggles?.foundational || []).length) done++;
  total++; if (p.plan_preferences?.tone) done++;
  return Math.round((done / total) * 100);
}

function CreateProfile({ subjects, onCancel, onCreate }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState(subjects[0] || "");
  return (
    <div className="lpa-card lpa-add-form" style={{ maxWidth: 460 }}>
      <div className="lpa-card-title">Onboard a teacher</div>
      <label className="lpa-label">Teacher name</label>
      <input className="lpa-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mrs. Kavita Rao" />
      <label className="lpa-label">Subject</label>
      <select className="lpa-input" value={subject} onChange={e => setSubject(e.target.value)}>
        {subjects.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <div className="lpa-muted-sm" style={{ marginTop: 8 }}>One profile per teacher per subject.</div>
      <div className="lpa-btn-row" style={{ marginTop: 14 }}>
        <button className="lpa-btn lpa-btn-primary lpa-btn-sm" disabled={!name.trim()} onClick={() => onCreate(name.trim(), subject)}><Check size={14} /> Create</button>
        <button className="lpa-btn lpa-btn-ghost lpa-btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ProfileEditor({ entry, taxonomies, callChatGPT, showToast, masterPrompt, onSave, onClose }) {
  const [p, setP] = useState(() => JSON.parse(JSON.stringify(entry.profile)));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const tax = taxonomies[p.subject] || { macros: [], mesos: [] };

  const update = (path, value) => {
    setP(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      let o = next; const parts = path.split(".");
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const save = () => { p.updated_at = new Date().toISOString(); onSave(p); };

  // ---- freehand extraction into a section ----
  const [freehand, setFreehand] = useState({});
  const extractSection = async (section) => {
    const text = (freehand[section] || "").trim();
    if (!text) return;
    setBusy(true);
    try {
      const out = await callChatGPT(buildExtractPrompt(section, text), 700);
      const parsed = safeParse(stripFences(out), null);
      if (parsed) {
        setP(prev => { const n = JSON.parse(JSON.stringify(prev)); n[section] = { ...n[section], ...parsed }; return n; });
        showToast("Extracted — review the fields");
      } else showToast("Could not parse extraction", "rust");
    } catch (e) { showToast(e.message || "Extraction failed", "rust"); }
    setBusy(false);
  };

  // ---- struggle add + categorise ----
  const [struggleText, setStruggleText] = useState("");
  const addStruggle = async () => {
    const s = struggleText.trim(); if (!s) return;
    setBusy(true);
    try {
      const conceptList = []; // concept list would come from curriculum payload; empty is fine (falls to subject/foundational)
      const out = await callChatGPT(buildStrugglePrompt(s, p.subject, conceptList), 400);
      const parsed = safeParse(stripFences(out), null) || { kind: "subject_general" };
      setP(prev => {
        const n = JSON.parse(JSON.stringify(prev));
        n.student_struggles = n.student_struggles || { concept_specific: [], subject_general: [], foundational: [] };
        if (parsed.kind === "concept_specific")
          n.student_struggles.concept_specific.push({ statement: s, matched_concept_ids: parsed.matched_concept_ids || [], confidence: parsed.confidence || "low", reviewed: false });
        else if (parsed.kind === "foundational")
          n.student_struggles.foundational.push({ statement: s, implication: parsed.implication || "simplify language" });
        else
          n.student_struggles.subject_general.push({ statement: s, applies_to: parsed.applies_to || `all sessions in ${p.subject}` });
        return n;
      });
      setStruggleText("");
      showToast(`Added as ${parsed.kind.replace("_", "-")}`);
    } catch (e) { showToast(e.message || "Failed", "rust"); }
    setBusy(false);
  };
  const removeStruggle = (tier, i) => setP(prev => { const n = JSON.parse(JSON.stringify(prev)); n.student_struggles[tier].splice(i, 1); return n; });

  // ---- pedagogy selection + overlay ----
  const toggleMove = (id) => setP(prev => {
    const n = JSON.parse(JSON.stringify(prev));
    const arr = n.pedagogy.teaching_move_ids;
    n.pedagogy.teaching_move_ids = arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id];
    return n;
  });
  const setFlow = (id) => setP(prev => { const n = JSON.parse(JSON.stringify(prev)); n.pedagogy.session_flow_id = id; return n; });
  const [overlayBase, setOverlayBase] = useState("");
  const [overlayText, setOverlayText] = useState("");
  const addOverlay = () => {
    if (!overlayBase || !overlayText.trim()) return;
    setP(prev => {
      const n = JSON.parse(JSON.stringify(prev));
      n.pedagogy.overlays.push({ base_id: overlayBase, adaptation: overlayText.trim() });
      logChange(n, "overlay_added", overlayText.trim(), { base_id: overlayBase, trigger: "proactive" });
      return n;
    });
    setOverlayBase(""); setOverlayText("");
    showToast("Overlay added");
  };

  // ---- export ----
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ teacher_profile: p }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `profile_${slug(p.teacher_name)}_${slug(p.subject)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ---- prompt preview ----
  const showPreview = () => {
    const block = renderProfileBlock(p, taxonomies);
    const sampleCurriculum =
      `Subject: ${p.subject}\nChapter: [sample]\nConcept: [a concept from this chapter]\nConcept Description: [the concept_details for this concept]`;
    setPreview(assemblePreviewPrompt({ masterPrompt: masterPrompt || "[MASTER PROMPT V3.1 goes here]", profileBlock: block, curriculumPayload: sampleCurriculum }));
  };

  return (
    <div>
      <div className="lpa-col-header">
        <div><span className="lpa-display" style={{ fontSize: 16 }}>{p.teacher_name}</span>
          <span className="lpa-muted-sm"> · {p.subject}</span></div>
        <div className="lpa-btn-row">
          <button className="lpa-btn lpa-btn-sm" onClick={showPreview}><Eye size={14} /> Preview prompt</button>
          <button className="lpa-btn lpa-btn-sm" onClick={exportJson}><Download size={14} /> Export JSON</button>
          <button className="lpa-btn lpa-btn-primary lpa-btn-sm" onClick={save}><Check size={14} /> Save</button>
          <button className="lpa-btn lpa-btn-ghost lpa-btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>

      {busy && <div className="lpa-hint" style={{ marginBottom: 8 }}><Loader2 size={13} className="lpa-spin" /> working…</div>}

      {/* meta */}
      <Section title="Details">
        <div className="lpa-two-col">
          <div><label className="lpa-label">Grades (comma sep)</label>
            <input className="lpa-input" value={(p.grades || []).join(", ")} onChange={e => update("grades", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} /></div>
          <div><label className="lpa-label">Years teaching</label>
            <input className="lpa-input" type="number" value={p.experience_years ?? ""} onChange={e => update("experience_years", e.target.value ? Number(e.target.value) : null)} /></div>
        </div>
      </Section>

      {/* session shape */}
      <Section title="How you run a period (Session Shape)">
        <FreehandExtract value={freehand.session_shape || ""} onChange={v => setFreehand({ ...freehand, session_shape: v })}
          onExtract={() => extractSection("session_shape")} placeholder="Describe a typical period in your own words — we'll fill the fields below." />
        {SESSION_FIELDS.map(([k, hint]) => (
          <div key={k}><label className="lpa-label">{k.replace(/_/g, " ")} <span className="lpa-muted-sm">— {hint}</span></label>
            <input className="lpa-input" value={p.session_shape[k] || ""} onChange={e => update(`session_shape.${k}`, e.target.value)} /></div>
        ))}
      </Section>

      {/* pedagogy */}
      <Section title={`Session Flow (Macro) — pick one`}>
        <div className="lpa-radio-list">
          {(tax.macros || []).map(m => (
            <div key={m.id} className={`lpa-select-row ${p.pedagogy.session_flow_id === m.id ? "lpa-select-row-active" : ""}`} onClick={() => setFlow(m.id)}>
              <div><div className="lpa-select-row-title">{m.name}</div><div className="lpa-select-row-desc">{m.description}</div></div>
            </div>
          ))}
          {(tax.macros || []).length === 0 && <div className="lpa-empty">No macros in this subject's taxonomy yet. Add them in the Taxonomy Library tab.</div>}
        </div>
      </Section>

      <Section title="Teaching Moves (Meso) — pick 1–3">
        <div className="lpa-checkrow">
          {(tax.mesos || []).map(m => (
            <label key={m.id} className="lpa-checkbox-pill" title={m.description}>
              <input type="checkbox" checked={p.pedagogy.teaching_move_ids.includes(m.id)} onChange={() => toggleMove(m.id)} /> {m.name}
            </label>
          ))}
          {(tax.mesos || []).length === 0 && <div className="lpa-empty">No mesos yet.</div>}
        </div>
      </Section>

      <Section title="Personal adaptation (Overlay)">
        <div className="lpa-hint" style={{ marginBottom: 8 }}>Take a standard entry and add your personal twist — the base stays generic, your adaptation travels with you.</div>
        <select className="lpa-input" value={overlayBase} onChange={e => setOverlayBase(e.target.value)}>
          <option value="">Choose a standard entry to adapt…</option>
          {(tax.macros || []).map(m => <option key={m.id} value={m.id}>Flow: {m.name}</option>)}
          {(tax.mesos || []).map(m => <option key={m.id} value={m.id}>Move: {m.name}</option>)}
        </select>
        <input className="lpa-input" style={{ marginTop: 6 }} placeholder="What do you do differently?" value={overlayText} onChange={e => setOverlayText(e.target.value)} />
        <button className="lpa-btn lpa-btn-sm" style={{ marginTop: 6 }} onClick={addOverlay}><Plus size={13} /> Add overlay</button>
        {(p.pedagogy.overlays || []).map((o, i) => (
          <div key={i} className="lpa-quote" style={{ marginTop: 8 }}>{overlayBaseName(tax, o.base_id)}: {o.adaptation}
            <button className="lpa-icon-btn" style={{ float: "right" }} onClick={() => setP(prev => { const n = JSON.parse(JSON.stringify(prev)); n.pedagogy.overlays.splice(i, 1); return n; })}><X size={13} /></button>
          </div>
        ))}
      </Section>

      {/* struggles */}
      <Section title="Where students struggle">
        <div className="lpa-hint" style={{ marginBottom: 8 }}>Type one struggle and we'll sort it — concept-specific, subject-general, or foundational.</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="lpa-input" value={struggleText} onChange={e => setStruggleText(e.target.value)} placeholder="e.g. students mix up respiration and photosynthesis"
            onKeyDown={e => { if (e.key === "Enter") addStruggle(); }} />
          <button className="lpa-btn lpa-btn-sm" onClick={addStruggle}><Sparkles size={13} /> Sort</button>
        </div>
        <StruggleList label="Concept-specific" tier="concept_specific" items={p.student_struggles.concept_specific} onRemove={removeStruggle} />
        <StruggleList label="Subject-general" tier="subject_general" items={p.student_struggles.subject_general} onRemove={removeStruggle} />
        <StruggleList label="Foundational" tier="foundational" items={p.student_struggles.foundational} onRemove={removeStruggle} />
      </Section>

      {/* assessment + prefs */}
      <Section title="How you build assessments (Clarius)">
        {["pre_test", "post_test", "revision"].map(k => (
          <div key={k}><label className="lpa-label">{k.replace("_", "-")}</label>
            <input className="lpa-input" value={p.assessment_style[k] || ""} onChange={e => update(`assessment_style.${k}`, e.target.value)} /></div>
        ))}
      </Section>

      <Section title="What you want from the auto-plan">
        <label className="lpa-label">Detail level</label>
        <select className="lpa-input" value={p.plan_preferences.detail_level} onChange={e => update("plan_preferences.detail_level", e.target.value)}>
          <option value="detailed">Detailed teacher notes</option><option value="lean">Lean skeleton</option>
        </select>
        <label className="lpa-label">Tone</label>
        <select className="lpa-input" value={p.plan_preferences.tone} onChange={e => update("plan_preferences.tone", e.target.value)}>
          <option value="suggestive">Suggestive (you could…)</option><option value="prescriptive">Prescriptive (do this)</option>
        </select>
        <label className="lpa-label">Must-include (comma sep)</label>
        <input className="lpa-input" value={(p.plan_preferences.must_include || []).join(", ")} onChange={e => update("plan_preferences.must_include", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} />
      </Section>

      {preview && (
        <div className="lpa-inset" style={{ marginTop: 16 }}>
          <div className="lpa-col-header"><span className="lpa-display">Assembled prompt preview</span>
            <button className="lpa-icon-btn" onClick={() => setPreview(null)}><X size={15} /></button></div>
          <div className="lpa-pre" style={{ maxHeight: 340 }}>{preview}</div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="lpa-card" style={{ marginBottom: 12 }}>
      <div className="lpa-card-title" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function FreehandExtract({ value, onChange, onExtract, placeholder }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <textarea className="lpa-input lpa-textarea" rows={2} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      <button className="lpa-btn lpa-btn-sm" style={{ marginTop: 6 }} onClick={onExtract}><Sparkles size={13} /> Extract into fields</button>
    </div>
  );
}

function StruggleList({ label, tier, items, onRemove }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="lpa-muted-sm" style={{ marginBottom: 4 }}>{label}</div>
      {items.map((s, i) => (
        <div key={i} className="lpa-quote" style={{ marginTop: 4 }}>
          {s.statement}
          {tier === "concept_specific" && <span className="lpa-chip" style={{ marginLeft: 6 }}>{(s.matched_concept_ids || []).join(", ") || "unmatched"} · {s.confidence}{s.reviewed ? "" : " · review"}</span>}
          <button className="lpa-icon-btn" style={{ float: "right" }} onClick={() => onRemove(tier, i)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function overlayBaseName(tax, id) {
  const m = (tax.macros || []).find(x => x.id === id) || (tax.mesos || []).find(x => x.id === id);
  return m ? m.name : id;
}
