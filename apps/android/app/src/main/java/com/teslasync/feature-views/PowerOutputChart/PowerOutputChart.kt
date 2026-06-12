// The native Jetpack Compose + Material 3 Power Output History chart feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx. The web component is purely
// presentational: inside a `<FadeIn delay={0.3}>` it wraps the shared `<ChartContainer height={300}>` around
// a Recharts `<AreaChart>` of two per-drive traces — Peak power (violet `#8b5cf6`) and Regen power (red
// `#ef4444`) — with a zero baseline `<ReferenceLine y={0}>`, a `kW` value-axis label, and an interactive
// `<ChartLegend state={hidden} />` whose click-to-hide toggles each `<Area hide={hidden.isHidden(key)} />`.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog (P1/S10), `useHiddenSeries('drivetrain-power-output')` →
// [rememberChartLegendState] (the native counterpart documented on `ChartLegendState`: the web persists the
// hidden set in URL state, the native equivalent is `rememberSaveable`). The host supplies the loaded
// `ChartDataPoint[]` through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network
// projection of the drivetrain-health drives), so this feature view renders every lifecycle state that layer
// can carry — loading, hard error with retry, empty, content, and stale/offline (cached "last known") —
// without ever fetching. The native [ChartContainer] + [AreaChartWrapper] + interactive [ChartLegend] are the
// faithful counterparts of the web `ChartContainer` + `AreaChart` + `ChartLegend`. A web-parity overload that
// takes the raw `ChartDataPoint[]` prop is also provided.
//
// The web `if (data.length <= 1) return null` guard becomes the EMPTY surface here, not a hidden/blank panel:
// a feature view must render every state (P3 states contract; the sibling PowerProfileChart applies the same
// `length > 1` boundary → empty). So 0 or 1 drive renders the friendly empty state, 2+ render the two areas.
//
// Colors map to design tokens (never raw hex in render code): Peak power (web violet `#8b5cf6`) →
// `TeslaTokens.chart.power` (#A855F7 — hue + semantic "power" match), Regen power (web red `#ef4444`) →
// `TeslaTokens.chart.temperature` (#EF4444 — the palette's canonical red, an exact-hex match chosen for hue
// parity with the web regen trace; there is no red-tinted "regen" token, and the cyan `chart.regen` would
// break the web's red regen area). The web amber/red intent is preserved while light/dark theming keeps
// working.
//
// The web `<ReferenceLine y={0}>` (the drive↔regen zero baseline) has no counterpart slot in the shared
// cartesian renderer, and feature views must not alter that shared layer (allowed-files); the Vico value axis
// auto-scales across zero, so the regen samples still read below the positive peaks without a fabricated
// overlay — the same shared-renderer adaptation the sibling drive-detail charts document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PowerOutputChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.poweroutputchart

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.rememberChartLegendState
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ChartContainer height={300}>` plot height. */
private val CHART_HEIGHT: Dp = 300.dp

/** Area/legend series keys — the web `<Area dataKey="powerMax" />` / `<Area dataKey="powerMin" />`. */
private const val PEAK_KEY: String = "powerMax"
private const val REGEN_KEY: String = "powerMin"

/** The fixed value-axis unit — the web `<YAxis label={{ value: 'kW' }} />` and the series tooltip suffix. */
private const val POWER_UNIT: String = "kW"

/** Entrance stagger — the web `<FadeIn delay={0.3}>` (0.3 s). */
private const val FADE_DELAY_MS: Int = 300

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Power Output History chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared drivetrain-health feed can carry. The
 * host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `ChartDataPoint[]` (web `data`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PowerOutputChart(
    state: UiState<List<PowerOutputPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordPowerOutputChartOpened(logger) }
    PowerOutputChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `data: ChartDataPoint[]` prop, for hosts that already
 * hold the loaded list. The web `data.length <= 1` boundary is reproduced: 0 or 1 drive renders the empty
 * state, 2+ render the two areas. Records `view.opened` like the stateful entry; with no fetch behind it, it
 * offers no retry affordance.
 */
@Composable
fun PowerOutputChart(
    data: List<PowerOutputPoint>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            val items = data ?: emptyList()
            val phase = if (items.size >= MIN_RENDERABLE_POINTS) UiPhase.Content else UiPhase.Empty
            UiState(phase = phase, data = items)
        }
    PowerOutputChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready), and in the ready state renders
 * the two-area [AreaChartWrapper] inside a [FadeIn], with an interactive [ChartLegend] whose click-to-hide is
 * backed by [rememberChartLegendState] (the web `useHiddenSeries`) and fed back to the chart as
 * `hiddenKeys` — reproducing the web `FadeIn` + `ChartContainer` + `AreaChart` + `ChartLegend` composition. A
 * freshness chip appears when cached data is refreshing / stale / offline, and stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [locale] formats the kW table cells + value-axis
 * ticks.
 */
@Composable
fun PowerOutputChartContent(
    state: UiState<List<PowerOutputPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: PowerOutputChartStrings = rememberPowerOutputChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale) {
            PowerOutputChartProjection.project(
                points = state.data ?: emptyList(),
                formatValue = { kw -> PowerOutputChartProjection.formatKw(kw, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // The two areas resolve to design tokens — the native analogue of the web `stroke="#8b5cf6"` (Peak) and
    // `stroke="#ef4444"` (Regen). See the file header for the token-mapping rationale.
    val peakColor = TeslaTokens.chart.power
    val regenColor = TeslaTokens.chart.temperature

    val series =
        remember(result.peakValues, result.regenValues, strings.peakSeriesLabel, strings.regenSeriesLabel, peakColor, regenColor) {
            listOf(
                ChartSeries(
                    key = PEAK_KEY,
                    label = strings.peakSeriesLabel,
                    values = result.peakValues,
                    kind = ChartSeriesKind.Area,
                    color = peakColor,
                    unit = POWER_UNIT,
                ),
                ChartSeries(
                    key = REGEN_KEY,
                    label = strings.regenSeriesLabel,
                    values = result.regenValues,
                    kind = ChartSeriesKind.Area,
                    color = regenColor,
                    unit = POWER_UNIT,
                ),
            )
        }

    // URL-persisted hidden-series state in the web (`useHiddenSeries('drivetrain-power-output')`); the native
    // equivalent is rememberSaveable-backed, surviving config changes + process death. Its hidden set both
    // dims the tapped legend chip and is fed to the chart as `hiddenKeys`, so click-to-hide declutters to one
    // trace exactly as the web `<Area hide={hidden.isHidden(key)} />`.
    val legendState = rememberChartLegendState()

    val legend =
        remember(strings.peakSeriesLabel, strings.regenSeriesLabel, peakColor, regenColor) {
            listOf(
                LegendEntry(key = PEAK_KEY, label = strings.peakSeriesLabel, color = peakColor),
                LegendEntry(key = REGEN_KEY, label = strings.regenSeriesLabel, color = regenColor),
            )
        }

    val emptyMessage = stringResource(R.string.translation_chart_noData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        ChartContainer(
            title = strings.title,
            subtitle = strings.subtitle,
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { PowerOutputFreshnessChip(state) }
                } else {
                    null
                },
            accessibleDescription = strings.ariaLabel,
            dataTableHeader = listOf(strings.dateColumn, strings.peakColumn, strings.regenColumn),
            dataTableRows = result.tableRows,
            dataTableLabel = stringResource(R.string.translation_Details),
            emptyMessage = emptyMessage,
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retryLabel = stringResource(R.string.translation_common_retry),
            onRetry = onRetry,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                // The web rotated `<YAxis label="kW" />`; Vico has no axis-title slot, so the unit is surfaced
                // as a caption above the plot — keeping the value-axis unit on screen (sibling adaptation).
                Caption(POWER_UNIT)
                AreaChartWrapper(
                    series = series,
                    xLabels = result.dates,
                    height = CHART_HEIGHT,
                    hiddenKeys = legendState.hidden,
                    yValueFormatter = { value -> PowerOutputChartProjection.formatKw(value, locale) },
                    emptyMessage = emptyMessage,
                )
                ChartLegend(entries = legend, state = legendState, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces'
 * freshness contract; carries no English literal.
 */
@Composable
private fun PowerOutputFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberPowerOutputFreshnessFormatter(),
    )
}

/**
 * Builds the localized [PowerOutputChartStrings] from the i18n catalog (P1/S10): the visible title /
 * subtitle / column / series keys resolve through compile-time resources; the aria description resolves
 * by-name with the web `t(key, default)` fallback, since the catalog defines no key for it. Remembered
 * against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberPowerOutputChartStrings(): PowerOutputChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_drivetrain_powerOutput)
    val subtitle = stringResource(R.string.translation_drivetrain_powerOutputSub)
    val ariaLabel = resolveOptional({ context.optionalString(it) }, KEY_ARIA, PowerOutputChartDefaults.ARIA_LABEL)
    val dateColumn = stringResource(R.string.translation_drivetrain_col_date)
    val peakColumn = stringResource(R.string.translation_drivetrain_col_powerMax)
    val regenColumn = stringResource(R.string.translation_drivetrain_col_powerMin)
    val peakSeriesLabel = stringResource(R.string.translation_drivetrain_powerMax)
    val regenSeriesLabel = stringResource(R.string.translation_drivetrain_powerMin)
    return remember(title, subtitle, ariaLabel, dateColumn, peakColumn, regenColumn, peakSeriesLabel, regenSeriesLabel) {
        PowerOutputChartStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            dateColumn = dateColumn,
            peakColumn = peakColumn,
            regenColumn = regenColumn,
            peakSeriesLabel = peakSeriesLabel,
            regenSeriesLabel = regenSeriesLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberPowerOutputFreshnessFormatter(): (FreshnessAge) -> String {
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
    PowerOutputChartStrings(
        title = "Power Output History",
        subtitle = "Peak and regen power per drive over time",
        ariaLabel = "Per-drive peak and regen motor power output history area chart",
        dateColumn = "Date",
        peakColumn = "Peak (kW)",
        regenColumn = "Regen (kW)",
        peakSeriesLabel = "Peak Power (kW)",
        regenSeriesLabel = "Regen Power (kW)",
    )

private val PREVIEW_POINTS =
    listOf(
        PowerOutputPoint(date = "Feb 04", powerMax = 211.4, powerMin = -64.2),
        PowerOutputPoint(date = "Feb 11", powerMax = 188.0, powerMin = -52.7),
        PowerOutputPoint(date = "Feb 18", powerMax = 233.9, powerMin = -71.0),
        PowerOutputPoint(date = "Feb 25", powerMax = 176.5, powerMin = -48.3),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun PowerOutputChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerOutputChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun PowerOutputChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerOutputChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun PowerOutputChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerOutputChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun PowerOutputChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerOutputChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun PowerOutputChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerOutputChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_POINTS,
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
