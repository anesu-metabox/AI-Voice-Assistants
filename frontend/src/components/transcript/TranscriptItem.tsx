"use client";

import React from "react";
import { Bot, User, AlertCircle } from "lucide-react";
import { TranscriptMessage } from "@/lib/types";

export const TranscriptItem: React.FC<{ message: TranscriptMessage }> = ({ message }) => {
  const isUser = message.speaker === "user";

  return (
    <div className={`flex gap-3 text-sm ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar Icon */}
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
          isUser
            ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
            : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Message Bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? "bg-sky-500/15 border border-sky-500/25 text-sky-100 rounded-tr-none"
            : "bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none"
        }`}
      >
        <p className="leading-relaxed whitespace-pre-wrap">{message.text}</p>
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-slate-500">
          <span>{message.timestamp}</span>
          {message.isInterrupted && (
            <span className="flex items-center gap-1 text-amber-400/90 font-medium">
              <AlertCircle className="w-3 h-3" />
              Interrupted
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
