// The native Jetpack Compose + Material 3 PollingEngine shared surface — a parity port of
// web/src/components/data-display/PollingEngine.tsx. The web surface is a "header + savings card + per-vehicle
// activity list" panel for the adaptive-polling engine: a TrendingDown-branded title + an "Active" badge, a
// four-stat savings card with a cost-attribution bar + legend, and a list of tracked vehicles (activity,
// profile, next-poll countdown). The whole panel renders nothing when the engine is disabled
// (`!status?.enabled`).
//
// All data flows through the shared [PollingEngineViewModel] (P1/S8); the view performs NO HTTP. Every visible
// string resolves through the i18n catalog (P1/S10) and the surfaces carry merged TalkBack descriptions. The
// scaffold is composed from the shared atoms (GlassPanel, Badge, StatusPill, typography, EmptyState,
// QueryError, Skeleton, motion FadeIn) — the same approach the sibling Range / AIChargingDiagnosis surfaces
// take. See PollingEngineModel.kt for the documented parity-with-honesty notes on the title/heading i18n keys
// and the omitted expand-only decision detail (Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PollingEngine) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pollingengine

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping [PollingProjection] a pure, locale-stable function. Every
 * string resolves through the P1/S10 catalog (see PollingEngineModel.kt for the title/heading key rationale).
 */
data class PollingEngineStrings(
    val title: String,
    val active: String,
    val vehicleActivity: String,
    val noVehicles: String,
    val nextLabel: String,
    val nowLabel: String,
    val pollsSaved: String,
    val savedAmount: String,
    val pollsMade: String,
    val creditLeft: String,
    val fleetTelemetry: String,
    val idleDetection: String,
    val prediction: String,
    val sleep: String,
    val profileDriving: String,
    val profileCharging: String,
    val profileIdle: String,
    val profileSleeping: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
)

/**
 * Stateful entry point — the faithful port of the web `PollingEnginePanel`. Binds the status + savings feeds
 * via [source] into a [PollingEngineViewModel], records the one-shot `view.opened` diagnostic (P1/S11) on
 * first composition, collects both feeds, projects them with the current wall clock, auto-refreshes a stale
 * cache, and renders. The surface performs no HTTP; [logger] defaults to the process logger and [instanceKey]
 * scopes the ViewModel per placement.
 *
 * Mirrors the web `!status?.enabled` gate: when the engine is resolved-disabled the surface renders nothing.
 *
 * @param source the polling feeds seam (a host-wired shared-feed adapter in production, a fake in tests).
 */
