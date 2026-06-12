// The native Jetpack Compose + Material 3 SummaryHeroCards feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx. The web component wraps a
// `<GlassPanel>` (titled "Week Summary") around a responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
// grid of HighlightCards: five always-present metric cards (Total Distance, Total Drives, Energy Used,
// Charging Cost, CO2 Saved) and a sixth optional Fun Fact card, the whole panel mounting through `<FadeIn>`.
// Each card shows an icon + label, a number-with-unit value, an optional week-over-week trend badge (a green
// up-arrow / red down-arrow with a signed percentage), and a glow color.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog P1/S10, and `useFormatting`, mapped to the live S8
// SettingsStore). The owning Weekly Digest page threads the week summary in through the shared state-holder
// layer as a [UiState], so this feature view renders every lifecycle state that layer can carry — a loading
// skeleton grid, a hard error with retry, a friendly empty state, content, and stale/offline cached "last
// known" — without ever fetching, exactly like the sibling DrivingPerformanceCards port. The panel chrome
// (the FadeIn + GlassPanel + "Week Summary" title) is always present so the surface never collapses to a
// blank box, and the content branch reproduces the web HighlightCard grid verbatim, including the optional
// Fun Fact card and the `trendFor` badges. A web-parity overload taking the raw `metrics` + `funFact` props
// is provided for hosts that already hold them.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SummaryHeroCards) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.summaryherocards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelAccent
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

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the cards lay out three-per-row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cards lay out two-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG = 3
private const val GRID_COLUMNS_SM = 2
private const val GRID_COLUMNS_BASE = 1

/** Loading tiles shown while the host's feed first loads — the full six-card grid as skeletons. */
private const val SKELETON_TILE_COUNT = 6

/** Web MetricSkeleton: a label bar (60% wide, 12dp) over a larger value bar (45% wide, 24dp). */
private const val SKELETON_LABEL_FRACTION = 0.6f
private const val SKELETON_VALUE_FRACTION = 0.45f
private val SKELETON_LABEL_HEIGHT: Dp = 12.dp
private val SKELETON_VALUE_HEIGHT: Dp = 24.dp

/**
 * Stateful entry point for the week-summary panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live currency/precision/locale preferences from the shared S8 SettingsStore (the native
 * binding of the web `useFormatting`/`useUnits` hooks; "$"/2dp/en-US defaults apply until settings load), and
 * renders every lifecycle [state] the shared week-summary feed can carry. The host owns the feed (P1/S8) and
 * supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [WeekSummarySnapshot].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing currency + locale; defaults to the app's S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SummaryHeroCards(
    state: UiState<WeekSummarySnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SummaryHeroCardsDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { SummaryHeroDisplayPrefs.from(settingsResource.cached) }
    SummaryHeroCardsContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ metrics, funFact })` props, for hosts that already
 * hold the week summary. Wraps them in a [WeekSummarySnapshot], projects it onto a content [UiState] via
 * [SummaryHeroCardsProjection.projectUiState], and delegates to the stateful entry (which records
 * `view.opened`). There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SummaryHeroCards(
    metrics: WeekSummaryMetrics,
    funFact: FunFactSummary?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(metrics, funFact) {
            SummaryHeroCardsProjection.projectUiState(WeekSummarySnapshot(metrics, funFact), isLoading = false)
        }
    SummaryHeroCards(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. The FadeIn + GlassPanel
 * + "Week Summary" title chrome is always present (the surface never blanks); inside it switches between a
 * loading skeleton grid, a hard-error retry surface, a friendly empty state, and the resolved HighlightCard
 * grid. When content is stale/refreshing/offline a freshness chip is shown in the panel header, and stale
 * (non-error) data auto-refreshes — mirroring the shared cache-then-network freshness contract.
 */
