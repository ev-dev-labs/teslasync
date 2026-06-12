// The native Jetpack Compose + Material 3 charging `ChartsRow` feature view — a parity port of
// web/src/features/charging/components/charging-list/ChartsRow.tsx. The web component is purely
// presentational: it lays its three props into two `GlassPanel`s — an "Energy & Cost Trend" Recharts
// `AreaChart` (a filled energy area + a dashed cost line) and a "Charger Breakdown" donut `PieChart` beside a
// per-charger-type cost list (energy in kWh, total cost, and cost per kWh).
//
// This port keeps that composition end to end. It performs NO HTTP and binds no data hook of its own (its
// only web hook is `useTranslation`, mapped here to the i18n catalog). The host owns the charging feed
// (P1/S8) and supplies the three already-derived arrays as a [ChartsRowData] inside a [UiState], so this
// feature view renders every lifecycle state that layer can carry — loading, hard error with retry, empty,
// content, and stale/offline (cached "last known") — without ever fetching. A web-parity overload that
// takes the raw `energyTrend` / `chargerBreakdown` / `costByType` props is also provided for hosts that
// already hold them.
//
// Charts: the shared chart layer ships an area/line `ComboChart` (the Android counterpart of the web
// `AreaChart`) but no pie primitive (Vico 2.0 has none), so — exactly as the sibling `ChargingTab` /
// `ChargingBreakdownSlide` donuts do, and as the shared `RadialGauge` is a Canvas arc — the breakdown donut
// is drawn here as stroked `Canvas` arcs with one merged TalkBack description (the opaque canvas's
// screen-reader fallback, and the native equivalent of the web hover tooltip the donut relies on).
//
// Colors map to design tokens (never raw hex in render code). The trend reproduces the web's exact strokes
// via the tokens that carry those hexes: the energy area uses `chart.battery` (the `#10b981` of the web
// `stroke="#10b981"`) and the cost line uses `chart.energy` (the `#f59e0b` of the web `stroke="#f59e0b"`).
// The donut slices reproduce the web per-segment `fill` (CHARGER_COLORS) positionally through the categorical
// palette, consistent with the other native donut surfaces. The two header accents (web `text-neon-cyan`
// Calendar / `text-neon-purple` Plug) map to `chart.regen` (the `#06b6d4` cyan) and `chart.power` (the
// `#a855f7` purple); the glyphs are decorative (null content description), so the localized title carries
// the meaning for accessibility services.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChartsRow — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chartsrow

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
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

/** The trend plot height — between the web `h-40` (160 px) and `sm:h-52` (208 px). */
private val TREND_CHART_HEIGHT: Dp = 180.dp

/** The breakdown donut diameter — the web `h-36 w-36` (144 px) base size. */
private val DONUT_SIZE: Dp = 144.dp

/** Width past which the two panels sit side by side (the web `lg:grid-cols-2`); below it they stack. */
private val TWO_COLUMN_BREAKPOINT: Dp = 600.dp

/** Donut ring thickness as a fraction of the canvas — reproduces the web inner/outer-radius ring. */
private const val DONUT_THICKNESS_FRACTION: Float = 0.22f

/** Gap between donut slices in degrees — the web `paddingAngle={3}`. */
private const val DONUT_PADDING_DEGREES: Float = 3f

/** Donut start angle — top of the ring (12 o'clock), matching the web pie's top origin. */
private const val DONUT_START_DEGREES: Float = -90f

/** A full revolution in degrees. */
private const val FULL_CIRCLE_DEGREES: Float = 360f

/** Trend axis / tooltip fraction digits — a clean single decimal for the plot scale. */
private const val TREND_DECIMALS: Int = 1

/** Cost-by-type fraction digits — the web global precision (`fmtNumber` default = 2). */
private const val COST_DECIMALS: Int = 2

/** Donut share fraction digits — whole percents (web `(pct)%`). */
private const val PERCENT_DECIMALS: Int = 0

/** Em dash shown when a freshness age is unknown — the shared freshness fallback. */
private const val EM_DASH: String = "\u2014"

/** Series + legend keys — the web `<Area dataKey="energy" />` / `<Area dataKey="cost" />`. */
private const val ENERGY_KEY: String = "energy"
private const val COST_KEY: String = "cost"

