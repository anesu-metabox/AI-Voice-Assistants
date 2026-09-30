import React from 'react';
import { useRouter } from 'expo-router';
import DashboardScreen from '../../src/screens/DashboardScreen';

export default function DashboardTabRoute() {
  const router = useRouter();

  return (
    <DashboardScreen
      onQuickTest={() => router.push('/live-call')}
      onConfigureAssistant={() => router.push({ pathname: '/setup', params: { step: '3' } })}
    />
  );
}
