package io.teslasync.android.navigation

/** A drawer navigation section: a [NavGroup] header plus its listed destinations. */
data class NavSection(
    val group: NavGroup,
    val items: List<Destination>,
)

/**
 * Pure routing logic over [Destinations]: alias resolution, deep-link derivation, path matching,
 * and the curated bottom-bar / rail / drawer navigation sets. Framework-free (no Compose/Android),
 * so every rule is covered by JVM unit tests (RouteTableTest).
 */
object RouteTable {
    /** Custom URI scheme the app answers to (e.g. `teslasync://app/vehicles/3`). */
    const val APP_SCHEME: String = "teslasync"

    /** App-Links host the app answers to (e.g. `https://app.teslasync.io/vehicles/3`). */
    const val APP_HOST: String = "app.teslasync.io"

    /** Web alias/redirect path -> canonical destination id (App.tsx redirects + AI-feature aliases). */
    val aliases: Map<String, String> =
        mapOf(
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

    /** Start destination (web `/`). */
    val start: Destination get() = Destinations.require("dashboard")

    /** Shared not-found destination for unknown URLs and not-yet-hosted pages. */
    val notFound: Destination get() = Destinations.require("notFound")

    /** Bottom-bar destinations on compact width — mirrors the web BottomTabBar top-5. */
    val bottomBar: List<Destination> =
        listOf("dashboard", "drives", "charging", "batteryHealth", "liveMap")
            .map(Destinations::require)

    /** Rail destinations on medium width — section leads for the most-used groups. */
    val rail: List<Destination> =
        listOf(
            "dashboard",
            "vehicles",
            "charging",
            "drives",
            "batteryHealth",
            "analytics",
            "liveMap",
            "settings",
        ).map(Destinations::require)

    /** The landing destination for each [NavGroup] (the drawer section's primary target). */
    val groupLeads: Map<NavGroup, Destination> =
        mapOf(
            NavGroup.Dashboard to Destinations.require("dashboard"),
            NavGroup.Vehicles to Destinations.require("vehicles"),
            NavGroup.Charging to Destinations.require("charging"),
            NavGroup.TripsDrives to Destinations.require("drives"),
            NavGroup.BatteryEnergy to Destinations.require("batteryHealth"),
            NavGroup.Analytics to Destinations.require("analytics"),
            NavGroup.Maps to Destinations.require("liveMap"),
            NavGroup.VehicleSystems to Destinations.require("climateControl"),
            NavGroup.Automations to Destinations.require("automations"),
            NavGroup.Notifications to Destinations.require("notificationsInbox"),
            NavGroup.Telemetry to Destinations.require("signalsWorkspace"),
            NavGroup.Diagnostics to Destinations.require("anomalyDetection"),
            NavGroup.Admin to Destinations.require("systemStatus"),
            NavGroup.PowerUser to Destinations.require("powerDashboards"),
            NavGroup.System to Destinations.require("systemStatus"),
            NavGroup.Settings to Destinations.require("settings"),
            NavGroup.Onboarding to Destinations.require("onboarding"),
            NavGroup.Search to Destinations.require("search"),
            NavGroup.Sharing to Destinations.require("sharingTrips"),
            NavGroup.Watch to Destinations.require("watchFace"),
            NavGroup.NotFound to Destinations.require("notFound"),
        )

    /** Drawer sections: every full-chrome, listable destination grouped by [NavGroup], in order. */
    val drawerSections: List<NavSection> =
        NavGroup.entries
            .map { group ->
                NavSection(
                    group = group,
                    items = Destinations.all.filter { it.group == group && it.chrome == Chrome.Full && it.showInNav },
                )
            }.filter { it.items.isNotEmpty() }

    /** Destination ids that are navigation roots (no Up affordance in the top app bar). */
    val topLevel: Set<String> = (bottomBar + rail + groupLeads.values).map { it.id }.toSet()

    /** True when [destination] is a navigation root (shows no Up button). */
    fun isTopLevel(destination: Destination): Boolean = destination.id in topLevel

    /**
     * Normalizes a raw path: trims, drops a query/fragment, ensures a single leading slash, and
     * removes a trailing slash (except for the root path).
     */
    fun normalize(path: String): String {
        var p = path.trim()
        val cut = p.indexOfFirst { it == '?' || it == '#' }
        if (cut >= 0) p = p.substring(0, cut)
        if (!p.startsWith("/")) p = "/$p"
        if (p.length > 1) p = p.trimEnd('/')
        return p.ifEmpty { "/" }
    }

    /** Resolves an alias path to its canonical web path, or returns the normalized path unchanged. */
    fun canonicalPath(path: String): String {
        val normalized = normalize(path)
        val aliasTarget = aliases[normalized] ?: return normalized
        return Destinations.require(aliasTarget).webPath
    }

    /** Matches a (possibly alias) path to a destination, honoring `:param` segments; null if none. */
    fun match(path: String): Destination? {
        val normalized = normalize(path)
        aliases[normalized]?.let { return Destinations.require(it) }
        return Destinations.all.firstOrNull { segmentsMatch(it.webPath, normalized) }
    }

    /** Resolves any path to a destination, falling back to [notFound] for unknown URLs. */
    fun resolve(path: String): Destination = match(path) ?: notFound

    /** Destinations keyed by their Navigation-Compose route pattern (e.g. `vehicles/{id}`). */
    val byRoute: Map<String, Destination> = Destinations.all.associateBy { it.route }

    /** Resolves a Navigation-Compose route pattern back to its destination; [notFound] if unknown. */
    fun forRoute(route: String?): Destination = route?.let { byRoute[it] } ?: notFound

    /** Extracts `:param` values from [path] for [destination]; empty when it does not match. */
    fun args(
        destination: Destination,
        path: String,
    ): Map<String, String> {
        val pattern = segmentsOf(destination.webPath)
        val actual = segmentsOf(normalize(path))
        if (!segmentsMatch(destination.webPath, normalize(path))) return emptyMap()
        val out = LinkedHashMap<String, String>()
        for (i in pattern.indices) {
            val segment = pattern[i]
            if (segment.startsWith(":")) out[segment.removePrefix(":")] = actual[i]
        }
        return out
    }

    /** Deep-link URI patterns for [destination] + any aliases, for both app-scheme and App-Links. */
    fun deepLinkUris(destination: Destination): List<String> {
        val webPaths =
            buildList {
                add(destination.webPath)
                aliases.filterValues { it == destination.id }.keys.forEach { add(it) }
            }
        return webPaths.flatMap { web ->
            val uriPath = toUriPath(web)
            listOf("$APP_SCHEME://app$uriPath", "https://$APP_HOST$uriPath")
        }
    }

    private fun toUriPath(webPath: String): String {
        if (webPath == "/") return "/"
        var pattern = webPath
        Regex(":([A-Za-z0-9_]+)").findAll(webPath).forEach {
            pattern = pattern.replace(it.value, "{${it.groupValues[1]}}")
        }
        return pattern
    }

    private fun segmentsOf(path: String): List<String> = path.trim('/').split('/').filter { it.isNotEmpty() }

    private fun segmentsMatch(
        webPath: String,
        actualPath: String,
    ): Boolean {
        val pattern = segmentsOf(webPath)
        val actual = segmentsOf(actualPath)
        if (pattern.size != actual.size) return false
        return pattern.indices.all { pattern[it].startsWith(":") || pattern[it] == actual[it] }
    }
}
