// Pure, framework-free model + projection for the Version Info dashboard widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/VersionInfoWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// Both feeds arrive as the canonical S8 typed payloads (VersionInfo / CaptureStats); the
// [VersionInfoSource] binding re-encodes each to its JSON form so this projection can read the web
// component's exact field set verbatim. The web reads `version.data` and `capture.data` as untyped bags via
// `as Record<string, unknown>`, pulling several fields that lie OUTSIDE the typed contract: `build_date`,
// `git_commit`, `uptime` (off /system/version — internal/api/system/handler.go emits chart_version /
// go_version / os / arch / uptime_seconds, NOT those three) and `signals_per_sec`, `messages_today`,
// `bytes_processed`, `avg_processing_latency_ms` (off /dev-tools/telemetry-capture/stats — which emits
// mongodb_enabled / total_documents / distinct_vins). Against the live server every such read collapses to
// the web `?? '—'` / `?? 0`, so reading the same snake_case names here reproduces that rendered surface
// exactly and lights up automatically if the contract ever grows the field.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/VersionInfoWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.versioninfo

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale

private const val EM_DASH = "\u2014"

/** Git commit prefix length the web renders (`gitSha?.slice(0, 7)`). */
private const val GIT_SHA_LENGTH = 7

/** Throughput / latency render with one fraction digit (web `fmtNumber(x, 1)`). */
private const val ONE_DECIMAL = 1

/** Gigabyte byte-scaling render with two fraction digits (web `fmtNumber(x / 1024^3, 2)`). */
private const val TWO_DECIMALS = 2

