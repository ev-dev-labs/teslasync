// The native Jetpack Compose + Material 3 Tooltip shared surface — a parity port of
// web/src/components/ui/Tooltip.tsx, together with the only hook it reads (React `useId`, bound through the
// P1/S8 [TooltipIdSource] seam). The web source wraps an arbitrary trigger (`children`) and reveals an
// INVERTED-surface tooltip body carrying `content` on hover OR focus-within OR (touch) tap, placed on one of
// four `side`s, wrapping onto multiple lines when `multiline` is set. The tooltip body has `role="tooltip"`
// and a stable `useId` id that is added to the trigger's `aria-describedby`.
//
// This surface is the native equivalent. All data flows through the shared state holder; the view performs no
// work of its own beyond rendering (ADR-002):
//   • web `useId` → the stable [TooltipViewModel.tooltipId] minted once from the [TooltipIdSource] seam — used
//     as the body's web `id={tooltipId}` (the popup's stable composition key);
//   • web inverted surface (light card / dark text in light mode, dark card / light text in dark mode) →
//     Material 3 `inverseSurface` + `inverseOnSurface` (the same scheme pair Snackbar / RichTooltip use), so
//     the high-contrast inversion holds across light / dark / high-contrast themes (P1/S9), realising the web
//     forced-colors separation through the theme rather than a hand-drawn border;
//   • web `side` (top / bottom / left / right) → a custom [PopupPositionProvider] driven by the pure
//     [tooltipPopupOffset] geometry, honouring all four sides (RTL-mirrored, window-clamped);
//   • web `multiline` (`whitespace-normal max-w-[260px]` vs `whitespace-nowrap`) → [tooltipWraps] /
//     [tooltipMaxLines] / [tooltipMaxWidthDp];
//   • web reveal on `:hover` / `:focus-within` / tap → `hoverable` + `onFocusEvent(hasFocus)` +
//     `combinedClickable`, folded by the pure [tooltipRevealFor];
//   • web `transition-all duration-fast` + `motion-reduce:transition-none` → an `Animatable` fade + scale
//     whose duration collapses to 0 under [rememberReducedMotion] via [tooltipRevealMillis] (web scale-95 →
//     scale-100, opacity-0 → opacity-100);
//   • web `aria-describedby` (the trigger announcing the tooltip after its own name) → a Polite
//     `liveRegion` on the revealed body (the Android idiom; Compose has no `aria-describedby` id-link, so the
//     web join is reproduced + unit-tested in [joinAriaDescribedBy] and realised here via the live region).
//
// States reproduced (the honest set for a presentational tooltip wrapper with no remote read — see
// TooltipModel, covenant #2 / #9): [TooltipReveal] HIDDEN ↔ REVEALED, the four sides, single-line vs
// multiline, LTR / RTL, and the reduced-motion reveal. There is no remote read, so no loading / empty-box /
// error / stale / offline lifecycle is invented. The one-shot `view.opened` diagnostic (P1/S11) is emitted on
// first composition.
//
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, position provider, id-source
// factory, and previews; `InvalidPackageDeclaration` because the mandated surface directory
// (com/teslasync/shared-surfaces/Tooltip) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tooltip

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusEvent
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.MotionEasing
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch

/** The resting scale of the tooltip body before it reveals — the web `scale-95`. */
private const val INITIAL_SCALE: Float = 0.95f

/**
 * A hover / focus / tap tooltip that wraps a [children] trigger and reveals [content] on an inverted surface —
 * the native `Tooltip`. Binds the [TooltipViewModel] over the [idSource] seam (the `useId` boundary), records
 * the one-shot `view.opened` diagnostic (P1/S11), and reveals the tooltip on one of four [side]s, wrapping when
 * [multiline] is set.
 *
 * @param content the tooltip body text (web `content`); already localised by the caller — the surface carries
 *   no copy of its own.
 * @param modifier optional layout modifier for the trigger wrapper.
 * @param side tooltip placement relative to the trigger (web `side`, default top).
 * @param multiline wrap the body onto multiple lines, capped at [TOOLTIP_MAX_WIDTH_DP] (web `multiline`).
 * @param idSource the `useId` seam; defaults to the process-backed production source.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 * @param children the trigger the tooltip describes (web `children`).
 */
