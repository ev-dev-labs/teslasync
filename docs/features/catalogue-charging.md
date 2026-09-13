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
