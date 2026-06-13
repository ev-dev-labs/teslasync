// The native Jetpack Compose + Material 3 OnboardingWizard shared surface — a parity port of
// web/src/components/feedback/OnboardingWizard.tsx. The web surface is a self-contained first-run intro modal: a
// glass card floated over a dimming backdrop with a close affordance, a row of progress dots (the reached ones
// tinted, the active one widened + emphasized), a tinted hero icon tile, the active step's title + description,
// and a two-button footer — "Skip" on the left and a prominent "Next" (or "Get Started" on the last step) on the
// right. It walks four ordered steps (welcome → connect → configure → ready) and collapses once the user finishes
// or skips.
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the four
// ordered steps crossed with the progress-dot reached/active branches and the Next-vs-Get-Started advance branch —
// without ever hiding a region. It performs NO HTTP and binds NO state holder (the web component fetches nothing;
// see OnboardingWizardModel.kt for the honesty rationale and why the generic loading/error/stale/offline states do
// not apply to a static first-run intro). The chrome is composed from the shared ui atoms (Surface dialog, IconBox,
// Icon, IconButton, Button) + the feedback glyph set, so the per-step accent stays correct across light / dark /
// high-contrast themes; every string it renders resolves through the i18n catalog (P1/S10) via the `tour.*` /
// `onboarding.*` keys (the web source hard-codes its copy, so the closest existing keys are bound — the mapping is
// documented in the surface log). The hero title + body are exposed to TalkBack as one merged announcement, the
// dot row reads as a single "N / M" counter, the close button carries its own label, and a one-shot PII-safe
// `view.opened` diagnostic (P1/S11) fires on first composition. All step derivation flows through the pure
// classifier in OnboardingWizardModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/OnboardingWizard) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.onboardingwizard

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Web card geometry: `max-w-md` glass card with a hairline border, on a dimming backdrop (the Dialog scrim).
private const val MODAL_WIDTH_FRACTION = 0.94f
private val MODAL_MAX_WIDTH: Dp = 440.dp
private val MODAL_BORDER_WIDTH: Dp = 1.dp
private const val MODAL_BORDER_ALPHA = 0.08f

// Web step dots: 8 px upcoming, 24 px active, reached ones tinted to the brand accent.
private val DOT_HEIGHT: Dp = 6.dp
private val DOT_WIDTH: Dp = 8.dp
private val DOT_ACTIVE_WIDTH: Dp = 24.dp
private const val DOT_UPCOMING_ALPHA = 0.25f

/**
 * Stateful entry point — the faithful port of the web `OnboardingWizard`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, walks the four ordered steps, and collapses the modal once the user
 * finishes the last step or skips/closes — the native analogue of the web `visible` flag (the host decides whether
 * to mount the wizard at all, mirroring the web `localStorage` "onboarded" gate). Performs no HTTP and binds no
 * state holder; the intro content is static. [logger] defaults to the process logger.
 *
 * @param onComplete invoked when the user advances past the final step (web "Get Started").
 * @param onSkip invoked when the user dismisses the intro early (web "Skip" / close / backdrop tap).
 */
@Composable
fun OnboardingWizard(
    modifier: Modifier = Modifier,
    onComplete: () -> Unit = {},
    onSkip: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    var stepIndex by rememberSaveable { mutableStateOf(0) }
    var dismissed by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { OnboardingWizardDiagnostics.recordViewOpened(logger) }
    if (dismissed) return
    OnboardingWizardContent(
        stepIndex = stepIndex,
        onAdvance = {
            if (isLastStep(stepIndex)) {
                dismissed = true
                onComplete()
            } else {
                stepIndex = nextStepIndex(stepIndex)
            }
        },
        onDismiss = {
            dismissed = true
            onSkip()
        },
        modifier = modifier,
    )
}

/**
 * Stateless dialog wrapper — floats the [OnboardingWizardCard] over the platform Dialog scrim (the web backdrop).
 * Outside-tap and system-back both route to [onDismiss], reproducing the web backdrop-click / Escape close.
 */
