-- ---------------------------------------------------------------------------
-- Message management
--
-- Run this once in the Supabase SQL editor on an existing project.
--
-- Adds:
--   * "Unsend for everyone" for the sender (delete policy)
--   * sender-only message editing
--   * live emoji reactions stored in the database
--   * conversation preview refresh after a message is deleted
--
-- Idempotent; also appended to complete_schema.sql for fresh installs.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Unsend for everyone: only the sender can delete a message.
-- ---------------------------------------------------------------------------

alter table public.social_messages
  add column if not exists edited_at timestamptz;

drop policy if exists "Senders can unsend messages" on public.social_messages;

create policy "Senders can unsend messages"
  on public.social_messages for delete to authenticated
  using ((select auth.uid()) = sender_id);

drop policy if exists "Senders can edit their messages" on public.social_messages;
create policy "Senders can edit their messages"
  on public.social_messages for update to authenticated
  using ((select auth.uid()) = sender_id)
  with check ((select auth.uid()) = sender_id);

create or replace function public.enforce_social_message_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or new.receiver_id is distinct from old.receiver_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Message participants and timestamps cannot be changed';
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

drop trigger if exists enforce_social_message_update on public.social_messages;
create trigger enforce_social_message_update
  before update on public.social_messages
  for each row execute function public.enforce_social_message_update();

create or replace function public.update_conversation_preview_after_message_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.text is distinct from old.text then
    update public.social_conversations
       set last_message = new.text,
           last_message_at = new.created_at
     where id = new.conversation_id
       and last_message_at = old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists social_messages_update_preview_after_edit on public.social_messages;
create trigger social_messages_update_preview_after_edit
  after update of text on public.social_messages
  for each row execute function public.update_conversation_preview_after_message_edit();

-- ---------------------------------------------------------------------------
-- Live message reactions (one reaction per user per message).
-- ---------------------------------------------------------------------------

create table if not exists public.social_message_reactions (
  message_id uuid not null references public.social_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.social_message_reactions
  drop constraint if exists social_message_reactions_emoji_check;
alter table public.social_message_reactions
  add constraint social_message_reactions_emoji_check
  check (char_length(emoji) between 1 and 64);

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