/**
 * Stateful entry point for the charging `ChartsRow`. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared charging feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the three derived arrays (web props), bundled.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChartsRow(
    state: UiState<ChartsRowData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordChartsRowOpened(logger) }
    ChartsRowContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `energyTrend` / `chargerBreakdown` / `costByType` props,
 * for hosts that already hold the derived arrays. All-empty inputs render the empty state; any content
 * renders the panels. Records `view.opened` like the stateful entry. There is no fetch behind it, so it
 * offers no retry affordance.
 */
@Composable
fun ChartsRow(
    energyTrend: List<EnergyTrendPoint>,
    chargerBreakdown: List<ChargerBreakdownEntry>,
    costByType: List<CostByTypeEntry>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(energyTrend, chargerBreakdown, costByType) {
            val data = ChartsRowData(energyTrend, chargerBreakdown, costByType)
            val empty = energyTrend.isEmpty() && chargerBreakdown.isEmpty() && costByType.isEmpty()
            UiState(phase = if (empty) UiPhase.Empty else UiPhase.Content, data = data)
        }
    ChartsRow(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Projects the host feed's
 * [UiState] into the two-panel composition and drives each panel's body by its own lifecycle status
 * (loading skeleton / hard-error retry / no-data empty / ready). Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] formats the trend axis, donut percents, and cost rows.
 */
@Composable
fun ChartsRowContent(
    state: UiState<ChartsRowData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: ChartsRowStrings = rememberChartsRowStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters =
        remember(strings, locale) {
            ChartsRowFormatters(
                trendValue = { value -> ChartFormat.number(value, TREND_DECIMALS, locale) },
                energyText = { value -> ChartFormat.withUnit(value, strings.kWhUnit, COST_DECIMALS, locale) },
                costText = { value ->
                    "${strings.currencySymbol}${ChartFormat.number(value, COST_DECIMALS, locale)} ${strings.totalLabel}"
                },
                perKwhText = { value ->
                    "${strings.currencySymbol}${ChartFormat.number(value, COST_DECIMALS, locale)}/${strings.kWhUnit}"
                },
                percentText = { value -> "${ChartFormat.number(value, PERCENT_DECIMALS, locale)}%" },
            )
        }

    val result = remember(state.data, formatters) { ChartsRowProjection.project(state.data, formatters) }

    val trendStatus = panelStatus(state, result.isTrendEmpty)
    val breakdownStatus = panelStatus(state, result.isBreakdownEmpty && result.costRows.isEmpty())

    ResponsiveTwoColumn(
        modifier = modifier,
        first = {
            FadeIn(delayMs = TREND_FADE_MS) {
                ChartsRowPanel(
                    title = strings.trendTitle,
                    icon = ChartsRowGlyphs.Calendar,
                    iconTint = TeslaTokens.chart.regen,
                    status = trendStatus,
                    state = state,
                    strings = strings,
                    onRetry = onRetry,
                ) {
                    EnergyCostTrendBody(trend = result.trend, strings = strings, locale = locale)
                }
            }
        },
        second = {
            FadeIn(delayMs = BREAKDOWN_FADE_MS) {
                ChartsRowPanel(
                    title = strings.breakdownTitle,
                    icon = ChartsRowGlyphs.Plug,
                    iconTint = TeslaTokens.chart.power,
                    status = breakdownStatus,
                    state = state,
                    strings = strings,
                    onRetry = onRetry,
                ) {
                    ChargerBreakdownBody(
                        segments = result.segments,
                        costRows = result.costRows,
                        strings = strings,
                    )
                }
            }
        },
    )
}

/** The lifecycle a single panel body renders — the local analogue of the shared `ChartStatus`. */
private enum class PanelStatus { Loading, Error, Empty, Ready }

/** Maps the shared feed [state] + this panel's data emptiness onto its [PanelStatus]. */
private fun panelStatus(
    state: UiState<*>,
    isEmpty: Boolean,
): PanelStatus =
    when {
        state.isLoading -> PanelStatus.Loading
        state.isError -> PanelStatus.Error
        isEmpty -> PanelStatus.Empty
        else -> PanelStatus.Ready
    }

/**
 * One `GlassPanel` panel — the icon + localized [SectionTitle] header (with a freshness chip when the cached
 * data is refreshing / stale / offline) over a body that switches by [status]: a loading skeleton, an
 * error+retry surface, a friendly empty state, or the ready [content]. The section title is always shown so
 * no surface is hidden, mirroring the web (and the project's "never blank a panel" rule).
 */
@Composable
private fun ChartsRowPanel(
    title: String,
    icon: ImageVector,
    iconTint: Color,
    status: PanelStatus,
    state: UiState<*>,
    strings: ChartsRowStrings,
    onRetry: () -> Unit,
    content: @Composable () -> Unit,
) {
    val showFreshness = status == PanelStatus.Ready && (state.refreshing || state.stale || state.hasError)
    GlassPanel(padding = PanelPadding.Md, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = iconTint)
            SectionTitle(title, modifier = Modifier.weight(1f))
            if (showFreshness) ChartsRowFreshnessChip(state, strings)
        }
        when (status) {
            PanelStatus.Loading -> ChartsRowLoading()
            PanelStatus.Error ->
                ErrorDisplay(
                    message = strings.errorMessage,
                    modifier = Modifier.fillMaxWidth().height(TREND_CHART_HEIGHT),
                    onRetry = onRetry,
                    retryLabel = strings.retryLabel,
                )
            PanelStatus.Empty -> EmptyState(message = strings.noData, modifier = Modifier.fillMaxWidth())
            PanelStatus.Ready -> content()
        }
    }
}

