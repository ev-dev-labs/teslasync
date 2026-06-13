// The native Jetpack Compose + Material 3 GuardedLink shared surface — a parity port of the web
// navigation guard web/src/components/feedback/GuardedLink.tsx and its data source
// web/src/components/feedback/NavigationGuardProvider.tsx.
//
// [GuardedLink] is the wrapper: it renders a caller-supplied [content] slot as one tappable
// `Role.Button` node and, on tap, reproduces the web `onClick` exactly — run the caller's [onClick]
// (returning `true` cancels, the native analogue of `e.preventDefault()`), bail to a direct navigation
// when [bypassGuard] is set (web modifier / middle-click / `target="_blank"`), else gate the navigation
// behind the bound [NavigationGuard]'s `confirmIfDirty` and run [onNavigate] only if the user discards.
// While the confirmation is open the link dims and stops accepting taps, reproducing the web in-flight
// de-dup. The navigation action is caller-supplied (web `useNavigate`), so the surface never touches a
// NavHostController directly and stays unit-testable.
//
// [NavigationGuardHost] is the consumer mounted once near the host root (web: the provider renders its
// `ConfirmDialog`): it observes the shared guard's pending prompt and renders the shared [ConfirmDialog]
// with the host's already-localized [NavGuardChrome], routing discard / keep-editing back to the guard.
//
// No static copy lives in native code — every rendered string is caller-supplied (the link content, the
// host chrome), exactly as the web component renders `children` and the provider resolves its dialog
// strings from i18n at the boundary. The sample strings in the @Preview functions are tooling-only,
// never shipped UI.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/GuardedLink) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located host + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.guardedlink

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** How far the link is dimmed while its confirmation is open, signalling the busy / blocked state. */
private const val CONFIRMING_ALPHA: Float = 0.6f

/** Full opacity for the idle link. */
private const val FULL_ALPHA: Float = 1f

/**
 * A navigation affordance that guards in-app navigation behind the unsaved-changes confirmation — the
 * native analogue of the web `GuardedLink` / `GuardedNavLink`. Wraps the caller's [content] as one
 * tappable node; on tap it runs [onClick], then [onNavigate] either directly (clean tree or
 * [bypassGuard]) or only after the user discards a blocking guard's unsaved changes.
 *
 * @param onNavigate the navigation action to run when navigation is permitted (web `navigate(to, …)`).
 * @param bypassGuard skip the guard and navigate straight away — the native analogue of the web
 *   modifier / middle-click / `target="_blank"` skip, where no in-tab work is lost.
 * @param enabled when false the link renders its [content] but exposes no click action and is marked
 *   disabled to assistive technologies.
 * @param contentDescription an optional explicit accessibility label merged onto the node; when null the
 *   merged [content] text is the spoken label (web: the link's `children`).
 * @param onClickLabel the localized action announced to assistive technologies on activation.
 * @param onClick an optional pre-navigation callback; returning `true` cancels the navigation, the
 *   native analogue of the web handler calling `e.preventDefault()`.
 * @param key disambiguates this placement's state holder when many links share a call site (e.g. a list
 *   row); defaults to a stable per-placement id.
 * @param guard the shared navigation-guard seam; defaults to the process-wide [ProcessNavigationGuard].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun GuardedLink(
    onNavigate: () -> Unit,
    modifier: Modifier = Modifier,
    bypassGuard: Boolean = false,
    enabled: Boolean = true,
    contentDescription: String? = null,
    onClickLabel: String? = null,
    onClick: (() -> Boolean)? = null,
    key: Any? = null,
    guard: NavigationGuard = ProcessNavigationGuard,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    val instanceKey = rememberSaveable { randomLinkInstanceId() }
    val viewModel: GuardedLinkViewModel =
        viewModel(
            key = "${GuardedLinkRegistration.ID}:${key?.toString() ?: instanceKey}",
            factory = GuardedLinkViewModel.factory(guard, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    GuardedLinkContent(
        state = state,
        onActivate = {
            val cancelled = onClick?.invoke() ?: false
            if (!cancelled) viewModel.attemptNavigation(bypassGuard, onNavigate)
        },
        modifier = modifier,
        enabled = enabled,
        contentDescription = contentDescription,
        onClickLabel = onClickLabel,
        content = content,
    )
}

/**
 * Stateless renderer for a GuardedLink — the test / preview entry point. Draws [content] inside one
 * `Role.Button` node that fires [onActivate] only while interactive (enabled and not mid-confirmation),
 * dims while [GuardedLinkUiState.isConfirming], and exposes an optional [contentDescription] / disabled
 * state to assistive technologies.
 */