@Composable
fun SummaryHeroCardsContent(
    state: UiState<WeekSummarySnapshot>,
    onRetry: () -> Unit,
    prefs: SummaryHeroDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: SummaryHeroStrings = rememberSummaryHeroStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            SummaryHeroHeader(
                state = state,
                showFreshness = snapshot != null && (state.stale || state.refreshing || state.hasError),
            )
            Spacer(modifier = Modifier.height(Spacing.md))
            when {
                state.isLoading -> SummaryHeroSkeletonGrid()
                state.isError -> SummaryHeroError(onRetry = onRetry)
                state.isEmpty || snapshot == null -> SummaryHeroEmpty()
                else -> SummaryHeroLoaded(snapshot = snapshot, prefs = prefs, strings = strings)
            }
        }
    }
}

/**
 * The panel header — the "Week Summary" title (web `<span class="text-lg font-bold">`) and, when the host's
 * feed implies it, a right-aligned freshness chip reflecting refreshing/stale/offline. The chip lives in the
 * header (not next to a value), matching the shared [DataFreshness] contract.
 */
@Composable
private fun SummaryHeroHeader(
    state: UiState<WeekSummarySnapshot>,
    showFreshness: Boolean,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        SectionTitle(
            text = stringResource(R.string.translation_analytics_weeklyDigest_weekSummary),
            modifier = Modifier.weight(1f),
        )
        if (showFreshness) {
            val formatAge = rememberSummaryHeroFreshnessFormatter()
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
}

/**
 * The content branch: the five-or-six HighlightCards laid out in the web responsive grid. Derives the
 * render-ready cards once via the pure [SummaryHeroCardsProjection.cards] and draws each through
 * [HighlightCard].
 */
@Composable
private fun SummaryHeroLoaded(
    snapshot: WeekSummarySnapshot,
    prefs: SummaryHeroDisplayPrefs,
    strings: SummaryHeroStrings,
) {
    val cards = remember(snapshot, prefs, strings) { SummaryHeroCardsProjection.cards(snapshot, prefs, strings) }
    SummaryHeroGrid(itemCount = cards.size) { index, cellModifier ->
        HighlightCard(card = cards[index], modifier = cellModifier)
    }
}

/**
 * One highlight card — the native analogue of the web `HighlightCard`, built on the shared [GlassPanel] (the
 * counterpart of the web HighlightCard's own `<GlassPanel>`). Shows a muted icon + label row, the bold value,
 * the optional trend badge, and the optional subtitle. The web `color` glow maps onto the panel accent.
 */
@Composable
private fun HighlightCard(
    card: SummaryHeroCard,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = card.color.toPanelAccent()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                card.icon.glyph(),
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(card.label)
        }
        MetricValue(card.value, modifier = Modifier.padding(top = Spacing.xs))
        card.trend?.let { TrendBadgeRow(trend = it, modifier = Modifier.padding(top = Spacing.xs)) }
        card.subtitle?.let { HelperText(it, modifier = Modifier.padding(top = Spacing.xs)) }
    }
}

/**
 * The week-over-week trend badge — the web HighlightCard's change row. The arrow glyph and the tone color are
 * both keyed off [TrendBadge.positive] (a success up-arrow / a danger down-arrow), reproducing the web
 * `change.positive ? <TrendingUp/> : <TrendingDown/>` + `text-emerald-400 / text-red-400` verbatim.
 */
@Composable
private fun TrendBadgeRow(
    trend: TrendBadge,
    modifier: Modifier = Modifier,
) {
    val color = if (trend.positive) TeslaTokens.status.success else TeslaTokens.status.danger
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            if (trend.positive) SummaryHeroGlyphs.TrendingUp else SummaryHeroGlyphs.TrendingDown,
            contentDescription = null,
            size = IconSize.Xs,
            tint = color,
        )
        Text(trend.value, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

/** The loading branch: six skeleton tiles in the same responsive grid, announced as "Loading" to TalkBack. */
@Composable
private fun SummaryHeroSkeletonGrid() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    SummaryHeroGrid(
        itemCount = SKELETON_TILE_COUNT,
        modifier = Modifier.semantics { contentDescription = loadingLabel },
    ) { _, cellModifier ->
        SummaryHeroSkeletonTile(modifier = cellModifier)
    }
}

