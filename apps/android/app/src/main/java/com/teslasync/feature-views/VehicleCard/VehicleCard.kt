// The native Jetpack Compose + Material 3 VehicleCard feature view — a parity port of
// web/src/features/vehicles/components/VehicleCard.tsx. The web component takes a `vehicle` prop and binds
// `useVehicleState(vehicle.id)` itself, then renders a `GlassPanel` with a gradient accent strip, a
// `TeslaCarViz` (which ALWAYS renders, defaulting battery to 50 / locked to true with no live state), the
// vehicle name (a link to its detail) + a `StatusBadge`, a model/trim/vin subtitle, and — only when a live
// `state` is present — a stats row (battery `ProgressRing` + percent + rated range, the inside temperature, the
// odometer + unit, the charger power while charging, and lock / sentry glyphs), plus two icon actions (open
// details, remove).
//
// This port keeps that contract end to end and adds the lifecycle chrome every native surface must render. It
// performs NO HTTP: it binds the shared last-known-state feed (P1/S8) via a [VehicleCardViewModel] keyed to the
// card's OWN vehicle (so each card in a list tracks its own state, exactly like the web `vehicles.map`). The
// card chrome (car viz + name + status + subtitle + actions) always renders; only the inner stats region
// switches across the states the feed carries — loading (skeleton), hard error with no cache (offline + retry),
// content (the live stats), asleep/empty (a "wake to see live data" hint), and stale/offline (cached stats +
// a freshness chip + auto-refresh) — so no part of the card is ever blank. SI distance / temperature values are
// converted at this render boundary via the shared [UnitFormatter] (web `useUnits()`); every visible string
// resolves through the generated i18n catalog (P1/S10); and the car viz, each stat, and each action carry
// TalkBack labels. The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleCard) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.CarVizSize
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.ProgressRing
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.datadisplay.TeslaCarViz
import io.teslasync.android.components.datadisplay.TeslaVehicleViz
import io.teslasync.android.components.datadisplay.parseModelKey
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import java.util.Locale
import kotlin.time.Instant

/** The car viz size (web `size="sm"`). */
private val CARD_VIZ_SIZE = CarVizSize.Sm

/** Gradient accent strip — the web `h-1 bg-gradient-to-r from-cyan via-purple to-green opacity-40`. */
private val ACCENT_STRIP_HEIGHT: Dp = 4.dp
private const val ACCENT_STRIP_ALPHA = 0.5f

/** Battery `ProgressRing` sizing (web `size={36} strokeWidth={3}`). */
private val BATTERY_RING_SIZE: Dp = 36.dp
private val BATTERY_RING_STROKE: Dp = 3.dp

/** The loading-skeleton stat-cell height. */
private val STAT_SKELETON_HEIGHT: Dp = 36.dp
private const val STAT_SKELETON_COUNT = 3

/** ViewModel key prefix — each card keys its own per-vehicle ViewModel so a list of cards stays independent. */
private const val VEHICLE_CARD_VM_KEY = "vehicle-card-"

/**
 * Stateful entry point — the faithful 1:1 port of the web `VehicleCard({ vehicle, onDelete })`. Binds the
 * shared last-known-state feed for THIS [vehicle] via [source] into a [VehicleCardViewModel] (the web
 * `useVehicleState(vehicle.id)`), records the one-shot `view.opened` diagnostic (P1/S11), resolves the live
 * display-[UnitFormatter] (web `useUnits()`, P1/S8) and the localized [VehicleCardStrings] (P1/S10), and
 * renders. The host supplies the navigation + delete callbacks; this view never performs HTTP.
 *
 * @param vehicle the card's vehicle (web `vehicle` prop).
 * @param onDelete invoked with [vehicle] when the remove action is tapped (web `onDelete`).
 * @param onOpenDetails invoked with the vehicle id when the name or the open-details action is tapped (web
 *   `<Link to="/vehicles/{id}">`).
 */
