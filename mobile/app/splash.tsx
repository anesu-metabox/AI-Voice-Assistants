import React from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import SplashScreen from '../src/screens/SplashScreen';

export default function SplashPage() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#EEF2FF' }}>
      <SplashScreen
        onDone={() => router.push('/(auth)/create-account')}
        onSignInPress={() => router.push('/(auth)/sign-in')}
      />
    </SafeAreaView>
  );
}
