
import React, { useEffect, useState } from 'react';

import {
  View,
  Text,
  TextInput,
  Image,
  Animated,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  AppState,
  Linking,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import {
  NavigationContainer,
  useIsFocused,
  createNavigationContainerRef,
} from '@react-navigation/native';

import {
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';

import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { supabase } from './lib/supabase';
import { registerForPushNotifications } from './src/services/pushNotifications';
import * as Notifications from 'expo-notifications';
import { ThemeProvider, useAppTheme, useThemedStyles } from './src/theme/ThemeProvider';

import HomeScreen from './src/screens/HomeScreen';
import ExploreScreen from './src/screens/ExploreScreen';
import CreatePostScreen from './src/screens/CreatePostScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ReelsScreen from './src/screens/ReelsScreen';
import DirectMessagesModal from './src/components/DirectMessagesModal';
import UserProfileModal from './src/components/UserProfileModal';
import { fetchUserConversations } from './src/services/messages';

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

const PURPLE = '#9673FF';
const BG = '#101114';
const CARD = '#1D1E25';
const MUTED = '#A1A1AD';

function MessagesTabScreen({
  userId,
  navigation,
  targetConversationId,
  onNotificationConversationHandled,
  onChatStateChange,
}) {
  const isFocused = useIsFocused();
  const [profileUserId, setProfileUserId] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadUnreadCount = async () => {
      try {
        const conversations = await fetchUserConversations(userId);

        if (!mounted) return;

        const totalUnread = conversations.reduce(
          (total, conversation) =>
            total + Number(conversation.unread_count || 0),
          0
        );

        navigation.setOptions({
          tabBarBadge:
            totalUnread > 0
              ? (totalUnread > 99 ? '99+' : totalUnread)
              : undefined,
          tabBarBadgeStyle: {
            backgroundColor: PURPLE,
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: '700',
            minWidth: 19,
            height: 19,
          },
        });
      } catch (error) {
        console.warn('Unread badge refresh failed:', error);
      }
    };

    loadUnreadCount();

    const interval = setInterval(loadUnreadCount, 4000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [userId, navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <DirectMessagesModal
        visible={isFocused}
        currentUserId={userId}
        initialTargetUser={null}
        targetConversationId={targetConversationId}
        onNotificationConversationHandled={onNotificationConversationHandled}
        onChatStateChange={onChatStateChange}
        onBackToInbox={() => {}}
        onClose={() => navigation.navigate('Home')}
        onOpenProfile={(user) => {
          if (user?.id) setProfileUserId(user.id);
        }}
        inline
      />

      <UserProfileModal
        visible={Boolean(profileUserId)}
        targetUserId={profileUserId}
        currentUserId={userId}
        onClose={() => setProfileUserId(null)}
        onOpenProfile={setProfileUserId}
      />
    </View>
  );
}
// ======================================
// RESPONSIVE BOTTOM NAVIGATION
// ======================================

function MainTabs({
  userId,
  email,
  onLogout,
  notificationConversationId,
  notificationBanner,
  onNotificationConversationHandled,
  onNotificationBannerPress,
  onNotificationBannerDismiss,
}) {
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const [storyCreateRequest, setStoryCreateRequest] = useState(0);
  const [profileAvatar, setProfileAvatar] = useState(null);
  const [messageChatOpen, setMessageChatOpen] = useState(false);

  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);

  useEffect(() => {
    if (!notificationConversationId) return undefined;

    const openMessages = () => {
      if (navigationRef.isReady()) navigationRef.navigate('Messages');
    };

    openMessages();
    const readySubscription = navigationRef.addListener('ready', openMessages);
    return readySubscription;
  }, [notificationConversationId]);

  useEffect(() => {
    let pendingUrl = null;
    const openPostLink = (url) => {
      const match = url?.match(/(?:--\/)?(post|profile)\/([^/?#]+)/i);
      if (!match) return;
      const itemId = decodeURIComponent(match[2]);
      if (!navigationRef.isReady()) {
        pendingUrl = url;
        return;
      }

      navigationRef.navigate(
        'Home',
        match[1].toLowerCase() === 'post'
          ? { postId: itemId }
          : { profileId: itemId }
      );
    };

    Linking.getInitialURL().then(openPostLink).catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => openPostLink(url));
    const readySubscription = navigationRef.addListener('ready', () => {
      if (!pendingUrl) return;
      const url = pendingUrl;
      pendingUrl = null;
      openPostLink(url);
    });
    return () => {
      subscription.remove();
      readySubscription?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProfileAvatar(data?.avatar_url || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);

  const isTablet = width >= 600;

  const icons = {
    Home: {
      outline: 'home-outline',
      filled: 'home',
    },
    Explore: {
      outline: 'search-outline',
      filled: 'search',
    },
    Create: {
      outline: 'add-circle-outline',
      filled: 'add-circle',
    },
    Messages: {
      outline: 'chatbubble-ellipses-outline',
      filled: 'chatbubble-ellipses',
    },
    Reels: {
      outline: 'play-circle-outline',
      filled: 'play-circle',
    },
    Profile: {
      outline: 'person-circle-outline',
      filled: 'person-circle',
    },
  };

  const tabHeight = isTablet ? 64 : 56;

  const bottomPadding = Math.max(
    insets.bottom,
    Platform.OS === 'android' ? 6 : 0
  );

  return (
    <View style={{ flex: 1 }}>
    <NavigationContainer ref={navigationRef}>
      <Tab.Navigator
        initialRouteName="Home"
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarShowLabel: false,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.muted,
          tabBarHideOnKeyboard: true,

          tabBarStyle: route.name === 'Messages' && messageChatOpen
            ? { display: 'none' }
            : {
            height: tabHeight + bottomPadding,
            paddingTop: 7,
            paddingBottom: bottomPadding,
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            elevation: 10,
            shadowColor: '#000000',
            shadowOffset: {
              width: 0,
              height: -2,
            },
            shadowOpacity: 0.08,
            shadowRadius: 5,
            },

          tabBarItemStyle: {
            justifyContent: 'center',
            alignItems: 'center',
          },

          tabBarIconStyle: {
            marginTop: 0,
          },

          tabBarIcon: ({ color, focused }) => route.name === 'Profile' && profileAvatar ? (
            <Image
              source={{ uri: profileAvatar }}
              style={{
                width: focused ? 28 : 25,
                height: focused ? 28 : 25,
                borderRadius: 15,
                borderWidth: focused ? 2 : 0,
                borderColor: color,
              }}
            />
          ) : (
            <Ionicons
              name={focused ? icons[route.name].filled : icons[route.name].outline}
              size={focused ? 26 : 24}
              color={color}
            />
          ),
        })}
      >

        {/* HOME */}
        <Tab.Screen name="Home">
          {({ route }) => (
            <HomeScreen
              userId={userId}
              route={route}
              addStoryRequest={storyCreateRequest}
              refreshKey={feedRefreshKey}
              ownAvatarUrl={profileAvatar}
            />
          )}
        </Tab.Screen>

        {/* EXPLORE */}
        <Tab.Screen name="Explore">
          {() => (
            <ExploreScreen />
          )}
        </Tab.Screen>

        {/* CREATE POST - HIDDEN TAB, OPENED FROM HOME PLUS BUTTON */}
        <Tab.Screen
          name="Create"
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: {
              display: 'none',
              width: 0,
              flex: 0,
            },
          }}
        >
          {({ navigation, route }) => (
            <CreatePostScreen
              route={route}
              userId={userId}
              onPostCreated={() =>
                setFeedRefreshKey((value) => value + 1)
              }
              onClose={() => navigation.navigate('Home')}
            />
          )}
        </Tab.Screen>

        {/* MESSAGES */}
        <Tab.Screen name="Messages">
          {({ navigation }) => (
            <MessagesTabScreen
              userId={userId}
              navigation={navigation}
              targetConversationId={notificationConversationId}
              onNotificationConversationHandled={onNotificationConversationHandled}
              onChatStateChange={setMessageChatOpen}
            />
          )}
        </Tab.Screen>

        {/* REELS */}
        <Tab.Screen name="Reels">
          {() => (
            <ReelsScreen userId={userId} />
          )}
        </Tab.Screen>

        {/* PROFILE */}
        <Tab.Screen name="Profile">
          {({ navigation }) => (
            <ProfileScreen
              userId={userId}
              email={email}
              navigation={navigation}
              onCreateStory={() =>
                setStoryCreateRequest((request) => request + 1)
              }
              onLogout={onLogout}
              onProfileAvatarChange={setProfileAvatar}
            />
          )}
        </Tab.Screen>

      </Tab.Navigator>
    </NavigationContainer>

    {notificationBanner?.conversationId ? (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => onNotificationBannerPress?.(notificationBanner)}
        style={{
          position: 'absolute',
          top: Platform.OS === 'ios' ? 58 : 42,
          left: 14,
          right: 14,
          zIndex: 9999,
          elevation: 20,
          backgroundColor: '#292633',
          borderRadius: 16,
          padding: 14,
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: '#51466E',
        }}
      >
        <View style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: '#9673FF',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 11,
        }}>
          <Ionicons name="chatbubble-ellipses" size={21} color="#FFFFFF" />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
            {notificationBanner.title}
          </Text>
          <Text
            numberOfLines={2}
            style={{ color: '#D2CEDD', fontSize: 13, marginTop: 3 }}
          >
            {notificationBanner.body}
          </Text>
        </View>

        <TouchableOpacity
          onPress={onNotificationBannerDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ padding: 5 }}
        >
          <Ionicons name="close" size={19} color="#D2CEDD" />
        </TouchableOpacity>
      </TouchableOpacity>
    ) : null}
    </View>
  );
}

