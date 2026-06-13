// The native Jetpack Compose + Material 3 SkipToContent shared surface — a parity port of
// web/src/components/feedback/SkipToContent.tsx, the WCAG 2.4.1 (Bypass Blocks) skip link.
//
// The web source composes `<VisuallyHidden as="a" focusable>` with the localized label
// `t('a11y.skipToContent')`: it is invisible to sighted users, reveals itself when it gains keyboard focus
// (`focus:not-sr-only`), and on activation moves focus + scroll to the page's `<main id="main-content">`
// landmark so a keyboard user skips the 50-plus-item sidebar on every page. It MUST be mounted as the very
// first interactive element so one Tab press surfaces it before any sidebar / header control.
//
// [SkipToContent] reproduces that natively: one focusable, clickable `Role.Button` node that is
// layout-negligible while resting (the native analogue of `sr-only`, still carrying the label in the
// accessibility tree so TalkBack always reads it) and reveals a high-contrast chip while focused (the native
// analogue of `focus:not-sr-only`). On activation it routes through the [SkipTarget] seam to focus the
// host's main-content landmark — and a focused node is brought into view inside a scrollable parent, which
// reproduces the web `scrollIntoView`. The bare a11y primitive (the sibling VisuallyHidden surface) carries
// no activation handler, so this surface adds the focus-move the web `onClick` performs while keeping the same
// hidden-until-focus pattern. Mount it first in the host scaffold, and mark the main content once with
// [Modifier.mainContentAnchor].
//
// The view performs no work of its own: it resolves the i18n label (P1/S10) at the render boundary and routes
// activation + the one-shot `view.opened` diagnostic (P1/S11) through [SkipToContentViewModel] over the
// [SkipTarget] seam (P1/S8). The surface fetches nothing, so it has no loading / empty / error / stale /
// offline lifecycle — its real states are the resting [SkipLinkMode.Hidden] link and the focus-revealed
// [SkipLinkMode.Revealed] chip, both reproduced here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SkipToContent) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content, anchor, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.skiptocontent

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the skip link — the native analogue of the web `data-testid="skip-to-content"`. */
const val SKIP_TO_CONTENT_TEST_TAG: String = "skip-to-content"

/** A layout-negligible footprint for the resting (sr-only) skip link — invisible yet present in the a11y tree. */
private val SKIP_LINK_HIDDEN_SIZE = 1.dp

/**
 * Stateful entry point — the parity port of the web `<SkipToContent />`. Binds the [target] seam through
 * [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first composition, resolves the
 * localized label (web `t('a11y.skipToContent')`), and renders the focus-revealed skip link. Mount it as the
 * first interactive element in the host scaffold so one Tab press surfaces it (web "mount first" contract).
 *
 * @param target the main-content landmark seam; defaults to the process-wide [ProcessSkipTarget].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun SkipToContent(
    modifier: Modifier = Modifier,
    target: SkipTarget = ProcessSkipTarget,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: SkipToContentViewModel =
        viewModel(
            key = SkipToContentRegistration.ID,
            factory = SkipToContentViewModel.factory(target, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val label = stringResource(R.string.translation_a11y_skipToContent)
    SkipToContentContent(label = label, onActivate = viewModel::skipToContent, modifier = modifier)
}

/**
 * Stateless renderer — the test / preview entry point. Draws the skip link as one focusable, clickable
 * `Role.Button` node whose accessible label is [label] in every state (so TalkBack reads it even while the
 * link is visually hidden). The node is layout-negligible while resting ([SkipLinkMode.Hidden], web `sr-only`)
 * and reveals a high-contrast chip while focused ([SkipLinkMode.Revealed], web `focus:not-sr-only`); activating
 * it fires [onActivate] (web `onClick`).
 */
@Composable
fun SkipToContentContent(
    label: String,
    onActivate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val node =
        modifier
            .testTag(SKIP_TO_CONTENT_TEST_TAG)
            .semantics { contentDescription = label }
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClickLabel = label,
                role = Role.Button,
                onClick = onActivate,
            )
    when (skipLinkMode(focused)) {
        SkipLinkMode.Revealed -> RevealedSkipLink(label = label, modifier = node)
        SkipLinkMode.Hidden -> Box(node.size(SKIP_LINK_HIDDEN_SIZE))
    }
}

/**
 * The visible appearance of the focused skip link — a high-contrast chip carrying [label]. Reused by
 * [SkipToContentContent] while focused and exercised directly by the previews, mirroring the sibling
 * VisuallyHidden surface's focus-revealed chip so the two a11y affordances look identical.
 */
@Composable
private fun RevealedSkipLink(
    label: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .background(MaterialTheme.colorScheme.inverseSurface, RoundedCornerShape(Radius.sm))
            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
    ) {
        BodyText(label, color = MaterialTheme.colorScheme.inverseOnSurface)
    }
}

/**
 * Marks the receiver as the host's main-content landmark — the native analogue of
 * `<main id="main-content" tabIndex={-1}>`. Registers a focus action with [target] for as long as the node is
 * composed (clearing it on dispose so a torn-down screen never stays the destination) and makes the node a
 * focus target, so a [SkipToContent] activation moves focus here (and brings it into view inside a scrollable
 * parent, reproducing the web `scrollIntoView`). Apply once to the scaffold's main content slot.
 *
 * @param target the registry the landmark registers with; defaults to the process-wide [ProcessSkipTarget].
 */
@Composable
fun Modifier.mainContentAnchor(target: RegistrySkipTarget = ProcessSkipTarget): Modifier {
    val focusRequester = remember { FocusRequester() }
    DisposableEffect(target, focusRequester) {
        val handle = target.register { runCatching { focusRequester.requestFocus() } }
        onDispose { handle.release() }
    }
    return this
        .focusRequester(focusRequester)
        .focusable()
}

// ── Previews — the resting link is invisible by design (asserted in tests), so these render the focus-revealed
// chip in light and dark, mirroring the sibling VisuallyHidden surface. ───────────────────────────────────────

@Preview(name = "SkipToContent — revealed on focus", showBackground = true)
@Composable
private fun SkipToContentRevealedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RevealedSkipLink(label = "Skip to main content")
    }
}

@Preview(name = "SkipToContent — revealed (dark)", showBackground = true)
@Composable
private fun SkipToContentRevealedDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        RevealedSkipLink(label = "Skip to main content")
    }
}
