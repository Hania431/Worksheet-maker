"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Copy, LoaderCircle, Pencil, Plus, Printer, Save, Trash2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { featureStorageError } from "@/lib/feature-errors";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_SETTINGS: TimetableSettings = {
  schoolName: "",
  workingDays: [0, 1, 2, 3, 4],
  schoolStart: "08:00",
  schoolEnd: "15:00",
  periodMinutes: 45,
  breakStart: "",
  breakEnd: "",
  lunchStart: "",
  lunchEnd: "",
  classes: [],
  subjects: [],
};

type TimetableSettings = {
  schoolName: string;
  workingDays: number[];
  schoolStart: string;
  schoolEnd: string;
  periodMinutes: number;
  breakStart: string;
  breakEnd: string;
  lunchStart: string;
  lunchEnd: string;
  classes: string[];
  subjects: string[];
};

type TimetableEntry = {
  id: string;
  entry_date: string;
  is_recurring: boolean;
  entry_type: "lesson" | "break" | "free";
  subject: string;
  class_grade: string;
  teacher_name: string;
  starts_at: string;
  ends_at: string;
  room: string;
  notes: string;
};

type EntryForm = Omit<TimetableEntry, "id">;
type ScheduleBlock =
  | { kind: "entry"; entry: TimetableEntry; startsAt: string }
  | { kind: "configured-break"; label: string; startsAt: string; endsAt: string };

function toDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mondayFor(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function addDays(date: Date, days: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

function dayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

function parseCommaList(value: string) {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
}

function timeValue(time: string) {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function displayTime(time: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${time.slice(0, 5)}:00`));
}

function weekRangeLabel(start: Date) {
  const end = addDays(start, 6);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function normalizeSettings(value: unknown): TimetableSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_SETTINGS;
  const settings = value as Partial<TimetableSettings>;
  const workingDays = Array.isArray(settings.workingDays)
    ? settings.workingDays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
    : DEFAULT_SETTINGS.workingDays;
  const classes = Array.isArray(settings.classes) ? settings.classes.filter((item): item is string => typeof item === "string") : [];
  const subjects = Array.isArray(settings.subjects) ? settings.subjects.filter((item): item is string => typeof item === "string") : [];
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    workingDays,
    classes,
    subjects,
    periodMinutes: typeof settings.periodMinutes === "number" && settings.periodMinutes > 0 ? settings.periodMinutes : DEFAULT_SETTINGS.periodMinutes,
  };
}

function emptyEntry(date: string): EntryForm {
  return { entry_date: date, is_recurring: true, entry_type: "lesson", subject: "", class_grade: "", teacher_name: "", starts_at: "08:00", ends_at: "08:45", room: "", notes: "" };
}

function scheduleBlocks(entries: TimetableEntry[], settings: TimetableSettings): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = entries.map((entry) => ({
    kind: "entry",
    entry,
    startsAt: entry.starts_at.slice(0, 5),
  }));
  if (settings.breakStart && settings.breakEnd) {
    blocks.push({ kind: "configured-break", label: "Break", startsAt: settings.breakStart, endsAt: settings.breakEnd });
  }
  if (settings.lunchStart && settings.lunchEnd) {
    blocks.push({ kind: "configured-break", label: "Lunch", startsAt: settings.lunchStart, endsAt: settings.lunchEnd });
  }
  return blocks.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

export function TimetableManager({
  supabase,
  teacherId,
  onSignIn,
}: {
  supabase: SupabaseClient | null;
  teacherId: string | null;
  onSignIn: () => void;
}) {
  const [settings, setSettings] = useState<TimetableSettings>(DEFAULT_SETTINGS);
  const [schoolNameDraft, setSchoolNameDraft] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() => mondayFor(new Date()));
  const [selectedDay, setSelectedDay] = useState(dayIndex(new Date()));
  const [dayView, setDayView] = useState(false);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState<EntryForm>(() => emptyEntry(toDateString(new Date())));
  const [classesText, setClassesText] = useState("");
  const [subjectsText, setSubjectsText] = useState("");
  const weekDates = useMemo(() => DAY_NAMES.map((_, index) => addDays(weekStart, index)), [weekStart]);
  const selectedDate = weekDates[selectedDay] ?? weekDates[0];

  const loadEntries = useCallback(async () => {
    if (!supabase || !teacherId) {
      setEntries([]);
      return;
    }
    setEntriesLoading(true);
    try {
      const from = toDateString(weekStart);
      const through = toDateString(addDays(weekStart, 6));
      const [recurringResult, datedResult] = await Promise.all([
        supabase.from("timetable_entries").select("*").eq("teacher_id", teacherId).eq("is_recurring", true).order("entry_date").order("starts_at"),
        supabase.from("timetable_entries").select("*").eq("teacher_id", teacherId).eq("is_recurring", false).gte("entry_date", from).lte("entry_date", through).order("entry_date").order("starts_at"),
      ]);
      if (recurringResult.error) throw recurringResult.error;
      if (datedResult.error) throw datedResult.error;
      setEntries([...(recurringResult.data ?? []), ...(datedResult.data ?? [])] as TimetableEntry[]);
    } catch (loadError) {
      setError(loadError && typeof loadError === "object" && "code" in loadError
        ? featureStorageError("timetable", "load this week's timetable", loadError as { code?: string; message?: string })
        : loadError instanceof Error ? `Couldn't load this week's timetable: ${loadError.message}` : "Couldn't load this week's timetable.");
    } finally {
      setEntriesLoading(false);
    }
  }, [supabase, teacherId, weekStart]);

  useEffect(() => {
    let active = true;
    async function loadSettings() {
      if (!supabase || !teacherId) {
        setSettingsLoaded(true);
        return;
      }
      try {
        const { data, error: queryError } = await supabase.from("timetable_settings").select("school_name, settings")
          .eq("teacher_id", teacherId).maybeSingle();
        if (queryError) throw queryError;
        if (active && data) {
          const loaded = normalizeSettings(data.settings);
          loaded.schoolName = data.school_name as string;
          setSettings(loaded);
          setSchoolNameDraft(loaded.schoolName);
          setClassesText(loaded.classes.join(", "));
          setSubjectsText(loaded.subjects.join(", "));
        } else if (active) {
          setSettingsOpen(true);
          setSchoolNameDraft("");
          setClassesText("");
          setSubjectsText("");
        }
      } catch (loadError) {
        if (active) setSettingsError(loadError && typeof loadError === "object" && "code" in loadError
          ? featureStorageError("timetable", "load timetable settings", loadError as { code?: string; message?: string })
          : loadError instanceof Error ? `Couldn't load timetable settings: ${loadError.message}` : "Couldn't load timetable settings.");
      } finally {
        if (active) setSettingsLoaded(true);
      }
    }
    void loadSettings();
    return () => { active = false; };
  }, [supabase, teacherId]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const entriesByDate = useMemo(() => {
    const groups: Record<string, TimetableEntry[]> = {};
    for (const date of weekDates) {
      const dateString = toDateString(date);
      const weekday = dayIndex(date);
      groups[dateString] = entries.filter((entry) => entry.is_recurring
        ? dayIndex(new Date(`${entry.entry_date}T12:00:00`)) === weekday
        : entry.entry_date === dateString)
        .map((entry) => entry.is_recurring ? { ...entry, entry_date: dateString } : entry);
    }
    return groups;
  }, [entries, weekDates]);

  function updateSettings<K extends keyof TimetableSettings>(key: K, value: TimetableSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsError("");
    setError("");
    setMessage("");
    if (!supabase || !teacherId) {
      setSettingsError("Sign in to save your timetable settings.");
      return;
    }
    if (timeValue(settings.schoolEnd) <= timeValue(settings.schoolStart)) {
      setSettingsError("School end time must be after the start time.");
      return;
    }
    if (!settings.workingDays.length) {
      setSettingsError("Choose at least one working day.");
      return;
    }
    const breakIsValid = (start: string, end: string) => !start && !end || Boolean(start && end && timeValue(end) > timeValue(start));
    if (!breakIsValid(settings.breakStart, settings.breakEnd) || !breakIsValid(settings.lunchStart, settings.lunchEnd)) {
      setSettingsError("Each break or lunch period needs both times, with the end after the start.");
      return;
    }
    const blocks = [[settings.breakStart, settings.breakEnd], [settings.lunchStart, settings.lunchEnd]]
      .filter(([start, end]) => start && end);
    if (blocks.some(([start, end]) => timeValue(start) < timeValue(settings.schoolStart) || timeValue(end) > timeValue(settings.schoolEnd))) {
      setSettingsError("Break and lunch times must fall within school hours.");
      return;
    }
    if (blocks.length === 2 && timeValue(blocks[0][0]) < timeValue(blocks[1][1]) && timeValue(blocks[0][1]) > timeValue(blocks[1][0])) {
      setSettingsError("Break and lunch times cannot overlap each other.");
      return;
    }

    setSavingSettings(true);
    try {
      const updated: TimetableSettings = {
        ...settings,
        schoolName: schoolNameDraft.trim(),
        classes: parseCommaList(classesText),
        subjects: parseCommaList(subjectsText),
      };
      const { data: existingEntries, error: entriesError } = await supabase.from("timetable_entries")
        .select("entry_date, entry_type, starts_at, ends_at")
        .eq("teacher_id", teacherId);
      if (entriesError) throw entriesError;
      const conflicts = (existingEntries ?? []).filter((entry) => {
        const date = new Date(`${entry.entry_date}T12:00:00`);
        const startsAt = timeValue(entry.starts_at as string);
        const endsAt = timeValue(entry.ends_at as string);
        if (!updated.workingDays.includes(dayIndex(date))
          || startsAt < timeValue(updated.schoolStart)
          || endsAt > timeValue(updated.schoolEnd)) return true;
        if (entry.entry_type === "break") return false;
        return [[updated.breakStart, updated.breakEnd], [updated.lunchStart, updated.lunchEnd]]
          .some(([start, end]) => start && end && startsAt < timeValue(end) && endsAt > timeValue(start));
      });
      if (conflicts.length) {
        setSettingsError("These settings conflict with existing timetable entries. Move or remove those periods before saving.");
        return;
      }
      const { error: saveError } = await supabase.from("timetable_settings").upsert({
        teacher_id: teacherId,
        school_name: updated.schoolName,
        settings: updated,
        updated_at: new Date().toISOString(),
      }, { onConflict: "teacher_id" });
      if (saveError) throw saveError;
      setSettings(updated);
      setSettingsOpen(false);
      setMessage("Timetable settings saved.");
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? `Couldn't save settings: ${saveError.message}` : "Couldn't save settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  function openEntry(entry?: TimetableEntry, duplicate = false) {
    setError("");
    setMessage("");
    if (entry) {
      setEditingId(duplicate ? null : entry.id);
      let duplicateDate = addDays(new Date(`${entry.entry_date}T12:00:00`), 1);
      if (duplicate) {
        for (let offset = 1; offset <= 14; offset += 1) {
          const candidateDate = addDays(new Date(`${entry.entry_date}T12:00:00`), offset);
          const candidate: EntryForm = {
            entry_date: toDateString(candidateDate),
            is_recurring: entry.is_recurring,
            entry_type: entry.entry_type,
            subject: entry.subject,
            class_grade: entry.class_grade,
            teacher_name: entry.teacher_name,
            starts_at: entry.starts_at.slice(0, 5),
            ends_at: entry.ends_at.slice(0, 5),
            room: entry.room,
            notes: entry.notes,
          };
          if (settings.workingDays.includes(dayIndex(candidateDate)) && !hasOverlap(candidate)) {
            duplicateDate = candidateDate;
            break;
          }
        }
      }
      setEntryForm({
        entry_date: duplicate ? toDateString(duplicateDate) : entry.entry_date,
        is_recurring: entry.is_recurring,
        entry_type: entry.entry_type,
        subject: entry.subject,
        class_grade: entry.class_grade,
        teacher_name: entry.teacher_name,
        starts_at: entry.starts_at.slice(0, 5),
        ends_at: entry.ends_at.slice(0, 5),
        room: entry.room,
        notes: entry.notes,
      });
    } else {
      setEditingId(null);
      const date = toDateString(selectedDate);
      const start = settings.schoolStart || "08:00";
      const defaultEnd = timeValue(start) + settings.periodMinutes;
      const end = `${String(Math.floor(defaultEnd / 60)).padStart(2, "0")}:${String(defaultEnd % 60).padStart(2, "0")}`;
      setEntryForm({ ...emptyEntry(date), starts_at: start, ends_at: end });
    }
    setEntryOpen(true);
  }

  function hasOverlap(candidate: EntryForm, excludeId?: string) {
    const candidateDate = new Date(`${candidate.entry_date}T12:00:00`);
    const scheduledOverlap = entries.some((entry) => {
      if (entry.id === excludeId) return false;
      const existingDate = new Date(`${entry.entry_date}T12:00:00`);
      const sameScheduleDay = entry.is_recurring || candidate.is_recurring
        ? dayIndex(existingDate) === dayIndex(candidateDate)
        : entry.entry_date === candidate.entry_date;
      return sameScheduleDay
        && entry.starts_at.slice(0, 5) < candidate.ends_at
        && entry.ends_at.slice(0, 5) > candidate.starts_at;
    });
    if (scheduledOverlap || candidate.entry_type === "break") return scheduledOverlap;
    return [[settings.breakStart, settings.breakEnd], [settings.lunchStart, settings.lunchEnd]]
      .some(([start, end]) => start && end && candidate.starts_at < end && candidate.ends_at > start);
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!supabase || !teacherId) {
      setError("Sign in to save timetable entries.");
      return;
    }
    if (!entryForm.subject.trim() || (entryForm.entry_type === "lesson" && !entryForm.class_grade.trim())) {
      setError("Enter a subject and class/grade before saving this period.");
      return;
    }
    if (!entryForm.entry_date || Number.isNaN(new Date(`${entryForm.entry_date}T12:00:00`).getTime())) {
      setError("Choose a valid date for this period.");
      return;
    }
    if (timeValue(entryForm.ends_at) <= timeValue(entryForm.starts_at)) {
      setError("End time must be after start time.");
      return;
    }
    if (timeValue(entryForm.starts_at) < timeValue(settings.schoolStart) || timeValue(entryForm.ends_at) > timeValue(settings.schoolEnd)) {
      setError("Periods must fall within school hours.");
      return;
    }
    if (hasOverlap(entryForm, editingId ?? undefined)) {
      setError("This period overlaps another entry. Choose a different time or day.");
      return;
    }
    if (!settingsLoaded) {
      setError("Timetable settings are still loading. Try again shortly.");
      return;
    }
    if (!settings.workingDays.includes(dayIndex(new Date(`${entryForm.entry_date}T12:00:00`)))) {
      setError("Choose one of your selected working days.");
      return;
    }

    setSavingEntry(true);
    try {
      const { data, error: saveError } = await supabase.from("timetable_entries")
        .upsert({ ...(editingId ? { id: editingId } : {}), teacher_id: teacherId, ...entryForm, updated_at: new Date().toISOString() })
        .select("*")
        .single();
      if (saveError) throw saveError;
      setEntries((current) => [...current.filter((entry) => entry.id !== data.id), data as TimetableEntry]
        .sort((left, right) => left.entry_date.localeCompare(right.entry_date) || left.starts_at.localeCompare(right.starts_at)));
      setWeekStart(mondayFor(new Date(`${entryForm.entry_date}T12:00:00`)));
      setSelectedDay(dayIndex(new Date(`${entryForm.entry_date}T12:00:00`)));
      setEntryOpen(false);
      setMessage(editingId ? "Timetable entry updated." : "Timetable entry saved.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Couldn't save this timetable entry.";
      if (saveError && typeof saveError === "object" && "code" in saveError) {
        const code = (saveError as { code?: string }).code;
        setError(message.includes("overlaps") || code === "23P01"
          ? "This period overlaps another entry. Choose a different time or day."
          : featureStorageError("timetable", "save this timetable entry", saveError as { code?: string; message?: string }));
      } else {
        setError(message.includes("overlaps") ? "This period overlaps another entry. Choose a different time or day." : `Couldn't save this timetable entry: ${message}`);
      }
    } finally {
      setSavingEntry(false);
    }
  }

  async function deleteEntry(entry: TimetableEntry) {
    if (!supabase || !window.confirm(`Delete ${entry.subject} on ${new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString()}?`)) return;
    setError("");
    setMessage("");
    try {
      const { error: deleteError } = await supabase.from("timetable_entries").delete().eq("id", entry.id).eq("teacher_id", teacherId);
      if (deleteError) throw deleteError;
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setMessage("Timetable entry deleted.");
    } catch (deleteError) {
      setError(deleteError && typeof deleteError === "object" && "code" in deleteError
        ? featureStorageError("timetable", "delete this timetable entry", deleteError as { code?: string; message?: string })
        : deleteError instanceof Error ? `Couldn't delete this timetable entry: ${deleteError.message}` : "Couldn't delete this timetable entry.");
    }
  }

  async function copyDay(sourceDate: Date, targetIndex: number) {
    if (!supabase || !teacherId) return;
    const sourceDateString = toDateString(sourceDate);
    const targetDate = weekDates[targetIndex];
    if (!targetDate) return;
    const targetDateString = toDateString(targetDate);
    const sourceEntries = entriesByDate[sourceDateString] ?? [];
    if (!sourceEntries.length) {
      setError("There are no entries to copy from this day.");
      return;
    }
    const copies: EntryForm[] = sourceEntries.map((entry) => ({
      entry_date: targetDateString,
      is_recurring: entry.is_recurring,
      entry_type: entry.entry_type,
      subject: entry.subject,
      class_grade: entry.class_grade,
      teacher_name: entry.teacher_name,
      starts_at: entry.starts_at.slice(0, 5),
      ends_at: entry.ends_at.slice(0, 5),
      room: entry.room,
      notes: entry.notes,
    }));
    if (copies.some((candidate) => hasOverlap(candidate))) {
      setError("The destination day already has an overlapping period. No entries were copied.");
      return;
    }
    setError("");
    setMessage("");
    try {
      const { data, error: copyError } = await supabase.from("timetable_entries")
        .insert(copies.map((entry) => ({ ...entry, teacher_id: teacherId })))
        .select("*");
      if (copyError) throw copyError;
      setEntries((current) => [...current, ...(data as TimetableEntry[])]
        .sort((left, right) => left.entry_date.localeCompare(right.entry_date) || left.starts_at.localeCompare(right.starts_at)));
      setSelectedDay(targetIndex);
      setMessage(`Copied ${copies.length} ${copies.length === 1 ? "entry" : "entries"} to ${DAY_NAMES[targetIndex]}.`);
    } catch (copyError) {
      const message = copyError instanceof Error ? copyError.message : "Copy failed.";
      if (copyError && typeof copyError === "object" && "code" in copyError) {
        const code = (copyError as { code?: string }).code;
        setError(message.includes("overlaps") || code === "23P01"
          ? "The destination day already has an overlapping period. No entries were copied."
          : featureStorageError("timetable", "copy this day", copyError as { code?: string; message?: string }));
      } else {
        setError(message.includes("overlaps") ? "The destination day already has an overlapping period. No entries were copied." : `Couldn't copy this day: ${message}`);
      }
    }
  }

  function setWeek(offset: number) {
    setWeekStart((current) => addDays(current, offset * 7));
    setError("");
    setMessage("");
  }

  function moveSelectedDay(offset: number) {
    const next = selectedDay + offset;
    if (next < 0) {
      setWeekStart((current) => addDays(current, -7));
      setSelectedDay(6);
    } else if (next > 6) {
      setWeekStart((current) => addDays(current, 7));
      setSelectedDay(0);
    } else {
      setSelectedDay(next);
    }
  }

  const dayEntries = entriesByDate[toDateString(selectedDate)] ?? [];

  return (
    <section className="view-content secondary-view timetable-manager">
      <div className="page-heading">
        <div><div className="eyebrow">YOUR SCHOOL WEEK</div><h1>My Timetable</h1><p>{settings.schoolName || "Set up your school details and weekly schedule."}</p></div>
        <div className="timetable-heading-actions"><button className="button button-light" onClick={() => setSettingsOpen(true)}><Pencil size={15} /> Edit setup</button><button className="button button-light" onClick={() => window.print()} disabled={!teacherId}><Printer size={15} /> Print / PDF</button><button className="button button-primary" onClick={() => openEntry()} disabled={!teacherId}><Plus size={16} /> Add period</button></div>
      </div>
      {!teacherId && <div className="feature-notice"><CalendarDays size={17} /><span>Sign in to set up and save a private timetable.</span><button className="button button-primary" onClick={onSignIn}>Sign in</button></div>}
      {error && <p className="feature-error" role="alert">{error}</p>}
      {message && <p className="feature-success" role="status">{message}</p>}
      {settingsError && <p className="feature-error" role="alert">{settingsError}</p>}

      <div className="panel timetable-controls">
        <div className="week-navigation"><button className="icon-button" aria-label="Previous week" onClick={() => setWeek(-1)}><ChevronLeft size={19} /></button><strong>{weekRangeLabel(weekStart)}</strong><button className="icon-button" aria-label="Next week" onClick={() => setWeek(1)}><ChevronRight size={19} /></button><button className="button button-light" onClick={() => { setWeekStart(mondayFor(new Date())); setSelectedDay(dayIndex(new Date())); }}>Today</button></div>
        <div className="timetable-view-toggle"><button className={!dayView ? "selected" : ""} onClick={() => setDayView(false)}>Week</button><button className={dayView ? "selected" : ""} onClick={() => setDayView(true)}>Day</button></div>
      </div>

      {!settingsLoaded || entriesLoading ? <div className="panel feature-empty"><LoaderCircle size={18} className="spin" /> Loading timetable…</div> : dayView ? (
        <section className="panel timetable-day-view">
          <div className="day-view-heading"><button className="button button-light" onClick={() => moveSelectedDay(-1)}><ArrowLeft size={14} /> Previous day</button><div><span className="eyebrow">{weekRangeLabel(weekStart)}</span><h2>{DAY_NAMES[selectedDay]}, {selectedDate.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</h2></div><button className="button button-light" onClick={() => moveSelectedDay(1)}>Next day <ArrowRight size={14} /></button></div>
          <div className="day-view-toolbar"><label><span>Go to day</span><select value={selectedDay} onChange={(event) => setSelectedDay(Number(event.target.value))}>{DAY_NAMES.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label><button className="button button-primary" onClick={() => openEntry()} disabled={!settings.workingDays.includes(selectedDay)}><Plus size={15} /> Add to {DAY_NAMES[selectedDay]}</button></div>
          {settings.workingDays.includes(selectedDay) ? <TimetableDayContents date={selectedDate} entries={dayEntries} settings={settings} onEdit={(entry) => openEntry(entry)} onDelete={(entry) => void deleteEntry(entry)} onDuplicate={(entry) => openEntry(entry, true)} onCopyDay={(targetIndex) => void copyDay(selectedDate, targetIndex)} /> : <p className="feature-empty">This is not a selected working day. Change your setup to add periods here.</p>}
        </section>
      ) : (
        <div className="timetable-week-wrap">
          <div className="timetable-week-grid">
            {weekDates.map((date, index) => {
              const dateString = toDateString(date);
              const active = settings.workingDays.includes(index);
              const entriesForDay = entriesByDate[dateString] ?? [];
              const dayBlocks = scheduleBlocks(entriesForDay, settings);
              return <section className={`timetable-day-column ${active ? "" : "non-working"}`} key={dateString}>
                <button className={`timetable-day-heading ${selectedDay === index ? "selected" : ""}`} onClick={() => { setSelectedDay(index); setDayView(true); }}>
                  <span>{DAY_NAMES[index].slice(0, 3)}</span><strong>{date.getDate()}</strong>
                </button>
                {active ? <div className="timetable-day-cards">
                  {dayBlocks.map((block, blockIndex) => block.kind === "entry"
                    ? <TimetableEntryCard entry={block.entry} key={block.entry.id} onEdit={() => openEntry(block.entry)} onDelete={() => void deleteEntry(block.entry)} onDuplicate={() => openEntry(block.entry, true)} />
                    : <ConfiguredBreak key={`${dateString}-break-${blockIndex}`} label={block.label} startsAt={block.startsAt} endsAt={block.endsAt} />)}
                  {!entriesForDay.length && !settings.breakStart && !settings.lunchStart && <span className="timetable-no-periods">No periods yet</span>}
                  <button className="add-day-entry" onClick={() => { setSelectedDay(index); setDayView(true); openEntryForDate(date); }}>+ Add period</button>
                </div> : <span className="day-off-label">Day off</span>}
              </section>;
            })}
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop">
          <section className="create-modal timetable-settings-modal" role="dialog" aria-modal="true" aria-labelledby="timetable-settings-title">
            <div className="modal-header"><div><div className="eyebrow">TIMETABLE SETUP</div><h2 id="timetable-settings-title">Your school week</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close setup">×</button></div>
            {settingsError && <p className="feature-error" role="alert">{settingsError}</p>}
            <form onSubmit={(event) => void saveSettings(event)}>
              <label className="field"><span>School or teacher name</span><input maxLength={120} value={schoolNameDraft} onChange={(event) => setSchoolNameDraft(event.target.value)} placeholder="e.g. Greenfield School" /></label>
              <fieldset className="working-day-field"><legend>Working days</legend><div>{DAY_NAMES.map((day, index) => <label key={day}><input type="checkbox" checked={settings.workingDays.includes(index)} onChange={(event) => updateSettings("workingDays", event.target.checked ? [...settings.workingDays, index].sort() : settings.workingDays.filter((item) => item !== index))} /> {day.slice(0, 3)}</label>)}</div></fieldset>
              <div className="lesson-input-grid">
                <label className="field"><span>School starts</span><input type="time" required value={settings.schoolStart} onChange={(event) => updateSettings("schoolStart", event.target.value)} /></label>
                <label className="field"><span>School ends</span><input type="time" required value={settings.schoolEnd} onChange={(event) => updateSettings("schoolEnd", event.target.value)} /></label>
                <label className="field"><span>Period duration</span><select value={settings.periodMinutes} onChange={(event) => updateSettings("periodMinutes", Number(event.target.value))}>{[30, 35, 40, 45, 50, 55, 60, 75, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
                <label className="field"><span>Break start and end</span><div className="timetable-time-pair"><input type="time" aria-label="Break start" value={settings.breakStart} onChange={(event) => updateSettings("breakStart", event.target.value)} /><input type="time" aria-label="Break end" value={settings.breakEnd} onChange={(event) => updateSettings("breakEnd", event.target.value)} /></div></label>
                <label className="field"><span>Lunch start and end</span><div className="timetable-time-pair"><input type="time" aria-label="Lunch start" value={settings.lunchStart} onChange={(event) => updateSettings("lunchStart", event.target.value)} /><input type="time" aria-label="Lunch end" value={settings.lunchEnd} onChange={(event) => updateSettings("lunchEnd", event.target.value)} /></div></label>
                <label className="field"><span>Classes / grades taught <small>Comma-separated</small></span><input value={classesText} onChange={(event) => setClassesText(event.target.value)} placeholder="Grade 4, Grade 5" /></label>
                <label className="field lesson-wide"><span>Subjects taught <small>Comma-separated</small></span><input value={subjectsText} onChange={(event) => setSubjectsText(event.target.value)} placeholder="Math, Science, English" /></label>
              </div>
              <div className="modal-footer"><span>Days and entries are private to your account.</span><button className="button button-primary" type="submit" disabled={savingSettings}>{savingSettings ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} Save setup</button></div>
            </form>
          </section>
        </div>
      )}

      {entryOpen && (
        <div className="modal-backdrop">
          <section className="create-modal timetable-entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
            <div className="modal-header"><div><div className="eyebrow">WEEKLY SCHEDULE</div><h2 id="entry-title">{editingId ? "Edit period" : "Add a period"}</h2></div><button className="icon-button" onClick={() => setEntryOpen(false)} aria-label="Close period form">×</button></div>
            {error && <p className="feature-error" role="alert">{error}</p>}
            <form onSubmit={(event) => void saveEntry(event)}>
              <label className="field"><span>Date</span><input type="date" required value={entryForm.entry_date} onChange={(event) => setEntryForm({ ...entryForm, entry_date: event.target.value })} /></label>
              <label className="timetable-repeat-option"><input type="checkbox" checked={entryForm.is_recurring} onChange={(event) => setEntryForm({ ...entryForm, is_recurring: event.target.checked })} /><span><strong>Repeat every week</strong><small>Clear this for a one-off period on the selected date.</small></span></label>
              <label className="field"><span>Period type</span><select value={entryForm.entry_type} onChange={(event) => setEntryForm({ ...entryForm, entry_type: event.target.value as EntryForm["entry_type"], subject: event.target.value === "break" ? "Break" : event.target.value === "free" ? "Free period" : "" })}><option value="lesson">Lesson</option><option value="break">Break</option><option value="free">Free period</option></select></label>
              <label className="field"><span>{entryForm.entry_type === "lesson" ? "Subject" : "Label"}</span><input required maxLength={100} list="timetable-subject-options" value={entryForm.subject} onChange={(event) => setEntryForm({ ...entryForm, subject: event.target.value })} placeholder={entryForm.entry_type === "lesson" ? "Choose or enter a subject" : "Break or free period"} /><datalist id="timetable-subject-options">{settings.subjects.map((subject) => <option key={subject} value={subject} />)}</datalist></label>
              {entryForm.entry_type === "lesson" && <label className="field"><span>Class / grade</span><input required maxLength={100} list="timetable-class-options" value={entryForm.class_grade} onChange={(event) => setEntryForm({ ...entryForm, class_grade: event.target.value })} placeholder="Choose or enter a class" /><datalist id="timetable-class-options">{settings.classes.map((grade) => <option key={grade} value={grade} />)}</datalist></label>}
              <label className="field"><span>Teacher name <small>Optional</small></span><input maxLength={120} value={entryForm.teacher_name} onChange={(event) => setEntryForm({ ...entryForm, teacher_name: event.target.value })} /></label>
              <div className="timetable-time-pair"><label className="field"><span>Start time</span><input type="time" required value={entryForm.starts_at} onChange={(event) => setEntryForm({ ...entryForm, starts_at: event.target.value })} /></label><label className="field"><span>End time</span><input type="time" required value={entryForm.ends_at} onChange={(event) => setEntryForm({ ...entryForm, ends_at: event.target.value })} /></label></div>
              <label className="field"><span>Room <small>Optional</small></span><input maxLength={100} value={entryForm.room} onChange={(event) => setEntryForm({ ...entryForm, room: event.target.value })} /></label>
              <label className="field"><span>Notes <small>Optional</small></span><textarea rows={3} maxLength={1000} value={entryForm.notes} onChange={(event) => setEntryForm({ ...entryForm, notes: event.target.value })} /></label>
              <div className="modal-footer"><span>Overlapping times on the same day are not allowed.</span><button className="button button-primary" type="submit" disabled={savingEntry}>{savingEntry ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} {editingId ? "Save changes" : "Save period"}</button></div>
            </form>
          </section>
        </div>
      )}
      <div className="timetable-print-footer timetable-print-only">Classkit · {settings.schoolName}</div>
    </section>
  );

  function openEntryForDate(date: Date) {
    setError("");
    setMessage("");
    setEditingId(null);
    const start = settings.schoolStart || "08:00";
    const duration = settings.periodMinutes;
    const endMinute = timeValue(start) + duration;
    setEntryForm({
      ...emptyEntry(toDateString(date)),
      starts_at: start,
      ends_at: `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`,
    });
    setEntryOpen(true);
  }
}

function ConfiguredBreak({ label, startsAt, endsAt }: { label: string; startsAt: string; endsAt: string }) {
  if (!startsAt || !endsAt) return null;
  return <div className="timetable-entry configured-break"><small>{displayTime(startsAt)}–{displayTime(endsAt)}</small><strong>{label}</strong></div>;
}

function TimetableEntryCard({
  entry,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  entry: TimetableEntry;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  return <article className={`timetable-entry entry-${entry.entry_type}`}>
    <div className="timetable-entry-time">{displayTime(entry.starts_at)}–{displayTime(entry.ends_at)}</div>
    <strong>{entry.subject}</strong>
    {entry.class_grade && <span>{entry.class_grade}</span>}
    {entry.teacher_name && <small>Teacher: {entry.teacher_name}</small>}
    {entry.room && <small>Room {entry.room}</small>}
    {entry.notes && <small className="timetable-entry-notes">{entry.notes}</small>}
    <small className="timetable-repeat-label">{entry.is_recurring ? "Every week" : "One-off"}</small>
    <div className="timetable-entry-actions"><button aria-label={`Edit ${entry.subject}`} onClick={onEdit}><Pencil size={13} /></button><button aria-label={`Duplicate ${entry.subject}`} onClick={onDuplicate}><Copy size={13} /></button><button aria-label={`Delete ${entry.subject}`} onClick={onDelete}><Trash2 size={13} /></button></div>
  </article>;
}

function TimetableDayContents({
  date,
  entries,
  settings,
  onEdit,
  onDelete,
  onDuplicate,
  onCopyDay,
}: {
  date: Date;
  entries: TimetableEntry[];
  settings: TimetableSettings;
  onEdit: (entry: TimetableEntry) => void;
  onDelete: (entry: TimetableEntry) => void;
  onDuplicate: (entry: TimetableEntry) => void;
  onCopyDay: (targetIndex: number) => void;
}) {
  const [copyTarget, setCopyTarget] = useState("");
  const blocks = scheduleBlocks(entries, settings);
  return <div className="timetable-day-detail">
    <div className="timetable-day-detail-toolbar"><div className="eyebrow">{entries.length} {entries.length === 1 ? "PERIOD" : "PERIODS"}</div><div><label className="sr-only" htmlFor="copy-day-target">Copy this day to</label><select id="copy-day-target" value={copyTarget} onChange={(event) => setCopyTarget(event.target.value)}><option value="">Copy day to…</option>{DAY_NAMES.map((day, index) => <option key={day} value={index} disabled={index === dayIndex(date) || !settings.workingDays.includes(index)}>{day}</option>)}</select><button className="button button-light" onClick={() => { if (copyTarget) { onCopyDay(Number(copyTarget)); setCopyTarget(""); } }} disabled={!copyTarget}><Copy size={14} /> Copy day</button></div></div>
    {blocks.length ? blocks.map((block, index) => block.kind === "entry"
      ? <TimetableEntryCard key={block.entry.id} entry={block.entry} onEdit={() => onEdit(block.entry)} onDelete={() => onDelete(block.entry)} onDuplicate={() => onDuplicate(block.entry)} />
      : <ConfiguredBreak key={`${toDateString(date)}-break-${index}`} label={block.label} startsAt={block.startsAt} endsAt={block.endsAt} />)
      : <p className="feature-empty">No periods scheduled for this day yet.</p>}
  </div>;
}
