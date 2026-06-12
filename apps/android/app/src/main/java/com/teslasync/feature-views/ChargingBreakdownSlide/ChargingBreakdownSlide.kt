// The native Jetpack Compose + Material 3 ChargingBreakdownSlide feature view — a parity port of
// web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx. The web component is one slide of
// the year-in-review carousel: a centered, full-height column (web `flex flex-col items-center justify-center
// h-full px-8 text-center`) holding a 🔌 emoji (a framer-motion spring scale-in), a bold "{n} charge
// sessions" headline, a muted "Average plug-in at {soc}% battery" subtext, a donut `<PieChart>` of the
// Supercharger / DC-fast / AC-other share (inner 55 / outer 85, paddingAngle 3), and a legend row of
// "{name} ({pct}%)" chips — each element fading/sliding in on a staggered delay.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The owning carousel supplies the year-review
// fields through the shared P1/S8 state-holder layer as a [UiState], so this feature view renders every
// lifecycle state that layer can carry — loading, hard error with retry, empty, content, and stale/offline
// ("last known") — without ever fetching. A web-parity overload that takes the raw `data` prop is also
// provided for hosts that already hold the loaded value. Every value derivation flows through the pure
// [ChargingBreakdownProjection]; the composable is a thin render layer.
//
// Segment colors mirror the web `COLORS = ['#f59e0b', '#3b82f6', '#6b7280']` assigned by FILTERED position
// (web `chartData.map((_, i) => COLORS[i % COLORS.length])`): index 0 → `ChartPalette.energy` (the exact
// `#F59E0B`), index 1 → `ChartPalette.speed` (the exact `#3B82F6`), index 2 → the muted `onSurfaceVariant`
// (the neutral analogue of `#6b7280`). The donut is drawn with Compose Canvas arcs (the same primitive the
// shared `RadialGauge` uses); feature views must not import the shared chart engine (Vico) directly, and the
// shared chart layer ships no donut, so the ring is a local Canvas — never a raw chart-library import.
//
// The entrance animations honor the reduced-motion preference (P1/S9, `rememberReducedMotion`): the emoji
// scale and the staggered `FadeIn`s collapse to a static final state when the user (or the OS animator
// scale) asks for reduced motion. The decorative emoji is hidden from TalkBack (the headline carries the
// meaning) and the donut exposes one combined breakdown description instead of unreadable arcs.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargingBreakdownSlide — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path, exactly as the sibling
// feature-view surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingbreakdownslide

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
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
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Layout geometry (web Tailwind / Recharts values, reproduced) ────────────────────────────────────

/** Web `px-8` (2rem) horizontal padding of the centered slide column. */
private val SLIDE_HORIZONTAL_PADDING: Dp = Spacing.xl3

/** Web `text-5xl` 🔌 emoji size. */
private val EMOJI_SIZE: TextUnit = 48.sp

/** The decorative plug emoji (web `🔌`). */
private const val CHARGING_EMOJI: String = "\uD83D\uDD0C"

/** Web `w-56 h-56` donut box (14rem). */
private val DONUT_SIZE: Dp = 224.dp

/** Mid-ring radius — the mean of the web `outerRadius={85}` / `innerRadius={55}`. */
private val DONUT_RING_RADIUS: Dp = 70.dp

/** Ring thickness — the web `outerRadius - innerRadius` (85 − 55). */
private val DONUT_RING_THICKNESS: Dp = 30.dp

/** Donut sweep origin: 12 o'clock, so the first slice grows clockwise from the top. */
private const val DONUT_START_ANGLE: Float = -90f

/** Web `paddingAngle={3}` — the degrees of gap inserted between adjacent slices. */
private const val DONUT_PADDING_ANGLE: Float = 3f

/** A full revolution in degrees. */
private const val FULL_SWEEP: Float = 360f

/** Loading chrome width — matched to the donut so the skeleton reads as this slide. */
private val LOADING_WIDTH: Dp = 240.dp

