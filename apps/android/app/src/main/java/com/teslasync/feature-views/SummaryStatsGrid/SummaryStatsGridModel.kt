// Pure, framework-free model + projection for the SummaryStatsGrid feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// SummaryStatsGrid is a presentational surface — the web component takes `stats: SummaryStats | null` as a
// prop from the owning ChargingCurvePage (which owns the charging-session query and computes the cross-section
// `stats` in a `useMemo`), and reads two context hooks for display: `useTranslation` (the six tile labels,
// P1/S10) and `useFormatting` (the currency symbol + precision, the native binding of the S8 SettingsStore).
// It renders six GlassPanel `SummaryCard`s in a responsive 2 / 3 / 6-column grid: Total Sessions, Total
// Energy, Avg Charge Rate, Peak Rate, Avg Duration, Total Cost.
//
// Following the sibling SummaryStats / CostSummaryCards card-grid ports, the owning page threads the computed
// stats in through the shared cache-then-network state-holder layer (P1/S8) as a [UiState]; the
// [projectUiState] adapter lets the composable render every lifecycle state that layer can carry — a loading
// skeleton grid, a hard error with retry, a friendly empty state (the web `stats === null` no-sessions case),
// content, and stale/offline "last known" — without ever fetching. The web component's defensive `?? 0`
// defaults exist precisely because its parent passes `null` while the session list loads; the native
// architecture expresses that same "no data yet / no sessions" condition as the explicit Loading / Empty
// lifecycle phases at the state-holder boundary, so the resolved content branch always renders real figures.
//
// Number + currency formatting goes through the golden-pinned shared [ChartFormat.number], the native mirror
// of the web `fmtNumber` / `fmtInt` (including the web `safeNumber` non-finite → 0 guard). The default
// fraction-digit precision and the currency symbol resolve from the live `/settings` document exactly as the
// web `useSettings` `setGlobalPrecision` + `useFormatting` derivations do (`decimal_precision ?? 2`,
// `currency_symbol || '$'`, `locale || 'en-US'`). The six `t('charging.curve.*')` labels resolve from the
// i18n catalog (P1/S10) at the Compose boundary and arrive here as [SummaryStatsGridStrings]. The "kWh" / "kW"
// / "min" unit suffixes carry NO i18n key on any platform — the web hard-codes them as inline literals — so,
// exactly as the sibling CostSummaryCards port composes its "kWh" / "gal equiv" suffixes from documented
// web-parity constants, they are reproduced verbatim here, never an ad-hoc English string in the view.
//
// SI boundary (unit-conversion instructions): the web source performs NO unit conversion in this surface — it
// renders the numbers it is handed with hard-coded suffixes. In particular the owning page sums
// `total_energy_added_wh` (watt-hours) and labels the total "kWh" without dividing by 1000; this port
// reproduces the web's no-conversion contract verbatim (Honesty Covenant #5 — parity over silently "fixing"
// the upstream label), formatting whatever figures the host computes rather than re-deriving them. The single
// place a SI quantity would convert is the display boundary, and the web does not convert here, so neither
// does this port.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SummaryStatsGrid — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.summarystatsgrid

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

// ── Web-parity constants ────────────────────────────────────────────────────────────────────────────

/** Web `fmtInt(...)` precision for the Total Sessions / Avg Duration tiles (zero fraction digits, grouped). */
private const val INT_DECIMALS = 0

/** Energy unit suffix the web source hard-codes (`<SummaryCard … unit="kWh" />`), not converted. */
private const val ENERGY_UNIT = "kWh"

/** Power unit suffix the web source hard-codes for the Avg Charge Rate / Peak Rate tiles (`unit="kW"`). */
private const val POWER_UNIT = "kW"

/** Duration unit suffix the web source hard-codes for the Avg Duration tile (`unit="min"`). */
private const val DURATION_UNIT = "min"

/** Web `useFormatting` `userPrecision` fallback / `setGlobalPrecision` default (two fraction digits). */
private const val DEFAULT_PRECISION = 2

/** Web `useFormatting` currency-symbol fallback when `settings.currency_symbol` is blank/absent. */
private const val DEFAULT_CURRENCY = "$"

/** BCP-47 fallback for the `fmtNumber` global locale (web `settings.locale || 'en-US'`). */
private const val DEFAULT_LOCALE_TAG = "en-US"

