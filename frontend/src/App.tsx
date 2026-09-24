"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { TestingSandboxPage } from "./components/sandbox/TestingSandboxPage";
import { BookingUpdateCenter } from "./components/tasks/BookingUpdateCenter";
import type { CapabilityId } from "./lib/capabilityRegistry";
import { logSafeFailure } from "./lib/safeLogging";

type Page =
  | "landing"
  | "signup"
  | "onboarding-goals"
  | "onboarding-company"
  | "onboarding-ai"
  | "dashboard"
  | "calls"
  | "phone-numbers"
  | "integrations"
  | "company-setup"
  | "assistant-config"
  | "testing-sandbox";

const assetPathPrefix = "/assets";

// ─── Icons ────────────────────────────────────────────────────────────────────

function LogoIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#3B5BDB" />
      <path d="M10 22V10l12 6-12 6z" fill="white" />
    </svg>
  );
}

function IconDashboard({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <rect x="11" y="1" width="6" height="6" rx="1.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <rect x="1" y="11" width="6" height="6" rx="1.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
    </svg>
  );
}

function IconCalls({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3.5 3C3.5 2.72 3.72 2.5 4 2.5h2.5c.24 0 .45.17.49.4l.7 3.5c.04.2-.05.4-.22.52L6 8c.9 2 2.5 3.6 4.5 4.5l1.08-1.47c.12-.17.32-.26.52-.22l3.5.7c.23.04.4.25.4.49V14c0 .28-.22.5-.5.5A11.5 11.5 0 013.5 3z" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPhone({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="5" y="1.5" width="8" height="15" rx="2" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <circle cx="9" cy="13.5" r="1" fill={active ? "white" : "#8899BB"} />
    </svg>
  );
}

function IconIntegrations({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="4" cy="9" r="2.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <circle cx="14" cy="4" r="2.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <path d="M6.5 9h3m0 0l2.5-4m-2.5 4l2.5 4" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconCompany({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="7" width="14" height="9.5" rx="1" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <path d="M5.5 7V5a3.5 3.5 0 017 0v2" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <rect x="7.5" y="11" width="3" height="3" rx="0.5" fill={active ? "white" : "#8899BB"} />
    </svg>
  );
}

function IconAssistant({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <path d="M6 11.5c0-1.66 1.34-3 3-3s3 1.34 3 3" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="7" r="1.5" fill={active ? "white" : "#8899BB"} />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 8l3.5 3.5L13 5" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect x="10" y="3" width="8" height="14" rx="4" fill="white" />
      <path d="M6 15a8 8 0 0016 0" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 23v3" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L4 6v6c0 5.25 3.5 9.74 8 10.93C16.5 21.74 20 17.25 20 12V6l-8-4z" stroke="#22C55E" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ padding: "28px 20px", textAlign: "center", color: "#7A8BAD" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}

// ─── Layout: App Shell ────────────────────────────────────────────────────────

function Sidebar({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const navItems: { id: Page; label: string; icon: (a: boolean) => ReactNode }[] = [
    { id: "dashboard", label: "Dashboard", icon: (a) => <IconDashboard active={a} /> },
    { id: "calls", label: "Calls Stream", icon: (a) => <IconCalls active={a} /> },
    { id: "phone-numbers", label: "Phone Numbers", icon: (a) => <IconPhone active={a} /> },
    { id: "integrations", label: "Integrations", icon: (a) => <IconIntegrations active={a} /> },
    { id: "company-setup", label: "Company Setup", icon: (a) => <IconCompany active={a} /> },
    { id: "assistant-config", label: "AI Assistant", icon: (a) => <IconAssistant active={a} /> },
  ];

  return (
    <aside
      style={{
        width: 184,
        minHeight: "100vh",
        background: "#0D1526",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: "20px 18px 24px", display: "flex", alignItems: "center", gap: 10 }}>
        <LogoIcon />
        <span style={{ color: "white", fontFamily: "Bricolage Grotesque", fontWeight: 700, fontSize: 16 }}>
          vocalist.ai
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "0 10px" }}>
        {navItems.map((item) => {
          const active = page === item.id || (item.id === "assistant-config" && page === "testing-sandbox");
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                marginBottom: 2,
                borderRadius: 8,
                background: active ? "rgba(59,91,219,0.25)" : "transparent",
                border: "none",
                cursor: "pointer",
                color: active ? "white" : "#7A8BAD",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                fontFamily: "Inter",
                textAlign: "left",
                transition: "background 0.15s",
              }}
            >
              {item.icon(active)}
              <span style={{ flex: 1 }}>{item.label}</span>
              {active && (
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#3B5BDB" }} />
              )}
            </button>
          );
        })}
      </nav>

      <AccountFooter />
    </aside>
  );
}

