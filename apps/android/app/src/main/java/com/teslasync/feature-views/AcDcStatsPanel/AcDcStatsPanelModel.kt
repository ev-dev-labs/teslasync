// Pure, framework-free model + projection for the AcDcStatsPanel feature view — the native analogue of every
// value the web component derives before returning JSX
// (web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// AcDcStatsPanel is a presentational charging-list panel — the web component takes its `breakdown` (an
// `AcDcBreakdown`, computed by the owning charging list/section via `computeAcDcBreakdown`) as a prop, so this
// surface binds no data hook of its own (its only web hook is `useTranslation`). As in the sibling
// ChargingBreakdownSlide / EntriesTable ports, the cache-then-network lifecycle (loading / error / stale /
// offline) is supplied by the owning host through the shared P1/S8 state-holder layer as a [UiState]; the
// composable renders every state that layer can carry without ever fetching. This pure file owns the parts
// the web render derives from `breakdown`:
//   • the table rows — the web `[{AC…}, {DC…}].filter(r => r.count > 0)` two-row array, in fixed AC→DC order;
//   • the energy-split bar — the web `gridTemplateColumns: {acPct}% {dcPct}%` proportions, each AC/DC segment
//     shown only when its energy is positive (web `breakdown.ac.energy > 0`);
//   • the per-row derived cells — `$/kWh` (web `cost / energy`, or `—` when energy ≤ 0), avg energy
//     (`energy / count`), avg time (`formatDuration(totalDuration / count)`), and the free cell;
//   • the energy formatter — the web `value >= 1000 ? {value/1000} MWh : {value} kWh` threshold;
//   • the free-charged footer, shown only when `breakdown.total.freeCount > 0`.
//
// Unit-magnitude parity: the web `computeAcDcBreakdown` sums the raw `total_energy_added_wh` field WITHOUT a
// unit conversion and the panel then labels that magnitude `kWh` (and `/1000 → MWh` past 1000). This port is
// faithful to that observable behaviour — it formats the magnitude it is handed exactly as the web does and
// performs NO SI re-scaling of its own (the magnitude semantics are the host/`computeAcDcBreakdown`'s
// concern, mirrored verbatim, never silently "corrected"). Unit symbols (`kWh`, `MWh`, `%`) are international
// SI-derived symbols, kept as code constants exactly as the sibling charging feature-view ports do.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AcDcStatsPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ChargingBreakdownSlide / EntriesTable
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.acdcstatspanel

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt

/** Em dash shown wherever a value is unknown/absent — the web `—` (Currency fallback, `formatDuration`, `$/kWh`). */
internal const val EM_DASH: String = "\u2014"

/**
 * One AC or DC charging bucket — the native mirror of the subset of the web `AcDcBucket` the panel reads
 * (web/src/features/charging/components/charging-list/helpers.ts). The web bucket also carries `energyUsed`,
 * which this panel never renders, so it is deliberately omitted (DRY — the model carries only what the
 * surface shows). Every field defaults so a partial/zero bucket is valid.
 *
 * @property energy the energy magnitude the panel formats as kWh/MWh (web `bucket.energy`, the raw summed
 *   `total_energy_added_wh` magnitude — see the file header on unit-magnitude parity).
 * @property cost the recorded cost (web `bucket.cost`).
 * @property count the session count (web `bucket.count`); a bucket with `count <= 0` is dropped from the table.
 * @property totalDuration the summed session duration in minutes (web `bucket.totalDuration`).
 * @property freeCount the number of free (zero-cost) sessions (web `bucket.freeCount`).
 * @property freeEnergy the energy added for free, in kWh magnitude (web `bucket.freeEnergy`).
 */
data class AcDcBucket(
    val energy: Double = 0.0,
    val cost: Double = 0.0,
    val count: Int = 0,
    val totalDuration: Double = 0.0,
    val freeCount: Int = 0,
    val freeEnergy: Double = 0.0,
)

/**
 * The fleet-wide totals the panel reads — the native mirror of the web `AcDcBreakdown.total`. Drives the
 * energy-split bar's "Total" figure and the free-charged footer's visibility/figures.
 */
data class AcDcTotals(
    val energy: Double = 0.0,
    val cost: Double = 0.0,
    val freeEnergy: Double = 0.0,
    val freeCount: Int = 0,
)

