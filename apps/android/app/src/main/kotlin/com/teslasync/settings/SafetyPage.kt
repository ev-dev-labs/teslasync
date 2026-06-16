// File hosts the SafetyPage Compose surface (stateful entry + stateless content + previews); named after the surface
// rather than a single declaration.
//
// It is the native Android (Jetpack Compose / Material 3) parity port of the web settings explainer host
// (web/src/features/settings/pages/SafetyPage.tsx): the page title/subtitle header (web `PageContainer` chrome), the
// gated `<AISafetySettingExplainer />` narration card (reused verbatim from the shared surface — renders nothing in
// AI-Off mode, ADR-015), and the deterministic GlassPanel listing of every safety-related setting with its current
// value badge, plain-English description, and a Docs link. The listing is the AI-OFF-safe static-help surface: it
// renders the same set of toggles for every user, with the per-install live values read from the shared settings
// document (web `useSettings()`), and works fully when `ai_mode='off'`.
//
// Single success state by design: the web reads `settings ?? defaults`, so the listing always has a value to show; the
// [SafetyPageViewModel] mirrors that (always [io.teslasync.android.data.UiPhase.Content]). The view performs no HTTP —
// it only collects ViewModel state. Every visible string resolves from the generated res/values catalog (ADR-014) and
// every value token from the common On/Off/Active/Suspended labels, so no English literal is hardcoded.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + previews.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.safety

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.aisafetysettingexplainer.AISafetySettingExplainer
import io.teslasync.android.sharedsurfaces.aisafetysettingexplainer.AISafetySettingExplainerViewModel
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.presentation.settings.SettingsStore

// ── Stateful entry point ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the page [SafetyPageViewModel] (over the shared [settingsStore]) and the embedded
 * [AISafetySettingExplainerViewModel] (over the same store + the resilient [apiClient]), each keyed to this surface's
 * slug so they scope to the `/settings/safety` navigation entry. Records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition. [logger] defaults to the app's redacting logger.
 */
