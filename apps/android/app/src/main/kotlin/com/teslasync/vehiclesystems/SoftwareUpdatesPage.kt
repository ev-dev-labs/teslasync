// The native Jetpack Compose + Material 3 SoftwareUpdatesPage vehicle-systems surface — a parity port of
// web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx, the firmware-version + update-history dashboard.
// It reproduces the page's three summary MetricCards (current version, updates installed, total updates), the
// "Update Timeline" GlassPanel of per-version cards (version + status chip + release-notes link + the resolved
// vehicle name + the installed / scheduled / created dates), every data state (loading skeleton / empty /
// error-retry / content, plus the cache-then-network stale/offline tier the bound state holder carries), and every
// visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [SoftwareUpdatesPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the updates feed + the owner-name map);
// [SoftwareUpdatesPageContent] is the stateless render layer. The single `/software-updates` feed is folded by the
// framework-free model (SoftwareUpdatesPageModel.kt) into the slices the panels read — exactly as the web page
// threads its loaded `updates` through the summary reduces and the timeline map.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.vehiclesystems.softwareupdates

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Number of skeleton timeline rows shown while the first load is in flight (web `Skeleton` cascade ×4). */
private const val LIST_SKELETON_ROWS = 4

/** Skeleton row height (web `h-20`). */
private val SKELETON_ROW_HEIGHT = 72.dp

/** The timeline status-dot disc diameter (web `h-5 w-5` + ring). */
private val STATUS_DISC = 28.dp

/** Translucency of the status-dot disc background (web `bg-…/10`). */
private const val DISC_BG_ALPHA = 0.12f

// Per-card / per-status accent colours — the web MetricCard `color` + the `STATUS_CONFIG` tints. These are fixed
// brand accents the card/disc tints its icon with (dynamic per-card values, not static theme tokens), the same
// precedent as the sibling TripList palette; body text + surfaces still come from `MaterialTheme`.
private val ACCENT_CYAN = Color(0xFF22D3EE)
private val ACCENT_GREEN = Color(0xFF10B981)
private val ACCENT_PURPLE = Color(0xFFA855F7)
private val ACCENT_AMBER = Color(0xFFF59E0B)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SoftwareUpdatesPageViewModel] over the supplied [source] (the host wires the
 * shared VehicleSystems repository + the app-scoped active-vehicle selection + the shared Vehicles holder via
 * [softwareUpdatesPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun SoftwareUpdatesPage(
    source: SoftwareUpdatesPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SoftwareUpdatesPageViewModel =
        viewModel(
            key = SoftwareUpdatesPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SoftwareUpdatesPageViewModel(source, logger) } },
        )
    SoftwareUpdatesPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] updates feed + the owner-name map to the stateless content. */
@Composable
fun SoftwareUpdatesPage(
    viewModel: SoftwareUpdatesPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.updatesState.collectAsStateWithLifecycle()
    val vehicleNames by viewModel.vehicleNames.collectAsStateWithLifecycle()

    SoftwareUpdatesPageContent(
        state = state,
        vehicleNames = vehicleNames,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading feed (with nothing cached) renders the full-page skeleton; otherwise the
 * header is drawn, then the error banner (when the last load failed), the three summary cards, and the Update
 * Timeline panel (which itself renders the empty / error / content states inline so no region ever blanks).
 */
@Composable
fun SoftwareUpdatesPageContent(
    state: UiState<List<SoftwareUpdate>>,
    vehicleNames: Map<Long, String>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (state.isLoading) {
        SoftwareUpdatesLoading(modifier)
        return
    }

    val locale = LocalConfiguration.current.locales[0]
    val updates = state.data.orEmpty()
    val pageLabel = stringResource(R.string.translation_softwareUpdates_title)

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { contentDescription = pageLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SoftwareUpdatesHeader(state = state)

        if (state.hasError) {
            FadeIn {
                AlertBanner(
                    message = stringResource(R.string.translation_error_loadFailed),
                    tone = Tone.Danger,
                )
            }
        }

        FadeIn { SoftwareUpdatesSummary(updates = updates) }

        FadeIn(delayMs = FADE_STEP_MS) {
            UpdateTimelinePanel(
                state = state,
                updates = updates,
                vehicleNames = vehicleNames,
                locale = locale,
                onRetry = onRetry,
            )
        }
    }
}

/** The page header — the web `PageContainer` title + muted subtitle + the query-freshness chip. */
@Composable
private fun SoftwareUpdatesHeader(state: UiState<List<SoftwareUpdate>>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_Software_Updates))
            BodyText(
                stringResource(R.string.translation_Track_firmware_versions_and_update_history),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0L },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
}

