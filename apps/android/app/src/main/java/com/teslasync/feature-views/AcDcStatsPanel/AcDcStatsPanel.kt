// The native Jetpack Compose + Material 3 AcDcStatsPanel feature view — a parity port of
// web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx. The web component is a presentational
// charging-list panel inside a `GlassPanel`: a ⚡ title ("Charging Stats by Type"), an AC-vs-DC energy-split
// bar (a two-segment rounded grid sized by each source's share of total energy, with an "AC: x / Total: y /
// DC: z" caption row), an eight-column stats `DataTable` (Type / Sessions / Energy / Cost / $/kWh / Avg Energy
// / Avg Time / Free) of the AC and DC rows that have at least one session, and a free-charged footer shown
// only when there were free sessions.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). The owning charging host computes the
// breakdown (web `computeAcDcBreakdown`) and supplies it through the shared P1/S8 state-holder layer as a
// [UiState], so this feature view renders every lifecycle state that layer can carry — loading skeleton, hard
// error with retry, empty, content, and stale/offline ("last known") — without ever fetching. A web-parity
// overload that takes the raw `breakdown` prop is also provided for hosts that already hold the value. Every
// value derivation + formatter flows through the pure [AcDcStatsProjection]; the composable is a thin render
// layer.
//
// Segment colors mirror the web `bg-blue-500` (AC, `#3b82f6`) / `bg-amber-500` (DC, `#f59e0b`): AC →
// `TeslaTokens.chart.speed` (the exact `#3B82F6`), DC → `TeslaTokens.chart.energy` (the exact `#F59E0B`),
// matching the sibling ChargingBreakdownSlide port's palette mapping. The bar is a Compose `Row` of weighted,
// `CircleShape`-clipped segments (never a raw chart-library import); feature views must not import the shared
// chart engine directly, and the shared chart layer ships no segmented progress bar.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AcDcStatsPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.acdcstatspanel

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Layout geometry (web Tailwind values, reproduced) ───────────────────────────────────────────────

/** Web `h-4` (1rem) energy-split bar height. */
private val SPLIT_BAR_HEIGHT: Dp = 16.dp

/** Web `text-[9px]` in-segment AC/DC label size. */
private val SPLIT_SEGMENT_LABEL_SIZE: TextUnit = 9.sp

/** Loading skeleton bar heights. */
private val LOADING_TITLE_HEIGHT: Dp = 16.dp
private val LOADING_BAR_HEIGHT: Dp = SPLIT_BAR_HEIGHT
private const val LOADING_TITLE_WIDTH_FRACTION: Float = 0.55f

/** The eight-column stats table is dense; one line per cell keeps the AC/DC rows readable on a phone. */
private const val CELL_MAX_LINES: Int = 1

// Column weights — Type + Free carry the widest text; the numeric columns are narrower. Mirrors the web
// table's natural column sizing (the web wraps the same eight columns in an `overflow-x-auto` scroller).
private const val TYPE_WEIGHT: Float = 1.5f
private const val SESSIONS_WEIGHT: Float = 0.9f
private const val ENERGY_WEIGHT: Float = 1.2f
private const val COST_WEIGHT: Float = 1.0f
private const val PER_KWH_WEIGHT: Float = 1.0f
private const val AVG_ENERGY_WEIGHT: Float = 1.2f
private const val AVG_TIME_WEIGHT: Float = 1.0f
private const val FREE_WEIGHT: Float = 1.4f

/** Loading skeleton table footprint (two data rows + eight columns, matching the rendered table). */
private const val LOADING_TABLE_ROWS: Int = 2
private const val LOADING_TABLE_COLUMNS: Int = 8

/** Stable column ids for the [DataTable] (the panel is not sortable — keys are identity only). */
private object AcDcColumnKey {
    const val TYPE = "type"
    const val SESSIONS = "sessions"
    const val ENERGY = "energy"
    const val COST = "cost"
    const val PER_KWH = "perKwh"
    const val AVG_ENERGY = "avgEnergy"
    const val AVG_TIME = "avgTime"
    const val FREE = "free"
}

