# Frontend modernization queue

Latest phased user directive is active. Re-read this file before every decision.
Orchestrator owns audit, dispatch, health, gates, integration metadata and commits; never UI implementation.
Maximum 32 live workers. One bounded item each. Two attempts maximum.
Workers never run Git. Scoped sequential commits only; no push or deploy; no hook bypass.
Heartbeats: `.agent-status\<item-id>.txt`, every three minutes. Health every five minutes.
Stuck: no heartbeat for ten minutes, runtime over 25 minutes, or same step three times.
Restore only verified worker-owned uncommitted deltas; never erase inherited work.
Source release is not runtime/visual acceptance. Existing migrations are preserved, not restarted.

## Baseline and decisions

- Baseline user-saved HEAD: `a2b106dd78`; clean worktree.
- Initial checkpoint: `e7ae82d9dc` (`checkpoint: before modernization`).
- Root `docs` and root queue remain canonical; `web` is the frontend package.
- Missing mission restored byte-for-byte from the original complete mission artifact.
- Prior paused 15-row queue is preserved in session artifacts and reconciled into audit/intake.
- Old 393 mixed TODOs are provenance, not page counts or current worker ownership.
- Historical accepted components are reused. Only evidenced gaps become implementation work.
- Dynamic workflow extensions are unavailable; use direct rolling task dispatch.
- DEV-only reference routes are retained, explicitly excluded from production migration, and remain QA surfaces.
- Later page/component/fix rows are expanded from audit findings, not invented before inspection.

## Queue

