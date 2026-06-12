// The pure, framework-free model + projection for the EnergySummaryPanel feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/drive-detail/EnergySummaryPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the drive-detail page, via useDriveDetailData)
// fetches the drive, computes the per-row aggregate `stats`, and passes `drive` + `stats` down. From those it
// renders one GlassPanel with a BatteryCharging header over a responsive 2 / 3 / 6-column grid of six centered
// stat tiles: Energy Consumed, Energy Recovered, Net Consumption (each rendered in kWh above 1000 Wh, else Wh),
// Efficiency (Wh/km, or Wh/mi after the `* 1.609344` mile conversion, with a `—` when consumption is absent),
// Battery Used (the start − end delta percent plus a `start% → end%` detail line) and Range Used (the start −
// end range, labeled with the user's distance unit). Only the efficiency value is unit-converted on this
// surface; the energy figures are always Wh/kWh and the range figures arrive already in the user's display
// distance unit (the parent computes them), so — matching the web source verbatim — this surface labels the
// range with the distance unit without re-converting it.
//
// This file owns the parts the web component expresses from those props: the slice of the inputs it reads
// ([EnergySummarySnapshot]), the display preferences resolved from one `/settings` document (the native binding
// of the web `useUnits` read, [EnergySummaryDisplayPrefs]), the lifecycle projection onto the shared
// cache-then-network [UiState] (so the surface renders every state the P1/S8 layer can carry), the ordered
// six-tile value list reproducing each web `t()`/conversion/format call exactly, the merged accessibility
// label, and the PII-safe `view.opened` diagnostic (P1/S11).
//
// Number formatting mirrors web `lib/numberFormat` (`fmtNumber`/`fmtWithUnit`): the global decimal precision
// (settings `decimal_precision`, default 2), the `safeNumber` coercion of a non-finite value to 0, locale
// grouping, and ECMAScript `halfExpand` (HALF_UP) rounding so 0.125 renders "0.13" on both platforms. The
// battery percentages mirror the web's bare template-literal rendering (`${start - end}%`), which is plain
// number-to-string, not `fmtNumber`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EnergySummaryPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.energysummarypanel

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonElement
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor

/** The em-dash sentinel rendered for an absent value (web `'—'`); also the freshness "unknown age" fallback. */
internal const val EM_DASH: String = "\u2014"

/** 1 kWh = 1000 Wh — the divisor on the kWh branch (web `stats.energyWh / 1000`). */
private const val WH_PER_KWH: Double = 1000.0

/** Energy is shown in kWh strictly above this many Wh, else in Wh (web `stats.energyWh > 1000`). */
private const val WH_KWH_THRESHOLD: Double = 1000.0

/** Unit symbol on the kWh branch (web `fmtWithUnit(_, 'kWh')`); units are not translated. */
private const val KWH_UNIT: String = "kWh"

/** Unit symbol on the Wh branch (web `` `${fmtNumber(_)} Wh` ``). */
private const val WH_UNIT: String = "Wh"

/** Efficiency unit when the distance preference is kilometres (web `'Wh/km'`). */
private const val EFFICIENCY_UNIT_KM: String = "Wh/km"

/** Efficiency unit when the distance preference is miles (web `'Wh/mi'`). */
private const val EFFICIENCY_UNIT_MI: String = "Wh/mi"

/** 1 mile = 1.609344 km — the Wh/km -> Wh/mi factor (web `whPerKm * 1.609344`). */
private const val KM_PER_MILE: Double = 1.609344

/** Percent suffix on the Battery Used value + detail line (web `%`). */
private const val PERCENT: String = "%"

/** The rightwards arrow joining the battery start -> end detail (web literal `→`, U+2192). */
private const val ARROW: String = "\u2192"

/** Rendered for a missing battery percentage in the detail line (web `?? '?'`). */
private const val BATTERY_UNKNOWN: String = "?"

/** Web `fmtNumber` global precision default (`numberFormat._globalPrecision`); settings `decimal_precision`. */
private const val DEFAULT_PRECISION: Int = 2

/** BCP-47 fallback locale (web `fmtNumber` global locale default). */
private const val DEFAULT_LOCALE_TAG: String = "en-US"