/**
 * Stateful entry point for the AC/DC charging-stats panel. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared charging feed can carry. The host owns
 * the feed (P1/S8), computes the breakdown (web `computeAcDcBreakdown`), and supplies [onRetry] (the feed's
 * `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the AC/DC breakdown (web `breakdown`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param format the user's currency + decimal preferences (web `useFormatting`); defaults to the web defaults.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AcDcStatsPanel(
    state: UiState<AcDcBreakdownData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    format: AcDcStatsFormat = AcDcStatsFormat.DEFAULT,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AcDcStatsPanelDiagnostics.recordViewOpened(logger) }
    AcDcStatsPanelContent(state = state, onRetry = onRetry, modifier = modifier, format = format)
}

/**
 * Web-parity overload mirroring the web component's `breakdown: AcDcBreakdown` prop, for hosts that already
 * hold the value. A `null` breakdown renders the empty state; a present breakdown renders the panel (the
 * content renderer itself falls back to the empty state when neither AC nor DC has a session). Records
 * `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun AcDcStatsPanel(
    breakdown: AcDcBreakdownData?,
    modifier: Modifier = Modifier,
    format: AcDcStatsFormat = AcDcStatsFormat.DEFAULT,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(breakdown) {
            if (breakdown == null) UiState(UiPhase.Empty) else UiState(UiPhase.Content, data = breakdown)
        }
    AcDcStatsPanel(state = state, onRetry = {}, modifier = modifier, format = format, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * panel (title, energy-split bar, stats table, free-charged footer) and adds the lifecycle chrome the host's
 * feed implies: a loading skeleton, a hard-error retry surface (web `QueryError` equivalent), a friendly empty
 * state, and a freshness chip in the header that reflects refreshing / stale / offline. Stale (non-error) data
 * auto-refreshes, mirroring the freshness contract. [locale] formats the numeric figures.
 */
@Composable
fun AcDcStatsPanelContent(
    state: UiState<AcDcBreakdownData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    format: AcDcStatsFormat = AcDcStatsFormat.DEFAULT,
    strings: AcDcStatsStrings = rememberAcDcStatsStrings(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> AcDcStatsLoading()
            state.isError -> AcDcStatsError(onRetry = onRetry)
            else -> {
                val display = remember(state.data) { state.data?.let { AcDcStatsProjection.project(it) } }
                AcDcStatsLoaded(state = state, display = display, strings = strings, format = format, locale = locale)
            }
        }
    }
}

/**
 * The non-loading/non-error body: the always-present title header (with the freshness chip when the cached
 * data is refreshing / stale / offline), then either the friendly empty state (no AC/DC sessions) or the
 * energy-split bar + stats table + free-charged footer. Laid out as a spaced column so the panel reads as one
 * surface and is never a blank box.
 */
@Composable
private fun ColumnScope.AcDcStatsLoaded(
    state: UiState<AcDcBreakdownData>,
    display: AcDcStatsDisplay?,
    strings: AcDcStatsStrings,
    format: AcDcStatsFormat,
    locale: Locale,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        AcDcStatsHeader(state = state)
        if (display == null || display.isEmpty) {
            AcDcStatsEmpty()
        } else {
            EnergySplitSection(split = display.split, strings = strings, decimals = format.resolvedDecimals, locale = locale)
            AcDcStatsTable(rows = display.rows, strings = strings, format = format, locale = locale)
            display.freeTotal?.let { total ->
                FreeChargingFooter(total = total, strings = strings, decimals = format.resolvedDecimals, locale = locale)
            }
        }
    }
}

/**
 * The panel header — the web `<h3 className="section-title flex items-center gap-2">` with the ⚡ glyph and the
 * "Charging Stats by Type" title, plus the honest freshness chip (refreshing / stale / offline) rendered at the
 * trailing edge when cached data is being shown.
 */
@Composable
private fun AcDcStatsHeader(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.warning,
        )
        SectionTitle(
            text = stringResource(R.string.translation_charging_stats_chargingByType),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (shouldShowFreshness(state)) {
            AcDcFreshnessChip(state = state)
        }
    }
}

/** True when cached data is refreshing / stale / offline and the panel content (not loading/error) is shown. */
private fun shouldShowFreshness(state: UiState<*>): Boolean =
    !state.isLoading && !state.isError && (state.stale || state.refreshing || state.hasError)

/**
 * The energy-split section — the web `Energy Split (AC vs DC)` label, the two-segment proportional bar, and the
 * "AC: x / Total: y / DC: z" caption row beneath it.
 */
