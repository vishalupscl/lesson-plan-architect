// Teacher Onboarding — the teacher-facing homepage.
//
// A mobile-first, step-wise form: a simple sign-in (email, school, name,
// grades, subjects — no password), then short plain-language steps that
// capture how the teacher actually teaches. Every answer is saved as they go,
// the AI structures the answers into the profile JSON on the review screen,
// and the finished profile downloads as one JSON file per subject, named from
// the sign-in details.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Download, Loader2, Pencil,
  PlusCircle, Share2, Sparkles, Trash2, X
} from "lucide-react";
import {
  AID_OPTIONS, ASSESSMENT_FIELDS, FACILITATION_FIELDS, GRADES, MEDIUM_OPTIONS,
  ONBOARDING_SUBJECTS, SCHOOLS, SESSION_FIELDS, STRUGGLE_EXAMPLES,
  buildExportObject, buildProfileBody, exportFileName, saveToStudioStore, submitProfileRecord
} from "./aiBuilder.js";
import "./onboarding.css";

const DRAFT_KEY = "lpa:onboarding:draft:v1";

// JSON-safe deep clone — structuredClone is missing on older phone browsers.
function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function emptyAnswers() {
  return {
    session: {
      mode: "fields",
      opener: "", delivery: "", aids: "", checkpoint: "",
      practice_release: "", closer: "", homework: "", homework_review: "",
      freehand: ""
    },
    facilitation: { mode: "fields", style: "", engagement: "", consolidation: "", freehand: "" },
    struggles: { topics: [], habits: [], basics: [] },
    assessment: { pre_test: "", post_test: "", revision: "" },
    prefs: { detail_level: "detailed", tone: "suggestive", must_include: [] },
    variations: { grade_variation: "", avoids: [] }
  };
}

