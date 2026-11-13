
import React, { useCallback, useEffect, useRef, useState } from 'react';

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
import { VideoView, useVideoPlayer } from 'expo-video';

import { supabase } from '../../lib/supabase';
import {
  createImagePost,
  createVideoPost,
} from '../services/posts';
import { useThemedStyles } from '../theme/ThemeProvider';
import useEdgeSwipeBack from '../hooks/useEdgeSwipeBack';

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_VIDEO_DURATION = 60000;

// VIDEO PREVIEW
function VideoPreview({ uri }) {
  const styles = useThemedStyles(baseStyles);
  const player = useVideoPlayer(uri, (player) => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  return (
    <VideoView
      player={player}
      style={styles.preview}
      contentFit="contain"
      nativeControls
    />
  );
}

export default function CreatePostScreen({
  navigation,
  route,
  userId: passedUserId,
  onPostCreated,
  onClose,
}) {
  const styles = useThemedStyles(baseStyles);
  const isReelCreation = route?.params?.type === 'reel';
  const [asset, setAsset] = useState(null);
  const [coverAsset, setCoverAsset] = useState(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);

  const isVideo =
    asset?.type === 'video' ||
    (asset?.mimeType || '').toLowerCase().startsWith('video/');

  // SELECT PHOTO OR VIDEO
  const chooseMedia = useCallback(async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Permission required',
          'Please allow gallery access to select photos or videos.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: isReelCreation ? ['videos'] : ['images', 'videos'],
        allowsEditing: false,
        quality: 0.85,
        base64: false,
        videoMaxDuration: 60,
      });

      if (result.canceled || !result.assets?.length) return;

      const selected = result.assets[0];

      const selectedIsVideo =
        selected.type === 'video' ||
        (selected.mimeType || '').toLowerCase().startsWith('video/');

      if (!selected.uri) {
        Alert.alert('Error', 'Could not read the selected media.');
        return;
      }

      if (selected.fileSize && selected.fileSize > MAX_FILE_SIZE) {
        Alert.alert(
          'File too large',
          'Please select a file smaller than 15 MB.'
        );
        return;
      }

      if (
        selectedIsVideo &&
        selected.duration &&
        selected.duration > MAX_VIDEO_DURATION
      ) {
        Alert.alert(
          'Video too long',
          'Please select a video of 60 seconds or shorter.'
        );
        return;
      }

      setAsset({
        ...selected,
        type: selectedIsVideo ? 'video' : 'image',
      });
      setCoverAsset(null);
    } catch (error) {
      Alert.alert('Gallery error', error.message || 'Could not open gallery.');
    }
  }, [isReelCreation]);
  const galleryOpenedRef = useRef(false);

  useEffect(() => {
    if (!navigation?.addListener) return undefined;

    const openGallery = () => {
      if (galleryOpenedRef.current) return;
      galleryOpenedRef.current = true;
      chooseMedia();
    };
    const focusSubscription = navigation.addListener('focus', openGallery);
    const blurSubscription = navigation.addListener('blur', () => {
      galleryOpenedRef.current = false;
    });
    if (navigation.isFocused?.()) openGallery();

    return () => {
      focusSubscription();
      blurSubscription();
    };
  }, [navigation, chooseMedia]);

  const chooseCover = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setCoverAsset(result.assets[0]);
      }
    } catch (error) {
      Alert.alert('Gallery error', error.message || 'Could not select a cover.');
    }
  };

  // PUBLISH POST
  const publishPost = async () => {
    if (!asset) {
      Alert.alert('Select media', 'Please select a photo or video first.');
      return;
    }

    if (!caption.trim() && !asset.uri) {
      Alert.alert('Empty post', 'Please add media to publish.');
      return;
    }

    setLoading(true);

    try {
      let userId = passedUserId;

      if (!userId) {
        const { data, error } = await supabase.auth.getUser();

        if (error) throw error;
        userId = data?.user?.id;
      }

      if (!userId) {
        throw new Error('Please log in before publishing.');
      }

      if (isVideo) {
        await createVideoPost({
          userId,
          asset,
          caption,
          coverAsset,
        });
      } else {
        await createImagePost({
          userId,
          asset,
          caption,
        });
      }

      Alert.alert(
        'Published successfully',
        isVideo
          ? 'Your Reel has been uploaded. Open Reels to watch it.'
          : 'Your photo has been uploaded.',
        [
          {
            text: 'OK',
            onPress: () => {
              setAsset(null);
              setCoverAsset(null);
              setCaption('');
              if (onPostCreated) {
                onPostCreated();
              }
              if (onClose) {
                onClose();
              } else if (navigation?.navigate) {
                navigation.navigate('Home');
              } else if (navigation?.goBack) {
                navigation.goBack();
              }
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert(
        'Upload failed',
        error.message || 'Something went wrong while uploading.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else if (navigation?.navigate) {
      navigation.navigate('Home');
    } else if (navigation?.goBack) {
      navigation.goBack();
    }
  };
  const backGestureHandlers = useEdgeSwipeBack(handleClose);

  // REMOVE SELECTED MEDIA
  const removeMedia = () => {
    setAsset(null);
    setCoverAsset(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...backGestureHandlers}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose}>
          <Ionicons name="close" size={27} color="#FFFFFF" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>
          {isReelCreation ? 'Create Reel' : 'Create Post'}
        </Text>

        <TouchableOpacity
          onPress={publishPost}
          disabled={loading || !asset}
          style={[
            styles.shareButton,
            (!asset || loading) && styles.disabledButton,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.shareText}>Share</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.selectButton}
          onPress={chooseMedia}
          disabled={loading}
        >
          <Ionicons name="images-outline" size={24} color="#FFFFFF" />

          <Text style={styles.selectButtonText}>
            {isReelCreation ? 'Select a video' : 'Select Photo or Video'}
          </Text>
        </TouchableOpacity>

        {asset ? (
          <View style={styles.previewContainer}>
            {isVideo ? (
              <VideoPreview uri={asset.uri} />
            ) : (
              <Image
                source={{ uri: asset.uri }}
                style={styles.preview}
                resizeMode="contain"
              />
            )}

            <TouchableOpacity
              style={styles.removeButton}
              onPress={removeMedia}
            >
              <Ionicons name="close-circle" size={30} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.mediaLabel}>
              <Ionicons
                name={isVideo ? 'videocam' : 'image'}
                size={15}
                color="#FFFFFF"
              />
              <Text style={styles.mediaLabelText}>
                {isVideo ? 'Video / Reel' : 'Photo'}
              </Text>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.emptyPreview}
            onPress={chooseMedia}
          >
            <Ionicons name="cloud-upload-outline" size={55} color="#888899" />
            <Text style={styles.emptyTitle}>Add your media</Text>
            <Text style={styles.emptySubtitle}>
              Choose a photo or video from your gallery
            </Text>
          </TouchableOpacity>
        )}

        {isVideo && asset ? (
          <View style={styles.coverSection}>
            <View style={styles.coverCopy}>
              <Text style={styles.captionLabel}>Video cover</Text>
              <Text style={styles.coverHint}>Choose the image shown on your profile.</Text>
            </View>
            <TouchableOpacity style={styles.coverPicker} onPress={chooseCover}>
              {coverAsset?.uri ? (
                <Image source={{ uri: coverAsset.uri }} style={styles.coverImage} />
              ) : (
                <Ionicons name="image-outline" size={24} color="#FFFFFF" />
              )}
              <Ionicons name="add-circle" size={20} color="#FFFFFF" style={styles.coverAddIcon} />
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.captionLabel}>Write a caption</Text>

        <TextInput
          style={styles.captionInput}
          placeholder="Write something about your post..."
          placeholderTextColor="#858592"
          multiline
          maxLength={2200}
          value={caption}
          onChangeText={setCaption}
          editable={!loading}
        />

        <Text style={styles.characterCount}>
          {caption.length}/2200
        </Text>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={19} color="#9673FF" />

          <Text style={styles.infoText}>
            Photos and videos up to 15 MB are supported. Videos must be
            60 seconds or shorter.
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.publishButton,
            (!asset || loading) && styles.disabledButton,
          ]}
          onPress={publishPost}
          disabled={!asset || loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.publishButtonText}>
              {isVideo ? 'Publish Reel' : 'Publish Post'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101114',
  },

  header: {
    height: 58,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#292932',
  },

  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },

  shareButton: {
    backgroundColor: '#9673FF',
    paddingHorizontal: 17,
    paddingVertical: 8,
    borderRadius: 9,
    minWidth: 65,
    alignItems: 'center',
  },

  shareText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  disabledButton: {
    opacity: 0.45,
  },

  content: {
    padding: 18,
    paddingBottom: 45,
  },

  selectButton: {
    height: 52,
    backgroundColor: '#292532',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },

  selectButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  coverSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  coverCopy: { flex: 1, paddingRight: 12 },
  coverHint: { color: '#A8A8B5', fontSize: 12, marginTop: 3 },
  coverPicker: {
    width: 62,
    height: 62,
    borderRadius: 8,
    backgroundColor: '#292532',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coverImage: { width: '100%', height: '100%' },
  coverAddIcon: { position: 'absolute', right: 2, bottom: 2 },

  previewContainer: {
    width: '100%',
    height: 390,
    backgroundColor: '#1D1E25',
    borderRadius: 15,
    overflow: 'hidden',
    marginBottom: 25,
    justifyContent: 'center',
  },

  preview: {
    width: '100%',
    height: '100%',
  },

  removeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#00000088',
    borderRadius: 20,
  },

  mediaLabel: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: '#00000099',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  mediaLabelText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },

  emptyPreview: {
    height: 300,
    backgroundColor: '#1D1E25',
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
    borderWidth: 1,
    borderColor: '#393945',
    borderStyle: 'dashed',
  },

  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 15,
  },

  emptySubtitle: {
    color: '#9999A6',
    fontSize: 13,
    marginTop: 7,
  },

  captionLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },

  captionInput: {
    minHeight: 115,
    backgroundColor: '#1D1E25',
    color: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    textAlignVertical: 'top',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#34343D',
  },

  characterCount: {
    color: '#9999A6',
    textAlign: 'right',
    marginTop: 7,
    fontSize: 12,
  },

  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#201D2B',
    padding: 12,
    borderRadius: 10,
    marginTop: 22,
    gap: 9,
  },

  infoText: {
    flex: 1,
    color: '#B8B5C5',
    fontSize: 12,
    lineHeight: 19,
  },

  publishButton: {
    height: 52,
    backgroundColor: '#9673FF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 25,
  },

  publishButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
