package io.teslasync.android.components.datadisplay

/*
 * Generic A–F score-scale helpers — the Android counterpart of the web lib/scoreScale. Pure,
 * domain-free functions shared by ScoreBadge, DriveScore, and any letter-grade surface so a
 * given letter has the same meaning (and, via DataDisplayColors, the same color) everywhere.
 */

/** Letter grade. [None] is the "no data" sentinel rendered as an em dash. */
enum class ScoreGrade(
    val label: String,
    /** Numeric weight for averaging across many items; `null` for [None]. */
    val numeric: Double?,
) {
    APlus("A+", 4.5),
    A("A", 4.0),
    B("B", 3.0),
    C("C", 2.0),
    D("D", 1.0),
    F("F", 0.5),
    None("\u2014", null),
}

/** One inclusive lower-bound threshold mapping a score onto a [ScoreGrade]. */
data class ScoreThreshold(
    val min: Double,
    val grade: ScoreGrade,
)

/** Default 0–100 thresholds (lower bound inclusive), matching the web scale. */
val DEFAULT_SCORE_THRESHOLDS: List<ScoreThreshold> =
    listOf(
        ScoreThreshold(90.0, ScoreGrade.APlus),
        ScoreThreshold(80.0, ScoreGrade.A),
        ScoreThreshold(65.0, ScoreGrade.B),
        ScoreThreshold(50.0, ScoreGrade.C),
        ScoreThreshold(35.0, ScoreGrade.D),
        ScoreThreshold(0.0, ScoreGrade.F),
    )

/**
 * Maps a numeric [score] to a letter grade. Non-finite / null input yields [ScoreGrade.None].
 * Callers may pass custom [thresholds] (e.g. inverse Wh/km for efficiency).
 */
fun numericToGrade(
    score: Double?,
    thresholds: List<ScoreThreshold> = DEFAULT_SCORE_THRESHOLDS,
): ScoreGrade {
    if (score == null || score.isNaN() || score.isInfinite()) return ScoreGrade.None
    // Highest-first so the first match wins regardless of input ordering.
    return thresholds.sortedByDescending { it.min }.firstOrNull { score >= it.min }?.grade ?: ScoreGrade.F
}

/**
 * Averages a list of grade numerics (skipping null / non-finite) and maps the mean back to a
 * letter grade. Returns [ScoreGrade.None] when no graded inputs are present.
 */
fun averageGrade(values: List<Double?>): ScoreGrade {
    var sum = 0.0
    var count = 0
    for (value in values) {
        if (value != null && value.isFinite()) {
            sum += value
            count++
        }
    }
    if (count == 0) return ScoreGrade.None
    val avg = sum / count
    return when {
        avg >= 4.25 -> ScoreGrade.APlus
        avg >= 3.5 -> ScoreGrade.A
        avg >= 2.5 -> ScoreGrade.B
        avg >= 1.5 -> ScoreGrade.C
        avg >= 0.75 -> ScoreGrade.D
        else -> ScoreGrade.F
    }
}
