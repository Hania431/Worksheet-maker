# Classkit planning features

Apply `20261014_lesson_plans_and_timetables.sql` once in the Supabase SQL Editor after the existing `supabase/schema.sql` setup. The migration adds isolated lesson-plan, timetable-settings, and timetable-entry tables. Each table has row-level security policies that restrict access to the authenticated teacher's own records. Timetable entries repeat every week by default; teachers can clear the repeat option for one-off periods. A database trigger rejects overlapping timetable periods and periods outside configured school hours and breaks.

No new environment variables are required. The lesson planner uses the existing server-side `GROQ_API_KEY`; timetable and lesson-plan records use the existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` Supabase client. Keep `SUPABASE_SERVICE_ROLE_KEY` and `GROQ_API_KEY` on the server only.
