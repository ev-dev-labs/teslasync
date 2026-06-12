// The native Jetpack Compose + Material 3 LiveTelemetryPanels feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx and its seven child panels.
// The web component renders a "Live Telemetry" section header (a pulsing live dot beside the title) above a
// responsive 1 → 2 column grid of seven GlassPanels: Powertrain, Climate, Security, Vehicle State, Tire
// Pressure, Energy & Charging, Media & Navigation. Each data-bearing panel shows a small header (tinted glyph
// + title) and then either its rows (when its data prop is present) or a friendly empty surface (web
// `<EmptyState/>` or an inline "No … data" caption) when absent — so no panel is ever a blank box. Within the
// rows every value still degrades to the web em dash / "Unknown" / "Off" / "Closed" branch. The Vehicle State
// panel always renders (the web source gives it no empty branch) and shows a "Live" chip while the stream is
// connected; the Media panel always renders both of its sub-sections, each with its own empty caption.
//
// This port keeps that contract: the grid reflows 1 → 2 columns at the web `lg` (1024px) breakpoint, each
// panel header tints its lucide-equivalent glyph with the web accent, and every label, value, badge, chip and
// the section title resolves through the generated i18n catalog (P1/S10) — there is no translatable English
// literal in this file (the only non-key strings are unit symbols the web also hard-codes — "kW", "RPM",
// "Nm", "V", "A", "%", the em dash — the centre-zero power-bar scale, and the decorative status marks/emojis).
// The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition. All SI→display conversion
// happens in the pure [LiveTelemetryPanelsProjection]; this composable is a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveTelemetryPanels) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livetelemetrypanels

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonPrimitive

/** Tailwind `lg` (1024px) breakpoint — the web `grid-cols-1 lg:grid-cols-2` reflow. */
private val GRID_TWO_COLUMN_MIN_WIDTH: Dp = 1024.dp
private const val GRID_COLUMNS_BASE = 1
private const val GRID_COLUMNS_LG = 2

private val LIVE_DOT_SIZE: Dp = 10.dp
private val SMALL_DOT_SIZE: Dp = 6.dp

/** Web `FadeIn` entry delays (seconds -> millis): the section header, then the seven panels in render order. */
private const val HEADER_DELAY_MS = 120
private val PANEL_DELAYS_MS = listOf(140, 160, 180, 190, 200, 220, 240)

private val LOCK_ICON_BOX_PADDING: Dp = 12.dp
private val POWER_BAR_HEIGHT: Dp = 12.dp
private val FAN_BAR_HEIGHT: Dp = 12.dp
private val DIVIDER_HEIGHT: Dp = 1.dp
private const val CHIP_BACKGROUND_ALPHA = 0.16f
private const val LOCK_BOX_BACKGROUND_ALPHA = 0.12f
private const val SUBTLE_FILL_ALPHA = 0.5f

/** Web power-bar scale captions (`-300` / `0` / `+300`); hard-coded numerals, no i18n. */
private const val POWER_SCALE_MIN = "-300"
private const val POWER_SCALE_ZERO = "0"
private const val POWER_SCALE_MAX = "+300"

/** Fan-level bar widths (web `w-1.5 … w-4`), one per of the six levels. */
private val FAN_BAR_WIDTHS: List<Dp> = listOf(6.dp, 8.dp, 10.dp, 12.dp, 14.dp, 16.dp)

/**
 * Stateful entry point — the faithful 1:1 port of the web `LiveTelemetryPanels({ ...props })`. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), collects the live SI→display
 * [UnitFormatter] (the web `useUnits` boundary), projects the optional panel inputs onto a
 * [LiveTelemetryPanelsDisplay] via the pure [LiveTelemetryPanelsProjection], and renders.
 *
 * @param data the optional panel inputs (web `motorData` / `climateData` / `securityData` / `live` /
 *   `tireData` / `chargingTelemetry` / `mediaData` / `locationData` / `remoteStartEnabled` + `sseConnected`).
 *   The owning vehicle-detail page supplies them and owns each query's loading / error / stale / offline
 *   handling, so this presentational surface renders only the per-panel rows-or-empty branches.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveTelemetryPanels(
    data: LiveTelemetryPanelsData,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LiveTelemetryPanelsDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val display = remember(data, formatter) { LiveTelemetryPanelsProjection.project(data, formatter) }
    LiveTelemetryPanelsContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the "Live Telemetry" section header
 * and then the responsive grid of seven panels; each data-bearing panel renders its rows when content is
 * present and its empty surface when it is `null` — never a hidden surface.
 */
