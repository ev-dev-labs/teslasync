# Whole-app shared component inventory

**Status: requirements inventory complete, 2026-10-05. All 20 required
shared-library contracts implemented and accepted, 2026-10-06.**

The whole-app requirements list contains **20 change contracts: 2 new
components, 2 promotions and 16 existing-owner extensions**. All twenty contracts
are now **technically and visually accepted**. The previous 12-item
cohort was partial, not the full app-wide list.

All 35 feature directories, the remaining AI presentation adapters and defined
app/native/library boundaries are accounted for: **2,560 unique source entries,
2,320 complete assessments, 240 explicit exclusions, zero unreviewed paths**.
Source fingerprints and citation bounds reconcile without unresolved errors.
Exclusions and export inspection are not disguised rendering-body reviews.
This is a requirements inventory, not an audit/acceptance claim for every
existing library implementation or a browser/native validation pass.

The user subsequently authorized completing the shared library with ten
concurrent subagents. Phase-2 implementation and phase-3 library acceptance
are complete. The subsequent user authorization starts phase-4 page migration
with fifteen disjoint workers across all 34 production feature directories,
then automatic phase-5 validation after the technical gate. The separate
DEV reference directory is not a production-page boundary.
All source paths below are relative to `web\src` unless otherwise specified.

## Acceptance evidence

The consolidated regression cohort passed **60 files / 1,032 tests** before
the final adaptive-label and viewport-containment corrections. Subsequent
affected checks passed **7 files / 85 tests** for labels and **29 toolbar
tests**, including resize recovery, delayed selection mounting and observer
cleanup. These are separate receipts, not a claim that the 1,032-test cohort
was rerun after every correction.

Final `npx tsc --noEmit`, full `npm run lint` and official `npm run build`
passed with exit 0. The official violations audit passed all six categories
and TypeScript on **46 byte/hash-verified owned implementation files** using
Node 26. Final source comparison found zero mismatches. This is scoped
acceptance: the earlier broad audit's **43 inherited findings outside these
owners remain unresolved**, not reclassified as clean.

The single whole-library sweep covered all 20 contracts, desktop/mobile
dark/light, RTL with 200% text, forced colors and reduced motion. Issues were
corrected and only affected surfaces rechecked. Final browser receipts passed
all-20 action-label bounds and real footer hit-testing, both native
desktop/mobile interaction flows, and the six-mode bulk-toolbar recheck.
Native clipboard denial/recovery and complete CSV data were exercised, not
replaced by API overrides or truncated exports.

Coupled foundation fixes preserve default button sizing while allowing
multiline labels, contain description/marker tooltips, retain valid gauge
readings when scales are invalid, and paint tracks/fills in forced colors.
Bulk toolbars remain sticky only while their measured height fits the
viewport; oversized bars stay in normal flow so actions and result feedback
remain reachable as content, text size and viewport dimensions change.

Preview port 5240 was stopped and zero listeners verified. The inherited
21-path staging index is unchanged. Work remains uncommitted; this acceptance
does not certify page migration, deployment or the whole existing app.

## Complete change list

| # | Contract | Classification | Current status |
| --- | --- | --- | --- |
| 1 | WeekdaySelect | New | Accepted |
| 2 | CompositionRail | New | Accepted |
| 3 | CodeBlock | Promotion | Accepted |
| 4 | CopyButton feedback | Extend | Accepted |
| 5 | KVList rich details | Extend | Accepted |
| 6 | PillFilterBar semantics | Extend | Accepted |
| 7 | WidgetGaugeHero preservation | Extend | Accepted |
| 8 | WidgetRankedList presentation | Extend | Accepted |
| 9 | TimelineItem / WidgetEventFeed | Extend | Accepted |
| 10 | BulkActionsToolbar selection scope | Extend | Accepted |
| 11 | SourceContent specialist loading/empty slots | Extend | Accepted |
| 12 | ChartCard / canonical chart frame | Extend | Accepted |
| 13 | OrderedStepList | Promotion | Accepted |
| 14 | Accordion stacked description | Extend | Accepted |
| 15 | Timeline accessible summary ordering | Extend | Accepted |
| 16 | SmallMultiplesChart allocated-width containment | Extend | Accepted |
| 17 | MetricBar compact passive track | Extend | Accepted |
| 18 | PlaybackControls capabilities/adaptive frame | Extend | Accepted |
| 19 | TimelineScrubber read-only event overview | Extend | Accepted |
| 20 | BipolarBar nullable signed reading | Extend | Accepted |

