// Pure, framework-free model + projection for the Uptime Monitor dashboard widget — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx). No Compose, no Android framework, no HTTP:
// every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The resolved system-health snapshot arrives as the raw, verbatim server
// JSON from the shared AdminStore (the web `useSystemHealth` queryFn), so this file owns the parse +
// the client-side derivations the web component does inline: the per-service status lookup with its
// `'unhealthy'` fallback, the overall/per-service badge text + tone, and the healthy-count hero.
//
// i18n parity note — the four service ROW labels (Database / Mqtt / Tesla Api / Fleet Telemetry):
// the web reads each via `t('widget.uptime.${key}', titleized)`, but those four keys are ABSENT from the
// shared P1/S10 catalog, so i18next renders the titleized fallback (`key.replace(/_/g,' ')` + word-cap)
// in EVERY locale. To preserve exact display parity and avoid silent drift, [titleizeServiceKey]
// reproduces that identical transform. The SERVICE_KEYS are API field identifiers (data — the same
// `SERVICE_KEYS` const the web declares), not translatable UI prose, so deriving the label introduces no
// English literal — exactly the precedent the sibling SignalLogWidget sets for its verbatim, non-catalog
// `SOURCE_LABELS`. The six genuinely catalog-backed strings (title / overall / allOk / dbSize / tables /
// noData) and the per-service "OK" word DO resolve through the i18n facade (see [UptimeMonitorStrings]).
// Non-ok statuses render the raw wire token verbatim, exactly as the web's `?? status` passthrough does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/UptimeMonitorWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling MQTTStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.uptimemonitor

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.util.Locale

/** The em-dash shown wherever a value is unknown (matches the web `'—'` fallback). */
internal const val UPTIME_EM_DASH: String = "\u2014"

/** Wire status tokens the web compares against (lower-cased first); `ok`/`healthy` ⇒ green/"OK". */
internal const val STATUS_OK: String = "ok"
internal const val STATUS_HEALTHY: String = "healthy"
internal const val STATUS_DEGRADED: String = "degraded"

/** The default overall status when none resolved (web `data?.status ?? 'unknown'`). */
internal const val STATUS_UNKNOWN: String = "unknown"

/** The per-service status fallback when a component is absent (web `components[key]?.status ?? 'unhealthy'`). */
internal const val STATUS_UNHEALTHY: String = "unhealthy"

/**
 * The four backend services surfaced, in render order — the native mirror of the web `SERVICE_KEYS`
 * const. These are API field identifiers (the keys of the `/system/health` `components` map), not
 * user-facing prose; their display labels are derived by [titleizeServiceKey].
 */
internal val SERVICE_KEYS: List<String> = listOf("database", "mqtt", "tesla_api", "fleet_telemetry")

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component branches its layout on two flags computed from the footprint: [isCompact] (the centered
 * healthy-count hero) and [isTall] (the extended DB-size / table-count footer).
 */
