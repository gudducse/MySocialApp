import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../lib/supabase';

const POST_BUCKET = 'post-media';
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const MAX_VIDEO_DURATION = 60 * 1000; // 60 seconds
const BASE_POST_FIELDS = 'id, user_id, caption, media_url, media_path, media_type, created_at';
const COVER_POST_FIELDS = `${BASE_POST_FIELDS}, cover_url, cover_path`;

async function fetchPostRows(buildQuery) {
  let result = await buildQuery(COVER_POST_FIELDS);
  if (
    result.error &&
    /cover_(url|path).*(does not exist|schema cache)|column .*cover_(url|path)/i.test(
      result.error.message || ''
    )
  ) {
    result = await buildQuery(BASE_POST_FIELDS);
  }
  if (result.error) throw result.error;
  return signPostMedia(result.data || []);
}

export async function signPostMedia(posts) {
  return Promise.all((posts || []).map(async (post) => {
    const mediaResult = post.media_path
      ? await supabase.storage.from(POST_BUCKET).createSignedUrl(post.media_path, 60 * 60)
      : null;
    if (mediaResult?.error) throw mediaResult.error;

    const coverResult = post.cover_path
      ? await supabase.storage.from(POST_BUCKET).createSignedUrl(post.cover_path, 60 * 60)
      : null;
    if (coverResult?.error) throw coverResult.error;

    return {
      ...post,
      media_url: mediaResult?.data?.signedUrl || post.media_url,
      cover_url: coverResult?.data?.signedUrl || post.cover_url || null,
    };
  }));
}

// ------------------------------
// Common upload helper
// ------------------------------

function getFileExtension(asset, mediaType) {
  const uriExtension = asset?.uri?.split('?')[0]?.split('.').pop();

  if (uriExtension && uriExtension.length <= 5) {
    return uriExtension.toLowerCase();
  }

  if (mediaType === 'video') return 'mp4';

  const mime = (asset?.mimeType || '').toLowerCase();

  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';

  return 'jpg';
}

function getContentType(asset, mediaType, extension) {
  const mime = (asset?.mimeType || '').toLowerCase();

  if (mime && mime.includes('/')) {
    return mime;
  }

  if (mediaType === 'video') {
    if (extension === 'mov') return 'video/quicktime';
    if (extension === 'webm') return 'video/webm';
    return 'video/mp4';
  }

  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';

  return 'image/jpeg';
}

