import { useNavigation } from '@react-navigation/native';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Share,
  useWindowDimensions,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { VideoView, useVideoPlayer } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';

import {
  fetchFeedPosts,
  togglePostLike,
  fetchPostComments,
  addPostComment,
  togglePostSaved,
  deletePost,
  fetchSharedPost,
} from '../services/posts';

import {
  uploadStory,
  fetchStories,
  markStoryViewed,
  deleteStory,
  sendStoryReply,
  fetchStoryReplies,
  fetchStoryViewers,
  fetchStoryLikes,
  setStoryLike,
} from '../services/stories';

import UserProfileModal from '../components/UserProfileModal';
import DirectMessagesModal from '../components/DirectMessagesModal';
import {
  fetchUserConversations,
} from '../services/messages';
import NotificationsModal from '../components/NotificationsModal';
import {
  fetchNotificationCount,
  markNotificationsRead,
} from '../services/notifications';
import CommentActionsSheet from '../components/CommentActionsSheet';
import PostDetailModal from '../components/PostDetailModal';
import { getPostShareMessage } from '../services/shareLinks';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function timeAgo(value) {
  if (!value) return '';

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  );

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;

  return `${Math.floor(seconds / 86400)}d`;
}

// --------------------------------------------------
// POST MEDIA — IMAGE + VIDEO
// --------------------------------------------------


function PostMedia({ post, onOpenReel, onLike, liked }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const isVideo = post?.media_type === 'video';
  const { width, height } = useWindowDimensions();
  const [showHeart, setShowHeart] = useState(false);
  const tapTimer = useRef(null);
  const heartTimer = useRef(null);

  const handleMediaTap = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;

      onLike?.(post);
      setShowHeart(true);

      if (heartTimer.current) clearTimeout(heartTimer.current);
      heartTimer.current = setTimeout(() => setShowHeart(false), 650);
      return;
    }

    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      if (isVideo) onOpenReel?.(post);
    }, 280);
  };

  useEffect(() => {
    return () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (heartTimer.current) clearTimeout(heartTimer.current);
    };
  }, []);

  const mediaHeight = isVideo
    ? Math.min(width * (16 / 9), height * 0.78)
    : width;

  const player = useVideoPlayer(
    isVideo ? post.media_url : null,
    (player) => {
      player.loop = false;
      player.muted = true;
      player.pause();
    }
  );

  useEffect(() => {
    if (!isVideo) return;

    try {
      player.pause();
      player.muted = true;
    } catch (error) {}

    return () => {
      try {
        player.pause();
      } catch (error) {}
    };
  }, [player, isVideo]);

  if (!post?.media_url) {
    return (
      <View style={styles.postMediaFallback}>
        <Ionicons name="image-outline" size={35} color={colors.muted} />
        <Text style={styles.stateText}>Media unavailable</Text>
      </View>
    );
  }

  if (isVideo) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleMediaTap}
        style={{ position: 'relative' }}
      >
        <VideoView
          player={player}
          style={[
            styles.postImage,
            {
              height: mediaHeight,
              aspectRatio: undefined,
            },
          ]}
          contentFit="contain"
          nativeControls={false}
          allowsFullscreen={false}
        />

        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {showHeart ? (
            <Text style={{ color: '#FFFFFF', fontSize: 90, textShadowColor: '#ED4956', textShadowRadius: 18 }}>♥</Text>
          ) : (
            <>
              <View
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 29,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="play" size={30} color="#FFFFFF" />
              </View>
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700', marginTop: 8 }}>
                Watch Reel
              </Text>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={handleMediaTap}
      style={{ position: 'relative' }}
    >
      <Image
        source={{ uri: post.media_url }}
        style={[
          styles.postImage,
          {
            height: mediaHeight,
            aspectRatio: undefined,
          },
        ]}
        resizeMode="cover"
      />
      {showHeart && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 100, textShadowColor: '#ED4956', textShadowRadius: 20 }}>♥</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}


// --------------------------------------------------
// STORY MEDIA PLAYER
// --------------------------------------------------

function StoryMedia({ story, isActive }) {
  const styles = useThemedStyles(baseStyles);
  const videoPlayer = useVideoPlayer(
    story?.media_type === 'video' ? story.media_url : null,
    (player) => {
      player.loop = false;
      player.muted = !!story?.audio_url;

      if (story?.media_type === 'video' && isActive) {
        player.play();
      }
    }
  );

  const audioPlayer = useAudioPlayer(
    story?.audio_url
      ? { uri: story.audio_url }
      : null
  );

  useEffect(() => {
    if (story?.media_type === 'video' && isActive) videoPlayer.play();
    else videoPlayer.pause();
    if (story?.audio_url && isActive) {
      audioPlayer.play();
    } else {
      audioPlayer.pause();
    }

    return () => {
      try {
        audioPlayer.pause();
      } catch (error) {}

      try {
        videoPlayer.pause();
      } catch (error) {}
    };
  }, [story?.id, isActive]);

  if (!story) return null;

  if (story.media_type === 'video') {
    return (
      <VideoView
        player={videoPlayer}
        style={styles.viewerMedia}
        contentFit="contain"
        nativeControls={false}
      />
    );
  }

  return (
    <Image
      source={{ uri: story.media_url }}
      style={styles.viewerMedia}
      resizeMode="contain"
    />
  );
}

// --------------------------------------------------
// POST CARD
// --------------------------------------------------


