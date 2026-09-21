"""Canonical calendar-only assistant policy loader and deterministic scope guard."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Final, Literal


_POLICY_PATH: Final[Path] = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "assistantPolicy.json"
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
        "social",
        "hard_diversion",
        "off_topic",
        "empty_input",
    ]
    calendar_context_active: bool


def _load_policy() -> AssistantPolicy:
    raw = json.loads(_POLICY_PATH.read_text(encoding="utf-8"))
    return AssistantPolicy(
        version=raw["version"],
        redirect_response=raw["redirectResponse"],
        allowed_tools=tuple(raw["allowedTools"]),
        system_instruction=raw["systemInstruction"],
        patterns={name: tuple(values) for name, values in raw["patterns"].items()},
    )


ASSISTANT_POLICY: Final[AssistantPolicy] = _load_policy()
CALENDAR_SYSTEM_INSTRUCTION: Final[str] = ASSISTANT_POLICY.system_instruction
CALENDAR_REDIRECT_RESPONSE: Final[str] = ASSISTANT_POLICY.redirect_response
CALENDAR_TOOL_NAMES: Final[frozenset[str]] = frozenset(ASSISTANT_POLICY.allowed_tools)

_COMPILED_PATTERNS: Final[dict[str, tuple[re.Pattern[str], ...]]] = {
    name: tuple(re.compile(pattern, re.IGNORECASE) for pattern in patterns)
    for name, patterns in ASSISTANT_POLICY.patterns.items()
}


def _matches(group: str, text: str) -> bool:
    return any(pattern.search(text) for pattern in _COMPILED_PATTERNS[group])


def is_allowed_calendar_tool(tool_name: str) -> bool:
    return tool_name in CALENDAR_TOOL_NAMES


def classify_assistant_turn(
    user_input: str,
    calendar_context_active: bool = False,
) -> ScopeDecision:
    text = user_input.strip().lower()
    if not text:
        return ScopeDecision("redirect", "empty_input", False)

    if _matches("hardDiversion", text):
        return ScopeDecision("redirect", "hard_diversion", False)

    if _matches("offTopic", text):
        return ScopeDecision("redirect", "off_topic", False)

    if _matches("calendarIntent", text):
        return ScopeDecision("allow", "calendar_intent", True)

    if _matches("social", text):
        return ScopeDecision("allow", "social", calendar_context_active)

    if calendar_context_active and _matches("calendarFollowUp", text):
        return ScopeDecision("allow", "calendar_follow_up", True)

    return ScopeDecision("redirect", "off_topic", False)
