/**
 * DirectMessagesModal.js
 * Fully-featured direct messaging UI with:
 *  - Safe-area awareness (iPhone 14 Dynamic Island)
 *  - Gradient-style chat bubbles (inline, no LinearGradient required)
 *  - Chat wallpaper + nickname per conversation (AsyncStorage)
 *  - Animated send button
 *  - Typing indicator dots
 *  - Emoji quick-reactions per message
 *  - Bottom-sheet chat settings (wallpaper picker + nickname input)
 */

import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Pressable,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import useDirectCall from '../hooks/useDirectCall';
import DirectCallModal from './DirectCallModal';
import { supabase } from '../../lib/supabase';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';
import useEdgeSwipeBack from '../hooks/useEdgeSwipeBack';
import {
  fetchUserConversations,
  fetchMessages,
  markConversationMessagesRead,
  sendDirectMessage,
  getOrCreateConversation,
  deleteDirectMessage,
  fetchMessageReactions,
  setMessageReaction,
  updateDirectMessage,
  sendDirectMediaMessage,
  parseDirectMessageMedia,
  encodeDirectStoryMessage,
  acceptMessageRequest,
  deleteConversation,
} from '../services/messages';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WALLPAPER_PRESETS = [
  { key: 'w1', color: '#FFDEE9', label: 'Pink Bliss' },
  { key: 'w2', color: '#B5FFFC', label: 'Aqua Fresh' },
  { key: 'w3', color: '#FFF6E9', label: 'Warm Sand' },
  { key: 'w4', color: '#E9F5FF', label: 'Sky Blue' },
  { key: 'w5', color: '#F3E9FF', label: 'Soft Lavender' },
  { key: 'w6', color: '#E9FFE9', label: 'Mint Leaf' },
  { key: 'clear', color: '#FFFFFF', label: 'Default' },
];

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];
const EMOJI_OPTIONS = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '💕', '💖', '💗', '💘', '💝',
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '🥹', '😊', '😍', '🥰', '😘', '😗',
  '😋', '😜', '🤪', '🤔', '🫡', '🤗', '🤭', '🫢', '😶', '🙄', '😏', '😴', '😢', '😭', '😤',
  '😱', '😳', '🥺', '😎', '🤓', '🫠', '🤯', '😇', '🥳', '😈', '👋', '🤚', '🖐️', '✋', '👌',
  '🤌', '🤏', '✌️', '🤞', '🫶', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎',
  '✊', '👊', '👏', '🙌', '👐', '🤲', '🙏', '💪', '🔥', '✨', '⭐', '🎉', '💯', '✅', '❣️',
];

const CHAT_PREFS_KEY = (convId) => `@chat_prefs_${convId}`;
const MAX_CHAT_MEDIA_SIZE = 15 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateString) {
  if (!dateString) return '';
  const sec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function formatMsgTime(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function DirectMessageMedia({ media, onOpenImage }) {
  const styles = useThemedStyles(baseStyles);
  const isVideo =
    media.type === 'video' ||
    (media.type === 'story' && media.mediaType === 'video');
  const player = useVideoPlayer(isVideo ? media.url : null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = false;
  });

  if (media.type === 'story') {
    return (
      <View
        style={{
          width: 250,
          maxWidth: '100%',
          padding: 10,
          borderRadius: 12,
          backgroundColor: '#FFFFFF',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
          <Ionicons name="book-outline" size={14} color="#7C3AED" />
          <Text style={{ color: '#7C3AED', fontSize: 12, fontWeight: '700', marginLeft: 5 }}>
            Story
          </Text>
        </View>
        {isVideo ? (
          <VideoView
            player={player}
            style={[styles.mediaVideo, { width: '100%', height: 190, borderRadius: 12 }]}
            contentFit="contain"
            nativeControls
            allowsFullscreen
          />
        ) : (
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={() => onOpenImage?.(media.url)}
            accessibilityRole="button"
            accessibilityLabel="Open shared story"
          >
            <Image
              source={{ uri: media.url }}
              style={[styles.mediaMessage, { width: '100%', height: 190, borderRadius: 12 }]}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}
        {media.comment ? (
          <Text style={{ color: '#222', fontSize: 14, marginTop: 8 }}>
            {media.comment}
          </Text>
        ) : null}
      </View>
    );
  }

  if (isVideo) {
    return (
      <VideoView
        player={player}
        style={styles.mediaVideo}
        contentFit="contain"
        nativeControls
        allowsFullscreen
      />
    );
  }

  return (
    <TouchableOpacity
      style={styles.mediaImageFrame}
      activeOpacity={0.92}
      onPress={() => onOpenImage?.(media.url)}
      accessibilityRole="button"
      accessibilityLabel="Open photo"
    >
      <Image source={{ uri: media.url }} style={styles.mediaMessage} resizeMode="cover" />
      <View style={styles.mediaOpenHint} pointerEvents="none">
        <Ionicons name="expand-outline" size={14} color="#FFFFFF" />
        <Text style={styles.mediaOpenText}>Tap to view</Text>
      </View>
    </TouchableOpacity>
  );
}

async function loadChatPrefs(convId) {
  try {
    const raw = await AsyncStorage.getItem(CHAT_PREFS_KEY(convId));
    return raw ? JSON.parse(raw) : { wallpaper: null, nickname: '' };
  } catch {
    return { wallpaper: null, nickname: '' };
  }
}

async function saveChatPrefs(convId, prefs) {
  try {
    await AsyncStorage.setItem(CHAT_PREFS_KEY(convId), JSON.stringify(prefs));
  } catch {}
}

// ---------------------------------------------------------------------------
// Typing Indicator
// ---------------------------------------------------------------------------

function TypingIndicator() {
  const styles = useThemedStyles(baseStyles);
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bounce = (dot, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: -6,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.delay(600),
        ])
      ).start();

    bounce(dot1, 0);
    bounce(dot2, 150);
    bounce(dot3, 300);
  }, [dot1, dot2, dot3]);

  const dotStyle = (anim) => ({
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#888',
    marginHorizontal: 2,
    transform: [{ translateY: anim }],
  });

  return (
    <View style={typingStyles.wrapper}>
      <Animated.View style={dotStyle(dot1)} />
      <Animated.View style={dotStyle(dot2)} />
      <Animated.View style={dotStyle(dot3)} />
    </View>
  );
}

const typingStyles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFEFEF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    alignSelf: 'flex-start',
    marginVertical: 4,
    marginHorizontal: 14,
  },
});

// ---------------------------------------------------------------------------
// Animated Send Button
// ---------------------------------------------------------------------------

function AnimatedSendButton({ onPress, active, icon = 'send' }) {
  const styles = useThemedStyles(baseStyles);
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.8,
      useNativeDriver: true,
      speed: 50,
      bounciness: 12,
    }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();
  };

  return (
    <Pressable
      onPress={active ? onPress : undefined}
      onPressIn={active ? handlePressIn : undefined}
      onPressOut={active ? handlePressOut : undefined}
    >
      <Animated.View
        style={[
          sendBtnStyles.btn,
          active ? sendBtnStyles.active : sendBtnStyles.inactive,
          { transform: [{ scale }] },
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={active ? '#FFFFFF' : '#AAAAAA'}
        />
      </Animated.View>
    </Pressable>
  );
}

const sendBtnStyles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  active: { backgroundColor: '#4F46E5' },
  inactive: { backgroundColor: '#EFEFEF' },
});

// ---------------------------------------------------------------------------
// Emoji Reaction Row
// ---------------------------------------------------------------------------

