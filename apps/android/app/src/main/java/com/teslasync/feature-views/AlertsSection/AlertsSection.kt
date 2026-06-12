// The native Jetpack Compose + Material 3 Alerts weekly-digest feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/AlertsSection.tsx. The web component is purely
// presentational: inside a `<FadeIn delay={0.25}>` it wraps a `<GlassPanel>` around an always-visible
// "Alerts" header (an `AlertTriangle` glyph + the title + a warning `<Badge>` of the total when > 0) and then
// either a friendly `<EmptyState>` ("No alerts this week — everything looks great!") when
// `metrics.alertTotal === 0`, or a two-up layout: an "Alerts by Severity" list (one row per
// `metrics.alertsByType` entry — a severity glyph + the capitalized severity + a colored count `<Badge>`) and
// an "Alert Distribution" donut `<PieChart>` of `alertPieData` with a circle legend.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the severity counts
// through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the weekly
// alerts feed), so this feature view renders every lifecycle state that layer can carry — loading, hard error
// with retry, empty, content, and stale/offline ("last known") — without ever fetching. The native
// [GlassPanel] + [EmptyState] + [Badge] + [ChartLegend] + [FadeIn] are the faithful counterparts of the web
// shared components; the donut is drawn with Compose Canvas (the sibling chart surfaces' approach), so no
// charting library is imported into a feature view. A web-parity overload taking the raw severity counts is
// also provided for hosts that already hold the loaded list.
//
// Slice / glyph colors map to design tokens (never raw hex in render code): critical →
// `TeslaTokens.status.danger` (the web `STATUS_COLORS.critical`), warning → `TeslaTokens.status.warning` (web
// `STATUS_COLORS.warning`), info → `paletteColor(0)` (web `CHART_COLORS[0]`), and the unknown fallback →
// `paletteColor(4)` (web `CHART_COLORS[4]`). The header glyph is the amber `status.warning` (web
// `text-neon-amber`). The count `Badge` variants mirror the web ternary exactly (critical → danger, warning →
// warning, everything else → info) — note the info badge color intentionally differs from the info slice
// color, just as it does on the web.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AlertsSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertssection

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
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

/** The web `<FadeIn delay={0.25}>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 250

/** Donut canvas edge — sized so the web `outerRadius={90}` ring (diameter 180) fits with its stroke. */
private val DONUT_SIZE: Dp = 180.dp

/** Ring thickness — the web donut band (`outerRadius` 90 − `innerRadius` 55). */
private val RING_THICKNESS: Dp = 35.dp

/** Loading-skeleton height — the donut plus its legend, so the panel is never a blank box first paint. */
private val LOADING_HEIGHT: Dp = 220.dp

/** Gap between slices, in degrees — the web `<Pie paddingAngle={3} />`. */
private const val PADDING_ANGLE: Float = 3f

/** Sweep start — 12 o'clock, drawn clockwise (the sibling gauge convention). */
private const val START_ANGLE: Float = -90f

/** A full revolution in degrees. */
private const val FULL_SWEEP: Float = 360f

/** Separator joining the donut's accessible value read-out. */
private const val A11Y_SEPARATOR: String = ", "

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10): the panel [title] (web
 * `analytics.weeklyDigest.alertsSection`), the two section labels ([bySeverity] / [distribution]), and the
 * [noAlerts] empty message. The lifecycle-chrome strings (loading / error / retry / offline / freshness) are
 * resolved inline at the Compose boundary, so this holder stays a thin content carrier.
 */
data class AlertsSectionStrings(
    val title: String,
    val bySeverity: String,
    val distribution: String,
    val noAlerts: String,
)

/** The four resolved severity token colors, mapped from [AlertSeverity] at the Compose boundary. */
private data class AlertPalette(
    val critical: Color,
    val warning: Color,
    val info: Color,
    val other: Color,
) {
    fun colorFor(kind: AlertSeverity): Color =
        when (kind) {
            AlertSeverity.Critical -> critical
            AlertSeverity.Warning -> warning
            AlertSeverity.Info -> info
            AlertSeverity.Other -> other
        }
}

/**
 * Stateful entry point for the Alerts weekly-digest section. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared weekly-alerts feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the per-severity counts (web `metrics.alertsByType`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AlertsSection(
    state: UiState<List<AlertSeverityCount>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordAlertsSectionOpened(logger) }
    AlertsSectionContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `metrics.alertsByType` input, for hosts that already hold
 * the loaded counts. A `null`/empty list or all-zero counts render the empty state (web
 * `metrics.alertTotal === 0`), otherwise the severity list + donut render. Records `view.opened` like the
 * stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun AlertsSection(
    alerts: List<AlertSeverityCount>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(alerts) {
            val items = alerts ?: emptyList()
            val empty = items.sumOf { it.count } == 0L
            UiState(phase = if (empty) UiPhase.Empty else UiPhase.Content, data = items)
        }
    AlertsSection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * always-visible header + content/empty branches and adds the lifecycle chrome the host's feed implies: a
 * loading skeleton, a hard-error retry surface, and a freshness chip that reflects refreshing / stale /
 * offline. Stale (non-error) data auto-refreshes, mirroring the freshness contract the sibling surfaces use.
 * [locale] formats the integer counts.
 */
