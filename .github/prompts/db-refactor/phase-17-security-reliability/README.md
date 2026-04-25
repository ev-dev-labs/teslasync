# Phase 17 — Security & Reliability Hardening

## Goal

Address critical security vulnerabilities and reliability gaps found during audit:
SQL injection in backup, plaintext token fallback, incomplete backup status,
credential leaks in query strings, SSE reconnect death spiral, ungraceful shutdown,
silent data loss, competing config systems, and missing test coverage.

## Prompt ordering (10 atomic prompts)

```
── Security ──
00 — SQL injection in backup processor (CRITICAL) — validate table name against allowlist
01 — Token encryption fallback to plaintext (HIGH) — warn/fatal when ENCRYPTION_KEY missing
03 — Credentials in query strings (HIGH) — remove ?key= fallback, document SSE limitation

── Reliability ──
02 — Backup marked successful when incomplete (HIGH) — track per-table failures → partial/failed status
04 — SSE stops reconnecting after 5 failures (HIGH) — capped backoff, remove terminal state
05 — Shutdown doesn't wait for background work (HIGH) — WaitGroup + bounded timeout
06 — Write buffer drops data silently (HIGH) — Prometheus counter + Stats() endpoint

── Housekeeping ──
07 — Two competing config systems (HIGH) — deprecate secondary, document canonical
08 — Test coverage for critical paths (MEDIUM) — smoke tests for backup, signal store

── Gate ──
09 — Gate: build + vet + tsc + security regression checks
```

## Key decisions

1. **Prompt 00** — Uses existing `allowedBackupTables` map from `backup_handler.go` as the allowlist source
2. **Prompt 01** — Production mode (`APP_ENV`/`GO_ENV`) gets `log.Fatal()`; dev mode gets loud warning only
3. **Prompt 03** — SSE `?token=` stays (EventSource API limitation) but `?key=` for API keys is removed
4. **Prompt 04** — No terminal `unavailable` state; capped exponential backoff (max 60s) forever
5. **Prompt 05** — 30s bounded timeout on shutdown `wg.Wait()` to avoid infinite hangs
6. **Prompt 07** — Deprecation comment only — full merge is a separate phase
7. **Prompt 08** — Smoke tests only, not full coverage — validates the security fix from prompt 00
