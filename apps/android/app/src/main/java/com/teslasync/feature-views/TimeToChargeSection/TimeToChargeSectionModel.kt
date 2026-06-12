// Pure, framework-free model + projection for the TimeToChargeSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent passes a `ChargingSession[]` and it derives a
// `timeToCharge` document via `useMemo`, then renders four metric cards (10%→80% and 20%→80% average DC
// durations, plus the fastest and slowest sessions by charge rate) followed by a yearly-trend chart. This
// file owns exactly those derivations: [isDcSession] mirrors the web `isDcSession` helper, [durationMinutes]
// mirrors the web `durationMinutes` helper (with its open-/invalid-/negative-range guard), [avg] mirrors the
// web `avg`, and [compute] mirrors the `timeToCharge` memo field-for-field (the 10/20→80 SOC crossings, the
// `(kWh / minutes) * 60` charge rate with its JS-reduce tie-breaking, and the per-year aggregation sorted by
// year). The four cards are projected by [project] via injected formatters, exactly as the web maps the memo
// onto its `TimeToChargeCard`s.
//
// The yearly trend the section computes feeds a separate surface (the YearlyTrendChart feature view has its
// own prompt); [TimeToChargeMetrics.yearlyTrend] is computed and exposed here for faithfulness and for the
// host to forward, while this surface renders only its own title, description, and four cards.
//
// SI on the wire, display units at the boundary: the input carries watt-hours (`totalEnergyAddedWh`) and
// watts (`peakPowerW`) exactly as the SI-canonical API serves them; the kWh conversion is a display-only
// `/1000` that happens here (web `convertEnergyFromSI(_, 'kWh')`), never a stored unit-suffixed field. The
// "min" and "kWh/h" unit symbols are carried verbatim from the web `unit` props.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TimeToChargeSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.timetochargesection

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/** Display unit for the two average-duration cards — the web `unit="min"` symbol. */
internal const val MIN_UNIT: String = "min"

/** Display unit for the fastest/slowest charge-rate cards — the web `unit="kWh/h"` symbol. */
internal const val RATE_UNIT: String = "kWh/h"

/** Watt-hours per kilowatt-hour — the web `convertEnergyFromSI(wh, 'kWh')` `/1000` divisor. */
private const val WH_PER_KWH: Double = 1_000.0

/** DC-fast power floor in watts — the web `isDcSession` `peak_power_w > 20_000` heuristic. */
private const val DC_POWER_THRESHOLD_W: Double = 20_000.0

/** Milliseconds per minute — the web `durationMinutes` `/ 60000` divisor. */
private const val MILLIS_PER_MINUTE: Double = 60_000.0

/** Minutes per hour — the web rate's `* 60` scale from per-minute to per-hour. */
private const val MINUTES_PER_HOUR: Double = 60.0

/** Lower SOC bound for the 10→80 crossing — web `start_soc_pct <= 10`. */
private const val SOC_START_10: Double = 10.0

/** Lower SOC bound for the 20→80 crossing — web `start_soc_pct <= 20`. */
private const val SOC_START_20: Double = 20.0

/** Upper SOC bound shared by both crossings — web `(end_soc_pct ?? 0) >= 80`. */
private const val SOC_END_80: Double = 80.0

/** A missing end SOC counts as 0 — the web `(s.end_soc_pct ?? 0)` fallback. */
private const val END_SOC_FALLBACK: Double = 0.0

/** Characters of an ISO timestamp that make up the year — web `started_at.slice(0, 4)`. */
private const val YEAR_PREFIX_LENGTH: Int = 4

/** Rounds the yearly trend to one decimal — web `Math.round(avg * 10) / 10`. */
private const val TREND_ROUND_FACTOR: Double = 10.0

/** Fraction digits for card values — the web `fmtNumber(_)` default precision (`useSettings` default = 2). */
internal const val VALUE_DECIMALS: Int = 2

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TimeToChargeSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "time-to-charge-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TimeToChargeSection"
}

/**
 * The subset of a charging session this surface reads — the native mirror of the web `ChargingSession`
 * fields the component touches. [id] is the session id shown in the fastest/slowest subtitle (web `s.id`),
 * [chargerType] the raw vendor charger label (web `charger_type`), [peakPowerW] the peak power in watts
 * (SI; nullable, web `peak_power_w`), [totalEnergyAddedWh] the energy added in watt-hours (SI, web
 * `total_energy_added_wh`), [startSocPct] / [endSocPct] the start/end state of charge in percent (web
 * `start_soc_pct` / `end_soc_pct`, the latter null while a session is open), and [startedAt] / [endedAt]
 * the ISO-8601 session bounds (web `started_at` / `ended_at`, the latter null while still charging).
 */
