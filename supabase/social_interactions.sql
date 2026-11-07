-- social. persistent comments and saved posts
-- Run after the social_posts and social_post_likes tables exist.
-- This migration uses separate table names and does not replace existing tables.

create table if not exists public.social_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists social_post_comments_post_created_idx
  on public.social_post_comments (post_id, created_at asc);

create index if not exists social_post_comments_user_id_idx
  on public.social_post_comments (user_id);

alter table public.social_post_comments enable row level security;

revoke all on table public.social_post_comments from anon;
grant select, insert, update, delete on table public.social_post_comments to authenticated;

drop policy if exists "Authenticated users can read social comments" on public.social_post_comments;
create policy "Authenticated users can read social comments"
  on public.social_post_comments
  for select to authenticated
  using (true);

drop policy if exists "Users can create comments as themselves" on public.social_post_comments;
create policy "Users can create comments as themselves"
  on public.social_post_comments
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own comments" on public.social_post_comments;
create policy "Users can update their own comments"
  on public.social_post_comments
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own comments" on public.social_post_comments;
create policy "Users can delete their own comments"
  on public.social_post_comments
  for delete to authenticated
  using ((select auth.uid()) = user_id);


create table if not exists public.social_saved_posts (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists social_saved_posts_user_saved_idx
  on public.social_saved_posts (user_id, saved_at desc);

alter table public.social_saved_posts enable row level security;

revoke all on table public.social_saved_posts from anon;
grant select, insert, delete on table public.social_saved_posts to authenticated;

drop policy if exists "Users can view their own saved posts" on public.social_saved_posts;
create policy "Users can view their own saved posts"
  on public.social_saved_posts
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can save posts as themselves" on public.social_saved_posts;
create policy "Users can save posts as themselves"
  on public.social_saved_posts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can unsave their own posts" on public.social_saved_posts;
create policy "Users can unsave their own posts"
  on public.social_saved_posts
  for delete to authenticated
  using ((select auth.uid()) = user_id);
