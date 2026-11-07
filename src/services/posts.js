
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';

const POST_BUCKET = 'post-media';

export async function createImagePost({ userId, asset, caption }) {
  if (!userId) throw new Error('You must be logged in to publish a post.');
  if (!asset?.base64) throw new Error('The selected image data is unavailable.');

  const mimeType = asset.mimeType || 'image/jpeg';
  const extension =
    mimeType === 'image/png' ? 'png' :
    mimeType === 'image/webp' ? 'webp' : 'jpg';

  const randomPart = Math.random().toString(36).slice(2, 9);
  const filePath = `${userId}/${Date.now()}-${randomPart}.${extension}`;
  const fileData = decode(asset.base64);

  const { error: uploadError } = await supabase.storage
    .from(POST_BUCKET)
    .upload(filePath, fileData, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage
    .from(POST_BUCKET)
    .getPublicUrl(filePath);

  const mediaUrl = publicData.publicUrl;

  const { data, error } = await supabase
    .from('social_posts')
    .insert({
      user_id: userId,
      caption: (caption || '').trim(),
      media_url: mediaUrl,
      media_path: filePath,
      media_type: 'image',
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(POST_BUCKET).remove([filePath]);
    throw error;
  }

  return data;
}

export async function fetchFeedPosts(currentUserId) {
  if (!currentUserId) return [];

  // 1. Get users followed by the current user
  const { data: followRows, error: followError } = await supabase
    .from('user_follows')
    .select('following_id')
    .eq('follower_id', currentUserId);

  if (followError) throw followError;

  // 2. Home feed includes followed users + current user's own posts
  const feedUserIds = [
    ...new Set([
      currentUserId,
      ...(followRows || []).map((row) => row.following_id),
    ]),
  ];

  // 3. Fetch posts only from those users
  const { data: postRows, error: postError } = await supabase
    .from('social_posts')
    .select('id,user_id,caption,media_url,media_path,media_type,created_at')
    .in('user_id', feedUserIds)
    .order('created_at', { ascending: false })
    .limit(50);

  if (postError) throw postError;
  if (!postRows?.length) return [];

  const postIds = postRows.map((post) => post.id);
  const userIds = [...new Set(postRows.map((post) => post.user_id))];

  // 4. Fetch profiles, likes, comments and saved posts
  const [profilesResult, likesResult, commentsResult, savedResult] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('id,full_name,username,avatar_url')
        .in('id', userIds),

      supabase
        .from('social_post_likes')
        .select('post_id,user_id')
        .in('post_id', postIds),

      supabase
        .from('social_post_comments')
        .select('post_id')
        .in('post_id', postIds),

      supabase
        .from('social_saved_posts')
        .select('post_id')
        .eq('user_id', currentUserId)
        .in('post_id', postIds),
    ]);

  if (profilesResult.error) throw profilesResult.error;
  if (likesResult.error) throw likesResult.error;
  if (commentsResult.error) throw commentsResult.error;
  if (savedResult.error) throw savedResult.error;

  const profileMap = new Map(
    (profilesResult.data || []).map((profile) => [profile.id, profile])
  );

  const likesByPost = new Map();

  for (const like of likesResult.data || []) {
    const current = likesByPost.get(like.post_id) || {
      count: 0,
      likedByMe: false,
    };

    current.count += 1;

    if (like.user_id === currentUserId) {
      current.likedByMe = true;
    }

    likesByPost.set(like.post_id, current);
  }

  const commentCounts = new Map();

  for (const comment of commentsResult.data || []) {
    commentCounts.set(
      comment.post_id,
      (commentCounts.get(comment.post_id) || 0) + 1
    );
  }

  const savedIds = new Set(
    (savedResult.data || []).map((row) => row.post_id)
  );

  // 5. Return complete feed data
  return postRows.map((post) => {
    const likeInfo = likesByPost.get(post.id) || {
      count: 0,
      likedByMe: false,
    };

    return {
      ...post,
      author: profileMap.get(post.user_id) || null,
      like_count: likeInfo.count,
      liked_by_me: likeInfo.likedByMe,
      comment_count: commentCounts.get(post.id) || 0,
      saved_by_me: savedIds.has(post.id),
    };
  });
}

export async function togglePostLike({ postId, userId, currentlyLiked }) {
  if (!userId) throw new Error('You must be logged in to like posts.');

  if (currentlyLiked) {
    const { error } = await supabase
      .from('social_post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);

    if (error) throw error;
    return { liked: false };
  }

  const { error } = await supabase
    .from('social_post_likes')
    .insert({ post_id: postId, user_id: userId });

  if (error && error.code !== '23505') throw error;

  return { liked: true };
}

export async function fetchPostComments(postId) {
  const { data: rows, error } = await supabase
    .from('social_post_comments')
    .select('id,post_id,user_id,body,created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!rows?.length) return [];

  const userIds = [...new Set(rows.map((row) => row.user_id))];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id,full_name,username,avatar_url')
    .in('id', userIds);

  if (profileError) throw profileError;

  const profileMap = new Map(
    (profiles || []).map((profile) => [profile.id, profile])
  );

  return rows.map((comment) => ({
    ...comment,
    author: profileMap.get(comment.user_id) || null,
  }));
}

export async function addPostComment({ postId, userId, body }) {
  const cleanBody = body.trim();

  if (!cleanBody) throw new Error('Write a comment first.');

  if (cleanBody.length > 1000) {
    throw new Error('Comments must be 1,000 characters or fewer.');
  }

  const { data, error } = await supabase
    .from('social_post_comments')
    .insert({
      post_id: postId,
      user_id: userId,
      body: cleanBody,
    })
    .select('id,post_id,user_id,body,created_at')
    .single();

  if (error) throw error;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,full_name,username,avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw profileError;

  return {
    ...data,
    author: profile || null,
  };
}

export async function togglePostSaved({ postId, userId, currentlySaved }) {
  if (!userId) throw new Error('You must be logged in to save posts.');

  if (currentlySaved) {
    const { error } = await supabase
      .from('social_saved_posts')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);

    if (error) throw error;

    return { saved: false };
  }

  const { error } = await supabase
    .from('social_saved_posts')
    .insert({ post_id: postId, user_id: userId });

  if (error && error.code !== '23505') throw error;

  return { saved: true };
}
