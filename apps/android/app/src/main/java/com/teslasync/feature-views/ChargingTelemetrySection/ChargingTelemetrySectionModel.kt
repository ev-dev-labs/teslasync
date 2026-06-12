// Pure, framework-free model + projection for the ChargingTelemetrySection feature view — the native
// analogue of everything the web component derives inline before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx). No Compose, no Android,
// no HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the vehicle-detail page) loads the
// `ChargingTelemetry` record and passes it down as a `chargingTelemetry: ChargingTelemetry | null | undefined`
// prop. When the prop is truthy it renders a responsive grid of eight `MetricCard`s; otherwise it renders the
// "No charging telemetry available" empty state. This file owns the parts the web expresses inline: the
// null-tolerant decode of the raw `/charging-telemetry/latest` JSON (web optional reads of the snake_case
// fields), the eight per-metric value strings (web `field != null ? `${fmtNumber(field)} unit` : '—'`,
// `charging_state ?? '—'`, and the two `useUnits` formatters), and the lifecycle projection onto the shared
// cache-then-network [UiState] (so the surface renders every state the P1/S8 layer can carry).
//
// Two web display quirks are reproduced VERBATIM (honesty: no silent drift). The "Charger Power" tile shows
// the watt value `charger_power_w` with a literal "kW" suffix, and the "Energy Added" tile shows the
// watt-hour value `charge_energy_added_wh` with a literal "kWh" suffix — exactly as the web source does (it
// applies `fmtNumber` to the SI value and appends the kilo-unit label without dividing). The SI source is read
// straight from the API (Phase-48 SI-canonical rule); only the two `useUnits` metrics (Charge Rate, Range
// Added) pass through the display-unit converters, which is where the user's unit preference applies.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargingTelemetrySection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingtelemetrysection

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** The web `'—'` empty-value fallback (em dash U+2014). */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ChargingTelemetrySectionRegistration {
    /** Stable surface id. */
    const val ID: String = "charging-telemetry-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / vehicle data. */
    const val SLUG: String = "ChargingTelemetrySection"
}

/**
 * One decoded `GET /charging-telemetry/latest` reading — the native mirror of the parts of the web
 * `ChargingTelemetry` type (web/src/api/types.ts) this surface reads. Field names mirror the Go API's
 * snake_case JSON tags, and every value is read verbatim from the API in SI canonical units: power in watts
 * (`charger_power_w`), voltage in volts, current in amperes, energy added in watt-hours
 * (`charge_energy_added_wh`), range added in meters and meters-per-hour, battery level as a percentage. A
 * `null` field is an absent reading (web `number | null`). Parsing is null-tolerant so a partial body never
 * throws.
 *
 * @property chargerPowerW charger power, watts — web `charger_power_w`.
 * @property chargerVoltage charger voltage, volts — web `charger_voltage`.
 * @property chargerActualCurrent charger actual current, amperes — web `charger_actual_current`.
 * @property chargeEnergyAddedWh energy added this session, watt-hours — web `charge_energy_added_wh`.
 * @property chargingState the textual charging state — web `charging_state`.
 * @property batteryLevel state of charge, percent — web `battery_level`.
 * @property rangeAddedMetersPerHour rated range added per hour, meters/hour — web `range_added_meters_per_hour`.
 * @property rangeAddedMeters rated range added this session, meters — web `range_added_meters`.
 */
data class ChargingTelemetrySnapshot(
    val chargerPowerW: Double?,
    val chargerVoltage: Double?,
    val chargerActualCurrent: Double?,
    val chargeEnergyAddedWh: Double?,
    val chargingState: String?,
    val batteryLevel: Double?,
    val rangeAddedMetersPerHour: Double?,
    val rangeAddedMeters: Double?,
) {
    companion object {
        private const val KEY_CHARGER_POWER_W = "charger_power_w"
        private const val KEY_CHARGER_VOLTAGE = "charger_voltage"
        private const val KEY_CHARGER_ACTUAL_CURRENT = "charger_actual_current"
        private const val KEY_CHARGE_ENERGY_ADDED_WH = "charge_energy_added_wh"
        private const val KEY_CHARGING_STATE = "charging_state"
        private const val KEY_BATTERY_LEVEL = "battery_level"
        private const val KEY_RANGE_ADDED_METERS_PER_HOUR = "range_added_meters_per_hour"
        private const val KEY_RANGE_ADDED_METERS = "range_added_meters"

        /**
         * Project a `GET /charging-telemetry/latest` body into a tolerant snapshot, or `null` when the body is
         * absent / not an object — the web parity for the outer `chargingTelemetry ?` truthy gate (a missing
         * record renders the "No charging telemetry available" empty state). A present-but-partial object
         * decodes with `null` for every missing field, exactly as the web optional reads degrade.
         */
        fun fromJson(element: JsonElement?): ChargingTelemetrySnapshot? {
            val obj = element as? JsonObject ?: return null
            return ChargingTelemetrySnapshot(
                chargerPowerW = obj.numberOrNull(KEY_CHARGER_POWER_W),
                chargerVoltage = obj.numberOrNull(KEY_CHARGER_VOLTAGE),
                chargerActualCurrent = obj.numberOrNull(KEY_CHARGER_ACTUAL_CURRENT),
                chargeEnergyAddedWh = obj.numberOrNull(KEY_CHARGE_ENERGY_ADDED_WH),
                chargingState = obj.stringOrNull(KEY_CHARGING_STATE),
                batteryLevel = obj.numberOrNull(KEY_BATTERY_LEVEL),
                rangeAddedMetersPerHour = obj.numberOrNull(KEY_RANGE_ADDED_METERS_PER_HOUR),
                rangeAddedMeters = obj.numberOrNull(KEY_RANGE_ADDED_METERS),
            )
        }

        /** Reads a numeric (or numeric-string) property, or `null` when absent / non-numeric. */
        private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

        /** Reads a string property, or `null` when absent / not a JSON string (incl. JSON null). */
        private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    }
}

