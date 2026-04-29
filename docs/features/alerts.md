# Alerts and Notifications

TeslaSync supports alert rules, notification channels, alert history, and automation triggers.

## User-facing pages

| Page | Purpose |
|---|---|
| Alerts | Alert history and current alert status |
| Alert Studio | Rule builder for signal/vehicle conditions |
| Notifications | Channel configuration, delivery logs, stats, schedules |
| Automations | Workflow list and execution state |
| Automation Builder | Build and edit trigger/action workflows |
| Guard Mode | Vehicle-focused anti-theft/panic event workflows |

## Rule model

Rules evaluate live or recent vehicle state and produce alerts, notifications, or automation events. The exact condition tree is stored as structured data so new operators can be added without redesigning the page.

## Notification channels

The backend supports multiple delivery integrations through notification workers and logs delivery attempts for observability. Keep secrets in environment variables or Kubernetes secrets, not in docs or code.

## Public webhooks

Automation webhook routes use URL tokens as authentication and are rate-limited. They should still be served only over HTTPS.

## Troubleshooting

- If rules do not fire, check live state freshness first.
- If notifications do not send, check channel configuration and worker logs.
- If ForwardAuth is enabled, ensure automation webhook routes are intentionally reachable by token.