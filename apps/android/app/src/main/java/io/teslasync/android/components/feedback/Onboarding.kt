// File holds the onboarding family; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/** One onboarding/tour step (title + description + optional leading glyph). */
data class OnboardingStep(
    val title: String,
    val description: String,
    val icon: ImageVector? = null,
)

/**
 * Multi-step onboarding wizard mirroring web `components/feedback/OnboardingWizard`. Controlled via
 * [currentIndex] + [onIndexChange]; renders the active [OnboardingStep] inside a [Modal] with a
 * progress bar, a "Step N of M" counter, Back / Next (or Done on the last step), and optional Skip.
 * Step navigation is clamped via the shared step logic so it can never run off the ends.
 */
@Composable
fun OnboardingWizard(
    steps: List<OnboardingStep>,
    currentIndex: Int,
    onIndexChange: (Int) -> Unit,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier,
    onSkip: (() -> Unit)? = null,
) {
    if (steps.isEmpty()) return
    val index = clampStepIndex(currentIndex, steps.size)
    val step = steps[index]
    Modal(onDismissRequest = onSkip ?: onFinish, modifier = modifier, title = step.title) {
        if (step.icon != null) {
            Icon(step.icon, contentDescription = null, size = IconSize.Xl, tint = TeslaTokens.status.info)
            Spacer(Modifier.height(Spacing.sm))
        }
        BodyText(step.description)
        Spacer(Modifier.height(Spacing.md))
        LinearProgressIndicator(progress = { stepProgress(index, steps.size) }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(Spacing.xs))
        Caption("Step ${index + 1} of ${steps.size}")
        Spacer(Modifier.height(Spacing.lg))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onSkip != null) {
                Button("Skip", onClick = onSkip, variant = ButtonVariant.Ghost)
            }
            if (!isFirstStep(index)) {
                Button("Back", onClick = { onIndexChange(prevStepIndex(index)) }, variant = ButtonVariant.Secondary)
            }
            if (isLastStep(index, steps.size)) {
                Button("Done", onClick = onFinish, variant = ButtonVariant.Primary)
            } else {
                Button("Next", onClick = { onIndexChange(nextStepIndex(index, steps.size)) }, variant = ButtonVariant.Primary)
            }
        }
    }
}

/**
 * Spotlight-style product tour mirroring web `components/feedback/TourOverlay`. Dims the screen and
 * floats the current step's coach-mark card (Compose can't anchor to arbitrary node bounds without
 * layout coordinates, so the card is centered). Controlled via [currentIndex] + [onIndexChange];
 * the last step's primary action calls [onFinish].
 */
@Composable
fun TourOverlay(
    steps: List<OnboardingStep>,
    currentIndex: Int,
    onIndexChange: (Int) -> Unit,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (steps.isEmpty()) return
    val index = clampStepIndex(currentIndex, steps.size)
    val step = steps[index]
    Box(
        modifier = modifier.fillMaxSize().background(Color.Black.copy(alpha = SCRIM_ALPHA)).padding(Spacing.lg),
        contentAlignment = Alignment.Center,
    ) {
        GlassPanel {
            PanelTitle(step.title)
            Spacer(Modifier.height(Spacing.sm))
            BodyText(step.description)
            Spacer(Modifier.height(Spacing.md))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Caption("${index + 1} / ${steps.size}")
                if (isLastStep(index, steps.size)) {
                    Button("Done", onClick = onFinish, variant = ButtonVariant.Primary)
                } else {
                    Button("Next", onClick = { onIndexChange(nextStepIndex(index, steps.size)) }, variant = ButtonVariant.Primary)
                }
            }
        }
    }
}

private const val SCRIM_ALPHA = 0.6f
