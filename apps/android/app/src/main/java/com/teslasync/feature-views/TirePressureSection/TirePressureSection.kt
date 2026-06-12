// The native Jetpack Compose + Material 3 Tire Pressure feature view — a parity port of
// web/src/features/driving/components/drive-detail/TirePressureSection.tsx. The web component is purely
// presentational: inside a `<FadeIn>` it wraps the shared `<ChartContainer title="Tire Pressure During Drive"
// height={310}>` around — when `stats.hasTirePressure` — a four-column grid of per-wheel min/max tiles
// (Front/Rear × Left/Right) plus a Recharts `<LineChart>` of the four (conditional) per-wheel pressure lines;
// otherwise the container shows its "No telemetry data available" empty state.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog (P1/S10) and `useUnits` → the live [UnitFormatter]
// (P1/S8) for the pressure unit label + locale + precision. The host supplies the per-sample trace through
// the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the selected
// drive's `chartData`), so this feature view renders every lifecycle state that layer can carry — loading,
// hard error with retry, empty, content, and stale/offline (cached "last known") — without ever fetching. A
// web-parity overload that takes the raw `chartData` prop is also provided. The web component uses no synced
// cursor / `<ReferenceLine>` (unlike the Drive Overview chart), so this port deliberately adds no marker rail.
//
// Colors map to the generated CB-safe categorical palette (never raw hex in render code): FL → `paletteColor(0)`,
// FR → `1`, RL → `2`, RR → `3`. The web component picks its own per-wheel hex literals (`#3b82f6` … `#ef4444`);
// reproducing those verbatim would reintroduce raw hex into component code (forbidden) and bypass light/dark
// theming, so — as the sibling surfaces do — each wheel takes a distinct, color-blind-safe categorical slot
// shared by its tile value and its plotted line so the two always agree. Following the web's deliberate
// `chart-a11y:no-table` choice, the dense per-sample trace exposes no data table; the min/max per-wheel tiles
// above the chart carry the screen-reader-honest figures and the chart carries an accessible description.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TirePressureSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressuresection

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.PressureUnitPref
import java.util.Locale

/** The web `<ChartContainer height={310}>` body height (used by the loading / error / empty states). */
private val CHART_HEIGHT: Dp = 310.dp

/** The web `<ResponsiveContainer height={220}>` line-chart plot height inside the container. */
private val PLOT_HEIGHT: Dp = 220.dp

/** Y-axis tick precision — the web `<YAxis>` renders whole pressure values. */
private const val AXIS_DECIMALS: Int = 0

/** Series keys — the web `<Line dataKey="tireFl" />` … keys, one per wheel. */
private const val FL_KEY: String = "tireFl"
private const val FR_KEY: String = "tireFr"
private const val RL_KEY: String = "tireRl"
private const val RR_KEY: String = "tireRr"

/**
 * The per-wheel series-name abbreviations the web hard-codes in each `<Line name={`FL (${unit})`} />` (the web
 * source uses these literal symbols directly, with no `t()` call — they are axis-style abbreviations, not
 * translatable prose; the full localized wheel names appear in the tiles). Reproduced verbatim so the chart
 * legend reads identically to the web.
 */
private const val FL_ABBREV: String = "FL"
private const val FR_ABBREV: String = "FR"
private const val RL_ABBREV: String = "RL"
private const val RR_ABBREV: String = "RR"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the keys the web
 * component resolves via `t(...)`: the panel [title] (`driveDetail.tirePressure`), the four wheel labels
 * ([frontLeft]/[frontRight]/[rearLeft]/[rearRight]), and the accessible chart description ([ariaLabel],
 * catalog-absent ⇒ the web English fallback). Lifecycle-chrome strings (empty / error / retry / offline /
 * freshness) are resolved inline at the Compose boundary.
 */
data class TirePressureSectionStrings(
    val title: String,
    val frontLeft: String,
    val frontRight: String,
    val rearLeft: String,
    val rearRight: String,
    val ariaLabel: String,
)

