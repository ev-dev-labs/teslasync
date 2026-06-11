// The native Jetpack Compose + Material 3 Watch Summary dashboard surface — a parity port of
// web/src/features/dashboard/widgets/WatchSummaryWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while the first load is in flight, a retry surface on hard error, otherwise a freshness header) wrapping
// one of two bodies the web renders by footprint: the compact Apple-Watch-style circular battery gauge +
// state + range + charging indicator (web `isCompact`), or the standard battery hero + Range / Lock /
// Cabin / Last-Seen detail grid. All data flows through the shared [WatchSummaryWidgetViewModel] (P1/S8);
// the view never performs HTTP. Range + cabin temperature are SI→display converted at this render boundary
// via the shared [UnitFormatter] (web `useUnits()`), every string resolves through the i18n catalog
// (P1/S10), and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WatchSummaryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.watchsummary

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow

/**
 * Stateful entry point. Binds the shared Watch summary + complication feeds via [source] into a
 * [WatchSummaryWidgetViewModel], records the one-shot `view.opened` diagnostic, collects the live display
 * [units] formatter, and renders the surface. A dashboard host supplies [source] (an adapter over the
 * shared S8 [io.teslasync.shared.core.presentation.watch.WatchStore]), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`; `null` reads the primary vehicle), the grid [size] (web `WidgetProps.size`,
 * controls the compact vs standard body), and a unique [instanceKey] per placement.
 */
