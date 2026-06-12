// Pure, framework-free model + projection for the DrivingCoachSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// DrivingCoachSection is purely presentational — the web component takes its `coachData` (a `DrivingCoachData`)
// as a prop from the Driving-Dynamics page that owns the TanStack query, so this surface binds NO data hook of
// its own (its only web hook is `useTranslation`, mapped here to the i18n catalog, P1/S10). As in the sibling
// DrivingSection / BatteryHealthSection ports, the cache-then-network lifecycle (loading / error / stale /
// offline) is supplied by the owning page through the shared P1/S8 state-holder layer as a [UiState]; the
// composable renders every state that layer can carry without ever fetching. This file owns the parts the web
// render derives from its prop: the clamped overall-score + its threshold color band, the formatted "drives
// analyzed" count, the style-breakdown bar segments + legend, the formatted "Wh/km" efficiency strings, the
// weekly-trend points, the five pattern bars (value + threshold tone), the impact-colored recommendations, and
// the per-drive rows (formatted cells + the raw comparables the sortable table orders on).
//
// CRITICAL parity note: like the web DrivingSection, the web DrivingCoachSection does NOT call `useUnits` — it
// reads `efficiency_wh_km` / `best_efficiency_wh_km` / `r.efficiency` / `r.distance` directly and hard-labels
// them "Wh/km" / "km" (the coach payload is computed in metric already). This port reproduces that verbatim:
// no SI -> display conversion, the unit symbols are literal suffixes exactly as the web template strings write
// them (the same approach the sibling DrivingSection port takes for its `UNIT_*` constants).
//
// Numeric formatting mirrors the web `fmtNumber` (web/src/lib/numberFormat.ts): a non-finite input folds to 0
// (web `safeNumber`), then locale grouping with a fixed fraction-digit count; the component passes no decimals
// so the web global precision (2) applies. `formatDateShort` mirrors the web `formatDateShort`
// (web/src/lib/dateFormat.ts) — a localized "MMM d" (em dash for blank / unparseable input). The badge tone
// thresholds and the pattern lo/hi bounds are the web ternaries verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DrivingCoachSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingcoachsection

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/** Em dash shown wherever a value is absent — the web `'—'` / `formatDateShort` invalid-input marker. */
internal const val DRIVING_COACH_EM_DASH: String = "\u2014"

/** Web global precision (`_globalPrecision = 2`) — the component passes no `decimals`, so two applies. */
private const val DEFAULT_PRECISION: Int = 2

/** Upper clamp on fraction digits, guarding the format specifier against absurd precision requests. */
private const val MAX_FRACTION_DIGITS: Int = 6

/** Whole percentage — the web `(count / total) * 100` style-breakdown share. */
private const val PERCENT_FULL: Double = 100.0

/** The radial gauge maximum (web `<RadialGauge max={100} />`). */
internal const val SCORE_MAX: Double = 100.0

/** Score at or above this is "good" — the web `overall_score >= 75 ? green` gauge / badge branch. */
private const val SCORE_GOOD_MIN: Double = 75.0

/** Score at or above this (but below [SCORE_GOOD_MIN]) is "warning" — the web `>= 50 ? amber` branch. */
private const val SCORE_WARN_MIN: Double = 50.0

/** The weekly trend renders a line only with more than one week (web `weekly_trend.length > 1`). */
private const val WEEKLY_TREND_MIN_POINTS: Int = 1

/** Unit suffix the web hard-codes on the efficiency stat values (`{value} Wh/km`); not an i18n key in source. */
internal const val UNIT_EFFICIENCY: String = "Wh/km"

/** Unit suffix the web hard-codes on the per-drive distance cell (`{value} km`); not an i18n key in source. */
internal const val UNIT_DISTANCE: String = "km"

/** Sortable-column keys — shared by the per-drive [DrivingCoachProjection.sortDriveRows] and the table headers. */
internal const val SORT_KEY_DATE: String = "date"
internal const val SORT_KEY_SCORE: String = "score"
internal const val SORT_KEY_STYLE: String = "style"
internal const val SORT_KEY_EFFICIENCY: String = "efficiency"
internal const val SORT_KEY_DISTANCE: String = "distance"

