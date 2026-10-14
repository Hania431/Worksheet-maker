type DatabaseError = { code?: string; message?: string };

export function featureStorageError(feature: string, action: string, error: DatabaseError) {
  if (error.code === "42P01" || error.code === "PGRST205") {
    return `Couldn't ${action}: the ${feature} database tables are missing. Apply supabase/migrations/20261014_lesson_plans_and_timetables.sql in the Supabase SQL Editor.`;
  }
  if (error.code === "42703" || error.code === "PGRST204") {
    return `Couldn't ${action}: the ${feature} database schema is out of date. Apply the latest feature migration in the Supabase SQL Editor.`;
  }
  return `Couldn't ${action}: ${error.message || "Supabase returned an unspecified database error."}`;
}
