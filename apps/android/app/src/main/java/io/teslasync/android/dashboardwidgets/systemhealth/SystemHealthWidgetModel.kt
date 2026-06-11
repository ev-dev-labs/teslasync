// File hosts the SystemHealth surface's pure model + projection + registry; named after the surface
// bundle (SystemHealthWidget*) rather than the single declaration it leads with.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.systemhealth

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.SystemHealth
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale

/** The em-dash shown wherever a value is unknown (matches the shared formatter fallback + web `'—'`). */
internal const val SYSTEM_HEALTH_EM_DASH: String = "\u2014"

/** Unit suffix for the Memory stat — a universal symbol, not translatable copy (web `${…} MB`). */
internal const val SYSTEM_HEALTH_MEMORY_UNIT: String = "MB"

/**
 * The component keys the widget surfaces, in render order — the native mirror of the web
 * `SERVICE_KEYS` in `web/src/features/dashboard/widgets/SystemHealthWidget.tsx`. Each entry is the
 * key the `/system/health` `components` map is read by; the display label is derived from the key by
 * [SystemHealthProjection.humanizeServiceKey] exactly like the web's `t(key, <humanized key>)`
 * fallback (the per-service i18n keys are not present in the P1/S10 catalog, so the humanized key is
 * what both web and native render).
 */
internal val SYSTEM_HEALTH_SERVICE_KEYS: List<String> =
    listOf("database", "mqtt", "tesla_api", "fleet_telemetry")

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size` plus
 * the `isCompact = size.cols <= 1` branch in `SystemHealthWidget.tsx`.
 */
data class SystemHealthSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact`): show the centered overall badge + healthy/total count. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
    }
}

/**
 * Canonical registry metadata for the System Health surface — the native mirror of the web registry
 * entry in `web/src/features/dashboard/widgets/registry/system.ts` (`system-health`). A dashboard host
 * binds this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint.
 */
object SystemHealthRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "system-health"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SystemHealthWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: SystemHealthSize = SystemHealthSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: SystemHealthSize = SystemHealthSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: SystemHealthSize = SystemHealthSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: SystemHealthSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SystemHealthSize): SystemHealthSize =
        SystemHealthSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The overall server-health bucket — the native analogue of the web `overallStatus` mapped through
 * `overallLabel` / `overallBadgeStatus`. `'healthy'` ⇒ [Healthy] (green / "Healthy" / online badge),
 * `'degraded'` ⇒ [Degraded] (amber / "Degraded" / away badge), anything else (incl. `'unhealthy'` and
 * the `'unknown'` fallback) ⇒ [Down] (red / "Down" / offline badge).
 */
enum class SystemOverall { Healthy, Degraded, Down }

/**
 * One service's status tier — the native analogue of the web `statusColor` map: `'ok'`/`'healthy'` ⇒
 * [Ok] (green dot), `'degraded'` ⇒ [Degraded] (amber dot), anything else (incl. the `'unhealthy'`
 * fallback applied when a component is missing) ⇒ [Down] (red dot).
 */
enum class SystemServiceLevel { Ok, Degraded, Down }

/**
 * One service row — the native analogue of a web `services[]` entry. [key] is the raw `components`
 * map key (e.g. `tesla_api`); [label] is the humanized display name (web `t()` fallback); [level] is
 * the dot tier.
 */
data class SystemService(
    val key: String,
    val label: String,
    val level: SystemServiceLevel,
)

/**
 * The fully projected, render-ready view of the widget — the native analogue of everything
 * `SystemHealthWidget.tsx` derives (the `services` memo, `overallStatus`, `healthyCount`, `dbSize`,
 * `activeConns`/`maxConns`, `goroutines`, `memory`) before returning JSX. Pure data (no Compose types)
 * so every branch is unit-tested directly.
 *
 * @property overall the overall health bucket (web `overallStatus`).
 * @property services the four service rows (web `services`).
 * @property healthyCount services whose status is ok/healthy (web `healthyCount`).
 * @property dbSize the database-size display string (web `databaseSize ?? dbStats.databaseSize ?? '—'`).
 * @property activeConns connections currently in use (web `pool.inUse ?? 0`).
 * @property maxConns the pool's max connections (web `pool.maxOpen ?? 0`).
 * @property memoryMb resident memory in MB, or `null` when absent (web `pool.memoryMB`).
 * @property goroutines the live goroutine count, or `null` when absent (web `pool.goroutines`).
 * @property resolved whether `/system/health` resolved to an object — the web `hasData = health.data
 *   != null` truthiness; `false` ⇒ the surface renders its "No system health data" empty state.
 */
