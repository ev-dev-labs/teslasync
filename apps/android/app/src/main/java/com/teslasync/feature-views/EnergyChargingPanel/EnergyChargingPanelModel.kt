// The pure, framework-free model + projection for the EnergyChargingPanel feature view — the native analogue of
// everything the web component derives from its `chargingTelemetry` prop before it returns JSX
// (web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent passes a `ChargingTelemetry | null | undefined`; its only
// hooks are `useTranslation` (i18n) and `useUnits` (the `formatSpeed` helper). When telemetry is present it renders
// a titled GlassPanel holding a two-column MetricCard grid (Charger Voltage in V, Charger Current in A) over four
// label/value rows (Charger Power, Energy Added, Battery Level, Charge Rate) and a colored Charging-State chip;
// when telemetry is absent it renders a friendly EmptyState. This file owns exactly those derivations: the slice of
// the prop it reads ([ChargingTelemetrySnapshot]), the display preferences resolved from one `/settings` document
// (the native binding of the web `useUnits` read, [EnergyChargingDisplayPrefs]), the lifecycle projection onto the
// shared cache-then-network [UiState] (so the surface renders every state the P1/S8 layer can carry), the
// render-ready value of every field reproducing each web `fmtNumber`/`fmtWithUnit`/`formatSpeed` call exactly, the
// charging-state semantic classification, the merged accessibility labels, and the PII-safe `view.opened`
// diagnostic (P1/S11).
//
// Verbatim-parity note (web source L52-L56 and L63-L67): the web renders Charger Power as
// `fmtWithUnit(charger_power_w, 'kW')` and Energy Added as `fmtWithUnit(charge_energy_added_wh, 'kWh')` — it labels
// the raw SI watt / watt-hour value with a kW / kWh suffix WITHOUT dividing by 1000. This native port reproduces
// that exactly ([powerValue] / [energyAddedValue] do no division), because the web source IS the specification; a
// "corrected" /1000 here would be silent drift away from the surface it must match. Only the Charge Rate is unit-
// converted, through the shared SI [formatSpeed] (web `useUnits().formatSpeed(range_added_meters_per_hour / 3600)`).
//
// Number formatting mirrors web `lib/numberFormat` (`fmtNumber`/`fmtWithUnit`): the global decimal precision
// (settings `decimal_precision`, default 2), the `safeNumber` coercion of a non-finite value to 0, locale grouping,
// and ECMAScript `halfExpand` (HALF_UP) rounding so 0.125 renders "0.13" on both platforms. The speed figure
// delegates to the golden-tested shared `formatSpeed`, which receives the raw (possibly-null) settings precision so
// it matches the web `useUnits` formatter's precision contract rather than the fmtNumber global default.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EnergyChargingPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.energychargingpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatSpeed
import kotlinx.serialization.json.JsonElement
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** The em-dash sentinel rendered for an absent value (web `'—'`); also the freshness "unknown age" fallback. */
internal const val EM_DASH: String = "\u2014"

/** Web `fmtNumber` global precision default (`numberFormat._globalPrecision`); settings `decimal_precision`. */
private const val DEFAULT_PRECISION: Int = 2

/** BCP-47 fallback locale (web `fmtNumber` global locale default). */
private const val DEFAULT_LOCALE_TAG: String = "en-US"

/** Seconds in an hour — the web `range_added_meters_per_hour / 3600` metres-per-hour → metres-per-second divisor. */
private const val SECONDS_PER_HOUR: Double = 3600.0

/** Percent suffix on the Battery Level value (web `` `${fmtNumber(battery_level)}%` ``). */
private const val PERCENT: String = "%"

/** Volt unit symbol on the Charger Voltage MetricCard (web `subtitle="V"`); a language-neutral SI symbol. */
private const val VOLT_UNIT: String = "V"

/** Ampere unit symbol on the Charger Current MetricCard (web `subtitle="A"`); a language-neutral SI symbol. */
private const val AMP_UNIT: String = "A"

/** A single space joining a number to its unit label (web `` `${n} ${unit}` ``). */
private const val UNIT_SPACE: String = " "

/** Connector between a row's label and its value in the merged accessibility reading ("label: value"). */
private const val A11Y_LABEL_VALUE: String = ": "

/** Web `charging_state === 'Charging'` — the cyan "actively charging" chip state. */
private const val STATE_CHARGING: String = "Charging"

/** Web `charging_state === 'Complete'` — the green "charge complete" chip state. */
private const val STATE_COMPLETE: String = "Complete"

