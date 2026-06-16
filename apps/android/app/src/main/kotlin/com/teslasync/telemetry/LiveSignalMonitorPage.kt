// The native Jetpack Compose + Material 3 LiveSignalMonitorPage telemetry surface — a parity port of
// web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx. The web page is a thin `PageContainer` wrapper:
// a title (liveMonitor.title) + subtitle (liveMonitor.subtitle), a trailing actions cluster pairing the global
// `<VehicleSelect />` scope picker with a live-connection `Badge`
// (liveMonitor.connected / liveMonitor.disconnected, success ⁄ danger), over the shared `LiveSignalTail` — the
// scrolling SSE signal tail driven by `useLiveSignalStream` (tailMax 500). This native surface reproduces that
// composition end to end with platform-idiomatic primitives: the shared `PageTitle`/`HelperText` typography, the
// store-bound `VehicleSelect` shared surface, the shared `Badge`, and the already-built `LiveSignalTail` feature
// view — which owns the firehose buffer, the four stat cards, the filter + Pause/Auto-scroll/Clear controls, the
// five-column table, and its own loading / empty / error / stale data states. Every visible string resolves
// through the i18n catalog (ADR-014); the header badge carries a TalkBack description; values stay raw SI
// (Phase-42) and the view performs no HTTP.
//
// Composition: [LiveSignalMonitorPage] is the stateful entry (constructs the view-model over the host-wired
// source, records the one-shot `view.opened` diagnostic, collects the resolved connection state) and
// [LiveSignalMonitorPageContent] is the stateless render layer (the header chrome + the live tail). The page's
// own data source is the SSE connection slice for the badge; the tail binds the same single stream itself
// (ADR-009 — one subscription), so the stream is never opened twice.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.livesignalmonitor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.livesignaltail.LiveSignalTail
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [LiveSignalMonitorPageViewModel] over the supplied [source] (the host wires the
 * shared app-scoped live pipeline via [liveSignalMonitorPageSource]). [logger] defaults to the app's redacting
 * logger.
 */
@Composable
fun LiveSignalMonitorPage(
    source: LiveSignalMonitorPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: LiveSignalMonitorPageViewModel =
        viewModel(
            key = LiveSignalMonitorPageRegistration.SLUG,
            factory = viewModelFactory { initializer { LiveSignalMonitorPageViewModel(source, logger) } },
        )
    LiveSignalMonitorPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] connection state to the stateless content + the one-shot diagnostic. */
@Composable
fun LiveSignalMonitorPage(
    viewModel: LiveSignalMonitorPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    LiveSignalMonitorPageContent(state = state, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the page chrome (title + subtitle + the live-connection badge + the global
 * vehicle-scope picker) followed by the always-visible [LiveSignalTail], which renders its own full state matrix
 * (loading / empty / error / stale) internally so no region ever collapses to a blank box.
 */
@Composable
fun LiveSignalMonitorPageContent(
    state: LiveMonitorUiState,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        LiveSignalMonitorHeader(connected = state.connected)
        // web `<LiveSignalTail … bufferMax={TAIL_MAX} />` — the shared SSE tail binds the single stream itself.
        LiveSignalTail(bufferMax = LIVE_MONITOR_TAIL_MAX)
    }
}

/**
 * The page chrome — the title + muted subtitle (web `PageContainer` `title`/`subtitle`) paired with the live
 * connection badge, then the global `<VehicleSelect />` scope picker (web `actions` cluster). The badge sits on
 * the title row (web's right-aligned actions); the picker spans the width below, the established mobile idiom.
 */
@Composable
private fun LiveSignalMonitorHeader(connected: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                PageTitle(
                    stringResource(R.string.translation_liveMonitor_title),
                    modifier = Modifier.semantics { heading() },
                )
                HelperText(stringResource(R.string.translation_liveMonitor_subtitle))
            }
            LiveConnectionBadge(connected = connected)
        }
        // web `actions={<VehicleSelect />}` — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/**
 * The live-connection chip — web `<Badge variant={live.connected ? 'success' : 'danger'} dot>`: a success
 * (Connected) / danger (Disconnected) dot-badge whose text + accessible description resolve from the
 * `liveMonitor.connected` / `liveMonitor.disconnected` catalog keys.
 */
@Composable
private fun LiveConnectionBadge(connected: Boolean) {
    val text =
        if (connected) {
            stringResource(R.string.translation_liveMonitor_connected)
        } else {
            stringResource(R.string.translation_liveMonitor_disconnected)
        }
    Badge(
        text = text,
        modifier = Modifier.semantics { contentDescription = text },
        variant = if (connected) BadgeVariant.Success else BadgeVariant.Danger,
        dot = true,
    )
}
