-- Per-user preferences (currently: preferred Indian language for the UI
-- and voice/TTS output). Unlike api_cache/cyclone_bulletins/chat_logs, this
-- table is read and written directly by signed-in users via the public
-- anon key, so Row Level Security policies (not just RLS being "on") are
-- required to keep one user's row private from another.

create table if not exists public.user_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  lang       text default 'en',
  updated_at timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

create policy "Users can select own prefs"
  on public.user_prefs for select
  using (auth.uid() = user_id);

create policy "Users can upsert own prefs"
  on public.user_prefs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own prefs"
  on public.user_prefs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
