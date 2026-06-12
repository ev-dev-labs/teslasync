// The native Jetpack Compose + Material 3 KioskOverlay feature view — a parity port of
// web/src/features/dashboard/components/KioskOverlay.tsx. The web component is a set of fixed-position,
// mostly non-interactive layers a dashboard renders while in kiosk mode: an ambient dim wash, an optional
// cursor-hiding layer, a corner clock that ticks once per second, a row of dashboard-rotation dots, and an
// exit affordance that fades in on interaction and is always reachable by touch. This port reproduces every
// one of those branches with native primitives.
//
// Every derivation flows through the pure [KioskOverlayProjection] + [KioskClockFormat]; the composable is a
// thin render layer. The only strings are the exit affordance's accessible name and visible label, both
// resolved from the generated i18n catalog (P1/S10) `kiosk.*` keys — there is no English literal in this
// file. The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Token + geometry mapping (P1/S9 tokens, no ported Tailwind): the web `bg-black` dim wash maps to
// `colorScheme.scrim` (pure black) at the projected alpha; the `--text-muted` clock maps to
// `colorScheme.outlineVariant`; the exit chip's `--surface-overlay` background maps to
// `colorScheme.surfaceVariant` (the glass composite) and its `--text-secondary` foreground to
// `onSurfaceVariant`; the dots' `--surface-2` maps to `surfaceVariant`. The web corner utilities (`top-4`,
// `left-4`, …) map to `Spacing.lg` (16 dp) insets for the clock/dots and `Spacing.md` (12 dp) for the exit
// chip (web `top-3 right-3`), and physical left/right map to RTL-aware `Start`/`End` alignments. The web
// `transition-*` fades map to `animate*AsState`, collapsed to an instant snap under reduced motion
// (P1/S9 `rememberReducedMotion`).
//
// Faithful non-interactivity: the web dim/cursor/clock/dots layers are `pointer-events-none`, so only the
// exit button is interactive. The native decorative layers add no pointer input, and the root interaction
// observer (which reveals the exit chip) never consumes the event — so the overlay can sit above a live
// dashboard without swallowing its touches, exactly like the web.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/KioskOverlay) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.kioskoverlay

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.time.ZoneId
import java.util.Locale

// ── Timings + geometry (web `setInterval(…, 1000)`, the 3s exit hint, the `h-1.5`/`w-6` dots) ───────────
private const val CLOCK_TICK_MS: Long = 1_000L
private const val EXIT_VISIBLE_MS: Long = 3_000L
private const val INSTANT_SNAP_MS: Int = 0

private val DOT_THICKNESS: Dp = 6.dp // web `h-1.5`
private val DOT_INACTIVE_WIDTH: Dp = 6.dp // web `w-1.5`
private val DOT_ACTIVE_WIDTH: Dp = 24.dp // web `w-6`
private val DOT_GAP: Dp = 6.dp // web `gap-1.5`

/** Test tags for the two decorative layers that carry no text/accessible label of their own. */
object KioskOverlayTestTags {
    const val DIM_LAYER: String = "kiosk-overlay-dim-layer"
    const val ROTATION_DOTS: String = "kiosk-overlay-rotation-dots"
}

