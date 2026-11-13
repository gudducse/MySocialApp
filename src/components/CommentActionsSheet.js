import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useThemedStyles } from '../theme/ThemeProvider';
import {
  deletePostComment,
  setPostCommentHidden,
  updatePostComment,
} from '../services/posts';

/**
 * Comment management overlay.
 *
 * Rendered inside an existing modal/screen (not as a nested Modal) so it works
 * reliably on iOS. Visibility and permissions are already enforced by RLS:
 *  - the comment author can edit/delete their own comment
 *  - the post owner can hide/unhide or delete any comment on their post
 */
export default function CommentActionsSheet({
  comment,
  currentUserId,
  postOwnerId,
  onClose,
  onUpdated,
  onDeleted,
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(baseStyles);
  const [mode, setMode] = useState('actions');
  const [draft, setDraft] = useState(comment?.body || '');
  const [busy, setBusy] = useState(false);

  if (!comment) return null;

  const isOwn = comment.user_id === currentUserId;
  const isPostOwner = postOwnerId === currentUserId;
  const canManage = isOwn || isPostOwner;

  if (!canManage) return null;

  const commentName =
    comment.author?.username || comment.author?.full_name || 'user';

  async function handleSave() {
    const cleanDraft = draft.trim();

    if (!cleanDraft) {
      Alert.alert('Empty comment', 'Write something before saving.');
      return;
    }

    if (cleanDraft === comment.body) {
      onClose?.();
      return;
    }

    setBusy(true);

    try {
      const updated = await updatePostComment({
        commentId: comment.id,
        userId: currentUserId,
        body: cleanDraft,
      });

      onUpdated?.({ ...comment, ...updated });
      onClose?.();
    } catch (error) {
      Alert.alert('Could not edit comment', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function performDelete() {
    setBusy(true);

    try {
      await deletePostComment({ commentId: comment.id });
      onDeleted?.(comment);
      onClose?.();
    } catch (error) {
      Alert.alert('Could not delete comment', error.message);
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete comment?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: performDelete,
        },
      ]
    );
  }

  async function toggleHidden() {
    setBusy(true);

    try {
      const updated = await setPostCommentHidden({
        commentId: comment.id,
        hidden: !comment.is_hidden,
      });

      onUpdated?.({ ...comment, ...updated });
      onClose?.();
    } catch (error) {
      Alert.alert('Could not update comment', error.message);
    } finally {
      setBusy(false);
    }
  }

  const row = (
    icon,
    label,
    onPress,
    { danger = false } = {}
  ) => (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.7}
    >
      <Ionicons
        name={icon}
        size={21}
        color={danger ? colors.danger : colors.text}
      />
      <Text
        style={[
          styles.rowLabel,
          { color: danger ? colors.danger : colors.text },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.scrim, { backgroundColor: colors.overlay }]}
        activeOpacity={1}
        onPress={busy ? undefined : onClose}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[styles.handle, { backgroundColor: colors.border }]}
          />

          {mode === 'edit' ? (
            <>
              <Text style={[styles.title, { color: colors.text }]}>
                Edit comment
              </Text>

              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    backgroundColor: colors.input,
                    borderColor: colors.border,
                  },
                ]}
                value={draft}
                onChangeText={setDraft}
                placeholder="Edit your comment..."
                placeholderTextColor={colors.muted}
                multiline
                maxLength={1000}
                autoFocus
                editable={!busy}
              />

              <View style={styles.editActions}>
                <TouchableOpacity
                  onPress={() => setMode('actions')}
                  disabled={busy}
                  style={styles.editButton}
                >
                  <Text
                    style={[styles.editButtonText, { color: colors.secondaryText }]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSave}
                  disabled={busy}
                  style={styles.editButton}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text
                      style={[styles.editButtonText, { color: colors.accent }]}
                    >
                      Save
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: colors.text }]}>
                Comment options
              </Text>
              <Text style={[styles.subtitle, { color: colors.muted }]}>
                @{commentName}
              </Text>

              {isOwn
                ? row('create-outline', 'Edit comment', () => setMode('edit'))
                : null}

              {isPostOwner
                ? row(
                    comment.is_hidden ? 'eye-outline' : 'eye-off-outline',
                    comment.is_hidden ? 'Unhide comment' : 'Hide comment',
                    toggleHidden
                  )
                : null}

              {row('trash-outline', 'Delete comment', confirmDelete, {
                danger: true,
              })}

              <TouchableOpacity
                style={[styles.cancel, { borderColor: colors.border }]}
                onPress={onClose}
                disabled={busy}
              >
                <Text style={[styles.cancelText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 999,
    elevation: 30,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 3,
    marginBottom: 6,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  cancel: {
    minHeight: 48,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '700',
  },
  input: {
    minHeight: 92,
    maxHeight: 180,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 20,
    textAlignVertical: 'top',
    marginTop: 8,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 12,
  },
  editButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: '800',
  },
});
