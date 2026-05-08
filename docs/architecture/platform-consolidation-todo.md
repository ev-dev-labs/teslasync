# Platform consolidation TODO (phase-48 candidates)

Per ADR-007 (`.github/ARCHITECTURE.md`), the following moves are
deferred from phase-47 to phase-48. Each becomes a separate phase-48
prompt with its own per-symbol risk assessment.

## Deferred moves

- [ ] `internal/platform/cache` → `internal/cache`
      Risk: medium. Affects: ~8 import sites; check for collision with
      `internal/cache` type names. Verify no symbol-name overlap before
      moving; rename in flight if needed.

- [ ] `internal/platform/config` → `internal/config`
      Risk: medium. Affects: ~5 import sites. Same collision-check
      protocol as cache.

- [ ] `internal/platform/database` → `internal/database` OR
      `internal/adapter/postgres`
      Risk: high. Affects: ~12 import sites; needs per-symbol decision
      (generic SQL helpers vs higher-level repo wrappers).

- [ ] `internal/platform/telemetry` → `internal/platform/observability`
      Risk: low (rename only, no inter-package move). Affects: ~6
      import sites. Done after phase-42's `internal/telemetry`
      deletion is fully landed.

## NOT deferred — keep in place

- `internal/platform/buildinfo` — CANONICAL per ADR-007. No duplicate
  exists; phase-47/04 explicitly declined to extract a separate
  `internal/buildinfo` (commit 56de71940 deviation note).
- `internal/platform/httputil` — CANONICAL per ADR-007. Cross-cutting
  HTTP client utilities (timeouts, circuit breaking, retry, rate
  limiting, request/response logging hooks for `internal/apilog`).

## Rules of engagement

- A new `internal/platform/<name>/` directory requires an ADR-007
  amendment AND an update to
  `internal/arch/rules.go::AllowedPlatformSubpackages` in the SAME
  commit. `TestPlatformSubpackagesGated` will fail otherwise.
- Each deferred move above is a separate phase-48 prompt; do NOT
  bundle them into a single sweep PR.
