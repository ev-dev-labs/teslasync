// Pure, framework-free model + projection for the Drive Telemetry dashboard widget — the native
// analogue of the data the web component computes (via `useMemo`) before returning JSX
// (web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer. SI values (meters, m·s⁻¹) are converted to the user's display unit
// here, at the single render-boundary seam (Phase-48 SI-canonical rule; web `convertDistanceFromSI` /
// `convertSpeedFromSI` + `useUnits`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DriveTelemetryWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types and `TooManyFunctions` for the projection object's small helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.dashboard.widgets.drivetelemetry

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.DriveTelemetryReading
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlin.math.abs

private const val EM_DASH = "\u2014"
private const val LIST_SEPARATOR = ", "

/**
 * One snapshot the widget renders — the newest [Drive] for the resolved vehicle plus its
 * [telemetry] replay points. The native mirror of the web `latestDrive` + `useDriveTelemetry`
 * composition. A `null` [drive] is the web `!latestDrive` empty gate ("No recent drives"); a present
 * drive with empty [telemetry] is the web "No telemetry for this drive" chart-empty branch. Pure data
 * so the projection is unit-tested without a UI host or network.
 */
data class DriveTelemetrySnapshot(
    val drive: Drive?,
    val telemetry: List<DriveTelemetryReading> = emptyList(),
)

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size` plus
 * the `isCompact` / `isWide` branches in the web source: a single column renders the compact
 * summary-only layout, three-or-more columns add the elevation series and the start-address badge.
 */
data class DriveTelemetrySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact summary. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): elevation series + address badge. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val WIDE_MIN_COLS = 3

        /** Registry default footprint (2×4). */
        val Default: DriveTelemetrySize = DriveTelemetrySize(cols = 2, rows = 4)

        /** Registry minimum footprint (2×4). */
        val MinSize: DriveTelemetrySize = DriveTelemetrySize(cols = 2, rows = 4)

        /** Registry maximum footprint (4×40). */
        val MaxSize: DriveTelemetrySize = DriveTelemetrySize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: DriveTelemetrySize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: DriveTelemetrySize): DriveTelemetrySize =
            DriveTelemetrySize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`drive-telemetry`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object DriveTelemetryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "drive-telemetry"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DriveTelemetryWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: DriveTelemetrySize get() = DriveTelemetrySize.Default

    /** Minimum footprint: 2 columns × 4 rows. */
    val minSize: DriveTelemetrySize get() = DriveTelemetrySize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: DriveTelemetrySize get() = DriveTelemetrySize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: DriveTelemetrySize): Boolean = DriveTelemetrySize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DriveTelemetrySize): DriveTelemetrySize = DriveTelemetrySize.clamp(size)
}

/**
 * One projected, display-ready summary stat — the native analogue of a web `ChartSummaryStat`. Holds
 * the localized [label], the already-formatted [value] and the optional [unit] suffix. Pure data — no
 * Compose types.
 */
data class DriveTelemetryStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The fully projected, render-ready drive replay chart — the native analogue of the web recharts
 * `ComposedChart` (a power `Area` + speed/battery `Line`s on a shared "speed" axis and a faint
 * elevation `Area`, plus power on its own right axis). The web's two Y axes are folded onto one Compose
 * `ComboChart` axis exactly as the sibling ChargingSessionDetailWidget does: [speedValues] and
 * [batteryValues] are the raw display values that share the primary axis (web `yAxisId="speed"`), while
 * [powerValues] (and the wide-only [elevationValues]) are pre-scaled onto the same `[0, axisMax]` band
 * so their shapes overlay (the web's separate auto-scaled axes). A `null` sample is a gap the line
 * bridges across (web `connectNulls`). Pure data so the geometry is unit-tested without a UI host.
 */
data class DriveTelemetryChart(
    val timeLabels: List<String>,
    val speedValues: List<Double?>,
    val powerValues: List<Double?>,
    val batteryValues: List<Double?>,
    val elevationValues: List<Double?>,
    val axisMax: Double,
    val showElevation: Boolean,
) {
    /** True when there is at least one sample to plot (web `chartData.length > 0`). */
    val hasPoints: Boolean get() = timeLabels.isNotEmpty()
}

/**
 * The fully projected, render-ready view of one snapshot for one footprint — the native analogue of
 * everything the web component computes before returning JSX (the `stats` / `chartData` `useMemo`s and
 * the `isCompact` / `isWide` gating). Pure data so the projection is unit-tested without a UI host.
 */
data class DriveTelemetryDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val hasDrive: Boolean,
    val stats: List<DriveTelemetryStat>,
    val chart: DriveTelemetryChart,
    val startAddress: String?,
    val compactContentDescription: String,
    val chartContentDescription: String,
) {
    /** True when the wide start-address badge should render (web `isWide && latestDrive.startAddress`). */
    val hasAddressBadge: Boolean get() = isWide && !startAddress.isNullOrBlank()

    /** True when the chart has at least one telemetry sample to draw. */
    val hasTelemetry: Boolean get() = chart.hasPoints
}

/**
 * The localized series/stat labels the projection folds into its output, resolved from the P1/S10 i18n
 * catalog at the Compose boundary (`stringResource`) and passed in so [DriveTelemetryProjection.project]
 * stays pure and JVM-testable. Keys mirror the web `t('widget.driveTelemetry.*')` calls verbatim. The
 * title + "No recent drives" / "No telemetry for this drive" strings are render-only chrome (the
 * projection never needs them) and are resolved directly in the composable.
 */
data class DriveTelemetryLabels(
    val distance: String,
    val duration: String,
    val minute: String,
    val efficiency: String,
    val speed: String,
    val power: String,
    val battery: String,
    val elevation: String,
)

/**
 * Pure projection from a decoded [DriveTelemetrySnapshot] to the [DriveTelemetryDisplay] — the native
 * port of the `stats` / `chartData` `useMemo`s and the compact/standard/wide gating in the web source.
 * Distance/speed are converted from SI to the user's [UnitPref] exactly as the web `convertDistanceFromSI`
 * / `convertSpeedFromSI` do; efficiency is `energyUsedWh / displayDistance` (the web computation, which
 * divides Wh by the already-converted distance) labelled `Wh/mi` or `Wh/km`; every label resolves
 * through the injected [DriveTelemetryLabels].
 */
object DriveTelemetryProjection {
    /** Wh efficiency stat is rendered with no decimals (web `fmtNumber(efficiency, 0)`). */
    const val EFFICIENCY_DECIMALS: Int = 0

    /** Distance figures render with one decimal (web `fmtNumber(_, 1)`). */
    const val DISTANCE_DECIMALS: Int = 1

    /** The efficiency unit when the distance preference is miles (web `'Wh/mi'`). */
    const val EFFICIENCY_UNIT_MI: String = "Wh/mi"

    /** The efficiency unit for every non-mile distance preference (web `'Wh/km'`). */
    const val EFFICIENCY_UNIT_KM: String = "Wh/km"

    private const val SECONDS_PER_MINUTE = 60.0

    /** Headroom above the tallest speed/battery sample for the shared axis (web speed axis `dataMax + 10`). */
    private const val AXIS_HEADROOM = 10.0

    /** Floor for the shared axis / scaling references so an all-null/zero series never divides by zero. */
    private const val SCALE_FLOOR = 1.0

    /** Resolve the primary vehicle id the web reads as `vehicleId ?? vehicles?.[0]?.id`. */
    fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id

    /**
     * Resolve the newest drive by `start_ts` — the web `latestDrive` reduce
     * (`list.reduce((a, b) => new Date(a.startTs) > new Date(b.startTs) ? a : b)`). Returns null for a
     * null/empty list (web `list.length === 0 ? null`).
     */
    fun latestDrive(drives: List<Drive>?): Drive? = drives?.maxByOrNull { it.startTs.toEpochMilliseconds() }

    /** The efficiency unit suffix for the active distance preference (web `efficiencyUnit`). */
    fun efficiencyUnit(prefs: UnitPref): String =
        if (prefs.distance == DistanceUnitPref.MI) {
            EFFICIENCY_UNIT_MI
        } else {
            EFFICIENCY_UNIT_KM
        }

    /**
     * Project [snapshot] for [size] using [labels] for every localized string, [prefs] for the SI→display
     * conversion and [zone] for the `HH:mm` axis labels (injected so the time labels are unit-tested
     * deterministically regardless of the host time zone).
     */
    fun project(
        snapshot: DriveTelemetrySnapshot,
        size: DriveTelemetrySize,
        labels: DriveTelemetryLabels,
        prefs: UnitPref,
        zone: ZoneId = ZoneId.systemDefault(),
    ): DriveTelemetryDisplay {
        val drive = snapshot.drive ?: return projectEmpty(size, labels)
        val stats = buildStats(drive, labels, prefs)
        val chart = buildChart(snapshot.telemetry, size.isWide, prefs, zone)
        val startAddress = drive.startAddress?.takeIf { it.isNotBlank() }
        return DriveTelemetryDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            hasDrive = true,
            stats = stats,
            chart = chart,
            startAddress = startAddress,
            compactContentDescription = stats.joinToString(LIST_SEPARATOR) { statDescription(it) },
            chartContentDescription = chartDescription(chart, labels),
        )
    }

    /** Project the empty (no recent drive) display for [size] using the localized [labels]. */
    fun projectEmpty(
        size: DriveTelemetrySize,
        labels: DriveTelemetryLabels,
    ): DriveTelemetryDisplay =
        DriveTelemetryDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            hasDrive = false,
            stats = emptyList(),
            chart = emptyChart(),
            startAddress = null,
            compactContentDescription = "",
            chartContentDescription = labels.speed,
        )

    /**
     * The header summary stats (web `stats` memo): Distance (1 decimal + distance unit), Duration
     * (whole minutes + "min"), and — only when energy is known and the drive moved — Efficiency
     * (`energyUsedWh / displayDistance`, no decimals + `Wh/mi`|`Wh/km`).
     */
    fun buildStats(
        drive: Drive,
        labels: DriveTelemetryLabels,
        prefs: UnitPref,
    ): List<DriveTelemetryStat> {
        val displayDistance = convertDistanceFromSI(drive.distanceM, prefs.distance)
        val stats =
            mutableListOf(
                DriveTelemetryStat(labels.distance, formatNumber(displayDistance, DISTANCE_DECIMALS), prefs.distance.label),
                DriveTelemetryStat(labels.duration, formatInt(drive.durationS / SECONDS_PER_MINUTE), labels.minute),
            )
        val efficiency = efficiencyFor(drive, displayDistance)
        if (efficiency != null) {
            stats +=
                DriveTelemetryStat(
                    labels.efficiency,
                    efficiency.takeIf { it.isFinite() }?.let { formatNumber(it, EFFICIENCY_DECIMALS) } ?: EM_DASH,
                    efficiencyUnit(prefs),
                )
        }
        return stats
    }

    /**
     * The Wh-per-display-distance efficiency, or `null` when it is not derivable (web gate
     * `energyUsedWh != null && distanceM > 0`, then `distance > 0 ? energyUsedWh / distance : null`).
     * [displayDistance] is the already-converted distance the web divides by.
     */
    fun efficiencyFor(
        drive: Drive,
        displayDistance: Double,
    ): Double? {
        val energyWh = drive.energyUsedWh
        return if (energyWh != null && drive.distanceM > 0.0 && displayDistance > 0.0) {
            energyWh / displayDistance
        } else {
            null
        }
    }

    /**
     * Project the telemetry replay into ready-to-plot series — the native port of the web `chartData`
     * memo. Speed is converted to the display unit; battery is `battery_level ?? soc`; power and (when
     * [wide]) elevation are read verbatim then pre-scaled onto the shared `[0, axisMax]` speed band so
     * the single-axis `ComboChart` overlays the web's dual-axis series. The axis ceiling is the tallest
     * speed/battery sample plus headroom (web shared-axis `dataMax + 10`).
     */
    fun buildChart(
        telemetry: List<DriveTelemetryReading>,
        wide: Boolean,
        prefs: UnitPref,
        zone: ZoneId,
    ): DriveTelemetryChart {
        if (telemetry.isEmpty()) {
            return emptyChart()
        }
        val timeLabels = telemetry.map { timeLabel(it.createdAt.toEpochMilliseconds(), zone) }
        val speed = telemetry.map { r -> r.speed?.let { convertSpeedFromSI(it, prefs.speed) } }
        val battery = telemetry.map { r -> r.batteryLevel?.toDouble() ?: r.soc } // parity:allow Long-to-Double battery conversion
        val power = telemetry.map { it.power }
        val elevation = telemetry.map { it.elevation }

        val axisMax = (maxFinite(speed + battery) + AXIS_HEADROOM).coerceAtLeast(SCALE_FLOOR)
        val powerRef = absRef(power)
        val elevationRef = absRef(elevation)

        val showElevation = wide && elevation.any { it != null }
        return DriveTelemetryChart(
            timeLabels = timeLabels,
            speedValues = speed,
            powerValues = power.map { v -> v?.let { it / powerRef * axisMax } },
            batteryValues = battery,
            elevationValues =
                if (showElevation) elevation.map { v -> v?.let { it / elevationRef * axisMax } } else emptyList(),
            axisMax = axisMax,
            showElevation = showElevation,
        )
    }

    /** An all-empty chart (no telemetry): no points, no elevation, a floor axis so nothing divides by zero. */
    private fun emptyChart(): DriveTelemetryChart =
        DriveTelemetryChart(
            timeLabels = emptyList(),
            speedValues = emptyList(),
            powerValues = emptyList(),
            batteryValues = emptyList(),
            elevationValues = emptyList(),
            axisMax = SCALE_FLOOR,
            showElevation = false,
        )

    private fun statDescription(stat: DriveTelemetryStat): String =
        stat.unit?.let { "${stat.label}: ${stat.value} $it" } ?: "${stat.label}: ${stat.value}"

    private fun chartDescription(
        chart: DriveTelemetryChart,
        labels: DriveTelemetryLabels,
    ): String {
        if (!chart.hasPoints) return labels.speed
        val series = mutableListOf(labels.speed, labels.power, labels.battery)
        if (chart.showElevation) series += labels.elevation
        return (series + chart.timeLabels.size.toString()).joinToString(LIST_SEPARATOR)
    }

    /** The largest finite magnitude in [values], floored at [SCALE_FLOOR] so scaling never divides by zero. */
    private fun absRef(values: List<Double?>): Double {
        val finite = values.mapNotNull { it?.takeIf { v -> v.isFinite() } }
        val maxAbs = finite.maxOfOrNull { abs(it) } ?: 0.0
        return if (maxAbs > 0.0) maxAbs else SCALE_FLOOR
    }

    /** The largest finite value in [values], or 0 when there is none. */
    private fun maxFinite(values: List<Double?>): Double {
        val finite = values.mapNotNull { it?.takeIf { v -> v.isFinite() } }
        return finite.maxOrNull() ?: 0.0
    }

    private fun timeLabel(
        tsMillis: Long,
        zone: ZoneId,
    ): String {
        val local = Instant.ofEpochMilli(tsMillis).atZone(zone)
        return "%02d:%02d".format(local.hour, local.minute)
    }

    /**
     * Locale-stable decimal formatter matching the web `fmtNumber`: coerce a non-finite value to 0
     * (web `safeNumber`), then render with grouped thousands and a fixed number of fraction digits
     * using `halfExpand` (round half away from zero) rounding — the ECMAScript `Intl.NumberFormat`
     * default. Uses [Locale.US] symbols so the output is deterministic and matches the web default.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(safe(value))

    /** Locale-stable integer formatter (web `fmtInt` = `fmtNumber(v, 0)`), rounding half away from zero. */
    fun formatInt(value: Double): String = groupedFormat(decimals = 0).format(safe(value))

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).apply { roundingMode = RoundingMode.HALF_UP }
    }
}
