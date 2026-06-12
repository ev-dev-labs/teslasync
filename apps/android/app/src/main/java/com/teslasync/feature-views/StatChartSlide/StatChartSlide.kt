// The native Jetpack Compose + Material 3 "stat chart" Year-in-Review slide feature view — a parity port of
// web/src/features/analytics/components/review/StatChartSlide.tsx. The web component is purely presentational:
// a centered column on the slide gradient holding a spring-scaled 🗓️ emoji, the count-up `<AnimatedNumber>`
// of `data.total_drives` beside a "drives" label, a "{n} drives per week on average" caption, and a Recharts
// `<BarChart>` of `data.monthly_stats` (one violet column per month).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the recap through the
// shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the `/analytics/year-review`
// feed — a host holding the raw `JsonElement` feed maps it with the co-located [parseStatChartData]), so this
// feature view renders every lifecycle state that layer can carry — loading, hard error with retry, empty,
// content, and stale/offline (cached "last known") — without ever fetching. A web-parity overload that takes
// the already-loaded [StatChartData] prop is also provided for hosts that hold the value (web `data` prop).
//
// The native [FadeIn] + [AnimatedNumber] + [BarChartWrapper] + [EmptyState] are the faithful counterparts of
// the web shared components (`@/components/motion`, `@/components/data-display`, `@/components/charts`). The bar
// color maps to a design token (never a raw hex in render code): the web `rgba(167,139,250,0.7)` (violet-400)
// maps to `TeslaTokens.chart.power` (#A855F7), the nearest semantic palette entry. The emoji spring scale-in
// honors the reduced-motion preference (P1/S9, `rememberReducedMotion`), falling back to the final state.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/StatChartSlide — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statchartslide

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The decorative calendar glyph the web renders as a `text-5xl` emoji (`🗓️`). */
private const val CALENDAR_EMOJI: String = "\uD83D\uDDD3\uFE0F"

/** Hero emoji size — the native analogue of the web `text-5xl` (≈48–56px) glyph. */
private val EMOJI_SIZE: TextUnit = 56.sp

/** The web `<div className="w-full max-w-lg h-48">` plot box: 12rem tall, capped at the `lg` 32rem width. */
private val CHART_HEIGHT: Dp = 192.dp
private val CHART_MAX_WIDTH: Dp = 512.dp

/** Loading shimmer geometry for the count-up + caption rows. */
private val LOADING_NUMBER_HEIGHT: Dp = 40.dp
private val LOADING_CAPTION_HEIGHT: Dp = 14.dp
private const val LOADING_NUMBER_FRACTION: Float = 0.4f
private const val LOADING_CAPTION_FRACTION: Float = 0.6f

/** Em dash shown for an unknown freshness age (matches the shared empty marker). */
private const val EM_DASH: String = "\u2014"

/** Bar series key — the web `<Bar dataKey="drives" />`. */
private const val DRIVES_KEY: String = "drives"

/**
 * Stateful entry point for the stat-chart slide. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared year-review feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [StatChartData] (web `data` prop).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun StatChartSlide(
    state: UiState<StatChartData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordStatChartSlideOpened(logger) }
    StatChartSlideContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `data: YearReview` prop, for hosts that already hold the
 * loaded recap. A `null` value renders the empty surface (web renders nothing useful without `data`), a
 * non-null value renders the slide. Records `view.opened` like the stateful entry. There is no fetch behind
 * it, so it offers no retry affordance.
 */
@Composable
fun StatChartSlide(
    data: StatChartData?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            if (data == null) {
                UiState<StatChartData>(UiPhase.Empty)
            } else {
                UiState(UiPhase.Content, data = data)
            }
        }
    StatChartSlide(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * slide's centered composition (emoji → count-up + "drives" → caption → bar chart) and adds the lifecycle
 * chrome the host's feed implies: a loading skeleton, a hard-error retry surface, a friendly empty state, and
 * a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [locale] formats the count-up, the caption figure, and the Y-axis counts.
 */
@Composable
fun StatChartSlideContent(
    state: UiState<StatChartData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: StatChartSlideStrings = rememberStatChartSlideStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
        ) {
            when {
                state.isLoading ->
                    StatChartSlideLoading(label = stringResource(R.string.translation_common_loading))
                state.isError -> StatChartSlideError(onRetry = onRetry)
                else -> {
                    if (state.stale || state.refreshing || state.hasError) {
                        StatChartFreshnessRow(state)
                    }
                    val data = state.data
                    if (data == null) {
                        StatChartSlideEmpty(message = stringResource(R.string.translation_common_noData))
                    } else {
                        StatChartSlideBody(data = data, strings = strings, locale = locale)
                    }
                }
            }
        }
    }
}

/**
 * The populated slide body — the emoji, the count-up total beside its "drives" label, the "per week" caption,
 * and the monthly bar chart. The count-up + label are merged into one TalkBack announcement (web parity: the
 * emoji is decorative and the figure carries the meaning), and the emoji springs in unless reduced motion is
 * requested.
 */
