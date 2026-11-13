-- ---------------------------------------------------------------------------
-- Contact discovery fix
--
-- Run this once in the Supabase SQL editor on an existing project.
--
-- Why: the old discover_contacts() only compared auth.users.phone (usually
-- empty because signup is email-based), so phone matches never worked. This
-- version adds a private phone store and matches:
--   * profile_contacts.phone (normalized to the last 10 digits)
--   * auth.users.phone
--   * auth.users.email
--
-- Idempotent; also appended to complete_schema.sql for fresh installs.
-- ---------------------------------------------------------------------------

create table if not exists public.profile_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text,
  updated_at timestamptz not null default now()
);

alter table public.profile_contacts enable row level security;

grant select, insert, update, delete on public.profile_contacts to authenticated;

drop policy if exists "Users can read their own contact info" on public.profile_contacts;
create policy "Users can read their own contact info"
  on public.profile_contacts for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can add their own contact info" on public.profile_contacts;
create policy "Users can add their own contact info"
  on public.profile_contacts for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own contact info" on public.profile_contacts;
create policy "Users can update their own contact info"
  on public.profile_contacts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own contact info" on public.profile_contacts;
create policy "Users can delete their own contact info"
  on public.profile_contacts for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Match normalized device contact phones/emails against accounts.
-- ---------------------------------------------------------------------------

create or replace function public.discover_contacts(
  contact_phones text[] default '{}',
  contact_emails text[] default '{}'
)
returns table (id uuid, full_name text, username text, avatar_url text)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select p.id, p.full_name, p.username, p.avatar_url
  from auth.users as u
  join public.profiles as p on p.id = u.id
  left join public.profile_contacts as pc on pc.user_id = u.id
  where u.id <> (select auth.uid())
    and (
      right(regexp_replace(coalesce(pc.phone, ''), '\D', '', 'g'), 10)
        = any(coalesce(contact_phones, '{}'::text[]))
      or right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10)
        = any(coalesce(contact_phones, '{}'::text[]))
      or lower(coalesce(u.email, '')) = any(coalesce(contact_emails, '{}'::text[]))
    )
  order by lower(coalesce(p.full_name, p.username, ''));
$$;

revoke all on function public.discover_contacts(text[], text[]) from public;
grant execute on function public.discover_contacts(text[], text[]) to authenticated;

notify pgrst, 'reload schema';
