# Accessibility Audit

Generated: `2026-05-01T18:17:02Z` UTC by `scripts/a11y-audit.ps1`.

Policy: see [A11Y_GUIDELINES.md](../A11Y_GUIDELINES.md).

## Summary

| Check | Hits |
|-------|-----:|
| Buttons without accessible name | 44 |
| `<Input>` without `label` or `aria-label` | 32 |
| `<img>` without `alt` | 0 |
| Red background with no status icon nearby | 49 |
| framer-motion files without `useMotionPreference` opt-out | 24 |

These checks use heuristics (regex + small windows of context). Treat
them as a TODO list — false positives are expected and a manual
inspection by Lighthouse / axe-core devtools should accompany any
remediation.

## Buttons without accessible name

| File | Line | Snippet |
|------|-----:|---------|
| `web\src\components\charts\ChartContainer.tsx` | 73 | `<button` |
| `web\src\components\charts\ChartContainer.tsx` | 93 | `<Button` |
| `web\src\components\feedback\AlertBanner.tsx` | 49 | `<button onClick={onClose} className={cn('shrink-0 rounded-lg p-1 transition-colors hover:bg-white…` |
| `web\src\components\feedback\InstallPrompt.tsx` | 107 | `<Button` |
| `web\src\components\feedback\InstallPrompt.tsx` | 115 | `<Button` |
| `web\src\components\feedback\OnboardingWizard.tsx` | 93 | `<button` |
| `web\src\components\feedback\OnboardingWizard.tsx` | 139 | `<button` |
| `web\src\components\feedback\ReloadPrompt.tsx` | 75 | `<Button` |
| `web\src\components\layout\Layout.tsx` | 1044 | `<Button` |
| `web\src\components\ui\Button.tsx` | 27 | `<button` |
| `web\src\components\ui\CommandPalette.tsx` | 580 | `<button` |
| `web\src\components\ui\ConfirmDialog.tsx` | 125 | `<Button` |
| `web\src\components\ui\Tooltip.tsx` | 35 | `// <button>/<IconBox>/etc.). For text-only or multiple children we fall back` |
| `web\src\features\admin\components\devtools\CopyButton.tsx` | 22 | `<Button` |
| `web\src\features\admin\components\devtools\FleetApiSection.tsx` | 759 | `<Button` |
| `web\src\features\admin\pages\BackupRestorePage.tsx` | 599 | `<Button` |
| `web\src\features\admin\pages\BackupRestorePage.tsx` | 840 | `<Button` |
| `web\src\features\analytics\components\weekly-digest\WeekSelector.tsx` | 22 | `<Button` |
| `web\src\features\analytics\components\weekly-digest\WeekSelector.tsx` | 39 | `<Button` |
| `web\src\features\battery\components\TOUSettingsModal.tsx` | 286 | `<Button` |
| `web\src\features\charging\pages\TeslaChargingHistoryPage.tsx` | 232 | `<Button` |
| `web\src\features\charging\pages\TeslaChargingSessionsPage.tsx` | 251 | `<Button` |
| `web\src\features\dashboard\components\ExportModal.tsx` | 96 | `<Button` |
| `web\src\features\dashboard\components\ExportModal.tsx` | 106 | `<Button` |
| `web\src\features\dashboard\components\ExportModal.tsx` | 122 | `<Button` |
| `web\src\features\maps\pages\GeofencesPage.tsx` | 529 | `<Button` |
| `web\src\features\maps\pages\GeofencesPage.tsx` | 599 | `<Button` |
| `web\src\features\maps\pages\NavigationRoutePage.tsx` | 516 | `<Button` |
| `web\src\features\notifications\pages\NotificationsPage.tsx` | 365 | `<Button` |
| `web\src\features\onboarding\components\Stepper.tsx` | 126 | `<Button` |
| `web\src\features\onboarding\pages\OnboardingPage.tsx` | 144 | `<Button` |
| `web\src\features\onboarding\pages\OnboardingPage.tsx` | 158 | `<Button` |
| `web\src\features\system\components\CommandConfirmDialog.tsx` | 110 | `<Button` |
| `web\src\features\system\components\CommandConfirmDialog.tsx` | 119 | `<Button` |
| `web\src\features\system\components\CommandInputDialog.tsx` | 208 | `<Button` |
| `web\src\features\system\components\CommandInputDialog.tsx` | 217 | `<Button` |
| `web\src\features\system\pages\ChatbotPage.tsx` | 139 | `<Button` |
| `web\src\features\system\pages\ChatbotPage.tsx` | 280 | `<Button` |
| `web\src\features\system\pages\DataExportPage.tsx` | 620 | `<Button` |
| `web\src\features\system\pages\DataExportPage.tsx` | 892 | `<Button` |
| `web\src\features\telemetry\pages\SignalExplorerPage.tsx` | 370 | `<Button` |
| `web\src\features\telemetry\pages\SignalLogViewerPage.tsx` | 240 | `<Button` |
| `web\src\features\vehicle-systems\pages\MaintenancePage.tsx` | 539 | `<Button` |
| `web\src\features\vehicle-systems\pages\TirePressurePage.tsx` | 417 | `<Button` |

