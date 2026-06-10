// File named after its primary @Composable; the co-located enum is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight

/** Display size for [ScoreBadge]. */
enum class ScoreBadgeSize { Sm, Md, Lg }

/**
 * Letter-grade badge (A+ / A / B / C / D / F / —) — the Android counterpart of the web
 * `ScoreBadge`. This overload takes a pre-computed [grade]; color comes from the shared
 * [gradeColor] palette so any badge with the same letter matches everywhere.
 */
@Composable
fun ScoreBadge(
    grade: ScoreGrade,
    modifier: Modifier = Modifier,
    size: ScoreBadgeSize = ScoreBadgeSize.Md,
    contentDescription: String? = null,
) {
    val description = contentDescription ?: "Score ${grade.label}"
    Text(
        text = grade.label,
        modifier = modifier.clearAndSetSemantics { this.contentDescription = description },
        style = scoreTextStyle(size),
        color = gradeColor(grade),
    )
}

/**
 * Numeric overload: maps [score] to a letter via [numericToGrade] (custom [thresholds] allowed),
 * then renders the grade badge.
 */
@Composable
fun ScoreBadge(
    score: Double?,
    modifier: Modifier = Modifier,
    size: ScoreBadgeSize = ScoreBadgeSize.Md,
    thresholds: List<ScoreThreshold> = DEFAULT_SCORE_THRESHOLDS,
    contentDescription: String? = null,
) {
    ScoreBadge(
        grade = numericToGrade(score, thresholds),
        modifier = modifier,
        size = size,
        contentDescription = contentDescription,
    )
}

@Composable
private fun scoreTextStyle(size: ScoreBadgeSize): TextStyle {
    val base =
        when (size) {
            ScoreBadgeSize.Sm -> MaterialTheme.typography.labelMedium
            ScoreBadgeSize.Md -> MaterialTheme.typography.titleMedium
            ScoreBadgeSize.Lg -> MaterialTheme.typography.headlineSmall
        }
    return base.copy(fontWeight = FontWeight.Bold)
}