@Composable
fun WatchSummaryWidget(
    source: WatchSummarySource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: WatchSummarySize = WatchSummaryRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = WatchSummaryRegistration.ID,
) {
    val viewModel: WatchSummaryWidgetViewModel =
        viewModel(key = instanceKey, factory = WatchSummaryWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    WatchSummaryWidgetContent(
        state = state,
        formatter = formatter,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (a first load → full skeleton, a hard error → retry surface) and otherwise
 * a freshness header over the compact or standard body / empty state. A stale (non-error) snapshot
 * auto-refreshes, mirroring the web freshness contract; an offline cached snapshot keeps its body visible
 * with the freshness chip flagged. [formatter] supplies the SI→display range/temperature conversion.
 */
@Composable
fun WatchSummaryWidgetContent(
    state: UiState<WatchView>,
    formatter: UnitFormatter,
    size: WatchSummarySize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> WatchSummaryLoading(size)
            state.isError -> WatchSummaryErrorState(state = state, onRetry = onRefresh)
            else -> WatchSummaryLoaded(state = state, formatter = formatter, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun WatchSummaryLoaded(
    state: UiState<WatchView>,
    formatter: UnitFormatter,
    size: WatchSummarySize,
    onRefresh: () -> Unit,
) {
    val display = remember(state.data, formatter) { WatchSummaryProjection.project(state.data, formatter) }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        WatchSummaryHeader(
            title = if (size.isCompact) null else stringResource(R.string.translation_widget_watchSummary),
            state = state,
            onRefresh = onRefresh,
        )
        if (display.hasData) {
            if (size.isCompact) WatchSummaryCompactBody(display) else WatchSummaryStandardBody(display)
        } else {
            WatchSummaryEmpty()
        }
    }
}

@Composable
private fun WatchSummaryHeader(
    title: String?,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            Icon(
                imageVector = WatchFaceGlyph,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            PanelTitle(text = title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = title == null,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// ── Compact (web `isCompact`) — the Apple-Watch-style circular battery glance ─────────────────────────

@Composable
private fun WatchSummaryCompactBody(display: WatchSummaryDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        RadialGauge(
            value = display.batteryLevel,
            max = BATTERY_MAX_PERCENT,
            label = "",
            unit = BATTERY_PERCENT_UNIT,
            color = batteryBandColor(display.colorBand),
            size = COMPACT_GAUGE_SIZE,
            decimals = BATTERY_DECIMALS,
        )
        display.stateLabel?.let { StatusBadge(status = it, size = ChipSize.Sm) }
        Caption(text = display.rangeText)
        if (display.isCharging) {
            ChargingIndicator(label = stringResource(R.string.translation_widget_charging))
        }
    }
}

// ── Standard (web 2×2+) — battery hero + Range / Lock / Cabin / Last-Seen detail grid ─────────────────

@Composable
private fun WatchSummaryStandardBody(display: WatchSummaryDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        WatchBatteryHero(display = display)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                WatchValueCell(
                    label = stringResource(R.string.translation_widget_range),
                    value = display.rangeText,
                    modifier = Modifier.weight(1f),
                )
                WatchLockCell(lockState = display.lockState, modifier = Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                WatchValueCell(
                    label = stringResource(R.string.translation_widget_cabinTemp),
                    value = display.cabinTempText,
                    modifier = Modifier.weight(1f),
                )
                WatchLastSeenCell(lastSeenMillis = display.lastSeenMillis, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun WatchBatteryHero(display: WatchSummaryDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        AnimatedNumber(value = display.batteryLevel, decimals = BATTERY_DECIMALS, suffix = BATTERY_PERCENT_UNIT)
        MetricLabel(text = stringResource(R.string.translation_widget_battery))
        display.stateLabel?.let { Badge(text = it, variant = stateBadgeVariant(display.stateTone)) }
    }
}

@Composable
private fun WatchDetailCell(
    label: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier.heightIn(min = CELL_MIN_HEIGHT),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
        ) {
            MetricLabel(text = label)
            content()
        }
    }
}

@Composable
private fun WatchValueCell(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    WatchDetailCell(label = label, modifier = modifier) {
        BodyText(text = value, maxLines = 1)
    }
}

@Composable
private fun WatchLockCell(
    lockState: LockState,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(R.string.translation_widget_lockStatus)
    WatchDetailCell(label = label, modifier = modifier) {
        when (lockState) {
            LockState.Unknown -> BodyText(text = EM_DASH, maxLines = 1)
            else -> {
                val locked = lockState == LockState.Locked
                val valueLabel =
                    if (locked) {
                        stringResource(R.string.translation_widget_locked)
                    } else {
                        stringResource(R.string.translation_widget_unlocked)
                    }
                Row(
                    modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "$label, $valueLabel" },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Icon(
                        imageVector = if (locked) DataDisplayGlyphs.Lock else UnlockGlyph,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = if (locked) TeslaTokens.status.success else TeslaTokens.status.warning,
                    )
                    Badge(text = valueLabel, variant = if (locked) BadgeVariant.Success else BadgeVariant.Warning)
                }
            }
        }
    }
}

@Composable
private fun WatchLastSeenCell(
    lastSeenMillis: Long?,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(R.string.translation_widget_lastSeen)
    val formatAge = rememberRelativeAgeFormatter()
    val now = rememberNowTicker()
    val value =
        if (lastSeenMillis == null) {
            EM_DASH
        } else {
            formatAge(relativeAge(computeAgeSeconds(lastSeenMillis, now)))
        }
    WatchValueCell(label = label, value = value, modifier = modifier)
}

// ── Charging indicator (web compact `complication?.charging` branch) ──────────────────────────────────

@Composable
private fun ChargingIndicator(label: String) {
    val pulseAlpha = chargingPulseAlpha(rememberReducedMotion())
    Row(
        modifier =
            Modifier
                .graphicsLayer { alpha = pulseAlpha }
                .semantics(mergeDescendants = true) { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Xs,
            tint = TeslaTokens.status.success,
        )
        Caption(text = label)
    }
}

@Composable
private fun chargingPulseAlpha(reduce: Boolean): Float {
    if (reduce) return 1f
    val transition = rememberInfiniteTransition(label = "charging-pulse")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = CHARGING_PULSE_MIN_ALPHA,
        animationSpec = infiniteRepeatable(animation = tween(CHARGING_PULSE_MS), repeatMode = RepeatMode.Reverse),
        label = "charging-pulse-alpha",
    )
    return alpha
}

// ── Empty / loading / error states ────────────────────────────────────────────────────────────────────

@Composable
private fun WatchSummaryEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noWatchData),
        icon = WatchFaceGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun WatchSummaryLoading(size: WatchSummarySize) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (size.isCompact) {
            Skeleton(height = LOADING_GAUGE_SIZE, widthFraction = LOADING_GAUGE_FRACTION, rounded = true)
        } else {
            Skeleton(height = LOADING_HERO_HEIGHT, widthFraction = LOADING_HERO_FRACTION, rounded = true)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun WatchSummaryErrorState(
    state: UiState<WatchView>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = stringResource(R.string.translation_widget_watchSummary),
            onRetry = onRetry,
        )
    }
}

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind]: [ErrorKind.Network]/[ErrorKind.Timeout] is
 * treated as offline, [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the
 * not-found / unauthorized / server bucket.
 */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── Helpers: badge tone, band color, freshness formatter, ticking clock ───────────────────────────────

@Composable
private fun stateBadgeVariant(tone: StateTone): BadgeVariant =
    when (tone) {
        StateTone.Success -> BadgeVariant.Success
        StateTone.Neutral -> BadgeVariant.Neutral
        StateTone.Warning -> BadgeVariant.Warning
    }

@Composable
private fun batteryBandColor(band: BatteryColorBand): Color =
    when (band) {
        BatteryColorBand.Green -> TeslaTokens.status.success
        BatteryColorBand.Amber -> TeslaTokens.status.warning
        BatteryColorBand.Red -> TeslaTokens.status.danger
        BatteryColorBand.Unknown -> MaterialTheme.colorScheme.surfaceVariant
    }

/**
 * Builds the localized relative-age formatter the freshness chip + Last-Seen cell fold [FreshnessAge]
 * buckets through (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English
 * microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
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

/** A wall-clock millisecond value that re-emits every [TICK_MS] so the Last-Seen relative age stays live. */
@Composable
private fun rememberNowTicker(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

// ── Local glyphs — the web `Watch` and `Unlock` (lucide), authored as 24×24 stroked vectors. The
// data-display layer ships a `Lock` and `Bolt` glyph (reused above) but no watch/unlock glyph, and this
// surface's allowed files cannot extend that catalog, so they are hand-authored here, mirroring the
// approach in ClimateStatusWidget's local thermometer glyph. ──────────────────────────────────────────

private fun watchStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val WatchFaceGlyph: ImageVector =
    watchStroked("WatchFace") {
        // Round watch face (circle r=6 at 12,12), drawn as two semicircular arcs.
        moveTo(6f, 12f)
        arcTo(6f, 6f, 0f, false, true, 18f, 12f)
        arcTo(6f, 6f, 0f, false, true, 6f, 12f)
        close()
        // Clock hands.
        moveTo(12f, 9f)
        lineTo(12f, 12f)
        lineTo(13.5f, 13.5f)
        // Top band (trapezoid above the face).
        moveTo(8.6f, 6.6f)
        lineTo(9.3f, 3.3f)
        lineTo(14.7f, 3.3f)
        lineTo(15.4f, 6.6f)
        // Bottom band (trapezoid below the face).
        moveTo(8.6f, 17.4f)
        lineTo(9.3f, 20.7f)
        lineTo(14.7f, 20.7f)
        lineTo(15.4f, 17.4f)
    }

private val UnlockGlyph: ImageVector =
    watchStroked("Unlock") {
        // Lock body.
        moveTo(5f, 11f)
        lineTo(19f, 11f)
        lineTo(19f, 20f)
        lineTo(5f, 20f)
        close()
        // Open shackle: left post rising, arcing over to the right but not latching back down.
        moveTo(8f, 11f)
        lineTo(8f, 8f)
        curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
        curveTo(13.7f, 4f, 15.1f, 5.0f, 15.7f, 6.5f)
    }

private val COMPACT_GAUGE_SIZE = 80.dp
private val BODY_MIN_HEIGHT = 120.dp
private val CELL_MIN_HEIGHT = 56.dp
private val LOADING_GAUGE_SIZE = 80.dp
private val LOADING_HERO_HEIGHT = 40.dp
private val LOADING_ROW_HEIGHT = 48.dp
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val BATTERY_MAX_PERCENT = 100.0
private const val LOADING_GAUGE_FRACTION = 0.6f
private const val LOADING_HERO_FRACTION = 0.5f
private const val CHARGING_PULSE_MIN_ALPHA = 0.45f
private const val CHARGING_PULSE_MS = 900
private const val TICK_MS = 30_000L

// ── Previews — one per rendered state (compact / standard / empty / loading / error / offline) ─────────

private fun previewSummary(
    level: Double,
    charging: Boolean,
    locked: Boolean,
    state: String = "online",
): WatchSummary =
    WatchSummary(
        vehicleName = "Model 3",
        state = state,
        batteryLevel = level,
        rangeKm = 312.0,
        isCharging = charging,
        chargeRate = 32.0,
        timeToFull = 45.0,
        isLocked = locked,
        sentryMode = false,
        insideTempC = 21.0,
        outsideTempC = 14.0,
        isClimateOn = false,
        lastUpdated = "2026-06-11T18:25:00Z",
    )

private fun previewState(
    level: Double,
    charging: Boolean,
    locked: Boolean,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<WatchView> =
    UiState(
        phase = UiPhase.Content,
        data = WatchView(previewSummary(level, charging, locked), charging = charging),
        fetchedAt = System.currentTimeMillis(),
        stale = stale,
        errorKind = errorKind,
    )

@Preview(name = "WatchSummary · compact", showBackground = true)
@Composable
private fun WatchSummaryCompactPreview() {
    TeslaSyncTheme {
        WatchSummaryWidgetContent(
            state = previewState(level = 72.0, charging = true, locked = true),
            formatter = UnitFormatter.default(),
            size = WatchSummaryRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "WatchSummary · standard", showBackground = true)
@Composable
private fun WatchSummaryStandardPreview() {
    TeslaSyncTheme {
        WatchSummaryWidgetContent(
            state = previewState(level = 18.0, charging = false, locked = false),
            formatter = UnitFormatter.default(),
            size = WatchSummarySize(cols = 2, rows = 2),
        )
    }
}

@Preview(name = "WatchSummary · empty", showBackground = true)
@Composable
private fun WatchSummaryEmptyPreview() {
    TeslaSyncTheme {
        WatchSummaryWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = WatchView(WatchSummary(), charging = false), fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            size = WatchSummaryRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "WatchSummary · loading", showBackground = true)
@Composable
private fun WatchSummaryLoadingPreview() {
    TeslaSyncTheme {
        WatchSummaryWidgetContent(
            state = UiState.loading(),
            formatter = UnitFormatter.default(),
            size = WatchSummarySize(cols = 2, rows = 2),
        )
    }
}

@Preview(name = "WatchSummary · error", showBackground = true)
@Composable
private fun WatchSummaryErrorPreview() {
    TeslaSyncTheme {
        WatchSummaryWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
            size = WatchSummaryRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "WatchSummary · offline (cached)", showBackground = true)
@Composable
private fun WatchSummaryOfflinePreview() {
    TeslaSyncTheme {
        WatchSummaryWidgetContent(
            state = previewState(level = 55.0, charging = false, locked = true, stale = true, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
            size = WatchSummarySize(cols = 2, rows = 2),
        )
    }
}
