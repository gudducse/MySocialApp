
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

import {
  fetchPostComments,
  addPostComment,
  togglePostLike,
} from '../services/posts';

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

export default function PostDetailModal({
  visible,
  post: initialPost,
  userId,
  onClose,
  onPostUpdated,
}) {
  const [post, setPost] = useState(initialPost || null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [liking, setLiking] = useState(false);

  // Always use the exact post selected by the current screen.
  useEffect(() => {
    setPost(initialPost || null);
    setComments([]);
    setCommentText('');
  }, [initialPost?.id]);

  // Only load comments. Do not fetch or replace the post from Home Feed.
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

  async function handleShare() {
    if (!post) return;

    try {
      await Share.share({
        message: `${post.caption || 'Check out this post!'}\n${post.media_url || ''}`,
      });
    } catch (error) {
      Alert.alert('Share failed', error.message);
    }
  }

  if (!post) return null;

  const authorName =
    post.author?.username ||
    post.author?.full_name ||
    post.username ||
    'user';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={25} color="#111" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Post</Text>

          <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
            <Ionicons name="share-outline" size={23} color="#111" />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.authorRow}>
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
              <Text style={styles.date}>{timeAgo(post.created_at)}</Text>
            </View>
          </View>

          <Image
            source={{ uri: post.media_url }}
            style={styles.postImage}
            resizeMode="contain"
          />

          <View style={styles.actions}>
            <View style={styles.leftActions}>
              <TouchableOpacity onPress={handleLike} disabled={liking}>
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
                <Ionicons name="chatbubble-outline" size={27} color="#111" />
              </TouchableOpacity>

              <TouchableOpacity onPress={handleShare}>
                <Ionicons
                  name="paper-plane-outline"
                  size={27}
                  color="#111"
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.likeCount}>
              {post.like_count || 0} likes
            </Text>
          </View>

          <View style={styles.captionSection}>
            <Text style={styles.caption}>
              <Text style={styles.captionUsername}>{authorName} </Text>
              {post.caption || ''}
            </Text>

            <Text style={styles.uploadDate}>
              Posted on {formatDate(post.created_at)}
            </Text>
          </View>

          <View style={styles.commentSection}>
            <Text style={styles.commentsTitle}>Comments</Text>

            {commentsLoading ? (
              <ActivityIndicator
                style={{ marginVertical: 20 }}
                color="#111"
              />
            ) : comments.length === 0 ? (
              <Text style={styles.noComments}>
                No comments yet. Be the first to comment.
              </Text>
            ) : (
              comments.map((comment) => (
                <View key={comment.id} style={styles.commentRow}>
                  {comment.author?.avatar_url ? (
                    <Image
                      source={{ uri: comment.author.avatar_url }}
                      style={styles.commentAvatar}
                    />
                  ) : (
                    <View style={styles.commentAvatarFallback}>
                      <Ionicons name="person" size={14} color="#777" />
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

                    <Text style={styles.commentTime}>
                      {timeAgo(comment.created_at)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>

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
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD',
  },
  headerButton: { width: 40, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111' },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorInfo: { flex: 1 },
  username: { fontSize: 13, fontWeight: '800', color: '#111' },
  date: { fontSize: 11, color: '#888', marginTop: 3 },
  postImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#111',
  },
  actions: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftActions: { flexDirection: 'row', alignItems: 'center', gap: 19 },
  likeCount: { fontSize: 13, fontWeight: '800', color: '#111' },
  captionSection: { paddingHorizontal: 14, paddingBottom: 15 },
  caption: { fontSize: 13, lineHeight: 20, color: '#222' },
  captionUsername: { fontWeight: '800', color: '#111' },
  uploadDate: { fontSize: 10, color: '#999', marginTop: 10 },
  commentSection: {
    paddingHorizontal: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EEE',
  },
  commentsTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  noComments: { color: '#999', fontSize: 13, marginTop: 15, marginBottom: 20 },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 17,
  },
  commentAvatar: { width: 32, height: 32, borderRadius: 16 },
  commentAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  commentContent: { flex: 1 },
  commentText: { fontSize: 13, color: '#222', lineHeight: 19 },
  commentUsername: { fontWeight: '800', color: '#111' },
  commentTime: { color: '#999', fontSize: 10, marginTop: 4 },
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
  postButton: { color: '#1687E8', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.35 },
});
