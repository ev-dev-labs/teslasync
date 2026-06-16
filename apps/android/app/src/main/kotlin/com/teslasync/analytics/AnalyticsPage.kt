// The native Jetpack Compose + Material 3 AnalyticsPage surface — the parity port of
// web/src/features/analytics/pages/AnalyticsPage.tsx, the Fleet Analytics dashboard. It reproduces the page
// header (title + subtitle + freshness chip + range picker), the six hero gauges, the four-tab section switcher
// (Overview / Driving / Charging / Battery), every panel/chart/card the web tabs render, and all three data
// states (loading / error / success) — every visible string resolved from the generated res/values catalog
// (ADR-014), every SI value converted only at this render boundary (S5).
//
// Composition: [AnalyticsPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed + interaction snapshot + the live unit
// formatter); [AnalyticsPageContent] is the stateless render layer driven entirely by [UiState] +
// [AnalyticsInteraction] + [AnalyticsActions]. All derivation lives in the framework-free model
// (AnalyticsPageModel.kt) and the display boundary (AnalyticsPageFormat.kt); this file resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Width of the range-preset dropdown in the page header. */
private val RANGE_PICKER_WIDTH = 132.dp

/** The page's interaction callbacks, wired to the [AnalyticsPageViewModel] (web event handlers). */
data class AnalyticsActions(
    val onTab: (AnalyticsTab) -> Unit,
    val onRange: (AnalyticsRange) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AnalyticsPageViewModel] over the supplied [source] (the host wires the shared
 * Analytics holder via [asAnalyticsSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun AnalyticsPage(
    source: AnalyticsSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: AnalyticsPageViewModel =
        viewModel(
            key = AnalyticsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AnalyticsPageViewModel(source, logger) } },
        )
    AnalyticsPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic and binds the feed + interaction snapshot + the
 * live unit formatter to the stateless content.
 */
@Composable
fun AnalyticsPage(
    viewModel: AnalyticsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            AnalyticsActions(
                onTab = viewModel::setTab,
                onRange = viewModel::setRange,
                onRetry = viewModel::retry,
            )
        }

    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val format = remember(unitFormatter, locale) { AnalyticsFormat(unitFormatter, locale) }

    AnalyticsPageContent(
        state = state,
        interaction = interaction,
        format = format,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title / subtitle / freshness / range picker), then the loading / error /
 * success surface. On success it draws the hero gauges, the tab switcher, and the active tab's panels — the
 * full web parity surface.
 */
@Composable
fun AnalyticsPageContent(
    state: UiState<FleetAnalytics>,
    interaction: AnalyticsInteraction,
    format: AnalyticsFormat,
    actions: AnalyticsActions,
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
        AnalyticsHeader(state = state, interaction = interaction, actions = actions)

        when {
            state.isLoading -> AnalyticsLoadingState()
            state.isError -> AnalyticsErrorState(onRetry = actions.onRetry)
            else -> {
                val data = state.data ?: FleetAnalytics.EMPTY
                AnalyticsHeroGauges(data = data, format = format)
                AnalyticsTabBar(active = interaction.tab, onSelect = actions.onTab)
                when (interaction.tab) {
                    AnalyticsTab.OVERVIEW -> AnalyticsOverviewTab(data = data, format = format)
                    AnalyticsTab.DRIVING -> AnalyticsDrivingTab(data = data, format = format)
                    AnalyticsTab.CHARGING -> AnalyticsChargingTab(data = data, format = format)
                    AnalyticsTab.BATTERY -> AnalyticsBatteryTab(data = data, format = format)
                }
            }
        }
    }
}

/** The page header — title, muted subtitle, the freshness chip, and the range-preset picker (web header row). */
@Composable
private fun AnalyticsHeader(
    state: UiState<FleetAnalytics>,
    interaction: AnalyticsInteraction,
    actions: AnalyticsActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_analytics_title))
        BodyText(
            stringResource(R.string.translation_analytics_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing || state.isLoading,
                isStale = state.stale,
                isError = state.hasError,
            )
            Box(modifier = Modifier.weight(1f))
            Box(modifier = Modifier.width(RANGE_PICKER_WIDTH)) {
                AnalyticsRangePicker(selected = interaction.range, onRange = actions.onRange)
            }
        }
    }
}

/** The date-range preset dropdown (web `RangePicker` with `['7d','30d','90d','1y','all']`). */
@Composable
private fun AnalyticsRangePicker(
    selected: AnalyticsRange,
    onRange: (AnalyticsRange) -> Unit,
) {
    val options = remember { AnalyticsRange.entries.map { SelectOption(it.wire, it.wire) } }
    Select(
        options = options,
        selectedValue = selected.wire,
        onSelect = { onRange(AnalyticsRange.fromWire(it)) },
    )
}

/** The four-tab section switcher (web `TabNav`). */
@Composable
private fun AnalyticsTabBar(
    active: AnalyticsTab,
    onSelect: (AnalyticsTab) -> Unit,
) {
    val items =
        listOf(
            TabNavItem(AnalyticsTab.OVERVIEW.wire, stringResource(R.string.translation_analytics_tabs_overview), AnalyticsGlyphs.BarChart),
            TabNavItem(AnalyticsTab.DRIVING.wire, stringResource(R.string.translation_analytics_tabs_driving), AnalyticsGlyphs.Car),
            TabNavItem(AnalyticsTab.CHARGING.wire, stringResource(R.string.translation_analytics_tabs_charging), AnalyticsGlyphs.Zap),
            TabNavItem(AnalyticsTab.BATTERY.wire, stringResource(R.string.translation_analytics_tabs_battery), AnalyticsGlyphs.Battery),
        )
    TabNav(
        items = items,
        selectedKey = active.wire,
        onSelect = { onSelect(AnalyticsTab.fromWire(it)) },
    )
}

/** First-load loading surface (web `PageContainer loading`). */
@Composable
private fun AnalyticsLoadingState() {
    Box(modifier = Modifier.fillMaxWidth().padding(Spacing.xl3), contentAlignment = Alignment.Center) {
        Spinner(size = SpinnerSize.Lg)
    }
}

/** Hard-error surface with a retry affordance (web `PageContainer error`). */
@Composable
private fun AnalyticsErrorState(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_error_retry),
    )
}
