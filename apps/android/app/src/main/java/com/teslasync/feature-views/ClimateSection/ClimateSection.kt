// The native Jetpack Compose + Material 3 ClimateSection feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/ClimateSection.tsx. The web component is purely
// presentational: inside a `<GlassPanel className="p-6">` it draws a header (`<Wind/>` + the "Climate" title)
// and then — when `climateData` is present — a responsive `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` of
// eight `<MetricCard>`s (Inside/Outside temperature, Driver setpoint, Fan speed, Seat heater Left/Right,
// Defrost, Climate On); otherwise the panel body shows an `<EmptyState>` ("No climate data available"). The
// header is always present, so the panel never collapses to a blank box.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` -> the i18n catalog (P1/S10) and `useUnits` -> the live [UnitFormatter]
// (P1/S8) for the temperature display preference. The host supplies the climate snapshot through the shared
// P1/S8 state-holder layer as a [UiState], so this feature view renders every lifecycle state that layer can
// carry — loading, hard error with retry, empty, content, and stale/offline (cached "last known") — without
// ever fetching. A web-parity overload that takes the raw `climateData` prop is also provided.
//
// Tile accents map to the active theme tokens (never raw hex in render code): the web `MetricCard color`
// props `green`/`cyan`/`purple` resolve to `status.success` / `chart.regen` / `chart.power`, the same
// color-token discipline the sibling surfaces follow so light/dark theming keeps working. Each tile is a
// grouped, self-describing TalkBack node folding its label and value.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ClimateSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.climatesection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
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
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the tiles lay out four-per-row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the tiles lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 4
private const val GRID_COLUMNS_SM: Int = 3
private const val GRID_COLUMNS_BASE: Int = 2

/** The full tile set sizes the loading skeleton so the grid does not jump on resolve. */
private const val LOADING_TILE_COUNT: Int = 8

/** Each loading tile mirrors a resolved [MetricCard]'s height so the skeleton grid does not jump on resolve. */
private val SKELETON_HEIGHT: Dp = 84.dp

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val FRESHNESS_EM_DASH: String = "\u2014"

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the keys the web
 * component resolves via `t(...)`: the panel [title], the eight tile labels, and the "Level"/"On"/"Off"
 * value words plus the [noData] empty message. Lifecycle-chrome strings (error / retry / offline / freshness)
 * are resolved inline at the Compose boundary.
 */
data class ClimateSectionStrings(
    val title: String,
    val insideTemp: String,
    val outsideTemp: String,
    val driverSetpoint: String,
    val fanSpeed: String,
    val seatHeaterLeft: String,
    val seatHeaterRight: String,
    val defrost: String,
    val climateOn: String,
    val level: String,
    val on: String,
    val off: String,
    val noData: String,
    val loadingLabel: String,
)

/**
 * Stateful entry point for the Climate section. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the live temperature unit (web `useUnits`) from the shared [UnitFormatter], and renders
 * every lifecycle [state] the shared climate-snapshot feed can carry. The host owns the feed (P1/S8) and
 * supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `ClimateSnapshot` (web `climateData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ClimateSection(
    state: UiState<ClimateData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordClimateSectionOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    ClimateSectionContent(state = state, onRetry = onRetry, modifier = modifier, formatter = formatter)
}

/**
 * Web-parity overload mirroring the web component's `climateData: ClimateSnapshot | null | undefined` prop,
 * for hosts that already hold the snapshot. The web `climateData ? … : <EmptyState/>` boundary is reproduced
 * from the prop itself: a non-null snapshot renders the tile grid, a `null` one renders the empty state.
 * Records `view.opened` like the stateful entry; with no fetch behind it, it offers no retry affordance.
 */
