// Pure, framework-free model + projection for the EfficiencyPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/charging-list/EfficiencyPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// EfficiencyPanel is a presentational surface — the web component takes its `stats: EfficiencyStats` plus
// the implicit query state from the owning ChargingList page (which runs the TanStack query over the
// charging-session history and computes the stats via `computeEfficiencyStats`), so this surface binds no
// data hooks (its only data source is `useTranslation`). As in the sibling SummaryStatsRow/StatusHeader
// ports, the cache-then-network states (stale / offline / fetch-error) live on the owning page, not here;
// the branches this surface renders are: `loading` (skeleton tiles), `empty` (no sessions with usable data
// -> a friendly "No data available", never a blank box), and the resolved four-tile grid.
//
// The web renders four centered tiles inside an outer GlassPanel: the average wall-to-battery efficiency
// (`fmtPercent` + a progress bar clamped to 100%), the best and worst sessions (`fmtPercent` + the session's
// `formatDateTime`), and the wall-to-battery loss (`fmtWithUnit(_, 'kWh')` + a "used kWh -> added kWh"
// detail line). All numeric formatting mirrors `lib/numberFormat` (global precision 2, `safeNumber` coercion,
// locale grouping) and the date mirrors `lib/dateFormat.formatDateTime` ("Apr 4, 2026, 2:30 AM"), both with
// the locale injected so the projection is testable off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EfficiencyPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.efficiencypanel

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.min

/** The em-dash sentinel rendered for an absent / unparseable session date (web `formatDateTime` -> '—'). */
internal const val EM_DASH: String = "\u2014"

/** Unit symbol the web hardcodes on the loss tile + its detail line (`fmtWithUnit(_, 'kWh')`); units are not translated. */
internal const val ENERGY_UNIT: String = "kWh"

/** Web global decimal precision (`numberFormat._globalPrecision`); `fmtNumber`/`fmtPercent`/`fmtWithUnit` default to 2. */
private const val DEFAULT_PRECISION: Int = 2

/** A percentage is "full" at 100; the average tile's bar width is `min(avg, 100)%` (web inline style). */
private const val PERCENT_FULL: Double = 100.0

/** The rightwards arrow joining the loss detail's "used -> added" energies (web literal arrow glyph). */
private const val ARROW: String = "\u2192"

/**
 * One side of the efficiency comparison — the best or worst session. A native grouping of the only two web
 * `EfficiencyStats.best`/`.worst` fields the panel actually renders (`.efficiency` and `.date`); the web
 * object's unused `id`/`added`/`used` are intentionally omitted because the web source — THE spec — never
 * reads them in the view.
 *
 * @property efficiency the session's wall-to-battery efficiency value (web `best.efficiency`), rendered via
 *   [EfficiencyPanelProjection.formatPercent].
 * @property date the session's ISO-8601 start timestamp (web `best.date`), or `null`; rendered via
 *   [EfficiencyPanelProjection.formatDateTime] which falls back to [EM_DASH].
 */
data class EfficiencySession(
    val efficiency: Double,
    val date: String?,
)

/**
 * The lifetime efficiency statistics the owning ChargingList page computes and threads into this surface —
 * the native analogue of the web `EfficiencyStats` (charging-list `helpers.ts`). Presentational only; the
 * page owns the query and the `computeEfficiencyStats` derivation.
 *
 * @property avgEfficiency mean wall-to-battery efficiency across sessions with data (web `avgEfficiency`).
 * @property best the most efficient session (web `best`).
 * @property worst the least efficient session (web `worst`).
 * @property wallLoss total wall-to-battery energy loss (web `wallLoss`), rendered with the [ENERGY_UNIT] suffix.
 * @property totalUsed total energy drawn from the wall (web `totalUsed`); the left side of the loss detail.
 * @property totalAdded total energy added to the battery (web `totalAdded`); the right side of the loss detail.
 * @property count number of sessions with usable data (web `count`); shown in the header hint and gates [empty].
 */
