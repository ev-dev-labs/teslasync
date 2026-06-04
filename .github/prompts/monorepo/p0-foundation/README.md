---
description: "P0 Foundation & Governance — phase index"
---

# P0 — Foundation & Governance

Establishes the scaffolding every later program depends on: the `apps/` skeleton,
the CI matrix with path filters, the toolchain/version locks, the prompt runner, the
placeholder-grep gate, and the Authentik native-client runbook. **No app UI is built
here** — this program produces structure, tooling, and governance only.

> Read `../README.md` and `../0000-methodology.prompt.md` first. The 10-Rule Honesty
> Covenant is inlined in every prompt. Logs go to `../logs/`.

## Binding rules for P0

1. P0 prompts touch only: `apps/**` scaffolding, `.github/workflows/**`, repo-root config
   (`.gitignore`, `.editorconfig`, Renovate), and `api/openapi/**` placeholders. Never
   touch `internal/**`, `web/**` logic, or existing Helm/Docker except additively + ADR-justified.
2. No platform SDK is assumed installed on the author's machine; scaffold prompts that
   require an SDK to *build* must mark themselves BLOCKED if the SDK is absent (Rule 3).
3. Every prompt ends with `EXIT=` + `STATUS=` and commits per methodology.

## Prompt index

| # | Prompt | Output | Depends on |
|---|---|---|---|
| 0001 | `0001-apps-skeleton.prompt.md` | `apps/` dir tree + top-level `apps/README.md` | — |
| 0002 | `0002-gitignore-editorconfig.prompt.md` | root `.gitignore`/`.editorconfig` entries for 3 toolchains | 0001 |
| 0003 | `0003-version-lock-manifests.prompt.md` | `apps/versions.lock.md` + per-platform version files (ADR-012) | 0001 |
| 0004 | `0004-ci-matrix-path-filters.prompt.md` | `.github/workflows/apps-*.yml` with path-filtered Win/macOS/Linux jobs | 0001,0003 |
| 0005 | `0005-prompt-runner.prompt.md` | `run-prompts.ps1` (runner contract from methodology) | 0001 |
| 0006 | `0006-placeholder-gate.prompt.md` | `apps/tools/check-placeholders.ps1` (ADR-011 forbidden-pattern gate) | 0001 |
| 0007 | `0007-design-tokens-skeleton.prompt.md` | `apps/design/` neutral token schema + generator stubs (ADR-005) | 0001 |
| 0008 | `0008-parity-dir-skeleton.prompt.md` | `apps/parity/` schema for manifest + ledger files (ADR-006) | 0001 |
| 0009 | `0009-authentik-native-clients-runbook.prompt.md` | `apps/docs/authentik-native-clients.md` (ADR-008) | 0001 |
| 0010 | `0010-crash-analytics-decision.prompt.md` | pin crash/analytics sink (ADR-016) in `apps/docs/observability.md` | 0001 |
| 0011 | `0011-contributor-guide.prompt.md` | `apps/README.md` sparse-checkout + per-platform dev setup | 0001-0010 |
| 0099 | `0099-p0-gate.prompt.md` | acceptance gate: all P0 outputs present + CI green | all |

## Exit criteria

- `apps/` skeleton exists with `shared/ design/ parity/ windows/ android/ apple/ tools/ docs/`.
- CI workflows present and path-filtered; placeholder gate + runner executable.
- Version locks recorded; Authentik + observability runbooks written.
- `0099-p0-gate` log shows `STATUS=DONE`.