function AccountFooter() {
  const [account, setAccount] = useState<{ name?: string; email?: string } | null>(null);
  const [signOutError, setSignOutError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/get-session", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        const user = payload?.user || payload?.session?.user;
        if (active && user) {
          setAccount({
            name: typeof user.name === "string" ? user.name : undefined,
            email: typeof user.email === "string" ? user.email : undefined,
          });
        }
      })
      .catch(() => { if (active) setAccount(null); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    setBusy(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Sign-out failed");
      window.location.assign("/sign-in");
    } catch {
      setSignOutError(true);
      setBusy(false);
    }
  }

  const accountLabel = account?.name || account?.email || "Account unavailable";
  const initial = (account?.name || account?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div style={{ padding: "14px 12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div aria-hidden="true" style={{ width: 32, height: 32, borderRadius: "50%", background: "#3B5BDB", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 13, fontWeight: 700, fontFamily: "Inter", flexShrink: 0 }}>
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={accountLabel} style={{ color: "white", fontSize: 12, fontWeight: 600, fontFamily: "Inter", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {accountLabel}
          </div>
          <div title={account?.email} style={{ color: "#7A8BAD", fontSize: 11, fontFamily: "Inter", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {account?.email || "Email unavailable"}
          </div>
        </div>
      </div>
      <button type="button" onClick={signOut} disabled={busy} style={{ marginTop: 10, width: "100%", padding: "6px 8px", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, background: "transparent", color: "#CBD5E1", fontSize: 11, textAlign: "left", cursor: busy ? "default" : "pointer", opacity: busy ? 0.65 : 1 }}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {signOutError && <div role="alert" style={{ color: "#FCA5A5", fontSize: 11, marginTop: 6 }}>Could not sign out. Retry.</div>}
    </div>
  );
}

function AppHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header
      style={{
        height: 64,
        borderBottom: "1px solid #E8ECF4",
        padding: "0 28px",
        display: "flex",
        alignItems: "center",
        background: "white",
      }}
    >
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "#7A8BAD", fontFamily: "Inter", marginTop: 1 }}>{subtitle}</div>
      </div>
    </header>
  );
}

function AppShell({ page, setPage, children, title, subtitle }: {
  page: Page;
  setPage: (p: Page) => void;
  children: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F0F3FA" }}>
      <Sidebar page={page} setPage={setPage} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppHeader title={title} subtitle={subtitle} />
        <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <div style={{ minHeight: "100vh", background: "white", fontFamily: "Inter" }}>
      {/* Nav */}
      <nav
        style={{
          height: 60,
          borderBottom: "1px solid #E8ECF4",
          display: "flex",
          alignItems: "center",
          padding: "0 40px",
          gap: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 16 }}>
          <LogoIcon />
          <span style={{ fontFamily: "Bricolage Grotesque", fontWeight: 700, fontSize: 16, color: "#0D1526" }}>
            vocalist.ai
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <span onClick={() => window.location.assign("/sign-in")} style={{ fontSize: 14, color: "#4B5563", cursor: "pointer" }}>Sign In</span>
        <button
          onClick={() => window.location.assign("/sign-in")}
          style={{
            background: "#3B5BDB",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "8px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "Inter",
          }}
        >
          Get Started
        </button>
      </nav>

      {/* Hero */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "80px 24px 40px", textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "#EEF2FF",
            color: "#3B5BDB",
            fontSize: 11,
            fontWeight: 600,
            padding: "5px 14px",
            borderRadius: 100,
            marginBottom: 32,
            letterSpacing: "0.08em",
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#3B5BDB" }} />
          COMPANY-SPECIFIC VOICE ASSISTANTS
        </div>
        <h1
          style={{
            fontFamily: "Bricolage Grotesque",
            fontWeight: 800,
            fontSize: "clamp(36px, 6vw, 64px)",
            lineHeight: 1.1,
            color: "#0D1526",
            margin: "0 0 24px",
          }}
        >
          A Voice Assistant<br />Configured for Your<br />Company
        </h1>
        <p style={{ fontSize: 16, color: "#4B5563", lineHeight: 1.7, marginBottom: 36, maxWidth: 560, margin: "0 auto 36px" }}>
          Connect your company&apos;s Google Calendar and configure an assistant for availability,
          event listing, booking, and cancellation. Your company profile and integration settings
          stay scoped to your account.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => window.location.assign("/sign-in")}
            style={{
              background: "#3B5BDB",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "12px 28px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "Inter",
            }}
          >
            Configure Your Assistant
          </button>
        </div>
      </div>

      {/* Real session entry point — never render simulated call telemetry. */}
      <section aria-labelledby="real-session-title" style={{ maxWidth: 900, margin: "48px auto", padding: "0 24px" }}>
        <div style={{ background: "#F9FAFB", border: "1px solid #E8ECF4", borderRadius: 16, padding: 28, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 28, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#3B5BDB", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Real session testing
            </div>
            <h2 id="real-session-title" style={{ fontFamily: "Bricolage Grotesque", fontSize: 22, color: "#0D1526", margin: "0 0 8px" }}>
              Test your company-configured assistant
            </h2>
            <p style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6, margin: "0 0 18px" }}>
              Sign in, connect your company&apos;s Google Calendar, and launch a real LiveKit session. This public page never fabricates call status, audio, transcripts, or tool activity.
            </p>
            <button
              onClick={() => window.location.assign("/sign-in")}
              style={{ background: "#3B5BDB", color: "white", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Inter" }}
            >
              Sign in to test
            </button>
          </div>
          <div style={{ background: "white", border: "1px solid #E8ECF4", borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0D1526", marginBottom: 12 }}>Calendar capabilities</div>
            {["Check availability", "List events", "Book events", "Cancel events"].map((capability) => (
              <div key={capability} style={{ padding: "9px 0", borderTop: "1px solid #F1F3F8", fontSize: 13, color: "#4B5563" }}>
                {capability}
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* Footer */}
      <footer style={{ borderTop: "1px solid #E8ECF4", padding: "40px 40px 32px", display: "flex", flexWrap: "wrap", gap: 40 }}>
        <div style={{ flex: "1 1 200px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <LogoIcon />
            <span style={{ fontFamily: "Bricolage Grotesque", fontWeight: 700, fontSize: 15, color: "#0D1526" }}>vocalist.ai</span>
          </div>
          <div style={{ fontSize: 12, color: "#7A8BAD", lineHeight: 1.7 }}>
            Company-configured voice assistants<br />with tenant-scoped settings and<br />Google Calendar integration.
          </div>
        </div>
        <div style={{ flex: "0 0 auto", maxWidth: 340, fontSize: 13, color: "#7A8BAD", lineHeight: 1.6 }}>
          Voice routing through 3CX is still being validated and is not presented as an active
          calling service. Configure company integrations from your account.
        </div>
      </footer>
    </div>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function OnboardingShell({
  step,
  children,
}: {
  step: 2 | 3;
  children: React.ReactNode;
}) {
  const steps = ["Account Setup", "Company Details", "AI Configuration"];
  return (
    <div style={{ minHeight: "100vh", background: "#F5F7FA", fontFamily: "Inter" }}>
      {/* Top bar */}
      <div
        style={{
          height: 56,
          background: "white",
          borderBottom: "1px solid #E8ECF4",
          display: "flex",
          alignItems: "center",
          padding: "0 32px",
          gap: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 48 }}>
          <LogoIcon />
          <span style={{ fontFamily: "Bricolage Grotesque", fontWeight: 700, fontSize: 15, color: "#0D1526" }}>vocalist.ai</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 36 }}>
          {steps.map((s, i) => {
            const n = i + 1;
            const done = n < step;
            const active = n === step;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: done ? "#22C55E" : active ? "#3B5BDB" : "transparent",
                    border: done || active ? "none" : "1.5px solid #D1D5DB",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: done || active ? "white" : "#9CA3AF",
                  }}
                >
                  {done ? "✓" : n}
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: active ? 700 : 400,
                    color: active ? "#0D1526" : done ? "#6B7280" : "#9CA3AF",
                  }}
                >
                  {s}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "#7A8BAD" }}>Support: support@vocalist.ai</div>
      </div>
      <div style={{ padding: "48px 24px" }}>{children}</div>
    </div>
  );
}

function DashboardPage({ setPage }: { setPage: (p: Page) => void }) {
  const stats: Array<{ label: string; value: string; sub: string; subColor: string }> = [];
  const barData: number[] = [];
  const assistants: Array<{ name: string; calls: string; status: string; statusColor: string }> = [];

  return (
    <AppShell
      page="dashboard"
      setPage={setPage}
      title="Company Dashboard"
      subtitle="Your company profile, configured integrations, and verified voice-session activity."
    >
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        {stats.length ? stats.map((s) => (
          <div key={s.label} style={{ background: "white", borderRadius: 12, padding: "18px 20px", border: "1px solid #E8ECF4" }}>
            <div style={{ fontSize: 12, color: "#7A8BAD", marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: s.subColor, fontWeight: 500 }}>{s.sub}</div>
          </div>
        )) : <div style={{ gridColumn: "1 / -1", background: "white", borderRadius: 12, border: "1px solid #E8ECF4" }}><EmptyState title="No dashboard metrics yet" text="Metrics will appear after your authenticated assistant handles real sessions." /></div>}
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        {/* Bar chart */}
        <div style={{ background: "white", borderRadius: 12, padding: "20px 24px", border: "1px solid #E8ECF4" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>
              Voice Session Activity
            </div>
            <div style={{ fontSize: 12, color: "#7A8BAD", border: "1px solid #E8ECF4", borderRadius: 6, padding: "4px 10px" }}>Last 7 Days</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, marginBottom: 8 }}>
            {barData.length ? barData.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div
                  style={{
                    width: "100%",
                    height: `${(v / 100) * 100}px`,
                    borderRadius: "3px 3px 0 0",
                    background: i === 8 ? "#3B5BDB" : "rgba(59,91,219,0.15)",
                  }}
                />
              </div>
            )) : <EmptyState title="No call volume data" text="Connect the required voice and telephony services to begin collecting data." />}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {barData.map((_, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "#9CA3AF" }}>D{i + 1}</div>
            ))}
          </div>
        </div>

        {/* Assistant status */}
        <div style={{ background: "white", borderRadius: 12, padding: "20px 24px", border: "1px solid #E8ECF4" }}>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 16 }}>
            Voice Assistant Status
          </div>
          {assistants.length ? assistants.map((a) => (
            <div
              key={a.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 0",
                borderBottom: "1px solid #F3F4F6",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0D1526", marginBottom: 2 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>{a.calls}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: a.statusColor, fontWeight: 500 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: a.statusColor }} />
                {a.status}
              </div>
            </div>
          )) : <EmptyState title="No assistants configured" text="Complete onboarding to publish a company-specific assistant." />}
        </div>
      </div>
    </AppShell>
  );
}

// ─── Calls Stream ─────────────────────────────────────────────────────────────

function CallsPage({ setPage }: { setPage: (p: Page) => void }) {
  const [selectedCall, setSelectedCall] = useState(0);
  const [calls, setCalls] = useState<Array<{
    did: string;
    direction: "inbound" | "outbound";
    state: string;
    createdAt: string;
    updatedAt: string;
    endedAt: string | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/integrations/3cx/calls?limit=50", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Call history could not be loaded");
        const payload = await response.json();
        if (active) setCalls(Array.isArray(payload.calls) ? payload.calls : []);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const selected = calls[selectedCall];

  return (
    <AppShell
      page="calls"
      setPage={setPage}
      title="Call History"
      subtitle="Review 3CX session metadata. Caller identity, transcripts, and call analytics are not stored or displayed."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "flex-start" }}>
        <div>
          {/* Table */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E8ECF4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>Company call records</div>
              <div style={{ fontSize: 12, color: "#7A8BAD" }}>{loading ? "Loading…" : loadError ? "Unavailable" : `${calls.length} sessions`}</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {["Date / Time", "Configured DID", "Direction", "Duration", "State"].map((h) => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", fontFamily: "Inter", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calls.length ? calls.map((c, i) => (
                  <tr
                    key={i}
                    onClick={() => setSelectedCall(i)}
                    style={{
                      borderTop: "1px solid #F3F4F6",
                      cursor: "pointer",
                      background: selectedCall === i ? "#F5F7FF" : "white",
                    }}
                  >
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151", whiteSpace: "nowrap" }}>{new Date(c.createdAt).toLocaleString()}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#0D1526", whiteSpace: "pre" }}>{c.did}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{c.direction}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{c.endedAt ? `${Math.max(0, Math.round((Date.parse(c.endedAt) - Date.parse(c.createdAt)) / 1000))} sec` : "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: c.state === "ended" ? "#15803D" : c.state === "failed" ? "#B91C1C" : "#475569",
                          background: c.state === "ended" ? "#F0FDF4" : c.state === "failed" ? "#FEF2F2" : "#F1F5F9",
                          borderRadius: 6,
                          padding: "3px 10px",
                        }}
                      >
                        {c.state}
                      </span>
                    </td>
                  </tr>
                )) : <tr><td colSpan={5}><EmptyState title={loading ? "Loading call sessions" : loadError ? "Call history unavailable" : "No call sessions recorded"} text={loadError ? "Confirm your sign-in and retry. Call history is loaded only from your company’s protected 3CX session ledger." : "Call sessions will appear here after the 3CX event adapter is connected. No sample records are displayed."} /></td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Call detail */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 4 }}>
            Call details
          </div>
          <div style={{ fontSize: 12, color: "#7A8BAD", marginBottom: 20 }}>
            {selected ? `${selected.direction} 3CX session · ${selected.state}` : "Select a session to inspect its safe metadata."}
          </div>
          {selected ? (
            <dl style={{ margin: 0, fontSize: 13 }}>
              <dt style={{ color: "#64748B", marginTop: 14 }}>Configured DID</dt><dd style={{ margin: "3px 0 0", color: "#0D1526" }}>{selected.did}</dd>
              <dt style={{ color: "#64748B", marginTop: 14 }}>Started</dt><dd style={{ margin: "3px 0 0", color: "#0D1526" }}>{new Date(selected.createdAt).toLocaleString()}</dd>
              <dt style={{ color: "#64748B", marginTop: 14 }}>Last updated</dt><dd style={{ margin: "3px 0 0", color: "#0D1526" }}>{new Date(selected.updatedAt).toLocaleString()}</dd>
              <dt style={{ color: "#64748B", marginTop: 14 }}>Transcript</dt><dd style={{ margin: "3px 0 0", color: "#64748B" }}>Not stored</dd>
            </dl>
          ) : <EmptyState title="No session selected" text="Caller IDs, PBX call identifiers, LiveKit rooms, claim tokens, and transcripts are not exposed in this view." />}
        </div>
      </div>
    </AppShell>
  );
}

