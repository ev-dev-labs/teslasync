# Accessibility Audit

Generated: `2026-08-25T15:48:10Z` UTC by `scripts/a11y-audit.ps1`.

Policy: see [A11Y_GUIDELINES.md](../A11Y_GUIDELINES.md).

## Summary

| Check | Hits |
|-------|-----:|
| Buttons without accessible name | 295 |
| `<Input>` without `label` or `aria-label` | 89 |
| `<img>` without `alt` | 7 |
| Red background with no status icon nearby | 71 |
| framer-motion files without `useMotionPreference` opt-out | 36 |

These checks use heuristics (regex + small windows of context). Treat
them as a TODO list — false positives are expected and a manual
inspection by Lighthouse / axe-core devtools should accompany any
remediation.

## Buttons without accessible name

| File | Line | Snippet |
|------|-----:|---------|
| `web\src\components\ai\AIAlertTuningSuggestions.tsx` | 197 | `<Button` |
| `web\src\components\ai\AIAutoNameUnnamedLocations.tsx` | 194 | `<Button` |
| `web\src\components\ai\AIFeatureCard.tsx` | 280 | `<Button` |
| `web\src\components\ai\AIGeofenceAwareAutomationSuggestions.tsx` | 283 | `<Button` |
| `web\src\components\ai\AIInboxAutoCategorization.tsx` | 256 | `<Button` |
| `web\src\components\ai\AiLimitBanner.tsx` | 154 | `<Button` |
| `web\src\components\ai\AiLimitBanner.tsx` | 164 | `<Button` |
| `web\src\components\ai\AINLDashboardComposer.tsx` | 197 | `<Button` |
| `web\src\components\ai\AINLGrafanaPanel.tsx` | 211 | `<Button` |
| `web\src\components\ai\AINLSqlPlayground.tsx` | 203 | `<Button` |
| `web\src\components\ai\AIQuietHoursSuggestion.tsx` | 214 | `<Button` |
| `web\src\components\ai\AISignalExplorerNlFilter.tsx` | 218 | `<Button` |
| `web\src\components\ai\AISuggestNewGeofences.tsx` | 277 | `<Button` |
| `web\src\components\ai\AIVoiceMode.tsx` | 495 | `<Button` |
| `web\src\components\charts\ChartContainer.tsx` | 499 | `<Button` |
| `web\src\components\charts\ChartExportMenu.tsx` | 136 | `<Button` |
| `web\src\components\charts\ChartExportMenu.tsx` | 159 | `<Button` |
| `web\src\components\charts\ChartExportMenu.tsx` | 175 | `<Button` |
| `web\src\components\charts\ChartExportMenu.tsx` | 192 | `<Button` |
| `web\src\components\charts\ChartExportMenu.tsx` | 209 | `<Button` |
| `web\src\components\charts\ChartLegend.tsx` | 114 | `<Button` |
| `web\src\components\data-display\BulkActionsToolbar.tsx` | 170 | `<Button` |
| `web\src\components\data-display\BulkActionsToolbar.tsx` | 185 | `<Button` |
| `web\src\components\data-display\DataFreshness.tsx` | 261 | `<Button` |
| `web\src\components\data-display\HistoryListRow.tsx` | 44 | `* already a `<Button>` from `components/ui`).` |
| `web\src\components\data-display\TimelineScrubber.tsx` | 462 | `<button` |
| `web\src\components\feedback\_StatusAwareError.tsx` | 207 | `<Button` |
| `web\src\components\feedback\AchievementUnlockedToast.tsx` | 155 | `<button` |
| `web\src\components\feedback\DataSourceNotice.tsx` | 206 | `<Button` |
| `web\src\components\feedback\DraftRecoveryBanner.tsx` | 93 | `<Button` |
| `web\src\components\feedback\DraftRecoveryBanner.tsx` | 101 | `<Button` |
| `web\src\components\feedback\DraftRestorePrompt.tsx` | 213 | `<Button` |
| `web\src\components\feedback\DraftRestorePrompt.tsx` | 221 | `<Button` |
| `web\src\components\feedback\DraftRestorePrompt.tsx` | 307 | `<Button` |
| `web\src\components\feedback\EditConflictBanner.tsx` | 83 | `<Button` |
| `web\src\components\feedback\ImpersonationBanner.tsx` | 121 | `<button` |
| `web\src\components\feedback\InlineCallout.tsx` | 95 | `<button` |
| `web\src\components\feedback\InstallPrompt.tsx` | 142 | `<Button` |
| `web\src\components\feedback\InstallPrompt.tsx` | 150 | `<Button` |
| `web\src\components\feedback\OnboardingWizard.tsx` | 225 | `<button` |
| `web\src\components\feedback\RateLimitBanner.tsx` | 136 | `<Button` |
| `web\src\components\feedback\ReauthDialog.tsx` | 597 | `<Button` |
| `web\src\components\feedback\ReauthDialog.tsx` | 606 | `<Button` |
| `web\src\components\feedback\ReloadPrompt.tsx` | 123 | `<Button` |
| `web\src\components\feedback\ReloadPrompt.tsx` | 132 | `<Button` |
| `web\src\components\feedback\SessionExpiredModal.tsx` | 92 | `<Button` |
| `web\src\components\feedback\SessionExpiringModal.tsx` | 217 | `<Button` |
| `web\src\components\feedback\TimeMachineBanner.tsx` | 155 | `<Button` |
| `web\src\components\feedback\TimeMachineBanner.tsx` | 187 | `<Button` |
| `web\src\components\feedback\Toast.tsx` | 44 | `*  - Callback action: `{ label, onClick }` renders a `<button>` that fires` |
| `web\src\components\feedback\TourOverlay.tsx` | 109 | `<button` |
| `web\src\components\feedback\TourOverlay.tsx` | 132 | `<button` |
| `web\src\components\forms\ActiveFilterChips.tsx` | 221 | `<button` |
| `web\src\components\forms\DatePresetChips.test.tsx` | 6 | `*      shared <Button> (real, keyboard-operable, type="button").` |
| `web\src\components\forms\DatePresetChips.tsx` | 4 | `* Renders a row of `<Button>` chips, one per preset id. Calls `onSelect`` |
| `web\src\components\forms\ListExportMenu.tsx` | 116 | `<Button` |
| `web\src\components\forms\ListExportMenu.tsx` | 167 | `<button` |
| `web\src\components\forms\ListExportMenu.tsx` | 181 | `<button` |
| `web\src\components\forms\RangePicker.tsx` | 301 | `<Button` |
| `web\src\components\forms\TreeSelect.tsx` | 442 | `<Button` |
| `web\src\components\forms\VehicleMultiSelect.tsx` | 15 | `* - Option items render as `<button role="checkbox" aria-checked>`,` |
| `web\src\components\forms\VehicleMultiSelect.tsx` | 225 | `<button` |
| `web\src\components\forms\VehicleMultiSelect.tsx` | 282 | `<button` |
| `web\src\components\layout\CopyLinkButton.tsx` | 70 | `<Button` |
| `web\src\components\layout\Layout.tsx` | 745 | `<Button` |
| `web\src\components\layout\Layout.tsx` | 1531 | `<Button` |
| `web\src\components\layout\NotificationBellPopover.tsx` | 219 | `<button` |
| `web\src\components\layout\NotificationBellPopover.tsx` | 511 | `<button` |
| `web\src\components\layout\sidebar\LinearSidebar.tsx` | 182 | `<Button` |
| `web\src\components\layout\sidebar\NotionSidebar.tsx` | 156 | `<Button` |
| `web\src\components\layout\status-bar\ActiveVehicleSegment.tsx` | 101 | `<Button` |
| `web\src\components\layout\WorkspaceContextControl.tsx` | 135 | `<Button` |
| `web\src\components\status\StatusHero.tsx` | 105 | `<Button` |
| `web\src\components\ui\Accordion.test.tsx` | 232 | `// Native <button type="button"> → platform keyboard operability, no submit.` |
| `web\src\components\ui\Accordion.tsx` | 63 | `<button` |
| `web\src\components\ui\Button.tsx` | 21 | `* `<button>` (EmptyState's `actionTo`), and previously hand-copied these` |
| `web\src\components\ui\Button.tsx` | 55 | `<button` |
| `web\src\components\ui\ConfirmDialog.tsx` | 191 | `<Button` |
| `web\src\components\ui\CopyButton.tsx` | 99 | `<Button` |
| `web\src\components\ui\DataTableBulkBar.tsx` | 39 | `<button` |
| `web\src\components\ui\DataTableColumnsMenu.tsx` | 150 | `<button` |
| `web\src\components\ui\EditableText.tsx` | 362 | `<button` |
| `web\src\components\ui\FullscreenButton.tsx` | 55 | `* Optional class merged onto the underlying `<Button>`. Default` |
| `web\src\components\ui\FullscreenButton.tsx` | 61 | `* Forwarded to `<Button size>`. Defaults to `sm`. When `sm` is` |
| `web\src\components\ui\FullscreenButton.tsx` | 172 | `<Button` |
| `web\src\components\ui\PrintButton.tsx` | 84 | `<Button` |
| `web\src\components\ui\SelectableCard.test.tsx` | 8 | `*   1. It renders a REAL native `<button>` — keyboard operability, focus, and` |
| `web\src\components\ui\SelectableCard.test.tsx` | 20 | `*      `<button>`.` |
| `web\src\components\ui\SelectableCard.tsx` | 16 | `* Renders a real `<button>` so keyboard operability and focus-visible rings` |
| `web\src\components\ui\SelectableCard.tsx` | 34 | `<button` |
| `web\src\components\ui\TabNav.tsx` | 37 | `<button` |
| `web\src\components\ui\Toggle.test.tsx` | 22 | `* test here (Select, Slider, FullscreenButton). The rendered `<button>` is a` |
| `web\src\components\ui\Tooltip.tsx` | 130 | `* - Wrap a focusable trigger (e.g. <button>) and tapping it grants focus,` |
| `web\src\features\action-center\components\RecommendationCard.tsx` | 113 | `<Button` |
| `web\src\features\admin\components\api-keys\CreateApiKeyModal.tsx` | 114 | `<Button` |
| `web\src\features\admin\components\devtools\FleetApiSection.tsx` | 814 | `<Button` |
| `web\src\features\admin\components\devtools\tools\Base64Tool.tsx` | 67 | `<Button` |
| `web\src\features\admin\components\devtools\tools\Base64Tool.tsx` | 75 | `<Button` |
| `web\src\features\admin\components\devtools\tools\TimestampTool.tsx` | 111 | `<Button` |
| `web\src\features\admin\components\devtools\tools\UrlEncoder.tsx` | 55 | `<Button` |
| `web\src\features\admin\components\devtools\tools\UrlEncoder.tsx` | 63 | `<Button` |
| `web\src\features\admin\components\dlq-inspector\EntriesTable.tsx` | 8 | `* No raw `<table>` / `<button>` — every interactive surface is a shared` |
| `web\src\features\admin\components\dlq-inspector\EntryDrawer.tsx` | 219 | `<Button` |
| `web\src\features\admin\components\feature-flags\FlagEditDrawer.tsx` | 117 | `<Button` |
| `web\src\features\admin\components\gdpr-export\GDPRLookupPanel.tsx` | 45 | `<Button` |
| `web\src\features\admin\components\QueueStatusPanel.tsx` | 88 | `<Button` |
| `web\src\features\admin\components\UserImpersonateButton.tsx` | 56 | `<Button` |
| `web\src\features\admin\components\vehicle-cost\VehicleCostToolbar.test.tsx` | 5 | `* Cost page — a trailing-window `<Select>` and a manual refresh `<Button>`. It` |
| `web\src\features\admin\pages\ApiLogsPage.tsx` | 388 | `<Button` |
| `web\src\features\admin\pages\BackupRestorePage.tsx` | 683 | `<Button` |
| `web\src\features\admin\pages\BackupRestorePage.tsx` | 1025 | `<Button` |
| `web\src\features\admin\pages\FeatureFlagsPage.tsx` | 272 | `<Button` |
| `web\src\features\admin\pages\FeedbackQueuePage.tsx` | 263 | `<Button` |
| `web\src\features\admin\pages\FeedbackQueuePage.tsx` | 274 | `<Button` |
| `web\src\features\admin\pages\FeedbackQueuePage.tsx` | 285 | `<Button` |
| `web\src\features\admin\pages\LiveLogsPage.tsx` | 563 | `<Button` |
| `web\src\features\admin\pages\LiveLogsPage.tsx` | 572 | `<Button` |
| `web\src\features\admin\pages\LiveLogsPage.tsx` | 582 | `<Button` |
| `web\src\features\admin\pages\RbacMatrixPage.tsx` | 544 | `<Button` |
| `web\src\features\admin\pages\RbacMatrixPage.tsx` | 552 | `<Button` |
| `web\src\features\admin\pages\RedisSignalViewerPage.tsx` | 643 | `<Button` |
| `web\src\features\admin\pages\RedisSignalViewerPage.tsx` | 654 | `<Button` |
| `web\src\features\admin\pages\SystemPage.tsx` | 75 | `<Button` |
| `web\src\features\admin\pages\TeslaOrdersPage.tsx` | 78 | `<Button` |
| `web\src\features\admin\pages\TeslaRegionPage.tsx` | 56 | `<Button` |
| `web\src\features\admin\pages\UsersPage.tsx` | 77 | `<Button` |
| `web\src\features\advanced-intelligence\components\TwinScenarioForm.tsx` | 130 | `<Button` |
| `web\src\features\advanced-intelligence\components\TwinScenarioForm.tsx` | 139 | `<Button` |
| `web\src\features\advanced-intelligence\pages\ChargingSiteTwinPage.tsx` | 190 | `<Button` |
| `web\src\features\advanced-intelligence\pages\EmergencyResiliencePage.tsx` | 157 | `<Button` |
| `web\src\features\advanced-intelligence\pages\JourneyAssurancePage.tsx` | 151 | `<Button` |
| `web\src\features\advanced-intelligence\pages\TCOOptimizerPage.tsx` | 160 | `<Button` |
| `web\src\features\analytics\components\carbon-intelligence\CarbonSourceRow.tsx` | 113 | `<Button` |
| `web\src\features\analytics\components\carbon-intelligence\CarbonSourceRow.tsx` | 137 | `<Button` |
| `web\src\features\analytics\components\weekly-digest\WeekSelector.tsx` | 48 | `<Button` |
| `web\src\features\analytics\pages\DriveArchetypesPage.tsx` | 105 | `<Button` |
| `web\src\features\battery\components\battery-passport\BatteryPassportMasthead.tsx` | 172 | `<Button` |
| `web\src\features\battery\components\cycle-stress\CycleStressQueryStatus.tsx` | 95 | `<Button` |
| `web\src\features\battery\components\cycle-stress\CycleStressQueryStatus.tsx` | 132 | `<Button` |
| `web\src\features\battery\components\pack-capacity\PackCapacityQueryStatus.tsx` | 91 | `<Button` |
| `web\src\features\battery\components\TOUSettingsModal.tsx` | 294 | `<Button` |
| `web\src\features\benchmarks\components\ConsentGate.tsx` | 57 | `<Button` |
| `web\src\features\charging\components\ChargingSessionCard.tsx` | 216 | `<Button` |
| `web\src\features\charging\components\cost-analysis\MonthlyCostTable.test.tsx` | 121 | `// All seven headers are present and each is an operable sort <button>.` |
| `web\src\features\charging\components\powershare\SignalSnapshotPanel.test.tsx` | 168 | `// Each header is a real <button> (focusable, keyboard-operable) — the` |
| `web\src\features\charging\pages\SmartChargePage.tsx` | 392 | `<Button` |
| `web\src\features\charging\pages\SmartChargePage.tsx` | 464 | `<Button` |
| `web\src\features\charging\pages\TeslaChargingHistoryPage.tsx` | 369 | `<Button` |
| `web\src\features\dashboard\components\ExportModal.tsx` | 89 | `<Button` |
| `web\src\features\dashboard\components\LayoutSwitcher.tsx` | 255 | `<Button` |
| `web\src\features\dashboard\components\LayoutSwitcher.tsx` | 293 | `<Button` |
| `web\src\features\dashboard\components\LayoutSwitcher.tsx` | 306 | `<Button` |
| `web\src\features\dashboard\components\LayoutSwitcher.tsx` | 325 | `<Button` |
| `web\src\features\dashboard\widgets\CommandQuickActionsWidget.tsx` | 114 | `<Button` |
| `web\src\features\dashboard\widgets\OnboardingChecklistWidget.tsx` | 112 | `<Button` |
| `web\src\features\dashboard\widgets\OnboardingChecklistWidget.tsx` | 234 | `<Button` |
| `web\src\features\diagnostics\components\ServiceEvidenceIntegrityPanel.tsx` | 24 | `* uses `<Button loading>` for its in-flight state (matching the existing` |
| `web\src\features\diagnostics\components\ServiceEvidenceIntegrityPanel.tsx` | 62 | `<Button` |
| `web\src\features\driving\components\arrival-reliability\ArrivalReliabilityQueryStatus.tsx` | 83 | `<Button` |
| `web\src\features\driving\components\departure-forecast\DepartureForecastQueryStatus.tsx` | 89 | `<Button` |
| `web\src\features\driving\components\destination-transitions\DestinationTransitionsQueryStatus.tsx` | 83 | `<Button` |
| `web\src\features\driving\components\drive-detail\WhyEndedPanel.tsx` | 149 | `<Button` |
| `web\src\features\driving\components\drive-dna\DriveDnaKpiNotices.tsx` | 111 | `<Button` |
| `web\src\features\driving\components\drive-dna\DriveDnaKpiNotices.tsx` | 137 | `<Button` |
| `web\src\features\driving\components\DriveCard.tsx` | 155 | `<Button` |
| `web\src\features\driving\components\range-buffer\RangeBufferQueryStatus.tsx` | 87 | `<Button` |
| `web\src\features\driving\pages\RegenEfficiencyPage.test.tsx` | 147 | `<button` |
| `web\src\features\driving\pages\SegmentsPage.tsx` | 685 | `<Button` |
| `web\src\features\driving\pages\TripPlannerPage.tsx` | 242 | `<Button` |
| `web\src\features\driving\pages\TripPlannerPage.tsx` | 253 | `<Button` |
| `web\src\features\explore\pages\ExplorePage.tsx` | 533 | `<Button` |
| `web\src\features\maps\components\charging-places\ChargingPlacesWorkspace.tsx` | 136 | `<Button` |
| `web\src\features\maps\components\charging-places\ChargingPlacesWorkspace.tsx` | 146 | `<Button` |
| `web\src\features\maps\components\charging-places\PlaceDetailPanel.tsx` | 137 | `<Button` |
| `web\src\features\maps\components\charging-places\RateForm.tsx` | 185 | `<Button` |
| `web\src\features\maps\pages\GeofencesPage.tsx` | 734 | `<Button` |
| `web\src\features\maps\pages\GeofencesPage.tsx` | 830 | `<Button` |
| `web\src\features\maps\pages\NavigationRoutePage.tsx` | 557 | `<Button` |
| `web\src\features\notifications\components\AlertCard.tsx` | 156 | `<Button` |
| `web\src\features\notifications\components\AlertCard.tsx` | 165 | `<Button` |
| `web\src\features\notifications\components\AlertCard.tsx` | 174 | `<Button` |
| `web\src\features\notifications\components\AlertDetailDrawer.tsx` | 216 | `<Button` |
| `web\src\features\notifications\components\AlertOperationalBrief.tsx` | 155 | `<Button` |
| `web\src\features\notifications\components\AlertOperationalBrief.tsx` | 165 | `<Button` |
| `web\src\features\notifications\components\BrowserPushChannelCard.tsx` | 192 | `<Button` |
| `web\src\features\notifications\components\BrowserPushChannelCard.tsx` | 203 | `<Button` |
| `web\src\features\notifications\components\channels\ChannelCard.tsx` | 111 | `<Button` |
| `web\src\features\notifications\components\channels\ChannelCard.tsx` | 128 | `<Button` |
| `web\src\features\notifications\components\channels\ChannelFormModal.tsx` | 125 | `<Button` |
| `web\src\features\notifications\components\channels\ChannelFormModal.tsx` | 233 | `<Button` |
| `web\src\features\notifications\components\InboxBody.tsx` | 739 | `<Button` |
| `web\src\features\notifications\components\NotificationGroupRow.tsx` | 203 | `<Button` |
| `web\src\features\notifications\components\NotificationSoundChannelRow.tsx` | 39 | `<Button` |
| `web\src\features\onboarding\components\Stepper.tsx` | 163 | `<Button` |
| `web\src\features\onboarding\pages\OnboardingPage.tsx` | 131 | `<Button` |
| `web\src\features\onboarding\pages\OnboardingPage.tsx` | 146 | `<Button` |
| `web\src\features\onboarding\TourLauncher.tsx` | 186 | `<Button` |
| `web\src\features\ownership\pages\DataGovernancePage.tsx` | 399 | `<Button` |
| `web\src\features\ownership\pages\InsuranceTelematicsPage.tsx` | 605 | `<Button` |
| `web\src\features\ownership\pages\TariffLabPage.tsx` | 409 | `<Button` |
| `web\src\features\ownership\pages\TariffLabPage.tsx` | 735 | `<Button` |
| `web\src\features\ownership\pages\TariffLabPage.tsx` | 812 | `<Button` |
| `web\src\features\power-user\pages\DashboardsPage.tsx` | 318 | `<Button` |
| `web\src\features\power-user\pages\GrafanaPanelPage.tsx` | 351 | `<Button` |
| `web\src\features\power-user\pages\GrafanaPanelPage.tsx` | 360 | `<Button` |
| `web\src\features\power-user\pages\SqlPlaygroundPage.tsx` | 206 | `<Button` |
| `web\src\features\power-user\pages\SqlPlaygroundPage.tsx` | 215 | `<Button` |
| `web\src\features\service-intelligence\components\CommunicationsCatalogPanel.tsx` | 250 | `<Button` |
| `web\src\features\service-intelligence\pages\ServiceIntelligencePage.tsx` | 64 | `<Button` |
| `web\src\features\settings\components\AdvancedSettings.tsx` | 83 | `<Button` |
| `web\src\features\settings\components\AIFeatureToggleList.test.tsx` | 22 | `*                     `<button>` so Space/Enter activation comes for free.` |
| `web\src\features\settings\components\AIProviderSection.tsx` | 308 | `<Button` |
| `web\src\features\settings\components\AIProviderSection.tsx` | 403 | `<Button` |
| `web\src\features\settings\components\AIRestorePanel.tsx` | 109 | `<Button` |
| `web\src\features\settings\components\AIRestorePanel.tsx` | 117 | `<Button` |
| `web\src\features\settings\components\AISettings.tsx` | 570 | `<Button` |
| `web\src\features\settings\components\AppearanceSettings.tsx` | 279 | `<Button` |
| `web\src\features\settings\components\FeatureToggles.tsx` | 72 | `<Button` |
| `web\src\features\settings\components\privacy\ConsentControlPanel.tsx` | 64 | `<Button` |
| `web\src\features\settings\components\privacy\ConsentControlPanel.tsx` | 104 | `<Button` |
| `web\src\features\settings\components\privacy\ConsentControlPanel.tsx` | 113 | `<Button` |
| `web\src\features\settings\components\privacy\ConsentControlPanel.tsx` | 122 | `<Button` |
| `web\src\features\settings\components\privacy\RecentPagesPanel.tsx` | 67 | `<Button` |
| `web\src\features\settings\components\QuietHoursPanel.tsx` | 385 | `<Button` |
| `web\src\features\settings\components\QuietHoursPanel.tsx` | 619 | `<Button` |
| `web\src\features\settings\components\QuietHoursPanel.tsx` | 629 | `<Button` |
| `web\src\features\settings\components\SettingsActionCard.tsx` | 20 | `/** Trailing action node (e.g. a `<Button>`) shown when the card is not a link. */` |
| `web\src\features\settings\components\SettingsExportImport.tsx` | 269 | `<Button` |
| `web\src\features\settings\components\SettingsExportImport.tsx` | 379 | `<Button` |
| `web\src\features\settings\components\SettingsSearch.tsx` | 155 | `<Button` |
| `web\src\features\settings\components\twofactor\TotpBackupCodesModal.tsx` | 60 | `<Button` |
| `web\src\features\settings\components\twofactor\TotpBackupCodesModal.tsx` | 88 | `<Button` |
| `web\src\features\settings\components\twofactor\TotpEnrollModal.tsx` | 94 | `<Button` |
| `web\src\features\settings\components\twofactor\TotpStatusHero.tsx` | 88 | `<Button` |
| `web\src\features\settings\components\twofactor\TotpStatusHero.tsx` | 105 | `<Button` |
| `web\src\features\settings\components\WebhookChannelsSection.tsx` | 450 | `<Button` |
| `web\src\features\settings\components\WebhookChannelsSection.tsx` | 528 | `<Button` |
| `web\src\features\settings\pages\SettingsPage.test.tsx` | 28 | `*     exercise the production card + its `<a href>` / `<button>` output.` |
| `web\src\features\sharing\components\share-card\ShareCardPreviewExport.tsx` | 34 | `<Button` |
| `web\src\features\sharing\components\sharing-trips\TripShareRow.test.tsx` | 126 | `// SelectableCard renders a real <button>, so focus + keyboard come for free.` |
| `web\src\features\system\components\ChargingRepairForm.tsx` | 128 | `<Button` |
| `web\src\features\system\components\ChargingRepairForm.tsx` | 155 | `<Button` |
| `web\src\features\system\components\chatbot\ChatMessageItem.tsx` | 156 | `<Button` |
| `web\src\features\system\components\chatbot\ChatMessageItem.tsx` | 164 | `<Button` |
| `web\src\features\system\components\chatbot\SessionList.tsx` | 90 | `<Button` |
| `web\src\features\system\components\command-center\CommandDomainBrowser.tsx` | 56 | `<Button` |
| `web\src\features\system\components\command-center\RecentCommandActivity.tsx` | 114 | `<Button` |
| `web\src\features\system\components\CommandConfirmDialog.tsx` | 119 | `<Button` |
| `web\src\features\system\components\CommandConfirmDialog.tsx` | 128 | `<Button` |
| `web\src\features\system\components\CommandInputDialog.tsx` | 233 | `<Button` |
| `web\src\features\system\components\CommandInputDialog.tsx` | 242 | `<Button` |
| `web\src\features\system\components\DriveRepairForm.tsx` | 144 | `<Button` |
| `web\src\features\system\components\DriveRepairForm.tsx` | 171 | `<Button` |
| `web\src\features\system\components\StaleSessionRow.test.tsx` | 5 | `* disclosure summary (one native `<button>` carrying aria-expanded /` |
| `web\src\features\system\components\StaleSessionRow.tsx` | 45 | `* `<Button>` toggle (aria-expanded/controls) so the repair form below can be` |
| `web\src\features\system\components\StaleSessionRow.tsx` | 62 | `<Button` |
| `web\src\features\system\components\state-machine\SnapshotInspector.tsx` | 147 | `<Button` |
| `web\src\features\system\components\state-machine\StateTimeline.tsx` | 123 | `<Button` |
| `web\src\features\system\components\state-machine\StateTimeline.tsx` | 135 | `<Button` |
| `web\src\features\system\components\status\BackupActionsCard.tsx` | 60 | `<Button` |
| `web\src\features\system\components\status\IncidentsCard.tsx` | 87 | `<Button` |
| `web\src\features\system\components\status\SLOTrackingCard.tsx` | 178 | `<Button` |
| `web\src\features\system\pages\CommandsPage.tsx` | 107 | `<Button` |
| `web\src\features\system\pages\DataExportPage.tsx` | 249 | `<Button` |
| `web\src\features\system\pages\DataExportPage.tsx` | 692 | `<Button` |
| `web\src\features\system\pages\DataExportPage.tsx` | 814 | `<Button` |
| `web\src\features\system\pages\DataExportPage.tsx` | 823 | `<Button` |
| `web\src\features\system\pages\DataExportPage.tsx` | 1160 | `<Button` |
| `web\src\features\system\pages\DataExportPage.tsx` | 1252 | `<Button` |
| `web\src\features\system\pages\DiagnosticPage.tsx` | 425 | `<Button` |
| `web\src\features\system\pages\DiagnosticPage.tsx` | 459 | `<Button` |
| `web\src\features\system\pages\ScheduledExportsPanel.tsx` | 181 | `<Button` |
| `web\src\features\system\pages\ScheduledExportsPanel.tsx` | 324 | `<Button` |
| `web\src\features\system\pages\ScheduledExportsPanel.tsx` | 332 | `<Button` |
| `web\src\features\system\pages\SearchPage.tsx` | 200 | `<Button` |
| `web\src\features\system\pages\SearchPage.tsx` | 215 | `<Button` |
| `web\src\features\system\pages\SystemStatusPage.tsx` | 475 | `<Button` |
| `web\src\features\system\pages\TeslaAccountPage.tsx` | 188 | `<Button` |
| `web\src\features\telemetry\components\LiveSignalTail.tsx` | 143 | `<Button` |
| `web\src\features\telemetry\components\LiveSignalTail.tsx` | 161 | `<Button` |
| `web\src\features\telemetry\components\SignalCompareControls.tsx` | 178 | `<Button` |
| `web\src\features\telemetry\pages\SignalExplorerPage.tsx` | 359 | `<Button` |
| `web\src\features\telemetry\pages\SignalExplorerPage.tsx` | 369 | `<Button` |
| `web\src\features\telemetry\pages\SignalLogViewerPage.tsx` | 187 | `<Button` |
| `web\src\features\telemetry\pages\SignalsWorkspacePage.tsx` | 489 | `<Button` |
| `web\src\features\telemetry\pages\SignalsWorkspacePage.tsx` | 499 | `<Button` |
| `web\src\features\vehicle-systems\pages\MaintenancePage.tsx` | 561 | `<Button` |
| `web\src\features\vehicle-systems\pages\PreconditioningEffectivenessPage.tsx` | 190 | `<Button` |
| `web\src\features\vehicles\components\vehicle-detail\VehicleHeader.test.tsx` | 27 | `*     one interactive control (the wake <button>) is exercised with fireEvent.` |
| `web\src\features\vehicles\components\vehicle-management\ManagementEndpointCard.tsx` | 146 | `<Button` |
| `web\src\features\vehicles\components\vehicle-management\OpaqueJsonDialog.tsx` | 94 | `<Button` |
| `web\src\features\vehicles\components\VehicleCard.tsx` | 167 | `<Button` |
| `web\src\features\vehicles\components\VehicleHeader.tsx` | 107 | `<Button` |
| `web\src\features\vehicles\components\VehicleSettingsTab.tsx` | 273 | `<Button` |
| `web\src\features\vehicles\components\VehicleSettingsTab.tsx` | 284 | `<Button` |

