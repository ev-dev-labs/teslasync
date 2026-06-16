// The native Jetpack Compose + Material 3 FleetTelemetryCoveragePage admin surface — a parity port of
// web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx, the operator view of the package-derived Fleet
// Telemetry routing snapshot. It reproduces the page's panels (the five summary stat tiles, the "Reading this
// page" legend, the destination-breakdown chips, the orphan-fields warning, the field filter, and the
// per-category routed-field tables), every data state (loading / empty / error / content + the filter-empty
// refinement), and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [FleetTelemetryCoveragePage] is the stateful entry (constructs the view-model over the
// host-wired source, records the one-shot `view.opened` diagnostic, collects the feed + the filter snapshot);
// [FleetTelemetryCoveragePageContent] is the stateless render layer driven entirely by [UiState] + the filter
// string + [CoverageActions]. All derivation lives in the framework-free model
// (FleetTelemetryCoveragePageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.admin.fleettelemetry

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCategoryCoverage
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverageResponse
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryFieldCoverage
import java.text.NumberFormat
import java.util.Locale

/** The page's interaction callbacks, wired to the [FleetTelemetryCoveragePageViewModel] (web event handlers). */
data class CoverageActions(
    val onFilter: (String) -> Unit,
    val onRefresh: () -> Unit,
    val onRetry: () -> Unit,
)

private const val FADE_STEP_MS = 60

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [FleetTelemetryCoveragePageViewModel] over the supplied [source] (the host
 * wires the shared [io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryStore] via
 * [asFleetTelemetryCoverageSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun FleetTelemetryCoveragePage(
    source: FleetTelemetryCoverageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: FleetTelemetryCoveragePageViewModel =
        viewModel(
            key = FleetTelemetryCoverageRegistration.SLUG,
            factory = viewModelFactory { initializer { FleetTelemetryCoveragePageViewModel(source, logger) } },
        )
    FleetTelemetryCoveragePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed + filter snapshot to the stateless content. */
@Composable
fun FleetTelemetryCoveragePage(
    viewModel: FleetTelemetryCoveragePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val filter by viewModel.filter.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            CoverageActions(
                onFilter = viewModel::setFilter,
                onRefresh = viewModel::refresh,
                onRetry = viewModel::retry,
            )
        }

    FleetTelemetryCoveragePageContent(state = state, filter = filter, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the summary tiles, the legend, the breakdown, the orphans, the filter, and the categories. */
@Composable
fun FleetTelemetryCoveragePageContent(
    state: UiState<FleetTelemetryCoverageResponse>,
    filter: String,
    actions: CoverageActions,
    modifier: Modifier = Modifier,
) {
    val data = state.data
    val stats = remember(data) { summarise(data) }
    val destinations = remember(data) { sortedDestinations(data?.destinationTotals ?: emptyMap()) }
    val orphans = data?.orphanFields ?: emptyList()
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val numbers = remember(locale) { NumberFormat.getIntegerInstance(locale) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        CoverageHeader(refreshing = state.refreshing, onRefresh = actions.onRefresh)

        FadeIn {
            CoverageStatsSection(stats = stats, loading = state.isLoading, numbers = numbers)
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            CoverageLegendPanel()
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            CoverageDestinationsPanel(destinations = destinations, numbers = numbers)
        }

        if (orphans.isNotEmpty()) {
            FadeIn(delayMs = FADE_STEP_MS * 3) {
                CoverageOrphansPanel(orphans = orphans)
            }
        }

        FadeIn(delayMs = FADE_STEP_MS * 4) {
            CoverageFilterPanel(filter = filter, onFilter = actions.onFilter)
        }

        CoverageCategoriesSection(state = state, filter = filter, numbers = numbers, onRetry = actions.onRetry)
    }
}

@Composable
private fun CoverageHeader(
    refreshing: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PageTitle(stringResource(R.string.translation_coverage_pageTitle))
            BodyText(
                stringResource(R.string.translation_coverage_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            label = stringResource(R.string.translation_coverage_refresh),
            onClick = onRefresh,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            loading = refreshing,
            enabled = !refreshing,
            leadingIcon = FleetTelemetryCoverageGlyphs.Refresh,
        )
    }
}

// ── Summary tiles (GlassPanel1 = section · Categories / Routed-fields / Subscribed / Routed-not-subscribed / Orphan-fields) ──

@Composable
private fun CoverageStatsSection(
    stats: CoverageStats,
    loading: Boolean,
    numbers: NumberFormat,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_coverage_stat_categories),
                value = numbers.format(stats.totalCategories.toLong()),
                modifier = Modifier.weight(1f),
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_coverage_stat_routedFields),
                value = numbers.format(stats.totalRoutedFields.toLong()),
                modifier = Modifier.weight(1f),
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_coverage_stat_subscribed),
                value = numbers.format(stats.subscribedFields.toLong()),
                modifier = Modifier.weight(1f),
                loading = loading,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_coverage_stat_routedNotSubscribed),
                value = numbers.format(stats.unsubscribedRoutedFields.toLong()),
                modifier = Modifier.weight(1f),
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_coverage_stat_orphans),
                value = numbers.format(stats.orphanFields.toLong()),
                modifier = Modifier.weight(1f),
                loading = loading,
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