data class TimeToChargeSession(
    val id: Long,
    val chargerType: String?,
    val peakPowerW: Double?,
    val totalEnergyAddedWh: Double,
    val startSocPct: Double,
    val endSocPct: Double?,
    val startedAt: String,
    val endedAt: String?,
)

/**
 * One session's charge rate — the native mirror of the web `withRate` entry (`{ id, rate }`). [rate] is the
 * display kWh-per-hour the fastest/slowest cards format; [id] feeds the "Session #{{id}}" subtitle.
 */
data class TimeToChargeSessionRate(
    val id: Long,
    val rate: Double,
)

/**
 * One year of the charging-speed trend — the native mirror of the web `yearlyTrend` entry. [avg10to80] /
 * [avg20to80] are the per-year average DC durations in minutes (rounded to one decimal, web
 * `Math.round(avg * 10) / 10`) and [count] is the number of DC sessions in that [year].
 */
data class TimeToChargeYearPoint(
    val year: String,
    val avg10to80: Double,
    val avg20to80: Double,
    val count: Long,
)

/**
 * The fully derived metrics document — the native analogue of the web `TimeToChargeMetrics` the `useMemo`
 * returns. [avg10to80] / [avg20to80] are the average DC durations (minutes) for the two SOC crossings, or
 * `null` when no DC session crosses them (web `null`); [fastest] / [slowest] are the extreme-rate sessions,
 * or `null` when no DC session has a positive duration and energy; [yearlyTrend] is the per-year aggregation
 * in ascending year order (consumed by the separate YearlyTrendChart surface).
 */
data class TimeToChargeMetrics(
    val avg10to80: Double?,
    val avg20to80: Double?,
    val fastest: TimeToChargeSessionRate?,
    val slowest: TimeToChargeSessionRate?,
    val yearlyTrend: List<TimeToChargeYearPoint>,
)

/** Which of the four metric cards a [TimeToChargeCard] represents; the render layer resolves its label. */
enum class TimeToChargeCardKind {
    /** Average DC duration for the 10%→80% crossing (web `avg10to80`). */
    Avg10To80,

    /** Average DC duration for the 20%→80% crossing (web `avg20to80`). */
    Avg20To80,

    /** The session with the highest charge rate (web `fastest`). */
    Fastest,

    /** The session with the lowest charge rate (web `slowest`). */
    Slowest,
}

/**
 * One render-ready metric card — the native analogue of the props the web `TimeToChargeCard` receives.
 * [kind] selects the localized label at render time, [value] is the already-formatted number or `null` (the
 * web `value ?? '—'`), [unit] is the unit symbol shown only alongside a present value (web `{unit && value}`),
 * and [subtitle] is the secondary line ("Avg duration" for the averages, "Session #{{id}}" for the extremes,
 * or `null` when there is no session to attribute).
 */
data class TimeToChargeCard(
    val kind: TimeToChargeCardKind,
    val value: String?,
    val unit: String,
    val subtitle: String?,
)

/**
 * The locale-bound formatters + labels the projection injects so it stays deterministic and UI-free under
 * test (the native analogue of the web `fmtNumber` calls and the `t(...)` lookups). [number] formats a card
 * value (web `fmtNumber(_)`), [sessionId] builds the "Session #{{id}}" subtitle for a session id, and
 * [avgDurationLabel] is the already-localized "Avg duration" subtitle shared by the two average cards.
 */
