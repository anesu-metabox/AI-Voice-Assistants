import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import OnboardingScreen from '../src/screens/OnboardingScreen';
import { useAuth } from '../src/context/AuthContext';

export default function SetupPage() {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const params = useLocalSearchParams<{ step?: string }>();
  // Always start at step 2 (Company) — Account step is handled by auth screens
  const initialStep = params.step ? Math.max(parseInt(params.step, 10), 2) : 2;

  const handleDone = async () => {
    await refreshSession();
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <OnboardingScreen
        initialStep={isNaN(initialStep) ? 2 : initialStep}
        onDone={handleDone}
      />
    </SafeAreaView>
  );
}
