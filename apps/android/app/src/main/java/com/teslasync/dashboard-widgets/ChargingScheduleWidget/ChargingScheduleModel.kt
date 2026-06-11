// Pure, framework-free model + projection for the Charging Schedule dashboard widget — the native
// analogue of the data the web component computes (parseScheduleSignals + the useMemo timeline) before
// returning JSX (web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx). No Compose, no Android,
// no HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ChargingScheduleWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingschedule

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalValue
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

internal const val EM_DASH = "\u2014"

/** Canonical signal field names the schedule reads (web `parseScheduleSignals`). */
internal object ScheduleSignalKeys {
    const val MODE = "ScheduledChargingMode"
    const val PENDING = "ScheduledChargingPending"
    const val START_TIME = "ScheduledChargingStartTime"
    const val DEPARTURE_TIME = "ScheduledDepartureTime"
    const val CHARGE_LIMIT = "ChargeLimitSoc"
}

/** Wire values of `ScheduledChargingMode` (mapped to a label + badge tone). */
internal object ScheduleModeValues {
    const val START_AT = "StartAt"
    const val DEPART_BY = "DepartBy"
    const val OFF = "Off"
}

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the two size
 * branches in the web source: [isCompact] (`size.cols <= 1 && size.rows <= 1`) renders the charge-limit
 * hero, and [isTall] (`size.rows >= 2`) adds the current-level/status detail row beneath the timeline.
 */
data class ChargingScheduleSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a 1×1 footprint (web `size.cols <= 1 && size.rows <= 1`): show the compact charge-limit hero. */
    val isCompact: Boolean get() = cols <= 1 && rows <= 1

    /** True at two or more rows (web `size.rows >= 2`): show the extra current-level/status detail row. */
    val isTall: Boolean get() = rows >= 2
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts. A dashboard grid host binds this surface with
 * the same [ID] and honours the same min/max footprint, so the native + web grids stay in lockstep.
 */
object ChargingScheduleRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "charging-schedule"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "ChargingScheduleWidget"

    /** Default footprint: 2 columns × 2 rows. */
    val defaultSize = ChargingScheduleSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = ChargingScheduleSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = ChargingScheduleSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: ChargingScheduleSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargingScheduleSize): ChargingScheduleSize =
        ChargingScheduleSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The five schedule fields the web `parseScheduleSignals` extracts from the live-signal map, carried as
 * the typed primitives the backend emits. [pending] folds the web `=== true || === 'true'` coercion.
 */
data class ScheduleSignals(
    val mode: String?,
    val pending: Boolean,
    val startTime: String?,
    val departureTime: String?,
    val chargeLimit: Double?,
)

/**
 * The combined snapshot the widget renders for one vehicle — the live schedule [signals] (the primary,
 * freshness-bearing feed, web `useLiveSignals`) plus the auxiliary last-known vehicle [state] (web
 * `useVehicleState`, used only for the tall detail row). [state] is `null` until/unless the state feed
 * resolves, exactly as the web `stateData?.state` may be `undefined`.
 */
data class ChargingScheduleData(
    val signals: Map<String, SignalEnvelope>,
    val state: VehicleState?,
) {
    companion object {
        /** Empty snapshot (no signals, no state) — the no-vehicle / no-data starting point. */
        val EMPTY = ChargingScheduleData(signals = emptyMap(), state = null)
    }
}

/** Badge tone for the schedule mode chip — the port of the web `modeBadgeVariant`. */
enum class ChargeScheduleModeTone { Success, Warning, Neutral }

/** Glyph family for a timeline marker; mapped to a concrete `ImageVector` at the render boundary. */
enum class ScheduleGlyph { Zap, Clock, BatteryFull }

/** Semantic tone for a timeline marker; mapped to a concrete token color at the render boundary. */
enum class ScheduleTone { Success, Info, Warning }

/**
 * One projected, render-ready timeline row — the native port of an entry the web pushes into
 * `timelineItems`. Pure data (no Compose types): the resolved marker [glyph]/[tone], the localized
 * [title], the optional [subtitle] (the web "Pending" sub-label), the pre-formatted [time] label, and a
 * TalkBack [contentDescription] folding them into one phrase.
 */
data class ScheduleTimelineRow(
    val glyph: ScheduleGlyph,
    val tone: ScheduleTone,
    val title: String,
    val subtitle: String?,
    val time: String,
    val contentDescription: String,
)

/**
 * Localized labels + the schedule-time / relative-time formatters the surface folds into its output. The
 * pure [ChargingScheduleProjection] reads the labels + [formatTime]; the composable chrome additionally
 * reads [title] / [refreshLabel] / [refreshingLabel] / [offlineLabel] / [formatRelative]. The composable
 * builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n + locale/timezone
 * out of the projection lets the projection stay a pure, locale-stable function.
 */
