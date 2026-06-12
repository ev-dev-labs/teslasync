// The native Jetpack Compose + Material 3 Session Comparison charging-curve feature view — a parity port of
// web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx. The web component is purely
// presentational: inside a `<FadeIn delay={0.15}>` it wraps the shared `<ChartContainer>` (title / subtitle /
// aria fallback) around a Recharts `<LineChart>` that overlays up to ten power-vs-SOC `<Line>`s (one per
// recent session, brand-palette colored) plus a custom legend of date swatches below the plot.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hooks are `useTranslation`, mapped to the i18n catalog, and `useChartPalette`, mapped to the shared
// chart palette via [paletteColor]). The host supplies the sessions through the shared P1/S8 state-holder
// layer as a [UiState] (the cache-then-network projection of the charging feed), so this feature view renders
// every lifecycle state that layer can carry — loading, hard error with retry, empty, content, and
// stale/offline (cached "last known") — without ever fetching. The native [ChartContainer] +
// [LineChartWrapper] + [ChartLegend] + [FadeIn] are the faithful counterparts of the web shared components; a
// web-parity overload that takes the raw `sessions` prop is also provided for hosts that already hold the list.
//
// Two web `t(key, default)` keys (`charging.curve.sessionComparisonDesc` and `...sessionComparison.aria`) are
// absent from the auto-generated catalog (they live only as inline defaults in web/src/i18n/en.json), so they
// are resolved by name with the reproduced default (ADR-014 — the drift-checked catalog is never hand-edited),
// mirroring the `ByteSizeConverter` surface. The web `exportable` affordance maps to the shared
// `ChartExportMenu`, whose image/CSV capture + file IO is a shared-layer concern owned outside this surface
// prompt (no sibling chart wires it), so the menu stays hidden until that capability is provided. The chart is
// annotated `chart-a11y:no-table` in the web source (a dense ten-curve overlay), so — matching that intent —
// no fallback data table is attached; the localized aria description carries the screen-reader summary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SessionComparisonChart — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessioncomparisonchart

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/** The web `<ChartContainer height={300}>` / `<ResponsiveContainer height={300}>` plot height. */
private val CHART_HEIGHT: Dp = 300.dp

/** The web `<FadeIn delay={0.15}>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 150

/** Power-axis tick precision — the web tooltip's one-decimal power values. */
private const val POWER_DECIMALS: Int = 1

/** The web `<Line unit=" kW">` series unit, surfaced in the accessible summary. */
private const val POWER_UNIT: String = " kW"

/**
 * Stateful entry point for the session-comparison curve. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared charging feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `ChargingSession[]` (web `sessions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SessionComparisonChart(
    state: UiState<List<ChargingCurveSession>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSessionComparisonChartOpened(logger) }
    SessionComparisonChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `sessions: ChargingSession[]` prop, for hosts that already
 * hold the loaded list. An empty list renders the empty state, a non-empty list renders the overlay (web
 * `comparisonData` ternary). Records `view.opened` like the stateful entry. There is no fetch behind it, so it
 * offers no retry affordance.
 */