@Composable
private fun EnergySplitSection(
    split: EnergySplit,
    strings: AcDcStatsStrings,
    decimals: Int,
    locale: Locale,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_charging_stats_energySplitLabel))
        EnergySplitBar(split = split, strings = strings, decimals = decimals, locale = locale)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Caption("${strings.acShort}: ${AcDcStatsProjection.formatEnergyAuto(split.acEnergy, decimals, locale)}")
            Caption("${strings.totalShort}: ${AcDcStatsProjection.formatEnergyAuto(split.totalEnergy, decimals, locale)}")
            Caption("${strings.dcShort}: ${AcDcStatsProjection.formatEnergyAuto(split.dcEnergy, decimals, locale)}")
        }
    }
}

/**
 * The two-segment energy-split bar — the native counterpart of the web `grid` whose `gridTemplateColumns` sizes
 * the AC and DC segments by their share of total energy. Each segment is drawn only when its energy is positive
 * (web `breakdown.ac.energy > 0`) and is weighted by its fraction so the two together fill the rounded track.
 * The whole bar exposes one combined [contentDescription] (e.g. "AC 25.17%, DC 74.83%") so TalkBack reads the
 * split once instead of the decorative per-segment labels.
 */
@Composable
private fun EnergySplitBar(
    split: EnergySplit,
    strings: AcDcStatsStrings,
    decimals: Int,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val description = splitBarDescription(split = split, strings = strings, decimals = decimals, locale = locale)
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .height(SPLIT_BAR_HEIGHT)
                .clip(CircleShape)
                .clearAndSetSemantics { contentDescription = description },
    ) {
        if (split.showAc) {
            SplitSegment(
                weight = split.acFraction.toFloat(),
                color = TeslaTokens.chart.speed,
                label = "${strings.acShort} ${AcDcStatsProjection.formatPercent(split.acPercent, decimals, locale)}",
            )
        }
        if (split.showDc) {
            SplitSegment(
                weight = split.dcFraction.toFloat(),
                color = TeslaTokens.chart.energy,
                label = "${strings.dcShort} ${AcDcStatsProjection.formatPercent(split.dcPercent, decimals, locale)}",
            )
        }
    }
}

/** One colored, weighted bar segment with its centered tiny bold label (web `text-[9px] font-bold`). */
@Composable
private fun RowScope.SplitSegment(
    weight: Float,
    color: Color,
    label: String,
) {
    Box(
        modifier =
            Modifier
                .weight(weight.coerceAtLeast(MIN_SEGMENT_WEIGHT))
                .fillMaxHeight()
                .background(color),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = Color.White,
            fontSize = SPLIT_SEGMENT_LABEL_SIZE,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Clip,
            textAlign = TextAlign.Center,
        )
    }
}

/** Combined screen-reader description for the split bar (only the drawn segments). */
private fun splitBarDescription(
    split: EnergySplit,
    strings: AcDcStatsStrings,
    decimals: Int,
    locale: Locale,
): String =
    buildList {
        if (split.showAc) add("${strings.acShort} ${AcDcStatsProjection.formatPercent(split.acPercent, decimals, locale)}")
        if (split.showDc) add("${strings.dcShort} ${AcDcStatsProjection.formatPercent(split.dcPercent, decimals, locale)}")
    }.joinToString(separator = ", ")

/**
 * The eight-column stats table — the native counterpart of the web `<DataTable>` of the AC/DC rows. Type is the
 * source-colored label (AC `#3b82f6` → `chart.speed`, DC `#f59e0b` → `chart.energy`); the remaining columns are
 * right-aligned numerics (Sessions, Energy, Cost, $/kWh, Avg Energy, Avg Time, Free), each rendered through the
 * pure [AcDcStatsProjection] formatters.
 */
@Composable
private fun AcDcStatsTable(
    rows: List<AcDcStatsRow>,
    strings: AcDcStatsStrings,
    format: AcDcStatsFormat,
    locale: Locale,
) {
    DataTable(
        columns = acDcColumns(strings = strings, format = format, locale = locale),
        rows = rows,
        keyOf = { it.source.name },
    )
}

