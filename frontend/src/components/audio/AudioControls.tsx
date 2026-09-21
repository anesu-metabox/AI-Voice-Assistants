"use client";

import React from "react";
import { Mic, MicOff, PhoneOff, Radio, Volume2 } from "lucide-react";
import { ConnectionStatus } from "@/lib/types";

interface AudioControlsProps {
  isMuted: boolean;
  onToggleMute: () => void;
  isHandsFree: boolean;
  onToggleHandsFree: () => void;
  connectionStatus: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  latencyMs?: number;
}

export const AudioControls: React.FC<AudioControlsProps> = ({
  isMuted,
  onToggleMute,
  isHandsFree,
  onToggleHandsFree,
  connectionStatus,
  onConnect,
  onDisconnect,
  latencyMs = 380,
}) => {
  const isConnected = connectionStatus === "connected";
  const isBusy = [
    "connecting",
    "waiting_for_agent",
    "waiting_for_audio",
    "reconnecting",
  ].includes(connectionStatus);
  const connectButtonDisabled = [
    "connecting",
    "waiting_for_agent",
    "reconnecting",
  ].includes(connectionStatus);

  const connectionLabel =
    connectionStatus === "waiting_for_agent"
      ? "Waiting for agent"
      : connectionStatus === "waiting_for_audio"
      ? "Tap to enable audio"
      : connectionStatus;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Latency & Status Pill */}
      <div className="flex items-center gap-3 px-3.5 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
        <span
          className={`w-2 h-2 rounded-full ${
            isConnected
              ? "bg-emerald-400 animate-pulse"
              : isBusy
              ? "bg-amber-400 animate-pulse"
              : "bg-rose-500"
          }`}
        />
        <span className="capitalize font-medium">{connectionLabel}</span>
        {isConnected && (
          <>
            <span className="text-slate-600">|</span>
            <span className="text-sky-400 font-mono">{latencyMs}ms lag</span>
          </>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex items-center gap-4">
        {isConnected ? (
          <>
            {/* Mic Mute / Unmute Button */}
            <button
              onClick={onToggleMute}
              className={`p-4 rounded-full transition-all duration-200 border ${
                isMuted
                  ? "bg-rose-500/20 text-rose-400 border-rose-500/40 hover:bg-rose-500/30"
                  : "bg-sky-500 text-slate-950 font-semibold border-sky-400 shadow-lg shadow-sky-500/25 hover:bg-sky-400"
              }`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            {/* Hands-free / Push-To-Talk Toggle */}
            <button
              onClick={onToggleHandsFree}
              className={`p-3 rounded-full border transition-all text-xs flex items-center gap-2 ${
                isHandsFree
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                  : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
              }`}
              title="Toggle Hands-Free Mode"
            >
              <Radio className="w-4 h-4" />
              <span>{isHandsFree ? "Hands-Free" : "Push-to-Talk"}</span>
            </button>

            {/* Disconnect Call */}
            <button
              onClick={onDisconnect}
              className="p-4 rounded-full bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white border border-slate-700 hover:border-rose-500 transition-all"
              title="Disconnect Voice Session"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onConnect}
              disabled={connectButtonDisabled}
              className="px-6 py-3 rounded-full bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-wait text-slate-950 font-semibold shadow-lg shadow-sky-500/25 transition-all flex items-center gap-2"
            >
              <Volume2 className="w-5 h-5" />
              <span>{isBusy ? connectionLabel : "Start Voice Assistant"}</span>
            </button>
            {isBusy && (
              <button
                onClick={onDisconnect}
                className="p-3 rounded-full bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white border border-slate-700 hover:border-rose-500 transition-all"
                title="Cancel Voice Session"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
