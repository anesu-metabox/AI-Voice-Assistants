"""
Tools Package
Direct execution tools for Calendar, Contacts, and CRM operations.
"""

from .calendar import get_calendar_availability, book_event
from .contacts import search_contacts

__all__ = [
    "get_calendar_availability",
    "book_event",
    "search_contacts",
]
