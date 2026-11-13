-- Allow authenticated users to see profile totals without exposing private posts
-- or private follower/following lists.
create or replace function public.get_profile_stats(target_user_id uuid)
returns table (
  posts_count bigint,
  followers_count bigint,
  following_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  is_blocked boolean := false;
begin
  if viewer_id is null or target_user_id is null then
    return;
  end if;

  if to_regclass('public.blocks') is not null then
    execute
      'select exists (
         select 1 from public.blocks b
         where (b.blocker_id = $1 and b.blocked_id = $2)
            or (b.blocker_id = $2 and b.blocked_id = $1)
       )'
      into is_blocked
      using viewer_id, target_user_id;

    if is_blocked then
      return;
    end if;
  end if;

  return query
    select
      (select count(*) from public.social_posts p
        where p.user_id = target_user_id),
      (select count(*) from public.user_follows f
        where f.following_id = target_user_id
          and coalesce(f.status, 'accepted') = 'accepted'),
      (select count(*) from public.user_follows f
        where f.follower_id = target_user_id
          and coalesce(f.status, 'accepted') = 'accepted')
    where exists (
      select 1 from public.profiles p where p.id = target_user_id
    );
end;
$$;

revoke all on function public.get_profile_stats(uuid) from public;
grant execute on function public.get_profile_stats(uuid) to authenticated;

notify pgrst, 'reload schema';
