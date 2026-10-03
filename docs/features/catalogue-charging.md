# Charging

Sidebar group **Charging**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Charging Overview | `/charging` | All charging sessions — Supercharger, home, third-party. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Charge History | `/tesla-charging-history` | Tesla-provided charging history pulled from your account. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Charging Curve | `/charging-curve` | Power vs SOC curve for any charging session. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Charging Patterns | `/charging-heatmap` | When and where you charge, visualised as a heatmap. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Smart Charging | `/smart-charge` | Schedule charging for off-peak or solar-surplus windows. | Renders an empty state when no data is available — the page is not hidden. |
| Charger Health | `/charger-health` | Track charging-site performance, faults, and declining power. | Renders an empty state when no data is available — the page is not hidden. |
| Charge Interruption | `/charge-interruption` | Explain incomplete sessions and recurring charging interruptions. | Renders an empty state when no data is available — the page is not hidden. |
| Charger Resilience | `/charger-resilience` | Measure dependence on individual sites and charging alternatives. | Renders an empty state when no data is available — the page is not hidden. |
| Charge Alignment | `/charge-departure-alignment` | Check whether charging finishes before predicted departures. | Renders an empty state when no data is available — the page is not hidden. |
| Charging Thermal Tax | `/charging-thermal-tax` | Quantify battery-heating overhead during charging sessions. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Powershare | `/powershare` | Use your vehicle as a backup home battery (V2H). | Renders an empty state when no data is available — the page is not hidden. |
| Wait Oracle | `/tesla-charging-history` | Embedded panel: Supercharger wait forecast (Erlang-C on your site history). Not Tesla live occupancy. | Empty until Supercharger sessions exist for that site name. |

[← All groups](./catalogue.md)

## Charging history workspace

The overview uses the header's vehicle and View settings range. Desktop history
uses the shared evidence table with resizable, reorderable, and hideable columns;
mobile keeps date-grouped session cards. Column-header filters use the same
searchable value checklist as drive history, with known zero and unrecorded
values kept separate. They apply to all loaded candidates before pagination;
their URL state survives reloads and stays visible with a clear action on mobile.
Selection survives page changes, and
both layouts retain session details, quick inspection, CSV/JSON export, and
confirmed bulk deletion. Queue planning and all charging insights remain below
the history rather than obscuring it. The complete live-posture brief follows
the primary history, so readiness details do not push session evidence away.

The page loads at most 500 sessions for the selected range. Its overview, trends,
collections, search, and exports describe that loaded window, not an exhaustive
server-side history. Unknown costs are not classified as free; a recorded zero
cost is free. Unknown battery and power readings remain distinct from zero.
Average duration and delivery rate use sessions with usable elapsed time;
unfinished sessions cannot shorten duration or inflate rate. An unavailable
prior-period comparison does not imply that no previous charging occurred.
Daily power and cost trends omit unknown observations instead of inventing
zeroes, while retaining genuine zero readings. Blended cost pairs each recorded
cost with that session's energy; unpriced sessions cannot dilute the rate.