## `<Input>` without `label` or `aria-label`

| File | Line | Snippet |
|------|-----:|---------|
| `web\src\components\charts\AddAnnotationPopover.tsx` | 13 | `* `<input type="date">`. Returns an empty string when parsing fails so the` |
| `web\src\components\charts\AddAnnotationPopover.tsx` | 41 | `/** When true, the timestamp becomes editable via a `<Input type="date">`.` |
| `web\src\components\data-display\SavedViewMenu.tsx` | 468 | `<input` |
| `web\src\components\feedback\TimeMachineBanner.tsx` | 25 | `* `<input type="datetime-local">` row attached to the banner. The same` |
| `web\src\components\feedback\TimeMachineBanner.tsx` | 55 | `// <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm" in LOCAL` |
| `web\src\components\feedback\TimeMachineBanner.tsx` | 178 | `<input` |
| `web\src\components\forms\__tests__\UnitInput.test.tsx` | 5 | `*   1. Renders an <input> with the user's display unit symbol as suffix.` |
| `web\src\components\forms\Combobox.tsx` | 532 | `<input` |
| `web\src\components\forms\ComboboxMulti.tsx` | 473 | `<input` |
| `web\src\components\forms\CurrencyInput.test.tsx` | 5 | `*   1. Renders an <input> with the localized currency symbol as adornment.` |
| `web\src\components\forms\CurrencyInput.tsx` | 76 | `* `<Input>`'s visible label when no `label` is supplied. Existing` |
| `web\src\components\forms\FormField.test.tsx` | 9 | `<input id="name" defaultValue="" />` |
| `web\src\components\forms\FormField.test.tsx` | 19 | `<input id="email" type="email" />` |
| `web\src\components\forms\FormField.test.tsx` | 29 | `<input />` |
| `web\src\components\forms\FormField.test.tsx` | 41 | `<input />` |
| `web\src\components\forms\FormField.test.tsx` | 52 | `<input />` |
| `web\src\components\forms\FormField.test.tsx` | 63 | `<input />` |
| `web\src\components\forms\FormField.test.tsx` | 74 | `<input />` |
| `web\src\components\forms\FormField.test.tsx` | 85 | `<input />` |
| `web\src\components\forms\FormField.tsx` | 40 | `* Sibling controls in `@/components/ui` (`<Input>`, `<Select>`, `<Textarea>`)` |
| `web\src\components\forms\ListExportMenu.tsx` | 216 | `<input` |
| `web\src\components\forms\RangePicker.tsx` | 282 | `<input` |
| `web\src\components\forms\SearchInput.tsx` | 63 | `* Rendered as a wrapper around the shared `<Input>` component using its `icon`` |
| `web\src\components\forms\SearchInput.tsx` | 237 | `<Input` |
| `web\src\components\forms\TagInput.tsx` | 514 | `<input` |
| `web\src\components\forms\VehicleMultiSelect.tsx` | 16 | `*   NOT raw `<input type="checkbox">` — no `Checkbox` primitive` |
| `web\src\components\SignalQueryControls.tsx` | 207 | `<Input` |
| `web\src\components\SignalQueryControls.tsx` | 297 | `<input id={fromId} type="datetime-local" step="1" value={fromStr} onChange={e => onFromChange(e.t…` |
| `web\src\components\SignalQueryControls.tsx` | 301 | `<input id={toId} type="datetime-local" step="1" value={toStr} onChange={e => onToChange(e.target.…` |
| `web\src\components\ui\__tests__\Checkbox.test.tsx` | 5 | `*   1. Native `<input type="checkbox">` is the source of truth (keyboard,` |
| `web\src\components\ui\__tests__\Checkbox.test.tsx` | 15 | `*   6. Forwarded refs land on the `<input>` element so callers can` |
| `web\src\components\ui\__tests__\CommandPalette.test.tsx` | 204 | `it('does NOT open on Ctrl+K while focus is in an external <input>', async () => {` |
| `web\src\components\ui\__tests__\CommandPalette.test.tsx` | 209 | `<input data-testid="external-input" />` |
| `web\src\components\ui\Checkbox.tsx` | 27 | `* Uses a visually-hidden native `<input type="checkbox">` for keyboard,` |
| `web\src\components\ui\Checkbox.tsx` | 32 | `* The `<input>` element here is intentional — `components/ui/` is` |
| `web\src\components\ui\Checkbox.tsx` | 94 | `<input` |
| `web\src\components\ui\CommandPalette.tsx` | 1012 | `<Input` |
| `web\src\components\ui\DataTable.tsx` | 716 | `<input` |
| `web\src\components\ui\DataTableColumnsMenu.tsx` | 177 | `<input` |
| `web\src\components\ui\Drawer.test.tsx` | 281 | `<input data-testid="field" />` |
| `web\src\components\ui\Drawer.test.tsx` | 292 | `<input data-testid="field" />` |
| `web\src\components\ui\EditableText.tsx` | 301 | `<input` |
| `web\src\components\ui\Input.tsx` | 73 | `<input` |
| `web\src\components\ui\RadioCard.test.tsx` | 6 | `*   1. A real, screen-reader-visible `<input type="radio">` is the source` |
| `web\src\components\ui\RadioCard.test.tsx` | 18 | `*   7. Forwarded refs land on the `<input>`, and arbitrary input` |
| `web\src\components\ui\RadioCard.tsx` | 23 | `* Selectable option card built on a real `<input type="radio">`.` |
| `web\src\components\ui\RadioCard.tsx` | 28 | `* prop. The raw `<input>` is intentional — `components/ui/` is the` |
| `web\src\components\ui\RadioCard.tsx` | 56 | `<input` |
| `web\src\components\ui\RangeSlider.tsx` | 52 | `* Built from two stacked native `<input type="range">` elements so every` |
| `web\src\components\ui\RangeSlider.tsx` | 177 | `<input` |
| `web\src\components\ui\RangeSlider.tsx` | 190 | `<input` |
| `web\src\components\ui\Slider.test.tsx` | 4 | `* Validates the bare `<input type="range">` contract: visible label` |
| `web\src\components\ui\Slider.tsx` | 39 | `* Wraps native `<input type="range">` so all keyboard semantics from the` |
| `web\src\components\ui\Slider.tsx` | 49 | `* Layout: matches `<Input>`/`<Select>` (md size) — same label style` |
| `web\src\components\ui\Slider.tsx` | 101 | `{/* Track wrapper matches the height of an md <Input>/<Select>` |
| `web\src\components\ui\Slider.tsx` | 105 | `<input` |
| `web\src\features\admin\components\devtools\tools\ByteSizeConverter.test.tsx` | 98 | `// element kind (shared <Input>/<Select>, not raw HTML that lost its label).` |
| `web\src\features\admin\components\devtools\tools\UnixPermissionTool.test.tsx` | 101 | `// element kind (shared <Input>/<Select>, not raw HTML that lost its label).` |
| `web\src\features\admin\components\live-signal-inspector\LiveSignalsTable.tsx` | 177 | `<Input` |
| `web\src\features\admin\pages\FleetTelemetryCoveragePage.tsx` | 614 | `<Input` |
| `web\src\features\charging\pages\SmartChargePage.test.tsx` | 7 | `*   - `defaultDepartBy()` — the datetime-local seed. A `<input` |
| `web\src\features\charging\pages\SmartChargePage.tsx` | 55 | `* A `<input type="datetime-local">` value is interpreted as local wall-clock` |
| `web\src\features\dashboard\components\ImportPreviewModal.test.tsx` | 16 | `*   - file <input> happy path + empty-file guard (async `File.text()`)` |
| `web\src\features\dashboard\components\WidgetCatalogueDialog.tsx` | 198 | `<Input` |
| `web\src\features\dashcam\components\dashcam\RedactionEditor.tsx` | 90 | `<Input` |
| `web\src\features\explore\pages\ExplorePage.tsx` | 201 | `<Input` |
| `web\src\features\settings\components\GeneralSettings.tsx` | 337 | `<Input` |
| `web\src\features\settings\components\GeneralSettings.tsx` | 393 | `<Input` |
| `web\src\features\settings\components\SettingField.test.tsx` | 66 | `<input id="mpg-input" />` |
| `web\src\features\settings\components\SettingsExportImport.tsx` | 310 | `<Input` |
| `web\src\features\settings\components\SettingsSearch.tsx` | 2 | `// Renders a single `<Input>` with a popover dropdown of matching` |
| `web\src\features\settings\components\SettingsSearch.tsx` | 108 | `<Input` |
| `web\src\features\settings\components\twofactor\TotpEnrollModal.tsx` | 70 | `<Input` |
| `web\src\features\settings\components\WebhookChannelsSection.tsx` | 335 | `<Input` |
| `web\src\features\settings\components\WebhookChannelsSection.tsx` | 353 | `<Input` |
| `web\src\features\settings\components\WebhookChannelsSection.tsx` | 397 | `<Input` |
| `web\src\features\system\components\chatbot\SessionList.tsx` | 138 | `<Input` |
| `web\src\features\system\components\CommandConfirmDialog.tsx` | 107 | `<Input` |
| `web\src\features\system\components\CommandSearch.test.tsx` | 5 | `* the shared <Input> as the search box for the vehicle command palette. These` |
| `web\src\features\system\components\status\SLOTrackingCard.tsx` | 138 | `<Input` |
| `web\src\features\system\pages\ScheduledExportsPanel.tsx` | 203 | `<Input` |
| `web\src\features\system\pages\ScheduledExportsPanel.tsx` | 217 | `<Input` |
| `web\src\features\system\pages\ScheduledExportsPanel.tsx` | 264 | `<Input` |
| `web\src\features\system\pages\ScheduledExportsPanel.tsx` | 299 | `<Input` |
| `web\src\features\system\pages\SearchPage.tsx` | 181 | `<Input` |
| `web\src\features\vehicles\components\VehiclePhotoUpload.tsx` | 199 | `<Input` |
| `web\src\features\vehicles\components\VehicleSettingsTab.tsx` | 90 | `* `YYYY-MM-DDTHH:MM` shape an `<input type="datetime-local">` accepts.` |
| `web\src\features\vehicles\components\VehicleSettingsTab.tsx` | 366 | `<Input` |
| `web\src\features\vehicles\components\VehicleSettingsTab.tsx` | 385 | `<Input` |

