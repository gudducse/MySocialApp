-- Store replies on their story instead of delivering them as direct messages.
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

-- Story likes are separate from replies and direct messages.
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
