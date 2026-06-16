// The native Jetpack Compose + Material 3 DBHealthPage system surface — a parity port of
// web/src/features/system/pages/DBHealthPage.tsx, the database-health dashboard. It reproduces the page's sections
// (the four summary cards — Total DB Size / Tables / Large Tables / Migration Version; the Table-Sizes top-15 bar
// chart; the sortable Tables list; the Migration-Status sidebar panel; and the Connection-Pool sidebar panel),
// every data state (loading / empty / error / content) at both the page level and per bound read, and every visible
// string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [DBHealthPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the combined feed + the sort interaction); [DBHealthPageContent]
// is the stateless render layer driven entirely by [UiState] + [DBHealthInteraction] + [DBHealthActions]. All
// derivation lives in the framework-free model (DBHealthPageModel.kt); this file only resolves i18n + draws. The
// three shared reads are bound through the view-model (P1/S8); no HTTP touches the view. None of the values is
// unit-bearing (byte counts, row counts, a migration version, pool gauges), so there is no SI conversion (S5) —
// byte + locale-number formatting is applied here at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.system.dbhealth

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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.util.Locale

/** The page's interaction callbacks, wired to the [DBHealthPageViewModel] (web event handlers). */
data class DBHealthActions(
    val onSortKey: (TableSortKey) -> Unit,
    val onRefresh: () -> Unit,
    val onRetry: () -> Unit,
)

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 40

/** Bar-chart height — web `<ChartContainer height={300}>`. */
private val CHART_HEIGHT = 300.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DBHealthPageViewModel] over the supplied [source] (the host wires the shared S8
 * [io.teslasync.shared.core.presentation.admin.AdminStore] via [asDBHealthSource]). [logger] defaults to the app's
 * redacting logger.
 */
@Composable
fun DBHealthPage(
    source: DBHealthSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DBHealthPageViewModel =
        viewModel(
            key = DBHealthPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DBHealthPageViewModel(source, logger) } },
        )
    DBHealthPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: records the one-shot `view.opened` diagnostic and binds the feed + sort snapshot to the content. */
@Composable
fun DBHealthPage(
    viewModel: DBHealthPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            DBHealthActions(
                onSortKey = viewModel::setSortKey,
                onRefresh = viewModel::refresh,
                onRetry = viewModel::retry,
            )
        }

    DBHealthPageContent(state = state, interaction = interaction, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, then the phase-appropriate surface (loading / empty / error / content). */
@Composable
fun DBHealthPageContent(
    state: UiState<DBHealthData>,
    interaction: DBHealthInteraction,
    actions: DBHealthActions,
    modifier: Modifier = Modifier,
) {
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
        DBHealthHeader()

        when (state.phase) {
            UiPhase.Loading -> DBHealthLoadingState()
            UiPhase.Error -> DBHealthErrorState(onRetry = actions.onRetry)
            UiPhase.Empty -> DBHealthEmptyState()
            UiPhase.Content ->
                DBHealthContent(
                    data = state.data ?: DBHealthData.EMPTY,
                    interaction = interaction,
                    offline = state.isOffline,
                    numbers = numbers,
                    actions = actions,
                )
        }
    }
}

/** The page header — title, subtitle, and the auto-refresh affordance (web `PageContainer` title/subtitle/actions). */
@Composable
private fun DBHealthHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_dbHealth_title), modifier = Modifier.semantics { heading() })
            BodyText(
                stringResource(R.string.translation_dbHealth_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                DBHealthGlyphs.RefreshCw,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(stringResource(R.string.translation_dbHealth_autoRefresh))
        }
    }
}

// ── Page-level data states ──────────────────────────────────────────────────────────────────────────────────

@Composable
private fun DBHealthLoadingState() {
    GlassPanel {
        Box(modifier = Modifier.fillMaxWidth().padding(Spacing.xl2), contentAlignment = Alignment.Center) {
            Spinner(size = SpinnerSize.Lg)
        }
    }
}

@Composable
private fun DBHealthEmptyState() {
    GlassPanel {
        EmptyState(
            message = stringResource(R.string.translation_dbHealth_noTables),
            icon = DBHealthGlyphs.Database,
        )
    }
}