/**
 * The "Energy & Cost Trend" body — the energy area + cost line over the session dates, the native analogue
 * of the web `AreaChart`. Wrapped in a merged-semantics box so TalkBack reads the localized title for the
 * opaque chart; a compact legend identifies the two series (the native at-a-glance equivalent of the web's
 * hover tooltip names).
 */
@Composable
private fun EnergyCostTrendBody(
    trend: ChartsRowTrend,
    strings: ChartsRowStrings,
    locale: Locale,
) {
    val energyColor = TeslaTokens.chart.battery
    val costColor = TeslaTokens.chart.energy
    val series =
        remember(trend.energy, trend.cost, strings.energySeriesLabel, strings.costSeriesLabel, energyColor, costColor) {
            listOf(
                ChartSeries(
                    key = ENERGY_KEY,
                    label = strings.energySeriesLabel,
                    values = trend.energy,
                    kind = ChartSeriesKind.Area,
                    color = energyColor,
                ),
                ChartSeries(
                    key = COST_KEY,
                    label = strings.costSeriesLabel,
                    values = trend.cost,
                    kind = ChartSeriesKind.Line,
                    color = costColor,
                ),
            )
        }
    val legend =
        remember(strings.energySeriesLabel, strings.costSeriesLabel, energyColor, costColor) {
            listOf(
                LegendEntry(key = ENERGY_KEY, label = strings.energySeriesLabel, color = energyColor),
                LegendEntry(key = COST_KEY, label = strings.costSeriesLabel, color = costColor),
            )
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Box(modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = strings.trendTitle }) {
            ComboChart(
                series = series,
                xLabels = trend.labels,
                height = TREND_CHART_HEIGHT,
                yValueFormatter = { value -> ChartFormat.number(value, TREND_DECIMALS, locale) },
                emptyMessage = strings.noData,
            )
        }
        ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * The "Charger Breakdown" body — the donut over the per-charger-type cost list, the native analogue of the
 * web donut `PieChart` + cost rows. The donut renders only when there are slices; the list renders only when
 * there are rows, so a partially-empty payload still shows what it has rather than a blank box.
 */
@Composable
private fun ChargerBreakdownBody(
    segments: List<ChargerSegment>,
    costRows: List<CostRow>,
    strings: ChartsRowStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (segments.isNotEmpty()) {
            val colors = remember(segments.size) { List(segments.size) { paletteColor(it) } }
            val description = remember(segments, strings.percentSuffix) { donutDescription(segments, strings) }
            ChartsRowDonut(
                segments = segments,
                colors = colors,
                contentDescription = description,
                modifier = Modifier.size(DONUT_SIZE),
            )
        }
        if (costRows.isNotEmpty()) {
            CostByTypeList(rows = costRows, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * The breakdown donut — a Compose `Canvas` of stroked arcs, one per slice, separated by a small padding gap
 * (web `paddingAngle`). Slice colors are positional (web per-segment `fill`). The whole ring exposes one
 * merged [contentDescription] for TalkBack, so the opaque canvas reads its breakdown instead of arcs.
 */
@Composable
private fun ChartsRowDonut(
    segments: List<ChargerSegment>,
    colors: List<Color>,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.clearAndSetSemantics { this.contentDescription = contentDescription }) {
        val thickness = size.minDimension * DONUT_THICKNESS_FRACTION
        val diameter = size.minDimension - thickness
        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
        val arcSize = Size(diameter, diameter)
        val gap = if (segments.size > 1) DONUT_PADDING_DEGREES else 0f
        var cursor = DONUT_START_DEGREES
        segments.forEachIndexed { index, segment ->
            val full = segment.fraction.toFloat() * FULL_CIRCLE_DEGREES
            val sweep = full - gap
            if (sweep > 0f) {
                drawArc(
                    color = colors[index % colors.size],
                    startAngle = cursor + gap / 2f,
                    sweepAngle = sweep,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = thickness, cap = StrokeCap.Butt),
                )
            }
            cursor += full
        }
    }
}

/**
 * The per-charger-type cost list — the web `costByType.map(...)` rows. Each row pairs the type name with its
 * energy on the top line and the total cost + cost-per-kWh on a muted bottom line, merged into one TalkBack
 * description so a screen reader reads the whole row at once.
 */
@Composable
private fun CostByTypeList(
    rows: List<CostRow>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        rows.forEach { row ->
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .semantics(mergeDescendants = true) {
                            contentDescription = "${row.name}, ${row.energyText}, ${row.costText}, ${row.perKwhText}"
                        },
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    BodyText(row.name)
                    BodyText(row.energyText)
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Caption(row.costText)
                    Caption(row.perKwhText)
                }
            }
        }
    }
}

