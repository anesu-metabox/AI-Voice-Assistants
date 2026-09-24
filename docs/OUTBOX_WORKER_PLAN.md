# Shared Background Job and Outbox Worker Plan

## Purpose

Add a general-purpose way to run work that should survive an API restart, be retried after temporary failures, and execute outside a live voice conversation. The first implementation is one durable job system with a small set of registered handlers. New product features and integrations add handlers to that system; they do not automatically require another worker service.

This plan describes the broader future capability. The focused Calendar booking recovery worker is now implemented separately; it does not turn the existing `tasks` ledger into a general-purpose outbox.

**Implementation decision (2026-09-24):** the first concrete background flow is deferred Calendar bookings, implemented in a dedicated `calendar_booking_requests` table and booking worker. This keeps sensitive booking payloads separate from the general task ledger and lets the worker role receive access to that queue only. This is a focused first capability, not the general-purpose worker platform described in later phases.

## Recommended implementation

**Build one separate, continuously running Railway background-worker service that claims durable jobs from Neon. Extend the existing `tasks` ledger into the first job queue after auditing its writers and RLS. Do not create multiple worker services or adopt a separate message broker for the first version.**

The worker handles the first execution and retries; it is not a retry-only process. Each job has a registered type/handler, and new features or plugins add handlers to the shared worker. Keep the LiveKit real-time worker and private credential broker as separate services with their existing boundaries.

For operations where a business-data update and a job must succeed or fail together, insert/update both in one PostgreSQL transaction. If an existing flow cannot do that cleanly with the `tasks` table, introduce a dedicated outbox table for the atomic event record and have the worker turn/claim that event as work. Do not add a second general-purpose queue table unless the audit shows the existing ledger cannot safely support claiming, retries, and tenant-scoped job execution.

### First release scope

1. Audit every `tasks` writer, reader, and migration; establish whether tasks are currently created and whether any consumer processes them.
2. Evolve the canonical task/job schema for typed and versioned payloads, availability time, bounded attempts, claim lease, redacted failure category, and dead-letter status. Preserve the existing task status/cancel API contract where possible.
3. Add one Railway worker service that polls and atomically claims bounded batches from Neon, executes registered handlers, and exits cleanly on shutdown. Use the app's Postgres connection path and least-privilege tenant/RLS rules.
4. Add retry with exponential backoff and jitter, lease recovery after crashes, idempotency keys, and operational visibility for queue age, failures, and dead letters.
5. Convert one real, low-risk asynchronous flow first—prefer notification or integration delivery once that capability is actually in scope. Do not create speculative industry jobs before their features exist.
6. Add an explicit handler contract so a future plugin can register a namespaced job type, payload schema/version, timeout, retry classification, permissions, and credential needs.

### Defer from the first release

- A fleet of purpose-specific workers, Kafka/RabbitMQ, or another broker.
- Neon scheduled Functions as the main job executor. Consider them later for low-volume periodic triggers only; the current Neon trigger API is Beta.
- Automatic execution of every future industry example. Healthcare, retail, finance, and field-service jobs are added only when those product features and provider integrations are implemented.
- Exactly-once delivery claims. Build at-least-once processing with idempotent handlers and provider reconciliation instead.

**Decision rule:** split a handler into its own worker service only when measured workload, runtime, security/credential access, network boundary, availability target, or failure-isolation needs require it.

## Current position

- The application already has a separate LiveKit worker for real-time conversations.
- The database has a tenant-scoped `tasks` ledger with pending/running/completed/failed/cancelled states, an idempotency key, and task status/cancel API routes.
- The schema and API provide task tracking, but this review has not established a general-purpose dispatcher that claims jobs, invokes registered handlers, retries failures, and dead-letters exhausted work.
- Deferred Calendar booking requests have their own typed queue, retry policy, worker service, and status endpoint; this worker handles only Calendar booking recovery.
- Inbound 3CX events have their own inbox/deduplication and call-claim behavior. That solves inbound event handling and is distinct from a general outbound outbox.
- The credential broker remains a separate trust boundary for integration credentials and privileged provider operations.

