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

notify pgrst, 'reload schema';
