# Tesla Physics

Sidebar group **Tesla Physics**. In the app, expand this section in the left nav (or search `/explore`).

The **Tesla Physics hub** at `/tesla-physics` leads to **15 individually lazy-loaded
investigation pages** at `/tesla-physics/{option}`. Every option owns its measured
summaries, interpretation, drilldowns, and missing-slice handling. The shared
page shell explains requested versus recorded windows, row counts, availability,
and caps. Large timestamp tables are **closed by default** and paginated on
demand. Legacy `/tesla-only/*` bookmarks redirect to the matching canonical
`/tesla-physics/*` page;
Physics Ledger and Science Lab remain independent pages.

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Physics hub | `/tesla-physics` | VIN-scoped source boundaries, trust warnings, and links to all 15 investigations. | Renders an empty state when no report is available. |
| Physics Ledger | `/tesla-physics/ledger` | VIN-scoped energy/force solver: predicted vs measured, unexplained residual, unknown budget. | Shows unknown honestly when signals are missing; never zero-fills. |
| Science Lab | `/science` | Seven- or 30-day evidence overview linked to rest-voltage/current-step observations, thermal fit diagnostics, matched weather drives, tire model sensitivity, and generated notebook methods. | Each of the five reports loads independently. Unsupported fits stay unknown; CIs and holdouts are shown only when computed, not implied. |
| Three Clocks | `/tesla-physics/clocks` | Second-precision latest readings, paired ingest lag and gap distribution, six latest samples, a long-gap filter and paginated raw timestamps. | Missing ingest stays unknown. |
| Life Tape | `/tesla-physics/life-tape` | State-duration and interval-count breakdown, classified/window share with overlap warning, longest interval, chronology and filterable raw intervals — not GPS. | Missing evidence stays unknown. |
| Contradiction Court | `/tesla-physics/contradictions` | Backend episodes, per-kind episode/reading counts, observed bounds, kind/uncertainty filters and nearby charge-port context. | An episode is not proof of a distinct fault; individual source readings are not in this report. |
| Trip-Meter Genealogy | `/tesla-physics/meters` | Current counters, observed drop sequence and firmware counter bounds, mode context and before/after drilldown. Null is not zero. | With no returned drops, still shows current counters and firmware evidence, not an invented continuous timeline. |
| Unknown OS | `/tesla-physics/unknown` | Sampled share, uncovered share, per-signal budget breakdown and links to clock, broker and signal investigations. | Missing signals stay unknown. |
| Car Kept Living | `/tesla-physics/car-kept-living` | MQTT, queue, replay, paired ingest lag, bounded-source availability and telemetry-gap context. | Unreported broker state stays unknown. |
| Tesla-Language Logbook | `/tesla-physics/logbook` | First/latest historical observations, session boundaries, positive-ID links and kind-filtered narrative. | Synthetic live state is only a fallback. |
| Firmware Epochs | `/tesla-physics/firmware-epochs` | Each version's observed bounds, counter changes, dwell availability and version filter, not fleet proof or FSD engagement. | Unknown bounds stay unknown. |
| Charge-Port Court | `/tesla-physics/charge-port` | Latest state/current with gear, version, observed state changes, schedule context and filterable per-sample evidence. | Missing readings stay unknown. |
| Black Box 90s | `/tesla-physics/black-box` | Latest selected trigger, 90-second window, frame changes, observed gears/firmware, source caps and optional frames. | Empty frames do not exclude an event. |
| Owner Dictionary | `/tesla-physics/dictionary` | This car's Complete-to-unplug, Park dwell, source-dwell distribution and guarded quartile comparison. | Missing samples do not imply zero dwell. |
| Physics Vault | `/tesla-physics/vault` | Hash/HMAC status, capped session boundaries and optional drive/charge links. | Hashing does not prove complete coverage. |
| Mode Laws | `/tesla-physics/modes` | Valet, Service, Transport inference boundaries with separately returned counter and firmware context. | Unknown mode stays unknown; current modes do not prove past modes. |
| Nervous System | `/tesla-physics/nervous-system` | Signal-status breakdown, non-alive details, status filter and exact-name Unknown OS budget cross-reference. | Silence is not zero or proof of a component fault. |
| Range Disagreement | `/tesla-physics/range` | Rated, typical, ideal and energy remaining with spread and pairwise differences; not a true-range forecast. | Missing estimates remain unknown. |

## Following the evidence

The hub prioritizes sampled coverage, unknown hours, backend contradiction
episodes and meter drops. Contradiction Court uses the backend's episode window and observation count;
an episode is not a confirmed independent physical failure. The individual
readings grouped by the backend are **not** included in the exclusive report.
Three Clocks leads with second-precision timestamps, stored-ingest lag, gap
distribution and a long-gap filter instead of a giant repeated minute-only
table. Life Tape and Contradiction Court keep state/kind filters for their
evidence. Meter readings have no continuous counter time series; reset pairs
and firmware epoch counter bounds are the only historical meter comparisons,
and a counter ratio cannot measure FSD engagement.
Logbook and Vault session boundaries link to drive and charging details.
Charge-port and Black Box views show current, schedule, and latch alongside
state; recorded gear and firmware readings appear in both evidence tables
(including their mobile views), and absent readings stay unknown. Firmware epochs expose their observed
boundaries, while the Vault distinguishes a bare hash from an HMAC-backed
certificate and shows its coverage window. Range Disagreement shows the spread
of available estimates, **not** a prediction of actual range.

The exclusive report reads **up to 14 days** of bounded telemetry and session
history; it is not a lifetime archive. The sampled-window percentage measures
time with accepted telemetry, not completeness of every signal. A zero finding
count only applies to the returned evidence. Per-signal unknown budgets overlap
and must not be added. The Black Box captures the *latest selected trigger* and
may have no frames within its 90-second interval. Logbook narrates session
boundaries alongside observed historical gear and charge-state changes. The first
recorded value establishes observed state, not an exact transition time.
Synthetic live state is excluded when recorded entries exist; it appears only
as a fallback when none do. Historical signal entries have no session ID and
do not link to a drive or charge. Gaps and unobserved changes remain unknown. The evidence
boundaries panel lists requested and recorded timestamps, row counts,
availability, and row/session cap warnings; it does not equate an empty row set
with complete coverage. The hub calls out partial sources beside its summary;
Black Box separately warns when its source or trigger-selection history is
unavailable or capped. Vault separately warns when history, drive sessions,
or charge sessions are capped: its hash attests to the returned boundaries,
not completeness of the underlying history. Follow the separate Physics Ledger and Science Lab for their
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
