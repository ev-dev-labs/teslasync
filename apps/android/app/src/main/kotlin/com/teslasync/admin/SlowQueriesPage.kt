// The native Jetpack Compose + Material 3 SlowQueriesPage admin surface — a parity port of
// web/src/features/admin/pages/SlowQueriesPage.tsx, the pg_stat_statements top-N slow-query report. It
// reproduces the page's panel (GlassPanel1 — the "Top queries" table with its order-by + limit controls and the
// seven-column fingerprint / calls / mean / max / total / rows / cache-hit-ratio table), the
// subsystem-unavailable banner (web 503 `pg_stat_statements` not installed), every data state
// (loading / empty / error / success), and every visible string (resolved from the generated res/values
// catalog, ADR-014).
//
// Composition: [SlowQueriesPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed + interaction snapshot);
// [SlowQueriesPageContent] is the stateless render layer driven entirely by [UiState] + [SlowQueriesInteraction]
// + [SlowQueriesActions]. All derivation lives in the framework-free model (SlowQueriesPageModel.kt); this file
// only resolves i18n + draws. None of the columns is unit-bearing (counts, the millisecond timings the backend
// already computed, and a derived percentage), so there is no SI conversion — locale number formatting is
// applied here at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.slowqueries

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.SectionErrorBoundary
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.rememberErrorBoundaryState
import io.teslasync.android.components.motion.FadeIn
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
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueriesResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueryOrderBy
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueryRow
import java.text.NumberFormat
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 40

/** Width of the (monospace) fingerprint column; the table scrolls horizontally for the numeric columns. */
private val FINGERPRINT_COL_WIDTH: Dp = 240.dp

/** Width of each right-aligned numeric column (calls / mean / max / total / rows). */
private val NUMERIC_COL_WIDTH: Dp = 96.dp

/** Width of the cache-hit-ratio column (slightly wider for the "100.0%" + header). */
private val CACHE_COL_WIDTH: Dp = 120.dp

/** Full intrinsic width of the table (fingerprint + five numeric columns + cache), the scroll content width. */
private val TABLE_WIDTH: Dp = FINGERPRINT_COL_WIDTH + NUMERIC_COL_WIDTH * 5 + CACHE_COL_WIDTH

