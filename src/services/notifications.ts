import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MISSING_STATUS = /status.*(does not exist|schema cache)|column .*status/i;
const MISSING_COMMENT_FIELDS = /is_hidden|hidden_at|hidden_by|edited_at/i;
const MISSING_STORY_LIKES =
  /social_story_likes.*(schema cache|does not exist|could not find)/i;
const LAST_READ_KEY = (userId: string) => `@notification_last_read_${userId}`;

export async function markNotificationsRead(
  userId: string,
  readAt = new Date().toISOString()
): Promise<void> {
  if (!userId) return;
  await AsyncStorage.setItem(LAST_READ_KEY(userId), readAt);
}

export async function fetchNotificationCount(
  userId: string,
  since?: string | null
): Promise<number> {
  if (!userId) return 0;
  const lastReadAt = since === undefined
    ? await AsyncStorage.getItem(LAST_READ_KEY(userId))
    : since;

  const [postsResult, followsResult] = await Promise.all([
    supabase
      .from('social_posts')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('user_follows')
      .select('id, status')
      .eq('following_id', userId)
      .or('status.eq.accepted,status.eq.pending,status.is.null')
      .gt('created_at', lastReadAt || '1970-01-01T00:00:00.000Z'),
  ]);

  if (postsResult.error) throw postsResult.error;
  const acceptedFollowsResult = await supabase
    .from('user_follows')
    .select('id')
    .eq('follower_id', userId)
    .eq('status', 'accepted')
    .gt('accepted_at', lastReadAt || '1970-01-01T00:00:00.000Z');
  if (acceptedFollowsResult.error) {
    if (/accepted_at/i.test(acceptedFollowsResult.error.message || '')) {
      throw new Error(
        'Follow acceptance notifications are not set up yet. Run supabase/follow_request_acceptance_notifications.sql in the Supabase SQL Editor.'
      );
    }
    throw acceptedFollowsResult.error;
  }

  let follows = followsResult.data;
  if (followsResult.error) {
    if (!MISSING_STATUS.test(followsResult.error.message || '')) {
      throw followsResult.error;
    }

    const fallback = await supabase
      .from('user_follows')
      .select('id')
      .eq('following_id', userId)
      .gt('created_at', lastReadAt || '1970-01-01T00:00:00.000Z');
    if (fallback.error) throw fallback.error;
    follows = (fallback.data || []).map((row) => ({
      ...row,
      status: 'accepted' as const,
    }));
  }

  const postIds = (postsResult.data || []).map((post) => post.id);
  let postLikeCount = 0;
  let commentCount = 0;
  if (postIds.length) {
    const [likesResult, commentsResult] = await Promise.all([
      supabase
        .from('social_post_likes')
        .select('post_id')
        .in('post_id', postIds)
        .neq('user_id', userId)
        .gt('created_at', lastReadAt || '1970-01-01T00:00:00.000Z'),
      supabase
        .from('social_post_comments')
        .select('id, is_hidden, created_at')
        .eq('is_hidden', false)
        .in('post_id', postIds)
        .neq('user_id', userId)
        .gt('created_at', lastReadAt || '1970-01-01T00:00:00.000Z'),
    ]);

    if (likesResult.error) throw likesResult.error;
    postLikeCount = likesResult.data?.length || 0;

    let comments = commentsResult.data;
    if (commentsResult.error) {
      const message = commentsResult.error.message || '';
      if (
        !MISSING_COMMENT_FIELDS.test(message) ||
        !/(does not exist|schema cache|could not find)/i.test(message)
      ) {
        throw commentsResult.error;
      }

      const fallback = await supabase
        .from('social_post_comments')
        .select('id, created_at')
        .in('post_id', postIds)
        .neq('user_id', userId)
        .gt('created_at', lastReadAt || '1970-01-01T00:00:00.000Z');
      if (fallback.error) throw fallback.error;
      comments = (fallback.data || []).map((row) => ({
        ...row,
        is_hidden: false,
      }));
    }
    commentCount = comments?.length || 0;
  }

  const { data: stories, error: storiesError } = await supabase
    .from('social_stories')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (storiesError) throw storiesError;

  const storyIds = (stories || []).map((story) => story.id);
  let storyLikeCount = 0;
  if (storyIds.length) {
    const storyLikesResult = await supabase
      .from('social_story_likes')
      .select('story_id')
      .in('story_id', storyIds)
      .neq('user_id', userId)
      .gt('created_at', lastReadAt || '1970-01-01T00:00:00.000Z');

    if (
      storyLikesResult.error &&
      !MISSING_STORY_LIKES.test(storyLikesResult.error.message || '')
    ) {
      throw storyLikesResult.error;
    }
    storyLikeCount = storyLikesResult.data?.length || 0;
  }

  return (
    (follows?.length || 0) +
    (acceptedFollowsResult.data?.length || 0) +
    postLikeCount +
    commentCount +
    storyLikeCount
  );
}