// ─── Phone Numbers ────────────────────────────────────────────────────────────

function PhoneNumbersPage({ setPage }: { setPage: (p: Page) => void }) {
  const [integration, setIntegration] = useState<{
    configured: boolean;
    connectionName?: string;
    pbxHost?: string;
    routePointDn?: string;
    dids?: string[];
    state?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/integrations/3cx", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the 3CX configuration");
        const payload = await response.json();
        if (active) setIntegration(payload);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <AppShell
      page="phone-numbers"
      setPage={setPage}
      title="3CX Phone Setup"
      subtitle="Review the phone numbers and route point saved for your company’s 3CX connection."
    >
      <section style={{ maxWidth: 1000, background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0D1526", margin: "0 0 6px" }}>
              {loading ? "Loading your 3CX setup…" : loadError ? "Could not load your 3CX setup" : integration?.configured ? integration.connectionName || "3CX connection" : "No 3CX connection configured"}
            </h2>
            <p style={{ margin: 0, color: "#64748B", fontSize: 13 }}>
          {loadError ? "Sign in and try again to view your company’s integration." : integration?.configured ? `${integration.pbxHost || "PBX host unavailable"} · ${integration.state || "status unavailable"}` : "Add your company’s 3CX details from Integrations to list its configured DIDs."}
            </p>
          </div>
          <button onClick={() => setPage("integrations")} style={{ background: "#3B5BDB", color: "white", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Inter" }}>
            Manage Integrations
          </button>
        </div>

        {integration?.configured && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 14, background: "#F8FAFC", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>ROUTE POINT</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0D1526" }}>{integration.routePointDn || "Not set"}</div>
              </div>
              <div style={{ padding: 14, background: "#F8FAFC", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>CONFIGURED DIDs</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0D1526" }}>{integration.dids?.length || 0}</div>
              </div>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0D1526", margin: "0 0 10px" }}>Company phone numbers</h3>
            {loading ? <p style={{ color: "#64748B", fontSize: 13 }}>Loading…</p> : integration.dids?.length ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {integration.dids.map((did) => <li key={did} style={{ padding: "12px 0", borderTop: "1px solid #E8ECF4", fontSize: 14, color: "#0D1526" }}>{did}</li>)}
              </ul>
            ) : <EmptyState title="No DIDs configured" text="Add the phone numbers assigned to this PBX in the 3CX integration settings." />}
          </>
        )}

        <div role="note" style={{ marginTop: 20, padding: 14, borderRadius: 8, background: "#FFF7ED", border: "1px solid #FED7AA", color: "#9A3412", fontSize: 13, lineHeight: 1.6 }}>
          This page reflects saved 3CX settings only. Live inbound/outbound calling and carrier number purchasing are not enabled yet.
        </div>
      </section>
    </AppShell>
  );
}

function AuthRedirect() {
  useEffect(() => {
    window.location.assign("/sign-in?mode=sign-up");
  }, []);
  return <main role="status" style={{ padding: 32 }}>Opening secure account setup…</main>;
}

// ─── Integrations ─────────────────────────────────────────────────────────────

function GoogleCalendarIntegrationCard() {
  const [connected, setConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/auth/google/status", { credentials: "include", cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setConnected(!!data.connected);
        setConnectedEmail(data.email || data.google_email || null);
      } else {
        setConnected(false);
        setConnectedEmail(null);
      }
    } catch {
      setConnected(false);
      setConnectedEmail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === "GOOGLE_AUTH_SUCCESS") {
        checkStatus();
      }
    };
    window.addEventListener("message", handleMsg);
    return () => window.removeEventListener("message", handleMsg);
  }, [checkStatus]);

  const handleConnect = async () => {
    setBusy(true);
    const width = 520;
    const height = 650;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      "",
      "GoogleOAuth",
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );
    try {
      const res = await fetch("/auth/google/url", { cache: "no-store", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.auth_url && popup) {
          popup.location.href = data.auth_url;
        } else if (popup) {
          popup.location.href = "/auth/google/login";
        }
      } else if (popup) {
        popup.location.href = "/auth/google/login";
      }
    } catch {
      if (popup) popup.location.href = "/auth/google/login";
    }
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setBusy(false);
        checkStatus();
      }
    }, 1000);
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await fetch("/auth/google/disconnect", { method: "POST", credentials: "include" });
      await checkStatus();
    } catch (err) {
      logSafeFailure("Dashboard action failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📅</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: connected ? "#22C55E" : "#6B7280", fontWeight: 500 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "#22C55E" : "#9CA3AF" }} />
          {loading ? "Checking..." : connected ? "Connected" : "Not Connected"}
        </div>
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 8 }}>
        Google Calendar Sync
      </div>
      <p style={{ fontSize: 13, color: "#7A8BAD", lineHeight: 1.6, marginBottom: 16 }}>
        Connect this company&apos;s Google account so the assistant can check availability, list events, book meetings, and cancel them with confirmation.
      </p>
      <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 14 }}>
        {[
          { label: "Connected account", value: connectedEmail || "No Google account connected" },
          { label: "Calendar", value: "Primary Google Calendar" },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: "#374151" }}>{row.label}</span>
            <span style={{ fontSize: 13, color: "#7A8BAD" }}>{row.value}</span>
          </div>
        ))}
      </div>
      {connected ? (
        <button
          onClick={handleDisconnect}
          disabled={busy}
          style={{ width: "100%", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, color: "#EF4444", background: "white", cursor: "pointer", fontFamily: "Inter", marginTop: 4, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Disconnecting..." : "Disconnect Google Calendar"}
        </button>
      ) : (
        <button
          onClick={handleConnect}
          disabled={busy}
          style={{ width: "100%", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, color: "white", background: "#3B5BDB", cursor: "pointer", fontFamily: "Inter", marginTop: 4, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Connecting..." : "Connect Google Calendar"}
        </button>
      )}
    </div>
  );
}

function ThreeCXIntegrationCard() {
  const [connectionName, setConnectionName] = useState("");
  const [pbxUrl, setPbxUrl] = useState("");
  const [appId, setAppId] = useState("");
  const [routePointDn, setRoutePointDn] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [dids, setDids] = useState("");
  const [transferDestinations, setTransferDestinations] = useState("");
  const [failureAction, setFailureAction] = useState<"" | "disconnect" | "transfer">("");
  const [failureDestination, setFailureDestination] = useState("");
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/integrations/3cx", { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the 3CX connection details");
    const data = await response.json();
    setStatus(data);
    setConnectionName(data.connectionName || "");
    setPbxUrl(data.pbxHost ? `https://${data.pbxHost}` : "");
    setAppId(data.appId || "");
    setRoutePointDn(data.routePointDn || "");
    setDids(Array.isArray(data.dids) ? data.dids.join(", ") : "");
    setTransferDestinations(Array.isArray(data.transferDestinations) ? data.transferDestinations.join(", ") : "");
    setFailureAction(data.failureAction === "disconnect" || data.failureAction === "transfer" ? data.failureAction : "");
    setFailureDestination(data.failureDestination || "");
    setClientSecret("");
  }, []);

  useEffect(() => { loadStatus().catch(() => setStatus({ configured: false, error: "Could not load the 3CX connection details" })); }, [loadStatus]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        connection_name: connectionName,
        pbx_url: pbxUrl,
        app_id: appId,
        route_point_dn: routePointDn,
        client_secret: clientSecret,
        dids: dids.split(",").map((value) => value.trim()).filter(Boolean),
        transfer_destinations: transferDestinations.split(",").map((value) => value.trim()).filter(Boolean),
        failure_action: failureAction,
        failure_destination: failureAction === "transfer" ? failureDestination : null,
      };
      const response = await fetch("/api/integrations/3cx", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (failure?.error_code === "RECENT_AUTHENTICATION_REQUIRED") {
          throw new Error("For security, sign out and sign in again before testing or saving 3CX credentials.");
        }
        if (response.status === 429) throw new Error("Too many 3CX setup attempts. Wait before trying again.");
        throw new Error(failure?.detail || failure?.error_message || "3CX connection test and save failed");
      }
      setClientSecret("");
      await loadStatus();
    } catch (error) {
      setStatus((current: any) => ({ ...(current || {}), error: error instanceof Error ? error.message : "3CX connection failed" }));
    } finally {
      setClientSecret("");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!status?.configured || !window.confirm("Disconnect this company's 3CX integration and remove its stored API key?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/integrations/3cx", { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (failure?.error_code === "RECENT_AUTHENTICATION_REQUIRED") {
          throw new Error("For security, sign out and sign in again before disconnecting 3CX.");
        }
        throw new Error(failure?.detail || failure?.error_message || "3CX could not be disconnected");
      }
      setStatus({ configured: false, state: "unconfigured" });
      setConnectionName("");
      setPbxUrl("");
      setAppId("");
      setRoutePointDn("");
      setDids("");
      setTransferDestinations("");
      setFailureAction("");
      setFailureDestination("");
      setClientSecret("");
    } catch (error) {
      setStatus((current: any) => ({ ...(current || {}), error: error instanceof Error ? error.message : "3CX could not be disconnected" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 24, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>3CX PBX</div>
          <p style={{ fontSize: 13, color: "#7A8BAD", margin: "6px 0 0" }}>Store and validate this company’s own 3CX connection. Live call routing is still being implemented.</p>
        </div>
        <span style={{ fontSize: 12, color: status?.state === "active" ? "#16A34A" : "#6B7280" }}>{status?.state || "Not configured"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[{ label: "Connection name", value: connectionName, set: setConnectionName, secret: false }, { label: "PBX HTTPS URL", value: pbxUrl, set: setPbxUrl, secret: false }, { label: "3CX Service Principal client ID", value: appId, set: setAppId, secret: false }, { label: "Programmable Extension / Route Point DN", value: routePointDn, set: setRoutePointDn, secret: false }, { label: "3CX client secret (write-only)", value: clientSecret, set: setClientSecret, secret: true }, { label: "Inbound DIDs (comma-separated)", value: dids, set: setDids, secret: false }, { label: "Transfer destinations (comma-separated)", value: transferDestinations, set: setTransferDestinations, secret: false }].map((field) => (
          <label key={field.label} style={{ fontSize: 12, color: "#374151" }}>
            {field.label}
            <input value={field.value} onChange={(event) => field.set(event.target.value)} type={field.secret ? "password" : "text"} autoComplete={field.secret ? "new-password" : "off"} spellCheck={false} style={{ width: "100%", marginTop: 5, border: "1px solid #D1D5DB", borderRadius: 7, padding: "8px 10px", fontSize: 13 }} />
          </label>
        ))}
      </div>
      <label style={{ display: "block", marginTop: 12, fontSize: 12, color: "#374151" }}>
        If the assistant cannot handle a live call
        <select value={failureAction} onChange={(event) => { const value = event.target.value as "" | "disconnect" | "transfer"; setFailureAction(value); if (value !== "transfer") setFailureDestination(""); }} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid #D1D5DB", borderRadius: 7, padding: "8px 10px", fontSize: 13 }}>
          <option value="">Choose an explicit fallback</option>
          <option value="disconnect">Disconnect the caller</option>
          <option value="transfer">Transfer to an approved destination</option>
        </select>
      </label>
      {failureAction === "transfer" && (
        <label style={{ display: "block", marginTop: 10, fontSize: 12, color: "#374151" }}>
          Approved fallback destination
          <select value={failureDestination} onChange={(event) => setFailureDestination(event.target.value)} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid #D1D5DB", borderRadius: 7, padding: "8px 10px", fontSize: 13 }}>
            <option value="">Choose a configured transfer destination</option>
            {transferDestinations.split(",").map((value) => value.trim()).filter(Boolean).map((destination) => <option key={destination} value={destination}>{destination}</option>)}
          </select>
          <span style={{ display: "block", marginTop: 4, color: "#7A8BAD" }}>The fallback must also appear in the approved transfer destinations above.</span>
        </label>
      )}
      {status?.error && <div style={{ color: "#DC2626", fontSize: 12, marginTop: 10 }}>{status.error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <span style={{ color: "#7A8BAD", fontSize: 12 }}>Re-authenticate before changes. The client ID and Route Point DN are separate; the client secret is write-only and cleared after submission.</span>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {status?.configured && <button type="button" onClick={disconnect} disabled={busy} style={{ background: "white", color: "#B91C1C", border: "1px solid #FCA5A5", borderRadius: 7, padding: "9px 12px", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>{busy ? "Working…" : "Disconnect"}</button>}
          <button onClick={save} disabled={busy || !clientSecret || !appId || !pbxUrl || !routePointDn || !failureAction || (failureAction === "transfer" && (!failureDestination || !transferDestinations.split(",").map((value) => value.trim()).includes(failureDestination)))} style={{ background: "#3B5BDB", color: "white", border: 0, borderRadius: 7, padding: "9px 16px", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>{busy ? "Testing & saving..." : "Test & save 3CX"}</button>
        </div>
      </div>
    </div>
  );
}

type OnboardingCompanyDraft = {
  company_name: string;
  website_url: string;
  company_phone: string;
  support_email: string;
  timezone: string;
};

type OnboardingAssistantDraft = {
  assistant_name: string;
  voice_engine: string;
  inbound_greeting: string;
  system_prompt: string;
  knowledge_base_notes: string;
  tone: "professional" | "friendly" | "warm" | "concise";
  business_hours: Record<string, string>;
  escalation_rules: string[];
  faq_entries: FAQEntry[];
  capabilities: CapabilityFlags;
};

type FAQEntry = { question: string; answer: string };
const BUSINESS_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const EMPTY_ASSISTANT_DRAFT: OnboardingAssistantDraft = {
  assistant_name: "", voice_engine: "Aoede", inbound_greeting: "", system_prompt: "",
  knowledge_base_notes: "", tone: "friendly", business_hours: {}, escalation_rules: [],
  faq_entries: [], capabilities: { company_receptionist: false, company_faq: false, google_calendar: true },
};

const inputStyle = {
  width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8,
  padding: "10px 12px", fontSize: 14, fontFamily: "Inter",
  outline: "none", color: "#0D1526",
} as const;

type CapabilityFlags = Pick<Record<CapabilityId, boolean>, "company_receptionist" | "company_faq" | "google_calendar">;
const DEFAULT_CAPABILITY_FLAGS: CapabilityFlags = {
  company_receptionist: false,
  company_faq: false,
  google_calendar: true,
};

function readCapabilityFlags(raw: unknown): CapabilityFlags {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CAPABILITY_FLAGS };
  const values = raw as Record<string, unknown>;
  const enabled = (key: keyof CapabilityFlags) => {
    const value = values[key];
    if (value && typeof value === "object" && "enabled" in value) {
      return Boolean((value as { enabled?: unknown }).enabled);
    }
    return typeof value === "boolean" ? value : DEFAULT_CAPABILITY_FLAGS[key];
  };
  return {
    company_receptionist: enabled("company_receptionist"),
    company_faq: enabled("company_faq"),
    google_calendar: enabled("google_calendar"),
  };
}

function writeCapabilityFlags(flags: CapabilityFlags) {
  return Object.fromEntries(
    Object.entries(flags).map(([name, enabled]) => [name, { enabled }]),
  );
}

function CapabilityChoices({
  value,
  onChange,
}: {
  value: CapabilityFlags;
  onChange: (key: keyof CapabilityFlags, enabled: boolean) => void;
}) {
  const options: { id: keyof CapabilityFlags; label: string; description: string }[] = [
    { id: "company_receptionist", label: "Company receptionist", description: "Greet callers and guide company-related requests using your approved profile." },
    { id: "company_faq", label: "Company FAQs", description: "Answer company questions only from your profile and approved reference notes." },
    { id: "google_calendar", label: "Google Calendar", description: "Check availability, list events, book, and cancel with confirmation." },
  ];
  return <div style={{ border: "1px solid #E2E8F0", borderRadius: 9, padding: 14, marginBottom: 18, background: "#FAFBFF" }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", marginBottom: 9 }}>Enabled company capabilities</div>
    {options.map((option) => <label key={option.id} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "7px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={value[option.id]} onChange={(event) => onChange(option.id, event.target.checked)} style={{ marginTop: 2 }} />
      <span><span style={{ display: "block", fontSize: 13, color: "#334155", fontWeight: 600 }}>{option.label}</span><span style={{ display: "block", fontSize: 11, color: "#64748B", lineHeight: 1.45 }}>{option.description}</span></span>
    </label>)}
    <div style={{ fontSize: 11, color: "#64748B", marginTop: 5 }}>Lead qualification and live 3CX call transfer are not available yet. The model cannot enable tools by itself.</div>
  </div>;
}

function CompanyOperatingFields({
  tone, onToneChange, businessHours, onBusinessHoursChange,
  escalationRules, onEscalationRulesChange, faqEntries, onFaqEntriesChange, showFaq,
}: {
  tone: OnboardingAssistantDraft["tone"];
  onToneChange: (tone: OnboardingAssistantDraft["tone"]) => void;
  businessHours: Record<string, string>;
  onBusinessHoursChange: (hours: Record<string, string>) => void;
  escalationRules: string[];
  onEscalationRulesChange: (rules: string[]) => void;
  faqEntries: FAQEntry[];
  onFaqEntriesChange: (entries: FAQEntry[]) => void;
  showFaq: boolean;
}) {
  return <section aria-label="Company operating profile" style={{ borderTop: "1px solid #E2E8F0", paddingTop: 18, marginTop: 18, marginBottom: 18 }}>
    <h4 style={{ margin: "0 0 5px", fontSize: 14, color: "#1E293B" }}>Company operating profile</h4>
    <p style={{ margin: "0 0 14px", fontSize: 11, color: "#64748B" }}>These company facts and preferences are tenant data. They cannot grant tools or override platform safeguards.</p>
    <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Response tone<select value={tone} onChange={(event) => onToneChange(event.target.value as OnboardingAssistantDraft["tone"])} style={inputStyle}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="warm">Warm</option><option value="concise">Concise</option></select></label>
    <fieldset style={{ border: 0, padding: 0, margin: "0 0 14px" }}><legend style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>Business hours (company timezone)</legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>{BUSINESS_DAYS.map((day) => <label key={day} style={{ fontSize: 11, color: "#64748B", textTransform: "capitalize" }}>{day}<input value={businessHours[day] || ""} onChange={(event) => onBusinessHoursChange({ ...businessHours, [day]: event.target.value })} placeholder="Closed or 09:00–17:00" style={{ ...inputStyle, marginTop: 3 }} /></label>)}</div>
    </fieldset>
    <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Escalation guidance<textarea rows={3} value={escalationRules.join("\n")} onChange={(event) => onEscalationRulesChange(event.target.value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 10))} placeholder="One company-specific escalation preference per line" style={{ ...inputStyle, resize: "vertical" }} /><span style={{ display: "block", fontSize: 11, color: "#64748B" }}>Guidance only; automated transfer is not available yet.</span></label>
    {showFaq && <div style={{ marginTop: 14 }}><div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>Approved FAQs</div>
      {faqEntries.map((entry, index) => <div key={index} style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: 10, marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 11, color: "#64748B" }}>Question<input maxLength={240} value={entry.question} onChange={(event) => onFaqEntriesChange(faqEntries.map((item, i) => i === index ? { ...item, question: event.target.value } : item))} style={{ ...inputStyle, margin: "3px 0 8px" }} /></label>
        <label style={{ display: "block", fontSize: 11, color: "#64748B" }}>Approved answer<textarea maxLength={1200} rows={2} value={entry.answer} onChange={(event) => onFaqEntriesChange(faqEntries.map((item, i) => i === index ? { ...item, answer: event.target.value } : item))} style={{ ...inputStyle, marginTop: 3, resize: "vertical" }} /></label>
        <button type="button" onClick={() => onFaqEntriesChange(faqEntries.filter((_, i) => i !== index))} style={{ border: 0, background: "transparent", color: "#B91C1C", padding: "6px 0 0", cursor: "pointer" }}>Remove FAQ</button>
      </div>)}
      <button type="button" disabled={faqEntries.length >= 20} onClick={() => onFaqEntriesChange([...faqEntries, { question: "", answer: "" }])} style={{ border: "1px solid #CBD5E1", borderRadius: 6, background: "white", padding: "7px 10px", cursor: "pointer" }}>Add FAQ</button>
      <p style={{ fontSize: 11, color: "#64748B" }}>Only answers from this approved list and company reference notes may be used for company FAQs.</p>
    </div>}
  </section>;
}

function PersistedCompanyOnboardingPage({ setPage }: { setPage: (p: Page) => void }) {
  const [draft, setDraft] = useState<OnboardingCompanyDraft>({ company_name: "", website_url: "", company_phone: "", support_email: "", timezone: "Indian/Mauritius" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/company-profile", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.data) setDraft((current) => ({ ...current, ...payload.data }));
    }).catch(() => setMessage("Unable to load the company profile."));
  }, []);

  async function saveCompany() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/company-profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) throw new Error("Company profile could not be saved.");
      setPage("onboarding-ai");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Company profile could not be saved."); }
    finally { setBusy(false); }
  }

  const update = (key: keyof OnboardingCompanyDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return <OnboardingShell step={2}>
    <div style={{ maxWidth: 720, margin: "0 auto", background: "white", borderRadius: 12, padding: 28, border: "1px solid #E8ECF4" }}>
      <h3 style={{ fontSize: 20, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 8 }}>Company Profile</h3>
      <p style={{ color: "#64748B", fontSize: 13, marginBottom: 22 }}>This information is stored in your authenticated company workspace and becomes context for the assistant.</p>
      {message && <p role="alert" style={{ color: "#B91C1C", fontSize: 13 }}>{message}</p>}
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Company name<input required value={draft.company_name} onChange={(e) => update("company_name", e.target.value)} placeholder="Your company name" style={inputStyle} /></label>
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Website URL<input value={draft.website_url} onChange={(e) => update("website_url", e.target.value)} placeholder="https://your-company.example" style={inputStyle} /></label>
      <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
        <label style={{ flex: 1, fontSize: 13, color: "#374151" }}>Company phone<input value={draft.company_phone} onChange={(e) => update("company_phone", e.target.value)} placeholder="+230 ..." style={inputStyle} /></label>
        <label style={{ flex: 1, fontSize: 13, color: "#374151" }}>Support email<input type="email" value={draft.support_email} onChange={(e) => update("support_email", e.target.value)} placeholder="support@your-company.example" style={inputStyle} /></label>
      </div>
      <label style={{ display: "block", marginBottom: 24, fontSize: 13, color: "#374151" }}>Default timezone<select value={draft.timezone} onChange={(e) => update("timezone", e.target.value)} style={inputStyle}><option value="Indian/Mauritius">Indian/Mauritius (UTC+04:00)</option><option value="UTC">UTC</option><option value="America/New_York">America/New_York</option><option value="Europe/London">Europe/London</option></select></label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}><button type="button" disabled={busy || !draft.company_name.trim()} onClick={saveCompany} style={{ padding: "10px 24px", borderRadius: 8, border: 0, background: busy ? "#93C5FD" : "#3B5BDB", color: "white", fontWeight: 600 }}>{busy ? "Saving…" : "Save & continue"}</button></div>
    </div>
  </OnboardingShell>;
}

function PersistedAssistantOnboardingPage({ setPage }: { setPage: (p: Page) => void }) {
  const [draft, setDraft] = useState<OnboardingAssistantDraft>({ ...EMPTY_ASSISTANT_DRAFT, capabilities: { ...DEFAULT_CAPABILITY_FLAGS } });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/assistant-config", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.data) setDraft((current) => ({ ...current, ...payload.data, capabilities: readCapabilityFlags(payload.data.capabilities) }));
    }).catch(() => setMessage("Unable to load the assistant draft."));
  }, []);
  async function saveAssistant(publish: boolean) {
    setBusy(true); setMessage("");
    try {
      if (publish) {
        const validation = await fetch("/api/assistant-config/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...draft, is_deployed: false }),
        });
        const validationResult = await validation.json().catch(() => null);
        if (!validation.ok || validationResult?.status !== "valid") {
          throw new Error(validationResult?.detail || "Assistant profile validation failed. Review the configuration before publishing.");
        }
      }
      const response = await fetch("/api/assistant-config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, capabilities: writeCapabilityFlags(draft.capabilities), is_deployed: publish }) });
      if (!response.ok) throw new Error("Assistant configuration could not be saved.");
      setPage(publish ? "dashboard" : "assistant-config");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Assistant configuration could not be saved."); }
    finally { setBusy(false); }
  }
  const update = (key: keyof OnboardingAssistantDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const updateCapability = (key: keyof CapabilityFlags, enabled: boolean) => setDraft((current) => ({ ...current, capabilities: { ...current.capabilities, [key]: enabled } }));
  return <OnboardingShell step={3}>
    <div style={{ maxWidth: 720, margin: "0 auto", background: "white", borderRadius: 12, padding: 28, border: "1px solid #E8ECF4" }}>
      <h3 style={{ fontSize: 20, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 8 }}>Configure your assistant</h3>
      <p style={{ color: "#64748B", fontSize: 13, marginBottom: 22 }}>Choose the company workflows this assistant may handle. The platform still enforces tenant security, confirmations, and the exact tool grants for the published profile.</p>
      {message && <p role="alert" style={{ color: "#B91C1C", fontSize: 13 }}>{message}</p>}
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Assistant name<input required value={draft.assistant_name} onChange={(e) => update("assistant_name", e.target.value)} placeholder="Your calendar assistant" style={inputStyle} /></label>
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Voice<select value={draft.voice_engine} onChange={(e) => update("voice_engine", e.target.value)} style={inputStyle}><option>Aoede</option><option>Puck</option><option>Charon</option><option>Kore</option><option>Fenrir</option></select></label>
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Greeting<input maxLength={500} value={draft.inbound_greeting} onChange={(e) => update("inbound_greeting", e.target.value)} placeholder="How can I help with your calendar?" style={inputStyle} /></label>
      <CapabilityChoices value={draft.capabilities} onChange={updateCapability} />
      <CompanyOperatingFields
        tone={draft.tone} onToneChange={(tone) => setDraft((current) => ({ ...current, tone }))}
        businessHours={draft.business_hours} onBusinessHoursChange={(business_hours) => setDraft((current) => ({ ...current, business_hours }))}
        escalationRules={draft.escalation_rules} onEscalationRulesChange={(escalation_rules) => setDraft((current) => ({ ...current, escalation_rules }))}
        faqEntries={draft.faq_entries} onFaqEntriesChange={(faq_entries) => setDraft((current) => ({ ...current, faq_entries }))}
        showFaq={draft.capabilities.company_faq}
      />
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Company instructions<textarea rows={5} value={draft.system_prompt} onChange={(e) => update("system_prompt", e.target.value)} placeholder="Describe your services, tone, hours, and operating preferences. These instructions cannot add authority beyond selected capabilities." style={{ ...inputStyle, resize: "vertical" }} /></label>
      <label style={{ display: "block", marginBottom: 24, fontSize: 13, color: "#374151" }}>Approved company reference notes<textarea rows={3} value={draft.knowledge_base_notes} onChange={(e) => update("knowledge_base_notes", e.target.value)} placeholder="Optional facts and answers for the company FAQ capability." style={{ ...inputStyle, resize: "vertical" }} /></label>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><button type="button" onClick={() => setPage("onboarding-company")} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white" }}>Back</button><div style={{ display: "flex", gap: 10 }}><button type="button" disabled={busy || !draft.assistant_name.trim()} onClick={() => saveAssistant(false)} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #3B5BDB", background: "white", color: "#3B5BDB", fontWeight: 600 }}>Save draft</button><button type="button" disabled={busy || !draft.assistant_name.trim()} onClick={() => saveAssistant(true)} style={{ padding: "10px 18px", borderRadius: 8, border: 0, background: busy ? "#93C5FD" : "#3B5BDB", color: "white", fontWeight: 600 }}>{busy ? "Saving…" : "Publish assistant"}</button></div></div>
    </div>
  </OnboardingShell>;
}

