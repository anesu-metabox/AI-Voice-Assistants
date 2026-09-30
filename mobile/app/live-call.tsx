import React from 'react';
import { Redirect, useRouter } from 'expo-router';
import LiveCallModal from '../src/screens/LiveCallModal';
import { useAuth } from '../src/context/AuthContext';

export default function LiveCallModalRoute() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) return null;
  if (!isAuthenticated) return <Redirect href="/splash" />;

  return (
    <LiveCallModal
      onClose={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)');
        }
      }}
    />
  );
}
