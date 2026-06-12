// Pure, framework-free model + projection for the Session Comparison charging-curve feature view — the
// native analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx). No Compose, no Android,
// no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational — its parent (the Charging Curve page) loads the
// `ChargingSession[]` and passes it down. This file owns the parts the web `useMemo` blocks compute from that
// prop: the first-10 cap (`sessions.slice(0, 10)`), the per-session simulated power-vs-SOC curve
// (`generateChargingCurve`), the sorted union of SOC values that becomes the shared X axis, and each
// session's power value aligned to that axis (absent where the session's curve has no sample for that SOC —
// the web leaves `point[key]` undefined, which the line bridges; here the value is `null`, the Android
// `connectNulls`). The session order is preserved exactly as received so the overlay colors and legend read
// in the same order as the web.
//
// Charger classification mirrors the web `helpers.ts` (`isDcSession` / `getChargerLabel`) but returns a
// semantic [ChargerKind] rather than an English string, so the render boundary localizes it through the
// P1/S10 catalog (the `charging.chargerTypes.*` keys) — no English literal is hard-coded here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SessionComparisonChart — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessioncomparisonchart

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

/** Em dash shown when a session date is missing or unparseable — the web `formatDateShort` `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SessionComparisonChartRegistration {
    /** Stable surface id. */
    const val ID: String = "session-comparison-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SessionComparisonChart"
}

/**
 * One charging session, reduced to the fields the comparison curve reads — the native mirror of the slice of
 * the web `ChargingSession` this component touches. [startedAt] is the ISO-8601 session start (the legend +
 * series label), [chargerType] the optional connector descriptor, [peakPowerW] the peak power in watts (SI),
 * and [startSocPct] / [endSocPct] the bounding state-of-charge percentages of the curve. Nullable fields
 * mirror the web optionals; the projection applies the same defaults the web helper does.
 */
data class ChargingCurveSession(
    val id: Long,
    val startedAt: String,
    val chargerType: String? = null,
    val peakPowerW: Double? = null,
    val startSocPct: Double? = null,
    val endSocPct: Double? = null,
)

/**
 * The connector classification the web `getChargerLabel` derives. Kept semantic (not an English string) so
 * the composable localizes it via the catalog's `charging.chargerTypes.*` keys. [Supercharger] is the web
 * "Supercharger", [DcFast] the web "DC Fast", [HomeAc] the web "Home / AC".
 */
enum class ChargerKind { Supercharger, DcFast, HomeAc }

/** A single `(soc, power)` sample on a session's simulated curve — the web `CurvePoint`. */
data class CurvePoint(
    val soc: Double,
    val power: Double,
)

/**
 * One projected overlay line — the native analogue of a web `<Line dataKey="s{i}">`. [key] is the stable
 * `s{index}` series key, [seriesLabel] the web `<Line name>` (`"{date} ({charger})"`, read by the chart's
 * hover marker + accessible summary), [legendLabel] the date-only label of the web custom legend, [values]
 * the per-SOC power aligned to the shared X axis (`null` where this session has no sample), and [colorIndex]
 * the palette slot (the web `palette[i % palette.length]`).
 */
data class SessionComparisonSeries(
    val key: String,
    val seriesLabel: String,
    val legendLabel: String,
    val values: List<Double?>,
    val colorIndex: Int,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's `comparisonData`
 * `useMemo` plus the per-line props. Pure data (no Compose types) so the projection is unit-tested without a
 * UI host: the composable wraps each [series] into a `ChartSeries` + `LegendEntry`, and feeds [xLabels] (the
 * sorted SOC axis) to the line chart's bottom axis. [isEmpty] is true when there is nothing to plot.
 */
data class SessionComparisonChartProjectionResult(
    val xLabels: List<String>,
    val series: List<SessionComparisonSeries>,
    val isEmpty: Boolean,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10). [title] /
 * [subtitle] / [ariaLabel] are the web `t('charging.curve.sessionComparison' | 'sessionComparisonDesc' |
 * 'sessionComparison.aria')`; [powerAxisLabel] / [socAxisLabel] are the web `<YAxis>` / `<XAxis>` titles
 * (`powerKw` / `socPercent`); and the three charger labels localize [ChargerKind]. The lifecycle-chrome
 * strings (empty / error / retry / offline / freshness) are resolved inline at the Compose boundary, so this
 * holder stays a thin content carrier.
 */
data class SessionComparisonChartStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val powerAxisLabel: String,
    val socAxisLabel: String,
    val superchargerLabel: String,
    val dcFastLabel: String,
    val homeAcLabel: String,
) {
    /** Localizes a [ChargerKind] — the render-side analogue of the web `getChargerLabel` string. */
    fun chargerLabel(kind: ChargerKind): String =
        when (kind) {
            ChargerKind.Supercharger -> superchargerLabel
            ChargerKind.DcFast -> dcFastLabel
            ChargerKind.HomeAc -> homeAcLabel
        }
}