## `<Input>` without `label` or `aria-label`

| File | Line | Snippet |
|------|-----:|---------|
| `web\src\components\forms\DateRangeFilter.tsx` | 32 | `<input` |
| `web\src\components\forms\DateRangeFilter.tsx` | 39 | `<input` |
| `web\src\components\forms\SearchInput.tsx` | 31 | `* Rendered as a wrapper around the shared `<Input>` component using its `icon`` |
| `web\src\components\forms\SearchInput.tsx` | 67 | `<Input` |
| `web\src\components\SignalQueryControls.tsx` | 142 | `<Input` |
| `web\src\components\SignalQueryControls.tsx` | 191 | `<input type="datetime-local" step="1" value={fromStr} onChange={e => onFromChange(e.target.value)…` |
| `web\src\components\SignalQueryControls.tsx` | 195 | `<input type="datetime-local" step="1" value={toStr} onChange={e => onToChange(e.target.value)} cl…` |
| `web\src\components\ui\__tests__\CommandPalette.test.tsx` | 111 | `it('does NOT open on Ctrl+K while focus is in an external <input>', async () => {` |
| `web\src\components\ui\__tests__\CommandPalette.test.tsx` | 115 | `<input data-testid="external-input" />` |
| `web\src\components\ui\CommandPalette.tsx` | 597 | `<Input` |
| `web\src\components\ui\Input.tsx` | 24 | `<input` |
| `web\src\components\ui\SignalConfigModal.tsx` | 228 | `<Input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search s…` |
| `web\src\features\admin\components\devtools\tools\HttpStatusTool.tsx` | 47 | `<Input` |
| `web\src\features\admin\components\devtools\tools\TeslaApiRefTool.tsx` | 53 | `<Input` |
| `web\src\features\admin\pages\ApiLogsPage.tsx` | 57 | `// localDateTimeToISO converts a `<input type="datetime-local">` value (local` |
| `web\src\features\dashboard\widgets\SignalCatalogWidget.tsx` | 95 | `<Input` |
| `web\src\features\driving\components\ShareDriveDialog.tsx` | 70 | `<Input` |
| `web\src\features\driving\components\ShareDriveDialog.tsx` | 110 | `<Input value={shareUrl} readOnly />` |
| `web\src\features\settings\components\AppearanceSettings.tsx` | 150 | `<Input` |
| `web\src\features\settings\components\AppearanceSettings.tsx` | 160 | `<Input` |
| `web\src\features\settings\components\GeneralSettings.tsx` | 197 | `<Input` |
| `web\src\features\settings\components\GeneralSettings.tsx` | 211 | `<Input` |
| `web\src\features\settings\components\GeneralSettings.tsx` | 229 | `<Input` |
| `web\src\features\settings\components\GeneralSettings.tsx` | 240 | `<Input` |
| `web\src\features\system\components\CommandConfirmDialog.tsx` | 98 | `<Input` |
| `web\src\features\system\components\CommandSearch.tsx` | 14 | `<Input` |
| `web\src\features\telemetry\pages\SignalDiffPage.tsx` | 190 | `<Input type="datetime-local" value={rangeAFrom} onChange={(e) => setRangeAFrom(e.target.value)} c…` |
| `web\src\features\telemetry\pages\SignalDiffPage.tsx` | 191 | `<Input type="datetime-local" value={rangeATo} onChange={(e) => setRangeATo(e.target.value)} class…` |
| `web\src\features\telemetry\pages\SignalDiffPage.tsx` | 197 | `<Input type="datetime-local" value={rangeBFrom} onChange={(e) => setRangeBFrom(e.target.value)} c…` |
| `web\src\features\telemetry\pages\SignalDiffPage.tsx` | 198 | `<Input type="datetime-local" value={rangeBTo} onChange={(e) => setRangeBTo(e.target.value)} class…` |
| `web\src\features\telemetry\pages\SignalExplorerPage.tsx` | 297 | `<Input` |
| `web\src\features\telemetry\pages\SignalLogViewerPage.tsx` | 170 | `<Input` |

