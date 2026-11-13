-- Enable sender-only message editing and unsending, plus long Unicode emoji.
-- Idempotent; run after the app's message schema is present.

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

alter table public.social_message_reactions
  drop constraint if exists social_message_reactions_emoji_check;
alter table public.social_message_reactions
  add constraint social_message_reactions_emoji_check
  check (char_length(emoji) between 1 and 64);

notify pgrst, 'reload schema';
