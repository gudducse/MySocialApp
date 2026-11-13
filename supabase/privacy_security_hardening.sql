-- Enforce private-account follow requests at the database and media-storage layers.
-- Existing accounts become private when is_private is first created; owners can
-- switch accounts to public in Settings afterward. New accounts default private.
begin;

alter table public.profiles
  add column if not exists is_private boolean not null default true;
alter table public.profiles
  alter column is_private set default true;

alter table public.user_follows
  add column if not exists status text not null default 'accepted';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_follows_status_check'
      and conrelid = 'public.user_follows'::regclass
  ) then
    alter table public.user_follows
      add constraint user_follows_status_check
      check (status in ('accepted', 'pending'));
  end if;
end;
$$;

alter table public.social_posts
  add column if not exists cover_url text,
  add column if not exists cover_path text;

alter table public.social_messages
  add column if not exists media_type text,
  add column if not exists media_path text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'social_messages_media_type_check'
      and conrelid = 'public.social_messages'::regclass
  ) then
    alter table public.social_messages
      add constraint social_messages_media_type_check
      check (media_type is null or media_type in ('image', 'video'));
  end if;
end;
$$;

create or replace function public.set_follow_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_private boolean;
begin
  select coalesce(is_private, true)
    into target_private
    from public.profiles
   where id = new.following_id;
  new.status := case when coalesce(target_private, true) then 'pending' else 'accepted' end;
  return new;
end;
$$;

drop trigger if exists set_follow_request_status on public.user_follows;
create trigger set_follow_request_status
  before insert on public.user_follows
  for each row execute function public.set_follow_request_status();

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
    raise exception 'An accepted follow cannot be turned into a request';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_follow_update on public.user_follows;
create trigger enforce_follow_update
  before update on public.user_follows
  for each row execute function public.enforce_follow_update();

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_follows'
      and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  loop
    execute format('drop policy %I on public.user_follows', policy_row.policyname);
  end loop;
end;
$$;

create policy "Users can read accepted follows and their requests"
  on public.user_follows for select to authenticated
  using (
    (status = 'accepted' and (
      follower_id = (select auth.uid())
      or following_id = (select auth.uid())
      or exists (
        select 1 from public.profiles p
        where p.id = user_follows.following_id and p.is_private = false
      )
    ))
    or follower_id = (select auth.uid())
    or following_id = (select auth.uid())
  );

create policy "Users can create follow requests"
  on public.user_follows for insert to authenticated
  with check (
    follower_id = (select auth.uid())
    and follower_id <> following_id
  );

create policy "Followees can accept requests"
  on public.user_follows for update to authenticated
  using (following_id = (select auth.uid()) and status = 'pending')
  with check (following_id = (select auth.uid()) and status = 'accepted');

create policy "Users can remove follow relationships"
  on public.user_follows for delete to authenticated
  using (follower_id = (select auth.uid()) or following_id = (select auth.uid()));

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'social_posts' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.social_posts', policy_row.policyname);
  end loop;
end;
$$;

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

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'social_stories' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.social_stories', policy_row.policyname);
  end loop;
end;
$$;

create policy "Stories respect account and story audience"
  on public.social_stories for select to authenticated
  using (
    expires_at > now()
    and (
      user_id = (select auth.uid())
      or (
        exists (
          select 1 from public.profiles p
          where p.id = social_stories.user_id
            and (
              p.is_private = false
              or exists (
                select 1 from public.user_follows f
                where f.follower_id = (select auth.uid())
                  and f.following_id = social_stories.user_id
                  and f.status = 'accepted'
              )
            )
        )
        and (
          visibility = 'everyone'
          or (
            visibility = 'followers'
            and exists (
              select 1 from public.user_follows f
              where f.follower_id = (select auth.uid())
                and f.following_id = social_stories.user_id
                and f.status = 'accepted'
            )
          )
          or (
            visibility = 'close_friends'
            and exists (
              select 1 from public.user_follows f
              where f.follower_id = (select auth.uid())
                and f.following_id = social_stories.user_id
                and f.status = 'accepted'
            )
            and public.is_close_friend(social_stories.user_id, (select auth.uid()))
          )
        )
      )
    )
  );

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'social_post_likes'
      and cmd in ('SELECT', 'INSERT')
  loop
    execute format('drop policy %I on public.social_post_likes', policy_row.policyname);
  end loop;
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'social_post_comments'
      and cmd in ('SELECT', 'INSERT')
  loop
    execute format('drop policy %I on public.social_post_comments', policy_row.policyname);
  end loop;
end;
$$;

create policy "Users read likes on visible posts"
  on public.social_post_likes for select to authenticated
  using (exists (select 1 from public.social_posts p where p.id = post_id));
create policy "Users like visible posts as themselves"
  on public.social_post_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.social_posts p where p.id = post_id)
  );
create policy "Users read comments on visible posts"
  on public.social_post_comments for select to authenticated
  using (exists (select 1 from public.social_posts p where p.id = post_id));
create policy "Users comment on visible posts as themselves"
  on public.social_post_comments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.social_posts p where p.id = post_id)
  );

create or replace function public.enforce_social_message_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare actor_id uuid := (select auth.uid());
begin
  -- Trusted SQL migrations run without an end-user JWT and may backfill the
  -- new media columns. Client requests always carry auth.uid() and stay guarded.
  if actor_id is null then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or new.receiver_id is distinct from old.receiver_id
     or new.created_at is distinct from old.created_at
     or new.media_path is distinct from old.media_path
     or new.media_type is distinct from old.media_type then
    raise exception 'Message participants, media, and timestamps cannot be changed';
  end if;
  if actor_id = old.sender_id then
    if new.read_at is distinct from old.read_at then
      raise exception 'Senders cannot change message read state';
    end if;
    if new.text is distinct from old.text then
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
  elsif actor_id = old.receiver_id then
    if new.text is distinct from old.text
       or new.edited_at is distinct from old.edited_at then
      raise exception 'Receivers cannot edit messages';
    end if;
  else
    raise exception 'Only conversation participants can update messages';
  end if;
  return new;
end;
$$;

create or replace function public.extract_legacy_message_media(message_text text, field_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare parsed jsonb;
begin
  if message_text not like 'socialapp-media:%' then return null; end if;
  parsed := substring(message_text from length('socialapp-media:') + 1)::jsonb;
  return parsed ->> field_name;
exception when others then
  return null;
end;
$$;

update public.social_messages
set media_type = public.extract_legacy_message_media(text, 'type'),
    media_path = public.extract_legacy_message_media(text, 'path')
where media_path is null
  and text like 'socialapp-media:%'
  and public.extract_legacy_message_media(text, 'path') like sender_id::text || '/%'
  and public.extract_legacy_message_media(text, 'type') in ('image', 'video');

drop function public.extract_legacy_message_media(text, text);

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd = 'SELECT' and coalesce(qual, '') like '%post-media%'
  loop
    execute format('drop policy %I on storage.objects', policy_row.policyname);
  end loop;
end;
$$;

update storage.buckets set public = false where id = 'post-media';

create policy "Authorized users read post and message media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and (
      exists (
        select 1 from public.social_posts p
        where p.media_path = objects.name or p.cover_path = objects.name
      )
      or exists (
        select 1 from public.social_messages m
        where m.media_path = objects.name
      )
    )
  );

notify pgrst, 'reload schema';
commit;