/** Web `settings.currency_symbol` document key, read for the currency symbol. */
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The six fields the web SummaryStatsGrid reads off its `stats` prop — the native shape of the web
 * `SummaryStats` type (web/src/features/charging/components/charging-curve/types.ts) computed by the owning
 * ChargingCurvePage. The owning page builds them as finite sums/averages; the formatters additionally apply
 * the web `safeNumber` non-finite → 0 guard.
 *
 * [totalSessions] is the integer session count (web `sessions.length`, rendered with `fmtInt`). The rate /
 * energy / cost figures are doubles mirroring the web `number` shape; [avgDuration] is likewise a double
 * because the page computes it as a fractional average of per-session minutes and the web rounds it with
 * `fmtInt` at the display boundary (so it is rounded here, not pre-rounded by the host). Units mirror the web
 * verbatim: [totalEnergy] is the figure the page labels "kWh" (the page sums `total_energy_added_wh` — see the
 * file header's SI note), [avgRate] / [peakRate] are kilowatts (`peak_power_w / 1000`), and [totalCost] is the
 * summed `cost_decimal` in the user's currency.
 *
 * @property totalSessions number of charging sessions summarized (web `sessions.length`).
 * @property totalEnergy total energy added the web tile labels "kWh" (web `stats.totalEnergy`).
 * @property avgRate mean charge power, kW (web `stats.avgRate`).
 * @property peakRate maximum charge power, kW (web `stats.peakRate`).
 * @property avgDuration mean session duration, minutes (web `stats.avgDuration`, rounded at render via fmtInt).
 * @property totalCost summed session cost in the user's currency (web `stats.totalCost`).
 */
data class ChargingSummaryStats(
    val totalSessions: Int,
    val totalEnergy: Double,
    val avgRate: Double,
    val peakRate: Double,
    val avgDuration: Double,
    val totalCost: Double,
)

// ── Render-ready projection types ──────────────────────────────────────────────────────────────────

/**
 * One fully resolved `SummaryCard` tile — the native analogue of a single web `<SummaryCard>` invocation.
 * Pure data (no Compose types) so the whole projection is asserted off-device. The [label] is already
 * localized (resolved from the i18n catalog at the Compose boundary and handed in via
 * [SummaryStatsGridStrings]); the [value] is the formatted primary figure (the web `value` — currency symbol
 * included for the cost tile, but NEVER the unit), and [unit] is the optional small secondary suffix the web
 * renders in its own span (`kWh` / `kW` / `min`), or `null` when the web omits it.
 *
 * @property label the localized tile label (web `t('charging.curve.*')`).
 * @property value the formatted primary value, currency symbol included where the web includes it (web `value`).
 * @property unit the optional unit suffix rendered as a separate secondary span (web `unit`), or `null`.
 */
data class SummaryStatTile(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready tiles carry no English literal. Keys map 1:1 to the web `t('charging.curve.*')` calls.
 *
 * @property totalSessions web `t('charging.curve.totalSessions', 'Total Sessions')`.
 * @property totalEnergy web `t('charging.curve.totalEnergy', 'Total Energy')`.
 * @property avgChargeRate web `t('charging.curve.avgChargeRate', 'Avg Charge Rate')`.
 * @property peakRate web `t('charging.curve.peakRate', 'Peak Rate')`.
 * @property avgDuration web `t('charging.curve.avgDuration', 'Avg Duration')`.
 * @property totalCost web `t('charging.curve.totalCost', 'Total Cost')`.
 */
data class SummaryStatsGridStrings(
    val totalSessions: String,
    val totalEnergy: String,
    val avgChargeRate: String,
    val peakRate: String,
    val avgDuration: String,
    val totalCost: String,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the
 * web `useFormatting` reads (currency symbol + precision) and the `fmtNumber` global locale. All derive from
 * one settings document, mirroring the web hooks which resolve from `useSettings` (the global precision/locale
 * are set by `setGlobalPrecision`/`setGlobalLocale`, and `useFormatting` reads `currency_symbol`).
 *
 * @property currencySymbol the resolved currency symbol with the web blank/whitespace → "$" fallback applied
 *   (web `settings.currency_symbol && settings.currency_symbol.trim() ? settings.currency_symbol : '$'`).
 * @property precision the default fraction digits applied to the energy / rate / cost tiles (web
 *   `decimal_precision ?? 2`); the integer tiles override it to zero per the web `fmtInt` calls.
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 */
data class SummaryStatsGridDisplayPrefs(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    companion object {
        /** The "$", 2-dp, en-US defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: SummaryStatsGridDisplayPrefs = from(null)

        /** Resolves the currency + precision + locale preferences from one `/settings` document. */
        fun from(settings: JsonElement?): SummaryStatsGridDisplayPrefs {
            val unitPref = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject).stringOrNull(KEY_CURRENCY_SYMBOL)
            return SummaryStatsGridDisplayPrefs(
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = unitPref.precision ?: DEFAULT_PRECISION,
                locale = localeFor(unitPref.locale),
            )
        }

        private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)

        private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull
    }
}

// ── Projection ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from the surface's prop + display preferences to its render-ready tiles — a 1:1 port of the
 * derivations the web component performs. The composable resolves [SummaryStatsGridStrings] and
 * [SummaryStatsGridDisplayPrefs] from the i18n catalog and the live settings, then hands them here.
 */
object SummaryStatsGridProjection {
    /**
     * Maps the host's `(stats, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading wins
     * outright (skeleton chrome), present stats render [UiPhase.Content], and absent stats render
     * [UiPhase.Empty] — the native expression of the web `stats === null` case (the page returns `null` from
     * its `useMemo` when there are no charging sessions). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error, which the composable renders too.
     */
    fun projectUiState(
        stats: ChargingSummaryStats?,
        isLoading: Boolean,
    ): UiState<ChargingSummaryStats> =
        when {
            isLoading -> UiState.loading()
            stats != null -> UiState(phase = UiPhase.Content, data = stats)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The six SummaryCard tiles in web source order. Each value reproduces the matching web expression — the
     * `fmtInt` Total Sessions, the `fmtNumber` + "kWh" energy, the two `fmtNumber` + "kW" rate tiles, the
     * `fmtInt` + "min" duration, and the `formatCurrency` cost — formatted for [prefs] (locale grouping + the
     * user's precision + currency symbol), with the verbatim unit suffix the web hard-codes per tile (the unit
     * is kept out of [SummaryStatTile.value] because the web renders it in its own secondary span).
     */
    fun tiles(
        stats: ChargingSummaryStats,
        prefs: SummaryStatsGridDisplayPrefs,
        strings: SummaryStatsGridStrings,
    ): List<SummaryStatTile> {
        val locale = prefs.locale
        val precision = prefs.precision
        return listOf(
            SummaryStatTile(
                label = strings.totalSessions,
                value = grouped(stats.totalSessions.toDouble(), INT_DECIMALS, locale), // parity:allow Int→Double widening
                unit = null,
            ),
            SummaryStatTile(
                label = strings.totalEnergy,
                value = grouped(stats.totalEnergy, precision, locale),
                unit = ENERGY_UNIT,
            ),
            SummaryStatTile(
                label = strings.avgChargeRate,
                value = grouped(stats.avgRate, precision, locale),
                unit = POWER_UNIT,
            ),
            SummaryStatTile(
                label = strings.peakRate,
                value = grouped(stats.peakRate, precision, locale),
                unit = POWER_UNIT,
            ),
            SummaryStatTile(
                label = strings.avgDuration,
                value = grouped(stats.avgDuration, INT_DECIMALS, locale),
                unit = DURATION_UNIT,
            ),
            SummaryStatTile(
                label = strings.totalCost,
                value = formatCurrency(stats.totalCost, prefs),
                unit = null,
            ),
        )
    }

    /**
     * Formats a currency [amount] the way the web `useFormatting().formatCurrency` does — the resolved
     * [SummaryStatsGridDisplayPrefs.currencySymbol] followed by a grouped number via the shared
     * [ChartFormat.number]. [decimals] defaults to the user's precision (web `userPrecision`), matching the
     * web `formatCurrency(stats?.totalCost ?? 0)` call which passes no explicit precision.
     */
    fun formatCurrency(
        amount: Double,
        prefs: SummaryStatsGridDisplayPrefs,
        decimals: Int = prefs.precision,
        locale: Locale = prefs.locale,
    ): String = prefs.currencySymbol + grouped(amount, decimals, locale)

    /**
     * A grouped number at [decimals] fraction digits — the web `fmtNumber` / `fmtInt`, including its
     * `safeNumber` guard (a non-finite value renders as 0 rather than the [ChartFormat] em-dash, matching the
     * web output) and locale grouping/decimal separators.
     */
    private fun grouped(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(if (value.isFinite()) value else 0.0, decimals.coerceAtLeast(0), locale)
}

// ── Diagnostics (P1/S11) ───────────────────────────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a session
 * count, energy, rate, duration, or cost figure — so a diagnostics line can never leak the operator's
 * charging economics or fleet usage.
 */
object SummaryStatsGridDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SummaryStatsGrid"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
