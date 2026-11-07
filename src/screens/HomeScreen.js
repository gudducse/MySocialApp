
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
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import { VideoView, useVideoPlayer } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';

import {
  fetchFeedPosts,
  togglePostLike,
  fetchPostComments,
  addPostComment,
  togglePostSaved,
} from '../services/posts';

import {
  uploadStory,
  fetchStories,
  fetchMusicLibrary,
  markStoryViewed,
  deleteStory,
} from '../services/stories';

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
// STORY MEDIA PLAYER
// --------------------------------------------------

function StoryMedia({ story }) {
  const videoPlayer = useVideoPlayer(
    story?.media_type === 'video' ? story.media_url : null,
    (player) => {
      player.loop = false;
      player.muted = !!story?.audio_url;

      if (story?.media_type === 'video') {
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
    if (story?.audio_url) {
      audioPlayer.play();
    }

    return () => {
      try {
        audioPlayer.pause();
      } catch (error) {}

      try {
        videoPlayer.pause();
      } catch (error) {}
    };
  }, [story?.id]);

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
  liking,
  saving,
}) {
  const author = post.author || {};

  const username =
    author.username ||
    author.full_name ||
    `user_${String(post.user_id).slice(0, 6)}`;

  const imageTapTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (imageTapTimer.current) {
        clearTimeout(imageTapTimer.current);
      }
    };
  }, []);

  function handleImagePress() {
    if (imageTapTimer.current !== null) {
      clearTimeout(imageTapTimer.current);
      imageTapTimer.current = null;

      if (!liking) onLike(post);
      return;
    }

    imageTapTimer.current = setTimeout(() => {
      imageTapTimer.current = null;
    }, 300);
  }

  return (
    <View style={styles.post}>
      <View style={styles.postHeader}>
        {author.avatar_url ? (
          <Image
            source={{ uri: author.avatar_url }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={18} color="#777" />
          </View>
        )}

        <View style={styles.authorInfo}>
          <Text style={styles.username}>{username}</Text>
          <Text style={styles.location}>
            {timeAgo(post.created_at)}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() =>
            Alert.alert(
              'Post options',
              'More post options will be added later.'
            )
          }
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={23}
            color="#111"
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        activeOpacity={1}
        onPress={handleImagePress}
      >
        <Image
          source={{ uri: post.media_url }}
          style={styles.postImage}
        />
      </TouchableOpacity>

      <View style={styles.actions}>
        <View style={styles.leftActions}>
          <TouchableOpacity
            onPress={() => onLike(post)}
            disabled={liking}
          >
            <Ionicons
              name={post.liked_by_me ? 'heart' : 'heart-outline'}
              size={27}
              color={post.liked_by_me ? '#ED4956' : '#111'}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => onComments(post)}>
            <Ionicons
              name="chatbubble-outline"
              size={25}
              color="#111"
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              Alert.alert('Share', 'Sharing will be added next.')
            }
          >
            <Ionicons
              name="paper-plane-outline"
              size={25}
              color="#111"
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
            color="#111"
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

// --------------------------------------------------
// STORY CIRCLE
// --------------------------------------------------