@Composable
fun SessionComparisonChart(
    sessions: List<ChargingCurveSession>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(sessions) {
            val items = sessions ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    SessionComparisonChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the overlaid
 * [LineChartWrapper] in the ready state, reproducing the web `ChartContainer` + `LineChart` composition: a
 * localized title/subtitle, the aria description, the `Power (kW)` / `SOC (%)` axis titles, and the date-swatch
 * legend. A freshness chip appears when the cached data is refreshing / stale / offline; stale (non-error)
 * data auto-refreshes, mirroring the web freshness contract. [locale]/[zoneId] format the dates, SOC labels,
 * and power values.
 */
@Composable
fun SessionComparisonChartContent(
    state: UiState<List<ChargingCurveSession>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: SessionComparisonChartStrings = rememberSessionComparisonChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale, zoneId, strings) {
            SessionComparisonChartProjection.project(
                sessions = state.data ?: emptyList(),
                chargerLabel = strings::chargerLabel,
                formatDate = { iso -> SessionDateFormatting.format(iso, zoneId, locale) },
                formatSoc = { soc -> SessionComparisonChartProjection.formatSoc(soc, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val series =
        remember(result.series) {
            result.series.map { line ->
                ChartSeries(
                    key = line.key,
                    label = line.seriesLabel,
                    values = line.values,
                    kind = ChartSeriesKind.Line,
                    color = paletteColor(line.colorIndex),
                    unit = POWER_UNIT,
                )
            }
        }
    val legend =
        remember(result.series) {
            result.series.map { line ->
                LegendEntry(key = line.key, label = line.legendLabel, color = paletteColor(line.colorIndex))
            }
        }

    val emptyMessage = stringResource(R.string.translation_charging_curve_empty)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        ChartContainer(
            title = strings.title,
            subtitle = strings.subtitle,
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { SessionFreshnessChip(state) }
                } else {
                    null
                },
            accessibleDescription = strings.ariaLabel,
            emptyMessage = emptyMessage,
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retryLabel = stringResource(R.string.translation_common_retry),
            onRetry = onRetry,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Caption(strings.powerAxisLabel)
                LineChartWrapper(
                    series = series,
                    xLabels = result.xLabels,
                    height = CHART_HEIGHT,
                    yValueFormatter = { value -> ChartFormat.number(value, POWER_DECIMALS, locale) },
                    emptyMessage = emptyMessage,
                )
                Caption(strings.socAxisLabel, modifier = Modifier.align(Alignment.CenterHorizontally))
                ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' freshness
 * contract; carries no English literal.
 */
@Composable
private fun SessionFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSessionFreshnessFormatter(),
    )
}

/**
 * Builds the localized [SessionComparisonChartStrings] from the i18n catalog (P1/S10): the title / axis titles
 * / charger labels read directly, and the subtitle + aria resolved by name with the reproduced web default
 * (their keys are catalog-absent). Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberSessionComparisonChartStrings(): SessionComparisonChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_charging_curve_sessionComparison)
    val powerAxis = stringResource(R.string.translation_charging_curve_powerKw)
    val socAxis = stringResource(R.string.translation_charging_curve_socPercent)
    val supercharger = stringResource(R.string.translation_charging_chargerTypes_supercharger)
    val dcFast = stringResource(R.string.translation_charging_chargerTypes_dc)
    val homeAc = stringResource(R.string.translation_charging_chargerTypes_home)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val subtitle = resolveOptional(lookup, KEY_SUBTITLE, SessionComparisonChartDefaults.SUBTITLE)
    val ariaLabel = resolveOptional(lookup, KEY_ARIA_LABEL, SessionComparisonChartDefaults.ARIA_LABEL)
    return remember(title, subtitle, ariaLabel, powerAxis, socAxis, supercharger, dcFast, homeAc) {
        SessionComparisonChartStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            powerAxisLabel = powerAxis,
            socAxisLabel = socAxis,
            superchargerLabel = supercharger,
            dcFastLabel = dcFast,
            homeAcLabel = homeAc,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSessionFreshnessFormatter(): (FreshnessAge) -> String {
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
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SessionComparisonChartStrings(
        title = "Session Comparison",
        subtitle = "Power curves overlaid from last 10 sessions",
        ariaLabel = "Overlaid power-vs-SOC line chart comparing the last several charging sessions",
        powerAxisLabel = "Power (kW)",
        socAxisLabel = "SOC (%)",
        superchargerLabel = "Supercharger",
        dcFastLabel = "DC Fast",
        homeAcLabel = "Home / AC",
    )

private val PREVIEW_SESSIONS =
    listOf(
        ChargingCurveSession(
            id = 1,
            startedAt = "2026-04-02T18:00:00Z",
            chargerType = "Tesla",
            peakPowerW = 250_000.0,
            startSocPct = 10.0,
            endSocPct = 90.0,
        ),
        ChargingCurveSession(
            id = 2,
            startedAt = "2026-04-03T07:30:00Z",
            chargerType = null,
            peakPowerW = 11_000.0,
            startSocPct = 40.0,
            endSocPct = 80.0,
        ),
        ChargingCurveSession(
            id = 3,
            startedAt = "2026-04-04T21:15:00Z",
            chargerType = "CCS",
            peakPowerW = 150_000.0,
            startSocPct = 20.0,
            endSocPct = 100.0,
        ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SessionComparisonChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionComparisonChartContent(
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
private fun SessionComparisonChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionComparisonChartContent(
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
private fun SessionComparisonChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionComparisonChartContent(
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
private fun SessionComparisonChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionComparisonChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_SESSIONS),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SessionComparisonChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionComparisonChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SESSIONS,
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
