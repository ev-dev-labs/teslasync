# Tesla Physics

Sidebar group **Tesla Physics**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Physics hub | `/tesla-only` | Tesla physics views Tesla app and TeslaMate cannot own. | Renders an empty state when no data is available — the page is not hidden. |
| Physics Ledger | `/tesla-only/ledger` | VIN-scoped energy/force solver: predicted vs measured, unexplained residual, unknown budget. | Shows unknown honestly when signals are missing; never zero-fills. |
| Science Lab | `/science` | Rest-voltage and apparent-resistance proxies, conditional regression fits, thermal transients, weather correlations, tire models, and generated analysis reports. | Unsupported fits stay unknown. CIs and holdouts are shown only when computed; these are not causal experiments. |
| Three Clocks | `/tesla-only/clocks` | Event, ingest, and display time. Ingest stays unknown if not stored. | Renders an empty state when no data is available — the page is not hidden. |
| Life Tape | `/tesla-only/life-tape` | Every second is Park, Neutral, Drive, Charge, or Unknown — not GPS. | Renders an empty state when no data is available — the page is not hidden. |
| Contradiction Court | `/tesla-only/contradictions` | Gear=P with speed is a contradiction. Complete still latched is not. | Renders an empty state when no data is available — the page is not hidden. |
| Trip-Meter Genealogy | `/tesla-only/meters` | Odometer and FSD trip meters. A drop is a reset. Null is not zero. | Renders an empty state when no data is available — the page is not hidden. |
| Unknown OS | `/tesla-only/unknown` | Unknown hours are a budget, never a measured zero of missing physics. | Renders an empty state when no data is available — the page is not hidden. |
| Car Kept Living | `/tesla-only/car-kept-living` | After MQTT or carbon loss: queued, replayed event time, never-received. | Renders an empty state when no data is available — the page is not hidden. |
| Tesla-Language Logbook | `/tesla-only/logbook` | Park, Drive, Neutral, Charging, Complete, Disconnected — Tesla words. | Renders an empty state when no data is available — the page is not hidden. |
| Firmware Epochs | `/tesla-only/firmware-epochs` | Each software version as this VIN physics baseline, not fleet proof. | Renders an empty state when no data is available — the page is not hidden. |
| Charge-Port Court | `/tesla-only/charge-port` | Latch, door, pack current, and ChargeState as one evidence chain. | Renders an empty state when no data is available — the page is not hidden. |
| Black Box 90s | `/tesla-only/black-box` | High-resolution samples in the 90s before Park, unplug, or a gap. | Renders an empty state when no data is available — the page is not hidden. |
| Owner Dictionary | `/tesla-only/dictionary` | This car Complete-to-unplug, Park dwell, and unscheduled Complete. | Renders an empty state when no data is available — the page is not hidden. |
| Physics Vault | `/tesla-only/vault` | Hashed session boundaries, unknown hours, firmware, etiquette dwells. | Renders an empty state when no data is available — the page is not hidden. |
| Mode Laws | `/tesla-only/modes` | Valet, Service, Transport laws. Unknown mode stays unknown. | Renders an empty state when no data is available — the page is not hidden. |
| Nervous System | `/tesla-only/nervous-system` | BMS, Gear, latch, and trip meters: alive, silent, or contradicting. | Renders an empty state when no data is available — the page is not hidden. |
| Range Disagreement | `/tesla-only/range` | Rated, typical, ideal, and energy remaining. Never a true range. | Shows unknown/empty honestly when signals are missing. |

## Analysis boundaries

New HTTP routes use `internal/handler/v1/analysis` and the `physicssvc` / `sciencesvc`
application services. The ledger uses recorded intervals, exposes gaps and row
caps, and does not reconcile partial telemetry against a complete session.
Explicit `Disconnected` state, not latch release, denotes unplugging.
Energy/motion integrations reject seed-only values and observations older than
two minutes instead of treating forward-filled power as a fresh measurement.

Science fits use the latest contiguous firmware epoch. Voltage/current steps
must be timestamp-aligned; seed-only freshness is unknown. Rest-end voltage is
not proven equilibrium OCV, and pack resistance is not cell resistance.
Thermal fits do not bridge separate Park episodes, active heating, long gaps,
or drifting ambient conditions, and require observed zero HVAC power.
Tire uncertainty is a model sensitivity band,
not a calibrated 95% confidence interval.

**The broader science loop is not fully implemented:** throughput/rest exposure
does not identify separate cycle/calendar aging; generated notebook rows are
not persisted reproducible experiments; not every model has independent-day
holdouts or correlation-robust uncertainty. The UI must not imply otherwise.
Grafana exposes observations and model inputs, not persisted solver fits.
Charging throughput describes returned, completed sessions contained in the
requested window, not lifetime exposure. It remains unknown when session energy
is missing, unbounded, invalid, or capped; equivalent cycles use the explicitly
labeled assumed reference capacity. Rest exposure is limited to the fitted
firmware epoch and must not be treated as the same coverage as session throughput.

Weather joins are disabled by default. Set
`TESLASYNC_SCIENCE_WEATHER_ENABLED=true` (Helm:
`physics.weatherEnabled: true`) only after accepting that drive-start
coordinates will be sent to Open-Meteo. Archive density uses surface pressure.
Without this opt-in, weather remains explicitly unavailable.

[← All groups](./catalogue.md)
