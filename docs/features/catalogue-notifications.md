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
  **Latest safe start estimates** use positive measured charging power at the
  selected place, a nominal pack-energy estimate, and a 25% time buffer. A
  connected plug or a configured power limit is not a measurement.
  If a fresh estimate suggests moving readiness checks earlier, use **Review
  an earlier reminder time** to preview a check 15 minutes before the buffered
  deadline (or earlier when needed for the plan's departure cutoff). The
  preview identifies the exact time in UTC as well as local time. **Save earlier
  check** changes only that time after rechecking the plan and evidence.
  The worker still rechecks the shortfall;
  no new push is sent unless you enabled a verified charging device.
  To compare charging now with a lower-price window, enter dated energy
  prices for that place and opt in on the plan. A comparison needs continuous
  price coverage in one currency, a feasible later start, and savings of at
  least 10% and one currency unit. It excludes taxes, fixed fees, and losses.
  It does not import a utility tariff or postpone charging.
  Select **Estimate outbound and return separately** to see a range for each
  leg and record planned destination charging. This is an assumption, not a
  confirmed charge. Advice that depends on finding another stop stays in
  Action Center; it does not push an unverified stop to your browser.
  Split-trip and charging schedule or rate warnings only push if a correction
  could still cover the higher trip estimate and reserve. The check uses fresh
  pack energy and charge limit, two recent metered sessions that cover the needed
  charge range at that vehicle's selected site, and time to act. A vehicle's
  maximum requested current or a site power ceiling alone does not establish
  that increasing the rate will help. Without corroboration, review the
  shortfall privately in Action Center; no history is sent to a provider.
  In **Departure conflicts**, enter a service or software install window you
  have confirmed. If it overlaps departure and the car is confirmed parked,
  Action Center links to the plan or software page so you can review it.
  TeslaSync does not read your calendar or verify these windows with Tesla;
  update or remove the entry if the source schedule changes. Push requires
  both the plan's departure-conflict switch and a verified charging device.
  Reviewing an overlapping appointment does not suppress separate charging
  advice. If both issues qualify in the same check, prefer the opted-in
  conflict for push and show both in Action Center. A previously sent plug-in
  reminder does not use up the conflict's once-per-departure attempt, but both
  still share the personal cooldown and budget.
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

### Optional cold tire checks

Select your vehicle on **Tire differential drift → Cold tire checks** and
choose **Record a cold gauge check**. With ForwardAuth, the series belongs
to the signed-in account. In open mode, the series and its Action Center card
are shared by this installation; account-scoped readings remain separate.
It is off until you save a confirmed check. Use all four tires measured
with the same gauge in comparable conditions before driving. Enter the actual
reading time and ambient temperature; separate readings by at least 18 hours.
Start over if you adjust pressure or rotate or replace a wheel. Existing TPMS
chart values are not treated as verified cold readings.

The server evaluates when you save a reading, with no background provider
request, push, or vehicle wake. It requires five comparable checks spanning at
least seven days, a fresh observation, and a repeated drop of one wheel
relative to the other three. Common shifts, a one-off step, insufficient or
stale observations, and ambiguous two-wheel changes do not publish. The
Action Center card links back to the evidence and expires 72 hours after the
last reading. It does not diagnose a leak, choose a pressure target, or replace
the vehicle's warnings.

Only the last 30 days are used; older rows are pruned the next time you save.
**Turn off and clear readings** removes the scoped series and its card without
changing telemetry, existing alerts, or vehicle settings. Test with
`TestColdTireReviewPersistsOnlyScopedRepeatedDrift` on disposable PostgreSQL.
Migration `000280` may stay applied on application rollback; rolling it down
explicitly deletes only cold gauge checks and projections.

### Optional private recall watch

On **Maintenance → Private recall watch**, select a vehicle while signed in.
Enter its exact Tesla model and model year, then separately approve the U.S.
[NHTSA public recall catalog](https://www.nhtsa.gov/nhtsa-datasets-and-apis).
It is off until saved. The worker checks once a day after successful reads and
retries later if the source is unavailable. NHTSA receives only the make, model,
and model year. The watch does not send the VIN, telemetry, or history. It
does not require a provider account or paid subscription.

Up to five recently reported, exact model-year campaign matches show the
published remedy and its official source in private cards. Duplicate campaign
rows do not create multiple cards. A model-year match is **not** an open recall
or a remedy status for the VIN, even when the public notice includes urgent
guidance. No push is sent. Follow the
[official Tesla VIN lookup](https://service.tesla.com/en-US/vin-recall-search)
and enter the VIN there yourself. This watch does not cover all jurisdictions,
older campaigns, or service bulletins; no matches are not an all-clear.

Cards expire within 48 hours of their last catalog check, or 90 days after
the report. Updating the vehicle context or turning off the watch invalidates
work in flight and removes old matches. Migration `000281` can remain applied
on binary rollback; explicit down deletes only the watch and its derived
matches. Validate using `TestRecallWatchUsesOnlyConsentedModelYearAndScopesPrivateCampaign`
with disposable PostgreSQL and the local NHTSA contract fixture.

### Optional private service case

Select a vehicle and go to **Diagnostics → Service evidence pack → Private
service case**. Open a case with a title, then record relevant warnings,
conditions, firmware, or completed work. Notes accept observations from up to
14 days before the case opened. There is one private case per signed-in
person and vehicle, with up to 20 notes. The notes are user-recorded, not
validated telemetry, a service history from Tesla, or a diagnosis.

The private Action Center card appears only when the case has recorded
evidence and expires 30 days after the last note change. It does not contain
the case title or notes and is never pushed.
Under **Select and redact evidence**, choose the details and timestamps to
include, preview them, then select **Download reviewed JSON**. Nothing is
selected by default, and the download does not identify the vehicle, person,
or case. Selected free text is included as written, so leave out any details
you do not want to share. Changing the case or the selection requires a new
preview. The app does not upload the file or send it to a technician.

**Delete private case** clears the case, its notes, and its card without
changing source telemetry or downloaded files. Migration `000282` can stay
applied on application rollback; rolling it down deletes case drafts and notes.
Use `TestPrivateServiceCaseSelectsAndExportsOnlyReviewedFields` with disposable
PostgreSQL and the real-handler Chromium lane `TestPrivateServiceCaseBrowserJourney`
for a synthetic case, redaction, export and account-isolation check.
Outcome counters contain no note or identity labels. A served download
does not imply that a file was saved or shared.

### Optional parked charge reserve

In **Vampire drain → Private parked charge reserve**, select the vehicle and
confirm one currently parked, unplugged stay. Set a return 12 hours to seven
days away and the minimum charge you want on return. TeslaSync checks for up
to 90 minutes while you can still adjust your plans. It uses at least three
comparable same-vehicle parks with producer-timestamped charge at both ends; it does not
wake the vehicle to collect observations. The range is an estimate, not a
measurement of future charge.

The estimate is private and can be used without push. Elect this verified
browser separately if you want one reminder when measured historical loss
suggests a reserve crossing. The browser push service receives only a short-lived
opaque token. Quiet hours, the shared device budget, uncertainty, elapsed
action time, or changed conditions can suppress the reminder. **Review
charging** opens the existing vehicle overview; it does not start charging.
Turning off and clearing the plan invalidates pending claims without deleting
source telemetry. Disconnecting the browser invalidates push and keeps the
in-app plan. No setup is enrolled automatically. To test locally, use synthetic
completed drive brackets and distributed live observations and deliver through
the fixture sender. For an application rollback, leave additive migration
000285 applied; rolling it down clears only parked reserve plans and attempts.

### Optional private overnight drain review

In **Vampire drain → Private overnight drain review**, select the vehicle, set
the local time zone, and confirm local analysis. The check starts after 06:15
for a completed 22:00–06:00 night. It needs producer-timestamped charge and
nearby outside-temperature readings at both ends, and at least four comparable nights.
The card appears only for material excess loss with a directly reported Sentry
or cabin climate/protection observation or a successful, explicitly issued
wake request during the same measurement. Requests use the recorded start
time, not when the provider replied; older completion-only records do not
qualify. These are coincidences, not causes or proof that the car woke.
Missing or corrected measurements and conflicting trip or charge evidence
withdraw the review.

The card expires at local noon and never sends push or asks the vehicle for
data. **Compare with your drain sessions** opens the existing read-only
history on the same page. Dismiss only this morning, pause future checks, or
turn off and clear the consent and derived result without deleting telemetry.
Use `TestOvernightDrainPrivateMorningLifecycle` and
`TestOvernightDrainBrowserJourney` with disposable PostgreSQL and synthetic
nights. Keep additive migration `000286` on application rollback; rolling it
down removes only the private plans and derived evidence.

### Optional private monthly battery digest

Select your vehicle in **Battery degradation**, open **Private monthly battery
digest**, and confirm local analysis and a time zone. The default is off.
The first check for the latest two complete months begins at 5 AM on the
second day of the month in that zone. A digest needs at least eight comparable
charge days per month, at least four in each half of the newer month, and a
change beyond the baseline range that persists in both halves. Insufficient
measurements, incompatible charging conditions, and changes within the
estimated range stay quiet.

The digest estimates usable energy from actual battery-side energy added and
changes in charge during comparable AC sessions. It shows the date, ranges
and sample counts, not a capacity measurement or diagnosis. Charging losses
and battery calibration can affect the estimate. Review the existing
degradation history for more context. Nothing is sent outside TeslaSync, and
the digest never sends push or asks the car for data.

Dismiss a month, pause later checks, or turn off and delete the derived
settings without changing source telemetry. A digest expires at the next
monthly release. Missing or conflicting source sessions, or corrected source
measurements, also withdraw it. Migration `000310` leaves enrollment and source
telemetry intact; earlier battery results without proof are hidden until the
next eligible check.
Use `TestCapacityDigestPersistentPrivateLifecycle` and
`TestCapacityDigestBrowserJourney` with disposable PostgreSQL and synthetic
sessions. Leave additive migration `000287` applied on application rollback;
rolling it down removes only private digest plans and evidence.

### Optional private window rain watch

Select your vehicle in **Security & access → Private window rain watch**.
Verify this browser under **Personal delivery**, then confirm the vehicle is
parked outdoors now, authorize coarse location sharing with Open-Meteo, and
confirm the installation qualifies under its [free API terms](https://open-meteo.com/en/terms).
For personal, non-commercial use, Open-Meteo publishes limits of 600 requests
per minute, 5,000 per hour, and 10,000 per day. This watch does not support a
commercial plan. It is off by default and does not inherit location consent
from other weather features.

The watch lasts for one Park observation and at most four hours. The worker
needs actual Park and fresh location and open-window observations before
contacting the provider. It sends a point rounded to two decimal places and
the forecast fields, not a VIN, exact position, or driving history. An alert requires at
least 65% probability of precipitation and at least 0.3 mm forecast rain
and showers in an hourly interval starting within 90 minutes while your
watch is active. The forecast is from Open-Meteo, not observed rainfall or
a claim about the chance of rain specifically.

If safe, check the window in person. Opening the alert does not wake the
vehicle, close a window, or issue any other command. The private push is
subject to quiet hours and the shared browser budget, with at most one
attempt per watch. Unknown weather, a closed window, departure, or stale
evidence stays quiet. Pause or clear the watch to stop future forecasts
and invalidate the exact review link; rearming requires new consent.
Expired watches discard the coarse grid on the next worker sweep. Clear
does not touch source telemetry or remove the verified browser.

Use `TestWindowRainPrivateDeliveryAndLateParkEvidence`,
`TestWindowRainSuppressionAndRevocation`, and `TestWindowRainBrowserJourney`
with disposable PostgreSQL and a local Open-Meteo wire fixture. Live
verification was not run. Migration `000312` clears active watches that
lack a Park anchor; arm a new watch to restore monitoring. Stop the
window-rain API and worker for this migration. On application rollback
leave the migration applied and keep this watch unavailable until the
application supports anchors again.

### Optional private parked door and trunk reminders

Select your vehicle in **Security & access → Private parked door and trunk
reminders**. Verify this browser under **Personal delivery**, choose a wait of
5, 10, 15, or 20 minutes, and explicitly enable. This setting is off by default
and does not turn on the window rain watch.

The worker checks only the first 30 minutes after a recorded drive ends. It
needs repeated, timestamped Fleet Telemetry for `DoorState`, `Gear`,
`ServiceMode`, and `DriverSeatOccupied`, with less than two minutes between
confirming observations. Enable those fields in your existing Fleet Telemetry
configuration. Tesla generally publishes on change; when supported, the
[Fleet Telemetry `include_fields` option](https://developer.tesla.com/docs/fleet-api/fleet-telemetry)
can include all four alongside an already subscribed field that changes while
parked (for example `InsideTemp`). This is not a periodic heartbeat, and some
parks will lack enough evidence. TeslaSync does not change the telemetry config,
poll Tesla or wake the vehicle to compensate. There is no separate provider
account or charge for the analysis.

Service mode, an occupied driver seat, movement, a changed closure, or missing
or stale evidence suppresses the reminder or restarts the wait. Loading that
doesn't affect the observed signals can't be inferred; use **Snooze 15 minutes
for loading** to silence checks and restart the grace period afterward.

The browser push service receives only a kind and opaque token, subject to
quiet hours and a shared delivery budget. There is at most one attempt per
person, vehicle and park. A signed-in browser must claim the token before it
can display a generic notice. Open it for the specific closure, observation
times and expiry. If safe, check in person; this is not a live safety check
and offers no remote close or lock command. Pause clears current evidence and
stops future checks. Turning off and clearing removes derived settings, not
raw telemetry or the browser enrollment; expired delivery deduplication
records are swept after 24 hours.

Use `TestParkedClosurePrivateLifecycle`, `TestParkedClosureSuppression`, and
`TestParkedClosureBrowserJourney` with disposable PostgreSQL and synthetic
telemetry and push. Leave migration `000289` applied when rolling back the app.
Rolling the migration down removes only this feature's private settings,
evidence and delivery claims.

### Optional private parked unlock reminders

Select your vehicle in **Security & access → Private parked unlock reminders**.
Choose one enabled, reviewed saved place, verify this browser under **Personal
delivery**, and confirm. This reminder is off by default. Editing, disabling
or removing the saved place invalidates its old consent and pending reminders.

The worker checks the first 30 minutes after a recorded drive ends. It needs
repeated source-timestamped `Gear`, `Locked`, and `Location` reports from the
same sample for at least five minutes, with less than two minutes between
confirming observations. The location must be within the chosen place, not on
its boundary. Relocking, movement, a different place, or missing and stale
reports suppress the alert. Tesla normally emits changes rather than a
heartbeat; use the existing [Fleet Telemetry `include_fields` option](https://developer.tesla.com/docs/fleet-api/fleet-telemetry)
on supported vehicles if a subscribed source changes while parked. TeslaSync
never changes telemetry subscriptions, polls Tesla, or wakes or locks a car.

Location and observations stay on the server. The push service receives only
a kind and opaque token, and the signed-in browser must claim it. Quiet hours,
the shared personal budget and a one-attempt limit per person, vehicle and
park apply. The private review explains the last evidence and when it
expires. An unlock observation is not evidence of theft. If safe, check the
vehicle in person. Snooze suspends checks for 15 minutes and resets the grace
period. Pausing or turning off invalidates pending evidence; clearing keeps
source telemetry and browser enrollment in place.

Use `TestParkedUnlockPrivateLifecycle`, `TestParkedUnlockSuppression`, and
`TestParkedUnlockBrowserJourney` with disposable PostgreSQL and synthetic
telemetry and push. Leave migration `000290` applied for app rollback. A
migration rollback removes only the private plan and delivery records.

### Optional private Dashcam clip retention

Open **Dashcam & Sentry**, import a clip for the selected vehicle from disk,
and select that clip. Under **Private clip retention**, enter a deadline
you know from the source recorder or your own retention policy and confirm
it. The form uses the browser time zone. Tesla describes local recording
and overwrite in its [Dashcam manual](https://www.tesla.com/ownersmanual/modely/en_us/GUID-3BCC07CE-5EA2-4F40-99D1-27690898FF3C.html)
but does not publish an exact deadline for an arbitrary recording. Sentry
being enabled, a filename, and a candidate event never create a reminder.

The private card appears in Dashcam in the final 24 hours, for the confirmed
account and vehicle in that browser only. Pause, snooze or clear it without
changing the source clip. Before the deadline, use **Download original
clip** to copy the existing unredacted video to this device. Use **I saved
a copy** only once you have checked it. This does not prevent overwrites on
the recorder. TeslaSync sends no video, reminder metadata or push and cannot
operate when the browser is closed. Sign out of shared browser profiles:
app-level account scoping does not protect the pre-existing clip catalog
from people who can access that browser's local storage.

The IndexedDB upgrade preserves existing clips and settings; close older
Dashcam tabs if the update is blocked. Deleting a local clip also removes
its reminders; clearing only a reminder leaves the clip untouched. To
roll back to a build without this local schema, first export any clips
you want to keep. Avoid clearing the browser's site data as a routine
rollback; it deletes the clip catalog.

### Optional private software update window

Select the vehicle and open **Software updates → Private software update
window**. While parked, check the exact downloaded update and whether an
installation is scheduled or already running in **Controls → Software**.
Record the update version, a known installation estimate, and the next
departure. If you cannot verify those details, leave the review off.

TeslaSync checks local, source-timestamped Park, driver-seat, service-mode
and disconnected-charge observations against the latest vehicle state and
a recent completed drive. It needs a minute of corroborated idle time and
adds 30 minutes to the recorded estimate. The check is valid for at most
five minutes and ends earlier if the evidence expires or the buffer no
longer fits. A contradictory install or schedule signal suppresses the
card. Missing Tesla schedule telemetry is not proof of no schedule; this
is why the setup requires an explicit in-vehicle check. Install times
vary and can prevent driving and interrupt charging; see Tesla's
[Software Updates manual](https://www.tesla.com/ownersmanual/modely/en_us/GUID-A5A60CB3-7659-4B08-B2FD-AFD12C2D6EE1.html).
Recheck the vehicle before deciding. Opening or reading the card never
contacts Tesla, wakes the car, schedules or starts anything.

The card is off by default, visible only to the signed-in person who
enabled it for that vehicle, and never sent as a notification. Use
**Pause review**, **Snooze 2 minutes**, or **Turn off and clear**. After
an outage, refresh and verify the current details yourself. Rolling back
the app with migration `000291` left in place preserves the private plan;
rolling back the migration removes only those plans, not vehicle history.

### Optional private cabin prep reminder

Select a vehicle and open **Preconditioning effectiveness → Private cabin prep
reminder**. Verify the current browser in **Personal delivery**, then confirm
one local morning departure and a comfort target. The reminder is off by
default and does not repeat.

TeslaSync estimates a range from at least three comparable, completed local
mornings with observed start and temperature transitions. The reminder stays
silent when conditions are missing, stale or changed, the cabin is already
comfortable or preparing, or the vehicle has departed. The private push
respects quiet hours, the device budget, and the estimated window; it is
never replayed as a digest. Open it to see the estimate, supporting evidence,
and climate controls for the same vehicle. It never wakes the vehicle, starts
climate, or changes the temperature setting on its own.

**Turn off and clear reminder** cancels the plan and invalidates unclaimed
pushes. Unlinking the browser also invalidates its plan. Migration `000283`
can stay applied on application rollback; rolling it down deletes cabin plans
and their delivery records.

### Optional private scheduled climate review

On **Preconditioning effectiveness**, open **Private scheduled climate review**.
Choose an enabled automation scoped to the selected vehicle with one schedule
and one Start climate action, then explicitly enable the review. The feature is
off by default. It neither creates nor edits automations.

After you opt in, TeslaSync can compare three or more of that schedule's
accepted climate actions at the same local weekday and time. A run counts only
when telemetry shows climate starting nearby in time, parked-state and
odometer evidence persist, and no drive overlaps the 90-minute window. Missing
telemetry and manual, failed, or unattributed outcomes do not count. A private
Action Center card shows the evidence once per week; there is no push, vehicle
wake, or external provider call. The card links to a read-only review and the
existing automation run history.

If the automation changes, the review pauses until you confirm the new
version. **Turn off and clear review** removes the consent, receipts and
recommendation data but does not touch the schedule, drive history, or
automation runs. Migration `000284` is additive and can stay applied on
application rollback. Its down migration removes only private review data.

### Optional maintenance check before a trip

With verified sign-in, open a saved trip in **Charging readiness → Your
charging plans → Maintenance before this trip**. Enter the completed service
date, odometer at that service, its documented distance interval, and a
lower and upper estimate for the total trip distance. Confirm the private
check; it is off by default. Use your actual service records rather than a
generic service interval.

The worker checks the selected vehicle's recent completed-drive odometer.
One private Action Center card is available when even the lower trip
estimate crosses the interval, departure is at least two hours and at most
14 days away, and the vehicle is not already due. If the odometer is
missing, stale, or contradictory, or the crossing is uncertain, it stays
silent. The card links to **Maintenance** for that vehicle. It does not
assess vehicle condition, book service, or send a push or provider request.

Pausing or snoozing the plan suppresses the card. Editing the plan requires
reviewing the inputs again. Turning off the check removes its inputs and
projection, not the charging plan or drive history. Local operators can test
this with `TestTripMaintenancePublishesPrivateRecordedCrossing` and a
disposable PostgreSQL database. Migration `000279` can stay applied on
application rollback; stop the worker before explicitly rolling it down.
The down migration removes only private trip maintenance checks.

### Optional warranty mileage reminder

In **Warranty command**, record the actual distance and calendar terms from
your documents for the selected vehicle. Enter its documented starting
odometer; leave it blank if unknown and confirm a recorded zero separately.
Unknown starting readings cannot qualify for a projection. The overview keeps
the recorded calendar date visible without claiming a distance-limited policy
is active or showing a claim countdown when either odometer reading is
unavailable. Under **Private warranty mileage
reminder**, select that record and explicitly enable the check. It requires a
verified sign-in; a shared installation without sign-in cannot enable it.

The notification worker checks eligible records about once a day using dated
odometer readings from completed drives. The estimate needs at least eight
observation days over at least four weeks, with no long gaps, no odometer
reversal, and a reading from the last seven days. It shows a range, not a
guaranteed expiry date. If the range is not clearly earlier than the calendar
term, evidence is stale, or the recorded limit has already passed, it stays
silent. When the entire estimated range is within 21 days, at most one private
Action Center reminder appears for that warranty. Dismissing it does not
reopen it on a worker restart or daily refresh. Review the original terms and
current odometer before contacting the warranty provider.

The worker counts eligible checks and bounded suppression reasons separately
from first publication to the private inbox. Publication does not mean the user
saw the reminder. Only a saved acknowledgment or dismissal counts as a user
response; opening the card or warranty link does not count. These metrics have
no identity, warranty, or vehicle labels.

Nothing is sent to a provider, fleet channel, or vehicle. Turning the reminder
off removes its projection and future checks without touching warranties,
claims, or drives. Migration `000278` can stay applied on application rollback.
Stop the reminder worker before explicitly rolling it down; down deletes only
reminder consent and estimates.

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

On a current **Compare routes** decision, a signed-in operator with a Tesla
command connection can choose **Send [routine] to [vehicle]**, confirm the
address, and check the connection. Checking traffic, opening the comparison,
or opening the confirmation does not contact Tesla. The comparison shows
HERE's [road names or numbers](https://docs.here.com/routing/docs/routing-v8-get-alternative-routes)
when returned, not an address or exact turn-by-turn route. TeslaSync verifies
that the vehicle is still parked near the origin before checking Tesla's
connection state. A recorded drive that overlaps the occurrence's check window
expires the comparison, including when a resumed leg is merged into a drive
that started before the window. Parking near the origin again does not restore it.
The connector uses the existing `navigation_request` address-share
format. Keep the on-demand **Fleet API** connectivity and navigation-command
endpoints enabled to offer the action; the wake switch still controls whether
TeslaSync can wake a sleeping vehicle. Tesla receives the
entered address for that vehicle, not HERE's suggested route, and calculates
its own route. If Tesla reports the vehicle asleep, a separate **Wake and
send** confirmation is required. Even when Tesla reports online,
**Allow wake and send** is required because the REST command has no documented
no-wake guarantee if the connection changes. An online result does not itself
trigger a wake request. TeslaSync sends at most one wake and one destination
request and checks eligibility again after Fleet API budget admission, including
rechecking consent after live-state lookup. Revoking consent prevents later
sends; it cannot recall a request already in flight.

An accepted reply does not verify the route on the car. A timeout or unclear
acknowledgement never triggers replay. The latest attempt fence and outcome
survive restarts; the address and provider messages are not retained in
command or API logs. No live vehicle verification is performed by the
synthetic test suite. See Tesla's
[connection and timeout guidance](https://developer.tesla.com/docs/fleet-api/getting-started/best-practices)
and the [official command proxy](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/proxy/command.go#L545)
for the REST-only navigation transport. Keep migration `000305` applied
on application rollback to retain attempt fences; rolling back `000306`
removes the short route labels without removing routines or attempt fences.

For Smart Commute suggestion outcomes, `teslasync_smart_commute_suggestion_resolutions_total`
counts saved confirmations and **Not mine** dismissals. Browsing a suggestion,
creating a manual routine, editing a confirmed routine, and retrying an
already saved dismissal do not count. The only label is the outcome; the
counter does not contain trip details or indicate time saved.
`teslasync_smart_commute_navigation_outcomes_total` counts fenced attempts by
outcome; repeated confirmations of the same occurrence do not increment it.

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
| Trip charging-stop detour | [HERE route summaries](https://docs.here.com/routing/docs/routing-v8-route-summary) include road length and base duration independent of live traffic. | Opt-in, on-demand private planning card. One direct route plus one via request per qualified reviewed stop; no station feed or live stall availability. |
| Timely rain forecast | [Open-Meteo's forecast API](https://open-meteo.com/en/docs) accepts coordinates and lists hourly precipitation probability, rain and showers. Review its terms for the installation's use. | A separately consented coarse-point read for the private one-park window rain watch. The forecast alone cannot establish outdoor parking or an open window. Wire contract tested against a local provider fixture; live verification was not run. |
| Calendar deadlines | [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) distinguish availability-only access, read-only event access, and event edits. An availability window does not give a trip's deadline or destination. | Enter a confirmed arrival deadline, service window or software install window manually. No calendar connector or calendar writes. |
| Tariffs, station status and fees | [OpenEI's U.S. Utility Rate Database](https://apps.openei.org/services/doc/rest/util_rates/?version=7) publishes rate structures and effective dates. [HERE EV Charge Points](https://docs.here.com/ev-products/reference/here-ev-charge-points-api-v3) documents provider-dependent connector status and tariffs. [Tesla congestion fees](https://www.tesla.com/support/charging/supercharger/fees) depend on conditions such as site occupancy. [Electrify America](https://www.electrifyamerica.com/pricing/) directs drivers to the app or charger for current site pricing and fees. | Use configured tariffs and separately reviewed, unconditional fee terms. No provider tariff import, live stall claim, or occupancy-dependent fee prediction. The traffic license does not establish access to a station feed. |
| Household energy and backup | [Tesla energy endpoints](https://developer.tesla.com/docs/fleet-api/endpoints/energy) document site status and reserve. [Tesla OAuth scopes](https://developer.tesla.com/docs/fleet-api/authentication/overview) separate energy data reads (`energy_device_data`) from settings changes (`energy_cmds`). | Optional solar export advice uses a separate read-only grant. It does not infer that an EV caused backup draw during an outage, establish vehicle-to-home support, or change energy settings. Live Tesla verification has not been run. |
| Recall applicability | [NHTSA's public API](https://www.nhtsa.gov/nhtsa-datasets-and-apis) returns recalls by model year, make and model. [Tesla's manual VIN lookup](https://service.tesla.com/en-US/vin-recall-search) checks for open recalls for a particular vehicle. | An opt-in U.S. model/year watch posts a private verification card, not an open-VIN claim or urgent push. The public catalog request was tested against a local provider fixture; live verification was not run. |
| Spotify matching and private playlist save | [Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track), [Create Playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist), [Add Items to Playlist](https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist), [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow). | The private review matches explicitly selected references to locally observed identity and duration. Save requires `playlist-modify-private` and separate confirmation. Loopback wire fixtures, not a live account. |
| Spotify library save | [Save Items to Library](https://developer.spotify.com/documentation/web-api/reference/save-library-items) uses `user-library-modify`, separate from the playlist grant. | A confirmed match may save one exact Spotify track from Drive Detail. The adapter sends one URI and requires the documented empty `200` response. No live verification. |
| Spotify playback | The [iFrame API](https://developer.spotify.com/documentation/embeds/references/iframe-api) can load an exact episode and start offset in a browser player. | Separate explicit load, then Play in the player. A catalog link or player readiness does not confirm playback. |
| Spotify episode progress | [Get Episode](https://developer.spotify.com/documentation/web-api/reference/get-an-episode) provides a resume point only with `user-read-playback-position`. | Read only the explicitly selected episode. An absent, partial, or invalid resume point is unknown; no playback permission. |
| YouTube Music matching, save and playback | [YouTube Data API playlists](https://developers.google.com/youtube/data/guides/implementation/playlists) manage YouTube video playlists with authorization. That is not a documented YouTube Music catalog, listening-history or playback-control contract. | No YouTube Music connector. Do not use personal browser credentials, private endpoints or video playlists as a substitute for one. |

### Private drive playlist

Open **Media player → Review drive playlist** for the selected vehicle. The
feature starts off. Confirm when you plan to leave and the estimated drive
length. The preview uses at most seven days of local playback with attributable
title, artist, source, reported duration, and real progress. An unobserved
title, radio play, seek, or repeated telemetry tick is not a suitable match.
The history is vehicle-scoped, not proof of who listened. It stays local.

The initial selection fits within 10% or two minutes of the drive estimate,
whichever is larger. Remove, reorder, or add qualified tracks. A Spotify
connection is optional; the local preview works without it. To save, connect
your Spotify account, paste the exact Spotify track links, enter a playlist
name without personal details, and confirm the private save. Spotify receives
only the selected track IDs and playlist name, not your vehicle, schedule, or
history. Save never starts playback. If Spotify confirms only creation or the
outcome is unknown, check your Spotify library before making another playlist.
TeslaSync never retries either provider write.

An operator can configure `SMART_MEDIA_SPOTIFY_CLIENT_ID` and
`SMART_MEDIA_SPOTIFY_REDIRECT_URI` (`spotifyPlaylists` in Helm), with the
existing `ENCRYPTION_KEY`. Register an exact same-origin HTTPS URI ending in
`/api/v1/media/spotify/callback` and require verified sign-in there. Exclude
that callback's query from any additional reverse-proxy access logs. The
connector uses a public client ID, not a client secret; it discards refresh
tokens and never refreshes an expired grant. Review Spotify's [development
mode limits](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
for account and app restrictions; TeslaSync does not enroll anyone or buy access.

Pause or snooze the current review, or **Turn off and clear preview** to erase
local evidence and its save outcome without touching source data. **Disconnect
Spotify** removes pending authorization and the encrypted grant from TeslaSync;
remove app access in Spotify to revoke the upstream authorization too. Neither
action deletes an existing Spotify playlist. Clear the deployment settings to
disable provider access installation-wide. Leave migration `000292` applied
for an application rollback; rolling it down explicitly deletes only private
local drafts, candidates, and grants. Synthetic acceptance is
`TestPrivatePlaylistBrowserJourney` with a disposable database, an isolated
production bundle, and a loopback Spotify fixture. No live verification ran.

### Private journey soundtrack

Open **Journeys**, choose the vehicle and one completed journey, then open
**Journey soundtrack**. Reviews start off. Confirm the displayed time window
to read recorded playback on completed drives inside it. The list preserves
observed order, including qualifying repeat plays, and reports how many
matched drives had evidence. Radio, parked gaps, unknown identities and
playback without real progress do not produce tracks. The card does not
identify listeners or fill gaps with suggested songs.

The review is local and scoped to the signed-in person, vehicle and exact
journey interval. Only journeys completed in the past 30 days and lasting at
most 24 hours qualify. Consent lasts at most seven days. Pause, snooze for a
day, or turn off and clear the review without changing the source history.
Clearing or expiring a review prevents it from reading playback again under
that consent. No external connector or notification setup is needed.
Leave migration `000293` applied for application rollback; rolling it down
deletes only review preferences. Use `TestJourneySoundtrackMountedLifecycle`
and `TestJourneySoundtrackBrowserJourney` with a disposable database and
synthetic playback.

### Private exact-time track lookup

Open a completed drive and choose **What was playing?** Select seconds from
the start as shown on the card, then choose **Look up this time**. This uses
elapsed time rather than ambiguous wall-clock time at a DST change. The
review starts off. It needs two nearby, source-attested observations with
consistent playback progress around that instant. An unknown recording,
overlapping drive, radio, seek or uncovered instant produces no track. It
does not guess by picking the nearest record or identify who was listening.
New Fleet Telemetry subscriptions request playback progress every 20 seconds
to support the 30-second evidence limit. Sparse data from earlier
subscriptions remains unknown; lookup does not refresh or wake the vehicle.

The local review expires after 30 minutes. For Spotify recordings with known
duration, grant the separate **Authorize Spotify library** permission, paste
the exact Spotify track link and confirm the save. The same operator client
ID and callback configuration as playlist review is used, but the OAuth
attempt and short-lived grant belong only to that subject and lookup. Spotify
receives only the selected track ID and authorization. The app verifies the
title, artist and reported duration before a single save attempt. It never
starts playback or sends a notification. If the result is unknown, check your
Spotify library before trying again.

Disconnect removes the local grant; turning off and clearing also removes the
lookup and outcome. Neither removes a track from Spotify or deletes drive or
playback history. To revoke upstream access, remove the app in Spotify.
Disable the connector installation-wide by clearing its settings. Keep
migration `000294` applied for application rollback; rolling it down deletes
only private lookup records. Use `TestDriveTrackMountedLifecycle` and
`TestDriveTrackBrowserJourney` with a disposable database, synthetic
observations and a loopback Spotify fixture.

### Private pre-drive episode fit

Open **Media player → Episode for your next drive** for the selected vehicle.
Confirm your departure estimate and expected drive length. Enter known
duration and progress yourself, or authorize one read of a specific episode
URL. Leaving manual progress blank means unknown; only enter zero when you
know it is unplayed. Completed episodes and missing progress do not produce
a fit. Remaining time is conservatively rounded from Spotify's source units
and compared with the estimated drive time, not measured travel time.

The Spotify read uses the same configured client and callback but requests
only `user-read-playback-position`. The read sends only the chosen episode ID
and authorization, never departure details. No grant is retained for reuse.
The review expires at departure or after two hours, whichever comes first.
Opening the episode in Spotify is still just a catalog link. When a Spotify
episode fits and its cursor is known, **Load Spotify player at saved position**
shares only the episode and cursor with an isolated Spotify embed. You then
choose Play in that player. TeslaSync reports playback near the saved point
only when Spotify reports the same episode playing and its first observed
cursor is near the saved one; neither loading the player nor its ready event
counts. Browser, account or region restrictions can still prevent playback.
Close the player to unload it. Clearing removes the private snapshot and
pending authorization, not listening history. Leave migration `000295`
applied for an application rollback.

Monitor `teslasync_smart_episode_review_outcomes_total` for the fit and
suppression states returned by reads and explicit confirmation/clear
actions. These counts do not measure unique listeners, delivery, or plays.

### Private weekly favorites shortlist

Open **Media player → Weekly favorites shortlist** and confirm the vehicle,
time zone, and local history review. The existing notification worker checks
the previous local Monday–Sunday at the next Monday 09:00 release. The
shortlist contains at most five recordings with a plausible playback
progression on at least three distinct completed drives across two dates.
Repeated ticks, radio, and parked playback do not qualify. The evidence
cannot identify a listener, a selection by the driver, or a skip.

Review the evidence, then confirm a recording if it is one of your
favorites. This stores a local choice only; no provider connection, push,
or library write occurs. Dismiss this week's suggestions or pause the
checks without losing saved choices. Turn off and delete to remove the
plan, shortlist, and local favorites without changing source history.
Leave migration `000296` applied for application rollback.

### Private charging statement check

On **Charging invoice reconciliation → Import statement**, select the correct
vehicle and enter the printed total, charge lines, and separate energy, idle,
tax, and other fees. **Enable private statement check for this import** is off
by default and requires verified sign-in. Set a material difference in the
statement's currency. Mark the statement complete only if you entered every
line and no adjustments or credits are missing. Statement days and receipt
times use the browser's local time zone; the end date excludes that day.
Leave each unknown charge blank and enter zero only when documented. The
line-total check requires every component, including other fees. Older
imports without recorded component coverage cannot support that comparison.

To compare meter readings or rates, use the same site name recorded in Charging
and the session start from the receipt. TeslaSync requires one completed
start within two minutes and no competing start within five minutes. It does
not use the vehicle's estimated battery-state change as a meter reading.
Enter an independent reading at the station or battery boundary. Comparing
different boundaries also requires a documented loss bound; the energy gap
must exceed the larger of 500 Wh or 5% after that allowance. For price, use
an independently documented flat energy rate applicable to the session at
the billed boundary, not a rate derived from the disputed amount. Tiered
rates, unknown losses, and missing breakdowns do not get a substitute.

The private report shows material differences separately, not an accusation
or a recovery estimate. Review original receipts and terms before recording
a local dispute. It requires the current report's comparison digest and
revision; changed evidence or a second confirmation cannot create another
private claim. Opening the report makes no external calls or push.

Use **Edit statement check** to correct optional readings, rates, fee
evidence, or the threshold without changing the provider's billing lines.
**Turn off and clear statement check** removes the optional comparison inputs
and stops comparisons but keeps the original invoice, charges, and local
dispute history. Deleting the invoice is a separate action. Test with
`TestInvoiceVarianceMountedPrivateReport`,
`TestInvoiceVarianceEditsAndClearsReviewWithoutTouchingStatement`, and
`TestInvoiceVarianceSuppressesEstimatesUnknownLossAndAmbiguousMatch`, and
`TestInvoiceVarianceDistinguishesUnrecordedChargesFromZero` on
disposable PostgreSQL. Keep migrations `000297` and `000304` and a reader
that honors the clear marker to preserve opt-out on application rollback.

### Private monthly charging-cost comparison

On **Lifetime operating cost → Monthly charging cost change**, select the
vehicle and confirm local review, the billing currency, the time zone, and
the smallest cost change worth showing. Nothing is checked until you opt
in. The existing notification worker compares the last two completed local
months from 09:00 on the second day of the month, even if the browser is
closed. No provider request, push, vehicle wake, or charge change occurs.

The comparison requires qualified recorded distance, at least four
comparable billed sessions in each month, at least two visits per matched
reviewed charging site in each month, and coverage of at least 75% of both
the observed sessions and known spend in each month. It uses locally stored,
uniquely matched, energy-priced charging receipts or independently entered, fully itemized
station-boundary lines for the same subject and vehicle. Missing or competing
receipts, trips without corroborating distance, unreviewed sites, mixed
currencies, and excluded fees can limit coverage. It does not exchange
currencies or estimate missing bills or billed energy from battery charge.
Tesla charging fees exclude separate parking or idle fee records. A receipt
priced by time can contribute known spend but not comparable billed energy.

The digest describes the review-time snapshot. It separates changes in
recorded distance, billed energy per recorded distance, charging-site mix,
and effective billed price. Effective price can include billed fees and
does not establish a tariff change. Billed energy per recorded distance is
not vehicle efficiency, and the breakdown does not prove cause. Unmatched
known spend and rounding remain unattributed; unknown spend is not part of
the comparison. Review the underlying charging sessions before acting.

Dismiss to hide this comparison, pause to stop checks and remove the current
comparison, or turn off and clear to remove the plan and derived evidence.
None changes the driving records or original bills. Run
`TestChargingCostDigestPublishesPrivateCompletedMonths` and
`TestChargingCostDigestSuppressesAmbiguousBillingAndRevokedLease` on disposable
PostgreSQL to verify publication, isolation and silence. The
`TestChargingCostDigestBrowserJourney` fixture also checks the built UI with
the page closed at release. Leave migration `000298` applied on rollback;
its explicit down removes only the review tables. Monitor
`teslasync_smart_charging_cost_digest_outcomes_total` for coverage suppression,
in-app publications, and explicit review actions, not notification delivery
or money saved.

### Private monthly tariff replay

On **Utility tariff arbitrage lab → Monthly tariff review**, select the
vehicle in the workspace header. Choose one reviewed charging place, one
current tariff and one alternative saved tariff in the same currency.
Only flat and time-of-use plans with no tier, demand, export or real-time
pricing qualify. Confirm that both terms apply at this place without
rescheduling and include the charges being compared. Enter the place's
time zone, the one-time switch fee (zero only if none), and the smallest
net saving worth showing. The existing worker checks from 09:00 on the
second local day of each month, with the browser closed.

Use **Charging invoice reconciliation** to record itemized energy-only
bills under the same sign-in and vehicle. Each observed charging session
at the place must be complete and matched uniquely to a station-boundary
bill with an explicit zero for extra fees. The complete statement total
must agree with its itemized lines; an unallocated discount or adjustment
cannot be priced as energy. Unassigned charging stops,
competing matches, mixed currencies, taxes or extra fees not represented
in the model, and a current rate that does not explain the recorded
energy price suppress the comparison. At least four qualifying sessions
are required. The review does not use a battery-state estimate in place
of a bill.

The worker prices the recorded charging times as-is. It uses actual local
calendar days for standing charges and deducts the one-time fee from
potential savings. If a charge crosses bands, the card shows bounds
rather than assuming when the energy flowed within the session. It stays
quiet unless the lower saving bound meets the selected threshold. This
is a charging-only estimate, not a whole-home bill or a future readiness
prediction. TeslaSync does not move charging, change tariffs, wake the
vehicle, contact the provider, or send a push.

Review the underlying bills and terms before making a decision. A
changed place or saved tariff version hides the comparison until you
review the setup again. Dismiss this month's result, pause checks, or
clear the consent and comparison; none removes bills or tariffs. Test
locally with `TestMonthlyTariffReviewPublishesPrivateReplay`,
`TestMonthlyTariffReviewSuppressesUnqualifiedEvidence`, and
`TestMonthlyTariffReviewRejectsRevokedLease` on disposable PostgreSQL.
Leave migration `000299` applied on rollback; its explicit down removes
only the review tables. Monitor `teslasync_smart_monthly_tariff_review_outcomes_total`
for silence reasons, private publications and explicit review actions,
not money saved.

### Private monthly mileage review

On **Mileage budget → Monthly mileage review**, select the correct vehicle
and enter the actual total-distance allowance, the first day and first
excluded day, the term's time zone, the recorded opening odometer, and
the smallest projected overage worth showing. The existing browser-local
mileage planner does not enroll anyone, and its default allowance is not
used by the worker.

The worker checks after 09:00 on the second local day of a month. It
needs recent, consistent odometer readings emitted during completed drives
on at least eight local dates spanning four weeks before the month boundary.
A drive inheriting an older odometer reading adds no observation.
It compares a conservative range from term-to-date and recent pace
against the total allowance. An uncertain or small overage stays quiet.
This models all vehicle distance, not reimbursable trips, penalty charges,
or a guarantee. A per-trip reimbursement program needs its own records.

Review the entered terms or the recent drives before changing plans.
Dismiss one estimate, pause checks, or clear the private terms and
derived result without deleting drives or browser-local settings. No
vehicle wake, external service, or push is involved. Exercise the
local journey with `TestMileageTermReviewPublishesPrivateActualTerm`
and `TestMileageTermReviewSuppressesUnqualifiedEvidenceAndRevokedLease`
against disposable PostgreSQL. Leave migration `000300` applied for an
application rollback; applying its down script removes only private
allowance terms and estimates. The bounded counter
`teslasync_smart_mileage_term_review_outcomes_total` counts qualified,
suppressed, published and explicitly managed results, not penalties
avoided.

### Private monthly trip packet

On **Trip Logbook → Private monthly trip packet**, select the vehicle, sign
in, and confirm the packet's time zone and use of its completed drives.
This is off by default. Choose a completed drive and explicitly confirm
its purpose. For a business drive, manually associate any matching receipt
by its local date, reference, original currency and amount. Files are not
uploaded. Existing browser-local classifications and corridor suggestions
never establish business purpose for a packet.

At 09:00 on the second local day, the notification worker checks the
previous month using drive start times in the selected zone. The private
review shows the confirmed business drives, recorded distance, matched
receipt references and the unclassified trips that need review. Missing
distance is not estimated, duplicate receipt references are not counted,
and no tax or reimbursement eligibility is inferred. The card stays quiet
without confirmed business evidence.

Review the evidence and explicitly confirm the JSON download to keep a
local copy. The server rechecks the reviewed data before returning it.
No provider, employer or other recipient receives the packet. Dismiss
one month, pause without losing private tags and receipt references, or
clear them without removing original drives or browser-local settings.
Use `TestTripPacketPublishesOnlyConfirmedBusinessAndExportsCurrentEvidence`
and `TestTripPacketRejectsPausedLease` against disposable PostgreSQL.
Leave migration `000301` applied for an application rollback; its down
script removes only private packet data. The
`teslasync_smart_trip_packet_outcomes_total` counter reports decisions and
explicit review actions without identifying fields.

### Private subscription renewal review

On **Subscription & feature ROI → Private subscription renewal review**,
sign in, select your vehicle and an existing recurring subscription,
and confirm its actual next renewal date, time zone and how many days
in advance you want to review the saved price. Existing subscriptions
never enroll automatically. TeslaSync does not infer a renewal date from
the payment cadence, request billing data, or cancel or renew anything.

The worker publishes once from 09:00 on the chosen local lead day until
the renewal date starts. Your private Action Center card opens the exact
subscription review. The review shows stored price and billing period,
plus whichever observed activity you chose on the subscription record:
distance, drive count or charging-session count. The window ends at the
start of the lead day and looks back at most 30 local days, never before
the subscription start. It shows days with observations, not the
percentage of all activity captured. Missing history, unmeasured usage
and unsupported measures are not treated as zero. Observations do not
establish that the subscription caused the activity.

Dismiss a dated occurrence, pause preparation, or clear the private
schedule without changing the subscription or vehicle history. Confirm
a different future renewal date to schedule another check. There are no
provider or vehicle writes and no external push. Use
`TestSubscriptionRenewalPublishesOnceWithScopedUsageAndExpires` and
`TestSubscriptionRenewalRejectsChangedVersionAndRevokedLease` on disposable
PostgreSQL. Leave migration `000302` applied for application rollback.
Its down script removes renewal settings and occurrence metadata only.

### Shared household charger and trip planning

In **Settings → Smart Charging**, verified browsers can review their own
invitations. Set `TESLASYNC_SMART_OPERATOR_SUBJECTS` to the exact sign-in identities that
may authorize vehicles for a reviewed charger or an explicitly shared
departure. An operator can invite a participant, but cannot confirm on their
behalf. App tokens, open mode, and impersonation cannot join either plan.

- **Shared charger:** Select a reviewed charging place, nominate two active
  vehicles, then have each participant confirm the same revision, charging
  window, needed energy, conservative power, and plugged-in state. The card
  appears only when the vehicles compete and a feasible order remains. If the
  operator nominates a reminder recipient and that participant separately
  opts in, the worker can display one private in-app swap reminder. It never
  sends a command or broadcasts to the household.
- **Shared trip:** Nominate the vehicles for one departure. Each participant
  confirms a conservative trip energy range, reserve, vehicle availability,
  and maintenance clearance. Two eligible vehicles with fresh battery
  observations are required to compare; confirmed participants see only the
  eligible vehicle IDs and return ranges, not itineraries or service records.
  The comparison does not reserve a vehicle or change any schedule.

Use synthetic accounts and vehicles, not real travel data, to test these
flows locally. Withdraw a vehicle or cancel the plan to revoke access; a
revision requires fresh participant confirmations. Remove operators from
`TESLASYNC_SMART_OPERATOR_SUBJECTS` to stop new authorization, and cancel any existing
plans that should end. To roll back the features, restore the previous
application and worker before reverting migrations `000317` and `000316`;
the down migrations delete the corresponding private plan data.

### Repeated automation failures

Set `TESLASYNC_SMART_OPERATOR_SUBJECTS` in Compose, or
`config.smartOperatorSubjects` in Helm, to the comma-separated, exact
identities emitted by your trusted ForwardAuth proxy for operators.
An empty list disables this card. Open mode, impersonation, and app
tokens cannot receive it. The setting does not grant other admin rights
or change existing automation access.

Action Center shows one card per enabled rule after at least two
consecutive failed or partial outcomes in completion order in the last
24 hours. Only runs recorded for the rule's current revision count;
the original history is preserved without guessing revisions for past runs.
Retrying steps inside a single run does not increase the count. The card
links to the exact most recent execution, even outside the current
history date filter. It does not expose action payloads or error text on
the card, send a push, retry anything, or change the rule. A later
completed non-failure or a rule revision clears the streak.

### Upstream estimate interruptions

When an already-authorized HERE request reports an uncached service
unavailability response, TeslaSync pauses predictions that use that feed
until an eligible request verifies fresh, usable evidence. A sleeping
vehicle, missing credentials, a timeout, or missing traffic coverage is not
an outage. HERE routing, route import, and traffic flow are tracked
separately. Local recommendations that do not need the interrupted feed
continue. Nothing polls a vehicle or calls the provider solely to test health.

To receive the private notices, set `TESLASYNC_SMART_INCIDENT_SUBJECT`
in Compose or `config.smartIncidentSubject` in Helm to one exact
ForwardAuth subject already listed in `TESLASYNC_SMART_OPERATOR_SUBJECTS`
or `config.smartOperatorSubjects`. The same identity must be configured
for API and worker. If it is unset or no longer allowed, prediction safety
still applies but no notice is delivered. Open mode and app tokens do not
receive these notices. Action Center records one outage and one recovery
notice per incident, with no push or shared status notice.

Apply migration `000318` before starting the API and worker with this feature.
Leave the additive migration applied if rolling the binaries back; older
versions do not display the private notices or enforce the prediction fence.
If a known outage is still active, disable licensed HERE requests before
rolling back. Rolling down the migration explicitly removes the stored HERE
outage and recovery facts.

### Private weekly drive efficiency

On **Route Efficiency → Private weekly drive efficiency**, sign in, select
a vehicle and confirm local analysis and a time zone. Existing drive data
never enrolls on its own. The worker checks at 09:00 Monday in that zone
without an open browser. The previous complete local week is compared with
up to six earlier weeks. A missed first-day check is skipped.

The digest compares ordered recorded routes, not just common endpoints.
It requires measured pack power throughout each completed drive, outside
temperatures within 5 °C, mean trip speeds within 2 m/s, and drive distances
within 3% of one another. It needs at least four distinct baseline days
and at least two matching days in each part of the recent week. At most
96 completed-drive candidates are read; overfull or sparse evidence stays
quiet. It publishes only when the observed consumption ranges are
separated by at least 20% and 0.025 Wh/m in the same direction across
the entire week. It does not identify a cause, rank drivers, wake a car,
or send a push.

When the selected vehicle is confirmed parked, open the latest qualifying
drive in a local evidence view that does not request external map tiles.
Moving or stale vehicle state keeps the digest passive. You can still pause
future checks or clear the plan without deleting original drives or telemetry.
The
`teslasync_smart_weekly_drive_efficiency_outcomes_total` counter reports
coverage decisions and lifecycle changes without subject or vehicle labels.
Leave migration `000303` applied for application rollback. Its down
script removes only derived review evidence and consent.

### Private outbound charging-stop comparison

From Trip Planner, follow **Compare reviewed charging stops** for the selected
vehicle to its saved charging plans. A verified sign-in and an enabled future
plan are required. The plan's charging place is the origin. Choose a reviewed
destination and two compatible, separately reviewed charging places. Enter
your estimated usable pack capacity, expected departure charge, charging limit,
high-side consumption, and any queue waits you recorded at those locations.
Use explicit offsets in wait timestamps and each station's local time zone.
Record zero only when there was no wait; an unrecorded wait is not a sample.

The comparison requires at least eight similar recorded wait days and three
measured sessions in the same charging range for that vehicle at each stop.
It ranks reachable options by extra road time, historical median wait and
buffered charge time; it does not predict live availability or the return leg.
The comparator does not send push notifications or operate the car.

Use the existing API HERE key and license confirmation only if the reviewed
provider terms permit this routing use and short-lived derived results. Quotas
and charges depend on the HERE plan. Consent is separate from Smart Commute:
only an explicit **Check routes with HERE** sends approved place coordinates,
and only when local charging evidence qualifies. The provider does not receive
the vehicle ID, energy assumptions or queue records. A check uses at most
three route requests for two stops. Checks are limited to one every 15 minutes
per saved plan, even if its comparison setup is replaced or removed.
Ordinary reads never call the provider.
Edits, a changed or removed place, pausing and removing setup invalidate the
pending comparison. Before using an older setup whose full station membership
was not recorded, review and authorize it again. Disable the deployment's HERE
setup to stop new calls, or remove
one plan's consent and queue records via its comparison panel. An application
rollback can leave `000276` applied; its down migration removes comparison
setup and results, not source trip or charging records.
`teslasync_smart_trip_stop_events_total` counts checks, suppression reasons,
ready comparisons and disconnect requests without user, vehicle or place labels.

### Private plan-to-actual trip review

Before departure, create a planned Journey for the same vehicle. In its
Charging readiness plan, open **Review planned vs. actual trip**, choose
that journey and the reviewed locations, enter the planned arrival charge
and optionally one stop's total duration, then confirm the local review.
Start and complete the linked Journey to bound the actual records. Journeys
use the installation's existing vehicle access; the baseline, comparison
and saved allowance are private to the signed-in plan owner.

The review requires recorded drive endpoints at the matching places and
a vehicle battery observation in the final two minutes of the drive to the
destination. A drive summary alone is not proof of arrival charge. A planned stop additionally requires a
completed charging session between the matching drive legs. Dwell includes
charging and other stopped time; time outside charging is not a measured
queue. No results appear for incomplete, unmatched, overlapping, or expired
journeys. Older allowances without verified arrival evidence are not reused.
An adjustment requires at least five extra stop minutes or three percentage
points of arrival shortfall. Explicitly save it as a planning allowance for a
future trip to the same places; it never changes a plan, departure or vehicle.
If the recorded comparison changes before saving, refresh and review it
again. The adjustment can appear on a matching baseline for 30 days after
the original journey completed.

No external connection, delivery channel or vehicle command is used. Removing
the review deletes its baseline and allowance, not source drives, charging
sessions or journeys. Leave migration `000277` applied on application rollback;
its down migration removes only review baselines and adjustments.

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
