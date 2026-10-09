-- Argus Field — run this ONCE in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Each record is a JSON document (`data`) plus a few indexed columns for fast lookups.
-- Row Level Security is ON with no policies: the public (anon/publishable) key can read nothing.
-- Only the server, using the secret key, can access these tables.

create table if not exists public.users (
  id          text primary key,
  email       text,
  role        text,
  invite_hash text,
  data        jsonb not null default '{}'::jsonb
);
create unique index if not exists users_email_uq   on public.users (lower(email));
create index        if not exists users_role_idx   on public.users (role);
create index        if not exists users_invite_idx on public.users (invite_hash) where invite_hash is not null;

create table if not exists public.sites (
  id       text primary key,
  owner_id text,                       -- null = company site, otherwise the employee who planned it
  data     jsonb not null default '{}'::jsonb
);
create index if not exists sites_owner_idx on public.sites (owner_id);

create table if not exists public.visits (
  id         text primary key,
  user_id    text not null,
  site_id    text not null,
  status     text not null,
  started_at bigint not null,          -- epoch ms
  data       jsonb not null default '{}'::jsonb,
  route      jsonb                     -- GPS trail, kept apart so list queries stay light
);
create index if not exists visits_user_started_idx on public.visits (user_id, started_at desc);
create index if not exists visits_status_idx       on public.visits (status);
create index if not exists visits_site_idx         on public.visits (site_id);
create index if not exists visits_started_idx      on public.visits (started_at desc);

create table if not exists public.notifications (
  id   text primary key,
  at   bigint not null,
  data jsonb not null default '{}'::jsonb
);
create index if not exists notifications_at_idx on public.notifications (at desc);

create table if not exists public.settings (
  id   text primary key,
  data jsonb not null default '{}'::jsonb
);

alter table public.users         enable row level security;
alter table public.sites         enable row level security;
alter table public.visits        enable row level security;
alter table public.notifications enable row level security;
alter table public.settings      enable row level security;
