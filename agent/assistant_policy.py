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


@dataclass(frozen=True)
class CompanyFactMatch:
    kind: str
    value: Any
    confidence: float


@dataclass(frozen=True)
class _CompiledFaqEntry:
    question: str
    answer: str
    folded_question: str
    tokens: frozenset[str]


@dataclass(frozen=True)
class _CompiledReferencePassage:
    value: str
    tokens: frozenset[str]


@dataclass(frozen=True)
class CompanyFactIndex:
    faq_entries: tuple[_CompiledFaqEntry, ...]
    reference_passages: tuple[_CompiledReferencePassage, ...]
    business_hours: Mapping[str, Any] | None
    contact: Mapping[str, str]
    website_url: str
    company_name: str
    timezone: str


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
    "have", "has", "had", "having", "if", "would", "should", "will", "shall",
    "may", "might", "must", "want", "wanted", "wants", "need", "needed", "needs",
    "know", "find", "get", "got", "provide", "share", "see",
    "offer", "offers", "offering", "available", "info", "information",
    "any", "some", "all", "much", "many", "more", "most", "also", "just",
    "a", "au", "aux", "avec", "ce", "ces", "dans", "de", "des", "du",
    "elle", "en", "est", "et", "il", "je", "la", "le", "les", "me",
    "nous", "ou", "pour", "que", "quel", "quelle", "quels", "quelles",
    "qui", "sur", "un", "une", "vous", "votre", "vos", "notre", "nos",
    "entreprise", "societe", "société", "restaurant", "pouvez", "dire",
    "avez", "avons", "ont", "avoir", "besoin", "voulez", "veut", "voudrais",
    "savoir", "trouver", "donner", "fournir", "voir", "proposez", "proposer",
    "disponible", "disponibles", "infos", "informations",
})


def _fold_text(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", value.casefold())
        if not unicodedata.combining(character)
    )


_FOLDED_COMPANY_QUERY_STOP_WORDS: Final[frozenset[str]] = frozenset(
    _fold_text(word) for word in _COMPANY_QUERY_STOP_WORDS
)
_COMPANY_TOKEN_ALIASES: Final[Mapping[str, str]] = {
    "opening": "open",
    "closing": "close",
    "opened": "open",
    "closed": "close",
    "horaires": "horaire",
    "parking": "park",
    "parks": "park",
    "parkings": "park",
    "stationnement": "park",
    "stationner": "park",
    "pricing": "price",
    "prices": "price",
    "prix": "price",
    "tarifs": "price",
    "tarif": "price",
    "cost": "price",
    "costs": "price",
    "location": "locate",
    "located": "locate",
    "address": "locate",
    "adresse": "locate",
    "directions": "locate",
    "direction": "locate",
    "wifi": "wifi",
    "internet": "wifi",
    "wi-fi": "wifi",
    "menus": "menu",
    "carte": "menu",
    "policy": "policy",
    "policies": "policy",
    "politique": "policy",
    "regles": "policy",
    "rule": "policy",
    "rules": "policy",
    "service": "serve",
    "services": "serve",
    "serving": "serve",
    "payment": "pay",
    "payments": "pay",
    "paiement": "pay",
    "paiements": "pay",
}


def _content_tokens(value: str) -> set[str]:
    tokens = set(re.findall(r"[a-z0-9]+", _fold_text(value))) - _FOLDED_COMPANY_QUERY_STOP_WORDS
    return {
        _COMPANY_TOKEN_ALIASES.get(
            token, token[:-1] if token.endswith("s") and len(token) > 4 else token
        )
        for token in tokens
    }


