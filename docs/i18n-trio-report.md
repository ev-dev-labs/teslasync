# i18n trio report

Worktree: `D:\repos\teslasync-i18n`; branch: `ui/i18n-trio`; starting commit: `bca2df7b44`.

## What the suites check

- `excluded-feature-owned-producers.test.ts`: exact English strings and interpolation for feature keys, availability in generated catalogs, and frozen source/translation-call contracts.
- `excluded-consistent-defaults.test.ts`: consistent English defaults, interpolation/count handling, generated resources, and preservation of older catalog entries.
- `resolved-baseline-producer.test.ts`: formerly missing keys resolve through the real loader; existing English/PWA strings and older catalog fingerprints remain intact.

These files import other test files, so some checks execute more than once. Counts below will distinguish executions from distinct checks. The untouched baseline is **7,183 passed / 489 failed / 0 skipped**, across **7,672 executions**. There are **167 distinct failing checks**. No catalog or test changes were made before this breakdown.


## Initial failures

| Type | Failed executions | Distinct checks | Example |
| --- | ---: | ---: | --- |
| Source fingerprints / translation-call projections | 453 | 151 | SchemaKpis expects 20 translation calls but now has 31. |
| Combined source-call contracts | 6 | 2 | BatteryDegradationPage no longer contains a previously frozen call; SchemaFingerprints no longer matches a frozen translator binding. |
| Frozen catalog structure / older-copy preservation | 11 | 5 | A predecessor-count check expects 30,996 leaves but finds 31,752; other checks stop at changed subscription copy. |
| Disk-compression wording conflict | 16 | 8 | Tests expect “Compressed”; both current source fallbacks and en.json say “After compression”. |
| Subscription wording conflict | 3 | 1 | Tests expect “Subscribed”; both current source and en.json say “Configured subscription”. |
| **Total** | **489** | **167** | |

By entry file: `excluded-consistent-defaults` has 164 failures, `excluded-feature-owned-producers` 161, and `resolved-baseline-producer` 164. Of the 151 source checks, 125 fail a source fingerprint, two fail a shell predecessor fingerprint, and 24 fail a call/binding shape or count. Shared test imports account for repeated executions; they have not been removed.

The catalog check separately fails because **usage-manifest.json is stale**. It reports zero known-missing keys. None of the 489 baseline failures reports a missing key or incorrect plural form. The frozen checks often stop at their first mismatch, so that does not prove later entries are correct.

## Safe repair group 1

Regenerated the English catalog artifacts from existing en.json/source. Only `web/src/i18n/en/usage-manifest.json` changed: it was missing the required-key entries `debugger.window.day`, `debugger.window.hours` and `debugger.window.minutes`. The catalog check now passes: 57 grouped bundles, 181 fallbacks, 1,265 shell keys, zero known-missing keys. No canonical catalog keys, English text, other languages or tests were changed. Completed within the 45-minute group limit.

The same three suites rerun at **7,183 passed / 489 failed / 0 skipped**. All 7,672 executions remain; no failing identity was added or removed. The manifest repair fixes the separate catalog gate, not any of the frozen-contract test failures. No full suite or unrelated tests were run.

## Decisions made

- The user selected the current catalog wording for all 23 conflicts. Updated the 21 canonical and two feature-owned fixture values; regenerated the canonical fixture digest from the resulting array using the existing SHA-256/JSON mechanism. Updated the flag-composition source fallback to the catalog wording. No catalog wording was reversed.
- Audited all 3,714 production TypeScript/TSX files (38,394 translation calls). Initial static audit found 239 distinct missing literal keys (282 call sites), 1,573 fallback differences, and 691 dynamic-key calls requiring further resolution. These are audit candidates, not 2,546 proven defects: explicit namespaces, plural variants, dynamic arguments and intentionally literal template examples need individual handling.
- Added 223 unambiguous missing English keys using the identical literal fallback already present in their callers. No other-language translations were invented. The repair script refuses conflicting defaults, scalar ancestors, missing defaults and plural/count cases. Regenerated the split catalog artifacts.
- Sixteen missing-key candidates remain for follow-up: six scalar-ancestor collisions and ten count/plural cases. No source fingerprint or catalog-history checkpoint has been updated: the required source verification is still incomplete.
- Added a reproducible AST audit/repair script at `web/scripts/i18n-trio-checkpoint.mjs`. Its default mode is read-only; `--repair-missing` applies only the conservative missing-key repair above. It does not approve or rewrite fingerprints.

### Verification after wording and missing-key group

Only the requested three suites were run: **7,202 passed / 470 failed / 0 skipped**, still 7,672 executions. **19 failing executions closed; zero new failing identities** compared with the original baseline. Catalog split check: **PASS**, 57 grouped bundles, 181 fallbacks, 1,265 shell keys, zero known-missing manifest keys. No tests were weakened, skipped or deleted. The original 151 source checks and two combined contracts remain pending verification.

## Original decisions requested (resolved by the user)

