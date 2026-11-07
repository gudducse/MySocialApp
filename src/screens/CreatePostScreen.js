import React, { useState } from 'react';
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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createImagePost } from '../services/posts';

export default function CreatePostScreen({ userId, onPostCreated, onClose }) {
  const [asset, setAsset] = useState(null);
  const [caption, setCaption] = useState('');
  const [publishing, setPublishing] = useState(false);

  async function chooseImage() {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Photo access needed',
          'Allow access to your photo library to choose a post image.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.85,
        base64: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const selected = result.assets[0];
      if (!selected.base64) {
        Alert.alert('Image error', 'Could not read this image. Please choose another.');
        return;
      }

      if (selected.fileSize && selected.fileSize > 15 * 1024 * 1024) {
        Alert.alert('Image too large', 'Choose an image smaller than 15 MB.');
        return;
      }

      setAsset(selected);
    } catch (error) {
      Alert.alert('Gallery error', error.message);
    }
  }

  async function publishPost() {
    if (!userId) {
      Alert.alert('Login required', 'Please log in again before posting.');
      return;
    }
    if (!asset) {
      Alert.alert('Choose a photo', 'Select a photo before sharing your post.');
      return;
    }

    setPublishing(true);
    try {
      await createImagePost({
        userId,
        asset,
        caption,
      });

      setAsset(null);
      setCaption('');
      onPostCreated?.();
      Alert.alert('Post shared', 'Your photo is now in the feed.', [
        { text: 'OK', onPress: () => onClose?.() },
      ]);
    } catch (error) {
      console.error('Create post error:', error);
      Alert.alert('Could not publish', error.message || 'Please try again.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} disabled={publishing}>
            <Ionicons name="close" size={28} color="#111" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New post</Text>
          <TouchableOpacity
            onPress={publishPost}
            disabled={publishing || !asset}
          >
            {publishing ? (
              <ActivityIndicator color="#3897F0" />
            ) : (
              <Text style={[styles.share, !asset && styles.shareDisabled]}>
                Share
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.chooseButton}
            onPress={chooseImage}
            disabled={publishing}
          >
            <Ionicons name="images-outline" size={21} color="#222" />
            <Text style={styles.chooseText}>
              {asset ? 'Choose a different photo' : 'Choose from gallery'}
            </Text>
          </TouchableOpacity>

          {asset ? (
            <Image source={{ uri: asset.uri }} style={styles.preview} />
          ) : (
            <TouchableOpacity
              style={styles.emptyPreview}
              onPress={chooseImage}
              activeOpacity={0.8}
            >
              <Ionicons name="image-outline" size={56} color="#999" />
              <Text style={styles.emptyTitle}>Select a photo</Text>
              <Text style={styles.emptySub}>
                Your photo preview will appear here.
              </Text>
            </TouchableOpacity>
          )}

          <TextInput
            style={styles.caption}
            placeholder="Write a caption..."
            placeholderTextColor="#888"
            value={caption}
            onChangeText={setCaption}
            multiline
            maxLength={2200}
            textAlignVertical="top"
          />

          <Text style={styles.counter}>{caption.length}/2200</Text>
          <Text style={styles.note}>
            Image posts are supported in this milestone. Video posts and tagging will be added next.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  header: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD',
  },
  headerTitle: { color: '#111', fontSize: 17, fontWeight: '700' },
  share: { color: '#1687E8', fontSize: 15, fontWeight: '800' },
  shareDisabled: { color: '#A9CDEB' },
  content: { padding: 16, paddingBottom: 35 },
  chooseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: '#F2F2F2',
    padding: 13,
    borderRadius: 9,
    marginBottom: 14,
  },
  chooseText: { color: '#222', fontWeight: '700', fontSize: 14 },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 5,
    backgroundColor: '#EEE',
  },
  emptyPreview: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F4F4F4',
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { marginTop: 12, fontSize: 17, color: '#333', fontWeight: '700' },
  emptySub: { marginTop: 5, color: '#888', fontSize: 12 },
  caption: {
    marginTop: 17,
    minHeight: 105,
    fontSize: 15,
    color: '#111',
    paddingVertical: 10,
  },
  counter: { textAlign: 'right', color: '#999', fontSize: 11 },
  note: { color: '#888', fontSize: 12, lineHeight: 18, marginTop: 18 },
});
