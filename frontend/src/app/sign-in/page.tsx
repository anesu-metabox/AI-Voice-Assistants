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

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "sign-up") {
      setMode("sign-up");
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const endpoint = mode === "sign-in" ? "sign-in/email" : "sign-up/email";
      const response = await fetch(`/api/auth/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ email, password, name: email.split("@")[0] }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message || payload.error || "Authentication failed."); }
      router.push("/"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Authentication failed."); }
    finally { setBusy(false); }
  }

  async function googleSignIn() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/sign-in/social", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ provider: "google", callbackURL: window.location.origin }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) throw new Error(payload.message || "Google sign-in is unavailable.");
      window.location.assign(payload.url);
    } catch (err) { setError(err instanceof Error ? err.message : "Google sign-in failed."); setBusy(false); }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#090d16" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420, padding: 32, borderRadius: 16, background: "#111827", color: "#f8fafc" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{mode === "sign-in" ? "Sign in" : "Create your account"}</h1>
        <p style={{ color: "#94a3b8", marginBottom: 24 }}>Your company workspace and assistant data are isolated to your authenticated session.</p>
        <label style={{ display: "block", marginBottom: 14 }}>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10, borderRadius: 8, color: "#0f172a" }} /></label>
        <label style={{ display: "block", marginBottom: 18 }}>Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10, borderRadius: 8, color: "#0f172a" }} /></label>
        {error && <p role="alert" style={{ color: "#fca5a5", marginBottom: 14 }}>{error}</p>}
        <button disabled={busy} type="submit" style={{ width: "100%", padding: 11, border: 0, borderRadius: 8, background: "#4f46e5", color: "white", fontWeight: 700 }}>{busy ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}</button>
        <button disabled={busy} type="button" onClick={googleSignIn} style={{ width: "100%", padding: 11, marginTop: 10, borderRadius: 8, background: "transparent", border: "1px solid #475569", color: "white" }}>Continue with Google</button>
        <button type="button" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")} style={{ width: "100%", marginTop: 18, background: "none", border: 0, color: "#93c5fd" }}>{mode === "sign-in" ? "Create an account" : "I already have an account"}</button>
      </form>
    </main>
  );
}
