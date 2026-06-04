---
description: "P1/S8 — NotificationChannels shared state holder(s) (parity with web hook domain useNotificationChannels)"
---

# P1 · S8 · 0031 — NotificationChannels state holder

> **Severity:** Foundation (blocks every NotificationChannels UI on all platforms) · **Delegation:** FORBIDDEN
> Port the web hook domain `useNotificationChannels` (4 hook(s)) to platform-agnostic,
> UI-free state holders in the KMP shared core. Every native NotificationChannels screen binds to these.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/core/src/commonMain/.../presentation/notificationchannels/**` |
| Web source | `web/src/api/hooks/useNotificationChannels.ts` |
| Allowed files | `apps/shared/core/**`, the log file |
| Depends on | P1/S4 (networking), P1/S6 (auth), P1/S7 (cache/repos), P1/S5 (units) |
| Blocks | every `NotificationChannels` page prompt in P2/P3/P4 |
| ADR refs | ADR-004, ADR-006, ADR-013 |
| Log | `../../logs/p1-s8-0031-notificationchannels.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Reproduce — exactly — the data behavior of every hook in `useNotificationChannels.ts` as shared state
holders: same endpoints, same params (snake_case), same query keys/caching intent, same
derived values, exposed as `StateFlow`/suspend APIs through the repositories (S7) — UI-free,
consumed identically by Windows (via the C# port) and Android/Apple (via KMP).

## Parity scope — port ALL of these (from the real web hook file)

**Reads / queries (3):**
- `useWebhookChannels`
- `useWebhookSignaturePreview`
- `useInvalidateWebhookChannels`

**Mutations / actions (1):**
- `useTestWebhookChannel`

For EACH: match the web hook's endpoint + method + params + response shape (read the web file),
its staleTime/refetch intent (→ S7 TTL), optimistic-update/invalidate behavior for mutations,
and any client-side derivation. Values stay SI; conversion is display-only (S5).

## Implementation spec

- One state holder (or a small cohesive set) per logical screen-feed; expose
  `StateFlow<Resource<T>>` for reads and suspend `Result`-returning functions for mutations.
- Mutations invalidate/refresh the affected cache keys (mirror the web `invalidateQueries`).
- Inject repositories (S7) + clock; NO direct Ktor calls here.
- Cross-platform parity: the same behavior must be reflected in the Windows C# port — add/extend
  golden vectors (S5 style) for any non-trivial derivation so C# and KMP can't drift (ADR-004).
- Tests: fake repositories — assert each read emits cache→network, each mutation calls the right
  endpoint + invalidates the right keys, and derivations match the web output on fixed inputs.

## Gate

```powershell
Push-Location apps/shared/core
./gradlew :core:allTests 2>&1 | Tee-Object $log -Append; "TEST_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew ktlintCheck 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/shared/core -Language kotlin *>$null; "PH_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if TEST/LINT/PH all 0 AND every hook above is ported (enumerate in === PARITY ===)
```

## Acceptance Criteria

- [ ] All 4 hooks ported with matching endpoint/params/derivation; SI preserved.
- [ ] Mutations invalidate the correct cache keys; reads emit cache→network.
- [ ] Golden vectors extended for any derivation (KMP+C# parity); fake-repo tests green.
- [ ] ktlint + placeholder clean; `=== PARITY ===` enumerates all 4 hooks covered.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

UI/screens (platform programs); other hook domains; backend changes.

## Commit

```powershell
git add apps/shared/core .github/prompts/monorepo/logs/p1-s8-0031-notificationchannels.log
git commit -m "feat(apps/shared): NotificationChannels state holder at web-hook parity (P1/S8)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