/** A single loading tile — a panel with a label bar over a larger value bar (web MetricSkeleton shape). */
@Composable
private fun SummaryHeroSkeletonTile(modifier: Modifier = Modifier) {
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
 * Empty state — the weekly-digest "No Data" message with a map-pin glyph, so the panel never collapses to a
 * blank box. [EmptyState] exposes the message as its accessibility label, so the section is still announced
 * to TalkBack when it holds no data.
 */
@Composable
private fun SummaryHeroEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_analytics_weeklyDigest_noData),
        icon = DataDisplayGlyphs.MapPin,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SummaryHeroError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Lays out [itemCount] cells as the web responsive grid: three-per-row at or above [GRID_LG_MIN_WIDTH]
 * (`lg:grid-cols-3`), two-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:grid-cols-2`), and stacked below it
 * (`grid-cols-1`). Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so the cells keep a uniform width. Cells are spaced by `Spacing.md`, the native expression
 * of the web `gap-4`.
 */
@Composable
private fun SummaryHeroGrid(
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
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            rows.forEach { rowIndices ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowIndices.forEach { index -> item(index, Modifier.weight(1f)) }
                    repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Resolves the six localized card labels from the i18n catalog (P1/S10) — no English literal in the view. */
@Composable
private fun rememberSummaryHeroStrings(): SummaryHeroStrings {
    val totalDistance = stringResource(R.string.translation_analytics_weeklyDigest_totalDistance)
    val totalDrives = stringResource(R.string.translation_analytics_weeklyDigest_totalDrives)
    val energyUsed = stringResource(R.string.translation_analytics_weeklyDigest_energyUsed)
    val chargingCost = stringResource(R.string.translation_analytics_weeklyDigest_chargingCost)
    val co2Saved = stringResource(R.string.translation_analytics_weeklyDigest_co2Saved)
    val funFact = stringResource(R.string.translation_analytics_weeklyDigest_funFact)
    return remember(totalDistance, totalDrives, energyUsed, chargingCost, co2Saved, funFact) {
        SummaryHeroStrings(
            totalDistance = totalDistance,
            totalDrives = totalDrives,
            energyUsed = energyUsed,
            chargingCost = chargingCost,
            co2Saved = co2Saved,
            funFact = funFact,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSummaryHeroFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/** Maps a [SummaryHeroColor] glow to a design-token panel accent (P1/S9). */
private fun SummaryHeroColor.toPanelAccent(): PanelAccent =
    when (this) {
        // 'cyan' is the info token (#00F0FF) and 'green' is the success token — exact web matches.
        SummaryHeroColor.Cyan -> PanelAccent.Info
        SummaryHeroColor.Green -> PanelAccent.Success
        // The design system has no purple panel accent (web 'purple' glow) and the web 'amber' card has no
        // glow at all, so both fall back to the plain border; the per-card identity still reads from the
        // icon, value, and trend.
        SummaryHeroColor.Purple -> PanelAccent.None
        SummaryHeroColor.Amber -> PanelAccent.None
    }

/** Resolves a card's glyph — reusing the shared [DataDisplayGlyphs] where it carries the lucide equivalent. */
private fun SummaryHeroIcon.glyph(): ImageVector =
    when (this) {
        SummaryHeroIcon.Distance -> SummaryHeroGlyphs.Car
        SummaryHeroIcon.Drives -> SummaryHeroGlyphs.Activity
        SummaryHeroIcon.Energy -> DataDisplayGlyphs.Bolt
        SummaryHeroIcon.Cost -> SummaryHeroGlyphs.Fuel
        SummaryHeroIcon.Co2 -> SummaryHeroGlyphs.Leaf
        SummaryHeroIcon.FunFact -> DataDisplayGlyphs.MapPin
    }

/**
 * The glyphs this surface needs that the shared [DataDisplayGlyphs] set does not carry. The web uses lucide
 * `Car`, `Activity`, `Fuel`, `Leaf`, and the `TrendingUp`/`TrendingDown` trend arrows; Android ships no
 * equivalents without the frozen `material-icons-extended` artifact, so — exactly as the sibling surfaces do
 * for their lucide ports — they are authored here as 24×24 stroked vectors faithful to the lucide paths.
 */
private object SummaryHeroGlyphs {
    /** lucide `car` — a cabin, body, and two wheels (Total Distance tile). */
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

    /** lucide `activity` — a single-pulse ECG line (Total Drives tile). */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `fuel` — a fuel-pump tank with a nozzle arm (Charging Cost tile). */
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

    /** lucide `leaf` — a leaf blade with a midrib (CO2 Saved tile). */
    val Leaf: ImageVector =
        stroked("Leaf") {
            moveTo(11f, 20f)
            curveTo(7f, 20f, 4f, 17f, 4f, 13f)
            curveTo(4f, 7f, 10f, 4f, 20f, 4f)
            curveTo(20f, 12f, 16f, 18f, 9f, 18f)
            moveTo(5f, 19f)
            curveTo(9f, 13f, 13f, 11f, 17f, 9f)
        }

    /** lucide `trending-up` — an up-right polyline with an arrowhead (positive trend badge). */
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

    /** lucide `trending-down` — a down-right polyline with an arrowhead (negative trend badge). */
    val TrendingDown: ImageVector =
        stroked("TrendingDown") {
            moveTo(3f, 7f)
            lineTo(9f, 13f)
            lineTo(13f, 9f)
            lineTo(21f, 17f)
            moveTo(15f, 17f)
            lineTo(21f, 17f)
            lineTo(21f, 11f)
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

private val previewMetrics =
    WeekSummaryMetrics(
        totalDistance = 312.6,
        prevDistance = 280.0,
        totalDrives = 14.0,
        prevDriveCount = 11.0,
        energyUsed = 78.4,
        prevEnergy = 70.0,
        chargingCost = 24.18,
        prevChargingCost = 30.0,
        co2Saved = 41.2,
        prevCo2 = 38.0,
    )

private val previewFunFact = FunFactSummary(from = "San Francisco", to = "Los Angeles", times = "0.8")

private fun previewContent(funFact: FunFactSummary?): UiState<WeekSummarySnapshot> =
    UiState(phase = UiPhase.Content, data = WeekSummarySnapshot(previewMetrics, funFact))

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SummaryHeroCardsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryHeroCardsContent(state = UiState.loading(), onRetry = {}, prefs = SummaryHeroDisplayPrefs.DEFAULT)
    }
}

@Preview(name = "Content — with fun fact", showBackground = true)
@Composable
private fun SummaryHeroCardsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryHeroCardsContent(state = previewContent(previewFunFact), onRetry = {}, prefs = SummaryHeroDisplayPrefs.DEFAULT)
    }
}

@Preview(name = "Content — no fun fact", showBackground = true)
@Composable
private fun SummaryHeroCardsNoFunFactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryHeroCardsContent(state = previewContent(funFact = null), onRetry = {}, prefs = SummaryHeroDisplayPrefs.DEFAULT)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SummaryHeroCardsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryHeroCardsContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = SummaryHeroDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SummaryHeroCardsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryHeroCardsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = SummaryHeroDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Offline — stale last known", showBackground = true)
@Composable
private fun SummaryHeroCardsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryHeroCardsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = WeekSummarySnapshot(previewMetrics, previewFunFact),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = SummaryHeroDisplayPrefs.DEFAULT,
        )
    }
}
