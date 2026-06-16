// The native Jetpack Compose + Material 3 TwoFactorAuthPage account-security surface — a parity port of
// web/src/features/settings/pages/TwoFactorAuthPage.tsx, the dedicated /account/2fa wrapper. Like the web page it
// is a thin promotion wrapper: it sets the page title/subtitle header (web `PageContainer` title + subtitle) plus
// the copy-link affordance (web `copyLink`), and embeds the shared TOTPEnrollmentSection feature view (web
// `<TOTPEnrollmentSection />`) verbatim, so the enroll/verify/disable/regenerate flow, the QR + manual-secret +
// 6-digit verify modal, the backup-codes reveal, the typed-confirmation disable dialog, and every cache-then-network
// data state (loading / open-mode empty / active / not-enrolled / stale-offline / error-retry) come from that one
// shared surface — never re-implemented here (DRY, ADR-006). The page renders no data of its own; the embedded
// feature view's TOTPEnrollmentSectionViewModel owns the TOTP status StateFlow + the four mutations. Every visible
// string resolves from the generated res/values catalog (ADR-014); the page records the one-shot PII-safe
// `view.opened` diagnostic for the /account/2fa route (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + header composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.twofactor

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
import io.teslasync.android.featureviews.totpenrollmentsection.TOTPEnrollmentSection
import io.teslasync.android.featureviews.totpenrollmentsection.TOTPEnrollmentSectionSource
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Stateful entry point ────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11) and renders the header above the
 * shared TOTPEnrollmentSection feature view. The host wires [source] (an adapter over the shared S7 TOTPRepository
 * / S8 TOTPStore, via [io.teslasync.android.featureviews.totpenrollmentsection.bindTOTPEnrollmentSectionSource]),
 * and the feature view builds + owns its own [io.teslasync.android.featureviews.totpenrollmentsection.TOTPEnrollmentSectionViewModel]
 * (the TOTP status StateFlow + enroll/verify/revoke/regenerate mutations and their loading / empty / error states),
 * so this wrapper holds no page-level data of its own. [logger] defaults to the app's redacting logger.
 */
@Composable
fun TwoFactorAuthPage(
    source: TOTPEnrollmentSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordTwoFactorAuthPageOpened(logger) }
    TwoFactorAuthPageContent(source = source, modifier = modifier, logger = logger)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The page body: the title/subtitle/copy-link header (web `PageContainer` chrome) above the shared
 * TOTPEnrollmentSection feature view (web `<TOTPEnrollmentSection />`). Scrolls vertically so the embedded surface
 * — and its enroll modal trigger — is always reachable on short viewports, mirroring the sibling ChannelsPage /
 * ArchivedPage surfaces. The feature view itself lays out as a non-lazy column, so it composes safely inside the
 * page's scroll container.
 */
@Composable
fun TwoFactorAuthPageContent(
    source: TOTPEnrollmentSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TwoFactorAuthPageHeader()
        TOTPEnrollmentSection(source = source, logger = logger)
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the title heading, the descriptive subtitle, and
 * the copy-link affordance (web `copyLink`). The copy-link writes the canonical route to the clipboard (the native
 * analogue of copying the current URL).
 */
@Composable
private fun TwoFactorAuthPageHeader() {
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
            PageTitle(stringResource(R.string.translation_settings_account_twoFactor_title))
            BodyText(
                text = stringResource(R.string.translation_settings_account_twoFactor_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.Copy,
            contentDescription = stringResource(R.string.translation_common_copyLink_action),
            onClick = { clipboard.setText(AnnotatedString(TwoFactorAuthPageRegistration.WEB_PATH)) },
            variant = IconButtonVariant.Standard,
        )
    }
}
