// The native Jetpack Compose + Material 3 Sentry Mode Activity chart feature view — a parity port of
// web/src/features/admin/components/security-access/SentryModeChart.tsx. The web component is purely
// presentational: it wraps a `<GlassPanel>` (an always-visible "Sentry Mode Activity" `<h2>`) around either a
// Recharts stacked `<BarChart>` of `sentryOn` / `sentryOff` counts per day, or a friendly `<EmptyState>`
// (an `Activity` icon + "No data available") when there are no buckets, all inside a `<FadeIn delay={0.2}>`.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog; the X labels use the localized date
// formatter). The host supplies the buckets through the shared P1/S8 state-holder layer as a [UiState] (the
// cache-then-network projection of the security-access feed), so this feature view renders every lifecycle
// state that layer can carry — loading, hard error with retry, empty, content, and stale/offline (cached
// "last known") — without ever fetching. The native [GlassPanel] + [BarChartWrapper] + [ChartLegend] +
// [EmptyState] + [FadeIn] are the faithful counterparts of the web shared components. A web-parity overload
// that takes the raw `sentryBuckets` prop is also provided for hosts that already hold the loaded list.
//
// Bar colors map to design tokens (never raw hex in render code): `sentryOn` → `TeslaTokens.chart.speed`
// (the exact `#3B82F6` of the web `<Bar fill="#3b82f6" />`), `sentryOff` → the muted `onSurfaceVariant`
// (the neutral analogue of the web `#6b7280`). The shared `BarChartWrapper` renders the two series as Vico
// columns; feature views must not import Vico directly nor alter the shared chart layer (allowed-files), so
// the grouped/stacked column nuance is the shared renderer's concern — the data parity (two series, colors,
// per-day labels, legend) is exact.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SentryModeChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sentrymodechart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
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
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.roundToLong

/** The web `<div className="h-64">` plot height (16rem). */
private val CHART_HEIGHT: Dp = 256.dp

/** The web `<FadeIn delay={0.2}>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 200

/** Bar series keys — the web `<Bar dataKey="sentryOn" />` / `<Bar dataKey="sentryOff" />`. */
private const val SENTRY_ON_KEY: String = "sentryOn"
private const val SENTRY_OFF_KEY: String = "sentryOff"

/**
 * Stateful entry point for the Sentry Mode activity chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared security-access feed can carry. The
 * host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `SentryDayBucket[]` (web `sentryBuckets`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SentryModeChart(
    state: UiState<List<SentryDayBucket>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSentryModeChartOpened(logger) }
    SentryModeChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `sentryBuckets: SentryDayBucket[]` prop, for hosts that
 * already hold the loaded list. An empty list renders the empty state (web `sentryBuckets.length > 0`
 * ternary), a non-empty list renders the bars. Records `view.opened` like the stateful entry. There is no
 * fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SentryModeChart(
    sentryBuckets: List<SentryDayBucket>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(sentryBuckets) {
            val items = sentryBuckets ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    SentryModeChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * always-visible title + content/empty branches (the stacked [BarChartWrapper] with its [ChartLegend], or an
 * [EmptyState] when there are no buckets) and adds the lifecycle chrome the host's feed implies: a loading
 * chart skeleton, a hard-error retry surface, and a freshness chip that reflects refreshing/stale/offline.
 * Stale (non-error) data auto-refreshes, mirroring the web freshness contract. [locale]/[zoneId] format the
 * day labels and the integer counts.
 */
@Composable
fun SentryModeChartContent(
    state: UiState<List<SentryDayBucket>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: SentryModeChartStrings = rememberSentryModeChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            SectionTitle(strings.title)
            Spacer(Modifier.height(Spacing.md))
            when {
                state.isLoading -> SentryModeChartLoading(label = stringResource(R.string.translation_common_loading))
                state.isError -> SentryModeChartError(onRetry = onRetry)
                else -> {
                    if (state.stale || state.refreshing || state.hasError) {
                        SentryFreshnessRow(state)
                    }
                    val result =
                        remember(state.data, locale, zoneId) {
                            SentryModeChartProjection.project(
                                buckets = state.data ?: emptyList(),
                                formatDate = { date -> SentryDateFormatting.format(date, zoneId, locale) },
                            )
                        }
                    if (result.isEmpty) {
                        SentryModeChartEmpty(message = stringResource(R.string.translation_common_noData))
                    } else {
                        SentryModeChartBars(result = result, strings = strings, locale = locale)
                    }
                }
            }
        }
    }
}