@Composable
fun ClimateSection(
    climateData: ClimateData?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(climateData) {
            if (climateData != null) {
                UiState(phase = UiPhase.Content, data = climateData)
            } else {
                UiState(phase = UiPhase.Empty)
            }
        }
    ClimateSection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Wraps the web `GlassPanel` with
 * its always-present `Wind` + "Climate" header, then maps the host feed's [UiState] onto the panel body:
 * loading skeleton, hard error + retry, empty state, or the eight-tile responsive grid. A freshness chip
 * appears in the header when cached data is refreshing / stale / offline, and stale (non-error) data
 * auto-refreshes, mirroring the sibling surfaces' freshness contract. [formatter] is the web `useUnits`
 * temperature formatter the tiles format with.
 */
@Composable
fun ClimateSectionContent(
    state: UiState<ClimateData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    formatter: UnitFormatter = UnitFormatter.default(),
    strings: ClimateSectionStrings = rememberClimateSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val valueStrings = remember(strings) { ClimateValueStrings(strings.level, strings.on, strings.off) }
    val result =
        remember(state.data, formatter, valueStrings) {
            state.data?.let { data ->
                ClimateSectionProjection.project(data, { celsius -> formatter.temperature(celsius) }, valueStrings)
            }
        }
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            ClimateSectionHeader(
                title = strings.title,
                freshness = if (showFreshness) ({ ClimateFreshnessChip(state) }) else null,
            )
            Spacer(modifier = Modifier.height(Spacing.md))
            when {
                state.isLoading -> ClimateLoadingGrid(loadingLabel = strings.loadingLabel)
                state.isError -> ClimateErrorState(onRetry = onRetry)
                result == null -> EmptyState(message = strings.noData)
                else -> ClimateMetricGrid(metrics = result.metrics, strings = strings)
            }
        }
    }
}

/**
 * The panel header — the web `flex items-center gap-2` row of the `Wind` glyph (tinted with the brand accent,
 * the web `var(--neon-cyan)`) and the "Climate" title, with an optional trailing [freshness] chip. Always
 * rendered so the surface carries its title in every state.
 */
@Composable
private fun ClimateSectionHeader(
    title: String,
    freshness: (@Composable () -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                ClimateSectionGlyphs.Wind,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.primary,
            )
            SectionTitle(title)
        }
        if (freshness != null) freshness()
    }
}

/**
 * The resolved branch — the eight tiles in the web responsive grid (`grid-cols-2 sm:grid-cols-3
 * lg:grid-cols-4`). Each tile fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so the tiles keep a uniform width. Cells are spaced by `Spacing.md`, the native
 * expression of the web `gap-3`.
 */
