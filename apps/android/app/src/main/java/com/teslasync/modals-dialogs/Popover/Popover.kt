// Compose render layer for the Popover modal/dialog surface — the native analogue of the JSX the web component
// returns (web/src/components/ui/Popover.tsx). It is a thin shell over the pure [PopoverProjection] geometry
// (PopoverModel.kt): a focusable Material 3 overlay that anchors caller-supplied [content] to its trigger,
// auto-flips its side and clamps itself inside the viewport via the projection, dismisses on Back / outside-tap
// (the native analogue of the web Esc / click-outside / blur-out), restores focus to the trigger on close, and —
// like the web primitive — is intentionally NOT a focus trap (use the sibling `Modal` for that). It binds no data
// and owns no store; the web component's only React hooks are the positioning effect, so the cache-then-network
// lifecycle lives on the surface that hosts the trigger (see PopoverModel.kt).
//
// Web -> native mapping. The web `useLayoutEffect` measure-then-place + the off-screen `visibility:hidden` pre-pass
// collapse into a single Compose [Popup] with a custom [PopupPositionProvider]: Compose measures the content, then
// the provider feeds the anchor / content / viewport rectangles through [PopoverProjection.resolve] and returns the
// offset, so there is no first-frame flash to hide. Web `createPortal(content, document.body)` -> [Popup] (its own
// window). Web `role="dialog"` + `aria-modal="false"` -> a focusable, non-trapping popup carrying the caller's
// `ariaLabel` as its accessible name. Token mapping (P1/S9, no ported Tailwind): `rounded-lg` -> [Radius.lg];
// `border border-[var(--glass-border)]` -> a 1 dp `outline` border; `bg-[var(--surface-1)]` -> `surface`;
// `text-[var(--text-primary)]` -> `onSurface`; `shadow-xl` -> [Elevation.modal] shadow over an [Elevation.overlay]
// tonal lift; the content inset -> [Spacing.sm].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/modals-dialogs/Popover)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed because the file's primary export is
// the `Popover` composable; the co-located [PopoverSurface] / [PopoverDefaults] / [PopoverTestTags] are supporting
// declarations.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.modalsdialogs.popover

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects (the web `data-testid` equivalents). */
object PopoverTestTags {
    const val CONTENT: String = "popover-content"
}

/** Defaults that mirror the web component's prop defaults. */
object PopoverDefaults {
    /** Web `sideOffset = 6`: the density-independent gap between the anchor and the content. */
    val SideOffset: Dp = 6.dp
}

/**
 * Stateful entry point — the faithful port of the web `Popover({ open, onClose, anchorRef, side, align,
 * sideOffset, ariaLabel, children })`. Emits the one-shot PII-safe `view.opened` diagnostic on each open
 * transition (P1/S11), restores focus to the trigger when it closes (web `anchorRef.current?.focus()`), and hosts
 * the caller's [content] in a focusable [Popup] positioned by [PopoverProjection]. Place it next to its trigger so
 * the [Popup] anchors to that location, exactly as the shared `components/ui/Popover` documents.
 *
 * @param expanded whether the popover content is shown (web `open`).
 * @param onDismissRequest invoked on Back / outside-tap — the native analogue of web Esc / click-outside / blur-out
 *   (web `onClose`); the owner flips [expanded] to false.
 * @param side preferred side relative to the anchor; auto-flips on overflow (web `side`).
 * @param align cross-axis alignment of the content against the anchor (web `align`).
 * @param sideOffset gap between the anchor and the content along the resolved side (web `sideOffset`).
 * @param accessibleName the popover region's accessible name for TalkBack (web `ariaLabel`); null when the content
 *   supplies its own heading.
 * @param anchorFocusRequester optional [FocusRequester] attached to the trigger; focus returns to it on close.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param content the popover body (web `children`).
 */
