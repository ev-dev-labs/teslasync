// The native Jetpack Compose + Material 3 ScoreBadge shared surface — a parity port of
// web/src/components/data-display/ScoreBadge.tsx (plus the shared scale at web/src/lib/scoreScale.ts). The
// web surface is a compact, inline letter-grade pill (A+ / A / B / C / D / F / —) used on history rows
// (Drives, Charging, Trips) and in section headers ("Avg score: B"): the letter IS the badge — no extra
// "SCORE" sub-label — tinted by the shared grade palette so any badge with the same letter has the same
// colour everywhere. It is pure presentational — the parent owns the score and the component's only hook is
// useTranslation.
//
// Every derivation flows through the pure model in ScoreBadgeModel.kt (numericToGrade / gradeInfo →
// [ScoreBadgeProjection]); this composable is a thin render layer that resolves the localized accessible
// label (P1/S10), maps the projected tone onto the per-theme TeslaTokens palette, picks the size's type
// style from the generated ramp (P1/S9), draws the single grade letter, and fires the one-shot PII-safe
// `view.opened` diagnostic (P1/S11). It performs NO HTTP. Like the web `aria-label`, the readout is
// collapsed into a single accessibility node carrying the spoken "Score {grade}" label (the visible letter
// is not separately announced).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ScoreBadge) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.scorebadge

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** OpenType "tabular figures" — the native analogue of the web `tabular-nums` so the badge never jitters. */
private const val TABULAR_FIGURES: String = "tnum"

/**
 * Stateful entry point — the faithful port of `<ScoreBadge score={…} />`. Records the one-shot `view.opened`
 * diagnostic, maps [score] to a grade via [thresholds] (the web `numericToGrade`), and renders the tinted
 * letter. Always renders (the web component never returns `null`): a `null` / non-finite [score] falls
 * through to the muted "—" grade. Performs no HTTP; [logger] defaults to the process logger.
 *
 * @param score the 0–100 numeric score (web `score`); `null` / non-finite → the "—" grade.
 * @param size the display size (web `size`, default [ScoreBadgeSize.Md]).
 * @param thresholds an optional non-default scale (web `thresholds`), e.g. inverse Wh/km for efficiency.
 * @param ariaLabel overrides the auto-generated accessible label (web `ariaLabel`).
 */
@Composable
fun ScoreBadge(
    score: Double?,
    modifier: Modifier = Modifier,
    size: ScoreBadgeSize = ScoreBadgeSize.Md,
    thresholds: List<ScoreThreshold> = DEFAULT_SCORE_THRESHOLDS,
    ariaLabel: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ScoreBadgeDiagnostics.recordViewOpened(logger) }
    ScoreBadgeContent(
        projection = remember(score, thresholds) { projectScore(score, thresholds) },
        modifier = modifier,
        size = size,
        ariaLabel = ariaLabel,
    )
}

/**
 * Stateful entry point — the faithful port of `<ScoreBadge grade={…} />`, for callers that already mapped
 * score → grade. Records the one-shot `view.opened` diagnostic and renders the tinted letter. Performs no
 * HTTP; [logger] defaults to the process logger.
 *
 * @param grade the pre-computed letter grade (web `grade`).
 * @param size the display size (web `size`, default [ScoreBadgeSize.Md]).
 * @param ariaLabel overrides the auto-generated accessible label (web `ariaLabel`).
 */
