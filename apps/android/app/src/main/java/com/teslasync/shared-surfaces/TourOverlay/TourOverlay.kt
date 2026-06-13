// The native Jetpack Compose + Material 3 TourOverlay shared surface — a parity port of
// web/src/components/feedback/TourOverlay.tsx. The web surface is a full-screen, controlled tour coach-mark:
// a dimming scrim with a rounded spotlight cutout punched around the highlighted element, a primary-tinted
// glow framing that spotlight, and a floating tooltip card anchored to one side of the target. The card shows
// a "N / M" step counter, a close (✕) affordance, the step title + description, a "Skip tour" link, a "Back"
// button (hidden on the first step), a prominent "Next"/"Get Started!" advance button (with a trailing arrow
// on every step but the last), and a row of progress dots with the active one widened.
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the
// Hidden surface (`targetRect == null`), the four tooltip placements, the first/middle/last navigation
// branches, and the active-vs-inactive dots — without ever hiding a region. It performs NO HTTP and binds NO
// data port: it is controlled by its props (the host owns the cursor, the native analogue of the web
// `useTour`), its motion seam is `rememberReducedMotion()` (P1/S8, the web `useMotionPreference().reduce`),
// and its i18n seam is the string catalog (P1/S10) via the six `translation_tour_*` keys. The chrome is
// composed from the shared ui atoms (Surface, Button, IconButton, Icon, Caption, PanelTitle, BodyText) + the
// TeslaGlyphs set, so the tint stays correct across light / dark / high-contrast themes. The tooltip is a
// dialog pane (web `role="dialog"`), the title + body merge into one TalkBack announcement, the close + skip
// affordances carry their own labels, the decorative dots are hidden from TalkBack (the counter conveys
// position), and a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition. All
// derivation flows through the pure reducers in TourOverlayModel.kt; this composable only owns the diagnostic
// effect, the reduced-motion-aware entry animation, and the spotlight/tooltip geometry layout.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TourOverlay) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.touroverlay

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.effectiveDurationMs
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the full-screen overlay container — so each state asserts a non-blank surface. */
const val TOUR_OVERLAY_TEST_TAG: String = "tour-overlay"

/** Test tag identifying the floating tooltip card — used by the instrumented per-state + a11y UI tests. */
const val TOUR_TOOLTIP_TEST_TAG: String = "tour-overlay-tooltip"

private const val SCRIM_ALPHA: Float = 0.6f
private val SPOTLIGHT_BORDER_WIDTH: Dp = 2.dp
private const val SPOTLIGHT_BORDER_ALPHA: Float = 0.4f
private val TOOLTIP_BORDER_WIDTH: Dp = 1.dp
private const val TOOLTIP_BORDER_ALPHA: Float = 0.08f
private val TOOLTIP_ENTRY_SLIDE: Dp = 8.dp
private val DOT_HEIGHT: Dp = 4.dp
private val DOT_ACTIVE_WIDTH: Dp = 16.dp
private val DOT_INACTIVE_WIDTH: Dp = 6.dp
private const val DOT_INACTIVE_ALPHA: Float = 0.3f

/**
 * Stateful entry point — the faithful port of the web `TourOverlay`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, binds the reduced-motion preference (the web
 * `useMotionPreference().reduce`), classifies the controlled props into a [TourSurface], and renders the
 * overlay. Renders nothing while [target] is `null` (web `targetRect === null` → `null`). Performs no HTTP;
 * the host owns the cursor and supplies the [onNext] / [onPrev] / [onSkip] callbacks. [logger] defaults to
 * the process logger.
 *
 * @param step the active step's title / description / placement (web `step`).
 * @param target the measured bounds of the highlighted element, or `null` to hide the overlay (web `targetRect`).
 * @param currentStep the zero-based cursor (web `currentStep`).
 * @param totalSteps the total number of steps (web `totalSteps`).
 */
