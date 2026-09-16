"use client";

import React from "react";
import { Layers } from "lucide-react";
import { TaskItem } from "@/lib/types";
import { TaskCard } from "./TaskCard";

interface TaskDeckProps {
  tasks: TaskItem[];
}

export const TaskDeck: React.FC<TaskDeckProps> = ({ tasks }) => {
  return (
    <div className="flex flex-col h-full rounded-2xl bg-slate-950/60 border border-slate-800/80 overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/80 bg-slate-900/40">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <Layers className="w-4 h-4 text-indigo-400" />
          <span>Execution Ledger (Dual-Speed)</span>
        </div>
        <span className="text-xs text-slate-500 font-mono">{tasks.length} tasks</span>
      </div>

      {/* Task List */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {tasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 text-sm">
            <p>No active tasks in ledger.</p>
            <p className="text-xs text-slate-600 mt-1">
              Tools and background jobs will appear here in real-time.
            </p>
          </div>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
};
