-- WeatherGPT backend schema.
-- Only Edge Functions (service role) touch these tables. RLS is on with no
-- policies, so the public anon key cannot read or write anything here.

create table if not exists public.api_cache (
  key        text primary key,
  value      jsonb not null,
  fetched_at timestamptz not null default now()
);

create table if not exists public.cyclone_bulletins (
  id         bigserial primary key,
  active     boolean not null default true,
  simulated  boolean not null default true,
  bulletin   jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_logs (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  ip         text,
  question   text,
  lang       text,
  intent     jsonb,
  location   text,
  latency_ms int,
  from_cache boolean,
  note       text,
  error      text
);

create index if not exists chat_logs_ip_time on public.chat_logs (ip, created_at desc);

alter table public.api_cache         enable row level security;
alter table public.cyclone_bulletins enable row level security;
alter table public.chat_logs         enable row level security;

-- Demo cyclone bulletin (IMD-style fields). Always labelled SIMULATED.
insert into public.cyclone_bulletins (simulated, bulletin)
select
  true,
  '{
    "name": "Cyclone DEMO",
    "basin": "Bay of Bengal",
    "category": "Severe Cyclonic Storm",
    "max_wind_kmh": 110,
    "centre": {"lat": 16.5, "lon": 88.2},
    "landfall_estimate": "Odisha-West Bengal coast in about 36 hours",
    "advisory": "Fishermen should not go to sea. Coastal residents should be ready to move to shelters."
  }'::jsonb
where not exists (
  select 1 from public.cyclone_bulletins where bulletin->>'name' = 'Cyclone DEMO'
);