export async function uploadPostMedia({ userId, asset, mediaType }) {
  if (!userId) throw new Error('User ID is missing.');
  if (!asset?.uri) throw new Error('Please select a media file.');

  if (asset.fileSize && asset.fileSize > MAX_FILE_SIZE) {
    throw new Error('File size must be 15 MB or less.');
  }

  if (
    mediaType === 'video' &&
    asset.duration &&
    asset.duration > MAX_VIDEO_DURATION
  ) {
    throw new Error('Video must be 60 seconds or less.');
  }

  const extension = getFileExtension(asset, mediaType);
  const contentType = getContentType(asset, mediaType, extension);

  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const filePath = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(POST_BUCKET)
    .upload(filePath, decode(base64), {
      contentType,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage
    .from(POST_BUCKET)
    .getPublicUrl(filePath);

  return {
    media_url: publicUrlData.publicUrl,
    media_path: filePath,
  };
}

// ------------------------------
// Create image post
// ------------------------------

export async function createImagePost({ userId, asset, caption }) {
  const media = await uploadPostMedia({
    userId,
    asset,
    mediaType: 'image',
  });

  const { data, error } = await supabase
    .from('social_posts')
    .insert({
      user_id: userId,
      caption: caption?.trim() || '',
      media_url: media.media_url,
      media_path: media.media_path,
      media_type: 'image',
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(POST_BUCKET).remove([media.media_path]);
    throw error;
  }

  return data;
}

// ------------------------------
// Create video post
// ------------------------------

export async function createVideoPost({ userId, asset, caption, coverAsset = null }) {
  const media = await uploadPostMedia({
    userId,
    asset,
    mediaType: 'video',
  });

  let cover = null;
  try {
    if (coverAsset) {
      cover = await uploadPostMedia({
        userId,
        asset: coverAsset,
        mediaType: 'image',
      });
    }

    const { data, error } = await supabase
      .from('social_posts')
      .insert({
        user_id: userId,
        caption: caption?.trim() || '',
        media_url: media.media_url,
        media_path: media.media_path,
        media_type: 'video',
        ...(cover ? {
          cover_url: cover.media_url,
          cover_path: cover.media_path,
        } : {}),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    await supabase.storage
      .from(POST_BUCKET)
      .remove([media.media_path, cover?.media_path].filter(Boolean));
    throw error;
  }
}

// ------------------------------
// Fetch Home feed
// ------------------------------

export async function fetchFeedPosts(currentUserId) {
  if (!currentUserId) {
    throw new Error('User ID is missing.');
  }

  // 1. Get accepted followed users (ignore pending follow requests).
  let followResult = await supabase
    .from('user_follows')
    .select('following_id')
    .eq('follower_id', currentUserId)
    .eq('status', 'accepted');

  if (
    followResult.error &&
    /status.*(does not exist|schema cache)|column .*status/i.test(
      followResult.error.message || ''
    )
  ) {
    followResult = await supabase
      .from('user_follows')
      .select('following_id')
      .eq('follower_id', currentUserId);
  }

  const followRows = followResult.data;
  const followError = followResult.error;

  if (followError) throw followError;

  const followingIds = (followRows || [])
    .map((row) => row.following_id)
    .filter(Boolean);

  // Hide posts from muted accounts.
  let mutedIds = [];
  try {
    const { data: mutes } = await supabase
      .from('mutes')
      .select('target_id')
      .eq('muter_id', currentUserId)
      .eq('mute_posts', true);
    mutedIds = (mutes || []).map((row) => row.target_id);
  } catch {
    // Safety SQL not applied yet.
  }

  // Include your own posts
  const authorIds = [
    ...new Set([currentUserId, ...followingIds]),
  ].filter((id) => !mutedIds.includes(id));

  // 2. Fetch posts without a foreign-key profile join
  const posts = await fetchPostRows((fields) => supabase
    .from('social_posts')
    .select(fields)
    .in('user_id', authorIds)
    .order('created_at', { ascending: false }));

  if (!posts || posts.length === 0) {
    return [];
  }

  const postIds = posts.map((post) => post.id);

  const postUserIds = [
    ...new Set(posts.map((post) => post.user_id).filter(Boolean)),
  ];

  // 3. Fetch profiles separately
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .in('id', postUserIds);

  if (profilesError) throw profilesError;

  const profileMap = {};

  (profiles || []).forEach((profile) => {
    profileMap[profile.id] = profile;
  });

  // 4. Fetch likes
  const { data: likes, error: likesError } = await supabase
    .from('social_post_likes')
    .select('post_id, user_id')
    .in('post_id', postIds);

  if (likesError) throw likesError;

  // 5. Fetch comments
  const { data: commentRows, error: commentsError } = await supabase
    .from('social_post_comments')
    .select('post_id')
    .in('post_id', postIds);

  if (commentsError) throw commentsError;

  // 6. Fetch saved posts
  const { data: savedRows, error: savedError } = await supabase
    .from('social_saved_posts')
    .select('post_id')
    .eq('user_id', currentUserId)
    .in('post_id', postIds);

  if (savedError) throw savedError;

  // 7. Prepare counts
  const likeCounts = {};
  const commentCounts = {};
  const likedPosts = new Set();
  const savedPosts = new Set();

  (likes || []).forEach((like) => {
    likeCounts[like.post_id] =
      (likeCounts[like.post_id] || 0) + 1;

    if (like.user_id === currentUserId) {
      likedPosts.add(like.post_id);
    }
  });

  (commentRows || []).forEach((comment) => {
    commentCounts[comment.post_id] =
      (commentCounts[comment.post_id] || 0) + 1;
  });

  (savedRows || []).forEach((saved) => {
    savedPosts.add(saved.post_id);
  });

  // 8. Return HomeScreen-compatible data
  return posts.map((post) => ({
    ...post,

    author: profileMap[post.user_id] || {
      id: post.user_id,
      username: 'user',
      full_name: 'User',
      avatar_url: null,
    },

    like_count: likeCounts[post.id] || 0,
    comment_count: commentCounts[post.id] || 0,

    liked_by_me: likedPosts.has(post.id),
    saved_by_me: savedPosts.has(post.id),
  }));
}

// ------------------------------
// Like / Unlike post
// ------------------------------

export async function togglePostLike({
  postId,
  userId,
  currentlyLiked,
}) {
  if (!postId || !userId) {
    throw new Error('Post ID or User ID is missing.');
  }

  if (currentlyLiked) {
    const { error } = await supabase
      .from('social_post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);

    if (error) throw error;

    return false;
  }

  const { error } = await supabase
    .from('social_post_likes')
    .insert({
      post_id: postId,
      user_id: userId,
    });

  if (error) throw error;

  return true;
}

// ------------------------------
// Fetch post comments
// ------------------------------

export async function fetchPostComments(postId) {
  if (!postId) throw new Error('Post ID is missing.');

  const baseFields = 'id, post_id, user_id, body, created_at';
  const extendedFields = `${baseFields}, is_hidden, edited_at`;

  let { data: comments, error } = await supabase
    .from('social_post_comments')
    .select(extendedFields)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  // Older databases may not have run comment_management.sql yet. Keep the
  // comment wall working instead of failing the whole screen.
  const missingNewColumns =
    error &&
    (error.code === '42703' ||
      /column .* does not exist|is_hidden|edited_at/i.test(error.message || ''));

  if (missingNewColumns) {
    const fallback = await supabase
      .from('social_post_comments')
      .select(baseFields)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    comments = (fallback.data || []).map((comment) => ({
      ...comment,
      is_hidden: false,
      edited_at: null,
    }));
    error = fallback.error;
  }

  if (error) throw error;

  if (!comments || comments.length === 0) {
    return [];
  }

  const userIds = [
    ...new Set(comments.map((comment) => comment.user_id).filter(Boolean)),
  ];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .in('id', userIds);

  if (profilesError) throw profilesError;

  const profileMap = {};

  (profiles || []).forEach((profile) => {
    profileMap[profile.id] = profile;
  });

  return comments.map((comment) => ({
    ...comment,
    author: profileMap[comment.user_id] || {
      id: comment.user_id,
      username: 'user',
      full_name: 'User',
      avatar_url: null,
    },
  }));
}

// ------------------------------
// Add comment
// ------------------------------

export async function addPostComment({ postId, userId, body }) {
  if (!postId || !userId) {
    throw new Error('Post ID or User ID is missing.');
  }

  const cleanBody = body?.trim();

  if (!cleanBody) {
    throw new Error('Comment cannot be empty.');
  }

  const { data: comment, error } = await supabase
    .from('social_post_comments')
    .insert({
      post_id: postId,
      user_id: userId,
      body: cleanBody,
    })
    .select('id, post_id, user_id, body, created_at')
    .single();

  if (error) throw error;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw profileError;

  return {
    ...comment,
    is_hidden: false,
    edited_at: null,
    author: profile || {
      id: userId,
      username: 'user',
      full_name: 'User',
      avatar_url: null,
    },
  };
}

// ------------------------------
// Edit / hide / delete a comment
// ------------------------------

const COMMENT_FIELDS =
  'id, post_id, user_id, body, created_at, is_hidden, edited_at';

export async function updatePostComment({ commentId, userId, body }) {
  if (!commentId || !userId) {
    throw new Error('Comment ID or User ID is missing.');
  }

  const cleanBody = body?.trim();

  if (!cleanBody) {
    throw new Error('Comment cannot be empty.');
  }

  if (cleanBody.length > 1000) {
    throw new Error('Comments can contain up to 1,000 characters.');
  }

  const { data, error } = await supabase
    .from('social_post_comments')
    .update({ body: cleanBody })
    .eq('id', commentId)
    .eq('user_id', userId)
    .select(COMMENT_FIELDS)
    .single();

  if (error) throw error;

  return data;
}

export async function setPostCommentHidden({ commentId, hidden }) {
  if (!commentId) {
    throw new Error('Comment ID is missing.');
  }

  const { data, error } = await supabase
    .from('social_post_comments')
    .update({ is_hidden: Boolean(hidden) })
    .eq('id', commentId)
    .select(COMMENT_FIELDS)
    .single();

  if (error) throw error;

  return data;
}

export async function deletePostComment({ commentId }) {
  if (!commentId) {
    throw new Error('Comment ID is missing.');
  }

  // Row-level security allows the comment author and the post owner.
  const { error } = await supabase
    .from('social_post_comments')
    .delete()
    .eq('id', commentId);

  if (error) throw error;

  return true;
}

// ------------------------------
// Save / Unsave post
// ------------------------------

export async function togglePostSaved({
  postId,
  userId,
  currentlySaved,
}) {
  if (!postId || !userId) {
    throw new Error('Post ID or User ID is missing.');
  }

  if (currentlySaved) {
    const { error } = await supabase
      .from('social_saved_posts')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);

    if (error) throw error;

    return false;
  }

  const { error } = await supabase
    .from('social_saved_posts')
    .insert({
      post_id: postId,
      user_id: userId,
    });

  if (error) throw error;

  return true;
}

// ------------------------------
// Delete post
// ------------------------------

export async function deletePost({ postId, userId, mediaPath, coverPath }) {
  if (!postId || !userId) {
    throw new Error('Post ID or User ID is missing.');
  }

  const { error } = await supabase
    .from('social_posts')
    .delete()
    .eq('id', postId)
    .eq('user_id', userId);

  if (error) throw error;

  const pathsToRemove = [mediaPath, coverPath].filter(Boolean);
  if (pathsToRemove.length) {
    try {
      await supabase.storage.from(POST_BUCKET).remove(pathsToRemove);
    } catch (storageError) {
      console.warn('Failed to remove media from storage:', storageError.message);
    }
  }

  return true;
}

// ------------------------------
// Fetch user's posts
// ------------------------------

export async function fetchUserPosts(targetUserId) {
  if (!targetUserId) return [];

  return fetchPostRows((fields) => supabase
    .from('social_posts')
    .select(fields)
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false }));
}

export async function fetchSharedPost(postId, currentUserId) {
  if (!postId) return null;

  const posts = await fetchPostRows((fields) => supabase
    .from('social_posts')
    .select(fields)
    .eq('id', postId));
  const post = posts[0] || null;
  if (!post) return null;

  const [profileResult, likeResult, commentResult, savedResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .eq('id', post.user_id)
      .maybeSingle(),
    supabase
      .from('social_post_likes')
      .select('user_id')
      .eq('post_id', post.id),
    supabase
      .from('social_post_comments')
      .select('id')
      .eq('post_id', post.id),
    currentUserId
      ? supabase
        .from('social_saved_posts')
        .select('post_id')
        .eq('user_id', currentUserId)
        .eq('post_id', post.id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  for (const result of [profileResult, likeResult, commentResult, savedResult]) {
    if (result.error) throw result.error;
  }

  const likes = likeResult.data || [];
  return {
    ...post,
    author: profileResult.data || {
      id: post.user_id,
      username: 'user',
      full_name: 'User',
      avatar_url: null,
    },
    like_count: likes.length,
    comment_count: commentResult.data?.length || 0,
    liked_by_me: likes.some((like) => like.user_id === currentUserId),
    saved_by_me: !!savedResult.data,
  };
}

// ------------------------------
// Fetch user's saved posts
// ------------------------------

export async function fetchUserSavedPosts(userId) {
  if (!userId) return [];

  const { data: savedRows, error: savedError } = await supabase
    .from('social_saved_posts')
    .select('post_id, saved_at')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });

  if (savedError) throw savedError;
  if (!savedRows || savedRows.length === 0) return [];

  const postIds = savedRows.map((r) => r.post_id);

  const posts = await fetchPostRows((fields) => supabase
    .from('social_posts')
    .select(fields)
    .in('id', postIds));

  const postMap = {};
  (posts || []).forEach((p) => {
    postMap[p.id] = p;
  });

  return postIds.map((id) => postMap[id]).filter(Boolean);
}

