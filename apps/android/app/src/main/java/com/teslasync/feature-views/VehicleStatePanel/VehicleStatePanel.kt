// The native Jetpack Compose + Material 3 VehicleStatePanel feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx. The web component takes the
// latest live-signal map (`live`) and the SSE `sseConnected` flag and renders a GlassPanel titled
// "Vehicle State" (Activity icon) with a pulsing "Live" chip when connected, followed by ten rows in three
// divider-separated groups — Lights (High Beams / Turn Signal / Hazards), Driver & Keys (Driver Seat /
// Paired Keys) and Access Modes (Valet Mode / Service Mode / Speed Limit / Center Display / HomeLink
// Devices). Each row shows a muted icon + label on the left and, on the right, a value that turns its
// per-row accent color when active (web `text-cyan-300` / `text-amber-300` / `text-rose-300` /
// `text-green-400` / `text-purple-400`) or the muted/primary foreground otherwise — and every value degrades
// to its own "Off"/em-dash fallback, so an empty `live` map still renders a full panel and never a blank box.
//
// This port keeps that contract: it is a thin render layer over the pure [VehicleStatePanelProjection];
// it binds no row data hooks (the owning Vehicle-detail page owns the SSE stream and its load / error /
// stale / offline states), formats the one speed value at this render boundary via the shared [UnitFormatter]
// (the web `useUnits()` boundary), resolves every visible string through the generated i18n catalog (P1/S10),
// pulses the "Live" dot only while motion is allowed, and merges each row into a single TalkBack node. The
// one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition. The only non-key string is the
// em-dash fallback, exactly as the web renders `'—'`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleStatePanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclestatepanel

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonPrimitive

/** "Live" dot pulse — a gentle alpha loop mirroring the web `animate-pulse`. */
private const val LIVE_PULSE_MS = 900
private const val LIVE_PULSE_MIN_ALPHA = 0.35f

/** Web `w-1.5 h-1.5` "Live" dot — 6dp. */
private val LIVE_DOT_SIZE: Dp = 6.dp

/** The em-dash the web renders for any falsy value (`'—'`). */
private const val DASH = "—"

/**
 * Stateful entry point — the faithful 1:1 port of the web `VehicleStatePanel({ live, sseConnected })`. Records
 * the one-shot `view.opened` diagnostic on first composition (P1/S11), collects the live SI→display
 * [UnitFormatter] (the web `useUnits` boundary), projects the inputs onto a [VehicleStateDisplay] via the pure
 * [VehicleStatePanelProjection], and renders.
 *
 * @param live the latest live-signal slice (web `live` prop). The owning Vehicle-detail page supplies it from
 *   the SSE stream and owns that stream's loading / error / stale / offline handling, so this presentational
 *   surface renders only the rows and the connection indicator.
 * @param sseConnected whether the SSE stream is connected (web `sseConnected` prop) — gates the "Live" chip.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleStatePanel(
    live: VehicleLiveState,
    sseConnected: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { VehicleStatePanelDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val display =
        remember(live, sseConnected, formatter) {
            VehicleStatePanelProjection.project(live, sseConnected, formatter)
        }
    VehicleStatePanelContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the header (Activity glyph + title,
 * plus the "Live" indicator when connected) and the three divider-separated groups of rows — always the full
 * ten rows, each carrying its own fallback value, so no surface is ever hidden or blank.
 */
@Composable
fun VehicleStatePanelContent(
    display: VehicleStateDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth()) {
        StatePanelHeader(showLive = display.live)
        Spacer(modifier = Modifier.height(Spacing.xl))
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            display.groups.forEachIndexed { index, group ->
                if (index > 0) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                group.forEach { row -> StateRowItem(row = row) }
            }
        }
    }
}

/** The web header `<h3 className="section-title">` — Activity glyph + title, with the "Live" chip when connected. */
@Composable
private fun StatePanelHeader(
    showLive: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = VehicleStatePanelGlyphs.Activity,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.status.info,
            )
            SectionTitle(
                text = stringResource(R.string.translation_telemetry_vehicleState),
                modifier = Modifier.semantics { heading() },
            )
        }
        if (showLive) {
            LiveIndicator()
        }
    }
}

/** The web "Live" chip: a pulsing success-tinted dot beside the localized "Live" label (web `text-emerald-300`). */
@Composable
private fun LiveIndicator(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        LiveDot()
        Text(
            text = stringResource(R.string.translation_admin_security_live_indicator),
            style = MaterialTheme.typography.labelSmall,
            color = TeslaTokens.status.success,
        )
    }
}

/**
 * The pulsing dot of the "Live" indicator (web `bg-neon-green animate-pulse`). The infinite alpha loop is
 * created only when motion is allowed, so reduce-motion users get a steady dot and no animation runs.
 */
@Composable
private fun LiveDot() {
    val animate = !rememberReducedMotion()
    val alpha =
        if (animate) {
            val transition = rememberInfiniteTransition(label = "live-dot")
            transition
                .animateFloat(
                    initialValue = 1f,
                    targetValue = LIVE_PULSE_MIN_ALPHA,
                    animationSpec = infiniteRepeatable(tween(LIVE_PULSE_MS), RepeatMode.Reverse),
                    label = "live-dot-alpha",
                ).value
        } else {
            1f
        }
    Box(
        modifier =
            Modifier
                .size(LIVE_DOT_SIZE)
                .alpha(alpha)
                .clip(CircleShape)
                .background(TeslaTokens.status.success),
    )
}

/**
 * One row — a muted icon + label on the left (web `text-[var(--text-muted)]`) and, on the right, the value in
 * its accent or muted/primary foreground. The whole row is a single merged accessibility node so TalkBack
 * reads it as "<label>, <value>" rather than as separate fragments.
 */
