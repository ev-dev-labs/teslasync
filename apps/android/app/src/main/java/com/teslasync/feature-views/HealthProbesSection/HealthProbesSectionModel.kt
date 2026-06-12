// Pure, framework-free model + projection for the Health Probes feature view — the native analogue of
// everything web/src/features/system/components/status/HealthProbesSection.tsx derives from the
// `getExtendedHealth` (`GET /system/health`) payload before returning JSX. No Compose, no Android
// framework, no HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// The web surface is a single polling `useQuery(getExtendedHealth, refetchInterval: 30s)` rendered inside an
// AccordionSection: a loading branch (two skeletons), an error branch (QueryError), and a content branch
// with two Live/Ready header badges over two cards — a "Liveness — /healthz" card (Status / Goroutines /
// Uptime) and a "Readiness — /readyz" card (Database / Latency / Pool Connections). This file reproduces
// the data that branch derives — the raw liveness + database statuses (shown verbatim, web `{livenessStatus}`
// / `{dbStatus}`), the goroutine + uptime + pool figures, and the optional DB latency — plus the web helper
// logic (`statusToBadgeVariant`, `formatUptime`, `fmtInt`, `fmtNumber`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/HealthProbesSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthprobes

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale

/**
 * Canonical registry metadata for the Health Probes surface — the native mirror of the web status section.
 * The diagnostics [SLUG] is emitted with the one-shot `view.opened` event (P1/S11).
 */
object HealthProbesSectionRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "health-probes-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "HealthProbesSection"
}

/**
 * The i18n keys the web source passes to `t(...)`, verbatim. The natural-key style (`t('Health Probes')`) is
 * the web app's own convention here; some of these keys exist in the shared P1/S10 catalog (`Live`, `Ready`,
 * `Status`, `Goroutines`, `Uptime`, `Database`, `Latency`) and the rest fall back to the key text exactly as
 * react-i18next does on the web. The render layer resolves each through the Android resource facade, falling
 * back to the key (see `resolveHealthProbesText` in HealthProbesSection.kt), so the on-screen text matches
 * the web verbatim. The [EMPTY_HINT] and the four accordion affordance keys are native-only microcopy (the
 * web relies on react-query's never-null content + the DOM `aria-expanded`, neither of which has an
 * automatic native equivalent); they resolve by-name and fall back to these English defaults.
 */
object HealthProbesKeys {
    const val TITLE = "Health Probes"
    const val DESCRIPTION = "Liveness and readiness checks"
    const val LIVE = "Live"
    const val READY = "Ready"
    const val LIVENESS = "Liveness \u2014 /healthz"
    const val READINESS = "Readiness \u2014 /readyz"
    const val STATUS = "Status"
    const val GOROUTINES = "Goroutines"
    const val UPTIME = "Uptime"
    const val DATABASE = "Database"
    const val LATENCY = "Latency"
    const val POOL_CONNECTIONS = "Pool Connections"

    const val EMPTY_HINT = "No health data"
    const val LOADING = "Loading"
    const val EXPAND_ACTION = "Expand"
    const val COLLAPSE_ACTION = "Collapse"
    const val EXPANDED_STATE = "Expanded"
    const val COLLAPSED_STATE = "Collapsed"
}

/**
 * The API status sentinel the web component substitutes when a status field is absent
 * (`data?.status ?? 'unknown'` / `data?.database?.status ?? 'unknown'`). It is a raw data value shown
 * verbatim (like the web), not translatable UI copy, so it is held as a constant rather than an i18n key.
 */
const val HEALTH_PROBES_UNKNOWN_STATUS: String = "unknown"

/** Unit suffix for the DB latency value — a universal symbol, not translatable copy (web `${…} ms`). */
const val HEALTH_PROBES_LATENCY_UNIT: String = "ms"

/**
 * The fully projected, render-ready view of the surface — the native analogue of everything the web
 * `HealthProbesSection` derives (`livenessStatus`, `dbStatus`, `dbLatency`, and the goroutine / uptime /
 * pool figures) before returning JSX. Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property livenessStatus the raw top-level health status, shown verbatim (web `data?.status ?? 'unknown'`).
 * @property dbStatus the raw database status, shown verbatim (web `data?.database?.status ?? 'unknown'`).
 * @property goroutines the live goroutine count (web `data?.system?.goroutines ?? 0`).
 * @property uptimeSeconds process uptime in seconds (web `data?.system?.uptime_seconds ?? 0`).
 * @property dbLatencyMs database round-trip latency in ms, or `null` when absent (web `database?.latency_ms`).
 * @property poolTotalConns total pool connections (web `data?.database_pool?.total_conns ?? 0`).
 * @property resolved whether `/system/health` resolved to an object — the web `data != null` truthiness;
 *   `false` ⇒ the surface renders its friendly empty state instead of the two cards.
 */
data class HealthProbesData(
    val livenessStatus: String,
    val dbStatus: String,
    val goroutines: Long,
    val uptimeSeconds: Long,
    val dbLatencyMs: Double?,
    val poolTotalConns: Long,
    val resolved: Boolean,
) {
    /** Web `data != null` — false ⇒ the empty state. */
    val hasData: Boolean get() = resolved

    companion object {
        /** The no-data projection (web `data == null` ⇒ the cards never render). */
        val EMPTY: HealthProbesData =
            HealthProbesData(
                livenessStatus = HEALTH_PROBES_UNKNOWN_STATUS,
                dbStatus = HEALTH_PROBES_UNKNOWN_STATUS,
                goroutines = 0L,
                uptimeSeconds = 0L,
                dbLatencyMs = null,
                poolTotalConns = 0L,
                resolved = false,
            )
    }
}

