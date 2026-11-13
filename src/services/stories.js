
import { supabase } from '../../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

const STORY_BUCKET = 'story-media';
const AUDIO_BUCKET = 'story-audio';

// Get file extension
function getExtension(asset, fallback) {
  const name = asset?.name || asset?.fileName || '';

  const fromName = name.includes('.')
    ? name.split('.').pop()
    : '';

  const fromMime = asset?.mimeType
    ?.split('/')
    .pop()
    ?.replace('jpeg', 'jpg');

  return (fromName || fromMime || fallback).toLowerCase();
}

// Read local file and convert Base64 to ArrayBuffer
async function readFileAsArrayBuffer(uri) {
  if (!uri) {
    throw new Error('File URI is missing.');
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (!base64) {
    throw new Error('Selected file is empty or could not be read.');
  }

  return decode(base64);
}

// Upload file to Supabase Storage
async function uploadFile(bucket, path, uri, mimeType) {
  const body = await readFileAsArrayBuffer(uri);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return data.publicUrl;
}

// Upload a new story
export async function uploadStory({
  userId,
  asset,
  audioAsset = null,
  musicTrack = null,
}) {
  if (!userId) {
    throw new Error('You must be logged in.');
  }

  if (!asset?.uri) {
    throw new Error('Please select a photo or video.');
  }

  const mediaType =
    asset.type === 'video' ? 'video' : 'image';

  const mediaMime =
    asset.mimeType ||
    (mediaType === 'video'
      ? 'video/mp4'
      : 'image/jpeg');

  const mediaExtension = getExtension(
    asset,
    mediaType === 'video' ? 'mp4' : 'jpg'
  );

  const unique =
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const mediaPath =
    `${userId}/${unique}.${mediaExtension}`;

  let audioPath = null;
  let audioUrl = musicTrack?.audio_url || null;

  let uploadedMedia = false;
  let uploadedAudio = false;

  try {
    // Upload photo or video
    const mediaUrl = await uploadFile(
      STORY_BUCKET,
      mediaPath,
      asset.uri,
      mediaMime
    );

    uploadedMedia = true;

    // Upload phone-selected music if provided
    if (audioAsset?.uri) {
      const audioMime =
        audioAsset.mimeType || 'audio/mpeg';

      const audioExtension = getExtension(
        audioAsset,
        'mp3'
      );

      audioPath =
        `${userId}/${unique}.${audioExtension}`;

      audioUrl = await uploadFile(
        AUDIO_BUCKET,
        audioPath,
        audioAsset.uri,
        audioMime
      );

      uploadedAudio = true;
    }

    const musicTitle =
      musicTrack?.title ||
      audioAsset?.name ||
      audioAsset?.fileName ||
      null;

    const musicArtist =
      musicTrack?.artist || null;

    const musicSource = musicTrack
      ? 'library'
      : audioAsset
        ? 'upload'
        : null;

    // Save story details in Supabase
    const { data, error } = await supabase
      .from('social_stories')
      .insert({
        user_id: userId,
        media_url: mediaUrl,
        media_path: mediaPath,
        media_type: mediaType,
        audio_url: audioUrl,
        audio_path: audioPath,
        music_title: musicTitle,
        music_artist: musicArtist,
        music_source: musicSource,
        expires_at: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;

  } catch (error) {
    // Clean up uploaded files if story creation fails
    if (uploadedMedia) {
      await supabase.storage
        .from(STORY_BUCKET)
        .remove([mediaPath]);
    }

    if (uploadedAudio && audioPath) {
      await supabase.storage
        .from(AUDIO_BUCKET)
        .remove([audioPath]);
    }

    throw error;
  }
}

// Fetch active music library tracks
export async function fetchMusicLibrary() {
  const { data, error } = await supabase
    .from('social_music_tracks')
    .select(
      'id,title,artist,audio_url,cover_url,duration_seconds'
    )
    .eq('is_active', true)
    .order('title', {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data || [];
}

// Fetch stories from current user and followed users
export async function fetchStories(currentUserId) {
  if (!currentUserId) {
    return [];
  }

  const { data: storyRows, error: storyError } =
    await supabase
      .from('social_stories')
      .select(
        'id,user_id,media_url,media_path,media_type,audio_url,audio_path,music_title,music_artist,music_source,created_at,expires_at'
      )
      .gt(
        'expires_at',
        new Date().toISOString()
      )
      .order('created_at', {
        ascending: true,
      });

  if (storyError) {
    throw storyError;
  }

  if (!storyRows?.length) {
    return [];
  }

  // Generate temporary URLs only for stories the viewer can read.
  const SIGNED_URL_TTL = 60 * 60;

  const storiesWithSignedUrls = await Promise.all(
    storyRows.map(async (story) => {
      if (!story.media_path) {
        throw new Error(
          `Story ${story.id} has no media path.`
        );
      }

      const mediaResult = await supabase.storage
        .from(STORY_BUCKET)
        .createSignedUrl(
          story.media_path,
          SIGNED_URL_TTL
        );

      if (mediaResult.error) {
        throw mediaResult.error;
      }

      let audioUrl = story.audio_url;

      // Sign uploaded phone audio; keep external library URLs unchanged.
      if (story.audio_path) {
        const audioResult = await supabase.storage
          .from(AUDIO_BUCKET)
          .createSignedUrl(
            story.audio_path,
            SIGNED_URL_TTL
          );

        if (audioResult.error) {
          throw audioResult.error;
        }

        audioUrl = audioResult.data.signedUrl;
      }

      return {
        ...story,
        media_url: mediaResult.data.signedUrl,
        audio_url: audioUrl,
      };
    })
  );

  const storyIds = storiesWithSignedUrls.map(
    (story) => story.id
  );

  const authorIds = [
    ...new Set(
      storiesWithSignedUrls.map((story) => story.user_id)
    ),
  ];

  const [profilesResult, viewsResult] =
    await Promise.all([
      supabase
        .from('profiles')
        .select(
          'id,full_name,username,avatar_url'
        )
        .in('id', authorIds),

      supabase
        .from('social_story_views')
        .select('story_id,viewer_id')
        .in('story_id', storyIds),
    ]);

  if (profilesResult.error) {
    throw profilesResult.error;
  }

  if (viewsResult.error) {
    throw viewsResult.error;
  }

  const profileMap = new Map(
    (profilesResult.data || []).map(
      (profile) => [profile.id, profile]
    )
  );

  const viewsByStory = new Map();

  for (const view of viewsResult.data || []) {
    const list =
      viewsByStory.get(view.story_id) || [];

    list.push(view.viewer_id);

    viewsByStory.set(view.story_id, list);
  }

  let mutedStoryIds = new Set();
  try {
    const { data: mutes } = await supabase
      .from('mutes')
      .select('target_id')
      .eq('muter_id', currentUserId)
      .eq('mute_stories', true);
    mutedStoryIds = new Set((mutes || []).map((row) => row.target_id));
  } catch {
    // Safety SQL not applied yet.
  }

  const grouped = new Map();

  for (const story of storiesWithSignedUrls) {
    if (mutedStoryIds.has(story.user_id)) continue;
    const views =
      viewsByStory.get(story.id) || [];

    const group =
      grouped.get(story.user_id) || {
        userId: story.user_id,
        user:
          profileMap.get(story.user_id) || null,
        stories: [],
      };

    group.stories.push({
      ...story,
      viewed_by_me:
        views.includes(currentUserId),
      view_count: views.length,
    });

    grouped.set(story.user_id, group);
  }

  return Array.from(grouped.values()).map(
    (group) => ({
      ...group,

      isOwn:
        group.userId === currentUserId,

      hasUnseen:
        group.userId !== currentUserId &&
        group.stories.some(
          (story) => !story.viewed_by_me
        ),
    })
  );
}

// Mark story as viewed
export async function markStoryViewed({
  storyId,
  viewerId,
}) {
  if (!storyId || !viewerId) {
    return;
  }

  const { error } = await supabase
    .from('social_story_views')
    .insert({
      story_id: storyId,
      viewer_id: viewerId,
    });

  if (error && error.code !== '23505') {
    throw error;
  }
}

export async function sendStoryReply({
  storyId,
  senderId,
  recipientId,
  body,
}) {
  const cleanBody = body?.trim();
  if (!storyId || !senderId || !recipientId || !cleanBody) {
    throw new Error('Story reply details are missing.');
  }
  if (cleanBody.length > 1000) {
    throw new Error('Story replies can contain up to 1,000 characters.');
  }

  const { data, error } = await supabase
    .from('social_story_replies')
    .insert({
      story_id: storyId,
      sender_id: senderId,
      recipient_id: recipientId,
      body: cleanBody,
    })
    .select('id, story_id, sender_id, recipient_id, body, created_at')
    .single();

  if (error) throw normalizeStoryRepliesError(error);
  return data;
}

function normalizeStoryRepliesError(error) {
  const missingTable =
    error?.code === 'PGRST205' ||
    /social_story_replies.*(schema cache|does not exist|could not find)/i.test(
      error?.message || ''
    );

  if (missingTable) {
    return new Error(
      'Story replies are not enabled in the database yet. Run supabase/story_replies.sql in the Supabase SQL Editor, then retry.'
    );
  }

  return error;
}

export async function fetchStoryReplies(storyId) {
  if (!storyId) return [];

  const { data, error } = await supabase
    .from('social_story_replies')
    .select('id, story_id, sender_id, recipient_id, body, created_at')
    .eq('story_id', storyId)
    .order('created_at', { ascending: true });

  if (error) throw normalizeStoryRepliesError(error);
  if (!data?.length) return [];

  const senderIds = [...new Set(data.map((reply) => reply.sender_id))];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .in('id', senderIds);

  if (profilesError) throw profilesError;

  const profileById = new Map(
    (profiles || []).map((profile) => [profile.id, profile])
  );

  return data.map((reply) => ({
    ...reply,
    sender: profileById.get(reply.sender_id) || null,
  }));
}

export async function fetchStoryViewers(storyId) {
  if (!storyId) return [];

  const { data, error } = await supabase
    .from('social_story_views')
    .select('viewer_id, viewed_at')
    .eq('story_id', storyId)
    .order('viewed_at', { ascending: false });

  if (error) throw error;
  if (!data?.length) return [];

  const viewerIds = [...new Set(data.map((view) => view.viewer_id))];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .in('id', viewerIds);

  if (profilesError) throw profilesError;

  const profileById = new Map(
    (profiles || []).map((profile) => [profile.id, profile])
  );

  return data.map((view) => ({
    ...view,
    profile: profileById.get(view.viewer_id) || null,
  }));
}

export async function fetchStoryLikes(storyId) {
  if (!storyId) return [];

  const { data, error } = await supabase
    .from('social_story_likes')
    .select('user_id, created_at')
    .eq('story_id', storyId)
    .order('created_at', { ascending: false });

  if (error) throw normalizeStoryLikesError(error);
  if (!data?.length) return [];

  const userIds = [...new Set(data.map((like) => like.user_id))];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .in('id', userIds);

  if (profilesError) throw profilesError;

  const profileById = new Map(
    (profiles || []).map((profile) => [profile.id, profile])
  );

  return data.map((like) => ({
    ...like,
    profile: profileById.get(like.user_id) || null,
  }));
}

function normalizeStoryLikesError(error) {
  const missingTable =
    error?.code === 'PGRST205' ||
    /social_story_likes.*(schema cache|does not exist|could not find)/i.test(
      error?.message || ''
    );

  if (missingTable) {
    return new Error(
      'Story likes are not enabled in the database yet. Run supabase/story_replies.sql in the Supabase SQL Editor, then retry.'
    );
  }

  return error;
}

export async function setStoryLike({ storyId, userId, liked }) {
  if (!storyId || !userId) {
    throw new Error('Story like details are missing.');
  }

  const result = liked
    ? await supabase
        .from('social_story_likes')
        .upsert(
          { story_id: storyId, user_id: userId },
          { onConflict: 'story_id,user_id', ignoreDuplicates: true }
        )
    : await supabase
        .from('social_story_likes')
        .delete()
        .eq('story_id', storyId)
        .eq('user_id', userId);

  if (result.error) throw normalizeStoryLikesError(result.error);
}

// Delete a story and its storage files
export async function deleteStory({
  storyId,
  userId,
  mediaPath,
  audioPath,
}) {
  if (!userId || !storyId) {
    throw new Error(
      'Missing story information.'
    );
  }

  const { error } = await supabase
    .from('social_stories')
    .delete()
    .eq('id', storyId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  const mediaRemoval = mediaPath
    ? supabase.storage
        .from(STORY_BUCKET)
        .remove([mediaPath])
    : Promise.resolve({ error: null });

  const audioRemoval = audioPath
    ? supabase.storage
        .from(AUDIO_BUCKET)
        .remove([audioPath])
    : Promise.resolve({ error: null });

  const [mediaResult, audioResult] =
    await Promise.all([
      mediaRemoval,
      audioRemoval,
    ]);

  if (mediaResult.error) {
    throw mediaResult.error;
  }

  if (audioResult.error) {
    throw audioResult.error;
  }

  return true;
}
