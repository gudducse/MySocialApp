-- Record when a private follow request is accepted so the requester can see
-- the acceptance in their activity feed and notification badge.

alter table public.user_follows
  add column if not exists accepted_at timestamptz;

create index if not exists user_follows_acceptance_notifications_idx
  on public.user_follows (follower_id, accepted_at desc)
  where accepted_at is not null;

create or replace function public.enforce_follow_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.follower_id is distinct from old.follower_id
     or new.following_id is distinct from old.following_id then
    raise exception 'Follow participants cannot be changed';
  end if;

  if old.status = 'accepted' and new.status = 'pending' then
    raise exception 'An accepted follow cannot be turned back into a request';
  end if;

  if old.status = 'pending' and new.status = 'accepted' then
    new.accepted_at := now();
  else
    new.accepted_at := old.accepted_at;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_follow_update on public.user_follows;
create trigger enforce_follow_update
  before update on public.user_follows
  for each row execute function public.enforce_follow_update();
