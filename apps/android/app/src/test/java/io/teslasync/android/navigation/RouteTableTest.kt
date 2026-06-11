package io.teslasync.android.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [RouteTable]. The [canonicalPaths] / [aliasPaths] tables enumerate every
 * route + alias from `web/src/App.tsx`; the resolution tests therefore prove the navigation graph
 * covers the whole web taxonomy and that aliases land on the right canonical destination. The
 * remaining tests cover deep-link derivation, argument extraction, normalization, unknown-route
 * fallback, and the curated bar/rail/drawer navigation sets.
 */
class RouteTableTest {
    private val canonicalPaths: Map<String, String> =
        linkedMapOf(
            "/" to "dashboard",
            "/quick-stats" to "quickStats",
            "/glance" to "glance",
            "/explore" to "explore",
            "/vehicles" to "vehicles",
            "/vehicles/:id" to "vehicleDetail",
            "/vehicles/:id/access" to "vehicleAccess",
            "/digital-twin" to "digitalTwin",
            "/charging" to "charging",
            "/charging/:id" to "chargeDetail",
            "/charging-curve" to "chargingCurve",
            "/charging-heatmap" to "chargingHeatmap",
            "/cost-analysis" to "costAnalysis",
            "/tesla-charging-history" to "teslaChargingHistory",
            "/tesla-charging-sessions" to "teslaChargingSessions",
            "/smart-charge" to "smartCharge",
            "/powershare" to "powershare",
            "/trips" to "trips",
            "/trips/:id" to "tripDetail",
            "/drives" to "drives",
            "/drives/:id" to "driveDetail",
            "/drives/:id/replay" to "tripReplay",
            "/drive-score" to "driveScore",
            "/driving-dynamics" to "drivingDynamics",
            "/drivetrain-health" to "drivetrainHealth",
            "/efficiency" to "efficiency",
            "/speed-profile" to "speedProfile",
            "/regen-efficiency" to "regenEfficiency",
            "/route-efficiency" to "routeEfficiency",
            "/trip-planner" to "tripPlanner",
            "/energy" to "energy",
            "/battery" to "batteryHealth",
            "/battery-cells" to "batteryCells",
            "/battery-degradation" to "batteryDegradation",
            "/energy-flow" to "energyFlow",
            "/power-flow" to "powerFlow",
            "/energy-products" to "energyProducts",
            "/vampire-drain" to "vampireDrain",
            "/projected-range" to "projectedRange",
            "/sleep-efficiency" to "sleepEfficiency",
            "/analytics" to "analytics",
            "/statistics" to "statistics",
            "/period-compare" to "periodCompare",
            "/mileage" to "mileage",
            "/tco" to "trueCost",
            "/weekly-digest" to "weeklyDigest",
            "/timeline" to "timeline",
            "/vehicle-comparison" to "fleetCompare",
            "/lifetime-stats" to "lifetimeStats",
            "/year-review/:year" to "yearReview",
            "/live" to "liveMap",
            "/locations" to "locations",
            "/geofences" to "geofences",
            "/navigation" to "navigationRoute",
            "/temperature-impact" to "temperatureImpact",
            "/climate-control" to "climateControl",
            "/tire-pressure" to "tirePressure",
            "/maintenance" to "maintenance",
            "/software-updates" to "softwareUpdates",
            "/safety-settings" to "safetySettings",
            "/guard-mode" to "guardMode",
            "/media-player" to "mediaPlayer",
            "/automations" to "automations",
            "/automations/list" to "automationList",
            "/automations/new" to "automationBuilder",
            "/notifications/inbox" to "notificationsInbox",
            "/notifications/archived" to "notificationsArchived",
            "/notifications/alerts" to "notificationsAlerts",
            "/notifications/channels" to "notificationsChannels",
            "/notifications/webhooks" to "notificationsWebhooks",
            "/notifications/browser" to "notificationsBrowser",
            "/notifications/quiet-hours" to "notificationsQuietHours",
            "/notifications/rules" to "notificationsRules",
            "/notifications/studio" to "notificationsStudio",
            "/notifications/audit" to "notificationsAudit",
            "/signals" to "signalsWorkspace",
            "/signal-explorer" to "signalExplorer",
            "/signal-log" to "signalLog",
            "/live-monitor" to "liveSignalMonitor",
            "/signal-diff" to "signalDiff",
            "/signal-gaps" to "signalGaps",
            "/mqtt-inspector" to "mqttInspector",
            "/anomaly-detection" to "anomalyDetection",
            "/dev-tools" to "devTools",
            "/api-keys" to "apiKeys",
            "/api-logs" to "apiLogs",
            "/fleet-api" to "fleetApi",
            "/tesla-features" to "teslaFeatures",
            "/tesla-region" to "teslaRegion",
            "/tesla-orders" to "teslaOrders",
            "/gas-price" to "gasPrice",
            "/security-access" to "securityAccess",
            "/backup" to "backup",
            "/api-playground" to "apiPlayground",
            "/redis-signals" to "redisSignals",
            "/admin/feedback" to "adminFeedback",
            "/admin/telemetry/coverage" to "adminTelemetryCoverage",
            "/admin/dlq" to "adminDlq",
            "/admin/flags" to "adminFlags",
            "/admin/ingest-xray" to "adminIngestXray",
            "/admin/live-signals" to "adminLiveSignals",
            "/admin/schema-drift" to "adminSchemaDrift",
            "/admin/slow-queries" to "adminSlowQueries",
            "/admin/vehicle-cost" to "adminVehicleCost",
            "/admin/disk-forecast" to "adminDiskForecast",
            "/admin/secret-rotation" to "adminSecretRotation",
            "/admin/audit-log" to "adminAuditLog",
            "/admin/gdpr-exports" to "adminGdprExports",
            "/power/sql" to "powerSql",
            "/power/grafana" to "powerGrafana",
            "/power/dashboards" to "powerDashboards",
            "/system-status" to "systemStatus",
            "/system-status/incidents/:id" to "incidentTimeline",
            "/docs/status-api" to "statusApiDocs",
            "/data-export" to "dataExport",
            "/exports" to "exports",
            "/data-repair" to "dataRepair",
            "/db-health" to "dbHealth",
            "/state-debugger" to "stateDebugger",
            "/commands" to "commands",
            "/command-history" to "commandHistory",
            "/chatbot" to "chatbot",
            "/roadmap" to "roadmap",
            "/tesla-account" to "teslaAccount",
            "/me/activity" to "myActivity",
            "/settings" to "settings",
            "/settings/safety" to "settingsSafety",
            "/account/2fa" to "account2fa",
            "/account/sessions" to "accountSessions",
            "/account/privacy" to "accountPrivacy",
            "/integrations/helix" to "integrationsHelix",
            "/onboarding" to "onboarding",
            "/search" to "search",
            "/s/:token" to "sharedDrive",
            "/sharing/trips" to "sharingTrips",
            "/watch" to "watchFace",
            "/not-found" to "notFound",
        )

