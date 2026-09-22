"""Server-owned company capability registry and policy compilation.

Company onboarding can enable registered capabilities, but it cannot create
tools or change platform security rules. The compiled result is the only
configuration that should be used to build a LiveKit/Gemini session.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Mapping

from .policy import policy_document

_BUSINESS_HOURS_RE = re.compile(
    r"^((?:[01]\d|2[0-3]):[0-5]\d)\s*-\s*((?:[01]\d|2[0-3]):[0-5]\d)$"
)


@dataclass(frozen=True)
class Capability:
    name: str
    tools: tuple[str, ...]
    required_integration: str | None = None
    risk: str = "low"
    implemented: bool = True


CAPABILITY_REGISTRY: dict[str, Capability] = {
    "company_receptionist": Capability("company_receptionist", ()),
    "company_faq": Capability("company_faq", ()),
    "lead_qualification": Capability("lead_qualification", (), implemented=False),
    "google_calendar": Capability(
        "google_calendar",
        tuple(policy_document()["allowedTools"]),
        required_integration="google_calendar",
        risk="high",
    ),
    "threecx_call_transfer": Capability(
        "threecx_call_transfer",
        ("transfer_call", "hang_up_call"),
        required_integration="threecx",
        risk="high",
        implemented=False,
    ),
}

PLATFORM_POLICY_VERSION = "platform-v2"


class CapabilityValidationError(ValueError):
    """Raised when a company profile requests unsupported authority."""


def compile_company_policy(profile: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and compile company configuration into an execution policy."""
    requested = profile.get("capabilities", {}) or {}
    if not isinstance(requested, Mapping):
        raise CapabilityValidationError("capabilities must be an object")

    enabled: dict[str, dict[str, Any]] = {}
    tools: set[str] = set()
    integrations: set[str] = set()
    for name, config in requested.items():
        if name not in CAPABILITY_REGISTRY:
            raise CapabilityValidationError(f"Unsupported capability: {name}")
        if not isinstance(config, Mapping):
            config = {"enabled": bool(config)}
        if not config.get("enabled", False):
            continue
        capability = CAPABILITY_REGISTRY[name]
        if not capability.implemented:
            raise CapabilityValidationError(f"Capability is not available yet: {name}")
        tools.update(capability.tools)
        if capability.required_integration:
            integrations.add(capability.required_integration)
        enabled[name] = {
            "enabled": True,
            "tools": list(capability.tools),
            "risk": capability.risk,
        }
    if not enabled:
        raise CapabilityValidationError("Enable at least one supported company capability")

    # Tenant instructions are data below the platform policy. They never
    # replace it or grant tools. Keep the field bounded before persistence.
    instructions = str(profile.get("instructions", ""))
    if len(instructions) > 8000:
        raise CapabilityValidationError("instructions exceeds the 8000 character limit")

    business_rules = profile.get("businessRules", {}) or {}
    if not isinstance(business_rules, Mapping):
        raise CapabilityValidationError("businessRules must be an object")
    tone = business_rules.get("tone", "friendly")
    if not isinstance(tone, str) or tone not in {"professional", "friendly", "warm", "concise"}:
        raise CapabilityValidationError("tone must be a supported response style")
    hours = business_rules.get("business_hours", {}) or {}
    valid_days = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
    if not isinstance(hours, Mapping) or len(hours) > 7:
        raise CapabilityValidationError("business_hours must contain at most seven weekdays")
    normalized_hours: dict[str, str] = {}
    for day, value in hours.items():
        if not isinstance(day, str) or day.lower() not in valid_days:
            raise CapabilityValidationError("business_hours contains an invalid weekday")
        if not isinstance(value, str) or len(value) > 100:
            raise CapabilityValidationError("each business_hours value must be text up to 100 characters")
        normalized_value = value.strip().replace("–", "-").replace("—", "-")
        if not normalized_value or normalized_value.casefold() == "closed":
            normalized_hours[day.lower()] = "closed"
            continue
        match = _BUSINESS_HOURS_RE.fullmatch(normalized_value)
        if not match:
            raise CapabilityValidationError(
                "business_hours values must be 'Closed' or use HH:MM-HH:MM 24-hour local time"
            )
        start_hour, start_minute = (int(part) for part in match.group(1).split(":"))
        end_hour, end_minute = (int(part) for part in match.group(2).split(":"))
        if (start_hour, start_minute) >= (end_hour, end_minute):
            raise CapabilityValidationError("business_hours ranges must end after they start on the same day")
        normalized_hours[day.lower()] = f"{match.group(1)}-{match.group(2)}"
    escalation_rules = business_rules.get("escalation_rules", []) or []
    if not isinstance(escalation_rules, list) or len(escalation_rules) > 10:
        raise CapabilityValidationError("escalation_rules must contain at most ten items")
    if any(not isinstance(rule, str) or len(rule) > 500 for rule in escalation_rules):
        raise CapabilityValidationError("each escalation rule must be text up to 500 characters")
    faq_entries = profile.get("faqEntries", []) or []
    if not isinstance(faq_entries, list) or len(faq_entries) > 20:
        raise CapabilityValidationError("faqEntries must contain at most twenty items")
    normalized_faq: list[dict[str, str]] = []
    for item in faq_entries:
        if not isinstance(item, Mapping):
            raise CapabilityValidationError("each FAQ entry must be an object")
        question, answer = item.get("question"), item.get("answer")
        if not isinstance(question, str) or not question.strip() or len(question) > 240:
            raise CapabilityValidationError("each FAQ question must be 1-240 characters")
        if not isinstance(answer, str) or not answer.strip() or len(answer) > 1200:
            raise CapabilityValidationError("each FAQ answer must be 1-1200 characters")
        normalized_faq.append({"question": question.strip(), "answer": answer.strip()})
    if normalized_faq and "company_faq" not in enabled:
        raise CapabilityValidationError("FAQ entries require the Company FAQs capability")

    policy = policy_document()
    capability_instructions = [
        policy["companyCapabilityInstructions"][name]
        for name in sorted(enabled)
    ]
    calendar_enabled = "google_calendar" in enabled
    company_scope_enabled = bool({"company_receptionist", "company_faq"} & enabled.keys())
    redirect = (
        policy["calendarOnlyRedirectResponse"]
        if calendar_enabled and not company_scope_enabled
        else policy["companyRedirectResponse"]
    )

    return {
        "platformPolicyVersion": PLATFORM_POLICY_VERSION,
        "capabilities": enabled,
        "allowedTools": sorted(tools),
        "requiredIntegrations": sorted(integrations),
        "redirectResponse": redirect,
        "calendarUnavailableRedirectResponse": policy["calendarUnavailableRedirectResponse"],
        "systemInstruction": "\n\n".join([
            policy["companyPolicyKernel"],
            "ENABLED COMPANY CAPABILITIES:\n" + "\n".join(capability_instructions),
        ]),
        "assistant": dict(profile.get("assistant", {}) or {}),
        "businessRules": {
            "tone": tone,
            "business_hours": normalized_hours,
            "escalation_rules": list(escalation_rules),
        },
        "faqEntries": normalized_faq,
        "companyInstructions": instructions,
    }