function PostCard({
  post,
  onLike,
  onComments,
  onSave,
  onOpenProfile,
  onOptions,
  onPostLayout,
  onOpenReel,
  liking,
  saving,
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const author = post.author || {};

  const username =
    author.username ||
    author.full_name ||
    `user_${String(post.user_id).slice(0, 6)}`;

  const handleShare = async () => {
    try {
      await Share.share({
        message: getPostShareMessage(post),
      });
    } catch (err) {}
  };

  return (
    <View
      style={styles.post}
      onLayout={(event) =>
        onPostLayout?.(
          post.id,
          post.media_type === 'video',
          event.nativeEvent.layout
        )
      }
    >
      <View style={styles.postHeader}>
        <TouchableOpacity
          style={styles.authorHeaderRow}
          activeOpacity={0.8}
          onPress={() => onOpenProfile?.(post.user_id, author)}
        >
          {author.avatar_url ? (
            <Image
              source={{ uri: author.avatar_url }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Ionicons name="person" size={18} color={colors.muted} />
            </View>
          )}

          <View style={styles.authorInfo}>
            <Text style={styles.username}>{username}</Text>
            <Text style={styles.location}>
              {timeAgo(post.created_at)}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => onOptions?.(post)}>
          <Ionicons
            name="ellipsis-horizontal"
            size={23}
            color={colors.text}
          />
        </TouchableOpacity>
      </View>

      <PostMedia
        post={post}
        onOpenReel={onOpenReel}
        onLike={onLike}
        liked={post.liked_by_me}
      />

      <View style={styles.actions}>
        <View style={styles.leftActions}>
          <TouchableOpacity
            onPress={() => onLike(post)}
            disabled={liking}
          >
            <Ionicons
              name={post.liked_by_me ? 'heart' : 'heart-outline'}
              size={27}
              color={post.liked_by_me ? '#ED4956' : colors.text}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => onComments(post)}>
            <Ionicons
              name="chatbubble-outline"
              size={25}
              color={colors.text}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleShare}>
            <Ionicons
              name="paper-plane-outline"
              size={25}
              color={colors.text}
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => onSave(post)}
          disabled={saving}
        >
          <Ionicons
            name={post.saved_by_me ? 'bookmark' : 'bookmark-outline'}
            size={25}
            color={colors.text}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.details}>
        <Text style={styles.likes}>
          {(post.like_count || 0).toLocaleString()} likes
        </Text>

        {!!post.caption && (
          <Text style={styles.caption}>
            <Text style={styles.captionUser}>{username} </Text>
            {post.caption}
          </Text>
        )}

        <TouchableOpacity onPress={() => onComments(post)}>
          <Text style={styles.comments}>
            {post.comment_count > 0
              ? `View all ${post.comment_count} comments`
              : 'Add a comment'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.timestamp}>
          {timeAgo(post.created_at).toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

// // STORY CIRCLE
// --------------------------------------------------

function StoryItem({ group, onPress, onAdd }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const user = group.user || {};

  const name = group.isOwn
    ? 'Your story'
    : user.username || user.full_name || 'user';

  return (
    <View style={styles.story}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
      >
        <View
          style={[
            styles.storyRing,
            group.hasUnseen
              ? styles.unseenRing
              : styles.seenRing,
          ]}
        >
          {user.avatar_url ? (
            <Image
              source={{ uri: user.avatar_url }}
              style={styles.storyAvatar}
            />
          ) : (
            <View style={styles.storyAvatarFallback}>
              <Ionicons name="person" size={25} color={colors.muted} />
            </View>
          )}
        </View>

        {group.isOwn && (
          <TouchableOpacity
            style={styles.addStoryBadge}
            onPress={onAdd}
          >
            <Ionicons name="add" size={15} color="#FFF" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <Text style={styles.storyName} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

// --------------------------------------------------
// HOME SCREEN
// --------------------------------------------------
export default function HomeScreen({
  userId,
  route,
  addStoryRequest = 0,
  refreshKey = 0,
  ownAvatarUrl = null,
}) {
  const navigation = useNavigation();
  const { colors, mode } = useAppTheme();
  const isFocused = useIsFocused();
  const styles = useThemedStyles(baseStyles);
  const [posts, setPosts] = useState([]);
  const [sharedPost, setSharedPost] = useState(null);
  const [sharedPostVisible, setSharedPostVisible] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState(null);
  const postFrames = useRef(new Map());
  const storyRequestHandledRef = useRef(0);
  const scrollY = useRef(0);
  const { height: viewportHeight } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [stories, setStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [uploadingStory, setUploadingStory] = useState(false);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);


  const [likingId, setLikingId] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const [selectedPost, setSelectedPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentActionTarget, setCommentActionTarget] = useState(null);
  const [storyReplyText, setStoryReplyText] = useState('');
  const [storyReplySending, setStoryReplySending] = useState(false);
  const [storyRepliesById, setStoryRepliesById] = useState({});
  const [storyViewersById, setStoryViewersById] = useState({});
  const [storyLikesById, setStoryLikesById] = useState({});
  const [storyLikeBusy, setStoryLikeBusy] = useState(false);
  const [storyRepliesVisible, setStoryRepliesVisible] = useState(false);
  const [storyRepliesLoading, setStoryRepliesLoading] = useState(false);
  const [storyRepliesError, setStoryRepliesError] = useState('');
  const storyActivityTouchStartRef = useRef(null);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const notificationReadAtRef = useRef(null);
  const notificationCountRequestRef = useRef(0);
  const [optionsPost, setOptionsPost] = useState(null);
  const [postOptionsVisible, setPostOptionsVisible] = useState(false);

  // Modals
  const [targetUserId, setTargetUserId] = useState(null);
  const [profileVisible, setProfileVisible] = useState(false);
  const [dmsVisible, setDmsVisible] = useState(false);
  const [initialTargetUser, setInitialTargetUser] = useState(null);
  const [initialStoryShare, setInitialStoryShare] = useState(null);
  const [dmUnreadCount, setDmUnreadCount] = useState(0);

  useEffect(() => {
    const postId = route?.params?.postId;
    if (!postId || !userId) return undefined;

    let active = true;
    fetchSharedPost(postId, userId)
      .then((post) => {
        if (!active) return;
        if (!post) {
          Alert.alert('Post unavailable', 'This post may have been removed or is not available to you.');
          return;
        }
        setSharedPost(post);
        setSharedPostVisible(true);
      })
      .catch((error) => {
        if (active) Alert.alert('Could not open post', error.message);
      })
      .finally(() => {
        if (active) navigation.setParams({ postId: undefined });
      });

    return () => { active = false; };
  }, [route?.params?.postId, userId, navigation]);

  useEffect(() => {
    const profileId = route?.params?.profileId;
    if (!profileId) return;

    setTargetUserId(profileId);
    setProfileVisible(true);
    navigation.setParams({ profileId: undefined });
  }, [route?.params?.profileId, navigation]);

  useEffect(() => {
    if (!userId) return;

    let mounted = true;

    const loadDmUnreadCount = async () => {
      try {
        const conversations = await fetchUserConversations(userId);
        if (!mounted) return;

        const total = conversations.reduce(
          (sum, conversation) => sum + Number(conversation.unread_count || 0),
          0
        );
        setDmUnreadCount(total);
      } catch (error) {
        console.warn('Home DM unread count failed:', error);
      }
    };

    loadDmUnreadCount();
    const interval = setInterval(loadDmUnreadCount, 4000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !isFocused) return undefined;

    let mounted = true;
    const refreshNotificationCount = async () => {
      const requestId = ++notificationCountRequestRef.current;
      try {
        const count = await fetchNotificationCount(
          userId,
          notificationReadAtRef.current || undefined
        );
        if (mounted && requestId === notificationCountRequestRef.current) {
          setNotificationCount(count);
        }
      } catch (error) {
        console.warn('Notification count refresh failed:', error.message);
      }
    };

    refreshNotificationCount();
    const interval = setInterval(refreshNotificationCount, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [userId, isFocused]);

  // Story Timer
  const [storyProgress, setStoryProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const activeGroup = stories[activeGroupIndex];
  const activeStory = activeGroup?.stories?.[activeStoryIndex];
  const activeStoryReplies = storyRepliesById[activeStory?.id] || [];
  const activeStoryViewers = storyViewersById[activeStory?.id] || [];
  const activeStoryLikes = storyLikesById[activeStory?.id] || [];
  const hasLikedActiveStory = activeStoryLikes.some(
    (like) => like.user_id === userId
  );

  const ownStoryGroup = stories.find((group) => group.isOwn);

  const updateActiveVideo = useCallback((nextScrollY = scrollY.current, height = viewportHeight) => {
    const viewportCenter = nextScrollY + height * 0.52;
    let nextId = null;
    for (const [id, frame] of postFrames.current) {
      if (frame.isVideo && frame.y <= viewportCenter && frame.y + frame.height >= viewportCenter) {
        nextId = id;
        break;
      }
    }
    setActiveVideoId((current) => current === nextId ? current : nextId);
  }, [viewportHeight]);

  // Story auto-progress timer
  useEffect(() => {
    if (!viewerVisible || isPaused) return;

    setStoryProgress(0);
    const interval = setInterval(() => {
      setStoryProgress((prev) => {
        if (prev >= 1) {
          nextStory();
          return 0;
        }
        return prev + 0.01;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [viewerVisible, activeGroupIndex, activeStoryIndex, isPaused]);

  const handlePostOptions = (post) => {
    if (!post) return;
    setOptionsPost(post);
    setPostOptionsVisible(true);
  };

  const closePostOptions = () => {
    setPostOptionsVisible(false);
    setOptionsPost(null);
  };

  const shareOptionsPost = async () => {
    if (!optionsPost) return;
    const post = optionsPost;
    closePostOptions();
    try {
      await Share.share({
        message: getPostShareMessage(post),
      });
    } catch {}
  };

  const saveOptionsPost = () => {
    if (!optionsPost) return;
    const post = optionsPost;
    closePostOptions();
    handleSave(post);
  };

  const hideOptionsPost = () => {
    if (!optionsPost) return;
    setPosts((current) => current.filter((post) => post.id !== optionsPost.id));
    closePostOptions();
  };

  const unfollowOptionsPost = async () => {
    if (!optionsPost || !userId) return;
    const post = optionsPost;
    closePostOptions();
    try {
      const { error: followError } = await supabase
        .from('user_follows')
        .delete()
        .eq('follower_id', userId)
        .eq('following_id', post.user_id);
      if (followError) throw followError;
      setPosts((current) => current.filter((item) => item.user_id !== post.user_id));
    } catch (error) {
      Alert.alert('Could not unfollow', error.message);
    }
  };

  const deleteOptionsPost = () => {
    if (!optionsPost) return;
    const post = optionsPost;
    closePostOptions();
    Alert.alert('Delete post?', 'This will permanently remove your post.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePost({
              postId: post.id,
              userId,
              mediaPath: post.media_path,
              coverPath: post.cover_path,
            });
            setPosts((current) => current.filter((item) => item.id !== post.id));
          } catch (error) {
            Alert.alert('Delete failed', error.message);
          }
        },
      },
    ]);
  };

  // --------------------------------------------------
  // LOAD FEED
  // --------------------------------------------------

  const loadPosts = useCallback(async (isRefresh = false) => {
    if (!userId) {
      setError('Your login session is missing. Please log in again.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    setError('');

    try {
      const data = await fetchFeedPosts(userId);
      setPosts(data || []);
    } catch (err) {
      console.error('Feed loading error:', err);
      setError(err.message || 'Could not load the feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // --------------------------------------------------
  // LOAD STORIES
  // --------------------------------------------------

  const loadStories = useCallback(async () => {
    if (!userId) return;

    setStoriesLoading(true);

    try {
      const data = await fetchStories(userId);
      const nextStories = data || [];
      setStories(nextStories);

      // Warm the first photo story in a few groups while the viewer is idle,
      // so opening a story can use the image cache instead of starting a fetch.
      nextStories
        .slice(0, 5)
        .map((group) => group.stories?.[0])
        .filter((story) => story?.media_type !== 'video' && story?.media_url)
        .forEach((story) => Image.prefetch(story.media_url).catch(() => {}));
    } catch (err) {
      console.error('Stories loading error:', err);

      Alert.alert(
        'Stories error',
        err.message || 'Could not load stories.'
      );
    } finally {
      setStoriesLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadPosts(false);
      loadStories();
    }, [loadPosts, loadStories, refreshKey])
  );

  // --------------------------------------------------
  // REFRESH
  // --------------------------------------------------

  async function refreshEverything() {
    await Promise.all([
      loadPosts(true),
      loadStories(),
    ]);
  }

  // --------------------------------------------------
  // PUBLISH STORY
  // --------------------------------------------------

  const publishSelectedStory = useCallback(async (asset) => {
    if (uploadingStory) return;

    setUploadingStory(true);

    try {
      await uploadStory({ userId, asset });
      await loadStories();
    } catch (err) {
      console.error('Story upload error:', err);

      Alert.alert(
        'Story upload failed',
        err.message || 'Please try again.'
      );
    } finally {
      setUploadingStory(false);
    }
  }, [loadStories, uploadingStory, userId]);

  // --------------------------------------------------
  // ADD PHOTO OR VIDEO STORY
  // --------------------------------------------------

  const handleAddStory = useCallback(async () => {
    if (uploadingStory) return;

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Permission required',
          'Please allow Gallery access to upload photos and videos.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.85,
        videoMaxDuration: 60,
        base64: false,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];

      // Instagram-style behaviour: once the media is chosen it publishes
      // immediately. No blocking "music / no music" prompt.
      await publishSelectedStory(asset);
    } catch (err) {
      console.error('Story picker error:', err);

      Alert.alert(
        'Story error',
        err.message || 'Could not open Gallery.'
      );
    }
  }, [publishSelectedStory, uploadingStory]);

  useEffect(() => {
    if (
      !isFocused ||
      addStoryRequest === 0 ||
      addStoryRequest === storyRequestHandledRef.current
    ) {
      return;
    }

    storyRequestHandledRef.current = addStoryRequest;
    void handleAddStory();
  }, [addStoryRequest, handleAddStory, isFocused]);

  // --------------------------------------------------
  // MARK STORY AS VIEWED
  // --------------------------------------------------

  async function recordStoryView(story, group) {
    if (!story || group?.isOwn) return;

    setStories((current) =>
      current.map((item) => {
        if (item.userId !== group.userId) return item;

        const updatedStories = item.stories.map((entry) =>
          entry.id === story.id
            ? { ...entry, viewed_by_me: true }
            : entry
        );

        return {
          ...item,
          hasUnseen: updatedStories.some((entry) => !entry.viewed_by_me),
          stories: updatedStories,
        };
      })
    );

    try {
      await markStoryViewed({
        storyId: story.id,
        viewerId: userId,
      });
    } catch (err) {
      console.error('Story view error:', err);
    }
  }

  // --------------------------------------------------
  // OPEN STORY GROUP
  // --------------------------------------------------

  async function sendStoryMessage(message) {
    const text = (message || '').trim();

    if (
      !text ||
      !userId ||
      !activeGroup ||
      !activeStory ||
      activeGroup.isOwn ||
      storyReplySending
    ) {
      return;
    }

    const targetId = activeGroup.userId || activeGroup.user?.id;

    if (!targetId || targetId === userId) return;

    setStoryReplySending(true);

    try {
      await sendStoryReply({
        storyId: activeStory.id,
        senderId: userId,
        recipientId: targetId,
        body: text,
      });

      setStoryReplyText('');
    } catch (error) {
      Alert.alert(
        'Could not reply to story',
        error?.message || 'Please try again.'
      );
    } finally {
      setStoryReplySending(false);
    }
  }

  async function openStoryActivity() {
    if (!activeStory?.id) return;
    setIsPaused(true);
    setStoryRepliesVisible(true);
    setStoryRepliesLoading(true);
    setStoryRepliesError('');

    const [viewersResult, repliesResult, likesResult] = await Promise.allSettled([
      fetchStoryViewers(activeStory.id),
      fetchStoryReplies(activeStory.id),
      fetchStoryLikes(activeStory.id),
    ]);

    if (viewersResult.status === 'fulfilled') {
      setStoryViewersById((current) => ({
        ...current,
        [activeStory.id]: viewersResult.value,
      }));
    } else {
      Alert.alert(
        'Could not load story viewers',
        viewersResult.reason?.message || 'Please try again.'
      );
    }

    if (repliesResult.status === 'fulfilled') {
      setStoryRepliesById((current) => ({
        ...current,
        [activeStory.id]: repliesResult.value,
      }));
    } else {
      setStoryRepliesError(
        repliesResult.reason?.message || 'Could not load replies. Please try again.'
      );
    }

    if (likesResult.status === 'fulfilled') {
      setStoryLikesById((current) => ({
        ...current,
        [activeStory.id]: likesResult.value,
      }));
    } else {
      Alert.alert(
        'Could not load story likes',
        likesResult.reason?.message || 'Please try again.'
      );
    }

    setStoryRepliesLoading(false);
  }

  async function toggleActiveStoryLike() {
    if (!activeStory?.id || !userId || storyLikeBusy || activeGroup?.isOwn) return;

    const nextLiked = !hasLikedActiveStory;
    setStoryLikeBusy(true);
    try {
      await setStoryLike({
        storyId: activeStory.id,
        userId,
        liked: nextLiked,
      });
      const likes = await fetchStoryLikes(activeStory.id);
      setStoryLikesById((current) => ({
        ...current,
        [activeStory.id]: likes,
      }));
    } catch (error) {
      Alert.alert(
        'Could not update story like',
        error?.message || 'Please try again.'
      );
    } finally {
      setStoryLikeBusy(false);
    }
  }

  function openStoryInDm() {
    const recipient = activeGroup?.user;
    if (!activeStory || !recipient?.id) return;

    setInitialTargetUser(recipient);
    setInitialStoryShare({
      user: recipient,
      story: activeStory,
    });
    setViewerVisible(false);
    setDmsVisible(true);
  }

  useEffect(() => {
    if (!viewerVisible || !activeStory?.id) return undefined;

    let active = true;
    const storyId = activeStory.id;

    fetchStoryLikes(storyId)
      .then((likes) => {
        if (active) {
          setStoryLikesById((current) => ({
            ...current,
            [storyId]: likes,
          }));
        }
      })
      .catch((error) => {
        if (active) {
          console.warn('Could not load story likes:', error.message);
        }
      });

    if (activeGroup?.isOwn) {
      fetchStoryReplies(storyId)
        .then((replies) => {
          if (active) {
            setStoryRepliesById((current) => ({
              ...current,
              [storyId]: replies,
            }));
          }
        })
        .catch((error) => {
          if (active) {
            console.warn('Could not load story replies:', error.message);
          }
        });
    }

    return () => {
      active = false;
    };
  }, [viewerVisible, activeGroup?.isOwn, activeStory?.id]);

  function openStoryGroup(group) {
    const groupIndex = stories.findIndex(
      (item) => item.userId === group.userId
    );

    if (groupIndex < 0) return;

    setActiveGroupIndex(groupIndex);
    setActiveStoryIndex(0);
    setViewerVisible(true);

    recordStoryView(group.stories[0], group);
  }

  // --------------------------------------------------
  // NEXT STORY
  // --------------------------------------------------

  function nextStory() {
    if (!activeGroup) return;

    if (activeStoryIndex < activeGroup.stories.length - 1) {
      const nextIndex = activeStoryIndex + 1;

      setActiveStoryIndex(nextIndex);

      recordStoryView(
        activeGroup.stories[nextIndex],
        activeGroup
      );

      return;
    }

    if (activeGroupIndex < stories.length - 1) {
      const nextGroupIndex = activeGroupIndex + 1;
      const nextGroup = stories[nextGroupIndex];

      setActiveGroupIndex(nextGroupIndex);
      setActiveStoryIndex(0);

      recordStoryView(
        nextGroup.stories[0],
        nextGroup
      );

      return;
    }

    setViewerVisible(false);
  }

  // --------------------------------------------------
  // PREVIOUS STORY
  // --------------------------------------------------

  function previousStory() {
    if (!activeGroup) return;

    if (activeStoryIndex > 0) {
      const previousIndex = activeStoryIndex - 1;

      setActiveStoryIndex(previousIndex);

      recordStoryView(
        activeGroup.stories[previousIndex],
        activeGroup
      );

      return;
    }

    if (activeGroupIndex > 0) {
      const previousGroupIndex = activeGroupIndex - 1;
      const previousGroup = stories[previousGroupIndex];
      const lastIndex = previousGroup.stories.length - 1;

      setActiveGroupIndex(previousGroupIndex);
      setActiveStoryIndex(lastIndex);

      recordStoryView(
        previousGroup.stories[lastIndex],
        previousGroup
      );
    }
  }

  // --------------------------------------------------
  // DELETE STORY
  // --------------------------------------------------

  function confirmDeleteStory() {
    if (!activeStory || !activeGroup?.isOwn) return;

    Alert.alert(
      'Delete Story',
      'Are you sure you want to delete this story?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteStory({
                storyId: activeStory.id,
                userId,
                mediaPath: activeStory.media_path,
                audioPath: activeStory.audio_path,
              });

              setViewerVisible(false);
              await loadStories();

              Alert.alert(
                'Deleted',
                'Your story has been deleted.'
              );
            } catch (err) {
              Alert.alert(
                'Delete failed',
                err.message || 'Could not delete story.'
              );
            }
          },
        },
      ]
    );
  }

  // --------------------------------------------------
  // UPDATE FEED POST
  // --------------------------------------------------

  function updateFeedPost(updatedPost) {
    setPosts((current) =>
      current.map((item) =>
        item.id === updatedPost.id
          ? { ...item, ...updatedPost }
          : item
      )
    );

    setSelectedPost((current) =>
      current?.id === updatedPost.id
        ? { ...current, ...updatedPost }
        : current
    );
  }

  // --------------------------------------------------
  // LIKE / UNLIKE
  // --------------------------------------------------

  async function handleLike(post) {
    if (likingId) return;

    const wasLiked = !!post.liked_by_me;
    const optimisticPost = {
      ...post,
      liked_by_me: !wasLiked,
      like_count: Math.max(0, (post.like_count || 0) + (wasLiked ? -1 : 1)),
    };
    updateFeedPost(optimisticPost);
    setLikingId(post.id);

    try {
      const result = await togglePostLike({
        postId: post.id,
        userId,
        currentlyLiked: wasLiked,
      });

      updateFeedPost({
        ...post,
        liked_by_me: result,
        like_count: Math.max(
          0,
          (post.like_count || 0) +
            (result ? 1 : -1)
        ),
      });
    } catch (err) {
      updateFeedPost(post);
      Alert.alert('Like failed', err.message);
    } finally {
      setLikingId(null);
    }
  }

  // --------------------------------------------------
  // SAVE / UNSAVE
  // --------------------------------------------------

  async function handleSave(post) {
    if (savingId) return;

    setSavingId(post.id);

    try {
      const result = await togglePostSaved({
        postId: post.id,
        userId,
        currentlySaved: post.saved_by_me,
      });

      updateFeedPost({
        ...post,
        saved_by_me: result.saved,
      });
    } catch (err) {
      Alert.alert('Save failed', err.message);
    } finally {
      setSavingId(null);
    }
  }

  // --------------------------------------------------
  // OPEN COMMENTS
  // --------------------------------------------------

  async function openComments(post) {
    setSelectedPost(post);
    setComments([]);
    setCommentText('');
    setCommentActionTarget(null);
    setCommentsVisible(true);
    setCommentsLoading(true);

    try {
      const data = await fetchPostComments(post.id);
      setComments(data || []);
    } catch (err) {
      Alert.alert('Comments error', err.message);
    } finally {
      setCommentsLoading(false);
    }
  }

  // --------------------------------------------------
  // SUBMIT COMMENT
  // --------------------------------------------------

  async function submitComment() {
    if (
      !commentText.trim() ||
      commentSubmitting ||
      !selectedPost
    ) {
      return;
    }

    setCommentSubmitting(true);

    try {
      const newComment = await addPostComment({
        postId: selectedPost.id,
        userId,
        body: commentText.trim(),
      });

      setComments((current) => [
        ...current,
        newComment,
      ]);

      setCommentText('');

      const updatedPost = {
        ...selectedPost,
        comment_count:
          (selectedPost.comment_count || 0) + 1,
      };

      setSelectedPost(updatedPost);
      updateFeedPost(updatedPost);
    } catch (err) {
      Alert.alert('Comment failed', err.message);
    } finally {
      setCommentSubmitting(false);
    }
  }

  // --------------------------------------------------
  // COMMENT MANAGEMENT
  // --------------------------------------------------

  function handleCommentUpdated(updatedComment) {
    setComments((current) =>
      current.map((comment) =>
        comment.id === updatedComment.id
          ? { ...comment, ...updatedComment }
          : comment
      )
    );
  }

  function handleCommentDeleted(deletedComment) {
    setComments((current) =>
      current.filter((comment) => comment.id !== deletedComment.id)
    );

    if (selectedPost) {
      const updatedPost = {
        ...selectedPost,
        comment_count: Math.max(
          0,
          (selectedPost.comment_count || 1) - 1
        ),
      };

      setSelectedPost(updatedPost);
      updateFeedPost(updatedPost);
    }
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      {/* HEADER */}

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => navigation.navigate('Create', { type: 'post' })}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={32} color={colors.text} />
        </TouchableOpacity>

        <Text style={styles.logo}>social.</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => setDmsVisible(true)}
            activeOpacity={0.7}
          >
            <View>
              <Ionicons name="paper-plane-outline" size={26} color={colors.text} />
              {dmUnreadCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -7,
                  right: -9,
                  minWidth: 19,
                  height: 19,
                  borderRadius: 10,
                  backgroundColor: '#ED4956',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 4,
                  borderWidth: 1.5,
                  borderColor: colors.background,
                }}>
                  <Text style={{
                    color: '#FFFFFF',
                    fontSize: 10,
                    fontWeight: '700',
                  }}>
                    {dmUnreadCount > 99 ? '99+' : dmUnreadCount}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => setNotificationsVisible(true)}
            activeOpacity={0.7}
          >
            <View>
              <Ionicons name="heart-outline" size={27} color={colors.text} />
              {notificationCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -7,
                  right: -9,
                  minWidth: 19,
                  height: 19,
                  borderRadius: 10,
                  backgroundColor: '#ED4956',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 4,
                  borderWidth: 1.5,
                  borderColor: colors.background,
                }}>
                  <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700' }}>
                    {notificationCount > 99 ? '99+' : notificationCount}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        onLayout={() => updateActiveVideo()}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
          updateActiveVideo(scrollY.current, event.nativeEvent.layoutMeasurement.height);
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshEverything}
          />
        }
      >
        {/* STORIES */}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.stories}
          contentContainerStyle={styles.storiesContent}
        >
          <StoryItem
            group={{
              userId,
              user: { id: userId, username: 'you', avatar_url: ownAvatarUrl },
              isOwn: true,
              hasUnseen: false,
            }}
            onPress={() => {
              if (ownStoryGroup) {
                openStoryGroup(ownStoryGroup);
              } else {
                handleAddStory();
              }
            }}
            onAdd={handleAddStory}
          />

          {storiesLoading ? (
            <View style={styles.storyLoading}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : (
            stories
              .filter((group) => !group.isOwn)
              .map((group) => (
                <StoryItem
                  key={group.userId}
                  group={group}
                  onPress={() => openStoryGroup(group)}
                />
              ))
          )}
        </ScrollView>

        {uploadingStory && (
          <View style={styles.uploadingStory}>
            <ActivityIndicator
              size="small"
              color="#1687E8"
            />
            <Text style={styles.uploadingText}>
              Uploading your story...
            </Text>
          </View>
        )}

        {/* FEED */}

        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator
              size="large"
              color={colors.text}
            />
            <Text style={styles.stateText}>
              Loading posts...
            </Text>
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Ionicons
              name="alert-circle-outline"
              size={38}
              color="#D44"
            />

            <Text style={styles.stateText}>{error}</Text>

            <TouchableOpacity
              style={styles.retry}
              onPress={() => loadPosts(false)}
            >
              <Text style={styles.retryText}>
                Try again
              </Text>
            </TouchableOpacity>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.state}>
            <Ionicons
              name="images-outline"
              size={42}
              color={colors.muted}
            />

            <Text style={styles.emptyTitle}>
              Your feed is ready
            </Text>

            <Text style={styles.stateText}>
              Be the first to share a photo. Tap the Create tab below.
            </Text>
          </View>
        ) : (
          posts.map((post) => (
  <PostCard
    key={post.id}
    post={post}
    onLike={handleLike}
    onComments={openComments}
    onSave={handleSave}
    onOpenProfile={(authorId) => {
      setTargetUserId(authorId);
      setProfileVisible(true);
    }}
    onOptions={handlePostOptions}
    onOpenReel={(selectedPost) => {
      navigation.navigate('Reels', {
        postId: selectedPost.id,
      });
    }}
    onPostLayout={(postId, isVideo, layout) => {
      postFrames.current.set(postId, {
        y: layout.y,
        height: layout.height,
        isVideo,
      });
    }}
    liking={likingId === post.id}
    saving={savingId === post.id}
  />
))
        )}
      </ScrollView>

      {/* FULL SCREEN STORY VIEWER */}

      <Modal
        visible={viewerVisible}
        animationType="none"
        onRequestClose={() => setViewerVisible(false)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.viewer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {activeStory && activeGroup ? (
            <>
              <StoryMedia
                key={activeStory.id}
                story={activeStory}
                isActive={isFocused && viewerVisible}
              />

              <View style={styles.progressContainer}>
                {activeGroup.stories.map((story, index) => {
                  const fillWidth =
                    index < activeStoryIndex
                      ? '100%'
                      : index === activeStoryIndex
                      ? `${Math.min(100, Math.max(0, storyProgress * 100))}%`
                      : '0%';

                  return (
                    <View
                      key={story.id}
                      style={styles.progressTrack}
                    >
                      <View
                        style={[
                          styles.progressFill,
                          { width: fillWidth },
                        ]}
                      />
                    </View>
                  );
                })}
              </View>

              <View style={styles.viewerHeader}>
                {activeGroup.user?.avatar_url ? (
                  <Image
                    source={{
                      uri: activeGroup.user.avatar_url,
                    }}
                    style={styles.viewerAvatar}
                  />
                ) : (
                  <View style={styles.viewerAvatarFallback}>
                    <Ionicons
                      name="person"
                      size={17}
                      color="#FFF"
                    />
                  </View>
                )}

                <View style={styles.viewerUserInfo}>
                  <Text style={styles.viewerUsername}>
                    {activeGroup.isOwn
                      ? 'Your story'
                      : activeGroup.user?.username ||
                        activeGroup.user?.full_name ||
                        'user'}
                  </Text>

                  <Text style={styles.viewerTime}>
                    {timeAgo(activeStory.created_at)}
                  </Text>
                </View>

                {activeGroup.isOwn && (
                  <TouchableOpacity
                    style={styles.viewerDelete}
                    onPress={confirmDeleteStory}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={22}
                      color="#FFF"
                    />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={() => setViewerVisible(false)}
                  style={styles.viewerClose}
                >
                  <Ionicons
                    name="close"
                    size={28}
                    color="#FFF"
                  />
                </TouchableOpacity>
              </View>

              {activeStory.music_title ? (
                <View style={styles.storyMusicLabel}>
                  <Ionicons
                    name="musical-notes"
                    size={15}
                    color="#FFF"
                  />

                  <Text style={styles.storyMusicText}>
                    {activeStory.music_title}
                    {activeStory.music_artist
                      ? ` · ${activeStory.music_artist}`
                      : ''}
                  </Text>
                </View>
              ) : null}

              <View style={styles.viewerTapZones}>
                <TouchableOpacity
                  style={styles.viewerLeftZone}
                  activeOpacity={1}
                  onPress={previousStory}
                  onLongPress={() => setIsPaused(true)}
                  onPressOut={() => setIsPaused(false)}
                />

                <TouchableOpacity
                  style={styles.viewerRightZone}
                  activeOpacity={1}
                  onPress={nextStory}
                  onLongPress={() => setIsPaused(true)}
                  onPressOut={() => setIsPaused(false)}
                />
              </View>

              <View style={styles.viewerBottom}>
                {activeGroup.isOwn ? (
                  <View
                    style={{ alignItems: 'center', gap: 6 }}
                    onTouchStart={(event) => {
                      storyActivityTouchStartRef.current = event.nativeEvent.pageY;
                    }}
                    onTouchEnd={(event) => {
                      const startY = storyActivityTouchStartRef.current;
                      storyActivityTouchStartRef.current = null;
                      if (
                        typeof startY === 'number' &&
                        startY - event.nativeEvent.pageY > 35
                      ) {
                        openStoryActivity();
                      }
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TouchableOpacity
                        style={styles.storySeenPill}
                        onPress={openStoryActivity}
                        accessibilityRole="button"
                        accessibilityLabel={`${activeStory?.view_count || 0} story viewers`}
                      >
                        <Ionicons
                          name="eye-outline"
                          size={14}
                          color="#FFFFFF"
                        />
                        <Text style={styles.storySeenText}>
                          Seen by {Math.max(
                            activeStory?.view_count || 0,
                            activeStoryViewers.length
                          )}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.storySeenPill}
                        onPress={openStoryActivity}
                        accessibilityRole="button"
                        accessibilityLabel={`${activeStoryReplies.length} story replies`}
                      >
                        <Ionicons
                          name="chatbubble-ellipses-outline"
                          size={14}
                          color="#FFFFFF"
                        />
                        <Text style={styles.storySeenText}>
                          Replies {activeStoryReplies.length}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.viewerHint}>
                      Swipe up or tap to see viewers and replies
                    </Text>
                  </View>
                ) : (
                  <View style={styles.storyActionsRow}>
                    <TextInput
                      style={styles.storyReplyInput}
                      placeholder="Reply to story"
                      placeholderTextColor="rgba(255,255,255,0.7)"
                      value={storyReplyText}
                      onChangeText={setStoryReplyText}
                      onFocus={() => setIsPaused(true)}
                      onBlur={() => setIsPaused(false)}
                      maxLength={1000}
                      returnKeyType="send"
                      onSubmitEditing={() =>
                        sendStoryMessage(storyReplyText)
                      }
                    />

                    <TouchableOpacity
                      style={styles.storyActionButton}
                      onPress={() => sendStoryMessage(storyReplyText)}
                      disabled={!storyReplyText.trim() || storyReplySending}
                    >
                      {storyReplySending ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Ionicons
                          name="send"
                          size={18}
                          color={
                            storyReplyText.trim()
                              ? '#FFFFFF'
                              : 'rgba(255,255,255,0.45)'
                          }
                        />
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.storyActionButton}
                      onPress={openStoryInDm}
                      accessibilityLabel="Share story in a direct message"
                    >
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={19}
                        color="#FFFFFF"
                      />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.storyActionButton}
                      onPress={toggleActiveStoryLike}
                      disabled={storyLikeBusy}
                      accessibilityRole="button"
                      accessibilityLabel={hasLikedActiveStory ? 'Unlike story' : 'Like story'}
                    >
                      {storyLikeBusy ? (
                        <ActivityIndicator size="small" color="#FF4D6D" />
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons
                            name={hasLikedActiveStory ? 'heart' : 'heart-outline'}
                            size={21}
                            color="#FF4D6D"
                          />
                          {activeGroup?.isOwn && activeStoryLikes.length > 0 ? (
                            <Text style={styles.storySeenText}>
                              {activeStoryLikes.length}
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </>
          ) : (
            <TouchableOpacity
              style={styles.viewerCloseFallback}
              onPress={() => setViewerVisible(false)}
            >
              <Text style={{ color: '#FFF' }}>
                Close
              </Text>
            </TouchableOpacity>
          )}
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={storyRepliesVisible}
        animationType="slide"
        onRequestClose={() => {
          setStoryRepliesVisible(false);
          setIsPaused(false);
        }}
      >
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setStoryRepliesVisible(false);
                setIsPaused(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Close story replies"
            >
              <Ionicons name="close" size={27} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Story activity</Text>
            <View style={{ width: 27 }} />
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 12 }}
          >
            <Text style={[styles.noCommentsTitle, { color: colors.text, marginBottom: 8 }]}>
              Seen by {activeStoryViewers.length}
            </Text>
            {storyRepliesLoading && activeStoryViewers.length === 0 ? (
              <ActivityIndicator
                style={{ marginVertical: 18 }}
                size="small"
                color={colors.primary || colors.text}
              />
            ) : activeStoryViewers.length === 0 ? (
              <Text style={[styles.stateText, { marginBottom: 16 }]}>
                No one has viewed this story yet.
              </Text>
            ) : (
              activeStoryViewers.map((view) => {
                const profile = view.profile;
                const name = profile?.username || profile?.full_name || 'User';
                return (
                  <View
                    key={view.viewer_id}
                    style={[
                      styles.commentRow,
                      { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                    ]}
                  >
                    {profile?.avatar_url ? (
                      <Image
                        source={{ uri: profile.avatar_url }}
                        style={styles.commentAvatar}
                      />
                    ) : (
                      <View style={styles.commentAvatarFallback}>
                        <Ionicons name="person" size={15} color={colors.muted} />
                      </View>
                    )}
                    <View style={styles.commentBody}>
                      <Text style={styles.commentUsername}>
                        {name.startsWith('@') ? name : `@${name}`}
                      </Text>
                      <Text style={styles.commentTime}>
                        Viewed {timeAgo(view.viewed_at)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}

            <Text
              style={[
                styles.noCommentsTitle,
                { color: colors.text, marginTop: 22, marginBottom: 8 },
              ]}
            >
              Likes · {activeStoryLikes.length}
            </Text>
            {activeStoryLikes.map((like) => {
              const profile = like.profile;
              const name = profile?.username || profile?.full_name || 'User';
              return (
                <View
                  key={like.user_id}
                  style={[
                    styles.commentRow,
                    { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  ]}
                >
                  {profile?.avatar_url ? (
                    <Image
                      source={{ uri: profile.avatar_url }}
                      style={styles.commentAvatar}
                    />
                  ) : (
                    <View style={styles.commentAvatarFallback}>
                      <Ionicons name="person" size={15} color={colors.muted} />
                    </View>
                  )}
                  <View style={[styles.commentBody, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                    <View>
                      <Text style={styles.commentUsername}>
                        {name.startsWith('@') ? name : `@${name}`}
                      </Text>
                      <Text style={styles.commentTime}>
                        Liked {timeAgo(like.created_at)}
                      </Text>
                    </View>
                    <Ionicons name="heart" size={17} color="#FF4D6D" />
                  </View>
                </View>
              );
            })}
            <Text
              style={[
                styles.noCommentsTitle,
                { color: colors.text, marginTop: 22, marginBottom: 8 },
              ]}
            >
              Replies · {activeStoryReplies.length}
            </Text>
            {storyRepliesLoading && activeStoryReplies.length === 0 ? (
              <ActivityIndicator
                style={{ marginVertical: 18 }}
                size="small"
                color={colors.primary || colors.text}
              />
            ) : storyRepliesError ? (
              <Text style={[styles.stateText, { color: colors.danger || '#DC2626' }]}>
                {storyRepliesError}
              </Text>
            ) : activeStoryReplies.length === 0 ? (
              <Text style={styles.stateText}>
                No replies to this story yet.
              </Text>
            ) : (
              activeStoryReplies.map((reply) => (
                <View
                  key={reply.id}
                  style={[
                    styles.commentRow,
                    { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  ]}
                >
                  {reply.sender?.avatar_url ? (
                    <Image
                      source={{ uri: reply.sender.avatar_url }}
                      style={styles.commentAvatar}
                    />
                  ) : (
                    <View style={styles.commentAvatarFallback}>
                      <Ionicons name="person" size={15} color={colors.muted} />
                    </View>
                  )}
                  <View style={styles.commentBody}>
                    <Text style={styles.commentText}>
                      <Text style={styles.commentUsername}>
                        {reply.sender?.username || reply.sender?.full_name || 'user'}{' '}
                      </Text>
                      {reply.body}
                    </Text>
                    <Text style={styles.commentTime}>
                      {timeAgo(reply.created_at)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* COMMENTS MODAL */}

      <Modal
        visible={commentsVisible}
        animationType="slide"
        onRequestClose={() => setCommentsVisible(false)}
      >
        <SafeAreaView
          style={styles.modalSafe}
          edges={['top', 'bottom']}
        >
          <KeyboardAvoidingView
            style={styles.commentModalBody}
            behavior="padding"
            keyboardVerticalOffset={0}
          >
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setCommentsVisible(false)}
            >
              <Ionicons
                name="close"
                size={27}
                color={colors.text}
              />
            </TouchableOpacity>

            <Text style={styles.modalTitle}>
              Comments
            </Text>

            <View style={{ width: 27 }} />
          </View>

          <ScrollView
            style={styles.commentList}
            contentContainerStyle={{ paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            {commentsLoading ? (
              <ActivityIndicator
                style={{ marginTop: 30 }}
                size="large"
                color={colors.text}
              />
            ) : comments.length === 0 ? (
              <View style={styles.noComments}>
                <Text style={styles.noCommentsTitle}>
                  No comments yet
                </Text>

                <Text style={styles.stateText}>
                  Start the conversation.
                </Text>
              </View>
            ) : (
              comments.map((comment) => {
                const commentName =
                  comment.author?.username ||
                  comment.author?.full_name ||
                  'user';

                const canManageComment =
                  comment.user_id === userId ||
                  selectedPost?.user_id === userId;

                return (
                  <View
                    key={comment.id}
                    style={[
                      styles.commentRow,
                      comment.is_hidden && styles.hiddenComment,
                    ]}
                  >
                    {comment.author?.avatar_url ? (
                      <Image
                        source={{
                          uri: comment.author.avatar_url,
                        }}
                        style={styles.commentAvatar}
                      />
                    ) : (
                      <View style={styles.commentAvatarFallback}>
                        <Ionicons
                          name="person"
                          size={15}
                          color={colors.muted}
                        />
                      </View>
                    )}

                    <View style={styles.commentBody}>
                      <Text style={styles.commentText}>
                        <Text style={styles.commentUsername}>
                          {commentName}{' '}
                        </Text>
                        {comment.body}
                      </Text>

                      <View style={styles.commentMetaRow}>
                        <Text style={styles.commentTime}>
                          {timeAgo(comment.created_at)}
                          {comment.edited_at ? ' · edited' : ''}
                        </Text>

                        {comment.is_hidden ? (
                          <View style={styles.hiddenBadge}>
                            <Text style={styles.hiddenBadgeText}>
                              Hidden
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    {canManageComment ? (
                      <TouchableOpacity
                        style={styles.commentMoreButton}
                        onPress={() =>
                          setCommentActionTarget(comment)
                        }
                        hitSlop={{
                          top: 10,
                          bottom: 10,
                          left: 8,
                          right: 8,
                        }}
                        accessibilityLabel="Comment options"
                      >
                        <Ionicons
                          name="ellipsis-horizontal"
                          size={18}
                          color={colors.muted}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>

            <View style={styles.commentComposer}>
              <TextInput
                style={styles.commentInput}
                placeholder="Add a comment..."
                placeholderTextColor="#999"
                value={commentText}
                onChangeText={setCommentText}
                maxLength={1000}
                multiline
              />

              <TouchableOpacity
                onPress={submitComment}
                disabled={
                  !commentText.trim() || commentSubmitting
                }
              >
                {commentSubmitting ? (
                  <ActivityIndicator color="#1687E8" />
                ) : (
                  <Text
                    style={[
                      styles.postCommentButton,
                      !commentText.trim() &&
                        styles.disabledText,
                    ]}
                  >
                    Post
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>

          {commentActionTarget ? (
            <CommentActionsSheet
              key={commentActionTarget.id}
              comment={commentActionTarget}
              currentUserId={userId}
              postOwnerId={selectedPost?.user_id}
              onClose={() => setCommentActionTarget(null)}
              onUpdated={handleCommentUpdated}
              onDeleted={handleCommentDeleted}
            />
          ) : null}
        </SafeAreaView>
      </Modal>

      <NotificationsModal
        visible={notificationsVisible}
        userId={userId}
        onClose={() => setNotificationsVisible(false)}
        onMarkRead={async () => {
          const readAt = new Date().toISOString();
          notificationReadAtRef.current = readAt;
          notificationCountRequestRef.current += 1;
          setNotificationCount(0);
          try {
            await markNotificationsRead(userId, readAt);
          } catch (error) {
            console.warn('Could not save notification read time:', error.message);
          }
        }}
        onOpenProfile={(actorId) => {
          setNotificationsVisible(false);
          setTargetUserId(actorId);
          setProfileVisible(true);
        }}
      />

      <Modal
        visible={postOptionsVisible}
        transparent
        animationType="slide"
        onRequestClose={closePostOptions}
      >
        <View style={styles.optionsOverlay}>
          <TouchableOpacity
            style={[styles.optionsScrim, { backgroundColor: colors.overlay }]}
            activeOpacity={1}
            onPress={closePostOptions}
          />
          <View style={[styles.optionsSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.optionsHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.optionsTitle, { color: colors.text }]}>
              @{optionsPost?.author?.username || 'post'}
            </Text>
            {optionsPost?.user_id === userId ? (
              <>
                <TouchableOpacity style={styles.optionRow} onPress={saveOptionsPost}>
                  <Ionicons name={optionsPost?.saved_by_me ? 'bookmark' : 'bookmark-outline'} size={22} color={colors.text} />
                  <Text style={[styles.optionLabel, { color: colors.text }]}>{optionsPost?.saved_by_me ? 'Remove from saved' : 'Save post'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionRow} onPress={shareOptionsPost}>
                  <Ionicons name="paper-plane-outline" size={22} color={colors.text} />
                  <Text style={[styles.optionLabel, { color: colors.text }]}>Share post</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionRow} onPress={deleteOptionsPost}>
                  <Ionicons name="trash-outline" size={22} color={colors.danger} />
                  <Text style={[styles.optionLabel, { color: colors.danger }]}>Delete post</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => {
                    const targetId = optionsPost?.user_id;
                    closePostOptions();
                    if (targetId) {
                      setTargetUserId(targetId);
                      setProfileVisible(true);
                    }
                  }}
                >
                  <Ionicons name="person-circle-outline" size={22} color={colors.text} />
                  <Text style={[styles.optionLabel, { color: colors.text }]}>View profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionRow} onPress={shareOptionsPost}>
                  <Ionicons name="paper-plane-outline" size={22} color={colors.text} />
                  <Text style={[styles.optionLabel, { color: colors.text }]}>Share post</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionRow} onPress={saveOptionsPost}>
                  <Ionicons name={optionsPost?.saved_by_me ? 'bookmark' : 'bookmark-outline'} size={22} color={colors.text} />
                  <Text style={[styles.optionLabel, { color: colors.text }]}>{optionsPost?.saved_by_me ? 'Remove from saved' : 'Save post'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionRow} onPress={hideOptionsPost}>
                  <Ionicons name="eye-off-outline" size={22} color={colors.text} />
                  <Text style={[styles.optionLabel, { color: colors.text }]}>Hide post</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionRow} onPress={unfollowOptionsPost}>
                  <Ionicons name="person-remove-outline" size={22} color={colors.danger} />
                  <Text style={[styles.optionLabel, { color: colors.danger }]}>Unfollow</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={[styles.optionCancel, { borderColor: colors.border }]} onPress={closePostOptions}>
              <Text style={[styles.optionLabel, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* USER PROFILE MODAL */}
      {targetUserId && (
        <UserProfileModal
          visible={profileVisible}
          targetUserId={targetUserId}
          currentUserId={userId}
          onClose={() => setProfileVisible(false)}
          onOpenProfile={(nextUserId) => {
            setTargetUserId(nextUserId);
            setProfileVisible(true);
          }}
          onOpenDirectMessage={(_tId, profile) => {
            setProfileVisible(false);
            setInitialTargetUser(profile);
            setInitialStoryShare(null);
            setDmsVisible(true);
          }}
        />
      )}

      {/* DIRECT MESSAGES MODAL */}
      <DirectMessagesModal
        visible={dmsVisible}
        currentUserId={userId}
        initialTargetUser={initialTargetUser}
        initialStoryShare={initialStoryShare}
        onBackToInbox={() => {
          setInitialTargetUser(null);
          setInitialStoryShare(null);
        }}
        onClose={() => {
          setDmsVisible(false);
          setInitialTargetUser(null);
          setInitialStoryShare(null);
        }}
        onOpenProfile={(user) => {
          if (!user?.id) return;
          setDmsVisible(false);
          setInitialTargetUser(null);
          setInitialStoryShare(null);
          setTargetUserId(user.id);
          setProfileVisible(true);
        }}
      />

      <PostDetailModal
        key={sharedPost?.id || 'shared-post'}
        visible={sharedPostVisible}
        post={sharedPost}
        userId={userId}
        onClose={() => setSharedPostVisible(false)}
        onPostUpdated={setSharedPost}
        onPostDeleted={() => {
          setSharedPostVisible(false);
          setSharedPost(null);
        }}
      />
    </SafeAreaView>
  );
}

// --------------------------------------------------
// STYLES
// --------------------------------------------------

const baseStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  header: {
    height: 58,
    paddingHorizontal: 17,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  logo: {
    flex: 1,
    textAlign: 'center',
    fontSize: 29,
    color: '#111',
    fontWeight: '800',
    letterSpacing: -1.2,
  },

  headerIconButton: {
    width: 42,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Stories

  stories: {
    paddingVertical: 15,
    flexGrow: 0,
  },

  storiesContent: {
    paddingHorizontal: 12,
    alignItems: 'center',
  },

  story: {
    alignItems: 'center',
    width: 78,
    marginRight: 5,
  },

  storyRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    padding: 3.5,
  },

  unseenRing: {
    borderColor: '#D62976',
  },

  seenRing: {
    borderColor: '#BDBDBD',
  },

  storyAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    backgroundColor: '#EEE',
  },

  storyAvatarFallback: {
    flex: 1,
    borderRadius: 30,
    backgroundColor: '#EEE',
    alignItems: 'center',
    justifyContent: 'center',
  },

  addStoryBadge: {
    position: 'absolute',
    right: 2,
    bottom: 0,
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#1687E8',
    borderWidth: 2,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },

  storyName: {
    marginTop: 5,
    fontSize: 12,
    color: '#222',
    maxWidth: 74,
  },

  storyLoading: {
    width: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },

  uploadingStory: {
    paddingHorizontal: 15,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  uploadingText: {
    color: '#1687E8',
    fontSize: 12,
  },

  // Feed

  post: {
    marginBottom: 20,
  },

  postHeader: {
    height: 60,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  authorHeaderRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  avatar: {
    width: 37,
    height: 37,
    borderRadius: 20,
  },

  avatarFallback: {
    width: 37,
    height: 37,
    borderRadius: 20,
    backgroundColor: '#EEE',
    alignItems: 'center',
    justifyContent: 'center',
  },

  authorInfo: {
    flex: 1,
  },

  username: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },

  location: {
    fontSize: 11,
    color: '#777',
    marginTop: 2,
  },

  postImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#EEE',
  },

  postMediaFallback: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#EEE',
    justifyContent: 'center',
    alignItems: 'center',
  },

  actions: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  leftActions: {
    flexDirection: 'row',
    gap: 17,
    alignItems: 'center',
  },

  details: {
    paddingHorizontal: 13,
  },

  likes: {
    fontWeight: '700',
    fontSize: 13,
    color: '#111',
  },

  caption: {
    fontSize: 13,
    marginTop: 5,
    color: '#111',
    lineHeight: 19,
  },

  captionUser: {
    fontWeight: '700',
  },

  comments: {
    color: '#999',
    fontSize: 12,
    marginTop: 5,
  },

  timestamp: {
    color: '#999',
    fontSize: 9,
    marginTop: 7,
  },

  state: {
    padding: 35,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 250,
  },

  stateText: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 10,
  },

  emptyTitle: {
    color: '#111',
    fontSize: 19,
    fontWeight: '800',
    marginTop: 14,
  },

  retry: {
    marginTop: 15,
    backgroundColor: '#111',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },

  retryText: {
    color: '#FFF',
    fontWeight: '700',
  },

  // Story viewer

  viewer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },

  viewerMedia: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },

  progressContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 55 : 35,
    left: 10,
    right: 10,
    zIndex: 5,
    flexDirection: 'row',
    gap: 4,
  },

  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    width: '0%',
    backgroundColor: '#FFF',
  },

  progressActive: {
    width: '100%',
  },

  viewerHeader: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 68 : 49,
    left: 12,
    right: 12,
    zIndex: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },

  viewerAvatar: {
    width: 35,
    height: 35,
    borderRadius: 18,
  },

  viewerAvatarFallback: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: '#555',
    justifyContent: 'center',
    alignItems: 'center',
  },

  viewerUserInfo: {
    flex: 1,
    marginLeft: 9,
  },

  viewerUsername: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },

  viewerTime: {
    color: '#DDD',
    fontSize: 11,
    marginTop: 2,
  },

  viewerDelete: {
    padding: 8,
    marginRight: 8,
  },

  viewerClose: {
    padding: 5,
  },

  viewerTapZones: {
    position: 'absolute',
    top: 110,
    bottom: 92,
    left: 0,
    right: 0,
    flexDirection: 'row',
  },

  viewerLeftZone: {
    flex: 1,
  },

  viewerRightZone: {
    flex: 2,
  },

  viewerBottom: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    alignItems: 'center',
  },

  storyActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },

  storyReplyInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },

  storyActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  storySeenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },

  storySeenText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  viewerHint: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
  },

  viewerCloseFallback: {
    position: 'absolute',
    top: 50,
    right: 20,
  },

  storyMusicLabel: {
    position: 'absolute',
    bottom: 100,
    left: 15,
    zIndex: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },

  storyMusicText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 260,
  },

  // Music library

  musicOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },

  musicSheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    minHeight: 280,
    maxHeight: '70%',
  },

  musicHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },

  musicHeading: {
    fontSize: 19,
    fontWeight: '800',
    color: '#111',
  },

  musicEmpty: {
    textAlign: 'center',
    color: '#777',
    padding: 30,
  },

  musicTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },

  musicIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#9673FF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  musicTrackTitle: {
    color: '#111',
    fontWeight: '700',
    fontSize: 14,
  },

  musicTrackArtist: {
    color: '#888',
    fontSize: 12,
    marginTop: 3,
  },

  // Comments

  modalSafe: {
    flex: 1,
    backgroundColor: '#FFF',
  },

  commentModalBody: {
    flex: 1,
  },

  modalHeader: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD',
  },

  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },

  commentList: {
    flex: 1,
    paddingHorizontal: 15,
  },

  noComments: {
    alignItems: 'center',
    paddingTop: 65,
  },

  noCommentsTitle: {
    color: '#111',
    fontSize: 18,
    fontWeight: '800',
  },

  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 18,
    gap: 10,
  },

  commentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },

  commentAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EEE',
    justifyContent: 'center',
    alignItems: 'center',
  },

  commentBody: {
    flex: 1,
  },

  hiddenComment: {
    opacity: 0.55,
  },

  commentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 5,
  },

  hiddenBadge: {
    backgroundColor: '#EFEFEF',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },

  hiddenBadgeText: {
    color: '#666',
    fontSize: 9,
    fontWeight: '700',
  },

  commentMoreButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
  },

  commentText: {
    color: '#222',
    fontSize: 13,
    lineHeight: 19,
  },

  commentUsername: {
    fontWeight: '800',
    color: '#111',
  },

  commentTime: {
    color: '#999',
    fontSize: 10,
  },

  commentComposer: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DDD',
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  commentInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    color: '#111',
    fontSize: 14,
    paddingVertical: 8,
  },

  postCommentButton: {
    color: '#1687E8',
    fontWeight: '800',
    fontSize: 14,
  },

  disabledText: {
    opacity: 0.4,
  },

  optionsOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  optionsScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  optionsSheet: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 26,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  optionsHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 17,
  },
  optionsTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  optionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  optionCancel: {
    minHeight: 48,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
