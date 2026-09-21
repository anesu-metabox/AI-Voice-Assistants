"""
Voice Agent Configuration & Prompt Engineering
"""

import os
from dotenv import load_dotenv

from pathlib import Path
from dotenv import load_dotenv

try:
    from .assistant_policy import CALENDAR_SYSTEM_INSTRUCTION
except ImportError:
    from assistant_policy import CALENDAR_SYSTEM_INSTRUCTION

env_path = Path(__file__).parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

# LiveKit Media Transport
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "wss://ai-voice-assistant-vu6rr406.livekit.cloud")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")

# Google Gemini Multimodal Live Engine (ADR-008 Active Baseline)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-live")
GEMINI_API_VERSION = os.getenv("GEMINI_API_VERSION", "v1alpha")
GEMINI_VOICE = os.getenv("GEMINI_VOICE", "Aoede")

# Tool Dispatching Backend Endpoint
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

# System prompt is loaded from the canonical cross-runtime calendar policy.
SYSTEM_INSTRUCTION = CALENDAR_SYSTEM_INSTRUCTION