data class EfficiencyStats(
    val avgEfficiency: Double,
    val best: EfficiencySession,
    val worst: EfficiencySession,
    val wallLoss: Double,
    val totalUsed: Double,
    val totalAdded: Double,
    val count: Int,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host, and
 * each variant is exactly one of the surface's render branches.
 */
sealed interface EfficiencyPanelDisplay {
    /** The owning query is still in flight (web's implicit `isLoading`); the tile grid shows skeleton chrome. */
    data object Loading : EfficiencyPanelDisplay

    /** Data resolved but no session carries usable efficiency data (web `computeEfficiencyStats` -> null). */
    data object Empty : EfficiencyPanelDisplay

    /**
     * The resolved four-tile grid — every value pre-formatted so the composable resolves only i18n labels +
     * design tokens. Mirrors the web tiles 1:1.
     *
     * @property sessionCount the header hint's session count (web `stats.count`), rendered as a bare integer.
     * @property averageEfficiency web tile 1 value — `fmtPercent(avgEfficiency)`.
     * @property averageBarFraction web tile 1 bar width — `min(avgEfficiency, 100) / 100`, clamped to 0..1.
     * @property bestEfficiency web tile 2 value — `fmtPercent(best.efficiency)`.
     * @property bestDate web tile 2 subline — `formatDateTime(best.date)` (or [EM_DASH]).
     * @property worstEfficiency web tile 3 value — `fmtPercent(worst.efficiency)`.
     * @property worstDate web tile 3 subline — `formatDateTime(worst.date)` (or [EM_DASH]).
     * @property wallLoss web tile 4 value — `fmtWithUnit(wallLoss, 'kWh')`.
     * @property wallLossDetail web tile 4 subline — `fmtNumber(totalUsed) kWh -> fmtNumber(totalAdded) kWh`.
     */
    data class Resolved(
        val sessionCount: Int,
        val averageEfficiency: String,
        val averageBarFraction: Float,
        val bestEfficiency: String,
        val bestDate: String,
        val worstEfficiency: String,
        val worstDate: String,
        val wallLoss: String,
        val wallLossDetail: String,
    ) : EfficiencyPanelDisplay
}

/**
 * Pure projection from the surface's inputs to its render-ready [EfficiencyPanelDisplay] — a 1:1 port of the
 * derivations the web component performs. Number formatting mirrors `lib/numberFormat` (precision 2,
 * `safeNumber` coercion, locale grouping, half-up rounding to match `Intl.NumberFormat`'s default
 * "halfExpand"); the date mirrors `lib/dateFormat.formatDateTime`. The locale + zone are injected so previews
 * and tests stay deterministic.
 */
object EfficiencyPanelProjection {
    /**
     * Select the render-ready view for the given [stats] and [loading] flag. Returns
     * [EfficiencyPanelDisplay.Empty] when the page resolved no usable stats (`stats == null`) or zero
     * sessions with data (web `computeEfficiencyStats` returns null in both cases, so the parent renders
     * nothing — we render a friendly empty state instead of a blank box). [locale] drives number/date
     * formatting and [zoneId] the date's wall-clock, mirroring the web's locale-aware `toLocaleString`.
     */
    fun project(
        stats: EfficiencyStats?,
        loading: Boolean,
        locale: Locale,
        zoneId: ZoneId,
    ): EfficiencyPanelDisplay =
        when {
            loading -> EfficiencyPanelDisplay.Loading
            stats == null || stats.count <= 0 -> EfficiencyPanelDisplay.Empty
            else ->
                EfficiencyPanelDisplay.Resolved(
                    sessionCount = stats.count,
                    averageEfficiency = formatPercent(stats.avgEfficiency, locale),
                    averageBarFraction = barFraction(stats.avgEfficiency),
                    bestEfficiency = formatPercent(stats.best.efficiency, locale),
                    bestDate = formatDateTime(stats.best.date, locale, zoneId),
                    worstEfficiency = formatPercent(stats.worst.efficiency, locale),
                    worstDate = formatDateTime(stats.worst.date, locale, zoneId),
                    wallLoss = formatWithUnit(stats.wallLoss, ENERGY_UNIT, locale),
                    wallLossDetail = wallLossDetail(stats.totalUsed, stats.totalAdded, locale),
                )
        }

    /**
     * Format a number the way the web `fmtNumber(v)` does: a non-finite value is coerced to 0 (`safeNumber`),
     * then rendered at the global precision (2) with locale grouping separators. HALF_UP matches
     * `Number.prototype.toLocaleString`'s default "halfExpand" rounding so 85.435 renders "85.44" on both
     * platforms rather than diverging on banker's rounding.
     */
    fun formatNumber(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = DEFAULT_PRECISION
                maximumFractionDigits = DEFAULT_PRECISION
                roundingMode = RoundingMode.HALF_UP
            }
        return formatter.format(safe)
    }

    /** Web `fmtPercent(v)` — `fmtNumber(v)` with a trailing percent sign. */
    fun formatPercent(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = formatNumber(value, locale) + "%"

    /** Web `fmtWithUnit(v, unit)` — `fmtNumber(v)` followed by a space and the [unit] symbol. */
    fun formatWithUnit(
        value: Double,
        unit: String,
        locale: Locale = Locale.getDefault(),
    ): String = formatNumber(value, locale) + " " + unit

    /** Web loss detail — `fmtNumber(used) kWh -> fmtNumber(added) kWh`, with single spaces around the arrow. */
    fun wallLossDetail(
        used: Double,
        added: Double,
        locale: Locale = Locale.getDefault(),
    ): String = formatWithUnit(used, ENERGY_UNIT, locale) + " " + ARROW + " " + formatWithUnit(added, ENERGY_UNIT, locale)

    /**
     * The average tile's progress-bar fill fraction — a port of the web inline `width: min(avg, 100)%`.
     * A non-finite average is coerced to 0; the result is divided by 100 and clamped to 0..1 (the browser
     * clamps an out-of-range CSS width to the track, so a negative or >100 average maps to 0 or a full bar).
     */
    fun barFraction(avgEfficiency: Double): Float {
        val safe = if (avgEfficiency.isFinite()) avgEfficiency else 0.0
        return (min(safe, PERCENT_FULL) / PERCENT_FULL).toFloat().coerceIn(0f, 1f)
    }

    /**
     * Parse an ISO-8601 timestamp to epoch millis the way the web `new Date(iso).getTime()` does, returning
     * `null` for a blank, missing, or unparseable value (the web treats `NaN` the same way once it reaches
     * the "—" fall-through). Tolerates the three RFC-3339 shapes the backend emits: a `Z`-suffixed instant,
     * an explicit numeric offset, and a zoned date-time.
     */
    fun parseIsoMillis(iso: String?): Long? {
        val raw = iso?.trim()
        if (raw.isNullOrEmpty()) return null
        return runCatching { Instant.parse(raw).toEpochMilli() }
            .recoverCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
            .recoverCatching { ZonedDateTime.parse(raw).toInstant().toEpochMilli() }
            .getOrNull()
    }

    /**
     * Format a session timestamp the way the web `formatDateTime(iso)` does — a localized
     * medium-date + short-time string ("Apr 4, 2026, 2:30 AM") in the target [zoneId], falling back to
     * [EM_DASH] for a missing or unparseable value. Locale-aware (no hardcoded pattern) so the rendering
     * tracks the device locale exactly as the web's `toLocaleString` tracks the browser locale.
     */
    fun formatDateTime(
        iso: String?,
        locale: Locale,
        zoneId: ZoneId,
    ): String =
        parseIsoMillis(iso)?.let { millis ->
            Instant
                .ofEpochMilli(millis)
                .atZone(zoneId)
                .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale))
        } ?: EM_DASH

    /**
     * Build the merged TalkBack label for a tile — "<label>: <value>" plus ", <detail>" when a subline is
     * present. Pure string join so the accessible reading of every tile is verifiable off-device.
     */
    fun accessibilityLabel(
        label: String,
        value: String,
        detail: String?,
    ): String = if (detail.isNullOrBlank()) "$label: $value" else "$label: $value, $detail"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never an
 * efficiency value, a session date, an energy total, or the session count — so a diagnostics line can never
 * leak fleet behavior.
 */
object EfficiencyPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "EfficiencyPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