Count contracts once, not every touched file, alias or adapter. Contract 9
updates two existing APIs; contract 12 updates the existing canonical chart
chain. MetricBar's compact/solid-fill and passive/nullable findings are one
owner/contract, not two additions. The six existing foundations are
prerequisites, not six more new components. The reuse and local-policy family
maps below describe a different counting level and are not added to these 20.

## Latest implementation cohort: eight contracts

These requirements are supported by actual consumer reads and existing API
comparisons. Source and focused tests have been delivered for all eight.
This section retains scope, dependencies and ownership files;
the user's resumed implementation authorization does not certify acceptance.

| Contract | Classification | Exact responsibility / gap | Dependencies and proposed owner | Consumer evidence |
| --- | --- | --- | --- | --- |
| OrderedStepList | Promote/extract existing feature presentation | Neutral caller-prepared ordered instructions/checklist, with stable identity, optional state and action. Existing Stepper derives the current step and embeds onboarding policy; Timeline requires event times and is not an instruction list. Keep completion, authentication and subscription logic in callers. | Typography, Button, IconBox, accessibility primitives; proposed `components\data-display\OrderedStepList.tsx` | `features\onboarding\components\Stepper.tsx:22-179`; `features\settings\components\fleet-setup\FleetSetupProgress.tsx:24-129`; `features\settings\components\fleet-setup\FleetSetupGuide.tsx:16-93`; `features\settings\components\twofactor\TotpSetupGuide.tsx:28-103` |
| Accordion description | Extend existing API | Optional description below the title within its identity block. `title` is currently a string; `headerExtra` is a right-hand sibling, not a stacked description. Preserve controlled/uncontrolled disclosure, lazy mounting and associated region. | Existing `components\ui\Accordion.tsx`, typography | `features\admin\components\devtools\ClientUtilitiesSection.tsx:62-105`; `features\system\components\status\AccordionSection.tsx:8-90`; `features\system\components\status\HealthProbesSection.tsx:27-77` |
| Timeline summary ordering | Extend existing API | Caller-explicit summary bounds or chronology without sorting entries or parsing localized timestamps. The current accessible summary assumes newest-first ordering. This is distinct from the already implemented TimelineItem/WidgetEventFeed rich-row contract. | Existing `components\data-display\Timeline.tsx`, useA11ySummary | `features\system\components\RepairEvidenceTimeline.tsx:18-65`; contrasting newest-first feed `features\system\components\incident\IncidentTimelineList.tsx:14-53` |
| SmallMultiplesChart allocated-width containment | Extend/fix existing presentation invariant | Bound the automatic grid's preferred minimum to its allocated width. Current `minmax(cellMinWidth px, 1fr)` can overflow a narrower slot; forcing one column is not equivalent responsive packing. No new measurement, query or chart engine. | Existing `components\charts\SmallMultiplesChart.tsx`; retain automatic/forced modes and all cell/data contracts | `features\telemetry\pages\SignalsWorkspacePage.tsx:623-645`; `features\telemetry\pages\SignalLogViewerPage.tsx:175-245`; shared declaration `components\charts\SmallMultiplesChart.tsx:196-202` |
| MetricBar passive compact track | Extend existing API | Optional slim track-only presentation, independent accessible name, solid/prepared fill and nullable/no-reading semantics. Current numeric-only API always renders a label/value row, fixed-height track and gradient; invalid readings still expose numeric zero. Preserve defaults; do not add seeking or move media/ETA/cost/pool calculations into the bar. | Existing `components\data-display\MetricBar.tsx`, typography/motion | `features\dashboard\widgets\MediaNowPlayingWidget.tsx:32-47,125-158`; `features\dashboard\widgets\DestinationETAWidget.tsx:204-220`; `features\settings\components\AICostCapSpendBar.tsx:80-134`; `features\system\pages\DBHealthPage.tsx:554-583` |
| PlaybackControls capability/adaptive presentation | Extend existing API | Optional speed/restart/stop capabilities, separate restart versus stop callbacks, embedded/unframed rendering and allocated-container wrapping. Current required speed/stop controls and reset-as-stop cannot represent video restart/play/seek-only transport faithfully. Keep the replay clock, media lifecycle and opt-in shortcuts caller-owned. | Existing `components\data-display\PlaybackControls.tsx`, TimelineScrubber, PlaybackSpeedMenu, Button/typography | `features\trips\pages\TripReplayPage.tsx:630-650`; `features\dashcam\components\dashcam\ClipPlayerPanel.tsx:92-104` |
| TimelineScrubber read-only event overview | Extend existing API | Explicit non-seeking proportional-event mode without a required playhead/onSeek, slider tabstop, drag/keyboard seeking or fabricated playback position. Preserve prepared temporal geometry and accessible marker descriptions; caller supplies clock-origin/time labels. | Existing `components\data-display\TimelineScrubber.tsx`, marker geometry/typography | `features\dashcam\components\dashcam\ReconstructionTimeline.tsx:109-145`; one independent read-only consumer verified, not a claim of cross-domain repetition |
| BipolarBar nullable signed reading | Extend existing API | Explicit missing/nonfinite reading presentation without numeric meter zero/fill. Preserve real zero, negative direction and independently asymmetric positive/negative scales. Do not move torque/RPM interpretation, units or freshness into the renderer. | Existing `components\charts\BipolarBar.tsx`, typography/number formatting | `features\driving\components\driving-dynamics\LiveMotorStatus.tsx:174-207`; `features\driving\components\driving-dynamics-modernization\SignedMotorReading.tsx:1-27`; `features\driving\components\driving-dynamics-modernization\LiveMotorStatus.tsx:101-116` |