/** Binary byte-scaling thresholds — the web inline `formatBytes` ladder (1024 / 1024^2 / 1024^3). */
private const val KIB = 1024.0
private const val MIB = KIB * 1024.0
private const val GIB = MIB * 1024.0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`.
 * [isCompact] reproduces the web `size.cols <= 1` branch (centered version + SHA badge only); [isWide]
 * reproduces `size.cols >= 4` (the OS/Arch line + the four-tile stat grid).
 */
data class VersionInfoSize(
    val cols: Int,
    val rows: Int,
) {
    /** Web `size.cols <= 1`: drop the title/list/grid and render the bare version + SHA badge. */
    val isCompact: Boolean get() = cols <= 1

    /** Web `size.cols >= 4`: add the OS/Arch line and the two extra stat tiles (4-up grid). */
    val isWide: Boolean get() = cols >= WIDE_COLS

    private companion object {
        const val WIDE_COLS = 4
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/system.ts (`version-info`). A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object VersionInfoRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "version-info"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "VersionInfoWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val defaultSize = VersionInfoSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = VersionInfoSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = VersionInfoSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: VersionInfoSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: VersionInfoSize): VersionInfoSize =
        VersionInfoSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Localized labels the surface folds into its output — the thirteen web `t('widget.versionInfo.…')` keys.
 * The pure [VersionInfoProjection] reads these to assemble each row/tile; the composable builds this from
 * `stringResource`, while tests pass a deterministic instance. Keeping i18n out of the projection lets it
 * stay a pure, locale-stable function.
 */
data class VersionInfoStrings(
    val title: String,
    val version: String,
    val buildDate: String,
    val gitSha: String,
    val goVersion: String,
    val uptime: String,
    val signalsPerSec: String,
    val messagesToday: String,
    val bytesProcessed: String,
    val avgLatency: String,
    val os: String,
    val arch: String,
    val noData: String,
)

/**
 * The version detail the widget reads off `version.data` — the native analogue of the web's untyped reads.
 * Every field is nullable so an absent wire key collapses to the em-dash exactly like the web `?? '—'`.
 * [gitSha] is already truncated to the leading [GIT_SHA_LENGTH] characters (web `gitSha?.slice(0, 7)`).
 */
data class VersionFields(
    val chartVersion: String?,
    val buildDate: String?,
    val gitSha: String?,
    val goVersion: String?,
    val uptime: String?,
    val os: String?,
    val arch: String?,
)

/**
 * The capture throughput the widget reads off `capture.data` — the native analogue of the four web reads,
 * each defaulting to zero (web `?? 0`). Absent on the live `/dev-tools/telemetry-capture/stats` contract,
 * so these resolve to [ZERO] in practice; reading the web's field names keeps it forward-compatible.
 */
data class CaptureFields(
    val signalsPerSec: Double,
    val messagesToday: Long,
    val bytesProcessed: Long,
    val avgLatencyMs: Double,
) {
    companion object {
        /** The all-zero capture view (web `?? 0` for every figure). */
        val ZERO = CaptureFields(signalsPerSec = 0.0, messagesToday = 0L, bytesProcessed = 0L, avgLatencyMs = 0.0)
    }
}

/**
 * The combined state the widget composes — the native analogue of the web `version` + `capture` hooks.
 * [version] is `null` only when there is no version payload to render (web `version.data == null` ⇒ the
 * "No version data available" empty state); [capture] is best-effort and never gates the surface (web reads
 * `capture.data` opportunistically with `?? 0`, and the shell's loading/error/empty all key off `version`).
 */
data class VersionInfoState(
    val version: VersionFields?,
    val capture: CaptureFields,
) {
    /** Web `hasData = version.data != null` — there is a version payload to render. */
    val hasVersion: Boolean get() = version != null
}

/** Emphasis the value cell renders with — bold version, monospace SHA, otherwise plain body (web spans). */
enum class ValueEmphasis { Normal, Bold, Mono }

/** One projected definition-list row (web `KVList` item): a [label], a formatted [value], its [emphasis]. */
data class VersionKvRow(
    val label: String,
    val value: String,
    val emphasis: ValueEmphasis,
)

/** One projected stat tile (web `WidgetStatGrid` item): a [label] and an already-formatted [value]. */
data class VersionStat(
    val label: String,
    val value: String,
)

/**
 * The fully projected, render-ready view for one footprint — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host. [kvItems] is the five-row definition list; [statItems] is the two (standard) or four
 * (wide) stat tiles; [compactVersion]/[compactSha] back the 1×2 centered layout; [osText]/[archText] are the
 * wide-only OS/Arch line (`null` otherwise); [contentDescription] folds the list + tiles into one TalkBack
 * phrase for off-device assertion.
 */
data class VersionInfoDisplay(
    val kvItems: List<VersionKvRow>,
    val statItems: List<VersionStat>,
    val compactVersion: String,
    val compactSha: String,
    val osText: String?,
    val archText: String?,
    val contentDescription: String,
)

/**
 * Pure projection from the decoded feeds to the render-ready [VersionInfoDisplay] — the native port of the
 * inline `useMemo` row/stat building the web component performs before returning JSX. Numbers reproduce the
 * web `fmtNumber`/`fmtInt` display contract via the shared [ChartFormat.number] ([locale] drives the
 * grouping/separators — tests pin [Locale.US]).
 */
object VersionInfoProjection {
    /**
     * Decodes the re-encoded `version.data` [json] into [VersionFields], or `null` when there is no object
     * to render (web `version.data == null` ⇒ the empty state). A present object — even an empty one — yields
     * fields whose missing keys collapse to `null`, exactly like the web reading `chart_version` off a sparse
     * object. [VersionFields.gitSha] is pre-truncated to the leading [GIT_SHA_LENGTH] characters.
     */
    fun parseVersion(json: JsonElement?): VersionFields? {
        val obj = json as? JsonObject ?: return null
        return VersionFields(
            chartVersion = obj.stringField("chart_version"),
            buildDate = obj.stringField("build_date"),
            gitSha = obj.stringField("git_commit")?.take(GIT_SHA_LENGTH),
            goVersion = obj.stringField("go_version"),
            uptime = obj.stringField("uptime"),
            os = obj.stringField("os"),
            arch = obj.stringField("arch"),
        )
    }

    /**
     * Decodes the re-encoded `capture.data` [json] into [CaptureFields]. A `null`/absent payload (the feed
     * still loading, or no stats at all) yields [CaptureFields.ZERO]; every figure defaults to zero when its
     * key is absent (web `?? 0`).
     */
    fun parseCapture(json: JsonElement?): CaptureFields {
        val obj = json as? JsonObject ?: return CaptureFields.ZERO
        return CaptureFields(
            signalsPerSec = obj.doubleField("signals_per_sec") ?: 0.0,
            messagesToday = obj.longField("messages_today") ?: 0L,
            bytesProcessed = obj.longField("bytes_processed") ?: 0L,
            avgLatencyMs = obj.doubleField("avg_processing_latency_ms") ?: 0.0,
        )
    }

    /**
     * Projects [version] + [capture] for the [size] footprint using the localized [strings]. Mirrors the web
     * `kvItems`/`statItems` `useMemo`s: the five-row list is constant; the stat grid carries the two base
     * tiles and, when [VersionInfoSize.isWide], the two extra tiles (bytes processed + avg latency); the
     * OS/Arch line and its content also surface only when wide.
     */
    fun project(
        version: VersionFields,
        capture: CaptureFields,
        strings: VersionInfoStrings,
        size: VersionInfoSize,
        locale: Locale = Locale.US,
    ): VersionInfoDisplay {
        val chartVersion = version.chartVersion ?: EM_DASH
        val sha = version.gitSha ?: EM_DASH
        val kvItems =
            listOf(
                VersionKvRow(strings.version, chartVersion, ValueEmphasis.Bold),
                VersionKvRow(strings.buildDate, version.buildDate ?: EM_DASH, ValueEmphasis.Normal),
                VersionKvRow(strings.gitSha, sha, ValueEmphasis.Mono),
                VersionKvRow(strings.goVersion, version.goVersion ?: EM_DASH, ValueEmphasis.Normal),
                VersionKvRow(strings.uptime, version.uptime ?: EM_DASH, ValueEmphasis.Normal),
            )
        val statItems = statItems(capture, strings, size, locale)
        val osText = if (size.isWide) "${strings.os}: ${version.os ?: EM_DASH}" else null
        val archText = if (size.isWide) "${strings.arch}: ${version.arch ?: EM_DASH}" else null
        return VersionInfoDisplay(
            kvItems = kvItems,
            statItems = statItems,
            compactVersion = chartVersion,
            compactSha = sha,
            osText = osText,
            archText = archText,
            contentDescription = contentDescription(kvItems, statItems, osText, archText),
        )
    }

    /**
     * The stat tiles (web `statItems`): Signals/sec (one decimal) + Messages Today (integer) always, plus —
     * when [VersionInfoSize.isWide] — Bytes Processed (binary scaled) + Avg Latency (one decimal, ` ms`).
     */
    fun statItems(
        capture: CaptureFields,
        strings: VersionInfoStrings,
        size: VersionInfoSize,
        locale: Locale = Locale.US,
    ): List<VersionStat> =
        buildList {
            add(VersionStat(strings.signalsPerSec, ChartFormat.number(capture.signalsPerSec, ONE_DECIMAL, locale)))
            add(VersionStat(strings.messagesToday, String.format(locale, "%,d", capture.messagesToday)))
            if (size.isWide) {
                add(VersionStat(strings.bytesProcessed, formatBytes(capture.bytesProcessed, locale)))
                add(VersionStat(strings.avgLatency, "${ChartFormat.number(capture.avgLatencyMs, ONE_DECIMAL, locale)} ms"))
            }
        }

    /**
     * Human-readable byte count with binary units — the native port of the web component's inline
     * `formatBytes`: `< 1 KiB` integer bytes, then KB/MB at one decimal and GB at two decimals.
     */
    fun formatBytes(
        bytes: Long,
        locale: Locale = Locale.US,
    ): String =
        when {
            bytes < KIB -> "${String.format(locale, "%,d", bytes)} B"
            bytes < MIB -> "${ChartFormat.number(bytes / KIB, ONE_DECIMAL, locale)} KB"
            bytes < GIB -> "${ChartFormat.number(bytes / MIB, ONE_DECIMAL, locale)} MB"
            else -> "${ChartFormat.number(bytes / GIB, TWO_DECIMALS, locale)} GB"
        }

    private fun contentDescription(
        kvItems: List<VersionKvRow>,
        statItems: List<VersionStat>,
        osText: String?,
        archText: String?,
    ): String {
        val rows = kvItems.map { "${it.label} ${it.value}" }
        val stats = statItems.map { "${it.label} ${it.value}" }
        val tail = listOfNotNull(osText, archText)
        return (rows + stats + tail).joinToString(", ")
    }
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
