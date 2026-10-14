import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type LessonPlanRequest = {
  subject?: unknown;
  grade?: unknown;
  topic?: unknown;
  objectives?: unknown;
  durationMinutes?: unknown;
  language?: unknown;
  studentLevel?: unknown;
  resources?: unknown;
};

type LessonPlan = {
  title: string;
  topic: string;
  learning_objectives: string[];
  required_materials: string[];
  warm_up_activity: string;
  teaching_activities: { title: string; instructions: string; duration_minutes: number }[];
  concept_explanation: string;
  participation_activities: string[];
  assessment_questions: string[];
  homework: string;
  summary: string;
  follow_up_activities: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maximum = 2000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isTextList(value: unknown, minimum: number, maximum: number): value is string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && value.every((item) => isText(item, 1000));
}

function validatePlan(value: unknown, duration: number): LessonPlan | null {
  if (!isRecord(value)
    || !isText(value.title, 160)
    || !isText(value.topic, 160)
    || !isTextList(value.learning_objectives, 2, 8)
    || !isTextList(value.required_materials, 1, 12)
    || !isText(value.warm_up_activity)
    || !Array.isArray(value.teaching_activities)
    || value.teaching_activities.length < 2
    || value.teaching_activities.length > 10
    || !isText(value.concept_explanation, 3000)
    || !isTextList(value.participation_activities, 1, 8)
    || !isTextList(value.assessment_questions, 2, 10)
    || !isText(value.homework)
    || !isText(value.summary)
    || !isTextList(value.follow_up_activities, 1, 8)) return null;

  const activities: LessonPlan["teaching_activities"] = [];
  for (const activity of value.teaching_activities) {
    if (!isRecord(activity)
      || !isText(activity.title, 120)
      || !isText(activity.instructions)
      || typeof activity.duration_minutes !== "number"
      || !Number.isInteger(activity.duration_minutes)
      || activity.duration_minutes < 1
      || activity.duration_minutes > duration) return null;
    activities.push({
      title: activity.title.trim(),
      instructions: activity.instructions.trim(),
      duration_minutes: activity.duration_minutes,
    });
  }
  if (activities.reduce((sum, activity) => sum + activity.duration_minutes, 0) !== duration) return null;

  return {
    title: value.title.trim(),
    topic: value.topic.trim(),
    learning_objectives: value.learning_objectives.map((item) => item.trim()),
    required_materials: value.required_materials.map((item) => item.trim()),
    warm_up_activity: value.warm_up_activity.trim(),
    teaching_activities: activities,
    concept_explanation: value.concept_explanation.trim(),
    participation_activities: value.participation_activities.map((item) => item.trim()),
    assessment_questions: value.assessment_questions.map((item) => item.trim()),
    homework: value.homework.trim(),
    summary: value.summary.trim(),
    follow_up_activities: value.follow_up_activities.map((item) => item.trim()),
  };
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "Sign in before generating a lesson plan." }, { status: 401 });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI lesson planning is not configured. Add GROQ_API_KEY to the server environment." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json() as unknown;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  const input = body as LessonPlanRequest;

  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const grade = typeof input.grade === "string" ? input.grade.trim() : "";
  const topic = typeof input.topic === "string" ? input.topic.trim() : "";
  const objectives = typeof input.objectives === "string" ? input.objectives.trim() : "";
  const durationMinutes = input.durationMinutes;
  const language = input.language;
  const studentLevel = input.studentLevel;
  const resources = typeof input.resources === "string" ? input.resources.trim() : "";

  if (!isText(subject, 80) || !isText(grade, 40) || !isText(topic, 160)
    || (typeof input.objectives !== "string" || input.objectives.length > 2000)
    || typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240
    || (language !== "English" && language !== "Urdu")
    || (studentLevel !== "Beginner" && studentLevel !== "Intermediate" && studentLevel !== "Advanced")
    || (typeof input.resources !== "string" || input.resources.length > 1000)) {
    return NextResponse.json({ error: "Complete each field with valid values. Lesson duration must be between 15 and 240 minutes." }, { status: 400 });
  }

  const brief = [
    `Subject: ${subject}`,
    `Grade/class: ${grade}`,
    `Topic/chapter: ${topic}`,
    `Teacher's learning objectives: ${objectives || "Derive clear, measurable objectives from the topic."}`,
    `Lesson duration: ${durationMinutes} minutes`,
    `Teaching language: ${language}`,
    `Student level: ${studentLevel}`,
    `Available teaching resources: ${resources || "Assume only common classroom supplies; do not require unavailable technology."}`,
  ].join("\n");
  const prompt = `Prepare a complete, practical lesson plan suitable for a real teacher to deliver.

LESSON BRIEF
${brief}

QUALITY REQUIREMENTS
- Write every generated section, including activities and questions, in ${language}.
- Keep every section aligned with the specified grade, student level, objectives, and available resources.
- Give concrete teacher and student actions; avoid generic advice.
- Make the teaching activity durations add up to exactly ${durationMinutes} minutes. The warm-up is included in that total; represent its allocated time as the first teaching activity titled "Introduction and warm-up" and keep warm_up_activity as the details for that activity.
- Required materials should be specific and feasible. Do not assume internet or devices unless included in resources.
- Assessment questions must directly check the learning objectives. Homework and follow-up activities must be age-appropriate.

OUTPUT CONTRACT
Return only a JSON object with these keys:
{"title":"...","topic":"...","learning_objectives":["..."],"required_materials":["..."],"warm_up_activity":"...","teaching_activities":[{"title":"...","instructions":"...","duration_minutes":10}],"concept_explanation":"...","participation_activities":["..."],"assessment_questions":["..."],"homework":"...","summary":"...","follow_up_activities":["..."]}
Use 2-8 objectives, 1-12 materials, 2-10 teaching activities, 1-8 participation activities, 2-10 assessment questions, and 1-8 follow-up activities. Activity durations must be positive whole minutes and total exactly ${durationMinutes}. Do not include markdown or extra keys.`;

  let lastError = "The AI response did not match the lesson-plan format.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          temperature: attempt === 0 ? 0.4 : 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are an experienced, practical lesson designer. Return accurate, age-appropriate teaching plans in the required JSON format." },
            { role: "user", content: attempt === 0 ? prompt : `${prompt}\n\nPlease correct the previous response: ${lastError}` },
          ],
        }),
        signal: AbortSignal.timeout(50_000),
      });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          return NextResponse.json({ error: "The lesson-planning service is temporarily unavailable. Your form entries are still here; please try again shortly." }, { status: 502 });
        }
        return NextResponse.json({ error: `AI lesson-plan generation failed (${response.status}). Check the server-side GROQ_API_KEY and model configuration.` }, { status: 502 });
      }
      const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        lastError = "The AI returned an empty response.";
        continue;
      }
      const parsed: unknown = JSON.parse(content);
      const plan = validatePlan(parsed, durationMinutes);
      if (plan) return NextResponse.json({ plan });
      lastError = "The AI response was incomplete or activity durations did not add up to the lesson duration.";
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return NextResponse.json({ error: "Lesson-plan generation timed out. Your form entries are still here; please try again." }, { status: 504 });
      }
      lastError = error instanceof SyntaxError ? "The AI response was not valid JSON." : "The AI service could not be reached.";
    }
  }
  return NextResponse.json({ error: `${lastError} Your form entries are still here; please try generating again.` }, { status: 502 });
}
