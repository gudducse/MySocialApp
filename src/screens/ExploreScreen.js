
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Contacts from 'expo-contacts/legacy';
import { supabase } from '../../lib/supabase';
import UserProfileModal from '../components/UserProfileModal';
import DirectMessagesModal from '../components/DirectMessagesModal';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';
import { toggleFollow } from '../services/follows';

const HISTORY_KEY = '@explore_search_history';
const MAX_HISTORY = 10;
const ACCENT = '#E1306C'; // Instagram-like pink/red accent

// ─── helpers ────────────────────────────────────────────────────────────────

function formatFollowers(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function loadHistory() {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveHistory(history) {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const { colors, mode } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();

  // ── auth ──────────────────────────────────────────────────────────────────
  const [userId, setUserId] = useState(null);

  // ── search ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  // ── search history ────────────────────────────────────────────────────────
  const [history, setHistory] = useState([]);

  // ── users ─────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState([]);
  const [contactSearchComplete, setContactSearchComplete] = useState(false);
  const [contactSearchLoading, setContactSearchLoading] = useState(false);
  const contactsMode = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);

  // ── modals ────────────────────────────────────────────────────────────────
  const [targetUserId, setTargetUserId] = useState(null);
  const [profileVisible, setProfileVisible] = useState(false);
  const [dmsVisible, setDmsVisible] = useState(false);
  const [initialTargetUser, setInitialTargetUser] = useState(null);

  // ── init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        Alert.alert('Error', error.message);
        setLoading(false);
        return;
      }
      setUserId(data.user?.id || null);
    })();
  }, []);

  useEffect(() => {
    loadHistory().then(setHistory);
  }, []);

  // ── data loading ──────────────────────────────────────────────────────────
  const fetchUsers = useCallback(
    async (term = '') => {
      if (!userId) return;
      const cleanTerm = term.trim();
      // Explore is a search surface. Never expose or fetch a people directory
      // until the user has entered a search term.
      if (contactsMode.current) return;
      if (!cleanTerm) {
        setUsers([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      try {
        setLoading(true);

        const safeTerm = cleanTerm.replace(/[,()]/g, '');
        const searchFilter = `username.ilike.%${safeTerm}%,full_name.ilike.%${safeTerm}%`;

        const runProfileQuery = (fields) =>
          supabase
            .from('profiles')
            .select(fields)
            .neq('id', userId)
            .or(searchFilter)
            .limit(30);

        let { data: profiles, error: profileError } = await runProfileQuery(
          'id, full_name, username, bio, avatar_url, is_private'
        );

        if (
          profileError &&
          /is_private.*(does not exist|schema cache)|column .*is_private/i.test(
            profileError.message || ''
          )
        ) {
          const fallback = await runProfileQuery(
            'id, full_name, username, bio, avatar_url'
          );
          profiles = fallback.data;
          profileError = fallback.error;
        }

        if (profileError) throw profileError;

        if (contactsMode.current) return;

        const profileList = profiles || [];

        if (profileList.length === 0) {
          setUsers([]);
          return;
        }

        const profileIds = profileList.map((p) => p.id);

        let followResult = await supabase
          .from('user_follows')
          .select('follower_id, following_id, status')
          .in('following_id', profileIds);

        if (
          followResult.error &&
          /status.*(does not exist|schema cache)|column .*status/i.test(
            followResult.error.message || ''
          )
        ) {
          followResult = await supabase
            .from('user_follows')
            .select('follower_id, following_id')
            .in('following_id', profileIds);
        }

        if (followResult.error) throw followResult.error;

        const followMap = {};
        (followResult.data || []).forEach((row) => {
          if (!followMap[row.following_id]) {
            followMap[row.following_id] = {
              followers: 0,
              isFollowing: false,
              isRequested: false,
            };
          }

          const status = row.status || 'accepted';

          if (status === 'pending') {
            if (row.follower_id === userId) {
              followMap[row.following_id].isRequested = true;
            }
            return;
          }

          followMap[row.following_id].followers += 1;
          if (row.follower_id === userId) {
            followMap[row.following_id].isFollowing = true;
          }
        });

        const formatted = profileList.map((p) => ({
          ...p,
          followers: followMap[p.id]?.followers || 0,
          isFollowing: followMap[p.id]?.isFollowing || false,
          isRequested: followMap[p.id]?.isRequested || false,
        }));

        setUsers(formatted);
      } catch (err) {
        console.log('Explore error:', err.message);
        Alert.alert('Explore Error', err.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId]
  );

  // debounce search
  useEffect(() => {
    if (!userId || contactSearchComplete) return;
    const timer = setTimeout(() => fetchUsers(search), 400);
    return () => clearTimeout(timer);
  }, [userId, search, fetchUsers, contactSearchComplete]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchUsers(search);
  };

  // ── history helpers ───────────────────────────────────────────────────────
  const pushHistory = async (term) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const next = [
      trimmed,
      ...history.filter((h) => h !== trimmed),
    ].slice(0, MAX_HISTORY);
    setHistory(next);
    await saveHistory(next);
  };

  const removeHistoryItem = async (term) => {
    const next = history.filter((h) => h !== term);
    setHistory(next);
    await saveHistory(next);
  };

  const clearHistory = async () => {
    setHistory([]);
    await saveHistory([]);
  };

  const selectHistoryItem = (term) => {
    setSearch(term);
    inputRef.current?.blur();
  };

  const handleSubmitSearch = () => {
    pushHistory(search);
    inputRef.current?.blur();
  };

  const syncContacts = async () => {
    if (!userId || contactSearchLoading) return;
    contactsMode.current = true;
    setContactSearchLoading(true);
    setContactSearchComplete(true);
    setSearch('');
    setFocused(false);
    inputRef.current?.blur();
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Contacts access is off', 'Allow contacts access in Settings to find people you know.');
        setUsers([]);
        return;
      }

      const { data: deviceContacts, error: contactsError } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      });
      if (contactsError) throw contactsError;

      const phones = [...new Set((deviceContacts || []).flatMap((contact) =>
        (contact.phoneNumbers || [])
          .map((entry) => (entry.number || '').replace(/\D/g, ''))
          .filter((value) => value.length >= 10)
          .map((value) => value.slice(-10))
      ))];
      const emails = [...new Set((deviceContacts || []).flatMap((contact) =>
        (contact.emails || []).map((entry) => (entry.email || '').trim().toLowerCase()).filter(Boolean)
      ))];
      if (!phones.length && !emails.length) {
        setUsers([]);
        Alert.alert(
          'No contact details found',
          'The selected contacts do not contain phone numbers or email addresses.'
        );
        return;
      }

      const { data: matches, error: matchError } = await supabase.rpc('discover_contacts', {
        contact_phones: phones,
        contact_emails: emails,
      });

      if (matchError) {
        if (
          /function .*discover_contacts.* does not exist|schema cache/i.test(
            matchError.message || ''
          )
        ) {
          throw new Error(
            'Contact sync is not enabled in the database yet. Run supabase/contact_discovery_fix.sql in Supabase.'
          );
        }
        throw matchError;
      }

      const profileList = matches || [];
      const profileIds = profileList.map((profile) => profile.id);
      if (!profileIds.length) {
        setUsers([]);
        return;
      }
      let followResult = await supabase
        .from('user_follows')
        .select('follower_id, following_id, status')
        .in('following_id', profileIds);

      if (
        followResult.error &&
        /status.*(does not exist|schema cache)|column .*status/i.test(
          followResult.error.message || ''
        )
      ) {
        followResult = await supabase
          .from('user_follows')
          .select('follower_id, following_id')
          .in('following_id', profileIds);
      }

      if (followResult.error) throw followResult.error;

      const followMap = {};
      (followResult.data || []).forEach((row) => {
        followMap[row.following_id] ||= {
          followers: 0,
          isFollowing: false,
          isRequested: false,
        };

        if ((row.status || 'accepted') === 'pending') {
          if (row.follower_id === userId) {
            followMap[row.following_id].isRequested = true;
          }
          return;
        }

        followMap[row.following_id].followers += 1;
        if (row.follower_id === userId) {
          followMap[row.following_id].isFollowing = true;
        }
      });
      setUsers(profileList.map((profile) => ({
        ...profile,
        followers: followMap[profile.id]?.followers || 0,
        isFollowing: followMap[profile.id]?.isFollowing || false,
        isRequested: followMap[profile.id]?.isRequested || false,
      })));
    } catch (err) {
      console.warn('Contact discovery failed:', err);
      Alert.alert('Could not find contacts', err.message || 'Please try again.');
      setUsers([]);
    } finally {
      setContactSearchLoading(false);
    }
  };

  const handleFindContacts = () => {
    if (!userId || contactSearchLoading) return;
    Alert.alert(
      'Find people you know',
      'Phone numbers and email addresses from your contacts will be checked against app accounts. They are used for this match and are not stored.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: syncContacts },
      ]
    );
  };

  // ── follow / unfollow ─────────────────────────────────────────────────────
  const handleFollow = async (tId) => {
    if (!userId || busyUserId) return;
    const target = users.find((u) => u.id === tId);
    if (!target) return;

    setBusyUserId(tId);

    try {
      const nextState = await toggleFollow(userId, tId);
      const nextAccepted = nextState === 'accepted';
      const wasAccepted = Boolean(target.isFollowing);

      setUsers((list) =>
        list.map((item) =>
          item.id !== tId
            ? item
            : {
                ...item,
                isFollowing: nextAccepted,
                isRequested: nextState === 'pending',
                followers: Math.max(
                  0,
                  item.followers +
                    (nextAccepted ? 1 : 0) -
                    (wasAccepted ? 1 : 0)
                ),
              }
        )
      );
    } catch (err) {
      Alert.alert('Follow Error', err.message);
    } finally {
      setBusyUserId(null);
    }
  };

  // ── open profile ──────────────────────────────────────────────────────────
  const openProfile = (id) => {
    setTargetUserId(id);
    setProfileVisible(true);
  };

  // ── derived state ─────────────────────────────────────────────────────────
  const isSearchActive = search.trim().length > 0;
  const showHistory = focused && !isSearchActive && history.length > 0;

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  // Vertical search result row
  const renderResultRow = ({ item }) => {
    const displayName = item.full_name || item.username || 'User';
    return (
      <View style={styles.resultRow}>
        <TouchableOpacity
          style={styles.resultLeft}
          activeOpacity={0.7}
          onPress={() => openProfile(item.id)}
        >
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.resultAvatar} />
          ) : (
            <View style={[styles.resultAvatar, styles.avatarFallback]}>
              <Text style={styles.avatarLetter}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.resultInfo}>
            <Text style={styles.resultName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.resultUsername} numberOfLines={1}>
              @{item.username || 'user'}
            </Text>
            <Text style={styles.resultFollowers}>
              {item.is_private
                ? 'Private account'
                : `${formatFollowers(item.followers)} followers`}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.followBtn,
            (item.isFollowing || item.isRequested) && styles.followingBtn,
          ]}
          onPress={() => handleFollow(item.id)}
          disabled={busyUserId === item.id}
        >
          {busyUserId === item.id ? (
            <ActivityIndicator
              size="small"
              color={
                item.isFollowing || item.isRequested ? '#262626' : '#fff'
              }
            />
          ) : (
            <Text
              style={[
                styles.followBtnText,
                (item.isFollowing || item.isRequested) &&
                  styles.followingBtnText,
              ]}
            >
              {item.isFollowing
                ? 'Following'
                : item.isRequested
                ? 'Requested'
                : 'Follow'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // List header — recent searches or the empty search prompt
  // ─────────────────────────────────────────────────────────────────────────
  const listHeader = (
    <View>
      {/* ── Recent Searches ── */}
      {showHistory && (
        <View style={styles.historySection}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Searches</Text>
            <TouchableOpacity onPress={clearHistory}>
              <Text style={styles.clearAll}>Clear all</Text>
            </TouchableOpacity>
          </View>

          {history.map((term) => (
            <TouchableOpacity
              key={term}
              style={styles.historyItem}
              onPress={() => selectHistoryItem(term)}
              activeOpacity={0.7}
            >
              <Ionicons name="time-outline" size={18} color="#8e8e8e" style={{ marginRight: 10 }} />
              <Text style={styles.historyText} numberOfLines={1}>
                {term}
              </Text>
              <TouchableOpacity
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => removeHistoryItem(term)}
              >
                <Ionicons name="close" size={16} color="#8e8e8e" />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Empty search state ── */}
      {!isSearchActive && !showHistory && !contactSearchComplete && (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={38} color="#c7c7c7" />
          <Text style={styles.emptyTitle}>Search people</Text>
          <Text style={styles.emptyText}>
            Search by name or username to find an account.
          </Text>
        </View>
      )}

      {/* ── Search results header ── */}
      {isSearchActive && (
        <Text style={[styles.sectionTitle, { marginHorizontal: 16, marginTop: 16, marginBottom: 4 }]}>
          Results
        </Text>
      )}
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      {/* ── Sticky header ── */}
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>Explore</Text>
        <TouchableOpacity
          style={[styles.contactButton, { borderColor: colors.border }]}
          onPress={handleFindContacts}
          disabled={contactSearchLoading}
          accessibilityRole="button"
          accessibilityLabel="Find people from contacts"
        >
          {contactSearchLoading ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="people-outline" size={18} color={colors.accent} />}
          <Text style={[styles.contactButtonText, { color: colors.accent }]}>Contacts</Text>
        </TouchableOpacity>
      </View>

      {/* ── Search bar ── */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="#8e8e8e" />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Search"
            placeholderTextColor="#8e8e8e"
            value={search}
            onChangeText={(value) => { contactsMode.current = false; setContactSearchComplete(false); setSearch(value); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={handleSubmitSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                contactsMode.current = false;
                setContactSearchComplete(false);
                setSearch('');
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color="#8e8e8e" />
            </TouchableOpacity>
          )}
        </View>

        {(focused || search.length > 0) && (
          <TouchableOpacity
            onPress={() => {
              contactsMode.current = false;
              setContactSearchComplete(false);
              setSearch('');
              setFocused(false);
              inputRef.current?.blur();
            }}
            style={styles.cancelBtn}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Main list ── */}
      {isSearchActive || contactSearchComplete ? (
        (contactSearchLoading || (loading && users.length === 0)) ? (
          <ActivityIndicator
            size="large"
            color={ACCENT}
            style={{ marginTop: 48 }}
          />
        ) : (
          <FlatList
            data={users}
            keyExtractor={(item) => item.id}
            renderItem={renderResultRow}
            ListHeaderComponent={
              contactSearchComplete ? (
                users.length > 0 ? (
                  <Text
                    style={[
                      styles.sectionTitle,
                      {
                        marginHorizontal: 16,
                        marginTop: 16,
                        marginBottom: 4,
                      },
                    ]}
                  >
                    Contacts found
                  </Text>
                ) : null
              ) : (
                listHeader
              )
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={ACCENT}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons
                  name={
                    contactSearchComplete
                      ? 'people-outline'
                      : 'search-outline'
                  }
                  size={44}
                  color={contactSearchComplete ? colors.muted : '#c7c7c7'}
                />
                <Text style={styles.emptyTitle}>
                  {contactSearchComplete
                    ? 'No contacts found'
                    : `No results for “${search}”`}
                </Text>
                {!contactSearchComplete && (
                  <Text style={styles.emptyText}>
                    Try a different name or username.
                  </Text>
                )}
              </View>
            }
            contentContainerStyle={
              users.length === 0 ? styles.growList : styles.listContent
            }
            keyboardShouldPersistTaps="handled"
          />
        )
      ) : (
        // Keep Explore quiet until the user starts a search.
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={ACCENT}
            />
          }
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          {listHeader}
        </ScrollView>
      )}

      {/* ── Modals ── */}
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
            setDmsVisible(true);
          }}
        />
      )}

      <DirectMessagesModal
        visible={dmsVisible}
        currentUserId={userId}
        initialTargetUser={initialTargetUser}
        onBackToInbox={() => setInitialTargetUser(null)}
        onClose={() => {
          setDmsVisible(false);
          setInitialTargetUser(null);
        }}
        onOpenProfile={(user) => {
          if (!user?.id) return;
          setDmsVisible(false);
          setInitialTargetUser(null);
          setTargetUserId(user.id);
          setProfileVisible(true);
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  // ── top bar ──────────────────────────────────────────────────────────────
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  contactButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderRadius: 18 },
  contactButtonText: { fontSize: 13, fontWeight: '700' },
  screenTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#262626',
    letterSpacing: -0.5,
  },

  // ── search row ────────────────────────────────────────────────────────────
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFEFEF',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#262626',
    paddingVertical: 0,
  },
  cancelBtn: {
    marginLeft: 10,
    paddingVertical: 4,
  },
  cancelText: {
    fontSize: 15,
    color: '#262626',
    fontWeight: '500',
  },

  // ── sections ──────────────────────────────────────────────────────────────
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#262626',
  },
  clearAll: {
    fontSize: 14,
    color: ACCENT,
    fontWeight: '500',
  },

  // ── history ───────────────────────────────────────────────────────────────
  historySection: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  historyText: {
    flex: 1,
    fontSize: 14,
    color: '#262626',
  },

  // ── result rows ───────────────────────────────────────────────────────────
  listContent: {
    paddingBottom: 30,
  },
  growList: {
    flexGrow: 1,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  resultLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  resultInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#262626',
  },
  resultUsername: {
    fontSize: 13,
    color: '#8e8e8e',
    marginTop: 1,
  },
  resultFollowers: {
    fontSize: 12,
    color: '#8e8e8e',
    marginTop: 2,
  },

  // ── follow buttons (result rows) ──────────────────────────────────────────
  followBtn: {
    backgroundColor: '#3797EF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 86,
    alignItems: 'center',
  },
  followingBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DBDBDB',
  },
  followBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  followingBtnText: {
    color: '#262626',
  },

  // ── avatar fallback ───────────────────────────────────────────────────────
  avatarFallback: {
    backgroundColor: '#DBDBDB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },

  // ── empty states ──────────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#262626',
    marginTop: 14,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#8e8e8e',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
});