@Composable
fun AlertsSectionContent(
    state: UiState<List<AlertSeverityCount>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: AlertsSectionStrings = rememberAlertsSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale) {
            AlertsSectionProjection.project(state.data ?: emptyList(), locale)
        }

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            AlertsHeader(title = strings.title, total = result.total, totalLabel = result.totalLabel)
            Spacer(Modifier.height(Spacing.lg))
            when {
                state.isLoading -> AlertsLoading(label = stringResource(R.string.translation_common_loading))
                state.isError -> AlertsError(onRetry = onRetry)
                else -> {
                    if (state.stale || state.refreshing || state.hasError) {
                        AlertsFreshnessRow(state)
                    }
                    if (result.isEmpty) {
                        AlertsEmpty(message = strings.noAlerts)
                    } else {
                        AlertsBody(result = result, strings = strings)
                    }
                }
            }
        }
    }
}

/**
 * The always-visible header — the amber `AlertTriangle` glyph, the localized [title], and the warning total
 * [Badge] when [total] > 0 (web `metrics.alertTotal > 0 && <Badge variant="warning">`). The glyph is
 * decorative; the title carries the heading semantics.
 */
@Composable
private fun AlertsHeader(
    title: String,
    total: Long,
    totalLabel: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            AlertTriangleGlyph,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.warning,
        )
        SectionTitle(title)
        if (total > 0L) {
            Badge(totalLabel, variant = BadgeVariant.Warning)
        }
    }
}

/**
 * The populated body — the "Alerts by Severity" list and the "Alert Distribution" donut, stacked for the
 * phone layout (the web `grid-cols-1` baseline before its `lg:grid-cols-2` desktop split). The severity token
 * colors are resolved once and shared by the row glyphs, the donut, and the legend so all three agree.
 */
@Composable
private fun AlertsBody(
    result: AlertsSectionProjectionResult,
    strings: AlertsSectionStrings,
) {
    val palette = rememberAlertPalette()
    val sliceColors = result.slices.map { palette.colorFor(it.kind) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        AlertsBySeverity(slices = result.slices, sliceColors = sliceColors, label = strings.bySeverity)
        AlertDistribution(
            slices = result.slices,
            sliceColors = sliceColors,
            label = strings.distribution,
        )
    }
}

/**
 * The "Alerts by Severity" list — one [GlassPanel] row per slice (web nested `<GlassPanel>` with
 * `justify-between`): a severity glyph + the capitalized name on the left, the colored count [Badge] on the
 * right. The glyph tint matches the slice color; the badge variant mirrors the web ternary.
 */
@Composable
private fun AlertsBySeverity(
    slices: List<AlertSliceProjection>,
    sliceColors: List<Color>,
    label: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(label)
        slices.forEachIndexed { index, slice ->
            AlertSeverityRow(slice = slice, color = sliceColors[index])
        }
    }
}

/** One severity row — glyph + capitalized name + colored count badge. */
@Composable
private fun AlertSeverityRow(
    slice: AlertSliceProjection,
    color: Color,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                severityGlyph(slice.kind)?.let { glyph ->
                    Icon(glyph, contentDescription = null, size = IconSize.Sm, tint = color)
                }
                BodyText(slice.displayName)
            }
            Badge(slice.countLabel, variant = badgeVariant(slice.kind))
        }
    }
}

/**
 * The "Alert Distribution" donut + circle legend — the web `<PieChart>` of `alertPieData` with its
 * `<Legend iconType="circle">`. The Canvas draws one stroked arc per slice (proportional sweep, a
 * [PADDING_ANGLE] gap between slices) and exposes a single accessible value read-out; the shared
 * [ChartLegend] supplies the per-slice swatch labels.
 */
@Composable
private fun AlertDistribution(
    slices: List<AlertSliceProjection>,
    sliceColors: List<Color>,
    label: String,
) {
    val description =
        remember(label, slices) {
            label + ": " + slices.joinToString(A11Y_SEPARATOR) { "${it.displayName} ${it.countLabel}" }
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Caption(label)
        AlertDonutCanvas(slices = slices, sliceColors = sliceColors, description = description)
        val legend =
            slices.mapIndexed { index, slice ->
                LegendEntry(key = slice.severity, label = slice.displayName, color = sliceColors[index])
            }
        ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
    }
}

