# Tesla Fleet API spend budget

TeslaSync enforces a conservative estimated-cost ceiling before each outbound
Fleet API or Vehicle Command Proxy call. The API server, automation worker, and
resubscribe tool reserve against the same PostgreSQL UTC-day row, so adding
processes or replicas does not multiply the configured allowance.

The shipped defaults are:

| Setting | Default | Purpose |
|---|---:|---|
| `TESLA_API_DAILY_BUDGET_USD` | `0.30` | Maximum estimated spend reserved during one UTC day |
| `TESLA_API_COMMAND_RESERVE_USD` | `0.05` | Capacity unavailable to background reads but available to wake-ups and commands |

`$0.30/day` has a worst-case application estimate of `$9.30` in a 31-day month,
below the current `$10/month` small-application credit. It does not include calls
made by other applications using the same Tesla developer account. Configure the
authoritative billing cap and alerts in the Tesla Developer Portal as the final
backstop.

## Estimated prices

TeslaSync currently reserves these estimates:

| Category | Estimate per call |
|---|---:|
| Vehicle data | `$0.002` |
| Wake up | `$0.020` |
| Vehicle command | `$0.001` |
| Vehicle specs | `$0.100` |
| Other Fleet API request | `$0.001` |

Tesla can change pricing. Review the official billing page before each
production release and update `ops/fleet-api-budget/policy.yaml` and the
classifier together. The System Budgets page shows estimated reservations, not
Tesla's final invoice.

Reservations are deliberately conservative: they happen before network I/O and
are not refunded for a timeout, circuit-breaker race, or HTTP 5xx. TeslaSync
therefore cannot spend more than its estimate because of an optimistic refund.
The database update is atomic and is configured to fail closed; if PostgreSQL cannot prove
remaining allowance, the outbound request is rejected instead of silently
running without a budget.

## Budget-aware polling

The default `$0.05` command reserve leaves `$0.25` for background activity,
equivalent to at most 125 vehicle-data calls if no other background endpoint is
used. In Fleet Telemetry primary mode, streaming vehicles do not consume those
calls. Vehicle discovery runs hourly, rather than every five minutes, so its
maximum estimate is `$0.024/day`.

For non-streaming vehicles, the adaptive poll engine divides the remaining
background-call equivalents across the configured fleet and the time remaining
before 00:00 UTC. It only stretches an interval; it never shortens an interval
chosen by activity or sleep detection. This preserves all-day fallback coverage
instead of spending the allowance during an early drive. At the shipped
one-vehicle default, fallback samples can be roughly 13 minutes apart once
hourly discovery is included. Use Fleet Telemetry for high-frequency driving
history; raising the cap is a deliberate billing decision, not a substitute for
telemetry.

If another process consumes the allowance first, the hard atomic ceiling still
wins. The poll engine records `budget_paused_until`, and
`teslasync_polling_budget_paused_vehicles` reports the number of affected
current-fleet vehicles without VIN labels. Fleet reconciliation removes
decommissioned vehicles from the gauge after consecutive absent inventory
reads, so one transient empty result cannot erase a valid pause. Polling resumes
after the UTC reset or an explicit vehicle-state reset.

`teslasync_polls_total{result="budget_unavailable"}` reports cycles where the
shared budget store could not prove allowance. Those outages are not counted as
cost savings in `teslasync_polls_saved_total`.

## Command reserve

Background reads can use at most the daily ceiling minus the command reserve.
Wake-ups and vehicle commands can then use the protected remainder. They still
cannot exceed the overall daily ceiling. This prevents polling and paid
vehicle-spec reads from consuming all same-day command capacity.

The budget resets at 00:00 UTC. Set `TESLA_API_DAILY_BUDGET_USD=0` only as an
explicit opt-out; TeslaSync logs that outbound spend is unbounded. A command
reserve larger than the daily limit is clamped to the daily limit, leaving no
background-read allowance.

## Operational response

When the guard rejects a call:

1. Inspect **Admin → System budgets** for daily and background allowance.
   Cost rows use an explicit **UTC day** window and **Resets in** countdown.
2. Confirm Fleet Telemetry is healthy so polling is not consuming the budget.
3. Review Tesla's billing dashboard and current prices.
4. Raise the daily limit only after documenting the expected vehicle count,
   polling fallback, and monthly maximum.

If PostgreSQL cannot provide spend evidence, the endpoint keeps the healthy
process-local throttle rows visible and adds a partial-evidence warning. Outbound
Fleet API calls return a service-unavailable error in that state, and polling
uses a one-minute retry delay rather than claiming the cap was consumed. Only an
actually exhausted allowance is reported as a budget/rate-limit rejection.

The existing client token bucket remains a process-local burst smoother. It is
not presented as Tesla's server-side quota and is not a substitute for the
shared spend guard.
