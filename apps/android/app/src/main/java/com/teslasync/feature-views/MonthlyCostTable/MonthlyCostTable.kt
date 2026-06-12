// The native Jetpack Compose + Material 3 MonthlyCostTable feature view — a parity port of
// web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx. The web component is a
// presentational child the Cost Analysis page drives with the `useCostAnalysisData` projection: a GlassPanel
// titled "Monthly Cost Breakdown" (a BarChart icon + heading) wrapping a sortable, paginated `DataTable` of
// per-month buckets (Month / Sessions / Energy / Cost / Avg $/kWh / Gas Equiv / Savings), with a friendly
// centered empty state when there are no months. This native port keeps that composition and additionally
// surfaces the cache-then-network states the P3 contract mandates (loading / empty / error / stale / offline)
// by carrying the one web prop (`data: MonthlyBucket[]`) through the shared S8 [UiState] the sibling surfaces
// use: a skeleton covers the first load, a `QueryError` covers a hard failure with no cache, a friendly
// `EmptyState` covers "no monthly data", and a freshness chip + auto-refresh covers stale/offline cached data.
// The view performs no HTTP — its only data read is the shared settings store for the currency symbol (web
// `useFormatting`). Every visible string resolves through the i18n catalog (P1/S10) and the sortable headers
// carry their semantics through the shared DataTable.
//
// Colors map to design tokens (never raw hex in render code): the web `text-cyan-400` Cost column uses the
// semantic `status.info` token, the `text-red-400` Gas Equiv column uses `status.danger`, and the Savings
// column uses `status.success` / `status.danger` for the web `savings >= 0 ? text-green-400 : text-red-400`
// branch. The header icon uses the theme `primary` accent (the web icon's cyan).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MonthlyCostTable) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.monthlycosttable

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Relative horizontal weight of the leading Month column — wider than the equal numeric columns. */
private const val MONTH_WEIGHT: Float = 1.4f

/** Number of shimmering rows drawn while the first load is in flight (evokes the table body). */
private const val SKELETON_ROWS: Int = 6

/** Height of one loading skeleton bar. */
private val SKELETON_ROW_HEIGHT: Dp = 20.dp

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

/**
 * Stateful entry point. Records the one-shot privacy-safe `view.opened` diagnostic (P1/S11), resolves the
 * user's currency symbol from the shared settings store (web `useFormatting`, P1/S8), and renders every
 * lifecycle [state] the host's cost-analysis feed can carry. The owning page holds the query (P1/S8) and
 * supplies [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the web `data: MonthlyBucket[]` prop.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the cost columns.
 */
@Composable
fun MonthlyCostTable(
    state: UiState<List<MonthlyBucket>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
) {
    LaunchedEffect(Unit) { MonthlyCostTableDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { MonthlyCostCurrencyPrefs.fromSettings(settingsResource.cached) }
    MonthlyCostTableContent(state = state, currency = currency, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `data: MonthlyBucket[]` prop, for hosts that already
 * hold the loaded buckets. An empty (or `null`) list renders the friendly empty state (web
 * `sorted.length > 0 ? table : empty`), a non-empty list renders the sortable table. Records `view.opened`
 * like the stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun MonthlyCostTable(
    data: List<MonthlyBucket>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
) {
    val state =
        remember(data) {
            val buckets = data ?: emptyList()
            val phase = if (buckets.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = buckets)
        }
    MonthlyCostTable(state = state, onRetry = {}, modifier = modifier, logger = logger, settings = settings)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Always shows the
 * titled GlassPanel chrome (the BarChart icon + heading), then swaps the body by state: a skeleton while
 * loading, a `QueryError` with retry on a hard failure with no cache, the friendly empty state when there
 * are no buckets (web `sorted.length === 0`), and otherwise the sortable, paginated cost table — with a
 * freshness chip when the cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] formats the counts, energy, and currency amounts.
 */
@Composable
fun MonthlyCostTableContent(
    state: UiState<List<MonthlyBucket>>,
    modifier: Modifier = Modifier,
    currency: MonthlyCostCurrencyPrefs = MonthlyCostCurrencyPrefs.DEFAULT,
    onRetry: () -> Unit = {},
    locale: Locale = LocalConfiguration.current.locales[0],
    strings: MonthlyCostStrings = rememberMonthlyCostStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRetry()
    }

    val formatters =
        remember(currency, locale) {
            MonthlyCostFormatters(
                currency = { value, precision ->
                    MonthlyCostTableProjection.formatCurrency(value, currency.currencySymbol, precision, locale)
                },
                integer = { value -> MonthlyCostTableProjection.formatInteger(value, locale) },
                energy = { value -> MonthlyCostTableProjection.formatEnergy(value, locale) },
            )
        }

    var sortState by remember { mutableStateOf(SortState(key = MonthlyCostColumnKey.MONTH, direction = SortDirection.Desc)) }

    val buckets = state.data ?: emptyList()
    val sortedRows =
        remember(buckets, sortState, formatters) {
            val sorted = MonthlyCostTableProjection.sortRows(buckets, sortState.key, sortState.direction == SortDirection.Desc)
            MonthlyCostTableProjection.project(sorted, formatters)
        }

    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Md) {
            MonthlyCostHeader(strings.title)
            Spacer(modifier = Modifier.height(Spacing.md))
            when {
                state.isLoading -> MonthlyCostLoading()
                state.isError && !state.hasData ->
                    QueryError(
                        kind = queryErrorKindOf(state),
                        resourceName = strings.title,
                        onRetry = onRetry,
                        modifier = Modifier.fillMaxWidth(),
                    )

                sortedRows.isEmpty() ->
                    EmptyState(
                        message = strings.noData,
                        icon = MonthlyCostGlyphs.BarChart,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else -> MonthlyCostLoaded(state, sortedRows, strings, sortState) { key -> sortState = sortState.toggledBy(key) }
            }
        }
    }
}

@Composable
private fun MonthlyCostLoaded(
    state: UiState<List<MonthlyBucket>>,
    rows: List<MonthlyCostRow>,
    strings: MonthlyCostStrings,
    sortState: SortState,
    onSortChange: (String) -> Unit,
) {
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (showFreshness) {
            MonthlyCostFreshnessRow(state)
        }
        MonthlyCostDataTable(rows = rows, strings = strings, sortState = sortState, onSortChange = onSortChange)
    }
}

