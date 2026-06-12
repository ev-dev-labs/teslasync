// The native Jetpack Compose + Material 3 TemperatureSection feature view — a parity port of
// web/src/features/driving/components/drive-detail/TemperatureSection.tsx. The web component is purely
// presentational: inside a `<FadeIn>` it wraps the shared `<ChartContainer title="Temperatures"
// height={310}>` around a six-tile stat grid (Outside / Inside / Driver / Passenger / Climate / Fan,
// each conditional) plus a Recharts `<LineChart>` of up to four conditional temperature lines, or — when
// there is ≤ 1 sample or no temperature at all — a friendly "No temperature telemetry…" empty surface.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its
// web hooks map as: `useTranslation` → the i18n catalog (P1/S10), `useUnits` → the live [UnitFormatter]
// (P1/S8) for the temperature unit symbol + locale + precision, and `useSyncedCursor` /
// `useSyncedReferenceLineX` → [cursorSyncPosition] over the shared cursor store, surfaced as a marker rail
// (the Vico counterpart of the web `<ReferenceLine x={syncedX}>`). The host supplies the per-sample trace
// through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the
// selected drive's already-display-unit temperature samples), so this feature view renders every lifecycle
// state that layer can carry — loading, hard error with retry, empty, content, and stale/offline ("last
// known") — without ever fetching. A web-parity overload that takes the raw samples is also provided.
//
// Colors map to the generated CB-safe categorical palette (never raw hex in render code): Outside →
// `paletteColor(0)`, Inside → `1`, Driver → `5`, Passenger → `6`; the legend swatch + the matching stat
// tile reuse the same slot so swatch, plotted line and tile always agree. The web picks its own per-series
// hex literals (`#3b82f6`…`#a855f7`); reproducing those verbatim would reintroduce raw hex into component
// code (forbidden) and bypass light/dark theming, so — exactly as the sibling surfaces do — each series
// takes a distinct, color-blind-safe categorical slot. Climate uses the semantic success / muted tokens
// (web green only when "On") and Fan uses the info token (web cyan). Vico renders no legend, so — as the
// `chart-a11y:no-table` web comment intends — a compact swatch+name legend plus the colored stat tiles are
// the screen-reader story (no hidden data table).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TemperatureSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.temperaturesection

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.cursorSyncPosition
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ChartContainer height={310}>` plot height. */
private val CHART_HEIGHT: Dp = 310.dp

/** The fixed three-column tile grid (web `grid grid-cols-3`). */
private const val TILE_COLUMNS: Int = 3

/** Series keys — the web `<Line dataKey="…">` keys, used for cursor-sync hidden-key plumbing. */
private const val OUTSIDE_KEY: String = "outsideTemp"
private const val INSIDE_KEY: String = "insideTemp"
private const val DRIVER_KEY: String = "driverTemp"
private const val PASSENGER_KEY: String = "passengerTemp"

/** Axis tick precision — temperatures read as whole numbers on the value axis. */
private const val AXIS_DECIMALS: Int = 0

/** The web middle-dot separator in the fan-status value (`… · Max …`). */
private const val FAN_SEPARATOR: String = "\u00B7"

/**
 * The page-scoped cursor `syncId` — the web `<ChartTimeRangeProvider syncId="drive-detail">` that
 * `useSyncedCursor` / `useSyncedReferenceLineX` read. When this chart is hosted next to the other drive
 * detail charts under the same id, the shared cursor store mirrors the hovered sample here as a marker.
 */
private const val DEFAULT_SYNC_ID: String = "drive-detail"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val FRESHNESS_EM_DASH: String = "\u2014"

/** Legend / tile color-swatch geometry (the web `w-4` line swatch). */
private val SWATCH_WIDTH: Dp = 16.dp
private val SWATCH_HEIGHT: Dp = 3.dp

/** Resource name (by-name; absent ⇒ [TemperatureSectionDefaults.ARIA_LABEL]) for `driveDetail.temperatures.aria`. */
const val KEY_ARIA: String = "translation_driveDetail_temperatures_aria"

/** Resource name (by-name; absent ⇒ [TemperatureSectionDefaults.CLIMATE_MOSTLY_OFF]) for the "Mostly Off" status. */
const val KEY_CLIMATE_MOSTLY_OFF: String = "translation_driveDetail_climateMostlyOff"

/**
 * Native fallback microcopy. Every visible title / tile / series / empty key
 * (`driveDetail.temperatures`, `driveDetail.outsideTemp`, …, `driveDetail.noTemperatureData`) plus the
 * climate On/Off labels (`common.on` / `common.off`) and the `Max` label exist in the i18n catalog
 * (P1/S10) and resolve at compile time. These defaults back the two strings the catalog does not define:
 * the chart's accessible description (web `t('driveDetail.temperatures.aria', …)`) and the "Mostly Off"
 * climate status (the web parent emits the literal `'Mostly Off'` with no `t()` call). They reproduce
 * i18next's "return the default when the key is absent" behaviour, so the surface still carries the web's
 * exact English fallback while routing through the i18n facade.
 */
object TemperatureSectionDefaults {
    /** Web `t('driveDetail.temperatures.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String =
        "Inside, outside, driver and passenger temperature lines over the drive timeline"

    /** Web parent literal `'Mostly Off'` (no `t()` in the web source) — the partial-climate status label. */
    const val CLIMATE_MOSTLY_OFF: String = "Mostly Off"
}

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the keys the web
 * component resolves via `t(...)`. The four series share a short [outside]/[inside]/[driver]/[passenger]
 * label (the chart line names + legend) and a long [outsideTemp]/[insideTemp]/[driverTemp]/[passengerTemp]
 * tile caption; [climate]/[fanStatus] caption the last two tiles; [avg]/[max] build the fan value;
 * [climateOn]/[climateOff]/[climateMostlyOff] are the climate status texts; [title] heads the container and
 * [ariaLabel] describes the chart (catalog-absent ⇒ the web English fallback).
 */
