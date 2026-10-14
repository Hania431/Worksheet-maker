create extension if not exists pgcrypto;

create table if not exists public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 80),
  grade text not null check (char_length(grade) between 1 and 40),
  topic text not null check (char_length(topic) between 1 and 160),
  inputs jsonb not null default '{}'::jsonb,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lesson_plans_teacher_updated_idx
  on public.lesson_plans (teacher_id, updated_at desc);

alter table public.lesson_plans enable row level security;

drop policy if exists "Teachers manage their lesson plans" on public.lesson_plans;
create policy "Teachers manage their lesson plans" on public.lesson_plans
  for all to authenticated
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

grant select, insert, update, delete on public.lesson_plans to authenticated;

create table if not exists public.timetable_settings (
  teacher_id uuid primary key references auth.users(id) on delete cascade,
  school_name text not null default '',
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.timetable_settings enable row level security;

drop policy if exists "Teachers manage their timetable settings" on public.timetable_settings;
create policy "Teachers manage their timetable settings" on public.timetable_settings
  for all to authenticated
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

grant select, insert, update, delete on public.timetable_settings to authenticated;

create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  is_recurring boolean not null default true,
  entry_type text not null default 'lesson' check (entry_type in ('lesson', 'break', 'free')),
  subject text not null check (char_length(subject) between 1 and 100),
  class_grade text not null default '',
  starts_at time not null,
  ends_at time not null,
  room text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timetable_entry_time_valid check (ends_at > starts_at)
);

create index if not exists timetable_entries_teacher_date_time_idx
  on public.timetable_entries (teacher_id, entry_date, starts_at);
create index if not exists timetable_entries_teacher_weekly_idx
  on public.timetable_entries (teacher_id, starts_at)
  where is_recurring;

alter table public.timetable_entries enable row level security;

drop policy if exists "Teachers manage their timetable entries" on public.timetable_entries;
create policy "Teachers manage their timetable entries" on public.timetable_entries
  for all to authenticated
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

grant select, insert, update, delete on public.timetable_entries to authenticated;

create or replace function public.prevent_timetable_entry_overlap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  teacher_settings jsonb;
  school_start time;
  school_end time;
  block_start time;
  block_end time;
  matching_day integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.teacher_id::text, 0)
  );
  matching_day := extract(isodow from new.entry_date)::integer;

  select settings into teacher_settings
  from public.timetable_settings
  where teacher_id = new.teacher_id;

  if teacher_settings is not null then
    school_start := nullif(teacher_settings ->> 'schoolStart', '')::time;
    school_end := nullif(teacher_settings ->> 'schoolEnd', '')::time;
    if school_start is not null and new.starts_at < school_start then
      raise exception 'Timetable entries must be within school hours.';
    end if;
    if school_end is not null and new.ends_at > school_end then
      raise exception 'Timetable entries must be within school hours.';
    end if;

    block_start := nullif(teacher_settings ->> 'breakStart', '')::time;
    block_end := nullif(teacher_settings ->> 'breakEnd', '')::time;
    if new.entry_type <> 'break' and block_start is not null and block_end is not null
      and new.starts_at < block_end and new.ends_at > block_start then
      raise exception 'This period overlaps the configured break.';
    end if;

    block_start := nullif(teacher_settings ->> 'lunchStart', '')::time;
    block_end := nullif(teacher_settings ->> 'lunchEnd', '')::time;
    if new.entry_type <> 'break' and block_start is not null and block_end is not null
      and new.starts_at < block_end and new.ends_at > block_start then
      raise exception 'This period overlaps configured lunch.';
    end if;
  end if;

  if exists (
    select 1
    from public.timetable_entries existing
    where existing.teacher_id = new.teacher_id
      and (
        (new.is_recurring and existing.is_recurring
          and extract(isodow from existing.entry_date)::integer = matching_day)
        or (new.is_recurring and not existing.is_recurring
          and extract(isodow from existing.entry_date)::integer = matching_day)
        or (not new.is_recurring and not existing.is_recurring and existing.entry_date = new.entry_date)
        or (not new.is_recurring and existing.is_recurring
          and extract(isodow from existing.entry_date)::integer = matching_day)
      )
      and existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing.starts_at < new.ends_at
      and existing.ends_at > new.starts_at
  ) then
    raise exception 'This period overlaps another timetable entry on the same day.'
      using errcode = '23P01';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists timetable_entries_prevent_overlap on public.timetable_entries;
create trigger timetable_entries_prevent_overlap
  before insert or update
  on public.timetable_entries
  for each row execute function public.prevent_timetable_entry_overlap();

revoke all on function public.prevent_timetable_entry_overlap() from public, anon, authenticated;
