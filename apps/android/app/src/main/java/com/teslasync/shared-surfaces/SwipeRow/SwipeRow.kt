// The native Jetpack Compose + Material 3 SwipeRow shared surface — a parity port of
// web/src/components/mobile/SwipeRow.tsx. The web component is a swipe-to-action row primitive for mobile lists
// (the iOS Mail / Apple Notes interaction): drag the row left to reveal the right-edge action, drag right to
// reveal the left-edge action, a short release past the reveal threshold (default 64 px) leaves the action
// "peeked" open for the user to tap, a long release past 50 % of the row width auto-fires the action immediately,
// a vertical drag aborts so the parent list keeps scrolling, the first reveal-threshold crossing fires a short
// haptic, and the snap-back collapses to 0 ms under reduced motion. It is touch-only by default
// (`enabled` defaults to `useIsCoarsePointer()`): on a fine pointer it renders the children straight through with
// zero handlers. Its only hooks are `useIsCoarsePointer` and `useMotionPreference` — it fetches nothing; the
// action labels + callbacks are caller-supplied props (so it owns no i18n strings, exactly like the web source).
//
// All pure derivations live in SwipeRowModel.kt and are unit-tested off-device; this file is the thin render layer
// that wires the horizontal drag, draws the two action underlays, slides the content, resolves the touch-only
// default + reduced-motion snap, fires the haptic, and records the one-shot diagnostic.
//
// Because the web source owns no async feed (the host row owns the data and passes the actions down), it has NO
// loading / empty-fetch / error / stale / offline network lifecycle — exactly like the accepted presentational
// ports (PullToRefresh, StaggerContainer). Modelling one would invent a fetch the spec does not have (honesty
// covenant: no scope narrowing, no silent drift). The surface's REAL, fully-reproduced states are the inactive
// passthrough (a fine pointer renders the children straight through), the closed rest (no action revealed, the
// wrapped row shown unshifted — a usable surface, never a blank box), the revealing drag (the underlay grows on
// the swiped edge), the peeked-open action (tap to fire), and the fired action (the callback runs and the row
// snaps shut). Each is exercised by the previews below, the off-device model test, and the on-device UI/a11y test.
//
// Parity choices:
//   • Gesture: web top-level touch drag with axis-lock (`Math.abs(dx) < 8` dead-zone) and a vertical-abort guard
//     (`Math.abs(dy) > 16 && > Math.abs(dx)`) → a native [detectHorizontalDragGestures], whose horizontal
//     touch-slop start + vertical decline is the idiomatic Android (ViewConfiguration) equivalent of those two web
//     px heuristics, so a vertical drag is left for the parent list to scroll. The drag offset is clamped by the
//     pure [clampDragOffsetPx]; on release [resolveRelease] decides fire / peek / close, driven entirely by the
//     pure model so the offline gate covers the logic. The web `Math.abs(dx) < 8` / `Math.abs(dy) > 16` contract
//     is still asserted off-device via [isWithinHorizontalSlop] / [shouldAbortForVertical].
//   • Touch-only default: web `enabled ?? useIsCoarsePointer()` → [rememberIsCoarsePointer], which reads the
//     platform `Configuration.touchscreen` (a non-touch device renders the children straight through), overridable
//     through [LocalCoarsePointer] for previews/tests.
//   • Haptic: web `navigator.vibrate(10)` on the first reveal crossing → a single platform haptic via
//     [androidx.compose.ui.platform.LocalHapticFeedback], gated by the pure [crossedRevealThreshold].
//   • Colors: web `bg-cyan-500/20 text-cyan-100` (default) / `bg-rose-500/20 text-rose-100` (danger) → the
//     generated brand status tokens, never a raw hex: the panel is a low-alpha wash of the tone behind
//     tone-colored icon + label (default → `status.info`, the brand cyan; danger → `status.danger`, the brand
//     rose), theme-correct on light + dark where the web hard-codes one shade.
//   • Default icon by tone: web `defaultIcon` (Archive / Trash2 from lucide) is defined INSIDE the web source, so
//     the two glyphs are authored locally here (Android bundles no lucide set; the shared TeslaGlyphs atom is
//     out of scope for this surface) and tinted by the tone.
//   • Accessibility: each revealed action panel is a single `Button`-role node carrying the localized action label
//     as its accessible name (web `aria-label`), with the decorative icon + duplicate visible label cleared from
//     the a11y tree so it speaks exactly once; a hidden panel is removed from the a11y tree entirely (web
//     `aria-hidden` + `tabIndex=-1`). Reduced motion collapses the snap-back to an instant settle.
//   • Diagnostics: records the one-shot PII-safe `view.opened` event (P1/S11) on first composition.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/SwipeRow — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, glyphs, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.swiperow