/** The web `<h3>` header: a BarChart icon (the theme accent in place of the web `text-cyan-400`) + the title. */
@Composable
private fun MonthlyCostHeader(title: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(
            imageVector = MonthlyCostGlyphs.BarChart,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(title)
    }
}

/**
 * The sortable, paginated cost table — the native analogue of the web `<DataTable … pagination />`. The
 * seven web columns render through [monthlyCostColumns]; the body is paged at [MONTHLY_COST_PAGE_SIZE] (the
 * web `defaultPageSize`) with a [Pagination] footer whose "showing X–Y of Z" summary is localized at the
 * boundary.
 */
@Composable
private fun MonthlyCostDataTable(
    rows: List<MonthlyCostRow>,
    strings: MonthlyCostStrings,
    sortState: SortState,
    onSortChange: (String) -> Unit,
) {
    val total = rows.size
    val pageCount = maxOf(1, (total + MONTHLY_COST_PAGE_SIZE - 1) / MONTHLY_COST_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * MONTHLY_COST_PAGE_SIZE
    val visible = if (total == 0) emptyList() else rows.subList(from, minOf(from + MONTHLY_COST_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    val footer: (@Composable () -> Unit)? =
        if (total > MONTHLY_COST_PAGE_SIZE) {
            {
                Pagination(
                    page = current,
                    pageSize = MONTHLY_COST_PAGE_SIZE,
                    total = total,
                    onPageChange = { page = it },
                    firstLabel = firstLabel,
                    previousLabel = previousLabel,
                    nextLabel = nextLabel,
                    lastLabel = lastLabel,
                    showingText = { start, end, count ->
                        context.getString(R.string.translation_pagination_showing, start, end, count)
                    },
                )
            }
        } else {
            null
        }

    DataTable(
        columns = remember(strings) { monthlyCostColumns(strings) },
        rows = visible,
        keyOf = { it.bucket.month },
        sortState = sortState,
        onSortChange = onSortChange,
        emptyText = strings.noData,
        footer = footer,
    )
}

/**
 * The seven-column layout the web `columns` array defines — Month (sortable, leading) plus the six
 * end-aligned numeric columns (Sessions / Energy / Cost / Avg $/kWh / Gas Equiv / Savings), all sortable.
 * Headers arrive already-localized; the Cost / Gas Equiv / Savings cells carry the web semantic colors via
 * design tokens (cost → `status.info`, gas → `status.danger`, savings → `status.success` / `status.danger`).
 */
private fun monthlyCostColumns(strings: MonthlyCostStrings): List<TableColumn<MonthlyCostRow>> =
    listOf(
        TableColumn(MonthlyCostColumnKey.MONTH, strings.month, weight = MONTH_WEIGHT, sortable = true) {
            BodyText(it.monthText)
        },
        TableColumn(MonthlyCostColumnKey.SESSIONS, strings.sessions, sortable = true, alignEnd = true) {
            BodyText(it.sessionsText)
        },
        TableColumn(MonthlyCostColumnKey.ENERGY, strings.energy, sortable = true, alignEnd = true) {
            BodyText(it.energyText)
        },
        TableColumn(MonthlyCostColumnKey.COST, strings.cost, sortable = true, alignEnd = true) {
            BodyText(it.costText, color = TeslaTokens.status.info)
        },
        TableColumn(MonthlyCostColumnKey.AVG_RATE, strings.avgRate, sortable = true, alignEnd = true) {
            BodyText(it.avgRateText)
        },
        TableColumn(MonthlyCostColumnKey.GAS_EQUIV, strings.gasEquiv, sortable = true, alignEnd = true) {
            BodyText(it.gasEquivText, color = TeslaTokens.status.danger)
        },
        TableColumn(MonthlyCostColumnKey.SAVINGS, strings.savings, sortable = true, alignEnd = true) { row ->
            BodyText(
                row.savingsText,
                color = if (row.savingsNonNegative) TeslaTokens.status.success else TeslaTokens.status.danger,
            )
        },
    )

@Composable
private fun MonthlyCostLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun MonthlyCostFreshnessRow(state: UiState<List<MonthlyBucket>>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
    }
}

/**
 * Resolves the localized [MonthlyCostStrings] from the i18n catalog (P1/S10) — the nine
 * `costAnalysis.table.*` keys the web component reads via `t(...)`. Remembered against the resolved strings
 * so a locale change re-projects the surface.
 */
@Composable
fun rememberMonthlyCostStrings(): MonthlyCostStrings {
    val title = stringResource(R.string.translation_costAnalysis_table_title)
    val month = stringResource(R.string.translation_costAnalysis_table_month)
    val sessions = stringResource(R.string.translation_costAnalysis_table_sessions)
    val energy = stringResource(R.string.translation_costAnalysis_table_energy)
    val cost = stringResource(R.string.translation_costAnalysis_table_cost)
    val avgRate = stringResource(R.string.translation_costAnalysis_table_avgRate)
    val gasEquiv = stringResource(R.string.translation_costAnalysis_table_gasEquiv)
    val savings = stringResource(R.string.translation_costAnalysis_table_savings)
    val noData = stringResource(R.string.translation_costAnalysis_table_noData)
    return remember(title, month, sessions, energy, cost, avgRate, gasEquiv, savings, noData) {
        MonthlyCostStrings(
            title = title,
            month = month,
            sessions = sessions,
            energy = energy,
            cost = cost,
            avgRate = avgRate,
            gasEquiv = gasEquiv,
            savings = savings,
            noData = noData,
        )
    }
}

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/** Classifies a [UiState] failure into the recovery copy the `QueryError` branch shows (mirrors siblings). */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Local monochrome glyphs not present in the shared `ui.TeslaGlyphs` set, drawn as 24×24 stroked
 * [ImageVector]s so they recolor via the `Icon` tint — kept local to this surface rather than expanding the
 * shared icon set from a feature-view prompt (the sibling surfaces follow the same local-glyph pattern).
 */
private object MonthlyCostGlyphs {
    /** Bar chart — the panel header + empty state (web `BarChart3`): three vertical bars of rising height. */
    val BarChart: ImageVector =
        stroked("MonthlyCostBarChart") {
            moveTo(6f, 20f)
            lineTo(6f, 14f)
            moveTo(12f, 20f)
            lineTo(12f, 4f)
            moveTo(18f, 20f)
            lineTo(18f, 10f)
            moveTo(4f, 20f)
            lineTo(20f, 20f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    MonthlyCostStrings(
        title = "Monthly Cost Breakdown",
        month = "Month",
        sessions = "Sessions",
        energy = "Energy",
        cost = "Cost",
        avgRate = "Avg \$/kWh",
        gasEquiv = "Gas Equiv",
        savings = "Savings",
        noData = "No monthly data available",
    )

private val PREVIEW_BUCKETS =
    listOf(
        MonthlyBucket("2026-04", cost = 84.20, energy = 612.5, sessions = 11, avgCostPerKwh = 0.137, gasEquiv = 132.40, savings = 48.20),
        MonthlyBucket("2026-03", cost = 96.75, energy = 705.0, sessions = 14, avgCostPerKwh = 0.137, gasEquiv = 151.10, savings = 54.35),
        MonthlyBucket("2026-02", cost = 71.40, energy = 498.2, sessions = 9, avgCostPerKwh = 0.143, gasEquiv = 64.90, savings = -6.50),
    )

private val PREVIEW_CURRENCY = MonthlyCostCurrencyPrefs("$")

@Preview(name = "Loading", showBackground = true)
@Composable
private fun MonthlyCostTableLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostTableContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            currency = PREVIEW_CURRENCY,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun MonthlyCostTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostTableContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            currency = PREVIEW_CURRENCY,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun MonthlyCostTableErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostTableContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            currency = PREVIEW_CURRENCY,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun MonthlyCostTableContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostTableContent(
            state = UiState(UiPhase.Content, data = PREVIEW_BUCKETS),
            onRetry = {},
            currency = PREVIEW_CURRENCY,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun MonthlyCostTableOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MonthlyCostTableContent(
            state = UiState(UiPhase.Content, data = PREVIEW_BUCKETS, fetchedAt = 1L, stale = true, errorKind = ErrorKind.Network),
            onRetry = {},
            currency = PREVIEW_CURRENCY,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
