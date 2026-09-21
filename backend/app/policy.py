"""Canonical assistant policy loading and backend enforcement helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


_POLICY_PATH = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "assistantPolicy.json"
_POLICY: dict[str, Any] = json.loads(_POLICY_PATH.read_text(encoding="utf-8"))

ACTIVE_TOOL_NAMES = frozenset(_POLICY["allowedTools"])
REDIRECT_RESPONSE = _POLICY["redirectResponse"]


def is_active_tool(tool_name: str) -> bool:
    return tool_name in ACTIVE_TOOL_NAMES


def policy_document() -> dict[str, Any]:
    return _POLICY