@Composable
fun SafetyPage(
    settingsStore: SettingsStore,
    apiClient: ApiHttpClient,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: SafetyPageViewModel =
        viewModel(
            key = SafetyPageRegistration.SLUG,
            factory = SafetyPageViewModel.factory(settingsStore, logger),
        )
    val explainerViewModel: AISafetySettingExplainerViewModel =
        viewModel(
            key = SafetyPageRegistration.SLUG + AI_EXPLAINER_KEY_SUFFIX,
            factory = AISafetySettingExplainerViewModel.factory(settingsStore, apiClient, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    SafetyPageContent(viewModel = viewModel, explainerViewModel = explainerViewModel, modifier = modifier)
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The page body: collects the single always-success [SafetyPageViewModel.state] and renders the title/subtitle header
 * (web `PageContainer` chrome), the gated AI narration card (web `<AISafetySettingExplainer />`), and the safety
 * settings listing (web GlassPanel). Scrolls vertically so every section is reachable on short viewports.
 */
@Composable
fun SafetyPageContent(
    viewModel: SafetyPageViewModel,
    explainerViewModel: AISafetySettingExplainerViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SafetyPageScaffold(
        settings = state.data ?: SafetySettings.DEFAULT,
        modifier = modifier,
    ) {
        AISafetySettingExplainer(viewModel = explainerViewModel)
    }
}

/**
 * The stateless layout: header → AI narration slot → listing. Hoisting the [explainer] as a slot keeps this scaffold
 * (and the listing below) preview- and test-renderable without constructing the AI stream ViewModel.
 */
@Composable
private fun SafetyPageScaffold(
    settings: SafetySettings,
    modifier: Modifier = Modifier,
    explainer: @Composable () -> Unit,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SafetyPageHeader()
        explainer()
        SafetySettingsListing(settings = settings)
    }
}

/** The page header — the title + subtitle the web `PageContainer` renders for this route. */
@Composable
private fun SafetyPageHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_safetySettings_pageTitle))
        BodyText(
            stringResource(R.string.translation_safetySettings_pageSubtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── GlassPanel1: the deterministic safety-settings listing ────────────────────────────────────────────────────────

/**
 * The parity panel (web `GlassPanel` `data-testid="safety-settings-listing"`): a listing header, the seven
 * safety-setting rows (title + current-value badge + description + Docs link), and the read-only change hint. Rendered
 * from the decoded [settings] so each badge shows the live value (or its web default).
 */
@Composable
private fun SafetySettingsListing(
    settings: SafetySettings,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                SectionTitle(
                    stringResource(R.string.translation_safetySettings_listing_title),
                    modifier = Modifier.semantics { heading() },
                )
                BodyText(
                    stringResource(R.string.translation_safetySettings_listing_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Column {
                SafetySetting.entries.forEachIndexed { index, setting ->
                    if (index > 0) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    SafetySettingRowItem(setting = setting, settings = settings)
                }
            }

            HelperText(stringResource(R.string.translation_safetySettings_listing_changeHint))
        }
    }
}

/**
 * One listing row: the setting title with its current-value [Badge], the plain-English description, and a Docs link
 * that opens the setting's documentation (web `<a href target="_blank">`). The text column is merged for TalkBack so
 * the title + value + description announce as one; the Docs link stays a separate focusable action.
 */
@Composable
private fun SafetySettingRowItem(
    setting: SafetySetting,
    settings: SafetySettings,
) {
    val uriHandler = LocalUriHandler.current
    val title = stringResource(safetySettingTitleRes(setting))
    val description = stringResource(safetySettingDescriptionRes(setting))
    val value = rememberSafetyRowValueText(setting.value(settings))
    val docsLabel = stringResource(R.string.translation_safetySettings_listing_docsLink)
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) { contentDescription = "$title, $value. $description" },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BodyText(title)
                Badge(text = value, variant = BadgeVariant.Info)
            }
            HelperText(description)
        }
        Button(
            label = docsLabel,
            onClick = { uriHandler.openUri(BuildConfig.API_BASE_URL + setting.docsAnchor) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/** Resolves a [SafetyRowValue] to its localized badge text (web hardcodes these English literals inline). */
@Composable
private fun rememberSafetyRowValueText(value: SafetyRowValue): String =
    when (value) {
        is SafetyRowValue.OnOff ->
            if (value.on) {
                stringResource(R.string.translation_common_on)
            } else {
                stringResource(R.string.translation_common_off)
            }

        is SafetyRowValue.ApiState ->
            if (value.suspended) {
                stringResource(R.string.translation_common_suspended)
            } else {
                stringResource(R.string.translation_common_active)
            }

        is SafetyRowValue.Plain -> value.text.ifBlank { EM_DASH }
    }

/** The catalog title key for each row (web `row.titleKey`). */
private fun safetySettingTitleRes(setting: SafetySetting): Int =
    when (setting) {
        SafetySetting.QuietHoursEnabled -> R.string.translation_safetySettings_rows_quietHoursEnabled_title
        SafetySetting.QuietHoursStart -> R.string.translation_safetySettings_rows_quietHoursStart_title
        SafetySetting.QuietHoursEnd -> R.string.translation_safetySettings_rows_quietHoursEnd_title
        SafetySetting.AlertDigestMode -> R.string.translation_safetySettings_rows_alertDigestMode_title
        SafetySetting.CriticalFlashEnabled -> R.string.translation_safetySettings_rows_criticalFlashEnabled_title
        SafetySetting.TabBadgeEnabled -> R.string.translation_safetySettings_rows_tabBadgeEnabled_title
        SafetySetting.ApiSuspended -> R.string.translation_safetySettings_rows_apiSuspended_title
    }

/** The catalog description key for each row (web `row.descKey`). */
private fun safetySettingDescriptionRes(setting: SafetySetting): Int =
    when (setting) {
        SafetySetting.QuietHoursEnabled -> R.string.translation_safetySettings_rows_quietHoursEnabled_description
        SafetySetting.QuietHoursStart -> R.string.translation_safetySettings_rows_quietHoursStart_description
        SafetySetting.QuietHoursEnd -> R.string.translation_safetySettings_rows_quietHoursEnd_description
        SafetySetting.AlertDigestMode -> R.string.translation_safetySettings_rows_alertDigestMode_description
        SafetySetting.CriticalFlashEnabled -> R.string.translation_safetySettings_rows_criticalFlashEnabled_description
        SafetySetting.TabBadgeEnabled -> R.string.translation_safetySettings_rows_tabBadgeEnabled_description
        SafetySetting.ApiSuspended -> R.string.translation_safetySettings_rows_apiSuspended_description
    }

/** The em dash shown for a blank value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** ViewModel-store key suffix for the embedded AI explainer so it never collides with the page ViewModel. */
private const val AI_EXPLAINER_KEY_SUFFIX = ".aiExplainer"

// ── Previews — the success surface with default and non-default values. ───────────────────────────────────────────

@Preview(name = "Safety · defaults", showBackground = true)
@Composable
private fun SafetyListingDefaultsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            SafetyPageHeader()
            SafetySettingsListing(settings = SafetySettings.DEFAULT)
        }
    }
}

@Preview(name = "Safety · quiet hours on, API suspended", showBackground = true)
@Composable
private fun SafetyListingActivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SafetySettingsListing(
            settings =
                SafetySettings.DEFAULT.copy(
                    quietHoursEnabled = true,
                    alertDigestMode = "hourly",
                    apiSuspended = true,
                ),
            modifier = Modifier.padding(Spacing.lg),
        )
    }
}