@Composable
fun LiveTelemetryPanelsContent(
    display: LiveTelemetryPanelsDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        FadeIn(delayMs = HEADER_DELAY_MS) { SectionHeader() }
        PanelGrid(display = display)
    }
}

/** Web section header: a pulsing green live dot beside the bold "Live Telemetry" title. */
@Composable
private fun SectionHeader(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(
            modifier =
                Modifier
                    .size(LIVE_DOT_SIZE)
                    .clip(CircleShape)
                    .background(TeslaTokens.status.success),
        )
        Text(
            text = stringResource(R.string.translation_common_liveTelemetry),
            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/**
 * The responsive 1 → 2 column grid (web `grid-cols-1 lg:grid-cols-2`). Picks the column count from available
 * width and lays the seven panels out as weighted rows so every panel shares a uniform width; a short final
 * row is padded with an empty weighted slot so its panel keeps the same width.
 */
@Composable
private fun PanelGrid(
    display: LiveTelemetryPanelsDisplay,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_TWO_COLUMN_MIN_WIDTH) GRID_COLUMNS_LG else GRID_COLUMNS_BASE
        val panels = panelRenderers(display).zip(PANEL_DELAYS_MS)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            panels.chunked(columns).forEach { rowPanels ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                ) {
                    rowPanels.forEach { (panel, delayMs) ->
                        Box(modifier = Modifier.weight(1f)) {
                            FadeIn(delayMs = delayMs) { panel() }
                        }
                    }
                    repeat(columns - rowPanels.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/** The seven panels in the web render order, each a composable lambda the grid lays out. */
private fun panelRenderers(display: LiveTelemetryPanelsDisplay): List<@Composable () -> Unit> =
    listOf(
        { PowertrainPanel(display.powertrain) },
        { ClimatePanel(display.climate) },
        { SecurityPanel(display.security) },
        { VehicleStatePanel(display.vehicleState, display.sseConnected) },
        { TirePressurePanel(display.tire) },
        { EnergyChargingPanel(display.energy) },
        { MediaNavigationPanel(display.media) },
    )

// ── Powertrain ──────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun PowertrainPanel(content: PowertrainContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_common_powertrain),
        icon = LiveTelemetryPanelsGlyphs.Cog,
        iconTint = TeslaTokens.status.info,
    ) {
        if (content == null) {
            EmptyState(message = stringResource(R.string.translation_telemetry_noMotorData))
            return@TelemetryPanel
        }
        BadgeRow(
            label = stringResource(R.string.translation_telemetry_shiftState),
            text = content.shiftText ?: stringResource(R.string.translation_common_unknown),
            tone = content.shiftTone,
            leadingIcon = LiveTelemetryPanelsGlyphs.CircleDot,
        )
        PowerBarRow(content.powerText, content.powerFill)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MetricTile(stringResource(R.string.translation_telemetry_rpmFront), content.rpmFrontText, RPM_UNIT, Modifier.weight(1f))
            MetricTile(stringResource(R.string.translation_telemetry_rpmRear), content.rpmRearText, RPM_UNIT, Modifier.weight(1f))
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MetricTile(
                label = stringResource(R.string.translation_telemetry_torqueFront),
                value = content.torqueFrontText,
                subtitle = TORQUE_UNIT,
                modifier = Modifier.weight(1f),
            )
            MetricTile(
                label = stringResource(R.string.translation_telemetry_torqueRear),
                value = content.torqueRearText,
                subtitle = TORQUE_UNIT,
                modifier = Modifier.weight(1f),
            )
        }
        LabelValueRow(
            label = stringResource(R.string.translation_telemetry_motorTemp),
            value = content.motorTempText,
            valueColor = if (content.motorTempHot) TeslaTokens.status.danger else MaterialTheme.colorScheme.onSurface,
        )
        LabelValueRow(
            label = stringResource(R.string.translation_telemetry_inverterTemp),
            value = content.inverterTempText,
        )
        LabelValueRow(
            label = stringResource(R.string.translation_telemetry_regen),
            value = content.regenText,
            valueColor = TeslaTokens.status.success,
        )
    }
}

/** Web centre-zero power bar: a positive read fills right (green), a negative read fills left (red). */
@Composable
private fun PowerBarRow(
    powerText: String,
    fill: PowerFill?,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        LabelValueRow(label = stringResource(R.string.translation_telemetry_power), value = powerText)
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(POWER_BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SUBTLE_FILL_ALPHA)),
        ) {
            Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.CenterEnd) {
                if (fill != null && !fill.positive) {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth(fill.fraction.coerceIn(0f, 1f))
                                .fillMaxHeight()
                                .clip(RoundedCornerShape(Radius.pill))
                                .background(TeslaTokens.status.danger),
                    )
                }
            }
            Box(modifier = Modifier.width(DIVIDER_HEIGHT).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant))
            Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.CenterStart) {
                if (fill != null && fill.positive) {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth(fill.fraction.coerceIn(0f, 1f))
                                .fillMaxHeight()
                                .clip(RoundedCornerShape(Radius.pill))
                                .background(TeslaTokens.status.success),
                    )
                }
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Caption(POWER_SCALE_MIN)
            Caption(POWER_SCALE_ZERO)
            Caption(POWER_SCALE_MAX)
        }
    }
}

