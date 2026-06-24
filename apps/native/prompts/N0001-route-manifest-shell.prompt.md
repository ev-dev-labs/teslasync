---
description: "Native parity N0001 — route manifest and shell"
---

# N0001 — Route manifest and native shell parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/src/navigation/**`, `apps/native/src/AppRoot.tsx`, `apps/native/src/components/navigation/**`, `apps/native/src/screens/**`, `apps/native/__tests__/**`, `apps/native/README.md` |
| Goal | Represent every route from `web/src/App.tsx` in a typed native manifest and expose implemented/pending route counts in the shell. |

## Honesty Covenant

1. No red-as-green — EXIT != 0 means STATUS=BLOCKED.
2. No scope narrowing — do not reduce the web route universe to easy routes.
3. No skip-and-assume — if a route cannot be implemented, mark it pending with evidence.
4. No stubs claimed as final parity.
5. No WebView/Electron/browser embedding.
6. No predecessor bypass — read current native shell and web route source first.
7. No silent drift — do not touch pre-existing web EOL-only dirty files.
8. No untyped route blobs.
9. No unverified claim of full parity.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Survey every `<Route path=...>` in `web/src/App.tsx`.
2. Update typed native route manifest with web paths, group, label, implementation status, and native target.
3. Update shell UI with route parity counters and access to pending route status.
4. Add tests that assert representative web routes are present.
5. Gate and commit.

## Gate

From `apps/native`, run typecheck, lint, Jest, and Android/Windows bundle validation.

## Commit

Commit message: `feat(apps): add native route parity manifest`