@Composable
private fun DBHealthErrorState(onRetry: () -> Unit) {
    AlertBanner(
        message = stringResource(R.string.translation_dbHealth_error),
        tone = Tone.Danger,
        icon = DBHealthGlyphs.AlertTriangle,
        action = BannerAction(stringResource(R.string.translation_queryError_retry), onRetry),
    )
}

// ── Content (success) ───────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun DBHealthContent(
    data: DBHealthData,
    interaction: DBHealthInteraction,
    offline: Boolean,
    numbers: NumberFormat,
    actions: DBHealthActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (offline) {
            AlertBanner(
                message = stringResource(R.string.translation_dbHealth_error),
                tone = Tone.Warning,
                icon = DBHealthGlyphs.AlertTriangle,
                action = BannerAction(stringResource(R.string.translation_queryError_retry), actions.onRetry),
            )
        }
        FadeIn { SummaryCards(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS) { TableSizesChart(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { TablesPanel(data = data, interaction = interaction, numbers = numbers, actions = actions) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { MigrationPanel(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { ConnectionPoolPanel(data = data, numbers = numbers) }
    }
}

// ── Panels 1-4: summary cards ────────────────────────────────────────────────────────────────────────────────

/** The four KPI tiles — web `Grid cols={{ default: 2, lg: 4 }}` of `StatCard`s. */
@Composable
private fun SummaryCards(
    data: DBHealthData,
    numbers: NumberFormat,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                label = stringResource(R.string.translation_dbHealth_totalSize),
                value = data.databaseSizeDisplay,
                icon = DBHealthGlyphs.Database,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_dbHealth_tables),
                value = numbers.format(data.tableCount),
                icon = DBHealthGlyphs.Database,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                label = stringResource(R.string.translation_dbHealth_largeTables),
                value = numbers.format(data.largeTableCount),
                icon = DBHealthGlyphs.AlertTriangle,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_dbHealth_migration),
                value = data.migrationVersionDisplay,
                icon = DBHealthGlyphs.CheckCircle,
                loading = data.migrationPhase == SourcePhase.Loading,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

// ── Panel 5 / charts: Table-Sizes top-15 bar chart ─────────────────────────────────────────────────────────────

/** The top-15 table-size bar chart — web `ChartContainer` + `BarChart` (Table-Sizes-Top-15). */
@Composable
private fun TableSizesChart(
    data: DBHealthData,
    numbers: NumberFormat,
) {
    val bars = data.chartBars()
    val colLabels =
        listOf(
            stringResource(R.string.translation_dbHealth_col_table),
            stringResource(R.string.translation_dbHealth_col_rows),
        )
    ChartContainer(
        title = stringResource(R.string.translation_dbHealth_chartTitle),
        accessibleDescription = stringResource(R.string.translation_dbHealth_chartTitle_aria),
        status = if (bars.isEmpty()) ChartStatus.Empty else ChartStatus.Ready,
        height = CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_dbHealth_noTables),
        dataTableHeader = colLabels,
        dataTableRows = bars.map { listOf(it.label, numbers.format(it.rows)) },
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "rows",
                        label = stringResource(R.string.translation_dbHealth_rows),
                        values = bars.map { it.rows.asDouble() },
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(0),
                    ),
                ),
            xLabels = bars.map { it.label },
            height = CHART_HEIGHT,
            yValueFormatter = { numbers.format(it.toLong()) },
        )
    }
}

// ── Panel 6: Tables list ───────────────────────────────────────────────────────────────────────────────────────

