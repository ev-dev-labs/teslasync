---
description: "Native parity N0009 — UI automation and device builds"
---

# N0009 — UI automation and end-to-end device builds

> **Severity:** Gate | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/**` |
| Goal | Add and run native UI automation/device build gates for Android, iOS, Windows, and macOS where host tooling exists. |

## Honesty Covenant

1. No red-as-green.
2. No claiming device builds without running them.
3. No skipping unavailable tooling silently; BLOCK with exact missing tool.
4. No WebView.
5. No fake UI automation.
6. No production API calls in automation.
7. No committed secrets/certs.
8. No platform deletion to pass.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Add native smoke/UI tests for shell navigation, auth state, routes, settings, and API error states.
2. Add scripts for Android, iOS, Windows, and macOS device/build gates.
3. Run host-available gates and log unavailable tooling honestly.
4. Commit if gates pass.

## Gate

Run typecheck, lint, Jest, platform Jest, Android/Windows bundles, and available device/build commands.

## Commit

Commit message: `test(apps): add native UI automation gates`