/** The page's interaction callbacks, wired to the [SlowQueriesPageViewModel] (web event handlers). */
data class SlowQueriesActions(
    val onOrderBy: (SlowQueryOrderBy) -> Unit,
    val onLimit: (Int) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SlowQueriesPageViewModel] over the supplied [source] (the host wires the
 * shared Operator-Confidence holder via [asSlowQueriesSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun SlowQueriesPage(
    source: SlowQueriesSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SlowQueriesPageViewModel =
        viewModel(
            key = SlowQueriesPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SlowQueriesPageViewModel(source, logger) } },
        )
    SlowQueriesPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic and binds the feed + interaction snapshot to the
 * stateless content.
 */
@Composable
fun SlowQueriesPage(
    viewModel: SlowQueriesPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            SlowQueriesActions(
                onOrderBy = viewModel::setOrderBy,
                onLimit = viewModel::setLimit,
                onRetry = viewModel::retry,
            )
        }

    SlowQueriesPageContent(state = state, interaction = interaction, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header, the optional subsystem-unavailable banner (web 503), then
 * the single panel — the order-by / limit controls and the slow-query table with its loading / error / empty /
 * success surface.
 */
@Composable
fun SlowQueriesPageContent(
    state: UiState<SlowQueriesResponse>,
    interaction: SlowQueriesInteraction,
    actions: SlowQueriesActions,
    modifier: Modifier = Modifier,
) {
    val subsystemMissing = state.httpStatus == HTTP_SUBSYSTEM_UNAVAILABLE
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val numbers = remember(locale) { SlowQueriesNumberFormats(locale) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SlowQueriesHeader()

        if (subsystemMissing) {
            FadeIn { SubsystemUnavailableBanner() }
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            SlowQueriesPanel(
                state = state,
                interaction = interaction,
                subsystemMissing = subsystemMissing,
                numbers = numbers,
                actions = actions,
            )
        }
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun SlowQueriesHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_slowQueries_pageTitle))
        BodyText(
            stringResource(R.string.translation_admin_slowQueries_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The 503 subsystem-not-configured banner (web `<AlertBanner variant="warning">`). */
@Composable
private fun SubsystemUnavailableBanner() {
    AlertBanner(
        message = stringResource(R.string.translation_admin_slowQueries_notConfigured),
        tone = Tone.Warning,
        title = stringResource(R.string.translation_admin_subsystem_unavailableTitle),
    )
}

// ── GlassPanel1 — "Top queries" controls + table ──────────────────────────────────────────────────────────────

/**
 * The single panel: the "Top queries" title, the order-by + limit selects, and the table surface that switches
 * across loading / hard-error / empty / content. Under the 503 subsystem-missing branch it renders the empty
 * table (web `<DataTable data={[]} />` below the banner) so the region is never blank.
 */
@Composable
private fun SlowQueriesPanel(
    state: UiState<SlowQueriesResponse>,
    interaction: SlowQueriesInteraction,
    subsystemMissing: Boolean,
    numbers: SlowQueriesNumberFormats,
    actions: SlowQueriesActions,
) {
    val tableTitle = stringResource(R.string.translation_admin_slowQueries_tableTitle)
    val rows = state.data?.slowQueries.orEmpty()

    GlassPanel(
        padding = PanelPadding.Md,
        modifier = Modifier.semantics { contentDescription = tableTitle },
    ) {
        PanelTitle(tableTitle)
        SlowQueriesControls(interaction = interaction, actions = actions)

        HorizontalDivider(
            modifier = Modifier.padding(vertical = Spacing.md),
            color = MaterialTheme.colorScheme.outlineVariant,
        )

        val boundary = rememberErrorBoundaryState()
        SectionErrorBoundary(state = boundary) {
            when {
                subsystemMissing -> SlowQueriesTable(rows = emptyList(), numbers = numbers)
                state.isLoading -> SlowQueriesLoadingState()
                state.isError -> SlowQueriesErrorState(onRetry = actions.onRetry)
                state.isEmpty -> SlowQueriesEmptyState()
                else -> SlowQueriesTable(rows = rows, numbers = numbers)
            }
        }
    }
}

/** The order-by + limit selects (web's two `<Select>` controls in the panel header). */
@Composable
private fun SlowQueriesControls(
    interaction: SlowQueriesInteraction,
    actions: SlowQueriesActions,
) {
    val orderLabels: Map<SlowQueryOrderBy, String> =
        mapOf(
            SlowQueryOrderBy.MEAN_TIME to stringResource(R.string.translation_admin_slowQueries_orderMean),
            SlowQueryOrderBy.TOTAL_TIME to stringResource(R.string.translation_admin_slowQueries_orderTotal),
            SlowQueryOrderBy.CALLS to stringResource(R.string.translation_admin_slowQueries_orderCalls),
            SlowQueryOrderBy.MAX_TIME to stringResource(R.string.translation_admin_slowQueries_orderMax),
        )
    val orderOptions = SLOW_QUERY_ORDER_OPTIONS.map { SelectOption(it.wire, orderLabels.getValue(it)) }
    val limitOptions = SLOW_QUERY_LIMIT_OPTIONS.map { SelectOption(it.toString(), it.toString()) }

    Column(
        modifier = Modifier.padding(top = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(stringResource(R.string.translation_admin_slowQueries_orderBy))
            Select(
                options = orderOptions,
                selectedValue = interaction.orderBy.wire,
                onSelect = { actions.onOrderBy(slowQueryOrderByFromWire(it)) },
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(stringResource(R.string.translation_admin_slowQueries_limit))
            Select(
                options = limitOptions,
                selectedValue = interaction.limit.toString(),
                onSelect = { actions.onLimit(it.toIntOrNull() ?: interaction.limit) },
            )
        }
    }
}

// ── Table + data states ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The seven-column slow-query table (web `<DataTable>`): fingerprint, calls, mean, max, total, rows, and the
 * derived cache-hit ratio. It scrolls horizontally so every column stays legible on a phone. With no [rows] it
 * renders the table's own empty message (web DataTable `emptyMessage`), reached under the 503 subsystem-missing
 * branch below the banner.
 */
@Composable
private fun SlowQueriesTable(
    rows: List<SlowQueryRow>,
    numbers: SlowQueriesNumberFormats,
) {
    if (rows.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xl2),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BodyText(
                stringResource(R.string.translation_admin_slowQueries_emptyTable),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    Column(modifier = Modifier.horizontalScroll(rememberScrollState())) {
        SlowQueriesTableHeader()
        HorizontalDivider(
            modifier = Modifier.width(TABLE_WIDTH),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        rows.forEachIndexed { index, row ->
            if (index > 0) {
                HorizontalDivider(
                    modifier = Modifier.width(TABLE_WIDTH),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
            }
            SlowQueriesTableRow(row = row, numbers = numbers)
        }
    }
}

/** The table header row — the seven localized column labels (web `Column.header`). */
@Composable
private fun SlowQueriesTableHeader() {
    Row(modifier = Modifier.width(TABLE_WIDTH).padding(vertical = Spacing.sm)) {
        HeaderCell(stringResource(R.string.translation_admin_slowQueries_colFingerprint), FINGERPRINT_COL_WIDTH, alignEnd = false)
        HeaderCell(stringResource(R.string.translation_admin_slowQueries_colCalls), NUMERIC_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_slowQueries_colMean), NUMERIC_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_slowQueries_colMax), NUMERIC_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_slowQueries_colTotal), NUMERIC_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_slowQueries_colRows), NUMERIC_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_slowQueries_colCache), CACHE_COL_WIDTH, alignEnd = true)
    }
}

/** One data row — the fingerprint plus the six right-aligned numeric/derived columns. */
@Composable
private fun SlowQueriesTableRow(
    row: SlowQueryRow,
    numbers: SlowQueriesNumberFormats,
) {
    Row(
        modifier = Modifier.width(TABLE_WIDTH).padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.width(FINGERPRINT_COL_WIDTH).padding(end = Spacing.sm),
            contentAlignment = Alignment.CenterStart,
        ) {
            CodeText(row.fingerprintOrDash())
        }
        NumericCell(numbers.count(row.calls), NUMERIC_COL_WIDTH)
        NumericCell(numbers.millis2(row.meanTimeMs), NUMERIC_COL_WIDTH)
        NumericCell(numbers.millis2(row.maxTimeMs), NUMERIC_COL_WIDTH)
        NumericCell(numbers.total(row.totalTimeMs), NUMERIC_COL_WIDTH)
        NumericCell(numbers.count(row.rowsReturned), NUMERIC_COL_WIDTH)
        NumericCell(cacheHitText(row, numbers), CACHE_COL_WIDTH)
    }
}

@Composable
private fun HeaderCell(
    text: String,
    width: Dp,
    alignEnd: Boolean,
) {
    Box(
        modifier = Modifier.width(width).padding(horizontal = Spacing.xs),
        contentAlignment = if (alignEnd) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Caption(text)
    }
}

@Composable
private fun NumericCell(
    text: String,
    width: Dp,
) {
    Box(
        modifier = Modifier.width(width).padding(horizontal = Spacing.xs),
        contentAlignment = Alignment.CenterEnd,
    ) {
        BodyText(text, maxLines = 1)
    }
}

/** First-load surface — a centered spinner so the table region is never blank. */
@Composable
private fun SlowQueriesLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md)
    }
}

