import React, { createContext, useContext, useState, useEffect } from 'react';
import { Appearance } from 'react-native';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  isDark: boolean;
  bg: string;
  cardBg: string;
  cardSecondary: string;
  cardHover: string;
  border: string;
  borderLight: string;
  textHeading: string;
  textBody: string;
  textMuted: string;
  textSubtle: string;
  statusBarBg: string;
  statusBarText: string;
  tabBarBg: string;
  tabBarBorder: string;
  tabBarActive: string;
  tabBarInactive: string;
  accent: string;
  primary: string;
  pillBg: string;
}

const darkColors: ThemeColors = {
  isDark: true,
  bg: '#0B1120',
  cardBg: '#131B2E',
  cardSecondary: '#1A243B',
  cardHover: '#212D49',
  border: '#232F4A',
  borderLight: '#31415F',
  textHeading: '#F1F5F9',
  textBody: '#D5DDEA',
  textMuted: '#93A1B8',
  textSubtle: '#66748C',
  statusBarBg: '#0B1120',
  statusBarText: '#F1F5F9',
  tabBarBg: '#0F1729',
  tabBarBorder: '#232F4A',
  tabBarActive: '#7C9CFF',
  tabBarInactive: '#66748C',
  accent: '#22D3EE',
  primary: '#4F6BFF',
  pillBg: 'rgba(79,107,255,0.18)',
};

const lightColors: ThemeColors = {
  isDark: false,
  bg: '#F4F6FB',
  cardBg: '#FFFFFF',
  cardSecondary: '#EEF1F8',
  cardHover: '#E5EAF4',
  border: '#E3E8F2',
  borderLight: '#CBD3E3',
  textHeading: '#0F172A',
  textBody: '#27334A',
  textMuted: '#5B6A83',
  textSubtle: '#8593AB',
  statusBarBg: '#F4F6FB',
  statusBarText: '#0F172A',
  tabBarBg: '#FFFFFF',
  tabBarBorder: '#E3E8F2',
  tabBarActive: '#3B5BDB',
  tabBarInactive: '#8593AB',
  accent: '#0891B2',
  primary: '#3B5BDB',
  pillBg: 'rgba(59,91,219,0.10)',
};

interface ThemeContextType {
  theme: ThemeMode;
  colors: ThemeColors;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  colors: darkColors,
  toggleTheme: () => {},
  setTheme: () => {},
});

const THEME_STORAGE_KEY = 'vocalist_theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      // localStorage only exists on web; on native this safely falls through
      const ls = (globalThis as any).localStorage;
      const saved = ls?.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // Ignore storage access restrictions
    }
    // Follow the phone's system appearance by default
    return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    try {
      (globalThis as any).localStorage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore
    }
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
  };

  const colors = theme === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ theme, colors, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme() {
  return useContext(ThemeContext);
}
