import { NextResponse } from "next/server";
import { getAdminClient, getAuthenticatedUser } from "@/lib/server";
import type { Question, QuestionType } from "@/lib/types";

export const runtime = "nodejs";

const VALID_TYPES: QuestionType[] = ["mcq", "fill_blank", "true_false", "short_answer"];
const VALID_COUNTS = [5, 10, 15, 20];
export const maxDuration = 30;

type RequestBody = {
  subject?: unknown;
  topic?: unknown;
  grade?: unknown;
  number?: unknown;
  difficulty?: unknown;
  types?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateQuestions(
  value: unknown,
  expectedCount: number,
  allowedTypes: QuestionType[],
): { questions: Question[] | null; error: string | null } {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    return { questions: null, error: `Return exactly ${expectedCount} questions.` };
  }
  const questions: Question[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || typeof item.question !== "string" || !item.question.trim()
      || !VALID_TYPES.includes(item.type as QuestionType) || !Array.isArray(item.options)
      || !item.options.every((option) => typeof option === "string" && option.trim())
      || typeof item.answer !== "string" || !item.answer.trim()
      || typeof item.explanation !== "string" || item.explanation.trim().length < 12) {
      return { questions: null, error: `Question ${index + 1} is missing its question, answer, options, or a useful explanation.` };
    }
    const type = item.type as QuestionType;
    const options = item.options as string[];
    if (!allowedTypes.includes(type)) {
      return { questions: null, error: `Question ${index + 1} uses an unselected question type.` };
    }
    if (type === "mcq") {
      const normalizedOptions = options.map((option) => option.trim().toLowerCase());
      if (options.length !== 4 || new Set(normalizedOptions).size !== 4 || !options.includes(item.answer)) {
        return { questions: null, error: `Question ${index + 1} must have four distinct choices and one exact matching correct answer.` };
      }
    }
    if (type === "true_false"
      && (options.length !== 2 || options[0].toLowerCase() !== "true" || options[1].toLowerCase() !== "false"
        || !["true", "false"].includes(item.answer.toLowerCase()))) {
      return { questions: null, error: `Question ${index + 1} must use True and False choices and a matching answer.` };
    }
    if (type !== "mcq" && type !== "true_false" && options.length !== 0) {
      return { questions: null, error: `Question ${index + 1} must have an empty options array.` };
    }
    questions.push({
      question: item.question.trim(),
      type,
      options: options.map((option) => option.trim()),
      answer: item.answer.trim(),
      explanation: item.explanation.trim(),
    });
  }
  const uniqueQuestions = new Set(questions.map((item) => item.question.toLowerCase()));
  if (uniqueQuestions.size !== questions.length) {
    return { questions: null, error: "Questions must be meaningfully distinct; do not repeat or lightly reword the same question." };
  }
  const basePerType = Math.floor(expectedCount / allowedTypes.length);
  const remainder = expectedCount % allowedTypes.length;
  const expectedByType = new Map(allowedTypes.map((type, index) => [type, basePerType + (index < remainder ? 1 : 0)]));
  if (Array.from(expectedByType).some(([type, count]) => questions.filter((item) => item.type === type).length !== count)) {
    return { questions: null, error: "Use the requested balanced type mix: " + Array.from(expectedByType, ([type, count]) => `${type}: ${count}`).join(", ") + "." };
  }
  return { questions, error: null };
}

function mathOperation(topic: string) {
  const normalized = topic.toLowerCase();
  if (/\b(addition|add|sum|plus)\b/.test(normalized)) return "+";
  if (/\b(subtraction|subtract|minus)\b/.test(normalized)) return "-";
  if (/\b(multiplication|multiply|times)\b/.test(normalized)) return "*";
  if (/\b(division|divide)\b/.test(normalized)) return "/";
  return null;
}

