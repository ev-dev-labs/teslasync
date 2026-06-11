// The native Jetpack Compose + Material 3 Maintenance Tracker dashboard surface — a parity port of
// web/src/features/dashboard/widgets/MaintenanceTrackerWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a wrench-iconed title + freshness
// header) wrapping one of the two bodies the web renders: the compact months-left hero (1×N — wrench +
// months-remaining + item name) or — when wider — the standard layout (a "Next Service" card with the
// urgency badge, name, interval + distance + optional cost, above the recent-service timeline or a "No
// service records yet" line), with a friendly empty state when no schedule or records exist. All data
// flows through the shared [MaintenanceTrackerWidgetViewModel]; SI distances are converted +
// currency-formatted at this render boundary via the live [MaintenanceTrackerDisplayPrefs]. The view never
// performs HTTP. Every string resolves through the i18n catalog (P1/S10) and every interactive element
// carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MaintenanceTrackerWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.maintenancetracker

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.TimelineItem
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private val COMPACT_MIN_HEIGHT: Dp = 44.dp
private val LOADING_TITLE_HEIGHT: Dp = 14.dp
private val LOADING_PANEL_HEIGHT: Dp = 64.dp
private val LOADING_BAR_HEIGHT: Dp = 32.dp
private const val LOADING_TITLE_FRACTION: Float = 0.4f
private const val LOADING_HERO_FRACTION: Float = 0.6f

/**
 * Stateful entry point. Binds the shared maintenance + service-records + settings feeds via [source] into a
 * [MaintenanceTrackerWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8 data
 * layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (maintenance + service-records + settings adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MaintenanceTrackerWidget(
    source: MaintenanceTrackerSource,
    modifier: Modifier = Modifier,
    size: MaintenanceTrackerSize = MaintenanceTrackerRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = MaintenanceTrackerRegistration.ID,
) {
    val viewModel: MaintenanceTrackerWidgetViewModel =
        viewModel(key = instanceKey, factory = MaintenanceTrackerWidgetViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    MaintenanceTrackerWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI→display distance
 * conversion + currency formatting; [size] selects the compact vs standard layout (web `size.cols`).
 */
@Composable
fun MaintenanceTrackerWidgetContent(
    state: UiState<MaintenanceTrackerData>,
    prefs: MaintenanceTrackerDisplayPrefs,
    size: MaintenanceTrackerSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberMaintenanceTrackerStrings()

    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                MaintenanceLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError -> MaintenanceError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, prefs, strings) {
                        MaintenanceTrackerProjection.project(state.data ?: MaintenanceTrackerData.EMPTY, prefs, strings)
                    }
                MaintenanceLoaded(state = state, display = display, size = size, strings = strings, onRefresh = onRefresh)
            }
        }
    }
}

@Composable
private fun MaintenanceLoaded(
    state: UiState<MaintenanceTrackerData>,
    display: MaintenanceTrackerDisplay,
    size: MaintenanceTrackerSize,
    strings: MaintenanceTrackerStrings,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MaintenanceHeader(
            title = if (size.isCompact) null else strings.title,
            state = state,
            onRefresh = onRefresh,
        )
        if (size.isCompact) {
            MaintenanceCompactBody(display = display, strings = strings)
        } else {
            MaintenanceStandardBody(display = display, strings = strings)
        }
    }
}

@Composable
private fun MaintenanceHeader(
    title: String?,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            Icon(
                imageVector = FeedbackGlyphs.Wrench,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.warning,
            )
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = title == null,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun MaintenanceCompactBody(
    display: MaintenanceTrackerDisplay,
    strings: MaintenanceTrackerStrings,
) {
    Box(
        modifier = Modifier.fillMaxWidth().heightIn(min = COMPACT_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        if (display.hasNextItem) {
            Column(
                modifier = Modifier.clearAndSetSemantics { contentDescription = display.compactContentDescription },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    imageVector = FeedbackGlyphs.Wrench,
                    contentDescription = null,
                    size = IconSize.Md,
                    tint = TeslaTokens.status.warning,
                )
                MetricValue(display.compactMonths)
                MetricLabel(strings.monthsLeft)
                Caption(display.compactName)
            }
        } else {
            MaintenanceEmpty(message = strings.noData)
        }
    }
}

@Composable
private fun MaintenanceStandardBody(
    display: MaintenanceTrackerDisplay,
    strings: MaintenanceTrackerStrings,
) {
    if (display.hasData) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            display.nextService?.let { NextServiceCardView(card = it, label = strings.nextService) }
            RecentServiceSection(display = display, strings = strings)
        }
    } else {
        MaintenanceEmpty(message = strings.noData)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NextServiceCardView(
    card: NextServiceCard,
    label: String,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = card.contentDescription },
        padding = CardPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Caption(label)
            Badge(text = card.urgencyLabel, variant = badgeVariant(card.urgency), dot = true)
        }
        BodyText(card.name, modifier = Modifier.padding(top = Spacing.xs), maxLines = 1)
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    imageVector = DataDisplayGlyphs.Clock,
                    contentDescription = null,
                    size = IconSize.Xs,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Caption(card.everyText)
            }
            Caption(card.distanceText)
            card.costText?.let { Caption(it) }
        }
    }
}