@Composable
fun Tooltip(
    content: String,
    modifier: Modifier = Modifier,
    side: TooltipSide = TooltipSide.Top,
    multiline: Boolean = false,
    idSource: TooltipIdSource = rememberTooltipIdSource(),
    logger: Logger = LocalDataContainer.current.logger,
    children: @Composable () -> Unit,
) {
    val viewModel: TooltipViewModel =
        viewModel(
            key = TooltipRegistration.ID,
            factory = TooltipViewModel.factory(idSource, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    TooltipContent(
        content = content,
        tooltipId = viewModel.tooltipId,
        modifier = modifier,
        side = side,
        multiline = multiline,
        children = children,
    )
}

/**
 * Stateless renderer — the test / preview entry point. Wraps the [children] trigger in a hover- / focus- /
 * tap-aware [Box] and reveals the inverted-surface tooltip body on the chosen [side], keyed by the stable
 * [tooltipId] (web `id={tooltipId}`). The reveal is folded from the three inputs by [tooltipRevealFor]; the
 * fade + scale honour [reduceMotion] (web `motion-reduce:transition-none`).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TooltipContent(
    content: String,
    tooltipId: String,
    modifier: Modifier = Modifier,
    side: TooltipSide = TooltipSide.Top,
    multiline: Boolean = false,
    reduceMotion: Boolean = rememberReducedMotion(),
    children: @Composable () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val hovered by interaction.collectIsHoveredAsState()
    var focusWithin by remember { mutableStateOf(false) }
    var pressed by remember { mutableStateOf(false) }
    val revealed = tooltipRevealFor(hovered = hovered, focused = focusWithin, pressed = pressed) == TooltipReveal.Revealed

    val gapPx = with(LocalDensity.current) { Spacing.sm.roundToPx() }
    val positionProvider = remember(side, gapPx) { TooltipPositionProvider(side, gapPx) }
    val revealMs = tooltipRevealMillis(reduceMotion, MotionDurations.fast)

    Box(
        modifier
            .testTag(TooltipRegistration.TRIGGER_TEST_TAG)
            .hoverable(interaction)
            .onFocusEvent { focusWithin = it.hasFocus }
            .combinedClickable(
                interactionSource = interaction,
                indication = null,
                role = Role.Button,
                onClick = { pressed = !pressed },
                onLongClick = { pressed = true },
            ),
        contentAlignment = Alignment.Center,
    ) {
        children()
        if (revealed) {
            key(tooltipId) {
                TooltipPopup(
                    content = content,
                    multiline = multiline,
                    reduceMotion = reduceMotion,
                    revealMs = revealMs,
                    positionProvider = positionProvider,
                    onDismiss = { pressed = false },
                )
            }
        }
    }
}

/**
 * The revealed tooltip in a [Popup] placed by [positionProvider] (the four-side geometry). Animates the body
 * in from [INITIAL_SCALE] / transparent to full size / opaque — an instant cut under [reduceMotion] (web
 * `motion-reduce:transition-none`), a [revealMs] fade + scale otherwise (web `transition-all duration-fast`).
 * The popup is non-focusable so it never steals focus from the trigger (web `pointer-events-none`).
 */
@Composable
private fun TooltipPopup(
    content: String,
    multiline: Boolean,
    reduceMotion: Boolean,
    revealMs: Int,
    positionProvider: PopupPositionProvider,
    onDismiss: () -> Unit,
) {
    val alpha = remember { Animatable(if (reduceMotion) 1f else 0f) }
    val scale = remember { Animatable(if (reduceMotion) 1f else INITIAL_SCALE) }
    LaunchedEffect(Unit) {
        if (!reduceMotion) {
            launch { alpha.animateTo(1f, tween(durationMillis = revealMs, easing = MotionEasing.standard)) }
            scale.animateTo(1f, tween(durationMillis = revealMs, easing = MotionEasing.standard))
        }
    }

    Popup(
        popupPositionProvider = positionProvider,
        onDismissRequest = onDismiss,
        properties = PopupProperties(focusable = false),
    ) {
        TooltipBody(content = content, multiline = multiline, alpha = alpha.value, scale = scale.value)
    }
}

/**
 * The inverted-surface tooltip body — the visual heart of the surface and the preview subject. Draws [content]
 * on a [MaterialTheme]'s `inverseSurface` card with `inverseOnSurface` text (web inverted surface), rounded +
 * shadowed, padded (web `px-2.5 py-1.5`), single-line or wrapping per [multiline] (web `whitespace-nowrap` vs
 * `whitespace-normal max-w-[260px]`). [alpha] / [scale] drive the reveal animation. The body announces itself
 * as a Polite live region (the Android realisation of the web `role="tooltip"` + `aria-describedby`).
 */
@Composable
private fun TooltipBody(
    content: String,
    multiline: Boolean,
    alpha: Float,
    scale: Float,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(Radius.sm)
    val maxWidthDp = tooltipMaxWidthDp(multiline)
    Box(
        modifier
            .graphicsLayer(alpha = alpha, scaleX = scale, scaleY = scale)
            .shadow(elevation = Elevation.overlay, shape = shape, clip = false)
            .background(color = MaterialTheme.colorScheme.inverseSurface, shape = shape)
            .then(if (maxWidthDp != null) Modifier.widthIn(max = maxWidthDp.dp) else Modifier)
            .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
            .testTag(TooltipRegistration.TOOLTIP_TEST_TAG)
            .semantics {
                contentDescription = content
                liveRegion = LiveRegionMode.Polite
            },
    ) {
        Text(
            text = content,
            color = MaterialTheme.colorScheme.inverseOnSurface,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            maxLines = tooltipMaxLines(multiline),
            softWrap = tooltipWraps(multiline),
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Builds (and remembers) the production [TooltipIdSource] — the `useId` seam. Remembered so the same source
 * (and therefore the same minted id) is reused across recompositions of one tooltip.
 */
@Composable
fun rememberTooltipIdSource(): TooltipIdSource = remember { ProcessTooltipIdSource() }

/**
 * The custom [PopupPositionProvider] honouring all four [TooltipSide]s by delegating to the pure
 * [tooltipPopupOffset] geometry (which centres on the trigger's cross axis, offsets by [gapPx] on the main
 * axis, clamps into the window, and mirrors left / right under RTL). [gapPx] is the trigger-to-tooltip spacing
 * in pixels.
 */
private class TooltipPositionProvider(
    private val side: TooltipSide,
    private val gapPx: Int,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val offset =
            tooltipPopupOffset(
                side = side,
                anchorLeft = anchorBounds.left,
                anchorTop = anchorBounds.top,
                anchorWidth = anchorBounds.width,
                anchorHeight = anchorBounds.height,
                popupWidth = popupContentSize.width,
                popupHeight = popupContentSize.height,
                windowWidth = windowSize.width,
                windowHeight = windowSize.height,
                gap = gapPx,
                isRtl = layoutDirection == LayoutDirection.Rtl,
            )
        return IntOffset(offset.x, offset.y)
    }
}

// ── Previews — the revealed body in its honest variants (single-line / multiline, light / dark). Sample copy
// is tooling-only literal text, never shipped UI. ─────────────────────────────────────────────────────────────

@Preview(name = "Tooltip — single line", showBackground = true)
@Composable
private fun TooltipSingleLinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TooltipBody(
            content = "Battery health",
            multiline = false,
            alpha = 1f,
            scale = 1f,
            modifier = Modifier.padding(Spacing.lg),
        )
    }
}

@Preview(name = "Tooltip — multiline (dark)", showBackground = true)
@Composable
private fun TooltipMultilineDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        TooltipBody(
            content = "Energy lost while parked, from cabin overheat protection and sentry mode.",
            multiline = true,
            alpha = 1f,
            scale = 1f,
            modifier = Modifier.padding(Spacing.lg),
        )
    }
}
