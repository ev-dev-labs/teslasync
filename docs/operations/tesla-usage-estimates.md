# Tesla Fleet usage estimate on /system-status

The [Tesla Developer home page](https://developer.tesla.com/) (checked 2026-09-22)
lists 150,000 streaming signals, 1,000 commands, 500 data requests and 50
wakes per US dollar. [Tesla Billing and Limits](https://developer.tesla.com/docs/fleet-api/billing-and-limits)
says requests with status <500 are billable, 5xx are not, bills are rounded
to cents, and actual Tesla billing cycles are **calendar months starting on the first**.
The local $10/month discount belongs to Tesla's invoice, not this estimate.

This dashboard intentionally shows **fixed, epoch-anchored UTC 30-day
windows**, *not* Tesla's invoice or calendar-month billing period. Estimates
sum category volumes / published bucket sizes, without assuming discounts,
invoice rounding, or what other applications on the same Tesla account used.
Only observed Fleet client callbacks (API server, automation worker, and
resubscribe tool) with a Tesla response (<500) for vehicle data, command,
or wake endpoints count; no inbound app HTTP, partner/auth/discovery calls,
or other outbound services count. Command-proxy callbacks are tagged
separately: only successful (2xx) command-proxy responses count; proxy-side
4xx may be a local rejection before reaching Tesla and are excluded.
Legacy audit rows with absolute non-Tesla command-proxy URLs receive the
same conservative treatment.
Attempts without a response are excluded. A successful proxy response is
still not invoice proof; this estimate must not be reconciled as an invoice.
Separate actual direct Fleet attempts (including retries with a Tesla 4xx
response) count separately, while a 5xx or an attempt without a response
does not.

Each successful per-field Fleet Telemetry MQTT delivery with a source timestamp
is counted once, before ACK; decoded compound child atomics and locally
republished MQTT topics are **not** billable signals. QoS1 redeliveries with
the same topic/source-time/payload fingerprint are ignored. This is a
best-effort local observation: broker losses, missing source timestamps, DB
write failures and exact same-payload/source-time distinct emissions may
undercount. MQTT ACK/disposition is never altered by usage-recording failure.
Historical data only extends back to available outbound audit logs and stream
observations; no retroactive signal counts are invented. The maintenance
worker retains outbound Tesla audit rows while pruning other API logs after
30 days; migration 000247 removes the 365-day Timescale API log retention
policy so prior cycles survive. Operators should monitor database growth and
compare against the Tesla Developer Portal invoice.

## Dedicated Tesla API usage page

`/system-status` keeps a short, current-cycle estimate and links to
`/tesla-api-usage`. The dedicated page shows the current and prior fixed
30-day cycles, selectable historical cost distribution and daily/weekly
time series, pricing evidence and limitations. History remains independently
available if the current-cycle query fails.

## Selected history

The system-status history picker supports a custom inclusive UTC civil-date
range or 7-, 30-, 90-day and one-year presets, with daily or Monday-anchored
weekly buckets. `GET /api/v1/system/api-usage/history` accepts RFC3339
`start` and exclusive `end`, `bucket=day|week`, and optional `limit` and
`offset`. Ranges are limited to 366 days per request; select a different
custom range to inspect older years. Each point and the selected-range total
are derived from the same billable evidence as the current-cycle estimate.
No points are generated for unobserved dates. Weekly buckets crossing the
selected range include **only events inside that range**, not the rest of the
calendar week. Category counts and USD contributions appear alongside the
stacked time-series chart and accessible data table.
