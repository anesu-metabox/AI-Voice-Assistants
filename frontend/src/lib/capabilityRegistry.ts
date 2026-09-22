import assistantPolicy from "./assistantPolicy.json";

export type CapabilityId =
  | "company_receptionist"
  | "company_faq"
  | "lead_qualification"
  | "google_calendar"
  | "threecx_call_transfer";

export const PLATFORM_POLICY_VERSION = "platform-v2";

export const CAPABILITY_REGISTRY: Record<CapabilityId, {
  tools: readonly string[];
  requiredIntegration?: "google_calendar" | "threecx";
  risk: "low" | "high";
  implemented: boolean;
}> = {
  company_receptionist: { tools: [], risk: "low", implemented: true },
  company_faq: { tools: [], risk: "low", implemented: true },
  lead_qualification: { tools: [], risk: "low", implemented: false },
  google_calendar: {
    tools: [
      "get_calendar_availability",
      "list_events",
      "book_event",
      "cancel_event",
    ],
    requiredIntegration: "google_calendar",
    risk: "high",
    implemented: true,
  },
  threecx_call_transfer: {
    tools: ["transfer_call", "hang_up_call"],
    requiredIntegration: "threecx",
    risk: "high",
    implemented: false,
  },
};

export function compileCompanyCapabilities(profile: {
  capabilities?: Partial<Record<CapabilityId, { enabled?: boolean }>>;
}) {
  const enabled = Object.entries(profile.capabilities ?? {})
    .filter(([, config]) => config?.enabled)
    .map(([id]) => id as CapabilityId)
    .filter((id) => id in CAPABILITY_REGISTRY);

  const unsupported = enabled.find((id) => !CAPABILITY_REGISTRY[id].implemented);
  if (unsupported) throw new Error(`Capability is not available yet: ${unsupported}`);
  if (enabled.length === 0) throw new Error("Enable at least one supported company capability");

  const tools = enabled.flatMap((id) => CAPABILITY_REGISTRY[id].tools);
  const integrations = enabled
    .map((id) => CAPABILITY_REGISTRY[id].requiredIntegration)
    .filter((value): value is "google_calendar" | "threecx" => Boolean(value));

  return {
    platformPolicyVersion: PLATFORM_POLICY_VERSION,
    capabilities: enabled,
    allowedTools: Array.from(new Set(tools)),
    requiredIntegrations: Array.from(new Set(integrations)),
    systemInstruction: [
      assistantPolicy.companyPolicyKernel,
      "ENABLED COMPANY CAPABILITIES:\n" + enabled.sort().map((id) => assistantPolicy.companyCapabilityInstructions[id as keyof typeof assistantPolicy.companyCapabilityInstructions]).join("\n"),
    ].join("\n\n"),
    redirectResponse: enabled.includes("google_calendar") && !enabled.some((id) => id === "company_faq" || id === "company_receptionist")
      ? assistantPolicy.calendarOnlyRedirectResponse
      : assistantPolicy.companyRedirectResponse,
  };
}
