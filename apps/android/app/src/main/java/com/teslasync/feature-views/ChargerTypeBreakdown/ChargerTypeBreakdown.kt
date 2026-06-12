// The native Jetpack Compose + Material 3 ChargerTypeBreakdown feature view — a parity port of
// web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx. The web component is a
// presentational `GlassPanel`: a "Cost by Charger Type" title (with a yellow ⚡ Zap icon), then, when there is
// data, a two-column body — a donut `<PieChart>` of the per-charger cost share on one side and a per-charger
// breakdown on the other (a legend of colored name chips, then for each charger a "{cost} · {sessions}
// sessions" line, a share progress bar, and a "{energy} kWh / {cost/kWh} / {pct}%" footer) — or a centered
// "Not enough data" empty state.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog, and `useFormatting`, mapped to the shared P1/S8
// settings holder for the currency symbol). The host supplies the charger rows + lifetime total through the
// shared state-holder layer as a [UiState], so this feature view renders every lifecycle state that layer can
// carry — loading, hard error with retry, empty, content, and stale/offline ("last known") — without ever
// fetching. A web-parity overload that takes the raw `data` + `totalCost` props is also provided for hosts
// that already hold the loaded value. Every value derivation flows through the pure
// [ChargerTypeBreakdownProjection]; the composable is a thin render layer.
//
// Colors map to design tokens (never raw hex in render code), reproducing the web `CHARGER_COLORS[name] ??
// CHART_COLORS[4]` resolution exactly: Supercharger → `chart.temperature` (the web `#ef4444`), Public DC →
// `chart.power` (`#a855f7`), Work / L2 → `chart.energy` (`#f59e0b`), Home → `chart.battery` (`#10b981`), and
// any other category → `paletteColor(4)` (the Okabe-Ito `#56B4E9` categorical fallback). The donut is drawn
// with Compose Canvas arcs (the same primitive the shared `RadialGauge` uses); feature views must not import
// the shared chart engine (Vico) directly and the shared chart layer ships no donut, so the ring is a local
// Canvas — never a raw chart-library import — while the legend reuses the shared `ChartLegend`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargerTypeBreakdown — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargertypebreakdown

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Layout geometry (web Tailwind / Recharts values, reproduced) ─────────────────────────────────────

/** The donut box — square, sized to hold the web `outerRadius={100}` ring with breathing room. */
private val DONUT_SIZE: Dp = 200.dp

/** Mid-ring radius the arcs are stroked along (within the web inner 60 / outer 100 band). */
private val DONUT_RING_RADIUS: Dp = 72.dp

/** Ring thickness — the web `outerRadius - innerRadius` (100 − 60), kept proportional to the box. */
private val DONUT_RING_THICKNESS: Dp = 36.dp

/** Donut sweep origin: 12 o'clock, so the first (largest) slice grows clockwise from the top. */
private const val DONUT_START_ANGLE: Float = -90f

/** Web `paddingAngle={3}` — the degrees of gap inserted between adjacent slices. */
private const val DONUT_PADDING_ANGLE: Float = 3f

/** A full revolution in degrees. */
private const val FULL_SWEEP: Float = 360f

/** Faint full-ring track drawn behind the slices so the donut never reads as blank (all-zero costs). */
private const val TRACK_ALPHA: Float = 0.2f

/** Web `h-2` share bar height. */
private val BAR_HEIGHT: Dp = 8.dp

/** Okabe-Ito categorical index for the fallback charger color — the web `CHART_COLORS[4]` (`#56B4E9`). */
private const val FALLBACK_PALETTE_INDEX: Int = 4

/** Percent scale for the bar fraction — the web `width: ${pct}%`. */
private const val PERCENT_SCALE_FLOAT: Float = 100f

/** Number of breakdown skeleton bars drawn beneath the donut skeleton while loading. */
private const val LOADING_ROW_COUNT: Int = 3

/** Loading skeleton bar heights. */
private val LOADING_DONUT_HEIGHT: Dp = 120.dp
private val LOADING_BAR_HEIGHT: Dp = 14.dp
private val LOADING_SUBBAR_HEIGHT: Dp = 10.dp
private const val LOADING_SUBBAR_FRACTION: Float = 0.5f

