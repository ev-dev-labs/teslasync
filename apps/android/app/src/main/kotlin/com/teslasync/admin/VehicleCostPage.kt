// The native Jetpack Compose + Material 3 VehicleCostPage admin surface — a parity port of
// web/src/features/admin/pages/VehicleCostPage.tsx, the per-vehicle telemetry ingest-cost report. It reproduces
// the page's fleet-totals card strip (the four StatCards — total rows, total bytes (est.), 24 h ingest rate, and
// 24 h DLQ failures) and the per-vehicle breakdown panel (GlassPanel1 — its window selector and the six-column
// vehicle / rows / bytes / rate / DLQ / last-seen table), the subsystem-unavailable banner (web 503 ingest
// x-ray not configured), every data state (loading / empty / error / success), and every visible string
// (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [VehicleCostPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed + interaction snapshot);
// [VehicleCostPageContent] is the stateless render layer driven entirely by [UiState] + [VehicleCostInteraction]
// + [VehicleCostActions]. All derivation lives in the framework-free model (VehicleCostPageModel.kt); this file
// only resolves i18n + formats at the display boundary + draws. None of the columns is unit-bearing in the SI
// sense (counts, the byte estimate the backend computed, a per-minute rate, an ISO timestamp), so there is no SI
// conversion — locale number / byte / relative-time formatting is applied here at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.vehiclecost

import android.text.format.DateUtils
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
import io.teslasync.android.components.datadisplay.StatCard
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
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostResponse
import io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostRow
import io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostTotals
import java.text.NumberFormat
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 40

/** 1024-step divisor for the byte-estimate roll-up (web `formatBytes`). */
private const val BYTES_PER_STEP = 1024.0

/** Width of the vehicle column — the display name plus the muted "ID …" caption beneath it. */
private val VEHICLE_COL_WIDTH: Dp = 200.dp

/** Width of the right-aligned rows column. */
private val ROWS_COL_WIDTH: Dp = 110.dp

/** Width of the right-aligned byte-estimate column. */
private val BYTES_COL_WIDTH: Dp = 120.dp

/** Width of the right-aligned 24 h ingest-rate column (its header is the longest). */
private val RATE_COL_WIDTH: Dp = 150.dp

/** Width of the right-aligned 24 h DLQ-failures column. */
private val FAILURES_COL_WIDTH: Dp = 110.dp

/** Width of the last-seen column (the relative-time label). */
private val LAST_COL_WIDTH: Dp = 150.dp

/** Full intrinsic width of the table (the six columns), the horizontal-scroll content width. */
private val TABLE_WIDTH: Dp =
    VEHICLE_COL_WIDTH + ROWS_COL_WIDTH + BYTES_COL_WIDTH + RATE_COL_WIDTH + FAILURES_COL_WIDTH + LAST_COL_WIDTH

