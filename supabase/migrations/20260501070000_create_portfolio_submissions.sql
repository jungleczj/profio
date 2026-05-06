create extension if not exists pgcrypto;

create table if not exists public.portfolio_submissions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  full_name text not null default '',
  email text not null,
  role text not null,
  note text,
  status text not null default 'submitted',
  portfolio_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.portfolio_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.portfolio_submissions(id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_files_submission_id_idx
  on public.portfolio_files(submission_id);

insert into storage.buckets (id, name, public)
values ('portfolio-materials', 'portfolio-materials', false)
on conflict (id) do nothing;

alter table public.portfolio_submissions enable row level security;
alter table public.portfolio_files enable row level security;

-- The app server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Keep these tables private unless you intentionally add public policies.
