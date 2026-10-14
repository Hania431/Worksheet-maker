"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, Check, Copy, LoaderCircle, Plus, Printer, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

type LessonInput = {
  subject: string;
  grade: string;
  topic: string;
  objectives: string;
  durationMinutes: number;
  language: "English" | "Urdu";
  studentLevel: "Beginner" | "Intermediate" | "Advanced";
  resources: string;
};

type TeachingActivity = { title: string; instructions: string; duration_minutes: number };
type LessonPlan = {
  title: string;
  topic: string;
  learning_objectives: string[];
  required_materials: string[];
  warm_up_activity: string;
  teaching_activities: TeachingActivity[];
  concept_explanation: string;
  participation_activities: string[];
  assessment_questions: string[];
  homework: string;
  summary: string;
  follow_up_activities: string[];
};
type SavedLessonPlan = {
  id: string;
  subject: string;
  grade: string;
  topic: string;
  inputs: LessonInput;
  plan: LessonPlan;
  updated_at: string;
};

const EMPTY_INPUT: LessonInput = {
  subject: "",
  grade: "",
  topic: "",
  objectives: "",
  durationMinutes: 45,
  language: "English",
  studentLevel: "Intermediate",
  resources: "",
};

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPlan(value: unknown): value is LessonPlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as Partial<LessonPlan>;
  return typeof plan.title === "string" && typeof plan.topic === "string"
    && stringList(plan.learning_objectives) && stringList(plan.required_materials)
    && typeof plan.warm_up_activity === "string"
    && Array.isArray(plan.teaching_activities)
    && plan.teaching_activities.every((activity) => typeof activity.title === "string"
      && typeof activity.instructions === "string" && typeof activity.duration_minutes === "number")
    && typeof plan.concept_explanation === "string"
    && stringList(plan.participation_activities) && stringList(plan.assessment_questions)
    && typeof plan.homework === "string" && typeof plan.summary === "string"
    && stringList(plan.follow_up_activities);
}

