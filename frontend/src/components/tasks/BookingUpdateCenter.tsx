"use client";

import { useEffect, useState } from "react";

type BookingNotice = {
  request_id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "needs_reconnect" | "cancelled";
  message?: string | null;
  result?: { start_time?: string; meet_link?: string } | null;
};

const statusText: Record<BookingNotice["status"], string> = {
  pending: "Waiting for calendar",
  running: "Checking and booking",
  completed: "Booking confirmed",
  failed: "Booking not completed",
  needs_reconnect: "Reconnect calendar",
  cancelled: "Request cancelled",
};

export function BookingUpdateCenter({ enabled }: { enabled: boolean }) {
  const [requests, setRequests] = useState<BookingNotice[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 4000;
    const refresh = async () => {
      let hasActiveRequest = false;
      try {
        const response = await fetch("/api/bookings", { credentials: "include", cache: "no-store" });
        if (response.ok) {
          const body = await response.json();
          const next = Array.isArray(body.requests) ? body.requests : [];
          hasActiveRequest = next.some((request: BookingNotice) => ["pending", "running", "needs_reconnect"].includes(request.status));
          if (!stopped) setRequests(next);
        }
      } catch {
        // Keep the last confirmed state visible if a status refresh is offline.
      }
      if (!stopped && hasActiveRequest) {
        timer = setTimeout(refresh, delay);
        delay = Math.min(delay * 2, 30000);
      }
    };
    const handleBookingCreated = () => { delay = 4000; void refresh(); };
    window.addEventListener("booking-request-created", handleBookingCreated);
    void refresh();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("booking-request-created", handleBookingCreated);
    };
  }, [enabled]);

  if (!enabled || requests.length === 0) return null;
  return (
    <aside
      aria-label="Calendar booking updates"
      className="fixed bottom-4 right-4 z-[80] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-slate-700 bg-slate-950/95 p-4 text-slate-100 shadow-2xl backdrop-blur"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Calendar booking updates</h2>
        <span className="text-[11px] text-slate-400">Recent requests</span>
      </div>
      <ul className="max-h-64 space-y-3 overflow-y-auto">
        {requests.slice(0, 8).map((request) => (
          <li key={request.request_id} className="border-t border-slate-800 pt-3 first:border-0 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <span className="truncate text-xs font-medium">{request.title}</span>
              <span className="shrink-0 text-[10px] text-sky-300">{statusText[request.status]}</span>
            </div>
            {request.message && <p className="mt-1 text-[11px] leading-4 text-slate-400">{request.message}</p>}
            {request.status === "completed" && request.result?.start_time && (
              <p className="mt-1 text-[11px] text-emerald-300">Confirmed for {new Date(request.result.start_time).toLocaleString()}</p>
            )}
            {request.status === "completed" && request.result?.meet_link && (
              <a className="mt-1 inline-block text-[11px] text-sky-300 underline" href={request.result.meet_link} target="_blank" rel="noreferrer">Open meeting link</a>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