function LoginScene({ colors }) {
  const [motion] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(motion, { toValue: 1, duration: 2300, useNativeDriver: true }),
        Animated.timing(motion, { toValue: 0, duration: 2300, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [motion]);

  const floatY = motion.interpolate({ inputRange: [0, 1], outputRange: [3, -7] });
  const tilt = motion.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '7deg'] });

  return (
    <View style={sceneStyles.stage} accessibilityLabel="Social app welcome illustration">
      <View style={[sceneStyles.glow, { backgroundColor: colors.accentSoft }]} />
      <Animated.View
        style={[
          sceneStyles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            transform: [
              { perspective: 850 },
              { rotateX: '8deg' },
              { rotateY: tilt },
              { translateY: floatY },
            ],
          },
        ]}
      >
        <View style={[sceneStyles.cardOrb, { backgroundColor: colors.accent }]}>
          <Ionicons name="people" size={34} color="#FFFFFF" />
        </View>
        <View style={sceneStyles.cardCopy}>
          <View style={[sceneStyles.line, { backgroundColor: colors.text }]} />
          <View style={[sceneStyles.line, sceneStyles.shortLine, { backgroundColor: colors.muted }]} />
          <View style={sceneStyles.miniAvatars}>
            <View style={[sceneStyles.miniAvatar, { backgroundColor: '#FF9F88' }]} />
            <View style={[sceneStyles.miniAvatar, sceneStyles.avatarOverlap, { backgroundColor: '#7ED9C2' }]} />
            <View style={[sceneStyles.miniAvatar, sceneStyles.avatarOverlap, { backgroundColor: '#A792FF' }]} />
          </View>
        </View>
      </Animated.View>
      <Animated.View style={[sceneStyles.floatChip, sceneStyles.leftChip, { backgroundColor: colors.surface, transform: [{ translateY: floatY }] }]}>
        <Ionicons name="heart" size={19} color="#FF6480" />
      </Animated.View>
      <Animated.View style={[sceneStyles.floatChip, sceneStyles.rightChip, { backgroundColor: colors.surface, transform: [{ translateY: Animated.multiply(floatY, -1) }] }]}>
        <Ionicons name="chatbubble-ellipses" size={18} color={colors.accent} />
      </Animated.View>
    </View>
  );
}

