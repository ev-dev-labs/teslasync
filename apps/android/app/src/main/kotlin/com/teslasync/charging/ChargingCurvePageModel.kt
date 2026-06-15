// Pure, framework-free model + projections for the ChargingCurvePage charging surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/charging/pages/ChargingCurvePage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// ChargingSession DTO and the sibling feature-view input shapes), so the composable stays a thin render layer.
//
// The web page owns three concerns this file ports: (1) the local interaction state — the selected session id
// (web `selectedSessionId` useState); (2) the cross-section `stats` the SummaryStatsGrid reads (web `useMemo`
// over the loaded `sessions`, summing energy/cost, averaging duration/rate and taking the peak rate); and (3)
// the per-feature-view fan-out — the web page threads the SAME loaded `sessions` array into SummaryStatsGrid,
// SessionComparisonChart, ChargerTypeChart, SpeedTrendChart and TimeToChargeSection, the selected session into
// SessionDetailPanel, and `generateChargingCurve(selectedSession)` into SessionCurveChart. The native feature
// views each declare their own minimal input shape, so this model maps the rich [ChargingSession] onto each.
//
// SI boundary (unit-conversion instructions): the page performs NO unit conversion here — energy stays in Wh and
// power in W exactly as the API serves them; the feature views convert at their own display boundary. The one
// figure the web SummaryStatsGrid labels "kWh" is the raw Wh sum (the web source's documented no-conversion
// contract, reproduced verbatim by the SummaryStatsGrid feature view), so [computeStats] sums `total_energy_added_wh`
// without dividing — the same figure the tested SummaryStatsGrid surface expects.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingcurve

