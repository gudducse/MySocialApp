
import React, { useEffect, useState } from 'react';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import {
  NavigationContainer,
} from '@react-navigation/native';

import {
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';

import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { supabase } from './lib/supabase';

import HomeScreen from './src/screens/HomeScreen';
import ExploreScreen from './src/screens/ExploreScreen';
import CreatePostScreen from './src/screens/CreatePostScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import PlaceholderScreen from './src/screens/PlaceholderScreen';

const Tab = createBottomTabNavigator();

const PURPLE = '#9673FF';
const BG = '#101114';
const CARD = '#1D1E25';
const MUTED = '#A1A1AD';

// ======================================
// RESPONSIVE BOTTOM NAVIGATION
// ======================================

function MainTabs({ userId, email, onLogout }) {
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);

  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

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
    Reels: {
      outline: 'play-circle-outline',
      filled: 'play-circle',
    },
    Profile: {
      outline: 'person-circle-outline',
      filled: 'person-circle',
    },
  };

  // Base height + device-specific bottom safe area
  const tabHeight = isTablet ? 64 : 56;

  const bottomPadding = Math.max(
    insets.bottom,
    Platform.OS === 'android' ? 6 : 0
  );

  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName="Home"
        screenOptions={({ route }) => ({
          headerShown: false,

          tabBarShowLabel: false,

          tabBarActiveTintColor: '#111111',
          tabBarInactiveTintColor: '#888888',

          tabBarHideOnKeyboard: true,

          tabBarStyle: {
            height: tabHeight + bottomPadding,

            paddingTop: 7,
            paddingBottom: bottomPadding,

            backgroundColor: '#FFFFFF',

            borderTopColor: '#EAEAEA',
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

          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={
                focused
                  ? icons[route.name].filled
                  : icons[route.name].outline
              }
              size={focused ? 26 : 24}
              color={color}
            />
          ),
        })}
      >

        {/* HOME */}
        <Tab.Screen name="Home">
          {() => (
            <HomeScreen
              userId={userId}
              refreshKey={feedRefreshKey}
            />
          )}
        </Tab.Screen>

        {/* EXPLORE */}
        <Tab.Screen name="Explore">
          {() => (
            <ExploreScreen />
          )}
        </Tab.Screen>

        {/* CREATE POST */}
        <Tab.Screen name="Create">
          {({ navigation }) => (
            <CreatePostScreen
              userId={userId}
              onPostCreated={() =>
                setFeedRefreshKey(
                  (value) => value + 1
                )
              }
              onClose={() =>
                navigation.navigate('Home')
              }
            />
          )}
        </Tab.Screen>

        {/* REELS */}
        <Tab.Screen
          name="Reels"
          component={PlaceholderScreen}
        />

        {/* PROFILE */}
        <Tab.Screen name="Profile">
          {() => (
            <ProfileScreen
              userId={userId}
              email={email}
              onLogout={onLogout}
            />
          )}
        </Tab.Screen>

      </Tab.Navigator>
    </NavigationContainer>
  );
}

// ======================================
// MAIN APP
// ======================================

function AppContent() {
  const [mode, setMode] = useState('login');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [session, setSession] = useState(null);

  const [checkingSession, setCheckingSession] =
    useState(true);

  const [loading, setLoading] = useState(false);

  const { width, height } = useWindowDimensions();

  const isTablet = width >= 600;
  const isSmallScreen = height < 700;

  // Responsive horizontal spacing
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
  // FORGOT PASSWORD
  // ======================================

  async function handleForgotPassword() {
    const cleanEmail = email
      .trim()
      .toLowerCase();

    if (!cleanEmail) {
      Alert.alert(
        'Email required',
        'Enter your email address first.'
      );
      return;
    }

    try {
      const { error } =
        await supabase.auth.resetPasswordForEmail(
          cleanEmail
        );

      if (error) throw error;

      Alert.alert(
        'Check your email',
        'A password reset link has been requested.'
      );

    } catch (error) {
      Alert.alert(
        'Reset failed',
        error.message
      );
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

  if (checkingSession) {
    return (
      <View style={styles.centerScreen}>
        <StatusBar barStyle="light-content" />

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
      />
    );
  }

  // ======================================
  // LOGIN / SIGNUP SCREEN
  // ======================================

  const isSignup = mode === 'signup';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : 'height'
      }
      keyboardVerticalOffset={0}
    >
      <StatusBar
        barStyle="light-content"
        backgroundColor={BG}
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

          {/* INTRO */}
          <View
            style={[
              styles.intro,
              {
                marginTop: isSmallScreen ? 30 : 45,
                marginBottom: isSmallScreen ? 25 : 35,
              },
            ]}
          >
            <View style={styles.iconCircle}>
              <Text style={styles.sparkle}>
                ✦
              </Text>
            </View>

            <Text style={styles.heading}>
              {isSignup
                ? 'Find your people.'
                : 'Welcome back.'}
            </Text>

            <Text style={styles.description}>
              {isSignup
                ? 'Create your space. Share your world.'
                : 'Your world is waiting for you.'}
            </Text>
          </View>

          {/* FORM */}
          <View style={styles.form}>

            {isSignup && (
              <>
                <Text style={styles.label}>
                  FULL NAME
                </Text>

                <TextInput
                  style={styles.input}
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
              style={styles.input}
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
              style={styles.input}
              placeholder="Minimum 6 characters"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleAuth}
            />

            {!isSignup && (
              <TouchableOpacity
                onPress={handleForgotPassword}
                style={styles.forgotContainer}
              >
                <Text style={styles.forgot}>
                  Forgot password?
                </Text>
              </TouchableOpacity>
            )}

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
      <AppContent />
    </SafeAreaProvider>
  );
}

// ======================================
// STYLES
// ======================================

const styles = StyleSheet.create({

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
