import React from 'react';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomTabBar from '../../src/components/BottomTabBar';
import { useTheme } from '../../src/context/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';

export default function TabsLayout() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) return null;
  if (!isAuthenticated) return <Redirect href="/splash" />;

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
