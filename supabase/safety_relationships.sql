-- ---------------------------------------------------------------------------
-- Safety relationships: blocks, mutes, restrictions
--
-- Run once in the Supabase SQL editor on an existing project.
-- Idempotent; also appended to complete_schema.sql / apply_all_fixes.sql.
-- ---------------------------------------------------------------------------

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

create table if not exists public.mutes (
  muter_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  mute_posts boolean not null default true,
  mute_stories boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (muter_id, target_id),
  constraint mutes_no_self check (muter_id <> target_id)
);

create table if not exists public.restrictions (
  restrictor_id uuid not null references auth.users(id) on delete cascade,
  restricted_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (restrictor_id, restricted_id),
  constraint restrictions_no_self check (restrictor_id <> restricted_id)
);

alter table public.blocks enable row level security;
alter table public.mutes enable row level security;
alter table public.restrictions enable row level security;

grant select, insert, update, delete on public.blocks to authenticated;
grant select, insert, update, delete on public.mutes to authenticated;
grant select, insert, update, delete on public.restrictions to authenticated;

drop policy if exists "Users can read their blocks" on public.blocks;
create policy "Users can read their blocks"
  on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()) or blocked_id = (select auth.uid()));

drop policy if exists "Users can create blocks" on public.blocks;
create policy "Users can create blocks"
  on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));

drop policy if exists "Users can remove their blocks" on public.blocks;
create policy "Users can remove their blocks"
  on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists "Users can read their mutes" on public.mutes;
create policy "Users can read their mutes"
  on public.mutes for select to authenticated
  using (muter_id = (select auth.uid()));

drop policy if exists "Users can manage their mutes" on public.mutes;
create policy "Users can manage their mutes"
  on public.mutes for insert to authenticated
  with check (muter_id = (select auth.uid()));

drop policy if exists "Users can update their mutes" on public.mutes;
create policy "Users can update their mutes"
  on public.mutes for update to authenticated
  using (muter_id = (select auth.uid()))
  with check (muter_id = (select auth.uid()));

drop policy if exists "Users can remove their mutes" on public.mutes;
create policy "Users can remove their mutes"
  on public.mutes for delete to authenticated
  using (muter_id = (select auth.uid()));

drop policy if exists "Users can read their restrictions" on public.restrictions;
create policy "Users can read their restrictions"
  on public.restrictions for select to authenticated
  using (restrictor_id = (select auth.uid()));

drop policy if exists "Users can manage their restrictions" on public.restrictions;
create policy "Users can manage their restrictions"
  on public.restrictions for insert to authenticated
  with check (restrictor_id = (select auth.uid()));

drop policy if exists "Users can remove their restrictions" on public.restrictions;
create policy "Users can remove their restrictions"
  on public.restrictions for delete to authenticated
  using (restrictor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Atomic actions
-- ---------------------------------------------------------------------------

create or replace function public.block_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_id is null or target_id = (select auth.uid()) then
    raise exception 'Invalid block target';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values ((select auth.uid()), target_id)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.user_follows
   where (follower_id = (select auth.uid()) and following_id = target_id)
      or (follower_id = target_id and following_id = (select auth.uid()));
end;
$$;

create or replace function public.unblock_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.blocks
   where blocker_id = (select auth.uid()) and blocked_id = target_id;
end;
$$;

create or replace function public.set_user_mute(
  target_id uuid,
  mute_posts boolean,
  mute_stories boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_id is null or target_id = (select auth.uid()) then
    raise exception 'Invalid mute target';
  end if;

  if mute_posts = false and mute_stories = false then
    delete from public.mutes
     where muter_id = (select auth.uid()) and target_id = set_user_mute.target_id;
    return;
  end if;

  insert into public.mutes (muter_id, target_id, mute_posts, mute_stories)
  values ((select auth.uid()), target_id, mute_posts, mute_stories)
  on conflict (muter_id, target_id) do update
    set mute_posts = excluded.mute_posts,
        mute_stories = excluded.mute_stories;
end;
$$;

create or replace function public.set_user_restrict(target_id uuid, restricted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_id is null or target_id = (select auth.uid()) then
    raise exception 'Invalid restrict target';
  end if;

  if restricted then
    insert into public.restrictions (restrictor_id, restricted_id)
    values ((select auth.uid()), target_id)
    on conflict (restrictor_id, restricted_id) do nothing;
  else
    delete from public.restrictions
     where restrictor_id = (select auth.uid()) and restricted_id = target_id;
  end if;
end;
$$;

create or replace function public.get_blocked_users()
returns table (id uuid, full_name text, username text, avatar_url text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.username, p.avatar_url
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.set_user_mute(uuid, boolean, boolean) from public;
revoke all on function public.set_user_restrict(uuid, boolean) from public;

grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.get_blocked_users() to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.set_user_mute(uuid, boolean, boolean) to authenticated;
grant execute on function public.set_user_restrict(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Enforce blocks at the data layer
-- ---------------------------------------------------------------------------

drop policy if exists "Public profiles are readable by everyone" on public.profiles;
drop policy if exists "Profiles visible unless blocked" on public.profiles;

create policy "Profiles visible unless blocked"
  on public.profiles for select to authenticated
  using (
    not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = profiles.id)
         or (b.blocker_id = profiles.id and b.blocked_id = (select auth.uid()))
    )
  );

drop policy if exists "Authenticated users can read social posts" on public.social_posts;
drop policy if exists "Visible social posts" on public.social_posts;

create policy "Visible social posts"
  on public.social_posts for select to authenticated
  using (
    not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = social_posts.user_id)
         or (b.blocker_id = social_posts.user_id and b.blocked_id = (select auth.uid()))
    )
    and (
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
    )
  );

drop policy if exists "Users can read active stories" on public.social_stories;
drop policy if exists "Visible active stories" on public.social_stories;

create policy "Visible active stories"
  on public.social_stories for select to authenticated
  using (
    expires_at > now()
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = social_stories.user_id)
         or (b.blocker_id = social_stories.user_id and b.blocked_id = (select auth.uid()))
    )
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

drop policy if exists "Users can follow others" on public.user_follows;
create policy "Users can follow others"
  on public.user_follows for insert to authenticated
  with check (
    (select auth.uid()) = follower_id
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = following_id)
         or (b.blocker_id = following_id and b.blocked_id = (select auth.uid()))
    )
  );

-- Restricted users' comments are hidden from everyone except the post owner
-- and the restricted commenter.
drop policy if exists "Users can read visible comments" on public.social_post_comments;
create policy "Users can read visible comments"
  on public.social_post_comments for select to authenticated
  using (
    (
      is_hidden = false
      or user_id = (select auth.uid())
      or exists (
        select 1 from public.social_posts p
        where p.id = social_post_comments.post_id
          and p.user_id = (select auth.uid())
      )
    )
    and not exists (
      select 1
      from public.restrictions r
      join public.social_posts p on p.id = social_post_comments.post_id
      where r.restrictor_id = p.user_id
        and r.restricted_id = social_post_comments.user_id
        and (select auth.uid()) <> p.user_id
        and (select auth.uid()) <> social_post_comments.user_id
    )
  );

-- Blocked people cannot send new DMs.
create or replace function public.prevent_blocked_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = new.receiver_id and b.blocked_id = new.sender_id)
       or (b.blocker_id = new.sender_id and b.blocked_id = new.receiver_id)
  ) then
    raise exception 'You cannot message this account';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_blocked_messages on public.social_messages;
create trigger prevent_blocked_messages
  before insert on public.social_messages
  for each row execute function public.prevent_blocked_messages();

notify pgrst, 'reload schema';
