// The native Jetpack Compose + Material 3 SignalStatsPanel feature view — a parity port of
// web/src/features/telemetry/components/SignalStatsPanel.tsx. The web component is a presentation-only telemetry
// panel inside a `GlassPanel`: a "Stats Summary" title with a "Hide empty (N)" toggle (shown only when there are
// empty rows), and a five-column stats `DataTable` (Signal / Min / Max / Avg / Count). When `selectedSignals` is
// provided it renders one row per selected signal — including signals with no numeric samples, which surface `—`
// blanks and a "No data in range" subtitle so the panel never silently drops a selected signal the chart
// also has to show.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). The owning Workspace/Explorer host computes the
// `stats` from its live SSE stream and supplies them through the shared P1/S8 state-holder layer as a [UiState], so
// this feature view renders every lifecycle state that layer can carry — loading skeleton, hard error with retry,
// empty, content, and stale/offline ("last known") — without ever fetching. A web-parity overload that takes the
// raw `stats` (+ `selectedSignals` / `signalIndex` / `loading`) props is also provided for hosts that already hold
// the value. Every value derivation + formatter flows through the pure [SignalStatsProjection]; the composable is a
// thin render layer wrapped in the reduce-motion-aware [FadeIn] (the web `<FadeIn>`).
//
// Each signal name is tinted with its categorical series color via [paletteColor] — the token analogue of the web
// `CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length]` — so a row keeps the same color as its chart series.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalStatsPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalstatspanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Layout geometry ──────────────────────────────────────────────────────────────────────────────

/** Signal column carries the widest text (a code-style identifier); the numeric columns are narrower. */
private const val SIGNAL_WEIGHT: Float = 2f
private const val STAT_WEIGHT: Float = 1f

/** One line per cell keeps the dense five-column table readable on a phone. */
private const val CELL_MAX_LINES: Int = 1

/** Gap between a signal name and its "No data in range" subtitle. */
private val ROW_LABEL_GAP: Dp = 2.dp

/** Loading skeleton footprint (a title bar over a table block matching the rendered five-column table). */
private val LOADING_TITLE_HEIGHT: Dp = 16.dp
private const val LOADING_TITLE_WIDTH_FRACTION: Float = 0.5f
private const val LOADING_TABLE_ROWS: Int = 4
private const val LOADING_TABLE_COLUMNS: Int = 5

/** Stable column ids for the [DataTable] (the panel is not sortable — keys are identity only). */
private const val COL_SIGNAL = "signal"
private const val COL_MIN = "min"
private const val COL_MAX = "max"
private const val COL_AVG = "avg"
private const val COL_COUNT = "count"

/**
 * Stateful entry point for the per-signal stats panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared signals feed can carry. The host owns the feed (P1/S8),
 * computes the `stats` (web's live `chartStats`), and supplies [onRetry] (the feed's `refetch`); this view never
 * performs HTTP.
 *
 * @param state the cache-then-network projection of the stats input (web `stats` + `selectedSignals`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param title an optional title override (web `title` prop); defaults to the localized "Stats Summary".
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalStatsPanel(
    state: UiState<SignalStatsInput>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SignalStatsPanelDiagnostics.recordViewOpened(logger) }
    SignalStatsPanelContent(state = state, onRetry = onRetry, modifier = modifier, title = title)
}

/**
 * Web-parity overload mirroring the web component's prop signature, for hosts that already hold the value. [loading]
 * maps to the loading skeleton; otherwise the panel renders the content (whose own empty fallback covers the no-rows
 * case). Records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun SignalStatsPanel(
    stats: List<SignalStat>,
    modifier: Modifier = Modifier,
    selectedSignals: List<String>? = null,
    signalIndex: Map<String, Int>? = null,
    loading: Boolean = false,
    title: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(stats, selectedSignals, signalIndex, loading) {
            if (loading) {
                UiState(UiPhase.Loading)
            } else {
                UiState(UiPhase.Content, data = SignalStatsInput(stats, selectedSignals, signalIndex))
            }
        }
    SignalStatsPanel(state = state, onRetry = {}, modifier = modifier, title = title, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web panel
 * (title, hide-empty toggle, five-column stats table) and adds the lifecycle chrome the host's feed implies: a
 * loading skeleton, a hard-error retry surface (web `QueryError` equivalent), a friendly empty state, and a freshness
 * chip in the header that reflects refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the
 * freshness contract. [locale] formats the numeric figures.
 */