These eight comprise one promotion/extraction and seven existing-owner
extensions. Each future owner owns the listed component and its adjacent tests;
the orchestrator owns category exports, catalogs, tokens/theme and integration.
PlaybackControls consumes TimelineScrubber's existing interactive API; coordinate
any shared type changes instead of letting both owners edit the scrubber.
Source-ready does not mean technically/visually accepted or committed.

## Existing APIs to reuse, not recreate

This is a capability map of existing named APIs, not a count of missing
components or proof of consumer/runtime acceptance. Public category barrels
were inspected during closure; formatted values, controls, providers and
vendor re-exports must not be counted as new composites. Consumer fit is
resolved separately by the domain evidence. The historical 174-name map was
a discovery aid, not the complete library or a required implementation total.

| Family | Existing APIs |
| --- | --- |
| Base surfaces and actions | Button, Badge, Card/CardHeader/CardFooter, GlassPanel, SelectableCard, Icon/IconBox, StatusPill, EditableText, PinButton |
| Page composition | PageLayout, Section, CardGrid, LayoutCard, ChartCard, PageContainer, PageHeader, PageActions, PageHeaderSticky, Grid, Stack, Masonry, LockedNotice |
| Typography | Heading, Text, PageTitle, SectionTitle, PanelTitle, Subhead, Caption, HelperText, ErrorText, Label, MetricValue, MetricLabel, Code |
| Metric summaries | StatStrip, StatGroup, StatCard, MetricCard, MetricTile, InlineMetric, MetricBar, AnimatedNumber, GridMetricIndicator, KpiOverviewCard, UsageCard |
| Charts and alternatives | ChartContainer, EmbeddedChart, ChartLegend, ChartTooltip, SmallMultiplesChart, MetricSwitcherChart, ChartBrush, ChartExportMenu, MiniChart, AreaChartWrapper, ChartGradient, ElevationProfile |
| Gauges and proportions | LinearGauge, BipolarBar, ThresholdBar, ProgressRing, Sparkline, CompositionRail |
| Tables and mobile details | DataTable and its mobile presentation adapter, Table, DataTableValueFilter, DataTableColumnsMenu, DataTableBulkBar, DataTableResizer, MobileGridReference |
| Search and filtering | FilterBar, ActiveFilterChips, FilterSheet, SearchInput, PillFilterBar, TableToolbar |
| Form structure and feedback | FormSection, FormField, ValidationSummary, Input, Textarea, Select, Checkbox, RadioCard, Toggle |
| Specialist inputs | Combobox, ComboboxMulti, TagInput, TreeSelect, UnitInput, SignalUnitInput, UnitListInput, CurrencyInput, Slider, RangeSlider, WeekdaySelect, PersonaSelect |
| Workspace selection | RangePicker, DateRangeFilter, DatePresetChips, VehicleSelect, VehicleMultiSelect, VehiclePicker; these remain subject to the single workspace-owner rule |
| Source trust and recovery | SourceContent, EmptyState, ActionableEmptyState, ErrorDisplay, QueryError, DataStateNotice, DataUnavailableNotice, StaleRefreshWarning, DataSourceNotice |
| Loading structure | Spinner, Skeleton, ChartSkeleton, StatSkeleton, ListSkeleton, PageHeaderSkeleton, StatGridSkeleton, ChartBlockSkeleton, TableSkeleton, PageLoader, PageLoadSkeleton, TopProgress, SuspenseProgressBoundary |
| Status and provenance | Badge, StatusBadge, FSMBadge, SeverityBadge/SeverityIcon, StatusDot, OperationalModeBadge, FreshnessIndicator, DataFreshness, DataProvenanceBadge, SourceLayerBadge, LiveIndicator |
| Details and evidence | KVList, CalculationDetails, OperationalBrief, OperationalNarrativeDetails, EntityPreviewDrawer, InlineCallout; KeyValueList is the narrower string-only layout API, not an equivalent rich-row replacement |
| Comparisons | ComparisonHeader, Delta, ScoreBadge, BatteryDelta |
| History and activity | Timeline, TimelineItem, RecentActivityFeed, DateGroupedList, HistoryListRow, RouteDisplay, TimeStamp |
| Replay controls | PlaybackControls, PlaybackSpeedMenu, TimelineScrubber, RoutePlayback |
| Maps | MapContainer, MapTileLayer/MapInvalidator, MapLayerSwitcher, MarkerCluster, GeofenceDrawer, AnimatedMarker; Leaflet components remain behind the shared map boundary |
| Overlays and confirmation | Modal, Drawer, Popover, ConfirmDialog, ContextMenuRoot, Lightbox |
| Navigation and actions | Tabs, TabNav, Breadcrumbs, Pagination, PrefetchLink, CommandPaletteTrigger, BulkActionsToolbar/BulkActionToolbar (same owner, not two components) |
| Export and copy | ListExportMenu, CopyButton, CopyLinkButton, PrintButton, FullscreenButton, CodeBlock |
| Help and disclosure | Tooltip, HelpTooltip, HelpIcon, GlossaryTerm, Accordion, AboutPanel |
| Safety and operating context | OperationalWriteNotice, RequiresAuth, PermissionGuidanceNotice, DemoModeBanner, OfflineBanner, DraftRecoveryBanner, EditConflictBanner, MaskedValue, NavigationGuardProvider |
| Accessibility and mobile gestures | VisuallyHidden, AnnouncerRegion, RouteAnnouncer, RouteFocusManager, SkipToContent, PullToRefresh, SwipeRow |
| Vehicle presentation | VehicleHeroCard, VehicleTwin, VehiclePaintPicker, VirtualizedVehicleGrid |
| Operator/status composition | StatusHero, StickyChipBar, StickyCompactHero, HealthRow, ActionItem, ActionItemsPanel, ResourcesPanel, UptimeHeatmap, FrontendErrorsCard |
| App/device hosts | ErrorBoundary/SectionErrorBoundary/PageErrorBoundary, ToastProvider, JobProgressDrawer, ProblemReportModal, CookieConsentBanner, BrowserCompatBanner, UpdatePrompt, CachedDataNotice, LowBandwidthControl; root-owned InstallPrompt/ReloadPrompt stay direct imports |
| Motion and typography environment | FadeIn, RouteTransition, StaggerContainer, StaggerItem, CarAnimation, TypographyAgentProvider, AmbientTypographyHUD |
| Display-only SI formatting | DateTime, Distance, Speed, Temperature, Pressure, Energy, Power, Voltage, Current, Currency, Percentage, FormattedNumber, Duration, Range |
| AI output | AIFeatureCard/AIBadge, AiOutputPanel, AIThinkingIndicator/AIThinkingDots, AiLimitBanner, HelixEvidenceTrail, AiConfirmDialog; streams, tools, authorization and proposal execution remain domain-owned |