/**
 * Stateful entry point for the charger-type breakdown. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), binds the currency symbol from the shared settings holder (P1/S8, web `useFormatting`), and
 * renders every lifecycle [state] the host feed can carry. The host owns the feed and supplies [onRetry] (the
 * feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the charger rows + lifetime total (web `data` + `totalCost`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargerTypeBreakdown(
    state: UiState<ChargerTypeBreakdownInput>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ChargerTypeBreakdownDiagnostics.recordViewOpened(logger) }
    ChargerTypeBreakdownContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        currency = rememberChargerCurrencySettings(),
    )
}

/**
 * Web-parity overload mirroring the web component's `data: ChargerTypeData[]` + `totalCost` props, for hosts
 * that already hold the loaded value. An empty list renders the empty state (web `data.length === 0`), a
 * non-empty list renders the donut + breakdown. Records `view.opened` like the stateful entry. There is no
 * fetch behind it, so it offers no retry affordance.
 */
@Composable
fun ChargerTypeBreakdown(
    data: List<ChargerTypeDatum>,
    totalCost: Double,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data, totalCost) {
            val phase = if (data.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = ChargerTypeBreakdownInput(data = data, totalCost = totalCost))
        }
    ChargerTypeBreakdown(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Wraps the web
 * `GlassPanel`: the title header (⚡ icon + "Cost by Charger Type" + a freshness chip when cached data is
 * refreshing / stale / offline) over the state body — a loading skeleton, a hard-error retry surface, the
 * friendly "Not enough data" empty state, or the populated donut + legend + breakdown. Stale (non-error) data
 * auto-refreshes, mirroring the freshness contract. [locale] formats the costs, counts, energy, and shares;
 * [currency] supplies the symbol (web `useFormatting`).
 */
@Composable
fun ChargerTypeBreakdownContent(
    state: UiState<ChargerTypeBreakdownInput>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    currency: ChargerCurrencySettings = ChargerCurrencySettings.DEFAULT,
    strings: ChargerTypeBreakdownStrings = rememberChargerTypeBreakdownStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters =
        remember(currency, locale) {
            ChargerTypeBreakdownFormatters(
                currency = { amount, decimals -> "${currency.resolvedSymbol}${ChartFormat.number(amount, decimals, locale)}" },
                count = { value -> String.format(locale, "%,d", value) },
                energy = { kwh -> ChartFormat.withUnit(kwh, KWH_UNIT, ENERGY_DECIMALS, locale) },
                percent = { value -> ChartFormat.number(value, PERCENT_DECIMALS, locale) },
            )
        }

    val result =
        remember(state.data, formatters, strings.sessions) {
            ChargerTypeBreakdownProjection.project(
                data = state.data?.data ?: emptyList(),
                totalCost = state.data?.totalCost ?: 0.0,
                formatters = formatters,
                sessionsLabel = strings.sessions,
            )
        }

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        if (state.isError) {
            ChargerTypeBreakdownError(state = state, resourceName = strings.title, onRetry = onRetry)
        } else {
            ChargerTypeBreakdownHeader(state = state, strings = strings)
            when {
                state.isLoading -> ChargerTypeBreakdownLoading(label = stringResource(R.string.translation_a11y_loading))
                result.isEmpty -> ChargerTypeBreakdownEmpty(strings = strings)
                else -> ChargerTypeBreakdownBody(rows = result.rows, title = strings.title)
            }
        }
    }
}

/**
 * The panel header — the web `<h3>` with the yellow ⚡ icon + title, plus the freshness chip when cached data
 * is refreshing / stale / offline. The icon is decorative (the title carries the meaning); the title is marked
 * as a heading for TalkBack navigation.
 */
@Composable
private fun ChargerTypeBreakdownHeader(
    state: UiState<*>,
    strings: ChargerTypeBreakdownStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(bottom = Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = ChargerTypeBreakdownGlyphs.Zap,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.warning,
        )
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        if (shouldShowFreshness(state)) {
            ChargerFreshnessChip(state)
        }
    }
}

/**
 * The populated body — the donut of per-charger cost share, the legend of colored name chips (web's wrapping
 * dot+name row), and the per-charger breakdown rows. The web `lg:grid-cols-2` two-column layout collapses to
 * this single stacked column on a phone (web mobile `grid-cols-1`).
 */
@Composable
private fun ChargerTypeBreakdownBody(
    rows: List<ChargerTypeBreakdownRow>,
    title: String,
    modifier: Modifier = Modifier,
) {
    val colorByRole = rememberChargerRoleColors()
    val colors = remember(rows, colorByRole) { rows.map { colorByRole.getValue(it.colorRole) } }
    val legendEntries =
        remember(rows, colorByRole) {
            rows.map { LegendEntry(key = it.name, label = it.name, color = colorByRole.getValue(it.colorRole)) }
        }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            ChargerDonut(rows = rows, colors = colors, contentDescription = donutDescription(rows = rows, title = title))
        }
        ChartLegend(entries = legendEntries, modifier = Modifier.fillMaxWidth())
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            rows.forEachIndexed { index, row ->
                ChargerBreakdownRowView(row = row, color = colors[index])
            }
        }
    }
}