import android.content.res.Configuration
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** Test tag identifying the swipe-row wrapper — used by the instrumented per-state + a11y UI tests. */
const val SWIPE_ROW_TEST_TAG: String = "swipe-row"

/** The default reveal threshold in dp — the native equivalent of the web `DEFAULT_REVEAL` (64 px). */
val DEFAULT_REVEAL: Dp = DEFAULT_REVEAL_PX.dp

/** The revealed action underlay width in dp — the native equivalent of the web `ACTION_WIDTH` (96 px). */
val ACTION_WIDTH_DP: Dp = ACTION_WIDTH_PX.dp

/** Panel-background wash alpha over the tone color — the web `bg-{tone}-500/20`. */
const val ACTION_PANEL_WASH_ALPHA: Float = 0.20f

/** Visual tone of a swipe action — `Danger` paints the brand rose, `Default` the brand cyan (web `tone`). */
enum class SwipeTone { Default, Danger }

/**
 * One edge action — the native mirror of the web `SwipeAction`. [label] is the already-localized text the caller
 * supplies (the surface owns no i18n, exactly like the web), [onAction] fires when the user taps the peeked action
 * or auto-completes the swipe, [tone] selects the rose/cyan palette, [icon] optionally overrides the tone default
 * (Archive / Trash), and [contentDescription] is the optional screen-reader name when [label] is not friendly
 * enough (web `ariaLabel`, defaulting to [label]).
 */
data class SwipeAction(
    val label: String,
    val onAction: () -> Unit,
    val tone: SwipeTone = SwipeTone.Default,
    val icon: ImageVector? = null,
    val contentDescription: String? = null,
)

/**
 * Forces the touch-vs-fine pointer answer for everything below it — the deterministic override behind
 * [rememberIsCoarsePointer]. `null` (the default) means "ask the platform"; previews/tests provide `true`/`false`
 * so the gesture-enabled branch is exercised without depending on the host device's input configuration.
 */
val LocalCoarsePointer = staticCompositionLocalOf<Boolean?> { null }

/**
 * The active coarse-pointer (touch) preference — the Android port of the web `useIsCoarsePointer()`. Returns the
 * [LocalCoarsePointer] override when set, otherwise `true` when the platform reports a touchscreen (anything but
 * `Configuration.TOUCHSCREEN_NOTOUCH`), so a touch device opts into the gesture and a fine-pointer device renders
 * the children straight through — exactly as the web `(pointer: coarse)` media query gates it.
 */
@Composable
fun rememberIsCoarsePointer(): Boolean {
    LocalCoarsePointer.current?.let { return it }
    val touchscreen = LocalConfiguration.current.touchscreen
    return remember(touchscreen) { touchscreen != Configuration.TOUCHSCREEN_NOTOUCH }
}

