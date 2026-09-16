"""
Contacts & CRM Direct Tools
Provides fast lookup for contacts, phone numbers, and email addresses.
Includes realistic mock fallback with simulated network latency (<150ms).
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger("voice_bot.tools.contacts")

# Realistic mock directory
MOCK_CONTACTS = [
    {
        "id": "cnt_001",
        "name": "Sarah Jenkins",
        "email": "sarah.jenkins@example.com",
        "phone": "+1-555-0192",
        "company": "Acme Corp",
        "role": "VP of Operations",
    },
    {
        "id": "cnt_002",
        "name": "Michael Chang",
        "email": "m.chang@innovate.io",
        "phone": "+1-555-0144",
        "company": "Innovate AI",
        "role": "Lead Systems Architect",
    },
    {
        "id": "cnt_003",
        "name": "Elena Rostova",
        "email": "elena@vortexventures.com",
        "phone": "+1-555-0188",
        "company": "Vortex Ventures",
        "role": "Managing Partner",
    },
]


async def search_contacts(
    query: str,
    limit: int = 5,
) -> Dict[str, Any]:
    """
    Search contacts directory by name, email, or company.
    """
    logger.info("Searching contacts directory with query: '%s'", query)

    # Simulate realistic database / API lookup delay (110ms)
    await asyncio.sleep(0.11)

    q = query.lower().strip()
    matches: List[Dict[str, Any]] = []

    for contact in MOCK_CONTACTS:
        if (
            q in contact["name"].lower()
            or q in contact["email"].lower()
            or q in contact["company"].lower()
        ):
            matches.append(contact)

    return {
        "query": query,
        "count": len(matches[:limit]),
        "contacts": matches[:limit],
        "source": "contacts_directory_mock",
    }