@Composable
fun GuardedLinkContent(
    state: GuardedLinkUiState,
    onActivate: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    contentDescription: String? = null,
    onClickLabel: String? = null,
    content: @Composable () -> Unit,
) {
    val interactive = enabled && !state.isConfirming
    val node =
        modifier
            .testTag(GuardedLinkRegistration.ROOT_TEST_TAG)
            .alpha(if (state.isConfirming) CONFIRMING_ALPHA else FULL_ALPHA)
            .then(
                if (interactive) {
                    Modifier.clickable(onClickLabel = onClickLabel, role = Role.Button, onClick = onActivate)
                } else {
                    Modifier
                },
            ).semantics(mergeDescendants = true) {
                if (contentDescription != null) this.contentDescription = contentDescription
                if (!enabled) disabled()
            }
    Box(node) { content() }
}

/**
 * Mounts the shared guard's unsaved-changes confirmation — the native analogue of the web
 * `NavigationGuardProvider`'s `ConfirmDialog`. Observes the bound [guard]'s pending prompt and, while one
 * is open, renders the shared [ConfirmDialog] with the host's already-localized [chrome] (the blocking
 * guard's own message wins, else [NavGuardChrome.fallbackMessage]), routing the discard / keep-editing
 * choice back to the guard. Mount once near the host root; every [GuardedLink] over the same guard then
 * shares this single dialog.
 *
 * @param chrome the already-localized dialog chrome (P1/S10), supplied by the host — never hardcoded here.
 * @param guard the shared navigation-guard seam; defaults to the process-wide [ProcessNavigationGuard].
 */
@Composable
fun NavigationGuardHost(
    chrome: NavGuardChrome,
    modifier: Modifier = Modifier,
    guard: NavigationGuard = ProcessNavigationGuard,
) {
    val prompt by guard.confirmRequest.collectAsStateWithLifecycle()
    val current = prompt
    if (current != null) {
        ConfirmDialog(
            title = chrome.title,
            message = resolvePromptMessage(current, chrome),
            confirmLabel = chrome.discardLabel,
            cancelLabel = chrome.keepEditingLabel,
            onConfirm = { guard.respond(discard = true) },
            onCancel = { guard.respond(discard = false) },
            modifier = modifier.testTag(GuardedLinkRegistration.CONFIRM_DIALOG_TEST_TAG),
            severity = ConfirmSeverity.Warning,
        )
    }
}

// ── Previews (tooling-only; sample strings are never shipped UI) ──────────────────────────────────────

@Preview(name = "GuardedLink — idle", showBackground = true)
@Composable
private fun GuardedLinkIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GuardedLinkContent(
            state = GuardedLinkUiState(isConfirming = false),
            onActivate = {},
            modifier = Modifier.padding(Spacing.md),
        ) {
            BodyText("Open settings")
        }
    }
}

@Preview(name = "GuardedLink — confirming (dimmed)", showBackground = true)
@Composable
private fun GuardedLinkConfirmingPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        GuardedLinkContent(
            state = GuardedLinkUiState(isConfirming = true),
            onActivate = {},
            modifier = Modifier.padding(Spacing.md),
        ) {
            BodyText("Open settings")
        }
    }
}