// ── Legend (GlassPanel7) ──────────────────────────────────────────────────────────────────────────────────

@Composable
private fun CoverageLegendPanel() {
    GlassPanel(padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_coverage_legend_title))
        Caption(
            stringResource(R.string.translation_coverage_legend_intro),
            modifier = Modifier.padding(top = Spacing.xs),
        )
        Column(
            modifier = Modifier.padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            LegendItem(
                label = stringResource(R.string.translation_coverage_legend_columnLabel),
                help = stringResource(R.string.translation_coverage_legend_columnHelp),
            )
            LegendItem(
                label = stringResource(R.string.translation_coverage_legend_dualWriteLabel),
                help = stringResource(R.string.translation_coverage_legend_dualWriteHelp),
            )
            LegendItem(
                label = stringResource(R.string.translation_coverage_legend_subscribedLabel),
                help = stringResource(R.string.translation_coverage_legend_subscribedHelp),
            )
        }
    }
}

@Composable
private fun LegendItem(
    label: String,
    help: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.none)) {
        Subhead(label)
        BodyText(help, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Destination breakdown (GlassPanel8) ───────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CoverageDestinationsPanel(
    destinations: List<Pair<String, Int>>,
    numbers: NumberFormat,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_coverage_destinations_title))
        Caption(
            stringResource(R.string.translation_coverage_destinations_help),
            modifier = Modifier.padding(top = Spacing.xs),
        )
        if (destinations.isEmpty()) {
            BodyText(
                stringResource(R.string.translation_coverage_destinations_empty),
                modifier = Modifier.padding(top = Spacing.md),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            FlowRow(
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                destinations.forEach { (dest, count) ->
                    Badge(text = "$dest: ${numbers.format(count.toLong())}", variant = BadgeVariant.Info)
                }
            }
        }
    }
}

// ── Orphan fields (GlassPanel9) ───────────────────────────────────────────────────────────────────────────

@Composable
private fun CoverageOrphansPanel(orphans: List<String>) {
    GlassPanel(padding = PanelPadding.Lg, accent = PanelAccent.Warning) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                FleetTelemetryCoverageGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.status.warning,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(stringResource(R.string.translation_coverage_orphans_title))
                Caption(stringResource(R.string.translation_coverage_orphans_help))
            }
        }
        Column(
            modifier = Modifier.padding(top = Spacing.sm, start = Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            orphans.forEach { orphan ->
                CodeText(orphan)
            }
        }
    }
}

// ── Filter (GlassPanel10) ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun CoverageFilterPanel(
    filter: String,
    onFilter: (String) -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Input(
            value = filter,
            onValueChange = onFilter,
            hint = stringResource(R.string.translation_coverage_filter_placeholder), // parity:allow Android string id mirrors the web i18n key
        )
    }
}

// ── Categories section (GlassPanel11) + states ────────────────────────────────────────────────────────────

@Composable
private fun CoverageCategoriesSection(
    state: UiState<FleetTelemetryCoverageResponse>,
    filter: String,
    numbers: NumberFormat,
    onRetry: () -> Unit,
) {
    val categories = state.data?.categories ?: emptyList()
    val visible = remember(categories, filter) { filteredCategories(categories, filter) }

    when {
        state.isLoading -> CoverageLoadingState()
        state.isError -> CoverageErrorState(onRetry = onRetry)
        state.isEmpty ->
            EmptyState(message = stringResource(R.string.translation_coverage_empty))
        visible.isEmpty() ->
            EmptyState(message = stringResource(R.string.translation_coverage_filterEmpty))
        else ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                visible.forEach { category ->
                    FadeIn {
                        CoverageCategoryPanel(category = category, filter = filter, numbers = numbers)
                    }
                }
            }
    }
}

