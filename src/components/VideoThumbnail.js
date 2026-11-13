import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';

// Avoid regenerating the same cover every time a profile grid re-renders.
const thumbCache = new Map();

/**
 * Shows a real cover frame for a video instead of the white/broken tile that
 * <Image source={{ uri: videoUrl }} /> produces natively.
 */
export default function VideoThumbnail({ uri, coverUri, style, playIcon = true }) {
  const [thumbnail, setThumbnail] = useState(
    uri ? thumbCache.get(uri) || null : null
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    if (!uri || thumbnail) return undefined;

    VideoThumbnails.getThumbnailAsync(uri, {
      time: 0,
      quality: 0.65,
    })
      .then((result) => {
        if (!result?.uri) throw new Error('No thumbnail returned');

        thumbCache.set(uri, result.uri);
        if (active) setThumbnail(result.uri);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [uri, thumbnail]);

  if (coverUri) {
    return (
      <View style={style}>
        <Image source={{ uri: coverUri }} style={styles.image} />
        {playIcon ? (
          <View style={styles.playBadge} pointerEvents="none">
            <Ionicons name="play" size={14} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    );
  }

  if (thumbnail) {
    return (
      <View style={style}>
        <Image source={{ uri: thumbnail }} style={styles.image} />
        {playIcon ? (
          <View style={styles.playBadge} pointerEvents="none">
            <Ionicons name="play" size={14} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[style, styles.placeholder]}>
      {failed ? (
        <Ionicons name="play" size={24} color="#FFFFFF" />
      ) : (
        <ActivityIndicator size="small" color="#FFFFFF" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  placeholder: {
    backgroundColor: '#252535',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
