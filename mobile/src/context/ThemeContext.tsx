import React, { createContext, useContext, useState, useEffect } from 'react';

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
  bg: '#0A0E1F',
  cardBg: '#111C33',
  cardSecondary: '#16223F',
  cardHover: '#1A294C',
  border: '#1E293B',
  borderLight: '#2A3B5C',
  textHeading: '#F8FAFC',
  textBody: '#E2E8F0',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  statusBarBg: '#0A0E1F',
  statusBarText: '#F8FAFC',
  tabBarBg: '#0D1526',
  tabBarBorder: '#1E293B',
  tabBarActive: '#38BDF8',
  tabBarInactive: '#64748B',
  accent: '#06B6D4',
  primary: '#3B5BDB',
  pillBg: 'rgba(59,91,219,0.2)',
};

const lightColors: ThemeColors = {
  isDark: false,
  bg: '#F8FAFC',
  cardBg: '#FFFFFF',
  cardSecondary: '#F1F5F9',
  cardHover: '#E8ECF4',
  border: '#E8ECF4',
  borderLight: '#CBD5E1',
  textHeading: '#0D1526',
  textBody: '#1E293B',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  statusBarBg: '#FFFFFF',
  statusBarText: '#0D1526',
  tabBarBg: '#FFFFFF',
  tabBarBorder: '#E8ECF4',
  tabBarActive: '#2563EB',
  tabBarInactive: '#9CA3AF',
  accent: '#4F46E5',
  primary: '#3B5BDB',
  pillBg: 'rgba(59,91,219,0.08)',
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
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // Ignore localStorage access restrictions
    }
    return 'dark'; // Executive Dark Mode by default
  });

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
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