@Composable
fun OnboardingWizardContent(
    stepIndex: Int,
    onAdvance: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties =
            DialogProperties(
                dismissOnClickOutside = true,
                dismissOnBackPress = true,
                usePlatformDefaultWidth = false,
            ),
    ) {
        OnboardingWizardCard(
            stepIndex = stepIndex,
            onAdvance = onAdvance,
            onDismiss = onDismiss,
            modifier = modifier,
        )
    }
}

/**
 * Stateless card renderer for every step — the unit/UI-test + preview entry point (rendered inline, without the
 * Dialog window). Classifies the [stepIndex] into an [OnboardingWizardRender] and draws the glass card: the close
 * affordance, the progress dots, the tinted hero (icon + title + description), and the Skip / advance footer.
 */
@Composable
fun OnboardingWizardCard(
    stepIndex: Int,
    onAdvance: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val render = classifyStep(stepIndex)
    val dialogLabel = stringResource(R.string.translation_tour_dialogLabel)
    val closeLabel = stringResource(R.string.translation_a11y_closeDialog)
    Surface(
        modifier =
            modifier
                .fillMaxWidth(MODAL_WIDTH_FRACTION)
                .widthIn(max = MODAL_MAX_WIDTH)
                .semantics { paneTitle = dialogLabel },
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.modal,
        border =
            BorderStroke(
                MODAL_BORDER_WIDTH,
                MaterialTheme.colorScheme.onSurface.copy(alpha = MODAL_BORDER_ALPHA),
            ),
    ) {
        Column(modifier = Modifier.padding(Spacing.lg)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                IconButton(
                    imageVector = TeslaGlyphs.Close,
                    contentDescription = closeLabel,
                    onClick = onDismiss,
                    size = IconSize.Md,
                )
            }
            StepIndicator(render = render)
            Spacer(Modifier.height(Spacing.lg))
            StepHero(accent = render.accent)
            Spacer(Modifier.height(Spacing.xl))
            WizardActions(isLast = render.isLast, onAdvance = onAdvance, onSkip = onDismiss)
        }
    }
}

/**
 * The progress dots — one per step, the reached ones tinted to the brand accent and the active one widened
 * (web `i <= currentStep` / `i === currentStep`). The row reads to TalkBack as a single localized "N / M" counter
 * instead of announcing each decorative bar.
 */
@Composable
private fun StepIndicator(render: OnboardingWizardRender) {
    val counter =
        stringResource(
            R.string.translation_lightbox_counter,
            render.stepNumber.toString(),
            render.stepTotal.toString(),
        )
    val reachedColor = MaterialTheme.colorScheme.primary
    val upcomingColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = DOT_UPCOMING_ALPHA)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = counter },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(render.stepTotal) { index ->
            val reached = index <= render.stepIndex
            Box(
                modifier =
                    Modifier
                        .height(DOT_HEIGHT)
                        .width(if (index == render.stepIndex) DOT_ACTIVE_WIDTH else DOT_WIDTH)
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(if (reached) reachedColor else upcomingColor),
            )
        }
    }
}

/**
 * The centered hero — the accent-tinted icon tile above the step's title + description, both center-aligned
 * (web `flex flex-col items-center text-center`). The icon is decorative; the title + body are merged into one
 * TalkBack announcement so the step reads as a single coherent unit.
 */