data class TemperatureSectionStrings(
    val title: String,
    val outsideTemp: String,
    val insideTemp: String,
    val driverTemp: String,
    val passengerTemp: String,
    val climate: String,
    val fanStatus: String,
    val avg: String,
    val max: String,
    val outside: String,
    val inside: String,
    val driver: String,
    val passenger: String,
    val climateOn: String,
    val climateOff: String,
    val climateMostlyOff: String,
    val ariaLabel: String,
)

/**
 * Stateful entry point for the TemperatureSection. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the live display unit + locale + precision (web `useUnits`) from the shared
 * [UnitFormatter], and renders every lifecycle [state] the shared drive-trace feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the temperature samples (web `chartData` + `stats`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param syncId the page cursor-sync id (web `useSyncedCursor`); `null` disables the synced marker.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TemperatureSection(
    state: UiState<List<TemperatureSample>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TemperatureSectionDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    TemperatureSectionContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        syncId = syncId,
        unitLabel = formatter.prefs.temperature.label,
        locale = resolveDisplayLocale(formatter.prefs.locale),
        precision = formatter.prefs.precision ?: DEFAULT_PRECISION,
    )
}

/**
 * Web-parity overload mirroring the web component's `chartData` / `stats` props, for hosts that already
 * hold the loaded samples. The web `chartData.length > 1 && hasAnyTemp` boundary is reproduced by the
 * projection: ≤ 1 sample or no temperature renders the empty surface. Records `view.opened` like the
 * stateful entry; with no fetch behind it, it offers no retry affordance.
 */
