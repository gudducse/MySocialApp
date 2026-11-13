-- Enable persistent emoji reactions for direct messages.
-- Safe to run more than once in the Supabase SQL editor.

create table if not exists public.social_message_reactions (
  message_id uuid not null references public.social_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists social_message_reactions_message_idx
  on public.social_message_reactions (message_id);

alter table public.social_message_reactions enable row level security;

grant select, insert, update, delete
  on public.social_message_reactions to authenticated;

drop policy if exists "Participants can read message reactions"
  on public.social_message_reactions;
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

drop policy if exists "Participants can add message reactions"
  on public.social_message_reactions;
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

drop policy if exists "Users can update their message reactions"
  on public.social_message_reactions;
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

drop policy if exists "Users can remove their message reactions"
  on public.social_message_reactions;
create policy "Users can remove their message reactions"
  on public.social_message_reactions for delete to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