// ── Climate ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ClimatePanel(content: ClimateContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_common_climate),
        icon = LiveTelemetryPanelsGlyphs.Thermometer,
        iconTint = TeslaTokens.status.info,
    ) {
        if (content == null) {
            EmptyState(message = stringResource(R.string.translation_telemetry_noClimateData))
            return@TelemetryPanel
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MetricTile(stringResource(R.string.translation_common_insideTemp), content.cabinText, null, Modifier.weight(1f))
            MetricTile(stringResource(R.string.translation_common_outsideTemp), content.outsideText, null, Modifier.weight(1f))
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                LabelValueRow(stringResource(R.string.translation_telemetry_driverSetpoint), content.driverSetpointText)
            }
            Box(modifier = Modifier.weight(1f)) {
                LabelValueRow(stringResource(R.string.translation_telemetry_passengerSetpoint), content.passengerSetpointText)
            }
        }
        LabelValueRow(stringResource(R.string.translation_telemetry_hvacState), content.hvacStateText)
        FanSpeedRow(content.fanLevel)
        ClimateChips(content)
    }
}

/** Web fan-speed row: six widening level bars filled up to the current level, then the numeric level. */
@Composable
private fun FanSpeedRow(level: Int) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(text = stringResource(R.string.translation_telemetry_fanSpeed), icon = LiveTelemetryPanelsGlyphs.Fan)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            FAN_BAR_WIDTHS.forEachIndexed { index, barWidth ->
                Box(
                    modifier =
                        Modifier
                            .width(barWidth)
                            .height(FAN_BAR_HEIGHT)
                            .clip(RoundedCornerShape(Radius.sm))
                            .background(
                                if (level >= index + 1) {
                                    TeslaTokens.status.info
                                } else {
                                    MaterialTheme.colorScheme.surfaceVariant
                                },
                            ),
                )
            }
            Text(
                text = level.toString(),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/** Web climate chips: Defrost (blue when active), Climate (green when on), Precondition (amber when on). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ClimateChips(content: ClimateContent) {
    val offText = stringResource(R.string.translation_common_off)
    val onText = stringResource(R.string.translation_common_on)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        StatusChip(
            icon = DataDisplayGlyphs.Snowflake,
            label = "${stringResource(R.string.translation_telemetry_defrost)} ${content.defrostModeValue ?: offText}",
            active = content.defrostActive,
            activeTint = TeslaTokens.chart.speed,
        )
        StatusChip(
            icon = DataDisplayGlyphs.Bolt,
            label = "${stringResource(R.string.translation_telemetry_climate)} ${if (content.climateOn) onText else offText}",
            active = content.climateOn,
            activeTint = TeslaTokens.status.success,
        )
        StatusChip(
            icon = null,
            label = "${stringResource(R.string.translation_telemetry_precondition)} ${if (content.preconditioning) onText else offText}",
            active = content.preconditioning,
            activeTint = TeslaTokens.status.warning,
        )
    }
}

// ── Security ────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SecurityPanel(content: SecurityContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_common_security),
        icon = DataDisplayGlyphs.Shield,
        iconTint = TeslaTokens.status.info,
    ) {
        if (content == null) {
            EmptyState(message = stringResource(R.string.translation_telemetry_noSecurityData))
            return@TelemetryPanel
        }
        content.rows?.let { rows ->
            LockStatusBlock(rows.locked)
            BadgeRow(
                label = stringResource(R.string.translation_telemetry_sentryMode),
                text =
                    if (rows.sentryOn) {
                        stringResource(R.string.translation_common_active)
                    } else {
                        stringResource(R.string.translation_common_inactive)
                    },
                tone = if (rows.sentryOn) BadgeTone.Danger else BadgeTone.Neutral,
                leadingIcon = LiveTelemetryPanelsGlyphs.ShieldAlert,
            )
            LabelValueRow(
                label = stringResource(R.string.translation_telemetry_doors),
                value = rows.doorsValue ?: stringResource(R.string.translation_common_closed),
                leadingIcon = LiveTelemetryPanelsGlyphs.DoorClosed,
            )
            LabelValueRow(
                label = stringResource(R.string.translation_telemetry_windows),
                value = rows.windowsValue ?: stringResource(R.string.translation_common_closed),
            )
            BinaryRow(
                label = stringResource(R.string.translation_telemetry_userPresent),
                on = rows.userPresent,
                onText = stringResource(R.string.translation_common_yes),
                offText = stringResource(R.string.translation_common_no),
                onColor = TeslaTokens.status.success,
                leadingIcon = DataDisplayGlyphs.Person,
            )
            rows.detail?.let { detail ->
                Text(
                    text = detail,
                    style = MaterialTheme.typography.labelSmall.copy(fontStyle = FontStyle.Italic),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        RemoteStartRow(content.remoteStart)
    }
}

/** Web lock block: a tinted icon tile beside the localized lock state and its caption. */
@Composable
private fun LockStatusBlock(locked: Boolean) {
    val accent = if (locked) TeslaTokens.status.success else TeslaTokens.status.warning
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Box(
            modifier =
                Modifier
                    .clip(RoundedCornerShape(Radius.md))
                    .background(accent.copy(alpha = LOCK_BOX_BACKGROUND_ALPHA))
                    .padding(LOCK_ICON_BOX_PADDING),
        ) {
            Icon(
                imageVector = if (locked) DataDisplayGlyphs.Lock else LiveTelemetryPanelsGlyphs.Unlock,
                contentDescription = null,
                size = IconSize.Lg,
                tint = accent,
            )
        }
        Column {
            Text(
                text =
                    if (locked) {
                        stringResource(R.string.translation_common_locked)
                    } else {
                        stringResource(R.string.translation_common_unlocked)
                    },
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = accent,
            )
            Caption(stringResource(R.string.translation_telemetry_lockStatus))
        }
    }
}