@Composable
private fun StateRowItem(
    row: StateRow,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(rowLabelRes(row.key))
    Row(
        modifier = modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = rowGlyph(row.key),
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(text = label)
        }
        Spacer(modifier = Modifier.width(Spacing.sm))
        Text(
            text = signalValueText(row.value),
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = rowValueColor(row),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Resolves a row's localized value text; [SignalValue.Dash] renders the em-dash fallback. */
@Composable
private fun signalValueText(value: SignalValue): String =
    when (value) {
        SignalValue.On -> stringResource(R.string.translation_common_on)
        SignalValue.Off -> stringResource(R.string.translation_common_off)
        SignalValue.Active -> stringResource(R.string.translation_common_active)
        SignalValue.Occupied -> stringResource(R.string.translation_admin_security_live_occupied)
        SignalValue.Empty -> stringResource(R.string.translation_admin_security_live_empty)
        SignalValue.Enabled -> stringResource(R.string.translation_common_enabled)
        SignalValue.Dash -> DASH
        is SignalValue.Literal -> value.text
    }

/**
 * The value color: the primary foreground for the always-primary ([RowAccent.NEUTRAL]) rows, otherwise the
 * row's accent when active and the muted foreground when inactive — the web `cn(... active ? accent : muted)`.
 */
@Composable
private fun rowValueColor(row: StateRow): Color =
    when {
        row.accent == RowAccent.NEUTRAL -> MaterialTheme.colorScheme.onSurface
        row.active -> accentColor(row.accent)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Maps a row accent onto its design token (web Tailwind color → P1/S9 status / chart token). */
@Composable
private fun accentColor(accent: RowAccent): Color =
    when (accent) {
        RowAccent.INFO -> TeslaTokens.status.info
        RowAccent.WARNING -> TeslaTokens.status.warning
        RowAccent.DANGER -> TeslaTokens.status.danger
        RowAccent.SUCCESS -> TeslaTokens.status.success
        RowAccent.PURPLE -> TeslaTokens.chart.power
        RowAccent.NEUTRAL -> MaterialTheme.colorScheme.onSurface
    }

/** Maps a row key onto its generated i18n label resource (the labels the web hard-codes for each line). */
private fun rowLabelRes(key: StateRowKey): Int =
    when (key) {
        StateRowKey.HIGH_BEAMS -> R.string.translation_admin_security_live_highBeams
        StateRowKey.TURN_SIGNAL -> R.string.translation_admin_security_live_turnSignal
        StateRowKey.HAZARDS -> R.string.translation_admin_security_live_hazards
        StateRowKey.DRIVER_SEAT -> R.string.translation_admin_security_live_driverSeat
        StateRowKey.PAIRED_KEYS -> R.string.translation_admin_security_live_pairedKeys
        StateRowKey.VALET_MODE -> R.string.translation_admin_security_live_valetMode
        StateRowKey.SERVICE_MODE -> R.string.translation_admin_security_live_serviceMode
        StateRowKey.SPEED_LIMIT -> R.string.translation_admin_security_live_speedLimit
        StateRowKey.CENTER_DISPLAY -> R.string.translation_admin_security_live_centerDisplay
        StateRowKey.HOMELINK_DEVICES -> R.string.translation_admin_security_live_homelinkDevices
    }

/** Maps a row key onto its lucide-equivalent glyph; User/Gauge/MapPin reuse the shared `DataDisplayGlyphs`. */
private fun rowGlyph(key: StateRowKey): ImageVector =
    when (key) {
        StateRowKey.HIGH_BEAMS -> VehicleStatePanelGlyphs.Lightbulb
        StateRowKey.TURN_SIGNAL -> VehicleStatePanelGlyphs.Car
        StateRowKey.HAZARDS -> VehicleStatePanelGlyphs.ShieldAlert
        StateRowKey.DRIVER_SEAT -> DataDisplayGlyphs.Person
        StateRowKey.PAIRED_KEYS -> VehicleStatePanelGlyphs.Key
        StateRowKey.VALET_MODE -> VehicleStatePanelGlyphs.Car
        StateRowKey.SERVICE_MODE -> VehicleStatePanelGlyphs.Settings
        StateRowKey.SPEED_LIMIT -> DataDisplayGlyphs.Gauge
        StateRowKey.CENTER_DISPLAY -> VehicleStatePanelGlyphs.Monitor
        StateRowKey.HOMELINK_DEVICES -> DataDisplayGlyphs.MapPin
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_LIVE =
    VehicleLiveState(
        lightsHighBeams = true,
        lightsTurnSignal = JsonPrimitive("Left"),
        lightsHazards = false,
        driverSeatOccupied = true,
        pairedKeyCount = JsonPrimitive(3),
        valetMode = false,
        serviceMode = false,
        speedLimitMode = true,
        currentSpeedLimit = 26.8,
        centerDisplay = JsonPrimitive("Drive"),
        homelinkDeviceCount = JsonPrimitive(2),
    )

@Preview(name = "Vehicle State — live", showBackground = true)
@Composable
private fun VehicleStatePanelLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleStatePanelContent(
            VehicleStatePanelProjection.project(PREVIEW_LIVE, sseConnected = true, UnitFormatter.default()),
        )
    }
}

@Preview(name = "Vehicle State — disconnected / empty", showBackground = true)
@Composable
private fun VehicleStatePanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleStatePanelContent(
            VehicleStatePanelProjection.project(VehicleLiveState(), sseConnected = false, UnitFormatter.default()),
        )
    }
}