/** The page's interaction callbacks, wired to the [VehicleCostPageViewModel] (web event handlers). */
data class VehicleCostActions(
    val onWindow: (VehicleCostWindow) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [VehicleCostPageViewModel] over the supplied [source] (the host wires the
 * shared Operator-Confidence holder via [asVehicleCostSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun VehicleCostPage(
    source: VehicleCostSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: VehicleCostPageViewModel =
        viewModel(
            key = VehicleCostPageRegistration.SLUG,
            factory = viewModelFactory { initializer { VehicleCostPageViewModel(source, logger) } },
        )
    VehicleCostPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic and binds the feed + interaction snapshot to the
 * stateless content.
 */
@Composable
fun VehicleCostPage(
    viewModel: VehicleCostPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            VehicleCostActions(
                onWindow = viewModel::setWindow,
                onRetry = viewModel::retry,
            )
        }

    VehicleCostPageContent(state = state, interaction = interaction, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header, the optional subsystem-unavailable banner (web 503), the
 * fleet-totals card strip, and the per-vehicle breakdown panel with its window selector and table. The single
 * vehicle-cost feed drives every surface — the totals strip shows skeletons on first load, real values on
 * success, zeros on an empty window, and the em-dash on a hard error; the table switches across
 * loading / error / empty / content; and the 503 branch swaps the totals strip for the banner exactly as the
 * web hides `{totals && …}` when the subsystem is unconfigured.
 */
@Composable
fun VehicleCostPageContent(
    state: UiState<VehicleCostResponse>,
    interaction: VehicleCostInteraction,
    actions: VehicleCostActions,
    modifier: Modifier = Modifier,
) {
    val subsystemMissing = state.httpStatus == HTTP_SUBSYSTEM_UNAVAILABLE
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val formats = remember(locale) { VehicleCostFormats(locale) }
    val nowMs = remember { System.currentTimeMillis() }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        VehicleCostHeader()

        if (subsystemMissing) {
            FadeIn { SubsystemUnavailableBanner() }
        } else {
            FadeIn(delayMs = FADE_STEP_MS) {
                FleetTotalsCards(
                    totals = state.data?.totals,
                    windowDays = interaction.window.days,
                    loading = state.isLoading,
                    formats = formats,
                )
            }
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            VehicleBreakdownPanel(
                state = state,
                interaction = interaction,
                subsystemMissing = subsystemMissing,
                formats = formats,
                nowMs = nowMs,
                actions = actions,
            )
        }
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun VehicleCostHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_vehicleCost_pageTitle))
        BodyText(
            stringResource(R.string.translation_admin_vehicleCost_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The 503 subsystem-not-configured banner (web `<AlertBanner variant="warning">`). */
@Composable
private fun SubsystemUnavailableBanner() {
    AlertBanner(
        message = stringResource(R.string.translation_admin_vehicleCost_notConfigured),
        tone = Tone.Warning,
        title = stringResource(R.string.translation_admin_subsystem_unavailableTitle),
    )
}

// ── Fleet totals strip (web `<FleetTotalsCards>`) ─────────────────────────────────────────────────────────────

/**
 * The four fleet-wide summary StatCards (web `FleetTotalsCards`): total rows, total bytes (est.), the 24 h
 * ingest rate, and the 24 h DLQ failures. Stacked into a single column for the phone form factor. On first load
 * each card renders its own skeleton ([loading]); once the feed resolves they show the live [totals]; a hard
 * error with nothing cached folds each value to the em-dash so the strip is never blank.
 */
@Composable
private fun FleetTotalsCards(
    totals: VehicleCostTotals?,
    windowDays: Int,
    loading: Boolean,
    formats: VehicleCostFormats,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        TotalRowsCard(totals = totals, windowDays = windowDays, loading = loading, formats = formats)
        TotalBytesCard(totals = totals, loading = loading, formats = formats)
        TotalRateCard(totals = totals, loading = loading, formats = formats)
        TotalFailuresCard(totals = totals, loading = loading, formats = formats)
    }
}

/** Panel — Total-rows (web first `<StatCard label="Total rows">`). */
@Composable
private fun TotalRowsCard(
    totals: VehicleCostTotals?,
    windowDays: Int,
    loading: Boolean,
    formats: VehicleCostFormats,
) {
    StatCard(
        label = stringResource(R.string.translation_admin_vehicleCost_totalRows),
        value = totals?.let { formats.count(it.totalRows) } ?: EM_DASH,
        sublabel = stringResource(R.string.translation_admin_vehicleCost_windowSub, windowDays),
        loading = loading,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Panel — Total-bytes-est (web second `<StatCard label="Total bytes (est.)">`). */
@Composable
private fun TotalBytesCard(
    totals: VehicleCostTotals?,
    loading: Boolean,
    formats: VehicleCostFormats,
) {
    StatCard(
        label = stringResource(R.string.translation_admin_vehicleCost_totalBytes),
        value = totals?.let { formats.bytes(it.totalBytesEst) } ?: EM_DASH,
        sublabel = stringResource(R.string.translation_admin_vehicleCost_bytesSub),
        loading = loading,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Panel — Rate-rows-min-24h (web third `<StatCard label="Rate (rows/min, 24h)">`). */
@Composable
private fun TotalRateCard(
    totals: VehicleCostTotals?,
    loading: Boolean,
    formats: VehicleCostFormats,
) {
    StatCard(
        label = stringResource(R.string.translation_admin_vehicleCost_totalRate),
        value = totals?.let { formats.rate(it.totalRatePerMinute24h) } ?: EM_DASH,
        sublabel = stringResource(R.string.translation_admin_vehicleCost_rateSub),
        loading = loading,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Panel — DLQ-failures-24h (web fourth `<StatCard label="DLQ failures (24h)">`). */
@Composable
private fun TotalFailuresCard(
    totals: VehicleCostTotals?,
    loading: Boolean,
    formats: VehicleCostFormats,
) {
    StatCard(
        label = stringResource(R.string.translation_admin_vehicleCost_totalFailures),
        value = totals?.let { formats.count(it.totalFailures24h) } ?: EM_DASH,
        sublabel = stringResource(R.string.translation_admin_vehicleCost_failuresSub),
        loading = loading,
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── GlassPanel1 — per-vehicle breakdown ───────────────────────────────────────────────────────────────────────

/**
 * The per-vehicle breakdown panel (web `GlassPanel`): the "Per-vehicle breakdown" title, the window selector,
 * and the table surface that switches across loading / hard-error / empty / content. Under the 503
 * subsystem-missing branch it renders the empty table (web `<DataTable data={[]} />` below the banner) so the
 * region is never blank.
 */
@Composable
private fun VehicleBreakdownPanel(
    state: UiState<VehicleCostResponse>,
    interaction: VehicleCostInteraction,
    subsystemMissing: Boolean,
    formats: VehicleCostFormats,
    nowMs: Long,
    actions: VehicleCostActions,
) {
    val tableTitle = stringResource(R.string.translation_admin_vehicleCost_tableTitle)
    val vehicles = state.data?.vehicles.orEmpty()

    GlassPanel(
        padding = PanelPadding.Md,
        modifier = Modifier.semantics { contentDescription = tableTitle },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PanelTitle(tableTitle)
            WindowControl(interaction = interaction, onWindow = actions.onWindow)
        }

        HorizontalDivider(
            modifier = Modifier.padding(vertical = Spacing.md),
            color = MaterialTheme.colorScheme.outlineVariant,
        )

        val boundary = rememberErrorBoundaryState()
        SectionErrorBoundary(state = boundary) {
            when {
                subsystemMissing -> VehicleCostTable(rows = emptyList(), formats = formats, nowMs = nowMs)
                state.isLoading -> VehicleCostLoadingState()
                state.isError -> VehicleCostErrorState(onRetry = actions.onRetry)
                state.isEmpty -> VehicleCostEmptyState()
                else -> VehicleCostTable(rows = vehicles, formats = formats, nowMs = nowMs)
            }
        }
    }
}

/** The window selector (web's `<label><Caption/>… <Select/></label>` in the panel header). */
@Composable
private fun WindowControl(
    interaction: VehicleCostInteraction,
    onWindow: (VehicleCostWindow) -> Unit,
) {
    val labels: Map<VehicleCostWindow, String> =
        mapOf(
            VehicleCostWindow.D1 to stringResource(R.string.translation_admin_vehicleCost_window1d),
            VehicleCostWindow.D7 to stringResource(R.string.translation_admin_vehicleCost_window7d),
            VehicleCostWindow.D30 to stringResource(R.string.translation_admin_vehicleCost_window30d),
            VehicleCostWindow.D90 to stringResource(R.string.translation_admin_vehicleCost_window90d),
        )
    val options = VEHICLE_COST_WINDOW_OPTIONS.map { SelectOption(it.days.toString(), labels.getValue(it)) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_admin_vehicleCost_windowLabel))
        Select(
            options = options,
            selectedValue = interaction.window.days.toString(),
            onSelect = { onWindow(vehicleCostWindowFromDays(it.toIntOrNull() ?: interaction.window.days)) },
        )
    }
}

// ── Table + data states ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The six-column per-vehicle table (web `<DataTable>`): vehicle (name + id), rows, byte estimate, 24 h rate,
 * 24 h DLQ failures, and the relative last-seen. It scrolls horizontally so every column stays legible on a
 * phone. With no [rows] it renders the table's own empty message (web DataTable `emptyMessage`), reached under
 * the 503 subsystem-missing branch below the banner.
 */
@Composable
private fun VehicleCostTable(
    rows: List<VehicleCostRow>,
    formats: VehicleCostFormats,
    nowMs: Long,
) {
    if (rows.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xl2),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BodyText(
                stringResource(R.string.translation_admin_vehicleCost_emptyTable),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    Column(modifier = Modifier.horizontalScroll(rememberScrollState())) {
        VehicleCostTableHeader()
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
            VehicleCostTableRow(row = row, formats = formats, nowMs = nowMs)
        }
    }
}

/** The table header row — the six localized column labels (web `Column.header`). */
@Composable
private fun VehicleCostTableHeader() {
    Row(modifier = Modifier.width(TABLE_WIDTH).padding(vertical = Spacing.sm)) {
        HeaderCell(stringResource(R.string.translation_admin_vehicleCost_colVehicle), VEHICLE_COL_WIDTH, alignEnd = false)
        HeaderCell(stringResource(R.string.translation_admin_vehicleCost_colRows), ROWS_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_vehicleCost_colBytes), BYTES_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_vehicleCost_colRate), RATE_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_vehicleCost_colFailures), FAILURES_COL_WIDTH, alignEnd = true)
        HeaderCell(stringResource(R.string.translation_admin_vehicleCost_colLastSeen), LAST_COL_WIDTH, alignEnd = false)
    }
}

/** One data row — the vehicle identity plus the five metric columns. */
@Composable
private fun VehicleCostTableRow(
    row: VehicleCostRow,
    formats: VehicleCostFormats,
    nowMs: Long,
) {
    Row(
        modifier = Modifier.width(TABLE_WIDTH).padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        VehicleIdentityCell(row = row, formats = formats)
        NumericCell(formats.count(row.signalRowCount), ROWS_COL_WIDTH)
        NumericCell(formats.bytes(row.signalBytesEst), BYTES_COL_WIDTH)
        NumericCell(formats.rate(row.ingestRatePerMinute24h), RATE_COL_WIDTH)
        FailuresCell(row = row, formats = formats)
        LastSeenCell(label = formats.relative(row.lastSeenAt, nowMs))
    }
}

/** The vehicle identity cell — the display name (or `Vehicle #id` fallback) over the muted "ID …" caption. */
@Composable
private fun VehicleIdentityCell(
    row: VehicleCostRow,
    formats: VehicleCostFormats,
) {
    val name =
        row.displayNameOrNull()
            ?: stringResource(R.string.translation_admin_vehicleCost_unnamed, row.vehicleId.toString())
    Column(
        modifier = Modifier.width(VEHICLE_COL_WIDTH).padding(end = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        BodyText(name, maxLines = 1)
        Caption(stringResource(R.string.translation_admin_vehicleCost_idLabel, formats.count(row.vehicleId)))
    }
}

/** The 24 h DLQ-failures cell — recolored amber when elevated (web `failures > 0 ? text-amber-300 : muted`). */
@Composable
private fun FailuresCell(
    row: VehicleCostRow,
    formats: VehicleCostFormats,
) {
    val color =
        if (row.isDlqElevated) TeslaTokens.status.warning else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier = Modifier.width(FAILURES_COL_WIDTH).padding(horizontal = Spacing.xs),
        contentAlignment = Alignment.CenterEnd,
    ) {
        BodyText(formats.count(row.dlqFailures24h), color = color, maxLines = 1)
    }
}

/** The last-seen cell — the relative-time label (web `formatRelative(last_seen_at)`). */
@Composable
private fun LastSeenCell(label: String) {
    Box(
        modifier = Modifier.width(LAST_COL_WIDTH).padding(horizontal = Spacing.xs),
        contentAlignment = Alignment.CenterStart,
    ) {
        BodyText(label, maxLines = 1)
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
private fun VehicleCostLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md)
    }
}

/** Hard-error surface with a retry affordance (web page-tier error). */
@Composable
private fun VehicleCostErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            VehicleCostGlyphs.AlertCircle,
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
 * No-vehicle-cost empty state (web `<EmptyState icon={Wallet} title={emptyTitle} message={emptyMessage} />`):
 * no vehicles have ingested signals during the selected window.
 */
@Composable
private fun VehicleCostEmptyState() {
    EmptyState(
        message = stringResource(R.string.translation_admin_vehicleCost_emptyMessage),
        icon = VehicleCostGlyphs.Wallet,
        title = stringResource(R.string.translation_admin_vehicleCost_emptyTitle),
    )
}

// ── Render helpers ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Locale-aware formatters built once per locale at the render boundary — the native analogue of the web
 * `fmtNumber` / `formatBytes` / `formatRelative` helpers. Counts use grouped integers; the rate uses one
 * decimal; the byte estimate rolls up B → KB → MB → GB (web `formatBytes`); the relative last-seen defers to
 * Android's localized [DateUtils] span so no relative-time phrasing is hardcoded.
 */
private class VehicleCostFormats(locale: Locale) {
    private val integer = NumberFormat.getIntegerInstance(locale)
    private val oneDecimal =
        NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = 1
            maximumFractionDigits = 1
        }

    /** Grouped integer (web `fmtNumber(value)`) — used for row counts, DLQ counts, and the vehicle id. */
    fun count(value: Long): String = integer.format(value)

    /** One-decimal rate (web `fmtNumber(value, 1)`). */
    fun rate(value: Double): String = oneDecimal.format(value)

    /** Byte estimate rolled up to the largest unit (web `formatBytes`): `B` raw, then `KB`/`MB`/`GB` to 1 dp. */
    fun bytes(value: Long): String {
        if (value < BYTES_PER_STEP) return "${integer.format(value)} B"
        val kb = value / BYTES_PER_STEP
        if (kb < BYTES_PER_STEP) return "${oneDecimal.format(kb)} KB"
        val mb = kb / BYTES_PER_STEP
        if (mb < BYTES_PER_STEP) return "${oneDecimal.format(mb)} MB"
        val gb = mb / BYTES_PER_STEP
        return "${oneDecimal.format(gb)} GB"
    }

    /**
     * The relative last-seen label (web `formatRelative(iso)`). Parses the ISO stamp through the model's
     * [parseEpochMillis] and defers to Android's localized [DateUtils.getRelativeTimeSpanString]; an unparseable
     * or blank stamp folds to the em-dash, exactly as the web fallback does.
     */
    fun relative(
        iso: String,
        nowMs: Long,
    ): String {
        val ms = parseEpochMillis(iso) ?: return EM_DASH
        return DateUtils
            .getRelativeTimeSpanString(ms, nowMs, DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE)
            .toString()
    }
}
