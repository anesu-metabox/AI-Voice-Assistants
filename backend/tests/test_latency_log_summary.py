from scripts.summarize_latency_logs import summarize_latency_lines


def test_latency_log_summary_groups_sanitized_records_and_calculates_percentiles():
    summary = summarize_latency_lines(
        [
            "ignored line",
            "latency trace_id=trace-a stage=backend_to_broker duration_ms=10.00 outcome=ok",
            "prefix latency trace_id=trace-b stage=backend_to_broker duration_ms=20.00 outcome=ok suffix",
            "latency trace_id=trace-b stage=backend_to_broker duration_ms=30.00 outcome=error",
        ]
    )

    assert summary["matched_records"] == 3
    assert summary["unique_traces"] == 2
    assert summary["groups"] == [
        {
            "stage": "backend_to_broker",
            "outcome": "error",
            "count": 1,
            "p50_ms": 30.0,
            "p95_ms": 30.0,
            "p99_ms": 30.0,
            "max_ms": 30.0,
        },
        {
            "stage": "backend_to_broker",
            "outcome": "ok",
            "count": 2,
            "p50_ms": 15.0,
            "p95_ms": 19.5,
            "p99_ms": 19.9,
            "max_ms": 20.0,
        },
    ]


def test_latency_log_summary_does_not_match_payload_like_noise():
    summary = summarize_latency_lines(
        [
            "latency trace_id=bad value stage=x duration_ms=10 outcome=ok",
            "token=secret stage=x duration_ms=10 outcome=ok",
        ]
    )
    assert summary == {"matched_records": 0, "unique_traces": 0, "groups": []}
