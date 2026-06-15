// The native Jetpack Compose + Material 3 ConditionBuilder page surface (P3/A7) — the page-prompt's
// `@Composable screen + ViewModel` seam over the shared ConditionBuilder feature view
// (io.teslasync.android.featureviews.conditionbuilder.ConditionBuilderContent), itself a full parity port of
// web/src/features/automations/pages/ConditionBuilder.tsx. The web source is an unrouted, controlled
// sub-component the Automation builder embeds (props: `conditions` + `onChange`; one data hook, useGeofences),
// so this layer follows the sanctioned thin-wrapper precedent (AutomationCard): it embeds the one shared
// surface verbatim — every panel, string, and data state is that parity-covered surface — and adds only the
// page state holder + a stateless screen (DRY, ADR-006). It performs NO HTTP and re-implements no rendering.
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
import io.teslasync.android.featureviews.conditionbuilder.ConditionBuilderContent
import io.teslasync.android.featureviews.conditionbuilder.ConditionBuilderSource
import io.teslasync.android.featureviews.conditionbuilder.ConditionInput
import io.teslasync.android.featureviews.conditionbuilder.ConditionKind
import io.teslasync.android.featureviews.conditionbuilder.createDefaultCondition
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.Geofence

/**
 * Stateful entry for the ConditionBuilder page surface. Builds the [ConditionBuilderPageViewModel] from the
 * host-supplied geofence [source] (the web `useGeofences` seam, an adapter over the shared S8 Locations data
 * layer), records the one-shot `view.opened` diagnostic (P1/S11), and binds the stateless screen to the
 * holder's [kotlinx.coroutines.flow.StateFlow]. The conditions list stays caller-owned (web
 * `ConditionBuilderProps`): [conditions] is rendered as-is and every edit is reported through [onChange].
 *
 * @param conditions the current condition list (owned by the parent, like the web `conditions` prop).
 * @param onChange invoked with the next condition list on every edit (web `onChange`).
 * @param source the cache-then-network geofence seam backing the geofence-condition dropdown.
 * @param logger the redacting logger backing the surface; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ConditionBuilderPage(
    conditions: List<ConditionInput>,
    onChange: (List<ConditionInput>) -> Unit,
    source: ConditionBuilderSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val pageViewModel: ConditionBuilderPageViewModel =
        viewModel(
            key = ConditionBuilderPageRegistration.SLUG,
            factory = ConditionBuilderPageViewModel.factory(source, logger),
        )
    LaunchedEffect(pageViewModel) { pageViewModel.recordViewOpened() }
    val state by pageViewModel.state.collectAsStateWithLifecycle()
    ConditionBuilderScreen(
        state = state,
        conditions = conditions,
        onChange = onChange,
        modifier = modifier,
        onRefresh = pageViewModel::refresh,
    )
}

/**
 * The stateless ConditionBuilder page screen. Renders the shared ConditionBuilder feature view content
 * ([ConditionBuilderContent]) for the supplied geofence [state] and caller-owned [conditions], so every
 * panel, string, and data state (loading / content / stale-offline / error chrome over the fence feed, plus
 * the surface's own "no conditions yet" empty state) is the single parity-covered surface (DRY, ADR-006). The
 * host owns the [kotlinx.coroutines.flow.StateFlow] behind [state] and the [onChange] callback; this layer
 * adds no rendering of its own.
 *
 * @param state the cache-then-network geofence projection driving the freshness/offline chrome + dropdown options.
 * @param conditions the caller-owned condition list rendered by the embedded surface.
 * @param onChange invoked with the next condition list on every edit (add / remove / field change).
 * @param onRefresh re-runs the host's geofence load — wired to the freshness chip and the offline retry.
 */
@Composable
fun ConditionBuilderScreen(
    state: UiState<List<Geofence>>,
    conditions: List<ConditionInput>,
    onChange: (List<ConditionInput>) -> Unit,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    ConditionBuilderContent(
        state = state,
        conditions = conditions,
        onChange = onChange,
        onRefresh = onRefresh,
        modifier = modifier,
    )
}

// ── Previews (tooling-only; @Preview entry points exercise the screen's content + empty-conditions branches) ──

private val PREVIEW_GEOFENCES =
    listOf(
        Geofence(
            id = 1,
            name = "Home",
            polygonWkt = "POLYGON((0 0,0 1,1 1,1 0,0 0))",
            category = "home",
            enabled = true,
            createdAt = "2026-06-11T12:00:00Z",
            updatedAt = "2026-06-11T12:00:00Z",
            latitude = 37.42,
            longitude = -122.08,
            radius = 120.0,
        ),
        Geofence(
            id = 2,
            name = "Office",
            polygonWkt = "POLYGON((2 2,2 3,3 3,3 2,2 2))",
            category = "work",
            enabled = true,
            createdAt = "2026-06-11T12:00:00Z",
            updatedAt = "2026-06-11T12:00:00Z",
            latitude = 37.49,
            longitude = -122.14,
            radius = 90.0,
        ),
    )

private val PREVIEW_CONDITIONS =
    listOf(
        createDefaultCondition(ConditionKind.Signal),
        createDefaultCondition(ConditionKind.Geofence),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun ConditionBuilderScreenContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConditionBuilderScreen(
            state = UiState(UiPhase.Content, data = PREVIEW_GEOFENCES),
            conditions = PREVIEW_CONDITIONS,
            onChange = {},
        )
    }
}

@Preview(name = "No conditions", showBackground = true)
@Composable
private fun ConditionBuilderScreenEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConditionBuilderScreen(
            state = UiState(UiPhase.Content, data = PREVIEW_GEOFENCES),
            conditions = emptyList(),
            onChange = {},
        )
    }
}
