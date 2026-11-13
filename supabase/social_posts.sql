-- social. posts and persistent likes
-- Run this in Supabase SQL Editor after checking that these table names are unused.
-- This script creates new tables named social_posts and social_post_likes.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  caption text not null default '',
  media_url text not null,
  media_path text not null,
  media_type text not null default 'image'
    check (media_type in ('image', 'video')),
  created_at timestamptz not null default now()
);

create index if not exists social_posts_created_at_idx
  on public.social_posts (created_at desc);

create index if not exists social_posts_user_id_idx
  on public.social_posts (user_id);

alter table public.social_posts enable row level security;

revoke all on table public.social_posts from anon;
grant select, insert, update, delete on table public.social_posts to authenticated;

drop policy if exists "Authenticated users can read social posts" on public.social_posts;
create policy "Authenticated users can read social posts"
  on public.social_posts
  for select to authenticated
  using (true);

drop policy if exists "Users can create their own social posts" on public.social_posts;
create policy "Users can create their own social posts"
  on public.social_posts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own social posts" on public.social_posts;
create policy "Users can update their own social posts"
  on public.social_posts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own social posts" on public.social_posts;
create policy "Users can delete their own social posts"
  on public.social_posts
  for delete to authenticated
  using ((select auth.uid()) = user_id);


create table if not exists public.social_post_likes (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists social_post_likes_user_id_idx
  on public.social_post_likes (user_id);

alter table public.social_post_likes enable row level security;

revoke all on table public.social_post_likes from anon;
grant select, insert, delete on table public.social_post_likes to authenticated;

drop policy if exists "Authenticated users can read post likes" on public.social_post_likes;
create policy "Authenticated users can read post likes"
  on public.social_post_likes
  for select to authenticated
  using (true);

drop policy if exists "Users can like posts as themselves" on public.social_post_likes;
create policy "Users can like posts as themselves"
  on public.social_post_likes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own likes" on public.social_post_likes;
create policy "Users can remove their own likes"
  on public.social_post_likes
  for delete to authenticated
  using ((select auth.uid()) = user_id);


-- Storage policies for the post-media bucket.
-- Create the bucket in Storage first and mark it Public.
drop policy if exists "Users upload post media to their own folder" on storage.objects;
create policy "Users upload post media to their own folder"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users delete their own post media" on storage.objects;
create policy "Users delete their own post media"
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