@Composable
private fun acDcColumns(
    strings: AcDcStatsStrings,
    format: AcDcStatsFormat,
    locale: Locale,
): List<TableColumn<AcDcStatsRow>> {
    val decimals = format.resolvedDecimals
    val symbol = format.resolvedSymbol
    return listOf(
        TableColumn(
            key = AcDcColumnKey.TYPE,
            header = stringResource(R.string.translation_charging_table_type),
            weight = TYPE_WEIGHT,
        ) { row -> BodyText(strings.rowLabel(row.source), color = sourceColor(row.source), maxLines = CELL_MAX_LINES) },
        TableColumn(
            key = AcDcColumnKey.SESSIONS,
            header = stringResource(R.string.translation_charging_table_sessionCount),
            weight = SESSIONS_WEIGHT,
            alignEnd = true,
        ) { row -> BodyText(row.count.toString(), maxLines = CELL_MAX_LINES) },
        TableColumn(
            key = AcDcColumnKey.ENERGY,
            header = stringResource(R.string.translation_charging_table_energy),
            weight = ENERGY_WEIGHT,
            alignEnd = true,
        ) { row -> BodyText(AcDcStatsProjection.formatEnergyAuto(row.energy, decimals, locale), maxLines = CELL_MAX_LINES) },
        TableColumn(
            key = AcDcColumnKey.COST,
            header = stringResource(R.string.translation_charging_table_cost),
            weight = COST_WEIGHT,
            alignEnd = true,
        ) { row ->
            BodyText(
                AcDcStatsProjection.formatCurrency(row.cost, symbol, locale = locale),
                color = TeslaTokens.status.warning,
                maxLines = CELL_MAX_LINES,
            )
        },
        TableColumn(
            key = AcDcColumnKey.PER_KWH,
            header = stringResource(R.string.translation_charging_table_costPerKwh),
            weight = PER_KWH_WEIGHT,
            alignEnd = true,
        ) { row ->
            BodyText(
                AcDcStatsProjection.formatCurrency(row.costPerEnergy, symbol, locale = locale),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = CELL_MAX_LINES,
            )
        },
        TableColumn(
            key = AcDcColumnKey.AVG_ENERGY,
            header = stringResource(R.string.translation_charging_table_avgEnergy),
            weight = AVG_ENERGY_WEIGHT,
            alignEnd = true,
        ) { row ->
            BodyText(
                AcDcStatsProjection.formatKwh(row.avgEnergy, decimals, locale),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = CELL_MAX_LINES,
            )
        },
        TableColumn(
            key = AcDcColumnKey.AVG_TIME,
            header = stringResource(R.string.translation_charging_table_avgTime),
            weight = AVG_TIME_WEIGHT,
            alignEnd = true,
        ) { row ->
            BodyText(
                AcDcStatsProjection.formatDurationMinutes(row.avgDurationMinutes),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = CELL_MAX_LINES,
            )
        },
        TableColumn(
            key = AcDcColumnKey.FREE,
            header = stringResource(R.string.translation_charging_table_free),
            weight = FREE_WEIGHT,
            alignEnd = true,
        ) { row ->
            BodyText(
                AcDcStatsProjection.formatFreeCell(row, decimals, locale),
                color = TeslaTokens.status.success,
                maxLines = CELL_MAX_LINES,
            )
        },
    )
}

/**
 * The free-charged footer — the web `Free charged: {n} sessions` / `Free energy: {x} kWh` row, shown only when
 * there were free sessions. The figures are emphasized in the success color (web `text-emerald-300`).
 */
@Composable
private fun FreeChargingFooter(
    total: FreeChargingTotal,
    strings: AcDcStatsStrings,
    decimals: Int,
    locale: Locale,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg, Alignment.CenterHorizontally),
    ) {
        FreeChargingStat(
            label = stringResource(R.string.translation_charging_table_freeCharged),
            value = "${total.freeCount} ${strings.sessionsWord}",
        )
        FreeChargingStat(
            label = stringResource(R.string.translation_charging_table_freeEnergy),
            value = AcDcStatsProjection.formatKwh(total.freeEnergy, decimals, locale),
        )
    }
}

/** One "{label}: {value}" free-charged stat, with the value emphasized in the success color. */
@Composable
private fun FreeChargingStat(
    label: String,
    value: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Caption("$label:")
        BodyText(value, color = TeslaTokens.status.success, maxLines = CELL_MAX_LINES)
    }
}

