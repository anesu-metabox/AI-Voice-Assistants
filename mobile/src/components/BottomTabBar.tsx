import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path, Rect, Circle, Line } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';

interface BottomTabBarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onFabPress: () => void;
}

function HomeIcon({ color }: { color: string }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24">
      <Path
        d="M3 12L12 3L21 12V20C21 20.5523 20.5523 21 20 21H15V16H9V21H4C3.44772 21 3 20.5523 3 20V12Z"
        fill={color}
      />
    </Svg>
  );
}

function CallsIcon({ color }: { color: string }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24">
      <Path
        d="M6.62 10.79C8.06 13.62 10.38 15.93 13.21 17.38L15.41 15.18C15.68 14.91 16.08 14.82 16.43 14.94C17.55 15.31 18.76 15.51 20 15.51C20.5523 15.51 21 15.9577 21 16.51V20C21 20.5523 20.5523 21 20 21C10.61 21 3 13.39 3 4C3 3.44772 3.44772 3 4 3H7.5C8.05228 3 8.5 3.44772 8.5 4C8.5 5.25 8.7 6.45 9.07 7.57C9.18 7.92 9.1 8.31 8.82 8.59L6.62 10.79Z"
        stroke={color}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PlugIcon({ color }: { color: string }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24">
      <Path d="M12 2V7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M8 2V7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Rect x="6" y="7" width="8" height="6" rx="1" stroke={color} strokeWidth="1.8" fill="none" />
      <Path d="M10 13V17" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M10 17C10 17 7 18.5 7 21" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M10 17C10 17 13 18.5 13 21" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function SettingsIcon({ color }: { color: string }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.8" />
      <Path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
        stroke={color}
        strokeWidth="1.8"
        fill="none"
      />
    </Svg>
  );
}

function MicIcon() {
  return (
    <Svg width="26" height="26" viewBox="0 0 24 24">
      <Rect x="9" y="2" width="6" height="12" rx="3" fill="white" />
      <Path
        d="M5 11C5 14.866 8.13401 18 12 18C15.866 18 19 14.866 19 11"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <Line x1="12" y1="18" x2="12" y2="21" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <Line x1="9" y1="21" x2="15" y2="21" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
    </Svg>
  );
}

const tabs = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'calls', label: 'Calls', Icon: CallsIcon },
  { id: 'integrations', label: 'Integrations', Icon: PlugIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function BottomTabBar({ activeTab, onTabChange, onFabPress }: BottomTabBarProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.tabBarBg, borderTopColor: colors.border }]}>
      <View style={styles.tabRow}>
        {tabs.map((tab, i) => {
          const isActive = activeTab === tab.id;
          const iconColor = isActive ? colors.tabBarActive : colors.tabBarInactive;

          return (
            <React.Fragment key={tab.id}>
              {i === 2 && <View style={styles.fabSpacer} />}
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => onTabChange(tab.id)}
                style={styles.tabButton}
              >
                {isActive && (
                  <View style={[styles.activeIndicator, { backgroundColor: colors.tabBarActive }]} />
                )}
                <tab.Icon color={iconColor} />
                <Text
                  style={[
                    styles.tabLabel,
                    {
                      color: iconColor,
                      fontWeight: isActive ? '600' : '400',
                    },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </View>

      {/* Floating Center Mic FAB */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onFabPress}
        style={styles.fabWrapper}
      >
        <LinearGradient
          colors={['#3B82F6', '#2563EB']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.fabCircle,
            {
              borderColor: colors.isDark ? '#1E293B' : '#FFFFFF',
            },
          ]}
        >
          <MicIcon />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    height: 72,
    borderTopWidth: 1,
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    position: 'relative',
  },
  activeIndicator: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 3,
    borderRadius: 2,
  },
  tabLabel: {
    fontSize: 10,
  },
  fabSpacer: {
    width: 72,
  },
  fabWrapper: {
    position: 'absolute',
    top: -26,
    left: '50%',
    marginLeft: -32,
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  fabCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
});