data class TimeToChargeFormatters(
    val number: (Double) -> String,
    val sessionId: (Long) -> String,
    val avgDurationLabel: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `timeToCharge` memo
 * and the four `TimeToChargeCard`s it feeds. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings + colors and draws what these return.
 */
object TimeToChargeProjection {
    /** The all-empty metrics returned when there are no DC sessions — the web `empty` constant. */
    private val EMPTY_METRICS =
        TimeToChargeMetrics(
            avg10to80 = null,
            avg20to80 = null,
            fastest = null,
            slowest = null,
            yearlyTrend = emptyList(),
        )

    /**
     * Whether a session is a DC fast-charge session — the native mirror of the web `isDcSession`: a non-empty
     * `charger_type`, or a peak power above [DC_POWER_THRESHOLD_W].
     */
    fun isDcSession(session: TimeToChargeSession): Boolean =
        !session.chargerType.isNullOrEmpty() ||
            (session.peakPowerW != null && session.peakPowerW > DC_POWER_THRESHOLD_W)

    /**
     * Rounded session duration in whole minutes — the native mirror of the web `durationMinutes`. Returns 0
     * when the session is still open ([endedAt] null/blank), when either bound is unparseable, or when the
     * range is non-positive (web `end <= start`), so a malformed row never skews an average or a rate.
     */
    fun durationMinutes(
        startedAt: String,
        endedAt: String?,
    ): Long {
        val start = parseEpochMillis(startedAt)
        val end = parseEpochMillis(endedAt)
        if (start == null || end == null || end <= start) return 0L
        return Math.round((end - start) / MILLIS_PER_MINUTE)
    }

    /** Arithmetic mean, 0 for an empty list — the native mirror of the web `avg`. */
    fun avg(values: List<Double>): Double = if (values.isEmpty()) 0.0 else values.sum() / values.size

    /**
     * Derives the [TimeToChargeMetrics] from [sessions] — a field-for-field port of the web `timeToCharge`
     * memo. An empty session list and a list with no DC sessions both yield [EMPTY_METRICS] (the web's two
     * guards collapse: no sessions ⇒ no DC sessions), so this needs a single guard.
     */
    fun compute(sessions: List<TimeToChargeSession>): TimeToChargeMetrics {
        val dcSessions = sessions.filter { isDcSession(it) }
        if (dcSessions.isEmpty()) return EMPTY_METRICS

        val avg10to80 = crossingAverage(dcSessions, SOC_START_10)
        val avg20to80 = crossingAverage(dcSessions, SOC_START_20)

        val withRate =
            dcSessions
                .filter { durationMinutes(it.startedAt, it.endedAt) > 0L && it.totalEnergyAddedWh > 0.0 }
                .map { TimeToChargeSessionRate(id = it.id, rate = chargeRateKwhPerHour(it)) }

        // JS `reduce` keeps the later element on a tie; `reduce` here matches that left-to-right semantics.
        val fastest = if (withRate.isEmpty()) null else withRate.reduce { a, b -> if (a.rate > b.rate) a else b }
        val slowest = if (withRate.isEmpty()) null else withRate.reduce { a, b -> if (a.rate < b.rate) a else b }

        return TimeToChargeMetrics(
            avg10to80 = avg10to80,
            avg20to80 = avg20to80,
            fastest = fastest,
            slowest = slowest,
            yearlyTrend = yearlyTrend(dcSessions),
        )
    }

    /**
     * Projects [metrics] into the four render-ready cards via the injected [formatters], in web source order:
     * 10%→80%, 20%→80%, fastest, slowest. The average cards always carry the "Avg duration" subtitle (web
     * renders it unconditionally); the extreme cards carry a "Session #{{id}}" subtitle only when present.
     */
    fun project(
        metrics: TimeToChargeMetrics,
        formatters: TimeToChargeFormatters,
    ): List<TimeToChargeCard> =
        listOf(
            averageCard(TimeToChargeCardKind.Avg10To80, metrics.avg10to80, formatters),
            averageCard(TimeToChargeCardKind.Avg20To80, metrics.avg20to80, formatters),
            rateCard(TimeToChargeCardKind.Fastest, metrics.fastest, formatters),
            rateCard(TimeToChargeCardKind.Slowest, metrics.slowest, formatters),
        )

    /** Convenience: [compute] then [project] — the single call the composable makes per locale. */
    fun projectCards(
        sessions: List<TimeToChargeSession>,
        formatters: TimeToChargeFormatters,
    ): List<TimeToChargeCard> = project(compute(sessions), formatters)

    /** The average DC duration (minutes) for sessions whose start SOC is at/below [startBelow] and end ≥ 80. */
    private fun crossingAverage(
        dcSessions: List<TimeToChargeSession>,
        startBelow: Double,
    ): Double? {
        val crossing = dcSessions.filter { crosses(it, startBelow) }
        if (crossing.isEmpty()) return null
        return avg(crossing.map { durationMinutes(it.startedAt, it.endedAt) + 0.0 })
    }

    /** Whether a session starts at/below [startBelow] SOC and ends at/above 80 — the web crossing predicate. */
    private fun crosses(
        session: TimeToChargeSession,
        startBelow: Double,
    ): Boolean = session.startSocPct <= startBelow && (session.endSocPct ?: END_SOC_FALLBACK) >= SOC_END_80

    /** Charge rate in kWh per hour — web `(convertEnergyFromSI(wh, 'kWh') / durationMinutes) * 60`. */
    private fun chargeRateKwhPerHour(session: TimeToChargeSession): Double {
        val minutes = durationMinutes(session.startedAt, session.endedAt)
        val kwh = session.totalEnergyAddedWh / WH_PER_KWH
        return (kwh / minutes) * MINUTES_PER_HOUR
    }

    /**
     * Aggregates DC sessions per year, preserving ascending year order — the native mirror of the web
     * `yearlyTrend`. Each year's 10→80 and 20→80 durations are averaged and rounded to one decimal; a year
     * with no crossing of a kind averages to 0.0 (web `Math.round(avg([]) * 10) / 10`).
     */
    private fun yearlyTrend(dcSessions: List<TimeToChargeSession>): List<TimeToChargeYearPoint> {
        val byYear = LinkedHashMap<String, YearAccumulator>()
        for (session in dcSessions) {
            val year = session.startedAt.take(YEAR_PREFIX_LENGTH)
            val acc = byYear.getOrPut(year) { YearAccumulator() }
            acc.count++
            val minutes = durationMinutes(session.startedAt, session.endedAt) + 0.0
            if (crosses(session, SOC_START_10)) acc.tenToEighty.add(minutes)
            if (crosses(session, SOC_START_20)) acc.twentyToEighty.add(minutes)
        }
        return byYear.entries
            .sortedBy { it.key }
            .map { (year, acc) ->
                TimeToChargeYearPoint(
                    year = year,
                    avg10to80 = roundToOneDecimal(avg(acc.tenToEighty)),
                    avg20to80 = roundToOneDecimal(avg(acc.twentyToEighty)),
                    count = acc.count,
                )
            }
    }

    /** One average card: value formatted when present (else `null` → "—"), always with the "Avg duration" line. */
    private fun averageCard(
        kind: TimeToChargeCardKind,
        value: Double?,
        formatters: TimeToChargeFormatters,
    ): TimeToChargeCard =
        TimeToChargeCard(
            kind = kind,
            value = value?.let { formatters.number(it) },
            unit = MIN_UNIT,
            subtitle = formatters.avgDurationLabel,
        )

    /** One extreme-rate card: value + "Session #{{id}}" subtitle when present, else `null` value/subtitle. */
    private fun rateCard(
        kind: TimeToChargeCardKind,
        rate: TimeToChargeSessionRate?,
        formatters: TimeToChargeFormatters,
    ): TimeToChargeCard =
        TimeToChargeCard(
            kind = kind,
            value = rate?.let { formatters.number(it.rate) },
            unit = RATE_UNIT,
            subtitle = rate?.let { formatters.sessionId(it.id) },
        )

    /** Web `Math.round(value * 10) / 10` — round half-up to one decimal place. */
    private fun roundToOneDecimal(value: Double): Double = Math.round(value * TREND_ROUND_FACTOR) / TREND_ROUND_FACTOR

    // Tolerant decode chain → epoch millis: an RFC-3339 instant ("…Z"), then an offset date-time, then a
    // zoneless local date-time treated as UTC. The first that parses wins; none parsing yields null (the
    // web `new Date(x).getTime()` NaN path → treated as a 0-minute session by [durationMinutes]).
    private val instantParsers: List<(String) -> Long?> =
        listOf(
            { raw -> tryParseMillis { Instant.parse(raw).toEpochMilli() } },
            { raw -> tryParseMillis { OffsetDateTime.parse(raw).toInstant().toEpochMilli() } },
            { raw -> tryParseMillis { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() } },
        )

    private fun parseEpochMillis(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        return instantParsers.firstNotNullOfOrNull { it(raw) }
    }

    private inline fun tryParseMillis(block: () -> Long): Long? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }

    /** Mutable per-year accumulator used only inside [yearlyTrend]. */
    private class YearAccumulator {
        var count: Long = 0
        val tenToEighty: MutableList<Double> = mutableListOf()
        val twentyToEighty: MutableList<Double> = mutableListOf()
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TimeToChargeSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect. Carries no VIN, location, or charge value — only the surface slug.
 */
fun recordTimeToChargeSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TimeToChargeSectionRegistration.SLUG))
}