1. **Disk-compression wording:** retain the current “After compression” and approve corresponding historical-test changes, or restore “Compressed” in source and catalog. Current code and tests disagree, so no wording change is authorized here. Affects `admin.diskForecast.compressed` and `admin.diskForecast.fleetCompressed`.
2. **Subscription wording:** retain “Configured subscription” and approve historical-test changes, or restore “Subscribed” in source and catalog. Affects `coverage.col.subscribed`. The older wording can imply a confirmed live subscription, so this is a product choice.
3. **151 frozen source checks plus two combined source contracts:** review the modernization changes and approve a precise new contract, or restore the original source behavior. Replacing hashes/call counts merely to pass would accept changes without review. Counts and examples are above; the affected source inventory is below.
4. **Five catalog-history checks:** approve a reviewed list of newer additions/copy changes and a new historical checkpoint, or restore the original catalog state. Blindly changing leaf counts/hashes or deleting newer keys would weaken the checks or remove potentially used translations. Some of these checks currently stop at the subscription wording conflict.

5. **Twenty additional copy conflicts hidden behind earlier failures:** the full static key/value fixtures reveal 23 distinct disagreements in total, with no missing keys. The table below shows both options. For 22, the current code fallback agrees with the current catalog, not the historical fixture. For the flag-composition label, the fallback still agrees with the old fixture while the catalog was deliberately changed in `04ff8973d7`; decide whether to retain the newer presentation/storage distinction or restore the original type-composition label. No automatic wording reversal was made.


<details>
<summary>All 23 English wording decisions</summary>

For each key, the choices are: retain the current catalog wording and review/update the historical contract (and any stale source fallback), or restore the historical wording consistently in source and catalog. The latter can reintroduce claims about polling, quota configuration, original battery range or observed ingestion; review the relevant behavior first. This task does not select either option.

