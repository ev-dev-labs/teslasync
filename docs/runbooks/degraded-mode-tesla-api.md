# Degraded mode: Tesla Fleet API

**Criticality:** degraded-tolerable. Streaming telemetry is independent
of the REST API, so live data keeps flowing while the Fleet API is
unavailable. What stops is commands, token refresh, and polling.

Registered in `ops/runbooks/dependencies.yaml` (`tesla-api`).

## Symptoms

- Vehicle commands (wake, climate, charge control) fail fast with a
  user-visible error instead of hanging — that is the `gobreaker`
  circuit breaker in `internal/tesla` doing its job.
- `/readyz` reports `"tesla_auth": "no_token"`. Note this is **not**
  fatal: readiness stays 200, because historical data still serves.
- The `tesla_api_availability` SLO burns.
- Vehicle list/state polling backs off and stops refreshing metadata.

## Confirm

```bash
kubectl -n "$NS" exec deploy/"$RELEASE"-api -- wget -qO- localhost:8080/readyz
kubectl -n "$NS" logs deploy/"$RELEASE"-api --since=15m | grep -Ei 'tesla|breaker|401|429'
```

Separate the three causes, because they have nothing in common:

| Cause | Evidence | Fix owner |
|---|---|---|
| Token expired/revoked | repeated 401, `tesla_auth: no_token` | us — re-authorise |
| Rate limited | 429s, breaker flapping | us — back off |
| Tesla outage | 5xx across all endpoints, breaker open | Tesla — wait |

Also confirm streaming is unaffected:

```sql
SELECT max(ts) FROM signal_log;
```

If that timestamp is still moving, the platform's core value is intact
and this is not an incident that warrants a page.

## Immediate mitigation

1. **Do not restart the API to "reset" the breaker.** It half-opens on
   its own after 60s and a restart discards the backoff state, turning a
   rate-limit into a hammering loop.
2. **Rate limited (429):** leave the breaker open. Confirm the poll
   interval (`WORKER_POLL_INTERVAL`) has not been lowered recently, and
   raise it temporarily if it has.
3. **Token expired:** re-run the OAuth authorisation flow from the
   settings UI. Tokens are encrypted at rest (`internal/crypto`), so a
   token problem is never fixed by editing the database.
4. **Tesla outage:** communicate expected degradation — commands and
   metadata refresh are unavailable, live telemetry and history are not.

## Recovery

1. Wait for the breaker to half-open and close (60s timeout per probe).
2. Confirm `/readyz` reports `"tesla_auth": "ok"`.
3. Re-issue any command the user asked for; commands are not queued for
   retry by design — sending a stale command to a real vehicle minutes
   later is worse than failing it.
4. If telemetry subscriptions lapsed during the outage, re-establish
   them with `cmd/resubscribe` (see the MQTT runbook).

## Verify

```bash
go run ./cmd/smoke-gate -base-url "https://$HOST" -manifest ops/smoke/checks.yaml
```

The `system-status` check exercises the aggregate dependency view; the
breaker state and `tesla_auth` both appear there. Then send one harmless
command (a state refresh) and confirm it succeeds.

## Escalation

Do not page for a Tesla-side outage — there is no action to take. Page
only if token refresh is failing for our own reasons (encryption key
rotation gone wrong, credentials revoked) or if command failures are
being reported as successes to users, which is a correctness bug rather
than a dependency outage.