/** Pure-Canvas donut: one proportional stroked arc per slice with a small gap between slices. */
@Composable
private fun AlertDonutCanvas(
    slices: List<AlertSliceProjection>,
    sliceColors: List<Color>,
    description: String,
) {
    val total = slices.sumOf { it.count }.toFloat()
    val gap = if (slices.size > 1) PADDING_ANGLE else 0f
    Canvas(
        modifier =
            Modifier
                .size(DONUT_SIZE)
                .semantics { contentDescription = description },
    ) {
        if (total <= 0f) return@Canvas
        val strokePx = RING_THICKNESS.toPx()
        val diameter = this.size.minDimension - strokePx
        val topLeft =
            Offset(
                (this.size.width - diameter) / 2f,
                (this.size.height - diameter) / 2f,
            )
        val arcSize = Size(diameter, diameter)
        var start = START_ANGLE
        slices.forEachIndexed { index, slice ->
            val full = FULL_SWEEP * (slice.count.toFloat() / total)
            val sweep = (full - gap).coerceAtLeast(0f)
            drawArc(
                color = sliceColors[index],
                startAngle = start + gap / 2f,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = strokePx),
            )
            start += full
        }
    }
}

/**
 * Empty state — web parity: the `AlertTriangle` glyph + "No alerts this week — everything looks great!", shown
 * beneath the always-visible header so the panel is never a blank box (web `<EmptyState />` branch).
 */
@Composable
private fun AlertsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = AlertTriangleGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** First-load skeleton — a chart-shaped shimmer so the panel is never blank while the first fetch runs. */
@Composable
private fun AlertsLoading(label: String) {
    ChartBlockSkeleton(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
        height = LOADING_HEIGHT,
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun AlertsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered above the body when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun AlertsFreshnessRow(state: UiState<*>) {
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
            formatAge = rememberAlertsFreshnessFormatter(),
        )
    }
}

/** The slice/glyph color for a severity (web `STATUS_COLORS` + `CHART_COLORS` mapping), token-resolved. */
@Composable
private fun rememberAlertPalette(): AlertPalette =
    AlertPalette(
        critical = TeslaTokens.status.danger,
        warning = TeslaTokens.status.warning,
        info = paletteColor(0),
        other = paletteColor(INFO_FALLBACK_INDEX),
    )

/** The web count-badge variant ternary: critical → danger, warning → warning, everything else → info. */
private fun badgeVariant(kind: AlertSeverity): BadgeVariant =
    when (kind) {
        AlertSeverity.Critical -> BadgeVariant.Danger
        AlertSeverity.Warning -> BadgeVariant.Warning
        AlertSeverity.Info -> BadgeVariant.Info
        AlertSeverity.Other -> BadgeVariant.Info
    }

/** The per-severity glyph (web `AlertCircle` / `AlertTriangle` / `Info`); unknown severities render no icon. */
private fun severityGlyph(kind: AlertSeverity) =
    when (kind) {
        AlertSeverity.Critical -> AlertCircleGlyph
        AlertSeverity.Warning -> AlertTriangleGlyph
        AlertSeverity.Info -> InfoGlyph
        AlertSeverity.Other -> null
    }

/** The web `CHART_COLORS[4]` index used for the unknown-severity slice color. */
private const val INFO_FALLBACK_INDEX: Int = 4

/**
 * Builds the localized [AlertsSectionStrings] from the i18n catalog (P1/S10): the four
 * `analytics.weeklyDigest.*` keys the web component reads. Remembered against the resolved strings so a locale
 * change re-projects.
 */
@Composable
private fun rememberAlertsSectionStrings(): AlertsSectionStrings {
    val title = stringResource(R.string.translation_analytics_weeklyDigest_alertsSection)
    val bySeverity = stringResource(R.string.translation_analytics_weeklyDigest_alertsBySeverity)
    val distribution = stringResource(R.string.translation_analytics_weeklyDigest_alertDistribution)
    val noAlerts = stringResource(R.string.translation_analytics_weeklyDigest_noAlerts)
    return remember(title, bySeverity, distribution, noAlerts) {
        AlertsSectionStrings(title = title, bySeverity = bySeverity, distribution = distribution, noAlerts = noAlerts)
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberAlertsFreshnessFormatter(): (FreshnessAge) -> String {
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
    AlertsSectionStrings(
        title = "Alerts",
        bySeverity = "Alerts by Severity",
        distribution = "Alert Distribution",
        noAlerts = "No alerts this week \u2014 everything looks great!",
    )

private val PREVIEW_COUNTS =
    listOf(
        AlertSeverityCount(severity = "critical", count = 2),
        AlertSeverityCount(severity = "warning", count = 5),
        AlertSeverityCount(severity = "info", count = 3),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun AlertsSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertsSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun AlertsSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertsSectionContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun AlertsSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertsSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun AlertsSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertsSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_COUNTS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun AlertsSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertsSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_COUNTS,
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