/**
 * The web `t(key, default)` fallback strings for the two keys the web component supplies inline but that are
 * absent from the shared catalog (`charging.curve.sessionComparisonDesc` and `...sessionComparison.aria` are
 * not in `web/src/i18n/en.json`, so i18next renders the inline default). These reproduce that default exactly;
 * the auto-generated, drift-checked catalog (ADR-014) is never hand-edited, so the composable reads the key
 * by name and falls back here when it is absent — mirroring the `ByteSizeConverter` surface.
 */
object SessionComparisonChartDefaults {
    /** Web `t('charging.curve.sessionComparisonDesc', …)` default. */
    const val SUBTITLE: String = "Power curves overlaid from last 10 sessions"

    /** Web `t('charging.curve.sessionComparison.aria', …)` default. */
    const val ARIA_LABEL: String = "Overlaid power-vs-SOC line chart comparing the last several charging sessions"
}

/** Resource name for the web `sessionComparisonDesc` subtitle key (by-name; absent ⇒ default). */
const val KEY_SUBTITLE: String = "translation_charging_curve_sessionComparisonDesc"

/** Resource name for the web `sessionComparison.aria` key (by-name; absent ⇒ default). */
const val KEY_ARIA_LABEL: String = "translation_charging_curve_sessionComparison_aria"

/**
 * Optional by-name resolution — the seam that reproduces the web `t(key, default)` for keys the catalog may
 * not carry. Pure (a `(String) -> String?` lookup is injected) so it is unit-tested without Android; the
 * composable supplies the real `resources.getIdentifier`-backed lookup.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The pure projection the composable renders — the native mirror of the web component's `comparisonData`
 * derivation. Stateless and side-effect-free so it is fully covered by the off-device unit gate. The
 * [chargerLabel] / [formatDate] / [formatSoc] formatters are injected to keep the function locale/zone
 * deterministic for tests (the composable supplies the localized implementations).
 */
object SessionComparisonChartProjection {
    /** The web `sessions.slice(0, 10)` overlay cap. */
    const val MAX_SESSIONS: Int = 10

    /** Series key prefix — the web `s${i}` data key. */
    const val SERIES_KEY_PREFIX: String = "s"

    /** Web `peak_power_w ?? 11_000` default peak power, in watts. */
    const val DEFAULT_PEAK_POWER_W: Double = 11_000.0

    /** Web DC threshold: a session above 20 kW peak is treated as DC fast charging. */
    const val DC_THRESHOLD_W: Double = 20_000.0

    private const val WATTS_PER_KW: Double = 1_000.0
    private const val SOC_STEP: Double = 1.0
    private const val SOC_DEFAULT_END: Double = 100.0
    private const val TAPER_MID_SOC: Double = 50.0
    private const val TAPER_HIGH_SOC: Double = 80.0
    private const val TAPER_MID_SPAN: Double = 30.0
    private const val TAPER_HIGH_SPAN: Double = 20.0
    private const val TAPER_MID_DROP: Double = 0.5
    private const val TAPER_HIGH_DROP: Double = 0.7
    private const val POWER_ROUND_FACTOR: Double = 10.0

    /**
     * Projects the loaded [sessions] (first [MAX_SESSIONS]) into the overlay. Builds each session's curve,
     * unions and sorts their SOC values into the shared X axis, then aligns each session's rounded power to
     * that axis (`null` where the session has no sample for a SOC). Returns an empty result when there is
     * nothing to plot, so the composable shows the friendly empty state rather than a blank panel.
     */
    fun project(
        sessions: List<ChargingCurveSession>,
        chargerLabel: (ChargerKind) -> String,
        formatDate: (String) -> String,
        formatSoc: (Double) -> String,
    ): SessionComparisonChartProjectionResult {
        val comparison = sessions.take(MAX_SESSIONS)
        val curves = comparison.map { generateChargingCurve(it) }
        val socAxis = curves.flatMap { points -> points.map { it.soc } }.distinct().sorted()
        if (comparison.isEmpty() || socAxis.isEmpty()) {
            return SessionComparisonChartProjectionResult(emptyList(), emptyList(), isEmpty = true)
        }
        val series =
            comparison.mapIndexed { index, session ->
                val powerBySoc = curves[index].associate { it.soc to round1(it.power) }
                SessionComparisonSeries(
                    key = SERIES_KEY_PREFIX + index,
                    seriesLabel = "${formatDate(session.startedAt)} (${chargerLabel(chargerKind(session))})",
                    legendLabel = formatDate(session.startedAt),
                    values = socAxis.map { soc -> powerBySoc[soc] },
                    colorIndex = index,
                )
            }
        return SessionComparisonChartProjectionResult(
            xLabels = socAxis.map(formatSoc),
            series = series,
            isEmpty = false,
        )
    }