@Composable
private fun RecentServiceSection(
    display: MaintenanceTrackerDisplay,
    strings: MaintenanceTrackerStrings,
) {
    if (display.hasRecords) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(strings.recentService)
            Column(modifier = Modifier.fillMaxWidth()) {
                display.timelineRows.forEachIndexed { index, row ->
                    TimelineItem(
                        entry =
                            TimelineEntry(
                                title = row.title,
                                time = row.time,
                                subtitle = row.subtitle,
                                icon = DataDisplayGlyphs.CheckCircle,
                                accent = TeslaTokens.status.success,
                            ),
                        isLast = index == display.timelineRows.lastIndex,
                        modifier = Modifier.clearAndSetSemantics { contentDescription = row.contentDescription },
                    )
                }
            }
        }
    } else {
        Box(
            modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
            contentAlignment = Alignment.Center,
        ) {
            HelperText(strings.noRecords)
        }
    }
}

@Composable
private fun MaintenanceLoading(
    compact: Boolean,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = LOADING_HERO_FRACTION, height = LOADING_BAR_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            Skeleton(height = LOADING_PANEL_HEIGHT, rounded = true)
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun MaintenanceError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun MaintenanceEmpty(message: String) {
    EmptyState(
        message = message,
        icon = FeedbackGlyphs.Wrench,
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun badgeVariant(urgency: Urgency): BadgeVariant =
    when (urgency) {
        Urgency.Overdue -> BadgeVariant.Danger
        Urgency.Soon -> BadgeVariant.Warning
        Urgency.Good -> BadgeVariant.Success
    }

/**
 * Builds the localized [MaintenanceTrackerStrings] from the i18n catalog (P1/S10) — the eleven
 * `widget.maintenance.*` keys the web component reads via `t('widget.maintenance.…')`. Remembered against
 * the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberMaintenanceTrackerStrings(): MaintenanceTrackerStrings {
    val title = stringResource(R.string.translation_widget_maintenance_title)
    val overdue = stringResource(R.string.translation_widget_maintenance_overdue)
    val soon = stringResource(R.string.translation_widget_maintenance_soon)
    val good = stringResource(R.string.translation_widget_maintenance_good)
    val monthsLeft = stringResource(R.string.translation_widget_maintenance_monthsLeft)
    val noData = stringResource(R.string.translation_widget_maintenance_noData)
    val nextService = stringResource(R.string.translation_widget_maintenance_nextService)
    val every = stringResource(R.string.translation_widget_maintenance_every)
    val months = stringResource(R.string.translation_widget_maintenance_months)
    val recentService = stringResource(R.string.translation_widget_maintenance_recentService)
    val noRecords = stringResource(R.string.translation_widget_maintenance_noRecords)
    return remember(title, overdue, soon, good, monthsLeft, noData, nextService, every, months, recentService, noRecords) {
        MaintenanceTrackerStrings(
            title = title,
            overdue = overdue,
            soon = soon,
            good = good,
            monthsLeft = monthsLeft,
            noData = noData,
            nextService = nextService,
            every = every,
            months = months,
            recentService = recentService,
            noRecords = noRecords,
        )
    }
}

@Preview(name = "Maintenance — standard", showBackground = true)
@Composable
private fun MaintenanceTrackerStandardPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MaintenanceTrackerWidgetContent(
            state = UiState(phase = io.teslasync.android.data.UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            prefs = MaintenanceTrackerDisplayPrefs.METRIC_DEFAULT,
            size = MaintenanceTrackerRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "Maintenance — compact", showBackground = true)
@Composable
private fun MaintenanceTrackerCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MaintenanceTrackerWidgetContent(
            state = UiState(phase = io.teslasync.android.data.UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            prefs = MaintenanceTrackerDisplayPrefs.METRIC_DEFAULT,
            size = MaintenanceTrackerRegistration.MIN_SIZE,
            onRefresh = {},
        )
    }
}

private const val PREVIEW_NOW = 1_780_000_000_000L

private fun previewData(): MaintenanceTrackerData =
    MaintenanceTrackerData(
        items =
            listOf(
                MaintenanceItem(id = "2", name = "Tire Rotation", intervalMonths = null, intervalKm = null, estimatedCostUsd = null),
                MaintenanceItem(id = "6", name = "Wiper Blades", intervalMonths = 12.0, intervalKm = null, estimatedCostUsd = null),
            ),
        records = emptyList(),
    )
