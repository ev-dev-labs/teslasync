// The native Jetpack Compose + Material 3 DriveScore shared surface — a parity port of
// web/src/components/data-display/DriveScore.tsx. The web component is purely presentational: it scores a
// single `drive` prop (via computeDriveScore) and renders an animated circular gauge — the total centered,
// tinted by getScoreColor — beside a "Drive Score" heading and four animated breakdown bars (Efficiency,
// Speed Discipline, Range Preservation, Trip Length), all inside the shared `<GlassPanel>`. Its only hook
// is `useTranslation` → the i18n catalog; it performs no HTTP.
//
// This port keeps that contract end to end. It binds no data hook of its own: the host supplies the drive
// through the shared P1/S8 state-holder layer as a [UiState] (the drive-detail page is the web parent that
// holds it), so this surface renders every lifecycle state that layer can carry — loading (skeleton
// chrome), hard error with retry, empty (no drive selected), content, and stale/offline (cached "last
// known" + freshness chip with auto-refresh) — without ever fetching. A web-parity overload that takes the
// raw `drive` object directly is also provided.
//
// Composition maps to the shared component library (never a direct chart/library import nor a raw hex):
//   - the web circular SVG gauge → the shared [RadialGauge] (the documented Android counterpart). It draws
//     the same track + proportional arc swept from the top; the arc carries the score-tier color. Two
//     deviations are forced by the shared gauge's fixed contract: the centered total renders in the default
//     on-surface color rather than the tier tint (the arc carries the tier), and the "Score" caption sits
//     just beneath the ring rather than inside it. The gauge also exposes a single "Score: <n>"
//     screen-reader description, which the web's decorative SVG lacks.
//   - each web breakdown bar → the shared animated [MetricBar] (label left, "value/max" right, fill animates).
//
// Color maps web hex → generated token, exact in the brand (dark) theme and theme-aware in light /
// high-contrast: gauge bad/warn/good #ef4444/#f59e0b/#10b981 = status.danger/warning/success; bars
// efficiency #00f0ff = status.info, speed #a855f7 = chart.power, range #10b981 = chart.battery, trip
// #f59e0b = chart.energy.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DriveScore — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.drivescore

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The on-screen diameter of the score gauge (the web `<svg width="130">` ring). */
private val GAUGE_SIZE: Dp = 120.dp

/** The web `max` of the total score — the gauge denominator. */
private const val TOTAL_SCORE_MAX = 100.0

/** Number of breakdown bars — drives the loading skeleton's row count (web's four-entry array). */
private const val BREAKDOWN_BAR_COUNT = 4

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the DriveScore surface. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the host's drive feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this surface never performs HTTP.
 *
 * @param state the cache-then-network projection of the drive to score (web `drive`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveScore(
    state: UiState<DriveScoreInput>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordDriveScoreOpened(logger) }
    DriveScoreContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's single `drive` prop, for hosts that already hold the
 * drive. A `null` drive renders the empty state (no drive selected); any drive is scored and rendered.
 * Delegates to the stateful entry, so it records `view.opened` identically. There is no fetch behind it,
 * so it offers no retry affordance.
 */
@Composable
fun DriveScore(
    drive: DriveScoreInput?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(drive) { driveScoreState(drive) }
    DriveScore(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the [GlassPanel]
 * so the section never collapses, then switches the panel body onto the host feed's [UiState]: loading
 * skeleton, hard error with retry, empty state, or the scored gauge + breakdown. Stale (non-error) data
 * auto-refreshes and a freshness chip appears whenever cached data is refreshing / stale / offline —
 * mirroring the web freshness contract.
 */
@Composable
fun DriveScoreContent(
    state: UiState<DriveScoreInput>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: DriveScoreStrings = rememberDriveScoreStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        val drive = state.data
        when {
            state.isLoading -> DriveScoreLoading()
            state.isError ->
                QueryError(
                    kind = driveScoreErrorKind(state.errorKind, state.httpStatus),
                    onRetry = onRetry,
                )
            drive == null -> EmptyState(message = stringResource(R.string.translation_common_noData))
            else -> {
                val breakdown = remember(drive) { DriveScoreComputation.compute(drive) }
                DriveScoreReady(breakdown = breakdown, strings = strings, state = state)
            }
        }
    }
}

/**
 * The scored content — the web gauge + breakdown composition. The [RadialGauge] sweeps proportionally to
 * the total and is tinted by the [scoreTier]; the breakdown column carries the "Drive Score" heading (with
 * a freshness chip when the cached data is refreshing / stale / offline) and the four [MetricBar] rows.
 */
@Composable
private fun DriveScoreReady(
    breakdown: DriveScoreBreakdown,
    strings: DriveScoreStrings,
    state: UiState<DriveScoreInput>,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadialGauge(
            value = breakdown.total.asDouble(),
            max = TOTAL_SCORE_MAX,
            label = strings.scoreLabel,
            color = gaugeColor(scoreTier(breakdown.total)),
            size = GAUGE_SIZE,
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(strings.title)
                if (state.refreshing || state.stale || state.hasError) {
                    DriveScoreFreshnessChip(state)
                }
            }
            driveScoreBars(breakdown, strings).forEach { bar ->
                MetricBar(
                    value = bar.value.asDouble(),
                    max = bar.max.asDouble(),
                    label = bar.label,
                    valueText = "${bar.value}/${bar.max}",
                    color = barColor(bar.metric),
                )
            }
        }
    }
}

/**
 * Loading skeleton shaped like the scored content — a shimmering gauge disc beside a heading line and four
 * breakdown-bar rows — so the surface reserves its real layout while the host's first load is in flight.
 */
@Composable
private fun DriveScoreLoading(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(GAUGE_SIZE)) {
            Skeleton(height = GAUGE_SIZE, rounded = true)
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Skeleton(widthFraction = HEADING_SKELETON_FRACTION, height = HEADING_SKELETON_HEIGHT)
            repeat(BREAKDOWN_BAR_COUNT) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Skeleton(widthFraction = BAR_LABEL_SKELETON_FRACTION, height = BAR_LABEL_SKELETON_HEIGHT)
                    Skeleton(height = BAR_SKELETON_HEIGHT, rounded = true)
                }
            }
        }
    }
}

/**
 * The freshness chip rendered in the breakdown header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Carries no English literal.
 */
@Composable
private fun DriveScoreFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberDriveScoreFreshnessFormatter(),
    )
}

/**
 * Builds the localized [DriveScoreStrings] from the i18n catalog (P1/S10): the six `driveScore.*` keys the
 * web component reads. Remembered against the resolved strings so a locale change re-renders.
 */
@Composable
fun rememberDriveScoreStrings(): DriveScoreStrings {
    val title = stringResource(R.string.translation_driveScore_title)
    val scoreLabel = stringResource(R.string.translation_driveScore_score)
    val efficiency = stringResource(R.string.translation_driveScore_efficiency)
    val speedDiscipline = stringResource(R.string.translation_driveScore_speedDiscipline)
    val rangePreservation = stringResource(R.string.translation_driveScore_rangePreservation)
    val tripLength = stringResource(R.string.translation_driveScore_tripLength)
    return remember(title, scoreLabel, efficiency, speedDiscipline, rangePreservation, tripLength) {
        DriveScoreStrings(
            title = title,
            scoreLabel = scoreLabel,
            efficiency = efficiency,
            speedDiscipline = speedDiscipline,
            rangePreservation = rangePreservation,
            tripLength = tripLength,
        )
    }
}

/** Per-theme gauge color for a [tier] — the web `getScoreColor` mapped to the semantic status palette. */
@Composable
@ReadOnlyComposable
private fun gaugeColor(tier: ScoreTier): Color =
    when (tier) {
        ScoreTier.Bad -> TeslaTokens.status.danger
        ScoreTier.Warn -> TeslaTokens.status.warning
        ScoreTier.Good -> TeslaTokens.status.success
    }

/** Palette color for a breakdown [metric] — the web bar hexes mapped to generated tokens. */
@Composable
@ReadOnlyComposable
private fun barColor(metric: DriveScoreMetric): Color =
    when (metric) {
        DriveScoreMetric.Efficiency -> TeslaTokens.status.info
        DriveScoreMetric.SpeedDiscipline -> TeslaTokens.chart.power
        DriveScoreMetric.RangePreservation -> TeslaTokens.chart.battery
        DriveScoreMetric.TripLength -> TeslaTokens.chart.energy
    }

/** Widens an integer score to the [Double] the gauge and bar component APIs expect. */
private fun Int.asDouble(): Double = this * 1.0

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure model.
 */
@Composable
private fun rememberDriveScoreFreshnessFormatter(): (FreshnessAge) -> String {
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

private const val HEADING_SKELETON_FRACTION = 0.45f
private val HEADING_SKELETON_HEIGHT = 14.dp
private const val BAR_LABEL_SKELETON_FRACTION = 0.5f
private val BAR_LABEL_SKELETON_HEIGHT = 9.dp
private val BAR_SKELETON_HEIGHT = 8.dp

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    DriveScoreStrings(
        title = "Drive Score",
        scoreLabel = "Score",
        efficiency = "Efficiency",
        speedDiscipline = "Speed Discipline",
        rangePreservation = "Range Preservation",
        tripLength = "Trip Length",
    )

private val PREVIEW_GOOD_DRIVE =
    DriveScoreInput(
        distanceM = 50_000.0,
        durationS = 3_000.0,
        maxSpeedMps = 20.0,
        startBatteryPct = 80.0,
        endBatteryPct = 70.0,
    )

private val PREVIEW_WARN_DRIVE =
    DriveScoreInput(
        distanceM = 40_000.0,
        durationS = 2_400.0,
        maxSpeedMps = 22.0,
        startBatteryPct = 80.0,
        endBatteryPct = 66.0,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DriveScoreLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveScoreContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DriveScoreEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveScoreContent(
            state = UiState(UiPhase.Empty),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun DriveScoreErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveScoreContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content (good)", showBackground = true)
@Composable
private fun DriveScoreGoodPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveScoreContent(
            state = UiState(UiPhase.Content, data = PREVIEW_GOOD_DRIVE),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content (warn)", showBackground = true)
@Composable
private fun DriveScoreWarnPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveScoreContent(
            state = UiState(UiPhase.Content, data = PREVIEW_WARN_DRIVE),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun DriveScoreOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveScoreContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_GOOD_DRIVE,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