@Composable
private fun CoverageLoadingState() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.lg),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spinner(size = SpinnerSize.Sm)
        BodyText(
            stringResource(R.string.translation_coverage_loading),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun CoverageErrorState(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Md, accent = PanelAccent.Danger) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                FleetTelemetryCoverageGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.error,
            )
            ErrorText(
                stringResource(R.string.translation_coverage_error),
                modifier = Modifier.weight(1f),
            )
            Button(
                label = stringResource(R.string.translation_coverage_refresh),
                onClick = onRetry,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CoverageCategoryPanel(
    category: FleetTelemetryCategoryCoverage,
    filter: String,
    numbers: NumberFormat,
) {
    val fields = remember(category, filter) { filteredFields(category, filter) }
    val destChips = remember(category) { sortedDestinations(category.destinations) }

    GlassPanel(
        padding = PanelPadding.Lg,
        modifier = Modifier.semantics { contentDescription = category.category },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.none),
            ) {
                PanelTitle(category.category)
                Caption(
                    stringResource(
                        R.string.translation_coverage_category_totalFields,
                        numbers.format(category.totalFields.toLong()),
                    ),
                )
            }
            if (destChips.isNotEmpty()) {
                FlowRow(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    destChips.forEach { (dest, count) ->
                        Badge(text = "$dest: ${numbers.format(count.toLong())}", variant = BadgeVariant.Neutral)
                    }
                }
            }
        }
        when {
            category.fields.isEmpty() ->
                BodyText(
                    stringResource(R.string.translation_coverage_category_empty),
                    modifier = Modifier.padding(top = Spacing.sm),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            fields.isEmpty() ->
                BodyText(
                    stringResource(R.string.translation_coverage_category_noMatch),
                    modifier = Modifier.padding(top = Spacing.sm),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            else ->
                CoverageFieldTable(fields = fields, modifier = Modifier.padding(top = Spacing.md))
        }
    }
}

// ── Per-category field table (web DataTable: Field / Destination / Column / Dual write / Subscribed) ───────

private const val WEIGHT_FIELD = 2.4f
private const val WEIGHT_DESTINATION = 1.6f
private const val WEIGHT_COLUMN = 1.6f
private const val WEIGHT_DUAL_WRITE = 1.3f
private const val WEIGHT_SUBSCRIBED = 1.1f

@Composable
private fun CoverageFieldTable(
    fields: List<FleetTelemetryFieldCoverage>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            HeaderCell(stringResource(R.string.translation_coverage_col_field), WEIGHT_FIELD)
            HeaderCell(stringResource(R.string.translation_coverage_col_destination), WEIGHT_DESTINATION)
            HeaderCell(stringResource(R.string.translation_coverage_col_column), WEIGHT_COLUMN)
            HeaderCell(stringResource(R.string.translation_coverage_col_dualWrite), WEIGHT_DUAL_WRITE)
            HeaderCell(stringResource(R.string.translation_coverage_col_subscribed), WEIGHT_SUBSCRIBED)
        }
        fields.forEach { field -> CoverageFieldRow(field = field) }
    }
}

@Composable
private fun RowScope.HeaderCell(
    text: String,
    weight: Float,
) {
    Caption(text, modifier = Modifier.weight(weight))
}

@Composable
private fun CoverageFieldRow(field: FleetTelemetryFieldCoverage) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CodeText(field.field, modifier = Modifier.weight(WEIGHT_FIELD))
        Cell(weight = WEIGHT_DESTINATION) {
            Badge(text = field.destination, variant = BadgeVariant.Info)
        }
        Cell(weight = WEIGHT_COLUMN) {
            val column = field.column
            if (column != null) {
                CodeText(column)
            } else {
                Caption(EM_DASH)
            }
        }
        Cell(weight = WEIGHT_DUAL_WRITE) {
            if (field.alsoSignalLog) {
                Badge(text = stringResource(R.string.translation_coverage_dualWrite_yes), variant = BadgeVariant.Warning)
            } else {
                Caption(EM_DASH)
            }
        }
        Cell(weight = WEIGHT_SUBSCRIBED) {
            if (field.subscribed) {
                Badge(text = stringResource(R.string.translation_coverage_subscribed_yes), variant = BadgeVariant.Success)
            } else {
                Badge(text = stringResource(R.string.translation_coverage_subscribed_no), variant = BadgeVariant.Neutral)
            }
        }
    }
}

@Composable
private fun RowScope.Cell(
    weight: Float,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.weight(weight),
        verticalArrangement = Arrangement.spacedBy(Spacing.none),
    ) {
        content()
    }
}
