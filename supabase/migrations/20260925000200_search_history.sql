-- Per-user search history, read and written directly from the browser by
-- frontend/auth.js using the public anon key. RLS policies scope every row
-- to its owner so one signed-in user can never see or delete another's
-- history.

create table if not exists public.search_history (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  question   text not null,
  lang       text default 'en',
  location   text,
  topic      text,
  created_at timestamptz not null default now()
);

create index if not exists search_history_user_time
  on public.search_history (user_id, created_at desc);

alter table public.search_history enable row level security;

create policy "Users can select own search history"
  on public.search_history for select
  using (auth.uid() = user_id);

create policy "Users can insert own search history"
  on public.search_history for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own search history"
  on public.search_history for delete
  using (auth.uid() = user_id);
