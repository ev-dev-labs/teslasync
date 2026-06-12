// The native Jetpack Compose + Material 3 BatteryHealthSection feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx. The web component is
// purely presentational: its parent (the Weekly Digest page) computes the `DigestMetrics` document and
// passes it down, and the component fades in a GlassPanel with a "Battery Health" title, two `BatteryPill`s
// (average battery at charge start / end) and three `MiniStat`s (avg charge gain, charge sessions, est.
// range added). Its only data source is `useTranslation` (mapped to the i18n catalog, P1/S10).
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own. The host
// supplies the digest snapshot through the shared state-holder layer as a [UiState] (P1/S8), so this
// feature view also renders every lifecycle state that layer can carry — a loading skeleton, a hard error
// with retry, a friendly empty state, content, and stale/offline cached "last known" — without ever
// fetching. The content branch reproduces the web composition exactly (title + pills + mini stats), and the
// panel + title chrome stays visible in every state so no surface is ever hidden or blank. A web-parity
// overload that takes the digest snapshot directly (web `{ metrics }`) is also provided for hosts that
// already hold the document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryHealthSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batteryhealthsection

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Web `<FadeIn delay={0.2}>` — the panel fades in after a 200 ms stagger. */
private const val ENTRY_DELAY_MS: Int = 200

/** Web Tailwind `sm` breakpoint (640px): at or above this width the grids expand from one column. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Web `sm:grid-cols-2` — the two battery pills lay out two-per-row at the `sm` breakpoint. */
private const val PILL_COLUMNS_WIDE: Int = 2

/** Web `sm:grid-cols-3` — the three mini stats lay out three-per-row at the `sm` breakpoint. */
private const val STAT_COLUMNS_WIDE: Int = 3

/** Below the `sm` breakpoint every grid stacks into a single column (web `grid-cols-1`). */
private const val SINGLE_COLUMN: Int = 1

/** Web `w-16` — the battery pill's level track is 64dp wide. */
private val PILL_BAR_WIDTH: Dp = 64.dp

/** Web `h-2` — the battery pill's level track is 8dp tall. */
private val PILL_BAR_HEIGHT: Dp = 8.dp

/** Loading skeleton tile height for the pill and stat rows. */
private val SKELETON_TILE_HEIGHT: Dp = 56.dp

/**
 * The already-localized strings the section renders. The web component is anonymous — it resolves every
 * label through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary
 * and are threaded down, keeping the rest of the surface free of any English literal.
 */
data class BatteryHealthSectionStrings(
    val title: String,
    val avgBatteryStart: String,
    val avgBatteryEnd: String,
    val avgChargeGain: String,
    val chargeSessions: String,
    val estRangeAdded: String,
    val noData: String,
)

/**
 * Stateful entry point for the Battery Health section. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared digest feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [BatteryHealthSnapshot] this section reads.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BatteryHealthSection(
    state: UiState<BatteryHealthSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordBatteryHealthSectionOpened(logger) }
    BatteryHealthSectionContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ metrics })` prop, for hosts that already hold the
 * digest snapshot. Projects [metrics] onto a [UiState] via [BatteryHealthSectionProjection.projectUiState]
 * (content when present, else the friendly empty state) and delegates to the stateful entry, which records
 * `view.opened`. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun BatteryHealthSection(
    metrics: BatteryHealthSnapshot?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(metrics) { BatteryHealthSectionProjection.projectUiState(metrics, isLoading = false) }
    BatteryHealthSection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The panel + title
 * chrome (web `<GlassPanel>` + "Battery Health" header) stays visible in every branch; the body switches
 * between a loading skeleton, a hard-error retry surface, a friendly empty state, and the web content (a
 * freshness chip when stale/refreshing/offline, then the two pills and three mini stats). Stale (non-error)
 * data auto-refreshes, mirroring the web freshness contract.
 */
@Composable
fun BatteryHealthSectionContent(
    state: UiState<BatteryHealthSnapshot>,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    strings: BatteryHealthSectionStrings = rememberBatteryHealthSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    FadeIn(modifier = modifier, delayMs = ENTRY_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                BatteryHealthHeader(title = strings.title)
                when {
                    state.isLoading -> BatteryHealthLoadingBody()
                    state.isError -> BatteryHealthErrorBody(onRetry = onRetry)
                    state.isEmpty || snapshot == null -> BatteryHealthEmptyBody(message = strings.noData)
                    else -> BatteryHealthLoadedBody(snapshot = snapshot, state = state, strings = strings)
                }
            }
        }
    }
}

