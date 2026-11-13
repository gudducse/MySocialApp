import { supabase } from '../../lib/supabase';

type UserId = string;
type OptionalUserId = UserId | null | undefined;

export type FollowState = 'none' | 'pending' | 'accepted';

const MISSING_STATUS = /status.*(does not exist|schema cache)|column .*status/i;

async function getFollowRow(userId: UserId, targetUserId: UserId) {
  const { data, error } = await supabase
    .from('user_follows')
    .select('id, status')
    .eq('follower_id', userId)
    .eq('following_id', targetUserId)
    .maybeSingle();

  if (!error) {
    if (!data) return null;
    return { id: data.id, status: (data.status || 'accepted') as FollowState };
  }

  // Older databases without the follow-request migration: treat an existing
  // row as an accepted follow.
  if (MISSING_STATUS.test(error.message || '')) {
    const fallback = await supabase
      .from('user_follows')
      .select('id')
      .eq('follower_id', userId)
      .eq('following_id', targetUserId)
      .maybeSingle();

    if (fallback.error) throw fallback.error;

    return fallback.data
      ? { id: fallback.data.id, status: 'accepted' as FollowState }
      : null;
  }

  throw error;
}

export async function getFollowState(
  userId: OptionalUserId,
  targetUserId: OptionalUserId
): Promise<FollowState> {
  if (!userId || !targetUserId || userId === targetUserId) {
    return 'none';
  }

  const row = await getFollowRow(userId, targetUserId);
  return row?.status || 'none';
}

// Backwards-compatible boolean helper.
export async function checkIsFollowing(
  userId: OptionalUserId,
  targetUserId: OptionalUserId
): Promise<boolean> {
  return (await getFollowState(userId, targetUserId)) === 'accepted';
}

async function countFollows(
  column: 'follower_id' | 'following_id',
  userId: UserId
): Promise<number> {
  const withStatus = await supabase
    .from('user_follows')
    .select('id', { count: 'exact', head: true })
    .eq(column, userId)
    .or('status.eq.accepted,status.is.null');

  if (!withStatus.error) return withStatus.count || 0;

  if (!MISSING_STATUS.test(withStatus.error.message || '')) {
    throw withStatus.error;
  }

  const fallback = await supabase
    .from('user_follows')
    .select('id', { count: 'exact', head: true })
    .eq(column, userId);

  if (fallback.error) throw fallback.error;

  return fallback.count || 0;
}

export async function getFollowCounts(
  userId: OptionalUserId
): Promise<{ followers: number; following: number }> {
  if (!userId) {
    return { followers: 0, following: 0 };
  }

  const [followers, following] = await Promise.all([
    countFollows('following_id', userId),
    countFollows('follower_id', userId),
  ]);

  return { followers, following };
}

