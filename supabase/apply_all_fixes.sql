-- ---------------------------------------------------------------------------
-- SocialApp — all new feature migrations (run once in Supabase SQL editor)
-- ---------------------------------------------------------------------------

-- 1. Comments: edit / hide / delete

-- ---------------------------------------------------------------------------
-- Comment management
--
-- Run this once in the Supabase SQL editor on an existing project.
--
-- Adds:
--   * comment editing by the comment author
--   * comment hiding by the post owner (hidden comments stay visible to the
--     post owner and to the person who wrote them)
--   * comment deletion by the comment author OR the post owner
--
-- This file is idempotent and is also appended to complete_schema.sql for
-- fresh installs.
-- ---------------------------------------------------------------------------

alter table public.social_post_comments
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null,
  add column if not exists edited_at timestamptz;

-- ---------------------------------------------------------------------------
-- Read visibility: hidden comments are only readable by their author and the
-- owner of the post they belong to.
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can read comments" on public.social_post_comments;
drop policy if exists "Users can read visible comments" on public.social_post_comments;

create policy "Users can read visible comments"
  on public.social_post_comments for select to authenticated
  using (
    is_hidden = false
    or user_id = (select auth.uid())
    or exists (
      select 1
      from public.social_posts p
      where p.id = post_id
        and p.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Update: comment authors can edit their own body; post owners can hide or
-- unhide comments on their posts.
-- ---------------------------------------------------------------------------

drop policy if exists "Comment authors and post owners can update comments" on public.social_post_comments;

create policy "Comment authors and post owners can update comments"
  on public.social_post_comments for update to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.social_posts p
      where p.id = post_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.social_posts p
      where p.id = post_id
        and p.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Delete: comment author OR post owner.
-- ---------------------------------------------------------------------------

drop policy if exists "Post owners can delete comments on their posts" on public.social_post_comments;

create policy "Post owners can delete comments on their posts"
  on public.social_post_comments for delete to authenticated
  using (
    exists (
      select 1
      from public.social_posts p
      where p.id = post_id
        and p.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Column-level guard. RLS cannot say "the author may only change body" or
-- "the post owner may only change visibility", so enforce it in a trigger.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_comment_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer uuid := (select auth.uid());
  is_comment_author boolean;
  is_post_owner boolean;
begin
  is_comment_author := viewer is not null and viewer = old.user_id;

  is_post_owner := viewer is not null and exists (
    select 1
    from public.social_posts p
    where p.id = old.post_id
      and p.user_id = viewer
  );

  if not (is_comment_author or is_post_owner) then
    raise exception 'You are not allowed to update this comment';
  end if;

  if new.id is distinct from old.id
     or new.post_id is distinct from old.post_id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the comment text or visibility can be changed';
  end if;

  if new.body is distinct from old.body then
    if not is_comment_author then
      raise exception 'Only the comment author can edit this comment';
    end if;

    if char_length(trim(new.body)) = 0 then
      raise exception 'Comment cannot be empty';
    end if;

    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  if new.is_hidden is distinct from old.is_hidden then
    if not is_post_owner then
      raise exception 'Only the post owner can hide comments';
    end if;

    new.hidden_at := case when new.is_hidden then now() else null end;
    new.hidden_by := case when new.is_hidden then viewer else null end;
  else
    new.hidden_at := old.hidden_at;
    new.hidden_by := old.hidden_by;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_comment_update_rules on public.social_post_comments;

create trigger enforce_comment_update_rules
  before update on public.social_post_comments
  for each row execute function public.enforce_comment_update_rules();


-- 2. Messages: unsend + live reactions

-- ---------------------------------------------------------------------------
-- Message management
--
-- Run this once in the Supabase SQL editor on an existing project.
--
-- Adds:
--   * "Unsend for everyone" for the sender (delete policy)
--   * live emoji reactions stored in the database
--   * conversation preview refresh after a message is deleted
--
-- Idempotent; also appended to complete_schema.sql for fresh installs.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Unsend for everyone: only the sender can delete a message.
-- ---------------------------------------------------------------------------

drop policy if exists "Senders can unsend messages" on public.social_messages;

create policy "Senders can unsend messages"
  on public.social_messages for delete to authenticated
  using ((select auth.uid()) = sender_id);

-- ---------------------------------------------------------------------------
-- Live message reactions (one reaction per user per message).
-- ---------------------------------------------------------------------------

create table if not exists public.social_message_reactions (
  message_id uuid not null references public.social_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists social_message_reactions_message_idx
  on public.social_message_reactions (message_id);

alter table public.social_message_reactions enable row level security;

grant select, insert, update, delete on public.social_message_reactions to authenticated;

drop policy if exists "Participants can read message reactions" on public.social_message_reactions;
create policy "Participants can read message reactions"
  on public.social_message_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.social_messages m
      where m.id = message_id
        and (select auth.uid()) in (m.sender_id, m.receiver_id)
    )
  );

drop policy if exists "Participants can add message reactions" on public.social_message_reactions;
create policy "Participants can add message reactions"
  on public.social_message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.social_messages m
      where m.id = message_id
        and (select auth.uid()) in (m.sender_id, m.receiver_id)
    )
  );

drop policy if exists "Users can update their message reactions" on public.social_message_reactions;
create policy "Users can update their message reactions"
  on public.social_message_reactions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.social_messages m
      where m.id = message_id
        and (select auth.uid()) in (m.sender_id, m.receiver_id)
    )
  );