def _looks_like_reference_heading(value: str) -> bool:
    """Recognize a bounded section heading or bullet item title without treating arbitrary prose as one."""
    first_line = str(value).splitlines()[0].split("(", 1)[0].strip(" -:*•#0123456789.")
    letters = "".join(character for character in first_line if character.isalpha())
    if len(letters) < 3:
        return False
    # All caps heading
    if letters.upper() == letters:
        return True
    # Colon-delimited label/heading (e.g. "Parking: free on site", "1. Office Location: Floor 2")
    raw_first_line = str(value).splitlines()[0].strip()
    if ":" in raw_first_line:
        heading_prefix = raw_first_line.split(":", 1)[0].strip(" -:*•#0123456789.")
        if 3 <= len(heading_prefix) <= 40:
            return True
    # Short title phrase (up to 4 words and 30 characters)
    words = first_line.split()
    if len(words) <= 4 and len(first_line) <= 30:
        return True
    return False


def compile_company_fact_index(
    company_context: Mapping[str, Any] | None,
) -> CompanyFactIndex | None:
    """Compile bounded immutable company facts once per published session."""
    if not company_context:
        return None

    faq_entries: list[_CompiledFaqEntry] = []
    entries = company_context.get("faq_entries", [])
    if isinstance(entries, list):
        for entry in entries[:20]:
            if not isinstance(entry, Mapping):
                continue
            question = entry.get("question")
            answer = entry.get("answer")
            if not isinstance(question, str) or not isinstance(answer, str):
                continue
            bounded_question = question[:240]
            tokens = frozenset(_content_tokens(bounded_question))
            if len(tokens) < 2:
                continue
            faq_entries.append(
                _CompiledFaqEntry(
                    question=bounded_question,
                    answer=answer[:1200],
                    folded_question=_fold_text(bounded_question).strip(),
                    tokens=tokens,
                )
            )

    reference_passages: list[_CompiledReferencePassage] = []
    notes = company_context.get("knowledge_base_notes")
    if isinstance(notes, str) and notes.strip():
        # Split on double newlines, bullet points, numbered lists, or sentence boundaries
        raw_chunks = re.split(
            r"\n{2,}|\n(?=\s*[-*•]|\s*\d+[.)])|(?<=[.!?])\s+(?=[A-ZÀ-Ö])",
            notes[:16000],
        )
        passages = [chunk.strip() for chunk in raw_chunks if chunk.strip()]
        for passage in passages[:60]:
            bounded_passage = passage[:1200]
            tokens = frozenset(_content_tokens(bounded_passage))
            if tokens:
                reference_passages.append(
                    _CompiledReferencePassage(bounded_passage, tokens)
                )

    hours = company_context.get("business_hours")
    business_hours = dict(hours) if isinstance(hours, Mapping) and hours else None
    contact = {
        key: str(company_context[key])
        for key in ("support_email", "phone", "company_phone")
        if isinstance(company_context.get(key), str)
        and str(company_context[key]).strip()
    }
    return CompanyFactIndex(
        faq_entries=tuple(faq_entries),
        reference_passages=tuple(reference_passages),
        business_hours=business_hours,
        contact=contact,
        website_url=(
            str(company_context.get("website_url"))[:2048]
            if company_context.get("website_url")
            else ""
        ),
        company_name=(
            str(company_context.get("company_name"))[:255]
            if company_context.get("company_name")
            else ""
        ),
        timezone=(
            str(company_context.get("timezone"))[:64]
            if company_context.get("timezone")
            else ""
        ),
    )


