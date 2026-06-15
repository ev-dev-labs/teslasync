// The native Jetpack Compose + Material 3 PrivacyPage settings surface — a parity port of
// web/src/features/settings/pages/PrivacyPage.tsx, the dedicated /account/privacy wrapper. Like the web
// page it is a thin promotion wrapper: it sets the page title/subtitle header (web `PageContainer` title +
// subtitle) plus the copy-link affordance (web `copyLink`), and embeds the shared PrivacySection feature
// view (web `<PrivacySection />`) verbatim, so the shield header, the "Recently viewed pages" clear control
// (with its irreversible-clear confirmation), the tri-state cookies/analytics consent control (re-grant /
// withdraw / reset), the `require_cookie_consent` policy sentence, and every data state (loading skeleton /
// version stale-offline / error-retry / content) come from that one shared surface — never re-implemented
// here (DRY, ADR-006). Every visible string resolves from the generated res/values catalog (ADR-014); the
// page records the one-shot PII-safe `view.opened` diagnostic for the /account/privacy route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located content + header composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.privacy

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
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.privacy.PrivacySection
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Stateful entry point ────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11) and renders the header above
 * the shared PrivacySection feature view. The feature view is fully self-wiring — it resolves the
 * client-side recent-pages + cookie-consent SharedPreferences stores and the shared
 * [io.teslasync.shared.core.presentation.settings.SettingsStore] version-policy feed from the composition
 * locals, owns its loading / stale / error / content states, and records its own `view.opened` — so this
 * wrapper holds no page-level data of its own. [logger] defaults to the app's redacting logger.
 */
@Composable
fun PrivacyPage(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordPrivacyPageOpened(logger) }
    PrivacyPageContent(modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────

/**
 * The page body: the title/subtitle/copy-link header (web `PageContainer` chrome) above the shared
 * PrivacySection feature view (web `<PrivacySection />`). Scrolls vertically so the embedded surface is
 * always reachable on short viewports, mirroring the sibling ChannelsPage / WebhooksPage surfaces. The
 * feature view itself lays out as a non-lazy GlassPanel column, so it composes safely inside the page's
 * scroll container.
 */
@Composable
fun PrivacyPageContent(modifier: Modifier = Modifier) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PrivacyPageHeader()
        PrivacySection()
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the title heading, the descriptive
 * subtitle, and the copy-link affordance (web `copyLink`). The copy-link writes the canonical route to the
 * clipboard (the native analogue of copying the current URL).
 */
@Composable
private fun PrivacyPageHeader() {
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
            PageTitle(stringResource(R.string.translation_account_privacy_title))
            BodyText(
                text = stringResource(R.string.translation_account_privacy_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.Copy,
            contentDescription = stringResource(R.string.translation_common_copyLink_action),
            onClick = { clipboard.setText(AnnotatedString(PrivacyPageRegistration.WEB_PATH)) },
            variant = IconButtonVariant.Standard,
        )
    }
}
