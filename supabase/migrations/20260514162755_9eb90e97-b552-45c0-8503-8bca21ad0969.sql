
-- Schedule (singleton row id=1)
create table public.tower_schedule (
  id integer primary key default 1,
  interval_minutes integer not null default 30,
  duration_seconds integer not null default 60,
  start_hour integer not null default 6,
  end_hour integer not null default 19,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint tower_schedule_singleton check (id = 1)
);
insert into public.tower_schedule (id) values (1);

-- Manual pH/EC/TDS readings
create table public.tower_readings (
  id uuid primary key default gen_random_uuid(),
  measured_at timestamptz not null default now(),
  ph numeric,
  tds numeric,
  ec numeric,
  notes text default '',
  created_at timestamptz not null default now()
);
create index tower_readings_measured_at_idx on public.tower_readings (measured_at desc);

-- Latest live status (singleton)
create table public.tower_status (
  id integer primary key default 1,
  pump_on boolean not null default false,
  flowing boolean not null default false,
  reservoir_temp_c numeric,
  tower_temp_c numeric,
  water_level text not null default 'MEDIUM',
  fault text,
  last_run_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint tower_status_singleton check (id = 1),
  constraint tower_status_level check (water_level in ('LOW','MEDIUM','FULL'))
);
insert into public.tower_status (id) values (1);

-- Pump cycle log
create table public.tower_pump_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  duration_seconds integer,
  flowed boolean,
  fault text
);
create index tower_pump_log_started_at_idx on public.tower_pump_log (started_at desc);

-- Permissive RLS (single beginner tower, no auth)
alter table public.tower_schedule enable row level security;
alter table public.tower_readings enable row level security;
alter table public.tower_status enable row level security;
alter table public.tower_pump_log enable row level security;

create policy "anon read schedule" on public.tower_schedule for select using (true);
create policy "anon update schedule" on public.tower_schedule for update using (true) with check (true);

create policy "anon read readings" on public.tower_readings for select using (true);
create policy "anon insert readings" on public.tower_readings for insert with check (true);
create policy "anon delete readings" on public.tower_readings for delete using (true);

create policy "anon read status" on public.tower_status for select using (true);
create policy "anon update status" on public.tower_status for update using (true) with check (true);

create policy "anon read pump log" on public.tower_pump_log for select using (true);
create policy "anon insert pump log" on public.tower_pump_log for insert with check (true);

-- Realtime
alter publication supabase_realtime add table public.tower_status;
alter publication supabase_realtime add table public.tower_schedule;
alter publication supabase_realtime add table public.tower_readings;
