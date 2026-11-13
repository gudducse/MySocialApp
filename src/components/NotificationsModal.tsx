import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import type { Database } from '../types/database';
import {
  acceptFollowRequest,
  declineFollowRequest,
} from '../services/follows';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';
import useEdgeSwipeBack from '../hooks/useEdgeSwipeBack';

type NotificationProfile = {
  username: string | null;
  full_name: string;
  avatar_url: string | null;
};

type Activity = {
  kind:
    | 'follow'
    | 'follow_request'
    | 'follow_accepted'
    | 'like'
    | 'story_like'
    | 'comment';
  actorId: string;
  created_at: string;
  requestId?: string;
  storyId?: string;
  body?: string;
  profile?: NotificationProfile;
};

type NotificationsModalProps = {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
  onMarkRead?: () => void | Promise<void>;
  onOpenProfile?: (actorId: string) => void;
};

function timeAgo(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

export default function NotificationsModal({
  visible,
  userId,
  onClose,
  onMarkRead,
  onOpenProfile,
}: NotificationsModalProps) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const backGestureHandlers = useEdgeSwipeBack(onClose);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const loadActivities = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const [postsResult, followsResult, acceptedFollowsResult] = await Promise.all([
        supabase.from('social_posts').select('id').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
        supabase.from('user_follows').select('id, follower_id, created_at, status').eq('following_id', userId).order('created_at', { ascending: false }).limit(50),
        supabase
          .from('user_follows')
          .select('id, following_id, accepted_at')
          .eq('follower_id', userId)
          .eq('status', 'accepted')
          .not('accepted_at', 'is', null)
          .order('accepted_at', { ascending: false })
          .limit(50),
      ]);

      if (postsResult.error) throw postsResult.error;
      if (acceptedFollowsResult.error) {
        if (/accepted_at/i.test(acceptedFollowsResult.error.message || '')) {
          throw new Error(
            'Follow acceptance notifications are not set up yet. Run supabase/follow_request_acceptance_notifications.sql in the Supabase SQL Editor.'
          );
        }
        throw acceptedFollowsResult.error;
      }

      const posts = postsResult.data;
      let follows:
        | { id?: string; follower_id: string; created_at: string; status?: string }[]
        | null = followsResult.data;
      let followsError = followsResult.error;

      if (
        followsError &&
        /status.*(does not exist|schema cache)|column .*status/i.test(
          followsError.message || ''
        )
      ) {
        const fallback = await supabase
          .from('user_follows')
          .select('id, follower_id, created_at')
          .eq('following_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);

        follows = (fallback.data || []).map((row) => ({
          ...row,
          status: 'accepted',
        }));
        followsError = fallback.error;
      }

      if (followsError) throw followsError;

      const postIds = (posts || []).map((post) => post.id);
      const { data: stories, error: storiesError } = await supabase
        .from('social_stories')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (storiesError) throw storiesError;

      const storyIds = (stories || []).map((story) => story.id);
      const acceptedFollowActivities = (acceptedFollowsResult.data || []).flatMap(
        (item) => item.accepted_at
          ? [{
              kind: 'follow_accepted' as const,
              actorId: item.following_id,
              created_at: item.accepted_at,
            }]
          : []
      );
      let likes: Database['public']['Tables']['social_post_likes']['Row'][] = [];
      let comments: Database['public']['Tables']['social_post_comments']['Row'][] = [];
      let storyLikes: Database['public']['Tables']['social_story_likes']['Row'][] = [];
      if (postIds.length) {
        const results = await Promise.all([
          supabase.from('social_post_likes').select('post_id, user_id, created_at').in('post_id', postIds).order('created_at', { ascending: false }).limit(50),
          supabase.from('social_post_comments').select('id, post_id, user_id, body, created_at, is_hidden, hidden_at, hidden_by, edited_at').eq('is_hidden', false).in('post_id', postIds).order('created_at', { ascending: false }).limit(50),
        ]);
        if (results[0].error) throw results[0].error;
        likes = results[0].data || [];
        let commentRows: Database['public']['Tables']['social_post_comments']['Row'][] = [];
        let commentsResult = results[1];
        if (
          commentsResult.error &&
          /is_hidden|hidden_at|hidden_by|edited_at/i.test(
            commentsResult.error.message || ''
          ) &&
          /(does not exist|schema cache|could not find)/i.test(
            commentsResult.error.message || ''
          )
        ) {
          const fallbackComments = await supabase
            .from('social_post_comments')
            .select('id, post_id, user_id, body, created_at')
            .in('post_id', postIds)
            .order('created_at', { ascending: false })
            .limit(50);
          if (fallbackComments.error) throw fallbackComments.error;
          commentRows = (fallbackComments.data || []).map((row) => ({
            ...row,
            is_hidden: false,
            hidden_at: null,
            hidden_by: null,
            edited_at: null,
          }));
        } else {
          if (commentsResult.error) throw commentsResult.error;
          commentRows = commentsResult.data || [];
        }
        comments = commentRows;
      }

      if (storyIds.length) {
        const storyLikesResult = await supabase
          .from('social_story_likes')
          .select('story_id, user_id, created_at')
          .in('story_id', storyIds)
          .neq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);
        const missingStoryLikesTable =
          storyLikesResult.error?.code === 'PGRST205' ||
          /social_story_likes.*(schema cache|does not exist|could not find)/i.test(
            storyLikesResult.error?.message || ''
          );
        if (storyLikesResult.error && !missingStoryLikesTable) {
          throw storyLikesResult.error;
        }
        storyLikes = storyLikesResult.data || [];
      }

      const entries: Activity[] = [
        ...(follows || []).map((item) => ({
          kind: item.status === 'pending' ? 'follow_request' as const : 'follow' as const,
          actorId: item.follower_id,
          created_at: item.created_at,
          ...(item.status === 'pending' && item.id ? { requestId: item.id } : {}),
        })),
        ...acceptedFollowActivities,
        ...likes.filter((item) => item.user_id !== userId).map((item) => ({
          kind: 'like' as const,
          actorId: item.user_id,
          created_at: item.created_at,
        })),
        ...storyLikes.map((item) => ({
          kind: 'story_like' as const,
          actorId: item.user_id,
          created_at: item.created_at,
          storyId: item.story_id,
        })),
        ...comments.filter((item) => item.user_id !== userId).map((item) => ({
          kind: 'comment' as const,
          actorId: item.user_id,
          created_at: item.created_at,
          body: item.body,
        })),
      ];
      const actorIds = [...new Set(entries.map((item) => item.actorId))];
      let profilesById: Record<string, NotificationProfile> = {};
      if (actorIds.length) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles').select('id, username, full_name, avatar_url').in('id', actorIds);
        if (profilesError) throw profilesError;
        profilesById = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile]));
      }
      const sortedEntries = entries
        .map((item) => ({ ...item, profile: profilesById[item.actorId] }))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setActivities(sortedEntries);
      await onMarkRead?.();
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load activity.');
    } finally {
      setLoading(false);
    }
  }, [userId, onMarkRead]);

  const respondToFollowRequest = async (
    requestId: string | undefined,
    accept: boolean
  ) => {
    if (!userId || !requestId || busyRequestId) return;
    setBusyRequestId(requestId);
    try {
      if (accept) {
        await acceptFollowRequest(requestId, userId);
      } else {
        await declineFollowRequest(requestId, userId);
      }
      await loadActivities();
    } catch (actionError: unknown) {
      Alert.alert(
        accept ? 'Could not confirm request' : 'Could not ignore request',
        actionError instanceof Error ? actionError.message : 'Please try again.'
      );
    } finally {
      setBusyRequestId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={loadActivities}>
      <SafeAreaView
        style={styles.safe}
        edges={['top', 'bottom']}
        {...backGestureHandlers}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="arrow-back" size={25} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Notifications</Text>
          <View style={{ width: 25 }} />
        </View>
        <ScrollView
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadActivities} />}
          contentContainerStyle={activities.length === 0 ? styles.emptyContent : styles.list}
        >
          {loading && activities.length === 0 ? (
            <ActivityIndicator size="large" color="#555" />
          ) : error ? (
            <Text style={styles.emptyText}>{error}</Text>
          ) : activities.length === 0 ? (
            <>
              <Ionicons name="heart-outline" size={40} color={colors.muted} />
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptyText}>
                New likes, comments, followers, and follow requests will show up here.
              </Text>
            </>
          ) : activities.map((item, index) => {
            const name = item.profile?.username || item.profile?.full_name || 'Someone';
            const action = item.kind === 'follow'
              ? 'started following you'
              : item.kind === 'follow_request'
              ? 'requested to follow you'
              : item.kind === 'follow_accepted'
              ? 'accepted your follow request'
              : item.kind === 'like'
              ? 'liked your post'
              : item.kind === 'story_like'
              ? 'liked your story'
              : `commented: ${item.body}`;
            return (
              <View
                style={styles.activityItem}
                key={`${item.kind}-${item.actorId}-${item.created_at}-${index}`}
              >
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => onOpenProfile?.(item.actorId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name}'s profile`}
                  activeOpacity={0.75}
                >
                  {item.profile?.avatar_url ? (
                    <Image source={{ uri: item.profile.avatar_url }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarFallback}><Ionicons name="person" size={17} color={colors.muted} /></View>
                  )}
                  <Text style={styles.message} numberOfLines={3}>
                    <Text style={styles.username}>{name} </Text>{action}
                  </Text>
                  <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
                </TouchableOpacity>
                {item.kind === 'follow_request' && item.requestId ? (
                  <View style={styles.requestActions}>
                    {busyRequestId === item.requestId ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.confirmButton}
                          onPress={() => respondToFollowRequest(item.requestId, true)}
                          accessibilityRole="button"
                          accessibilityLabel={`Confirm ${name}'s follow request`}
                        >
                          <Text style={styles.confirmButtonText}>Confirm</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.ignoreButton, { borderColor: colors.border }]}
                          onPress={() => respondToFollowRequest(item.requestId, false)}
                          accessibilityRole="button"
                          accessibilityLabel={`Ignore ${name}'s follow request`}
                        >
                          <Text style={[styles.ignoreButtonText, { color: colors.text }]}>Ignore</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  header: { height: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DDD' },
  title: { color: '#111', fontSize: 17, fontWeight: '800' },
  list: { paddingVertical: 8 },
  activityItem: { paddingBottom: 8 },
  row: { minHeight: 68, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEE', alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1, color: '#333', fontSize: 14, lineHeight: 20 },
  username: { fontWeight: '800', color: '#111' },
  time: { color: '#999', fontSize: 12 },
  requestActions: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 69, paddingRight: 16 },
  confirmButton: { backgroundColor: '#3797EF', borderRadius: 7, paddingHorizontal: 14, paddingVertical: 8 },
  confirmButtonText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  ignoreButton: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 14, paddingVertical: 7 },
  ignoreButtonText: { fontSize: 13, fontWeight: '700' },
  emptyContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 10 },
  emptyTitle: { color: '#222', fontSize: 17, fontWeight: '800' },
  emptyText: { color: '#888', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