/**
 * Stateful entry point — the faithful 1:1 port of the web `KioskOverlay({ config, isDimmed, isCursorHidden,
 * dashboardCount, currentIndex, onExit })` props. Records the one-shot `view.opened` diagnostic on first
 * composition (P1/S11), drives the per-second clock tick and the interaction-revealed exit hint, projects
 * the props via the pure [KioskOverlayProjection], and renders.
 *
 * @param config the overlay slice of the kiosk config (web `config`).
 * @param isDimmed web `isDimmed` — when true the ambient dim wash renders.
 * @param isCursorHidden web `isCursorHidden` — carried through; Android has no pointer to hide, so it drives
 *   no visible surface (matching the web layer, which is also invisible + aria-hidden).
 * @param dashboardCount web `dashboardCount` — the number of rotation dashboards.
 * @param currentIndex web `currentIndex` — the active dashboard, highlighted in the dots.
 * @param onExit web `onExit` — invoked when the exit affordance is tapped.
 * @param zone the wall-clock zone; defaults to the device zone (the native kiosk-clock idiom). Injectable
 *   for previews/tests.
 * @param nowProvider the millis clock source; defaults to the system clock. Injectable for previews/tests.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun KioskOverlay(
    config: KioskOverlayConfig,
    isDimmed: Boolean,
    isCursorHidden: Boolean,
    dashboardCount: Int,
    currentIndex: Int,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    nowProvider: () -> Long = { System.currentTimeMillis() },
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { KioskOverlayDiagnostics.recordViewOpened(logger) }

    val display =
        remember(config, isDimmed, isCursorHidden, dashboardCount, currentIndex) {
            KioskOverlayProjection.project(config, isDimmed, isCursorHidden, dashboardCount, currentIndex)
        }

    // Clock tick — web `setInterval(() => setNow(new Date()), 1000)`, started only when the clock is shown
    // and torn down (effect re-keyed) when it is hidden, mirroring the web `if (!config.showClock) return`.
    var now by remember { mutableLongStateOf(nowProvider()) }
    LaunchedEffect(display.showClock) {
        if (!display.showClock) return@LaunchedEffect
        while (isActive) {
            now = nowProvider()
            delay(CLOCK_TICK_MS)
        }
    }

    // Exit hint — web reveals the button on any pointer interaction and hides it 3s after the last one. Each
    // new interaction bumps the nonce, re-keying the effect so the previous 3s timer is cancelled (debounce).
    var interactionNonce by remember { mutableIntStateOf(0) }
    var showExit by remember { mutableStateOf(false) }
    LaunchedEffect(interactionNonce) {
        if (interactionNonce == 0) return@LaunchedEffect
        showExit = true
        delay(EXIT_VISIBLE_MS)
        showExit = false
    }

    val locale: Locale = LocalConfiguration.current.locales[0]
    val timeText = if (display.showClock) KioskClockFormat.time(now, locale, zone) else ""
    val dateText = if (display.showClock) KioskClockFormat.dateWithDay(now, locale, zone) else ""

    KioskOverlayContent(
        display = display,
        timeText = timeText,
        dateText = dateText,
        showExit = showExit,
        onExit = onExit,
        // The root observer reveals the exit chip on any touch and never consumes the event (web
        // `pointer-events-none`), so an underlying dashboard still receives the same touch.
        modifier =
            modifier.pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    interactionNonce++
                }
            },
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Lays the overlay's layers into a full-size
 * [Box]: the dim wash (when [KioskOverlayDisplay.dimAlpha] is set), the corner clock (when
 * [KioskOverlayDisplay.showClock]), the rotation dots (when [KioskOverlayDisplay.showDots]), and the
 * always-present exit chip whose opacity is driven by [showExit]. The cursor-hidden branch has no visible
 * Android surface (see [KioskOverlayDisplay.cursorHidden]) and so renders nothing.
 */
@Composable
fun KioskOverlayContent(
    display: KioskOverlayDisplay,
    timeText: String,
    dateText: String,
    showExit: Boolean,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxSize()) {
        display.dimAlpha?.let { dimAlpha ->
            Box(
                modifier =
                    Modifier
                        .matchParentSize()
                        .testTag(KioskOverlayTestTags.DIM_LAYER)
                        .background(MaterialTheme.colorScheme.scrim.copy(alpha = dimAlpha)),
            )
        }

        if (display.showClock) {
            KioskClockReadout(
                timeText = timeText,
                dateText = dateText,
                modifier =
                    Modifier
                        .align(display.clockPosition.toAlignment())
                        .padding(Spacing.lg),
            )
        }

        if (display.showDots) {
            KioskRotationDots(
                count = display.dotCount,
                activeIndex = display.activeDotIndex,
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = Spacing.lg),
            )
        }

        KioskExitButton(
            visible = showExit,
            onClick = onExit,
            modifier =
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(Spacing.md),
        )
    }
}

/**
 * The corner clock — the web `font-mono` column of a large `formatTime(now)` over a small
 * `formatDateWithDay(now)`, both in `--text-muted`. Decorative (the live time is announced by the system
 * clock, not this kiosk chrome), so it carries no extra semantics.
 */
@Composable
private fun KioskClockReadout(
    timeText: String,
    dateText: String,
    modifier: Modifier = Modifier,
) {
    val muted = MaterialTheme.colorScheme.outlineVariant
    Column(modifier = modifier) {
        Text(
            text = timeText,
            style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace),
            color = muted,
        )
        Text(
            text = dateText,
            style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
            color = muted,
        )
    }
}

/**
 * The dashboard-rotation indicator — the web bottom-center row of `--surface-2` pills where the active dot
 * is wider (`w-6`) than the rest (`w-1.5`); the width change animates (web `transition-all`) and snaps
 * instantly under reduced motion. Both states share the same color, exactly like the web.
 */
