# MySocialApp — Project Handover

## 1. Project Overview
MySocialApp is an Instagram-style social media application built using React Native, Expo and Supabase.

The goal is to build a beginner-friendly social networking app that works on both Android and iOS.

## 2. Technology Stack
- React Native
- Expo SDK 58
- JavaScript
- Supabase Authentication
- Supabase Database
- Supabase Storage
- React Navigation
- Expo Image Picker

## 3. Main App Navigation
- Home
- Explore
- Create
- Reels
- Profile

## 4. Implemented Features
- User signup and login
- User profiles
- Edit profile
- Profile picture upload
- Create image posts
- Home feed
- Like and unlike posts
- Comments
- Save posts
- Follow and unfollow users
- Followers and following counts
- Private follow requests with acceptance notifications for the requester
- Stories upload
- Story media storage
- Story audio/music feature under development
- One-to-one voice and video calls in accepted DMs (native WebRTC)

## 5. Supabase Configuration
The project uses environment variables.

Create a local `.env` file in the project root:

EXPO_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY

Never upload `.env` or real Supabase credentials to GitHub.

Use `.env.example` as the template.

## 6. Supabase Storage Buckets
- avatars
- post-media
- story-media
- story-audio

## 7. Database
SQL setup files are stored in the `supabase/` folder.

Important database features include:
- Comment editing, hiding and deletion policies (`supabase/comment_management.sql`)
- Profiles
- Social posts
- Likes
- Comments
- Saved posts
- User follows
- Stories
- Story views
- Music library (setup/status needs verification)

Run `supabase/apply_all_fixes.sql` once in the Supabase SQL editor (or run
`supabase/complete_schema.sql`, which includes the same migrations):

- Comment editing / hiding / deletion
- Message unsend-for-everyone + live reactions
- Private phone matching for contact sync
- Private accounts, follow requests, hidden follower lists
- Follow-request acceptance timestamps and requester notifications (`supabase/follow_request_acceptance_notifications.sql`)
- Blocks, mutes and restrictions
- DM message requests (Primary / Requests, accept/delete)

## 8. Run the Project on a New Computer

1. Install Node.js.
2. Install Git.
3. Clone the GitHub repository.
4. Open the project folder in Terminal.
5. Install dependencies:

   npm install

6. Create `.env` using `.env.example`.
7. Add the same Supabase project URL and publishable key.
8. Start Expo:

   npx expo start

9. Scan the QR code using Expo Go for features that do not need custom native modules.

Voice and video calls do not work in Expo Go because it does not include the
WebRTC native module. Build and install the development client instead:

```sh
npx eas-cli@latest build --platform ios --profile development
# or
npx eas-cli@latest build --platform android --profile development
```

Both people in a call must use a SocialApp development or production build with
WebRTC included. iOS device builds require Apple signing credentials.

## 9. Important Development Notes
- Keep Android and iOS compatibility.
- Test JavaScript-only changes in Expo Go; native-module features require a development build.
- Do not commit `.env`.
- Do not commit `node_modules`.
- Keep Supabase SQL scripts in the repository.
- Use the existing Supabase project when switching computers.

## 10. Completed Work
- Completed and tested story auto-advancing progress timers & press-to-pause.
- Seeded royalty-free music library in `supabase/complete_schema.sql`.
- Built full-screen interactive Reels viewer with vertical snap paging, likes, comments, save, share, sound toggle, and creator follow.
- Implemented Direct Messaging (DMs) with inbox, real-time message stream, and search new chat.
- Implemented UserProfileModal to view any user's profile, post grid, and stats.
- Added Profile "Saved Posts" tab.
- Added Settings and Activity modal sheet.
- Added post deletion for author with Supabase storage cleanup.
- Configured iOS and Android permissions in `app.json`.

## 11. Git Workflow

After making changes:

   git add .
   git commit -m "Describe your changes"
   git push

Before continuing on another computer:

   git pull

## 12. Project Status
All core Instagram features (Feed, Stories, Reels, Direct Messaging, User Profiles, Saved Posts, Explore search, Settings) are fully built and tested to bundle cleanly for both iOS and Android. Run `supabase/complete_schema.sql` in Supabase SQL editor to ensure all database tables and policies are active.