@Composable
fun TemperatureSection(
    samples: List<TemperatureSample>?,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(samples) {
            val items = samples ?: emptyList()
            val phase = if (items.size > 1) UiPhase.Content else UiPhase.Empty
            UiState(phase = phase, data = items)
        }
    TemperatureSection(state = state, onRetry = {}, modifier = modifier, syncId = syncId, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready), and in the ready state
 * renders the conditional stat-tile grid + the temperature [LineChartWrapper] inside a [FadeIn], followed
 * by the compact swatch+name legend — reproducing the web `FadeIn` + `ChartContainer` + tiles + `LineChart`
 * + `Legend` composition. A freshness chip appears when cached data is refreshing / stale / offline, and
 * stale (non-error) data auto-refreshes, mirroring the web freshness contract. [unitLabel]/[locale]/
 * [precision] are the web `useUnits` outputs the values format with.
 */
@Composable
fun TemperatureSectionContent(
    state: UiState<List<TemperatureSample>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    unitLabel: String = "\u00B0C",
    locale: Locale = Locale.getDefault(),
    precision: Int = DEFAULT_PRECISION,
    strings: TemperatureSectionStrings = rememberTemperatureSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val display =
        remember(state.data, unitLabel, precision, locale) {
            TemperatureSectionProjection.project(state.data ?: emptyList(), unitLabel, precision, locale)
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            display.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val series = remember(display) { buildTemperatureSeries(display, strings) }

    val syncedIndex = cursorSyncPosition(syncId)
    val markers =
        remember(syncedIndex, display.xLabels) {
            val index = syncedIndex
            if (index != null && index in display.xLabels.indices) {
                listOf(ChartVerticalMarker(index = index, label = display.xLabels[index], severity = MarkerSeverity.Info))
            } else {
                emptyList()
            }
        }

    val emptyMessage = stringResource(R.string.translation_driveDetail_noTemperatureData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ChartContainer(
                title = strings.title,
                status = status,
                height = CHART_HEIGHT,
                action =
                    if (showFreshness) {
                        { TemperatureFreshnessChip(state) }
                    } else {
                        null
                    },
                accessibleDescription = strings.ariaLabel,
                emptyMessage = emptyMessage,
                errorMessage = stringResource(R.string.translation_error_serverError_message),
                retryLabel = stringResource(R.string.translation_common_retry),
                onRetry = onRetry,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    TemperatureTileGrid(tiles = display.tiles, strings = strings)
                    LineChartWrapper(
                        series = series,
                        xLabels = display.xLabels,
                        height = CHART_HEIGHT,
                        markers = markers,
                        yValueFormatter = { value -> TemperatureSectionProjection.formatNumber(value, AXIS_DECIMALS, locale) },
                        emptyMessage = emptyMessage,
                    )
                    TemperatureLegend(series = display.series, unitLabel = display.unitLabel, strings = strings)
                }
            }
        }
    }
}

/**
 * Builds the present [ChartSeries] from the projection — the native analogue of the web conditional
 * `<Line>`s. Each line is present only when its value column survived the projection guards; the series
 * name carries the web `"{label} {tempUnit}"` suffix and the color takes the per-series categorical slot.
 */
private fun buildTemperatureSeries(
    display: TemperatureSectionDisplay,
    strings: TemperatureSectionStrings,
): List<ChartSeries> =
    display.series.map { entry ->
        ChartSeries(
            key = seriesKey(entry.id),
            label = "${seriesShortLabel(entry.id, strings)} ${display.unitLabel}",
            values = entry.values,
            kind = ChartSeriesKind.Line,
            color = temperatureSeriesColor(entry.id),
            unit = display.unitLabel,
        )
    }

/** The web `<Line dataKey>` key for a series — stable across recompositions for the cursor-sync plumbing. */
private fun seriesKey(id: TemperatureSeriesId): String =
    when (id) {
        TemperatureSeriesId.Outside -> OUTSIDE_KEY
        TemperatureSeriesId.Inside -> INSIDE_KEY
        TemperatureSeriesId.Driver -> DRIVER_KEY
        TemperatureSeriesId.Passenger -> PASSENGER_KEY
    }

/** The categorical-palette slot for each series — the native stand-in for the web per-series hex literals. */
private fun temperatureSeriesColorIndex(id: TemperatureSeriesId): Int =
    when (id) {
        TemperatureSeriesId.Outside -> 0
        TemperatureSeriesId.Inside -> 1
        TemperatureSeriesId.Driver -> 5
        TemperatureSeriesId.Passenger -> 6
    }

/** Resolves the generated CB-safe categorical color for [id]; shared by the plot, legend swatch and tile. */
private fun temperatureSeriesColor(id: TemperatureSeriesId): Color = paletteColor(temperatureSeriesColorIndex(id))

/** The short series label (chart line name + legend) for [id] — the web `t('driveDetail.outside')` family. */
private fun seriesShortLabel(
    id: TemperatureSeriesId,
    strings: TemperatureSectionStrings,
): String =
    when (id) {
        TemperatureSeriesId.Outside -> strings.outside
        TemperatureSeriesId.Inside -> strings.inside
        TemperatureSeriesId.Driver -> strings.driver
        TemperatureSeriesId.Passenger -> strings.passenger
    }

/** The long tile caption for a temperature [id] — the web `t('driveDetail.outsideTemp')` family. */
private fun tempTileLabel(
    id: TemperatureSeriesId,
    strings: TemperatureSectionStrings,
): String =
    when (id) {
        TemperatureSeriesId.Outside -> strings.outsideTemp
        TemperatureSeriesId.Inside -> strings.insideTemp
        TemperatureSeriesId.Driver -> strings.driverTemp
        TemperatureSeriesId.Passenger -> strings.passengerTemp
    }

