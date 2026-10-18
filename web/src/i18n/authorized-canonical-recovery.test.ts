import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import catalog from './en.json'
import shell from './en/shell.json'
import baseline from './known-missing-keys.json'
import { finalFourAdditions, ownerRecoveryAdditions } from './authorized-owner-recovery.test'

type Json = Record<string, unknown>
// Static exact parent-disposition fixture. Never derive exclusions from the current catalog.
export const authorizedCanonicalAdditions: readonly (readonly [string, string])[] = [
  [
    "watch.command.success",
    "Command sent"
  ],
  [
    "watch.command.error",
    "Watch command failed: {{message}}"
  ],
  [
    "notifications.alertStudio.aiConflicts.listLabel",
    "Detected rule conflicts"
  ],
  [
    "notifications.alertStudio.aiConflicts.flag.subsumes",
    "subsumes"
  ],
  [
    "notifications.alertStudio.aiConflicts.flag.severityMismatch",
    "severity mismatch"
  ],
  [
    "notifications.alertStudio.aiConflicts.flag.cooldownMismatch",
    "cooldown mismatch"
  ],
  [
    "notifications.alertStudio.aiConflicts.flag.triggerModeMismatch",
    "trigger mode mismatch"
  ],
  [
    "feedbackTriage.aiAdvisor.title",
    "Helix triage advisor"
  ],
  [
    "feedbackTriage.aiAdvisor.description",
    "Get a proposed status, category, and priority label for this feedback row. The advisor reads only the redacted envelope (id, category, title, body excerpt, page route, app version, status, created_at) — never the reporter email, IP, console tail, or recent errors. The proposal is informational; your existing manual controls above remain the only way to save changes."
  ],
  [
    "feedbackTriage.aiAdvisor.button",
    "Suggest triage"
  ],
  [
    "feedbackTriage.aiAdvisor.emptyHint",
    "Select a feedback row to suggest triage labels."
  ],
  [
    "automations.builder.aiGeofenceAware.promptAria",
    "Describe the geofence-aware automation to draft"
  ],
  [
    "ai.limit.useBaseline",
    "Use baseline"
  ],
  [
    "ai.limit.title.costCap",
    "Daily cost cap reached"
  ],
  [
    "ai.limit.title.costCapUnavailable",
    "Cost cap check unavailable"
  ],
  [
    "ai.limit.title.settingsUnavailable",
    "Helix settings unavailable"
  ],
  [
    "ai.limit.title.burst",
    "Too many Helix requests at once"
  ],
  [
    "ai.limit.title.perMinute",
    "Helix rate limit hit"
  ],
  [
    "ai.limit.title.perDay",
    "Daily Helix usage limit reached"
  ],
  [
    "ai.limit.title.tokens",
    "Helix token quota exhausted"
  ],
  [
    "ai.limit.title.providerUnavailable",
    "Helix provider unavailable"
  ],
  [
    "ai.limit.title.featureMisconfigured",
    "Helix feature misconfigured"
  ],
  [
    "ai.limit.title.generic",
    "Helix temporarily unavailable"
  ],
  [
    "ai.limit.desc.costCap",
    "You have reached your daily Helix cost limit. Helix features will resume tomorrow or after you raise the cap in Settings."
  ],
  [
    "ai.limit.desc.costCapUnavailable",
    "Could not read your Helix usage history. Failing closed for safety."
  ],
  [
    "ai.limit.desc.settingsUnavailable",
    "Could not load your Helix settings. Helix is paused until settings are reachable."
  ],
  [
    "ai.limit.desc.burst",
    "Too many Helix requests are in flight. The limiter is keeping the system responsive."
  ],
  [
    "ai.limit.desc.perMinute",
    "You have sent more Helix requests than allowed per minute. The window resets shortly."
  ],
  [
    "ai.limit.desc.perDay",
    "You have used your daily Helix request budget. The budget resets at UTC midnight."
  ],
  [
    "ai.limit.desc.tokens",
    "Your Helix token quota for this minute is exhausted. Try a shorter prompt."
  ],
  [
    "ai.limit.desc.providerUnavailable",
    "The Helix provider is not responding. The system will retry automatically."
  ],
  [
    "ai.limit.desc.featureMisconfigured",
    "This page is missing a Helix feature registration. Please report this to your administrator."
  ],
  [
    "ai.limit.desc.generic",
    "Helix features are temporarily unavailable. The non-Helix baseline continues to work."
  ],
  [
    "charging.aiMlClustering.noVehicleHint",
    "Pick a vehicle to train its charging-curve clusters."
  ],
  [
    "notifications.alertStudio.aiBuilder.emptyHint",
    "Choose a vehicle and describe the alert you want Helix to draft."
  ],
  [
    "notifications.alertStudio.aiBuilder.inputLabel",
    "Alert description"
  ],
  [
    "notifications.alertStudio.aiBuilder.placeholder",
    "e.g. alert me if battery cell voltage spread is over 50 mV"
  ],
  [
    "powerDashboards.aiDrafter.title",
    "Helix natural-language dashboard composer"
  ],
  [
    "powerDashboards.aiDrafter.description",
    "Describe the dashboard you want in plain English (e.g. \"give me an overview dashboard with daily drives, current battery, and recent alerts\"). Helix proposes a typed dashboard JSON draft built from the in-scope curated panel catalog you can apply to the editor with one click; it never pushes the dashboard to Grafana directly."
  ],
  [
    "powerDashboards.aiDrafter.button",
    "Draft dashboard"
  ],
  [
    "powerDashboards.aiDrafter.promptPlaceholder",
    "e.g. give me an overview dashboard with daily drives, current battery, and recent alerts"
  ],
  [
    "powerDashboards.aiDrafter.promptLabel",
    "Dashboard request"
  ],
  [
    "powerDashboards.aiDrafter.applyTooltip",
    "Copy the proposed dashboard JSON into the editor above. You can still edit it before clicking Copy to clipboard."
  ],
  [
    "drives.aiSearch.inputLabel",
    "Describe the drive to find"
  ],
  [
    "powerGrafana.aiDrafter.title",
    "Helix natural-language Grafana panel drafter"
  ],
  [
    "powerGrafana.aiDrafter.description",
    "Describe the panel you want in plain English (e.g. \"show me a daily time series of how far I drove this month\"). Helix proposes a typed Grafana panel JSON draft you can apply to the editor with one click; it never pushes the panel to Grafana directly."
  ],
  [
    "powerGrafana.aiDrafter.button",
    "Draft panel"
  ],
  [
    "powerGrafana.aiDrafter.promptLabel",
    "Grafana panel request"
  ],
  [
    "powerGrafana.aiDrafter.promptPlaceholder",
    "e.g. show me a daily time series of how far I drove this month"
  ],
  [
    "powerGrafana.aiDrafter.applyTooltip",
    "Copy the proposed panel JSON into the editor above. You can still edit it before clicking Copy to clipboard."
  ],
  [
    "powerGrafana.aiDrafter.previewLabel",
    "Proposed Grafana panel (review before applying)"
  ],
  [
    "powerGrafana.aiDrafter.previewUntitled",
    "Untitled panel"
  ],
  [
    "powerGrafana.aiDrafter.previewType",
    "Panel type:"
  ],
  [
    "powerGrafana.aiDrafter.previewDatasource",
    "Datasource:"
  ],
  [
    "powerGrafana.aiDrafter.previewTargets",
    "Query targets:"
  ],
  [
    "powerGrafana.aiDrafter.previewTables",
    "Referenced tables:"
  ],
  [
    "search.aiSearch.emptyHint",
    "Type a question above to search your drives, charging sessions, and alerts."
  ],
  [
    "search.aiSearch.placeholder",
    "e.g. drives last weekend over 200 km with phantom drain"
  ],
  [
    "powerSql.aiDrafter.title",
    "Helix natural-language SQL drafter"
  ],
  [
    "powerSql.aiDrafter.description",
    "Describe the question in plain English (e.g. \"how many drives last week\"). Helix proposes a typed read-only SQL draft you can apply to the editor with one click; it never executes the query directly."
  ],
  [
    "powerSql.aiDrafter.button",
    "Draft SQL"
  ],
  [
    "powerSql.aiDrafter.promptPlaceholder",
    "e.g. how many drives did I take last week"
  ],
  [
    "powerSql.aiDrafter.promptLabel",
    "SQL request"
  ],
  [
    "powerSql.aiDrafter.applyTooltip",
    "Copy the proposed SQL into the editor above. You can still edit it before clicking Run."
  ],
  [
    "helix.errorLabel",
    "Helix error:"
  ],
  [
    "ai.common.noOutput",
    "No output was generated."
  ],
  [
    "signalExplorer.aiFilter.title",
    "Helix natural-language filter"
  ],
  [
    "signalExplorer.aiFilter.description",
    "Describe the filter in plain English (e.g. \"battery level for yesterday\"). The LLM proposes a typed filter you can apply with one click; it never edits the form directly."
  ],
  [
    "signalExplorer.aiFilter.button",
    "Draft filter"
  ],
  [
    "signalExplorer.aiFilter.promptPlaceholder",
    "e.g. show me battery level for yesterday"
  ],
  [
    "signalExplorer.aiFilter.promptLabel",
    "Filter request"
  ],
  [
    "signalExplorer.aiFilter.applyTooltip",
    "Copy the proposed filter into the form above. You can still edit it before clicking Explore."
  ],
  [
    "signalExplorer.aiFilter.applyButton",
    "Apply to filters"
  ],
  [
    "yearReview.aiNarration.emptyHint",
    "Select a vehicle above to recap its year."
  ],
  [
    "ai.confirm.title",
    "Approve Helix action"
  ],
  [
    "ai.confirm.intro.mutates",
    "The assistant wants to make a change to your data. Review what it will do, then approve or cancel."
  ],
  [
    "ai.confirm.intro.read",
    "The assistant wants to run a tool. Review the inputs, then approve or cancel."
  ],
  [
    "ai.confirm.argsLabel",
    "Arguments"
  ],
  [
    "ai.confirm.toolLabel",
    "Tool"
  ],
  [
    "ai.confirm.run",
    "Approve"
  ],
  [
    "replay.elevation.gainLoss",
    "↑ {{gain}}m  ↓ {{loss}}m"
  ],
  [
    "sparkline.ariaLabel",
    "Trend sparkline"
  ],
  [
    "battery.delta.unknown",
    "Battery delta unknown"
  ],
  [
    "battery.delta.aria",
    "Battery {{from}}% to {{to}}%"
  ],
  [
    "driveScore.gaugeLabel",
    "Drive score: {{score}} out of 100"
  ],
  [
    "live.scope",
    "Live data"
  ],
  [
    "operations.narrative.evidenceCoverage",
    "{{count}} supporting records supplied."
  ],
  [
    "score.aria",
    "Score {{grade}}"
  ],
  [
    "serviceStatus.offline",
    "You are offline. Data may be stale. Reconnecting automatically…"
  ],
  [
    "serviceStatus.systemHealth",
    "System: {{status}}"
  ],
  [
    "timeline.empty",
    "No timeline entries yet."
  ],
  [
    "emptyState.label.prerequisite",
    "What has to happen first"
  ],
  [
    "emptyState.label.likelyCause",
    "Most likely reason"
  ],
  [
    "dataUnavailable.whatToDo",
    "What to do"
  ],
  [
    "errorHelp.title",
    "Where to look next"
  ],
  [
    "installPrompt.ios.intro",
    "iOS installs web apps from the Safari share menu — there is no automatic install button."
  ],
  [
    "installPrompt.ios.step1",
    "Tap the Share button in Safari."
  ],
  [
    "installPrompt.ios.step2",
    "Choose Add to Home Screen."
  ],
  [
    "installPrompt.ios.step3",
    "Confirm with Add."
  ],
  [
    "pwa.lowBandwidth.auto",
    "Automatic (follow the network)"
  ],
  [
    "pwa.lowBandwidth.off",
    "Always off"
  ],
  [
    "pwa.lowBandwidth.heading",
    "Low-bandwidth mode"
  ],
  [
    "pwa.lowBandwidth.label",
    "Data usage on this device"
  ],
  [
    "pwa.lowBandwidth.statusNetwork",
    "Active — your browser or network reported Data Saver / a 2G-class connection."
  ],
  [
    "pwa.lowBandwidth.statusUser",
    "Active — enabled manually on this device."
  ],
  [
    "pwa.lowBandwidth.statusOff",
    "Not active — the app is using full quality."
  ],
  [
    "pwa.lowBandwidth.effectsOn",
    "While active: background polling slows to a quarter of its normal rate, entrance animations are disabled, charts render at most {{points}} points, satellite/terrain basemaps fall back to the lightest raster tiles, and the service worker stops storing new images and map tiles."
  ],
  [
    "pwa.lowBandwidth.effectsOff",
    "When active: polling slows down, animations stop, charts render fewer points, heavy basemaps fall back to light tiles, and the service worker stops caching new images and map tiles."
  ],
  [
    "onboarding.close",
    "Close and skip introduction"
  ],
  [
    "onboarding.getStarted",
    "Get Started"
  ],
  [
    "accessGuidance.grantedByLabel",
    "Who can grant this"
  ],
  [
    "accessGuidance.stepsLabel",
    "How to request access"
  ],
  [
    "problemReport.intro",
    "Describe what happened in your own words. We attach a redacted technical summary only if you allow it."
  ],
  [
    "problemReport.form.title",
    "What went wrong?"
  ],
  [
    "problemReport.form.titlePlaceholder",
    "Short summary (e.g. \"Charging costs show as blank\")"
  ],
  [
    "problemReport.form.description",
    "What were you doing, and what did you expect?"
  ],
  [
    "problemReport.form.descriptionPlaceholder",
    "Steps you took, what you saw, and what you expected to see instead."
  ],
  [
    "problemReport.form.descriptionTooShort",
    "Please add at least {{count}} characters."
  ],
  [
    "problemReport.context.title",
    "What is sent with your report"
  ],
  [
    "problemReport.context.pageNote",
    "(record ids are replaced with :id)"
  ],
  [
    "problemReport.form.includeDiagnostics",
    "Attach a redacted technical summary ({{count}} recent errors)"
  ],
  [
    "problemReport.form.includeDiagnosticsHint",
    "Versions, browser capability, service health, error messages and trace IDs. Never VINs, locations, tokens, e-mail addresses or raw logs."
  ],
  [
    "problemReport.policy.consoleTail",
    "Console output"
  ],
  [
    "problemReport.policy.files",
    "File attachments"
  ],
  [
    "problemReport.policy.screenshots",
    "Screenshots"
  ],
  [
    "problemReport.policy.userEmail",
    "E-mail address"
  ],
  [
    "problemReport.form.hidePreview",
    "Hide exactly what is sent"
  ],
  [
    "problemReport.form.showPreview",
    "Show exactly what is sent"
  ],
  [
    "problemReport.submitError",
    "Could not send the report. Please try again."
  ],
  [
    "problemReport.form.submitting",
    "Sending…"
  ],
  [
    "problemReport.form.submit",
    "Send report"
  ],
  [
    "runtimeHealth.title",
    "TeslaSync is running in degraded mode"
  ],
  [
    "runtimeHealth.affected",
    "Affected components: {{components}}."
  ],
  [
    "runtimeHealth.telemetryLastSeen",
    "The last Fleet Telemetry signal arrived {{time}}. Stored history remains available while live values recover."
  ],
  [
    "runtimeHealth.historyAvailable",
    "The application and stored history remain available; live or dependent features may be stale."
  ],
  [
    "runtimeHealth.configureAlerts",
    "Health alerts"
  ],
  [
    "date.range.loadingCalendar",
    "Loading calendar…"
  ],
  [
    "form.validation.summaryTitleOne",
    "Fix 1 problem before continuing"
  ],
  [
    "form.validation.summaryTitleMany",
    "Fix {{count}} problems before continuing"
  ],
  [
    "nav.suggest.chargingVehicle",
    "{{vehicle}} is charging"
  ],
  [
    "nav.suggest.drivingVehicle",
    "{{vehicle}} is on the move"
  ],
  [
    "nav.suggest.driving",
    "On the move"
  ],
  [
    "nav.suggest.related",
    "Related to {{page}}"
  ],
  [
    "nav.staleCount",
    "{{count}} stale rows"
  ],
  [
    "nav.pinPage",
    "Pin {{page}} to favorites"
  ],
  [
    "nav.empty",
    "No pages yet."
  ],
  [
    "nav.sidebar",
    "Sidebar navigation"
  ],
  [
    "theme.loadingPicker",
    "Loading theme picker…"
  ],
  [
    "carAnimation.battery",
    "Battery at {{level}} percent"
  ],
  [
    "signalQuery.signalsMax",
    "Signals (max {{count}})"
  ],
  [
    "signalQuery.removeSignal",
    "Remove {{signal}}"
  ],
  [
    "signalQuery.searchSignals",
    "Search signals"
  ],
  [
    "signalQuery.addMoreSignals",
    "Add more signals…"
  ],
  [
    "signalQuery.loadingSignals",
    "Loading signals…"
  ],
  [
    "signalQuery.signalsError",
    "Failed to load signals"
  ],
  [
    "signalQuery.maxReached",
    "Maximum of {{count}} signals selected"
  ],
  [
    "signalQuery.records",
    "{{n}} records"
  ],
  [
    "palette.section.related",
    "Related to this page"
  ],
  [
    "palette.related.parent",
    "Back to section"
  ],
  [
    "palette.related.sibling",
    "Same section"
  ],
  [
    "palette.dialogLabel",
    "Command palette"
  ],
  [
    "palette.filterBy",
    "Filter"
  ],
  [
    "common.panel",
    "Panel"
  ],
  [
    "glossary.tooltipLabel",
    "What is {{term}}?"
  ],
  [
    "signalConfig.setAll",
    "Set all…"
  ],
  [
    "signalConfig.title",
    "Fleet Telemetry Signal Configuration"
  ],
  [
    "signalConfig.footerSelected",
    "{{n}} signals selected"
  ],
  [
    "signalConfig.footerAt500",
    "{{n}} at 500ms"
  ],
  [
    "signalConfig.footerAt10s",
    "{{n}} at 10s"
  ],
  [
    "signalConfig.subscribeCount",
    "Subscribe {{n}} Signals"
  ],
  [
    "signalConfig.selectedSummary",
    "{{selected}} / {{total}} signals selected"
  ],
  [
    "signalConfig.deselectAll",
    "Deselect All"
  ],
  [
    "signalConfig.selectAll",
    "Select All"
  ],
  [
    "signalConfig.masterInterval",
    "Master Interval:"
  ],
  [
    "signalConfig.masterIntervalLabel",
    "Master sampling interval for all signals"
  ],
  [
    "signalConfig.searchPlaceholder",
    "Search signals..."
  ],
  [
    "signalConfig.searchLabel",
    "Search signals"
  ],
  [
    "signalConfig.noMatches",
    "No signals match “{{query}}”."
  ],
  [
    "signalConfig.noSignals",
    "No telemetry signals are available to configure."
  ],
  [
    "signalConfig.deselectSignal",
    "Deselect {{signal}}"
  ],
  [
    "signalConfig.selectSignal",
    "Select {{signal}}"
  ],
  [
    "signalConfig.intervalForSignal",
    "Sampling interval for {{signal}}"
  ],
  [
    "vehicleHero.noState",
    "Live telemetry unavailable"
  ],
  [
    "apiLogs.copyRequestUrl",
    "Copy request URL"
  ],
  [
    "apiLogs.durationValue",
    "{{value}}ms"
  ],
  [
    "apiLogs.latency",
    "Latency (ms)"
  ],
  [
    "admin.schemaDrift.breakdownTitle",
    "Drift breakdown"
  ],
  [
    "admin.schemaDrift.breakdownSub",
    "Per-object comparison of current vs seed"
  ],
  [
    "admin.schemaDrift.breakdownEmpty",
    "No comparison available yet."
  ],
  [
    "admin.schemaDrift.seedCaptured",
    "Seed captured {{when}}"
  ],
  [
    "admin.schemaDrift.currentExpected",
    "{{current}} → {{expected}}"
  ],
  [
    "admin.schemaDrift.fingerprintTitle",
    "Schema fingerprints"
  ],
  [
    "admin.schemaDrift.fingerprintSub",
    "SHA-256 of the live schema versus the captured seed"
  ],
  [
    "admin.schemaDrift.emptyMessage",
    "The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint."
  ],
  [
    "admin.schemaDrift.emptyTitle",
    "No fingerprint available"
  ],
  [
    "admin.schemaDrift.fingerprintExpected",
    "Expected (seed)"
  ],
  [
    "admin.schemaDrift.copyHash",
    "Copy fingerprint hash"
  ],
  [
    "admin.schemaDrift.generatedAt",
    "Captured {{when}}"
  ],
  [
    "admin.schemaDrift.guidanceTitle",
    "What this means"
  ],
  [
    "admin.schemaDrift.guidanceEmpty",
    "Restart the API to capture a seed fingerprint, then drift interpretation appears here."
  ],
  [
    "admin.schemaDrift.cleanBody",
    "The live schema matches the recorded seed fingerprint. Migrations and the seed are in sync — no action required."
  ],
  [
    "admin.schemaDrift.changeTables",
    "Tables {{delta}}"
  ],
  [
    "admin.schemaDrift.changeColumns",
    "Columns {{delta}}"
  ],
  [
    "admin.schemaDrift.changeIndexes",
    "Indexes {{delta}}"
  ],
  [
    "admin.schemaDrift.driftedBodyCounts",
    "The live schema differs from the seed: {{changes}}."
  ],
  [
    "admin.schemaDrift.driftedBodyHash",
    "The live schema fingerprint differs from the seed even though object counts match — inspect column definitions or index expressions."
  ],
  [
    "admin.schemaDrift.remediateSeed",
    "Confirm migrations are applied, then restart the API to regenerate the seed fingerprint."
  ],
  [
    "admin.schemaDrift.remediateDdl",
    "If migrations are already current, investigate raw DDL that bypassed the migration system."
  ],
  [
    "admin.schemaDrift.kpis",
    "Schema drift summary"
  ],
  [
    "admin.schemaDrift.statusHint",
    "Current schema vs recorded seed"
  ],
  [
    "admin.schemaDrift.tableDelta",
    "Tables Δ"
  ],
  [
    "admin.schemaDrift.columnDelta",
    "Columns Δ"
  ],
  [
    "admin.schemaDrift.indexDelta",
    "Indexes Δ"
  ],
  [
    "admin.schemaDrift.statusDrifted",
    "Drift detected"
  ],
  [
    "admin.schemaDrift.statusClean",
    "No drift"
  ],
  [
    "admin.schemaDrift.deltaSub",
    "{{current}} current · {{expected}} expected"
  ],
  [
    "admin.slowQueries.chartTitle",
    "Top queries by {{metric}}"
  ],
  [
    "admin.slowQueries.analysis",
    "Query analysis"
  ],
  [
    "admin.slowQueries.chartAria",
    "Horizontal bar chart ranking the top queries by {{metric}}"
  ],
  [
    "admin.slowQueries.noChart",
    "No queries to chart yet."
  ],
  [
    "admin.slowQueries.cacheTitle",
    "Cache efficiency"
  ],
  [
    "admin.slowQueries.noCache",
    "No shared-buffer statistics available for these queries."
  ],
  [
    "admin.slowQueries.cacheHint",
    "Lowest hit ratios first — I/O-bound queries are the strongest indexing candidates."
  ],
  [
    "admin.slowQueries.kpis",
    "Query performance summary"
  ],
  [
    "admin.slowQueries.kpiAnalyzed",
    "Queries analyzed"
  ],
  [
    "admin.slowQueries.kpiCallsSub",
    "Across shown queries"
  ],
  [
    "admin.slowQueries.kpiTotalTime",
    "Aggregate time"
  ],
  [
    "admin.slowQueries.kpiTotalTimeSub",
    "Summed total_time"
  ],
  [
    "admin.slowQueries.kpiSlowestMean",
    "Slowest mean"
  ],
  [
    "admin.slowQueries.kpiSlowestMeanSub",
    "Worst per-call average"
  ],
  [
    "admin.slowQueries.kpiPeak",
    "Peak max"
  ],
  [
    "admin.slowQueries.kpiPeakSub",
    "Slowest single call"
  ],
  [
    "admin.slowQueries.kpiCache",
    "Cache hit ratio"
  ],
  [
    "admin.slowQueries.kpiCacheSub",
    "Shared-buffer hits"
  ],
  [
    "admin.vehicleCost.topTalkersTitle",
    "Top talkers"
  ],
  [
    "admin.vehicleCost.topTalkersSubtitle",
    "Share of total rows ingested"
  ],
  [
    "admin.vehicleCost.topTalkersEmpty",
    "No vehicles have ingested signals yet."
  ],
  [
    "admin.vehicleCost.topTalkersListLabel",
    "Top talkers ranked by ingested rows"
  ],
  [
    "admin.auditLog.detailIp",
    "IP"
  ],
  [
    "admin.auditLog.detailUa",
    "User-agent"
  ],
  [
    "admin.auditLog.detailHash",
    "Row hash"
  ],
  [
    "coverage.col.column",
    "Column"
  ],
  [
    "coverage.col.dualWrite",
    "Dual write"
  ],
  [
    "coverage.dualWrite.yes",
    "signal_log"
  ],
  [
    "coverage.subscribed.yes",
    "yes"
  ],
  [
    "coverage.col.subscribed",
    "Configured subscription"
  ],
  [
    "coverage.category.totalFields",
    "{{count}} routed fields"
  ],
  [
    "coverage.category.noMatch",
    "No fields match the current filter."
  ],
  [
    "coverage.category.empty",
    "This category has no routed fields."
  ],
  [
    "devtools.overview.title",
    "Developer tools overview"
  ],
  [
    "devtools.overview.affectedVins",
    "affected VINs"
  ],
  [
    "devtools.overview.inFleet",
    "in fleet"
  ],
  [
    "devtools.overview.fleetEndpoints",
    "Fleet API endpoints"
  ],
  [
    "devtools.overview.documented",
    "documented"
  ],
  [
    "devtools.overview.telemetrySignals",
    "Telemetry signals"
  ],
  [
    "devtools.overview.streamedFields",
    "streamed fields"
  ],
  [
    "devtools.overview.referenceDocs",
    "Reference docs"
  ],
  [
    "devtools.overview.externalLinks",
    "external links"
  ],
  [
    "devtools.errorsIdle",
    "Click View Errors to fetch recent Fleet Telemetry errors for this vehicle."
  ],
  [
    "devtools.errorsEmpty",
    "No Fleet Telemetry errors reported for this vehicle."
  ],
  [
    "devtools.errorsRaw",
    "Show raw Tesla response"
  ],
  [
    "devtools.vehicleDataIdle",
    "Choose a vehicle and an action to see results."
  ],
  [
    "devtools.onboarding.goToStep",
    "Go to step {{step}}: {{label}}"
  ],
  [
    "devtools.health.errorVinsResource",
    "telemetry error VINs"
  ],
  [
    "devtools.health.errorLogResource",
    "telemetry error log"
  ],
  [
    "devtools.infra.mqttDesc",
    "Publish a test message to the MQTT broker"
  ],
  [
    "devtools.infra.sendTest",
    "Send test"
  ],
  [
    "devtools.infra.dbStats",
    "DB stats"
  ],
  [
    "devtools.infra.dbStatsDesc",
    "Inspect TimescaleDB table sizes and row counts"
  ],
  [
    "devtools.infra.migrationsDesc",
    "View applied and pending database migrations"
  ],
  [
    "devtools.infra.envCheck",
    "Env check"
  ],
  [
    "devtools.infra.envCheckDesc",
    "Verify required environment variables are configured"
  ],
  [
    "devtools.infra.runtimeDesc",
    "Inspect Go runtime, memory, and goroutine stats"
  ],
  [
    "devtools.ref.empty",
    "No reference links available"
  ],
  [
    "devtools.utils.base64PlaceholderEncode",
    "Hello World"
  ],
  [
    "devtools.utils.base64Mode",
    "Conversion mode"
  ],
  [
    "devtools.utils.jsonInput",
    "JSON input"
  ],
  [
    "devtools.utils.jsonEmpty",
    "Paste JSON above to validate and pretty-print it."
  ],
  [
    "devtools.url.modeGroup",
    "Encoding mode"
  ],
  [
    "admin.dlq.actions.inspectRow",
    "Inspect DLQ entry {{id}}"
  ],
  [
    "admin.dlq.drawer.payloadView",
    "Payload view"
  ],
  [
    "admin.dlq.drawer.loading",
    "Loading payload details…"
  ],
  [
    "admin.dlq.reasons.listLabel",
    "Failure reasons breakdown"
  ],
  [
    "admin.flags.composition.ariaLabel",
    "Returned flag value presentation; stored values are text"
  ],
  [
    "admin.flags.actions.editFlag",
    "Edit flag {{key}}"
  ],
  [
    "admin.flags.actions.deleteFlag",
    "Delete flag {{key}}"
  ],
  [
    "feedback.queue.bridge.title",
    "GitHub bridge"
  ],
  [
    "feedback.category.mixLabel",
    "Feedback category mix"
  ],
  [
    "feedback.queue.distAria",
    "Status distribution: {{new}} new, {{triaged}} triaged, {{closed}} closed"
  ],
  [
    "admin.gdprExport.metaTitle",
    "Artifact details"
  ],
  [
    "admin.gdprExport.metaUser",
    "User"
  ],
  [
    "admin.gdprExport.metaSha256",
    "SHA-256"
  ],
  [
    "admin.gdprExport.metaEmpty",
    "Look up an export artifact to see its metadata here."
  ],
  [
    "admin.gdprExport.downloadHint",
    "The bundle streams from the backend through this browser. The download counter is logged to the audit ledger."
  ],
  [
    "admin.gdprExport.downloadButton",
    "Download bundle"
  ],
  [
    "admin.gdprExport.downloadWait",
    "Download becomes available once the export completes."
  ],
  [
    "admin.gdprExport.downloadExpired",
    "This artifact has expired and is no longer downloadable."
  ],
  [
    "admin.gdprExport.downloadFailed",
    "No bundle available — see the error above."
  ],
  [
    "admin.gdprExport.lifecycle.failedGeneric",
    "Export did not finish"
  ],
  [
    "admin.gdprExport.lifecycleTitle",
    "Lifecycle"
  ],
  [
    "admin.gdprExport.lifecycleEmpty",
    "No lifecycle events recorded yet."
  ],
  [
    "admin.gdprExport.lookupTitle",
    "Lookup artifact"
  ],
  [
    "admin.gdprExport.idLabel",
    "Artifact ID"
  ],
  [
    "admin.gdprExport.idPlaceholder",
    "e.g. 8f4c…"
  ],
  [
    "admin.gdprExport.lookupButton",
    "Look up"
  ],
  [
    "admin.gdprExport.lookupHint",
    "Enter an artifact ID to look up its saved metadata. Use Refresh to request an updated snapshot; this page does not poll automatically."
  ],
  [
    "admin.gdprExport.lookupBlurb",
    "Lookup and Refresh only read artifact metadata; they do not create exports or download bundles. Bundles expire after the configured retention window. A saved manifest does not confirm current download availability or storage support."
  ],
  [
    "impersonation.policy.audit.title",
    "Every session is audit-logged"
  ],
  [
    "impersonation.policy.audit.body",
    "Starting and ending a session writes an immutable entry to the admin audit log with the actor and the target."
  ],
  [
    "impersonation.policy.ttl.title",
    "15-minute time limit"
  ],
  [
    "impersonation.policy.ttl.body",
    "A session expires automatically after 15 minutes so a forgotten session cannot linger."
  ],
  [
    "impersonation.policy.sudo.title",
    "Step-up auth to start"
  ],
  [
    "impersonation.policy.sudo.body",
    "Starting a session requires a fresh re-authentication prompt; ending one never does."
  ],
  [
    "impersonation.policy.forwardAuth.title",
    "Forward-auth required"
  ],
  [
    "impersonation.policy.forwardAuth.body",
    "Per-subject identity only exists when the proxy runs in forward-auth mode. Open-mode installs cannot impersonate."
  ],
  [
    "impersonation.policy.exit.title",
    "End it any time"
  ],
  [
    "impersonation.policy.exit.body",
    "The global banner at the top of the screen ends the active session immediately and restores your own view."
  ],
  [
    "impersonation.policy.title",
    "How impersonation works"
  ],
  [
    "impersonation.policy.intro",
    "Impersonation lets an admin view TeslaSync exactly as another subject to reproduce a support issue. It is deliberately constrained:"
  ],
  [
    "impersonation.policy.listLabel",
    "Impersonation guarantees"
  ],
  [
    "admin.xray.kpis",
    "Ingest summary metrics"
  ],
  [
    "admin.xray.stats.peak",
    "Peak / bucket"
  ],
  [
    "admin.xray.stats.peakSub",
    "busiest interval"
  ],
  [
    "admin.xray.stats.avg",
    "Avg / bucket"
  ],
  [
    "admin.xray.stats.avgSub",
    "mean per interval"
  ],
  [
    "admin.xray.stats.bucketSub",
    "aggregation interval"
  ],
  [
    "admin.xray.topFields.title",
    "Top fields by volume"
  ],
  [
    "admin.xray.topFields.empty",
    "No field activity in this window yet."
  ],
  [
    "admin.liveSignals.panels.kinds",
    "Signal kinds"
  ],
  [
    "admin.liveSignals.kinds.noVehicle",
    "Select a vehicle to break its signals down by value kind."
  ],
  [
    "admin.liveSignals.kinds.empty",
    "No live signals to categorise yet."
  ],
  [
    "admin.liveSignals.kinds.chartAria",
    "Bar chart of live signal counts grouped by value kind."
  ],
  [
    "admin.liveSignals.sources.barAria",
    "Signal source-layer distribution: {{l1}} live, {{stale}} stale, {{l2}} legacy, {{unknown}} unknown"
  ],
  [
    "admin.liveSignals.sources.noVehicle",
    "Select a vehicle to see how its signals are distributed across the L1 / L2 / stale layers."
  ],
  [
    "admin.liveSignals.sources.empty",
    "No live signals to classify yet."
  ],
  [
    "admin.operationalSummary.refreshing",
    "Refreshing sources"
  ],
  [
    "admin.operationalSummary.partial",
    "Independent source availability"
  ],
  [
    "admin.operationalSummary.empty",
    "Empty source"
  ],
  [
    "admin.operationalSummary.unknown",
    "Source not loaded"
  ],
  [
    "admin.operationalSummary.loaded",
    "Sources loaded"
  ],
  [
    "devtools.summary.source",
    "Telemetry errors and fleet size use independent live queries. Endpoint, signal and reference counts describe the local developer catalogs, not live coverage."
  ],
  [
    "devtools.summary.liveTitle",
    "Live fleet snapshot"
  ],
  [
    "devtools.summary.liveSource",
    "Telemetry errors count affected VINs; fleet size comes from the independent vehicle inventory."
  ],
  [
    "devtools.summary.liveScope",
    "Independent live snapshots; observation bounds are not supplied."
  ],
  [
    "devtools.summary.catalogTitle",
    "Local developer catalog"
  ],
  [
    "devtools.summary.catalogSource",
    "Counts use the same local endpoint, telemetry-field and reference-link definitions shown in the developer tabs."
  ],
  [
    "devtools.summary.catalogScope",
    "Static bundled reference definitions, not measured live coverage."
  ],
  [
    "fleetApi.kpis.apiStatus",
    "API status"
  ],
  [
    "fleetApi.kpis.endpointsEnabled",
    "Endpoints enabled"
  ],
  [
    "fleetApi.summary.selected",
    "Selected for polling"
  ],
  [
    "fleetApi.kpis.label",
    "Fleet API summary"
  ],
  [
    "fleetApi.summary.source",
    "API status uses application settings and polling configuration. Enabled and selected-for-polling counts use the returned endpoint catalog, independent of the endpoint table filters."
  ],
  [
    "fleetApi.summary.scope",
    "Settings and polling snapshots; no shared observation time is reported."
  ],
  [
    "gas.summary.title",
    "Polling status and price"
  ],
  [
    "gas.summary.source",
    "Auto-poll status, current prices and last poll time use the status response. Prices keep their source per-volume and per-kWh denominations; the history chart is a separate source."
  ],
  [
    "gas.summary.scope",
    "Current polling-status snapshot; an exact observation time and price coverage window are not reported."
  ],
  [
    "rbac.brief.scope",
    "Saved provider bindings and permissions for your current authenticated roles; unsaved edits are not included."
  ],
  [
    "admin.security.brief.sentry",
    "Percentage of returned security-event samples with Sentry active; not time-weighted uptime or complete vehicle coverage."
  ],
  [
    "admin.security.brief.lastLock",
    "Latest observed lock transition in the returned history, or the first event timestamp when no transition is found."
  ],
  [
    "admin.security.brief.title",
    "Security observation summary"
  ],
  [
    "admin.security.brief.freshness",
    "Latest security observation: {{when}}"
  ],
  [
    "impersonation.users.brief.scope",
    "Current impersonation status and available session subjects are independent sources. Open mode disables subject discovery."
  ],
  [
    "impersonation.users.kpi.available",
    "Available subjects"
  ],
  [
    "impersonation.users.kpi.limit",
    "Session limit"
  ],
  [
    "impersonation.users.brief.limit",
    "Configured policy limit of 15 minutes, not the active session’s remaining time."
  ],
  [
    "impersonation.users.brief.title",
    "Subject and session posture"
  ],
  [
    "impersonation.users.brief.provenance",
    "Authenticated-session telemetry and impersonation policy"
  ],
  [
    "system.brief.scope",
    "Budget usage spans each source throttle window. Worker heartbeat and backlog are snapshots; succeeded and terminally failed jobs cover the last 24 hours."
  ],
  [
    "system.brief.title",
    "Budgets and worker posture"
  ],
  [
    "system.brief.freshness",
    "Budget snapshot: {{rate}} · Worker snapshot: {{queue}}"
  ],
  [
    "system.brief.provenance",
    "Rate-limit budgets and background-worker queue reports"
  ],
  [
    "playground.codeSnippetContent",
    "Generated code snippet"
  ],
  [
    "admin.security.timeline.unknownDesc",
    "Vehicle state updated"
  ],
  [
    "coverage.stat.subscriptionCoverage",
    "Subscription coverage"
  ],
  [
    "coverage.kpis",
    "Coverage summary"
  ],
  [
    "admin.secretRotation.kindCount",
    "{{count}} kinds tracked"
  ],
  [
    "admin.secretRotation.okSub",
    "{{pct}} of tracked"
  ],
  [
    "admin.secretRotation.warnSub",
    "Approaching threshold"
  ],
  [
    "admin.secretRotation.criticalSub",
    "Past critical threshold"
  ],
  [
    "admin.secretRotation.oldestLabel",
    "Oldest secret"
  ],
  [
    "admin.secretRotation.soonestExpiryLabel",
    "Soonest expiry"
  ],
  [
    "admin.secretRotation.noExpiry",
    "No expiry tracked"
  ],
  [
    "admin.secretRotation.kpis",
    "Rotation summary"
  ],
  [
    "redis.cachedSignals",
    "Cached signals"
  ],
  [
    "redis.l1Subtitle",
    "In-process store"
  ],
  [
    "redis.l2Fields",
    "L2 fields"
  ],
  [
    "redis.l2Subtitle",
    "Redis HSET"
  ],
  [
    "redis.kpis",
    "Cache metrics"
  ],
  [
    "admin.diskForecast.kpis",
    "Fleet disk summary"
  ],
  [
    "admin.diskForecast.growthSub",
    "Sum across all hypertables"
  ],
  [
    "admin.diskForecast.percentSub",
    "Compressed chunks only; not a share of current disk usage."
  ],
  [
    "admin.diskForecast.fleetTotal",
    "Total disk"
  ],
  [
    "admin.diskForecast.fleetUncompressed",
    "Before compression"
  ],
  [
    "admin.diskForecast.fleetGrowth",
    "Growth (per day)"
  ],
  [
    "admin.diskForecast.largest",
    "Largest table"
  ],
  [
    "admin.diskForecast.soonestQuota",
    "Soonest quota"
  ],
  [
    "admin.diskForecast.colDays",
    "Days to quota"
  ],
  [
    "admin.diskForecast.noQuota",
    "No quota estimate available"
  ],
  [
    "admin.auditLog.colEntity",
    "Entity"
  ],
  [
    "admin.auditLog.colTrace",
    "Trace"
  ],
  [
    "admin.auditLog.hideDetails",
    "Hide"
  ],
  [
    "admin.auditLog.tableTitle",
    "Entries"
  ],
  [
    "admin.auditLog.emptyTitle",
    "No audit entries"
  ],
  [
    "admin.auditLog.emptyMessage",
    "No rows match the current filter. Try widening the time range or clearing the filters."
  ],
  [
    "admin.auditLog.emptyTable",
    "No entries"
  ],
  [
    "admin.auditLog.untilLabel",
    "Until"
  ],
  [
    "admin.auditLog.actorPlaceholder",
    "e.g. admin@local"
  ],
  [
    "admin.auditLog.entityTypeLabel",
    "Entity type"
  ],
  [
    "admin.auditLog.entityTypePlaceholder",
    "e.g. vehicle, alert_rule"
  ],
  [
    "admin.auditLog.integrityTitle",
    "Hash chain integrity"
  ],
  [
    "admin.auditLog.verifyButton",
    "Verify chain"
  ],
  [
    "admin.auditLog.chainIntact",
    "Chain intact"
  ],
  [
    "admin.auditLog.chainBroken",
    "Chain broken"
  ],
  [
    "admin.auditLog.rowsChecked",
    "{{count}} rows checked"
  ],
  [
    "admin.auditLog.firstBadId",
    "First bad row: #{{id}}"
  ],
  [
    "admin.auditLog.verifyHint",
    "Re-derive every row_hash server-side. No data is sent or written — this is read-only."
  ],
  [
    "fleetApi.configured.title",
    "API endpoints"
  ],
  [
    "fleetApi.configured.heading",
    "Configured endpoints"
  ],
  [
    "fleetApi.controls.title",
    "API endpoint controls"
  ],
  [
    "fleetApi.controls.enabledCount",
    "{{enabled}}/{{total}} enabled"
  ],
  [
    "fleetApi.polling.title",
    "Tesla API polling"
  ],
  [
    "fleetApi.polling.toggleAria",
    "Toggle Tesla API polling"
  ],
  [
    "admin.secretRotation.ageSection",
    "Secret age and severity"
  ],
  [
    "admin.secretRotation.ageTitle",
    "Secret age by kind"
  ],
  [
    "admin.secretRotation.ageAria",
    "Horizontal bar chart of the oldest tracked secrets by age in days, colored by severity tier"
  ],
  [
    "admin.secretRotation.noAgeData",
    "No rotation ages to chart yet."
  ],
  [
    "admin.secretRotation.colAge",
    "Age (days)"
  ],
  [
    "admin.secretRotation.daysValue",
    "{{days}} d"
  ],
  [
    "admin.secretRotation.severityTitle",
    "Severity mix"
  ],
  [
    "admin.secretRotation.severityAria",
    "Donut chart of tracked secrets grouped by rotation severity tier"
  ],
  [
    "admin.secretRotation.noSeverity",
    "No severity data available yet."
  ],
  [
    "admin.secretRotation.colRotated",
    "Last rotated"
  ],
  [
    "admin.secretRotation.daysToExpiry",
    "{{days}}d remaining"
  ],
  [
    "admin.secretRotation.colThresholds",
    "Warn / critical"
  ],
  [
    "admin.secretRotation.tableTitle",
    "Rotation status"
  ],
  [
    "admin.secretRotation.emptyTitle",
    "No tracked secrets"
  ],
  [
    "admin.secretRotation.emptyMessage",
    "No rotation events have been recorded yet. The tracker captures observations on every credential rotation."
  ],
  [
    "admin.secretRotation.emptyTable",
    "No tracked secrets"
  ],
  [
    "admin.secretRotation.outlook",
    "Rotation urgency and expiry outlook"
  ],
  [
    "admin.secretRotation.urgencyTitle",
    "Rotation urgency"
  ],
  [
    "admin.secretRotation.noUrgency",
    "No rotation ages to rank yet."
  ],
  [
    "admin.secretRotation.expiryTitle",
    "Expiry watch"
  ],
  [
    "admin.secretRotation.noExpiryTitle",
    "No expiring credentials"
  ],
  [
    "admin.secretRotation.noExpiryMessage",
    "None of the tracked secrets carry a hard expiry date. Rotation is driven by age thresholds instead."
  ],
  [
    "admin.secretRotation.totalLabel",
    "Tracked secrets"
  ],
  [
    "admin.secretRotation.warnLabel",
    "Rotate soon"
  ],
  [
    "admin.slowQueries.colFingerprint",
    "Query fingerprint"
  ],
  [
    "admin.slowQueries.colCalls",
    "Calls"
  ],
  [
    "admin.slowQueries.colMean",
    "Mean (ms)"
  ],
  [
    "admin.slowQueries.colMax",
    "Max (ms)"
  ],
  [
    "admin.slowQueries.colTotal",
    "Total (ms)"
  ],
  [
    "admin.slowQueries.colCache",
    "Cache hit ratio"
  ],
  [
    "admin.slowQueries.tableTitle",
    "Top queries"
  ],
  [
    "admin.slowQueries.emptyTitle",
    "No slow queries"
  ],
  [
    "admin.slowQueries.emptyMessage",
    "pg_stat_statements is empty or has been reset recently. Slow queries will accumulate here as the system processes load."
  ],
  [
    "admin.slowQueries.emptyTable",
    "No slow queries"
  ],
  [
    "impersonation.users.currentTarget",
    "Current target"
  ],
  [
    "impersonation.users.tableTitle",
    "Active subjects"
  ],
  [
    "impersonation.users.searchPlaceholder",
    "Search subjects…"
  ],
  [
    "impersonation.users.searchLabel",
    "Search subjects"
  ],
  [
    "impersonation.users.noMatch",
    "No subjects match your search."
  ],
  [
    "admin.vehicleCost.chartTitle",
    "Ingest cost by vehicle"
  ],
  [
    "admin.vehicleCost.chartAria",
    "Horizontal bar chart of estimated ingest bytes per vehicle, largest consumer first."
  ],
  [
    "admin.vehicleCost.chartEmpty",
    "No ingest volume recorded in this window yet."
  ],
  [
    "admin.vehicleCost.colBytes",
    "Bytes (est.)"
  ],
  [
    "admin.vehicleCost.rowId",
    "ID {{id}}"
  ],
  [
    "admin.vehicleCost.colFailures",
    "DLQ (24h)"
  ],
  [
    "admin.vehicleCost.tableTitle",
    "Per-vehicle breakdown"
  ],
  [
    "admin.vehicleCost.emptyTitle",
    "No vehicle cost data"
  ],
  [
    "admin.vehicleCost.emptyMessage",
    "No vehicles have ingested signals during this window."
  ],
  [
    "admin.vehicleCost.emptyTable",
    "No vehicle cost data"
  ],
  [
    "admin.vehicleCost.refresh",
    "Refresh vehicle cost data"
  ],
  [
    "admin.auditLog.allActions",
    "All actions"
  ],
  [
    "fleetApi.configured.api",
    "API (internal)"
  ],
  [
    "fleetApi.configured.web",
    "Web frontend"
  ],
  [
    "fleetApi.configured.oauthCallback",
    "OAuth callback"
  ],
  [
    "admin.secretRotation.severityWarn",
    "Rotate soon"
  ],
  [
    "apiKeys.summary.source",
    "Counts are derived from the loaded API key inventory, including active, expired and administrator-access keys."
  ],
  [
    "apiKeys.summary.scope",
    "Loaded inventory snapshot; the response does not report an observation time."
  ],
  [
    "apiLogs.statusSuccess",
    "2xx success"
  ],
  [
    "apiLogs.statusRedirect",
    "3xx redirect"
  ],
  [
    "apiLogs.statusClientError",
    "4xx client error"
  ],
  [
    "apiLogs.statusServerError",
    "5xx server error"
  ],
  [
    "apiLogs.loadedPageScope",
    "Newest first. Filters query all matching requests; exports include only this loaded page."
  ],
  [
    "apiLogs.inspectHint",
    "Expand a request to inspect headers, bodies, and metadata."
  ],
  [
    "playground.networkError",
    "Network error"
  ],
  [
    "playground.kpi.total",
    "Total endpoints"
  ],
  [
    "playground.kpi.read",
    "Read (GET)"
  ],
  [
    "playground.kpi.write",
    "Write ops"
  ],
  [
    "playground.kpi.groups",
    "API groups"
  ],
  [
    "playground.refresh",
    "Reload API spec"
  ],
  [
    "playground.spec",
    "API spec"
  ],
  [
    "playground.kpis",
    "API overview metrics"
  ],
  [
    "playground.summary.specTitle",
    "API specification"
  ],
  [
    "playground.summary.specSource",
    "Endpoint, read-operation, write-operation and group counts use the loaded API specification."
  ],
  [
    "playground.summary.specScope",
    "Specification snapshot; no observation time is supplied."
  ],
  [
    "playground.summary.historyTitle",
    "Recent local requests"
  ],
  [
    "playground.summary.historySource",
    "Request count and average latency use this browser’s saved request history, independently of specification availability."
  ],
  [
    "playground.summary.historyScope",
    "Bounded local request history, not server-wide traffic or a fixed analysis window."
  ],
  [
    "playground.explorer",
    "Endpoint explorer"
  ],
  [
    "playground.noEndpoints",
    "No endpoints found in the API spec"
  ],
  [
    "playground.workspace",
    "Request workspace"
  ],
  [
    "playground.request",
    "Request"
  ],
  [
    "admin.auditLog.subtitle",
    "Append-only audit ledger with SHA-256 hash chaining. Narrow the scope with the filter row and verify the chain to re-derive integrity on demand."
  ],
  [
    "admin.auditLog.notConfigured",
    "The audit log subsystem is not configured on this deployment."
  ],
  [
    "backup.overview",
    "Backup overview"
  ],
  [
    "backup.summary.source",
    "Configuration counts use the loaded configurations. Run counts, completion rate, last completed backup and storage size use the returned run list, not a server-wide total."
  ],
  [
    "backup.summary.scope",
    "Independent configuration and run snapshots; run-list coverage and observation bounds are not supplied."
  ],
  [
    "backup.manage",
    "Backup management"
  ],
  [
    "backup.reliability",
    "Reliability & storage"
  ],
  [
    "backup.noRunsReliability",
    "No backup runs to analyze yet."
  ],
  [
    "backup.completedVsTotal",
    "Completed vs total"
  ],
  [
    "backup.storageByProvider",
    "Storage by provider"
  ],
  [
    "backup.noStorage",
    "No stored backups yet."
  ],
  [
    "backup.noErrors",
    "No recent backup failures."
  ],
  [
    "backup.runN",
    "Run #{{id}}"
  ],
  [
    "devtools.tab.utilities",
    "Utilities"
  ],
  [
    "devtools.refreshStatus",
    "Refresh developer tools status"
  ],
  [
    "devtools.tools",
    "Developer tool areas"
  ],
  [
    "admin.diskForecast.colTable",
    "Hypertable"
  ],
  [
    "admin.diskForecast.chunkCount",
    "{{count}} chunks"
  ],
  [
    "admin.diskForecast.colSplit",
    "Before / after compression"
  ],
  [
    "admin.diskForecast.compressedSuffix",
    "after compression"
  ],
  [
    "admin.diskForecast.colGrowth",
    "Growth (per day)"
  ],
  [
    "admin.diskForecast.subtitle",
    "Current per-hypertable disk usage, before/after compression sizes for compressed chunks, and source-supplied days-to-quota estimates. Compression sizes are not additive parts of current disk usage."
  ],
  [
    "admin.diskForecast.notConfigured",
    "TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible."
  ],
  [
    "admin.diskForecast.criticalTitle",
    "Quota pressure"
  ],
  [
    "admin.diskForecast.criticalMessage",
    "{{count}} hypertable(s) are in the critical tier for their configured quota. Review retention, compression, or the quota threshold."
  ],
  [
    "admin.diskForecast.composition",
    "Compression size comparison"
  ],
  [
    "admin.diskForecast.compositionTitle",
    "Before vs after compression"
  ],
  [
    "admin.diskForecast.compositionAria",
    "Grouped bar chart comparing before and after compression sizes of compressed chunks in the largest hypertables"
  ],
  [
    "admin.diskForecast.noComposition",
    "No hypertable sizes to chart yet."
  ],
  [
    "admin.diskForecast.uncompressed",
    "Before compression"
  ],
  [
    "admin.diskForecast.severityTitle",
    "Severity mix"
  ],
  [
    "admin.diskForecast.severityAria",
    "Donut chart of hypertables grouped by quota severity tier"
  ],
  [
    "admin.diskForecast.noSeverity",
    "No severity data available yet."
  ],
  [
    "admin.diskForecast.outlook",
    "Growth and quota outlook"
  ],
  [
    "admin.diskForecast.growthTitle",
    "Fastest-growing hypertables"
  ],
  [
    "admin.diskForecast.noGrowth",
    "No measurable daily growth yet."
  ],
  [
    "admin.diskForecast.quotaTitle",
    "Days to quota"
  ],
  [
    "admin.diskForecast.noQuotaTitle",
    "No quota estimate available"
  ],
  [
    "admin.diskForecast.noQuotaMessage",
    "An estimate may be absent when there is no measurable growth. Missing estimates do not establish whether a quota is configured."
  ],
  [
    "admin.diskForecast.daysValue",
    "{{days}} d"
  ],
  [
    "admin.diskForecast.tableTitle",
    "Hypertables"
  ],
  [
    "admin.diskForecast.emptyTitle",
    "No hypertables"
  ],
  [
    "admin.diskForecast.emptyMessage",
    "No hypertables found in this database. The disk forecast surfaces TimescaleDB hypertables only."
  ],
  [
    "admin.diskForecast.emptyTable",
    "No hypertables"
  ],
  [
    "feedback.queue.kpi.total",
    "Total feedback"
  ],
  [
    "feedback.queue.subtitle",
    "Triage user-submitted bug reports and feature requests"
  ],
  [
    "feedback.queue.kpis",
    "Queue overview"
  ],
  [
    "feedback.queue.summary.source",
    "Whole-queue counts come from independent status and category queries, unaffected by the table filters. Total feedback sums new, triaged and closed counts only when all three are available."
  ],
  [
    "feedback.queue.summary.scope",
    "Independent queue facet snapshots; no shared observation time or date bounds are reported."
  ],
  [
    "feedback.queue.triageProgress",
    "Triage progress"
  ],
  [
    "feedback.queue.noStatusData",
    "No feedback to triage yet."
  ],
  [
    "feedback.queue.categoryMix",
    "Category mix"
  ],
  [
    "feedback.queue.noCategoryData",
    "No categories to show yet."
  ],
  [
    "feedback.queue.tableTitle",
    "Queue"
  ],
  [
    "feedback.queue.rowLabel",
    "{{category}}: {{title}}"
  ],
  [
    "feedback.queue.untitled",
    "Untitled feedback"
  ],
  [
    "coverage.subtitle",
    "Package-derived snapshot of routed Tesla proto fields and configured desired subscription membership. Sourced from routing.yaml and teslaconfig.Builder — not confirmation of observed vehicle ingestion."
  ],
  [
    "coverage.routing",
    "Destination routing"
  ],
  [
    "coverage.destinations.title",
    "Destination breakdown"
  ],
  [
    "coverage.destinations.help",
    "Counts how many routed fields land in each storage destination. Fields routed with also_signal_log:true are counted under both their primary destination and signal_log, matching the runtime fan-out — totals may exceed the unique routed-fields count."
  ],
  [
    "coverage.destinations.empty",
    "No destinations reported."
  ],
  [
    "coverage.destinations.routedFields",
    "Routed fields"
  ],
  [
    "coverage.legend.title",
    "Reading this page"
  ],
  [
    "coverage.legend.intro",
    "Each row is one Tesla telemetry field declared in routing.yaml. The dashes below mean \"not applicable\" for that field — they are expected, not missing data."
  ],
  [
    "coverage.legend.columnLabel",
    "Column"
  ],
  [
    "coverage.legend.columnHelp",
    "— the typed destination column. A dash means the field is stored in signal_log, a generic key/value table where the field name itself is the key — there is no per-field column."
  ],
  [
    "coverage.legend.dualWriteLabel",
    "Dual write"
  ],
  [
    "coverage.legend.dualWriteHelp",
    "— marks fields written to both their primary table AND signal_log (for replay and historical reconstruction). A dash means single-write only, which is the normal case."
  ],
  [
    "coverage.legend.subscribedLabel",
    "Configured subscription"
  ],
  [
    "coverage.legend.subscribedHelp",
    "— whether the field belongs to the configured desired subscription. \"Yes\" does not confirm observed vehicle ingestion. \"No\" means the field is routed but omitted from the desired subscription request."
  ],
  [
    "coverage.orphans.title",
    "Orphan fields detected"
  ],
  [
    "coverage.orphans.help",
    "These routing.yaml entries reference Field names not present in protomodel.SignalsByName and not a strict prefix-extension of a compound parent. This is a deployment drift between the vendored Tesla proto and routing.yaml — investigate before relying on the affected destinations."
  ],
  [
    "coverage.filter.placeholder",
    "Filter by field name, destination, or column…"
  ],
  [
    "coverage.filter.results",
    "Showing {{shown}} of {{total}} categories"
  ],
  [
    "coverage.loading",
    "Loading routing snapshot…"
  ],
  [
    "coverage.empty",
    "No categories returned. The embedded routing.yaml may be empty or the loader failed silently."
  ],
  [
    "coverage.filterEmpty",
    "No categories match the current filter."
  ],
  [
    "admin.gdprExport.storageLabel",
    "Storage"
  ],
  [
    "admin.gdprExport.refresh",
    "Refresh artifact status"
  ],
  [
    "admin.gdprExport.subtitle",
    "Look up the status of a GDPR data export by artifact id and download the bundle when it completes. Bundles expire after the configured retention window."
  ],
  [
    "admin.gdprExport.resourceName",
    "Export artifact"
  ],
  [
    "admin.gdprExport.notConfigured",
    "GDPR export subsystem is not configured on this deployment."
  ],
  [
    "admin.gdprExport.emptyTitle",
    "No artifact selected"
  ],
  [
    "admin.gdprExport.emptyMessage",
    "Enter an artifact ID above to look up its status. The page will keep refreshing until the export completes."
  ],
  [
    "admin.gdprExport.notFoundTitle",
    "Artifact not found"
  ],
  [
    "admin.gdprExport.notFoundMessage",
    "No artifact with that id exists, or it has been purged. Check the id and try again."
  ],
  [
    "admin.gdprExport.kpis",
    "Artifact summary"
  ],
  [
    "admin.gdprExport.summary.source",
    "Status, format, size, storage and lifecycle timestamps describe only the selected export artifact."
  ],
  [
    "admin.gdprExport.summary.scope",
    "Selected artifact snapshot; creation and expiry are lifecycle events, not a shared analysis range."
  ],
  [
    "admin.xray.actions.refresh",
    "Refresh ingest x-ray"
  ],
  [
    "admin.xray.hero",
    "Sample volume"
  ],
  [
    "redis.searchLabel",
    "Filter signals by name"
  ],
  [
    "redis.cacheDiagnostics",
    "Cache diagnostics"
  ],
  [
    "redis.diagSelect",
    "Select a vehicle to inspect its cache state"
  ],
  [
    "redis.diagUnavailable",
    "Cache diagnostics are unavailable for this vehicle"
  ],
  [
    "redis.categories",
    "Signal categories"
  ],
  [
    "redis.catSelect",
    "Select a vehicle to see its signal category mix"
  ],
  [
    "redis.catEmpty",
    "No categorized signals to summarize"
  ],
  [
    "redis.cacheActions",
    "Cache actions"
  ],
  [
    "redis.cacheActionsHint",
    "Purge deletes the Redis L2 HSET only. The in-process L1 cache on each pod is untouched and refills from new telemetry."
  ],
  [
    "admin.schemaDrift.subtitle",
    "Current database schema fingerprint compared against the recorded seed. Drift indicates a migration ran without a seed refresh, or raw DDL bypassed the migration system."
  ],
  [
    "admin.schemaDrift.notConfigured",
    "The schema-drift subsystem is not configured on this deployment. Enable schema fingerprinting in config to populate this page."
  ],
  [
    "admin.secretRotation.subtitle",
    "Status of every tracked credential. Severity reflects per-kind warn/critical thresholds; rotate anything in the critical tier as soon as possible."
  ],
  [
    "admin.secretRotation.notConfigured",
    "The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page."
  ],
  [
    "admin.secretRotation.criticalTitle",
    "Overdue rotations"
  ],
  [
    "admin.secretRotation.criticalMessage",
    "{{count}} secrets are past their critical rotation threshold. These should be rotated immediately to reduce blast radius."
  ],
  [
    "admin.security.brief.historyScope",
    "Returned security events for vehicle {{vehicle}}, {{start}} to {{end}} (exclusive); statistics describe event samples, not a complete time-weighted history."
  ],
  [
    "admin.slowQueries.subtitle",
    "Top queries from pg_stat_statements. Sort by mean time to surface the slowest individual calls, or total time to surface the costliest in aggregate."
  ],
  [
    "admin.slowQueries.notConfigured",
    "pg_stat_statements is not installed on this PostgreSQL instance. Run `CREATE EXTENSION pg_stat_statements;` and add it to shared_preload_libraries to enable this page."
  ],
  [
    "impersonation.users.kpi.modeForwardAuth",
    "Forward-auth"
  ],
  [
    "impersonation.users.kpiLabel",
    "Impersonation summary"
  ],
  [
    "impersonation.users.mainLabel",
    "Subjects and session status"
  ],
  [
    "admin.vehicleCost.subtitle",
    "Per-vehicle telemetry cost over the selected window. Use this to spot vehicles whose ingest volume is disproportionate to the fleet baseline."
  ],
  [
    "admin.vehicleCost.notConfigured",
    "The ingest-x-ray subsystem is not configured on this deployment. Vehicle cost reporting requires the signal_log hypertable to be populated."
  ],
  [
    "admin.vehicleCost.breakdownRegion",
    "Ingest cost breakdown"
  ],
  [
    "firmwareImpact.noData",
    "No update yet has enough drives on both sides of it to support a comparison. This fills in as you drive after each install."
  ],
  [
    "firmwareImpact.col.delta",
    "Δ Wh/km"
  ],
  [
    "firmwareImpact.col.share",
    "Δ %"
  ],
  [
    "firmwareImpact.col.p",
    "p-value"
  ],
  [
    "firmwareImpact.detail",
    "Version by version"
  ],
  [
    "help.firmwareImpact.iconLabel",
    "More info about the verdicts"
  ],
  [
    "firmwareImpact.noDetail",
    "Nothing to compare yet — each update needs drives recorded both before and after it."
  ],
  [
    "firmwareImpact.whPerKmN",
    "{{v}} Wh/km · n={{n}}"
  ],
  [
    "firmwareImpact.stats",
    "p · d"
  ],
  [
    "analytics.weeklyDigest.funFactDesc",
    "≈ {{times}}× {{from}} → {{to}}"
  ],
  [
    "analytics.weeklyDigest.brief.description",
    "Available drive and charging records for the selected week, compared with the previous week."
  ],
  [
    "analytics.weeklyDigest.brief.retained",
    "Retained or partial weekly records"
  ],
  [
    "analytics.weeklyDigest.brief.unavailable",
    "Weekly sources unavailable"
  ],
  [
    "analytics.weeklyDigest.brief.loading",
    "Loading weekly records"
  ],
  [
    "analytics.weeklyDigest.brief.available",
    "Returned weekly records"
  ],
  [
    "analytics.weeklyDigest.fsdNoBaseline",
    "No comparable week"
  ],
  [
    "analytics.weeklyDigest.fsdDistanceChange",
    "FSD vs previous week"
  ],
  [
    "analytics.weeklyDigest.fsdShareChange",
    "Share vs previous week"
  ],
  [
    "analytics.weeklyDigest.fsdHonesty",
    "These are cumulative counter changes, not exact FSD engagement. Absence is not zero."
  ],
  [
    "analytics.weeklyDigest.fsdSection",
    "Supervised driving"
  ],
  [
    "analytics.weeklyDigest.brief.fsdTitle",
    "Supervised-driving evidence"
  ],
  [
    "analytics.weeklyDigest.brief.fsdMissing",
    "Supervised distance not measured"
  ],
  [
    "analytics.weeklyDigest.fsdNotMeasured",
    "No supervised-driving distance was measured this week."
  ],
  [
    "analytics.weeklyDigest.fsdNotice",
    "Reported FSD {{distance}}{{share}}{{change}}."
  ],
  [
    "analytics.weeklyDigest.fsdNoticeShare",
    " ({{value}}% of observed driving)"
  ],
  [
    "analytics.weeklyDigest.fsdNoticeChange",
    ", {{delta}} pts vs last week"
  ],
  [
    "statistics.brief.batteryTitle",
    "Battery estimate evidence"
  ],
  [
    "statistics.brief.batteryDescription",
    "Capacity, annual degradation rate, cycle count and source-reported age retain their distinct units."
  ],
  [
    "statistics.brief.retained",
    "Retained statistics"
  ],
  [
    "statistics.brief.available",
    "Returned statistics"
  ],
  [
    "statistics.brief.unavailable",
    "Statistics unavailable"
  ],
  [
    "statistics.brief.batteryScope",
    "Battery-health source estimates; observation bounds unknown"
  ],
  [
    "statistics.brief.lifetime",
    "Lifetime mileage"
  ],
  [
    "statistics.brief.daily",
    "Last 30 days divided by 30"
  ],
  [
    "statistics.brief.projection",
    "Last-30-day daily average multiplied by 365; projection, not a measured year"
  ],
  [
    "statistics.brief.mileageDescription",
    "Lifetime distance and drive counts alongside a last-30-day average and its yearly projection."
  ],
  [
    "statistics.brief.mixed",
    "Mixed lifetime and last-30-day windows"
  ],
  [
    "statistics.brief.costDenominator",
    "Recorded cost divided by source kilometres; not display-distance units."
  ],
  [
    "statistics.brief.periodDescription",
    "Totals and averages from the period-statistics response; its observation bounds are not returned."
  ],
  [
    "statistics.brief.periodScope",
    "Period-statistics source window; bounds unknown"
  ],
  [
    "tco.brief.description",
    "Recorded charging costs and modeled gasoline costs have distinct source filters and modeled drive-span denominators."
  ],
  [
    "tco.brief.loading",
    "Loading operating evidence"
  ],
  [
    "tco.brief.paused",
    "Evidence refresh paused"
  ],
  [
    "tco.brief.unavailable",
    "Operating evidence unavailable"
  ],
  [
    "tco.brief.retained",
    "Retained operating evidence"
  ],
  [
    "tco.brief.available",
    "Returned operating evidence"
  ],
  [
    "tco.brief.scope",
    "Lifetime source envelope; modeled first-to-last positive-drive span"
  ],
  [
    "tco.brief.savingsDescription",
    "Fuel comparison and the maintenance heuristic remain separate from their algebraic combination; none asserts verified net ownership savings."
  ],
  [
    "yearReview.brief.environmentDescription",
    "Reported calendar-year carbon offset with the existing tree-equivalent estimate."
  ],
  [
    "yearReview.brief.retained",
    "Retained year evidence"
  ],
  [
    "yearReview.brief.available",
    "Recorded year evidence"
  ],
  [
    "yearReview.brief.patternsDescription",
    "Calendar-year driving averages; integer distance and efficiency retain the original specialist rounding."
  ],
  [
    "yearReview.brief.savingsDescription",
    "Recorded electric cost and reported savings versus gasoline for the selected calendar year."
  ],
  [
    "tco.ledger.delete",
    "Delete entry"
  ],
  [
    "tco.ledger.title",
    "Fixed-cost ledger"
  ],
  [
    "tco.ledger.allIn",
    "All-in: {{total}} ({{perKm}}/km)"
  ],
  [
    "tco.ledger.empty",
    "No fixed costs recorded. Add insurance, payments, or service below."
  ],
  [
    "tco.ledger.add",
    "Record cost"
  ],
  [
    "tco.ledger.addError",
    "Failed to record cost"
  ],
  [
    "tco.ledger.hint",
    "{{count}} entries · {{total}} fixed · {{km}} km lifetime"
  ],
  [
    "tco.ledger.deleteTitle",
    "Delete this entry?"
  ],
  [
    "tco.ledger.deleteMessage",
    "This removes the recorded cost from the ledger."
  ],
  [
    "analytics.weeklyDigest.dailyEnergyChartLabel",
    "Bar chart of daily charging energy in {{unit}}"
  ],
  [
    "analytics.weeklyDigest.dailyDistanceChartLabel",
    "Bar chart of daily driving distance in {{unit}}"
  ],
  [
    "compare.brief.neutral",
    "Direction is not scored"
  ],
  [
    "compare.brief.favorable",
    "Favorable change"
  ],
  [
    "compare.brief.unfavorable",
    "Unfavorable change"
  ],
  [
    "compare.brief.title",
    "Period comparison evidence"
  ],
  [
    "compare.brief.description",
    "Period A measurements with Period B baselines and semantic changes. The two source windows are independent."
  ],
  [
    "compare.brief.retained",
    "Retained comparison sources"
  ],
  [
    "compare.brief.paused",
    "Comparison refresh paused"
  ],
  [
    "compare.brief.loading",
    "Loading comparison"
  ],
  [
    "compare.brief.available",
    "Both periods available"
  ],
  [
    "compare.brief.incomplete",
    "Comparison incomplete"
  ],
  [
    "compare.brief.windows",
    "Period A: {{periodA}} · Period B: {{periodB}}"
  ],
  [
    "compare.brief.coverage",
    "Period totals; continuous observation coverage is not reported."
  ],
  [
    "regimes.title",
    "Regime shifts"
  ],
  [
    "regimes.regimeCount",
    "Regimes detected"
  ],
  [
    "regimes.overWeeks",
    "over {{count}} weeks"
  ],
  [
    "regimes.currentRegime",
    "Current regime"
  ],
  [
    "regimes.since",
    "since {{date}}"
  ],
  [
    "regimes.lastShift",
    "Last shift"
  ],
  [
    "regimes.noShifts",
    "none detected"
  ],
  [
    "regimes.tempLink",
    "Temp link"
  ],
  [
    "regimes.tempLinkHint",
    "avg temp change at last shift"
  ],
  [
    "regimes.brief.status.partial",
    "Partial drive history"
  ],
  [
    "regimes.brief.status.initialFailure",
    "Drive history failed"
  ],
  [
    "regimes.subtitle",
    "Statistical changepoints in your weekly consumption"
  ],
  [
    "regimes.kpis",
    "Regime summary metrics"
  ],
  [
    "regimes.brief.eyebrow",
    "Consumption evidence"
  ],
  [
    "regimes.chartHint",
    "The stepped line is each regime’s mean; vertical lines mark detected shifts"
  ],
  [
    "regimes.noData",
    "Not enough weekly history yet — six or more driving weeks are needed."
  ],
  [
    "regimes.col.regime",
    "Regime mean"
  ],
  [
    "regimes.regimeMean",
    "Regime mean"
  ],
  [
    "regimes.shiftLog",
    "Shift log"
  ],
  [
    "help.regimeShifts.iconLabel",
    "More info about changepoint detection"
  ],
  [
    "regimes.stable",
    "No statistically significant shifts — your consumption regime has been stable."
  ],
  [
    "regimes.shiftLine",
    "Week of {{date}}: consumption moved {{delta}} {{unit}}"
  ],
  [
    "regimes.tempBadge",
    "avg temp {{delta}}°C"
  ],
  [
    "timeline.brief.retained",
    "Retained state summary"
  ],
  [
    "timeline.brief.pausedRetained",
    "State summary refresh paused"
  ],
  [
    "timeline.brief.available",
    "Returned state summary"
  ],
  [
    "timeline.brief.paused",
    "State summary paused"
  ],
  [
    "timeline.brief.loading",
    "Loading state summary"
  ],
  [
    "timeline.brief.unavailable",
    "State summary unavailable"
  ],
  [
    "dataSources.labels.fsdInsights",
    "Supervised driving"
  ],
  [
    "yearReview.brief.loading",
    "Loading year evidence"
  ],
  [
    "yearReview.brief.unavailable",
    "Year evidence unavailable"
  ],
  [
    "yearReview.brief.description",
    "Calendar-year totals and records from the year-review response. Observation coverage is not reported."
  ],
  [
    "yearReview.brief.highlights",
    "Calendar-year highlights"
  ],
  [
    "yearReview.brief.extremes",
    "Year extremes"
  ],
  [
    "automations.builder.commandParamsObjectError",
    "Params must be a JSON object."
  ],
  [
    "automations.routines.onEnter",
    "On geofence enter"
  ],
  [
    "automations.routines.onExit",
    "On geofence exit"
  ],
  [
    "automations.routines.installNamed",
    "Install {{name}}"
  ],
  [
    "automations.routines.resource",
    "Geofence routines"
  ],
  [
    "automations.routines.title",
    "Geofence routines"
  ],
  [
    "automations.routines.choosePlace",
    "Choose a place…"
  ],
  [
    "automations.routines.noPlaces",
    "Create a geofence place first to install routines."
  ],
  [
    "automationList.unnamed",
    "Untitled automation"
  ],
  [
    "automationList.col.lastTriggered",
    "Last triggered"
  ],
  [
    "automationList.loading",
    "Loading automations…"
  ],
  [
    "automationList.empty.body",
    "Create your first automation in the builder to manage it here."
  ],
  [
    "automationList.status.empty",
    "No automations to summarize yet"
  ],
  [
    "automationList.autoDisabled.body",
    "{{count}} automation(s) were auto-disabled after repeated failures. Re-enable them from the builder once resolved."
  ],
  [
    "automations.presets.installNamed",
    "Install {{name}}"
  ],
  [
    "automations.presets.resource",
    "Automation presets"
  ],
  [
    "energy.products.capabilities",
    "Capabilities"
  ],
  [
    "energy.products.resourceType.powerwall",
    "Powerwall"
  ],
  [
    "energy.siteInfo.mode.selfConsumption",
    "Self-Powered"
  ],
  [
    "energy.siteInfo.mode.autonomous",
    "Time-Based Control"
  ],
  [
    "energy.siteInfo.mode.backup",
    "Backup Only"
  ],
  [
    "energy.siteInfo.empty",
    "No site configuration loaded yet. Use refresh to fetch from Tesla."
  ],
  [
    "battery.links.title",
    "Explore More"
  ],
  [
    "packCapacity.fitDiagnostics.chartAria",
    "Filtered pack-capacity estimates and descriptive linear fit"
  ],
  [
    "powerFlow.solarAdvice",
    "Solar charging advice"
  ],
  [
    "powerFlow.chargeNow",
    "Charge now on solar"
  ],
  [
    "powerFlow.chargeSoon",
    "Charge soon"
  ],
  [
    "powerFlow.chargeWait",
    "Hold for cheap rates"
  ],
  [
    "powerFlow.surplus",
    "{{kw}} kW surplus · ~{{amps}}A solar-matched"
  ],
  [
    "energy.tou.description",
    "Configure your utility rate plan so the Powerwall can optimize charging and discharging based on electricity pricing."
  ],
  [
    "energy.tou.customHint",
    "Paste the full tou_settings payload or just the inner object. See Tesla Fleet API docs for the schema."
  ],
  [
    "battery.cells.table.cell",
    "Cell #"
  ],
  [
    "battery.cells.table.voltage",
    "Voltage (V)"
  ],
  [
    "battery.cells.table.delta",
    "Delta (mV)"
  ],
  [
    "battery.cells.subtitle",
    "Individual cell voltage monitoring and analysis"
  ],
  [
    "battery.cells.heatmap.empty",
    "No cell readings available."
  ],
  [
    "battery.cells.heatmap.title",
    "Cell voltage heatmap"
  ],
  [
    "battery.cells.view.bar",
    "Switch to bar view"
  ],
  [
    "battery.cells.view.grid",
    "Switch to grid view"
  ],
  [
    "battery.cells.view.barLabel",
    "Bar view"
  ],
  [
    "battery.cells.view.gridLabel",
    "Grid view"
  ],
  [
    "battery.cells.heatmap.subtitle",
    "Cells colored by deviation from average"
  ],
  [
    "battery.cells.barView.aria",
    "Voltage reading for each battery cell"
  ],
  [
    "battery.cells.distribution.title",
    "Voltage distribution"
  ],
  [
    "battery.cells.distribution.empty",
    "No distribution data available."
  ],
  [
    "battery.cells.distribution.aria",
    "Distribution of battery cells by voltage range"
  ],
  [
    "battery.cells.distribution.count",
    "Cell count"
  ],
  [
    "battery.cells.bar.title",
    "Cell voltage bar chart"
  ],
  [
    "battery.cells.bar.empty",
    "No cell voltages available."
  ],
  [
    "battery.cells.bar.aria",
    "Battery cell voltage readings with pack minimum, average, and maximum references"
  ],
  [
    "battery.cells.overTime.title",
    "Cell voltage over time"
  ],
  [
    "battery.cells.overTime.empty",
    "Not enough history yet."
  ],
  [
    "battery.cells.overTime.aria",
    "Minimum, average, and maximum battery cell voltage over time"
  ],
  [
    "battery.cells.overTime.min",
    "Min voltage"
  ],
  [
    "battery.cells.overTime.max",
    "Max voltage"
  ],
  [
    "battery.cells.imbalance.title",
    "Imbalance trend"
  ],
  [
    "battery.cells.imbalance.empty",
    "Not enough history yet."
  ],
  [
    "battery.cells.imbalance.aria",
    "Battery cell voltage imbalance over time with nominal and warning thresholds"
  ],
  [
    "battery.cells.imbalance.series",
    "Imbalance (mV)"
  ],
  [
    "battery.cells.details.title",
    "Cell details"
  ],
  [
    "battery.cells.details.count",
    "{{count}} cells"
  ],
  [
    "battery.cells.details.empty",
    "No cell details available."
  ],
  [
    "battery.degradation.subtitle",
    "Health trends, degradation predictions, and charging habit impact"
  ],
  [
    "battery.degradation.summary",
    "Battery health summary"
  ],
  [
    "battery.degradation.noStress",
    "Charging impact will appear once charging history is available."
  ],
  [
    "battery.degradation.rangeLossAria",
    "First retained comparison baseline and estimated driving range over time"
  ],
  [
    "battery.degradation.healthFactors",
    "Battery health factors"
  ],
  [
    "battery.degradation.history",
    "Degradation history"
  ],
  [
    "energy.products.empty",
    "No energy products found. Use \"Refresh from Tesla\" to discover your Powerwalls and Solar installations."
  ],
  [
    "benchmarks.cohort.loading",
    "Loading cohort eligibility…"
  ],
  [
    "help.chargeDepartureAlignment.iconLabel",
    "More info about how pairs are formed"
  ],
  [
    "ocpp.noChargePoints",
    "No OCPP chargers reporting yet. Point a charger at the OCPP server to see it here."
  ],
  [
    "charging.curve.chargerTypeDesc",
    "Average kW and kWh per charger category"
  ],
  [
    "charging.curve.loading",
    "Loading charging curve analysis"
  ],
  [
    "charging.curve.sessionComparisonDesc",
    "Power curves overlaid from last 10 sessions"
  ],
  [
    "charging.curve.powerVsSocDesc",
    "Charging power curve for selected session"
  ],
  [
    "charging.curve.speedTrendDesc",
    "Monthly average DC vs AC charge rate"
  ],
  [
    "charging.curve.summaryLoading",
    "Loading summary metrics"
  ],
  [
    "charging.curve.yearlyTrendDesc",
    "Average time-to-charge and session count by year"
  ],
  [
    "charging.curve.selectSessionHint",
    "Select a session above to view its charging curve"
  ],
  [
    "charging.charts.batteryLevelEmpty",
    "No charge-start levels to chart yet."
  ],
  [
    "charging.section.batteryDist",
    "Battery start-level distribution"
  ],
  [
    "charging.section.batteryDistDesc",
    "See where you typically start charging."
  ],
  [
    "charging.section.optimizer",
    "Cost optimizer & heatmap"
  ],
  [
    "charging.section.optimizerDesc",
    "Smart scheduling recommendations require pattern recognition."
  ],
  [
    "charging.charts.energyCostTrendAria",
    "Charging energy and cost trend"
  ],
  [
    "charging.grid.batteryScale",
    "Battery level on a 0–100% scale"
  ],
  [
    "charging.grid.startBattery",
    "Start battery"
  ],
  [
    "metrics.peakPower",
    "{{value}} kW peak"
  ],
  [
    "metrics.avgPower",
    "~{{value}} kW avg"
  ],
  [
    "scoreAria",
    "Battery-friendly score: {{value}}"
  ],
  [
    "costAnalysis.chargerType.chartAria",
    "Pie chart of charging cost by charger type."
  ],
  [
    "costAnalysis.forecast.chartAria",
    "Historical and projected monthly charging cost with confidence band"
  ],
  [
    "costAnalysis.forecast.trendAria",
    "Monthly average cost per kilowatt-hour trend"
  ],
  [
    "powershare.hoursTrend.ariaLabel",
    "Estimated remaining runtime trend"
  ],
  [
    "powershare.powerTrend.ariaLabel",
    "Output power trend chart"
  ],
  [
    "share.sessionTitle",
    "Share Charging Session"
  ],
  [
    "share.sessionDescription",
    "Generate a public link to share this charging session. Anyone with the link can view the summary and charge curve — no login required."
  ],
  [
    "share.sessionTitlePlaceholder",
    "Optional title (e.g., \"Baker Supercharger Stop\")"
  ],
  [
    "share.titleLabel",
    "Share title"
  ],
  [
    "share.includeCurve",
    "Include charge curve and cost"
  ],
  [
    "share.linkLabel",
    "Share link URL"
  ],
  [
    "share.openLink",
    "Open link in a new tab"
  ],
  [
    "share.loadingLinks",
    "Loading active share links…"
  ],
  [
    "share.loadError",
    "Could not load your existing share links. Please try again."
  ],
  [
    "share.none",
    "No active share links yet."
  ],
  [
    "tesla_charging.priceRadar",
    "Price Radar"
  ],
  [
    "tesla_charging.noPriceData",
    "No priced Supercharger visits yet."
  ],
  [
    "tesla_charging.siteVisits",
    "{{count}} visits · last {{date}}"
  ],
  [
    "tesla_charging.unpriced",
    "+{{count}} visits without invoice pricing"
  ],
  [
    "tesla_charging.spread",
    "Cheapest stop saves {{save}}/kWh vs priciest"
  ],
  [
    "help.chargeInterruption.iconLabel",
    "More info about the site list"
  ],
  [
    "help.chargerResilience.iconLabel",
    "More info about the what-if scenario"
  ],
  [
    "charging.curve.sessionInspector",
    "Session inspector"
  ],
  [
    "costAnalysis.trends",
    "Cost trends"
  ],
  [
    "costAnalysis.impact",
    "Lifetime and environmental impact"
  ],
  [
    "dashSettings.vehicleFilterDesc",
    "Show data for a specific vehicle in all widgets. Widget-level filters take precedence."
  ],
  [
    "dashboard.fleetPosture.summary.eyebrow",
    "Fleet evidence"
  ],
  [
    "dashboard.fleetPosture.summary.title",
    "Fleet operating posture"
  ],
  [
    "dashboard.fleetPosture.summary.scope",
    "All registered vehicles; active vehicle shown below"
  ],
  [
    "dashboard.fleetPosture.summary.provenance",
    "Verified coverage comes from the same resolved fleet-state batch. Client classification takes over when evidence ages; the oldest reading is a real backend observation, never fetch completion."
  ],
  [
    "kiosk.rotation10s",
    "10s"
  ],
  [
    "kiosk.rotation15s",
    "15s"
  ],
  [
    "kiosk.rotation30s",
    "30s"
  ],
  [
    "kiosk.rotation1min",
    "1 min"
  ],
  [
    "kiosk.rotation2min",
    "2 min"
  ],
  [
    "kiosk.rotation5min",
    "5 min"
  ],
  [
    "kiosk.timeout3s",
    "3s"
  ],
  [
    "kiosk.timeout5s",
    "5s"
  ],
  [
    "kiosk.timeout10s",
    "10s"
  ],
  [
    "kiosk.timeout15s",
    "15s"
  ],
  [
    "kiosk.dim5min",
    "5 min"
  ],
  [
    "kiosk.dim10min",
    "10 min"
  ],
  [
    "kiosk.dim15min",
    "15 min"
  ],
  [
    "kiosk.dim30min",
    "30 min"
  ],
  [
    "kiosk.dim60min",
    "60 min"
  ],
  [
    "kiosk.clockTopLeft",
    "Top left"
  ],
  [
    "kiosk.clockTopRight",
    "Top right"
  ],
  [
    "kiosk.clockBottomLeft",
    "Bottom left"
  ],
  [
    "kiosk.clockBottomRight",
    "Bottom right"
  ],
  [
    "kiosk.hint",
    "Kiosk mode enters fullscreen and hides all navigation. Move the mouse or touch the screen to reveal the exit button. Press Esc to exit."
  ],
  [
    "layout.editEnterLabel",
    "Edit dashboard"
  ],
  [
    "preview.aria",
    "Layout preview, {{count}} widgets"
  ],
  [
    "preview.empty",
    "No widgets"
  ],
  [
    "dashboard.summary.status.stale",
    "Retained readings"
  ],
  [
    "dashboard.summary.status.partial",
    "Partial evidence"
  ],
  [
    "widgets.pickerDescription",
    "Choose the operational signals and workflows that belong on this dashboard."
  ],
  [
    "widgets.searchLabel",
    "Search widgets"
  ],
  [
    "dashboard.moreActions",
    "More dashboard actions"
  ],
  [
    "dashboard.dashboardTools",
    "Dashboard tools"
  ],
  [
    "dashboard.dashboardToolsHelp",
    "Manage, present, or share this layout."
  ],
  [
    "auth.toResume",
    "to resume live updates."
  ],
  [
    "dashboard.widgetsRegion",
    "Dashboard widgets"
  ],
  [
    "onboarding.trackingHelp",
    "See current vehicle state and data freshness."
  ],
  [
    "onboarding.drivesHelp",
    "Review routes, efficiency, and driving patterns."
  ],
  [
    "onboarding.chargingHelp",
    "Understand charging cost and battery health."
  ],
  [
    "onboarding.controlHelp",
    "Manage alerts, automations, and vehicle actions."
  ],
  [
    "onboarding.stepAccountHelp",
    "Authorize TeslaSync through the account settings."
  ],
  [
    "onboarding.stepVehicles",
    "Sync vehicle inventory"
  ],
  [
    "onboarding.stepVehiclesHelp",
    "Import the vehicles available to your account."
  ],
  [
    "onboarding.stepWorkspace",
    "Activate your workspace"
  ],
  [
    "onboarding.stepWorkspaceHelp",
    "Live dashboards populate as telemetry arrives."
  ],
  [
    "onboarding.accountConnected",
    "Account connected"
  ],
  [
    "onboarding.setupRequired",
    "Workspace setup"
  ],
  [
    "onboarding.explore",
    "Explore capabilities"
  ],
  [
    "onboarding.privateTitle",
    "Private by design"
  ],
  [
    "onboarding.privateHelp",
    "Your fleet data stays in the infrastructure you control."
  ],
  [
    "dashboard.loading",
    "Loading command center"
  ],
  [
    "glance.summary.batteryHelp",
    "Reported battery state of charge, on the 0–100 percent scale."
  ],
  [
    "glance.summary.rangeHelp",
    "Reported rated range in metres, converted only for display."
  ],
  [
    "glance.summary.interiorHelp",
    "Reported cabin temperature in degrees Celsius."
  ],
  [
    "glance.summary.exteriorHelp",
    "Reported exterior temperature in degrees Celsius."
  ],
  [
    "glance.summary.odometerHelp",
    "Reported odometer in metres; lifetime reading, not distance in a selected window."
  ],
  [
    "glance.summary.speedHelp",
    "Reported speed in metres per second. Missing speed is not a measured stop."
  ],
  [
    "glance.summary.eyebrow",
    "Vehicle telemetry"
  ],
  [
    "glance.summary.title",
    "Vehicle operating summary"
  ],
  [
    "glance.summary.description",
    "Latest returned measurements for the selected vehicle. Poll completion is not a verified observation time for each signal; location has an independent source."
  ],
  [
    "quickStats.summary.distanceHelp",
    "Fleet distance over the last 30 days; source kilometres normalized to metres."
  ],
  [
    "quickStats.summary.drivesHelp",
    "Fleet drive count in the 30-day rollup."
  ],
  [
    "quickStats.summary.sessionsHelp",
    "Fleet charging-session count in the 30-day rollup."
  ],
  [
    "quickStats.summary.energyHelp",
    "Fleet energy over the last 30 days; source kilowatt-hours normalized to watt-hours."
  ],
  [
    "quickStats.summary.costHelp",
    "Recorded fleet cost in the source denomination; no currency conversion."
  ],
  [
    "quickStats.summary.efficiencyHelp",
    "Fleet average consumption over the last 30 days; source Wh/km normalized to Wh/m."
  ],
  [
    "quickStats.summary.carbonHelp",
    "Source-reported fleet CO₂ savings in kilograms for the 30-day rollup."
  ],
  [
    "quickStats.summary.vehiclesHelp",
    "Fleet vehicle count reported by analytics, not the selected spotlight vehicle."
  ],
  [
    "quickStats.summary.eyebrow",
    "Fleet rollup"
  ],
  [
    "quickStats.summary.title",
    "Fleet operating summary"
  ],
  [
    "quickStats.summary.description",
    "Fleet-wide analytics for the last 30 days. The selected vehicle only scopes the spotlight; exact rollup bounds and source coverage are not supplied."
  ],
  [
    "quickStats.summary.scope",
    "All fleet vehicles · last 30 days"
  ],
  [
    "widget.analyticsSummary.summary.distanceHelp",
    "Fleet distance from the analytics source; kilometres normalized to metres."
  ],
  [
    "widget.analyticsSummary.summary.efficiencyHelp",
    "Source consumption in Wh/km normalized to Wh/m; the original distance conversion factor is retained."
  ],
  [
    "widget.analyticsSummary.summary.energyHelp",
    "Source energy normalized from kWh to Wh; the existing kWh display is retained."
  ],
  [
    "widget.analyticsSummary.summary.costHelp",
    "Recorded cost divided by positive measured distance, retained as source currency per metre; missing operands or zero distance cannot define a rate."
  ],
  [
    "widget.analyticsSummary.summary.title",
    "Analytics operating summary"
  ],
  [
    "widget.analyticsSummary.summary.description",
    "Fleet-wide analytics using the hook’s default source window. Exact bounds and completeness are not supplied; optional trend arrays retain their own source coverage."
  ],
  [
    "widget.analyticsSummary.summary.scope",
    "Fleet-wide · default analytics window"
  ],
  [
    "widget.analyticsSummary.trendAria",
    "{{metric}} trend"
  ],
  [
    "widget.apiUsage.callsDescription",
    "API calls reported by the 24-hour source counter."
  ],
  [
    "widget.apiUsage.responseDescription",
    "Reported average latency; source milliseconds are retained as canonical seconds."
  ],
  [
    "widget.apiUsage.errorRateDescription",
    "Reported error percentage; the existing high-error threshold is above 5%."
  ],
  [
    "widget.apiUsage.errorCountDescription",
    "Recorded API errors; a missing counter is not zero."
  ],
  [
    "widget.apiUsage.summaryTitle",
    "API source counters"
  ],
  [
    "dashboard.summary.eyebrow",
    "Source summary"
  ],
  [
    "widget.apiUsage.summaryDescription",
    "API activity and latency retain their reported windows; no service-wide confidence score is inferred."
  ],
  [
    "widget.apiUsage.summaryScope",
    "System API logs; calls cover 24 hours, other counters have no exact source bounds"
  ],
  [
    "widget.securityValetOn",
    "Valet mode on"
  ],
  [
    "widget.securityValetOff",
    "Valet mode off"
  ],
  [
    "widget.automation.activeDescription",
    "Enabled automations in the returned configuration list."
  ],
  [
    "widget.automation.failingDescription",
    "Enabled automations with consecutive failures; successful empty lists retain measured zero."
  ],
  [
    "widget.automation.disabledDescription",
    "Automations explicitly auto-disabled by the source, not all manually disabled automations."
  ],
  [
    "widget.automation.summaryTitle",
    "Automation configuration"
  ],
  [
    "widget.automation.summaryDescription",
    "Current automation configuration and reported failure flags; no execution-success confidence is inferred."
  ],
  [
    "widget.automation.summaryScope",
    "Returned automation list; action permissions and per-row recovery remain independent"
  ],
  [
    "widget.backupHistory.countDescription",
    "Count of returned backup events; an absent or malformed event array is not zero."
  ],
  [
    "widget.backupHistory.durationDescription",
    "Mean of valid non-negative event durations in seconds; missing duration operands leave the mean unknown."
  ],
  [
    "widget.backupHistory.summaryTitle",
    "Backup event sources"
  ],
  [
    "widget.backupHistory.summaryDescription",
    "Energy-site discovery and backup events retain independent recovery; the recent-event feed is a capped presentation of returned history."
  ],
  [
    "widget.chargeCost.energyDescription",
    "Known energy in returned sessions; missing session energy keeps coverage partial."
  ],
  [
    "widget.chargeCost.costDescription",
    "Recorded session cost or the configured electricity-rate estimate; missing required operands remain unknown."
  ],
  [
    "widget.chargeCost.rateDescription",
    "Configured electricity cost per estimated distance; canonical raw rate is currency per metre, not a measured trip rate."
  ],
  [
    "widget.chargeCost.savingsDescription",
    "Estimated gasoline cost minus charge cost; distance uses the existing 3.5 miles per kWh assumption."
  ],
  [
    "widget.chargeCost.summaryTitle",
    "Charge cost sources"
  ],
  [
    "widget.chargeCost.summaryDescription",
    "Recorded and inferred charging costs remain distinct from measured drive costs; configured gas and electricity assumptions are retained."
  ],
  [
    "widget.chargeCost.summaryScope",
    "Vehicle {{vehicleId}}; rolling 30-day start {{start}}, at most 100 returned sessions, no explicit end bound"
  ],
  [
    "widget.climateHistory.chartAria",
    "Cabin and outside temperature history"
  ],
  [
    "widget.costBreakdown.totalDescription",
    "Reported total charging cost, retaining the configured currency display."
  ],
  [
    "widget.costBreakdown.rateDescription",
    "Source currency per kilometre normalized to currency per metre; display conversion occurs exactly once."
  ],
  [
    "widget.costBreakdown.savingsDescription",
    "Reported gasoline comparison is an estimate, not independently measured savings."
  ],
  [
    "widget.costBreakdown.summaryTitle",
    "Charging cost sources"
  ],
  [
    "widget.costBreakdown.summaryDescription",
    "Lifetime totals, the existing source tariff and estimated gasoline comparison remain independent of ranked monthly rows."
  ],
  [
    "widget.costBreakdown.summaryScope",
    "Vehicle {{vehicleId}}; lifetime source totals and available monthly records, exact coverage bounds unknown"
  ],
  [
    "widget.dashboardStats.summary.vehiclesHelp",
    "Fleet vehicle total reported by the dashboard stats source."
  ],
  [
    "widget.dashboardStats.summary.tripsHelp",
    "Fleet trip total; not the selected vehicle’s recent transition count."
  ],
  [
    "widget.dashboardStats.summary.sessionsHelp",
    "Fleet charging-session total reported by dashboard stats."
  ],
  [
    "widget.dashboardStats.summary.fsmHelp",
    "Current state for the resolved vehicle only, independently loaded from fleet totals."
  ],
  [
    "widget.dashboardStats.summary.eyebrow",
    "Dashboard sources"
  ],
  [
    "widget.dashboardStats.summary.title",
    "Fleet counts and vehicle state"
  ],
  [
    "widget.dashboardStats.summary.description",
    "Fleet-wide totals and the resolved vehicle’s current FSM state are independent sources. Aggregate bounds are not supplied; the wide view’s latest five transitions come from a separate 168-hour history query."
  ],
  [
    "widget.dashboardStats.summary.scope",
    "Fleet counts · FSM vehicle {{id}}"
  ],
  [
    "widget.dashboardStats.summary.noScope",
    "Fleet counts · no resolved FSM vehicle"
  ],
  [
    "widget.driveTelemetry.chartAria",
    "Speed, power, battery, and elevation during the latest drive"
  ],
  [
    "widget.drivingDynamics.distributionAria",
    "Distribution of observed acceleration magnitudes"
  ],
  [
    "widget.energyStats.summary.usedHelp",
    "Reported driving energy in watt-hours for this vehicle’s source period."
  ],
  [
    "widget.energyStats.summary.chargedHelp",
    "Reported charging energy in watt-hours for the same source period."
  ],
  [
    "widget.energyStats.summary.efficiencyHelp",
    "Reported average consumption in Wh/m, converted to the existing Wh/distance display."
  ],
  [
    "widget.energyStats.summary.costHelp",
    "Source cost retains its original $ suffix; no currency conversion or inferred ISO denomination."
  ],
  [
    "widget.energyStats.summary.netHelp",
    "Charged minus used energy for the same source period; both operands must be measured."
  ],
  [
    "widget.energyStats.summary.title",
    "Energy operating summary"
  ],
  [
    "widget.energyStats.summary.description",
    "Vehicle energy totals and daily breakdown share the returned source period. Exact bounds and coverage are not supplied; CO₂ savings remain estimates."
  ],
  [
    "widget.fleetStatsBar.summary.vehiclesHelp",
    "Count from the returned vehicle registry, not the 30-day analytics rollup."
  ],
  [
    "widget.fleetStatsBar.summary.onlineHelp",
    "Registry entries whose state is online; not verified live-state coverage."
  ],
  [
    "widget.fleetStatsBar.summary.distanceHelp",
    "Fleet-wide trailing 30-day distance; source kilometres normalized to metres."
  ],
  [
    "widget.fleetStatsBar.summary.energyHelp",
    "Fleet-wide trailing 30-day energy; source kilowatt-hours normalized to watt-hours, retaining the source kWh display."
  ],
  [
    "widget.fleetStatsBar.summary.eyebrow",
    "Fleet sources"
  ],
  [
    "widget.fleetStatsBar.summary.description",
    "Current registry counts and trailing 30-day analytics have independent sources and windows. Exact analytics bounds and coverage are not supplied."
  ],
  [
    "widget.fleetStatsBar.summary.scope",
    "Fleet-wide · registry snapshot / 30-day analytics"
  ],
  [
    "widget.fleetStats.summary.registryHelp",
    "Returned registry count; online caption reflects registry state, not verified live telemetry."
  ],
  [
    "widget.fleetStats.summary.alertsHelp",
    "Unread alert count has no connected source in this widget; unknown is not zero."
  ],
  [
    "widget.fleetStats.summary.analyticsHelp",
    "Fleet-wide trailing 30-day analytics, normalized to canonical SI before display."
  ],
  [
    "widget.fleetStats.summary.eyebrow",
    "Independent fleet sources"
  ],
  [
    "widget.fleetStats.summary.title",
    "Fleet operating totals"
  ],
  [
    "widget.fleetStats.summary.description",
    "Registry counts and 30-day fleet analytics are independent from the first registered vehicle’s five recent drives and charging sessions. Those sparklines are not the fleet-wide analysis window; unread alerts have no source here."
  ],
  [
    "widget.fleetStats.summary.scope",
    "Fleet totals · first-vehicle recent series"
  ],
  [
    "widget.fsdWeekly.summary.distanceHelp",
    "Reported supervised-driving distance in metres for this Monday–Sunday window."
  ],
  [
    "widget.fsdWeekly.summary.shareHelp",
    "Source-reported FSD share, on the 0–100 percent scale."
  ],
  [
    "widget.fsdWeekly.summary.changeHelp",
    "Share change in percentage points versus the previous Monday–Sunday window, not a percent growth rate."
  ],
  [
    "widget.fsdWeekly.title",
    "FSD this week"
  ],
  [
    "widget.fsdWeekly.summary.eyebrow",
    "Supervised driving"
  ],
  [
    "widget.fsdWeekly.summary.title",
    "Weekly FSD summary"
  ],
  [
    "widget.fsdWeekly.honesty",
    "Unmeasured is not zero. Last week is the previous Monday–Sunday window."
  ],
  [
    "widget.fsmDistribution.chartAria",
    "Time spent in each vehicle state"
  ],
  [
    "widget.lifetimeStats.summary.distanceHelp",
    "Source lifetime distance in kilometres, normalized to metres before display."
  ],
  [
    "widget.lifetimeStats.summary.drivesHelp",
    "Reported lifetime drive count for this vehicle."
  ],
  [
    "widget.lifetimeStats.summary.energyHelp",
    "Reported lifetime energy, normalized from kWh to Wh; original kWh display retained."
  ],
  [
    "widget.lifetimeStats.summary.carbonHelp",
    "Source-reported lifetime CO₂ offset in kilograms."
  ],
  [
    "widget.lifetimeStats.summary.costHelp",
    "Recorded lifetime charging cost in its original denomination; no currency conversion."
  ],
  [
    "widget.lifetimeStats.summary.daysHelp",
    "Reported ownership-day count used as the daily-distance denominator."
  ],
  [
    "widget.lifetimeStats.summary.dailyHelp",
    "Lifetime distance divided by positive measured ownership days; not a rolling 24-hour distance."
  ],
  [
    "widget.lifetimeStats.summary.eyebrow",
    "Lifetime history"
  ],
  [
    "widget.lifetimeStats.summary.title",
    "Lifetime operating summary"
  ],
  [
    "widget.lifetimeStats.summary.description",
    "Lifetime totals for the resolved vehicle, not the workspace date range. Exact history coverage and first observation are not supplied."
  ],
  [
    "widget.trendSparkline",
    "trend"
  ],
  [
    "widget.locationMap.status",
    "Vehicle location status"
  ],
  [
    "widget.mileageStats.summary.dailyHelp",
    "Last 30-day distance divided by 30; not today’s measured distance."
  ],
  [
    "widget.mileageStats.summary.weeklyHelp",
    "Seven times the 30-day-derived daily average; not an independent seven-day query."
  ],
  [
    "widget.mileageStats.summary.monthlyHelp",
    "Thirty times the derived daily average, preserving the rolling 30-day distance."
  ],
  [
    "widget.mileageStats.summary.milestoneHelp",
    "Next 10,000-display-unit lifetime milestone. Estimated months retain the existing 30-day average and rounding rule."
  ],
  [
    "widget.mileageStats.summary.eyebrow",
    "Mileage history"
  ],
  [
    "widget.mileageStats.summary.title",
    "Mileage operating summary"
  ],
  [
    "widget.mileageStats.summary.description",
    "Rolling 30-day distance supplies the daily, weekly and monthly averages; lifetime distance supplies the milestone. Exact source bounds and completeness are not supplied."
  ],
  [
    "widget.motorHistory.chartAria",
    "Motor torque, stator temperature, and acceleration history"
  ],
  [
    "widget.mqtt.rateDescription",
    "Sum of returned per-vehicle signal rates; one missing operand makes the total unknown."
  ],
  [
    "widget.mqtt.countDescription",
    "Sum of returned signal counters; counter reset periods are not supplied by the source."
  ],
  [
    "widget.mqtt.summaryTitle",
    "MQTT source counters"
  ],
  [
    "widget.mqtt.summaryDescription",
    "Fleet counters retain complete-operand checks; connection presence and newest valid observation remain separate evidence."
  ],
  [
    "widget.mqtt.summaryScope",
    "Returned streaming-fleet rows; no complete calendar-day or verified-live coverage is inferred"
  ],
  [
    "widget.notificationStats.minutesAgo",
    "{{minutes}}m ago"
  ],
  [
    "widget.notificationStats.hoursAgo",
    "{{hours}}h ago"
  ],
  [
    "widget.notificationStats.sentDescription",
    "Recorded total sent for the reported seven-day window."
  ],
  [
    "widget.notificationStats.deliveryDescription",
    "Sent divided by a positive reported total; a zero denominator leaves delivery rate unknown."
  ],
  [
    "widget.notificationStats.failedDescription",
    "Reported failures remain independent of the recent notification log rows."
  ],
  [
    "widget.notificationStats.channelsDescription",
    "Enabled notification channels, not a delivery-success guarantee."
  ],
  [
    "widget.notificationStats.summaryTitle",
    "Notification counters"
  ],
  [
    "widget.notificationStats.summaryDescription",
    "Notification counters preserve the existing delivery formula and attention thresholds; recent logs recover independently."
  ],
  [
    "widget.notificationStats.summaryScope",
    "System notifications; reported seven-day counters and separate latest log rows"
  ],
  [
    "nav.drivesDesc",
    "Trip history"
  ],
  [
    "nav.chargingDesc",
    "Sessions & costs"
  ],
  [
    "nav.batteryDesc",
    "Health & degradation"
  ],
  [
    "widget.regenEfficiency.recoveredDescription",
    "Reported regenerative energy in watt-hours; average absolute drive power is not regenerative power."
  ],
  [
    "widget.regenEfficiency.driveDescription",
    "Reported drive energy in watt-hours, independent of the displayed recovery percentage."
  ],
  [
    "widget.regenEfficiency.chargesDescription",
    "Source-reported equivalent free-charge count; missing values remain unknown."
  ],
  [
    "widget.regenEfficiency.summaryTitle",
    "Regenerative energy sources"
  ],
  [
    "widget.regenEfficiency.summaryDescription",
    "Recovered and used energy retain the source quantities; the existing recovery gauge is a percentage and is never scaled twice."
  ],
  [
    "widget.regenEfficiency.summaryScope",
    "Vehicle {{vehicleId}}; returned analytics window, exact source bounds unknown"
  ],
  [
    "widget.sentryLog.lockedChip",
    "🔒 Locked"
  ],
  [
    "widget.sentryLog.unlockedChip",
    "🔓 Unlocked"
  ],
  [
    "widget.sentryLog.sentryOnChip",
    "🛡️ Sentry on"
  ],
  [
    "widget.sentryLog.doorOpen",
    "Door open: {{doors}}"
  ],
  [
    "widget.sentryLog.sentryActivated",
    "Sentry mode activated"
  ],
  [
    "widget.sentryLog.sentryDeactivated",
    "Sentry mode deactivated"
  ],
  [
    "widget.sentryLog.securityUpdated",
    "Security state updated"
  ],
  [
    "widget.noDetails",
    "No details available"
  ],
  [
    "widget.eventFeed.minutesAgo",
    "{{minutes}}m ago"
  ],
  [
    "widget.eventFeed.hoursAgo",
    "{{hours}}h ago"
  ],
  [
    "widget.eventFeed.label",
    "Event feed"
  ],
  [
    "widget.statGrid.noStats",
    "No stats available"
  ],
  [
    "widget.signalCatalog.searchLabel",
    "Search signals"
  ],
  [
    "widget.signalCatalog.sampleCount",
    "Observations in fetched sample"
  ],
  [
    "widget.signalHealth.summaryTitle",
    "Signal source coverage"
  ],
  [
    "widget.signalHealth.catalogDescription",
    "Returned signal catalog size; an absent catalog is unknown."
  ],
  [
    "widget.signalHealth.activeDescription",
    "Observed entries with a parseable timestamp within this widget’s five-minute threshold."
  ],
  [
    "widget.signalHealth.gapsDescription",
    "Older observations and missing or unparseable timestamps remain signal gaps."
  ],
  [
    "widget.signalHealth.freshnessDescription",
    "Age in seconds of the newest valid observation; absent observations remain unknown."
  ],
  [
    "widget.signalHealth.summaryDescription",
    "Catalog, statistics and observations recover independently. The five-minute widget threshold does not certify distributed live-state freshness."
  ],
  [
    "widget.signalHealth.summaryScope",
    "Vehicle {{vehicleId}}; current catalog and returned observations only"
  ],
  [
    "widget.signalHealth.noGaps",
    "No observed signal gaps"
  ],
  [
    "widget.sleepEfficiency.drainDescription",
    "Sentry-off drain rate normalized to percentage points per second; daily display preserves the existing 24-hour estimate."
  ],
  [
    "widget.sleepEfficiency.sleepDescription",
    "Returned asleep and offline state durations in canonical seconds; absent state distribution remains unknown."
  ],
  [
    "widget.sleepEfficiency.eventsDescription",
    "Number of returned recent events, not a certified full-window wake count."
  ],
  [
    "widget.sleepEfficiency.summaryTitle",
    "Sleep source quantities"
  ],
  [
    "widget.sleepEfficiency.summaryDescription",
    "The efficiency gauge retains its measured percentage; supporting durations, drain estimate and recent-event sample keep their source limitations."
  ],
  [
    "widget.sleepEfficiency.summaryScope",
    "Vehicle {{vehicleId}}; returned historical distribution and recent sample, exact bounds unknown"
  ],
  [
    "widget.superchargerHistory.energyDescription",
    "Reported summary energy in watt-hours, not the sum of the top-ten presentation rows."
  ],
  [
    "widget.superchargerHistory.spendDescription",
    "Reported Supercharger summary spend; missing values remain unknown, not free charging."
  ],
  [
    "widget.superchargerHistory.summaryTitle",
    "Supercharger source totals"
  ],
  [
    "widget.superchargerHistory.summaryDescription",
    "Reported 30-day totals remain independent of the ten most-recent sessions ranked by energy; incomplete session energy does not imply a complete sample."
  ],
  [
    "widget.superchargerHistory.summaryScope",
    "Tesla charging history; source summary window, exact instants and timezone are not supplied"
  ],
  [
    "widget.telemetryErrors.vinDescription",
    "VINs explicitly marked active; incomplete activity flags leave the count unknown."
  ],
  [
    "widget.telemetryErrors.sample",
    "Errors in fetched sample"
  ],
  [
    "widget.telemetryErrors.sampleDescription",
    "Returned error rows, not the total error count for a complete time range."
  ],
  [
    "widget.telemetryErrors.summaryTitle",
    "Error source counters"
  ],
  [
    "widget.telemetryErrors.summaryDescription",
    "Active VINs and the fetched error sample remain separate sources; observed and fetched timestamps keep their original distinction."
  ],
  [
    "widget.telemetryErrors.summaryScope",
    "Fleet telemetry; returned VIN summary and error sample, exact coverage bounds unknown"
  ],
  [
    "widget.tirePressureHistory.chartAria",
    "Front and rear tire pressure history"
  ],
  [
    "widget.uptime.consecutiveFailures",
    "consecutive failures"
  ],
  [
    "widget.uptime.servicesHealthy",
    "Services healthy"
  ],
  [
    "widget.weeklyDigest.summary.metricHelp",
    "Current-week source quantity; the comparison uses its matching previous-week operand. Missing values are not zero."
  ],
  [
    "widget.weeklyDigest.summary.eyebrow",
    "Weekly comparison"
  ],
  [
    "widget.weeklyDigest.summary.title",
    "Weekly operating digest"
  ],
  [
    "widget.weeklyDigest.summary.description",
    "This week versus the source’s previous week for the resolved vehicle. Exact week boundaries, timezone and completeness are not supplied by this digest response; comparisons retain their original operands and direction rules."
  ],
  [
    "widget.weeklyDigest.summary.scope",
    "Vehicle {{id}} · current / previous week"
  ],
  [
    "widget.weeklySummary.summary.metricHelp",
    "Current-week source quantity. Existing week-over-week comparisons keep their zero-baseline, sub-1% and lower-is-better behavior."
  ],
  [
    "widget.weeklySummary.summary.eyebrow",
    "Weekly vehicle sources"
  ],
  [
    "widget.weeklySummary.summary.title",
    "Weekly operating summary"
  ],
  [
    "widget.weeklySummary.summary.description",
    "Current-week totals for the resolved vehicle with the existing previous-week comparisons. Exact bounds, timezone and completeness are not supplied; missing operands and zero baselines do not imply no change."
  ],
  [
    "widget.weeklySummary.summary.scope",
    "Vehicle {{id}} · current / previous week"
  ],
  [
    "widget.yearReview.summary.distanceHelp",
    "Reported year distance, normalized from kilometres to metres."
  ],
  [
    "widget.yearReview.summary.drivesHelp",
    "Reported drive count for this calendar year."
  ],
  [
    "widget.yearReview.summary.energyHelp",
    "Reported year energy, normalized from kWh to Wh; original kWh display retained."
  ],
  [
    "widget.yearReview.summary.carbonHelp",
    "Source-reported CO₂ offset for this calendar year, in kilograms."
  ],
  [
    "widget.yearReview.summary.monthHelp",
    "Month with the most source-reported drives, using the existing selection rule and localized month name."
  ],
  [
    "widget.yearReview.summary.longestHelp",
    "Source longest drive in this year, normalized from kilometres to metres."
  ],
  [
    "widget.yearReview.summary.durationHelp",
    "Source driving minutes normalized to seconds; the original hour display is retained."
  ],
  [
    "widget.yearReview.summary.speedHelp",
    "Source peak speed normalized from km/h to m/s; not average speed."
  ],
  [
    "widget.yearReview.summary.eyebrow",
    "Calendar-year history"
  ],
  [
    "widget.yearReview.summary.title",
    "Year operating summary"
  ],
  [
    "widget.yearReview.summary.description",
    "Calendar-year totals for the resolved vehicle. The current year may be incomplete; exact source coverage and observation bounds are not supplied."
  ],
  [
    "arrivalReliability.profileAria",
    "Arrival reliability profile combining sample counts, normalised duration index, and schedule allowance share"
  ],
  [
    "departureForecast.next24Aria",
    "Departure likelihood and cumulative probability forecast for the next 24 hours"
  ],
  [
    "destinationTransitions.profileAria",
    "Destination transition profile showing sample count and concentration"
  ],
  [
    "originConcentration.aria",
    "Origin concentration and leading share by departure location"
  ],
  [
    "driveDetail.backToDrives",
    "Back to drives"
  ],
  [
    "driveDetail.fsd.title",
    "Supervised driving"
  ],
  [
    "driveDetail.timeline.label",
    "Drive timeline"
  ],
  [
    "driveDetail.timeline.startedAt",
    "Started at "
  ],
  [
    "driveDetail.timeline.durationPrefix",
    "Duration "
  ],
  [
    "driveDetail.timeline.statusPrefix",
    "Status "
  ],
  [
    "driveDetail.timeline.endedAt",
    "Ended at "
  ],
  [
    "driveDetail.routeMapLabel",
    "Route map"
  ],
  [
    "driveDetail.lastKnown",
    "Last known location"
  ],
  [
    "driveDetail.stationaryRouteTitle",
    "Route can't be plotted"
  ],
  [
    "driveDetail.stationaryRouteBody",
    "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. The drive's distance, duration, and other stats below are unaffected."
  ],
  [
    "driveDetail.fsd.mapEvidence",
    "Approximate area where the FSD counter increased - not an exact FSD-active segment."
  ],
  [
    "driveDetail.fsd.loadFailed",
    "Supervised-driving evidence could not be loaded"
  ],
  [
    "driveDetail.fsd.loadFailedBody",
    "The rest of this drive remains available. Retry supervised-driving evidence independently."
  ],
  [
    "driveDetail.fsd.section",
    "Supervised driving"
  ],
  [
    "driveDetail.fsd.subtitle",
    "Reported supervised-driving distance from synchronized cumulative counters."
  ],
  [
    "driveDetail.fsd.afterFirmware",
    "After firmware {{version}}"
  ],
  [
    "driveDetail.fsd.distance",
    "Reported distance"
  ],
  [
    "driveDetail.fsd.share",
    "Share of drive"
  ],
  [
    "driveDetail.fsd.evidenceWindow",
    "Evidence window"
  ],
  [
    "driveDetail.fsd.noPositiveEvidence",
    "No positive counter increase"
  ],
  [
    "driveDetail.fsd.resetTitle",
    "Counter reset affected this drive"
  ],
  [
    "driveDetail.fsd.resetBody",
    "Distance around the reset cannot be assigned exactly, so this value is not high confidence."
  ],
  [
    "driveDetail.fsd.evidenceLimitedTitle",
    "Route evidence limited"
  ],
  [
    "driveDetail.fsd.evidenceLimitedBody",
    "This drive produced more counter evidence than can be shown safely. The dashed map overlay displays only the first 512 coalesced intervals."
  ],
  [
    "driveDetail.fsd.unknownBody",
    "There are not enough paired observations to distinguish zero FSD use from missing data."
  ],
  [
    "driveDetail.fsd.method",
    "Evidence times bound where the counter increased; they do not identify exact FSD-active road segments."
  ],
  [
    "driveDetail.fsd.afterFirmwareHonesty",
    "This drive ran firmware {{version}}. The spotlight compares FSD share before vs after — correlation, not proof the update caused a change."
  ],
  [
    "driveDetail.whyEnded.loading",
    "Loading drive diagnostic…"
  ],
  [
    "drives.fsdResetAffected",
    "A counter reset lowered confidence for this drive."
  ],
  [
    "drives.fsdReportedHelp",
    "Reported supervised-driving distance derived from cumulative counters."
  ],
  [
    "drives.collections.aria",
    "Filter drives by collection"
  ],
  [
    "drives.fsdFilter.aria",
    "Filter drives by FSD evidence"
  ],
  [
    "drives.sortByAria",
    "Sort by {{field}}"
  ],
  [
    "drives.list",
    "Drive list"
  ],
  [
    "drives.longest",
    "Longest"
  ],
  [
    "drives.avgTrip",
    "Avg trip"
  ],
  [
    "drives.filterLabel.fsd",
    "FSD evidence"
  ],
  [
    "drives.fsdRangeUnsupported.title",
    "FSD evidence is unavailable for this range"
  ],
  [
    "drives.fsdRangeUnsupported.message",
    "FSD attribution supports up to 366 days at a time. Drive history remains available, but FSD filters and sorting are disabled."
  ],
  [
    "drives.fsdUnavailable.title",
    "FSD evidence could not be loaded"
  ],
  [
    "drives.fsdUnavailable.message",
    "Drive history remains available, but FSD badges, filters, and sorting are disabled until this data loads successfully."
  ],
  [
    "drives.fsdEvidence",
    "FSD evidence"
  ],
  [
    "drives.stickyBar.aria",
    "Drive history summary"
  ],
  [
    "drives.coll.commutes",
    "Commutes"
  ],
  [
    "drives.fsdFilter.all",
    "All FSD data"
  ],
  [
    "drivetrain.alert.criticalMsg",
    "One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended."
  ],
  [
    "drivetrain.alert.warningMsg",
    "Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load."
  ],
  [
    "drivetrain.tips.criticalStop",
    "Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down."
  ],
  [
    "drivetrain.tips.serviceUrgent",
    "Schedule an urgent service appointment. Critical temperatures may indicate a coolant system issue."
  ],
  [
    "drivetrain.tips.reduceLoad",
    "Reduce driving intensity and avoid hard acceleration to allow components to cool."
  ],
  [
    "drivetrain.tips.checkCoolant",
    "Schedule a service appointment to inspect the coolant system and fluid levels."
  ],
  [
    "drivetrain.tips.avoidSupercharging",
    "Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead."
  ],
  [
    "drivetrain.tips.regularService",
    "Keep up with regular service intervals for optimal drivetrain health and longevity."
  ],
  [
    "drivetrain.tips.gentleAccel",
    "Gentle acceleration helps maintain lower motor temperatures and extends component life."
  ],
  [
    "drivetrain.tips.precondition",
    "Precondition the battery in cold weather for better thermal performance and driving efficiency."
  ],
  [
    "drivetrain.tips.monitorTemps",
    "Monitor drivetrain temperatures after spirited driving sessions or long highway stretches."
  ],
  [
    "drivetrain.priority.urgent",
    "Urgent recommendation:"
  ],
  [
    "drivetrain.priority.important",
    "Important recommendation:"
  ],
  [
    "drivetrain.frontMotor",
    "Front Motor"
  ],
  [
    "drivetrain.rearMotor",
    "Rear Motor"
  ],
  [
    "dynamics.motorLoading",
    "Loading motor telemetry…"
  ],
  [
    "dynamics.forward",
    "Forward"
  ],
  [
    "dynamics.motorResource",
    "Motor telemetry"
  ],
  [
    "explorer.brief.pending",
    "Located-arrival evidence is not available yet."
  ],
  [
    "explorer.brief.farthestContext",
    "Distance from the inferred observed base."
  ],
  [
    "explorer.brief.description",
    "Located arrivals describe observed roaming, not complete travel history or a verified home."
  ],
  [
    "explorer.brief.capped",
    "Latest {{count}} returned drives; history cap reached"
  ],
  [
    "explorer.brief.window",
    "Returned drive history; complete-history coverage is unknown"
  ],
  [
    "explorer.brief.source",
    "Drive-history arrival clusters; visit-weighted P90 distance from the inferred base."
  ],
  [
    "fsd.observatory.unknownFirmware",
    "Unknown firmware"
  ],
  [
    "fsd.observatory.unlabelledRoute",
    "Unlabelled route"
  ],
  [
    "fsd.observatory.resetHint",
    "Break in the stitch — not travelled FSD{{field}}."
  ],
  [
    "fsd.observatory.approximate",
    "Approximate counter increase"
  ],
  [
    "arrivalReliability.brief.description",
    "Descriptive timing consistency for repeated directional routes; within-allowance shares are in-sample observations, not calibrated reliability promises."
  ],
  [
    "driving.brief.unresolvedCoverage",
    "Drive-history coverage is unresolved"
  ],
  [
    "arrivalReliability.brief.source",
    "Returned drive history; repeated-route support, descriptive indices and sample-weighted p90 buffers."
  ],
  [
    "coldStart.brief.energy",
    "Estimated extra energy from the observed cold-versus-warm consumption difference."
  ],
  [
    "coldStart.brief.description",
    "Cold and warm starts compared within the returned selected window; this is observed cohort evidence, not a causal test."
  ],
  [
    "coldStart.brief.source",
    "Returned drive energy and preceding parking gaps; up to 1,000 drives in the selected window."
  ],
  [
    "driveCompare.brief.scope",
    "Selected Drive A and Drive B; only fair, comparable measurements decide the verdict"
  ],
  [
    "departure.brief.description",
    "Next-24-hour modeled likelihood uses capped observed departure history; the support index is not a calibrated probability or confidence score."
  ],
  [
    "departure.brief.window",
    "Next 24 hours · {{timezone}}; history coverage is limited to returned rows"
  ],
  [
    "departure.brief.source",
    "Returned drive starts; Poisson-derived likelihood and illustrative planning marker, with no vehicle command."
  ],
  [
    "destinationTransitions.brief.description",
    "Accepted adjacent transitions retain chronology and continuity gates; historical successors describe past observations, not the next destination."
  ],
  [
    "destinationTransitions.brief.source",
    "Returned end-location states and accepted adjacent pairs; latest unusable rows are never replaced with older destinations."
  ],
  [
    "driveDna.brief.description",
    "Aggregate drive totals and sampled telemetry are independent sources; regen emissions are sample share, not time share."
  ],
  [
    "driveDna.brief.window",
    "Drive {{id}} · {{start}}–{{end}}; sampled coverage may be incomplete"
  ],
  [
    "driveDna.brief.noDrive",
    "No selected drive"
  ],
  [
    "driveDna.brief.source",
    "Selected drive metadata and returned telemetry emissions after the existing forward fold."
  ],
  [
    "driving.brief.partial",
    "Partial evidence"
  ],
  [
    "driveDna.brief.telemetryLoading",
    "Telemetry loading"
  ],
  [
    "driving.brief.responseReceivedAt",
    "Response received {{timestamp}}"
  ],
  [
    "driving.brief.pending",
    "Drive evidence is not available yet."
  ],
  [
    "rhythm.brief.description",
    "Departure timing in the selected local-time window; timestamp exclusions and evidence floors remain explicit."
  ],
  [
    "rhythm.brief.source",
    "Returned calendar drive history; local departure timestamps."
  ],
  [
    "efficiency.brief.economy",
    "Reciprocal economy, derived from the same measured consumption; not energy intensity."
  ],
  [
    "efficiency.brief.co2",
    "Source aggregate CO₂ savings estimate, in kilograms."
  ],
  [
    "efficiency.brief.title",
    "Lifetime efficiency evidence"
  ],
  [
    "efficiency.brief.description",
    "Vehicle driving aggregates retain their lifetime source period; they are independent of the range-filtered drive charts."
  ],
  [
    "effTarget.brief.description",
    "Completed-week outcomes from the observed history window; current partial weeks do not extend the completed-week streak."
  ],
  [
    "effTarget.brief.window",
    "Latest returned drive history, up to 1,000 rows; not lifetime coverage"
  ],
  [
    "effTarget.brief.source",
    "Returned drive energy and distance; saved target and completed local weeks."
  ],
  [
    "fsd.brief.description",
    "Reported self-driving counter deltas, not estimated engagement time; a share requires aligned observed-driving spans."
  ],
  [
    "fsd.brief.source",
    "Reported supervised self-driving and observed-driving counters, grouped by the requested local calendar window."
  ],
  [
    "journeyFragmentation.brief.source",
    "Returned drive-history continuity at the selected parking-gap threshold, using local days and weeks."
  ],
  [
    "dynamics.brief.source",
    "Returned motor-history samples inside the existing selected-drive query bounds."
  ],
  [
    "rangeBuffer.percentileAria",
    "Range buffer percentile distribution across driving profile categories"
  ],
  [
    "driveScore.achievements.firstDriveDesc",
    "Complete your first scored drive."
  ],
  [
    "driveScore.achievements.tenDrivesDesc",
    "Complete 10 scored drives."
  ],
  [
    "driveScore.achievements.fiftyDrivesDesc",
    "Complete 50 scored drives."
  ],
  [
    "driveScore.achievements.perfectScoreDesc",
    "Achieve a 100/100 on any drive."
  ],
  [
    "driveScore.achievements.aPlusStreakDesc",
    "Get A+ grade on 5 consecutive drives."
  ],
  [
    "driveScore.achievements.efficiencyMasterDesc",
    "Score 38+ in efficiency on 3 drives."
  ],
  [
    "driveScore.achievements.smoothOperatorDesc",
    "Score 28+ in smoothness on 3 drives."
  ],
  [
    "driveScore.achievements.speedSaintDesc",
    "Score 28+ in speed discipline on 5 drives."
  ],
  [
    "driveScore.noAchievements",
    "Achievements unlock as you complete scored drives"
  ],
  [
    "driveScore.noTrend",
    "No scored drives to chart yet"
  ],
  [
    "driveScore.noDistribution",
    "No scored drives to chart yet"
  ],
  [
    "driveScore.noTips",
    "Tips appear once drives are scored"
  ],
  [
    "driveScore.bestWorst",
    "Best and worst drives"
  ],
  [
    "driveScore.efficiencyLabel",
    "Efficiency (Wh/km)"
  ],
  [
    "driveScore.smoothnessLabel",
    "Smoothness (power range)"
  ],
  [
    "driveScore.colBreakdown",
    "Eff / Smo / Spd"
  ],
  [
    "driveScore.periodAverages",
    "Period averages"
  ],
  [
    "driveScore.avgDuration",
    "Avg Duration/Drive"
  ],
  [
    "driveScore.tips.preCondition",
    "Pre-condition your cabin while plugged in to reduce HVAC battery drain."
  ],
  [
    "driveScore.tips.coastMore",
    "Coast more by lifting your foot earlier before stops."
  ],
  [
    "driveScore.tips.tirePressure",
    "Keep tire pressure at recommended levels for better efficiency."
  ],
  [
    "driveScore.tips.smoothAccel",
    "Accelerate gradually — aim for steady pedal pressure."
  ],
  [
    "driveScore.tips.regenBraking",
    "Use regenerative braking instead of the brake pedal when possible."
  ],
  [
    "driveScore.tips.followDistance",
    "Maintain a larger following distance to avoid sudden braking."
  ],
  [
    "driveScore.tips.speedLimit",
    "Stay within the speed limit — aerodynamic drag rises exponentially above 90 km/h."
  ],
  [
    "driveScore.tips.cruiseControl",
    "Use Autopilot or cruise control on highways for consistent speed."
  ],
  [
    "driveScore.tips.routePlanning",
    "Plan routes to avoid high-speed stretches when possible."
  ],
  [
    "tripPlanner.copilot.comfortable",
    "You will make it"
  ],
  [
    "tripPlanner.copilot.tight",
    "Tight — drive gently"
  ],
  [
    "tripPlanner.copilot.chargeNow",
    "Charge first"
  ],
  [
    "tripPlanner.copilot.title",
    "Trip Copilot"
  ],
  [
    "tripPlanner.copilot.remainingKm",
    "Remaining (km)"
  ],
  [
    "tripPlanner.copilot.check",
    "Will I make it?"
  ],
  [
    "tripPlanner.copilot.error",
    "Confidence check failed"
  ],
  [
    "tripPlanner.copilot.empty",
    "Enter remaining distance for a live arrival verdict."
  ],
  [
    "tripPlanner.copilot.detail",
    "Arrival ~{{soc}}% · {{margin}} kWh margin"
  ],
  [
    "tripPlanner.legs.chargeStop",
    "Charging stop"
  ],
  [
    "driveScore.empty",
    "Not enough drives in the selected period to calculate a score."
  ],
  [
    "anomalies.title",
    "Anomaly Detective"
  ],
  [
    "anomalies.analyzed",
    "Drives Analyzed"
  ],
  [
    "anomalies.brief.analyzed",
    "Returned drives with usable speed and energy data in this window."
  ],
  [
    "anomalies.outlierCount",
    "Outliers"
  ],
  [
    "anomalies.beyond2",
    "beyond ±2σ of your baseline"
  ],
  [
    "anomalies.sigma",
    "Your Spread (σ)"
  ],
  [
    "anomalies.sigmaHint",
    "residual scatter around the fit"
  ],
  [
    "anomalies.bestSurprise",
    "Best Surprise"
  ],
  [
    "anomalies.bestSurpriseHint",
    "most efficient outlier"
  ],
  [
    "anomalies.subtitle",
    "Drives that break your own consumption law, explained"
  ],
  [
    "anomalies.kpis",
    "Anomaly summary metrics"
  ],
  [
    "anomalies.brief.description",
    "Speed-adjusted consumption outliers against your returned drive cohort; candidate explanations are not verified causes."
  ],
  [
    "anomalies.brief.source",
    "Returned drive history; quadratic fit and ±2σ residual band."
  ],
  [
    "anomalies.chartHint",
    "Quadratic fit of consumption vs speed with a ±2σ band; red points break the law"
  ],
  [
    "anomalies.noFit",
    "Not enough drives (8+ with speed and energy data) to fit your personal baseline yet."
  ],
  [
    "anomalies.col.z",
    "z-score"
  ],
  [
    "anomalies.upperBand",
    "+2σ"
  ],
  [
    "anomalies.lowerBand",
    "−2σ"
  ],
  [
    "anomalies.normal",
    "Within band"
  ],
  [
    "anomalies.outlier",
    "Outlier"
  ],
  [
    "anomalies.cases",
    "Case Files"
  ],
  [
    "help.driveAnomalies.iconLabel",
    "More info about anomaly scoring"
  ],
  [
    "anomalies.noOutliers",
    "No drives beyond ±2σ — everything fits your usual pattern."
  ],
  [
    "anomalies.expected",
    "expected {{v}}"
  ],
  [
    "driveDetail.notFound",
    "This drive could not be found. It may have been deleted, or the link is incorrect."
  ],
  [
    "landscape.title",
    "Efficiency Landscape"
  ],
  [
    "landscape.sweetCell",
    "Happiest Conditions"
  ],
  [
    "landscape.brief.best",
    "Lowest distance-weighted consumption among supported condition cells."
  ],
  [
    "landscape.painCell",
    "Harshest Conditions"
  ],
  [
    "landscape.brief.worst",
    "Highest distance-weighted consumption among supported condition cells."
  ],
  [
    "landscape.spread",
    "Condition Spread"
  ],
  [
    "landscape.spreadHint",
    "harshest vs happiest"
  ],
  [
    "landscape.analyzed",
    "Drives Mapped"
  ],
  [
    "landscape.brief.mapped",
    "Returned drives with speed, temperature, distance and energy evidence."
  ],
  [
    "landscape.subtitle",
    "Your car’s real consumption across speed and temperature"
  ],
  [
    "landscape.kpis",
    "Landscape summary metrics"
  ],
  [
    "landscape.brief.description",
    "Observed distance-weighted consumption across speed and temperature cells; thin evidence remains visible in the field."
  ],
  [
    "landscape.brief.source",
    "Returned drive history; distance-weighted speed × temperature cells."
  ],
  [
    "help.efficiencyLandscape.iconLabel",
    "More info about the field map"
  ],
  [
    "landscape.noData",
    "No drives with speed, temperature, and energy data in this period."
  ],
  [
    "energyAnatomy.title",
    "Energy Anatomy"
  ],
  [
    "energyAnatomy.total",
    "Energy Used"
  ],
  [
    "energyAnatomy.biggest",
    "Biggest Consumer"
  ],
  [
    "energyAnatomy.brief.apportionment",
    "Directional physical-model apportionment, not a directly measured component."
  ],
  [
    "energyAnatomy.climateCard",
    "Climate Overhead"
  ],
  [
    "energyAnatomy.brief.climate",
    "Modeled climate share of measured traction energy."
  ],
  [
    "energyAnatomy.regen",
    "Regen Credit"
  ],
  [
    "energyAnatomy.brief.regen",
    "Returned regeneration energy; recovery share uses the measured energy-used denominator."
  ],
  [
    "energyAnatomy.regenShare",
    "{{pct}}% recovered"
  ],
  [
    "energyAnatomy.subtitle",
    "Where a period of traction energy physically went"
  ],
  [
    "energyAnatomy.kpis",
    "Energy anatomy summary metrics"
  ],
  [
    "energyAnatomy.brief.description",
    "Measured total energy anchors a directional physical split; component estimates are not laboratory-grade measurements."
  ],
  [
    "energyAnatomy.brief.source",
    "Returned drive energy and regeneration; modeled aerodynamic, rolling and climate allocation."
  ],
  [
    "help.energyAnatomy.iconLabel",
    "More info about the anatomy model"
  ],
  [
    "energyAnatomy.noData",
    "No drives with energy data in this period."
  ],
  [
    "fleetOps.assignmentDialog.unsaved",
    "You have unsaved assignment changes. Discard them?"
  ],
  [
    "fleetOps.assignmentDialog.vehicleRequired",
    "Choose a vehicle."
  ],
  [
    "fleetOps.assignmentDialog.driverRequired",
    "Choose a driver."
  ],
  [
    "fleetOps.assignmentDialog.startRequired",
    "Enter a valid start time."
  ],
  [
    "fleetOps.assignmentDialog.endInvalid",
    "Enter a valid end time."
  ],
  [
    "fleetOps.assignmentDialog.endAfterStart",
    "End time must be after the start time."
  ],
  [
    "fleetOps.assignmentDialog.notesLimit",
    "Use 500 characters or fewer."
  ],
  [
    "fleetOps.policyDialog.unsaved",
    "You have unsaved charging-policy changes. Discard them?"
  ],
  [
    "fleetOps.policyDialog.vehicleRequired",
    "Choose a vehicle."
  ],
  [
    "fleetOps.policyDialog.nameRequired",
    "Enter a policy name."
  ],
  [
    "fleetOps.policyDialog.nameLimit",
    "Use 120 characters or fewer."
  ],
  [
    "fleetOps.policyDialog.targetInvalid",
    "Enter a whole-number target from 1% to 100%."
  ],
  [
    "fleetOps.policyDialog.powerInvalid",
    "Enter a positive whole number of watts."
  ],
  [
    "fleetOps.policyDialog.priorityInvalid",
    "Enter a whole-number priority from 0 to 1,000."
  ],
  [
    "fleetOps.policyDialog.startRequired",
    "Enter a valid effective start."
  ],
  [
    "fleetOps.policyDialog.endInvalid",
    "Enter a valid effective end."
  ],
  [
    "fleetOps.policyDialog.endAfterStart",
    "Effective end must be after its start."
  ],
  [
    "fleetOps.policyDialog.windowsInvalid",
    "Add valid, non-overlapping charging windows."
  ],
  [
    "fleetOps.costCenterDialog.unsaved",
    "You have unsaved cost-center changes. Discard them?"
  ],
  [
    "fleetOps.costCenterDialog.codeRequired",
    "Enter a cost-center code."
  ],
  [
    "fleetOps.costCenterDialog.codeLimit",
    "Use 32 characters or fewer."
  ],
  [
    "fleetOps.costCenterDialog.nameRequired",
    "Enter a cost-center name."
  ],
  [
    "fleetOps.costCenterDialog.nameLimit",
    "Use 120 characters or fewer."
  ],
  [
    "fleetOps.driverDialog.unsaved",
    "You have unsaved driver changes. Discard them?"
  ],
  [
    "fleetOps.driverDialog.nameRequired",
    "Enter a display name."
  ],
  [
    "fleetOps.driverDialog.nameLimit",
    "Use 120 characters or fewer."
  ],
  [
    "fleetOps.driverDialog.referenceRequired",
    "Enter a reference code."
  ],
  [
    "fleetOps.driverDialog.referenceLimit",
    "Use 64 characters or fewer."
  ],
  [
    "fleetOps.driverDialog.capRange",
    "Charge cap must be 20–100%."
  ],
  [
    "fleetOps.driverDialog.curfewPair",
    "Set both curfew start and end, or neither."
  ],
  [
    "fleetOps.driverDialog.curfewClock",
    "Curfew times must be HH:MM (24h)."
  ],
  [
    "fleetOps.drivers.guardrails",
    "Guardrails"
  ],
  [
    "fleetOps.driverDialog.chargeCap",
    "Charge cap (%)"
  ],
  [
    "fleetOps.driverDialog.chargeCapPlaceholder",
    "No cap"
  ],
  [
    "fleetOps.driverDialog.curfewStart",
    "Curfew start"
  ],
  [
    "fleetOps.driverDialog.curfewEnd",
    "Curfew end"
  ],
  [
    "fleetOps.reservationDialog.unsaved",
    "You have unsaved reservation changes. Discard them?"
  ],
  [
    "fleetOps.reservationDialog.nameRequired",
    "Enter a reservation name."
  ],
  [
    "fleetOps.reservationDialog.nameLimit",
    "Use 160 characters or fewer."
  ],
  [
    "fleetOps.reservationDialog.purposeLimit",
    "Use 500 characters or fewer."
  ],
  [
    "fleetOps.reservationDialog.vehicleRequired",
    "Choose a vehicle."
  ],
  [
    "fleetOps.reservationDialog.startRequired",
    "Enter a valid start time."
  ],
  [
    "fleetOps.reservationDialog.endRequired",
    "Enter a valid end time."
  ],
  [
    "fleetOps.reservationDialog.endAfterStart",
    "End time must be after the start time."
  ],
  [
    "fleetOps.reservationDialog.driverUnavailable",
    "Choose a driver assigned to this vehicle for the full reservation."
  ],
  [
    "fleetOps.reservations.add",
    "Add reservation"
  ],
  [
    "fleetOps.workOrderDialog.unsaved",
    "You have unsaved work-order changes. Discard them?"
  ],
  [
    "fleetOps.workOrderDialog.vehicleRequired",
    "Choose a vehicle."
  ],
  [
    "fleetOps.workOrderDialog.titleRequired",
    "Enter a work-order title."
  ],
  [
    "fleetOps.workOrderDialog.titleLimit",
    "Use 160 characters or fewer."
  ],
  [
    "fleetOps.workOrderDialog.descriptionLimit",
    "Use 2,000 characters or fewer."
  ],
  [
    "fleetOps.workOrderDialog.distanceInvalid",
    "Enter a non-negative distance."
  ],
  [
    "fleetOps.workOrderDialog.dueAtInvalid",
    "Enter a valid due date and time."
  ],
  [
    "fleetOps.workOrderDialog.startInvalid",
    "Enter a valid downtime start."
  ],
  [
    "fleetOps.workOrderDialog.endInvalid",
    "Enter a valid downtime end."
  ],
  [
    "fleetOps.workOrderDialog.endAfterStart",
    "Downtime end must be after its start."
  ],
  [
    "fleetOps.workOrderDialog.costInvalid",
    "Enter a non-negative whole number."
  ],
  [
    "fleetOps.workOrderDialog.currencyRequired",
    "Enter the cost currency."
  ],
  [
    "fleetOps.workOrderDialog.costRequired",
    "Enter the cost amount."
  ],
  [
    "fleetOps.workOrderDialog.currencyInvalid",
    "Use a three-letter ISO currency code."
  ],
  [
    "fleetOps.workOrderDialog.costMinorHint",
    "Enter the smallest currency unit; for USD, 12500 represents $125.00."
  ],
  [
    "geofences.bulk.deleteConfirm.body",
    "Selected places will be removed permanently. Places with charging or drive history must be archived instead."
  ],
  [
    "chargingPlaces.table.rates",
    "charging rates"
  ],
  [
    "chargingPlaces.detail.markReviewedAndEnable",
    "Mark reviewed & enable"
  ],
  [
    "notifications.alertStudio.editor.unsupportedKind",
    "This rule type cannot be edited by this version of the editor. No changes have been saved."
  ],
  [
    "notifications.alertStudio.channels.selectChannels",
    "Selected channels"
  ],
  [
    "notifications.alertStudio.kind.computedMetricHint",
    "Aggregate metric (cost, kWh, distance) over a time window."
  ],
  [
    "notifications.alertStudio.kind.signalHint",
    "Fires when a raw telemetry signal crosses a threshold."
  ],
  [
    "notifications.alertStudio.templates.useTemplate",
    "Use template {{name}}"
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitNoVehicle",
    "Enter the canonical SI value emitted by Fleet Telemetry. Select a vehicle in the status line to load exact unit metadata."
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitLoading",
    "Loading the canonical unit for this signal…"
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitDistance",
    "Canonical SI input: meters (m)."
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitTemperature",
    "Canonical input: degrees Celsius (°C)."
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitPressure",
    "Canonical SI input: pascals (Pa)."
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitCharge",
    "Canonical input: percent from 0 to 100."
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitSpeed",
    "Canonical SI input: meters per second (m/s)."
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitFallback",
    "Enter the canonical numeric value emitted by Fleet Telemetry; this signal has no registered unit dimension."
  ],
  [
    "notifications.alertStudio.editor.canonicalUnitUnavailable",
    "Unit metadata is unavailable for this signal. Enter the canonical numeric value emitted by Fleet Telemetry."
  ],
  [
    "notifications.alertStudio.editor.includeTitleHelp",
    "When unchecked, Discord/Slack/Telegram/ntfy/webhook deliver only the body. WebPush, email, and Pushover always include a title."
  ],
  [
    "notifications.alertStudio.editor.messageTemplateLabel",
    "Message template"
  ],
  [
    "notifications.alertStudio.editor.messageTemplateHint",
    "Type {{ to insert a placeholder"
  ],
  [
    "notifications.alertStudio.editor.messageTemplateHelp",
    "Per-rule body template. Reference live signals with double-brace placeholders like {{BatteryLevel}}. Leave blank to use the op-aware default body."
  ],
  [
    "notifications.alertStudio.editor.presetButton",
    "Pick a preset"
  ],
  [
    "notifications.alertStudio.editor.messageTemplatePlaceholder",
    "Battery at {{BatteryLevel}}% — leave blank for the smart default"
  ],
  [
    "notifications.alertStudio.editor.autocompleteLabel",
    "Placeholder suggestions"
  ],
  [
    "notifications.alertStudio.editor.autocompleteEmpty",
    "No matching placeholders"
  ],
  [
    "notifications.alertStudio.editor.previewEmpty",
    "Start typing to see a preview"
  ],
  [
    "notifications.alertStudio.editor.previewEmptyBody",
    "(no body — title carries the alert)"
  ],
  [
    "notifications.alertStudio.editor.presetModalTitle",
    "Message presets"
  ],
  [
    "notifications.alertStudio.editor.presetModalIntro",
    "Curated templates for common alert shapes. Click one to apply it; you can edit it afterwards."
  ],
  [
    "notifications.alertStudio.editor.presetEmpty",
    "No presets match this filter"
  ],
  [
    "settings.tab.empty",
    "Tab signal preferences are unavailable right now."
  ],
  [
    "notifications.channels.toggleAria",
    "Toggle {{name}}"
  ],
  [
    "notifications.channels.unsaved",
    "You have unsaved notification-channel changes. Discard them?"
  ],
  [
    "notifications.channels.providers.title",
    "Supported providers"
  ],
  [
    "notifications.channels.loadFailed",
    "Failed to load channels"
  ],
  [
    "notifications.channels.loading",
    "Loading channels…"
  ],
  [
    "notifications.channels.listAria",
    "Configured channels"
  ],
  [
    "notifications.alertStudio.computedMetric.previewIdle",
    "Pick a metric, window, operator, and threshold to preview."
  ],
  [
    "notifications.alertStudio.computedMetric.previewEmpty",
    "No preview available yet."
  ],
  [
    "notifications.alertStudio.computedMetric.previewValue",
    "Right now this metric is {{value}}{{suffix}} — would {{verdict}} fire."
  ],
  [
    "notifications.device.dataUsageHeading",
    "Data usage on this device"
  ],
  [
    "notifications.device.severity.info",
    "All (info and above)"
  ],
  [
    "notifications.device.severity.warn",
    "Warnings and critical"
  ],
  [
    "notifications.device.severity.critical",
    "Critical only"
  ],
  [
    "notifications.device.scope.selected",
    "Selected vehicles"
  ],
  [
    "notifications.device.test.suppressed",
    "Suppressed on this device by the \"{{reason}}\" rule."
  ],
  [
    "notifications.device.test.noPermission",
    "Notification permission has not been granted in this browser."
  ],
  [
    "notifications.device.test.noWorker",
    "No service worker is registered, so background delivery is unavailable."
  ],
  [
    "notifications.device.test.body",
    "Test notification — your device policy allows this severity."
  ],
  [
    "notifications.device.test.deliveredSilent",
    "Delivered silently — quiet hours are active."
  ],
  [
    "notifications.device.test.delivered",
    "Test notification delivered."
  ],
  [
    "notifications.device.test.failed",
    "The browser refused to show the notification."
  ],
  [
    "notifications.device.filtered",
    "Filters active"
  ],
  [
    "notifications.device.unfiltered",
    "Everything delivered"
  ],
  [
    "notifications.device.intro",
    "These rules apply only to this browser and are enforced by the service worker, so they also work when every tab is closed. Channel routing and install-wide quiet hours stay on the server."
  ],
  [
    "notifications.device.enabled",
    "Show notifications on this device"
  ],
  [
    "notifications.device.minSeverity",
    "Minimum severity"
  ],
  [
    "notifications.device.minSeverityHint",
    "Anything below this level is dropped before it reaches the OS."
  ],
  [
    "notifications.device.vehicleScopeSection",
    "Vehicle scope settings"
  ],
  [
    "notifications.device.vehicleScope",
    "Vehicle scope"
  ],
  [
    "notifications.device.vehicleScopeHint",
    "Fleet-wide notifications with no vehicle attached are always delivered."
  ],
  [
    "notifications.device.noVehicles",
    "No vehicles are available to scope to yet."
  ],
  [
    "notifications.device.quietHours",
    "Quiet hours on this device"
  ],
  [
    "notifications.device.quietEnabled",
    "Silence notifications overnight"
  ],
  [
    "notifications.device.quietEnd",
    "Until"
  ],
  [
    "notifications.device.quietHint",
    "Quiet hours silence the notification rather than dropping it, so nothing is lost. Critical alerts still ring."
  ],
  [
    "notifications.device.test.action",
    "Send test notification"
  ],
  [
    "notifications.device.reset",
    "Reset device rules"
  ],
  [
    "notifications.device.caveat",
    "A notification filtered here has still been delivered to the browser. Prefer server-side channel routing and quiet hours whenever they can express the same rule."
  ],
  [
    "notifications.inbox.evidence.title",
    "Notification evidence"
  ],
  [
    "notifications.inbox.loadedCount",
    "{{count}} loaded · total unavailable"
  ],
  [
    "notifications.inbox.filter.readState",
    "Filter by read state"
  ],
  [
    "notifications.inbox.filter.allReadStates",
    "All read states"
  ],
  [
    "notifications.inbox.detail.empty",
    "Select a notification to inspect its details."
  ],
  [
    "notifications.inbox.evidence.count",
    "Notification count"
  ],
  [
    "notifications.inbox.columns.readState",
    "Read state"
  ],
  [
    "notifications.inbox.delivery.deferred_dnd",
    "Deferred by DND"
  ],
  [
    "notifications.inbox.detail.latency",
    "Delivery latency"
  ],
  [
    "notifications.inbox.detail.channel",
    "Channel ID"
  ],
  [
    "notifications.inbox.detail.error",
    "Delivery error"
  ],
  [
    "notifications.inbox.detail.actions",
    "Notification actions"
  ],
  [
    "notifications.inbox.row.inspect",
    "Inspect notification: {{title}}"
  ],
  [
    "notifications.archived.title",
    "Archived notifications"
  ],
  [
    "notifications.archived.subtitle",
    "Notifications you previously archived. Restore to bring them back."
  ],
  [
    "notifications.archived.backToInbox",
    "Back to inbox"
  ],
  [
    "notifications.device.sectionAria",
    "Per-device notification and data rules"
  ],
  [
    "notifications.channels.subtitle",
    "Where to send notifications: Discord, Slack, Telegram, email, ntfy, Pushover, or a custom webhook."
  ],
  [
    "notifications.channels.statsAria",
    "Notification delivery summary"
  ],
  [
    "notifications.channels.devicesTitle",
    "Devices & providers"
  ],
  [
    "notifications.inbox.viewArchived",
    "View archived"
  ],
  [
    "onboarding.runtimeHealth.telemetryLastSeen",
    "Fleet Telemetry is stale. The last signal arrived {{time}}."
  ],
  [
    "onboarding.runtimeHealth.telemetryStale",
    "Fleet Telemetry is stale and live values may be out of date."
  ],
  [
    "onboarding.runtimeHealth.title",
    "Setup is complete, but a live service needs attention"
  ],
  [
    "onboarding.runtimeHealth.access",
    "You can keep using TeslaSync and viewing stored history while live services recover."
  ],
  [
    "onboarding.runtimeHealth.teslaAuth",
    "Your Tesla account authorization is unavailable and may need to be renewed."
  ],
  [
    "onboarding.runtimeHealth.reconnect",
    "Reconnect Tesla account"
  ],
  [
    "onboarding.runtimeHealth.alerts",
    "Configure health alerts"
  ],
  [
    "onboarding.stepper.status.pending",
    "Not started"
  ],
  [
    "onboarding.stepper.empty",
    "No setup steps to show right now."
  ],
  [
    "onboarding.stepper.label",
    "Onboarding steps"
  ],
  [
    "onboarding.tasks.optOut",
    "Stop showing setup tips"
  ],
  [
    "onboarding.tasks.dismiss",
    "Dismiss this tip"
  ],
  [
    "powerSql.info.title",
    "Working with queries"
  ],
  [
    "powerSql.info.readonly",
    "This is a read-only composing surface. Nothing runs in the browser."
  ],
  [
    "powerSql.info.exampleLabel",
    "Example"
  ],
  [
    "powerSql.catalog.noDescription",
    "No description"
  ],
  [
    "powerSql.catalog.columnCount",
    "{{count}} cols"
  ],
  [
    "powerSql.catalog.primaryKey",
    "Primary key"
  ],
  [
    "powerSql.catalog.noColumns",
    "No columns documented for this table."
  ],
  [
    "powerDashboards.title",
    "Dashboard composer"
  ],
  [
    "powerDashboards.editor.copySuccess",
    "Copied. Paste the JSON into your Grafana dashboard editor (dashboard settings → JSON Model)."
  ],
  [
    "powerDashboards.howTo.step1.title",
    "Pick panels"
  ],
  [
    "powerDashboards.howTo.step1.body",
    "Choose from the curated catalog — each panel maps to a real query against your fleet data."
  ],
  [
    "powerDashboards.howTo.step2.title",
    "Compose JSON"
  ],
  [
    "powerDashboards.howTo.step2.body",
    "Place panels on the 24-column grid in the editor, or let Helix draft the envelope for you."
  ],
  [
    "powerDashboards.howTo.step3.title",
    "Copy to Grafana"
  ],
  [
    "powerDashboards.howTo.step3.body",
    "Copy the envelope and paste it into Grafana under dashboard settings → JSON Model."
  ],
  [
    "powerDashboards.subtitle",
    "Assemble a Grafana dashboard JSON envelope from curated panels, then copy it into Grafana."
  ],
  [
    "powerDashboards.intro",
    "Compose a Grafana dashboard JSON envelope by picking panels from the curated catalog below and placing them on the 24-column grid. The browser does not push the dashboard to Grafana; copy your JSON into your existing Grafana dashboard editor."
  ],
  [
    "powerDashboards.editor.title",
    "Manual dashboard JSON editor"
  ],
  [
    "powerDashboards.editor.helper",
    "Edit the Grafana JSON model directly. Nothing is sent to Grafana — you copy it in yourself."
  ],
  [
    "powerDashboards.editor.placeholder",
    "{\n  \"title\": \"Fleet overview\",\n  \"slots\": [\n    {\n      \"panel_name\": \"drives_per_day_timeseries\",\n      \"grid_pos\": { \"x\": 0, \"y\": 0, \"w\": 24, \"h\": 8 }\n    }\n  ]\n}"
  ],
  [
    "powerDashboards.editor.label",
    "Dashboard JSON editor"
  ],
  [
    "powerDashboards.panels.title",
    "Curated panel catalog"
  ],
  [
    "powerDashboards.panels.intro",
    "These are the panels the curated catalog exposes. The Helix natural-language composer refuses any panel_name outside this list, and each dashboard may use each panel_name at most once."
  ],
  [
    "powerSql.title",
    "SQL playground"
  ],
  [
    "powerSql.editor.runEmpty",
    "Type or paste a SELECT/WITH query above before running."
  ],
  [
    "powerSql.editor.runUnavailable",
    "Read-only execution from the browser is not enabled in this build. Copy the query into your preferred database client (psql, DBeaver, TablePlus) and run it there."
  ],
  [
    "powerSql.subtitle",
    "Compose read-only SELECT / WITH queries against the curated schema catalog. Queries never execute in the browser — copy them into your database client."
  ],
  [
    "powerSql.workspace.label",
    "Query workspace"
  ],
  [
    "powerSql.editor.title",
    "Manual SQL editor"
  ],
  [
    "powerSql.editor.placeholder",
    "SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL '7 days'"
  ],
  [
    "powerSql.editor.label",
    "SQL query editor"
  ],
  [
    "powerSql.editor.copy",
    "Copy query"
  ],
  [
    "powerSql.editor.copyTitle",
    "Copy the query to paste into your database client"
  ],
  [
    "powerSql.catalog.title",
    "Curated schema catalog"
  ],
  [
    "powerSql.catalog.intro",
    "These tables are the only tables the curated catalog exposes. The Helix natural-language drafter refuses any query referencing tables outside this list."
  ],
  [
    "serviceIntelligence.warranty.selectMessage",
    "Choose a vehicle to count down its warranty coverage."
  ],
  [
    "serviceIntelligence.warranty.emptyTitle",
    "No warranty outlook"
  ],
  [
    "serviceIntelligence.warranty.empty",
    "Coverage countdown is not available for this vehicle yet."
  ],
  [
    "serviceIntelligence.warranty.detail",
    "ends {{date}} · {{days}} days left"
  ],
  [
    "serviceIntelligence.warranty.kmLeft",
    "{{km}} km left"
  ],
  [
    "ai.settings.costCap.unavailable",
    "Spend unavailable"
  ],
  [
    "ai.settings.costCap.amount",
    "${{spent}} / ${{cap}}"
  ],
  [
    "ai.settings.costCap.todayTitle",
    "Today’s Helix spend"
  ],
  [
    "ai.settings.costCap.barLabel",
    "Helix cost cap usage"
  ],
  [
    "ai.settings.costCap.unavailableHint",
    "Could not load today’s spend. The cap is still enforced server-side."
  ],
  [
    "ai.settings.costCap.criticalHint",
    "Cap reached — new Helix calls will be rejected until the cap resets at UTC midnight or you raise it."
  ],
  [
    "ai.settings.costCap.warnHint",
    "You are nearing today’s cap. Calls will pause once you reach it."
  ],
  [
    "ai.settings.feature.empty",
    "No AI features are available yet."
  ],
  [
    "theme.chartPalette.cbSafeHelp",
    "Okabe-Ito palette — distinguishable for all CVD types."
  ],
  [
    "theme.chartPalette.neonHelp",
    "Bright cyan/magenta — best when colour vision is unimpaired."
  ],
  [
    "featureConfig.errorTitle",
    "Couldn’t load feature config"
  ],
  [
    "featureConfig.errorMessage",
    "Something went wrong fetching your Tesla feature configuration. Check your connection and try again."
  ],
  [
    "fleetSetup.readiness.caValue",
    "Let’s encrypt ISRG root X1"
  ],
  [
    "fleetSetup.subscribe.needAuth",
    "Connect Tesla first. Subscribe uses the stored Fleet token."
  ],
  [
    "fleetSetup.subscribe.signalsPicked",
    "{{count}} signals selected. Presets (Balanced, Low Power, Track Mode, …) set intervals per category."
  ],
  [
    "account.privacy.consent.policyError",
    "Deployment consent policy unavailable — you can still manage your own choice below."
  ],
  [
    "account.privacy.about.localTitle",
    "Stored on this device"
  ],
  [
    "account.privacy.about.localBody",
    "Recently viewed pages and your cookie choice live in this browser’s local storage — they are never uploaded to the server."
  ],
  [
    "account.privacy.about.syncTitle",
    "No cross-device sync"
  ],
  [
    "account.privacy.about.syncBody",
    "Each browser keeps its own list and consent state. Clearing them here has no effect on your other devices or sessions."
  ],
  [
    "account.privacy.about.controlTitle",
    "You stay in control"
  ],
  [
    "account.privacy.about.controlBody",
    "Wipe your history or change your consent at any time. Changes take effect immediately and update every open tab."
  ],
  [
    "account.privacy.about.title",
    "How TeslaSync handles this data"
  ],
  [
    "account.privacy.kpi.loadError",
    "Failed to load privacy policy"
  ],
  [
    "account.privacy.kpi.aria",
    "Privacy summary"
  ],
  [
    "account.privacy.kpi.recent",
    "Recent pages stored"
  ],
  [
    "account.privacy.kpi.recentMax",
    "of {{max}} max"
  ],
  [
    "account.privacy.kpi.consent",
    "Consent status"
  ],
  [
    "account.privacy.kpi.policy",
    "Consent policy"
  ],
  [
    "account.privacy.kpi.policyRequiredSub",
    "Consent gate enabled"
  ],
  [
    "account.privacy.kpi.policyOptionalSub",
    "No consent gate"
  ],
  [
    "account.privacy.kpi.scope",
    "Data scope"
  ],
  [
    "account.privacy.kpi.scopeSub",
    "Local only — never synced"
  ],
  [
    "quietHours.form.unsaved",
    "You have unsaved quiet-hours changes. Discard them?"
  ],
  [
    "quietHours.error.missingDraft",
    "The quiet-hours draft is unavailable. Reopen the editor."
  ],
  [
    "region.loading",
    "Loading region…"
  ],
  [
    "region.noRegion",
    "Tesla did not return a region for this account."
  ],
  [
    "account.sessions.breakdownError",
    "Failed to load sessions"
  ],
  [
    "account.sessions.openMode.title",
    "Session tracking unavailable"
  ],
  [
    "account.sessions.openMode.message",
    "Active session tracking requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User, then reload."
  ],
  [
    "account.sessions.tableAria",
    "Active devices"
  ],
  [
    "account.sessions.tableTitle",
    "Active devices"
  ],
  [
    "totp.backupCodes.empty",
    "No backup codes were returned. Close this dialog and regenerate your codes from the two-factor settings."
  ],
  [
    "totp.apps.title",
    "Compatible apps"
  ],
  [
    "totp.apps.subtitle",
    "Any RFC 6238 TOTP client works."
  ],
  [
    "totp.recovery.tip1",
    "Each backup code works once — regenerate when you are running low."
  ],
  [
    "totp.recovery.tip2",
    "Store codes in your password manager, not next to your authenticator app."
  ],
  [
    "totp.recovery.tip3",
    "Codes rotate every 30 seconds; if one is rejected, wait for the next."
  ],
  [
    "totp.recovery.title",
    "Recovery & good habits"
  ],
  [
    "totp.recovery.subtitle",
    "Keep a way back in if you lose your phone."
  ],
  [
    "totp.guide.step1.title",
    "Install an authenticator app"
  ],
  [
    "totp.guide.step1.body",
    "Use any RFC 6238 client — Google Authenticator, 1Password, Bitwarden or Authy."
  ],
  [
    "totp.guide.step2.title",
    "Scan the QR code"
  ],
  [
    "totp.guide.step2.body",
    "Choose Enable TOTP, then scan the QR or paste the manual secret into your app."
  ],
  [
    "totp.guide.step3.title",
    "Verify a 6-digit code"
  ],
  [
    "totp.guide.step3.body",
    "Enter the rotating code your app shows to confirm both devices are in sync."
  ],
  [
    "totp.guide.step4.title",
    "Store your backup codes"
  ],
  [
    "totp.guide.step4.body",
    "Save the one-time codes somewhere safe — they recover access if you lose your app."
  ],
  [
    "totp.guide.title",
    "How setup works"
  ],
  [
    "totp.guide.subtitle",
    "Four steps, about a minute."
  ],
  [
    "typography.monoFont.customPlaceholder",
    "e.g. 'Cascadia Code', ui-monospace, monospace"
  ],
  [
    "helix.page.subtitle",
    "Optional AI integration. Off by default — nothing runs until you opt in here."
  ],
  [
    "account.privacy.subtitle",
    "Manage browser-local data: recently viewed pages and cookies / analytics consent."
  ],
  [
    "shareCard.brief.paused",
    "Cached evidence; refresh paused"
  ],
  [
    "shareCard.brief.refreshing",
    "Refreshing cached evidence"
  ],
  [
    "shareCard.brief.eyebrow",
    "Share card evidence"
  ],
  [
    "shareCard.brief.freshness",
    "Drive timestamps describe the evidence window, not query freshness."
  ],
  [
    "sharing.trips.brief.description",
    "Totals cover only the returned recent-trip list (at most 20 trips), not all trips or a selected date window."
  ],
  [
    "sharing.trips.brief.loading",
    "Loading recent trips"
  ],
  [
    "sharing.trips.brief.retained",
    "Cached trips; refresh failed"
  ],
  [
    "sharing.trips.brief.paused",
    "Cached trips; refresh paused"
  ],
  [
    "sharing.trips.brief.refreshing",
    "Refreshing cached trips"
  ],
  [
    "sharing.trips.brief.resolved",
    "Recent-trip list resolved"
  ],
  [
    "sharing.trips.brief.eyebrow",
    "Sharing"
  ],
  [
    "sharing.trips.brief.title",
    "Recent-trip evidence"
  ],
  [
    "sharing.trips.brief.fleet",
    "Fleet recent-trip list"
  ],
  [
    "sharing.trips.brief.vehicle",
    "Selected vehicle recent-trip list"
  ],
  [
    "sharing.trips.brief.freshness",
    "Trip dates are source periods; no query freshness timestamp is inferred."
  ],
  [
    "sharing.trips.brief.provenance",
    "GET /trips; limit 20; totals retain the existing safe-number aggregation of returned fields."
  ],
  [
    "shareCard.brief.efficiencyDescription",
    "Consumption uses only positive-distance energy rows; recovered share uses paired energy and regen rows. Missing fields are not measured zero."
  ],
  [
    "shareCard.brief.description",
    "Only returned, runtime-validated selected-window evidence supports these measurements; field coverage and the query cap remain explicit."
  ],
  [
    "share.loading",
    "Loading shared drive report…"
  ],
  [
    "share.sessionHeader",
    "Shared charging report"
  ],
  [
    "share.socTooltipLabel",
    "Battery (%)"
  ],
  [
    "share.noCurveData",
    "The charge curve was not included in this share."
  ],
  [
    "activity.timeline.brief.countTitle",
    "Range and page counts"
  ],
  [
    "activity.timeline.brief.description",
    "The server total covers the selected range; loaded events, days, and critical alerts describe this page only."
  ],
  [
    "activity.timeline.brief.scope",
    "Selected range and current loaded page have different coverage."
  ],
  [
    "activity.timeline.brief.mixDescription",
    "Counts by event type describe only the loaded page, not the entire selected range."
  ],
  [
    "chatbot.knowledge.title",
    "Retrieved documentation"
  ],
  [
    "chatbot.knowledge.inspect",
    "Inspect retrieved sources"
  ],
  [
    "chatbot.knowledge.freshness",
    "Bundled documentation from this deployment; publication dates are unavailable. Only sources named in the answer are marked cited."
  ],
  [
    "chatbot.knowledge.part",
    "chunk"
  ],
  [
    "chatbot.knowledge.cited",
    "Cited in answer"
  ],
  [
    "chatbot.knowledge.retrieved",
    "Retrieved, not cited"
  ],
  [
    "chatbot.rename.placeholder",
    "Conversation name"
  ],
  [
    "commands.hero.briefDescription",
    "Battery, estimated range, cabin temperature, and access state from the selected vehicle readings."
  ],
  [
    "fsm.noObservedState",
    "No observed state"
  ],
  [
    "dashboardPresets.title",
    "Dashboard presets"
  ],
  [
    "dashboardPresets.subtitle",
    "Curated widget sets for the four ways this app is used. Choosing one updates your existing dashboard in place — it does not create another one, and it never overwrites changes you make afterwards."
  ],
  [
    "dashboardPresets.applyOnDashboard",
    "Open the dashboard to apply it"
  ],
  [
    "dashboardPresets.openDashboard",
    "Open the dashboard"
  ],
  [
    "dashboardPresets.selected",
    "Selected — tap to clear"
  ],
  [
    "dashboardPresets.pending",
    "Chosen — tap to clear"
  ],
  [
    "dashboardPresets.chosenDiverged",
    "Chosen — tap to clear"
  ],
  [
    "dashboardPresets.choose",
    "Use this preset"
  ],
  [
    "dashboardPresets.includes",
    "Includes"
  ],
  [
    "dashboardPresets.pendingNote",
    "Chosen — applies to your dashboard next time you open it."
  ],
  [
    "dashboardPresets.divergedNote",
    "Your dashboard has changed since this preset was applied. Your changes are kept — re-apply only if you want the preset back."
  ],
  [
    "dashboardPresets.activeUnchosenNote",
    "This is what your dashboard looks like right now, but a different preset is chosen."
  ],
  [
    "dashboardPresets.reapply",
    "Re-apply to my dashboard"
  ],
  [
    "help.guided.title",
    "Show me around"
  ],
  [
    "help.guided.subtitle",
    "Walkthroughs run only when you ask for them — nothing here starts on its own."
  ],
  [
    "help.guided.intro",
    "Replay the product introduction"
  ],
  [
    "help.guided.tours",
    "Browse guided tours"
  ],
  [
    "glossary.panelTitle",
    "What the numbers mean"
  ],
  [
    "glossary.panelSubtitle",
    "Definitions for the terms that are easiest to misread, and where each number actually comes from."
  ],
  [
    "glossary.howMeasured",
    "How we measure it"
  ],
  [
    "glossary.seeInContext",
    "See it in context"
  ],
  [
    "helpIndex.searchLabel",
    "Search help"
  ],
  [
    "helpIndex.searchPlaceholder",
    "Search terms, pages and troubleshooting — e.g. \"phantom drain\""
  ],
  [
    "helpIndex.relevantHere",
    "Relevant to this page"
  ],
  [
    "helpIndex.resultsLabel",
    "Help results"
  ],
  [
    "helpIndex.noResults",
    "Nothing in the help index matches that. Try a shorter word, or send a problem report below."
  ],
  [
    "releaseNotes.title",
    "What's changed"
  ],
  [
    "releaseNotes.subtitle",
    "Generated from the project changelog. \"Action needed\" is flagged conservatively — a false alarm costs a minute, a missed migration costs an outage."
  ],
  [
    "releaseNotes.empty",
    "No releases have been published yet."
  ],
  [
    "releaseNotes.actionNeeded",
    "Action needed"
  ],
  [
    "releaseNotes.migration",
    "Migration"
  ],
  [
    "releaseNotes.itemActionPrefix",
    "Action:"
  ],
  [
    "supportBundle.title",
    "Support bundle"
  ],
  [
    "supportBundle.subtitle",
    "A redacted technical summary of this browser session. Copy or download it to attach to a support conversation."
  ],
  [
    "supportBundle.copy",
    "Copy bundle"
  ],
  [
    "supportBundle.brief.scope",
    "Current browser-session bundle; exact redacted contents remain available below."
  ],
  [
    "supportBundle.brief.metadata",
    "Redacted browser-session bundle metadata."
  ],
  [
    "supportBundle.showJson",
    "Show the exact bundle contents"
  ],
  [
    "incidentTimeline.unsavedUpdate",
    "You have an unsaved incident update."
  ],
  [
    "incidentTimeline.formLabel",
    "Add incident update"
  ],
  [
    "activity.myActivity.feed.error",
    "Failed to load activity feed"
  ],
  [
    "activity.myActivity.feed.loading",
    "Loading activity feed"
  ],
  [
    "activity.myActivity.byHour.chartAria",
    "Activity counts by hour of day"
  ],
  [
    "activity.myActivity.brief.description",
    "Actions, active days, action types, and entities derived from the loaded personal activity feed."
  ],
  [
    "activity.myActivity.brief.scope",
    "Loaded recent activity only; not a complete account lifetime total."
  ],
  [
    "activity.myActivity.brief.lastContext",
    "Most recent timestamp in the loaded feed."
  ],
  [
    "system.brief.freshnessUnknown",
    "Source observation time not supplied"
  ],
  [
    "system.brief.eyebrow",
    "System evidence"
  ],
  [
    "dataRepair.cases.rowLabel",
    "Case #{{id}}, {{rule}}"
  ],
  [
    "dataRepair.cases.briefDescription",
    "Server-reported repair case workload; active cases are open plus in-review cases."
  ],
  [
    "dataRepair.cases.briefScope",
    "Repair case statistics response; separate from the filtered queue and diagnosis scan."
  ],
  [
    "dataRepair.brief.description",
    "Suggested session boundary repairs and blocked cases from the durable-history diagnosis response."
  ],
  [
    "dataRepair.brief.scope",
    "Current diagnosis response; not a complete lifetime count."
  ],
  [
    "commandHistory.total",
    "Total commands"
  ],
  [
    "commandReliability.overall",
    "Overall success"
  ],
  [
    "commandReliability.attempts",
    "{{n}} attempts"
  ],
  [
    "commandReliability.unreliable",
    "Unreliable commands"
  ],
  [
    "commandReliability.allFine",
    "Nothing failing"
  ],
  [
    "commandReliability.intents",
    "Distinct intents"
  ],
  [
    "commandReliability.intentsHint",
    "after collapsing retry storms"
  ],
  [
    "commandReliability.storms",
    "Retry storms"
  ],
  [
    "commandReliability.stormsHint",
    "you pressed it again, and again"
  ],
  [
    "fsm.kpis",
    "FSM summary metrics"
  ],
  [
    "systemStatus.aiSpend.briefScope",
    "Audited today (UTC), prior seven-day daily average, and projected UTC midnight spend are different windows."
  ],
  [
    "systemStatus.aiSpend.todayMetric",
    "Audited today (UTC)"
  ],
  [
    "systemStatus.aiSpend.baselineMetric",
    "Prior 7-day daily average"
  ],
  [
    "systemStatus.aiSpend.projectionMetric",
    "Projected UTC midnight spend"
  ],
  [
    "systemStatus.workersBrief.description",
    "Reported worker types, healthy replicas, and replicated types from the worker health response."
  ],
  [
    "systemStatus.workersBrief.scope",
    "Reported instances only; this response does not prove unreported replicas are healthy."
  ],
  [
    "systemStatus.incidents.unsaved",
    "You have unsaved incident details. Discard them?"
  ],
  [
    "systemStatus.incidents.titleMin",
    "Title must be at least 3 characters."
  ],
  [
    "systemStatus.incidents.titlePlaceholder",
    "e.g. Wall connector restart at 14:00"
  ],
  [
    "systemStatus.incidents.componentsHint",
    "Optional. Separate multiple component names with commas."
  ],
  [
    "systemStatus.incidents.messagePlaceholder",
    "What's the situation?"
  ],
  [
    "systemStatus.maintenance.messagePlaceholder",
    "What's happening (optional)"
  ],
  [
    "systemStatus.slo.metricsTitle",
    "Uptime evidence"
  ],
  [
    "systemStatus.slo.briefDescription",
    "Historical uptime is shown only for a series-backed response; current component health is separate snapshot evidence."
  ],
  [
    "systemStatus.slo.uptimeMetric",
    "Historical uptime"
  ],
  [
    "systemStatus.slo.componentsMetric",
    "Healthy components"
  ],
  [
    "systemStatus.pipelineBrief.description",
    "Configured vehicles and recorded table counts; polling and stream liveness remain independent evidence below."
  ],
  [
    "systemStatus.pipelineBrief.scope",
    "Vehicle response and database row-count snapshot; no shared historical window is supplied."
  ],
  [
    "systemStatus.pipelineBrief.livenessDescription",
    "Configured vehicles classified by their most recent polling or Fleet Telemetry timestamp, using the existing liveness rules."
  ],
  [
    "systemStatus.pipelineBrief.livenessScope",
    "Current client-clock age: sending under 5 minutes, slow from 5 to under 30 minutes, stale from 30 minutes; offline means no valid timestamp, not confirmed vehicle disconnection."
  ],
  [
    "systemStatus.pipelineBrief.livenessFreshness",
    "Polling and stream timestamps remain independently visible on each vehicle row."
  ],
  [
    "systemStatus.pipelineBrief.offlineMeaning",
    "No valid polling or stream timestamp was supplied; missing evidence is not a measured outage."
  ],
  [
    "teslaUsage.brief.cycleTitle",
    "Cycle usage evidence"
  ],
  [
    "commandHistory.noRangeData",
    "No commands in the selected range"
  ],
  [
    "commandHistory.kpis",
    "Command metrics"
  ],
  [
    "commandHistory.topCommands",
    "Top commands"
  ],
  [
    "commandHistory.totalInRange",
    "Total in range"
  ],
  [
    "commandHistory.errorPrefix",
    "Error: {{msg}}"
  ],
  [
    "commandReliability.subtitle",
    "Which remote commands you can actually trust, graded on wilson confidence bounds rather than a raw success percentage"
  ],
  [
    "commandReliability.kpis",
    "Command reliability metrics"
  ],
  [
    "commandReliability.noData",
    "No remote commands have been issued yet, so there is no reliability record to grade."
  ],
  [
    "commandReliability.chartHint",
    "Bars are the pessimistic lower bound; the dot is the raw success rate the log shows"
  ],
  [
    "commandReliability.col.lower",
    "Lower bound (%)"
  ],
  [
    "commandReliability.col.naive",
    "Raw rate (%)"
  ],
  [
    "commandReliability.col.upper",
    "Upper bound (%)"
  ],
  [
    "commandReliability.col.attempts",
    "Attempts"
  ],
  [
    "commandReliability.rawRate",
    "Raw rate"
  ],
  [
    "commandReliability.detail",
    "Command breakdown"
  ],
  [
    "help.commandReliability.iconLabel",
    "More info about intents"
  ],
  [
    "commandReliability.noCommands",
    "No commands recorded yet."
  ],
  [
    "commandReliability.outcomeValue",
    "{{ok}} ok · {{bad}} failed"
  ],
  [
    "commandReliability.interval",
    "95 % interval"
  ],
  [
    "commandReliability.effort",
    "Attempts per intent"
  ],
  [
    "commandReliability.effortValue",
    "{{n}} · {{retried}} retried"
  ],
  [
    "commandReliability.topError",
    "Usual failure"
  ],
  [
    "commandReliability.topErrorValue",
    "{{msg}} (×{{n}})"
  ],
  [
    "dataExport.presets.aria",
    "Date range presets"
  ],
  [
    "dataExport.brief.recordsDescription",
    "Record counts reported by drive and charging export jobs in the loaded history."
  ],
  [
    "dataExport.brief.recordsScope",
    "Exported records may overlap between jobs; these are not unique database session totals."
  ],
  [
    "dataExport.stats.aria",
    "Export summary metrics"
  ],
  [
    "dataExport.brief.description",
    "Export counts, recorded file bytes, most frequent export type, and latest creation time from the loaded job history."
  ],
  [
    "dataExport.brief.scope",
    "Loaded export jobs; no server-wide total or reporting window is supplied."
  ],
  [
    "dataExport.brief.bytesContext",
    "Sum of recorded file sizes; jobs without a file size contribute no recorded bytes."
  ],
  [
    "dataExport.brief.lastContext",
    "Latest job creation time, not completion or download time."
  ],
  [
    "dataExport.loadError",
    "Failed to load export jobs"
  ],
  [
    "dataExport.create.aria",
    "Create a new export"
  ],
  [
    "dataExport.account.aria",
    "Full account export"
  ],
  [
    "diagnostic.summary.passing",
    "Passing"
  ],
  [
    "diagnostic.overallSection",
    "Overall result"
  ],
  [
    "diagnostic.summary.title",
    "Diagnostic summary"
  ],
  [
    "diagnostic.brief.description",
    "Probe outcomes and recorded timings from the displayed diagnostic report."
  ],
  [
    "diagnostic.brief.scope",
    "One diagnostic run; total time is the sum of probe durations."
  ],
  [
    "diagnostic.summary.total",
    "Total checks"
  ],
  [
    "diagnostic.summary.slowest",
    "Slowest check"
  ],
  [
    "diagnostic.downloadSuccess",
    "Diagnostic report downloaded"
  ],
  [
    "diagnostic.checksTitle",
    "Dependency checks"
  ],
  [
    "helpIndex.title",
    "Search the help index"
  ],
  [
    "helpIndex.subtitle",
    "Definitions, pages and troubleshooting, indexed by term and route. Results are the same every time — no model, no network."
  ],
  [
    "incidentTimeline.brief.description",
    "Incident status, elapsed duration, recorded updates, affected components, source, and start time."
  ],
  [
    "incidentTimeline.brief.unknownScope",
    "Incident window unavailable until the source resolves."
  ],
  [
    "incidentTimeline.brief.statusContext",
    "Recorded incident lifecycle state; resolution controls remain below."
  ],
  [
    "incidentTimeline.brief.sourceContext",
    "Incident source as reported, without inference."
  ],
  [
    "incidentTimeline.overview",
    "Incident overview and details"
  ],
  [
    "incidentTimeline.timelineRegion",
    "Incident timeline and updates"
  ],
  [
    "system.outage.brief.scope",
    "Selected vehicle outage evidence; no fixed reporting window is supplied."
  ],
  [
    "system.outage.brief.gapLabel",
    "Telemetry gap"
  ],
  [
    "system.outage.brief.timestampContext",
    "Original event time; a missing timestamp does not imply zero traffic."
  ],
  [
    "roadmap.brief.scope",
    "Bundled roadmap entries, not live deployment or release telemetry."
  ],
  [
    "search.subtitle",
    "Find vehicles, drives, charging, alerts and more across your fleet"
  ],
  [
    "search.refresh",
    "Refresh results"
  ],
  [
    "search.filters.label",
    "Filter results by type"
  ],
  [
    "search.kpis",
    "Search summary"
  ],
  [
    "search.brief.description",
    "Result counts and category coverage for the current query and selected type filters."
  ],
  [
    "search.kpi.forQuery",
    "for “{{query}}”"
  ],
  [
    "search.kpi.totalResults",
    "Total results"
  ],
  [
    "search.brief.scope",
    "Returned search hits, not an unbounded server total."
  ],
  [
    "search.kpi.ofTypes",
    "of {{n}} searchable"
  ],
  [
    "search.kpi.filtered",
    "of {{n}} types"
  ],
  [
    "search.kpi.allTypes",
    "All types shown"
  ],
  [
    "search.kpi.topMatch",
    "Top match"
  ],
  [
    "search.kpi.topCount",
    "{{n}} results"
  ],
  [
    "search.kpi.noMatches",
    "No matches"
  ],
  [
    "search.results.region",
    "Search results"
  ],
  [
    "search.result.open",
    "Open {{title}}"
  ],
  [
    "fsm.overview",
    "Vehicle state overview"
  ],
  [
    "fsm.analysis",
    "Transition analysis"
  ],
  [
    "fsm.detail.name",
    "FSM name"
  ],
  [
    "statusApi.brief.description",
    "Documented endpoint count, transport, payload, and compatibility policy."
  ],
  [
    "statusApi.brief.scope",
    "Bundled documentation, not a runtime availability probe."
  ],
  [
    "liveMonitor.streamConnected",
    "Live throughput stream connected"
  ],
  [
    "liveMonitor.streamDisconnected",
    "Live throughput stream disconnected"
  ],
  [
    "signalCatalog.removeSignal",
    "Remove {{name}} from selection"
  ],
  [
    "signalCatalog.addSignal",
    "Add {{name}} to selection"
  ],
  [
    "common.unknownError",
    "unknown error"
  ],
  [
    "signals.catalog.loadError",
    "Failed to load catalog: {{message}}"
  ],
  [
    "signals.catalog.empty",
    "No signals available for this vehicle."
  ],
  [
    "signalLog.kpi.totalRecords",
    "Total records"
  ],
  [
    "signalLog.kpi.signalsWithData",
    "{{count}} with data"
  ],
  [
    "signalLog.kpi.timeSpan",
    "Time span"
  ],
  [
    "signalLog.kpis",
    "Query summary"
  ],
  [
    "signalLog.subtitle",
    "Query signal history from Postgres"
  ],
  [
    "telemetry.sparkline.nonNumeric",
    "Non-numeric signal ({{kind}})"
  ],
  [
    "telemetry.sparkline.error",
    "Failed to load trend"
  ],
  [
    "telemetry.sparkline.empty",
    "No samples in last hour"
  ],
  [
    "signalStats.noDataInRange",
    "No data in range"
  ],
  [
    "signalStats.hideEmpty",
    "Hide empty ({{count}})"
  ],
  [
    "signalCorrelation.bestR",
    "Peak correlation"
  ],
  [
    "help.signalCorrelation.bestR",
    "An ordinary overlay chart only ever shows the zero-lag correlation, which misses every relationship with a delay in it. Sweeping the lag finds the shift at which the two signals line up best, and the difference between the peak and the zero-lag value is exactly the information a static chart throws away."
  ],
  [
    "signalCorrelation.zeroLag",
    "at zero lag: {{r}}"
  ],
  [
    "signalCorrelation.bestLag",
    "Best lag"
  ],
  [
    "signalCorrelation.noise",
    "Noise"
  ],
  [
    "signalCorrelation.threshold",
    "needs |r| > {{v}}"
  ],
  [
    "signalCorrelation.effectiveN",
    "Effective samples"
  ],
  [
    "signalCorrelation.rawN",
    "from {{n}} raw points"
  ],
  [
    "signalCorrelation.kpis",
    "Correlation metrics"
  ],
  [
    "signalsWorkspace.historical",
    "Historical"
  ],
  [
    "signalsWorkspace.liveRate",
    "Live rate"
  ],
  [
    "liveMonitor.topSignalsList",
    "Most active signals ranked by arrival frequency"
  ],
  [
    "mqtt.metrics",
    "Stream metrics"
  ],
  [
    "mqtt.streamOverview",
    "Stream overview"
  ],
  [
    "help.signalChangePoints.count",
    "A change point closes the current segment and starts a fresh one only once the cumulative statistic crosses its alarm threshold, and never before the fixed minimum segment length has elapsed."
  ],
  [
    "help.signalChangePoints.iconLabel",
    "More info about signal selection"
  ],
  [
    "signalCorrelation.leadA",
    "{{a}} leads"
  ],
  [
    "signalCorrelation.leadB",
    "{{b}} leads"
  ],
  [
    "signalCorrelation.simultaneous",
    "Simultaneous"
  ],
  [
    "signalCorrelation.noLead",
    "No relationship"
  ],
  [
    "signalCorrelation.subtitle",
    "Sweep one telemetry signal against another across time shifts to find not just whether they move together, but which one moves first"
  ],
  [
    "signalCorrelation.pick",
    "Choose two signals"
  ],
  [
    "help.signalCorrelation.iconLabel",
    "More info about signal selection"
  ],
  [
    "signalCorrelation.detrend",
    "Correlate changes, not levels"
  ],
  [
    "signalCorrelation.detrendHint",
    "Differencing removes shared drift, so two signals that merely both rise over the day stop looking related"
  ],
  [
    "signalCorrelation.noOverlap",
    "These two signals have no overlapping window of history in the last day, so there is nothing to compare."
  ],
  [
    "signalCorrelation.pickTwo",
    "Choose two signals above to compute the correlogram."
  ],
  [
    "signalCorrelation.correlogramHint",
    "Correlation at every time shift; the dashed lines are the significance threshold"
  ],
  [
    "signalCorrelation.col.lag",
    "Lag (s)"
  ],
  [
    "signalCorrelation.col.r",
    "r"
  ],
  [
    "signalCorrelation.overlayHint",
    "Both signals rescaled to 0–1 so their shapes can be compared directly"
  ],
  [
    "signalCorrelation.reading",
    "Reading the result"
  ],
  [
    "signalCorrelation.noReading",
    "Pick two signals to see how the result should be read."
  ],
  [
    "signalCorrelation.coverage",
    "{{filled}} filled · {{gaps}} gaps"
  ],
  [
    "signalCorrelation.realText",
    "The peak clears the threshold adjusted for autocorrelation, so this relationship is unlikely to be an artefact of the two signals simply being smooth."
  ],
  [
    "signalCorrelation.noiseText",
    "The peak does not clear the autocorrelation-adjusted threshold. Smooth signals correlate with almost anything, so this is best treated as coincidence."
  ],
  [
    "signalCorrelation.zeroLagText",
    "The signals line up best with no shift at all, which points to a shared cause rather than one driving the other."
  ],
  [
    "signalCorrelation.lagText",
    "The best alignment needs a {{lag}} second shift. Leading in time is not proof of causation, but a consistent lead is where causal explanations start."
  ],
  [
    "help.signalEntropy.entropy",
    "How surprised you should be by the next sample given everything seen so far. Normalized entropy divides by the ceiling for however many bins were actually populated, so a signal using 2 of 8 requested bins is judged against a 2-state ceiling, not an 8-state one it never approached."
  ],
  [
    "help.signalEntropy.iconLabel",
    "More info about signal selection"
  ],
  [
    "signalExplorer.status.historical",
    "Historical"
  ],
  [
    "signalExplorer.kpi.ofMax",
    "of {{max}} max"
  ],
  [
    "signalExplorer.kpi.liveEvents",
    "Live events"
  ],
  [
    "signalExplorer.kpi.timeSpan",
    "Time span"
  ],
  [
    "signalExplorer.kpi.rollingWindow",
    "5-min window"
  ],
  [
    "signalExplorer.kpi.days",
    "{{count}}d"
  ],
  [
    "signalExplorer.kpi.noRange",
    "No range set"
  ],
  [
    "signalExplorer.kpi.withStats",
    "{{count}} with stats"
  ],
  [
    "signalExplorer.noVehicle",
    "Select a vehicle to begin"
  ],
  [
    "signalExplorer.noVehicleDesc",
    "Pick a vehicle from the picker above to explore its signals."
  ],
  [
    "signalExplorer.kpis",
    "Exploration summary"
  ],
  [
    "signalExplorer.stopLive",
    "Stop live"
  ],
  [
    "signalLog.noVehicle",
    "Select a vehicle to begin"
  ],
  [
    "signalLog.noVehicleDesc",
    "Pick a vehicle from the picker above to query its signal history."
  ],
  [
    "signalsWorkspace.subtitle",
    "Browse the live catalog, inspect history, monitor live, or compare snapshots — all in one place."
  ],
  [
    "signalsWorkspace.noVehicle",
    "Select a vehicle to begin"
  ],
  [
    "signalsWorkspace.noVehicleDesc",
    "Pick a vehicle from the picker above to see its signals."
  ],
  [
    "signalsWorkspace.kpis",
    "Workspace summary"
  ],
  [
    "signalsWorkspace.addSignals",
    "Add signals"
  ],
  [
    "signalsWorkspace.noneSelected",
    "None selected"
  ],
  [
    "signalsWorkspace.stopLive",
    "Stop live"
  ],
  [
    "signalsWorkspace.exitCompare",
    "Exit compare"
  ],
  [
    "signalsWorkspace.chartMode",
    "Chart layout"
  ],
  [
    "signalsWorkspace.chartOverlay",
    "Overlay"
  ],
  [
    "signalsWorkspace.emptyTitle",
    "Pick signals and run a query"
  ],
  [
    "signalsWorkspace.emptyDesc",
    "Pick signals from the catalog, choose a time range, then click run for historical data — or toggle live to stream in real time."
  ],
  [
    "help.signalTrend.slope",
    "Theil-Sen slope: the median of every pairwise slope between samples. A handful of outliers cannot swing this the way they can an ordinary least-squares fit."
  ],
  [
    "help.signalTrend.significance",
    "Tie-aware Mann-Kendall tests whether the observed ordering of values is more consistent with a monotonic trend than chance — ties (repeated readings) are corrected for rather than treated as informationless."
  ],
  [
    "help.signalTrend.iconLabel",
    "More info about signal selection"
  ],
  [
    "journey.arrival.empty",
    "No arrival reading yet."
  ],
  [
    "journey.arrival.loading",
    "Preparing arrival…"
  ],
  [
    "journey.arrival.moving",
    "moving"
  ],
  [
    "journey.arrival.shortfall",
    "top up ≈ {{energy}} en route"
  ],
  [
    "journey.arrival.adjusted",
    "adjusted {{ratio}}× from {{count}} trips"
  ],
  [
    "journey.live.empty",
    "No fixes yet. Check in to drop the first trail point."
  ],
  [
    "journey.live.checkIn",
    "Check in"
  ],
  [
    "journey.live.title",
    "Live trip"
  ],
  [
    "journey.live.queued",
    "{{count}} queued"
  ],
  [
    "journey.live.loading",
    "Loading live trip…"
  ],
  [
    "journey.live.remaining",
    "remaining"
  ],
  [
    "journey.live.have",
    "have"
  ],
  [
    "journey.live.need",
    "need"
  ],
  [
    "journey.live.nextStop",
    "Next stop"
  ],
  [
    "journey.live.wait",
    "{{time}} wait"
  ],
  [
    "journey.live.noNextStop",
    "No scored stop yet"
  ],
  [
    "journey.live.lastFix",
    "Last fix {{time}}"
  ],
  [
    "journey.live.fixes",
    "{{count}} fixes"
  ],
  [
    "journey.nudge.title",
    "Leave now?"
  ],
  [
    "journey.nudge.empty",
    "No nudge yet."
  ],
  [
    "journey.nudge.loading",
    "Reading departure window…"
  ],
  [
    "journey.nudge.slot",
    "calm {{time}}"
  ],
  [
    "journey.nudge.blocker",
    "Blocker"
  ],
  [
    "journey.replan.title",
    "Replan"
  ],
  [
    "journey.replan.rescore",
    "Rescore from here"
  ],
  [
    "journey.replan.empty",
    "No deviation reading yet."
  ],
  [
    "journey.replan.loading",
    "Measuring deviation…"
  ],
  [
    "journey.replan.offBy",
    "{{distance}} off corridor"
  ],
  [
    "journey.replan.scoring",
    "Rescoring stops…"
  ],
  [
    "journey.scoring.openHistory",
    "Open charging history"
  ],
  [
    "replay.map.stationaryRouteTitle",
    "Route can't be plotted"
  ],
  [
    "replay.map.stationaryRouteBody",
    "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. The trip statistics, speed, and elevation timeline above the scrubber are unaffected."
  ],
  [
    "fleet.noBatteryData",
    "No battery data available for the current fleet."
  ],
  [
    "vehicles.silence.never",
    "No telemetry yet"
  ],
  [
    "vehicles.silence.silent",
    "Vehicle silent"
  ],
  [
    "vehicles.silence.quiet",
    "Vehicle quiet"
  ],
  [
    "telemetry.fullInHours",
    "Full in {{hours}}h"
  ],
  [
    "telemetry.gpsAccuracy",
    "GPS accuracy"
  ],
  [
    "telemetry.maxSpeedToDestination",
    "Max speed to destination"
  ],
  [
    "vehicleAccess.overview.title",
    "Access overview"
  ],
  [
    "vehicleAccess.overview.empty",
    "No access data to summarize yet."
  ],
  [
    "vehicleAccess.overview.invitationStatus",
    "Invitation status"
  ],
  [
    "vehicleAccess.overview.noInvitations",
    "No invitations yet"
  ],
  [
    "vehicleAccess.overview.driverRoles",
    "Driver roles"
  ],
  [
    "vehicleAccess.overview.noDrivers",
    "No drivers yet"
  ],
  [
    "card.stateLoading",
    "Loading live state…"
  ],
  [
    "card.stateEmpty",
    "No live telemetry yet"
  ],
  [
    "card.viewDetailsFor",
    "View details for {{name}}"
  ],
  [
    "vehicles.detail.detailsUnavailable",
    "Vehicle details unavailable"
  ],
  [
    "vehicles.photos.openAtNamed",
    "Open photo {{index}} of {{total}} — {{name}}"
  ],
  [
    "vehicles.photos.loading",
    "Loading vehicle photo…"
  ],
  [
    "a11y.summary.route.empty",
    "Route map. No location data recorded."
  ],
  [
    "a11y.summary.route.generic",
    "Route map"
  ],
  [
    "a11y.summary.route.points",
    "{{count}} recorded points"
  ],
  [
    "a11y.summary.state.since",
    "For {{duration}}"
  ],
  [
    "a11y.summary.state.previous",
    "Previously {{state}}"
  ],
  [
    "a11y.summary.state.next",
    "Can move to {{states}}"
  ],
  [
    "a11y.status.selectionCleared",
    "Selection cleared"
  ],
  [
    "a11y.status.sortAsc",
    "Sorted by {{column}}, ascending"
  ],
  [
    "a11y.status.sortDesc",
    "Sorted by {{column}}, descending"
  ],
  [
    "a11y.status.streamScope",
    "Live data"
  ]
]
const preservedResolutions: readonly (readonly [string, string])[] = [
  [
    "replay.shortcuts.seekBack",
    "⏪ −{{n}}s"
  ],
  [
    "replay.shortcuts.seekForward",
    "⏩ +{{n}}s"
  ],
  [
    "pwa.cache.regionLabel",
    "Cached data disclosure"
  ],
  [
    "pwa.cache.offlineNoData",
    "You're offline and nothing is cached for this view."
  ],
  [
    "pwa.cache.cachedUnknown",
    "Showing cached data. The capture time is unknown — treat it as stale."
  ],
  [
    "pwa.cache.cachedRange",
    "Showing cached data captured between {{oldestRelative}} ({{oldestAbsolute}}) and {{newestRelative}}."
  ],
  [
    "pwa.cache.cachedAt",
    "Showing data cached {{relative}} ({{absolute}})."
  ],
  [
    "pwa.update.requiredTitle",
    "Update required"
  ],
  [
    "pwa.update.requiredBody",
    "This tab is running an older app version than the server. Reload to stay in sync."
  ],
  [
    "pwa.update.availableBody",
    "A newer build has been downloaded and is ready to apply."
  ],
  [
    "pwa.update.unsavedBlocked",
    "Reload cancelled — finish or discard your unsaved changes first."
  ],
  [
    "pwa.update.applying",
    "Reloading…"
  ],
  [
    "error.forbidden.title",
    "Permission denied"
  ],
  [
    "error.forbidden.message",
    "Your account does not have permission to view or change this resource."
  ],
  [
    "error.timeout.title",
    "Request timed out"
  ],
  [
    "error.timeout.message",
    "The service did not respond in time. Existing data has not been changed."
  ],
  [
    "error.unsupported.message",
    "This feature is not available with the current server or deployment configuration."
  ],
  [
    "error.unavailable.message",
    "A required service is temporarily unavailable. Try again after it recovers."
  ],
  [
    "error.request.message",
    "Review the request and try again. No changes were applied."
  ],
  [
    "table.genericName",
    "Data table"
  ],
  [
    "table.selection.deselectRowNamed",
    "Deselect {{row}}"
  ],
  [
    "table.selection.selectRowNamed",
    "Select {{row}}"
  ],
  [
    "browserNotifications.toast.alertTitle",
    "TeslaSync Alert"
  ],
  [
    "browserNotifications.toast.exportReadyTitle",
    "Export Ready"
  ],
  [
    "browserNotifications.toast.exportReadyBody",
    "{{filename}} is ready for download"
  ],
  [
    "browserNotifications.toast.exportReadyBodyGeneric",
    "Your data export is ready for download"
  ],
  [
    "browserNotifications.toast.exportFailedTitle",
    "Export Failed"
  ],
  [
    "browserNotifications.toast.exportFailedBody",
    "Data export failed. Check the exports page for details."
  ]
]
const producerHashes: readonly (readonly [string, string])[] = [
  [
    "web/src/api/hooks/useWatch.ts",
    "6e53a174aaf33ea3dc4c3cbb819d1b95515a7b8fda0e3faae35ec8288415ec95"
  ],
  [
    "web/src/components/ai/AICrossRuleConflictDetection.tsx",
    "11b56e655045f0f30d4408b272215a75f9aa8d9a1c8f6a6d841eb58623133def"
  ],
  [
    "web/src/components/ai/AIFeedbackQueueTriage.tsx",
    "48394840c2887ae18242c1dfb67fe352eb5dd519ce22d4a82c00edde601ac1b5"
  ],
  [
    "web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx",
    "8940d60ba8fd4a98d6dd86998bb46769ed1c11ff81044e7aef528bc13c58a36f"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "dd97b4c383e61514a15fe92ec6d2950995582c3a9b0c5ac8dbe1b97fac66b570"
  ],
  [
    "web/src/components/ai/AIMLChargingCurveClustering.tsx",
    "15f4f013b45e03ab826abfc0461c0e1610e608c1bfd724496a3ecdd8f60def10"
  ],
  [
    "web/src/components/ai/AINLAlertBuilder.tsx",
    "c0e1ce32bff87d25bf7da8a262603ab6f0c17e19d0cf667fc8c797bbc698c248"
  ],
  [
    "web/src/components/ai/AINLDashboardComposer.tsx",
    "fd995f9a3b18698febd9ae6783099f4efa080bb7144d2fa07a30fc141c6b03ec"
  ],
  [
    "web/src/components/ai/AINLDriveSearch.tsx",
    "0c3b24dcbf7bedc19fd436bf1d13853c3ef8a216bd3b50a1924ca73d8e0373ec"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "fa8b9912fca3883d977ba1121581699cd2ca6fbd2eb5e7f3667297360a1556c1"
  ],
  [
    "web/src/components/ai/AINLSearch.tsx",
    "364dca048b9f92794c5ff31bc4dbde5cca1b5a6236fd8d7974cc6c08f5214029"
  ],
  [
    "web/src/components/ai/AINLSqlPlayground.tsx",
    "ab52adf86e91d3c92e7fa73fb54a8307bd35a432e9ce4a07a16b3f318e633e2d"
  ],
  [
    "web/src/components/ai/AiOutputPanel.tsx",
    "c3bb5766576f4e80b16762122d2ee35038a9aa7cf6fe96df426269fe07e3c8a4"
  ],
  [
    "web/src/components/ai/AISignalExplorerNlFilter.tsx",
    "859456c6c5acaef9e755c159b91a645e4cb8322e6278c5e4d7c7ed1553b69a8f"
  ],
  [
    "web/src/components/ai/AIYearReviewNarration.tsx",
    "6e6109bf1e52bdd0a95a516b15df47665758f2d188de8f7f53cbc722e332c14e"
  ],
  [
    "web/src/components/ai/ConfirmDialog.tsx",
    "aec0adf7c45264772751b4feece45bbeb6c2861afa15182581d59b2c8872957c"
  ],
  [
    "web/src/components/charts/ElevationProfile.tsx",
    "c41a852c872af1264ae9df6e681ed6a8e786f65aba9b33b43d2782bc6ef6ad5c"
  ],
  [
    "web/src/components/charts/Sparkline.tsx",
    "ec7c1a0f7ec52bfb5e90375c0364a2a805598589a47901c97f4f6834ae666c2c"
  ],
  [
    "web/src/components/data-display/BatteryDelta.tsx",
    "76ff421b7a1515da36ea4d44009ccd2e43a760ae9bacf7ec33da310dbd6036c6"
  ],
  [
    "web/src/components/data-display/DriveScore.tsx",
    "dff64bb5fc60a41566b7b74329ee6e05d963443942c50b919bf7663934f3609c"
  ],
  [
    "web/src/components/data-display/LiveIndicator.tsx",
    "562f7877eb26d4c8e438fbed1c649371cbcdb4d633b6de3081feb0b6c03c3e3d"
  ],
  [
    "web/src/components/data-display/OperationalNarrativeDetails.tsx",
    "42d86533a953d9ee7c25e933fa7200890a420ee31868fa515f01d89b4f0e6fa1"
  ],
  [
    "web/src/components/data-display/PlaybackControls.tsx",
    "5f77e4f4a7271fbf2b913d1542833944e535e0697ca16168e345c71ac8fc8dce"
  ],
  [
    "web/src/components/data-display/ScoreBadge.tsx",
    "088d51e2aadd3c80cda379c48a73fcfce7e4de7228fc70b92c77665fa411a40c"
  ],
  [
    "web/src/components/data-display/ServiceStatus.tsx",
    "46bb1a71acc86e6327b34286e3decc70d09fe4bbd1a8a7be47838a9c8a1081ef"
  ],
  [
    "web/src/components/data-display/Timeline.tsx",
    "1acf2206f830d56d2a8e7a9a329c34e92bae5d2eae6696a5d55dd18d4b9ac92b"
  ],
  [
    "web/src/components/feedback/ActionableEmptyState.tsx",
    "4c56aafd8368e01b576409e4d96fe816363eff7cbb01cac3111e6b4a06c8582f"
  ],
  [
    "web/src/components/feedback/CachedDataNotice.tsx",
    "47dfb36dca087620dd5f022d2fb96b960fe3af57e839a896c205936b0ebf2373"
  ],
  [
    "web/src/components/feedback/DataStateNotice.tsx",
    "d96d4e5bc8c1b8ccbddce808bfc31a277dad60b82399d14431b7185e94bea4c6"
  ],
  [
    "web/src/components/feedback/ErrorHelpLinks.tsx",
    "5c9d38071267044e62e0c5446cf1d18ca616a613544189659af714d21d19caf6"
  ],
  [
    "web/src/components/feedback/InstallPrompt.tsx",
    "c4608db7b2417b84b8b809c36730c592bc00d986ccbbe01e9c73a8a30a096dd8"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "fb08c71f602f97ffee4299a8144c724d95ceb49297d5123cefbc95ad3ca7c208"
  ],
  [
    "web/src/components/feedback/OnboardingWizard.tsx",
    "24b7c7518e8d3fd798335ea65fb83fe3abbec0935467ac5681b388fa1af5163b"
  ],
  [
    "web/src/components/feedback/PermissionGuidanceNotice.tsx",
    "ddd6f3643b06c29092f62dda80f904f37f70e91a24bae59d2c1848a8a7c0b398"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "d11d22e8654e6223946df9f5c921de719daaa635ac5a82ecd659543d0fc82950"
  ],
  [
    "web/src/components/feedback/RuntimeHealthBanner.tsx",
    "7f3acc38be33ff743e408e31371cddc6196d145b836691b798929b265bc991ad"
  ],
  [
    "web/src/components/feedback/UpdatePrompt.tsx",
    "a53b333c0a5c6939c628a6a09687cd4a1b688fad88adecc79b1a7eb38d9e1fcd"
  ],
  [
    "web/src/components/feedback/_StatusAwareError.tsx",
    "1b02ed9b09fd8befd1f0b38fa6b4957749874856ec6eedb5963b7601a6d23bcc"
  ],
  [
    "web/src/components/forms/RangePicker.tsx",
    "040141ea650ef6008891cf013bdf493be29303b2b55ff49594a6dca1806d2db3"
  ],
  [
    "web/src/components/forms/ValidationSummary.tsx",
    "0497ec9eac4b74299a1667567fffd05001bdbab2e28fc0fd888ca7d8a88b897f"
  ],
  [
    "web/src/components/layout/Layout.tsx",
    "3afab237f538c2e32c1df4f1c45ae0fc166f227c6a26918e18b55cec15dae150"
  ],
  [
    "web/src/components/layout/sidebar/AtlasPanel.tsx",
    "da1664441c8b9d19d054d33c2a006b293a7066ac62e3694400b74573fd673bf6"
  ],
  [
    "web/src/components/layout/ThemeQuickSwitcherPopover.tsx",
    "c1d44325aed1ecac84db36586a79b7410825bc38d9bc8076940c089407c4731b"
  ],
  [
    "web/src/components/motion/CarAnimation.tsx",
    "b7e87d9902360634f659d74de39c3af66706b21ec8761009e36ddb9c6d5237ad"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "b3d53ae1df6ce4d4a933f69d613d51465a64ab3b0df5ccbc4eb42c0f5c34f00e"
  ],
  [
    "web/src/components/ui/CommandPalette.tsx",
    "482f84bdca352ccb17c408886d42f87997b316908890e74ce432dffdeec30444"
  ],
  [
    "web/src/components/ui/DataTable.tsx",
    "eef15edca203228af9fcff6472800d986cf8301d942fb1bcfa2da689238bc7b6"
  ],
  [
    "web/src/components/ui/Drawer.tsx",
    "f4e17ba0f8c43c4c567fedf3cb17d3e7f27ff13b2219f45c9bd62cebe1f7f72d"
  ],
  [
    "web/src/components/ui/GlossaryTerm.tsx",
    "36b833c69b086281dd9476a3a23708a6c04c38f4766b9c0d32da66d191d1c858"
  ],
  [
    "web/src/components/ui/MobileDataTableAdapter.tsx",
    "896c31a06a24e6bc6ae5041e7d0f7e14d1acd90da9d9215e3db5193366ac4494"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "0f18bf36849ac8830f5141e89ce229e6e2afe1fdebb6741741368ffab147a2e5"
  ],
  [
    "web/src/components/vehicles/VehicleHeroCard.tsx",
    "30524233d7fc748b17223dcfe180c38890956b3ea00346e9d4c2072a8c463b70"
  ],
  [
    "web/src/features/admin/components/ApiLogsEvidenceTable.tsx",
    "22479e23f692085bc2e3989036361afec9b665a77205286356ca98e761f519fd"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaBreakdown.tsx",
    "152b481fde2a0ca92da971ce339863921a98848722393f212fed6874e1c61a5c"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "84d1d4850bb5c51e359189253d64be6256495770d6dd734cb81551cf51f17ab0"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "9046a28b111e823989b4e31fe59d60de2ec6f843eb60337de95c5db02ed89f89"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "27980ffecede10e2fe4dcd45b8a37c052946df8ab3f29f19791245861dcd5302"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQueryAnalysis.tsx",
    "8e8bc84ed53beae9c0cfbdbdaa1f27a7b9aa2c270e23167bd66d53e89add4e07"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "3dd86304e42853edacbaca0c6b0a6e625c2bcbbecc97b861e7570d93fba05190"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/VehicleCostTalkers.tsx",
    "fa88c311164531e0f48b2f868fdd1b4b2d466c974c563e930090746fd5fbbdd1"
  ],
  [
    "web/src/features/admin/components/continuation-admin-2/AuditExpandedDetail.tsx",
    "8aeaf2155247356c63cedc6cdeab715963499a0db92f300c6be063e3824d7ff1"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "9989674096f27c783b9bb89800411414beb33bd843d426b8d375617ba461c1c0"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "8cda54e56cf7971c54c2fa7ad0d735c6c83d4136d3888af9a675246a7d5f9fd1"
  ],
  [
    "web/src/features/admin/components/devtools/FleetApiSection.tsx",
    "8adc0eb4cb1475c52fa5096bdff16e7c5dc66618282cdf2b5208b85975705e49"
  ],
  [
    "web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx",
    "b855980c70dcd5be4c3b5a3df29de6bdaa7da191cc922b3cf3bfa9f26aca49c9"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "f85684ea7ed31db1a54a479ef9b6048f892f9b233f406e4e0f47666bc65a0e6e"
  ],
  [
    "web/src/features/admin/components/devtools/ReferenceLinksSection.tsx",
    "a89d40eb0cf75a4594bf5e14042db2d7241fa1f2cc08cfa703070d5bc006eff0"
  ],
  [
    "web/src/features/admin/components/devtools/tools/Base64Tool.tsx",
    "88622040928259acf53f4f24e00bfc2f052553ef04faeef0b1745755d93e56d2"
  ],
  [
    "web/src/features/admin/components/devtools/tools/JsonFormatter.tsx",
    "5bd615f7a25082d056d1c34c8d7227246ae2c28bbf1f0c2a6f115d38aaa890f5"
  ],
  [
    "web/src/features/admin/components/devtools/tools/UrlEncoder.tsx",
    "d33cc69678f55da34e44ff125ba4758e2f5e60d637254868c8119b2561c98720"
  ],
  [
    "web/src/features/admin/components/dlq-inspector/EntriesTable.tsx",
    "e8867d81a6481ea656f3f9ffb0c694e96bb5df69e1e984f6fef30450e18e322e"
  ],
  [
    "web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx",
    "08d231d8e4b0522c31e82572cccdbf24a5ac1bd9ec9e4afd2f9bebebfe7b65b6"
  ],
  [
    "web/src/features/admin/components/dlq-inspector/ReasonBreakdown.tsx",
    "5573f09d670019bfed8f11e8489c0f75ab4dbfd5fcabe74743f1202472d74561"
  ],
  [
    "web/src/features/admin/components/feature-flags/FlagCompositionPanel.tsx",
    "17cd7a14ef47ef627513931baed4391fbb68a532d555aba15a31f8e3b10aae98"
  ],
  [
    "web/src/features/admin/components/feature-flags/FlagsTable.tsx",
    "6c8b043e22f429232bcbc02b3190057183250d1fb3b11551f83c02be997e0da1"
  ],
  [
    "web/src/features/admin/components/feedback-queue/BridgeStatus.tsx",
    "664940340e0576622087f8eac10ceeeb16980f8230983205278ee26dfe33e20b"
  ],
  [
    "web/src/features/admin/components/feedback-queue/CategoryMix.tsx",
    "10d381dfa635385f456de013a306945d932807880d98f381420cf93c570cd0e3"
  ],
  [
    "web/src/features/admin/components/feedback-queue/StatusDistribution.tsx",
    "580baa7f2ca98a565572292480efb074764668e9575689c30da89158100110b0"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRArtifactDetails.tsx",
    "b93078e136c5244c616bd76e55670571bd898a90913521b65eae8e68e8932442"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx",
    "2ca099152440e348137abb0bea9f3898c8d97b7d12b2b06b22234cece18d75b9"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLifecyclePanel.tsx",
    "d22c35fc3a0232c32fe7dd6ed42a7f1e25063b1e87bb777167ca9b7ae4079f51"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx",
    "88454b36e31482fb037eb8e3e295fa9855e2fb7bd45fcf2e6258c643bf7682da"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "1da3fe1e95a69fadffdd440e275d7e03afa1f27dd8e60d35eeec3f852ba19edf"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayHeader.tsx",
    "ff2ce874b17adba4a4bd3531f2d74bc964b36af99afdd8237ad98183446df964"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayTopFields.tsx",
    "a3e7d85aa6d4af302ef9b6c7288903caf2691f941441184bd572043f1c0ec8aa"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalKindBreakdown.tsx",
    "52225c51bea4b2a9b0160c7e7e903f073f34f1a06e085984647a2e5c6b038f5e"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalSourceBreakdown.tsx",
    "397e1f674fb7cec0a627609815e9239e6aaf6f742e86c128a78f67a28512aee4"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/AdminSummary.tsx",
    "ec9473b5cb1fe90178ffe38a38bcd5256686cdc1e339dc90b343fff039bf4763"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "917fe38b0873d24f33674c1101ba184bffe6375f8f09c1f207185839bc67fb92"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/FleetAPIBrief.tsx",
    "1803e81d147264f4fe27c092dc0156b85d7969725aa5ecf5db1abd12d3bdd142"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/GasPriceBrief.tsx",
    "f0a4c3615c01d8fb47d2f11ecc482a86ca41a606cf95997a4a5f0042ab26140b"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/RbacOperationalBrief.tsx",
    "1f296b79a02ddf12113117d7abfaf9e57903cefbb08049c4d68d2d24d44d1d12"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SecurityOperationalBrief.tsx",
    "de9cd866336e773c741f9acfdf34123207ab612e203cfa6144c2e16936cbde64"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SecurityStatisticsBrief.tsx",
    "84be38e513b68efc69be1469cf8038b04f7ad1011874458e2d36e14bfb7b81a4"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SubjectsOperationalBrief.tsx",
    "db58ed13132731998dc41c589498c405842a51feea874a192fc95a442337a3d6"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SystemOperationalBrief.tsx",
    "8747c2cd5022ab6a2db47d5080b961aa4591bffb6e531daa8b9d442231d6dabf"
  ],
  [
    "web/src/features/admin/components/ResponseViewer.tsx",
    "f1ae23f047ad81c3152a338a97d249b24882af2454155b77a3180e46d8aa88ce"
  ],
  [
    "web/src/features/admin/components/security-access/EventTimeline.tsx",
    "cd1aa7d5d804547a16ad131d4a9507939dca10a241a1a799df7d8cd276d7be5d"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/CoverageOperationalBrief.tsx",
    "52daa49ce186a4f36cc685dfd0dd1ab1fbc1c078037d389bebf40e13a3146494"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "0e708be19749d885661c76042b79f114260da15f5e49ce180569736105e5361d"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/ingestMetrics.ts",
    "bcf74e7b4c81fc3fcb7182c76f8033ee965e4fef95d9afa92660cb02d1ce3fad"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/IngestOperationalBrief.tsx",
    "b2afae1799615f78c50b6a0dec1694af5867f5c9534c854245192b919217f0f9"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/redisMetrics.ts",
    "9d6a2f7ad6a7a205cc3d9d0f49bb81fec9f5d7b8d00acb55797290b6fb488ca0"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/RedisOperationalBrief.tsx",
    "9612cb239e77dc4668b2d02bbcbfb644f9259087ac2c7b406f01673c33698e3e"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "152c6cf2cc9ffa0926decc00675514572f9f85fc152fbeba990883d8db5cf24e"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/auditLogColumns.tsx",
    "1b158f1e701a7ddef754166b3c5bfbde680316e35cabae57863fae7fd4e6c931"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx",
    "5b0422ccae0ea6f2c65cdf26f71a77046da32481441d0beecf90c0eb82b22592"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogFilters.tsx",
    "33abb60493842051a978e9871562e4f7ef642fdffdae420e16817b2b766b59d3"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx",
    "32458e93f758a1371f689559803abd24dc08b78e3ee1af0a913f1b86b755c774"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIConfiguredEndpoints.tsx",
    "3c61cb3244c4e4cebc1b1010aee4eacc79c1b8272b21beafb13e3b2ca2fea1fa"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIEndpointControls.tsx",
    "6efde8d09d884bb7677abec3f0e96e54465a876a5c03b10bc848530f1f77c7dd"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIPolling.tsx",
    "e6fe2182f39eb0e5ef1bd4b5141ff6b4fbe5fa67daa7a9181861e67b3d157b65"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPISummary.tsx",
    "05409cb4e58a6e0bd3f557fb5e9e20e4ee5c3c38e65703d41930a4bbdec20e89"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "3fe8452c93577d9b1b0357c98ccda5d8288357dbb9561cc9b3bbc0a80bb2e95d"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "265d21f38061cb943251e46bdbc944dba5d02417a06e8d29da7f1dea58dd5ff2"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationOutlook.tsx",
    "3044709c1810deb4ea8688eb7503e16f7294c978e05ca9ee7ba721b4021602e4"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "4c460e89eec5456144351d9e15460429c30caa5473fb212ce60131f0b97562c8"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "e62e9773ac5e5f74ad1a9f4148d95f28f724fc7e546a2f3449e393be6e71bc84"
  ],
  [
    "web/src/features/admin/components/SubjectsTable.tsx",
    "3f6b6b1feba43096ec76a764ec2e4bb6c9203604752a91c41069404fba138586"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/CostByVehicleChart.tsx",
    "473e42930dc1fc7b49506fa9cb9af0a425fcb1090d706d362ab6afbb55634d09"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/TopTalkersPanel.tsx",
    "842952aa09a8dc55f2c3c59e2ee98058ebf7a8427b68aa9bf692f5b193cd98f3"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx",
    "b092c14fca59ce22086b3b0beedb336bf19ae080d65e8cba89cbc8006caf990d"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostToolbar.tsx",
    "fae2fdb51bb430e32c859cb9eae997d075d5f5ca9e1b025d75c15b8870e64e7e"
  ],
  [
    "web/src/features/admin/hooks/useAuditLogPage.ts",
    "9e127969f57a66c1d5442d5e95846647d8afdf222fdd277687261e85a5258795"
  ],
  [
    "web/src/features/admin/hooks/useFleetAPIPage.ts",
    "1a4147934738a14460cc9f80d87ba0ead300dae6a074b0800b4873df8b1a6646"
  ],
  [
    "web/src/features/admin/hooks/useSecretRotationPage.ts",
    "e061b6a7e3bfb58ab3beab58dba5e3636d5cba0d8a81f975ecf8bc61a08caca3"
  ],
  [
    "web/src/features/admin/hooks/useSlowQueriesPage.ts",
    "ae1f658ca06bacfb1a5e7014dc3aed79abae4fe43f498fe0b39082c6f68bf5d7"
  ],
  [
    "web/src/features/admin/pages/APIKeysPage.tsx",
    "8e67a7a9e9768d7a89b78b2d824ce7211d56ceae1701d0c996afa9d26fd85ded"
  ],
  [
    "web/src/features/admin/pages/ApiLogsPage.tsx",
    "20779ced6adbedcaa956b5d434bb882eefc6bcc7981caf8fd9a38ee54485f6f8"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "b58614b7ec1860e47a5171818f849c5b6b60ce29ec6edfef484be943c6e09e36"
  ],
  [
    "web/src/features/admin/pages/AuditLogPage.tsx",
    "9972403c539d1b29c7387bd963cca1623731bfc6b61600e13434c89f882e971c"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "31f0d43d6a6a9e900e854c89204f729bfc7bd9280204c9254aedf49ecaf437dc"
  ],
  [
    "web/src/features/admin/pages/DevToolsPage.tsx",
    "0484e9f3dea41c655fb8135b180cc78235a19f9de2f17bce0526fff66656b079"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "ec6b5a15dc04dbb2480003d88ca0c0059b116e3ba76e37169fb274102fd23fbc"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "199a807bb19aa1f24a0022095a5832619e63ae3930924631b3bdebba700067c8"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "75abd06ac57b9062345645a0479f9dc2021f0ae3744e572bea3273278fcb9f58"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "0fdf99d1744efc671f71968d136b6c681c9dc9d3b74ded91a59353b7e3bc058f"
  ],
  [
    "web/src/features/admin/pages/IngestXRayPage.tsx",
    "a9553faafb570e4b9bd05a63f432ace6a890fac013a5f863795e62addec01570"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "76d5265b96859036f6d5e8fa9b24a8f62bc4a4679330ca7fe769c5dabc24ff65"
  ],
  [
    "web/src/features/admin/pages/SchemaDriftPage.tsx",
    "cf6c916097140bb66e59357ed32b81c9f04a2ef6adc501c3082db47636e31eb4"
  ],
  [
    "web/src/features/admin/pages/SecretRotationPage.tsx",
    "1046cf7ef0a9f254000c0d6f75459c7011f59220af4ea87975beb43d60c308c8"
  ],
  [
    "web/src/features/admin/pages/SecurityAccessPage.tsx",
    "d6ad757cfa86f323c8ba6887288f51991a54d1cc2c7def0c7e07e89068368ec6"
  ],
  [
    "web/src/features/admin/pages/SlowQueriesPage.tsx",
    "7e46feb9ee84d959e65050b47de94e3d0ba439940e488e6da8ec53d7e6c197b0"
  ],
  [
    "web/src/features/admin/pages/UsersPage.tsx",
    "33ffca4c467da9a57f094d07f3ebeb795cf8f1be7404e4b885f9f2bf9b9ebbd7"
  ],
  [
    "web/src/features/admin/pages/VehicleCostPage.tsx",
    "e4c1958af7b0502058a2487fef538fd967833808b8a0ea5d8d7d710f36689bb9"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactChart.tsx",
    "8029a704b1260b5b748809c84dd68ef5dcaa1eb7de8040d59425e6bdf7368aa0"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactDetails.tsx",
    "c0d2b2dd92f9939006e40902320568b5b7d162fdb52d23dde06318ee19645900"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/DigestOperationalSummary.tsx",
    "a9f430c5dabea94ea68569a630180e71bd6a6929699559482318e0a343ee2378"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "72d23d2cc77a607bbd5f1b64911f02274bc31de676eb31c7e1c8965d4f94a343"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx",
    "fa808985daff4437ecc55f8fedc219ea99e705bf733505a0de0df50897647f8b"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "9bafb575473e899bd644ef73ffa8c366fa9466d137f8de86c8dc122c1b786667"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx",
    "8b15a7161412faab0c5ea9fb3f040b9b8fc1a44d0e708e68a19c1aa53d778715"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostEvidenceLedger.tsx",
    "360b99b0169bcb9ff3bebf917f66745cd239d3743c610739b4ac07e7c21f592a"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostSavingsEnvelope.tsx",
    "9a84279693da9e0ec20ad9fe85d89a1e0964bc3f9add720ba7b2905d4eb398b6"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearEnvironmentBrief.tsx",
    "f9213b326e23558e9c3d67b6f3ad516520281b6359c7e7765f4523d94eb45faf"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearPatternsBrief.tsx",
    "0d88c4d94fd4e6f155ea67297913cca2665889437afaad9b8a6b4fc830a52d1d"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearSavingsBrief.tsx",
    "d88bdbebba561bd5b6a16080e73b39d00031e8f7401b46ca8dbe298183a14c5b"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "22e40adb9269646abdf36ffa6c6d10025d3b626728b059b42a4fe83e0e7e2014"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx",
    "cefad153d66f9bf5c0bd482933c2f71dbc3077d52c0246cfe5ef724eda4425fa"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostLedgerColumns.tsx",
    "b313418db025ba517a417756ddd603c1caf985c792d63c1519c1182e56c5844d"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostLedgerForm.tsx",
    "2e2befcd0424f0b155acf4525e9e1831733a2556e351501b53c2e90ae099d956"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/ChargingSection.tsx",
    "d179ded3917878ed355a0e970f2768c3b5191d4ba31cf132c7e8b4a29c42d938"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/DrivingSection.tsx",
    "6c8987616039be67cb104f4ee5a42c44aea0a31f0a8e108ad195ea3fe14e359a"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "75292facaf9959e6b34fb611c35eb3000d636127b52d566de1f5b999eb070cd0"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx",
    "5797495d12a88e2bb505ea84a2462e1b5fec2b435564114ed953f313f571d7b3"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/useFsdWeeklyDigestNotification.ts",
    "6186f1239ae4a207af898a9ec8a344f8b6bdb939f1f2f80d522a43615800d364"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/ChargingPanel.tsx",
    "0ea4cc4c0492d6a020942e1d00ae7d11807ff609d99c1d2ed182a4855e2395eb"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/DigestSummary.tsx",
    "d419868634b36d21cc732d3268cdcf89b0c7e0025cfb27d0448188fab3c4da6b"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/DrivingPanel.tsx",
    "9b28c51e621cfeb56508f75cbbd21d747e97cb4039bd9af4ecf4083efd7e84e0"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "b6f003455e285c218fe4993f5b88dd0ad5a100ee61e6ef45dd80007a49f44c13"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "c3810f79434f4d30470fbecc42b817e70d56d299d14ab151212a2b458d3f3534"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "8d29e5cee5fa1b3e8d5fb2e5ddc25d35e5c30b0664b1ed24265c9dcda3a4ed77"
  ],
  [
    "web/src/features/analytics/pages/TimelinePage.tsx",
    "cc814c7a816a49fd97d83ca6aada48a2a408334b1d1747b02305f41edecc9a65"
  ],
  [
    "web/src/features/analytics/pages/WeeklyDigestPage.tsx",
    "765aac23ab86b1fc38d38f4cfe991999cead181bfea8244f9b6ea54e55a27686"
  ],
  [
    "web/src/features/analytics/pages/YearReviewPage.tsx",
    "13a76010933c80357e13178f50d451ba002c56397bafe15747aa71913c76c7a7"
  ],
  [
    "web/src/features/automations/components/automation-helper-source-closure/ActionCommandFields.tsx",
    "30faf35b711296a06c18a077c7c74e644289a4fdc95427c1338f1460744c1a61"
  ],
  [
    "web/src/features/automations/components/RoutineWizard.tsx",
    "cf77ce4fd5e44e77a4cda626181123ff0dcc6bad2a94f7a54f6677e36cfb3dee"
  ],
  [
    "web/src/features/automations/pages/AutomationListTable.tsx",
    "b3944a7d4f23deccdcebd0de95cae012abe2161e14fe62a5772591c166194064"
  ],
  [
    "web/src/features/automations/pages/AutomationStatusPanel.tsx",
    "97c38ce27cfbdaf2882f383bf2dd8c91a98ae117eebbdb18d83f93721b454c76"
  ],
  [
    "web/src/features/automations/pages/PresetGallery.tsx",
    "6b32bfb995a8bb4b0212d3e08ed83dd345bd1f557c11ed19e86432925d337af3"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/EnergySiteCard.tsx",
    "c99ad3efe1a0db54c54650f965850042cd8adf9c30e198307bd201e8c040170f"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/helpers.ts",
    "6efc05a3fd16f10cd0c6483e269ab5c8b650f0639dae590e7b9333694ae7e528"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/SiteInfoSection.tsx",
    "518346f684542ab013562094003dfe062a2b0a56e9c333b797c88e192d2ba568"
  ],
  [
    "web/src/features/battery/components/modernization/HealthQuickLinksPanel.tsx",
    "3ae794513986dcd98c1cbdc67688af8f3986b6e2047b38f30f82e91350f35a5d"
  ],
  [
    "web/src/features/battery/components/pack-capacity/PackCapacityFitDiagnostics.tsx",
    "79af6f1fa0f09e0cd1411f4829c6c1fd56d7f2f3780c441456627851d7affb0a"
  ],
  [
    "web/src/features/battery/components/power-flow/SolarChargeAdviceStrip.tsx",
    "8d0cf84c64d3971f86cf75239070ea5f47f0e78474e14d7980739b3f65cf434a"
  ],
  [
    "web/src/features/battery/components/TOUSettingsModal.tsx",
    "0d1568ab1c3b35fc74a2abd2567f85fec6660061283cd62daeda2742b81efe7a"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "e0b9261a180ad6a23e344e19550bea19a625b1e4b2905ad92b559cd867bc866f"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "053993d0307f5bd48457e8b81a63d96018788e2c51313a0fd397fa030a8bb101"
  ],
  [
    "web/src/features/battery/pages/EnergyProductsPage.tsx",
    "53fe89d8a57337f0c7780a4328ffff260ba7dd402cbc491ca4cb07fe4bde082d"
  ],
  [
    "web/src/features/benchmarks/components/CohortEligibilityPanel.tsx",
    "8dcb43cf8481438c0957b5ccfd54d9d87d1941483d71cea3b8592b0c47ba68e2"
  ],
  [
    "web/src/features/charging/components/charge-departure-alignment-modernization/AlignmentPairs.tsx",
    "a01d2c3bdfe2ac1e2d65c5e4c40f336828db75ee4c81c5ad52f83c4b4ce1a2cf"
  ],
  [
    "web/src/features/charging/components/ChargePointsPanel.tsx",
    "dfaffc15124e4770d912cd98669857172099a00264556f9318fd92c69f7790e1"
  ],
  [
    "web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx",
    "140ee9dff402af2b0ac1585e54d87a96908521699d6a6d117e8741db776df3d5"
  ],
  [
    "web/src/features/charging/components/charging-curve/LoadingSkeleton.tsx",
    "64d1d52516c42d81a8bde4cdc6face5187ccdcf66910a214280509f84cbfbedf"
  ],
  [
    "web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx",
    "b2e84308926c6508b7e034c8c884159393956d1d0d375f114a4bbdcbba8e1796"
  ],
  [
    "web/src/features/charging/components/charging-curve/SessionCurveChart.tsx",
    "cfca99e55bab4ad69ea06c84c2567b10a3c910aad06c2347994d36e3ab0dbd39"
  ],
  [
    "web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx",
    "6f0d1542efc302adf6c18406c990f075214b569fb21243303361d78fb3daed4e"
  ],
  [
    "web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx",
    "b7a69c5053fcc375ac3618dea6dcaeaca2294b954c0ecbc17178aac8dc25597c"
  ],
  [
    "web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx",
    "6cd8f106bd2acf8a042b08fe56b374e9d1bdc6d7ea1ad3ac4a54eb7b36cbacaa"
  ],
  [
    "web/src/features/charging/components/charging-curve-modernization/CurveSourceSection.tsx",
    "8dd9db07acc86ff854a02dd4d6d072231a1f56c58cb64a01fd34df29a82ac86a"
  ],
  [
    "web/src/features/charging/components/charging-list/BatteryLevelChart.tsx",
    "cf0f42b79a7ea673a6d7af3da9dfc01f09d06c6e0e8cf91a9488ed60f9ef9d77"
  ],
  [
    "web/src/features/charging/components/charging-list/ChargingInsights.tsx",
    "3658f6d7dedeff5e1d9527f5f91e0aeef4017d4500e05ec01b45aea7fd06e4d0"
  ],
  [
    "web/src/features/charging/components/charging-list/ChartsRow.tsx",
    "79c5d3fc6c2ab6848f26ab33342d31a450e3630314622852065f760645002eeb"
  ],
  [
    "web/src/features/charging/components/ChargingEvidenceTable.tsx",
    "c0273316b6f8862e89fb2752692139a40a0e3ffc2323b75af92ce107f2af321b"
  ],
  [
    "web/src/features/charging/components/ChargingSessionCard.tsx",
    "739820fbd31fd4c614a6e7fc74b43bf06dc4413029b857ab594167dd0b92af6d"
  ],
  [
    "web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx",
    "4fbfa8f0544c06f5f1f3599355d200404aa38b71ac021970c05cd49408e34974"
  ],
  [
    "web/src/features/charging/components/cost-analysis/CostForecastSection.tsx",
    "89f615f9e039a8175962e2949d9d4ef3081ff8d9063e7158b7bce135535cdacf"
  ],
  [
    "web/src/features/charging/components/powershare/HoursTrendPanel.tsx",
    "cc95b4959b21538418eb3d1a8fa9222ce96970a0129429fb00164d104d5b03b0"
  ],
  [
    "web/src/features/charging/components/powershare/PowerTrendPanel.tsx",
    "241f723bf8562880b6ea6c4ff4570eecd2ddc0e417c44758539f6e1a13d93f4a"
  ],
  [
    "web/src/features/charging/components/powershare-modernization/TrendCard.tsx",
    "056838f47b087d26c2e9a9845546751dffb557932f479f0eaa72ad78289f07bc"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "fcfc259ac0d4e2c82122afff2dd5badb01453bd6798937ec24dfcde2bd9a2231"
  ],
  [
    "web/src/features/charging/components/SitePriceRadar.tsx",
    "97328036b594bd0d515bc2e646a56faa8cff832db8b776dbe56d7dbff1175685"
  ],
  [
    "web/src/features/charging/components/smart-charge-modernization/ChargePointsCard.tsx",
    "247dd0cdc587bdcd8e75f4fd310f0e4ccb8f44a0e2a626609cd8ca2bbaba9022"
  ],
  [
    "web/src/features/charging/components/stat-modernization/ChargerTypeBreakdown.tsx",
    "6ce97403e764091f3796676cdaa149ea9a19235e68f5e8c5a7f76dcfc28dfc20"
  ],
  [
    "web/src/features/charging/components/stat-modernization/CostForecastSection.tsx",
    "d8fccadcbdcd602aac7ec1f74f1d5dc25f44d5a42861f08d004f6a4a97dc1ace"
  ],
  [
    "web/src/features/charging/pages/ChargeInterruptionPage.tsx",
    "c965bde52381d6365a15327b61bad9d186a89bbcb5a1fb0b23cddf38048c80fa"
  ],
  [
    "web/src/features/charging/pages/ChargerResiliencePage.tsx",
    "c78331edb8d577b64501fc86960183473fba899680af375e2967440f1843b84e"
  ],
  [
    "web/src/features/charging/pages/ChargingCurvePage.tsx",
    "d4dfd5e9423a8d8750a94b7d853ceac204ff9ebd19501f1b30bb816120a7a18e"
  ],
  [
    "web/src/features/charging/pages/CostAnalysisPage.tsx",
    "ca0b8f26a1a976b184fc1f1b3e9749bb54a24bbad1b428ec5c783992af7bd3a1"
  ],
  [
    "web/src/features/dashboard/components/DashboardSettingsModal.tsx",
    "b2d7e8b7d6ac32e7ae5616c441ab1d775a31a5fcc13b8b87c08523cf09ba4dd4"
  ],
  [
    "web/src/features/dashboard/components/FleetOperationsBrief.tsx",
    "6666d6c769e05312581789646fcd59f842b527af234f5ead4c80d15536cf8bdb"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "b72ce542cf27d9d45672fcd29cc69c425911cde109e979d4de00ac5a5bf0d51e"
  ],
  [
    "web/src/features/dashboard/components/LayoutSwitcher.tsx",
    "eb63238c4e8ff0357762123c8b6923f7c824e5227cc96a5274f4187f4c9e9e84"
  ],
  [
    "web/src/features/dashboard/components/MiniGridPreview.tsx",
    "86d6c4477414da59393992d47ff90a0d2d018b0019ec4f830cc637e2c3177a36"
  ],
  [
    "web/src/features/dashboard/components/operationalbrief-all/DashboardSourceBrief.tsx",
    "3b67ebdfb87fcf1ece8d3e0c0806c97dd60337d6065b2f5fe4b5fa5a2cc77d82"
  ],
  [
    "web/src/features/dashboard/components/WidgetPicker.tsx",
    "b7582be51b28343190adf69345f8e0da74509b3cc5debb9a03c851f13a42e73a"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "d9c39e2a4eb5e9bcbdcd37d71d5c3fbaa9c00aeb4d392204501bb103cd897c09"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "66b7a1c72597357df6c05d0fb0d00f8719d8d2be05a3c554c9011905941ff2f1"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "95cb004fb6c9a61dc9770e0753ec48ecd2e37aaffa242f85fd74ffcdcad074a1"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "4f5649dc56324349b9cb151712643da383ed38826c02b118de114073a0e2bbd5"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "aad924ffbdd9907d4232573e6b27f512319f56c014c304167d061e750be4bbc3"
  ],
  [
    "web/src/features/dashboard/widgets/AuditLogWidget.tsx",
    "3050da2d0a998bd0a9cadfa4cced66aa64294a57b07b8946139be7f0bfb1c262"
  ],
  [
    "web/src/features/dashboard/widgets/AutomationStatusWidget.tsx",
    "36f2d7c07d7bd606cbdf55e08d7b5141d81f64acbc009f2e971c96e39e5ebf55"
  ],
  [
    "web/src/features/dashboard/widgets/BackupHistoryWidget.tsx",
    "a7a7e54ba5b51cd62655d4ab0e0e9f3532f0b6a39b1c677e0ea2048a935e35b9"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "825110edd5a69510e5faa5233a4889c8dee223a1a7e01fc39f7895d03dd74147"
  ],
  [
    "web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx",
    "0067f1694dc0f3a9b247bda25eb46119685530b8aea76c81a82fc6f2ab498485"
  ],
  [
    "web/src/features/dashboard/widgets/CostBreakdownWidget.tsx",
    "62a85dcee18adbe1482f5180a0675aa6c92155e27b3f7e6c50d725f0cd747b8c"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "d61a74c1612c2dce465e6605a99ba79ddb52f0d4df068376cf4b01a9c1ab8508"
  ],
  [
    "web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx",
    "ec8df0e82cde8cb0aa364621a1dc10f97500a9cef70fcbe585bcf2f8f12be2e5"
  ],
  [
    "web/src/features/dashboard/widgets/DrivingDynamicsWidget.tsx",
    "79e90caec70878830173bc9bd0e39b7ed6526901fc7b6aaa321acbf26dfc2910"
  ],
  [
    "web/src/features/dashboard/widgets/EnergyStatsWidget.tsx",
    "8d5bc3451a7a70757e909878f0a3233b0d23b8510adb8e9e1ea3afbd67320607"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx",
    "510fbd727bf6d10e53c846f60488f4523e788cc9a630a0cebd58e5308d3a7953"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsWidget.tsx",
    "805b994851e1c1d36d874da93885f1ccbeb614ccfd4ee2f0d2ba45a5ec2bc2b3"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "ebede6f03de78666670495fbe393acb9c72e6849f2a0a5e647b7d69db9bd8557"
  ],
  [
    "web/src/features/dashboard/widgets/FSMDistributionWidget.tsx",
    "8924b07e9bb034649f73516ec52c6707457d36e526278ea419672cb3e3083be3"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "b39d80a99492820a377efa635502407c1a7496477da2453987a55953ba93a1db"
  ],
  [
    "web/src/features/dashboard/widgets/LiveSignalSparklinesWidget.tsx",
    "ad2ecee3524f907bdf8d4570486694e1316f4a67bda59a7af652628093975342"
  ],
  [
    "web/src/features/dashboard/widgets/LocationMapWidget.tsx",
    "ae15f3553a097c50f456641cc8f805d7d06432500e63ee4717e045618ca7ed6f"
  ],
  [
    "web/src/features/dashboard/widgets/MileageStatsWidget.tsx",
    "0ed8c19d6b114a2b10e917ba04015047d4234563bb4cdd58ddf0e95cbe086ea9"
  ],
  [
    "web/src/features/dashboard/widgets/MotorHistoryWidget.tsx",
    "afc228e9af179203a9e0d80c01f4c28baba6fa7e15a18635935aff1a7ddee5c0"
  ],
  [
    "web/src/features/dashboard/widgets/MQTTStatusWidget.tsx",
    "5341604d3c9061e7c555052e66a2727d93c3450c879de80ec4afa2e6ba498b9d"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "f3cbbbc08fd9da3f93f7e27203a47d644af9bff5468d2c96604781f825dda417"
  ],
  [
    "web/src/features/dashboard/widgets/QuickNavWidget.tsx",
    "57aa37e985e997f723989d93637d7fac51190bc806eadf2df6fef5fcbaac86e5"
  ],
  [
    "web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx",
    "c7cb8faa9e922b44f4192db434f86b6424f21e668cbaddb69eaf785a534f0cbf"
  ],
  [
    "web/src/features/dashboard/widgets/SentryEventLogWidget.tsx",
    "9e607e7b2fbecb2213b06a92dfa66dd586f8c3cd762afdc8b28ffaf5958ae9c0"
  ],
  [
    "web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx",
    "d7136257f8acfba3220afaed7ee2d27120fa8f464cc0a4b91ccb64ac8bab5ea5"
  ],
  [
    "web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx",
    "4d64952be09ee33c9c28a0e233df4663895d553e55a7aeda2113b9caef5f1af8"
  ],
  [
    "web/src/features/dashboard/widgets/shared/WidgetStatGrid.tsx",
    "edcb99c85ce22cb212cce7c8c97967f8c171fe758f40f22e20d9d60b6bc470da"
  ],
  [
    "web/src/features/dashboard/widgets/SignalCatalogWidget.tsx",
    "0e7c75ffdb4e0ebc044b5b4dca68c4b59f08ae0f008bc832b62a2cdd4425fd8c"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "58007e1d8ec9744bb11711e3f6bcaff01c83006a07f4c92b40c62429bc91349b"
  ],
  [
    "web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx",
    "e7c690e379831666111ace7c6841378d96958d3165e7c7c3494b4037e91c923b"
  ],
  [
    "web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx",
    "b4d38d7eff8ac4de5f6a68e0cd71baac71a6be4c1a42d15b3912b0e7e9c172c1"
  ],
  [
    "web/src/features/dashboard/widgets/SystemHealthWidget.tsx",
    "b71db87c98a100bf0cbf69b1e639697874a0cd68c5a04da9ba188db09b85f368"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "c9860473322be9032276de7237a4cea141083723a59c68dac5f625f52352a129"
  ],
  [
    "web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx",
    "6ad347ec3b075d466b36a7d65b4b0a88040869a0a4e31a21650e9e62cb040c3f"
  ],
  [
    "web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx",
    "fa98e794c442d0e22da616df1af4d082a8cf75ee0eadd553ae16fdd34d976e92"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklyDigestWidget.tsx",
    "b0d8fa294cd4e4126b710e6374a9fa735cf5a2b839ed2ba3f5aa621e8e4d9f4b"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx",
    "cfaa67a2ebd395b21f6fb10c3fdaa435e1f6915ed2f9cc83e1508d2f71d8c2f5"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "dcc1e47ec3026ae0b124af9aed5a6fe52bd903757c7dcc178fb17857b76f625c"
  ],
  [
    "web/src/features/driving/components/arrival-reliability/ArrivalReliabilityProfilePlot.tsx",
    "089bb3d22284ccd40c6118ecb19c0c2beef2c651a610b7eb5949ad83fe23efb1"
  ],
  [
    "web/src/features/driving/components/departure-forecast/DepartureForecastNext24Plot.tsx",
    "10cc17a51018e05786c8d07da76b6841784d7ebb781a4046e68959f4e32b2922"
  ],
  [
    "web/src/features/driving/components/destination-transitions/DestinationTransitionProfilePlot.tsx",
    "7739495e1b96e6fb2c2e4e11e0cbe0777b00ccce7ce4f9eed0da0055168b8bc7"
  ],
  [
    "web/src/features/driving/components/destination-transitions/OriginConcentrationPlot.tsx",
    "8df80d254e7a29de6309241c5ec72e2e8a0f9918fdad309dd7ccd50d79162380"
  ],
  [
    "web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx",
    "45124a29ae26f3e7a4194d853fa2858c1617a8e1b8c91c2c33aafeeb3fd97596"
  ],
  [
    "web/src/features/driving/components/drive-detail/DrivePhysicsDebriefPanel.tsx",
    "f5f861573e89001edda15478af1065d18bd3d680d1019e22d68f1ad3dd87d31c"
  ],
  [
    "web/src/features/driving/components/drive-detail/DriveTimeline.tsx",
    "aeac7f59ffee0e460a4bf22e342b96c7eb220b8782778b210e85b5864b58bf5e"
  ],
  [
    "web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx",
    "6410c792d2ea74573597986a9e7484ce706aa679be23e2703f2d2e2238b3a960"
  ],
  [
    "web/src/features/driving/components/drive-detail/RouteMapSection.tsx",
    "be0c08e12807b100cb044841f34eda0f333b0c0ff24a2d547688ac03de678aa1"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "aad9bd10462c90d3ca86d809c7de04a0a9900d9fd80d4f648bff0967566e6de3"
  ],
  [
    "web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx",
    "d552e68e3233422e3661ce82df4664856c76107d5cd137f3ad3b0919066ff6a9"
  ],
  [
    "web/src/features/driving/components/DriveCard.tsx",
    "aa317db8110b6edde309a13c12fdd025697495bdf76ab0a5597dd2bc0227c7ad"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesCollectionFilters.tsx",
    "4ded586a42696237840c14c5fc110040d2abceceac4e36f38b9e4365d7b329d4"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesEvidenceHeading.tsx",
    "dd9b3e215b3c1967d86a9b0d9796e26829974ddbf053c44290b2269b8998c580"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesEvidenceSection.tsx",
    "8a13e7a2f2f4e136f0de4af6c2823a1af67236ceff8ccbf4f042127b4cb79fc0"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/drivesListHighlights.ts",
    "a36a184848168827b8b773fb81b48fdc41cadf3578aa51c944f8c24a0700a7bb"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesMobileFilters.tsx",
    "a26f0a42793f2f25d036345e71c73b7b48a421360bcb8740ffb608b717796133"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesSourceNotices.tsx",
    "c897502f099909302233e444b6858121ffc7c2f57ec91cc8cbf136d94dc294d3"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesStickySummary.tsx",
    "62705983549f3a44b1cf3f3489e5b7ea1c1b719b07e18ef50b73c4de07883fc5"
  ],
  [
    "web/src/features/driving/components/DrivesEvidenceTable.tsx",
    "030bc25d7acfa241f0ec57c75048a26679be8303f53b7834607680b9007e7492"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthOverview.tsx",
    "5418ca3a448e89e7ee83690f4ea5a1c71cf14ff03ac53d9fc65c9bea51211a2c"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "0a2a37072c902e0148d59631c3e85739328c59b74115cd3adcaf4b825e2a0b97"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/HealthSummary.tsx",
    "79c45129cb930b2c451b716fd5c52b1a0bad6f423c68ac9d43fb8431a03317cb"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/MethodologyPanel.tsx",
    "938d5a8dc1fcf70d57fd3afb61173bfb96f7c145cd151076180712b56bf996aa"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "ea5ddbf1978495619544411d34dcd2966fa73d9fe2619e94aa02dad34a7b3b50"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/StatorHistory.tsx",
    "0adbba0c3581640ecb99dc9f3bc03693af958b3d38d3ad5818d775c1feb9e718"
  ],
  [
    "web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx",
    "79c52ae3ad243a7bbe24493a7050dd452a7e992d9e57315d37e12fa1536c5698"
  ],
  [
    "web/src/features/driving/components/driving-dynamics-modernization/LiveMotorStatus.tsx",
    "df7f310f45cb4346e7cf738d61778221465ae4aa1be0404b28cb0abf10f282c9"
  ],
  [
    "web/src/features/driving/components/driving-dynamics-modernization/LiveSourceWarnings.tsx",
    "cd330c0c8d5c78fa6e2aecdb1f651f448c9cfac7aa481f1df31eb69764dd4b13"
  ],
  [
    "web/src/features/driving/components/explorer/ExplorerKpis.tsx",
    "f1ef94e9d8dc0cf4e3de26727517468eecdd1c7300f6178ef79516ebaa36f5bf"
  ],
  [
    "web/src/features/driving/components/fsd-insights/FsdCommuteStoriesTable.tsx",
    "58c0252d44c83066c16df2be621ac75f5f0c69638f6b239d2ad57e0a8d23188e"
  ],
  [
    "web/src/features/driving/components/fsd-insights/FsdObservatoryJournalTable.tsx",
    "f266c318945fc13dee2a5270202b2323c2be91b813f8e90715b2fb1501d16cc2"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/ArrivalEvidenceBrief.tsx",
    "772b310d123bf9bd979fa14283be7bb39107385b392a70c214c78985eb50f6b5"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/ColdStartBrief.tsx",
    "f95c40d093463c3a3fec19bc46ffa06bc04318aa8bb6ff3875eb6a6b01266886"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/CompareVerdictBrief.tsx",
    "7ea0bc2518a8ce6a435a741c34fb9f226de51e67681e03c90d1c799576a48d87"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DepartureEvidenceBrief.tsx",
    "8b77332ad5b7dfe98071323a120917f605f0ad5eef52b67242d7b801b5a03b6a"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DestinationEvidenceBrief.tsx",
    "3ec5e7f375f4c658b962cf6b27eff4280d3835083d425369d04be078b61248b5"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx",
    "ae0ec996fd19ea47083dc8c066e35df26f3ef88474b44f367389b8b776a48525"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivetrainSummary.tsx",
    "87572b2c9c71db287cdcd88f20564a4dabd54887016d5a119f2ba68b176de0cf"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivingRhythmBrief.tsx",
    "b320aa6078a45388038f26dba4a76d2ced098666516f9623f8ae6fd27bddfa89"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyEvidenceBrief.tsx",
    "080826ca03b43b338309aadf0668285d8caaa3c26d993af5764640a252a8d3bb"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyTargetBrief.tsx",
    "218d8c21fd4803b6ade28a07942baf551b4be49a26029da8c3213e31af2b5202"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/FsdEvidenceBrief.tsx",
    "fe0d4703b16b5b1a777067fe029205e10876a8f2e95164b93625697f3e6173f6"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx",
    "a1bf2c4f06b023183caa74632ac903a8008a67d241b8280367ab12b1f7d04bae"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/MotorSamplesBrief.tsx",
    "9f303d02f2ce2e84ddbaa394a5a6f523afed686d29138588849ebd5c0edb7a9b"
  ],
  [
    "web/src/features/driving/components/range-buffer/RangeBufferPercentileChart.tsx",
    "07336e2416b81690bab429678534ebf0037aa74a2bcb355aae3cfda06f53d107"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "ab3f72d8e4ab46d467cbf9558231fead1defe938eb3f00dab9c246dca89903de"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreAchievementsSection.tsx",
    "326a6e7936c283373e88ce91ca4bdbe73e88b5133f0ecc72082da31eb49db590"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreChartsSection.tsx",
    "364c3573c33f7a12755cf3c4e9b0941087dc1ef7535945b8feaececd7329e8e5"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreDistributionTipsSection.tsx",
    "cd4950a6a2e1262a2ec5ee6b1a26b7d3cf64ead1bb08856344e9ec1e69dabb85"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreExtremesSection.tsx",
    "c479e528a438fd8a1ef3dfb0c154acff85f180d7605bca5cb21f83a9a93834c7"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreHistoryColumns.tsx",
    "d60b4bf2c404359b7318de9550efcfcc33b57495b761158f0fee346cd4db70e3"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScorePeriodAveragesSection.tsx",
    "072f94877b8b1b74a67335e412d6c7da2de2e88ba9b56f1be0435912c4a769d9"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScorePeriodStatisticsPanel.tsx",
    "af81076f06eb700839b422e45a609d2fd5259b439a4100d69a9b74a06457bc06"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreSectionTypes.ts",
    "8c177734d595c3acaaba30fe4d894750fc8a8f4ec044b16a3729014d291d17a0"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "071a7ba8d91387ef859321a0feb39321f0fcec561e34e417f9a09d1b97fbd804"
  ],
  [
    "web/src/features/driving/components/ShareDriveDialog.tsx",
    "db459386ab6ab232d900cb6826def87301ce1e35618bd65b8114181861c39312"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "707934305befd7c1b5d6581be1a15ff4ce3df304e56b4284568810a26e8dc2b2"
  ],
  [
    "web/src/features/driving/components/TripLegList.tsx",
    "88730187cd68b921c82700363e9ed1fe6329a7c8078f41f41b3b9d4a73e85a3d"
  ],
  [
    "web/src/features/driving/hooks/useDriveScorePage.ts",
    "07314e56426bb0f9dd31313071056f3cd5be885cd7f2ecc788ecc71974de89e7"
  ],
  [
    "web/src/features/driving/hooks/useDrivesListPage.ts",
    "572c5a7aa4ee6a4deb112a06c4c085e1d9d097f4b556237c733d27e321949e9c"
  ],
  [
    "web/src/features/driving/hooks/useDrivesListPageCollections.ts",
    "f2cc6db88156dc5179d0a242acdf777066c790f0a5a2b676063fba32dc7628f6"
  ],
  [
    "web/src/features/driving/hooks/useDrivesListPageData.ts",
    "2640e94b88065bd115bc3eaf71bb14a86701e31a4e6666647e8d825f741a38da"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "dfcde866ae7854b6ec9ce1a7f6f55d880d7b1e3ff0b56a0b98f9cd403d775957"
  ],
  [
    "web/src/features/driving/pages/DriveDetailPage.tsx",
    "8219b669a8e6f8c74c705968ec82ca8272b79c53b0af6303c2451535337772a7"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "5cad0a5f41c3ddd0a6a5df145951d907c01dddd8fd4aed5b59af253540c4e2e5"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "b91b79d60f48e51518daadf59b2bebd4f46657d34361b2c49b1851ee31540b91"
  ],
  [
    "web/src/features/fleet-ops/components/AssignmentDialog.tsx",
    "a2f10e2042887b69f2dc8622a476ff0182a12693610adc76f2a7493ac4d2f3e4"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "7e4f251c9c1a2c1cf2af61b12cb5966d279bc7c490e4bd668ca45a63e7d4b9f1"
  ],
  [
    "web/src/features/fleet-ops/components/CostCenterDialog.tsx",
    "be7055a95b3942f31da33d278d3555612f0d62deda0e6c2be9f6d800f82d36d1"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "4edf80083a2708a53a7f3a0e0b9f39b4fbfaf310206502ff56949508867b1e91"
  ],
  [
    "web/src/features/fleet-ops/components/DriverRoster.tsx",
    "6f7e836c77e9f1ee50c08669d71282ccc5f1697d40cfed2e6a5e174005ee3ff2"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "875ec0554a4f2ee5d7c6999987292d674e6743daf176d55768f5c9622c7e00ea"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationPanel.tsx",
    "bf404288d3131672fa966728d54813dcc8184ef2ab6e46071e2f69f60c3880db"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "4ef1b8ae484458b32a620e1d0f160116a08821a5236c0a5bb3dfd9aebfece2dd"
  ],
  [
    "web/src/features/maps/components/charging-places/ChargingPlacesWorkspace.tsx",
    "a558dfd1b6883328552bd4d494e5b623784680ba142f66229f4cc35e9b39aea9"
  ],
  [
    "web/src/features/maps/components/charging-places/PlaceDetailPanel.tsx",
    "0436d23d9ae681899f65437d6a3a4619d28a694782e13839a078a3dd5d7a9b92"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/EditorNotices.tsx",
    "fe8288ddbd0f616e60d06d4215918e69f837113132c282667bf28511ca59c0ba"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/RuleRoutingFields.tsx",
    "ff6e6ad1f778206dae71f1ccecb2f51b83ffe3c87ba1ac1e5bec1d1a0a56e5d3"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/ScopeKindFields.tsx",
    "c3a7546e08e12fda7876aed63823dce792a43dcd870942a643625ed8888067fd"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/TemplateBrowser.tsx",
    "f054e20137c10e3f0cbb023d5f41ff176f6898e20af1b32bad32d988c1bf71a8"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "50a7fcc6ae25076c8efd015fdc242f1ceb64cac6a600722508fa21b709dbae96"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "77df47768ec83734cc795e766f242f6c603cfdb1c8919c1b3abf3a038702dcf9"
  ],
  [
    "web/src/features/notifications/components/BrowserTabSignalsPanel.tsx",
    "192c355ce6533fda84c24ff21368642ea0007018e3976f2d1d364c4ed8588355"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelCard.tsx",
    "964356fc078290e967e457ef34ca54621e708ecd32bf8d20dd033cb9da700110"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelFormModal.tsx",
    "54baf1e1bcace190db14b7fc5f337070a40100418a59e87701ce1652d51b99ae"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelProvidersPanel.tsx",
    "3e059eb1c537cd9fde46d2ba3924fdd4aa86d85523178e330751c14f0032efb8"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelsGrid.tsx",
    "a1defac19f8a42386bfffa97f263abdf9d9b1c20beeb2ba5f8d3f2a06ef36875"
  ],
  [
    "web/src/features/notifications/components/ComputedMetricEditor.tsx",
    "f1e92c107ee3223f11e3947dbf97956967bc535ece1235496f50842c9dad813f"
  ],
  [
    "web/src/features/notifications/components/DeviceDataUsagePanel.tsx",
    "94f022d05639e213fec0ee0b3b3af899f5d25d58cb32890e4ff388c9c95902ab"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "9d8cb5449dd3006b0bca294b8640f8c0cdfdd1e731635aea189dfc52d671cbf3"
  ],
  [
    "web/src/features/notifications/components/InboxBody.tsx",
    "5e6ab221a751832e473457cf81a12571471198eb6d5ab92fb1e45e6dae16427a"
  ],
  [
    "web/src/features/notifications/components/NotificationFilterBar.tsx",
    "32b4d0d1945f55c94747ce3a001a9df150b779732cd089082ec132bde2a782c7"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxDelivery.tsx",
    "912ff1ad9c2b27f32aa5dde7e789d5703268a1605394b72d1d6a3ee2244a8ae0"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxDetails.tsx",
    "6e1d075fe361a9267e39a598e5311e7bc7af4eb0a4e970c435965cfdb21a50a8"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxTable.tsx",
    "39435fabca4953ae96d0003741797a1b0fc381a260b0685bd177aad0a64f0201"
  ],
  [
    "web/src/features/notifications/hooks/useAlertRuleEditorController.ts",
    "46d91c52df86e8b2d18e7217a5193da059bcc5f54541549b2c0ee3f1e9c3ee8f"
  ],
  [
    "web/src/features/notifications/pages/ArchivedPage.tsx",
    "ae82ca9797f637690cd57c72f401f4c5c7ca562eaf0dab814b9577ccba48181c"
  ],
  [
    "web/src/features/notifications/pages/BrowserNotificationsPage.tsx",
    "99884a4531e4598ad7e9cb8c1d4db7014bba271fa5bea0054f89c0379542f5c9"
  ],
  [
    "web/src/features/notifications/pages/ChannelsPage.tsx",
    "23b33d490ddc988a973566176bd660b044af310ce3880307491be34e949afa04"
  ],
  [
    "web/src/features/notifications/pages/InboxPage.tsx",
    "bc96164cb6ab8914e3377c7ebc7c454271cfa2313677c7ad66a738b36e7ee652"
  ],
  [
    "web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx",
    "b782bcaca390c97c37f320af853ff260bc4a194a9c31efab19d5f5f9c191c9e0"
  ],
  [
    "web/src/features/onboarding/components/Stepper.tsx",
    "b3ea5a17ba4086492cd1577a9643faced9c3ef3d9a2d1761c108cb49e2e6a5a3"
  ],
  [
    "web/src/features/onboarding/components/TaskOnboardingHint.tsx",
    "8de3d0f48b6499dc386653fa65d9814aab506ec4602b967f882faef7e5de7ddc"
  ],
  [
    "web/src/features/power-user/components/QueryReferencePanel.tsx",
    "bb5e6399ba8dfceb724b27b86ae141466cc0f13866824be478e81cc68e00b67a"
  ],
  [
    "web/src/features/power-user/components/SchemaCatalogCard.tsx",
    "ef26ae942d30666cbcac8f94edf7140b1953401109e70cabc3aad3712d954090"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "4916fbf626e86b2b1b956a68f96a5cb794cd60707bf445b1e6df5500a8ee298c"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "50051395423268f9c1e678f76743dc25eee2c35f10d3ebb84e34436845e5ddc1"
  ],
  [
    "web/src/features/service-intelligence/components/WarrantyPanel.tsx",
    "f56b7b3d7f5674fc379cd6cf45a7dcbbda3cb6f895e33562e8922ee5f8d021b9"
  ],
  [
    "web/src/features/settings/components/AICostCapSpendBar.tsx",
    "5619c4e8b0b782dcd5f92de7174019cdda00ad7979a698d7be99ba68a7290821"
  ],
  [
    "web/src/features/settings/components/AIFeatureToggleList.tsx",
    "48b7a914d181fe907cc999e457bd33325add5fe665a54fa2c9880a76258fd25f"
  ],
  [
    "web/src/features/settings/components/AppearanceSettings.tsx",
    "bb919b4b5ce40bf4a0667c69ae0ae9ff9551d8181a30f0fcdb399d7b55e64c1b"
  ],
  [
    "web/src/features/settings/components/FeatureToggles.tsx",
    "1e60d47ad65769d11181f74450a914fc3fc8f6efe8f9300ad51825e6d4a6ae50"
  ],
  [
    "web/src/features/settings/components/fleet-setup/FleetSetupReadiness.tsx",
    "3285cd95cad419a9d187a817ac679876d61cf45fc767b029f322f8f933bc074b"
  ],
  [
    "web/src/features/settings/components/fleet-setup/FleetSetupSubscribePanel.tsx",
    "de60637399d183599b5a9df697006983c7da224ed5f4cc3ccfe7fcd90244bc77"
  ],
  [
    "web/src/features/settings/components/privacy/ConsentControlPanel.tsx",
    "26d5af828915c0fec17c4cc8f66e1553b85f83b1d119d640cd0942370e0a37d1"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyGuaranteesPanel.tsx",
    "c8d95fa50528cd21fbb6bbeadd9a2dfae4930d61e65c388598d55109c6399d4f"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "39bc6a2899e8aa7a2f48f141d252d2a3f28b84beee212dfca12fe50106514911"
  ],
  [
    "web/src/features/settings/components/QuietHoursPanel.tsx",
    "68add43e0787bd88ee0bfbbd64b9ae2110e015783668b05de43b68ffe3a624ba"
  ],
  [
    "web/src/features/settings/components/RegionSettings.tsx",
    "91d130d18281f89c784be7745e7953d823fd06f4d68e5f18cbca40d792047b73"
  ],
  [
    "web/src/features/settings/components/sessions/SessionBreakdownPanel.tsx",
    "92f86eb360aa78606239ac666ddbfcf40b6838ea993bf894ff2fa913269fb2b0"
  ],
  [
    "web/src/features/settings/components/sessions/SessionsOpenModeNotice.tsx",
    "6be9b17b80e19e7358697676b6fdebb72a688802737683b6ea7fcff7510a3bff"
  ],
  [
    "web/src/features/settings/components/sessions/SessionsTable.tsx",
    "efaf0911e2c81b48d229b76f784148761702e4b53325b487bdee1e49fb02cd69"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "ddf4625258f55a44c85c16b2c7a3e4c9f74525061a77f13e292a0f169132e8ed"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpBackupCodesModal.tsx",
    "2e3770998b4d96d9cffd7182f40fd5c5f30a9444a3a7155498f490c99a3e5f5b"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpCompatibleApps.tsx",
    "ce583ef8041391f9a2ea6e5cc8e72493bf9cf2ee14d5caff3084ad36134c169c"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpRecoveryPanel.tsx",
    "8c680f4c014b0c70774bb023978b6f5ec4f825710b99722323437c42fbc8b8bd"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "58e77d2b5ec08a008568360b615df2ac74b6494e701c515d30a2a3786d5fa052"
  ],
  [
    "web/src/features/settings/components/TypographySettings.tsx",
    "18b7ea5c2dab3c7a60bf20c922d7a4bed259963ec3cca6277a9f4115f59d57de"
  ],
  [
    "web/src/features/settings/pages/HelixPage.tsx",
    "2f88258387fab97296dc3759c90d9e7a85362f71a8c00936c0cf7ed75dc7d76b"
  ],
  [
    "web/src/features/settings/pages/PrivacyPage.tsx",
    "35f457395e005b96896fb9478e19a78d16eaa3bc9393ee3657ad460ae049ce7c"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/ShareCardBrief.tsx",
    "7d857f5415deea4323b37446a4d38e425e9f6efa7faa7f276703827df946ba96"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "2a8d2704c7312f4f43dbfd34a3c54da4189efcf1072e5b2f6d47f6359bdf5c6f"
  ],
  [
    "web/src/features/sharing/components/share-card/ShareCardEfficiencyEvidence.tsx",
    "c486a6b3a3447c4a6d45c59aecc138784ad5f36b9fd9c62501abff046cf3fee7"
  ],
  [
    "web/src/features/sharing/components/share-card/ShareCardEvidenceLedger.tsx",
    "59f7998a70c80ed1a159a178dba6c6c6d130568f0772b5815981ba6da09dd277"
  ],
  [
    "web/src/features/sharing/pages/SharedDrivePage.tsx",
    "93e6d1fe41ec74db000ad50da33db09b66fd75650112a8ac788242832421e032"
  ],
  [
    "web/src/features/sharing/pages/SharedSessionReport.tsx",
    "687927baf36c00775c20d234a903ab540793689505cc8314622a6aea5918b6ff"
  ],
  [
    "web/src/features/system/components/activity-timeline/ActivityOverview.tsx",
    "ebe54922cbf011599a4fa79afb5fb190fa590a262b4e72d15a664f04f9c62b2b"
  ],
  [
    "web/src/features/system/components/chatbot/KnowledgeCitations.tsx",
    "2ff11aecdbdb60044a72f697912f9d75dcfba605c6d19319566c1159e53bcce6"
  ],
  [
    "web/src/features/system/components/chatbot/SessionList.tsx",
    "a2b81f615fd56d941c595df1d9d980b40db5b1707dfad5b797a243e9edb35a0d"
  ],
  [
    "web/src/features/system/components/command-center/CommandCenterHero.tsx",
    "30918f5cc97d464417b1de0939aab55557e41c1d63b6b7d0c5ae2e0daef32623"
  ],
  [
    "web/src/features/system/components/FSMStateDiagram.tsx",
    "ea0ab3466a4b3faaef41a4141ca658696f01d738c381f8ef79315c36a226b224"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "0e2bafa2de3686b3b134ff54f1f1781402e71a8bb64090b5ad1d650a916ffd4e"
  ],
  [
    "web/src/features/system/components/help-index/GuidedHelpPanel.tsx",
    "1ae3faa71f174509fe83298d78d2b82fa0d56a326faebd348c4a6f2008e61ff9"
  ],
  [
    "web/src/features/system/components/help-index/HelpGlossaryPanel.tsx",
    "5ec59a90cdd074cb6ad1fe33351297ea3fcdacf0322b5c4f91f783e7da977ba3"
  ],
  [
    "web/src/features/system/components/help-index/HelpSearch.tsx",
    "d1316ab52cde2ad164f5bc28789cf640c9393324013be524f7d374c53e8f8da7"
  ],
  [
    "web/src/features/system/components/help-index/ReleaseNotesPanel.tsx",
    "84005f095ed80e09ce7437d47a1142ca3f1927d873c76d00e15da2e93712ada2"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "d7f639603601fda7f163ae537d846f2ec78ed60b05f4b5ca8d5d72c000ff485d"
  ],
  [
    "web/src/features/system/components/incident/IncidentUpdateForm.tsx",
    "b445b35a1f7fede6689cd920e1a35dea1af7734ce9108d3a48b0786e2129d94c"
  ],
  [
    "web/src/features/system/components/my-activity/ActivityFeedPanel.tsx",
    "84516d268521c828421dc5441d7d79d36084f2a34ce203f7eb3c9945b0e8c77f"
  ],
  [
    "web/src/features/system/components/my-activity/ActivityHourPanel.tsx",
    "8c22a5a6a6d57c907270442063353b2d0ff33aa45a57d64bfebfd84ed68dec7e"
  ],
  [
    "web/src/features/system/components/my-activity/MyActivityKpiBand.tsx",
    "a7bcd23cbb2663afda8aec4724f2d3b438d5d18ee33e2241813ead931a4af3f1"
  ],
  [
    "web/src/features/system/components/operationalbrief-all/SystemSummaryBrief.tsx",
    "f57825bef8b213e4987373b6d1ea03a089906170e0098d4d6686ded3bfe99326"
  ],
  [
    "web/src/features/system/components/RepairCaseQueue.tsx",
    "7e5b77fc06db802cbcf4dd4e56c0569d465715bdab9adcc616cafe9917006f7b"
  ],
  [
    "web/src/features/system/components/RepairCaseStats.tsx",
    "848d7f36aaf9d1e7bed3c17843485fbe70997e523dff13a2eb46bb3de7b86a6d"
  ],
  [
    "web/src/features/system/components/RepairDiagnosisOverview.tsx",
    "c3c88016b4d753297a866e076e728b6c9b873d77b536c3f563aff2d38eb2cb5f"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "23243557c8b72fa5d5fa70bf4e65330a68a8fccd5487f5ccf75ecd9562f1c428"
  ],
  [
    "web/src/features/system/components/statstrip-fsm/FSMOperationalBrief.tsx",
    "197e5e544c10923a314438a3b863aafec39ef8a8e84a52caf707fd503916cbee"
  ],
  [
    "web/src/features/system/components/status/AiSpendWatch.tsx",
    "ed8a6f3192e02316b886d391438874278e1ce5c0ee53ca3cbf296bd9958b1539"
  ],
  [
    "web/src/features/system/components/status/BackgroundWorkersCard.tsx",
    "206b2edffebe07d243e080266af16d549d88ce2a0c1ede3bf0ed2728ef694f92"
  ],
  [
    "web/src/features/system/components/status/IncidentForm.tsx",
    "2d5c40c8a5140e4ee2d86027d4440e197082f97ce2f4e40c427392439b81d1f5"
  ],
  [
    "web/src/features/system/components/status/ScheduledMaintenanceCard.tsx",
    "25953b082058e525ec204a59c84369192715effd2f42ff54e4a631bfff1469a9"
  ],
  [
    "web/src/features/system/components/status/SLOTrackingCard.tsx",
    "ba0e5ce3365f950efdf4e9e9f44e0ba3fc74d2d61465ce7d605ee75979b5cc86"
  ],
  [
    "web/src/features/system/components/status/TelemetryPipelineCard.tsx",
    "8944149852e7f5c8f976928c52d73be4b3713ed010a92419b503ad5563a7fa6d"
  ],
  [
    "web/src/features/system/components/status/TeslaApiUsageCard.tsx",
    "f3472541f2e14f6e6f223af2e9a7e6b0e48a6702683ee23567d96f5ce1226026"
  ],
  [
    "web/src/features/system/pages/CommandHistoryPage.tsx",
    "a28ee21250f0a763b51b35e8a7ff44d89cce7cbdd6f1992772d1104df9fa9c8a"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "899aa565c3d1dd3e21e0083569a2d23e8e87bd4356c87e4e7986bf64e0f60745"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "088eada48a2c99fa6d89fb738ec5a90b7614fd11bc6cbfaf188228affc42a52a"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "7a791c80be61ab3604f62fc5d6a88e4228a32bdbec0934b6c811a4f749a5db12"
  ],
  [
    "web/src/features/system/pages/HelpPage.tsx",
    "8c6a49937a2e6ca6f02011bf9f0fdd55f099fbf528e5422fba0721afabd25d91"
  ],
  [
    "web/src/features/system/pages/IncidentTimelinePage.tsx",
    "0958457cc9a18e46da3c1cf5f37f4a67333a86fdaf4dbc9b780d871c5ec96bbc"
  ],
  [
    "web/src/features/system/pages/OutageAutobiographyPage.tsx",
    "7652bcf6f04461e817054741feac2caf22bc340a9ca918bb3671192d9bd893d2"
  ],
  [
    "web/src/features/system/pages/RoadmapPage.tsx",
    "1c7eb0ba45d47191fad012166cdf7221c2e849adb80a60afd006513102449f31"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "5527f8f5e4fea8fdb18fa9e9322beccd607db30957ece8b5f4c1500acc0e1f8d"
  ],
  [
    "web/src/features/system/pages/StateMachineDebuggerPage.tsx",
    "36c40f2f165a6ab1d9bebaab7a7ba69f654169638f913d42d31af97db75fdb2a"
  ],
  [
    "web/src/features/system/pages/StatusApiDocsPage.tsx",
    "ffec826ac52ad0ad0a7fd89db00fde8e1b5dbd8434006660de51dd4ef65bd68a"
  ],
  [
    "web/src/features/telemetry/components/LiveThroughputPanel.tsx",
    "77f8c5877c031ebd17443827154fe978ccd03c6b85b5503a1d0c2466b18c99e5"
  ],
  [
    "web/src/features/telemetry/components/SignalCatalogPanel.tsx",
    "aa9c09483793730386dd0200a4b2c27295bdf19431c6c7584e52a5117b650cc9"
  ],
  [
    "web/src/features/telemetry/components/SignalCategoryTree.tsx",
    "250ea094c8628dc9e9b8422aff87bc4d5b77cf3e70b96254c918ba243380e30a"
  ],
  [
    "web/src/features/telemetry/components/SignalLogBreakdownPanel.tsx",
    "59e8b2ec299e077def8061b89b5966d122d6c9d64016260b377324a75aebd6fc"
  ],
  [
    "web/src/features/telemetry/components/SignalLogKpiBand.tsx",
    "855fb1390af5beeaa540eac86f0779242ce29caf81d7c5da9a5adb8a7e8aa513"
  ],
  [
    "web/src/features/telemetry/components/SignalSparklinePreview.tsx",
    "d399bec785f87628f11e9c7b25782089f400e221cb5edb99bd157641e676c9fa"
  ],
  [
    "web/src/features/telemetry/components/SignalStatsPanel.tsx",
    "e73c893ed63d5d0a2273b7e9ff316b176aed2ea4c4d915d390ba6933a8c8cb82"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "f4e050383c6df275c633a3f61f314a6c45a66d695c273bc2e18218773971eaa3"
  ],
  [
    "web/src/features/telemetry/components/statstrip-signals-mqtt/signalsSummary.ts",
    "f9abd4edf7454c8d37638cf599436bd1bb1e52d4e6018f8e31b131a27b5ace7c"
  ],
  [
    "web/src/features/telemetry/components/TopSignalsPanel.tsx",
    "34c73f416cc9f5cd994744cc7036e3324a781eb1002b9671dd521ed2ca8dd9e9"
  ],
  [
    "web/src/features/telemetry/pages/MQTTInspectorPage.tsx",
    "6d9c0d5b07cc9c7c77b90319809c8d744e7ccf02817063c0d44f5c5c7765c986"
  ],
  [
    "web/src/features/telemetry/pages/SignalChangePointsPage.tsx",
    "8efe05aa4e22287de83ba99b48f93a5dda65948f76bd25a850bb3cabece2cd10"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "3552c86477e45ce8420d6451bfca51f1cbd59a0a1fafeeaf0f6c87f4f553b4f4"
  ],
  [
    "web/src/features/telemetry/pages/SignalEntropyPage.tsx",
    "455214ca4936ce16d657a659ca202fdf8b09414174a9eee9db40c102adace32a"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "f45b6108d11ebdb13fcf2faa7adfb894e66b129f7bae63d122cfb0c893a51dd2"
  ],
  [
    "web/src/features/telemetry/pages/SignalLogViewerPage.tsx",
    "f9595dd093ae5b817e555d28d06244a79cc08f744c1d3deb0f5ad8d20e2605ec"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "fd2a8e532241bf4a17eed8763ed7f59efe847171243de3214fc3da773a43bfd0"
  ],
  [
    "web/src/features/telemetry/pages/SignalTrendPage.tsx",
    "9a7d1ea8c8484e8459ef28683a8c72cee1d3dda1f89ea66a8ebfe4bbfae56d28"
  ],
  [
    "web/src/features/trips/components/ArrivalPanel.tsx",
    "b812236500153a3dd8a37d2806637dad6c25b8093b83dde529c4b8c39afedf1c"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "25c241a0f2946cde619292ad8ee47d20cee55cda35c736d84252cd5eeeda6cc5"
  ],
  [
    "web/src/features/trips/components/NudgePanel.tsx",
    "6ecfa789358e0ea703acee9adac69e339a74f5e99199f32502b38491fed5de7e"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "886f0240f4a59cb6b6bd2157fc8ccbcf25999914e04ba0fa7e983e1baaa93ae5"
  ],
  [
    "web/src/features/trips/components/StopScorePanel.tsx",
    "546229f8c06e53b4ef6f3eed00cc02ed5c3415d6daf5df2b93cc065c0ba2f8e1"
  ],
  [
    "web/src/features/trips/components/TripReplayElevation.tsx",
    "36dba77ade7db1e5d9caac0d78954e40778a9581463c164b0bbcf2ea19c78d63"
  ],
  [
    "web/src/features/trips/components/TripReplayMap.tsx",
    "fd58e1e5c7e1cca57d7230ebd03e7a7c93fd52b7a5fbf309ef53fde7f33a28c6"
  ],
  [
    "web/src/features/vehicles/components/BatteryComparison.tsx",
    "e2e9a3e280dae12739d3eed6871c586bc3ed73c640350e0c6c85c01ede3fcd9f"
  ],
  [
    "web/src/features/vehicles/components/SilenceBanner.tsx",
    "198ade0bb556a74503f8373660ea482e7ee17506bb95b900e0d18f9423f376fa"
  ],
  [
    "web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx",
    "88eff004698763eb1a961b6c2a1d43b505cc649e139f3bd2d789764c0267ce67"
  ],
  [
    "web/src/features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx",
    "fa51accb11053234d2a29f97ba41d3280eae5f880dca0a685274d20c0c1c33e8"
  ],
  [
    "web/src/features/vehicles/components/vehicle-access/AccessOverviewPanel.tsx",
    "3c1ffd0db89cd5222ed0967f54a382552b5f4e88cbe3330429137a412147ef6d"
  ],
  [
    "web/src/features/vehicles/components/VehicleCard.tsx",
    "c7293187385a6e92ba19ed2792e773fa600374894f46aa416d6df1db1ec30c9c"
  ],
  [
    "web/src/features/vehicles/components/VehicleHeader.tsx",
    "31205900cd3376f65fc4d303fc76fe7b95ca2300253837a89402b15d6f572311"
  ],
  [
    "web/src/features/vehicles/components/VehiclePhotoGallery.tsx",
    "ec048bbfd37303e0aac2af74d6a280a43cde46a74890fc9a28f5f8764592e4ad"
  ],
  [
    "web/src/features/vehicles/components/VehiclePhotoUpload.tsx",
    "3e6a9819135d3714f6e5e5335c80f9c5bff05683370b508690d0c3b05177826c"
  ],
  [
    "web/src/hooks/useA11ySummary.ts",
    "2fddc25337fe0181af78ccfd075f9308fe26c1f28a08f3d1bff8e42c438585ce"
  ],
  [
    "web/src/hooks/useNotificationListener.ts",
    "8e88fd56da190139eda8c9c61f0a691dc112ee7737d14faf60f70560b639a7c7"
  ],
  [
    "web/src/hooks/useStatusAnnouncer.ts",
    "378541442b5b9cbd5534efa3df15152e0207fa330d9a5473ce7419937b009508"
  ]
]
const producerCalls: readonly (readonly [string, string])[] = [
  [
    "web/src/api/hooks/useWatch.ts",
    "t('watch.command.success', 'Command sent')"
  ],
  [
    "web/src/api/hooks/useWatch.ts",
    "t('watch.command.error', 'Watch command failed: {{message}}', { message: err.message })"
  ],
  [
    "web/src/components/ai/AICrossRuleConflictDetection.tsx",
    "t(\n            'notifications.alertStudio.aiConflicts.listLabel',\n            'Detected rule conflicts',\n          )"
  ],
  [
    "web/src/components/ai/AICrossRuleConflictDetection.tsx",
    "t(\n                          'notifications.alertStudio.aiConflicts.flag.subsumes',\n                          'subsumes',\n                        )"
  ],
  [
    "web/src/components/ai/AICrossRuleConflictDetection.tsx",
    "t(\n                          'notifications.alertStudio.aiConflicts.flag.severityMismatch',\n                          'severity mismatch',\n                        )"
  ],
  [
    "web/src/components/ai/AICrossRuleConflictDetection.tsx",
    "t(\n                          'notifications.alertStudio.aiConflicts.flag.cooldownMismatch',\n                          'cooldown mismatch',\n                        )"
  ],
  [
    "web/src/components/ai/AICrossRuleConflictDetection.tsx",
    "t(\n                          'notifications.alertStudio.aiConflicts.flag.triggerModeMismatch',\n                          'trigger mode mismatch',\n                        )"
  ],
  [
    "web/src/components/ai/AIFeedbackQueueTriage.tsx",
    "t('feedbackTriage.aiAdvisor.title', 'Helix triage advisor')"
  ],
  [
    "web/src/components/ai/AIFeedbackQueueTriage.tsx",
    "t(\n                'feedbackTriage.aiAdvisor.description',\n                'Get a proposed status, category, and priority label for this feedback row. The advisor reads only the redacted envelope (id, category, title, body excerpt, page route, app version, status, created_at) — never the reporter email, IP, console tail, or recent errors. The proposal is informational; your existing manual controls above remain the only way to save changes.',\n              )"
  ],
  [
    "web/src/components/ai/AIFeedbackQueueTriage.tsx",
    "t('feedbackTriage.aiAdvisor.button', 'Suggest triage')"
  ],
  [
    "web/src/components/ai/AIFeedbackQueueTriage.tsx",
    "t(\n        'feedbackTriage.aiAdvisor.emptyHint',\n        'Select a feedback row to suggest triage labels.',\n      )"
  ],
  [
    "web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx",
    "t(\n            'automations.builder.aiGeofenceAware.promptAria',\n            'Describe the geofence-aware automation to draft',\n          )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.useBaseline', 'Use baseline')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.costCap', 'Daily cost cap reached')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.costCapUnavailable', 'Cost cap check unavailable')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.settingsUnavailable', 'Helix settings unavailable')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.burst', 'Too many Helix requests at once')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.perMinute', 'Helix rate limit hit')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.perDay', 'Daily Helix usage limit reached')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.tokens', 'Helix token quota exhausted')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.providerUnavailable', 'Helix provider unavailable')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.featureMisconfigured', 'Helix feature misconfigured')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t('ai.limit.title.generic', 'Helix temporarily unavailable')"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.costCap',\n        'You have reached your daily Helix cost limit. Helix features will resume tomorrow or after you raise the cap in Settings.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.costCapUnavailable',\n        'Could not read your Helix usage history. Failing closed for safety.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.settingsUnavailable',\n        'Could not load your Helix settings. Helix is paused until settings are reachable.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.burst',\n        'Too many Helix requests are in flight. The limiter is keeping the system responsive.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.perMinute',\n        'You have sent more Helix requests than allowed per minute. The window resets shortly.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.perDay',\n        'You have used your daily Helix request budget. The budget resets at UTC midnight.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.tokens',\n        'Your Helix token quota for this minute is exhausted. Try a shorter prompt.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.providerUnavailable',\n        'The Helix provider is not responding. The system will retry automatically.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.featureMisconfigured',\n        'This page is missing a Helix feature registration. Please report this to your administrator.',\n      )"
  ],
  [
    "web/src/components/ai/AiLimitBanner.tsx",
    "t(\n        'ai.limit.desc.generic',\n        'Helix features are temporarily unavailable. The non-Helix baseline continues to work.',\n      )"
  ],
  [
    "web/src/components/ai/AIMLChargingCurveClustering.tsx",
    "t(\n              'charging.aiMlClustering.noVehicleHint',\n              'Pick a vehicle to train its charging-curve clusters.',\n            )"
  ],
  [
    "web/src/components/ai/AINLAlertBuilder.tsx",
    "t(\n        'notifications.alertStudio.aiBuilder.emptyHint',\n        'Choose a vehicle and describe the alert you want Helix to draft.',\n      )"
  ],
  [
    "web/src/components/ai/AINLAlertBuilder.tsx",
    "t(\n            'notifications.alertStudio.aiBuilder.inputLabel',\n            'Alert description',\n          )"
  ],
  [
    "web/src/components/ai/AINLAlertBuilder.tsx",
    "t(\n            'notifications.alertStudio.aiBuilder.placeholder',\n            'e.g. alert me if battery cell voltage spread is over 50 mV',\n          )"
  ],
  [
    "web/src/components/ai/AINLDashboardComposer.tsx",
    "t('powerDashboards.aiDrafter.title', 'Helix natural-language dashboard composer')"
  ],
  [
    "web/src/components/ai/AINLDashboardComposer.tsx",
    "t(\n        'powerDashboards.aiDrafter.description',\n        'Describe the dashboard you want in plain English (e.g. \"give me an overview dashboard with daily drives, current battery, and recent alerts\"). Helix proposes a typed dashboard JSON draft built from the in-scope curated panel catalog you can apply to the editor with one click; it never pushes the dashboard to Grafana directly.',\n      )"
  ],
  [
    "web/src/components/ai/AINLDashboardComposer.tsx",
    "t('powerDashboards.aiDrafter.button', 'Draft dashboard')"
  ],
  [
    "web/src/components/ai/AINLDashboardComposer.tsx",
    "t(\n            'powerDashboards.aiDrafter.promptPlaceholder',\n            'e.g. give me an overview dashboard with daily drives, current battery, and recent alerts',\n          )"
  ],
  [
    "web/src/components/ai/AINLDashboardComposer.tsx",
    "t('powerDashboards.aiDrafter.promptLabel', 'Dashboard request')"
  ],
  [
    "web/src/components/ai/AINLDashboardComposer.tsx",
    "t(\n              'powerDashboards.aiDrafter.applyTooltip',\n              'Copy the proposed dashboard JSON into the editor above. You can still edit it before clicking Copy to clipboard.',\n            )"
  ],
  [
    "web/src/components/ai/AINLDriveSearch.tsx",
    "t(\n            'drives.aiSearch.inputLabel',\n            'Describe the drive to find',\n          )"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.title', 'Helix natural-language Grafana panel drafter')"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t(\n        'powerGrafana.aiDrafter.description',\n        'Describe the panel you want in plain English (e.g. \"show me a daily time series of how far I drove this month\"). Helix proposes a typed Grafana panel JSON draft you can apply to the editor with one click; it never pushes the panel to Grafana directly.',\n      )"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.button', 'Draft panel')"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.promptLabel', 'Grafana panel request')"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.promptLabel', 'Grafana panel request')"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t(\n            'powerGrafana.aiDrafter.promptPlaceholder',\n            'e.g. show me a daily time series of how far I drove this month',\n          )"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t(\n                'powerGrafana.aiDrafter.applyTooltip',\n                'Copy the proposed panel JSON into the editor above. You can still edit it before clicking Copy to clipboard.',\n              )"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t(\n              'powerGrafana.aiDrafter.previewLabel',\n              'Proposed Grafana panel (review before applying)',\n            )"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.previewUntitled', 'Untitled panel')"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.previewType', 'Panel type:')"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.previewDatasource', 'Datasource:')"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.previewTargets', 'Query targets:')"
  ],
  [
    "web/src/components/ai/AINLGrafanaPanel.tsx",
    "t('powerGrafana.aiDrafter.previewTables', 'Referenced tables:')"
  ],
  [
    "web/src/components/ai/AINLSearch.tsx",
    "t(\n        'search.aiSearch.emptyHint',\n        'Type a question above to search your drives, charging sessions, and alerts.',\n      )"
  ],
  [
    "web/src/components/ai/AINLSearch.tsx",
    "t(\n            'search.aiSearch.placeholder',\n            'e.g. drives last weekend over 200 km with phantom drain',\n          )"
  ],
  [
    "web/src/components/ai/AINLSqlPlayground.tsx",
    "t('powerSql.aiDrafter.title', 'Helix natural-language SQL drafter')"
  ],
  [
    "web/src/components/ai/AINLSqlPlayground.tsx",
    "t(\n        'powerSql.aiDrafter.description',\n        'Describe the question in plain English (e.g. \"how many drives last week\"). Helix proposes a typed read-only SQL draft you can apply to the editor with one click; it never executes the query directly.',\n      )"
  ],
  [
    "web/src/components/ai/AINLSqlPlayground.tsx",
    "t('powerSql.aiDrafter.button', 'Draft SQL')"
  ],
  [
    "web/src/components/ai/AINLSqlPlayground.tsx",
    "t(\n            'powerSql.aiDrafter.promptPlaceholder',\n            'e.g. how many drives did I take last week',\n          )"
  ],
  [
    "web/src/components/ai/AINLSqlPlayground.tsx",
    "t('powerSql.aiDrafter.promptLabel', 'SQL request')"
  ],
  [
    "web/src/components/ai/AINLSqlPlayground.tsx",
    "t(\n              'powerSql.aiDrafter.applyTooltip',\n              'Copy the proposed SQL into the editor above. You can still edit it before clicking Run.',\n            )"
  ],
  [
    "web/src/components/ai/AiOutputPanel.tsx",
    "t('helix.errorLabel', 'Helix error:')"
  ],
  [
    "web/src/components/ai/AiOutputPanel.tsx",
    "t('ai.common.noOutput', 'No output was generated.')"
  ],
  [
    "web/src/components/ai/AISignalExplorerNlFilter.tsx",
    "t('signalExplorer.aiFilter.title', 'Helix natural-language filter')"
  ],
  [
    "web/src/components/ai/AISignalExplorerNlFilter.tsx",
    "t(\n        'signalExplorer.aiFilter.description',\n        'Describe the filter in plain English (e.g. \"battery level for yesterday\"). The LLM proposes a typed filter you can apply with one click; it never edits the form directly.',\n      )"
  ],
  [
    "web/src/components/ai/AISignalExplorerNlFilter.tsx",
    "t('signalExplorer.aiFilter.button', 'Draft filter')"
  ],
  [
    "web/src/components/ai/AISignalExplorerNlFilter.tsx",
    "t(\n            'signalExplorer.aiFilter.promptPlaceholder',\n            'e.g. show me battery level for yesterday',\n          )"
  ],
  [
    "web/src/components/ai/AISignalExplorerNlFilter.tsx",
    "t('signalExplorer.aiFilter.promptLabel', 'Filter request')"
  ],
  [
    "web/src/components/ai/AISignalExplorerNlFilter.tsx",
    "t(\n              'signalExplorer.aiFilter.applyTooltip',\n              'Copy the proposed filter into the form above. You can still edit it before clicking Explore.',\n            )"
  ],
  [
    "web/src/components/ai/AISignalExplorerNlFilter.tsx",
    "t('signalExplorer.aiFilter.applyButton', 'Apply to filters')"
  ],
  [
    "web/src/components/ai/AIYearReviewNarration.tsx",
    "t(\n              'yearReview.aiNarration.emptyHint',\n              'Select a vehicle above to recap its year.',\n            )"
  ],
  [
    "web/src/components/ai/ConfirmDialog.tsx",
    "t('ai.confirm.title', 'Approve Helix action')"
  ],
  [
    "web/src/components/ai/ConfirmDialog.tsx",
    "t(\n        'ai.confirm.intro.mutates',\n        'The assistant wants to make a change to your data. Review what it will do, then approve or cancel.',\n      )"
  ],
  [
    "web/src/components/ai/ConfirmDialog.tsx",
    "t(\n        'ai.confirm.intro.read',\n        'The assistant wants to run a tool. Review the inputs, then approve or cancel.',\n      )"
  ],
  [
    "web/src/components/ai/ConfirmDialog.tsx",
    "t('ai.confirm.argsLabel', 'Arguments')"
  ],
  [
    "web/src/components/ai/ConfirmDialog.tsx",
    "t('ai.confirm.toolLabel', 'Tool')"
  ],
  [
    "web/src/components/ai/ConfirmDialog.tsx",
    "t('ai.confirm.run', 'Approve')"
  ],
  [
    "web/src/components/charts/ElevationProfile.tsx",
    "t('replay.elevation.gainLoss', '↑ {{gain}}m  ↓ {{loss}}m', {\n        gain: fmtNumber(elevGain.gain),\n        loss: fmtNumber(elevGain.loss),\n      })"
  ],
  [
    "web/src/features/trips/components/TripReplayElevation.tsx",
    "t('replay.elevation.gainLoss', '↑ {{gain}}m  ↓ {{loss}}m', {\r\n        gain: fmtNumber(Math.round(gain)), loss: fmtNumber(Math.round(loss)),\r\n      })"
  ],
  [
    "web/src/components/charts/Sparkline.tsx",
    "t('sparkline.ariaLabel', 'Trend sparkline')"
  ],
  [
    "web/src/components/data-display/BatteryDelta.tsx",
    "t('battery.delta.unknown', 'Battery delta unknown')"
  ],
  [
    "web/src/components/data-display/BatteryDelta.tsx",
    "t('battery.delta.aria', 'Battery {{from}}% to {{to}}%', {\n    from: fmtNumber(startPct),\n    to: fmtNumber(endPct),\n  })"
  ],
  [
    "web/src/components/data-display/DriveScore.tsx",
    "t('driveScore.gaugeLabel', 'Drive score: {{score}} out of 100', { score: score.total })"
  ],
  [
    "web/src/components/data-display/LiveIndicator.tsx",
    "t('live.scope', 'Live data')"
  ],
  [
    "web/src/components/data-display/OperationalNarrativeDetails.tsx",
    "t(\n                'operations.narrative.evidenceCoverage',\n                '{{count}} supporting records supplied.',\n                { count: narrative.evidence.length },\n              )"
  ],
  [
    "web/src/components/data-display/PlaybackControls.tsx",
    "t('replay.shortcuts.seekBack', '⏪ −{{n}}s', { n: e.shiftKey ? 30 : 5 })"
  ],
  [
    "web/src/components/data-display/PlaybackControls.tsx",
    "t('replay.shortcuts.seekBack', '⏪ −{{n}}s', { n: 10 })"
  ],
  [
    "web/src/components/data-display/PlaybackControls.tsx",
    "t('replay.shortcuts.seekForward', '⏩ +{{n}}s', { n: e.shiftKey ? 30 : 5 })"
  ],
  [
    "web/src/components/data-display/PlaybackControls.tsx",
    "t('replay.shortcuts.seekForward', '⏩ +{{n}}s', { n: 10 })"
  ],
  [
    "web/src/components/data-display/ScoreBadge.tsx",
    "t('score.aria', 'Score {{grade}}', { grade: info.label })"
  ],
  [
    "web/src/components/data-display/ServiceStatus.tsx",
    "t(\n                'serviceStatus.offline',\n                'You are offline. Data may be stale. Reconnecting automatically…',\n              )"
  ],
  [
    "web/src/components/data-display/ServiceStatus.tsx",
    "t('serviceStatus.systemHealth', 'System: {{status}}', {\n    status: overall ?? t('serviceStatus.unknown', 'unknown'),\n  })"
  ],
  [
    "web/src/components/data-display/Timeline.tsx",
    "t('timeline.empty', 'No timeline entries yet.')"
  ],
  [
    "web/src/components/feedback/ActionableEmptyState.tsx",
    "t('emptyState.label.prerequisite', 'What has to happen first')"
  ],
  [
    "web/src/components/feedback/ActionableEmptyState.tsx",
    "t('emptyState.label.prerequisite', 'What has to happen first')"
  ],
  [
    "web/src/components/feedback/ActionableEmptyState.tsx",
    "t('emptyState.label.likelyCause', 'Most likely reason')"
  ],
  [
    "web/src/components/feedback/ActionableEmptyState.tsx",
    "t('emptyState.label.likelyCause', 'Most likely reason')"
  ],
  [
    "web/src/components/feedback/CachedDataNotice.tsx",
    "t('pwa.cache.regionLabel', 'Cached data disclosure')"
  ],
  [
    "web/src/components/feedback/CachedDataNotice.tsx",
    "t(\n            'pwa.cache.offlineNoData',\n            \"You're offline and nothing is cached for this view.\",\n          )"
  ],
  [
    "web/src/components/feedback/CachedDataNotice.tsx",
    "t(\n              'pwa.cache.cachedUnknown',\n              'Showing cached data. The capture time is unknown — treat it as stale.',\n            )"
  ],
  [
    "web/src/components/feedback/CachedDataNotice.tsx",
    "t(\n                'pwa.cache.cachedRange',\n                'Showing cached data captured between {{oldestRelative}} ({{oldestAbsolute}}) and {{newestRelative}}.',\n                {\n                  oldestRelative: formatRelative(oldest),\n                  oldestAbsolute: formatDateTime(oldest),\n                  newestRelative: formatRelative(new Date(newestCachedAt)),\n                },\n              )"
  ],
  [
    "web/src/components/feedback/CachedDataNotice.tsx",
    "t('pwa.cache.cachedAt', 'Showing data cached {{relative}} ({{absolute}}).', {\n                relative: formatRelative(oldest),\n                absolute: formatDateTime(oldest),\n              })"
  ],
  [
    "web/src/components/feedback/DataStateNotice.tsx",
    "t('dataUnavailable.whatToDo', 'What to do')"
  ],
  [
    "web/src/components/feedback/ErrorHelpLinks.tsx",
    "t('errorHelp.title', 'Where to look next')"
  ],
  [
    "web/src/components/feedback/InstallPrompt.tsx",
    "t(\n                      'installPrompt.ios.intro',\n                      'iOS installs web apps from the Safari share menu — there is no automatic install button.',\n                    )"
  ],
  [
    "web/src/components/feedback/InstallPrompt.tsx",
    "t('installPrompt.ios.step1', 'Tap the Share button in Safari.')"
  ],
  [
    "web/src/components/feedback/InstallPrompt.tsx",
    "t('installPrompt.ios.step2', 'Choose Add to Home Screen.')"
  ],
  [
    "web/src/components/feedback/InstallPrompt.tsx",
    "t('installPrompt.ios.step3', 'Confirm with Add.')"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t('pwa.lowBandwidth.auto', 'Automatic (follow the network)')"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t('pwa.lowBandwidth.off', 'Always off')"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t('pwa.lowBandwidth.heading', 'Low-bandwidth mode')"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t('pwa.lowBandwidth.label', 'Data usage on this device')"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t(\n              'pwa.lowBandwidth.statusNetwork',\n              'Active — your browser or network reported Data Saver / a 2G-class connection.',\n            )"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t('pwa.lowBandwidth.statusUser', 'Active — enabled manually on this device.')"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t('pwa.lowBandwidth.statusOff', 'Not active — the app is using full quality.')"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t(\n              'pwa.lowBandwidth.effectsOn',\n              'While active: background polling slows to a quarter of its normal rate, entrance animations are disabled, charts render at most {{points}} points, satellite/terrain basemaps fall back to the lightest raster tiles, and the service worker stops storing new images and map tiles.',\n              { points: policy.chartPointBudget },\n            )"
  ],
  [
    "web/src/components/feedback/LowBandwidthControl.tsx",
    "t(\n              'pwa.lowBandwidth.effectsOff',\n              'When active: polling slows down, animations stop, charts render fewer points, heavy basemaps fall back to light tiles, and the service worker stops caching new images and map tiles.',\n            )"
  ],
  [
    "web/src/components/feedback/OnboardingWizard.tsx",
    "t('onboarding.close', 'Close and skip introduction')"
  ],
  [
    "web/src/components/feedback/OnboardingWizard.tsx",
    "t('onboarding.getStarted', 'Get Started')"
  ],
  [
    "web/src/components/feedback/PermissionGuidanceNotice.tsx",
    "t('accessGuidance.grantedByLabel', 'Who can grant this')"
  ],
  [
    "web/src/components/feedback/PermissionGuidanceNotice.tsx",
    "t('accessGuidance.stepsLabel', 'How to request access')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t(\n            'problemReport.intro',\n            'Describe what happened in your own words. We attach a redacted technical summary only if you allow it.',\n          )"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.form.title', 'What went wrong?')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t(\n            'problemReport.form.titlePlaceholder',\n            'Short summary (e.g. \"Charging costs show as blank\")',\n          )"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.form.description', 'What were you doing, and what did you expect?')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t(\n            'problemReport.form.descriptionPlaceholder',\n            'Steps you took, what you saw, and what you expected to see instead.',\n          )"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.form.descriptionTooShort', 'Please add at least {{count}} characters.', {\n              count: PROBLEM_REPORT_LIMITS.descriptionMin,\n            })"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.context.title', 'What is sent with your report')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.context.pageNote', '(record ids are replaced with :id)')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t(\n              'problemReport.form.includeDiagnostics',\n              'Attach a redacted technical summary ({{count}} recent errors)',\n              { count: bundle.errors.length },\n            )"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t(\n              'problemReport.form.includeDiagnosticsHint',\n              'Versions, browser capability, service health, error messages and trace IDs. Never VINs, locations, tokens, e-mail addresses or raw logs.',\n            )"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.policy.consoleTail', 'Console output')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.policy.files', 'File attachments')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.policy.screenshots', 'Screenshots')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.policy.userEmail', 'E-mail address')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.form.hidePreview', 'Hide exactly what is sent')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.form.showPreview', 'Show exactly what is sent')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.submitError', 'Could not send the report. Please try again.')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.form.submitting', 'Sending…')"
  ],
  [
    "web/src/components/feedback/ProblemReportModal.tsx",
    "t('problemReport.form.submit', 'Send report')"
  ],
  [
    "web/src/components/feedback/RuntimeHealthBanner.tsx",
    "t('runtimeHealth.title', 'TeslaSync is running in degraded mode')"
  ],
  [
    "web/src/components/feedback/RuntimeHealthBanner.tsx",
    "t('runtimeHealth.affected', 'Affected components: {{components}}.', {\n              components: componentNames,\n            })"
  ],
  [
    "web/src/components/feedback/RuntimeHealthBanner.tsx",
    "t(\n                  'runtimeHealth.telemetryLastSeen',\n                  'The last Fleet Telemetry signal arrived {{time}}. Stored history remains available while live values recover.',\n                  { time: formatDateTime(lastTelemetryAt) },\n                )"
  ],
  [
    "web/src/components/feedback/RuntimeHealthBanner.tsx",
    "t(\n                  'runtimeHealth.historyAvailable',\n                  'The application and stored history remain available; live or dependent features may be stale.',\n                )"
  ],
  [
    "web/src/components/feedback/RuntimeHealthBanner.tsx",
    "t('runtimeHealth.configureAlerts', 'Health alerts')"
  ],
  [
    "web/src/components/feedback/UpdatePrompt.tsx",
    "t('pwa.update.requiredTitle', 'Update required')"
  ],
  [
    "web/src/components/feedback/UpdatePrompt.tsx",
    "t(\n                  'pwa.update.requiredBody',\n                  'This tab is running an older app version than the server. Reload to stay in sync.',\n                )"
  ],
  [
    "web/src/components/feedback/UpdatePrompt.tsx",
    "t(\n                  'pwa.update.availableBody',\n                  'A newer build has been downloaded and is ready to apply.',\n                )"
  ],
  [
    "web/src/components/feedback/UpdatePrompt.tsx",
    "t(\n                'pwa.update.unsavedBlocked',\n                'Reload cancelled — finish or discard your unsaved changes first.',\n              )"
  ],
  [
    "web/src/components/feedback/UpdatePrompt.tsx",
    "t('pwa.update.applying', 'Reloading…')"
  ],
  [
    "web/src/components/feedback/_StatusAwareError.tsx",
    "t('error.forbidden.title', 'Permission denied')"
  ],
  [
    "web/src/components/feedback/_StatusAwareError.tsx",
    "t(\n          'error.forbidden.message',\n          'Your account does not have permission to view or change this resource.',\n        )"
  ],
  [
    "web/src/components/feedback/_StatusAwareError.tsx",
    "t('error.timeout.title', 'Request timed out')"
  ],
  [
    "web/src/components/feedback/_StatusAwareError.tsx",
    "t(\n          'error.timeout.message',\n          'The service did not respond in time. Existing data has not been changed.',\n        )"
  ],
  [
    "web/src/components/feedback/_StatusAwareError.tsx",
    "t(\n          'error.unsupported.message',\n          'This feature is not available with the current server or deployment configuration.',\n        )"
  ],
  [
    "web/src/components/feedback/_StatusAwareError.tsx",
    "t(\n          'error.unavailable.message',\n          'A required service is temporarily unavailable. Try again after it recovers.',\n        )"
  ],
  [
    "web/src/components/feedback/_StatusAwareError.tsx",
    "t(\n          'error.request.message',\n          'Review the request and try again. No changes were applied.',\n        )"
  ],
  [
    "web/src/components/forms/RangePicker.tsx",
    "t('date.range.loadingCalendar', 'Loading calendar…')"
  ],
  [
    "web/src/components/forms/ValidationSummary.tsx",
    "t('form.validation.summaryTitleOne', 'Fix 1 problem before continuing')"
  ],
  [
    "web/src/components/forms/ValidationSummary.tsx",
    "t(\n          'form.validation.summaryTitleMany',\n          'Fix {{count}} problems before continuing',\n          { count: list.length },\n        )"
  ],
  [
    "web/src/components/layout/Layout.tsx",
    "t('nav.suggest.chargingVehicle', { vehicle: vars.vehicle, defaultValue: '{{vehicle}} is charging' })"
  ],
  [
    "web/src/components/layout/Layout.tsx",
    "t('nav.suggest.drivingVehicle', { vehicle: vars.vehicle, defaultValue: '{{vehicle}} is on the move' })"
  ],
  [
    "web/src/components/layout/Layout.tsx",
    "t('nav.suggest.driving', 'On the move')"
  ],
  [
    "web/src/components/layout/Layout.tsx",
    "t('nav.suggest.related', { page: vars.page ?? '', defaultValue: 'Related to {{page}}' })"
  ],
  [
    "web/src/components/layout/sidebar/AtlasPanel.tsx",
    "t('nav.staleCount', { count: staleCount, defaultValue: '{{count}} stale rows' })"
  ],
  [
    "web/src/components/layout/sidebar/AtlasPanel.tsx",
    "t('nav.pinPage', { page: label, defaultValue: 'Pin {{page}} to favorites' })"
  ],
  [
    "web/src/components/layout/sidebar/AtlasPanel.tsx",
    "t('nav.empty', 'No pages yet.')"
  ],
  [
    "web/src/components/layout/sidebar/AtlasPanel.tsx",
    "t('nav.empty', 'No pages yet.')"
  ],
  [
    "web/src/components/layout/sidebar/AtlasPanel.tsx",
    "t('nav.sidebar', 'Sidebar navigation')"
  ],
  [
    "web/src/components/layout/ThemeQuickSwitcherPopover.tsx",
    "t('theme.loadingPicker', 'Loading theme picker…')"
  ],
  [
    "web/src/components/motion/CarAnimation.tsx",
    "t('carAnimation.battery', 'Battery at {{level}} percent', { level: Math.round(clampedLevel) })"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.signalsMax', 'Signals (max {{count}})', { count: maxSignals })"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.removeSignal', 'Remove {{signal}}', { signal: sig })"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.searchSignals', 'Search signals')"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.searchSignals', 'Search signals')"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.addMoreSignals', 'Add more signals…')"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.loadingSignals', 'Loading signals…')"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.signalsError', 'Failed to load signals')"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.maxReached', 'Maximum of {{count}} signals selected', { count: maxSignals })"
  ],
  [
    "web/src/components/SignalQueryControls.tsx",
    "t('signalQuery.records', '{{n}} records', { n: fmtInt(total) })"
  ],
  [
    "web/src/components/ui/CommandPalette.tsx",
    "t('palette.section.related', 'Related to this page')"
  ],
  [
    "web/src/components/ui/CommandPalette.tsx",
    "t('palette.related.parent', 'Back to section')"
  ],
  [
    "web/src/components/ui/CommandPalette.tsx",
    "t('palette.related.sibling', 'Same section')"
  ],
  [
    "web/src/components/ui/CommandPalette.tsx",
    "t('palette.dialogLabel', 'Command palette')"
  ],
  [
    "web/src/components/ui/CommandPalette.tsx",
    "t('palette.filterBy', 'Filter')"
  ],
  [
    "web/src/components/ui/DataTable.tsx",
    "t('table.genericName', 'Data table')"
  ],
  [
    "web/src/components/ui/DataTable.tsx",
    "t('table.selection.deselectRowNamed', 'Deselect {{row}}', { row: selectedRowLabel })"
  ],
  [
    "web/src/components/ui/MobileDataTableAdapter.tsx",
    "t('table.selection.deselectRowNamed', 'Deselect {{row}}', { row: humanLabel })"
  ],
  [
    "web/src/components/ui/DataTable.tsx",
    "t('table.selection.selectRowNamed', 'Select {{row}}', { row: selectedRowLabel })"
  ],
  [
    "web/src/components/ui/MobileDataTableAdapter.tsx",
    "t('table.selection.selectRowNamed', 'Select {{row}}', { row: humanLabel })"
  ],
  [
    "web/src/components/ui/Drawer.tsx",
    "t('common.panel', 'Panel')"
  ],
  [
    "web/src/components/ui/GlossaryTerm.tsx",
    "t('glossary.tooltipLabel', 'What is {{term}}?', {\n          term: t(entry.termKey, entry.termFallback),\n        })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.setAll', 'Set all…')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.title', 'Fleet Telemetry Signal Configuration')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.footerSelected', '{{n}} signals selected', { n: selectedCount })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.footerAt500', '{{n}} at 500ms', { n: at500msCount })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.footerAt10s', '{{n}} at 10s', { n: at10sCount })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.subscribeCount', 'Subscribe {{n}} Signals', { n: selectedCount })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.selectedSummary', '{{selected}} / {{total}} signals selected', {\n          selected: selectedCount,\n          total: totalCount,\n        })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.deselectAll', 'Deselect All')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.selectAll', 'Select All')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.masterInterval', 'Master Interval:')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.masterIntervalLabel', 'Master sampling interval for all signals')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.searchPlaceholder', 'Search signals...')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.searchLabel', 'Search signals')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.noMatches', 'No signals match “{{query}}”.', { query: search.trim() })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.noSignals', 'No telemetry signals are available to configure.')"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.deselectSignal', 'Deselect {{signal}}', { signal: sig.name })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.selectSignal', 'Select {{signal}}', { signal: sig.name })"
  ],
  [
    "web/src/components/ui/SignalConfigModal.tsx",
    "t('signalConfig.intervalForSignal', 'Sampling interval for {{signal}}', { signal: sig.name })"
  ],
  [
    "web/src/components/vehicles/VehicleHeroCard.tsx",
    "t('vehicleHero.noState', 'Live telemetry unavailable')"
  ],
  [
    "web/src/components/vehicles/VehicleHeroCard.tsx",
    "t('vehicleHero.noState', 'Live telemetry unavailable')"
  ],
  [
    "web/src/features/admin/components/ApiLogsEvidenceTable.tsx",
    "t('apiLogs.copyRequestUrl', 'Copy request URL')"
  ],
  [
    "web/src/features/admin/components/ApiLogsEvidenceTable.tsx",
    "t('apiLogs.durationValue', '{{value}}ms', { value: fmtInt(log.duration_ms) })"
  ],
  [
    "web/src/features/admin/components/ApiLogsEvidenceTable.tsx",
    "t('apiLogs.durationValue', '{{value}}ms', { value: fmtInt(log.duration_ms) })"
  ],
  [
    "web/src/features/admin/components/ApiLogsEvidenceTable.tsx",
    "t('apiLogs.latency', 'Latency (ms)')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaBreakdown.tsx",
    "t('admin.schemaDrift.breakdownTitle', 'Drift breakdown')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaBreakdown.tsx",
    "t('admin.schemaDrift.breakdownSub', 'Per-object comparison of current vs seed')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaBreakdown.tsx",
    "t('admin.schemaDrift.breakdownEmpty', 'No comparison available yet.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaBreakdown.tsx",
    "t('admin.schemaDrift.seedCaptured', 'Seed captured {{when}}', { when: formatRelativeTime(drift.expected_generated_at) })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaBreakdown.tsx",
    "t('admin.schemaDrift.currentExpected', '{{current}} → {{expected}}', { current: count(current), expected: count(expected) })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.fingerprintTitle', 'Schema fingerprints')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.fingerprintTitle', 'Schema fingerprints')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.fingerprintSub', 'SHA-256 of the live schema versus the captured seed')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.emptyMessage', 'The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.emptyMessage', 'The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.emptyTitle', 'No fingerprint available')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.fingerprintExpected', 'Expected (seed)')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.copyHash', 'Copy fingerprint hash')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaFingerprints.tsx",
    "t('admin.schemaDrift.generatedAt', 'Captured {{when}}', {\r\n        when: formatDateTime(generatedAt),\r\n      })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.guidanceTitle', 'What this means')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.guidanceEmpty', 'Restart the API to capture a seed fingerprint, then drift interpretation appears here.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.cleanBody', 'The live schema matches the recorded seed fingerprint. Migrations and the seed are in sync — no action required.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.changeTables', 'Tables {{delta}}', { delta: formatSchemaDelta(drift.table_count_delta) })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.changeColumns', 'Columns {{delta}}', { delta: formatSchemaDelta(drift.column_count_delta) })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.changeIndexes', 'Indexes {{delta}}', { delta: formatSchemaDelta(drift.index_count_delta) })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.driftedBodyCounts', 'The live schema differs from the seed: {{changes}}.', { changes: changes.join(' · ') })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.driftedBodyHash', 'The live schema fingerprint differs from the seed even though object counts match — inspect column definitions or index expressions.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.remediateSeed', 'Confirm migrations are applied, then restart the API to regenerate the seed fingerprint.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaGuidance.tsx",
    "t('admin.schemaDrift.remediateDdl', 'If migrations are already current, investigate raw DDL that bypassed the migration system.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "t('admin.schemaDrift.kpis', 'Schema drift summary')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "t('admin.schemaDrift.statusHint', 'Current schema vs recorded seed')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "t('admin.schemaDrift.tableDelta', 'Tables Δ')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "t('admin.schemaDrift.columnDelta', 'Columns Δ')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "t('admin.schemaDrift.indexDelta', 'Indexes Δ')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "t('admin.schemaDrift.statusDrifted', 'Drift detected')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "t('admin.schemaDrift.statusClean', 'No drift')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SchemaKpis.tsx",
    "t('admin.schemaDrift.deltaSub', '{{current}} current · {{expected}} expected', {\r\n          current: count(current), expected: count(expected),\r\n        })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQueryAnalysis.tsx",
    "t('admin.slowQueries.chartTitle', 'Top queries by {{metric}}', { metric: metricLabel })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQueryAnalysis.tsx",
    "t('admin.slowQueries.analysis', 'Query analysis')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQueryAnalysis.tsx",
    "t('admin.slowQueries.chartAria', 'Horizontal bar chart ranking the top queries by {{metric}}', { metric: metricLabel })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQueryAnalysis.tsx",
    "t('admin.slowQueries.noChart', 'No queries to chart yet.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQueryAnalysis.tsx",
    "t('admin.slowQueries.cacheTitle', 'Cache efficiency')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQueryAnalysis.tsx",
    "t('admin.slowQueries.noCache', 'No shared-buffer statistics available for these queries.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQueryAnalysis.tsx",
    "t('admin.slowQueries.cacheHint', 'Lowest hit ratios first — I/O-bound queries are the strongest indexing candidates.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpis', 'Query performance summary')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiAnalyzed', 'Queries analyzed')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiCallsSub', 'Across shown queries')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiCallsSub', 'Across shown queries')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiCallsSub', 'Across shown queries')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiCallsSub', 'Across shown queries')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiTotalTime', 'Aggregate time')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiTotalTimeSub', 'Summed total_time')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiTotalTimeSub', 'Summed total_time')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiSlowestMean', 'Slowest mean')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiSlowestMeanSub', 'Worst per-call average')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiSlowestMeanSub', 'Worst per-call average')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiPeak', 'Peak max')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiPeakSub', 'Slowest single call')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiPeakSub', 'Slowest single call')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiCache', 'Cache hit ratio')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiCacheSub', 'Shared-buffer hits')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/SlowQuerySummary.tsx",
    "t('admin.slowQueries.kpiCacheSub', 'Shared-buffer hits')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/VehicleCostTalkers.tsx",
    "t('admin.vehicleCost.topTalkersTitle', 'Top talkers')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/TopTalkersPanel.tsx",
    "t('admin.vehicleCost.topTalkersTitle', 'Top talkers')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/VehicleCostTalkers.tsx",
    "t('admin.vehicleCost.topTalkersSubtitle', 'Share of total rows ingested')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/TopTalkersPanel.tsx",
    "t('admin.vehicleCost.topTalkersSubtitle', 'Share of total rows ingested')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/VehicleCostTalkers.tsx",
    "t('admin.vehicleCost.topTalkersEmpty', 'No vehicles have ingested signals yet.')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/TopTalkersPanel.tsx",
    "t('admin.vehicleCost.topTalkersEmpty', 'No vehicles have ingested signals yet.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-1/VehicleCostTalkers.tsx",
    "t('admin.vehicleCost.topTalkersListLabel', 'Top talkers ranked by ingested rows')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/TopTalkersPanel.tsx",
    "t(\n            'admin.vehicleCost.topTalkersListLabel',\n            'Top talkers ranked by ingested rows',\n          )"
  ],
  [
    "web/src/features/admin/components/continuation-admin-2/AuditExpandedDetail.tsx",
    "t('admin.auditLog.detailIp', 'IP')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-2/AuditExpandedDetail.tsx",
    "t('admin.auditLog.detailUa', 'User-agent')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-2/AuditExpandedDetail.tsx",
    "t('admin.auditLog.detailHash', 'Row hash')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.col.column', 'Column')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.col.dualWrite', 'Dual write')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.dualWrite.yes', 'signal_log')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.subscribed.yes', 'yes')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.subscribed.yes', 'yes')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.col.subscribed', 'Subscribed')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.category.totalFields', '{{count}} routed fields', { count: category.total_fields ?? 0 })"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.category.noMatch', 'No fields match the current filter.')"
  ],
  [
    "web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx",
    "t('coverage.category.empty', 'This category has no routed fields.')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.title', 'Developer tools overview')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.title', 'Developer tools overview')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.affectedVins', 'affected VINs')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.affectedVins', 'affected VINs')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.inFleet', 'in fleet')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.inFleet', 'in fleet')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.fleetEndpoints', 'Fleet API endpoints')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.fleetEndpoints', 'Fleet API endpoints')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.documented', 'documented')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.documented', 'documented')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.telemetrySignals', 'Telemetry signals')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.telemetrySignals', 'Telemetry signals')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.streamedFields', 'streamed fields')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.streamedFields', 'streamed fields')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.referenceDocs', 'Reference docs')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.referenceDocs', 'Reference docs')"
  ],
  [
    "web/src/features/admin/components/devtools/DevToolsOverview.tsx",
    "t('devtools.overview.externalLinks', 'external links')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.overview.externalLinks', 'external links')"
  ],
  [
    "web/src/features/admin/components/devtools/FleetApiSection.tsx",
    "t('devtools.errorsIdle', 'Click View Errors to fetch recent Fleet Telemetry errors for this vehicle.')"
  ],
  [
    "web/src/features/admin/components/devtools/FleetApiSection.tsx",
    "t('devtools.errorsEmpty', 'No Fleet Telemetry errors reported for this vehicle.')"
  ],
  [
    "web/src/features/admin/components/devtools/FleetApiSection.tsx",
    "t('devtools.errorsRaw', 'Show raw Tesla response')"
  ],
  [
    "web/src/features/admin/components/devtools/FleetApiSection.tsx",
    "t('devtools.vehicleDataIdle', 'Choose a vehicle and an action to see results.')"
  ],
  [
    "web/src/features/admin/components/devtools/FleetApiSection.tsx",
    "t('devtools.onboarding.goToStep', 'Go to step {{step}}: {{label}}', { step: i + 1, label: s.label })"
  ],
  [
    "web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx",
    "t('devtools.health.errorVinsResource', 'telemetry error VINs')"
  ],
  [
    "web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx",
    "t('devtools.health.errorLogResource', 'telemetry error log')"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "t('devtools.infra.mqttDesc', 'Publish a test message to the MQTT broker')"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "t('devtools.infra.sendTest', 'Send test')"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "t('devtools.infra.dbStats', 'DB stats')"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "t('devtools.infra.dbStatsDesc', 'Inspect TimescaleDB table sizes and row counts')"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "t('devtools.infra.migrationsDesc', 'View applied and pending database migrations')"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "t('devtools.infra.envCheck', 'Env check')"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "t('devtools.infra.envCheckDesc', 'Verify required environment variables are configured')"
  ],
  [
    "web/src/features/admin/components/devtools/InfrastructureSection.tsx",
    "t('devtools.infra.runtimeDesc', 'Inspect Go runtime, memory, and goroutine stats')"
  ],
  [
    "web/src/features/admin/components/devtools/ReferenceLinksSection.tsx",
    "t('devtools.ref.empty', 'No reference links available')"
  ],
  [
    "web/src/features/admin/components/devtools/tools/Base64Tool.tsx",
    "t('devtools.utils.base64PlaceholderEncode', 'Hello World')"
  ],
  [
    "web/src/features/admin/components/devtools/tools/Base64Tool.tsx",
    "t('devtools.utils.base64Mode', 'Conversion mode')"
  ],
  [
    "web/src/features/admin/components/devtools/tools/JsonFormatter.tsx",
    "t('devtools.utils.jsonInput', 'JSON input')"
  ],
  [
    "web/src/features/admin/components/devtools/tools/JsonFormatter.tsx",
    "t('devtools.utils.jsonEmpty', 'Paste JSON above to validate and pretty-print it.')"
  ],
  [
    "web/src/features/admin/components/devtools/tools/UrlEncoder.tsx",
    "t('devtools.url.modeGroup', 'Encoding mode')"
  ],
  [
    "web/src/features/admin/components/dlq-inspector/EntriesTable.tsx",
    "t('admin.dlq.actions.inspectRow', 'Inspect DLQ entry {{id}}', {\n              id: row.id,\n            })"
  ],
  [
    "web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx",
    "t('admin.dlq.drawer.payloadView', 'Payload view')"
  ],
  [
    "web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx",
    "t('admin.dlq.drawer.loading', 'Loading payload details…')"
  ],
  [
    "web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx",
    "t('admin.dlq.drawer.loading', 'Loading payload details…')"
  ],
  [
    "web/src/features/admin/components/dlq-inspector/ReasonBreakdown.tsx",
    "t('admin.dlq.reasons.listLabel', 'Failure reasons breakdown')"
  ],
  [
    "web/src/features/admin/components/feature-flags/FlagCompositionPanel.tsx",
    "t('admin.flags.composition.ariaLabel', 'Flag value-type composition')"
  ],
  [
    "web/src/features/admin/components/feature-flags/FlagsTable.tsx",
    "t('admin.flags.actions.editFlag', 'Edit flag {{key}}', {\n                key: row.key,\n              })"
  ],
  [
    "web/src/features/admin/components/feature-flags/FlagsTable.tsx",
    "t('admin.flags.actions.deleteFlag', 'Delete flag {{key}}', {\n                key: row.key,\n              })"
  ],
  [
    "web/src/features/admin/components/feedback-queue/BridgeStatus.tsx",
    "t('feedback.queue.bridge.title', 'GitHub bridge')"
  ],
  [
    "web/src/features/admin/components/feedback-queue/CategoryMix.tsx",
    "t('feedback.category.mixLabel', 'Feedback category mix')"
  ],
  [
    "web/src/features/admin/components/feedback-queue/StatusDistribution.tsx",
    "t(\n          'feedback.queue.distAria',\n          'Status distribution: {{new}} new, {{triaged}} triaged, {{closed}} closed',\n          { new: counts.new ?? 0, triaged: counts.triaged ?? 0, closed: counts.closed ?? 0 },\n      )"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRArtifactDetails.tsx",
    "t('admin.gdprExport.metaTitle', 'Artifact details')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRArtifactDetails.tsx",
    "t('admin.gdprExport.metaUser', 'User')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRArtifactDetails.tsx",
    "t('admin.gdprExport.metaSha256', 'SHA-256')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRArtifactDetails.tsx",
    "t(\n            'admin.gdprExport.metaEmpty',\n            'Look up an export artifact to see its metadata here.',\n          )"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx",
    "t(\n              'admin.gdprExport.downloadHint',\n              'The bundle streams from the backend through this browser. The download counter is logged to the audit ledger.',\n            )"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx",
    "t('admin.gdprExport.downloadButton', 'Download bundle')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx",
    "t('admin.gdprExport.downloadWait', 'Download becomes available once the export completes.')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx",
    "t('admin.gdprExport.downloadExpired', 'This artifact has expired and is no longer downloadable.')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRDownloadPanel.tsx",
    "t('admin.gdprExport.downloadFailed', 'No bundle available — see the error above.')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLifecyclePanel.tsx",
    "t('admin.gdprExport.lifecycle.failedGeneric', 'Export did not finish')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLifecyclePanel.tsx",
    "t('admin.gdprExport.lifecycleTitle', 'Lifecycle')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLifecyclePanel.tsx",
    "t('admin.gdprExport.lifecycleEmpty', 'No lifecycle events recorded yet.')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx",
    "t('admin.gdprExport.lookupTitle', 'Lookup artifact')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx",
    "t('admin.gdprExport.idLabel', 'Artifact ID')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx",
    "t('admin.gdprExport.idPlaceholder', 'e.g. 8f4c…')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx",
    "t('admin.gdprExport.lookupButton', 'Look up')"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx",
    "t(\n              'admin.gdprExport.lookupHint',\n              'IDs come from the GDPR export queue email or the request response. The artifact polls while queued/running.',\n            )"
  ],
  [
    "web/src/features/admin/components/gdpr-export/GDPRLookupPanel.tsx",
    "t(\n              'admin.gdprExport.lookupBlurb',\n              'Bundles are streamed straight from the backend and expire after the configured retention window. Look one up to track its status live.',\n            )"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t('impersonation.policy.audit.title', 'Every session is audit-logged')"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t(\n          'impersonation.policy.audit.body',\n          'Starting and ending a session writes an immutable entry to the admin audit log with the actor and the target.',\n        )"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t('impersonation.policy.ttl.title', '15-minute time limit')"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t(\n          'impersonation.policy.ttl.body',\n          'A session expires automatically after 15 minutes so a forgotten session cannot linger.',\n        )"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t('impersonation.policy.sudo.title', 'Step-up auth to start')"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t(\n          'impersonation.policy.sudo.body',\n          'Starting a session requires a fresh re-authentication prompt; ending one never does.',\n        )"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t('impersonation.policy.forwardAuth.title', 'Forward-auth required')"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t(\n          'impersonation.policy.forwardAuth.body',\n          'Per-subject identity only exists when the proxy runs in forward-auth mode. Open-mode installs cannot impersonate.',\n        )"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t('impersonation.policy.exit.title', 'End it any time')"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t(\n          'impersonation.policy.exit.body',\n          'The global banner at the top of the screen ends the active session immediately and restores your own view.',\n        )"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t('impersonation.policy.title', 'How impersonation works')"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t(\n            'impersonation.policy.intro',\n            'Impersonation lets an admin view TeslaSync exactly as another subject to reproduce a support issue. It is deliberately constrained:',\n          )"
  ],
  [
    "web/src/features/admin/components/ImpersonationPolicyPanel.tsx",
    "t('impersonation.policy.listLabel', 'Impersonation guarantees')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayHeader.tsx",
    "t('admin.xray.kpis', 'Ingest summary metrics')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/IngestOperationalBrief.tsx",
    "t('admin.xray.kpis', 'Ingest summary metrics')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayHeader.tsx",
    "t('admin.xray.stats.peak', 'Peak / bucket')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/ingestMetrics.ts",
    "t('admin.xray.stats.peak', 'Peak / bucket')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayHeader.tsx",
    "t('admin.xray.stats.peakSub', 'busiest interval')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/ingestMetrics.ts",
    "t('admin.xray.stats.peakSub', 'busiest interval')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayHeader.tsx",
    "t('admin.xray.stats.avg', 'Avg / bucket')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/ingestMetrics.ts",
    "t('admin.xray.stats.avg', 'Avg / bucket')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayHeader.tsx",
    "t('admin.xray.stats.avgSub', 'mean per interval')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/ingestMetrics.ts",
    "t('admin.xray.stats.avgSub', 'mean per interval')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayHeader.tsx",
    "t('admin.xray.stats.bucketSub', 'aggregation interval')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/ingestMetrics.ts",
    "t('admin.xray.stats.bucketSub', 'aggregation interval')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayTopFields.tsx",
    "t('admin.xray.topFields.title', 'Top fields by volume')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayTopFields.tsx",
    "t('admin.xray.topFields.title', 'Top fields by volume')"
  ],
  [
    "web/src/features/admin/components/ingest-xray/XRayTopFields.tsx",
    "t(\n            'admin.xray.topFields.empty',\n            'No field activity in this window yet.',\n          )"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalKindBreakdown.tsx",
    "t('admin.liveSignals.panels.kinds', 'Signal kinds')"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalKindBreakdown.tsx",
    "t('admin.liveSignals.panels.kinds', 'Signal kinds')"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalKindBreakdown.tsx",
    "t('admin.liveSignals.panels.kinds', 'Signal kinds')"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalKindBreakdown.tsx",
    "t(\n          'admin.liveSignals.kinds.noVehicle',\n          'Select a vehicle to break its signals down by value kind.',\n        )"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalKindBreakdown.tsx",
    "t(\n          'admin.liveSignals.kinds.empty',\n          'No live signals to categorise yet.',\n        )"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalKindBreakdown.tsx",
    "t(\n            'admin.liveSignals.kinds.chartAria',\n            'Bar chart of live signal counts grouped by value kind.',\n          )"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalSourceBreakdown.tsx",
    "t(\n    'admin.liveSignals.sources.barAria',\n    'Signal source-layer distribution: {{l1}} live, {{stale}} stale, {{l2}} legacy, {{unknown}} unknown',\n    {\n      l1: sourceCounts?.l1 ?? 0,\n      stale: sourceCounts?.stale ?? 0,\n      l2: sourceCounts?.l2 ?? 0,\n      unknown: sourceCounts?.unknown ?? 0,\n    },\n  )"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalSourceBreakdown.tsx",
    "t(\n          'admin.liveSignals.sources.noVehicle',\n          'Select a vehicle to see how its signals are distributed across the L1 / L2 / stale layers.',\n        )"
  ],
  [
    "web/src/features/admin/components/live-signal-inspector/LiveSignalSourceBreakdown.tsx",
    "t(\n          'admin.liveSignals.sources.empty',\n          'No live signals to classify yet.',\n        )"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/AdminSummary.tsx",
    "t('admin.operationalSummary.refreshing', 'Refreshing sources')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/AdminSummary.tsx",
    "t('admin.operationalSummary.partial', 'Independent source availability')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/AdminSummary.tsx",
    "t('admin.operationalSummary.empty', 'Empty source')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/AdminSummary.tsx",
    "t('admin.operationalSummary.unknown', 'Source not loaded')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/AdminSummary.tsx",
    "t('admin.operationalSummary.loaded', 'Sources loaded')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.summary.source', 'Telemetry errors and fleet size use independent live queries. Endpoint, signal and reference counts describe the local developer catalogs, not live coverage.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.summary.liveTitle', 'Live fleet snapshot')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.summary.liveSource', 'Telemetry errors count affected VINs; fleet size comes from the independent vehicle inventory.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.summary.liveScope', 'Independent live snapshots; observation bounds are not supplied.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.summary.catalogTitle', 'Local developer catalog')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.summary.catalogSource', 'Counts use the same local endpoint, telemetry-field and reference-link definitions shown in the developer tabs.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/DevToolsBrief.tsx",
    "t('devtools.summary.catalogScope', 'Static bundled reference definitions, not measured live coverage.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/FleetAPIBrief.tsx",
    "t('fleetApi.kpis.apiStatus', 'API status')"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPISummary.tsx",
    "t('fleetApi.kpis.apiStatus', 'API status')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/FleetAPIBrief.tsx",
    "t('fleetApi.kpis.endpointsEnabled', 'Endpoints enabled')"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPISummary.tsx",
    "t('fleetApi.kpis.endpointsEnabled', 'Endpoints enabled')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/FleetAPIBrief.tsx",
    "t('fleetApi.summary.selected', 'Selected for polling')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/FleetAPIBrief.tsx",
    "t('fleetApi.kpis.label', 'Fleet API summary')"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPISummary.tsx",
    "t('fleetApi.kpis.label', 'Fleet API summary')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/FleetAPIBrief.tsx",
    "t('fleetApi.summary.source', 'API status uses application settings and polling configuration. Enabled and selected-for-polling counts use the returned endpoint catalog, independent of the endpoint table filters.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/FleetAPIBrief.tsx",
    "t('fleetApi.summary.scope', 'Settings and polling snapshots; no shared observation time is reported.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/GasPriceBrief.tsx",
    "t('gas.summary.title', 'Polling status and price')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/GasPriceBrief.tsx",
    "t('gas.summary.source', 'Auto-poll status, current prices and last poll time use the status response. Prices keep their source per-volume and per-kWh denominations; the history chart is a separate source.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-a-g/GasPriceBrief.tsx",
    "t('gas.summary.scope', 'Current polling-status snapshot; an exact observation time and price coverage window are not reported.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/RbacOperationalBrief.tsx",
    "t('rbac.brief.scope', 'Saved provider bindings and permissions for your current authenticated roles; unsaved edits are not included.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SecurityOperationalBrief.tsx",
    "t('admin.security.brief.sentry', 'Percentage of returned security-event samples with Sentry active; not time-weighted uptime or complete vehicle coverage.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SecurityStatisticsBrief.tsx",
    "t('admin.security.brief.sentry', 'Percentage of returned security-event samples with Sentry active; not time-weighted uptime or complete vehicle coverage.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SecurityOperationalBrief.tsx",
    "t('admin.security.brief.lastLock', 'Latest observed lock transition in the returned history, or the first event timestamp when no transition is found.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SecurityOperationalBrief.tsx",
    "t('admin.security.brief.title', 'Security observation summary')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SecurityOperationalBrief.tsx",
    "t('admin.security.brief.freshness', 'Latest security observation: {{when}}', { when: observedAt ?? '—' })"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SubjectsOperationalBrief.tsx",
    "t('impersonation.users.brief.scope', 'Current impersonation status and available session subjects are independent sources. Open mode disables subject discovery.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SubjectsOperationalBrief.tsx",
    "t('impersonation.users.kpi.available', 'Available subjects')"
  ],
  [
    "web/src/features/admin/pages/UsersPage.tsx",
    "t('impersonation.users.kpi.available', 'Available subjects')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SubjectsOperationalBrief.tsx",
    "t('impersonation.users.kpi.limit', 'Session limit')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SubjectsOperationalBrief.tsx",
    "t('impersonation.users.brief.limit', 'Configured policy limit of 15 minutes, not the active session’s remaining time.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SubjectsOperationalBrief.tsx",
    "t('impersonation.users.brief.title', 'Subject and session posture')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SubjectsOperationalBrief.tsx",
    "t('impersonation.users.brief.provenance', 'Authenticated-session telemetry and impersonation policy')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SystemOperationalBrief.tsx",
    "t('system.brief.scope', 'Budget usage spans each source throttle window. Worker heartbeat and backlog are snapshots; succeeded and terminally failed jobs cover the last 24 hours.')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SystemOperationalBrief.tsx",
    "t('system.brief.title', 'Budgets and worker posture')"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SystemOperationalBrief.tsx",
    "t('system.brief.freshness', 'Budget snapshot: {{rate}} · Worker snapshot: {{queue}}', {\r\n        rate: rateLimit.data?.generated_at ?? '—', queue: queue.data?.generated_at ?? '—',\r\n      })"
  ],
  [
    "web/src/features/admin/components/operationalbrief-r-z/SystemOperationalBrief.tsx",
    "t('system.brief.provenance', 'Rate-limit budgets and background-worker queue reports')"
  ],
  [
    "web/src/features/admin/components/ResponseViewer.tsx",
    "t('playground.codeSnippetContent', 'Generated code snippet')"
  ],
  [
    "web/src/features/admin/components/security-access/EventTimeline.tsx",
    "t('admin.security.timeline.unknownDesc', 'Vehicle state updated')"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/CoverageOperationalBrief.tsx",
    "t('coverage.stat.subscriptionCoverage', 'Subscription coverage')"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/CoverageOperationalBrief.tsx",
    "t('coverage.kpis', 'Coverage summary')"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "t('admin.secretRotation.kindCount', '{{count}} kinds tracked', {\r\n        count: new Set(items.map(row => row.kind)).size,\r\n      })"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.kindCount', '{{count}} kinds tracked', { count: distinctKinds })"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "t('admin.secretRotation.okSub', '{{pct}} of tracked', {\r\n        pct: total ? `${Math.round((count('ok')! / total) * 100)}%` : '—',\r\n      })"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.okSub', '{{pct}} of tracked', { pct: okPct })"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "t('admin.secretRotation.warnSub', 'Approaching threshold')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.warnSub', 'Approaching threshold')"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "t('admin.secretRotation.criticalSub', 'Past critical threshold')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.criticalSub', 'Past critical threshold')"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "t('admin.secretRotation.oldestLabel', 'Oldest secret')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.oldestLabel', 'Oldest secret')"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "t('admin.secretRotation.soonestExpiryLabel', 'Soonest expiry')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.soonestExpiryLabel', 'Soonest expiry')"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "t('admin.secretRotation.noExpiry', 'No expiry tracked')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.noExpiry', 'No expiry tracked')"
  ],
  [
    "web/src/features/admin/components/statstrip-coverage-flags-secrets/SecretRotationOperationalBrief.tsx",
    "t('admin.secretRotation.kpis', 'Rotation summary')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.kpis', 'Rotation summary')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/redisMetrics.ts",
    "t('redis.cachedSignals', 'Cached signals')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.cachedSignals', 'Cached signals')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.cachedSignals', 'Cached signals')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/redisMetrics.ts",
    "t('redis.l1Subtitle', 'In-process store')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/redisMetrics.ts",
    "t('redis.l2Fields', 'L2 fields')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/redisMetrics.ts",
    "t('redis.l2Subtitle', 'Redis HSET')"
  ],
  [
    "web/src/features/admin/components/statstrip-ingest-dlq-redis/RedisOperationalBrief.tsx",
    "t('redis.kpis', 'Cache metrics')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.kpis', 'Fleet disk summary')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.growthSub', 'Sum across all hypertables')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.percentSub', '{{pct}} of total', { pct: pctOf(part, totals.total) })"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.fleetTotal', 'Total disk')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.fleetUncompressed', 'Uncompressed')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.fleetGrowth', 'Growth (per day)')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.largest', 'Largest table')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.soonestQuota', 'Soonest quota')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.colDays', 'Days to quota')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.colDays', 'Days to quota')"
  ],
  [
    "web/src/features/admin/components/statstrip-performance-storage/DiskForecastSummary.tsx",
    "t('admin.diskForecast.noQuota', 'No quota configured')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/auditLogColumns.tsx",
    "t('admin.auditLog.colEntity', 'Entity')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/auditLogColumns.tsx",
    "t('admin.auditLog.colTrace', 'Trace')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/auditLogColumns.tsx",
    "t('admin.auditLog.hideDetails', 'Hide')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx",
    "t('admin.auditLog.tableTitle', 'Entries')"
  ],
  [
    "web/src/features/admin/pages/AuditLogPage.tsx",
    "t('admin.auditLog.tableTitle', 'Entries')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx",
    "t('admin.auditLog.emptyTitle', 'No audit entries')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx",
    "t(\n                  'admin.auditLog.emptyMessage',\n                  'No rows match the current filter. Try widening the time range or clearing the filters.',\n                )"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx",
    "t('admin.auditLog.emptyTable', 'No entries')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogFilters.tsx",
    "t('admin.auditLog.untilLabel', 'Until')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogFilters.tsx",
    "t('admin.auditLog.actorPlaceholder', 'e.g. admin@local')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogFilters.tsx",
    "t('admin.auditLog.entityTypeLabel', 'Entity type')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogFilters.tsx",
    "t('admin.auditLog.entityTypePlaceholder', 'e.g. vehicle, alert_rule')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx",
    "t('admin.auditLog.integrityTitle', 'Hash chain integrity')"
  ],
  [
    "web/src/features/admin/pages/AuditLogPage.tsx",
    "t('admin.auditLog.integrityTitle', 'Hash chain integrity')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx",
    "t('admin.auditLog.verifyButton', 'Verify chain')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx",
    "t('admin.auditLog.chainIntact', 'Chain intact')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx",
    "t('admin.auditLog.chainBroken', 'Chain broken')"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx",
    "t('admin.auditLog.rowsChecked', '{{count}} rows checked', {\n                    count: verifyData.rows_checked,\n                  })"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx",
    "t('admin.auditLog.firstBadId', 'First bad row: #{{id}}', {\n                      id: verifyData.first_bad_id,\n                    })"
  ],
  [
    "web/src/features/admin/components/structural-closure/audit-log/AuditLogIntegrity.tsx",
    "t(\n                  'admin.auditLog.verifyHint',\n                  'Re-derive every row_hash server-side. No data is sent or written — this is read-only.',\n                )"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIConfiguredEndpoints.tsx",
    "t('fleetApi.configured.title', 'API endpoints')"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIConfiguredEndpoints.tsx",
    "t('fleetApi.configured.heading', 'Configured endpoints')"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIEndpointControls.tsx",
    "t('fleetApi.controls.title', 'API endpoint controls')"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIEndpointControls.tsx",
    "t('fleetApi.controls.enabledCount', '{{enabled}}/{{total}} enabled', { enabled: enabledCount, total: totalCount })"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIPolling.tsx",
    "t('fleetApi.polling.title', 'Tesla API polling')"
  ],
  [
    "web/src/features/admin/components/structural-closure/fleet-api/FleetAPIPolling.tsx",
    "t('fleetApi.polling.toggleAria', 'Toggle Tesla API polling')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.ageSection', 'Secret age and severity')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.ageTitle', 'Secret age by kind')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.ageAria', 'Horizontal bar chart of the oldest tracked secrets by age in days, colored by severity tier')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.noAgeData', 'No rotation ages to chart yet.')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.colAge', 'Age (days)')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.colAge', 'Age (days)')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t('admin.secretRotation.colAge', 'Age (days)')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(Number(v)) })"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationOutlook.tsx",
    "t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(r.days_to_expiry ?? 0) })"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(oldest.age_days) })"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(soonestExpiry.days_to_expiry) })"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.severityTitle', 'Severity mix')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.severityAria', 'Donut chart of tracked secrets grouped by rotation severity tier')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationCharts.tsx",
    "t('admin.secretRotation.noSeverity', 'No severity data available yet.')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t('admin.secretRotation.colRotated', 'Last rotated')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t('admin.secretRotation.daysToExpiry', '{{days}}d remaining', { days: r.days_to_expiry })"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t('admin.secretRotation.colThresholds', 'Warn / critical')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t('admin.secretRotation.tableTitle', 'Rotation status')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t('admin.secretRotation.tableTitle', 'Rotation status')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t('admin.secretRotation.emptyTitle', 'No tracked secrets')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t(\n                    'admin.secretRotation.emptyMessage',\n                    'No rotation events have been recorded yet. The tracker captures observations on every credential rotation.',\n                  )"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationDetails.tsx",
    "t('admin.secretRotation.emptyTable', 'No tracked secrets')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationOutlook.tsx",
    "t('admin.secretRotation.outlook', 'Rotation urgency and expiry outlook')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationOutlook.tsx",
    "t('admin.secretRotation.urgencyTitle', 'Rotation urgency')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationOutlook.tsx",
    "t('admin.secretRotation.noUrgency', 'No rotation ages to rank yet.')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationOutlook.tsx",
    "t('admin.secretRotation.expiryTitle', 'Expiry watch')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationOutlook.tsx",
    "t('admin.secretRotation.noExpiryTitle', 'No expiring credentials')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationOutlook.tsx",
    "t(\n                  'admin.secretRotation.noExpiryMessage',\n                  'None of the tracked secrets carry a hard expiry date. Rotation is driven by age thresholds instead.',\n                )"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.totalLabel', 'Tracked secrets')"
  ],
  [
    "web/src/features/admin/components/structural-closure/secret-rotation/SecretRotationSummary.tsx",
    "t('admin.secretRotation.warnLabel', 'Rotate soon')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.colFingerprint', 'Query fingerprint')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.colCalls', 'Calls')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.colMean', 'Mean (ms)')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.colMax', 'Max (ms)')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.colTotal', 'Total (ms)')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.colCache', 'Cache hit ratio')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.tableTitle', 'Top queries')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.tableTitle', 'Top queries')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.emptyTitle', 'No slow queries')"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t(\n                    'admin.slowQueries.emptyMessage',\n                    'pg_stat_statements is empty or has been reset recently. Slow queries will accumulate here as the system processes load.',\n                  )"
  ],
  [
    "web/src/features/admin/components/structural-closure/slow-queries/SlowQueriesDetails.tsx",
    "t('admin.slowQueries.emptyTable', 'No slow queries')"
  ],
  [
    "web/src/features/admin/components/SubjectsTable.tsx",
    "t('impersonation.users.currentTarget', 'Current target')"
  ],
  [
    "web/src/features/admin/components/SubjectsTable.tsx",
    "t('impersonation.users.currentTarget', 'Current target')"
  ],
  [
    "web/src/features/admin/components/SubjectsTable.tsx",
    "t('impersonation.users.tableTitle', 'Active subjects')"
  ],
  [
    "web/src/features/admin/components/SubjectsTable.tsx",
    "t('impersonation.users.searchPlaceholder', 'Search subjects…')"
  ],
  [
    "web/src/features/admin/components/SubjectsTable.tsx",
    "t('impersonation.users.searchLabel', 'Search subjects')"
  ],
  [
    "web/src/features/admin/components/SubjectsTable.tsx",
    "t('impersonation.users.noMatch', 'No subjects match your search.')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/CostByVehicleChart.tsx",
    "t('admin.vehicleCost.chartTitle', 'Ingest cost by vehicle')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/CostByVehicleChart.tsx",
    "t('admin.vehicleCost.chartTitle', 'Ingest cost by vehicle')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/CostByVehicleChart.tsx",
    "t(\n          'admin.vehicleCost.chartAria',\n          'Horizontal bar chart of estimated ingest bytes per vehicle, largest consumer first.',\n        )"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/CostByVehicleChart.tsx",
    "t('admin.vehicleCost.chartEmpty', 'No ingest volume recorded in this window yet.')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/CostByVehicleChart.tsx",
    "t('admin.vehicleCost.colBytes', 'Bytes (est.)')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/CostByVehicleChart.tsx",
    "t('admin.vehicleCost.colBytes', 'Bytes (est.)')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx",
    "t('admin.vehicleCost.colBytes', 'Bytes (est.)')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx",
    "t('admin.vehicleCost.rowId', 'ID {{id}}', { id: fmtInt(r.vehicle_id) })"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx",
    "t('admin.vehicleCost.colFailures', 'DLQ (24h)')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx",
    "t('admin.vehicleCost.tableTitle', 'Per-vehicle breakdown')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx",
    "t('admin.vehicleCost.emptyTitle', 'No vehicle cost data')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx",
    "t(\n              'admin.vehicleCost.emptyMessage',\n              'No vehicles have ingested signals during this window.',\n            )"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostTable.tsx",
    "t('admin.vehicleCost.emptyTable', 'No vehicle cost data')"
  ],
  [
    "web/src/features/admin/components/vehicle-cost/VehicleCostToolbar.tsx",
    "t('admin.vehicleCost.refresh', 'Refresh vehicle cost data')"
  ],
  [
    "web/src/features/admin/hooks/useAuditLogPage.ts",
    "t('admin.auditLog.allActions', 'All actions')"
  ],
  [
    "web/src/features/admin/hooks/useFleetAPIPage.ts",
    "t('fleetApi.configured.api', 'API (internal)')"
  ],
  [
    "web/src/features/admin/hooks/useFleetAPIPage.ts",
    "t('fleetApi.configured.web', 'Web frontend')"
  ],
  [
    "web/src/features/admin/hooks/useFleetAPIPage.ts",
    "t('fleetApi.configured.oauthCallback', 'OAuth callback')"
  ],
  [
    "web/src/features/admin/hooks/useSecretRotationPage.ts",
    "t('admin.secretRotation.severityWarn', 'Rotate soon')"
  ],
  [
    "web/src/features/admin/pages/APIKeysPage.tsx",
    "t('apiKeys.summary.source', 'Counts are derived from the loaded API key inventory, including active, expired and administrator-access keys.')"
  ],
  [
    "web/src/features/admin/pages/APIKeysPage.tsx",
    "t('apiKeys.summary.scope', 'Loaded inventory snapshot; the response does not report an observation time.')"
  ],
  [
    "web/src/features/admin/pages/ApiLogsPage.tsx",
    "t('apiLogs.statusSuccess', '2xx success')"
  ],
  [
    "web/src/features/admin/pages/ApiLogsPage.tsx",
    "t('apiLogs.statusRedirect', '3xx redirect')"
  ],
  [
    "web/src/features/admin/pages/ApiLogsPage.tsx",
    "t('apiLogs.statusClientError', '4xx client error')"
  ],
  [
    "web/src/features/admin/pages/ApiLogsPage.tsx",
    "t('apiLogs.statusServerError', '5xx server error')"
  ],
  [
    "web/src/features/admin/pages/ApiLogsPage.tsx",
    "t('apiLogs.loadedPageScope', 'Newest first. Filters query all matching requests; exports include only this loaded page.')"
  ],
  [
    "web/src/features/admin/pages/ApiLogsPage.tsx",
    "t('apiLogs.inspectHint', 'Expand a request to inspect headers, bodies, and metadata.')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.networkError', 'Network error')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.kpi.total', 'Total endpoints')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.kpi.read', 'Read (GET)')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.kpi.write', 'Write ops')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.kpi.groups', 'API groups')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.refresh', 'Reload API spec')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.refresh', 'Reload API spec')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.spec', 'API spec')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.spec', 'API spec')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.kpis', 'API overview metrics')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.summary.specTitle', 'API specification')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.summary.specSource', 'Endpoint, read-operation, write-operation and group counts use the loaded API specification.')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.summary.specScope', 'Specification snapshot; no observation time is supplied.')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.summary.historyTitle', 'Recent local requests')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.summary.historySource', 'Request count and average latency use this browser’s saved request history, independently of specification availability.')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.summary.historyScope', 'Bounded local request history, not server-wide traffic or a fixed analysis window.')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.explorer', 'Endpoint explorer')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.noEndpoints', 'No endpoints found in the API spec')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.workspace', 'Request workspace')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.workspace', 'Request workspace')"
  ],
  [
    "web/src/features/admin/pages/ApiPlaygroundPage.tsx",
    "t('playground.request', 'Request')"
  ],
  [
    "web/src/features/admin/pages/AuditLogPage.tsx",
    "t(\n        'admin.auditLog.subtitle',\n        'Append-only audit ledger with SHA-256 hash chaining. Narrow the scope with the filter row and verify the chain to re-derive integrity on demand.',\n      )"
  ],
  [
    "web/src/features/admin/pages/AuditLogPage.tsx",
    "t(\n            'admin.auditLog.notConfigured',\n            'The audit log subsystem is not configured on this deployment.',\n          )"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.overview', 'Backup overview')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.summary.source', 'Configuration counts use the loaded configurations. Run counts, completion rate, last completed backup and storage size use the returned run list, not a server-wide total.')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.summary.scope', 'Independent configuration and run snapshots; run-list coverage and observation bounds are not supplied.')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.manage', 'Backup management')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.reliability', 'Reliability & storage')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.noRunsReliability', 'No backup runs to analyze yet.')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.completedVsTotal', 'Completed vs total')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.storageByProvider', 'Storage by provider')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.noStorage', 'No stored backups yet.')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.noErrors', 'No recent backup failures.')"
  ],
  [
    "web/src/features/admin/pages/BackupRestorePage.tsx",
    "t('backup.runN', 'Run #{{id}}', { id: run.id })"
  ],
  [
    "web/src/features/admin/pages/DevToolsPage.tsx",
    "t('devtools.tab.utilities', 'Utilities')"
  ],
  [
    "web/src/features/admin/pages/DevToolsPage.tsx",
    "t('devtools.refreshStatus', 'Refresh developer tools status')"
  ],
  [
    "web/src/features/admin/pages/DevToolsPage.tsx",
    "t('devtools.tools', 'Developer tool areas')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.colTable', 'Hypertable')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.colTable', 'Hypertable')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.chunkCount', '{{count}} chunks', { count: r.chunk_count ?? 0 })"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.colSplit', 'Uncompressed / compressed')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.compressedSuffix', 'compressed')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.colGrowth', 'Growth (per day)')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t(\n        'admin.diskForecast.subtitle',\n        'Per-hypertable disk usage with compressed/uncompressed split and days-to-quota estimate. Severity reflects the configured quota threshold.',\n      )"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t(\n            'admin.diskForecast.notConfigured',\n            'TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible.',\n          )"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.criticalTitle', 'Quota pressure')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t(\n            'admin.diskForecast.criticalMessage',\n            '{{count}} hypertable(s) are in the critical tier for their configured quota. Review retention, compression, or the quota threshold.',\n            { count: severityCounts.critical },\n          )"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.composition', 'Storage composition')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.compositionTitle', 'Compressed vs uncompressed')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.compositionTitle', 'Compressed vs uncompressed')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.compositionAria', 'Stacked bar chart of the largest hypertables split by uncompressed and compressed bytes')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.noComposition', 'No hypertable sizes to chart yet.')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.uncompressed', 'Uncompressed')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.uncompressed', 'Uncompressed')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.severityTitle', 'Severity mix')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.severityTitle', 'Severity mix')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.severityAria', 'Donut chart of hypertables grouped by quota severity tier')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.noSeverity', 'No severity data available yet.')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.outlook', 'Growth and quota outlook')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.growthTitle', 'Fastest-growing hypertables')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.noGrowth', 'No measurable daily growth yet.')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.quotaTitle', 'Days to quota')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.noQuotaTitle', 'No quota configured')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t(\n                  'admin.diskForecast.noQuotaMessage',\n                  'Set HYPERTABLE_QUOTA_BYTES to surface a days-to-quota estimate for each hypertable.',\n                )"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.daysValue', '{{days}} d', { days: fmtNumber(r.est_days_to_quota ?? 0) })"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.tableTitle', 'Hypertables')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.tableTitle', 'Hypertables')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.emptyTitle', 'No hypertables')"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t(\n                    'admin.diskForecast.emptyMessage',\n                    'No hypertables found in this database. The disk forecast surfaces TimescaleDB hypertables only.',\n                  )"
  ],
  [
    "web/src/features/admin/pages/DiskForecastPage.tsx",
    "t('admin.diskForecast.emptyTable', 'No hypertables')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.kpi.total', 'Total feedback')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.subtitle', 'Triage user-submitted bug reports and feature requests')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.kpis', 'Queue overview')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.summary.source', 'Whole-queue counts come from independent status and category queries, unaffected by the table filters. Total feedback sums new, triaged and closed counts only when all three are available.')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.summary.scope', 'Independent queue facet snapshots; no shared observation time or date bounds are reported.')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.triageProgress', 'Triage progress')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.noStatusData', 'No feedback to triage yet.')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.categoryMix', 'Category mix')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.noCategoryData', 'No categories to show yet.')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.tableTitle', 'Queue')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.tableTitle', 'Queue')"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.rowLabel', '{{category}}: {{title}}', {\n                    category: r.category,\n                    title: r.title || t('feedback.queue.untitled', 'Untitled feedback'),\n                  })"
  ],
  [
    "web/src/features/admin/pages/FeedbackQueuePage.tsx",
    "t('feedback.queue.untitled', 'Untitled feedback')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n        'coverage.subtitle',\n        'Package-derived snapshot of which Tesla proto fields the build routes and which the current subscription pushes. Sourced from routing.yaml and teslaconfig.Builder — no per-vehicle telemetry counts.',\n      )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.routing', 'Destination routing')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.destinations.title', 'Destination breakdown')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.destinations.title', 'Destination breakdown')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n                'coverage.destinations.help',\n                'Counts how many routed fields land in each storage destination. Fields routed with also_signal_log:true are counted under both their primary destination and signal_log, matching the runtime fan-out — totals may exceed the unique routed-fields count.',\n              )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.destinations.empty', 'No destinations reported.')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.destinations.routedFields', 'Routed fields')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.destinations.routedFields', 'Routed fields')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.legend.title', 'Reading this page')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n                'coverage.legend.intro',\n                'Each row is one Tesla telemetry field declared in routing.yaml. The dashes below mean \"not applicable\" for that field — they are expected, not missing data.',\n              )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.legend.columnLabel', 'Column')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n                    'coverage.legend.columnHelp',\n                    '— the typed destination column. A dash means the field is stored in signal_log, a generic key/value table where the field name itself is the key — there is no per-field column.',\n                  )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.legend.dualWriteLabel', 'Dual write')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n                    'coverage.legend.dualWriteHelp',\n                    '— marks fields written to both their primary table AND signal_log (for replay and historical reconstruction). A dash means single-write only, which is the normal case.',\n                  )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.legend.subscribedLabel', 'Subscribed')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n                    'coverage.legend.subscribedHelp',\n                    '— whether Tesla Fleet Telemetry is currently pushing this field to us. \"No\" means the writer is wired but the subscription request omits the field.',\n                  )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.orphans.title', 'Orphan fields detected')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n                    'coverage.orphans.help',\n                    'These routing.yaml entries reference Field names not present in protomodel.SignalsByName and not a strict prefix-extension of a compound parent. This is a deployment drift between the vendored Tesla proto and routing.yaml — investigate before relying on the affected destinations.',\n                  )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n                  'coverage.filter.placeholder',\n                  'Filter by field name, destination, or column…',\n                )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n                  'coverage.filter.placeholder',\n                  'Filter by field name, destination, or column…',\n                )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.filter.results', 'Showing {{shown}} of {{total}} categories', {\n                shown: filteredCategories.length,\n                total: categories.length,\n              })"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.loading', 'Loading routing snapshot…')"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t(\n              'coverage.empty',\n              'No categories returned. The embedded routing.yaml may be empty or the loader failed silently.',\n            )"
  ],
  [
    "web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx",
    "t('coverage.filterEmpty', 'No categories match the current filter.')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.storageLabel', 'Storage')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.refresh', 'Refresh artifact status')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t(\n        'admin.gdprExport.subtitle',\n        'Look up the status of a GDPR data export by artifact id and download the bundle when it completes. Bundles expire after the configured retention window.',\n      )"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.resourceName', 'Export artifact')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.resourceName', 'Export artifact')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t(\n              'admin.gdprExport.notConfigured',\n              'GDPR export subsystem is not configured on this deployment.',\n            )"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.emptyTitle', 'No artifact selected')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t(\n                  'admin.gdprExport.emptyMessage',\n                  'Enter an artifact ID above to look up its status. The page will keep refreshing until the export completes.',\n                )"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.notFoundTitle', 'Artifact not found')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t(\n              'admin.gdprExport.notFoundMessage',\n              'No artifact with that id exists, or it has been purged. Check the id and try again.',\n            )"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.kpis', 'Artifact summary')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.summary.source', 'Status, format, size, storage and lifecycle timestamps describe only the selected export artifact.')"
  ],
  [
    "web/src/features/admin/pages/GDPRExportPage.tsx",
    "t('admin.gdprExport.summary.scope', 'Selected artifact snapshot; creation and expiry are lifecycle events, not a shared analysis range.')"
  ],
  [
    "web/src/features/admin/pages/IngestXRayPage.tsx",
    "t('admin.xray.actions.refresh', 'Refresh ingest x-ray')"
  ],
  [
    "web/src/features/admin/pages/IngestXRayPage.tsx",
    "t('admin.xray.hero', 'Sample volume')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.searchLabel', 'Filter signals by name')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.cacheDiagnostics', 'Cache diagnostics')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.diagSelect', 'Select a vehicle to inspect its cache state')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.diagUnavailable', 'Cache diagnostics are unavailable for this vehicle')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.categories', 'Signal categories')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.catSelect', 'Select a vehicle to see its signal category mix')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.catEmpty', 'No categorized signals to summarize')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.cacheActions', 'Cache actions')"
  ],
  [
    "web/src/features/admin/pages/RedisSignalViewerPage.tsx",
    "t('redis.cacheActionsHint', 'Purge deletes the Redis L2 HSET only. The in-process L1 cache on each pod is untouched and refills from new telemetry.')"
  ],
  [
    "web/src/features/admin/pages/SchemaDriftPage.tsx",
    "t('admin.schemaDrift.subtitle', 'Current database schema fingerprint compared against the recorded seed. Drift indicates a migration ran without a seed refresh, or raw DDL bypassed the migration system.')"
  ],
  [
    "web/src/features/admin/pages/SchemaDriftPage.tsx",
    "t('admin.schemaDrift.notConfigured', 'The schema-drift subsystem is not configured on this deployment. Enable schema fingerprinting in config to populate this page.')"
  ],
  [
    "web/src/features/admin/pages/SecretRotationPage.tsx",
    "t(\n        'admin.secretRotation.subtitle',\n        'Status of every tracked credential. Severity reflects per-kind warn/critical thresholds; rotate anything in the critical tier as soon as possible.',\n      )"
  ],
  [
    "web/src/features/admin/pages/SecretRotationPage.tsx",
    "t(\n            'admin.secretRotation.notConfigured',\n            'The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page.',\n          )"
  ],
  [
    "web/src/features/admin/pages/SecretRotationPage.tsx",
    "t('admin.secretRotation.criticalTitle', 'Overdue rotations')"
  ],
  [
    "web/src/features/admin/pages/SecretRotationPage.tsx",
    "t(\n            'admin.secretRotation.criticalMessage',\n            '{{count}} secrets are past their critical rotation threshold. These should be rotated immediately to reduce blast radius.',\n            { count: counts.critical },\n          )"
  ],
  [
    "web/src/features/admin/pages/SecurityAccessPage.tsx",
    "t('admin.security.brief.historyScope', 'Returned security events for vehicle {{vehicle}}, {{start}} to {{end}} (exclusive); statistics describe event samples, not a complete time-weighted history.', {\n    vehicle: activeId || '—', start: startInstant, end: endInstantExclusive,\n  })"
  ],
  [
    "web/src/features/admin/pages/SlowQueriesPage.tsx",
    "t(\n        'admin.slowQueries.subtitle',\n        'Top queries from pg_stat_statements. Sort by mean time to surface the slowest individual calls, or total time to surface the costliest in aggregate.',\n      )"
  ],
  [
    "web/src/features/admin/pages/SlowQueriesPage.tsx",
    "t(\n            'admin.slowQueries.notConfigured',\n            'pg_stat_statements is not installed on this PostgreSQL instance. Run `CREATE EXTENSION pg_stat_statements;` and add it to shared_preload_libraries to enable this page.',\n          )"
  ],
  [
    "web/src/features/admin/pages/UsersPage.tsx",
    "t('impersonation.users.kpi.modeForwardAuth', 'Forward-auth')"
  ],
  [
    "web/src/features/admin/pages/UsersPage.tsx",
    "t('impersonation.users.kpiLabel', 'Impersonation summary')"
  ],
  [
    "web/src/features/admin/pages/UsersPage.tsx",
    "t('impersonation.users.mainLabel', 'Subjects and session status')"
  ],
  [
    "web/src/features/admin/pages/VehicleCostPage.tsx",
    "t(\n        'admin.vehicleCost.subtitle',\n        'Per-vehicle telemetry cost over the selected window. Use this to spot vehicles whose ingest volume is disproportionate to the fleet baseline.',\n      )"
  ],
  [
    "web/src/features/admin/pages/VehicleCostPage.tsx",
    "t(\n              'admin.vehicleCost.notConfigured',\n              'The ingest-x-ray subsystem is not configured on this deployment. Vehicle cost reporting requires the signal_log hypertable to be populated.',\n            )"
  ],
  [
    "web/src/features/admin/pages/VehicleCostPage.tsx",
    "t('admin.vehicleCost.breakdownRegion', 'Ingest cost breakdown')"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactChart.tsx",
    "t(\r\n        'firmwareImpact.noData',\r\n        'No update yet has enough drives on both sides of it to support a comparison. This fills in as you drive after each install.',\r\n      )"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactChart.tsx",
    "t('firmwareImpact.col.delta', 'Δ Wh/km')"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactChart.tsx",
    "t('firmwareImpact.col.delta', 'Δ Wh/km')"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactChart.tsx",
    "t('firmwareImpact.col.share', 'Δ %')"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactChart.tsx",
    "t('firmwareImpact.col.p', 'p-value')"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactDetails.tsx",
    "t('firmwareImpact.detail', 'Version by version')"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactDetails.tsx",
    "t('help.firmwareImpact.iconLabel', 'More info about the verdicts')"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactDetails.tsx",
    "t(\r\n            'firmwareImpact.noDetail',\r\n            'Nothing to compare yet — each update needs drives recorded both before and after it.',\r\n          )"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactDetails.tsx",
    "t('firmwareImpact.whPerKmN', '{{v}} Wh/km · n={{n}}', {\r\n                      v: i.before.n > 0 ? Math.round(i.before.meanWhPerKm) : '—',\r\n                      n: i.before.n,\r\n                    })"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactDetails.tsx",
    "t('firmwareImpact.whPerKmN', '{{v}} Wh/km · n={{n}}', {\r\n                      v: i.after.n > 0 ? Math.round(i.after.meanWhPerKm) : '—',\r\n                      n: i.after.n,\r\n                    })"
  ],
  [
    "web/src/features/analytics/components/firmware-impact-modernization/FirmwareImpactDetails.tsx",
    "t('firmwareImpact.stats', 'p · d')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/DigestOperationalSummary.tsx",
    "t('analytics.weeklyDigest.funFactDesc', '≈ {{times}}× {{from}} → {{to}}', {\r\n      times: funFact.times, from: funFact.from, to: funFact.to,\r\n    })"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx",
    "t(\n                'analytics.weeklyDigest.funFactDesc',\n                '≈ {{times}}× {{from}} → {{to}}',\n                { times: funFact.times, from: funFact.from, to: funFact.to },\n              )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/DigestSummary.tsx",
    "t('analytics.weeklyDigest.funFactDesc', '≈ {{times}}× {{from}} → {{to}}', {\r\n          times: funFact.times,\r\n          from: funFact.from,\r\n          to: funFact.to,\r\n        })"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/DigestOperationalSummary.tsx",
    "t('analytics.weeklyDigest.brief.description', 'Available drive and charging records for the selected week, compared with the previous week.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/DigestOperationalSummary.tsx",
    "t('analytics.weeklyDigest.brief.retained', 'Retained or partial weekly records')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.brief.retained', 'Retained or partial weekly records')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/DigestOperationalSummary.tsx",
    "t('analytics.weeklyDigest.brief.unavailable', 'Weekly sources unavailable')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.brief.unavailable', 'Weekly sources unavailable')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/DigestOperationalSummary.tsx",
    "t('analytics.weeklyDigest.brief.loading', 'Loading weekly records')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.brief.loading', 'Loading weekly records')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/DigestOperationalSummary.tsx",
    "t('analytics.weeklyDigest.brief.available', 'Returned weekly records')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.brief.available', 'Returned weekly records')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdDistanceChange', 'FSD vs previous week')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t('analytics.weeklyDigest.fsdDistanceChange', 'FSD vs previous week')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t('analytics.weeklyDigest.fsdDistanceChange', 'FSD vs previous week')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdShareChange', 'Share vs previous week')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t('analytics.weeklyDigest.fsdShareChange', 'Share vs previous week')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t('analytics.weeklyDigest.fsdShareChange', 'Share vs previous week')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdHonesty', 'These are cumulative counter changes, not exact FSD engagement. Absence is not zero.')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t(\n              'analytics.weeklyDigest.fsdHonesty',\n              'These are cumulative counter changes, not exact FSD engagement. Absence is not zero.',\n            )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t(\r\n                'analytics.weeklyDigest.fsdHonesty',\r\n                'These are cumulative counter changes, not exact FSD engagement. Absence is not zero.',\r\n              )"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdSection', 'Supervised driving')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t('analytics.weeklyDigest.fsdSection', 'Supervised driving')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t('analytics.weeklyDigest.fsdSection', 'Supervised driving')"
  ],
  [
    "web/src/features/analytics/pages/WeeklyDigestPage.tsx",
    "t('analytics.weeklyDigest.fsdSection', 'Supervised driving')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.brief.fsdTitle', 'Supervised-driving evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.brief.fsdMissing', 'Supervised distance not measured')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdNotMeasured', 'No supervised-driving distance was measured this week.')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t(\n            'analytics.weeklyDigest.fsdNotMeasured',\n            'No supervised-driving distance was measured this week.',\n          )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t(\r\n              'analytics.weeklyDigest.fsdNotMeasured',\r\n              'No supervised-driving distance was measured this week.',\r\n            )"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdNotice', 'Reported FSD {{distance}}{{share}}{{change}}.', {\r\n          distance: formatDistance(distance),\r\n          share: share == null ? '' : t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', { value: fmtNumber(share) }),\r\n          change: shareChange == null ? '' : t('analytics.weeklyDigest.fsdNoticeChange', ', {{delta}} pts vs last week', {\r\n            delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,\r\n          }),\r\n        })"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t(\n                'analytics.weeklyDigest.fsdNotice',\n                'Reported FSD {{distance}}{{share}}{{change}}.',\n                {\n                  distance: formatDistance(fsdDistanceM),\n                  share: share == null\n                    ? ''\n                    : t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', {\n                        value: fmtNumber(share),\n                      }),\n                  change: shareChange == null\n                    ? ''\n                    : t(\n                        'analytics.weeklyDigest.fsdNoticeChange',\n                        ', {{delta}} pts vs last week',\n                        {\n                          delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,\n                        },\n                      ),\n                },\n              )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/useFsdWeeklyDigestNotification.ts",
    "t(\n          'analytics.weeklyDigest.fsdNotice',\n          'Reported FSD {{distance}}{{share}}{{change}}.',\n          {\n            distance: formatDistance(distanceM),\n            share: shareLabel,\n            change: changeLabel,\n          },\n        )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t(\r\n                  'analytics.weeklyDigest.fsdNotice',\r\n                  'Reported FSD {{distance}}{{share}}{{change}}.',\r\n                  {\r\n                    distance: formatDistance(fsdDistanceM),\r\n                    share: share == null\r\n                      ? ''\r\n                      : t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', {\r\n                          value: fmtNumber(share),\r\n                        }),\r\n                    change: shareChange == null\r\n                      ? ''\r\n                      : t('analytics.weeklyDigest.fsdNoticeChange', ', {{delta}} pts vs last week', {\r\n                          delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,\r\n                        }),\r\n                  },\r\n                )"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', { value: fmtNumber(share) })"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', {\n                        value: fmtNumber(share),\n                      })"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/useFsdWeeklyDigestNotification.ts",
    "t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', {\n          value: fmtNumber(share),\n        })"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', {\r\n                          value: fmtNumber(share),\r\n                        })"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/FsdOperationalPanel.tsx",
    "t('analytics.weeklyDigest.fsdNoticeChange', ', {{delta}} pts vs last week', {\r\n            delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,\r\n          })"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/FsdSection.tsx",
    "t(\n                        'analytics.weeklyDigest.fsdNoticeChange',\n                        ', {{delta}} pts vs last week',\n                        {\n                          delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,\n                        },\n                      )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/useFsdWeeklyDigestNotification.ts",
    "t('analytics.weeklyDigest.fsdNoticeChange', ', {{delta}} pts vs last week', {\n          delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,\n        })"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/FsdPanel.tsx",
    "t('analytics.weeklyDigest.fsdNoticeChange', ', {{delta}} pts vs last week', {\r\n                          delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,\r\n                        })"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx",
    "t('statistics.brief.batteryTitle', 'Battery estimate evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx",
    "t('statistics.brief.batteryDescription', 'Capacity, annual degradation rate, cycle count and source-reported age retain their distinct units.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx",
    "t('statistics.brief.retained', 'Retained statistics')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.retained', 'Retained statistics')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx",
    "t('statistics.brief.retained', 'Retained statistics')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx",
    "t('statistics.brief.available', 'Returned statistics')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.available', 'Returned statistics')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx",
    "t('statistics.brief.available', 'Returned statistics')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx",
    "t('statistics.brief.unavailable', 'Statistics unavailable')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.unavailable', 'Statistics unavailable')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx",
    "t('statistics.brief.unavailable', 'Statistics unavailable')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsBatteryBrief.tsx",
    "t('statistics.brief.batteryScope', 'Battery-health source estimates; observation bounds unknown')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.lifetime', 'Lifetime mileage')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.lifetime', 'Lifetime mileage')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.daily', 'Last 30 days divided by 30')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.projection', 'Last-30-day daily average multiplied by 365; projection, not a measured year')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.mileageDescription', 'Lifetime distance and drive counts alongside a last-30-day average and its yearly projection.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsMileageBrief.tsx",
    "t('statistics.brief.mixed', 'Mixed lifetime and last-30-day windows')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx",
    "t('statistics.brief.costDenominator', 'Recorded cost divided by source kilometres; not display-distance units.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx",
    "t('statistics.brief.periodDescription', 'Totals and averages from the period-statistics response; its observation bounds are not returned.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/StatisticsPeriodBrief.tsx",
    "t('statistics.brief.periodScope', 'Period-statistics source window; bounds unknown')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostEvidenceLedger.tsx",
    "t('tco.brief.description', 'Recorded charging costs and modeled gasoline costs have distinct source filters and modeled drive-span denominators.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostEvidenceLedger.tsx",
    "t('tco.brief.loading', 'Loading operating evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostSavingsEnvelope.tsx",
    "t('tco.brief.loading', 'Loading operating evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostEvidenceLedger.tsx",
    "t('tco.brief.paused', 'Evidence refresh paused')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostEvidenceLedger.tsx",
    "t('tco.brief.unavailable', 'Operating evidence unavailable')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostSavingsEnvelope.tsx",
    "t('tco.brief.unavailable', 'Operating evidence unavailable')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostEvidenceLedger.tsx",
    "t('tco.brief.retained', 'Retained operating evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostSavingsEnvelope.tsx",
    "t('tco.brief.retained', 'Retained operating evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostEvidenceLedger.tsx",
    "t('tco.brief.available', 'Returned operating evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostSavingsEnvelope.tsx",
    "t('tco.brief.available', 'Returned operating evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostEvidenceLedger.tsx",
    "t('tco.brief.scope', 'Lifetime source envelope; modeled first-to-last positive-drive span')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostSavingsEnvelope.tsx",
    "t('tco.brief.scope', 'Lifetime source envelope; modeled first-to-last positive-drive span')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/TrueCostSavingsEnvelope.tsx",
    "t('tco.brief.savingsDescription', 'Fuel comparison and the maintenance heuristic remain separate from their algebraic combination; none asserts verified net ownership savings.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearEnvironmentBrief.tsx",
    "t('yearReview.brief.environmentDescription', 'Reported calendar-year carbon offset with the existing tree-equivalent estimate.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearEnvironmentBrief.tsx",
    "t('yearReview.brief.retained', 'Retained year evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearPatternsBrief.tsx",
    "t('yearReview.brief.retained', 'Retained year evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearSavingsBrief.tsx",
    "t('yearReview.brief.retained', 'Retained year evidence')"
  ],
  [
    "web/src/features/analytics/pages/YearReviewPage.tsx",
    "t('yearReview.brief.retained', 'Retained year evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearEnvironmentBrief.tsx",
    "t('yearReview.brief.available', 'Recorded year evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearPatternsBrief.tsx",
    "t('yearReview.brief.available', 'Recorded year evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearSavingsBrief.tsx",
    "t('yearReview.brief.available', 'Recorded year evidence')"
  ],
  [
    "web/src/features/analytics/pages/YearReviewPage.tsx",
    "t('yearReview.brief.available', 'Recorded year evidence')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearPatternsBrief.tsx",
    "t('yearReview.brief.patternsDescription', 'Calendar-year driving averages; integer distance and efficiency retain the original specialist rounding.')"
  ],
  [
    "web/src/features/analytics/components/operationalbrief-n-z/YearSavingsBrief.tsx",
    "t('yearReview.brief.savingsDescription', 'Recorded electric cost and reported savings versus gasoline for the selected calendar year.')"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t('tco.ledger.delete', 'Delete entry')"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostLedgerColumns.tsx",
    "t('tco.ledger.delete', 'Delete entry')"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t('tco.ledger.title', 'Fixed-cost ledger')"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx",
    "t('tco.ledger.title', 'Fixed-cost ledger')"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t('tco.ledger.allIn', 'All-in: {{total}} ({{perKm}}/km)', {\n            total: formatCurrency(allInCost),\n            perKm: allInPerKm != null ? formatCurrency(allInPerKm) : '—',\n          })"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx",
    "t('tco.ledger.allIn', 'All-in: {{total}} ({{perKm}}/km)', {\r\n            total: formatCurrency(allInCost),\r\n            perKm: allInPerKm != null ? formatCurrency(allInPerKm) : '—',\r\n          })"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t(\n              'tco.ledger.empty',\n              'No fixed costs recorded. Add insurance, payments, or service below.',\n            )"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx",
    "t(\r\n              'tco.ledger.empty',\r\n              'No fixed costs recorded. Add insurance, payments, or service below.',\r\n            )"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t('tco.ledger.add', 'Record cost')"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostLedgerForm.tsx",
    "t('tco.ledger.add', 'Record cost')"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t('tco.ledger.addError', 'Failed to record cost')"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx",
    "t('tco.ledger.addError', 'Failed to record cost')"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t('tco.ledger.hint', '{{count}} entries · {{total}} fixed · {{km}} km lifetime', {\n              count: totals?.entries ?? 0,\n              total: formatCurrency(totals?.grand_total ?? 0),\n              km: fmtNumber(totalKm),\n            })"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx",
    "t('tco.ledger.hint', '{{count}} entries · {{total}} fixed · {{km}} km lifetime', {\r\n              count: totals?.entries ?? 0,\r\n              total: formatCurrency(totals?.grand_total ?? 0),\r\n              km: fmtNumber(totalKm),\r\n            })"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t('tco.ledger.deleteTitle', 'Delete this entry?')"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx",
    "t('tco.ledger.deleteTitle', 'Delete this entry?')"
  ],
  [
    "web/src/features/analytics/components/true-cost/TrueCostFixedLedger.tsx",
    "t('tco.ledger.deleteMessage', 'This removes the recorded cost from the ledger.')"
  ],
  [
    "web/src/features/analytics/components/true-cost-modernization/TrueCostFixedLedger.tsx",
    "t('tco.ledger.deleteMessage', 'This removes the recorded cost from the ledger.')"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/ChargingSection.tsx",
    "t(\n            'analytics.weeklyDigest.dailyEnergyChartLabel',\n            'Bar chart of daily charging energy in {{unit}}',\n            { unit: unitPrefs.energy },\n          )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/ChargingPanel.tsx",
    "t(\r\n        'analytics.weeklyDigest.dailyEnergyChartLabel',\r\n        'Bar chart of daily charging energy in {{unit}}',\r\n        { unit: unitPrefs.energy },\r\n      )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest/DrivingSection.tsx",
    "t(\n              'analytics.weeklyDigest.dailyDistanceChartLabel',\n              'Bar chart of daily driving distance in {{unit}}',\n              { unit: unitPrefs.distance },\n          )"
  ],
  [
    "web/src/features/analytics/components/weekly-digest-modernization/DrivingPanel.tsx",
    "t(\r\n          'analytics.weeklyDigest.dailyDistanceChartLabel',\r\n          'Bar chart of daily driving distance in {{unit}}',\r\n          { unit: unitPrefs.distance },\r\n        )"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.neutral', 'Direction is not scored')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.favorable', 'Favorable change')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.unfavorable', 'Unfavorable change')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.title', 'Period comparison evidence')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.description', 'Period A measurements with Period B baselines and semantic changes. The two source windows are independent.')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.retained', 'Retained comparison sources')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.paused', 'Comparison refresh paused')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.loading', 'Loading comparison')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.available', 'Both periods available')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.incomplete', 'Comparison incomplete')"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.windows', 'Period A: {{periodA}} · Period B: {{periodB}}', {\n                        periodA: periodOptions.find(option => option.value === periodA)?.label,\n                        periodB: periodOptions.find(option => option.value === periodB)?.label,\n                      })"
  ],
  [
    "web/src/features/analytics/pages/PeriodComparePage.tsx",
    "t('compare.brief.coverage', 'Period totals; continuous observation coverage is not reported.')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.title', 'Regime shifts')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.title', 'Regime shifts')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.title', 'Regime shifts')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.regimeCount', 'Regimes detected')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.overWeeks', 'over {{count}} weeks', { count: summary.analyzedWeeks })"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.currentRegime', 'Current regime')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.since', 'since {{date}}', { date: formatDateShort(latest.startWeek) })"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.lastShift', 'Last shift')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.noShifts', 'none detected')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.tempLink', 'Temp link')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.tempLinkHint', 'avg temp change at last shift')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.brief.status.partial', 'Partial drive history')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.brief.status.initialFailure', 'Drive history failed')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.subtitle', 'Statistical changepoints in your weekly consumption')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.subtitle', 'Statistical changepoints in your weekly consumption')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.kpis', 'Regime summary metrics')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.kpis', 'Regime summary metrics')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.kpis', 'Regime summary metrics')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.brief.eyebrow', 'Consumption evidence')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.chartHint', 'The stepped line is each regime’s mean; vertical lines mark detected shifts')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.noData', 'Not enough weekly history yet — six or more driving weeks are needed.')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.col.regime', 'Regime mean')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.regimeMean', 'Regime mean')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.shiftLog', 'Shift log')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.shiftLog', 'Shift log')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('help.regimeShifts.iconLabel', 'More info about changepoint detection')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.stable', 'No statistically significant shifts — your consumption regime has been stable.')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.stable', 'No statistically significant shifts — your consumption regime has been stable.')"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.shiftLine', 'Week of {{date}}: consumption moved {{delta}} {{unit}}', {\n                      date: formatDateShort(s.weekStart),\n                      delta: `${s.deltaWhPerKm > 0 ? '+' : ''}${toEff(s.deltaWhPerKm)}`,\n                      unit: effUnit,\n                    })"
  ],
  [
    "web/src/features/analytics/pages/RegimeShiftsPage.tsx",
    "t('regimes.tempBadge', 'avg temp {{delta}}°C', {\n                        delta: `${s.tempDeltaC > 0 ? '+' : ''}${s.tempDeltaC}`,\n                      })"
  ],
  [
    "web/src/features/analytics/pages/TimelinePage.tsx",
    "t('timeline.brief.retained', 'Retained state summary')"
  ],
  [
    "web/src/features/analytics/pages/TimelinePage.tsx",
    "t('timeline.brief.pausedRetained', 'State summary refresh paused')"
  ],
  [
    "web/src/features/analytics/pages/TimelinePage.tsx",
    "t('timeline.brief.available', 'Returned state summary')"
  ],
  [
    "web/src/features/analytics/pages/TimelinePage.tsx",
    "t('timeline.brief.paused', 'State summary paused')"
  ],
  [
    "web/src/features/analytics/pages/TimelinePage.tsx",
    "t('timeline.brief.loading', 'Loading state summary')"
  ],
  [
    "web/src/features/analytics/pages/TimelinePage.tsx",
    "t('timeline.brief.unavailable', 'State summary unavailable')"
  ],
  [
    "web/src/features/analytics/pages/WeeklyDigestPage.tsx",
    "t('dataSources.labels.fsdInsights', 'Supervised driving')"
  ],
  [
    "web/src/features/analytics/pages/YearReviewPage.tsx",
    "t('yearReview.brief.loading', 'Loading year evidence')"
  ],
  [
    "web/src/features/analytics/pages/YearReviewPage.tsx",
    "t('yearReview.brief.unavailable', 'Year evidence unavailable')"
  ],
  [
    "web/src/features/analytics/pages/YearReviewPage.tsx",
    "t('yearReview.brief.description', 'Calendar-year totals and records from the year-review response. Observation coverage is not reported.')"
  ],
  [
    "web/src/features/analytics/pages/YearReviewPage.tsx",
    "t('yearReview.brief.highlights', 'Calendar-year highlights')"
  ],
  [
    "web/src/features/analytics/pages/YearReviewPage.tsx",
    "t('yearReview.brief.extremes', 'Year extremes')"
  ],
  [
    "web/src/features/automations/components/automation-helper-source-closure/ActionCommandFields.tsx",
    "t(\r\n                  'automations.builder.commandParamsObjectError',\r\n                  'Params must be a JSON object.',\r\n                )"
  ],
  [
    "web/src/features/automations/components/RoutineWizard.tsx",
    "t('automations.routines.onEnter', 'On geofence enter')"
  ],
  [
    "web/src/features/automations/components/RoutineWizard.tsx",
    "t('automations.routines.onExit', 'On geofence exit')"
  ],
  [
    "web/src/features/automations/components/RoutineWizard.tsx",
    "t('automations.routines.installNamed', 'Install {{name}}', { name: routine.name })"
  ],
  [
    "web/src/features/automations/components/RoutineWizard.tsx",
    "t('automations.routines.resource', 'Geofence routines')"
  ],
  [
    "web/src/features/automations/components/RoutineWizard.tsx",
    "t('automations.routines.title', 'Geofence routines')"
  ],
  [
    "web/src/features/automations/components/RoutineWizard.tsx",
    "t('automations.routines.choosePlace', 'Choose a place…')"
  ],
  [
    "web/src/features/automations/components/RoutineWizard.tsx",
    "t('automations.routines.noPlaces', 'Create a geofence place first to install routines.')"
  ],
  [
    "web/src/features/automations/pages/AutomationListTable.tsx",
    "t('automationList.unnamed', 'Untitled automation')"
  ],
  [
    "web/src/features/automations/pages/AutomationListTable.tsx",
    "t('automationList.unnamed', 'Untitled automation')"
  ],
  [
    "web/src/features/automations/pages/AutomationListTable.tsx",
    "t('automationList.unnamed', 'Untitled automation')"
  ],
  [
    "web/src/features/automations/pages/AutomationListTable.tsx",
    "t('automationList.col.lastTriggered', 'Last triggered')"
  ],
  [
    "web/src/features/automations/pages/AutomationListTable.tsx",
    "t('automationList.loading', 'Loading automations…')"
  ],
  [
    "web/src/features/automations/pages/AutomationListTable.tsx",
    "t(\n            'automationList.empty.body',\n            'Create your first automation in the builder to manage it here.',\n          )"
  ],
  [
    "web/src/features/automations/pages/AutomationStatusPanel.tsx",
    "t('automationList.status.empty', 'No automations to summarize yet')"
  ],
  [
    "web/src/features/automations/pages/AutomationStatusPanel.tsx",
    "t(\n                'automationList.autoDisabled.body',\n                '{{count}} automation(s) were auto-disabled after repeated failures. Re-enable them from the builder once resolved.',\n                { count: autoDisabled },\n              )"
  ],
  [
    "web/src/features/automations/pages/PresetGallery.tsx",
    "t('automations.presets.installNamed', 'Install {{name}}', {\n          name: preset.name,\n        })"
  ],
  [
    "web/src/features/automations/pages/PresetGallery.tsx",
    "t('automations.presets.resource', 'Automation presets')"
  ],
  [
    "web/src/features/automations/pages/PresetGallery.tsx",
    "t('automations.presets.resource', 'Automation presets')"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/EnergySiteCard.tsx",
    "t('energy.products.capabilities', 'Capabilities')"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/helpers.ts",
    "t('energy.products.resourceType.powerwall', 'Powerwall')"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/helpers.ts",
    "t('energy.siteInfo.mode.selfConsumption', 'Self-Powered')"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/helpers.ts",
    "t('energy.siteInfo.mode.autonomous', 'Time-Based Control')"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/helpers.ts",
    "t('energy.siteInfo.mode.backup', 'Backup Only')"
  ],
  [
    "web/src/features/battery/components/energy-products-modernization/SiteInfoSection.tsx",
    "t('energy.siteInfo.empty', 'No site configuration loaded yet. Use refresh to fetch from Tesla.')"
  ],
  [
    "web/src/features/battery/components/modernization/HealthQuickLinksPanel.tsx",
    "t('battery.links.title', 'Explore More')"
  ],
  [
    "web/src/features/battery/components/modernization/HealthQuickLinksPanel.tsx",
    "t('battery.links.title', 'Explore More')"
  ],
  [
    "web/src/features/battery/components/pack-capacity/PackCapacityFitDiagnostics.tsx",
    "t(\n              'packCapacity.fitDiagnostics.chartAria',\n              'Filtered pack-capacity estimates and descriptive linear fit',\n            )"
  ],
  [
    "web/src/features/battery/components/power-flow/SolarChargeAdviceStrip.tsx",
    "t('powerFlow.solarAdvice', 'Solar charging advice')"
  ],
  [
    "web/src/features/battery/components/power-flow/SolarChargeAdviceStrip.tsx",
    "t('powerFlow.chargeNow', 'Charge now on solar')"
  ],
  [
    "web/src/features/battery/components/power-flow/SolarChargeAdviceStrip.tsx",
    "t('powerFlow.chargeSoon', 'Charge soon')"
  ],
  [
    "web/src/features/battery/components/power-flow/SolarChargeAdviceStrip.tsx",
    "t('powerFlow.chargeWait', 'Hold for cheap rates')"
  ],
  [
    "web/src/features/battery/components/power-flow/SolarChargeAdviceStrip.tsx",
    "t('powerFlow.surplus', '{{kw}} kW surplus · ~{{amps}}A solar-matched', {\n          kw: fmtNumber(data.surplus_w / 1000),\n          amps: data.recommended_amps,\n        })"
  ],
  [
    "web/src/features/battery/components/TOUSettingsModal.tsx",
    "t(\n            'energy.tou.description',\n            'Configure your utility rate plan so the Powerwall can optimize charging and discharging based on electricity pricing.',\n          )"
  ],
  [
    "web/src/features/battery/components/TOUSettingsModal.tsx",
    "t(\n                'energy.tou.customHint',\n                'Paste the full tou_settings payload or just the inner object. See Tesla Fleet API docs for the schema.',\n              )"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.cell', 'Cell #')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.cell', 'Cell #')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.cell', 'Cell #')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.cell', 'Cell #')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.voltage', 'Voltage (V)')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.voltage', 'Voltage (V)')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.voltage', 'Voltage (V)')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.voltage', 'Voltage (V)')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.table.delta', 'Delta (mV)')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.subtitle', 'Individual cell voltage monitoring and analysis')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.heatmap.empty', 'No cell readings available.')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.heatmap.empty', 'No cell readings available.')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.heatmap.title', 'Cell voltage heatmap')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.heatmap.title', 'Cell voltage heatmap')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.heatmap.title', 'Cell voltage heatmap')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.view.bar', 'Switch to bar view')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.view.grid', 'Switch to grid view')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.view.barLabel', 'Bar view')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.view.gridLabel', 'Grid view')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.heatmap.subtitle', 'Cells colored by deviation from average')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t(\n                  'battery.cells.barView.aria',\n                  'Voltage reading for each battery cell',\n                )"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.distribution.title', 'Voltage distribution')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.distribution.title', 'Voltage distribution')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.distribution.empty', 'No distribution data available.')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t(\n                  'battery.cells.distribution.aria',\n                  'Distribution of battery cells by voltage range',\n                )"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.distribution.count', 'Cell count')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.distribution.count', 'Cell count')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.bar.title', 'Cell voltage bar chart')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.bar.title', 'Cell voltage bar chart')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.bar.empty', 'No cell voltages available.')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t(\n                'battery.cells.bar.aria',\n                'Battery cell voltage readings with pack minimum, average, and maximum references',\n              )"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.overTime.title', 'Cell voltage over time')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.overTime.title', 'Cell voltage over time')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.overTime.title', 'Cell voltage over time')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.overTime.empty', 'Not enough history yet.')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t(\n                  'battery.cells.overTime.aria',\n                  'Minimum, average, and maximum battery cell voltage over time',\n                )"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.overTime.min', 'Min voltage')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.overTime.min', 'Min voltage')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.overTime.max', 'Max voltage')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.overTime.max', 'Max voltage')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.imbalance.title', 'Imbalance trend')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.imbalance.title', 'Imbalance trend')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.imbalance.empty', 'Not enough history yet.')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t(\n                  'battery.cells.imbalance.aria',\n                  'Battery cell voltage imbalance over time with nominal and warning thresholds',\n                )"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.imbalance.series', 'Imbalance (mV)')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.imbalance.series', 'Imbalance (mV)')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.details.title', 'Cell details')"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.details.count', '{{count}} cells', { count: cells.length })"
  ],
  [
    "web/src/features/battery/pages/BatteryCellsPage.tsx",
    "t('battery.cells.details.empty', 'No cell details available.')"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "t('battery.degradation.subtitle', 'Health trends, degradation predictions, and charging habit impact')"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "t('battery.degradation.summary', 'Battery health summary')"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "t('battery.degradation.noStress', 'Charging impact will appear once charging history is available.')"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "t(\n                  'battery.degradation.rangeLossAria',\n                  'Original and current estimated driving range over time',\n                )"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "t('battery.degradation.healthFactors', 'Battery health factors')"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "t('battery.degradation.healthFactors', 'Battery health factors')"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "t('battery.degradation.history', 'Degradation history')"
  ],
  [
    "web/src/features/battery/pages/BatteryDegradationPage.tsx",
    "t('battery.degradation.history', 'Degradation history')"
  ],
  [
    "web/src/features/battery/pages/EnergyProductsPage.tsx",
    "t('energy.products.empty', 'No energy products found. Use \"Refresh from Tesla\" to discover your Powerwalls and Solar installations.')"
  ],
  [
    "web/src/features/benchmarks/components/CohortEligibilityPanel.tsx",
    "t('benchmarks.cohort.loading', 'Loading cohort eligibility…')"
  ],
  [
    "web/src/features/charging/components/charge-departure-alignment-modernization/AlignmentPairs.tsx",
    "t('help.chargeDepartureAlignment.iconLabel', 'More info about how pairs are formed')"
  ],
  [
    "web/src/features/charging/components/ChargePointsPanel.tsx",
    "t(\n            'ocpp.noChargePoints',\n            'No OCPP chargers reporting yet. Point a charger at the OCPP server to see it here.',\n          )"
  ],
  [
    "web/src/features/charging/components/smart-charge-modernization/ChargePointsCard.tsx",
    "t('ocpp.noChargePoints', 'No OCPP chargers reporting yet. Point a charger at the OCPP server to see it here.')"
  ],
  [
    "web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx",
    "t(\n        'charging.curve.chargerTypeDesc',\n        'Average kW and kWh per charger category',\n      )"
  ],
  [
    "web/src/features/charging/components/charging-curve/LoadingSkeleton.tsx",
    "t('charging.curve.loading', 'Loading charging curve analysis')"
  ],
  [
    "web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx",
    "t(\n          'charging.curve.sessionComparisonDesc',\n          'Power curves overlaid from last 10 sessions',\n        )"
  ],
  [
    "web/src/features/charging/components/charging-curve/SessionCurveChart.tsx",
    "t(\n        'charging.curve.powerVsSocDesc',\n        'Charging power curve for selected session',\n      )"
  ],
  [
    "web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx",
    "t(\n        'charging.curve.speedTrendDesc',\n        'Monthly average DC vs AC charge rate',\n      )"
  ],
  [
    "web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx",
    "t('charging.curve.summaryLoading', 'Loading summary metrics')"
  ],
  [
    "web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx",
    "t(\n        'charging.curve.yearlyTrendDesc',\n        'Average time-to-charge and session count by year',\n      )"
  ],
  [
    "web/src/features/charging/components/charging-curve-modernization/CurveSourceSection.tsx",
    "t('charging.curve.selectSessionHint', 'Select a session above to view its charging curve')"
  ],
  [
    "web/src/features/charging/components/charging-list/BatteryLevelChart.tsx",
    "t(\n          'charging.charts.batteryLevelEmpty',\n          'No charge-start levels to chart yet.',\n        )"
  ],
  [
    "web/src/features/charging/components/charging-list/ChargingInsights.tsx",
    "t('charging.section.batteryDist', 'Battery start-level distribution')"
  ],
  [
    "web/src/features/charging/components/charging-list/ChargingInsights.tsx",
    "t('charging.section.batteryDistDesc', 'See where you typically start charging.')"
  ],
  [
    "web/src/features/charging/components/charging-list/ChargingInsights.tsx",
    "t('charging.section.optimizer', 'Cost optimizer & heatmap')"
  ],
  [
    "web/src/features/charging/components/charging-list/ChargingInsights.tsx",
    "t('charging.section.optimizerDesc', 'Smart scheduling recommendations require pattern recognition.')"
  ],
  [
    "web/src/features/charging/components/charging-list/ChartsRow.tsx",
    "t(\n              'charging.charts.energyCostTrendAria',\n              'Charging energy and cost trend',\n            )"
  ],
  [
    "web/src/features/charging/components/ChargingEvidenceTable.tsx",
    "t('charging.grid.batteryScale', 'Battery level on a 0–100% scale')"
  ],
  [
    "web/src/features/charging/components/ChargingEvidenceTable.tsx",
    "t('charging.grid.startBattery', 'Start battery')"
  ],
  [
    "web/src/features/charging/components/ChargingSessionCard.tsx",
    "t('metrics.peakPower', '{{value}} kW peak', {\n            value: fmtNumber((session.peak_power_w ?? 0) / 1000),\n          })"
  ],
  [
    "web/src/features/charging/components/ChargingSessionCard.tsx",
    "t('metrics.avgPower', '~{{value}} kW avg', { value: fmtNumber(avgRateKw) })"
  ],
  [
    "web/src/features/charging/components/ChargingSessionCard.tsx",
    "t('scoreAria', 'Battery-friendly score: {{value}}', { value: sessionScore })"
  ],
  [
    "web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx",
    "t(\n            'costAnalysis.chargerType.chartAria',\n            'Pie chart of charging cost by charger type.',\n          )"
  ],
  [
    "web/src/features/charging/components/stat-modernization/ChargerTypeBreakdown.tsx",
    "t('costAnalysis.chargerType.chartAria', 'Pie chart of charging cost by charger type.')"
  ],
  [
    "web/src/features/charging/components/cost-analysis/CostForecastSection.tsx",
    "t('costAnalysis.forecast.chartAria', 'Historical and projected monthly charging cost with confidence band')"
  ],
  [
    "web/src/features/charging/components/stat-modernization/CostForecastSection.tsx",
    "t('costAnalysis.forecast.chartAria', 'Historical and projected monthly charging cost with confidence band')"
  ],
  [
    "web/src/features/charging/components/cost-analysis/CostForecastSection.tsx",
    "t('costAnalysis.forecast.trendAria', 'Monthly average cost per kilowatt-hour trend')"
  ],
  [
    "web/src/features/charging/components/stat-modernization/CostForecastSection.tsx",
    "t('costAnalysis.forecast.trendAria', 'Monthly average cost per kilowatt-hour trend')"
  ],
  [
    "web/src/features/charging/components/powershare/HoursTrendPanel.tsx",
    "t(\n          'powershare.hoursTrend.ariaLabel',\n          'Estimated remaining runtime trend',\n        )"
  ],
  [
    "web/src/features/charging/components/powershare-modernization/TrendCard.tsx",
    "t('powershare.hoursTrend.ariaLabel', 'Estimated remaining runtime trend')"
  ],
  [
    "web/src/features/charging/components/powershare/PowerTrendPanel.tsx",
    "t('powershare.powerTrend.ariaLabel', 'Output power trend chart')"
  ],
  [
    "web/src/features/charging/components/powershare-modernization/TrendCard.tsx",
    "t('powershare.powerTrend.ariaLabel', 'Output power trend chart')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.sessionTitle', 'Share Charging Session')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.sessionDescription', 'Generate a public link to share this charging session. Anyone with the link can view the summary and charge curve — no login required.')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.sessionTitlePlaceholder', 'Optional title (e.g., \"Baker Supercharger Stop\")')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.titleLabel', 'Share title')"
  ],
  [
    "web/src/features/driving/components/ShareDriveDialog.tsx",
    "t('share.titleLabel', 'Share title')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.includeCurve', 'Include charge curve and cost')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.linkLabel', 'Share link URL')"
  ],
  [
    "web/src/features/driving/components/ShareDriveDialog.tsx",
    "t('share.linkLabel', 'Share link URL')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.openLink', 'Open link in a new tab')"
  ],
  [
    "web/src/features/driving/components/ShareDriveDialog.tsx",
    "t('share.openLink', 'Open link in a new tab')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.loadingLinks', 'Loading active share links…')"
  ],
  [
    "web/src/features/driving/components/ShareDriveDialog.tsx",
    "t('share.loadingLinks', 'Loading active share links…')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.loadError', 'Could not load your existing share links. Please try again.')"
  ],
  [
    "web/src/features/driving/components/ShareDriveDialog.tsx",
    "t('share.loadError', 'Could not load your existing share links. Please try again.')"
  ],
  [
    "web/src/features/charging/components/ShareSessionDialog.tsx",
    "t('share.none', 'No active share links yet.')"
  ],
  [
    "web/src/features/driving/components/ShareDriveDialog.tsx",
    "t('share.none', 'No active share links yet.')"
  ],
  [
    "web/src/features/charging/components/SitePriceRadar.tsx",
    "t('tesla_charging.priceRadar', 'Price Radar')"
  ],
  [
    "web/src/features/charging/components/SitePriceRadar.tsx",
    "t('tesla_charging.noPriceData', 'No priced Supercharger visits yet.')"
  ],
  [
    "web/src/features/charging/components/SitePriceRadar.tsx",
    "t('tesla_charging.siteVisits', '{{count}} visits · last {{date}}', {\n                    count: s.visits,\n                    date: s.last_visit || '—',\n                  })"
  ],
  [
    "web/src/features/charging/components/SitePriceRadar.tsx",
    "t('tesla_charging.unpriced', '+{{count}} visits without invoice pricing', {\n                count: data?.unpriced_count ?? 0,\n              })"
  ],
  [
    "web/src/features/charging/components/SitePriceRadar.tsx",
    "t('tesla_charging.spread', 'Cheapest stop saves {{save}}/kWh vs priciest', {\n                save: formatCurrency((sites[sites.length - 1]?.avg_per_kwh ?? cheapest) - cheapest),\n              })"
  ],
  [
    "web/src/features/charging/pages/ChargeInterruptionPage.tsx",
    "t('help.chargeInterruption.iconLabel', 'More info about the site list')"
  ],
  [
    "web/src/features/charging/pages/ChargerResiliencePage.tsx",
    "t('help.chargerResilience.iconLabel', 'More info about the what-if scenario')"
  ],
  [
    "web/src/features/charging/pages/ChargingCurvePage.tsx",
    "t('charging.curve.sessionInspector', 'Session inspector')"
  ],
  [
    "web/src/features/charging/pages/ChargingCurvePage.tsx",
    "t('charging.curve.sessionInspector', 'Session inspector')"
  ],
  [
    "web/src/features/charging/pages/CostAnalysisPage.tsx",
    "t('costAnalysis.trends', 'Cost trends')"
  ],
  [
    "web/src/features/charging/pages/CostAnalysisPage.tsx",
    "t('costAnalysis.impact', 'Lifetime and environmental impact')"
  ],
  [
    "web/src/features/dashboard/components/DashboardSettingsModal.tsx",
    "t(\n              'dashSettings.vehicleFilterDesc',\n              'Show data for a specific vehicle in all widgets. Widget-level filters take precedence.',\n            )"
  ],
  [
    "web/src/features/dashboard/components/FleetOperationsBrief.tsx",
    "t('dashboard.fleetPosture.summary.eyebrow', 'Fleet evidence')"
  ],
  [
    "web/src/features/dashboard/components/FleetOperationsBrief.tsx",
    "t('dashboard.fleetPosture.summary.title', 'Fleet operating posture')"
  ],
  [
    "web/src/features/dashboard/components/FleetOperationsBrief.tsx",
    "t('dashboard.fleetPosture.summary.scope', 'All registered vehicles; active vehicle shown below')"
  ],
  [
    "web/src/features/dashboard/components/FleetOperationsBrief.tsx",
    "t('dashboard.fleetPosture.summary.provenance', 'Verified coverage comes from the same resolved fleet-state batch. Client classification takes over when evidence ages; the oldest reading is a real backend observation, never fetch completion.')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.rotation10s', '10s')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.rotation15s', '15s')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.rotation30s', '30s')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.rotation1min', '1 min')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.rotation2min', '2 min')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.rotation5min', '5 min')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.timeout3s', '3s')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.timeout5s', '5s')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.timeout10s', '10s')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.timeout15s', '15s')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.dim5min', '5 min')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.dim10min', '10 min')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.dim15min', '15 min')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.dim30min', '30 min')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.dim60min', '60 min')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.clockTopLeft', 'Top left')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.clockTopRight', 'Top right')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.clockBottomLeft', 'Bottom left')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t('kiosk.clockBottomRight', 'Bottom right')"
  ],
  [
    "web/src/features/dashboard/components/KioskSettingsModal.tsx",
    "t(\n              'kiosk.hint',\n              'Kiosk mode enters fullscreen and hides all navigation. Move the mouse or touch the screen to reveal the exit button. Press Esc to exit.',\n            )"
  ],
  [
    "web/src/features/dashboard/components/LayoutSwitcher.tsx",
    "t('layout.editEnterLabel', 'Edit dashboard')"
  ],
  [
    "web/src/features/dashboard/components/MiniGridPreview.tsx",
    "t('preview.aria', 'Layout preview, {{count}} widgets', {\n    count: tiles.length,\n  })"
  ],
  [
    "web/src/features/dashboard/components/MiniGridPreview.tsx",
    "t('preview.empty', 'No widgets')"
  ],
  [
    "web/src/features/dashboard/components/operationalbrief-all/DashboardSourceBrief.tsx",
    "t('dashboard.summary.status.stale', 'Retained readings')"
  ],
  [
    "web/src/features/dashboard/components/operationalbrief-all/DashboardSourceBrief.tsx",
    "t('dashboard.summary.status.partial', 'Partial evidence')"
  ],
  [
    "web/src/features/dashboard/components/WidgetPicker.tsx",
    "t('widgets.pickerDescription', 'Choose the operational signals and workflows that belong on this dashboard.')"
  ],
  [
    "web/src/features/dashboard/components/WidgetPicker.tsx",
    "t('widgets.searchLabel', 'Search widgets')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('dashboard.moreActions', 'More dashboard actions')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('dashboard.moreActions', 'More dashboard actions')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('dashboard.dashboardTools', 'Dashboard tools')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('dashboard.dashboardToolsHelp', 'Manage, present, or share this layout.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('auth.toResume', 'to resume live updates.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('dashboard.widgetsRegion', 'Dashboard widgets')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.trackingHelp', 'See current vehicle state and data freshness.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.drivesHelp', 'Review routes, efficiency, and driving patterns.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.chargingHelp', 'Understand charging cost and battery health.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.controlHelp', 'Manage alerts, automations, and vehicle actions.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.stepAccountHelp', 'Authorize TeslaSync through the account settings.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.stepVehicles', 'Sync vehicle inventory')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.stepVehiclesHelp', 'Import the vehicles available to your account.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.stepWorkspace', 'Activate your workspace')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.stepWorkspaceHelp', 'Live dashboards populate as telemetry arrives.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.accountConnected', 'Account connected')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.setupRequired', 'Workspace setup')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.explore', 'Explore capabilities')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.privateTitle', 'Private by design')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('onboarding.privateHelp', 'Your fleet data stays in the infrastructure you control.')"
  ],
  [
    "web/src/features/dashboard/pages/DashboardPage.tsx",
    "t('dashboard.loading', 'Loading command center')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.batteryHelp', 'Reported battery state of charge, on the 0–100 percent scale.')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.rangeHelp', 'Reported rated range in metres, converted only for display.')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.interiorHelp', 'Reported cabin temperature in degrees Celsius.')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.exteriorHelp', 'Reported exterior temperature in degrees Celsius.')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.odometerHelp', 'Reported odometer in metres; lifetime reading, not distance in a selected window.')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.speedHelp', 'Reported speed in metres per second. Missing speed is not a measured stop.')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.eyebrow', 'Vehicle telemetry')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.title', 'Vehicle operating summary')"
  ],
  [
    "web/src/features/dashboard/pages/GlancePage.tsx",
    "t('glance.summary.description', 'Latest returned measurements for the selected vehicle. Poll completion is not a verified observation time for each signal; location has an independent source.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.distanceHelp', 'Fleet distance over the last 30 days; source kilometres normalized to metres.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.drivesHelp', 'Fleet drive count in the 30-day rollup.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.sessionsHelp', 'Fleet charging-session count in the 30-day rollup.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.energyHelp', 'Fleet energy over the last 30 days; source kilowatt-hours normalized to watt-hours.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.costHelp', 'Recorded fleet cost in the source denomination; no currency conversion.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.efficiencyHelp', 'Fleet average consumption over the last 30 days; source Wh/km normalized to Wh/m.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.carbonHelp', 'Source-reported fleet CO₂ savings in kilograms for the 30-day rollup.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.vehiclesHelp', 'Fleet vehicle count reported by analytics, not the selected spotlight vehicle.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.eyebrow', 'Fleet rollup')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.title', 'Fleet operating summary')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.description', 'Fleet-wide analytics for the last 30 days. The selected vehicle only scopes the spotlight; exact rollup bounds and source coverage are not supplied.')"
  ],
  [
    "web/src/features/dashboard/pages/QuickStatsPage.tsx",
    "t('quickStats.summary.scope', 'All fleet vehicles · last 30 days')"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "t('widget.analyticsSummary.summary.distanceHelp', 'Fleet distance from the analytics source; kilometres normalized to metres.')"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "t('widget.analyticsSummary.summary.efficiencyHelp', 'Source consumption in Wh/km normalized to Wh/m; the original distance conversion factor is retained.')"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "t('widget.analyticsSummary.summary.energyHelp', 'Source energy normalized from kWh to Wh; the existing kWh display is retained.')"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "t('widget.analyticsSummary.summary.costHelp', 'Recorded cost divided by positive measured distance, retained as source currency per metre; missing operands or zero distance cannot define a rate.')"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "t('widget.analyticsSummary.summary.title', 'Analytics operating summary')"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "t('widget.analyticsSummary.summary.description', 'Fleet-wide analytics using the hook’s default source window. Exact bounds and completeness are not supplied; optional trend arrays retain their own source coverage.')"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "t('widget.analyticsSummary.summary.scope', 'Fleet-wide · default analytics window')"
  ],
  [
    "web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx",
    "t('widget.analyticsSummary.trendAria', '{{metric}} trend', {\n                      metric: stats[i]?.label ?? '',\n                    })"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "t('widget.apiUsage.callsDescription', 'API calls reported by the 24-hour source counter.')"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "t('widget.apiUsage.responseDescription', 'Reported average latency; source milliseconds are retained as canonical seconds.')"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "t('widget.apiUsage.errorRateDescription', 'Reported error percentage; the existing high-error threshold is above 5%.')"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "t('widget.apiUsage.errorCountDescription', 'Recorded API errors; a missing counter is not zero.')"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "t('widget.apiUsage.summaryTitle', 'API source counters')"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/AutomationStatusWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/BackupHistoryWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/CostBreakdownWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/MQTTStatusWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/SystemHealthWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "t('dashboard.summary.eyebrow', 'Source summary')"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "t('widget.apiUsage.summaryDescription', 'API activity and latency retain their reported windows; no service-wide confidence score is inferred.')"
  ],
  [
    "web/src/features/dashboard/widgets/APIUsageWidget.tsx",
    "t('widget.apiUsage.summaryScope', 'System API logs; calls cover 24 hours, other counters have no exact source bounds')"
  ],
  [
    "web/src/features/dashboard/widgets/AuditLogWidget.tsx",
    "t('widget.securityValetOn', 'Valet mode on')"
  ],
  [
    "web/src/features/dashboard/widgets/AuditLogWidget.tsx",
    "t('widget.securityValetOff', 'Valet mode off')"
  ],
  [
    "web/src/features/dashboard/widgets/AutomationStatusWidget.tsx",
    "t('widget.automation.activeDescription', 'Enabled automations in the returned configuration list.')"
  ],
  [
    "web/src/features/dashboard/widgets/AutomationStatusWidget.tsx",
    "t('widget.automation.failingDescription', 'Enabled automations with consecutive failures; successful empty lists retain measured zero.')"
  ],
  [
    "web/src/features/dashboard/widgets/AutomationStatusWidget.tsx",
    "t('widget.automation.disabledDescription', 'Automations explicitly auto-disabled by the source, not all manually disabled automations.')"
  ],
  [
    "web/src/features/dashboard/widgets/AutomationStatusWidget.tsx",
    "t('widget.automation.summaryTitle', 'Automation configuration')"
  ],
  [
    "web/src/features/dashboard/widgets/AutomationStatusWidget.tsx",
    "t('widget.automation.summaryDescription', 'Current automation configuration and reported failure flags; no execution-success confidence is inferred.')"
  ],
  [
    "web/src/features/dashboard/widgets/AutomationStatusWidget.tsx",
    "t('widget.automation.summaryScope', 'Returned automation list; action permissions and per-row recovery remain independent')"
  ],
  [
    "web/src/features/dashboard/widgets/BackupHistoryWidget.tsx",
    "t('widget.backupHistory.countDescription', 'Count of returned backup events; an absent or malformed event array is not zero.')"
  ],
  [
    "web/src/features/dashboard/widgets/BackupHistoryWidget.tsx",
    "t('widget.backupHistory.durationDescription', 'Mean of valid non-negative event durations in seconds; missing duration operands leave the mean unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/BackupHistoryWidget.tsx",
    "t('widget.backupHistory.summaryTitle', 'Backup event sources')"
  ],
  [
    "web/src/features/dashboard/widgets/BackupHistoryWidget.tsx",
    "t('widget.backupHistory.summaryDescription', 'Energy-site discovery and backup events retain independent recovery; the recent-event feed is a capped presentation of returned history.')"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "t('widget.chargeCost.energyDescription', 'Known energy in returned sessions; missing session energy keeps coverage partial.')"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "t('widget.chargeCost.costDescription', 'Recorded session cost or the configured electricity-rate estimate; missing required operands remain unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "t('widget.chargeCost.rateDescription', 'Configured electricity cost per estimated distance; canonical raw rate is currency per metre, not a measured trip rate.')"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "t('widget.chargeCost.savingsDescription', 'Estimated gasoline cost minus charge cost; distance uses the existing 3.5 miles per kWh assumption.')"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "t('widget.chargeCost.summaryTitle', 'Charge cost sources')"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "t('widget.chargeCost.summaryDescription', 'Recorded and inferred charging costs remain distinct from measured drive costs; configured gas and electricity assumptions are retained.')"
  ],
  [
    "web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx",
    "t('widget.chargeCost.summaryScope', 'Vehicle {{vehicleId}}; rolling 30-day start {{start}}, at most 100 returned sessions, no explicit end bound', { vehicleId: id, start: thirtyDaysAgo })"
  ],
  [
    "web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx",
    "t(\n              'widget.climateHistory.chartAria',\n              'Cabin and outside temperature history',\n            )"
  ],
  [
    "web/src/features/dashboard/widgets/CostBreakdownWidget.tsx",
    "t('widget.costBreakdown.totalDescription', 'Reported total charging cost, retaining the configured currency display.')"
  ],
  [
    "web/src/features/dashboard/widgets/CostBreakdownWidget.tsx",
    "t('widget.costBreakdown.rateDescription', 'Source currency per kilometre normalized to currency per metre; display conversion occurs exactly once.')"
  ],
  [
    "web/src/features/dashboard/widgets/CostBreakdownWidget.tsx",
    "t('widget.costBreakdown.savingsDescription', 'Reported gasoline comparison is an estimate, not independently measured savings.')"
  ],
  [
    "web/src/features/dashboard/widgets/CostBreakdownWidget.tsx",
    "t('widget.costBreakdown.summaryTitle', 'Charging cost sources')"
  ],
  [
    "web/src/features/dashboard/widgets/CostBreakdownWidget.tsx",
    "t('widget.costBreakdown.summaryDescription', 'Lifetime totals, the existing source tariff and estimated gasoline comparison remain independent of ranked monthly rows.')"
  ],
  [
    "web/src/features/dashboard/widgets/CostBreakdownWidget.tsx",
    "t('widget.costBreakdown.summaryScope', 'Vehicle {{vehicleId}}; lifetime source totals and available monthly records, exact coverage bounds unknown', { vehicleId: id ?? '—' })"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.vehiclesHelp', 'Fleet vehicle total reported by the dashboard stats source.')"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.tripsHelp', 'Fleet trip total; not the selected vehicle’s recent transition count.')"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.sessionsHelp', 'Fleet charging-session total reported by dashboard stats.')"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.fsmHelp', 'Current state for the resolved vehicle only, independently loaded from fleet totals.')"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.eyebrow', 'Dashboard sources')"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.title', 'Fleet counts and vehicle state')"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.description', 'Fleet-wide totals and the resolved vehicle’s current FSM state are independent sources. Aggregate bounds are not supplied; the wide view’s latest five transitions come from a separate 168-hour history query.')"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.scope', 'Fleet counts · FSM vehicle {{id}}', { id: idStr })"
  ],
  [
    "web/src/features/dashboard/widgets/DashboardStatsWidget.tsx",
    "t('widget.dashboardStats.summary.noScope', 'Fleet counts · no resolved FSM vehicle')"
  ],
  [
    "web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx",
    "t(\n          'widget.driveTelemetry.chartAria',\n          'Speed, power, battery, and elevation during the latest drive',\n        )"
  ],
  [
    "web/src/features/dashboard/widgets/DrivingDynamicsWidget.tsx",
    "t(\n                  'widget.drivingDynamics.distributionAria',\n                  'Distribution of observed acceleration magnitudes',\n                )"
  ],
  [
    "web/src/features/dashboard/widgets/EnergyStatsWidget.tsx",
    "t('widget.energyStats.summary.usedHelp', 'Reported driving energy in watt-hours for this vehicle’s source period.')"
  ],
  [
    "web/src/features/dashboard/widgets/EnergyStatsWidget.tsx",
    "t('widget.energyStats.summary.chargedHelp', 'Reported charging energy in watt-hours for the same source period.')"
  ],
  [
    "web/src/features/dashboard/widgets/EnergyStatsWidget.tsx",
    "t('widget.energyStats.summary.efficiencyHelp', 'Reported average consumption in Wh/m, converted to the existing Wh/distance display.')"
  ],
  [
    "web/src/features/dashboard/widgets/EnergyStatsWidget.tsx",
    "t('widget.energyStats.summary.costHelp', 'Source cost retains its original $ suffix; no currency conversion or inferred ISO denomination.')"
  ],
  [
    "web/src/features/dashboard/widgets/EnergyStatsWidget.tsx",
    "t('widget.energyStats.summary.netHelp', 'Charged minus used energy for the same source period; both operands must be measured.')"
  ],
  [
    "web/src/features/dashboard/widgets/EnergyStatsWidget.tsx",
    "t('widget.energyStats.summary.title', 'Energy operating summary')"
  ],
  [
    "web/src/features/dashboard/widgets/EnergyStatsWidget.tsx",
    "t('widget.energyStats.summary.description', 'Vehicle energy totals and daily breakdown share the returned source period. Exact bounds and coverage are not supplied; CO₂ savings remain estimates.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx",
    "t('widget.fleetStatsBar.summary.vehiclesHelp', 'Count from the returned vehicle registry, not the 30-day analytics rollup.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx",
    "t('widget.fleetStatsBar.summary.onlineHelp', 'Registry entries whose state is online; not verified live-state coverage.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx",
    "t('widget.fleetStatsBar.summary.distanceHelp', 'Fleet-wide trailing 30-day distance; source kilometres normalized to metres.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx",
    "t('widget.fleetStatsBar.summary.energyHelp', 'Fleet-wide trailing 30-day energy; source kilowatt-hours normalized to watt-hours, retaining the source kWh display.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx",
    "t('widget.fleetStatsBar.summary.eyebrow', 'Fleet sources')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx",
    "t('widget.fleetStatsBar.summary.description', 'Current registry counts and trailing 30-day analytics have independent sources and windows. Exact analytics bounds and coverage are not supplied.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx",
    "t('widget.fleetStatsBar.summary.scope', 'Fleet-wide · registry snapshot / 30-day analytics')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsWidget.tsx",
    "t('widget.fleetStats.summary.registryHelp', 'Returned registry count; online caption reflects registry state, not verified live telemetry.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsWidget.tsx",
    "t('widget.fleetStats.summary.alertsHelp', 'Unread alert count has no connected source in this widget; unknown is not zero.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsWidget.tsx",
    "t('widget.fleetStats.summary.analyticsHelp', 'Fleet-wide trailing 30-day analytics, normalized to canonical SI before display.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsWidget.tsx",
    "t('widget.fleetStats.summary.eyebrow', 'Independent fleet sources')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsWidget.tsx",
    "t('widget.fleetStats.summary.title', 'Fleet operating totals')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsWidget.tsx",
    "t('widget.fleetStats.summary.description', 'Registry counts and 30-day fleet analytics are independent from the first registered vehicle’s five recent drives and charging sessions. Those sparklines are not the fleet-wide analysis window; unread alerts have no source here.')"
  ],
  [
    "web/src/features/dashboard/widgets/FleetStatsWidget.tsx",
    "t('widget.fleetStats.summary.scope', 'Fleet totals · first-vehicle recent series')"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "t('widget.fsdWeekly.summary.distanceHelp', 'Reported supervised-driving distance in metres for this Monday–Sunday window.')"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "t('widget.fsdWeekly.summary.shareHelp', 'Source-reported FSD share, on the 0–100 percent scale.')"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "t('widget.fsdWeekly.summary.changeHelp', 'Share change in percentage points versus the previous Monday–Sunday window, not a percent growth rate.')"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "t('widget.fsdWeekly.title', 'FSD this week')"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "t('widget.fsdWeekly.summary.eyebrow', 'Supervised driving')"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "t('widget.fsdWeekly.summary.title', 'Weekly FSD summary')"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "t('widget.fsdWeekly.honesty', 'Unmeasured is not zero. Last week is the previous Monday–Sunday window.')"
  ],
  [
    "web/src/features/dashboard/widgets/FsdWeeklyWidget.tsx",
    "t(\n              'widget.fsdWeekly.honesty',\n              'Unmeasured is not zero. Last week is the previous Monday–Sunday window.',\n            )"
  ],
  [
    "web/src/features/dashboard/widgets/FSMDistributionWidget.tsx",
    "t(\n              'widget.fsmDistribution.chartAria',\n              'Time spent in each vehicle state',\n            )"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.distanceHelp', 'Source lifetime distance in kilometres, normalized to metres before display.')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.drivesHelp', 'Reported lifetime drive count for this vehicle.')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.energyHelp', 'Reported lifetime energy, normalized from kWh to Wh; original kWh display retained.')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.carbonHelp', 'Source-reported lifetime CO₂ offset in kilograms.')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.costHelp', 'Recorded lifetime charging cost in its original denomination; no currency conversion.')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.daysHelp', 'Reported ownership-day count used as the daily-distance denominator.')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.dailyHelp', 'Lifetime distance divided by positive measured ownership days; not a rolling 24-hour distance.')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.eyebrow', 'Lifetime history')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.title', 'Lifetime operating summary')"
  ],
  [
    "web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx",
    "t('widget.lifetimeStats.summary.description', 'Lifetime totals for the resolved vehicle, not the workspace date range. Exact history coverage and first observation are not supplied.')"
  ],
  [
    "web/src/features/dashboard/widgets/LiveSignalSparklinesWidget.tsx",
    "t('widget.trendSparkline', 'trend')"
  ],
  [
    "web/src/features/dashboard/widgets/LocationMapWidget.tsx",
    "t('widget.locationMap.status', 'Vehicle location status')"
  ],
  [
    "web/src/features/dashboard/widgets/MileageStatsWidget.tsx",
    "t('widget.mileageStats.summary.dailyHelp', 'Last 30-day distance divided by 30; not today’s measured distance.')"
  ],
  [
    "web/src/features/dashboard/widgets/MileageStatsWidget.tsx",
    "t('widget.mileageStats.summary.weeklyHelp', 'Seven times the 30-day-derived daily average; not an independent seven-day query.')"
  ],
  [
    "web/src/features/dashboard/widgets/MileageStatsWidget.tsx",
    "t('widget.mileageStats.summary.monthlyHelp', 'Thirty times the derived daily average, preserving the rolling 30-day distance.')"
  ],
  [
    "web/src/features/dashboard/widgets/MileageStatsWidget.tsx",
    "t('widget.mileageStats.summary.milestoneHelp', 'Next 10,000-display-unit lifetime milestone. Estimated months retain the existing 30-day average and rounding rule.')"
  ],
  [
    "web/src/features/dashboard/widgets/MileageStatsWidget.tsx",
    "t('widget.mileageStats.summary.eyebrow', 'Mileage history')"
  ],
  [
    "web/src/features/dashboard/widgets/MileageStatsWidget.tsx",
    "t('widget.mileageStats.summary.title', 'Mileage operating summary')"
  ],
  [
    "web/src/features/dashboard/widgets/MileageStatsWidget.tsx",
    "t('widget.mileageStats.summary.description', 'Rolling 30-day distance supplies the daily, weekly and monthly averages; lifetime distance supplies the milestone. Exact source bounds and completeness are not supplied.')"
  ],
  [
    "web/src/features/dashboard/widgets/MotorHistoryWidget.tsx",
    "t(\n              'widget.motorHistory.chartAria',\n              'Motor torque, stator temperature, and acceleration history',\n            )"
  ],
  [
    "web/src/features/dashboard/widgets/MQTTStatusWidget.tsx",
    "t('widget.mqtt.rateDescription', 'Sum of returned per-vehicle signal rates; one missing operand makes the total unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/MQTTStatusWidget.tsx",
    "t('widget.mqtt.countDescription', 'Sum of returned signal counters; counter reset periods are not supplied by the source.')"
  ],
  [
    "web/src/features/dashboard/widgets/MQTTStatusWidget.tsx",
    "t('widget.mqtt.summaryTitle', 'MQTT source counters')"
  ],
  [
    "web/src/features/dashboard/widgets/MQTTStatusWidget.tsx",
    "t('widget.mqtt.summaryDescription', 'Fleet counters retain complete-operand checks; connection presence and newest valid observation remain separate evidence.')"
  ],
  [
    "web/src/features/dashboard/widgets/MQTTStatusWidget.tsx",
    "t('widget.mqtt.summaryScope', 'Returned streaming-fleet rows; no complete calendar-day or verified-live coverage is inferred')"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.minutesAgo', '{{minutes}}m ago', { minutes: fmtInt(diffMin) })"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.hoursAgo', '{{hours}}h ago', { hours: fmtInt(diffHrs) })"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.sentDescription', 'Recorded total sent for the reported seven-day window.')"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.deliveryDescription', 'Sent divided by a positive reported total; a zero denominator leaves delivery rate unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.failedDescription', 'Reported failures remain independent of the recent notification log rows.')"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.channelsDescription', 'Enabled notification channels, not a delivery-success guarantee.')"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.summaryTitle', 'Notification counters')"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.summaryDescription', 'Notification counters preserve the existing delivery formula and attention thresholds; recent logs recover independently.')"
  ],
  [
    "web/src/features/dashboard/widgets/NotificationStatsWidget.tsx",
    "t('widget.notificationStats.summaryScope', 'System notifications; reported seven-day counters and separate latest log rows')"
  ],
  [
    "web/src/features/dashboard/widgets/QuickNavWidget.tsx",
    "t('nav.drivesDesc', 'Trip history')"
  ],
  [
    "web/src/features/dashboard/widgets/QuickNavWidget.tsx",
    "t('nav.chargingDesc', 'Sessions & costs')"
  ],
  [
    "web/src/features/dashboard/widgets/QuickNavWidget.tsx",
    "t('nav.batteryDesc', 'Health & degradation')"
  ],
  [
    "web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx",
    "t('widget.regenEfficiency.recoveredDescription', 'Reported regenerative energy in watt-hours; average absolute drive power is not regenerative power.')"
  ],
  [
    "web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx",
    "t('widget.regenEfficiency.driveDescription', 'Reported drive energy in watt-hours, independent of the displayed recovery percentage.')"
  ],
  [
    "web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx",
    "t('widget.regenEfficiency.chargesDescription', 'Source-reported equivalent free-charge count; missing values remain unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx",
    "t('widget.regenEfficiency.summaryTitle', 'Regenerative energy sources')"
  ],
  [
    "web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx",
    "t('widget.regenEfficiency.summaryDescription', 'Recovered and used energy retain the source quantities; the existing recovery gauge is a percentage and is never scaled twice.')"
  ],
  [
    "web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx",
    "t('widget.regenEfficiency.summaryScope', 'Vehicle {{vehicleId}}; returned analytics window, exact source bounds unknown', { vehicleId: vid ?? '—' })"
  ],
  [
    "web/src/features/dashboard/widgets/SentryEventLogWidget.tsx",
    "t('widget.sentryLog.lockedChip', '🔒 Locked')"
  ],
  [
    "web/src/features/dashboard/widgets/SentryEventLogWidget.tsx",
    "t('widget.sentryLog.unlockedChip', '🔓 Unlocked')"
  ],
  [
    "web/src/features/dashboard/widgets/SentryEventLogWidget.tsx",
    "t('widget.sentryLog.sentryOnChip', '🛡️ Sentry on')"
  ],
  [
    "web/src/features/dashboard/widgets/SentryEventLogWidget.tsx",
    "t('widget.sentryLog.doorOpen', 'Door open: {{doors}}', { doors: openDoors.join(', ') })"
  ],
  [
    "web/src/features/dashboard/widgets/SentryEventLogWidget.tsx",
    "t('widget.sentryLog.sentryActivated', 'Sentry mode activated')"
  ],
  [
    "web/src/features/dashboard/widgets/SentryEventLogWidget.tsx",
    "t('widget.sentryLog.sentryDeactivated', 'Sentry mode deactivated')"
  ],
  [
    "web/src/features/dashboard/widgets/SentryEventLogWidget.tsx",
    "t('widget.sentryLog.securityUpdated', 'Security state updated')"
  ],
  [
    "web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx",
    "t('widget.noDetails', 'No details available')"
  ],
  [
    "web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx",
    "t('widget.eventFeed.minutesAgo', '{{minutes}}m ago', { minutes: diffMin })"
  ],
  [
    "web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx",
    "t('widget.eventFeed.hoursAgo', '{{hours}}h ago', { hours: diffHrs })"
  ],
  [
    "web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx",
    "t('widget.eventFeed.label', 'Event feed')"
  ],
  [
    "web/src/features/dashboard/widgets/shared/WidgetStatGrid.tsx",
    "t('widget.statGrid.noStats', 'No stats available')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalCatalogWidget.tsx",
    "t('widget.signalCatalog.searchLabel', 'Search signals')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalCatalogWidget.tsx",
    "t('widget.signalCatalog.sampleCount', 'Observations in fetched sample')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalCatalogWidget.tsx",
    "t('widget.signalCatalog.sampleCount', 'Observations in fetched sample')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('widget.signalHealth.summaryTitle', 'Signal source coverage')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('widget.signalHealth.catalogDescription', 'Returned signal catalog size; an absent catalog is unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('widget.signalHealth.activeDescription', 'Observed entries with a parseable timestamp within this widget’s five-minute threshold.')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('widget.signalHealth.gapsDescription', 'Older observations and missing or unparseable timestamps remain signal gaps.')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('widget.signalHealth.freshnessDescription', 'Age in seconds of the newest valid observation; absent observations remain unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('widget.signalHealth.summaryDescription', 'Catalog, statistics and observations recover independently. The five-minute widget threshold does not certify distributed live-state freshness.')"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('widget.signalHealth.summaryScope', 'Vehicle {{vehicleId}}; current catalog and returned observations only', { vehicleId: id })"
  ],
  [
    "web/src/features/dashboard/widgets/SignalHealthWidget.tsx",
    "t('widget.signalHealth.noGaps', 'No observed signal gaps')"
  ],
  [
    "web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx",
    "t('widget.sleepEfficiency.drainDescription', 'Sentry-off drain rate normalized to percentage points per second; daily display preserves the existing 24-hour estimate.')"
  ],
  [
    "web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx",
    "t('widget.sleepEfficiency.sleepDescription', 'Returned asleep and offline state durations in canonical seconds; absent state distribution remains unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx",
    "t('widget.sleepEfficiency.eventsDescription', 'Number of returned recent events, not a certified full-window wake count.')"
  ],
  [
    "web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx",
    "t('widget.sleepEfficiency.summaryTitle', 'Sleep source quantities')"
  ],
  [
    "web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx",
    "t('widget.sleepEfficiency.summaryDescription', 'The efficiency gauge retains its measured percentage; supporting durations, drain estimate and recent-event sample keep their source limitations.')"
  ],
  [
    "web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx",
    "t('widget.sleepEfficiency.summaryScope', 'Vehicle {{vehicleId}}; returned historical distribution and recent sample, exact bounds unknown', { vehicleId: id ?? '—' })"
  ],
  [
    "web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx",
    "t('widget.superchargerHistory.energyDescription', 'Reported summary energy in watt-hours, not the sum of the top-ten presentation rows.')"
  ],
  [
    "web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx",
    "t('widget.superchargerHistory.spendDescription', 'Reported Supercharger summary spend; missing values remain unknown, not free charging.')"
  ],
  [
    "web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx",
    "t('widget.superchargerHistory.summaryTitle', 'Supercharger source totals')"
  ],
  [
    "web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx",
    "t('widget.superchargerHistory.summaryDescription', 'Reported 30-day totals remain independent of the ten most-recent sessions ranked by energy; incomplete session energy does not imply a complete sample.')"
  ],
  [
    "web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx",
    "t('widget.superchargerHistory.summaryScope', 'Tesla charging history; source summary window, exact instants and timezone are not supplied')"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "t('widget.telemetryErrors.vinDescription', 'VINs explicitly marked active; incomplete activity flags leave the count unknown.')"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "t('widget.telemetryErrors.sample', 'Errors in fetched sample')"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "t('widget.telemetryErrors.sample', 'Errors in fetched sample')"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "t('widget.telemetryErrors.sampleDescription', 'Returned error rows, not the total error count for a complete time range.')"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "t('widget.telemetryErrors.summaryTitle', 'Error source counters')"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "t('widget.telemetryErrors.summaryDescription', 'Active VINs and the fetched error sample remain separate sources; observed and fetched timestamps keep their original distinction.')"
  ],
  [
    "web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx",
    "t('widget.telemetryErrors.summaryScope', 'Fleet telemetry; returned VIN summary and error sample, exact coverage bounds unknown')"
  ],
  [
    "web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx",
    "t(\n        'widget.tirePressureHistory.chartAria',\n        'Front and rear tire pressure history',\n      )"
  ],
  [
    "web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx",
    "t('widget.uptime.consecutiveFailures', 'consecutive failures')"
  ],
  [
    "web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx",
    "t('widget.uptime.consecutiveFailures', 'consecutive failures')"
  ],
  [
    "web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx",
    "t('widget.uptime.servicesHealthy', 'Services healthy')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklyDigestWidget.tsx",
    "t('widget.weeklyDigest.summary.metricHelp', 'Current-week source quantity; the comparison uses its matching previous-week operand. Missing values are not zero.')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklyDigestWidget.tsx",
    "t('widget.weeklyDigest.summary.eyebrow', 'Weekly comparison')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklyDigestWidget.tsx",
    "t('widget.weeklyDigest.summary.title', 'Weekly operating digest')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklyDigestWidget.tsx",
    "t('widget.weeklyDigest.summary.description', 'This week versus the source’s previous week for the resolved vehicle. Exact week boundaries, timezone and completeness are not supplied by this digest response; comparisons retain their original operands and direction rules.')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklyDigestWidget.tsx",
    "t('widget.weeklyDigest.summary.scope', 'Vehicle {{id}} · current / previous week', { id: idStr })"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx",
    "t('widget.weeklySummary.summary.metricHelp', 'Current-week source quantity. Existing week-over-week comparisons keep their zero-baseline, sub-1% and lower-is-better behavior.')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx",
    "t('widget.weeklySummary.summary.eyebrow', 'Weekly vehicle sources')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx",
    "t('widget.weeklySummary.summary.title', 'Weekly operating summary')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx",
    "t('widget.weeklySummary.summary.description', 'Current-week totals for the resolved vehicle with the existing previous-week comparisons. Exact bounds, timezone and completeness are not supplied; missing operands and zero baselines do not imply no change.')"
  ],
  [
    "web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx",
    "t('widget.weeklySummary.summary.scope', 'Vehicle {{id}} · current / previous week', { id: id ?? '—' })"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.distanceHelp', 'Reported year distance, normalized from kilometres to metres.')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.drivesHelp', 'Reported drive count for this calendar year.')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.energyHelp', 'Reported year energy, normalized from kWh to Wh; original kWh display retained.')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.carbonHelp', 'Source-reported CO₂ offset for this calendar year, in kilograms.')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.monthHelp', 'Month with the most source-reported drives, using the existing selection rule and localized month name.')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.longestHelp', 'Source longest drive in this year, normalized from kilometres to metres.')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.durationHelp', 'Source driving minutes normalized to seconds; the original hour display is retained.')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.speedHelp', 'Source peak speed normalized from km/h to m/s; not average speed.')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.eyebrow', 'Calendar-year history')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.title', 'Year operating summary')"
  ],
  [
    "web/src/features/dashboard/widgets/YearReviewWidget.tsx",
    "t('widget.yearReview.summary.description', 'Calendar-year totals for the resolved vehicle. The current year may be incomplete; exact source coverage and observation bounds are not supplied.')"
  ],
  [
    "web/src/features/driving/components/arrival-reliability/ArrivalReliabilityProfilePlot.tsx",
    "t(\n      'arrivalReliability.profileAria',\n      'Arrival reliability profile combining sample counts, normalised duration index, and schedule allowance share',\n    )"
  ],
  [
    "web/src/features/driving/components/departure-forecast/DepartureForecastNext24Plot.tsx",
    "t(\n      'departureForecast.next24Aria',\n      'Departure likelihood and cumulative probability forecast for the next 24 hours',\n    )"
  ],
  [
    "web/src/features/driving/components/destination-transitions/DestinationTransitionProfilePlot.tsx",
    "t(\n      'destinationTransitions.profileAria',\n      'Destination transition profile showing sample count and concentration',\n    )"
  ],
  [
    "web/src/features/driving/components/destination-transitions/OriginConcentrationPlot.tsx",
    "t(\n      'originConcentration.aria',\n      'Origin concentration and leading share by departure location',\n    )"
  ],
  [
    "web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx",
    "t('driveDetail.backToDrives', 'Back to drives')"
  ],
  [
    "web/src/features/driving/pages/DriveDetailPage.tsx",
    "t('driveDetail.backToDrives', 'Back to drives')"
  ],
  [
    "web/src/features/driving/components/drive-detail/DrivePhysicsDebriefPanel.tsx",
    "t('driveDetail.fsd.title', 'Supervised driving')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.title', 'Supervised driving')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.title', 'Supervised driving')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.title', 'Supervised driving')"
  ],
  [
    "web/src/features/driving/pages/DriveDetailPage.tsx",
    "t('driveDetail.fsd.title', 'Supervised driving')"
  ],
  [
    "web/src/features/driving/pages/DriveDetailPage.tsx",
    "t('driveDetail.fsd.title', 'Supervised driving')"
  ],
  [
    "web/src/features/driving/components/drive-detail/DriveTimeline.tsx",
    "t('driveDetail.timeline.label', 'Drive timeline')"
  ],
  [
    "web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx",
    "t('driveDetail.timeline.label', 'Drive timeline')"
  ],
  [
    "web/src/features/driving/components/drive-detail/DriveTimeline.tsx",
    "t('driveDetail.timeline.startedAt', 'Started at ')"
  ],
  [
    "web/src/features/driving/components/drive-detail/DriveTimeline.tsx",
    "t('driveDetail.timeline.durationPrefix', 'Duration ')"
  ],
  [
    "web/src/features/driving/components/drive-detail/DriveTimeline.tsx",
    "t('driveDetail.timeline.statusPrefix', 'Status ')"
  ],
  [
    "web/src/features/driving/components/drive-detail/DriveTimeline.tsx",
    "t('driveDetail.timeline.endedAt', 'Ended at ')"
  ],
  [
    "web/src/features/driving/components/drive-detail/RouteMapSection.tsx",
    "t('driveDetail.routeMapLabel', 'Route map')"
  ],
  [
    "web/src/features/driving/components/drive-detail/RouteMapSection.tsx",
    "t('driveDetail.lastKnown', 'Last known location')"
  ],
  [
    "web/src/features/driving/components/drive-detail/RouteMapSection.tsx",
    "t('driveDetail.stationaryRouteTitle', 'Route can\\'t be plotted')"
  ],
  [
    "web/src/features/driving/components/drive-detail/RouteMapSection.tsx",
    "t(\n                      'driveDetail.stationaryRouteBody',\n                      'Only one GPS coordinate was recorded for this drive, so the route can\\'t be drawn. The drive\\'s distance, duration, and other stats below are unaffected.',\n                    )"
  ],
  [
    "web/src/features/driving/components/drive-detail/RouteMapSection.tsx",
    "t(\n                  'driveDetail.fsd.mapEvidence',\n                  'Approximate area where the FSD counter increased - not an exact FSD-active segment.',\n                )"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.loadFailed', 'Supervised-driving evidence could not be loaded')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t(\n          'driveDetail.fsd.loadFailedBody',\n          'The rest of this drive remains available. Retry the page to load the cumulative-counter evidence.',\n        )"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.section', 'Supervised driving')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t(\n                'driveDetail.fsd.subtitle',\n                'Reported supervised-driving distance from synchronized cumulative counters.',\n              )"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.afterFirmware', 'After firmware {{version}}', {\n                  version: insight.firmware_version,\n                })"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.distance', 'Reported distance')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.share', 'Share of drive')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.evidenceWindow', 'Evidence window')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.noPositiveEvidence', 'No positive counter increase')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.resetTitle', 'Counter reset affected this drive')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t(\n              'driveDetail.fsd.resetBody',\n              'Distance around the reset cannot be assigned exactly, so this value is not high confidence.',\n            )"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t('driveDetail.fsd.evidenceLimitedTitle', 'Route evidence limited')"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t(\n              'driveDetail.fsd.evidenceLimitedBody',\n              'This drive produced more counter evidence than can be shown safely. The dashed map overlay displays only the first 512 coalesced intervals.',\n            )"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t(\n                'driveDetail.fsd.unknownBody',\n                'There are not enough paired observations to distinguish zero FSD use from missing data.',\n              )"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t(\n                'driveDetail.fsd.method',\n                'Evidence times bound where the counter increased; they do not identify exact FSD-active road segments.',\n              )"
  ],
  [
    "web/src/features/driving/components/drive-detail/SupervisedDrivingPanel.tsx",
    "t(\n              'driveDetail.fsd.afterFirmwareHonesty',\n              'This drive ran firmware {{version}}. The spotlight compares FSD share before vs after — correlation, not proof the update caused a change.',\n              { version: insight.firmware_version },\n            )"
  ],
  [
    "web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx",
    "t('driveDetail.whyEnded.loading', 'Loading drive diagnostic…')"
  ],
  [
    "web/src/features/driving/components/DriveCard.tsx",
    "t('drives.fsdResetAffected', 'A counter reset lowered confidence for this drive.')"
  ],
  [
    "web/src/features/driving/components/DrivesEvidenceTable.tsx",
    "t('drives.fsdResetAffected', 'A counter reset lowered confidence for this drive.')"
  ],
  [
    "web/src/features/driving/components/DriveCard.tsx",
    "t(\n            'drives.fsdReportedHelp',\n            'Reported supervised-driving distance derived from cumulative counters.',\n          )"
  ],
  [
    "web/src/features/driving/components/DrivesEvidenceTable.tsx",
    "t('drives.fsdReportedHelp', 'Reported supervised-driving distance derived from cumulative counters.')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesCollectionFilters.tsx",
    "t('drives.collections.aria', 'Filter drives by collection')"
  ],
  [
    "web/src/features/driving/components/DrivesEvidenceTable.tsx",
    "t('drives.collections.aria', 'Filter drives by collection')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesCollectionFilters.tsx",
    "t('drives.fsdFilter.aria', 'Filter drives by FSD evidence')"
  ],
  [
    "web/src/features/driving/components/DrivesEvidenceTable.tsx",
    "t('drives.fsdFilter.aria', 'Filter drives by FSD evidence')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesEvidenceHeading.tsx",
    "t('drives.sortByAria', 'Sort by {{field}}', {\r\n                    field: s === 'date'\r\n                      ? t('drives.sortRecent', 'Recent')\r\n                      : s === 'distance'\r\n                        ? t('drives.sortDistance', 'Distance')\r\n                        : s === 'efficiency'\r\n                          ? t('drives.sortEfficiency', 'Efficiency')\r\n                          : t('drives.sortFsd', 'FSD share'),\r\n                  })"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesEvidenceSection.tsx",
    "t('drives.list', 'Drive list')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/drivesListHighlights.ts",
    "t('drives.longest', 'Longest')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/drivesListHighlights.ts",
    "t('drives.avgTrip', 'Avg trip')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesMobileFilters.tsx",
    "t('drives.filterLabel.fsd', 'FSD evidence')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesSourceNotices.tsx",
    "t('drives.fsdRangeUnsupported.title', 'FSD evidence is unavailable for this range')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesSourceNotices.tsx",
    "t(\r\n            'drives.fsdRangeUnsupported.message',\r\n            'FSD attribution supports up to 366 days at a time. Drive history remains available, but FSD filters and sorting are disabled.',\r\n          )"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesSourceNotices.tsx",
    "t('drives.fsdUnavailable.title', 'FSD evidence could not be loaded')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesSourceNotices.tsx",
    "t(\r\n                'drives.fsdUnavailable.message',\r\n                'Drive history remains available, but FSD badges, filters, and sorting are disabled until this data loads successfully.',\r\n              )"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesSourceNotices.tsx",
    "t('drives.fsdEvidence', 'FSD evidence')"
  ],
  [
    "web/src/features/driving/components/drives-orchestrator/DrivesStickySummary.tsx",
    "t('drives.stickyBar.aria', 'Drive history summary')"
  ],
  [
    "web/src/features/driving/components/DrivesEvidenceTable.tsx",
    "t('drives.coll.commutes', 'Commutes')"
  ],
  [
    "web/src/features/driving/hooks/useDrivesListPageCollections.ts",
    "t('drives.coll.commutes', 'Commutes')"
  ],
  [
    "web/src/features/driving/components/DrivesEvidenceTable.tsx",
    "t('drives.fsdFilter.all', 'All FSD data')"
  ],
  [
    "web/src/features/driving/hooks/useDrivesListPageCollections.ts",
    "t('drives.fsdFilter.all', 'All FSD data')"
  ],
  [
    "web/src/features/driving/hooks/useDrivesListPageCollections.ts",
    "t('drives.fsdFilter.all', 'All FSD data')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthOverview.tsx",
    "t(\n                  'drivetrain.alert.criticalMsg',\n                  'One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.',\n                )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/HealthSummary.tsx",
    "t('drivetrain.alert.criticalMsg', 'One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivetrainSummary.tsx",
    "t('drivetrain.alert.criticalMsg', 'One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthOverview.tsx",
    "t(\n                  'drivetrain.alert.warningMsg',\n                  'Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.',\n                )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/HealthSummary.tsx",
    "t('drivetrain.alert.warningMsg', 'Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivetrainSummary.tsx",
    "t('drivetrain.alert.warningMsg', 'Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n          'drivetrain.tips.criticalStop',\n          'Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down.',\n        )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.criticalStop', 'Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n          'drivetrain.tips.serviceUrgent',\n          'Schedule an urgent service appointment. Critical temperatures may indicate a coolant system issue.',\n        )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.serviceUrgent', 'Schedule an urgent service appointment. Critical temperatures may indicate a coolant system issue.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n          'drivetrain.tips.reduceLoad',\n          'Reduce driving intensity and avoid hard acceleration to allow components to cool.',\n        )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.reduceLoad', 'Reduce driving intensity and avoid hard acceleration to allow components to cool.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n          'drivetrain.tips.checkCoolant',\n          'Schedule a service appointment to inspect the coolant system and fluid levels.',\n        )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.checkCoolant', 'Schedule a service appointment to inspect the coolant system and fluid levels.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n          'drivetrain.tips.avoidSupercharging',\n          'Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead.',\n        )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.avoidSupercharging', 'Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n        'drivetrain.tips.regularService',\n        'Keep up with regular service intervals for optimal drivetrain health and longevity.',\n      )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.regularService', 'Keep up with regular service intervals for optimal drivetrain health and longevity.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n        'drivetrain.tips.gentleAccel',\n        'Gentle acceleration helps maintain lower motor temperatures and extends component life.',\n      )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.gentleAccel', 'Gentle acceleration helps maintain lower motor temperatures and extends component life.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n        'drivetrain.tips.precondition',\n        'Precondition the battery in cold weather for better thermal performance and driving efficiency.',\n      )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.precondition', 'Precondition the battery in cold weather for better thermal performance and driving efficiency.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t(\n        'drivetrain.tips.monitorTemps',\n        'Monitor drivetrain temperatures after spirited driving sessions or long highway stretches.',\n      )"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.tips.monitorTemps', 'Monitor drivetrain temperatures after spirited driving sessions or long highway stretches.')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t('drivetrain.priority.urgent', 'Urgent recommendation:')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.priority.urgent', 'Urgent recommendation:')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx",
    "t('drivetrain.priority.important', 'Important recommendation:')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/RecommendationsPanel.tsx",
    "t('drivetrain.priority.important', 'Important recommendation:')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/MethodologyPanel.tsx",
    "t('drivetrain.frontMotor', 'Front Motor')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/StatorHistory.tsx",
    "t('drivetrain.frontMotor', 'Front Motor')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/MethodologyPanel.tsx",
    "t('drivetrain.rearMotor', 'Rear Motor')"
  ],
  [
    "web/src/features/driving/components/drivetrain-health-modernization/StatorHistory.tsx",
    "t('drivetrain.rearMotor', 'Rear Motor')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx",
    "t('dynamics.motorLoading', 'Loading motor telemetry…')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics-modernization/LiveMotorStatus.tsx",
    "t('dynamics.motorLoading', 'Loading motor telemetry…')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx",
    "t('dynamics.forward', 'Forward')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx",
    "t('dynamics.forward', 'Forward')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics-modernization/LiveMotorStatus.tsx",
    "t('dynamics.forward', 'Forward')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics-modernization/LiveMotorStatus.tsx",
    "t('dynamics.forward', 'Forward')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx",
    "t('dynamics.motorResource', 'Motor telemetry')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics-modernization/LiveMotorStatus.tsx",
    "t('dynamics.motorResource', 'Motor telemetry')"
  ],
  [
    "web/src/features/driving/components/driving-dynamics-modernization/LiveSourceWarnings.tsx",
    "t('dynamics.motorResource', 'Motor telemetry')"
  ],
  [
    "web/src/features/driving/components/explorer/ExplorerKpis.tsx",
    "t('explorer.brief.pending', 'Located-arrival evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/explorer/ExplorerKpis.tsx",
    "t('explorer.brief.farthestContext', 'Distance from the inferred observed base.')"
  ],
  [
    "web/src/features/driving/components/explorer/ExplorerKpis.tsx",
    "t('explorer.brief.description', 'Located arrivals describe observed roaming, not complete travel history or a verified home.')"
  ],
  [
    "web/src/features/driving/components/explorer/ExplorerKpis.tsx",
    "t('explorer.brief.capped', 'Latest {{count}} returned drives; history cap reached', { count: summary.historyLimit })"
  ],
  [
    "web/src/features/driving/components/explorer/ExplorerKpis.tsx",
    "t('explorer.brief.window', 'Returned drive history; complete-history coverage is unknown')"
  ],
  [
    "web/src/features/driving/components/explorer/ExplorerKpis.tsx",
    "t('explorer.brief.source', 'Drive-history arrival clusters; visit-weighted P90 distance from the inferred base.')"
  ],
  [
    "web/src/features/driving/components/fsd-insights/FsdCommuteStoriesTable.tsx",
    "t('fsd.observatory.unknownFirmware', 'Unknown firmware')"
  ],
  [
    "web/src/features/driving/components/fsd-insights/FsdObservatoryJournalTable.tsx",
    "t('fsd.observatory.unknownFirmware', 'Unknown firmware')"
  ],
  [
    "web/src/features/driving/components/fsd-insights/FsdObservatoryJournalTable.tsx",
    "t('fsd.observatory.unlabelledRoute', 'Unlabelled route')"
  ],
  [
    "web/src/features/driving/components/fsd-insights/FsdObservatoryJournalTable.tsx",
    "t('fsd.observatory.resetHint', 'Break in the stitch — not travelled FSD{{field}}.', {\r\n              field: event.field ? ` (${event.field})` : '',\r\n            })"
  ],
  [
    "web/src/features/driving/components/fsd-insights/FsdObservatoryJournalTable.tsx",
    "t('fsd.observatory.approximate', 'Approximate counter increase')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/ArrivalEvidenceBrief.tsx",
    "t('arrivalReliability.brief.description', 'Descriptive timing consistency for repeated directional routes; within-allowance shares are in-sample observations, not calibrated reliability promises.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/ArrivalEvidenceBrief.tsx",
    "t('driving.brief.unresolvedCoverage', 'Drive-history coverage is unresolved')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DestinationEvidenceBrief.tsx",
    "t('driving.brief.unresolvedCoverage', 'Drive-history coverage is unresolved')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/ArrivalEvidenceBrief.tsx",
    "t('arrivalReliability.brief.source', 'Returned drive history; repeated-route support, descriptive indices and sample-weighted p90 buffers.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/ColdStartBrief.tsx",
    "t('coldStart.brief.energy', 'Estimated extra energy from the observed cold-versus-warm consumption difference.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/ColdStartBrief.tsx",
    "t('coldStart.brief.description', 'Cold and warm starts compared within the returned selected window; this is observed cohort evidence, not a causal test.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/ColdStartBrief.tsx",
    "t('coldStart.brief.source', 'Returned drive energy and preceding parking gaps; up to 1,000 drives in the selected window.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/CompareVerdictBrief.tsx",
    "t('driveCompare.brief.scope', 'Selected Drive A and Drive B; only fair, comparable measurements decide the verdict')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DepartureEvidenceBrief.tsx",
    "t('departure.brief.description', 'Next-24-hour modeled likelihood uses capped observed departure history; the support index is not a calibrated probability or confidence score.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DepartureEvidenceBrief.tsx",
    "t('departure.brief.window', 'Next 24 hours · {{timezone}}; history coverage is limited to returned rows', { timezone: timeZone })"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DepartureEvidenceBrief.tsx",
    "t('departure.brief.source', 'Returned drive starts; Poisson-derived likelihood and illustrative planning marker, with no vehicle command.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DestinationEvidenceBrief.tsx",
    "t('destinationTransitions.brief.description', 'Accepted adjacent transitions retain chronology and continuity gates; historical successors describe past observations, not the next destination.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DestinationEvidenceBrief.tsx",
    "t('destinationTransitions.brief.source', 'Returned end-location states and accepted adjacent pairs; latest unusable rows are never replaced with older destinations.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx",
    "t('driveDna.brief.description', 'Aggregate drive totals and sampled telemetry are independent sources; regen emissions are sample share, not time share.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx",
    "t('driveDna.brief.window', 'Drive {{id}} · {{start}}–{{end}}; sampled coverage may be incomplete', {\r\n        id: drive.id, start: drive.startTs, end: drive.endTs ?? t('driveDna.brief.open', 'ongoing'),\r\n      })"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx",
    "t('driveDna.brief.noDrive', 'No selected drive')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx",
    "t('driveDna.brief.source', 'Selected drive metadata and returned telemetry emissions after the existing forward fold.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx",
    "t('driving.brief.partial', 'Partial evidence')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyEvidenceBrief.tsx",
    "t('driving.brief.partial', 'Partial evidence')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DriveDnaEvidenceBrief.tsx",
    "t('driveDna.brief.telemetryLoading', 'Telemetry loading')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivetrainSummary.tsx",
    "t('driving.brief.responseReceivedAt', 'Response received {{timestamp}}', { timestamp: new Date(healthState.updatedAt).toISOString() })"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivingRhythmBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivingRhythmBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyTargetBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyTargetBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyTargetBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('driving.brief.pending', 'Drive evidence is not available yet.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivingRhythmBrief.tsx",
    "t('rhythm.brief.description', 'Departure timing in the selected local-time window; timestamp exclusions and evidence floors remain explicit.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/DrivingRhythmBrief.tsx",
    "t('rhythm.brief.source', 'Returned calendar drive history; local departure timestamps.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyEvidenceBrief.tsx",
    "t('efficiency.brief.economy', 'Reciprocal economy, derived from the same measured consumption; not energy intensity.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyEvidenceBrief.tsx",
    "t('efficiency.brief.co2', 'Source aggregate CO₂ savings estimate, in kilograms.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyEvidenceBrief.tsx",
    "t('efficiency.brief.title', 'Lifetime efficiency evidence')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyEvidenceBrief.tsx",
    "t('efficiency.brief.description', 'Vehicle driving aggregates retain their lifetime source period; they are independent of the range-filtered drive charts.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyTargetBrief.tsx",
    "t('effTarget.brief.description', 'Completed-week outcomes from the observed history window; current partial weeks do not extend the completed-week streak.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyTargetBrief.tsx",
    "t('effTarget.brief.window', 'Latest returned drive history, up to 1,000 rows; not lifetime coverage')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/EfficiencyTargetBrief.tsx",
    "t('effTarget.brief.source', 'Returned drive energy and distance; saved target and completed local weeks.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/FsdEvidenceBrief.tsx",
    "t('fsd.brief.description', 'Reported self-driving counter deltas, not estimated engagement time; a share requires aligned observed-driving spans.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/FsdEvidenceBrief.tsx",
    "t('fsd.brief.source', 'Reported supervised self-driving and observed-driving counters, grouped by the requested local calendar window.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/JourneyEvidenceBrief.tsx",
    "t('journeyFragmentation.brief.source', 'Returned drive-history continuity at the selected parking-gap threshold, using local days and weeks.')"
  ],
  [
    "web/src/features/driving/components/operationalbrief-a-m/MotorSamplesBrief.tsx",
    "t('dynamics.brief.source', 'Returned motor-history samples inside the existing selected-drive query bounds.')"
  ],
  [
    "web/src/features/driving/components/range-buffer/RangeBufferPercentileChart.tsx",
    "t(\n      'rangeBuffer.percentileAria',\n      'Range buffer percentile distribution across driving profile categories',\n    )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "t(\r\n        'driveScore.achievements.firstDriveDesc',\r\n        'Complete your first scored drive.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "t(\r\n        'driveScore.achievements.tenDrivesDesc',\r\n        'Complete 10 scored drives.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "t(\r\n        'driveScore.achievements.fiftyDrivesDesc',\r\n        'Complete 50 scored drives.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "t(\r\n        'driveScore.achievements.perfectScoreDesc',\r\n        'Achieve a 100/100 on any drive.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "t(\r\n        'driveScore.achievements.aPlusStreakDesc',\r\n        'Get A+ grade on 5 consecutive drives.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "t(\r\n        'driveScore.achievements.efficiencyMasterDesc',\r\n        'Score 38+ in efficiency on 3 drives.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "t(\r\n        'driveScore.achievements.smoothOperatorDesc',\r\n        'Score 28+ in smoothness on 3 drives.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreAchievements.tsx",
    "t(\r\n        'driveScore.achievements.speedSaintDesc',\r\n        'Score 28+ in speed discipline on 5 drives.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreAchievementsSection.tsx",
    "t('driveScore.noAchievements', 'Achievements unlock as you complete scored drives')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreChartsSection.tsx",
    "t('driveScore.noTrend', 'No scored drives to chart yet')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreDistributionTipsSection.tsx",
    "t('driveScore.noDistribution', 'No scored drives to chart yet')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreDistributionTipsSection.tsx",
    "t('driveScore.noTips', 'Tips appear once drives are scored')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreDistributionTipsSection.tsx",
    "t('driveScore.noTips', 'Tips appear once drives are scored')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreExtremesSection.tsx",
    "t('driveScore.bestWorst', 'Best and worst drives')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreExtremesSection.tsx",
    "t('driveScore.efficiencyLabel', 'Efficiency (Wh/km)')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScoreExtremesSection.tsx",
    "t('driveScore.smoothnessLabel', 'Smoothness (power range)')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreHistoryColumns.tsx",
    "t('driveScore.colBreakdown', 'Eff / Smo / Spd')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScorePeriodAveragesSection.tsx",
    "t('driveScore.periodAverages', 'Period averages')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/ScorePeriodStatisticsPanel.tsx",
    "t('driveScore.avgDuration', 'Avg Duration/Drive')"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.preCondition',\r\n        'Pre-condition your cabin while plugged in to reduce HVAC battery drain.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.coastMore',\r\n        'Coast more by lifting your foot earlier before stops.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.tirePressure',\r\n        'Keep tire pressure at recommended levels for better efficiency.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.smoothAccel',\r\n        'Accelerate gradually — aim for steady pedal pressure.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.regenBraking',\r\n        'Use regenerative braking instead of the brake pedal when possible.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.followDistance',\r\n        'Maintain a larger following distance to avoid sudden braking.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.speedLimit',\r\n        'Stay within the speed limit — aerodynamic drag rises exponentially above 90 km/h.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.cruiseControl',\r\n        'Use Autopilot or cruise control on highways for consistent speed.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/score-orchestrator/scoreTips.tsx",
    "t(\r\n        'driveScore.tips.routePlanning',\r\n        'Plan routes to avoid high-speed stretches when possible.',\r\n      )"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.comfortable', 'You will make it')"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.tight', 'Tight — drive gently')"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.chargeNow', 'Charge first')"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.title', 'Trip Copilot')"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.remainingKm', 'Remaining (km)')"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.check', 'Will I make it?')"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.error', 'Confidence check failed')"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.empty', 'Enter remaining distance for a live arrival verdict.')"
  ],
  [
    "web/src/features/driving/components/TripCopilotCard.tsx",
    "t('tripPlanner.copilot.detail', 'Arrival ~{{soc}}% · {{margin}} kWh margin', {\n                soc: fmtNumber(result.arrival_soc),\n                margin: fmtNumber(result.margin_kwh),\n              })"
  ],
  [
    "web/src/features/driving/components/TripLegList.tsx",
    "t('tripPlanner.legs.chargeStop', 'Charging stop')"
  ],
  [
    "web/src/features/driving/hooks/useDriveScorePage.ts",
    "t(\r\n    'driveScore.empty',\r\n    'Not enough drives in the selected period to calculate a score.',\r\n  )"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.title', 'Anomaly Detective')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.title', 'Anomaly Detective')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.title', 'Anomaly Detective')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.title', 'Anomaly Detective')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.analyzed', 'Drives Analyzed')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.brief.analyzed', 'Returned drives with usable speed and energy data in this window.')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.outlierCount', 'Outliers')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.beyond2', 'beyond ±2σ of your baseline')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.sigma', 'Your Spread (σ)')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.sigmaHint', 'residual scatter around the fit')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.bestSurprise', 'Best Surprise')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.bestSurpriseHint', 'most efficient outlier')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.subtitle', 'Drives that break your own consumption law, explained')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.kpis', 'Anomaly summary metrics')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.kpis', 'Anomaly summary metrics')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.brief.description', 'Speed-adjusted consumption outliers against your returned drive cohort; candidate explanations are not verified causes.')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.brief.source', 'Returned drive history; quadratic fit and ±2σ residual band.')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.chartHint', 'Quadratic fit of consumption vs speed with a ±2σ band; red points break the law')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.noFit', 'Not enough drives (8+ with speed and energy data) to fit your personal baseline yet.')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.col.z', 'z-score')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.upperBand', '+2σ')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.lowerBand', '−2σ')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.normal', 'Within band')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.outlier', 'Outlier')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.cases', 'Case Files')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('help.driveAnomalies.iconLabel', 'More info about anomaly scoring')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.noOutliers', 'No drives beyond ±2σ — everything fits your usual pattern.')"
  ],
  [
    "web/src/features/driving/pages/DriveAnomaliesPage.tsx",
    "t('anomalies.expected', 'expected {{v}}', { v: toEff(o.predicted) })"
  ],
  [
    "web/src/features/driving/pages/DriveDetailPage.tsx",
    "t('driveDetail.notFound', 'This drive could not be found. It may have been deleted, or the link is incorrect.')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.title', 'Efficiency Landscape')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.title', 'Efficiency Landscape')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.title', 'Efficiency Landscape')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.title', 'Efficiency Landscape')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.sweetCell', 'Happiest Conditions')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.brief.best', 'Lowest distance-weighted consumption among supported condition cells.')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.painCell', 'Harshest Conditions')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.brief.worst', 'Highest distance-weighted consumption among supported condition cells.')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.spread', 'Condition Spread')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.spreadHint', 'harshest vs happiest')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.analyzed', 'Drives Mapped')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.brief.mapped', 'Returned drives with speed, temperature, distance and energy evidence.')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.subtitle', 'Your car’s real consumption across speed and temperature')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.kpis', 'Landscape summary metrics')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.kpis', 'Landscape summary metrics')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.brief.description', 'Observed distance-weighted consumption across speed and temperature cells; thin evidence remains visible in the field.')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.brief.source', 'Returned drive history; distance-weighted speed × temperature cells.')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('help.efficiencyLandscape.iconLabel', 'More info about the field map')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.noData', 'No drives with speed, temperature, and energy data in this period.')"
  ],
  [
    "web/src/features/driving/pages/EfficiencyLandscapePage.tsx",
    "t('landscape.noData', 'No drives with speed, temperature, and energy data in this period.')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.title', 'Energy Anatomy')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.title', 'Energy Anatomy')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.title', 'Energy Anatomy')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.title', 'Energy Anatomy')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.total', 'Energy Used')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.biggest', 'Biggest Consumer')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.brief.apportionment', 'Directional physical-model apportionment, not a directly measured component.')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.climateCard', 'Climate Overhead')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.brief.climate', 'Modeled climate share of measured traction energy.')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.regen', 'Regen Credit')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.brief.regen', 'Returned regeneration energy; recovery share uses the measured energy-used denominator.')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.regenShare', '{{pct}}% recovered', { pct: Math.round((anatomy.regenWh / anatomy.totalWh) * 100) })"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.subtitle', 'Where a period of traction energy physically went')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.kpis', 'Energy anatomy summary metrics')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.kpis', 'Energy anatomy summary metrics')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.brief.description', 'Measured total energy anchors a directional physical split; component estimates are not laboratory-grade measurements.')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.brief.source', 'Returned drive energy and regeneration; modeled aerodynamic, rolling and climate allocation.')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('help.energyAnatomy.iconLabel', 'More info about the anatomy model')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.noData', 'No drives with energy data in this period.')"
  ],
  [
    "web/src/features/driving/pages/EnergyAnatomyPage.tsx",
    "t('energyAnatomy.noData', 'No drives with energy data in this period.')"
  ],
  [
    "web/src/features/fleet-ops/components/AssignmentDialog.tsx",
    "t(\n      'fleetOps.assignmentDialog.unsaved',\n      'You have unsaved assignment changes. Discard them?',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/AssignmentDialog.tsx",
    "t('fleetOps.assignmentDialog.vehicleRequired', 'Choose a vehicle.')"
  ],
  [
    "web/src/features/fleet-ops/components/AssignmentDialog.tsx",
    "t('fleetOps.assignmentDialog.driverRequired', 'Choose a driver.')"
  ],
  [
    "web/src/features/fleet-ops/components/AssignmentDialog.tsx",
    "t('fleetOps.assignmentDialog.startRequired', 'Enter a valid start time.')"
  ],
  [
    "web/src/features/fleet-ops/components/AssignmentDialog.tsx",
    "t('fleetOps.assignmentDialog.endInvalid', 'Enter a valid end time.')"
  ],
  [
    "web/src/features/fleet-ops/components/AssignmentDialog.tsx",
    "t('fleetOps.assignmentDialog.endAfterStart', 'End time must be after the start time.')"
  ],
  [
    "web/src/features/fleet-ops/components/AssignmentDialog.tsx",
    "t('fleetOps.assignmentDialog.notesLimit', 'Use 500 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t(\n      'fleetOps.policyDialog.unsaved',\n      'You have unsaved charging-policy changes. Discard them?',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.vehicleRequired', 'Choose a vehicle.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.nameRequired', 'Enter a policy name.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.nameLimit', 'Use 120 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.targetInvalid', 'Enter a whole-number target from 1% to 100%.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.powerInvalid', 'Enter a positive whole number of watts.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.priorityInvalid', 'Enter a whole-number priority from 0 to 1,000.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.startRequired', 'Enter a valid effective start.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.endInvalid', 'Enter a valid effective end.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t('fleetOps.policyDialog.endAfterStart', 'Effective end must be after its start.')"
  ],
  [
    "web/src/features/fleet-ops/components/ChargingPolicyDialog.tsx",
    "t(\n        'fleetOps.policyDialog.windowsInvalid',\n        'Add valid, non-overlapping charging windows.',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/CostCenterDialog.tsx",
    "t(\n      'fleetOps.costCenterDialog.unsaved',\n      'You have unsaved cost-center changes. Discard them?',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/CostCenterDialog.tsx",
    "t('fleetOps.costCenterDialog.codeRequired', 'Enter a cost-center code.')"
  ],
  [
    "web/src/features/fleet-ops/components/CostCenterDialog.tsx",
    "t('fleetOps.costCenterDialog.codeLimit', 'Use 32 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/CostCenterDialog.tsx",
    "t('fleetOps.costCenterDialog.nameRequired', 'Enter a cost-center name.')"
  ],
  [
    "web/src/features/fleet-ops/components/CostCenterDialog.tsx",
    "t('fleetOps.costCenterDialog.nameLimit', 'Use 120 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t(\n      'fleetOps.driverDialog.unsaved',\n      'You have unsaved driver changes. Discard them?',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.nameRequired', 'Enter a display name.')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.nameLimit', 'Use 120 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.referenceRequired', 'Enter a reference code.')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.referenceLimit', 'Use 64 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.capRange', 'Charge cap must be 20–100%.')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.curfewPair', 'Set both curfew start and end, or neither.')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.curfewClock', 'Curfew times must be HH:MM (24h).')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.drivers.guardrails', 'Guardrails')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverRoster.tsx",
    "t('fleetOps.drivers.guardrails', 'Guardrails')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.chargeCap', 'Charge cap (%)')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.chargeCapPlaceholder', 'No cap')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.curfewStart', 'Curfew start')"
  ],
  [
    "web/src/features/fleet-ops/components/DriverDialog.tsx",
    "t('fleetOps.driverDialog.curfewEnd', 'Curfew end')"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t(\n      'fleetOps.reservationDialog.unsaved',\n      'You have unsaved reservation changes. Discard them?',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t('fleetOps.reservationDialog.nameRequired', 'Enter a reservation name.')"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t('fleetOps.reservationDialog.nameLimit', 'Use 160 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t('fleetOps.reservationDialog.purposeLimit', 'Use 500 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t('fleetOps.reservationDialog.vehicleRequired', 'Choose a vehicle.')"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t('fleetOps.reservationDialog.startRequired', 'Enter a valid start time.')"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t('fleetOps.reservationDialog.endRequired', 'Enter a valid end time.')"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t('fleetOps.reservationDialog.endAfterStart', 'End time must be after the start time.')"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationDialog.tsx",
    "t(\n        'fleetOps.reservationDialog.driverUnavailable',\n        'Choose a driver assigned to this vehicle for the full reservation.',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/ReservationPanel.tsx",
    "t('fleetOps.reservations.add', 'Add reservation')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t(\n      'fleetOps.workOrderDialog.unsaved',\n      'You have unsaved work-order changes. Discard them?',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.vehicleRequired', 'Choose a vehicle.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.titleRequired', 'Enter a work-order title.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.titleLimit', 'Use 160 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.descriptionLimit', 'Use 2,000 characters or fewer.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.distanceInvalid', 'Enter a non-negative distance.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.dueAtInvalid', 'Enter a valid due date and time.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.startInvalid', 'Enter a valid downtime start.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.endInvalid', 'Enter a valid downtime end.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t(\n        'fleetOps.workOrderDialog.endAfterStart',\n        'Downtime end must be after its start.',\n      )"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.costInvalid', 'Enter a non-negative whole number.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.currencyRequired', 'Enter the cost currency.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.costRequired', 'Enter the cost amount.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t('fleetOps.workOrderDialog.currencyInvalid', 'Use a three-letter ISO currency code.')"
  ],
  [
    "web/src/features/fleet-ops/components/WorkOrderDialog.tsx",
    "t(\n                'fleetOps.workOrderDialog.costMinorHint',\n                'Enter the smallest currency unit; for USD, 12500 represents $125.00.',\n              )"
  ],
  [
    "web/src/features/maps/components/charging-places/ChargingPlacesWorkspace.tsx",
    "t(\n        'geofences.bulk.deleteConfirm.body',\n        'Selected places will be removed permanently. Places with charging or drive history must be archived instead.',\n      )"
  ],
  [
    "web/src/features/maps/components/charging-places/ChargingPlacesWorkspace.tsx",
    "t('chargingPlaces.table.rates', 'charging rates')"
  ],
  [
    "web/src/features/maps/components/charging-places/ChargingPlacesWorkspace.tsx",
    "t('chargingPlaces.table.rates', 'charging rates')"
  ],
  [
    "web/src/features/maps/components/charging-places/PlaceDetailPanel.tsx",
    "t('chargingPlaces.detail.markReviewedAndEnable', 'Mark reviewed & enable')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/EditorNotices.tsx",
    "t('notifications.alertStudio.editor.unsupportedKind', 'This rule type cannot be edited by this version of the editor. No changes have been saved.')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/RuleRoutingFields.tsx",
    "t('notifications.alertStudio.channels.selectChannels', 'Selected channels')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/ScopeKindFields.tsx",
    "t('notifications.alertStudio.kind.computedMetricHint', 'Aggregate metric (cost, kWh, distance) over a time window.')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/ScopeKindFields.tsx",
    "t('notifications.alertStudio.kind.signalHint', 'Fires when a raw telemetry signal crosses a threshold.')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/TemplateBrowser.tsx",
    "t('notifications.alertStudio.templates.useTemplate', 'Use template {{name}}', { name: getTemplateName(tpl) })"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t(\r\n        'notifications.alertStudio.editor.canonicalUnitNoVehicle',\r\n        'Enter the canonical SI value emitted by Fleet Telemetry. Select a vehicle in the status line to load exact unit metadata.',\r\n      )"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t(\r\n        'notifications.alertStudio.editor.canonicalUnitLoading',\r\n        'Loading the canonical unit for this signal…',\r\n      )"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t('notifications.alertStudio.editor.canonicalUnitDistance', 'Canonical SI input: meters (m).')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t('notifications.alertStudio.editor.canonicalUnitTemperature', 'Canonical input: degrees Celsius (°C).')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t('notifications.alertStudio.editor.canonicalUnitPressure', 'Canonical SI input: pascals (Pa).')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t('notifications.alertStudio.editor.canonicalUnitCharge', 'Canonical input: percent from 0 to 100.')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t('notifications.alertStudio.editor.canonicalUnitSpeed', 'Canonical SI input: meters per second (m/s).')"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t(\r\n        'notifications.alertStudio.editor.canonicalUnitFallback',\r\n        'Enter the canonical numeric value emitted by Fleet Telemetry; this signal has no registered unit dimension.',\r\n      )"
  ],
  [
    "web/src/features/notifications/components/alert-editor-source-closure/useSignalConditionModel.ts",
    "t(\r\n        'notifications.alertStudio.editor.canonicalUnitUnavailable',\r\n        'Unit metadata is unavailable for this signal. Enter the canonical numeric value emitted by Fleet Telemetry.',\r\n      )"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t(\n              'notifications.alertStudio.editor.includeTitleHelp',\n              'When unchecked, Discord/Slack/Telegram/ntfy/webhook deliver only the body. WebPush, email, and Pushover always include a title.',\n            )"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.messageTemplateLabel', 'Message template')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.messageTemplateHint', 'Type {{ to insert a placeholder')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t(\n                  'notifications.alertStudio.editor.messageTemplateHelp',\n                  'Per-rule body template. Reference live signals with double-brace placeholders like {{BatteryLevel}}. Leave blank to use the op-aware default body.',\n                )"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.presetButton', 'Pick a preset')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t(\n            'notifications.alertStudio.editor.messageTemplatePlaceholder',\n            'Battery at {{BatteryLevel}}% — leave blank for the smart default',\n          )"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.autocompleteLabel', 'Placeholder suggestions')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.autocompleteLabel', 'Placeholder suggestions')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.autocompleteEmpty', 'No matching placeholders')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.previewEmpty', 'Start typing to see a preview')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.previewEmptyBody', '(no body — title carries the alert)')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.presetModalTitle', 'Message presets')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.presetModalTitle', 'Message presets')"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t(\n            'notifications.alertStudio.editor.presetModalIntro',\n            'Curated templates for common alert shapes. Click one to apply it; you can edit it afterwards.',\n          )"
  ],
  [
    "web/src/features/notifications/components/AlertMessageEditor.tsx",
    "t('notifications.alertStudio.editor.presetEmpty', 'No presets match this filter')"
  ],
  [
    "web/src/features/notifications/components/BrowserTabSignalsPanel.tsx",
    "t(\n              'settings.tab.empty',\n              'Tab signal preferences are unavailable right now.',\n            )"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelCard.tsx",
    "t('notifications.channels.toggleAria', 'Toggle {{name}}', { name: channel.name })"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelFormModal.tsx",
    "t(\n        'notifications.channels.unsaved',\n        'You have unsaved notification-channel changes. Discard them?',\n      )"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelProvidersPanel.tsx",
    "t('notifications.channels.providers.title', 'Supported providers')"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelsGrid.tsx",
    "t('notifications.channels.loadFailed', 'Failed to load channels')"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelsGrid.tsx",
    "t('notifications.channels.loading', 'Loading channels…')"
  ],
  [
    "web/src/features/notifications/components/channels/ChannelsGrid.tsx",
    "t('notifications.channels.listAria', 'Configured channels')"
  ],
  [
    "web/src/features/notifications/components/ComputedMetricEditor.tsx",
    "t(\n              'notifications.alertStudio.computedMetric.previewIdle',\n              'Pick a metric, window, operator, and threshold to preview.',\n            )"
  ],
  [
    "web/src/features/notifications/components/ComputedMetricEditor.tsx",
    "t('notifications.alertStudio.computedMetric.previewEmpty', 'No preview available yet.')"
  ],
  [
    "web/src/features/notifications/components/ComputedMetricEditor.tsx",
    "t(\n              'notifications.alertStudio.computedMetric.previewValue',\n              'Right now this metric is {{value}}{{suffix}} — would {{verdict}} fire.',\n              {\n                value: formatForUnit(previewData.value * metricUnit.canonicalFactor, metricUnit.kind, settings),\n                suffix: previewSuffix ? ` ${previewSuffix}` : '',\n                verdict: previewData.would_trigger\n                  ? t('notifications.alertStudio.computedMetric.would', '')\n                  : t('notifications.alertStudio.computedMetric.wouldNot', 'NOT'),\n              },\n            )"
  ],
  [
    "web/src/features/notifications/components/DeviceDataUsagePanel.tsx",
    "t('notifications.device.dataUsageHeading', 'Data usage on this device')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.severity.info', 'All (info and above)')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.severity.warn', 'Warnings and critical')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.severity.critical', 'Critical only')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.scope.selected', 'Selected vehicles')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n          'notifications.device.test.suppressed',\n          'Suppressed on this device by the \"{{reason}}\" rule.',\n          { reason: decision.reason },\n        )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n          'notifications.device.test.noPermission',\n          'Notification permission has not been granted in this browser.',\n        )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n            'notifications.device.test.noWorker',\n            'No service worker is registered, so background delivery is unavailable.',\n          )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n          'notifications.device.test.body',\n          'Test notification — your device policy allows this severity.',\n        )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n              'notifications.device.test.deliveredSilent',\n              'Delivered silently — quiet hours are active.',\n            )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.test.delivered', 'Test notification delivered.')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.test.failed', 'The browser refused to show the notification.')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.filtered', 'Filters active')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.unfiltered', 'Everything delivered')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n            'notifications.device.intro',\n            'These rules apply only to this browser and are enforced by the service worker, so they also work when every tab is closed. Channel routing and install-wide quiet hours stay on the server.',\n          )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.enabled', 'Show notifications on this device')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.minSeverity', 'Minimum severity')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n              'notifications.device.minSeverityHint',\n              'Anything below this level is dropped before it reaches the OS.',\n            )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n              'notifications.device.vehicleScopeSection',\n              'Vehicle scope settings',\n            )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.vehicleScope', 'Vehicle scope')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.vehicleScope', 'Vehicle scope')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n                'notifications.device.vehicleScopeHint',\n                'Fleet-wide notifications with no vehicle attached are always delivered.',\n              )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n                      'notifications.device.noVehicles',\n                      'No vehicles are available to scope to yet.',\n                    )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.quietHours', 'Quiet hours on this device')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.quietHours', 'Quiet hours on this device')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.quietEnabled', 'Silence notifications overnight')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.quietEnd', 'Until')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n                'notifications.device.quietHint',\n                'Quiet hours silence the notification rather than dropping it, so nothing is lost. Critical alerts still ring.',\n              )"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.test.action', 'Send test notification')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t('notifications.device.reset', 'Reset device rules')"
  ],
  [
    "web/src/features/notifications/components/DeviceNotificationPrefsPanel.tsx",
    "t(\n              'notifications.device.caveat',\n              'A notification filtered here has still been delivered to the browser. Prefer server-side channel routing and quiet hours whenever they can express the same rule.',\n            )"
  ],
  [
    "web/src/features/notifications/components/InboxBody.tsx",
    "t('notifications.inbox.evidence.title', 'Notification evidence')"
  ],
  [
    "web/src/features/notifications/components/InboxBody.tsx",
    "t('notifications.inbox.evidence.title', 'Notification evidence')"
  ],
  [
    "web/src/features/notifications/components/InboxBody.tsx",
    "t('notifications.inbox.loadedCount', '{{count}} loaded · total unavailable', { count: isGrouped ? groups.length : rows.length })"
  ],
  [
    "web/src/features/notifications/components/InboxBody.tsx",
    "t('notifications.inbox.filter.readState', 'Filter by read state')"
  ],
  [
    "web/src/features/notifications/components/NotificationFilterBar.tsx",
    "t('notifications.inbox.filter.readState', 'Filter by read state')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxTable.tsx",
    "t('notifications.inbox.filter.readState', 'Filter by read state')"
  ],
  [
    "web/src/features/notifications/components/InboxBody.tsx",
    "t('notifications.inbox.filter.allReadStates', 'All read states')"
  ],
  [
    "web/src/features/notifications/components/NotificationFilterBar.tsx",
    "t('notifications.inbox.filter.allReadStates', 'All read states')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxTable.tsx",
    "t('notifications.inbox.filter.allReadStates', 'All read states')"
  ],
  [
    "web/src/features/notifications/components/InboxBody.tsx",
    "t('notifications.inbox.detail.empty', 'Select a notification to inspect its details.')"
  ],
  [
    "web/src/features/notifications/components/InboxBody.tsx",
    "t('notifications.inbox.evidence.count', 'Notification count')"
  ],
  [
    "web/src/features/notifications/components/NotificationFilterBar.tsx",
    "t('notifications.inbox.columns.readState', 'Read state')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxTable.tsx",
    "t('notifications.inbox.columns.readState', 'Read state')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxDelivery.tsx",
    "t('notifications.inbox.delivery.deferred_dnd', 'Deferred by DND')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxDetails.tsx",
    "t('notifications.inbox.detail.latency', 'Delivery latency')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxDetails.tsx",
    "t('notifications.inbox.detail.channel', 'Channel ID')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxDetails.tsx",
    "t('notifications.inbox.detail.error', 'Delivery error')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxTable.tsx",
    "t('notifications.inbox.detail.error', 'Delivery error')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxDetails.tsx",
    "t('notifications.inbox.detail.actions', 'Notification actions')"
  ],
  [
    "web/src/features/notifications/components/NotificationInboxTable.tsx",
    "t('notifications.inbox.row.inspect', 'Inspect notification: {{title}}', { title: log.title || '—' })"
  ],
  [
    "web/src/features/notifications/pages/ArchivedPage.tsx",
    "t('notifications.archived.title', 'Archived notifications')"
  ],
  [
    "web/src/features/notifications/pages/ArchivedPage.tsx",
    "t('notifications.archived.title', 'Archived notifications')"
  ],
  [
    "web/src/features/notifications/pages/ArchivedPage.tsx",
    "t(\n        'notifications.archived.subtitle',\n        'Notifications you previously archived. Restore to bring them back.',\n      )"
  ],
  [
    "web/src/features/notifications/pages/ArchivedPage.tsx",
    "t('notifications.archived.backToInbox', 'Back to inbox')"
  ],
  [
    "web/src/features/notifications/pages/BrowserNotificationsPage.tsx",
    "t(\n              'notifications.device.sectionAria',\n              'Per-device notification and data rules',\n            )"
  ],
  [
    "web/src/features/notifications/pages/ChannelsPage.tsx",
    "t('notifications.channels.subtitle', 'Where to send notifications: Discord, Slack, Telegram, email, ntfy, Pushover, or a custom webhook.')"
  ],
  [
    "web/src/features/notifications/pages/ChannelsPage.tsx",
    "t('notifications.channels.statsAria', 'Notification delivery summary')"
  ],
  [
    "web/src/features/notifications/pages/ChannelsPage.tsx",
    "t('notifications.channels.devicesTitle', 'Devices & providers')"
  ],
  [
    "web/src/features/notifications/pages/InboxPage.tsx",
    "t('notifications.inbox.viewArchived', 'View archived')"
  ],
  [
    "web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx",
    "t(\n            'onboarding.runtimeHealth.telemetryLastSeen',\n            'Fleet Telemetry is stale. The last signal arrived {{time}}.',\n            { time: formatDateTime(lastTelemetryAt) },\n          )"
  ],
  [
    "web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx",
    "t(\n            'onboarding.runtimeHealth.telemetryStale',\n            'Fleet Telemetry is stale and live values may be out of date.',\n          )"
  ],
  [
    "web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx",
    "t(\n        'onboarding.runtimeHealth.title',\n        'Setup is complete, but a live service needs attention',\n      )"
  ],
  [
    "web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx",
    "t(\n            'onboarding.runtimeHealth.access',\n            'You can keep using TeslaSync and viewing stored history while live services recover.',\n          )"
  ],
  [
    "web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx",
    "t(\n              'onboarding.runtimeHealth.teslaAuth',\n              'Your Tesla account authorization is unavailable and may need to be renewed.',\n            )"
  ],
  [
    "web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx",
    "t('onboarding.runtimeHealth.reconnect', 'Reconnect Tesla account')"
  ],
  [
    "web/src/features/onboarding/components/OnboardingRuntimeHealthNotice.tsx",
    "t('onboarding.runtimeHealth.alerts', 'Configure health alerts')"
  ],
  [
    "web/src/features/onboarding/components/Stepper.tsx",
    "t('onboarding.stepper.status.pending', 'Not started')"
  ],
  [
    "web/src/features/onboarding/components/Stepper.tsx",
    "t('onboarding.stepper.empty', 'No setup steps to show right now.')"
  ],
  [
    "web/src/features/onboarding/components/Stepper.tsx",
    "t('onboarding.stepper.label', 'Onboarding steps')"
  ],
  [
    "web/src/features/onboarding/components/TaskOnboardingHint.tsx",
    "t('onboarding.tasks.optOut', 'Stop showing setup tips')"
  ],
  [
    "web/src/features/onboarding/components/TaskOnboardingHint.tsx",
    "t('onboarding.tasks.dismiss', 'Dismiss this tip')"
  ],
  [
    "web/src/features/power-user/components/QueryReferencePanel.tsx",
    "t('powerSql.info.title', 'Working with queries')"
  ],
  [
    "web/src/features/power-user/components/QueryReferencePanel.tsx",
    "t(\n          'powerSql.info.readonly',\n          'This is a read-only composing surface. Nothing runs in the browser.',\n        )"
  ],
  [
    "web/src/features/power-user/components/QueryReferencePanel.tsx",
    "t('powerSql.info.exampleLabel', 'Example')"
  ],
  [
    "web/src/features/power-user/components/SchemaCatalogCard.tsx",
    "t('powerSql.catalog.noDescription', 'No description')"
  ],
  [
    "web/src/features/power-user/components/SchemaCatalogCard.tsx",
    "t('powerSql.catalog.columnCount', '{{count}} cols', {\n            count: columns.length,\n          })"
  ],
  [
    "web/src/features/power-user/components/SchemaCatalogCard.tsx",
    "t('powerSql.catalog.primaryKey', 'Primary key')"
  ],
  [
    "web/src/features/power-user/components/SchemaCatalogCard.tsx",
    "t('powerSql.catalog.noColumns', 'No columns documented for this table.')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t('powerDashboards.title', 'Dashboard composer')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t('powerDashboards.title', 'Dashboard composer')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n        'powerDashboards.editor.copySuccess',\n        'Copied. Paste the JSON into your Grafana dashboard editor (dashboard settings → JSON Model).',\n      )"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t('powerDashboards.howTo.step1.title', 'Pick panels')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n          'powerDashboards.howTo.step1.body',\n          'Choose from the curated catalog — each panel maps to a real query against your fleet data.',\n        )"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t('powerDashboards.howTo.step2.title', 'Compose JSON')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n          'powerDashboards.howTo.step2.body',\n          'Place panels on the 24-column grid in the editor, or let Helix draft the envelope for you.',\n        )"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t('powerDashboards.howTo.step3.title', 'Copy to Grafana')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n          'powerDashboards.howTo.step3.body',\n          'Copy the envelope and paste it into Grafana under dashboard settings → JSON Model.',\n        )"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n          'powerDashboards.subtitle',\n          'Assemble a Grafana dashboard JSON envelope from curated panels, then copy it into Grafana.',\n        )"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n                'powerDashboards.intro',\n                'Compose a Grafana dashboard JSON envelope by picking panels from the curated catalog below and placing them on the 24-column grid. The browser does not push the dashboard to Grafana; copy your JSON into your existing Grafana dashboard editor.',\n              )"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t('powerDashboards.editor.title', 'Manual dashboard JSON editor')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n                  'powerDashboards.editor.helper',\n                  'Edit the Grafana JSON model directly. Nothing is sent to Grafana — you copy it in yourself.',\n                )"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n                  'powerDashboards.editor.placeholder',\n                  '{\\n  \"title\": \"Fleet overview\",\\n  \"slots\": [\\n    {\\n      \"panel_name\": \"drives_per_day_timeseries\",\\n      \"grid_pos\": { \"x\": 0, \"y\": 0, \"w\": 24, \"h\": 8 }\\n    }\\n  ]\\n}',\n                )"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t('powerDashboards.editor.label', 'Dashboard JSON editor')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t('powerDashboards.panels.title', 'Curated panel catalog')"
  ],
  [
    "web/src/features/power-user/pages/DashboardsPage.tsx",
    "t(\n                  'powerDashboards.panels.intro',\n                  'These are the panels the curated catalog exposes. The Helix natural-language composer refuses any panel_name outside this list, and each dashboard may use each panel_name at most once.',\n                )"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t('powerSql.title', 'SQL playground')"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t('powerSql.title', 'SQL playground')"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t(\n          'powerSql.editor.runEmpty',\n          'Type or paste a SELECT/WITH query above before running.',\n        )"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t(\n        'powerSql.editor.runUnavailable',\n        'Read-only execution from the browser is not enabled in this build. Copy the query into your preferred database client (psql, DBeaver, TablePlus) and run it there.',\n      )"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t(\n        'powerSql.subtitle',\n        'Compose read-only SELECT / WITH queries against the curated schema catalog. Queries never execute in the browser — copy them into your database client.',\n      )"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t('powerSql.workspace.label', 'Query workspace')"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t('powerSql.editor.title', 'Manual SQL editor')"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t(\n                  'powerSql.editor.placeholder',\n                  'SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL \\'7 days\\'',\n                )"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t('powerSql.editor.label', 'SQL query editor')"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t('powerSql.editor.copy', 'Copy query')"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t(\n                    'powerSql.editor.copyTitle',\n                    'Copy the query to paste into your database client',\n                  )"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t('powerSql.catalog.title', 'Curated schema catalog')"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t('powerSql.catalog.title', 'Curated schema catalog')"
  ],
  [
    "web/src/features/power-user/pages/SqlPlaygroundPage.tsx",
    "t(\n                'powerSql.catalog.intro',\n                'These tables are the only tables the curated catalog exposes. The Helix natural-language drafter refuses any query referencing tables outside this list.',\n              )"
  ],
  [
    "web/src/features/service-intelligence/components/WarrantyPanel.tsx",
    "t(\n          'serviceIntelligence.warranty.selectMessage',\n          'Choose a vehicle to count down its warranty coverage.',\n        )"
  ],
  [
    "web/src/features/service-intelligence/components/WarrantyPanel.tsx",
    "t('serviceIntelligence.warranty.emptyTitle', 'No warranty outlook')"
  ],
  [
    "web/src/features/service-intelligence/components/WarrantyPanel.tsx",
    "t(\n          'serviceIntelligence.warranty.empty',\n          'Coverage countdown is not available for this vehicle yet.',\n        )"
  ],
  [
    "web/src/features/service-intelligence/components/WarrantyPanel.tsx",
    "t('serviceIntelligence.warranty.detail', 'ends {{date}} · {{days}} days left', {\n                    date: c.expires_at,\n                    days: fmtInt(Math.max(c.days_remaining, 0)),\n                  })"
  ],
  [
    "web/src/features/service-intelligence/components/WarrantyPanel.tsx",
    "t('serviceIntelligence.warranty.kmLeft', '{{km}} km left', {\n                        km: fmtNumber(Math.max(c.km_remaining, 0)),\n                      })"
  ],
  [
    "web/src/features/settings/components/AICostCapSpendBar.tsx",
    "t('ai.settings.costCap.unavailable', 'Spend unavailable')"
  ],
  [
    "web/src/features/settings/components/AICostCapSpendBar.tsx",
    "t('ai.settings.costCap.amount', '${{spent}} / ${{cap}}', {\n          spent: fmtNumber(todayDollars),\n          cap: fmtNumber(capDollars),\n          defaultValue: `$${fmtNumber(todayDollars)} / $${fmtNumber(capDollars)}`,\n        })"
  ],
  [
    "web/src/features/settings/components/AICostCapSpendBar.tsx",
    "t('ai.settings.costCap.todayTitle', 'Today’s Helix spend')"
  ],
  [
    "web/src/features/settings/components/AICostCapSpendBar.tsx",
    "t('ai.settings.costCap.barLabel', 'Helix cost cap usage')"
  ],
  [
    "web/src/features/settings/components/AICostCapSpendBar.tsx",
    "t(\n            'ai.settings.costCap.unavailableHint',\n            'Could not load today’s spend. The cap is still enforced server-side.',\n          )"
  ],
  [
    "web/src/features/settings/components/AICostCapSpendBar.tsx",
    "t(\n            'ai.settings.costCap.criticalHint',\n            'Cap reached — new Helix calls will be rejected until the cap resets at UTC midnight or you raise it.',\n          )"
  ],
  [
    "web/src/features/settings/components/AICostCapSpendBar.tsx",
    "t(\n            'ai.settings.costCap.warnHint',\n            'You are nearing today’s cap. Calls will pause once you reach it.',\n          )"
  ],
  [
    "web/src/features/settings/components/AIFeatureToggleList.tsx",
    "t(\n            'ai.settings.feature.empty',\n            'No AI features are available yet.',\n          )"
  ],
  [
    "web/src/features/settings/components/AppearanceSettings.tsx",
    "t(\n        'theme.chartPalette.cbSafeHelp',\n        'Okabe-Ito palette — distinguishable for all CVD types.',\n      )"
  ],
  [
    "web/src/features/settings/components/AppearanceSettings.tsx",
    "t(\n        'theme.chartPalette.neonHelp',\n        'Bright cyan/magenta — best when colour vision is unimpaired.',\n      )"
  ],
  [
    "web/src/features/settings/components/FeatureToggles.tsx",
    "t('featureConfig.errorTitle', 'Couldn’t load feature config')"
  ],
  [
    "web/src/features/settings/components/FeatureToggles.tsx",
    "t('featureConfig.errorMessage', 'Something went wrong fetching your Tesla feature configuration. Check your connection and try again.')"
  ],
  [
    "web/src/features/settings/components/fleet-setup/FleetSetupReadiness.tsx",
    "t('fleetSetup.readiness.caValue', 'Let’s encrypt ISRG root X1')"
  ],
  [
    "web/src/features/settings/components/fleet-setup/FleetSetupSubscribePanel.tsx",
    "t(\n            'fleetSetup.subscribe.needAuth',\n            'Connect Tesla first. Subscribe uses the stored Fleet token.',\n          )"
  ],
  [
    "web/src/features/settings/components/fleet-setup/FleetSetupSubscribePanel.tsx",
    "t(\n                'fleetSetup.subscribe.signalsPicked',\n                '{{count}} signals selected. Presets (Balanced, Low Power, Track Mode, …) set intervals per category.',\n                { count: selectedSignals.length },\n              )"
  ],
  [
    "web/src/features/settings/components/privacy/ConsentControlPanel.tsx",
    "t(\n                  'account.privacy.consent.policyError',\n                  'Deployment consent policy unavailable — you can still manage your own choice below.',\n                )"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyGuaranteesPanel.tsx",
    "t('account.privacy.about.localTitle', 'Stored on this device')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyGuaranteesPanel.tsx",
    "t(\n          'account.privacy.about.localBody',\n          'Recently viewed pages and your cookie choice live in this browser’s local storage — they are never uploaded to the server.',\n        )"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyGuaranteesPanel.tsx",
    "t('account.privacy.about.syncTitle', 'No cross-device sync')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyGuaranteesPanel.tsx",
    "t(\n          'account.privacy.about.syncBody',\n          'Each browser keeps its own list and consent state. Clearing them here has no effect on your other devices or sessions.',\n        )"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyGuaranteesPanel.tsx",
    "t('account.privacy.about.controlTitle', 'You stay in control')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyGuaranteesPanel.tsx",
    "t(\n          'account.privacy.about.controlBody',\n          'Wipe your history or change your consent at any time. Changes take effect immediately and update every open tab.',\n        )"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyGuaranteesPanel.tsx",
    "t('account.privacy.about.title', 'How TeslaSync handles this data')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.loadError', 'Failed to load privacy policy')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.loadError', 'Failed to load privacy policy')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.aria', 'Privacy summary')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.aria', 'Privacy summary')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.recent', 'Recent pages stored')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.recent', 'Recent pages stored')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.recentMax', {\n                  defaultValue: 'of {{max}} max',\n                  max: RECENT_PAGES_MAX,\n                })"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.recentMax', 'of {{max}} max', { max: RECENT_PAGES_MAX })"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.consent', 'Consent status')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.consent', 'Consent status')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.policy', 'Consent policy')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.policy', 'Consent policy')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.policyRequiredSub', 'Consent gate enabled')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.policyRequiredSub', 'Consent gate enabled')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.policyOptionalSub', 'No consent gate')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.policyOptionalSub', 'No consent gate')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.scope', 'Data scope')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.scope', 'Data scope')"
  ],
  [
    "web/src/features/settings/components/privacy/PrivacyKpiCards.tsx",
    "t('account.privacy.kpi.scopeSub', 'Local only — never synced')"
  ],
  [
    "web/src/features/settings/components/statstrip-privacy/PrivacyOperationalBrief.tsx",
    "t('account.privacy.kpi.scopeSub', 'Local only — never synced')"
  ],
  [
    "web/src/features/settings/components/QuietHoursPanel.tsx",
    "t(\n        'quietHours.form.unsaved',\n        'You have unsaved quiet-hours changes. Discard them?',\n      )"
  ],
  [
    "web/src/features/settings/components/QuietHoursPanel.tsx",
    "t('quietHours.error.missingDraft', 'The quiet-hours draft is unavailable. Reopen the editor.')"
  ],
  [
    "web/src/features/settings/components/RegionSettings.tsx",
    "t('region.loading', 'Loading region…')"
  ],
  [
    "web/src/features/settings/components/RegionSettings.tsx",
    "t('region.noRegion', 'Tesla did not return a region for this account.')"
  ],
  [
    "web/src/features/settings/components/sessions/SessionBreakdownPanel.tsx",
    "t('account.sessions.breakdownError', 'Failed to load sessions')"
  ],
  [
    "web/src/features/settings/components/sessions/SessionsOpenModeNotice.tsx",
    "t('account.sessions.openMode.title', 'Session tracking unavailable')"
  ],
  [
    "web/src/features/settings/components/sessions/SessionsOpenModeNotice.tsx",
    "t(\n          'account.sessions.openMode.message',\n          'Active session tracking requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User, then reload.',\n        )"
  ],
  [
    "web/src/features/settings/components/sessions/SessionsTable.tsx",
    "t('account.sessions.tableAria', 'Active devices')"
  ],
  [
    "web/src/features/settings/components/sessions/SessionsTable.tsx",
    "t('account.sessions.tableTitle', 'Active devices')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpBackupCodesModal.tsx",
    "t(\n                  'totp.backupCodes.empty',\n                  'No backup codes were returned. Close this dialog and regenerate your codes from the two-factor settings.',\n                )"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpCompatibleApps.tsx",
    "t('totp.apps.title', 'Compatible apps')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpCompatibleApps.tsx",
    "t('totp.apps.subtitle', 'Any RFC 6238 TOTP client works.')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpRecoveryPanel.tsx",
    "t('totp.recovery.tip1', 'Each backup code works once — regenerate when you are running low.')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpRecoveryPanel.tsx",
    "t(\n        'totp.recovery.tip2',\n        'Store codes in your password manager, not next to your authenticator app.',\n      )"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpRecoveryPanel.tsx",
    "t('totp.recovery.tip3', 'Codes rotate every 30 seconds; if one is rejected, wait for the next.')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpRecoveryPanel.tsx",
    "t('totp.recovery.title', 'Recovery & good habits')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpRecoveryPanel.tsx",
    "t('totp.recovery.subtitle', 'Keep a way back in if you lose your phone.')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t('totp.guide.step1.title', 'Install an authenticator app')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t(\n            'totp.guide.step1.body',\n            'Use any RFC 6238 client — Google Authenticator, 1Password, Bitwarden or Authy.',\n          )"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t('totp.guide.step2.title', 'Scan the QR code')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t(\n            'totp.guide.step2.body',\n            'Choose Enable TOTP, then scan the QR or paste the manual secret into your app.',\n          )"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t('totp.guide.step3.title', 'Verify a 6-digit code')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t(\n            'totp.guide.step3.body',\n            'Enter the rotating code your app shows to confirm both devices are in sync.',\n          )"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t('totp.guide.step4.title', 'Store your backup codes')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t(\n            'totp.guide.step4.body',\n            'Save the one-time codes somewhere safe — they recover access if you lose your app.',\n          )"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t('totp.guide.title', 'How setup works')"
  ],
  [
    "web/src/features/settings/components/twofactor/TotpSetupGuide.tsx",
    "t('totp.guide.subtitle', 'Four steps, about a minute.')"
  ],
  [
    "web/src/features/settings/components/TypographySettings.tsx",
    "t('typography.monoFont.customPlaceholder', \"e.g. 'Cascadia Code', ui-monospace, monospace\")"
  ],
  [
    "web/src/features/settings/pages/HelixPage.tsx",
    "t(\n        'helix.page.subtitle',\n        'Optional AI integration. Off by default — nothing runs until you opt in here.',\n      )"
  ],
  [
    "web/src/features/settings/pages/PrivacyPage.tsx",
    "t(\n        'account.privacy.subtitle',\n        'Manage browser-local data: recently viewed pages and cookies / analytics consent.',\n      )"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/ShareCardBrief.tsx",
    "t('shareCard.brief.paused', 'Cached evidence; refresh paused')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/ShareCardBrief.tsx",
    "t('shareCard.brief.refreshing', 'Refreshing cached evidence')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/ShareCardBrief.tsx",
    "t('shareCard.brief.eyebrow', 'Share card evidence')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/ShareCardBrief.tsx",
    "t('shareCard.brief.freshness', 'Drive timestamps describe the evidence window, not query freshness.')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.description', 'Totals cover only the returned recent-trip list (at most 20 trips), not all trips or a selected date window.')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.loading', 'Loading recent trips')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.retained', 'Cached trips; refresh failed')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.paused', 'Cached trips; refresh paused')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.refreshing', 'Refreshing cached trips')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.resolved', 'Recent-trip list resolved')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.eyebrow', 'Sharing')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.title', 'Recent-trip evidence')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.fleet', 'Fleet recent-trip list')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.vehicle', 'Selected vehicle recent-trip list')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.freshness', 'Trip dates are source periods; no query freshness timestamp is inferred.')"
  ],
  [
    "web/src/features/sharing/components/operationalbrief-all/SharingTripsBrief.tsx",
    "t('sharing.trips.brief.provenance', 'GET /trips; limit 20; totals retain the existing safe-number aggregation of returned fields.')"
  ],
  [
    "web/src/features/sharing/components/share-card/ShareCardEfficiencyEvidence.tsx",
    "t('shareCard.brief.efficiencyDescription', 'Consumption uses only positive-distance energy rows; recovered share uses paired energy and regen rows. Missing fields are not measured zero.')"
  ],
  [
    "web/src/features/sharing/components/share-card/ShareCardEvidenceLedger.tsx",
    "t('shareCard.brief.description', 'Only returned, runtime-validated selected-window evidence supports these measurements; field coverage and the query cap remain explicit.')"
  ],
  [
    "web/src/features/sharing/pages/SharedDrivePage.tsx",
    "t('share.loading', 'Loading shared drive report…')"
  ],
  [
    "web/src/features/sharing/pages/SharedSessionReport.tsx",
    "t('share.sessionHeader', 'Shared charging report')"
  ],
  [
    "web/src/features/sharing/pages/SharedSessionReport.tsx",
    "t('share.curve.aria', 'Shared session power and battery chart by minute')"
  ],
  [
    "web/src/features/sharing/pages/SharedSessionReport.tsx",
    "t('share.socTooltipLabel', 'Battery (%)')"
  ],
  [
    "web/src/features/sharing/pages/SharedSessionReport.tsx",
    "t('share.noCurveData', 'The charge curve was not included in this share.')"
  ],
  [
    "web/src/features/system/components/activity-timeline/ActivityOverview.tsx",
    "t('activity.timeline.brief.countTitle', 'Range and page counts')"
  ],
  [
    "web/src/features/system/components/activity-timeline/ActivityOverview.tsx",
    "t('activity.timeline.brief.description', 'The server total covers the selected range; loaded events, days, and critical alerts describe this page only.')"
  ],
  [
    "web/src/features/system/components/activity-timeline/ActivityOverview.tsx",
    "t('activity.timeline.brief.scope', 'Selected range and current loaded page have different coverage.')"
  ],
  [
    "web/src/features/system/components/activity-timeline/ActivityOverview.tsx",
    "t('activity.timeline.brief.scope', 'Selected range and current loaded page have different coverage.')"
  ],
  [
    "web/src/features/system/components/activity-timeline/ActivityOverview.tsx",
    "t('activity.timeline.brief.mixDescription', 'Counts by event type describe only the loaded page, not the entire selected range.')"
  ],
  [
    "web/src/features/system/components/chatbot/KnowledgeCitations.tsx",
    "t('chatbot.knowledge.title', 'Retrieved documentation')"
  ],
  [
    "web/src/features/system/components/chatbot/KnowledgeCitations.tsx",
    "t('chatbot.knowledge.inspect', 'Inspect retrieved sources')"
  ],
  [
    "web/src/features/system/components/chatbot/KnowledgeCitations.tsx",
    "t('chatbot.knowledge.freshness', 'Bundled documentation from this deployment; publication dates are unavailable. Only sources named in the answer are marked cited.')"
  ],
  [
    "web/src/features/system/components/chatbot/KnowledgeCitations.tsx",
    "t('chatbot.knowledge.part', 'chunk')"
  ],
  [
    "web/src/features/system/components/chatbot/KnowledgeCitations.tsx",
    "t('chatbot.knowledge.cited', 'Cited in answer')"
  ],
  [
    "web/src/features/system/components/chatbot/KnowledgeCitations.tsx",
    "t('chatbot.knowledge.retrieved', 'Retrieved, not cited')"
  ],
  [
    "web/src/features/system/components/chatbot/SessionList.tsx",
    "t('chatbot.rename.placeholder', 'Conversation name')"
  ],
  [
    "web/src/features/system/components/command-center/CommandCenterHero.tsx",
    "t('commands.hero.briefDescription', 'Battery, estimated range, cabin temperature, and access state from the selected vehicle readings.')"
  ],
  [
    "web/src/features/system/components/FSMStateDiagram.tsx",
    "t('fsm.noObservedState', 'No observed state')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.title', 'Dashboard presets')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t(\n          'dashboardPresets.subtitle',\n          'Curated widget sets for the four ways this app is used. Choosing one updates your existing dashboard in place — it does not create another one, and it never overwrites changes you make afterwards.',\n        )"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.applyOnDashboard', 'Open the dashboard to apply it')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.openDashboard', 'Open the dashboard')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.selected', 'Selected — tap to clear')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.pending', 'Chosen — tap to clear')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.chosenDiverged', 'Chosen — tap to clear')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.choose', 'Use this preset')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.includes', 'Includes')"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t(\n            'dashboardPresets.pendingNote',\n            'Chosen — applies to your dashboard next time you open it.',\n          )"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t(\n            'dashboardPresets.divergedNote',\n            'Your dashboard has changed since this preset was applied. Your changes are kept — re-apply only if you want the preset back.',\n          )"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t(\n            'dashboardPresets.activeUnchosenNote',\n            'This is what your dashboard looks like right now, but a different preset is chosen.',\n          )"
  ],
  [
    "web/src/features/system/components/help-index/DashboardPresetPanel.tsx",
    "t('dashboardPresets.reapply', 'Re-apply to my dashboard')"
  ],
  [
    "web/src/features/system/components/help-index/GuidedHelpPanel.tsx",
    "t('help.guided.title', 'Show me around')"
  ],
  [
    "web/src/features/system/components/help-index/GuidedHelpPanel.tsx",
    "t(\n          'help.guided.subtitle',\n          'Walkthroughs run only when you ask for them — nothing here starts on its own.',\n        )"
  ],
  [
    "web/src/features/system/components/help-index/GuidedHelpPanel.tsx",
    "t('help.guided.intro', 'Replay the product introduction')"
  ],
  [
    "web/src/features/system/components/help-index/GuidedHelpPanel.tsx",
    "t('help.guided.tours', 'Browse guided tours')"
  ],
  [
    "web/src/features/system/components/help-index/HelpGlossaryPanel.tsx",
    "t('glossary.panelTitle', 'What the numbers mean')"
  ],
  [
    "web/src/features/system/components/help-index/HelpGlossaryPanel.tsx",
    "t(\n          'glossary.panelSubtitle',\n          'Definitions for the terms that are easiest to misread, and where each number actually comes from.',\n        )"
  ],
  [
    "web/src/features/system/components/help-index/HelpGlossaryPanel.tsx",
    "t('glossary.howMeasured', 'How we measure it')"
  ],
  [
    "web/src/features/system/components/help-index/HelpGlossaryPanel.tsx",
    "t('glossary.seeInContext', 'See it in context')"
  ],
  [
    "web/src/features/system/components/help-index/HelpSearch.tsx",
    "t('helpIndex.searchLabel', 'Search help')"
  ],
  [
    "web/src/features/system/components/help-index/HelpSearch.tsx",
    "t(\n          'helpIndex.searchPlaceholder',\n          'Search terms, pages and troubleshooting — e.g. \"phantom drain\"',\n        )"
  ],
  [
    "web/src/features/system/components/help-index/HelpSearch.tsx",
    "t('helpIndex.relevantHere', 'Relevant to this page')"
  ],
  [
    "web/src/features/system/components/help-index/HelpSearch.tsx",
    "t('helpIndex.resultsLabel', 'Help results')"
  ],
  [
    "web/src/features/system/components/help-index/HelpSearch.tsx",
    "t(\n            'helpIndex.noResults',\n            'Nothing in the help index matches that. Try a shorter word, or send a problem report below.',\n          )"
  ],
  [
    "web/src/features/system/components/help-index/ReleaseNotesPanel.tsx",
    "t('releaseNotes.title', \"What's changed\")"
  ],
  [
    "web/src/features/system/components/help-index/ReleaseNotesPanel.tsx",
    "t(\n          'releaseNotes.subtitle',\n          'Generated from the project changelog. \"Action needed\" is flagged conservatively — a false alarm costs a minute, a missed migration costs an outage.',\n        )"
  ],
  [
    "web/src/features/system/components/help-index/ReleaseNotesPanel.tsx",
    "t('releaseNotes.empty', 'No releases have been published yet.')"
  ],
  [
    "web/src/features/system/components/help-index/ReleaseNotesPanel.tsx",
    "t('releaseNotes.actionNeeded', 'Action needed')"
  ],
  [
    "web/src/features/system/components/help-index/ReleaseNotesPanel.tsx",
    "t('releaseNotes.migration', 'Migration')"
  ],
  [
    "web/src/features/system/components/help-index/ReleaseNotesPanel.tsx",
    "t('releaseNotes.itemActionPrefix', 'Action:')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.title', 'Support bundle')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.title', 'Support bundle')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t(\n              'supportBundle.subtitle',\n              'A redacted technical summary of this browser session. Copy or download it to attach to a support conversation.',\n            )"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.subtitle', 'A redacted technical summary of this browser session. Copy or download it to attach to a support conversation.')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.copy', 'Copy bundle')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.brief.scope', 'Current browser-session bundle; exact redacted contents remain available below.')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.brief.metadata', 'Redacted browser-session bundle metadata.')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.brief.metadata', 'Redacted browser-session bundle metadata.')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.brief.metadata', 'Redacted browser-session bundle metadata.')"
  ],
  [
    "web/src/features/system/components/help-index/SupportBundlePanel.tsx",
    "t('supportBundle.showJson', 'Show the exact bundle contents')"
  ],
  [
    "web/src/features/system/components/incident/IncidentUpdateForm.tsx",
    "t('incidentTimeline.unsavedUpdate', 'You have an unsaved incident update.')"
  ],
  [
    "web/src/features/system/components/incident/IncidentUpdateForm.tsx",
    "t('incidentTimeline.formLabel', 'Add incident update')"
  ],
  [
    "web/src/features/system/components/my-activity/ActivityFeedPanel.tsx",
    "t('activity.myActivity.feed.error', 'Failed to load activity feed')"
  ],
  [
    "web/src/features/system/components/my-activity/ActivityFeedPanel.tsx",
    "t('activity.myActivity.feed.loading', 'Loading activity feed')"
  ],
  [
    "web/src/features/system/components/my-activity/ActivityHourPanel.tsx",
    "t(\n            'activity.myActivity.byHour.chartAria',\n            'Activity counts by hour of day',\n          )"
  ],
  [
    "web/src/features/system/components/my-activity/MyActivityKpiBand.tsx",
    "t('activity.myActivity.brief.description', 'Actions, active days, action types, and entities derived from the loaded personal activity feed.')"
  ],
  [
    "web/src/features/system/components/my-activity/MyActivityKpiBand.tsx",
    "t('activity.myActivity.brief.scope', 'Loaded recent activity only; not a complete account lifetime total.')"
  ],
  [
    "web/src/features/system/components/my-activity/MyActivityKpiBand.tsx",
    "t('activity.myActivity.brief.lastContext', 'Most recent timestamp in the loaded feed.')"
  ],
  [
    "web/src/features/system/components/operationalbrief-all/SystemSummaryBrief.tsx",
    "t('system.brief.freshnessUnknown', 'Source observation time not supplied')"
  ],
  [
    "web/src/features/system/components/operationalbrief-all/SystemSummaryBrief.tsx",
    "t('system.brief.eyebrow', 'System evidence')"
  ],
  [
    "web/src/features/system/components/RepairCaseQueue.tsx",
    "t('dataRepair.cases.rowLabel', 'Case #{{id}}, {{rule}}', {\n                id: item.id,\n                rule: repairCodeLabel(t, item.rule),\n              })"
  ],
  [
    "web/src/features/system/components/RepairCaseStats.tsx",
    "t('dataRepair.cases.briefDescription', 'Server-reported repair case workload; active cases are open plus in-review cases.')"
  ],
  [
    "web/src/features/system/components/RepairCaseStats.tsx",
    "t('dataRepair.cases.briefScope', 'Repair case statistics response; separate from the filtered queue and diagnosis scan.')"
  ],
  [
    "web/src/features/system/components/RepairDiagnosisOverview.tsx",
    "t('dataRepair.brief.description', 'Suggested session boundary repairs and blocked cases from the durable-history diagnosis response.')"
  ],
  [
    "web/src/features/system/components/RepairDiagnosisOverview.tsx",
    "t('dataRepair.brief.scope', 'Current diagnosis response; not a complete lifetime count.')"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandHistory.total', 'Total commands')"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandReliability.overall', 'Overall success')"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandReliability.attempts', '{{n}} attempts', {\r\n          n: summary?.totalAttempts ?? '—',\r\n        })"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandReliability.unreliable', 'Unreliable commands')"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandReliability.allFine', 'Nothing failing')"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandReliability.intents', 'Distinct intents')"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandReliability.intentsHint', 'after collapsing retry storms')"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandReliability.storms', 'Retry storms')"
  ],
  [
    "web/src/features/system/components/statstrip-command-summaries/commandSummaryMetrics.tsx",
    "t('commandReliability.stormsHint', 'you pressed it again, and again')"
  ],
  [
    "web/src/features/system/components/statstrip-fsm/FSMOperationalBrief.tsx",
    "t('fsm.kpis', 'FSM summary metrics')"
  ],
  [
    "web/src/features/system/components/status/AiSpendWatch.tsx",
    "t('systemStatus.aiSpend.briefScope', 'Audited today (UTC), prior seven-day daily average, and projected UTC midnight spend are different windows.')"
  ],
  [
    "web/src/features/system/components/status/AiSpendWatch.tsx",
    "t('systemStatus.aiSpend.todayMetric', 'Audited today (UTC)')"
  ],
  [
    "web/src/features/system/components/status/AiSpendWatch.tsx",
    "t('systemStatus.aiSpend.baselineMetric', 'Prior 7-day daily average')"
  ],
  [
    "web/src/features/system/components/status/AiSpendWatch.tsx",
    "t('systemStatus.aiSpend.projectionMetric', 'Projected UTC midnight spend')"
  ],
  [
    "web/src/features/system/components/status/BackgroundWorkersCard.tsx",
    "t('systemStatus.workersBrief.description', 'Reported worker types, healthy replicas, and replicated types from the worker health response.')"
  ],
  [
    "web/src/features/system/components/status/BackgroundWorkersCard.tsx",
    "t('systemStatus.workersBrief.scope', 'Reported instances only; this response does not prove unreported replicas are healthy.')"
  ],
  [
    "web/src/features/system/components/status/IncidentForm.tsx",
    "t(\n        'systemStatus.incidents.unsaved',\n        'You have unsaved incident details. Discard them?',\n      )"
  ],
  [
    "web/src/features/system/components/status/IncidentForm.tsx",
    "t(\n        'systemStatus.incidents.titleMin',\n        'Title must be at least 3 characters.',\n      )"
  ],
  [
    "web/src/features/system/components/status/IncidentForm.tsx",
    "t(\n              'systemStatus.incidents.titlePlaceholder',\n              'e.g. Wall connector restart at 14:00',\n            )"
  ],
  [
    "web/src/features/system/components/status/IncidentForm.tsx",
    "t(\n              'systemStatus.incidents.componentsHint',\n              'Optional. Separate multiple component names with commas.',\n            )"
  ],
  [
    "web/src/features/system/components/status/IncidentForm.tsx",
    "t('systemStatus.incidents.messagePlaceholder', \"What's the situation?\")"
  ],
  [
    "web/src/features/system/components/status/ScheduledMaintenanceCard.tsx",
    "t('systemStatus.maintenance.messagePlaceholder', \"What's happening (optional)\")"
  ],
  [
    "web/src/features/system/components/status/SLOTrackingCard.tsx",
    "t('systemStatus.slo.metricsTitle', 'Uptime evidence')"
  ],
  [
    "web/src/features/system/components/status/SLOTrackingCard.tsx",
    "t('systemStatus.slo.briefDescription', 'Historical uptime is shown only for a series-backed response; current component health is separate snapshot evidence.')"
  ],
  [
    "web/src/features/system/components/status/SLOTrackingCard.tsx",
    "t('systemStatus.slo.uptimeMetric', 'Historical uptime')"
  ],
  [
    "web/src/features/system/components/status/SLOTrackingCard.tsx",
    "t('systemStatus.slo.componentsMetric', 'Healthy components')"
  ],
  [
    "web/src/features/system/components/status/TelemetryPipelineCard.tsx",
    "t('systemStatus.pipelineBrief.description', 'Configured vehicles and recorded table counts; polling and stream liveness remain independent evidence below.')"
  ],
  [
    "web/src/features/system/components/status/TelemetryPipelineCard.tsx",
    "t('systemStatus.pipelineBrief.scope', 'Vehicle response and database row-count snapshot; no shared historical window is supplied.')"
  ],
  [
    "web/src/features/system/components/status/TelemetryPipelineCard.tsx",
    "t('systemStatus.pipelineBrief.livenessDescription', 'Configured vehicles classified by their most recent polling or Fleet Telemetry timestamp, using the existing liveness rules.')"
  ],
  [
    "web/src/features/system/components/status/TelemetryPipelineCard.tsx",
    "t('systemStatus.pipelineBrief.livenessScope', 'Current client-clock age: sending under 5 minutes, slow from 5 to under 30 minutes, stale from 30 minutes; offline means no valid timestamp, not confirmed vehicle disconnection.')"
  ],
  [
    "web/src/features/system/components/status/TelemetryPipelineCard.tsx",
    "t('systemStatus.pipelineBrief.livenessFreshness', 'Polling and stream timestamps remain independently visible on each vehicle row.')"
  ],
  [
    "web/src/features/system/components/status/TelemetryPipelineCard.tsx",
    "t('systemStatus.pipelineBrief.offlineMeaning', 'No valid polling or stream timestamp was supplied; missing evidence is not a measured outage.')"
  ],
  [
    "web/src/features/system/components/status/TeslaApiUsageCard.tsx",
    "t('teslaUsage.brief.cycleTitle', 'Cycle usage evidence')"
  ],
  [
    "web/src/features/system/pages/CommandHistoryPage.tsx",
    "t('commandHistory.noRangeData', 'No commands in the selected range')"
  ],
  [
    "web/src/features/system/pages/CommandHistoryPage.tsx",
    "t('commandHistory.kpis', 'Command metrics')"
  ],
  [
    "web/src/features/system/pages/CommandHistoryPage.tsx",
    "t('commandHistory.kpis', 'Command metrics')"
  ],
  [
    "web/src/features/system/pages/CommandHistoryPage.tsx",
    "t('commandHistory.topCommands', 'Top commands')"
  ],
  [
    "web/src/features/system/pages/CommandHistoryPage.tsx",
    "t('commandHistory.totalInRange', 'Total in range')"
  ],
  [
    "web/src/features/system/pages/CommandHistoryPage.tsx",
    "t('commandHistory.errorPrefix', 'Error: {{msg}}', { msg: cmd.error })"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t(\n        'commandReliability.subtitle',\n        'Which remote commands you can actually trust, graded on wilson confidence bounds rather than a raw success percentage',\n      )"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.kpis', 'Command reliability metrics')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.kpis', 'Command reliability metrics')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t(\n                'commandReliability.noData',\n                'No remote commands have been issued yet, so there is no reliability record to grade.',\n              )"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t(\n              'commandReliability.chartHint',\n              'Bars are the pessimistic lower bound; the dot is the raw success rate the log shows',\n            )"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.col.lower', 'Lower bound (%)')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.col.naive', 'Raw rate (%)')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.col.upper', 'Upper bound (%)')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.col.attempts', 'Attempts')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.rawRate', 'Raw rate')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.detail', 'Command breakdown')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('help.commandReliability.iconLabel', 'More info about intents')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.noCommands', 'No commands recorded yet.')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.outcomeValue', '{{ok}} ok · {{bad}} failed', {\n                        ok: c.success,\n                        bad: c.failure,\n                      })"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.interval', '95 % interval')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.effort', 'Attempts per intent')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.effortValue', '{{n}} · {{retried}} retried', {\n                        n: Math.round(c.attemptsPerIntent * 100) / 100,\n                        retried: c.retriedIntents,\n                      })"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.topError', 'Usual failure')"
  ],
  [
    "web/src/features/system/pages/CommandReliabilityPage.tsx",
    "t('commandReliability.topErrorValue', '{{msg}} (×{{n}})', {\n                            msg: c.topError,\n                            n: c.topErrorCount,\n                          })"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.presets.aria', 'Date range presets')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.brief.recordsDescription', 'Record counts reported by drive and charging export jobs in the loaded history.')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.brief.recordsScope', 'Exported records may overlap between jobs; these are not unique database session totals.')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.stats.aria', 'Export summary metrics')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.brief.description', 'Export counts, recorded file bytes, most frequent export type, and latest creation time from the loaded job history.')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.brief.scope', 'Loaded export jobs; no server-wide total or reporting window is supplied.')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.brief.bytesContext', 'Sum of recorded file sizes; jobs without a file size contribute no recorded bytes.')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.brief.lastContext', 'Latest job creation time, not completion or download time.')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.loadError', 'Failed to load export jobs')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.create.aria', 'Create a new export')"
  ],
  [
    "web/src/features/system/pages/DataExportPage.tsx",
    "t('dataExport.account.aria', 'Full account export')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.summary.passing', 'Passing')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.summary.passing', 'Passing')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.summary.passing', 'Passing')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.overallSection', 'Overall result')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.summary.title', 'Diagnostic summary')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.brief.description', 'Probe outcomes and recorded timings from the displayed diagnostic report.')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.brief.scope', 'One diagnostic run; total time is the sum of probe durations.')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.summary.total', 'Total checks')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.summary.slowest', 'Slowest check')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.downloadSuccess', 'Diagnostic report downloaded')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.checksTitle', 'Dependency checks')"
  ],
  [
    "web/src/features/system/pages/DiagnosticPage.tsx",
    "t('diagnostic.checksTitle', 'Dependency checks')"
  ],
  [
    "web/src/features/system/pages/HelpPage.tsx",
    "t('helpIndex.title', 'Search the help index')"
  ],
  [
    "web/src/features/system/pages/HelpPage.tsx",
    "t(\n                'helpIndex.subtitle',\n                'Definitions, pages and troubleshooting, indexed by term and route. Results are the same every time — no model, no network.',\n              )"
  ],
  [
    "web/src/features/system/pages/IncidentTimelinePage.tsx",
    "t('incidentTimeline.brief.description', 'Incident status, elapsed duration, recorded updates, affected components, source, and start time.')"
  ],
  [
    "web/src/features/system/pages/IncidentTimelinePage.tsx",
    "t('incidentTimeline.brief.unknownScope', 'Incident window unavailable until the source resolves.')"
  ],
  [
    "web/src/features/system/pages/IncidentTimelinePage.tsx",
    "t('incidentTimeline.brief.statusContext', 'Recorded incident lifecycle state; resolution controls remain below.')"
  ],
  [
    "web/src/features/system/pages/IncidentTimelinePage.tsx",
    "t('incidentTimeline.brief.sourceContext', 'Incident source as reported, without inference.')"
  ],
  [
    "web/src/features/system/pages/IncidentTimelinePage.tsx",
    "t('incidentTimeline.overview', 'Incident overview and details')"
  ],
  [
    "web/src/features/system/pages/IncidentTimelinePage.tsx",
    "t('incidentTimeline.timelineRegion', 'Incident timeline and updates')"
  ],
  [
    "web/src/features/system/pages/OutageAutobiographyPage.tsx",
    "t('system.outage.brief.scope', 'Selected vehicle outage evidence; no fixed reporting window is supplied.')"
  ],
  [
    "web/src/features/system/pages/OutageAutobiographyPage.tsx",
    "t('system.outage.brief.gapLabel', 'Telemetry gap')"
  ],
  [
    "web/src/features/system/pages/OutageAutobiographyPage.tsx",
    "t('system.outage.brief.timestampContext', 'Original event time; a missing timestamp does not imply zero traffic.')"
  ],
  [
    "web/src/features/system/pages/RoadmapPage.tsx",
    "t('roadmap.brief.scope', 'Bundled roadmap entries, not live deployment or release telemetry.')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t(\n        'search.subtitle',\n        'Find vehicles, drives, charging, alerts and more across your fleet',\n      )"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.refresh', 'Refresh results')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.filters.label', 'Filter results by type')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpis', 'Search summary')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.brief.description', 'Result counts and category coverage for the current query and selected type filters.')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpi.forQuery', 'for “{{query}}”', { query: trimmed })"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpi.totalResults', 'Total results')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.brief.scope', 'Returned search hits, not an unbounded server total.')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpi.ofTypes', 'of {{n}} searchable', { n: ALL_TYPES.length })"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpi.filtered', 'of {{n}} types', { n: ALL_TYPES.length })"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpi.allTypes', 'All types shown')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpi.topMatch', 'Top match')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpi.topCount', '{{n}} results', { n: topGroup.hits.length })"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.kpi.noMatches', 'No matches')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.results.region', 'Search results')"
  ],
  [
    "web/src/features/system/pages/SearchPage.tsx",
    "t('search.result.open', 'Open {{title}}', {\n                              title: hit.title,\n                            })"
  ],
  [
    "web/src/features/system/pages/StateMachineDebuggerPage.tsx",
    "t('fsm.overview', 'Vehicle state overview')"
  ],
  [
    "web/src/features/system/pages/StateMachineDebuggerPage.tsx",
    "t('fsm.analysis', 'Transition analysis')"
  ],
  [
    "web/src/features/system/pages/StateMachineDebuggerPage.tsx",
    "t('fsm.detail.name', 'FSM name')"
  ],
  [
    "web/src/features/system/pages/StatusApiDocsPage.tsx",
    "t('statusApi.brief.description', 'Documented endpoint count, transport, payload, and compatibility policy.')"
  ],
  [
    "web/src/features/system/pages/StatusApiDocsPage.tsx",
    "t('statusApi.brief.scope', 'Bundled documentation, not a runtime availability probe.')"
  ],
  [
    "web/src/features/telemetry/components/LiveThroughputPanel.tsx",
    "t('liveMonitor.streamConnected', 'Live throughput stream connected')"
  ],
  [
    "web/src/features/telemetry/components/LiveThroughputPanel.tsx",
    "t('liveMonitor.streamDisconnected', 'Live throughput stream disconnected')"
  ],
  [
    "web/src/features/telemetry/components/SignalCatalogPanel.tsx",
    "t('signalCatalog.removeSignal', { defaultValue: 'Remove {{name}} from selection', name: s.name })"
  ],
  [
    "web/src/features/telemetry/components/SignalCatalogPanel.tsx",
    "t('signalCatalog.addSignal',    { defaultValue: 'Add {{name}} to selection',      name: s.name })"
  ],
  [
    "web/src/features/telemetry/components/SignalCategoryTree.tsx",
    "t('common.unknownError', 'unknown error')"
  ],
  [
    "web/src/features/telemetry/components/SignalCategoryTree.tsx",
    "t('signals.catalog.loadError', 'Failed to load catalog: {{message}}', {\n                message: catalogError,\n              })"
  ],
  [
    "web/src/features/telemetry/components/SignalCategoryTree.tsx",
    "t('signals.catalog.empty', 'No signals available for this vehicle.')"
  ],
  [
    "web/src/features/telemetry/components/SignalLogBreakdownPanel.tsx",
    "t('signalLog.composition.noRecords', 'No records in the selected range.')"
  ],
  [
    "web/src/features/telemetry/components/SignalLogBreakdownPanel.tsx",
    "t('signalLog.composition.noRecords', 'No records in the selected range.')"
  ],
  [
    "web/src/features/telemetry/components/SignalLogBreakdownPanel.tsx",
    "t('signalLog.composition.empty', 'Run a query to see the value-type breakdown.')"
  ],
  [
    "web/src/features/telemetry/components/SignalLogKpiBand.tsx",
    "t('signalLog.kpi.totalRecords', 'Total records')"
  ],
  [
    "web/src/features/telemetry/components/SignalLogKpiBand.tsx",
    "t('signalLog.kpi.signalsWithData', '{{count}} with data', { count: s.distinctSignals })"
  ],
  [
    "web/src/features/telemetry/components/SignalLogKpiBand.tsx",
    "t('signalLog.kpi.timeSpan', 'Time span')"
  ],
  [
    "web/src/features/telemetry/components/SignalLogKpiBand.tsx",
    "t('signalLog.kpis', 'Query summary')"
  ],
  [
    "web/src/features/telemetry/components/SignalLogKpiBand.tsx",
    "t('signalLog.subtitle', 'Query signal history from Postgres')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalLog.subtitle', 'Query signal history from Postgres')"
  ],
  [
    "web/src/features/telemetry/pages/SignalLogViewerPage.tsx",
    "t('signalLog.subtitle', 'Query signal history from Postgres')"
  ],
  [
    "web/src/features/telemetry/components/SignalSparklinePreview.tsx",
    "t('telemetry.sparkline.nonNumeric', 'Non-numeric signal ({{kind}})', {\n          kind: valueKind,\n        })"
  ],
  [
    "web/src/features/telemetry/components/SignalSparklinePreview.tsx",
    "t('telemetry.sparkline.error', 'Failed to load trend')"
  ],
  [
    "web/src/features/telemetry/components/SignalSparklinePreview.tsx",
    "t('telemetry.sparkline.empty', 'No samples in last hour')"
  ],
  [
    "web/src/features/telemetry/components/SignalStatsPanel.tsx",
    "t('signalStats.noDataInRange', 'No data in range')"
  ],
  [
    "web/src/features/telemetry/components/SignalStatsPanel.tsx",
    "t('signalStats.hideEmpty', 'Hide empty ({{count}})', {\n                count: emptyCount,\n              })"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.bestR', 'Peak correlation')"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('help.signalCorrelation.bestR', 'An ordinary overlay chart only ever shows the zero-lag correlation, which misses every relationship with a delay in it. Sweeping the lag finds the shift at which the two signals line up best, and the difference between the peak and the zero-lag value is exactly the information a static chart throws away.')"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.zeroLag', 'at zero lag: {{r}}', {\r\n        r: result == null ? '—' : fmtScientificNumber(result.zeroLagR, 3),\r\n      })"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.bestLag', 'Best lag')"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.noise', 'Noise')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.noise', 'Noise')"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.threshold', 'needs |r| > {{v}}', {\r\n        v: result == null ? '—' : fmtScientificNumber(result.significanceThreshold, 3),\r\n      })"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.effectiveN', 'Effective samples')"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.rawN', 'from {{n}} raw points', {\r\n        n: result == null ? '—' : fmtInt(result.bestN),\r\n      })"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.kpis', 'Correlation metrics')"
  ],
  [
    "web/src/features/telemetry/components/statstrip-correlation/CorrelationStatStrip.tsx",
    "t('signalCorrelation.kpis', 'Correlation metrics')"
  ],
  [
    "web/src/features/telemetry/components/statstrip-signals-mqtt/signalsSummary.ts",
    "t('signalsWorkspace.historical', 'Historical')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.historical', 'Historical')"
  ],
  [
    "web/src/features/telemetry/components/statstrip-signals-mqtt/signalsSummary.ts",
    "t('signalsWorkspace.liveRate', 'Live rate')"
  ],
  [
    "web/src/features/telemetry/components/TopSignalsPanel.tsx",
    "t(\n            'liveMonitor.topSignalsList',\n            'Most active signals ranked by arrival frequency',\n          )"
  ],
  [
    "web/src/features/telemetry/pages/MQTTInspectorPage.tsx",
    "t('mqtt.metrics', 'Stream metrics')"
  ],
  [
    "web/src/features/telemetry/pages/MQTTInspectorPage.tsx",
    "t('mqtt.streamOverview', 'Stream overview')"
  ],
  [
    "web/src/features/telemetry/pages/SignalChangePointsPage.tsx",
    "t('help.signalChangePoints.count', 'A change point closes the current segment and starts a fresh one only once the cumulative statistic crosses its alarm threshold, and never before the fixed minimum segment length has elapsed.')"
  ],
  [
    "web/src/features/telemetry/pages/SignalChangePointsPage.tsx",
    "t('help.signalChangePoints.iconLabel', 'More info about signal selection')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.leadA', '{{a}} leads', { a: signalA })"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.leadB', '{{b}} leads', { b: signalB })"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.simultaneous', 'Simultaneous')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.noLead', 'No relationship')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n        'signalCorrelation.subtitle',\n        'Sweep one telemetry signal against another across time shifts to find not just whether they move together, but which one moves first',\n      )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.pick', 'Choose two signals')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('help.signalCorrelation.iconLabel', 'More info about signal selection')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.detrend', 'Correlate changes, not levels')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n                    'signalCorrelation.detrendHint',\n                    'Differencing removes shared drift, so two signals that merely both rise over the day stop looking related',\n                  )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n                      'signalCorrelation.noOverlap',\n                      'These two signals have no overlapping window of history in the last day, so there is nothing to compare.',\n                    )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n                      'signalCorrelation.pickTwo',\n                      'Choose two signals above to compute the correlogram.',\n                    )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n              'signalCorrelation.correlogramHint',\n              'Correlation at every time shift; the dashed lines are the significance threshold',\n            )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.col.lag', 'Lag (s)')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.col.r', 'r')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.col.r', 'r')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n            'signalCorrelation.overlayHint',\n            'Both signals rescaled to 0–1 so their shapes can be compared directly',\n          )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.reading', 'Reading the result')"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n                'signalCorrelation.noReading',\n                'Pick two signals to see how the result should be read.',\n              )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t('signalCorrelation.coverage', '{{filled}} filled · {{gaps}} gaps', {\n                      filled: result.seriesA.filled,\n                      gaps: result.seriesA.gaps,\n                    })"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n                        'signalCorrelation.realText',\n                        'The peak clears the threshold adjusted for autocorrelation, so this relationship is unlikely to be an artefact of the two signals simply being smooth.',\n                      )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n                        'signalCorrelation.noiseText',\n                        'The peak does not clear the autocorrelation-adjusted threshold. Smooth signals correlate with almost anything, so this is best treated as coincidence.',\n                      )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n                        'signalCorrelation.zeroLagText',\n                        'The signals line up best with no shift at all, which points to a shared cause rather than one driving the other.',\n                      )"
  ],
  [
    "web/src/features/telemetry/pages/SignalCorrelationPage.tsx",
    "t(\n                        'signalCorrelation.lagText',\n                        'The best alignment needs a {{lag}} second shift. Leading in time is not proof of causation, but a consistent lead is where causal explanations start.',\n                        { lag: Math.abs(result.bestLagS) },\n                      )"
  ],
  [
    "web/src/features/telemetry/pages/SignalEntropyPage.tsx",
    "t('help.signalEntropy.entropy', 'How surprised you should be by the next sample given everything seen so far. Normalized entropy divides by the ceiling for however many bins were actually populated, so a signal using 2 of 8 requested bins is judged against a 2-state ceiling, not an 8-state one it never approached.')"
  ],
  [
    "web/src/features/telemetry/pages/SignalEntropyPage.tsx",
    "t('help.signalEntropy.iconLabel', 'More info about signal selection')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.status.historical', 'Historical')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.ofMax', 'of {{max}} max', { max: MAX_SIGNALS })"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.liveEvents', 'Live events')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.timeSpan', 'Time span')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.timeSpan', 'Time span')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.rollingWindow', '5-min window')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.rollingWindow', '5-min window')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.days', '{{count}}d', { count: raw / 86_400 })"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.noRange', 'No range set')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpi.withStats', '{{count}} with stats', { count: statSignalCount })"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.noVehicle', 'Select a vehicle to begin')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.noVehicleDesc', 'Pick a vehicle from the picker above to explore its signals.')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.kpis', 'Exploration summary')"
  ],
  [
    "web/src/features/telemetry/pages/SignalExplorerPage.tsx",
    "t('signalExplorer.stopLive', 'Stop live')"
  ],
  [
    "web/src/features/telemetry/pages/SignalLogViewerPage.tsx",
    "t('signalLog.noVehicle', 'Select a vehicle to begin')"
  ],
  [
    "web/src/features/telemetry/pages/SignalLogViewerPage.tsx",
    "t('signalLog.noVehicleDesc', 'Pick a vehicle from the picker above to query its signal history.')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t(\n        'signalsWorkspace.subtitle',\n        'Browse the live catalog, inspect history, monitor live, or compare snapshots — all in one place.',\n      )"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.noVehicle', 'Select a vehicle to begin')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.noVehicleDesc', 'Pick a vehicle from the picker above to see its signals.')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.noVehicleDesc', 'Pick a vehicle from the picker above to see its signals.')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.kpis', 'Workspace summary')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.addSignals', 'Add signals')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.noneSelected', 'None selected')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.stopLive', 'Stop live')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.exitCompare', 'Exit compare')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.chartMode', 'Chart layout')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.chartOverlay', 'Overlay')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t('signalsWorkspace.emptyTitle', 'Pick signals and run a query')"
  ],
  [
    "web/src/features/telemetry/pages/SignalsWorkspacePage.tsx",
    "t(\n                        'signalsWorkspace.emptyDesc',\n                        'Pick signals from the catalog, choose a time range, then click run for historical data — or toggle live to stream in real time.',\n                      )"
  ],
  [
    "web/src/features/telemetry/pages/SignalTrendPage.tsx",
    "t('help.signalTrend.slope', 'Theil-Sen slope: the median of every pairwise slope between samples. A handful of outliers cannot swing this the way they can an ordinary least-squares fit.')"
  ],
  [
    "web/src/features/telemetry/pages/SignalTrendPage.tsx",
    "t('help.signalTrend.significance', 'Tie-aware Mann-Kendall tests whether the observed ordering of values is more consistent with a monotonic trend than chance — ties (repeated readings) are corrected for rather than treated as informationless.')"
  ],
  [
    "web/src/features/telemetry/pages/SignalTrendPage.tsx",
    "t('help.signalTrend.iconLabel', 'More info about signal selection')"
  ],
  [
    "web/src/features/trips/components/ArrivalPanel.tsx",
    "t('journey.arrival.empty', 'No arrival reading yet.')"
  ],
  [
    "web/src/features/trips/components/ArrivalPanel.tsx",
    "t('journey.arrival.empty', 'No arrival reading yet.')"
  ],
  [
    "web/src/features/trips/components/ArrivalPanel.tsx",
    "t('journey.arrival.loading', 'Preparing arrival…')"
  ],
  [
    "web/src/features/trips/components/ArrivalPanel.tsx",
    "t('journey.arrival.moving', 'moving')"
  ],
  [
    "web/src/features/trips/components/ArrivalPanel.tsx",
    "t('journey.arrival.shortfall', 'top up ≈ {{energy}} en route', {\n                  energy: units.formatEnergy(arrival.shortfall_wh),\n                })"
  ],
  [
    "web/src/features/trips/components/ArrivalPanel.tsx",
    "t('journey.arrival.adjusted', 'adjusted {{ratio}}× from {{count}} trips', {\n                  ratio: fmtNumber(arrival.route_factor),\n                  count: arrival.route_trips,\n                })"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.empty', 'No fixes yet. Check in to drop the first trail point.')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.empty', 'No fixes yet. Check in to drop the first trail point.')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.checkIn', 'Check in')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.checkIn', 'Check in')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.title', 'Live trip')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.title', 'Live trip')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.queued', '{{count}} queued', { count: queued })"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.loading', 'Loading live trip…')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.remaining', 'remaining')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.have', 'have')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.need', 'need')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.nextStop', 'Next stop')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.wait', '{{time}} wait', {\n                      time: units.formatDuration(view.next.wait_s),\n                    })"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.noNextStop', 'No scored stop yet')"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.lastFix', 'Last fix {{time}}', {\n              time: formatTime(view.latest.recorded_at),\n            })"
  ],
  [
    "web/src/features/trips/components/LiveTripPanel.tsx",
    "t('journey.live.fixes', '{{count}} fixes', { count: trail.length })"
  ],
  [
    "web/src/features/trips/components/NudgePanel.tsx",
    "t('journey.nudge.title', 'Leave now?')"
  ],
  [
    "web/src/features/trips/components/NudgePanel.tsx",
    "t('journey.nudge.title', 'Leave now?')"
  ],
  [
    "web/src/features/trips/components/NudgePanel.tsx",
    "t('journey.nudge.empty', 'No nudge yet.')"
  ],
  [
    "web/src/features/trips/components/NudgePanel.tsx",
    "t('journey.nudge.empty', 'No nudge yet.')"
  ],
  [
    "web/src/features/trips/components/NudgePanel.tsx",
    "t('journey.nudge.loading', 'Reading departure window…')"
  ],
  [
    "web/src/features/trips/components/NudgePanel.tsx",
    "t('journey.nudge.slot', 'calm {{time}}', {\n                  time: formatDateTime(nudge.slot_at),\n                })"
  ],
  [
    "web/src/features/trips/components/NudgePanel.tsx",
    "t('journey.nudge.blocker', 'Blocker')"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "t('journey.replan.title', 'Replan')"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "t('journey.replan.title', 'Replan')"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "t('journey.replan.rescore', 'Rescore from here')"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "t('journey.replan.empty', 'No deviation reading yet.')"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "t('journey.replan.empty', 'No deviation reading yet.')"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "t('journey.replan.loading', 'Measuring deviation…')"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "t('journey.replan.offBy', '{{distance}} off corridor', {\n                  distance: units.formatDistance(assessment.deviation.deviation_m),\n                })"
  ],
  [
    "web/src/features/trips/components/ReplanPanel.tsx",
    "t('journey.replan.scoring', 'Rescoring stops…')"
  ],
  [
    "web/src/features/trips/components/StopScorePanel.tsx",
    "t('journey.scoring.openHistory', 'Open charging history')"
  ],
  [
    "web/src/features/trips/components/TripReplayMap.tsx",
    "t('replay.map.stationaryRouteTitle', 'Route can\\'t be plotted')"
  ],
  [
    "web/src/features/trips/components/TripReplayMap.tsx",
    "t(\n                  'replay.map.stationaryRouteBody',\n                  'Only one GPS coordinate was recorded for this drive, so the route can\\'t be drawn. The trip statistics, speed, and elevation timeline above the scrubber are unaffected.',\n                )"
  ],
  [
    "web/src/features/vehicles/components/BatteryComparison.tsx",
    "t('fleet.noBatteryData', 'No battery data available for the current fleet.')"
  ],
  [
    "web/src/features/vehicles/components/SilenceBanner.tsx",
    "t('vehicles.silence.never', 'No telemetry yet')"
  ],
  [
    "web/src/features/vehicles/components/SilenceBanner.tsx",
    "t('vehicles.silence.silent', 'Vehicle silent')"
  ],
  [
    "web/src/features/vehicles/components/SilenceBanner.tsx",
    "t('vehicles.silence.quiet', 'Vehicle quiet')"
  ],
  [
    "web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx",
    "t('telemetry.fullInHours', 'Full in {{hours}}h', {\n                  hours: fmtNumber(state.time_to_full_charge),\n                })"
  ],
  [
    "web/src/features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx",
    "t('telemetry.gpsAccuracy', 'GPS accuracy')"
  ],
  [
    "web/src/features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx",
    "t('telemetry.maxSpeedToDestination', 'Max speed to destination')"
  ],
  [
    "web/src/features/vehicles/components/vehicle-access/AccessOverviewPanel.tsx",
    "t('vehicleAccess.overview.title', 'Access overview')"
  ],
  [
    "web/src/features/vehicles/components/vehicle-access/AccessOverviewPanel.tsx",
    "t('vehicleAccess.overview.empty', 'No access data to summarize yet.')"
  ],
  [
    "web/src/features/vehicles/components/vehicle-access/AccessOverviewPanel.tsx",
    "t('vehicleAccess.overview.invitationStatus', 'Invitation status')"
  ],
  [
    "web/src/features/vehicles/components/vehicle-access/AccessOverviewPanel.tsx",
    "t('vehicleAccess.overview.noInvitations', 'No invitations yet')"
  ],
  [
    "web/src/features/vehicles/components/vehicle-access/AccessOverviewPanel.tsx",
    "t('vehicleAccess.overview.driverRoles', 'Driver roles')"
  ],
  [
    "web/src/features/vehicles/components/vehicle-access/AccessOverviewPanel.tsx",
    "t('vehicleAccess.overview.noDrivers', 'No drivers yet')"
  ],
  [
    "web/src/features/vehicles/components/VehicleCard.tsx",
    "t('card.stateLoading', 'Loading live state…')"
  ],
  [
    "web/src/features/vehicles/components/VehicleCard.tsx",
    "t('card.stateEmpty', 'No live telemetry yet')"
  ],
  [
    "web/src/features/vehicles/components/VehicleCard.tsx",
    "t('card.viewDetailsFor', 'View details for {{name}}', { name: vehicleLabel })"
  ],
  [
    "web/src/features/vehicles/components/VehicleHeader.tsx",
    "t('vehicles.detail.detailsUnavailable', 'Vehicle details unavailable')"
  ],
  [
    "web/src/features/vehicles/components/VehiclePhotoGallery.tsx",
    "t(\n                      'vehicles.photos.openAtNamed',\n                      'Open photo {{index}} of {{total}} — {{name}}',\n                      { index: i + 1, total: photos.length, name: vehicleName },\n                    )"
  ],
  [
    "web/src/features/vehicles/components/VehiclePhotoUpload.tsx",
    "t('vehicles.photos.loading', 'Loading vehicle photo…')"
  ],
  [
    "web/src/hooks/useA11ySummary.ts",
    "t('a11y.summary.route.empty', 'Route map. No location data recorded.')"
  ],
  [
    "web/src/hooks/useA11ySummary.ts",
    "t('a11y.summary.route.generic', 'Route map')"
  ],
  [
    "web/src/hooks/useA11ySummary.ts",
    "t('a11y.summary.route.points', '{{count}} recorded points', { count: pointCount })"
  ],
  [
    "web/src/hooks/useA11ySummary.ts",
    "t('a11y.summary.state.since', 'For {{duration}}', { duration: since })"
  ],
  [
    "web/src/hooks/useA11ySummary.ts",
    "t('a11y.summary.state.previous', 'Previously {{state}}', { state: previous })"
  ],
  [
    "web/src/hooks/useA11ySummary.ts",
    "t('a11y.summary.state.next', 'Can move to {{states}}', {\n              states: next.join(', '),\n            })"
  ],
  [
    "web/src/hooks/useNotificationListener.ts",
    "t('browserNotifications.toast.alertTitle', 'TeslaSync Alert')"
  ],
  [
    "web/src/hooks/useNotificationListener.ts",
    "t('browserNotifications.toast.exportReadyTitle', 'Export Ready')"
  ],
  [
    "web/src/hooks/useNotificationListener.ts",
    "t('browserNotifications.toast.exportReadyBody', '{{filename}} is ready for download', {\n                filename: data.filename,\n              })"
  ],
  [
    "web/src/hooks/useNotificationListener.ts",
    "t('browserNotifications.toast.exportReadyBodyGeneric', 'Your data export is ready for download')"
  ],
  [
    "web/src/hooks/useNotificationListener.ts",
    "t('browserNotifications.toast.exportFailedTitle', 'Export Failed')"
  ],
  [
    "web/src/hooks/useNotificationListener.ts",
    "t('browserNotifications.toast.exportFailedBody', 'Data export failed. Check the exports page for details.')"
  ],
  [
    "web/src/hooks/useStatusAnnouncer.ts",
    "t('a11y.status.selectionCleared', 'Selection cleared')"
  ],
  [
    "web/src/hooks/useStatusAnnouncer.ts",
    "t('a11y.status.sortAsc', 'Sorted by {{column}}, ascending', {\n              column: columnLabel,\n            })"
  ],
  [
    "web/src/hooks/useStatusAnnouncer.ts",
    "t('a11y.status.sortDesc', 'Sorted by {{column}}, descending', {\n              column: columnLabel,\n            })"
  ],
  [
    "web/src/hooks/useStatusAnnouncer.ts",
    "t('a11y.status.streamScope', 'Live data')"
  ]
]
// Accepted Phase-4 extensions, not new canonical-recovery ownership:
// phase4-sticky-control-localization, phase4-watch-key-capability, and
// phase4-signal-catalog-canonical-repair (905d36679d). Subtract only these
// physical paths, after asserting their exact values, to recover the unchanged
// 29075-leaf predecessor and its original digest.
const acceptedInterveningAdditions: readonly (readonly [string, string])[] = [
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
]
const generated = import.meta.glob<{ default: Json }>('./en/locale-*.json', { eager: true })
function nested(value: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((v, segment) =>
    v && typeof v === 'object' ? (v as Json)[segment] : undefined, value)
}
function physical(value: unknown, path: string[] = []): [string[], unknown][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [[path, value]]
  return Object.entries(value).flatMap(([key, child]) => physical(child, [...path, key]))
}
const callPrinter = ts.createPrinter({ removeComments: true })
function callSignature(text: string): string {
  const tree = ts.createSourceFile('call.tsx', text, ts.ScriptTarget.Latest, true)
  const statement = tree.statements[0]
  if (!statement || !ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    throw new Error('Expected a complete production call fixture')
  }
  return callPrinter.printNode(ts.EmitHint.Expression, statement.expression, tree)
}
function acceptedCurrentCall(file: string, text: string): string {
  // Only the three already-approved scalar-ancestor repairs. Do not reverse
  // entire producer files or mask later presentation/capability changes.
  const renames = [
    ['web/src/features/sharing/pages/SharedSessionReport.tsx', 'share.curve.aria', 'share.curveAria'],
    ['web/src/features/telemetry/components/SignalLogBreakdownPanel.tsx', 'signalLog.composition.noRecords', 'signalLog.compositionNoRecords'],
    ['web/src/features/telemetry/components/SignalLogBreakdownPanel.tsx', 'signalLog.composition.empty', 'signalLog.compositionEmpty'],
  ] as const
  const tree = ts.createSourceFile('call.tsx', text, ts.ScriptTarget.Latest, true)
  const statement = tree.statements[0]
  if (!statement || !ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    throw new Error('Expected a complete production call fixture')
  }
  const key = statement.expression.arguments[0]
  if (!key || !ts.isStringLiteral(key)) throw new Error('Expected a literal production translation key')
  const rename = renames.find(([path, original]) => path === file && original === key.text)
  return callSignature(rename
    ? text.slice(0, key.getStart(tree) + 1) + rename[2] + text.slice(key.getEnd() - 1)
    : text)
}
function bindsTranslator(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return name.text === 't'
  return ts.isObjectBindingPattern(name) && name.elements.some(element =>
    ts.isIdentifier(element.name) && element.name.text === 't'
    && (!element.propertyName || element.propertyName.getText() === 't'))
}
function assertTranslatorOrigin(call: ts.CallExpression, tree: ts.SourceFile, file: string): void {
  for (let scope: ts.Node | undefined = call.parent; scope; scope = scope.parent) {
    if (ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope)
      || ts.isArrowFunction(scope) || ts.isMethodDeclaration(scope)) {
      const parameter = scope.parameters.find(candidate => bindsTranslator(candidate.name))
      if (parameter) {
        expect(parameter.type?.getText(tree), file + ': typed incoming translator').toBeTruthy()
        return
      }
    }
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue
      const binding = statement.declarationList.declarations.find(candidate => bindsTranslator(candidate.name))
      if (!binding) continue
      const origin = binding.initializer
      if (origin && ts.isCallExpression(origin) && ts.isIdentifier(origin.expression)
        && origin.expression.text === 'useTranslation') {
        const imported = tree.statements.some(candidate => ts.isImportDeclaration(candidate)
          && ts.isStringLiteral(candidate.moduleSpecifier) && candidate.moduleSpecifier.text === 'react-i18next'
          && candidate.importClause?.namedBindings && ts.isNamedImports(candidate.importClause.namedBindings)
          && candidate.importClause.namedBindings.elements.some(element =>
            element.name.text === 'useTranslation'
            && (!element.propertyName || element.propertyName.text === 'useTranslation')))
        expect(imported, file + ': installed react-i18next origin').toBe(true)
        expect(origin.arguments.length, file + ': no changed translator options').toBeLessThanOrEqual(1)
        const namespace = origin.arguments[0]
        if (namespace) {
          expect(ts.isStringLiteral(namespace), file + ': literal namespace').toBe(true)
          if (!ts.isStringLiteral(namespace)) throw new Error('Expected literal translator namespace')
          expect(['charging', 'dashboard', 'settings', 'vehicles'], file + ': accepted namespace')
            .toContain(namespace.text)
          expect(file, file + ': feature namespace origin').toContain(`/features/${namespace.text}/`)
        }
        return
      }
      // Existing typed controller/model/input seams forward t; do not replace
      // them with a translator invented by this preservation test.
      expect(origin && ts.isIdentifier(origin) ? origin.text : undefined, file + ': forwarded translator')
        .toBeOneOf(['controller', 'model', 'input'])
      return
    }
  }
  throw new Error(`Unbound production translator: ${file}: ${call.getText(tree)}`)
}
describe('authorized exact canonical catalog recovery attempt3', () => {
  it('resolves all 1921 static pairs through installed i18next and normal generated resources', async () => {
    expect(authorizedCanonicalAdditions).toHaveLength(1921)
    expect(createHash('sha256').update(JSON.stringify(authorizedCanonicalAdditions)).digest('hex')).toBe('5d1f0a21567e6deed09a957890554ba37f67f7b65ef324cb447449de50e5e660')
    const english = createInstance()
    await english.init({ lng: 'en', fallbackLng: 'en', fallbackNS: 'translation',
      resources: { en: { translation: catalog } }, interpolation: { escapeValue: false } })
    const resources = [shell, ...Object.values(generated).map(module => module.default)]
    for (const [key, value] of authorizedCanonicalAdditions) {
      expect(nested(catalog, key), key).toBe(value)
      expect(english.exists(key), key).toBe(true)
      expect(english.t(key, { skipInterpolation: true }), key).toBe(value)
      expect(resources.some(resource => nested(resource, key) === value), key).toBe(true)
    }
    expect(english.t('watch.command.error', { message: 'offline' })).toBe('Watch command failed: offline')
  })
  it('preserves the reviewed physical catalog structure and approved scalar values', () => {
    for (const [key, value] of authorizedCanonicalAdditions) expect(nested(catalog, key), key).toBe(value)
    for (const [key, value] of ownerRecoveryAdditions) expect(nested(catalog, key), key).toBe(value)
    for (const [key, value] of finalFourAdditions) expect(nested(catalog, key), key).toBe(value)
    const entries = physical(catalog)
    expect(acceptedInterveningAdditions).toHaveLength(12)
    for (const [key, value] of acceptedInterveningAdditions) {
      const parts = key.split('.')
      expect(entries.filter(([path]) => JSON.stringify(path) === JSON.stringify(parts)), key)
        .toEqual([[parts, value]])
    }
    const exactAdded = new Set([
      ...authorizedCanonicalAdditions, ...ownerRecoveryAdditions,
      ...finalFourAdditions, ...acceptedInterveningAdditions,
    ].map(([key]) => JSON.stringify(key.split('.'))))
    const predecessor = entries.filter(([path]) => !exactAdded.has(JSON.stringify(path)))
    expect(predecessor).toHaveLength(30536)
    expect(createHash('sha256').update(JSON.stringify(predecessor)).digest('hex')).toBe("9c251c96fe810fac230c1d7d005e51b4ccd1bbda3227f8930c69dbceee0c1f31")
    expect(entries).toHaveLength(32568)
    expect(preservedResolutions).toHaveLength(28)
    for (const [key, value] of preservedResolutions) expect(nested(catalog, key), key).toBe(value)
    expect(catalog.settings.title).toBe('Settings')
    expect(catalog.share.curve).toBe('Charge curve')
    expect(catalog.signalLog.composition).toBe('Value composition')
    expect(catalog.drives.emptyForCollection.title).toBe('No drives in this view')
    expect(catalog.systemStatus.incidents.updateCount_other).toBe('{{count}} updates')
    expect(baseline).toEqual([])
  })
  it('retains actual source calls, defaults, options, translator origins and full producer bytes', () => {
    // Keep the complete original byte-provenance and call fixtures immutable.
    // Accepted Phases 3/4 changed presentation, source trust and capabilities
    // (not these calls); freezing all current producer bytes to attempt3 would
    // require reverting accepted source. Compare the exact translation AST,
    // including duplicate calls, defaults, arity and option expressions instead.
    expect(producerHashes).toHaveLength(483)
    expect(createHash('sha256').update(JSON.stringify(producerHashes)).digest('hex'))
      .toBe('10c1a861b9acc377609253127285c755562ba437fd0f97b7b60e2b5ef53deba1')
    expect(producerCalls).toHaveLength(2282)
    expect(createHash('sha256').update(JSON.stringify(producerCalls)).digest('hex'))
      .toBe('1b5898ff8dd6c30a224607648e5bfc357395a2441e0ac6c66b116506892369e8')
    const calls = new Map<string, { tree: ts.SourceFile; found: Map<string, ts.CallExpression[]> }>()
    for (const [file] of producerHashes) {
      const bytes = readFileSync(resolve(process.cwd(), '..', file), 'utf8')
      const tree = ts.createSourceFile(file, bytes, ts.ScriptTarget.Latest, true)
      const found = new Map<string, ts.CallExpression[]>()
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
          const signature = callSignature(node.getText(tree))
          found.set(signature, [...(found.get(signature) ?? []), node])
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
      calls.set(file, { tree, found })
    }
    const expected = new Map<string, Map<string, number>>()
    for (const [file, actualCall] of producerCalls) {
      const signature = acceptedCurrentCall(file, actualCall)
      const fileCalls = expected.get(file) ?? new Map<string, number>()
      fileCalls.set(signature, (fileCalls.get(signature) ?? 0) + 1)
      expected.set(file, fileCalls)
    }
    for (const [file, fileCalls] of expected) {
      const actual = calls.get(file)
      if (!actual) throw new Error(`Missing frozen producer: ${file}`)
      for (const [signature, count] of fileCalls) {
        const matching = actual.found.get(signature) ?? []
        expect(matching, file + ': ' + signature).toHaveLength(count)
        for (const call of matching) assertTranslatorOrigin(call, actual.tree, file)
      }
    }
    const migrated = readFileSync(resolve(process.cwd(), 'src/features/driving/components/drives-orchestrator/DrivesEvidenceEmpty.tsx'), 'utf8')
    expect(migrated).not.toContain("t('drives.emptyForCollection', 'No drives in this view')")
    expect(migrated).toContain("t('drives.emptyForCollection.title', 'No drives in this view')")
  })
  it('closes three original approved scalar-ancestor repairs at explicit feature-owned siblings', () => {
    for (const key of ['share.curve.aria', 'signalLog.composition.noRecords', 'signalLog.composition.empty']) {
      expect(nested(catalog, key), key).toBeUndefined()
      expect(authorizedCanonicalAdditions.some(([added]) => added === key)).toBe(false)
    }
    expect(1921 + preservedResolutions.length + 1 + 3).toBe(1953)
    for (const [key, value] of [
      ['share.curveAria', 'Shared session power and battery chart by minute'],
      ['signalLog.compositionNoRecords', 'No records in the selected range.'],
      ['signalLog.compositionEmpty', 'Run a query to see the value-type breakdown.'],
    ]) expect(nested(catalog, key), key).toBe(value)
  })
})
