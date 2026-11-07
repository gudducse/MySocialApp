
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

export default function ExploreScreen() {
  const [userId, setUserId] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);

  // Get the currently logged-in user
  useEffect(() => {
    async function getCurrentUser() {
      const { data, error } = await supabase.auth.getUser();

      if (error) {
        Alert.alert('Error', error.message);
        setLoading(false);
        return;
      }

      setUserId(data.user?.id || null);
    }

    getCurrentUser();
  }, []);

  // Search users and load their follow status/counts
  const loadUsers = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);

      let query = supabase
        .from('profiles')
        .select('id, full_name, username, bio, avatar_url')
        .neq('id', userId)
        .limit(30);

      const term = search.trim().replace(/[,()]/g, '');

      if (term) {
        query = query.or(
          `username.ilike.%${term}%,full_name.ilike.%${term}%`
        );
      }

      const { data: profiles, error: profileError } = await query;

      if (profileError) throw profileError;

      const profileList = profiles || [];

      if (profileList.length === 0) {
        setUsers([]);
        return;
      }

      const profileIds = profileList.map((profile) => profile.id);

      const { data: followRows, error: followError } = await supabase
        .from('user_follows')
        .select('follower_id, following_id')
        .in('following_id', profileIds);

      if (followError) throw followError;

      const followMap = {};

      (followRows || []).forEach((row) => {
        if (!followMap[row.following_id]) {
          followMap[row.following_id] = {
            followers: 0,
            isFollowing: false,
          };
        }

        followMap[row.following_id].followers += 1;

        if (row.follower_id === userId) {
          followMap[row.following_id].isFollowing = true;
        }
      });

      const formattedUsers = profileList.map((profile) => ({
        ...profile,
        followers: followMap[profile.id]?.followers || 0,
        isFollowing: followMap[profile.id]?.isFollowing || false,
      }));

      setUsers(formattedUsers);
    } catch (error) {
      console.log('Explore error:', error.message);
      Alert.alert('Explore Error', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, search]);

  // Search after the user pauses typing
  useEffect(() => {
    if (!userId) return;

    const timer = setTimeout(() => {
      loadUsers();
    }, 400);

    return () => clearTimeout(timer);
  }, [userId, search, loadUsers]);

  // Follow or unfollow
  const handleFollow = async (targetUserId) => {
    if (!userId || busyUserId) return;

    const target = users.find((item) => item.id === targetUserId);
    if (!target) return;

    setBusyUserId(targetUserId);

    try {
      if (target.isFollowing) {
        const { error } = await supabase
          .from('user_follows')
          .delete()
          .eq('follower_id', userId)
          .eq('following_id', targetUserId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_follows')
          .insert({
            follower_id: userId,
            following_id: targetUserId,
          });

        if (error) throw error;
      }

      setUsers((currentUsers) =>
        currentUsers.map((item) => {
          if (item.id !== targetUserId) return item;

          return {
            ...item,
            isFollowing: !item.isFollowing,
            followers: Math.max(
              0,
              item.followers + (item.isFollowing ? -1 : 1)
            ),
          };
        })
      );
    } catch (error) {
      Alert.alert('Follow Error', error.message);
    } finally {
      setBusyUserId(null);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadUsers();
  };

  const renderUser = ({ item }) => {
    const displayName =
      item.full_name || item.username || 'User';

    return (
      <View style={styles.userCard}>
        {item.avatar_url ? (
          <Image
            source={{ uri: item.avatar_url }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarLetter}>
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <View style={styles.userInfo}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>

          <Text style={styles.username} numberOfLines={1}>
            @{item.username || 'user'}
          </Text>

          <Text style={styles.followers}>
            {item.followers} followers
          </Text>

          {!!item.bio && (
            <Text style={styles.bio} numberOfLines={1}>
              {item.bio}
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.followButton,
            item.isFollowing && styles.followingButton,
          ]}
          onPress={() => handleFollow(item.id)}
          disabled={busyUserId === item.id}
        >
          {busyUserId === item.id ? (
            <ActivityIndicator
              size="small"
              color="#FFFFFF"
            />
          ) : (
            <Text
              style={[
                styles.followButtonText,
                item.isFollowing && styles.followingText,
              ]}
            >
              {item.isFollowing ? 'Following' : 'Follow'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Explore</Text>

      <View style={styles.searchBox}>
        <Ionicons
          name="search"
          size={20}
          color="#A1A1AD"
        />

        <TextInput
          style={styles.searchInput}
          placeholder="Search people or username"
          placeholderTextColor="#777783"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons
              name="close-circle"
              size={20}
              color="#A1A1AD"
            />
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.sectionTitle}>
        Discover People
      </Text>

      {loading && users.length === 0 ? (
        <ActivityIndicator
          size="large"
          color="#9673FF"
          style={styles.loader}
        />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#9673FF"
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name="people-outline"
                size={45}
                color="#777783"
              />
              <Text style={styles.emptyTitle}>
                No users found
              </Text>
              <Text style={styles.emptyText}>
                Try searching another name or username.
              </Text>
            </View>
          }
          contentContainerStyle={
            users.length === 0
              ? styles.emptyList
              : styles.listContent
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101114',
    paddingTop: 55,
  },
  header: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: 'bold',
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  searchBox: {
    height: 48,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#1D1E25',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginHorizontal: 18,
    marginTop: 25,
    marginBottom: 12,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1D1E25',
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#33333D',
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#9673FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  username: {
    color: '#A1A1AD',
    fontSize: 13,
    marginTop: 2,
  },
  followers: {
    color: '#C4B5FD',
    fontSize: 12,
    marginTop: 4,
  },
  bio: {
    color: '#A1A1AD',
    fontSize: 12,
    marginTop: 3,
  },
  followButton: {
    backgroundColor: '#9673FF',
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 9,
    minWidth: 88,
    alignItems: 'center',
  },
  followingButton: {
    backgroundColor: '#30313A',
    borderWidth: 1,
    borderColor: '#555563',
  },
  followButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  followingText: {
    color: '#FFFFFF',
  },
  loader: {
    marginTop: 50,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 65,
    paddingHorizontal: 25,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 12,
  },
  emptyText: {
    color: '#A1A1AD',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  emptyList: {
    flexGrow: 1,
  },
});
