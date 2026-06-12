// Pure, framework-free model + projection for the DetailCards feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/drivetrain-health/DetailCards.tsx and its `helpers.ts`). No Compose,
// no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Drivetrain Health page) owns the
// `useDrivetrainHealth` / `useDrives` / `useDrivingStats` queries and the chart-derived peak/avg/regen power
// figures, then passes them down. From those props it renders two cards: a "Temperature Details" definition
// list (front motor, rear motor, inverter, battery temps) and a "Power Summary" definition list (Peak Power,
// Avg Peak Power, Max Regen, Total Regen, CO2 Saved). This file owns the parts the web expresses inline: the
// `displayTemp` helper (null -> em dash, else the SI-Celsius temperature formatted for the user's unit), the
// per-row power/energy/mass value formatting with the web `peakPower > 0` / `minRegenPower < 0` / `stats ?`
// guards, and the lifecycle projection of `(data, isLoading)` onto the shared cache-then-network [UiState] so
// the surface renders every state the P1/S8 layer can carry.
//
// The surface's two bound web data sources are `useTranslation` (the i18n catalog, P1/S10 — the labels arrive
// pre-resolved in [DetailCardsStrings]) and `useUnits` (the temperature + energy display preference + locale,
// P1/S8). Temperatures arrive as SI degrees Celsius and energy as SI watt-hours; both are converted at this
// single display-boundary seam through the golden-pinned shared `formatTemperature` / `formatEnergy`
// (Phase-48 SI-canonical rule), and the kW power figures (already divided by 1000 by the owning page, exactly
// as the web passes them) and the CO2 kilograms are run through a locale-aware [fmtNumber] mirroring the web
// `Intl.NumberFormat` (`fmtInt` / `fmtNumber`) with ECMAScript `halfExpand` rounding.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DetailCards — the prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.detailcards

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatEnergy
import io.teslasync.shared.core.units.formatTemperature
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs

/** The em-dash sentinel rendered for an absent reading — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Power unit symbol appended to the three Power-Summary power rows — the web literal `'kW'`. A derived SI unit
 * symbol (identical in every locale), not translatable copy, so it is a constant exactly as the shared unit
 * library treats its own unit labels.
 */
internal const val UNIT_KW: String = "kW"

/**
 * Mass unit symbol appended to the CO2-saved row — the web literal `'kg'`. An SI unit symbol (identical in
 * every locale), not translatable copy, so it is a constant exactly as the shared unit library treats its own
 * unit labels.
 */
internal const val UNIT_KG: String = "kg"

/** Web `fmtInt(peakPower)` — the Peak Power row renders with zero fraction digits. */
private const val PEAK_POWER_DECIMALS: Int = 0

/** Web `fmtNumber(value, 1)` — the avg-power, max-regen, and CO2 rows render with one fraction digit. */
private const val ONE_FRACTION_DIGIT: Int = 1

/** Web `formatEnergy(stats.regenEnergyWh, { precision: 1 })` — Total Regen overrides energy precision to 1. */
private const val ENERGY_PRECISION: Int = 1

/** Maximum fraction digits the locale formatter accepts, matching the web global-precision clamp upper bound. */
private const val MAX_FRACTION_DIGITS: Int = 20

/**
 * The four motor/inverter/battery temperatures this surface renders — the native slice of the web
 * `DrivetrainHealthData` the Temperature Details card reads. Each is SI degrees Celsius and nullable because
 * the backend may omit a sensor; a null renders the em dash (web `displayTemp` `c === null ? '—' : …`). The
 * web `DrivetrainHealthData` also carries `motorStatus` / `overallHealth`, but DetailCards reads only these
 * four temperatures, so the native slice carries only them (the same narrowing the sibling surfaces apply).
 *
 * @property frontMotorTempC front-motor temperature in °C, or `null` when absent.
 * @property rearMotorTempC rear-motor temperature in °C, or `null` when absent.
 * @property inverterTempC inverter temperature in °C, or `null` when absent.
 * @property batteryTempC battery temperature in °C, or `null` when absent.
 */
data class DrivetrainHealthInput(
    val frontMotorTempC: Double?,
    val rearMotorTempC: Double?,
    val inverterTempC: Double?,
    val batteryTempC: Double?,
)

/**
 * The two driving-stats fields the Power Summary card reads — the native slice of the web `DrivingStats`. The
 * whole object is optional on the surface (web `stats: DrivingStats | undefined`): a null [DrivingStatsInput]
 * renders the Total Regen and CO2 rows as the em dash (web `stats ? … : '—'`), while a present object always
 * carries finite values (the web type fields are non-optional numbers).
 *
 * @property regenEnergyWh lifetime energy recovered via regen, in SI watt-hours (web `stats.regenEnergyWh`).
 * @property co2SavedKg estimated CO2 saved versus a combustion baseline, in kilograms (web `stats.co2SavedKg`).
 */
data class DrivingStatsInput(
    val regenEnergyWh: Double,
    val co2SavedKg: Double,
)