    private val aliasPaths: Map<String, String> =
        linkedMapOf(
            "/battery/health" to "batteryHealth",
            "/charging/curves" to "chargingCurve",
            "/charging/costs" to "costAnalysis",
            "/charging/schedule" to "smartCharge",
            "/charging/vampire-drain" to "vampireDrain",
            "/climate" to "climateControl",
            "/vehicle-systems/software" to "softwareUpdates",
            "/analytics/range" to "projectedRange",
            "/analytics/anomalies" to "anomalyDetection",
            "/analytics/tco" to "trueCost",
            "/compare" to "periodCompare",
            "/analytics/compare" to "periodCompare",
            "/analytics/lifetime" to "lifetimeStats",
            "/admin" to "systemStatus",
            "/alerts" to "notificationsAlerts",
            "/alert-studio" to "notificationsStudio",
            "/alert-rules" to "notificationsRules",
            "/notifications" to "notificationsInbox",
        )

    @Test
    fun everyCanonicalWebPathResolvesToItsDestination() {
        canonicalPaths.forEach { (path, id) ->
            assertEquals("path $path", id, RouteTable.resolve(path).id)
        }
    }

    @Test
    fun everyAliasResolvesToItsCanonicalDestination() {
        aliasPaths.forEach { (alias, id) ->
            assertEquals("alias $alias", id, RouteTable.resolve(alias).id)
        }
    }

