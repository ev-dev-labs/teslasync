// The native Jetpack Compose + Material 3 CostSummaryCards feature view — a parity port of
// web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx. The web component renders a
// `<StaggerContainer>` around a responsive `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6` grid of six StatBox
// tiles (Total Cost, Avg $/kWh, Cost Per {Mile|km}, Total Energy, Gas Savings $, Savings %), each StatBox a
// `<GlassPanel>` with a tinted icon box, a muted label, a bold value, and an optional muted subtitle.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog P1/S10; `useFormatting` + `useSettings`, mapped to
// the live S8 SettingsStore for the currency symbol, precision, locale and gas-unit label). The owning
// CostAnalysisPage computes the stats and threads them in through the shared state-holder layer as a
// [UiState], so this feature view renders every lifecycle state that layer can carry — a loading skeleton
// grid, a hard error with retry, a friendly empty state (the web `!sessions` branch with its dollar glyph),
// content, and stale/offline cached "last known" with a freshness chip + auto-refresh — without ever
// fetching, exactly like the sibling SummaryHeroCards port. The content branch reproduces the web StatBox
// grid verbatim (the `<StaggerContainer>`/`<StaggerItem>` entrance included). A web-parity overload taking
// the raw `coreStats` + `gasPrice` + `distanceUnit` + `isMiles` props is provided for hosts that already hold
// them.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CostSummaryCards) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting
// declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costsummarycards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
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
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelAccent
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

/** Web Tailwind `xl` breakpoint (1280px): at or above this width the tiles lay out six-per-row. */
private val GRID_XL_MIN_WIDTH: Dp = 1280.dp

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the tiles lay out three-per-row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web base `grid-cols-2`: below the `lg` breakpoint the tiles lay out two-per-row. */
private const val GRID_COLUMNS_XL = 6
private const val GRID_COLUMNS_LG = 3
private const val GRID_COLUMNS_BASE = 2

/** Loading tiles shown while the host's feed first loads — the full six-tile grid as skeletons. */
private const val SKELETON_TILE_COUNT = 6

/** Web StatBox MetricSkeleton shape: a label bar over a larger value bar. */
private const val SKELETON_LABEL_FRACTION = 0.6f
private const val SKELETON_VALUE_FRACTION = 0.45f
private val SKELETON_LABEL_HEIGHT: Dp = 12.dp
private val SKELETON_VALUE_HEIGHT: Dp = 22.dp

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/**
 * Stateful entry point for the cost-summary tiles. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live currency/precision/locale/gas-unit preferences from the shared S8 SettingsStore
 * (the native binding of the web `useFormatting`/`useSettings` hooks; "$"/2dp/en-US/"gal" defaults apply until
 * settings load), and renders every lifecycle [state] the shared cost-summary feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [CostSummarySnapshot].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing currency + locale + gas unit; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CostSummaryCards(
    state: UiState<CostSummarySnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CostSummaryCardsDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { CostSummaryDisplayPrefs.from(settingsResource.cached) }
    CostSummaryCardsContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ coreStats, gasPrice, distanceUnit, isMiles })` props,
 * for hosts that already hold the computed stats. A `null` [coreStats] is the web `!coreStats` case — it
 * projects onto the empty [UiState] (the web page's no-charging-data branch). There is no fetch behind it, so
 * it offers no retry affordance.
 */
