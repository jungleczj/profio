alter table public.portfolio_submissions
add column if not exists full_name text not null default '';
