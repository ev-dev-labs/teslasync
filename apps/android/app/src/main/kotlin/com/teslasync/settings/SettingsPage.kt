// The native Jetpack Compose + Material 3 SettingsPage surface — a parity port of
// web/src/features/settings/pages/SettingsPage.tsx, the application-preferences screen at /settings. It
// reproduces the web page's PageContainer chrome (title + subtitle + the `loading={isLoading}` overlay) and
// every region the web tree renders, in order: the settings find-as-you-type box (SettingsSearch), the
// cross-tab edit-conflict banner (EditConflictBanner over the `settings/general` lease), the General /
// Appearance / Advanced / Reset preference sections (the existing A3 feature-views), and the three link/action
// cards — Data Export (GlassPanel1), Onboarding Tour (GlassPanel2), and Setup Checklist (GlassPanel3). Every
// visible string resolves from the generated res/values catalog (ADR-014).
//
// Composition mirrors the sibling A7 pages: [SettingsPage] is the stateful entry (constructs the view-model
// over the host-wired source, records the one-shot `view.opened` diagnostic, collects the page-level
// loading → success state, and resolves the card affordances against the sanctioned native seams — a
// `teslasync://app/...` deep-link `Intent` for the Data-Export link + the SettingsSearch matches, a
// page-local TourLauncher modal for the tour card, and the shared toast holder for the checklist
// confirmation); [SettingsPageContent] is the stateless render layer that switches the loading spinner ↔ the
// settings body off the bound [UiState]. The composed child sections own their own loading / empty / error
// matrices; this layer only resolves the page chrome + draws the three cards.
//
// Navigation seam: page hosts are not handed a `LocalNavController` (the GlancePage / ArchivedPage
// precedent), so forward navigation to another route — the web `<a href="/data-export">` and the
// SettingsSearch `navigate(entry.route)` — is performed by handing the route's `teslasync://app/...`
// deep-link URI to an `ACTION_VIEW` Intent, exactly as the shell's notification deep-link handler does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + card composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.page

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.advancedsettings.AdvancedSettings
import io.teslasync.android.featureviews.advancedsettings.AdvancedSettingsViewModel
import io.teslasync.android.featureviews.advancedsettings.ConfirmSilenceStore
import io.teslasync.android.featureviews.appearancesettings.AppearanceSettings
import io.teslasync.android.featureviews.generalsettings.GeneralSettings
import io.teslasync.android.featureviews.resetsection.ResetSection
import io.teslasync.android.featureviews.resetsection.ResetSectionSource
import io.teslasync.android.featureviews.settingssearch.SettingsSearch
import io.teslasync.android.featureviews.settingssearch.SettingsSearchEntry
import io.teslasync.android.miscsurfaces.tourlauncher.TourLauncher
import io.teslasync.android.miscsurfaces.tourlauncher.rememberTourLauncherController
import io.teslasync.android.notifications.NotificationRouteMap
import io.teslasync.android.sharedsurfaces.editconflictbanner.EditConflictBanner
import io.teslasync.android.sharedsurfaces.toast.LocalToastController
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement

/** The page's interaction callbacks, wired to the host seams (web event handlers + the card affordances). */
data class SettingsPageActions(
    val onOpenDataExport: () -> Unit,
    val onNavigateSearch: (SettingsSearchEntry) -> Unit,
    val onOpenTour: () -> Unit,
    val onRestartChecklist: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SettingsPageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.settings.SettingsStore] via [settingsPageSourceOf]) and the
 * page-local [resetSource] + [confirmSilenceStore] the Reset / Advanced sections bind to. [logger] defaults
 * to the app's redacting logger.
 */
