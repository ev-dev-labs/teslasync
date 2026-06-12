// The native Jetpack Compose + Material 3 Motor Torque history chart feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx. The web component is purely
// presentational: inside a `<FadeIn delay={0.24}>` it wraps the shared `<ChartContainer title="Motor Torque"
// subtitle="…" height={280}>` (which also renders a `data`/`dataColumns` accessible table) around a Recharts
// `<AreaChart>` of the single per-sample `torque` trace (cyan, with a zero baseline `<ReferenceLine y={0}>`),
// returning nothing unless there is more than one sample AND at least one non-null torque reading.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its only
// web hook is `useTranslation` (mapped to the i18n catalog, P1/S10). The host supplies the loaded
// `MotorChartDataPoint[]` (the `time` + `torque` subset) through the shared P1/S8 state-holder layer as a
// [UiState], so this feature view renders every lifecycle state that layer can carry — loading, hard error
// with retry, empty, content, and stale/offline (cached "last known") — without ever fetching. The native
// [ChartContainer] + [AreaChartWrapper] are the faithful counterparts of the web `ChartContainer` +
// `AreaChart`, and the web `FadeIn delay={0.24}` maps to [FadeIn] with a 240 ms delay. A web-parity overload
// that takes the raw `data` prop is also provided.
//
// Color: the web `stroke="#00f0ff"` / `<ChartGradient color="#00f0ff">` neon cyan resolves to the nearest
// brand chart token, `TeslaTokens.chart.regen` (the brand cyan `#06b6d4` — the same token the sibling
// `TemperatureTrendChart` binds its `#06b6d4` trace to). Feature views must never embed raw hex in render
// code (engineering guidelines), so the web's cyan intent is preserved through the token while light/dark
// theming keeps working. An explicit color is required: a lone series with a `null` color would resolve to
// palette position 0, not the cyan the web pins.
//
// The web `<ReferenceLine y={0}>` (the drive↔regen torque zero baseline) has no counterpart slot in the
// shared cartesian renderer, and feature views must not alter that shared layer (allowed-files); the Vico
// value axis auto-scales across zero, so negative (regen) torque still reads below the positive samples
// without a fabricated overlay. This is the same shared-renderer adaptation the sibling drive charts
// document. The web `<Legend />` is the shared wrapper's concern (it labels the single series `Torque (Nm)`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TorqueHistoryChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.torquehistorychart

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ChartContainer height={280}>` plot height. */
private val CHART_HEIGHT: Dp = 280.dp

/** Series key — the web `<Area dataKey="torque" />`. */
private const val TORQUE_KEY: String = "torque"

/** Entry-animation delay — the web `<FadeIn delay={0.24}>` (0.24 s → 240 ms). */
private const val FADE_DELAY_MS: Int = 240

/** Torque axis fraction digits: Nm reads as whole numbers, matching the sibling integer-axis charts. */
private const val AXIS_DECIMALS: Int = 0

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Motor Torque history chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the live locale (web `useTranslation`) from the shared [UnitFormatter] so
 * the value axis groups in the user's locale, and renders every lifecycle [state] the shared drivetrain feed
 * can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never
 * performs HTTP.
 *
 * @param state the cache-then-network projection of the `MotorChartDataPoint[]` torque trace (web `data`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TorqueHistoryChart(
    state: UiState<List<TorqueHistoryPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordTorqueHistoryChartOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    TorqueHistoryChartContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        locale = localeOf(formatter.prefs.locale),
    )
}

/**
 * Web-parity overload mirroring the web component's `{ data }` prop, for hosts that already hold the loaded
 * trace. The web content boundary is reproduced: a series of 0 or 1 samples, or one with no non-null torque
 * reading, renders the empty state (the web `return null`, surfaced honestly); 2+ samples with a reading
 * render the area chart. Records `view.opened` like the stateful entry; with no fetch behind it, it offers no
 * retry affordance.
 */
@Composable
fun TorqueHistoryChart(
    data: List<TorqueHistoryPoint>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data) { TorqueHistoryChartProjection.projectUiState(data) }
    TorqueHistoryChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Maps the host feed's
 * [UiState] onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and, in the ready
 * state, renders the single-area [AreaChartWrapper] inside a [FadeIn] — reproducing the web `FadeIn` +
 * `ChartContainer` + `AreaChart` composition: a localized title + subtitle, a cyan torque area over the
 * `time` X axis, an Nm value axis, a `Torque (Nm)` series name, the accessible chart description + fallback
 * data table (`Time` / `Torque (Nm)`), the no-data empty message, and a freshness chip when the cached data
 * is refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the web freshness
 * contract. [locale] formats the value axis.
 */
@Composable
fun TorqueHistoryChartContent(
    state: UiState<List<TorqueHistoryPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: TorqueHistoryChartStrings = rememberTorqueHistoryChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data) {
            TorqueHistoryChartProjection.project(state.data ?: emptyList())
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // The single torque area color — the native analogue of the web `stroke="#00f0ff"`. The nearest brand
    // chart token is the cyan `regen` (the same token the sibling temperature trace uses); an explicit color
    // is required so the lone series does not fall back to palette position 0.
    val torqueColor = TeslaTokens.chart.regen
    val seriesLabel = "${strings.torque} ($TORQUE_UNIT)"
    val series =
        remember(result.torqueValues, seriesLabel, torqueColor) {
            listOf(
                ChartSeries(
                    key = TORQUE_KEY,
                    label = seriesLabel,
                    values = result.torqueValues,
                    kind = ChartSeriesKind.Area,
                    color = torqueColor,
                    unit = TORQUE_UNIT,
                ),
            )
        }

    val emptyMessage = stringResource(R.string.translation_driveDetail_noChartData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        ChartContainer(
            title = strings.title,
            subtitle = strings.subtitle,
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { TorqueHistoryFreshnessChip(state) }
                } else {
                    null
                },
            accessibleDescription = strings.accessibleDescription,
            dataTableHeader = listOf(strings.timeColumn, strings.torqueColumn),
            dataTableRows = result.tableRows,
            dataTableLabel = stringResource(R.string.translation_Details),
            emptyMessage = emptyMessage,
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retryLabel = stringResource(R.string.translation_common_retry),
            onRetry = onRetry,
        ) {
            AreaChartWrapper(
                series = series,
                xLabels = result.times,
                height = CHART_HEIGHT,
                yValueFormatter = { value -> ChartFormat.number(value, AXIS_DECIMALS, locale) },
                emptyMessage = emptyMessage,
            )
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun TorqueHistoryFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberTorqueHistoryFreshnessFormatter(),
    )
}

/**
 * Builds the localized [TorqueHistoryChartStrings] from the i18n catalog (P1/S10): the title, subtitle,
 * series word, and the two table-column headers resolve through compile-time resources; the aria description
 * resolves by-name with the web `t(key, default)` fallback, since the catalog defines no key for it.
 * Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberTorqueHistoryChartStrings(): TorqueHistoryChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_drivetrain_torqueHistory)
    val subtitle = stringResource(R.string.translation_drivetrain_torqueHistorySub)
    val torque = stringResource(R.string.translation_drivetrain_torque)
    val timeColumn = stringResource(R.string.translation_drivetrain_col_time)
    val torqueColumn = stringResource(R.string.translation_drivetrain_col_torque)
    val accessibleDescription =
        resolveOptional({ context.optionalString(it) }, KEY_ARIA, TorqueHistoryChartDefaults.ARIA_LABEL)
    return remember(title, subtitle, torque, timeColumn, torqueColumn, accessibleDescription) {
        TorqueHistoryChartStrings(
            title = title,
            subtitle = subtitle,
            torque = torque,
            timeColumn = timeColumn,
            torqueColumn = torqueColumn,
            accessibleDescription = accessibleDescription,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberTorqueHistoryFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Builds a [Locale] from a BCP-47 [tag]; null/blank ⇒ the device default (web `deriveLocale` fallback). */
private fun localeOf(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.getDefault() else Locale.forLanguageTag(tag)

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
    TorqueHistoryChartStrings(
        title = "Motor Torque",
        subtitle = "Drive inverter torque output over time",
        torque = "Torque",
        timeColumn = "Time",
        torqueColumn = "Torque (Nm)",
        accessibleDescription = "Motor inverter torque output history area chart",
    )

private val PREVIEW_POINTS =
    listOf(
        TorqueHistoryPoint("09:00", 120.0),
        TorqueHistoryPoint("09:05", 340.0),
        TorqueHistoryPoint("09:10", -90.0),
        TorqueHistoryPoint("09:15", 210.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TorqueHistoryChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TorqueHistoryChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TorqueHistoryChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TorqueHistoryChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TorqueHistoryChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TorqueHistoryChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun TorqueHistoryChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TorqueHistoryChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun TorqueHistoryChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TorqueHistoryChartContent(
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