@Composable
fun Popover(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    side: PopoverSide = PopoverSide.Bottom,
    align: PopoverAlign = PopoverAlign.Start,
    sideOffset: Dp = PopoverDefaults.SideOffset,
    accessibleName: String? = null,
    anchorFocusRequester: FocusRequester? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable ColumnScope.() -> Unit,
) {
    LaunchedEffect(expanded) {
        if (expanded) recordPopoverOpened(logger)
    }
    PopoverFocusRestoration(expanded = expanded, anchorFocusRequester = anchorFocusRequester)

    if (!expanded) return

    val sideOffsetPx = with(LocalDensity.current) { sideOffset.roundToPx() }
    val positionProvider =
        remember(side, align, sideOffsetPx) {
            PopoverPositionProvider(side = side, align = align, sideOffsetPx = sideOffsetPx)
        }

    Popup(
        popupPositionProvider = positionProvider,
        onDismissRequest = onDismissRequest,
        properties =
            PopupProperties(
                focusable = true,
                dismissOnBackPress = true,
                dismissOnClickOutside = true,
            ),
    ) {
        PopoverSurface(modifier = modifier, accessibleName = accessibleName, content = content)
    }
}

/**
 * Stateless surface chrome — the unit/UI-test and preview entry point. Renders the bordered, elevated content box
 * (web `rounded-lg border bg-[var(--surface-1)] text-[var(--text-primary)] shadow-xl`) hosting the caller's
 * [content], carrying the optional [accessibleName] as its TalkBack description. Holds no positioning logic, so it
 * is testable without a [Popup] window.
 */
@Composable
fun PopoverSurface(
    modifier: Modifier = Modifier,
    accessibleName: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier =
            modifier
                .testTag(PopoverTestTags.CONTENT)
                .semantics { accessibleName?.let { contentDescription = it } },
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        tonalElevation = Elevation.overlay,
        shadowElevation = Elevation.modal,
    ) {
        Column(modifier = Modifier.padding(Spacing.sm), content = content)
    }
}

/**
 * Restores focus to the trigger when the popover transitions from open to closed — the native analogue of the web
 * effect that calls `anchorRef.current?.focus()` once the popover unmounts. Best-effort: if no
 * [anchorFocusRequester] is wired (or it is not attached) the call is a no-op, mirroring the web optional chaining.
 */
@Composable
private fun PopoverFocusRestoration(
    expanded: Boolean,
    anchorFocusRequester: FocusRequester?,
) {
    if (anchorFocusRequester == null) return
    var wasExpanded by remember { mutableStateOf(false) }
    LaunchedEffect(expanded) {
        if (expanded) {
            wasExpanded = true
        } else if (wasExpanded) {
            wasExpanded = false
            runCatching { anchorFocusRequester.requestFocus() }
        }
    }
}

/**
 * The [PopupPositionProvider] that drives the [Popup] from the pure [PopoverProjection]. Compose hands it the
 * measured anchor bounds, the window size, and the measured content size; it returns the clamped, auto-flipped
 * offset. Layout direction is intentionally ignored: the web component positions in physical `left` / `right`
 * coordinates, so this port reproduces that physical mapping rather than inventing an RTL mirror the spec lacks.
 */
private class PopoverPositionProvider(
    private val side: PopoverSide,
    private val align: PopoverAlign,
    private val sideOffsetPx: Int,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val placement =
            PopoverProjection.resolve(
                anchor =
                    PopoverRect(
                        left = anchorBounds.left,
                        top = anchorBounds.top,
                        right = anchorBounds.right,
                        bottom = anchorBounds.bottom,
                    ),
                content = PopoverSize(width = popupContentSize.width, height = popupContentSize.height),
                viewport = PopoverSize(width = windowSize.width, height = windowSize.height),
                options = PopoverOptions(side = side, align = align, sideOffset = sideOffsetPx),
            )
        return IntOffset(x = placement.x, y = placement.y)
    }
}

// ── Previews (tooling-only; @Preview entry points exercise the surface chrome) ──────────────────────────

@Preview(name = "Popover surface — anchored menu", showBackground = true, widthDp = 240)
@Composable
private fun PopoverSurfaceMenuPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PopoverSurface(accessibleName = "Sort order") {
            BodyText(text = "Newest first")
            BodyText(text = "Oldest first")
            BodyText(text = "Highest range")
        }
    }
}

@Preview(name = "Popover surface — single value", showBackground = true, widthDp = 240)
@Composable
private fun PopoverSurfaceValuePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PopoverSurface(accessibleName = "Battery detail") {
            BodyText(text = "Estimated 312 km of range remaining")
        }
    }
}
