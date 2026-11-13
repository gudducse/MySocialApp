import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'system';

export type ThemeColors = {
  background: string;
  surface: string;
  raised: string;
  input: string;
  text: string;
  secondaryText: string;
  muted: string;
  border: string;
  separator: string;
  accent: string;
  accentSoft: string;
  danger: string;
  inverse: string;
  overlay: string;
};

const THEME_STORAGE_KEY = '@social-app/theme-preference-v2';

const palettes: Record<ThemeMode, ThemeColors> = {
  light: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    raised: '#F7F7FA',
    input: '#F1F2F5',
    text: '#16171B',
    secondaryText: '#555862',
    muted: '#858894',
    border: '#E5E6EA',
    separator: '#EFEFF2',
    accent: '#9673FF',
    accentSoft: '#F0EBFF',
    danger: '#ED4956',
    inverse: '#FFFFFF',
    overlay: 'rgba(0,0,0,0.48)',
  },
  dark: {
    background: '#090D12',
    surface: '#151A20',
    raised: '#222830',
    input: '#222830',
    text: '#F7F8FA',
    secondaryText: '#C1C7D0',
    muted: '#929BA7',
    border: '#2A313A',
    separator: '#20262E',
    accent: '#5366FF',
    accentSoft: '#252D5B',
    danger: '#FF6674',
    inverse: '#111318',
    overlay: 'rgba(0,0,0,0.68)',
  },
};

type ThemeContextValue = {
  mode: ThemeMode;
  preference: ThemePreference;
  colors: ThemeColors;
  ready: boolean;
  setMode: (mode: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: React.PropsWithChildren) {
  const systemMode = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((storedMode) => {
        if (active && (storedMode === 'system' || storedMode === 'light' || storedMode === 'dark')) {
          setPreference(storedMode);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback(async (nextMode: ThemePreference) => {
    setPreference(nextMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {}
  }, []);

  const mode = preference === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : preference;
  const value = useMemo(
    () => ({ mode, preference, colors: palettes[mode], ready, setMode }),
    [mode, preference, ready, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme must be used inside ThemeProvider.');
  return value;
}

const darkText = new Set(['#111', '#111111', '#161616', '#222', '#262626']);
const secondaryText = new Set(['#333', '#444', '#555', '#555555']);
const mutedText = new Set([
  '#666',
  '#777',
  '#888',
  '#999',
  '#a1a1ad',
  '#8e8e8e',
]);
const lightSurfaces = new Set(['#fff', '#ffffff', '#fefefe']);
const softSurfaces = new Set([
  '#eee',
  '#efefef',
  '#f0f0f0',
  '#f1f2f5',
  '#f2f3f7',
  '#f3f4f6',
  '#f5f5f5',
  '#f7f7f7',
  '#fafafa',
]);
const lightBorders = new Set([
  '#ddd',
  '#dbdbdb',
  '#e5e7eb',
  '#eaeaea',
  '#eee',
  '#efefef',
  '#f0f0f0',
]);

/** Remap common light-mode style colors while preserving media and accent colors. */
export function useThemedStyles<T extends Record<string, object>>(baseStyles: T): T {
  const { colors, mode } = useAppTheme();

  return useMemo(() => {
    const themed: Record<string, object> = {};
    for (const [name, sourceStyle] of Object.entries(baseStyles)) {
      const style = StyleSheet.flatten(sourceStyle as never) as Record<string, unknown>;
      const nextStyle: Record<string, unknown> = {};
      for (const [property, value] of Object.entries(style)) {
        if (typeof value !== 'string') {
          nextStyle[property] = value;
          continue;
        }
        const normalized = value.toLowerCase();
        if (property === 'color') {
          if (darkText.has(normalized)) nextStyle[property] = colors.text;
          else if (secondaryText.has(normalized)) nextStyle[property] = colors.secondaryText;
          else if (mutedText.has(normalized)) nextStyle[property] = colors.muted;
          else nextStyle[property] = value;
        } else if (property === 'backgroundColor') {
          if (lightSurfaces.has(normalized)) {
            const isPage = /^(container|safe|screen|modalSafe|main|root)$/i.test(name);
            nextStyle[property] = isPage ? colors.background : colors.surface;
          } else if (softSurfaces.has(normalized)) {
            nextStyle[property] = colors.raised;
          } else if (/^(container|safe|screen|modalSafe|main|root)$/i.test(name)) {
            nextStyle[property] = colors.background;
          } else if (mode === 'dark' && ['#101114', '#111111', '#1D1E25'].includes(normalized)) {
            nextStyle[property] = name.toLowerCase().includes('screen') ? colors.background : colors.surface;
          } else {
            nextStyle[property] = value;
          }
        } else if (property === 'borderColor' && lightBorders.has(normalized)) {
          nextStyle[property] = colors.border;
        } else {
          nextStyle[property] = value;
        }
      }
      themed[name] = nextStyle;
    }
    return themed as T;
  }, [baseStyles, colors, mode]);
}
