"use client";

import React from "react";
import { CheckCircle2, Clock, AlertTriangle, XCircle, Key } from "lucide-react";
import { TaskItem, TaskStatus } from "@/lib/types";

export const TaskCard: React.FC<{ task: TaskItem }> = ({ task }) => {
  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> Completed
          </span>
        );
      case "running":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-500/15 text-sky-400 border border-sky-500/30 animate-pulse">
            <Clock className="w-3 h-3" /> Running
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3 h-3" /> Failed
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/15 text-slate-400 border border-slate-500/30">
            <XCircle className="w-3 h-3" /> Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Clock className="w-3 h-3" /> Pending
          </span>
        );
    }
  };

  return (
    <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-all text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-slate-200 truncate">{task.title}</span>
        {getStatusBadge(task.status)}
      </div>

      <div className="flex items-center justify-between text-slate-400 mb-2">
        <span className="font-mono text-[11px] text-indigo-400">tool: {task.toolName}</span>
        {task.executionTimeMs && (
          <span className="text-slate-500 font-mono">{task.executionTimeMs}ms</span>
        )}
      </div>

      {task.idempotencyKey && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono bg-slate-950 px-2 py-1 rounded border border-slate-800/80 mb-2 truncate">
          <Key className="w-3 h-3 text-amber-400/80 flex-shrink-0" />
          <span className="truncate">lock: {task.idempotencyKey}</span>
        </div>
      )}

      {task.output && (
        <div className="p-2 rounded bg-slate-950/80 border border-slate-800/60 font-mono text-[11px] text-emerald-300/90 truncate">
          {JSON.stringify(task.output)}
        </div>
      )}

      {task.errorMessage && (
        <div className="p-2 rounded bg-rose-950/40 border border-rose-900/60 text-rose-300 text-[11px]">
          {task.errorMessage}
        </div>
      )}
    </div>
  );
};
