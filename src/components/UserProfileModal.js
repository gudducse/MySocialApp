import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import {
  getFollowState,
  toggleFollow,
  getProfileStats,
  getFollowUsers,
} from '../services/follows';
import {
  getRelationship,
  blockUser,
  unblockUser,
  setUserMute,
  setUserRestrict,
} from '../services/safety';
import { fetchUserPosts } from '../services/posts';
import PostDetailModal from './PostDetailModal';
import VideoThumbnail from './VideoThumbnail';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';
import useEdgeSwipeBack from '../hooks/useEdgeSwipeBack';
import { getProfileShareMessage } from '../services/shareLinks';

const { width } = Dimensions.get('window');

export default function UserProfileModal({
  visible,
  targetUserId,
  currentUserId,
  onClose,
  onOpenDirectMessage,
  onOpenProfile,
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [postsCount, setPostsCount] = useState(0);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [statsError, setStatsError] = useState('');
  const [followState, setFollowState] = useState('none');
  const [connectionsVisible, setConnectionsVisible] = useState(false);
  const [connectionsTitle, setConnectionsTitle] = useState('');
  const [connections, setConnections] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followBusy, setFollowBusy] = useState(false);
  const [relationship, setRelationship] = useState({
    blocked: false,
    blockedByThem: false,
    muted: false,
    restricted: false,
  });
  const [safetyVisible, setSafetyVisible] = useState(false);
  const [safetyBusy, setSafetyBusy] = useState(false);

  const [selectedPost, setSelectedPost] = useState(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const backGestureHandlers = useEdgeSwipeBack(onClose);

  const isOwnProfile = currentUserId === targetUserId;

  const loadUserData = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    setPostsCount(0);
    setFollowersCount(0);
    setFollowingCount(0);
    setStatsError('');
    try {
      // 1. Fetch Profile
      let { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('id, full_name, username, bio, avatar_url, is_private')
        .eq('id', targetUserId)
        .maybeSingle();

      if (
        profileErr &&
        /is_private.*(does not exist|schema cache)|column .*is_private/i.test(
          profileErr.message || ''
        )
      ) {
        const fallback = await supabase
          .from('profiles')
          .select('id, full_name, username, bio, avatar_url')
          .eq('id', targetUserId)
          .maybeSingle();

        profileData = fallback.data;
        profileErr = fallback.error;
      }

      if (profileErr) throw profileErr;
      const nextProfile = profileData || {
        id: targetUserId,
        full_name: 'User',
        username: `user_${targetUserId.slice(0, 6)}`,
        bio: '',
        avatar_url: null,
        is_private: false,
      };

      setProfile(nextProfile);
      setIsPrivate(Boolean(nextProfile.is_private));

      // 2. Fetch Follow Stats
      const followStatePromise = isOwnProfile
        ? Promise.resolve('none')
        : getFollowState(currentUserId, targetUserId);
      const statsPromise = followStatePromise.then((nextFollowState) =>
        getProfileStats(
          targetUserId,
          isOwnProfile ||
            !Boolean(nextProfile.is_private) ||
            nextFollowState === 'accepted'
        )
      );
      const [statsResult, followStateResult] = await Promise.allSettled([
        statsPromise,
        followStatePromise,
      ]);
      if (statsResult.status === 'fulfilled') {
        setPostsCount(statsResult.value.posts);
        setFollowersCount(statsResult.value.followers);
        setFollowingCount(statsResult.value.following);
      } else {
        console.warn('Profile statistics unavailable:', statsResult.reason);
        setStatsError(
          statsResult.reason?.message || 'Profile statistics are unavailable.'
        );
      }
      if (followStateResult.status === 'rejected') {
        throw followStateResult.reason;
      }
      setFollowState(followStateResult.value);

      if (!isOwnProfile) {
        const nextRelationship = await getRelationship(
          currentUserId,
          targetUserId
        );
        setRelationship(nextRelationship);
      }

      // 3. Fetch Posts
      const userPosts = await fetchUserPosts(targetUserId);
      setPosts(userPosts);
    } catch (err) {
      console.warn('Error loading user profile:', err);
    } finally {
      setLoading(false);
    }
  }, [targetUserId, currentUserId, isOwnProfile]);

  useEffect(() => {
    if (visible && targetUserId) {
      loadUserData();
    }
  }, [visible, targetUserId, loadUserData]);

  const handleToggleFollow = async () => {
    if (followBusy || isOwnProfile || !currentUserId) return;

    const previousState = followState;
    setFollowBusy(true);

    try {
      const nextState = await toggleFollow(currentUserId, targetUserId);
      setFollowState(nextState);

      if (previousState !== 'accepted' && nextState === 'accepted') {
        setFollowersCount((prev) => prev + 1);

        // Private accounts unlock their grid only after the request is accepted.
        const userPosts = await fetchUserPosts(targetUserId);
        setPosts(userPosts || []);
      } else if (previousState === 'accepted' && nextState !== 'accepted') {
        setFollowersCount((prev) => Math.max(0, prev - 1));

        if (isPrivate) setPosts([]);
      }
    } catch (err) {
      setFollowState(previousState);
      Alert.alert('Follow Error', err.message);
    } finally {
      setFollowBusy(false);
    }
  };

  const handleShareProfile = async () => {
    try {
      await Share.share({ message: getProfileShareMessage(profile) });
    } catch (error) {
      Alert.alert('Could not share profile', error.message);
    }
  };

  const refreshRelationship = async () => {
    const next = await getRelationship(currentUserId, targetUserId);
    setRelationship(next);
  };

  const handleBlock = () => {
    Alert.alert(
      relationship.blocked ? 'Unblock account?' : 'Block account?',
      relationship.blocked
        ? 'They will be able to find and follow you again.'
        : 'They will not be able to find your profile or message you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: relationship.blocked ? 'Unblock' : 'Block',
          style: 'destructive',
          onPress: async () => {
            setSafetyBusy(true);
            const wasBlocked = relationship.blocked;

            try {
              if (wasBlocked) {
                await unblockUser(targetUserId);
              } else {
                await blockUser(targetUserId);
              }

              await refreshRelationship();
              setSafetyVisible(false);

              if (wasBlocked) {
                await loadUserData();
              }
            } catch (err) {
              Alert.alert('Could not update block', err.message);
            } finally {
              setSafetyBusy(false);
            }
          },
        },
      ]
    );
  };

  const handleMute = async () => {
    setSafetyBusy(true);

    try {
      await setUserMute(
        targetUserId,
        !relationship.muted,
        !relationship.muted
      );
      await refreshRelationship();
      setSafetyVisible(false);
    } catch (err) {
      Alert.alert('Could not update mute', err.message);
    } finally {
      setSafetyBusy(false);
    }
  };

  const handleRestrict = async () => {
    setSafetyBusy(true);

    try {
      await setUserRestrict(targetUserId, !relationship.restricted);
      await refreshRelationship();
      setSafetyVisible(false);
    } catch (err) {
      Alert.alert('Could not update restriction', err.message);
    } finally {
      setSafetyBusy(false);
    }
  };

  const handleOpenPost = (post) => {
    setSelectedPost(post);
    setDetailVisible(true);
  };

  const openConnections = async (type) => {
    setConnectionsTitle(type === 'followers' ? 'Followers' : 'Following');
    setConnectionsVisible(true);
    setConnectionsLoading(true);
    setConnectionsError('');
    setConnections([]);

    try {
      const users = await getFollowUsers(targetUserId, type);
      setConnections(users);
    } catch (error) {
      setConnectionsError(error.message || 'Could not load this list.');
    } finally {
      setConnectionsLoading(false);
    }
  };

  if (!visible) return null;

  const displayName = profile?.full_name || profile?.username || 'User';
  const handleName = profile?.username || `user_${String(targetUserId).slice(0, 6)}`;
  const isLocked =
    (isPrivate && !isOwnProfile && followState !== 'accepted') ||
    relationship.blocked ||
    relationship.blockedByThem;
  const followLabel =
    followState === 'accepted'
      ? 'Following'
      : followState === 'pending'
      ? 'Requested'
      : 'Follow';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={styles.safe}
        edges={['top', 'bottom']}
        {...backGestureHandlers}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {handleName}
          </Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={handleShareProfile}
              disabled={!profile}
              accessibilityLabel="Share profile"
            >
              <Ionicons name="share-outline" size={21} color={colors.text} />
            </TouchableOpacity>
            {isOwnProfile ? (
              <View style={styles.headerButton} />
            ) : (
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => setSafetyVisible(true)}
                accessibilityLabel="Profile options"
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={23}
                  color={colors.text}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#9673FF" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* TOP STATS ROW */}
            <View style={styles.topRow}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarLetter}>
                    {displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}

              {!relationship.blocked && !relationship.blockedByThem ? (
                <View style={styles.statsContainer}>
                  <View style={styles.statBox}>
                    <Text style={styles.statNumber}>
                      {statsError ? '-' : postsCount}
                    </Text>
                    <Text style={styles.statLabel}>Posts</Text>
                  </View>
                  {isLocked ? (
                    <>
                      <View style={styles.statBox}>
                        <Text style={styles.statNumber}>
                          {statsError ? '-' : followersCount}
                        </Text>
                        <Text style={styles.statLabel}>Followers</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statNumber}>
                          {statsError ? '-' : followingCount}
                        </Text>
                        <Text style={styles.statLabel}>Following</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity style={styles.statBox} activeOpacity={0.7} onPress={() => openConnections('followers')}>
                        <Text style={styles.statNumber}>
                          {statsError ? '-' : followersCount}
                        </Text>
                        <Text style={styles.statLabel}>Followers</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.statBox} activeOpacity={0.7} onPress={() => openConnections('following')}>
                        <Text style={styles.statNumber}>
                          {statsError ? '-' : followingCount}
                        </Text>
                        <Text style={styles.statLabel}>Following</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ) : null}
            </View>

            {/* BIO INFO */}
            {!isLocked ? (
              <View style={styles.bioContainer}>
                <Text style={styles.name}>{displayName}</Text>
                <Text style={styles.username}>@{handleName}</Text>
                {!!profile?.bio && (
                  <Text style={styles.bio}>{profile.bio}</Text>
                )}
              </View>
            ) : null}

            {/* ACTION BUTTONS */}
            {!isOwnProfile &&
            !relationship.blocked &&
            !relationship.blockedByThem ? (
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[
                    styles.followBtn,
                    { backgroundColor: colors.accent },
                    followState !== 'none' && styles.followingBtn,
                    followState !== 'none' && {
                      backgroundColor: colors.raised,
                    },
                  ]}
                  onPress={handleToggleFollow}
                  disabled={followBusy}
                >
                  <Text
                    style={[
                      styles.followBtnText,
                      followState !== 'none' && styles.followingBtnText,
                    ]}
                  >
                    {followLabel}
                  </Text>
                </TouchableOpacity>

                {!isLocked ? (
                  <TouchableOpacity
                    style={styles.messageBtn}
                    onPress={() => {
                      onClose();
                      if (onOpenDirectMessage) {
                        onOpenDirectMessage(targetUserId, profile);
                      }
                    }}
                  >
                    <Text style={styles.messageBtnText}>Message</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {isLocked &&
            !relationship.blocked &&
            !relationship.blockedByThem ? (
              <View style={styles.tabBar}>
                <Ionicons
                  name="grid-outline"
                  size={24}
                  color={colors.text}
                />
              </View>
            ) : null}

            {isLocked ? (
              <View style={styles.privateContainer}>
                <View
                  style={[
                    styles.privateLockBadge,
                    { borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={48}
                    color={colors.text}
                  />
                </View>
                <Text style={styles.privateTitle}>
                  {relationship.blocked
                    ? 'You blocked this account'
                    : relationship.blockedByThem
                    ? 'This account blocked you'
                    : 'This account is private'}
                </Text>
                <Text style={styles.privateText}>
                  {relationship.blocked
                    ? 'Unblock this account to see their profile again.'
                    : relationship.blockedByThem
                    ? 'Their posts are not available to you.'
                    : 'Follow this account to see their photos and videos.'}
                </Text>

                {relationship.blocked ? (
                  <TouchableOpacity
                    style={[styles.unblockStateButton, { borderColor: colors.border }]}
                    onPress={handleBlock}
                  >
                    <Text style={[styles.unblockStateText, { color: colors.text }]}>
                      Unblock
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <>
                {/* POSTS GRID DIVIDER */}
                <View style={styles.tabBar}>
                  <Ionicons
                    name="grid-outline"
                    size={24}
                    color={colors.text}
                  />
                </View>

                {/* POSTS GRID */}
                {posts.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons
                      name="camera-outline"
                      size={48}
                      color="#AAA"
                    />
                    <Text style={styles.emptyText}>No posts yet</Text>
                  </View>
                ) : (
                  <View style={styles.grid}>
                    {posts.map((post) => (
                      <TouchableOpacity
                        key={post.id}
                        style={styles.gridItem}
                        activeOpacity={0.85}
                        onPress={() => handleOpenPost(post)}
                      >
                        {post.media_type === 'video' ? (
                          <VideoThumbnail
                            uri={post.media_url}
                            coverUri={post.cover_url}
                            style={styles.gridImage}
                            playIcon={false}
                          />
                        ) : (
                          <Image
                            source={{ uri: post.media_url }}
                            style={styles.gridImage}
                          />
                        )}
                        {post.media_type === 'video' && (
                          <View style={styles.videoBadge}>
                            <Ionicons
                              name="play"
                              size={14}
                              color="#FFF"
                            />
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        )}

        <Modal
          visible={connectionsVisible}
          animationType="slide"
          onRequestClose={() => setConnectionsVisible(false)}
        >
          <SafeAreaView style={styles.connectionsSafe} edges={['top', 'bottom']}>
            <View style={styles.connectionsHeader}>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => setConnectionsVisible(false)}
                accessibilityLabel="Back to profile"
              >
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.connectionsTitle}>{connectionsTitle}</Text>
              <View style={styles.headerRightSpace} />
            </View>

            {connectionsLoading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.accent} />
              </View>
            ) : connectionsError ? (
              <View style={styles.center}>
                <Text style={styles.connectionsEmptyText}>{connectionsError}</Text>
              </View>
            ) : connections.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="people-outline" size={42} color={colors.muted} />
                <Text style={styles.connectionsEmptyText}>No {connectionsTitle.toLowerCase()} yet.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.connectionsList}>
                {connections.map((person) => (
                  <TouchableOpacity
                    key={person.id}
                    style={styles.connectionRow}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${person.username || person.full_name || 'user'} profile`}
                    onPress={() => {
                      setConnectionsVisible(false);
                      onOpenProfile?.(person.id);
                    }}
                  >
                    {person.avatar_url ? (
                      <Image source={{ uri: person.avatar_url }} style={styles.connectionAvatar} />
                    ) : (
                      <View style={styles.connectionAvatarFallback}>
                        <Ionicons name="person" size={20} color="#777" />
                      </View>
                    )}
                    <View style={styles.connectionInfo}>
                      <Text style={styles.connectionName} numberOfLines={1}>
                        {person.full_name || person.username || 'User'}
                      </Text>
                      <Text style={styles.connectionUsername} numberOfLines={1}>
                        @{person.username || 'user'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#999" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

        {/* POST DETAIL MODAL */}
        {selectedPost && (
          <PostDetailModal
            visible={detailVisible}
            post={selectedPost}
            userId={currentUserId}
            onClose={() => setDetailVisible(false)}
            onPostDeleted={() => {
              setDetailVisible(false);
              loadUserData();
            }}
          />
        )}

        {safetyVisible ? (
          <View style={styles.safetyOverlay}>
            <TouchableOpacity
              style={styles.safetyScrim}
              activeOpacity={1}
              onPress={() => setSafetyVisible(false)}
            />
            <View style={styles.safetySheet}>
              <View style={styles.safetyHandle} />

              <Text style={styles.safetyTitle}>@{handleName}</Text>

              <TouchableOpacity
                style={styles.safetyRow}
                onPress={handleBlock}
                disabled={safetyBusy}
              >
                <Ionicons
                  name={
                    relationship.blocked
                      ? 'lock-open-outline'
                      : 'ban-outline'
                  }
                  size={21}
                  color={colors.danger}
                />
                <Text
                  style={[styles.safetyLabel, { color: colors.danger }]}
                >
                  {relationship.blocked
                    ? 'Unblock account'
                    : 'Block account'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.safetyRow}
                onPress={handleMute}
                disabled={safetyBusy}
              >
                <Ionicons
                  name={
                    relationship.muted
                      ? 'notifications-outline'
                      : 'notifications-off-outline'
                  }
                  size={21}
                  color={colors.text}
                />
                <Text
                  style={[styles.safetyLabel, { color: colors.text }]}
                >
                  {relationship.muted
                    ? 'Unmute posts and stories'
                    : 'Mute posts and stories'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.safetyRow}
                onPress={handleRestrict}
                disabled={safetyBusy}
              >
                <Ionicons
                  name="eye-off-outline"
                  size={21}
                  color={colors.text}
                />
                <Text
                  style={[styles.safetyLabel, { color: colors.text }]}
                >
                  {relationship.restricted
                    ? 'Unrestrict account'
                    : 'Restrict account'}
                </Text>
              </TouchableOpacity>

              {safetyBusy ? (
                <ActivityIndicator
                  style={{ marginTop: 10 }}
                  color={colors.accent}
                />
              ) : (
                <TouchableOpacity
                  style={[
                    styles.safetyCancel,
                    { borderColor: colors.border },
                  ]}
                  onPress={() => setSafetyVisible(false)}
                >
                  <Text
                    style={[styles.safetyLabel, { color: colors.text }]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const baseStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
    maxWidth: 220,
  },
  safetyOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 50,
    elevation: 20,
  },
  safetyScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  safetySheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
  },
  safetyHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD',
    alignSelf: 'center',
    marginBottom: 16,
  },
  safetyTitle: {
    color: '#111',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  safetyRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  safetyLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  safetyCancel: {
    minHeight: 48,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerRightSpace: {
    width: 44,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionsSafe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  connectionsHeader: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAEAEA',
  },
  connectionsTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
  },
  connectionsList: {
    paddingHorizontal: 16,
  },
  connectionRow: {
    width: '100%',
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAEAEA',
  },
  connectionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EAEAEA',
  },
  connectionAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EAEAEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  connectionName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
  },
  connectionUsername: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  connectionsEmptyText: {
    color: '#777',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#EAEAEA',
  },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#9673FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    color: '#FFF',
    fontSize: 29,
    fontWeight: '700',
  },
  statsContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginLeft: 12,
  },
  statBox: {
    alignItems: 'center',
    minWidth: 54,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 3,
  },
  bioContainer: {
    paddingHorizontal: 16,
    marginTop: 10,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
  },
  username: {
    fontSize: 13,
    color: '#888',
    marginTop: 1,
  },
  bio: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
    marginTop: 6,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 8,
  },
  followBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#0095F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  followingBtn: {
    backgroundColor: '#EFEFEF',
  },
  followBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
  followingBtnText: {
    color: '#111',
  },
  messageBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#EFEFEF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageBtnText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 13,
  },
  tabBar: {
    height: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#EAEAEA',
    marginTop: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridItem: {
    width: width / 3,
    height: width / 3,
    padding: 1,
    position: 'relative',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#EEE',
  },
  videoBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  privateContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  privateLockBadge: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateTitle: {
    color: '#111',
    fontSize: 19,
    fontWeight: '800',
    marginTop: 20,
    textAlign: 'center',
  },
  unblockStateButton: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 9,
  },
  unblockStateText: {
    fontSize: 13,
    fontWeight: '700',
  },
  privateText: {
    color: '#777',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyContainer: {
    paddingVertical: 50,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#999',
    marginTop: 10,
  },
});