/**
 * The eight metrics the section renders, in the exact web grid order. Each id maps to a localized label, an
 * authored lucide glyph, and a categorical accent color at the Compose boundary, so the pure projection stays
 * free of any Compose / resource type.
 */
enum class ChargingTelemetryMetric {
    ChargerPower,
    Voltage,
    Current,
    EnergyAdded,
    ChargingState,
    BatteryLevel,
    ChargeRate,
    RangeAdded,
}

/**
 * One already-formatted metric tile — the native mirror of a web `<MetricCard>`. [value] is the fully
 * formatted, unit-suffixed display string (or the web `'—'` fallback when the source field is null); [metric]
 * resolves the localized label, glyph, and accent color at the Compose boundary.
 */
data class ChargingTelemetryTile(
    val metric: ChargingTelemetryMetric,
    val value: String,
)

/**
 * The injected display formatters the tile projection needs — the native analogue of the web `fmtNumber`
 * (bound to the global precision/locale) plus the two `useUnits` formatters this surface uses. Injecting them
 * keeps the projection locale/precision/unit-preference deterministic for the off-device tests.
 *
 * @property number web `fmtNumber(v)` — locale grouping at the user's precision (no unit).
 * @property distance web `useUnits().formatDistance(meters)` — SI meters → the user's display distance string.
 * @property speed web `useUnits().formatSpeed(metersPerSecond)` — SI m/s → the user's display speed string.
 */
data class ChargingTelemetryFormatters(
    val number: (Double) -> String,
    val distance: (Double) -> String,
    val speed: (Double) -> String,
)

/**
 * Pure projection from the section's inputs to its render state — a 1:1 port of the web component's inline
 * value formatting and its content/empty boundary. Stateless and side-effect-free so it is fully covered by
 * the off-device unit gate; the composable only resolves localized strings, glyphs, and colors and draws what
 * these return.
 */
object ChargingTelemetrySectionProjection {
    /** Charger-power unit label — the literal web `kW` suffix (applied to the SI watt value, web quirk). */
    private const val UNIT_KILOWATTS: String = "kW"

    /** Charger-voltage unit label — the web `V` suffix. */
    private const val UNIT_VOLTS: String = "V"

    /** Charger-current unit label — the web `A` suffix. */
    private const val UNIT_AMPERES: String = "A"

    /** Energy-added unit label — the literal web `kWh` suffix (applied to the SI watt-hour value, web quirk). */
    private const val UNIT_KILOWATT_HOURS: String = "kWh"

    /** Battery-level unit label — the web `%` suffix. */
    private const val UNIT_PERCENT: String = "%"

    /** Seconds per hour — the web `range_added_meters_per_hour / 3600` meters/hour → meters/second conversion. */
    const val SECONDS_PER_HOUR: Double = 3600.0

