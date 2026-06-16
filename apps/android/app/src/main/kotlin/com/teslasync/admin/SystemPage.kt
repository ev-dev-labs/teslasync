// The native Jetpack Compose + Material 3 SystemPage admin surface — a parity port of
// web/src/features/admin/pages/SystemPage.tsx, the "infrastructure-budget" operator dashboard at
// /admin/system. Like the web page it is a thin chrome wrapper: it sets the page title/subtitle header (web
// `PageContainer` title + subtitle) and embeds the two shared admin feature views in the same order the web
// `<Stack>` renders them — the RateLimitStatusPanel (web `<RateLimitStatusPanel />`) and the QueueStatusPanel
// (web `<QueueStatusPanel />`) — so every throttle/budget row, the heartbeat-severity worker cards, and the
// full cache-then-network loading/empty/error/stale state matrix come from those two shared surfaces and are
// never re-implemented here (DRY, ADR-006).
//
// The rate-limit panel self-fetches from the shared S8 SystemStore via its `RateLimitStatusPanel(systemStore)`
// overload. The worker-queue panel is host-driven: the [SystemPageViewModel] owns its `GET /system/queues`
// feed as a [UiState] and the selected-worker drawer target the web `QueueStatusPanel` keeps in local state,
// so clicking a worker card opens the shared per-worker [QueueJobDrawer] (web `<QueueJobDrawer>`), hosted here
// exactly as the web component hosts it inline. Every visible string resolves from the generated res/values
// catalog (ADR-014); the page records the one-shot PII-safe `view.opened` diagnostic for /admin/system
// (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located stateless content + header composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.system

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.queuestatuspanel.QueueStatusPanel
import io.teslasync.android.featureviews.ratelimitstatuspanel.RateLimitStatusPanel
import io.teslasync.android.modalsdialogs.queuejobdrawer.QueueJobDrawer
import io.teslasync.android.modalsdialogs.queuejobdrawer.QueueJobDrawerViewModel
import io.teslasync.android.modalsdialogs.queuejobdrawer.queueJobDrawerSource
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.system.SystemStore
import io.teslasync.shared.core.presentation.systemqueues.QueueStatusResponse
import io.teslasync.shared.core.presentation.systemqueues.SystemQueuesStore

/**
 * Stateful entry — the faithful port of the web `SystemPage`. Builds the page [SystemPageViewModel] over the
 * worker-queue seam and the per-worker [QueueJobDrawerViewModel] over the shared S8 [systemQueuesStore],
 * records the one-shot `view.opened` diagnostic (P1/S11), and collects the queue feed + drawer target. The
 * rate-limit panel binds the shared [systemStore] directly through its self-fetching overload. No HTTP
 * touches the view.
 */
@Composable
fun SystemPage(
    systemStore: SystemStore,
    systemQueuesStore: SystemQueuesStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val source = remember(systemQueuesStore) { systemQueuesStore.asSystemPageSource() }
    val drawerSource = remember(systemQueuesStore) { queueJobDrawerSource(systemQueuesStore) }

    val viewModel: SystemPageViewModel =
        viewModel(
            key = SystemPageRegistration.SLUG,
            factory = SystemPageViewModel.factory(source, logger),
        )
    val drawerViewModel: QueueJobDrawerViewModel =
        viewModel(
            key = SystemPageRegistration.DRAWER_KEY,
            factory = QueueJobDrawerViewModel.factory(drawerSource, logger),
        )

    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val queueState by viewModel.queueState.collectAsStateWithLifecycle()
    val selectedWorker by viewModel.selectedWorker.collectAsStateWithLifecycle()

    SystemPageContent(
        systemStore = systemStore,
        queueState = queueState,
        selectedWorker = selectedWorker,
        drawerViewModel = drawerViewModel,
        onRefreshQueues = viewModel::refresh,
        onOpenWorker = viewModel::openWorker,
        onCloseWorker = viewModel::closeWorker,
        modifier = modifier,
    )
}

/**
 * The stateless page body — the title/subtitle header (web `PageContainer` chrome) above the shared
 * RateLimitStatusPanel + QueueStatusPanel feature views, in the web `<Stack>` order, with the per-worker
 * [QueueJobDrawer] hosted as an overlay gated on [selectedWorker]. Scrolls vertically so the embedded panels
 * are always reachable on short viewports, mirroring the sibling admin surfaces.
 */
@Composable
fun SystemPageContent(
    systemStore: SystemStore,
    queueState: UiState<QueueStatusResponse>,
    selectedWorker: String?,
    drawerViewModel: QueueJobDrawerViewModel,
    onRefreshQueues: () -> Unit,
    onOpenWorker: (String) -> Unit,
    onCloseWorker: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
    ) {
        SystemPageHeader()
        FadeIn {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl2)) {
                RateLimitStatusPanel(systemStore = systemStore)
                QueueStatusPanel(
                    state = queueState,
                    onRefresh = onRefreshQueues,
                    onOpenWorker = onOpenWorker,
                )
            }
        }
    }

    QueueJobDrawer(
        open = selectedWorker != null,
        worker = selectedWorker,
        onClose = onCloseWorker,
        viewModel = drawerViewModel,
        displayName = selectedWorker,
    )
}

/** The page header: the title + subtitle the web `PageContainer` renders (web `system.page.*`). */
@Composable
private fun SystemPageHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_system_page_title))
        BodyText(
            stringResource(R.string.translation_system_page_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
