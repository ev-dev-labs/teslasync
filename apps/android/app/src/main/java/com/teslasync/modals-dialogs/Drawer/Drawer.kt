// The native Jetpack Compose + Material 3 Drawer modal/dialog — a parity port of the web `Drawer`
// (web/src/components/ui/Drawer.tsx). The web component is a generic slide-in side panel: a focus-trapped
// overlay with a blurred scrim, a spring slide-in from the left or right edge, an optional title header with a
// close button, a scrollable body, and an optional footer. This port reproduces every one of those branches
// with native primitives.
//
// Every render decision flows through the pure [DrawerProjection] + [DrawerDisplay] (DrawerModel.kt); the
// composable is a thin layer that gates composition, animates the overlay, and renders. The only strings are
// resolved from the i18n catalog (P1/S10) — the generic `translation_common_close` for the close affordance
// and the surface-owned `translation_drawer_panelLabel` for the title-less fallback name — so there is no
// English literal in this file. The one-shot `view.opened` diagnostic (P1/S11) is emitted as the drawer opens.
//
// Web `open` prop -> host-gated composition: the web returns `null` while closed; the Compose idiom prescribed
// by the shared `components/ui/Modal` KDoc is `if (open) Drawer(...)`, so the stateful [Drawer] returns before
// composing the overlay whenever `open` is false — a faithful map of the web `if (!open) return null`.
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the web full-screen `fixed inset-0` overlay maps to a
// platform [Dialog] (`usePlatformDefaultWidth = false`) — which supplies the focus trap, the system-back
// dismissal (the web Escape handler), and return-focus-on-close that the web wires up by hand; the
// `bg-[var(--surface-overlay)] backdrop-blur-sm` scrim maps to a `colorScheme.scrim` fill (CSS blur has no
// faithful Compose analogue, so a slightly heavier alpha stands in); the `glass-panel rounded-none border-0`
// sheet maps to a square-cornered tonal [Surface] (`Elevation.modal`) with a hairline on its inner edge (web
// `border-l` / `border-r`); the `max-w-md` width cap maps to [DRAWER_MAX_WIDTH]; the header `border-b` and
// footer `border-t` map to [HorizontalDivider]; web `px-6 py-4` / `p-6` insets map to `Spacing` tokens. The
// physical left/right `side` maps to the RTL-aware logical Start/End edges (Android-idiomatic), and the slide
// direction is derived from the resolved physical edge so it stays correct under a right-to-left layout.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/Drawer) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.drawer

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.MotionEasing
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects (the web `data-testid` equivalents). */
object DrawerTestTags {
    const val ROOT: String = "drawer"
    const val SCRIM: String = "drawer-scrim"
    const val PANEL: String = "drawer-panel"
    const val TITLE: String = "drawer-title"
    const val CLOSE: String = "drawer-close"
    const val BODY: String = "drawer-body"
    const val FOOTER: String = "drawer-footer"
}

/** The web `max-w-md` (28rem) width cap; the sheet fills narrower screens and caps here on wide ones. */
private val DRAWER_MAX_WIDTH = 448.dp

/** Scrim opacity over `colorScheme.scrim` — a touch heavier than the web tint to stand in for `backdrop-blur`. */
private const val SCRIM_ALPHA = 0.6f

/** Width of the sheet's inner-edge hairline (web `border-l` / `border-r`, `border-white/[0.06]`). */
private val EDGE_HAIRLINE_WIDTH = 1.dp

