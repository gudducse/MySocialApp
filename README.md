# social. Interactions Patch — Comments + Saved Posts

This patch extends the existing `social_posts` feed with persistent:
- Comments (read and add)
- Save / unsave posts
- Comment counts on feed cards
- Saved-state bookmark icons

## Files in this patch

Copy into your existing `~/Desktop/social-app`:
- `src/services/posts.js` — replace existing service file
- `src/screens/HomeScreen.js` — replace existing feed screen
- `supabase/social_interactions.sql` — run in Supabase SQL Editor

Do not replace `App.js`, `.env`, `lib/supabase.js`, or `ProfileScreen.js` for this patch.

## 1. Back up

```bash
cd ~/Desktop/social-app
tar --exclude=node_modules --exclude=.expo --exclude=.git -czf ../social-app-before-interactions.tar.gz .
```

## 2. Apply SQL

Open `supabase/social_interactions.sql` in VS Code, copy all of it, then in Supabase Dashboard → SQL Editor → New Query, paste and Run.

This creates:
- `social_post_comments`
- `social_saved_posts`

It enables RLS and grants authenticated users access only as authorized by the included policies. Comments can be read by authenticated users; only the author can insert, update, or delete their own comments. Saved-post rows are private to the saving user.

This SQL assumes `public.social_posts` already exists. It does not modify existing `posts`, `profiles`, or other tables.

## 3. Copy the two JS files

- `src/services/posts.js` → your project `src/services/posts.js` (replace)
- `src/screens/HomeScreen.js` → your project `src/screens/HomeScreen.js` (replace)

Keep the existing `CreatePostScreen.js`; it uses the same `createImagePost` export preserved in the new service.

## 4. Dependencies

No new dependencies are introduced by this patch. The project should already have `base64-arraybuffer`, Supabase JS, React Navigation, Expo Image Picker, and Safe Area Context from earlier milestones.

## 5. Test

```bash
cd ~/Desktop/social-app
npx expo-doctor
npx expo start --clear
```

Then:
1. Sign in.
2. Open Home and refresh.
3. Tap the comment icon on a post.
4. Add a comment and press Post.
5. Close and reopen comments to verify it persists.
6. Tap bookmark to save a post.
7. Restart the app and confirm the bookmark remains filled.
8. Check Supabase Table Editor for `social_post_comments` and `social_saved_posts`.

## Scope

Comments and saved posts are persistent. Likes continue using `social_post_likes`. The patch does not implement threaded replies, edit/delete comment UI, share links, following, video/Reels playback, Stories, or chat. Those remain separate milestones.

## Notes

- The Home Feed must already be connected to the `social_posts` table.
- Feed/profile queries expect authenticated read access to `profiles` fields `id`, `full_name`, `username`, `avatar_url`.
- Never disable RLS to make an error go away.
- Never put a Supabase service-role key in the mobile app.