/** The sortable Tables list — web GlassPanel with the sort controls + `DataTable` (GlassPanel6). */
@Composable
private fun TablesPanel(
    data: DBHealthData,
    interaction: DBHealthInteraction,
    numbers: NumberFormat,
    actions: DBHealthActions,
) {
    GlassPanel {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(stringResource(R.string.translation_dbHealth_tablesTitle), modifier = Modifier.weight(1f))
            Icon(
                DBHealthGlyphs.ArrowUpDown,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        SortControls(active = interaction.sortKey, onSortKey = actions.onSortKey)
        Box(modifier = Modifier.padding(top = Spacing.sm)) {
            TablesTable(rows = data.sortedTables(interaction.sortKey), numbers = numbers)
        }
    }
}

/** The three sort buttons (web `['size','rows','name'].map(<Button variant=primary|secondary>)`). */
@Composable
private fun SortControls(
    active: TableSortKey,
    onSortKey: (TableSortKey) -> Unit,
) {
    val options =
        listOf(
            TableSortKey.Size to stringResource(R.string.translation_dbHealth_sort_size),
            TableSortKey.Rows to stringResource(R.string.translation_dbHealth_sort_rows),
            TableSortKey.Name to stringResource(R.string.translation_dbHealth_sort_name),
        )
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        options.forEach { (key, label) ->
            Button(
                label = label,
                onClick = { onSortKey(key) },
                variant = if (key == active) ButtonVariant.Primary else ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The five-column table (web `DataTable` columns: name / rows / size / indexes / last-vacuum). */
@Composable
private fun TablesTable(
    rows: List<DbTable>,
    numbers: NumberFormat,
) {
    val columns =
        listOf(
            TableColumn<DbTable>(
                key = "name",
                header = stringResource(R.string.translation_dbHealth_table_name),
                weight = 2.4f,
            ) { tbl -> TableNameCell(tbl) },
            TableColumn<DbTable>(
                key = "rows",
                header = stringResource(R.string.translation_dbHealth_table_rows),
                weight = 1.3f,
                alignEnd = true,
            ) { tbl -> CodeText(numbers.format(tbl.rowCount)) },
            TableColumn<DbTable>(
                key = "size",
                header = stringResource(R.string.translation_dbHealth_table_size),
                weight = 1.2f,
                alignEnd = true,
            ) { tbl -> CodeText(tbl.sizeBytes?.let { formatBytes(it) } ?: EM_DASH) },
            TableColumn<DbTable>(
                key = "indexes",
                header = stringResource(R.string.translation_dbHealth_table_indexes),
                weight = 1f,
                alignEnd = true,
            ) { tbl -> CodeText(tbl.indexCount?.let { numbers.format(it) } ?: EM_DASH) },
            TableColumn<DbTable>(
                key = "vacuum",
                header = stringResource(R.string.translation_dbHealth_table_lastVacuum),
                weight = 1.6f,
                alignEnd = true,
            ) { tbl -> CodeText(tbl.lastVacuum ?: EM_DASH) },
        )
    DataTable(
        columns = columns,
        rows = rows,
        keyOf = { it.name },
        emptyText = stringResource(R.string.translation_dbHealth_noTables),
    )
}

/** The table-name cell: a large-table warning glyph + the (monospace) name, tinted amber when large (web). */
@Composable
private fun TableNameCell(tbl: DbTable) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (tbl.isLarge) {
            Icon(
                DBHealthGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Xs,
                tint = TeslaTokens.status.warning,
            )
        }
        CodeText(
            tbl.name,
            modifier = Modifier.weight(1f),
        )
    }
}

// ── Panel 7: Migration status ──────────────────────────────────────────────────────────────────────────────────

/** The migration-status sidebar panel — web GlassPanel (GlassPanel7), with its own loading/empty/error/content. */
@Composable
private fun MigrationPanel(
    data: DBHealthData,
    numbers: NumberFormat,
) {
    GlassPanel {
        PanelTitle(stringResource(R.string.translation_dbHealth_migrationTitle))
        Box(modifier = Modifier.padding(top = Spacing.md)) {
            when (data.migrationPhase) {
                SourcePhase.Loading -> Skeleton(height = 128.dp)
                SourcePhase.Error -> PanelInlineError()
                SourcePhase.Empty ->
                    EmptyState(message = stringResource(R.string.translation_dbHealth_noMigrationData))
                SourcePhase.Content -> MigrationContent(migration = data.migration, numbers = numbers)
            }
        }
    }
}

@Composable
private fun MigrationContent(
    migration: MigrationStatusData?,
    numbers: NumberFormat,
) {
    if (migration == null) {
        EmptyState(message = stringResource(R.string.translation_dbHealth_noMigrationData))
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        KeyValueRow(
            label = stringResource(R.string.translation_dbHealth_currentVersion),
            value = migration.version,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(stringResource(R.string.translation_dbHealth_status))
            BodyText(
                text =
                    if (migration.dirty) {
                        stringResource(R.string.translation_dbHealth_dirty)
                    } else {
                        stringResource(R.string.translation_dbHealth_clean)
                    },
                color = if (migration.dirty) TeslaTokens.status.danger else TeslaTokens.status.success,
            )
        }
        if (migration.pending > 0) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Caption(stringResource(R.string.translation_dbHealth_pending))
                BodyText(numbers.format(migration.pending), color = TeslaTokens.status.warning)
            }
        }
        RecentMigrations(migration = migration)
    }
}