/** Web remote-start row: Enabled (green) / Disabled (muted) / em dash when unknown. */
@Composable
private fun RemoteStartRow(state: RemoteStartState) {
    val (text, color) =
        when (state) {
            RemoteStartState.Enabled -> stringResource(R.string.translation_common_enabled) to TeslaTokens.status.success
            RemoteStartState.Disabled -> stringResource(R.string.translation_common_disabled) to MaterialTheme.colorScheme.onSurfaceVariant
            RemoteStartState.Unknown -> EM_DASH to MaterialTheme.colorScheme.onSurfaceVariant
        }
    LabelValueRow(
        label = stringResource(R.string.translation_telemetry_remoteStart),
        value = text,
        valueColor = color,
        leadingIcon = LiveTelemetryPanelsGlyphs.KeyRound,
    )
}

// ── Vehicle State ───────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun VehicleStatePanel(
    content: VehicleStateContent,
    sseConnected: Boolean,
) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_vehicleState),
        icon = LiveTelemetryPanelsGlyphs.Activity,
        iconTint = TeslaTokens.status.info,
        headerTrailing = if (sseConnected) ({ LiveChip() }) else null,
    ) {
        val offText = stringResource(R.string.translation_common_off)
        BinaryRow(
            label = stringResource(R.string.translation_admin_security_live_highBeams),
            on = content.highBeamsOn,
            onText = stringResource(R.string.translation_common_on),
            offText = offText,
            onColor = TeslaTokens.status.info,
            leadingIcon = LiveTelemetryPanelsGlyphs.Lightbulb,
        )
        TextStateRow(
            label = stringResource(R.string.translation_admin_security_live_turnSignal),
            value = content.turnSignalValue ?: offText,
            active = content.turnSignalValue != null,
            activeColor = TeslaTokens.status.warning,
            leadingIcon = LiveTelemetryPanelsGlyphs.Car,
        )
        BinaryRow(
            label = stringResource(R.string.translation_admin_security_live_hazards),
            on = content.hazardsActive,
            onText = stringResource(R.string.translation_common_active),
            offText = offText,
            onColor = TeslaTokens.status.danger,
            leadingIcon = LiveTelemetryPanelsGlyphs.ShieldAlert,
        )
        PanelDivider()
        BinaryRow(
            label = stringResource(R.string.translation_admin_security_live_driverSeat),
            on = content.driverSeatOccupied,
            onText = stringResource(R.string.translation_admin_security_live_occupied),
            offText = stringResource(R.string.translation_admin_security_live_empty),
            onColor = TeslaTokens.status.success,
            leadingIcon = DataDisplayGlyphs.Person,
        )
        LabelValueRow(
            label = stringResource(R.string.translation_admin_security_live_pairedKeys),
            value = content.pairedKeysText,
            leadingIcon = LiveTelemetryPanelsGlyphs.KeyRound,
        )
        PanelDivider()
        BinaryRow(
            label = stringResource(R.string.translation_admin_security_live_valetMode),
            on = content.valetEnabled,
            onText = stringResource(R.string.translation_common_enabled),
            offText = offText,
            onColor = TeslaTokens.chart.power,
            leadingIcon = LiveTelemetryPanelsGlyphs.Car,
        )
        BinaryRow(
            label = stringResource(R.string.translation_admin_security_live_serviceMode),
            on = content.serviceActive,
            onText = stringResource(R.string.translation_common_active),
            offText = offText,
            onColor = TeslaTokens.status.warning,
            leadingIcon = LiveTelemetryPanelsGlyphs.Settings,
        )
        TextStateRow(
            label = stringResource(R.string.translation_admin_security_live_speedLimit),
            value = content.speedLimitValue ?: offText,
            active = content.speedLimitActive,
            activeColor = TeslaTokens.status.info,
            leadingIcon = DataDisplayGlyphs.Gauge,
        )
        LabelValueRow(
            label = stringResource(R.string.translation_admin_security_live_centerDisplay),
            value = content.centerDisplayText,
            leadingIcon = LiveTelemetryPanelsGlyphs.Monitor,
        )
        LabelValueRow(
            label = stringResource(R.string.translation_admin_security_live_homelinkDevices),
            value = content.homelinkText,
            leadingIcon = DataDisplayGlyphs.MapPin,
        )
    }
}

