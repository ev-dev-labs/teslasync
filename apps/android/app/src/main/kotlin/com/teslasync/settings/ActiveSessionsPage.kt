// The native Jetpack Compose + Material 3 ActiveSessionsPage settings surface — a parity port of
// web/src/features/settings/pages/ActiveSessionsPage.tsx, the dedicated /account/sessions wrapper promoted out
// of the Settings "security" section into a first-class Account route. Like the web page it is a thin promotion
// wrapper: it sets the PageContainer chrome (web `title` + `subtitle` + the `copyLink` affordance) and embeds the
// shared A3 ActiveSessionsSection feature view verbatim (web `<ActiveSessionsSection />`), so the loading
// spinner, the AUTH_MODE_OPEN advisory, the forward-auth DataTable, the per-row + bulk revoke, both confirm
// dialogs, the empty state, and the stale/offline + retry surface all come from that one shared surface — never
// re-implemented here (DRY, ADR-006).
//
// Composition mirrors the sibling ArchivedPage: [ActiveSessionsPage] is the stateful entry (constructs the
// view-model over the host-wired source, records the one-shot page `view.opened` diagnostic, and collects the
// feed + the two in-flight revoke flags); [ActiveSessionsPageContent] is the stateless render layer driven by the
// feed [UiState] + the [ActiveSessionsPageActions]. Every visible string resolves from the generated res/values
// catalog (ADR-014); the section feed binds to the cross-platform P1/S8 SessionsStore, so this file only resolves
// i18n, draws the header, and hands the feed to the embedded section.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located actions DTO + header.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.sessions

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
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.activesessionssection.ActiveSessionsData
import io.teslasync.android.featureviews.activesessionssection.ActiveSessionsSection
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The page's interaction callbacks, wired to the [ActiveSessionsPageViewModel] (web revoke mutations + retry). */
data class ActiveSessionsPageActions(
    val onRevoke: (String) -> Unit,
    val onRevokeAllOthers: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ActiveSessionsPageViewModel] over the supplied [source] (the host wires the
 * shared sessions repository via [activeSessionsPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun ActiveSessionsPage(
    source: ActiveSessionsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ActiveSessionsPageViewModel =
        viewModel(
            key = ActiveSessionsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { ActiveSessionsPageViewModel(source, logger) } },
        )
    ActiveSessionsPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot page diagnostic, collects the feed [UiState] + the two in-flight revoke
 * flags, and binds the revoke/retry callbacks before handing them to the stateless content.
 */
@Composable
fun ActiveSessionsPage(
    viewModel: ActiveSessionsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val revokingId by viewModel.revokingId.collectAsStateWithLifecycle()
    val revokingAll by viewModel.revokingAll.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            ActiveSessionsPageActions(
                onRevoke = viewModel::revoke,
                onRevokeAllOthers = viewModel::revokeAllOthers,
                onRetry = viewModel::refresh,
            )
        }

    ActiveSessionsPageContent(
        state = state,
        revokingId = revokingId,
        revokingAll = revokingAll,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle/copy-link header (web `PageContainer` chrome) above the shared
 * [ActiveSessionsSection] feature view (web `<ActiveSessionsSection />`). The section owns every data state
 * (loading / open-mode advisory / content / empty / stale-offline + retry) for the active-sessions feed, so this
 * layer never renders a blank region. Scrolls vertically so the embedded surface is always reachable on short
 * viewports, mirroring the sibling ChannelsPage / ArchivedPage surfaces.
 */
@Composable
fun ActiveSessionsPageContent(
    state: UiState<ActiveSessionsData>,
    revokingId: String?,
    revokingAll: Boolean,
    actions: ActiveSessionsPageActions,
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
        ActiveSessionsPageHeader()

        ActiveSessionsSection(
            state = state,
            onRevoke = actions.onRevoke,
            onRevokeAllOthers = actions.onRevokeAllOthers,
            onRetry = actions.onRetry,
            modifier = Modifier.fillMaxWidth(),
            revokingId = revokingId,
            revokingAll = revokingAll,
        )
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the title heading, the descriptive subtitle,
 * and the copy-link affordance (web `copyLink`). The copy-link writes the canonical route to the clipboard (the
 * native analogue of copying the current URL).
 */
@Composable
private fun ActiveSessionsPageHeader() {
    val clipboard = LocalClipboardManager.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PageTitle(stringResource(R.string.translation_settings_account_sessions_title))
            BodyText(
                text = stringResource(R.string.translation_settings_account_sessions_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.Copy,
            contentDescription = stringResource(R.string.translation_common_copyLink_action),
            onClick = { clipboard.setText(AnnotatedString(ActiveSessionsPageRegistration.WEB_PATH)) },
            variant = IconButtonVariant.Standard,
        )
    }
}