/**
 * The breakdown prop the panel renders — the native mirror of the web `AcDcBreakdown` (the `breakdown` prop).
 * Every field defaults so a still-loading host can hand over an all-zero breakdown without error.
 */
data class AcDcBreakdownData(
    val ac: AcDcBucket = AcDcBucket(),
    val dc: AcDcBucket = AcDcBucket(),
    val total: AcDcTotals = AcDcTotals(),
)

/**
 * A charging-current category — the native analogue of the web table's two rows. The declared order
 * (AC, then DC) is the exact order the web `data` array is built in before the `count > 0` filter, which the
 * composable relies on for its fixed AC→DC table + bar layout and its positional colors (web AC `#3b82f6`,
 * DC `#f59e0b`).
 */
enum class AcDcSource { Ac, Dc }

/**
 * One table row — a charging [source] and the figures the web `AcDcTableRow` carries. The derived accessors
 * mirror the web column renderers: `$/kWh` (web `cost / energy`, `null` ⇒ `—`), avg energy (`energy / count`),
 * and avg duration (`totalDuration / count`). Pure data so the projection is unit-tested without a UI host;
 * the localized label, the positional color, and the locale formatting are resolved at the Compose boundary.
 */
data class AcDcStatsRow(
    val source: AcDcSource,
    val energy: Double,
    val cost: Double,
    val count: Int,
    val totalDuration: Double,
    val freeCount: Int,
    val freeEnergy: Double,
) {
    /** Cost per energy unit — web `r.energy > 0 ? cost / energy : —`; `null` renders the em dash. */
    val costPerEnergy: Double? get() = if (energy > 0.0) cost / energy else null

    /** Average energy per session — web `r.energy / r.count`. `count` is always > 0 for a rendered row. */
    val avgEnergy: Double get() = if (count > 0) energy / count else 0.0

    /** Average session duration in minutes — web `r.totalDuration / r.count`. */
    val avgDurationMinutes: Double get() = if (count > 0) totalDuration / count else 0.0
}

/**
 * The energy-split bar's proportional data — the native analogue of the web
 * `gridTemplateColumns: {(ac.energy/total.energy)*100}% {(dc.energy/total.energy)*100}%`. Fractions are
 * divide-by-zero-guarded (an all-zero breakdown is filtered to an empty table upstream, so a zero total only
 * reaches here defensively); each segment is shown only when its own energy is strictly positive (web
 * `breakdown.ac.energy > 0` / `breakdown.dc.energy > 0`).
 */
data class EnergySplit(
    val acEnergy: Double,
    val dcEnergy: Double,
    val totalEnergy: Double,
) {
    /** AC share of the bar width, 0–1 (web `ac.energy / total.energy`); 0 when the total is non-positive. */
    val acFraction: Double get() = if (totalEnergy > 0.0) (acEnergy / totalEnergy).coerceIn(0.0, 1.0) else 0.0

    /** DC share of the bar width, 0–1 (web `dc.energy / total.energy`); 0 when the total is non-positive. */
    val dcFraction: Double get() = if (totalEnergy > 0.0) (dcEnergy / totalEnergy).coerceIn(0.0, 1.0) else 0.0

    /** AC share as a 0–100 percentage (web `(ac.energy / total.energy) * 100`), for the in-segment label. */
    val acPercent: Double get() = acFraction * PERCENT_SCALE

    /** DC share as a 0–100 percentage (web `(dc.energy / total.energy) * 100`), for the in-segment label. */
    val dcPercent: Double get() = dcFraction * PERCENT_SCALE

    /** Whether the AC segment is drawn — web `breakdown.ac.energy > 0`. */
    val showAc: Boolean get() = acEnergy > 0.0

    /** Whether the DC segment is drawn — web `breakdown.dc.energy > 0`. */
    val showDc: Boolean get() = dcEnergy > 0.0

    private companion object {
        const val PERCENT_SCALE = 100.0
    }
}

