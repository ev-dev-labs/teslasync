package io.teslasync.android.navigation

/** Full app chrome (nav + top bar) vs a standalone/public full-screen surface. */
enum class Chrome { Full, Standalone }

/** Whether reaching a destination requires an authenticated session (A4 wires the gate). */
enum class AuthRequirement { Required, Public }

/**
 * One canonical destination in the navigation graph, mirroring a `web/src/App.tsx` page.
 *
 * Pure data (no Android/Compose types) so the whole route table is covered by JVM unit tests;
 * titles and icons are resolved at the Compose boundary (NavStrings / NavIcons).
 */
data class Destination(
    val id: String,
    val webPath: String,
    val group: NavGroup,
    val chrome: Chrome = Chrome.Full,
    val auth: AuthRequirement = AuthRequirement.Required,
    val args: List<String> = emptyList(),
    val showInNav: Boolean = true,
) {
    /** Navigation-Compose route pattern (no leading slash; `{arg}` argument slots). */
    val route: String
        get() {
            if (webPath == "/") return "dashboard"
            var pattern = webPath.removePrefix("/")
            for (arg in args) {
                pattern = pattern.replace(":" + arg, "{" + arg + "}")
            }
            return pattern
        }

    /** True when the route carries path arguments (e.g. `vehicles/{id}`). */
    val isParameterized: Boolean get() = args.isNotEmpty()
}

/**
 * The canonical destination registry — every web route recorded as metadata (P3/A3). A7 page
 * prompts attach real host content per id via [PageHosts]; this file never renders UI, so
 * not-yet-built pages stay metadata-only and resolve to the shared not-found screen rather than
 * any fabricated stand-in. Generated from `web/src/App.tsx` (see the gen-nav generator).
 */