/** The title row — the battery glyph (web neon-purple → the purple chart token) and the section title. */
@Composable
private fun BatteryHealthHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = BatteryHealthGlyphs.Battery,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.chart.power,
        )
        SectionTitle(text = title, modifier = Modifier.semantics { heading() })
    }
}

/**
 * The content branch: an optional freshness chip (only when refreshing/stale/offline) above the two battery
 * pills and the three mini stats. Values are projected once for the active locale (web `fmtNumber`).
 */
@Composable
private fun BatteryHealthLoadedBody(
    snapshot: BatteryHealthSnapshot,
    state: UiState<BatteryHealthSnapshot>,
    strings: BatteryHealthSectionStrings,
) {
    val locale: Locale = LocalConfiguration.current.locales[0]
    val display = remember(snapshot, locale) { BatteryHealthSectionProjection.display(snapshot, locale) }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        if (state.stale || state.refreshing || state.hasError) {
            BatteryHealthFreshnessRow(state = state)
        }
        BatteryHealthPillsGrid(pills = display.pills, strings = strings)
        BatteryHealthStatsGrid(stats = display.stats, strings = strings)
    }
}

/** The freshness chip, right-aligned — surfaces refreshing / stale / offline over the cached content. */
@Composable
private fun BatteryHealthFreshnessRow(state: UiState<BatteryHealthSnapshot>) {
    val formatAge = rememberBatteryHealthFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
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

/** Web `grid-cols-1 gap-4 sm:grid-cols-2` — the two average-battery pills. */
@Composable
private fun BatteryHealthPillsGrid(
    pills: List<BatteryPillModel>,
    strings: BatteryHealthSectionStrings,
) {
    ResponsiveGrid(items = pills, wideColumns = PILL_COLUMNS_WIDE, gap = Spacing.md) { pill ->
        BatteryPill(model = pill, label = strings.pillLabel(pill.kind), modifier = Modifier.weight(1f))
    }
}

/** Web `grid-cols-1 gap-3 sm:grid-cols-3` — the three charge mini stats. */
@Composable
private fun BatteryHealthStatsGrid(
    stats: List<BatteryHealthStat>,
    strings: BatteryHealthSectionStrings,
) {
    ResponsiveGrid(items = stats, wideColumns = STAT_COLUMNS_WIDE, gap = Spacing.sm) { stat ->
        BatteryMiniStat(
            label = strings.statLabel(stat.metric),
            value = stat.value,
            icon = stat.metric.glyph(),
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * One battery pill — the native port of the web `BatteryPill`: a glass card with a battery glyph, a
 * label + colored percentage, and a proportional level track. The icon, percentage and fill all share the
 * threshold [BatteryPillModel.band] color; the track is purely decorative so it exposes no screen-reader
 * node, while the label and value text stay individually announced to TalkBack.
 */
@Composable
private fun BatteryPill(
    model: BatteryPillModel,
    label: String,
    modifier: Modifier = Modifier,
) {
    val color = batteryBandColor(model.band)
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = BatteryHealthGlyphs.Battery,
                contentDescription = null,
                size = IconSize.Lg,
                tint = color,
            )
            Column(modifier = Modifier.weight(1f)) {
                Caption(text = label)
                BodyText(text = model.percentText, color = color, maxLines = 1)
            }
            BatteryLevelTrack(fraction = model.barFraction, color = color)
        }
    }
}

/** The proportional level track (web `h-2 w-16` rounded bar): a neutral groove with a colored fill. */
@Composable
private fun BatteryLevelTrack(
    fraction: Float,
    color: Color,
) {
    Box(
        modifier =
            Modifier
                .width(PILL_BAR_WIDTH)
                .height(PILL_BAR_HEIGHT)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .clip(CircleShape)
                    .background(color),
        )
    }
}

/**
 * One mini stat — the native port of the web `MiniStat`: a glass card with a muted leading glyph, a label,
 * and the already-formatted value. The label and value text are individually announced to TalkBack.
 */
@Composable
private fun BatteryMiniStat(
    label: String,
    value: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(modifier = Modifier.weight(1f)) {
                Caption(text = label)
                BodyText(text = value, maxLines = 1)
            }
        }
    }
}