/**
 * The complete render input for DetailCards — the native shape of the web component's five props. Held as one
 * value so the host's state-holder can carry it through the shared cache-then-network [UiState], and so the
 * pure projection has a single, equatable input to key its `remember`/test cases on.
 *
 * @property health the four temperatures the Temperature Details card renders (web `health`).
 * @property peakPowerKw the chart-derived peak power in kW (web `peakPower`, already divided by 1000).
 * @property avgPowerMaxKw the chart-derived average peak power in kW (web `avgPowerMax`).
 * @property minRegenPowerKw the chart-derived minimum (most-negative) power in kW (web `minRegenPower`).
 * @property stats the optional driving-stats slice the Total Regen + CO2 rows read (web `stats`).
 */
data class DetailCardsData(
    val health: DrivetrainHealthInput,
    val peakPowerKw: Double,
    val avgPowerMaxKw: Double,
    val minRegenPowerKw: Double,
    val stats: DrivingStatsInput?,
)

/**
 * The already-localized labels the two cards render. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the projection (and the rest of the surface) free of any English literal.
 *
 * @property temperatureTitle web `drivetrain.temperatures` ("Temperature Details").
 * @property powerTitle web `drivetrain.powerSummary` ("Power Summary").
 * @property frontMotorTemp web `drivetrain.frontMotorTemp` ("Front Motor Temp").
 * @property rearMotorTemp web `drivetrain.rearMotorTemp` ("Rear Motor Temp").
 * @property inverterTemp web `drivetrain.inverterTemp` ("Inverter Temp").
 * @property batteryTemp web `drivetrain.batteryTemp` ("Battery Temp").
 * @property peakPower web `drivetrain.peakPowerLabel` ("Peak Power").
 * @property avgPeakPower web `drivetrain.avgPowerLabel` ("Avg Peak Power").
 * @property maxRegen web `drivetrain.maxRegenLabel` ("Max Regen").
 * @property totalRegen web `drivetrain.regenLabel` ("Total Regen").
 * @property co2Saved web `drivetrain.co2Label` ("CO₂ Saved").
 * @property noData the empty-state message (web's parent renders DetailCards only when `health` exists; the
 *   native empty phase shows this rather than a blank box).
 * @property loadingLabel the TalkBack announcement for the loading skeleton grid (`a11y.loading`).
 */
data class DetailCardsStrings(
    val temperatureTitle: String,
    val powerTitle: String,
    val frontMotorTemp: String,
    val rearMotorTemp: String,
    val inverterTemp: String,
    val batteryTemp: String,
    val peakPower: String,
    val avgPeakPower: String,
    val maxRegen: String,
    val totalRegen: String,
    val co2Saved: String,
    val noData: String,
    val loadingLabel: String,
)

/**
 * One projected, render-ready label/value row — the native analogue of a web `KVList` item. Both fields are
 * pre-formatted Strings (no Compose types), so the projection is unit-tested without a UI host; the composable
 * maps each row onto the shared `KVList`.
 *
 * @property label the localized row label (from [DetailCardsStrings]).
 * @property value the pre-formatted value, or [EM_DASH] when the source datum is absent.
 */
data class DetailCardRow(
    val label: String,
    val value: String,
)

/**
 * Pure projection from the surface's props to its render-ready rows — a 1:1 port of the web component's inline
 * derivations: the `displayTemp` helper, the `peakPower > 0` / `avgPowerMax > 0` / `minRegenPower < 0` power
 * guards, the `stats ? … : '—'` regen/CO2 guards, and the lifecycle projection. Stateless and side-effect-free
 * so it is fully covered by the off-device unit gate; the composable only resolves localized strings and draws
 * what these return.
 */