// ── Staggered entrance delays (web framer-motion `transition={{ delay }}`, seconds → ms) ─────────────
private const val HEADLINE_DELAY_MS: Int = 200
private const val SUBTEXT_DELAY_MS: Int = 400
private const val DONUT_DELAY_MS: Int = 500
private const val LEGEND_DELAY_MS: Int = 800

// ── Loading skeleton bar heights ────────────────────────────────────────────────────────────────────
private val HEADLINE_SKELETON_HEIGHT: Dp = 28.dp
private val SUBTEXT_SKELETON_HEIGHT: Dp = 16.dp
private const val HEADLINE_SKELETON_WIDTH_FRACTION: Float = 0.7f
private const val SUBTEXT_SKELETON_WIDTH_FRACTION: Float = 0.5f

private const val HEADLINE_MAX_LINES: Int = 2

/**
 * Stateful entry point for the charging-breakdown slide. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared year-review feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the year-review charging fields (web `data`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingBreakdownSlide(
    state: UiState<ChargingBreakdownData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ChargingBreakdownSlideDiagnostics.recordViewOpened(logger) }
    ChargingBreakdownSlideContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `data: YearReview` prop, for hosts that already hold the
 * loaded value. A `null` value renders the empty state; a present value renders the slide (the content
 * renderer itself falls back to the empty state when the breakdown carries no sessions and no positive
 * share). Records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry
 * affordance.
 */
@Composable
fun ChargingBreakdownSlide(
    data: ChargingBreakdownData?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            if (data == null) {
                UiState(UiPhase.Empty)
            } else {
                UiState(UiPhase.Content, data = data)
            }
        }
    ChargingBreakdownSlide(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's centered slide (emoji, headline, subtext, donut, legend) and adds the lifecycle chrome the
 * host's feed implies: a loading skeleton, a hard-error retry surface, a friendly empty state, and a
 * freshness chip that reflects refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring
 * the freshness contract.
 */
@Composable
fun ChargingBreakdownSlideContent(
    state: UiState<ChargingBreakdownData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: ChargingBreakdownStrings = rememberChargingBreakdownStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    Box(
        modifier =
            modifier
                .fillMaxSize()
                .padding(horizontal = SLIDE_HORIZONTAL_PADDING),
        contentAlignment = Alignment.Center,
    ) {
        when {
            state.isLoading -> ChargingBreakdownLoading(label = stringResource(R.string.translation_a11y_loading))
            state.isError -> ChargingBreakdownError(onRetry = onRetry)
            else -> {
                val display = remember(state.data) { state.data?.let { ChargingBreakdownProjection.project(it) } }
                if (display == null || display.isEmpty) {
                    ChargingBreakdownEmpty()
                } else {
                    ChargingBreakdownBody(display = display, strings = strings)
                }
            }
        }
        if (shouldShowFreshness(state)) {
            ChargingFreshnessRow(
                state = state,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = Spacing.md),
            )
        }
    }
}

/** True when cached data is refreshing / stale / offline and the slide content (not loading/error) is shown. */
private fun shouldShowFreshness(state: UiState<*>): Boolean =
    !state.isLoading && !state.isError && (state.stale || state.refreshing || state.hasError)

/**
 * The populated slide — the faithful centered column: the 🔌 emoji, the "{n} charge sessions" headline, the
 * "Average plug-in at {soc}% battery" subtext, the donut, and the legend. Each element after the emoji fades
 * and slides in on its web stagger delay; the donut + legend are omitted only when there is no positive
 * breakdown share (the headline + subtext still render, so the slide is never blank).
 */
@Composable
private fun ChargingBreakdownBody(
    display: ChargingBreakdownDisplay,
    strings: ChargingBreakdownStrings,
    modifier: Modifier = Modifier,
) {
    val palette =
        listOf(
            TeslaTokens.chart.energy,
            TeslaTokens.chart.speed,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        ChargingEmoji()
        FadeIn(delayMs = HEADLINE_DELAY_MS) { ChargingHeadline(display = display, strings = strings) }
        FadeIn(delayMs = SUBTEXT_DELAY_MS) { ChargingSubtext(display = display) }
        if (display.segments.isNotEmpty()) {
            FadeIn(delayMs = DONUT_DELAY_MS) {
                ChargingDonut(
                    segments = display.segments,
                    palette = palette,
                    contentDescription = donutDescription(display = display, strings = strings),
                )
            }
            FadeIn(delayMs = LEGEND_DELAY_MS) {
                ChargingLegend(segments = display.segments, strings = strings, palette = palette)
            }
        }
    }
}