/** Hard-error surface with a retry affordance (web page-tier error). */
@Composable
private fun SlowQueriesErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            SlowQueriesGlyphs.AlertCircle,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.error,
        )
        ErrorText(stringResource(R.string.translation_error_loadFailed))
        Button(
            label = stringResource(R.string.translation_error_retry),
            onClick = onRetry,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

/**
 * No-slow-queries empty state (web `<EmptyState icon={Timer} title={emptyTitle} message={emptyMessage} />`):
 * pg_stat_statements is empty or has been reset recently.
 */
@Composable
private fun SlowQueriesEmptyState() {
    EmptyState(
        message = stringResource(R.string.translation_admin_slowQueries_emptyMessage),
        icon = SlowQueriesGlyphs.Timer,
        title = stringResource(R.string.translation_admin_slowQueries_emptyTitle),
    )
}

// ── Render helpers ────────────────────────────────────────────────────────────────────────────────────────────

/** The cache-hit-ratio cell text: the derived percentage to one decimal, or the em-dash (web `cacheHitRatio`). */
private fun cacheHitText(
    row: SlowQueryRow,
    numbers: SlowQueriesNumberFormats,
): String {
    val percent = row.cacheHitPercent() ?: return EM_DASH
    return "${numbers.percent(percent)}%"
}

/**
 * Locale-aware number formatters built once per locale at the render boundary — the native analogue of the web
 * `fmtNumber(value, decimals)`. Counts use grouped integers; mean/max use two decimals; total rounds to a whole
 * millisecond; the cache ratio uses one decimal.
 */
private class SlowQueriesNumberFormats(locale: Locale) {
    private val integer = NumberFormat.getIntegerInstance(locale)
    private val whole = fixed(locale, 0)
    private val oneDecimal = fixed(locale, 1)
    private val twoDecimals = fixed(locale, 2)

    fun count(value: Long): String = integer.format(value)

    fun millis2(value: Double): String = twoDecimals.format(value)

    fun total(value: Double): String = whole.format(value)

    fun percent(value: Double): String = oneDecimal.format(value)

    private companion object {
        fun fixed(
            locale: Locale,
            digits: Int,
        ): NumberFormat =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = digits
                maximumFractionDigits = digits
            }
    }
}