@Composable
fun SignalStatsPanelContent(
    state: UiState<SignalStatsInput>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    strings: SignalStatsStrings = rememberSignalStatsStrings(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Md) {
            when {
                state.isLoading -> SignalStatsLoading()
                state.isError -> SignalStatsError(onRetry = onRetry)
                else -> {
                    val display = remember(state.data) { state.data?.let { SignalStatsProjection.project(it) } }
                    SignalStatsLoaded(state = state, display = display, title = title, strings = strings, locale = locale)
                }
            }
        }
    }
}

/**
 * The non-loading/non-error body: the always-present title header (with the hide-empty toggle when there are empty
 * rows, and the freshness chip when the cached data is refreshing / stale / offline), then either the friendly empty
 * state or the stats table. Laid out as a spaced column so the panel reads as one surface and is never a blank box.
 */
@Composable
private fun SignalStatsLoaded(
    state: UiState<SignalStatsInput>,
    display: SignalStatsDisplay?,
    title: String?,
    strings: SignalStatsStrings,
    locale: Locale,
) {
    var hideEmpty by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        SignalStatsHeader(
            title = title ?: strings.defaultTitle,
            state = state,
            emptyCount = display?.emptyCount ?: 0,
            hideEmpty = hideEmpty,
            onHideEmptyChange = { hideEmpty = it },
        )
        val visible = display?.visibleRows(hideEmpty).orEmpty()
        if (visible.isEmpty()) {
            SignalStatsEmpty(strings = strings)
        } else {
            SignalStatsTable(rows = visible, strings = strings, locale = locale)
        }
    }
}

/**
 * The panel header — the web `flex items-center justify-between` row with the "Stats Summary" title and, when there
 * are empty rows, the "Hide empty (N)" toggle. The honest freshness chip (refreshing / stale / offline) is rendered
 * at the trailing edge of the title row when cached data is being shown. On Android the toggle sits in its own
 * full-width row beneath the title (the platform settings-row idiom) rather than inline.
 */
@Composable
private fun SignalStatsHeader(
    title: String,
    state: UiState<*>,
    emptyCount: Int,
    hideEmpty: Boolean,
    onHideEmptyChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = DataDisplayGlyphs.Gauge,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.chart.speed,
            )
            SectionTitle(text = title, modifier = Modifier.weight(1f).semantics { heading() })
            if (shouldShowFreshness(state)) {
                SignalStatsFreshnessChip(state = state)
            }
        }
        if (emptyCount > 0) {
            Toggle(
                checked = hideEmpty,
                onCheckedChange = onHideEmptyChange,
                label = stringResource(R.string.translation_signalStats_hideEmpty, emptyCount),
            )
        }
    }
}

/** True when cached data is refreshing / stale / offline and the panel content (not loading/error) is shown. */
private fun shouldShowFreshness(state: UiState<*>): Boolean =
    !state.isLoading && !state.isError && (state.stale || state.refreshing || state.hasError)

/**
 * The five-column stats table — the native counterpart of the web `<DataTable>`. The Signal cell carries the
 * series-colored name (web `CHART_COLORS[idx]`) plus a "No data in range" subtitle for an empty row; the remaining
 * columns are right-aligned numerics (Min, Max, Avg, Count) rendered through the pure [SignalStatsProjection].
 */
@Composable
private fun SignalStatsTable(
    rows: List<SignalStatsRow>,
    strings: SignalStatsStrings,
    locale: Locale,
) {
    DataTable(
        columns = signalStatsColumns(strings = strings, locale = locale),
        rows = rows,
        keyOf = { it.signal },
    )
}

@Composable
private fun signalStatsColumns(
    strings: SignalStatsStrings,
    locale: Locale,
): List<TableColumn<SignalStatsRow>> =
    listOf(
        TableColumn(key = COL_SIGNAL, header = strings.colSignal, weight = SIGNAL_WEIGHT) { row ->
            SignalNameCell(row = row, strings = strings)
        },
        TableColumn(key = COL_MIN, header = strings.colMin, weight = STAT_WEIGHT, alignEnd = true) { row ->
            BodyText(
                SignalStatsProjection.formatStat(row.min, locale = locale),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = CELL_MAX_LINES,
            )
        },
        TableColumn(key = COL_MAX, header = strings.colMax, weight = STAT_WEIGHT, alignEnd = true) { row ->
            BodyText(
                SignalStatsProjection.formatStat(row.max, locale = locale),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = CELL_MAX_LINES,
            )
        },
        TableColumn(key = COL_AVG, header = strings.colAvg, weight = STAT_WEIGHT, alignEnd = true) { row ->
            BodyText(
                SignalStatsProjection.formatStat(row.avg, locale = locale),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = CELL_MAX_LINES,
            )
        },
        TableColumn(key = COL_COUNT, header = strings.colCount, weight = STAT_WEIGHT, alignEnd = true) { row ->
            BodyText(
                SignalStatsProjection.formatCount(row.count, locale = locale),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = CELL_MAX_LINES,
            )
        },
    )

