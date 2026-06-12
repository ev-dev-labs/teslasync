// The native Jetpack Compose + Material 3 CostSavingsPanel feature view — a parity port of
// web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx. The web component wraps an outer
// `<GlassPanel>` in `<FadeIn>`: a DollarSign-iconed "Cost & Savings" header over a responsive
// `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` of up to five centered cost tiles — Trip Cost (always), Cost /
// {mi|km} (when the drive has distance), and — only when the gasoline comparison yields a positive saving —
// Gas Cost (equiv), vs Gas Savings and Savings %.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog P1/S10; `useSettings` / `useFormatting` / `useUnits`,
// mapped to the live S8 SettingsStore for the currency symbol, precision, locale, cost-per-kWh rate, gas
// economy / price / unit and distance preference). The owning DriveDetail page owns the drive query and
// threads the computed drive + stats in through the shared state-holder layer as a [UiState], so this feature
// view renders every lifecycle state that layer can carry — a loading skeleton, a hard error with retry, a
// friendly empty state (no drive resolved), content, and stale/offline cached "last known" with a freshness
// chip + auto-refresh — without ever fetching, exactly like the sibling CostSummaryCards port. The outer
// GlassPanel + header are always rendered (the web panel chrome is unconditional); only the body switches per
// state, so the surface never collapses to a blank box. A web-parity overload taking the raw `drive` + `stats`
// props is provided for hosts that already hold them.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CostSavingsPanel) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting
// declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costsavingspanel

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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
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
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the tiles lay out five-per-row (`lg:grid-cols-5`). */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the tiles lay out three-per-row (`sm:grid-cols-3`). */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Web base `grid-cols-2`: below the `sm` breakpoint the tiles lay out two-per-row. */
private const val GRID_COLUMNS_LG = 5
private const val GRID_COLUMNS_SM = 3
private const val GRID_COLUMNS_BASE = 2

/** Skeleton tiles shown while the host's drive query first loads — the `sm` column count of loading cells. */
private const val SKELETON_TILE_COUNT = 3

/** Web tile skeleton shape: a label bar over a larger value bar. */
private const val SKELETON_LABEL_FRACTION = 0.7f
private const val SKELETON_VALUE_FRACTION = 0.5f
private val SKELETON_LABEL_HEIGHT: Dp = 10.dp
private val SKELETON_VALUE_HEIGHT: Dp = 20.dp
private val SKELETON_TILE_HEIGHT: Dp = 64.dp

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/**
 * Stateful entry point for the cost-savings panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live currency/precision/locale/rate/gas/distance preferences from the shared S8
 * SettingsStore (the native binding of the web `useSettings`/`useFormatting`/`useUnits` hooks; "$"/2dp/en-US/
 * 0.12-per-kWh/25-MPG/$0-gas/gallon/km defaults apply until settings load), and renders every lifecycle
 * [state] the shared drive feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's
 * `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [CostSavingsSnapshot] (the drive + its stats).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing currency + rate + gas + distance; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CostSavingsPanel(
    state: UiState<CostSavingsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CostSavingsPanelDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { CostSavingsDisplayPrefs.from(settingsResource.cached) }
    CostSavingsPanelContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ drive, stats })` props, for hosts that already hold the
 * resolved drive. Projects the props onto a content [UiState]; there is no fetch behind it, so it offers no
 * retry affordance.
 */
@Composable
fun CostSavingsPanel(
    drive: DriveCostInputs,
    stats: DriveCostStats,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(drive, stats) {
            CostSavingsPanelProjection.projectUiState(CostSavingsSnapshot(drive, stats), isLoading = false)
        }
    CostSavingsPanel(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. The outer FadeIn +
 * GlassPanel + DollarSign header are always rendered (the web panel chrome is unconditional); only the body
 * switches. A freshness chip is shown in the header when content is stale/refreshing/offline, and stale
 * (non-error) data auto-refreshes — mirroring the shared cache-then-network freshness contract. Inside it
 * switches between a loading skeleton grid, a hard-error retry surface, a friendly empty state (so the panel
 * never blanks), and the resolved cost-tile grid.
 */
@Composable
fun CostSavingsPanelContent(
    state: UiState<CostSavingsSnapshot>,
    onRetry: () -> Unit,
    prefs: CostSavingsDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: CostSavingsStrings = rememberCostSavingsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val showFreshness = state.isContent && (state.stale || state.refreshing || state.hasError)
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            CostSavingsHeader(title = strings.title, state = state, showFreshness = showFreshness)
            Spacer(modifier = Modifier.height(Spacing.md))
            when {
                state.isLoading -> CostSavingsSkeletonGrid()
                state.isError -> CostSavingsError(onRetry = onRetry)
                state.isEmpty || snapshot == null -> CostSavingsEmpty()
                else -> CostSavingsLoaded(snapshot = snapshot, prefs = prefs, strings = strings)
            }
        }
    }
}

/**
 * The panel header — the web `<h3>` with its green DollarSign icon and the "Cost & Savings" title. When the
 * content is degraded a right-aligned freshness chip (the native [DataFreshness] contract) reports
 * refreshing/stale/offline over the still-shown cached tiles, kept in the header rather than next to a value.
 */
@Composable
private fun CostSavingsHeader(
    title: String,
    state: UiState<CostSavingsSnapshot>,
    showFreshness: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                CostSavingsGlyphs.DollarSign,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            SectionTitle(title)
        }
        if (showFreshness) {
            CostSavingsFreshness(state = state)
        }
    }
}

/** The freshness chip reflecting refreshing/stale/offline over still-shown content (web page poll/`refetch`). */
@Composable
private fun CostSavingsFreshness(state: UiState<CostSavingsSnapshot>) {
    val formatAge = rememberCostSavingsFreshnessFormatter()
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

/**
 * The resolved content branch — derives the render-ready tiles once via the pure
 * [CostSavingsPanelProjection.tiles] and lays them out in the web responsive grid. Each tile renders through
 * [CostSavingsTileCell] with its localized label, formatted value, optional subline, and semantic accent.
 */
@Composable
private fun CostSavingsLoaded(
    snapshot: CostSavingsSnapshot,
    prefs: CostSavingsDisplayPrefs,
    strings: CostSavingsStrings,
) {
    val tiles = remember(snapshot, prefs, strings) { CostSavingsPanelProjection.tiles(snapshot, prefs, strings) }
    CostSavingsGrid(itemCount = tiles.size) { index, cellModifier ->
        CostSavingsTileCell(tile = tiles[index], modifier = cellModifier)
    }
}

/**
 * A single centered cost tile — the native analogue of a web `<div>` cost cell: a muted label, the bold
 * accent-colored value, and an optional muted subline. The tile merges its descendants under one accessible
 * label so TalkBack reads "label: value[, detail]" as a unit.
 */
@Composable
private fun CostSavingsTileCell(
    tile: CostSavingsTile,
    modifier: Modifier = Modifier,
) {
    val description = CostSavingsPanelProjection.accessibilityLabel(label = tile.label, value = tile.value, detail = tile.sub)
    Column(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(tile.label)
        Text(
            text = tile.value,
            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            color = tile.tone.toColor(),
            textAlign = TextAlign.Center,
        )
        if (tile.sub != null) {
            HelperText(tile.sub)
        }
    }
}

/** The loading branch — skeleton tiles in the same responsive grid, announced as "Loading" to TalkBack. */
@Composable
private fun CostSavingsSkeletonGrid() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    CostSavingsGrid(
        itemCount = SKELETON_TILE_COUNT,
        modifier = Modifier.semantics { contentDescription = loadingLabel },
    ) { _, cellModifier ->
        CostSavingsSkeletonTile(modifier = cellModifier)
    }
}

/** A single loading tile — a centered label bar over a larger value bar (web tile skeleton shape). */
@Composable
private fun CostSavingsSkeletonTile(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.height(SKELETON_TILE_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
        Skeleton(widthFraction = SKELETON_VALUE_FRACTION, height = SKELETON_VALUE_HEIGHT)
    }
}

/**
 * Empty state — rendered inside the panel chrome (the header title stays visible above it) so the surface
 * never collapses to a blank box when no drive has resolved. [EmptyState] exposes its message as the
 * accessibility label, so the section is still announced to TalkBack when it holds no data.
 */
@Composable
private fun CostSavingsEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = CostSavingsGlyphs.DollarSign,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent, inside the panel chrome. */
@Composable
private fun CostSavingsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Lays out [itemCount] cells as the web responsive grid: five-per-row at or above [GRID_LG_MIN_WIDTH]
 * (`lg:grid-cols-5`), three-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:grid-cols-3`), and two-per-row below
 * it (`grid-cols-2`). Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so cells keep a uniform width. Cells are spaced by `Spacing.md`, the native expression of
 * the web `gap-4`.
 */
@Composable
private fun CostSavingsGrid(
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
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            val rows = (0 until itemCount).chunked(columns)
            for (rowIndices in rows) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    for (index in rowIndices) {
                        item(index, Modifier.weight(1f))
                    }
                    repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Resolves the localized labels from the i18n catalog (P1/S10) — no English literal in the view. */
@Composable
private fun rememberCostSavingsStrings(): CostSavingsStrings {
    val title = stringResource(R.string.translation_driveDetail_costSavings)
    val tripCost = stringResource(R.string.translation_driveDetail_tripCost)
    val atRate = stringResource(R.string.translation_driveDetail_atRate)
    val costPerUnit = stringResource(R.string.translation_driveDetail_costPerUnit)
    val gasCostEquiv = stringResource(R.string.translation_driveDetail_gasCostEquiv)
    val atMpg = stringResource(R.string.translation_driveDetail_atMpg)
    val gasSavings = stringResource(R.string.translation_driveDetail_gasSavings)
    val savingsPct = stringResource(R.string.translation_driveDetail_savingsPct)
    return remember(title, tripCost, atRate, costPerUnit, gasCostEquiv, atMpg, gasSavings, savingsPct) {
        CostSavingsStrings(
            title = title,
            tripCost = tripCost,
            atRateTemplate = atRate,
            costPerUnitTemplate = costPerUnit,
            gasCostEquiv = gasCostEquiv,
            atMpgTemplate = atMpg,
            gasSavings = gasSavings,
            savingsPct = savingsPct,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberCostSavingsFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Maps a [CostTileTone] (web `text-{color}-400`) onto its semantic design token (P1/S9), theme-safe. */
@Composable
private fun CostTileTone.toColor(): Color =
    when (this) {
        // green/emerald are the success token; cyan is the info token; red is the danger token — exact web matches.
        CostTileTone.Success -> TeslaTokens.status.success
        CostTileTone.Info -> TeslaTokens.status.info
        CostTileTone.Danger -> TeslaTokens.status.danger
    }

/**
 * The one lucide glyph this surface needs that the shared sets do not carry. The web uses lucide `DollarSign`;
 * Android ships no equivalent without the frozen `material-icons-extended` artifact, so — exactly as the
 * sibling surfaces do for their lucide ports — it is authored here as a 24×24 stroked vector faithful to the
 * lucide path.
 */
private object CostSavingsGlyphs {
    /** lucide `dollar-sign` — a vertical bar through an S-curve (the "Cost & Savings" header icon). */
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val SAMPLE_PREFS =
    CostSavingsDisplayPrefs(
        currencySymbol = "$",
        precision = 2,
        locale = Locale.US,
        costPerKwh = 0.12,
        gasEfficiencyMpg = 25.0,
        gasPricePerUnit = 4.0,
        gasUnitIsLiter = false,
        distancePref = DistanceUnitPref.MI,
    )

private val SAMPLE_STRINGS =
    CostSavingsStrings(
        title = "Cost & Savings",
        tripCost = "Trip Cost",
        atRateTemplate = "at %1\$s%2\$s/kWh",
        costPerUnitTemplate = "Cost / %1\$s",
        gasCostEquiv = "Gas Cost (equiv)",
        atMpgTemplate = "at %1\$s MPG",
        gasSavings = "vs Gas Savings",
        savingsPct = "Savings %",
    )

private val SAMPLE_SNAPSHOT =
    CostSavingsSnapshot(
        drive = DriveCostInputs(distanceM = 32_186.88),
        stats = DriveCostStats(energyWh = 6_000.0),
    )

@Preview(name = "Content — all five tiles", showBackground = true, widthDp = 420)
@Composable
private fun CostSavingsPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSavingsPanelContent(
            state = UiState(phase = UiPhase.Content, data = SAMPLE_SNAPSHOT),
            onRetry = {},
            prefs = SAMPLE_PREFS,
            strings = SAMPLE_STRINGS,
        )
    }
}

@Preview(name = "Content — trip cost only (no gas price)", showBackground = true, widthDp = 420)
@Composable
private fun CostSavingsPanelTripOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSavingsPanelContent(
            state = UiState(phase = UiPhase.Content, data = SAMPLE_SNAPSHOT),
            onRetry = {},
            prefs = SAMPLE_PREFS.copy(gasPricePerUnit = 0.0),
            strings = SAMPLE_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun CostSavingsPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSavingsPanelContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = SAMPLE_PREFS,
            strings = SAMPLE_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 420)
@Composable
private fun CostSavingsPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSavingsPanelContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = SAMPLE_PREFS,
            strings = SAMPLE_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 420)
@Composable
private fun CostSavingsPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSavingsPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = SAMPLE_PREFS,
            strings = SAMPLE_STRINGS,
        )
    }
}

@Preview(name = "Offline — stale last known", showBackground = true, widthDp = 420)
@Composable
private fun CostSavingsPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSavingsPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = SAMPLE_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = SAMPLE_PREFS,
            strings = SAMPLE_STRINGS,
        )
    }
}