Export evidence: `components\ui\index.ts`, `forms\index.ts`,
`layout\index.ts`, `data-display\index.ts`, `charts\index.ts`,
`feedback\index.ts`, `a11y\index.ts`, `maps\index.ts`, `mobile\index.ts`,
`status\index.ts`, `vehicles\index.ts`, `motion\index.ts`,
`typography-agent\index.ts`, and the relevant nested public barrels.
AiOutputPanel and the direct root hosts are backed by their actual modules,
not a nonexistent AI/navigation barrel. No `reference` directory alone is a
development exclusion: several canonical production primitives live there.

Root-level signal controls do **not** establish a missing multi-select,
pagination or date-control foundation: existing ComboboxMulti exposes supplied
options, maximum selections, loading, removable chips and accessible labels
(`components\forms\ComboboxMulti.tsx:35-77`). Existing Input, Select, Button,
DataTable and Pagination cover the other demonstrated primitives in
`components\SignalQueryControls.tsx:280-461`. Its query/domain adapters remain
with their owner; workspace-owned dates must not acquire a second page picker.
Likewise, formatter/query bridges and workspace/vehicle providers are
side-effect/state contracts, not missing presentation components.

## Previously implemented source-ready cohort: twelve contracts

The earlier implementation cohort contains **12 contracts**:
two new controls/displays, one promotion into the shared library and nine
extensions. The timeline contract updates two existing rendering APIs. This
is not 12 brand-new components or the complete 20-contract requirement count.
The existing six foundations are prerequisites, not six additional new items
in this table. Optional/local candidates below do not create duplicate engines.