/**
 * The 🔌 emoji, scaled in with a springy entrance (web `initial={{ scale: 0 }}` →
 * `transition={{ type: 'spring' }}`). Honors reduced motion by snapping straight to full scale. The glyph is
 * decorative — its semantics are cleared so TalkBack announces the headline ("{n} charge sessions"), not the
 * emoji.
 */
@Composable
private fun ChargingEmoji(modifier: Modifier = Modifier) {
    val reduce = rememberReducedMotion()
    val scale = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(reduce) {
        if (reduce) {
            scale.snapTo(1f)
        } else {
            scale.snapTo(0f)
            scale.animateTo(
                targetValue = 1f,
                animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
            )
        }
    }
    Text(
        text = CHARGING_EMOJI,
        fontSize = EMOJI_SIZE,
        textAlign = TextAlign.Center,
        modifier =
            modifier
                .graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                }.clearAndSetSemantics {},
    )
}

/** The headline "{n} charge sessions" (web `text-2xl font-bold`). */
@Composable
private fun ChargingHeadline(
    display: ChargingBreakdownDisplay,
    strings: ChargingBreakdownStrings,
    modifier: Modifier = Modifier,
) {
    val text = "${ChargingBreakdownProjection.formatSessionCount(display.totalChargeSessions)} ${strings.chargeSessions}"
    Text(
        text = text,
        modifier = modifier.fillMaxWidth(),
        style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        maxLines = HEADLINE_MAX_LINES,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The subtext "Average plug-in at {soc}% battery" (web `t('yearReview.avgStartSOC', { soc })`, the muted
 * `--text-muted` paragraph). The catalog template `%1$s%% battery` is resolved with the rounded SOC arg.
 */
@Composable
private fun ChargingSubtext(
    display: ChargingBreakdownDisplay,
    modifier: Modifier = Modifier,
) {
    Text(
        text = stringResource(R.string.translation_yearReview_avgStartSOC, display.avgStartSocPercent),
        modifier = modifier.fillMaxWidth(),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}

/**
 * The donut ring — the native counterpart of the web `<PieChart><Pie innerRadius={55} outerRadius={85}
 * paddingAngle={3} dataKey="value">`. Each slice is a stroked Canvas arc whose sweep is proportional to its
 * share (via the pure [ChargingBreakdownProjection.sweepFractions]); a small gap between slices reproduces
 * the web `paddingAngle`. Slice colors are positional (web `COLORS[i]`). The whole ring exposes one combined
 * [contentDescription] so TalkBack reads the breakdown instead of decorative arcs.
 */
@Composable
private fun ChargingDonut(
    segments: List<ChargingSegment>,
    palette: List<Color>,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val fractions = remember(segments) { ChargingBreakdownProjection.sweepFractions(segments) }
    val gap = if (segments.size > 1) DONUT_PADDING_ANGLE else 0f
    Canvas(
        modifier =
            modifier
                .size(DONUT_SIZE)
                .clearAndSetSemantics { this.contentDescription = contentDescription },
    ) {
        val ringRadiusPx = DONUT_RING_RADIUS.toPx()
        val strokePx = DONUT_RING_THICKNESS.toPx()
        val topLeft = Offset(center.x - ringRadiusPx, center.y - ringRadiusPx)
        val arcSize = Size(ringRadiusPx * 2f, ringRadiusPx * 2f)
        var startAngle = DONUT_START_ANGLE
        fractions.forEachIndexed { index, fraction ->
            val sweep = (fraction * FULL_SWEEP).toFloat()
            drawArc(
                color = palette[index % palette.size],
                startAngle = startAngle + gap / 2f,
                sweepAngle = (sweep - gap).coerceAtLeast(0f),
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = strokePx, cap = StrokeCap.Butt),
            )
            startAngle += sweep
        }
    }
}

/**
 * The legend row — the native counterpart of the web `chartData.map(...)` swatch + "{name} ({pct}%)" labels,
 * rendered through the shared [ChartLegend] (so the swatch + accessible label come from one place). Colors
 * are positional, matching the donut and the web `COLORS[i]` mapping.
 */
@Composable
private fun ChargingLegend(
    segments: List<ChargingSegment>,
    strings: ChargingBreakdownStrings,
    palette: List<Color>,
    modifier: Modifier = Modifier,
) {
    val entries =
        remember(segments, strings, palette) {
            segments.mapIndexed { index, segment ->
                LegendEntry(
                    key = segment.source.name,
                    label = ChargingBreakdownProjection.legendLabel(strings.label(segment.source), segment.percent),
                    color = palette[index % palette.size],
                )
            }
        }
    ChartLegend(entries = entries, modifier = modifier)
}

/** Combined screen-reader description for the donut, e.g. "Supercharger (62%), DC Fast (30%), AC / Other (8%)". */
private fun donutDescription(
    display: ChargingBreakdownDisplay,
    strings: ChargingBreakdownStrings,
): String =
    display.segments.joinToString(separator = ", ") { segment ->
        ChargingBreakdownProjection.legendLabel(strings.label(segment.source), segment.percent)
    }

/**
 * First-load skeleton — headline + subtext bars over a donut-shaped block so the slide is never blank while
 * the first fetch runs. Carries a single TalkBack "Loading" description.
 */
@Composable
private fun ChargingBreakdownLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .widthIn(max = LOADING_WIDTH)
                .semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = HEADLINE_SKELETON_WIDTH_FRACTION, height = HEADLINE_SKELETON_HEIGHT)
        Skeleton(widthFraction = SUBTEXT_SKELETON_WIDTH_FRACTION, height = SUBTEXT_SKELETON_HEIGHT)
        ChartBlockSkeleton(height = DONUT_SIZE)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ChargingBreakdownError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * Empty state — shown when the breakdown carries no sessions and no positive share, so the slide is never a
 * blank box. Uses the localized "No data available" message and the charging glyph.
 */
@Composable
private fun ChargingBreakdownEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = DataDisplayGlyphs.BatteryCharging,
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered in the slide's top-end corner when cached data is refreshing / stale / offline
 * — the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun ChargingFreshnessRow(
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberChargingFreshnessFormatter(),
        modifier = modifier,
    )
}