@Composable
private fun ClimateMetricGrid(
    metrics: List<ClimateMetric>,
    strings: ClimateSectionStrings,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = columnsFor(maxWidth)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            metrics.chunked(columns).forEach { rowMetrics ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowMetrics.forEach { metric ->
                        ClimateTile(
                            metric = metric,
                            label = labelFor(metric.id, strings),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(columns - rowMetrics.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A single tile — the web `<MetricCard label value icon color />` exposed as one grouped TalkBack node. */
@Composable
private fun ClimateTile(
    metric: ClimateMetric,
    label: String,
    modifier: Modifier = Modifier,
) {
    MetricCard(
        label = label,
        value = metric.value,
        icon = glyphFor(metric.id),
        accent = toneColor(metric.tone),
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "$label ${metric.value}" },
    )
}

/**
 * The loading branch — [LOADING_TILE_COUNT] skeleton tiles in the same responsive grid as the resolved
 * tiles, carrying a single TalkBack "Loading" content description so the state is announced rather than read
 * as several empty boxes.
 */
@Composable
private fun ClimateLoadingGrid(
    loadingLabel: String,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
    ) {
        val columns = columnsFor(maxWidth)
        val rowCount = (LOADING_TILE_COUNT + columns - 1) / columns
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            repeat(rowCount) { rowIndex ->
                val tilesInRow = minOf(columns, LOADING_TILE_COUNT - rowIndex * columns)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    repeat(tilesInRow) { Skeleton(modifier = Modifier.weight(1f), height = SKELETON_HEIGHT) }
                    repeat(columns - tilesInRow) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The hard-error branch — the shared [ErrorDisplay] with a localized message + retry affordance. */
@Composable
private fun ClimateErrorState(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        modifier = modifier,
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * The freshness chip rendered in the header when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age. Carries no English literal.
 */
@Composable
private fun ClimateFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberClimateFreshnessFormatter(),
    )
}

/** Resolves the responsive column count from the available [width] (web `grid-cols-2 sm:3 lg:4`). */
private fun columnsFor(width: Dp): Int =
    when {
        width >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
        width >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
        else -> GRID_COLUMNS_BASE
    }

/** Maps a tile id to its localized label — the web `t('…')` strings the component renders per tile. */
private fun labelFor(
    id: ClimateMetricId,
    strings: ClimateSectionStrings,
): String =
    when (id) {
        ClimateMetricId.InsideTemp -> strings.insideTemp
        ClimateMetricId.OutsideTemp -> strings.outsideTemp
        ClimateMetricId.DriverSetpoint -> strings.driverSetpoint
        ClimateMetricId.FanSpeed -> strings.fanSpeed
        ClimateMetricId.SeatHeaterLeft -> strings.seatHeaterLeft
        ClimateMetricId.SeatHeaterRight -> strings.seatHeaterRight
        ClimateMetricId.Defrost -> strings.defrost
        ClimateMetricId.ClimateOn -> strings.climateOn
    }

/** Maps a tile id to its leading lucide glyph — the web `icon` prop on each `<MetricCard>`. */
private fun glyphFor(id: ClimateMetricId): ImageVector =
    when (id) {
        ClimateMetricId.InsideTemp -> ClimateSectionGlyphs.Thermometer
        ClimateMetricId.OutsideTemp -> ClimateSectionGlyphs.Thermometer
        ClimateMetricId.DriverSetpoint -> ClimateSectionGlyphs.Thermometer
        ClimateMetricId.FanSpeed -> ClimateSectionGlyphs.Wind
        ClimateMetricId.SeatHeaterLeft -> ClimateSectionGlyphs.CircleDot
        ClimateMetricId.SeatHeaterRight -> ClimateSectionGlyphs.CircleDot
        ClimateMetricId.Defrost -> ClimateSectionGlyphs.Snowflake
        ClimateMetricId.ClimateOn -> ClimateSectionGlyphs.Flame
    }

/** Maps a tile accent identity onto the active theme tokens (web neon `green`/`cyan`/`purple`). */
@Composable
private fun toneColor(tone: ClimateMetricTone): Color =
    when (tone) {
        ClimateMetricTone.Green -> TeslaTokens.status.success
        ClimateMetricTone.Cyan -> TeslaTokens.chart.regen
        ClimateMetricTone.Purple -> TeslaTokens.chart.power
    }

/**
 * Resolves the localized [ClimateSectionStrings] from the i18n catalog (P1/S10): the title, the eight tile
 * labels, the "Level"/"On"/"Off" value words, the empty message, and the loading announcement. All keys
 * exist in the catalog and resolve at compile time, so the surface carries no English literal.
 */
@Composable
fun rememberClimateSectionStrings(): ClimateSectionStrings =
    ClimateSectionStrings(
        title = stringResource(R.string.translation_vehicles_detail_climate),
        insideTemp = stringResource(R.string.translation_common_insideTemp),
        outsideTemp = stringResource(R.string.translation_common_outsideTemp),
        driverSetpoint = stringResource(R.string.translation_vehicles_detail_driverSetpoint),
        fanSpeed = stringResource(R.string.translation_vehicles_detail_fanSpeed),
        seatHeaterLeft = stringResource(R.string.translation_vehicles_detail_seatHeaterL),
        seatHeaterRight = stringResource(R.string.translation_vehicles_detail_seatHeaterR),
        defrost = stringResource(R.string.translation_vehicles_detail_defrost),
        climateOn = stringResource(R.string.translation_vehicles_detail_climateOn),
        level = stringResource(R.string.translation_common_level),
        on = stringResource(R.string.translation_common_on),
        off = stringResource(R.string.translation_common_off),
        noData = stringResource(R.string.translation_vehicles_detail_noClimateData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberClimateFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    ClimateSectionStrings(
        title = "Climate",
        insideTemp = "Inside Temp",
        outsideTemp = "Outside Temp",
        driverSetpoint = "Driver Setpoint",
        fanSpeed = "Fan Speed",
        seatHeaterLeft = "Seat Heater Left",
        seatHeaterRight = "Seat Heater Right",
        defrost = "Defrost",
        climateOn = "Climate On",
        level = "Level",
        on = "On",
        off = "Off",
        noData = "No climate data available",
        loadingLabel = "Loading",
    )

private val PREVIEW_DATA =
    ClimateData(
        insideTempC = 21.5,
        outsideTempC = 12.0,
        driverSetpointC = 22.0,
        fanStatus = 3,
        seatHeaterLeft = 2,
        seatHeaterRight = 0,
        defrostMode = "Front",
        isClimateOn = true,
    )

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun ClimateSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 420)
@Composable
private fun ClimateSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateSectionContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 420)
@Composable
private fun ClimateSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true, widthDp = 420)
@Composable
private fun ClimateSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true, widthDp = 420)
@Composable
private fun ClimateSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimateSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