function ReactionSummary({ reactions = [] }) {
  const counts = {};

  reactions.forEach((reaction) => {
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
  });

  const summaries = Object.entries(counts);
  if (!summaries.length) return null;

  return (
    <View style={reactionStyles.row}>
      {summaries.map(([emoji, count]) => (
        <View key={emoji} style={reactionStyles.pill}>
          <Text style={reactionStyles.emoji}>
            {emoji}{count > 1 ? ` ${count}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const reactionStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9D9E0',
    backgroundColor: '#FFFFFF',
  },
  emoji: { fontSize: 12, color: '#444' },
});

// ---------------------------------------------------------------------------
// Gradient Bubble (simulated via two-tone shadow + color stops using layers)
// ---------------------------------------------------------------------------

function GradientBubble({ isMine, children }) {
  const { colors } = useAppTheme();

  if (!isMine) {
    return (
      <View
        style={[
          bubbleStyles.base,
          bubbleStyles.theirs,
          {
            backgroundColor: colors.raised,
            borderColor: colors.border,
          },
        ]}
      >
        {children}
      </View>
    );
  }
  // Simulate a blue-to-purple gradient with two overlapping Views + opacity mask
  return (
    <View style={[bubbleStyles.base, bubbleStyles.mineOuter]}>
      <View style={bubbleStyles.mineGradientTop} />
      <View style={bubbleStyles.mineGradientBottom} />
      <View style={bubbleStyles.mineContent}>{children}</View>
    </View>
  );
}

const bubbleStyles = StyleSheet.create({
  base: {
    maxWidth: '100%',
    minWidth: 44,
    borderRadius: 20,
    overflow: 'hidden',
  },
  mineOuter: {
    borderBottomRightRadius: 4,
    // Deep purple-blue base
    backgroundColor: '#4338CA',
  },
  mineGradientTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#4F46E5',
    opacity: 0.9,
    borderRadius: 20,
  },
  mineGradientBottom: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#7C3AED',
    opacity: 0.4,
    top: '50%',
    borderRadius: 20,
  },
  mineContent: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  theirs: {
    backgroundColor: '#EFEFEF',
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});

// ---------------------------------------------------------------------------
// Chat Settings Bottom Sheet
// ---------------------------------------------------------------------------

function ChatSettingsSheet({ visible, convId, currentNickname, onSave, onClose }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const [selectedWallpaper, setSelectedWallpaper] = useState(null);
  const [nickname, setNickname] = useState(currentNickname || '');
  const slideAnim = useRef(new Animated.Value(400)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      loadChatPrefs(convId).then((prefs) => {
        setSelectedWallpaper(prefs.wallpaper || null);
        setNickname(prefs.nickname || '');
      });
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 6,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 400,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, convId, slideAnim]);

  const handleSave = async () => {
    const prefs = { wallpaper: selectedWallpaper, nickname };
    await saveChatPrefs(convId, prefs);
    onSave(prefs);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      {/* Backdrop */}
      <Pressable style={sheetStyles.backdrop} onPress={onClose} />

      <Animated.View
        style={[
          sheetStyles.sheet,
          { paddingBottom: insets.bottom + 16, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Handle */}
        <View style={sheetStyles.handle} />

        <Text style={sheetStyles.sheetTitle}>Chat Settings</Text>

        {/* Wallpaper picker */}
        <Text style={sheetStyles.sectionLabel}>Wallpaper</Text>
        <View style={sheetStyles.wallpaperGrid}>
          {WALLPAPER_PRESETS.map((w) => (
            <TouchableOpacity
              key={w.key}
              onPress={() => setSelectedWallpaper(w.key === 'clear' ? null : w.color)}
              activeOpacity={0.8}
            >
              <View
                style={[
                  sheetStyles.wallpaperSwatch,
                  { backgroundColor: w.color },
                  (selectedWallpaper === w.color ||
                    (w.key === 'clear' && selectedWallpaper === null)) &&
                    sheetStyles.wallpaperSelected,
                ]}
              >
                {w.key === 'clear' && (
                  <Ionicons name="close" size={16} color={colors.muted} />
                )}
              </View>
              <Text style={sheetStyles.swatchLabel}>{w.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Nickname input */}
        <Text style={sheetStyles.sectionLabel}>Nickname</Text>
        <TextInput
          style={sheetStyles.nicknameInput}
          value={nickname}
          onChangeText={setNickname}
          placeholder="Set a nickname…"
          placeholderTextColor="#AAA"
          maxLength={30}
        />

        {/* Save button */}
        <TouchableOpacity style={sheetStyles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
          <Text style={sheetStyles.saveBtnText}>Save</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  wallpaperGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  wallpaperSwatch: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wallpaperSelected: {
    borderColor: '#4F46E5',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  swatchLabel: {
    fontSize: 9,
    color: '#888',
    textAlign: 'center',
    marginTop: 3,
    width: 44,
  },
  nicknameInput: {
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#111',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  saveBtn: {
    backgroundColor: '#4F46E5',
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DirectMessagesModal({
  visible,
  currentUserId,
  initialTargetUser = null,
  initialStoryShare = null,
  targetConversationId = null,
  onNotificationConversationHandled,
  onBackToInbox,
  onClose,
  onOpenProfile,
  onChatStateChange,
  inline = false,
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();

  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshingInbox, setRefreshingInbox] = useState(false);
  const [inboxTab, setInboxTab] = useState('primary');
  const [requestBusyId, setRequestBusyId] = useState(null);
  const [presenceByUser, setPresenceByUser] = useState({});
  const [reactionsByMessage, setReactionsByMessage] = useState({});

  // Active chat state
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [storyShareDraft, setStoryShareDraft] = useState(null);
  const [sending, setSending] = useState(false);
  const [messageActionTarget, setMessageActionTarget] = useState(null);
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [customEmoji, setCustomEmoji] = useState('');
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [showTyping, setShowTyping] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const directCall = useDirectCall({
    conversationId: activeConv?.id,
    currentUserId,
    peerUserId: activeConv?.otherUser?.id,
    enabled: Boolean(
      visible &&
      activeConv?.id &&
      activeConv?.request_status !== 'pending'
    ),
  });

  useEffect(() => {
    if (directCall.callError) {
      Alert.alert('Call connection failed', directCall.callError);
    }
  }, [directCall.callError]);

  // Chat preferences
  const [chatPrefs, setChatPrefs] = useState({ wallpaper: null, nickname: '' });
  const [settingsVisible, setSettingsVisible] = useState(false);

  // New message search modal
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const flatListRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const initialScrollPendingRef = useRef(false);
  const typingStopTimerRef = useRef(null);
  const typingIndicatorTimerRef = useRef(null);
  const lastTypingUpdateRef = useRef(0);
  const handledTargetConversationRef = useRef(null);

  useEffect(() => {
    onChatStateChange?.(Boolean(visible && activeConv));
  }, [visible, activeConv, onChatStateChange]);

  useEffect(() => {
    if (activeConv?.id) {
      shouldAutoScrollRef.current = true;
      initialScrollPendingRef.current = true;
    } else {
      initialScrollPendingRef.current = false;
    }
  }, [activeConv?.id]);

  const scrollMessagesToEnd = useCallback(() => {
    if (!shouldAutoScrollRef.current && !initialScrollPendingRef.current) return;
    flatListRef.current?.scrollToEnd({
      animated: !initialScrollPendingRef.current,
    });
  }, []);

  const updateMyChatPresence = useCallback(async (activeConversationId, isTyping) => {
    if (!currentUserId) return;

    const { error } = await supabase
      .from('user_presence')
      .update({
        active_conversation_id: activeConversationId || null,
        is_typing: Boolean(isTyping),
        typing_conversation_id: isTyping ? activeConversationId : null,
        typing_updated_at: new Date().toISOString(),
      })
      .eq('user_id', currentUserId);

    if (error) {
      console.warn('Could not update chat presence:', error.message);
    }
  }, [currentUserId]);

  const handleInputChange = (value) => {
    setInputText(value);

    const convId = activeConv?.id;
    if (!convId) return;

    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
    }

    if (!value.trim()) {
      updateMyChatPresence(convId, false);
      return;
    }

    // Send the typing event immediately, then at most once every 1.2 seconds.
    if (Date.now() - lastTypingUpdateRef.current > 1200) {
      lastTypingUpdateRef.current = Date.now();
      updateMyChatPresence(convId, true);
    }

    // Automatically stop typing after 2 seconds without input.
    typingStopTimerRef.current = setTimeout(() => {
      updateMyChatPresence(convId, false);
    }, 2000);
  };

  const presenceUserIds = Array.from(new Set([
    ...conversations.map((conv) => conv.otherUser?.id).filter(Boolean),
    activeConv?.otherUser?.id,
  ].filter(Boolean))).sort().join(',');

  const getPresenceLabel = (userId) => {
    const presence = presenceByUser[userId];
    if (!presence?.last_seen_at) return 'Offline';

    const lastSeen = new Date(presence.last_seen_at).getTime();
    const ageMs = Date.now() - lastSeen;

    if (presence.is_online && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 60000) {
      return 'Active now';
    }

    if (!Number.isFinite(lastSeen)) return 'Offline';

    const minutes = Math.max(1, Math.floor(Math.max(0, ageMs) / 60000));
    if (minutes < 60) return `Last active ${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Last active ${hours}h ago`;

    return `Last active ${Math.floor(hours / 24)}d ago`;
  };

  // Tell the other user which conversation is currently open.
  useEffect(() => {
    if (!currentUserId) return undefined;

    const activeId = visible && activeConv?.id ? activeConv.id : null;
    updateMyChatPresence(activeId, false);

    return () => {
      if (activeId) {
        // Clear only this conversation, so an older cleanup cannot clear a newer chat.
        supabase
          .from('user_presence')
          .update({
            active_conversation_id: null,
            is_typing: false,
            typing_conversation_id: null,
            typing_updated_at: new Date().toISOString(),
          })
          .eq('user_id', currentUserId)
          .eq('active_conversation_id', activeId)
          .then(({ error }) => {
            if (error) console.warn('Could not clear active chat:', error.message);
          });
      }
    };
  }, [visible, currentUserId, activeConv?.id, updateMyChatPresence]);

  // Listen for the other user's real-time typing status in this conversation.
  useEffect(() => {
    const otherUserId = activeConv?.otherUser?.id;
    const convId = activeConv?.id;

    if (!visible || !convId || !otherUserId) {
      setShowTyping(false);
      return undefined;
    }

    const channel = supabase
      .channel(`dm-typing-${convId}-${otherUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_presence',
          filter: `user_id=eq.${otherUserId}`,
        },
        (payload) => {
          const row = payload.new;
          const updatedAt = new Date(row?.typing_updated_at).getTime();
          const fresh = Number.isFinite(updatedAt) && Date.now() - updatedAt < 5000;
          const typing = Boolean(
            row?.is_typing &&
            row?.typing_conversation_id === convId &&
            fresh
          );

          setShowTyping(typing);

          if (typingIndicatorTimerRef.current) {
            clearTimeout(typingIndicatorTimerRef.current);
          }

          if (typing) {
            typingIndicatorTimerRef.current = setTimeout(() => {
              setShowTyping(false);
            }, 4500);
          }
        }
      )
      .subscribe();

    return () => {
      if (typingIndicatorTimerRef.current) {
        clearTimeout(typingIndicatorTimerRef.current);
      }
      setShowTyping(false);
      supabase.removeChannel(channel);
    };
  }, [visible, activeConv?.id, activeConv?.otherUser?.id]);

  useEffect(() => {
    if (!visible || !presenceUserIds) return undefined;

    let mounted = true;
    const ids = presenceUserIds.split(',');

    const loadPresence = async () => {
      try {
        const { data, error } = await supabase
          .from('user_presence')
          .select('user_id, is_online, last_seen_at')
          .in('user_id', ids);

        if (error) throw error;
        if (!mounted) return;

        const next = {};
        (data || []).forEach((item) => {
          next[item.user_id] = item;
        });

        setPresenceByUser((previous) => ({ ...previous, ...next }));
      } catch (error) {
        console.warn('Could not load user presence:', error.message);
      }
    };

    loadPresence();
    const interval = setInterval(loadPresence, 15000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [visible, presenceUserIds]);

  const handleClose = () => {
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    if (activeConv?.id) updateMyChatPresence(activeConv.id, false);
    setActiveConv(null);
    setMessages([]);
    setInputText('');
    setStoryShareDraft(null);
    setSearchModalVisible(false);
    onClose?.();
  };

  const backGestureHandlers = useEdgeSwipeBack(() => {
    if (activeConv) {
      setActiveConv(null);
      onBackToInbox?.();
    } else {
      handleClose();
    }
  });
  const searchBackGestureHandlers = useEdgeSwipeBack(() =>
    setSearchModalVisible(false)
  );

  // Derived display name (nickname override)
  const displayName = useMemo(() => {
    if (!activeConv) return '';
    return (
      chatPrefs.nickname ||
      activeConv.otherUser?.full_name ||
      activeConv.otherUser?.username ||
      'User'
    );
  }, [activeConv, chatPrefs.nickname]);

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  const loadConversations = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const data = await fetchUserConversations(currentUserId);
      setConversations(data);
    } catch (err) {
      console.warn('Error loading conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (visible && currentUserId) {
      loadConversations();
    }
  }, [visible, currentUserId, loadConversations]);

  useEffect(() => {
    if (!visible || activeConv) return undefined;
    const interval = setInterval(() => loadConversations(), 4000);
    return () => clearInterval(interval);
  }, [visible, activeConv, loadConversations]);

  // Open the exact conversation received from a push notification.
  useEffect(() => {
    if (!targetConversationId) {
      handledTargetConversationRef.current = null;
      return;
    }

    if (!visible || handledTargetConversationRef.current === targetConversationId) {
      return;
    }

    const target = conversations.find(
      (conversation) => String(conversation.id) === String(targetConversationId)
    );

    if (!target) return;

    handledTargetConversationRef.current = targetConversationId;
    setActiveConv(target);

    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === target.id
          ? { ...conversation, unread_count: 0 }
          : conversation
      )
    );

    markConversationMessagesRead(target.id, currentUserId)
      .catch((error) => {
        console.warn('Could not mark notification chat as read:', error);
      });

    onNotificationConversationHandled?.();
  }, [
    targetConversationId,
    visible,
    conversations,
    activeConv,
    currentUserId,
    onNotificationConversationHandled,
  ]);

  // Open direct chat with initialTargetUser if provided
  useEffect(() => {
    const targetUser = initialStoryShare?.user || initialTargetUser;
    if (visible && targetUser && currentUserId) {
      (async () => {
        try {
          const conv = await getOrCreateConversation(currentUserId, targetUser.id);
          setActiveConv({ ...conv, otherUser: targetUser });
          setStoryShareDraft(initialStoryShare?.story || null);
        } catch (err) {
          console.warn('Failed to start chat with user:', err);
          Alert.alert('Could not open chat', err.message || 'Please try again.');
        }
      })();
    }
  }, [visible, initialTargetUser, initialStoryShare, currentUserId]);

  // ---------------------------------------------------------------------------
  // Chat prefs when active conv changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (activeConv?.id) {
      loadChatPrefs(activeConv.id).then(setChatPrefs);
    } else {
      setChatPrefs({ wallpaper: null, nickname: '' });
    }
  }, [activeConv?.id]);

  // ---------------------------------------------------------------------------
  // Messages polling
  // ---------------------------------------------------------------------------

  const loadReactionsForMessages = useCallback(async (msgs) => {
    const ids = (msgs || [])
      .filter((msg) => msg.id && !String(msg.id).startsWith('temp_'))
      .map((msg) => msg.id);

    if (!ids.length) {
      setReactionsByMessage({});
      return;
    }

    try {
      const rows = await fetchMessageReactions(ids);
      const map = {};

      (rows || []).forEach((row) => {
        if (!map[row.message_id]) map[row.message_id] = [];
        map[row.message_id].push(row);
      });

      setReactionsByMessage(map);
    } catch (err) {
      console.warn('Could not load message reactions:', err.message);
    }
  }, []);

  const loadMessages = useCallback(async (convId) => {
    if (!convId) return;
    try {
      const msgs = await fetchMessages(convId);

      const hasUnreadIncoming = msgs.some(
        (msg) => msg.receiver_id === currentUserId && !msg.read_at
      );

      if (hasUnreadIncoming) {
        try {
          await markConversationMessagesRead(convId, currentUserId);
          const readAt = new Date().toISOString();
          msgs.forEach((msg) => {
            if (msg.receiver_id === currentUserId && !msg.read_at) {
              msg.read_at = readAt;
            }
          });
        } catch (readError) {
          console.warn('Could not mark messages as read:', readError);
        }
      }

      setMessages(msgs);
      void loadReactionsForMessages(msgs);
    } catch (err) {
      console.warn('Failed to load messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  }, [loadReactionsForMessages]);

  useEffect(() => {
    if (!activeConv) return;
    setMessagesLoading(true);
    setReactionsByMessage({});
    loadMessages(activeConv.id);

    const interval = setInterval(() => {
      loadMessages(activeConv.id);
    }, 1500);

    return () => clearInterval(interval);
  }, [activeConv, loadMessages]);

  useEffect(() => {
    if (!messagesLoading && activeConv?.id) {
      scrollMessagesToEnd();
    }
  }, [activeConv?.id, messages.length, messagesLoading, scrollMessagesToEnd]);

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if ((!text && !storyShareDraft) || !activeConv || sending) return;
    shouldAutoScrollRef.current = true;

    if (editingMessageId) {
      setSending(true);
      try {
        const updatedMessage = await updateDirectMessage({
          messageId: editingMessageId,
          senderId: currentUserId,
          text,
        });
        setMessages((current) => current.map((message) =>
          message.id === editingMessageId ? updatedMessage : message
        ));
        setEditingMessageId(null);
        setInputText('');
      } catch (error) {
        Alert.alert('Could not edit message', error.message || 'Please try again.');
      } finally {
        setSending(false);
      }
      return;
    }

    const messageText = storyShareDraft
      ? encodeDirectStoryMessage(storyShareDraft, text)
      : text;
    if (messageText.length > 2000) {
      Alert.alert('Story message is too long', 'Shorten your comment and try again.');
      return;
    }

    setInputText('');
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
    }
    updateMyChatPresence(activeConv.id, false);
    setSending(true);

    const tempMsg = {
      id: `temp_${Date.now()}`,
      conversation_id: activeConv.id,
      sender_id: currentUserId,
      receiver_id: activeConv.otherUser.id,
      text: messageText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const newMsg = await sendDirectMessage({
        conversationId: activeConv.id,
        senderId: currentUserId,
        receiverId: activeConv.otherUser.id,
        text: messageText,
      });

      setMessages((prev) => prev.map((m) => (m.id === tempMsg.id ? newMsg : m)));
      setStoryShareDraft(null);
      loadConversations();
    } catch (err) {
      console.warn('Failed to send message:', err);
      setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
      setInputText(text);
      Alert.alert('Message not delivered', err.message || 'Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  const handlePickAndSendMedia = async () => {
    if (!activeConv || sending || editingMessageId) return;

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Allow photo library access to send a photo or video.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.85,
        videoMaxDuration: 60,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      const mediaType = asset.type === 'video' ? 'video' : 'image';
      if (asset.fileSize && asset.fileSize > MAX_CHAT_MEDIA_SIZE) {
        Alert.alert('File too large', 'Choose a photo or video under 15 MB.');
        return;
      }
      if (mediaType === 'video' && asset.duration > 60000) {
        Alert.alert('Video too long', 'Choose a video that is 60 seconds or shorter.');
        return;
      }

      setSending(true);
      shouldAutoScrollRef.current = true;
      updateMyChatPresence(activeConv.id, false);
      const sentMessage = await sendDirectMediaMessage({
        conversationId: activeConv.id,
        senderId: currentUserId,
        receiverId: activeConv.otherUser.id,
        asset,
        mediaType,
      });
      setMessages((current) => [...current, sentMessage]);
      loadConversations();
    } catch (error) {
      Alert.alert('Media not sent', error.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleToggleReaction = async (messageId, emoji) => {
    if (!currentUserId || String(messageId).startsWith('temp_')) return;

    const previousReactions = reactionsByMessage[messageId] || [];
    const existingReaction = previousReactions.find(
      (reaction) => reaction.user_id === currentUserId
    );
    const nextReactions = existingReaction?.emoji === emoji
      ? previousReactions.filter((reaction) => reaction.user_id !== currentUserId)
      : [
          ...previousReactions.filter((reaction) => reaction.user_id !== currentUserId),
          {
            message_id: messageId,
            user_id: currentUserId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];

    setReactionsByMessage((current) => ({
      ...current,
      [messageId]: nextReactions,
    }));

    try {
      await setMessageReaction({
        messageId,
        userId: currentUserId,
        emoji,
      });

      await loadReactionsForMessages(messages);
    } catch (err) {
      setReactionsByMessage((current) => ({
        ...current,
        [messageId]: previousReactions,
      }));
      Alert.alert(
        'Reaction failed',
        err.message || 'Please try again.'
      );
    }
  };

  const handleUnsendMessage = (message) => {
    if (!message?.id || String(message.id).startsWith('temp_')) return;
    setMessageActionTarget(null);

    Alert.alert(
      'Unsend message?',
      'This will remove the message for both of you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsend',
          style: 'destructive',
          onPress: async () => {
            try {
              const media = parseDirectMessageMedia(message.text);
              await deleteDirectMessage(message.id, currentUserId, media?.path);
              setMessages((current) =>
                current.filter((item) => item.id !== message.id)
              );
              loadConversations();
            } catch (err) {
              Alert.alert(
                'Could not unsend',
                err.message || 'Please try again.'
              );
            }
          },
        },
      ]
    );
  };

  const refreshInbox = async () => {
    setRefreshingInbox(true);

    try {
      await loadConversations();
    } finally {
      setRefreshingInbox(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Search users
  // ---------------------------------------------------------------------------

  const handleSearchUsers = async (query) => {
    setSearchTerm(query);
    const clean = query.trim().toLowerCase().replace(/[,()]/g, '');
    if (!clean) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .neq('id', currentUserId)
        .or(`username.ilike.%${clean}%,full_name.ilike.%${clean}%`)
        .limit(15);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (err) {
      console.warn('Search error:', err);
      setSearchResults([]);
      Alert.alert('Search failed', err.message || 'Could not search accounts.');
    } finally {
      setSearching(false);
    }
  };

  const handleStartChatWithUser = async (user) => {
    setSearchModalVisible(false);
    setSearchTerm('');
    setSearchResults([]);
    try {
      const conv = await getOrCreateConversation(currentUserId, user.id);
      setActiveConv({ ...conv, otherUser: user });
      loadConversations();
    } catch (err) {
      console.warn('Error starting chat:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const primaryConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          conversation.request_status !== 'pending' ||
          conversation.requested_by === currentUserId
      ),
    [conversations, currentUserId]
  );

  const requestConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          conversation.request_status === 'pending' &&
          conversation.requested_by !== currentUserId
      ),
    [conversations, currentUserId]
  );

  const inboxConversations =
    inboxTab === 'requests' ? requestConversations : primaryConversations;
  const canCall =
    Boolean(activeConv?.id && activeConv?.request_status !== 'pending') &&
    directCall.channelReady;

  const startDirectCall = async (mediaType) => {
    try {
      await directCall.startCall(mediaType);
    } catch (error) {
      Alert.alert('Call unavailable', error.message);
    }
  };

  const handleAcceptRequest = async (conversation) => {
    if (!conversation?.id || requestBusyId) return;

    setRequestBusyId(conversation.id);

    try {
      await acceptMessageRequest(conversation.id);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id
            ? { ...item, request_status: 'accepted' }
            : item
        )
      );
      setActiveConv((current) =>
        current?.id === conversation.id
          ? { ...current, request_status: 'accepted' }
          : current
      );
      setInboxTab('primary');
    } catch (error) {
      Alert.alert('Could not accept request', error.message);
    } finally {
      setRequestBusyId(null);
    }
  };

  const handleDeclineRequest = async (conversation) => {
    if (!conversation?.id || requestBusyId) return;

    setRequestBusyId(conversation.id);

    try {
      await deleteConversation(conversation.id);
      setConversations((current) =>
        current.filter((item) => item.id !== conversation.id)
      );
      setActiveConv((current) =>
        current?.id === conversation.id ? null : current
      );
    } catch (error) {
      Alert.alert('Could not delete request', error.message);
    } finally {
      setRequestBusyId(null);
    }
  };

  const renderMessage = ({ item }) => {
    const isMine = item.sender_id === currentUserId;
    const canManage = isMine && !String(item.id).startsWith('temp_');
    const media = parseDirectMessageMedia(item.text);

    return (
      <View style={styles.messageItem}>
        <View style={[styles.bubbleRow, isMine ? styles.myRow : styles.theirRow]}>
          <Pressable
            style={styles.messagePressable}
            onLongPress={canManage || !String(item.id).startsWith('temp_')
              ? () => setMessageActionTarget(item)
              : undefined}
            delayLongPress={400}
            accessibilityRole="button"
            accessibilityHint="Long press for reactions and message options"
          >
            <GradientBubble isMine={isMine}>
              {media ? (
                <DirectMessageMedia media={media} onOpenImage={setImagePreview} />
              ) : (
                <Text style={[styles.bubbleText, isMine ? styles.myText : styles.theirText]}>
                  {item.text}
                </Text>
              )}
            </GradientBubble>
          </Pressable>
        </View>

        <View style={[styles.messageMetaRow, isMine ? styles.myRow : styles.theirRow]}>
          <Text style={[styles.msgTimestamp, isMine ? styles.msgTimestampMine : styles.msgTimestampTheirs]}>
            {item.edited_at ? 'Edited · ' : ''}{formatMsgTime(item.created_at)}
          </Text>
          {isMine ? (
            <View style={styles.messageStatus}>
              <Ionicons
                name={item.read_at ? 'checkmark-done' : 'checkmark'}
                size={13}
                color={item.read_at ? '#4F46E5' : '#92929C'}
              />
              <Text style={[styles.messageStatusText, item.read_at && styles.messageSeenText]}>
                {item.read_at ? 'Seen' : 'Sent'}
              </Text>
            </View>
          ) : null}
          {canManage && item.id === editingMessageId ? (
            <Text style={styles.editingTag}>Editing</Text>
          ) : null}
          <ReactionSummary
            reactions={reactionsByMessage[item.id] || []}
          />
        </View>
      </View>
    );
  };

  const renderConvCard = ({ item }) => {
    const other = item.otherUser || {};
    const dname = other.full_name || other.username || 'User';
    const isRequest =
      item.request_status === 'pending' &&
      item.requested_by !== currentUserId;
    const isRequestSent =
      item.request_status === 'pending' &&
      item.requested_by === currentUserId;
    const busy = requestBusyId === item.id;

    return (
      <TouchableOpacity
        style={styles.convCard}
        activeOpacity={0.7}
        onLongPress={() => onOpenProfile?.(other)}
        onPress={async () => {
          setActiveConv(item);

          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === item.id ? { ...conv, unread_count: 0 } : conv
            )
          );

          try {
            await markConversationMessagesRead(item.id, currentUserId);
          } catch (err) {
            console.warn('Could not mark conversation as read:', err);
          }
        }}
      >
        <TouchableOpacity
          style={{ position: 'relative' }}
          onPress={() => onOpenProfile?.(other)}
          accessibilityLabel="Open profile"
        >
          {other.avatar_url ? (
            <Image source={{ uri: other.avatar_url }} style={styles.convAvatar} />
          ) : (
            <View style={[styles.convAvatarFallback, { backgroundColor: avatarColor(dname) }]}>
              <Text style={styles.convAvatarLetter}>{dname.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          {getPresenceLabel(other.id) === 'Active now' && (
            <View style={{
              position: 'absolute', right: 0, bottom: 0,
              width: 13, height: 13, borderRadius: 7,
              backgroundColor: '#22C55E', borderWidth: 2,
              borderColor: colors.background || '#FFFFFF',
            }} />
          )}
        </TouchableOpacity>

        <View style={styles.convInfo}>
          <Text style={styles.convName} numberOfLines={1}>{dname}</Text>
          <Text
            style={{
              fontSize: 11,
              color: getPresenceLabel(other.id) === 'Active now'
                ? '#22C55E'
                : colors.muted || '#999999',
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {getPresenceLabel(other.id)}
          </Text>
          <Text style={styles.convLastMessage} numberOfLines={1}>
            {isRequestSent
              ? 'Request sent'
              : isRequest
              ? 'Message request'
              : item.last_message || 'Started a new conversation'}
          </Text>

          {isRequest ? (
            <View style={styles.requestRowButtons}>
              {busy ? (
                <ActivityIndicator size="small" color="#4F46E5" />
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.requestAcceptBtn}
                    onPress={() => handleAcceptRequest(item)}
                  >
                    <Text style={styles.requestAcceptText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.requestDeleteBtn}
                    onPress={() => handleDeclineRequest(item)}
                  >
                    <Text style={styles.requestDeleteText}>Delete</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 7 }}>
          <Text style={styles.convTime}>{timeAgo(item.last_message_at)}</Text>
          {Number(item.unread_count) > 0 && (
            <View style={{
              minWidth: 21,
              height: 21,
              borderRadius: 11,
              backgroundColor: '#9673FF',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 6,
            }}>
              <Text style={{
                color: '#FFFFFF',
                fontSize: 11,
                fontWeight: '700',
              }}>
                {item.unread_count}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (!visible) return null;

  // Wallpaper background color for chat
  const chatBg = chatPrefs.wallpaper || colors.background;

  const body = (
    <>
      <View
        style={[styles.safe, { paddingTop: insets.top }]}
        {...backGestureHandlers}
      >

        {/* ================================================================ */}
        {/* ACTIVE CONVERSATION SCREEN                                        */}
        {/* ================================================================ */}
        {activeConv ? (
          <KeyboardAvoidingView
            style={styles.flexOne}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            {/* CHAT HEADER */}
            <View style={styles.chatHeader}>
              <TouchableOpacity onPress={() => { setActiveConv(null); setStoryShareDraft(null); onBackToInbox?.(); }} style={styles.headerBtn}>
                <Ionicons name="arrow-back" size={26} color={colors.text} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.chatHeaderInfo}
                activeOpacity={0.7}
                onPress={() => onOpenProfile?.(activeConv.otherUser)}
                accessibilityLabel="Open profile"
              >
                {activeConv.otherUser?.avatar_url ? (
                  <Image
                    source={{ uri: activeConv.otherUser.avatar_url }}
                    style={styles.smallAvatar}
                  />
                ) : (
                  <View
                    style={[
                      styles.smallAvatarFallback,
                      { backgroundColor: avatarColor(displayName) },
                    ]}
                  >
                    <Text style={styles.smallAvatarLetter}>
                      {displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View>
                  <Text style={styles.chatHeaderName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text
                    style={[
                      styles.chatHeaderSub,
                      {
                        color: getPresenceLabel(activeConv.otherUser?.id) === 'Active now'
                          ? '#22C55E'
                          : colors.muted || '#999999',
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {getPresenceLabel(activeConv.otherUser?.id)}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.headerBtn}
                onPress={() => startDirectCall('audio')}
                disabled={!canCall}
                accessibilityRole="button"
                accessibilityLabel="Start encrypted voice call"
              >
                <Ionicons
                  name="call-outline"
                  size={22}
                  color={canCall ? colors.text : colors.muted}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerBtn}
                onPress={() => startDirectCall('video')}
                disabled={!canCall}
                accessibilityRole="button"
                accessibilityLabel="Start encrypted video call"
              >
                <Ionicons
                  name="videocam-outline"
                  size={24}
                  color={canCall ? colors.text : colors.muted}
                />
              </TouchableOpacity>

              {/* Info / settings button */}
              <TouchableOpacity
                style={styles.headerBtn}
                onPress={() => setSettingsVisible(true)}
              >
                <MaterialCommunityIcons name="dots-vertical" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {activeConv.request_status === 'pending' ? (
              <View style={styles.requestBanner}>
                <Text style={styles.requestBannerText}>
                  {activeConv.requested_by === currentUserId
                    ? 'Message request sent. They can accept it from Requests.'
                    : 'This is a message request.'}
                </Text>

                {activeConv.requested_by !== currentUserId ? (
                  <View style={styles.requestBannerActions}>
                    <TouchableOpacity
                      onPress={() => handleAcceptRequest(activeConv)}
                      disabled={requestBusyId === activeConv.id}
                    >
                      <Text style={styles.requestBannerAccept}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeclineRequest(activeConv)}
                      disabled={requestBusyId === activeConv.id}
                    >
                      <Text style={styles.requestBannerDelete}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* MESSAGES LIST */}
            {messagesLoading && messages.length === 0 ? (
              <View style={[styles.center, { backgroundColor: chatBg }]}>
                <ActivityIndicator size="small" color="#4F46E5" />
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={[
                  styles.messagesList,
                  { backgroundColor: chatBg },
                ]}
                style={{ backgroundColor: chatBg }}
                keyboardShouldPersistTaps="handled"
                onLayout={scrollMessagesToEnd}
                onScroll={(event) => {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                  const distanceFromBottom =
                    contentSize.height - (contentOffset.y + layoutMeasurement.height);
                  if (initialScrollPendingRef.current) {
                    if (distanceFromBottom < 100) {
                      initialScrollPendingRef.current = false;
                    }
                    return;
                  }
                  shouldAutoScrollRef.current = distanceFromBottom < 100;
                }}
                scrollEventThrottle={16}
                onContentSizeChange={scrollMessagesToEnd}
                renderItem={renderMessage}
                ListFooterComponent={
                  showTyping ? (
                    <View style={{ alignSelf: 'flex-start' }}>
                      <Text style={{ color: '#888', fontSize: 11, marginLeft: 16 }}>
                        Typing...
                      </Text>
                      <TypingIndicator />
                    </View>
                  ) : null
                }
                ListEmptyComponent={
                  <View style={styles.emptyMessages}>
                    <Ionicons name="chatbubbles-outline" size={52} color="#CCC" />
                    <Text style={styles.emptyMessagesText}>No messages yet.</Text>
                    <Text style={styles.emptyMessagesSub}>Say hello to start the chat!</Text>
                  </View>
                }
              />
            )}

            {editingMessageId ? (
              <View style={styles.editingBanner}>
                <Text style={styles.editingBannerText}>Editing message</Text>
                <TouchableOpacity
                  onPress={() => {
                    setEditingMessageId(null);
                    setInputText('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel editing"
                >
                  <Ionicons name="close-circle" size={22} color="#777" />
                </TouchableOpacity>
              </View>
            ) : null}

            {/* MESSAGE INPUT BAR */}
            {storyShareDraft ? (
              <View
                style={{
                  marginHorizontal: 12,
                  marginTop: 8,
                  padding: 9,
                  borderRadius: 12,
                  backgroundColor: colors.raised,
                  borderWidth: 1,
                  borderColor: colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                {storyShareDraft.media_type === 'image' ? (
                  <Image
                    source={{ uri: storyShareDraft.media_url }}
                    style={{ width: 42, height: 48, borderRadius: 6 }}
                  />
                ) : (
                  <View
                    style={{
                      width: 42,
                      height: 48,
                      borderRadius: 6,
                      backgroundColor: colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="play" size={18} color={colors.text} />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                    Story attached
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                    Your message will include this story
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setStoryShareDraft(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove attached story"
                >
                  <Ionicons name="close-circle" size={22} color={colors.muted} />
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={[styles.inputContainer, { paddingBottom: insets.bottom || 10 }]}>
              <TouchableOpacity
                style={styles.attachButton}
                onPress={handlePickAndSendMedia}
                disabled={sending || !!editingMessageId}
                accessibilityRole="button"
                accessibilityLabel="Send photo or video"
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#4F46E5" />
                ) : (
                  <Ionicons name="image-outline" size={23} color="#4F46E5" />
                )}
              </TouchableOpacity>
              <TextInput
                style={styles.textInput}
                placeholder={storyShareDraft ? 'Add a comment…' : 'Message…'}
                placeholderTextColor="#999"
                value={inputText}
                onChangeText={handleInputChange}
                multiline
                maxLength={2000}
              />
              <AnimatedSendButton
                active={!!(inputText.trim() || storyShareDraft) && !sending}
                onPress={handleSendMessage}
                icon={editingMessageId ? 'checkmark' : 'send'}
              />
            </View>
            <DirectCallModal
              call={directCall.call}
              peerName={displayName}
              localStream={directCall.localStream}
              remoteStream={directCall.remoteStream}
              RTCView={directCall.rtcView}
              onAnswer={() =>
                directCall.answerCall().catch((error) =>
                  Alert.alert('Could not answer call', error.message)
                )
              }
              onDecline={() =>
                directCall.declineCall().catch((error) =>
                  Alert.alert('Could not decline call', error.message)
                )
              }
              onHangUp={() =>
                directCall.hangUp().catch((error) =>
                  Alert.alert('Could not end call', error.message)
                )
              }
              onToggleMicrophone={directCall.toggleMicrophone}
              onToggleCamera={directCall.toggleCamera}
            />
          </KeyboardAvoidingView>
        ) : (
          /* ================================================================ */
          /* CONVERSATIONS INBOX SCREEN                                        */
          /* ================================================================ */
          <View style={styles.flexOne}>
            {/* INBOX HEADER */}
            <View style={styles.inboxHeader}>
              <TouchableOpacity onPress={handleClose} style={styles.headerBtn}>
                <Ionicons name="arrow-back" size={26} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.inboxTitle}>Messages</Text>
              <TouchableOpacity
                onPress={() => {
                  setSearchResults([]);
                  setSearchModalVisible(true);
                }}
                style={styles.headerBtn}
              >
                <Ionicons name="create-outline" size={26} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.inboxTabs}>
              <TouchableOpacity
                style={[
                  styles.inboxTab,
                  inboxTab === 'primary' && {
                    backgroundColor: colors.raised,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setInboxTab('primary')}
              >
                <Text
                  style={[
                    styles.inboxTabText,
                    { color: colors.muted },
                    inboxTab === 'primary' && {
                      color: colors.text,
                      fontWeight: '800',
                    },
                  ]}
                >
                  Primary
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.inboxTab,
                  inboxTab === 'requests' && {
                    backgroundColor: colors.raised,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setInboxTab('requests')}
              >
                <Text
                  style={[
                    styles.inboxTabText,
                    { color: colors.muted },
                    inboxTab === 'requests' && {
                      color: colors.text,
                      fontWeight: '800',
                    },
                  ]}
                >
                  Requests
                  {requestConversations.length > 0
                    ? ` (${requestConversations.length})`
                    : ''}
                </Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#4F46E5" />
              </View>
            ) : inboxConversations.length === 0 ? (
              <View style={styles.emptyInbox}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="paper-plane-outline" size={40} color="#4F46E5" />
                </View>
                <Text style={styles.emptyInboxTitle}>
                  {inboxTab === 'requests'
                    ? 'No message requests'
                    : 'Your Messages'}
                </Text>
                <Text style={styles.emptyInboxSub}>
                  {inboxTab === 'requests'
                    ? 'Messages from people who do not follow you will appear here.'
                    : 'Send private messages, photos, and links to your friends.'}
                </Text>
                {inboxTab === 'primary' ? (
                  <TouchableOpacity
                    style={styles.newChatBtn}
                    onPress={() => {
                      setSearchResults([]);
                      setSearchModalVisible(true);
                    }}
                  >
                    <Text style={styles.newChatBtnText}>Send message</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <FlatList
                data={inboxConversations}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderConvCard}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshingInbox}
                    onRefresh={refreshInbox}
                    tintColor="#4F46E5"
                  />
                }
                ItemSeparatorComponent={() => (
                  <View style={styles.separator} />
                )}
              />
            )}
          </View>
        )}

        {/* ================================================================ */}
        {/* CHAT SETTINGS BOTTOM SHEET                                        */}
        {/* ================================================================ */}
        <ChatSettingsSheet
          visible={settingsVisible}
          convId={activeConv?.id}
          currentNickname={chatPrefs.nickname}
          onSave={(prefs) => setChatPrefs(prefs)}
          onClose={() => setSettingsVisible(false)}
        />
      </View>

      <Modal
        transparent
        animationType="fade"
        visible={Boolean(messageActionTarget) && !emojiPickerVisible}
        onRequestClose={() => setMessageActionTarget(null)}
      >
        <View style={styles.messageActionOverlay}>
          <Pressable
            style={styles.messageActionBackdrop}
            onPress={() => setMessageActionTarget(null)}
          />
          <View style={styles.messageActionSheet}>
            <View style={styles.messageActionHandle} />
            <Text style={styles.messageActionTitle}>React to message</Text>
            <View style={styles.quickReactionPicker}>
              {QUICK_REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.quickReactionButton}
                  onPress={() => {
                    const target = messageActionTarget;
                    setMessageActionTarget(null);
                    if (target) void handleToggleReaction(target.id, emoji);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`React with ${emoji}`}
                >
                  <Text style={styles.quickReactionEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.moreReactionButton}
                onPress={() => {
                  setCustomEmoji('');
                  setEmojiPickerVisible(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Choose another emoji"
              >
                <Ionicons name="add" size={24} color="#4F46E5" />
              </TouchableOpacity>
            </View>

            {messageActionTarget?.sender_id === currentUserId ? (
              <>
                {!parseDirectMessageMedia(messageActionTarget.text) ? (
                <TouchableOpacity
                  style={styles.messageActionRow}
                  onPress={() => {
                    setEditingMessageId(messageActionTarget.id);
                    setInputText(messageActionTarget.text || '');
                    setMessageActionTarget(null);
                  }}
                >
                  <Ionicons name="create-outline" size={21} color="#222" />
                  <Text style={styles.messageActionLabel}>Edit message</Text>
                </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.messageActionRow}
                  onPress={() => handleUnsendMessage(messageActionTarget)}
                >
                  <Ionicons name="trash-outline" size={21} color="#D92D3A" />
                  <Text style={[styles.messageActionLabel, styles.destructiveText]}>Unsend for everyone</Text>
                </TouchableOpacity>
              </>
            ) : null}

            <TouchableOpacity
              style={styles.messageActionCancel}
              onPress={() => setMessageActionTarget(null)}
            >
              <Text style={styles.messageActionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={emojiPickerVisible}
        onRequestClose={() => setEmojiPickerVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.emojiPickerOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            style={styles.messageActionBackdrop}
            onPress={() => setEmojiPickerVisible(false)}
          />
          <View style={styles.emojiPickerPanel}>
            <View style={styles.emojiPickerHeader}>
              <Text style={styles.messageActionTitle}>Choose an emoji</Text>
              <TouchableOpacity
                onPress={() => setEmojiPickerVisible(false)}
                accessibilityLabel="Close emoji picker"
              >
                <Ionicons name="close" size={24} color="#555" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.customEmojiInput}
              value={customEmoji}
              onChangeText={setCustomEmoji}
              placeholder="Type or paste any emoji"
              placeholderTextColor="#999"
              maxLength={64}
              returnKeyType="send"
              onSubmitEditing={() => {
                const emoji = customEmoji.trim();
                const target = messageActionTarget;
                if (!emoji || !target) return;
                setEmojiPickerVisible(false);
                setMessageActionTarget(null);
                void handleToggleReaction(target.id, emoji);
              }}
            />
            <ScrollView
              style={styles.emojiGridScroll}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.emojiGrid}>
                {EMOJI_OPTIONS.map((emoji, index) => (
                  <TouchableOpacity
                    key={`${emoji}-${index}`}
                    style={styles.emojiGridButton}
                    onPress={() => {
                      const target = messageActionTarget;
                      setEmojiPickerVisible(false);
                      setMessageActionTarget(null);
                      if (target) void handleToggleReaction(target.id, emoji);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${emoji}`}
                  >
                    <Text style={styles.emojiGridEmoji}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TouchableOpacity
              style={[styles.customEmojiSend, !customEmoji.trim() && styles.customEmojiSendDisabled]}
              disabled={!customEmoji.trim()}
              onPress={() => {
                const emoji = customEmoji.trim();
                const target = messageActionTarget;
                if (!emoji || !target) return;
                setEmojiPickerVisible(false);
                setMessageActionTarget(null);
                void handleToggleReaction(target.id, emoji);
              }}
            >
              <Text style={styles.customEmojiSendText}>React</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!imagePreview}
        transparent
        animationType="fade"
        onRequestClose={() => setImagePreview(null)}
      >
        <View style={styles.imagePreviewOverlay}>
          <Image
            source={{ uri: imagePreview }}
            style={styles.imagePreviewImage}
            resizeMode="contain"
          />
          <TouchableOpacity
            style={[styles.imagePreviewClose, { top: insets.top + 12 }]}
            onPress={() => setImagePreview(null)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <Ionicons name="close" size={25} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ================================================================ */}
      {/* NEW MESSAGE SEARCH MODAL                                          */}
      {/* ================================================================ */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View
          style={[styles.safe, { paddingTop: insets.top }]}
          {...searchBackGestureHandlers}
        >
          <View style={styles.inboxHeader}>
            <TouchableOpacity
              onPress={() => setSearchModalVisible(false)}
              style={styles.headerBtn}
            >
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.inboxTitle}>New Message</Text>
            <View style={{ width: 36 }} />
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color={colors.muted} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search people…"
              placeholderTextColor="#999"
              value={searchTerm}
              onChangeText={handleSearchUsers}
              autoFocus
            />
          </View>

          {searching ? (
            <View style={styles.center}>
              <ActivityIndicator size="small" color="#4F46E5" />
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.convCard}
                  onPress={() => handleStartChatWithUser(item)}
                >
                  {item.avatar_url ? (
                    <Image source={{ uri: item.avatar_url }} style={styles.convAvatar} />
                  ) : (
                    <View
                      style={[
                        styles.convAvatarFallback,
                        { backgroundColor: avatarColor(item.full_name || item.username || 'U') },
                      ]}
                    >
                      <Text style={styles.convAvatarLetter}>
                        {(item.full_name || 'U').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.convInfo}>
                    <Text style={styles.convName}>{item.full_name || item.username}</Text>
                    <Text style={styles.convLastMessage}>@{item.username || 'user'}</Text>
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.noSearchFound}>
                  {searchTerm.trim() ? 'No accounts found' : 'Search for people to message'}
                </Text>
              }
            />
          )}
        </View>
      </Modal>
    </>
  );

  if (inline) {
    return <View style={styles.flexOne}>{body}</View>;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      {body}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Deterministic avatar colour based on name
// ---------------------------------------------------------------------------

function avatarColor(name = '') {
  const palette = [
    '#7C3AED', '#4F46E5', '#0EA5E9', '#10B981',
    '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flexOne: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Inbox header
  inboxHeader: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    backgroundColor: '#FFFFFF',
  },
  headerBtn: { padding: 6 },
  inboxTitle: {
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: '#111',
  },
  inboxTabs: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 13,
  },
  inboxTab: {
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#EAEAEA',
    justifyContent: 'center',
  },
  inboxTabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  requestRowButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  requestAcceptBtn: {
    backgroundColor: '#0095F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  requestAcceptText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  requestDeleteBtn: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  requestDeleteText: {
    color: '#444',
    fontSize: 12,
    fontWeight: '700',
  },
  requestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#EEF2FF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDE3FF',
  },
  requestBannerText: {
    flex: 1,
    color: '#333B65',
    fontSize: 12,
    lineHeight: 17,
  },
  requestBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  requestBannerAccept: {
    color: '#0095F6',
    fontSize: 13,
    fontWeight: '800',
  },
  requestBannerDelete: {
    color: '#ED4956',
    fontSize: 13,
    fontWeight: '700',
  },

  // Empty inbox
  emptyInbox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyInboxTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginTop: 18,
  },
  emptyInboxSub: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  newChatBtn: {
    marginTop: 22,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  newChatBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },

  // Conversation card
  convCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F0F0F0',
    marginLeft: 90,
  },
  convAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#EAEAEA' },
  convAvatarFallback: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
  },
  convAvatarLetter: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  convInfo: { flex: 1, marginLeft: 14 },
  convName: { fontSize: 15, fontWeight: '700', color: '#111' },
  convLastMessage: { fontSize: 13, color: '#777', marginTop: 3 },
  convTime: { fontSize: 11, color: '#AAA', marginLeft: 8 },

  // Chat header
  chatHeader: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAEAEA',
    backgroundColor: '#FFFFFF',
  },
  chatHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginLeft: 4 },
  smallAvatar: { width: 38, height: 38, borderRadius: 19 },
  smallAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallAvatarLetter: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  chatHeaderName: { fontSize: 15, fontWeight: '700', color: '#111', maxWidth: 180 },
  chatHeaderSub: { fontSize: 11, color: '#888', marginTop: 1 },

  // Messages list
  messagesList: { paddingHorizontal: 14, paddingVertical: 12, flexGrow: 1 },
  messageItem: { marginVertical: 3 },
  bubbleRow: { marginVertical: 1, flexDirection: 'row' },
  mediaImageFrame: {
    width: 238,
    height: 286,
    maxWidth: '100%',
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: '#181820',
  },
  mediaMessage: { width: '100%', height: '100%', backgroundColor: '#111' },
  mediaVideo: { width: 238, height: 286, borderRadius: 17, backgroundColor: '#111' },
  mediaOpenHint: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.56)',
  },
  mediaOpenText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  imagePreviewOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050506',
  },
  imagePreviewImage: { width: '100%', height: '100%' },
  imagePreviewClose: {
    position: 'absolute',
    left: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  myRow: { justifyContent: 'flex-end' },
  theirRow: { justifyContent: 'flex-start' },
  messagePressable: { maxWidth: '84%', flexShrink: 1 },
  bubbleText: { fontSize: 16, lineHeight: 22, flexShrink: 1, textAlign: 'left' },
  myText: { color: '#FFFFFF' },
  theirText: { color: '#111111' },
  messageMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  msgTimestamp: { fontSize: 10, flexShrink: 0, marginHorizontal: 2 },
  msgTimestampMine: { color: 'rgba(255,255,255,0.65)', textAlign: 'right' },
  msgTimestampTheirs: { color: '#AAA', textAlign: 'left' },
  messageStatus: { flexDirection: 'row', alignItems: 'center', gap: 2, marginHorizontal: 3 },
  messageStatusText: { color: '#92929C', fontSize: 10, fontWeight: '600' },
  messageSeenText: { color: '#4F46E5' },
  editingTag: { color: '#777', fontSize: 11 },
  editingBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: '#F3F4F6',
  },
  editingBannerText: { color: '#4F46E5', fontSize: 12, fontWeight: '700' },
  messageActionOverlay: { flex: 1, justifyContent: 'flex-end' },
  emojiPickerOverlay: { flex: 1, justifyContent: 'flex-end' },
  messageActionBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  messageActionSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
  },
  messageActionHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4D4D8',
    alignSelf: 'center',
    marginBottom: 14,
  },
  messageActionTitle: { color: '#222', fontSize: 16, fontWeight: '700' },
  quickReactionPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 7,
    marginTop: 14,
    marginBottom: 8,
  },
  quickReactionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  quickReactionEmoji: { fontSize: 23 },
  moreReactionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
  },
  messageActionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EAEAEA',
  },
  messageActionLabel: { color: '#222', fontSize: 15, fontWeight: '600' },
  destructiveText: { color: '#D92D3A' },
  messageActionCancel: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 7,
  },
  messageActionCancelText: { color: '#333', fontSize: 15, fontWeight: '700' },
  emojiPickerPanel: {
    maxHeight: '86%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
  },
  emojiPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  customEmojiInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8D8E0',
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#222',
    marginBottom: 8,
  },
  emojiGridScroll: { maxHeight: 300 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  emojiGridButton: {
    width: '12.5%',
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiGridEmoji: { fontSize: 24 },
  customEmojiSend: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  customEmojiSendDisabled: { opacity: 0.45 },
  customEmojiSendText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  // Empty messages
  emptyMessages: { paddingVertical: 80, alignItems: 'center' },
  emptyMessagesText: { fontSize: 16, fontWeight: '700', color: '#555', marginTop: 12 },
  emptyMessagesSub: { fontSize: 13, color: '#999', marginTop: 4 },

  // Input bar
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EAEAEA',
    backgroundColor: '#FFFFFF',
  },
  attachButton: {
    width: 38,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
    marginBottom: 2,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111' },
  noSearchFound: { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 14 },
});
