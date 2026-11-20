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
  Center and can also trigger a separately opted-in browser notification.
  Comparisons do not send destinations to the vehicle.
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
  Select **Estimate outbound and return separately** to see a range for each
  leg and record planned destination charging. This is an assumption, not a
  confirmed charge. Advice that depends on finding another stop stays in
  Action Center; it does not push an unverified stop to your browser.
  In **Departure conflicts**, enter a service or software install window you
  have confirmed. If it overlaps departure and the car is confirmed parked,
  Action Center links to the plan or software page so you can review it.
  TeslaSync does not read your calendar or verify these windows with Tesla;
  update or remove the entry if the source schedule changes. Push requires
  both the plan's departure-conflict switch and a verified charging device.
  **Charging at a saved place** optionally compares one vehicle's measured
  charging sessions at a reviewed place. It needs two recent slower
  sessions and at least four comparable baseline sessions with similar
  charge levels and connector type. Energy per elapsed hour can include
  pauses; the Action Center card is not a diagnosis. Review the vehicle's
  current limit, schedule or charging place without changing them. This is
  separate from a trip plan, and never enables push or shares data externally.

  **Public charging fee reminders** are off by default. Review one saved
  public charging place and enter an operator HTTPS source, currency, fixed
  per-minute fee, grace period, and review validity. Confirm the terms apply
  after completion while the car remains plugged in, with no occupancy or
  other unresolved condition. TeslaSync does not fetch station terms or
  infer that a Tesla congestion fee applies. A receipt is not a forecast.
  The worker requires one matched completed session and fresh parked,
  connected telemetry at the reviewed site. It uses the earliest plausible
  fee start and stays silent if there is less than a minute to act. Advice
  does not prove a fee was charged and never sends vehicle commands.
  Optionally select the current verified browser when saving the review.
  It receives at most one token-only push attempt per session, subject to
  personal quiet hours and the shared push budget. Open the notification to
  review that session's timing and source. Turning reminders off, editing
  the place, changing the review or re-verifying the browser invalidates
  old claims. Migration `000274` can stay applied on application rollback;
  its explicit down removes only fee reviews and their delivery records.

ForwardAuth is optional. With verified sign-in, derived plans, routines, and
devices are separate by account. Without sign-in, people who can access that
installation share its plans, routines, and device settings.

### Optional solar charging opportunities

In **Charging readiness → Solar charging opportunities**, connect one Tesla
Energy site by its `energy_site_id` from the Tesla Fleet API Products endpoint.
Register `https://<your-teslasync-host>/api/v1/smart-charging/solar/connection/callback`
as an extra Tesla OAuth redirect URI on the same origin as the configured
`TESLA_REDIRECT_URI`. Use HTTPS, the same `ENCRYPTION_KEY` on the API and
worker, and distributed Redis live reads. If you run your own ingress, omit
the callback query string from its request logs; the code and state are
short-lived credentials. The vehicle account stays separate. This grant
requests `energy_device_data`, never `energy_cmds`. Confirm that your Tesla
account can read the selected site and review your API limits first.

After connecting, explicitly select a reviewed home charger for the selected
vehicle and enable checks. Linking alone does not start polling. An eligible
parked, plugged-in vehicle can trigger one site status request per minute
per plan, plus a reserve lookup when needed, subject to the worker's bounded
batch and the Fleet API request budget. The worker sends the selected site
ID and its Tesla credential, not vehicle locations or driving history. It
needs at least three timestamped readings over at least three minutes with
1,400 W or more of solar export, no meaningful battery discharge, and the
backup battery at least five percentage points above its reserve. Advice
expires quickly and appears only in Action Center and Charging readiness.
No push, wake, vehicle operation, or home settings change is performed.

Turn off checks for one vehicle or choose **Disconnect Tesla Energy and remove
all solar plans** to delete this scope's grant, plans, and evidence. This
disconnects TeslaSync locally; you can also revoke account access in Tesla.
Stop the worker before explicitly rolling down `000275`; down removes the
separate Energy grants and solar data, not the existing Tesla vehicle login.

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

For a confirmed routine, you can also enter an optional **Arrival deadline**
in its local time zone, without connecting a calendar. If the usual route
and all qualifying routes offered by HERE would miss it at the planned
departure, TeslaSync estimates an earlier departure with a three-minute
buffer. It asks HERE to check that earlier departure time using the same
approved trace, not the deadline itself. Advice is suppressed if the earlier
estimate cannot meet the deadline, route coverage is incomplete, or there
is too little time left to leave. This is a forecast, not an arrival guarantee.
When both types of advice apply they share one comparison and at most one
personal push. To roll back this optional deadline feature, stop the worker
and roll down `000270` before starting older binaries.

For a pre-drive energy comparison, separately enable **Compare routes using
local driving energy history** in the routine's traffic review. TeslaSync
matches completed drives for that vehicle against the routes offered by HERE.
Each compared route needs at least four distinct days with comparable travel
times and outdoor temperatures, complete paired battery-power observations,
and substantially different recorded energy ranges. The comparison separates
HERE's estimated travel times from previously measured net battery energy;
neither is a measurement of the upcoming trip. History stays on this
installation. Missing coverage or inconclusive evidence produces no energy
recommendation. An energy comparison alone never sends a push or operates
the vehicle. Disconnect HERE to remove consent immediately; to keep timing
checks without energy comparisons, review the trace again with energy
comparison turned off. Stop the notification worker before rolling back.
Rolling down `000273` restores the previous evidence storage format without
discarding comparisons. Rolling down `000272` then removes only the energy
option and evidence, preserving existing timing and deadline decisions.

