// The native Jetpack Compose + Material 3 MaintenancePage vehicle-systems surface — a parity port of
// web/src/features/vehicle-systems/pages/MaintenancePage.tsx. It reproduces the page chrome (PageContainer: title +
// subtitle + first-load spinner), the error banner, the four summary metric cards (total / due-soon / overdue /
// completed), the category + sort toolbar with the schedule-maintenance action, the responsive grid of per-item
// progress cards, the cost-summary panel (total / annual-estimate / avg-per-service + the EV-savings note), the
// service-projections panel, and the service-records table — every panel rendering its own loading / empty / error /
// content surface (a section is never hidden), and every visible string resolved from the generated res/values
// catalog (ADR-014).
//
// Composition: [MaintenancePage] is the stateful entry (constructs the view-model over the host-wired source, collects
// the two feeds + the display preferences + the toolbar state); [MaintenancePageContent] is the stateless render
// layer. The decoded items/records are folded by the framework-free model (MaintenancePageModel.kt) into the panel
// values — exactly as the web page derives them. Currency/dates are converted to the user's preferences only here at
// the display boundary; mileage renders verbatim with the localized "mi" label, matching the web surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems.maintenance

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.InlineCallout
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatSkeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.pagecontainer.PageContainer
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private val BREAKPOINT_MEDIUM = 600.dp
private val BREAKPOINT_ITEMS_THREE = 900.dp
private val BREAKPOINT_EXPANDED = 840.dp
private val PANEL_SKELETON_HEIGHT = 96.dp
private const val FILTER_ALL = "all"

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [MaintenancePageViewModel] over the supplied [source] (the host wires the page-local
 * maintenance repository + the shared settings holder + the active-vehicle selection via [maintenancePageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun MaintenancePage(
    source: MaintenancePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: MaintenancePageViewModel =
        viewModel(
            key = MaintenancePageRegistration.SLUG,
            factory = viewModelFactory { initializer { MaintenancePageViewModel(source, logger) } },
        )
    MaintenancePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + display prefs + toolbar state to the stateless content. */
@Composable
fun MaintenancePage(
    viewModel: MaintenancePageViewModel,
    modifier: Modifier = Modifier,
) {
    val itemsState by viewModel.itemsState.collectAsStateWithLifecycle()
    val recordsState by viewModel.recordsState.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val filter by viewModel.filter.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.recordViewOpened() }

    MaintenancePageContent(
        itemsState = itemsState,
        recordsState = recordsState,
        prefs = prefs,
        filter = filter,
        nowMillis = viewModel.nowMillis(),
        onCategory = viewModel::setCategory,
        onSort = viewModel::setSort,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body inside the shared [PageContainer] chrome (web `<PageContainer>`). A first items load shows
 * the centered spinner; otherwise every section renders independently — a top error banner when a feed failed, the
 * always-present summary cards, the filter/sort toolbar, the items grid (skeleton / empty / cards), the cost-summary
 * and service-projections panels, and the service-records table — so a region is never blank (web per-section guards).
 */
@Composable
fun MaintenancePageContent(
    itemsState: UiState<List<MaintenanceItem>>,
    recordsState: UiState<List<ServiceRecord>>,
    prefs: MaintenanceDisplayPrefs,
    filter: MaintenanceFilterState,
    nowMillis: Long,
    onCategory: (MaintenanceCategoryFilter) -> Unit,
    onSort: (MaintenanceSortKey) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val items = itemsState.data ?: emptyList()

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
    ) {
        PageContainer(
            title = stringResource(R.string.translation_Maintenance),
            subtitle = stringResource(R.string.translation_Service_schedule__records__and_upcoming_maintenance),
            loading = itemsState.isLoading,
            onRetry = onRetry,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                if (itemsState.hasError || recordsState.hasError) {
                    AlertBanner(
                        message = stringResource(R.string.translation_error_loadFailed),
                        tone = Tone.Danger,
                        icon = MaintenanceGlyphs.AlertCircle,
                    )
                }

                FadeIn { SummarySection(itemsState = itemsState, items = items) }

                FadeIn(delayMs = MotionStaggerMs.TOOLBAR) {
                    MaintenanceToolbar(
                        filter = filter,
                        categories = categoriesOf(items),
                        onCategory = onCategory,
                        onSort = onSort,
                    )
                }

                FadeIn(delayMs = MotionStaggerMs.ITEMS) {
                    ItemsSection(
                        itemsState = itemsState,
                        filter = filter,
                        prefs = prefs,
                        nowMillis = nowMillis,
                    )
                }

                FadeIn(delayMs = MotionStaggerMs.COST) {
                    CostAndProjectionsSection(
                        itemsState = itemsState,
                        recordsState = recordsState,
                        items = items,
                        prefs = prefs,
                    )
                }

                FadeIn(delayMs = MotionStaggerMs.RECORDS) {
                    RecordsSection(recordsState = recordsState, prefs = prefs)
                }
            }
        }
    }
}

/** Hand-staggered entry delays for the page sections (web `FadeIn delay` props). */
private object MotionStaggerMs {
    const val TOOLBAR = 50
    const val ITEMS = 100
    const val COST = 150
    const val RECORDS = 200
}

// ── Summary section (panels Total-Items / Due-Soon / Overdue / Completed) ─────────────────────────────────────────

/** The four summary metric cards (web summary `MetricCard`s), or a skeleton row during the first items load. */
@Composable
private fun SummarySection(
    itemsState: UiState<List<MaintenanceItem>>,
    items: List<MaintenanceItem>,
) {
    if (itemsState.isLoading) {
        ResponsiveCardRow(columnsAt = ::summaryColumns) { StatSkeleton() }
        return
    }
    val summary = summaryViewOf(summarize(items))
    val cards =
        listOf(
            MetricSpec(
                label = stringResource(R.string.translation_Total_Items),
                value = summary.total,
                icon = MaintenanceGlyphs.ListChecks,
                accent = TeslaTokens.chart.regen,
            ),
            MetricSpec(
                label = stringResource(R.string.translation_Due_Soon),
                value = summary.soon,
                icon = MaintenanceGlyphs.Clock,
                accent = TeslaTokens.status.warning,
            ),
            MetricSpec(
                label = stringResource(R.string.translation_Overdue),
                value = summary.overdue,
                icon = MaintenanceGlyphs.AlertTriangle,
                accent = TeslaTokens.status.danger,
            ),
            MetricSpec(
                label = stringResource(R.string.translation_Completed),
                value = summary.completed,
                icon = MaintenanceGlyphs.CheckCircle,
                accent = TeslaTokens.status.success,
            ),
        )
    MetricColumns(items = cards, columnsAt = ::summaryColumns) { card ->
        MetricCard(
            label = card.label,
            value = card.value,
            icon = card.icon,
            accent = card.accent,
            modifier = Modifier.clearAndSetSemantics { contentDescription = "${card.label} ${card.value}" },
        )
    }
}

/** One summary / cost metric tile spec (web `MetricCard` props). */
private data class MetricSpec(
    val label: String,
    val value: String,
    val icon: ImageVector? = null,
    val accent: Color,
)

private fun summaryColumns(tier: WidthTier): Int = if (tier == WidthTier.Compact) 2 else 4

// ── Toolbar (category filter + sort + schedule action) ────────────────────────────────────────────────────────────

/** The filter/sort/schedule toolbar (web filter `Select`s + `Schedule Maintenance` `Button`). */
@Composable
private fun MaintenanceToolbar(
    filter: MaintenanceFilterState,
    categories: List<String>,
    onCategory: (MaintenanceCategoryFilter) -> Unit,
    onSort: (MaintenanceSortKey) -> Unit,
) {
    val categoryOptions =
        buildList {
            add(SelectOption(FILTER_ALL, stringResource(R.string.translation_All_Categories)))
            categories.forEach { add(SelectOption(it, it.replaceFirstChar { ch -> ch.titlecase(Locale.getDefault()) })) }
        }
    val sortOptions =
        listOf(
            SelectOption(SORT_STATUS, stringResource(R.string.translation_Status)),
            SelectOption(SORT_NAME, stringResource(R.string.translation_Name)),
            SelectOption(SORT_DUE_DATE, stringResource(R.string.translation_Due_Date)),
            SelectOption(SORT_CATEGORY, stringResource(R.string.translation_Category)),
        )

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            LabeledSelect(
                icon = MaintenanceGlyphs.Filter,
                options = categoryOptions,
                selectedValue = categoryFilterValue(filter.category),
                onSelect = { onCategory(categoryFilterOf(it)) },
                modifier = Modifier.weight(1f),
            )
            LabeledSelect(
                icon = MaintenanceGlyphs.ArrowUpDown,
                options = sortOptions,
                selectedValue = sortKeyValue(filter.sort),
                onSelect = { onSort(sortKeyOf(it)) },
                modifier = Modifier.weight(1f),
            )
        }
        Button(
            label = stringResource(R.string.translation_Schedule_Maintenance),
            onClick = {
                // Web `handleSchedule` is a no-op affordance; the scheduling flow is out of this surface's scope.
            },
            variant = ButtonVariant.Primary,
            leadingIcon = MaintenanceGlyphs.CalendarPlus,
            modifier = Modifier.align(Alignment.End),
        )
    }
}