@Composable
fun SettingsPage(
    source: SettingsPageSource,
    resetSource: ResetSectionSource,
    confirmSilenceStore: ConfirmSilenceStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SettingsPageViewModel =
        viewModel(
            key = SettingsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SettingsPageViewModel(source, logger) } },
        )
    SettingsPage(
        viewModel = vm,
        resetSource = resetSource,
        confirmSilenceStore = confirmSilenceStore,
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateful entry: binds the [viewModel] loading → success state to the stateless content, records the
 * one-shot diagnostic, resolves every card affordance against the sanctioned native seams, and mounts the
 * page-local [TourLauncher] modal the tour card pops (web `dispatchTourLauncherOpen()`).
 */
@Composable
fun SettingsPage(
    viewModel: SettingsPageViewModel,
    resetSource: ResetSectionSource,
    confirmSilenceStore: ConfirmSilenceStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val toast = LocalToastController.current
    val tourController = rememberTourLauncherController()
    val restartedMessage = stringResource(R.string.translation_checklist_settings_restarted)

    val actions =
        remember(context, toast, tourController, restartedMessage, logger) {
            SettingsPageActions(
                onOpenDataExport = { openRoute(context, SettingsPageRegistration.DATA_EXPORT_PATH) },
                onNavigateSearch = { entry -> openRoute(context, entry.route) },
                onOpenTour = tourController::open,
                onRestartChecklist = {
                    logger.info("settings.checklist.restart")
                    toast?.success(restartedMessage)
                },
            )
        }

    SettingsPageContent(
        state = state,
        resetSource = resetSource,
        confirmSilenceStore = confirmSilenceStore,
        actions = actions,
        modifier = modifier,
        logger = logger,
    )

    // The web tour launcher is an app-level modal popped by a global event; with no app-level mount the
    // page hosts its own controller + modal, so the card's button opens a real launcher (its tour list,
    // completion state, and reset-all are fully wired). Replaying a tour is owned by the separate tour-player
    // unit, so onStartTour records the intent and the launcher closes itself.
    TourLauncher(
        controller = tourController,
        onStartTour = { id -> logger.info("settings.tour.start", mapOf("tour" to id)) },
        pathname = SettingsPageRegistration.WEB_PATH,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the header (always visible, never blank) above the loading spinner ↔ settings
 * body switch the web `PageContainer loading={isLoading}` draws. The body renders, in web order: the
 * SettingsSearch box, the EditConflictBanner, the four preference sections (the existing A3 feature-views,
 * each owning its own loading / empty / error matrix), and the three cards.
 */
@Composable
fun SettingsPageContent(
    state: UiState<JsonElement>,
    resetSource: ResetSectionSource,
    confirmSilenceStore: ConfirmSilenceStore,
    actions: SettingsPageActions,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    // Constructed unconditionally (a stable Compose call) so the Advanced section's view-model survives the
    // loading → content transition; only consumed in the content branch.
    val advancedViewModel: AdvancedSettingsViewModel =
        viewModel(
            key = ADVANCED_INSTANCE_KEY,
            factory = AdvancedSettingsViewModel.factory(confirmSilenceStore, logger),
        )

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_settings_title))
            BodyText(
                text = stringResource(R.string.translation_settings_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (state.isLoading) {
            Box(
                modifier = Modifier.fillMaxWidth().padding(vertical = LOADING_PADDING),
                contentAlignment = Alignment.Center,
            ) {
                Spinner(size = SpinnerSize.Lg)
            }
        } else {
            SettingsSearch(onNavigate = actions.onNavigateSearch)

            EditConflictBanner(
                resourceKey = SettingsPageRegistration.LEASE_KEY,
                resourceLabel = stringResource(R.string.translation_editConflict_resource_settings),
            )

            GeneralSettings()
            AppearanceSettings()
            AdvancedSettings(viewModel = advancedViewModel)
            ResetSection(source = resetSource, logger = logger)

            DataExportCard(onOpen = actions.onOpenDataExport)
            OnboardingTourCard(onOpen = actions.onOpenTour)
            SetupChecklistCard(onRestart = actions.onRestartChecklist)
        }
    }
}

// ── Cards (the three GlassPanels) ─────────────────────────────────────────────────────────────────────────--

/**
 * GlassPanel1 — the Data Export link card. The whole panel is the tap target (web `<a href="/data-export">`):
 * a green IconBox + download glyph, the title + subtitle, and a trailing external-link glyph.
 */
@Composable
private fun DataExportCard(onOpen: () -> Unit) {
    val title = stringResource(R.string.translation_export_title)
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClickLabel = title, onClick = onOpen),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Success) {
                Icon(SettingsPageGlyphs.Download, contentDescription = null)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(title)
                Caption(stringResource(R.string.translation_export_subtitle))
            }
            Icon(
                SettingsPageGlyphs.ExternalLink,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * GlassPanel2 — the Onboarding Tour card: a cyan IconBox + play glyph, the title + description, and a ghost
 * button that pops the tour launcher (web `dispatchTourLauncherOpen()`).
 */
@Composable
private fun OnboardingTourCard(onOpen: () -> Unit) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Primary) {
                Icon(SettingsPageGlyphs.PlayCircle, contentDescription = null)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(stringResource(R.string.translation_tour_title))
                Caption(stringResource(R.string.translation_tour_description))
            }
            Button(
                label = stringResource(R.string.translation_tour_restart),
                onClick = onOpen,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = SettingsPageGlyphs.PlayCircle,
            )
        }
    }
}

/**
 * GlassPanel3 — the Setup Checklist card: a cyan IconBox + rocket glyph, the title + description, and a ghost
 * button that restarts the first-run checklist and raises the confirmation toast (web `restartChecklist()` +
 * `toast.success(...)`).
 */
@Composable
private fun SetupChecklistCard(onRestart: () -> Unit) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Primary) {
                Icon(SettingsPageGlyphs.Rocket, contentDescription = null)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(stringResource(R.string.translation_checklist_settings_title))
                Caption(stringResource(R.string.translation_checklist_settings_description))
            }
            Button(
                label = stringResource(R.string.translation_checklist_settings_restart),
                onClick = onRestart,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = SettingsPageGlyphs.Rocket,
            )
        }
    }
}

// ── Navigation seam ───────────────────────────────────────────────────────────────────────────────────────--

/**
 * Forward-navigates to an in-app [path] by handing its `teslasync://app/...` deep-link URI to an
 * `ACTION_VIEW` Intent scoped to this app — the sanctioned page-host navigation seam (no `LocalNavController`
 * is exposed to hosts), the native analogue of the web `<a href="…">` / `navigate(…)`. The rare no-handler
 * case is swallowed so a tap never crashes the page.
 */
private fun openRoute(
    context: Context,
    path: String,
) {
    val uri = NotificationRouteMap.deepLinkUriFor(path)
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.packageName)
    runCatching { context.startActivity(intent) }
}

private const val ADVANCED_INSTANCE_KEY = "settings.advanced"
private val LOADING_PADDING = 80.dp
