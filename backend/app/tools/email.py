"""Disabled legacy email compatibility surface."""

from typing import Any, Dict, List, Optional

async def draft_email(
    recipient_email: str,
    subject: str,
    body: str,
    cc: Optional[List[str]] = None,
) -> Dict[str, Any]:
    raise RuntimeError("email capability is disabled")