/** The "Live" chip the Vehicle State header shows while the stream is connected (web `sseConnected`). */
@Composable
private fun LiveChip() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Box(modifier = Modifier.size(SMALL_DOT_SIZE).clip(CircleShape).background(TeslaTokens.status.success))
        Text(
            text = stringResource(R.string.translation_admin_security_live_indicator),
            style = MaterialTheme.typography.labelSmall,
            color = TeslaTokens.status.success,
        )
    }
}

// ── Tire Pressure ───────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun TirePressurePanel(content: TireContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_common_tirePressure),
        icon = DataDisplayGlyphs.Gauge,
        iconTint = TeslaTokens.status.info,
    ) {
        if (content == null) {
            EmptyState(message = stringResource(R.string.translation_vehicles_detail_noTireData))
            return@TelemetryPanel
        }
        content.cells.chunked(2).forEach { rowCells ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowCells.forEach { cell ->
                    TireCellView(cell = cell, modifier = Modifier.weight(1f))
                }
            }
        }
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            TireStatusBadge(content.status)
        }
    }
}

/** One tire corner cell: the corner abbreviation over the colored pressure value, in a status-tinted box. */
@Composable
private fun TireCellView(
    cell: TireCornerCell,
    modifier: Modifier = Modifier,
) {
    val color = tireColor(cell.color)
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(Radius.md))
                .border(1.dp, color.copy(alpha = CHIP_BACKGROUND_ALPHA), RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SUBTLE_FILL_ALPHA))
                .padding(Spacing.md)
                .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(cell.corner.label)
        Text(
            text = cell.valueText,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = color,
        )
    }
}

@Composable
private fun TireStatusBadge(status: TireStatus) {
    when (status) {
        TireStatus.AllNormal ->
            Badge(text = TIRE_OK_MARK + stringResource(R.string.translation_telemetry_allNormal), variant = BadgeVariant.Success)

        TireStatus.Attention ->
            Badge(text = TIRE_BAD_MARK + stringResource(R.string.translation_telemetry_attentionNeeded), variant = BadgeVariant.Danger)

        TireStatus.Check ->
            Badge(text = TIRE_WARN_MARK + stringResource(R.string.translation_widget_tireWarning), variant = BadgeVariant.Warning)
    }
}

