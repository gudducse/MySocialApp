import { supabase } from '../../lib/supabase';
import { uploadPostMedia } from './posts';

const MEDIA_MESSAGE_PREFIX = 'socialapp-media:';
const STORY_MESSAGE_PREFIX = 'socialapp-story:';

export function encodeDirectMessageMedia(mediaType, mediaUrl, mediaPath) {
  return `${MEDIA_MESSAGE_PREFIX}${JSON.stringify({
    type: mediaType,
    ...(mediaUrl ? { url: mediaUrl } : {}),
    ...(mediaPath ? { path: mediaPath } : {}),
  })}`;
}

export function encodeDirectStoryMessage(story, comment = '') {
  const storyId = story.id || story.storyId;
  const mediaType = story.media_type || story.mediaType;
  const mediaPath = story.media_path || story.path;
  const mediaUrl = story.media_url || story.url;
  const cleanComment = typeof comment === 'string' ? comment.trim() : '';
  return `${STORY_MESSAGE_PREFIX}${JSON.stringify({
    type: 'story',
    storyId,
    mediaType,
    path: mediaPath,
    ...(mediaUrl ? { url: mediaUrl } : {}),
    ...(cleanComment ? { comment: cleanComment } : {}),
  })}`;
}

export function parseDirectMessageMedia(text) {
  if (text?.startsWith(STORY_MESSAGE_PREFIX)) {
    try {
      const value = JSON.parse(text.slice(STORY_MESSAGE_PREFIX.length));
      if (
        value?.type !== 'story' ||
        !value?.storyId ||
        !['image', 'video'].includes(value?.mediaType) ||
        (!value?.url && !value?.path)
      ) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  if (!text?.startsWith(MEDIA_MESSAGE_PREFIX)) return null;
  try {
    const value = JSON.parse(text.slice(MEDIA_MESSAGE_PREFIX.length));
    if (!['image', 'video'].includes(value?.type) || (!value?.url && !value?.path)) return null;
    return value;
  } catch {
    return null;
  }
}

export function getDirectMessagePreview(text) {
  const media = parseDirectMessageMedia(text);
  if (media?.type === 'story') {
    return media.comment ? `📖 Story · ${media.comment}` : '📖 Shared a story';
  }
  if (media?.type === 'image') return '📷 Photo';
  if (media?.type === 'video') return '🎥 Video';
  return text || '';
}

export async function sendDirectMediaMessage({
  conversationId,
  senderId,
  receiverId,
  asset,
  mediaType,
}) {
  const uploaded = await uploadPostMedia({ userId: senderId, asset, mediaType });
  try {
    return await sendDirectMessage({
      conversationId,
      senderId,
      receiverId,
      text: encodeDirectMessageMedia(mediaType, null, uploaded.media_path),
      mediaType,
      mediaPath: uploaded.media_path,
    });
  } catch (error) {
    await supabase.storage.from('post-media').remove([uploaded.media_path]);
    throw error;
  }
}

function requireData(data, error) {
  if (error) throw error;
  return data;
}

async function getBlockedPeerIds(userId) {
  if (!userId) return new Set();

  try {
    const { data, error } = await supabase
      .from('blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

    if (error) throw error;

    return new Set(
      (data || []).map((row) =>
        row.blocker_id === userId ? row.blocked_id : row.blocker_id
      )
    );
  } catch {
    return new Set();
  }
}

export async function getOrCreateConversation(userId, targetUserId) {
  if (!userId || !targetUserId || userId === targetUserId) {
    throw new Error('Choose another signed-in account to start a conversation.');
  }

  try {
    const { data: blockRow } = await supabase
      .from('blocks')
      .select('blocker_id')
      .or(
        `and(blocker_id.eq.${userId},blocked_id.eq.${targetUserId}),and(blocker_id.eq.${targetUserId},blocked_id.eq.${userId})`
      )
      .maybeSingle();

    if (blockRow) {
      throw new Error('You cannot message this account.');
    }
  } catch (error) {
    if (error.message === 'You cannot message this account.') throw error;
    // Blocks table not migrated yet.
  }

  const [participantOne, participantTwo] = [userId, targetUserId].sort();

  const { data: existing, error: lookupError } = await supabase
    .from('social_conversations')
    .select('*')
    .eq('participant_one', participantOne)
    .eq('participant_two', participantTwo)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) return existing;

  const { data: conversation, error: createError } = await supabase
    .from('social_conversations')
    .insert({ participant_one: participantOne, participant_two: participantTwo })
    .select('*')
    .single();

  if (!createError && conversation) return conversation;

  if (createError?.code === '23505') {
    const { data: racedConversation, error: raceLookupError } = await supabase
      .from('social_conversations')
      .select('*')
      .eq('participant_one', participantOne)
      .eq('participant_two', participantTwo)
      .single();

    return requireData(racedConversation, raceLookupError);
  }

  throw createError || new Error('Could not create this conversation.');
}

export async function fetchUserConversations(userId) {
  if (!userId) return [];

  const { data: conversations, error } = await supabase
    .from('social_conversations')
    .select('*')
    .or(`participant_one.eq.${userId},participant_two.eq.${userId}`)
    .order('last_message_at', { ascending: false });

  if (error) throw error;
  if (!conversations?.length) return [];

  const blockedPeerIds = await getBlockedPeerIds(userId);
  const visibleConversations = conversations.filter((conversation) => {
    const otherId =
      conversation.participant_one === userId
        ? conversation.participant_two
        : conversation.participant_one;

    return !blockedPeerIds.has(otherId);
  });

  if (!visibleConversations.length) return [];

  const otherIds = [...new Set(visibleConversations.map((conversation) =>
    conversation.participant_one === userId
      ? conversation.participant_two
      : conversation.participant_one
  ))];

  const conversationIds = visibleConversations.map((conversation) => conversation.id);

  const [
    { data: profiles, error: profilesError },
    { data: unreadMessages, error: unreadError },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .in('id', otherIds),

    supabase
      .from('social_messages')
      .select('conversation_id')
      .eq('receiver_id', userId)
      .is('read_at', null)
      .in('conversation_id', conversationIds),
  ]);

  if (profilesError) throw profilesError;
  if (unreadError) throw unreadError;

  const profileMap = Object.fromEntries(
    (profiles || []).map((profile) => [profile.id, profile])
  );

  const unreadCounts = {};

  (unreadMessages || []).forEach((message) => {
    unreadCounts[message.conversation_id] =
      (unreadCounts[message.conversation_id] || 0) + 1;
  });

  return visibleConversations.map((conversation) => {
    const otherId =
      conversation.participant_one === userId
        ? conversation.participant_two
        : conversation.participant_one;

    return {
      ...conversation,
      last_message: getDirectMessagePreview(conversation.last_message),
      otherUser: profileMap[otherId] || {
        id: otherId,
        username: 'user',
        full_name: 'User',
      },
      unread_count: unreadCounts[conversation.id] || 0,
    };
  });
}

export async function fetchMessages(conversationId) {
  if (!conversationId) return [];

  const { data, error } = await supabase
    .from('social_messages')
    .select('id, conversation_id, sender_id, receiver_id, text, created_at, read_at, edited_at, media_type, media_path')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return Promise.all((data || []).map(signMessageMedia));
}

async function signMessageMedia(message) {
  const media = parseDirectMessageMedia(message.text) || (
    message.media_type && message.media_path
      ? { type: message.media_type, path: message.media_path }
      : null
  );
  if (!media?.path) return message;

  const { data, error } = await supabase.storage
    .from(media.type === 'story' ? 'story-media' : 'post-media')
    .createSignedUrl(media.path, 60 * 60);
  if (error) throw error;

  return {
    ...message,
    text: media.type === 'story'
      ? encodeDirectStoryMessage({ ...media, media_url: data.signedUrl }, media.comment || '')
      : encodeDirectMessageMedia(media.type, data.signedUrl, media.path),
  };
}

export async function updateDirectMessage({ messageId, senderId, text }) {
  const cleanText = text?.trim();
  if (!messageId || !senderId || !cleanText) {
    throw new Error('Message details are missing.');
  }
  if (cleanText.length > 2000) {
    throw new Error('Messages can contain up to 2,000 characters.');
  }

  const { data, error } = await supabase
    .from('social_messages')
    .update({ text: cleanText })
    .eq('id', messageId)
    .eq('sender_id', senderId)
    .select('id, conversation_id, sender_id, receiver_id, text, created_at, read_at, edited_at, media_type, media_path')
    .single();

  if (error) throw error;
  return data;
}

export async function markConversationMessagesRead(conversationId, userId) {
  if (!conversationId || !userId) return;

  const { error } = await supabase
    .from('social_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('receiver_id', userId)
    .is('read_at', null);

  if (error) throw error;
}

export async function sendDirectMessage({
  conversationId,
  senderId,
  receiverId,
  text,
  mediaType = null,
  mediaPath = null,
}) {
  const cleanText = text?.trim() || (
    mediaType ? encodeDirectMessageMedia(mediaType, null, mediaPath) : ''
  );

  if (!cleanText) throw new Error('Message cannot be empty.');
  if (!conversationId || !senderId || !receiverId) {
    throw new Error('Missing conversation or user details.');
  }
  if (cleanText.length > 2000) {
    throw new Error('Messages can contain up to 2,000 characters.');
  }

  const { data, error } = await supabase
    .from('social_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      receiver_id: receiverId,
      text: cleanText,
      ...(mediaType && mediaPath ? {
        media_type: mediaType,
        media_path: mediaPath,
      } : {}),
    })
    .select('id, conversation_id, sender_id, receiver_id, text, created_at, read_at, edited_at, media_type, media_path')
    .single();

  if (error) throw error;

  void supabase
    .from('social_conversations')
    .update({
      last_message: data.text,
      last_message_at: data.created_at,
    })
    .eq('id', conversationId)
    .then(({ error: previewError }) => {
      if (previewError) {
        console.warn(
          'Message delivered, but conversation preview did not update:',
          previewError.message
        );
      }
    })
    .catch((previewError) =>
      console.warn(
        'Message delivered, but conversation preview did not update:',
        previewError?.message
      )
    );

  return mediaPath || parseDirectMessageMedia(cleanText)?.path
    ? signMessageMedia(data)
    : data;
}

// ---------------------------------------------------------------------------
// Unsend + live reactions
// ---------------------------------------------------------------------------

export async function deleteDirectMessage(messageId, senderId, mediaPath) {
  if (!messageId || !senderId) {
    throw new Error('Message ID is missing.');
  }

  const { error } = await supabase
    .from('social_messages')
    .delete()
    .eq('id', messageId)
    .eq('sender_id', senderId);

  if (error) throw error;

  if (mediaPath) {
    const { error: storageError } = await supabase.storage
      .from('post-media')
      .remove([mediaPath]);
    if (storageError) {
      console.warn('Unsent message media could not be removed:', storageError.message);
    }
  }

  return true;
}

export async function fetchMessageReactions(messageIds) {
  const ids = (messageIds || []).filter(Boolean);

  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('social_message_reactions')
    .select('message_id, user_id, emoji, created_at')
    .in('message_id', ids);

  if (error) throw error;

  return data || [];
}

export async function setMessageReaction({
  messageId,
  userId,
  emoji,
}) {
  if (!messageId || !userId || !emoji) {
    throw new Error('Missing message reaction details.');
  }

  const { data: existing, error: lookupError } = await supabase
    .from('social_message_reactions')
    .select('emoji')
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing?.emoji === emoji) {
    const { error: removeError } = await supabase
      .from('social_message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);

    if (removeError) throw removeError;
    return null;
  }

  const { data, error } = await supabase
    .from('social_message_reactions')
    .upsert(
      {
        message_id: messageId,
        user_id: userId,
        emoji,
      },
      { onConflict: 'message_id,user_id' }
    )
    .select('message_id, user_id, emoji, created_at')
    .single();

  if (error) throw error;

  return data;
}


export async function acceptMessageRequest(conversationId) {
  if (!conversationId) {
    throw new Error('Conversation ID is missing.');
  }

  const { error } = await supabase
    .from('social_conversations')
    .update({ request_status: 'accepted' })
    .eq('id', conversationId);

  if (error) throw error;
}

export async function deleteConversation(conversationId) {
  if (!conversationId) {
    throw new Error('Conversation ID is missing.');
  }

  const { error } = await supabase
    .from('social_conversations')
    .delete()
    .eq('id', conversationId);

  if (error) throw error;
}
