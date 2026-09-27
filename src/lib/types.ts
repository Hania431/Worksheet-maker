export type QuestionType = "mcq" | "true_false" | "fill_blank" | "short_answer";

export type Question = {
  question: string;
  type: QuestionType;
  options: string[];
  answer: string;
  explanation?: string;
};

export type Worksheet = {
  id: string;
  title: string;
  subject: string;
  topic: string;
  grade: string;
  difficulty: string;
  questions: Question[];
  published: boolean;
  share_code: string | null;
  retries_allowed: boolean;
  created_at: string;
  submissions?: number;
};

export type Submission = {
  id: string;
  worksheet_id: string;
  student_name: string;
  section: string | null;
  answers: string[];
  score: number;
  total: number;
  needs_review: boolean;
  manual_scores?: Record<string, boolean>;
  created_at: string;
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  true_false: "True or false",
  fill_blank: "Fill in the blank",
  short_answer: "Short answer",
};