// ── Energy & Charging ───────────────────────────────────────────────────────────────────────────────────

@Composable
private fun EnergyChargingPanel(content: EnergyContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_energyCharging),
        icon = DataDisplayGlyphs.BatteryCharging,
        iconTint = TeslaTokens.status.info,
    ) {
        if (content == null) {
            EmptyState(message = stringResource(R.string.translation_telemetry_noChargingTelemetry))
            return@TelemetryPanel
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MetricTile(
                label = stringResource(R.string.translation_telemetry_chargerVoltage),
                value = content.chargerVoltageText,
                subtitle = VOLT_UNIT,
                modifier = Modifier.weight(1f),
            )
            MetricTile(
                label = stringResource(R.string.translation_telemetry_chargerCurrent),
                value = content.chargerCurrentText,
                subtitle = AMP_UNIT,
                modifier = Modifier.weight(1f),
            )
        }
        LabelValueRow(stringResource(R.string.translation_telemetry_chargerPower), content.chargerPowerText)
        LabelValueRow(stringResource(R.string.translation_telemetry_energyAdded), content.energyAddedText)
        BadgeRow(
            label = stringResource(R.string.translation_telemetry_chargingState),
            text = content.chargingStateText ?: stringResource(R.string.translation_common_unknown),
            tone = content.chargingTone,
        )
        LabelValueRow(stringResource(R.string.translation_telemetry_batteryLevel), content.batteryLevelText)
        LabelValueRow(
            label = stringResource(R.string.translation_telemetry_chargeRate),
            value = content.chargeRateText,
            leadingIcon = DataDisplayGlyphs.Bolt,
        )
    }
}

// ── Media & Navigation ──────────────────────────────────────────────────────────────────────────────────

@Composable
private fun MediaNavigationPanel(content: MediaContent) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_mediaNav),
        icon = LiveTelemetryPanelsGlyphs.Headphones,
        iconTint = TeslaTokens.chart.power,
    ) {
        NowPlayingSection(content.nowPlaying)
        NavigationSection(content.navigation)
    }
}

@Composable
private fun NowPlayingSection(content: NowPlayingContent?) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(stringResource(R.string.translation_telemetry_nowPlaying))
        if (content == null) {
            Caption(stringResource(R.string.translation_telemetry_noMediaData))
        } else {
            NowPlayingCard(content)
        }
    }
}

@Composable
private fun NowPlayingCard(content: NowPlayingContent) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SUBTLE_FILL_ALPHA))
                .padding(Spacing.md)
                .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = content.titleValue ?: stringResource(R.string.translation_telemetry_nothingPlaying),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = content.artistValue ?: stringResource(R.string.translation_telemetry_unknownArtist),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (content.sourceValue != null || content.statusValue != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                content.sourceValue?.let { Badge(text = it, variant = BadgeVariant.Neutral) }
                content.statusValue?.let { Badge(text = it, variant = badgeVariant(content.statusTone)) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NavigationSection(content: NavigationContent?) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        RowLabel(text = stringResource(R.string.translation_telemetry_navigation), icon = LiveTelemetryPanelsGlyphs.Navigation2)
        if (content == null) {
            Caption(stringResource(R.string.translation_telemetry_noLocationData))
        } else {
            if (content.destination != null) {
                DestinationCard(content.destination)
            } else {
                Caption(stringResource(R.string.translation_telemetry_noActiveDestination))
            }
            if (content.places.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    content.places.forEach { place ->
                        PlaceChip(emoji = place.emoji, label = stringResource(placeLabel(place)), tint = placeTint(place))
                    }
                }
            }
        }
    }
}

@Composable
private fun DestinationCard(destination: DestinationContent) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SUBTLE_FILL_ALPHA))
                .padding(Spacing.md)
                .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(imageVector = DataDisplayGlyphs.MapPin, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
            Text(
                text = destination.name,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (destination.distanceText != null || destination.etaMinutesText != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                destination.distanceText?.let { Caption(it) }
                destination.etaMinutesText?.let { Caption("$it ${stringResource(R.string.translation_common_minShort)}") }
            }
        }
    }
}

// ── Shared panel chrome ─────────────────────────────────────────────────────────────────────────────────

/** A GlassPanel with the web header (tinted glyph + title, optional trailing slot) above the panel [body]. */
@Composable
private fun TelemetryPanel(
    title: String,
    icon: ImageVector,
    iconTint: Color,
    headerTrailing: (@Composable () -> Unit)? = null,
    body: @Composable () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = iconTint)
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (headerTrailing != null) {
                Spacer(modifier = Modifier.weight(1f))
                headerTrailing()
            }
        }
        Spacer(modifier = Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) { body() }
    }
}

/** Web `flex justify-between`: a muted label (with optional leading glyph) and a primary value on the right. */
@Composable
private fun LabelValueRow(
    label: String,
    value: String,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
    leadingIcon: ImageVector? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(text = label, icon = leadingIcon)
        Text(
            text = value,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = valueColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.End,
        )
    }
}

/** A row whose right-hand value is a tinted on/off word (web "Yes/No", "Occupied/Empty", "On/Off"). */
@Composable
private fun BinaryRow(
    label: String,
    on: Boolean,
    onText: String,
    offText: String,
    onColor: Color,
    leadingIcon: ImageVector? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(text = label, icon = leadingIcon)
        Text(
            text = if (on) onText else offText,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            color = if (on) onColor else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** A row whose right-hand value is a passthrough string, tinted when active (web turn signal / speed limit). */
@Composable
private fun TextStateRow(
    label: String,
    value: String,
    active: Boolean,
    activeColor: Color,
    leadingIcon: ImageVector? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(text = label, icon = leadingIcon)
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            color = if (active) activeColor else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** A row whose value is a toned badge (web shift / sentry / charging-state rows). */
@Composable
private fun BadgeRow(
    label: String,
    text: String,
    tone: BadgeTone,
    leadingIcon: ImageVector? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(label)
        if (leadingIcon == null) {
            Badge(text = text, variant = badgeVariant(tone))
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(imageVector = leadingIcon, contentDescription = null, size = IconSize.Xs, tint = toneColor(tone))
                Badge(text = text, variant = badgeVariant(tone))
            }
        }
    }
}

/** A compact metric tile (web `MetricCard`) — a label over a value with an optional unit subtitle. */
@Composable
private fun MetricTile(
    label: String,
    value: String,
    subtitle: String?,
    modifier: Modifier = Modifier,
) {
    MetricCard(label = label, value = value, subtitle = subtitle, modifier = modifier)
}

/** A small tinted pill with an optional leading glyph and a label (web climate chips). */
@Composable
private fun StatusChip(
    icon: ImageVector?,
    label: String,
    active: Boolean,
    activeTint: Color,
) {
    val tint = if (active) activeTint else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.pill))
                .background(tint.copy(alpha = CHIP_BACKGROUND_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (icon != null) Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = tint)
        Text(text = label, style = MaterialTheme.typography.labelSmall, color = tint)
    }
}

/** A small tinted pill with a leading emoji and a label (web navigation place chips). */
@Composable
private fun PlaceChip(
    emoji: String,
    label: String,
    tint: Color,
) {
    Row(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.pill))
                .background(tint.copy(alpha = CHIP_BACKGROUND_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(text = emoji, style = MaterialTheme.typography.labelSmall)
        Text(text = label, style = MaterialTheme.typography.labelSmall, color = tint)
    }
}

