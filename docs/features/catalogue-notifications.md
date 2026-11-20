# Notifications

Sidebar group **Notifications**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Notifications overview | `/notifications` | Historical trigger and delivery reporting by source, event type, severity, channel, status, and day; the unified inbox is available below the report. | Reporting panels and the inbox each show their own empty or error state. |
| Notification Inbox | `/notifications/inbox` | Same unified view of alert, system, automation, and scheduled notifications; open alert-backed rows to inspect and acknowledge them. | Renders an empty state when no data is available — the page is not hidden. |
| Archived notifications | `/notifications/archived` | Inspect archived events and restore them to the inbox without losing recorded details. | Keeps filter controls available when the archive or filtered result is empty. |
| Alert Studio | `/notifications/studio` | Create signal, computed-metric, system-service outage/recovery, and saved-place arrival/departure rules from templates or a dynamic form. | Templates are available without installed rules. Place rules require a configured place. |
| Alert Rules | `/notifications/rules` | Search, filter, manage, and fully edit every rule type. System-service rules apply to the whole fleet; place rules can target one or more vehicles. | Create the first rule in Studio. |
| [Alert Packs](./alert-packs.md) | `/notifications/packs` | Preview and install curated or Helix-proposed groups, view installed packs, and open their rules for editing. | Pack previews remain available without installations or AI. |
| Notification Channels | `/notifications/channels` | Configure delivery destinations (including custom HMAC-signed webhooks) and test deliveries. Add Channel → Webhook configures the URL, POST/PUT method and optional signing secret with a live signature preview. An existing signing secret is retained when the edit form is left blank. Configure system-service outage/recovery rules in Alert Studio. | Add a channel to configure delivery; disabled channels retain their settings but do not deliver. |
| Browser Notifications | `/notifications/browser` | Subscribe this device to closed-tab push, manage registered devices, and configure in-tab indicators, per-device filters, and sounds. | The push subscription is the primary control; browser permission alone does not enable closed-tab delivery. Failed subscription attempts display an actionable error. |
| Quiet Hours | `/notifications/quiet-hours` | Mute non-critical alerts during set times. | Renders an empty state when no data is available — the page is not hidden. |
| Notification Health | `/notifications/health` | One page with alert-fatigue scores and hourly noise, delivery SLO burn rates with 1h/24h windows and severity breakdowns, and latency percentiles, Apdex, cohorts, and slow records. Fatigue uses recorded inbox events (including archived ones); reliability and latency use channel-delivery attempts, not trigger-only rows. | Each section keeps its own loading, error, and empty states; the other sections remain available if one query fails. |

## Smart notifications

Open **Notifications → Smart notifications** in the sidebar. On a phone, open
**More** or **Browse sections** first.

- **Smart Commute** (`/settings/smart-commute`): Enable local drive analysis for a
  selected vehicle, then confirm or decline suggestions in Action Center. You
  can also enter a routine without enabling history analysis. Pause or disable
  checks, or delete derived commute data without deleting the original drives.
  Installations with a licensed HERE connection can opt into traffic checks
  for individual confirmed routines. Current comparisons appear in Action
  Center; commute push and sending destinations are not part of this increment.
- **Charging readiness** (`/settings/smart-charging`): Choose a known charging
  place, enter a planned departure and reserve, and enable the plan. Review
  actionable plug-in, slow-charging, and schedule warnings in Action Center.
  An intended charging start is a date and time you enter, not a command.
  TeslaSync compares its clock time with the vehicle's fresh pending-schedule
  signal; the vehicle signal does not identify a date. If you also enter a
  known site power limit, TeslaSync can warn that even a best-case estimate
  leaves too little time to charge before departure. The limit is not measured
  power. Pausing, snoozing, or deleting the plan stops its current advice.
  Nothing changes the vehicle schedule, charging current, or a place's prices.
  In **Departure conflicts**, enter a service or software install window you
  have confirmed. If it overlaps departure and the car is confirmed parked,
  Action Center links to the plan or software page so you can review it.
  TeslaSync does not read your calendar or verify these windows with Tesla;
  update or remove the entry if the source schedule changes. Push requires
  both the plan's departure-conflict switch and a verified charging device.

ForwardAuth is optional. With verified sign-in, derived plans, routines, and
devices are separate by account. Without sign-in, people who can access that
installation share its plans, routines, and device settings.

### Optional HERE traffic checks