/** The "Recent Migrations" sub-section: the five newest, or an empty state when none (web nested empty). */
@Composable
private fun RecentMigrations(migration: MigrationStatusData) {
    if (migration.recentMigrations.isEmpty()) {
        EmptyState(message = stringResource(R.string.translation_dbHealth_noMigrations))
        return
    }
    Column(
        modifier = Modifier.padding(top = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(stringResource(R.string.translation_dbHealth_recentMigrations))
        migration.recentMigrations.forEach { entry ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CodeText("v${entry.version} ${entry.name}".trim(), modifier = Modifier.weight(1f))
                val applied = entry.appliedAt
                if (!applied.isNullOrBlank()) {
                    Caption(applied)
                }
            }
        }
    }
}

// ── Panel 8: Connection pool ───────────────────────────────────────────────────────────────────────────────────

/** The connection-pool sidebar panel — web GlassPanel (GlassPanel8), with its own loading/empty/error/content. */
@Composable
private fun ConnectionPoolPanel(
    data: DBHealthData,
    numbers: NumberFormat,
) {
    GlassPanel {
        PanelTitle(stringResource(R.string.translation_dbHealth_poolTitle))
        Box(modifier = Modifier.padding(top = Spacing.md)) {
            when (data.poolPhase) {
                SourcePhase.Loading -> Skeleton(height = 160.dp)
                SourcePhase.Error -> PanelInlineError()
                SourcePhase.Empty ->
                    EmptyState(message = stringResource(R.string.translation_dbHealth_noPoolData))
                SourcePhase.Content -> PoolContent(pool = data.pool, numbers = numbers)
            }
        }
    }
}

@Composable
private fun PoolContent(
    pool: PoolStats?,
    numbers: NumberFormat,
) {
    if (pool == null) {
        EmptyState(message = stringResource(R.string.translation_dbHealth_noPoolData))
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        KeyValueRow(stringResource(R.string.translation_dbHealth_pool_maxOpen), numbers.format(pool.maxOpen))
        KeyValueRow(stringResource(R.string.translation_dbHealth_pool_open), numbers.format(pool.open))
        KeyValueRow(stringResource(R.string.translation_dbHealth_pool_inUse), numbers.format(pool.inUse))
        KeyValueRow(stringResource(R.string.translation_dbHealth_pool_idle), numbers.format(pool.idle))
        KeyValueRow(stringResource(R.string.translation_dbHealth_pool_waitCount), numbers.format(pool.waitCount))
        KeyValueRow(
            stringResource(R.string.translation_dbHealth_pool_waitDuration),
            "${numbers.format(pool.waitDurationMs)}ms",
        )
        MetricBar(
            value = pool.inUse.asDouble(),
            max = pool.maxOpen.asDouble(),
            label = stringResource(R.string.translation_dbHealth_poolUsage),
            valueText = "${pool.usagePercent}%",
            color = if (pool.usageIsDanger) TeslaTokens.status.danger else TeslaTokens.chart.speed,
            modifier = Modifier.padding(top = Spacing.xs),
        )
    }
}

// ── Shared row primitives ──────────────────────────────────────────────────────────────────────────────────────

/** A label↔value row mirroring the web sidebar rows (muted caption left, mono value right). */
@Composable
private fun KeyValueRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label)
        CodeText(value)
    }
}

/** Inline per-panel error surface (a still-visible region with a retry-bearing page-level affordance above). */
@Composable
private fun PanelInlineError() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            DBHealthGlyphs.AlertTriangle,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.danger,
        )
        BodyText(stringResource(R.string.translation_dbHealth_error), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