@Composable
fun ScoreBadge(
    grade: ScoreGrade,
    modifier: Modifier = Modifier,
    size: ScoreBadgeSize = ScoreBadgeSize.Md,
    ariaLabel: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ScoreBadgeDiagnostics.recordViewOpened(logger) }
    ScoreBadgeContent(
        projection = remember(grade) { projectGrade(grade) },
        modifier = modifier,
        size = size,
        ariaLabel = ariaLabel,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Draws the [ScoreBadgeProjection.visibleLabel]
 * letter, tinted by the projected tone and sized by [size], collapsing the readout into one accessibility
 * node that speaks the localized "Score {grade}" label (web `aria-label` on the outer span, overridable by
 * [ariaLabel]). Carries no diagnostics, so a parent rendering many badges in a list never emits per-item
 * events.
 */
@Composable
fun ScoreBadgeContent(
    projection: ScoreBadgeProjection,
    modifier: Modifier = Modifier,
    size: ScoreBadgeSize = ScoreBadgeSize.Md,
    ariaLabel: String? = null,
) {
    val description = scoreBadgeContentDescription(projection.grade, ariaLabel)
    Text(
        text = projection.visibleLabel,
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        style = scoreTextStyle(size).copy(fontWeight = FontWeight.Bold, fontFeatureSettings = TABULAR_FIGURES),
        color = scoreToneColor(projection.tone),
    )
}

/**
 * Resolve the accessible label — the native mirror of the web `aria-label`
 * (`ariaLabel ?? t('score.aria', 'Score {{grade}}', { grade })`). The `score.aria` key resolves through the
 * P1/S10 catalog; no English literal lives here.
 */
@Composable
private fun scoreBadgeContentDescription(
    grade: ScoreGrade,
    override: String?,
): String = override ?: stringResource(R.string.translation_score_aria, grade.label)

/**
 * Map the projected [ScoreTone] onto a per-theme colour — the native mirror of the web `GRADE_PALETTE`
 * hexes, drawn from the TeslaTokens status palette (and the Material scheme for the muted sentinel) so
 * light / dark / high-contrast all stay correct.
 */
@Composable
@ReadOnlyComposable
private fun scoreToneColor(tone: ScoreTone): Color =
    when (tone) {
        ScoreTone.Success -> TeslaTokens.status.success
        ScoreTone.Info -> TeslaTokens.status.info
        ScoreTone.Warning -> TeslaTokens.status.warning
        ScoreTone.Danger -> TeslaTokens.status.danger
        ScoreTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * The bold type style for a [size] — the native mirror of the web `SIZE_CLASS` (`text-xs` / `text-xl` /
 * `text-3xl`), mapped onto the generated (P1/S9) ramp: [ScoreBadgeSize.Sm] → `bodySmall` (≈12sp),
 * [ScoreBadgeSize.Md] → `headlineSmall` (≈18sp), [ScoreBadgeSize.Lg] → `displaySmall` (≈30sp). The bold
 * weight + tabular figures are applied by the caller.
 */
@Composable
@ReadOnlyComposable
private fun scoreTextStyle(size: ScoreBadgeSize): TextStyle =
    when (size) {
        ScoreBadgeSize.Sm -> MaterialTheme.typography.bodySmall
        ScoreBadgeSize.Md -> MaterialTheme.typography.headlineSmall
        ScoreBadgeSize.Lg -> MaterialTheme.typography.displaySmall
    }

// ── Previews (tooling-only; sample scores are never shipped UI) ─────────────────────────────────────────

private val PREVIEW_GRADES: List<ScoreGrade> =
    listOf(
        ScoreGrade.APlus,
        ScoreGrade.A,
        ScoreGrade.B,
        ScoreGrade.C,
        ScoreGrade.D,
        ScoreGrade.F,
        ScoreGrade.Dash,
    )

@Preview(name = "Grades A+ → F → — (md)", showBackground = true)
@Composable
private fun ScoreBadgeGradesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
            PREVIEW_GRADES.forEach { grade ->
                ScoreBadgeContent(projection = projectGrade(grade))
            }
        }
    }
}

@Preview(name = "Sizes sm / md / lg", showBackground = true)
@Composable
private fun ScoreBadgeSizesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
            ScoreBadgeContent(projection = projectGrade(ScoreGrade.B), size = ScoreBadgeSize.Sm)
            ScoreBadgeContent(projection = projectGrade(ScoreGrade.B), size = ScoreBadgeSize.Md)
            ScoreBadgeContent(projection = projectGrade(ScoreGrade.B), size = ScoreBadgeSize.Lg)
        }
    }
}

@Preview(name = "From numeric scores", showBackground = true)
@Composable
private fun ScoreBadgeScorePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                ScoreBadgeContent(projection = projectScore(95.0))
                ScoreBadgeContent(projection = projectScore(82.0))
                ScoreBadgeContent(projection = projectScore(70.0))
                ScoreBadgeContent(projection = projectScore(55.0))
                ScoreBadgeContent(projection = projectScore(40.0))
                ScoreBadgeContent(projection = projectScore(10.0))
                ScoreBadgeContent(projection = projectScore(null))
            }
        }
    }
}

@Preview(name = "Dark — section header (lg)", showBackground = true)
@Composable
private fun ScoreBadgeDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        ScoreBadgeContent(projection = projectGrade(ScoreGrade.APlus), size = ScoreBadgeSize.Lg)
    }
}