object DetailCardsProjection {
    /**
     * Maps the surface's `(data, isLoading)` onto the shared cache-then-network [UiState] (P1/S8). The web
     * component itself has no loading/error surface (its parent owns those); this adapter adds the lifecycle
     * states the host's feed can carry while preserving web precedence: loading -> [UiPhase.Loading]; present
     * data -> [UiPhase.Content] (the two cards render); null data -> [UiPhase.Empty] (the surface still
     * renders, with a friendly "no data" body rather than a blank box).
     */
    fun projectUiState(
        data: DetailCardsData?,
        isLoading: Boolean,
    ): UiState<DetailCardsData> =
        when {
            isLoading -> UiState.loading()
            data != null -> UiState(phase = UiPhase.Content, data = data)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The four Temperature Details rows in web source order. Each value is the SI-Celsius temperature run
     * through [displayTemp]: a null reading renders the em dash (web `displayTemp` null branch), otherwise the
     * value is converted to the user's display unit and formatted by the golden-pinned shared
     * [formatTemperature] (web `formatTemperature(c)` with no per-call precision, so it inherits the user's
     * configured precision or the temperature default).
     */
    fun temperatureRows(
        data: DetailCardsData,
        prefs: UnitPref,
        strings: DetailCardsStrings,
    ): List<DetailCardRow> =
        listOf(
            DetailCardRow(strings.frontMotorTemp, displayTemp(data.health.frontMotorTempC, prefs)),
            DetailCardRow(strings.rearMotorTemp, displayTemp(data.health.rearMotorTempC, prefs)),
            DetailCardRow(strings.inverterTemp, displayTemp(data.health.inverterTempC, prefs)),
            DetailCardRow(strings.batteryTemp, displayTemp(data.health.batteryTempC, prefs)),
        )

    /**
     * The five Power Summary rows in web source order, reproducing each web guard exactly:
     * - Peak Power: `peakPower > 0 ? fmtInt(peakPower) + ' kW' : '—'`.
     * - Avg Peak Power: `avgPowerMax > 0 ? fmtNumber(avgPowerMax, 1) + ' kW' : '—'`.
     * - Max Regen: `minRegenPower < 0 ? fmtNumber(abs(minRegenPower), 1) + ' kW' : '—'` (the chart's regen
     *   floor is negative when regen occurred).
     * - Total Regen: `stats ? formatEnergy(stats.regenEnergyWh, { precision: 1 }) : '—'` — SI watt-hours
     *   converted to the user's energy unit by the golden-pinned shared [formatEnergy].
     * - CO2 Saved: `stats ? fmtNumber(stats.co2SavedKg, 1) + ' kg' : '—'`.
     *
     * [locale] is the grouping/decimal-separator locale (web `fmtNumber`'s active locale); [prefs] supplies the
     * energy unit + the configured precision the shared energy formatter respects.
     */
    fun powerRows(
        data: DetailCardsData,
        prefs: UnitPref,
        locale: Locale,
        strings: DetailCardsStrings,
    ): List<DetailCardRow> {
        val peak =
            if (data.peakPowerKw > 0.0) {
                "${fmtNumber(data.peakPowerKw, PEAK_POWER_DECIMALS, locale)} $UNIT_KW"
            } else {
                EM_DASH
            }
        val avg =
            if (data.avgPowerMaxKw > 0.0) {
                "${fmtNumber(data.avgPowerMaxKw, ONE_FRACTION_DIGIT, locale)} $UNIT_KW"
            } else {
                EM_DASH
            }
        val maxRegen =
            if (data.minRegenPowerKw < 0.0) {
                "${fmtNumber(abs(data.minRegenPowerKw), ONE_FRACTION_DIGIT, locale)} $UNIT_KW"
            } else {
                EM_DASH
            }
        val totalRegen = data.stats?.let { formatEnergy(it.regenEnergyWh, prefs, ENERGY_PRECISION) } ?: EM_DASH
        val co2 = data.stats?.let { "${fmtNumber(it.co2SavedKg, ONE_FRACTION_DIGIT, locale)} $UNIT_KG" } ?: EM_DASH
        return listOf(
            DetailCardRow(strings.peakPower, peak),
            DetailCardRow(strings.avgPeakPower, avg),
            DetailCardRow(strings.maxRegen, maxRegen),
            DetailCardRow(strings.totalRegen, totalRegen),
            DetailCardRow(strings.co2Saved, co2),
        )
    }

    /**
     * The web `displayTemp(celsius, formatTemperature)` helper: a null reading renders the em dash, otherwise
     * the SI-Celsius value is converted to the user's unit and formatted by the golden-pinned shared
     * [formatTemperature]. The shared formatter also returns its em-dash fallback for a NaN/non-finite input,
     * so a present-but-bad reading degrades to the same dash the web shows.
     */
    fun displayTemp(
        celsius: Double?,
        prefs: UnitPref,
    ): String = if (celsius == null) EM_DASH else formatTemperature(celsius, prefs)

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`
     * (`Intl.NumberFormat` with equal min/max fraction digits, grouping, and ECMAScript `halfExpand`). A
     * non-finite value is coerced to 0 (web `safeNumber`), a signed zero is normalized to positive zero (so a
     * `-0.0` renders "0"/"0.0" like `Intl`), and [decimals] is clamped to `0..20`. Rounding is applied via
     * [BigDecimal.valueOf] — whose `Double.toString` shortest round-trip decimal matches the value ECMAScript
     * rounds — with [RoundingMode.HALF_UP] (half away from zero), so a boundary such as `1.005` rounds up to
     * `1.01` exactly as the web does, rather than on the binary double where Java's default rounding could
     * drift. The locale formatter then only applies grouping/separators over the already-rounded value.
     */
    fun fmtNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val normalized = if (safe == 0.0) 0.0 else safe
        val digits = decimals.coerceIn(0, MAX_FRACTION_DIGITS)
        val rounded = BigDecimal.valueOf(normalized).setScale(digits, RoundingMode.HALF_UP)
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = digits
                maximumFractionDigits = digits
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(rounded)
    }
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * temperature, power, or stats value — so a diagnostics line can never leak fleet telemetry.
 */
object DetailCardsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "DetailCards"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
