---
description: "Native parity N0008 — macOS and packaging"
---

# N0008 — macOS project generation and packaging/signing

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/**` |
| Goal | Add macOS native project support where tooling permits and package/signing scaffolds for Android, iOS, Windows, and macOS. |

## Honesty Covenant

1. No red-as-green.
2. No fake macOS project.
3. No committed signing secrets/certs.
4. No claiming package/signing complete without local command output.
5. No WebView/Electron.
6. No platform deletion to pass builds.
7. No skipping Windows packaging because Android/iOS works.
8. No manual-only instructions as a substitute for scripts.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Investigate current `react-native-macos` project-generation path for RN 0.81.x.
2. Generate macOS project if supported; otherwise BLOCK with exact upstream/tooling evidence.
3. Add packaging scripts/checks for Android, iOS, Windows, and macOS where available.
4. Gate and commit.

## Gate

Run typecheck, lint, Jest, Android/Windows bundles, `npx react-native config`, and any available platform build/package command.

## Commit

Commit message: `feat(apps): add native packaging foundations`

