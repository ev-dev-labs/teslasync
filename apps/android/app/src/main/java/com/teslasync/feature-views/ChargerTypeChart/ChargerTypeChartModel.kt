// Pure, framework-free model + projection for the Charge-Rate-by-Charger-Type chart feature view — the
// native analogue of everything the web component derives before returning JSX
// (web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational — its parent passes a `ChargingSession[]`; the component
// derives `chargerTypeStats` via `useMemo`: it groups the sessions by `getChargerLabel(s)` (Supercharger /
// DC Fast / Home·AC) and, per group, computes the session count, the average peak power in kW
// (`peak_power_w / 1000`), the average energy added in kWh (`total_energy_added_wh / 1000`), and the average
// session duration in minutes (`durationMinutes(started_at, ended_at)`). This file owns exactly those
// derivations — [classify] mirrors `getChargerLabel`, [durationMinutes] mirrors the web helper (with its
// invalid-/negative-range guard), [avg] mirrors the web `avg`, and [aggregate] mirrors the `chargerTypeStats`
// memo. Group order is preserved as first-seen (the web `Array.from(groups.entries())` keeps Map insertion
// order), so the native bars, accessible table, and breakdown list all read in the same order.
//
// SI on the wire, display units at the boundary: the input carries watts (`peakPowerW`) and watt-hours
// (`totalEnergyAddedWh`) exactly as the SI-canonical API serves them; the kW / kWh conversion is a
// display-only `/1000` that happens here, never a stored unit-suffixed field.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargerTypeChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargertypechart

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/** Middot separating the two metrics in a breakdown summary — the web `·` literal. */
internal const val MIDDOT: String = "\u00B7"

/** Display divisor: watts→kilowatts and watt-hours→kilowatt-hours both divide by 1000 (web `/ 1000`). */
private const val PER_KILO: Double = 1_000.0

/** DC-fast power floor in watts — the web `peak_power_w > 20_000` heuristic. */
private const val DC_POWER_THRESHOLD_W: Double = 20_000.0

/** Milliseconds per minute — the web `durationMinutes` `/ 60000` divisor. */
private const val MILLIS_PER_MINUTE: Double = 60_000.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ChargerTypeChartRegistration {
    /** Stable surface id. */
    const val ID: String = "charger-type-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChargerTypeChart"
}

/**
 * The charger category a session is grouped under — the stable, locale-independent key the web derives in
 * `getChargerLabel` (which returns the English label directly). Kept as an enum so grouping stays correct
 * across locales and the display label / swatch color are resolved at the render boundary (P1/S9 + S10),
 * never hard-coded English in logic.
 */
enum class ChargerCategory {
    /** A Tesla Supercharger (web: `charger_type` contains "tesla"). */
    Supercharger,

    /** A non-Tesla DC fast charger (web: any other non-empty `charger_type`, or `peak_power_w > 20 kW`). */
    DcFast,

    /** Home / AC (Level 1–2) charging (web: the remaining fallback). */
    HomeAc,
}

/**
 * The subset of a charging session this surface reads — the native mirror of the web `ChargingSession`
 * fields the component touches. [peakPowerW] is the session peak power in watts (SI; nullable, web
 * `peak_power_w`), [totalEnergyAddedWh] the energy added in watt-hours (SI, web `total_energy_added_wh`),
 * and [startedAt] / [endedAt] the ISO-8601 session bounds (web `started_at` / `ended_at`, the latter null
 * while a session is still open). [chargerType] is the raw vendor charger label (web `charger_type`).
 */
data class ChargerSession(
    val chargerType: String?,
    val peakPowerW: Double?,
    val totalEnergyAddedWh: Double,
    val startedAt: String,
    val endedAt: String?,
)

/**
 * One charger-category row of aggregated stats — the native mirror of the web `ChargerTypeStats`
 * (`{ label, count, avgKw, avgKwh, avgDuration }`), minus the display label (resolved from [category] at
 * the render boundary). [avgKw] / [avgKwh] are display kW / kWh and [avgDurationMin] is average minutes.
 */
data class ChargerTypeStat(
    val category: ChargerCategory,
    val count: Long,
    val avgKw: Double,
    val avgKwh: Double,
    val avgDurationMin: Double,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — every
 * `charging.curve.*` and `charging.chargerTypes.*` key the web component resolves via `t(...)`. The
 * lifecycle-chrome strings (empty / error / retry / offline / freshness) are resolved inline at the Compose
 * boundary, not here, so this holder stays a thin content carrier.
 */
data class ChargerTypeChartStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val colCharger: String,
    val colSessions: String,
    val colAvgKw: String,
    val colAvgKwh: String,
    val colAvgMin: String,
    val avgPowerLabel: String,
    val avgEnergyLabel: String,
    val sessionsUnit: String,
    val minAvgUnit: String,
    val superchargerLabel: String,
    val dcFastLabel: String,
    val homeAcLabel: String,
)

/**
 * The locale-bound formatters the projection injects so it stays deterministic and UI-free under test
 * (the native analogue of the web `fmtNumber` / `fmtInt` calls + the `t(...)` label lookups). [label] maps
 * a [ChargerCategory] to its localized display name; [decimal1] formats the table kW / kWh columns to one
 * fraction digit (web `fmtNumber(_, 1)`); [count] formats a session count (web `fmtInt`); [durationInt]
 * formats the table "Avg minutes" column as an integer (web `fmtInt`); [breakdownSummary] builds the
 * per-category footer line (web `{fmtInt(count)} sessions · {fmtNumber(avgDuration)} min avg`).
 */