@Composable
private fun StepHero(accent: OnboardingStepAccent) {
    val tone = toneFor(accent)
    val title = stringResource(titleResFor(accent))
    val description = stringResource(descResFor(accent))
    val spokenLabel = stepAccessibilityLabel(title, description)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = spokenLabel },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        IconBox(tone = tone, size = IconBoxSize.Lg) {
            Icon(glyphFor(accent), contentDescription = null, size = IconSize.Xl, tint = iconColorFor(tone))
        }
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Text(
            text = description,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The footer — a left-aligned "Skip" ghost button and a right-aligned prominent advance button that reads "Next"
 * with a trailing chevron on every step but the last and "Get Started" on the last
 * (web `currentStep < steps.length - 1 ? <>Next …</> : 'Get Started'`).
 */
@Composable
private fun WizardActions(
    isLast: Boolean,
    onAdvance: () -> Unit,
    onSkip: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = stringResource(R.string.translation_tour_skip),
            onClick = onSkip,
            variant = ButtonVariant.Ghost,
        )
        if (isLast) {
            Button(
                label = stringResource(R.string.translation_tour_finish),
                onClick = onAdvance,
                variant = ButtonVariant.Primary,
            )
        } else {
            Button(onClick = onAdvance, variant = ButtonVariant.Primary) {
                Text(stringResource(R.string.translation_tour_next), style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.width(Spacing.xs))
                Icon(TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Sm)
            }
        }
    }
}

/** Map a step [accent] to the shared [IconBox] tone — the native mirror of the per-step web `color`. */
private fun toneFor(accent: OnboardingStepAccent): IconBoxTone =
    when (accent) {
        OnboardingStepAccent.Welcome -> IconBoxTone.Info
        OnboardingStepAccent.Connect -> IconBoxTone.Success
        OnboardingStepAccent.Configure -> IconBoxTone.Warning
        OnboardingStepAccent.Ready -> IconBoxTone.Primary
    }

/** Map a step [accent] to its hero glyph — the closest native stand-in for the web lucide icon. */
private fun glyphFor(accent: OnboardingStepAccent): ImageVector =
    when (accent) {
        OnboardingStepAccent.Welcome -> FeedbackGlyphs.Bolt
        OnboardingStepAccent.Connect -> FeedbackGlyphs.Lock
        OnboardingStepAccent.Configure -> FeedbackGlyphs.Wrench
        OnboardingStepAccent.Ready -> TeslaGlyphs.Check
    }

/** The i18n title key for a step [accent] (web hard-coded title → closest P1/S10 catalog key). */
@StringRes
private fun titleResFor(accent: OnboardingStepAccent): Int =
    when (accent) {
        OnboardingStepAccent.Welcome -> R.string.translation_onboarding_welcome
        OnboardingStepAccent.Connect -> R.string.translation_onboarding_tesla_title
        OnboardingStepAccent.Configure -> R.string.translation_tour_tours_settings_title
        OnboardingStepAccent.Ready -> R.string.translation_onboarding_ready
    }

/** The i18n description key for a step [accent] (web hard-coded body → closest P1/S10 catalog key). */
@StringRes
private fun descResFor(accent: OnboardingStepAccent): Int =
    when (accent) {
        OnboardingStepAccent.Welcome -> R.string.translation_onboarding_desc
        OnboardingStepAccent.Connect -> R.string.translation_onboarding_tesla_desc
        OnboardingStepAccent.Configure -> R.string.translation_tour_tours_settings_description
        OnboardingStepAccent.Ready -> R.string.translation_onboarding_intro_desc
    }

// ── Previews — one per ordered step, exercising the dot, hero, and advance branches inline (no Dialog window). ──

@Preview(name = "OnboardingWizard · 1 welcome", showBackground = true)
@Composable
private fun OnboardingWizardWelcomePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OnboardingWizardCard(stepIndex = 0, onAdvance = {}, onDismiss = {})
    }
}

@Preview(name = "OnboardingWizard · 2 connect", showBackground = true)
@Composable
private fun OnboardingWizardConnectPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OnboardingWizardCard(stepIndex = 1, onAdvance = {}, onDismiss = {})
    }
}

@Preview(name = "OnboardingWizard · 3 configure", showBackground = true)
@Composable
private fun OnboardingWizardConfigurePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OnboardingWizardCard(stepIndex = 2, onAdvance = {}, onDismiss = {})
    }
}

@Preview(name = "OnboardingWizard · 4 ready (Get Started)", showBackground = true)
@Composable
private fun OnboardingWizardReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OnboardingWizardCard(stepIndex = 3, onAdvance = {}, onDismiss = {})
    }
}
