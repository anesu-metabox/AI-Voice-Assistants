import React, { useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import BottomTabBar from './components/BottomTabBar';
import SplashScreen from './screens/SplashScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import DashboardScreen from './screens/DashboardScreen';
import CallsScreen from './screens/CallsScreen';
import IntegrationsScreen from './screens/IntegrationsScreen';
import SettingsScreen from './screens/SettingsScreen';
import LiveCallModal from './screens/LiveCallModal';
import { ThemeProvider, useTheme } from './context/ThemeContext';

type AppScreen = 'splash' | 'onboarding' | 'app';
type Tab = 'home' | 'calls' | 'integrations' | 'settings';

function AppShell() {
  const { colors, theme } = useTheme();
  const [screen, setScreen] = useState<AppScreen>('splash');
  const [onboardingStep, setOnboardingStep] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [showLiveCall, setShowLiveCall] = useState(false);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={theme === 'dark' || screen === 'splash' || showLiveCall ? 'light-content' : 'dark-content'}
        backgroundColor={screen === 'splash' ? '#EEF2FF' : colors.cardBg}
      />
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        {screen === 'splash' && (
          <SplashScreen onDone={() => { setOnboardingStep(1); setScreen('onboarding'); }} />
        )}
        {screen === 'onboarding' && (
          <OnboardingScreen initialStep={onboardingStep} onDone={() => setScreen('app')} />
        )}
        {screen === 'app' && (
          <View style={styles.screenArea}>
            {activeTab === 'home' && (
              <DashboardScreen
                onQuickTest={() => setShowLiveCall(true)}
                onConfigureAssistant={() => {
                  setOnboardingStep(3);
                  setScreen('onboarding');
                }}
              />
            )}
            {activeTab === 'calls' && <CallsScreen />}
            {activeTab === 'integrations' && <IntegrationsScreen />}
            {activeTab === 'settings' && <SettingsScreen />}

            <BottomTabBar
              activeTab={activeTab}
              onTabChange={(tab) => setActiveTab(tab as Tab)}
              onFabPress={() => setShowLiveCall(true)}
            />

            {showLiveCall && (
              <LiveCallModal onClose={() => setShowLiveCall(false)} />
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  screenArea: {
    flex: 1,
    position: 'relative',
  },
});