/** A leading-icon + [Select] control (web `<Filter/> <Select/>` toolbar pairing). */
@Composable
private fun LabeledSelect(
    icon: ImageVector,
    options: List<SelectOption>,
    selectedValue: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = MaterialColorMuted())
        Select(options = options, selectedValue = selectedValue, onSelect = onSelect, modifier = Modifier.weight(1f))
    }
}

// ── Items grid (panel GlassPanel1: the per-item progress cards) ───────────────────────────────────────────────────

/** The maintenance items grid (web items grid): skeleton during first load, an empty state, or the item cards. */
@Composable
private fun ItemsSection(
    itemsState: UiState<List<MaintenanceItem>>,
    filter: MaintenanceFilterState,
    prefs: MaintenanceDisplayPrefs,
    nowMillis: Long,
) {
    if (itemsState.isLoading) {
        ResponsiveCardRow(columnsAt = ::itemColumns) { Skeleton(height = PANEL_SKELETON_HEIGHT, rounded = true) }
        return
    }
    val items = itemsState.data ?: emptyList()
    val filtered = sortItems(filterItems(items, filter.category), filter.sort)
    if (filtered.isEmpty()) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            EmptyState(
                icon = MaintenanceGlyphs.Wrench,
                title = stringResource(R.string.translation_No_maintenance_items),
                message =
                    if (filter.category is MaintenanceCategoryFilter.Only) {
                        stringResource(R.string.translation_No_items_match_the_selected_category__Try_a_different_filter_)
                    } else {
                        stringResource(R.string.translation_No_maintenance_items_found_for_this_vehicle_)
                    },
            )
        }
        return
    }
    val views = filtered.map { deriveItemView(it, prefs, nowMillis) }
    MetricColumns(items = views, columnsAt = ::itemColumns) { view -> MaintenanceItemCard(view) }
}