/**
 * Stateful entry point — the faithful port of the web `SwipeRow`. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) on first composition, resolves the touch-only default, and — when active — wires the
 * horizontal drag over the content and hands a fully-resolved render to the stateless [SwipeRowScaffold]. A fine
 * pointer (or a row with no wired action) renders [content] straight through, exactly as the web returns the
 * children unwrapped. Binds no data of its own; the host supplies the [leftAction] / [rightAction] callbacks.
 *
 * @param rightAction the action revealed by a left swipe (web `rightAction`).
 * @param leftAction the action revealed by a right swipe (web `leftAction`).
 * @param enabled overrides the touch-only default; `null` opts in automatically on a coarse (touch) pointer.
 * @param revealThreshold the distance dragged before the action is "revealed" (web `revealThreshold`, 64 px → dp).
 * @param modifier the web `className` analogue.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 * @param content the wrapped row (web `children`).
 */
@Composable
fun SwipeRow(
    rightAction: SwipeAction? = null,
    leftAction: SwipeAction? = null,
    enabled: Boolean? = null,
    revealThreshold: Dp = DEFAULT_REVEAL,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { SwipeRowDiagnostics.recordViewOpened(logger) }

    val hasLeft = leftAction != null
    val hasRight = rightAction != null
    val active = isSwipeActive(enabled, rememberIsCoarsePointer(), hasLeft, hasRight)
    if (!active) {
        // Web parity: a fine pointer (or no wired action) renders the children straight through, no gesture.
        content()
        return
    }

    val density = LocalDensity.current
    val revealPx = with(density) { revealThreshold.toPx() }
    val actionWidthPx = with(density) { ACTION_WIDTH_DP.toPx() }
    val reduce = rememberReducedMotion()
    val currentReduce by rememberUpdatedState(reduce)
    val currentRight by rememberUpdatedState(rightAction)
    val currentLeft by rememberUpdatedState(leftAction)
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var offsetX by remember { mutableFloatStateOf(0f) }
    var rowWidthPx by remember { mutableFloatStateOf(0f) }
    var settleJob by remember { mutableStateOf<Job?>(null) }

    fun settleTo(target: Float) {
        settleJob?.cancel()
        settleJob =
            scope.launch {
                val spec: AnimationSpec<Float> = if (currentReduce) snap() else tween(MotionDurations.fast)
                animate(initialValue = offsetX, targetValue = target, animationSpec = spec) { value, _ -> offsetX = value }
            }
    }

    fun fireRight() {
        currentRight?.onAction()
        settleTo(0f)
    }

    fun fireLeft() {
        currentLeft?.onAction()
        settleTo(0f)
    }

    SwipeRowScaffold(
        offsetPx = offsetX,
        leftAction = leftAction,
        rightAction = rightAction,
        onFireLeft = ::fireLeft,
        onFireRight = ::fireRight,
        modifier = modifier.onSizeChanged { rowWidthPx = it.width.toFloat() },
        contentModifier =
            Modifier.pointerInput(active, hasLeft, hasRight, revealPx, actionWidthPx) {
                var hapticFired = false
                detectHorizontalDragGestures(
                    onDragStart = {
                        hapticFired = false
                        settleJob?.cancel()
                    },
                    onDragCancel = { settleTo(0f) },
                    onDragEnd = {
                        when (val release = resolveRelease(offsetX, rowWidthPx, revealPx, hasLeft, hasRight)) {
                            SwipeRelease.FireRightAction -> fireRight()
                            SwipeRelease.FireLeftAction -> fireLeft()
                            else -> settleTo(releaseTargetOffsetPx(release, actionWidthPx))
                        }
                    },
                    onHorizontalDrag = { change, dragAmount ->
                        val next = clampDragOffsetPx(offsetX + dragAmount, hasLeft, hasRight, rowWidthPx)
                        if (!hapticFired && crossedRevealThreshold(next, revealPx)) {
                            hapticFired = true
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        }
                        offsetX = next
                        change.consume()
                    },
                )
            },
        content = content,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point. Draws the two action underlays (each revealed only when
 * the content has slid off it) beneath the [content], which is translated by [offsetPx] so it slides over the
 * panels. Takes the already-resolved offset + fire callbacks so it renders without a [LocalDataContainer], a
 * gesture, or diagnostics, which makes every state — closed, peeked-left, peeked-right — independently previewable
 * and testable.
 *
 * @param offsetPx the current horizontal content offset in px (0 closed, negative reveals the right action,
 *   positive reveals the left action).
 * @param leftAction the action revealed by a positive offset (web `leftAction`).
 * @param rightAction the action revealed by a negative offset (web `rightAction`).
 * @param onFireLeft invoked when the peeked left action is tapped.
 * @param onFireRight invoked when the peeked right action is tapped.
 * @param contentModifier the gesture (and any host) modifier applied to the sliding content layer.
 * @param content the wrapped row (web `children`).
 */
@Composable
fun SwipeRowScaffold(
    offsetPx: Float,
    leftAction: SwipeAction?,
    rightAction: SwipeAction?,
    onFireLeft: () -> Unit,
    onFireRight: () -> Unit,
    modifier: Modifier = Modifier,
    contentModifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(modifier = modifier.clipToBounds().testTag(SWIPE_ROW_TEST_TAG)) {
        rightAction?.let { action ->
            SwipeActionPanel(
                action = action,
                revealed = rightActionRevealed(offsetPx),
                onFire = onFireRight,
                modifier = Modifier.align(Alignment.CenterEnd),
            )
        }
        leftAction?.let { action ->
            SwipeActionPanel(
                action = action,
                revealed = leftActionRevealed(offsetPx),
                onFire = onFireLeft,
                modifier = Modifier.align(Alignment.CenterStart),
            )
        }
        Box(
            modifier =
                Modifier
                    .offset { IntOffset(offsetPx.roundToInt(), 0) }
                    .background(MaterialTheme.colorScheme.surface)
                    .then(contentModifier),
        ) {
            content()
        }
    }
}

/**
 * One revealed action underlay — the localized icon + label the web draws in its absolute edge panel. When
 * [revealed] it is a single `Button`-role node whose accessible name is the action's localized label (web
 * `aria-label`), with the decorative icon + duplicate visible label cleared from the a11y tree so it speaks once;
 * when hidden it is removed from the a11y tree entirely and is not tappable (web `aria-hidden` + `tabIndex=-1`).
 */
@Composable
private fun SwipeActionPanel(
    action: SwipeAction,
    revealed: Boolean,
    onFire: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val foreground = swipeActionColor(action.tone)
    val accessibleName = action.contentDescription ?: action.label
    val interaction =
        if (revealed) {
            Modifier
                .clickable(role = Role.Button, onClickLabel = action.label, onClick = onFire)
                .semantics { contentDescription = accessibleName }
        } else {
            Modifier.clearAndSetSemantics { }
        }
    Box(
        modifier =
            modifier
                .width(ACTION_WIDTH_DP)
                .fillMaxHeight()
                .background(foreground.copy(alpha = ACTION_PANEL_WASH_ALPHA))
                .then(interaction),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.clearAndSetSemantics { },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = action.icon ?: defaultSwipeIcon(action.tone),
                contentDescription = null,
                size = IconSize.Md,
                tint = foreground,
            )
            BodyText(text = action.label, color = foreground)
        }
    }
}

