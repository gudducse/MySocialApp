-- ---------------------------------------------------------------------------
-- Privacy + follow requests
--
-- Run once in the Supabase SQL editor on an existing project.
-- Enables private accounts, pending follow requests, hidden follower lists and
-- private post/story visibility.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_private boolean not null default false;

alter table public.user_follows
  add column if not exists status text not null default 'accepted',
  add column if not exists accepted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_follows_status_check'
  ) then
    alter table public.user_follows
      add constraint user_follows_status_check
      check (status in ('accepted', 'pending'));
  end if;
end $$;

create index if not exists user_follows_requests_idx
  on public.user_follows (following_id, status);
create index if not exists user_follows_acceptance_notifications_idx
  on public.user_follows (follower_id, accepted_at desc)
  where accepted_at is not null;

-- New follows become pending when the target account is private.
create or replace function public.set_follow_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_private boolean;
begin
  select coalesce(is_private, false)
    into target_private
    from public.profiles
   where id = new.following_id;

  if target_private then
    new.status := 'pending';
  else
    new.status := 'accepted';
  end if;

  return new;
end;
$$;

drop trigger if exists set_follow_request_status on public.user_follows;
create trigger set_follow_request_status
  before insert on public.user_follows
  for each row execute function public.set_follow_request_status();

-- Only the relationship itself can change on update (accept a request).
create or replace function public.enforce_follow_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.follower_id is distinct from old.follower_id
     or new.following_id is distinct from old.following_id then
    raise exception 'Follow participants cannot be changed';
  end if;

  if old.status = 'accepted' and new.status = 'pending' then
    raise exception 'An accepted follow cannot be turned back into a request';
  end if;

  if old.status = 'pending' and new.status = 'accepted' then
    new.accepted_at := now();
  else
    new.accepted_at := old.accepted_at;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_follow_update on public.user_follows;
create trigger enforce_follow_update
  before update on public.user_follows
  for each row execute function public.enforce_follow_update();

-- Pending requests are only visible to the two people involved.
drop policy if exists "Anyone can read follows" on public.user_follows;
create policy "Users can read accepted follows and their requests"
  on public.user_follows for select to authenticated
  using (
    coalesce(status, 'accepted') = 'accepted'
    or follower_id = (select auth.uid())
    or following_id = (select auth.uid())
  );

drop policy if exists "Followees can respond to follow requests" on public.user_follows;
create policy "Followees can respond to follow requests"
  on public.user_follows for update to authenticated
  using (following_id = (select auth.uid()))
  with check (following_id = (select auth.uid()));

drop policy if exists "Followees can remove followers and requests" on public.user_follows;
create policy "Followees can remove followers and requests"
  on public.user_follows for delete to authenticated
  using (following_id = (select auth.uid()));

-- Private accounts: only the owner and accepted followers can read posts.
drop policy if exists "Authenticated users can read social posts" on public.social_posts;
create policy "Visible social posts"
  on public.social_posts for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = social_posts.user_id and p.is_private = false
    )
    or exists (
      select 1 from public.user_follows f
      where f.follower_id = (select auth.uid())
        and f.following_id = social_posts.user_id
        and f.status = 'accepted'
    )
  );

-- Private accounts: only the owner and accepted followers can read stories.
drop policy if exists "Users can read active stories" on public.social_stories;
create policy "Visible active stories"
  on public.social_stories for select to authenticated
  using (
    expires_at > now()
    and (
      user_id = (select auth.uid())
      or exists (
        select 1 from public.profiles p
        where p.id = social_stories.user_id and p.is_private = false
      )
      or exists (
        select 1 from public.user_follows f
        where f.follower_id = (select auth.uid())
          and f.following_id = social_stories.user_id
          and f.status = 'accepted'
      )
    )
  );

grant select, insert, update, delete on public.user_follows to authenticated;

notify pgrst, 'reload schema';