function IntegrationsPage({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <AppShell
      page="integrations"
      setPage={setPage}
      title="Integrations & Workspace Apps"
      subtitle="Connect this company’s Google Calendar and configure its optional 3CX integration."
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 720px)", gap: 16, marginBottom: 16 }}>
        <GoogleCalendarIntegrationCard />
      </div>

      <ThreeCXIntegrationCard />

      {/* Security notice */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 20, display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <IconShield />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 6 }}>
            Data Isolation &amp; Security Protocols
          </div>
          <div style={{ fontSize: 13, color: "#7A8BAD", lineHeight: 1.7 }}>
            Google credentials are encrypted before persistence and are never returned to the browser. Calendar operations use the authenticated company&apos;s connected account. Production KMS and workload-role provisioning remain release gates; no HIPAA or SOC 2 certification is claimed here.
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ─── Company Setup (app screen) ───────────────────────────────────────────────

function CompanySetupPage({ setPage }: { setPage: (p: Page) => void }) {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [timezone, setTimezone] = useState("Indian/Mauritius");
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function loadCompany() {
      try {
        const res = await fetch("/api/company-profile", { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            if (json.data.company_name) setCompanyName(json.data.company_name);
            if (json.data.website_url) setWebsiteUrl(json.data.website_url);
            if (json.data.company_phone) setCompanyPhone(json.data.company_phone);
            if (json.data.support_email) setSupportEmail(json.data.support_email);
            if (json.data.timezone) setTimezone(json.data.timezone);
          }
        }
      } catch (e) {
        logSafeFailure("Company profile load failed", e, "warn");
      }
    }
    loadCompany();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/company-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          website_url: websiteUrl,
          company_phone: companyPhone,
          support_email: supportEmail,
          timezone: timezone,
        }),
      });
      if (res.ok) {
        setStatusMessage({ text: "Company profile saved to database successfully!", type: "success" });
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        setStatusMessage({ text: "Failed to save company profile.", type: "error" });
      }
    } catch (e) {
      setStatusMessage({ text: "Network error saving company profile.", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppShell
      page="company-setup"
      setPage={setPage}
      title="Company Setup"
      subtitle="Manage your organization profile, contact details, and operational settings."
    >
      <div style={{ maxWidth: 820, display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 500px", background: "white", borderRadius: 12, padding: 28, border: "1px solid #E8ECF4" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", margin: 0 }}>
              Company Profile
            </h3>
            {statusMessage && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: statusMessage.type === "success" ? "#DCFCE7" : "#FEE2E2",
                  color: statusMessage.type === "success" ? "#166534" : "#991B1B",
                }}
              >
                {statusMessage.text}
              </span>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              Company Name
            </label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Your company name"
              style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "Inter", outline: "none", color: "#0D1526" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              Website URL
            </label>
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://your-company.example"
              style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "Inter", outline: "none", color: "#0D1526" }}
            />
          </div>

          <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
                Company Phone
              </label>
              <input
                value={companyPhone}
                onChange={(e) => setCompanyPhone(e.target.value)}
              placeholder="+230 ..."
                style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "Inter", outline: "none", color: "#0D1526" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
                Support Email
              </label>
              <input
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@your-company.example"
                style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "Inter", outline: "none", color: "#0D1526" }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              Default Timezone
            </label>
            <div style={{ position: "relative" }}>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 36px 10px 12px", fontSize: 14, fontFamily: "Inter", appearance: "none", background: "white", outline: "none", color: "#0D1526" }}
              >
                <option value="Indian/Mauritius">Mauritius — Indian/Mauritius (UTC+04:00)</option>
                <option value="America/New_York">Eastern Time — America/New_York</option>
                <option value="America/Los_Angeles">Pacific Time — America/Los_Angeles</option>
                <option value="America/Chicago">Central Time — America/Chicago</option>
                <option value="Europe/London">London — Europe/London</option>
                <option value="UTC">UTC</option>
              </select>
              <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <IconChevronDown />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <button
              onClick={() => setPage("dashboard")}
              style={{ border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 24px", fontSize: 14, background: "white", cursor: "pointer", fontFamily: "Inter" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                background: isSaving ? "#93C5FD" : "#3B5BDB",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "10px 28px",
                fontSize: 14,
                fontWeight: 600,
                cursor: isSaving ? "not-allowed" : "pointer",
                fontFamily: "Inter",
                boxShadow: "0 2px 8px rgba(59, 91, 219, 0.25)",
              }}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        <div style={{ flex: "0 0 240px", background: "#EEF2FF", borderRadius: 12, padding: 20, border: "1px solid #C7D2FE" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#3B5BDB", marginBottom: 10, fontFamily: "Bricolage Grotesque" }}>
            Setup Context
          </div>
          <p style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6, marginBottom: 14 }}>
            Company details provide bounded context for your assistant. They do not grant new tools or change platform security rules.
          </p>
          {["Company-specific assistant profile", "Google Calendar connection is company-scoped", "3CX call handling is not active yet"].map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <IconCheck />
              <span style={{ fontSize: 13, color: "#3B5BDB", fontWeight: 500 }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

// ─── Assistant Config (app screen) ───────────────────────────────────────────

function AssistantConfigPage({ setPage, onTestDraft }: { setPage: (p: Page) => void; onTestDraft: (version: number) => void }) {
  const [assistantName, setAssistantName] = useState("");
  const [voiceEngine, setVoiceEngine] = useState("Aoede");
  const [inboundGreeting, setInboundGreeting] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [knowledgeBaseNotes, setKnowledgeBaseNotes] = useState("");
  const [tone, setTone] = useState<OnboardingAssistantDraft["tone"]>("friendly");
  const [businessHours, setBusinessHours] = useState<Record<string, string>>({});
  const [escalationRules, setEscalationRules] = useState<string[]>([]);
  const [faqEntries, setFaqEntries] = useState<FAQEntry[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityFlags>({ ...DEFAULT_CAPABILITY_FLAGS });
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [profileStatus, setProfileStatus] = useState<"loading" | "ready" | "error">("loading");

  const refreshPublishedProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/assistant-config/versions", { cache: "no-store" });
      if (!response.ok) throw new Error("Profile versions unavailable");
      const payload = await response.json();
      const versions = Array.isArray(payload.data) ? payload.data : [];
      const current = versions.find((item: { lifecycle_state?: string }) => item.lifecycle_state === "published");
      setPublishedVersion(typeof current?.version === "number" ? current.version : null);
      setProfileStatus("ready");
    } catch {
      setProfileStatus("error");
    }
  }, []);

  useEffect(() => {
    async function loadAssistant() {
      try {
        const res = await fetch("/api/assistant-config", { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            if (json.data.assistant_name) setAssistantName(json.data.assistant_name);
            if (json.data.voice_engine) setVoiceEngine(json.data.voice_engine);
            if (json.data.inbound_greeting) setInboundGreeting(json.data.inbound_greeting);
            if (json.data.system_prompt) setSystemPrompt(json.data.system_prompt);
            if (json.data.knowledge_base_notes) setKnowledgeBaseNotes(json.data.knowledge_base_notes);
            if (["professional", "friendly", "warm", "concise"].includes(json.data.tone)) setTone(json.data.tone);
            setBusinessHours(json.data.business_hours || {});
            setEscalationRules(json.data.escalation_rules || []);
            setFaqEntries(json.data.faq_entries || []);
            setCapabilities(readCapabilityFlags(json.data.capabilities));
          }
        }
      } catch (e) {
        logSafeFailure("Assistant configuration load failed", e, "warn");
      }
    }
    loadAssistant();
    refreshPublishedProfile();
  }, [refreshPublishedProfile]);

  const handleSave = async (deploy = false): Promise<number | null> => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const config = {
        assistant_name: assistantName,
        voice_engine: voiceEngine,
        inbound_greeting: inboundGreeting,
        system_prompt: systemPrompt,
        knowledge_base_notes: knowledgeBaseNotes,
        tone,
        business_hours: businessHours,
        escalation_rules: escalationRules,
        faq_entries: faqEntries,
        capabilities: writeCapabilityFlags(capabilities),
      };
      if (deploy) {
        const validation = await fetch("/api/assistant-config/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...config, is_deployed: false }),
        });
        const validationResult = await validation.json().catch(() => null);
        if (!validation.ok || validationResult?.status !== "valid") {
          throw new Error(validationResult?.detail || "Assistant profile validation failed. Review the configuration before publishing.");
        }
      }
      const res = await fetch("/api/assistant-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, is_deployed: deploy }),
      });
      if (res.ok) {
        const saved = await res.json().catch(() => null);
        if (deploy) await refreshPublishedProfile();
        setStatusMessage({
          text: deploy ? "Assistant profile published. New sessions will use this version." : "Assistant draft saved.",
          type: "success",
        });
        setTimeout(() => setStatusMessage(null), 4000);
        return Number.isInteger(saved?.data?.profile_version) ? saved.data.profile_version : null;
      } else {
        const error = await res.json().catch(() => null);
        setStatusMessage({ text: error?.detail || "Failed to save assistant configuration.", type: "error" });
      }
    } catch (e) {
      setStatusMessage({ text: e instanceof Error ? e.message : "Network error saving assistant config.", type: "error" });
    } finally {
      setIsSaving(false);
    }
    return null;
  };

  return (
    <AppShell
      page="assistant-config"
      setPage={setPage}
      title="Assistant Configuration"
      subtitle="Manage voice engine, prompts, and deployment settings for your AI assistants."
    >
      <div style={{ maxWidth: 1040, display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1, background: "white", borderRadius: 12, padding: 28, border: "1px solid #E8ECF4" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", margin: 0 }}>
              AI Model & Prompt Configuration
            </h3>
            {statusMessage && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: statusMessage.type === "success" ? "#DCFCE7" : "#FEE2E2",
                  color: statusMessage.type === "success" ? "#166534" : "#991B1B",
                }}
              >
                {statusMessage.text}
              </span>
            )}
          </div>

      <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              Assistant Identifier
            </label>
            <input
              value={assistantName}
              onChange={(e) => setAssistantName(e.target.value)}
              placeholder="Name this assistant for your company"
              style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "Inter", outline: "none", color: "#0D1526" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              Gemini Live Voice Engine
            </label>
            <div style={{ position: "relative" }}>
              <select
                value={voiceEngine}
                onChange={(e) => setVoiceEngine(e.target.value)}
                style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 36px 10px 12px", fontSize: 14, fontFamily: "Inter", appearance: "none", background: "white", outline: "none", color: "#0D1526" }}
              >
                <option value="Aoede">Aoede (Expressive, Warm, Engaging Female)</option>
                <option value="Puck">Puck (Natural, Approachable, Dynamic Male)</option>
                <option value="Charon">Charon (Calm, Confident, Authoritative Male)</option>
                <option value="Kore">Kore (Clear, Polished, Professional Female)</option>
                <option value="Fenrir">Fenrir (Resonant, Deep, Energetic Male)</option>
              </select>
              <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <IconChevronDown />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              Inbound Greeting Phrase
            </label>
            <input
              maxLength={500}
              value={inboundGreeting}
              onChange={(e) => setInboundGreeting(e.target.value)}
              placeholder="Write the greeting your callers should hear"
              style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "Inter", outline: "none", color: "#0D1526" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              System Instructions (AI Prompt)
            </label>
            <textarea
              rows={5}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Describe your company, services, tone, and approved operating rules. Platform security and tool permissions remain enforced."
              style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "Inter", outline: "none", color: "#0D1526", resize: "vertical" }}
            />
      </div>

      <CapabilityChoices
        value={capabilities}
        onChange={(key, enabled) => setCapabilities((current) => ({ ...current, [key]: enabled }))}
      />

      <CompanyOperatingFields
        tone={tone} onToneChange={setTone}
        businessHours={businessHours} onBusinessHoursChange={setBusinessHours}
        escalationRules={escalationRules} onEscalationRulesChange={setEscalationRules}
        faqEntries={faqEntries} onFaqEntriesChange={setFaqEntries}
        showFaq={capabilities.company_faq}
      />

      <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              Approved company reference notes
            </label>
            <textarea rows={4} maxLength={16000} value={knowledgeBaseNotes} onChange={(event) => setKnowledgeBaseNotes(event.target.value)} placeholder="Enter company facts and approved answers. File upload is not available yet." style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <button
              onClick={async () => {
                const version = await handleSave(false);
                if (version !== null) onTestDraft(version);
              }}
              disabled={isSaving}
              style={{ border: "1.5px solid #3B5BDB", borderRadius: 8, padding: "10px 18px", fontSize: 14, background: "white", color: "#3B5BDB", cursor: isSaving ? "not-allowed" : "pointer", fontFamily: "Inter" }}
            >
              {isSaving ? "Saving…" : "Save & test draft"}
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={isSaving}
              style={{ border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 24px", fontSize: 14, background: "white", cursor: isSaving ? "not-allowed" : "pointer", fontFamily: "Inter" }}
            >
              {isSaving ? "Saving..." : "Save Draft"}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={isSaving}
              style={{ background: "#3B5BDB", color: "white", border: "none", borderRadius: 8, padding: "10px 28px", fontSize: 14, fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer", fontFamily: "Inter", boxShadow: "0 2px 8px rgba(59, 91, 219, 0.25)" }}
            >
              Publish Assistant Profile
            </button>
          </div>
        </div>

        {/* Dedicated Sandbox Launcher Card */}
        <div style={{ flex: "0 0 310px", background: "white", borderRadius: 12, padding: 22, border: "1.5px solid #C7D2FE", boxShadow: "0 4px 16px rgba(59, 91, 219, 0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 6px #22C55E" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#3B5BDB", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Gemini Live Voice Engine
            </span>
          </div>

          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 8 }}>
            Interactive Testing Sandbox
          </div>

          <p style={{ fontSize: 13, color: "#64748B", lineHeight: 1.5, marginBottom: 16 }}>
            Experience the dedicated voice environment. Speak with your live AI assistant with real-time audio synthesis, live transcription, and waveform feedback.
          </p>

          <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "12px 14px", border: "1px solid #E2E8F0", marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
              Active Voice Model
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0D1526", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#3B5BDB" }}>✦</span> {voiceEngine} (Gemini Live)
            </div>
          </div>

          <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "12px 14px", border: "1px solid #E2E8F0", marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
              Published Profile
            </div>
            <div style={{ fontSize: 12, color: profileStatus === "error" ? "#B91C1C" : "#374151", fontWeight: 600 }}>
              {profileStatus === "loading" ? "Checking publish status…" : profileStatus === "error" ? "Publish status unavailable" : publishedVersion === null ? "No profile published" : `Version ${publishedVersion} · used by new sessions`}
            </div>
          </div>

          <button
            onClick={() => setPage("testing-sandbox")}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              background: "#3B5BDB",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "13px 18px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "Inter",
              boxShadow: "0 4px 14px rgba(59, 91, 219, 0.35)",
              transition: "transform 0.15s, background 0.15s",
            }}
          >
            <IconMic />
            <span>Launch Testing Sandbox →</span>
          </button>
        </div>
      </div>
    </AppShell>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("landing");
  const [previewProfileVersion, setPreviewProfileVersion] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const search = typeof window !== "undefined" ? window.location.search : "";
    fetch(`/api/auth/get-session${search}`, { credentials: "include", cache: "no-store" })
      .then(async (sessionResponse) => {
        if (!sessionResponse.ok) {
          if (active) { setPage("landing"); setLoading(false); }
          return;
        }
        const sessionPayload = await sessionResponse.json();
        const user = sessionPayload?.user || sessionPayload?.session?.user;
        if (!active) return;
        if (!user) {
          setPage("landing");
          setLoading(false);
          return;
        }

        if (typeof window !== "undefined" && window.location.search.includes("neon_auth_session_verifier")) {
          window.history.replaceState({}, "", window.location.pathname);
        }

        // An authenticated user should never remain on the public landing page
        // while their company profile is loading or temporarily unavailable.
        setPage("onboarding-goals");
        try {
          const profileResponse = await fetch("/api/company-profile", { credentials: "include", cache: "no-store" });
          if (!active) return;
          if (profileResponse.ok) {
            const profilePayload = await profileResponse.json();
            const companyName = String(profilePayload?.data?.company_name || "").trim();
            setPage(companyName ? "dashboard" : "onboarding-goals");
          } else {
            setPage("onboarding-goals");
          }
        } catch {
          if (active) setPage("onboarding-goals");
        } finally {
          if (active) setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setPage("landing");
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  const render = () => {
    if (loading) {
      return (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#090d16", color: "#94a3b8", fontFamily: "Inter" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 36, height: 36, border: "3px solid rgba(255,255,255,0.1)", borderTopColor: "#3B5BDB", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
            <p style={{ fontSize: 13, letterSpacing: "0.02em" }}>Connecting to your workspace…</p>
          </div>
        </div>
      );
    }
    switch (page) {
      case "landing": return <LandingPage setPage={setPage} />;
      case "signup": return <AuthRedirect />;
      case "onboarding-goals": return <PersistedCompanyOnboardingPage setPage={setPage} />;
      case "onboarding-company": return <PersistedCompanyOnboardingPage setPage={setPage} />;
      case "onboarding-ai": return <PersistedAssistantOnboardingPage setPage={setPage} />;
      case "dashboard": return <DashboardPage setPage={setPage} />;
      case "calls": return <CallsPage setPage={setPage} />;
      case "phone-numbers": return <PhoneNumbersPage setPage={setPage} />;
      case "integrations": return <IntegrationsPage setPage={setPage} />;
      case "company-setup": return <CompanySetupPage setPage={setPage} />;
      case "assistant-config": return <AssistantConfigPage
        setPage={setPage}
        onTestDraft={(version) => { setPreviewProfileVersion(version); setPage("testing-sandbox"); }}
      />;
      case "testing-sandbox": return (
        <AppShell
          page="assistant-config"
          setPage={setPage}
          title="Interactive Voice Testing Sandbox"
          subtitle="Real-time conversational testing with Gemini Live"
        >
          <TestingSandboxPage
            profileVersion={previewProfileVersion}
            onBack={() => { setPreviewProfileVersion(null); setPage("assistant-config"); }}
          />
        </AppShell>
      );
    }
  };

  return <>
    {render()}
    <BookingUpdateCenter enabled={!loading && page !== "landing" && page !== "signup"} />
  </>;
}