/**
 * The slice of the web `chargingTelemetry` prop this surface reads (web `ChargingTelemetry`), all SI and all
 * nullable exactly as the API serves them. Charger figures are derived SI (volts / amperes / watts), energy is
 * watt-hours, the battery level is a percentage, and [rangeAddedMetersPerHour] is metres of range added per hour
 * (despite its proto lineage it is a distance-per-time the web treats as a speed via `formatSpeed`).
 *
 * @property chargerVoltage charger voltage in volts (web `charger_voltage`), or null.
 * @property chargerActualCurrent charger actual current in amperes (web `charger_actual_current`), or null.
 * @property chargerPowerW charger power in watts, SI (web `charger_power_w`), or null.
 * @property chargeEnergyAddedWh energy added in watt-hours, SI (web `charge_energy_added_wh`), or null.
 * @property chargingState the raw Tesla charging-state string (web `charging_state`), or null.
 * @property batteryLevel battery level percentage (web `battery_level`), or null.
 * @property rangeAddedMetersPerHour range added in metres per hour (web `range_added_meters_per_hour`), or null.
 */
data class ChargingTelemetrySnapshot(
    val chargerVoltage: Double?,
    val chargerActualCurrent: Double?,
    val chargerPowerW: Double?,
    val chargeEnergyAddedWh: Double?,
    val chargingState: String?,
    val batteryLevel: Double?,
    val rangeAddedMetersPerHour: Double?,
)

/**
 * The semantic identity of the Charging-State chip — the locale-independent native mirror of the web component's
 * three-way `charging_state === 'Charging' ? cyan : charging_state === 'Complete' ? green : gray` branch. The chip
 * color is resolved from this kind at the Compose boundary (P1/S9 tokens), keeping this enum free of any color or
 * Android dependency.
 */
enum class ChargingStateKind {
    /** Web `'Charging'` — actively charging (cyan chip). */
    Charging,

    /** Web `'Complete'` — charge complete (green chip). */
    Complete,

    /** Any other or absent state (gray chip). */
    Other,

    ;

    companion object {
        /** Classifies a raw `charging_state` string into a chip [ChargingStateKind] (web equality branch). */
        fun fromRaw(state: String?): ChargingStateKind =
            when (state) {
                STATE_CHARGING -> Charging
                STATE_COMPLETE -> Complete
                else -> Other
            }
    }
}

/**
 * The display preferences this surface resolves from the live `/settings` document — the native binding of the web
 * `useUnits` read (speed display unit + locale + precision), derived via [UnitPreferences.fromSettings]. Resolved
 * once at the Compose boundary and threaded into the pure projection.
 *
 * @property units the SI → display unit preferences; [UnitPref.speed] drives the Charge Rate conversion, and the
 *   (possibly-null) [UnitPref.precision] is handed to [formatSpeed] so it matches the web `useUnits` precision rule.
 * @property locale the locale driving number grouping/separators (web `fmtNumber` global locale).
 * @property precision the default fraction digits for `fmtNumber` (web global precision, settings `decimal_precision`).
 */
data class EnergyChargingDisplayPrefs(
    val units: UnitPref,
    val locale: Locale,
    val precision: Int,
) {
    companion object {
        /** The metric / en-US / 2-decimal defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: EnergyChargingDisplayPrefs = from(null)

        /** Resolves the speed unit + locale + precision preferences from one `/settings` document. */
        fun from(settings: JsonElement?): EnergyChargingDisplayPrefs {
            val units = UnitPreferences.fromSettings(settings)
            return EnergyChargingDisplayPrefs(
                units = units,
                locale = localeFor(units.locale),
                precision = units.precision ?: DEFAULT_PRECISION,
            )
        }
    }
}

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the render-ready
 * model carries no English literal. Keys map 1:1 to the web `t()` calls; [unknown] backs the chip's
 * `charging_state ?? t('common.unknown')` fallback and [kw] / [kwh] are the (resource-backed) unit words the web
 * passes as literals to `fmtWithUnit`.
 */
data class EnergyChargingStrings(
    val title: String,
    val chargerVoltage: String,
    val chargerCurrent: String,
    val chargerPower: String,
    val energyAdded: String,
    val chargingState: String,
    val batteryLevel: String,
    val chargeRate: String,
    val unknown: String,
    val noData: String,
    val kw: String,
    val kwh: String,
)

/**
 * The fields the panel renders, in web source order. Identity only — labels resolve from the i18n catalog and the
 * Charge-Rate glyph from the design tokens at the Compose boundary, keeping this enum free of any Android or i18n
 * dependency.
 */