/**
 * The populated chart — the two `sentryOn` / `sentryOff` bar series fed to the shared [BarChartWrapper] plus
 * the [ChartLegend] (web `<Legend>`). Bar colors resolve to design tokens: armed → `chart.speed` (the web
 * `#3b82f6`), disarmed → the muted `onSurfaceVariant` (the neutral analogue of the web `#6b7280`).
 */
@Composable
private fun SentryModeChartBars(
    result: SentryModeChartProjectionResult,
    strings: SentryModeChartStrings,
    locale: Locale,
) {
    val onColor = TeslaTokens.chart.speed
    val offColor = MaterialTheme.colorScheme.onSurfaceVariant
    val series =
        remember(result.sentryOnValues, result.sentryOffValues, strings, onColor, offColor) {
            listOf(
                ChartSeries(
                    key = SENTRY_ON_KEY,
                    label = strings.sentryOnLabel,
                    values = result.sentryOnValues,
                    kind = ChartSeriesKind.Bar,
                    color = onColor,
                ),
                ChartSeries(
                    key = SENTRY_OFF_KEY,
                    label = strings.sentryOffLabel,
                    values = result.sentryOffValues,
                    kind = ChartSeriesKind.Bar,
                    color = offColor,
                ),
            )
        }
    val legend =
        remember(strings, onColor, offColor) {
            listOf(
                LegendEntry(key = SENTRY_ON_KEY, label = strings.sentryOnLabel, color = onColor),
                LegendEntry(key = SENTRY_OFF_KEY, label = strings.sentryOffLabel, color = offColor),
            )
        }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        BarChartWrapper(
            series = series,
            xLabels = result.xLabels,
            height = CHART_HEIGHT,
            yValueFormatter = { value -> SentryModeChartProjection.formatCount(value.roundToLong(), locale) },
            emptyMessage = stringResource(R.string.translation_common_noData),
        )
        ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * Empty state — web parity: the `Activity` glyph + "No data available", shown beneath the always-visible
 * title so the panel is never a blank box (web `<EmptyState icon={<Activity />} message={t('common.noData')}/>`).
 */
@Composable
private fun SentryModeChartEmpty(message: String) {
    EmptyState(
        message = message,
        icon = SentryActivityGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** First-load skeleton — a chart-shaped shimmer so the panel is never blank while the first fetch runs. */
@Composable
private fun SentryModeChartLoading(label: String) {
    ChartBlockSkeleton(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
        height = CHART_HEIGHT,
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SentryModeChartError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered above the chart when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun SentryFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
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
            formatAge = rememberSentryFreshnessFormatter(),
        )
    }
}

/**
 * Builds the localized [SentryModeChartStrings] from the i18n catalog (P1/S10): the three `admin.security.*`
 * keys the web component reads. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberSentryModeChartStrings(): SentryModeChartStrings {
    val title = stringResource(R.string.translation_admin_security_sentryChart)
    val sentryOn = stringResource(R.string.translation_admin_security_chart_sentryOn)
    val sentryOff = stringResource(R.string.translation_admin_security_chart_sentryOff)
    return remember(title, sentryOn, sentryOff) {
        SentryModeChartStrings(title = title, sentryOnLabel = sentryOn, sentryOffLabel = sentryOff)
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSentryFreshnessFormatter(): (FreshnessAge) -> String {
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
    SentryModeChartStrings(
        title = "Sentry Mode Activity",
        sentryOnLabel = "Sentry On",
        sentryOffLabel = "Sentry Off",
    )

private val PREVIEW_BUCKETS =
    listOf(
        SentryDayBucket(date = "2026-04-02", sentryOn = 12, sentryOff = 4),
        SentryDayBucket(date = "2026-04-03", sentryOn = 9, sentryOff = 7),
        SentryDayBucket(date = "2026-04-04", sentryOn = 15, sentryOff = 2),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SentryModeChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SentryModeChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SentryModeChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SentryModeChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SentryModeChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SentryModeChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SentryModeChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SentryModeChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_BUCKETS),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SentryModeChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SentryModeChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_BUCKETS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}
