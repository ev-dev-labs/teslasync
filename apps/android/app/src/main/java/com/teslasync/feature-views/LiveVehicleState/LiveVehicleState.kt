// The native Jetpack Compose + Material 3 LiveVehicleState feature view — a parity port of
// web/src/features/admin/components/security-access/LiveVehicleState.tsx. The web component renders a
// responsive grid of ten live security/access signals (hazards, high beams, turn signal, driver seat,
// paired keys, valet mode, service mode, speed limit, HomeLink devices, center display) inside a GlassPanel
// with a pulsing "Live" indicator, falling back to a friendly EmptyState when no `latest` event is present.
// This port keeps that contract: the grid reflows 2 → 3 → 5 columns at the web `sm`/`lg` breakpoints, each
// cell tints its icon + value with the accent color when the signal is active (web `text-cyan-400` /
// `text-white`) and the muted foreground otherwise, the "Live" dot pulses while honoring reduce-motion, and
// the empty branch never collapses to a blank box.
//
// Every derivation flows through the pure [LiveVehicleStateProjection]; the composable is a thin render
// layer. All labels, values, the title and the "Live" indicator resolve through the generated i18n catalog
// (P1/S10) `admin.security.*` keys — there is no English literal in this file (the only non-key string is
// the em-dash fallback, exactly as the web renders `'—'`). The one-shot `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveVehicleState) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livevehiclestate

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonPrimitive

/** Tailwind `sm` (640px) and `lg` (1024px) breakpoints — the web `sm:grid-cols-3 lg:grid-cols-5` reflow. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp
private const val GRID_COLUMNS_BASE = 2
private const val GRID_COLUMNS_SM = 3
private const val GRID_COLUMNS_LG = 5

/** Web `<FadeIn delay={0.17}>` → 170ms entry delay. */
private const val LIVE_FADE_DELAY_MS = 170

/** "Live" dot pulse — a gentle alpha loop mirroring the web `animate-pulse`. */
private const val LIVE_PULSE_MS = 900
private const val LIVE_PULSE_MIN_ALPHA = 0.35f

/** The em-dash fallback the web renders for any null/absent value (`'—'`). */
private const val DASH = "—"

/**
 * Stateful entry point — the faithful 1:1 port of the web `LiveVehicleState({ latest })` prop. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), projects the optional event onto a
 * [LiveVehicleStateDisplay] via the pure [LiveVehicleStateProjection], and renders.
 *
 * @param latest the most recent security/access event, or null when none is cached (web `latest` prop). The
 *   owning Security/Access page supplies it and owns the `/security/latest` query's loading / error / stale
 *   / offline handling, so this presentational surface renders only the grid and empty branches.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveVehicleState(
    latest: SecurityEventLive?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LiveVehicleStateDiagnostics.recordViewOpened(logger) }
    val display = remember(latest) { LiveVehicleStateProjection.project(latest) }
    LiveVehicleStateContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the header (title plus the "Live"
 * indicator when an event is present) and then either the live-signal grid or, when there are no signals,
 * the empty state — never a hidden surface.
 */
@Composable
fun LiveVehicleStateContent(
    display: LiveVehicleStateDisplay,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier, delayMs = LIVE_FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            LiveHeader(showLive = display.live)
            Spacer(modifier = Modifier.height(Spacing.md))
            if (display.signals.isNotEmpty()) {
                SignalGrid(signals = display.signals)
            } else {
                EmptyState(message = stringResource(R.string.translation_admin_security_live_noData))
            }
        }
    }
}

/** The web header row: the section title on the left and, when live, the pulsing "Live" indicator. */
@Composable
private fun LiveHeader(
    showLive: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionTitle(stringResource(R.string.translation_admin_security_liveState))
        if (showLive) {
            LiveIndicator()
        }
    }
}

/** The "Live" chip: a pulsing success-tinted dot beside the localized "Live" label (web `text-green-400`). */
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
            style = MaterialTheme.typography.labelMedium,
            color = TeslaTokens.status.success,
        )
    }
}

/**
 * The pulsing `CircleDot` of the "Live" indicator. The infinite alpha loop is created only when motion is
 * allowed (matching the shared `StatusPill` / `FreshnessIndicator` pattern), so reduce-motion users get a
 * steady dot and no animation runs.
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
    Icon(
        imageVector = LiveVehicleStateGlyphs.CircleDot,
        contentDescription = null,
        modifier = Modifier.alpha(alpha),
        size = IconSize.Xs,
        tint = TeslaTokens.status.success,
    )
}

/**
 * The responsive signal grid — the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`. Picks the column count
 * from the available width and lays the cells out as weighted rows so every card shares a uniform width; the
 * final row is padded with empty weighted slots so a short last row keeps the same card sizing.
 */
