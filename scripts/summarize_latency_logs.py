"""Summarize sanitized voice-bot latency log records by stage and outcome."""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
import sys
from typing import Iterable


LATENCY_PATTERN = re.compile(
    r"\blatency\s+trace_id=(?P<trace_id>[A-Za-z0-9._:-]+)\s+"
    r"stage=(?P<stage>[A-Za-z0-9._:-]+)\s+"
    r"duration_ms=(?P<duration>\d+(?:\.\d+)?)\s+"
    r"outcome=(?P<outcome>[A-Za-z0-9._:-]+)\b"
)


def _percentile(sorted_values: list[float], quantile: float) -> float:
    if not sorted_values:
        raise ValueError("at least one value is required")
    rank = (len(sorted_values) - 1) * quantile
    lower = int(rank)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = rank - lower
    return sorted_values[lower] + (
        sorted_values[upper] - sorted_values[lower]
    ) * fraction


def summarize_latency_lines(lines: Iterable[str]) -> dict[str, object]:
    grouped: dict[tuple[str, str], list[float]] = defaultdict(list)
    trace_ids: set[str] = set()
    matched_records = 0
    for line in lines:
        match = LATENCY_PATTERN.search(line)
        if match is None:
            continue
        duration = float(match.group("duration"))
        grouped[(match.group("stage"), match.group("outcome"))].append(duration)
        trace_ids.add(match.group("trace_id"))
        matched_records += 1

    groups = []
    for (stage, outcome), values in sorted(grouped.items()):
        ordered = sorted(values)
        groups.append(
            {
                "stage": stage,
                "outcome": outcome,
                "count": len(ordered),
                "p50_ms": round(_percentile(ordered, 0.50), 2),
                "p95_ms": round(_percentile(ordered, 0.95), 2),
                "p99_ms": round(_percentile(ordered, 0.99), 2),
                "max_ms": round(ordered[-1], 2),
            }
        )
    return {
        "matched_records": matched_records,
        "unique_traces": len(trace_ids),
        "groups": groups,
    }


def _read_lines(path: str) -> Iterable[str]:
    if path == "-":
        return sys.stdin
    return Path(path).read_text(encoding="utf-8").splitlines()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Summarize sanitized latency records emitted by the voice stack."
    )
    parser.add_argument(
        "input",
        nargs="?",
        default="-",
        help="Log file path, or '-' to read standard input (default).",
    )
    args = parser.parse_args()
    print(json.dumps(summarize_latency_lines(_read_lines(args.input)), indent=2))


if __name__ == "__main__":
    main()