data class SystemHealthData(
    val overall: SystemOverall,
    val services: List<SystemService>,
    val healthyCount: Int,
    val dbSize: String,
    val activeConns: Long,
    val maxConns: Long,
    val memoryMb: Long?,
    val goroutines: Long?,
    val resolved: Boolean,
) {
    /** Total number of service rows (web `services.length`). */
    val serviceCount: Int get() = services.size

    /** Web `hasData = health.data != null` — false ⇒ the empty state. */
    val hasData: Boolean get() = resolved

    companion object {
        /** The no-data projection (web `health.data == null` ⇒ empty state). */
        val EMPTY: SystemHealthData =
            SystemHealthData(
                overall = SystemOverall.Down,
                services =
                    SYSTEM_HEALTH_SERVICE_KEYS.map { key ->
                        SystemService(key, SystemHealthProjection.humanizeServiceKey(key), SystemServiceLevel.Down)
                    },
                healthyCount = 0,
                dbSize = SYSTEM_HEALTH_EM_DASH,
                activeConns = 0L,
                maxConns = 0L,
                memoryMb = null,
                goroutines = null,
                resolved = false,
            )
    }
}

/**
 * Pure projection from the three raw `/system/health` + `/dev-tools/db-stats` + `/dev-tools/runtime-info`
 * payloads to the render-ready [SystemHealthData] — the native port of the derivation work in
 * `SystemHealthWidget.tsx`. Side-effect-free (no Android, no Compose, no coroutines) so the gate
 * unit-tests every branch without a device.
 */
object SystemHealthProjection {
    /**
     * Build the analysis from the raw `/system/health` [health] object (web `useSystemHealth`), the
     * `/dev-tools/db-stats` [dbStats] object (web `useDBStats`), and the `/dev-tools/runtime-info`
     * [pool] object (web `useConnectionPool`). A non-object [health] (null, `JsonNull`, or a scalar)
     * yields the no-data projection (web `health.data == null`).
     */
    fun build(
        health: JsonElement?,
        dbStats: JsonElement?,
        pool: JsonElement?,
    ): SystemHealthData {
        val healthObj = health as? JsonObject
        val dbObj = dbStats as? JsonObject
        val poolObj = pool as? JsonObject
        val components = healthObj?.get("components") as? JsonObject
        val services =
            SYSTEM_HEALTH_SERVICE_KEYS.map { key ->
                SystemService(
                    key = key,
                    label = humanizeServiceKey(key),
                    level = serviceLevelOf(componentStatus(components, key)),
                )
            }
        return SystemHealthData(
            overall = overallOf(stringField(healthObj, "status")),
            services = services,
            healthyCount = services.count { it.level == SystemServiceLevel.Ok },
            dbSize = dbSizeOf(healthObj, dbObj),
            activeConns = firstLong(poolObj, "in_use", "inUse") ?: 0L,
            maxConns = firstLong(poolObj, "max_open", "maxOpen") ?: 0L,
            memoryMb = firstLong(poolObj, "memory_mb", "memoryMB"),
            goroutines = firstLong(poolObj, "goroutines"),
            resolved = healthObj != null,
        )
    }

    /**
     * The overall health bucket — a 1:1 port of the web `overallStatus` →
     * `overallLabel`/`overallBadgeStatus`: `'healthy'` ⇒ [SystemOverall.Healthy]; `'degraded'` ⇒
     * [SystemOverall.Degraded]; anything else ⇒ [SystemOverall.Down].
     */
    fun overallOf(status: String?): SystemOverall =
        when (status?.trim()) {
            "healthy" -> SystemOverall.Healthy
            "degraded" -> SystemOverall.Degraded
            else -> SystemOverall.Down
        }

    /**
     * One service's dot tier — a 1:1 port of the web `statusColor`: `'ok'`/`'healthy'` ⇒
     * [SystemServiceLevel.Ok]; `'degraded'` ⇒ [SystemServiceLevel.Degraded]; anything else (including the
     * missing-component `'unhealthy'` fallback) ⇒ [SystemServiceLevel.Down].
     */
    fun serviceLevelOf(status: String?): SystemServiceLevel =
        when (status?.trim()) {
            "ok", "healthy" -> SystemServiceLevel.Ok
            "degraded" -> SystemServiceLevel.Degraded
            else -> SystemServiceLevel.Down
        }

