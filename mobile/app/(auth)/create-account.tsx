import React from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import SignInScreen from '../../src/screens/SignInScreen';
import { useAuth } from '../../src/context/AuthContext';
import { apiService } from '../../src/services/api';

export default function CreateAccountPage() {
  const router = useRouter();
  const { refreshSession } = useAuth();

  const handleSuccess = async () => {
    await refreshSession();
    // New accounts always go through setup
    router.replace('/setup');
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#0D1526' }}>
      <SignInScreen
        initialMode="signup"
        onSuccess={handleSuccess}
        onBack={() => router.replace('/splash')}
      />
    </SafeAreaView>
  );
}
