---
description: "P0/0009 — Authentik native OAuth client runbook (ADR-008)"
---

# P0 · 0009 — Authentik native-clients runbook

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 9 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/docs/authentik-native-clients.md` |
| Allowed files | `apps/docs/authentik-native-clients.md`, the log file |
| Depends on | 0001 |
| Blocks | P1 auth module; every platform sign-in prompt |
| ADR refs | ADR-008 (auth + secure storage) |
| Log | `../logs/p0-0009-authentik-runbook.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Document exactly how to register the three native OAuth (OIDC Auth Code + PKCE) clients in
Authentik, including redirect URIs per platform, so P1/P2/P3/P4 sign-in prompts have a spec.

## Output — runbook must contain

1. **Provider config** per app: public client, PKCE required, allowed redirect URIs:
   - Windows: `ms-app://<package-SID>` or loopback `http://127.0.0.1:<port>/callback`.
   - Android: App Link `https://<host>/oauth/android/callback` + custom scheme `teslasync://oauth`.
   - Apple: Universal Link `https://<host>/oauth/apple/callback` + scheme `teslasync://oauth`.
2. **Scopes/claims** the apps need (openid, profile, offline_access for refresh).
3. **Token lifetimes** + refresh policy; how `/api/v1/*` accepts the bearer token vs. the
   web's ForwardAuth cookie (note any backend-additive needed; flag for ADR if so).
4. **Secret storage** target per platform (Credential Manager / Keystore / Keychain) — pointers, not code.
5. **Verification**: a manual checklist to confirm each redirect round-trips in a test tenant.
6. **Security notes**: no client secret in the app; PKCE S256; reject implicit flow.

## Implementation steps

1. PREFLIGHT: 0001 DONE + clean tree.
2. Write the runbook. Where a backend change is implied (bearer acceptance, `/api/v1/devices`),
   record it as a TODO-for-ADR item in the doc (not code) and reference ADR-009.
3. GATE: doc exists, contains all 6 sections (grep headings); emit `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] Runbook has all 6 sections with per-platform redirect URIs.
- [ ] Any backend-additive requirement is explicitly flagged for ADR review.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Commit

```powershell
git add apps/docs/authentik-native-clients.md .github/prompts/monorepo/logs/p0-0009-authentik-runbook.log
git commit -m "docs(monorepo): Authentik native OAuth client runbook (P0/0009)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