    /**
     * Maps the section's `(snapshot, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8).
     * The web component itself has no loading/error surface (its parent owns those); this adapter adds the
     * lifecycle states the host's feed can carry while preserving web precedence:
     *  - loading → [UiPhase.Loading];
     *  - not loading + snapshot present → [UiPhase.Content] (the eight-tile grid, web `chargingTelemetry ?`);
     *  - not loading + no snapshot → [UiPhase.Empty] (the web "No charging telemetry available" outcome).
     */
    fun projectUiState(
        snapshot: ChargingTelemetrySnapshot?,
        isLoading: Boolean,
    ): UiState<ChargingTelemetrySnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * Builds the eight render-ready tiles from a loaded [snapshot], in the exact web grid order — the native
     * mirror of the eight `<MetricCard value={…}>` derivations. Each numeric tile reproduces the web
     * `field != null ? `${fmtNumber(field)} unit` : '—'` (with the SI value passed verbatim to the kilo-unit
     * labels for power/energy, the web quirk); Charging State reproduces the web `charging_state ?? '—'`
     * (only a null state falls back, a present value — even blank — is shown as-is); Charge Rate converts
     * meters/hour to meters/second (`/3600`) before the speed formatter, and Range Added formats the SI
     * meters — both exactly as the web `useUnits` calls do.
     */
    fun tiles(
        snapshot: ChargingTelemetrySnapshot,
        formatters: ChargingTelemetryFormatters,
    ): List<ChargingTelemetryTile> =
        listOf(
            numericTile(ChargingTelemetryMetric.ChargerPower, snapshot.chargerPowerW, UNIT_KILOWATTS, formatters),
            numericTile(ChargingTelemetryMetric.Voltage, snapshot.chargerVoltage, UNIT_VOLTS, formatters),
            numericTile(ChargingTelemetryMetric.Current, snapshot.chargerActualCurrent, UNIT_AMPERES, formatters),
            numericTile(ChargingTelemetryMetric.EnergyAdded, snapshot.chargeEnergyAddedWh, UNIT_KILOWATT_HOURS, formatters),
            ChargingTelemetryTile(ChargingTelemetryMetric.ChargingState, snapshot.chargingState ?: EM_DASH),
            percentTile(ChargingTelemetryMetric.BatteryLevel, snapshot.batteryLevel, formatters),
            ChargingTelemetryTile(
                ChargingTelemetryMetric.ChargeRate,
                snapshot.rangeAddedMetersPerHour?.let { formatters.speed(it / SECONDS_PER_HOUR) } ?: EM_DASH,
            ),
            ChargingTelemetryTile(
                ChargingTelemetryMetric.RangeAdded,
                snapshot.rangeAddedMeters?.let { formatters.distance(it) } ?: EM_DASH,
            ),
        )

    /** Web `field != null ? `${fmtNumber(field)} ${unit}` : '—'` — a space-joined value + unit, or em dash. */
    private fun numericTile(
        metric: ChargingTelemetryMetric,
        value: Double?,
        unit: String,
        formatters: ChargingTelemetryFormatters,
    ): ChargingTelemetryTile = ChargingTelemetryTile(metric, value?.let { "${formatters.number(it)} $unit" } ?: EM_DASH)

    /** Web `field != null ? `${fmtNumber(field)}%` : '—'` — the value with a directly-appended `%`, or em dash. */
    private fun percentTile(
        metric: ChargingTelemetryMetric,
        value: Double?,
        formatters: ChargingTelemetryFormatters,
    ): ChargingTelemetryTile = ChargingTelemetryTile(metric, value?.let { "${formatters.number(it)}$UNIT_PERCENT" } ?: EM_DASH)
}

/**
 * Locale-aware number formatting that reproduces the web `numberFormat` helper (`fmtNumber`,
 * web/src/lib/numberFormat.ts) the tiles use. Pure (JVM-tested): a non-finite value is coerced to `0` exactly
 * as the web `safeNumber`, and grouping/precision follow `Intl.NumberFormat` with equal min/max fraction
 * digits (`String.format`'s `HALF_UP` matches ECMAScript `halfExpand`). The composable binds this into a
 * [ChargingTelemetryFormatters] from the live unit prefs.
 */
object ChargingTelemetryFormat {
    /** Web `numberFormat` default precision (`_globalPrecision`), used when settings carry none. */
    const val DEFAULT_PRECISION: Int = 2

    private const val MAX_PRECISION: Int = 20

    /** Web `fmtNumber(v, decimals)` — `safeNumber` then locale grouping at [precision] fraction digits. */
    fun number(
        value: Double,
        precision: Int,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val digits = precision.coerceIn(0, MAX_PRECISION)
        return String.format(locale, "%,.${digits}f", safe)
    }
}

/** Resource name (by-name; absent ⇒ [ChargingTelemetrySectionDefaults.RANGE_ADDED]) for web `vehicles.detail.rangeAdded`. */
const val KEY_RANGE_ADDED: String = "translation_vehicles_detail_rangeAdded"

/**
 * Native fallback microcopy. Nine of the surface's ten i18n keys (`vehicles.detail.chargingTelemetry`,
 * `…chargerPower`, `…voltage`, `…current`, `…energyAdded`, `…chargingState`, `…batteryLevel`, `…chargeRate`,
 * `…noChargingTelemetry`) exist in the i18n catalog (P1/S10) and resolve at compile time. This default backs
 * the one key the catalog does not yet define — `vehicles.detail.rangeAdded` — reproducing i18next's "return
 * the default when the key is absent" behaviour, so the "Range Added" tile still carries the web's English
 * fallback verbatim while routing through the i18n facade.
 */
object ChargingTelemetrySectionDefaults {
    /** Web `t('vehicles.detail.rangeAdded', 'Range Added')` default — the catalog-absent tile label. */
    const val RANGE_ADDED: String = "Range Added"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChargingTelemetrySectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect. Carries no VIN, location, or charging value — only the surface slug.
 */
fun recordChargingTelemetrySectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChargingTelemetrySectionRegistration.SLUG))
}
