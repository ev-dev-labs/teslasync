package io.teslasync.android.widgets

/**
 * The home-screen size bucket a widget is rendering at (P3/A8). Glance reports the available size via
 * `LocalSize`; the widget snaps it to one of these classes and the pure [content specs][vehicleStatusMetrics]
 * below decide which fields fit, so the same snapshot drives the compact and medium/large layouts.
 */
enum class WidgetSizeClass {
    /** ~2x1 — the densest layout: headline value(s) only. */
    Compact,

    /** ~4x2 — the default layout: headline plus a small metric grid. */
    Medium,

    /** ~4x3+ — the roomiest layout: every metric. */
    Large,
}

/** The lifecycle/FSM state a vehicle-status widget reflects (drive / charge / park / sleep / online). */
enum class VehicleFsmState {
    Driving,
    Charging,
    Parked,
    Asleep,
    Online,
    Offline,
    Unknown,
}

/**
 * Folds the backend vehicle-state string (`state.state`) and the live charging flag into a
 * [VehicleFsmState]. Charging wins over the coarse online/parked string so a plugged-in car reads as
 * charging; the remaining tokens map case-insensitively, with anything unrecognised as [Unknown].
 */
fun vehicleFsmStateOf(
    state: String?,
    isCharging: Boolean,
): VehicleFsmState {
    val token = state?.trim()?.lowercase().orEmpty()
    return when {
        isCharging -> VehicleFsmState.Charging
        token.startsWith("driv") -> VehicleFsmState.Driving
        token.startsWith("charg") -> VehicleFsmState.Charging
        token.startsWith("park") -> VehicleFsmState.Parked
        token.startsWith("asleep") || token.startsWith("sleep") || token == "suspended" -> VehicleFsmState.Asleep
        token == "online" -> VehicleFsmState.Online
        token == "offline" -> VehicleFsmState.Offline
        else -> VehicleFsmState.Unknown
    }
}

/** Whether the charging widget is actively charging, idle (not charging), or in an unknown state. */
enum class ChargingPhase {
    Charging,
    Idle,
    Unknown,
}

/** Alert severity tier, mirroring the web `AlertSeverity` (`info | warning | critical`). */
enum class AlertSeverity {
    Critical,
    Warning,
    Info,
}

/** Maps a raw severity string (case-insensitive; `warn`/`warning` and `error`→critical) to [AlertSeverity]. */
fun alertSeverityOf(raw: String?): AlertSeverity {
    val token = raw?.trim()?.lowercase().orEmpty()
    return when (token) {
        "critical", "error", "fatal", "severe" -> AlertSeverity.Critical
        "warning", "warn" -> AlertSeverity.Warning
        else -> AlertSeverity.Info
    }
}

// ── Per-widget content (display-ready; SI already converted via the shared UnitFormatter) ──────────

/**
 * Vehicle-status content (display-ready). [socPercent] is kept as the integer for the battery ring;
 * every other figure is a localized string (or the em-dash fallback) so the Glance layer renders text.
 */
data class VehicleStatusContent(
    val vehicleName: String,
    val fsmState: VehicleFsmState,
    val socPercent: Int?,
    val socText: String,
    val rangeText: String,
    val insideTempText: String,
    val isLocked: Boolean?,
)

/** Charging content (display-ready). Null detail strings are simply omitted by the renderer. */
data class ChargingContent(
    val phase: ChargingPhase,
    val socPercent: Int?,
    val socText: String,
    val targetSocText: String?,
    val powerText: String?,
    val etaText: String?,
    val sessionSummaryText: String?,
)

/** Quick-stats content (display-ready fleet summary). */
data class QuickStatsContent(
    val energyText: String,
    val costText: String,
    val distanceText: String,
    val efficiencyText: String,
    val drivesCount: Int,
    val chargesCount: Int,
)

/** Alerts content (counts + latest + quiet-hours indication). */
data class AlertsContent(
    val criticalCount: Int,
    val unreadCount: Int,
    val totalCount: Int,
    val latestTitle: String?,
    val latestSeverity: AlertSeverity?,
    val quietHoursActive: Boolean,
)

// ── Size-driven content specs (pure; tested per size) ──────────────────────────────────────────────

/** A vehicle-status secondary metric shown beneath the battery headline. */
enum class VehicleStatusMetric {
    Range,
    Temperature,
    Lock,
}

/** The vehicle-status metrics that fit at [size]: compact shows range only; medium/large add temp + lock. */
fun vehicleStatusMetrics(size: WidgetSizeClass): List<VehicleStatusMetric> =
    when (size) {
        WidgetSizeClass.Compact -> listOf(VehicleStatusMetric.Range)
        WidgetSizeClass.Medium, WidgetSizeClass.Large ->
            listOf(VehicleStatusMetric.Range, VehicleStatusMetric.Temperature, VehicleStatusMetric.Lock)
    }

/** A charging-widget detail row. */
enum class ChargingDetail {
    Power,
    Eta,
    Target,
    SessionSummary,
}

/** The charging details that fit at [size]: compact drops the charge-limit target row. */
fun chargingDetails(size: WidgetSizeClass): List<ChargingDetail> =
    when (size) {
        WidgetSizeClass.Compact -> listOf(ChargingDetail.Power, ChargingDetail.Eta, ChargingDetail.SessionSummary)
        WidgetSizeClass.Medium, WidgetSizeClass.Large ->
            listOf(ChargingDetail.Power, ChargingDetail.Eta, ChargingDetail.Target, ChargingDetail.SessionSummary)
    }

/** A quick-stats metric tile. */
enum class QuickStatMetric {
    Distance,
    Energy,
    Cost,
    Efficiency,
    Drives,
    Charges,
}

/** The quick-stats tiles that fit at [size]: 2 compact, 4 medium, all 6 large. */
fun quickStatsMetrics(size: WidgetSizeClass): List<QuickStatMetric> =
    when (size) {
        WidgetSizeClass.Compact -> listOf(QuickStatMetric.Distance, QuickStatMetric.Energy)
        WidgetSizeClass.Medium ->
            listOf(QuickStatMetric.Distance, QuickStatMetric.Energy, QuickStatMetric.Cost, QuickStatMetric.Efficiency)
        WidgetSizeClass.Large ->
            listOf(
                QuickStatMetric.Distance,
                QuickStatMetric.Energy,
                QuickStatMetric.Cost,
                QuickStatMetric.Efficiency,
                QuickStatMetric.Drives,
                QuickStatMetric.Charges,
            )
    }

/** Whether the alerts widget shows the latest-alert title row (compact shows counts only). */
fun alertsShowsLatest(size: WidgetSizeClass): Boolean = size != WidgetSizeClass.Compact

private const val MEDIUM_MIN_WIDTH_DP: Int = 220
private const val LARGE_MIN_WIDTH_DP: Int = 240
private const val LARGE_MIN_HEIGHT_DP: Int = 200

/**
 * Snaps the available widget cell size (in dp) to a [WidgetSizeClass] — the single, tested rule the
 * Glance layer applies to `LocalSize`. Large needs both a wide and a tall cell; a wide-but-short cell
 * is medium; anything narrower is compact.
 */
fun widgetSizeClassOf(
    widthDp: Int,
    heightDp: Int,
): WidgetSizeClass =
    when {
        widthDp >= LARGE_MIN_WIDTH_DP && heightDp >= LARGE_MIN_HEIGHT_DP -> WidgetSizeClass.Large
        widthDp >= MEDIUM_MIN_WIDTH_DP -> WidgetSizeClass.Medium
        else -> WidgetSizeClass.Compact
    }
