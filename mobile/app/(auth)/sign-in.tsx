import React from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import SignInScreen from '../../src/screens/SignInScreen';
import { useTheme } from '../../src/context/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';

export default function SignInPage() {
  const router = useRouter();
  const { refreshSession, hasCompletedSetup } = useAuth();
  const { colors } = useTheme();

  const handleSuccess = async () => {
    await refreshSession();
    router.replace(hasCompletedSetup ? '/(tabs)' : '/setup');
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <SignInScreen
        initialMode="signin"
        onSuccess={handleSuccess}
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/splash');
          }
        }}
      />
    </SafeAreaView>
  );
}