**Skip today** suppresses the current occurrence. **Pause** suspends checks
without deleting the approved trace. **Disconnect HERE**, turning off local
analysis or Smart Commute, and editing or deleting the routine revoke the
trace and active comparisons. A subsequent setup requires reviewing the
route again. To roll back, stop the notification worker first; migration
`000268` down removes traffic consent and decision data without deleting
source drives. Require fresh consent after rollback to an older API that
does not track traffic settings.

For Smart Commute suggestion outcomes, `teslasync_smart_commute_suggestion_resolutions_total`
counts saved confirmations and **Not mine** dismissals. Browsing a suggestion,
creating a manual routine, editing a confirmed routine, and retrying an
already saved dismissal do not count. The only label is the outcome; the
counter does not contain trip details or indicate time saved.

### Optional personal browser push

In-app recommendations work without push credentials. For personal push, set
`TESLASYNC_VAPID_PUBLIC_KEY`, `TESLASYNC_VAPID_PRIVATE_KEY`, `TESLASYNC_VAPID_SUBJECT`,
and the same `ENCRYPTION_KEY` on the API and notification worker. In Helm, use the
chart's `webPush` and `encryption` values. Keep private keys in the deployment's
secret configuration. Use a supported browser on a secure, same-origin
connection, then choose **Connect this browser** under **Smart Commute** or
**Charging readiness**. After verification, enable only the notification family
you want. Enable commute push on the browser that should receive it. Commute
accepts one browser per account (or per open installation). Selecting another
browser invalidates pending commute deliveries for the previous browser without
changing its charging preferences.

The browser push service receives an encrypted, short-lived token, not trip
details. TeslaSync checks scope, device consent, and current evidence before
showing a generic notification. Commute notifications open the specific
comparison that triggered them. If you have already left or the comparison has
expired, it is no longer available. Device disconnect invalidates its pending
personal deliveries but leaves routines, plans, and ordinary alert channels
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
Before reverting to a release without commute push, stop the worker, roll
down later migrations first, then roll down `000269`. That removes commute device preferences and attempts, not the
verified devices, charging preferences, or approved traffic traces.

### Connector capabilities and limits

Provider documentation describes what an authorized account may request. It
does not confirm coverage, entitlement, or a successful live connection.

| Decision | Documented capability | Smart Notifications support |
|---|---|---|
| Traffic-aware alternatives | [HERE Routing v8](https://docs.here.com/routing/docs/routing-v8-get-started) returns route timing, including traffic-aware duration and base duration. [Traffic-aware requests](https://docs.here.com/routing/docs/routing-v8-traffic-incidents-spans) accept a departure time. | Optional licensed, per-routine read only. The contract test uses local responses. Static route estimates, incidents alone, and yesterday's trips do not establish an exception. |
| Timely rain forecast | [Open-Meteo's forecast API](https://open-meteo.com/en/docs) accepts coordinates and lists hourly precipitation probability and rain. Review its terms for the installation's use. | Not wired to smart notifications. A forecast alone would not prove outdoor parking or an open window. No coordinates are sent for this purpose. |
| Calendar deadlines | [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) distinguish availability-only access, read-only event access, and event edits. An availability window does not give a trip's deadline or destination. | Enter a confirmed arrival deadline, service window or software install window manually. No calendar connector or calendar writes. |
| Tariffs, station status and fees | [OpenEI's U.S. Utility Rate Database](https://apps.openei.org/services/doc/rest/util_rates/?version=7) publishes rate structures and effective dates. [HERE EV Charge Points](https://docs.here.com/ev-products/reference/here-ev-charge-points-api-v3) documents provider-dependent connector status and tariffs. [Tesla congestion fees](https://www.tesla.com/support/charging/supercharger/fees) depend on conditions such as site occupancy. [Electrify America](https://www.electrifyamerica.com/pricing/) directs drivers to the app or charger for current site pricing and fees. | Use configured tariffs and separately reviewed, unconditional fee terms. No provider tariff import, live stall claim, or occupancy-dependent fee prediction. The traffic license does not establish access to a station feed. |
| Household energy and backup | [Tesla energy endpoints](https://developer.tesla.com/docs/fleet-api/endpoints/energy) document site status and reserve. [Tesla OAuth scopes](https://developer.tesla.com/docs/fleet-api/authentication/overview) separate energy data reads (`energy_device_data`) from settings changes (`energy_cmds`). | Optional solar export advice uses a separate read-only grant. It does not infer that an EV caused backup draw during an outage, establish vehicle-to-home support, or change energy settings. Live Tesla verification has not been run. |
| Recall applicability | [NHTSA's public API](https://www.nhtsa.gov/nhtsa-datasets-and-apis) returns recalls by model year, make and model. Its [VIN lookup](https://www.nhtsa.gov/recalls) checks for open recalls for a particular vehicle. | No smart recall delivery. A model-level match would only justify a verification card, not an open-VIN claim or urgent push. |
| Spotify matching, save and playback | [Spotify Web API](https://developer.spotify.com/documentation/web-api) supports metadata search, playlists and playback. [Private playlist writes and playback control](https://developer.spotify.com/documentation/web-api/concepts/scopes) are separate permissions. [Start or resume playback](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback) requires Premium and a supported player. | No smart Spotify adapter. Track metadata does not prove a listen, and an external link does not confirm playback or episode progress. |
| YouTube Music matching, save and playback | [YouTube Data API playlists](https://developers.google.com/youtube/data/guides/implementation/playlists) manage YouTube video playlists with authorization. That is not a documented YouTube Music catalog, listening-history or playback-control contract. | No YouTube Music connector. Do not use personal browser credentials, private endpoints or video playlists as a substitute for one. |

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