/** The loading branch — pill-row and stat-row skeleton tiles in the same responsive grids as the content. */
@Composable
private fun BatteryHealthLoadingBody() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val skeletonCell: @Composable RowScope.(Int) -> Unit = {
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
    }
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        ResponsiveGrid(
            items = List(PILL_COLUMNS_WIDE) { it },
            wideColumns = PILL_COLUMNS_WIDE,
            gap = Spacing.md,
            cell = skeletonCell,
        )
        ResponsiveGrid(
            items = List(STAT_COLUMNS_WIDE) { it },
            wideColumns = STAT_COLUMNS_WIDE,
            gap = Spacing.sm,
            cell = skeletonCell,
        )
    }
}

/**
 * The empty branch — the `common.noData` message with a battery glyph, so the section never collapses to a
 * blank box. [EmptyState] exposes the message as its accessibility label, so the section is still announced.
 */
@Composable
private fun BatteryHealthEmptyBody(message: String) {
    EmptyState(
        message = message,
        icon = BatteryHealthGlyphs.Battery,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The hard-error branch — a retry affordance (the web `QueryError` equivalent). */
@Composable
private fun BatteryHealthErrorBody(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * A responsive grid of equal-width cells — the native analogue of the web `grid-cols-1 sm:grid-cols-N`.
 * Below [GRID_SM_MIN_WIDTH] the [items] stack into one column; at or above it they lay out [wideColumns]
 * per row. Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with weighted
 * spacers so every tile keeps a uniform width. Rows and columns are both spaced by [gap].
 */
@Composable
private fun <T> ResponsiveGrid(
    items: List<T>,
    wideColumns: Int,
    gap: Dp,
    modifier: Modifier = Modifier,
    cell: @Composable RowScope.(T) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) wideColumns else SINGLE_COLUMN
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(gap),
        ) {
            items.chunked(columns).forEach { rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(gap),
                ) {
                    rowItems.forEach { item -> cell(item) }
                    repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Maps a threshold [BatteryHealthColorBand] onto the semantic status token (web success/warning/critical). */
@Composable
private fun batteryBandColor(band: BatteryHealthColorBand): Color =
    when (band) {
        BatteryHealthColorBand.Good -> TeslaTokens.status.success
        BatteryHealthColorBand.Warning -> TeslaTokens.status.warning
        BatteryHealthColorBand.Critical -> TeslaTokens.status.danger
    }

/**
 * Builds the localized [BatteryHealthSectionStrings] from the i18n catalog (P1/S10): the
 * `analytics.weeklyDigest.*` keys the web component reads through `useTranslation`, plus `common.noData`
 * for the empty state. Resolved once at the Compose boundary so the rest of the surface holds no literal.
 */
@Composable
private fun rememberBatteryHealthSectionStrings(): BatteryHealthSectionStrings {
    val title = stringResource(R.string.translation_analytics_weeklyDigest_batteryHealth)
    val avgBatteryStart = stringResource(R.string.translation_analytics_weeklyDigest_avgBatteryStart)
    val avgBatteryEnd = stringResource(R.string.translation_analytics_weeklyDigest_avgBatteryEnd)
    val avgChargeGain = stringResource(R.string.translation_analytics_weeklyDigest_avgChargeGain)
    val chargeSessions = stringResource(R.string.translation_analytics_weeklyDigest_chargeSessions)
    val estRangeAdded = stringResource(R.string.translation_analytics_weeklyDigest_estRangeAdded)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(title, avgBatteryStart, avgBatteryEnd, avgChargeGain, chargeSessions, estRangeAdded, noData) {
        BatteryHealthSectionStrings(
            title = title,
            avgBatteryStart = avgBatteryStart,
            avgBatteryEnd = avgBatteryEnd,
            avgChargeGain = avgChargeGain,
            chargeSessions = chargeSessions,
            estRangeAdded = estRangeAdded,
            noData = noData,
        )
    }
}

/** Resolves a pill's already-localized label from the bundled strings. */
private fun BatteryHealthSectionStrings.pillLabel(kind: BatteryPillKind): String =
    when (kind) {
        BatteryPillKind.AvgStart -> avgBatteryStart
        BatteryPillKind.AvgEnd -> avgBatteryEnd
    }

/** Resolves a mini stat's already-localized label from the bundled strings. */
private fun BatteryHealthSectionStrings.statLabel(metric: BatteryHealthMetric): String =
    when (metric) {
        BatteryHealthMetric.AvgChargeGain -> avgChargeGain
        BatteryHealthMetric.ChargeSessions -> chargeSessions
        BatteryHealthMetric.EstRangeAdded -> estRangeAdded
    }

/** Resolves a mini stat's line glyph — the native analogue of the web lucide icon for that metric. */
private fun BatteryHealthMetric.glyph(): ImageVector =
    when (this) {
        BatteryHealthMetric.AvgChargeGain -> BatteryHealthGlyphs.TrendingUp
        BatteryHealthMetric.ChargeSessions -> BatteryHealthGlyphs.Zap
        BatteryHealthMetric.EstRangeAdded -> BatteryHealthGlyphs.MapPin
    }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberBatteryHealthFreshnessFormatter(): (FreshnessAge) -> String {
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
private const val EM_DASH: String = "\u2014"

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored at render time —
 * the same approach as the sibling feature-view glyphs.
 */
private object BatteryHealthGlyphs {
    /** lucide `battery` — a battery body and terminal (the title and pill icon). */
    val Battery: ImageVector =
        batteryHealthVector("BatteryHealthBattery") {
            moveTo(3f, 8f)
            lineTo(15f, 8f)
            lineTo(15f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(18f, 11f)
            lineTo(18f, 13f)
        }

    /** lucide `trending-up` — an up-right polyline with an arrowhead (Avg Charge Gain stat). */
    val TrendingUp: ImageVector =
        batteryHealthVector("BatteryHealthTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** lucide `zap` — a lightning bolt (Charge Sessions stat). */
    val Zap: ImageVector =
        batteryHealthVector("BatteryHealthZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `map-pin` — a teardrop pin with an inner circle (Est. Range Added stat). */
    val MapPin: ImageVector =
        batteryHealthVector("BatteryHealthMapPin") {
            moveTo(12f, 22f)
            curveTo(12f, 22f, 4f, 16f, 4f, 10f)
            curveTo(4f, 5.58f, 7.58f, 2f, 12f, 2f)
            curveTo(16.42f, 2f, 20f, 5.58f, 20f, 10f)
            curveTo(20f, 16f, 12f, 22f, 12f, 22f)
            close()
            moveTo(15f, 10f)
            curveTo(15f, 11.66f, 13.66f, 13f, 12f, 13f)
            curveTo(10.34f, 13f, 9f, 11.66f, 9f, 10f)
            curveTo(9f, 8.34f, 10.34f, 7f, 12f, 7f)
            curveTo(13.66f, 7f, 15f, 8.34f, 15f, 10f)
            close()
        }
}

private fun batteryHealthVector(
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

// ── Previews — one per rendered state (content / stale-offline / empty / loading / error) ───────────────

private fun previewSnapshot(): BatteryHealthSnapshot =
    BatteryHealthSnapshot(
        batteryStart = 22.4,
        batteryEnd = 78.6,
        chargingSessionCount = 12,
        chargeEnergyAdded = 240.0,
    )

@Preview(name = "BatteryHealthSection · content", showBackground = true)
@Composable
private fun BatteryHealthSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryHealthSectionContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_FETCHED_AT),
        )
    }
}

@Preview(name = "BatteryHealthSection · stale + offline", showBackground = true)
@Composable
private fun BatteryHealthSectionStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryHealthSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(),
                    fetchedAt = PREVIEW_FETCHED_AT,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
        )
    }
}

@Preview(name = "BatteryHealthSection · empty", showBackground = true)
@Composable
private fun BatteryHealthSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryHealthSectionContent(state = UiState(phase = UiPhase.Empty))
    }
}

@Preview(name = "BatteryHealthSection · loading", showBackground = true)
@Composable
private fun BatteryHealthSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryHealthSectionContent(state = UiState.loading())
    }
}

@Preview(name = "BatteryHealthSection · error", showBackground = true)
@Composable
private fun BatteryHealthSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryHealthSectionContent(state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))
    }
}

/** A fixed freshness stamp for the previews so the stale chip renders a deterministic relative age. */
private const val PREVIEW_FETCHED_AT: Long = 1_700_000_000_000L