The connector is off by default. You need a HERE agreement permitting
background calls to Routing v8 and Traffic Flow v7 and short-lived retention
and display of the resulting ETAs. Check your account's coverage, limits,
and costs first; do not assume these calls are free or allowed under a
generic API key. Set `SMART_COMMUTE_HERE_LICENSE_CONFIRMED=true` and
provide `SMART_COMMUTE_HERE_API_KEY` via the API and notification-worker
environment. In Helm, use `smartCommute.hereLicenseConfirmed`. Supply the
key in the existing or external Secret, or use `smartCommute.hereApiKey`
when the chart manages the Secret. The worker also requires Redis
distributed live reads. Do not copy the key into web configuration.

Confirm a routine, choose **Set up traffic checks**, and review one recent
representative drive. Previewing reads the trace on this server. Only after
you separately allow sharing do scheduled requests send the reviewed
coordinates (at most 200), the planned departure time, and HERE route
segment references. No drive history, VIN, or person or routine name is
shared. One eligible departure can use a route import, an alternatives
request, and several batched traffic-flow requests. No check wakes the car.
Missing or stale live state, different origin, quiet hours, unavailable or
stale traffic, and a saving below the configured minimum suppress the
comparison. Treat all displayed durations as estimates.

**Skip today** suppresses the current occurrence. **Pause** suspends checks
without deleting the approved trace. **Disconnect HERE**, turning off local
analysis or Smart Commute, and editing or deleting the routine revoke the
trace and active comparisons. A subsequent setup requires reviewing the
route again. To roll back, stop the notification worker first; migration
`000268` down removes traffic consent and decision data without deleting
source drives. Require fresh consent after rollback to an older API that
does not track traffic settings.

### Optional personal browser push

In-app recommendations work without push credentials. For charging push, set
`TESLASYNC_VAPID_PUBLIC_KEY`, `TESLASYNC_VAPID_PRIVATE_KEY`, `TESLASYNC_VAPID_SUBJECT`,
and the same `ENCRYPTION_KEY` on the API and notification worker. In Helm, use the
chart's `webPush` and `encryption` values. Keep private keys in the deployment's
secret configuration. Use a supported browser on a secure, same-origin
connection, then choose **Connect this browser** under **Charging readiness**.
After the device is verified, turn on charging push for that device separately.

The browser push service receives an encrypted, short-lived token, not trip
details. TeslaSync checks scope, device consent, and current evidence before
showing a generic notification. Device disconnect invalidates its pending
personal deliveries but leaves the charging plan and ordinary alert channels
unchanged. If push is unavailable, check Action Center; TeslaSync does not fall
back to broadcasting advice to an existing channel.

For a local synthetic check, run the real-handler browser journey against a
disposable PostgreSQL database and a production web build. The
`private-notifications` job in `frontend-quality.yml` shows the exact
environment and command. It does not need a Tesla account or a live push
provider. To roll back the departure-window or dated charging-start features,
pause affected plans and stop the worker before applying the corresponding
down migrations in reverse order (`000267`, `000266`, `000265`). They remove
the recorded windows, limits, and start times and invalidate affected
notifications. Leave the schema applied if you need to preserve those inputs.

## Notification history and health

The header's **View settings** owns the date range for inbox history and its
Notification activity report. Use **All time** to include older Alert Studio
notifications rather than adding a second date picker inside the page.

The inbox and archive default to compact evidence tables. Column-header filters
control severity, notification text, source/vehicle/rule, and read state. On
phones, the **Notification** header exposes all these filters and a reset.
Filters are saved in the URL and applied by the server to rows and counts before
pagination; the current page is not treated as a complete list of filter values.
Headers and reset controls remain available for loading, empty, and failed
results. Grouped threads remain an optional view with their own controls.
Inspect a row for its full message, recorded timestamps, source, delivery
metadata, and actions; unavailable metadata stays unknown rather than becoming
a successful delivery.

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
The health page starts with three linked overview cards that jump to the
full-length Fatigue, Burn Rate, and Latency sections (also reachable with
`#fatigue`, `#burn-rate`, and `#latency`). All charts, chart export/data views,
rule and severity breakdowns, latency cohorts, and slow delivery records remain
available on the same page. Metrics stack on phones, form two columns on
tablets, and four columns on wide screens. Each section retains its own
loading, retry/error, and no-data presentation; no section is hidden when a
different history source fails.

The inbox and archive keep pagination inside the grid footer. Changing **Rows**
requests 25, 50, or 100 records from the server and resets to the first page
without clearing the active filters. Numbered pages and **Go to page** use the
server's total, not just the loaded rows. The Columns menu's **Select all**
reflects partial visibility and always retains at least one usable column.
Flat tables use the shared Search, Compact/Comfortable, Export, and Columns
toolbar. Search filters messages on the server and resets pagination; exports
cover the loaded page or selected loaded records, not the entire server history.

[← All groups](./catalogue.md)