private fun itemColumns(tier: WidthTier): Int =
    when (tier) {
        WidthTier.Compact -> 1
        WidthTier.Medium -> 2
        WidthTier.Expanded -> 3
    }

/** One maintenance item card (web `MaintenanceItemCard`): category chip + status badge, name, description, the
 *  progress readout (non-completed), and the current-mileage / last-service footer. */
@Composable
private fun MaintenanceItemCard(view: MaintenanceItemView) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                CategoryChip(view.category, view.categoryAccent)
                Badge(text = statusLabel(view.status), variant = badgeVariant(view.status.tone))
            }
            Heading(view.name, level = HeadingLevel.Panel, maxLines = 1)
            if (view.description.isNotBlank()) {
                BodyText(view.description, color = MaterialColorMuted(), maxLines = 2)
            }
            if (view.showProgress) {
                MetricBar(
                    value = view.progressFraction,
                    max = 1.0,
                    label = view.percentText,
                    valueText = itemDueText(view),
                    color = progressColor(view.progressAccent),
                )
            }
            ItemFooter(view)
        }
    }
}

/** The item card's bottom row: current mileage (gauge) + last-service date (clock), each shown only when present. */
@Composable
private fun ItemFooter(view: MaintenanceItemView) {
    if (view.currentMileage == null && view.lastServiceDate == null) return
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
        if (view.currentMileage != null) {
            IconCaption(MaintenanceGlyphs.Gauge, "${view.currentMileage} ${stringResource(R.string.translation_mi)}")
        }
        if (view.lastServiceDate != null) {
            IconCaption(MaintenanceGlyphs.Clock, view.lastServiceDate)
        }
    }
}

/** The "Due: <date>" / "Due: <mileage> mi" readout shown to the right of the progress bar (web due label). */
@Composable
private fun itemDueText(view: MaintenanceItemView): String {
    val due = stringResource(R.string.translation_Due)
    return when {
        view.dueDate != null -> "$due: ${view.dueDate}"
        view.dueMileage != null -> "$due: ${view.dueMileage} ${stringResource(R.string.translation_mi)}"
        else -> ""
    }
}