## `<img>` without `alt`

_

## Solid red background with no status icon nearby

| File | Line | Snippet |
|------|-----:|---------|
| `web\src\components\feedback\QueryError.tsx` | 5 | `<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 mb-6 backdrop-blur-sm">` |
| `web\src\components\feedback\QueryError.tsx` | 7 | `<div className="shrink-0 mt-0.5 rounded-lg bg-red-500/10 p-2">` |
| `web\src\components\feedback\QueryError.tsx` | 19 | `className="shrink-0 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:b…` |
| `web\src\components\ui\Button.tsx` | 8 | `danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',` |
| `web\src\features\admin\components\EndpointSidebar.tsx` | 48 | `DELETE: 'bg-red-500/20 text-red-400',` |
| `web\src\features\admin\components\ResponseViewer.tsx` | 54 | `return 'bg-red-500/10 border-red-500/20';` |
| `web\src\features\admin\components\ResponseViewer.tsx` | 245 | `h.method === 'DELETE' ? 'bg-red-500/20 text-red-400' :` |
| `web\src\features\admin\components\security-access\EventTimeline.tsx` | 104 | `? 'bg-red-500/20 text-red-400'` |
| `web\src\features\automations\pages\AutomationCard.tsx` | 175 | `className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-red-400 hover:!b…` |
| `web\src\features\battery\pages\BatteryCellsPage.tsx` | 186 | `<span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />` |
| `web\src\features\battery\pages\BatteryDegradationPage.tsx` | 65 | `return 'bg-red-500';` |
| `web\src\features\battery\pages\ProjectedRangePage.tsx` | 76 | `return 'bg-red-500';` |
| `web\src\features\charging\components\charging-curve\YearlyTrendChart.tsx` | 109 | `<span className="inline-block h-2 w-3 rounded-sm bg-red-500 opacity-30" />` |
| `web\src\features\charging\components\charging-list\OptimizerSection.tsx` | 147 | `rec.priority === 'high' ? 'bg-red-500/[0.06] border border-red-500/10' :` |
| `web\src\features\charging\components\charging-list\OptimizerSection.tsx` | 160 | `rec.priority === 'high' ? 'bg-red-500/20 text-red-400' :` |
| `web\src\features\charging\components\cost-analysis\TimeOfUseAnalysis.tsx` | 70 | `<div className="h-3 w-3 rounded-full bg-red-500" />` |
| `web\src\features\charging\components\RateTimeline.tsx` | 15 | `ON_PEAK: 'bg-red-500/40',` |
| `web\src\features\charging\components\RateTimeline.tsx` | 72 | `<span className="w-3 h-3 rounded-sm bg-red-500/40" />` |
| `web\src\features\dashboard\components\LayoutManager.tsx` | 45 | `? 'text-red-400 hover:bg-red-500/10'` |
| `web\src\features\dashboard\widgets\BackupMonitorWidget.tsx` | 30 | `return 'bg-red-500 shadow-red-500/40';` |
| `web\src\features\dashboard\widgets\BackupMonitorWidget.tsx` | 174 | `latestStatus === 'failed' && 'bg-red-500/10',` |
| `web\src\features\dashboard\widgets\ChargingOptimizerWidget.tsx` | 189 | `isPeak && 'bg-red-500/30',` |
| `web\src\features\dashboard\widgets\shared\WidgetStatusGrid.tsx` | 31 | `bg: 'bg-red-500/10 border-red-500/20',` |
| `web\src\features\dashboard\widgets\shared\WidgetStatusGrid.tsx` | 32 | `dot: 'bg-red-500',` |
| `web\src\features\dashboard\widgets\SystemHealthWidget.tsx` | 23 | `return 'bg-red-500 shadow-red-500/40';` |
| `web\src\features\dashboard\widgets\UptimeMonitorWidget.tsx` | 26 | `: 'bg-red-500 shadow-red-500/40';` |
| `web\src\features\diagnostics\pages\AnomalyDashboardPage.tsx` | 48 | `if (s === 'critical') return 'bg-red-500/10 border-red-500/20';` |
| `web\src\features\diagnostics\pages\AnomalyDashboardPage.tsx` | 189 | `a.severity === 'critical' ? 'bg-red-500/[0.05] border-red-500/15' :` |
| `web\src\features\driving\components\drive-detail\RouteMapSection.tsx` | 85 | `<span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-red-50…` |
| `web\src\features\driving\components\driving-dynamics\DrivingCoachSection.tsx` | 117 | `style === 'moderate' ? 'bg-neon-amber' : 'bg-red-500',` |
| `web\src\features\driving\components\driving-dynamics\DrivingCoachSection.tsx` | 129 | `{ key: 'aggressive', color: 'bg-red-500', text: 'text-red-400' },` |
| `web\src\features\driving\components\driving-dynamics\DrivingCoachSection.tsx` | 209 | `p.value <= p.hi ? 'bg-neon-amber' : 'bg-red-500',` |
| `web\src\features\driving\pages\SpeedProfilePage.tsx` | 265 | `<span className="inline-block w-2 h-2 rounded-full bg-red-500" /> {t('speedProfile.highConsumptio…` |
| `web\src\features\system\components\status\DiagnosticsSection.tsx` | 142 | `<div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{w.error}</div>` |
| `web\src\features\system\pages\SystemStatusPage.tsx` | 99 | `overallStatus === 'unhealthy' && 'bg-red-500/20 ring-red-500/40',` |
| `web\src\features\telemetry\pages\SignalExplorerPage.tsx` | 387 | `<span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />` |
| `web\src\features\telemetry\pages\SignalExplorerPage.tsx` | 420 | `<span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />` |
| `web\src\features\vehicle-systems\pages\ClimateControlPage.tsx` | 838 | `: 'bg-red-500/20',` |
| `web\src\features\vehicle-systems\pages\ClimateControlPage.tsx` | 886 | `: 'bg-red-500/20',` |
| `web\src\features\vehicle-systems\pages\ClimateControlPage.tsx` | 929 | `: 'bg-red-500/20',` |
| `web\src\features\vehicle-systems\pages\GuardModePage.tsx` | 218 | `isTriggered && 'bg-red-500/20 text-red-400',` |
| `web\src\features\vehicle-systems\pages\GuardModePage.tsx` | 296 | `className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl transition-all…` |
| `web\src\features\vehicle-systems\pages\GuardModePage.tsx` | 531 | `: 'border-red-500/20 bg-red-500/[0.03]',` |
| `web\src\features\vehicles\components\telemetry-panels\PowertrainPanel.tsx` | 42 | `? 'border-red-500/30 bg-red-500/10 text-red-400'` |
| `web\src\features\vehicles\components\telemetry-panels\PowertrainPanel.tsx` | 67 | `motorData.power_kw >= 0 ? 'bg-green-500/60' : 'bg-red-500/60',` |
| `web\src\features\vehicles\components\telemetry-panels\SecurityPanel.tsx` | 69 | `? 'border-red-500/30 bg-red-500/10 text-red-400'` |
| `web\src\features\vehicles\components\telemetry-panels\TirePressurePanel.tsx` | 114 | `? 'border-red-500/30 bg-red-500/10 text-red-400'` |
| `web\src\features\vehicles\components\VehicleCard.tsx` | 139 | `className="rounded-lg p-2 text-gray-400 hover:bg-red-500/10 hover:text-red-500"` |
| `web\src\features\vehicles\pages\VehicleListPage.tsx` | 374 | `className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-red-500"` |