@Composable
private fun RowLabel(
    text: String,
    icon: ImageVector? = null,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(text = text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Caption(text: String) {
    Text(text = text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun PanelDivider() {
    Box(modifier = Modifier.fillMaxWidth().height(DIVIDER_HEIGHT).background(MaterialTheme.colorScheme.outlineVariant))
}

// ── Mapping helpers ─────────────────────────────────────────────────────────────────────────────────────

private fun badgeVariant(tone: BadgeTone): BadgeVariant =
    when (tone) {
        BadgeTone.Info -> BadgeVariant.Info
        BadgeTone.Success -> BadgeVariant.Success
        BadgeTone.Warning -> BadgeVariant.Warning
        BadgeTone.Danger -> BadgeVariant.Danger
        BadgeTone.Neutral -> BadgeVariant.Neutral
    }

@Composable
private fun toneColor(tone: BadgeTone): Color =
    when (tone) {
        BadgeTone.Info -> TeslaTokens.status.info
        BadgeTone.Success -> TeslaTokens.status.success
        BadgeTone.Warning -> TeslaTokens.status.warning
        BadgeTone.Danger -> TeslaTokens.status.danger
        BadgeTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

@Composable
private fun tireColor(color: TireColor): Color =
    when (color) {
        TireColor.Normal -> TeslaTokens.status.success
        TireColor.Warn -> TeslaTokens.status.warning
        TireColor.Danger -> TeslaTokens.status.danger
        TireColor.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun placeLabel(place: NavPlace): Int =
    when (place) {
        NavPlace.Home -> R.string.translation_telemetry_placeHome
        NavPlace.Work -> R.string.translation_telemetry_placeWork
        NavPlace.Favorite -> R.string.translation_telemetry_placeFavorite
    }

@Composable
private fun placeTint(place: NavPlace): Color =
    when (place) {
        NavPlace.Home -> TeslaTokens.status.success
        NavPlace.Work -> TeslaTokens.chart.speed
        NavPlace.Favorite -> TeslaTokens.chart.power
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_DATA: LiveTelemetryPanelsData by lazy {
    LiveTelemetryPanelsData(
        motor =
            MotorSnapshotLive(
                shiftState = "D",
                powerKw = 142.0,
                motorRpmFront = 3200.0,
                motorRpmRear = 3210.0,
                torqueNmFront = 180.0,
                torqueNmRear = 210.0,
                motorTempCFront = 54.0,
                motorTempCRear = 61.0,
                inverterTempC = 48.0,
                regenKw = 22.0,
            ),
        climate =
            ClimateSnapshotLive(
                insideTempC = 21.0,
                outsideTempC = 8.0,
                driverSetpointC = 21.0,
                passengerSetpointC = 21.0,
                hvacState = "On",
                defrostMode = "Front",
                isClimateOn = true,
                isPreconditioning = false,
                fanStatus = 4.0,
            ),
        security =
            SecurityEventLive(
                doorsOpen = "Closed",
                windowsOpen = "Closed",
                locked = true,
                sentryMode = true,
                userPresent = true,
                detail = "All systems nominal",
            ),
        vehicleState =
            VehicleStateLive(
                lightsHighBeams = false,
                lightsTurnSignal = "Left",
                lightsHazards = false,
                driverSeatOccupied = true,
                pairedKeyCount = JsonPrimitive(3),
                valetMode = false,
                serviceMode = false,
                speedLimitMode = false,
                centerDisplay = JsonPrimitive("Drive"),
                homelinkDeviceCount = JsonPrimitive(2),
            ),
        sseConnected = true,
        tire = TirePressureLive(frontLeft = 290_000.0, frontRight = 285_000.0, rearLeft = 295_000.0, rearRight = 300_000.0),
        charging =
            ChargingTelemetryLive(
                batteryLevel = 72.0,
                chargingState = "Charging",
                chargerVoltage = 240.0,
                chargerActualCurrent = 32.0,
                chargerPowerW = 11_000.0,
                chargeEnergyAddedWh = 18_400.0,
                rangeAddedMetersPerHour = 48_280.0,
            ),
        media =
            MediaSnapshotLive(
                nowPlayingTitle = "Starlight",
                nowPlayingArtist = "Muse",
                playbackStatus = "Playing",
                playbackSource = "Spotify",
            ),
        location =
            LocationSnapshotLive(
                destinationName = "Supercharger",
                metersToArrival = 12_350.0,
                minutesToArrival = 9.0,
                locatedAtHome = false,
                locatedAtWork = true,
            ),
        remoteStartEnabled = true,
    )
}

@Preview(name = "LiveTelemetryPanels — data", showBackground = true, widthDp = 760)
@Composable
private fun LiveTelemetryPanelsDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveTelemetryPanelsContent(LiveTelemetryPanelsProjection.project(PREVIEW_DATA, UnitFormatter.default()))
    }
}

@Preview(name = "LiveTelemetryPanels — wide (2-col)", showBackground = true, widthDp = 1100)
@Composable
private fun LiveTelemetryPanelsWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveTelemetryPanelsContent(LiveTelemetryPanelsProjection.project(PREVIEW_DATA, UnitFormatter.default()))
    }
}

@Preview(name = "LiveTelemetryPanels — empty", showBackground = true, widthDp = 760)
@Composable
private fun LiveTelemetryPanelsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveTelemetryPanelsContent(LiveTelemetryPanelsProjection.project(LiveTelemetryPanelsData(), UnitFormatter.default()))
    }
}