/** The brand status color for a [tone] — default → the cyan `status.info`, danger → the rose `status.danger`. */
@Composable
private fun swipeActionColor(tone: SwipeTone): Color =
    when (tone) {
        SwipeTone.Default -> TeslaTokens.status.info
        SwipeTone.Danger -> TeslaTokens.status.danger
    }

/** The default tone icon — web `defaultIcon`: danger → [TrashGlyph] (Trash2), default → [ArchiveGlyph]. */
private fun defaultSwipeIcon(tone: SwipeTone): ImageVector =
    when (tone) {
        SwipeTone.Default -> ArchiveGlyph
        SwipeTone.Danger -> TrashGlyph
    }

// ── Local tone glyphs (web `defaultIcon` is defined inside the source; the shared atom is out of scope) ──────

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE_WIDTH = 2f

private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** The Archive glyph (lucide `archive`): a lid, an open box body, and a handle slot. Decorative; tinted by tone. */
private val ArchiveGlyph: ImageVector =
    strokedGlyph("Archive") {
        moveTo(3f, 4f)
        lineTo(21f, 4f)
        lineTo(21f, 8f)
        lineTo(3f, 8f)
        close()
        moveTo(5f, 8f)
        lineTo(5f, 20f)
        lineTo(19f, 20f)
        lineTo(19f, 8f)
        moveTo(10f, 12f)
        lineTo(14f, 12f)
    }

