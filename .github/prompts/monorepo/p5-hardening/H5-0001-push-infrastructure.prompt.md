---
description: "P5/H5 — Push infrastructure: APNs + FCM + WNS, backend-additive /api/v1/devices + worker fan-out"
---

# P5 · H5 · 0001 — Push notification infrastructure (end-to-end)

> **Severity:** Hardening · **Delegation:** FORBIDDEN
> The ONLY P5 prompt allowed backend-additive changes (ADR-009). Provisions push credentials
> on all three services, adds `/api/v1/devices` registration + `notification-worker` fan-out,
> and verifies an end-to-end notification round-trip on every native app.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | Backend: `internal/api/devices_handler.go`, repo, model, migration; worker: push providers (APNs/FCM/WNS) in `cmd/notification-worker`; Helm: `helm/teslasync/templates/{configmap,secret}.yaml` + `values.yaml`; docker-compose: env vars; per-app device-registration code |
| Allowed files | `internal/api/devices*`, `internal/database/devices_repo.go`, `internal/models/device.go`, `migrations/0001NN_devices.up.sql`, `cmd/notification-worker/**`, `internal/config/config.go`, `helm/teslasync/**`, `docker-compose.yml`, `apps/{windows,android,apple}/**` push paths, `api/openapi/**`, the log file |
| Depends on | P5/H0; ADR-009 |
| Blocks | P5/H99 |
| ADR refs | ADR-009, ADR-016 |
| Log | `../logs/p5-h5-0001-push.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

End-to-end push: a vehicle alert raised by the backend reaches the user's Windows, Android, iOS
device within seconds, deep-links to the right page, respects the user's per-channel preferences
+ quiet hours, and never leaks PII into the notification payload.

## Spec

- **Backend additive**:
  - `POST /api/v1/devices` (register token), `DELETE /api/v1/devices/{id}` (revoke). New table
    `user_push_devices` (id, user_id, platform, token, app_version, created_at, last_seen_at,
    revoked_at) with TimescaleDB-appropriate indexing.
  - `notification-worker` extended with APNs HTTP/2 (token-auth p8), FCM HTTP v1, and WNS
    providers; fan-out per platform; honor user prefs + quiet hours (existing tables).
  - Config: `APNS_TEAM_ID/KEY_ID/AUTH_KEY`, `FCM_PROJECT_ID/SERVICE_ACCOUNT_JSON`,
    `WNS_PACKAGE_SID/CLIENT_SECRET` — added to `internal/config/config.go`,
    `docker-compose.yml`, AND `helm/teslasync/templates/secret.yaml` + `values.yaml` in the
    same commit (see helm-docker.instructions.md).
- **Payload contract**: typed payload `{ event_id, alert_id, vehicle_id, kind, title, body, deep_link }`.
  No PII (no precise coords, no email/VIN) — ADR-016. `deep_link` matches the app's URL scheme +
  universal/app links.
- **Apps**: each app implements registration on first signed-in launch, refresh on token rotation,
  revoke on sign-out; deep-link handler routes to the correct page.
- **End-to-end test**: scripted alert → assert delivery within 30s on each platform's emulator/sim
  + a real device for at least one platform; deep-link opens the correct page.

## Implementation steps

1. Migration + repo + handler + OpenAPI update; conformance test green.
2. Worker providers + per-user fan-out + quiet-hours/prefs honoring.
3. Config triad (config.go + docker-compose + Helm) — verify with `helm template`.
4. App registration + deep-link handling on each platform.
5. E2E delivery test scripted; attach trace to log.

## Gate

```powershell
go test ./internal/api ./cmd/notification-worker -run TestPush -race 2>&1 | Tee-Object $log -Append; "GO_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
helm template test ./helm/teslasync | Select-String -Pattern 'APNS_TEAM_ID|FCM_PROJECT_ID|WNS_PACKAGE_SID' | Tee-Object $log -Append
foreach($p in 'windows','android','apple'){ & "./apps/$p/push/e2e.ps1" 2>&1 | Tee-Object $log -Append; "PUSH_${p}_EXIT=$LASTEXITCODE" | Tee-Object $log -Append }
# EXIT=0 only if GO=0 + every PUSH_*=0 + helm template contains all three secret keys.
```

## Acceptance Criteria

- [ ] Migration + handler + OpenAPI committed; conformance test green.
- [ ] Worker fan-out honors user prefs + quiet hours; PII-free payload.
- [ ] Config keys in all three locations (config.go + compose + Helm) — verified via `helm template`.
- [ ] E2E delivery within 30s on every shipping platform; deep-link lands on the correct page.
- [ ] No prod credentials in repo; secrets via Helm secret.yaml only.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

In-app notification UI (already shipped in pages); SMS/email channels; rich notification attachments beyond title+body.

## Commit

```powershell
git add internal cmd helm docker-compose.yml api apps .github/prompts/monorepo/logs/p5-h5-0001-push.log
git commit -m "feat(push): end-to-end APNs/FCM/WNS infrastructure (P5/H5)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
