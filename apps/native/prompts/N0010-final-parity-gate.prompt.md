---
description: "Native parity N0010 — final parity gate"
---

# N0010 — Final native parity acceptance gate

> **Severity:** Gate | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/**` |
| Goal | Prove native parity status across web routes, widgets, platforms, packaging, notifications, auth, maps/charts, and automation. |

## Honesty Covenant

1. No red-as-green.
2. No count-only parity.
3. No pending routes claimed done.
4. No missing platform gate hidden.
5. No WebView/Electron.
6. No fake screenshots or automation.
7. No silent dirty tree.
8. No unverified package/signing claim.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Compare native manifest to every route in `web/src/App.tsx`.
2. Verify implemented/pending status for every route and widget group.
3. Run typecheck, lint, Jest, Android/Windows bundles, and all platform gates available on this host.
4. If anything remains pending, produce STATUS=BLOCKED with exact list.
5. Commit only when final gate is genuinely green.

## Gate

Run all checks available from `apps/native` and include exact command output.

## Commit

Commit message: `test(apps): pass native parity acceptance gate`
