-- Limit private WebRTC signaling to participants in an accepted conversation.
-- Audio/video remains peer-to-peer and is not stored in Supabase.
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
