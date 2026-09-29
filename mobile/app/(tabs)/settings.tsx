import React from 'react';
import { useRouter } from 'expo-router';
import SettingsScreen from '../../src/screens/SettingsScreen';
import { useAuth } from '../../src/context/AuthContext';

export default function SettingsTabRoute() {
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <SettingsScreen
      onSignOut={async () => {
        await signOut();
        router.replace('/');
      }}
      onSetupPress={() => router.push('/setup')}
    />
  );
}