/**
 * A semantic status tint, kept UI-free so the projection stays a pure function. The render layer maps each
 * tone onto a shared `BadgeVariant` / status token, so light / dark / high-contrast all resolve correctly —
 * the native analogue of the web `success` / `warning` / `danger` Badge variants and the emerald / amber / red
 * threshold text colors.
 */
enum class CoachTone { Success, Warning, Danger }

/**
 * The three driving styles the breakdown bar + legend iterate, in the web's fixed order
 * (`['efficient', 'moderate', 'aggressive'] as const`). [wireId] is the API category key (the
 * `style_breakdown` map key and the `CoachDriveScore.style` union value); [tone] is the web color the bar
 * segment, legend dot, and per-drive Style badge share (`efficient` success, `moderate` warning, `aggressive`
 * danger). These are data-domain identifiers from the API — not UI chrome — so they are not i18n keys; the web
 * legend label is `t('dynamics.coach.style.{key}', key)`, and those keys are absent from both the web and
 * Android catalogs, so the raw (capitalized) category is the label.
 */
enum class CoachStyle(
    val wireId: String,
    val tone: CoachTone,
) {
    Efficient("efficient", CoachTone.Success),
    Moderate("moderate", CoachTone.Warning),
    Aggressive("aggressive", CoachTone.Danger),
    ;

    companion object {
        /** The style whose [wireId] matches [raw] (case-insensitive), or `null` for an unknown category. */
        fun fromWire(raw: String): CoachStyle? = entries.firstOrNull { it.wireId.equals(raw, ignoreCase = true) }
    }
}

/**
 * The five driving-pattern indicators, with the web lo/hi threshold bounds verbatim
 * (`{ lo: 20, hi: 40 }` …). [value] extracts the matching percentage from a [CoachPatterns]; the label is an
 * i18n key resolved at the Compose boundary, so the kind carries no English literal itself.
 */
enum class CoachPatternKind(
    val lo: Double,
    val hi: Double,
    val value: (CoachPatterns) -> Double,
) {
    HardAccel(lo = 20.0, hi = 40.0, value = { it.hardAccelPct }),
    HardBrake(lo = 15.0, hi = 30.0, value = { it.hardBrakePct }),
    Highway(lo = 50.0, hi = 70.0, value = { it.highwayPct }),
    ShortTrips(lo = 30.0, hi = 50.0, value = { it.shortTripPct }),
    ColdStarts(lo = 15.0, hi = 30.0, value = { it.coldStartPct }),
}

// ── Wire models (the native mirror of web/src/types/driving.ts; tolerant defaults so a partial body decodes) ──

/**
 * The five pattern percentages — the native mirror of the web `CoachPatterns`. Every field defaults to 0 so a
 * still-loading or partial payload decodes (a decoder configured with `ignoreUnknownKeys` ignores any extra
 * columns the API sends).
 */
@Serializable
data class CoachPatterns(
    @SerialName("hard_accel_pct") val hardAccelPct: Double = 0.0,
    @SerialName("hard_brake_pct") val hardBrakePct: Double = 0.0,
    @SerialName("highway_pct") val highwayPct: Double = 0.0,
    @SerialName("short_trip_pct") val shortTripPct: Double = 0.0,
    @SerialName("cold_start_pct") val coldStartPct: Double = 0.0,
)

/** One week of the score trend — the native mirror of the web `CoachWeeklyTrend`. */
@Serializable
data class CoachWeeklyTrend(
    @SerialName("week") val week: String = "",
    @SerialName("score") val score: Double = 0.0,
    @SerialName("efficiency") val efficiency: Double = 0.0,
    @SerialName("drives") val drives: Double = 0.0,
)

/** One personalized recommendation — the native mirror of the web `CoachRecommendation`. */
@Serializable
data class CoachRecommendation(
    @SerialName("category") val category: String = "",
    @SerialName("impact") val impact: String = "",
    @SerialName("tip") val tip: String = "",
)

/** One scored drive — the native mirror of the web `CoachDriveScore` the per-drive table renders. */
@Serializable
data class CoachDriveScore(
    @SerialName("drive_id") val driveId: Long = 0L,
    @SerialName("date") val date: String = "",
    @SerialName("score") val score: Double = 0.0,
    @SerialName("style") val style: String = "",
    @SerialName("efficiency") val efficiency: Double = 0.0,
    @SerialName("distance") val distance: Double = 0.0,
)