/**
 * The donut ring — the native counterpart of the web `<PieChart><Pie innerRadius={60} outerRadius={100}
 * paddingAngle={3} dataKey="cost">`. A faint full-ring track is drawn first (so the ring is never blank), then
 * each slice is a stroked Canvas arc whose sweep is proportional to its cost share (web `<Pie dataKey="cost">`);
 * a small gap between slices reproduces the web `paddingAngle`. The whole ring exposes one combined
 * [contentDescription] so TalkBack reads the breakdown instead of decorative arcs.
 */
@Composable
private fun ChargerDonut(
    rows: List<ChargerTypeBreakdownRow>,
    colors: List<Color>,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val trackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = TRACK_ALPHA)
    val gap = if (rows.size > 1) DONUT_PADDING_ANGLE else 0f
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
        drawArc(
            color = trackColor,
            startAngle = 0f,
            sweepAngle = FULL_SWEEP,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(width = strokePx, cap = StrokeCap.Butt),
        )
        var startAngle = DONUT_START_ANGLE
        rows.forEachIndexed { index, row ->
            val sweep = (row.pieFraction * FULL_SWEEP).toFloat()
            drawArc(
                color = colors[index % colors.size],
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
 * One breakdown row — the web per-entry block: the name + "{cost} · {sessions} sessions" line, the share
 * progress bar (a track with a colored fill at the share width), and the "{energy} kWh / {cost/kWh} / {pct}%"
 * footer. The whole row carries one combined [ChargerTypeBreakdownRow.accessibilityText] so TalkBack reads it
 * as a single coherent statistic rather than five disjoint fragments.
 */
@Composable
private fun ChargerBreakdownRowView(
    row: ChargerTypeBreakdownRow,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = row.accessibilityText },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = row.name,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = row.costSessionsText,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth(fraction = (row.pct.toFloat() / PERCENT_SCALE_FLOAT).coerceIn(0f, 1f))
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(color),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Caption(row.energyText)
            Caption(row.rateText)
            Caption(row.percentText)
        }
    }
}

/** The loading skeleton — the title header is already shown; this fills the body so the panel is never blank. */
@Composable
private fun ChargerTypeBreakdownLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = 1f, height = LOADING_DONUT_HEIGHT, rounded = true)
        repeat(LOADING_ROW_COUNT) {
            Skeleton(height = LOADING_BAR_HEIGHT)
            Skeleton(widthFraction = LOADING_SUBBAR_FRACTION, height = LOADING_SUBBAR_HEIGHT)
        }
    }
}

/** The hard-error surface — a classified [QueryError] with a retry affordance (web `ErrorDisplay`/`QueryError`). */
@Composable
private fun ChargerTypeBreakdownError(
    state: UiState<*>,
    resourceName: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    QueryError(
        kind = breakdownErrorKind(state.errorKind, state.httpStatus),
        modifier = modifier,
        resourceName = resourceName,
        onRetry = onRetry,
    )
}

/** The friendly empty state — the web centered "Not enough data" (`costAnalysis.charts.noData`). */
@Composable
private fun ChargerTypeBreakdownEmpty(
    strings: ChargerTypeBreakdownStrings,
    modifier: Modifier = Modifier,
) {
    EmptyState(message = strings.noData, modifier = modifier, icon = ChargerTypeBreakdownGlyphs.Zap)
}

/**
 * The freshness chip rendered in the header when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun ChargerFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberFreshnessFormatter(),
    )
}

// ── Render-boundary helpers ──────────────────────────────────────────────────────────────────────────

/** True when the header freshness chip should show: cached data refreshing / stale / offline, not loading. */
private fun shouldShowFreshness(state: UiState<*>): Boolean = !state.isLoading && (state.refreshing || state.stale || state.hasError)

/**
 * Resolves each [ChargerColorRole] to its design-token color (P1/S9), reproducing the web `CHARGER_COLORS`
 * hues exactly: Supercharger → `chart.temperature`, Public DC → `chart.power`, Work / L2 → `chart.energy`,
 * Home → `chart.battery`, and the fallback → `paletteColor(4)`. All token reads here are theme-invariant, so
 * the map is computed once and reused for the donut, the legend, and the bars.
 */
