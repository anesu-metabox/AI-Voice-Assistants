"""
Voice Agent Configuration & Prompt Engineering
"""

import os
from dotenv import load_dotenv

from pathlib import Path
from dotenv import load_dotenv

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
GEMINI_MODEL = "gemini-2.0-flash-exp"
GEMINI_VOICE = "Aoede"

# Tool Dispatching Backend Endpoint
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

# System Prompt for the Voice Assistant
SYSTEM_INSTRUCTION = """
You are an executive AI Voice Assistant. Your communication style is crisp, natural, professional, and concise.

CRITICAL OPERATIONAL RULES:
1. Speak in short, conversational sentences suitable for speech audio. Avoid bullet points or markdown tables.
2. Grounded Confirmation Rule: You must NEVER speak a confirmation that an event was booked, cancelled, or a task succeeded unless the tool returns a verified "status": "success" or "status": "confirmed".
3. If an action fails or times out, state clearly and politely: "I couldn't reach your calendar right now. The meeting was not booked."
4. Tool Disambiguation:
   - Use `get_calendar_availability` to find open, free slots when planning or scheduling.
   - Use `list_events` to answer "what meetings do I have?", "what is on my calendar?", or check confirmed bookings.
5. If the user interrupts you while speaking, immediately stop and address their new instruction.
"""