/** Resolves every [DrawerStrings] entry from the catalog (P1/S10): generic close + surface-owned panel name. */
@Composable
fun rememberDrawerStrings(): DrawerStrings =
    DrawerStrings(
        close = stringResource(R.string.translation_common_close),
        panel = stringResource(R.string.translation_drawer_panelLabel),
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `Drawer({ open, onClose, title, children, footer,
 * side })`. Returns immediately when [open] is false (web `if (!open) return null`); otherwise resolves the
 * localized chrome, projects the render decision, records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), and presents the overlay in a focus-trapping platform [Dialog].
 *
 * @param open whether the drawer is shown; the owning view toggles it (web `open`).
 * @param onClose dismissal handler invoked by the scrim tap, the close button, and system back / Escape (web
 *   `onClose`).
 * @param title optional header title; a `null`/empty value renders no header (web `title`).
 * @param side the edge the panel anchors to and slides in from (web `side`, default end/right).
 * @param footer optional footer slot pinned below the scrollable body (web `footer`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param content the scrollable drawer body (web `children`).
 */
@Composable
fun Drawer(
    open: Boolean,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    side: DrawerSide = DrawerSide.DEFAULT,
    footer: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (!open) return

    val strings = rememberDrawerStrings()
    val display =
        remember(title, side, footer != null, strings.panel) {
            DrawerProjection.project(title = title, side = side, hasFooter = footer != null, panelFallback = strings.panel)
        }
    LaunchedEffect(Unit) { recordDrawerOpened(logger) }

    Dialog(
        onDismissRequest = onClose,
        properties =
            DialogProperties(
                usePlatformDefaultWidth = false,
                dismissOnBackPress = true,
                dismissOnClickOutside = false,
            ),
    ) {
        DrawerOverlay(
            display = display,
            strings = strings,
            title = title,
            onClose = onClose,
            footer = footer,
            modifier = modifier,
            content = content,
        )
    }
}

/**
 * The animated overlay inside the [Dialog] window: the tap-to-dismiss scrim and the edge-anchored sheet that
 * slides in from the resolved physical edge. Owns the appear transition and the web's "focus the first
 * focusable on open" behaviour (the close button), keeping the stateless [DrawerSheet] trivially testable.
 */
@Composable
private fun DrawerOverlay(
    display: DrawerDisplay,
    strings: DrawerStrings,
    title: String?,
    onClose: () -> Unit,
    footer: (@Composable () -> Unit)?,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val isRtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val anchorEnd = display.side == DrawerSide.End
    // `Alignment.CenterEnd` already mirrors with RTL; the slide offset is physical, so derive its sign here.
    val physicalRight = anchorEnd != isRtl
    val alignment = if (anchorEnd) Alignment.CenterEnd else Alignment.CenterStart

    val visibleState = remember { MutableTransitionState(initialState = false) }
    visibleState.targetState = true

    val closeFocus = remember { FocusRequester() }
    LaunchedEffect(display.showHeader) {
        if (display.showHeader) runCatching { closeFocus.requestFocus() }
    }

    Box(
        modifier =
            modifier
                .fillMaxSize()
                .testTag(DrawerTestTags.ROOT)
                .semantics { paneTitle = display.accessibleName },
    ) {
        AnimatedVisibility(
            visibleState = visibleState,
            enter = fadeIn(tween(MotionDurations.normal, easing = MotionEasing.standard)),
            exit = fadeOut(tween(MotionDurations.fast, easing = MotionEasing.accelerate)),
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.scrim.copy(alpha = SCRIM_ALPHA))
                        .testTag(DrawerTestTags.SCRIM)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClickLabel = strings.close,
                            role = Role.Button,
                            onClick = onClose,
                        ),
            )
        }

        AnimatedVisibility(
            visibleState = visibleState,
            modifier = Modifier.align(alignment),
            enter =
                slideInHorizontally(tween(MotionDurations.normal, easing = MotionEasing.decelerate)) { full ->
                    if (physicalRight) full else -full
                } + fadeIn(tween(MotionDurations.normal)),
            exit =
                slideOutHorizontally(tween(MotionDurations.fast, easing = MotionEasing.accelerate)) { full ->
                    if (physicalRight) full else -full
                } + fadeOut(tween(MotionDurations.fast)),
        ) {
            DrawerSheet(
                display = display,
                strings = strings,
                title = title,
                onClose = onClose,
                physicalRight = physicalRight,
                footer = footer,
                closeFocus = closeFocus,
                content = content,
            )
        }
    }
}