/**
 * Stateful entry point for the Tire Pressure section. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the live pressure unit (web `useUnits`) from the shared [UnitFormatter], and renders every
 * lifecycle [state] the shared drive-trace feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `ChartDataPoint[]` (web `chartData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TirePressureSection(
    state: UiState<List<TirePressurePoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordTirePressureSectionOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    TirePressureSectionContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        pressureUnit = formatter.prefs.pressure.label,
        locale = localeOf(formatter.prefs.locale),
        precision = formatter.prefs.precision ?: TirePressureFormat.DEFAULT_PRECISION,
    )
}

/**
 * Web-parity overload mirroring the web component's `chartData: ChartDataPoint[]` prop, for hosts that already
 * hold the loaded trace. The web `stats.hasTirePressure` boundary is reproduced from the trace itself (the web
 * `hasTirePressure` is `some(d => d.tireFl !== null || …)`): a trace with any non-null wheel sample renders the
 * tiles + chart, one without renders the empty state. Records `view.opened` like the stateful entry; with no
 * fetch behind it, it offers no retry affordance.
 */
@Composable
fun TirePressureSection(
    chartData: List<TirePressurePoint>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(chartData) {
            val items = chartData ?: emptyList()
            val hasTirePressure =
                items.any {
                    it.frontLeft != null || it.frontRight != null || it.rearLeft != null || it.rearRight != null
                }
            val phase = if (hasTirePressure) UiPhase.Content else UiPhase.Empty
            UiState(phase = phase, data = items)
        }
    TirePressureSection(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready), and in the ready state renders
 * the four per-wheel min/max tiles followed by the [ComboChart] of the present per-wheel pressure lines inside
 * a [FadeIn] — reproducing the web `FadeIn` + `ChartContainer` + tile grid + `LineChart` composition. A
 * freshness chip appears when cached data is refreshing / stale / offline, and stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [pressureUnit]/[locale]/[precision] are the web
 * `useUnits` outputs the tiles format with.
 */
@Composable
fun TirePressureSectionContent(
    state: UiState<List<TirePressurePoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    pressureUnit: String = PressureUnitPref.BAR.label,
    locale: Locale = Locale.getDefault(),
    precision: Int = TirePressureFormat.DEFAULT_PRECISION,
    strings: TirePressureSectionStrings = rememberTirePressureSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters =
        remember(pressureUnit, locale, precision) {
            TirePressureFormatters(
                number = { TirePressureFormat.number(it, precision, locale) },
                pressureUnit = pressureUnit,
            )
        }

    val result =
        remember(state.data, formatters) {
            TirePressureSectionProjection.project(state.data ?: emptyList(), formatters)
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val series =
        remember(result, pressureUnit) {
            buildTireSeries(result, pressureUnit)
        }

    val emptyMessage = stringResource(R.string.translation_driveDetail_noChartData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier) {
        ChartContainer(
            title = strings.title,
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { TirePressureFreshnessChip(state) }
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
                TirePressureTiles(tiles = result.tiles, strings = strings, modifier = Modifier.fillMaxWidth())
                ComboChart(
                    series = series,
                    xLabels = result.xLabels,
                    height = PLOT_HEIGHT,
                    yValueFormatter = { value -> TirePressureFormat.number(value, AXIS_DECIMALS, locale) },
                    emptyMessage = emptyMessage,
                )
            }
        }
    }
}

/**
 * Builds the present per-wheel line [ChartSeries] from the projection — the native analogue of the web four
 * conditional `<Line>`s. Each wheel is included only when its value column survived the projection's
 * `some(d => d[key] !== null)` presence guard. Series names carry the web `FL (unit)` abbreviation + unit, and
 * colors take the per-wheel categorical slot shared with the tile value.
 */
private fun buildTireSeries(
    result: TirePressureSectionProjectionResult,
    pressureUnit: String,
): List<ChartSeries> =
    buildList {
        result.frontLeftValues?.let { add(lineSeries(FL_KEY, FL_ABBREV, it, TireWheelId.FrontLeft, pressureUnit)) }
        result.frontRightValues?.let { add(lineSeries(FR_KEY, FR_ABBREV, it, TireWheelId.FrontRight, pressureUnit)) }
        result.rearLeftValues?.let { add(lineSeries(RL_KEY, RL_ABBREV, it, TireWheelId.RearLeft, pressureUnit)) }
        result.rearRightValues?.let { add(lineSeries(RR_KEY, RR_ABBREV, it, TireWheelId.RearRight, pressureUnit)) }
    }

/** Builds one line [ChartSeries] (web `<Line>`) named `"$abbrev ($unit)"` with the per-wheel categorical color. */
private fun lineSeries(
    key: String,
    abbrev: String,
    values: List<Double?>,
    id: TireWheelId,
    unit: String,
): ChartSeries =
    ChartSeries(
        key = key,
        label = "$abbrev ($unit)",
        values = values,
        kind = ChartSeriesKind.Line,
        color = tireWheelColor(id),
        unit = unit,
    )

/**
 * The four per-wheel min/max tiles — the native counterpart of the web `grid grid-cols-4` tile row. Each tile
 * shows the localized wheel label and the formatted min–max value (or `'—'`) in the wheel's color, and is
 * exposed to TalkBack as one grouped, self-describing node so the dense per-wheel summary reads as a unit.
 */
@Composable
private fun TirePressureTiles(
    tiles: List<TireWheelTile>,
    strings: TirePressureSectionStrings,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        tiles.forEach { tile ->
            TireTile(
                label = wheelLabel(tile.id, strings),
                value = tile.value,
                color = tireWheelColor(tile.id),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** A single wheel tile: the web `rounded-lg ... text-center` div with a muted label and a bold colored value. */
@Composable
private fun TireTile(
    label: String,
    value: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "$label. $value" },
        padding = CardPadding.Sm,
    ) {
        MetricLabel(label, modifier = Modifier.align(Alignment.CenterHorizontally))
        Heading(
            text = value,
            level = HeadingLevel.Sub,
            color = color,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        )
    }
}

/** The categorical-palette slot for each wheel — the native stand-in for the web per-wheel hex literals. */
private fun tireWheelColorIndex(id: TireWheelId): Int =
    when (id) {
        TireWheelId.FrontLeft -> 0
        TireWheelId.FrontRight -> 1
        TireWheelId.RearLeft -> 2
        TireWheelId.RearRight -> 3
    }

/** Resolves the generated CB-safe categorical color for [id]; shared by the tile value and the plotted line. */
private fun tireWheelColor(id: TireWheelId): Color = paletteColor(tireWheelColorIndex(id))

/** Maps a wheel id to its localized tile label — the web `t('driveDetail.frontLeft', …)` strings. */
private fun wheelLabel(
    id: TireWheelId,
    strings: TirePressureSectionStrings,
): String =
    when (id) {
        TireWheelId.FrontLeft -> strings.frontLeft
        TireWheelId.FrontRight -> strings.frontRight
        TireWheelId.RearLeft -> strings.rearLeft
        TireWheelId.RearRight -> strings.rearRight
    }

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' freshness
 * contract; carries no English literal.
 */
@Composable
private fun TirePressureFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberTirePressureFreshnessFormatter(),
    )
}