function createMathQuestions(topic: string, count: number, difficulty: string, types: QuestionType[]): Question[] | null {
  const operation = mathOperation(topic);
  if (!operation) return null;
  const max = difficulty === "easy" ? 12 : difficulty === "hard" ? 99 : 40;
  return Array.from({ length: count }, (_, index) => {
    const a = 2 + ((index * 17 + 5) % max);
    const b = 1 + ((index * 11 + 3) % max);
    const left = operation === "/" ? a * b : operation === "-" ? Math.max(a, b) : a;
    const right = operation === "-" ? Math.min(a, b) : operation === "/" ? a : b;
    const correct = operation === "+" ? a + b : operation === "-" ? left - right : operation === "*" ? a * b : b;
    const kind = types[index % types.length];
    const isTrue = index % 2 === 0;
    const shownAnswer = isTrue ? correct : correct + 1 + (index % 3);
    const equation = `${left} ${operation} ${right}`;
    if (kind === "mcq") {
      const options = [...new Set([correct, correct + 1, Math.max(0, correct - 1), correct + 3])].slice(0, 4).map(String);
      while (options.length < 4) options.push(String(correct + options.length + 4));
      return { question: `${equation} = ?`, type: kind, options, answer: String(correct), explanation: `${equation} equals ${correct}.` };
    }
    if (kind === "true_false") {
      return { question: `${equation} = ${shownAnswer}`, type: kind, options: ["True", "False"], answer: isTrue ? "True" : "False", explanation: `${equation} equals ${correct}.` };
    }
    if (kind === "short_answer") {
      return { question: `Show how you would solve ${equation}.`, type: kind, options: [], answer: String(correct), explanation: `The result is ${correct}.` };
    }
    return { question: `${equation} = ______`, type: kind, options: [], answer: String(correct), explanation: `${equation} equals ${correct}.` };
  });
}