/** The full-page loading skeleton (web `PageContainer loading` + the timeline `Skeleton` cascade). */
@Composable
private fun SoftwareUpdatesLoading(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        StatGridSkeleton(count = SUMMARY_CARD_COUNT)
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                repeat(LIST_SKELETON_ROWS) { Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true) }
            }
        }
    }
}

// ── Summary cards (web Summary Cards) ──────────────────────────────────────────────────────────────────────────

private const val SUMMARY_CARD_COUNT = 3

/**
 * The three summary MetricCards (web `grid-cols-1 sm:grid-cols-3`): current version, updates installed, total
 * updates. Each card resolves its label from the i18n catalog and takes its formatted value from the folded model.
 */
@Composable
private fun SoftwareUpdatesSummary(updates: List<SoftwareUpdate>) {
    val unknown = stringResource(R.string.translation_Unknown)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        MetricCard(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_Current_Version),
            value = latestVersionOr(updates, unknown),
            icon = SoftwareUpdatesGlyphs.Smartphone,
            accent = ACCENT_CYAN,
        )
        MetricCard(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_Updates_Installed),
            value = installedCount(updates).toString(),
            icon = DataDisplayGlyphs.CheckCircle,
            accent = ACCENT_GREEN,
        )
        MetricCard(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_Total_Updates),
            value = totalUpdateCount(updates).toString(),
            icon = FormsGlyphs.Download,
            accent = ACCENT_PURPLE,
        )
    }
}

// ── Update Timeline ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The "Update Timeline" panel. Renders the empty state (no history), the hard-error retry surface (a failed load
 * with nothing cached), or the per-version timeline rows — so the panel never collapses to a blank region.
 */
@Composable
private fun UpdateTimelinePanel(
    state: UiState<List<SoftwareUpdate>>,
    updates: List<SoftwareUpdate>,
    vehicleNames: Map<Long, String>,
    locale: Locale,
    onRetry: () -> Unit,
) {
    val timelineLabel = stringResource(R.string.translation_Update_Timeline)
    GlassPanel(
        padding = PanelPadding.Lg,
        modifier = Modifier.semantics { contentDescription = timelineLabel },
    ) {
        SectionTitle(timelineLabel)
        Column(modifier = Modifier.padding(top = Spacing.md)) {
            when {
                updates.isEmpty() && state.isError ->
                    ErrorDisplay(
                        title = stringResource(R.string.translation_error_serverError_title),
                        message = stringResource(R.string.translation_error_loadFailed),
                        onRetry = onRetry,
                        retryLabel = stringResource(R.string.translation_common_retry),
                    )

                updates.isEmpty() ->
                    EmptyState(
                        icon = SoftwareUpdatesGlyphs.Smartphone,
                        title = stringResource(R.string.translation_No_update_history),
                        message = stringResource(R.string.translation_No_software_update_history_available),
                    )

                else ->
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                        updates.forEach { update ->
                            UpdateTimelineRow(
                                update = update,
                                vehicleName = resolveVehicleName(update, vehicleNames),
                                locale = locale,
                            )
                        }
                    }
            }
        }
    }
}

/** One timeline entry (web `GlassPanel` per update): the status disc + the version card. */
@Composable
private fun UpdateTimelineRow(
    update: SoftwareUpdate,
    vehicleName: String,
    locale: Locale,
) {
    val style = statusStyleOf(statusKindOf(update.status))
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.Top) {
        Box(
            modifier =
                Modifier
                    .size(STATUS_DISC)
                    .clip(CircleShape)
                    .background(style.accent.copy(alpha = DISC_BG_ALPHA)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(style.icon, contentDescription = null, size = IconSize.Sm, tint = style.accent)
        }
        GlassPanel(padding = PanelPadding.Md, modifier = Modifier.weight(1f)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    UpdateVersionRow(update = update, style = style)
                    Caption(vehicleName)
                }
                UpdateDateColumn(update = update, locale = locale)
            }
        }
    }
}