/**
 * Pure projection from the raw `/system/health` payload to the render-ready [HealthProbesData] — the native
 * port of the derivation work in `HealthProbesSection.tsx`. Side-effect-free (no Android, no Compose, no
 * coroutines) so the gate unit-tests every branch without a device.
 */
object HealthProbesProjection {
    /**
     * Build the projection from the raw `/system/health` [health] object (web `getExtendedHealth`). A
     * non-object [health] (null, `JsonNull`, or a scalar) yields the no-data projection (web `data == null`),
     * which the surface renders as its empty state. Both snake_case (the wire shape) and camelCase keys are
     * accepted defensively, mirroring the web's tolerance after `camelCaseKeys`.
     */
    fun build(health: JsonElement?): HealthProbesData {
        val obj = health as? JsonObject ?: return HealthProbesData.EMPTY
        val database = obj["database"] as? JsonObject
        val pool = obj["database_pool"] as? JsonObject ?: obj["databasePool"] as? JsonObject
        val system = obj["system"] as? JsonObject
        return HealthProbesData(
            livenessStatus = stringField(obj, "status") ?: HEALTH_PROBES_UNKNOWN_STATUS,
            dbStatus = stringField(database, "status") ?: HEALTH_PROBES_UNKNOWN_STATUS,
            goroutines = firstLong(system, "goroutines") ?: 0L,
            uptimeSeconds = firstLong(system, "uptime_seconds", "uptimeSeconds") ?: 0L,
            dbLatencyMs = firstDouble(database, "latency_ms", "latencyMs"),
            poolTotalConns = firstLong(pool, "total_conns", "totalConns") ?: 0L,
            resolved = true,
        )
    }

    /**
     * Maps a status string onto the shared badge tone — a 1:1 port of the web `statusToBadgeVariant`
     * (`helpers.tsx`): healthy/ok/online/ready/sent/completed ⇒ Success; degraded/warning/pending/queued/
     * processing ⇒ Warning; unhealthy/offline/error/down/failed ⇒ Danger; anything else ⇒ Neutral.
     */
    fun statusBadgeVariant(status: String): BadgeVariant =
        when (status.trim().lowercase(Locale.ROOT)) {
            "healthy", "ok", "online", "ready", "sent", "completed" -> BadgeVariant.Success
            "degraded", "warning", "pending", "queued", "processing" -> BadgeVariant.Warning
            "unhealthy", "offline", "error", "down", "failed" -> BadgeVariant.Danger
            else -> BadgeVariant.Neutral
        }

    /**
     * Formats an uptime duration — a 1:1 port of the web `formatUptime` (`helpers.tsx`): `${d}d ${h}h ${m}m`
     * once there is at least a day, `${h}h ${m}m` once there is at least an hour, else `${m}m`. Negative
     * inputs are clamped to zero (uptime is never negative).
     */
    fun formatUptime(seconds: Long): String {
        val total = seconds.coerceAtLeast(0L)
        val days = total / SECONDS_PER_DAY
        val hours = (total % SECONDS_PER_DAY) / SECONDS_PER_HOUR
        val mins = (total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        return when {
            days > 0L -> "${days}d ${hours}h ${mins}m"
            hours > 0L -> "${hours}h ${mins}m"
            else -> "${mins}m"
        }
    }

    /** Format an integer count with locale grouping (web `fmtInt`). */
    fun formatCount(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value.toDouble(), INT_DECIMALS, locale) // parity:allow toDouble() numeric conversion, not a stub

    /** The "Latency" value — web `dbLatency != null ? "${fmtNumber(dbLatency, 1)} ms" : '—'`. */
    fun formatLatency(
        latencyMs: Double?,
        locale: Locale = Locale.getDefault(),
    ): String =
        latencyMs
            ?.let { "${ChartFormat.number(it, LATENCY_DECIMALS, locale)} $HEALTH_PROBES_LATENCY_UNIT" }
            ?: ChartFormat.EMPTY

    private fun stringField(
        obj: JsonObject?,
        key: String,
    ): String? = (obj?.get(key) as? JsonPrimitive)?.contentOrNull

    private fun firstLong(
        obj: JsonObject?,
        vararg keys: String,
    ): Long? = keys.firstNotNullOfOrNull { key -> (obj?.get(key) as? JsonPrimitive)?.longOrNull }

    private fun firstDouble(
        obj: JsonObject?,
        vararg keys: String,
    ): Double? = keys.firstNotNullOfOrNull { key -> (obj?.get(key) as? JsonPrimitive)?.doubleOrNull }

    private const val INT_DECIMALS = 0
    private const val LATENCY_DECIMALS = 1
    private const val SECONDS_PER_DAY = 86_400L
    private const val SECONDS_PER_HOUR = 3_600L
    private const val SECONDS_PER_MINUTE = 60L
}

/** Maps the Android [errorKind] + HTTP [httpStatus] onto the feedback layer's recovery-oriented bucket. */
fun healthProbesErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )
