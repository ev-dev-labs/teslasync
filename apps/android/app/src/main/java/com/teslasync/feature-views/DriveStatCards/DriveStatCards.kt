// The native Jetpack Compose + Material 3 DriveStatCards feature view — a parity port of
// web/src/features/driving/components/drive-detail/DriveStatCards.tsx. The web component is purely
// presentational: the drive-detail page computes the per-row `stats` and passes `drive` + `stats` down, and it
// renders a responsive `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8` grid of <IconStatCard> tiles — Distance,
// Duration, Max Speed, Avg Speed, SOC, Max Power, Elev. Gain, Elev. Loss, plus Trip Cost (when energy was used)
// and Cost / {unit} (when there is also distance). Distance converts from SI at render via `useUnits`, the cost
// tiles use `useFormatting`, and five numeric tiles count up via `<AnimatedNumber>`.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web hooks
// are `useTranslation`, mapped to the i18n catalog P1/S10; `useUnits` + `useFormatting`, mapped to the live S8
// SettingsStore for the distance/speed units, currency symbol, cost-per-kWh, precision and locale). The owning
// drive-detail page computes the snapshot and threads it in through the shared state-holder layer as a
// [UiState], so this view also renders every lifecycle state that layer can carry — a loading skeleton grid, a
// hard error with retry, a friendly empty state, content, and stale/offline cached "last known" with a
// freshness chip + auto-refresh — without ever fetching, exactly like the sibling card-grid ports. The content
// branch reproduces the web tile grid verbatim, including the per-tile count-up (which collapses to the final
// value under reduced motion) and the two conditional cost tiles. A web-parity overload taking the raw snapshot
// (web `{ drive, stats }`) is provided for hosts that already hold it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DriveStatCards — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivestatcards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
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

/** Web Tailwind `lg` breakpoint region: at or above this width the tiles lay out eight-per-row (`lg:grid-cols-8`). */
private val GRID_EXPANDED_MIN: Dp = 840.dp

/** Web Tailwind `sm` breakpoint region: at or above this width the tiles lay out four-per-row (`sm:grid-cols-4`). */
private val GRID_MEDIUM_MIN: Dp = 600.dp

/** Web base `grid-cols-2`: below the `sm` breakpoint the tiles lay out two-per-row. */
private const val GRID_COLUMNS_EXPANDED = 8
private const val GRID_COLUMNS_MEDIUM = 4
private const val GRID_COLUMNS_COMPACT = 2

/** The eight always-on tiles shown as skeletons while the host's feed first loads. */
private const val SKELETON_TILE_COUNT = 8

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/** Accessible label connector between a tile's label and its value (web tiles read "label, value"). */
private const val LABEL_VALUE_SEPARATOR = ", "

private const val SKELETON_ICON_FRACTION = 0.4f
private const val SKELETON_VALUE_FRACTION = 0.7f
private const val SKELETON_LABEL_FRACTION = 0.5f
private val SKELETON_ICON_HEIGHT: Dp = 16.dp
private val SKELETON_VALUE_HEIGHT: Dp = 20.dp
private val SKELETON_LABEL_HEIGHT: Dp = 10.dp

/**
 * Stateful entry point for the drive stat tiles. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live unit + currency + cost-per-kWh + precision + locale preferences from the shared S8
 * SettingsStore (the native binding of the web `useUnits`/`useFormatting` hooks; metric/`$`/0.12/2dp/en-US
 * defaults apply until settings load), and renders every lifecycle [state] the shared drive feed can carry. The
 * host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [DriveStatCardsSnapshot].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the units + currency + locale; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveStatCards(
    state: UiState<DriveStatCardsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DriveStatCardsDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { DriveStatDisplayPrefs.from(settingsResource.cached) }
    DriveStatCardsContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ drive, stats })` props bundled into one snapshot, for
 * hosts that already hold the computed values. A `null` [snapshot] projects onto the empty [UiState] (the
 * drive-detail page's no-data branch). There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun DriveStatCards(
    snapshot: DriveStatCardsSnapshot?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(snapshot) { DriveStatCardsProjection.projectUiState(snapshot, isLoading = false) }
    DriveStatCards(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. A freshness chip is
 * shown above the grid when content is stale/refreshing/offline, and stale (non-error) data auto-refreshes,
 * mirroring the shared cache-then-network freshness contract. Inside it switches between a loading skeleton
 * grid, a hard-error retry surface, a friendly empty state (so the surface never blanks), and the resolved tile
 * grid. [prefs] supplies the SI -> display conversion, the currency/cost formatting, and the grouping locale.
 */
@Composable
fun DriveStatCardsContent(
    state: UiState<DriveStatCardsSnapshot>,
    onRetry: () -> Unit,
    prefs: DriveStatDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: DriveStatCardsStrings = rememberDriveStatCardsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val isDegraded = state.stale || state.refreshing || state.hasError
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (snapshot != null && isDegraded) {
            DriveStatFreshnessRow(state = state)
        }
        when {
            state.isLoading -> DriveStatSkeletonGrid()
            state.isError -> DriveStatError(onRetry = onRetry)
            state.isEmpty || snapshot == null -> DriveStatEmpty(message = strings.noData)
            else -> DriveStatLoaded(snapshot = snapshot, prefs = prefs, strings = strings)
        }
    }
}

/**
 * A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content, the native
 * expression of the shared [DataFreshness] contract (the web page's poll/`refetch`). Lives above the grid.
 */
@Composable
private fun DriveStatFreshnessRow(state: UiState<DriveStatCardsSnapshot>) {
    val formatAge = rememberDriveStatFreshnessFormatter()
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
 * The content branch: the resolved tiles laid out in the web responsive grid, each mounting through a
 * [StaggerItem] so they animate in sequence (web `<StaggerContainer>`/`<StaggerItem>`). Derives the
 * render-ready tiles once via the pure [DriveStatCardsProjection.tiles].
 */
@Composable
private fun DriveStatLoaded(
    snapshot: DriveStatCardsSnapshot,
    prefs: DriveStatDisplayPrefs,
    strings: DriveStatCardsStrings,
) {
    val tiles = remember(snapshot, prefs, strings) { DriveStatCardsProjection.tiles(snapshot, prefs, strings) }
    DriveStatGrid(itemCount = tiles.size) { index, cellModifier ->
        DriveStatCard(tile = tiles[index], locale = prefs.locale, modifier = cellModifier)
    }
}

/**
 * One stat tile — the native analogue of the web `IconStatCard`, built on the shared [GlassPanel]. Centers a
 * tinted line glyph above the bold value and the small muted label (web `p-4 text-center`). Animated values
 * count up via [AnimatedNumber] and collapse to their final value under reduced motion; the whole tile is one
 * accessibility node reading "label, value" so the count-up never spams TalkBack.
 */
@Composable
private fun DriveStatCard(
    tile: DriveStatTile,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val announce = tile.label + LABEL_VALUE_SEPARATOR + tile.value.text
    GlassPanel(modifier = modifier.clearAndSetSemantics { contentDescription = announce }, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(tile.stat.glyph(), contentDescription = null, size = IconSize.Md, tint = tile.stat.accent())
            DriveStatValueText(value = tile.value, locale = locale)
            Caption(tile.label)
        }
    }
}

/**
 * Renders a tile's value: a plain [MetricValue] for static tiles, and a count-up [AnimatedNumber] for animated
 * ones — except under reduced motion, where the animated tile renders its final value statically so the
 * accessibility/motion contract is honored. The animation locale matches the projection's formatting locale so
 * the count-up's final frame equals the pre-formatted [DriveStatValue.text].
 */
@Composable
private fun DriveStatValueText(
    value: DriveStatValue,
    locale: Locale,
) {
    when (value) {
        is DriveStatValue.Static -> MetricValue(value.text)
        is DriveStatValue.Animated ->
            if (rememberReducedMotion()) {
                MetricValue(value.text)
            } else {
                AnimatedNumber(value = value.value, decimals = value.decimals, suffix = value.suffix, locale = locale)
            }
    }
}

/** The loading branch: eight skeleton tiles in the same responsive grid, announced as "Loading" to TalkBack. */
@Composable
private fun DriveStatSkeletonGrid() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    DriveStatGrid(
        itemCount = SKELETON_TILE_COUNT,
        animate = false,
        modifier = Modifier.clearAndSetSemantics { contentDescription = loadingLabel },
    ) { _, cellModifier ->
        DriveStatSkeletonTile(modifier = cellModifier)
    }
}

/** A single loading tile — a centered icon dot over a value bar and a label bar (the IconStatCard skeleton shape). */
@Composable
private fun DriveStatSkeletonTile(modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Skeleton(widthFraction = SKELETON_ICON_FRACTION, height = SKELETON_ICON_HEIGHT, rounded = true)
            Skeleton(widthFraction = SKELETON_VALUE_FRACTION, height = SKELETON_VALUE_HEIGHT)
            Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
        }
    }
}

/**
 * Empty state — the `common.noData` message with a route glyph, so the grid never collapses to a blank box.
 * [EmptyState] exposes the message as its accessibility label, so the section is still announced to TalkBack
 * when it holds no data.
 */
@Composable
private fun DriveStatEmpty(message: String) {
    EmptyState(message = message, icon = DriveStatGlyphs.Route, modifier = Modifier.fillMaxWidth())
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DriveStatError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Lays out [itemCount] cells as the web responsive grid: eight-per-row at or above [GRID_EXPANDED_MIN]
 * (`lg:grid-cols-8`), four-per-row at or above [GRID_MEDIUM_MIN] (`sm:grid-cols-4`), and two-per-row below it
 * (`grid-cols-2`). When [animate] is true each cell mounts through a [StaggerItem] (web
 * `<StaggerContainer>`/`<StaggerItem>`), keyed by its ordinal; the loading grid passes false. Cells fill their
 * column via [Modifier.weight], a partial trailing row is padded with weighted spacers, and cells are spaced by
 * `Spacing.sm` (the native expression of the web `gap-3`).
 */
@Composable
private fun DriveStatGrid(
    itemCount: Int,
    modifier: Modifier = Modifier,
    animate: Boolean = true,
    item: @Composable (Int, Modifier) -> Unit,
) {
    StaggerContainer(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            val columns =
                when {
                    maxWidth >= GRID_EXPANDED_MIN -> GRID_COLUMNS_EXPANDED
                    maxWidth >= GRID_MEDIUM_MIN -> GRID_COLUMNS_MEDIUM
                    else -> GRID_COLUMNS_COMPACT
                }
            val rows = (0 until itemCount).chunked(columns)
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                for (rowIndices in rows) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        for (index in rowIndices) {
                            if (animate) {
                                StaggerItem(index = index, modifier = Modifier.weight(1f)) {
                                    item(index, Modifier.fillMaxWidth())
                                }
                            } else {
                                item(index, Modifier.weight(1f))
                            }
                        }
                        repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

/**
 * Builds the localized [DriveStatCardsStrings] from the i18n catalog (P1/S10): the `driveDetail.*` labels and
 * `common.noData` the web component reads through `useTranslation`. Resolved once at the Compose boundary so
 * the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberDriveStatCardsStrings(): DriveStatCardsStrings {
    val distance = stringResource(R.string.translation_driveDetail_distance)
    val duration = stringResource(R.string.translation_driveDetail_duration)
    val maxSpeed = stringResource(R.string.translation_driveDetail_maxSpeed)
    val avgSpeed = stringResource(R.string.translation_driveDetail_avgSpeed)
    val soc = stringResource(R.string.translation_driveDetail_soc)
    val maxPower = stringResource(R.string.translation_driveDetail_maxPower)
    val elevGain = stringResource(R.string.translation_driveDetail_elevGain)
    val elevLoss = stringResource(R.string.translation_driveDetail_elevLoss)
    val tripCost = stringResource(R.string.translation_driveDetail_tripCost)
    val costPerUnit = stringResource(R.string.translation_driveDetail_costPerUnit)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(distance, duration, maxSpeed, avgSpeed, soc, maxPower, elevGain, elevLoss, tripCost, costPerUnit, noData) {
        DriveStatCardsStrings(
            distance = distance,
            duration = duration,
            maxSpeed = maxSpeed,
            avgSpeed = avgSpeed,
            soc = soc,
            maxPower = maxPower,
            elevGain = elevGain,
            elevLoss = elevLoss,
            tripCost = tripCost,
            costPerUnitTemplate = costPerUnit,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDriveStatFreshnessFormatter(): (FreshnessAge) -> String {
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
 * The tile accent — the native mirror of the web `IconStatCard` `color` prop. The web neon hexes map onto the
 * theme-invariant chart tokens, which carry the exact same values (`#F59E0B`, `#A855F7`, `#10B981`, `#EF4444`,
 * `#06B6D4`); the `#00F0FF` Distance accent has no chart token and maps onto the theme-aware `status.info`
 * (the brand neon-cyan), so it stays legible in the light theme too.
 */
@Composable
private fun DriveStat.accent(): Color =
    when (this) {
        DriveStat.Distance -> TeslaTokens.status.info
        DriveStat.Duration -> TeslaTokens.chart.energy
        DriveStat.MaxSpeed -> TeslaTokens.chart.power
        DriveStat.AvgSpeed -> TeslaTokens.chart.battery
        DriveStat.Soc -> TeslaTokens.chart.battery
        DriveStat.MaxPower -> TeslaTokens.chart.energy
        DriveStat.ElevGain -> TeslaTokens.chart.battery
        DriveStat.ElevLoss -> TeslaTokens.chart.temperature
        DriveStat.TripCost -> TeslaTokens.chart.battery
        DriveStat.CostPerUnit -> TeslaTokens.chart.regen
    }

/** Resolves a tile's line glyph — the native analogue of the web lucide icon, reusing the shared set where it carries one. */
private fun DriveStat.glyph(): ImageVector =
    when (this) {
        DriveStat.Distance -> DriveStatGlyphs.Route
        DriveStat.Duration -> DataDisplayGlyphs.Clock
        DriveStat.MaxSpeed -> DataDisplayGlyphs.Gauge
        DriveStat.AvgSpeed -> DriveStatGlyphs.TrendingUp
        DriveStat.Soc -> DataDisplayGlyphs.Battery
        DriveStat.MaxPower -> DataDisplayGlyphs.Bolt
        DriveStat.ElevGain -> DriveStatGlyphs.Navigation
        DriveStat.ElevLoss -> DriveStatGlyphs.Navigation
        DriveStat.TripCost -> DriveStatGlyphs.DollarSign
        DriveStat.CostPerUnit -> DataDisplayGlyphs.TrendingDown
    }

/**
 * The lucide glyphs this surface needs that the shared [DataDisplayGlyphs] set does not carry. The web uses
 * lucide `Route`, `TrendingUp`, `Navigation` and `DollarSign`; Android ships no equivalents without the frozen
 * `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their lucide ports — they are
 * authored here as 24×24 stroked vectors faithful to the lucide paths.
 */
private object DriveStatGlyphs {
    /** lucide `route` — two waypoint nodes joined by a stepped connector (Distance tile + empty-state glyph). */
    val Route: ImageVector =
        stroked("Route") {
            circle(6f, 19f, 3f)
            circle(18f, 5f, 3f)
            moveTo(9f, 19f)
            lineTo(16f, 19f)
            lineTo(16f, 12f)
            lineTo(8f, 12f)
            lineTo(8f, 5f)
            lineTo(15f, 5f)
        }

    /** lucide `trending-up` — an up-right polyline with an arrowhead (Avg Speed tile). */
    val TrendingUp: ImageVector =
        stroked("TrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** lucide `navigation` — a tilted paper-plane pointer (Elev. Gain + Elev. Loss tiles). */
    val Navigation: ImageVector =
        stroked("Navigation") {
            moveTo(3f, 11f)
            lineTo(22f, 2f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }

    /** lucide `dollar-sign` — a vertical bar through an S-curve (Trip Cost tile). */
    val DollarSign: ImageVector =
        stroked("DollarSign") {
            moveTo(12f, 1f)
            lineTo(12f, 23f)
            moveTo(17f, 5f)
            lineTo(9.5f, 5f)
            curveTo(7.57f, 5f, 6f, 6.57f, 6f, 8.5f)
            curveTo(6f, 10.43f, 7.57f, 12f, 9.5f, 12f)
            lineTo(14.5f, 12f)
            curveTo(16.43f, 12f, 18f, 13.57f, 18f, 15.5f)
            curveTo(18f, 17.43f, 16.43f, 19f, 14.5f, 19f)
            lineTo(6f, 19f)
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

/** Cubic-bezier circle of radius [r] about ([cx], [cy]) — used to author the lucide `route` waypoint nodes. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    val k = r * CIRCLE_KAPPA
    moveTo(cx + r, cy)
    curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    close()
}

/** Bezier circle control-point ratio (4/3 · tan(π/8)) for the authored `route` nodes. */
private const val CIRCLE_KAPPA = 0.5523f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    DriveStatCardsStrings(
        distance = "Distance",
        duration = "Duration",
        maxSpeed = "Max Speed",
        avgSpeed = "Avg Speed",
        soc = "SOC",
        maxPower = "Max Power",
        elevGain = "Elev. Gain",
        elevLoss = "Elev. Loss",
        tripCost = "Trip Cost",
        costPerUnitTemplate = "Cost / %1\$s",
        noData = "No data available",
    )

private val PREVIEW_SNAPSHOT =
    DriveStatCardsSnapshot(
        distanceM = 42_300.0,
        durationS = 3_660.0,
        maxSpeedMps = 33.5,
        avgSpeedMps = 18.2,
        startBatteryPct = 82.0,
        endBatteryPct = 57.0,
        powerMaxKw = 211.0,
        elevGainM = 248.0,
        elevLossM = 173.0,
        energyWh = 9_400.0,
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun DriveStatCardsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveStatCardsContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            prefs = DriveStatDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun DriveStatCardsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveStatCardsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = DriveStatDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DriveStatCardsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveStatCardsContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = DriveStatDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DriveStatCardsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveStatCardsContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = DriveStatDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun DriveStatCardsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveStatCardsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = DriveStatDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}
