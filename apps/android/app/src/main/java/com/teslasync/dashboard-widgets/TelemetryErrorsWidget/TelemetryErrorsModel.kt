// Pure, framework-free model + projection for the Telemetry Errors dashboard widget — the native
// analogue of everything the web component computes (the `vinList` / `errorList` / `activeVINCount`
// derivations and the `aggregated` `useMemo`) before returning JSX
// (web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/TelemetryErrorsWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package
// identifier), so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting types and `TooManyFunctions` for the projection object.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.dashboard.widgets.telemetryerrors

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

/** The em-dash shown wherever a value is unknown (matches the shared formatter fallback). */
internal const val TELEMETRY_ERRORS_EM_DASH: String = "\u2014"

/** Multiplication sign prefixing an occurrence count (web `×{fmtInt(count)}`). */
internal const val TELEMETRY_ERRORS_TIMES: String = "\u00d7"

/** The literal key fragment the web aggregation uses for a missing `error_code` (`?? 'unknown'`). */
private const val UNKNOWN_CODE_KEY: String = "unknown"

/** A datum is "recent" when seen within this window (web `ONE_HOUR_MS`). */
internal const val TELEMETRY_ERRORS_ONE_HOUR_MS: Long = 60L * 60L * 1000L

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact = size.cols <= 1` branch in the web source: a single column renders the compact
 * count-and-status hero; two or more columns render the standard header-stats + scrollable error feed.
 */
data class TelemetryErrorsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1

        /** Registry default footprint (2×4). */
        val Default: TelemetryErrorsSize = TelemetryErrorsSize(cols = 2, rows = 4)

        /** Registry minimum footprint (1×2). */
        val MinSize: TelemetryErrorsSize = TelemetryErrorsSize(cols = 1, rows = 2)

        /** Registry maximum footprint (4×40). */
        val MaxSize: TelemetryErrorsSize = TelemetryErrorsSize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: TelemetryErrorsSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: TelemetryErrorsSize): TelemetryErrorsSize =
            TelemetryErrorsSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/system.ts. A dashboard grid host binds this surface
 * with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object TelemetryErrorsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "telemetry-errors"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TelemetryErrorsWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: TelemetryErrorsSize get() = TelemetryErrorsSize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: TelemetryErrorsSize get() = TelemetryErrorsSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: TelemetryErrorsSize get() = TelemetryErrorsSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: TelemetryErrorsSize): Boolean = TelemetryErrorsSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: TelemetryErrorsSize): TelemetryErrorsSize = TelemetryErrorsSize.clamp(size)
}

/**
 * The raw, decoded inputs the widget renders — the native mirror of the web `errorVINs` + `errors`
 * query results (`vinList = errorVINs ?? []`, `errorList = errors ?? []`). Kept as the cache-then-network
 * payload so the [TelemetryErrorsSource] fold can carry both feeds through one `Resource` envelope.
 */
data class TelemetryErrorsData(
    val errorVins: List<FleetTelemetryErrorVIN>,
    val errors: List<FleetTelemetryError>,
) {
    /** True when either feed has rows (web `hasData = vinList.length > 0 || errorList.length > 0`). */
    val hasData: Boolean get() = errorVins.isNotEmpty() || errors.isNotEmpty()

    /** Vehicles with an active (unresolved) error (web `vinList.filter(v => v.active).length`). */
    val activeVinCount: Int get() = errorVins.count { it.active }

    companion object {
        /** The resolved-but-empty payload (both feeds returned no rows). */
        val EMPTY: TelemetryErrorsData = TelemetryErrorsData(emptyList(), emptyList())
    }
}

/** Fleet health status driving the header chip (web `activeVINCount > 0 ? danger/Errors : success/Healthy`). */
enum class TelemetryErrorsStatus { Errors, Healthy }

/**
 * The localized strings the projection folds into its output, resolved from the P1/S10 i18n catalog at
 * the Compose boundary (`stringResource`) and passed in so [TelemetryErrorsProjection.project] stays
 * pure and JVM-testable. Keys mirror the web `t('widget.telemetryErrors.*')` calls verbatim.
 *
 * @property unknown the `error_code` fallback (web `t('widget.telemetryErrors.unknown','Unknown')`).
 * @property justNow the <1m relative-time word (shared `translation_freshness_justNow`).
 * @property ago the relative-time suffix (web/shared `translation_widget_ago`).
 */
data class TelemetryErrorsLabels(
    val unknown: String,
    val justNow: String,
    val ago: String,
)

/**
 * One projected, render-ready aggregated error row — the native analogue of a web `aggregated[]`
 * entry. Pure data (no Compose types): the [vin], the already-resolved [errorCode] (with the localized
 * "Unknown" fallback applied), the occurrence [count] + its formatted [countText], whether it was seen
 * within the last hour ([isRecent], web `isRecent`), and the already-localized relative [lastSeenText].
 */
data class TelemetryErrorRow(
    val key: String,
    val vin: String,
    val errorCode: String,
    val count: Int,
    val countText: String,
    val isRecent: Boolean,
    val lastSeenText: String,
    val lastSeenMillis: Long?,
)

/**
 * The fully projected, render-ready view of the telemetry-error payload for one footprint — the native
 * analogue of everything the web component computes before returning JSX. Pure data so the projection
 * is unit-tested without a UI host.
 */
data class TelemetryErrorsDisplay(
    val isCompact: Boolean,
    val hasData: Boolean,
    val activeVinCount: Int,
    val activeVinCountText: String,
    val status: TelemetryErrorsStatus,
    val rows: List<TelemetryErrorRow>,
)

/**
 * Pure projection from a decoded [TelemetryErrorsData] to the [TelemetryErrorsDisplay] — the native
 * port of the `activeVINCount` / `statusBadge` / `statusLabel` derivations and the `aggregated`
 * `useMemo` (group by `vin::error_code`, count, max `last_seen`, newest-first) in the web source.
 * [nowMillis] is the clock the recent/relative-time math reads (injectable for deterministic tests).
 */
object TelemetryErrorsProjection {
    private const val GROUPED_INT_PATTERN = "#,##0"

    /** Project [data] for [size] using [labels] for every localized string, at the [nowMillis] clock. */
    fun project(
        data: TelemetryErrorsData,
        size: TelemetryErrorsSize,
        labels: TelemetryErrorsLabels,
        nowMillis: Long = System.currentTimeMillis(),
    ): TelemetryErrorsDisplay {
        val activeVinCount = data.activeVinCount
        return TelemetryErrorsDisplay(
            isCompact = size.isCompact,
            hasData = data.hasData,
            activeVinCount = activeVinCount,
            activeVinCountText = formatInt(activeVinCount),
            status = if (activeVinCount > 0) TelemetryErrorsStatus.Errors else TelemetryErrorsStatus.Healthy,
            rows = aggregate(data.errors, labels, nowMillis),
        )
    }

    /**
     * Group [errors] by `vin` + `error_code`, count occurrences, track the most-recent `last_seen`
     * timestamp, then emit display rows sorted newest-first (rows with no timestamp last) — a 1:1 port
     * of the web `aggregated` `useMemo`. The grouping key uses the literal `unknown` fragment for a
     * missing code (web key), while the display [TelemetryErrorRow.errorCode] uses [labels].unknown.
     */
    fun aggregate(
        errors: List<FleetTelemetryError>,
        labels: TelemetryErrorsLabels,
        nowMillis: Long,
    ): List<TelemetryErrorRow> {
        val groups = LinkedHashMap<String, ErrorAccumulator>()
        for (error in errors) {
            val rawCode = error.errorCode
            val key = error.vin + "::" + (rawCode ?: UNKNOWN_CODE_KEY)
            val stamp = parseTimestampMillis(error.reportedAt ?: error.fetchedAt)
            val existing = groups[key]
            if (existing == null) {
                groups[key] =
                    ErrorAccumulator(
                        vin = error.vin,
                        displayCode = rawCode ?: labels.unknown,
                        count = 1,
                        lastSeenMillis = stamp,
                    )
            } else {
                existing.count += 1
                existing.lastSeenMillis = laterOf(existing.lastSeenMillis, stamp)
            }
        }
        return groups.entries
            .sortedByDescending { it.value.lastSeenMillis ?: Long.MIN_VALUE }
            .map { (key, acc) -> rowOf(key, acc, labels, nowMillis) }
    }

    /**
     * The localized relative-time label for a [millis] timestamp — reuses the shared, tested
     * [relativeAge] bucketing (whose <1m / <1h / <24h cutoffs match the web `TimeStamp`). The i18n
     * words are injected so this stays pure + unit-testable.
     */
    fun relativeLabel(
        millis: Long?,
        nowMillis: Long,
        labels: TelemetryErrorsLabels,
    ): String =
        when (val age = relativeAge(computeAgeSeconds(millis, nowMillis))) {
            FreshnessAge.Unknown -> TELEMETRY_ERRORS_EM_DASH
            FreshnessAge.JustNow -> labels.justNow
            is FreshnessAge.Seconds -> labels.justNow
            is FreshnessAge.Minutes -> "${age.value}m ${labels.ago}"
            is FreshnessAge.Hours -> "${age.value}h ${labels.ago}"
            is FreshnessAge.Days -> "${age.value}d ${labels.ago}"
            is FreshnessAge.Weeks -> "${age.value}w ${labels.ago}"
        }

    /** True when [millis] is within the last hour of [nowMillis] (web `now - time < ONE_HOUR_MS`). */
    fun isRecent(
        millis: Long?,
        nowMillis: Long,
    ): Boolean = millis != null && nowMillis - millis < TELEMETRY_ERRORS_ONE_HOUR_MS

    /**
     * Parse a `reported_at` / `fetched_at` wire string to epoch millis (tolerant of a `Z` suffix, an
     * explicit offset, or no zone), or `null` when absent / unparseable.
     */
    fun parseTimestampMillis(raw: String?): Long? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
    }

    /** Locale-stable integer formatter (web `fmtInt`): grouped thousands, no fraction digits. */
    fun formatInt(value: Int): String = DecimalFormat(GROUPED_INT_PATTERN, DecimalFormatSymbols(Locale.US)).format(value.toLong())

    private fun laterOf(
        a: Long?,
        b: Long?,
    ): Long? =
        when {
            a == null -> b
            b == null -> a
            else -> maxOf(a, b)
        }

    private fun rowOf(
        key: String,
        acc: ErrorAccumulator,
        labels: TelemetryErrorsLabels,
        nowMillis: Long,
    ): TelemetryErrorRow =
        TelemetryErrorRow(
            key = key,
            vin = acc.vin,
            errorCode = acc.displayCode,
            count = acc.count,
            countText = TELEMETRY_ERRORS_TIMES + formatInt(acc.count),
            isRecent = isRecent(acc.lastSeenMillis, nowMillis),
            lastSeenText = relativeLabel(acc.lastSeenMillis, nowMillis, labels),
            lastSeenMillis = acc.lastSeenMillis,
        )

    private class ErrorAccumulator(
        val vin: String,
        val displayCode: String,
        var count: Int,
        var lastSeenMillis: Long?,
    )
}

/**
 * The TalkBack description for an aggregated error row — `"{vin}, {errorCode}, {countText}[, recent],
 * {lastSeen}"`. Pure so label presence is unit-tested off-device (the render layer applies it via
 * `semantics`). [recentLabel] is the localized "recent" word, appended only when [TelemetryErrorRow.isRecent].
 */
fun telemetryErrorRowDescription(
    row: TelemetryErrorRow,
    recentLabel: String,
): String =
    buildString {
        append(row.vin)
        append(", ")
        append(row.errorCode)
        append(", ")
        append(row.countText)
        if (row.isRecent) {
            append(", ")
            append(recentLabel)
        }
        append(", ")
        append(row.lastSeenText)
    }
