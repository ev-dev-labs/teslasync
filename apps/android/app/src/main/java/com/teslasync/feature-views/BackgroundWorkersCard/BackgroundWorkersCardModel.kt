// Pure, framework-free model + projection for the BackgroundWorkersCard feature view — the native analogue of
// every value the web component derives before returning JSX
// (web/src/features/system/components/status/BackgroundWorkersCard.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// BackgroundWorkersCard is an operator-grade, per-instance worker-visibility panel. The web component takes a
// `WorkersHealth` (one row per worker `name`, or one row per host when a worker is horizontally scaled) as a
// prop, so this surface binds no data hook of its own (the web component uses none). As in the sibling
// AcDcStatsPanel port, the cache-then-network lifecycle (loading / error / stale / offline) is supplied by the
// owning host through the shared P1/S8 state-holder layer as a [io.teslasync.android.data.UiState]; the
// composable renders every state that layer can carry without ever fetching. This pure file owns the parts the
// web render derives from `health`:
//   • grouping the rows by worker `name` (web `groupByName`), preserving the per-group instance list;
//   • the per-group rollup `healthy / total` count and the rollup [GroupSeverity] (web: all-healthy ⇒ healthy,
//     all-down ⇒ down, otherwise degraded);
//   • the two-axis top-line summary — worker types vs. instances — plus the replicated-group count
//     (web `groupCount` / `totalInstances` / `healthyGroups` / `healthyInstances` / `multiInstanceGroups`);
//   • the readable short host (web `shortHost`: strip `http(s)://` + trailing `/healthz`);
//   • the per-instance latency formatter (web `fmtLatency`: `—` for a missing/non-finite value, else `N ms`);
//   • the scale-hint visibility (web `multiInstanceGroups === 0`).
//
// `ms` is an international SI-derived unit symbol kept as a code constant, exactly as the sibling AcDcStatsPanel
// port keeps `kWh`/`MWh`/`%`. Counts are interpolated as raw digits (web template literals do not group/localize
// them), so the formatter matches the web output byte-for-byte.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BackgroundWorkersCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AcDcStatsPanel surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backgroundworkerscard

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.roundToLong

/** Em dash shown wherever a value is unknown/absent — the web `—` (`fmtLatency` fallback). */
internal const val EM_DASH: String = ChartFormat.EMPTY

/**
 * Health of one worker instance — the native mirror of the web `WorkerStatus['status']` union
 * (`'healthy' | 'unhealthy' | 'down'`). [fromWire] reproduces the web `instanceClasses` mapping: an explicit
 * `unhealthy` maps to [Unhealthy], everything else (`down` and any unexpected value) maps to [Down].
 */
enum class WorkerInstanceStatus {
    Healthy,
    Unhealthy,
    Down,
    ;

    companion object {
        /** Parses a wire status string — web `instanceClasses` (healthy / unhealthy / else ⇒ down). */
        fun fromWire(raw: String?): WorkerInstanceStatus =
            when (raw?.trim()?.lowercase(Locale.ROOT)) {
                "healthy" -> Healthy
                "unhealthy" -> Unhealthy
                else -> Down
            }
    }
}

/**
 * Rollup health of a worker group (1..N instances of the same `name`) — the native mirror of the web
 * `Severity`. [Unknown] exists only for completeness (the web `severityClasses` switch has it as the default);
 * [WorkersProjection.groupByName] never produces it, since every group has at least one instance.
 */
enum class GroupSeverity { Healthy, Degraded, Down, Unknown }

/**
 * One worker instance row — the native mirror of the web `WorkerStatus`. Every field defaults so a partial row
 * is valid; [latencyMs] is nullable (the web `latency_ms` is defensively treated as possibly missing) and
 * [error] is `null` when the probe succeeded.
 *
 * @property name the worker type name (web `name`); the grouping key.
 * @property host the probe URL (web `host`), shown shortened via [WorkersProjection.shortHost].
 * @property status the instance health (web `status`).
 * @property latencyMs the probe latency in milliseconds, or `null`/non-finite ⇒ em-dash (web `latency_ms`).
 * @property error the probe error message (HTTP code or dial error), or `null` when healthy (web `error`).
 */
data class WorkerInstance(
    val name: String,
    val host: String,
    val status: WorkerInstanceStatus = WorkerInstanceStatus.Down,
    val latencyMs: Double? = null,
    val error: String? = null,
)

/**
 * The health payload the card renders — the native mirror of the subset of the web `WorkersHealth` the card
 * actually reads. The web card recomputes its instance/type counts from `workers` and never reads the server's
 * `total` / `healthy_count`, so only [workers] is modeled here (the host adapter maps the full wire payload).
 */
data class WorkersHealthData(
    val workers: List<WorkerInstance> = emptyList(),
)

/**
 * A worker group — one `name` and its 1..N instances — the native mirror of the web `WorkerGroup`. [healthy] is
 * the count of healthy instances; [severity] is the rollup. Pure data so the projection is unit-tested without a
 * UI host.
 */
data class WorkerGroup(
    val name: String,
    val instances: List<WorkerInstance>,
    val healthy: Int,
    val total: Int,
    val severity: GroupSeverity,
) {
    /** Whether this worker type is horizontally scaled — web `g.total > 1`. */
    val isMultiInstance: Boolean get() = total > 1
}