// ======================================
// MAIN APP
// ======================================

function AppContent() {
  const { colors, mode: themeMode, ready: themeReady } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Password reset states
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const [session, setSession] = useState(null);
  const [notificationConversationId, setNotificationConversationId] = useState(null);
  const [notificationBanner, setNotificationBanner] = useState(null);

  // ======================================
  // PUSH NOTIFICATION REGISTRATION
  // ======================================

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    registerForPushNotifications(userId).then((token) => {
      if (token) {
        console.log('Push notifications registered for user.');
      }
    });
  }, [session?.user?.id]);

  // ======================================
  // DM FOREGROUND NOTIFICATIONS + TAP ROUTING
  // ======================================

  useEffect(() => {
    const handleNotificationResponse = (response) => {
      const data = response?.notification?.request?.content?.data;

      if (data?.type !== 'direct_message' || !data?.conversationId) {
        return;
      }

      setNotificationBanner(null);
      setNotificationConversationId(String(data.conversationId));
    };

    Notifications.getLastNotificationResponseAsync()
      .then(handleNotificationResponse)
      .catch((error) => {
        console.warn('Could not read last notification:', error);
      });

    const receivedSubscription =
      Notifications.addNotificationReceivedListener((notification) => {
        const content = notification.request.content;
        const data = content.data;

        if (data?.type !== 'direct_message' || !data?.conversationId) {
          return;
        }

        setNotificationBanner({
          title: content.title || 'New message',
          body: content.body || 'You received a message',
          conversationId: String(data.conversationId),
        });
      });

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(
        handleNotificationResponse
      );

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  // ======================================
  // ONLINE / OFFLINE PRESENCE TRACKING
  // ======================================

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    let mounted = true;

    const updatePresence = async (isOnline) => {
      try {
        const now = new Date().toISOString();

        const { error } = await supabase
          .from('user_presence')
          .upsert({
            user_id: userId,
            is_online: isOnline,
            last_seen_at: now,
            updated_at: now,
          }, {
            onConflict: 'user_id',
          });

        if (error) throw error;
      } catch (error) {
        if (mounted) {
          console.warn('Presence update failed:', error.message);
        }
      }
    };

    updatePresence(AppState.currentState === 'active');

    const handleAppStateChange = (nextState) => {
      updatePresence(nextState === 'active');
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange
    );

    const heartbeat = setInterval(() => {
      if (AppState.currentState === 'active') {
        updatePresence(true);
      }
    }, 30000);

    return () => {
      mounted = false;
      subscription.remove();
      clearInterval(heartbeat);

      supabase
        .from('user_presence')
        .upsert({
          user_id: userId,
          is_online: false,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        .then(({ error }) => {
          if (error) console.warn('Presence cleanup failed:', error.message);
        });
    };
  }, [session?.user?.id]);




  const [checkingSession, setCheckingSession] =
    useState(true);

  const [loading, setLoading] = useState(false);

  const { width, height } = useWindowDimensions();

  const isTablet = width >= 600;
  const isSmallScreen = height < 700;

  const horizontalPadding = isTablet
    ? 40
    : Math.max(18, Math.min(width * 0.06, 28));

  // ======================================
  // CHECK AUTH SESSION
  // ======================================

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      try {
        const { data, error } =
          await supabase.auth.getSession();

        if (!mounted) return;

        if (error) {
          console.warn(
            'Session error:',
            error.message
          );
        }

        setSession(data?.session ?? null);

      } catch (error) {
        console.warn(
          'Session check failed:',
          error.message
        );

      } finally {
        if (mounted) {
          setCheckingSession(false);
        }
      }
    }

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (mounted) {
          setSession(newSession);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ======================================
  // LOGIN AND SIGNUP
  // ======================================

  async function handleAuth() {
    const cleanEmail = email
      .trim()
      .toLowerCase();

    if (
      mode === 'signup' &&
      !fullName.trim()
    ) {
      Alert.alert(
        'Missing name',
        'Please enter your full name.'
      );
      return;
    }

    if (!cleanEmail || !password) {
      Alert.alert(
        'Missing details',
        'Enter your email and password.'
      );
      return;
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        cleanEmail
      )
    ) {
      Alert.alert(
        'Invalid email',
        'Enter a valid email address.'
      );
      return;
    }

    if (password.length < 6) {
      Alert.alert(
        'Weak password',
        'Password must be at least 6 characters.'
      );
      return;
    }

    setLoading(true);

    try {
      if (mode === 'signup') {
        const { data, error } =
          await supabase.auth.signUp({
            email: cleanEmail,
            password,

            options: {
              data: {
                full_name: fullName.trim(),
              },
            },
          });

        if (error) throw error;

        if (data.session) {
          Alert.alert(
            'Welcome!',
            'Your account has been created.'
          );

        } else {
          Alert.alert(
            'Verify your email',
            'Your account was created. Please check your inbox for the verification link.'
          );

          setMode('login');
          setPassword('');
        }

      } else {
        const { error } =
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

        if (error) throw error;
      }

    } catch (error) {
      Alert.alert(
        'Authentication failed',
        error.message
      );

    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // FORGOT / RESET PASSWORD
  // ======================================

  async function handleSendResetCode() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      Alert.alert('Email required', 'Enter your email address first.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
      if (error) throw error;

      setCodeSent(true);
      Alert.alert(
        'Code Sent',
        'Check your inbox for the password recovery link/token, then enter the code and your new password below.'
      );
    } catch (error) {
      Alert.alert('Reset request failed', error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmResetPassword() {
    const cleanEmail = email.trim().toLowerCase();

    if (!resetCode.trim()) {
      Alert.alert('Code required', 'Enter the verification code from your email.');
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      // Verify OTP
      const { data, error: otpError } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: resetCode.trim(),
        type: 'recovery',
      });

      if (otpError) throw otpError;

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword.trim(),
      });

      if (updateError) throw updateError;

      Alert.alert(
        'Password updated!',
        'Your password has been changed. You can now log in.'
      );
      setMode('login');
      setPassword('');
      setNewPassword('');
      setResetCode('');
      setCodeSent(false);
    } catch (error) {
      Alert.alert('Password reset failed', error.message);
    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // LOGOUT
  // ======================================

  async function handleLogout() {
    setLoading(true);

    try {
      const { error } =
        await supabase.auth.signOut();

      if (error) throw error;

      setPassword('');
      setMode('login');

    } catch (error) {
      Alert.alert(
        'Logout failed',
        error.message
      );

    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // SESSION LOADING
  // ======================================

  if (checkingSession || !themeReady) {
    return (
      <View style={[styles.centerScreen, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'} />

        <ActivityIndicator
          size="large"
          color={PURPLE}
        />

        <Text style={styles.muted}>
          Loading social...
        </Text>
      </View>
    );
  }

  // ======================================
  // AUTHENTICATED APP
  // ======================================

  if (session) {
    return (
      <MainTabs
        userId={session.user.id}
        email={session.user.email}
        onLogout={handleLogout}
        notificationConversationId={notificationConversationId}
        notificationBanner={notificationBanner}
        onNotificationConversationHandled={() => {
          setNotificationConversationId(null);
        }}
        onNotificationBannerPress={(banner) => {
          setNotificationBanner(null);
          setNotificationConversationId(banner.conversationId);
        }}
        onNotificationBannerDismiss={() => setNotificationBanner(null)}
      />
    );
  }

  // ======================================
  // LOGIN / SIGNUP / RESET SCREEN
  // ======================================

  const isSignup = mode === 'signup';
  const isReset = mode === 'reset';

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : 'height'
      }
      keyboardVerticalOffset={0}
    >
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingHorizontal: horizontalPadding,
            paddingTop: isSmallScreen ? 25 : 45,
            paddingBottom: isSmallScreen ? 25 : 40,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >

        <View
          style={[
            styles.contentWrapper,
            {
              maxWidth: isTablet ? 480 : 520,
            },
          ]}
        >

          {/* BRAND */}
          <View style={styles.header}>
            <Text style={styles.logo}>
              social.
            </Text>

            <Text style={styles.tagline}>
              CONNECT. SHARE. DISCOVER.
            </Text>
          </View>

          <LoginScene colors={colors} />

          {/* INTRO */}
          <View
            style={[
              styles.intro,
              {
                marginTop: isSmallScreen ? 18 : 22,
                marginBottom: isSmallScreen ? 25 : 35,
              },
            ]}
          >
            <View style={styles.iconCircle}>
              <Text style={styles.sparkle}>
                ✦
              </Text>
            </View>

            <Text style={[styles.heading, { color: colors.text }]}>
              {isReset
                ? 'Reset password.'
                : isSignup
                ? 'Find your people.'
                : 'Welcome back.'}
            </Text>

            <Text style={styles.description}>
              {isReset
                ? 'Enter your email to receive recovery instructions.'
                : isSignup
                ? 'Create your space. Share your world.'
                : 'Your world is waiting for you.'}
            </Text>
          </View>

          {/* FORM */}
          <View style={[styles.form, { backgroundColor: colors.surface, borderColor: colors.border }]}>

            {isReset ? (
              <>
                <Text style={styles.label}>
                  EMAIL ADDRESS
                </Text>

                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                  placeholder="you@example.com"
                  placeholderTextColor={MUTED}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!codeSent}
                />

                {!codeSent ? (
                  <TouchableOpacity
                    style={[styles.button, loading && styles.disabled]}
                    onPress={handleSendResetCode}
                    disabled={loading}
                    activeOpacity={0.8}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.buttonText}>
                        Send Recovery Code →
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <>
                    <Text style={styles.label}>
                      VERIFICATION CODE / OTP
                    </Text>

                    <TextInput
                      style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                      placeholder="Enter 6-digit code from email"
                      placeholderTextColor={MUTED}
                      value={resetCode}
                      onChangeText={setResetCode}
                      keyboardType="number-pad"
                      autoCapitalize="none"
                    />

                    <Text style={styles.label}>
                      NEW PASSWORD
                    </Text>

                    <TextInput
                      style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                      placeholder="Minimum 6 characters"
                      placeholderTextColor={MUTED}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry
                    />

                    <TouchableOpacity
                      style={[styles.button, loading && styles.disabled]}
                      onPress={handleConfirmResetPassword}
                      disabled={loading}
                      activeOpacity={0.8}
                    >
                      {loading ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.buttonText}>
                          Update Password →
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleSendResetCode}
                      disabled={loading}
                      style={{ marginTop: 12, alignItems: 'center' }}
                    >
                      <Text style={{ color: PURPLE, fontSize: 13, fontWeight: '600' }}>
                        Didn&apos;t receive code? Resend
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity
                  onPress={() => {
                    setMode('login');
                    setCodeSent(false);
                    setResetCode('');
                    setNewPassword('');
                  }}
                  disabled={loading}
                  style={styles.switchButton}
                >
                  <Text style={styles.switchText}>
                    ← Back to Login
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {isSignup && (
                  <>
                    <Text style={styles.label}>
                      FULL NAME
                    </Text>

                    <TextInput
                      style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                      placeholder="Enter your full name"
                      placeholderTextColor={MUTED}
                      value={fullName}
                      onChangeText={setFullName}
                      autoCapitalize="words"
                      returnKeyType="next"
                    />
                  </>
                )}

                <Text style={styles.label}>
                  EMAIL ADDRESS
                </Text>

                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                  placeholder="you@example.com"
                  placeholderTextColor={MUTED}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />

                <Text style={styles.label}>
                  PASSWORD
                </Text>

                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                  placeholder="Minimum 6 characters"
                  placeholderTextColor={MUTED}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleAuth}
                />

                <TouchableOpacity
                  onPress={() => setMode('reset')}
                  style={styles.forgotContainer}
                >
                  <Text style={styles.forgot}>
                    Forgot password?
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.button,
                    loading && styles.disabled,
                  ]}
                  onPress={handleAuth}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.buttonText}>
                      {isSignup
                        ? 'Create Account →'
                        : 'Login →'}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setMode(
                      isSignup ? 'login' : 'signup'
                    );

                    setPassword('');
                  }}
                  disabled={loading}
                  style={styles.switchButton}
                >
                  <Text style={styles.switchText}>
                    {isSignup
                      ? 'Already have an account? Login'
                      : "New here? Create an account"}
                  </Text>
                </TouchableOpacity>
              </>
            )}

          </View>

          {/* FOOTER */}
          <Text style={styles.footer}>
            YOUR SPACE. YOUR PEOPLE. YOUR WORLD.
          </Text>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ======================================