@Composable
fun CostSummaryCards(
    coreStats: CostSummaryStats?,
    gasPrice: Double,
    distanceUnit: String,
    isMiles: Boolean,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(coreStats, gasPrice, distanceUnit, isMiles) {
            val snapshot = coreStats?.let { CostSummarySnapshot(it, gasPrice, distanceUnit, isMiles) }
            CostSummaryCardsProjection.projectUiState(snapshot, isLoading = false)
        }
    CostSummaryCards(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. A freshness chip is
 * shown above the grid when content is stale/refreshing/offline, and stale (non-error) data auto-refreshes —
 * mirroring the shared cache-then-network freshness contract. Inside it switches between a loading skeleton
 * grid, a hard-error retry surface, a friendly empty state (so the surface never blanks), and the resolved
 * StatBox grid.
 */
@Composable
fun CostSummaryCardsContent(
    state: UiState<CostSummarySnapshot>,
    onRetry: () -> Unit,
    prefs: CostSummaryDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: CostSummaryStrings = rememberCostSummaryStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val isDegraded = state.stale || state.refreshing || state.hasError
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (snapshot != null && isDegraded) {
            CostSummaryFreshnessRow(state = state)
        }
        when {
            state.isLoading -> CostSummarySkeletonGrid()
            state.isError -> CostSummaryError(onRetry = onRetry)
            state.isEmpty || snapshot == null -> CostSummaryEmpty()
            else -> CostSummaryLoaded(snapshot = snapshot, prefs = prefs, strings = strings)
        }
    }
}

/**
 * A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content, the native
 * expression of the shared [DataFreshness] contract (the web page's poll/`refetch`). Lives above the grid,
 * not next to a value.
 */
@Composable
private fun CostSummaryFreshnessRow(state: UiState<CostSummarySnapshot>) {
    val formatAge = rememberCostSummaryFreshnessFormatter()
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
 * The content branch: the six StatBox tiles laid out in the web responsive grid, each mounting through a
 * [StaggerItem] so they animate in sequence (web `<StaggerContainer>`/`<StaggerItem>`). Derives the
 * render-ready cards once via the pure [CostSummaryCardsProjection.cards].
 */
@Composable
private fun CostSummaryLoaded(
    snapshot: CostSummarySnapshot,
    prefs: CostSummaryDisplayPrefs,
    strings: CostSummaryStrings,
) {
    val cards = remember(snapshot, prefs, strings) { CostSummaryCardsProjection.cards(snapshot, prefs, strings) }
    StaggerContainerGrid(itemCount = cards.size) { index, cellModifier ->
        StatBox(card = cards[index], modifier = cellModifier)
    }
}

/**
 * One StatBox tile — the native analogue of the web `StatBox`, built on the shared [GlassPanel]. Shows a
 * tinted icon box, the muted label, the bold value, and the optional muted subtitle. The web `glow` maps onto
 * the panel accent and the web icon color onto the glyph tint. The tile merges its text into one semantics
 * node so TalkBack reads "label, value, subtitle" as a single unit; the icon is decorative.
 */
@Composable
private fun StatBox(
    card: CostSummaryCard,
    modifier: Modifier = Modifier,
) {
    GlassPanel(
        modifier = modifier.semantics(mergeDescendants = true) {},
        padding = PanelPadding.Md,
        accent = card.glow.toPanelAccent(),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
            IconBox(tone = IconBoxTone.Neutral, size = IconBoxSize.Md) {
                Icon(card.icon.glyph(), contentDescription = null, size = IconSize.Lg, tint = card.iconTone.toColor())
            }
            Column(modifier = Modifier.weight(1f)) {
                Caption(card.label)
                MetricValue(card.value, modifier = Modifier.padding(top = Spacing.xs))
                card.sub?.let { HelperText(it, modifier = Modifier.padding(top = Spacing.xs)) }
            }
        }
    }
}

/** The loading branch: six skeleton tiles in the same responsive grid, announced as "Loading" to TalkBack. */
@Composable
private fun CostSummarySkeletonGrid() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    StaggerContainerGrid(
        itemCount = SKELETON_TILE_COUNT,
        animate = false,
        modifier = Modifier.semantics { contentDescription = loadingLabel },
    ) { _, cellModifier ->
        CostSummarySkeletonTile(modifier = cellModifier)
    }
}

/** A single loading tile — a panel with a label bar over a larger value bar (web StatBox skeleton shape). */
@Composable
private fun CostSummarySkeletonTile(modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
        Skeleton(
            modifier = Modifier.padding(top = Spacing.sm),
            widthFraction = SKELETON_VALUE_FRACTION,
            height = SKELETON_VALUE_HEIGHT,
        )
    }
}

/**
 * Empty state — the web page's no-charging-data message with a dollar glyph, so the surface never collapses
 * to a blank box. [EmptyState] exposes the title/message as its accessibility label, so the section is still
 * announced to TalkBack when it holds no data.
 */
@Composable
private fun CostSummaryEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noCharges),
        icon = CostSummaryGlyphs.DollarSign,
        title = stringResource(R.string.translation_costAnalysis_empty_title),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun CostSummaryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Lays out [itemCount] cells as the web responsive grid: six-per-row at or above [GRID_XL_MIN_WIDTH]
 * (`xl:grid-cols-6`), three-per-row at or above [GRID_LG_MIN_WIDTH] (`lg:grid-cols-3`), and two-per-row below
 * it (`grid-cols-2`). When [animate] is true each cell mounts through a [StaggerItem] (web
 * `<StaggerContainer>`/`<StaggerItem>`), keyed by its ordinal so the sequence is deterministic; the loading
 * grid passes false. Cells fill their column via [Modifier.weight], a partial trailing row is padded with
 * weighted spacers, and cells are spaced by `Spacing.md` (the native expression of the web `gap-4`).
 */
@Composable
private fun StaggerContainerGrid(
    itemCount: Int,
    modifier: Modifier = Modifier,
    animate: Boolean = true,
    item: @Composable (Int, Modifier) -> Unit,
) {
    StaggerContainer(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            val columns =
                when {
                    maxWidth >= GRID_XL_MIN_WIDTH -> GRID_COLUMNS_XL
                    maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                    else -> GRID_COLUMNS_BASE
                }
            val rows = (0 until itemCount).chunked(columns)
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                for (rowIndices in rows) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
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

/** Resolves the localized tile labels from the i18n catalog (P1/S10) — no English literal in the view. */
@Composable
private fun rememberCostSummaryStrings(): CostSummaryStrings {
    val totalCost = stringResource(R.string.translation_costAnalysis_stats_totalCost)
    val sessions = stringResource(R.string.translation_costAnalysis_stats_sessions)
    val avgPerKwh = stringResource(R.string.translation_costAnalysis_stats_avgPerKwh)
    val blendedRate = stringResource(R.string.translation_costAnalysis_stats_blendedRate)
    val costPerDist = stringResource(R.string.translation_costAnalysis_stats_costPerDist)
    val totalEnergy = stringResource(R.string.translation_costAnalysis_stats_totalEnergy)
    val gasSavings = stringResource(R.string.translation_costAnalysis_stats_gasSavings)
    val savingsPercent = stringResource(R.string.translation_costAnalysis_stats_savingsPercent)
    val vsGasoline = stringResource(R.string.translation_costAnalysis_stats_vsGasoline)
    return remember(totalCost, sessions, avgPerKwh, blendedRate, costPerDist, totalEnergy, gasSavings, savingsPercent, vsGasoline) {
        CostSummaryStrings(
            totalCost = totalCost,
            sessions = sessions,
            avgPerKwh = avgPerKwh,
            blendedRate = blendedRate,
            costPerDistTemplate = costPerDist,
            totalEnergy = totalEnergy,
            gasSavings = gasSavings,
            savingsPercent = savingsPercent,
            vsGasoline = vsGasoline,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberCostSummaryFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Maps a [CostStatGlow] to a design-token panel accent (P1/S9). */
private fun CostStatGlow.toPanelAccent(): PanelAccent =
    when (this) {
        // 'cyan' is the info token (#00F0FF) and 'green' is the success token — exact web matches.
        CostStatGlow.Cyan -> PanelAccent.Info
        CostStatGlow.Green -> PanelAccent.Success
        CostStatGlow.None -> PanelAccent.None
    }

/** Maps a [CostStatIconTone] (web `text-{color}-400`) onto the nearest semantic design token (P1/S9). */
@Composable
private fun CostStatIconTone.toColor(): Color =
    when (this) {
        // cyan is the info token; the design system has no separate yellow/blue/emerald, so each web accent
        // maps onto its nearest semantic token (warning/primary/success/danger), staying theme-safe.
        CostStatIconTone.Cyan -> TeslaTokens.status.info
        CostStatIconTone.Yellow -> TeslaTokens.status.warning
        CostStatIconTone.Blue -> MaterialTheme.colorScheme.primary
        CostStatIconTone.Green -> TeslaTokens.status.success
        CostStatIconTone.Red -> TeslaTokens.status.danger
        CostStatIconTone.Emerald -> TeslaTokens.status.success
    }

/** Resolves a tile's glyph — reusing the shared [DataDisplayGlyphs] where it carries the lucide equivalent. */
private fun CostStatIcon.glyph(): ImageVector =
    when (this) {
        CostStatIcon.Dollar -> CostSummaryGlyphs.DollarSign
        // web lucide `Zap`; the shared set already carries the bolt glyph.
        CostStatIcon.Zap -> DataDisplayGlyphs.Bolt
        CostStatIcon.Car -> CostSummaryGlyphs.Car
        CostStatIcon.Fuel -> CostSummaryGlyphs.Fuel
        CostStatIcon.TrendingDown -> DataDisplayGlyphs.TrendingDown
    }

/**
 * The lucide glyphs this surface needs that the shared [DataDisplayGlyphs] set does not carry. The web uses
 * lucide `DollarSign`, `Car` and `Fuel`; Android ships no equivalents without the frozen
 * `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their lucide ports — they
 * are authored here as 24×24 stroked vectors faithful to the lucide paths.
 */
private object CostSummaryGlyphs {
    /** lucide `dollar-sign` — a vertical bar through an S-curve (Total Cost / empty-state tile). */
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

    /** lucide `car` — a cabin, body, and two wheels (Cost Per distance tile). */
    val Car: ImageVector =
        stroked("Car") {
            moveTo(5f, 11f)
            lineTo(6.5f, 6.5f)
            curveTo(6.8f, 5.6f, 7.6f, 5f, 8.5f, 5f)
            lineTo(15.5f, 5f)
            curveTo(16.4f, 5f, 17.2f, 5.6f, 17.5f, 6.5f)
            lineTo(19f, 11f)
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            curveTo(20.1f, 11f, 21f, 11.9f, 21f, 13f)
            lineTo(21f, 17f)
            lineTo(3f, 17f)
            lineTo(3f, 13f)
            curveTo(3f, 11.9f, 3.9f, 11f, 5f, 11f)
            close()
            moveTo(7f, 17f)
            lineTo(7f, 19f)
            moveTo(17f, 17f)
            lineTo(17f, 19f)
        }

    /** lucide `fuel` — a fuel-pump tank with a nozzle arm (Gas Savings tile). */
    val Fuel: ImageVector =
        stroked("Fuel") {
            moveTo(4f, 21f)
            lineTo(4f, 5f)
            curveTo(4f, 3.9f, 4.9f, 3f, 6f, 3f)
            lineTo(11f, 3f)
            curveTo(12.1f, 3f, 13f, 3.9f, 13f, 5f)
            lineTo(13f, 21f)
            close()
            moveTo(3f, 21f)
            lineTo(14f, 21f)
            moveTo(5f, 10f)
            lineTo(12f, 10f)
            moveTo(13f, 7f)
            lineTo(16f, 7f)
            curveTo(17.1f, 7f, 18f, 7.9f, 18f, 9f)
            lineTo(18f, 16f)
            curveTo(18f, 17.1f, 18.9f, 18f, 20f, 18f)
            curveTo(21.1f, 18f, 22f, 17.1f, 22f, 16f)
            lineTo(22f, 11f)
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

private val previewStats =
    CostSummaryStats(
        totalCost = 248.37,
        count = 42,
        avgCostPerKwh = 0.142,
        costPerDist = 0.061,
        totalEnergy = 1748.6,
        gallonsEquiv = 52.4,
        savings = 186.12,
        savingsPercent = 42.8,
    )

private val previewSnapshot = CostSummarySnapshot(stats = previewStats, gasPrice = 3.59, distanceUnit = "mi", isMiles = true)

private fun previewContent(): UiState<CostSummarySnapshot> = UiState(phase = UiPhase.Content, data = previewSnapshot)

@Preview(name = "Loading", showBackground = true)
@Composable
private fun CostSummaryCardsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSummaryCardsContent(state = UiState.loading(), onRetry = {}, prefs = CostSummaryDisplayPrefs.DEFAULT)
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun CostSummaryCardsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSummaryCardsContent(state = previewContent(), onRetry = {}, prefs = CostSummaryDisplayPrefs.DEFAULT)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun CostSummaryCardsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSummaryCardsContent(state = UiState(phase = UiPhase.Empty), onRetry = {}, prefs = CostSummaryDisplayPrefs.DEFAULT)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun CostSummaryCardsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSummaryCardsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = CostSummaryDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Offline — stale last known", showBackground = true)
@Composable
private fun CostSummaryCardsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CostSummaryCardsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = CostSummaryDisplayPrefs.DEFAULT,
        )
    }
}