/** The category chip (web `CategoryBadge`): a tinted pill with the tag glyph + the capitalized category. */
@Composable
private fun CategoryChip(
    category: String,
    accent: MaintenanceCategoryAccent,
) {
    val color = categoryColor(accent)
    Row(
        modifier =
            Modifier
                .background(color.copy(alpha = CHIP_BG_ALPHA), RoundedCornerShape(Spacing.xs))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(MaintenanceGlyphs.Tag, contentDescription = null, size = IconSize.Xs, tint = color)
        Caption(category.replaceFirstChar { it.titlecase(Locale.getDefault()) }, modifier = Modifier.clearAndSetSemantics { contentDescription = category })
    }
}

private const val CHIP_BG_ALPHA = 0.16f

// ── Cost summary + Service projections (panels GlassPanel6 / Total-Spent / Annual-Est / Avg-Service / GlassPanel10) ─

/** The cost-summary and service-projections panels, side-by-side on a wide window and stacked on a phone. */
@Composable
private fun CostAndProjectionsSection(
    itemsState: UiState<List<MaintenanceItem>>,
    recordsState: UiState<List<ServiceRecord>>,
    items: List<MaintenanceItem>,
    prefs: MaintenanceDisplayPrefs,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val twoColumn = maxWidth >= BREAKPOINT_EXPANDED
        if (twoColumn) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                CostPanel(recordsState, prefs, Modifier.weight(1f))
                ProjectionsPanel(itemsState, items, prefs, Modifier.weight(1f))
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                CostPanel(recordsState, prefs, Modifier.fillMaxWidth())
                ProjectionsPanel(itemsState, items, prefs, Modifier.fillMaxWidth())
            }
        }
    }
}

/** Estimated Annual Cost panel (web GlassPanel): the three cost metric cards + the EV-savings note, or empty state. */
@Composable
private fun CostPanel(
    recordsState: UiState<List<ServiceRecord>>,
    prefs: MaintenanceDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        PanelHeader(MaintenanceGlyphs.DollarSign, stringResource(R.string.translation_Estimated_Annual_Cost), TeslaTokens.status.success)
        Spacer(Modifier.height(Spacing.sm))
        val stats = costStatsOf(recordsState.data ?: emptyList())
        when {
            recordsState.isLoading -> Skeleton(height = PANEL_SKELETON_HEIGHT, rounded = true)
            stats != null -> {
                val cost = costViewOf(stats, prefs)
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        CostCard(stringResource(R.string.translation_Total_Spent), cost.totalSpent, Modifier.weight(1f))
                        CostCard(stringResource(R.string.translation_Annual_Est_), cost.annualEst, Modifier.weight(1f))
                        CostCard(stringResource(R.string.translation_Avg___Service), cost.avgService, Modifier.weight(1f))
                    }
                    InlineCallout(
                        message = stringResource(R.string.translation_EV_maintenance_is_typically_40_60__cheaper_than_a_comparable_gas_vehicle_),
                        tone = Tone.Success,
                    )
                }
            }
            else ->
                EmptyState(
                    message = stringResource(R.string.translation_No_cost_data_available_yet__Log_service_records_to_see_cost_estimates_),
                )
        }
    }
}

/** One cost metric tile (web cost `MetricCard`; no icon, matching the web cost cards). */
@Composable
private fun CostCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    MetricCard(
        label = label,
        value = value,
        modifier = modifier.clearAndSetSemantics { contentDescription = "$label $value" },
    )
}

/** Service Projections panel (web GlassPanel): the ranked upcoming-service rows, or the empty state. */
@Composable
private fun ProjectionsPanel(
    itemsState: UiState<List<MaintenanceItem>>,
    items: List<MaintenanceItem>,
    prefs: MaintenanceDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        PanelHeader(MaintenanceGlyphs.TrendingUp, stringResource(R.string.translation_Service_Projections), TeslaTokens.chart.power)
        Spacer(Modifier.height(Spacing.sm))
        val projections = projectionsOf(items).map { deriveProjectionView(it, prefs) }
        when {
            itemsState.isLoading -> Skeleton(height = PANEL_SKELETON_HEIGHT, rounded = true)
            projections.isNotEmpty() ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    projections.forEach { ProjectionRow(it) }
                }
            else ->
                EmptyState(
                    message = stringResource(R.string.translation_No_upcoming_service_projections_available_),
                )
        }
    }
}

