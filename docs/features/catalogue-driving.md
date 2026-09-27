# Driving

Sidebar group **Driving**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Drives | `/drives` | Every drive with route, energy used, and efficiency. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Trips | `/trips` | Multi-leg trips grouped into a single journey. | Renders an empty state when no data is available — the page is not hidden. |
| Journeys | `/journeys` | Open Journeys. | Renders an empty state when no data is available — the page is not hidden. |
| Trip Planner | `/trip-planner` | Plan a route with charging stops and ETA before you leave. | Renders an empty state when no data is available — the page is not hidden. |
| Navigation | `/navigation` | Send a destination to the car or save it for later. | Renders an empty state when no data is available — the page is not hidden. |
| Geofences | `/geofences` | Trigger automations when the car enters or leaves a zone. | Renders an empty state when no data is available — the page is not hidden. |
| Mileage Log | `/mileage` | Odometer log with monthly and yearly totals. | Renders an empty state when no data is available — the page is not hidden. |
| Trip Logbook | `/logbook` | Review and annotate a searchable chronological trip log. | Renders an empty state when no data is available — the page is not hidden. |
| Mileage Budget | `/mileage-budget` | Track distance budgets and forecast when thresholds will be reached. | Renders an empty state when no data is available — the page is not hidden. |
| Driving Rhythm | `/driving-rhythm` | See recurring departure, duration, and travel-time patterns across complete driving history or a selected date range. Pages through every drive in the selected range rather than truncating at 1,000; a page-specific date range is not narrowed by the workspace-wide preference. | Renders an empty state when no data is available — the page is not hidden. |
| Speed Sweet Spot | `/speed-sweetspot` | Find the speed band where your vehicle is most efficient. | Renders an empty state when no data is available — the page is not hidden. |
| Efficiency Target | `/efficiency-target` | Set an efficiency goal and measure progress toward it. | Renders an empty state when no data is available — the page is not hidden. |
| Cold Start Cost | `/cold-start` | Quantify the energy and range cost of cold departures. | Renders an empty state when no data is available — the page is not hidden. |
| Drive Compare | `/drive-compare` | Compare two drives across route, speed, energy, and conditions. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Explorer | `/explorer` | Slice and inspect drive history with advanced filters. | Renders an empty state when no data is available — the page is not hidden. |
| Drive Calendar | `/drive-calendar` | Browse the rolling 52-week calendar or any recorded year using previous/next-year controls and a direct year jump. Loads every API page within the selected period so years with more than 1,000 drives remain complete. The selected year is shareable as `?year=YYYY`. | Shows a year-specific empty state when no drives were recorded in the selected period. |
| Milestones | `/milestones` | Celebrate distance, efficiency, and ownership achievements. | Renders an empty state when no data is available — the page is not hidden. |
| Lifetime Stats | `/lifetime-stats` | Every drive ever — distance, energy, and time totals. | Renders an empty state when no data is available — the page is not hidden. |
| Drive Score | `/drive-score` | Smoothness rating per drive (acceleration, braking, cornering). | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| FSD Insights | `/fsd` | Supervised self-driving distance, usage share, and data confidence. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Speed Profile | `/speed-profile` | Speed-vs-time chart for any drive. | Renders an empty state when no data is available — the page is not hidden. |
| Driving Dynamics | `/driving-dynamics` | G-forces, lateral and longitudinal acceleration analysis. | Renders an empty state when no data is available — the page is not hidden. |
| Regen Braking | `/regen-efficiency` | How much energy regenerative braking recaptures. | Renders an empty state when no data is available — the page is not hidden. |
| Route Efficiency | `/route-efficiency` | Compare actual vs predicted route efficiency across the full selected vehicle/date range; browse 12 route cards per page with a shareable `?page=` URL. KPIs and comparison chart include every route, not just the visible page. | Renders an empty state when no data is available — the page is not hidden. |
| Drive DNA | `/drive-dna` | Profile the repeatable characteristics of your driving style. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| What-If Simulator | `/what-if` | Simulate how speed, weather, load, and climate change efficiency. | Renders an empty state when no data is available — the page is not hidden. |
| Departure Forecast | `/departure-forecast` | Predict likely departure times from historical routines. | Renders an empty state when no data is available — the page is not hidden. |
| Arrival Reliability | `/arrival-reliability` | Estimate arrival-time reliability and route uncertainty. | Renders an empty state when no data is available — the page is not hidden. |
| Destination Transitions | `/destination-transitions` | Map recurring movement between destinations and likely next stops. | Renders an empty state when no data is available — the page is not hidden. |
| Journey Fragmentation | `/journey-fragmentation` | Measure trip chains, stopovers, and avoidable journey fragments. | Renders an empty state when no data is available — the page is not hidden. |
| Seasonal Efficiency | `/seasonal-efficiency` | Compare efficiency patterns across seasons and weather regimes. | Renders an empty state when no data is available — the page is not hidden. |
| Ghost Racing | `/segments` | Race your historical best on repeated road segments. | Detected segments are displayed 12 at a time with shareable page URLs; switching pages or vehicles clears the selected race. Route detection still uses the complete drive history. Renders an empty state when no data is available. |
| Drive detail | `/drives/:id` | Route, energy, FSD share, cost, session telemetry, and an on-demand road-surface anomaly review for one drive. | Open a row from /drives. FSD % needs trip-meter ticks; quantized 1-mile Tesla counters are valid. Road-surface analysis reports insufficient evidence when the necessary samples were not recorded. |

## Possible road-surface anomalies

Open a drive and expand **Road-surface anomalies** to review potential jolts. Analysis reads that drive's historical speed, acceleration, and GPS observations; it does not change Fleet Telemetry ingestion or issue any vehicle commands. A candidate is **not a confirmed pothole**: Tesla Fleet Telemetry does not expose a direct vertical acceleration or suspension-travel measurement, and a road seam, speed bump, or driving maneuver may look similar. A quiet result does not mean the road is pothole-free. Sparse or stale acceleration/GPS samples cannot establish an impact and are reported as insufficient evidence rather than guessed. Treat candidate locations as approximate, not turn-by-turn navigation or an automated road-hazard alert. Accuracy cannot be quantified without labeled, independently measured road-impact data.

[← All groups](./catalogue.md)
