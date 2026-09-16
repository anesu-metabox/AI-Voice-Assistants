"use client";

import React, { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { TranscriptMessage } from "@/lib/types";
import { TranscriptItem } from "./TranscriptItem";

interface TranscriptDeckProps {
  messages: TranscriptMessage[];
}

export const TranscriptDeck: React.FC<TranscriptDeckProps> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full rounded-2xl bg-slate-950/60 border border-slate-800/80 overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/80 bg-slate-900/40">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <MessageSquare className="w-4 h-4 text-sky-400" />
          <span>Real-time Conversation</span>
        </div>
        <span className="text-xs text-slate-500 font-mono">{messages.length} utterances</span>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 text-sm">
            <p>Voice session ready.</p>
            <p className="text-xs text-slate-600 mt-1">Start speaking or tap the mic button to converse.</p>
          </div>
        ) : (
          messages.map((msg) => <TranscriptItem key={msg.id} message={msg} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