/** A single space joining a number to its unit label (web `` `${n} ${unit}` ``) and the start/end arrow. */
private const val UNIT_SPACE: String = " "

/** Connector between a tile's label and its value in the merged accessibility reading ("label: value"). */
private const val A11Y_LABEL_VALUE: String = ": "

/** Connector between a tile's value and its detail in the merged accessibility reading ("…value, detail"). */
private const val A11Y_VALUE_DETAIL: String = ", "

/**
 * The slice of the web `drive` + `stats` props this surface reads. Energy comes off the web `DriveStats`
 * (`energyWh`/`regenWh` watt-hours, `consumptionWhKm` Wh/km); the ranges off `DriveStats`
 * (`startRange`/`endRange`, already in the user's display distance unit, hence nullable); the battery
 * percentages off the web `DriveDetail` (`startBatteryPct`/`endBatteryPct`, nullable).
 *
 * @property energyWh energy used, watt-hours (web `stats.energyWh`); rendered kWh above 1000 Wh, else Wh.
 * @property regenWh energy recovered via regen, watt-hours (web `stats.regenWh`); same kWh/Wh rendering.
 * @property consumptionWhKm consumption in Wh/km (web `stats.consumptionWhKm`); the only unit-converted figure.
 * @property startRange range at drive start, in the user's display distance unit, or null (web `stats.startRange`).
 * @property endRange range at drive end, in the user's display distance unit, or null (web `stats.endRange`).
 * @property startBatteryPct battery percentage at drive start, or null (web `drive.startBatteryPct`).
 * @property endBatteryPct battery percentage at drive end, or null (web `drive.endBatteryPct`).
 */