enum class ChargingMetric {
    Voltage,
    Current,
    Power,
    EnergyAdded,
    ChargingState,
    BatteryLevel,
    ChargeRate,
}

/**
 * One render-ready MetricCard — the two top-grid cells (web `<MetricCard label value subtitle />`). [value] is
 * pre-formatted (or [EM_DASH]) and [unit] is the card subtitle (`V` / `A`).
 */
data class EnergyChargingMetricTile(
    val metric: ChargingMetric,
    val label: String,
    val value: String,
    val unit: String,
)

/** One render-ready label/value row — the web `flex justify-between` rows (Power, Energy Added, Battery, Rate). */
data class EnergyChargingDetailRow(
    val metric: ChargingMetric,
    val label: String,
    val value: String,
)

/** The render-ready Charging-State row — its [label], the resolved [text], and the chip [kind] (web colored chip). */
data class EnergyChargingStateRow(
    val label: String,
    val text: String,
    val kind: ChargingStateKind,
)

/**
 * The fully projected, render-ready content — the two MetricCards, the four detail rows, and the Charging-State row,
 * each already localized and formatted. The composable only lays these out and colors the chip / title.
 */
data class EnergyChargingContent(
    val voltage: EnergyChargingMetricTile,
    val current: EnergyChargingMetricTile,
    val power: EnergyChargingDetailRow,
    val energyAdded: EnergyChargingDetailRow,
    val chargingState: EnergyChargingStateRow,
    val batteryLevel: EnergyChargingDetailRow,
    val chargeRate: EnergyChargingDetailRow,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's per-field branches, conversions,
 * and formats. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable
 * only resolves localized strings + design-token accents and draws what these return.
 */
object EnergyChargingPanelProjection {
    /**
     * Maps the web `chargingTelemetry` prop onto the shared cache-then-network [UiState] (P1/S8), reproducing the
     * web component's two outcomes: a present telemetry object → [UiPhase.Content] (the metric grid, even when every
     * field is null and every value renders `—`); a missing object → [UiPhase.Empty] (the web `EmptyState`). The
     * host's stateful binding can additionally carry loading/refreshing/stale/offline/error; the composable renders
     * those too. This parity adapter only produces the states the web prop can express.
     */
    fun projectUiState(snapshot: ChargingTelemetrySnapshot?): UiState<ChargingTelemetrySnapshot> =
        if (snapshot != null) {
            UiState(phase = UiPhase.Content, data = snapshot)
        } else {
            UiState(phase = UiPhase.Empty, data = null)
        }

    /** Projects [snapshot] into the seven render-ready cells, formatting each value for [prefs] and labeling via [strings]. */
    fun content(
        snapshot: ChargingTelemetrySnapshot,
        prefs: EnergyChargingDisplayPrefs,
        strings: EnergyChargingStrings,
    ): EnergyChargingContent =
        EnergyChargingContent(
            voltage =
                EnergyChargingMetricTile(
                    metric = ChargingMetric.Voltage,
                    label = strings.chargerVoltage,
                    value = voltageValue(snapshot, prefs),
                    unit = VOLT_UNIT,
                ),
            current =
                EnergyChargingMetricTile(
                    metric = ChargingMetric.Current,
                    label = strings.chargerCurrent,
                    value = currentValue(snapshot, prefs),
                    unit = AMP_UNIT,
                ),
            power =
                EnergyChargingDetailRow(
                    metric = ChargingMetric.Power,
                    label = strings.chargerPower,
                    value = powerValue(snapshot, prefs, strings),
                ),
            energyAdded =
                EnergyChargingDetailRow(
                    metric = ChargingMetric.EnergyAdded,
                    label = strings.energyAdded,
                    value = energyAddedValue(snapshot, prefs, strings),
                ),
            chargingState =
                EnergyChargingStateRow(
                    label = strings.chargingState,
                    text = chargingStateText(snapshot, strings),
                    kind = ChargingStateKind.fromRaw(snapshot.chargingState),
                ),
            batteryLevel =
                EnergyChargingDetailRow(
                    metric = ChargingMetric.BatteryLevel,
                    label = strings.batteryLevel,
                    value = batteryValue(snapshot, prefs),
                ),
            chargeRate =
                EnergyChargingDetailRow(
                    metric = ChargingMetric.ChargeRate,
                    label = strings.chargeRate,
                    value = chargeRateValue(snapshot, prefs),
                ),
        )

    /** Web `charger_voltage != null ? fmtNumber(charger_voltage) : '—'`. */
    fun voltageValue(
        snapshot: ChargingTelemetrySnapshot,
        prefs: EnergyChargingDisplayPrefs,
    ): String = snapshot.chargerVoltage?.let { formatNumber(it, prefs.locale, prefs.precision) } ?: EM_DASH

    /** Web `charger_actual_current != null ? fmtNumber(charger_actual_current) : '—'`. */
    fun currentValue(
        snapshot: ChargingTelemetrySnapshot,
        prefs: EnergyChargingDisplayPrefs,
    ): String = snapshot.chargerActualCurrent?.let { formatNumber(it, prefs.locale, prefs.precision) } ?: EM_DASH

    /**
     * Web `charger_power_w != null ? fmtWithUnit(charger_power_w, 'kW') : '—'` — reproduced verbatim: the raw SI watt
     * value is labeled `kW` WITHOUT a /1000 conversion (see the file-header verbatim-parity note, web source L52-L56).
     */
    fun powerValue(
        snapshot: ChargingTelemetrySnapshot,
        prefs: EnergyChargingDisplayPrefs,
        strings: EnergyChargingStrings,
    ): String = snapshot.chargerPowerW?.let { formatWithUnit(it, strings.kw, prefs.locale, prefs.precision) } ?: EM_DASH

    /**
     * Web `charge_energy_added_wh != null ? fmtWithUnit(charge_energy_added_wh, 'kWh') : '—'` — reproduced verbatim:
     * the raw SI watt-hour value is labeled `kWh` WITHOUT a /1000 conversion (web source L63-L67).
     */
    fun energyAddedValue(
        snapshot: ChargingTelemetrySnapshot,
        prefs: EnergyChargingDisplayPrefs,
        strings: EnergyChargingStrings,
    ): String = snapshot.chargeEnergyAddedWh?.let { formatWithUnit(it, strings.kwh, prefs.locale, prefs.precision) } ?: EM_DASH

    /** Web `battery_level != null ? `${fmtNumber(battery_level)}%` : '—'`. */
    fun batteryValue(
        snapshot: ChargingTelemetrySnapshot,
        prefs: EnergyChargingDisplayPrefs,
    ): String = snapshot.batteryLevel?.let { formatNumber(it, prefs.locale, prefs.precision) + PERCENT } ?: EM_DASH

    /**
     * Web `range_added_meters_per_hour != null ? formatSpeed(range_added_meters_per_hour / 3600) : '—'` — the metres-
     * per-hour figure is converted to metres-per-second and handed to the golden-tested shared [formatSpeed], which
     * applies the user's speed unit, locale, and (raw, possibly-null) settings precision exactly as web `useUnits` does.
     */
    fun chargeRateValue(
        snapshot: ChargingTelemetrySnapshot,
        prefs: EnergyChargingDisplayPrefs,
    ): String = snapshot.rangeAddedMetersPerHour?.let { formatSpeed(it / SECONDS_PER_HOUR, prefs.units) } ?: EM_DASH

    /** Web `charging_state ?? t('common.unknown', 'Unknown')` — the chip label. */
    fun chargingStateText(
        snapshot: ChargingTelemetrySnapshot,
        strings: EnergyChargingStrings,
    ): String = snapshot.chargingState ?: strings.unknown

    /**
     * Web `fmtNumber(value, decimals)` — a non-finite value is coerced to 0 (`safeNumber`), then rendered at the
     * global precision with locale grouping. HALF_UP matches `Number.prototype.toLocaleString`'s default "halfExpand"
     * rounding so 0.125 renders "0.13" on both platforms rather than diverging on banker's rounding.
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
     * Builds the merged TalkBack label for a label/value row — "<label>: <value>" — so each fact is announced as one
     * node. Pure string join so the accessible reading of every row is verifiable off-device.
     */
    fun accessibilityLabel(
        label: String,
        value: String,
    ): String = label + A11Y_LABEL_VALUE + value
}

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, charge level,
 * or owner movement, so a diagnostics line can never leak vehicle identity or behavior from this panel.
 */
const val ENERGY_CHARGING_PANEL_SLUG: String = "EnergyChargingPanel"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ENERGY_CHARGING_PANEL_SLUG] (P1/S11). Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its first-composition effect.
 */
fun recordEnergyChargingPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ENERGY_CHARGING_PANEL_SLUG))
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to en-US when blank/absent (web `fmtNumber` default). */
private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)
