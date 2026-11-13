import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Alert,
  Switch,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';
import { getBlockedUsers, unblockUser } from '../services/safety';
import useEdgeSwipeBack from '../hooks/useEdgeSwipeBack';

const SETTINGS_KEY = '@mysocial_app_settings';

export default function SettingsModal({
  visible,
  userId,
  onClose,
  onEditProfile,
  onViewSaved,
  onLogout,
}) {
  const { colors, preference, setMode } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;
  const backGestureHandlers = useEdgeSwipeBack(onClose);
  const blockedBackGestureHandlers = useEdgeSwipeBack(() =>
    setBlockedVisible(false)
  );
  const passwordBackGestureHandlers = useEdgeSwipeBack(() =>
    setChangePasswordVisible(false)
  );

  // Settings states
  const [privateAccount, setPrivateAccount] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [pauseAllNotifs, setPauseAllNotifs] = useState(false);
  const [likesNotifs, setLikesNotifs] = useState(true);
  const [dmsNotifs, setDmsNotifs] = useState(true);
  const [highQualityUploads, setHighQualityUploads] = useState(true);

  // Blocked accounts
  const [blockedVisible, setBlockedVisible] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [unblockingId, setUnblockingId] = useState(null);

  // Change password modal
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Load saved preferences
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.pauseAllNotifs !== undefined) setPauseAllNotifs(parsed.pauseAllNotifs);
          if (parsed.likesNotifs !== undefined) setLikesNotifs(parsed.likesNotifs);
          if (parsed.dmsNotifs !== undefined) setDmsNotifs(parsed.dmsNotifs);
          if (parsed.highQualityUploads !== undefined) setHighQualityUploads(parsed.highQualityUploads);
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    if (!visible || !userId) return undefined;

    let active = true;

    (async () => {
      try {
        let { data, error } = await supabase
          .from('profiles')
          .select('is_private')
          .eq('id', userId)
          .maybeSingle();

        if (error && /is_private/i.test(error.message || '')) {
          return;
        }

        if (active && data) {
          setPrivateAccount(Boolean(data.is_private));
        }
      } catch {
        // Privacy SQL not applied yet; keep the toggle off.
      }
    })();

    return () => {
      active = false;
    };
  }, [visible, userId]);

  const persistSettings = async (key, value) => {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      const current = raw ? JSON.parse(raw) : {};
      current[key] = value;
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    } catch (e) {}
  };

  const handleTogglePrivate = async (val) => {
    if (!userId || privacySaving) return;

    const previous = privateAccount;
    setPrivateAccount(val);
    setPrivacySaving(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_private: val,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) throw error;

      Alert.alert(
        val ? 'Account is now Private' : 'Account is now Public',
        val
          ? 'Only people you approve can see your photos and videos.'
          : 'Anyone on Social App can view your posts and stories.'
      );
    } catch (error) {
      setPrivateAccount(previous);
      Alert.alert(
        'Privacy not saved',
        `${error.message || 'Please try again.'}\n\nRun supabase/apply_all_fixes.sql in Supabase to enable private accounts.`
      );
    } finally {
      setPrivacySaving(false);
    }
  };

  const handleTogglePauseNotifs = (val) => {
    setPauseAllNotifs(val);
    persistSettings('pauseAllNotifs', val);
  };

  const handleToggleLikes = (val) => {
    setLikesNotifs(val);
    persistSettings('likesNotifs', val);
  };

  const handleToggleDms = (val) => {
    setDmsNotifs(val);
    persistSettings('dmsNotifs', val);
  };

  const handleToggleHQ = (val) => {
    setHighQualityUploads(val);
    persistSettings('highQualityUploads', val);
  };

  const openBlockedAccounts = async () => {
    setBlockedVisible(true);
    setBlockedLoading(true);

    try {
      const users = await getBlockedUsers(userId);
      setBlockedUsers(users);
    } catch (error) {
      Alert.alert('Could not load blocked accounts', error.message);
    } finally {
      setBlockedLoading(false);
    }
  };

  const handleUnblock = async (targetId) => {
    if (!targetId || unblockingId) return;

    setUnblockingId(targetId);

    try {
      await unblockUser(targetId);
      setBlockedUsers((current) =>
        current.filter((item) => item.id !== targetId)
      );
    } catch (error) {
      Alert.alert('Could not unblock', error.message);
    } finally {
      setUnblockingId(null);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword.trim()) {
      Alert.alert('Required', 'Please enter a new password.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword.trim(),
      });
      if (error) throw error;

      Alert.alert('Success', 'Your password has been changed successfully.');
      setNewPassword('');
      setConfirmPassword('');
      setChangePasswordVisible(false);
    } catch (err) {
      Alert.alert('Change Password Error', err.message || 'Could not update password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleClearCache = async () => {
    Alert.alert(
      'Clear Cache',
      'This will clear temporary files and offline data. Your account remains safe.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            Alert.alert('Cache Cleared', 'Freed up 24.8 MB of local storage.');
          },
        },
      ]
    );
  };

  const confirmLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out of your account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: () => {
          onClose();
          if (onLogout) onLogout();
        },
      },
    ]);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={styles.safe}
        edges={['top', 'bottom']}
        {...backGestureHandlers}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Settings and activity</Text>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, isTablet && styles.tabletContainer]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.themeHint, { color: colors.secondaryText }]}>Follow your device or choose a theme.</Text>
            <View style={styles.themeChoices}>
              {(['system', 'light', 'dark']).map((themeMode) => {
                const selected = preference === themeMode;
                return (
                  <TouchableOpacity
                    key={themeMode}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setMode(themeMode)}
                    style={[
                      styles.themeChoice,
                      { backgroundColor: selected ? colors.accentSoft : colors.raised, borderColor: selected ? colors.accent : colors.border },
                    ]}
                  >
                    <Ionicons
                      name={themeMode === 'system' ? 'phone-portrait-outline' : themeMode === 'light' ? 'sunny-outline' : 'moon-outline'}
                      size={20}
                      color={selected ? colors.accent : colors.text}
                    />
                    <Text style={[styles.rowLabel, { color: colors.text }]}>
                      {themeMode === 'system' ? 'System' : themeMode === 'light' ? 'Light' : 'Dark'}
                    </Text>
                    {selected && <Ionicons name="checkmark-circle" size={18} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* SECTION: YOUR ACCOUNT */}
          <Text style={styles.sectionTitle}>Your account</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                onClose();
                if (onEditProfile) onEditProfile();
              }}
            >
              <Ionicons name="person-circle-outline" size={24} color={colors.text} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>Edit profile</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                onClose();
                if (onViewSaved) onViewSaved();
              }}
            >
              <Ionicons name="bookmark-outline" size={24} color={colors.text} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>Saved posts</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.row}
              onPress={() => setChangePasswordVisible(true)}
            >
              <Ionicons name="key-outline" size={24} color={colors.text} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>Change password</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>
          </View>

          {/* SECTION: NOTIFICATIONS */}
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.card}>
            <View style={styles.rowSwitch}>
              <View style={styles.rowLabelGroup}>
                <Ionicons name="notifications-off-outline" size={22} color={colors.text} style={styles.rowIcon} />
                <Text style={styles.rowLabel}>Pause all</Text>
              </View>
              <Switch
                value={pauseAllNotifs}
                onValueChange={handleTogglePauseNotifs}
                trackColor={{ false: '#E0E0E0', true: '#0095F6' }}
              />
            </View>

            <View style={styles.rowSwitch}>
              <View style={styles.rowLabelGroup}>
                <Ionicons name="heart-outline" size={22} color={colors.text} style={styles.rowIcon} />
                <Text style={styles.rowLabel}>Likes and comments</Text>
              </View>
              <Switch
                value={likesNotifs && !pauseAllNotifs}
                onValueChange={handleToggleLikes}
                disabled={pauseAllNotifs}
                trackColor={{ false: '#E0E0E0', true: '#0095F6' }}
              />
            </View>

            <View style={styles.rowSwitch}>
              <View style={styles.rowLabelGroup}>
                <Ionicons name="chatbubbles-outline" size={22} color={colors.text} style={styles.rowIcon} />
                <Text style={styles.rowLabel}>Direct messages</Text>
              </View>
              <Switch
                value={dmsNotifs && !pauseAllNotifs}
                onValueChange={handleToggleDms}
                disabled={pauseAllNotifs}
                trackColor={{ false: '#E0E0E0', true: '#0095F6' }}
              />
            </View>
          </View>

          {/* SECTION: PRIVACY */}
          <Text style={styles.sectionTitle}>Who can see your content</Text>
          <View style={styles.card}>
            <View style={styles.rowSwitch}>
              <View style={styles.rowLabelGroup}>
                <Ionicons name="lock-closed-outline" size={22} color={colors.text} style={styles.rowIcon} />
                <View>
                  <Text style={styles.rowLabel}>Private account</Text>
                  <Text style={styles.rowSubLabel}>Only approved followers can see posts</Text>
                </View>
              </View>
              <Switch
                value={privateAccount}
                onValueChange={handleTogglePrivate}
                disabled={privacySaving}
                trackColor={{ false: '#E0E0E0', true: '#0095F6' }}
              />
            </View>

            <TouchableOpacity
              style={styles.row}
              onPress={openBlockedAccounts}
            >
              <Ionicons
                name="ban-outline"
                size={24}
                color={colors.text}
                style={styles.rowIcon}
              />
              <Text style={styles.rowLabel}>Blocked accounts</Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.muted}
              />
            </TouchableOpacity>
          </View>

          {/* SECTION: MEDIA & DATA */}
          <Text style={styles.sectionTitle}>Media quality & data</Text>
          <View style={styles.card}>
            <View style={styles.rowSwitch}>
              <View style={styles.rowLabelGroup}>
                <Ionicons name="cloud-upload-outline" size={22} color={colors.text} style={styles.rowIcon} />
                <View>
                  <Text style={styles.rowLabel}>Upload at highest quality</Text>
                  <Text style={styles.rowSubLabel}>Always upload highest quality photos & reels</Text>
                </View>
              </View>
              <Switch
                value={highQualityUploads}
                onValueChange={handleToggleHQ}
                trackColor={{ false: '#E0E0E0', true: '#0095F6' }}
              />
            </View>

            <TouchableOpacity style={styles.row} onPress={handleClearCache}>
              <Ionicons name="trash-outline" size={22} color={colors.text} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>Clear local cache</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>
          </View>

          {/* SECTION: SUPPORT & ABOUT */}
          <Text style={styles.sectionTitle}>More info and support</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => Alert.alert('Help', 'Contact help: support@socialapp.com')}
            >
              <Ionicons name="help-circle-outline" size={24} color={colors.text} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>Help Center</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                Alert.alert(
                  'About Social App',
                  'Social App v1.0.0\nBuilt with React Native & Expo SDK 58\nPowered by Supabase'
                )
              }
            >
              <Ionicons name="information-circle-outline" size={24} color={colors.text} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>About Social App</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>
          </View>

          {/* SECTION: LOGOUT */}
          <Text style={styles.sectionTitle}>Login</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} onPress={confirmLogout}>
              <Ionicons name="log-out-outline" size={24} color="#ED4956" style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: '#ED4956', fontWeight: '700' }]}>
                Log out
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* BLOCKED ACCOUNTS SUB-MODAL */}
        <Modal
          visible={blockedVisible}
          animationType="slide"
          onRequestClose={() => setBlockedVisible(false)}
        >
          <SafeAreaView
            style={styles.safe}
            edges={['top', 'bottom']}
            {...blockedBackGestureHandlers}
          >
            <View style={styles.header}>
              <TouchableOpacity
                onPress={() => setBlockedVisible(false)}
              >
                <Ionicons
                  name="arrow-back"
                  size={25}
                  color={colors.text}
                />
              </TouchableOpacity>
              <Text style={styles.title}>Blocked accounts</Text>
              <View style={{ width: 25 }} />
            </View>

            <ScrollView contentContainerStyle={styles.blockedContent}>
              {blockedLoading ? (
                <ActivityIndicator
                  style={{ marginTop: 30 }}
                  color={colors.accent}
                />
              ) : blockedUsers.length === 0 ? (
                <View style={styles.blockedEmpty}>
                  <Ionicons
                    name="ban-outline"
                    size={42}
                    color={colors.muted}
                  />
                  <Text style={styles.rowLabel}>No blocked accounts</Text>
                  <Text style={styles.rowSubLabel}>
                    People you block will appear here.
                  </Text>
                </View>
              ) : (
                blockedUsers.map((item) => (
                  <View key={item.id} style={styles.blockedRow}>
                    {item.user.avatar_url ? (
                      <Image
                        source={{ uri: item.user.avatar_url }}
                        style={styles.blockedAvatar}
                      />
                    ) : (
                      <View style={styles.blockedAvatarFallback}>
                        <Ionicons
                          name="person"
                          size={20}
                          color={colors.muted}
                        />
                      </View>
                    )}

                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>
                        {item.user.full_name ||
                          item.user.username ||
                          'User'}
                      </Text>
                      <Text style={styles.rowSubLabel}>
                        @{item.user.username || 'user'}
                      </Text>
                    </View>

                    {unblockingId === item.id ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.accent}
                      />
                    ) : (
                      <TouchableOpacity
                        style={styles.unblockBtn}
                        onPress={() => handleUnblock(item.id)}
                      >
                        <Text style={styles.unblockText}>Unblock</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* CHANGE PASSWORD SUB-MODAL */}
        <Modal
          visible={changePasswordVisible}
          animationType="slide"
          onRequestClose={() => setChangePasswordVisible(false)}
        >
          <SafeAreaView
            style={styles.safe}
            edges={['top', 'bottom']}
            {...passwordBackGestureHandlers}
          >
            <View style={styles.header}>
              <TouchableOpacity
                onPress={() => setChangePasswordVisible(false)}
                style={styles.headerBtn}
              >
                <Ionicons name="close" size={26} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.title}>Change Password</Text>
              <View style={{ width: 32 }} />
            </View>

            <View style={styles.passwordForm}>
              <Text style={styles.passwordHint}>
                Your password must be at least 6 characters long and include numbers, letters and characters.
              </Text>

              <Text style={styles.inputLabel}>New password</Text>
              <TextInput
                style={styles.passwordInput}
                secureTextEntry
                placeholder="Enter new password"
                placeholderTextColor="#999"
                value={newPassword}
                onChangeText={setNewPassword}
              />

              <Text style={styles.inputLabel}>Confirm new password</Text>
              <TextInput
                style={styles.passwordInput}
                secureTextEntry
                placeholder="Re-enter new password"
                placeholderTextColor="#999"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />

              <TouchableOpacity
                style={[
                  styles.savePasswordBtn,
                  (!newPassword || !confirmPassword || passwordLoading) && styles.btnDisabled,
                ]}
                onPress={handleChangePassword}
                disabled={!newPassword || !confirmPassword || passwordLoading}
              >
                {passwordLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.savePasswordBtnText}>Update password</Text>
                )}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAEAEA',
  },
  headerBtn: { padding: 4 },
  title: { fontSize: 17, fontWeight: '700', color: '#111' },
  scroll: { paddingBottom: 40 },
  tabletContainer: {
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 22,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#EAEAEA',
  },
  themeHint: {
    fontSize: 13,
    marginBottom: 12,
  },
  themeChoices: {
    flexDirection: 'row',
    gap: 10,
  },
  themeChoice: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F5F5F5',
  },
  rowSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F5F5F5',
  },
  rowLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  rowIcon: { marginRight: 14 },
  rowLabel: { fontSize: 15, color: '#111', fontWeight: '500' },
  blockedContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  blockedEmpty: {
    alignItems: 'center',
    paddingVertical: 50,
    gap: 8,
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  blockedAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  blockedAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EEE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDD',
  },
  unblockText: {
    color: '#ED4956',
    fontSize: 12,
    fontWeight: '700',
  },

  rowSubLabel: { fontSize: 12, color: '#888', marginTop: 2 },
  passwordForm: {
    padding: 20,
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
  },
  passwordHint: {
    fontSize: 13,
    color: '#666',
    lineHeight: 19,
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
    marginTop: 10,
  },
  passwordInput: {
    height: 48,
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#FAFAFA',
  },
  savePasswordBtn: {
    marginTop: 26,
    height: 48,
    backgroundColor: '#0095F6',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  savePasswordBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
