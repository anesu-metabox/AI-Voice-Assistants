"""Behavioral regression tests for active-conversation event-loop stall monitoring."""

import asyncio
import time
import unittest

from agent.event_loop_monitor import monitor_active_conversation


class TestEventLoopMonitor(unittest.IsolatedAsyncioTestCase):
    async def test_reports_stall_over_100ms_while_conversation_is_active(self):
        stop = asyncio.Event()
        observed = []
        monitor = asyncio.create_task(
            monitor_active_conversation(
                "session-test",
                stop,
                interval_seconds=0.02,
                stall_threshold_ms=100,
                on_stall=observed.append,
            )
        )
        await asyncio.sleep(0.03)
        time.sleep(0.16)  # Deliberately simulate synchronous event-loop work.
        await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(monitor, timeout=0.5)
        self.assertTrue(observed)
        self.assertGreaterEqual(observed[0], 100)

    async def test_stops_promptly_when_session_closes(self):
        stop = asyncio.Event()
        observed = []
        monitor = asyncio.create_task(
            monitor_active_conversation("session-test", stop, on_stall=observed.append)
        )
        stop.set()
        await asyncio.wait_for(monitor, timeout=0.1)
        self.assertEqual(observed, [])


if __name__ == "__main__":
    unittest.main()
