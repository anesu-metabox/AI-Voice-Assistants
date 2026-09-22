"""Disabled legacy contacts compatibility surface."""

from typing import Any, Dict

async def search_contacts(
    query: str,
    limit: int = 5,
) -> Dict[str, Any]:
    raise RuntimeError("contacts capability is disabled")