data class ChargerTypeChartFormatters(
    val label: (ChargerCategory) -> String,
    val decimal1: (Double) -> String,
    val count: (Long) -> String,
    val durationInt: (Double) -> String,
    val breakdownSummary: (count: Long, avgDurationMin: Double) -> String,
)

/** One footer row beneath the chart — a colored [category] swatch, its [label], and the [summary] line. */
data class ChargerBreakdownRow(
    val category: ChargerCategory,
    val label: String,
    val summary: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the props the web `<ComposedChart>`
 * + `<ChartContainer>` + breakdown list read from `chargerTypeStats`. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host: the composable wraps [avgKwValues] / [avgKwhValues] into two
 * `ChartSeries`, feeds [xLabels] to the bottom axis, renders [tableRows] as the accessible fallback table
 * (the web hidden `<table>`), draws [breakdownRows] as the footer, and shows the empty state when [isEmpty].
 */
data class ChargerTypeChartProjectionResult(
    val xLabels: List<String>,
    val avgKwValues: List<Double>,
    val avgKwhValues: List<Double>,
    val tableRows: List<List<String>>,
    val breakdownRows: List<ChargerBreakdownRow>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `chargerTypeStats`
 * memo and its three consumers (the chart series, the accessible data table, and the breakdown footer).
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object ChargerTypeChartProjection {
    /**
     * Classifies a session into its [ChargerCategory] — the native mirror of the web `getChargerLabel`:
     * a `charger_type` containing "tesla" (case-insensitive) is a Supercharger; any other non-empty
     * `charger_type` is DC Fast; an absent type with peak power above [DC_POWER_THRESHOLD_W] is DC Fast;
     * everything else is Home / AC. A single `when` keeps this within the return-count budget.
     */
    fun classify(session: ChargerSession): ChargerCategory {
        val type = session.chargerType
        val power = session.peakPowerW
        return when {
            type != null && type.contains("tesla", ignoreCase = true) -> ChargerCategory.Supercharger
            !type.isNullOrEmpty() -> ChargerCategory.DcFast
            power != null && power > DC_POWER_THRESHOLD_W -> ChargerCategory.DcFast
            else -> ChargerCategory.HomeAc
        }
    }

    /**
     * Rounded session duration in whole minutes — the native mirror of the web `durationMinutes`. Returns
     * 0 when the session is still open ([endedAt] null/blank), when either bound is unparseable, or when the
     * range is non-positive (web `end <= start`), so a malformed row never skews the average.
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
     * Aggregates [sessions] into per-category stats, preserving first-seen group order — the native mirror
     * of the web `chargerTypeStats` memo. kW / kWh are the display `/1000` of the SI watt / watt-hour inputs;
     * an absent peak power contributes 0 kW (web `s.peak_power_w ?? 0`).
     */
    fun aggregate(sessions: List<ChargerSession>): List<ChargerTypeStat> {
        if (sessions.isEmpty()) return emptyList()
        val groups = LinkedHashMap<ChargerCategory, MutableList<ChargerSession>>()
        for (session in sessions) {
            groups.getOrPut(classify(session)) { mutableListOf() }.add(session)
        }
        return groups.map { (category, items) ->
            ChargerTypeStat(
                category = category,
                count = items.size.toLong(),
                avgKw = avg(items.map { (it.peakPowerW ?: 0.0) / PER_KILO }),
                avgKwh = avg(items.map { it.totalEnergyAddedWh / PER_KILO }),
                // `+ 0.0` widens each Long minute count to the mean's Double input type.
                avgDurationMin = avg(items.map { durationMinutes(it.startedAt, it.endedAt) + 0.0 }),
            )
        }
    }

    /**
     * Projects [sessions] into render-ready chart inputs via the injected [formatters], preserving group
     * order. Mirrors the web component's three reads of `chargerTypeStats`: the two bar series
     * ([avgKwValues] / [avgKwhValues]), the `ChartContainer` data table ([tableRows] = label, count, avgKw,
     * avgKwh, avgMinutes), and the footer ([breakdownRows]).
     */
    fun project(
        sessions: List<ChargerSession>,
        formatters: ChargerTypeChartFormatters,
    ): ChargerTypeChartProjectionResult {
        val stats = aggregate(sessions)
        return ChargerTypeChartProjectionResult(
            xLabels = stats.map { formatters.label(it.category) },
            avgKwValues = stats.map { it.avgKw },
            avgKwhValues = stats.map { it.avgKwh },
            tableRows =
                stats.map { stat ->
                    listOf(
                        formatters.label(stat.category),
                        formatters.count(stat.count),
                        formatters.decimal1(stat.avgKw),
                        formatters.decimal1(stat.avgKwh),
                        formatters.durationInt(stat.avgDurationMin),
                    )
                },
            breakdownRows =
                stats.map { stat ->
                    ChargerBreakdownRow(
                        category = stat.category,
                        label = formatters.label(stat.category),
                        summary = formatters.breakdownSummary(stat.count, stat.avgDurationMin),
                    )
                },
            isEmpty = stats.isEmpty(),
        )
    }

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
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChargerTypeChartRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordChargerTypeChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChargerTypeChartRegistration.SLUG))
}