@Composable
private fun StatChartSlideBody(
    data: StatChartData,
    strings: StatChartSlideStrings,
    locale: Locale,
) {
    val reduceMotion = rememberReducedMotion()
    val projection = remember(data) { StatChartSlideProjection.project(data) }
    val totalText =
        remember(data.totalDrives, locale) {
            ChartFormat.number(data.totalDrives, TOTAL_DRIVES_DECIMALS, locale)
        }
    val avgText =
        remember(data.avgDrivesPerWeek, strings.avgPerWeekTemplate, locale) {
            String.format(locale, strings.avgPerWeekTemplate, StatChartSlideProjection.formatAvgPerWeek(data.avgDrivesPerWeek, locale))
        }
    val countDescription = remember(totalText, strings.drivesLabel) { "$totalText ${strings.drivesLabel}" }

    StatChartEmoji(reduceMotion = reduceMotion)

    Row(
        modifier = Modifier.clearAndSetSemantics { contentDescription = countDescription },
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (reduceMotion) {
            MetricValue(totalText)
        } else {
            AnimatedNumber(value = data.totalDrives, decimals = TOTAL_DRIVES_DECIMALS, locale = locale)
        }
        Text(
            text = strings.drivesLabel,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    Text(
        text = avgText,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )

    StatChartSlideBars(projection = projection, label = strings.drivesLabel, locale = locale)
}

/**
 * The decorative calendar emoji (web `<motion.span className="text-5xl">🗓️</motion.span>`). It springs from
 * scale 0 → 1 on first composition (web `initial scale 0 → animate scale 1`, a spring), or appears at its
 * final scale under reduced motion. Marked decorative (cleared semantics) so TalkBack announces the figure,
 * not the glyph.
 */
@Composable
private fun StatChartEmoji(reduceMotion: Boolean) {
    val scale = remember { Animatable(if (reduceMotion) 1f else 0f) }
    LaunchedEffect(reduceMotion) {
        if (reduceMotion) {
            scale.snapTo(1f)
        } else {
            scale.snapTo(0f)
            scale.animateTo(
                targetValue = 1f,
                animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
            )
        }
    }
    Text(
        text = CALENDAR_EMOJI,
        fontSize = EMOJI_SIZE,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                }.clearAndSetSemantics { },
    )
}

/**
 * The monthly drives bar chart — a single `drives` series fed to the shared [BarChartWrapper], capped at the
 * web `max-w-lg` width and centered. The bar color resolves to the `chart.power` design token (the violet
 * analogue of the web `rgba(167,139,250,0.7)`). When there are no monthly rows the shared chart layer shows
 * its own empty message, so the slide is never a blank box.
 */
@Composable
private fun StatChartSlideBars(
    projection: StatChartSlideProjectionResult,
    label: String,
    locale: Locale,
) {
    val barColor = TeslaTokens.chart.power
    val series =
        remember(projection.driveValues, label, barColor) {
            listOf(
                ChartSeries(
                    key = DRIVES_KEY,
                    label = label,
                    values = projection.driveValues,
                    kind = ChartSeriesKind.Bar,
                    color = barColor,
                ),
            )
        }
    BarChartWrapper(
        series = series,
        xLabels = projection.xLabels,
        modifier = Modifier.fillMaxWidth().widthIn(max = CHART_MAX_WIDTH),
        height = CHART_HEIGHT,
        yValueFormatter = { value -> ChartFormat.number(value, TOTAL_DRIVES_DECIMALS, locale) },
        emptyMessage = stringResource(R.string.translation_common_noData),
    )
}

/** Empty state — web parity beneath the always-centered chrome: a calendar glyph + "No data available". */
@Composable
private fun StatChartSlideEmpty(message: String) {
    EmptyState(
        message = message,
        icon = FormsGlyphs.Calendar,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** First-load skeleton — count-up + caption shimmer over a chart-shaped block so the slide is never blank. */
@Composable
private fun StatChartSlideLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_NUMBER_FRACTION, height = LOADING_NUMBER_HEIGHT, rounded = true)
        Skeleton(widthFraction = LOADING_CAPTION_FRACTION, height = LOADING_CAPTION_HEIGHT)
        ChartBlockSkeleton(modifier = Modifier.fillMaxWidth().widthIn(max = CHART_MAX_WIDTH), height = CHART_HEIGHT)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun StatChartSlideError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered above the slide when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun StatChartFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberStatChartFreshnessFormatter(),
        )
    }
}

/**
 * Builds the localized [StatChartSlideStrings] from the i18n catalog (P1/S10): the two `yearReview.*` keys the
 * web slide reads (`yearReview.drives`, `yearReview.avgPerWeek`). Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberStatChartSlideStrings(): StatChartSlideStrings {
    val drives = stringResource(R.string.translation_yearReview_drives)
    val avgPerWeek = stringResource(R.string.translation_yearReview_avgPerWeek)
    return remember(drives, avgPerWeek) {
        StatChartSlideStrings(drivesLabel = drives, avgPerWeekTemplate = avgPerWeek)
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberStatChartFreshnessFormatter(): (FreshnessAge) -> String {
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
    StatChartSlideStrings(
        drivesLabel = "drives",
        avgPerWeekTemplate = "%1\$s drives per week on average",
    )

private val PREVIEW_DATA =
    StatChartData(
        totalDrives = 342.0,
        avgDrivesPerWeek = 6.6,
        monthlyStats =
            listOf(
                StatChartMonth(month = 1, drives = 24.0),
                StatChartMonth(month = 2, drives = 28.0),
                StatChartMonth(month = 3, drives = 31.0),
                StatChartMonth(month = 4, drives = 26.0),
                StatChartMonth(month = 5, drives = 35.0),
                StatChartMonth(month = 6, drives = 30.0),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun StatChartSlideLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatChartSlideContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun StatChartSlideEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatChartSlideContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun StatChartSlideErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatChartSlideContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun StatChartSlideContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatChartSlideContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun StatChartSlideOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatChartSlideContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
