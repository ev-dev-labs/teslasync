// The native Jetpack Compose + Material 3 VisuallyHidden shared surface — a parity port of the web
// accessibility primitive web/src/components/a11y/VisuallyHidden.tsx, its data source
// web/src/hooks/useAnnouncer.ts and its consumer web/src/components/a11y/AnnouncerRegion.tsx.
//
// [VisuallyHidden] is the primitive: it renders text that is invisible to sighted users but exposed to
// assistive technologies — the native analogue of Tailwind's `sr-only`, reproduced with a
// layout-negligible node carrying a semantics `contentDescription` (the established RouteAnnouncer
// pattern). `liveRegion` + `priority` map onto Compose `LiveRegionMode` (web `role`/`aria-live`); the
// `focusable` skip-link mode (web `focus:not-sr-only`) is reproduced as a focusable node that reveals
// its content when it gains focus, so a keyboard / D-pad user can reach a "Skip to…" affordance.
//
// [AnnouncerRegion] is the consumer: it binds the [Announcer] seam through [VisuallyHiddenViewModel]
// and renders two visually-hidden live regions (one polite, one assertive), routing each announcement
// to the matching region — the native analogue of the web `AnnouncerRegion`. The regions are siblings
// because some screen readers ignore an `aria-live` value change after the first announcement; keeping
// each region's urgency static avoids that.
//
// No static copy lives in native code — every rendered string is caller-supplied (the announced
// message or the skip-link label), exactly as the web component renders `children`. The sample strings
// in the @Preview functions are tooling-only, never shipped UI.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VisuallyHidden) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located consumer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.visuallyhidden

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** A layout-negligible footprint for a hidden node — small enough to be invisible, present enough to
 * stay in the accessibility tree (the established RouteAnnouncer footprint). */
private val VISUALLY_HIDDEN_SIZE = 1.dp

/**
 * Renders [text] invisibly to sighted users but exposed to assistive technologies — the native analogue
 * of the web `VisuallyHidden` (`sr-only`). By default a layout-negligible node carries [text] as its
 * semantics `contentDescription`.
 *
 * When [liveRegion] is true the node is announced as an `aria-live` region at [priority]
 * ([AnnouncePriority.Polite] waits, [AnnouncePriority.Assertive] interrupts) — change the [text] to fire
 * a screen-reader announcement without showing any visible UI. When [focusable] is true the node joins
 * the focus order and reveals [text] visibly while focused — the native skip-link analogue of the web
 * `focus:not-sr-only` ("Skip to main content").
 */
@Composable
fun VisuallyHidden(
    text: String,
    modifier: Modifier = Modifier,
    liveRegion: Boolean = false,
    priority: AnnouncePriority = AnnouncePriority.Polite,
    focusable: Boolean = false,
) {
    val mode = liveRegionModeFor(priority)
    if (focusable) {
        FocusRevealedVisuallyHidden(text = text, modifier = modifier, liveRegion = liveRegion, mode = mode)
    } else {
        Box(modifier.size(VISUALLY_HIDDEN_SIZE).visuallyHiddenSemantics(text, liveRegion, mode))
    }
}

/**
 * The focus-revealed skip-link variant — a focusable node that is layout-negligible until it gains
 * focus, then reveals [text] visibly (web `focus:not-sr-only`). The semantics `contentDescription`
 * (and the live region, when requested) is present in both states so assistive technologies always read
 * the label, focused or not.
 */
@Composable
private fun FocusRevealedVisuallyHidden(
    text: String,
    modifier: Modifier,
    liveRegion: Boolean,
    mode: LiveRegionMode,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val node =
        modifier
            .focusable(interactionSource = interaction)
            .visuallyHiddenSemantics(text, liveRegion, mode)
    if (focused) {
        RevealedSkipLink(text = text, modifier = node)
    } else {
        Box(node.size(VISUALLY_HIDDEN_SIZE))
    }
}

/**
 * The visible appearance of a focus-revealed skip link — a high-contrast chip carrying the caller's
 * [text]. Reused by [FocusRevealedVisuallyHidden] while focused and exercised directly by the preview.
 */
@Composable
private fun RevealedSkipLink(
    text: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .background(MaterialTheme.colorScheme.inverseSurface, RoundedCornerShape(Radius.sm))
            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
    ) {
        BodyText(text, color = MaterialTheme.colorScheme.inverseOnSurface)
    }
}

/**
 * Mounts the global announcer's two visually-hidden live regions and keeps them current — the native
 * analogue of the web `AnnouncerRegion`. Binds the [announcer] seam through [VisuallyHiddenViewModel],
 * records the one-shot `view.opened` diagnostic, collects the routed [AnnouncerState] and renders it.
 * Mount once near the host root; any feature then fires announcements through [announce].
 *
 * @param announcer the shared announcer seam; defaults to the app-wide [ProcessAnnouncer].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun AnnouncerRegion(
    modifier: Modifier = Modifier,
    announcer: Announcer = ProcessAnnouncer,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: VisuallyHiddenViewModel =
        viewModel(
            key = VisuallyHiddenRegistration.ID,
            factory = VisuallyHiddenViewModel.factory(announcer, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    AnnouncerRegionContent(state = state, modifier = modifier)
}

/**
 * Stateless renderer for the announcer — the test/preview entry point. Draws the polite and assertive
 * live regions as siblings (web `AnnouncerRegion`'s two `VisuallyHidden liveRegion` regions); each
 * voices its current [AnnouncerState] message and stays silent while idle (empty).
 */
@Composable
fun AnnouncerRegionContent(
    state: AnnouncerState,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        VisuallyHidden(text = state.politeMessage, liveRegion = true, priority = AnnouncePriority.Polite)
        VisuallyHidden(text = state.assertiveMessage, liveRegion = true, priority = AnnouncePriority.Assertive)
    }
}

/** Maps the framework-free [AnnouncePriority] onto the Compose live-region urgency. */
private fun liveRegionModeFor(priority: AnnouncePriority): LiveRegionMode =
    when (priority) {
        AnnouncePriority.Polite -> LiveRegionMode.Polite
        AnnouncePriority.Assertive -> LiveRegionMode.Assertive
    }

/**
 * Applies the visually-hidden semantics to a [Modifier]: [text] becomes the node's accessible label and,
 * when [isLiveRegion] is set, the node is announced as a live region at [mode]. Factored out so the
 * default and focus-revealed render paths share one semantics definition.
 */
private fun Modifier.visuallyHiddenSemantics(
    text: String,
    isLiveRegion: Boolean,
    mode: LiveRegionMode,
): Modifier =
    semantics {
        contentDescription = text
        if (isLiveRegion) liveRegion = mode
    }

// ── Previews (tooling-only; sample strings are never shipped UI) ─────────────────────────────────────

@Preview(name = "Skip link — revealed on focus", showBackground = true)
@Composable
private fun RevealedSkipLinkPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RevealedSkipLink(text = "Skip to main content")
    }
}

@Preview(name = "Skip link — revealed (dark)", showBackground = true)
@Composable
private fun RevealedSkipLinkDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        RevealedSkipLink(text = "Skip to navigation")
    }
}
