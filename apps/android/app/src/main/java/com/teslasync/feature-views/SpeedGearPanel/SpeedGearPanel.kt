// The native Jetpack Compose + Material 3 SpeedGearPanel feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx. The web component renders a
// `GlassPanel` titled "Speed & Gear" and a responsive `Grid` (`cols={{ default: 2, md: 4 }}`) of four centered
// cells: the shift letter (a large, semantically-colored glyph above a status `Badge`), the motor power in kW,
// the average drive speed, and the top drive speed — each converted to the user's display units via
// `useUnits`, with an em dash when its value is absent. This port keeps that contract: the panel + title
// always render, the grid reflows 2 → 4 columns at the web `md` breakpoint, the shift letter carries the web's
// semantic accent (emerald / red / yellow / muted) via design tokens, and every value cell shows the em dash
// rather than collapsing when its figure is missing.
//
// The web component is presentational — its parent (the Driving Dynamics page) owns the `/motor/latest` and
// `/drives` queries and their loading / error / stale / offline handling. So this surface binds no data fetch;
// its two web data sources are `useTranslation` (the generated i18n catalog, P1/S10) and `useUnits` (the live
// speed display preference + locale + precision from the data container, P1/S8). The host supplies the
// combined snapshot through the shared state-holder layer as a [UiState], so the surface ALSO renders every
// lifecycle state that layer can carry — a loading skeleton grid, a hard error with retry, a friendly empty
// state, and a refreshing/stale/offline freshness chip — without ever fetching. A web-parity overload that
// takes the raw `motorLatest` + `filteredDrives` (web `{ motorLatest, filteredDrives }`) is also provided for
// hosts that already hold those values; it renders the content branch directly.
//
// Every derivation flows through the pure [SpeedGearPanelProjection]; the composable is a thin render layer
// that records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition. The title and
// every label resolve through the catalog (`dynamics.*` + `common.*` + `error.*` keys); the only non-key
// strings are the `kW` power suffix and the speed-unit symbol the web itself derives from the unit preference,
// plus the em-dash fallback — so there is no English UI copy literal in this file.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SpeedGearPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.speedgearpanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

/** Web `<FadeIn delay={0.15}>` → 150ms entry delay. */
private const val SPEED_GEAR_FADE_DELAY_MS: Int = 150

/** Tailwind `md` (768px) breakpoint — the web `Grid cols={{ default: 2, md: 4 }}` reflow. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

/** Web `cols.default` — two columns below the `md` breakpoint. */
private const val GRID_COLUMNS_BASE: Int = 2

/** Web `cols.md` — four columns at or above the `md` breakpoint. */
private const val GRID_COLUMNS_MD: Int = 4

/** The four cells the grid lays out (shift + three metrics) — used to size the loading skeleton. */
private const val CELL_COUNT: Int = 4

/** Loading chrome: one bar per grid cell, tall enough to stand in for the shift letter / metric value. */
private val SKELETON_TILE_HEIGHT: Dp = 88.dp

/**
 * The already-localized strings the panel renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary, keeping
 * the rest of the surface free of any English literal.
 */
data class SpeedGearPanelStrings(
    val title: String,
    val shiftState: String,
    val power: String,
    val avgDriveSpeed: String,
    val topDriveSpeed: String,
    val noData: String,
)

/**
 * Stateful entry point for the Speed & Gear panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live display units (web `useUnits`), and renders every lifecycle [state] the shared feed
 * can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never
 * performs HTTP.
 *
 * @param state the cache-then-network projection of the combined [SpeedGearSnapshot] (latest motor + filtered
 *   drives).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param units the live SI → display unit formatter; defaults to the app's `LocalDataContainer`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SpeedGearPanel(
    state: UiState<SpeedGearSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SpeedGearPanelDiagnostics.recordViewOpened(logger) }
    val formatter by units.collectAsStateWithLifecycle()
    SpeedGearPanelContent(state = state, onRetry = onRetry, prefs = formatter.prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `{ motorLatest, filteredDrives }` props, for hosts that
 * already hold the latest motor snapshot and the date-filtered drives. Projects them onto a content [UiState]
 * via [SpeedGearPanelProjection.projectUiState] and delegates to the stateful entry, which records
 * `view.opened`. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SpeedGearPanel(
    motor: MotorShift?,
    drives: List<DriveSpeedSample>,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(motor, drives) {
            SpeedGearPanelProjection.projectUiState(SpeedGearSnapshot(motor, drives), isLoading = false)
        }
    SpeedGearPanel(state = state, onRetry = {}, modifier = modifier, units = units, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Always renders the
 * `GlassPanel` + "Speed & Gear" title (web's always-present panel chrome); then the loading skeleton grid, the
 * hard-error retry surface, the friendly empty state, or the four-cell content grid, with a freshness chip in
 * the header whenever the feed is refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [prefs] supplies the SI → display unit conversion + formatting.
 */
