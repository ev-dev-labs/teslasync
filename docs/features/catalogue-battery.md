# Battery

Sidebar group **Battery**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Battery Health | `/battery` | Pack health: SoH, full-charge capacity, and degradation curve. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Battery Cells | `/battery-cells` | Per-cell voltage and temperature spread. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Battery Degradation | `/battery-degradation` | Capacity loss over time vs fleet average. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Projected Range | `/projected-range` | Range forecast adjusted for weather, terrain, and driving style. | Renders an empty state when no data is available — the page is not hidden. |
| Vampire Drain | `/vampire-drain` | Standby energy loss while parked and asleep. | Renders an empty state when no data is available — the page is not hidden. |
| Sleep Efficiency | `/sleep-efficiency` | How quickly the car drops into low-power sleep when parked. | Renders an empty state when no data is available — the page is not hidden. |
| Battery Passport | `/battery-passport` | Issue a verifiable battery health and provenance certificate. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Pack Capacity | `/pack-capacity` | Estimate usable pack capacity from charging and driving evidence. | Renders an empty state when no data is available — the page is not hidden. |
| Battery Cycle Stress | `/cycle-stress` | Measure depth-of-discharge and cycle stress on the battery. | Renders an empty state when no data is available — the page is not hidden. |
| Range Buffer | `/range-buffer` | Track reserve-range habits and low-state-of-charge exposure. | Renders an empty state when no data is available — the page is not hidden. |
| Battery Care | `/battery-care` | Turn battery behavior into practical longevity recommendations. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Charge Advisor | `/charge-advisor` | Recommend charging limits and timing for battery care. | Renders an empty state when no data is available — the page is not hidden. |

[← All groups](./catalogue.md)