@Composable
fun VehicleCard(
    vehicle: Vehicle,
    onDelete: (Vehicle) -> Unit,
    onOpenDetails: (Long) -> Unit,
    modifier: Modifier = Modifier,
    source: VehicleCardSource = LocalDataContainer.current.vehiclesStore.asVehicleCardSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: VehicleCardViewModel =
        viewModel(
            key = "$VEHICLE_CARD_VM_KEY${vehicle.id}",
            factory = VehicleCardViewModel.factory(source, vehicle.id, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    VehicleCardContent(
        vehicle = vehicle,
        state = state,
        formatter = formatter,
        onDelete = { onDelete(vehicle) },
        onOpenDetails = { onOpenDetails(vehicle.id) },
        onRetry = viewModel::refresh,
        modifier = modifier,
    )
}

/** Resolves the surface's localized labels from the generated catalog (P1/S10) — the `card.*` keys the web reads. */
@Composable
fun rememberVehicleCardStrings(): VehicleCardStrings =
    VehicleCardStrings(
        interior = stringResource(R.string.translation_card_interior),
        charging = stringResource(R.string.translation_card_charging),
        viewDetails = stringResource(R.string.translation_card_viewDetails),
        removeVehicle = stringResource(R.string.translation_card_removeVehicle),
        asleep = stringResource(R.string.translation_hero_asleep),
    )

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The accent strip, car
 * viz, name + status, subtitle, and the two actions always render; the inner stats region then shows the
 * skeleton while the first load is in flight, an offline + retry affordance on a hard failure with no cache, the
 * live stats when a state is present (web `state` truthy), or the "asleep" hint otherwise. A stale/offline
 * cached state keeps its stats visible with a freshness chip flagged and auto-refreshes. No surface is blank.
 */
@Composable
fun VehicleCardContent(
    vehicle: Vehicle,
    state: UiState<VehicleStateEnvelope>,
    modifier: Modifier = Modifier,
    formatter: UnitFormatter = UnitFormatter.default(),
    strings: VehicleCardStrings = rememberVehicleCardStrings(),
    locale: Locale = Locale.getDefault(),
    onDelete: () -> Unit = {},
    onOpenDetails: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRetry()
    }
    val display =
        remember(vehicle, state.data, formatter, strings, locale) {
            VehicleCardProjection.project(vehicle, state.data?.state, formatter, strings, locale)
        }
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.None) {
            AccentStrip()
            Row(
                modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                verticalAlignment = Alignment.Top,
            ) {
                VehicleCardViz(display)
                VehicleCardInfo(
                    display = display,
                    state = state,
                    strings = strings,
                    onOpenDetails = onOpenDetails,
                    onRetry = onRetry,
                    modifier = Modifier.weight(1f),
                )
                VehicleCardActions(strings = strings, onOpenDetails = onOpenDetails, onDelete = onDelete)
            }
        }
    }
}

/** The gradient accent strip across the top of the card (web cyan → purple → green wash). */
@Composable
private fun AccentStrip() {
    val brush =
        Brush.horizontalGradient(
            listOf(
                TeslaTokens.chart.regen.copy(alpha = ACCENT_STRIP_ALPHA),
                TeslaTokens.chart.power.copy(alpha = ACCENT_STRIP_ALPHA),
                TeslaTokens.chart.battery.copy(alpha = ACCENT_STRIP_ALPHA),
            ),
        )
    Box(modifier = Modifier.fillMaxWidth().height(ACCENT_STRIP_HEIGHT).background(brush))
}

/** The stylized car visualization, always rendered (web defaults battery 50 / locked when no live state). */
@Composable
private fun VehicleCardViz(display: VehicleCardDisplay) {
    TeslaCarViz(
        state =
            TeslaVehicleViz(
                batteryLevelPct = display.vizBatteryLevel,
                isCharging = display.isCharging,
                isLocked = display.isLocked,
                isClimateOn = false,
                sentryMode = display.sentryMode,
                speedText = null,
            ),
        model = parseModelKey(display.modelKey),
        size = CARD_VIZ_SIZE,
    )
}