**Historical pre-acceptance status:** 12 contracts were source-ready; none had
yet passed the complete phase-2
acceptance and commit gate.** Every source-ready item includes authored tests.
Full technical validation is deferred until the library source scope is
complete, followed by the single phase-3 visual sweep. Page migration was paused
at that point; the current acceptance and phase transition are recorded above.

All paths below are relative to `web\src`. An owner also owns the adjacent
named test file, except CopyButton/PillFilterBar tests live under `__tests__`.
Parent owns category exports, canonical/generated catalogs and integration.

| Contract | Depends on | Exclusive implementation files | Owner | Status |
| --- | --- | --- | --- | --- |
| WeekdaySelect | Existing Button, theme tokens | `components\forms\WeekdaySelect.tsx` | shared-weekday-select | Source-ready |
| CompositionRail | Existing typography, theme tokens | `components\data-display\CompositionRail.tsx` | shared-composition-rail | Source-ready; forced-color style correction authored |
| CodeBlock promotion | Existing CopyButton API, typography | `components\ui\CodeBlock.tsx` | shared-code-display | Source-ready; old feature adoption deferred |
| CopyButton feedback | Existing Button, optional Toast | `components\ui\CopyButton.tsx` | shared-copy-feedback | Source-ready |
| KVList details | Existing typography, container queries | `components\data-display\KVList.tsx` | shared-kv-details | Source-ready |
| PillFilterBar semantics | Existing Button, number formatting | `components\forms\PillFilterBar.tsx` | shared-filter-semantics | Source-ready |
| WidgetGaugeHero preservation | Existing LinearGauge | `features\dashboard\widgets\shared\WidgetGaugeHero.tsx` | shared-widget-gauge | Source-ready; preservation mode opt-in, defaults retained |
| WidgetRankedList presentation | Existing Badge/EmptyState | `features\dashboard\widgets\shared\WidgetRankedList.tsx` | shared-widget-ranking | Source-ready |
| TimelineItem / WidgetEventFeed | Existing Link, typography, date formatting | `components\data-display\TimelineItem.tsx`; `features\dashboard\widgets\shared\WidgetEventFeed.tsx` | shared-timeline-details | Source-ready |
| BulkActionsToolbar scope | Existing Button, ConfirmDialog/useConfirm | `components\data-display\BulkActionsToolbar.tsx` | shared-bulk-scope | Source-ready |
| SourceContent extension | Existing EmptyState/ErrorDisplay/Skeleton | `components\layout\layout-reference\SourceContent.tsx` | shared-source-presentation | Source-ready; two-file handoff preserved and hash verified |
| ChartCard / canonical frame extension | Existing LayoutCard/EmbeddedChart/ChartContainer | `components\layout\layout-reference\ChartCard.tsx`; `components\charts\EmbeddedChart.tsx`; `components\charts\ChartContainer.tsx` and their assigned tests | shared-chart-capabilities | Source-ready; seven-file handoff preserved and hash verified |

Counting completion requires consolidated technical evidence and the authorized
scoped commit, not just a source handoff. No shared contract is visually
accepted or deployed by this table.

## Coverage and counting

| Source boundary | Complete assessments | Explicit exclusions | Total | Unreviewed |
| --- | --- | --- | --- | --- |
| Admin/settings/system/server/onboarding | 345 | 81 | 426 | 0 |
| Driving/trips/maps/dashcam/watch | 513 | 28 | 541 | 0 |
| Battery/charging/home-energy | 280 | 86 | 366 | 0 |
| Analytics/benchmarks/telemetry/science/advanced intelligence/diagnostics/explore | 332 | 0 | 332 | 0 |
| Vehicles/vehicle systems/ownership/resale/service intelligence/fleet operations | 397 | 2 | 399 | 0 |
| Action center/automations/dashboard/exports/notifications/sharing/power user/packs | 371 | 0 | 371 | 0 |
| Additional AI adapters (seven core overlaps excluded from this row) | 57 | 0 | 57 | 0 |
| Parent core/app/native sources, including the seven AI core files | 25 | 0 | 25 | 0 |
| Public export barrels, read for capability mapping | 0 | 17 | 17 | 0 |
| DEV-gated synthetic reference sources/configuration | 0 | 26 | 26 | 0 |
| **Total unique scoped sources** | **2,320** | **240** | **2,560** | **0** |