/**
 * The driving-coach payload this section renders — the native mirror of the web `DrivingCoachData`
 * (web/src/types/driving.ts), the prop the Driving-Dynamics page passes down. Every field defaults so a
 * still-loading or empty payload decodes and projects without error; [EMPTY] is the all-defaults value the
 * composable renders for the Empty phase (zeros + the internal empty states), mirroring how the web component
 * always renders its body even when `coachData` is undefined.
 */
@Serializable
data class DrivingCoachData(
    @SerialName("overall_score") val overallScore: Double = 0.0,
    @SerialName("efficiency_wh_km") val efficiencyWhKm: Double = 0.0,
    @SerialName("best_efficiency_wh_km") val bestEfficiencyWhKm: Double = 0.0,
    @SerialName("total_drives_analyzed") val totalDrivesAnalyzed: Double = 0.0,
    @SerialName("style_breakdown") val styleBreakdown: Map<String, Double> = emptyMap(),
    @SerialName("patterns") val patterns: CoachPatterns = CoachPatterns(),
    @SerialName("weekly_trend") val weeklyTrend: List<CoachWeeklyTrend> = emptyList(),
    @SerialName("recommendations") val recommendations: List<CoachRecommendation> = emptyList(),
    @SerialName("per_drive_scores") val perDriveScores: List<CoachDriveScore> = emptyList(),
) {
    companion object {
        /** The no-data coach — rendered for the Empty phase so the section is never a blank box. */
        val EMPTY: DrivingCoachData = DrivingCoachData()
    }
}

// ── Render-ready projection models (pure data; no Compose types) ────────────────────────────────────────────

/** One proportional segment of the style-breakdown bar — its [style] tint and relative [weight] (percent). */
data class StyleSegment(
    val style: CoachStyle,
    val weight: Float,
)

/** One legend row of the style breakdown — the [style] (dot + capitalized label) and its formatted [countText]. */
data class StyleLegendRow(
    val style: CoachStyle,
    val countText: String,
)

/** One pattern bar — the [kind] (label resolved at render), the bar [valuePercent], its [tone], and [valueText]. */
data class PatternRow(
    val kind: CoachPatternKind,
    val valuePercent: Double,
    val tone: CoachTone,
    val valueText: String,
)

/** One recommendation row — the raw impact [impactLabel] + its [tone] chip and the [tip] body (web parity). */
data class CoachRecommendationRow(
    val impactLabel: String,
    val tone: CoachTone,
    val tip: String,
)

/**
 * One projected per-drive row — the formatted cells the table renders plus the raw comparables it sorts on
 * (the web `DataTable` sorts the underlying `CoachDriveScore` fields, not the formatted strings). [styleLabel]
 * is the raw category (web per-drive badge `{r.style}`); [scoreText] is the web `{r.score}` raw number.
 */
