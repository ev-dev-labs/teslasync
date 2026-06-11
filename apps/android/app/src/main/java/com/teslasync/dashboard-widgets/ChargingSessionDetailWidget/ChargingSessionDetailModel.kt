// Pure, framework-free model + projection for the ChargingSessionDetail dashboard widget — the native
// analogue of the data the web component computes via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web reads the legacy display fields `duration_min` / `power_kw` / `battery_level` ?? `soc` /
// `created_at`. None of those exist in the SI-canonical contract this surface binds to (the generated
// `ChargingSession` / `ChargeTelemetryReading` DTOs from api/openapi/teslasync.openapi.json). So the SI
// equivalents are derived here, documented at each site:
//   • Energy added (kWh)  = total_energy_added_wh / 1000        (web convertEnergyFromSI(_, 'kWh'))
//   • Duration            = ended_at − started_at, in minutes   (web duration_min ?? 0; the Go
//                           ChargingSession.DurationMinutes derives the same from the two instants)
//   • Per-reading power   = max(ac_charging_power_w, dc_charging_power_w) / 1000 kW   (web power_kw)
//   • SoC overlay         = start_soc_pct → end_soc_pct interpolated across the telemetry timeline —
//                           per-reading SoC is absent from the SI telemetry contract, so the curve is
//                           reconstructed from the session's authoritative SI SoC bounds.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ChargingSessionDetailWidget — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package
// identifier), so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingsessiondetail

import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.Vehicle
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact = size.cols <= 1` / `isWide = size.cols >= 3` branches in the web source: a single column
 * renders the big-kWh hero, wider footprints render the summary stats above the charge curve.
 */
data class ChargingSessionDetailSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact big-number hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `size.cols >= 3`): use the wider axis ticks. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts (`charging-session-detail`). A dashboard grid
 * host binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object ChargingSessionDetailRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "charging-session-detail"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "ChargingSessionDetailWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = ChargingSessionDetailSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = ChargingSessionDetailSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = ChargingSessionDetailSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: ChargingSessionDetailSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargingSessionDetailSize): ChargingSessionDetailSize =
        ChargingSessionDetailSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The charger-type bucket a session is classified into — the native union of the web `classifyCharger`
 * result. Each maps to a localized label and a badge accent at the render boundary.
 */
enum class ChargerKind { AcHome, Supercharger, DcFast }

/**
 * The combined snapshot driving the surface — the session [detail] (web `useChargingSessionDetail`) plus
 * its [telemetry] readings (web `useChargeTelemetry`). A null [detail] is the web `!detail` empty gate
 * (no vehicle, no charging sessions, or the detail resolved to nothing); the telemetry drives the power
 * curve, the SoC overlay and the peak-power figure. Pure data so the projection is unit-tested without a
 * UI host or network.
 */
data class ChargingSessionDetailSnapshot(
    val detail: ChargingSession?,
    val telemetry: List<ChargeTelemetryReading> = emptyList(),
)

/**
 * One projected, display-ready summary stat — the native analogue of a web `ChartSummaryStat`. Holds the
 * localized [label], the formatted [value] and the optional [unit] suffix (`kWh`/`kW`, absent for the
 * duration and charger stats). Pure data — no Compose types.
 */
data class ChargingSessionDetailStat(
    val label: String,
    val value: String,
    val unit: String? = null,
)

/**
 * One projected, render-ready point of the charge curve — the native analogue of a single web `ChartDatum`.
 * Holds the X-axis [timeLabel] (24-hour local `HH:mm`, matching the web), the real [powerKw] (power Area +
 * accessibility), the real [socPct] (SoC overlay + accessibility) and the [socPlotted] value pre-scaled
 * onto the shared power-kW axis so the single-axis Compose `ComboChart` can overlay the two series the way
 * the web `ComposedChart` does with its dual Y axes. A null value is a gap the chart bridges across (web
 * `connectNulls`). Pure data so the geometry is unit-tested without a UI host.
 */
data class ChargeCurvePoint(
    val timeLabel: String,
    val powerKw: Double?,
    val socPct: Double?,
    val socPlotted: Double?,
)

/**
 * The fully projected charge-curve chart — the native analogue of the web recharts `ComposedChart`
 * (a power `Area` on the left axis + a dashed SoC `Line` on the right axis). Holds the [points], the
 * localized series names and the power-axis upper bound. Pure data so the projection is unit-tested
 * without a UI host.
 */
data class ChargeCurveChart(
    val points: List<ChargeCurvePoint>,
    val powerSeriesName: String,
    val socSeriesName: String,
    val powerAxisMaxKw: Double,
) {
    /** True when there is at least one sample to plot (web `chartData.length > 0`). */
    val hasPoints: Boolean get() = points.isNotEmpty()
}

/**
 * The fully projected, render-ready view of the latest charge session for one footprint — the native
 * analogue of everything the web component computes via `useMemo` before returning JSX. Carries the
 * compact big-number fields, the summary stats, the charge-curve chart, the classified charger, and the
 * folded TalkBack descriptions. Pure data so the projection is unit-tested without a UI host.
 */
data class ChargingSessionDetailDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val hasData: Boolean,
    val compactEnergyText: String,
    val compactUnitLabel: String,
    val chargerLabel: String,
    val charger: ChargerKind,
    val stats: List<ChargingSessionDetailStat>,
    val chart: ChargeCurveChart,
    val compactContentDescription: String,
    val chartContentDescription: String,
)

/**
 * Localized labels the surface folds into its output. The pure [ChargingSessionDetailProjection] reads
 * every field; the composable builds this from `stringResource`, while tests pass a deterministic instance.
 * Keeping i18n out of the projection lets the projection stay a pure, locale-stable function. The charger
 * labels reuse existing catalog keys (`charging.curve.acHome` / `charging.curve.dcFast` / `Supercharger`),
 * so the web's hardcoded `classifyCharger` labels are localized here rather than hardcoded in native code.
 */
data class ChargingSessionDetailStrings(
    val energy: String,
    val duration: String,
    val peakPower: String,
    val charger: String,
    val powerSeries: String,
    val socSeries: String,
    val unitKwh: String,
    val chargerAcHome: String,
    val chargerSupercharger: String,
    val chargerDcFast: String,
)

/**
 * Pure projection from a [ChargingSessionDetailSnapshot] to the [ChargingSessionDetailDisplay] — the native
 * port of the `chartData` / `stats` / `durationStr` / `peakPower` / `charger` `useMemo` work plus the
 * `classifyCharger` / `isCompact` gating in the web source. Energy is converted from SI watt-hours to kWh
 * exactly as the web `convertEnergyFromSI(_, 'kWh')` does (a fixed `wh / 1000`, never the user's unit
 * preference); every label resolves through the injected [ChargingSessionDetailStrings].
 */
object ChargingSessionDetailProjection {
    /** The energy unit the chart and stats are expressed in (web literal `'kWh'`). */
    const val ENERGY_UNIT = "kWh"

    /** The power unit the peak-power stat is expressed in (web literal `'kW'`). */
    const val POWER_UNIT = "kW"

    /** Watt-hours per kilowatt-hour (web `convertEnergyFromSI(_, 'kWh')` divides by this). */
    const val WATT_HOURS_PER_KWH = 1000.0

    /** Watts per kilowatt (telemetry power is SI watts; the chart + peak stat are kW). */
    const val WATTS_PER_KW = 1000.0

    /** Headroom added above the tallest sample for the power axis (web `domain={[0, 'dataMax + 5']}`). */
    const val POWER_AXIS_HEADROOM_KW = 5.0

    /** The SoC axis spans a fixed 0..100% (web right axis `domain={[0, 100]}`). */
    const val SOC_AXIS_MAX = 100.0

    private const val MINUTES_PER_HOUR = 60L

    /** Resolve the primary vehicle id the web reads as `vehicleId ?? vehicles?.[0]?.id`. */
    fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id

    /**
     * Resolve the newest session's id by `started_at` — the web `latestSessionId` reduce
     * (`list.reduce((a, b) => new Date(a.startedAt) > new Date(b.startedAt) ? a : b)`). Returns null for a
     * null/empty list (web `latestSessionId === null`).
     */
    fun latestSessionId(sessions: List<ChargingSession>?): Long? {
        val list = sessions ?: return null
        return list.maxByOrNull { it.startedAt.toEpochMilliseconds() }?.id
    }

    /** Classify a raw charger-type label into a bucket — the native port of `classifyCharger`. */
    fun classify(chargerType: String?): ChargerKind {
        if (chargerType.isNullOrEmpty()) return ChargerKind.AcHome
        val ct = chargerType.lowercase(Locale.US)
        return when {
            ct.contains("supercharger") || ct.contains("tesla") -> ChargerKind.Supercharger
            ct != "<invalid>" -> ChargerKind.DcFast
            else -> ChargerKind.AcHome
        }
    }

    /**
     * The per-reading charger power in kW — the SI equivalent of the web `power_kw`. The active leg
     * (AC or DC; the inactive one is ~0/absent) is `max(ac_charging_power_w, dc_charging_power_w)`,
     * converted from watts. Null when neither leg is present, a gap the curve bridges (web `connectNulls`).
     */
    fun powerKwOf(reading: ChargeTelemetryReading): Double? {
        val watts = listOfNotNull(reading.acChargingPowerW, reading.dcChargingPowerW).maxOrNull() ?: return null
        return watts / WATTS_PER_KW
    }

    /** The peak charger power across the telemetry in kW (web `reduce(max, power_kw ?? 0, 0)`). */
    fun peakPowerKw(telemetry: List<ChargeTelemetryReading>): Double =
        telemetry.fold(0.0) { max, reading -> maxOf(max, powerKwOf(reading) ?: 0.0) }

    /**
     * The session duration in whole minutes, or null when the session has no end yet. Mirrors the Go
     * `ChargingSession.DurationMinutes` (`ended_at − started_at`); the web reads the server's equivalent
     * `duration_min`.
     */
    fun durationMinutes(detail: ChargingSession): Long? {
        val end = detail.endedAt ?: return null
        val minutes = (end - detail.startedAt).inWholeMinutes
        return if (minutes >= 0) minutes else null
    }

    /**
     * The session duration formatted as the web `durationStr` does: `<60 → "{m}m"`, otherwise `"{h}h {m}m"`
     * (or `"{h}h"` when the minute remainder is zero). A session with no end yet reads as `0m` (the web
     * `duration_min ?? 0` when detail is present, matching the Go derivation's null → 0 fallback).
     */
    fun durationText(detail: ChargingSession): String {
        val minutes = durationMinutes(detail) ?: 0L
        if (minutes < MINUTES_PER_HOUR) return "${minutes}m"
        val hours = minutes / MINUTES_PER_HOUR
        val rest = minutes % MINUTES_PER_HOUR
        return if (rest > 0) "${hours}h ${rest}m" else "${hours}h"
    }

    /**
     * Reconstruct the per-reading SoC by linearly interpolating the session's authoritative SI SoC bounds
     * (`start_soc_pct` → `end_soc_pct`) across its `started_at`..`ended_at` window, evaluated at [tsMillis].
     * Per-reading SoC is absent from the SI telemetry contract, so this rebuilds the web `battery_level ??
     * soc` overlay from the real session bounds. Returns null (no overlay) when any bound is missing or the
     * window is non-positive.
     */
    fun socAt(
        tsMillis: Long,
        detail: ChargingSession,
    ): Double? {
        val end = detail.endedAt
        val start = detail.startSocPct
        val finish = detail.endSocPct
        if (end == null || start == null || finish == null) return null
        val startMillis = detail.startedAt.toEpochMilliseconds()
        val span = end.toEpochMilliseconds() - startMillis
        return if (span <= 0) {
            null
        } else {
            val fraction = (1.0 * (tsMillis - startMillis) / span).coerceIn(0.0, 1.0)
            start + (finish - start) * fraction
        }
    }

    /** Project the empty (no detail) display for [size] using the localized [strings]. */
    fun projectEmpty(
        size: ChargingSessionDetailSize,
        strings: ChargingSessionDetailStrings,
    ): ChargingSessionDetailDisplay {
        val charger = ChargerKind.AcHome
        return ChargingSessionDetailDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            hasData = false,
            compactEnergyText = formatNumber(0.0, decimals = 1),
            compactUnitLabel = strings.unitKwh,
            chargerLabel = chargerLabel(charger, strings),
            charger = charger,
            stats = emptyList(),
            chart = ChargeCurveChart(emptyList(), strings.powerSeries, strings.socSeries, POWER_AXIS_HEADROOM_KW),
            compactContentDescription = strings.unitKwh,
            chartContentDescription = strings.powerSeries,
        )
    }

    /**
     * Project [snapshot] for [size] using [strings] for every label and [zone] for the `HH:mm` axis labels
     * (injected so the time labels are unit-tested deterministically regardless of the host time zone).
     */
    fun project(
        snapshot: ChargingSessionDetailSnapshot,
        size: ChargingSessionDetailSize,
        strings: ChargingSessionDetailStrings,
        zone: ZoneId = ZoneId.systemDefault(),
    ): ChargingSessionDetailDisplay {
        val detail = snapshot.detail ?: return projectEmpty(size, strings)
        val telemetry = snapshot.telemetry

        val energyKwh = (detail.totalEnergyAddedWh ?: 0.0) / WATT_HOURS_PER_KWH
        val peakKw = peakPowerKw(telemetry)
        val charger = classify(detail.chargerType)
        val chargerLabel = chargerLabel(charger, strings)
        val energyText = formatNumber(energyKwh, decimals = 1)

        val chart = buildChart(detail, telemetry, peakKw, strings, zone)
        val stats =
            listOf(
                ChargingSessionDetailStat(strings.energy, energyText, ENERGY_UNIT),
                ChargingSessionDetailStat(strings.duration, durationText(detail)),
                ChargingSessionDetailStat(strings.peakPower, formatNumber(peakKw, decimals = 1), POWER_UNIT),
                ChargingSessionDetailStat(strings.charger, chargerLabel),
            )

        return ChargingSessionDetailDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            hasData = true,
            compactEnergyText = energyText,
            compactUnitLabel = strings.unitKwh,
            chargerLabel = chargerLabel,
            charger = charger,
            stats = stats,
            chart = chart,
            compactContentDescription = "$energyText ${strings.unitKwh}, $chargerLabel",
            chartContentDescription = chartDescription(chart, peakKw, strings),
        )
    }

    /** The localized label for a charger bucket (web `classifyCharger` label, lifted to existing i18n keys). */
    fun chargerLabel(
        charger: ChargerKind,
        strings: ChargingSessionDetailStrings,
    ): String =
        when (charger) {
            ChargerKind.AcHome -> strings.chargerAcHome
            ChargerKind.Supercharger -> strings.chargerSupercharger
            ChargerKind.DcFast -> strings.chargerDcFast
        }

    private fun buildChart(
        detail: ChargingSession,
        telemetry: List<ChargeTelemetryReading>,
        peakKw: Double,
        strings: ChargingSessionDetailStrings,
        zone: ZoneId,
    ): ChargeCurveChart {
        val axisMax = (peakKw + POWER_AXIS_HEADROOM_KW).takeIf { it > 0 } ?: POWER_AXIS_HEADROOM_KW
        val points =
            telemetry.map { reading ->
                val tsMillis = reading.ts.toEpochMilliseconds()
                val socPct = socAt(tsMillis, detail)
                ChargeCurvePoint(
                    timeLabel = timeLabel(tsMillis, zone),
                    powerKw = powerKwOf(reading),
                    socPct = socPct,
                    socPlotted = socPct?.let { it / SOC_AXIS_MAX * axisMax },
                )
            }
        return ChargeCurveChart(points, strings.powerSeries, strings.socSeries, axisMax)
    }

    private fun chartDescription(
        chart: ChargeCurveChart,
        peakKw: Double,
        strings: ChargingSessionDetailStrings,
    ): String =
        if (!chart.hasPoints) {
            strings.powerSeries
        } else {
            "${strings.powerSeries}, ${strings.socSeries}, ${chart.points.size}, " +
                "${strings.peakPower} ${formatNumber(peakKw, decimals = 1)} $POWER_UNIT"
        }

    private fun timeLabel(
        tsMillis: Long,
        zone: ZoneId,
    ): String {
        val local = Instant.ofEpochMilli(tsMillis).atZone(zone)
        return "%02d:%02d".format(local.hour, local.minute)
    }

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): grouped thousands and a fixed number of fraction
     * digits, coercing a non-finite value to 0 (web `safeNumber`). Uses [Locale.US] symbols so the output
     * is deterministic and matches the web default (en-US when no locale is supplied).
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).format(safe)
    }
}