/** The free-charged footer figures — the native mirror of the web `{freeCount} sessions` / `{freeEnergy} kWh`. */
data class FreeChargingTotal(
    val freeCount: Int,
    val freeEnergy: Double,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property rows the AC/DC table rows that survived the web `count > 0` filter, in fixed AC→DC order.
 * @property split the proportional energy-split bar data (web `gridTemplateColumns` + per-segment labels).
 * @property freeTotal the free-charged footer figures, or `null` when `total.freeCount <= 0` (web's hidden
 *   footer branch).
 */
data class AcDcStatsDisplay(
    val rows: List<AcDcStatsRow>,
    val split: EnergySplit,
    val freeTotal: FreeChargingTotal?,
) {
    /**
     * True when there is no charging story to tell — neither AC nor DC has a session. The composable renders
     * a friendly empty state in this case so the panel is never a blank box (the web's degenerate "no rows"
     * render is a bare empty bar + empty table; the native port shows an honest empty state instead, matching
     * the P3 states contract).
     */
    val isEmpty: Boolean get() = rows.isEmpty()
}

/**
 * The user's currency + decimal preferences the panel needs — the native analogue of the web `useFormatting`
 * inputs the `<Currency>` component and `fmtNumber` read implicitly from settings. Defaults reproduce the web
 * defaults exactly (`currency_symbol` blank ⇒ `$`; `fmtNumber` global precision ⇒ 2). The owning charging
 * host — which already holds settings to compute the breakdown — passes the user's values; a prop-driven host
 * can omit it and get web-default behaviour.
 *
 * @property currencySymbol the prefix the `$/kWh` + `Cost` cells use (web `useFormatting().currencySymbol`).
 * @property numberDecimals the fraction digits for kWh/MWh/% figures (web `fmtNumber` global precision).
 */
data class AcDcStatsFormat(
    val currencySymbol: String = DEFAULT_CURRENCY_SYMBOL,
    val numberDecimals: Int = DEFAULT_NUMBER_DECIMALS,
) {
    /** The currency symbol with the web's blank/whitespace ⇒ "$" fallback applied. */
    val resolvedSymbol: String get() = currencySymbol.ifBlank { DEFAULT_CURRENCY_SYMBOL }

    /** The number precision floored at zero (web `Math.max(0, …)`), so a stray negative never breaks `String.format`. */
    val resolvedDecimals: Int get() = if (numberDecimals < 0) 0 else numberDecimals

    companion object {
        /** Default currency symbol — web blank ⇒ "$". */
        const val DEFAULT_CURRENCY_SYMBOL: String = "$"

        /** Default number precision — web `fmtNumber` global default. */
        const val DEFAULT_NUMBER_DECIMALS: Int = 2

        /** The all-default preference bundle ("$", 2 dp) used when a host supplies none. */
        val DEFAULT: AcDcStatsFormat = AcDcStatsFormat()
    }
}

/**
 * Pure projection from an [AcDcBreakdownData] to its render-ready [AcDcStatsDisplay] plus the formatters the
 * web component applies inline — a 1:1 port of the derivations the web component performs (the `count > 0`
 * row filter, the energy-split proportions, the `value >= 1000 → MWh` energy formatter, the `$/kWh` /
 * avg-energy / avg-time cells, and the free cell). Stateless and side-effect-free so it is fully covered by
 * the off-device unit gate. Unit symbols are international SI-derived symbols kept as constants here.
 */
object AcDcStatsProjection {
    /** Web `value >= 1000` MWh threshold — above it the magnitude is shown in MWh, below in kWh. */
    const val ENERGY_MWH_THRESHOLD: Double = 1000.0

    /** kWh→MWh divisor (web `value / 1000`). */
    const val MWH_DIVISOR: Double = 1000.0

    /** Currency precision — web `<Currency>` defaults to 2 fraction digits regardless of the global precision. */
    const val CURRENCY_DECIMALS: Int = 2

    /** kWh unit symbol (web literal `'kWh'`). */
    const val UNIT_KWH: String = "kWh"

    /** MWh unit symbol (web literal `'MWh'`). */
    const val UNIT_MWH: String = "MWh"

    /** Percent suffix (web `fmtPercent` `%`). */
    const val PERCENT_SUFFIX: String = "%"

    private const val MINUTES_PER_HOUR: Double = 60.0

    /** Select the render-ready view for [breakdown], filtering out zero-session rows exactly as the web does. */
    fun project(breakdown: AcDcBreakdownData): AcDcStatsDisplay {
        val rows =
            buildList {
                addRow(AcDcSource.Ac, breakdown.ac)
                addRow(AcDcSource.Dc, breakdown.dc)
            }
        val split =
            EnergySplit(
                acEnergy = breakdown.ac.energy,
                dcEnergy = breakdown.dc.energy,
                totalEnergy = breakdown.total.energy,
            )
        val freeTotal =
            if (breakdown.total.freeCount > 0) {
                FreeChargingTotal(breakdown.total.freeCount, breakdown.total.freeEnergy)
            } else {
                null
            }
        return AcDcStatsDisplay(rows = rows, split = split, freeTotal = freeTotal)
    }

    // Web `[…].filter((r) => r.count > 0)`: a current type is only tabled when it has at least one session.
    private fun MutableList<AcDcStatsRow>.addRow(
        source: AcDcSource,
        bucket: AcDcBucket,
    ) {
        if (bucket.count > 0) {
            add(
                AcDcStatsRow(
                    source = source,
                    energy = bucket.energy,
                    cost = bucket.cost,
                    count = bucket.count,
                    totalDuration = bucket.totalDuration,
                    freeCount = bucket.freeCount,
                    freeEnergy = bucket.freeEnergy,
                ),
            )
        }
    }

    /**
     * The web energy formatter `value >= 1000 ? fmtWithUnit(value / 1000, 'MWh') : fmtWithUnit(value, 'kWh')`
     * — used by the Energy column and the AC/Total/DC split footer. The magnitude is formatted exactly as the
     * web hands it over (no SI re-scaling — see the file header).
     */
    fun formatEnergyAuto(
        value: Double,
        decimals: Int = AcDcStatsFormat.DEFAULT_NUMBER_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String =
        if (value >= ENERGY_MWH_THRESHOLD) {
            ChartFormat.withUnit(value / MWH_DIVISOR, UNIT_MWH, decimals, locale)
        } else {
            ChartFormat.withUnit(value, UNIT_KWH, decimals, locale)
        }

    /** Always-kWh energy formatter — web `fmtWithUnit(value, 'kWh')` (Avg Energy + the free cell's energy). */
    fun formatKwh(
        value: Double,
        decimals: Int = AcDcStatsFormat.DEFAULT_NUMBER_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.withUnit(value, UNIT_KWH, decimals, locale)

    /** Percentage formatter — web `fmtPercent(value)` = `{value} %` at the number precision. */
    fun formatPercent(
        value: Double,
        decimals: Int = AcDcStatsFormat.DEFAULT_NUMBER_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value, decimals, locale) + PERCENT_SUFFIX

    /**
     * Currency formatter — the native port of the web `<Currency value=… />` (symbol prefix + `fmtNumber` at
     * the fixed 2-dp Currency precision). A `null`/non-finite amount renders the em-dash fallback (web
     * `Currency` `fallback = '—'`).
     */
    fun formatCurrency(
        value: Double?,
        symbol: String = AcDcStatsFormat.DEFAULT_CURRENCY_SYMBOL,
        decimals: Int = CURRENCY_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (value == null || !value.isFinite()) return EM_DASH
        return symbol + ChartFormat.number(value, decimals, locale)
    }

    /** The free cell — web `r.freeCount > 0 ? '{freeCount} ({freeEnergy} kWh)' : '—'`. */
    fun formatFreeCell(
        row: AcDcStatsRow,
        decimals: Int = AcDcStatsFormat.DEFAULT_NUMBER_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String =
        if (row.freeCount > 0) {
            "${row.freeCount} (${formatKwh(row.freeEnergy, decimals, locale)})"
        } else {
            EM_DASH
        }

    /**
     * Duration formatter — the native port of the web `formatDurationMinutes`
     * (web/src/lib/dateFormat.ts): `—` for a non-finite/negative input, otherwise `{h}h {m}m` when there is at
     * least one whole hour, else `{m}m`, with `m = round(minutes % 60)` and `h = floor(minutes / 60)`. The
     * web's no-carry quirk at `m == 60` is preserved verbatim (parity over correctness).
     */
    fun formatDurationMinutes(minutes: Double): String {
        if (!minutes.isFinite() || minutes < 0.0) return EM_DASH
        val hours = floor(minutes / MINUTES_PER_HOUR).toInt()
        val mins = (minutes % MINUTES_PER_HOUR).roundToInt()
        return if (hours > 0) "${hours}h ${mins}m" else "${mins}m"
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * energy mix, the session counts, or the costs — so a diagnostics line can never leak a user's charging
 * habits.
 */
object AcDcStatsPanelDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "ac-dc-stats-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AcDcStatsPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