    /**
     * Humanizes a `components` map key into a display label — a 1:1 port of the web fallback
     * `key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())`: `database` ⇒ `Database`,
     * `tesla_api` ⇒ `Tesla Api`, `fleet_telemetry` ⇒ `Fleet Telemetry`, `mqtt` ⇒ `Mqtt`. The label is
     * data-derived (the key is an API identifier, not UI copy), so it carries no hardcoded English.
     */
    fun humanizeServiceKey(key: String): String =
        key
            .split('_')
            .filter { it.isNotEmpty() }
            .joinToString(" ") { word ->
                word.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
            }

    /** The database-size string — web `health.databaseSize ?? dbStats.databaseSize ?? '—'`. */
    fun dbSizeOf(
        health: JsonObject?,
        dbStats: JsonObject?,
    ): String =
        firstString(health, "database_size", "databaseSize")
            ?: firstString(dbStats, "database_size", "databaseSize")
            ?: SYSTEM_HEALTH_EM_DASH

    /** The "Active Conns" value — web `maxConns > 0 ? "${active}/${max}" : "${active}"`. */
    fun formatActiveConns(
        active: Long,
        max: Long,
        locale: Locale = Locale.getDefault(),
    ): String =
        if (max > 0L) {
            "${formatCount(active, locale)}/${formatCount(max, locale)}"
        } else {
            formatCount(active, locale)
        }

    /** The "Memory" value — web `memory != null ? "${fmtInt(memory)} MB" : '—'`. */
    fun formatMemory(
        memoryMb: Long?,
        locale: Locale = Locale.getDefault(),
    ): String = memoryMb?.let { "${formatCount(it, locale)} $SYSTEM_HEALTH_MEMORY_UNIT" } ?: SYSTEM_HEALTH_EM_DASH

    /** The "Goroutines" value — web `goroutines != null ? fmtInt(goroutines) : '—'`. */
    fun formatGoroutines(
        goroutines: Long?,
        locale: Locale = Locale.getDefault(),
    ): String = goroutines?.let { formatCount(it, locale) } ?: SYSTEM_HEALTH_EM_DASH

    /** Format an integer count with locale grouping (web `fmtInt`). */
    fun formatCount(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value.toDouble(), COUNT_DECIMALS, locale) // parity:allow toDouble() numeric conversion not a stub

    /** Reads `components[key].status` as a string, or `null` when absent/non-object. */
    fun componentStatus(
        components: JsonObject?,
        key: String,
    ): String? = stringField(components?.get(key) as? JsonObject, "status")

    private fun stringField(
        obj: JsonObject?,
        key: String,
    ): String? = (obj?.get(key) as? JsonPrimitive)?.contentOrNull

    private fun firstString(
        obj: JsonObject?,
        vararg keys: String,
    ): String? = keys.firstNotNullOfOrNull { key -> (obj?.get(key) as? JsonPrimitive)?.contentOrNull }

    private fun firstLong(
        obj: JsonObject?,
        vararg keys: String,
    ): Long? = keys.firstNotNullOfOrNull { key -> (obj?.get(key) as? JsonPrimitive)?.longOrNull }

    private const val COUNT_DECIMALS = 0
}

/** Maps the overall [overall] bucket onto the shared badge tone — web `online → success` etc. */
fun systemOverallBadgeVariant(overall: SystemOverall): BadgeVariant =
    when (overall) {
        SystemOverall.Healthy -> BadgeVariant.Success
        SystemOverall.Degraded -> BadgeVariant.Warning
        SystemOverall.Down -> BadgeVariant.Danger
    }

/** Maps a service [level] onto the shared [SystemHealth] dot tier (web `StatusDot` green/amber/red). */
fun systemServiceDot(level: SystemServiceLevel): SystemHealth =
    when (level) {
        SystemServiceLevel.Ok -> SystemHealth.Healthy
        SystemServiceLevel.Degraded -> SystemHealth.Degraded
        SystemServiceLevel.Down -> SystemHealth.Down
    }

/** Maps the Android [errorKind] + HTTP [httpStatus] onto the feedback layer's recovery-oriented bucket. */
fun systemHealthErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )
