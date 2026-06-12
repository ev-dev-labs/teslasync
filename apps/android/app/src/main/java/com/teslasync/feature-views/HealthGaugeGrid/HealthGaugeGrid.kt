// The native Jetpack Compose + Material 3 HealthGaugeGrid feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx. The web component is purely
// presentational: the Drivetrain Health page derives `overallHealth` / `healthScore` / `motorStatus` / the four
// temperature `sensors` and threads them plus `stats: DrivingStats | undefined` down, and it renders a
// `grid-cols-1 md:grid-cols-3` of three GlassPanels inside a `<FadeIn delay={0.1}>` — a health-score
// <RadialGauge>, a Motor Details <KVList>, and a Drive Statistics <KVList> that collapses to a four-line
// <Skeleton> while `stats` is still loading.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web hooks
// are `useTranslation`, mapped to the i18n catalog P1/S10, and `useUnits`, mapped to the live S8 SettingsStore
// for the distance/speed units + grouping locale). The owning page computes the snapshot and threads it in
// through the shared state-holder layer as a [UiState], so this view renders every lifecycle state that layer
// can carry — a loading skeleton chrome, a hard error with retry, a friendly empty state (the web page's
// `!health` branch), content, and a stale/offline cached "last known" with a freshness chip + auto-refresh —
// without ever fetching, exactly like the sibling card-grid ports. The content branch reproduces the three-panel
// grid verbatim, including the web's one internal branch: the Drive Statistics panel renders its rows when
// `stats` is present and a four-line skeleton otherwise. A web-parity overload taking the raw snapshot (web
// `{ overallHealth, motorStatus, sensors, stats }`) is provided for hosts that already hold it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HealthGaugeGrid — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthgaugegrid

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Web Tailwind `md` breakpoint (768px): at or above this width the three panels lay out three-per-row. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

/** Web `md:grid-cols-3`: at or above the `md` breakpoint the panels lay out three-per-row. */
private const val GRID_COLUMNS_MD = 3

/** Web base `grid-cols-1`: below the `md` breakpoint each panel takes a full-width row. */
private const val GRID_COLUMNS_BASE = 1

/** Web `<RadialGauge size={140}>` — the health-score gauge diameter. */
private val GAUGE_SIZE: Dp = 140.dp

/** The skeleton bar standing in for the gauge ring while the health feed first loads. */
private val GAUGE_SKELETON_HEIGHT: Dp = 120.dp

/** Web `<FadeIn delay={0.1}>` — the resolved grid's 100 ms entrance delay. */
private const val ENTER_DELAY_MS = 100

private const val GAUGE_SKELETON_RING_FRACTION = 0.7f
private const val GAUGE_SKELETON_LABEL_FRACTION = 0.5f
private const val GAUGE_SKELETON_DESC_FRACTION = 0.8f
private val GAUGE_SKELETON_LABEL_HEIGHT: Dp = 12.dp
private val GAUGE_SKELETON_DESC_HEIGHT: Dp = 10.dp
private val HEADER_SKELETON_HEIGHT: Dp = 14.dp
private const val HEADER_SKELETON_FRACTION = 0.5f

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/**
 * Stateful entry point for the drivetrain health gauges. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live distance/speed unit + grouping-locale preferences from the shared S8 SettingsStore
 * (the native binding of the web `useUnits` hook; metric/en-US defaults apply until settings load), and renders
 * every lifecycle [state] the shared drivetrain feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [HealthGaugeGridSnapshot].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the units + locale; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun HealthGaugeGrid(
    state: UiState<HealthGaugeGridSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HealthGaugeGridDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { HealthGaugeGridDisplayPrefs.from(settingsResource.cached) }
    HealthGaugeGridContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's bundled props as one snapshot, for hosts that already hold
 * the computed values. A `null` [snapshot] projects onto the empty [UiState] (the web page's `!health` no-data
 * branch). There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun HealthGaugeGrid(
    snapshot: HealthGaugeGridSnapshot?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(snapshot) { HealthGaugeGridProjection.projectUiState(snapshot, isLoading = false) }
    HealthGaugeGrid(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. A freshness chip is shown
 * above the grid when content is stale/refreshing/offline, and stale (non-error) data auto-refreshes, mirroring
 * the shared cache-then-network freshness contract. Inside it switches between a loading skeleton chrome, a hard
 * error retry surface, a friendly empty state (so the surface never blanks), and the resolved three-panel grid.
 * [prefs] supplies the SI -> display conversion and the grouping locale.
 */
@Composable
fun HealthGaugeGridContent(
    state: UiState<HealthGaugeGridSnapshot>,
    onRetry: () -> Unit,
    prefs: HealthGaugeGridDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: HealthGaugeGridStrings = rememberHealthGaugeGridStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val isDegraded = state.stale || state.refreshing || state.hasError
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (snapshot != null && isDegraded) {
            HealthFreshnessRow(state = state)
        }
        when {
            state.isLoading -> HealthLoadingGrid()
            state.isError -> HealthError(onRetry = onRetry)
            state.isEmpty || snapshot == null -> HealthEmpty(message = strings.noData)
            else -> HealthLoadedGrid(snapshot = snapshot, prefs = prefs, strings = strings)
        }
    }
}

/**
 * A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content, the native
 * expression of the shared [DataFreshness] contract (the web page's poll/`refetch`). Lives above the grid.
 */
@Composable
private fun HealthFreshnessRow(state: UiState<HealthGaugeGridSnapshot>) {
    val formatAge = rememberHealthFreshnessFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
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
 * The content branch: the three resolved panels in the web responsive grid, mounting through a [FadeIn] so they
 * animate in together (web `<FadeIn delay={0.1}>`). The Drive Statistics panel reproduces the web `stats ? rows
 * : <Skeleton lines={4}>` branch.
 */
@Composable
private fun HealthLoadedGrid(
    snapshot: HealthGaugeGridSnapshot,
    prefs: HealthGaugeGridDisplayPrefs,
    strings: HealthGaugeGridStrings,
) {
    val gauge = remember(snapshot, strings) { HealthGaugeGridProjection.gauge(snapshot, strings) }
    val motorRows = remember(snapshot, strings) { HealthGaugeGridProjection.motorRows(snapshot, strings) }
    val statsRows =
        remember(snapshot, prefs, strings) {
            snapshot.stats?.let { HealthGaugeGridProjection.statsRows(it, prefs, strings) }
        }
    FadeIn(delayMs = ENTER_DELAY_MS) {
        HealthPanelGrid(
            panels =
                listOf(
                    { cellModifier ->
                        HealthGaugePanel(gauge = gauge, modifier = cellModifier)
                    },
                    { cellModifier ->
                        MotorDetailsPanel(
                            rows = motorRows,
                            realTime = strings.realTime,
                            title = strings.motorDetails,
                            modifier = cellModifier,
                        )
                    },
                    { cellModifier ->
                        DriveStatsPanel(rows = statsRows, title = strings.driveStats, modifier = cellModifier)
                    },
                ),
        )
    }
}

/** The health-score gauge panel — the shared [RadialGauge] tinted by the status accent, over a muted caption. */
@Composable
private fun HealthGaugePanel(
    gauge: HealthGaugeModel,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(
                value = gauge.value,
                max = gauge.max,
                label = gauge.label,
                unit = gauge.unit,
                color = healthGaugeAccent(gauge.status),
                size = GAUGE_SIZE,
            )
            Caption(gauge.description)
        }
    }
}

/** The Motor Details panel — a section header, the four KV rows, and the live-telemetry row. */
@Composable
private fun MotorDetailsPanel(
    rows: List<KVItem>,
    realTime: String,
    title: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Subhead(title)
            KVList(items = rows)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(
                    imageVector = HealthGaugeGridGlyphs.Activity,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Caption(realTime)
            }
        }
    }
}

/**
 * The Drive Statistics panel — a section header over the four KV rows, or a four-line skeleton while the stats
 * query is still in flight ([rows] is `null`), reproducing the web `stats ? <KVList> : <Skeleton lines={4}>`.
 */
@Composable
private fun DriveStatsPanel(
    rows: List<KVItem>?,
    title: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Subhead(title)
            if (rows != null) {
                KVList(items = rows)
            } else {
                SkeletonLines(lines = HealthGaugeGridProjection.STATS_ROW_COUNT)
            }
        }
    }
}

/**
 * The loading branch: the three panels rendered as skeleton chrome in the same responsive grid, announced as
 * "Loading" to TalkBack so the state is spoken rather than read as three empty boxes. Reproduces the web page's
 * loading affordance (its `PageContainer loading` spinner) at the surface level.
 */
@Composable
private fun HealthLoadingGrid() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    HealthPanelGrid(
        modifier = Modifier.semantics { contentDescription = loadingLabel },
        panels =
            listOf(
                { cellModifier -> GaugeSkeletonPanel(modifier = cellModifier) },
                { cellModifier -> RowsSkeletonPanel(modifier = cellModifier) },
                { cellModifier -> RowsSkeletonPanel(modifier = cellModifier) },
            ),
    )
}

/** A single loading tile for the gauge panel — a tall rounded ring bar over a label + description bar. */
@Composable
private fun GaugeSkeletonPanel(modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Skeleton(widthFraction = GAUGE_SKELETON_RING_FRACTION, height = GAUGE_SKELETON_HEIGHT, rounded = true)
            Skeleton(widthFraction = GAUGE_SKELETON_LABEL_FRACTION, height = GAUGE_SKELETON_LABEL_HEIGHT)
            Skeleton(widthFraction = GAUGE_SKELETON_DESC_FRACTION, height = GAUGE_SKELETON_DESC_HEIGHT)
        }
    }
}

/** A single loading tile for the KV panels — a header bar over four shimmering rows. */
@Composable
private fun RowsSkeletonPanel(modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(widthFraction = HEADER_SKELETON_FRACTION, height = HEADER_SKELETON_HEIGHT)
            SkeletonLines(lines = HealthGaugeGridProjection.STATS_ROW_COUNT)
        }
    }
}

/**
 * Empty state — the `drivetrain.noData` message with a gauge glyph, so the grid never collapses to a blank box.
 * [EmptyState] exposes the message as its accessibility label, so the section is still announced to TalkBack.
 */
@Composable
private fun HealthEmpty(message: String) {
    EmptyState(message = message, icon = DataDisplayGlyphs.Gauge, modifier = Modifier.fillMaxWidth())
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun HealthError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Lays out the [panels] as the web responsive grid: three-per-row at or above [GRID_MD_MIN_WIDTH]
 * (`md:grid-cols-3`) and one-per-row below it (`grid-cols-1`). Each cell fills its column via
 * [Modifier.weight]; a partial trailing row is padded with weighted spacers so cells keep a uniform width.
 * Cells are spaced by `Spacing.md`, the native expression of the web `gap-4`.
 */
@Composable
private fun HealthPanelGrid(
    panels: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_MD_MIN_WIDTH) GRID_COLUMNS_MD else GRID_COLUMNS_BASE
        val rows = panels.indices.chunked(columns)
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            for (rowIndices in rows) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    for (index in rowIndices) {
                        panels[index](Modifier.weight(1f))
                    }
                    repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Maps the drivetrain condition rating to its gauge accent color (web `HEALTH_COLOR[overallHealth]`): the web
 * `#10b981` / `#f59e0b` / `#ef4444` hexes map onto the theme-aware success / warning / danger status tokens, so
 * the gauge stays legible in the light theme too.
 */
@Composable
private fun healthGaugeAccent(status: HealthStatus): Color =
    when (status) {
        HealthStatus.Good -> TeslaTokens.status.success
        HealthStatus.Warning -> TeslaTokens.status.warning
        HealthStatus.Critical -> TeslaTokens.status.danger
    }

/**
 * Builds the localized [HealthGaugeGridStrings] from the i18n catalog (P1/S10): the `drivetrain.*` labels the
 * web reads through `useTranslation`, the three capitalized status values, and the empty-state message.
 * Resolved once at the Compose boundary so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberHealthGaugeGridStrings(): HealthGaugeGridStrings {
    val healthScore = stringResource(R.string.translation_drivetrain_healthScore)
    val healthScoreDesc = stringResource(R.string.translation_drivetrain_healthScoreDesc)
    val motorDetails = stringResource(R.string.translation_drivetrain_motorDetails)
    val driveStats = stringResource(R.string.translation_drivetrain_driveStats)
    val motorStatus = stringResource(R.string.translation_drivetrain_motorStatus)
    val overallHealth = stringResource(R.string.translation_drivetrain_overallHealth)
    val healthScoreLabel = stringResource(R.string.translation_drivetrain_healthScoreLabel)
    val sensorCount = stringResource(R.string.translation_drivetrain_sensorCount)
    val realTime = stringResource(R.string.translation_drivetrain_realTime)
    val totalDrives = stringResource(R.string.translation_drivetrain_totalDrives)
    val totalDistance = stringResource(R.string.translation_drivetrain_totalDistance)
    val avgSpeed = stringResource(R.string.translation_drivetrain_avgSpeed)
    val topSpeed = stringResource(R.string.translation_drivetrain_topSpeed)
    val statusGood = stringResource(R.string.translation_Good)
    val statusWarning = stringResource(R.string.translation_Warning)
    val statusCritical = stringResource(R.string.translation_Critical)
    val noData = stringResource(R.string.translation_drivetrain_noData)
    return remember(
        healthScore,
        healthScoreDesc,
        motorDetails,
        driveStats,
        motorStatus,
        overallHealth,
        healthScoreLabel,
        sensorCount,
        realTime,
        totalDrives,
        totalDistance,
        avgSpeed,
        topSpeed,
        statusGood,
        statusWarning,
        statusCritical,
        noData,
    ) {
        HealthGaugeGridStrings(
            healthScore = healthScore,
            healthScoreDesc = healthScoreDesc,
            motorDetails = motorDetails,
            driveStats = driveStats,
            motorStatus = motorStatus,
            overallHealth = overallHealth,
            healthScoreLabel = healthScoreLabel,
            sensorCount = sensorCount,
            realTime = realTime,
            totalDrives = totalDrives,
            totalDistance = totalDistance,
            avgSpeed = avgSpeed,
            topSpeed = topSpeed,
            statusGood = statusGood,
            statusWarning = statusWarning,
            statusCritical = statusCritical,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberHealthFreshnessFormatter(): (FreshnessAge) -> String {
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
 * The lucide glyph this surface needs that the shared [DataDisplayGlyphs] set does not carry. The web uses
 * lucide `Activity` for the live-telemetry row; Android ships no equivalent without the frozen
 * `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their lucide ports — it is
 * authored here as a 24×24 stroked vector faithful to the lucide path.
 */
private object HealthGaugeGridGlyphs {
    /** lucide `activity` — a heartbeat polyline (`M22 12h-4l-3 9L9 3l-3 9H2`). */
    val Activity: ImageVector =
        ImageVector
            .Builder(
                name = "Activity",
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
                    pathBuilder = {
                        moveTo(22f, 12f)
                        lineTo(18f, 12f)
                        lineTo(15f, 21f)
                        lineTo(9f, 3f)
                        lineTo(6f, 12f)
                        lineTo(2f, 12f)
                    },
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    HealthGaugeGridStrings(
        healthScore = "Health Score",
        healthScoreDesc = "Overall drivetrain condition rating",
        motorDetails = "Motor Details",
        driveStats = "Drive Statistics",
        motorStatus = "Motor Status",
        overallHealth = "Overall Health",
        healthScoreLabel = "Health Score",
        sensorCount = "Active Sensors",
        realTime = "Real-time telemetry active",
        totalDrives = "Total Drives",
        totalDistance = "Total Distance",
        avgSpeed = "Avg Speed",
        topSpeed = "Top Speed",
        statusGood = "Good",
        statusWarning = "Warning",
        statusCritical = "Critical",
        noData = "No data",
    )

private val PREVIEW_STATS =
    DrivingStatsSummary(
        totalDrives = 487.0,
        totalDistanceM = 42_300.0,
        avgSpeedMps = 18.2,
        topSpeedMps = 33.5,
    )

private val PREVIEW_SNAPSHOT =
    HealthGaugeGridSnapshot(
        overallHealth = HealthStatus.Good,
        motorStatus = "Nominal",
        sensorTempsC = listOf(42.0, 44.0, 51.0, 28.0),
        stats = PREVIEW_STATS,
    )

private val PREVIEW_PREFS_IMPERIAL =
    HealthGaugeGridDisplayPrefs(
        units =
            UnitPref(
                distance = DistanceUnitPref.MI,
                speed = SpeedUnitPref.MPH,
                temperature = TemperatureUnitPref.FAHRENHEIT,
                pressure = PressureUnitPref.PSI,
                energy = EnergyUnitPref.KWH,
                duration = DurationUnitPref.HOURS,
                power = PowerUnitPref.KW,
                locale = "en-US",
            ),
        locale = Locale.US,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun HealthGaugeGridLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthGaugeGridContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = HealthGaugeGridDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content — good (metric)", showBackground = true)
@Composable
private fun HealthGaugeGridContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthGaugeGridContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            prefs = HealthGaugeGridDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content — warning, stats loading", showBackground = true)
@Composable
private fun HealthGaugeGridStatsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthGaugeGridContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT.copy(overallHealth = HealthStatus.Warning, motorStatus = "Warm", stats = null),
                ),
            onRetry = {},
            prefs = HealthGaugeGridDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun HealthGaugeGridEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthGaugeGridContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = HealthGaugeGridDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline — critical (imperial)", showBackground = true)
@Composable
private fun HealthGaugeGridOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthGaugeGridContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT.copy(overallHealth = HealthStatus.Critical, motorStatus = "Overheating"),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = PREVIEW_PREFS_IMPERIAL,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun HealthGaugeGridErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthGaugeGridContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = HealthGaugeGridDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}