The first six domain boundaries own 34 feature directories; the final
development-reference boundary owns the 35th. Original partial admin/mobility
artifacts were sealed at their deadlines; six disjoint narrower questions
assessed only the previously unread 144/202 paths. No completed source was
re-audited to inflate coverage. Seven AI core ownership exclusions were
reconciled against matching complete parent evidence, not counted twice.

The final source ledger and immutable per-scope receipts are retained in the
session artifact `full-inventory-merged-final.json`, SHA256
`07A68B5FD72A67DCC98741A120D081C142E55ADC7787153681BD264BA76257C5`.
It includes identities, hashes, assessment/exclusion reasons, citations and
source-specific semantic notes. The source ledger is not a count of pages,
components or new work. Aliases, redirects, helpers and models are not pages.

The reusable API map has **31 families**. This is not 31 new components or
proof of every existing implementation's acceptance. Production implementations
inside library `reference` directories remain in scope; only actual
development fixtures/configuration are excluded from production requirements.

## Source-ready preservation decisions

These are the requirements behind four of the twelve source-ready contracts,
not additional work items or acceptance receipts.

| Contract | Decision and preservation requirements |
| --- | --- |
| WeekdaySelect | Shared extraction is justified by the two complete selection bodies in ConditionBuilder and TriggerConfigurator. Accept caller-supplied ordered day IDs, visible/accessibility labels, explicit selected IDs and a controlled change callback. Preserve independent pressed buttons, wrapping and disabled behavior. Do not parse cron, interpret a bitmask or infer all/none from an empty selection: the condition uses empty = none, whereas the cron adapter uses empty = all. Existing PillFilterBar is a single-select tablist, not this multi-select contract. |
| Categorical composition rail | Shared extraction is justified by DiagnosticPage, RoadmapPage and StatusDistribution. Accept prepared ordered proportions, stable IDs, caller-defined presentation and an accessible summary; keep every category/count in the legend even when its visual segment is suppressed. Denominator selection, clamping and tiny-segment policy remain caller-owned. Preserve feedback's below-0.3% visual omission without dropping evidence. Zero-total roadmap state remains caller-owned. This is not a meter or progressbar and must not become another chart controller. |
| WidgetGaugeHero | Extend the existing adapter rather than create another gauge. Its non-finite-to-zero and invalid-max-to-100 substitutions discard information already supported by LinearGauge. Preserve nullable readings and caller scale/semantic metadata. DrivingDynamicsWidget and RegenEfficiencyWidget currently guard missing readings with WidgetBigNumber; those guards are correct preservation evidence, not current unguarded-zero bugs. |
| WidgetRankedList | Extend the existing renderer with an explicit caller-order policy and nullable magnitudes, preserving existing default ordering/limits for current callers. It currently coerces unknown values to zero and always sorts descending before slicing. RouteEfficiencyWidget supplies an inverted efficiency score; LocationFavoritesWidget supplies visit counts. Their scoring, limit and unknown-placement decisions remain local; do not replace these with a universal business ranking rule. |

Concrete comparisons:
`web\src\components\forms\PillFilterBar.tsx:20-77`,
`web\src\components\ui\Toggle.tsx:47-106`,
`web\src\features\dashboard\widgets\shared\WidgetGaugeHero.tsx:4-55`,
`web\src\components\charts\LinearGauge.tsx:12-91,126-143`,
`web\src\features\dashboard\widgets\DrivingDynamicsWidget.tsx:190-218`,
`web\src\features\dashboard\widgets\RegenEfficiencyWidget.tsx:60-113`,
`web\src\features\dashboard\widgets\shared\WidgetRankedList.tsx:6-79`,
`web\src\features\dashboard\widgets\RouteEfficiencyWidget.tsx:58-93`, and
`web\src\features\dashboard\widgets\LocationFavoritesWidget.tsx:79-92`.

