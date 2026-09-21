import { useState, useEffect, useCallback, type ReactNode } from "react";
import { TestingSandboxPage } from "./components/sandbox/TestingSandboxPage";

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

function IconArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="#3B5BDB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

function IconUpload() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 13V7m0 0l-3 3m3-3l3 3" stroke="#3B5BDB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 15a4 4 0 01-.5-7.95A5.5 5.5 0 0113.5 5.5a3.5 3.5 0 013.5 3.5c0 .17-.01.33-.03.5H17a3 3 0 010 6H5.5" stroke="#3B5BDB" strokeWidth="1.5" strokeLinecap="round" />
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

function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#3B5BDB" strokeWidth="1.5" />
      <path d="M8 7v5" stroke="#3B5BDB" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.75" fill="#3B5BDB" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M1 9s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" stroke="#888" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="2.5" stroke="#888" strokeWidth="1.5" />
    </svg>
  );
}

function IconGoogle() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" stroke="#ddd" strokeWidth="1" />
      <text x="5" y="14" fontSize="12" fill="#555">G</text>
    </svg>
  );
}

function IconMS() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="6" height="6" fill="#F25022" />
      <rect x="11" y="3" width="6" height="6" fill="#7FBA00" />
      <rect x="3" y="11" width="6" height="6" fill="#00A4EF" />
      <rect x="11" y="11" width="6" height="6" fill="#FFB900" />
    </svg>
  );
}

function Toggle({ on }: { on?: boolean }) {
  return (
    <div
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: on ? "#3B5BDB" : "#D1D5DB",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: on ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "white",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
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

      {/* Account */}
      <div
        style={{
          padding: "14px 12px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#3B5BDB",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "Inter",
          }}
        >
          A
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "white", fontSize: 12, fontWeight: 600, fontFamily: "Inter", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Acme Operations
          </div>
          <div style={{ color: "#7A8BAD", fontSize: 11, fontFamily: "Inter" }}>Enterprise Admin</div>
        </div>
        <IconChevronDown />
      </div>
    </aside>
  );
}

function AppHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        height: 64,
        borderBottom: "1px solid #E8ECF4",
        padding: "0 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "white",
      }}
    >
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "#7A8BAD", fontFamily: "Inter", marginTop: 1 }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#22C55E", fontFamily: "Inter", fontWeight: 500 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E" }} />
          Ava Voice Server Live
        </div>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#E8ECF4", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#3B5BDB", fontFamily: "Inter" }}>
          MV
        </div>
        <span style={{ fontSize: 13, color: "#0D1526", fontFamily: "Inter", fontWeight: 500 }}>Marcus Vance</span>
      </div>
    </div>
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
        {["Platform", "Solutions", "Enterprise", "Pricing", "Docs"].map((l) => (
          <span key={l} style={{ fontSize: 14, color: "#4B5563", cursor: "pointer" }}>{l}</span>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 14, color: "#4B5563", cursor: "pointer" }}>Sign In</span>
        <button
          onClick={() => setPage("signup")}
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
          Start Free Trial
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
          NEXT-GEN VOICE AI FOR ENTERPRISE SUPPORT &amp; SALES
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
          Human-Like Voice Assistants<br />That Handle Complex<br />Business Calls
        </h1>
        <p style={{ fontSize: 16, color: "#4B5563", lineHeight: 1.7, marginBottom: 36, maxWidth: 560, margin: "0 auto 36px" }}>
          Deploy customized, low-latency AI assistants that resolve support tickets, qualify
          outbound leads, and update your CRM in real time — with zero human intervention.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setPage("signup")}
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
          <button
            style={{
              background: "white",
              color: "#0D1526",
              border: "1.5px solid #D1D5DB",
              borderRadius: 8,
              padding: "12px 28px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "Inter",
            }}
          >
            Schedule Enterprise Demo
          </button>
        </div>
      </div>

      {/* Demo widget */}
      <div style={{ maxWidth: 900, margin: "48px auto", padding: "0 24px" }}>
        <div
          style={{
            background: "#F9FAFB",
            border: "1px solid #E8ECF4",
            borderRadius: 16,
            padding: 28,
            display: "flex",
            gap: 32,
            flexWrap: "wrap",
          }}
        >
          {/* Call widget */}
          <div style={{ flex: "1 1 340px", background: "white", borderRadius: 12, padding: 20, border: "1px solid #E8ECF4" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: "#0D1526" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E" }} />
                Inbound Call #4812 (Active)
              </div>
              <span style={{ fontSize: 13, color: "#7A8BAD" }}>02:14</span>
            </div>
            {/* Waveform */}
            <div style={{ display: "flex", alignItems: "center", gap: 3, height: 60, marginBottom: 16, justifyContent: "center" }}>
              {[12, 20, 32, 44, 52, 40, 28, 48, 56, 44, 36, 50, 38, 26, 42, 30, 20, 34].map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: 4,
                    height: h,
                    borderRadius: 2,
                    background: i === 8 ? "#3B5BDB" : `rgba(59,91,219,${0.2 + (h / 60) * 0.5})`,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#4B5563" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="3" y="1" width="4" height="6" rx="2" fill="#3B5BDB" /><path d="M1 6a4 4 0 008 0" stroke="#3B5BDB" strokeWidth="1" strokeLinecap="round" /></svg>
              </div>
              User: "I need to upgrade my billing tier and integrate with Salesforce."
            </div>
          </div>

          {/* Action log */}
          <div style={{ flex: "1 1 320px" }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: "#0D1526", marginBottom: 6, fontFamily: "Bricolage Grotesque" }}>
              Sub-second Latency &amp; Action execution
            </div>
            <div style={{ fontSize: 13, color: "#4B5563", marginBottom: 16, lineHeight: 1.6 }}>
              Watch Vocalist execute background system triggers mid-call. There's no waiting for 'typing' indicators — it updates directly.
            </div>
            {[
              { icon: "check", text: "Voice Recognition: 99.1% Confidence Score" },
              { icon: "check", text: "Context Matched: Tier Upgrade Request" },
              { icon: "arrow", text: "Salesforce API call triggered..." },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  background: "white",
                  border: "1px solid #E8ECF4",
                  borderRadius: 8,
                  marginBottom: 8,
                  fontSize: 13,
                  color: "#0D1526",
                }}
              >
                {item.icon === "check" ? <IconCheck /> : <IconArrow />}
                {item.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #E8ECF4", padding: "40px 40px 32px", display: "flex", flexWrap: "wrap", gap: 40 }}>
        <div style={{ flex: "1 1 200px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <LogoIcon />
            <span style={{ fontFamily: "Bricolage Grotesque", fontWeight: 700, fontSize: 15, color: "#0D1526" }}>vocalist.ai</span>
          </div>
          <div style={{ fontSize: 12, color: "#7A8BAD", lineHeight: 1.7 }}>
            High-performance AI Voice Agents built<br />for robust, fast enterprise customer<br />support pipelines.
          </div>
        </div>
        {[
          { title: "Product", links: ["Features", "Security", "Voices", "Pricing"] },
          { title: "Resources", links: ["Documentation", "API Specs", "Status Page", "Privacy"] },
          { title: "Company", links: ["About", "Blog", "Careers", "Contact"] },
        ].map((col) => (
          <div key={col.title} style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0D1526", marginBottom: 12 }}>{col.title}</div>
            {col.links.map((l) => (
              <div key={l} style={{ fontSize: 13, color: "#7A8BAD", marginBottom: 8, cursor: "pointer" }}>{l}</div>
            ))}
          </div>
        ))}
      </footer>
    </div>
  );
}

// ─── Sign Up ──────────────────────────────────────────────────────────────────

function SignupPage({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter" }}>
      {/* Left panel */}
      <div
        style={{
          width: "42%",
          background: "#0D1526",
          padding: "32px 40px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 80 }}>
          <LogoIcon />
          <span style={{ fontFamily: "Bricolage Grotesque", fontWeight: 700, fontSize: 16, color: "white" }}>vocalist.ai</span>
        </div>
        <div style={{ flex: 1 }}>
          <h2
            style={{
              fontFamily: "Bricolage Grotesque",
              fontWeight: 800,
              fontSize: 34,
              color: "white",
              lineHeight: 1.2,
              marginBottom: 20,
            }}
          >
            Build and deploy your first voice assistant in 10 minutes.
          </h2>
          <p style={{ fontSize: 13, color: "#8899BB", lineHeight: 1.7, marginBottom: 28 }}>
            Join thousands of operational leaders reducing ticket workloads by handing repeatable workflows to high-fidelity AI.
          </p>
          {[
            "Deploy custom phone lines instantly",
            "Access SOC2 compliant conversation storage",
            "Integrate directly with customer data stacks",
          ].map((f) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l3.5 3.5L13 5" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 13, color: "#8899BB" }}>{f}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#4B5563" }}>© 2026 Vocalist Inc. All rights reserved.</div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, padding: "60px 56px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 6 }}>
          Create Your Account
        </h1>
        <p style={{ fontSize: 13, color: "#7A8BAD", marginBottom: 28 }}>No credit card required to start free trial.</p>

        {/* Social buttons */}
        <button
          style={{
            width: "100%",
            border: "1.5px solid #D1D5DB",
            borderRadius: 8,
            padding: "11px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontSize: 14,
            fontWeight: 500,
            background: "white",
            cursor: "pointer",
            marginBottom: 10,
            fontFamily: "Inter",
          }}
        >
          <IconGoogle /> Sign up with Google
        </button>
        <button
          style={{
            width: "100%",
            border: "1.5px solid #D1D5DB",
            borderRadius: 8,
            padding: "11px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontSize: 14,
            fontWeight: 500,
            background: "white",
            cursor: "pointer",
            marginBottom: 20,
            fontFamily: "Inter",
          }}
        >
          <IconMS /> Sign up with Microsoft
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
          <span style={{ fontSize: 12, color: "#9CA3AF" }}>OR USE EMAIL</span>
          <div style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
        </div>

        {/* Form fields */}
        {[
          { label: "Full Name", placeholder: "Jane Miller", type: "text" },
          { label: "Work Email", placeholder: "jane@yourcompany.com", type: "email" },
          { label: "Password", placeholder: "••••••••••••••", type: "password" },
        ].map((f) => (
          <div key={f.label} style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              {f.label}
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={f.type}
                placeholder={f.placeholder}
                style={{
                  width: "100%",
                  border: "1.5px solid #D1D5DB",
                  borderRadius: 8,
                  padding: "10px 36px 10px 12px",
                  fontSize: 14,
                  fontFamily: "Inter",
                  outline: "none",
                  color: "#0D1526",
                }}
              />
              {f.type === "password" && (
                <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>
                  <IconEye />
                </div>
              )}
            </div>
          </div>
        ))}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <input type="checkbox" id="terms" defaultChecked style={{ accentColor: "#3B5BDB" }} />
          <label htmlFor="terms" style={{ fontSize: 13, color: "#4B5563" }}>
            I agree to Vocalist's Terms of Service and Privacy Policy.
          </label>
        </div>

        <button
          onClick={() => setPage("onboarding-goals")}
          style={{
            width: "100%",
            background: "#3B5BDB",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "13px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "Inter",
          }}
        >
          Create Account &amp; Continue
        </button>
      </div>
    </div>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function OnboardingShell({
  step,
  children,
}: {
  step: 1 | 2 | 3;
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

function GoalsPage({ setPage }: { setPage: (p: Page) => void }) {
  const [selected, setSelected] = useState<number[]>([0]);
  const goals = [
    { icon: "🎧", title: "Automate Support Lines", desc: "Triage tier-1 tickets, process simple returns, verify user metadata." },
    { icon: "📞", title: "Lead Qualification", desc: "Initiate custom voice pipelines to qualify inbound form fills." },
    { icon: "📅", title: "Direct Booking", desc: "Schedule dental, salon, or sales meetings natively on calendar sync." },
    { icon: "👤", title: "Verify User Accounts", desc: "Two-factor calling verification and quick custom profile reviews." },
    { icon: "⭐", title: "In-Call Surveys", desc: "Capture real feedback over active, seamless, non-intrusive voice runs." },
    { icon: "👥", title: "Internal Team Ops", desc: "Notify global operations agents with emergency or direct pipeline flags." },
  ];
  const toggle = (i: number) => {
    setSelected((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : prev.length < 3 ? [...prev, i] : prev
    );
  };

  return (
    <OnboardingShell step={1}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h2 style={{ textAlign: "center", fontSize: 28, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 10 }}>
          What are your primary goals?
        </h2>
        <p style={{ textAlign: "center", fontSize: 14, color: "#7A8BAD", marginBottom: 36 }}>
          Choose up to three to help customize your assistant profile.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {goals.map((g, i) => {
            const active = selected.includes(i);
            return (
              <div
                key={i}
                onClick={() => toggle(i)}
                style={{
                  background: "white",
                  border: `1.5px solid ${active ? "#3B5BDB" : "#E8ECF4"}`,
                  borderRadius: 12,
                  padding: 20,
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 12 }}>{g.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 6 }}>
                  {g.title}
                </div>
                <div style={{ fontSize: 13, color: "#7A8BAD", lineHeight: 1.5 }}>{g.desc}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            onClick={() => setPage("signup")}
            style={{
              border: "1.5px solid #D1D5DB",
              borderRadius: 8,
              padding: "10px 24px",
              fontSize: 14,
              background: "white",
              cursor: "pointer",
              fontFamily: "Inter",
            }}
          >
            Skip for now
          </button>
          <button
            onClick={() => setPage("onboarding-company")}
            style={{
              background: "#3B5BDB",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "10px 28px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "Inter",
            }}
          >
            Continue to Company Setup
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

function CompanySetupOnboardingPage({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <OnboardingShell step={2}>
      <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Form card */}
        <div style={{ flex: "1 1 500px", background: "white", borderRadius: 12, padding: 28, border: "1px solid #E8ECF4" }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 24 }}>
            Company Profile
          </h3>
          {[
            { label: "Company Name", placeholder: "Acme Operations Inc.", full: true },
            { label: "Website URL", placeholder: "https://acmeops.com", full: true },
          ].map((f) => (
            <div key={f.label} style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>{f.label}</label>
              <input
                type="text"
                defaultValue={f.placeholder}
                style={{
                  width: "100%",
                  border: "1.5px solid #D1D5DB",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "Inter",
                  outline: "none",
                  color: "#0D1526",
                }}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
            {[
              { label: "Company Phone", placeholder: "+1 (555) 019-2834" },
              { label: "Support Email Address", placeholder: "support@acmeops.com" },
            ].map((f) => (
              <div key={f.label} style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>{f.label}</label>
                <input
                  type="text"
                  defaultValue={f.placeholder}
                  style={{
                    width: "100%",
                    border: "1.5px solid #D1D5DB",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 14,
                    fontFamily: "Inter",
                    outline: "none",
                    color: "#0D1526",
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 28 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Default Timezone</label>
            <div style={{ position: "relative" }}>
              <select
                style={{
                  width: "100%",
                  border: "1.5px solid #D1D5DB",
                  borderRadius: 8,
                  padding: "10px 36px 10px 12px",
                  fontSize: 14,
                  fontFamily: "Inter",
                  appearance: "none",
                  background: "white",
                  outline: "none",
                  color: "#0D1526",
                }}
              >
                <option>America/New_York (EST)</option>
                <option>America/Los_Angeles (PST)</option>
                <option>Europe/London (GMT)</option>
              </select>
              <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <IconChevronDown />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <button
              onClick={() => setPage("onboarding-goals")}
              style={{
                border: "1.5px solid #D1D5DB",
                borderRadius: 8,
                padding: "10px 24px",
                fontSize: 14,
                background: "white",
                cursor: "pointer",
                fontFamily: "Inter",
              }}
            >
              Back
            </button>
            <button
              onClick={() => setPage("onboarding-ai")}
              style={{
                background: "#3B5BDB",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "10px 28px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "Inter",
              }}
            >
              Save &amp; Build Assistant
            </button>
          </div>
        </div>

        {/* Context card */}
        <div
          style={{
            flex: "0 0 260px",
            background: "#EEF2FF",
            borderRadius: 12,
            padding: 20,
            border: "1px solid #C7D2FE",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "#3B5BDB", marginBottom: 10, fontFamily: "Bricolage Grotesque" }}>
            Setup Context
          </div>
          <p style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6, marginBottom: 14 }}>
            Your company parameters are used directly by the AI to verify call metadata, determine operational schedules, and calculate routing targets.
          </p>
          {["Schedules Automatic Triggers", "Direct CRM Entity Matching"].map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <IconInfo />
              <span style={{ fontSize: 13, color: "#3B5BDB" }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </OnboardingShell>
  );
}

function AIConfigOnboardingPage({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <OnboardingShell step={3}>
      <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Main form */}
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 22, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 24 }}>
            Configure Your Voice Assistant
          </h3>
          {[
            { label: "Assistant Identifier", value: "Support Agent – Charlie", type: "text" },
          ].map((f) => (
            <div key={f.label} style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>{f.label}</label>
              <input
                type={f.type}
                defaultValue={f.value}
                style={{
                  width: "100%",
                  border: "1.5px solid #D1D5DB",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "Inter",
                  outline: "none",
                  color: "#0D1526",
                }}
              />
            </div>
          ))}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>AI Voice Engine</label>
            <div style={{ position: "relative" }}>
              <select
                style={{
                  width: "100%",
                  border: "1.5px solid #D1D5DB",
                  borderRadius: 8,
                  padding: "10px 36px 10px 12px",
                  fontSize: 14,
                  fontFamily: "Inter",
                  appearance: "none",
                  background: "white",
                  outline: "none",
                  color: "#0D1526",
                }}
              >
                <option>Ava (Default Female – Professional, Warm)</option>
                <option>Charlie (Male – Direct, Confident)</option>
                <option>Delta (Neutral – Formal)</option>
              </select>
              <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <IconChevronDown />
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Inbound Greeting Phrase</label>
            <input
              type="text"
              defaultValue='"Thank you for calling Acme Operations Support. This is Ava, how can I assist you with your account settings today?"'
              style={{
                width: "100%",
                border: "1.5px solid #D1D5DB",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "Inter",
                outline: "none",
                color: "#0D1526",
              }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>System Instructions (AI Prompt)</label>
            <textarea
              defaultValue="You are a support voice agent. Your tone is warm, polite and direct. Resolve return inquiries using the attached knowledge base. Never invent details outside Acme guidelines. If client requests a tier override, trigger salesforce routing."
              rows={5}
              style={{
                width: "100%",
                border: "1.5px solid #D1D5DB",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "Inter",
                outline: "none",
                color: "#0D1526",
                resize: "vertical",
              }}
            />
          </div>
          <div style={{ marginBottom: 28 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Knowledge Base Documents</label>
            <div
              style={{
                border: "1.5px dashed #C7D2FE",
                borderRadius: 8,
                padding: "20px",
                textAlign: "center",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "#3B5BDB",
                fontSize: 14,
              }}
            >
              <IconUpload /> Upload support_policies.pdf or CSV data sheet
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <button
              onClick={() => setPage("onboarding-company")}
              style={{
                border: "1.5px solid #D1D5DB",
                borderRadius: 8,
                padding: "10px 24px",
                fontSize: 14,
                background: "white",
                cursor: "pointer",
                fontFamily: "Inter",
              }}
            >
              Save Draft
            </button>
            <button
              onClick={() => setPage("dashboard")}
              style={{
                background: "#3B5BDB",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "10px 28px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "Inter",
              }}
            >
              Deploy Assistant to Production
            </button>
          </div>
        </div>

        {/* Sandbox */}
        <div style={{ flex: "0 0 300px", background: "white", borderRadius: 12, padding: 20, border: "1px solid #E8ECF4" }}>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 6 }}>
            Interactive Testing Sandbox
          </div>
          <p style={{ fontSize: 13, color: "#7A8BAD", lineHeight: 1.5, marginBottom: 16 }}>
            Review Ava's responses using active web microphone synthesis before going live.
          </p>
          <div style={{ border: "1px solid #E8ECF4", borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#0D1526" }}>Draft Voice Sandbox</span>
              <span style={{ fontSize: 11, color: "#22C55E", fontWeight: 600 }}>ACTIVE</span>
            </div>
            <div style={{ textAlign: "center", marginBottom: 12 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "#3B5BDB",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 8px",
                  cursor: "pointer",
                }}
              >
                <IconMic />
              </div>
              <div style={{ fontSize: 12, color: "#7A8BAD" }}>Click to begin voice session</div>
            </div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: "#3B5BDB" }}>AVA: </span>
              <span style={{ color: "#0D1526" }}>"Hello! This is Ava from Acme Operations. How can I help?"</span>
            </div>
            <div style={{ fontSize: 13, color: "#9CA3AF", fontStyle: "italic", marginBottom: 14 }}>
              <span style={{ fontWeight: 700, color: "#0D1526", fontStyle: "normal" }}>YOU: </span>
              Waiting for voice output...
            </div>
            <button
              onClick={() => setPage("testing-sandbox")}
              style={{
                width: "100%",
                background: "#3B5BDB",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "Inter",
              }}
            >
              Open Dedicated Voice Sandbox →
            </button>
          </div>
        </div>
      </div>
    </OnboardingShell>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardPage({ setPage }: { setPage: (p: Page) => void }) {
  const stats = [
    { label: "Total Call Count", value: "1,842", sub: "↑ 12.4%", subColor: "#22C55E" },
    { label: "Avg API Latency", value: "320ms", sub: "Good Quality", subColor: "#3B5BDB" },
    { label: "Ticket Resolution Rate", value: "94.2%", sub: "↑ 4.1%", subColor: "#22C55E" },
    { label: "Operational Cost", value: "$368.40", sub: "Estimated Savings", subColor: "#F59E0B" },
  ];

  const barData = [14, 22, 18, 26, 12, 20, 15, 30, 88, 25, 18, 32, 22, 16];

  const assistants = [
    { name: "Ava (Support)", calls: "1,241 calls", status: "Active Live", statusColor: "#22C55E" },
    { name: "Charlie (Lead Gen)", calls: "601 calls", status: "Active Outbound", statusColor: "#3B5BDB" },
    { name: "Delta (Billing Flow)", calls: "0 calls", status: "Draft Status", statusColor: "#9CA3AF" },
  ];

  return (
    <AppShell
      page="dashboard"
      setPage={setPage}
      title="Operational Dashboard"
      subtitle="Overview of operational trends, active voice server bounds, and target KPIs."
    >
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: "white", borderRadius: 12, padding: "18px 20px", border: "1px solid #E8ECF4" }}>
            <div style={{ fontSize: 12, color: "#7A8BAD", marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: s.subColor, fontWeight: 500 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        {/* Bar chart */}
        <div style={{ background: "white", borderRadius: 12, padding: "20px 24px", border: "1px solid #E8ECF4" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>
              Call Stream Volume Trends
            </div>
            <div style={{ fontSize: 12, color: "#7A8BAD", border: "1px solid #E8ECF4", borderRadius: 6, padding: "4px 10px" }}>Last 7 Days</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, marginBottom: 8 }}>
            {barData.map((v, i) => (
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
            ))}
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
          {assistants.map((a) => (
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
          ))}
        </div>
      </div>
    </AppShell>
  );
}

// ─── Calls Stream ─────────────────────────────────────────────────────────────

function CallsPage({ setPage }: { setPage: (p: Page) => void }) {
  const [selectedCall, setSelectedCall] = useState(0);
  const calls = [
    {
      date: "Jan 24, 02:14 PM",
      caller: "+1 (555)\n019-2834",
      assistant: "Ava Support",
      duration: "02:14",
      outcome: "CRM Updated",
      outcomeColor: "#22C55E",
      outcomeBg: "#DCFCE7",
    },
    {
      date: "Jan 24, 01:52 PM",
      caller: "+1 (650)\n441-9034",
      assistant: "Ava Support",
      duration: "04:12",
      outcome: "Transferred",
      outcomeColor: "#F59E0B",
      outcomeBg: "#FEF3C7",
    },
    {
      date: "Jan 24, 01:05 PM",
      caller: "+1 (312)\n662-8177",
      assistant: "Charlie Sales",
      duration: "01:30",
      outcome: "Failed Callback",
      outcomeColor: "#EF4444",
      outcomeBg: "#FEE2E2",
    },
    {
      date: "Jan 24, 11:41 AM",
      caller: "+1 (888)\n293-8472",
      assistant: "Ava Support",
      duration: "03:45",
      outcome: "CRM Updated",
      outcomeColor: "#22C55E",
      outcomeBg: "#DCFCE7",
    },
  ];

  return (
    <AppShell
      page="calls"
      setPage={setPage}
      title="Calls Stream & Analytics"
      subtitle="Track live operational logs, review sentiment metrics, and evaluate agent transcript executions."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "flex-start" }}>
        <div>
          {/* Search */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "white",
                border: "1px solid #E8ECF4",
                borderRadius: 8,
                padding: "9px 14px",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="#9CA3AF" strokeWidth="1.5" /><path d="M11 11l2.5 2.5" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" /></svg>
              <input placeholder="Search calls, transcripts, area codes..." style={{ border: "none", outline: "none", fontSize: 13, flex: 1, fontFamily: "Inter", color: "#7A8BAD", background: "transparent" }} />
            </div>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid #E8ECF4",
                borderRadius: 8,
                padding: "9px 16px",
                background: "white",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "Inter",
                fontWeight: 500,
                color: "#374151",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 3h12M3 7h8M5 11h4" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Filter Options
            </button>
          </div>

          {/* Table */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E8ECF4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>Operational History Stream</div>
              <div style={{ fontSize: 12, color: "#7A8BAD" }}>Showing 4 of 1,842 total runs</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {["Date / Time", "Caller Identity", "Assistant", "Duration", "Outcome"].map((h) => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", fontFamily: "Inter", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calls.map((c, i) => (
                  <tr
                    key={i}
                    onClick={() => setSelectedCall(i)}
                    style={{
                      borderTop: "1px solid #F3F4F6",
                      cursor: "pointer",
                      background: selectedCall === i ? "#F5F7FF" : "white",
                    }}
                  >
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151", whiteSpace: "nowrap" }}>{c.date}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#0D1526", whiteSpace: "pre" }}>{c.caller}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{c.assistant}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{c.duration}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: c.outcomeColor,
                          background: c.outcomeBg,
                          borderRadius: 6,
                          padding: "3px 10px",
                        }}
                      >
                        {c.outcome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Call detail */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 4 }}>
            Inbound Call #4812
          </div>
          <div style={{ fontSize: 12, color: "#7A8BAD", marginBottom: 20 }}>
            Caller: +1 (555) 019-2834 · 02:14 Active Run
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#7A8BAD", marginBottom: 10 }}>
            AUTOMATIC ACTIONS EXECUTED
          </div>
          {[
            { icon: "shield", text: "Voice Recognition Confidence: 99.1%" },
            { icon: "arrow", text: "Salesforce Opportunity Updated" },
          ].map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #E8ECF4", borderRadius: 8, marginBottom: 8, fontSize: 13, color: "#0D1526" }}>
              {a.icon === "shield" ? <IconShield /> : <IconArrow />}
              {a.text}
            </div>
          ))}

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#7A8BAD", margin: "16px 0 10px" }}>
            TRANSCRIPT STREAM
          </div>
          {[
            { speaker: "AVA", text: '"Thank you for calling Acme Support. How can I help you today?"' },
            { speaker: "USER", text: '"I need to upgrade my billing tier and integrate with Salesforce."' },
            { speaker: "AVA", text: '"Absolutely. I see your company Acme Operations on the Pro tier. I\'ve initiated the upgrade sequence."' },
          ].map((line, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700, color: line.speaker === "AVA" ? "#3B5BDB" : "#0D1526" }}>{line.speaker}: </span>
              <span style={{ color: "#374151" }}>{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

// ─── Phone Numbers ────────────────────────────────────────────────────────────

function PhoneNumbersPage({ setPage }: { setPage: (p: Page) => void }) {
  const trunks = [
    {
      number: "+1 (800) 555-0192",
      label: "Inbound Support",
      tags: ["Voice", "MMS"],
      route: "Ava Support",
      status: "Active",
      statusColor: "#22C55E",
    },
    {
      number: "+1 (415) 888-2943",
      label: "Outbound Lead Gen",
      tags: ["Voice"],
      route: "Charlie Sales",
      status: "Active",
      statusColor: "#22C55E",
    },
    {
      number: "+1 (212) 333-8841",
      label: "Billing Inquiries",
      tags: ["Voice", "SMS"],
      route: "Unassigned",
      status: "Suspended",
      statusColor: "#EF4444",
    },
  ];

  const available = [
    { number: "+1 (888) 293-8472", desc: "Toll-Free US", price: "$2.00 / mo" },
    { number: "+1 (650) 441-9034", desc: "San Mateo, CA", price: "$1.50 / mo" },
    { number: "+1 (312) 662-8177", desc: "Chicago, IL", price: "$1.50 / mo" },
  ];

  return (
    <AppShell
      page="phone-numbers"
      setPage={setPage}
      title="Business Phone Numbers"
      subtitle="Configure voice channels, rent custom local/toll-free numbers, or port existing trunks."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "flex-start" }}>
        <div>
          {/* Trunks */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>
                Active Trunks &amp; Inbound Routes
              </div>
              <button style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#3B5BDB", background: "none", border: "none", cursor: "pointer", fontFamily: "Inter", fontWeight: 500 }}>
                ↗ Port Existing Number
              </button>
            </div>
            {trunks.map((t, i) => (
              <div key={i} style={{ border: "1px solid #E8ECF4", borderRadius: 10, padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: "0 0 140px" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0D1526", marginBottom: 2 }}>{t.number}</div>
                  <div style={{ fontSize: 12, color: "#9CA3AF" }}>{t.label}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {t.tags.map((tag) => (
                    <span key={tag} style={{ fontSize: 11, color: "#3B5BDB", background: "#EEF2FF", borderRadius: 4, padding: "2px 8px", fontWeight: 500 }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#9CA3AF", letterSpacing: "0.06em", marginBottom: 2 }}>ROUTE TARGET</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0D1526" }}>{t.route}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: t.statusColor, fontWeight: 500 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: t.statusColor }} />
                  {t.status}
                </div>
                <div style={{ cursor: "pointer", color: "#9CA3AF" }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3" r="1.25" fill="#9CA3AF" /><circle cx="8" cy="8" r="1.25" fill="#9CA3AF" /><circle cx="8" cy="13" r="1.25" fill="#9CA3AF" /></svg>
                </div>
              </div>
            ))}
          </div>

          {/* SIP notice */}
          <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 10, padding: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#3B5BDB" strokeWidth="1.5" /><path d="M10 9v5" stroke="#3B5BDB" strokeWidth="1.5" strokeLinecap="round" /><circle cx="10" cy="6.5" r="1" fill="#3B5BDB" /></svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#3B5BDB", marginBottom: 4 }}>SIP Trunking &amp; Porting Notice</div>
              <div style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6 }}>
                Need custom high-concurrency voice lines? You can coordinate directly with your telecom providers to target vocalist.ai's endpoints with sub-100ms handoffs.
              </div>
            </div>
          </div>
        </div>

        {/* Acquire panel */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 6 }}>
            Acquire Voice Lines
          </div>
          <p style={{ fontSize: 13, color: "#7A8BAD", lineHeight: 1.5, marginBottom: 16 }}>
            Instantly scale operations with local area codes in over 40 countries.
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Country / Region</label>
            <div style={{ position: "relative" }}>
              <select style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "9px 32px 9px 12px", fontSize: 13, fontFamily: "Inter", appearance: "none", background: "white", outline: "none", color: "#0D1526" }}>
                <option>United States (+1)</option>
                <option>United Kingdom (+44)</option>
                <option>Canada (+1)</option>
              </select>
              <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <IconChevronDown />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Area Code</label>
              <input defaultValue="415" style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "Inter", outline: "none", color: "#0D1526" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Contains Patterns</label>
              <input placeholder="e.g. Acme" style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "Inter", outline: "none", color: "#9CA3AF" }} />
            </div>
          </div>
          <button style={{ width: "100%", background: "#3B5BDB", color: "white", border: "none", borderRadius: 8, padding: "11px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "Inter", marginBottom: 16 }}>
            Search Available Numbers
          </button>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0D1526", marginBottom: 10 }}>Available Numbers (3)</div>
          {available.map((n, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #F3F4F6" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0D1526" }}>{n.number}</div>
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>{n.desc}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#7A8BAD" }}>{n.price}</span>
                <button style={{ background: "#3B5BDB", color: "white", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Inter" }}>
                  Rent
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

// ─── Integrations ─────────────────────────────────────────────────────────────

function GoogleCalendarIntegrationCard() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const userId = "00000000-0000-0000-0000-000000000001";

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/auth/google/status?user_id=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setConnected(!!data.connected);
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [userId]);

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

  const handleConnect = () => {
    setBusy(true);
    const width = 520;
    const height = 650;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      `/auth/google/login?user_id=${userId}`,
      "GoogleOAuth",
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );
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
      await fetch(`/auth/google/disconnect?user_id=${userId}`, { method: "POST" });
      await checkStatus();
    } catch (err) {
      console.error(err);
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
        Enable voice assistants to cross-reference availability, write new operational bookings, and trigger custom meeting requests during active phone calls.
      </p>
      <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 14 }}>
        {[
          { label: "Account Authority", value: connected ? "Connected via Google OAuth" : "No active session" },
          { label: "Auto-Schedule Handlers", toggle: true, on: connected },
          { label: "Target Calendar", chip: connected ? '"Primary Calendar"' : '"Not Configured"' },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: "#374151" }}>{row.label}</span>
            {row.toggle ? (
              <Toggle on={row.on} />
            ) : row.chip ? (
              <span style={{ fontSize: 12, color: "#374151", background: "#F3F4F6", borderRadius: 6, padding: "3px 10px" }}>{row.chip}</span>
            ) : (
              <span style={{ fontSize: 13, color: "#7A8BAD" }}>{row.value}</span>
            )}
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

function IntegrationsPage({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <AppShell
      page="integrations"
      setPage={setPage}
      title="Integrations & Workspace Apps"
      subtitle="Connect core enterprise communication stacks to synchronize schedules, contacts, and automated payloads."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <GoogleCalendarIntegrationCard />

        {/* Google Contacts */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E8ECF4", padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👥</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#22C55E", fontWeight: 500 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E" }} /> Connected
            </div>
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 8 }}>
            Google Contacts Index
          </div>
          <p style={{ fontSize: 13, color: "#7A8BAD", lineHeight: 1.6, marginBottom: 16 }}>
            Equip your voice channels to lookup inbound dialer identities, greet VIP accounts by name, and execute instant contact enrichment triggers.
          </p>
          <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 14 }}>
            {[
              { label: "Account Authority", value: "operations@acmeops.com" },
              { label: "Sync Directory Direction", chip: "Two-Way Sync (Bi-directional)" },
              { label: "Auto-Create Contacts", toggle: true, on: true },
            ].map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "#374151" }}>{row.label}</span>
                {row.toggle ? (
                  <Toggle on={row.on} />
                ) : row.chip ? (
                  <span style={{ fontSize: 12, color: "#374151", background: "#F3F4F6", borderRadius: 6, padding: "3px 10px" }}>{row.chip}</span>
                ) : (
                  <span style={{ fontSize: 13, color: "#7A8BAD" }}>{row.value}</span>
                )}
              </div>
            ))}
          </div>
          <button style={{ width: "100%", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, color: "#EF4444", background: "white", cursor: "pointer", fontFamily: "Inter", marginTop: 4 }}>
            Disconnect Google Contacts
          </button>
        </div>
      </div>

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
            All OAuth 2.0 access tokens granted by Google are fully isolated and securely hashed in Vocalist's vault. Inbound data fields are restricted purely to read calendar bounds and write approved event payload objects. We strictly conform to HIPAA &amp; SOC2 security architecture to keep customer information confidential.
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ─── Company Setup (app screen) ───────────────────────────────────────────────

function CompanySetupPage({ setPage }: { setPage: (p: Page) => void }) {
  const [companyName, setCompanyName] = useState("Acme Operations Inc.");
  const [websiteUrl, setWebsiteUrl] = useState("https://acmeops.com");
  const [companyPhone, setCompanyPhone] = useState("+1 (555) 019-2834");
  const [supportEmail, setSupportEmail] = useState("support@acmeops.com");
  const [timezone, setTimezone] = useState("America/New_York (EST)");
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function loadCompany() {
      try {
        const res = await fetch("/api/company-profile?user_id=00000000-0000-0000-0000-000000000001");
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
        console.error("Failed to load company profile:", e);
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
          user_id: "00000000-0000-0000-0000-000000000001",
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
              placeholder="e.g. Acme Operations Inc."
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
              placeholder="e.g. https://acmeops.com"
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
                placeholder="+1 (555) 019-2834"
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
                placeholder="support@acmeops.com"
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
                <option value="America/New_York (EST)">America/New_York (EST)</option>
                <option value="America/Los_Angeles (PST)">America/Los_Angeles (PST)</option>
                <option value="America/Chicago (CST)">America/Chicago (CST)</option>
                <option value="Europe/London (GMT)">Europe/London (GMT)</option>
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
            Your company parameters are used directly by Gemini Live to introduce your organization, schedule automatic workflows, and contextualize customer responses.
          </p>
          {["Persistent Neon Database Storage", "Automatic Voice Prompt Sync", "Direct CRM Entity Matching"].map((t) => (
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

function AssistantConfigPage({ setPage }: { setPage: (p: Page) => void }) {
  const [assistantName, setAssistantName] = useState("Support Agent – Charlie");
  const [voiceEngine, setVoiceEngine] = useState("Aoede");
  const [inboundGreeting, setInboundGreeting] = useState(
    'Thank you for calling Acme Operations Support. This is Ava, how can I assist you with your account settings today?'
  );
  const [systemPrompt, setSystemPrompt] = useState(
    'You are a support voice agent. Your tone is warm, polite and direct. Resolve return inquiries using the attached knowledge base. Never invent details outside Acme guidelines. If client requests a tier override, trigger salesforce routing.'
  );
  const [knowledgeBaseNotes, setKnowledgeBaseNotes] = useState("support_policies.pdf (Standard SLA & Return Policies)");
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function loadAssistant() {
      try {
        const res = await fetch("/api/assistant-config?user_id=00000000-0000-0000-0000-000000000001");
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            if (json.data.assistant_name) setAssistantName(json.data.assistant_name);
            if (json.data.voice_engine) setVoiceEngine(json.data.voice_engine);
            if (json.data.inbound_greeting) setInboundGreeting(json.data.inbound_greeting);
            if (json.data.system_prompt) setSystemPrompt(json.data.system_prompt);
            if (json.data.knowledge_base_notes) setKnowledgeBaseNotes(json.data.knowledge_base_notes);
          }
        }
      } catch (e) {
        console.error("Failed to load assistant configuration:", e);
      }
    }
    loadAssistant();
  }, []);

  const handleSave = async (deploy = false) => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/assistant-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: "00000000-0000-0000-0000-000000000001",
          assistant_name: assistantName,
          voice_engine: voiceEngine,
          inbound_greeting: inboundGreeting,
          system_prompt: systemPrompt,
          knowledge_base_notes: knowledgeBaseNotes,
        }),
      });
      if (res.ok) {
        setStatusMessage({
          text: deploy ? "Assistant deployed to production and saved to DB!" : "Draft saved to database successfully!",
          type: "success",
        });
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        setStatusMessage({ text: "Failed to save assistant configuration.", type: "error" });
      }
    } catch (e) {
      setStatusMessage({ text: "Network error saving assistant config.", type: "error" });
    } finally {
      setIsSaving(false);
    }
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
              value={inboundGreeting}
              onChange={(e) => setInboundGreeting(e.target.value)}
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
              style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "Inter", outline: "none", color: "#0D1526", resize: "vertical" }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>
              Knowledge Base Documents
            </label>
            <div style={{ border: "1.5px dashed #C7D2FE", borderRadius: 8, padding: "16px", textAlign: "center", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#3B5BDB", fontSize: 13, background: "#F8FAFF" }}>
              <IconUpload /> {knowledgeBaseNotes || "Upload support_policies.pdf or CSV data sheet"}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
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
              Deploy Assistant to Production
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
              Persistence Status
            </div>
            <div style={{ fontSize: 12, color: "#166534", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E" }} />
              Connected to Neon Database
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
  const [page, setPage] = useState<Page>("landing");

  const render = () => {
    switch (page) {
      case "landing": return <LandingPage setPage={setPage} />;
      case "signup": return <SignupPage setPage={setPage} />;
      case "onboarding-goals": return <GoalsPage setPage={setPage} />;
      case "onboarding-company": return <CompanySetupOnboardingPage setPage={setPage} />;
      case "onboarding-ai": return <AIConfigOnboardingPage setPage={setPage} />;
      case "dashboard": return <DashboardPage setPage={setPage} />;
      case "calls": return <CallsPage setPage={setPage} />;
      case "phone-numbers": return <PhoneNumbersPage setPage={setPage} />;
      case "integrations": return <IntegrationsPage setPage={setPage} />;
      case "company-setup": return <CompanySetupPage setPage={setPage} />;
      case "assistant-config": return <AssistantConfigPage setPage={setPage} />;
      case "testing-sandbox": return (
        <AppShell
          page="assistant-config"
          setPage={setPage}
          title="Interactive Voice Testing Sandbox"
          subtitle="Real-time conversational testing with Gemini Live"
        >
          <TestingSandboxPage onBack={() => setPage("assistant-config")} />
        </AppShell>
      );
    }
  };

  return <>{render()}</>;
}