## `<img>` without `alt`

| File | Line | Snippet |
|------|-----:|---------|
| `web\src\components\data-display\Avatar.tsx` | 50 | `* Optional image URL. When present the avatar renders an `<img>` and` |
| `web\src\components\ui\Lightbox.tsx` | 132 | `// as the visible <img>; we don't even need to await — the cache is the` |
| `web\src\components\ui\Lightbox.tsx` | 436 | `and closes. The <img>, prev, and next children re-enable` |
| `web\src\features\system\components\chatbot\MarkdownRenderer.test.tsx` | 21 | `*   4. Security — a malicious assistant reply with raw <script>/<img onerror>` |
| `web\src\features\system\components\chatbot\MarkdownRenderer.test.tsx` | 156 | `'Hi <script>alert(1)</script> <img src=x onerror="steal()"> there',` |
| `web\src\features\system\pages\TeslaAccountPage.test.tsx` | 320 | `// No <img>; avatar renders deterministic initials instead.` |
| `web\src\features\vehicles\components\VehiclePhotoUpload.tsx` | 14 | `// No new image library — the preview uses a plain <img> bound to a` |

## Solid red background with no status icon nearby

| File | Line | Snippet |
|------|-----:|---------|
| `web\src\components\data-display\ServiceStatus.test.tsx` | 98 | `expect(banner.className).toContain('bg-red-500/15')` |
| `web\src\components\data-display\ServiceStatus.tsx` | 31 | `className="flex items-center justify-center gap-2 border-b border-red-500/20 bg-red-500/15 px-4 p…` |
| `web\src\components\data-display\UsageCard.tsx` | 140 | `danger: 'bg-red-500/70',` |
| `web\src\components\data-display\UsageCard.tsx` | 146 | `danger: 'bg-red-500/10 ring-1 ring-red-500/30',` |
| `web\src\components\data-display\UsageCard.tsx` | 158 | `danger: 'bg-red-500/10 text-red-200 ring-1 ring-red-500/30',` |
| `web\src\components\status\__tests__\ActionItem.test.tsx` | 60 | `['error', 'bg-red-500/10'],` |
| `web\src\components\status\ActionItem.tsx` | 23 | `error: { icon: AlertCircle,    text: 'text-red-400',   bg: 'bg-red-500/10',   ring: 'ring-red-400…` |
| `web\src\components\status\StatusHero.tsx` | 31 | `unhealthy:   { icon: XCircle,      ring: 'ring-red-500/40',    bg: 'bg-red-500/15',    text: 'tex…` |
| `web\src\components\ui\Button.test.tsx` | 64 | `danger: 'bg-red-600',` |
| `web\src\components\ui\Button.tsx` | 13 | `danger: 'bg-red-600 text-[var(--text-on-accent)] hover:bg-red-700 focus-visible:ring-red-500 forc…` |
| `web\src\features\admin\components\EndpointSidebar.tsx` | 48 | `DELETE: 'bg-red-500/20 text-red-400',` |
| `web\src\features\admin\components\ResponseViewer.test.tsx` | 142 | `[404, 'text-red-400', 'bg-red-500/10'],` |
| `web\src\features\admin\components\ResponseViewer.test.tsx` | 143 | `[500, 'text-red-400', 'bg-red-500/10'],` |
| `web\src\features\admin\components\ResponseViewer.tsx` | 58 | `return 'bg-red-500/10 border-red-500/20';` |
| `web\src\features\admin\components\ResponseViewer.tsx` | 270 | `h.method === 'DELETE' ? 'bg-red-500/20 text-red-400' :` |
| `web\src\features\admin\pages\RedisSignalViewerPage.tsx` | 659 | `className="justify-center !bg-red-700 hover:!bg-red-800"` |
| `web\src\features\automations\pages\AutomationCard.tsx` | 177 | `className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-red-400 hover:!b…` |
| `web\src\features\battery\pages\ProjectedRangePage.test.tsx` | 241 | `expect(effColor(210.1)).toBe('bg-red-500');` |
| `web\src\features\battery\pages\ProjectedRangePage.test.tsx` | 242 | `expect(effColor(999)).toBe('bg-red-500');` |
| `web\src\features\battery\pages\ProjectedRangePage.tsx` | 63 | `return 'bg-red-500';` |
| `web\src\features\charging\components\charging-list\OptimizerSection.tsx` | 149 | `rec.priority === 'high' ? 'bg-red-500/[0.06] border border-red-500/10' :` |
| `web\src\features\charging\components\charging-list\OptimizerSection.tsx` | 162 | `rec.priority === 'high' ? 'bg-red-500/20 text-red-400' :` |
| `web\src\features\charging\components\RateTimeline.test.tsx` | 237 | `expect(barEl(on).className).toContain('bg-red-500/40');` |
| `web\src\features\charging\components\RateTimeline.tsx` | 18 | `ON_PEAK: 'bg-red-500/40',` |
| `web\src\features\charging\components\RateTimeline.tsx` | 100 | `<span aria-hidden="true" className="w-3 h-3 rounded-sm bg-red-500/40" />` |
| `web\src\features\dashboard\components\LayoutManager.tsx` | 45 | `? 'text-red-400 hover:bg-red-500/10'` |
| `web\src\features\dashboard\widgets\BackupMonitorWidget.test.tsx` | 203 | `expect(statusDotColor('failed')).toContain('bg-red-500');` |
| `web\src\features\dashboard\widgets\BackupMonitorWidget.test.tsx` | 259 | `expect(statusTile?.className).toContain('bg-red-500/10');` |
| `web\src\features\dashboard\widgets\BackupMonitorWidget.tsx` | 42 | `return 'bg-red-500 shadow-red-500/40';` |
| `web\src\features\dashboard\widgets\BackupMonitorWidget.tsx` | 181 | `latestStatus === 'failed' && 'bg-red-500/10',` |
| `web\src\features\dashboard\widgets\ChargingOptimizerWidget.tsx` | 195 | `isPeak && 'bg-red-500/30',` |
| `web\src\features\dashboard\widgets\SecurityStatusWidget.test.tsx` | 202 | `expect(container.querySelector('.bg-red-500')).toBeNull();` |
| `web\src\features\dashboard\widgets\SecurityStatusWidget.test.tsx` | 216 | `expect(container.querySelector('.bg-red-500')).toBeInTheDocument();` |
| `web\src\features\dashboard\widgets\SecurityStatusWidget.test.tsx` | 233 | `expect(container.querySelector('.bg-red-500')).toBeNull();` |
| `web\src\features\dashboard\widgets\shared\WidgetStatusGrid.test.tsx` | 156 | `['error', 'bg-red-500/10', 'bg-red-500'],` |
| `web\src\features\dashboard\widgets\shared\WidgetStatusGrid.tsx` | 31 | `bg: 'bg-red-500/10 border-red-500/20',` |
| `web\src\features\dashboard\widgets\shared\WidgetStatusGrid.tsx` | 32 | `dot: 'bg-red-500',` |
| `web\src\features\dashboard\widgets\SystemHealthWidget.test.tsx` | 245 | `expect(screen.getByRole('img', { name: 'Fleet Telemetry: Down' }).className).toContain('bg-red-50…` |
| `web\src\features\dashboard\widgets\SystemHealthWidget.test.tsx` | 259 | `expect(screen.getByRole('img', { name: 'Mqtt: Down' }).className).toContain('bg-red-500');` |
| `web\src\features\dashboard\widgets\SystemHealthWidget.tsx` | 56 | `down: 'bg-red-500 shadow-red-500/40',` |
| `web\src\features\dashboard\widgets\UptimeMonitorWidget.test.tsx` | 275 | `expect(container.querySelector('.bg-red-500')).toBeTruthy();` |
| `web\src\features\dashboard\widgets\UptimeMonitorWidget.tsx` | 47 | `danger: 'bg-red-500 shadow-red-500/40',` |
| `web\src\features\diagnostics\components\anomaly-dashboard\AnomalyTimelineCard.test.tsx` | 105 | `expect(critical?.className).toContain('bg-red-500/10');` |
| `web\src\features\diagnostics\components\anomaly-dashboard\SystemHealthCard.test.tsx` | 55 | `expect(item.className).toContain('bg-red-500/10');` |
| `web\src\features\diagnostics\components\anomaly-dashboard\SystemHealthCard.test.tsx` | 101 | `expect(screen.getByRole('listitem').className).toContain('bg-red-500/10');` |
| `web\src\features\diagnostics\pages\RemainingUsefulLifePage.tsx` | 47 | `overdue: { dot: 'bg-red-500', text: 'text-red-300', gauge: '#f87171', key: 'rul.status.overdue', …` |
| `web\src\features\driving\components\drive-detail\RouteMapSection.tsx` | 155 | `<span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-red-50…` |
| `web\src\features\driving\components\driving-dynamics\DrivingCoachSection.tsx` | 126 | `style === 'moderate' ? 'bg-neon-amber' : 'bg-red-500',` |
| `web\src\features\driving\components\driving-dynamics\DrivingCoachSection.tsx` | 138 | `{ key: 'aggressive', color: 'bg-red-500', text: 'text-red-400' },` |
| `web\src\features\driving\components\driving-dynamics\DrivingCoachSection.tsx` | 227 | `p.value <= p.hi ? 'bg-neon-amber' : 'bg-red-500',` |
| `web\src\features\system\components\status\BackgroundWorkersCard.tsx` | 78 | `dot: 'bg-red-500',` |
| `web\src\features\system\components\status\BackgroundWorkersCard.tsx` | 79 | `chip: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',` |
| `web\src\features\system\components\status\BackgroundWorkersCard.tsx` | 108 | `dot: 'bg-red-500',` |
| `web\src\features\system\components\status\BackgroundWorkersCard.tsx` | 110 | `chip: 'bg-red-500/10 text-red-300 ring-1 ring-red-500/25',` |
| `web\src\features\system\components\status\TelemetryPipelineCard.tsx` | 147 | `dot: 'bg-red-500',` |
| `web\src\features\system\components\status\TelemetryPipelineCard.tsx` | 149 | `chip: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',` |
| `web\src\features\system\components\status\TelemetryPipelineCard.tsx` | 171 | `return 'bg-red-500/70'` |
| `web\src\features\system\components\status\TeslaAuthCard.tsx` | 45 | `expired:      { bar: 'bg-red-500/60',    icon: 'text-red-400',    Icon: ShieldX,     label: 'Toke…` |
| `web\src\features\system\components\status\TeslaAuthCard.tsx` | 46 | `disconnected: { bar: 'bg-red-500/60',    icon: 'text-red-400',    Icon: ShieldX,     label: 'Not …` |
| `web\src\features\telemetry\components\SignalChartPanel.test.tsx` | 199 | `const dot = container.querySelector('.bg-red-500.rounded-full');` |
| `web\src\features\telemetry\components\SignalChartPanel.tsx` | 149 | `<span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />` |
| `web\src\features\telemetry\pages\SignalsWorkspacePage.tsx` | 507 | `<span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />` |
| `web\src\features\vehicle-systems\pages\GuardModePage.tsx` | 374 | `? 'bg-red-500/20 text-red-300'` |
| `web\src\features\vehicle-systems\pages\GuardModePage.tsx` | 406 | `<div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-300">` |
| `web\src\features\vehicle-systems\pages\GuardModePage.tsx` | 699 | `: 'border-red-500/20 bg-red-500/[0.03]',` |
| `web\src\features\vehicles\components\telemetry-panels\PowertrainPanel.test.tsx` | 137 | `expect(screen.getByText('R')).toHaveClass('text-red-400', 'bg-red-500/10')` |
| `web\src\features\vehicles\components\telemetry-panels\PowertrainPanel.tsx` | 73 | `? 'border-red-500/30 bg-red-500/10 text-red-400'` |
| `web\src\features\vehicles\components\telemetry-panels\PowertrainPanel.tsx` | 110 | `powerClamped >= 0 ? 'bg-green-500/60' : 'bg-red-500/60',` |
| `web\src\features\vehicles\components\telemetry-panels\SecurityPanel.test.tsx` | 123 | `expect(badge).toHaveClass('bg-red-500/10')` |
| `web\src\features\vehicles\components\telemetry-panels\SecurityPanel.tsx` | 83 | `? 'border-red-500/30 bg-red-500/10 text-red-400'` |
| `web\src\features\vehicles\components\telemetry-panels\TirePressurePanel.tsx` | 84 | `className: 'border-red-500/30 bg-red-500/10 text-red-400',` |