/**
 * Builds the localized [ChargingBreakdownStrings] from the i18n catalog (P1/S10): the four `yearReview.*`
 * keys the web component reads. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberChargingBreakdownStrings(): ChargingBreakdownStrings {
    val supercharger = stringResource(R.string.translation_yearReview_supercharger)
    val dcFast = stringResource(R.string.translation_yearReview_dcFast)
    val acOther = stringResource(R.string.translation_yearReview_acOther)
    val chargeSessions = stringResource(R.string.translation_yearReview_chargeSessions)
    return remember(supercharger, dcFast, acOther, chargeSessions) {
        ChargingBreakdownStrings(
            supercharger = supercharger,
            dcFast = dcFast,
            acOther = acOther,
            chargeSessions = chargeSessions,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberChargingFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    ChargingBreakdownStrings(
        supercharger = "Supercharger",
        dcFast = "DC Fast",
        acOther = "AC / Other",
        chargeSessions = "charge sessions",
    )

private val PREVIEW_DATA =
    ChargingBreakdownData(
        totalChargeSessions = 147,
        superchargerPct = 62.0,
        dcFastPct = 30.0,
        acOtherPct = 8.0,
        avgChargeStartSoc = 38.4,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChargingBreakdownLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingBreakdownSlideContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ChargingBreakdownEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingBreakdownSlideContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChargingBreakdownErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingBreakdownSlideContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ChargingBreakdownContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingBreakdownSlideContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ChargingBreakdownOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingBreakdownSlideContent(
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
