
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

  const { data: follows, error: followError } =
    await supabase
      .from('user_follows')
      .select('following_id')
      .eq('follower_id', currentUserId);

  if (followError) {
    throw followError;
  }

  const userIds = [
    ...new Set([
      currentUserId,
      ...(follows || []).map(
        (row) => row.following_id
      ),
    ]),
  ];

  const { data: storyRows, error: storyError } =
    await supabase
      .from('social_stories')
      .select(
        'id,user_id,media_url,media_path,media_type,audio_url,audio_path,music_title,music_artist,music_source,created_at,expires_at'
      )
      .in('user_id', userIds)
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

  const storyIds = storyRows.map(
    (story) => story.id
  );

  const authorIds = [
    ...new Set(
      storyRows.map((story) => story.user_id)
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

  const grouped = new Map();

  for (const story of storyRows) {
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