data class CoachDriveRow(
    val driveId: Long,
    val dateText: String,
    val scoreText: String,
    val scoreTone: CoachTone,
    val styleLabel: String,
    val styleTone: CoachTone,
    val efficiencyText: String,
    val distanceText: String,
    val score: Double,
    val efficiency: Double,
    val distance: Double,
    val styleId: String,
    val sortDate: Long?,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property scoreValue the clamped overall score the gauge sweeps (web `Math.max(0, Math.min(value, max))`).
 * @property scoreDecimals the gauge fraction digits (web `Number.isInteger(clamped) ? 0 : globalPrecision`).
 * @property scoreTone the gauge / score color band (web `>= 75 green : >= 50 amber : red`).
 * @property drivesAnalyzedCountText the formatted analyzed-drive count fed to the "{count} drives analyzed" line.
 * @property hasStyleData whether the style breakdown has data (web `total_drives_analyzed > 0`).
 * @property styleSegments the proportional bar segments (only the non-zero shares, web `if (pct <= 0) null`).
 * @property styleLegend the three-row legend (always all styles, web fixed-array map), each with its count.
 * @property avgEfficiencyText the "Avg Efficiency" stat value (web `${fmtNumber(efficiency_wh_km)} Wh/km`).
 * @property bestEfficiencyText the "Best Efficiency" stat value (web `${fmtNumber(best_efficiency_wh_km)} Wh/km`).
 * @property hasWeeklyTrend whether the trend chart renders (web `weekly_trend.length > 1`).
 * @property weekLabels the trend x-axis week labels; @property weekScores the trend y values (0–100 score).
 * @property patterns the five pattern bars.
 * @property hasRecommendations whether the recommendations list renders (web `recommendations.length > 0`).
 * @property recommendations the impact-colored recommendation rows.
 * @property hasPerDriveScores whether the per-drive table renders (web `per_drive_scores.length > 0`).
 * @property driveRows the projected per-drive rows (source order; the view sorts + paginates them).
 */
data class DrivingCoachDisplay(
    val scoreValue: Double,
    val scoreDecimals: Int,
    val scoreTone: CoachTone,
    val drivesAnalyzedCountText: String,
    val hasStyleData: Boolean,
    val styleSegments: List<StyleSegment>,
    val styleLegend: List<StyleLegendRow>,
    val avgEfficiencyText: String,
    val bestEfficiencyText: String,
    val hasWeeklyTrend: Boolean,
    val weekLabels: List<String>,
    val weekScores: List<Double>,
    val patterns: List<PatternRow>,
    val hasRecommendations: Boolean,
    val recommendations: List<CoachRecommendationRow>,
    val hasPerDriveScores: Boolean,
    val driveRows: List<CoachDriveRow>,
)

/**
 * Pure projection from a [DrivingCoachData] to its render-ready [DrivingCoachDisplay] — a 1:1 port of the
 * derivations the web component performs before returning JSX. Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate. [locale] feeds the locale-grouped number/date formatting (web global
 * locale); [zone] resolves zoned per-drive timestamps to a local calendar day.
 */
object DrivingCoachProjection {
    /** Select the render-ready view for [data] in the user's [locale] / [zone]. */
    fun project(
        data: DrivingCoachData,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): DrivingCoachDisplay {
        val clampedScore = clampScore(safe(data.overallScore))
        val totalDrives = safe(data.totalDrivesAnalyzed)
        return DrivingCoachDisplay(
            scoreValue = clampedScore,
            scoreDecimals = if (isWhole(clampedScore)) 0 else DEFAULT_PRECISION,
            scoreTone = scoreTone(clampedScore),
            drivesAnalyzedCountText = fmtInt(totalDrives, locale),
            hasStyleData = totalDrives > 0.0,
            styleSegments = styleSegments(data.styleBreakdown, totalDrives),
            styleLegend = styleLegend(data.styleBreakdown),
            avgEfficiencyText = "${fmtNumber(data.efficiencyWhKm, DEFAULT_PRECISION, locale)} $UNIT_EFFICIENCY",
            bestEfficiencyText = "${fmtNumber(data.bestEfficiencyWhKm, DEFAULT_PRECISION, locale)} $UNIT_EFFICIENCY",
            hasWeeklyTrend = data.weeklyTrend.size > WEEKLY_TREND_MIN_POINTS,
            weekLabels = data.weeklyTrend.map { it.week },
            weekScores = data.weeklyTrend.map { safe(it.score) },
            patterns = patternRows(data.patterns, locale),
            hasRecommendations = data.recommendations.isNotEmpty(),
            recommendations = data.recommendations.map(::recommendationRow),
            hasPerDriveScores = data.perDriveScores.isNotEmpty(),
            driveRows = data.perDriveScores.map { driveRow(it, locale, zone) },
        )
    }

    /** The score color band — web `overall_score >= 75 ? green : >= 50 ? amber : red`. */
    fun scoreTone(score: Double): CoachTone {
        val value = safe(score)
        return when {
            value >= SCORE_GOOD_MIN -> CoachTone.Success
            value >= SCORE_WARN_MIN -> CoachTone.Warning
            else -> CoachTone.Danger
        }
    }

    /** The per-drive Score badge band — same thresholds as the gauge (web `r.score >= 75 ? success : …`). */
    fun driveScoreTone(score: Double): CoachTone = scoreTone(score)

    /** The per-drive Style badge tone — web `r.style === 'efficient' ? success : 'moderate' ? warning : danger`. */
    fun styleTone(style: String): CoachTone = CoachStyle.fromWire(style)?.tone ?: CoachTone.Danger

    /**
     * The recommendation impact tone — the web DrivingCoachSection mapping `impact === 'high' ? danger :
     * 'medium' ? warning : success` (note this differs from the DrivingCoachWidget's `impactBadgeMap`; this
     * surface follows its own source).
     */
    fun impactTone(impact: String): CoachTone =
        when (impact.lowercase(Locale.ROOT)) {
            "high" -> CoachTone.Danger
            "medium" -> CoachTone.Warning
            else -> CoachTone.Success
        }

    /** The pattern tone — web `value <= lo ? emerald : value <= hi ? amber : red`. */
    fun patternTone(
        value: Double,
        kind: CoachPatternKind,
    ): CoachTone {
        val v = safe(value)
        return when {
            v <= kind.lo -> CoachTone.Success
            v <= kind.hi -> CoachTone.Warning
            else -> CoachTone.Danger
        }
    }

    /**
     * Orders [rows] for the sortable per-drive table. [key] is one of the `SORT_KEY_*` column keys (or `null`
     * for the unsorted source order, the web `DataTable` default); [ascending] is the click direction. Numeric
     * columns compare on the raw value, the date column on its parsed epoch day, the style column on its raw
     * category. A `null` key (or an unknown one) returns the source order unchanged.
     */
    fun sortDriveRows(
        rows: List<CoachDriveRow>,
        key: String?,
        ascending: Boolean,
    ): List<CoachDriveRow> {
        val comparator: Comparator<CoachDriveRow> =
            when (key) {
                SORT_KEY_DATE -> compareBy { it.sortDate ?: Long.MIN_VALUE }
                SORT_KEY_SCORE -> compareBy { it.score }
                SORT_KEY_STYLE -> compareBy { it.styleId }
                SORT_KEY_EFFICIENCY -> compareBy { it.efficiency }
                SORT_KEY_DISTANCE -> compareBy { it.distance }
                else -> return rows
            }
        val sorted = rows.sortedWith(comparator)
        return if (ascending) sorted else sorted.asReversed()
    }

    /**
     * Locale-grouped fixed-precision formatting — the native mirror of the web `fmtNumber` (a
     * `Number.toLocaleString` with `minimumFractionDigits == maximumFractionDigits == decimals`). A non-finite
     * input folds to 0 first (web `safeNumber`), so a malformed metric renders "0.00" rather than "NaN".
     */
    fun fmtNumber(
        value: Double,
        decimals: Int = DEFAULT_PRECISION,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safeDecimals = decimals.coerceIn(0, MAX_FRACTION_DIGITS)
        return String.format(locale, "%,.${safeDecimals}f", safe(value))
    }

    /** Locale-grouped integer formatting — the web `fmtInt(v)` (`fmtNumber(v, 0)`). */
    fun fmtInt(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = fmtNumber(value, 0, locale)

    /**
     * The raw-number rendering the web uses for the per-drive score badge and the style-breakdown counts
     * (`{r.score}` / `{count}` — plain interpolation, not `fmtNumber`, so no grouping). A whole value renders
     * without a fraction (`82`), a fractional one keeps its decimals (`82.5`); a non-finite value folds to "0".
     */
    fun plainNumber(value: Double): String {
        val v = safe(value)
        return if (isWhole(v)) v.toLong().toString() else v.toString()
    }

    /**
     * Tolerant date -> localized short month/day formatter — the native analogue of the web `formatDateShort`
     * (`toLocaleDateString` with `{ month: 'short', day: 'numeric' }`, e.g. `Apr 4`). A blank or unparseable
     * input yields [DRIVING_COACH_EM_DASH], exactly like the web helper's invalid-date guard. The decode chain
     * tolerates a bare `YYYY-MM-DD` as well as a full ISO timestamp (web `new Date(iso)` accepts both).
     */
    fun formatDateShort(
        raw: String,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val date = parseDate(raw, zone) ?: return DRIVING_COACH_EM_DASH
        return DateTimeFormatter.ofPattern(SHORT_DATE_PATTERN, locale).format(date)
    }

    // The proportional, non-zero bar segments — web maps the fixed style order and drops `pct <= 0` shares.
    private fun styleSegments(
        breakdown: Map<String, Double>,
        total: Double,
    ): List<StyleSegment> {
        if (total <= 0.0) return emptyList()
        return CoachStyle.entries.mapNotNull { style ->
            val pct = (safe(breakdown[style.wireId] ?: 0.0) / total) * PERCENT_FULL
            if (pct <= 0.0) null else StyleSegment(style, pct.toFloat())
        }
    }

    // The three-row legend — always all styles (web fixed-array map), each with its raw count.
    private fun styleLegend(breakdown: Map<String, Double>): List<StyleLegendRow> =
        CoachStyle.entries.map { style ->
            StyleLegendRow(style = style, countText = plainNumber(safe(breakdown[style.wireId] ?: 0.0)))
        }

    private fun patternRows(
        patterns: CoachPatterns,
        locale: Locale,
    ): List<PatternRow> =
        CoachPatternKind.entries.map { kind ->
            val value = safe(kind.value(patterns))
            PatternRow(
                kind = kind,
                valuePercent = value,
                tone = patternTone(value, kind),
                valueText = "${fmtNumber(value, DEFAULT_PRECISION, locale)}%",
            )
        }

    private fun recommendationRow(rec: CoachRecommendation): CoachRecommendationRow =
        CoachRecommendationRow(impactLabel = rec.impact, tone = impactTone(rec.impact), tip = rec.tip)

    private fun driveRow(
        drive: CoachDriveScore,
        locale: Locale,
        zone: ZoneId,
    ): CoachDriveRow =
        CoachDriveRow(
            driveId = drive.driveId,
            dateText = formatDateShort(drive.date, locale, zone),
            scoreText = plainNumber(drive.score),
            scoreTone = driveScoreTone(drive.score),
            styleLabel = drive.style,
            styleTone = styleTone(drive.style),
            efficiencyText = fmtNumber(drive.efficiency, DEFAULT_PRECISION, locale),
            distanceText = "${fmtNumber(drive.distance, DEFAULT_PRECISION, locale)} $UNIT_DISTANCE",
            score = safe(drive.score),
            efficiency = safe(drive.efficiency),
            distance = safe(drive.distance),
            styleId = drive.style,
            sortDate = parseDate(drive.date, zone)?.toEpochDay(),
        )

    // web safeNumber: a non-finite value (NaN / ±Infinity) is treated as 0 before formatting.
    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

    private fun isWhole(value: Double): Boolean = value.isFinite() && value % 1.0 == 0.0

    private fun clampScore(value: Double): Double = value.coerceIn(0.0, SCORE_MAX)

    private const val SHORT_DATE_PATTERN: String = "MMM d"

    // Tolerant decode chain (shared with the sibling DrivingSection port): a date-only `YYYY-MM-DD`, then an
    // offset date-time resolved to [zone], then a zoneless local date-time, then an RFC-3339 instant resolved
    // in [zone]. The first that parses wins; none parsing falls through to the em-dash guard.
    private val dateParsers: List<(String, ZoneId) -> LocalDate?> =
        listOf(
            { raw, _ -> tryParseDate { LocalDate.parse(raw) } },
            { raw, zone -> tryParseDate { OffsetDateTime.parse(raw).atZoneSameInstant(zone).toLocalDate() } },
            { raw, _ -> tryParseDate { LocalDateTime.parse(raw).toLocalDate() } },
            { raw, zone -> tryParseDate { Instant.parse(raw).atZone(zone).toLocalDate() } },
        )

    private fun parseDate(
        raw: String,
        zone: ZoneId,
    ): LocalDate? = if (raw.isBlank()) null else dateParsers.firstNotNullOfOrNull { it(raw, zone) }

    private fun tryParseDate(block: () -> LocalDate): LocalDate? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the score,
 * efficiency, drive count, recommendation text, or per-drive dates — so a diagnostics line can never leak a
 * user's driving habits.
 */
object DrivingCoachSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "DrivingCoachSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
