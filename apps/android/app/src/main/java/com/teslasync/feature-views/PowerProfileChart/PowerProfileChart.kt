// The native Jetpack Compose + Material 3 Power Profile chart feature view — a parity port of
// web/src/features/driving/components/drive-detail/PowerProfileChart.tsx. The web component is purely
// presentational: inside a `<FadeIn>` it wraps the shared `<ChartContainer title="Power Profile"
// height={220}>` around a Recharts `<AreaChart>` of the single per-sample `power` trace (amber, with a
// zero baseline `<ReferenceLine y={0}>` and a synced-cursor `<ReferenceLine x>`), then — only when there is
// more than one sample — renders a Max Power / Max Regen / Avg footer beneath it.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog, `useSyncedCursor`/`useSyncedReferenceLineX` →
// [cursorSyncPosition] over the shared [CursorSyncStore], surfaced as a marker rail (the native counterpart
// of the web `<ReferenceLine x={syncedX}>`). The host supplies the loaded trace + derived stats through the
// shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the selected drive's
// `{ chartData, stats }`), so this feature view renders every lifecycle state that layer can carry —
// loading, hard error with retry, empty, content, and stale/offline (cached "last known") — without ever
// fetching. The native [ChartContainer] + [AreaChartWrapper] + the footer are the faithful counterparts of
// the web `ChartContainer` + `AreaChart` + the summary `<div>`. A web-parity overload that takes the raw
// `{ chartData, stats }` payload is also provided.
//
// Colors map to design tokens (never raw hex in render code): the power area + the Max Power figure →
// `TeslaTokens.chart.energy` (the exact web `#f59e0b` amber, and the same token the sibling DriveStatCards /
// DrivingPerformanceCards bind their MaxPower / PeakPower cards to), the Max Regen figure →
// `TeslaTokens.chart.regen` (the web cyan `text-cyan-400`), and Avg → the neutral on-surface color (the web
// `text-[var(--text-primary)]`). The web's amber/cyan/primary intent is preserved while light/dark theming
// keeps working.
//
// The web `<ReferenceLine y={0}>` (the drive↔regen zero baseline) has no counterpart slot in the shared
// cartesian renderer, and feature views must not alter that shared layer (allowed-files); the Vico value
// axis auto-scales across zero, so the regen samples still read below the positive ones without a fabricated
// overlay. This is the same shared-renderer adaptation the sibling drive-detail charts document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PowerProfileChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.powerprofilechart

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
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
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.cursorSyncPosition
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ChartContainer height={220}>` plot height. */
private val CHART_HEIGHT: Dp = 220.dp

/** Series key — the web `<Area dataKey="power" />`. */
private const val POWER_KEY: String = "power"

/** The web `<Area name={`${t('driveDetail.power')} kW`}>` series-name unit suffix + the footer `kW`. */
private const val POWER_UNIT: String = "kW"

/**
 * The page-scoped cursor `syncId` — the web `<ChartTimeRangeProvider syncId="drive-detail">` that
 * `useSyncedCursor`/`useSyncedReferenceLineX` read. When this chart is hosted next to the other drive
 * detail charts under the same id, the shared [CursorSyncStore] mirrors the hovered sample here as a marker.
 */
private const val DEFAULT_SYNC_ID: String = "drive-detail"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the keys the
 * web component resolves via `t(...)`: the panel [title] (`driveDetail.powerProfile`), the [power] series
 * label (`driveDetail.power`), and the accessible chart description ([ariaLabel], catalog-absent ⇒ the web
 * English fallback). The footer stat labels and lifecycle chrome (empty / error / retry / offline /
 * freshness) are resolved inline at the Compose boundary.
 */
data class PowerProfileChartStrings(
    val title: String,
    val power: String,
    val ariaLabel: String,
)

/**
 * Stateful entry point for the Power Profile chart. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the live locale + precision (web `useUnits` / `numberFormat`) from the shared
 * [UnitFormatter], and renders every lifecycle [state] the shared drive feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `{ chartData, stats }` (web props).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param syncId the page cursor-sync id (web `useSyncedCursor`); `null` disables the synced marker.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PowerProfileChart(
    state: UiState<PowerProfileData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordPowerProfileChartOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    PowerProfileChartContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        syncId = syncId,
        locale = localeOf(formatter.prefs.locale),
        precision = formatter.prefs.precision ?: PowerProfileFormat.DEFAULT_PRECISION,
    )
}

/**
 * Web-parity overload mirroring the web component's `{ chartData, stats }` props, for hosts that already
 * hold the loaded payload. The web `chartData.length > 1` boundary is reproduced: 0 or 1 samples render the
 * empty state, 2+ render the area chart + footer. Records `view.opened` like the stateful entry; with no
 * fetch behind it, it offers no retry affordance.
 */
@Composable
fun PowerProfileChart(
    data: PowerProfileData?,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            val value = data ?: PowerProfileData.from(emptyList())
            val phase = if (value.points.size > 1) UiPhase.Content else UiPhase.Empty
            UiState(phase = phase, data = value)
        }
    PowerProfileChart(state = state, onRetry = {}, modifier = modifier, syncId = syncId, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready), and in the ready state
 * renders the single-area [AreaChartWrapper] inside a [FadeIn], followed by the Max Power / Max Regen / Avg
 * footer — reproducing the web `FadeIn` + `ChartContainer` + `AreaChart` + summary composition. A freshness
 * chip appears when cached data is refreshing / stale / offline, and stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale]/[precision] are the web `useUnits`/`numberFormat` inputs
 * the footer formats with.
 */
@Composable
fun PowerProfileChartContent(
    state: UiState<PowerProfileData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    locale: Locale = Locale.getDefault(),
    precision: Int = PowerProfileFormat.DEFAULT_PRECISION,
    strings: PowerProfileChartStrings = rememberPowerProfileChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val formatters =
        remember(locale, precision) {
            PowerProfileFormatters(
                integer = { PowerProfileFormat.integer(it, locale) },
                number = { PowerProfileFormat.number(it, precision, locale) },
                powerUnit = POWER_UNIT,
            )
        }

    val result =
        remember(state.data, formatters) {
            PowerProfileChartProjection.project(state.data ?: PowerProfileData.from(emptyList()), formatters)
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val powerColor = TeslaTokens.chart.energy
    val series =
        remember(result.powerValues, strings.power, powerColor) {
            listOf(
                ChartSeries(
                    key = POWER_KEY,
                    label = "${strings.power} $POWER_UNIT",
                    values = result.powerValues,
                    kind = ChartSeriesKind.Area,
                    color = powerColor,
                    unit = POWER_UNIT,
                ),
            )
        }

    val syncedIndex = cursorSyncPosition(syncId)
    val markers =
        remember(syncedIndex, result.xLabels) {
            val index = syncedIndex
            if (index != null && index in result.xLabels.indices) {
                listOf(
                    ChartVerticalMarker(
                        index = index,
                        label = result.xLabels[index],
                        severity = MarkerSeverity.Info,
                    ),
                )
            } else {
                emptyList()
            }
        }

    val emptyMessage = stringResource(R.string.translation_driveDetail_noChartData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
    val footer = result.footer

    FadeIn(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ChartContainer(
                title = strings.title,
                status = status,
                height = CHART_HEIGHT,
                action =
                    if (showFreshness) {
                        { PowerProfileFreshnessChip(state) }
                    } else {
                        null
                    },
                accessibleDescription = strings.ariaLabel,
                emptyMessage = emptyMessage,
                errorMessage = stringResource(R.string.translation_error_serverError_message),
                retryLabel = stringResource(R.string.translation_common_retry),
                onRetry = onRetry,
            ) {
                AreaChartWrapper(
                    series = series,
                    xLabels = result.xLabels,
                    height = CHART_HEIGHT,
                    markers = markers,
                    yValueFormatter = { value -> PowerProfileFormat.integer(value, locale) },
                    emptyMessage = emptyMessage,
                )
            }
            if (status == ChartStatus.Ready && footer != null) {
                PowerProfileFooter(footer = footer, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * The Max Power / Max Regen / Avg footer rendered below the chart — the native counterpart of the web
 * summary `<div>`. Each figure is a grouped, self-describing TalkBack node (`"label: value"`) so the dense
 * stat row reads as discrete units. Wraps like the web `flex` row. Colors bind to the design tokens: Max
 * Power → amber, Max Regen → cyan, Avg → on-surface (the web amber-400 / cyan-400 / text-primary).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PowerProfileFooter(
    footer: PowerProfileFooterData,
    modifier: Modifier = Modifier,
) {
    val maxPowerLabel = stringResource(R.string.translation_driveDetail_maxPower)
    val maxRegenLabel = stringResource(R.string.translation_driveDetail_maxRegen)
    val avgLabel = stringResource(R.string.translation_driveDetail_avgLabel)
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        PowerStatChip(label = maxPowerLabel, value = footer.maxPower, valueColor = TeslaTokens.chart.energy)
        PowerStatChip(label = maxRegenLabel, value = footer.maxRegen, valueColor = TeslaTokens.chart.regen)
        PowerStatChip(label = avgLabel, value = footer.avg, valueColor = MaterialTheme.colorScheme.onSurface)
    }
}

/**
 * A single footer stat — a muted label + a colored, emphasized value (web `<span>label: <strong>value`) —
 * exposed to TalkBack as one grouped node so each figure reads as a self-contained unit.
 */
@Composable
private fun PowerStatChip(
    label: String,
    value: String,
    valueColor: Color,
) {
    Row(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "$label: $value" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption("$label:")
        Heading(text = value, level = HeadingLevel.Sub, color = valueColor)
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun PowerProfileFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberPowerProfileFreshnessFormatter(),
    )
}

/**
 * Builds the localized [PowerProfileChartStrings] from the i18n catalog (P1/S10): the title + series label
 * resolve through compile-time resources; the aria description resolves by-name with the web
 * `t(key, default)` fallback, since the catalog defines no key for it. Remembered against the resolved
 * strings so a locale change re-projects.
 */
@Composable
private fun rememberPowerProfileChartStrings(): PowerProfileChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_driveDetail_powerProfile)
    val power = stringResource(R.string.translation_driveDetail_power)
    val ariaLabel = resolveOptional({ context.optionalString(it) }, KEY_ARIA, PowerProfileChartDefaults.ARIA_LABEL)
    return remember(title, power, ariaLabel) {
        PowerProfileChartStrings(title = title, power = power, ariaLabel = ariaLabel)
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberPowerProfileFreshnessFormatter(): (FreshnessAge) -> String {
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
    PowerProfileChartStrings(
        title = "Power Profile",
        power = "Power",
        ariaLabel = "Drive power profile area chart over time",
    )

private val PREVIEW_DATA =
    PowerProfileData.from(
        points =
            listOf(
                PowerProfilePoint("09:00", 12.0),
                PowerProfilePoint("09:05", 78.0),
                PowerProfilePoint("09:10", -35.0),
                PowerProfilePoint("09:15", 22.0),
            ),
        avgPowerW = 19_000.0,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun PowerProfileChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerProfileChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun PowerProfileChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerProfileChartContent(
            state = UiState(UiPhase.Empty, data = PowerProfileData.from(emptyList())),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun PowerProfileChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerProfileChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun PowerProfileChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerProfileChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun PowerProfileChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowerProfileChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
