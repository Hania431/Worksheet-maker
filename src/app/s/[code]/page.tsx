"use client";

import { ArrowLeft, ArrowRight, BookOpenCheck, Check, CheckCircle2, CircleHelp, LoaderCircle, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Question, QuestionType, Submission, Worksheet } from "@/lib/types";

const DEMO_WORKSHEETS_KEY = "classkit-demo-worksheets-v2";
const DEMO_SUBMISSIONS_KEY = "classkit-demo-submissions-v1";

type StudentQuestion = { question: string; type: QuestionType; options: string[] };
type StudentWorksheet = { id: string; title: string; subject: string; topic: string; grade: string; questions: StudentQuestion[]; retries_allowed: boolean };
type MarkedResult = { question: string; answer: string; correct_answer: string; correct: boolean | null; explanation: string | null };
type SubmissionResult = { score: number; total: number; needs_review: boolean; results: MarkedResult[] };

export default function StudentWorksheetPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const [worksheet, setWorksheet] = useState<StudentWorksheet | null>(null);
  const [demoQuestions, setDemoQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem("classkit-dark-mode") === "true" ? "dark" : "light";
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/share/${encodeURIComponent(code)}`)
      .then(async (response) => {
        const payload = await response.json() as { worksheet?: StudentWorksheet; error?: string };
        if (response.status === 503) {
          const local = localStorage.getItem(DEMO_WORKSHEETS_KEY);
          const entries = local ? JSON.parse(local) as Worksheet[] : [];
          const demoWorksheet = entries.find((item) => item.share_code === code.toUpperCase() && item.published);
          if (demoWorksheet) {
            if (!cancelled) {
              setDemoQuestions(demoWorksheet.questions);
              setWorksheet({
                id: demoWorksheet.id, title: demoWorksheet.title, subject: demoWorksheet.subject,
                topic: demoWorksheet.topic, grade: demoWorksheet.grade,
                questions: demoWorksheet.questions.map(({ question, type, options }) => ({ question, type, options })),
                retries_allowed: demoWorksheet.retries_allowed,
              });
              setAnswers(Array(demoWorksheet.questions.length).fill(""));
            }
            return;
          }
        }
        if (!response.ok || !payload.worksheet) throw new Error(payload.error ?? "This worksheet isn't available.");
        if (!cancelled) {
          setWorksheet(payload.worksheet);
          setAnswers(Array(payload.worksheet.questions.length).fill(""));
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "We couldn't load this worksheet.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) setStarted(true);
  }

  function setAnswer(index: number, value: string) {
    setAnswers((current) => current.map((answer, itemIndex) => itemIndex === index ? value : answer));
  }

  async function submitAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!worksheet || !name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      if (demoQuestions) {
        const previousText = localStorage.getItem(DEMO_SUBMISSIONS_KEY);
        const previous = previousText ? JSON.parse(previousText) as Submission[] : [];
        const duplicate = previous.some((item) => item.worksheet_id === worksheet.id
          && item.student_name.trim().toLowerCase() === name.trim().toLowerCase()
          && (item.section ?? "").trim().toLowerCase() === section.trim().toLowerCase());
        if (!worksheet.retries_allowed && duplicate) throw new Error("A submission with this name and class has already been recorded.");
        const score = demoQuestions.reduce((total, question, index) => {
          if (question.type === "short_answer") return total;
          const answer = answers[index].trim().toLowerCase().replace(/,/g, "");
          const expected = question.answer.trim().toLowerCase().replace(/,/g, "");
          const correct = Boolean(question.type === "fill_blank" && answer
            && Number.isFinite(Number(answer)) && Number.isFinite(Number(expected))
            ? Number(answer) === Number(expected) : answer === expected);
          return total + (correct ? 1 : 0);
        }, 0);
        const needsReview = demoQuestions.some((question) => question.type === "short_answer");
        const submission: Submission = {
          id: crypto.randomUUID(), worksheet_id: worksheet.id, student_name: name.trim(),
          section: section.trim() || null, answers, score, total: demoQuestions.length,
          needs_review: needsReview, manual_scores: {}, created_at: new Date().toISOString(),
        };
        localStorage.setItem(DEMO_SUBMISSIONS_KEY, JSON.stringify([...previous, submission]));
        setResult({
          score, total: demoQuestions.length, needs_review: needsReview,
          results: demoQuestions.map((question, index) => {
            const answer = answers[index].trim().toLowerCase().replace(/,/g, "");
            const expected = question.answer.trim().toLowerCase().replace(/,/g, "");
            const numericMatch = Boolean(question.type === "fill_blank" && answer
              && Number.isFinite(Number(answer)) && Number.isFinite(Number(expected))
              && Number(answer) === Number(expected));
            return {
              question: question.question, answer: answers[index], correct_answer: question.answer,
              correct: question.type === "short_answer" ? null : numericMatch || answer === expected,
              explanation: question.explanation ?? null,
            };
          }),
        });
        return;
      }
      const response = await fetch(`/api/share/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_name: name.trim(), section: section.trim(), answers }),
      });
      const payload = await response.json() as SubmissionResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Your answers couldn't be submitted. Please try again.");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your answers couldn't be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="student-page"><StudentBrand /><div className="student-loading"><LoaderCircle className="spin" size={22} /><span>Getting your worksheet ready…</span></div></main>;
  if (error && !worksheet) return <main className="student-page"><StudentBrand /><section className="student-error"><div className="student-error-icon"><CircleHelp size={23} /></div><h1>Hmm, we can’t find that one.</h1><p>{error}</p><a className="button button-light" href="/join"><ArrowLeft size={15} /> Enter another class code</a></section></main>;
  if (!worksheet) return null;

  return <main className="student-page">
    <StudentBrand />
    <section className="student-content">
      <div className="student-progress-label"><span>{worksheet.subject} <span>·</span> Grade {worksheet.grade}</span><span>CLASS CODE&nbsp; {code.toUpperCase()}</span></div>
      <div className="student-title-row"><div><h1>{worksheet.title}</h1><p>{worksheet.questions.length} questions <span>·</span> Take your time</p></div><span className="student-leaf"><BookOpenCheck size={19} /></span></div>
      {result ? <section className="student-results">
        <div className="result-celebration">{result.needs_review ? <CircleHelp size={26} /> : result.score === result.total ? <CheckCircle2 size={27} /> : <BookOpenCheck size={25} />}</div>
        <div className="eyebrow">THAT&apos;S A WRAP</div>
        <h2>{result.needs_review ? "Nicely done. Your teacher will take a look." : result.score === result.total ? "Look at you go!" : "Good work showing up."}</h2>
        <p className="result-summary">{result.needs_review ? "Your short answers need a little teacher review." : "Here’s how you did — and a chance to learn a little more."}</p>
        <div className="score-card"><strong>{result.score}<span>/{result.total}</span></strong><span>{result.needs_review ? "objective answers correct · score may change" : "questions correct"}</span></div>
        <div className="answer-review">{result.results.map((item, index) => <article className="review-item" key={`${index}-${item.question}`}><div className={item.correct === null ? "review-mark review-pending" : item.correct ? "review-mark review-correct" : "review-mark review-wrong"}>{item.correct === null ? <CircleHelp size={15} /> : item.correct ? <Check size={15} /> : <X size={15} />}</div><div><span className="review-number">QUESTION {index + 1}</span><p>{item.question}</p><span className={item.correct === null ? "your-answer pending" : item.correct ? "your-answer right" : "your-answer wrong"}>Your answer: {item.answer || "No answer"}{item.correct === null ? " · your teacher will review this" : ""}</span>{item.correct === false && <span className="correct-answer">Answer: {item.correct_answer}</span>}{item.explanation && <span className="result-explanation">{item.explanation}</span>}</div></article>)}</div>
        <Link className="student-back-link" href="/join"><ArrowLeft size={14} /> Back to class code</Link>
      </section> : !started ? <section className="student-intro">
        <div className="intro-card"><div className="intro-icon"><CheckCircle2 size={20} /></div><div><strong>A few things before you begin</strong><p>Your answers are saved when you submit. You’ll see your score right away.</p></div></div>
        <form onSubmit={begin}><label className="field"><span>Your name</span><input autoFocus maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} placeholder="First and last name" autoComplete="name" /></label><label className="field"><span>Class or section <em>optional</em></span><input maxLength={80} value={section} onChange={(event) => setSection(event.target.value)} placeholder="e.g. Room 12" /></label><button className="button button-primary full student-start" type="submit">Let’s get started <ArrowRight size={16} /></button></form>
        <Link className="student-back-link" href="/join"><ArrowLeft size={14} /> That’s not my worksheet</Link>
      </section> : <form className="student-questions" onSubmit={(event) => void submitAnswers(event)}>
        <div className="student-greeting">You’ve got this, <strong>{name.split(" ")[0]}.</strong></div>
        {worksheet.questions.map((question, index) => <article className="student-question" key={index}><div className="student-question-head"><span>QUESTION {String(index + 1).padStart(2, "0")}</span><span>{question.type === "short_answer" ? "Your thoughts" : "1 point"}</span></div><h2>{question.question}</h2>
          {question.type === "mcq" && <div className="student-options">{question.options.map((option, optionIndex) => <button type="button" key={optionIndex} className={answers[index] === option ? "student-option selected" : "student-option"} onClick={() => setAnswer(index, option)}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}{answers[index] === option && <Check size={15} />}</button>)}</div>}
          {question.type === "true_false" && <div className="student-options true-false-options">{["True", "False"].map((option) => <button type="button" key={option} className={answers[index] === option ? "student-option selected" : "student-option"} onClick={() => setAnswer(index, option)}><span>{option === "True" ? "T" : "F"}</span>{option}{answers[index] === option && <Check size={15} />}</button>)}</div>}
          {(question.type === "fill_blank" || question.type === "short_answer") && <textarea aria-label={`Your answer to question ${index + 1}`} rows={question.type === "short_answer" ? 3 : 1} value={answers[index]} onChange={(event) => setAnswer(index, event.target.value)} placeholder={question.type === "short_answer" ? "Write a few sentences…" : "Type your answer here…"} />}
        </article>)}
        {error && <div className="student-form-error" role="alert"><CircleHelp size={16} />{error}</div>}
        <div className="student-submit-row"><span><CheckCircle2 size={15} /> You can review your answers after submitting.</span><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? <><LoaderCircle size={16} className="spin" /> Sending…</> : <>Turn it in <ArrowRight size={15} /></>}</button></div>
      </form>}
    </section>
    <footer className="student-footer">Made for curious minds <span>✳</span></footer>
  </main>;
}

function StudentBrand() {
  return <header className="student-top"><Link className="student-brand" href="/join"><span className="brand-mark"><BookOpenCheck size={18} /></span> classkit</Link><span className="student-private"><CheckCircle2 size={14} /> No account needed</span></header>;
}