object Destinations {
    val all: List<Destination> =
        listOf(
            page("dashboard", "/", NavGroup.Dashboard),
            standalone("quickStats", "/quick-stats", NavGroup.Dashboard),
            standalone("glance", "/glance", NavGroup.Dashboard),
            page("explore", "/explore", NavGroup.Dashboard),
            page("vehicles", "/vehicles", NavGroup.Vehicles),
            hidden("vehicleDetail", "/vehicles/:id", NavGroup.Vehicles, listOf("id")),
            hidden("vehicleAccess", "/vehicles/:id/access", NavGroup.Vehicles, listOf("id")),
            page("digitalTwin", "/digital-twin", NavGroup.Vehicles),
            page("charging", "/charging", NavGroup.Charging),
            hidden("chargeDetail", "/charging/:id", NavGroup.Charging, listOf("id")),
            page("chargingCurve", "/charging-curve", NavGroup.Charging),
            page("chargingHeatmap", "/charging-heatmap", NavGroup.Charging),
            page("costAnalysis", "/cost-analysis", NavGroup.Charging),
            page("teslaChargingHistory", "/tesla-charging-history", NavGroup.Charging),
            page("teslaChargingSessions", "/tesla-charging-sessions", NavGroup.Charging),
            page("smartCharge", "/smart-charge", NavGroup.Charging),
            page("powershare", "/powershare", NavGroup.Charging),
            page("trips", "/trips", NavGroup.TripsDrives),
            hidden("tripDetail", "/trips/:id", NavGroup.TripsDrives, listOf("id")),
            page("drives", "/drives", NavGroup.TripsDrives),
            hidden("driveDetail", "/drives/:id", NavGroup.TripsDrives, listOf("id")),
            hidden("tripReplay", "/drives/:id/replay", NavGroup.TripsDrives, listOf("id")),
            page("driveScore", "/drive-score", NavGroup.TripsDrives),
            page("drivingDynamics", "/driving-dynamics", NavGroup.TripsDrives),
            page("drivetrainHealth", "/drivetrain-health", NavGroup.TripsDrives),
            page("efficiency", "/efficiency", NavGroup.TripsDrives),
            page("speedProfile", "/speed-profile", NavGroup.TripsDrives),
            page("regenEfficiency", "/regen-efficiency", NavGroup.TripsDrives),
            page("routeEfficiency", "/route-efficiency", NavGroup.TripsDrives),
            page("tripPlanner", "/trip-planner", NavGroup.TripsDrives),
            page("energy", "/energy", NavGroup.BatteryEnergy),
            page("batteryHealth", "/battery", NavGroup.BatteryEnergy),
            page("batteryCells", "/battery-cells", NavGroup.BatteryEnergy),
            page("batteryDegradation", "/battery-degradation", NavGroup.BatteryEnergy),
            page("energyFlow", "/energy-flow", NavGroup.BatteryEnergy),
            page("powerFlow", "/power-flow", NavGroup.BatteryEnergy),
            page("energyProducts", "/energy-products", NavGroup.BatteryEnergy),
            page("vampireDrain", "/vampire-drain", NavGroup.BatteryEnergy),
            page("projectedRange", "/projected-range", NavGroup.BatteryEnergy),
            page("sleepEfficiency", "/sleep-efficiency", NavGroup.BatteryEnergy),
            page("analytics", "/analytics", NavGroup.Analytics),
            page("statistics", "/statistics", NavGroup.Analytics),
            page("periodCompare", "/period-compare", NavGroup.Analytics),
            page("mileage", "/mileage", NavGroup.Analytics),
            page("trueCost", "/tco", NavGroup.Analytics),
            page("weeklyDigest", "/weekly-digest", NavGroup.Analytics),
            page("timeline", "/timeline", NavGroup.Analytics),
            page("fleetCompare", "/vehicle-comparison", NavGroup.Analytics),
            page("lifetimeStats", "/lifetime-stats", NavGroup.Analytics),
            standalone("yearReview", "/year-review/:year", NavGroup.Analytics, listOf("year")),
            page("liveMap", "/live", NavGroup.Maps),
            page("locations", "/locations", NavGroup.Maps),
            page("geofences", "/geofences", NavGroup.Maps),
            page("navigationRoute", "/navigation", NavGroup.Maps),
            page("temperatureImpact", "/temperature-impact", NavGroup.Maps),
            page("climateControl", "/climate-control", NavGroup.VehicleSystems),
            page("tirePressure", "/tire-pressure", NavGroup.VehicleSystems),
            page("maintenance", "/maintenance", NavGroup.VehicleSystems),
            page("softwareUpdates", "/software-updates", NavGroup.VehicleSystems),
            page("safetySettings", "/safety-settings", NavGroup.VehicleSystems),
            page("guardMode", "/guard-mode", NavGroup.VehicleSystems),
            page("mediaPlayer", "/media-player", NavGroup.VehicleSystems),
            page("automations", "/automations", NavGroup.Automations),
            page("automationList", "/automations/list", NavGroup.Automations),
            hidden("automationBuilder", "/automations/new", NavGroup.Automations),
            page("notificationsInbox", "/notifications/inbox", NavGroup.Notifications),
            page("notificationsArchived", "/notifications/archived", NavGroup.Notifications),
            page("notificationsAlerts", "/notifications/alerts", NavGroup.Notifications),
            page("notificationsChannels", "/notifications/channels", NavGroup.Notifications),
            page("notificationsWebhooks", "/notifications/webhooks", NavGroup.Notifications),
            page("notificationsBrowser", "/notifications/browser", NavGroup.Notifications),
            page("notificationsQuietHours", "/notifications/quiet-hours", NavGroup.Notifications),
            page("notificationsRules", "/notifications/rules", NavGroup.Notifications),
            page("notificationsStudio", "/notifications/studio", NavGroup.Notifications),
            page("notificationsAudit", "/notifications/audit", NavGroup.Notifications),
            page("signalsWorkspace", "/signals", NavGroup.Telemetry),
            page("signalExplorer", "/signal-explorer", NavGroup.Telemetry),
            page("signalLog", "/signal-log", NavGroup.Telemetry),
            page("liveSignalMonitor", "/live-monitor", NavGroup.Telemetry),
            page("signalDiff", "/signal-diff", NavGroup.Telemetry),
            page("signalGaps", "/signal-gaps", NavGroup.Telemetry),
            page("mqttInspector", "/mqtt-inspector", NavGroup.Telemetry),
            page("anomalyDetection", "/anomaly-detection", NavGroup.Diagnostics),
            page("devTools", "/dev-tools", NavGroup.Admin),
            page("apiKeys", "/api-keys", NavGroup.Admin),
            page("apiLogs", "/api-logs", NavGroup.Admin),
            page("fleetApi", "/fleet-api", NavGroup.Admin),
            page("teslaFeatures", "/tesla-features", NavGroup.Admin),
            page("teslaRegion", "/tesla-region", NavGroup.Admin),
            page("teslaOrders", "/tesla-orders", NavGroup.Admin),
            page("gasPrice", "/gas-price", NavGroup.Admin),
            page("securityAccess", "/security-access", NavGroup.Admin),
            page("backup", "/backup", NavGroup.Admin),
            page("apiPlayground", "/api-playground", NavGroup.Admin),
            page("redisSignals", "/redis-signals", NavGroup.Admin),
            page("adminFeedback", "/admin/feedback", NavGroup.Admin),
            page("adminTelemetryCoverage", "/admin/telemetry/coverage", NavGroup.Admin),
            page("adminDlq", "/admin/dlq", NavGroup.Admin),
            page("adminFlags", "/admin/flags", NavGroup.Admin),
            page("adminIngestXray", "/admin/ingest-xray", NavGroup.Admin),
            page("adminLiveSignals", "/admin/live-signals", NavGroup.Admin),
            page("adminSchemaDrift", "/admin/schema-drift", NavGroup.Admin),
            page("adminSlowQueries", "/admin/slow-queries", NavGroup.Admin),
            page("adminVehicleCost", "/admin/vehicle-cost", NavGroup.Admin),
            page("adminDiskForecast", "/admin/disk-forecast", NavGroup.Admin),
            page("adminSecretRotation", "/admin/secret-rotation", NavGroup.Admin),
            page("adminAuditLog", "/admin/audit-log", NavGroup.Admin),
            page("adminGdprExports", "/admin/gdpr-exports", NavGroup.Admin),
            page("powerSql", "/power/sql", NavGroup.PowerUser),
            page("powerGrafana", "/power/grafana", NavGroup.PowerUser),
            page("powerDashboards", "/power/dashboards", NavGroup.PowerUser),
            page("systemStatus", "/system-status", NavGroup.System),
            hidden("incidentTimeline", "/system-status/incidents/:id", NavGroup.System, listOf("id")),
            page("statusApiDocs", "/docs/status-api", NavGroup.System),
            page("dataExport", "/data-export", NavGroup.System),
            page("exports", "/exports", NavGroup.System),
            page("dataRepair", "/data-repair", NavGroup.System),
            page("dbHealth", "/db-health", NavGroup.System),
            page("stateDebugger", "/state-debugger", NavGroup.System),
            page("commands", "/commands", NavGroup.System),
            page("commandHistory", "/command-history", NavGroup.System),
            page("chatbot", "/chatbot", NavGroup.System),
            page("roadmap", "/roadmap", NavGroup.System),
            page("teslaAccount", "/tesla-account", NavGroup.System),
            page("myActivity", "/me/activity", NavGroup.System),
            page("settings", "/settings", NavGroup.Settings),
            page("settingsSafety", "/settings/safety", NavGroup.Settings),
            page("account2fa", "/account/2fa", NavGroup.Settings),
            page("accountSessions", "/account/sessions", NavGroup.Settings),
            page("accountPrivacy", "/account/privacy", NavGroup.Settings),
            page("integrationsHelix", "/integrations/helix", NavGroup.Settings),
            standalone("onboarding", "/onboarding", NavGroup.Onboarding, auth = AuthRequirement.Public),
            page("search", "/search", NavGroup.Search),
            standalone("sharedDrive", "/s/:token", NavGroup.Sharing, listOf("token"), AuthRequirement.Public),
            page("sharingTrips", "/sharing/trips", NavGroup.Sharing),
            standalone("watchFace", "/watch", NavGroup.Watch, auth = AuthRequirement.Public),
            hidden("notFound", "/not-found", NavGroup.NotFound),
        )

    val byId: Map<String, Destination> = all.associateBy(Destination::id)

    /** Lookup by stable id, or null when unknown. */
    fun find(id: String): Destination? = byId[id]

    /** Lookup by stable id; throws when the id is not a known destination. */
    fun require(id: String): Destination = byId.getValue(id)
}

private fun page(
    id: String,
    webPath: String,
    group: NavGroup,
): Destination = Destination(id, webPath, group)

private fun hidden(
    id: String,
    webPath: String,
    group: NavGroup,
    args: List<String> = emptyList(),
): Destination = Destination(id, webPath, group, args = args, showInNav = false)

private fun standalone(
    id: String,
    webPath: String,
    group: NavGroup,
    args: List<String> = emptyList(),
    auth: AuthRequirement = AuthRequirement.Required,
): Destination = Destination(id, webPath, group, Chrome.Standalone, auth, args, showInNav = false)
