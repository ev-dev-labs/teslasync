// The native Jetpack Compose + Material 3 SignalLogViewerPage telemetry surface — a parity port of
// web/src/features/telemetry/pages/SignalLogViewerPage.tsx, the /signal-log "query signal history from Postgres"
// workspace. It reproduces the web page exactly: the title/subtitle header with the global `<VehicleSelect />` action,
// the page-level error banner (web `AlertBanner` on the query failure), the "select a vehicle to begin" empty state
// while no vehicle is selected, and otherwise the query-controls GlassPanel (the shared SignalSelector multi-select +
// the Time-Range date filter + the Per-Page select + the Query button + the "{n} records" caption) followed by either
// the "select signals and click Query" pre-query empty state or the shared SignalHistoryTable bound to the locally
// paginated result page. Every data state (loading / empty / error / success) renders from the bound `UiState`; every
// visible string resolves from the generated res/values catalog (ADR-014); SI values are converted only at the table's
// render boundary (S5).
//
// Composition: [SignalLogViewerPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the single page state); [SignalLogViewerPageContent] is the
// stateless render layer driven by the immutable [SignalLogViewerUiState] + the [SignalLogViewerActions] callbacks. The
// shared SignalSelector / SignalHistoryTable feature views are reused verbatim (DRY, ADR-006), exactly as the sibling
// telemetry/SignalGapDetectorPage embeds the shared SignalCatalogPanel.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod` for the parity-complete control panel.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "LongMethod")

package io.teslasync.android.telemetry.signallogviewer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.signalhistorytable.SignalHistoryTable
import io.teslasync.android.featureviews.signalselector.SignalSelector
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate

/** The width of the "Per Page" select so it sits beside the Query button without stretching (web `className="w-24"`). */
private val PER_PAGE_WIDTH = 132.dp

/** The page's interaction callbacks, wired to the [SignalLogViewerPageViewModel] (web event handlers). */
data class SignalLogViewerActions(
    val onSelectedSignalsChange: (List<String>) -> Unit,
    val onSetRange: (LocalDate, LocalDate) -> Unit,
    val onPerPageChange: (Int) -> Unit,
    val onPageChange: (Int) -> Unit,
    val onQuery: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SignalLogViewerPageViewModel] over the host-wired [source] (the shared telemetry
 * repository + the app-scoped active-vehicle selection via [signalLogViewerPageSourceOf]), records the one-shot
 * `view.opened` diagnostic (P1/S11), and renders the content. [logger] defaults to the app's redacting logger.
 */
@Composable
fun SignalLogViewerPage(
    source: SignalLogViewerPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SignalLogViewerPageViewModel =
        viewModel(
            key = SignalLogViewerPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SignalLogViewerPageViewModel(source, logger) } },
        )
    SignalLogViewerPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] page state + interaction callbacks to the stateless content. */
@Composable
fun SignalLogViewerPage(
    viewModel: SignalLogViewerPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            SignalLogViewerActions(
                onSelectedSignalsChange = viewModel::setSelectedSignals,
                onSetRange = viewModel::setRange,
                onPerPageChange = viewModel::setPerPage,
                onPageChange = viewModel::setPage,
                onQuery = viewModel::query,
                onRetry = viewModel::retry,
            )
        }
    SignalLogViewerPageContent(state = state, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the unit/UI-test + preview entry point. Always draws the title/subtitle/picker header and
 * the page-level error banner, then picks the same branch the web does: the friendly "select a vehicle" empty state
 * while no vehicle is selected, or the query-controls panel followed by the pre-query empty state / the result table.
 * Scrolls vertically so the result table is always reachable on a phone.
 */
@Composable
fun SignalLogViewerPageContent(
    state: SignalLogViewerUiState,
    actions: SignalLogViewerActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SignalLogViewerHeader()

        state.errorMessage?.let { detail -> SignalLogViewerErrorBanner(detail) }

        if (!state.hasVehicle) {
            SignalLogViewerNoVehicle()
        } else {
            SignalLogViewerControlsPanel(state = state, actions = actions)
            if (!state.hasQueried) {
                SignalLogViewerPreQueryEmpty()
            } else {
                SignalHistoryTable(
                    state = state.results,
                    onPageChange = actions.onPageChange,
                    onRetry = actions.onRetry,
                    title = stringResource(R.string.translation_Signal_Log),
                )
            }
        }
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the title heading, the descriptive subtitle, and the
 * `<VehicleSelect />` action (the global vehicle-scope picker, bound to the shared selection store). Stacked so the
 * full-width picker has room on a phone.
 */
@Composable
private fun SignalLogViewerHeader() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_Signal_Log_Viewer))
            BodyText(
                text = stringResource(R.string.translation_Query_signal_history_from_Postgres),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        VehicleSelect()
    }
}

