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
- Stories upload
- Story media storage
- Story audio/music feature under development

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
- Profiles
- Social posts
- Likes
- Comments
- Saved posts
- User follows
- Stories
- Story views
- Music library (setup/status needs verification)

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

9. Scan the QR code using Expo Go.

## 9. Important Development Notes
- Keep Android and iOS compatibility.
- Test changes in Expo Go.
- Do not commit `.env`.
- Do not commit `node_modules`.
- Keep Supabase SQL scripts in the repository.
- Use the existing Supabase project when switching computers.

## 10. Pending Work
- Complete and test story music library.
- Verify original story video audio.
- Verify optional music playback and audio mixing.
- Fix remaining story navigation or playback issues.
- Complete Reels functionality.
- Test all screens on Android and iOS.
- Improve loading, error and empty states.
- Perform final security and database policy checks.

## 11. Git Workflow

After making changes:

   git add .
   git commit -m "Describe your changes"
   git push

Before continuing on another computer:

   git pull

## 12. Project Status
Authentication, profile management, post creation, feed, likes, comments, saved posts and follow system have been implemented and tested to varying degrees.

Stories and music functionality are still under development. Reels is pending.