data class ChargingScheduleStrings(
    val title: String,
    val modeStartAt: String,
    val modeDepartBy: String,
    val modeOff: String,
    val modeUnknown: String,
    val startCharging: String,
    val pending: String,
    val departure: String,
    val targetLimit: String,
    val limit: String,
    val noData: String,
    val noTimes: String,
    val currentLevel: String,
    val status: String,
    val charging: String,
    val notCharging: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatTime: (String?) -> String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * The fully projected, render-ready view of the schedule for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data so the projection is unit-tested
 * without a UI host.
 */
data class ChargingScheduleDisplay(
    val hasScheduleData: Boolean,
    val isCompact: Boolean,
    val isTall: Boolean,
    val modeLabel: String,
    val modeTone: ChargeScheduleModeTone,
    val pending: Boolean,
    val pendingLabel: String,
    val timelineRows: List<ScheduleTimelineRow>,
    val hasTimelineRows: Boolean,
    val noTimesLabel: String,
    val compactValueText: String,
    val compactLimitLabel: String,
    val compactContentDescription: String,
    val showStateRow: Boolean,
    val currentLevelLabel: String,
    val currentLevelValue: String,
    val statusLabel: String,
    val statusValue: String,
)

/**
 * Pure projection from a decoded [ChargingScheduleData] to the [ChargingScheduleDisplay] — the native
 * port of `parseScheduleSignals`, `modeLabel`/`modeBadgeVariant`, the `timelineItems` `useMemo`, and the
 * compact/tall branches in the web source. The charge limit is a dimensionless SOC percent (no SI
 * conversion); schedule times are formatted by the injected [ChargingScheduleStrings.formatTime] so the
 * projection stays locale/timezone-stable and deterministically unit-tested.
 */
object ChargingScheduleProjection {
    /** Reads the typed primitive behind [key], or `null` when the slot is absent (web `raw`). */
    private fun rawValue(
        signals: Map<String, SignalEnvelope>,
        key: String,
    ): SignalValue? = signals[key]?.value

    /**
     * Extracts the five schedule fields from the live-signal map — the port of the web
     * `parseScheduleSignals`, including its `typeof === 'string'` / `=== true || === 'true'` /
     * `typeof === 'number'` guards: a field of the wrong typed kind collapses to `null`/`false`.
     */
    fun parseScheduleSignals(signals: Map<String, SignalEnvelope>): ScheduleSignals {
        val mode = (rawValue(signals, ScheduleSignalKeys.MODE) as? SignalValue.Text)?.value
        val pending =
            when (val raw = rawValue(signals, ScheduleSignalKeys.PENDING)) {
                is SignalValue.Bool -> raw.value
                is SignalValue.Text -> raw.value == "true"
                else -> false
            }
        val startTime = (rawValue(signals, ScheduleSignalKeys.START_TIME) as? SignalValue.Text)?.value
        val departureTime = (rawValue(signals, ScheduleSignalKeys.DEPARTURE_TIME) as? SignalValue.Text)?.value
        val chargeLimit = (rawValue(signals, ScheduleSignalKeys.CHARGE_LIMIT) as? SignalValue.Num)?.value
        return ScheduleSignals(
            mode = mode,
            pending = pending,
            startTime = startTime,
            departureTime = departureTime,
            chargeLimit = chargeLimit,
        )
    }

    /** True when any of mode / start time / charge limit is present (web `hasScheduleData`). */
    fun hasScheduleData(schedule: ScheduleSignals): Boolean =
        schedule.mode != null || schedule.startTime != null || schedule.chargeLimit != null

    /** Localized mode label — the port of the web `modeLabel`. An unknown non-null mode is shown verbatim. */
    fun modeLabel(
        mode: String?,
        strings: ChargingScheduleStrings,
    ): String =
        when (mode) {
            ScheduleModeValues.START_AT -> strings.modeStartAt
            ScheduleModeValues.DEPART_BY -> strings.modeDepartBy
            ScheduleModeValues.OFF -> strings.modeOff
            else -> mode ?: strings.modeUnknown
        }

    /** Badge tone for [mode] — the port of the web `modeBadgeVariant`. */
    fun modeTone(mode: String?): ChargeScheduleModeTone =
        when (mode) {
            ScheduleModeValues.START_AT, ScheduleModeValues.DEPART_BY -> ChargeScheduleModeTone.Success
            ScheduleModeValues.OFF -> ChargeScheduleModeTone.Neutral
            else -> ChargeScheduleModeTone.Warning
        }

    /** Project [data] for [size] using the localized [strings]. */
    fun project(
        data: ChargingScheduleData,
        size: ChargingScheduleSize,
        strings: ChargingScheduleStrings,
    ): ChargingScheduleDisplay {
        val schedule = parseScheduleSignals(data.signals)
        val rows = projectTimeline(schedule, strings)
        val compactValueText = schedule.chargeLimit?.let { "${formatSoc(it)}%" } ?: strings.emDash
        val state = data.state
        val showStateRow = size.isTall && state != null

        return ChargingScheduleDisplay(
            hasScheduleData = hasScheduleData(schedule),
            isCompact = size.isCompact,
            isTall = size.isTall,
            modeLabel = modeLabel(schedule.mode, strings),
            modeTone = modeTone(schedule.mode),
            pending = schedule.pending,
            pendingLabel = strings.pending,
            timelineRows = rows,
            hasTimelineRows = rows.isNotEmpty(),
            noTimesLabel = strings.noTimes,
            compactValueText = compactValueText,
            compactLimitLabel = strings.limit,
            compactContentDescription = "${strings.limit}, $compactValueText",
            showStateRow = showStateRow,
            currentLevelLabel = strings.currentLevel,
            currentLevelValue = "${state?.batteryLevel ?: 0}%",
            statusLabel = strings.status,
            statusValue = if (state?.isCharging == true) strings.charging else strings.notCharging,
        )
    }

    /**
     * Builds the ordered timeline rows — the port of the web `timelineItems` `useMemo`: a start-charging
     * row (with the "Pending" sub-label when pending), a departure row, and a target-limit row, each added
     * only when its source field is present. The target-limit row mirrors the web `chargeLimit != null`
     * guard (the web's `?? undefined` fallback is vestigial: both `undefined` and `null` fail `!= null`,
     * so the row is shown exactly when `schedule.chargeLimit` is present).
     */
    private fun projectTimeline(
        schedule: ScheduleSignals,
        strings: ChargingScheduleStrings,
    ): List<ScheduleTimelineRow> =
        buildList {
            schedule.startTime?.let { start ->
                val subtitle = if (schedule.pending) strings.pending else null
                val time = strings.formatTime(start)
                add(
                    ScheduleTimelineRow(
                        glyph = ScheduleGlyph.Zap,
                        tone = ScheduleTone.Success,
                        title = strings.startCharging,
                        subtitle = subtitle,
                        time = time,
                        contentDescription = rowDescription(strings.startCharging, time, subtitle),
                    ),
                )
            }
            schedule.departureTime?.let { departure ->
                val time = strings.formatTime(departure)
                add(
                    ScheduleTimelineRow(
                        glyph = ScheduleGlyph.Clock,
                        tone = ScheduleTone.Info,
                        title = strings.departure,
                        subtitle = null,
                        time = time,
                        contentDescription = rowDescription(strings.departure, time, null),
                    ),
                )
            }
            schedule.chargeLimit?.let { limit ->
                val time = "${formatSoc(limit)}%"
                add(
                    ScheduleTimelineRow(
                        glyph = ScheduleGlyph.BatteryFull,
                        tone = ScheduleTone.Warning,
                        title = strings.targetLimit,
                        subtitle = null,
                        time = time,
                        contentDescription = rowDescription(strings.targetLimit, time, null),
                    ),
                )
            }
        }

    private fun rowDescription(
        title: String,
        time: String,
        subtitle: String?,
    ): String = if (subtitle == null) "$title, $time" else "$title, $time, $subtitle"

    /**
     * Formats a SOC percent the way the web interpolates a JS number (`${chargeLimit}%`): a whole value
     * renders with no decimals, a fractional value keeps its (locale-stable, trailing-zero-trimmed)
     * fraction. SOC is dimensionless, so there is no unit conversion.
     */
    fun formatSoc(value: Double): String =
        if (value % 1.0 == 0.0) {
            value.toLong().toString()
        } else {
            DecimalFormat("0.######", DecimalFormatSymbols(Locale.US)).format(value)
        }
}

/**
 * Resolves the vehicle the widget targets — the port of the web `vehicleId ?? vehicles?.[0]?.id ?? 0`:
 * an explicit [explicitVehicleId] wins (even `0`, matching JS `??`), otherwise the first enrolled
 * vehicle, otherwise `0` (no vehicle ⇒ the widget renders its empty state).
 */
fun resolveVehicleId(
    explicitVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long = explicitVehicleId ?: vehicles?.firstOrNull()?.id ?: 0L