/**
 * The two-axis top-line summary — the native mirror of the web `groupCount` / `totalInstances` /
 * `healthyGroups` / `healthyInstances` / `multiInstanceGroups`. The types-vs-instances split is the key
 * differentiator for horizontally-scaled deployments.
 */
data class WorkersSummary(
    val healthyGroups: Int,
    val groupCount: Int,
    val healthyInstances: Int,
    val totalInstances: Int,
    val multiInstanceGroups: Int,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property groups the worker groups, sorted by `name` (web `out.sort(a.name.localeCompare(b.name))`).
 * @property summary the two-axis top-line counts.
 */
data class WorkersDisplay(
    val groups: List<WorkerGroup>,
    val summary: WorkersSummary,
) {
    /**
     * True when no workers are reporting. The composable renders the friendly empty state in this case so the
     * panel is never a blank box (web `!health || workers.length === 0`).
     */
    val isEmpty: Boolean get() = groups.isEmpty()

    /** Whether to show the "set *_HOSTS to scale" callout — web `multiInstanceGroups === 0`. */
    val showScaleHint: Boolean get() = summary.multiInstanceGroups == 0
}

/**
 * The `*_HOSTS` environment-variable names the scale-hint footer references. These are literal configuration
 * identifiers (not localizable copy), kept as constants so the hint string and any future validation share one
 * source of truth.
 */
object WorkerScaleHosts {
    const val NOTIFICATION: String = "NOTIFICATION_WORKER_HOSTS"
    const val EXPORT: String = "EXPORT_WORKER_HOSTS"
    const val AUTOMATION: String = "AUTOMATION_WORKER_HOSTS"
}

/**
 * Pure projection from a [WorkersHealthData] to its render-ready [WorkersDisplay] plus the host/latency
 * formatters the web component applies inline — a 1:1 port of the web `groupByName`, the summary derivations,
 * `shortHost`, and `fmtLatency`. Stateless and side-effect-free so it is fully covered by the off-device unit
 * gate.
 */
object WorkersProjection {
    /** Milliseconds unit symbol (web literal `' ms'`) — an SI-derived symbol kept as a constant. */
    const val UNIT_MS: String = "ms"

    private val SCHEME_PREFIX = Regex("^https?://")
    private val HEALTHZ_SUFFIX = Regex("/healthz/?$")

    /**
     * Groups [workers] by `name` (preserving first-seen order while grouping, then sorting by `name`), computing
     * each group's healthy count and rollup [GroupSeverity] — a 1:1 port of the web `groupByName`.
     */
    fun groupByName(workers: List<WorkerInstance>): List<WorkerGroup> {
        val grouped = LinkedHashMap<String, MutableList<WorkerInstance>>()
        for (worker in workers) {
            grouped.getOrPut(worker.name) { mutableListOf() }.add(worker)
        }
        return grouped
            .map { (name, instances) -> toGroup(name, instances) }
            .sortedBy { it.name }
    }

    private fun toGroup(
        name: String,
        instances: List<WorkerInstance>,
    ): WorkerGroup {
        val healthy = instances.count { it.status == WorkerInstanceStatus.Healthy }
        val severity =
            when {
                instances.all { it.status == WorkerInstanceStatus.Healthy } -> GroupSeverity.Healthy
                instances.all { it.status == WorkerInstanceStatus.Down } -> GroupSeverity.Down
                else -> GroupSeverity.Degraded
            }
        return WorkerGroup(
            name = name,
            instances = instances.toList(),
            healthy = healthy,
            total = instances.size,
            severity = severity,
        )
    }

    /** Projects [data] to its render-ready [WorkersDisplay], recomputing every count from `workers` (web parity). */
    fun project(data: WorkersHealthData): WorkersDisplay {
        val workers = data.workers
        val groups = groupByName(workers)
        val summary =
            WorkersSummary(
                healthyGroups = groups.count { it.severity == GroupSeverity.Healthy },
                groupCount = groups.size,
                healthyInstances = workers.count { it.status == WorkerInstanceStatus.Healthy },
                totalInstances = workers.size,
                multiInstanceGroups = groups.count { it.isMultiInstance },
            )
        return WorkersDisplay(groups = groups, summary = summary)
    }

    /**
     * Strips `http://` / `https://` and a trailing `/healthz` so the host column is readable — a 1:1 port of the
     * web `shortHost` (the full URL stays available for the tooltip / a11y).
     */
    fun shortHost(rawUrl: String): String = rawUrl.replace(SCHEME_PREFIX, "").replace(HEALTHZ_SUFFIX, "")

    /**
     * Formats a probe latency — web `fmtLatency`: `—` for a `null`/non-finite value, otherwise the rounded
     * millisecond value with the ` ms` unit. Counts are raw digits (no grouping), matching the web template.
     */
    fun formatLatency(ms: Double?): String {
        if (ms == null || !ms.isFinite()) return EM_DASH
        return "${ms.roundToLong()} $UNIT_MS"
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a host, a
 * worker name, or an error message — so a diagnostics line can never leak deployment topology.
 */
object BackgroundWorkersCardDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "background-workers-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BackgroundWorkersCard"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
