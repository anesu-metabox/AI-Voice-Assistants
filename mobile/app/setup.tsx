import React from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import OnboardingScreen from '../src/screens/OnboardingScreen';
import { useAuth } from '../src/context/AuthContext';

export default function SetupPage() {
  const router = useRouter();
  const { isLoading, isAuthenticated, refreshSession } = useAuth();
  const params = useLocalSearchParams<{ step?: string }>();
  // Always start at step 2 (Company) — Account step is handled by auth screens
  const initialStep = params.step ? Math.max(parseInt(params.step, 10), 2) : 2;

  if (isLoading) return null;
  if (!isAuthenticated) return <Redirect href="/splash" />;

  const handleDone = async () => {
    await refreshSession();
    router.replace('/(tabs)');
  };

  const handleSkip = () => {
    // This is intentionally read-only. Web configuration remains authoritative
    // and mobile must not create or publish an overriding profile.
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <OnboardingScreen
        initialStep={isNaN(initialStep) ? 2 : initialStep}
        onDone={handleDone}
        onSkip={handleSkip}
      />
    </SafeAreaView>
  );
}