@Composable
fun SpeedGearPanelContent(
    state: UiState<SpeedGearSnapshot>,
    onRetry: () -> Unit,
    prefs: UnitPref,
    modifier: Modifier = Modifier,
    strings: SpeedGearPanelStrings = rememberSpeedGearPanelStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    FadeIn(modifier = modifier, delayMs = SPEED_GEAR_FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            SectionTitle(strings.title, modifier = Modifier.fillMaxWidth().semantics { heading() })
            Spacer(modifier = Modifier.height(Spacing.md))
            val snapshot = state.data
            when {
                state.isLoading -> SpeedGearSkeletonGrid(loadingLabel = loadingLabel)
                state.isError -> SpeedGearError(onRetry = onRetry)
                state.isEmpty || snapshot == null -> EmptyState(message = strings.noData)
                else -> SpeedGearLoaded(snapshot = snapshot, state = state, prefs = prefs, strings = strings)
            }
        }
    }
}

/**
 * The content branch — the web four-cell grid, with an optional freshness chip above it whenever the feed is
 * refreshing/stale/offline (the chrome the host's feed implies; a clean first load shows no chip, matching the
 * web source's chip-free panel). The shift cell renders the large, accent-colored letter above the status
 * badge; the three metric cells render a label, value, and unit. Cells are projected once by the pure
 * [SpeedGearPanelProjection].
 */
@Composable
private fun SpeedGearLoaded(
    snapshot: SpeedGearSnapshot,
    state: UiState<SpeedGearSnapshot>,
    prefs: UnitPref,
    strings: SpeedGearPanelStrings,
) {
    val display =
        remember(snapshot, prefs) {
            SpeedGearPanelProjection.display(snapshot, prefs, resolveDisplayLocale(prefs.locale))
        }
    Column(modifier = Modifier.fillMaxWidth()) {
        if (state.stale || state.refreshing || state.hasError) {
            SpeedGearFreshnessRow(state = state)
        }
        SpeedGearGrid(
            cells =
                buildList {
                    add { ShiftCell(label = strings.shiftState, display = display) }
                    display.metrics.forEach { metric ->
                        add { MetricCell(label = strings.label(metric.metric), value = metric.value, unit = metric.unit) }
                    }
                },
        )
    }
}

/**
 * The optional freshness chip shown above the content grid whenever the feed is refreshing, stale, or serving
 * cached data after a failed refresh (offline) — the render-only chrome the host's feed implies. Right-aligned
 * so it sits in the panel's top-right corner the way the web page-level freshness affordance does.
 */
@Composable
private fun SpeedGearFreshnessRow(state: UiState<SpeedGearSnapshot>) {
    val formatAge = rememberSpeedGearFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/**
 * The shift cell — the web `flex flex-col items-center justify-center` cell: a large, accent-colored shift
 * letter (web `text-5xl font-bold` + `shiftColor`) above a status `Badge` labeled "Shift State"
 * (web `shiftBadgeVariant`). The letter reads its accent directly the way the sibling LiveVehicleState cell
 * does; the badge label is exposed to TalkBack so the cell is announced.
 */
@Composable
private fun ShiftCell(
    label: String,
    display: SpeedGearDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterVertically),
    ) {
        Text(
            text = display.shift,
            style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.Bold),
            color = shiftAccentColor(display.shiftAccent),
            maxLines = 1,
            textAlign = TextAlign.Center,
            overflow = TextOverflow.Ellipsis,
        )
        Badge(text = label, variant = shiftBadgeVariant(display.shiftBadge))
    }
}

/**
 * One metric cell — the web `flex flex-col items-center` cell: a muted [label] above the bold [value] above
 * the muted [unit] suffix. An absent value renders the em-dash (resolved by the projection), never a blank
 * cell, and the unit is always shown beneath it, exactly like the web.
 */
@Composable
private fun MetricCell(
    label: String,
    value: String,
    unit: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(label)
        MetricValue(value)
        HelperText(unit)
    }
}

/**
 * Lays the [cells] out as the web responsive grid: [GRID_COLUMNS_MD] columns at or above the `md` breakpoint
 * else [GRID_COLUMNS_BASE], each cell filling its column via [Modifier.weight]; a partial trailing row is
 * padded with weighted spacers so cells keep a uniform width. Rows and cells are spaced by `Spacing.lg`, the
 * native expression of the web `gap-6`.
 */
