// The native Jetpack Compose + Material 3 EnergySummaryPanel feature view — a parity port of
// web/src/features/driving/components/drive-detail/EnergySummaryPanel.tsx. The web component is purely
// presentational: the drive-detail page computes the per-row `stats` and passes `drive` + `stats` down, and it
// renders one GlassPanel with a BatteryCharging header ("Energy Summary") over a responsive
// `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` grid of six centered stat tiles — Energy Consumed, Energy
// Recovered, Net Consumption, Efficiency, Battery Used, and Range Used. The whole panel mounts through a
// `<FadeIn>`.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web hooks
// are `useTranslation`, mapped to the i18n catalog P1/S10; and `useUnits`, mapped to the live S8 SettingsStore
// for the distance unit, locale, and precision). The owning drive-detail page computes the snapshot and threads
// it in through the shared state-holder layer as a [UiState], so this view also renders every lifecycle state
// that layer can carry — a loading skeleton grid, a hard error with retry, a friendly empty state, content, and
// stale/offline cached "last known" with a freshness chip + auto-refresh — without ever fetching, exactly like
// the sibling card-grid ports. The content branch reproduces the web tile grid verbatim, including the two
// conditional `—` values and the Battery Used detail line, and fades in as the web `<FadeIn>` does. A web-parity
// overload taking the raw snapshot (web `{ drive, stats }`) is provided for hosts that already hold it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EnergySummaryPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.energysummarypanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
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

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the six tiles lay out in a single row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the tiles lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 6
private const val GRID_COLUMNS_SM: Int = 3
private const val GRID_COLUMNS_BASE: Int = 2

/** The six tiles the web component renders; also the skeleton tile count while the host's feed first loads. */
private const val TILE_COUNT: Int = 6

private const val SKELETON_VALUE_FRACTION: Float = 0.7f
private const val SKELETON_LABEL_FRACTION: Float = 0.5f
private val SKELETON_VALUE_HEIGHT: Dp = 22.dp
private val SKELETON_LABEL_HEIGHT: Dp = 10.dp

/**
 * Stateful entry point for the energy summary panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live distance-unit + locale + precision preferences from the shared S8 SettingsStore (the
 * native binding of the web `useUnits` hook; metric/en-US/2-decimal defaults apply until settings load), and
 * renders every lifecycle [state] the host's drive feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [EnergySummarySnapshot].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the units + locale; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EnergySummaryPanel(
    state: UiState<EnergySummarySnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { EnergySummaryPanelDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { EnergySummaryDisplayPrefs.from(settingsResource.cached) }
    EnergySummaryPanelContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ drive, stats })` props bundled into one snapshot, for
 * hosts that already hold the computed values. A `null` [snapshot] projects onto the empty [UiState] (the
 * drive-detail page's no-data branch). There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun EnergySummaryPanel(
    snapshot: EnergySummarySnapshot?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(snapshot) { EnergySummaryPanelProjection.projectUiState(snapshot, isLoading = false) }
    EnergySummaryPanel(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Always draws the outer
 * panel + BatteryCharging header, then the per-state body: a freshness chip + auto-refresh when content is
 * stale/refreshing/offline (the shared cache-then-network freshness contract), a loading skeleton grid, a hard
 * error with retry, a friendly empty state (so the panel never blanks), and the resolved six-tile grid that
 * fades in. [prefs] supplies the efficiency conversion, the distance-unit label, and the grouping locale.
 */
@Composable
fun EnergySummaryPanelContent(
    state: UiState<EnergySummarySnapshot>,
    onRetry: () -> Unit,
    prefs: EnergySummaryDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: EnergySummaryStrings = rememberEnergySummaryStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val isDegraded = state.stale || state.refreshing || state.hasError
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        EnergySummaryHeader(title = strings.title)
        Spacer(modifier = Modifier.height(Spacing.lg))
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            if (snapshot != null && isDegraded) {
                EnergySummaryFreshnessRow(state = state)
            }
            when {
                state.isLoading -> EnergyLoadingGrid()
                state.isError -> EnergyError(onRetry = onRetry)
                state.isEmpty || snapshot == null -> EnergyEmpty(message = strings.noData)
                else -> FadeIn { EnergyResolvedGrid(snapshot = snapshot, prefs = prefs, strings = strings) }
            }
        }
    }
}

/**
 * The panel header — the web `<h3>` with its BatteryCharging icon and the "Energy Summary" title. The icon is
 * decorative (the title carries the heading semantics), tinted with the green battery accent (web
 * `text-green-400`).
 */
@Composable
private fun EnergySummaryHeader(title: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            DataDisplayGlyphs.BatteryCharging,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.battery,
        )
        SectionTitle(title)
    }
}

/**
 * A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content — the native
 * expression of the shared [DataFreshness] contract (the web page's poll/`refetch`). Lives above the grid.
 */
