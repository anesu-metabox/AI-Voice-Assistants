"""Canonical assistant policy loader and deterministic scope guard.

The policy file is shared with the browser runtime.  This module deliberately
keeps the executable tool surface smaller than the conversational prompt: the
backend and this worker must both enforce the allowlist independently of what
Gemini says.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any, Final, Literal, Mapping


_POLICY_PATH: Final[Path] = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "assistantPolicy.json"
)

_REQUIRED_CALENDAR_TOOLS: Final[frozenset[str]] = frozenset(
    {
        "get_calendar_availability",
        "list_events",
        "book_event",
        "cancel_event",
    }
)


@dataclass(frozen=True)
class AssistantPolicy:
    version: str
    redirect_response: str
    allowed_tools: tuple[str, ...]
    system_instruction: str
    patterns: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class ScopeDecision:
    action: Literal["allow", "redirect"]
    reason: Literal[
        "calendar_intent",
        "calendar_follow_up",
        "company_capability",
        "calendar_unavailable",
        "social",
        "hard_diversion",
        "off_topic",
        "empty_input",
    ]
    calendar_context_active: bool


def _load_policy() -> AssistantPolicy:
    raw = json.loads(_POLICY_PATH.read_text(encoding="utf-8"))
    allowed_tools = tuple(raw["allowedTools"])
    if set(allowed_tools) != _REQUIRED_CALENDAR_TOOLS or len(allowed_tools) != len(
        _REQUIRED_CALENDAR_TOOLS
    ):
        raise ValueError(
            "The shared assistant policy must expose exactly the four calendar tools."
        )
    return AssistantPolicy(
        version=raw["version"],
        redirect_response=raw["redirectResponse"],
        allowed_tools=allowed_tools,
        system_instruction=raw["systemInstruction"],
        patterns={name: tuple(values) for name, values in raw["patterns"].items()},
    )


ASSISTANT_POLICY: Final[AssistantPolicy] = _load_policy()
CALENDAR_SYSTEM_INSTRUCTION: Final[str] = ASSISTANT_POLICY.system_instruction
CALENDAR_REDIRECT_RESPONSE: Final[str] = ASSISTANT_POLICY.redirect_response
CALENDAR_UNAVAILABLE_REDIRECT_RESPONSE: Final[str] = json.loads(
    _POLICY_PATH.read_text(encoding="utf-8")
)["calendarUnavailableRedirectResponse"]
CALENDAR_TOOL_NAMES: Final[frozenset[str]] = frozenset(ASSISTANT_POLICY.allowed_tools)
ASSISTANT_POLICY_VERSION: Final[str] = ASSISTANT_POLICY.version

_COMPILED_PATTERNS: Final[dict[str, tuple[re.Pattern[str], ...]]] = {
    name: tuple(re.compile(pattern, re.IGNORECASE) for pattern in patterns)
    for name, patterns in ASSISTANT_POLICY.patterns.items()
}


def _matches(group: str, text: str) -> bool:
    return any(pattern.search(text) for pattern in _COMPILED_PATTERNS[group])


def is_allowed_calendar_tool(tool_name: str) -> bool:
    return tool_name in CALENDAR_TOOL_NAMES


_COMPANY_QUERY_STOP_WORDS: Final[frozenset[str]] = frozenset({
    "a", "an", "and", "are", "can", "could", "do", "does", "for", "from",
    "give", "how", "i", "in", "is", "it", "me", "of", "on", "please",
    "tell", "the", "there", "to", "what", "when", "where", "which", "who",
    "you", "your", "we", "our", "company", "business", "about",
})


def _content_tokens(value: str) -> set[str]:
    tokens = set(re.findall(r"[a-z0-9]+", value.lower())) - _COMPANY_QUERY_STOP_WORDS
    # Normalize a few common inflections without introducing a model or dependency.
    return {token[:-1] if token.endswith("s") and len(token) > 4 else token for token in tokens}


def _matches_approved_company_content(
    text: str,
    enabled_capabilities: set[str],
    company_context: Mapping[str, Any] | None,
) -> bool:
    """Allow only FAQ matches or questions about configured company facts."""
    if not company_context:
        return False

    if "company_faq" in enabled_capabilities:
        query_tokens = _content_tokens(text)
        entries = company_context.get("faq_entries", [])
        if isinstance(entries, list):
            for entry in entries[:20]:
                if not isinstance(entry, Mapping):
                    continue
                question = entry.get("question")
                answer = entry.get("answer")
                if not isinstance(question, str) or not isinstance(answer, str):
                    continue
                reference_tokens = _content_tokens(question)
                if len(reference_tokens) < 2:
                    continue
                overlap = len(query_tokens & reference_tokens)
                if (
                    overlap >= 2
                    and overlap / len(reference_tokens) >= 0.5
                    and overlap / max(1, len(query_tokens)) >= 0.65
                ):
                    return True

    if not ({"company_faq", "company_receptionist"} & enabled_capabilities):
        return False

    query_tokens = _content_tokens(text)
    hours = company_context.get("business_hours")
    if (
        isinstance(hours, Mapping)
        and hours
        and re.search(r"\b(hours?|open(?:ing)?|clos(?:e|ing))\b", text)
        and query_tokens <= {"hour", "hours", "open", "opening", "clos", "close", "closing", "when"}
    ):
        return True
    has_contact = any(
        isinstance(company_context.get(key), str) and company_context[key].strip()
        for key in ("support_email", "phone", "company_phone")
    )
    if (
        has_contact
        and re.search(r"\b(contact|support|email|phone)\b", text)
        and query_tokens <= {"contact", "support", "email", "phone", "number"}
    ):
        return True
    if (
        company_context.get("website_url")
        and re.search(r"\b(website|web\s*site|url)\b", text)
        and query_tokens <= {"website", "web", "site", "url"}
    ):
        return True
    if company_context.get("company_name") and re.search(
        r"\b(company|business)\s+name\b|\bwho\s+are\s+you\b", text
    ) and query_tokens <= {"company", "business", "name", "who"}:
        return True
    if (
        company_context.get("timezone")
        and re.search(r"\btime\s*zone\b", text)
        and query_tokens <= {"time", "zone"}
    ):
        return True
    return False


def classify_assistant_turn(
    user_input: str,
    calendar_context_active: bool = False,
    company_capabilities: dict[str, object] | None = None,
    company_context: Mapping[str, Any] | None = None,
) -> ScopeDecision:
    if company_capabilities is None:
        enabled_capabilities = {"google_calendar"}
    else:
        enabled_capabilities = {
            name
            for name, config in company_capabilities.items()
            if (config.get("enabled", False) if isinstance(config, dict) else bool(config))
        }
    calendar_enabled = "google_calendar" in enabled_capabilities
    company_scope_enabled = bool(
        {"company_receptionist", "company_faq"} & enabled_capabilities
    )

    text = user_input.strip().lower()
    if not text:
        return ScopeDecision("redirect", "empty_input", False)

    if _matches("hardDiversion", text):
        return ScopeDecision("redirect", "hard_diversion", False)

    if _matches("offTopic", text):
        return ScopeDecision("redirect", "off_topic", False)

    if _matches("calendarIntent", text):
        if calendar_enabled:
            return ScopeDecision("allow", "calendar_intent", True)
        return ScopeDecision("redirect", "calendar_unavailable", False)

    if _matches("social", text):
        return ScopeDecision("allow", "social", calendar_context_active)

    if calendar_context_active and _matches("calendarFollowUp", text):
        if calendar_enabled:
            return ScopeDecision("allow", "calendar_follow_up", True)
        return ScopeDecision("redirect", "calendar_unavailable", False)

    if company_scope_enabled and _matches_approved_company_content(
        text, enabled_capabilities, company_context
    ):
        return ScopeDecision("allow", "company_capability", False)

    return ScopeDecision("redirect", "off_topic", False)
