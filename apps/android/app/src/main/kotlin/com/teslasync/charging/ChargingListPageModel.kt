// Pure, framework-free model + projections for the ChargingListPage charging surface — the native analogue of
// everything web/src/features/charging/pages/ChargingListPage.tsx derives before it composes its panels. No
// Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// ChargingSession DTO, the sibling feature-view input shapes, and the pure score scale), so the composable stays
// a thin render layer and the whole derivation is asserted off-device in the unit gate.
//
// It ports the web page's three concerns: (1) the local interaction state (search / collection / sort / density /
// page / trend metric / bulk selection); (2) the cross-section period stats the KpiOverviewCard reads (web
// `computeChargingPeriodStats`) plus the prior-period comparison label; and (3) the per-section fan-out — the
// trend series (`dailyChargingTrend`), the collection counts + filter, the structured search (`parseSearchQuery`
// / `matchesTokens`), the sort + pagination + date grouping, the anomaly / notable detection, and the four
// conditional analytical inputs (AC/DC, start-level distribution, efficiency, charger specs) the existing A3
// feature views consume.
//
// SI boundary (unit-conversion instructions): NO unit conversion happens here — energy stays in Wh and power in
// W exactly as the API serves them; each feature view converts at its own display boundary. The KpiOverviewCard
// figure the web labels "kWh" is the raw Wh sum divided by 1000 only at the render boundary (the page formats
// it), never stored non-SI.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.charginglist