## framer-motion files without `useMotionPreference` opt-out

- `web\src\components\data-display\MetricBar.tsx`
- `web\src\components\data-display\PollingEngine.tsx`
- `web\src\components\data-display\ServiceStatus.tsx`
- `web\src\components\data-display\TeslaCarViz.tsx`
- `web\src\components\feedback\InstallPrompt.tsx`
- `web\src\components\forms\__tests__\Combobox.test.tsx`
- `web\src\components\forms\__tests__\ComboboxMulti.test.tsx`
- `web\src\components\forms\__tests__\SearchInput.history.test.tsx`
- `web\src\components\forms\__tests__\TagInput.test.tsx`
- `web\src\components\forms\__tests__\UnitInput.test.tsx`
- `web\src\components\forms\__tests__\VehicleMultiSelect.test.tsx`
- `web\src\components\forms\SearchInput.test.tsx`
- `web\src\components\layout\__tests__\ScrollRestoration.test.tsx`
- `web\src\components\layout\Layout.tsx`
- `web\src\components\layout\sidebar\LinearSidebar.tsx`
- `web\src\components\layout\sidebar\NotionSidebar.tsx`
- `web\src\components\maps\__tests__\MarkerCluster.bench.test.tsx`
- `web\src\components\ui\__tests__\DataTableColumnsMenu.test.tsx`
- `web\src\components\ui\Accordion.test.tsx`
- `web\src\components\ui\Accordion.tsx`
- `web\src\components\ui\CommandPalette.tsx`
- `web\src\components\ui\DataTableResizer.test.tsx`
- `web\src\components\ui\Drawer.tsx`
- `web\src\components\vehicles\VehicleTwin.tsx`
- `web\src\features\admin\components\feature-flags\FlagEditDrawer.test.tsx`
- `web\src\features\admin\components\gdpr-export\GDPRLookupPanel.test.tsx`
- `web\src\features\admin\pages\FeatureFlagsPage.tsx`
- `web\src\features\automations\pages\ConditionBuilder.test.tsx`
- `web\src\features\explore\pages\ExplorePage.test.tsx`
- `web\src\features\notifications\components\channels\HealthAlertPreferencesPanel.tsx`
- `web\src\features\settings\components\AIProviderSection.test.tsx`
- `web\src\features\settings\components\WebhookChannelsSection.tsx`
- `web\src\features\system\components\state-machine\__tests__\SnapshotInspector.empty.test.tsx`
- `web\src\features\system\components\state-machine\SnapshotInspector.test.tsx`
- `web\src\features\system\pages\StateMachineDebuggerPage.tsx`
- `web\src\features\telemetry\components\SignalSelector.test.tsx`

