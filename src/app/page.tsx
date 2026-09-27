"use client";

import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, BookOpenCheck, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Download, Eye, FileText,
  Filter, FlaskConical, GraduationCap, Grid2X2, Lightbulb, LoaderCircle, LogOut, Menu, Moon,
  MoreHorizontal, Plus, Printer, Search, Settings2, Share2, ShieldCheck, Sparkles, Sun, Trash2,
  Users, X, Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { QUESTION_TYPE_LABELS, type Question, type QuestionType, type Submission, type Worksheet } from "@/lib/types";

type View = "overview" | "worksheets" | "results";
type Profile = { id: string; email?: string };
const STORAGE_KEY = "classkit-demo-worksheets-v2";
const TYPES: QuestionType[] = ["mcq", "fill_blank", "true_false", "short_answer"];
const SAMPLE_WORKSHEETS: Worksheet[] = [
  {
    id: "demo-1", title: "Fractions: equivalent & comparing", subject: "Math", topic: "Fractions",
    grade: "5", difficulty: "Medium", published: true, share_code: "M8K4Q2", retries_allowed: false,
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(), submissions: 0,
    questions: [
      { question: "Which fraction is equivalent to 2/3?", type: "mcq", options: ["4/6", "3/5", "2/6", "4/5"], answer: "4/6" },
      { question: "Write 3/4 as a decimal.", type: "fill_blank", options: [], answer: "0.75" },
    ],
  },
  {
    id: "demo-2", title: "The water cycle", subject: "Science", topic: "Water cycle",
    grade: "4", difficulty: "Easy", published: true, share_code: "WTR218", retries_allowed: false,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(), submissions: 0,
    questions: [
      { question: "What is the process called when liquid water turns into vapor?", type: "mcq", options: ["Condensation", "Evaporation", "Precipitation", "Collection"], answer: "Evaporation" },
    ],
  },
  {
    id: "demo-3", title: "Parts of speech", subject: "English", topic: "Nouns and verbs",
    grade: "3", difficulty: "Easy", published: false, share_code: null, retries_allowed: false,
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(), submissions: 0,
    questions: [],
  },
];

function shortDate(date: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(date));
}

function timeAgo(date: string) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function answerMatches(question: Question, answer: string) {
  const entered = answer.trim().toLowerCase().replace(/,/g, "");
  const expected = question.answer.trim().toLowerCase().replace(/,/g, "");
  if (question.type === "fill_blank" && entered) {
    const enteredNumber = Number(entered);
    const expectedNumber = Number(expected);
    if (Number.isFinite(enteredNumber) && Number.isFinite(expectedNumber)) return enteredNumber === expectedNumber;
  }
  return entered === expected;
}

function initialWorksheets(): Worksheet[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) as Worksheet[] : SAMPLE_WORKSHEETS;
}

function mathQuestions(values: { topic: string; number: number; difficulty: string; types: QuestionType[] }): Question[] | null {
  const topic = values.topic.toLowerCase();
  const match = topic.match(/addition|add|sum|plus|subtraction|subtract|minus|multiplication|multiply|times|division|divide|fractions?/);
  if (!match) return null;
  const operation = match[0].startsWith("add") || match[0] === "sum" || match[0] === "plus" ? "+"
    : match[0].startsWith("sub") || match[0] === "minus" ? "-"
      : match[0].startsWith("mult") || match[0] === "times" ? "*" : match[0].startsWith("div") ? "/" : null;
  if (!operation) return null;
  const spread = values.difficulty === "Easy" ? 20 : values.difficulty === "Hard" ? 150 : 60;
  return Array.from({ length: values.number }, (_, index) => {
    const a = 2 + ((index * 17 + 5) % spread);
    const b = 1 + ((index * 11 + 3) % spread);
    const left = operation === "/" ? a * b : operation === "-" ? Math.max(a, b) : a;
    const right = operation === "-" ? Math.min(a, b) : operation === "/" ? a : b;
    const answer = operation === "+" ? a + b : operation === "-" ? left - right : operation === "*" ? a * b : b;
    const type = values.types[index % values.types.length];
    const equation = `${left} ${operation} ${right}`;
    if (type === "mcq") {
      const options = [...new Set([answer, answer + 1, Math.max(0, answer - 1), answer + 3])].slice(0, 4).map(String);
      while (options.length < 4) options.push(String(answer + options.length + 4));
      return { question: `${equation} = ?`, type, options, answer: String(answer), explanation: `${equation} equals ${answer}.` };
    }
    if (type === "true_false") {
      const isTrue = index % 2 === 0;
      const shown = isTrue ? answer : answer + 1 + (index % 3);
      return { question: `${equation} = ${shown}`, type, options: ["True", "False"], answer: isTrue ? "True" : "False", explanation: `${equation} equals ${answer}.` };
    }
    if (type === "short_answer") return { question: `Show how you would solve ${equation}.`, type, options: [], answer: String(answer), explanation: `The result is ${answer}.` };
    return { question: `${equation} = ______`, type, options: [], answer: String(answer), explanation: `${equation} equals ${answer}.` };
  });
}

