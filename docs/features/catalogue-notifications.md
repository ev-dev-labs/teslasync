# Notifications

Sidebar group **Notifications**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Notifications overview | `/notifications` | Historical trigger and delivery reporting by source, event type, severity, channel, status, and day; the unified inbox is available below the report. | Reporting panels and the inbox each show their own empty or error state. |
| Notification Inbox | `/notifications/inbox` | Same unified view of alert, system, automation, and scheduled notifications; open alert-backed rows to inspect and acknowledge them. | Renders an empty state when no data is available — the page is not hidden. |
| Alert Studio | `/notifications/studio` | Create signal, computed-metric, system-service outage/recovery, and saved-place arrival/departure rules from templates or a dynamic form. | Templates are available without installed rules. Place rules require a configured place. |
| Alert Rules | `/notifications/rules` | Search, filter, manage, and fully edit every rule type. System-service rules apply to the whole fleet; place rules can target one or more vehicles. | Create the first rule in Studio. |
| [Alert Packs](./alert-packs.md) | `/notifications/packs` | Preview and install curated or Helix-proposed groups, view installed packs, and open their rules for editing. | Pack previews remain available without installations or AI. |
| Notification Channels | `/notifications/channels` | Configure delivery destinations (including custom HMAC-signed webhooks), test deliveries, and choose which component outages and recoveries each channel receives. Add Channel → Webhook configures the URL, POST/PUT method and optional signing secret with a live signature preview. An existing signing secret is retained when the edit form is left blank. | Add a channel to configure system health routing; if the server has no event catalog or a request fails, the configuration panel offers refresh or retry. Disabled channels retain preferences but do not deliver. |
| Browser Notifications | `/notifications/browser` | Subscribe this device to closed-tab push, manage registered devices, and configure in-tab indicators, per-device filters, and sounds. | The push subscription is the primary control; browser permission alone does not enable closed-tab delivery. Failed subscription attempts display an actionable error. |
| Quiet Hours | `/notifications/quiet-hours` | Mute non-critical alerts during set times. | Renders an empty state when no data is available — the page is not hidden. |
| Notification Health | `/notifications/health` | One page with alert-fatigue scores and hourly noise, delivery SLO burn rates with 1h/24h windows and severity breakdowns, and latency percentiles, Apdex, cohorts, and slow records. Fatigue uses recorded inbox events (including archived ones); reliability and latency use channel-delivery attempts, not trigger-only rows. | Each section keeps its own loading, error, and empty states; the other sections remain available if one query fails. |

The inbox's top date range also controls its Notification activity report; there
is no second date picker. The All time preset includes historical periods.
**Triggers** count recorded
notification events once, even when no delivery channel is configured; **channel
deliveries** count individual delivery attempts. Older delivery-only records without
an event identifier appear under *Unattributed deliveries*, not as estimated
triggers. The inbox lists each recorded event once rather than duplicating it
across its configured channels.

The three Notification Health sections page through recorded events
using a `(created_at, id)` cursor rather than truncating at the first 1,000.
Delivery outcomes are measured separately from inbox events to avoid counting
channel fan-out as additional notifications.

[← All groups](./catalogue.md)