@Composable
private fun KioskRotationDots(
    count: Int,
    activeIndex: Int,
    modifier: Modifier = Modifier,
) {
    val color = MaterialTheme.colorScheme.surfaceVariant
    val reduceMotion = rememberReducedMotion()
    Row(
        modifier = modifier.testTag(KioskOverlayTestTags.ROTATION_DOTS),
        horizontalArrangement = Arrangement.spacedBy(DOT_GAP),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            val targetWidth = if (index == activeIndex) DOT_ACTIVE_WIDTH else DOT_INACTIVE_WIDTH
            val width by animateDpAsState(
                targetValue = targetWidth,
                animationSpec = tween(durationMillis = if (reduceMotion) INSTANT_SNAP_MS else MotionDurations.normal),
                label = "kiosk-dot-width",
            )
            Box(
                modifier =
                    Modifier
                        .height(DOT_THICKNESS)
                        .width(width)
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(color),
            )
        }
    }
}

/**
 * The exit affordance — the web ghost button on a `--surface-overlay` glass chip, an `X` glyph beside the
 * "Exit Kiosk" label, with the accessible name "Exit kiosk mode" (web `aria-label`). It is always composed
 * and always tappable (web "always accessible via touch"); only its opacity animates between revealed and
 * hidden (web `transition-opacity`), snapping instantly under reduced motion.
 */
@Composable
private fun KioskExitButton(
    visible: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reduceMotion = rememberReducedMotion()
    val chipAlpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = tween(durationMillis = if (reduceMotion) INSTANT_SNAP_MS else MotionDurations.slow),
        label = "kiosk-exit-alpha",
    )
    val exitAccessibleName = stringResource(R.string.translation_kiosk_exit)
    val exitLabel = stringResource(R.string.translation_kiosk_exitLabel)
    val foreground = MaterialTheme.colorScheme.onSurfaceVariant

    Button(
        onClick = onClick,
        modifier =
            modifier
                .alpha(chipAlpha)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(Radius.lg))
                .semantics { contentDescription = exitAccessibleName },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    ) {
        Icon(imageVector = TeslaGlyphs.Close, contentDescription = null, size = IconSize.Sm, tint = foreground)
        Spacer(modifier = Modifier.width(Spacing.xs))
        Text(text = exitLabel, style = MaterialTheme.typography.labelLarge, color = foreground)
    }
}

/**
 * Maps a [KioskClockPosition] onto a Compose [Alignment] — the native analogue of the web corner Tailwind
 * utilities. Physical left/right map to RTL-aware `Start`/`End` so the clock follows the layout direction.
 */
private fun KioskClockPosition.toAlignment(): Alignment =
    when (this) {
        KioskClockPosition.TopLeft -> Alignment.TopStart
        KioskClockPosition.TopRight -> Alignment.TopEnd
        KioskClockPosition.BottomLeft -> Alignment.BottomStart
        KioskClockPosition.BottomRight -> Alignment.BottomEnd
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private const val PREVIEW_TIME = "10:47 PM"
private const val PREVIEW_DATE = "Thu, Jun 11"

@Preview(name = "Dimmed + clock (bottom-right) + dots + exit", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun KioskOverlayFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        KioskOverlayContent(
            display =
                KioskOverlayDisplay(
                    dimAlpha = 0.5f,
                    cursorHidden = false,
                    showClock = true,
                    clockPosition = KioskClockPosition.BottomRight,
                    showDots = true,
                    dotCount = 4,
                    activeDotIndex = 1,
                ),
            timeText = PREVIEW_TIME,
            dateText = PREVIEW_DATE,
            showExit = true,
            onExit = {},
        )
    }
}

@Preview(name = "Clock top-left, no dim, hidden exit", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun KioskOverlayClockTopLeftPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        KioskOverlayContent(
            display =
                KioskOverlayDisplay(
                    dimAlpha = null,
                    cursorHidden = false,
                    showClock = true,
                    clockPosition = KioskClockPosition.TopLeft,
                    showDots = false,
                    dotCount = 4,
                    activeDotIndex = 1,
                ),
            timeText = PREVIEW_TIME,
            dateText = PREVIEW_DATE,
            showExit = false,
            onExit = {},
        )
    }
}

@Preview(name = "Clock off, single dashboard (no dots), exit shown", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun KioskOverlayMinimalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        KioskOverlayContent(
            display =
                KioskOverlayDisplay(
                    dimAlpha = null,
                    cursorHidden = false,
                    showClock = false,
                    clockPosition = KioskClockPosition.BottomRight,
                    showDots = false,
                    dotCount = 1,
                    activeDotIndex = 0,
                ),
            timeText = "",
            dateText = "",
            showExit = true,
            onExit = {},
        )
    }
}
