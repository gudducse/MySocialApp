import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Share,
  StyleSheet,
  Alert,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';
import useEdgeSwipeBack from '../hooks/useEdgeSwipeBack';
import CommentActionsSheet from './CommentActionsSheet';
import { getPostShareMessage } from '../services/shareLinks';
import { useVideoPlayer, VideoView } from 'expo-video';

import {
  fetchPostComments,
  addPostComment,
  togglePostLike,
  deletePost,
} from '../services/posts';

// --------------------------------------------------
// DATE HELPERS
// --------------------------------------------------

function formatDate(date) {
  if (!date) return '';

  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function timeAgo(date) {
  if (!date) return '';

  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  );

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return formatDate(date);
}

// --------------------------------------------------
// VIDEO PLAYER
// Separate component so the video hook is always
// called correctly when this component is mounted.
// --------------------------------------------------

function PostVideoPlayer({ uri, visible }) {
  const styles = useThemedStyles(baseStyles);
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = false;
    videoPlayer.play();
  });

  useEffect(() => {
    if (!player) return;

    if (visible) {
      player.play();
    } else {
      player.pause();
    }

    return () => {
      player.pause();
    };
  }, [player, visible]);

  if (!uri) {
    return (
      <View style={styles.videoError}>
        <Ionicons name="videocam-off-outline" size={42} color="#FFF" />
        <Text style={styles.videoErrorText}>Video unavailable</Text>
      </View>
    );
  }

  return (
    <View style={styles.videoContainer}>
      <VideoView
        player={player}
        style={styles.videoPlayer}
        contentFit="contain"
        nativeControls
        allowsFullscreen
        allowsPictureInPicture={false}
      />
    </View>
  );
}

// --------------------------------------------------
// POST MEDIA
// --------------------------------------------------

function PostMedia({ post, visible }) {
  const styles = useThemedStyles(baseStyles);
  const isVideo = post?.media_type === 'video';

  if (!post?.media_url) {
    return (
      <View style={styles.mediaError}>
        <Ionicons name="image-outline" size={42} color="#FFF" />
        <Text style={styles.videoErrorText}>Media unavailable</Text>
      </View>
    );
  }

  if (isVideo) {
    return (
      <PostVideoPlayer
        key={post.id}
        uri={post.media_url}
        visible={visible}
      />
    );
  }

  return (
    <Image
      source={{ uri: post.media_url }}
      style={styles.postImage}
      resizeMode="contain"
    />
  );
}

// --------------------------------------------------
// POST DETAIL MODAL
// --------------------------------------------------