/** Signal name tinted with its series color, with a "No data in range" subtitle when the row is a stand-in. */
@Composable
private fun SignalNameCell(
    row: SignalStatsRow,
    strings: SignalStatsStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(ROW_LABEL_GAP)) {
        BodyText(row.signal, color = paletteColor(row.colorIndex), maxLines = CELL_MAX_LINES)
        if (row.isEmpty) {
            Caption(strings.noDataInRange)
        }
    }
}

/**
 * First-load skeleton — a title bar over a five-column table block, so the panel reads as this surface (not a
 * generic spinner) and is never blank while the first fetch runs. Carries a single TalkBack "Loading" description.
 */
@Composable
private fun SignalStatsLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_WIDTH_FRACTION, height = LOADING_TITLE_HEIGHT)
        TableSkeleton(rows = LOADING_TABLE_ROWS, columns = LOADING_TABLE_COLUMNS)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SignalStatsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty state — shown when there are no rows to summarize, so the panel is never a blank box (web `No stats available`). */
@Composable
private fun SignalStatsEmpty(strings: SignalStatsStrings) {
    EmptyState(
        message = strings.noStatsAvailable,
        icon = DataDisplayGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The header freshness chip — the honest "refreshing / stale / offline" affordance over cached figures. */
@Composable
private fun SignalStatsFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSignalStatsFreshnessFormatter(),
    )
}

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10): the default title, the five
 * column headers, the empty-row subtitle, and the empty-state message. The web component reads each via `t(...)`; on
 * Android they arrive through `stringResource` at the Compose boundary, keeping the render free of English literals.
 */
data class SignalStatsStrings(
    val defaultTitle: String,
    val colSignal: String,
    val colMin: String,
    val colMax: String,
    val colAvg: String,
    val colCount: String,
    val noDataInRange: String,
    val noStatsAvailable: String,
)

/** Builds the localized [SignalStatsStrings] from the i18n catalog (P1/S10). Remembered against the resolved strings. */
@Composable
private fun rememberSignalStatsStrings(): SignalStatsStrings {
    val defaultTitle = stringResource(R.string.translation_Stats_Summary)
    val colSignal = stringResource(R.string.translation_Signal)
    val colMin = stringResource(R.string.translation_Min)
    val colMax = stringResource(R.string.translation_Max)
    val colAvg = stringResource(R.string.translation_Avg)
    val colCount = stringResource(R.string.translation_Count)
    val noDataInRange = stringResource(R.string.translation_signalStats_noDataInRange)
    val noStatsAvailable = stringResource(R.string.translation_No_stats_available)
    return remember(defaultTitle, colSignal, colMin, colMax, colAvg, colCount, noDataInRange, noStatsAvailable) {
        SignalStatsStrings(
            defaultTitle = defaultTitle,
            colSignal = colSignal,
            colMin = colMin,
            colMax = colMax,
            colAvg = colAvg,
            colCount = colCount,
            noDataInRange = noDataInRange,
            noStatsAvailable = noStatsAvailable,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only concern
 * the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSignalStatsFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> ChartFormat.EMPTY
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SignalStatsStrings(
        defaultTitle = "Stats Summary",
        colSignal = "Signal",
        colMin = "Min",
        colMax = "Max",
        colAvg = "Avg",
        colCount = "Count",
        noDataInRange = "No data in range",
        noStatsAvailable = "No stats available",
    )

private val PREVIEW_INPUT =
    SignalStatsInput(
        stats =
            listOf(
                SignalStat(signal = "VehicleSpeed", min = 0.0, max = 120.5, avg = 47.34, count = 1820),
                SignalStat(signal = "BatteryLevel", min = 18.0, max = 92.0, avg = 64.41, count = 1820),
            ),
        selectedSignals = listOf("VehicleSpeed", "BatteryLevel", "TpmsPressureFl"),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun SignalStatsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalStatsPanelContent(
            state = UiState(UiPhase.Content, data = PREVIEW_INPUT),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SignalStatsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalStatsPanelContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SignalStatsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalStatsPanelContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SignalStatsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalStatsPanelContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SignalStatsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalStatsPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_INPUT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}
