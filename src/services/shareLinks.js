import * as Linking from 'expo-linking';

export function getPostAppLink(postId) {
  return Linking.createURL(`post/${encodeURIComponent(postId)}`, {
    scheme: 'socialapp',
  });
}

export function getPostShareMessage(post) {
  const caption = post?.caption || 'Check out this post!';
  return `${caption}\n${getPostAppLink(post?.id)}`;
}

export function getProfileAppLink(userId) {
  return Linking.createURL(`profile/${encodeURIComponent(userId)}`, {
    scheme: 'socialapp',
  });
}

export function getProfileShareMessage(profile) {
  const name = profile?.username
    ? `@${profile.username}`
    : profile?.full_name || 'this profile';
  return `View ${name} on SocialApp\n${getProfileAppLink(profile?.id)}`;
}
