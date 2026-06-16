// The native Jetpack Compose + Material 3 BrowserNotificationsPage notifications surface — a parity port of
// web/src/features/notifications/pages/BrowserNotificationsPage.tsx, the dedicated /notifications/browser
// wrapper. Like the web page it is a thin promotion wrapper: it sets the page title/subtitle header (web
// `PageContainer` title + subtitle) and embeds the shared NotificationSettings feature view (web
// `<NotificationSettings />`) verbatim, so the browser-permission action, the per-event push toggles, the
// browser-tab-signal toggles, the notification-sound channels, and every cache-then-network data state
// (loading / stale / error-retry / content) for the `/settings` document come from that one shared surface —
// never re-implemented here (DRY, ADR-006). Every visible string resolves from the generated res/values
// catalog (ADR-014); the page records the one-shot PII-safe `view.opened` diagnostic for the
// /notifications/browser route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.browser

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.notificationsettings.NotificationSettings
import io.teslasync.android.featureviews.notificationsettings.NotificationSettingsSource
import io.teslasync.android.featureviews.notificationsettings.NotificationSettingsViewModel
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry: constructs the embedded [NotificationSettingsViewModel] over the supplied [source] (the host
 * wires the shared `/settings` repository + the device-local preference stores + the cue player). The
 * view-model is keyed by this surface's slug so it is scoped to the /notifications/browser navigation entry.
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun BrowserNotificationsPage(
    source: NotificationSettingsSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: NotificationSettingsViewModel =
        viewModel(
            key = BrowserNotificationsPageRegistration.SLUG,
            factory = NotificationSettingsViewModel.factory(source, logger),
        )
    BrowserNotificationsPage(viewModel = vm, modifier = modifier, logger = logger)
}

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11) and binds the embedded
 * NotificationSettings feature view to the stateless content. The feature view owns the `/settings` document
 * feed and its own loading / stale / error / content states, so this wrapper holds no page-level data of its
 * own.
 */
@Composable
fun BrowserNotificationsPage(
    viewModel: NotificationSettingsViewModel,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordBrowserNotificationsPageOpened(logger) }
    BrowserNotificationsPageContent(viewModel = viewModel, modifier = modifier)
}

/**
 * The stateless page body: the title/subtitle header (web `PageContainer` chrome) above the shared
 * NotificationSettings feature view (web `<NotificationSettings />`). Scrolls vertically so the embedded panel
 * is always reachable on short viewports, mirroring the sibling A7 surfaces.
 */
@Composable
fun BrowserNotificationsPageContent(
    viewModel: NotificationSettingsViewModel,
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
        BrowserNotificationsHeader()
        NotificationSettings(viewModel = viewModel)
    }
}

/**
 * The page header: the title + subtitle the web `PageContainer` renders
 * (web `notifications.browser.title` / `notifications.browser.subtitle`).
 */
@Composable
private fun BrowserNotificationsHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_notifications_browser_title))
        BodyText(
            stringResource(R.string.translation_notifications_browser_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