@Composable
private fun SpeedGearGrid(cells: List<@Composable () -> Unit>) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_MD_MIN_WIDTH) GRID_COLUMNS_MD else GRID_COLUMNS_BASE
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            cells.chunked(columns).forEach { rowCells ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                    rowCells.forEach { cell -> Box(modifier = Modifier.weight(1f)) { cell() } }
                    repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * The loading branch — [CELL_COUNT] shimmering tiles in the same responsive grid as the cells, wrapped in a
 * single TalkBack "Loading" region so the loading state is announced rather than read as a stack of empty
 * boxes. No cell label leaks while loading.
 */
@Composable
private fun SpeedGearSkeletonGrid(loadingLabel: String) {
    Column(modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel }) {
        SpeedGearGrid(cells = List(CELL_COUNT) { { Skeleton(height = SKELETON_TILE_HEIGHT, rounded = true) } })
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SpeedGearError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [SpeedGearPanelStrings] from the i18n catalog (P1/S10): the `dynamics.*` keys the web
 * component reads through `useTranslation`, plus the `common.noData` empty-state message. Resolved once at the
 * Compose boundary so the rest of the surface stays free of any English literal.
 */
@Composable
fun rememberSpeedGearPanelStrings(): SpeedGearPanelStrings {
    val title = stringResource(R.string.translation_dynamics_speedGear)
    val shiftState = stringResource(R.string.translation_dynamics_shiftState)
    val power = stringResource(R.string.translation_dynamics_power)
    val avgDriveSpeed = stringResource(R.string.translation_dynamics_avgDriveSpeed)
    val topDriveSpeed = stringResource(R.string.translation_dynamics_topDriveSpeed)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(title, shiftState, power, avgDriveSpeed, topDriveSpeed, noData) {
        SpeedGearPanelStrings(
            title = title,
            shiftState = shiftState,
            power = power,
            avgDriveSpeed = avgDriveSpeed,
            topDriveSpeed = topDriveSpeed,
            noData = noData,
        )
    }
}

/** Resolves a metric cell's already-localized label from the bundled strings. */
private fun SpeedGearPanelStrings.label(metric: SpeedGearMetric): String =
    when (metric) {
        SpeedGearMetric.Power -> power
        SpeedGearMetric.AvgDriveSpeed -> avgDriveSpeed
        SpeedGearMetric.TopDriveSpeed -> topDriveSpeed
    }

/**
 * Resolves a [ShiftAccent] to its design-token color so no hex literal leaks into the view — the native mirror
 * of the web `shiftColor` Tailwind classes. `D`→success green, `R`→danger red, `N`→warning amber, `P` and any
 * unknown code → the muted/secondary foreground.
 */
@Composable
private fun shiftAccentColor(accent: ShiftAccent): Color =
    when (accent) {
        ShiftAccent.Drive -> TeslaTokens.status.success
        ShiftAccent.Reverse -> TeslaTokens.status.danger
        ShiftAccent.Neutral -> TeslaTokens.status.warning
        ShiftAccent.Park -> MaterialTheme.colorScheme.onSurfaceVariant
        ShiftAccent.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Maps the projected [ShiftBadge] onto the shared [BadgeVariant] (web `shiftBadgeVariant`). */
private fun shiftBadgeVariant(badge: ShiftBadge): BadgeVariant =
    when (badge) {
        ShiftBadge.Success -> BadgeVariant.Success
        ShiftBadge.Danger -> BadgeVariant.Danger
        ShiftBadge.Warning -> BadgeVariant.Warning
        ShiftBadge.Neutral -> BadgeVariant.Neutral
    }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSpeedGearFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> DASH
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

private fun previewStrings(): SpeedGearPanelStrings =
    SpeedGearPanelStrings(
        title = "Speed & Gear",
        shiftState = "Shift State",
        power = "Power",
        avgDriveSpeed = "Avg Drive Speed",
        topDriveSpeed = "Top Drive Speed",
        noData = "No drive data yet",
    )

private fun previewSnapshot(): SpeedGearSnapshot =
    SpeedGearSnapshot(
        motor = MotorShift(shiftState = "D", powerKw = 42.5),
        drives =
            listOf(
                DriveSpeedSample(avgSpeedMps = 22.352, maxSpeedMps = 44.704),
                DriveSpeedSample(avgSpeedMps = 13.4112, maxSpeedMps = 31.2928),
            ),
    )

@Preview(name = "Content — narrow (2-col)", showBackground = true)
@Composable
private fun SpeedGearPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedGearPanelContent(
            state = SpeedGearPanelProjection.projectUiState(previewSnapshot(), isLoading = false),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Content — wide (4-col)", showBackground = true, widthDp = 900)
@Composable
private fun SpeedGearPanelWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedGearPanelContent(
            state = SpeedGearPanelProjection.projectUiState(previewSnapshot(), isLoading = false),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SpeedGearPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedGearPanelContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SpeedGearPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedGearPanelContent(
            state = SpeedGearPanelProjection.projectUiState(snapshot = null, isLoading = false),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}