| Key | Historical test text | Current catalog text | Current source |
| --- | --- | --- | --- |
| `coverage.col.subscribed` | Subscribed | Configured subscription | [CoverageCategory.tsx](../web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx#L65) |
| `admin.flags.composition.ariaLabel` | Flag value-type composition | Returned flag value presentation; stored values are text | [FlagCompositionPanel.tsx](../web/src/features/admin/components/feature-flags/FlagCompositionPanel.tsx#L108) |
| `admin.gdprExport.lookupHint` | IDs come from the GDPR export queue email or the request response. The artifact polls while queued/running. | Enter an artifact ID to look up its saved metadata. Use Refresh to request an updated snapshot; this page does not poll automatically. | [GDPRLookupPanel.tsx](../web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx#L56) |
| `admin.gdprExport.lookupBlurb` | Bundles are streamed straight from the backend and expire after the configured retention window. Look one up to track its status live. | Lookup and Refresh only read artifact metadata; they do not create exports or download bundles. Bundles expire after the configured retention window. A saved manifest does not confirm current download availability or storage support. | [GDPRLookupPanel.tsx](../web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx#L66) |
| `admin.diskForecast.percentSub` | {{pct}} of total | Compressed chunks only; not a share of current disk usage. | [DiskForecastSummary.tsx](../web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx#L30) |
| `admin.diskForecast.fleetUncompressed` | Uncompressed | Before compression | [DiskForecastSummary.tsx](../web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx#L36) |
| `admin.diskForecast.noQuota` | No quota configured | No quota estimate available | [DiskForecastSummary.tsx](../web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx#L52) |
| `admin.diskForecast.colSplit` | Uncompressed / compressed | Before / after compression | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L199) |
| `admin.diskForecast.compressedSuffix` | compressed | after compression | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L205) |
| `admin.diskForecast.subtitle` | Per-hypertable disk usage with compressed/uncompressed split and days-to-quota estimate. Severity reflects the configured quota threshold. | Current per-hypertable disk usage, before/after compression sizes for compressed chunks, and source-supplied days-to-quota estimates. Compression sizes are not additive parts of current disk usage. | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L257) |
| `admin.diskForecast.composition` | Storage composition | Compression size comparison | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L298) |
| `admin.diskForecast.compositionTitle` | Compressed vs uncompressed | Before vs after compression | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L302) |
| `admin.diskForecast.compositionAria` | Stacked bar chart of the largest hypertables split by uncompressed and compressed bytes | Grouped bar chart comparing before and after compression sizes of compressed chunks in the largest hypertables | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L306) |
| `admin.diskForecast.uncompressed` | Uncompressed | Before compression | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L317) |
| `admin.diskForecast.noQuotaTitle` | No quota configured | No quota estimate available | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L466) |
| `admin.diskForecast.noQuotaMessage` | Set HYPERTABLE_QUOTA_BYTES to surface a days-to-quota estimate for each hypertable. | An estimate may be absent when there is no measurable growth. Missing estimates do not establish whether a quota is configured. | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L467) |
| `coverage.subtitle` | Package-derived snapshot of which Tesla proto fields the build routes and which the current subscription pushes. Sourced from routing.yaml and teslaconfig.Builder — no per-vehicle telemetry counts. | Package-derived snapshot of routed Tesla proto fields and configured desired subscription membership. Sourced from routing.yaml and teslaconfig.Builder — not confirmation of observed vehicle ingestion. | [FleetTelemetryCoveragePage.tsx](../web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx#L127) |
| `coverage.legend.subscribedLabel` | Subscribed | Configured subscription | [FleetTelemetryCoveragePage.tsx](../web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx#L263) |
| `coverage.legend.subscribedHelp` | — whether Tesla Fleet Telemetry is currently pushing this field to us. "No" means the writer is wired but the subscription request omits the field. | — whether the field belongs to the configured desired subscription. "Yes" does not confirm observed vehicle ingestion. "No" means the field is routed but omitted from the desired subscription request. | [FleetTelemetryCoveragePage.tsx](../web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx#L266) |
| `battery.degradation.rangeLossAria` | Original and current estimated driving range over time | First retained comparison baseline and estimated driving range over time | [BatteryDegradationPage.tsx](../web/src/features/battery/pages/BatteryDegradationPage.tsx#L669) |
| `driveDetail.fsd.loadFailedBody` | The rest of this drive remains available. Retry the page to load the cumulative-counter evidence. | The rest of this drive remains available. Retry supervised-driving evidence independently. | [SupervisedDrivingPanel.tsx](../web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx#L59) |
| `admin.diskForecast.fleetCompressed` | Compressed | After compression | [DiskForecastSummary.tsx](../web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx#L39) |
| `admin.diskForecast.compressed` | Compressed | After compression | [DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx#L318) |

</details>

<details>
<summary>151 source files requiring reviewed contract decisions</summary>

For each file: approve a reviewed modernization contract that preserves its intended translation behavior, or restore the original behavior. These are not missing-key repairs. The existing test identifies the expected fingerprint or exact binding/call contract; no fingerprint or expectation was changed.

- [web/src/components/ai/AIDigestNarration.tsx](../web/src/components/ai/AIDigestNarration.tsx) — source fingerprint.
- [web/src/components/ai/AINLDashboardComposer.tsx](../web/src/components/ai/AINLDashboardComposer.tsx) — source fingerprint.
- [web/src/components/ai/AINLSearch.tsx](../web/src/components/ai/AINLSearch.tsx) — source fingerprint.
- [web/src/components/ai/AINLSqlPlayground.tsx](../web/src/components/ai/AINLSqlPlayground.tsx) — source fingerprint.
- [web/src/components/ai/AiOutputPanel.tsx](../web/src/components/ai/AiOutputPanel.tsx) — source fingerprint.
- [web/src/components/data-display/ServiceStatus.tsx](../web/src/components/data-display/ServiceStatus.tsx) — source fingerprint.
- [web/src/components/feedback/ProblemReportModal.tsx](../web/src/components/feedback/ProblemReportModal.tsx) — source fingerprint.
- [web/src/components/feedback/RuntimeHealthBanner.tsx](../web/src/components/feedback/RuntimeHealthBanner.tsx) — source fingerprint.
- [web/src/components/layout/Layout.tsx](../web/src/components/layout/Layout.tsx) — shell predecessor fingerprint.
- [web/src/components/layout/WorkspaceContextControl.tsx](../web/src/components/layout/WorkspaceContextControl.tsx) — source fingerprint.
- [web/src/components/ui/CommandPalette.tsx](../web/src/components/ui/CommandPalette.tsx) — shell predecessor fingerprint.
- [web/src/features/admin/components/ResponseViewer.tsx](../web/src/features/admin/components/ResponseViewer.tsx) — source fingerprint.
- [web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx](../web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx) — translation-call/binding contract.
- [web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx](../web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx) — translation-call/binding contract.
- [web/src/features/admin/components/continuation-admin-2/AuditExpandedDetail.tsx](../web/src/features/admin/components/continuation-admin-2/AuditExpandedDetail.tsx) — translation-call/binding contract.
- [web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx](../web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx) — source fingerprint.
- [web/src/features/admin/components/devtools/BackendTool.tsx](../web/src/features/admin/components/devtools/BackendTool.tsx) — source fingerprint.
- [web/src/features/admin/components/devtools/InfrastructureSection.tsx](../web/src/features/admin/components/devtools/InfrastructureSection.tsx) — source fingerprint.
- [web/src/features/admin/components/gdpr-export/GDPRArtifactDetails.tsx](../web/src/features/admin/components/gdpr-export/GDPRArtifactDetails.tsx) — source fingerprint.
- [web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx](../web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx) — source fingerprint.
- [web/src/features/admin/components/gdpr-export/GDPRLifecyclePanel.tsx](../web/src/features/admin/components/gdpr-export/GDPRLifecyclePanel.tsx) — source fingerprint.
- [web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx](../web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx) — source fingerprint.
- [web/src/features/admin/components/security-access/EventTimeline.tsx](../web/src/features/admin/components/security-access/EventTimeline.tsx) — source fingerprint.
- [web/src/features/admin/components/security-access/SecurityStatusCards.tsx](../web/src/features/admin/components/security-access/SecurityStatusCards.tsx) — source fingerprint.
- [web/src/features/admin/components/statstrip-api-quality/ApiLogsSummary.tsx](../web/src/features/admin/components/statstrip-api-quality/ApiLogsSummary.tsx) — translation-call/binding contract.
- [web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx](../web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx) — translation-call/binding contract.
- [web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx](../web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx) — source fingerprint.
- [web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx](../web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx) — source fingerprint.
- [web/src/features/admin/components/structural-closure/audit-log/AuditLogFilters.tsx](../web/src/features/admin/components/structural-closure/audit-log/AuditLogFilters.tsx) — source fingerprint.
- [web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx](../web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx) — source fingerprint.
- [web/src/features/admin/components/structural-closure/audit-log/auditLogColumns.tsx](../web/src/features/admin/components/structural-closure/audit-log/auditLogColumns.tsx) — source fingerprint.
- [web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx](../web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx) — source fingerprint.
- [web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx](../web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx) — source fingerprint.
- [web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx](../web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx) — source fingerprint.
- [web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx](../web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx) — source fingerprint.
- [web/src/features/admin/components/vehicle-cost/VehicleCostToolbar.tsx](../web/src/features/admin/components/vehicle-cost/VehicleCostToolbar.tsx) — source fingerprint.
- [web/src/features/admin/hooks/useAuditLogPage.ts](../web/src/features/admin/hooks/useAuditLogPage.ts) — source fingerprint.
- [web/src/features/admin/hooks/useSecretRotationPage.ts](../web/src/features/admin/hooks/useSecretRotationPage.ts) — source fingerprint.
- [web/src/features/admin/hooks/useSlowQueriesPage.ts](../web/src/features/admin/hooks/useSlowQueriesPage.ts) — source fingerprint.
- [web/src/features/admin/pages/ApiPlaygroundPage.tsx](../web/src/features/admin/pages/ApiPlaygroundPage.tsx) — translation-call/binding contract.
- [web/src/features/admin/pages/AuditLogPage.tsx](../web/src/features/admin/pages/AuditLogPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/BackupRestorePage.tsx](../web/src/features/admin/pages/BackupRestorePage.tsx) — source fingerprint.
- [web/src/features/admin/pages/DataQualityPage.tsx](../web/src/features/admin/pages/DataQualityPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/DevToolsPage.tsx](../web/src/features/admin/pages/DevToolsPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/DiskForecastPage.tsx](../web/src/features/admin/pages/DiskForecastPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx](../web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx) — source fingerprint.
- [web/src/features/admin/pages/GDPRExportPage.tsx](../web/src/features/admin/pages/GDPRExportPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/RedisSignalViewerPage.tsx](../web/src/features/admin/pages/RedisSignalViewerPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/SecretRotationPage.tsx](../web/src/features/admin/pages/SecretRotationPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/SlowQueriesPage.tsx](../web/src/features/admin/pages/SlowQueriesPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/UsersPage.tsx](../web/src/features/admin/pages/UsersPage.tsx) — source fingerprint.
- [web/src/features/admin/pages/VehicleCostPage.tsx](../web/src/features/admin/pages/VehicleCostPage.tsx) — source fingerprint.
- [web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx](../web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx) — translation-call/binding contract.
- [web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx](../web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx) — translation-call/binding contract.
- [web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx](../web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx) — translation-call/binding contract.
- [web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx](../web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx) — translation-call/binding contract.
- [web/src/features/analytics/components/true-cost-modernization/TrueCostLedgerColumns.tsx](../web/src/features/analytics/components/true-cost-modernization/TrueCostLedgerColumns.tsx) — source fingerprint.
- [web/src/features/analytics/pages/PeriodComparePage.tsx](../web/src/features/analytics/pages/PeriodComparePage.tsx) — source fingerprint.
- [web/src/features/analytics/pages/YearReviewPage.tsx](../web/src/features/analytics/pages/YearReviewPage.tsx) — source fingerprint.
- [web/src/features/automations/components/RoutineWizard.tsx](../web/src/features/automations/components/RoutineWizard.tsx) — source fingerprint.
- [web/src/features/automations/pages/AutomationListTable.tsx](../web/src/features/automations/pages/AutomationListTable.tsx) — source fingerprint.
- [web/src/features/automations/pages/AutomationStatusPanel.tsx](../web/src/features/automations/pages/AutomationStatusPanel.tsx) — source fingerprint.
- [web/src/features/battery/components/energy-products-modernization/CapBadge.tsx](../web/src/features/battery/components/energy-products-modernization/CapBadge.tsx) — source fingerprint.
- [web/src/features/battery/pages/BatteryCellsPage.tsx](../web/src/features/battery/pages/BatteryCellsPage.tsx) — source fingerprint.
- [web/src/features/battery/pages/BatteryDegradationPage.tsx](../web/src/features/battery/pages/BatteryDegradationPage.tsx) — source fingerprint.
- [web/src/features/charging/components/charging-list/ChargingInsights.tsx](../web/src/features/charging/components/charging-list/ChargingInsights.tsx) — translation-call/binding contract.
- [web/src/features/charging/pages/ChargingCurvePage.tsx](../web/src/features/charging/pages/ChargingCurvePage.tsx) — source fingerprint.
- [web/src/features/dashboard/components/RecentActivity.tsx](../web/src/features/dashboard/components/RecentActivity.tsx) — source fingerprint.
- [web/src/features/dashboard/components/VehicleHero.tsx](../web/src/features/dashboard/components/VehicleHero.tsx) — source fingerprint.
- [web/src/features/dashboard/components/operationalbrief-all/DashboardSourceBrief.tsx](../web/src/features/dashboard/components/operationalbrief-all/DashboardSourceBrief.tsx) — source fingerprint.
- [web/src/features/dashboard/pages/DashboardPage.tsx](../web/src/features/dashboard/pages/DashboardPage.tsx) — source fingerprint.
- [web/src/features/dashboard/pages/QuickStatsPage.tsx](../web/src/features/dashboard/pages/QuickStatsPage.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx](../web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/AnomalyDetectorWidget.tsx](../web/src/features/dashboard/widgets/AnomalyDetectorWidget.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/AutomationStatusWidget.tsx](../web/src/features/dashboard/widgets/AutomationStatusWidget.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/BackupMonitorWidget.tsx](../web/src/features/dashboard/widgets/BackupMonitorWidget.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/DestinationETAWidget.tsx](../web/src/features/dashboard/widgets/DestinationETAWidget.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/NotificationStatsWidget.tsx](../web/src/features/dashboard/widgets/NotificationStatsWidget.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/SignalLogWidget.tsx](../web/src/features/dashboard/widgets/SignalLogWidget.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx](../web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx) — source fingerprint.
- [web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx](../web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx) — source fingerprint.
- [web/src/features/driving/components/DriveCard.tsx](../web/src/features/driving/components/DriveCard.tsx) — source fingerprint.
- [web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx](../web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx) — source fingerprint.
- [web/src/features/driving/components/drivetrain-health-modernization/MethodologyPanel.tsx](../web/src/features/driving/components/drivetrain-health-modernization/MethodologyPanel.tsx) — translation-call/binding contract.
- [web/src/features/driving/components/driving-dynamics-modernization/LiveMotorStatus.tsx](../web/src/features/driving/components/driving-dynamics-modernization/LiveMotorStatus.tsx) — translation-call/binding contract.
- [web/src/features/driving/components/operationalbrief-a-m/ArrivalEvidenceBrief.tsx](../web/src/features/driving/components/operationalbrief-a-m/ArrivalEvidenceBrief.tsx) — translation-call/binding contract.
- [web/src/features/driving/components/operationalbrief-a-m/DepartureEvidenceBrief.tsx](../web/src/features/driving/components/operationalbrief-a-m/DepartureEvidenceBrief.tsx) — translation-call/binding contract.
- [web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx](../web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx) — source fingerprint.
- [web/src/features/driving/components/operationalbrief-a-m/EfficiencyEvidenceBrief.tsx](../web/src/features/driving/components/operationalbrief-a-m/EfficiencyEvidenceBrief.tsx) — translation-call/binding contract.
- [web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx](../web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx) — translation-call/binding contract.
- [web/src/features/driving/components/score-orchestrator/ScoreHeroSection.tsx](../web/src/features/driving/components/score-orchestrator/ScoreHeroSection.tsx) — translation-call/binding contract.
- [web/src/features/driving/pages/DriveDetailPage.tsx](../web/src/features/driving/pages/DriveDetailPage.tsx) — translation-call/binding contract.
- [web/src/features/driving/pages/DriveScorePage.tsx](../web/src/features/driving/pages/DriveScorePage.tsx) — translation-call/binding contract.
- [web/src/features/driving/pages/DrivingDynamicsPage.tsx](../web/src/features/driving/pages/DrivingDynamicsPage.tsx) — source fingerprint.
- [web/src/features/notifications/components/BrowserTabSignalsPanel.tsx](../web/src/features/notifications/components/BrowserTabSignalsPanel.tsx) — source fingerprint.
- [web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx](../web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx) — source fingerprint.
- [web/src/features/notifications/components/NotificationInboxDetails.tsx](../web/src/features/notifications/components/NotificationInboxDetails.tsx) — source fingerprint.
- [web/src/features/notifications/components/NotificationInboxTable.tsx](../web/src/features/notifications/components/NotificationInboxTable.tsx) — source fingerprint.
- [web/src/features/notifications/components/channels/ChannelCard.tsx](../web/src/features/notifications/components/channels/ChannelCard.tsx) — source fingerprint.
- [web/src/features/notifications/components/channels/ChannelProvidersPanel.tsx](../web/src/features/notifications/components/channels/ChannelProvidersPanel.tsx) — source fingerprint.
- [web/src/features/notifications/components/channels/ChannelsGrid.tsx](../web/src/features/notifications/components/channels/ChannelsGrid.tsx) — source fingerprint.
- [web/src/features/notifications/pages/AuditLogPage.tsx](../web/src/features/notifications/pages/AuditLogPage.tsx) — source fingerprint.
- [web/src/features/notifications/pages/ChannelsPage.tsx](../web/src/features/notifications/pages/ChannelsPage.tsx) — source fingerprint.
- [web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx](../web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx) — source fingerprint.
- [web/src/features/onboarding/components/Stepper.tsx](../web/src/features/onboarding/components/Stepper.tsx) — source fingerprint.
- [web/src/features/power-user/pages/DashboardsPage.tsx](../web/src/features/power-user/pages/DashboardsPage.tsx) — source fingerprint.
- [web/src/features/power-user/pages/SqlPlaygroundPage.tsx](../web/src/features/power-user/pages/SqlPlaygroundPage.tsx) — source fingerprint.
- [web/src/features/service-intelligence/components/WarrantyPanel.tsx](../web/src/features/service-intelligence/components/WarrantyPanel.tsx) — source fingerprint.
- [web/src/features/settings/components/FeatureToggles.tsx](../web/src/features/settings/components/FeatureToggles.tsx) — source fingerprint.
- [web/src/features/settings/components/QuietHoursPanel.tsx](../web/src/features/settings/components/QuietHoursPanel.tsx) — source fingerprint.
- [web/src/features/settings/components/RegionSettings.tsx](../web/src/features/settings/components/RegionSettings.tsx) — source fingerprint.
- [web/src/features/settings/components/SettingsExportImport.tsx](../web/src/features/settings/components/SettingsExportImport.tsx) — source fingerprint.
- [web/src/features/settings/components/TOTPEnrollmentSection.tsx](../web/src/features/settings/components/TOTPEnrollmentSection.tsx) — source fingerprint.
- [web/src/features/settings/components/TeslaAccountSection.tsx](../web/src/features/settings/components/TeslaAccountSection.tsx) — source fingerprint.
- [web/src/features/settings/components/fleet-setup/FleetSetupProgress.tsx](../web/src/features/settings/components/fleet-setup/FleetSetupProgress.tsx) — source fingerprint.
- [web/src/features/settings/components/fleet-setup/FleetSetupStreamingPanel.tsx](../web/src/features/settings/components/fleet-setup/FleetSetupStreamingPanel.tsx) — source fingerprint.
- [web/src/features/settings/components/fleet-setup/FleetSetupSubscribePanel.tsx](../web/src/features/settings/components/fleet-setup/FleetSetupSubscribePanel.tsx) — source fingerprint.
- [web/src/features/settings/components/sessions/SessionsTable.tsx](../web/src/features/settings/components/sessions/SessionsTable.tsx) — source fingerprint.
- [web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx](../web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx) — translation-call/binding contract.
- [web/src/features/settings/components/twofactor/TotpBackupCodesModal.tsx](../web/src/features/settings/components/twofactor/TotpBackupCodesModal.tsx) — source fingerprint.
- [web/src/features/settings/components/twofactor/TotpStatusHero.tsx](../web/src/features/settings/components/twofactor/TotpStatusHero.tsx) — source fingerprint.
- [web/src/features/settings/components/twofactor/useTotpEnrollmentFlow.ts](../web/src/features/settings/components/twofactor/useTotpEnrollmentFlow.ts) — source fingerprint.
- [web/src/features/settings/pages/PrivacyPage.tsx](../web/src/features/settings/pages/PrivacyPage.tsx) — source fingerprint.
- [web/src/features/sharing/pages/SharedSessionReport.tsx](../web/src/features/sharing/pages/SharedSessionReport.tsx) — source fingerprint.
- [web/src/features/system/components/FSMSubFSMPanel.tsx](../web/src/features/system/components/FSMSubFSMPanel.tsx) — source fingerprint.
- [web/src/features/system/components/chatbot/ChatMessageItem.tsx](../web/src/features/system/components/chatbot/ChatMessageItem.tsx) — source fingerprint.
- [web/src/features/system/components/command-center/CommandWorkspace.tsx](../web/src/features/system/components/command-center/CommandWorkspace.tsx) — source fingerprint.
- [web/src/features/system/components/help-index/HelpSearch.tsx](../web/src/features/system/components/help-index/HelpSearch.tsx) — source fingerprint.
- [web/src/features/system/components/help-index/SupportBundlePanel.tsx](../web/src/features/system/components/help-index/SupportBundlePanel.tsx) — source fingerprint.
- [web/src/features/system/components/operationalbrief-all/SystemSummaryBrief.tsx](../web/src/features/system/components/operationalbrief-all/SystemSummaryBrief.tsx) — source fingerprint.
- [web/src/features/system/components/state-machine/LiveControls.tsx](../web/src/features/system/components/state-machine/LiveControls.tsx) — source fingerprint.
- [web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx](../web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx) — translation-call/binding contract.
- [web/src/features/system/components/status/AiSpendWatch.tsx](../web/src/features/system/components/status/AiSpendWatch.tsx) — source fingerprint.
- [web/src/features/system/pages/CommandHistoryPage.tsx](../web/src/features/system/pages/CommandHistoryPage.tsx) — translation-call/binding contract.
- [web/src/features/system/pages/CommandReliabilityPage.tsx](../web/src/features/system/pages/CommandReliabilityPage.tsx) — source fingerprint.
- [web/src/features/system/pages/DataExportPage.tsx](../web/src/features/system/pages/DataExportPage.tsx) — source fingerprint.
- [web/src/features/system/pages/OutageAutobiographyPage.tsx](../web/src/features/system/pages/OutageAutobiographyPage.tsx) — source fingerprint.
- [web/src/features/system/pages/ScheduledExportsPanel.tsx](../web/src/features/system/pages/ScheduledExportsPanel.tsx) — source fingerprint.
- [web/src/features/system/pages/SearchPage.tsx](../web/src/features/system/pages/SearchPage.tsx) — source fingerprint.
- [web/src/features/system/pages/StateMachineDebuggerPage.tsx](../web/src/features/system/pages/StateMachineDebuggerPage.tsx) — source fingerprint.
- [web/src/features/telemetry/components/SignalCompareControls.tsx](../web/src/features/telemetry/components/SignalCompareControls.tsx) — source fingerprint.
- [web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx](../web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx) — translation-call/binding contract.
- [web/src/features/telemetry/pages/MQTTInspectorPage.tsx](../web/src/features/telemetry/pages/MQTTInspectorPage.tsx) — source fingerprint.
- [web/src/features/telemetry/pages/SignalCorrelationPage.tsx](../web/src/features/telemetry/pages/SignalCorrelationPage.tsx) — source fingerprint.
- [web/src/features/telemetry/pages/SignalExplorerPage.tsx](../web/src/features/telemetry/pages/SignalExplorerPage.tsx) — source fingerprint.
- [web/src/features/telemetry/pages/SignalLogViewerPage.tsx](../web/src/features/telemetry/pages/SignalLogViewerPage.tsx) — source fingerprint.
- [web/src/features/telemetry/pages/SignalsWorkspacePage.tsx](../web/src/features/telemetry/pages/SignalsWorkspacePage.tsx) — source fingerprint.
- [web/src/features/trips/components/ArrivalPanel.tsx](../web/src/features/trips/components/ArrivalPanel.tsx) — source fingerprint.
- [web/src/features/trips/components/LiveTripPanel.tsx](../web/src/features/trips/components/LiveTripPanel.tsx) — source fingerprint.
- [web/src/features/trips/components/TripReplayMap.tsx](../web/src/features/trips/components/TripReplayMap.tsx) — source fingerprint.
- [web/src/features/vehicles/components/vehicle-management/ManagementEndpointBody.tsx](../web/src/features/vehicles/components/vehicle-management/ManagementEndpointBody.tsx) — source fingerprint.

The two combined source checks additionally stop at BatteryDegradationPage's removed frozen call and SchemaFingerprints' translator namespace/binding. Their complete fixture lists remain in `authorized-owner-recovery.test.ts` and `authorized-canonical-recovery.test.ts`; approving one first mismatch does not automatically approve later entries.

</details>

## Final result

- **Fixed:** one failing catalog-generation gate, by restoring three generated required-key references. **0 of the 489 failing test executions resolved.**
- **Remaining:** **489 failing executions / 167 distinct checks**; **zero new failing identities**. Catalog check passes.
- **Decisions needed:** choose the intended English text for the 23 listed keys; approve or reject the 151 source-file changes and two combined source contracts; establish the reviewed additions/copy policy for the five frozen catalog-history checks.

## Verified source checkpoint group

Verified 90 of the 151 failing source files: every literal t() key resolves to an English string (or complete one/other forms), every literal/defaultValue fallback matches, plural bases supply count, and every catalog interpolation variable has an explicit option. Dynamic keys/defaults and indirect interpolation operands are conservatively refused pending review. The script refuses to checkpoint an input list if any file fails verification.

For these files, the existing per-file checks now pin the full current source SHA-256 and real translation-call count before the historical restoration adapters run. This is stricter than the AST-only projection for changed presentation. The original 291 source cases, 75 historical projections and mutation-rejection assertions remain. The 61 unverified files retain their existing assertions. Neither combined source contract nor any catalog-history check has been updated.

Trio results: **7,472 passed / 200 failed / 0 skipped**, 7,672 executions; **270 further failing executions closed, zero new failing identities**. Total closures since baseline: **289**. Catalog split check: **PASS**, with zero known-missing manifest keys.

<details>
<summary>Per-file verification: 90 approved checkpoints</summary>

| File | Calls | Keys/defaults/interpolation/count |
| --- | ---: | --- |
| `web/src/components/ai/AIDigestNarration.tsx` | 7 | Passed |
| `web/src/components/ai/AINLDashboardComposer.tsx` | 8 | Passed |
| `web/src/components/ai/AINLSearch.tsx` | 8 | Passed |
| `web/src/components/ai/AINLSqlPlayground.tsx` | 13 | Passed |
| `web/src/components/ai/AiOutputPanel.tsx` | 11 | Passed |
| `web/src/components/data-display/ServiceStatus.tsx` | 3 | Passed |
| `web/src/components/feedback/ProblemReportModal.tsx` | 25 | Passed |
| `web/src/features/admin/components/ResponseViewer.tsx` | 8 | Passed |
| `web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx` | 16 | Passed |
| `web/src/features/admin/components/continuation-admin-2/AuditExpandedDetail.tsx` | 14 | Passed |
| `web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx` | 13 | Passed |
| `web/src/features/admin/components/devtools/BackendTool.tsx` | 4 | Passed |
| `web/src/features/admin/components/devtools/InfrastructureSection.tsx` | 15 | Passed |
| `web/src/features/admin/components/gdpr-export/GDPRArtifactDetails.tsx` | 15 | Passed |
| `web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx` | 8 | Passed |
| `web/src/features/admin/components/gdpr-export/GDPRLifecyclePanel.tsx` | 6 | Passed |
| `web/src/features/admin/components/statstrip-api-quality/ApiLogsSummary.tsx` | 20 | Passed |
| `web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx` | 9 | Passed |
| `web/src/features/admin/components/structural-closure/audit-log/AuditLogFilters.tsx` | 13 | Passed |
| `web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx` | 23 | Passed |
| `web/src/features/admin/components/structural-closure/audit-log/auditLogColumns.tsx` | 10 | Passed |
| `web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx` | 15 | Passed |
| `web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx` | 13 | Passed |
| `web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx` | 12 | Passed |
| `web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx` | 15 | Passed |
| `web/src/features/admin/hooks/useAuditLogPage.ts` | 3 | Passed |
| `web/src/features/admin/pages/AuditLogPage.tsx` | 11 | Passed |
| `web/src/features/admin/pages/DataQualityPage.tsx` | 6 | Passed |
| `web/src/features/admin/pages/DevToolsPage.tsx` | 17 | Passed |
| `web/src/features/admin/pages/DiskForecastPage.tsx` | 52 | Passed |
| `web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx` | 31 | Passed |
| `web/src/features/admin/pages/GDPRExportPage.tsx` | 30 | Passed |
| `web/src/features/admin/pages/SecretRotationPage.tsx` | 7 | Passed |
| `web/src/features/admin/pages/UsersPage.tsx` | 13 | Passed |
| `web/src/features/admin/pages/VehicleCostPage.tsx` | 8 | Passed |
| `web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx` | 22 | Passed |
| `web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx` | 28 | Passed |
| `web/src/features/analytics/components/true-cost-modernization/TrueCostLedgerColumns.tsx` | 5 | Passed |
| `web/src/features/analytics/pages/PeriodComparePage.tsx` | 77 | Passed |
| `web/src/features/automations/pages/AutomationListTable.tsx` | 35 | Passed |
| `web/src/features/automations/pages/AutomationStatusPanel.tsx` | 9 | Passed |
| `web/src/features/battery/components/energy-products-modernization/CapBadge.tsx` | 2 | Passed |
| `web/src/features/battery/pages/BatteryCellsPage.tsx` | 109 | Passed |
| `web/src/features/charging/components/charging-list/ChargingInsights.tsx` | 19 | Passed |
| `web/src/features/dashboard/components/operationalbrief-all/DashboardSourceBrief.tsx` | 6 | Passed |
| `web/src/features/dashboard/pages/QuickStatsPage.tsx` | 38 | Passed |
| `web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx` | 18 | Passed |
| `web/src/features/dashboard/widgets/AutomationStatusWidget.tsx` | 25 | Passed |
| `web/src/features/dashboard/widgets/BackupMonitorWidget.tsx` | 17 | Passed |
| `web/src/features/dashboard/widgets/DestinationETAWidget.tsx` | 14 | Passed |
| `web/src/features/dashboard/widgets/NotificationStatsWidget.tsx` | 28 | Passed |
| `web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx` | 5 | Passed |
| `web/src/features/driving/components/DriveCard.tsx` | 13 | Passed |
| `web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx` | 28 | Passed |
| `web/src/features/driving/components/drivetrain-health-modernization/MethodologyPanel.tsx` | 20 | Passed |
| `web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx` | 22 | Passed |
| `web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx` | 31 | Passed |
| `web/src/features/notifications/components/BrowserTabSignalsPanel.tsx` | 13 | Passed |
| `web/src/features/notifications/components/NotificationInboxDetails.tsx` | 19 | Passed |
| `web/src/features/notifications/components/channels/ChannelCard.tsx` | 21 | Passed |
| `web/src/features/notifications/pages/AuditLogPage.tsx` | 23 | Passed |
| `web/src/features/notifications/pages/ChannelsPage.tsx` | 13 | Passed |
| `web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx` | 8 | Passed |
| `web/src/features/onboarding/components/Stepper.tsx` | 6 | Passed |
| `web/src/features/power-user/pages/SqlPlaygroundPage.tsx` | 20 | Passed |
| `web/src/features/service-intelligence/components/WarrantyPanel.tsx` | 10 | Passed |
| `web/src/features/settings/components/TOTPEnrollmentSection.tsx` | 11 | Passed |
| `web/src/features/settings/components/TeslaAccountSection.tsx` | 26 | Passed |
| `web/src/features/settings/components/fleet-setup/FleetSetupStreamingPanel.tsx` | 15 | Passed |
| `web/src/features/settings/components/fleet-setup/FleetSetupSubscribePanel.tsx` | 45 | Passed |
| `web/src/features/settings/components/sessions/SessionsTable.tsx` | 11 | Passed |
| `web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx` | 24 | Passed |
| `web/src/features/settings/components/twofactor/TotpBackupCodesModal.tsx` | 6 | Passed |
| `web/src/features/settings/components/twofactor/TotpStatusHero.tsx` | 12 | Passed |
| `web/src/features/settings/components/twofactor/useTotpEnrollmentFlow.ts` | 7 | Passed |
| `web/src/features/settings/pages/PrivacyPage.tsx` | 6 | Passed |
| `web/src/features/sharing/pages/SharedSessionReport.tsx` | 12 | Passed |
| `web/src/features/system/components/FSMSubFSMPanel.tsx` | 6 | Passed |
| `web/src/features/system/components/chatbot/ChatMessageItem.tsx` | 12 | Passed |
| `web/src/features/system/components/operationalbrief-all/SystemSummaryBrief.tsx` | 6 | Passed |
| `web/src/features/system/components/state-machine/LiveControls.tsx` | 15 | Passed |
| `web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx` | 18 | Passed |
| `web/src/features/system/components/status/AiSpendWatch.tsx` | 17 | Passed |
| `web/src/features/system/pages/OutageAutobiographyPage.tsx` | 42 | Passed |
| `web/src/features/system/pages/SearchPage.tsx` | 6 | Passed |
| `web/src/features/telemetry/pages/SignalCorrelationPage.tsx` | 54 | Passed |
| `web/src/features/telemetry/pages/SignalExplorerPage.tsx` | 51 | Passed |
| `web/src/features/telemetry/pages/SignalLogViewerPage.tsx` | 18 | Passed |
| `web/src/features/trips/components/TripReplayMap.tsx` | 6 | Passed |
| `web/src/features/vehicles/components/vehicle-management/ManagementEndpointBody.tsx` | 20 | Passed |

The exact full-source digests are recorded in `web/src/i18n/verified-producer-checkpoints.json`.
</details>