@Composable
private fun EnergySummaryFreshnessRow(state: UiState<EnergySummarySnapshot>) {
    val formatAge = rememberEnergyFreshnessFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/**
 * The content branch: the resolved six tiles laid out in the web responsive grid. Derives the render-ready
 * tiles once via the pure [EnergySummaryPanelProjection.tiles].
 */
@Composable
private fun EnergyResolvedGrid(
    snapshot: EnergySummarySnapshot,
    prefs: EnergySummaryDisplayPrefs,
    strings: EnergySummaryStrings,
) {
    val tiles = remember(snapshot, prefs, strings) { EnergySummaryPanelProjection.tiles(snapshot, prefs, strings) }
    EnergyGrid(itemCount = tiles.size) { index, cellModifier ->
        EnergyTile(tile = tiles[index], modifier = cellModifier)
    }
}

/**
 * A single centered stat tile — the native analogue of a web grid cell: a small muted [label] above a large
 * accent-colored value, and (for Battery Used) a muted detail subline. The tile merges its descendants under
 * one accessible label so TalkBack reads "label: value[, detail]" as a unit.
 */
@Composable
private fun EnergyTile(
    tile: EnergySummaryTile,
    modifier: Modifier = Modifier,
) {
    val description = EnergySummaryPanelProjection.accessibilityLabel(tile.label, tile.value, tile.subline)
    Column(
        modifier = modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(tile.label)
        Text(
            text = tile.value,
            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            color = tile.stat.accent(),
            textAlign = TextAlign.Center,
        )
        if (tile.subline != null) {
            HelperText(tile.subline)
        }
    }
}

/** The loading branch: six skeleton tiles in the same responsive grid, announced as "Loading" to TalkBack. */
@Composable
private fun EnergyLoadingGrid() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    EnergyGrid(
        itemCount = TILE_COUNT,
        modifier = Modifier.clearAndSetSemantics { contentDescription = loadingLabel },
    ) { _, cellModifier ->
        EnergySkeletonTile(modifier = cellModifier)
    }
}

/** A single loading tile — a centered label bar above a value bar (the stat-tile skeleton shape). */
@Composable
private fun EnergySkeletonTile(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
        Skeleton(widthFraction = SKELETON_VALUE_FRACTION, height = SKELETON_VALUE_HEIGHT)
    }
}

/**
 * Empty state — the `common.noData` message with a battery glyph, so the grid never collapses to a blank box.
 * [EmptyState] exposes the message as its accessibility label, so the section is still announced to TalkBack.
 */
@Composable
private fun EnergyEmpty(message: String) {
    EmptyState(message = message, icon = DataDisplayGlyphs.Battery, modifier = Modifier.fillMaxWidth())
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun EnergyError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Lays out [itemCount] cells as the web responsive grid: six-per-row at or above [GRID_LG_MIN_WIDTH]
 * (`lg:grid-cols-6`), three-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:grid-cols-3`), and two-per-row below it
 * (`grid-cols-2`). Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so cells keep a uniform width. Cells are spaced by `Spacing.md`, the native expression of
 * the web `gap-4`.
 */
@Composable
private fun EnergyGrid(
    itemCount: Int,
    modifier: Modifier = Modifier,
    item: @Composable (Int, Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        val rows = (0 until itemCount).chunked(columns)
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            for (rowIndices in rows) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    for (index in rowIndices) {
                        item(index, Modifier.weight(1f))
                    }
                    repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Builds the localized [EnergySummaryStrings] from the i18n catalog (P1/S10): the `driveDetail.*` labels the web
 * component reads through `useTranslation` plus `common.noData`. Resolved once at the Compose boundary so the
 * rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberEnergySummaryStrings(): EnergySummaryStrings {
    val title = stringResource(R.string.translation_driveDetail_energySummary)
    val energyConsumed = stringResource(R.string.translation_driveDetail_energyConsumed)
    val energyRecovered = stringResource(R.string.translation_driveDetail_energyRecovered)
    val netConsumption = stringResource(R.string.translation_driveDetail_netConsumption)
    val efficiency = stringResource(R.string.translation_driveDetail_efficiency)
    val batteryUsed = stringResource(R.string.translation_driveDetail_batteryUsed)
    val rangeUsed = stringResource(R.string.translation_driveDetail_rangeUsed)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(title, energyConsumed, energyRecovered, netConsumption, efficiency, batteryUsed, rangeUsed, noData) {
        EnergySummaryStrings(
            title = title,
            energyConsumed = energyConsumed,
            energyRecovered = energyRecovered,
            netConsumption = netConsumption,
            efficiency = efficiency,
            batteryUsed = batteryUsed,
            rangeUsed = rangeUsed,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberEnergyFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * The tile accent — the native mirror of the web Tailwind text color on each value. The web hues map onto the
 * theme-invariant chart tokens, which carry the matching values: amber (`chart.energy`) for Energy Consumed +
 * Battery Used, green (`chart.battery`) for Energy Recovered + Range Used, cyan (`chart.regen`) for Net
 * Consumption, and purple (`chart.power`) for Efficiency.
 */
@Composable
private fun EnergyStat.accent(): Color =
    when (this) {
        EnergyStat.EnergyConsumed -> TeslaTokens.chart.energy
        EnergyStat.EnergyRecovered -> TeslaTokens.chart.battery
        EnergyStat.NetConsumption -> TeslaTokens.chart.regen
        EnergyStat.Efficiency -> TeslaTokens.chart.power
        EnergyStat.BatteryUsed -> TeslaTokens.chart.energy
        EnergyStat.RangeUsed -> TeslaTokens.chart.battery
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    EnergySummaryStrings(
        title = "Energy Summary",
        energyConsumed = "Energy Consumed",
        energyRecovered = "Energy Recovered",
        netConsumption = "Net Consumption",
        efficiency = "Efficiency",
        batteryUsed = "Battery Used",
        rangeUsed = "Range Used",
        noData = "No data available",
    )

private val PREVIEW_SNAPSHOT =
    EnergySummarySnapshot(
        energyWh = 9_400.0,
        regenWh = 2_100.0,
        consumptionWhKm = 168.0,
        startRange = 210.0,
        endRange = 180.0,
        startBatteryPct = 82.0,
        endBatteryPct = 57.0,
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun EnergySummaryPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergySummaryPanelContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            prefs = EnergySummaryDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun EnergySummaryPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergySummaryPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = EnergySummaryDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun EnergySummaryPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergySummaryPanelContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = EnergySummaryDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun EnergySummaryPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergySummaryPanelContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = EnergySummaryDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun EnergySummaryPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EnergySummaryPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = EnergySummaryDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}
