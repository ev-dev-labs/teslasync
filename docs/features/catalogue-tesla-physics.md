# Tesla Physics

Sidebar group **Tesla Physics**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Physics hub | `/tesla-only` | Tesla physics views Tesla app and TeslaMate cannot own. | Renders an empty state when no data is available — the page is not hidden. |
| Physics Ledger | `/tesla-only/ledger` | VIN-scoped energy/force solver: predicted vs measured, unexplained residual, unknown budget. | Shows unknown honestly when signals are missing; never zero-fills. |
| Science Lab | `/science` | Seven- or 30-day evidence overview linked to rest-voltage/current-step observations, thermal fit diagnostics, matched weather drives, tire model sensitivity, and generated notebook methods. | Each of the five reports loads independently. Unsupported fits stay unknown; CIs and holdouts are shown only when computed, not implied. |
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

## Following the evidence

The hub now prioritizes sampled-window coverage, unknown hours, contradictions,
meter drops, and non-alive signals. Open a finding to inspect its timestamps and
then follow the related-evidence links on each view. Three Clocks exposes elapsed
event time; Life Tape separates unknown intervals; meter genealogy shows the
readings before and after drops; Life Tape and Contradiction Court can be
filtered by state or finding without dropping the original evidence.
Logbook and Vault session boundaries link to drive and charging details.
Charge-port and Black Box views show current, schedule, and latch alongside
state. Firmware epochs expose their observed
boundaries, while the Vault distinguishes a bare hash from an HMAC-backed
certificate and shows its coverage window. Range Disagreement shows the spread
of available estimates, **not** a prediction of actual range.

The exclusive report reads **up to 14 days** of bounded telemetry and session
history; it is not a lifetime archive. The sampled-window percentage measures
time with accepted telemetry, not completeness of every signal. A zero finding
count only applies to the returned evidence. Per-signal unknown budgets overlap
and must not be added. The Black Box captures the *latest selected trigger* and
may have no frames within its 90-second interval. Logbook narrates session
boundaries, or the latest state when no sessions exist; it is not a complete gear
change feed. Follow the separate Physics Ledger and Science Lab for their
independent model and measurement evidence.

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
Use the Science Lab overview to inspect available evidence by domain.
Rest-voltage tables retain dwell, temperature and SOC context; resistance
steps show current and pack IR (not cell IR). Thermal cooldowns include their
sample counts, confidence bounds, fitted ambient and residual RMSE. Weather
rows link back to their drives and expose both session energy per distance and
model residual; Pearson correlations require at least five complete matches
and are not causal. The notebook exposes generated-row methods, input and
missing signals, residual diagnostics and firmware epoch, not persisted
experiments. The default window remains seven days; the optional 30-day
window is the science endpoint's maximum.

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
