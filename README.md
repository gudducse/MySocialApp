# SocialApp

SocialApp is a fully featured social networking app built with Expo, React Native, and Supabase. It brings photo and video sharing, short-form videos, Stories, people discovery, direct messaging, and audio/video calls together in one mobile app for iOS and Android.

## Features

- **Accounts and profiles:** Sign in with Supabase, edit your profile and avatar, add a bio, view post and follower counts, and browse your posts or saved posts.
- **Follow and privacy controls:** Follow or unfollow people, send and manage follow requests for private accounts, and get notified when a request is accepted.
- **Home feed:** Browse posts from the community, publish photos and videos with captions, like and comment on posts, save posts, and share posts.
- **Explore and people search:** Find accounts by name or username and discover people in your contacts when you choose to use contact discovery.
- **Reels:** Watch a vertical video feed, play or pause videos, mute playback, like and save videos, comment, and follow creators.
- **Stories:** Share photo or video Stories that expire after 24 hours, add music, see who viewed them, like them, and reply directly to a Story.
- **Direct messages:** Chat one-to-one, send photos and videos, react to messages, share a Story with its visual context, and manage message requests. New-message notifications can open the relevant chat.
- **Audio and video calls:** Place peer-to-peer voice or video calls from a conversation using WebRTC.
- **Activity and notifications:** See follow activity, follow requests and acceptances, post likes and comments, and Story likes in the in-app activity feed.
- **Safety and account settings:** Choose a public or private account, block, mute, or restrict accounts, manage notification preferences, change your password, and select light, dark, or system theme.

## Tech stack

- Expo SDK 58 and React Native
- React Navigation
- Supabase Auth, Postgres, Realtime, and Storage
- Expo Notifications, Contacts, Image Picker, Video, and Audio
- `react-native-webrtc` for calls

## Getting started

### 1. Install dependencies

Use Node.js and npm:

```bash
npm ci
```

### 2. Configure Supabase

Create a Supabase project, then copy `.env.example` to `.env` and set your project URL and publishable key:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

In the Supabase SQL Editor, apply `supabase/complete_schema.sql` when setting up a new database. For an existing database, apply the relevant schema updates from `supabase/` that it does not yet have. In particular, run `supabase/story_replies.sql` to enable Story replies and likes. Configure the Supabase Storage buckets and policies required by the schema before testing media uploads.

### 3. Start the app

```bash
npm run start
```

For development builds, use:

```bash
npx expo run:android
npx expo run:ios
```

### 4. Check the code

```bash
npm run typecheck
npm run lint
```

## Platform notes

- Audio and video calls require a native development build with WebRTC; they are not available in Expo Go.
- Remote push notifications require a physical device, notification permission, and a configured Expo/EAS project. Push delivery also depends on the backend notification setup.
- Contact discovery requires the user's permission and only runs when they choose the contacts feature.
- App functionality that reads or writes Supabase data requires valid project credentials and the corresponding database tables, policies, and storage configuration.
