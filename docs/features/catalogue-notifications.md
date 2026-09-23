# Notifications

Sidebar group **Notifications**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Notifications overview | `/notifications` | Historical trigger and delivery reporting by source, event type, severity, channel, status, and day; the unified inbox is available below the report. | Reporting panels and the inbox each show their own empty or error state. |
| Notification Inbox | `/notifications/inbox` | Same unified view of alert, system, automation, and scheduled notifications; open alert-backed rows to inspect and acknowledge them. | Renders an empty state when no data is available — the page is not hidden. |
| Alert Studio and [Alert Packs](./alert-packs.md) | `/notifications/studio` | Create individual rules or preview and install curated/custom groups, optionally proposed by Helix. | Manual templates and pack previews remain available without installed rules or AI. |
| Notification Channels | `/notifications/channels` | Where alerts are sent — email, SMS, push, webhook. | Renders an empty state when no data is available — the page is not hidden. |
| Webhooks | `/notifications/webhooks` | POST alerts to your own URL for downstream automation. | Renders an empty state when no data is available — the page is not hidden. |
| Browser Notifications | `/notifications/browser` | Enable browser push notifications for this device. | Renders an empty state when no data is available — the page is not hidden. |
| Quiet Hours | `/notifications/quiet-hours` | Mute non-critical alerts during set times. | Renders an empty state when no data is available — the page is not hidden. |
| Alert Fatigue | `/alert-fatigue` | Identify noisy alert rules and reduce repetitive notifications. | Renders an empty state when no data is available — the page is not hidden. |
| Notification Burn Rate | `/notification-burn-rate` | Track notification reliability against its error budget. | Renders an empty state when no data is available — the page is not hidden. |
| Notification Latency | `/notification-latency` | Measure delivery speed and tail latency by channel. | Renders an empty state when no data is available — the page is not hidden. |

The overview's date range includes historical periods. **Triggers** count recorded
notification events once, even when no delivery channel is configured; **channel
deliveries** count individual delivery attempts. Older delivery-only records without
an event identifier appear under *Unattributed deliveries*, not as estimated
triggers. The inbox lists each recorded event once rather than duplicating it
across its configured channels.

[← All groups](./catalogue.md)
