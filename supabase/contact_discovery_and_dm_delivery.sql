-- Run this migration in the Supabase SQL editor for contact discovery and
-- reliable conversation previews. Phone/email values are compared in memory
-- by this RPC and are not stored in a contact table.

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
  where u.id <> (select auth.uid())
    and (
      right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10)
        = any(coalesce(contact_phones, '{}'::text[]))
      or lower(coalesce(u.email, '')) = any(coalesce(contact_emails, '{}'::text[]))
    )
  order by lower(coalesce(p.full_name, p.username, ''));
$$;

revoke all on function public.discover_contacts(text[], text[]) from public;
grant execute on function public.discover_contacts(text[], text[]) to authenticated;

create or replace function public.update_conversation_preview_after_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.social_conversations
  set last_message = new.text,
      last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists social_messages_update_conversation_preview on public.social_messages;
create trigger social_messages_update_conversation_preview
after insert on public.social_messages
for each row execute function public.update_conversation_preview_after_message();

drop policy if exists "Users can send messages" on public.social_messages;
create policy "Users can send messages"
  on public.social_messages for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and exists (
      select 1
      from public.social_conversations as c
      where c.id = conversation_id
        and (select auth.uid()) in (c.participant_one, c.participant_two)
        and receiver_id in (c.participant_one, c.participant_two)
        and receiver_id <> sender_id
    )
  );

notify pgrst, 'reload schema';
