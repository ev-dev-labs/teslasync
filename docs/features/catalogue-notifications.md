# Notifications

Sidebar group **Notifications**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Notifications overview | `/notifications` | Historical trigger and delivery reporting by source, event type, severity, channel, status, and day; the unified inbox is available below the report. | Reporting panels and the inbox each show their own empty or error state. |
| Notification Inbox | `/notifications/inbox` | Same unified view of alert, system, automation, and scheduled notifications; open alert-backed rows to inspect and acknowledge them. | Renders an empty state when no data is available — the page is not hidden. |
| Alert Studio and [Alert Packs](./alert-packs.md) | `/notifications/studio` | Create individual rules or preview and install curated/custom groups, optionally proposed by Helix. | Manual templates and pack previews remain available without installed rules or AI. |
| Notification Channels | `/notifications/channels` | Configure delivery destinations (including custom HMAC-signed webhooks), test deliveries, and choose which component outages and recoveries each channel receives. Add Channel → Webhook configures the URL, POST/PUT method and optional signing secret with a live signature preview. An existing signing secret is retained when the edit form is left blank. | Add a channel to configure system health routing; if the server has no event catalog or a request fails, the configuration panel offers refresh or retry. Disabled channels retain preferences but do not deliver. |
| Browser Notifications | `/notifications/browser` | Subscribe this device to closed-tab push, manage registered devices, and configure in-tab indicators, per-device filters, and sounds. | The push subscription is the primary control; browser permission alone does not enable closed-tab delivery. Failed subscription attempts display an actionable error. |
| Quiet Hours | `/notifications/quiet-hours` | Mute non-critical alerts during set times. | Renders an empty state when no data is available — the page is not hidden. |
| Alert Fatigue | `/alert-fatigue` | Identify noisy notification sources from the full recorded inbox history, including archived events. | Renders an empty state when no data is available — the page is not hidden. |
| Notification Burn Rate | `/notification-burn-rate` | Track all recorded channel-delivery attempts against its error budget (with 1h and 24h windows). | Renders an empty state when no data is available — the page is not hidden. |
| Notification Latency | `/notification-latency` | Measure speed and tail latency from all recorded channel-delivery attempts; trigger-only inbox rows are not measurements. | Renders an empty state when no data is available — the page is not hidden. |

The inbox's top date range also controls its Notification activity report; there
is no second date picker. The All time preset includes historical periods.
**Triggers** count recorded
notification events once, even when no delivery channel is configured; **channel
deliveries** count individual delivery attempts. Older delivery-only records without
an event identifier appear under *Unattributed deliveries*, not as estimated
triggers. The inbox lists each recorded event once rather than duplicating it
across its configured channels.

The fatigue, burn-rate, and latency dashboards page through recorded events
using a `(created_at, id)` cursor rather than truncating at the first 1,000.
Delivery outcomes are measured separately from inbox events to avoid counting
channel fan-out as additional notifications.

[← All groups](./catalogue.md)
