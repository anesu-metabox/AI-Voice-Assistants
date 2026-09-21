"""
HTTP Client Singleton for Fast Lane Outbound Requests
Maintains connection pooling and keep-alive to preserve the sub-400ms voice latency budget.
"""

import logging
from typing import Optional
import httpx

logger = logging.getLogger("voice_bot.services.http_client")

_http_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    """
    Get or initialize the shared async HTTP client with pre-warmed connection pooling.
    """
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=3.0, read=7.0, write=5.0, pool=5.0),
            limits=httpx.Limits(
                max_keepalive_connections=20,
                max_connections=50,
                keepalive_expiry=60.0,
            ),
            headers={"User-Agent": "AIVoiceBot-FastLane/1.0"},
        )
    return _http_client


async def close_http_client() -> None:
    """
    Gracefully shut down the shared HTTP client and close persistent connections.
    """
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        try:
            await _http_client.aclose()
            logger.info("Shared HTTP client pool closed successfully.")
        except Exception as exc:
            logger.warning("Error closing shared HTTP client pool: %s", exc)
        finally:
            _http_client = None
