// Pure, framework-free model + projection for the Charging Telemetry dashboard widget — the native
// analogue of the data the web component computes (via `useMemo` / refs) before returning JSX
// (web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ChargingTelemetryWidget — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package
// identifier), so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.dashboard.widgets.chargingtelemetry

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.min
import kotlin.math.roundToInt

private const val EM_DASH = "\u2014"
private const val MIDDLE_DOT = "\u00b7"

/**
 * One decoded `GET /charging-telemetry/latest?vehicle_id=` reading — the native mirror of the web
 * `ChargingTelemetry` type (web/src/api/types.ts). Field names mirror the Go API's snake_case JSON
 * tags. Voltage is volts, current/pilot amperes, power watts (`charger_power_w`, SI canonical), all
 * read verbatim from the API; the web widget formats them for display only (and, for parity, labels
 * the power value "kW" exactly as the web source does — see [ChargingTelemetryProjection]). Parsing
 * is null-tolerant so a partial body never throws.
 */
data class ChargingTelemetrySnapshot(
    val chargingState: String?,
    val chargerVoltage: Double?,
    val chargerActualCurrent: Double?,
    val chargerPowerW: Double?,
    val chargerPhases: Int?,
    val chargerPilotCurrent: Double?,
    val ts: String?,
) {
    /** True only when the pack is actively charging (web `data?.charging_state === 'Charging'`). */
    val isCharging: Boolean get() = chargingState == CHARGING_STATE

    companion object {
        /** The wire `charging_state` value the web component gates the "is charging" body on. */
        const val CHARGING_STATE: String = "Charging"

        /**
         * Project a `GET /charging-telemetry/latest` body into a tolerant snapshot, or `null` when
         * the body is absent / not an object (web parity: the outer `data ?` falsy gate — both a
         * missing record and a non-object render the "Not currently charging" empty state).
         */
        fun fromJson(element: JsonElement): ChargingTelemetrySnapshot? {
            val obj = element as? JsonObject ?: return null
            return ChargingTelemetrySnapshot(
                chargingState = obj.stringOrNull("charging_state"),
                chargerVoltage = obj.numberOrNull("charger_voltage"),
                chargerActualCurrent = obj.numberOrNull("charger_actual_current"),
                chargerPowerW = obj.numberOrNull("charger_power_w"),
                chargerPhases = obj.numberOrNull("charger_phases")?.roundToInt(),
                chargerPilotCurrent = obj.numberOrNull("charger_pilot_current"),
                ts = obj.stringOrNull("ts"),
            )
        }
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` branches in the web source: a single column renders the compact charging
 * hero, four-or-more columns add the per-charger efficiency stat, the charger-type badge and the
 * rolling power sparkline.
 */
data class ChargingTelemetrySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at four or more columns (web `isWide = size.cols >= 4`): efficiency + badge + sparkline. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val WIDE_MIN_COLS = 4

        /** Registry default footprint (2×2). */
        val Default: ChargingTelemetrySize = ChargingTelemetrySize(cols = 2, rows = 2)

        /** Registry minimum footprint (1×2). */
        val MinSize: ChargingTelemetrySize = ChargingTelemetrySize(cols = 1, rows = 2)

        /** Registry maximum footprint (4×40). */
        val MaxSize: ChargingTelemetrySize = ChargingTelemetrySize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: ChargingTelemetrySize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: ChargingTelemetrySize): ChargingTelemetrySize =
            ChargingTelemetrySize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts. A dashboard grid host binds this surface
 * with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object ChargingTelemetryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "charging-telemetry"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChargingTelemetryWidget"

    /** Default footprint: 2 columns × 2 rows. */
    val defaultSize: ChargingTelemetrySize get() = ChargingTelemetrySize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: ChargingTelemetrySize get() = ChargingTelemetrySize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: ChargingTelemetrySize get() = ChargingTelemetrySize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: ChargingTelemetrySize): Boolean = ChargingTelemetrySize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargingTelemetrySize): ChargingTelemetrySize = ChargingTelemetrySize.clamp(size)
}

/** Glyph family for a stat tile; mapped to a concrete `ImageVector` at the render boundary. */
enum class ChargingTelemetryGlyph { Bolt, Gauge, BatteryCharging }

/**
 * Charger family derived from the live voltage (web heuristic: `voltage > 300 ? 'DC' : 'AC'`,
 * only while charging). [code] is the on-wire-free display token the web hard-codes (not an i18n
 * string); the badge tone is resolved at the render boundary (DC → warning, AC → neutral).
 */
enum class ChargerType(
    val code: String,
) {
    Ac("AC"),
    Dc("DC"),
}

/**
 * One projected, render-ready stat tile — the native analogue of a web `StatGridItem`. Pure data
 * (no Compose types): the localized [label], the already-formatted [value], an optional [unit]
 * suffix and the [glyph] the view maps to an icon.
 */
data class ChargingTelemetryStat(
    val label: String,
    val value: String,
    val unit: String?,
    val glyph: ChargingTelemetryGlyph,
)

/**
 * The fully projected, render-ready view of one telemetry snapshot for one footprint — the native
 * analogue of everything the web component computes before returning JSX (the `coreStats` /
 * `wideStats` / `chargerType` / compact-hero `useMemo`s). Pure data so the projection is unit-tested
 * without a UI host. The rolling power sparkline series is NOT here — it is accumulated across
 * emissions by the view-model (web `powerHistoryRef`) and supplied to the view separately.
 */
data class ChargingTelemetryDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val isCharging: Boolean,
    val stats: List<ChargingTelemetryStat>,
    val statColumns: Int,
    val chargerType: ChargerType?,
    val chargerBadgeText: String,
    val heroPowerText: String,
    val heroSummaryText: String,
    val compactContentDescription: String,
) {
    /** True when the wide charger-type badge should render (web `chargerType &&`). */
    val hasChargerBadge: Boolean get() = chargerType != null && chargerBadgeText.isNotEmpty()
}

/**
 * The localized stat/badge labels the projection folds into its output, resolved from the P1/S10
 * i18n catalog at the Compose boundary (`stringResource`) and passed in so
 * [ChargingTelemetryProjection.project] stays pure and JVM-testable. Keys mirror the web
 * `t('widget.chargingTelemetry.*')` calls verbatim. The title + "Not currently charging" strings are
 * render-only chrome (the projection never needs them) and are resolved directly in the composable.
 */
data class ChargingTelemetryLabels(
    val voltage: String,
    val current: String,
    val power: String,
    val phases: String,
    val efficiency: String,
    val charger: String,
)

/**
 * Pure projection from a decoded [ChargingTelemetrySnapshot] to the [ChargingTelemetryDisplay] — the
 * native port of the `coreStats` / `wideStats` / `efficiency` / `chargerType` `useMemo`s and the
 * compact-hero branch in the web source. Values are read verbatim from the API (the web widget does
 * no SI conversion here): voltage is formatted with no decimals + "V", current with no decimals +
 * "A", power with one decimal + "kW" (the web label, applied to `charger_power_w` exactly as the web
 * does), phases as an integer, efficiency with no decimals + "%".
 */
object ChargingTelemetryProjection {
    /** Voltage (V) above which the live charger is classified DC (web `voltage > 300`). */
    const val DC_VOLTAGE_THRESHOLD: Double = 300.0

    /** Efficiency is capped at 100% (web `Math.min(100, …)`). */
    const val MAX_EFFICIENCY: Double = 100.0

    private const val WATTS_PER_KILOWATT = 1000.0
    private const val PERCENT = 100.0
    private const val VOLTAGE_DECIMALS = 0
    private const val CURRENT_DECIMALS = 0
    private const val POWER_DECIMALS = 1
    private const val EFFICIENCY_DECIMALS = 0
    private const val WIDE_STAT_COLUMNS = 4
    private const val STANDARD_STAT_COLUMNS = 2
    private const val UNIT_VOLTS = "V"
    private const val UNIT_AMPERES = "A"
    private const val UNIT_KILOWATTS = "kW"
    private const val UNIT_PERCENT = "%"

    /** Project [snapshot] for [size] using [labels] for every localized string. */
    fun project(
        snapshot: ChargingTelemetrySnapshot?,
        size: ChargingTelemetrySize,
        labels: ChargingTelemetryLabels,
    ): ChargingTelemetryDisplay {
        val charging = snapshot?.isCharging == true
        val voltage = snapshot?.chargerVoltage ?: 0.0
        val current = snapshot?.chargerActualCurrent ?: 0.0
        val power = snapshot?.chargerPowerW ?: 0.0
        val phases = snapshot?.chargerPhases ?: 0
        val wide = size.isWide
        val chargerType = chargerTypeFor(charging, voltage)
        val efficiency = efficiencyFor(snapshot, charging)

        val stats =
            if (!charging) {
                emptyList()
            } else {
                coreStats(labels, voltage, current, power, phases) + efficiencyStat(labels, wide, efficiency)
            }
        val heroPowerText = "${formatNumber(power, POWER_DECIMALS)} $UNIT_KILOWATTS"
        val heroSummaryText =
            "${formatNumber(voltage, VOLTAGE_DECIMALS)}$UNIT_VOLTS $MIDDLE_DOT " +
                "${formatNumber(current, CURRENT_DECIMALS)}$UNIT_AMPERES"

        return ChargingTelemetryDisplay(
            isCompact = size.isCompact,
            isWide = wide,
            isCharging = charging,
            stats = stats,
            statColumns = if (wide) WIDE_STAT_COLUMNS else STANDARD_STAT_COLUMNS,
            chargerType = chargerType,
            chargerBadgeText = chargerType?.let { "${it.code} ${labels.charger}" } ?: "",
            heroPowerText = heroPowerText,
            heroSummaryText = heroSummaryText,
            compactContentDescription = "$heroPowerText, $heroSummaryText",
        )
    }

    /**
     * The four always-on charging stats (web `coreStats`), in the exact web grid order: voltage,
     * current, power, phases.
     */
    private fun coreStats(
        labels: ChargingTelemetryLabels,
        voltage: Double,
        current: Double,
        power: Double,
        phases: Int,
    ): List<ChargingTelemetryStat> =
        listOf(
            ChargingTelemetryStat(labels.voltage, formatNumber(voltage, VOLTAGE_DECIMALS), UNIT_VOLTS, ChargingTelemetryGlyph.Bolt),
            ChargingTelemetryStat(labels.current, formatNumber(current, CURRENT_DECIMALS), UNIT_AMPERES, ChargingTelemetryGlyph.Gauge),
            ChargingTelemetryStat(
                labels.power,
                formatNumber(power, POWER_DECIMALS),
                UNIT_KILOWATTS,
                ChargingTelemetryGlyph.BatteryCharging,
            ),
            ChargingTelemetryStat(
                labels.phases,
                if (phases > 0) formatInt(phases) else EM_DASH,
                null,
                ChargingTelemetryGlyph.Gauge,
            ),
        )

    /**
     * The wide-only efficiency stat (web `wideStats`): a single stat when [wide] and an [efficiency]
     * was derivable, otherwise nothing.
     */
    private fun efficiencyStat(
        labels: ChargingTelemetryLabels,
        wide: Boolean,
        efficiency: Double?,
    ): List<ChargingTelemetryStat> =
        if (wide && efficiency != null) {
            listOf(
                ChargingTelemetryStat(
                    labels.efficiency,
                    formatNumber(efficiency, EFFICIENCY_DECIMALS),
                    UNIT_PERCENT,
                    ChargingTelemetryGlyph.Gauge,
                ),
            )
        } else {
            emptyList()
        }

    /**
     * The live charger family, or `null` when not charging (web `chargerType` memo): DC above
     * [DC_VOLTAGE_THRESHOLD] volts, else AC.
     */
    fun chargerTypeFor(
        charging: Boolean,
        voltage: Double,
    ): ChargerType? =
        when {
            !charging -> null
            voltage > DC_VOLTAGE_THRESHOLD -> ChargerType.Dc
            else -> ChargerType.Ac
        }

    /**
     * The charging efficiency percentage, or `null` when it cannot be derived (web `efficiency`
     * memo): null unless charging with a positive pilot current and voltage; otherwise actual power
     * over the theoretical pilot capacity `(pilot × voltage × phases) / 1000`, capped at
     * [MAX_EFFICIENCY]. Power is read verbatim from `charger_power_w`, matching the web computation.
     */
    fun efficiencyFor(
        snapshot: ChargingTelemetrySnapshot?,
        charging: Boolean,
    ): Double? {
        if (snapshot == null || !charging) return null
        val pilot = snapshot.chargerPilotCurrent ?: 0.0
        val voltage = snapshot.chargerVoltage ?: 0.0
        val phases = snapshot.chargerPhases ?: 0
        val power = snapshot.chargerPowerW ?: 0.0
        val theoreticalPower = pilot * voltage * (if (phases > 0) phases else 1) / WATTS_PER_KILOWATT
        return if (pilot <= 0.0 || voltage <= 0.0 || theoreticalPower <= 0.0) {
            null
        } else {
            min(MAX_EFFICIENCY, power / theoreticalPower * PERCENT)
        }
    }

    /**
     * Locale-stable decimal formatter matching the web `fmtNumber`: coerce a non-finite value to 0
     * (web `safeNumber`), then render with grouped thousands and a fixed number of fraction digits.
     * Uses [Locale.US] grouping/decimal symbols so the output is deterministic and matches the web
     * default locale.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(safe(value))

    /** Locale-stable integer formatter (web `fmtInt` = `fmtNumber(v, 0)`). */
    fun formatInt(value: Int): String = groupedFormat(decimals = 0).format(value.toLong())

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US))
    }
}

/**
 * The rolling power-reading buffer the wide layout's sparkline draws — the native port of the web
 * `powerHistoryRef` ref. A new reading is appended only when the snapshot's [ChargingTelemetrySnapshot.ts]
 * differs from the last appended one (web `data.ts !== lastTsRef.current`), keeping at most
 * [MAX_POWER_HISTORY] of the most recent watt readings. Pure + immutable so it folds cleanly over the
 * emission stream and is unit-tested without coroutines.
 */
data class PowerHistoryAccumulator(
    val lastTs: String?,
    val values: List<Double>,
) {
    /**
     * Fold one [snapshot] in: a `null` snapshot or an unchanged `ts` is a no-op (returns `this`);
     * otherwise append `charger_power_w ?? 0` and trim to the most recent [MAX_POWER_HISTORY].
     */
    fun append(snapshot: ChargingTelemetrySnapshot?): PowerHistoryAccumulator {
        if (snapshot == null || snapshot.ts == lastTs) return this
        val power = snapshot.chargerPowerW ?: 0.0
        val next = (values + power).let { if (it.size > MAX_POWER_HISTORY) it.takeLast(MAX_POWER_HISTORY) else it }
        return PowerHistoryAccumulator(lastTs = snapshot.ts, values = next)
    }

    companion object {
        /** Maximum readings retained (web `MAX_POWER_HISTORY`). */
        const val MAX_POWER_HISTORY: Int = 30

        /** The pre-emission accumulator (web initial empty ref). */
        val EMPTY: PowerHistoryAccumulator = PowerHistoryAccumulator(lastTs = null, values = emptyList())
    }
}

/** Reads a numeric (or numeric-string) property, or `null` when absent / non-numeric. */
private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Reads a string property, or `null` when absent / not a JSON string (incl. JSON null). */
private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