@Composable
fun PollingEngine(
    source: PollingEngineSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = PollingEngineRegistration.SLUG,
) {
    val viewModel: PollingEngineViewModel =
        viewModel(key = instanceKey, factory = PollingEngineViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val status by viewModel.status.collectAsStateWithLifecycle()
    val savings by viewModel.savings.collectAsStateWithLifecycle()
    val now = remember(status) { System.currentTimeMillis() }
    val display = remember(status, savings, now) { PollingProjection.project(status, savings, now) }

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    if (display.phase == PollingPhase.Hidden) return

    FadeIn(modifier = modifier) {
        PollingEngineContent(display = display, strings = rememberPollingEngineStrings(), onRetry = viewModel::retry)
    }
}

/**
 * Stateless PollingEngine panel — renders every branch the web source draws plus the status document's
 * lifecycle: the loading skeleton, the full panel (savings card + vehicle list), the empty-vehicles hint, and
 * the classified error with retry, with a stale/offline freshness chip over a cached panel. Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun PollingEngineContent(
    display: PollingDisplay,
    strings: PollingEngineStrings,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    if (display.phase == PollingPhase.Hidden) return
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        when (display.phase) {
            PollingPhase.Loading -> PollingLoading(strings = strings)
            PollingPhase.Error ->
                QueryError(
                    kind = PollingProjection.queryErrorKind(display),
                    resourceName = strings.title,
                    onRetry = onRetry,
                )
            PollingPhase.Content, PollingPhase.Empty -> PollingPanel(display = display, strings = strings)
            PollingPhase.Hidden -> Unit
        }
    }
}

@Composable
private fun PollingLoading(strings: PollingEngineStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = HEADER_SKELETON_FRACTION, height = HEADER_SKELETON_HEIGHT)
        StatGridSkeleton(count = SAVINGS_STAT_COUNT)
        Skeleton(widthFraction = ROW_SKELETON_FRACTION, height = ROW_SKELETON_HEIGHT)
        Skeleton(widthFraction = ROW_SKELETON_FRACTION, height = ROW_SKELETON_HEIGHT)
    }
}

@Composable
private fun PollingPanel(
    display: PollingDisplay,
    strings: PollingEngineStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        PollingHeader(display = display, strings = strings)
        val savings = display.savings
        if (savings != null) {
            PollingSavingsCard(savings = savings, strings = strings)
        }
        PollingVehicleSection(display = display, strings = strings)
    }
}

@Composable
private fun PollingHeader(
    display: PollingDisplay,
    strings: PollingEngineStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                DataDisplayGlyphs.TrendingDown,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            PanelTitle(strings.title)
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (display.showFreshnessChip) {
                PollingFreshnessChip(display = display, strings = strings)
            }
            Badge(text = strings.active, variant = BadgeVariant.Success)
        }
    }
}

@Composable
private fun PollingFreshnessChip(
    display: PollingDisplay,
    strings: PollingEngineStrings,
) {
    if (display.offline) {
        StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
    } else {
        StatusPill(text = strings.staleLabel, tone = StatusTone.Warning, pulse = display.refreshing)
    }
}

@Composable
private fun PollingSavingsCard(
    savings: PollingSavingsView,
    strings: PollingEngineStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PollingStat(
                modifier = Modifier.weight(1f),
                value = savings.savingsPercentText,
                suffix = PERCENT_SUFFIX,
                label = strings.pollsSaved,
                emphasis = true,
            )
            PollingStat(
                modifier = Modifier.weight(1f),
                value = savings.estimatedSavingsText,
                prefix = CURRENCY_PREFIX,
                label = strings.savedAmount,
                emphasis = true,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PollingStat(
                modifier = Modifier.weight(1f),
                value = savings.pollsMadeText,
                label = strings.pollsMade,
                emphasis = false,
            )
            PollingStat(
                modifier = Modifier.weight(1f),
                value = savings.remainingCreditText,
                prefix = CURRENCY_PREFIX,
                label = strings.creditLeft,
                emphasis = false,
            )
        }
        if (savings.hasBreakdown) {
            PollingBreakdownBar(segments = savings.segments)
            PollingBreakdownLegend(strings = strings)
        }
    }
}

@Composable
private fun PollingStat(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    prefix: String = "",
    suffix: String = "",
    emphasis: Boolean = false,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = prefix + value + suffix,
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
            color = if (emphasis) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurface,
        )
        Caption(label)
    }
}

@Composable
private fun PollingBreakdownBar(segments: List<BreakdownSegment>) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        horizontalArrangement = Arrangement.spacedBy(BAR_GAP),
    ) {
        segments
            .filter { it.fraction > 0f }
            .forEach { segment ->
                Spacer(
                    modifier =
                        Modifier
                            .weight(segment.fraction)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(Radius.pill))
                            .background(breakdownColor(segment.kind)),
                )
            }
    }
}

@Composable
private fun PollingBreakdownLegend(strings: PollingEngineStrings) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PollingLegendItem(
                modifier = Modifier.weight(1f),
                kind = BreakdownKind.FleetTelemetry,
                label = strings.fleetTelemetry,
            )
            PollingLegendItem(
                modifier = Modifier.weight(1f),
                kind = BreakdownKind.IdleDetection,
                label = strings.idleDetection,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PollingLegendItem(
                modifier = Modifier.weight(1f),
                kind = BreakdownKind.Prediction,
                label = strings.prediction,
            )
            PollingLegendItem(
                modifier = Modifier.weight(1f),
                kind = BreakdownKind.Sleep,
                label = strings.sleep,
            )
        }
    }
}

@Composable
private fun PollingLegendItem(
    kind: BreakdownKind,
    label: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Spacer(modifier = Modifier.size(LEGEND_DOT_SIZE).clip(CircleShape).background(breakdownColor(kind)))
        HelperText(label)
    }
}

@Composable
private fun PollingVehicleSection(
    display: PollingDisplay,
    strings: PollingEngineStrings,
) {
    if (display.vehicles.isEmpty()) {
        EmptyState(message = strings.noVehicles, icon = DataDisplayGlyphs.Gauge)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                DataDisplayGlyphs.Gauge,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Subhead(strings.vehicleActivity)
        }
        display.vehicles.forEach { PollingVehicleRow(row = it, strings = strings) }
    }
}

@Composable
private fun PollingVehicleRow(
    row: VehicleRowView,
    strings: PollingEngineStrings,
) {
    val profileText = profileLabel(strings = strings, row = row)
    val nextValue = nextPollValue(row = row, strings = strings)
    val description = "${row.vinTail}, ${row.activityRaw}, $profileText, ${strings.nextLabel} $nextValue"
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.xs)
                .semantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            activityGlyph(row.activityKind),
            contentDescription = null,
            size = IconSize.Sm,
            tint = activityTone(row.activityKind),
        )
        CodeText(row.vinTail)
        Badge(text = "${row.activityRaw} \u00b7 $profileText", variant = BadgeVariant.Neutral)
        Spacer(modifier = Modifier.weight(1f))
        Caption("${strings.nextLabel}: $nextValue")
    }
}

private fun breakdownColor(kind: BreakdownKind): Color = paletteColor(breakdownPaletteIndex(kind))

private fun breakdownPaletteIndex(kind: BreakdownKind): Int =
    when (kind) {
        BreakdownKind.FleetTelemetry -> 0
        BreakdownKind.IdleDetection -> 1
        BreakdownKind.Prediction -> 2
        BreakdownKind.Sleep -> 3
    }

private fun activityGlyph(kind: PollingActivityKind): ImageVector =
    when (kind) {
        PollingActivityKind.Active -> DataDisplayGlyphs.Bolt
        PollingActivityKind.Moderate -> DataDisplayGlyphs.BatteryCharging
        PollingActivityKind.Low -> DataDisplayGlyphs.Gauge
        PollingActivityKind.Idle -> DataDisplayGlyphs.Clock
        PollingActivityKind.Sleeping -> DataDisplayGlyphs.Clock
        PollingActivityKind.Unknown -> DataDisplayGlyphs.Gauge
    }

@Composable
private fun activityTone(kind: PollingActivityKind): Color =
    when (kind) {
        PollingActivityKind.Active -> TeslaTokens.status.success
        PollingActivityKind.Moderate -> TeslaTokens.status.info
        PollingActivityKind.Low -> TeslaTokens.status.warning
        PollingActivityKind.Idle, PollingActivityKind.Sleeping, PollingActivityKind.Unknown ->
            MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun profileLabel(
    strings: PollingEngineStrings,
    row: VehicleRowView,
): String =
    when (row.profileKind) {
        PollingProfileKind.Driving -> strings.profileDriving
        PollingProfileKind.Charging -> strings.profileCharging
        PollingProfileKind.Idle -> strings.profileIdle
        PollingProfileKind.Sleeping -> strings.profileSleeping
        PollingProfileKind.Other -> row.profileRaw
    }

private fun nextPollValue(
    row: VehicleRowView,
    strings: PollingEngineStrings,
): String =
    when {
        row.isNow -> strings.nowLabel
        row.countdownText != null -> row.countdownText
        else -> PollingEngineRegistration.EMPTY_VALUE
    }

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberPollingEngineStrings(): PollingEngineStrings =
    PollingEngineStrings(
        title = stringResource(R.string.translation_Savings),
        active = stringResource(R.string.translation_common_active),
        vehicleActivity = stringResource(R.string.translation_Vehicles),
        noVehicles = stringResource(R.string.translation_analytics_overview_noVehicles),
        nextLabel = stringResource(R.string.translation_Next),
        nowLabel = stringResource(R.string.translation_Now),
        pollsSaved = stringResource(R.string.translation_polling_pollsSaved),
        savedAmount = stringResource(R.string.translation_polling_savedAmount),
        pollsMade = stringResource(R.string.translation_polling_pollsMade),
        creditLeft = stringResource(R.string.translation_polling_creditLeft),
        fleetTelemetry = stringResource(R.string.translation_polling_fleetTelemetry),
        idleDetection = stringResource(R.string.translation_polling_idleDetection),
        prediction = stringResource(R.string.translation_polling_prediction),
        sleep = stringResource(R.string.translation_polling_sleep),
        profileDriving = stringResource(R.string.translation_Driving),
        profileCharging = stringResource(R.string.translation_Charging),
        profileIdle = stringResource(R.string.translation_Idle),
        profileSleeping = stringResource(R.string.translation_timeline_sleeping),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
    )

private const val PERCENT_SUFFIX = "%"
private const val CURRENCY_PREFIX = "$"
private const val SAVINGS_STAT_COUNT = 4
private const val HEADER_SKELETON_FRACTION = 0.5f
private const val ROW_SKELETON_FRACTION = 0.9f
private val HEADER_SKELETON_HEIGHT = 20.dp
private val ROW_SKELETON_HEIGHT = 14.dp
private val BAR_HEIGHT: Dp = 8.dp
private val BAR_GAP: Dp = 2.dp
private val LEGEND_DOT_SIZE: Dp = 8.dp

// ── Previews — one per rendered state (loading / content / empty / stale / offline / error). ────────────

private fun previewStrings(): PollingEngineStrings =
    PollingEngineStrings(
        title = "Savings",
        active = "Active",
        vehicleActivity = "Vehicles",
        noVehicles = "No vehicle data",
        nextLabel = "Next",
        nowLabel = "Now",
        pollsSaved = "Polls Saved",
        savedAmount = "$ Saved",
        pollsMade = "Polls Made",
        creditLeft = "Credit Left",
        fleetTelemetry = "Fleet Telemetry",
        idleDetection = "Idle Detection",
        prediction = "Prediction",
        sleep = "Sleep",
        profileDriving = "Driving",
        profileCharging = "Charging",
        profileIdle = "Idle",
        profileSleeping = "Sleeping",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
    )

private fun previewSavings(): PollingSavingsView =
    PollingSavingsView(
        savingsPercentText = "42.5",
        estimatedSavingsText = "12.30",
        pollsMadeText = "1840",
        remainingCreditText = "5.00",
        hasBreakdown = true,
        segments =
            listOf(
                BreakdownSegment(BreakdownKind.FleetTelemetry, 0.50f),
                BreakdownSegment(BreakdownKind.IdleDetection, 0.30f),
                BreakdownSegment(BreakdownKind.Prediction, 0.15f),
                BreakdownSegment(BreakdownKind.Sleep, 0.05f),
            ),
    )

private fun previewVehicles(): List<VehicleRowView> =
    listOf(
        VehicleRowView(
            vinTail = "ABCD1234",
            activityRaw = "active",
            activityKind = PollingActivityKind.Active,
            profileKind = PollingProfileKind.Driving,
            profileRaw = "driving",
            countdownText = "5m",
            isNow = false,
        ),
        VehicleRowView(
            vinTail = "EFGH5678",
            activityRaw = "idle",
            activityKind = PollingActivityKind.Idle,
            profileKind = PollingProfileKind.Idle,
            profileRaw = "idle",
            countdownText = null,
            isNow = true,
        ),
    )

@Preview(name = "PollingEngine · loading", showBackground = true)
@Composable
private fun PollingEngineLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PollingEngineContent(display = PollingDisplay(phase = PollingPhase.Loading), strings = previewStrings())
    }
}

@Preview(name = "PollingEngine · content", showBackground = true)
@Composable
private fun PollingEngineContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PollingEngineContent(
            display =
                PollingDisplay(
                    phase = PollingPhase.Content,
                    savings = previewSavings(),
                    vehicles = previewVehicles(),
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "PollingEngine · empty", showBackground = true)
@Composable
private fun PollingEngineEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PollingEngineContent(
            display = PollingDisplay(phase = PollingPhase.Empty, savings = previewSavings()),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "PollingEngine · stale", showBackground = true)
@Composable
private fun PollingEngineStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PollingEngineContent(
            display =
                PollingDisplay(
                    phase = PollingPhase.Content,
                    savings = previewSavings(),
                    vehicles = previewVehicles(),
                    stale = true,
                    refreshing = true,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "PollingEngine · offline", showBackground = true)
@Composable
private fun PollingEngineOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PollingEngineContent(
            display =
                PollingDisplay(
                    phase = PollingPhase.Content,
                    savings = previewSavings(),
                    vehicles = previewVehicles(),
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "PollingEngine · error", showBackground = true)
@Composable
private fun PollingEngineErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PollingEngineContent(
            display =
                PollingDisplay(
                    phase = PollingPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = PREVIEW_HTTP_SERVER_ERROR,
                ),
            strings = previewStrings(),
        )
    }
}

private const val PREVIEW_HTTP_SERVER_ERROR = 503