/** One projection row (web projection list item): wrench + name, then remaining mileage / due date + status badge. */
@Composable
private fun ProjectionRow(view: MaintenanceProjectionView) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(MaintenanceGlyphs.Wrench, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.chart.regen)
        BodyText(view.name, modifier = Modifier.weight(1f), maxLines = 1)
        if (view.milesRemaining != null) {
            Caption("${view.milesRemaining} ${stringResource(R.string.translation_mi)}")
        }
        if (view.dueDate != null) {
            Caption(view.dueDate)
        }
        Badge(text = statusLabel(view.status), variant = badgeVariant(view.status.tone))
    }
}

// ── Service records table (panel GlassPanel11) ────────────────────────────────────────────────────────────────────

/** Service Records panel (web GlassPanel + DataTable): a loading skeleton, an empty state, or the records table. */
@Composable
private fun RecordsSection(
    recordsState: UiState<List<ServiceRecord>>,
    prefs: MaintenanceDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_Service_Records))
        Spacer(Modifier.height(Spacing.sm))
        val records = recordsState.data ?: emptyList()
        when {
            recordsState.isLoading ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    repeat(3) { Skeleton(height = 40.dp, rounded = true) }
                }
            records.isEmpty() ->
                EmptyState(
                    icon = MaintenanceGlyphs.Wrench,
                    message = stringResource(R.string.translation_No_service_records_logged_yet_),
                )
            else -> ServiceRecordsTable(records, prefs)
        }
    }
}

/** The sortable service-records table (web `DataTable`): Date, Description, Mileage, Cost, Provider. */
@Composable
private fun ServiceRecordsTable(
    records: List<ServiceRecord>,
    prefs: MaintenanceDisplayPrefs,
) {
    var sortState by remember { mutableStateOf(SortState(RECORD_COL_DATE, SortDirection.Desc)) }
    val ascending = sortState.direction == SortDirection.Asc
    val rows =
        remember(records, sortState, prefs) {
            sortServiceRecords(records, sortState.key, ascending).map { deriveRecordRow(it, prefs) }
        }
    val columns: List<TableColumn<MaintenanceRecordRow>> =
        listOf(
            TableColumn(RECORD_COL_DATE, stringResource(R.string.translation_Date), weight = 1.5f, sortable = true) {
                Caption(it.date)
            },
            TableColumn(RECORD_COL_DESCRIPTION, stringResource(R.string.translation_Description), weight = 2f) {
                BodyText(it.description, maxLines = 1)
            },
            TableColumn(RECORD_COL_MILEAGE, stringResource(R.string.translation_Mileage), weight = 1.2f, sortable = true, alignEnd = true) {
                Caption("${it.mileage} ${stringResource(R.string.translation_mi)}")
            },
            TableColumn(RECORD_COL_COST, stringResource(R.string.translation_Cost), weight = 1f, sortable = true, alignEnd = true) {
                BodyText(it.cost, maxLines = 1)
            },
            TableColumn(RECORD_COL_PROVIDER, stringResource(R.string.translation_Provider), weight = 1.2f) {
                Caption(it.provider)
            },
        )
    DataTable(
        columns = columns,
        rows = rows,
        keyOf = { it.id },
        sortState = sortState,
        onSortChange = { key -> sortState = sortState.toggledBy(key) },
        emptyText = stringResource(R.string.translation_No_service_records_found_),
    )
}

// ── Shared helpers ────────────────────────────────────────────────────────────────────────────────────────────────

/** A panel header: a tinted leading [icon] + a [title] (web `<span><Icon/> title</span>` panel labels). */
@Composable
private fun PanelHeader(
    icon: ImageVector,
    title: String,
    tint: Color,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = tint)
        PanelTitle(title)
    }
}

/** A muted icon + caption pairing used in the item-card footer (web small icon+text spans). */
@Composable
private fun IconCaption(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, size = IconSize.Xs, tint = MaterialColorMuted())
        Caption(text)
    }
}

/** The responsive column tier for a window width (web `default` / `sm` / `lg` grid breakpoints). */
private enum class WidthTier { Compact, Medium, Expanded }

private fun widthTier(maxWidth: Dp): WidthTier =
    when {
        maxWidth >= BREAKPOINT_ITEMS_THREE -> WidthTier.Expanded
        maxWidth >= BREAKPOINT_MEDIUM -> WidthTier.Medium
        else -> WidthTier.Compact
    }