CompositionRail consumer evidence:
`features\system\pages\DiagnosticPage.tsx:258-328`,
`features\system\pages\RoadmapPage.tsx:421-471`,
`features\admin\components\feedback-queue\StatusDistribution.tsx:27-73`.

## Final reuse/local dispositions

Seven initially proposed composite candidates do **not** require a new global
contract. Use the existing APIs or keep topology/policy-specific composition
local. These are seven candidate dispositions, not a count of every local
component or domain policy in the app.

| Candidate | Final disposition and responsibility | Independent source examples |
| --- | --- | --- |
| ConfigurationRow | Reuse FormSection/FormField, typography and controls. Toggle forwards explicit `aria-label`, `aria-labelledby` and `aria-describedby` to the switch; its ordinary id/ref still address the wrapper. Do not mistake cloning for safe association or move settings/mutations into a universal row. | `web\src\features\settings\components\WorkspacePreferencesSettings.tsx:290-351`; `web\src\features\notifications\components\NotificationSoundChannelRow.tsx:31-49` |
| Quantitative heatmap surface | Keep supplied calendar/rectangular/square/geographic topology local; reuse Table, Tooltip/Button and prepared cells where appropriate. No universal heatmap/bucketing engine; preserve legend, accessible details and full-data alternative. | `web\src\features\charging\components\charging-heatmap\HeatmapGrid.tsx:30-76`; `web\src\features\home-energy\components\TariffConstraintHeatmap.tsx:58-131`; `web\src\features\analytics\components\drive-calendar\DriveCalendarHeatmap.tsx:109-135` |
| EvidenceReferenceList | Existing typography, links, source notices and details composition suffice. Evidence identities, source ordering, model and confidence/limitation policy remain local; no required new API established. | `web\src\features\ownership\components\EvidencePanel.tsx:119-139`; `web\src\features\service-intelligence\components\EvidenceLimitationsPanel.tsx:59-88` |
| Rule/evidence grid | Reuse Grid/KVList/typography/source-boundary composition. Qualification rules, displayed policy and impact remain local; withdraw the initial NEW classification. | `web\src\features\vehicle-systems\components\cabin-thermal\CabinThermalThresholdMatrix.tsx:52-163`; `web\src\features\vehicle-systems\components\comfort-consistency\ComfortConsistencyThresholdGateMatrix.tsx:28-131` |
| BuilderStepFrame | Reuse FormSection/LayoutCard/control composition; step identity, validation, reorder/remove policy and rule grammar remain caller-owned. | `web\src\features\automations\pages\ActionBuilder.tsx:302-373`; `web\src\features\automations\pages\ConditionBuilder.tsx:194-239` |
| CatalogueEntry | Reuse LayoutCard/typography/control composition. Navigation, choice and explicit-action semantics are distinct; eligibility and catalogue state remain local. | `web\src\features\automations\pages\PresetGallery.tsx:61-135`; `web\src\features\intelligence-packs\components\CatalogCard.tsx:32-76` |
| PublicReportFrame | Keep a feature-local public wrapper if consolidation is useful; reuse layout/surfaces without authenticated workspace chrome. Token, redaction, privacy and authentication policy remain local. | `web\src\features\sharing\pages\SharedDrivePage.tsx:215-433`; `web\src\features\sharing\pages\SharedSessionReport.tsx:53-223` |

Other source-ledger local decisions preserve domain accounting/thresholds,
estimators, graph/power-flow geometry, replay/media/historical clocks, typed
trees/parsers/editors, setup/one-time secrets, exports/sharing/storage/privacy,
dashboard drafts/registry and provider/router composition. AI conversation,
tool/proposal execution, authorization and voice-device lifecycle stay local;
the 57 additional AI adapter assessments established no further required
NEW/EXTEND contract. Native wrappers host the SPA rather than establishing a
second shared presentation library.

The CodeBlock promotion preserves caller-supplied escaped content, exact
clipboard text, header and contained overflow; it adds no parser/editor or
highlighting dependency. Evidence:
`features\system\components\chatbot\CodeBlock.tsx:6-56`,
`features\admin\components\ApiLogsEvidenceTable.tsx:54-83`.
WeekdaySelect evidence:
`features\automations\pages\ConditionBuilder.tsx:440-470`,
`features\automations\pages\TriggerConfigurator.tsx:224-289`.

## Source-ready extension requirements and consumers

