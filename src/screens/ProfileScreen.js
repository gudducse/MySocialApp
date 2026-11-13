import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../../lib/supabase';
import { fetchUserPosts, fetchUserSavedPosts } from '../services/posts';
import {
  getFollowCounts,
  getPendingFollowRequests,
  acceptFollowRequest,
  declineFollowRequest,
} from '../services/follows';
import PostDetailModal from '../components/PostDetailModal';
import SettingsModal from '../components/SettingsModal';
import UserProfileModal from '../components/UserProfileModal';
import VideoThumbnail from '../components/VideoThumbnail';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';

// --------------------------------------------------
// PROFILE POST TILE
// --------------------------------------------------

function ProfilePostTile({ post, onPress }) {
  const styles = useThemedStyles(baseStyles);
  const isVideo = post?.media_type === 'video';

  return (
    <TouchableOpacity
      style={styles.postTile}
      activeOpacity={0.85}
      onPress={onPress}
    >
      {post?.media_url ? (
        isVideo ? (
          <VideoThumbnail
            uri={post.media_url}
            coverUri={post.cover_url}
            style={styles.postImage}
            playIcon={false}
          />
        ) : (
          <Image
            source={{ uri: post.media_url }}
            style={styles.postImage}
            resizeMode="cover"
          />
        )
      ) : (
        <View style={styles.postVideoTile}>
          <Ionicons name="image-outline" size={30} color="#FFF" />
        </View>
      )}

      {isVideo && (
        <View style={styles.videoCornerIcon}>
          <Ionicons name="play" size={18} color="#FFFFFF" />
        </View>
      )}
    </TouchableOpacity>
  );
}

// --------------------------------------------------
// PROFILE SCREEN
// --------------------------------------------------