export default function PostDetailModal({
  visible,
  post: initialPost,
  userId,
  onClose,
  onPostUpdated,
  onPostDeleted,
  onOpenUserProfile,
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const [post, setPost] = useState(initialPost || null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');

  const [commentsLoading, setCommentsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [liking, setLiking] = useState(false);
  const [commentActionTarget, setCommentActionTarget] = useState(null);

  // Update selected post
  useEffect(() => {
    setPost(initialPost || null);
    setComments([]);
    setCommentText('');
    setCommentActionTarget(null);
  }, [initialPost?.id]);

  // Load comments
  useEffect(() => {
    let active = true;

    async function loadComments() {
      if (!visible || !initialPost?.id) return;

      setCommentsLoading(true);

      try {
        const rows = await fetchPostComments(initialPost.id);

        if (active) {
          setComments(rows || []);
        }
      } catch (error) {
        if (active) {
          Alert.alert('Could not load comments', error.message);
        }
      } finally {
        if (active) {
          setCommentsLoading(false);
        }
      }
    }

    loadComments();

    return () => {
      active = false;
    };
  }, [visible, initialPost?.id]);

  // --------------------------------------------------
  // LIKE
  // --------------------------------------------------

  async function handleLike() {
    if (!post || liking || !userId) return;

    const previousPost = post;
    const wasLiked = !!post.liked_by_me;

    const optimisticPost = {
      ...post,
      liked_by_me: !wasLiked,
      like_count: Math.max(
        0,
        (post.like_count || 0) + (wasLiked ? -1 : 1)
      ),
    };

    setPost(optimisticPost);
    setLiking(true);

    try {
      await togglePostLike({
        postId: post.id,
        userId,
        currentlyLiked: wasLiked,
      });

      onPostUpdated?.(optimisticPost);
    } catch (error) {
      setPost(previousPost);
      Alert.alert('Like failed', error.message);
    } finally {
      setLiking(false);
    }
  }

  // --------------------------------------------------
  // COMMENT
  // --------------------------------------------------

  async function handleComment() {
    const body = commentText.trim();

    if (!body || submitting || !post?.id || !userId) return;

    setSubmitting(true);

    try {
      const newComment = await addPostComment({
        postId: post.id,
        userId,
        body,
      });

      setComments((current) => [...current, newComment]);
      setCommentText('');

      const updatedPost = {
        ...post,
        comment_count: (post.comment_count || 0) + 1,
      };

      setPost(updatedPost);
      onPostUpdated?.(updatedPost);
    } catch (error) {
      Alert.alert('Comment failed', error.message);
    } finally {
      setSubmitting(false);
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

    if (post) {
      const updatedPost = {
        ...post,
        comment_count: Math.max(0, (post.comment_count || 1) - 1),
      };

      setPost(updatedPost);
      onPostUpdated?.(updatedPost);
    }
  }

  // --------------------------------------------------
  // SHARE
  // --------------------------------------------------

  async function handleShare() {
    if (!post) return;

    try {
      await Share.share({
        message: getPostShareMessage(post),
      });
    } catch (error) {
      Alert.alert('Share failed', error.message);
    }
  }

  function handleClose() {
    setCommentActionTarget(null);
    onClose?.();
  }

  const backGestureHandlers = useEdgeSwipeBack(handleClose);

  function handleOptions() {
    if (!post) return;
    const isMine = post.user_id === userId;

    if (isMine) {
      Alert.alert('Post Options', 'Manage your post', [
        {
          text: 'Delete Post',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete Post',
              'Are you sure you want to delete this post permanently?',
              [
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
                      Alert.alert('Deleted', 'Your post has been removed.');
                      handleClose();
                      onPostDeleted?.(post.id);
                    } catch (err) {
                      Alert.alert('Delete failed', err.message);
                    }
                  },
                },
              ]
            );
          },
        },
        { text: 'Share Post', onPress: handleShare },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      Alert.alert('Post Options', 'Select an action', [
        { text: 'Share Post', onPress: handleShare },
        {
          text: 'Report Post',
          style: 'destructive',
          onPress: () => Alert.alert('Reported', 'Thank you for reporting this post.'),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  if (!post) return null;

  const authorName =
    post.author?.username ||
    post.author?.full_name ||
    post.username ||
    'user';

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
      onDismiss={() => {}}
    >
      <SafeAreaView
        style={styles.safe}
        edges={['top', 'bottom']}
        {...backGestureHandlers}
      >
        {/* HEADER */}

        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.headerButton}
          >
            <Ionicons name="arrow-back" size={25} color={colors.text} />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Post</Text>

          <View style={styles.headerRightActions}>
            <TouchableOpacity
              onPress={handleShare}
              style={styles.headerButton}
            >
              <Ionicons name="share-outline" size={23} color={colors.text} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleOptions}
              style={styles.headerButton}
            >
              <Ionicons name="ellipsis-horizontal" size={23} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* AUTHOR */}

          <TouchableOpacity
            style={styles.authorRow}
            activeOpacity={0.8}
            onPress={() => onOpenUserProfile?.(post.user_id, post.author)}
          >
            {post.author?.avatar_url ? (
              <Image
                source={{ uri: post.author.avatar_url }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Ionicons name="person" size={18} color="#777" />
              </View>
            )}

            <View style={styles.authorInfo}>
              <Text style={styles.username}>{authorName}</Text>
              <Text style={styles.date}>
                {timeAgo(post.created_at)}
              </Text>
            </View>
          </TouchableOpacity>

          {/* IMAGE OR VIDEO */}

          <PostMedia post={post} visible={visible} />

          {/* ACTIONS */}

          <View style={styles.actions}>
            <View style={styles.leftActions}>
              <TouchableOpacity
                onPress={handleLike}
                disabled={liking}
              >
                <Ionicons
                  name={post.liked_by_me ? 'heart' : 'heart-outline'}
                  size={29}
                  color={post.liked_by_me ? '#E53955' : '#111'}
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() =>
                  Alert.alert(
                    'Comments',
                    'Scroll down to view and add comments.'
                  )
                }
              >
                <Ionicons
                  name="chatbubble-outline"
                  size={27}
                  color={colors.text}
                />
              </TouchableOpacity>

              <TouchableOpacity onPress={handleShare}>
                <Ionicons
                  name="paper-plane-outline"
                  size={27}
                  color={colors.text}
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.likeCount}>
              {post.like_count || 0} likes
            </Text>
          </View>

          {/* CAPTION */}

          <View style={styles.captionSection}>
            <Text style={styles.caption}>
              <Text style={styles.captionUsername}>
                {authorName}{' '}
              </Text>
              {post.caption || ''}
            </Text>

            <Text style={styles.uploadDate}>
              Posted on {formatDate(post.created_at)}
            </Text>
          </View>

          {/* COMMENTS */}

          <View style={styles.commentSection}>
            <Text style={styles.commentsTitle}>Comments</Text>

            {commentsLoading ? (
              <ActivityIndicator
                style={{ marginVertical: 20 }}
                color={colors.text}
              />
            ) : comments.length === 0 ? (
              <Text style={styles.noComments}>
                No comments yet. Be the first to comment.
              </Text>
            ) : (
              comments.map((comment) => {
                const canManageComment =
                  comment.user_id === userId ||
                  post?.user_id === userId;

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
                        source={{ uri: comment.author.avatar_url }}
                        style={styles.commentAvatar}
                      />
                    ) : (
                      <View style={styles.commentAvatarFallback}>
                        <Ionicons
                          name="person"
                          size={14}
                          color="#777"
                        />
                      </View>
                    )}

                    <View style={styles.commentContent}>
                      <Text style={styles.commentText}>
                        <Text style={styles.commentUsername}>
                          {comment.author?.username ||
                            comment.author?.full_name ||
                            'user'}{' '}
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
                          size={17}
                          color={colors.muted}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>

        {/* COMMENT INPUT */}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment..."
              placeholderTextColor="#999"
              multiline
              maxLength={1000}
            />

            <TouchableOpacity
              onPress={handleComment}
              disabled={!commentText.trim() || submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#1687E8" />
              ) : (
                <Text
                  style={[
                    styles.postButton,
                    !commentText.trim() && styles.disabled,
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
            postOwnerId={post?.user_id}
            onClose={() => setCommentActionTarget(null)}
            onUpdated={handleCommentUpdated}
            onDeleted={handleCommentDeleted}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// --------------------------------------------------
// STYLES
// --------------------------------------------------

const baseStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFF',
  },

  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD',
  },

  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  headerButton: {
    width: 40,
    alignItems: 'center',
  },

  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111',
  },

  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },

  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEE',
    alignItems: 'center',
    justifyContent: 'center',
  },

  authorInfo: {
    flex: 1,
  },

  username: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111',
  },

  date: {
    fontSize: 11,
    color: '#888',
    marginTop: 3,
  },

  videoContainer: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },

  videoPlayer: {
    width: '100%',
    height: '100%',
  },

  postImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#111',
  },

  videoError: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },

  mediaError: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },

  videoErrorText: {
    color: '#FFF',
    fontSize: 13,
    marginTop: 10,
  },

  actions: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 19,
  },

  likeCount: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111',
  },

  captionSection: {
    paddingHorizontal: 14,
    paddingBottom: 15,
  },

  caption: {
    fontSize: 13,
    lineHeight: 20,
    color: '#222',
  },

  captionUsername: {
    fontWeight: '800',
    color: '#111',
  },

  uploadDate: {
    fontSize: 10,
    color: '#999',
    marginTop: 10,
  },

  commentSection: {
    paddingHorizontal: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EEE',
  },

  commentsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },

  noComments: {
    color: '#999',
    fontSize: 13,
    marginTop: 15,
    marginBottom: 20,
  },

  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 17,
  },

  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },

  commentAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEE',
    justifyContent: 'center',
    alignItems: 'center',
  },

  commentContent: {
    flex: 1,
  },

  commentText: {
    fontSize: 13,
    color: '#222',
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

  commentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 4,
  },

  hiddenComment: {
    opacity: 0.55,
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
    marginTop: -3,
  },

  composer: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DDD',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
  },

  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 90,
    color: '#111',
    fontSize: 14,
    paddingVertical: 8,
  },

  postButton: {
    color: '#1687E8',
    fontSize: 14,
    fontWeight: '800',
  },

  disabled: {
    opacity: 0.35,
  },
});