/**
 * Builds the localized [TirePressureSectionStrings] from the i18n catalog (P1/S10): the title + four wheel
 * labels resolve through compile-time resources; the aria description resolves by-name with the web
 * `t(key, default)` fallback, since the catalog defines no key for it. Remembered against the resolved strings
 * so a locale change re-projects.
 */
@Composable
private fun rememberTirePressureSectionStrings(): TirePressureSectionStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_driveDetail_tirePressure)
    val frontLeft = stringResource(R.string.translation_driveDetail_frontLeft)
    val frontRight = stringResource(R.string.translation_driveDetail_frontRight)
    val rearLeft = stringResource(R.string.translation_driveDetail_rearLeft)
    val rearRight = stringResource(R.string.translation_driveDetail_rearRight)
    val ariaLabel = resolveOptional({ context.optionalString(it) }, KEY_ARIA, TirePressureSectionDefaults.ARIA_LABEL)
    return remember(title, frontLeft, frontRight, rearLeft, rearRight, ariaLabel) {
        TirePressureSectionStrings(
            title = title,
            frontLeft = frontLeft,
            frontRight = frontRight,
            rearLeft = rearLeft,
            rearRight = rearRight,
            ariaLabel = ariaLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberTirePressureFreshnessFormatter(): (FreshnessAge) -> String {
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
    TirePressureSectionStrings(
        title = "Tire Pressure During Drive",
        frontLeft = "Front Left",
        frontRight = "Front Right",
        rearLeft = "Rear Left",
        rearRight = "Rear Right",
        ariaLabel = "Front and rear tire pressure lines over the drive timeline",
    )

private val PREVIEW_POINTS =
    listOf(
        TirePressurePoint("09:00", frontLeft = 42.0, frontRight = 42.5, rearLeft = 41.0, rearRight = 41.5),
        TirePressurePoint("09:05", frontLeft = 42.5, frontRight = 43.0, rearLeft = 41.5, rearRight = 42.0),
        TirePressurePoint("09:10", frontLeft = 43.0, frontRight = 43.5, rearLeft = 42.0, rearRight = 42.5),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TirePressureSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            pressureUnit = "psi",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TirePressureSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            pressureUnit = "psi",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TirePressureSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            pressureUnit = "psi",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun TirePressureSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            pressureUnit = "psi",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