import io.teslasync.android.featureviews.chargertypechart.ChargerSession
import io.teslasync.android.featureviews.sessioncomparisonchart.ChargingCurveSession
import io.teslasync.android.featureviews.sessioncomparisonchart.SessionComparisonChartProjection
import io.teslasync.android.featureviews.sessioncurvechart.CurvePoint
import io.teslasync.android.featureviews.speedtrendchart.ChargingSpeedSession
import io.teslasync.android.featureviews.summarystatsgrid.ChargingSummaryStats
import io.teslasync.android.featureviews.timetochargesection.TimeToChargeSession
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `ChargingCurvePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("chargingCurve", "/charging-curve", …)`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/charging-curve` deep link) without the nav module depending on it.
 */
object ChargingCurvePageRegistration {
    /** The navigation destination id (Destinations.kt `page("chargingCurve", "/charging-curve", …)`). */
    const val ROUTE_ID: String = "chargingCurve"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/charging-curve"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/session id. */
    const val SLUG: String = "ChargingCurvePage"

    /** The web `useChargingSessionsPaginated(activeVehicleId, { limit: 200 })` window the page reads. */
    const val SESSIONS_LIMIT: Int = 200
}

/**
 * The page's local interaction snapshot — the web component's `selectedSessionId` `useState` cell. `null` until
 * the operator picks a session from the selector (web `setSelectedSessionId(Number(...) || null)`); a session
 * that is no longer in the loaded list resolves to "none selected" at render, matching the web `find` returning
 * `undefined` after a range/vehicle change.
 *
 * @property selectedSessionId the session chosen for the single-session curve + detail, or `null` for none.
 */
data class ChargingCurveInteraction(
    val selectedSessionId: Long? = null,
)

// ── ChargingSession → feature-view input projections (web prop fan-out) ───────────────────────────────────────

/**
 * The slice of a [ChargingSession] the SessionComparisonChart / SessionCurveChart read (web `ChargingSession`
 * fields the curve generator touches). Timestamps are carried as ISO-8601 strings — the shape the feature view
 * declares — via [kotlin.time.Instant.toString], the inverse of the `Instant.parse` the web ISO strings round
 * through.
 */
fun ChargingSession.toCurveSession(): ChargingCurveSession =
    ChargingCurveSession(
        id = id,
        startedAt = startedAt.toString(),
        chargerType = chargerType,
        peakPowerW = peakPowerW,
        startSocPct = startSocPct,
        endSocPct = endSocPct,
    )

/** The slice the ChargerTypeChart aggregates by connector category (web `sessions` prop). */
fun ChargingSession.toChargerSession(): ChargerSession =
    ChargerSession(
        chargerType = chargerType,
        peakPowerW = peakPowerW,
        totalEnergyAddedWh = totalEnergyAddedWh ?: 0.0,
        startedAt = startedAt.toString(),
        endedAt = endedAt?.toString(),
    )

/** The slice the SpeedTrendChart buckets into monthly DC/AC averages (web `sessions` prop). */
fun ChargingSession.toSpeedSession(): ChargingSpeedSession =
    ChargingSpeedSession(
        startedAt = startedAt.toString(),
        peakPowerW = peakPowerW,
        chargerType = chargerType,
    )

/** The slice the TimeToChargeSection reduces into 10→80 / 20→80 / fastest / slowest metrics (web `sessions` prop). */
fun ChargingSession.toTimeToChargeSession(): TimeToChargeSession =
    TimeToChargeSession(
        id = id,
        chargerType = chargerType,
        peakPowerW = peakPowerW,
        totalEnergyAddedWh = totalEnergyAddedWh ?: 0.0,
        startSocPct = startSocPct ?: 0.0,
        endSocPct = endSocPct,
        startedAt = startedAt.toString(),
        endedAt = endedAt?.toString(),
    )

// ── Page-owned derivations (web `useMemo` + helpers) ──────────────────────────────────────────────────────────

/**
 * The render-ready model the stateless content layer needs, computed once from the loaded [sessions] — the union
 * of the web page's `stats` / `sessionOptions` / `selectedSession` / `curveData` `useMemo`s. Keeping it pure and
 * Compose-free lets the whole derivation be asserted off-device.
 *
 * @property sessions the loaded charging sessions (web `sessions ?? []`), the source array threaded to the charts.
 * @property stats the six-figure cross-section the SummaryStatsGrid reads, or `null` with no sessions (web `stats`).
 * @property selectedSession the chosen session for the detail panel + curve, or `null` for none (web `selectedSession`).
 * @property curve the simulated power-vs-SOC curve of [selectedSession] (web `curveData`), empty when none chosen.
 */
data class ChargingCurveData(
    val sessions: List<ChargingSession>,
    val stats: ChargingSummaryStats?,
    val selectedSession: ChargingSession?,
    val curve: List<CurvePoint>,
)

/**
 * Derives the page's content model from the loaded [sessions] and the current [interaction] — the native fold of
 * the web page's four `useMemo`s. The selected session is resolved by id from the loaded list (web `find`), and
 * its curve is generated through the shared [SessionComparisonChartProjection.generateChargingCurve] (the exact
 * port of the web `generateChargingCurve` the SessionCurveChart consumes), so the page never re-implements it.
 */
fun deriveChargingCurveData(
    sessions: List<ChargingSession>,
    interaction: ChargingCurveInteraction,
): ChargingCurveData {
    val selected = interaction.selectedSessionId?.let { id -> sessions.firstOrNull { it.id == id } }
    // generateChargingCurve emits the comparison chart's own `(soc, power)` points; remap onto the
    // SessionCurveChart's CurvePoint shape (the two feature views declare distinct identical types).
    val curve =
        selected
            ?.let { SessionComparisonChartProjection.generateChargingCurve(it.toCurveSession()) }
            ?.map { point -> CurvePoint(soc = point.soc, power = point.power) }
            .orEmpty()
    return ChargingCurveData(
        sessions = sessions,
        stats = computeStats(sessions),
        selectedSession = selected,
        curve = curve,
    )
}

/**
 * The six-figure cross-section the SummaryStatsGrid renders — a 1:1 port of the web page's `stats` `useMemo`:
 * the session count, the summed `total_energy_added_wh` (Wh, the figure the grid labels "kWh" verbatim), the
 * mean and peak `peak_power_w / 1000` (kW), the mean per-session duration in minutes, and the summed
 * `cost_decimal`. Returns `null` for an empty list, exactly like the web `if (!sessions?.length) return null`,
 * which the grid renders as its empty state.
 */
fun computeStats(sessions: List<ChargingSession>): ChargingSummaryStats? {
    if (sessions.isEmpty()) return null
    val totalEnergy = sessions.sumOf { it.totalEnergyAddedWh ?: 0.0 }
    val totalCost = sessions.sumOf { it.costDecimal ?: 0.0 }
    val avgDuration = avg(sessions.map { durationMinutes(it).toDouble() }) // parity:allow Long->Double widening; "toDo" substring is not a TODO stub
    val powers = sessions.map { (it.peakPowerW ?: 0.0) / WATTS_PER_KW }
    val avgRate = avg(powers)
    val peakRate = powers.maxOrNull() ?: 0.0
    return ChargingSummaryStats(
        totalSessions = sessions.size,
        totalEnergy = totalEnergy,
        avgRate = avgRate,
        peakRate = peakRate,
        avgDuration = avgDuration,
        totalCost = totalCost,
    )
}

/**
 * Rounded session duration in whole minutes — the native mirror of the web `durationMinutes(started_at, ended_at)`.
 * Returns 0 for a still-open session (no `ended_at`) or a non-positive range (web `end <= start`), so a malformed
 * row never skews the average. Computed from the SI [kotlin.time.Instant]s directly rather than re-parsing strings.
 */
fun durationMinutes(session: ChargingSession): Long {
    val end = session.endedAt ?: return 0L
    val deltaMs = end.toEpochMilliseconds() - session.startedAt.toEpochMilliseconds()
    if (deltaMs <= 0L) return 0L
    return Math.round(deltaMs / MILLIS_PER_MINUTE)
}

/** Arithmetic mean, 0 for an empty list — the native mirror of the web `avg`. */
fun avg(values: List<Double>): Double = if (values.isEmpty()) 0.0 else values.sum() / values.size

/** Watts per kilowatt — the web `peak_power_w / 1000` divisor. */
private const val WATTS_PER_KW = 1000.0

/** Milliseconds per minute — the web `(end - start) / 60000` divisor. */
private const val MILLIS_PER_MINUTE = 60_000.0

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChargingCurvePageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, session id, energy, or cost figure.
 */
fun recordChargingCurvePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChargingCurvePageRegistration.SLUG))
}