drop policy if exists "Users can remove their message reactions" on public.social_message_reactions;
create policy "Users can remove their message reactions"
  on public.social_message_reactions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Keep the conversation preview correct after an unsend.
-- ---------------------------------------------------------------------------

create or replace function public.update_conversation_preview_after_message_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest public.social_messages;
begin
  select *
    into latest
    from public.social_messages
   where conversation_id = old.conversation_id
   order by created_at desc
   limit 1;

  if latest.id is null then
    update public.social_conversations
       set last_message = '',
           last_message_at = now()
     where id = old.conversation_id;
  else
    update public.social_conversations
       set last_message = latest.text,
           last_message_at = latest.created_at
     where id = old.conversation_id;
  end if;

  return old;
end;
$$;

drop trigger if exists social_messages_update_preview_after_delete on public.social_messages;

create trigger social_messages_update_preview_after_delete
  after delete on public.social_messages
  for each row execute function public.update_conversation_preview_after_message_delete();

notify pgrst, 'reload schema';


-- 3. Contacts: private phone matching

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


-- 4. Privacy + follow requests

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


-- 5. Blocks / mutes / restrictions

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


-- 6. DM message requests

-- ---------------------------------------------------------------------------
-- DM message requests
--
-- Run once in the Supabase SQL editor on an existing project.
-- New 1:1 conversations become "pending" when the recipient does not follow
-- the sender; the recipient can accept or delete them from the Requests tab.
-- ---------------------------------------------------------------------------

alter table public.social_conversations
  add column if not exists request_status text not null default 'accepted',
  add column if not exists requested_by uuid references auth.users(id) on delete set null,
  add column if not exists requested_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_conversations_request_status_check'
  ) then
    alter table public.social_conversations
      add constraint social_conversations_request_status_check
      check (request_status in ('accepted', 'pending'));
  end if;
end $$;

create index if not exists social_conversations_requests_idx
  on public.social_conversations (request_status, requested_at desc);

create or replace function public.set_conversation_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer uuid := (select auth.uid());
  other_user uuid;
  recipient_follows_sender boolean;
begin
  if new.request_status is not null and new.request_status <> 'accepted' then
    return new;
  end if;

  other_user := case
    when new.participant_one = viewer then new.participant_two
    else new.participant_one
  end;

  select exists (
    select 1
    from public.user_follows f
    where f.follower_id = other_user
      and f.following_id = viewer
      and f.status = 'accepted'
  ) into recipient_follows_sender;

  if recipient_follows_sender then
    new.request_status := 'accepted';
  else
    new.request_status := 'pending';
    new.requested_by := viewer;
    new.requested_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists set_conversation_request_status on public.social_conversations;
create trigger set_conversation_request_status
  before insert on public.social_conversations
  for each row execute function public.set_conversation_request_status();

drop policy if exists "Users can delete their conversations" on public.social_conversations;
create policy "Users can delete their conversations"
  on public.social_conversations for delete to authenticated
  using ((select auth.uid()) in (participant_one, participant_two));

grant select, insert, update, delete on public.social_conversations to authenticated;

