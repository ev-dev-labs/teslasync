// The native Jetpack Compose + Material 3 TeslaChargingSessionsMap page surface (P3/A7) — the page-prompt's
// `@Composable screen + ViewModel` seam over the shared TeslaChargingSessionsMap feature view
// (io.teslasync.android.featureviews.teslachargingsessionsmap.TeslaChargingSessionsMapContent), itself a full
// parity port of web/src/features/charging/pages/TeslaChargingSessionsMap.tsx. The web source is an unrouted map
// the Fleet Charging Sessions page embeds, so this layer follows the sanctioned thin-wrapper precedent
// (ConditionBuilder / PresetGallery): it embeds the one shared surface verbatim — every map, marker, data state,
// and string is that parity-covered surface — and adds only the page state holder + a stateless screen (DRY,
// ADR-006). It performs NO HTTP and re-implements no rendering.
//
// The map (`MapContainer` + `MapTileLayer`) and the clustered markers (`MarkerCluster`), the "Charging sessions
// map" accessible name (tesla_sessions.mapLabel), the "{{name}} charging session" marker label
// (tesla_sessions.markerLabel), the "Unknown" site fallback (tesla_sessions.unknown), and the empty state all
// live in the embedded feature view; the page screen only resolves the user's currency symbol (web
// `useFormatting`) + locale at the boundary and threads the bound [kotlinx.coroutines.flow.StateFlow] state in.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging — the page
// prompt's allowed-files path) diverges from the `io.teslasync.android.*` package the rest of the app uses.
// `MatchingDeclarationName` is suppressed for the co-located screen + page entry points.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.charging.teslachargingsessionsmap

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.teslachargingsessionsmap.ChargingSessionsCurrencyPrefs
import io.teslasync.android.featureviews.teslachargingsessionsmap.ChargingSessionsSource
import io.teslasync.android.featureviews.teslachargingsessionsmap.TeslaChargingSession
import io.teslasync.android.featureviews.teslachargingsessionsmap.TeslaChargingSessionsMapContent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/**
 * Stateful entry for the TeslaChargingSessionsMap page surface. Builds the
 * [TeslaChargingSessionsMapPageViewModel] from the host-supplied sessions [source] (the web
 * `useTeslaChargingSessions` seam, an adapter over the shared S8
 * [io.teslasync.shared.core.presentation.charging.ChargingStore]), resolves the user's currency symbol from the
 * shared settings store (web `useFormatting`, P1/S8), records the one-shot `view.opened` diagnostic (P1/S11), and
 * binds the stateless screen to the holder's [StateFlow].
 *
 * @param source the cache-then-network sessions seam backing the map (the web `useTeslaChargingSessions` hook).
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the marker cost detail.
 * @param logger the redacting logger backing the surface; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TeslaChargingSessionsMapPage(
    source: ChargingSessionsSource,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val pageViewModel: TeslaChargingSessionsMapPageViewModel =
        viewModel(
            key = TeslaChargingSessionsMapPageRegistration.SLUG,
            factory = TeslaChargingSessionsMapPageViewModel.factory(source, logger),
        )
    LaunchedEffect(pageViewModel) { pageViewModel.recordViewOpened() }
    val state by pageViewModel.state.collectAsStateWithLifecycle()
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { ChargingSessionsCurrencyPrefs.fromSettings(settingsResource.cached) }
    val locale: Locale = LocalConfiguration.current.locales[0]

    TeslaChargingSessionsMapScreen(
        state = state,
        currency = currency,
        locale = locale,
        onRefresh = pageViewModel::refresh,
        modifier = modifier,
    )
}

/**
 * The stateless TeslaChargingSessionsMap page screen. Renders the shared TeslaChargingSessionsMap feature view
 * content ([TeslaChargingSessionsMapContent]) for the supplied [state], so every map, marker, data state
 * (loading skeleton / clustered map / empty "No location data available yet." / lifecycle error-retry +
 * stale-offline chrome), and string is the single parity-covered surface (DRY, ADR-006). The host owns the
 * [StateFlow] behind [state]; this layer adds no rendering of its own.
 *
 * @param state the cache-then-network projection of the fleet charging sessions (web `useTeslaChargingSessions`).
 * @param currency the user's currency symbol preference used by the marker cost detail (web `useFormatting`).
 * @param locale the active locale driving the marker date/number formatting at the display boundary.
 * @param onRefresh re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 */
@Composable
fun TeslaChargingSessionsMapScreen(
    state: UiState<List<TeslaChargingSession>>,
    currency: ChargingSessionsCurrencyPrefs,
    locale: Locale,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    TeslaChargingSessionsMapContent(
        state = state,
        currency = currency,
        locale = locale,
        onRefresh = onRefresh,
        modifier = modifier,
    )
}

// ── Previews (tooling-only; @Preview entry points exercise the screen's loading / empty / error branches; the
// populated clustered map needs Play Services, so — like the feature view's own previews — it is not previewed) ──

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TeslaChargingSessionsMapScreenLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaChargingSessionsMapScreen(
            state = UiState.loading(),
            currency = ChargingSessionsCurrencyPrefs.DEFAULT,
            locale = Locale.US,
            onRefresh = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TeslaChargingSessionsMapScreenEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaChargingSessionsMapScreen(
            state = UiState(UiPhase.Empty, data = emptyList()),
            currency = ChargingSessionsCurrencyPrefs.DEFAULT,
            locale = Locale.US,
            onRefresh = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TeslaChargingSessionsMapScreenErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaChargingSessionsMapScreen(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            currency = ChargingSessionsCurrencyPrefs.DEFAULT,
            locale = Locale.US,
            onRefresh = {},
        )
    }
}