/** The middle column: the clickable name + status (+ freshness), the subtitle, and the stats region. */
@Composable
private fun VehicleCardInfo(
    display: VehicleCardDisplay,
    state: UiState<VehicleStateEnvelope>,
    strings: VehicleCardStrings,
    onOpenDetails: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Heading(
                text = display.name,
                level = HeadingLevel.Section,
                maxLines = 1,
                modifier =
                    Modifier
                        .weight(1f, fill = false)
                        .clickable(onClickLabel = strings.viewDetails) { onOpenDetails() }
                        .semantics { heading() },
            )
            StatusBadge(status = display.status, size = ChipSize.Sm)
            CardFreshness(state = state)
        }
        Caption(display.subtitle)
        VehicleCardStatsRegion(display = display, state = state, strings = strings, onRetry = onRetry)
    }
}

/** The compact freshness chip — shown once a fetch has run, flagging refreshing / stale / offline (web parity chrome). */
@Composable
private fun CardFreshness(state: UiState<VehicleStateEnvelope>) {
    if ((state.fetchedAt ?: 0L) > 0L || state.refreshing || state.hasError) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberCardFreshnessFormatter(),
        )
    }
}

/** Switches the inner stats region across the live-state feed's surfaces; the card chrome above always renders. */
@Composable
private fun VehicleCardStatsRegion(
    display: VehicleCardDisplay,
    state: UiState<VehicleStateEnvelope>,
    strings: VehicleCardStrings,
    onRetry: () -> Unit,
) {
    when (vehicleCardStatsSurface(state)) {
        VehicleCardStatsSurface.Loading -> StatsLoading()
        VehicleCardStatsSurface.Error -> StatsError(onRetry = onRetry)
        VehicleCardStatsSurface.Content -> StatsRow(display = display, strings = strings)
        VehicleCardStatsSurface.Empty -> Caption(strings.asleep)
    }
}

/** The live stats — the web flex-wrap row of battery, interior, odometer, optional charging, and lock/sentry. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StatsRow(
    display: VehicleCardDisplay,
    strings: VehicleCardStrings,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        BatteryStat(display = display)
        StatCell(value = display.interiorText, label = strings.interior)
        StatCell(value = display.odometerText, label = display.distanceUnitLabel)
        if (display.isCharging) {
            StatCell(value = display.chargerPowerText, label = strings.charging, valueColor = TeslaTokens.status.success)
        }
        SecurityGlyphs(display = display)
    }
}

/** The battery cell: the `ProgressRing` arc beside the percentage + the rated range (web battery block). */
@Composable
private fun BatteryStat(display: VehicleCardDisplay) {
    Row(
        modifier =
            Modifier.semantics(mergeDescendants = true) {
                contentDescription = "${display.batteryPercentText}, ${display.rangeText}"
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        ProgressRing(
            value = display.vizBatteryLevel,
            size = BATTERY_RING_SIZE,
            strokeWidth = BATTERY_RING_STROKE,
            color = batteryAccentColor(display.batteryAccent),
        )
        Column {
            Text(
                text = display.batteryPercentText,
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            MetricLabel(display.rangeText)
        }
    }
}

/** A centered value-over-label stat cell (interior temp / odometer / charging) — merged for TalkBack. */
@Composable
private fun StatCell(
    value: String,
    label: String,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Column(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "$label, $value" },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium),
            color = valueColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        MetricLabel(label)
    }
}

/** The lock + sentry glyphs (web `Lock`/`Shield`), shown only when active; the row carries a spoken label. */
@Composable
private fun SecurityGlyphs(display: VehicleCardDisplay) {
    if (!display.isLocked && !display.sentryMode) return
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (display.isLocked) {
            Icon(
                imageVector = DataDisplayGlyphs.Lock,
                contentDescription = stringResource(R.string.translation_common_locked),
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
        }
        if (display.sentryMode) {
            Icon(
                imageVector = DataDisplayGlyphs.Shield,
                contentDescription = stringResource(R.string.translation_common_sentry),
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
        }
    }
}

/** The first-load skeleton stats — graduated bars, never a blank region (the card chrome still renders). */
@Composable
private fun StatsLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(STAT_SKELETON_COUNT) {
            Column(modifier = Modifier.weight(1f)) {
                Skeleton(height = STAT_SKELETON_HEIGHT, rounded = true)
            }
        }
    }
}