function buildSteps(subjects) {
  const steps = [{ id: "welcome" }, { id: "classroom" }];
  subjects.forEach((subject, index) => {
    if (subjects.length > 1) steps.push({ id: "subject-intro", subject, index });
    steps.push({ id: "session", subject });
    steps.push({ id: "style", subject });
    steps.push({ id: "struggles", subject });
    steps.push({ id: "assessment", subject });
    steps.push({ id: "prefs", subject });
    steps.push({ id: "variations", subject });
  });
  steps.push({ id: "review" });
  steps.push({ id: "done" });
  return steps;
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download on iOS Safari/Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareJson(obj, filename) {
  const file = new File([JSON.stringify(obj, null, 2)], filename, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/* ---------------- small building blocks ---------------- */

function Field({ label, hint, placeholder, value, onChange, type = "text", textarea, inputMode }) {
  return (
    <label className="tob-field">
      <span className="tob-label">{label}</span>
      {hint ? <span className="tob-hint">{hint}</span> : null}
      {textarea ? (
        <textarea
          className="tob-input tob-textarea"
          placeholder={placeholder}
          value={value}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="tob-input"
          type={type}
          inputMode={inputMode}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function ChipSelect({ options, selected, onToggle, single = false }) {
  return (
    <div className="tob-chips">
      {options.map((opt) => {
        const label = String(opt);
        const isOn = single ? selected === opt : selected.includes(opt);
        return (
          <button
            key={label}
            type="button"
            aria-pressed={isOn}
            className={`tob-chip ${isOn ? "tob-chip-on" : ""}`}
            onClick={() => onToggle(opt)}
          >
            {isOn ? <Check size={14} /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function AddList({ items, onChange, placeholder, addLabel = "Add" }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange([...items, t]);
    setText("");
  };
  return (
    <div className="tob-addlist">
      {items.map((item, i) => (
        <div key={`${item}-${i}`} className="tob-addlist-item">
          <span>{item}</span>
          <button type="button" className="tob-icon-btn" aria-label={`Remove "${item}"`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X size={15} />
          </button>
        </div>
      ))}
      <div className="tob-addlist-row">
        <input
          className="tob-input"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={add}
        />
        <button type="button" className="tob-add-btn" onClick={add} aria-label={addLabel}>
          <PlusCircle size={18} /> {addLabel}
        </button>
      </div>
    </div>
  );
}

function ChoiceCards({ options, value, onChange }) {
  return (
    <div className="tob-choice-grid">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          className={`tob-choice ${value === opt.value ? "tob-choice-on" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          <span className="tob-choice-title">{opt.title}</span>
          <span className="tob-choice-desc">{opt.desc}</span>
        </button>
      ))}
    </div>
  );
}

function ModeSwitch({ mode, onChange }) {
  return (
    <div className="tob-mode">
      <button type="button" aria-pressed={mode === "fields"}
        className={mode === "fields" ? "tob-mode-on" : ""} onClick={() => onChange("fields")}>
        Answer quick questions
      </button>
      <button type="button" aria-pressed={mode === "freehand"}
        className={mode === "freehand" ? "tob-mode-on" : ""} onClick={() => onChange("freehand")}>
        Write in my own words
      </button>
    </div>
  );
}

function StepIntro({ emoji, title, sub }) {
  return (
    <div className="tob-step-intro">
      <div className="tob-step-emoji" aria-hidden>{emoji}</div>
      <h1 className="tob-title">{title}</h1>
      {sub ? <p className="tob-sub">{sub}</p> : null}
    </div>
  );
}

/* ---------------- the wizard ---------------- */

export default function TeacherOnboarding() {
  const draft = useRef(loadDraft()).current;

  const [account, setAccount] = useState(draft?.account || {
    email: "", school: SCHOOLS[0], name: "", grades: [], subjects: []
  });
  const [shared, setShared] = useState(draft?.shared || {
    classSize: "", aids: [], medium: "", experienceYears: ""
  });
  const [answers, setAnswers] = useState(draft?.answers || {});
  // Restore the saved step; without a saved built profile, never straight
  // onto the final "done" screen — land on review so it rebuilds.
  const [stepIndex, setStepIndex] = useState(() => {
    if (!draft) return 0;
    const len = buildSteps(draft.account?.subjects || []).length;
    const max = draft.built ? len - 1 : Math.max(len - 2, 0);
    return Math.min(draft.stepIndex || 0, Math.max(max, 0));
  });
  const [formError, setFormError] = useState("");

  const [building, setBuilding] = useState(false);
  // { [subject]: { body, aiUsed, aiError } } — restored from the draft so
  // edits made on the review screen survive a reload or a killed tab.
  const [built, setBuilt] = useState(draft?.built || null);

  const steps = useMemo(() => buildSteps(account.subjects), [account.subjects]);
  const safeIndex = Math.min(stepIndex, steps.length - 1);
  const step = steps[safeIndex];

  // Persist the draft on every change so a teacher can close the app and resume.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ account, shared, answers, built, stepIndex: safeIndex }));
    } catch { /* storage full/blocked — the form still works for this visit */ }
  }, [account, shared, answers, built, safeIndex]);

  // Answers changed → any previously built profile is stale. Skipped on mount
  // so a built profile restored from the draft isn't wiped immediately.
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) { firstRunRef.current = false; return; }
    setBuilt(null);
  }, [answers, shared, account.subjects]);

  useEffect(() => { window.scrollTo(0, 0); setFormError(""); }, [safeIndex]);

  // Clear the inline validation message as soon as the teacher edits anything.
  useEffect(() => { setFormError(""); }, [account]);

  // Arriving at review → let the AI structure every segment of the JSON.
  // `building` must NOT be a dependency: flipping it would re-run the effect
  // and its cleanup would cancel the in-flight build.
  useEffect(() => {
    if (step?.id !== "review" || built) return;
    let cancelled = false;
    (async () => {
      setBuilding(true);
      const result = {};
      for (const subject of account.subjects) {
        result[subject] = await buildProfileBody(answers[subject] || emptyAnswers(), shared, subject);
      }
      if (!cancelled) { setBuilt(result); setBuilding(false); }
    })();
    return () => { cancelled = true; };
  }, [step?.id, built, account.subjects, answers, shared]);

  const ans = step?.subject ? (answers[step.subject] || emptyAnswers()) : null;
  const setAns = (fn) => {
    setAnswers((prev) => {
      const cur = prev[step.subject] || emptyAnswers();
      return { ...prev, [step.subject]: fn(deepClone(cur)) };
    });
  };

  const updateBody = (subject, fn) => {
    setBuilt((prev) => {
      if (!prev || !prev[subject]) return prev;
      const next = deepClone(prev);
      fn(next[subject].body);
      return next;
    });
  };

  const validateWelcome = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email.trim())) return "Please enter a valid email address.";
    if (!account.school) return "Please choose your school.";
    if (!account.name.trim()) return "Please enter your name.";
    if (!account.grades.length) return "Please pick at least one grade you teach.";
    if (!account.subjects.length) return "Please pick at least one subject you teach.";
    return "";
  };

  const goNext = () => {
    if (step.id === "welcome") {
      const err = validateWelcome();
      if (err) { setFormError(err); return; }
    }
    setStepIndex(Math.min(safeIndex + 1, steps.length - 1));
  };
  const goBack = () => setStepIndex(Math.max(safeIndex - 1, 0));

  const startOver = () => {
    if (!confirm("Clear all your answers and start again?")) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setAccount({ email: "", school: SCHOOLS[0], name: "", grades: [], subjects: [] });
    setShared({ classSize: "", aids: [], medium: "", experienceYears: "" });
    setAnswers({});
    setBuilt(null);
    setStepIndex(0);
  };

  // null | "sending" | "ok" | "failed" — status of sending the finished
  // profiles to the school's records store. The sequence token makes sure a
  // stale submit run can't overwrite the state of a newer one.
  const [submitState, setSubmitState] = useState(null);
  const submitSeqRef = useRef(0);

  const runSubmit = async (builtMap) => {
    const seq = ++submitSeqRef.current;
    setSubmitState("sending");
    let allOk = true;
    for (const subject of account.subjects) {
      try {
        await submitProfileRecord(account, subject, builtMap[subject].body);
      } catch {
        allOk = false;
      }
    }
    if (seq === submitSeqRef.current) setSubmitState(allOk ? "ok" : "failed");
  };

  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);

  const finish = async () => {
    if (!built || finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    try {
      for (const subject of account.subjects) {
        await saveToStudioStore({ ...account, experienceYears: shared.experienceYears }, subject, built[subject].body);
      }
      setStepIndex(steps.length - 1);
      runSubmit(built);
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  };

  const exportFor = (subject) => buildExportObject(built[subject].body);

  const progress = steps.length > 2 ? Math.round((safeIndex / (steps.length - 1)) * 100) : 0;
  const firstName = (account.name.trim().split(/\s+/)[0]) || "Teacher";

  // On phones (esp. an installed iOS home-screen app) the system share sheet
  // is the reliable way to hand the file over, so it becomes the primary
  // action when file-sharing is supported; Download stays available always.
  const canShareFiles = useMemo(() => {
    try {
      return typeof navigator !== "undefined" && !!navigator.canShare &&
        navigator.canShare({ files: [new File(["x"], "x.json", { type: "application/json" })] });
    } catch {
      return false;
    }
  }, []);

  /* ---------------- per-step content ---------------- */

  let content = null;

  if (step.id === "welcome") {
    content = (
      <>
        <StepIntro
          emoji="👋"
          title="Welcome!"
          sub="Let's set up your teaching profile. Answer a few easy questions about how you teach — it takes about 10 minutes, and it helps us make lesson plans that match your style."
        />
        <div className="tob-tip">
          <strong>📱 Before you start: keep this app on your phone</strong>
          <p>Open your browser menu and choose <em>“Add to Home Screen”</em> (iPhone: Share button → Add to Home Screen). It will open like a normal app whenever you need it.</p>
        </div>
        <Field label="Your email" placeholder="you@example.com" type="email" inputMode="email"
          value={account.email} onChange={(v) => setAccount({ ...account, email: v })} />
        <label className="tob-field">
          <span className="tob-label">Your school</span>
          <select className="tob-input" value={account.school}
            onChange={(e) => setAccount({ ...account, school: e.target.value })}>
            {SCHOOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Field label="Your name" placeholder="e.g., Asha Verma"
          value={account.name} onChange={(v) => setAccount({ ...account, name: v })} />
        <div className="tob-field">
          <span className="tob-label">Which grades do you teach?</span>
          <span className="tob-hint">Tap all that apply.</span>
          <ChipSelect options={GRADES} selected={account.grades}
            onToggle={(g) => setAccount({
              ...account,
              grades: account.grades.includes(g)
                ? account.grades.filter((x) => x !== g)
                : [...account.grades, g]
            })} />
        </div>
        <div className="tob-field">
          <span className="tob-label">Which subjects do you teach?</span>
          <span className="tob-hint">Tap all that apply. You'll answer the style questions once for each subject.</span>
          <ChipSelect options={ONBOARDING_SUBJECTS} selected={account.subjects}
            onToggle={(s) => setAccount({
              ...account,
              subjects: account.subjects.includes(s)
                ? account.subjects.filter((x) => x !== s)
                : [...account.subjects, s]
            })} />
        </div>
        {formError ? <div className="tob-error" role="alert">{formError}</div> : null}
        <a className="tob-admin-link" href="#admin">School admin? Open Teacher Records →</a>
      </>
    );
  }

  if (step.id === "classroom") {
    content = (
      <>
        <StepIntro
          emoji="🏫"
          title="About your classroom"
          sub="A little context so your lesson plans fit your real classroom. Skip anything you're not sure about."
        />
        <Field label="How many students are in your class?" placeholder="e.g., 38" inputMode="numeric"
          value={shared.classSize} onChange={(v) => setShared({ ...shared, classSize: v })} />
        <div className="tob-field">
          <span className="tob-label">What do you have in your classroom?</span>
          <span className="tob-hint">Tap everything that's available to you.</span>
          <ChipSelect options={AID_OPTIONS} selected={shared.aids}
            onToggle={(a) => setShared({
              ...shared,
              aids: shared.aids.includes(a) ? shared.aids.filter((x) => x !== a) : [...shared.aids, a]
            })} />
        </div>
        <div className="tob-field">
          <span className="tob-label">Which language do you mostly teach in?</span>
          <ChipSelect single options={MEDIUM_OPTIONS} selected={shared.medium}
            onToggle={(m) => setShared({ ...shared, medium: shared.medium === m ? "" : m })} />
          <input className="tob-input" style={{ marginTop: 8 }} placeholder="Or type another language"
            value={shared.medium}
            onChange={(e) => setShared({ ...shared, medium: e.target.value })} />
        </div>
        <Field label="How many years have you been teaching?" hint="Optional." placeholder="e.g., 8" inputMode="numeric"
          value={shared.experienceYears} onChange={(v) => setShared({ ...shared, experienceYears: v })} />
      </>
    );
  }

  if (step.id === "subject-intro") {
    const prev = step.index > 0 ? account.subjects[step.index - 1] : null;
    content = (
      <>
        <StepIntro
          emoji="📘"
          title={`Now, your ${step.subject} classes`}
          sub={prev
            ? `Subject ${step.index + 1} of ${account.subjects.length}. If you teach ${step.subject} much like ${prev}, copy your answers and just adjust what's different.`
            : `Subject ${step.index + 1} of ${account.subjects.length}. The next few questions are about how you teach ${step.subject}.`}
        />
        {prev ? (
          <button type="button" className="tob-secondary-btn" onClick={() => {
            setAnswers((a) => ({ ...a, [step.subject]: deepClone(a[prev] || emptyAnswers()) }));
            setStepIndex(safeIndex + 1);
          }}>
            <Pencil size={16} /> Copy my {prev} answers, then adjust
          </button>
        ) : null}
      </>
    );
  }

  if (step.id === "session") {
    content = (
      <>
        <StepIntro
          emoji="⏰"
          title="Your class, start to finish"
          sub={`Think of a normal ${step.subject} period. One short line for each part is perfect — skip anything that doesn't apply.`}
        />
        <ModeSwitch mode={ans.session.mode} onChange={(m) => setAns((a) => { a.session.mode = m; return a; })} />
        {ans.session.mode === "fields" ? (
          SESSION_FIELDS.map(([key, label, ph]) => (
            <Field key={key} label={label} placeholder={ph} value={ans.session[key]}
              onChange={(v) => setAns((a) => { a.session[key] = v; return a; })} />
          ))
        ) : (
          <Field
            label="Describe a typical class in your own words"
            hint="Start to finish: how you open, teach, check, give practice, wrap up, and handle homework. We'll organise it for you."
            placeholder="e.g., I start with one question from yesterday, then explain the new topic on the board with an example…"
            textarea
            value={ans.session.freehand}
            onChange={(v) => setAns((a) => { a.session.freehand = v; return a; })}
          />
        )}
      </>
    );
  }

  if (step.id === "style") {
    content = (
      <>
        <StepIntro
          emoji="✨"
          title="Your way of teaching"
          sub={`Every teacher has their own style. Tell us about yours in ${step.subject} — there are no wrong answers.`}
        />
        <ModeSwitch mode={ans.facilitation.mode} onChange={(m) => setAns((a) => { a.facilitation.mode = m; return a; })} />
        {ans.facilitation.mode === "fields" ? (
          FACILITATION_FIELDS.map(([key, label, ph]) => (
            <Field key={key} label={label} placeholder={ph} value={ans.facilitation[key]}
              onChange={(v) => setAns((a) => { a.facilitation[key] = v; return a; })} />
          ))
        ) : (
          <Field
            label="Describe your style in your own words"
            hint="How you explain things, keep students involved, and make lessons stick. We'll organise it for you."
            placeholder="e.g., I like showing one worked example fully, then students try while I go around the class…"
            textarea
            value={ans.facilitation.freehand}
            onChange={(v) => setAns((a) => { a.facilitation.freehand = v; return a; })}
          />
        )}
      </>
    );
  }

  if (step.id === "struggles") {
    const ex = STRUGGLE_EXAMPLES[step.subject] || STRUGGLE_EXAMPLES.Mathematics;
    content = (
      <>
        <StepIntro
          emoji="🤔"
          title="Where do students struggle?"
          sub={`Every class has sticky spots. Add as many as you like — your lesson plans will pay extra attention to them.`}
        />
        <div className="tob-field">
          <span className="tob-label">Which topics confuse students every year?</span>
          <span className="tob-hint">Specific chapters or ideas that always need extra time.</span>
          <AddList items={ans.struggles.topics} placeholder={ex.topics}
            onChange={(items) => setAns((a) => { a.struggles.topics = items; return a; })} />
        </div>
        <div className="tob-field">
          <span className="tob-label">What habits or gaps show up across the whole subject?</span>
          <span className="tob-hint">Things students do (or miss) no matter the topic.</span>
          <AddList items={ans.struggles.habits} placeholder={ex.habits}
            onChange={(items) => setAns((a) => { a.struggles.habits = items; return a; })} />
        </div>
        <div className="tob-field">
          <span className="tob-label">What basics from earlier classes are missing?</span>
          <span className="tob-hint">Skills they should already have but often don't.</span>
          <AddList items={ans.struggles.basics} placeholder={ex.basics}
            onChange={(items) => setAns((a) => { a.struggles.basics = items; return a; })} />
        </div>
      </>
    );
  }

  if (step.id === "assessment") {
    content = (
      <>
        <StepIntro
          emoji="📝"
          title="Tests and revision"
          sub={`How do you check learning in ${step.subject}? Short answers are fine.`}
        />
        {ASSESSMENT_FIELDS.map(([key, label, ph]) => (
          <Field key={key} label={label} placeholder={ph} value={ans.assessment[key]}
            onChange={(v) => setAns((a) => { a.assessment[key] = v; return a; })} />
        ))}
      </>
    );
  }

  if (step.id === "prefs") {
    content = (
      <>
        <StepIntro
          emoji="📋"
          title="How should your lesson plans feel?"
          sub="Your plans will be written the way you like to read them."
        />
        <div className="tob-field">
          <span className="tob-label">How much detail do you want?</span>
          <ChoiceCards value={ans.prefs.detail_level}
            onChange={(v) => setAns((a) => { a.prefs.detail_level = v; return a; })}
            options={[
              { value: "detailed", title: "Detailed", desc: "Step-by-step guidance I can follow" },
              { value: "concise", title: "Short & simple", desc: "Just the key points, I'll fill the rest" }
            ]} />
        </div>
        <div className="tob-field">
          <span className="tob-label">What tone do you prefer?</span>
          <ChoiceCards value={ans.prefs.tone}
            onChange={(v) => setAns((a) => { a.prefs.tone = v; return a; })}
            options={[
              { value: "suggestive", title: "Friendly suggestions", desc: "“You could open with…”" },
              { value: "prescriptive", title: "Clear instructions", desc: "“Open with… then have students…”" }
            ]} />
        </div>
        <div className="tob-field">
          <span className="tob-label">Anything your plans must always include?</span>
          <span className="tob-hint">Optional — add as many as you like.</span>
          <AddList items={ans.prefs.must_include} placeholder="e.g., A common-mistake warning in every lesson"
            onChange={(items) => setAns((a) => { a.prefs.must_include = items; return a; })} />
        </div>
      </>
    );
  }

  if (step.id === "variations") {
    content = (
      <>
        <StepIntro
          emoji="🎚️"
          title="Anything that changes?"
          sub="Last questions for this subject — both are optional."
        />
        <Field
          label="Do you teach differently for different grades?"
          placeholder="e.g., Simpler examples and more practice for Grade 6"
          textarea
          value={ans.variations.grade_variation}
          onChange={(v) => setAns((a) => { a.variations.grade_variation = v; return a; })}
        />
        <div className="tob-field">
          <span className="tob-label">Anything you avoid in class?</span>
          <AddList items={ans.variations.avoids} placeholder="e.g., Long lectures without a break"
            onChange={(items) => setAns((a) => { a.variations.avoids = items; return a; })} />
        </div>
      </>
    );
  }

  if (step.id === "review") {
    content = building || !built ? (
      <div className="tob-building">
        <Loader2 size={28} className="tob-spin" />
        <h1 className="tob-title">Putting your profile together…</h1>
        <p className="tob-sub">We're organising your answers neatly. This takes a few seconds.</p>
      </div>
    ) : (
      <>
        <StepIntro
          emoji="🔎"
          title="Check your profile"
          sub="Here's what we understood. Tap any answer to fix it, then finish."
        />
        {account.subjects.map((subject) => {
          const b = built[subject];
          const body = b.body;
          return (
            <div key={subject} className="tob-review-card">
              <div className="tob-review-head">
                <strong>{subject}</strong>
                <span className={`tob-badge ${b.aiUsed ? "" : "tob-badge-plain"}`}>
                  {b.aiUsed ? <><Sparkles size={12} /> Organised for you</> : "Saved as you wrote it"}
                </span>
              </div>
              {!b.aiUsed && b.aiError ? (
                <div className="tob-note">We couldn't auto-organise this one, so your answers are kept word-for-word. You can still edit anything below.</div>
              ) : null}

              <details className="tob-section" open>
                <summary>Your class, start to finish</summary>
                {SESSION_FIELDS.map(([key, label]) => (
                  <Field key={key} label={label} value={body.session_shape[key] || ""}
                    onChange={(v) => updateBody(subject, (bd) => { bd.session_shape[key] = v; })} />
                ))}
              </details>

              <details className="tob-section">
                <summary>Your way of teaching</summary>
                {FACILITATION_FIELDS.map(([key, label]) => (
                  <Field key={key} label={label} value={body.facilitation[key] || ""}
                    onChange={(v) => updateBody(subject, (bd) => { bd.facilitation[key] = v; })} />
                ))}
              </details>

              <details className="tob-section">
                <summary>Your classroom</summary>
                <Field label="Students in class" inputMode="numeric" value={body.context.class_size ?? ""}
                  onChange={(v) => updateBody(subject, (bd) => {
                    const n = parseInt(v, 10);
                    bd.context.class_size = Number.isFinite(n) && n > 0 ? n : null;
                  })} />
                <div className="tob-field">
                  <span className="tob-label">Available in your classroom</span>
                  <AddList items={body.context.aids_available} placeholder="e.g., Projector"
                    onChange={(items) => updateBody(subject, (bd) => { bd.context.aids_available = items; })} />
                </div>
                <Field label="Language of teaching" value={body.context.medium || ""}
                  onChange={(v) => updateBody(subject, (bd) => { bd.context.medium = v; })} />
              </details>

              <details className="tob-section">
                <summary>Where students struggle</summary>
                <div className="tob-field">
                  <span className="tob-label">Topics that trip students</span>
                  <AddList items={body.student_struggles.concept_specific.map((x) => x.statement)}
                    placeholder="Add another topic struggle"
                    onChange={(items) => updateBody(subject, (bd) => {
                      bd.student_struggles.concept_specific = items.map((statement) => {
                        const prev = bd.student_struggles.concept_specific.find((x) => x.statement === statement);
                        return prev || { statement, matched_concept_ids: [], confidence: "medium", reviewed: false };
                      });
                    })} />
                </div>
                <div className="tob-field">
                  <span className="tob-label">Habits across the subject</span>
                  <AddList items={body.student_struggles.subject_general.map((x) => x.statement)}
                    placeholder="Add another habit"
                    onChange={(items) => updateBody(subject, (bd) => {
                      bd.student_struggles.subject_general = items.map((statement) => {
                        const prev = bd.student_struggles.subject_general.find((x) => x.statement === statement);
                        return prev || { statement, applies_to: `all sessions in ${subject}` };
                      });
                    })} />
                </div>
                <div className="tob-field">
                  <span className="tob-label">Missing basics from earlier years</span>
                  <AddList items={body.student_struggles.foundational.map((x) => x.statement)}
                    placeholder="Add another missing basic"
                    onChange={(items) => updateBody(subject, (bd) => {
                      bd.student_struggles.foundational = items.map((statement) => {
                        const prev = bd.student_struggles.foundational.find((x) => x.statement === statement);
                        return prev || { statement, implication: "" };
                      });
                    })} />
                </div>
              </details>

              <details className="tob-section">
                <summary>Tests and revision</summary>
                {ASSESSMENT_FIELDS.map(([key, label]) => (
                  <Field key={key} label={label} value={body.assessment_style[key] || ""}
                    onChange={(v) => updateBody(subject, (bd) => { bd.assessment_style[key] = v; })} />
                ))}
              </details>

              <details className="tob-section">
                <summary>Lesson plan wishes</summary>
                <div className="tob-field">
                  <span className="tob-label">Detail</span>
                  <ChoiceCards value={body.plan_preferences.detail_level}
                    onChange={(v) => updateBody(subject, (bd) => { bd.plan_preferences.detail_level = v; })}
                    options={[
                      { value: "detailed", title: "Detailed", desc: "Step-by-step guidance" },
                      { value: "concise", title: "Short & simple", desc: "Just the key points" }
                    ]} />
                </div>
                <div className="tob-field">
                  <span className="tob-label">Tone</span>
                  <ChoiceCards value={body.plan_preferences.tone}
                    onChange={(v) => updateBody(subject, (bd) => { bd.plan_preferences.tone = v; })}
                    options={[
                      { value: "suggestive", title: "Friendly suggestions", desc: "“You could try…”" },
                      { value: "prescriptive", title: "Clear instructions", desc: "“Do this, then this”" }
                    ]} />
                </div>
                <div className="tob-field">
                  <span className="tob-label">Must always include</span>
                  <AddList items={body.plan_preferences.must_include} placeholder="e.g., A quick recap"
                    onChange={(items) => updateBody(subject, (bd) => { bd.plan_preferences.must_include = items; })} />
                </div>
              </details>

              <details className="tob-section">
                <summary>Anything that changes</summary>
                <Field label="Differences by grade" textarea value={body.variations.grade_variation || ""}
                  onChange={(v) => updateBody(subject, (bd) => { bd.variations.grade_variation = v; })} />
                <div className="tob-field">
                  <span className="tob-label">Things you avoid</span>
                  <AddList items={body.variations.avoids} placeholder="e.g., Long lectures"
                    onChange={(items) => updateBody(subject, (bd) => { bd.variations.avoids = items; })} />
                </div>
              </details>
            </div>
          );
        })}
      </>
    );
  }

  if (step.id === "done") {
    content = (
      <>
        <StepIntro
          emoji="🎉"
          title={`All set, ${firstName}!`}
          sub="Your teaching profile is ready. Download the file below and share it with your school coordinator — it's how your lesson plans get personalised to you."
        />
        {submitState === "sending" ? (
          <div className="tob-note"><Loader2 size={14} className="tob-spin" /> Sending your profile to your school…</div>
        ) : submitState === "ok" ? (
          <div className="tob-tip"><strong>✓ Sent to your school's records.</strong><p>The downloads below are your own copy — you don't have to do anything else.</p></div>
        ) : submitState === "failed" ? (
          <div className="tob-note">
            We couldn't send your profile to the school's records right now. Your downloads below still work — or{" "}
            <button type="button" className="tob-retry-link" onClick={() => built && runSubmit(built)}>try sending again</button>.
          </div>
        ) : null}
        {built ? account.subjects.map((subject) => (
          <div key={subject} className="tob-download-card">
            <div className="tob-download-info">
              <CheckCircle2 size={20} className="tob-ok" />
              <div>
                <strong>{subject} profile</strong>
                <div className="tob-filename">{exportFileName(account, subject)}</div>
              </div>
            </div>
            <div className="tob-download-actions">
              {canShareFiles ? (
                <>
                  <button type="button" className="tob-primary-btn"
                    onClick={() => shareJson(exportFor(subject), exportFileName(account, subject))}>
                    <Share2 size={17} /> Share
                  </button>
                  <button type="button" className="tob-secondary-btn"
                    onClick={() => downloadJson(exportFor(subject), exportFileName(account, subject))}>
                    <Download size={17} /> Download
                  </button>
                </>
              ) : (
                <button type="button" className="tob-primary-btn"
                  onClick={() => downloadJson(exportFor(subject), exportFileName(account, subject))}>
                  <Download size={17} /> Download
                </button>
              )}
            </div>
          </div>
        )) : (
          <div className="tob-note">Your downloads are on the previous screen — tap Back and finish again.</div>
        )}
        <button type="button" className="tob-link-btn" onClick={() => setStepIndex(steps.length - 2)}>
          <ArrowLeft size={15} /> Review my answers again
        </button>
        <button type="button" className="tob-link-btn" onClick={startOver}>
          <Trash2 size={15} /> Start a new profile
        </button>
      </>
    );
  }

  /* ---------------- frame ---------------- */

  const showFooter = step.id !== "done" && !(step.id === "review" && (building || !built));
  const isWelcome = step.id === "welcome";

  return (
    <div className="tob-app">
      <div className="tob-topbar">
        <header className="tob-header">
          <div className="tob-brand">
            <span className="tob-brand-dot" aria-hidden>📖</span>
            <span>Teacher Profile</span>
          </div>
          {!isWelcome && step.id !== "done" ? (
            <span className="tob-step-count">Step {safeIndex + 1} of {steps.length - 1}</span>
          ) : null}
        </header>
        {!isWelcome && step.id !== "done" ? (
          <div className="tob-progress-wrap">
            <div className="tob-progress"><div className="tob-progress-fill" style={{ width: `${progress}%` }} /></div>
          </div>
        ) : null}
      </div>

      <main className="tob-main">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Enter moves the form forward — except on the review screen,
            // where dismissing the phone keyboard must not finish the wizard.
            if (step.id !== "review" && step.id !== "done") goNext();
          }}
        >
          {content}
          {/* invisible submit so pressing Enter in a field moves the form forward */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </main>

      {showFooter ? (
        <footer className="tob-footer">
          {!isWelcome ? (
            <button type="button" className="tob-back-btn" onClick={goBack}>
              <ArrowLeft size={18} /> Back
            </button>
          ) : null}
          {step.id === "review" ? (
            <button type="button" className="tob-primary-btn tob-next-btn" onClick={finish} disabled={finishing}>
              {finishing ? <Loader2 size={18} className="tob-spin" /> : null}
              {finishing ? "Finishing…" : "Looks good — finish"} {finishing ? null : <Check size={18} />}
            </button>
          ) : (
            <button type="button" className="tob-primary-btn tob-next-btn" onClick={goNext}>
              {isWelcome ? "Start" : "Next"} <ArrowRight size={18} />
            </button>
          )}
        </footer>
      ) : null}
    </div>
  );
}