// ROOT APP WITH SAFE AREA PROVIDER
// ======================================

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const sceneStyles = StyleSheet.create({
  stage: { height: 168, width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  glow: { position: 'absolute', width: 190, height: 125, borderRadius: 90, opacity: 0.8, transform: [{ rotate: '-18deg' }] },
  card: { width: 196, height: 126, borderRadius: 23, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 13, shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.16, shadowRadius: 18, elevation: 8 },
  cardOrb: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  cardCopy: { flex: 1, gap: 8 },
  line: { width: 64, height: 7, borderRadius: 5, opacity: 0.9 },
  shortLine: { width: 43, height: 5 },
  miniAvatars: { flexDirection: 'row', marginTop: 3 },
  miniAvatar: { width: 17, height: 17, borderRadius: 9, borderWidth: 2, borderColor: '#FFFFFF' },
  avatarOverlap: { marginLeft: -6 },
  floatChip: { position: 'absolute', width: 42, height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center', elevation: 7, shadowColor: '#000', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.14, shadowRadius: 10 },
  leftChip: { left: '17%', top: 25, transform: [{ rotate: '-12deg' }] },
  rightChip: { right: '16%', bottom: 20, transform: [{ rotate: '10deg' }] },
});

// ======================================
// STYLES
// ======================================

const baseStyles = StyleSheet.create({

  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  contentWrapper: {
    width: '100%',
    alignSelf: 'center',
  },

  header: {
    alignItems: 'center',
  },

  logo: {
    color: PURPLE,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -2,
  },

  tagline: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 3,
    marginTop: 5,
    textAlign: 'center',
  },

  intro: {
    alignItems: 'center',
  },

  iconCircle: {
    width: 65,
    height: 65,
    borderRadius: 22,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 23,
  },

  sparkle: {
    color: '#FFFFFF',
    fontSize: 36,
  },

  heading: {
    color: '#FFFFFF',
    fontSize: 29,
    fontWeight: '800',
    textAlign: 'center',
  },

  description: {
    color: MUTED,
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },

  form: {
    width: '100%',
    backgroundColor: CARD,
    padding: 21,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#33343D',
  },

  label: {
    color: MUTED,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 9,
    marginTop: 15,
  },

  input: {
    width: '100%',
    height: 54,
    borderWidth: 1,
    borderColor: '#3A3B45',
    borderRadius: 12,
    paddingHorizontal: 15,
    color: '#FFFFFF',
    fontSize: 15,
  },

  forgotContainer: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
  },

  forgot: {
    color: PURPLE,
    fontWeight: '600',
  },

  button: {
    width: '100%',
    minHeight: 55,
    backgroundColor: PURPLE,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 25,
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },

  disabled: {
    opacity: 0.6,
  },

  switchButton: {
    paddingVertical: 15,
  },

  switchText: {
    color: PURPLE,
    textAlign: 'center',
    marginTop: 10,
    fontWeight: '700',
  },

  footer: {
    color: MUTED,
    fontSize: 10,
    textAlign: 'center',
    letterSpacing: 2,
    marginTop: 35,
  },

  centerScreen: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
  },

  muted: {
    color: MUTED,
    fontSize: 14,
    marginTop: 15,
  },

});