/** The Trash glyph (lucide `trash-2`): a top bar, a lid handle, the can body, and two slots. Decorative. */
private val TrashGlyph: ImageVector =
    strokedGlyph("Trash") {
        moveTo(4f, 6f)
        lineTo(20f, 6f)
        moveTo(9f, 6f)
        lineTo(9f, 4f)
        lineTo(15f, 4f)
        lineTo(15f, 6f)
        moveTo(6f, 6f)
        lineTo(7f, 20f)
        lineTo(17f, 20f)
        lineTo(18f, 6f)
        moveTo(10.5f, 10f)
        lineTo(11f, 16f)
        moveTo(13.5f, 10f)
        lineTo(13f, 16f)
    }

// ── Previews (tooling-only; the sample copy is never shipped UI) ──────────────────────────────────────────

private const val PREVIEW_ARCHIVE_LABEL = "Archive"
private const val PREVIEW_DELETE_LABEL = "Delete"

@Composable
private fun SwipeRowPreviewRow() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        PanelTitle("Morning commute")
        BodyText("18.4 km · 24 min · 182 Wh/km")
    }
}

@Composable
private fun SwipeRowPreview(
    offsetPx: Float,
    leftAction: SwipeAction? = null,
    rightAction: SwipeAction? = null,
) {
    TeslaSyncTheme(dynamicColor = false) {
        SwipeRowScaffold(
            offsetPx = offsetPx,
            leftAction = leftAction,
            rightAction = rightAction,
            onFireLeft = {},
            onFireRight = {},
            modifier = Modifier.fillMaxWidth(),
        ) {
            SwipeRowPreviewRow()
        }
    }
}

private fun previewArchiveAction(): SwipeAction = SwipeAction(label = PREVIEW_ARCHIVE_LABEL, onAction = {})

private fun previewDeleteAction(): SwipeAction = SwipeAction(label = PREVIEW_DELETE_LABEL, onAction = {}, tone = SwipeTone.Danger)

@Preview(name = "SwipeRow · closed", showBackground = true)
@Composable
private fun SwipeRowClosedPreview() {
    SwipeRowPreview(offsetPx = 0f, leftAction = previewArchiveAction(), rightAction = previewDeleteAction())
}

@Preview(name = "SwipeRow · right action peeked (danger)", showBackground = true)
@Composable
private fun SwipeRowRightPeekPreview() {
    SwipeRowPreview(offsetPx = -ACTION_WIDTH_PX, rightAction = previewDeleteAction())
}

@Preview(name = "SwipeRow · left action peeked (default)", showBackground = true)
@Composable
private fun SwipeRowLeftPeekPreview() {
    SwipeRowPreview(offsetPx = ACTION_WIDTH_PX, leftAction = previewArchiveAction())
}

@Preview(name = "SwipeRow · both actions peeked right", showBackground = true)
@Composable
private fun SwipeRowBothActionsPreview() {
    SwipeRowPreview(
        offsetPx = -ACTION_WIDTH_PX,
        leftAction = previewArchiveAction(),
        rightAction = previewDeleteAction(),
    )
}