async function requestAiQuestions(input: { subject: string; topic: string; grade: string; number: number; difficulty: string; types: QuestionType[] }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { questions: null, error: "AI generation is not configured. Add GROQ_API_KEY to your Vercel environment variables." };
  const basePerType = Math.floor(input.number / input.types.length);
  const remainder = input.number % input.types.length;
  const typeCounts = input.types.map((type, index) => `${type}: ${basePerType + (index < remainder ? 1 : 0)}`).join(", ");
  const prompt = `Create a high-quality classroom worksheet, not generic topic prompts.

WORKSHEET BRIEF
- Subject: ${input.subject}
- Exact topic: ${input.topic}
- Student age/level: Grade ${input.grade}
- Difficulty: ${input.difficulty}
- Question count: exactly ${input.number}
- Selected formats: ${input.types.join(", ")}

TEACHING QUALITY
- Assess concrete knowledge or skills central to the exact topic. Plan a range of recall, understanding, and application questions; order them from more accessible to more challenging.
- Make each question self-contained, specific, and answerable from the stated subject and topic. Use realistic examples, source snippets, sentences, data, or scenarios where they help assess the skill. Do not repeat a stem with different wording or use vague prompts such as "What is an important idea?".
- Match vocabulary, reading load, and reasoning to Grade ${input.grade}. Make ${input.difficulty} mean a genuinely appropriate level of complexity, not just a label.
- Keep facts accurate. Do not invent quotations, sources, historical details, or scientific claims. For English/language topics, assess the named reading or language skill; for science/history, use accurate topic-specific concepts and evidence; for other subjects, use the actual discipline's conventions.
- Avoid trick wording, double negatives, clues to the correct answer, "all/none of the above", and ambiguous questions. For multiple choice, make four plausible, distinct distractors based on common misconceptions, with exactly one defensible correct choice.
- Use this exact question-type distribution: ${typeCounts}.
- Every answer must be independently checked against the question. Give a concise explanation that teaches why the answer is correct (not merely "because it is correct"). For short answer, include a clear reference answer and key ideas a teacher should accept.
- Before returning JSON, silently critique your draft like a second experienced teacher: remove vague or repetitive items, verify every factual claim and answer, test every distractor, and rewrite any question that could reasonably have more than one answer.

OUTPUT CONTRACT
Return only a JSON object with a "questions" array containing exactly ${input.number} items. Each item must have "question", "type", "options", "answer", and "explanation".
- "mcq": exactly four distinct string options; answer must exactly equal one option.
- "true_false": options exactly ["True", "False"]; answer exactly "True" or "False".
- "fill_blank" and "short_answer": options must be [] and answer is a concise, gradable reference answer.
Use only selected types: ${input.types.join(", ")}. No markdown or additional keys.`;
  let lastError = "The AI returned an invalid worksheet.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        temperature: attempt === 0 ? 0.45 : 0.25,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are an experienced subject teacher and assessment designer. Prioritize factual accuracy, grade fit, answerability, and educational value. Think through and verify each answer before returning the requested JSON." },
          { role: "user", content: attempt === 0 ? prompt : `${prompt}\n\nREVISE THE PREVIOUS ATTEMPT: ${lastError} Check every question, answer, explanation, and output constraint before responding.` },
        ],
      }),
    });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        return { questions: null, error: "The worksheet service is temporarily busy. Please wait a moment and try again." };
      }
      return { questions: null, error: `AI generation failed (${response.status}). Check the GROQ_API_KEY and model configuration.` };
    }
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      lastError = "The AI returned an empty response.";
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(content);
      const validation = validateQuestions(isRecord(parsed) ? parsed.questions : null, input.number, input.types);
      if (validation.questions) return { questions: validation.questions, error: null };
      lastError = validation.error ?? "The AI response did not contain a valid set of questions.";
    } catch {
      lastError = "The AI response could not be parsed as valid JSON.";
    }
  }
  return { questions: null, error: `${lastError} Please try generating the worksheet again.` };
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "Sign in before generating a worksheet." }, { status: 401 });
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Server database credentials are missing. Add SUPABASE_SERVICE_ROLE_KEY in Vercel settings." }, { status: 503 });

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof body.topic !== "string" || !body.topic.trim() || body.topic.length > 160
    || typeof body.subject !== "string" || body.subject.length > 80
    || typeof body.grade !== "string" || !/^(?:[1-9]|1[0-2])$/.test(body.grade)
    || typeof body.number !== "number" || !VALID_COUNTS.includes(body.number)
    || typeof body.difficulty !== "string" || !["Easy", "Medium", "Hard"].includes(body.difficulty)
    || !Array.isArray(body.types) || body.types.length === 0
    || !body.types.every((type) => VALID_TYPES.includes(type as QuestionType))) {
    return NextResponse.json({ error: "Check the worksheet details and choose a valid question count, grade, difficulty, and question type." }, { status: 400 });
  }
  const types = [...new Set(body.types as QuestionType[])];
  const { data: quotaAllowed, error: quotaError } = await admin.rpc("consume_generation_quota", { p_teacher_id: user.id });
  if (quotaError) return NextResponse.json({ error: `Couldn't verify your generation limit: ${quotaError.message}` }, { status: 503 });
  if (!quotaAllowed) return NextResponse.json({ error: "You’ve reached the 20-worksheet daily limit. Try again tomorrow." }, { status: 429 });

  const mathQuestions = body.subject.toLowerCase() === "math"
    ? createMathQuestions(body.topic.trim(), body.number, body.difficulty.toLowerCase(), types)
    : null;
  if (mathQuestions) return NextResponse.json({ questions: mathQuestions });
  if (body.subject.toLowerCase() === "math" && mathOperation(body.topic.trim())) {
    return NextResponse.json({ error: "The math worksheet couldn't be generated. Please try again." }, { status: 500 });
  }
  const result = await requestAiQuestions({
    subject: body.subject.trim(), topic: body.topic.trim(), grade: body.grade,
    number: body.number, difficulty: body.difficulty.toLowerCase(), types,
  });
  if (!result.questions) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ questions: result.questions });
}