| Existing owner | Implemented responsibility, still awaiting complete acceptance | Independent source examples |
| --- | --- | --- |
| SourceContent | Caller-sized initial loading and specialist empty/unresolved/prerequisite presentation, without losing retained children or independent-source recovery. | `web\src\features\admin\components\live-signal-inspector\LiveSectionState.tsx:18-68`; `web\src\features\sharing\components\share-card\ShareCardSectionBody.tsx:47-94` |
| CopyButton | Caller-owned failure feedback/manual-copy guidance, preserving defaults and success callbacks. | `web\src\features\power-user\pages\DashboardsPage.tsx:154-196`; `web\src\features\power-user\pages\GrafanaPanelPage.tsx:225-267` |
| ChartCard / canonical chart frame | Opt-in canonical toolbar, annotations, export/fullscreen and intentional sizing parity; no second chart controller or duplicated header. | `web\src\features\driving\components\efficiency-modernization\EfficiencyChart.tsx:15-35`; `web\src\features\driving\components\drivetrain-health-modernization\PreservedChartFrame.tsx:14-15` |
| KVList | Opt-in stable row identity, rich labels/leading content and wrapping/stacking. Compare with existing diagnostic KeyValueList rather than introducing another details renderer. | `web\src\features\dashboard\pages\GlancePage.tsx:106-141`; `web\src\features\dashboard\widgets\shared\WidgetDetailCard.tsx:51-84` |
| TimelineItem / WidgetEventFeed | Rich metadata/actions, safe navigation composition and explicit caller order/limits; no event store. | `web\src\features\automations\pages\AutomationActivityFeed.tsx:47-113`; `web\src\features\dashboard\widgets\ExportStatusWidget.tsx:166-224` |
| BulkActionsToolbar | Explicit member/loaded/filtered selection scope, unknown denominators and accessible disabled reasons; selection and mutations remain caller-owned. | `web\src\features\notifications\components\InboxBody.tsx:325-345,471-510`; `web\src\features\automations\pages\AutomationListPage.tsx:246-286` |
| PillFilterBar | Filter-button semantics distinct from document tabs, preserving existing controlled selection and genuine tab behavior. | `web\src\features\explore\pages\ExplorePage.tsx:279-323`; `web\src\features\dashboard\components\WidgetPicker.tsx:412-455` |
| WidgetGaugeHero | Preserve LinearGauge's nullable contract rather than inventing zero readings or scale maxima. Remains in the existing dashboard rendering family. | `web\src\features\dashboard\widgets\DrivingDynamicsWidget.tsx:190-218`; `web\src\features\dashboard\widgets\RegenEfficiencyWidget.tsx:62-123` |
| WidgetRankedList | Nullable magnitudes, explicit caller ordering and narrow-safe rich rows, preserving ranking/limit policy. Remains in the existing dashboard rendering family. | `web\src\features\dashboard\widgets\RouteEfficiencyWidget.tsx:58-121`; `web\src\features\dashboard\widgets\LocationFavoritesWidget.tsx:90-168` |

## Existing foundations and reuse

The original six foundations have existing source implementations: PageLayout,
StatStrip, ChartCard, DataTable/mobile presentation, SourceContent and
FormSection. Historical technical receipts are not current whole-library
acceptance evidence and do not remove the extension needs above. No tests,
builds, lint, previews, screenshots or commits were resumed for inventory work.

Reuse existing typography, surfaces, controls, tables, filters, overlays,
charts, gauges, source notices, statuses, provenance, timelines, playback,
maps, export/copy, disclosure, accessibility and mobile-gesture APIs.
No second theme, query, workspace-selection, status, unit-conversion, overlay,
table or chart engine is authorized by this inventory.

## Build and acceptance gate

Discovery and deduplication are complete. Implementation is authorized and active.
Each future contract needs one bounded owner, exclusive files, preserved
baseline, typed public API and focused tests. Parent owns category exports,
catalogs and integrated checks. Do not reassign retained ownership without
confirmed shutdown; do not restart expired tasks by renaming them.

Acceptance must preserve complete data, source order, every metric/series,
unknown versus real zero, independent retained sources, source-specific
recovery, preference IDs, exports, navigation and specialist explanations.
Validate narrow containers, long localized text, RTL, keyboard/touch access,
200% text, themes, forced colors and reduced motion. Source/unit tests are
not substitutes for real browser/native acceptance.

Finish the entire accepted shared source scope before consolidated technical
acceptance. Do not repeat full builds or visual checks per source handoff.
Page adoption stays paused until the library implementation and acceptance
gates are satisfied; completing this inventory does not satisfy those gates.