/**
 * Stateless renderer — the preview + UI-test entry point. The square-cornered, edge-hairlined sheet that hosts
 * the optional title header (title + close button, web `{title && (...)}`), the scrollable body (web
 * `flex-1 overflow-y-auto`), and the optional footer (web `{footer && (...)}`).
 *
 * @param physicalRight whether the sheet sits on the physical right edge; selects the inner-hairline side.
 * @param closeFocus optional requester the overlay uses to focus the close button on open (web first-focus);
 *   `null` in previews/tests so the stateless renderer carries no focus side effect.
 */
@Composable
fun DrawerSheet(
    display: DrawerDisplay,
    strings: DrawerStrings,
    title: String?,
    onClose: () -> Unit,
    physicalRight: Boolean,
    modifier: Modifier = Modifier,
    footer: (@Composable () -> Unit)? = null,
    closeFocus: FocusRequester? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val hairlineColor = MaterialTheme.colorScheme.outlineVariant
    Surface(
        modifier =
            modifier
                .fillMaxHeight()
                .widthIn(max = DRAWER_MAX_WIDTH)
                .fillMaxWidth()
                .testTag(DrawerTestTags.PANEL),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.modal,
        shape = RectangleShape,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .drawBehind {
                        val strokeWidth = EDGE_HAIRLINE_WIDTH.toPx()
                        val x = if (physicalRight) 0f else size.width - strokeWidth
                        drawRect(color = hairlineColor, topLeft = Offset(x, 0f), size = Size(strokeWidth, size.height))
                    },
        ) {
            if (display.showHeader && title != null) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = Spacing.lg, vertical = Spacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SectionTitle(
                        title,
                        modifier =
                            Modifier
                                .weight(1f)
                                .testTag(DrawerTestTags.TITLE),
                    )
                    IconButton(
                        imageVector = TeslaGlyphs.Close,
                        contentDescription = strings.close,
                        onClick = onClose,
                        modifier =
                            Modifier
                                .then(if (closeFocus != null) Modifier.focusRequester(closeFocus) else Modifier)
                                .testTag(DrawerTestTags.CLOSE),
                        size = IconSize.Md,
                    )
                }
                HorizontalDivider(color = hairlineColor)
            }

            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(Spacing.lg)
                        .testTag(DrawerTestTags.BODY),
                content = content,
            )

            if (display.showFooter && footer != null) {
                HorizontalDivider(color = hairlineColor)
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(horizontal = Spacing.lg, vertical = Spacing.md)
                            .testTag(DrawerTestTags.FOOTER),
                ) {
                    footer()
                }
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise the chrome branches) ─────────────────────────────

private val previewStrings = DrawerStrings(close = "Close", panel = "Panel")

@Preview(name = "End side: title + footer", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun DrawerEndWithChromePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrawerSheet(
            display =
                DrawerDisplay(
                    side = DrawerSide.End,
                    showHeader = true,
                    showFooter = true,
                    accessibleName = "Filters",
                ),
            strings = previewStrings,
            title = "Filters",
            onClose = {},
            physicalRight = true,
            footer = {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Button(label = "Reset", onClick = {}, variant = ButtonVariant.Secondary)
                    Button(label = "Apply", onClick = {}, variant = ButtonVariant.Primary)
                }
            },
        ) {
            BodyText("Pick the metrics and date range to narrow the dashboard.")
        }
    }
}

@Preview(name = "Start side: no title, no footer", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun DrawerStartNoChromePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrawerSheet(
            display =
                DrawerDisplay(
                    side = DrawerSide.Start,
                    showHeader = false,
                    showFooter = false,
                    accessibleName = "Panel",
                ),
            strings = previewStrings,
            title = null,
            onClose = {},
            physicalRight = false,
        ) {
            BodyText("A title-less panel still exposes an accessible pane name to TalkBack.")
        }
    }
}