/**
 * First-load skeleton — a title bar over a split-bar block and a two-row table block, so the panel reads as
 * this surface (not a generic spinner) and is never blank while the first fetch runs. Carries a single TalkBack
 * "Loading" description.
 */
@Composable
private fun AcDcStatsLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_WIDTH_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        TableSkeleton(rows = LOADING_TABLE_ROWS, columns = LOADING_TABLE_COLUMNS)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun AcDcStatsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty state — shown when neither AC nor DC has a session, so the panel is never a blank box. */
@Composable
private fun AcDcStatsEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = DataDisplayGlyphs.Bolt,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The header freshness chip — the honest "refreshing / stale / offline" affordance over cached figures. */
@Composable
private fun AcDcFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberAcDcFreshnessFormatter(),
    )
}

/** Source → segment/label color: AC `#3b82f6` → `chart.speed`, DC `#f59e0b` → `chart.energy` (web parity). */
@Composable
private fun sourceColor(source: AcDcSource): Color =
    when (source) {
        AcDcSource.Ac -> TeslaTokens.chart.speed
        AcDcSource.Dc -> TeslaTokens.chart.energy
    }

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10): the two row source
 * labels (web `t('charging.table.acCharging' | 'dcCharging')`), the short AC/DC/Total chips the split bar +
 * footer use (web's bare `AC` / `DC` / `Total` literals, resolved through the shared catalog so no English
 * literal lives in native code), and the "sessions" noun the free footer appends.
 */
data class AcDcStatsStrings(
    val acCharging: String,
    val dcCharging: String,
    val acShort: String,
    val dcShort: String,
    val totalShort: String,
    val sessionsWord: String,
) {
    /** The localized table label for a [source] — web `t('charging.table.acCharging' | 'dcCharging')`. */
    fun rowLabel(source: AcDcSource): String =
        when (source) {
            AcDcSource.Ac -> acCharging
            AcDcSource.Dc -> dcCharging
        }
}

/** Builds the localized [AcDcStatsStrings] from the i18n catalog (P1/S10). Remembered against the resolved strings. */
@Composable
private fun rememberAcDcStatsStrings(): AcDcStatsStrings {
    val acCharging = stringResource(R.string.translation_charging_table_acCharging)
    val dcCharging = stringResource(R.string.translation_charging_table_dcCharging)
    val acShort = stringResource(R.string.translation_AC)
    val dcShort = stringResource(R.string.translation_charging_sessions_filterDC)
    val totalShort = stringResource(R.string.translation_Total)
    val sessionsWord = stringResource(R.string.translation_charging_curve_sessions)
    return remember(acCharging, dcCharging, acShort, dcShort, totalShort, sessionsWord) {
        AcDcStatsStrings(
            acCharging = acCharging,
            dcCharging = dcCharging,
            acShort = acShort,
            dcShort = dcShort,
            totalShort = totalShort,
            sessionsWord = sessionsWord,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberAcDcFreshnessFormatter(): (FreshnessAge) -> String {
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

private const val MIN_SEGMENT_WEIGHT: Float = 0.0001f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    AcDcStatsStrings(
        acCharging = "AC Charging",
        dcCharging = "DC Charging",
        acShort = "AC",
        dcShort = "DC",
        totalShort = "Total",
        sessionsWord = "sessions",
    )

private val PREVIEW_BREAKDOWN =
    AcDcBreakdownData(
        ac = AcDcBucket(energy = 420.5, cost = 52.3, count = 18, totalDuration = 540.0, freeCount = 2, freeEnergy = 30.0),
        dc = AcDcBucket(energy = 1250.0, cost = 210.75, count = 9, totalDuration = 180.0, freeCount = 0, freeEnergy = 0.0),
        total = AcDcTotals(energy = 1670.5, cost = 263.05, freeEnergy = 30.0, freeCount = 2),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun AcDcStatsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AcDcStatsPanelContent(
            state = UiState(UiPhase.Content, data = PREVIEW_BREAKDOWN),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun AcDcStatsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AcDcStatsPanelContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun AcDcStatsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AcDcStatsPanelContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun AcDcStatsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AcDcStatsPanelContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun AcDcStatsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AcDcStatsPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_BREAKDOWN,
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