function parseList(text: string) {
  return text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function toListText(items: string[]) {
  return items.join("\n");
}

function createCsvSafeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function LessonPlanner({
  supabase,
  teacherId,
  onSignIn,
}: {
  supabase: SupabaseClient | null;
  teacherId: string | null;
  onSignIn: () => void;
}) {
  const [savedPlans, setSavedPlans] = useState<SavedLessonPlan[]>([]);
  const [input, setInput] = useState<LessonInput>(EMPTY_INPUT);
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadPlans = useCallback(async () => {
    if (!supabase || !teacherId) {
      setSavedPlans([]);
      return;
    }
    setLoadingPlans(true);
    try {
      const { data, error: queryError } = await supabase
        .from("lesson_plans")
        .select("id, subject, grade, topic, inputs, plan, updated_at")
        .eq("teacher_id", teacherId)
        .order("updated_at", { ascending: false });
      if (queryError) throw queryError;
      setSavedPlans((data ?? []).map((row) => ({
        id: row.id as string,
        subject: row.subject as string,
        grade: row.grade as string,
        topic: row.topic as string,
        inputs: row.inputs as LessonInput,
        plan: row.plan as LessonPlan,
        updated_at: row.updated_at as string,
      })).filter((row) => isPlan(row.plan)));
    } catch (loadError) {
      setError(loadError instanceof Error ? `Couldn't load your lesson plans: ${loadError.message}` : "Couldn't load your lesson plans.");
    } finally {
      setLoadingPlans(false);
    }
  }, [supabase, teacherId]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const filteredPlans = useMemo(() => savedPlans.filter((saved) => {
    const matchesSearch = `${saved.subject} ${saved.grade} ${saved.topic} ${saved.plan.title}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (!subjectFilter || saved.subject === subjectFilter) && (!gradeFilter || saved.grade === gradeFilter);
  }), [gradeFilter, savedPlans, search, subjectFilter]);
  const subjects = useMemo(() => [...new Set(savedPlans.map((saved) => saved.subject))].sort(), [savedPlans]);
  const grades = useMemo(() => [...new Set(savedPlans.map((saved) => saved.grade))].sort(), [savedPlans]);

  function startNewPlan() {
    setActiveId(null);
    setPlan(null);
    setInput(EMPTY_INPUT);
    setError("");
    setMessage("");
  }

  function openPlan(saved: SavedLessonPlan) {
    setActiveId(saved.id);
    setPlan(structuredClone(saved.plan));
    setInput({ ...EMPTY_INPUT, ...saved.inputs });
    setError("");
    setMessage("");
  }

  async function generatePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!input.subject.trim() || !input.grade.trim() || !input.topic.trim()) {
      setError("Enter a subject, grade/class, and topic before generating.");
      return;
    }
    if (!supabase || !teacherId) {
      setError("Sign in with your teacher account to generate and save a lesson plan.");
      return;
    }
    setGenerating(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = sessionData.session?.access_token;
      if (!token) {
        setError("Your session has expired. Sign in again to continue.");
        return;
      }
      const response = await fetch("/api/lesson-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...input, subject: input.subject.trim(), grade: input.grade.trim(), topic: input.topic.trim() }),
      });
      const result = await response.json() as { plan?: unknown; error?: string };
      if (!response.ok || !isPlan(result.plan)) throw new Error(result.error ?? "The AI returned an incomplete lesson plan. Your input is preserved.");
      setPlan(result.plan);
      setInput((current) => ({ ...current, subject: current.subject.trim(), grade: current.grade.trim(), topic: current.topic.trim() }));
      setMessage("Lesson plan generated. Review and edit it, then save when ready.");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Lesson-plan generation failed. Your input is preserved.");
    } finally {
      setGenerating(false);
    }
  }

  async function savePlan() {
    if (!plan || !supabase || !teacherId) {
      setError("Sign in to save lesson plans to your account.");
      return;
    }
    if (!input.subject.trim() || !input.grade.trim() || !input.topic.trim() || !plan.title.trim()
      || !plan.learning_objectives.some((item) => item.trim())
      || !plan.required_materials.some((item) => item.trim())
      || !plan.teaching_activities.length || plan.teaching_activities.some((item) => !item.title.trim() || !item.instructions.trim() || item.duration_minutes < 1)
      || !plan.concept_explanation.trim() || !plan.participation_activities.some((item) => item.trim())
      || !plan.assessment_questions.some((item) => item.trim()) || !plan.homework.trim()
      || !plan.summary.trim() || !plan.follow_up_activities.some((item) => item.trim())) {
      setError("Complete each lesson-plan section before saving.");
      return;
    }
    if (plan.teaching_activities.reduce((sum, item) => sum + item.duration_minutes, 0) !== input.durationMinutes) {
      setError("Teaching activity times must add up to the selected lesson duration before saving.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const row = {
        ...(activeId ? { id: activeId } : {}),
        teacher_id: teacherId,
        subject: input.subject.trim(),
        grade: input.grade.trim(),
        topic: input.topic.trim(),
        inputs: input,
        plan,
        updated_at: new Date().toISOString(),
      };
      const { data, error: saveError } = await supabase.from("lesson_plans")
        .upsert(row, { onConflict: "id" })
        .select("id")
        .single();
      if (saveError) throw saveError;
      setActiveId(data.id as string);
      await loadPlans();
      setMessage("Lesson plan saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? `Couldn't save this lesson plan: ${saveError.message}` : "Couldn't save this lesson plan.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePlan(saved: SavedLessonPlan) {
    if (!supabase || !window.confirm(`Delete “${saved.plan.title}”? This cannot be undone.`)) return;
    setError("");
    setMessage("");
    try {
      const { error: deleteError } = await supabase.from("lesson_plans").delete().eq("id", saved.id).eq("teacher_id", teacherId);
      if (deleteError) throw deleteError;
      setSavedPlans((current) => current.filter((item) => item.id !== saved.id));
      if (activeId === saved.id) startNewPlan();
      setMessage("Lesson plan deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? `Couldn't delete this lesson plan: ${deleteError.message}` : "Couldn't delete this lesson plan.");
    }
  }

  async function copyPlan() {
    if (!plan) return;
    const text = [
      plan.title,
      `Topic: ${plan.topic}`,
      "",
      "Learning objectives",
      ...plan.learning_objectives.map((item) => `• ${item}`),
      "",
      "Required materials",
      ...plan.required_materials.map((item) => `• ${item}`),
      "",
      `Introduction and warm-up: ${plan.warm_up_activity}`,
      "",
      "Teaching activities",
      ...plan.teaching_activities.map((item) => `${item.title} (${item.duration_minutes} min)\n${item.instructions}`),
      "",
      `Main concept: ${plan.concept_explanation}`,
      "",
      "Student participation",
      ...plan.participation_activities.map((item) => `• ${item}`),
      "",
      "Assessment questions",
      ...plan.assessment_questions.map((item, index) => `${index + 1}. ${item}`),
      "",
      `Homework: ${plan.homework}`,
      `Summary: ${plan.summary}`,
      "",
      "Follow-up activities",
      ...plan.follow_up_activities.map((item) => `• ${item}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Lesson plan copied to clipboard.");
      setError("");
    } catch (copyError) {
      setError(copyError instanceof Error ? `Couldn't copy the lesson plan: ${copyError.message}` : "Clipboard access is not available in this browser.");
    }
  }

  function updatePlan<K extends keyof LessonPlan>(key: K, value: LessonPlan[K]) {
    setPlan((current) => current ? { ...current, [key]: value } : current);
  }

  return (
    <section className="view-content secondary-view lesson-planner">
      <div className="page-heading">
        <div><div className="eyebrow">PLAN WITH PURPOSE</div><h1>Lesson Planner</h1><p>Create, refine, and keep complete lesson plans for your classes.</p></div>
        <button type="button" className="button button-primary" onClick={startNewPlan}><Plus size={16} /> New lesson plan</button>
      </div>
      {!teacherId && <div className="feature-notice"><BookOpenCheck size={17} /><span>Sign in to generate AI lesson plans and save private plans to your account.</span><button className="button button-primary" onClick={onSignIn}>Sign in</button></div>}
      {error && <p className="feature-error" role="alert">{error}</p>}
      {message && <p className="feature-success" role="status">{message}</p>}
      <div className="lesson-layout">
        <aside className="lesson-library">
          <div className="feature-toolbar">
            <label className="search-box"><Search size={16} /><input aria-label="Search lesson plans" placeholder="Search saved plans…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <div className="feature-filter-row">
              <label className="sr-only" htmlFor="lesson-subject-filter">Filter by subject</label>
              <select id="lesson-subject-filter" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="">All subjects</option>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select>
              <label className="sr-only" htmlFor="lesson-grade-filter">Filter by grade</label>
              <select id="lesson-grade-filter" value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)}><option value="">All grades</option>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select>
            </div>
          </div>
          <div className="lesson-list" aria-live="polite">
            {loadingPlans ? <p className="feature-empty"><LoaderCircle size={16} className="spin" /> Loading saved plans…</p>
              : filteredPlans.length ? filteredPlans.map((saved) => (
                <article className={saved.id === activeId ? "lesson-list-item active" : "lesson-list-item"} key={saved.id}>
                  <button className="lesson-open" onClick={() => openPlan(saved)}><strong>{saved.plan.title}</strong><span>{saved.subject} · {saved.grade} · {saved.topic}</span><small>Updated {new Date(saved.updated_at).toLocaleDateString()}</small></button>
                  <button className="icon-button" aria-label={`Delete ${saved.plan.title}`} onClick={() => void deletePlan(saved)}><Trash2 size={15} /></button>
                </article>
              )) : <p className="feature-empty">{teacherId ? "Saved lesson plans will appear here." : "Your saved plans are private to your account."}</p>}
          </div>
        </aside>

        <div className="lesson-workspace">
          <form className="panel lesson-input-panel" onSubmit={(event) => void generatePlan(event)}>
            <div className="panel-header"><div><h2>Lesson brief</h2><p>Share enough context to make the plan useful for your classroom.</p></div></div>
            <div className="lesson-input-grid">
              <label className="field"><span>Subject</span><input required maxLength={80} placeholder="e.g. Science" value={input.subject} onChange={(event) => setInput({ ...input, subject: event.target.value })} /></label>
              <label className="field"><span>Grade / class</span><input required maxLength={40} placeholder="e.g. Grade 5" value={input.grade} onChange={(event) => setInput({ ...input, grade: event.target.value })} /></label>
              <label className="field"><span>Topic or chapter</span><input required maxLength={160} placeholder="e.g. The water cycle" value={input.topic} onChange={(event) => setInput({ ...input, topic: event.target.value })} /></label>
              <label className="field"><span>Lesson duration</span><select value={input.durationMinutes} onChange={(event) => setInput({ ...input, durationMinutes: Number(event.target.value) })}>{[30, 40, 45, 50, 60, 75, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
              <label className="field"><span>Teaching language</span><select value={input.language} onChange={(event) => setInput({ ...input, language: event.target.value as LessonInput["language"] })}><option>English</option><option>Urdu</option></select></label>
              <label className="field"><span>Student level</span><select value={input.studentLevel} onChange={(event) => setInput({ ...input, studentLevel: event.target.value as LessonInput["studentLevel"] })}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label>
              <label className="field lesson-wide"><span>Learning objectives <small>Optional; one per line</small></span><textarea rows={3} maxLength={2000} placeholder="What should students know or be able to do?" value={input.objectives} onChange={(event) => setInput({ ...input, objectives: event.target.value })} /></label>
              <label className="field lesson-wide"><span>Teaching resources available <small>Optional</small></span><textarea rows={2} maxLength={1000} placeholder="e.g. textbook, board, measuring cups" value={input.resources} onChange={(event) => setInput({ ...input, resources: event.target.value })} /></label>
            </div>
            <div className="lesson-form-actions"><span>AI generation requires a signed-in account and server-side GROQ_API_KEY.</span><button className="button button-primary" type="submit" disabled={generating || !teacherId}>{generating ? <><LoaderCircle size={15} className="spin" /> Generating…</> : <><RefreshCw size={15} /> {plan ? "Regenerate plan" : "Generate lesson plan"}</>}</button></div>
          </form>

          {plan ? (
            <article className="panel lesson-plan-paper">
              <div className="lesson-plan-toolbar lesson-screen-only"><div><span className="eyebrow">YOUR LESSON PLAN</span><small>{input.subject} · {input.grade} · {input.durationMinutes} min · {input.language}</small></div><div className="lesson-toolbar-actions"><button className="button button-light" type="button" onClick={() => void copyPlan()}><Copy size={15} /> Copy</button><button className="button button-light" type="button" onClick={() => window.print()}><Printer size={15} /> Print / PDF</button><button className="button button-primary" type="button" onClick={() => void savePlan()} disabled={saving || !teacherId}>{saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} Save plan</button></div></div>
              <label className="field"><span>Lesson title</span><input maxLength={160} value={plan.title} onChange={(event) => updatePlan("title", event.target.value)} /></label>
              <label className="field"><span>Topic</span><input maxLength={160} value={plan.topic} onChange={(event) => updatePlan("topic", event.target.value)} /></label>
              <div className="lesson-plan-section"><h3>Learning objectives <small>(one per line)</small></h3><textarea rows={Math.max(3, plan.learning_objectives.length)} value={toListText(plan.learning_objectives)} onChange={(event) => updatePlan("learning_objectives", parseList(event.target.value))} /></div>
              <div className="lesson-plan-section"><h3>Required materials <small>(one per line)</small></h3><textarea rows={Math.max(2, plan.required_materials.length)} value={toListText(plan.required_materials)} onChange={(event) => updatePlan("required_materials", parseList(event.target.value))} /></div>
              <div className="lesson-plan-section"><h3>Introduction and warm-up</h3><textarea rows={3} value={plan.warm_up_activity} onChange={(event) => updatePlan("warm_up_activity", event.target.value)} /></div>
              <div className="lesson-plan-section"><h3>Teaching activities <small>({plan.teaching_activities.reduce((sum, item) => sum + item.duration_minutes, 0)} minutes total)</small></h3>{plan.teaching_activities.map((activity, index) => <div className="lesson-activity-edit" key={`${index}-${activity.title}`}><div><strong>{activity.title}</strong><span>{activity.duration_minutes} min</span></div><textarea rows={3} value={activity.instructions} onChange={(event) => updatePlan("teaching_activities", plan.teaching_activities.map((item, itemIndex) => itemIndex === index ? { ...item, instructions: event.target.value } : item))} /></div>)}</div>
              <div className="lesson-plan-section"><h3>Main concept explanation</h3><textarea rows={4} value={plan.concept_explanation} onChange={(event) => updatePlan("concept_explanation", event.target.value)} /></div>
              <div className="lesson-plan-section"><h3>Student participation <small>(one per line)</small></h3><textarea rows={Math.max(3, plan.participation_activities.length)} value={toListText(plan.participation_activities)} onChange={(event) => updatePlan("participation_activities", parseList(event.target.value))} /></div>
              <div className="lesson-plan-section"><h3>Assessment questions <small>(one per line)</small></h3><textarea rows={Math.max(3, plan.assessment_questions.length)} value={toListText(plan.assessment_questions)} onChange={(event) => updatePlan("assessment_questions", parseList(event.target.value))} /></div>
              <div className="lesson-plan-section"><h3>Homework</h3><textarea rows={3} value={plan.homework} onChange={(event) => updatePlan("homework", event.target.value)} /></div>
              <div className="lesson-plan-section"><h3>Lesson summary</h3><textarea rows={3} value={plan.summary} onChange={(event) => updatePlan("summary", event.target.value)} /></div>
              <div className="lesson-plan-section"><h3>Follow-up activities <small>(one per line)</small></h3><textarea rows={Math.max(2, plan.follow_up_activities.length)} value={toListText(plan.follow_up_activities)} onChange={(event) => updatePlan("follow_up_activities", parseList(event.target.value))} /></div>
              <div className="lesson-plan-toolbar lesson-print-only"><small>Created with Classkit Lesson Planner · {createCsvSafeText(input.subject)} · {createCsvSafeText(input.grade)}</small></div>
              <div className="lesson-plan-footer lesson-screen-only"><span>{activeId ? "Changes are not saved until you save this plan." : "This generated plan is not saved yet."}</span><button className="button button-primary" type="button" onClick={() => void savePlan()} disabled={saving || !teacherId}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Save changes</button></div>
            </article>
          ) : <div className="panel feature-empty lesson-placeholder"><BookOpenCheck size={26} /><h2>Your lesson plan will appear here</h2><p>Enter your class details, generate a plan, and edit it to fit your teaching style.</p></div>}
        </div>
      </div>
    </section>
  );
}
