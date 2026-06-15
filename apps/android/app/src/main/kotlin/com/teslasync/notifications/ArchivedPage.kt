// The native Jetpack Compose + Material 3 ArchivedPage notifications surface — a parity port of
// web/src/features/notifications/pages/ArchivedPage.tsx, the notifications inbox scoped to archived items. It
// reproduces the web page's PageContainer chrome (the title, the descriptive subtitle, the copy-link
// affordance, and the "Back to inbox" action) and then renders the shared A3 [InboxBody] with `archived=true`,
// exactly as the web page reuses <InboxBody archived/> so the bulk-action set swaps Archive for Restore.
//
// Composition mirrors the sibling FeedbackQueuePage: [ArchivedPage] is the stateful entry (constructs the
// view-model over the host-wired source, records the one-shot `view.opened` diagnostic, collects the two
// inbox feeds + resolves the back-navigation seam); [ArchivedPageContent] is the stateless render layer driven
// entirely by the two [UiState]s + [ArchivedPageActions]. Every visible string resolves from the generated
// res/values catalog (ADR-014). All derivation lives in the framework-free model (ArchivedPageModel.kt) and
// the loading / empty / error / content / stale surfaces are owned by the bound InboxBody; this file only
// resolves i18n + draws the header.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located actions DTO + header.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.archived

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.inboxbody.InboxBody
import io.teslasync.android.featureviews.inboxbody.InboxGroup
import io.teslasync.android.featureviews.inboxbody.InboxNotification
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The page's interaction callbacks, wired to the [ArchivedPageViewModel] (web event handlers + InboxBody mutations). */
data class ArchivedPageActions(
    val onRefresh: () -> Unit,
    val onMarkRead: (List<Long>) -> Unit,
    val onMarkUnread: (List<Long>) -> Unit,
    val onArchive: (List<Long>) -> Unit,
    val onUnarchive: (List<Long>) -> Unit,
    val onDelete: (List<Long>) -> Unit,
    val onBulkMarkRead: (List<Long>) -> Unit,
    val onMarkAllRead: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ArchivedPageViewModel] over the supplied [source] (the host wires the shared
 * notifications repository + the shared VehiclesStore via [archivedPageSourceOf]). [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun ArchivedPage(
    source: ArchivedPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ArchivedPageViewModel =
        viewModel(
            key = ArchivedPageRegistration.SLUG,
            factory = viewModelFactory { initializer { ArchivedPageViewModel(source, logger) } },
        )
    ArchivedPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: binds the [viewModel] feeds to the stateless content, records the one-shot diagnostic, and
 * resolves the "Back to inbox" navigation through the system back-dispatcher — the sanctioned page-host
 * navigation seam (no `LocalNavController` is exposed to hosts; this mirrors the GlancePage precedent), the
 * native analogue of the web `<Link to="/notifications/inbox">`.
 */
@Composable
fun ArchivedPage(
    viewModel: ArchivedPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val flatState by viewModel.flatState.collectAsStateWithLifecycle()
    val groupState by viewModel.groupState.collectAsStateWithLifecycle()

    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    val onBackToInbox: () -> Unit = remember(backDispatcher) { { backDispatcher?.onBackPressed() ?: Unit } }

    val actions =
        remember(viewModel) {
            ArchivedPageActions(
                onRefresh = viewModel::refresh,
                onMarkRead = viewModel::onMarkRead,
                onMarkUnread = viewModel::onMarkUnread,
                onArchive = viewModel::onArchive,
                onUnarchive = viewModel::onUnarchive,
                onDelete = viewModel::onDelete,
                onBulkMarkRead = viewModel::onBulkMarkRead,
                onMarkAllRead = viewModel::onMarkAllRead,
            )
        }

    ArchivedPageContent(
        flatState = flatState,
        groupState = groupState,
        actions = actions,
        onBackToInbox = onBackToInbox,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title + subtitle + copy-link + back action) above the shared
 * [InboxBody] bound with `archived=true`. The InboxBody owns every data state (loading skeleton / hard-error
 * retry / archived empty / content / stale-offline) for the two feeds, so this layer never renders a blank
 * region. The flat list is the active surface on the Archive tab (grouping is disabled when archived).
 */
@Composable
fun ArchivedPageContent(
    flatState: UiState<List<InboxNotification>>,
    groupState: UiState<List<InboxGroup>>,
    actions: ArchivedPageActions,
    onBackToInbox: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        ArchivedPageHeader(onBackToInbox = onBackToInbox)

        InboxBody(
            archived = true,
            flatState = flatState,
            groupState = groupState,
            onRefresh = actions.onRefresh,
            onMarkRead = actions.onMarkRead,
            onMarkUnread = actions.onMarkUnread,
            onArchive = actions.onArchive,
            onUnarchive = actions.onUnarchive,
            onDelete = actions.onDelete,
            onBulkMarkRead = actions.onBulkMarkRead,
            onMarkAllRead = actions.onMarkAllRead,
            markOnOpen = false,
            onConfigureRules = null,
        )
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the [title] heading, the descriptive
 * [subtitle], the copy-link affordance (web `copyLink`), and the "Back to inbox" action (web `actions`). The
 * copy-link writes the canonical route to the clipboard (the native analogue of copying the current URL).
 */
@Composable
private fun ArchivedPageHeader(onBackToInbox: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            PageTitle(stringResource(R.string.translation_notifications_archived_title))
            BodyText(
                text = stringResource(R.string.translation_notifications_archived_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.Copy,
            contentDescription = stringResource(R.string.translation_common_copyLink_action),
            onClick = { clipboard.setText(AnnotatedString(ArchivedPageRegistration.WEB_PATH)) },
            variant = IconButtonVariant.Standard,
        )
        Button(
            label = stringResource(R.string.translation_notifications_archived_backToInbox),
            onClick = onBackToInbox,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.ChevronLeft,
        )
    }
}
