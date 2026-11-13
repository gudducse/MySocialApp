import { supabase } from '../../lib/supabase';

function missingTable(error) {
  return /relation .* does not exist|schema cache|does not exist/i.test(
    error?.message || ''
  );
}

export async function getRelationship(userId, targetId) {
  const empty = {
    blocked: false,
    blockedByThem: false,
    muted: false,
    mutePosts: false,
    muteStories: false,
    restricted: false,
  };

  if (!userId || !targetId || userId === targetId) return empty;

  try {
    const [
      { data: blockedRow },
      { data: blockedByRow },
      { data: muteRow },
      { data: restrictRow },
    ] = await Promise.all([
      supabase
        .from('blocks')
        .select('blocker_id')
        .eq('blocker_id', userId)
        .eq('blocked_id', targetId)
        .maybeSingle(),
      supabase
        .from('blocks')
        .select('blocker_id')
        .eq('blocker_id', targetId)
        .eq('blocked_id', userId)
        .maybeSingle(),
      supabase
        .from('mutes')
        .select('mute_posts, mute_stories')
        .eq('muter_id', userId)
        .eq('target_id', targetId)
        .maybeSingle(),
      supabase
        .from('restrictions')
        .select('restrictor_id')
        .eq('restrictor_id', userId)
        .eq('restricted_id', targetId)
        .maybeSingle(),
    ]);

    return {
      blocked: Boolean(blockedRow),
      blockedByThem: Boolean(blockedByRow),
      muted: Boolean(muteRow),
      mutePosts: Boolean(muteRow?.mute_posts),
      muteStories: Boolean(muteRow?.mute_stories),
      restricted: Boolean(restrictRow),
    };
  } catch {
    return empty;
  }
}

export async function blockUser(targetId) {
  const { error } = await supabase.rpc('block_user', {
    target_id: targetId,
  });

  if (error) throw error;
}

export async function unblockUser(targetId) {
  const { error } = await supabase.rpc('unblock_user', {
    target_id: targetId,
  });

  if (error) throw error;
}

export async function setUserMute(targetId, mutePosts, muteStories) {
  const { error } = await supabase.rpc('set_user_mute', {
    target_id: targetId,
    mute_posts: Boolean(mutePosts),
    mute_stories: Boolean(muteStories),
  });

  if (error) throw error;
}

export async function setUserRestrict(targetId, restricted) {
  const { error } = await supabase.rpc('set_user_restrict', {
    target_id: targetId,
    restricted: Boolean(restricted),
  });

  if (error) throw error;
}

export async function getMutedIds(userId, kind = 'posts') {
  if (!userId) return [];

  try {
    const column = kind === 'stories' ? 'mute_stories' : 'mute_posts';

    const { data, error } = await supabase
      .from('mutes')
      .select('target_id')
      .eq('muter_id', userId)
      .eq(column, true);

    if (error) throw error;

    return (data || []).map((row) => row.target_id);
  } catch (error) {
    if (missingTable(error)) return [];
    console.warn('Could not load muted accounts:', error.message);
    return [];
  }
}

export async function getBlockedUsers(userId) {
  if (!userId) return [];

  try {
    const { data, error } = await supabase.rpc('get_blocked_users');

    if (!error && data) {
      return data.map((profile) => ({
        id: profile.id,
        user: profile,
      }));
    }
  } catch {
    // Fall through to the direct query below.
  }

  try {
    const { data: blocks, error } = await supabase
      .from('blocks')
      .select('blocked_id, created_at')
      .eq('blocker_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!blocks?.length) return [];

    const ids = blocks.map((row) => row.blocked_id);

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .in('id', ids);

    if (profilesError) throw profilesError;

    const map = Object.fromEntries(
      (profiles || []).map((profile) => [profile.id, profile])
    );

    return blocks.map((row) => ({
      id: row.blocked_id,
      user: map[row.blocked_id] || {
        id: row.blocked_id,
        username: 'user',
        full_name: 'User',
      },
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    console.warn('Could not load blocked accounts:', error.message);
    return [];
  }
}
