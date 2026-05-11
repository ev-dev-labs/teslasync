# Phase-47 layering exemptions

Per ADR-006, ADR-007, and the hexagonal layering rules promoted to fail-level
in `phase-47/09-port-adapter-rules.prompt.md`, the following import edges are
permitted as one-time exemptions. Each row cites the follow-up prompt that
will remove the exemption; when that prompt lands and the underlying
violation is cleared, the row MUST be removed from this file AND the
corresponding `AllowedException` entry MUST be removed from
`internal/arch/rules.go` in the same PR.

## Active exemptions

| Source | Target | Until | Notes |
|--------|--------|-------|-------|
| _(none)_ | | | |

## Notes

A pre-execution audit run during phase-47/09 (2026-05-08) enumerated every
`internal/*` import from `internal/port/...` and `internal/adapter/...`
against the new fail-level `ForbiddenEdges` and confirmed:

- **Ports** — zero violations. All `internal/port/*` packages already
  import only stdlib, sibling `internal/port/*`, and `internal/domain/*`.
- **Adapters** — zero forbidden edges. No adapter imports `internal/api`,
  `internal/handler/*`, or `internal/app/*`. Two gray-area imports exist
  (`internal/adapter/gasprices` → `internal/config`;
  `internal/adapter/tesla` → `internal/enums`) but neither is on the
  deny-list and both are documented adapter-acceptable dependencies.

`AllowedExceptions` in `internal/arch/rules.go` is therefore empty. If a
future change introduces a violation, the contributor MUST either fix the
source OR add an entry here AND in `rules.go`, citing a concrete cleanup
prompt under `Until:`.
