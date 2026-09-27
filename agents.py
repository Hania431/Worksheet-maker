import os
import json
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, Process

load_dotenv()

# Groq model
llm = "groq/openai/gpt-oss-120b"


# =========================
# USER INPUT
# =========================

print("\n===== WORKSHEET MAKER =====\n")

subject = input("Enter subject: ")
topic = input("Enter topic: ")
grade = input("Enter grade: ")
number = int(input("Number of questions: "))

difficulty = input("Difficulty (easy/medium/hard): ")


# =========================
# AGENT 1 — GENERATOR
# =========================

generator = Agent(
    role="Worksheet Generator",
    goal="Create accurate and grade-appropriate worksheet questions.",
    backstory=(
        "You are an experienced school teacher. "
        "You create clear, useful and accurate practice questions."
    ),
    llm=llm,
    verbose=True
)


# =========================
# AGENT 2 — VALIDATOR
# =========================

validator = Agent(
    role="Worksheet Validator",
    goal="Check worksheet questions and answers for correctness.",
    backstory=(
        "You are a strict academic reviewer. "
        "You check questions, answers and difficulty "
        "before a worksheet is given to students."
    ),
    llm=llm,
    verbose=True
)


# =========================
# TASK 1 — GENERATE
# =========================

generate_task = Task(
    description=f"""
Create a worksheet with:

Subject: {subject}
Topic: {topic}
Grade: {grade}
Number of questions: {number}
Difficulty: {difficulty}

Create exactly {number} questions.

Use these types:
- MCQ
- True/False
- Fill in the blank

Return ONLY valid JSON.

Format:

[
  {{
    "question": "Question text",
    "type": "mcq",
    "options": ["A", "B", "C", "D"],
    "answer": "A"
  }}
]

For True/False:

[
  {{
    "question": "Question text",
    "type": "true_false",
    "options": ["True", "False"],
    "answer": "True"
  }}
]

For Fill in the blank:

[
  {{
    "question": "Question text",
    "type": "fill_blank",
    "options": [],
    "answer": "correct answer"
  }}
]

Do not add explanations.
Do not add markdown.
Do not add ```json.
""",
    expected_output="A valid JSON array of worksheet questions.",
    agent=generator
)


# =========================
# TASK 2 — VALIDATE
# =========================

validate_task = Task(
    description="""
Review the worksheet created by the Worksheet Generator.

Check:

1. Every question is related to the requested subject and topic.
2. Questions are appropriate for the given grade.
3. Every question has a correct answer.
4. MCQ questions have valid options.
5. True/False questions have True or False as the answer.
6. Fill-in-the-blank questions have a clear answer.
7. There are no duplicate questions.
8. The worksheet contains the requested number of questions.

If something is wrong, fix it.

Return ONLY the corrected JSON.

Use this structure:

[
  {
    "question": "Question text",
    "type": "mcq",
    "options": ["A", "B", "C", "D"],
    "answer": "A"
  }
]

Do not add explanations.
Do not add markdown.
""",
    expected_output="A corrected and validated JSON worksheet.",
    agent=validator,
    context=[generate_task]
)


# =========================
# CREW
# =========================

crew = Crew(
    agents=[generator, validator],
    tasks=[generate_task, validate_task],
    process=Process.sequential,
    verbose=True
)


# =========================
# RUN
# =========================

print("\nGenerating and validating worksheet...\n")

result = crew.kickoff()


# =========================
# GET JSON
# =========================

worksheet_text = str(result).strip()

if worksheet_text.startswith("```"):
    worksheet_text = worksheet_text.replace("```json", "")
    worksheet_text = worksheet_text.replace("```", "")
    worksheet_text = worksheet_text.strip()


try:
    worksheet = json.loads(worksheet_text)

except json.JSONDecodeError:

    print("\nERROR: AI did not return valid JSON.")
    print("\nAI Response:")
    print(worksheet_text)

    exit()


# =========================
# SHOW WORKSHEET
# =========================

print("\n")
print("=" * 50)
print("              WORKSHEET")
print("=" * 50)

print(f"\nSubject: {subject}")
print(f"Topic: {topic}")
print(f"Grade: {grade}")
print(f"Difficulty: {difficulty}\n")


# =========================
# STUDENT ANSWERS
# =========================

user_answers = []

for i, question in enumerate(worksheet, start=1):

    print(f"\nQuestion {i}:")
    print(question["question"])

    if question["type"] == "mcq":

        for option in question["options"]:
            print(option)

        answer = input("\nYour answer: ")

    elif question["type"] == "true_false":

        print("1. True")
        print("2. False")

        answer = input("\nYour answer: ")

        if answer == "1":
            answer = "True"

        elif answer == "2":
            answer = "False"

    else:

        answer = input("\nYour answer: ")

    user_answers.append(answer)


# =========================
# AUTO GRADING
# =========================

score = 0

print("\n")
print("=" * 50)
print("                RESULTS")
print("=" * 50)


for i, question in enumerate(worksheet):

    correct = str(question["answer"]).strip().lower()
    user = str(user_answers[i]).strip().lower()

    if user == correct:

        score += 1
        print(f"\nQuestion {i + 1}: CORRECT")

    else:

        print(f"\nQuestion {i + 1}: WRONG")

    print(f"Your answer: {user_answers[i]}")
    print(f"Correct answer: {question['answer']}")


# =========================
# FINAL SCORE
# =========================

total = len(worksheet)

percentage = (score / total) * 100

print("\n")
print("=" * 50)
print("              FINAL SCORE")
print("=" * 50)

print(f"\nScore: {score}/{total}")
print(f"Percentage: {percentage:.1f}%")