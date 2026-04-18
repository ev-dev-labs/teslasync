---
description: "Automation action: notifications — send alerts via any configured notification channel"
---

# Action: Notification

## Config
```json
{"type": "notify", "channel": "all", "message": "Automation '{{name}}' ran: {{status}}", "title": "TeslaSync Automation"}
```

Channels: `all`, `discord`, `slack`, `telegram`, `email`, `webhook`, `ntfy`, `pushover` — matches the existing notification system.

## Implementation
Create `internal/automation/action/notify.go`. Reuses the existing `internal/notification/` dispatcher. Template variables: `{{name}}`, `{{vehicle}}`, `{{status}}`, `{{trigger}}`, `{{error}}`, `{{battery_level}}`, `{{timestamp}}`. Resolve templates before sending.