/** The localized climate-status text for [status] — web `'On'` / `'Mostly Off'` / `'Off'`. */
private fun climateLabel(
    status: ClimateStatus,
    strings: TemperatureSectionStrings,
): String =
    when (status) {
        ClimateStatus.On -> strings.climateOn
        ClimateStatus.MostlyOff -> strings.climateMostlyOff
        ClimateStatus.Off -> strings.climateOff
    }

/**
 * The fixed three-column tile grid — the web `grid grid-cols-3 gap-3`. Each present [TemperatureTile] is
 * resolved to its localized caption, fully-formatted value and accent color (Temp tiles reuse the series
 * palette slot; Climate is the success token when On else muted; Fan is the info token), then rendered as
 * a self-describing tile. A partial trailing row is padded with weighted spacers so widths stay uniform.
 */
@Composable
private fun TemperatureTileGrid(
    tiles: List<TemperatureTile>,
    strings: TemperatureSectionStrings,
) {
    if (tiles.isEmpty()) return
    val success = TeslaTokens.status.success
    val info = TeslaTokens.status.info
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val cells =
        tiles.map { tile ->
            when (tile) {
                is TemperatureTile.Temp ->
                    ResolvedTile(tempTileLabel(tile.id, strings), tile.value, temperatureSeriesColor(tile.id))
                is TemperatureTile.Climate ->
                    ResolvedTile(
                        strings.climate,
                        climateLabel(tile.status, strings),
                        if (tile.status == ClimateStatus.On) success else muted,
                    )
                is TemperatureTile.Fan ->
                    ResolvedTile(
                        strings.fanStatus,
                        "${strings.avg} ${tile.avg} $FAN_SEPARATOR ${strings.max} ${tile.max}",
                        info,
                    )
            }
        }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        cells.chunked(TILE_COLUMNS).forEach { rowCells ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                rowCells.forEach { cell ->
                    TempStatTile(label = cell.label, value = cell.value, accent = cell.accent, modifier = Modifier.weight(1f))
                }
                repeat(TILE_COLUMNS - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

/** A resolved tile's render inputs — its localized caption, formatted value and accent color. */
private data class ResolvedTile(
    val label: String,
    val value: String,
    val accent: Color,
)

/**
 * A single stat tile — the web `<div class="rounded-lg bg-white/[0.03] border p-2 text-center">` with a
 * tiny caption above a bold, accent-colored value. Exposed to TalkBack as one grouped, self-describing
 * node ("{label}: {value}") so the dense tile reads as a unit.
 */
@Composable
private fun TempStatTile(
    label: String,
    value: String,
    accent: Color,
    modifier: Modifier,
) {
    Card(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "$label: $value" },
        padding = CardPadding.Sm,
    ) {
        Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            MetricLabel(label)
            Heading(
                text = value,
                level = HeadingLevel.Sub,
                color = accent,
                modifier = Modifier.padding(top = Spacing.xs),
            )
        }
    }
}

/**
 * The compact swatch + name legend rendered below the chart — the native counterpart of the web Recharts
 * `<Legend>`. Each present series contributes a row: a colored line swatch and the `"{label} {tempUnit}"`
 * series name, grouped as one TalkBack node. Wraps like the web flex legend; renders nothing when no line
 * is present (the empty/loading/error states never reach it).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TemperatureLegend(
    series: List<TemperatureSeries>,
    unitLabel: String,
    strings: TemperatureSectionStrings,
) {
    if (series.isEmpty()) return
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        series.forEach { entry ->
            val name = "${seriesShortLabel(entry.id, strings)} $unitLabel"
            Row(
                modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = name },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                LegendSwatch(color = temperatureSeriesColor(entry.id))
                Caption(name)
            }
        }
    }
}

/** The horizontal line swatch shown beside a legend name (web `border-t-2` color swatch). */
@Composable
private fun LegendSwatch(color: Color) {
    Box(
        modifier =
            Modifier
                .size(width = SWATCH_WIDTH, height = SWATCH_HEIGHT)
                .clip(RoundedCornerShape(Radius.sm))
                .background(color),
    )
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun TemperatureFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberTemperatureFreshnessFormatter(),
    )
}

