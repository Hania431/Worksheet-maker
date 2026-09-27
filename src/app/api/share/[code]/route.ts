import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/server";
import type { Question, Worksheet } from "@/lib/types";

export const runtime = "nodejs";

type PublicQuestion = Omit<Question, "answer" | "explanation">;

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/,/g, "");
}

function isCorrect(question: Question, answer: string) {
  const entered = normalize(answer);
  const expected = normalize(question.answer);
  if (question.type === "fill_blank") {
    const enteredNumber = Number(entered);
    const expectedNumber = Number(expected);
    if (entered && Number.isFinite(enteredNumber) && Number.isFinite(expectedNumber)) return enteredNumber === expectedNumber;
  }
  return entered === expected;
}

async function findWorksheet(code: string) {
  const admin = getAdminClient();
  if (!admin) return { admin: null, worksheet: null, error: "Student sharing isn't configured yet. Ask your teacher to check the Classkit setup.", status: 503 };
  const { data, error } = await admin.from("worksheets").select("*").eq("share_code", code.toUpperCase()).maybeSingle();
  if (error) return { admin, worksheet: null, error: "We couldn't load this worksheet. Please try again in a moment.", status: 503 };
  if (!data || !data.published) return { admin, worksheet: null, error: "This worksheet isn't available. Check the class code with your teacher.", status: 404 };
  return { admin, worksheet: data as Worksheet, error: null, status: 200 };
}

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const result = await findWorksheet(code);
  if (!result.worksheet) return NextResponse.json({ error: result.error }, { status: result.status });
  const worksheet = result.worksheet;
  const questions: PublicQuestion[] = worksheet.questions.map(({ question, type, options }) => ({ question, type, options }));
  return NextResponse.json({
    worksheet: {
      id: worksheet.id, title: worksheet.title, subject: worksheet.subject, topic: worksheet.topic,
      grade: worksheet.grade, questions, retries_allowed: worksheet.retries_allowed,
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const found = await findWorksheet(code);
  if (!found.worksheet || !found.admin) return NextResponse.json({ error: found.error }, { status: found.status });
  let body: { student_name?: unknown; section?: unknown; answers?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Your answers could not be submitted. Please check the form and try again." }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Your answers could not be submitted. Please try again." }, { status: 400 });
  }
  const studentName = typeof body.student_name === "string" ? body.student_name.trim() : "";
  const section = typeof body.section === "string" ? body.section.trim() : "";
  if (!studentName || studentName.length > 100 || section.length > 80
    || !Array.isArray(body.answers) || body.answers.length !== found.worksheet.questions.length
    || !body.answers.every((answer) => typeof answer === "string" && answer.length <= 2000)) {
    return NextResponse.json({ error: "Please enter your name and answer each question before submitting." }, { status: 400 });
  }

  if (!found.worksheet.retries_allowed) {
    let previousQuery = found.admin.from("submissions").select("id")
      .eq("worksheet_id", found.worksheet.id).ilike("student_name", studentName.replace(/[\\%_]/g, "\\$&"));
    previousQuery = section ? previousQuery.eq("section", section) : previousQuery.is("section", null);
    const { data: previous, error: previousError } = await previousQuery.limit(1);
    if (previousError) return NextResponse.json({ error: `Couldn't check your previous submission: ${previousError.message}` }, { status: 503 });
    if (previous?.length) return NextResponse.json({ error: "A submission with this name and class has already been recorded." }, { status: 409 });
  }

  const answers = body.answers as string[];
  const questions = found.worksheet.questions;
  const score = questions.reduce((total, question, index) => {
    if (question.type === "short_answer") return total;
    return total + (isCorrect(question, answers[index]) ? 1 : 0);
  }, 0);
  const needsReview = questions.some((question) => question.type === "short_answer");
  const { data: submission, error: insertError } = await found.admin.from("submissions").insert({
    worksheet_id: found.worksheet.id, student_name: studentName,
    section: section || null, answers, score, total: questions.length, needs_review: needsReview,
  }).select("id,created_at").single();
  if (insertError) return NextResponse.json({ error: `Couldn't save your submission: ${insertError.message}` }, { status: 503 });

  return NextResponse.json({
    score, total: questions.length, needs_review: needsReview, submission_id: submission.id,
    results: questions.map((question, index) => ({
      question: question.question, answer: answers[index], correct_answer: question.answer,
      correct: question.type === "short_answer" ? null : isCorrect(question, answers[index]),
      explanation: question.explanation ?? null,
    })),
  });
}
