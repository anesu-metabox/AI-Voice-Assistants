"use client";

import React from "react";
import { AudioVisualizer } from "@/components/audio/AudioVisualizer";
import { AudioControls } from "@/components/audio/AudioControls";
import { TranscriptDeck } from "@/components/transcript/TranscriptDeck";
import { TaskDeck } from "@/components/tasks/TaskDeck";
//import { useLiveKitSession } from "@/hooks/useLiveKitSession";
import { useClientVAD } from "@/hooks/useClientVAD";
import { Sparkles, ShieldCheck } from "lucide-react";
import { useGeminiLiveSession } from "@/hooks/useGeminiLiveSession";

export default function Home() {
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
  } = useGeminiLiveSession();

  // Sub-20ms Interruption VAD Hook (ADR-005)
  useClientVAD({
    micStream,
    assistantGainNode,
    onInterruption: handleInterruption,
  });

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
            <p className="text-[11px] text-slate-400">Executive Task Assistant • LiveKit + Gemini Live</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
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
