import React from 'react';
import { useRouter } from 'expo-router';
import LiveCallModal from '../src/screens/LiveCallModal';

export default function LiveCallModalRoute() {
  const router = useRouter();

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
