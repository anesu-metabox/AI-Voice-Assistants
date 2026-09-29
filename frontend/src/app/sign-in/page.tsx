"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    if (new URLSearchParams(window.location.search).get("mode") === "sign-up") {
      setMode("sign-up");
    }
    fetch("/api/auth/get-session", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        if (active && (payload?.user || payload?.session?.user)) {
          router.replace("/");
          router.refresh();
        }
      })
      .catch(() => { /* A transient session check must not block sign-in. */ })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const endpoint = mode === "sign-in" ? "sign-in/email" : "sign-up/email";
      const callbackURL = new URL("/", window.location.origin).toString();
      const response = await fetch(`/api/auth/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ email, password, name: email.split("@")[0], callbackURL }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message || payload.error || "Authentication failed."); }
      const sessionResponse = await fetch("/api/auth/get-session", { credentials: "include", cache: "no-store" });
      const sessionPayload = sessionResponse.ok ? await sessionResponse.json() : null;
      if (!sessionPayload?.user && !sessionPayload?.session?.user) {
        throw new Error("Sign-in completed but your session was not saved. Please retry; if this continues, contact support.");
      }
      router.replace("/"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Authentication failed."); }
    finally { setBusy(false); }
  }

  async function googleSignIn() {
    setBusy(true); setError("");
    try {
      const callbackURL = new URL("/", window.location.origin).toString();
      const response = await fetch("/api/auth/sign-in/social", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ provider: "google", callbackURL }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) throw new Error(payload.message || "Google sign-in is unavailable.");
      window.location.assign(payload.url);
    } catch (err) { setError(err instanceof Error ? err.message : "Google sign-in failed."); setBusy(false); }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#090d16] px-5 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(closest-side, #3B5BDB, transparent)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 h-[360px] w-[360px] rounded-full opacity-[0.14] blur-3xl"
        style={{ background: "radial-gradient(closest-side, #14B8A6, transparent)" }}
      />

      <form
        onSubmit={submit}
        className="relative w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#111726]/90 p-8 text-slate-100 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur"
      >
        <a href="/" className="mb-8 flex items-center gap-2 text-white no-underline">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#3B5BDB" />
            <path d="M10 22V10l12 6-12 6z" fill="white" />
          </svg>
          <span style={{ fontFamily: "Bricolage Grotesque" }} className="text-base font-bold">vocalist.ai</span>
        </a>

        <h1 className="mb-1.5 text-[26px] font-bold text-white">
          {mode === "sign-in" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mb-7 text-sm leading-relaxed text-slate-400">
          Your company workspace and assistant data are isolated to your authenticated session.
        </p>

        <label className="mb-4 block text-sm text-slate-300">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="mt-1.5 block w-full rounded-lg border border-white/10 bg-white px-3.5 py-2.5 text-sm text-[#0f172a] outline-none transition focus:border-[#3B5BDB] focus:ring-2 focus:ring-[#3B5BDB]/25"
          />
        </label>
        <label className="mb-5 block text-sm text-slate-300">
          Password
          <input
            required
            minLength={8}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            className="mt-1.5 block w-full rounded-lg border border-white/10 bg-white px-3.5 py-2.5 text-sm text-[#0f172a] outline-none transition focus:border-[#3B5BDB] focus:ring-2 focus:ring-[#3B5BDB]/25"
          />
        </label>

        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {checkingSession ? (
          <p role="status" className="text-sm text-slate-400">Checking your session…</p>
        ) : (
          <>
            <button
              disabled={busy}
              type="submit"
              className="w-full rounded-lg bg-[#3B5BDB] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(59,91,219,0.7)] transition hover:brightness-110 disabled:opacity-60"
            >
              {busy ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={googleSignIn}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-transparent py-3 text-sm font-medium text-white transition hover:bg-white/5 disabled:opacity-60"
            >
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4c-7.6 0-14.2 4.3-17.7 10.7z" />
                <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.1-5.1l-6.5-5.5C29.6 35.2 27 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.7 39.6 16.3 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.5 5.5C40.9 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z" />
              </svg>
              Continue with Google
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
              className="mt-5 w-full bg-transparent text-sm text-[#93c5fd] transition hover:text-[#bfdbfe]"
            >
              {mode === "sign-in" ? "Create an account" : "I already have an account"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
