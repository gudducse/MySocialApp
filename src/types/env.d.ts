/**
 * Minimal ambient types for Expo's inline environment variables.
 *
 * Expo replaces `process.env.EXPO_PUBLIC_*` at build time; the app does not
 * ship Node.js itself, so we only declare the tiny surface we use instead of
 * pulling in the whole `@types/node` package.
 */
declare const process: {
  env: Record<string, string | undefined>;
};