/**
 * The freshness chip shown in a panel header when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun ChartsRowFreshnessChip(
    state: UiState<*>,
    strings: ChartsRowStrings,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = strings.loadingLabel,
        errorLabel = strings.offlineLabel,
        formatAge = rememberChartsRowFreshnessFormatter(),
    )
}

/** First-load skeleton chrome sized to the trend plot, so a panel is never blank while the first fetch runs. */
@Composable
private fun ChartsRowLoading() {
    Skeleton(modifier = Modifier.fillMaxWidth(), height = TREND_CHART_HEIGHT, rounded = true)
}

/** A two-column row past [TWO_COLUMN_BREAKPOINT], else a stacked column — the web `grid-cols-1 lg:grid-cols-2`. */
@Composable
private fun ResponsiveTwoColumn(
    modifier: Modifier,
    first: @Composable () -> Unit,
    second: @Composable () -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= TWO_COLUMN_BREAKPOINT) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Box(modifier = Modifier.weight(1f)) { first() }
                Box(modifier = Modifier.weight(1f)) { second() }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                first()
                second()
            }
        }
    }
}

/**
 * Builds the localized [ChartsRowStrings] from the i18n catalog (P1/S10): the two `charging.charts.*` titles
 * the web component resolves via `t(...)`, plus the unit/label/lifecycle microcopy this native port surfaces
 * (the web `fmtWithUnit` 'kWh' / `total` / `$` literals and the empty/error/retry/offline chrome). Remembered
 * against the resolved strings so a locale change re-projects.
 */