data class EnergySummarySnapshot(
    val energyWh: Double,
    val regenWh: Double,
    val consumptionWhKm: Double,
    val startRange: Double?,
    val endRange: Double?,
    val startBatteryPct: Double?,
    val endBatteryPct: Double?,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native binding of the
 * web `useUnits` read (distance display unit + locale + precision), derived via [UnitPreferences.fromSettings].
 * Resolved once at the Compose boundary and threaded into the pure projection.
 *
 * @property units the SI -> display unit preferences (only the distance unit + locale + precision are read here).
 * @property locale the locale driving number grouping/separators (web `fmtNumber` global locale).
 * @property precision the default fraction digits (web `fmtNumber` global precision, settings `decimal_precision`).
 */
data class EnergySummaryDisplayPrefs(
    val units: UnitPref,
    val locale: Locale,
    val precision: Int,
) {
    /** True when the distance preference is miles (web `unitPrefs.distance === 'mi'`). */
    val isMiles: Boolean get() = units.distance == DistanceUnitPref.MI

    /** The efficiency unit label — web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`. */
    val efficiencyUnit: String get() = if (isMiles) EFFICIENCY_UNIT_MI else EFFICIENCY_UNIT_KM

    /** The distance unit label appended to the Range Used value — web `distanceUnit` (`'mi'`/`'km'`). */
    val distanceLabel: String get() = units.distance.label

    companion object {
        /** The metric / en-US / 2-decimal defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: EnergySummaryDisplayPrefs = from(null)

        /** Resolves the distance unit + locale + precision preferences from one `/settings` document. */
        fun from(settings: JsonElement?): EnergySummaryDisplayPrefs {
            val units = UnitPreferences.fromSettings(settings)
            return EnergySummaryDisplayPrefs(
                units = units,
                locale = localeFor(units.locale),
                precision = units.precision ?: DEFAULT_PRECISION,
            )
        }
    }
}

/**
 * The six stat tiles the web component renders, in source order. Identity only — labels resolve from the i18n
 * catalog and accents from the design tokens at the Compose boundary, keeping this enum free of any Android or
 * i18n dependency.
 */
enum class EnergyStat {
    EnergyConsumed,
    EnergyRecovered,
    NetConsumption,
    Efficiency,
    BatteryUsed,
    RangeUsed,
}

/**
 * One fully resolved tile — the native analogue of a single web grid cell. Pure data (no Compose types) so the
 * whole projection is asserted off-device. [label] is already localized (resolved from the i18n catalog at the
 * Compose boundary and handed in via [EnergySummaryStrings]); [value] is pre-formatted; [subline] carries the
 * Battery Used detail line (web inline `<span>`), or `null` for the tiles that have none.
 */
data class EnergySummaryTile(
    val stat: EnergyStat,
    val label: String,
    val value: String,
    val subline: String?,
)

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready tiles carry no English literal. Keys map 1:1 to the web `t('driveDetail.*')` calls; [title]
 * backs the panel header and [noData] the friendly empty state.
 */
data class EnergySummaryStrings(
    val title: String,
    val energyConsumed: String,
    val energyRecovered: String,
    val netConsumption: String,
    val efficiency: String,
    val batteryUsed: String,
    val rangeUsed: String,
    val noData: String,
)

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's per-tile
 * branches, conversions, and formats. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings + design-token accents and draws what these return.
 */
object EnergySummaryPanelProjection {
    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: EnergySummarySnapshot?,
        isLoading: Boolean,
    ): UiState<EnergySummarySnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The six tiles in web source order, each value formatted for [prefs]. Energy/recovered/net render kWh above
     * 1000 Wh (else Wh); efficiency converts Wh/km -> Wh/mi when the preference is miles (or `—` when absent);
     * Battery Used carries the delta value plus a `start% → end%` detail line; Range Used appends the distance
     * unit label without re-converting (the parent supplies the range in display units), mirroring the web.
     */
    fun tiles(
        snapshot: EnergySummarySnapshot,
        prefs: EnergySummaryDisplayPrefs,
        strings: EnergySummaryStrings,
    ): List<EnergySummaryTile> {
        val locale = prefs.locale
        val precision = prefs.precision
        return listOf(
            EnergySummaryTile(
                stat = EnergyStat.EnergyConsumed,
                label = strings.energyConsumed,
                value = formatEnergy(snapshot.energyWh, locale, precision),
                subline = null,
            ),
            EnergySummaryTile(
                stat = EnergyStat.EnergyRecovered,
                label = strings.energyRecovered,
                value = formatEnergy(snapshot.regenWh, locale, precision),
                subline = null,
            ),
            EnergySummaryTile(
                stat = EnergyStat.NetConsumption,
                label = strings.netConsumption,
                value = formatEnergy(snapshot.energyWh - snapshot.regenWh, locale, precision),
                subline = null,
            ),
            EnergySummaryTile(
                stat = EnergyStat.Efficiency,
                label = strings.efficiency,
                value = efficiencyValue(snapshot.consumptionWhKm, prefs),
                subline = null,
            ),
            EnergySummaryTile(
                stat = EnergyStat.BatteryUsed,
                label = strings.batteryUsed,
                value = batteryValue(snapshot.startBatteryPct, snapshot.endBatteryPct),
                subline = batterySubline(snapshot.startBatteryPct, snapshot.endBatteryPct),
            ),
            EnergySummaryTile(
                stat = EnergyStat.RangeUsed,
                label = strings.rangeUsed,
                value = rangeValue(snapshot.startRange, snapshot.endRange, prefs),
                subline = null,
            ),
        )
    }

    /**
     * Web `stats.energyWh > 1000 ? fmtWithUnit(stats.energyWh / 1000, 'kWh') : `${fmtNumber(stats.energyWh)} Wh``
     * — strictly above 1000 Wh the value is shown in kWh, otherwise in Wh, both at the global precision.
     */
    fun formatEnergy(
        wh: Double,
        locale: Locale = Locale.US,
        decimals: Int = DEFAULT_PRECISION,
    ): String =
        if (wh > WH_KWH_THRESHOLD) {
            formatWithUnit(wh / WH_PER_KWH, KWH_UNIT, locale, decimals)
        } else {
            formatWithUnit(wh, WH_UNIT, locale, decimals)
        }

    /**
     * Web ``stats.consumptionWhKm > 0 ? `${fmtNumber(toEfficiencyDisplay(stats.consumptionWhKm))} ${unit}` : '—'``
     * — a positive consumption is converted (Wh/km, or Wh/mi when miles) and labeled; a non-positive one is the
     * em-dash sentinel.
     */
    fun efficiencyValue(
        consumptionWhKm: Double,
        prefs: EnergySummaryDisplayPrefs,
    ): String =
        if (consumptionWhKm > 0) {
            formatNumber(toEfficiencyDisplay(consumptionWhKm, prefs.isMiles), prefs.locale, prefs.precision) +
                UNIT_SPACE + prefs.efficiencyUnit
        } else {
            EM_DASH
        }

    /** Web `toEfficiencyDisplay(whPerKm)` — `unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm`. */
    fun toEfficiencyDisplay(
        whPerKm: Double,
        isMiles: Boolean,
    ): Double = if (isMiles) whPerKm * KM_PER_MILE else whPerKm

    /**
     * Web ``drive.startBatteryPct != null && drive.endBatteryPct != null ? `${start - end}%` : '—'`` — the
     * delta is rendered as a bare number-to-string (not `fmtNumber`), matching the web template literal.
     */
    fun batteryValue(
        start: Double?,
        end: Double?,
    ): String = if (start != null && end != null) formatPlain(start - end) + PERCENT else EM_DASH

    /** Web `` `${drive.startBatteryPct ?? '?'}% → ${drive.endBatteryPct ?? '?'}%` `` — the Battery Used detail line. */
    fun batterySubline(
        start: Double?,
        end: Double?,
    ): String {
        val startText = if (start != null) formatPlain(start) else BATTERY_UNKNOWN
        val endText = if (end != null) formatPlain(end) else BATTERY_UNKNOWN
        return startText + PERCENT + UNIT_SPACE + ARROW + UNIT_SPACE + endText + PERCENT
    }

    /**
     * Web ``stats.startRange != null && stats.endRange != null ? fmtWithUnit(stats.startRange - stats.endRange,
     * distanceUnit) : '—'`` — the range delta is labeled with the distance unit without re-converting (the
     * parent supplies it already in the display unit), exactly as the web source does.
     */
    fun rangeValue(
        start: Double?,
        end: Double?,
        prefs: EnergySummaryDisplayPrefs,
    ): String =
        if (start != null && end != null) {
            formatWithUnit(start - end, prefs.distanceLabel, prefs.locale, prefs.precision)
        } else {
            EM_DASH
        }

    /**
     * Web `fmtNumber(value, decimals)` — a non-finite value is coerced to 0 (`safeNumber`), then rendered at the
     * global precision with locale grouping. HALF_UP matches `Number.prototype.toLocaleString`'s default
     * "halfExpand" rounding so 0.125 renders "0.13" on both platforms rather than diverging on banker's rounding.
     */
    fun formatNumber(
        value: Double,
        locale: Locale = Locale.US,
        decimals: Int = DEFAULT_PRECISION,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val digits = decimals.coerceAtLeast(0)
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = digits
                maximumFractionDigits = digits
                roundingMode = RoundingMode.HALF_UP
            }
        return formatter.format(safe)
    }

    /** Web `fmtWithUnit(value, unit, decimals)` = `${fmtNumber(value, decimals)} ${unit}`. */
    fun formatWithUnit(
        value: Double,
        unit: String,
        locale: Locale = Locale.US,
        decimals: Int = DEFAULT_PRECISION,
    ): String = formatNumber(value, locale, decimals) + UNIT_SPACE + unit

    /**
     * Renders a battery percentage the way the web template literal does — a whole-valued number drops its
     * fractional part (`25`, not `25.00`), and a fractional one keeps its shortest round-trip form, matching
     * JavaScript number-to-string. Battery percentages are whole numbers in practice, so this resolves to a
     * bare integer.
     */
    fun formatPlain(value: Double): String {
        val whole = value.isFinite() && value == floor(value)
        return if (whole) value.toLong().toString() else value.toString()
    }

    /**
     * Builds the merged TalkBack label for a tile — "<label>: <value>" plus ", <detail>" when a detail line is
     * present. Pure string join so the accessible reading of every tile is verifiable off-device.
     */
    fun accessibilityLabel(
        label: String,
        value: String,
        detail: String?,
    ): String =
        if (detail.isNullOrBlank()) {
            label + A11Y_LABEL_VALUE + value
        } else {
            label + A11Y_LABEL_VALUE + value + A11Y_VALUE_DETAIL + detail
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never an energy
 * total, an efficiency value, a battery level, or a range figure — so a diagnostics line can never leak a
 * drive's behavior or vehicle identity.
 */
object EnergySummaryPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "EnergySummaryPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to en-US when blank/absent (web `fmtNumber` default). */
private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)
