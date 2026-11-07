
import { supabase } from '../../lib/supabase';

// Check whether the current user follows another user
export async function checkIsFollowing(userId, targetUserId) {
  if (!userId || !targetUserId || userId === targetUserId) {
    return false;
  }

  const { data, error } = await supabase
    .from('user_follows')
    .select('id')
    .eq('follower_id', userId)
    .eq('following_id', targetUserId)
    .maybeSingle();

  if (error) throw error;

  return !!data;
}

// Get followers and following counts
export async function getFollowCounts(userId) {
  if (!userId) {
    return { followers: 0, following: 0 };
  }

  const [followersResult, followingResult] = await Promise.all([
    supabase
      .from('user_follows')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', userId),

    supabase
      .from('user_follows')
      .select('id', { count: 'exact', head: true })
      .eq('follower_id', userId),
  ]);

  if (followersResult.error) throw followersResult.error;
  if (followingResult.error) throw followingResult.error;

  return {
    followers: followersResult.count || 0,
    following: followingResult.count || 0,
  };
}

// Follow or unfollow a user
export async function toggleFollow(userId, targetUserId) {
  if (!userId || !targetUserId) {
    throw new Error('User information is missing.');
  }

  if (userId === targetUserId) {
    throw new Error('You cannot follow yourself.');
  }

  const alreadyFollowing = await checkIsFollowing(
    userId,
    targetUserId
  );

  if (alreadyFollowing) {
    const { error } = await supabase
      .from('user_follows')
      .delete()
      .eq('follower_id', userId)
      .eq('following_id', targetUserId);

    if (error) throw error;

    return false;
  }

  const { error } = await supabase
    .from('user_follows')
    .insert({
      follower_id: userId,
      following_id: targetUserId,
    });

  if (error) throw error;

  return true;
}