def match_approved_company_fact(
    text: str,
    company_context: Mapping[str, Any] | None = None,
    *,
    compiled_index: CompanyFactIndex | None = None,
) -> CompanyFactMatch | None:
    """Return one strong, bounded approved fact match or fail closed."""
    index = compiled_index or compile_company_fact_index(company_context)
    if index is None:
        return None
    query_tokens = _content_tokens(text)
    folded = _fold_text(text).strip()
    best: CompanyFactMatch | None = None

    for entry in index.faq_entries:
        reference_tokens = entry.tokens
        overlap = len(query_tokens & reference_tokens)
        confidence = min(
            overlap / len(reference_tokens),
            overlap / max(1, len(query_tokens)),
        )
        if folded == entry.folded_question:
            confidence = 1.0
        strong_overlap = overlap >= 2 or (overlap == 1 and len(query_tokens) == 1)
        if strong_overlap and confidence >= 0.5 and (
            best is None or confidence > best.confidence
        ):
            best = CompanyFactMatch(
                "faq",
                {"question": entry.question, "answer": entry.answer},
                confidence,
            )

    # Allow explicit inquiries about notes / reference materials
    if index.reference_passages and (
        re.search(r"\b(reference|notes?|knowledge|doc(?:s|ument)?|information)\b", folded)
        and query_tokens <= {"reference", "note", "knowledge", "doc", "document", "info", "information", "check", "verify", "consulter"}
    ):
        first_passage = index.reference_passages[0].value
        return CompanyFactMatch("reference", first_passage, 1.0)

    for passage in index.reference_passages:
        passage_tokens = passage.tokens
        overlap = len(query_tokens & passage_tokens)
        query_coverage = overlap / max(1, len(query_tokens))
        single_heading_match = (
            len(query_tokens) == 1
            and overlap == 1
            and _looks_like_reference_heading(passage.value)
        )
        # Bounded match: either >=2 overlapping content tokens covering >=50% of query,
        # or >=1 token for single-token queries on headings/bullets,
        # or >=3 tokens overlap on longer queries with at least 40% coverage
        strong_passage_match = (
            (overlap >= 2 and query_coverage >= 0.5)
            or (overlap >= 3 and query_coverage >= 0.4)
            or single_heading_match
        )
        if strong_passage_match:
            confidence = min(0.95, query_coverage)
            if best is None or confidence > best.confidence:
                best = CompanyFactMatch("reference", passage.value, confidence)

    if best is not None:
        return best

    if (
        index.business_hours
        and re.search(r"\b(hours?|open(?:ing)?|clos(?:e|ing)|horaires?|ouvert(?:ure)?|ferme(?:ture)?)\b", folded)
        and query_tokens <= {"hour", "hours", "open", "opening", "clos", "close", "closing", "horaire", "horaires", "ouvert", "ouverture", "ferme", "fermeture", "quand"}
    ):
        return CompanyFactMatch("business_hours", dict(index.business_hours), 1.0)
    if index.contact and re.search(r"\b(contact|support|email|phone|courriel|telephone|numero)\b", folded) and query_tokens <= {"contact", "support", "email", "phone", "number", "courriel", "telephone", "numero"}:
        return CompanyFactMatch("contact", dict(index.contact), 1.0)
    if index.website_url and re.search(r"\b(website|web\s*site|site web|url)\b", folded) and query_tokens <= {"website", "web", "site", "url"}:
        return CompanyFactMatch("website", index.website_url, 1.0)
    if index.company_name and re.search(
        r"\b(company|business)\s+name\b|\bwho\s+are\s+you\b|\bnom\s+(de\s+)?(l'entreprise|la societe|du restaurant)\b|\bqui etes-vous\b",
        folded,
    ) and query_tokens <= {"company", "business", "name", "who", "nom", "societe", "restaurant", "etes"}:
        return CompanyFactMatch("company_name", index.company_name, 1.0)
    if index.timezone and re.search(r"\btime\s*zone\b|\bfuseau\s*horaire\b", folded) and query_tokens <= {"time", "zone", "fuseau", "horaire"}:
        return CompanyFactMatch("timezone", index.timezone, 1.0)
    return None


def _matches_approved_company_content(
    text: str,
    enabled_capabilities: set[str],
    company_context: Mapping[str, Any] | None,
    company_fact_index: CompanyFactIndex | None = None,
) -> bool:
    """Allow FAQ matches or questions about configured company facts & reference notes."""
    match = match_approved_company_fact(
        text, company_context, compiled_index=company_fact_index
    )
    if match is None:
        return False
    if match.kind in {"faq", "reference"}:
        return bool({"company_faq", "company_receptionist"} & enabled_capabilities)
    return bool({"company_faq", "company_receptionist"} & enabled_capabilities)


