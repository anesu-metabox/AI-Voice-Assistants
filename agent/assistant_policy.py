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
import unicodedata


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
    action: Literal["allow", "clarify", "redirect"]
    reason: Literal[
        "calendar_intent",
        "calendar_follow_up",
        "company_capability",
        "calendar_unavailable",
        "social",
        "hard_diversion",
        "off_topic",
        "unsupported_language",
        "unclear_input",
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
    "a", "au", "aux", "avec", "ce", "ces", "dans", "de", "des", "du",
    "elle", "en", "est", "et", "il", "je", "la", "le", "les", "me",
    "nous", "ou", "pour", "que", "quel", "quelle", "quels", "quelles",
    "qui", "sur", "un", "une", "vous", "votre", "vos", "notre", "nos",
    "entreprise", "societe", "société", "restaurant", "pouvez", "dire",
})


def _fold_text(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", value.casefold())
        if not unicodedata.combining(character)
    )


def _content_tokens(value: str) -> set[str]:
    tokens = set(re.findall(r"[a-z0-9]+", _fold_text(value))) - {
        _fold_text(word) for word in _COMPANY_QUERY_STOP_WORDS
    }
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
        and re.search(r"\b(hours?|open(?:ing)?|clos(?:e|ing)|horaires?|ouvert(?:ure)?|ferme(?:ture)?)\b", _fold_text(text))
        and query_tokens <= {"hour", "hours", "open", "opening", "clos", "close", "closing", "when", "horaire", "horaires", "ouvert", "ouverture", "ferme", "fermeture", "quand"}
    ):
        return True
    has_contact = any(
        isinstance(company_context.get(key), str) and company_context[key].strip()
        for key in ("support_email", "phone", "company_phone")
    )
    if (
        has_contact
        and re.search(r"\b(contact|support|email|phone|courriel|telephone|numero)\b", _fold_text(text))
        and query_tokens <= {"contact", "support", "email", "phone", "number", "courriel", "telephone", "numero"}
    ):
        return True
    if (
        company_context.get("website_url")
        and re.search(r"\b(website|web\s*site|site web|url)\b", _fold_text(text))
        and query_tokens <= {"website", "web", "site", "url"}
    ):
        return True
    if company_context.get("company_name") and re.search(
        r"\b(company|business)\s+name\b|\bwho\s+are\s+you\b|\bnom\s+(de\s+)?(l'entreprise|la societe|du restaurant)\b|\bqui etes-vous\b", _fold_text(text)
    ) and query_tokens <= {"company", "business", "name", "who", "nom", "societe", "restaurant", "etes"}:
        return True
    if (
        company_context.get("timezone")
        and re.search(r"\btime\s*zone\b|\bfuseau\s*horaire\b", _fold_text(text))
        and query_tokens <= {"time", "zone", "fuseau", "horaire"}
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
        return ScopeDecision("clarify", "empty_input", calendar_context_active)

    if _matches("unclear", text):
        return ScopeDecision("clarify", "unclear_input", calendar_context_active)

    if is_explicit_language_request(text) and detect_explicit_language_switch(text) is None:
        return ScopeDecision("clarify", "unsupported_language", calendar_context_active)

    if _matches("unsupportedLanguage", text):
        return ScopeDecision("clarify", "unsupported_language", calendar_context_active)

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


_LANGUAGE_SWITCH_PATTERNS: Final[tuple[tuple[str, tuple[re.Pattern[str], ...]], ...]] = (
    (
        "fr-BE",
        (
            re.compile(r"\b(?:speak|switch to|continue in|respond in|use)\s+(?:belgian french|french from belgium|french belgium)\b"),
            re.compile(r"\b(?:parle|parlez|reponds|repondez|continue|continuez|passe|passez)\s+(?:en\s+)?francais\s+(?:belge|de\s+belgique)\b"),
            re.compile(r"\b(?:en|dans un)\s+francais\s+(?:belge|de\s+belgique)\b"),
            re.compile(r"^(?:belgian french|french from belgium|french belgium|francais belge|francais de belgique)$"),
        ),
    ),
    (
        "en",
        (
            re.compile(r"\b(?:speak|switch to|continue in|respond in|use)\s+english\b"),
            re.compile(r"\b(?:parle|parlez|reponds|repondez|continue|continuez|passe|passez)\s+(?:en\s+)?anglais\b"),
            re.compile(r"\b(?:in english|en anglais)\b"),
            re.compile(r"^(?:english|anglais)$"),
        ),
    ),
    (
        "fr-FR",
        (
            re.compile(r"\b(?:speak|switch to|continue in|respond in|use)\s+(?:general\s+)?french\b"),
            re.compile(r"\b(?:parle|parlez|reponds|repondez|continue|continuez|passe|passez)\s+(?:en\s+)?francais\b"),
            re.compile(r"\b(?:in french|en francais)\b"),
            re.compile(r"^(?:french|general french|francais)$"),
        ),
    ),
)

_EXPLICIT_LANGUAGE_REQUEST_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"\b(?:speak|switch to|continue in|respond in|use)\s+[a-z][a-z -]{1,30}\b"),
    re.compile(r"\b(?:parle|parlez|reponds|repondez|continue|continuez|passe|passez)\s+(?:en\s+)?[a-z][a-z -]{1,30}\b"),
)


def detect_explicit_language_switch(user_input: str) -> str | None:
    """Return an explicitly requested response mode without inferring from input language."""
    text = _fold_text(user_input)
    for language, patterns in _LANGUAGE_SWITCH_PATTERNS:
        if any(pattern.search(text) for pattern in patterns):
            return language
    return None


def is_explicit_language_request(user_input: str) -> bool:
    """Return true for a clear request to use a language, supported or not."""
    text = _fold_text(user_input).strip(" .!?\t\r\n")
    return any(pattern.search(text) for pattern in _EXPLICIT_LANGUAGE_REQUEST_PATTERNS)
