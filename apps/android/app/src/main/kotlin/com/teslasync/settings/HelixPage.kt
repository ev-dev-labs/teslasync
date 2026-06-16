// The native Jetpack Compose + Material 3 HelixPage settings surface — a parity port of
// web/src/features/settings/pages/HelixPage.tsx, the dedicated /integrations/helix wrapper that promotes the
// optional Helix AI integration to a first-class Integrations route. Like the web page it is a thin chrome
// wrapper: it renders inside the shared PageContainer surface (web `<PageContainer>`) — page title, subtitle,
// the per-route breadcrumb label overrides, and the first-load spinner driven by `useSettings().isLoading` —
// and embeds the shared AISettings feature view (web `<AISettings />`) verbatim as its body, so the branded
// header, the off / local-only / cloud mode picker, the cost-cap spend bar, the save action, and every
// cache-then-network data state come from that one shared surface — never re-implemented here (DRY, ADR-006).
// Every visible string resolves from the res/values catalog (ADR-014); PageContainer owns the one PII-safe
// `view.opened` diagnostic (P1/S11) and publishes the breadcrumb overrides. The view performs NO HTTP.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/settings) cannot form a valid Kotlin package and the file hosts the stateful entry plus the
// stateless screen, exactly as the sibling ChannelsPage surface does.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.settings.helix

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.aisettings.AISettings
import io.teslasync.android.featureviews.aisettings.AISettingsViewModel
import io.teslasync.android.featureviews.aisettings.AISettingsViewSource
import io.teslasync.android.sharedsurfaces.pagecontainer.PageContainer
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement

/**
 * Stateful entry point — the faithful port of the web `HelixPage`. Constructs the page's two route-scoped
 * view-models: the [HelixPageViewModel] over [helixSource] (the page's own `useSettings` loading flag) and the
 * embedded [AISettingsViewModel] over [aiSettingsSource] (the web `<AISettings />`). Collects the settings
 * lifecycle and hands a fully-resolved render to the stateless [HelixPageScreen]. Binds no feed directly — the
 * view-models own all collection; this composable only wires them. [logger] defaults to the app's redacting
 * logger.
 */
@Composable
fun HelixPage(
    helixSource: HelixPageSource,
    aiSettingsSource: AISettingsViewSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsViewModel: HelixPageViewModel =
        viewModel(
            key = HelixPageRegistration.SLUG,
            factory = HelixPageViewModel.factory(helixSource, logger),
        )
    val aiSettingsViewModel: AISettingsViewModel =
        viewModel(
            key = HelixPageRegistration.SLUG + "/AISettings",
            factory = AISettingsViewModel.factory(aiSettingsSource, logger),
        )
    val settingsState by settingsViewModel.settings.collectAsStateWithLifecycle()

    HelixPageScreen(settingsState = settingsState, modifier = modifier) {
        AISettings(viewModel = aiSettingsViewModel)
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the page chrome from the already-resolved
 * [settingsState]: the shared PageContainer with the localized title + subtitle, the per-route breadcrumb label
 * overrides (web `breadcrumbLabels`), and the first-load spinner gated on [UiState.isLoading] (web
 * `loading={isLoading}`). The [content] slot — the embedded AISettings feature view in production — renders once
 * the first settings fetch resolves, mirroring the web wrapper. Kept free of view-model reads so every state is
 * previewable and testable.
 */
@Composable
fun HelixPageScreen(
    settingsState: UiState<JsonElement>,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    PageContainer(
        title = stringResource(R.string.translation_helix_page_title),
        modifier = modifier,
        subtitle = stringResource(R.string.translation_helix_page_subtitle),
        loading = settingsState.isLoading,
        breadcrumbLabels =
            mapOf(
                "integrations" to stringResource(R.string.translation_helix_breadcrumb_integrations),
                "helix" to stringResource(R.string.translation_helix_page_title),
            ),
        content = content,
    )
}
