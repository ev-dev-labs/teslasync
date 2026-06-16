// The native Jetpack Compose + Material 3 InboxPage notifications surface — a parity port of
// web/src/features/notifications/pages/InboxPage.tsx, the top-level Notifications inbox scoped to the active
// (non-archived) items. It reproduces the web page's PageContainer chrome (the title, the descriptive subtitle,
// the copy-link affordance, and the "View archived" action) and then renders the shared A3 [InboxBody] with
// `archived=false`, exactly as the web page reuses <InboxBody archived={false}/> so the bulk-action set offers
// Archive (not Restore) and the grouped/flat toggle is available.
//
// Composition mirrors the sibling ArchivedPage: [InboxPage] is the stateful entry (constructs the view-model
// over the host-wired source, records the one-shot `view.opened` diagnostic, collects the two inbox feeds +
// resolves the two forward-navigation seams); [InboxPageContent] is the stateless render layer driven entirely
// by the two [UiState]s + [InboxPageActions] + the two navigation callbacks. Every visible string resolves from
// the generated res/values catalog (ADR-014). All derivation lives in the framework-free model
// (InboxPageModel.kt, reusing the sibling join helpers) and the loading / empty / error / content / stale
// surfaces are owned by the bound InboxBody; this file only resolves i18n + draws the header.
//
// Forward navigation is the web `<Link to="/notifications/archived">` (the action) and the empty-state CTA
// `to:'/notifications/studio'`. No `LocalNavController` is exposed to page hosts (the GlancePage / ArchivedPage
// precedent), so these route through the [DeepLinkRouter] — the same sanctioned seam the notification-tap
// handler feeds into Navigation-Compose — keeping the surface unit-testable (the callbacks are hoisted).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located actions DTO + header.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.inbox

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
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The page's interaction callbacks, wired to the [InboxPageViewModel] (web event handlers + InboxBody mutations). */
data class InboxPageActions(
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
 * Stateful entry: constructs the [InboxPageViewModel] over the supplied [source] (the host wires the shared
 * notifications repository + the shared VehiclesStore via [inboxPageSourceOf]). [logger] defaults to the app's
 * redacting logger.
 */
@Composable
fun InboxPage(
    source: InboxPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: InboxPageViewModel =
        viewModel(
            key = InboxPageRegistration.SLUG,
            factory = viewModelFactory { initializer { InboxPageViewModel(source, logger) } },
        )
    InboxPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: binds the [viewModel] feeds to the stateless content, records the one-shot diagnostic, and
 * resolves the two forward navigations (the "View archived" action and the empty-state "Configure alert rules"
 * CTA) through the [DeepLinkRouter] — the sanctioned page-host navigation seam (no `LocalNavController` is
 * exposed to hosts; this mirrors the GlancePage / ArchivedPage precedent), the native analogue of the web
 * `<Link to="/notifications/archived">` and `actionTo={{ to: '/notifications/studio' }}`.
 */
@Composable
fun InboxPage(
    viewModel: InboxPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val flatState by viewModel.flatState.collectAsStateWithLifecycle()
    val groupState by viewModel.groupState.collectAsStateWithLifecycle()

    val router = LocalDeepLinkRouter.current
    val onViewArchived: () -> Unit =
        remember(router) { { router?.request(InboxPageRegistration.archivedDeepLink) ?: Unit } }
    val onConfigureRules: () -> Unit =
        remember(router) { { router?.request(InboxPageRegistration.studioDeepLink) ?: Unit } }

    val actions =
        remember(viewModel) {
            InboxPageActions(
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

    InboxPageContent(
        flatState = flatState,
        groupState = groupState,
        actions = actions,
        onViewArchived = onViewArchived,
        onConfigureRules = onConfigureRules,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title + subtitle + copy-link + "View archived" action) above the shared
 * [InboxBody] bound with `archived=false`. The InboxBody owns every data state (loading skeleton / hard-error
 * retry / inbox empty / content / stale-offline) for the two feeds, so this layer never renders a blank region.
 * Grouped is the default view on the Inbox tab; auto-mark-read-on-open is enabled (web `markOnOpen`); the
 * empty-state CTA routes to the rules studio via [onConfigureRules].
 */
@Composable
fun InboxPageContent(
    flatState: UiState<List<InboxNotification>>,
    groupState: UiState<List<InboxGroup>>,
    actions: InboxPageActions,
    onViewArchived: () -> Unit,
    onConfigureRules: () -> Unit,
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
        InboxPageHeader(onViewArchived = onViewArchived)

        InboxBody(
            archived = false,
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
            markOnOpen = true,
            onConfigureRules = onConfigureRules,
        )
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the [title] heading, the descriptive
 * [subtitle], the copy-link affordance (web `copyLink`), and the "View archived" action (web `actions`). The
 * copy-link writes the canonical route to the clipboard (the native analogue of copying the current URL); the
 * action forwards to the Archive tab via [onViewArchived].
 */
@Composable
private fun InboxPageHeader(onViewArchived: () -> Unit) {
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
            PageTitle(stringResource(R.string.translation_notifications_inbox_title))
            BodyText(
                text = stringResource(R.string.translation_notifications_inbox_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.Copy,
            contentDescription = stringResource(R.string.translation_common_copyLink_action),
            onClick = { clipboard.setText(AnnotatedString(InboxPageRegistration.WEB_PATH)) },
            variant = IconButtonVariant.Standard,
        )
        Button(
            label = stringResource(R.string.translation_notifications_inbox_viewArchived),
            onClick = onViewArchived,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = InboxPageGlyphs.Archive,
        )
    }
}
