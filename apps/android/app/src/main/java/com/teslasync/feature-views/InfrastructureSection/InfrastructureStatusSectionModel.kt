// Pure, framework-free model + projection for the system-status Infrastructure section — the native
// analogue of everything web/src/features/system/components/status/InfrastructureSection.tsx derives from its
// two polled queries before returning JSX. No Compose, no Android framework, no HTTP: every type here is
// unit-tested off device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface wraps an AccordionSection around two polled `useQuery` feeds: `getTelemetryStatus()`
// (GET /telemetry, refetch 2s) drives the SSE-connection + polling-engine cards, and `getExtendedHealth()`
// (GET /system/health, refetch 30s) contributes the optional database-pool metric row. This file ports the
// shape derivation (the `enabled` / `mode` / `endpoint` / `protocol` / `speed_comparison` reads and the
// `extHealth?.database_pool &&` guard) onto a render-ready [InfrastructureStatusDisplay], and folds the two
// cache-then-network feeds into one [Resource] in [InfrastructureStatusSectionProjection.combine] so the
// view-model can project a single lifecycle-aware state.
//
// This is a DIFFERENT surface from the dev-tools `InfrastructureSection` (prompt 0006) that already lives in
// this directory: that one ports admin/components/devtools/InfrastructureSection.tsx (five on-demand
// `useMutation` tools). The two web components share a basename but are distinct surfaces, so they coexist
// here under distinct type names and a distinct package (`...infrastructurestatus`), neither bypassing the
// other.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/InfrastructureSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infrastructurestatus

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/**
 * The i18n keys the web source passes to `t(...)`, verbatim. The natural-key style (`t('Infrastructure')`)
 * is the web app's own convention for this surface; the render layer resolves each through the Android
 * resource facade and falls back to the key text exactly as react-i18next does when a catalog entry is
 * absent (see `resolveInfraStatusText` in InfrastructureStatusSection.kt), so the on-screen text matches the
 * web verbatim.
 */
object InfraStatusKeys {
    const val TITLE = "Infrastructure"
    const val DESCRIPTION = "SSE connections and polling engine diagnostics"
    const val CONNECTED = "Connected"
    const val DISCONNECTED = "Disconnected"
    const val SSE_CONNECTION = "SSE Connection"
    const val CONNECTION_STATE = "Connection State"
    const val ENDPOINT = "Endpoint"
    const val PROTOCOL = "Protocol"
    const val FALLBACK_MODE = "Fallback Mode"
    const val YES_POLLING = "Yes \u2014 Polling"
    const val NO = "No"
    const val POLLING_ENGINE = "Polling Engine"
    const val ACTIVE = "Active"
    const val STANDBY = "Standby"
    const val MODE = "Mode"
    const val SPEED_COMPARISON = "Speed Comparison"
    const val FLEET_TELEMETRY_LATENCY = "Fleet Telemetry Latency"
    const val FLEET_API_POLLING = "Fleet API Polling"
    const val TOTAL_CONNS = "Total Conns"
    const val ACQUIRED = "Acquired"
    const val IDLE = "Idle"
}

/**
 * Canonical registry metadata for the system-status Infrastructure surface. The diagnostics [SLUG] is
 * emitted with the one-shot `view.opened` event (P1/S11). The web basename is `InfrastructureSection`, so the
 * slug matches the prompt's mandated value; [ID] is unique to this surface so its ViewModel store entry never
 * collides with the sibling dev-tools surface.
 */
object InfrastructureStatusSectionRegistration {
    /** Stable surface id (distinct from the dev-tools surface's id). */
    const val ID: String = "system-status-infrastructure"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "InfrastructureSection"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [InfrastructureStatusSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the composable's first-composition effect. Carries no telemetry/health payload, so a diagnostics line can
 * never leak operational data.
 */
fun recordInfrastructureStatusSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("slug" to InfrastructureStatusSectionRegistration.SLUG))
}

/**
 * The localized strings the surface renders — resolved once at the render boundary and handed to the pure
 * [InfrastructureStatusSectionProjection] so every derived value (connection state, fallback mode, polling
 * status) is baked into the [InfrastructureStatusDisplay] off-device and the view stays a thin render layer.
 */
