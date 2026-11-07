
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
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../../lib/supabase';
import PostDetailModal from '../components/PostDetailModal';

export default function ProfileScreen({ userId, email, onLogout }) {
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

  // Followers and Following
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [connectionVisible, setConnectionVisible] = useState(false);
  const [connectionTitle, setConnectionTitle] = useState('');
  const [connectionUsers, setConnectionUsers] = useState([]);
  const [connectionLoading, setConnectionLoading] = useState(false);

  // Post detail
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailPost, setDetailPost] = useState(null);

  function openPostDetail(selectedPost) {
    if (!selectedPost?.id) {
      Alert.alert('Post unavailable', 'Please refresh your profile and try again.');
      return;
    }

    setDetailPost({ ...selectedPost });
    setDetailVisible(true);
  }

  function closePostDetail() {
    setDetailVisible(false);
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

  // Load profile
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
          .select('id, full_name, username, bio, avatar_url, created_at, updated_at')
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

  // Load current user's posts
  const loadMyPosts = useCallback(async () => {
    if (!userId) return;

    setPostsLoading(true);

    try {
      const { data, error } = await supabase
        .from('social_posts')
        .select('id, user_id, caption, media_url, media_path, media_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setPosts(data || []);
      console.log('My profile posts:', data?.length || 0);
    } catch (error) {
      console.error('Profile posts error:', error);
      Alert.alert('Posts loading failed', error.message);
    } finally {
      setPostsLoading(false);
    }
  }, [userId]);

  // Load follower and following counts
  const loadFollowStats = useCallback(async () => {
    if (!userId) return;

    try {
      const [followersResult, followingResult] = await Promise.all([
        supabase
          .from('user_follows')
          .select('follower_id', { count: 'exact', head: true })
          .eq('following_id', userId),

        supabase
          .from('user_follows')
          .select('following_id', { count: 'exact', head: true })
          .eq('follower_id', userId),
      ]);

      if (followersResult.error) throw followersResult.error;
      if (followingResult.error) throw followingResult.error;

      setFollowersCount(followersResult.count || 0);
      setFollowingCount(followingResult.count || 0);
    } catch (error) {
      console.error('Follow stats error:', error);
      Alert.alert('Follow stats failed', error.message);
    }
  }, [userId]);

  // Load both whenever Profile tab opens
  useFocusEffect(
    useCallback(() => {
      loadMyPosts();
      loadFollowStats();
    }, [loadMyPosts, loadFollowStats])
  );

  // Open followers or following list
  const openConnectionList = async (type) => {
    if (!userId) return;

    const isFollowers = type === 'followers';

    setConnectionTitle(isFollowers ? 'Followers' : 'Following');
    setConnectionVisible(true);
    setConnectionLoading(true);
    setConnectionUsers([]);

    try {
      const { data: relations, error: relationError } = await supabase
        .from('user_follows')
        .select(isFollowers ? 'follower_id' : 'following_id')
        .eq(isFollowers ? 'following_id' : 'follower_id', userId);

      if (relationError) throw relationError;

      const ids = (relations || [])
        .map((item) => isFollowers ? item.follower_id : item.following_id)
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

      // Keep the same order as the follow records
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

  // Save profile
  async function saveProfile() {
    if (!userId) return;

    if (!fullName.trim()) {
      Alert.alert('Required', 'Please enter your full name.');
      return;
    }

    const cleanUsername = username.trim().toLowerCase();

    if (cleanUsername && !/^[a-z0-9._]{3,20}$/.test(cleanUsername)) {
      Alert.alert(
        'Invalid username',
        'Use 3–20 characters: letters, numbers, dots or underscores.'
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
      setEditing(false);

      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (error) {
      Alert.alert('Could not save profile', error.message);
    } finally {
      setSaving(false);
    }
  }

  // Upload profile picture
  async function chooseAndUploadAvatar() {
    if (!userId) return;

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert('Permission needed', 'Please allow photo-library access.');
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
        username: profile?.username || username.trim().toLowerCase() || null,
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

      Alert.alert('Photo updated', 'Your profile picture has been uploaded.');
    } catch (error) {
      console.error('Avatar upload error:', error);
      Alert.alert('Upload failed', error.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#9673FF" />
        <Text style={styles.muted}>Loading profile...</Text>
      </SafeAreaView>
    );
  }

  const displayName =
    profile?.full_name || email?.split('@')[0] || 'Your name';

  const avatarUrl = profile?.avatar_url;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerUsername}>
            {profile?.username || email?.split('@')[0] || 'profile'}
          </Text>

          <TouchableOpacity
            onPress={() => Alert.alert('Settings', 'Settings coming soon.')}
          >
            <Ionicons name="menu-outline" size={29} color="#111" />
          </TouchableOpacity>
        </View>

        {/* Profile photo and stats */}
        <View style={styles.profileTop}>
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={chooseAndUploadAvatar}
            disabled={uploadingAvatar}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={43} color="#777" />
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

        {/* Change photo */}
        <TouchableOpacity
          style={styles.changePhotoButton}
          onPress={chooseAndUploadAvatar}
          disabled={uploadingAvatar}
        >
          <Text style={styles.changePhotoText}>
            {uploadingAvatar ? 'Uploading photo...' : 'Change profile photo'}
          </Text>
        </TouchableOpacity>

        {/* Profile details */}
        {!editing ? (
          <>
            <View style={styles.bioSection}>
              <Text style={styles.fullName}>{displayName}</Text>
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
                onPress={() => Alert.alert('Share Profile', 'Coming soon.')}
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

            <Text style={styles.label}>USERNAME</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="your_username"
              placeholderTextColor="#999"
            />

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
                setEditing(false);
              }}
            >
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Profile tabs */}
        <View style={styles.tabs}>
          <Ionicons name="grid-outline" size={26} color="#111" />
          <Ionicons name="person-outline" size={25} color="#999" />
        </View>

        {/* Profile post grid */}
        {postsLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color="#9673FF" />
            <Text style={styles.muted}>Loading your posts...</Text>
          </View>
        ) : posts.length > 0 ? (
          <View style={styles.postGrid}>
            {posts.map((post) => (
              <TouchableOpacity
                key={post.id}
                style={styles.postTile}
                activeOpacity={0.85}
                onPress={() => openPostDetail(post)}
              >
                <Image
                  source={{ uri: post.media_url }}
                  style={styles.postImage}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.gridCircle}>
              <Ionicons name="camera-outline" size={36} color="#111" />
            </View>

            <Text style={styles.emptyTitle}>Share your first post</Text>
            <Text style={styles.muted}>
              When you share photos and videos, they will appear here.
            </Text>
          </View>
        )}

        {/* Refresh */}
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => {
            loadMyPosts();
            loadFollowStats();
          }}
        >
          <Ionicons name="refresh-outline" size={17} color="#111" />
          <Text style={styles.refreshText}>Refresh profile</Text>
        </TouchableOpacity>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Followers / Following modal */}
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
                <Ionicons name="close" size={27} color="#111" />
              </TouchableOpacity>
            </View>

            {connectionLoading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color="#9673FF" />
                <Text style={styles.muted}>Loading...</Text>
              </View>
            ) : connectionUsers.length === 0 ? (
              <View style={styles.modalLoading}>
                <Ionicons name="people-outline" size={42} color="#999" />
                <Text style={styles.emptyTitle}>No users yet</Text>
                <Text style={styles.muted}>
                  This list will appear when people connect with you.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {connectionUsers.map((person) => (
                  <View key={person.id} style={styles.connectionRow}>
                    {person.avatar_url ? (
                      <Image
                        source={{ uri: person.avatar_url }}
                        style={styles.connectionAvatar}
                      />
                    ) : (
                      <View style={styles.connectionAvatarPlaceholder}>
                        <Ionicons name="person" size={21} color="#777" />
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
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Profile post detail */}
      <PostDetailModal
        key={detailPost?.id || 'profile-post-detail'}
        visible={detailVisible}
        post={detailPost}
        userId={userId}
        onClose={closePostDetail}
        onPostUpdated={handlePostUpdated}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  headerUsername: {
    fontSize: 21,
    fontWeight: '800',
    color: '#111',
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
  changePhotoButton: {
    alignSelf: 'flex-start',
    marginLeft: 16,
    marginTop: 1,
    paddingVertical: 7,
    paddingHorizontal: 11,
    backgroundColor: '#EFEFEF',
    borderRadius: 7,
  },
  changePhotoText: {
    color: '#111',
    fontSize: 12,
    fontWeight: '700',
  },
  bioSection: {
    paddingHorizontal: 16,
    marginTop: 15,
  },
  fullName: {
    fontSize: 14,
    color: '#111',
    fontWeight: '800',
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
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 20,
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
  },
  postImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#EEE',
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
  logoutButton: {
    backgroundColor: '#FCE8E8',
    padding: 13,
    margin: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  logoutText: {
    color: '#D93636',
    fontWeight: '800',
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
