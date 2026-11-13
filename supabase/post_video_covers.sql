-- Optional square cover image for video posts.
-- Existing posts and photo posts remain unchanged.
alter table public.social_posts
  add column if not exists cover_url text,
  add column if not exists cover_path text;