@Composable
fun TourOverlay(
    step: TourStepContent,
    target: TourTarget?,
    currentStep: Int,
    totalSteps: Int,
    onNext: () -> Unit,
    onPrev: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = rememberReducedMotion(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TourOverlayDiagnostics.recordViewOpened(logger) }
    TourOverlayContent(
        surface = classifyTour(target, step, currentStep, totalSteps),
        modifier = modifier,
        reducedMotion = reducedMotion,
        onNext = onNext,
        onPrev = onPrev,
        onSkip = onSkip,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Renders the overlay
 * when [surface] is [TourSurface.Visible], or nothing when it is [TourSurface.Hidden] (web `targetRect ===
 * null` → `null`). Deterministic: every navigation branch is already reduced into [surface], so no cursor
 * math happens here.
 */
@Composable
fun TourOverlayContent(
    surface: TourSurface,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = false,
    onNext: () -> Unit = {},
    onPrev: () -> Unit = {},
    onSkip: () -> Unit = {},
) {
    if (surface !is TourSurface.Visible) return
    TourSpotlightScene(
        visible = surface,
        reducedMotion = reducedMotion,
        onNext = onNext,
        onPrev = onPrev,
        onSkip = onSkip,
        modifier = modifier,
    )
}

/**
 * The full-screen tour scene: the dimming scrim with its spotlight cutout, the primary glow framing the
 * spotlight, and the floating tooltip anchored to the target per [tooltipPosition]. The tooltip remeasures
 * itself and feeds its size back so the placement clamp settles to the real dimensions.
 */
@Composable
private fun TourSpotlightScene(
    visible: TourSurface.Visible,
    reducedMotion: Boolean,
    onNext: () -> Unit,
    onPrev: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    BoxWithConstraints(
        modifier = modifier.fillMaxSize().testTag(TOUR_OVERLAY_TEST_TAG),
    ) {
        val viewport = TourViewport(widthDp = maxWidth.value, heightDp = maxHeight.value)
        var tooltipSize by remember(viewport) {
            mutableStateOf(TourSize(widthDp = tooltipMaxWidthDp(viewport.widthDp), heightDp = 0f))
        }
        val position = tooltipPosition(visible.step.placement, visible.target, viewport, tooltipSize)

        TourScrim(spotlight = visible.spotlight, onSkip = onSkip)
        TourSpotlightFrame(spotlight = visible.spotlight)
        TourTooltipCard(
            visible = visible,
            reducedMotion = reducedMotion,
            onNext = onNext,
            onPrev = onPrev,
            onSkip = onSkip,
            modifier =
                Modifier
                    .align(Alignment.TopStart)
                    .offset { IntOffset(position.xDp.dp.roundToPx(), position.yDp.dp.roundToPx()) }
                    .widthIn(max = position.maxWidthDp.dp)
                    .onSizeChanged { tooltipSize = pxToTourSize(it, density) },
        )
    }
}

/**
 * The dimming scrim with a rounded spotlight cut out around the target (web dark overlay + `clip-path`
 * polygon). Drawn into an offscreen layer so the `BlendMode.Clear` cutout resolves to transparency. A tap
 * anywhere outside the spotlight dismisses the tour (web `onClick={onSkip}` on the overlay); taps inside the
 * cutout fall through, exactly like the web clipped overlay.
 */
@Composable
private fun TourScrim(
    spotlight: SpotlightBounds,
    onSkip: () -> Unit,
) {
    val scrimColor = MaterialTheme.colorScheme.scrim.copy(alpha = SCRIM_ALPHA)
    val cornerPx = with(LocalDensity.current) { Radius.md.toPx() }
    Canvas(
        modifier =
            Modifier
                .fillMaxSize()
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .pointerInput(spotlight) {
                    val left = spotlight.leftDp.dp.toPx()
                    val top = spotlight.topDp.dp.toPx()
                    val right = (spotlight.leftDp + spotlight.widthDp).dp.toPx()
                    val bottom = (spotlight.topDp + spotlight.heightDp).dp.toPx()
                    detectTapGestures { offset ->
                        val insideSpotlight = offset.x in left..right && offset.y in top..bottom
                        if (!insideSpotlight) onSkip()
                    }
                },
    ) {
        drawRect(color = scrimColor)
        drawRoundRect(
            color = Color.Transparent,
            topLeft = Offset(spotlight.leftDp.dp.toPx(), spotlight.topDp.dp.toPx()),
            size = Size(spotlight.widthDp.dp.toPx(), spotlight.heightDp.dp.toPx()),
            cornerRadius = CornerRadius(cornerPx, cornerPx),
            blendMode = BlendMode.Clear,
        )
    }
}

/** The primary-tinted glow framing the spotlight (web `border-2 border-theme-primary/40` + glow). Decorative. */
@Composable
private fun TourSpotlightFrame(spotlight: SpotlightBounds) {
    Box(
        modifier =
            Modifier
                .offset { IntOffset(spotlight.leftDp.dp.roundToPx(), spotlight.topDp.dp.roundToPx()) }
                .size(width = spotlight.widthDp.dp, height = spotlight.heightDp.dp)
                .border(
                    width = SPOTLIGHT_BORDER_WIDTH,
                    color = MaterialTheme.colorScheme.primary.copy(alpha = SPOTLIGHT_BORDER_ALPHA),
                    shape = RoundedCornerShape(Radius.md),
                ).clearAndSetSemantics { },
    )
}

/**
 * The floating tooltip card — a rounded, bordered Surface (web `rounded-xl bg-secondary border-subtle
 * shadow-2xl`) with a reduced-motion-aware fade + slide-up entry (web `animate-in fade-in slide-in-from-
 * bottom-2`). Exposed to TalkBack as a dialog pane (web `role="dialog"`).
 */
@Composable
private fun TourTooltipCard(
    visible: TourSurface.Visible,
    reducedMotion: Boolean,
    onNext: () -> Unit,
    onPrev: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val dialogLabel = stringResource(R.string.translation_tour_dialogLabel)
    val entry = rememberEntryProgress(reducedMotion)
    Surface(
        modifier =
            modifier
                .testTag(TOUR_TOOLTIP_TEST_TAG)
                .graphicsLayer {
                    alpha = entry
                    translationY = (1f - entry) * if (reducedMotion) 0f else TOOLTIP_ENTRY_SLIDE.toPx()
                }.semantics { paneTitle = dialogLabel },
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.modal,
        border =
            BorderStroke(
                TOOLTIP_BORDER_WIDTH,
                MaterialTheme.colorScheme.onSurface.copy(alpha = TOOLTIP_BORDER_ALPHA),
            ),
    ) {
        Column(modifier = Modifier.padding(Spacing.lg)) {
            TourTooltipHeader(stepNumber = visible.stepNumber, totalSteps = visible.totalSteps, onSkip = onSkip)
            Spacer(Modifier.height(Spacing.sm))
            TourTooltipBody(step = visible.step)
            Spacer(Modifier.height(Spacing.lg))
            TourNavigationRow(
                isLast = visible.isLast,
                showBack = visible.showBack,
                showForwardArrow = visible.showForwardArrow,
                onNext = onNext,
                onPrev = onPrev,
                onSkip = onSkip,
            )
            Spacer(Modifier.height(Spacing.md))
            TourProgressDots(currentStep = visible.currentStep, totalSteps = visible.totalSteps)
        }
    }
}

/** The counter (web `{currentStep + 1} / {totalSteps}`) on the left and the close (✕) affordance on the right. */
@Composable
private fun TourTooltipHeader(
    stepNumber: Int,
    totalSteps: Int,
    onSkip: () -> Unit,
) {
    val counter = stringResource(R.string.translation_lightbox_counter, stepNumber.toString(), totalSteps.toString())
    val closeLabel = stringResource(R.string.translation_tour_close)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(counter)
        IconButton(
            imageVector = TeslaGlyphs.Close,
            contentDescription = closeLabel,
            onClick = onSkip,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The step title + description, merged into one TalkBack announcement (web `<h4>` + `<p>`). */
@Composable
private fun TourTooltipBody(step: TourStepContent) {
    val spokenLabel = tourAccessibilityLabel(step.title, step.description)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = spokenLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        PanelTitle(step.title)
        BodyText(step.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * The footer — a left-aligned "Skip tour" link and a right-aligned group with an optional "Back" button (web
 * `currentStep > 0`) and the prominent advance button.
 */
@Composable
private fun TourNavigationRow(
    isLast: Boolean,
    showBack: Boolean,
    showForwardArrow: Boolean,
    onNext: () -> Unit,
    onPrev: () -> Unit,
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
            size = ButtonSize.Sm,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showBack) {
                Button(
                    label = stringResource(R.string.translation_tour_prev),
                    onClick = onPrev,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = TeslaGlyphs.ChevronLeft,
                )
            }
            TourAdvanceButton(isLast = isLast, showForwardArrow = showForwardArrow, onNext = onNext)
        }
    }
}

/** The advance button — "Get Started!" on the last step (web `tour.finish`), else "Next" with a trailing arrow. */
@Composable
private fun TourAdvanceButton(
    isLast: Boolean,
    showForwardArrow: Boolean,
    onNext: () -> Unit,
) {
    if (isLast) {
        Button(
            label = stringResource(R.string.translation_tour_finish),
            onClick = onNext,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
        )
        return
    }
    Button(onClick = onNext, variant = ButtonVariant.Primary, size = ButtonSize.Sm) {
        Text(stringResource(R.string.translation_tour_next), style = MaterialTheme.typography.labelLarge)
        if (showForwardArrow) {
            Spacer(Modifier.width(Spacing.xs))
            Icon(TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Sm)
        }
    }
}

/**
 * The progress dots — one per step, the active one widened + tinted to the brand accent (web `i === currentStep
 * ? 'w-4 bg-theme-primary' : 'w-1.5 bg-surface-2'`). Decorative: the row is hidden from TalkBack because the
 * header counter already conveys the position.
 */
@Composable
private fun TourProgressDots(
    currentStep: Int,
    totalSteps: Int,
) {
    val activeColor = MaterialTheme.colorScheme.primary
    val inactiveColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = DOT_INACTIVE_ALPHA)
    Row(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(totalSteps) { index ->
            val active = dotStateFor(index, currentStep) == TourDotState.Active
            Box(
                modifier =
                    Modifier
                        .height(DOT_HEIGHT)
                        .width(if (active) DOT_ACTIVE_WIDTH else DOT_INACTIVE_WIDTH)
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(if (active) activeColor else inactiveColor),
            )
        }
    }
}

/**
 * The reduced-motion-aware entry progress `0f → 1f` driving the tooltip fade + slide-up (web `animate-in
 * fade-in slide-in-from-bottom-2`). Under reduced motion the value starts settled and the duration collapses
 * to zero ([effectiveDurationMs]), so the card appears instantly with no movement.
 */
@Composable
private fun rememberEntryProgress(reducedMotion: Boolean): Float {
    var appeared by remember { mutableStateOf(reducedMotion) }
    LaunchedEffect(Unit) { appeared = true }
    val progress by animateFloatAsState(
        targetValue = if (appeared) 1f else 0f,
        animationSpec = tween(durationMillis = effectiveDurationMs(reducedMotion, MotionDurations.normal)),
        label = "tourTooltipEntry",
    )
    return progress
}

/** Convert a measured pixel [size] into the dp-based [TourSize] the placement clamp consumes. */
private fun pxToTourSize(
    size: IntSize,
    density: Density,
): TourSize =
    with(density) {
        TourSize(widthDp = size.width.toDp().value, heightDp = size.height.toDp().value)
    }

// ── Previews — the Hidden surface plus each placement and navigation branch, rendered inline. Sample step
// copy is resolved from the catalog so no English literal ever appears in the surface code. ──────────────────

@Composable
private fun sampleTourSurface(
    placement: TourPlacement,
    currentStep: Int,
    totalSteps: Int,
): TourSurface =
    classifyTour(
        target = TourTarget(leftDp = 48f, topDp = 220f, widthDp = 240f, heightDp = 56f),
        step =
            TourStepContent(
                title = stringResource(R.string.translation_onboarding_welcome),
                description = stringResource(R.string.translation_onboarding_desc),
                placement = placement,
            ),
        currentStep = currentStep,
        totalSteps = totalSteps,
    )

@Preview(name = "TourOverlay · bottom · first step", showBackground = true)
@Composable
private fun TourOverlayFirstStepPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TourOverlayContent(surface = sampleTourSurface(TourPlacement.Bottom, currentStep = 0, totalSteps = 4))
    }
}

@Preview(name = "TourOverlay · right · middle step", showBackground = true)
@Composable
private fun TourOverlayMiddleStepPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TourOverlayContent(surface = sampleTourSurface(TourPlacement.Right, currentStep = 1, totalSteps = 4))
    }
}

@Preview(name = "TourOverlay · top · last step", showBackground = true)
@Composable
private fun TourOverlayLastStepPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TourOverlayContent(surface = sampleTourSurface(TourPlacement.Top, currentStep = 3, totalSteps = 4))
    }
}