## framer-motion files without `useMotionPreference` opt-out

- `web\src\components\data-display\DriveScore.tsx`
- `web\src\components\data-display\MetricBar.tsx`
- `web\src\components\data-display\PollingEngine.tsx`
- `web\src\components\data-display\ServiceStatus.tsx`
- `web\src\components\data-display\TeslaCarViz.tsx`
- `web\src\components\feedback\InstallPrompt.tsx`
- `web\src\components\forms\SearchInput.test.tsx`
- `web\src\components\layout\Layout.tsx`
- `web\src\components\ui\Accordion.tsx`
- `web\src\components\ui\CommandPalette.tsx`
- `web\src\components\ui\Drawer.tsx`
- `web\src\components\vehicles\VehicleTwin.tsx`
- `web\src\features\analytics\components\review\ChargingBreakdownSlide.tsx`
- `web\src\features\analytics\components\review\ComparisonsSlide.tsx`
- `web\src\features\analytics\components\review\DriveHighlightSlide.tsx`
- `web\src\features\analytics\components\review\EnvironmentSlide.tsx`
- `web\src\features\analytics\components\review\PatternsSlide.tsx`
- `web\src\features\analytics\components\review\SavingsSlide.tsx`
- `web\src\features\analytics\components\review\SlideRenderer.tsx`
- `web\src\features\analytics\components\review\StatChartSlide.tsx`
- `web\src\features\analytics\components\review\StatHeroSlide.tsx`
- `web\src\features\analytics\components\review\SummarySlide.tsx`
- `web\src\features\analytics\components\review\TitleSlide.tsx`
- `web\src\features\system\pages\StateMachineDebuggerPage.tsx`