/** Lays out [items] in a responsive grid of [content] cells, [columnsAt] the tier-resolved column count. */
@Composable
private fun <T> MetricColumns(
    items: List<T>,
    columnsAt: (tier: WidthTier) -> Int,
    content: @Composable (T) -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = columnsAt(widthTier(maxWidth)).coerceAtLeast(1)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            items.chunked(columns).forEach { rowCells ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowCells.forEach { cell ->
                        Box(modifier = Modifier.weight(1f)) { content(cell) }
                    }
                    repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Renders one row of [columnsAt] skeleton cells of [content] — the loading path of [MetricColumns]. */
@Composable
private fun ResponsiveCardRow(
    columnsAt: (tier: WidthTier) -> Int,
    content: @Composable () -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = columnsAt(widthTier(maxWidth)).coerceAtLeast(1)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            repeat(columns) {
                Box(modifier = Modifier.weight(1f)) { content() }
            }
        }
    }
}

@Composable
private fun MaterialColorMuted(): Color = MaterialTheme.colorScheme.onSurfaceVariant

@Composable
private fun categoryColor(accent: MaintenanceCategoryAccent): Color =
    when (accent) {
        MaintenanceCategoryAccent.Cyan -> TeslaTokens.chart.regen
        MaintenanceCategoryAccent.Red -> TeslaTokens.chart.temperature
        MaintenanceCategoryAccent.Green -> TeslaTokens.chart.battery
        MaintenanceCategoryAccent.Amber -> TeslaTokens.chart.energy
        MaintenanceCategoryAccent.Purple -> TeslaTokens.chart.power
        MaintenanceCategoryAccent.Neutral -> MaterialColorMuted()
    }

@Composable
private fun progressColor(accent: MaintenanceProgressAccent): Color =
    when (accent) {
        MaintenanceProgressAccent.Green -> TeslaTokens.status.success
        MaintenanceProgressAccent.Amber -> TeslaTokens.status.warning
        MaintenanceProgressAccent.Red -> TeslaTokens.status.danger
    }

private fun badgeVariant(tone: MaintenanceBadgeTone): BadgeVariant =
    when (tone) {
        MaintenanceBadgeTone.Success -> BadgeVariant.Success
        MaintenanceBadgeTone.Warning -> BadgeVariant.Warning
        MaintenanceBadgeTone.Danger -> BadgeVariant.Danger
        MaintenanceBadgeTone.Info -> BadgeVariant.Info
    }

@Composable
private fun statusLabel(status: MaintenanceStatus): String =
    when (status) {
        MaintenanceStatus.Good -> stringResource(R.string.translation_Good)
        MaintenanceStatus.Soon -> stringResource(R.string.translation_Due_Soon)
        MaintenanceStatus.Overdue -> stringResource(R.string.translation_Overdue)
        MaintenanceStatus.Completed -> stringResource(R.string.translation_Completed)
    }

// Sort-key wire values (web `SORT_OPTIONS` `value`s).
private const val SORT_STATUS = "status"
private const val SORT_NAME = "name"
private const val SORT_DUE_DATE = "due_date"
private const val SORT_CATEGORY = "category"

private fun categoryFilterValue(filter: MaintenanceCategoryFilter): String =
    when (filter) {
        is MaintenanceCategoryFilter.All -> FILTER_ALL
        is MaintenanceCategoryFilter.Only -> filter.category
    }

private fun categoryFilterOf(value: String): MaintenanceCategoryFilter =
    if (value == FILTER_ALL) MaintenanceCategoryFilter.All else MaintenanceCategoryFilter.Only(value)

private fun sortKeyValue(key: MaintenanceSortKey): String =
    when (key) {
        MaintenanceSortKey.Status -> SORT_STATUS
        MaintenanceSortKey.Name -> SORT_NAME
        MaintenanceSortKey.DueDate -> SORT_DUE_DATE
        MaintenanceSortKey.Category -> SORT_CATEGORY
    }

private fun sortKeyOf(value: String): MaintenanceSortKey =
    when (value) {
        SORT_NAME -> MaintenanceSortKey.Name
        SORT_DUE_DATE -> MaintenanceSortKey.DueDate
        SORT_CATEGORY -> MaintenanceSortKey.Category
        else -> MaintenanceSortKey.Status
    }