-- Public profile totals remain visible when private content and lists are locked.
create or replace function public.get_profile_stats(target_user_id uuid)
returns table (
  posts_count bigint,
  followers_count bigint,
  following_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  is_blocked boolean := false;
begin
  if viewer_id is null or target_user_id is null then
    return;
  end if;

  if to_regclass('public.blocks') is not null then
    execute
      'select exists (
         select 1 from public.blocks b
         where (b.blocker_id = $1 and b.blocked_id = $2)
            or (b.blocker_id = $2 and b.blocked_id = $1)
       )'
      into is_blocked
      using viewer_id, target_user_id;

    if is_blocked then
      return;
    end if;
  end if;

  return query
    select
      (select count(*) from public.social_posts p
        where p.user_id = target_user_id),
      (select count(*) from public.user_follows f
        where f.following_id = target_user_id
          and coalesce(f.status, 'accepted') = 'accepted'),
      (select count(*) from public.user_follows f
        where f.follower_id = target_user_id
          and coalesce(f.status, 'accepted') = 'accepted')
    where exists (
      select 1 from public.profiles p where p.id = target_user_id
    );
end;
$$;

revoke all on function public.get_profile_stats(uuid) from public;
grant execute on function public.get_profile_stats(uuid) to authenticated;

create or replace function public.can_access_call_channel(target_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  peer_id uuid;
  request_state text;
  is_blocked boolean := false;
begin
  if viewer_id is null or target_topic !~ '^call:[0-9a-fA-F-]{36}$' then
    return false;
  end if;

  select c.participant_one,
         c.participant_two,
         coalesce(to_jsonb(c)->>'request_status', 'accepted')
    into first_user, second_user, request_state
    from public.social_conversations c
   where c.id::text = split_part(target_topic, ':', 2);

  if not found
     or request_state <> 'accepted'
     or (viewer_id <> first_user and viewer_id <> second_user) then
    return false;
  end if;

  peer_id := case when viewer_id = first_user then second_user else first_user end;

  if to_regclass('public.blocks') is not null then
    execute
      'select exists (
         select 1 from public.blocks b
         where (b.blocker_id = $1 and b.blocked_id = $2)
            or (b.blocker_id = $2 and b.blocked_id = $1)
       )'
      into is_blocked
      using viewer_id, peer_id;
  end if;

  return not is_blocked;
end;
$$;

revoke all on function public.can_access_call_channel(text) from public, anon;
grant execute on function public.can_access_call_channel(text) to authenticated;

drop policy if exists "Conversation participants can receive call signals"
  on realtime.messages;
create policy "Conversation participants can receive call signals"
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and public.can_access_call_channel(realtime.topic())
  );

drop policy if exists "Conversation participants can send call signals"
  on realtime.messages;
create policy "Conversation participants can send call signals"
  on realtime.messages for insert to authenticated
  with check (
    extension = 'broadcast'
    and public.can_access_call_channel(realtime.topic())
  );

-- Story replies stay attached to their story and never enter direct messages.
create table if not exists public.social_story_replies (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.social_stories(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists social_story_replies_story_created_idx
  on public.social_story_replies (story_id, created_at asc);

alter table public.social_story_replies enable row level security;

drop policy if exists "Story participants can read replies"
  on public.social_story_replies;
create policy "Story participants can read replies"
  on public.social_story_replies for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

drop policy if exists "Viewers can reply to active stories"
  on public.social_story_replies;
create policy "Viewers can reply to active stories"
  on public.social_story_replies for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and sender_id <> recipient_id
    and exists (
      select 1
      from public.social_stories s
      where s.id = story_id
        and s.user_id = recipient_id
        and s.expires_at > now()
    )
  );

grant select, insert on public.social_story_replies to authenticated;

create table if not exists public.social_story_likes (
  story_id uuid not null references public.social_stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists social_story_likes_user_created_idx
  on public.social_story_likes (user_id, created_at desc);

alter table public.social_story_likes enable row level security;

drop policy if exists "Story owners and likers can read likes"
  on public.social_story_likes;
create policy "Story owners and likers can read likes"
  on public.social_story_likes for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.social_stories s
      where s.id = story_id
        and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can like active stories"
  on public.social_story_likes;
create policy "Users can like active stories"
  on public.social_story_likes for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.social_stories s
      where s.id = story_id
        and s.user_id <> (select auth.uid())
        and s.expires_at > now()
    )
  );

drop policy if exists "Users can remove their story likes"
  on public.social_story_likes;
create policy "Users can remove their story likes"
  on public.social_story_likes for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, delete on public.social_story_likes to authenticated;

notify pgrst, 'reload schema';