@Composable
fun rememberChartsRowStrings(): ChartsRowStrings {
    val trendTitle = stringResource(R.string.translation_charging_charts_energyCostTrend)
    val breakdownTitle = stringResource(R.string.translation_charging_charts_chargerBreakdown)
    val energyWord = stringResource(R.string.translation_common_energy)
    val costWord = stringResource(R.string.translation_common_cost)
    val kWhUnit = stringResource(R.string.translation_units_kwh)
    val totalLabel = stringResource(R.string.translation_fsm_total)
    val noData = stringResource(R.string.translation_chart_noData)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retryLabel = stringResource(R.string.translation_common_retry)
    val loadingLabel = stringResource(R.string.translation_common_loading)
    val offlineLabel = stringResource(R.string.translation_common_offline)
    return remember(
        trendTitle,
        breakdownTitle,
        energyWord,
        costWord,
        kWhUnit,
        totalLabel,
        noData,
        errorMessage,
        retryLabel,
        loadingLabel,
        offlineLabel,
    ) {
        ChartsRowStrings(
            trendTitle = trendTitle,
            breakdownTitle = breakdownTitle,
            energySeriesLabel = "$energyWord ($kWhUnit)",
            costSeriesLabel = "$costWord ($CHARTS_ROW_DEFAULT_CURRENCY)",
            kWhUnit = kWhUnit,
            totalLabel = totalLabel,
            currencySymbol = CHARTS_ROW_DEFAULT_CURRENCY,
            noData = noData,
            errorMessage = errorMessage,
            retryLabel = retryLabel,
            loadingLabel = loadingLabel,
            offlineLabel = offlineLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberChartsRowFreshnessFormatter(): (FreshnessAge) -> String {
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

/** The donut's merged TalkBack description, built from the projection helper + the localized percent suffix. */
private fun donutDescription(
    segments: List<ChargerSegment>,
    strings: ChartsRowStrings,
): String =
    ChartsRowProjection.donutDescription(segments) { percent ->
        "${percent.toInt()}${strings.percentSuffix}"
    }

/**
 * The already-localized microcopy the composable reads (P1/S10). The two titles map to the
 * `charging.charts.*` keys the web resolves; the rest carry the unit/label/lifecycle strings this native
 * port needs (kept out of the pure projection so it stays UI-free and testable).
 */
data class ChartsRowStrings(
    val trendTitle: String,
    val breakdownTitle: String,
    val energySeriesLabel: String,
    val costSeriesLabel: String,
    val kWhUnit: String,
    val totalLabel: String,
    val currencySymbol: String,
    val noData: String,
    val errorMessage: String,
    val retryLabel: String,
    val loadingLabel: String,
    val offlineLabel: String,
) {
    /** The percent sign appended to a donut share in the TalkBack description. */
    val percentSuffix: String get() = "%"
}

/** FadeIn entrance delays — the web `<FadeIn delay={0.1}>` / `delay={0.15}` (seconds → milliseconds). */
private const val TREND_FADE_MS: Int = 100
private const val BREAKDOWN_FADE_MS: Int = 150

/**
 * The two decorative header glyphs (web lucide `Calendar` / `Plug`), authored as 24×24 stroked vectors the
 * way the shared [io.teslasync.android.components.ui.TeslaGlyphs] set is — Android has no bundled lucide
 * equivalent. They are rendered decoratively (null content description), so the localized title carries the
 * meaning for accessibility services.
 */
private object ChartsRowGlyphs {
    /** A calendar: a body rectangle, a header divider, and two top binding ticks. */
    val Calendar: ImageVector =
        stroked("Calendar") {
            moveTo(4f, 5f)
            lineTo(20f, 5f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            moveTo(8f, 3f)
            lineTo(8f, 6f)
            moveTo(16f, 3f)
            lineTo(16f, 6f)
        }

    /** A plug: two top prongs, a trapezoidal body, and a short cord. */
    val Plug: ImageVector =
        stroked("Plug") {
            moveTo(9f, 2f)
            lineTo(9f, 7f)
            moveTo(15f, 2f)
            lineTo(15f, 7f)
            moveTo(7f, 7f)
            lineTo(17f, 7f)
            lineTo(16f, 13f)
            lineTo(8f, 13f)
            close()
            moveTo(12f, 13f)
            lineTo(12f, 21f)
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

private val PREVIEW_STRINGS =
    ChartsRowStrings(
        trendTitle = "Energy & Cost Trend",
        breakdownTitle = "Charger Breakdown",
        energySeriesLabel = "Energy (kWh)",
        costSeriesLabel = "Cost ($)",
        kWhUnit = "kWh",
        totalLabel = "total",
        currencySymbol = "$",
        noData = "No data available",
        errorMessage = "Something went wrong on our end. Please try again.",
        retryLabel = "Retry",
        loadingLabel = "Loading...",
        offlineLabel = "Offline",
    )

private val PREVIEW_DATA =
    ChartsRowData(
        energyTrend =
            listOf(
                EnergyTrendPoint("Apr 04", 48.0, 12.40),
                EnergyTrendPoint("Apr 06", 22.0, 9.10),
                EnergyTrendPoint("Apr 07", 18.0, 0.0),
            ),
        chargerBreakdown =
            listOf(
                ChargerBreakdownEntry("Supercharger", 6.0),
                ChargerBreakdownEntry("DC Fast", 3.0),
                ChargerBreakdownEntry("Home / AC", 9.0),
            ),
        costByType =
            listOf(
                CostByTypeEntry("Supercharger", 142.6, 38.20, 0.27),
                CostByTypeEntry("Home / AC", 88.4, 11.90, 0.13),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChartsRowLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartsRowContent(state = UiState(UiPhase.Loading), onRetry = {}, locale = Locale.US, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ChartsRowEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartsRowContent(
            state = UiState(UiPhase.Empty, data = ChartsRowData()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChartsRowErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartsRowContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ChartsRowContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartsRowContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ChartsRowOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartsRowContent(
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