| Status | Phase | Item | Type | Depends on | Attempts | Started | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] | 0 | audit-foundations | integration | - | 0 | - | Read-only foundations audit; report docs\frontend-audits\audit-foundations.md |
| [ ] | 0 | audit-page-001 | page | - | 0 | - | web\src\features\action-center\pages\ActionCenterPage.tsx; routes=/action-center; read-only audit; report docs\frontend-audits\audit-page-001.md |
| [ ] | 0 | audit-page-002 | page | - | 0 | - | web\src\features\admin\pages\APIKeysPage.tsx; routes=/api-keys; read-only audit; report docs\frontend-audits\audit-page-002.md |
| [ ] | 0 | audit-page-003 | page | - | 0 | - | web\src\features\admin\pages\ApiLogsPage.tsx; routes=/api-logs; read-only audit; report docs\frontend-audits\audit-page-003.md |
| [ ] | 0 | audit-page-004 | page | - | 0 | - | web\src\features\admin\pages\ApiPlaygroundPage.tsx; routes=/api-playground; read-only audit; report docs\frontend-audits\audit-page-004.md |
| [ ] | 0 | audit-page-005 | page | - | 0 | - | web\src\features\admin\pages\AuditLogPage.tsx; routes=/admin/audit-log; read-only audit; report docs\frontend-audits\audit-page-005.md |
| [ ] | 0 | audit-page-006 | page | - | 0 | - | web\src\features\admin\pages\BackupRestorePage.tsx; routes=/backup; read-only audit; report docs\frontend-audits\audit-page-006.md |
| [ ] | 0 | audit-page-007 | page | - | 0 | - | web\src\features\admin\pages\DataQualityPage.tsx; routes=/admin/data-quality; read-only audit; report docs\frontend-audits\audit-page-007.md |
| [ ] | 0 | audit-page-008 | page | - | 0 | - | web\src\features\admin\pages\DevToolsPage.tsx; routes=/dev-tools; read-only audit; report docs\frontend-audits\audit-page-008.md |
| [ ] | 0 | audit-page-009 | page | - | 0 | - | web\src\features\admin\pages\DiskForecastPage.tsx; routes=/admin/disk-forecast; read-only audit; report docs\frontend-audits\audit-page-009.md |
| [ ] | 0 | audit-page-010 | page | - | 0 | - | web\src\features\admin\pages\DLQInspectorPage.tsx; routes=/admin/dlq; read-only audit; report docs\frontend-audits\audit-page-010.md |
| [ ] | 0 | audit-page-011 | page | - | 0 | - | web\src\features\admin\pages\FeatureFlagsPage.tsx; routes=/admin/flags; read-only audit; report docs\frontend-audits\audit-page-011.md |
| [ ] | 0 | audit-page-012 | page | - | 0 | - | web\src\features\admin\pages\FeedbackQueuePage.tsx; routes=/admin/feedback; read-only audit; report docs\frontend-audits\audit-page-012.md |
| [ ] | 0 | audit-page-013 | page | - | 0 | - | web\src\features\admin\pages\FleetAPIPage.tsx; routes=/fleet-api; read-only audit; report docs\frontend-audits\audit-page-013.md |
| [ ] | 0 | audit-page-014 | page | - | 0 | - | web\src\features\admin\pages\FleetTelemetryCoveragePage.tsx; routes=/admin/telemetry/coverage; read-only audit; report docs\frontend-audits\audit-page-014.md |
| [ ] | 0 | audit-page-015 | page | - | 0 | - | web\src\features\admin\pages\GasPriceAutoPollPage.tsx; routes=/gas-price; read-only audit; report docs\frontend-audits\audit-page-015.md |
| [ ] | 0 | audit-page-016 | page | - | 0 | - | web\src\features\admin\pages\GDPRExportPage.tsx; routes=/admin/gdpr-exports; read-only audit; report docs\frontend-audits\audit-page-016.md |
| [ ] | 0 | audit-page-017 | page | - | 0 | - | web\src\features\admin\pages\IngestXRayPage.tsx; routes=/admin/ingest-xray; read-only audit; report docs\frontend-audits\audit-page-017.md |
| [ ] | 0 | audit-page-018 | page | - | 0 | - | web\src\features\admin\pages\LiveSignalInspectorPage.tsx; routes=/admin/live-signals; read-only audit; report docs\frontend-audits\audit-page-018.md |
| [ ] | 0 | audit-page-019 | page | - | 0 | - | web\src\features\admin\pages\RedisSignalViewerPage.tsx; routes=/redis-signals; read-only audit; report docs\frontend-audits\audit-page-019.md |
| [ ] | 0 | audit-page-020 | page | - | 0 | - | web\src\features\admin\pages\SchemaDriftPage.tsx; routes=/admin/schema-drift; read-only audit; report docs\frontend-audits\audit-page-020.md |
| [ ] | 0 | audit-page-021 | page | - | 0 | - | web\src\features\admin\pages\SecretRotationPage.tsx; routes=/admin/secret-rotation; read-only audit; report docs\frontend-audits\audit-page-021.md |
| [ ] | 0 | audit-page-022 | page | - | 0 | - | web\src\features\admin\pages\SecurityAccessPage.tsx; routes=/security-access; read-only audit; report docs\frontend-audits\audit-page-022.md |
| [ ] | 0 | audit-page-023 | page | - | 0 | - | web\src\features\admin\pages\SlowQueriesPage.tsx; routes=/admin/slow-queries; read-only audit; report docs\frontend-audits\audit-page-023.md |
| [ ] | 0 | audit-page-024 | page | - | 0 | - | web\src\features\admin\pages\TeslaFeatureFlagsPage.tsx; routes=/tesla-features; read-only audit; report docs\frontend-audits\audit-page-024.md |
| [ ] | 0 | audit-page-025 | page | - | 0 | - | web\src\features\admin\pages\TeslaOrdersPage.tsx; routes=/tesla-orders; read-only audit; report docs\frontend-audits\audit-page-025.md |
| [ ] | 0 | audit-page-026 | page | - | 0 | - | web\src\features\admin\pages\TeslaRegionPage.tsx; routes=/tesla-region; read-only audit; report docs\frontend-audits\audit-page-026.md |
| [ ] | 0 | audit-page-027 | page | - | 0 | - | web\src\features\admin\pages\VehicleCostPage.tsx; routes=/admin/vehicle-cost; read-only audit; report docs\frontend-audits\audit-page-027.md |
| [ ] | 0 | audit-page-028 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\BehavioralSentinelPage.tsx; routes=/intelligence/behavioral-sentinel; read-only audit; report docs\frontend-audits\audit-page-028.md |
| [ ] | 0 | audit-page-029 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\CausalExperimentationPage.tsx; routes=/intelligence/causal-lab; read-only audit; report docs\frontend-audits\audit-page-029.md |
| [ ] | 0 | audit-page-030 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\ChargingForensicsPage.tsx; routes=/intelligence/charging-forensics; read-only audit; report docs\frontend-audits\audit-page-030.md |
| [ ] | 0 | audit-page-031 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\ChargingSiteTwinPage.tsx; routes=/intelligence/charging-site-twin; read-only audit; report docs\frontend-audits\audit-page-031.md |
| [ ] | 0 | audit-page-032 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\ComponentSurvivalPage.tsx; routes=/intelligence/component-survival; read-only audit; report docs\frontend-audits\audit-page-032.md |
| [ ] | 0 | audit-page-033 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\EmergencyResiliencePage.tsx; routes=/intelligence/emergency-resilience; read-only audit; report docs\frontend-audits\audit-page-033.md |
| [ ] | 0 | audit-page-034 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\FederatedLearningStudioPage.tsx; routes=/intelligence/federated-learning; read-only audit; report docs\frontend-audits\audit-page-034.md |
| [ ] | 0 | audit-page-035 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\FirmwareCanaryPage.tsx; routes=/intelligence/firmware-canary; read-only audit; report docs\frontend-audits\audit-page-035.md |
| [ ] | 0 | audit-page-036 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\JourneyAssurancePage.tsx; routes=/intelligence/journey-assurance; read-only audit; report docs\frontend-audits\audit-page-036.md |
| [ ] | 0 | audit-page-037 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\RoadHazardMeshPage.tsx; routes=/intelligence/road-hazards; read-only audit; report docs\frontend-audits\audit-page-037.md |
| [ ] | 0 | audit-page-038 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\TCOOptimizerPage.tsx; routes=/intelligence/tco-optimizer; read-only audit; report docs\frontend-audits\audit-page-038.md |
| [ ] | 0 | audit-page-039 | page | - | 0 | - | web\src\features\advanced-intelligence\pages\TwinLabPage.tsx; routes=/intelligence/twin-lab; read-only audit; report docs\frontend-audits\audit-page-039.md |
| [ ] | 0 | audit-page-040 | page | - | 0 | - | web\src\features\analytics\pages\AnalyticsPage.tsx; routes=/analytics; read-only audit; report docs\frontend-audits\audit-page-040.md |
| [ ] | 0 | audit-page-041 | page | - | 0 | - | web\src\features\analytics\pages\CarbonIntelligencePage.tsx; routes=/analytics/carbon; read-only audit; report docs\frontend-audits\audit-page-041.md |
| [ ] | 0 | audit-page-042 | page | - | 0 | - | web\src\features\analytics\pages\DriveArchetypesPage.tsx; routes=/drive-archetypes; read-only audit; report docs\frontend-audits\audit-page-042.md |
| [ ] | 0 | audit-page-043 | page | - | 0 | - | web\src\features\analytics\pages\DriveCalendarPage.tsx; routes=/drive-calendar; read-only audit; report docs\frontend-audits\audit-page-043.md |
| [ ] | 0 | audit-page-044 | page | - | 0 | - | web\src\features\analytics\pages\FirmwareImpactPage.tsx; routes=/firmware-impact; read-only audit; report docs\frontend-audits\audit-page-044.md |
| [ ] | 0 | audit-page-045 | page | - | 0 | - | web\src\features\analytics\pages\FleetComparePage.tsx; routes=/vehicle-comparison; read-only audit; report docs\frontend-audits\audit-page-045.md |
| [ ] | 0 | audit-page-046 | page | - | 0 | - | web\src\features\analytics\pages\LifetimeStatsPage.tsx; routes=/lifetime-stats; read-only audit; report docs\frontend-audits\audit-page-046.md |
| [ ] | 0 | audit-page-047 | page | - | 0 | - | web\src\features\analytics\pages\MileageBudgetPage.tsx; routes=/mileage-budget; read-only audit; report docs\frontend-audits\audit-page-047.md |
| [ ] | 0 | audit-page-048 | page | - | 0 | - | web\src\features\analytics\pages\MileagePage.tsx; routes=/mileage; read-only audit; report docs\frontend-audits\audit-page-048.md |
| [ ] | 0 | audit-page-049 | page | - | 0 | - | web\src\features\analytics\pages\MilestonesPage.tsx; routes=/milestones; read-only audit; report docs\frontend-audits\audit-page-049.md |
| [ ] | 0 | audit-page-050 | page | - | 0 | - | web\src\features\analytics\pages\PeriodComparePage.tsx; routes=/period-compare; read-only audit; report docs\frontend-audits\audit-page-050.md |
| [ ] | 0 | audit-page-051 | page | - | 0 | - | web\src\features\analytics\pages\StatisticsPage.tsx; routes=/statistics; read-only audit; report docs\frontend-audits\audit-page-051.md |
| [ ] | 0 | audit-page-052 | page | - | 0 | - | web\src\features\analytics\pages\TimelinePage.tsx; routes=/timeline; read-only audit; report docs\frontend-audits\audit-page-052.md |
| [ ] | 0 | audit-page-053 | page | - | 0 | - | web\src\features\analytics\pages\TrueCostPage.tsx; routes=/tco,/analytics/tco; read-only audit; report docs\frontend-audits\audit-page-053.md |
| [ ] | 0 | audit-page-054 | page | - | 0 | - | web\src\features\analytics\pages\WeeklyDigestPage.tsx; routes=/weekly-digest; read-only audit; report docs\frontend-audits\audit-page-054.md |
| [ ] | 0 | audit-page-055 | page | - | 0 | - | web\src\features\analytics\pages\YearReviewPage.tsx; routes=/year-review/:year; read-only audit; report docs\frontend-audits\audit-page-055.md |
| [ ] | 0 | audit-page-056 | page | - | 0 | - | web\src\features\automations\pages\AutomationBuilderPage.tsx; routes=/automations/new,/automations/:id/edit; read-only audit; report docs\frontend-audits\audit-page-056.md |
| [ ] | 0 | audit-page-057 | page | - | 0 | - | web\src\features\automations\pages\AutomationHistoryPage.tsx; routes=/automations/history; read-only audit; report docs\frontend-audits\audit-page-057.md |
| [ ] | 0 | audit-page-058 | page | - | 0 | - | web\src\features\automations\pages\AutomationListPage.tsx; routes=/automations/list; read-only audit; report docs\frontend-audits\audit-page-058.md |
| [ ] | 0 | audit-page-059 | page | - | 0 | - | web\src\features\automations\pages\AutomationsListPage.tsx; routes=/automations; read-only audit; report docs\frontend-audits\audit-page-059.md |
| [ ] | 0 | audit-page-060 | page | - | 0 | - | web\src\features\battery\pages\BatteryCarePage.tsx; routes=/battery-care; read-only audit; report docs\frontend-audits\audit-page-060.md |
| [ ] | 0 | audit-page-061 | page | - | 0 | - | web\src\features\battery\pages\BatteryCellsPage.tsx; routes=/battery-cells; read-only audit; report docs\frontend-audits\audit-page-061.md |
| [ ] | 0 | audit-page-062 | page | - | 0 | - | web\src\features\battery\pages\BatteryDegradationPage.tsx; routes=/battery-degradation; read-only audit; report docs\frontend-audits\audit-page-062.md |
| [ ] | 0 | audit-page-063 | page | - | 0 | - | web\src\features\battery\pages\BatteryHealthPage.tsx; routes=/battery,/battery/health; read-only audit; report docs\frontend-audits\audit-page-063.md |
| [ ] | 0 | audit-page-064 | page | - | 0 | - | web\src\features\battery\pages\BatteryPassportPage.tsx; routes=/battery-passport; read-only audit; report docs\frontend-audits\audit-page-064.md |
| [ ] | 0 | audit-page-065 | page | - | 0 | - | web\src\features\battery\pages\ChargeAdvisorPage.tsx; routes=/charge-advisor; read-only audit; report docs\frontend-audits\audit-page-065.md |
| [ ] | 0 | audit-page-066 | page | - | 0 | - | web\src\features\battery\pages\CycleStressPage.tsx; routes=/cycle-stress; read-only audit; report docs\frontend-audits\audit-page-066.md |
| [ ] | 0 | audit-page-067 | page | - | 0 | - | web\src\features\battery\pages\EnergyFlowPage.tsx; routes=/energy-flow; read-only audit; report docs\frontend-audits\audit-page-067.md |
| [ ] | 0 | audit-page-068 | page | - | 0 | - | web\src\features\battery\pages\EnergyLedgerPage.tsx; routes=/energy-ledger; read-only audit; report docs\frontend-audits\audit-page-068.md |
| [ ] | 0 | audit-page-069 | page | - | 0 | - | web\src\features\battery\pages\EnergyPage.tsx; routes=/energy; read-only audit; report docs\frontend-audits\audit-page-069.md |
| [ ] | 0 | audit-page-070 | page | - | 0 | - | web\src\features\battery\pages\EnergyProductsPage.tsx; routes=/energy-products; read-only audit; report docs\frontend-audits\audit-page-070.md |
| [ ] | 0 | audit-page-071 | page | - | 0 | - | web\src\features\battery\pages\PackCapacityPage.tsx; routes=/pack-capacity; read-only audit; report docs\frontend-audits\audit-page-071.md |
| [ ] | 0 | audit-page-072 | page | - | 0 | - | web\src\features\battery\pages\PowerFlowDashboardPage.tsx; routes=/power-flow; read-only audit; report docs\frontend-audits\audit-page-072.md |
| [ ] | 0 | audit-page-073 | page | - | 0 | - | web\src\features\battery\pages\ProjectedRangePage.tsx; routes=/projected-range,/analytics/range; read-only audit; report docs\frontend-audits\audit-page-073.md |
| [ ] | 0 | audit-page-074 | page | - | 0 | - | web\src\features\battery\pages\SleepEfficiencyPage.tsx; routes=/sleep-efficiency; read-only audit; report docs\frontend-audits\audit-page-074.md |
| [ ] | 0 | audit-page-075 | page | - | 0 | - | web\src\features\battery\pages\VampireDrainPage.tsx; routes=/vampire-drain,/charging/vampire-drain; read-only audit; report docs\frontend-audits\audit-page-075.md |
| [ ] | 0 | audit-page-076 | page | - | 0 | - | web\src\features\benchmarks\pages\PrivacyBenchmarksPage.tsx; routes=/benchmarks/privacy; read-only audit; report docs\frontend-audits\audit-page-076.md |
| [ ] | 0 | audit-page-077 | page | - | 0 | - | web\src\features\charging\pages\ChargeDepartureAlignmentPage.tsx; routes=/charge-departure-alignment; read-only audit; report docs\frontend-audits\audit-page-077.md |
| [ ] | 0 | audit-page-078 | page | - | 0 | - | web\src\features\charging\pages\ChargeInterruptionPage.tsx; routes=/charge-interruption; read-only audit; report docs\frontend-audits\audit-page-078.md |
| [ ] | 0 | audit-page-079 | page | - | 0 | - | web\src\features\charging\pages\ChargerHealthPage.tsx; routes=/charger-health; read-only audit; report docs\frontend-audits\audit-page-079.md |
| [ ] | 0 | audit-page-080 | page | - | 0 | - | web\src\features\charging\pages\ChargerResiliencePage.tsx; routes=/charger-resilience; read-only audit; report docs\frontend-audits\audit-page-080.md |
| [ ] | 0 | audit-page-081 | page | - | 0 | - | web\src\features\charging\pages\ChargingCurvePage.tsx; routes=/charging-curve,/charging/curves; read-only audit; report docs\frontend-audits\audit-page-081.md |
| [ ] | 0 | audit-page-082 | page | - | 0 | - | web\src\features\charging\pages\ChargingDetailPage.tsx; routes=/charging/:id; read-only audit; report docs\frontend-audits\audit-page-082.md |
| [ ] | 0 | audit-page-083 | page | - | 0 | - | web\src\features\charging\pages\ChargingHeatmapPage.tsx; routes=/charging-heatmap; read-only audit; report docs\frontend-audits\audit-page-083.md |
| [ ] | 0 | audit-page-084 | page | - | 0 | - | web\src\features\charging\pages\ChargingListPage.tsx; routes=/charging; read-only audit; report docs\frontend-audits\audit-page-084.md |
| [ ] | 0 | audit-page-085 | page | - | 0 | - | web\src\features\charging\pages\ChargingThermalTaxPage.tsx; routes=/charging-thermal-tax; read-only audit; report docs\frontend-audits\audit-page-085.md |
| [ ] | 0 | audit-page-086 | page | - | 0 | - | web\src\features\charging\pages\CostAnalysisPage.tsx; routes=/cost-analysis,/charging/costs; read-only audit; report docs\frontend-audits\audit-page-086.md |
| [ ] | 0 | audit-page-087 | page | - | 0 | - | web\src\features\charging\pages\PowersharePage.tsx; routes=/powershare; read-only audit; report docs\frontend-audits\audit-page-087.md |
| [ ] | 0 | audit-page-088 | page | - | 0 | - | web\src\features\charging\pages\SmartChargePage.tsx; routes=/smart-charge,/charging/schedule; read-only audit; report docs\frontend-audits\audit-page-088.md |
| [ ] | 0 | audit-page-089 | page | - | 0 | - | web\src\features\charging\pages\TeslaChargingHistoryPage.tsx; routes=/tesla-charging-history; read-only audit; report docs\frontend-audits\audit-page-089.md |
| [ ] | 0 | audit-page-090 | page | - | 0 | - | web\src\features\charging\pages\TeslaChargingSessionsPage.tsx; routes=/tesla-charging-sessions; read-only audit; report docs\frontend-audits\audit-page-090.md |
| [ ] | 0 | audit-page-091 | page | - | 0 | - | web\src\features\dashboard\pages\DashboardPage.tsx; routes=/; read-only audit; report docs\frontend-audits\audit-page-091.md |
| [ ] | 0 | audit-page-092 | page | - | 0 | - | web\src\features\dashboard\pages\GlancePage.tsx; routes=/glance; read-only audit; report docs\frontend-audits\audit-page-092.md |
| [ ] | 0 | audit-page-093 | page | - | 0 | - | web\src\features\dashboard\pages\QuickStatsPage.tsx; routes=/quick-stats; read-only audit; report docs\frontend-audits\audit-page-093.md |
| [ ] | 0 | audit-page-094 | page | - | 0 | - | web\src\features\dashcam\pages\DashcamIntelligencePage.tsx; routes=/dashcam; read-only audit; report docs\frontend-audits\audit-page-094.md |
| [-] | 0 | audit-page-095 | page | - | 0 | - | web\src\features\developer-reference\layout\LayoutReferencePage.tsx; routes=/dev/layout; DEV-only reference: excluded from production migration; retained for QA |
| [-] | 0 | audit-page-096 | page | - | 0 | - | web\src\features\developer-reference\mobile-grid\MobileGridReferencePage.tsx; routes=/dev/grid-states; DEV-only reference: excluded from production migration; retained for QA |
| [-] | 0 | audit-page-097 | page | - | 0 | - | web\src\features\developer-reference\shared-library\SharedLibraryCompletionPage.tsx; routes=/dev/shared-library; DEV-only reference: excluded from production migration; retained for QA |
| [-] | 0 | audit-page-098 | page | - | 0 | - | web\src\features\developer-reference\stats\StatReferencePage.tsx; routes=/dev/stats; DEV-only reference: excluded from production migration; retained for QA |
| [ ] | 0 | audit-page-099 | page | - | 0 | - | web\src\features\diagnostics\pages\AnomalyDashboardPage.tsx; routes=/anomaly-detection,/analytics/anomalies; read-only audit; report docs\frontend-audits\audit-page-099.md |
| [ ] | 0 | audit-page-100 | page | - | 0 | - | web\src\features\diagnostics\pages\RemainingUsefulLifePage.tsx; routes=/diagnostics/rul; read-only audit; report docs\frontend-audits\audit-page-100.md |
| [ ] | 0 | audit-page-101 | page | - | 0 | - | web\src\features\diagnostics\pages\RootCauseIntelligencePage.tsx; routes=/diagnostics/root-cause; read-only audit; report docs\frontend-audits\audit-page-101.md |
| [ ] | 0 | audit-page-102 | page | - | 0 | - | web\src\features\diagnostics\pages\ServiceEvidencePackPage.tsx; routes=/diagnostics/service-evidence; read-only audit; report docs\frontend-audits\audit-page-102.md |
| [ ] | 0 | audit-page-103 | page | - | 0 | - | web\src\features\driving\pages\ArrivalReliabilityPage.tsx; routes=/arrival-reliability; read-only audit; report docs\frontend-audits\audit-page-103.md |
| [ ] | 0 | audit-page-104 | page | - | 0 | - | web\src\features\driving\pages\ColdStartPage.tsx; routes=/cold-start; read-only audit; report docs\frontend-audits\audit-page-104.md |
| [ ] | 0 | audit-page-105 | page | - | 0 | - | web\src\features\driving\pages\DepartureForecastPage.tsx; routes=/departure-forecast; read-only audit; report docs\frontend-audits\audit-page-105.md |
| [ ] | 0 | audit-page-106 | page | - | 0 | - | web\src\features\driving\pages\DestinationTransitionsPage.tsx; routes=/destination-transitions; read-only audit; report docs\frontend-audits\audit-page-106.md |
| [ ] | 0 | audit-page-107 | page | - | 0 | - | web\src\features\driving\pages\DriveComparePage.tsx; routes=/drive-compare; read-only audit; report docs\frontend-audits\audit-page-107.md |
| [ ] | 0 | audit-page-108 | page | - | 0 | - | web\src\features\driving\pages\DriveDetailPage.tsx; routes=/drives/:id; read-only audit; report docs\frontend-audits\audit-page-108.md |
| [ ] | 0 | audit-page-109 | page | - | 0 | - | web\src\features\driving\pages\DriveDNAPage.tsx; routes=/drive-dna; read-only audit; report docs\frontend-audits\audit-page-109.md |
| [ ] | 0 | audit-page-110 | page | - | 0 | - | web\src\features\driving\pages\DriveScorePage.tsx; routes=/drive-score; read-only audit; report docs\frontend-audits\audit-page-110.md |
| [ ] | 0 | audit-page-111 | page | - | 0 | - | web\src\features\driving\pages\DrivesListPage.tsx; routes=/drives; read-only audit; report docs\frontend-audits\audit-page-111.md |
| [ ] | 0 | audit-page-112 | page | - | 0 | - | web\src\features\driving\pages\DrivetrainHealthPage.tsx; routes=/drivetrain-health; read-only audit; report docs\frontend-audits\audit-page-112.md |
| [ ] | 0 | audit-page-113 | page | - | 0 | - | web\src\features\driving\pages\DrivingDynamicsPage.tsx; routes=/driving-dynamics; read-only audit; report docs\frontend-audits\audit-page-113.md |
| [ ] | 0 | audit-page-114 | page | - | 0 | - | web\src\features\driving\pages\DrivingRhythmPage.tsx; routes=/driving-rhythm; read-only audit; report docs\frontend-audits\audit-page-114.md |
| [ ] | 0 | audit-page-115 | page | - | 0 | - | web\src\features\driving\pages\EfficiencyPage.tsx; routes=/efficiency; read-only audit; report docs\frontend-audits\audit-page-115.md |
| [ ] | 0 | audit-page-116 | page | - | 0 | - | web\src\features\driving\pages\EfficiencyTargetPage.tsx; routes=/efficiency-target; read-only audit; report docs\frontend-audits\audit-page-116.md |
| [ ] | 0 | audit-page-117 | page | - | 0 | - | web\src\features\driving\pages\ExplorerPage.tsx; routes=/explorer; read-only audit; report docs\frontend-audits\audit-page-117.md |
| [ ] | 0 | audit-page-118 | page | - | 0 | - | web\src\features\driving\pages\FSDInsightsPage.tsx; routes=/fsd; read-only audit; report docs\frontend-audits\audit-page-118.md |
| [ ] | 0 | audit-page-119 | page | - | 0 | - | web\src\features\driving\pages\JourneyFragmentationPage.tsx; routes=/journey-fragmentation; read-only audit; report docs\frontend-audits\audit-page-119.md |
| [ ] | 0 | audit-page-120 | page | - | 0 | - | web\src\features\driving\pages\RangeBufferPage.tsx; routes=/range-buffer; read-only audit; report docs\frontend-audits\audit-page-120.md |
| [ ] | 0 | audit-page-121 | page | - | 0 | - | web\src\features\driving\pages\RegenEfficiencyPage.tsx; routes=/regen-efficiency; read-only audit; report docs\frontend-audits\audit-page-121.md |
| [ ] | 0 | audit-page-122 | page | - | 0 | - | web\src\features\driving\pages\RouteEfficiencyPage.tsx; routes=/route-efficiency; read-only audit; report docs\frontend-audits\audit-page-122.md |
| [ ] | 0 | audit-page-123 | page | - | 0 | - | web\src\features\driving\pages\SeasonalEfficiencyPage.tsx; routes=/seasonal-efficiency; read-only audit; report docs\frontend-audits\audit-page-123.md |
| [ ] | 0 | audit-page-124 | page | - | 0 | - | web\src\features\driving\pages\SegmentsPage.tsx; routes=/segments; read-only audit; report docs\frontend-audits\audit-page-124.md |
| [ ] | 0 | audit-page-125 | page | - | 0 | - | web\src\features\driving\pages\SpeedProfilePage.tsx; routes=/speed-profile; read-only audit; report docs\frontend-audits\audit-page-125.md |
| [ ] | 0 | audit-page-126 | page | - | 0 | - | web\src\features\driving\pages\SpeedSweetSpotPage.tsx; routes=/speed-sweetspot; read-only audit; report docs\frontend-audits\audit-page-126.md |
| [ ] | 0 | audit-page-127 | page | - | 0 | - | web\src\features\driving\pages\TripLogbookPage.tsx; routes=/logbook; read-only audit; report docs\frontend-audits\audit-page-127.md |
| [ ] | 0 | audit-page-128 | page | - | 0 | - | web\src\features\driving\pages\TripPlannerPage.tsx; routes=/trip-planner; read-only audit; report docs\frontend-audits\audit-page-128.md |
| [ ] | 0 | audit-page-129 | page | - | 0 | - | web\src\features\driving\pages\WhatIfPage.tsx; routes=/what-if; read-only audit; report docs\frontend-audits\audit-page-129.md |
| [ ] | 0 | audit-page-130 | page | - | 0 | - | web\src\features\explore\pages\ExplorePage.tsx; routes=/explore; read-only audit; report docs\frontend-audits\audit-page-130.md |
| [ ] | 0 | audit-page-131 | page | - | 0 | - | web\src\features\exports\pages\ExportsPage.tsx; routes=/exports; read-only audit; report docs\frontend-audits\audit-page-131.md |
| [ ] | 0 | audit-page-132 | page | - | 0 | - | web\src\features\fleet-ops\pages\FleetOperationsPage.tsx; routes=/fleet-operations; read-only audit; report docs\frontend-audits\audit-page-132.md |
| [ ] | 0 | audit-page-133 | page | - | 0 | - | web\src\features\home-energy\pages\WholeHomeEnergyPage.tsx; routes=/energy-orchestrator; read-only audit; report docs\frontend-audits\audit-page-133.md |
| [ ] | 0 | audit-page-134 | page | - | 0 | - | web\src\features\intelligence-packs\pages\IntelligencePackMarketplacePage.tsx; routes=/intelligence-packs; read-only audit; report docs\frontend-audits\audit-page-134.md |
| [ ] | 0 | audit-page-135 | page | - | 0 | - | web\src\features\maps\pages\GeofencesPage.tsx; routes=/geofences; read-only audit; report docs\frontend-audits\audit-page-135.md |
| [ ] | 0 | audit-page-136 | page | - | 0 | - | web\src\features\maps\pages\LocationsPage.tsx; routes=/locations; read-only audit; report docs\frontend-audits\audit-page-136.md |
| [ ] | 0 | audit-page-137 | page | - | 0 | - | web\src\features\maps\pages\MapOverviewPage.tsx; routes=/live; read-only audit; report docs\frontend-audits\audit-page-137.md |
| [ ] | 0 | audit-page-138 | page | - | 0 | - | web\src\features\maps\pages\NavigationRoutePage.tsx; routes=/navigation; read-only audit; report docs\frontend-audits\audit-page-138.md |
| [ ] | 0 | audit-page-139 | page | - | 0 | - | web\src\features\maps\pages\TemperatureImpactPage.tsx; routes=/temperature-impact; read-only audit; report docs\frontend-audits\audit-page-139.md |
| [ ] | 0 | audit-page-140 | page | - | 0 | - | web\src\features\notifications\components\LegacyAlertRulesRedirect.tsx; routes=/alert-rules; read-only audit; report docs\frontend-audits\audit-page-140.md |
| [ ] | 0 | audit-page-141 | page | - | 0 | - | web\src\features\notifications\components\LegacyAlertStudioRedirect.tsx; routes=/alert-studio; read-only audit; report docs\frontend-audits\audit-page-141.md |
| [ ] | 0 | audit-page-142 | page | - | 0 | - | web\src\features\notifications\pages\AlertPacksPage.tsx; routes=/notifications/packs; read-only audit; report docs\frontend-audits\audit-page-142.md |
| [ ] | 0 | audit-page-143 | page | - | 0 | - | web\src\features\notifications\pages\AlertRulesPage.tsx; routes=/notifications/rules; read-only audit; report docs\frontend-audits\audit-page-143.md |
| [ ] | 0 | audit-page-144 | page | - | 0 | - | web\src\features\notifications\pages\AlertStudioPage.tsx; routes=/notifications/studio; read-only audit; report docs\frontend-audits\audit-page-144.md |
| [ ] | 0 | audit-page-145 | page | - | 0 | - | web\src\features\notifications\pages\ArchivedPage.tsx; routes=/notifications/archived; read-only audit; report docs\frontend-audits\audit-page-145.md |
| [ ] | 0 | audit-page-146 | page | - | 0 | - | web\src\features\notifications\pages\AuditLogPage.tsx; routes=/notifications/audit; read-only audit; report docs\frontend-audits\audit-page-146.md |
| [ ] | 0 | audit-page-147 | page | - | 0 | - | web\src\features\notifications\pages\BrowserNotificationsPage.tsx; routes=/notifications/browser; read-only audit; report docs\frontend-audits\audit-page-147.md |
| [ ] | 0 | audit-page-148 | page | - | 0 | - | web\src\features\notifications\pages\ChannelsPage.tsx; routes=/notifications/channels; read-only audit; report docs\frontend-audits\audit-page-148.md |
| [ ] | 0 | audit-page-149 | page | - | 0 | - | web\src\features\notifications\pages\InboxPage.tsx; routes=/notifications,/notifications/inbox; read-only audit; report docs\frontend-audits\audit-page-149.md |
| [ ] | 0 | audit-page-150 | page | - | 0 | - | web\src\features\notifications\pages\NotificationHealthPage.tsx; routes=/notifications/health; read-only audit; report docs\frontend-audits\audit-page-150.md |
| [ ] | 0 | audit-page-151 | page | - | 0 | - | web\src\features\notifications\pages\QuietHoursPage.tsx; routes=/notifications/quiet-hours; read-only audit; report docs\frontend-audits\audit-page-151.md |
| [ ] | 0 | audit-page-152 | page | - | 0 | - | web\src\features\onboarding\pages\OnboardingPage.tsx; routes=/onboarding; read-only audit; report docs\frontend-audits\audit-page-152.md |
| [ ] | 0 | audit-page-153 | page | - | 0 | - | web\src\features\ownership\pages\ChargingReconciliationPage.tsx; routes=/ownership/charging-reconciliation; read-only audit; report docs\frontend-audits\audit-page-153.md |
| [ ] | 0 | audit-page-154 | page | - | 0 | - | web\src\features\ownership\pages\ConsumablesLifecyclePage.tsx; routes=/ownership/consumables-lifecycle; read-only audit; report docs\frontend-audits\audit-page-154.md |
| [ ] | 0 | audit-page-155 | page | - | 0 | - | web\src\features\ownership\pages\DataGovernancePage.tsx; routes=/ownership/data-governance; read-only audit; report docs\frontend-audits\audit-page-155.md |
| [ ] | 0 | audit-page-156 | page | - | 0 | - | web\src\features\ownership\pages\DriverAttributionPage.tsx; routes=/ownership/driver-attribution; read-only audit; report docs\frontend-audits\audit-page-156.md |
| [ ] | 0 | audit-page-157 | page | - | 0 | - | web\src\features\ownership\pages\InsuranceTelematicsPage.tsx; routes=/ownership/insurance-telematics; read-only audit; report docs\frontend-audits\audit-page-157.md |
| [ ] | 0 | audit-page-158 | page | - | 0 | - | web\src\features\ownership\pages\JurisdictionCompliancePage.tsx; routes=/ownership/jurisdiction-compliance; read-only audit; report docs\frontend-audits\audit-page-158.md |
| [ ] | 0 | audit-page-159 | page | - | 0 | - | web\src\features\ownership\pages\ModelTrustPage.tsx; routes=/ownership/model-trust; read-only audit; report docs\frontend-audits\audit-page-159.md |
| [ ] | 0 | audit-page-160 | page | - | 0 | - | web\src\features\ownership\pages\SubscriptionROIPage.tsx; routes=/ownership/subscription-roi; read-only audit; report docs\frontend-audits\audit-page-160.md |
| [ ] | 0 | audit-page-161 | page | - | 0 | - | web\src\features\ownership\pages\TariffLabPage.tsx; routes=/ownership/tariff-lab; read-only audit; report docs\frontend-audits\audit-page-161.md |
| [ ] | 0 | audit-page-162 | page | - | 0 | - | web\src\features\ownership\pages\WarrantyCommandPage.tsx; routes=/ownership/warranty-command; read-only audit; report docs\frontend-audits\audit-page-162.md |
| [ ] | 0 | audit-page-163 | page | - | 0 | - | web\src\features\power-user\pages\DashboardsPage.tsx; routes=/power/dashboards; read-only audit; report docs\frontend-audits\audit-page-163.md |
| [ ] | 0 | audit-page-164 | page | - | 0 | - | web\src\features\power-user\pages\GrafanaPanelPage.tsx; routes=/power/grafana; read-only audit; report docs\frontend-audits\audit-page-164.md |
| [ ] | 0 | audit-page-165 | page | - | 0 | - | web\src\features\power-user\pages\SqlPlaygroundPage.tsx; routes=/power/sql; read-only audit; report docs\frontend-audits\audit-page-165.md |
| [ ] | 0 | audit-page-166 | page | - | 0 | - | web\src\features\resale-vault\pages\WarrantyResaleVaultPage.tsx; routes=/resale-vault; read-only audit; report docs\frontend-audits\audit-page-166.md |
| [ ] | 0 | audit-page-167 | page | - | 0 | - | web\src\features\science\pages\ScienceLabPage.tsx; routes=/science; read-only audit; report docs\frontend-audits\audit-page-167.md |
| [ ] | 0 | audit-page-168 | page | - | 0 | - | web\src\features\server\ConnectPage.tsx; routes=/connect; read-only audit; report docs\frontend-audits\audit-page-168.md |
| [ ] | 0 | audit-page-169 | page | - | 0 | - | web\src\features\service-intelligence\pages\ServiceIntelligencePage.tsx; routes=/service-intelligence; read-only audit; report docs\frontend-audits\audit-page-169.md |
| [ ] | 0 | audit-page-170 | page | - | 0 | - | web\src\features\settings\pages\ActiveSessionsPage.tsx; routes=/account/sessions; read-only audit; report docs\frontend-audits\audit-page-170.md |
| [ ] | 0 | audit-page-171 | page | - | 0 | - | web\src\features\settings\pages\FleetSetupPage.tsx; routes=/settings/fleet-setup; read-only audit; report docs\frontend-audits\audit-page-171.md |
| [ ] | 0 | audit-page-172 | page | - | 0 | - | web\src\features\settings\pages\HelixPage.tsx; routes=/integrations/helix; read-only audit; report docs\frontend-audits\audit-page-172.md |
| [ ] | 0 | audit-page-173 | page | - | 0 | - | web\src\features\settings\pages\PrivacyPage.tsx; routes=/account/privacy; read-only audit; report docs\frontend-audits\audit-page-173.md |
| [ ] | 0 | audit-page-174 | page | - | 0 | - | web\src\features\settings\pages\SafetyPage.tsx; routes=/settings/safety; read-only audit; report docs\frontend-audits\audit-page-174.md |
| [ ] | 0 | audit-page-175 | page | - | 0 | - | web\src\features\settings\pages\SettingsPage.tsx; routes=/settings; read-only audit; report docs\frontend-audits\audit-page-175.md |
| [ ] | 0 | audit-page-176 | page | - | 0 | - | web\src\features\settings\pages\TwoFactorAuthPage.tsx; routes=/account/2fa; read-only audit; report docs\frontend-audits\audit-page-176.md |
| [ ] | 0 | audit-page-177 | page | - | 0 | - | web\src\features\sharing\pages\ShareCardPage.tsx; routes=/share-card; read-only audit; report docs\frontend-audits\audit-page-177.md |
| [ ] | 0 | audit-page-178 | page | - | 0 | - | web\src\features\sharing\pages\SharedDrivePage.tsx; routes=/s/:token; read-only audit; report docs\frontend-audits\audit-page-178.md |
| [ ] | 0 | audit-page-179 | page | - | 0 | - | web\src\features\sharing\pages\SharingTripsPage.tsx; routes=/sharing/trips; read-only audit; report docs\frontend-audits\audit-page-179.md |
| [ ] | 0 | audit-page-180 | page | - | 0 | - | web\src\features\system\pages\ActivityTimelinePage.tsx; routes=/activity; read-only audit; report docs\frontend-audits\audit-page-180.md |
| [ ] | 0 | audit-page-181 | page | - | 0 | - | web\src\features\system\pages\ChatbotPage.tsx; routes=/chatbot; read-only audit; report docs\frontend-audits\audit-page-181.md |
| [ ] | 0 | audit-page-182 | page | - | 0 | - | web\src\features\system\pages\CommandHistoryPage.tsx; routes=/command-history; read-only audit; report docs\frontend-audits\audit-page-182.md |
| [ ] | 0 | audit-page-183 | page | - | 0 | - | web\src\features\system\pages\CommandReliabilityPage.tsx; routes=/command-reliability; read-only audit; report docs\frontend-audits\audit-page-183.md |
| [ ] | 0 | audit-page-184 | page | - | 0 | - | web\src\features\system\pages\CommandsPage.tsx; routes=/commands; read-only audit; report docs\frontend-audits\audit-page-184.md |
| [ ] | 0 | audit-page-185 | page | - | 0 | - | web\src\features\system\pages\DataExportPage.tsx; routes=/data-export; read-only audit; report docs\frontend-audits\audit-page-185.md |
| [ ] | 0 | audit-page-186 | page | - | 0 | - | web\src\features\system\pages\DataRepairPage.tsx; routes=/data-repair; read-only audit; report docs\frontend-audits\audit-page-186.md |
| [ ] | 0 | audit-page-187 | page | - | 0 | - | web\src\features\system\pages\DBHealthPage.tsx; routes=/db-health; read-only audit; report docs\frontend-audits\audit-page-187.md |
| [ ] | 0 | audit-page-188 | page | - | 0 | - | web\src\features\system\pages\HelpPage.tsx; routes=/help; read-only audit; report docs\frontend-audits\audit-page-188.md |
| [ ] | 0 | audit-page-189 | page | - | 0 | - | web\src\features\system\pages\IncidentTimelinePage.tsx; routes=/system-status/incidents/:id; read-only audit; report docs\frontend-audits\audit-page-189.md |
| [ ] | 0 | audit-page-190 | page | - | 0 | - | web\src\features\system\pages\MyActivityPage.tsx; routes=/me/activity; read-only audit; report docs\frontend-audits\audit-page-190.md |
| [ ] | 0 | audit-page-191 | page | - | 0 | - | web\src\features\system\pages\NotFoundPage.tsx; routes=*; read-only audit; report docs\frontend-audits\audit-page-191.md |
| [ ] | 0 | audit-page-192 | page | - | 0 | - | web\src\features\system\pages\OutageAutobiographyPage.tsx; routes=/outage; read-only audit; report docs\frontend-audits\audit-page-192.md |
| [ ] | 0 | audit-page-193 | page | - | 0 | - | web\src\features\system\pages\RoadmapPage.tsx; routes=/roadmap; read-only audit; report docs\frontend-audits\audit-page-193.md |
| [ ] | 0 | audit-page-194 | page | - | 0 | - | web\src\features\system\pages\SearchPage.tsx; routes=/search; read-only audit; report docs\frontend-audits\audit-page-194.md |
| [ ] | 0 | audit-page-195 | page | - | 0 | - | web\src\features\system\pages\StateMachineDebuggerPage.tsx; routes=/state-debugger; read-only audit; report docs\frontend-audits\audit-page-195.md |
| [ ] | 0 | audit-page-196 | page | - | 0 | - | web\src\features\system\pages\StatusApiDocsPage.tsx; routes=/docs/status-api; read-only audit; report docs\frontend-audits\audit-page-196.md |
| [ ] | 0 | audit-page-197 | page | - | 0 | - | web\src\features\system\pages\SystemStatusPage.tsx; routes=/system-status; read-only audit; report docs\frontend-audits\audit-page-197.md |
| [ ] | 0 | audit-page-198 | page | - | 0 | - | web\src\features\system\pages\TeslaAccountPage.tsx; routes=/tesla-account; read-only audit; report docs\frontend-audits\audit-page-198.md |
| [ ] | 0 | audit-page-199 | page | - | 0 | - | web\src\features\system\pages\TeslaApiUsagePage.tsx; routes=/tesla-api-usage; read-only audit; report docs\frontend-audits\audit-page-199.md |
| [ ] | 0 | audit-page-200 | page | - | 0 | - | web\src\features\telemetry\pages\LiveSignalMonitorPage.tsx; routes=/live-monitor; read-only audit; report docs\frontend-audits\audit-page-200.md |
| [ ] | 0 | audit-page-201 | page | - | 0 | - | web\src\features\telemetry\pages\MQTTInspectorPage.tsx; routes=/mqtt-inspector; read-only audit; report docs\frontend-audits\audit-page-201.md |
| [ ] | 0 | audit-page-202 | page | - | 0 | - | web\src\features\telemetry\pages\SignalChangePointsPage.tsx; routes=/signal-change-points; read-only audit; report docs\frontend-audits\audit-page-202.md |
| [ ] | 0 | audit-page-203 | page | - | 0 | - | web\src\features\telemetry\pages\SignalCorrelationPage.tsx; routes=/signal-correlation; read-only audit; report docs\frontend-audits\audit-page-203.md |
| [ ] | 0 | audit-page-204 | page | - | 0 | - | web\src\features\telemetry\pages\SignalDeadbandPage.tsx; routes=/signal-deadband; read-only audit; report docs\frontend-audits\audit-page-204.md |
| [ ] | 0 | audit-page-205 | page | - | 0 | - | web\src\features\telemetry\pages\SignalDiffPage.tsx; routes=/signal-diff; read-only audit; report docs\frontend-audits\audit-page-205.md |
| [ ] | 0 | audit-page-206 | page | - | 0 | - | web\src\features\telemetry\pages\SignalEntropyPage.tsx; routes=/signal-entropy; read-only audit; report docs\frontend-audits\audit-page-206.md |
| [ ] | 0 | audit-page-207 | page | - | 0 | - | web\src\features\telemetry\pages\SignalExplorerPage.tsx; routes=/signal-explorer; read-only audit; report docs\frontend-audits\audit-page-207.md |
| [ ] | 0 | audit-page-208 | page | - | 0 | - | web\src\features\telemetry\pages\SignalGapDetectorPage.tsx; routes=/signal-gaps; read-only audit; report docs\frontend-audits\audit-page-208.md |
| [ ] | 0 | audit-page-209 | page | - | 0 | - | web\src\features\telemetry\pages\SignalLogViewerPage.tsx; routes=/signal-log; read-only audit; report docs\frontend-audits\audit-page-209.md |
| [ ] | 0 | audit-page-210 | page | - | 0 | - | web\src\features\telemetry\pages\SignalMutualInformationPage.tsx; routes=/signal-mutual-information; read-only audit; report docs\frontend-audits\audit-page-210.md |
| [ ] | 0 | audit-page-211 | page | - | 0 | - | web\src\features\telemetry\pages\SignalsWorkspacePage.tsx; routes=/signals; read-only audit; report docs\frontend-audits\audit-page-211.md |
| [ ] | 0 | audit-page-212 | page | - | 0 | - | web\src\features\telemetry\pages\SignalTrendPage.tsx; routes=/signal-trend; read-only audit; report docs\frontend-audits\audit-page-212.md |
| [ ] | 0 | audit-page-213 | page | - | 0 | - | web\src\features\trips\pages\JourneysPage.tsx; routes=/journeys; read-only audit; report docs\frontend-audits\audit-page-213.md |
| [ ] | 0 | audit-page-214 | page | - | 0 | - | web\src\features\trips\pages\TripDetailPage.tsx; routes=/trips/:id; read-only audit; report docs\frontend-audits\audit-page-214.md |
| [ ] | 0 | audit-page-215 | page | - | 0 | - | web\src\features\trips\pages\TripListPage.tsx; routes=/trips; read-only audit; report docs\frontend-audits\audit-page-215.md |
| [ ] | 0 | audit-page-216 | page | - | 0 | - | web\src\features\trips\pages\TripReplayPage.tsx; routes=/drives/:id/replay; read-only audit; report docs\frontend-audits\audit-page-216.md |
| [ ] | 0 | audit-page-217 | page | - | 0 | - | web\src\features\vehicle-systems\pages\CabinThermalPage.tsx; routes=/cabin-thermal; read-only audit; report docs\frontend-audits\audit-page-217.md |
| [ ] | 0 | audit-page-218 | page | - | 0 | - | web\src\features\vehicle-systems\pages\ClimateControlPage.tsx; routes=/climate-control,/climate; read-only audit; report docs\frontend-audits\audit-page-218.md |
| [ ] | 0 | audit-page-219 | page | - | 0 | - | web\src\features\vehicle-systems\pages\ComfortConsistencyPage.tsx; routes=/comfort-consistency; read-only audit; report docs\frontend-audits\audit-page-219.md |
| [ ] | 0 | audit-page-220 | page | - | 0 | - | web\src\features\vehicle-systems\pages\GuardModePage.tsx; routes=/guard-mode; read-only audit; report docs\frontend-audits\audit-page-220.md |
| [ ] | 0 | audit-page-221 | page | - | 0 | - | web\src\features\vehicle-systems\pages\HvacCyclingPage.tsx; routes=/hvac-cycling; read-only audit; report docs\frontend-audits\audit-page-221.md |
| [ ] | 0 | audit-page-222 | page | - | 0 | - | web\src\features\vehicle-systems\pages\MaintenancePage.tsx; routes=/maintenance; read-only audit; report docs\frontend-audits\audit-page-222.md |
| [ ] | 0 | audit-page-223 | page | - | 0 | - | web\src\features\vehicle-systems\pages\MediaPlayerPage.tsx; routes=/media-player; read-only audit; report docs\frontend-audits\audit-page-223.md |
| [ ] | 0 | audit-page-224 | page | - | 0 | - | web\src\features\vehicle-systems\pages\PreconditioningEffectivenessPage.tsx; routes=/preconditioning-effectiveness; read-only audit; report docs\frontend-audits\audit-page-224.md |
| [ ] | 0 | audit-page-225 | page | - | 0 | - | web\src\features\vehicle-systems\pages\SafetySettingsPage.tsx; routes=/safety-settings; read-only audit; report docs\frontend-audits\audit-page-225.md |
| [ ] | 0 | audit-page-226 | page | - | 0 | - | web\src\features\vehicle-systems\pages\SoftwareUpdatesPage.tsx; routes=/software-updates,/vehicle-systems/software; read-only audit; report docs\frontend-audits\audit-page-226.md |
| [ ] | 0 | audit-page-227 | page | - | 0 | - | web\src\features\vehicle-systems\pages\TireDifferentialDriftPage.tsx; routes=/tire-differential-drift; read-only audit; report docs\frontend-audits\audit-page-227.md |
| [ ] | 0 | audit-page-228 | page | - | 0 | - | web\src\features\vehicle-systems\pages\TirePressurePage.tsx; routes=/tire-pressure; read-only audit; report docs\frontend-audits\audit-page-228.md |
| [ ] | 0 | audit-page-229 | page | - | 0 | - | web\src\features\vehicles\pages\DayLogPage.tsx; routes=/day-log; read-only audit; report docs\frontend-audits\audit-page-229.md |
| [ ] | 0 | audit-page-230 | page | - | 0 | - | web\src\features\vehicles\pages\DigitalTwinPage.tsx; routes=/digital-twin; read-only audit; report docs\frontend-audits\audit-page-230.md |
| [ ] | 0 | audit-page-231 | page | - | 0 | - | web\src\features\vehicles\pages\ParkingAnalyticsPage.tsx; routes=/parking; read-only audit; report docs\frontend-audits\audit-page-231.md |
| [ ] | 0 | audit-page-232 | page | - | 0 | - | web\src\features\vehicles\pages\PhysicsCockpitPage.tsx; routes=/physics-cockpit; read-only audit; report docs\frontend-audits\audit-page-232.md |
| [ ] | 0 | audit-page-233 | page | - | 0 | - | web\src\features\vehicles\pages\PhysicsLedgerPage.tsx; routes=/tesla-physics/ledger; read-only audit; report docs\frontend-audits\audit-page-233.md |
| [ ] | 0 | audit-page-234 | page | - | 0 | - | web\src\features\vehicles\pages\TeslaPhysicsPage.tsx; routes=/tesla-physics,/tesla-physics/clocks,/tesla-physics/life-tape,/tesla-physics/contradictions,/tesla-physics/meters,/tesla-physics/unknown,/tesla-physics/car-kept-living,/tesla-physics/logbook,/tesla-physics/firmware-epochs,/tesla-physics/charge-port,/tesla-physics/black-box,/tesla-physics/dictionary,/tesla-physics/vault,/tesla-physics/modes,/tesla-physics/nervous-system,/tesla-physics/range; read-only audit; report docs\frontend-audits\audit-page-234.md |
| [ ] | 0 | audit-page-235 | page | - | 0 | - | web\src\features\vehicles\pages\TimeMachinePage.tsx; routes=/time-machine; read-only audit; report docs\frontend-audits\audit-page-235.md |
| [ ] | 0 | audit-page-236 | page | - | 0 | - | web\src\features\vehicles\pages\UtilizationPage.tsx; routes=/utilization; read-only audit; report docs\frontend-audits\audit-page-236.md |
| [ ] | 0 | audit-page-237 | page | - | 0 | - | web\src\features\vehicles\pages\VehicleAccessPage.tsx; routes=/vehicles/:id/access; read-only audit; report docs\frontend-audits\audit-page-237.md |
| [ ] | 0 | audit-page-238 | page | - | 0 | - | web\src\features\vehicles\pages\VehicleDetailPage.tsx; routes=/vehicles/:id; read-only audit; report docs\frontend-audits\audit-page-238.md |
| [ ] | 0 | audit-page-239 | page | - | 0 | - | web\src\features\vehicles\pages\VehicleListPage.tsx; routes=/vehicles; read-only audit; report docs\frontend-audits\audit-page-239.md |
| [ ] | 0 | audit-page-240 | page | - | 0 | - | web\src\features\vehicles\pages\VehicleManagementPage.tsx; routes=/vehicle-management; read-only audit; report docs\frontend-audits\audit-page-240.md |
| [ ] | 0 | audit-page-241 | page | - | 0 | - | web\src\features\watch\pages\WatchFacePage.tsx; routes=/watch; read-only audit; report docs\frontend-audits\audit-page-241.md |
| [ ] | 0 | consolidate-inventory | integration | all phase-0 audits | 0 | - | Orchestrator consolidation only; docs\frontend-inventory.md; reuse existing accepted library |
| [ ] | 1 | design-contract | shared | consolidate-inventory | 0 | - | Design architect only; concrete restrained tokens and reconcile obsolete preservation/policy language |
| [ ] | 1 | tokens | shared | design-contract | 0 | - | One token owner; exact CSS/Tailwind scope determined by audit; preserve persisted preference IDs |
| [ ] | 1 | qa-tooling | integration | design-contract | 0 | - | Dev-only screenshots, all-ten-width overflow, style scan, extreme-data fixtures; reuse existing tooling |
| [ ] | 5 | inherited-source-intake | integration | phase-5 pages | 0 | - | Preserve prior 39/40 source closure, dashboard band receipts, supported specs, copy receipts, and catalog integration; no new acceptance claimed |