    /**
     * Simulates a power-vs-SOC curve from session metadata — the exact port of the web `generateChargingCurve`.
     * DC sessions hold peak power to 50% SOC, taper to half by 80%, then fall steeply; AC sessions stay flat.
     * Power is floored at zero. An inverted SOC range yields an empty curve (the web `for` loop would not run).
     */
    fun generateChargingCurve(session: ChargingCurveSession): List<CurvePoint> {
        val startSoc = session.startSocPct ?: 0.0
        val endSoc = session.endSocPct ?: SOC_DEFAULT_END
        val peakPower = (session.peakPowerW ?: DEFAULT_PEAK_POWER_W) / WATTS_PER_KW
        val dc = isDcSession(session)
        val points = mutableListOf<CurvePoint>()
        var soc = startSoc
        while (soc <= endSoc) {
            val power =
                if (dc) {
                    dcPowerAt(soc, peakPower)
                } else {
                    peakPower
                }
            points.add(CurvePoint(soc = soc, power = max(power, 0.0)))
            soc += SOC_STEP
        }
        return points
    }

    /** The DC taper at a given [soc] for a session's [peakPower] (kW) — the web DC branch. */
    private fun dcPowerAt(
        soc: Double,
        peakPower: Double,
    ): Double =
        when {
            soc <= TAPER_MID_SOC -> peakPower
            soc <= TAPER_HIGH_SOC -> peakPower * (1 - ((soc - TAPER_MID_SOC) / TAPER_MID_SPAN) * TAPER_MID_DROP)
            else -> peakPower * TAPER_MID_DROP * (1 - ((soc - TAPER_HIGH_SOC) / TAPER_HIGH_SPAN) * TAPER_HIGH_DROP)
        }

    /** Web `isDcSession`: a non-empty charger type, or a peak above the DC threshold. */
    fun isDcSession(session: ChargingCurveSession): Boolean =
        !session.chargerType.isNullOrEmpty() ||
            (session.peakPowerW != null && session.peakPowerW > DC_THRESHOLD_W)

    /** Web `getChargerLabel`, returning the semantic [ChargerKind] the render boundary localizes. */
    fun chargerKind(session: ChargingCurveSession): ChargerKind {
        val type = session.chargerType
        return when {
            type == "Tesla" || (type ?: "").lowercase(Locale.ROOT).contains("tesla") -> ChargerKind.Supercharger
            !type.isNullOrEmpty() -> ChargerKind.DcFast
            session.peakPowerW != null && session.peakPowerW > DC_THRESHOLD_W -> ChargerKind.DcFast
            else -> ChargerKind.HomeAc
        }
    }

    /** Locale-aware SOC axis label — an integer when whole (the common case), else one fraction digit. */
    fun formatSoc(
        soc: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val digits = if (soc % SOC_STEP == 0.0) 0 else 1
        return String.format(locale, "%,.${digits}f", soc)
    }

    /** Rounds power to one decimal — the web `Math.round(power * 10) / 10`. */
    private fun round1(value: Double): Double = (value * POWER_ROUND_FACTOR).roundToInt() / POWER_ROUND_FACTOR
}

/**
 * Tolerant date → localized "short month + day" formatter — the native analogue of the web `formatDateShort`
 * (`toLocaleDateString` with `{ month: 'short', day: 'numeric' }`, e.g. `Apr 4`). Pure (java.time only) so it
 * is unit-tested deterministically with a fixed zone/locale. A blank or unparseable input yields [EM_DASH],
 * exactly like the web helper's invalid-date guard. The session start is normally a full ISO date-time, but
 * the decode chain also tolerates a date-only `YYYY-MM-DD` (web `new Date(iso)` accepts both).
 */
object SessionDateFormatting {
    private const val MONTH_DAY_PATTERN = "MMM d"

    fun format(
        date: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val localDate = parseDate(date, zone) ?: return EM_DASH
        return DateTimeFormatter.ofPattern(MONTH_DAY_PATTERN, locale).format(localDate)
    }

    // Tolerant decode chain: a date-only `YYYY-MM-DD`, then an offset date-time, then a zoneless local
    // date-time, then an RFC-3339 instant resolved in [zone]. The first that parses wins; none parsing
    // yields the em-dash guard above.
    private val parsers: List<(String, ZoneId) -> LocalDate?> =
        listOf(
            { raw, _ -> tryParse { LocalDate.parse(raw) } },
            { raw, _ -> tryParse { OffsetDateTime.parse(raw).toLocalDate() } },
            { raw, _ -> tryParse { LocalDateTime.parse(raw).toLocalDate() } },
            { raw, zone -> tryParse { Instant.parse(raw).atZone(zone).toLocalDate() } },
        )

    private fun parseDate(
        raw: String,
        zone: ZoneId,
    ): LocalDate? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw, zone) }

    private fun tryParse(block: () -> LocalDate): LocalDate? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SessionComparisonChartRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordSessionComparisonChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SessionComparisonChartRegistration.SLUG))
}