export default function Home() {
  const demoMode = !isSupabaseConfigured();
  const supabase = getSupabaseClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [view, setView] = useState<View>("overview");
  const [search, setSearch] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeWorksheet, setActiveWorksheet] = useState<Worksheet | null>(null);
  const [manualReview, setManualReview] = useState<Submission | null>(null);
  const [gradeDraft, setGradeDraft] = useState<Record<string, boolean>>({});
  const [showAnswers, setShowAnswers] = useState(true);
  const [form, setForm] = useState({ subject: "Math", topic: "", grade: "5", number: 10, difficulty: "Medium", types: ["mcq", "fill_blank"] as QuestionType[] });
  const [darkSetting, setDarkSetting] = useState(false);

  const loadTeacherData = useCallback(async () => {
    if (demoMode) {
      try {
        setWorksheets(initialWorksheets());
        const storedSubmissions = localStorage.getItem("classkit-demo-submissions-v1");
        setSubmissions(storedSubmissions ? JSON.parse(storedSubmissions) as Submission[] : []);
      } catch (error) {
        console.error("Could not load Classkit demo data.", error);
        setNotice("Saved demo data could not be read. Clear this site’s browser storage to start fresh.");
      }
      setDemoLoaded(true);
      setAuthLoading(false);
      return;
    }
    if (!supabase || !profile) return;
    const { data, error } = await supabase.from("worksheets").select("*").order("created_at", { ascending: false });
    if (error) {
      setNotice(`Couldn't load your worksheets: ${error.message}`);
      return;
    }
    const rows = (data ?? []) as Worksheet[];
    setWorksheets(rows);
    const ids = rows.map((item) => item.id);
    if (ids.length) {
      const { data: submittedRows, error: submissionError } = await supabase.from("submissions").select("*").in("worksheet_id", ids).order("created_at", { ascending: false });
      if (submissionError) setNotice(`Couldn't load class results: ${submissionError.message}`);
      else setSubmissions((submittedRows ?? []) as Submission[]);
    } else {
      setSubmissions([]);
    }
  }, [demoMode, profile, supabase]);

  useEffect(() => {
    setDarkSetting(localStorage.getItem("classkit-dark-mode") === "true");
    setThemeLoaded(true);
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setNotice(error.message);
      setProfile(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setProfile(session?.user ? { id: session.user.id, email: session.user.email } : null);
      setAuthLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (demoMode || profile) queueMicrotask(() => { void loadTeacherData(); });
  }, [demoMode, profile, loadTeacherData]);

  useEffect(() => {
    if (!themeLoaded) return;
    document.documentElement.dataset.theme = darkSetting ? "dark" : "light";
    localStorage.setItem("classkit-dark-mode", String(darkSetting));
  }, [darkSetting, themeLoaded]);

  useEffect(() => {
    if (!demoMode || !demoLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(worksheets));
    } catch (error) {
      console.error("Could not save Classkit demo worksheets.", error);
      setNotice("This browser could not save the demo worksheet.");
    }
  }, [demoMode, demoLoaded, worksheets]);

  const filteredWorksheets = useMemo(() => worksheets.filter((worksheet) =>
    `${worksheet.title} ${worksheet.subject} ${worksheet.topic}`.toLowerCase().includes(search.toLowerCase())), [worksheets, search]);
  const gradedSubmissions = submissions.filter((item) => !item.needs_review && item.total > 0);
  const average = gradedSubmissions.length ? Math.round(gradedSubmissions.reduce((sum, item) => sum + item.score / item.total * 100, 0) / gradedSubmissions.length) : 0;
  const todayLabel = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
  const questionMisses = useMemo(() => {
    const stats: { key: string; title: string; question: string; missed: number; total: number }[] = [];
    worksheets.forEach((worksheet) => {
      const worksheetSubmissions = submissions.filter((item) => item.worksheet_id === worksheet.id);
      worksheet.questions.forEach((question, index) => {
        if (question.type === "short_answer") return;
        const answered = worksheetSubmissions.filter((item) => typeof item.answers?.[index] === "string");
        if (!answered.length) return;
        const missed = answered.filter((item) => !answerMatches(question, item.answers[index])).length;
        stats.push({ key: `${worksheet.id}-${index}`, title: worksheet.title, question: question.question, missed, total: answered.length });
      });
    });
    return stats.sort((left, right) => right.missed / right.total - left.missed / left.total).slice(0, 5);
  }, [worksheets, submissions]);
  const publishedCount = worksheets.filter((item) => item.published).length;
  const completedCount = submissions.length || worksheets.reduce((sum, item) => sum + (item.submissions ?? 0), 0);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    if (!supabase) return;
    setLoading(true);
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (result.error) {
      setAuthError(result.error.message);
      return;
    }
    if (authMode === "signup" && !result.data.session) setAuthError("Check your inbox to confirm your email, then come back to sign in.");
    else setAuthOpen(false);
  }

  async function createWorksheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.topic.trim()) {
      setNotice("Add a topic before generating your worksheet.");
      return;
    }
    if (!form.types.length) {
      setNotice("Choose at least one question type.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      let questions: Question[];
      if (!demoMode) {
        const { data: sessionData } = await supabase!.auth.getSession();
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
          body: JSON.stringify(form),
        });
        const result = await response.json() as { questions?: Question[]; error?: string };
        if (!response.ok || !result.questions) throw new Error(result.error ?? "Question generation failed.");
        questions = result.questions;
      } else {
        const mathWorksheet = form.subject.toLowerCase() === "math"
          ? mathQuestions({ topic: form.topic, number: form.number, difficulty: form.difficulty, types: form.types })
          : null;
        if (!mathWorksheet) {
          throw new Error("Demo mode can generate arithmetic worksheets only. To make accurate worksheets for English, Science, History, or another subject, connect Supabase and add GROQ_API_KEY so questions are generated and validated by the server.");
        }
        questions = mathWorksheet;
      }
      const newWorksheet: Worksheet = {
        id: crypto.randomUUID(), title: `${form.topic.trim()}: practice`, subject: form.subject,
        topic: form.topic.trim(), grade: form.grade, difficulty: form.difficulty, questions,
        published: false, share_code: null, retries_allowed: false, created_at: new Date().toISOString(),
      };
      if (!demoMode) {
        const { error } = await supabase!.from("worksheets").insert({ ...newWorksheet, teacher_id: profile!.id });
        if (error) throw new Error(error.message);
      } else {
        setWorksheets((current) => [newWorksheet, ...current]);
      }
      setCreateOpen(false);
      setActiveWorksheet(newWorksheet);
      setNotice("Your worksheet is ready to review.");
      if (!demoMode) await loadTeacherData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong while creating your worksheet.");
    } finally {
      setLoading(false);
    }
  }

  async function saveWorksheet(updated: Worksheet) {
    setLoading(true);
    if (demoMode) {
      setWorksheets((current) => current.map((item) => item.id === updated.id ? updated : item));
    } else {
      const { error } = await supabase!.from("worksheets").update({
        title: updated.title, questions: updated.questions, published: updated.published,
        share_code: updated.share_code, retries_allowed: updated.retries_allowed,
      }).eq("id", updated.id);
      if (error) {
        setNotice(`Couldn't save worksheet: ${error.message}`);
        setLoading(false);
        return false;
      }
      await loadTeacherData();
    }
    setActiveWorksheet(updated);
    setLoading(false);
    setNotice(updated.published ? "Worksheet published — share link copied to clipboard." : "Changes saved.");
    return true;
  }

  async function deleteWorksheet(worksheet: Worksheet) {
    if (!window.confirm(`Delete “${worksheet.title}”? This also removes its submissions.`)) return;
    if (!demoMode) {
      const { error } = await supabase!.from("worksheets").delete().eq("id", worksheet.id);
      if (error) { setNotice(`Couldn't delete worksheet: ${error.message}`); return; }
    }
    setWorksheets((current) => current.filter((item) => item.id !== worksheet.id));
    setSubmissions((current) => current.filter((item) => item.worksheet_id !== worksheet.id));
    if (activeWorksheet?.id === worksheet.id) setActiveWorksheet(null);
  }

  async function shareWorksheet(worksheet: Worksheet) {
    const code = worksheet.share_code ?? crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
    const updated = { ...worksheet, published: true, share_code: code };
    const saved = await saveWorksheet(updated);
    if (!saved) return;
    const link = `${window.location.origin}/s/${code}`;
    try { await navigator.clipboard.writeText(link); } catch { setNotice(`Worksheet published. Share this link: ${link}`); }
  }

  async function closeWorksheet(worksheet: Worksheet) {
    const updated = { ...worksheet, published: false };
    setActiveWorksheet(updated);
    const saved = await saveWorksheet(updated);
    if (!saved) return;
    setNotice("Student submissions are closed. You can reopen this worksheet whenever you’re ready.");
  }

  async function saveManualGrades(graded: Record<string, boolean>) {
    if (!manualReview) return;
    const worksheet = worksheets.find((item) => item.id === manualReview.worksheet_id);
    if (!worksheet) return;
    const objectiveScore = worksheet.questions.reduce((score, question, index) => {
      if (question.type === "short_answer") return score;
      return score + (answerMatches(question, manualReview.answers[index] ?? "") ? 1 : 0);
    }, 0);
    const score = objectiveScore + Object.values(graded).filter(Boolean).length;
    const needsReview = worksheet.questions.some((question, index) => question.type === "short_answer" && graded[String(index)] === undefined);
    if (!demoMode) {
      const { error } = await supabase!.from("submissions").update({ manual_scores: graded, score, needs_review: needsReview }).eq("id", manualReview.id);
      if (error) { setNotice(`Couldn't save the manual grades: ${error.message}`); return; }
    }
    const next = { ...manualReview, manual_scores: graded, score, needs_review: needsReview };
    setSubmissions((current) => {
      const updated = current.map((item) => item.id === next.id ? next : item);
      if (demoMode) localStorage.setItem("classkit-demo-submissions-v1", JSON.stringify(updated));
      return updated;
    });
    setManualReview(null);
    setNotice(needsReview ? "Grades saved. A few short answers still need review." : "Manual grades saved.");
  }

  async function logout() {
    const { error } = await supabase!.auth.signOut();
    if (error) setNotice(`Couldn't sign out: ${error.message}`);
  }

  function exportCsv() {
    const rows = [["Student", "Class", "Score", "Total", "Percentage", "Submitted"]];
    submissions.forEach((item) => rows.push([
      item.student_name, item.section ?? "", String(item.score), String(item.total),
      item.needs_review ? "Needs review" : item.total ? `${Math.round(item.score / item.total * 100)}%` : "", new Date(item.created_at).toLocaleString(),
    ]));
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "classkit-results.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  function toggleType(type: QuestionType) {
    setForm((current) => ({ ...current, types: current.types.includes(type) ? current.types.filter((item) => item !== type) : [...current.types, type] }));
  }

  if (activeWorksheet) {
    return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark"><BookOpenCheck size={18} /></span><span>classkit</span></div><button className="back-button" onClick={() => setActiveWorksheet(null)}><ArrowLeft size={16} /> Back to workspace</button><div className="topbar-right"><span className="avatar">JD</span></div></header>
      <main className="editor-page"><div className="editor-heading"><div><div className="eyebrow">WORKSHEET EDITOR</div><input className="title-input" aria-label="Worksheet title" value={activeWorksheet.title} onChange={(event) => setActiveWorksheet({ ...activeWorksheet, title: event.target.value })} /><p className="subtle">{activeWorksheet.subject} · Grade {activeWorksheet.grade} · {activeWorksheet.questions.length} questions</p></div><div className="editor-actions"><button className="button button-light" onClick={() => setShowAnswers(!showAnswers)}><Eye size={16} /> {showAnswers ? "Hide answers" : "Show answers"}</button><button className="button button-light" onClick={() => window.print()}><Printer size={16} /> Print</button><button className="button button-primary" onClick={() => void shareWorksheet(activeWorksheet)}><Share2 size={16} /> {activeWorksheet.published ? "Copy share link" : "Publish worksheet"}</button></div></div>
        <div className="editor-layout"><section className="question-list">{activeWorksheet.questions.map((question, index) => <article className="question-editor" key={`${activeWorksheet.id}-${index}`}><div className="question-number">{String(index + 1).padStart(2, "0")}</div><div className="question-fields"><span className="question-type">{QUESTION_TYPE_LABELS[question.type]}</span><textarea aria-label={`Question ${index + 1}`} value={question.question} onChange={(event) => { const questions = [...activeWorksheet.questions]; questions[index] = { ...question, question: event.target.value }; setActiveWorksheet({ ...activeWorksheet, questions }); }} rows={2} />
          {question.type === "mcq" && question.options.map((option, optionIndex) => <div className="option-edit" key={optionIndex}><span>{String.fromCharCode(65 + optionIndex)}</span><input aria-label={`Option ${optionIndex + 1}`} value={option} onChange={(event) => { const questions = [...activeWorksheet.questions]; const options = [...question.options]; options[optionIndex] = event.target.value; questions[index] = { ...question, options }; setActiveWorksheet({ ...activeWorksheet, questions }); }} /></div>)}
          {showAnswers && <div className="answer-edit"><CheckCircle2 size={15} /><input aria-label={`Answer for question ${index + 1}`} value={question.answer} onChange={(event) => { const questions = [...activeWorksheet.questions]; questions[index] = { ...question, answer: event.target.value }; setActiveWorksheet({ ...activeWorksheet, questions }); }} /></div>}</div><button className="icon-button delete-question" aria-label={`Delete question ${index + 1}`} onClick={() => setActiveWorksheet({ ...activeWorksheet, questions: activeWorksheet.questions.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={16} /></button></article>)}
          <button className="add-question" onClick={() => setActiveWorksheet({ ...activeWorksheet, questions: [...activeWorksheet.questions, { question: "", type: "short_answer", options: [], answer: "" }] })}><Plus size={16} /> Add a question</button>
          {showAnswers && <section className="print-answer-key"><h2>Answer key</h2>{activeWorksheet.questions.map((question, index) => <p key={index}><strong>{index + 1}.</strong> {question.answer}</p>)}</section>}
        </section><aside className="editor-sidebar"><div className="side-card"><span className="side-card-label">READY TO SHARE?</span><h3>Your worksheet, your call.</h3><p>Give your class a link and see their results roll in as they submit.</p>{activeWorksheet.published && <button className="button button-primary full" onClick={() => void shareWorksheet(activeWorksheet)}><Share2 size={16} /> Copy student link</button>}{!activeWorksheet.published && <button className="button button-primary full" onClick={() => void shareWorksheet(activeWorksheet)}><Share2 size={16} /> Publish worksheet</button>}{activeWorksheet.share_code && <div className="share-code-block"><span>CLASS CODE</span><strong>{activeWorksheet.share_code}</strong><a href={`/s/${activeWorksheet.share_code}`} target="_blank" rel="noreferrer">Preview student view <ArrowRight size={13} /></a>{activeWorksheet.published && <button className="close-link-button" onClick={() => void closeWorksheet(activeWorksheet)}>Close student link</button>}</div>}</div><div className="side-card compact"><div className="side-title"><Settings2 size={17} /> Worksheet settings</div><label className="toggle-row"><span>Allow retries</span><input type="checkbox" checked={activeWorksheet.retries_allowed} onChange={(event) => setActiveWorksheet({ ...activeWorksheet, retries_allowed: event.target.checked })} /></label><div className="metadata-row"><span>Difficulty</span><span className="pill">{activeWorksheet.difficulty}</span></div><div className="metadata-row"><span>Created</span><span>{shortDate(activeWorksheet.created_at)}</span></div></div><button className="button button-light full save-button" onClick={() => void saveWorksheet(activeWorksheet)} disabled={loading}>{loading ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} Save changes</button></aside></div></main>{notice && <div className="toast"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message"><X size={15} /></button></div>}</div>;
  }

  if (authLoading) return <div className="loading-page"><span className="brand-mark"><BookOpenCheck size={20} /></span><LoaderCircle size={20} className="spin" /></div>;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><BookOpenCheck size={18} /></span><span>classkit</span></div>
      <div className="workspace-label"><span className="workspace-divider" /><span>Teacher workspace</span><ChevronDown size={14} /></div>
      <div className="topbar-right"><a className="student-access-link" href="/join">Have a class code? <ArrowRight size={13} /></a><button className="icon-button theme-toggle" onClick={() => setDarkSetting(!darkSetting)} aria-label="Toggle dark mode">{darkSetting ? <Sun size={17} /> : <Moon size={17} />}</button>{!demoMode && profile ? <><span className="topbar-email">{profile.email}</span><button className="icon-button" title="Sign out" onClick={() => void logout()}><LogOut size={17} /></button><span className="avatar">{profile.email?.slice(0, 2).toUpperCase()}</span></> : <button className="button button-light sign-in-button" onClick={() => { setAuthMode("login"); setAuthOpen(true); }}>{demoMode ? "Connect account" : "Sign in"}</button>}</div>
    </header>
    <div className="app-body">
      <aside className="sidebar">
        <button className="new-worksheet-button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Create worksheet <span>⌘ K</span></button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav">
          <button className={view === "overview" ? "nav-item active" : "nav-item"} onClick={() => setView("overview")}><Grid2X2 size={18} /> Overview</button>
          <button className={view === "worksheets" ? "nav-item active" : "nav-item"} onClick={() => setView("worksheets")}><FileText size={18} /> My worksheets <span className="nav-count">{worksheets.length}</span></button>
          <button className={view === "results" ? "nav-item active" : "nav-item"} onClick={() => setView("results")}><BarChart3 size={18} /> Class results</button>
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Lightbulb size={16} /></div><strong>A little inspiration</strong><p>Try “fractions” for a ready-to-share math warm-up.</p><button onClick={() => { setForm({ ...form, subject: "Math", topic: "Fractions", grade: "5" }); setCreateOpen(true); }}>Try it out <ArrowRight size={13} /></button></div><div className="free-tag"><ShieldCheck size={15} /> Free for every classroom</div></div>
      </aside>

      <main className="main-content">
        <div className="mobile-header"><button className="icon-button" aria-label="Open workspace menu" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}><Menu size={20} /></button><span className="brand-mark"><BookOpenCheck size={17} /></span> classkit</div>
        {mobileMenuOpen && <nav className="mobile-nav"><button onClick={() => { setView("overview"); setMobileMenuOpen(false); }}><Grid2X2 size={17} /> Overview</button><button onClick={() => { setView("worksheets"); setMobileMenuOpen(false); }}><FileText size={17} /> My worksheets</button><button onClick={() => { setView("results"); setMobileMenuOpen(false); }}><BarChart3 size={17} /> Class results</button><button onClick={() => { setMobileMenuOpen(false); setCreateOpen(true); }}><Plus size={17} /> Create worksheet</button></nav>}
        {demoMode && <div className="demo-banner"><div><Sparkles size={16} /><span><strong>You’re exploring demo mode.</strong> Worksheets are saved in this browser only. Connect Supabase to enable secure sharing and teacher accounts.</span></div><button onClick={() => { setAuthMode("signup"); setAuthOpen(true); }}>Set up account <ArrowRight size={14} /></button></div>}
        {notice && <div className="notice-banner"><CircleHelp size={16} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}
        {view === "overview" && <section className="view-content">
          <div className="welcome-row"><div><div className="eyebrow">{todayLabel}</div><h1>A good day to make<br className="mobile-break" /> something <span>click.</span></h1><p className="welcome-subtitle">A little practice goes a long way. What are we learning today?</p></div><button className="button button-primary hero-cta" onClick={() => setCreateOpen(true)}><Plus size={17} /> Make a worksheet</button></div>
          <div className="stat-grid"><div className="stat-card"><div className="stat-top"><span>Worksheets made</span><div className="stat-icon blue"><FileText size={17} /></div></div><div className="stat-value">{worksheets.length.toString().padStart(2, "0")}<span className="stat-note">in your library</span></div><div className="stat-foot"><span className="stat-trend">↑ {publishedCount} shared</span><span>all time</span></div></div><div className="stat-card"><div className="stat-top"><span>Student submissions</span><div className="stat-icon peach"><Users size={17} /></div></div><div className="stat-value">{completedCount.toString().padStart(2, "0")}<span className="stat-note">across your classes</span></div><div className="stat-foot"><span>{completedCount ? "Your class is showing up" : "Share a worksheet to get started"}</span></div></div><div className="stat-card"><div className="stat-top"><span>Class average</span><div className="stat-icon green"><BarChart3 size={17} /></div></div><div className="stat-value">{gradedSubmissions.length ? `${average}%` : "—"}<span className="stat-note">{gradedSubmissions.length ? "overall score" : "waiting for results"}</span></div><div className="stat-foot"><span>{gradedSubmissions.length ? `${gradedSubmissions.length} students graded` : "The good stuff is coming"}</span></div></div></div>
          <div className="content-grid"><section className="panel worksheet-panel"><div className="panel-header"><div><h2>Recently made</h2><p>Your latest little learning moments</p></div><button className="text-button" onClick={() => setView("worksheets")}>See all <ArrowRight size={14} /></button></div>
              {worksheets.length ? <div className="worksheet-table"><div className="table-head"><span>WORKSHEET</span><span>GRADE</span><span>SHARED</span><span>STUDENTS</span><span></span></div>{worksheets.slice(0, 4).map((worksheet, index) => <div className="worksheet-row" key={worksheet.id}><div className="worksheet-name-cell"><div className={`subject-icon subject-${index % 4}`}>{worksheet.subject.toLowerCase() === "science" ? <FlaskConical size={16} /> : worksheet.subject.toLowerCase() === "english" ? <BookOpenCheck size={16} /> : <Zap size={16} />}</div><div><button className="worksheet-title" onClick={() => setActiveWorksheet(worksheet)}>{worksheet.title}</button><span className="row-subtitle">{worksheet.subject} · {timeAgo(worksheet.created_at)}</span></div></div><span className="grade-cell">Grade {worksheet.grade}</span><span>{worksheet.published ? <span className="status-pill shared"><span /> Shared</span> : <span className="status-pill draft"><span /> Draft</span>}</span><span className="student-cell">{worksheet.submissions ?? submissions.filter((item) => item.worksheet_id === worksheet.id).length}<span> students</span></span><button className="icon-button row-menu" aria-label={`Open ${worksheet.title}`} onClick={() => setActiveWorksheet(worksheet)}><MoreHorizontal size={18} /></button></div>)}</div> : <div className="empty-state"><div className="empty-art"><BookOpenCheck size={28} /></div><h3>Your first worksheet starts here.</h3><p>Pick a topic, choose a grade, and we’ll take it from there.</p><button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create your first one</button></div>}
            </section>
            <aside className="right-rail"><div className="tip-card"><div className="tip-top"><span className="tip-spark"><Sparkles size={16} /></span><span>THE CLASSKIT WAY</span></div><h3>Made for real classrooms, not perfect ones.</h3><p>Every worksheet is yours to tweak. Make it yours before it makes its way to your class.</p><div className="tip-decoration"><span /><span /><span /><span /><span /></div></div><div className="activity-card"><div className="activity-heading"><h3>Latest activity</h3><span className="live-dot" /></div>{submissions.length ? submissions.slice(0, 3).map((item) => <div className="activity-item" key={item.id}><div className="activity-avatar">{item.student_name.slice(0, 1).toUpperCase()}</div><div><strong>{item.student_name}</strong><span>turned in an assignment</span></div><time>{timeAgo(item.created_at)}</time></div>) : <div className="activity-empty"><Clock3 size={18} /><span>When your students submit, you’ll find them here.</span></div>}</div></aside></div>
          <div className="bottom-note"><span className="note-star">✳</span> Good teaching takes a village. <span>We’re glad you’re here.</span></div>
        </section>}
        {view === "worksheets" && <section className="view-content secondary-view"><div className="page-heading"><div><div className="eyebrow">YOUR LIBRARY</div><h1>My worksheets</h1><p>Everything you’ve made, all in one place.</p></div><button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create worksheet</button></div><div className="library-toolbar"><div className="search-box"><Search size={16} /><input placeholder="Find a worksheet…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="button button-light"><Filter size={15} /> All subjects <ChevronDown size={14} /></button></div><div className="library-grid">{filteredWorksheets.map((worksheet) => <article className="library-card" key={worksheet.id}><div className="library-card-top"><div className="subject-icon subject-0"><FileText size={17} /></div><button className="icon-button" onClick={() => void deleteWorksheet(worksheet)} aria-label={`Delete ${worksheet.title}`}><MoreHorizontal size={18} /></button></div><span className="library-subject">{worksheet.subject} <span>·</span> Grade {worksheet.grade}</span><button className="library-title" onClick={() => setActiveWorksheet(worksheet)}>{worksheet.title}</button><p>{worksheet.questions.length} questions <span>·</span> {worksheet.difficulty}</p><div className="library-card-footer"><span className={worksheet.published ? "status-pill shared" : "status-pill draft"}><span />{worksheet.published ? "Shared" : "Draft"}</span><button className="icon-button" onClick={() => setActiveWorksheet(worksheet)} aria-label="Edit worksheet"><ChevronRight size={18} /></button></div></article>)}</div>{filteredWorksheets.length === 0 && <div className="empty-state"><h3>No worksheets found.</h3><p>Try another search, or make something new.</p></div>}</section>}
        {view === "results" && <section className="view-content secondary-view">
          <div className="page-heading"><div><div className="eyebrow">THE BIG PICTURE</div><h1>Class results</h1><p>Little insights to help you see what’s sticking.</p></div><button className="button button-light" onClick={exportCsv} disabled={!submissions.length}><ArrowDownToLine size={16} /> Export CSV</button></div>
          <div className="results-stats">
            <div className="stat-card"><div className="stat-top"><span>Submissions</span><div className="stat-icon blue"><ClipboardCheck size={17} /></div></div><div className="stat-value">{completedCount}</div></div>
            <div className="stat-card"><div className="stat-top"><span>Class average</span><div className="stat-icon green"><BarChart3 size={17} /></div></div><div className="stat-value">{gradedSubmissions.length ? `${average}%` : "—"}</div></div>
            <div className="stat-card"><div className="stat-top"><span>Highest</span><div className="stat-icon green"><CheckCircle2 size={17} /></div></div><div className="stat-value">{gradedSubmissions.length ? `${Math.max(...gradedSubmissions.map((item) => Math.round(item.score / item.total * 100)))}%` : "—"}</div></div>
            <div className="stat-card"><div className="stat-top"><span>Lowest</span><div className="stat-icon peach"><BarChart3 size={17} /></div></div><div className="stat-value">{gradedSubmissions.length ? `${Math.min(...gradedSubmissions.map((item) => Math.round(item.score / item.total * 100)))}%` : "—"}</div></div>
            <div className="stat-card"><div className="stat-top"><span>Worksheets shared</span><div className="stat-icon peach"><Share2 size={17} /></div></div><div className="stat-value">{publishedCount}</div></div>
          </div>
          <div className="panel results-panel"><div className="panel-header"><div><h2>Student submissions</h2><p>Each student’s latest work, in one spot.</p></div><button className="button button-light" onClick={exportCsv} disabled={!submissions.length}><Download size={15} /> Download CSV</button></div>
            {submissions.length ? <div className="worksheet-table results-table"><div className="table-head"><span>STUDENT</span><span>WORKSHEET</span><span>SCORE</span><span>SUBMITTED</span><span></span></div>{submissions.map((item) => { const worksheet = worksheets.find((entry) => entry.id === item.worksheet_id); return <div className={`worksheet-row ${item.needs_review ? "needs-review-row" : ""}`} key={item.id} role={item.needs_review ? "button" : undefined} tabIndex={item.needs_review ? 0 : undefined} onClick={item.needs_review ? () => { setManualReview(item); setGradeDraft(item.manual_scores ?? {}); } : undefined} onKeyDown={item.needs_review ? (event) => { if (event.key === "Enter" || event.key === " ") { setManualReview(item); setGradeDraft(item.manual_scores ?? {}); } } : undefined}><div className="worksheet-name-cell"><div className="activity-avatar">{item.student_name.slice(0, 1).toUpperCase()}</div><div><strong>{item.student_name}</strong><span className="row-subtitle">{item.section || "Student"}</span></div></div><span>{worksheet?.title ?? "Worksheet"}</span><span className="score-badge">{item.needs_review ? "Review answers" : `${item.score}/${item.total} · ${Math.round(item.score / item.total * 100)}%`}</span><span>{shortDate(item.created_at)}</span><ChevronRight size={16} /></div> })}</div> : <div className="empty-state"><div className="empty-art"><BarChart3 size={27} /></div><h3>The best insights come from trying.</h3><p>Share a worksheet with your class. Their results will show up here.</p><button className="button button-primary" onClick={() => setView("worksheets")}>Browse worksheets <ArrowRight size={15} /></button></div>}
          </div>
          <div className="panel missed-panel"><div className="panel-header"><div><h2>Questions to revisit</h2><p>Concepts your class may need a little more time with.</p></div></div>{questionMisses.length ? <div className="missed-list">{questionMisses.map((item) => <div className="missed-item" key={item.key}><div><span>{item.title}</span><strong>{item.question}</strong></div><b>{Math.round(item.missed / item.total * 100)}% missed</b></div>)}</div> : <p className="muted-copy">{submissions.length ? "No missed objective questions yet. Nice work, class!" : "Question-level insights will appear as students complete their worksheets."}</p>}</div>
        </section>}
      </main>
    </div>
    {manualReview && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManualReview(null); }}><section className="grade-modal" role="dialog" aria-modal="true" aria-labelledby="grade-title"><div className="modal-header"><div><div className="eyebrow">TEACHER REVIEW</div><h2 id="grade-title">{manualReview.student_name}’s short answers</h2><p className="modal-lede">Use your judgment to mark each response. Your score updates as you grade.</p></div><button className="icon-button" onClick={() => setManualReview(null)} aria-label="Close"><X size={18} /></button></div>{worksheets.find((item) => item.id === manualReview.worksheet_id)?.questions.map((question, index) => question.type === "short_answer" && <article className="manual-grade-item" key={index}><span className="review-number">QUESTION {index + 1}</span><p>{question.question}</p><div className="student-response"><span>STUDENT RESPONSE</span><strong>{manualReview.answers[index] || "No answer provided"}</strong></div><div className="student-response reference-answer"><span>REFERENCE ANSWER</span><strong>{question.answer}</strong></div><div className="grade-choices"><button className={gradeDraft[String(index)] === true ? "grade-choice selected" : "grade-choice"} onClick={() => setGradeDraft((current) => ({ ...current, [String(index)]: true }))}><Check size={15} /> Correct</button><button className={gradeDraft[String(index)] === false ? "grade-choice incorrect selected" : "grade-choice incorrect"} onClick={() => setGradeDraft((current) => ({ ...current, [String(index)]: false }))}><X size={15} /> Incorrect</button></div></article>)}<div className="modal-footer"><span>Score updates your class results immediately.</span><button className="button button-primary" onClick={() => void saveManualGrades(gradeDraft)}><Check size={15} /> Save grades</button></div></section></div>}
    {createOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}><section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-header"><div className="modal-icon"><Sparkles size={18} /></div><button className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Close"><X size={18} /></button></div><div className="eyebrow">A FRESH PAGE</div><h2 id="create-title">Let’s make a worksheet.</h2><p className="modal-lede">A topic is all we need to get started. You can edit every question before sharing.</p>{demoMode && <p className="demo-generation-note">Local demo mode only generates arithmetic questions. Connect Supabase and configure <code>GROQ_API_KEY</code> to create AI worksheets for other subjects.</p>}<form onSubmit={(event) => void createWorksheet(event)}><div className="form-grid"><label className="field"><span>Subject</span><select value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })}><option>Math</option><option>English</option><option>Science</option><option>History</option><option>Other</option></select></label><label className="field"><span>Grade level</span><select value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Grade {index + 1}</option>)}</select></label></div><label className="field"><span>What are we learning?</span><input autoFocus placeholder="e.g. Fractions, the water cycle, persuasive writing" value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} maxLength={160} /></label><div className="form-grid"><label className="field"><span>Number of questions</span><select value={form.number} onChange={(event) => setForm({ ...form, number: Number(event.target.value) })}>{[5, 10, 15, 20].map((number) => <option key={number} value={number}>{number} questions</option>)}</select></label><label className="field"><span>Difficulty</span><select value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}><option>Easy</option><option>Medium</option><option>Hard</option></select></label></div><fieldset className="type-field"><legend>Question types <span>Pick as many as you like</span></legend><div className="type-chips">{TYPES.map((type) => <button className={form.types.includes(type) ? "type-chip selected" : "type-chip"} type="button" key={type} onClick={() => toggleType(type)}>{form.types.includes(type) && <Check size={13} />}{QUESTION_TYPE_LABELS[type]}</button>)}</div></fieldset>{notice && <p className="form-error" role="alert">{notice}</p>}<div className="modal-footer"><span><ShieldCheck size={14} /> Your questions are always yours to edit.</span><button className="button button-primary" type="submit" disabled={loading}>{loading ? <><LoaderCircle size={16} className="spin" /> Creating…</> : <><Sparkles size={16} /> Generate worksheet <ArrowRight size={15} /></>}</button></div></form></section></div>}
    {authOpen && <div className="modal-backdrop"><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="icon-button auth-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={18} /></button><div className="modal-icon"><GraduationCap size={19} /></div><div className="eyebrow">YOUR CLASSROOM, YOUR WAY</div><h2 id="auth-title">{authMode === "signup" ? "Make a little room." : "Welcome back."}</h2><p className="modal-lede">{demoMode ? "Connect your Supabase project to unlock secure teacher accounts and student sharing." : authMode === "signup" ? "Create your free teacher account and keep every worksheet in one place." : "Sign in to pick up where you left off."}</p>{demoMode ? <div className="setup-instructions"><strong>Quick setup</strong><p>Add these environment variables in Vercel Project Settings and in a local <code>.env.local</code> file:</p><code>NEXT_PUBLIC_SUPABASE_URL<br />NEXT_PUBLIC_SUPABASE_ANON_KEY<br />SUPABASE_SERVICE_ROLE_KEY</code><p>Then run the setup script at <code>supabase/schema.sql</code> in your Supabase SQL editor.</p><a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase <ArrowRight size={14} /></a></div> : <form onSubmit={(event) => void handleAuth(event)}><label className="field"><span>Email address</span><input name="email" type="email" autoComplete="email" required placeholder="you@school.edu" /></label><label className="field"><span>Password</span><input name="password" type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={8} required placeholder="At least 8 characters" /></label>{authError && <p className="form-error">{authError}</p>}<button className="button button-primary full auth-submit" disabled={loading}>{loading ? <LoaderCircle size={16} className="spin" /> : authMode === "signup" ? "Create free account" : "Sign in"} <ArrowRight size={15} /></button><button type="button" className="auth-switch" onClick={() => { setAuthError(""); setAuthMode(authMode === "signup" ? "login" : "signup"); }}>{authMode === "signup" ? "Already have an account? Sign in" : "New to Classkit? Create a free account"}</button></form>}</section></div>}
    {notice && !createOpen && !activeWorksheet && <div className="toast"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message"><X size={15} /></button></div>}
  </div>;
}