Before implementation, inspect all task creation paths and schema grants/RLS, then decide whether to evolve `tasks` into the job ledger or add separate `outbox_events` and `background_jobs` tables. Avoid two overlapping sources of truth.

## Proposed architecture

```text
API / domain operation
  └─ one database transaction: save business change + enqueue job/event
       └─ Neon Postgres job ledger (tenant-scoped, durable)
            └─ Background worker service (poll and claim batches)
                 ├─ integration delivery handler
                 ├─ notification handler
                 ├─ scheduled/delayed action handler
                 └─ future plugin handlers

LiveKit worker ── handles real-time sessions; enqueues follow-up work when needed
Credential broker ── retains credential access and privileged integration boundary
```

Use Neon Postgres as the durable source of truth initially. The app inserts a job in the same database transaction as the state change that requires it. A continuously running application worker polls/claims ready jobs in batches. Neon scheduled Functions may be useful later for periodic maintenance or low-volume schedules, but their current documented triggers are Beta and do not replace a continuously available job consumer.

## Job lifecycle

1. **Enqueue:** In the same transaction as the domain change, insert a typed job with tenant/company ID, stable idempotency key, payload version, availability time, and correlation ID. Store references to sensitive or large data rather than credentials, raw audio, or unnecessary transcript content.
2. **Claim:** The worker atomically claims a bounded batch, using a lease/claim timeout so another worker can recover work after a process crash. Multiple replicas must not process the same claim concurrently.
3. **Dispatch:** Resolve the job type through an explicit handler registry. Unknown types fail safely and alert rather than being interpreted dynamically from user-provided input.
4. **Execute:** Handler validates payload version and tenant context, calls its provider/service with an idempotency key where supported, and applies provider-specific rate limits and timeouts.
5. **Complete or retry:** Mark success after the effect is confirmed. On a transient failure, schedule bounded exponential backoff with jitter. Treat permanent validation/authorization failures as terminal unless a defined recovery exists.
6. **Dead letter and recover:** After a configured attempt/time limit, mark the job dead-lettered, preserve redacted diagnostic context, alert operators, and support controlled replay after the cause is fixed. Replays keep the original business idempotency key unless the action is intentionally a new operation.
7. **Observe:** Track queue age/depth, attempts, failure category, handler duration, and dead-letter count. Logs must not include secrets, raw payloads, transcripts, or unnecessary tenant identifiers.

Delivery is **at least once**. A crash can occur after a provider accepts a request but before the database records success. Therefore, handlers must be idempotent or use provider idempotency/reconciliation; the system must not promise exactly-once external effects.

## Initial handler set

| Handler/capability | Initial use | Implementation boundary |
|---|---|---|
| `integration.deliver` | Deliver configured webhooks or call provider APIs after a committed app change | Shared retry, timeout, per-provider throttling; credentials stay behind the approved broker boundary |
| `notification.send` | Send email/SMS or another tenant-configured notification | Provider adapters, consent/preferences, tenant quotas, redacted logs |
| `schedule.execute` | Execute due reminders, follow-ups, and delayed actions | Durable `available_at`; scheduler enqueues/activates work, handler execution remains in worker |
| `integration.reconcile` | Bounded health checks and recovery/reconciliation for integrations | Separate rate limits; never silently repeat consequential actions |

These are candidate types, not a claim that every channel or integration is implemented today. Start only with a real application flow that needs asynchronous durable execution.

## How features and plugins extend it

Each feature/plugin declares a namespaced job type (for example, `retail.order_status_notify` or `clinic.appointment_reminder`), a versioned payload schema, its handler, retry classification, timeout/rate-limit needs, and required capability/credential boundary. The platform owns persistence, claims, retries, cancellation policy, dead letters, tenant isolation, and observability. Plugin handlers own domain-specific behavior.

Industry examples are workloads, not platform-specific workers:

