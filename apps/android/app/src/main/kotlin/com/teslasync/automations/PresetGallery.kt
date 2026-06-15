// The native Jetpack Compose + Material 3 PresetGallery page surface (P3/A7) — the page-prompt's
// `@Composable screen + ViewModel` seam over the shared PresetGallery feature view
// (io.teslasync.android.featureviews.presetgallery.PresetGalleryContent), itself a full parity port of
// web/src/features/automations/pages/PresetGallery.tsx. The web source is an unrouted card grid the Automations
// builder embeds, so this layer follows the sanctioned thin-wrapper precedent (ConditionBuilder / AutomationCard):
// it embeds the one shared surface verbatim — every panel, string, and data state is that parity-covered surface —
// and adds only the page state holder + a stateless screen (DRY, ADR-006). It performs NO HTTP and re-implements
// no rendering.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations — the
// page prompt's allowed-files path) diverges from the `io.teslasync.android.*` package the rest of the app
// uses. `MatchingDeclarationName` is suppressed for the co-located screen + page entry points.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.presetgallery.AutomationPresetData
import io.teslasync.android.featureviews.presetgallery.PresetGalleryContent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry for the PresetGallery page surface. Builds the [PresetGalleryPageViewModel] from the
 * host-supplied preset [source] (the web `useAutomationPresets` seam, an adapter over the shared S8
 * [io.teslasync.shared.core.presentation.automations.AutomationsStore]), records the one-shot `view.opened`
 * diagnostic (P1/S11), and binds the stateless screen to the holder's [kotlinx.coroutines.flow.StateFlow]. The
 * install navigation stays caller-owned (web `navigate('/automations/new?preset=' + id)`): each card's install
 * is reported through [onInstall].
 *
 * @param source the cache-then-network preset seam backing the gallery (the web `useAutomationPresets` hook).
 * @param onInstall fires the host's navigation for a preset id (web `navigate('/automations/new?preset=…')`).
 * @param logger the redacting logger backing the surface; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PresetGalleryPage(
    source: PresetGallerySource,
    onInstall: (presetId: String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val pageViewModel: PresetGalleryPageViewModel =
        viewModel(
            key = PresetGalleryPageRegistration.SLUG,
            factory = PresetGalleryPageViewModel.factory(source, logger),
        )
    LaunchedEffect(pageViewModel) { pageViewModel.recordViewOpened() }
    val state by pageViewModel.state.collectAsStateWithLifecycle()
    PresetGalleryScreen(
        state = state,
        onInstall = onInstall,
        modifier = modifier,
        onRetry = pageViewModel::refresh,
    )
}

/**
 * The stateless PresetGallery page screen. Renders the shared PresetGallery feature view content
 * ([PresetGalleryContent]) for the supplied [state], so every panel, string, and data state
 * (loading skeletons / empty / card grid, plus the lifecycle error-retry + stale/offline chrome) is the single
 * parity-covered surface (DRY, ADR-006). The host owns the [kotlinx.coroutines.flow.StateFlow] behind [state]
 * and the [onInstall] callback; this layer adds no rendering of its own.
 *
 * @param state the cache-then-network projection of the preset templates (web `useAutomationPresets`).
 * @param onInstall fires the host's navigation for a preset id (web `navigate('/automations/new?preset=…')`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 */
@Composable
fun PresetGalleryScreen(
    state: UiState<List<AutomationPresetData>>,
    onInstall: (presetId: String) -> Unit,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    PresetGalleryContent(
        state = state,
        onInstall = onInstall,
        onRetry = onRetry,
        modifier = modifier,
    )
}

// ── Previews (tooling-only; @Preview entry points exercise the screen's content / empty / loading branches) ──

private val PREVIEW_PRESETS =
    listOf(
        AutomationPresetData(
            id = "sentry-on-arrival",
            name = "Sentry on arrival",
            description = "Arm Sentry Mode whenever the car is left at an unknown location.",
            icon = "ShieldCheck",
            triggerKinds = listOf("trigger_geofence"),
            actionCount = 2,
        ),
        AutomationPresetData(
            id = "precondition-morning",
            name = "Morning precondition",
            description = "Warm the cabin to a comfortable temperature on weekday mornings before the commute.",
            icon = "Sun",
            triggerKinds = listOf("trigger_schedule"),
            actionCount = 3,
        ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun PresetGalleryScreenContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PresetGalleryScreen(
            state = UiState(UiPhase.Content, data = PREVIEW_PRESETS),
            onInstall = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun PresetGalleryScreenEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PresetGalleryScreen(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onInstall = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun PresetGalleryScreenLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PresetGalleryScreen(
            state = UiState.loading(),
            onInstall = {},
        )
    }
}
