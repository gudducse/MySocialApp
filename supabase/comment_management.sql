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