- Healthcare: appointment reminders and approved follow-ups.
- Retail: order status, fulfillment/shipping updates, and inventory notifications.
- Professional services: lead follow-up, booking reminders, and case updates.
- Field services: dispatch notifications and appointment changes.
- Finance: invoice/payment status workflows, subject to provider and compliance requirements.

The same queue can host these when their reliability and security needs fit. Split a handler into a separately deployed worker only when it needs materially different credentials, throughput/scaling, runtime, network access, availability/SLO, or failure isolation.

## Phased delivery plan

### Phase 0 — Inventory and decision

- Find every writer/reader of `tasks`; document which are active and whether any process pending rows today.
- Review migrations, forced RLS, runtime database grants, tenant ownership, cancellation behavior, and idempotency conventions.
- Choose one canonical job store: evolve `tasks` or introduce an outbox plus job state model. Define whether domain events and executable commands share a table or use linked records.
- Select the first actual async use case and identify its provider idempotency/reconciliation behavior.

**Gate:** no duplicate job ledger, and transaction/tenant/security boundaries are written down before migration work.

### Phase 1 — Durable worker foundation

- Add/adjust schema for typed/versioned payloads, availability, attempt count, claim lease, completion, error category, and dead-letter state.
- Add atomic batch claiming, lease recovery, bounded retries/backoff, graceful shutdown, and a handler registry.
- Add metrics/alerts and admin-safe inspection/replay controls; preserve user task status/cancel semantics where applicable.
- Deploy as a separate Railway service using least-privilege database access and no provider secrets unless its handler requires them.

**Gate:** simulate duplicate delivery and worker restart; demonstrate tenant isolation, one active claim per job, retry bounds, cancellation semantics, and redacted operations visibility.

### Phase 2 — First real handler

- Convert one current business flow that benefits from async execution to enqueue work transactionally.
- Prefer a low-risk integration delivery or notification flow; do not enqueue consequential calendar or voice actions without explicit user authorization and action-level idempotency.
- Measure queue latency, provider error rate, retry volume, and dead letters before expanding.

**Gate:** a committed domain update always has its corresponding job; rollback has neither; provider timeout/retry does not create duplicate business effects.

### Phase 3 — Schedules and plugin contract

- Add durable delayed scheduling and a versioned handler registration contract.
- Document per-handler policy for tenant quotas, data retention, authorization, payload upgrades, retries, and secrets.
- Add new industry/plugin jobs as demand appears; keep product UI explicit about unsupported integrations/capabilities.

**Gate:** one sample plugin handler runs through the shared lifecycle while respecting tenant boundaries and provider-specific policy.

### Phase 4 — Scale and isolation only when evidence requires it

- Tune batch size, polling cadence, indexes, connection pool size, and replica count from measured queue load.
- Move high-volume or sensitive handler families into isolated worker services only where the boundary brings a concrete operational/security benefit.
- Consider a dedicated broker/queue if database polling becomes a measured bottleneck; keep Postgres as the record of business state and recovery where appropriate.

## Decisions to keep explicit

- **Worker vs retry worker:** it is a job processor that handles the first attempt and retries; retries are one part of its lifecycle.
- **One fleet vs many services:** begin with a shared worker fleet and typed handlers; split on a demonstrated boundary, not merely because a new plugin exists.
- **Outbox vs task ledger:** current task tracking is not automatically transactional enqueue. Verify current writers and atomicity before choosing a migration.
- **Neon role:** Neon Postgres stores durable jobs; Neon scheduled Function triggers are an optional scheduling aid, not the always-on executor.
- **Existing workers:** keep LiveKit real-time execution and the credential broker’s trust role distinct from generic asynchronous job processing.

## Research references

- [Neon scheduled Function triggers](https://api-docs.neon.tech/reference/createprojectbranchtrigger) — current API describes five-field UTC schedules; triggers are marked Beta.
- [PostgreSQL transactions](https://www.postgresql.org/docs/18/tutorial-transactions.html) — transactions apply changes atomically.
- [PostgreSQL outbox overview](https://github.com/BrighterCommand/Docs/blob/master/contents/PostgresOutbox.md) — persists messages in the business transaction and publishes them later.
