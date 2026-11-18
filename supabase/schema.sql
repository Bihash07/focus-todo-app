-- Focus cloud sync schema (run once in the Supabase SQL editor)
create table if not exists public.focus_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.focus_state enable row level security;

drop policy if exists "Users read own state" on public.focus_state;
create policy "Users read own state"
  on public.focus_state
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own state" on public.focus_state;
create policy "Users insert own state"
  on public.focus_state
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own state" on public.focus_state;
create policy "Users update own state"
  on public.focus_state
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Enable realtime updates for cross-device sync.
alter publication supabase_realtime add table public.focus_state;