export async function getProfileStats(
  userId: UserId,
  allowVisibleProfileFallback = false
): Promise<{
  posts: number;
  followers: number;
  following: number;
}> {
  const loadVisibleStats = async () => {
    const [counts, postsResult] = await Promise.all([
      getFollowCounts(userId),
      supabase
        .from('social_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);
    if (postsResult.error) throw postsResult.error;
    return {
      posts: postsResult.count || 0,
      followers: counts.followers,
      following: counts.following,
    };
  };

  const { data, error } = await supabase.rpc('get_profile_stats', {
    target_user_id: userId,
  });

  if (error) {
    const functionMissing =
      /get_profile_stats/i.test(error.message || '') &&
      /(schema cache|not found|does not exist|could not find)/i.test(
        error.message || ''
      );

    if (!allowVisibleProfileFallback) {
      if (!functionMissing) throw error;
      throw new Error(
        'Profile statistics are not set up yet. Run supabase/profile_stats.sql in the Supabase SQL Editor.'
      );
    }

    return loadVisibleStats();
  }

  const stats = data?.[0];
  if (!stats) {
    if (allowVisibleProfileFallback) return loadVisibleStats();
    throw new Error(
      'Profile statistics are unavailable. Check your profile access and Supabase setup.'
    );
  }
  return {
    posts: stats.posts_count || 0,
    followers: stats.followers_count || 0,
    following: stats.following_count || 0,
  };
}

export async function getFollowUsers(
  userId: OptionalUserId,
  type: 'followers' | 'following'
): Promise<Array<{
  id: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
}>> {
  if (!userId) return [];

  const isFollowers = type === 'followers';
  const relationColumn = isFollowers ? 'follower_id' : 'following_id';
  const filterColumn = isFollowers ? 'following_id' : 'follower_id';
  const selectedColumns = `${relationColumn}, created_at, status`;
  type FollowRelation = {
    follower_id?: string;
    following_id?: string;
  };

  const primary = await supabase
    .from('user_follows')
    .select(selectedColumns)
    .eq(filterColumn, userId)
    .or('status.eq.accepted,status.is.null')
    .order('created_at', { ascending: false });

  let relations = primary.data as unknown as FollowRelation[] | null;
  let queryError = primary.error;
  if (queryError && MISSING_STATUS.test(queryError.message || '')) {
    const fallback = await supabase
      .from('user_follows')
      .select(`${relationColumn}, created_at`)
      .eq(filterColumn, userId)
      .order('created_at', { ascending: false });
    relations = fallback.data as unknown as FollowRelation[] | null;
    queryError = fallback.error;
  }

  if (queryError) throw queryError;

  const ids = [...new Set(
    (relations || [])
      .map((relation) => isFollowers ? relation.follower_id : relation.following_id)
      .filter((id): id is string => Boolean(id))
  )];
  if (!ids.length) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', ids);

  if (profilesError) throw profilesError;

  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  return ids.map((id) => profileById.get(id) || {
    id,
    full_name: 'User',
    username: 'user',
    avatar_url: null,
  });
}

export async function toggleFollow(
  userId: UserId,
  targetUserId: UserId
): Promise<FollowState> {
  if (!userId || !targetUserId) {
    throw new Error('User information is missing.');
  }

  if (userId === targetUserId) {
    throw new Error('You cannot follow yourself.');
  }

  const current = await getFollowState(userId, targetUserId);

  if (current !== 'none') {
    const { error } = await supabase
      .from('user_follows')
      .delete()
      .eq('follower_id', userId)
      .eq('following_id', targetUserId);

    if (error) throw error;

    return 'none';
  }

  const { error } = await supabase
    .from('user_follows')
    .insert({
      follower_id: userId,
      following_id: targetUserId,
    });

  if (error) throw error;

  return getFollowState(userId, targetUserId);
}

export type FollowRequest = {
  id: string;
  created_at?: string;
  user: {
    id: string;
    full_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  };
};

export async function getPendingFollowRequests(
  userId: OptionalUserId
): Promise<FollowRequest[]> {
  if (!userId) return [];

  const { data: requests, error } = await supabase
    .from('user_follows')
    .select('id, follower_id, created_at')
    .eq('following_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    if (MISSING_STATUS.test(error.message || '')) return [];
    throw error;
  }

  const ids = [...new Set((requests || []).map((row) => row.follower_id))];

  if (!ids.length) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', ids);

  if (profilesError) throw profilesError;

  const map = Object.fromEntries(
    (profiles || []).map((profile) => [profile.id, profile])
  );

  return (requests || []).map((request) => ({
    id: request.id,
    created_at: request.created_at,
    user: map[request.follower_id] || {
      id: request.follower_id,
      username: 'user',
      full_name: 'User',
    },
  }));
}

export async function acceptFollowRequest(
  requestId: string,
  userId: UserId
): Promise<void> {
  if (!requestId || !userId) {
    throw new Error('Follow request details are missing.');
  }

  const { error } = await supabase
    .from('user_follows')
    .update({ status: 'accepted' })
    .eq('id', requestId)
    .eq('following_id', userId);

  if (error) throw error;
}

export async function declineFollowRequest(
  requestId: string,
  userId: UserId
): Promise<void> {
  if (!requestId || !userId) {
    throw new Error('Follow request details are missing.');
  }

  const { error } = await supabase
    .from('user_follows')
    .delete()
    .eq('id', requestId)
    .eq('following_id', userId);

  if (error) throw error;
}
