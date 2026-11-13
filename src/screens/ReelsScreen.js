
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Dimensions,
  TouchableOpacity,
  Image,
  Share,
  Alert,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';

import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import { togglePostLike, togglePostSaved, addPostComment, fetchPostComments, signPostMedia } from '../services/posts';
import { toggleFollow } from '../services/follows';
import UserProfileModal from '../components/UserProfileModal';
import { getPostShareMessage } from '../services/shareLinks';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function ReelItem({
  post,
  isActive,
  isScreenFocused,
  currentUserId,
  itemHeight,
  onOpenComments,
  onOpenProfile,
}) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [showPlayIcon, setShowPlayIcon] = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const tapTimerRef = useRef(null);
  const heartTimerRef = useRef(null);
  const likeBusyRef = useRef(false);

  const [liked, setLiked] = useState(post.liked_by_me || false);
  const [likeCount, setLikeCount] = useState(post.like_count || 0);
  const [saved, setSaved] = useState(post.saved_by_me || false);
  const [isFollowing, setIsFollowing] = useState(post.is_following || false);
  const [followBusy, setFollowBusy] = useState(false);
  const [expandedCaption, setExpandedCaption] = useState(false);

  const player = useVideoPlayer(post.media_url, (p) => {
    p.loop = true;
    p.muted = isMuted;
  });

  useEffect(() => {
    if (isActive && isScreenFocused) {
      player.muted = isMuted;
      player.play();
      setIsPlaying(true);
    } else {
      player.pause();
      setIsPlaying(false);
    }

    return () => {
      try {
        player.pause();
      } catch (err) {}
    };
  }, [isActive, isScreenFocused, player, isMuted]);

  const togglePlayPause = () => {
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      setShowPlayIcon(true);
    } else {
      player.play();
      setIsPlaying(true);
      setShowPlayIcon(true);
      setTimeout(() => setShowPlayIcon(false), 600);
    }
  };

  const handleLike = async () => {
    if (!currentUserId || likeBusyRef.current) return;

    likeBusyRef.current = true;
    const previousLiked = liked;
    const nextLiked = !previousLiked;

    setLiked(nextLiked);
    setLikeCount((prev) =>
      nextLiked ? prev + 1 : Math.max(0, prev - 1)
    );

    try {
      await togglePostLike({
        postId: post.id,
        userId: currentUserId,
        currentlyLiked: previousLiked,
      });
    } catch (err) {
      setLiked(previousLiked);
      setLikeCount((prev) =>
        previousLiked ? prev + 1 : Math.max(0, prev - 1)
      );
      Alert.alert('Like failed', err.message || 'Please try again.');
    } finally {
      likeBusyRef.current = false;
    }
  };

  const handleVideoTap = () => {
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;

      handleLike();
      setShowHeart(true);

      if (heartTimerRef.current) clearTimeout(heartTimerRef.current);
      heartTimerRef.current = setTimeout(() => setShowHeart(false), 700);
      return;
    }

    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      togglePlayPause();
    }, 280);
  };

  useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      if (heartTimerRef.current) clearTimeout(heartTimerRef.current);
    };
  }, []);

  const handleSave = async () => {
    if (!currentUserId) return;

    const nextSaved = !saved;
    setSaved(nextSaved);

    try {
      await togglePostSaved({
        postId: post.id,
        userId: currentUserId,
        currentlySaved: saved,
      });
    } catch (err) {
      setSaved(!nextSaved);
    }
  };

  const handleFollow = async () => {
    if (!currentUserId || followBusy || post.user_id === currentUserId) {
      return;
    }

    setFollowBusy(true);

    const nextFollow = !isFollowing;
    setIsFollowing(nextFollow);

    try {
      await toggleFollow(currentUserId, post.user_id);
    } catch (err) {
      setIsFollowing(!nextFollow);
    } finally {
      setFollowBusy(false);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Watch this Reel by @${post.author?.username || 'user'}:\n${getPostShareMessage(post)}`,
      });
    } catch (err) {}
  };

  const author = post.author || {};
  const authorName = author.username || author.full_name || 'user';
  const isMine = post.user_id === currentUserId;

  return (
    <View style={[styles.reelContainer, { height: itemHeight }]}>
      <TouchableOpacity
        activeOpacity={1}
        style={styles.videoTouch}
        onPress={handleVideoTap}
      >
        <VideoView
          player={player}
          style={styles.videoPlayer}
          contentFit="cover"
          nativeControls={false}
        />

        {showHeart && (
          <View pointerEvents="none" style={styles.doubleTapHeart}>
            <Text style={styles.doubleTapHeartText}>♥</Text>
          </View>
        )}

        {showPlayIcon && (
          <View style={styles.centerIcon}>
            <Ionicons
              name={isPlaying ? 'play' : 'pause'}
              size={54}
              color="rgba(255,255,255,0.85)"
            />
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.muteButton}
        onPress={() => setIsMuted((prev) => !prev)}
      >
        <Ionicons
          name={isMuted ? 'volume-mute' : 'volume-high'}
          size={18}
          color="#FFF"
        />
      </TouchableOpacity>

      <View style={styles.rightActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleLike}>
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={34}
            color={liked ? '#FF2D55' : '#FFF'}
          />
          <Text style={styles.actionText}>{likeCount}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onOpenComments(post)}
        >
          <Ionicons name="chatbubble-outline" size={30} color="#FFF" />
          <Text style={styles.actionText}>{post.comment_count || 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleSave}>
          <Ionicons
            name={saved ? 'bookmark' : 'bookmark-outline'}
            size={30}
            color={saved ? '#FFD700' : '#FFF'}
          />
          <Text style={styles.actionText}>{saved ? 'Saved' : 'Save'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
          <Ionicons name="paper-plane-outline" size={28} color="#FFF" />
          <Text style={styles.actionText}>Share</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bottomOverlay}>
        <View style={styles.authorRow}>
          <TouchableOpacity
            style={styles.avatarTouch}
            onPress={() => onOpenProfile(post.user_id, author)}
          >
            {author.avatar_url ? (
              <Image
                source={{ uri: author.avatar_url }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Ionicons name="person" size={16} color="#FFF" />
              </View>
            )}

            <Text style={styles.authorName}>@{authorName}</Text>
          </TouchableOpacity>

          {!isMine && (
            <TouchableOpacity
              style={[styles.followBtn, isFollowing && styles.followingBtn]}
              onPress={handleFollow}
              disabled={followBusy}
            >
              <Text
                style={[
                  styles.followBtnText,
                  isFollowing && styles.followingBtnText,
                ]}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {!!post.caption && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setExpandedCaption((prev) => !prev)}
          >
            <Text
              style={styles.caption}
              numberOfLines={expandedCaption ? undefined : 2}
            >
              {post.caption}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.audioRow}>
          <Ionicons name="musical-notes" size={14} color="#FFF" />
          <Text style={styles.audioText} numberOfLines={1}>
            Original audio · {authorName}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function ReelsScreen({ userId, route, navigation }) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();

  const reelsListRef = useRef(null);

  // Read the requested Home video only once.
  const requestedPostIdRef = useRef(route?.params?.postId || null);

  if (route?.params?.postId) {
    requestedPostIdRef.current = route.params.postId;
  }

  const [videos, setVideos] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [commentsPost, setCommentsPost] = useState(null);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);

  const [targetUserId, setTargetUserId] = useState(null);
  const [profileVisible, setProfileVisible] = useState(false);

  const bottomBarHeight =
    56 + Math.max(insets.bottom, Platform.OS === 'android' ? 6 : 0);

  const itemHeight = SCREEN_HEIGHT - bottomBarHeight;

  const loadVideos = useCallback(async () => {
    try {
      setError('');

      const { data, error: fetchError } = await supabase
        .from('social_posts')
        .select(
          'id, user_id, caption, media_url, media_path, media_type, cover_url, cover_path, created_at'
        )
        .eq('media_type', 'video')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      const securedData = await signPostMedia(data || []);

      if (!securedData.length) {
        setVideos([]);
        setActiveId(null);
        return;
      }

      const postIds = securedData.map((p) => p.id);
      const userIds = [...new Set(securedData.map((p) => p.user_id))];

      const [
        { data: profiles },
        { data: likes },
        { data: commentRows },
        { data: savedRows },
        { data: follows },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', userIds),

        supabase
          .from('social_post_likes')
          .select('post_id, user_id')
          .in('post_id', postIds),

        supabase
          .from('social_post_comments')
          .select('post_id')
          .in('post_id', postIds),

        userId
          ? supabase
              .from('social_saved_posts')
              .select('post_id')
              .eq('user_id', userId)
              .in('post_id', postIds)
          : { data: [] },

        userId
          ? supabase
              .from('user_follows')
              .select('following_id')
              .eq('follower_id', userId)
              .eq('status', 'accepted')
              .in('following_id', userIds)
          : { data: [] },
      ]);

      const profileMap = {};

      (profiles || []).forEach((p) => {
        profileMap[p.id] = p;
      });

      const likeCountMap = {};
      const likedByMeSet = new Set();

      (likes || []).forEach((l) => {
        likeCountMap[l.post_id] = (likeCountMap[l.post_id] || 0) + 1;

        if (l.user_id === userId) {
          likedByMeSet.add(l.post_id);
        }
      });

      const commentCountMap = {};

      (commentRows || []).forEach((c) => {
        commentCountMap[c.post_id] =
          (commentCountMap[c.post_id] || 0) + 1;
      });

      const savedSet = new Set(
        (savedRows || []).map((s) => s.post_id)
      );

      const followSet = new Set(
        (follows || []).map((f) => f.following_id)
      );

      const formatted = securedData.map((post) => ({
        ...post,

        author: profileMap[post.user_id] || {
          id: post.user_id,
          username: `user_${String(post.user_id).slice(0, 6)}`,
          full_name: 'User',
          avatar_url: null,
        },

        like_count: likeCountMap[post.id] || 0,
        liked_by_me: likedByMeSet.has(post.id),
        comment_count: commentCountMap[post.id] || 0,
        saved_by_me: savedSet.has(post.id),
        is_following: followSet.has(post.user_id),
      }));

      setVideos(formatted);

      const requestedId = requestedPostIdRef.current;

      const selectedPost = requestedId
        ? formatted.find(
            (post) => String(post.id) === String(requestedId)
          )
        : null;

      const nextActiveId = selectedPost
        ? selectedPost.id
        : formatted[0].id;

      setActiveId(nextActiveId);

      // Consume the requested ID so it does not reopen every time.
      if (selectedPost) {
        requestedPostIdRef.current = null;

        navigation?.setParams?.({
          postId: undefined,
        });
      }
    } catch (e) {
      console.log('Reels fetch error:', e);
      setError(e.message || 'Unable to load reels');
    } finally {
      setLoading(false);
    }
  }, [userId, navigation]);

  const openComments = async (post) => {
    setCommentsPost(post);
    setComments([]);
    setCommentText('');
    setCommentsVisible(true);
    setCommentsLoading(true);

    try {
      setComments(await fetchPostComments(post.id));
    } catch (loadError) {
      Alert.alert(
        'Comments unavailable',
        loadError.message || 'Please try again.'
      );
    } finally {
      setCommentsLoading(false);
    }
  };

  const submitReelComment = async () => {
    const body = commentText.trim();

    if (!body || !commentsPost || commentSending) return;

    setCommentSending(true);

    try {
      const newComment = await addPostComment({
        postId: commentsPost.id,
        userId,
        body,
      });

      setComments((current) => [...current, newComment]);
      setCommentText('');

      setVideos((current) =>
        current.map((video) =>
          video.id === commentsPost.id
            ? {
                ...video,
                comment_count: (video.comment_count || 0) + 1,
              }
            : video
        )
      );
    } catch (submitError) {
      Alert.alert(
        'Comment not sent',
        submitError.message || 'Please try again.'
      );
    } finally {
      setCommentSending(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadVideos();
    }, [loadVideos])
  );

  // Scroll to the Reel selected from Home.
  useEffect(() => {
    if (!videos.length || !activeId) return;

    const index = videos.findIndex(
      (post) => String(post.id) === String(activeId)
    );

    if (index < 0) return;

    const timer = setTimeout(() => {
      reelsListRef.current?.scrollToIndex({
        index,
        animated: false,
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [videos, activeId]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setActiveId(viewableItems[0].item.id);
    }
  }).current;

  if (loading && videos.length === 0) {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator color="#FFF" size="large" />
        <Text style={styles.loadingText}>Loading Reels...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

      <View style={[styles.headerBar, { top: insets.top + 10 }]}>
        <Text style={styles.headerTitle}>Reels</Text>
      </View>

      {error ? (
        <View style={styles.centerScreen}>
          <Text style={styles.errorText}>{error}</Text>

          <TouchableOpacity onPress={loadVideos} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : videos.length === 0 ? (
        <View style={styles.centerScreen}>
          <Ionicons name="videocam-outline" size={64} color="#888" />
          <Text style={styles.emptyTitle}>No Reels yet</Text>
          <Text style={styles.emptySub}>
            Upload a video from the Create tab to see it here!
          </Text>
        </View>
      ) : (
        <FlatList
          ref={reelsListRef}
          data={videos}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ReelItem
              post={item}
              isActive={activeId === item.id}
              isScreenFocused={
                isFocused && !commentsVisible && !profileVisible
              }
              currentUserId={userId}
              itemHeight={itemHeight}
              onOpenComments={openComments}
              onOpenProfile={(uId) => {
                setTargetUserId(uId);
                setProfileVisible(true);
              }}
            />
          )}
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={itemHeight}
          snapToAlignment="start"
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_data, index) => ({
            length: itemHeight,
            offset: itemHeight * index,
            index,
          })}
          initialScrollIndex={Math.max(
            0,
            videos.findIndex((post) => post.id === activeId)
          )}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              reelsListRef.current?.scrollToIndex({
                index: info.index,
                animated: false,
              });
            }, 300);
          }}
        />
      )}

      <Modal
        visible={commentsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentsVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.commentsScrim}>
          <TouchableOpacity
            style={styles.commentsBackdrop}
            activeOpacity={1}
            onPress={() => setCommentsVisible(false)}
          />

          <KeyboardAvoidingView
            style={styles.commentsSheet}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.commentsHandle} />

            <View style={styles.commentsHeader}>
              <Text style={styles.commentsTitle}>Comments</Text>

              <TouchableOpacity
                onPress={() => setCommentsVisible(false)}
                hitSlop={12}
              >
                <Ionicons name="close" size={24} color="#111" />
              </TouchableOpacity>
            </View>

            {commentsLoading ? (
              <ActivityIndicator
                style={{ marginTop: 24 }}
                color="#9673FF"
              />
            ) : (
              <FlatList
                data={comments}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.commentsList}
                ListEmptyComponent={
                  <Text style={styles.noComments}>
                    No comments yet. Be the first to comment.
                  </Text>
                }
                renderItem={({ item }) => (
                  <View style={styles.commentRow}>
                    {item.author?.avatar_url ? (
                      <Image
                        source={{ uri: item.author.avatar_url }}
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

                    <Text style={styles.commentBody}>
                      <Text style={styles.commentUsername}>
                        {item.author?.username ||
                          item.author?.full_name ||
                          'user'}{' '}
                      </Text>
                      {item.body}
                    </Text>
                  </View>
                )}
              />
            )}

            <View style={styles.commentComposer}>
              <TextInput
                style={styles.commentInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment…"
                placeholderTextColor="#888"
                maxLength={1000}
                returnKeyType="send"
                onSubmitEditing={submitReelComment}
              />

              <TouchableOpacity
                onPress={submitReelComment}
                disabled={!commentText.trim() || commentSending}
              >
                {commentSending ? (
                  <ActivityIndicator color="#9673FF" />
                ) : (
                  <Text
                    style={[
                      styles.postComment,
                      !commentText.trim() &&
                        styles.postCommentDisabled,
                    ]}
                  >
                    Post
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

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
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  headerBar: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  reelContainer: {
    width: SCREEN_WIDTH,
    backgroundColor: '#000000',
    position: 'relative',
  },
  videoTouch: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  doubleTapHeart: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doubleTapHeartText: {
    color: '#FFFFFF',
    fontSize: 105,
    textShadowColor: '#FF2D55',
    textShadowRadius: 20,
  },
  centerIcon: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.4)',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  muteButton: {
    position: 'absolute',
    top: 50,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  rightActions: {
    position: 'absolute',
    bottom: 25,
    right: 12,
    alignItems: 'center',
    gap: 18,
    zIndex: 10,
  },
  actionBtn: {
    alignItems: 'center',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 14,
    right: 75,
    zIndex: 10,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#9673FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  authorName: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 15,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  followBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FFF',
  },
  followingBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  followBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  followingBtnText: {
    color: '#EEE',
  },
  caption: {
    color: '#FFF',
    fontSize: 14,
    lineHeight: 19,
    marginTop: 8,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  audioText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  centerScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#AAA',
    marginTop: 12,
    fontSize: 14,
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 14,
  },
  emptySub: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 20,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 15,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 14,
    backgroundColor: '#9673FF',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
  commentsScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  commentsBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  commentsSheet: {
    height: '72%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 9,
  },
  commentsHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D2D2D7',
    marginBottom: 12,
  },
  commentsHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  commentsTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#16171B',
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 40,
  },
  commentsList: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexGrow: 1,
  },
  noComments: {
    color: '#777',
    textAlign: 'center',
    paddingTop: 32,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 9,
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEEEF2',
  },
  commentBody: {
    flex: 1,
    color: '#22232A',
    fontSize: 14,
    lineHeight: 20,
  },
  commentUsername: {
    fontWeight: '700',
    color: '#111216',
  },
  commentComposer: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
  },
  commentInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 100,
    color: '#16171B',
    borderRadius: 20,
    backgroundColor: '#F2F2F6',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  postComment: {
    color: '#7B5BE8',
    fontWeight: '700',
  },
  postCommentDisabled: {
    opacity: 0.45,
  },
});