/**
 * Builds the localized [TemperatureSectionStrings] from the i18n catalog (P1/S10): the title, tile/series
 * labels, Avg/Max labels and climate On/Off texts resolve through compile-time resources; the aria
 * description and the "Mostly Off" climate text resolve by-name with the web `t(key, default)` fallback,
 * since the catalog defines no key for them. Remembered against the resolved strings so a locale change
 * re-projects.
 */
@Composable
fun rememberTemperatureSectionStrings(): TemperatureSectionStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_driveDetail_temperatures)
    val outsideTemp = stringResource(R.string.translation_driveDetail_outsideTemp)
    val insideTemp = stringResource(R.string.translation_driveDetail_insideTemp)
    val driverTemp = stringResource(R.string.translation_driveDetail_driverTemp)
    val passengerTemp = stringResource(R.string.translation_driveDetail_passengerTemp)
    val climate = stringResource(R.string.translation_driveDetail_climate)
    val fanStatus = stringResource(R.string.translation_driveDetail_fanStatus)
    val avg = stringResource(R.string.translation_driveDetail_avg)
    val max = stringResource(R.string.translation_Max)
    val outside = stringResource(R.string.translation_driveDetail_outside)
    val inside = stringResource(R.string.translation_driveDetail_inside)
    val driver = stringResource(R.string.translation_driveDetail_driver)
    val passenger = stringResource(R.string.translation_driveDetail_passenger)
    val climateOn = stringResource(R.string.translation_common_on)
    val climateOff = stringResource(R.string.translation_common_off)
    val mostlyOff = resolveOptional({ context.optionalString(it) }, KEY_CLIMATE_MOSTLY_OFF, TemperatureSectionDefaults.CLIMATE_MOSTLY_OFF)
    val ariaLabel = resolveOptional({ context.optionalString(it) }, KEY_ARIA, TemperatureSectionDefaults.ARIA_LABEL)
    return remember(
        title,
        outsideTemp,
        insideTemp,
        driverTemp,
        passengerTemp,
        climate,
        fanStatus,
        avg,
        max,
        outside,
        inside,
        driver,
        passenger,
        climateOn,
        climateOff,
        mostlyOff,
        ariaLabel,
    ) {
        TemperatureSectionStrings(
            title = title,
            outsideTemp = outsideTemp,
            insideTemp = insideTemp,
            driverTemp = driverTemp,
            passengerTemp = passengerTemp,
            climate = climate,
            fanStatus = fanStatus,
            avg = avg,
            max = max,
            outside = outside,
            inside = inside,
            driver = driver,
            passenger = passenger,
            climateOn = climateOn,
            climateOff = climateOff,
            climateMostlyOff = mostlyOff,
            ariaLabel = ariaLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberTemperatureFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> FRESHNESS_EM_DASH
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

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map in
 * tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    TemperatureSectionStrings(
        title = "Temperatures",
        outsideTemp = "Outside Temperature",
        insideTemp = "Inside Temperature",
        driverTemp = "Driver Temperature",
        passengerTemp = "Passenger Temperature",
        climate = "Climate",
        fanStatus = "Fan Status",
        avg = "Avg",
        max = "Max",
        outside = "Outside",
        inside = "Inside",
        driver = "Driver",
        passenger = "Passenger",
        climateOn = "On",
        climateOff = "Off",
        climateMostlyOff = "Mostly Off",
        ariaLabel = TemperatureSectionDefaults.ARIA_LABEL,
    )

private val PREVIEW_SAMPLES =
    listOf(
        TemperatureSample("09:00", outsideTemp = 9.0, insideTemp = 18.0, driverTemp = 21.0, climateOn = true, fanStatus = 3.0),
        TemperatureSample("09:05", outsideTemp = 11.5, insideTemp = 20.0, driverTemp = 21.0, climateOn = true, fanStatus = 5.0),
        TemperatureSample("09:10", outsideTemp = 14.0, insideTemp = 21.5, driverTemp = 22.0, climateOn = true, fanStatus = 6.0),
        TemperatureSample("09:15", outsideTemp = 13.0, insideTemp = 21.0, driverTemp = 22.0, climateOn = false, fanStatus = 2.0),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun TemperatureSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_SAMPLES),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TemperatureSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TemperatureSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureSectionContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TemperatureSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