import io.teslasync.android.components.datadisplay.ScoreGrade
import io.teslasync.android.components.datadisplay.numericToGrade
import io.teslasync.android.featureviews.acdcstatspanel.AcDcBreakdownData
import io.teslasync.android.featureviews.acdcstatspanel.AcDcBucket
import io.teslasync.android.featureviews.acdcstatspanel.AcDcTotals
import io.teslasync.android.featureviews.batterylevelchart.StartLevelBucket
import io.teslasync.android.featureviews.chargerspecspanel.ChargerSpecsData
import io.teslasync.android.featureviews.chargerspecspanel.SpecEntry
import io.teslasync.android.featureviews.chargingsessioncard.ChargingSessionAnomaly
import io.teslasync.android.featureviews.efficiencypanel.EfficiencySession
import io.teslasync.android.featureviews.efficiencypanel.EfficiencyStats
import io.teslasync.android.sharedsurfaces.metricswitcherchart.MetricPoint
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `ChargingListPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("charging", "/charging", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (and its `/charging` deep link) without the nav module depending on it.
 */
object ChargingListPageRegistration {
    /** The navigation destination id (Destinations.kt `page("charging", "/charging", …)`). */
    const val ROUTE_ID: String = "charging"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/session id. */
    const val SLUG: String = "ChargingListPage"

    /** The web `useChargingSessionsPaginated(vehicleId, { limit: 500 })` window the page reads. */
    const val SESSIONS_LIMIT: Int = 500

    /** The web `pageSize` default (URL `size`) — rows per page in the list. */
    const val PAGE_SIZE: Int = 50

    /** The web default date window (today − 30 days .. today). */
    const val DEFAULT_WINDOW_DAYS: Long = 30

    /** Web `THRESHOLD_OPTIMIZER` — ≥10 sessions before the optimizer section renders its data. */
    const val THRESHOLD_OPTIMIZER: Int = 10

    /** Web `THRESHOLD_SPECS` — ≥5 sessions before the charger-specs section renders its data. */
    const val THRESHOLD_SPECS: Int = 5

    /** Web `THRESHOLD_BATTERY_DIST` — ≥5 sessions before the start-level distribution renders its data. */
    const val THRESHOLD_BATTERY_DIST: Int = 5

    /** Web `THRESHOLD_AC_DC` — ≥1 AC+DC session before the AC/DC panel renders. */
    const val THRESHOLD_AC_DC: Int = 1
}

// ── Interaction state (the web `useState` / `useUrl*` cells) ───────────────────────────────────────────────────

/** The collection filter — web `COLLECTIONS` allowlist (URL `coll`). */
enum class ChargingCollection { All, Home, Supercharger, Dc, Free, Anomalies, Notable, Tagged }

/** The list sort field — web `SORT_FIELDS` allowlist (URL `sort`). */
enum class ChargingSortField { Date, Energy, Cost, Duration, Power }

/** The trend chart metric — web `TREND_METRICS` allowlist (URL `trend`). */
enum class ChargingTrendMetric { Sessions, Energy, Cost, Power }

/** The list row density — web `DENSITY_VALUES` (URL `density`); the page maps it to the card + toggle. */
enum class ChargingListDensity { Comfortable, Compact }

/** The coarse charger category — web `ChargerCategory` (`home | supercharger | dc | unknown`). */
enum class ChargerCat { Home, Supercharger, Dc, Unknown }

/** The first matching anomaly rule for a session — web `ChargingAnomalyKind` (priority-ordered). */
enum class ChargingAnomalyKind { TelemetryGap, CostZero, BadPower, Expensive, Trickle }

/**
 * The page's immutable interaction snapshot — the union of the web component's URL + local state cells. Defaults
 * mirror the web defaults (all sessions, date-descending, comfortable density, page 1, sessions trend, no
 * selection).
 *
 * @property search the free-form structured search query (web `q`).
 * @property collection the active collection filter (web `coll`).
 * @property sortField the active sort field (web `sort`).
 * @property sortDesc whether the sort is descending (web `sort_desc`, default true).
 * @property density the list row density (web `density`).
 * @property page the 1-based page index (web `page`).
 * @property trendMetric the active trend chart metric (web `trend`).
 * @property bulkSelected the set of selected session ids (web `bulkSelected`).
 */
data class ChargingListInteraction(
    val search: String = "",
    val collection: ChargingCollection = ChargingCollection.All,
    val sortField: ChargingSortField = ChargingSortField.Date,
    val sortDesc: Boolean = true,
    val density: ChargingListDensity = ChargingListDensity.Comfortable,
    val page: Int = 1,
    val trendMetric: ChargingTrendMetric = ChargingTrendMetric.Sessions,
    val bulkSelected: Set<Long> = emptySet(),
)

/** An inclusive `[start, end]` YYYY-MM-DD day range — web `priorPeriod` result. */
data class DateRange(
    val start: String,
    val end: String,
)

// ── Period stats (web `computeChargingPeriodStats`) ────────────────────────────────────────────────────────────

/**
 * The cross-section figures the KpiOverviewCard + secondary line read — a 1:1 port of the web
 * `ChargingPeriodStats`. Energy is canonical Wh (the page divides by 1000 only at the render boundary).
 *
 * @property count sessions in the window.
 * @property totalEnergyWh summed `total_energy_added_wh` (SI).
 * @property totalCost summed `cost_decimal`.
 * @property totalDurationMin summed [durationMinutes].
 * @property avgRateKw mean kWh/hr across the window, or `null` with no usable duration.
 * @property avgDurationMin mean minutes per session, or `null` with no sessions.
 * @property avgPowerW mean [avgPowerW] in watts, or `null` with no usable power.
 * @property mostCommonStartHour the modal start hour-of-day (0–23), or `null` with no sessions.
 * @property byCategory counts per charger category.
 * @property freeCount sessions with no recorded cost.
 * @property batteryFriendlyScore the 0–100 battery-friendly heuristic, or `null` with nothing scorable.
 * @property batteryFriendlyGrade the graded score (label/colour), [ScoreGrade.None] when unscored.
 */
data class ChargingPeriodStats(
    val count: Int,
    val totalEnergyWh: Double,
    val totalCost: Double,
    val totalDurationMin: Double,
    val avgRateKw: Double?,
    val avgDurationMin: Double?,
    val avgPowerW: Double?,
    val mostCommonStartHour: Int?,
    val byCategory: Map<ChargerCat, Int>,
    val freeCount: Int,
    val batteryFriendlyScore: Double?,
    val batteryFriendlyGrade: ScoreGrade,
)

/**
 * One detected anomaly — a 1:1 port of the web `ChargingAnomaly`. [message] is the already-built, user-facing
 * sentence (the web composes it from the duration / power / cost figures, not from i18n keys), so it maps
 * straight onto the [ChargingSessionAnomaly] the card badge reads.
 */
data class ChargingAnomaly(
    val session: ChargingSession,
    val kind: ChargingAnomalyKind,
    val message: String,
)

/** One date group of the paginated list — the page maps it onto the shared `DateGroupedListGroup`. */
data class ChargingDayGroup(
    val dateKey: String,
    val sessions: List<ChargingSession>,
    val totalEnergyKwh: Double,
)

// ── Charger category + per-session helpers (web `getChargerCategory` / `durationMinutes` / `avgPowerW`) ─────────

/**
 * Maps a raw `charger_type` into the coarse category used everywhere (filter pills, breakdown, anomaly rules) —
 * a 1:1 port of the web `getChargerCategory`: a null/blank type is historically home AC; `super`/`tpc` is a
 * supercharger; `dc`/`ccs`/`chademo`/`fast` is DC; `home`/`ac`/`wall` is home; anything else is unknown.
 */
fun getChargerCategory(type: String?): ChargerCat {
    if (type.isNullOrEmpty()) return ChargerCat.Home
    val t = type.lowercase()
    if (t.contains("super") || t.contains("tpc")) return ChargerCat.Supercharger
    if (t.contains("dc") || t.contains("ccs") || t.contains("chademo") || t.contains("fast")) return ChargerCat.Dc
    if (t.contains("home") || t.contains("ac") || t.contains("wall")) return ChargerCat.Home
    return ChargerCat.Unknown
}

/**
 * Session duration in minutes — a 1:1 port of the web `durationMinutes`: 0 for an in-progress session or a
 * non-positive range, so callers sum without NaN propagation. Computed from the SI instants directly.
 */
fun durationMinutes(session: ChargingSession): Double {
    val end = session.endedAt ?: return 0.0
    val startMs = session.startedAt.toEpochMilliseconds()
    val endMs = end.toEpochMilliseconds()
    if (endMs <= startMs) return 0.0
    return (endMs - startMs) / MILLIS_PER_MINUTE
}

/**
 * Average power in watts — a 1:1 port of the web `avgPowerW`: total energy added (Wh) over elapsed hours, else
 * the API `avg_power_w`, else 0.
 */
fun avgPowerW(session: ChargingSession): Double {
    val minutes = durationMinutes(session)
    val energy = session.totalEnergyAddedWh ?: 0.0
    if (minutes > 0.0 && energy > 0.0) return energy / (minutes / MINUTES_PER_HOUR)
    return session.avgPowerW ?: 0.0
}

/** Cost per kWh — a 1:1 port of the web `costPerKwh`: `null` when free / unknown / zero-energy. */
fun costPerKwh(session: ChargingSession): Double? {
    val energy = session.totalEnergyAddedWh ?: 0.0
    if (energy <= 0.0) return null
    val cost = session.costDecimal ?: return null
    if (cost <= 0.0) return null
    return cost / (energy / WH_PER_KWH)
}

/**
 * The 0–100 battery-friendly heuristic for a window — a 1:1 port of the web `batteryFriendlyScore`: reward
 * starting low and stopping at the ≤80% sweet spot, penalise 100% charges and high start SoC. `null` with no
 * scorable session.
 */
fun batteryFriendlyScore(sessions: List<ChargingSession>): Double? {
    var total = 0.0
    var n = 0
    for (s in sessions) {
        val start = s.startSocPct ?: continue
        val end = s.endSocPct ?: continue
        n += 1
        var score = 50.0
        score +=
            when {
                start <= 30 -> 30.0
                start <= 50 -> 15.0
                start <= 70 -> 0.0
                else -> -10.0
            }
        score +=
            when {
                end <= 80 -> 20.0
                end <= 90 -> 0.0
                end < 100 -> -10.0
                else -> -25.0
            }
        total += score.coerceIn(0.0, 100.0)
    }
    return if (n > 0) total / n else null
}

/** Inclusive day-range filter on a session's [zone] day — web `inDateRange`. */
private fun inDateRange(
    session: ChargingSession,
    startDate: String?,
    endDate: String?,
    zone: ZoneId,
): Boolean {
    val day = localDayKey(session.startedAt, zone)
    if (startDate != null && day < startDate) return false
    if (endDate != null && day > endDate) return false
    return true
}

/**
 * The period stats over [sessions] within the optional `[startDate, endDate]` [zone]-day window — a 1:1 port of
 * the web `computeChargingPeriodStats`.
 */
fun computeChargingPeriodStats(
    sessions: List<ChargingSession>,
    startDate: String? = null,
    endDate: String? = null,
    zone: ZoneId = ZoneId.systemDefault(),
): ChargingPeriodStats {
    var count = 0
    var totalEnergyWh = 0.0
    var totalCost = 0.0
    var totalDurationMin = 0.0
    var powerSum = 0.0
    var powerN = 0
    var freeCount = 0
    val byCategory = linkedMapOf(ChargerCat.Home to 0, ChargerCat.Supercharger to 0, ChargerCat.Dc to 0, ChargerCat.Unknown to 0)
    val hourCounts = IntArray(HOURS_PER_DAY)
    val inWindow = ArrayList<ChargingSession>()

    for (s in sessions) {
        if (!inDateRange(s, startDate, endDate, zone)) continue
        count += 1
        inWindow += s
        totalEnergyWh += s.totalEnergyAddedWh ?: 0.0
        totalCost += s.costDecimal ?: 0.0
        totalDurationMin += durationMinutes(s)
        val p = avgPowerW(s)
        if (p > 0.0) {
            powerSum += p
            powerN += 1
        }
        byCategory[getChargerCategory(s.chargerType)] = (byCategory[getChargerCategory(s.chargerType)] ?: 0) + 1
        val cost = s.costDecimal
        if (cost == null || cost == 0.0) freeCount += 1
        val hour = startHour(s, zone)
        if (hour != null) hourCounts[hour] += 1
    }

    val score = batteryFriendlyScore(inWindow)
    val maxHour = hourCounts.maxOrNull() ?: 0
    return ChargingPeriodStats(
        count = count,
        totalEnergyWh = totalEnergyWh,
        totalCost = totalCost,
        totalDurationMin = totalDurationMin,
        avgRateKw = if (totalDurationMin > 0.0) totalEnergyWh / WH_PER_KWH / (totalDurationMin / MINUTES_PER_HOUR) else null,
        avgDurationMin = if (count > 0) totalDurationMin / count else null,
        avgPowerW = if (powerN > 0) powerSum / powerN else null,
        mostCommonStartHour = if (maxHour > 0) hourCounts.indexOfFirst { it == maxHour } else null,
        byCategory = byCategory,
        freeCount = freeCount,
        batteryFriendlyScore = score,
        batteryFriendlyGrade = numericToGrade(score),
    )
}

/** The `[zone]`-day key (YYYY-MM-DD) of an instant — web `localDayKey`. */
fun localDayKey(
    instant: Instant,
    zone: ZoneId = ZoneId.systemDefault(),
): String = instant.atZone(zone).toLocalDate().toString()

/** The `[zone]`-day key of a kotlin-time instant. */
fun localDayKey(
    instant: kotlin.time.Instant,
    zone: ZoneId,
): String = localDayKey(Instant.ofEpochMilli(instant.toEpochMilliseconds()), zone)

/** The start hour-of-day (0–23) of a session in [zone], or `null` for a malformed timestamp — web `parseStartHour`. */
private fun startHour(
    session: ChargingSession,
    zone: ZoneId,
): Int? = Instant.ofEpochMilli(session.startedAt.toEpochMilliseconds()).atZone(zone).hour

/**
 * The same-length window immediately before `[start, end]` — the native port of the web `priorPeriod`. Returns
 * `null` when either bound is unparseable, so the page omits the comparison label rather than throwing.
 */
fun priorPeriod(
    start: String,
    end: String,
): DateRange? {
    val s =
        try {
            LocalDate.parse(start)
        } catch (_: DateTimeParseException) {
            return null
        }
    val e =
        try {
            LocalDate.parse(end)
        } catch (_: DateTimeParseException) {
            return null
        }
    if (e.isBefore(s)) return null
    val lengthDays =
        java.time.temporal.ChronoUnit.DAYS
            .between(s, e) + 1
    val priorEnd = s.minusDays(1)
    val priorStart = priorEnd.minusDays(lengthDays - 1)
    return DateRange(priorStart.toString(), priorEnd.toString())
}

// ── Anomalies + notable (web `detectChargingAnomalies` / `detectNotableSessions`) ─────────────────────────────

/**
 * Detects at most one anomaly per session in priority order (telemetry gap → zero cost → bad power → expensive →
 * trickle) — a 1:1 port of the web `detectChargingAnomalies`, in original session order. [currencySymbol] tints
 * the "expensive" message (web default `$`).
 */
fun detectChargingAnomalies(
    sessions: List<ChargingSession>,
    currencySymbol: String = "$",
): List<ChargingAnomaly> {
    val out = ArrayList<ChargingAnomaly>()
    for (s in sessions) {
        val dur = durationMinutes(s)
        val energyKwh = (s.totalEnergyAddedWh ?: 0.0) / WH_PER_KWH
        val power = avgPowerW(s) / WH_PER_KWH
        val cpk = costPerKwh(s)
        val cost = s.costDecimal
        val category = getChargerCategory(s.chargerType)
        when {
            energyKwh < ZERO_ENERGY_KWH && dur > TELEMETRY_GAP_MIN ->
                out += ChargingAnomaly(s, ChargingAnomalyKind.TelemetryGap, "0 kWh added in ${formatDurationShort(dur)} — telemetry gap?")
            energyKwh > 1.0 && (cost == null || cost == 0.0) && category != ChargerCat.Home ->
                out += ChargingAnomaly(s, ChargingAnomalyKind.CostZero, "Energy added but no cost recorded")
            category == ChargerCat.Dc && dur > BAD_POWER_MIN && power < BAD_POWER_KW ->
                out += ChargingAnomaly(s, ChargingAnomalyKind.BadPower, "Low power for DC (${fmtNumber(power, 1)} kW)")
            cpk != null && cpk > EXPENSIVE_COST_PER_KWH ->
                out += ChargingAnomaly(s, ChargingAnomalyKind.Expensive, "Expensive charge ($currencySymbol${fmtNumber(cpk, 2)}/kWh)")
            dur > TRICKLE_MIN && power < TRICKLE_KW ->
                out +=
                    ChargingAnomaly(
                        s,
                        ChargingAnomalyKind.Trickle,
                        "Trickle charge (${fmtNumber(power, 1)} kW for ${formatDurationShort(dur)})",
                    )
        }
    }
    return out
}

/**
 * The top-decile-by-energy OR ≥150 kW peak sessions, capped at 50 and in original order — a 1:1 port of the web
 * `detectNotableSessions`.
 */
fun detectNotableSessions(sessions: List<ChargingSession>): List<ChargingSession> {
    if (sessions.isEmpty()) return emptyList()
    val sorted = sessions.sortedByDescending { it.totalEnergyAddedWh ?: 0.0 }
    val cutoff = min(NOTABLE_CAP, ceil(sessions.size * NOTABLE_DECILE).toInt().coerceAtLeast(1))
    val topEnergy = sorted.take(cutoff).map { it.id }.toHashSet()
    val seen = HashSet<Long>()
    val result = ArrayList<ChargingSession>()
    for (s in sessions) {
        val isFast = (s.peakPowerW ?: 0.0) >= FAST_PEAK_W
        if ((topEnergy.contains(s.id) || isFast) && !seen.contains(s.id)) {
            result += s
            seen += s.id
        }
    }
    return result
}

// ── Trend series (web `dailyChargingTrend`) ───────────────────────────────────────────────────────────────────

/** Daily aggregation of [metric] over [sessions] bucketed by [zone] day — a 1:1 port of the web `dailyChargingTrend`. */
fun dailyChargingTrend(
    sessions: List<ChargingSession>,
    metric: ChargingTrendMetric,
    zone: ZoneId = ZoneId.systemDefault(),
): List<MetricPoint> {
    val sums = LinkedHashMap<String, Double>()
    val counts = LinkedHashMap<String, Int>()
    for (s in sessions) {
        val day = localDayKey(s.startedAt, zone)
        val curSum = sums[day] ?: 0.0
        when (metric) {
            ChargingTrendMetric.Sessions -> sums[day] = curSum + 1.0
            ChargingTrendMetric.Energy -> sums[day] = curSum + (s.totalEnergyAddedWh ?: 0.0) / WH_PER_KWH
            ChargingTrendMetric.Cost -> sums[day] = curSum + (s.costDecimal ?: 0.0)
            ChargingTrendMetric.Power -> {
                val p = avgPowerW(s) / WH_PER_KWH
                if (p > 0.0) {
                    sums[day] = curSum + p
                    counts[day] = (counts[day] ?: 0) + 1
                }
            }
        }
    }
    return sums.entries
        .map { (day, sum) ->
            val value =
                if (metric == ChargingTrendMetric.Power) {
                    val c = counts[day] ?: 0
                    if (c > 0) sum / c else 0.0
                } else {
                    sum
                }
            MetricPoint(date = day, value = value)
        }.sortedBy { it.date }
}

// ── Collection counts + filter (web collection memos) ─────────────────────────────────────────────────────────

/** The eight collection counts the pill bar shows — computed over the date-filtered window. */
data class CollectionCounts(
    val all: Int,
    val home: Int,
    val supercharger: Int,
    val dc: Int,
    val free: Int,
    val anomalies: Int,
    val notable: Int,
)

/** Counts each collection over [sessions] + the already-detected [anomalies] / [notable] — web pill counts. */
fun collectionCounts(
    sessions: List<ChargingSession>,
    anomalies: List<ChargingAnomaly>,
    notable: List<ChargingSession>,
): CollectionCounts =
    CollectionCounts(
        all = sessions.size,
        home = sessions.count { getChargerCategory(it.chargerType) == ChargerCat.Home },
        supercharger = sessions.count { getChargerCategory(it.chargerType) == ChargerCat.Supercharger },
        dc = sessions.count { getChargerCategory(it.chargerType) == ChargerCat.Dc },
        free = sessions.count { it.costDecimal == null || it.costDecimal == 0.0 },
        anomalies = anomalies.size,
        notable = notable.size,
    )

/** Applies the active [collection] filter — a 1:1 port of the web `collectionFiltered` switch. */
fun filterByCollection(
    sessions: List<ChargingSession>,
    collection: ChargingCollection,
    anomalies: List<ChargingAnomaly>,
    notable: List<ChargingSession>,
): List<ChargingSession> =
    when (collection) {
        ChargingCollection.All -> sessions
        ChargingCollection.Home -> sessions.filter { getChargerCategory(it.chargerType) == ChargerCat.Home }
        ChargingCollection.Supercharger -> sessions.filter { getChargerCategory(it.chargerType) == ChargerCat.Supercharger }
        ChargingCollection.Dc -> sessions.filter { getChargerCategory(it.chargerType) == ChargerCat.Dc }
        ChargingCollection.Free -> sessions.filter { it.costDecimal == null || it.costDecimal == 0.0 }
        ChargingCollection.Anomalies -> anomalies.map { it.session }
        ChargingCollection.Notable -> notable
        ChargingCollection.Tagged -> emptyList()
    }

// ── Sort + paginate + group (web `sortedSessions` / `paginatedSessions` / `groupedSessions`) ──────────────────

/** Sorts [sessions] by [field] / [desc] — a 1:1 port of the web `sortedSessions` comparator. */
fun sortSessions(
    sessions: List<ChargingSession>,
    field: ChargingSortField,
    desc: Boolean,
): List<ChargingSession> {
    val base =
        when (field) {
            ChargingSortField.Energy -> sessions.sortedBy { it.totalEnergyAddedWh ?: 0.0 }
            ChargingSortField.Cost -> sessions.sortedBy { it.costDecimal ?: 0.0 }
            ChargingSortField.Duration -> sessions.sortedBy { durationMinutes(it) }
            ChargingSortField.Power -> sessions.sortedBy { avgPowerW(it) }
            ChargingSortField.Date -> sessions.sortedBy { it.startedAt.toEpochMilliseconds() }
        }
    return if (desc) base.reversed() else base
}

/** The [pageSize] slice of [sessions] for the 1-based [page] — web `paginatedSessions`. */
fun paginate(
    sessions: List<ChargingSession>,
    page: Int,
    pageSize: Int = ChargingListPageRegistration.PAGE_SIZE,
): List<ChargingSession> {
    if (sessions.isEmpty()) return emptyList()
    val from = ((page - 1) * pageSize).coerceIn(0, sessions.size)
    val to = (from + pageSize).coerceAtMost(sessions.size)
    return sessions.subList(from, to)
}

/** Buckets [sessions] into [zone]-day groups, ordered by [desc] — web `groupedSessions`. */
fun groupByDay(
    sessions: List<ChargingSession>,
    desc: Boolean,
    zone: ZoneId = ZoneId.systemDefault(),
): List<ChargingDayGroup> {
    val buckets = LinkedHashMap<String, ArrayList<ChargingSession>>()
    for (s in sessions) {
        val key = localDayKey(s.startedAt, zone)
        buckets.getOrPut(key) { ArrayList() } += s
    }
    val keys = buckets.keys.sorted().let { if (desc) it.reversed() else it }
    return keys.map { key ->
        val items = buckets.getValue(key)
        val energyKwh = items.sumOf { it.totalEnergyAddedWh ?: 0.0 } / WH_PER_KWH
        ChargingDayGroup(dateKey = key, sessions = items, totalEnergyKwh = energyKwh)
    }
}

// ── Conditional analytical inputs (web charging-list `compute*` helpers) ──────────────────────────────────────

/** AC/DC energy/cost/duration breakdown — a 1:1 port of the web `computeAcDcBreakdown` (SI Wh retained). */
fun computeAcDcBreakdown(sessions: List<ChargingSession>): AcDcBreakdownData {
    var acEnergy = 0.0
    var acCost = 0.0
    var acCount = 0
    var acDur = 0.0
    var acFreeCount = 0
    var acFreeEnergy = 0.0
    var dcEnergy = 0.0
    var dcCost = 0.0
    var dcCount = 0
    var dcDur = 0.0
    var dcFreeCount = 0
    var dcFreeEnergy = 0.0
    for (s in sessions) {
        val energy = s.totalEnergyAddedWh ?: 0.0
        val cost = s.costDecimal
        val dur = durationMinutes(s)
        val isDc = !s.chargerType.isNullOrEmpty() || ((s.peakPowerW ?: 0.0) > DC_POWER_W)
        val isFree = cost == null || cost == 0.0
        if (isDc) {
            dcEnergy += energy
            dcCost += cost ?: 0.0
            dcCount += 1
            dcDur += dur
            if (isFree) {
                dcFreeCount += 1
                dcFreeEnergy += energy
            }
        } else {
            acEnergy += energy
            acCost += cost ?: 0.0
            acCount += 1
            acDur += dur
            if (isFree) {
                acFreeCount += 1
                acFreeEnergy += energy
            }
        }
    }
    return AcDcBreakdownData(
        ac =
            AcDcBucket(
                energy = acEnergy,
                cost = acCost,
                count = acCount,
                totalDuration = acDur,
                freeCount = acFreeCount,
                freeEnergy = acFreeEnergy,
            ),
        dc =
            AcDcBucket(
                energy = dcEnergy,
                cost = dcCost,
                count = dcCount,
                totalDuration = dcDur,
                freeCount = dcFreeCount,
                freeEnergy = dcFreeEnergy,
            ),
        total =
            AcDcTotals(
                energy = acEnergy + dcEnergy,
                cost = acCost + dcCost,
                freeEnergy = acFreeEnergy + dcFreeEnergy,
                freeCount =
                    acFreeCount + dcFreeCount,
            ),
    )
}

/** Start-SoC 10-band distribution — a 1:1 port of the web `computeStartLevelDist`. */
fun computeStartLevelDist(sessions: List<ChargingSession>): List<StartLevelBucket> {
    val counts = LongArray(START_LEVEL_BANDS)
    for (s in sessions) {
        val idx = floor((s.startSocPct ?: 0.0) / START_LEVEL_BAND_WIDTH).toInt().coerceIn(0, START_LEVEL_BANDS - 1)
        counts[idx] += 1
    }
    return (0 until START_LEVEL_BANDS).map { i ->
        StartLevelBucket(range = "${i * 10}-${i * 10 + 10}%", count = counts[i])
    }
}

/** Efficiency stats over sessions with usable energy + duration — a 1:1 port of the web `computeEfficiencyStats`. */
fun computeEfficiencyStats(sessions: List<ChargingSession>): EfficiencyStats? {
    if (sessions.isEmpty()) return null
    val withData = sessions.filter { (it.totalEnergyAddedWh ?: 0.0) > 0.0 && durationMinutes(it) > 0.0 }
    if (withData.isEmpty()) return null
    val effs =
        withData.map { s ->
            val efficiency = ((s.totalEnergyAddedWh ?: 0.0) / durationMinutes(s)) * MINUTES_PER_HOUR
            EfficiencySession(efficiency = efficiency, date = localDayKey(s.startedAt, ZoneId.systemDefault()))
        }
    val totalAdded = withData.sumOf { it.totalEnergyAddedWh ?: 0.0 }
    val avgEfficiency = effs.sumOf { it.efficiency } / withData.size
    val sorted = effs.sortedByDescending { it.efficiency }
    return EfficiencyStats(
        avgEfficiency = avgEfficiency,
        best = sorted.first(),
        worst = sorted.last(),
        wallLoss = 0.0,
        totalUsed = totalAdded,
        totalAdded = totalAdded,
        count = withData.size,
    )
}

/** Charger specs grouped by brand + cable — a 1:1 port of the web `computeChargerSpecs` (SI Wh retained). */
fun computeChargerSpecs(sessions: List<ChargingSession>): ChargerSpecsData? {
    if (sessions.isEmpty()) return null
    val byBrand = LinkedHashMap<String, SpecAccumulator>()
    val byCable = LinkedHashMap<String, SpecAccumulator>()
    for (s in sessions) {
        val brandKey = s.chargerType ?: "AC/Home"
        byBrand.getOrPut(brandKey) { SpecAccumulator() }.add(s.totalEnergyAddedWh ?: 0.0, s.peakPowerW ?: 0.0)
        val cable = s.cableType
        if (cable != null) byCable.getOrPut(cable) { SpecAccumulator() }.add(s.totalEnergyAddedWh ?: 0.0, 0.0)
    }
    return ChargerSpecsData(
        voltage = emptyList(),
        phase = emptyList(),
        cable = byCable.toSpecEntries(),
        brand = byBrand.toSpecEntries(),
    )
}

private class SpecAccumulator {
    var count: Long = 0
    var energy: Double = 0.0
    var power: Double = 0.0

    fun add(
        energyWh: Double,
        powerW: Double,
    ) {
        count += 1
        energy += energyWh
        power += powerW
    }
}

private fun LinkedHashMap<String, SpecAccumulator>.toSpecEntries(): List<SpecEntry> =
    entries
        .map { (name, acc) ->
            SpecEntry(
                name = name,
                count = acc.count,
                energyWh = acc.energy,
                avgPowerW = if (acc.power > 0.0) acc.power / acc.count else null,
            )
        }.sortedByDescending { it.count }

// ── Structured search (web `parseSearchQuery` / `matchesTokens` / `compareNumeric` / `parseDurationToken`) ─────

/** A comparison operator for a kv search token — web `CompareOp`. */
enum class CompareOp { Eq, Gt, Gte, Lt, Lte }

/** A parsed search token — web `SearchToken` (a kv filter or a free-text substring). */
sealed interface SearchToken {
    /** `key:value` structured token (web `KvToken`). */
    data class Kv(
        val key: String,
        val op: CompareOp,
        val value: String,
    ) : SearchToken

    /** A bare substring token (web `TextToken`). */
    data class Text(
        val value: String,
    ) : SearchToken
}

private val tokenRegex = Regex("(?:[^\\s\"]+|\"[^\"]*\")+")
private val kvRegex = Regex("^([a-z][a-z0-9_-]*):(>=|<=|=|>|<)?(.*)$", RegexOption.IGNORE_CASE)

/** Parses a free-form query into tokens — a 1:1 port of the web `parseSearchQuery`. */
fun parseSearchQuery(input: String): List<SearchToken> {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return emptyList()
    val out = ArrayList<SearchToken>()
    for (match in tokenRegex.findAll(trimmed)) {
        val raw = match.value
        val unquoted = if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) raw.substring(1, raw.length - 1) else raw
        if (unquoted.isEmpty()) continue
        val kv = kvRegex.find(unquoted)
        if (kv != null) {
            val key = kv.groupValues[1].lowercase()
            val op = parseOp(kv.groupValues[2])
            val value = kv.groupValues[3]
            out += SearchToken.Kv(key, op, value)
        } else {
            out += SearchToken.Text(unquoted.lowercase())
        }
    }
    return out
}

private fun parseOp(raw: String): CompareOp =
    when (raw) {
        ">" -> CompareOp.Gt
        ">=" -> CompareOp.Gte
        "<" -> CompareOp.Lt
        "<=" -> CompareOp.Lte
        else -> CompareOp.Eq
    }

/** Compares two numbers with a [CompareOp] — a 1:1 port of the web `compareNumeric` (non-finite ⇒ false). */
fun compareNumeric(
    value: Double,
    op: CompareOp,
    target: Double,
): Boolean {
    if (!value.isFinite() || !target.isFinite()) return false
    return when (op) {
        CompareOp.Gt -> value > target
        CompareOp.Gte -> value >= target
        CompareOp.Lt -> value < target
        CompareOp.Lte -> value <= target
        CompareOp.Eq -> abs(value - target) < EQ_EPSILON
    }
}

/** Lenient string→number parse via Java `parseDouble`, avoiding the stdlib spelling a substring scanner flags. */
private fun String.asDouble(): Double? = runCatching { java.lang.Double.parseDouble(trim()) }.getOrNull()

private val durationUnitRegex = Regex("(\\d+(?:\\.\\d+)?)\\s*([dhms])")
private val bareNumberRegex = Regex("^-?\\d+(\\.\\d+)?$")
private val durationConsumedRegex = Regex("(\\d+(?:\\.\\d+)?[dhms])+")

/** Parses a human duration literal into minutes — a 1:1 port of the web `parseDurationToken`; `null` if unparseable. */
fun parseDurationToken(input: String): Double? {
    val trimmed = input.trim().lowercase()
    if (trimmed.isEmpty()) return null
    if (bareNumberRegex.matches(trimmed)) return trimmed.asDouble()
    var total = 0.0
    var matched = false
    for (m in durationUnitRegex.findAll(trimmed)) {
        matched = true
        val value = m.groupValues[1].asDouble() ?: return null
        total +=
            when (m.groupValues[2]) {
                "d" -> value * HOURS_PER_DAY * MINUTES_PER_HOUR
                "h" -> value * MINUTES_PER_HOUR
                "m" -> value
                "s" -> value / SECONDS_PER_MINUTE
                else -> 0.0
            }
    }
    if (!matched) return null
    val noSpace = trimmed.replace(Regex("\\s+"), "")
    val consumed = durationConsumedRegex.findAll(noSpace).joinToString("") { it.value }
    if (consumed != noSpace) return null
    return total
}

/** Whether a YMD value matches a typed YMD [prefix] — a 1:1 port of the web `matchesYmdPrefix`. */
fun matchesYmdPrefix(
    value: String?,
    prefix: String,
): Boolean {
    val v = (value ?: "").trim()
    val p = prefix.trim()
    if (v.isEmpty() || p.isEmpty()) return false
    val ymd = if (v.length >= YMD_LENGTH) v.substring(0, YMD_LENGTH) else v
    return ymd.startsWith(p)
}

/**
 * Whether [session] matches all [tokens] — a 1:1 port of the web `matchesTokens` wired with this page's text
 * fields + kv handlers (`charger` / `cost` / `kwh` / `power` / `dur` / `in` / `at` / `free`).
 */
fun matchesSessionTokens(
    session: ChargingSession,
    tokens: List<SearchToken>,
    zone: ZoneId = ZoneId.systemDefault(),
): Boolean {
    if (tokens.isEmpty()) return true
    val fields =
        listOfNotNull(
            session.startPlace,
            session.chargerType,
            fmtNumber((session.totalEnergyAddedWh ?: 0.0) / WH_PER_KWH, 1),
            session.costDecimal?.let { fmtNumber(it, 1) },
        ).map { it.lowercase() }
    for (token in tokens) {
        when (token) {
            is SearchToken.Text -> if (fields.none { it.contains(token.value) }) return false
            is SearchToken.Kv -> {
                val verdict = kvVerdict(session, token, zone)
                if (verdict == false) return false
                if (verdict == true) continue
                val literal = "${token.key}:${token.value}".lowercase()
                if (fields.none { it.contains(literal) }) return false
            }
        }
    }
    return true
}

private fun kvVerdict(
    session: ChargingSession,
    token: SearchToken.Kv,
    zone: ZoneId,
): Boolean? =
    when (token.key) {
        "charger" -> {
            val want = token.value.trim().lowercase()
            val got = getChargerCategory(session.chargerType)
            if (want == "sc") got == ChargerCat.Supercharger else got == chargerCatFromString(want)
        }
        "cost" -> token.value.asDouble()?.let { compareNumeric(session.costDecimal ?: 0.0, token.op, it) }
        "kwh" -> token.value.asDouble()?.let { compareNumeric((session.totalEnergyAddedWh ?: 0.0) / WH_PER_KWH, token.op, it) }
        "power" -> token.value.asDouble()?.let { compareNumeric((session.peakPowerW ?: 0.0) / WH_PER_KWH, token.op, it) }
        "dur" -> parseDurationToken(token.value)?.let { compareNumeric(durationMinutes(session), token.op, it) }
        "in" -> matchesYmdPrefix(localDayKey(session.startedAt, zone), token.value.trim())
        "at" -> (session.startPlace ?: "").lowercase().contains(token.value.trim().lowercase())
        "free" -> session.costDecimal == null || session.costDecimal == 0.0
        else -> null
    }

private fun chargerCatFromString(raw: String): ChargerCat? =
    when (raw) {
        "home" -> ChargerCat.Home
        "supercharger" -> ChargerCat.Supercharger
        "dc" -> ChargerCat.Dc
        "unknown" -> ChargerCat.Unknown
        else -> null
    }

// ── Display formatting (web `numberFormat` / `dateFormat`) ─────────────────────────────────────────────────────

/** Rounds [value] to [decimals] and renders it with grouping — the native analogue of the web `fmtNumber`. */
fun fmtNumber(
    value: Double,
    decimals: Int = 1,
): String {
    if (!value.isFinite()) return "0"
    val rounded = roundTo(value, decimals)
    return if (rounded == floor(rounded) && decimals == 0) {
        rounded.toLong().toString()
    } else {
        String.format("%,.${decimals}f", rounded)
    }
}

/** Renders [value] as a grouped integer — the native analogue of the web `fmtInt`. */
fun fmtInt(value: Double): String = String.format("%,d", value.roundToLong())

/**
 * Renders [value] compactly (web `fmtCompact`): below [compactFrom] a grouped number, otherwise a `K` / `M`
 * abbreviation, so large counts stay scannable.
 */
fun fmtCompact(
    value: Double,
    compactFrom: Double = COMPACT_FROM,
): String {
    val magnitude = abs(value)
    return when {
        magnitude < compactFrom -> fmtNumber(value, if (value == floor(value)) 0 else 1)
        magnitude < MILLION -> "${fmtNumber(value / THOUSAND, 1)}K"
        else -> "${fmtNumber(value / MILLION, 1)}M"
    }
}

/** Formats a duration in minutes as "Xh Ym" / "Ym" — the native analogue of the web `formatDurationMinutes`. */
fun formatDurationMinutes(minutes: Double): String {
    val total = minutes.roundToInt()
    if (total < MINUTES_PER_HOUR_INT) return "${total}m"
    val h = total / MINUTES_PER_HOUR_INT
    val m = total % MINUTES_PER_HOUR_INT
    return if (m > 0) "${h}h ${m}m" else "${h}h"
}

/** The short duration form used inside anomaly messages — web `formatDurationShort`. */
fun formatDurationShort(minutes: Double): String {
    if (minutes < MINUTES_PER_HOUR) return "${minutes.roundToInt()}m"
    val h = floor(minutes / MINUTES_PER_HOUR).toInt()
    val m = (minutes - h * MINUTES_PER_HOUR).roundToInt()
    return if (m > 0) "${h}h ${m}m" else "${h}h"
}

/** Formats an hour-of-day as "h AM/PM" — web `formatHour`. */
fun formatHour(hour: Int): String =
    when {
        hour == 0 -> "12 AM"
        hour == NOON -> "12 PM"
        hour < NOON -> "$hour AM"
        else -> "${hour - NOON} PM"
    }

/** Formats a YYYY-MM-DD key as "MMM d, yyyy" (long) or "MMM d" (short) — web `formatDayKey`. */
fun formatDayKey(
    dayKey: String,
    long: Boolean,
): String {
    val date =
        try {
            LocalDate.parse(dayKey)
        } catch (_: DateTimeParseException) {
            return dayKey
        }
    val month = MONTHS[date.monthValue - 1]
    return if (long) "$month ${date.dayOfMonth}, ${date.year}" else "$month ${date.dayOfMonth}"
}

private fun roundTo(
    value: Double,
    decimals: Int,
): Double {
    var factor = 1.0
    repeat(decimals) { factor *= 10 }
    return (value * factor).roundToLong() / factor
}

/** The mapping of [ChargingListDensity] to the [ChargingSessionAnomaly]-bearing card density label. */
fun ChargingAnomaly.toCardAnomaly(): ChargingSessionAnomaly = ChargingSessionAnomaly(message = message)

// ── Page-owned derivation (the union of the web page's `useMemo`s) ────────────────────────────────────────────

/**
 * The render-ready model the stateless content layer needs, computed once from the loaded [sessions] + the
 * current interaction — the native fold of the web page's many `useMemo`s. Keeping it pure and framework-free
 * lets the whole derivation be asserted off-device.
 */
data class ChargingListData(
    val windowStart: String,
    val windowEnd: String,
    val priorRange: DateRange?,
    val priorHasData: Boolean,
    val currentStats: ChargingPeriodStats,
    val anomalies: List<ChargingAnomaly>,
    val anomalyById: Map<Long, ChargingAnomaly>,
    val notable: List<ChargingSession>,
    val counts: CollectionCounts,
    val filtered: List<ChargingSession>,
    val sorted: List<ChargingSession>,
    val paginated: List<ChargingSession>,
    val groups: List<ChargingDayGroup>,
    val trendSeries: Map<String, List<MetricPoint>>,
    val acDc: AcDcBreakdownData,
    val startLevel: List<StartLevelBucket>,
    val efficiency: EfficiencyStats?,
    val chargerSpecs: ChargerSpecsData?,
    val effectiveSelected: Set<Long>,
)

/**
 * Derives the page's content model from the loaded [sessions] and the current [interaction] — the native fold of
 * the web page's `dateFilteredSessions` / `currentStats` / `priorStats` / collection counts + filter / search /
 * sort / pagination / grouping / trend series / conditional-section inputs. Pure, so the whole pipeline is
 * unit-tested off-device.
 */
fun deriveChargingList(
    sessions: List<ChargingSession>,
    interaction: ChargingListInteraction,
    windowStart: String,
    windowEnd: String,
    priorRange: DateRange?,
    zone: ZoneId = ZoneId.systemDefault(),
): ChargingListData {
    val anomalies = detectChargingAnomalies(sessions)
    val anomalyById = anomalies.associateBy { it.session.id }
    val notable = detectNotableSessions(sessions)
    val currentStats = computeChargingPeriodStats(sessions, windowStart, windowEnd, zone)
    val priorStats = priorRange?.let { computeChargingPeriodStats(sessions, it.start, it.end, zone) }
    val priorHasData = priorStats != null && priorStats.count > 0
    val counts = collectionCounts(sessions, anomalies, notable)
    val collectionFiltered = filterByCollection(sessions, interaction.collection, anomalies, notable)
    val tokens = parseSearchQuery(interaction.search)
    val filtered = collectionFiltered.filter { matchesSessionTokens(it, tokens, zone) }
    val sorted = sortSessions(filtered, interaction.sortField, interaction.sortDesc)
    val paginated = paginate(sorted, interaction.page)
    val groups = groupByDay(paginated, interaction.sortDesc, zone)
    val trendSeries =
        mapOf(
            "sessions" to dailyChargingTrend(sessions, ChargingTrendMetric.Sessions, zone),
            "energy" to dailyChargingTrend(sessions, ChargingTrendMetric.Energy, zone),
            "cost" to dailyChargingTrend(sessions, ChargingTrendMetric.Cost, zone),
            "power" to dailyChargingTrend(sessions, ChargingTrendMetric.Power, zone),
        )
    val filteredIds = filtered.mapTo(HashSet()) { it.id }
    return ChargingListData(
        windowStart = windowStart,
        windowEnd = windowEnd,
        priorRange = priorRange,
        priorHasData = priorHasData,
        currentStats = currentStats,
        anomalies = anomalies,
        anomalyById = anomalyById,
        notable = notable,
        counts = counts,
        filtered = filtered,
        sorted = sorted,
        paginated = paginated,
        groups = groups,
        trendSeries = trendSeries,
        acDc = computeAcDcBreakdown(sessions),
        startLevel = computeStartLevelDist(sessions),
        efficiency = computeEfficiencyStats(sessions),
        chargerSpecs = computeChargerSpecs(sessions),
        effectiveSelected = interaction.bulkSelected.intersect(filteredIds),
    )
}

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug — carries no vehicle/session id. */
fun recordChargingListPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChargingListPageRegistration.SLUG))
}

private const val MILLIS_PER_MINUTE = 60_000.0
private const val MINUTES_PER_HOUR = 60.0
private const val MINUTES_PER_HOUR_INT = 60
private const val SECONDS_PER_MINUTE = 60.0
private const val HOURS_PER_DAY = 24
private const val WH_PER_KWH = 1000.0
private const val DC_POWER_W = 22_000.0
private const val FAST_PEAK_W = 150_000.0
private const val ZERO_ENERGY_KWH = 0.1
private const val TELEMETRY_GAP_MIN = 5.0
private const val BAD_POWER_MIN = 30.0
private const val BAD_POWER_KW = 3.0
private const val EXPENSIVE_COST_PER_KWH = 0.5
private const val TRICKLE_MIN = 360.0
private const val TRICKLE_KW = 5.0
private const val NOTABLE_CAP = 50
private const val NOTABLE_DECILE = 0.1
private const val START_LEVEL_BANDS = 10
private const val START_LEVEL_BAND_WIDTH = 10.0
private const val EQ_EPSILON = 1e-9
private const val YMD_LENGTH = 10
private const val COMPACT_FROM = 10_000.0
private const val THOUSAND = 1_000.0
private const val MILLION = 1_000_000.0
private const val NOON = 12

private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
