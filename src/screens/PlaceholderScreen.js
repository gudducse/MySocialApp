import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

const screenData = {
  Explore: {
    icon: 'search-outline',
    description: 'Discover people and posts. Search results will be connected next.',
  },
  Reels: {
    icon: 'play-circle-outline',
    description: 'Short-video browsing will be added in the Reels milestone.',
  },
};

export default function PlaceholderScreen({ route }) {
  const name = route?.name || 'Explore';
  const data = screenData[name] || screenData.Explore;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.heading}>{name}</Text>
      {name === 'Explore' && (
        <TextInput
          placeholder="Search people and posts"
          placeholderTextColor="#999"
          style={styles.search}
        />
      )}
      <View style={styles.content}>
        <Ionicons name={data.icon} size={64} color="#262626" />
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.description}>{data.description}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF', padding: 16 },
  heading: { fontSize: 25, fontWeight: '800', color: '#111', marginVertical: 12 },
  search: {
    height: 45, backgroundColor: '#EFEFEF', borderRadius: 10,
    paddingHorizontal: 15, fontSize: 14, color: '#111',
  },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 },
  title: { fontSize: 24, fontWeight: '800', marginTop: 18, color: '#111' },
  description: { fontSize: 14, color: '#777', textAlign: 'center', marginTop: 10, lineHeight: 22 },
});
