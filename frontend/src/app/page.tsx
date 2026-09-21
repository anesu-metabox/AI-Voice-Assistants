"use client";

import React, { useState } from "react";
import { AudioVisualizer } from "@/components/audio/AudioVisualizer";
import { AudioControls } from "@/components/audio/AudioControls";
import { TranscriptDeck } from "@/components/transcript/TranscriptDeck";
import { TaskDeck } from "@/components/tasks/TaskDeck";
import { GoogleCalendarAuth } from "@/components/auth/GoogleCalendarAuth";
import { useLiveKitSession } from "@/hooks/useLiveKitSession";
import { useGeminiLiveSession } from "@/hooks/useGeminiLiveSession";
import { useClientVAD } from "@/hooks/useClientVAD";
import { isVoiceSessionActive } from "@/lib/livekitSessionRuntime";
import { Sparkles, ShieldCheck, Radio, Globe } from "lucide-react";

export default function Home() {
  const [engine, setEngine] = useState<"livekit" | "browser_direct">("livekit");

  const livekitSession = useLiveKitSession();
  const directSession = useGeminiLiveSession();

  const activeSession = engine === "livekit" ? livekitSession : directSession;

  const {
    connectionStatus,
    isMuted,
    isHandsFree,
    isBotSpeaking,
    isUserSpeaking,
    latencyMs,
    messages,
    tasks,
    analyserNode,
    assistantGainNode,
    micStream,
    connect,
    disconnect,
    toggleMute,
    toggleHandsFree,
    handleInterruption,
    handleSpeechStart,
    handleSpeechEnd,
  } = activeSession;

  // Sub-20ms Interruption VAD Hook (ADR-005)
  useClientVAD({
    micStream,
    assistantGainNode,
    isBotSpeaking,
    onInterruption: handleInterruption,
    onSpeechStart: handleSpeechStart,
    onSpeechEnd: handleSpeechEnd,
  });

  const handleToggleEngine = (newEngine: "livekit" | "browser_direct") => {
    if (isVoiceSessionActive(connectionStatus)) {
      disconnect();
    }
    setEngine(newEngine);
  };

  return (
    <main className="flex flex-col h-screen bg-[#070a11] text-slate-100 overflow-hidden">
      {/* Top Navbar */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-semibold text-sm tracking-wide text-slate-100">AI VOICE BOT</h1>
            <p className="text-[11px] text-slate-400">
              Executive Task Assistant • {engine === "livekit" ? "LiveKit WebRTC + Gemini Live" : "Direct Browser Gemini"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {/* Engine Selector Toggle */}
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => handleToggleEngine("livekit")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                engine === "livekit"
                  ? "bg-sky-600 text-white font-medium shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>LiveKit Agent</span>
            </button>
            <button
              onClick={() => handleToggleEngine("browser_direct")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                engine === "browser_direct"
                  ? "bg-slate-700 text-white font-medium shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Globe className="w-3 h-3" />
              <span>Direct Browser</span>
            </button>
          </div>

          <GoogleCalendarAuth />

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/60 border border-slate-700 text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Idempotency Active</span>
          </div>
        </div>
      </header>

      {/* Main 3-Column Layout */}
      <div className="flex-1 grid grid-cols-12 gap-5 p-6 overflow-hidden">
        {/* Left Column: Audio Visualizer & Voice Orb (4 Cols) */}
        <div className="col-span-4 flex flex-col items-center justify-between p-6 rounded-2xl bg-slate-950/60 border border-slate-800/80 shadow-2xl relative overflow-hidden">
          <div className="w-full text-center">
            <span className="text-xs font-medium text-slate-400 tracking-wider uppercase">Voice Media Stream</span>
            <h2 className="text-lg font-bold text-slate-100 mt-1">
              {isBotSpeaking ? "Assistant Speaking..." : isUserSpeaking ? "Listening to You..." : "Session Idle"}
            </h2>
          </div>

          <div className="my-auto py-4">
            <AudioVisualizer
              analyserNode={analyserNode}
              isBotSpeaking={isBotSpeaking}
              isUserSpeaking={isUserSpeaking}
            />
          </div>

          <div className="w-full">
            <AudioControls
              isMuted={isMuted}
              onToggleMute={toggleMute}
              isHandsFree={isHandsFree}
              onToggleHandsFree={toggleHandsFree}
              connectionStatus={connectionStatus}
              onConnect={connect}
              onDisconnect={disconnect}
              latencyMs={latencyMs}
            />
          </div>
        </div>

        {/* Middle Column: Live Streaming Transcript (4 Cols) */}
        <div className="col-span-4 h-full">
          <TranscriptDeck messages={messages} />
        </div>

        {/* Right Column: Dual-Speed Execution Task Ledger (4 Cols) */}
        <div className="col-span-4 h-full">
          <TaskDeck tasks={tasks} />
        </div>
      </div>
    </main>
  );
}
