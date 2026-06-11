// File holds the two live-connection wiring composables (drop-ins, no single primary declaration).
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.data.live

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.datadisplay.LiveIndicator
import io.teslasync.android.components.datadisplay.LiveIndicatorVariant
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.data.dataViewModel

/*
 * Drop-in composables that wire the live pipe ([LiveViewModel]) to the A2 connection surfaces, so a
 * page adds live-wire health + a stale warning with one element each and never hand-rolls SSE state
 * (ADR-009). Both bind through `collectAsStateWithLifecycle`, which keeps the shared subscription open
 * only while the screen is at least STARTED — composing with the store's foreground + auth gates.
 */

/**
 * The live-wire health pill/dot for a header, bound to [LiveViewModel.status] with localized labels.
 * Distinct from a per-datum freshness chip: this is the SSE connection's health, not one value's age.
 */
@Composable
fun LiveConnectionIndicator(
    modifier: Modifier = Modifier,
    variant: LiveIndicatorVariant = LiveIndicatorVariant.Pill,
    viewModel: LiveViewModel = dataViewModel(),
) {
    val status by viewModel.status.collectAsStateWithLifecycle()
    val connected = stringResource(R.string.live_status_connected)
    val reconnecting = stringResource(R.string.live_status_reconnecting)
    val offline = stringResource(R.string.live_status_offline)
    val unknown = stringResource(R.string.live_status_unknown)
    LiveIndicator(
        status = status,
        modifier = modifier,
        variant = variant,
        label = { resolved ->
            when (resolved) {
                LiveConnectionStatus.Connected -> connected
                LiveConnectionStatus.Reconnecting -> reconnecting
                LiveConnectionStatus.Disconnected -> offline
                LiveConnectionStatus.Unknown -> unknown
            }
        },
    )
}

/**
 * The page-level ">2 min since live data" warning, bound to [LiveViewModel.isStale]. Renders nothing
 * while the stream is fresh and offers a reconnect action ([LiveViewModel.retry]) when stale — so a page
 * shows a stale/error indicator instead of silently presenting stale values as live.
 */
@Composable
fun LiveStaleBanner(
    modifier: Modifier = Modifier,
    viewModel: LiveViewModel = dataViewModel(),
) {
    val stale by viewModel.isStale.collectAsStateWithLifecycle()
    if (!stale) return
    LiveStaleDataBanner(modifier = modifier, onReconnect = viewModel::retry)
}