function StoryItem({ group, onPress, onAdd }) {
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
              <Ionicons name="person" size={25} color="#777" />
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

export default function HomeScreen({ userId, refreshKey = 0 }) {
  // Feed states
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Story states
  const [stories, setStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [uploadingStory, setUploadingStory] = useState(false);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);

  // Music states
  const [musicLibrary, setMusicLibrary] = useState([]);
  const [musicModalVisible, setMusicModalVisible] = useState(false);
  const [musicLoading, setMusicLoading] = useState(false);
  const [pendingStoryAsset, setPendingStoryAsset] = useState(null);

  // Feed interaction states
  const [likingId, setLikingId] = useState(null);
  const [savingId, setSavingId] = useState(null);

  // Comments states
  const [selectedPost, setSelectedPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const activeGroup = stories[activeGroupIndex];
  const activeStory = activeGroup?.stories?.[activeStoryIndex];

  const ownStoryGroup = stories.find((group) => group.isOwn);

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
      setStories(data || []);
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

  async function publishSelectedStory(
    asset,
    audioAsset = null,
    musicTrack = null
  ) {
    if (uploadingStory) return;

    setUploadingStory(true);

    try {
      await uploadStory({
        userId,
        asset,
        audioAsset,
        musicTrack,
      });

      setPendingStoryAsset(null);

      await loadStories();

      Alert.alert(
        'Success',
        'Your story has been uploaded!'
      );
    } catch (err) {
      console.error('Story upload error:', err);

      Alert.alert(
        'Story upload failed',
        err.message || 'Please try again.'
      );
    } finally {
      setUploadingStory(false);
    }
  }

  // --------------------------------------------------
  // SELECT PHONE MUSIC
  // --------------------------------------------------

  async function choosePhoneMusic(asset) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const audioAsset = result.assets[0];

      await publishSelectedStory(
        asset,
        audioAsset,
        null
      );
    } catch (err) {
      Alert.alert(
        'Audio selection failed',
        err.message || 'Could not select audio.'
      );
    }
  }

  // --------------------------------------------------
  // SELECT MUSIC LIBRARY
  // --------------------------------------------------

  async function chooseLibraryMusic(asset) {
    setPendingStoryAsset(asset);
    setMusicLoading(true);

    try {
      const tracks = await fetchMusicLibrary();

      setMusicLibrary(tracks || []);
      setMusicModalVisible(true);
    } catch (err) {
      Alert.alert(
        'Music library error',
        err.message || 'Could not load music.'
      );
    } finally {
      setMusicLoading(false);
    }
  }

  async function selectLibraryTrack(track) {
    setMusicModalVisible(false);

    if (!pendingStoryAsset) return;

    await publishSelectedStory(
      pendingStoryAsset,
      null,
      track
    );
  }

  // --------------------------------------------------
  // ADD PHOTO OR VIDEO STORY
  // --------------------------------------------------

  async function handleAddStory() {
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

      Alert.alert(
        'Add music to your story?',
        'Choose how you want to publish your story.',
        [
          {
            text: 'Without music',
            onPress: () => publishSelectedStory(asset),
          },
          {
            text: 'Phone music',
            onPress: () => choosePhoneMusic(asset),
          },
          {
            text: 'Music library',
            onPress: () => chooseLibraryMusic(asset),
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ]
      );
    } catch (err) {
      console.error('Story picker error:', err);

      Alert.alert(
        'Story error',
        err.message || 'Could not open Gallery.'
      );
    }
  }

  // --------------------------------------------------
  // MARK STORY AS VIEWED
  // --------------------------------------------------

  async function recordStoryView(story, group) {
    if (!story || group?.isOwn) return;

    try {
      await markStoryViewed({
        storyId: story.id,
        viewerId: userId,
      });

      setStories((current) =>
        current.map((item) => {
          if (item.userId !== group.userId) return item;

          const updatedStories = item.stories.map((entry) =>
            entry.id === story.id
              ? {
                  ...entry,
                  viewed_by_me: true,
                }
              : entry
          );

          return {
            ...item,
            hasUnseen: updatedStories.some(
              (entry) => !entry.viewed_by_me
            ),
            stories: updatedStories,
          };
        })
      );
    } catch (err) {
      console.error('Story view error:', err);
    }
  }

  // --------------------------------------------------
  // OPEN STORY GROUP
  // --------------------------------------------------

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

    setLikingId(post.id);

    try {
      const result = await togglePostLike({
        postId: post.id,
        userId,
        currentlyLiked: post.liked_by_me,
      });

      updateFeedPost({
        ...post,
        liked_by_me: result.liked,
        like_count: Math.max(
          0,
          (post.like_count || 0) +
            (result.liked ? 1 : -1)
        ),
      });
    } catch (err) {
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
  // RENDER
  // --------------------------------------------------

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="#FFFFFF"
      />

      {/* HEADER */}

      <View style={styles.header}>
        <Text style={styles.logo}>social.</Text>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                'Activity',
                'Notifications will be added next.'
              )
            }
          >
            <Ionicons
              name="heart-outline"
              size={27}
              color="#111"
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                'Messages',
                'Messaging will be added next.'
              )
            }
          >
            <Ionicons
              name="paper-plane-outline"
              size={26}
              color="#111"
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
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
              user: null,
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
              <ActivityIndicator color="#777" />
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

        <View style={styles.separator} />

        {/* FEED */}

        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator
              size="large"
              color="#111"
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
              color="#777"
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
              liking={likingId === post.id}
              saving={savingId === post.id}
            />
          ))
        )}
      </ScrollView>

      {/* ------------------------------------------------
          FULL SCREEN STORY VIEWER
      ------------------------------------------------ */}

      <Modal
        visible={viewerVisible}
        animationType="fade"
        onRequestClose={() => setViewerVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.viewer}>
          {activeStory && activeGroup ? (
            <>
              <StoryMedia
                key={activeStory.id}
                story={activeStory}
              />

              {/* STORY PROGRESS */}

              <View style={styles.progressContainer}>
                {activeGroup.stories.map((story, index) => (
                  <View
                    key={story.id}
                    style={styles.progressTrack}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        index <= activeStoryIndex &&
                          styles.progressActive,
                      ]}
                    />
                  </View>
                ))}
              </View>

              {/* STORY HEADER */}

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

              {/* MUSIC LABEL */}

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

              {/* TAP ZONES */}

              <View style={styles.viewerTapZones}>
                <TouchableOpacity
                  style={styles.viewerLeftZone}
                  activeOpacity={1}
                  onPress={previousStory}
                />

                <TouchableOpacity
                  style={styles.viewerRightZone}
                  activeOpacity={1}
                  onPress={nextStory}
                />
              </View>

              <View style={styles.viewerBottom}>
                <Text style={styles.viewerHint}>
                  Tap right or left to navigate
                </Text>
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
        </View>
      </Modal>

      {/* ------------------------------------------------
          MUSIC LIBRARY MODAL
      ------------------------------------------------ */}

      <Modal
        visible={musicModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setMusicModalVisible(false)}
      >
        <View style={styles.musicOverlay}>
          <View style={styles.musicSheet}>
            <View style={styles.musicHeader}>
              <Text style={styles.musicHeading}>
                Choose music
              </Text>

              <TouchableOpacity
                onPress={() => setMusicModalVisible(false)}
              >
                <Ionicons
                  name="close"
                  size={25}
                  color="#111"
                />
              </TouchableOpacity>
            </View>

            {musicLoading ? (
              <ActivityIndicator
                size="large"
                color="#111"
              />
            ) : musicLibrary.length === 0 ? (
              <Text style={styles.musicEmpty}>
                No music tracks available yet.
              </Text>
            ) : (
              <ScrollView>
                {musicLibrary.map((track) => (
                  <TouchableOpacity
                    key={track.id}
                    style={styles.musicTrack}
                    onPress={() => selectLibraryTrack(track)}
                  >
                    <View style={styles.musicIcon}>
                      <Ionicons
                        name="musical-note"
                        size={21}
                        color="#FFF"
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.musicTrackTitle}>
                        {track.title}
                      </Text>

                      <Text style={styles.musicTrackArtist}>
                        {track.artist}
                      </Text>
                    </View>

                    <Ionicons
                      name="add-circle-outline"
                      size={24}
                      color="#1687E8"
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ------------------------------------------------
          COMMENTS MODAL
      ------------------------------------------------ */}

      <Modal
        visible={commentsVisible}
        animationType="slide"
        onRequestClose={() => setCommentsVisible(false)}
      >
        <SafeAreaView
          style={styles.modalSafe}
          edges={['top', 'bottom']}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setCommentsVisible(false)}
            >
              <Ionicons
                name="close"
                size={27}
                color="#111"
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
                color="#111"
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

                return (
                  <View
                    key={comment.id}
                    style={styles.commentRow}
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
                          color="#777"
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

                      <Text style={styles.commentTime}>
                        {timeAgo(comment.created_at)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <KeyboardAvoidingView
            behavior={
              Platform.OS === 'ios' ? 'padding' : undefined
            }
            keyboardVerticalOffset={
              Platform.OS === 'ios' ? 8 : 0
            }
          >
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
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// --------------------------------------------------
// STYLES
// --------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  header: {
    height: 54,
    paddingHorizontal: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  logo: {
    fontSize: 30,
    color: '#111',
    fontWeight: '900',
    letterSpacing: -1.5,
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },

  // Stories

  stories: {
    paddingVertical: 13,
    flexGrow: 0,
  },

  storiesContent: {
    paddingHorizontal: 10,
    alignItems: 'center',
  },

  story: {
    alignItems: 'center',
    width: 72,
    marginRight: 3,
  },

  storyRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    padding: 3,
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
    fontSize: 11,
    color: '#222',
    maxWidth: 68,
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

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#EAEAEA',
  },

  // Feed

  post: {
    marginBottom: 17,
  },

  postHeader: {
    height: 57,
    paddingHorizontal: 12,
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
    bottom: 80,
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
    bottom: 28,
    alignSelf: 'center',
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
    marginTop: 5,
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
});