/** The version line: the version label, the status badge, and the release-notes external link. */
@Composable
private fun UpdateVersionRow(
    update: SoftwareUpdate,
    style: SoftwareUpdateStatusStyle,
) {
    val uriHandler = LocalUriHandler.current
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PanelTitle(update.version)
        Badge(stringResource(style.labelRes), variant = style.badgeVariant)
        IconButton(
            imageVector = DataDisplayGlyphs.ExternalLink,
            contentDescription = stringResource(R.string.translation_View_release_notes),
            onClick = { uriHandler.openUri(releaseNotesUrl(update.version)) },
            variant = IconButtonVariant.Standard,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The right-aligned date column: the installed date, or the scheduled date, plus the created-at line. */
@Composable
private fun UpdateDateColumn(
    update: SoftwareUpdate,
    locale: Locale,
) {
    val installed = formatSoftwareUpdateDate(update.installedAt, locale)
    val scheduled = formatSoftwareUpdateDate(update.scheduledAt, locale)
    val created = formatSoftwareUpdateDate(update.createdAt, locale)
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        when {
            installed.isNotEmpty() ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        FormsGlyphs.Calendar,
                        contentDescription = null,
                        size = IconSize.Xs,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Caption(installed)
                }

            scheduled.isNotEmpty() ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(DataDisplayGlyphs.Clock, contentDescription = null, size = IconSize.Xs, tint = ACCENT_AMBER)
                    BodyText(
                        "${stringResource(R.string.translation_Scheduled)}: $scheduled",
                        color = ACCENT_AMBER,
                    )
                }
        }
        if (created.isNotEmpty()) {
            Caption(created)
        }
    }
}

// ── Status style mapping (web STATUS_CONFIG) ──────────────────────────────────────────────────────────────────

/** The render-boundary style for a status kind — the web `STATUS_CONFIG` row (label key + badge + accent + icon). */
private data class SoftwareUpdateStatusStyle(
    val labelRes: Int,
    val badgeVariant: BadgeVariant,
    val accent: Color,
    val icon: ImageVector,
)

/** Maps the framework-free [SoftwareUpdateStatusKind] to its render style (web `STATUS_CONFIG[...]`). */
@Composable
private fun statusStyleOf(kind: SoftwareUpdateStatusKind): SoftwareUpdateStatusStyle =
    when (kind) {
        SoftwareUpdateStatusKind.Installed ->
            SoftwareUpdateStatusStyle(
                R.string.translation_widget_softwareUpdate_statusInstalled,
                BadgeVariant.Success,
                ACCENT_GREEN,
                DataDisplayGlyphs.CheckCircle,
            )

        SoftwareUpdateStatusKind.Installing ->
            SoftwareUpdateStatusStyle(
                R.string.translation_widget_softwareUpdate_statusInstalling,
                BadgeVariant.Info,
                ACCENT_CYAN,
                FormsGlyphs.Download,
            )

        SoftwareUpdateStatusKind.Downloading ->
            SoftwareUpdateStatusStyle(
                R.string.translation_widget_softwareUpdate_statusDownloading,
                BadgeVariant.Info,
                ACCENT_CYAN,
                FormsGlyphs.Download,
            )

        SoftwareUpdateStatusKind.Available ->
            SoftwareUpdateStatusStyle(
                R.string.translation_widget_softwareUpdate_statusAvailable,
                BadgeVariant.Warning,
                ACCENT_AMBER,
                SoftwareUpdatesGlyphs.ArrowUpCircle,
            )

        SoftwareUpdateStatusKind.Scheduled ->
            SoftwareUpdateStatusStyle(
                R.string.translation_widget_softwareUpdate_scheduled,
                BadgeVariant.Neutral,
                MaterialTheme.colorScheme.onSurfaceVariant,
                DataDisplayGlyphs.Clock,
            )
    }

/** Resolves a row's owner name from the live vehicle map, falling back to `Vehicle {id}` (web `vehicleMap`). */
@Composable
private fun resolveVehicleName(
    update: SoftwareUpdate,
    vehicleNames: Map<Long, String>,
): String =
    vehicleNames[update.vehicleId]
        ?: "${stringResource(R.string.translation_Vehicle)} ${update.vehicleId}"