def classify_assistant_turn(
    user_input: str,
    calendar_context_active: bool = False,
    company_capabilities: dict[str, object] | None = None,
    company_context: Mapping[str, Any] | None = None,
    company_fact_index: CompanyFactIndex | None = None,
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
        text, enabled_capabilities, company_context, company_fact_index
    ):
        return ScopeDecision("allow", "company_capability", False)

    return ScopeDecision("redirect", "off_topic", False)


_LANGUAGE_SWITCH_PATTERNS: Final[tuple[tuple[str, tuple[re.Pattern[str], ...]], ...]] = (
    (
        "fr-BE",
        (
            re.compile(r"^\s*(?:please\s+)?(?:speak|switch|continue|respond|use|talk|change)(?:\s+to|\s+in)?\s+(?:belgian french|french from belgium|french belgium)\s*[.!?]*$"),
            re.compile(r"^\s*(?:parle|parlez|reponds|repondez|continue|continuez|passe|passez|pouvez-vous parler|parlez-vous)(?:\s+en|\s+le|\s+du)?\s+francais\s+(?:belge|de\s+belgique)(?:\s*,?\s*(?:s[’']il vous plait|svp|please))?\s*[.!?]*$"),
            re.compile(r"^\s*(?:in|en|dans un)\s+francais\s+(?:belge|de\s+belgique)\s*[.!?]*$"),
            re.compile(r"^\s*(?:belgian french|french from belgium|french belgium|francais belge|francais de belgique)\s*[.!?]*$"),
        ),
    ),
    (
        "en",
        (
            re.compile(r"^\s*(?:please\s+)?(?:speak|switch|continue|respond|use|talk|change)(?:\s+to|\s+in)?\s+english(?:\s*,?\s*please)?\s*[.!?]*$"),
            re.compile(r"^\s*(?:(?:can|could)\s+you|can\s+we|please)?\s*(?:speak|talk|switch|continue|respond|use)\s+(?:in\s+)?english(?:\s*,?\s*please)?\s*[.!?]*$"),
            re.compile(r"^\s*(?:parle|parlez|reponds|repondez|continue|continuez|passe|passez|pouvez-vous parler|parlez-vous)(?:\s+en|\s+le)?\s+anglais(?:\s*,?\s*(?:s[’']il vous plait|svp|please))?\s*[.!?]*$"),
            re.compile(r"^\s*(?:in english|en anglais)\s*[.!?]*$"),
            re.compile(r"^\s*(?:english|anglais)\s*[.!?]*$"),
        ),
    ),
    (
        "fr-FR",
        (
            re.compile(r"^\s*(?:please\s+)?(?:speak|switch|continue|respond|use|talk|change)(?:\s+to|\s+in)?\s+(?:general\s+)?french(?:\s*,?\s*please)?\s*[.!?]*$"),
            re.compile(r"^\s*(?:(?:can|could)\s+you|can\s+we|please)?\s*(?:speak|talk|switch|continue|respond|use)\s+(?:in\s+)?(?:general\s+)?french(?:\s*,?\s*please)?\s*[.!?]*$"),
            re.compile(r"^\s*(?:parle|parlez|reponds|repondez|continue|continuez|passe|passez|pouvez-vous parler|parlez-vous)(?:\s+en|\s+le)?\s+francais(?:\s*,?\s*(?:s[’']il vous plait|svp|please))?\s*[.!?]*$"),
            re.compile(r"^\s*(?:in french|en francais)\s*[.!?]*$"),
            re.compile(r"^\s*(?:french|general french|francais)\s*[.!?]*$"),
        ),
    ),
)

_EXPLICIT_LANGUAGE_REQUEST_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"\b(?:speak|switch|continue|respond|use|talk|change)(?:\s+to|\s+in)?\s+[a-z][a-z -]{1,30}\b"),
    re.compile(r"\b(?:parle|parlez|reponds|repondez|continue|continuez|passe|passez|pouvez-vous parler|parlez-vous)(?:\s+en|\s+le)?\s+[a-z][a-z -]{1,30}\b"),
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
