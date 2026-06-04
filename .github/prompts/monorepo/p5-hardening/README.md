---
description: "P5 Hardening & Release — phase index"
---

# P5 — Hardening & Release

Cross-platform finishing: end-to-end testing, performance budgets, accessibility passes,
localization completeness, store/distribution, push-infra provisioning, and GA. Runs after
P2/P3/P4 reach 100% parity ledgers (may start per-platform as each one finishes).

> Prereqs: the target platform's `*99` acceptance gate DONE. Read ADR-009/010/014/015/016.

## Phases

| Phase | Theme | Prompts | Output |
|---|---|---|---|
| **H0** | Parity reconciliation | `H0-0001..` | re-run manifest `--check`; assert all 4 ledgers 100%; close any drift gaps |
| **H1** | End-to-end tests | `H1-0001..` | e2e flows per platform (sign-in → live data → command → notification) against a test backend |
| **H2** | Performance budgets | `H2-0001..` | cold-start, frame-time, memory, bundle/app-size budgets per platform; profiling + fixes |
| **H3** | Accessibility audit | `H3-0001..` | manual VoiceOver/TalkBack/Narrator passes; contrast, Dynamic Type, focus; fixes (ADR-015) |
| **H4** | Localization completeness | `H4-0001..` | verify every i18n key resolves on all platforms; pseudo-loc; RTL spot-check (ADR-014) |
| **H5** | Push infrastructure | `H5-0001..` | provision APNs/FCM/WNS creds; backend-additive `/api/v1/devices` + `notification-worker` fan-out; Helm/config (ADR-009; follow helm-docker.instructions) |
| **H6** | Security review | `H6-0001..` | secure-storage audit, no-PII-in-logs audit, cert pinning decision, dependency/CVE scan |
| **H7** | Crash/analytics wiring | `H7-0001..` | self-hosted sink live; crash-free-rate dashboards; consent flows verified (ADR-016) |
| **H8** | Store packaging | `H8-0001..` | MSIX/Store, Play AAB + listing + Data Safety, App Store macOS+iOS + privacy labels |
| **H9** | Release + rollout | `H9-0001..` | staged rollout, versioning/tags, release notes, update mechanism, post-release monitoring |
| **H99** | GA gate | `H99-0001` | all platforms shipped at parity; final acceptance |

## Binding rules for P5

1. H5 is the only program allowed backend-additive changes, and ONLY the device-registration
   endpoint + push fan-out justified by ADR-009 — each behind config, following
   `.github/instructions/helm-docker.instructions.md` (update config.go + docker-compose + helm together).
2. No new product features. Hardening + release only.
3. Store-privacy disclosures MUST reflect actual data collection (ADR-016).

## Exit criteria

- All 4 parity ledgers 100%; e2e + perf + a11y + l10n gates green per platform.
- Push works end-to-end on all three notification systems.
- Apps published (or release-candidate signed) for Windows, Android, macOS, iOS.
- `H99` log `STATUS=DONE`.