@Composable
private fun SignalGrid(
    signals: List<LiveSignal>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            signals.chunked(columns).forEach { rowSignals ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    rowSignals.forEach { signal ->
                        SignalCell(signal = signal, modifier = Modifier.weight(1f))
                    }
                    repeat(columns - rowSignals.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * One signal card — an accent-or-muted icon and label on top, the value below. The whole cell is a single
 * merged accessibility node so TalkBack reads it as "<label>, <value>" rather than three separate fragments.
 */
@Composable
private fun SignalCell(
    signal: LiveSignal,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(signalLabelRes(signal.key))
    val value = signalValueText(signal.value)
    val accent =
        if (signal.active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    val valueColor =
        if (signal.active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    GlassPanel(
        modifier = modifier.semantics(mergeDescendants = true) {},
        padding = PanelPadding.Sm,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = signalGlyph(signal.key),
                contentDescription = null,
                size = IconSize.Sm,
                tint = accent,
            )
            Text(
                text = label,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(modifier = Modifier.height(Spacing.xs))
        Text(
            text = value,
            modifier = Modifier.fillMaxWidth(),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = valueColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Resolves a signal's localized value text; [SignalValue.Dash] renders the em-dash fallback. */
@Composable
private fun signalValueText(value: SignalValue): String =
    when (value) {
        SignalValue.On -> stringResource(R.string.translation_admin_security_on)
        SignalValue.Off -> stringResource(R.string.translation_admin_security_off)
        SignalValue.Occupied -> stringResource(R.string.translation_admin_security_live_occupied)
        SignalValue.Empty -> stringResource(R.string.translation_admin_security_live_empty)
        SignalValue.Dash -> DASH
        is SignalValue.Literal -> value.text
    }

/** Maps a signal key onto its generated i18n label resource (web `t('admin.security.live.<key>')`). */
private fun signalLabelRes(key: LiveSignalKey): Int =
    when (key) {
        LiveSignalKey.HAZARDS -> R.string.translation_admin_security_live_hazards
        LiveSignalKey.HIGH_BEAMS -> R.string.translation_admin_security_live_highBeams
        LiveSignalKey.TURN_SIGNAL -> R.string.translation_admin_security_live_turnSignal
        LiveSignalKey.DRIVER_SEAT -> R.string.translation_admin_security_live_driverSeat
        LiveSignalKey.PAIRED_KEYS -> R.string.translation_admin_security_live_pairedKeys
        LiveSignalKey.VALET_MODE -> R.string.translation_admin_security_live_valetMode
        LiveSignalKey.SERVICE_MODE -> R.string.translation_admin_security_live_serviceMode
        LiveSignalKey.SPEED_LIMIT -> R.string.translation_admin_security_live_speedLimit
        LiveSignalKey.HOMELINK_DEVICES -> R.string.translation_admin_security_live_homelinkDevices
        LiveSignalKey.CENTER_DISPLAY -> R.string.translation_admin_security_live_centerDisplay
    }

/** Maps a signal key onto its lucide-equivalent glyph; speed limit reuses the shared `Gauge`. */
private fun signalGlyph(key: LiveSignalKey): ImageVector =
    when (key) {
        LiveSignalKey.HAZARDS -> LiveVehicleStateGlyphs.Flashlight
        LiveSignalKey.HIGH_BEAMS -> LiveVehicleStateGlyphs.Lightbulb
        LiveSignalKey.TURN_SIGNAL -> LiveVehicleStateGlyphs.Signal
        LiveSignalKey.DRIVER_SEAT -> LiveVehicleStateGlyphs.Armchair
        LiveSignalKey.PAIRED_KEYS -> LiveVehicleStateGlyphs.Key
        LiveSignalKey.VALET_MODE -> LiveVehicleStateGlyphs.Car
        LiveSignalKey.SERVICE_MODE -> LiveVehicleStateGlyphs.Wrench
        LiveSignalKey.SPEED_LIMIT -> DataDisplayGlyphs.Gauge
        LiveSignalKey.HOMELINK_DEVICES -> LiveVehicleStateGlyphs.Home
        LiveSignalKey.CENTER_DISPLAY -> LiveVehicleStateGlyphs.Monitor
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_EVENT =
    SecurityEventLive(
        lightsHazardsActive = true,
        lightsHighBeams = false,
        lightsTurnSignal = JsonPrimitive("Left"),
        driverSeatOccupied = true,
        pairedPhoneKeyCount = 3,
        valetModeEnabled = false,
        serviceMode = false,
        speedLimitMode = JsonPrimitive(false),
        homelinkDeviceCount = 2,
        centerDisplay = JsonPrimitive("Standby"),
    )

@Preview(name = "Live — data", showBackground = true)
@Composable
private fun LiveVehicleStateDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveVehicleStateContent(LiveVehicleStateProjection.project(PREVIEW_EVENT))
    }
}

@Preview(name = "Live — wide (5-col)", showBackground = true, widthDp = 1100)
@Composable
private fun LiveVehicleStateWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveVehicleStateContent(LiveVehicleStateProjection.project(PREVIEW_EVENT))
    }
}

@Preview(name = "Empty — no data", showBackground = true)
@Composable
private fun LiveVehicleStateEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveVehicleStateContent(LiveVehicleStateProjection.project(latest = null))
    }
}