data class InfrastructureStatusStrings(
    val title: String,
    val description: String,
    val connected: String,
    val disconnected: String,
    val sseConnection: String,
    val connectionState: String,
    val endpoint: String,
    val protocol: String,
    val fallbackMode: String,
    val yesPolling: String,
    val no: String,
    val pollingEngine: String,
    val active: String,
    val standby: String,
    val mode: String,
    val speedComparison: String,
    val fleetTelemetryLatency: String,
    val fleetApiPolling: String,
    val totalConns: String,
    val acquired: String,
    val idle: String,
)

/** One label/value row in a card's definition list (the web `KVList` item). */
data class InfraStatusRow(
    val label: String,
    val value: String,
)

/** The three database-pool connection counts, pre-formatted for display (web `fmtInt(...)`). */
data class PoolDisplay(
    val totalText: String,
    val acquiredText: String,
    val idleText: String,
)

/**
 * The render-ready projection of both feeds — everything the view needs to draw the two cards and the
 * optional pool row, with all copy already localized.
 *
 * @property sseConnected drives the SSE-card Wifi/WifiOff action + the header badge variant (web `sseConnected`).
 * @property connectionLabel the localized Connected/Disconnected label (web `t('Connected'|'Disconnected')`).
 * @property sseRows the SSE-connection card's definition list (web first `KVList`).
 * @property pollingActive whether the polling engine is the active connection mode (web `mode === 'polling'`).
 * @property pollingLabel the localized Active/Standby label (web `t('Active'|'Standby')`).
 * @property pollingRows the polling-engine card's definition list (web second `KVList`).
 * @property pool the database-pool metrics, or `null` when the health payload carries no `database_pool`
 *   (web `extHealth?.database_pool && (...)`) — the view then hides the row rather than drawing zeros.
 */
data class InfrastructureStatusDisplay(
    val sseConnected: Boolean,
    val connectionLabel: String,
    val sseRows: List<InfraStatusRow>,
    val pollingActive: Boolean,
    val pollingLabel: String,
    val pollingRows: List<InfraStatusRow>,
    val pool: PoolDisplay?,
)

/**
 * The combined payload of the two feeds — the telemetry-status element drives the cards (primary), the
 * system-health element contributes the optional pool (secondary). Either may be absent on a first load or a
 * partial failure, mirroring the two independent web queries.
 */
data class InfrastructureStatusData(
    val telemetry: JsonElement?,
    val health: JsonElement?,
)

/**
 * Pure projection from the two cache-then-network feeds onto render-ready state — the native port of the web
 * component's `telemetry?.…` / `extHealth?.database_pool` derivations plus its two-query composition. Side
 * effect free so the gate unit-tests every branch without a device.
 */
object InfrastructureStatusSectionProjection {
    /** The web literal fallback for an absent value (`?? '—'`). */
    const val EM_DASH: String = "\u2014"

    /** The web literal fallback for an absent connection mode (`telemetry?.mode ?? 'unknown'`). */
    const val UNKNOWN_MODE: String = "unknown"

    /** The mode value that flips the surface into polling/fallback presentation (web `=== 'polling'`). */
    const val POLLING_MODE: String = "polling"

    private const val DECIMAL_GROUP = 3

    /**
     * Folds the telemetry-status [telemetry] feed (primary) and the system-health [health] feed (secondary)
     * into one [Resource]. The telemetry feed drives the lifecycle phase + freshness exactly as the web cards
     * key off the `getTelemetryStatus` query; the latest-known health value rides along as the secondary
     * payload so the optional pool appears as soon as that query resolves, without blocking the cards.
     */
    fun combine(
        telemetry: Resource<JsonElement>,
        health: Resource<JsonElement>,
    ): Resource<InfrastructureStatusData> =
        when (telemetry) {
            is Resource.Loading ->
                Resource.Loading(
                    cached = mergeOrNull(telemetry.cached, health.cached),
                    fetchedAt = telemetry.fetchedAt,
                    stale = telemetry.stale,
                )

            is Resource.Success ->
                Resource.Success(
                    data = InfrastructureStatusData(telemetry.data, health.cached),
                    fetchedAt = telemetry.fetchedAt,
                    stale = telemetry.stale,
                )

            is Resource.Error ->
                Resource.Error(
                    cached = mergeOrNull(telemetry.cached, health.cached),
                    fetchedAt = telemetry.fetchedAt,
                    stale = telemetry.stale,
                    error = telemetry.error,
                )
        }

