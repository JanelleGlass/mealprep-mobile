-- Tasks: one-off to-dos and the backlog (This week / Soon / Someday / Paused),
-- replacing the per-day '__todo' lists inside the RoutinesLog preference blob.
-- Run in the Supabase SQL Editor after 011. Safe to re-run.
--
-- Why a real table and not another user_preferences blob: a blob is saved whole,
-- so an edit from one place overwrites an edit from another. Claude (claude.ai,
-- through the Supabase connector) adds and updates tasks too, so every task is
-- its own row and nobody's change can wipe out anyone else's.

create table if not exists tasks (
  id          bigint generated always as identity primary key,
  title       text        not null,
  -- one of the AREAS keys in js/ui/tasks.js; anything unknown shows under Inbox
  area        text        not null default 'inbox',
  bucket      text        not null default 'now'
                check (bucket in ('now', 'next', 'later', 'paused')),
  due         date,
  note        text        not null default '',
  done        boolean     not null default false,
  done_at     timestamptz,
  -- how many times the due date was pushed later ("move to tomorrow" or an edit)
  deferrals   integer     not null default 0,
  -- 'app' | 'claude' | 'import'
  source      text        not null default 'app',
  -- offline outbox dedupe, same pattern as food_log_entries
  client_id   text        unique,
  -- the Master List id (t01…) for rows that came from the import
  legacy_id   text        unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_open_due_idx on tasks (done, due);

create or replace function tasks_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  -- done_at follows done, so neither the app nor Claude has to remember it
  if new.done and not coalesce(old.done, false) and new.done_at is null then
    new.done_at := now();
  elsif not new.done then
    new.done_at := null;
  end if;
  -- count a push later, whoever made it
  if old.due is not null and new.due is not null and new.due > old.due then
    new.deferrals := old.deferrals + 1;
  end if;
  return new;
end $$;

drop trigger if exists tasks_touch on tasks;
create trigger tasks_touch before update on tasks
  for each row execute function tasks_touch();

-- Same access rule as every other table: the one signed-in account (sign-ups
-- are turned off) can do anything.
alter table tasks enable row level security;
drop policy if exists owner_all_tasks on tasks;
create policy owner_all_tasks on tasks for all to authenticated using (true) with check (true);
