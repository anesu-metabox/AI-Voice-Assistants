import React from 'react';
import { Tabs, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomTabBar from '../../src/components/BottomTabBar';
import { useTheme } from '../../src/context/ThemeContext';

export default function TabsLayout() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.cardBg }}>
      <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
      tabBar={(props: any) => {
        const routeName = props.state.routes[props.state.index].name;
        const activeTab = routeName === 'index' ? 'home' : routeName;

        return (
          <BottomTabBar
            activeTab={activeTab}
            onTabChange={(tab) => {
              const targetRoute = tab === 'home' ? '/(tabs)' : `/(tabs)/${tab}`;
              router.push(targetRoute as any);
            }}
            onFabPress={() => {
              router.push('/live-call');
            }}
          />
        );
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="calls" options={{ title: 'Calls' }} />
      <Tabs.Screen name="integrations" options={{ title: 'Integrations' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
    </SafeAreaView>
  );
}
