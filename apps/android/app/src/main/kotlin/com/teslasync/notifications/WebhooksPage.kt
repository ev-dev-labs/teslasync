// The native Jetpack Compose + Material 3 WebhooksPage notifications surface — a parity port of
// web/src/features/notifications/pages/WebhooksPage.tsx, the dedicated /notifications/webhooks wrapper. Like the
// web page it is a thin promotion wrapper: it sets the page title/subtitle header (web `PageContainer` title +
// subtitle) plus the copy-link affordance (web `copyLink`), and embeds the shared WebhookChannelsSection feature
// view (web `<WebhookChannelsSection />`) verbatim, so the kind=webhook list, the status pill + method chip + per
// row toggle/test/edit/delete, the create/edit modal with its live HMAC X-TeslaSync-Signature preview, the delete
// confirmation, the payload-variables doc box, and every cache-then-network data state (loading skeleton /
// stale-offline / hard-error retry / empty / content) come from that one shared surface — never re-implemented
// here (DRY, ADR-006). Every visible string resolves from the generated res/values catalog (ADR-014); the page
// records the one-shot PII-safe `view.opened` diagnostic for the /notifications/webhooks route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located content + header composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.webhooks

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.webhookchannelssection.WebhookChannelsSection
import io.teslasync.android.featureviews.webhookchannelssection.WebhookChannelsSectionSource
import io.teslasync.android.featureviews.webhookchannelssection.WebhookChannelsSectionViewModel
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Stateful entry point ────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11), constructs the embedded feature
 * view's [WebhookChannelsSectionViewModel] over the supplied [source] (the host wires the shared notifications +
 * notification-channels repositories via
 * [io.teslasync.android.featureviews.webhookchannelssection.webhookChannelsSectionSource]), and renders the header
 * above the shared WebhookChannelsSection. The feature view owns the webhook feed and its own loading / stale /
 * error / empty / content states plus the create/edit/test/signature-preview operations, so this wrapper holds no
 * page-level data of its own. [logger] defaults to the app's redacting logger.
 */
@Composable
fun WebhooksPage(
    source: WebhookChannelsSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordWebhooksPageOpened(logger) }
    val viewModel: WebhookChannelsSectionViewModel =
        viewModel(
            key = WebhooksPageRegistration.SLUG,
            factory = WebhookChannelsSectionViewModel.factory(source, logger),
        )
    WebhooksPageContent(viewModel = viewModel, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The page body: the title/subtitle/copy-link header (web `PageContainer` chrome) above the shared
 * WebhookChannelsSection feature view (web `<WebhookChannelsSection />`). Scrolls vertically so the embedded
 * surface is always reachable on short viewports, mirroring the sibling ChannelsPage / ArchivedPage surfaces. The
 * feature view itself lays out as a non-lazy column, so it composes safely inside the page's scroll container.
 */
@Composable
fun WebhooksPageContent(
    viewModel: WebhookChannelsSectionViewModel,
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
        WebhooksPageHeader()
        WebhookChannelsSection(viewModel = viewModel)
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the title heading, the descriptive subtitle, and
 * the copy-link affordance (web `copyLink`). The copy-link writes the canonical route to the clipboard (the native
 * analogue of copying the current URL).
 */
@Composable
private fun WebhooksPageHeader() {
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
            PageTitle(stringResource(R.string.translation_notifications_webhooks_title))
            BodyText(
                text = stringResource(R.string.translation_notifications_webhooks_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.Copy,
            contentDescription = stringResource(R.string.translation_common_copyLink_action),
            onClick = { clipboard.setText(AnnotatedString(WebhooksPageRegistration.WEB_PATH)) },
            variant = IconButtonVariant.Standard,
        )
    }
}