    @Test
    fun canonicalPathRewritesAliasToCanonicalWebPath() {
        assertEquals("/climate-control", RouteTable.canonicalPath("/climate"))
        assertEquals("/tco", RouteTable.canonicalPath("/analytics/tco"))
        assertEquals("/system-status", RouteTable.canonicalPath("/admin"))
        assertEquals("/charging-curve", RouteTable.canonicalPath("/charging/curves"))
    }

    @Test
    fun unknownRoutesFallBackToNotFound() {
        listOf("/totally-unknown", "/vehicles/3/nope/deep", "/zzz", "/admin/does-not-exist")
            .forEach { assertEquals("notFound", RouteTable.resolve(it).id) }
    }

    @Test
    fun normalizeStripsQueryFragmentAndTrailingSlash() {
        assertEquals("/vehicles", RouteTable.normalize("/vehicles/?tab=1"))
        assertEquals("/vehicles", RouteTable.normalize("vehicles/"))
        assertEquals("/vehicles", RouteTable.normalize("  /vehicles#anchor "))
        assertEquals("/", RouteTable.normalize(""))
        assertEquals("/", RouteTable.normalize("/"))
    }

    @Test
    fun argsExtractsPathParameters() {
        assertEquals(
            mapOf("id" to "42"),
            RouteTable.args(Destinations.require("vehicleDetail"), "/vehicles/42"),
        )
        assertEquals(
            mapOf("id" to "7"),
            RouteTable.args(Destinations.require("tripReplay"), "/drives/7/replay"),
        )
        assertEquals(
            mapOf("year" to "2025"),
            RouteTable.args(Destinations.require("yearReview"), "/year-review/2025"),
        )
    }

    @Test
    fun argsAreEmptyWhenPathDoesNotMatch() {
        assertTrue(RouteTable.args(Destinations.require("vehicleDetail"), "/charging/3").isEmpty())
    }

    @Test
    fun deepLinkUrisCoverBothSchemesWithParamTemplates() {
        val uris = RouteTable.deepLinkUris(Destinations.require("vehicleDetail"))
        assertTrue(uris.contains("teslasync://app/vehicles/{id}"))
        assertTrue(uris.contains("https://app.teslasync.io/vehicles/{id}"))
    }

    @Test
    fun deepLinkUrisIncludeAliasPaths() {
        val uris = RouteTable.deepLinkUris(Destinations.require("chargingCurve"))
        assertTrue(uris.contains("https://app.teslasync.io/charging-curve"))
        assertTrue(uris.contains("https://app.teslasync.io/charging/curves"))
    }

    @Test
    fun bottomBarMirrorsWebBottomTabBar() {
        assertEquals(
            listOf("dashboard", "drives", "charging", "batteryHealth", "liveMap"),
            RouteTable.bottomBar.map { it.id },
        )
    }

    @Test
    fun railExposesEightSectionLeads() {
        assertEquals(8, RouteTable.rail.size)
        assertTrue(RouteTable.rail.any { it.id == "analytics" })
    }

    @Test
    fun forRouteRoundTripsForEveryDestination() {
        Destinations.all.forEach { destination ->
            assertEquals(destination.id, RouteTable.forRoute(destination.route).id)
        }
    }

    @Test
    fun topLevelDestinationsAreNavigationRoots() {
        assertTrue(RouteTable.isTopLevel(Destinations.require("dashboard")))
        assertTrue(RouteTable.isTopLevel(Destinations.require("settings")))
        assertFalse(RouteTable.isTopLevel(Destinations.require("vehicleDetail")))
        assertFalse(RouteTable.isTopLevel(Destinations.require("driveScore")))
    }

    @Test
    fun drawerSectionsListGroupsWithFullChromeItemsOnly() {
        val groups = RouteTable.drawerSections.map { it.group }
        assertTrue(groups.contains(NavGroup.Dashboard))
        assertTrue(groups.contains(NavGroup.Admin))
        // Standalone-only groups expose no listable items, so they are absent from the drawer.
        assertFalse(groups.contains(NavGroup.Watch))
        assertFalse(groups.contains(NavGroup.Onboarding))
        RouteTable.drawerSections.forEach { section ->
            assertTrue(section.items.isNotEmpty())
            assertTrue(section.items.all { it.chrome == Chrome.Full && it.showInNav })
        }
    }
}
