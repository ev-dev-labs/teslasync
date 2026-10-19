import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import catalog from './en.json'
import shell from './en/shell.json'
import baseline from './known-missing-keys.json'
import runtimeManifest from './en/runtime-manifest.json'
import usageManifest from './en/usage-manifest.json'
import { restoreAcceptedShellSource } from './authorized-shell-preservation'
import { assertCombinedCheckpoint, currentOwnerCheckpointFiles } from './verified-combined-contract'

type Json = Record<string, unknown>
export const finalFourAdditions = [
  ['ai.limit.retryIn', 'Try again in {{seconds}}s'],
  ['palette.clearScope', 'Clear {{scope}} filter'],
  ['devtools.utils.regexEmptyMatch', '(empty match)'],
  ['app.temperatureLabel', 'Temperature'],
] as const

// Static parent-authorized pairs: original89 + canonical titles3 + visible extension3.
export const ownerRecoveryAdditions: readonly (readonly [string, string])[] = [
  ["vehicleVisualization.status.battery", "Battery"],
  ["vehicleVisualization.status.charging", "Charging"],
  ["vehicleVisualization.status.locked", "Locked"],
  ["vehicleVisualization.status.unlocked", "Unlocked"],
  ["vehicleVisualization.status.driving", "Driving"],
  ["vehicleVisualization.status.climate", "Climate"],
  ["vehicleVisualization.status.sentry", "Sentry"],
  ["vehicleVisualization.status.notCharging", "Not Charging"],
  ["firmwareImpact.chart.title", "Consumption change per version"],
  ["firmwareImpact.chart.aria", "Bar chart of the change in energy consumption in watt-hours per kilometre after each firmware version"],
  ["regimes.chart.title", "Weekly consumption & detected regimes"],
  ["regimes.chart.aria", "Weekly consumption line with stepped regime means and changepoint markers"],
  ["statistics.stateDistributionAria", "Vehicle state distribution pie chart"],
  ["statistics.vehicleComparisonAria", "Distance and energy bar chart comparing all vehicles in the fleet"],
  ["battery.cells.chart.spreadTrendAria", "Battery cell voltage spread trend area chart over time"],
  ["battery.degradation.trendTitleAria", "Battery health trend and 95% confidence projection chart"],
  ["charging.curve.chargerTypeAria", "Composed bar/line chart of average power and energy per charger type"],
  ["charging.curve.sessionComparisonAria", "Overlaid power-vs-SOC line chart comparing the last several charging sessions"],
  ["charging.curve.powerVsSocAria", "Charging power versus state-of-charge area chart for the selected session"],
  ["charging.curve.speedTrendAria", "Monthly average DC and AC charging speed line chart"],
  ["charging.curve.yearlyTrendAria", "Yearly average charge-time and session-count composed chart"],
  ["costAnalysis.charts.costPerKwhAria", "Cost per kilowatt-hour trend line chart"],
  ["costAnalysis.charts.monthlyCostAria", "Monthly charging cost trend area chart"],
  ["dashboard.widgetSettings.allVehicles", "All vehicles (first)"],
  ["dashboard.widgetSettings.vehicleName", "Vehicle {{id}}"],
  ["dashboard.widgetSettings.title", "{{name}} Settings"],
  ["dashboard.widgetSettings.vehicle", "Vehicle"],
  ["dashboard.widgetSettings.refreshInterval", "Refresh interval"],
  ["dashboard.widgetSettings.default", "Default"],
  ["dashboard.widgetSettings.5s", "5 seconds"],
  ["dashboard.widgetSettings.15s", "15 seconds"],
  ["dashboard.widgetSettings.30s", "30 seconds"],
  ["dashboard.widgetSettings.60s", "1 minute"],
  ["dashboard.widgetSettings.timeRange", "Time range"],
  ["dashboard.widgetSettings.24h", "Last 24 hours"],
  ["dashboard.widgetSettings.7d", "Last 7 days"],
  ["dashboard.widgetSettings.30d", "Last 30 days"],
  ["dashboard.widgetSettings.90d", "Last 90 days"],
  ["dashboard.widgetSettings.appearance", "Appearance"],
  ["dashboard.widgetSettings.showTitle", "Show widget title"],
  ["widget.recentDrivesListDrive", "Drive"],
  ["widget.recentDrivesDurationUnit", "min"],
  ["driveScore.categoryBreakdownAria", "Drive score category breakdown horizontal bar chart"],
  ["driveScore.scoreDistributionAria", "Drive score distribution histogram bar chart"],
  ["driveScore.scoreTrendAria", "Drive score trend line chart with category breakdowns"],
  ["energyAnatomy.sankey.aria", "Sankey diagram splitting {{total}} into aero drag, rolling resistance, climate, and other losses"],
  ["driveDetail.driveChartAria", "Drive overview composed chart of speed, range, SOC and power over time"],
  ["driveDetail.elevProfileAria", "Elevation and speed area+line chart over the drive timeline"],
  ["driveDetail.powerProfileAria", "Drive power profile area chart over time"],
  ["driveDetail.socOverTimeAria", "State of charge percent over time area chart"],
  ["driveDetail.speedHistogramAria", "Speed-bucket distribution histogram"],
  ["driveDetail.temperaturesAria", "Inside, outside, driver and passenger temperature lines over the drive timeline"],
  ["driveDetail.tirePressureAria", "Front and rear tire pressure lines over the drive timeline"],
  ["drivetrain.powerOutputAria", "Per-drive peak and regen motor power output history area chart"],
  ["drivetrain.statorTempHistoryAria", "Front, rear-left and rear-right motor stator temperature history line chart"],
  ["drivetrain.tempHistoryAria", "Outside temperature trend line chart per recent drive"],
  ["drivetrain.torqueHistoryAria", "Motor inverter torque output history area chart"],
  ["dynamics.speedDistributionAria", "Speed-bucket drive count distribution bar chart"],
  ["dynamics.powerOverTimeAria", "Motor power and regen over time area chart"],
  ["dynamics.torqueHistoryAria", "Front and rear motor torque over time line chart"],
  ["dynamics.rpmHistoryAria", "Front and rear motor RPM over time line chart"],
  ["efficiency.speedVsEfficiencyAria", "Speed versus efficiency scatter plot"],
  ["efficiency.tempVsEfficiencyAria", "Temperature versus efficiency scatter plot"],
  ["efficiency.speedDistAria", "Efficiency by speed-range bar chart"],
  ["efficiency.dailyTrendAria", "Daily efficiency trend area chart"],
  ["anomalies.chart.title", "Your Consumption Law"],
  ["anomalies.chart.aria", "Scatter of drive consumption against speed with fitted curve and two-sigma band; outliers highlighted"],
  ["landscape.field.title", "Consumption Field"],
  ["landscape.field.aria", "Grid of consumption by speed band and temperature band; best {{best}}, worst {{worst}}"],
  ["energyAnatomy.sankey.title", "Energy Flow"],
  ["share.unavailable.title", "Share link unavailable"],
  ["share.unavailable.description", "This shared drive link has expired or been revoked."],
  ["share.unavailable.home", "Go to TeslaSync"],
  ["share.elevationAria", "Shared drive elevation profile area chart by distance"],
  ["share.speedAria", "Shared drive speed profile line chart by distance"],
  ["fsm.timelineChartAria", "FSM transitions over time stacked area chart"],
  ["commandReliability.chart.title", "Confidence-weighted success"],
  ["commandReliability.chart.aria", "Bar chart of the wilson lower confidence bound for each command with the naive success rate overlaid"],
  ["dbHealth.chartTitleAria", "Top fifteen database table sizes horizontal bar chart"],
  ["help.fsm.typeAria", "More info about FSM types"],
  ["help.fsm.liveStateAria", "More info about FSM live state"],
  ["fsm.distributionByStateAria", "FSM state distribution donut chart with per-state counts"],
  ["help.signal.snapshotAria", "More info about signal snapshots"],
  ["help.signal.diffAria", "More info about signal diffs"],
  ["help.signal.layersAria", "More info about signal layers (L1, L2, log)"],
  ["signalCorrelation.correlogram.title", "Lagged correlogram"],
  ["signalCorrelation.correlogram.aria", "Line chart of correlation coefficient against time lag between the two selected signals"],
  ["signalCorrelation.overlay.title", "Normalised overlay"],
  ["signalCorrelation.overlay.aria", "Area chart of the two selected signals normalised onto a common scale over the overlapping window"],
  ["error.unsupported.title", "Feature not supported"],
  ["error.unavailable.title", "Service unavailable"],
  ["error.request.title", "Request could not be completed"],
  ["share.curveAria", "Shared session power and battery chart by minute"],
  ["signalLog.compositionNoRecords", "No records in the selected range."],
  ["signalLog.compositionEmpty", "Run a query to see the value-type breakdown."],
]
const exactRenames: readonly (readonly [string, string])[] = [
  ["vehicle.viz.battery", "vehicleVisualization.status.battery"],
  ["vehicle.viz.charging", "vehicleVisualization.status.charging"],
  ["vehicle.viz.locked", "vehicleVisualization.status.locked"],
  ["vehicle.viz.unlocked", "vehicleVisualization.status.unlocked"],
  ["vehicle.viz.driving", "vehicleVisualization.status.driving"],
  ["vehicle.viz.climate", "vehicleVisualization.status.climate"],
  ["vehicle.viz.sentry", "vehicleVisualization.status.sentry"],
  ["vehicle.viz.notCharging", "vehicleVisualization.status.notCharging"],
  ["firmwareImpact.chart", "firmwareImpact.chart.title"],
  ["regimes.chart", "regimes.chart.title"],
  ["statistics.stateDistribution.aria", "statistics.stateDistributionAria"],
  ["statistics.vehicleComparison.aria", "statistics.vehicleComparisonAria"],
  ["battery.cells.chart.spreadTrend.aria", "battery.cells.chart.spreadTrendAria"],
  ["battery.degradation.trendTitle.aria", "battery.degradation.trendTitleAria"],
  ["charging.curve.chargerType.aria", "charging.curve.chargerTypeAria"],
  ["charging.curve.sessionComparison.aria", "charging.curve.sessionComparisonAria"],
  ["charging.curve.powerVsSoc.aria", "charging.curve.powerVsSocAria"],
  ["charging.curve.speedTrend.aria", "charging.curve.speedTrendAria"],
  ["charging.curve.yearlyTrend.aria", "charging.curve.yearlyTrendAria"],
  ["costAnalysis.charts.costPerKwh.aria", "costAnalysis.charts.costPerKwhAria"],
  ["costAnalysis.charts.monthlyCost.aria", "costAnalysis.charts.monthlyCostAria"],
  ["dashboard.settings.allVehicles", "dashboard.widgetSettings.allVehicles"],
  ["dashboard.settings.vehicleName", "dashboard.widgetSettings.vehicleName"],
  ["dashboard.settings.title", "dashboard.widgetSettings.title"],
  ["dashboard.settings.vehicle", "dashboard.widgetSettings.vehicle"],
  ["dashboard.settings.refreshInterval", "dashboard.widgetSettings.refreshInterval"],
  ["dashboard.settings.default", "dashboard.widgetSettings.default"],
  ["dashboard.settings.5s", "dashboard.widgetSettings.5s"],
  ["dashboard.settings.15s", "dashboard.widgetSettings.15s"],
  ["dashboard.settings.30s", "dashboard.widgetSettings.30s"],
  ["dashboard.settings.60s", "dashboard.widgetSettings.60s"],
  ["dashboard.settings.timeRange", "dashboard.widgetSettings.timeRange"],
  ["dashboard.settings.24h", "dashboard.widgetSettings.24h"],
  ["dashboard.settings.7d", "dashboard.widgetSettings.7d"],
  ["dashboard.settings.30d", "dashboard.widgetSettings.30d"],
  ["dashboard.settings.90d", "dashboard.widgetSettings.90d"],
  ["dashboard.settings.appearance", "dashboard.widgetSettings.appearance"],
  ["dashboard.settings.showTitle", "dashboard.widgetSettings.showTitle"],
  ["widget.recentDrivesList.drive", "widget.recentDrivesListDrive"],
  ["widget.recentDrives.durationUnit", "widget.recentDrivesDurationUnit"],
  ["driveScore.categoryBreakdown.aria", "driveScore.categoryBreakdownAria"],
  ["driveScore.scoreDistribution.aria", "driveScore.scoreDistributionAria"],
  ["driveScore.scoreTrend.aria", "driveScore.scoreTrendAria"],
  ["driveDetail.driveChart.aria", "driveDetail.driveChartAria"],
  ["driveDetail.elevProfile.aria", "driveDetail.elevProfileAria"],
  ["driveDetail.powerProfile.aria", "driveDetail.powerProfileAria"],
  ["driveDetail.socOverTime.aria", "driveDetail.socOverTimeAria"],
  ["driveDetail.speedHistogram.aria", "driveDetail.speedHistogramAria"],
  ["driveDetail.temperatures.aria", "driveDetail.temperaturesAria"],
  ["driveDetail.tirePressure.aria", "driveDetail.tirePressureAria"],
  ["drivetrain.powerOutput.aria", "drivetrain.powerOutputAria"],
  ["drivetrain.statorTempHistory.aria", "drivetrain.statorTempHistoryAria"],
  ["drivetrain.tempHistory.aria", "drivetrain.tempHistoryAria"],
  ["drivetrain.torqueHistory.aria", "drivetrain.torqueHistoryAria"],
  ["dynamics.speedDistribution.aria", "dynamics.speedDistributionAria"],
  ["dynamics.powerOverTime.aria", "dynamics.powerOverTimeAria"],
  ["dynamics.torqueHistory.aria", "dynamics.torqueHistoryAria"],
  ["dynamics.rpmHistory.aria", "dynamics.rpmHistoryAria"],
  ["efficiency.speedVsEfficiency.aria", "efficiency.speedVsEfficiencyAria"],
  ["efficiency.tempVsEfficiency.aria", "efficiency.tempVsEfficiencyAria"],
  ["efficiency.speedDist.aria", "efficiency.speedDistAria"],
  ["efficiency.dailyTrend.aria", "efficiency.dailyTrendAria"],
  ["anomalies.chart", "anomalies.chart.title"],
  ["landscape.field", "landscape.field.title"],
  ["energyAnatomy.sankey", "energyAnatomy.sankey.title"],
  ["share.expired.title", "share.unavailable.title"],
  ["share.expired.description", "share.unavailable.description"],
  ["share.expired.home", "share.unavailable.home"],
  ["share.elevation.aria", "share.elevationAria"],
  ["share.speed.aria", "share.speedAria"],
  ["fsm.timelineChart.aria", "fsm.timelineChartAria"],
  ["commandReliability.chart", "commandReliability.chart.title"],
  ["dbHealth.chartTitle.aria", "dbHealth.chartTitleAria"],
  ["help.fsm.type.aria", "help.fsm.typeAria"],
  ["help.fsm.liveState.aria", "help.fsm.liveStateAria"],
  ["fsm.distributionByState.aria", "fsm.distributionByStateAria"],
  ["help.signal.snapshot.aria", "help.signal.snapshotAria"],
  ["help.signal.diff.aria", "help.signal.diffAria"],
  ["help.signal.layers.aria", "help.signal.layersAria"],
  ["signalCorrelation.correlogram", "signalCorrelation.correlogram.title"],
  ["signalCorrelation.overlay", "signalCorrelation.overlay.title"],
  ["share.curve.aria", "share.curveAria"],
  ["signalLog.composition.noRecords", "signalLog.compositionNoRecords"],
  ["signalLog.composition.empty", "signalLog.compositionEmpty"],
]
const sourcePaths = [
  "web/src/components/data-display/TeslaCarViz.tsx",
  "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactChart.tsx",
  "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
  "web/src/features/analytics/pages/StatisticsPage.tsx",
  "web/src/features/battery/pages/BatteryCellsPage.tsx",
  "web/src/features/battery/pages/BatteryDegradationPage.tsx",
  "web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx",
  "web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx",
  "web/src/features/charging/components/charging-curve/SessionCurveChart.tsx",
  "web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx",
  "web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx",
  "web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx",
  "web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx",
  "web/src/features/dashboard/components/WidgetSettingsModal.tsx",
  "web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx",
  "web/src/features/dashboard/widgets/RecentDrivesWidget.tsx",
  "web/src/features/driving/components/continuation-driving-primary/ScoreCategoryChart.tsx",
  "web/src/features/driving/components/continuation-driving-primary/ScoreDistributionChart.tsx",
  "web/src/features/driving/components/continuation-driving-primary/ScoreTrendChart.tsx",
  "web/src/features/driving/components/continuation-driving-secondary/EnergyFlowDiagram.tsx",
  "web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx",
  "web/src/features/driving/components/drive-detail/ElevationChart.tsx",
  "web/src/features/driving/components/drive-detail/PowerProfileChart.tsx",
  "web/src/features/driving/components/drive-detail/SocChart.tsx",
  "web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx",
  "web/src/features/driving/components/drive-detail/TemperatureSection.tsx",
  "web/src/features/driving/components/drive-detail/TirePressureSection.tsx",
  "web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx",
  "web/src/features/driving/components/drivetrain-health-modernization/PowerHistory.tsx",
  "web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx",
  "web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx",
  "web/src/features/driving/components/drivetrain-health-modernization/TemperatureHistory.tsx",
  "web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx",
  "web/src/features/driving/components/drivetrain-health-modernization/TorqueHistory.tsx",
  "web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx",
  "web/src/features/driving/components/driving-dynamics/MotorHistoryCharts.tsx",
  "web/src/features/driving/components/driving-dynamics-modernization/MotorHistoryCharts.tsx",
  "web/src/features/driving/components/efficiency-modernization/EfficiencyScatter.tsx",
  "web/src/features/driving/components/efficiency-modernization/EfficiencySpeedDistribution.tsx",
  "web/src/features/driving/components/efficiency-modernization/EfficiencyTrend.tsx",
  "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
  "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
  "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
  "web/src/features/sharing/pages/SharedDrivePage.tsx",
  "web/src/features/system/components/FSMTimelineChart.tsx",
  "web/src/features/system/pages/CommandReliabilityPage.tsx",
  "web/src/features/system/pages/DBHealthPage.tsx",
  "web/src/features/system/pages/StateMachineDebuggerPage.tsx",
  "web/src/features/telemetry/components/SignalCompareControls.tsx",
  "web/src/features/telemetry/components/SignalSelector.tsx",
  "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
  "web/src/components/feedback/_StatusAwareError.tsx",
  "web/src/features/sharing/pages/SharedSessionReport.tsx",
  "web/src/features/telemetry/components/SignalLogBreakdownPanel.tsx",
]
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function sort<T>(entries: T[]): T[] {
  return entries.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0)
}
function nested(value: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((v, part) => v && typeof v === 'object' ? (v as Json)[part] : undefined, value)
}
function physical(value: unknown, parts: string[] = []): [string[], unknown][] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, child]) => physical(child, [...parts, key]))
    : [[parts, value]]
}
function acceptedCalls(file: string, text: string): { tree: ts.SourceFile; calls: ts.CallExpression[] } {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const keys = new Set(ownerRecoveryAdditions.map(([key]) => key))
  keys.add('battery.degradation.predictionBandChartAria')
  const calls: ts.CallExpression[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && keys.has(node.arguments[0].text)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { tree, calls }
}
// Reverse only static, accepted literal t-call keys in the exact frozen source set.
// No prefix exclusions, dynamic-key masks, or catalog-derived subtraction.
export function restoreOwnerRecoverySource(file: string, text: string): string {
  text = restoreAcceptedShellSource(file, text)
  const fragments = [
    ['web/src/components/ai/AiLimitBanner.tsx',
      "t('ai.limit.retryIn', 'Try again in {{seconds}}s', {\n              seconds: secondsLeft,\n              defaultValue: 'Try again in {{seconds}}s',\n            })",
      "t('ai.limit.retryIn', `Try again in ${secondsLeft}s`, {\n              seconds: secondsLeft,\n              defaultValue: `Try again in ${secondsLeft}s`,\n            })"],
    ['web/src/components/ui/CommandPalette.tsx',
      "t('palette.clearScope', 'Clear {{scope}} filter', { scope: getScopeMeta(activeScope).label })",
      "t('palette.clearScope', { scope: getScopeMeta(activeScope).label, defaultValue: `Clear ${getScopeMeta(activeScope).label} filter` })"],
    ['web/src/features/admin/components/devtools/tools/RegexTester.tsx',
      "t('devtools.utils.regexEmptyMatch', '(empty match)')", "t('(empty match)')"],
    ['web/src/features/settings/components/GeneralSettings.tsx',
      "t('app.temperatureLabel', 'Temperature')", "t('temperature', 'Temperature')"],
  ] as const
  for (const [path, actual, original] of fragments) {
    if (file !== path) continue
    expect(text.split(actual), file).toHaveLength(2)
    expect(text.includes(original), file).toBe(false)
    for (const [key, value] of finalFourAdditions) expect(nested(catalog, key), key).toBe(value)
    text = text.replace(actual, original)
  }
  if (!sourcePaths.includes(file)) return text
  const reverse = new Map(exactRenames.map(([oldKey, key]) => [key, oldKey]))
  const { tree, calls } = acceptedCalls(file, text)
  for (const call of calls.sort((a, b) => b.getStart(tree) - a.getStart(tree))) {
    const arg = call.arguments[0]
    if (!ts.isStringLiteral(arg)) continue
    const original = reverse.get(arg.text)
    if (original) text = text.slice(0, arg.getStart(tree) + 1) + original + text.slice(arg.getEnd() - 1)
  }
  return text
}
const generated = import.meta.glob<{ default: Json }>('./en/locale-*.json', { eager: true })

// Accepted after this recovery: phase4-sticky-control-localization (1),
// phase4-watch-key-capability (5), phase4-signal-catalog-canonical-repair (6).
// Subtract exact physical paths, not their namespaces or newer-looking siblings.
const acceptedLaterAdditions = [
  ['a11y.scrollToTop', '{{region}} — scroll to top'],
  ['watch.capability.notConfigured', 'Watch access is not configured'],
  ['watch.capability.description', 'Watch readings require a wearable API key in this session. Manage API keys and open your configured watch link to enable readings. Retained readings are not refreshed until access is configured.'],
  ['watch.capability.configure', 'Manage API keys'],
  ['watch.capability.readError', 'Watch access could not be checked'],
  ['watch.capability.readErrorDescription', 'Watch access is unknown because browser session storage could not be read or saved. Retry after storage becomes available. Retained readings remain visible.'],
  ['widget.signalCatalog.destination', 'Destination: {{destination}}'],
  ['widget.signalCatalog.valueKind', 'Value kind'],
  ['widget.signalCatalog.metadataUnavailable', 'Unit and description are not provided by this catalog.'],
  ['widget.signalCatalog.totalSamples', 'Total observations: {{count}}'],
  ['widget.signalCatalog.vehicleCount', 'Vehicles observed: {{count}}'],
  ['widget.signalCatalog.lastSeen', 'Last seen: {{timestamp}}'],
] as const

// The original 115 call sites in sourcePaths order, including repeated keys.
// Accepted presentation changes may alter surrounding bytes/argument whitespace,
// but may not move, remove, duplicate or change these translation contracts.
const expectedOwnerCalls: readonly (readonly string[])[] = [
  ['vehicleVisualization.status.battery', 'vehicleVisualization.status.charging', 'vehicleVisualization.status.locked', 'vehicleVisualization.status.unlocked', 'vehicleVisualization.status.driving', 'vehicleVisualization.status.climate', 'vehicleVisualization.status.sentry', 'vehicleVisualization.status.charging', 'vehicleVisualization.status.notCharging', 'vehicleVisualization.status.locked', 'vehicleVisualization.status.unlocked', 'vehicleVisualization.status.climate', 'vehicleVisualization.status.sentry', 'vehicleVisualization.status.battery', 'vehicleVisualization.status.charging', 'vehicleVisualization.status.battery'],
  ['firmwareImpact.chart.title', 'firmwareImpact.chart.aria'],
  ['regimes.chart.title', 'regimes.chart.aria'],
  ['statistics.stateDistributionAria', 'statistics.vehicleComparisonAria'],
  ['battery.cells.chart.spreadTrendAria'],
  ['battery.degradation.predictionBandChartAria'],
  ['charging.curve.chargerTypeAria'],
  ['charging.curve.sessionComparisonAria'],
  ['charging.curve.powerVsSocAria'],
  ['charging.curve.speedTrendAria'],
  ['charging.curve.yearlyTrendAria'],
  ['costAnalysis.charts.costPerKwhAria'],
  ['costAnalysis.charts.monthlyCostAria'],
  ['dashboard.widgetSettings.allVehicles', 'dashboard.widgetSettings.vehicleName', 'dashboard.widgetSettings.title', 'dashboard.widgetSettings.vehicle', 'dashboard.widgetSettings.vehicle', 'dashboard.widgetSettings.refreshInterval', 'dashboard.widgetSettings.refreshInterval', 'dashboard.widgetSettings.default', 'dashboard.widgetSettings.5s', 'dashboard.widgetSettings.15s', 'dashboard.widgetSettings.30s', 'dashboard.widgetSettings.60s', 'dashboard.widgetSettings.timeRange', 'dashboard.widgetSettings.timeRange', 'dashboard.widgetSettings.24h', 'dashboard.widgetSettings.7d', 'dashboard.widgetSettings.30d', 'dashboard.widgetSettings.90d', 'dashboard.widgetSettings.appearance', 'dashboard.widgetSettings.showTitle'],
  ['widget.recentDrivesListDrive'],
  ['widget.recentDrivesDurationUnit'],
  ['driveScore.categoryBreakdownAria'],
  ['driveScore.scoreDistributionAria'],
  ['driveScore.scoreTrendAria'],
  ['energyAnatomy.sankey.aria'],
  ['driveDetail.driveChartAria'],
  ['driveDetail.elevProfileAria'],
  ['driveDetail.powerProfileAria'],
  ['driveDetail.socOverTimeAria'],
  ['driveDetail.speedHistogramAria'],
  ['driveDetail.temperaturesAria'],
  ['driveDetail.tirePressureAria'],
  ['drivetrain.powerOutputAria'],
  ['drivetrain.powerOutputAria'],
  ['drivetrain.statorTempHistoryAria'],
  ['drivetrain.tempHistoryAria'],
  ['drivetrain.tempHistoryAria'],
  ['drivetrain.torqueHistoryAria'],
  ['drivetrain.torqueHistoryAria'],
  ['dynamics.speedDistributionAria'],
  ['dynamics.powerOverTimeAria', 'dynamics.torqueHistoryAria', 'dynamics.rpmHistoryAria'],
  ['dynamics.powerOverTimeAria', 'dynamics.torqueHistoryAria', 'dynamics.rpmHistoryAria'],
  ['efficiency.speedVsEfficiencyAria', 'efficiency.tempVsEfficiencyAria'],
  ['efficiency.speedDistAria'],
  ['efficiency.dailyTrendAria'],
  ['anomalies.chart.title', 'anomalies.chart.aria'],
  ['landscape.field.title', 'landscape.field.title', 'landscape.field.aria'],
  ['energyAnatomy.sankey.title', 'energyAnatomy.sankey.title'],
  ['share.unavailable.title', 'share.unavailable.description', 'share.unavailable.home', 'share.elevationAria', 'share.speedAria'],
  ['fsm.timelineChartAria'],
  ['commandReliability.chart.title', 'commandReliability.chart.aria'],
  ['dbHealth.chartTitleAria'],
  ['help.fsm.typeAria', 'help.fsm.liveStateAria', 'fsm.distributionByStateAria'],
  ['help.signal.snapshotAria', 'help.signal.diffAria'],
  ['help.signal.layersAria'],
  ['signalCorrelation.correlogram.title', 'signalCorrelation.correlogram.aria', 'signalCorrelation.overlay.title', 'signalCorrelation.overlay.aria'],
  ['error.unsupported.title', 'error.unavailable.title', 'error.request.title'],
  ['share.curveAria'],
  ['signalLog.compositionNoRecords', 'signalLog.compositionEmpty', 'signalLog.compositionNoRecords'],
]
const objectDefaultKeys = new Set([
  'help.fsm.typeAria', 'help.fsm.liveStateAria',
  'help.signal.snapshotAria', 'help.signal.diffAria', 'help.signal.layersAria',
])
const interpolationOptions = new Map([
  ['dashboard.widgetSettings.vehicleName', '{ id: v.id }'],
  ['dashboard.widgetSettings.title', '{ name: def.name }'],
  ['energyAnatomy.sankey.aria', '{\n          total: formatEnergy(totalEnergyWh),\n        }'],
  ['landscape.field.aria', "{\n                  best: landscape.best != null ? cellDescription(landscape.best) : '—',\n                  worst: landscape.worst != null ? cellDescription(landscape.worst) : '—',\n                }"],
])

describe('same attempt3 authorized feature-owned scalar collision recovery', () => {
  it('asserts every exact addition before subtracting only those physical leaves', () => {
    expect(ownerRecoveryAdditions).toHaveLength(95)
    expect(hash(JSON.stringify(ownerRecoveryAdditions))).toBe('a159aee178e404e8e5cfae9fbd480a7e14c3882805b6673f4ea407a8122f969c')
    for (const [key, value] of ownerRecoveryAdditions) expect(nested(catalog, key), key).toBe(value)
    for (const [key, value] of finalFourAdditions) expect(nested(catalog, key), key).toBe(value)
    expect(finalFourAdditions).toHaveLength(4)
    expect(acceptedLaterAdditions).toHaveLength(12)
    const entries = physical(catalog)
    const additions = [...ownerRecoveryAdditions, ...finalFourAdditions, ...acceptedLaterAdditions]
    const acceptedPaths = new Set(additions.map(([key]) => JSON.stringify(key.split('.'))))
    expect(acceptedPaths.size).toBe(111)
    for (const [key, value] of additions) {
      const path = key.split('.')
      expect(entries.filter(([parts]) => JSON.stringify(parts) === JSON.stringify(path)), key)
        .toEqual([[path, value]])
    }
    const predecessor = entries.filter(([parts]) => !acceptedPaths.has(JSON.stringify(parts)))
    expect(predecessor).toHaveLength(32864)
    expect(hash(JSON.stringify(predecessor))).toBe("70128aaf6ae7e368c4708e140e3e82972c4c75023298eb5aafb7249e586a5b4c")
    expect(entries).toHaveLength(32975)
    expect(catalog.vehicle).toBe('vehicle')
    expect(catalog.dashboard.settings).toBe('Settings')
    expect(catalog.share.curve).toBe('Charge curve')
    expect(catalog.signalLog.composition).toBe('Value composition')
    expect(catalog.help.signal.snapshot).toEqual(expect.any(String))
    expect(catalog.systemStatus.incidents.updateCount_other).toBe('{{count}} updates')
    expect(catalog.drives.emptyForCollection.title).toBe('No drives in this view')
  })

  it('pins the exact115 original source-call/default/arity/options fixtures after accepted presentation changes', async () => {
    const english = createInstance()
    await english.init({ lng: 'en', fallbackLng: 'en', fallbackNS: 'translation', saveMissing: false,
      resources: { en: { translation: catalog } }, interpolation: { escapeValue: false } })
    const callFixtures: [string, string, string, string, number][] = []
    const covered = new Set<string>()
    const reverse = new Map(exactRenames.map(([oldKey, key]) => [key, oldKey]))
    expect(expectedOwnerCalls).toHaveLength(54)
    expect(expectedOwnerCalls.flat()).toHaveLength(115)
    for (const [index, file] of sourcePaths.entries()) {
      if (assertCombinedCheckpoint('owner', file)) continue
      const text = readFileSync(resolve(process.cwd(), '..', file), 'utf8')
      const restored = restoreOwnerRecoverySource(file, text)
      const { tree, calls } = acceptedCalls(file, text)
      expect(calls.map(call => (call.arguments[0] as ts.StringLiteral).text), file)
        .toEqual(expectedOwnerCalls[index])
      for (const call of calls) {
        const keyArg = call.arguments[0]
        expect(ts.isStringLiteral(keyArg)).toBe(true)
        if (!ts.isStringLiteral(keyArg)) throw new Error('Literal key required')
        const key = keyArg.text
        const originalKey = reverse.get(key) || key
        const actual = call.getText(tree)
        const original = actual.slice(0, keyArg.getStart(tree) - call.getStart(tree) + 1)
          + originalKey + actual.slice(keyArg.getEnd() - call.getStart(tree) - 1)
        callFixtures.push([file, originalKey, key, original, call.arguments.length])
        covered.add(key)
        const value = key === 'battery.degradation.predictionBandChartAria'
          ? 'Battery health trend and approximate prediction band chart'
          : ownerRecoveryAdditions.find(([candidate]) => candidate === key)?.[1]
        expect(value, key).toBeTypeOf('string')
        // Canonical English can hide a broken caller fallback. Pin the actual
        // source defaults and complete option operands separately from rendering.
        if (objectDefaultKeys.has(key)) {
          expect(call.arguments[1].getText(tree), file + ': ' + key)
            .toBe(`{ defaultValue: '${value}' }`)
        } else {
          const fallback = call.arguments[1]
          expect(ts.isStringLiteral(fallback), file + ': ' + key).toBe(true)
          if (!ts.isStringLiteral(fallback)) throw new Error('Literal fallback required')
          expect(fallback.text, file + ': ' + key).toBe(value)
        }
        const options = interpolationOptions.get(key)
        expect(call.arguments.length, file + ': ' + key).toBe(options === undefined ? 2 : 3)
        expect(call.arguments[2]?.getText(tree), file + ': ' + key).toBe(options)
        expect(restored, file + ': ' + original).toContain(original)
        expect(english.exists(key, { ns: 'translation' }), key).toBe(true)
        expect(english.t(key, { ns: 'translation', skipInterpolation: true }), key).toBe(value)
        // Evaluate the unchanged actual source call, including its real option object.
        const evaluate = new Function('t', 'v', 'def', 'formatEnergy', 'totalEnergyWh', 'landscape', 'cellDescription', `return ${actual}`) as
          (...args: unknown[]) => unknown
        const actualResult = evaluate(english.getFixedT('en', 'translation'), { id: 7 }, { name: 'Speed' },
          () => '12 kWh', 12000, { best: 'best', worst: 'worst' }, (value: string) => value)
        const expected = value?.replace('{{id}}', '7').replace('{{name}}', 'Speed')
          .replace('{{total}}', '12 kWh').replace('{{best}}', 'best').replace('{{worst}}', 'worst')
        expect(actualResult, file + ': ' + actual).toBe(expected)
      }
    }
    expect(sourcePaths).toHaveLength(54)
    expect(callFixtures).toHaveLength(103)
    expect(sort(callFixtures.map(([file, originalKey, key]) => [file, originalKey, key])))
      .toEqual(sort(expectedOwnerCalls.flatMap((keys, index) =>
        currentOwnerCheckpointFiles.includes(sourcePaths[index]) ? []
          : keys.map(key => [sourcePaths[index], reverse.get(key) || key, key]))))
    expect(covered.size).toBe(83)
  })

  it('resolves all exact pairs from normal generated resources without aliases or object replacement', async () => {
    const resources = [shell, ...Object.values(generated).map(module => module.default)]
    const english = createInstance()
    await english.init({ lng: 'en', fallbackLng: 'en', fallbackNS: 'translation',
      resources: { en: { translation: catalog } }, interpolation: { escapeValue: false } })
    for (const [key, value] of ownerRecoveryAdditions) {
      expect(resources.some(resource => nested(resource, key) === value), key).toBe(true)
      for (const count of [0, 1, 2]) {
        expect(english.t(key, { ns: 'translation', count, skipInterpolation: true, returnObjects: true }), key).toBe(value)
      }
    }
    for (const [key, value] of [
      ['share.curve', 'Charge curve'], ['signalLog.composition', 'Value composition'], ['vehicle', 'vehicle'],
    ]) expect(english.t(key, { ns: 'translation' })).toBe(value)
    expect(baseline).toEqual([])
    expect(runtimeManifest.missing).toEqual([])
    expect(usageManifest.knownMissingKeys).toEqual([])
    for (const [key, value] of ownerRecoveryAdditions.filter(([key]) => key.startsWith('error.') && key.endsWith('.title'))) {
      expect(nested(shell, key)).toBe(value)
      expect(nested(generated['./en/locale-detail-error.json'].default, key)).toBe(value)
    }
  })
})