data class UptimeMonitorSize(
    val cols: Int,
    val rows: Int,
) {
    /** Web `size.cols === 1 && size.rows === 1`: render the centered `healthy/total` hero. */
    val isCompact: Boolean get() = cols == COMPACT_DIMENSION && rows == COMPACT_DIMENSION

    /** Web `size.rows >= 2`: append the DB-size / table-count footer below the service list. */
    val isTall: Boolean get() = rows >= TALL_MIN_ROWS

    private companion object {
        const val COMPACT_DIMENSION = 1
        const val TALL_MIN_ROWS = 2
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/system.ts (`uptime-monitor`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object UptimeMonitorRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "uptime-monitor"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "UptimeMonitorWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val DEFAULT_SIZE: UptimeMonitorSize = UptimeMonitorSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: UptimeMonitorSize = UptimeMonitorSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: UptimeMonitorSize = UptimeMonitorSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: UptimeMonitorSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: UptimeMonitorSize): UptimeMonitorSize =
        UptimeMonitorSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * Semantic tone for a status badge + dot — the native port of the web `statusVariant` map. Mapped to a
 * concrete `BadgeVariant` + dot color at the render boundary so the pure projection stays theme-stable.
 */
enum class UptimeTone { Success, Warning, Danger }

/**
 * Map a status token to its [UptimeTone] — the native port of the web `statusVariant`: `ok`/`healthy`
 * → success, `degraded` → warning, everything else → danger. Case-insensitive.
 */
fun toneFor(status: String): UptimeTone =
    when (status.trim().lowercase(Locale.ROOT)) {
        STATUS_OK, STATUS_HEALTHY -> UptimeTone.Success
        STATUS_DEGRADED -> UptimeTone.Warning
        else -> UptimeTone.Danger
    }

/** True when [status] is the healthy/ok pair the web treats specially (green dot + "OK" badge). */
fun isOkOrHealthy(status: String): Boolean =
    when (status.trim().lowercase(Locale.ROOT)) {
        STATUS_OK, STATUS_HEALTHY -> true
        else -> false
    }

/**
 * The parsed, still-framework-free system-health snapshot — the native analogue of the web `SystemHealth`
 * object the `useSystemHealth` query resolves. Built from the raw, verbatim server JSON the shared
 * AdminStore carries (snake_case on the wire), so the parse mirrors the Go `/system/health` response
 * shape rather than the web's post-`camelCaseKeys` view.
 *
 * @property overallStatus the top-level `status` (web `data?.status ?? 'unknown'`).
 * @property componentStatuses each component key → its `status` string (web `data?.components ?? {}`).
 * @property databaseSize the `database_size` string, or `null` when the field is absent (web `databaseSize`).
 * @property tableCount the `table_count` integer, or `null` when the field is absent (web `tableCount`).
 */
data class UptimeHealth(
    val overallStatus: String,
    val componentStatuses: Map<String, String>,
    val databaseSize: String?,
    val tableCount: Long?,
) {
    /** The status of [key] (web `components[key]?.status ?? 'unhealthy'`). */
    fun serviceStatus(key: String): String = componentStatuses[key] ?: STATUS_UNHEALTHY

    companion object {
        /**
         * Parse the raw `/system/health` [element] into a snapshot, or `null` when it is absent / not a
         * JSON object (mirrors the web `data ? body : <EmptyState>` short-circuit — a missing payload is
         * the empty surface, never a crash). Tolerant of both the canonical snake_case wire keys and a
         * camelCase variant for the size/count fields.
         */
        fun parse(element: JsonElement?): UptimeHealth? {
            val obj = element as? JsonObject ?: return null
            val components = obj["components"] as? JsonObject
            val statuses =
                components
                    ?.mapNotNull { (key, value) ->
                        (value as? JsonObject)?.stringValue("status")?.let { key to it }
                    }?.toMap()
                    .orEmpty()
            return UptimeHealth(
                overallStatus = obj.stringValue("status") ?: STATUS_UNKNOWN,
                componentStatuses = statuses,
                databaseSize = obj.stringValue("database_size") ?: obj.stringValue("databaseSize"),
                tableCount = obj.longValue("table_count") ?: obj.longValue("tableCount"),
            )
        }

        private fun JsonObject.stringValue(key: String): String? =
            (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }

        private fun JsonObject.longValue(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
    }
}

/**
 * One projected, render-ready service row — the native analogue of one web `ServiceRow`. Pure data (no
 * Compose types): the titleized [label], the resolved [tone] (dot + badge color), and the [badgeLabel]
 * (the localized "OK" for healthy/ok, else the raw status token, web `status === 'ok' || 'healthy' ? 'OK'
 * : status`).
 */
data class UptimeServiceRow(
    val key: String,
    val label: String,
    val status: String,
    val tone: UptimeTone,
    val badgeLabel: String,
)

/**
 * The fully projected, render-ready view of the system health for one footprint — the native analogue of
 * everything the web component computes before returning JSX (the `services` memo, the `overallStatus` /
 * `healthyCount` reads, and the compact vs full vs tall branches). Pure data so the projection is
 * unit-tested without a UI host.
 *
 * @property overallBadgeLabel the overall-status badge text (web `healthy ? 'All OK' : overallStatus`).
 * @property overallTone the overall-status badge tone.
 * @property services the per-service rows (always all four, web order).
 * @property healthyCount the count of ok/healthy services (web `healthyCount`).
 * @property serviceCount the total service count (web `services.length`).
 * @property countLabel the compact `healthy/total` hero text.
 * @property databaseSize the DB-size footer value, or the em-dash (web `data.databaseSize ?? '—'`).
 * @property tableCount the table-count footer value, or the em-dash (web `data.tableCount ?? '—'`).
 * @property isCompact whether the compact hero is shown instead of the service list.
 * @property isTall whether the DB-size / table-count footer is appended.
 * @property overallContentDescription the folded TalkBack label for the overall + count summary.
 */
data class UptimeMonitorDisplay(
    val overallBadgeLabel: String,
    val overallTone: UptimeTone,
    val services: List<UptimeServiceRow>,
    val healthyCount: Int,
    val serviceCount: Int,
    val countLabel: String,
    val databaseSize: String,
    val tableCount: String,
    val isCompact: Boolean,
    val isTall: Boolean,
    val overallContentDescription: String,
)

/**
 * Localized labels the surface folds into its output — the six `widget.uptime.*` catalog keys the web
 * reads plus the per-service `ok` word (catalog `widget.ok`) and the `translation_freshness_*`-backed
 * [formatRelative] used by the header chip. The pure [UptimeMonitorProjection] reads [allOk] + [ok]; the
 * composable additionally reads [title] / [overall] / [dbSize] / [tables] / [noData] /
 * [refreshLabel] / [refreshingLabel] / [offlineLabel]. Keeping i18n out of the projection lets it stay a
 * pure, locale-stable function.
 */
data class UptimeMonitorStrings(
    val title: String,
    val overall: String,
    val allOk: String,
    val ok: String,
    val dbSize: String,
    val tables: String,
    val noData: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
)

/**
 * Pure projection from a parsed [UptimeHealth] to the render-ready [UptimeMonitorDisplay] — the native
 * port of the inline derivations in the web `UptimeMonitorWidget` (its `services` memo, `overallStatus` /
 * `healthyCount` reads, and the compact / full / tall branch selection). Side-effect-free so the gate
 * unit-tests it without a device.
 */
object UptimeMonitorProjection {
    private const val COUNT_SEPARATOR = "/"
    private const val DESC_SEPARATOR = ", "

    /** Project [health] for the localized [strings] at the given [size]. */
    fun project(
        health: UptimeHealth,
        strings: UptimeMonitorStrings,
        size: UptimeMonitorSize,
    ): UptimeMonitorDisplay {
        val services =
            SERVICE_KEYS.map { key ->
                val status = health.serviceStatus(key)
                UptimeServiceRow(
                    key = key,
                    label = titleizeServiceKey(key),
                    status = status,
                    tone = toneFor(status),
                    badgeLabel = if (isOkOrHealthy(status)) strings.ok else status,
                )
            }
        val healthyCount = services.count { isOkOrHealthy(it.status) }
        val serviceCount = services.size
        val overall = health.overallStatus
        val overallBadgeLabel = if (overall.trim().lowercase(Locale.ROOT) == STATUS_HEALTHY) strings.allOk else overall
        val countLabel = "$healthyCount$COUNT_SEPARATOR$serviceCount"
        return UptimeMonitorDisplay(
            overallBadgeLabel = overallBadgeLabel,
            overallTone = toneFor(overall),
            services = services,
            healthyCount = healthyCount,
            serviceCount = serviceCount,
            countLabel = countLabel,
            databaseSize = health.databaseSize ?: UPTIME_EM_DASH,
            tableCount = health.tableCount?.toString() ?: UPTIME_EM_DASH,
            isCompact = size.isCompact,
            isTall = size.isTall,
            overallContentDescription = "${strings.overall}$DESC_SEPARATOR$overallBadgeLabel$DESC_SEPARATOR$countLabel",
        )
    }

    /**
     * Title-case a `snake_case` service key for display — the native port of the web fallback
     * `key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())`: split on `_`, upper-case the
     * first letter of each word, leave the rest untouched (`database` → "Database", `mqtt` → "Mqtt",
     * `tesla_api` → "Tesla Api", `fleet_telemetry` → "Fleet Telemetry").
     */
    fun titleizeServiceKey(key: String): String =
        key
            .split('_')
            .joinToString(" ") { word -> word.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() } }
}
