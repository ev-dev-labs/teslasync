// The native Jetpack Compose + Material 3 ConflictWarnings page surface (P3/A7) — the page-prompt's
// `@Composable screen + ViewModel` seam over the shared ConflictWarnings feature view
// (io.teslasync.android.featureviews.conflictwarnings.ConflictWarningsContent), itself a full parity port of
// web/src/features/automations/pages/ConflictWarnings.tsx. The web source is an unrouted, purely presentational
// fragment the Automation builder renders inline (prop: `conflicts`; no data hook), so this layer follows the
// sanctioned thin-wrapper precedent (AutomationCard / ConditionBuilder): it embeds the one shared surface
// verbatim — every banner + string is that parity-covered surface — and adds only the page state holder + a
// stateless screen (DRY, ADR-006). It performs NO HTTP and re-implements no rendering.
//
// Data states (manifest: empty · error): the embedded `ConflictWarningsContent` is web-faithful — it renders the
// banner stack for content and nothing for an empty list (web `return null`). The manifest additionally requires
// this page surface to carry the standard loading / empty / error chrome, so the stateless [ConflictWarningsScreen]
// switches on the bound `UiState<List<AutomationConflict>>`: a first-load [Spinner], an [EmptyState] when there
// are no conflicts, an [ErrorDisplay] + Retry on a hard failure, and otherwise the embedded shared content. Every
// chrome string resolves from the generated i18n catalog (common loading / no-data / retry + the server-error
// copy), so there is no English literal in this file; the lone parity string ("Potential Conflict",
// automations.builder.conflict) is rendered by the embedded feature view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations — the
// page prompt's allowed-files path) diverges from the `io.teslasync.android.*` package the rest of the app uses.
// `MatchingDeclarationName` is suppressed for the co-located screen + page entry points.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.conflictwarnings.AutomationConflict
import io.teslasync.android.featureviews.conflictwarnings.ConflictWarningsContent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry for the ConflictWarnings page surface. Builds the [ConflictWarningsPageViewModel] from the
 * host-supplied [conflicts] (the web `conflicts` prop / navigation arg), records the one-shot `view.opened`
 * diagnostic (P1/S11), and binds the stateless screen to the holder's [kotlinx.coroutines.flow.StateFlow].
 *
 * @param conflicts the automation conflicts to surface (web `conflicts`); an empty list renders the empty state.
 * @param modifier the layout modifier applied to the surface.
 * @param logger the redacting logger backing the surface; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ConflictWarningsPage(
    conflicts: List<AutomationConflict>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val pageViewModel: ConflictWarningsPageViewModel =
        viewModel(
            key = ConflictWarningsPageRegistration.SLUG,
            factory = ConflictWarningsPageViewModel.factory(conflicts, logger),
        )
    LaunchedEffect(pageViewModel) { pageViewModel.recordViewOpened() }
    val state by pageViewModel.state.collectAsStateWithLifecycle()
    ConflictWarningsScreen(
        state = state,
        modifier = modifier,
        onRetry = pageViewModel::retry,
    )
}

/**
 * The stateless ConflictWarnings page screen — the unit/preview entry point. Switches on the bound
 * [state] to render the standard data-state chrome around the shared feature view: a first-load [Spinner], an
 * [EmptyState] when there are no conflicts, an [ErrorDisplay] + Retry on a hard failure, and otherwise the
 * embedded parity-covered [ConflictWarningsContent] (every banner + the "Potential Conflict" string). The host
 * owns the [kotlinx.coroutines.flow.StateFlow] behind [state] and the [onRetry] callback; this layer adds no
 * rendering of its own beyond the shared chrome components.
 *
 * @param state the host-supplied conflicts projected onto the loading / empty / error / content surface.
 * @param onRetry re-runs the host's load — wired to the hard-error retry affordance.
 */
@Composable
fun ConflictWarningsScreen(
    state: UiState<List<AutomationConflict>>,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    when {
        state.isLoading -> ConflictWarningsLoading(modifier)
        state.isError -> ConflictWarningsError(onRetry = onRetry, modifier = modifier)
        state.isEmpty -> ConflictWarningsEmpty(modifier)
        else -> ConflictWarningsContent(conflicts = state.data ?: emptyList(), modifier = modifier)
    }
}

/** First-load spinner so the surface is never a blank box while the host resolves its conflicts. */
@Composable
private fun ConflictWarningsLoading(modifier: Modifier = Modifier) {
    Spinner(
        modifier = modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** Empty surface — shown when there are no conflicts, so the page is never a blank region. */
@Composable
private fun ConflictWarningsEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = TeslaGlyphs.Check,
        modifier = modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ConflictWarningsError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxWidth(),
    )
}

// ── Previews (tooling-only; each @Preview exercises one data-state branch of the screen) ─────────────────────

private val PREVIEW_CONFLICTS =
    listOf(
        AutomationConflict(
            automationId = 12,
            automationName = "Precondition at 7am",
            reason = "Overlaps with \"Nightly charge to 80%\" on the same trigger window.",
            severity = "warning",
        ),
        AutomationConflict(
            automationId = 34,
            automationName = "Arrive-home lights",
            reason = "Shares a geofence trigger with another enabled automation.",
            severity = "info",
        ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun ConflictWarningsScreenContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConflictWarningsScreen(state = UiState(UiPhase.Content, data = PREVIEW_CONFLICTS))
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ConflictWarningsScreenEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConflictWarningsScreen(state = UiState(UiPhase.Empty))
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ConflictWarningsScreenErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConflictWarningsScreen(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network))
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ConflictWarningsScreenLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConflictWarningsScreen(state = UiState.loading())
    }
}