/** The hard-error stats region — an offline marker + a retry, keeping the card chrome (web has no error here). */
@Composable
private fun StatsError(onRetry: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.WifiOff,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.danger,
        )
        Caption(stringResource(R.string.translation_common_offline))
        Button(
            label = stringResource(R.string.translation_common_retry),
            onClick = onRetry,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/** The right column: the open-details + remove icon actions, each with a spoken accessible name. */
@Composable
private fun VehicleCardActions(
    strings: VehicleCardStrings,
    onOpenDetails: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        IconButton(
            imageVector = DataDisplayGlyphs.ExternalLink,
            contentDescription = strings.viewDetails,
            onClick = onOpenDetails,
            size = IconSize.Sm,
        )
        IconButton(
            imageVector = VehicleCardGlyphs.Trash,
            contentDescription = strings.removeVehicle,
            onClick = onDelete,
            size = IconSize.Sm,
            tint = TeslaTokens.status.danger,
        )
    }
}

/** The arc color for the battery ring — design-token roles, never raw hex or neon (web `batteryColor`). */
@Composable
private fun batteryAccentColor(accent: BatteryAccent): Color =
    when (accent) {
        BatteryAccent.Good -> TeslaTokens.status.success
        BatteryAccent.Warn -> TeslaTokens.status.warning
        BatteryAccent.Danger -> TeslaTokens.status.danger
    }

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberCardFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> CARD_EM_DASH
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

// ── Previews (tooling-only; one @Preview entry per rendered stats-region state) ──────────────────────

private val PREVIEW_VEHICLE: Vehicle =
    Vehicle(
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
        displayName = "My Model 3",
        enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
        id = 1L,
        teslaId = 42L,
        timezone = "UTC",
        updatedAt = Instant.parse("2026-06-01T00:00:00Z"),
        vin = "5YJ3E1EA7KF000001",
        model = "Model 3",
        trimLevel = "Long Range",
    )

@Suppress("LongParameterList")
private fun previewState(
    batteryLevel: Long = 72,
    speed: Double = 0.0,
    isCharging: Boolean = false,
    chargerPower: Double = 0.0,
    isLocked: Boolean = true,
    sentryMode: Boolean = false,
    state: String = "online",
): VehicleState =
    VehicleState(
        batteryLevel = batteryLevel,
        chargeRate = 0.0,
        chargerPower = chargerPower,
        idealRange = 380_000.0,
        insideTemp = 21.5,
        isCharging = isCharging,
        isClimateOn = false,
        isLocked = isLocked,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 42_000_000.0,
        outsideTemp = 12.0,
        power = 0.0,
        ratedRange = 350_000.0,
        sentryMode = sentryMode,
        softwareVersion = "2026.20.1",
        speed = speed,
        state = state,
        timeToFullCharge = 0.0,
        vehicleId = 1L,
    )

private fun previewUiState(
    state: VehicleState?,
    phase: UiPhase = UiPhase.Content,
): UiState<VehicleStateEnvelope> =
    UiState(
        phase = phase,
        data = if (phase == UiPhase.Loading) null else VehicleStateEnvelope(state, live = state != null),
        fetchedAt = if (phase == UiPhase.Loading) null else 1_700_000_000_000L,
    )

@Preview(name = "VehicleCard · idle", showBackground = true)
@Composable
private fun VehicleCardIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleCardContent(vehicle = PREVIEW_VEHICLE, state = previewUiState(previewState()))
    }
}

@Preview(name = "VehicleCard · charging", showBackground = true)
@Composable
private fun VehicleCardChargingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleCardContent(
            vehicle = PREVIEW_VEHICLE,
            state = previewUiState(previewState(batteryLevel = 54, isCharging = true, chargerPower = 48.4, state = "charging")),
        )
    }
}

@Preview(name = "VehicleCard · asleep / empty", showBackground = true)
@Composable
private fun VehicleCardAsleepPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleCardContent(vehicle = PREVIEW_VEHICLE, state = previewUiState(state = null, phase = UiPhase.Empty))
    }
}

@Preview(name = "VehicleCard · loading", showBackground = true)
@Composable
private fun VehicleCardLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleCardContent(vehicle = PREVIEW_VEHICLE, state = previewUiState(state = null, phase = UiPhase.Loading))
    }
}
