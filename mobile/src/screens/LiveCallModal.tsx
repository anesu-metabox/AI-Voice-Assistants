import React from 'react';
import VoiceAssistant from '../components/VoiceAssistant';

export default function LiveCallModal({ onClose }: { onClose: () => void }) {
  return <VoiceAssistant autoStart onClose={onClose} />;
}
