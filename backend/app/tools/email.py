"""
Email Direct Tools
Provides email draft creation and preview.
Includes realistic mock fallback with simulated network latency (<150ms).
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional
import uuid

logger = logging.getLogger("voice_bot.tools.email")


async def draft_email(
    recipient_email: str,
    subject: str,
    body: str,
    cc: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Prepare a new email draft for executive review.
    """
    logger.info("Drafting email to %s with subject '%s'", recipient_email, subject)

    # Simulate realistic external API latency (130ms)
    await asyncio.sleep(0.13)

    draft_id = f"drf_{uuid.uuid4().hex[:12]}"
    snippet = body[:120] + ("..." if len(body) > 120 else "")

    return {
        "draft_id": draft_id,
        "recipient_email": recipient_email,
        "subject": subject,
        "body_snippet": snippet,
        "status": "drafted",
        "source": "gmail_mock",
    }