/** The page-level error banner — the web `<AlertBanner variant="danger">{t('error.loadFailed')}: {detail}</AlertBanner>`. */
@Composable
private fun SignalLogViewerErrorBanner(detail: String) {
    AlertBanner(
        message = "${stringResource(R.string.translation_error_loadFailed)}: $detail",
        tone = Tone.Danger,
    )
}

/**
 * The "select a vehicle to begin" branch — the web `<EmptyState icon={<Activity/>} title={t('signalLog.noVehicle')}
 * message={t('signalLog.noVehicleDesc')} />`, shown while no vehicle is selected. The vehicle picker is in the header
 * above, so no inline CTA is needed (web comment). Never a blank region.
 */
@Composable
private fun SignalLogViewerNoVehicle() {
    EmptyState(
        message = stringResource(R.string.translation_signalLog_noVehicleDesc),
        modifier = Modifier.fillMaxWidth(),
        icon = NavGlyphs.Pulse,
        title = stringResource(R.string.translation_signalLog_noVehicle),
    )
}

/**
 * The query-controls panel (web `GlassPanel1`) — the shared SignalSelector multi-select (uncapped, web `max={null}`),
 * the Time-Range date filter (web `RangePicker`), and the Per-Page select + Query button + "{n} records" caption (web
 * `Select` + `Button` + the records badge). The Query button shows a spinner while the deferred query is in flight and
 * is disabled until a vehicle + at least one signal are chosen (web `disabled={!canQuery} loading={isFetching}`).
 */
@Composable
private fun SignalLogViewerControlsPanel(
    state: SignalLogViewerUiState,
    actions: SignalLogViewerActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SignalSelector(
                options = state.availableSignals,
                value = state.selectedSignals,
                onChange = actions.onSelectedSignalsChange,
                max = null,
            )

            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                MetricLabel(stringResource(R.string.translation_Time_Range))
                DateRangeFilter(
                    startEpochDay = state.from.toEpochDay(),
                    endEpochDay = state.to.toEpochDay(),
                    onRangeChange = { start, end ->
                        actions.onSetRange(
                            start?.let(LocalDate::ofEpochDay) ?: state.from,
                            end?.let(LocalDate::ofEpochDay) ?: state.to,
                        )
                    },
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                verticalAlignment = Alignment.Bottom,
            ) {
                Select(
                    options = SIGNAL_LOG_PER_PAGE_OPTIONS.map { SelectOption(value = it.toString(), label = it.toString()) },
                    selectedValue = state.perPage.toString(),
                    onSelect = { value -> value.toIntOrNull()?.let(actions.onPerPageChange) },
                    modifier = Modifier.width(PER_PAGE_WIDTH),
                    label = stringResource(R.string.translation_Per_Page),
                )
                Button(
                    label = stringResource(R.string.translation_Query),
                    onClick = actions.onQuery,
                    variant = ButtonVariant.Primary,
                    enabled = state.canQuery,
                    loading = state.results.isLoading,
                    leadingIcon = NavGlyphs.Server,
                )
                if (state.hasQueried) {
                    Caption(
                        text = "${state.totalRecords} ${stringResource(R.string.translation_records)}",
                        modifier = Modifier.padding(bottom = Spacing.sm),
                    )
                }
            }
        }
    }
}

/**
 * The pre-query empty branch — the web `<EmptyState icon={<Database/>} title={t('Select signals and click Query')}
 * message={t('Choose one or more signals…')} />`, shown before the user runs the first query. The selector, range, and
 * Query button are directly above (web comment), so no inline CTA is needed. Never a blank region.
 */
@Composable
private fun SignalLogViewerPreQueryEmpty() {
    EmptyState(
        message = stringResource(
            R.string.translation_Choose_one_or_more_signals__set_a_date_range__then_hit_Query_to_browse_signal_history_,
        ),
        modifier = Modifier.fillMaxWidth(),
        icon = NavGlyphs.Server,
        title = stringResource(R.string.translation_Select_signals_and_click_Query),
    )
}
