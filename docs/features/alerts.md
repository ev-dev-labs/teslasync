# Alerts and Notifications

TeslaSync supports alert rules, notification channels, alert history, and automation triggers.

## User-facing pages

| Page | Purpose |
|---|---|
| Alerts | Alert history and current alert status |
| Alert Studio | Typed rule management for supported signal and vehicle conditions |
| Notifications | Channel configuration, delivery logs, stats, schedules |
| Automations | Workflow list and execution state |
| Automation Builder | Build and edit trigger/action workflows |
| Guard Mode | Vehicle-focused anti-theft/panic event workflows |

## Rule model

Rules evaluate live or recent vehicle state and produce alerts, notifications, or automation events through typed CTI contracts. Supported operators and trigger families are explicit platform contracts rather than free-form payloads.

## Phase 36 operator note

| Topic | Phase 36 platform decision |
|---|---|
| Clean-slate prerequisite | Phase 36 is safe only when alert-rule, automation, automation-step, and automation-history production counts are zero. |
| Breaking change posture | Legacy rules-platform payloads are not migrated in this phase; unsupported payloads are rejected rather than silently translated. |
| Rollback | No schema change is expected; rollback is code rollback/redeploy if the phase causes unexpected behavior. |
| Future extensibility | Future automation trigger families or new alert operators require schema/model/API/frontend/runtime/docs/tests work in a later explicit phase before they become typed CTI contracts. |
| Unsupported legacy surfaces | Old JSON automation imports, legacy rule builders, and unsupported trigger families are unavailable until redesigned as typed CTI contracts. |

## Notification channels

The backend supports multiple delivery integrations through notification workers and logs delivery attempts for observability. Keep secrets in environment variables or Kubernetes secrets, not in docs or code.

## Public webhooks

Automation webhook routes use URL tokens as authentication and are rate-limited. They should still be served only over HTTPS.

## Troubleshooting

- If rules do not fire, check live state freshness first.
- If notifications do not send, check channel configuration and worker logs.
- If ForwardAuth is enabled, ensure automation webhook routes are intentionally reachable by token.