@Composable
private fun rememberChargerRoleColors(): Map<ChargerColorRole, Color> =
    remember {
        mapOf(
            ChargerColorRole.Supercharger to TeslaTokens.chart.temperature,
            ChargerColorRole.PublicDc to TeslaTokens.chart.power,
            ChargerColorRole.WorkL2 to TeslaTokens.chart.energy,
            ChargerColorRole.Home to TeslaTokens.chart.battery,
            ChargerColorRole.Fallback to paletteColor(FALLBACK_PALETTE_INDEX),
        )
    }

/** The combined donut description for TalkBack — the localized title plus each charger's name and share. */
private fun donutDescription(
    rows: List<ChargerTypeBreakdownRow>,
    title: String,
): String = "$title. " + rows.joinToString(separator = ", ") { "${it.name} ${it.percentText}" }

/** Maps the host's [ErrorKind] + HTTP status onto the shared [QueryErrorKind] taxonomy (offline-aware). */
private fun breakdownErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

/**
 * Builds the localized [ChargerTypeBreakdownStrings] from the i18n catalog (P1/S10): the title, the "sessions"
 * unit noun, and the "Not enough data" empty message the web component resolves via `t(...)`. Remembered
 * against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberChargerTypeBreakdownStrings(): ChargerTypeBreakdownStrings {
    val title = stringResource(R.string.translation_costAnalysis_chargerType_title)
    val sessions = stringResource(R.string.translation_costAnalysis_chargerType_sessions)
    val noData = stringResource(R.string.translation_costAnalysis_charts_noData)
    return remember(title, sessions, noData) {
        ChargerTypeBreakdownStrings(title = title, sessions = sessions, noData = noData)
    }
}

/**
 * Binds the currency symbol from the shared settings holder (P1/S8) — the native analogue of the web
 * `useFormatting` reading `useSettings`. Collects the `SettingsStore` feed lifecycle-aware and derives the
 * symbol from the cached `/settings` document; falls back to "$" before settings load.
 */
@Composable
private fun rememberChargerCurrencySettings(): ChargerCurrencySettings {
    val container = LocalDataContainer.current
    val settingsFlow = remember(container) { container.settingsStore.settings() }
    val resource by settingsFlow.collectAsStateWithLifecycle()
    return remember(resource.cached) { ChargerCurrencySettings.from(resource.cached) }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
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
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the three
 * `costAnalysis.*` strings the web component resolves via `t(...)`. The lifecycle-chrome strings (loading /
 * retry / offline / freshness) are resolved inline at the Compose boundary, so this stays a thin carrier.
 */
data class ChargerTypeBreakdownStrings(
    val title: String,
    val sessions: String,
    val noData: String,
)

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Recolored at render time by the [Icon] tint.
 */
private object ChargerTypeBreakdownGlyphs {
    /** Lightning bolt — the header + empty-state icon (web lucide `Zap`). */
    val Zap: ImageVector =
        breakdownVector("ChargerTypeBreakdownZap") {
            moveTo(13f, 2f)
            lineTo(4f, 14f)
            lineTo(11f, 14f)
            lineTo(10f, 22f)
            lineTo(20f, 9f)
            lineTo(13f, 9f)
            close()
        }
}

private fun breakdownVector(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ─────────────────────────

private val PREVIEW_STRINGS =
    ChargerTypeBreakdownStrings(
        title = "Cost by Charger Type",
        sessions = "sessions",
        noData = "Not enough data",
    )

private val PREVIEW_INPUT =
    ChargerTypeBreakdownInput(
        data =
            listOf(
                ChargerTypeDatum(name = "Supercharger", cost = 182.45, energyKwh = 612.3, sessions = 24),
                ChargerTypeDatum(name = "Home", cost = 96.10, energyKwh = 740.0, sessions = 58),
                ChargerTypeDatum(name = "Public DC", cost = 41.20, energyKwh = 121.5, sessions = 6),
                ChargerTypeDatum(name = "Work / L2", cost = 0.0, energyKwh = 88.0, sessions = 9),
            ),
        totalCost = 319.75,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChargerTypeBreakdownLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeBreakdownContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ChargerTypeBreakdownEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeBreakdownContent(
            state = UiState(UiPhase.Empty, data = ChargerTypeBreakdownInput(emptyList(), 0.0)),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChargerTypeBreakdownErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeBreakdownContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ChargerTypeBreakdownContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeBreakdownContent(
            state = UiState(UiPhase.Content, data = PREVIEW_INPUT),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ChargerTypeBreakdownOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargerTypeBreakdownContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_INPUT,
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