    /**
     * Whether the combined payload carries nothing to render — both feeds absent or structurally blank. An
     * empty payload still renders the two cards with the web's undefined-defaults (every value `—`,
     * Disconnected, Standby), so empty is never a blank box; this predicate only classifies the [phase] so
     * the freshness chip and tests can distinguish a resolved-but-empty surface from live content.
     */
    fun isEmpty(data: InfrastructureStatusData): Boolean = isBlankJson(data.telemetry) && isBlankJson(data.health)

    /**
     * Projects [data] onto the render-ready [InfrastructureStatusDisplay] using the localized [strings].
     * Reproduces the web reads verbatim: `enabled` → connected, `mode` (default `unknown`) → polling, the
     * `endpoint`/`protocol` strings and the `speed_comparison` trio (each `?? '—'`), and the
     * `extHealth?.database_pool` guard for the optional pool.
     */
    fun project(
        data: InfrastructureStatusData,
        strings: InfrastructureStatusStrings,
    ): InfrastructureStatusDisplay {
        val telemetry = data.telemetry as? JsonObject
        val connected = boolOf(telemetry, "enabled") ?: false
        val mode = stringOf(telemetry, "mode") ?: UNKNOWN_MODE
        val polling = mode == POLLING_MODE
        val speed = telemetry?.get("speed_comparison") as? JsonObject

        val sseRows =
            listOf(
                InfraStatusRow(strings.connectionState, if (connected) strings.connected else strings.disconnected),
                InfraStatusRow(strings.endpoint, stringOf(telemetry, "endpoint") ?: EM_DASH),
                InfraStatusRow(strings.protocol, stringOf(telemetry, "protocol") ?: EM_DASH),
                InfraStatusRow(strings.fallbackMode, if (polling) strings.yesPolling else strings.no),
            )

        val pollingRows =
            listOf(
                InfraStatusRow(strings.mode, mode),
                InfraStatusRow(strings.speedComparison, stringOf(speed, "speedup") ?: EM_DASH),
                InfraStatusRow(strings.fleetTelemetryLatency, stringOf(speed, "fleet_telemetry_latency") ?: EM_DASH),
                InfraStatusRow(strings.fleetApiPolling, stringOf(speed, "fleet_api_polling") ?: EM_DASH),
            )

        return InfrastructureStatusDisplay(
            sseConnected = connected,
            connectionLabel = if (connected) strings.connected else strings.disconnected,
            sseRows = sseRows,
            pollingActive = polling,
            pollingLabel = if (polling) strings.active else strings.standby,
            pollingRows = pollingRows,
            pool = poolOf(data.health),
        )
    }

    /** The database-pool metrics when the health payload carries a `database_pool` object, else `null`. */
    fun poolOf(health: JsonElement?): PoolDisplay? {
        val pool = (health as? JsonObject)?.get("database_pool") as? JsonObject ?: return null
        return PoolDisplay(
            totalText = formatConns(intOf(pool, "total_conns") ?: 0),
            acquiredText = formatConns(intOf(pool, "acquired_conns") ?: 0),
            idleText = formatConns(intOf(pool, "idle_conns") ?: 0),
        )
    }

    /** Groups an integer into thousands with commas — the deterministic native analogue of web `fmtInt`. */
    fun formatConns(value: Int): String {
        val digits = kotlin.math.abs(value).toString()
        val grouped = StringBuilder()
        digits.forEachIndexed { index, char ->
            if (index > 0 && (digits.length - index) % DECIMAL_GROUP == 0) grouped.append(',')
            grouped.append(char)
        }
        return if (value < 0) "-$grouped" else grouped.toString()
    }

    private fun mergeOrNull(
        telemetry: JsonElement?,
        health: JsonElement?,
    ): InfrastructureStatusData? = if (telemetry == null && health == null) null else InfrastructureStatusData(telemetry, health)

    private fun isBlankJson(element: JsonElement?): Boolean =
        element == null || element is JsonNull || (element is JsonObject && element.isEmpty())

    private fun stringOf(
        obj: JsonObject?,
        key: String,
    ): String? {
        val primitive = obj?.get(key) as? JsonPrimitive ?: return null
        return if (primitive.isString) primitive.content.takeIf { it.isNotEmpty() } else null
    }

    private fun boolOf(
        obj: JsonObject?,
        key: String,
    ): Boolean? = (obj?.get(key) as? JsonPrimitive)?.booleanOrNull

    private fun intOf(
        obj: JsonObject?,
        key: String,
    ): Int? = (obj?.get(key) as? JsonPrimitive)?.intOrNull
}
