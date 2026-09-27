create extension if not exists pgcrypto;

create table if not exists public.worksheets (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  subject text not null,
  topic text not null,
  grade text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  questions jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  share_code text unique,
  retries_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint share_code_published check (published = false or share_code is not null)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  worksheet_id uuid not null references public.worksheets(id) on delete cascade,
  student_name text not null,
  section text,
  answers jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  total integer not null,
  needs_review boolean not null default false,
  manual_scores jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.submissions add column if not exists manual_scores jsonb not null default '{}'::jsonb;

create index if not exists worksheets_teacher_created_idx on public.worksheets(teacher_id, created_at desc);
create index if not exists worksheets_share_code_idx on public.worksheets(share_code) where published;
create index if not exists submissions_worksheet_created_idx on public.submissions(worksheet_id, created_at desc);

alter table public.worksheets enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "Teachers manage their worksheets" on public.worksheets;
create policy "Teachers manage their worksheets" on public.worksheets
  for all to authenticated using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

drop policy if exists "Teachers read submissions for their worksheets" on public.submissions;
create policy "Teachers read submissions for their worksheets" on public.submissions
  for select to authenticated using (
    exists (
      select 1 from public.worksheets
      where worksheets.id = submissions.worksheet_id and worksheets.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers grade submissions for their worksheets" on public.submissions;
create policy "Teachers grade submissions for their worksheets" on public.submissions
  for update to authenticated using (
    exists (
      select 1 from public.worksheets
      where worksheets.id = submissions.worksheet_id and worksheets.teacher_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.worksheets
      where worksheets.id = submissions.worksheet_id and worksheets.teacher_id = auth.uid()
    )
  );

create table if not exists public.generation_usage (
  teacher_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  count integer not null default 0 check (count >= 0),
  primary key (teacher_id, usage_date)
);

alter table public.generation_usage enable row level security;

create or replace function public.consume_generation_quota(p_teacher_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if not exists (select 1 from auth.users where id = p_teacher_id) then
    raise exception 'Invalid teacher';
  end if;
  insert into public.generation_usage (teacher_id, usage_date, count)
  values (p_teacher_id, (now() at time zone 'utc')::date, 1)
  on conflict (teacher_id, usage_date)
  do update set count = public.generation_usage.count + 1
    where public.generation_usage.count < 20
  returning count into current_count;
  return current_count is not null;
end;
$$;

revoke all on function public.consume_generation_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_generation_quota(uuid) to service_role;
grant usage on schema public to service_role;
grant all on public.worksheets, public.submissions, public.generation_usage to service_role;
