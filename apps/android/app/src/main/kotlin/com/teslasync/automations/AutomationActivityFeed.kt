// The native Jetpack Compose + Material 3 AutomationActivityFeed A7 page surface — the routed/host-mounted
// presentation of the web page web/src/features/automations/pages/AutomationActivityFeed.tsx. The web
// component is an unrouted, purely presentational sub-surface (it is embedded in the Automations page and
// receives its data as props), so this page is a thin host: it binds the page's local snapshot through the
// [AutomationActivityFeedViewModel] (P1/S8) and renders the shared A3 feature view verbatim (DRY, ADR-006),
// so the always-on header (Activity glyph + "Recent Activity" + the Live/Reconnecting connection chip + the
// run-summary stats), the most-recent live SSE events, and every history data state (loading skeleton,
// content rows, friendly empty state, and the host-feed error/retry chrome) all come from that one shared
// surface — never re-implemented here. Every visible string resolves from the generated res/values catalog
// (ADR-014) inside the feature view; the page records the one PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations.activityfeed

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.automationactivityfeed.AutomationActivityData
import io.teslasync.android.featureviews.automationactivityfeed.AutomationActivityFeedContent
import io.teslasync.android.featureviews.automationactivityfeed.AutomationLiveEvent
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry: constructs the [AutomationActivityFeedViewModel] over the supplied [source] (the host wires
 * the local-state seam), keyed by the surface slug so it is scoped to this page. [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun AutomationActivityFeedPage(
    source: AutomationActivityFeedSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: AutomationActivityFeedViewModel =
        viewModel(
            key = AutomationActivityFeedPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AutomationActivityFeedViewModel(source, logger) } },
        )
    AutomationActivityFeedPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic, establishes the local snapshot ([load]), and
 * binds the three render flows (history [UiState] + live SSE events + connection state) to the stateless body.
 */
@Composable
fun AutomationActivityFeedPage(
    viewModel: AutomationActivityFeedViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) {
        viewModel.recordViewOpened()
        viewModel.load()
    }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val liveEvents by viewModel.liveEvents.collectAsStateWithLifecycle()
    val connectionState by viewModel.connectionState.collectAsStateWithLifecycle()

    AutomationActivityFeedPageContent(
        state = state,
        liveEvents = liveEvents,
        connectionState = connectionState,
        onRetry = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * The stateless page body: a scrolling container around the shared A3 feature view, which draws the single
 * GlassPanel with the header, live events, and every history data state. The web component renders no page
 * title of its own (it is an embedded sub-surface), so this host adds only the scroll + padding chrome a
 * standalone screen needs and delegates the rest to the feature view.
 */
@Composable
fun AutomationActivityFeedPageContent(
    state: UiState<AutomationActivityData>,
    liveEvents: List<AutomationLiveEvent>,
    connectionState: LiveConnectionStatus,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
    ) {
        AutomationActivityFeedContent(
            state = state,
            liveEvents = liveEvents,
            connectionState = connectionState,
            onRetry = onRetry,
        )
    }
}