export default function ProfileScreen({
  userId,
  email,
  navigation,
  onCreateStory,
  onLogout,
  onProfileAvatarChange,
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editing, setEditing] = useState(false);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [savedPhone, setSavedPhone] = useState('');

  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  const [connectionVisible, setConnectionVisible] = useState(false);
  const [connectionTitle, setConnectionTitle] = useState('');
  const [connectionProfileVisible, setConnectionProfileVisible] = useState(false);
  const [connectionProfileUserId, setConnectionProfileUserId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [followRequests, setFollowRequests] = useState([]);
  const [followRequestsVisible, setFollowRequestsVisible] = useState(false);
  const [followRequestsLoading, setFollowRequestsLoading] = useState(false);
  const [requestBusyId, setRequestBusyId] = useState(null);
  const [connectionUsers, setConnectionUsers] = useState([]);
  const [connectionLoading, setConnectionLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('posts'); // 'posts' | 'saved'
  const [savedPosts, setSavedPosts] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [createMenuVisible, setCreateMenuVisible] = useState(false);
  const [profileOptionsVisible, setProfileOptionsVisible] = useState(false);
  const [selfPreviewVisible, setSelfPreviewVisible] = useState(false);

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailPost, setDetailPost] = useState(null);

  function openPostDetail(selectedPost) {
    if (!selectedPost?.id) {
      Alert.alert(
        'Post unavailable',
        'Please refresh your profile and try again.'
      );
      return;
    }

    setDetailPost({ ...selectedPost });
    setDetailVisible(true);
  }

  function closePostDetail() {
    setDetailVisible(false);
  }

  function openCreateFlow(type) {
    setCreateMenuVisible(false);
    if (type === 'story') {
      onCreateStory?.();
      navigation.navigate('Home');
      return;
    }

    navigation.navigate('Create', { type });
  }

  function handlePostUpdated(updatedPost) {
    if (!updatedPost?.id) return;

    setPosts((current) =>
      current.map((item) =>
        item.id === updatedPost.id
          ? { ...item, ...updatedPost }
          : item
      )
    );

    setDetailPost((current) =>
      current?.id === updatedPost.id
        ? { ...current, ...updatedPost }
        : current
    );
  }

  // --------------------------------------------------
  // LOAD PROFILE
  // --------------------------------------------------

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, full_name, username, bio, avatar_url, created_at, updated_at'
          )
          .eq('id', userId)
          .maybeSingle();

        if (error) throw error;
        if (!mounted) return;

        const row = data || {
          id: userId,
          full_name: '',
          username: email?.split('@')[0] || '',
          bio: '',
          avatar_url: null,
        };

        setProfile(row);
        setFullName(row.full_name || '');
        setUsername(row.username || '');
        setBio(row.bio || '');

        try {
          const { data: contactRow } = await supabase
            .from('profile_contacts')
            .select('phone')
            .eq('user_id', userId)
            .maybeSingle();

          if (mounted) {
            setPhone(contactRow?.phone || '');
            setSavedPhone(contactRow?.phone || '');
          }
        } catch (contactError) {
          // profile_contacts may not exist until the contact SQL is run.
          console.warn('Contact info unavailable:', contactError.message);
        }
      } catch (error) {
        console.error('Profile load error:', error);

        if (mounted) {
          Alert.alert('Profile error', error.message);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [userId, email]);

  // --------------------------------------------------
  // LOAD MY POSTS
  // --------------------------------------------------

  const loadMyPosts = useCallback(async () => {
    if (!userId) return;

    setPostsLoading(true);

    try {
      const data = await fetchUserPosts(userId);

      setPosts(data || []);
      console.log('My profile posts:', data?.length || 0);
    } catch (error) {
      console.error('Profile posts error:', error);
      Alert.alert('Posts loading failed', error.message);
    } finally {
      setPostsLoading(false);
    }
  }, [userId]);

  // --------------------------------------------------
  // FOLLOW STATS
  // --------------------------------------------------

  const loadFollowStats = useCallback(async () => {
    if (!userId) return;

    try {
      const counts = await getFollowCounts(userId);
      setFollowersCount(counts.followers);
      setFollowingCount(counts.following);
    } catch (error) {
      console.error('Follow stats error:', error);
    }
  }, [userId]);

  const loadFollowRequests = useCallback(async () => {
    if (!userId) return;

    setFollowRequestsLoading(true);

    try {
      const requests = await getPendingFollowRequests(userId);
      setFollowRequests(requests);
    } catch (error) {
      console.warn('Could not load follow requests:', error.message);
    } finally {
      setFollowRequestsLoading(false);
    }
  }, [userId]);

  const loadSavedPosts = useCallback(async () => {
    if (!userId) return;
    setSavedLoading(true);
    try {
      const data = await fetchUserSavedPosts(userId);
      setSavedPosts(data || []);
    } catch (err) {
      console.warn('Failed to load saved posts:', err);
    } finally {
      setSavedLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadMyPosts();
      loadSavedPosts();
      loadFollowStats();
      loadFollowRequests();
    }, [loadMyPosts, loadSavedPosts, loadFollowStats, loadFollowRequests])
  );

  async function refreshProfile() {
    setRefreshing(true);

    try {
      await Promise.all([
        loadMyPosts(),
        loadSavedPosts(),
        loadFollowStats(),
        loadFollowRequests(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  // --------------------------------------------------
  // FOLLOWERS / FOLLOWING LIST
  // --------------------------------------------------

  const openConnectionList = async (type) => {
    if (!userId) return;

    const isFollowers = type === 'followers';

    setConnectionTitle(isFollowers ? 'Followers' : 'Following');
    setConnectionVisible(true);
    setConnectionLoading(true);
    setConnectionUsers([]);

    try {
      let relationResult = await supabase
        .from('user_follows')
        .select(isFollowers ? 'follower_id' : 'following_id')
        .eq(isFollowers ? 'following_id' : 'follower_id', userId)
        .or('status.eq.accepted,status.is.null');

      if (
        relationResult.error &&
        /status.*(does not exist|schema cache)|column .*status/i.test(
          relationResult.error.message || ''
        )
      ) {
        relationResult = await supabase
          .from('user_follows')
          .select(isFollowers ? 'follower_id' : 'following_id')
          .eq(isFollowers ? 'following_id' : 'follower_id', userId);
      }

      const relations = relationResult.data;
      const relationError = relationResult.error;

      if (relationError) throw relationError;

      const ids = (relations || [])
        .map((item) =>
          isFollowers ? item.follower_id : item.following_id
        )
        .filter(Boolean);

      if (ids.length === 0) {
        setConnectionUsers([]);
        return;
      }

      const { data: users, error: usersError } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, bio')
        .in('id', ids);

      if (usersError) throw usersError;

      const orderedUsers = ids
        .map((id) => (users || []).find((user) => user.id === id))
        .filter(Boolean);

      setConnectionUsers(orderedUsers);
    } catch (error) {
      console.error('Connection list error:', error);
      Alert.alert('Could not load list', error.message);
    } finally {
      setConnectionLoading(false);
    }
  };

  // --------------------------------------------------
  // FOLLOW REQUESTS
  // --------------------------------------------------

  async function handleAcceptFollowRequest(request) {
    if (!request?.id || requestBusyId) return;

    setRequestBusyId(request.id);

    try {
      await acceptFollowRequest(request.id, userId);
      setFollowRequests((current) =>
        current.filter((item) => item.id !== request.id)
      );
      await loadFollowStats();
    } catch (error) {
      Alert.alert('Could not accept request', error.message);
    } finally {
      setRequestBusyId(null);
    }
  }

  async function handleDeclineFollowRequest(request) {
    if (!request?.id || requestBusyId) return;

    setRequestBusyId(request.id);

    try {
      await declineFollowRequest(request.id, userId);
      setFollowRequests((current) =>
        current.filter((item) => item.id !== request.id)
      );
    } catch (error) {
      Alert.alert('Could not remove request', error.message);
    } finally {
      setRequestBusyId(null);
    }
  }

  // --------------------------------------------------
  // SAVE PROFILE
  // --------------------------------------------------

  async function saveProfile() {
    if (!userId) return;

    if (!fullName.trim()) {
      Alert.alert('Required', 'Please enter your full name.');
      return;
    }

    const cleanUsername = username.trim().toLowerCase();

    if (!cleanUsername) {
      Alert.alert('Username required', 'Choose a username for your profile.');
      return;
    }

    if (!/^[a-z0-9._]{3,20}$/.test(cleanUsername)) {
      Alert.alert(
        'Invalid username',
        'Use 3–20 characters: letters, numbers, dots or underscores.'
      );
      return;
    }

    const cleanPhone = phone.replace(/\D/g, '');

    if (cleanPhone && cleanPhone.length < 7) {
      Alert.alert(
        'Invalid phone',
        'Enter a valid phone number, or leave it empty.'
      );
      return;
    }

    setSaving(true);

    try {
      const payload = {
        id: userId,
        full_name: fullName.trim(),
        username: cleanUsername || null,
        bio: bio.trim(),
        avatar_url: profile?.avatar_url || null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();

      if (error) throw error;

      setProfile(data);
      onProfileAvatarChange?.(data.avatar_url || null);
      setEditing(false);

      try {
        if (cleanPhone) {
          const { error: phoneError } = await supabase
            .from('profile_contacts')
            .upsert(
              {
                user_id: userId,
                phone: cleanPhone,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id' }
            );

          if (phoneError) throw phoneError;
        } else {
          const { error: phoneError } = await supabase
            .from('profile_contacts')
            .delete()
            .eq('user_id', userId);

          // Removing a phone that was never saved is harmless; ignore it.
          if (phoneError && phoneError.code !== 'PGRST116') {
            console.warn('Could not clear contact phone:', phoneError.message);
          }
        }

        setSavedPhone(cleanPhone);
      } catch (phoneError) {
        Alert.alert(
          'Profile saved',
          'Your profile was updated, but contact sync could not be saved. Run supabase/contact_discovery_fix.sql in Supabase to enable it.'
        );
        return;
      }

      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (error) {
      if (error.code === '23505') {
        Alert.alert('Username unavailable', 'That username is already taken.');
      } else {
        Alert.alert('Could not save profile', error.message);
      }
    } finally {
      setSaving(false);
    }
  }

  // --------------------------------------------------
  // UPLOAD PROFILE PHOTO
  // --------------------------------------------------

  async function chooseAndUploadAvatar() {
    if (!userId) return;

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Permission needed',
          'Please allow photo-library access.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.75,
        base64: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];

      if (!asset.base64) {
        throw new Error('Image data unavailable.');
      }

      setUploadingAvatar(true);

      const contentType = asset.mimeType || 'image/jpeg';
      const extension = contentType.includes('png') ? 'png' : 'jpg';
      const filePath = `${userId}/${Date.now()}.${extension}`;

      const { data: uploaded, error: uploadError } =
        await supabase.storage
          .from('avatars')
          .upload(filePath, decode(asset.base64), {
            contentType,
            cacheControl: '3600',
            upsert: false,
          });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage
        .from('avatars')
        .getPublicUrl(uploaded.path);

      const payload = {
        id: userId,
        full_name: profile?.full_name || fullName.trim() || null,
        username:
          profile?.username || username.trim().toLowerCase() || null,
        bio: profile?.bio || bio.trim() || null,
        avatar_url: publicData.publicUrl,
        updated_at: new Date().toISOString(),
      };

      const { data: updatedProfile, error: profileError } =
        await supabase
          .from('profiles')
          .upsert(payload, { onConflict: 'id' })
          .select()
          .single();

      if (profileError) throw profileError;

      setProfile(updatedProfile);
      onProfileAvatarChange?.(updatedProfile.avatar_url || null);

      Alert.alert(
        'Photo updated',
        'Your profile picture has been uploaded.'
      );
    } catch (error) {
      console.error('Avatar upload error:', error);
      Alert.alert('Upload failed', error.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.muted}>Loading profile...</Text>
      </SafeAreaView>
    );
  }

  const displayName =
    profile?.full_name || email?.split('@')[0] || 'Your name';

  const avatarUrl = profile?.avatar_url;

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshProfile}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => setCreateMenuVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Create a post, reel, or story"
          >
            <Ionicons name="add" size={31} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerUsername} numberOfLines={1}>
              {profile?.username || email?.split('@')[0] || 'profile'}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => setSettingsVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Ionicons name="menu-outline" size={29} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.profileTop}>
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={() => setProfileOptionsVisible(true)}
            disabled={uploadingAvatar}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={43} color={colors.muted} />
              </View>
            )}

            <View style={styles.cameraBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="camera" size={15} color="#FFF" />
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.profileInfo}>
            <Text style={styles.fullName}>{displayName}</Text>
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{posts.length}</Text>
                <Text style={styles.statLabel}>Posts</Text>
              </View>

              <TouchableOpacity
                style={styles.stat}
                onPress={() => openConnectionList('followers')}
              >
                <Text style={styles.statNumber}>{followersCount}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.stat}
                onPress={() => openConnectionList('following')}
              >
                <Text style={styles.statNumber}>{followingCount}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {followRequests.length > 0 && (
          <TouchableOpacity
            style={[
              styles.followRequestsButton,
              {
                borderColor: colors.border,
                backgroundColor: colors.raised,
              },
            ]}
            onPress={() => {
              setFollowRequestsVisible(true);
              loadFollowRequests();
            }}
          >
            <Ionicons
              name="person-add-outline"
              size={18}
              color={colors.accent}
            />
            <Text
              style={[styles.followRequestsText, { color: colors.text }]}
            >
              Follow requests
            </Text>
            <View style={styles.followRequestsBadge}>
              <Text style={styles.followRequestsBadgeText}>
                {followRequests.length}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {!editing ? (
          <>
            <View style={styles.bioSection}>
              <Text style={styles.bio}>
                {profile?.bio || 'Add a bio to introduce yourself ✨'}
              </Text>
              <Text style={styles.email}>{email}</Text>
            </View>

            <View style={styles.buttons}>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setEditing(true)}
              >
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shareButton}
                onPress={() =>
                  Alert.alert('Share Profile', 'Coming soon.')
                }
              >
                <Text style={styles.editButtonText}>Share Profile</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.editForm}>
            <Text style={styles.label}>FULL NAME</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your full name"
              placeholderTextColor="#999"
            />

            <Text style={styles.label}>USERNAME (REQUIRED)</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Choose a username"
              placeholderTextColor="#999"
            />
            <Text style={styles.usernameHint}>
              People can use this username to find your profile.
            </Text>

            <Text style={styles.label}>BIO</Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio}
              onChangeText={setBio}
              multiline
              maxLength={160}
              placeholder="Write something about yourself..."
              placeholderTextColor="#999"
            />

            <Text style={styles.label}>PHONE (PRIVATE)</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="For contact matching only"
              placeholderTextColor="#999"
              maxLength={24}
            />
            <Text style={styles.phoneHint}>
              Never shown on your profile. Used only to match you with
              people already in your contacts.
            </Text>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={saveProfile}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.saveButtonText}>Save Profile</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setFullName(profile?.full_name || '');
                setUsername(profile?.username || '');
                setBio(profile?.bio || '');
                setPhone(savedPhone);
                setEditing(false);
              }}
            >
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'posts' && [
                styles.activeTabBtn,
                { borderBottomColor: colors.text },
              ],
            ]}
            onPress={() => setActiveTab('posts')}
          >
            <Ionicons
              name={activeTab === 'posts' ? 'grid' : 'grid-outline'}
              size={24}
              color={activeTab === 'posts' ? colors.text : colors.muted}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'saved' && [
                styles.activeTabBtn,
                { borderBottomColor: colors.text },
              ],
            ]}
            onPress={() => setActiveTab('saved')}
          >
            <Ionicons
              name={activeTab === 'saved' ? 'bookmark' : 'bookmark-outline'}
              size={24}
              color={activeTab === 'saved' ? colors.text : colors.muted}
            />
          </TouchableOpacity>
        </View>

        {activeTab === 'posts' ? (
          postsLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.muted}>Loading your posts...</Text>
            </View>
          ) : posts.length > 0 ? (
            <View style={styles.postGrid}>
              {posts.map((post) => (
                <ProfilePostTile
                  key={post.id}
                  post={post}
                  onPress={() => openPostDetail(post)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.gridCircle, { borderColor: colors.text }]}>
                <Ionicons name="camera-outline" size={36} color={colors.text} />
              </View>

              <Text style={styles.emptyTitle}>Share your first post</Text>
              <Text style={styles.muted}>
                When you share photos and videos, they will appear here.
              </Text>
            </View>
          )
        ) : (
          savedLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.muted}>Loading saved posts...</Text>
            </View>
          ) : savedPosts.length > 0 ? (
            <View style={styles.postGrid}>
              {savedPosts.map((post) => (
                <ProfilePostTile
                  key={post.id}
                  post={post}
                  onPress={() => openPostDetail(post)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.gridCircle, { borderColor: colors.text }]}>
                <Ionicons name="bookmark-outline" size={36} color={colors.text} />
              </View>

              <Text style={styles.emptyTitle}>Save posts</Text>
              <Text style={styles.muted}>
                Save photos and videos that you want to see again. No one is notified.
              </Text>
            </View>
          )
        )}

      </ScrollView>

      <Modal
        visible={profileOptionsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileOptionsVisible(false)}
      >
        <View style={styles.actionOverlay}>
          <TouchableOpacity
            style={[styles.actionScrim, { backgroundColor: colors.overlay }]}
            activeOpacity={1}
            onPress={() => setProfileOptionsVisible(false)}
          />
          <View style={[styles.profileActionSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>Your profile</Text>
            <TouchableOpacity
              style={styles.profileActionRow}
              onPress={() => {
                setProfileOptionsVisible(false);
                setSelfPreviewVisible(true);
              }}
            >
              <Ionicons name="eye-outline" size={22} color={colors.text} />
              <Text style={[styles.profileActionText, { color: colors.text }]}>View profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.profileActionRow}
              onPress={() => {
                setProfileOptionsVisible(false);
                setEditing(true);
              }}
            >
              <Ionicons name="create-outline" size={22} color={colors.text} />
              <Text style={[styles.profileActionText, { color: colors.text }]}>Edit profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.profileActionRow}
              onPress={() => {
                setProfileOptionsVisible(false);
                chooseAndUploadAvatar();
              }}
            >
              <Ionicons name="camera-outline" size={22} color={colors.text} />
              <Text style={[styles.profileActionText, { color: colors.text }]}>Change profile photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* FOLLOWERS / FOLLOWING MODAL */}

      <Modal
        visible={connectionVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setConnectionVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.connectionModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{connectionTitle}</Text>

              <TouchableOpacity
                onPress={() => setConnectionVisible(false)}
              >
                <Ionicons name="close" size={27} color={colors.text} />
              </TouchableOpacity>
            </View>

            {connectionLoading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.muted}>Loading...</Text>
              </View>
            ) : connectionUsers.length === 0 ? (
              <View style={styles.modalLoading}>
                <Ionicons name="people-outline" size={42} color={colors.muted} />
                <Text style={styles.emptyTitle}>No users yet</Text>
                <Text style={styles.muted}>
                  This list will appear when people connect with you.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {connectionUsers.map((person) => (
                  <TouchableOpacity
                    key={person.id}
                    style={styles.connectionRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      setConnectionVisible(false);
                      setConnectionProfileUserId(person.id);
                      setConnectionProfileVisible(true);
                    }}
                  >
                    {person.avatar_url ? (
                      <Image
                        source={{ uri: person.avatar_url }}
                        style={styles.connectionAvatar}
                      />
                    ) : (
                      <View style={styles.connectionAvatarPlaceholder}>
                        <Ionicons name="person" size={21} color={colors.muted} />
                      </View>
                    )}

                    <View style={styles.connectionInfo}>
                      <Text style={styles.connectionName}>
                        {person.full_name || person.username || 'User'}
                      </Text>
                      <Text style={styles.connectionUsername}>
                        @{person.username || 'user'}
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.muted}
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* FOLLOW REQUESTS */}

      <Modal
        visible={followRequestsVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFollowRequestsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.connectionModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Follow requests</Text>

              <TouchableOpacity
                onPress={() => setFollowRequestsVisible(false)}
              >
                <Ionicons name="close" size={27} color={colors.text} />
              </TouchableOpacity>
            </View>

            {followRequestsLoading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={colors.accent} />
              </View>
            ) : followRequests.length === 0 ? (
              <View style={styles.modalLoading}>
                <Ionicons
                  name="person-add-outline"
                  size={42}
                  color={colors.muted}
                />
                <Text style={styles.emptyTitle}>No requests</Text>
                <Text style={styles.muted}>
                  Requests to follow your private account will appear here.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {followRequests.map((request) => (
                  <View key={request.id} style={styles.connectionRow}>
                    {request.user.avatar_url ? (
                      <Image
                        source={{ uri: request.user.avatar_url }}
                        style={styles.connectionAvatar}
                      />
                    ) : (
                      <View style={styles.connectionAvatarPlaceholder}>
                        <Ionicons
                          name="person"
                          size={21}
                          color={colors.muted}
                        />
                      </View>
                    )}

                    <View style={styles.connectionInfo}>
                      <Text style={styles.connectionName}>
                        {request.user.full_name ||
                          request.user.username ||
                          'User'}
                      </Text>
                      <Text style={styles.connectionUsername}>
                        @{request.user.username || 'user'}
                      </Text>
                    </View>

                    {requestBusyId === request.id ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.accent}
                      />
                    ) : (
                      <View style={styles.requestActions}>
                        <TouchableOpacity
                          style={styles.requestAccept}
                          onPress={() =>
                            handleAcceptFollowRequest(request)
                          }
                        >
                          <Text style={styles.requestAcceptText}>
                            Confirm
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.requestDecline,
                            { borderColor: colors.border },
                          ]}
                          onPress={() =>
                            handleDeclineFollowRequest(request)
                          }
                        >
                          <Text
                            style={[
                              styles.requestDeclineText,
                              { color: colors.text },
                            ]}
                          >
                            Delete
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* POST DETAIL */}

      <PostDetailModal
        key={detailPost?.id || 'profile-post-detail'}
        visible={detailVisible}
        post={detailPost}
        userId={userId}
        onClose={closePostDetail}
        onPostUpdated={handlePostUpdated}
        onPostDeleted={() => {
          loadMyPosts();
          loadSavedPosts();
        }}
      />

      <UserProfileModal
        visible={selfPreviewVisible}
        targetUserId={userId}
        currentUserId={userId}
        onClose={() => setSelfPreviewVisible(false)}
        onOpenProfile={(nextUserId) => {
          setSelfPreviewVisible(false);
          setConnectionProfileUserId(nextUserId);
          setConnectionProfileVisible(true);
        }}
      />

      <UserProfileModal
        visible={connectionProfileVisible}
        targetUserId={connectionProfileUserId}
        currentUserId={userId}
        onClose={() => {
          setConnectionProfileVisible(false);
          setConnectionProfileUserId(null);
        }}
        onOpenProfile={(nextUserId) => setConnectionProfileUserId(nextUserId)}
      />

      {/* SETTINGS MODAL */}

      <Modal
        visible={createMenuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateMenuVisible(false)}
      >
        <View style={styles.actionOverlay}>
          <TouchableOpacity
            style={[styles.actionScrim, { backgroundColor: colors.overlay }]}
            activeOpacity={1}
            onPress={() => setCreateMenuVisible(false)}
          />
          <View
            style={[
              styles.profileActionSheet,
              { backgroundColor: colors.surface },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.border },
              ]}
            />
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Create
            </Text>
            {[
              { type: 'post', label: 'Post', icon: 'images-outline' },
              { type: 'reel', label: 'Reel', icon: 'videocam-outline' },
              { type: 'story', label: 'Story', icon: 'add-circle-outline' },
            ].map((item) => (
              <TouchableOpacity
                key={item.type}
                style={styles.profileActionRow}
                onPress={() => openCreateFlow(item.type)}
                accessibilityRole="button"
              >
                <Ionicons
                  name={item.icon}
                  size={22}
                  color={colors.text}
                />
                <Text
                  style={[styles.profileActionText, { color: colors.text }]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      <SettingsModal
        visible={settingsVisible}
        userId={userId}
        onClose={() => setSettingsVisible(false)}
        onEditProfile={() => setEditing(true)}
        onViewSaved={() => setActiveTab('saved')}
        onLogout={onLogout}
      />
    </SafeAreaView>
  );
}

// --------------------------------------------------
// STYLES
// --------------------------------------------------

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  center: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerAction: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerUsername: {
    fontSize: 21,
    fontWeight: '800',
    color: '#111',
    textAlign: 'center',
    maxWidth: '100%',
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatarContainer: {
    marginRight: 20,
    position: 'relative',
  },
  avatar: {
    width: 87,
    height: 87,
    borderRadius: 44,
    backgroundColor: '#EEE',
  },
  avatarPlaceholder: {
    width: 87,
    height: 87,
    borderRadius: 44,
    backgroundColor: '#EEE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  profileInfo: {
    flex: 1,
  },
  stat: {
    alignItems: 'center',
    minWidth: 55,
  },
  statNumber: {
    color: '#111',
    fontSize: 19,
    fontWeight: '800',
  },
  statLabel: {
    color: '#444',
    fontSize: 12,
    marginTop: 4,
  },
  bioSection: {
    paddingHorizontal: 16,
    marginTop: 15,
  },
  fullName: {
    fontSize: 14,
    color: '#111',
    fontWeight: '800',
    marginBottom: 10,
  },
  username: {
    color: '#777',
    fontSize: 12,
    marginTop: 3,
  },
  usernameHint: {
    color: '#777',
    fontSize: 11,
    marginTop: -7,
    marginBottom: 14,
  },
  bio: {
    color: '#333',
    fontSize: 13,
    marginTop: 4,
    lineHeight: 20,
  },
  email: {
    color: '#888',
    fontSize: 11,
    marginTop: 5,
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
    margin: 16,
  },
  editButton: {
    flex: 1,
    backgroundColor: '#EFEFEF',
    padding: 10,
    borderRadius: 7,
    alignItems: 'center',
  },
  shareButton: {
    flex: 1,
    backgroundColor: '#EFEFEF',
    padding: 10,
    borderRadius: 7,
    alignItems: 'center',
  },
  editButtonText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 13,
  },
  editForm: {
    margin: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#666',
    marginBottom: 7,
    marginTop: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 9,
    padding: 12,
    fontSize: 14,
    color: '#111',
  },
  bioInput: {
    height: 85,
    textAlignVertical: 'top',
  },
  phoneHint: {
    color: '#888',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
    marginBottom: 4,
  },
  saveButton: {
    backgroundColor: '#111',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  saveButtonText: {
    color: '#FFF',
    fontWeight: '800',
  },
  cancel: {
    textAlign: 'center',
    color: '#444',
    padding: 15,
    fontWeight: '600',
  },
  tabs: {
    height: 50,
    borderTopWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#EEE',
    flexDirection: 'row',
    marginTop: 20,
  },
  tabBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    borderBottomWidth: 1.5,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: {
    borderBottomColor: '#111',
  },
  postGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 2,
  },
  postTile: {
    width: '33.3333%',
    aspectRatio: 1,
    padding: 1,
    position: 'relative',
  },
  postImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#EEE',
  },
  postVideoTile: {
    width: '100%',
    height: '100%',
    backgroundColor: '#252535',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoCornerIcon: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    padding: 30,
  },
  gridCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '800',
    marginTop: 15,
    color: '#111',
    textAlign: 'center',
  },
  muted: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: 12,
  },
  refreshText: {
    color: '#111',
    fontSize: 13,
    fontWeight: '700',
  },
  actionOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  actionScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  profileActionSheet: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  profileActionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  profileActionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  connectionModal: {
    backgroundColor: '#FFF',
    height: '70%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 25,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#111',
  },
  modalLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 25,
  },
  followRequestsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 10,
  },
  followRequestsText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  followRequestsBadge: {
    minWidth: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#9673FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  followRequestsBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  requestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  requestAccept: {
    backgroundColor: '#0095F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  requestAcceptText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  requestDecline: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  requestDeclineText: {
    fontSize: 12,
    fontWeight: '700',
  },

  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.6,
    borderBottomColor: '#EEE',
  },
  connectionAvatar: {
    width: 47,
    height: 47,
    borderRadius: 24,
    backgroundColor: '#EEE',
  },
  connectionAvatarPlaceholder: {
    width: 47,
    height: 47,
    borderRadius: 24,
    backgroundColor: '#EEE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectionInfo: {
    marginLeft: 12,
    flex: 1,
  },
  connectionName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111',
  },
  connectionUsername: {
    fontSize: 12,
    color: '#777',
    marginTop: 3,
  },
});
