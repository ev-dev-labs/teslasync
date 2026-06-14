// The native Jetpack Compose + Material 3 VehicleTwin shared surface — a parity port of
// web/src/components/vehicles/VehicleTwin.tsx. The web component is a layered, original SVG "digital twin" of a
// Tesla-inspired crossover seen from the side: it is handed the live physical state (doors, four windows,
// frunk/trunk, charge port, charging, driving, locked, sentry, headlights, hazards, turn signal, driver-seat
// occupancy) and draws every open/closed/active branch, animating charging underglow, wheel spin,
// headlight/taillight pulses, flashing turn signals and a drive-in entrance, all painted with the active
// per-vehicle colour resolved by `useVehiclePaint`. This file is the thin render layer over the pure
// VehicleTwinModel.kt projection + geometry: it resolves the paint feed into a [UiState], parses the verbatim SVG
// geometry once, and draws it on a Compose Canvas (no SVG runtime) with reduced-motion-aware animation.
//
// Parity choices:
//   • Data binding (the only data source — web `useVehiclePaint`): the surface binds the per-vehicle paint
//     override + the cache-then-network vehicle record (its `exterior_color`) through [VehicleTwinViewModel]
//     (P1/S8); the view performs NO HTTP. Because the colour is read from a real feed, the surface honestly drives
//     loading / content / empty / stale / offline / error — never a fabricated lifecycle.
//   • Geometry: the exact web SVG path strings are reused (VehicleTwinGeometry) and rendered through the platform
//     [PathParser], so the native twin is the same shape as the web SVG, scaled from the 560×220 (minY 52) viewBox.
//   • States: every visual branch the web draws is reproduced — door/window/frunk/trunk open vs closed vs unknown,
//     charging underglow + charge-port, driving wheel-spin, locked/unlocked + sentry, headlights/hazards/turn
//     signals, driver-seat occupancy, drive-in entrance, the five paints + three sizes — plus the feed's loading
//     skeleton, friendly empty silhouette, classified error with retry, and stale/offline freshness chip.
//   • i18n: every string resolves through the P1/S10 catalog; no English literal ships in code.
//   • Accessibility: the illustration exposes the full physical state as one spoken summary (role=Image); reduced
//     motion renders the final static frame (no wheel spin / pulse / drive-in).
//   • Diagnostics: the one-shot PII-safe `view.opened` event (P1/S11) is recorded on first composition.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/VehicleTwin) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located stateless content, drawing helpers and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicletwin

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Test tag on the surface root so on-device UI tests can locate the rendered twin in any state. */
const val VEHICLE_TWIN_TEST_TAG: String = "vehicle-twin"

/** Test tag on the painted illustration — used by the a11y + UI tests in the content / stale / offline states. */
const val VEHICLE_TWIN_CANVAS_TEST_TAG: String = "vehicle-twin-canvas"

/**
 * The localized labels the surface folds into its output — built from `stringResource` at the render boundary
 * (tests/previews pass a deterministic instance), keeping the render branches locale-stable. Every string resolves
 * through the P1/S10 catalog. [labels] carries the physical-state phrases the accessible summary is built from.
 */
data class VehicleTwinStrings(
    val loadingLabel: String,
    val emptyTitle: String,
    val emptyDesc: String,
    val staleLabel: String,
    val offlineLabel: String,
    val updatingLabel: String,
    val errorResource: String,
    val labels: VehicleTwinLabels,
)

/**
 * Stateful entry point — the parity port of the web `<VehicleTwin />`. Binds the paint + fleet + selection seam
 * via [source] into a [VehicleTwinViewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first
 * composition, collects the live cache-then-network paint state, and renders the twin for the supplied physical
 * [twinState].
 *
 * [twinState] is the live physical state (web prop), defaulting to the neutral all-unknown silhouette so the
 * surface renders even before any telemetry arrives. [source] defaults to the shared P1/S8 holders from the
 * [LocalDataContainer] (a true drop-in like the web component); a host or test may inject a different seam.
 */
@Composable
fun VehicleTwin(
    modifier: Modifier = Modifier,
    twinState: VehicleTwinState = EMPTY_TWIN_STATE,
    size: VehicleTwinSize = VehicleTwinSize.Md,
    interactive: Boolean = false,
    driveIn: Boolean = false,
    source: VehicleTwinSource = rememberVehicleTwinSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: VehicleTwinViewModel =
        viewModel(
            key = VehicleTwinRegistration.ID,
            factory = VehicleTwinViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    VehicleTwinContent(
        state = state,
        twinState = twinState,
        strings = rememberVehicleTwinStrings(),
        modifier = modifier,
        size = size,
        interactive = interactive,
        driveIn = driveIn,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Draws the painted twin
 * over the cache-then-network [UiState]: loading ⇒ a silhouette skeleton, hard error ⇒ [QueryError] + retry,
 * empty ⇒ a friendly [EmptyState] (still showing a neutral silhouette), otherwise the resolved-paint twin (with a
 * freshness chip while stale / refreshing / offline). Stale (non-error) data auto-refreshes exactly once.
 */
@Composable
fun VehicleTwinContent(
    state: UiState<VehicleTwinData>,
    twinState: VehicleTwinState,
    strings: VehicleTwinStrings,
    modifier: Modifier = Modifier,
    size: VehicleTwinSize = VehicleTwinSize.Md,
    interactive: Boolean = false,
    driveIn: Boolean = false,
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    Column(
        modifier = modifier.fillMaxWidth().testTag(VEHICLE_TWIN_TEST_TAG),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        FadeIn(modifier = Modifier.fillMaxWidth()) {
            when {
                state.isLoading -> VehicleTwinLoading(size = size, strings = strings)
                state.isError -> VehicleTwinError(state = state, strings = strings, onRetry = onRetry)
                state.isEmpty -> VehicleTwinEmpty(size = size, strings = strings)
                else ->
                    VehicleTwinPainted(
                        data = state.data ?: VehicleTwinData.EMPTY,
                        state = state,
                        twinState = twinState,
                        strings = strings,
                        size = size,
                        interactive = interactive,
                        driveIn = driveIn,
                    )
            }
        }
    }
}

/** The content branch — the resolved-paint twin plus a freshness chip while stale / refreshing / offline. */
@Composable
private fun VehicleTwinPainted(
    data: VehicleTwinData,
    state: UiState<VehicleTwinData>,
    twinState: VehicleTwinState,
    strings: VehicleTwinStrings,
    size: VehicleTwinSize,
    interactive: Boolean,
    driveIn: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        VehicleTwinCanvas(
            paint = data.paint,
            twinState = twinState,
            strings = strings,
            size = size,
            interactive = interactive,
            driveIn = driveIn,
        )
        VehicleTwinFreshnessChip(state = state, strings = strings)
    }
}

/**
 * The painted illustration — parses the verbatim web geometry once, resolves the animation frame (reduced-motion
 * aware), applies the optional drive-in entrance, and draws every layer on a Compose Canvas scaled from the
 * `0 52 560 220` viewBox. Carries the full physical state as a single spoken `role=Image` description.
 */
@Composable
fun VehicleTwinCanvas(
    paint: PaintPalette,
    twinState: VehicleTwinState,
    strings: VehicleTwinStrings,
    modifier: Modifier = Modifier,
    size: VehicleTwinSize = VehicleTwinSize.Md,
    interactive: Boolean = false,
    driveIn: Boolean = false,
) {
    val reduce = rememberReducedMotion()
    val paths = remember { TwinPaths() }
    val anim = rememberVehicleTwinAnim(twinState, reduce)
    val entrance = rememberDriveInEntrance(driveIn && !reduce)
    val summary = vehicleTwinAccessibilitySummary(twinState, strings.labels)
    val accessible = if (interactive) "$summary." else summary
    Canvas(
        modifier =
            modifier
                .width(size.widthDp.dp)
                .aspectRatio(VIEWBOX_WIDTH / VIEWBOX_HEIGHT)
                .testTag(VEHICLE_TWIN_CANVAS_TEST_TAG)
                .alpha(entrance.alpha)
                .semantics {
                    role = Role.Image
                    contentDescription = accessible
                },
    ) {
        val s = this.size.width / VIEWBOX_WIDTH
        translate(left = entrance.offsetX * this.size.width, top = -VIEWBOX_MIN_Y * s) {
            scale(scale = s, pivot = Offset.Zero) {
                drawGroundShadow()
                if (twinState.isCharging) drawChargingUnderglow(anim)
                drawBodyShell(paths, paint, twinState)
                drawBody3dDetails(paths, paint)
                drawReflections(paths)
                drawWindows(paths, twinState)
                drawDoors(paths, twinState)
                drawDriverSeat(twinState)
                drawChargePort(paint, twinState, anim)
                drawHeadlights(paths, paint, twinState, anim)
                drawTaillights(paths, twinState, anim)
                drawWheel(WHEEL_FRONT_X, WHEEL_Y, anim)
                drawWheel(WHEEL_REAR_X, WHEEL_Y, anim)
                drawSecurity(twinState, anim)
            }
        }
    }
}

// ── State branches (loading / empty / error / freshness) ─────────────────────────────────────────────────────

/** The loading branch — a silhouette-sized skeleton block announced to TalkBack. */
@Composable
private fun VehicleTwinLoading(
    size: VehicleTwinSize,
    strings: VehicleTwinStrings,
) {
    Skeleton(
        modifier =
            Modifier
                .width(size.widthDp.dp)
                .aspectRatio(VIEWBOX_WIDTH / VIEWBOX_HEIGHT)
                .semantics { contentDescription = strings.loadingLabel },
        rounded = true,
    )
}

/** The hard-error branch — a recovery-oriented [QueryError] with retry, classified from the failure. */
@Composable
private fun VehicleTwinError(
    state: UiState<VehicleTwinData>,
    strings: VehicleTwinStrings,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = vehicleTwinErrorKind(state.errorKind, state.httpStatus),
        resourceName = strings.errorResource,
        onRetry = onRetry,
    )
}

/** The empty branch — the friendly "no vehicle" state over a neutral silhouette, never a blank box. */
@Composable
private fun VehicleTwinEmpty(
    size: VehicleTwinSize,
    strings: VehicleTwinStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(modifier = Modifier.alpha(EMPTY_SILHOUETTE_ALPHA)) {
            VehicleTwinCanvas(
                paint = FALLBACK_PAINT,
                twinState = EMPTY_TWIN_STATE,
                strings = strings,
                size = size,
            )
        }
        EmptyState(
            message = strings.emptyDesc,
            modifier = Modifier.fillMaxWidth(),
            icon = NavGlyphs.Car,
            title = strings.emptyTitle,
        )
    }
}

/**
 * The localized freshness chip: an offline chip while the cached colour is shown after a failed refresh, an
 * "updating…" chip while a refresh is in flight, or a stale chip once the cached value passes its TTL. Renders
 * nothing while fresh.
 */
@Composable
private fun VehicleTwinFreshnessChip(
    state: UiState<VehicleTwinData>,
    strings: VehicleTwinStrings,
) {
    when {
        state.hasError && state.hasData -> Badge(text = strings.offlineLabel, variant = BadgeVariant.Warning, dot = true)
        state.refreshing -> Badge(text = strings.updatingLabel, variant = BadgeVariant.Neutral, dot = true)
        state.stale -> Badge(text = strings.staleLabel, variant = BadgeVariant.Info, dot = true)
    }
}

// ── Animation ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The per-frame animation values — the native port of the web `motion` loops. [wheelAngle] spins the alloys while
 * driving, [lightPulse] pulses active head/tail lights and flashers, [chargePulse] pulses the charge-port ring,
 * and [underglow] breathes the charging underglow. [Static] is the reduced-motion / preview / test frame.
 */
data class VehicleTwinAnim(
    val wheelAngle: Float = 0f,
    val lightPulse: Float = 1f,
    val chargePulse: Float = 1f,
    val underglow: Float = UNDERGLOW_BASE,
) {
    companion object {
        val Static: VehicleTwinAnim = VehicleTwinAnim()
    }
}

private const val UNDERGLOW_BASE = 0.4f

/** The drive-in entrance frame: a horizontal offset fraction (of the surface width) + an alpha (web `driveIn`). */
private data class DriveInEntrance(
    val offsetX: Float,
    val alpha: Float,
)

@Composable
private fun rememberVehicleTwinAnim(
    state: VehicleTwinState,
    reduce: Boolean,
): VehicleTwinAnim {
    if (reduce) return VehicleTwinAnim.Static
    val transition = rememberInfiniteTransition(label = "vehicle-twin")
    val wheel by transition.animateFloat(
        initialValue = 0f,
        targetValue = if (state.isDriving) -FULL_TURN else 0f,
        animationSpec = infiniteRepeatable(tween(WHEEL_SPIN_MS, easing = LinearEasing), RepeatMode.Restart),
        label = "wheel",
    )
    val pulse by transition.animateFloat(
        initialValue = PULSE_MIN,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(PULSE_MS, easing = LinearEasing), RepeatMode.Reverse),
        label = "pulse",
    )
    val charge by transition.animateFloat(
        initialValue = CHARGE_MIN,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(CHARGE_MS, easing = LinearEasing), RepeatMode.Reverse),
        label = "charge",
    )
    val glow by transition.animateFloat(
        initialValue = UNDERGLOW_MIN,
        targetValue = UNDERGLOW_MAX,
        animationSpec = infiniteRepeatable(tween(UNDERGLOW_MS, easing = LinearEasing), RepeatMode.Reverse),
        label = "underglow",
    )
    return VehicleTwinAnim(wheelAngle = wheel, lightPulse = pulse, chargePulse = charge, underglow = glow)
}

@Composable
private fun rememberDriveInEntrance(active: Boolean): DriveInEntrance {
    if (!active) return DriveInEntrance(offsetX = 0f, alpha = 1f)
    val transition = rememberInfiniteTransition(label = "vehicle-twin-drive-in")
    // A one-way feel approximated with a long, mostly-resting reverse so the car settles at rest then re-enters.
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(DRIVE_IN_MS, easing = LinearEasing), RepeatMode.Reverse),
        label = "drive-in",
    )
    val eased = 1f - (1f - progress) * (1f - progress)
    return DriveInEntrance(offsetX = (1f - eased) * DRIVE_IN_START_FRACTION, alpha = DRIVE_IN_ALPHA_MIN + eased * (1f - DRIVE_IN_ALPHA_MIN))
}

// ── Drawing helpers (verbatim web geometry on a Compose Canvas) ───────────────────────────────────────────────

/** Unpacks a 0xAARRGGBB model colour into a Compose [Color]. */
private fun twinColor(argb: Long): Color = Color(argb.toInt())

/** Parses a verbatim web SVG `d=` string into a Compose [Path] (raw viewBox coordinates). */
private fun twinPath(d: String): Path = PathParser().parsePathString(d).toPath()

/** All static (paint- and state-agnostic) geometry parsed once so the draw loop never re-parses while animating. */
private class TwinPaths {
    val body = twinPath(VehicleTwinGeometry.BODY)
    val bodyChromeArc = twinPath(VehicleTwinGeometry.BODY_CHROME_ARC)
    val lowerShadow = twinPath(VehicleTwinGeometry.LOWER_SHADOW)
    val mirror = twinPath(VehicleTwinGeometry.MIRROR)
    val frontHandle = twinPath(VehicleTwinGeometry.FRONT_HANDLE)
    val frontArch = twinPath(VehicleTwinGeometry.FRONT_ARCH)
    val rearArch = twinPath(VehicleTwinGeometry.REAR_ARCH)
    val frunkSeam = twinPath(VehicleTwinGeometry.FRUNK_SEAM)
    val frunkOpen = twinPath(VehicleTwinGeometry.FRUNK_OPEN)
    val trunkSeam = twinPath(VehicleTwinGeometry.TRUNK_SEAM)
    val trunkOpen = twinPath(VehicleTwinGeometry.TRUNK_OPEN)
    val hoodSurface = twinPath(VehicleTwinGeometry.HOOD_SURFACE)
    val frontDoorSurface = twinPath(VehicleTwinGeometry.FRONT_DOOR_SURFACE)
    val rearDoorSurface = twinPath(VehicleTwinGeometry.REAR_DOOR_SURFACE)
    val quarterSurface = twinPath(VehicleTwinGeometry.QUARTER_SURFACE)
    val beltline = twinPath(VehicleTwinGeometry.BELTLINE)
    val rockerDepth = twinPath(VehicleTwinGeometry.ROCKER_DEPTH)
    val doorCutFront = twinPath(VehicleTwinGeometry.DOOR_CUT_FRONT)
    val doorCutRear = twinPath(VehicleTwinGeometry.DOOR_CUT_REAR)
    val doorHandleFront = twinPath(VehicleTwinGeometry.DOOR_HANDLE_FRONT)
    val doorHandleRear = twinPath(VehicleTwinGeometry.DOOR_HANDLE_REAR)
    val shoulderHighlight = twinPath(VehicleTwinGeometry.SHOULDER_HIGHLIGHT)
    val softReflection = twinPath(VehicleTwinGeometry.SOFT_REFLECTION)
    val cabin = twinPath(VehicleTwinGeometry.CABIN)
    val windowFd = twinPath(VehicleTwinGeometry.WINDOW_FD)
    val windowRd = twinPath(VehicleTwinGeometry.WINDOW_RD)
    val bPillar = twinPath(VehicleTwinGeometry.B_PILLAR)
    val roofLine = twinPath(VehicleTwinGeometry.ROOF_LINE)
    val glassReflection = twinPath(VehicleTwinGeometry.GLASS_REFLECTION)
    val aPillar = twinPath(VehicleTwinGeometry.A_PILLAR)
    val passengerAlert = twinPath(VehicleTwinGeometry.PASSENGER_ALERT)
    val headlightLens = twinPath(VehicleTwinGeometry.HEADLIGHT_LENS)
    val headlightAccent = twinPath(VehicleTwinGeometry.HEADLIGHT_ACCENT)
    val headlightBeam = twinPath(VehicleTwinGeometry.HEADLIGHT_BEAM)
    val taillight = twinPath(VehicleTwinGeometry.TAILLIGHT)
    val taillightInner = twinPath(VehicleTwinGeometry.TAILLIGHT_INNER)
    val taillightAccent = twinPath(VehicleTwinGeometry.TAILLIGHT_ACCENT)
    val doorFrontOpen = twinPath(VehicleTwinGeometry.DOOR_FRONT_OPEN)
    val doorRearOpen = twinPath(VehicleTwinGeometry.DOOR_REAR_OPEN)
    val passengerFrontAlert = twinPath(VehicleTwinGeometry.PASSENGER_FRONT_ALERT)
    val passengerRearAlert = twinPath(VehicleTwinGeometry.PASSENGER_REAR_ALERT)
}

private fun DrawScope.drawGroundShadow() {
    drawOval(twinColor(TwinColors.shadow), topLeft = Offset(56f, 225f), size = Size(460f, 42f))
    drawOval(twinColor(TwinColors.shadowCore), topLeft = Offset(103f, 230f), size = Size(364f, 18f))
}

private fun DrawScope.drawChargingUnderglow(anim: VehicleTwinAnim) {
    val rx = 160f + (205f - 160f) * anim.underglow
    drawOval(
        twinColor(TwinColors.chargeUnderglow),
        topLeft = Offset(292f - rx, 239f - 18f),
        size = Size(rx * 2f, 36f),
    )
    drawPath(
        twinPath(VehicleTwinGeometry.UNDERGLOW_TRACE),
        color = twinColor(argb(34, 197, 94, 0.38)),
        style = Stroke(width = 2f, cap = StrokeCap.Round),
    )
}

private fun DrawScope.drawBodyShell(
    paths: TwinPaths,
    paint: PaintPalette,
    state: VehicleTwinState,
) {
    drawPath(paths.body, brush = verticalBrush(paint.body, 104f, 232f))
    drawPath(paths.body, color = twinColor(paint.bodyStroke), style = Stroke(width = 1.2f))
    drawPath(
        paths.bodyChromeArc,
        color = twinColor(paint.bodyChrome).copy(alpha = CHROME_ARC_ALPHA),
        style = Stroke(width = 2f, cap = StrokeCap.Round),
    )
    drawPath(paths.lowerShadow, brush = verticalBrush(paint.lower, 198f, 224f), alpha = LOWER_SHADOW_ALPHA)
    drawPath(paths.mirror, brush = diagonalBrush(paint.mirror, Offset(177f, 145f), Offset(221f, 161f)))
    drawPath(paths.mirror, color = twinColor(TwinColors.mirrorStroke), style = Stroke(width = 0.7f))
    drawPath(paths.frontHandle, color = twinColor(TwinColors.handleDark))
    // Wheel-arch cladding shadows (paint-tinted).
    drawPath(paths.frontArch, color = twinColor(paint.bodyShadow), alpha = ARCH_ALPHA, style = Stroke(width = 6f, cap = StrokeCap.Round))
    drawPath(paths.rearArch, color = twinColor(paint.bodyShadow), alpha = ARCH_ALPHA, style = Stroke(width = 6f, cap = StrokeCap.Round))
    drawOpenable(paths.frunkSeam, paths.frunkOpen, state.frunkOpen)
    drawOpenable(paths.trunkSeam, paths.trunkOpen, state.trunkOpen)
}

private fun DrawScope.drawOpenable(
    seam: Path,
    openPanel: Path,
    open: Boolean?,
) {
    val isOpen = open == true
    drawPath(
        seam,
        color = if (isOpen) twinColor(TwinColors.doorOpen) else twinColor(TwinColors.seamFaint),
        style = Stroke(width = if (isOpen) 1.6f else 0.8f, cap = StrokeCap.Round),
    )
    if (isOpen) {
        drawPath(openPanel, color = twinColor(TwinColors.frunkTrunkOpen))
        drawPath(openPanel, color = twinColor(TwinColors.doorOpen), style = Stroke(width = 1.2f))
    }
}

private fun DrawScope.drawBody3dDetails(
    paths: TwinPaths,
    paint: PaintPalette,
) {
    val surface = diagonalBrush(paint.surface, Offset(58f, 145f), Offset(558f, 221f))
    drawPath(paths.hoodSurface, brush = surface, alpha = SURFACE_ALPHA)
    drawPath(paths.frontDoorSurface, brush = surface, alpha = SURFACE_ALPHA)
    drawPath(paths.rearDoorSurface, brush = surface, alpha = SURFACE_ALPHA)
    drawPath(paths.quarterSurface, brush = surface, alpha = SURFACE_ALPHA)
    drawPath(paths.beltline, color = twinColor(TwinColors.white14), style = Stroke(width = 1f, cap = StrokeCap.Round))
    drawPath(paths.rockerDepth, brush = verticalBrush(paint.lower, 211f, 243f), alpha = ROCKER_ALPHA)
    drawPath(paths.doorCutFront, color = twinColor(TwinColors.white18), style = Stroke(width = 0.9f, cap = StrokeCap.Round))
    drawPath(paths.doorCutRear, color = twinColor(TwinColors.white14), style = Stroke(width = 0.9f, cap = StrokeCap.Round))
    drawPath(paths.doorHandleFront, color = twinColor(TwinColors.handleDark), style = Stroke(width = 2.6f, cap = StrokeCap.Round))
    drawPath(paths.doorHandleRear, color = twinColor(TwinColors.handleDark), style = Stroke(width = 2.6f, cap = StrokeCap.Round))
}

private fun DrawScope.drawReflections(paths: TwinPaths) {
    drawPath(
        paths.shoulderHighlight,
        color = twinColor(argb(255, 255, 255, 0.34)),
        alpha = REFLECTION_ALPHA,
        style = Stroke(width = 1.2f, cap = StrokeCap.Round),
    )
    drawPath(paths.softReflection, color = twinColor(argb(255, 255, 255, 0.18)), alpha = REFLECTION_ALPHA)
}

private fun DrawScope.drawWindows(
    paths: TwinPaths,
    state: VehicleTwinState,
) {
    drawPath(paths.cabin, color = twinColor(TwinColors.cabinFill))
    drawPath(paths.cabin, color = twinColor(TwinColors.cabinStroke), style = Stroke(width = 1.6f))
    drawPane(paths.windowFd, state.windowFD)
    drawPane(paths.windowRd, state.windowRD)
    drawPath(paths.bPillar, color = twinColor(TwinColors.glassPillarDark), style = Stroke(width = 3f, cap = StrokeCap.Round))
    drawPath(paths.roofLine, color = twinColor(TwinColors.white18), style = Stroke(width = 1.2f, cap = StrokeCap.Round))
    drawPath(paths.glassReflection, color = twinColor(argb(255, 255, 255, 0.34)), style = Stroke(width = 1.4f, cap = StrokeCap.Round))
    drawPath(paths.aPillar, color = twinColor(argb(2, 6, 23, 0.45)), style = Stroke(width = 2f, cap = StrokeCap.Round))
    if (passengerWindowAlert(state)) {
        drawPath(paths.passengerAlert, color = twinColor(TwinColors.amber), style = Stroke(width = 2f, cap = StrokeCap.Round))
    }
}

private fun DrawScope.drawPane(
    pane: Path,
    window: WindowState,
) {
    val fillArgb = windowFillArgb(window)
    if (fillArgb != null) {
        drawPath(pane, color = twinColor(fillArgb))
    } else {
        drawPath(pane, brush = glassGradientBrushFallback())
    }
    drawPath(pane, color = twinColor(windowStrokeArgb(window)), style = Stroke(width = 1.1f))
}

private fun DrawScope.drawDoors(
    paths: TwinPaths,
    state: VehicleTwinState,
) {
    // Passenger-side door-ajar alerts (web PassengerDoorAlerts).
    if (state.doors.passengerFront == true) {
        drawPath(paths.passengerFrontAlert, color = twinColor(TwinColors.doorOpen), style = Stroke(width = 2f, cap = StrokeCap.Round))
    }
    if (state.doors.passengerRear == true) {
        drawPath(paths.passengerRearAlert, color = twinColor(TwinColors.doorOpen), style = Stroke(width = 2f, cap = StrokeCap.Round))
    }
    drawDoor(paths.doorRearOpen, state.doors.driverRear, Offset(444f, 153f), Offset(450f, 222f), Offset(374f, 174f))
    drawDoor(paths.doorFrontOpen, state.doors.driverFront, Offset(318f, 153f), Offset(307f, 223f), Offset(254f, 174f))
}

private fun DrawScope.drawDoor(
    openPanel: Path,
    open: Boolean?,
    seamStart: Offset,
    seamEnd: Offset,
    handle: Offset,
) {
    val isOpen = open == true
    if (isOpen) {
        drawPath(openPanel, color = twinColor(TwinColors.amberFill))
        drawPath(openPanel, color = twinColor(TwinColors.doorOpen), style = Stroke(width = 1.4f))
    }
    drawLine(
        color = twinColor(doorStrokeArgb(open)),
        start = seamStart,
        end = seamEnd,
        strokeWidth = if (isOpen) 2f else 1f,
        pathEffect = if (isOpen) null else PathEffect.dashPathEffect(floatArrayOf(4f, 4f)),
    )
    drawRoundRect(
        color = if (isOpen) twinColor(TwinColors.doorOpen) else twinColor(TwinColors.hubStroke),
        topLeft = handle,
        size = Size(17f, 4f),
        cornerRadius = CornerRadius(2f, 2f),
    )
}

private fun DrawScope.drawDriverSeat(state: VehicleTwinState) {
    if (state.driverSeatOccupied != true) return
    drawOval(twinColor(TwinColors.seatOccupied), topLeft = Offset(237f, 125f), size = Size(18f, 24f))
    drawOval(twinColor(TwinColors.seatOccupiedStroke), topLeft = Offset(237f, 125f), size = Size(18f, 24f), style = Stroke(width = 1f))
}

private fun DrawScope.drawChargePort(
    paint: PaintPalette,
    state: VehicleTwinState,
    anim: VehicleTwinAnim,
) {
    val cx = 498f
    val cy = 160f
    val active = state.isCharging || state.chargePortOpen == true
    val fill = if (active) TwinColors.chargeGreenFill else TwinColors.neutral
    val stroke = if (active) TwinColors.chargeGreen else paint.bodyStroke
    drawCircle(twinColor(fill), radius = 7f, center = Offset(cx, cy))
    drawCircle(twinColor(stroke), radius = 7f, center = Offset(cx, cy), style = Stroke(width = 1.3f))
    if (state.isCharging) {
        drawCircle(twinColor(TwinColors.chargeGreen).copy(alpha = anim.chargePulse), radius = 5f, center = Offset(cx, cy))
        val ringR = 8f + (18f - 8f) * anim.chargePulse
        drawCircle(
            twinColor(TwinColors.chargeGreen),
            radius = ringR,
            center = Offset(cx, cy),
            alpha = 1f - anim.chargePulse,
            style = Stroke(width = 1f),
        )
        drawPath(twinPath(VehicleTwinGeometry.CHARGE_BOLT), color = twinColor(TwinColors.chargeGreen))
    } else if (state.chargePortOpen == true) {
        drawCircle(twinColor(TwinColors.chargeGreen), radius = 11f, center = Offset(cx, cy), style = Stroke(width = 0.8f))
    }
}

private fun DrawScope.drawHeadlights(
    paths: TwinPaths,
    paint: PaintPalette,
    state: VehicleTwinState,
    anim: VehicleTwinAnim,
) {
    val on = state.headlights == true
    drawPath(
        paths.headlightLens,
        color = if (on) twinColor(paint.headlightOn) else twinColor(TwinColors.headlightOff),
        style = Stroke(width = 2.5f, cap = StrokeCap.Round),
    )
    drawPath(paths.headlightAccent, color = twinColor(TwinColors.headlightAccent), style = Stroke(width = 1f, cap = StrokeCap.Round))
    if (on) {
        drawOval(twinColor(TwinColors.headlightGlow).copy(alpha = anim.lightPulse), topLeft = Offset(55f, 179f), size = Size(34f, 14f))
        drawPath(paths.headlightBeam, color = twinColor(paint.headlightBeam).copy(alpha = anim.lightPulse))
    }
    if (frontFlashing(state)) {
        drawOval(twinColor(TwinColors.amber).copy(alpha = anim.lightPulse), topLeft = Offset(95f, 189f), size = Size(14f, 8f))
    }
}

private fun DrawScope.drawTaillights(
    paths: TwinPaths,
    state: VehicleTwinState,
    anim: VehicleTwinAnim,
) {
    val flashing = rearFlashing(state)
    drawPath(
        paths.taillight,
        color = twinColor(TwinColors.taillightHousing),
    )
    drawPath(
        paths.taillight,
        color = if (flashing) twinColor(TwinColors.amber) else twinColor(TwinColors.taillightBase),
        style = Stroke(width = 3.2f, cap = StrokeCap.Round),
    )
    drawPath(
        paths.taillightInner,
        color = twinColor(TwinColors.taillightActive),
        alpha = TAILLIGHT_INNER_ALPHA,
        style = Stroke(width = 1.8f, cap = StrokeCap.Round),
    )
    drawPath(paths.taillightAccent, color = twinColor(TwinColors.taillightAccent), style = Stroke(width = 1.2f, cap = StrokeCap.Round))
    if (flashing) {
        drawPath(
            paths.taillight,
            color = twinColor(TwinColors.amber).copy(alpha = anim.lightPulse),
            style = Stroke(width = 3.2f, cap = StrokeCap.Round),
        )
    }
}

private fun DrawScope.drawWheel(
    cx: Float,
    cy: Float,
    anim: VehicleTwinAnim,
) {
    val center = Offset(cx, cy)
    drawOval(twinColor(argb(0, 0, 0, 0.38)), topLeft = Offset(cx + 4f - 40f, cy + 3f - 35f), size = Size(80f, 70f))
    val tire = radialBrush(listOf(argb(51, 65, 85, 0.72), argb(2, 6, 23, 0.96), argb(0, 0, 0, 1.0)), center, 39f)
    drawCircle(brush = tire, radius = 39f, center = center)
    drawCircle(twinColor(TwinColors.tireInner), radius = 31f, center = center)
    drawCircle(twinColor(TwinColors.tireSidewallStroke), radius = 31f, center = center, style = Stroke(width = 0.7f))
    rotate(degrees = anim.wheelAngle, pivot = center) {
        val rimDepth = radialBrush(listOf(argb(226, 232, 240, 0.22), argb(51, 65, 85, 0.42), argb(0, 0, 0, 0.92)), center, 28f)
        val rimFace = radialBrush(listOf(argb(71, 85, 105, 0.62), argb(15, 23, 42, 0.9), argb(0, 0, 0, 0.96)), center, 25f)
        drawCircle(brush = rimDepth, radius = 28f, center = center)
        drawCircle(brush = rimFace, radius = 25f, center = center)
        drawCircle(twinColor(TwinColors.hubStroke), radius = 25f, center = center, style = Stroke(width = 0.8f))
        for (angle in 0 until FULL_TURN_INT step SPOKE_STEP) {
            rotate(degrees = angle.toFloat(), pivot = center) {
                val blade = spokeBlade(cx, cy)
                drawPath(blade, color = twinColor(TwinColors.spoke))
                drawPath(blade, color = twinColor(TwinColors.spokeStroke), style = Stroke(width = 0.45f))
            }
        }
        drawCircle(twinColor(TwinColors.hub), radius = 10f, center = Offset(cx, cy))
        drawCircle(twinColor(TwinColors.hubStroke), radius = 10f, center = Offset(cx, cy), style = Stroke(width = 0.7f))
        for (angle in 0 until FULL_TURN_INT step LUG_STEP) {
            val rad = angle * PI / HALF_TURN_DEG
            drawCircle(
                twinColor(TwinColors.lug),
                radius = 1.1f,
                center = Offset(cx + cos(rad).toFloat() * 5.5f, cy + sin(rad).toFloat() * 5.5f),
            )
        }
        drawCircle(twinColor(TwinColors.cap), radius = 3.8f, center = Offset(cx, cy))
        drawCircle(twinColor(TwinColors.capStroke), radius = 3.8f, center = Offset(cx, cy), style = Stroke(width = 0.5f))
    }
}

private fun spokeBlade(
    cx: Float,
    cy: Float,
): Path =
    Path().apply {
        moveTo(cx + 3.5f, cy - 4f)
        cubicTo(cx + 8f, cy - 16f, cx + 16f, cy - 22f, cx + 24f, cy - 16f)
        cubicTo(cx + 19f, cy - 11f, cx + 13f, cy - 4f, cx + 5f, cy + 5f)
        close()
    }

private fun DrawScope.drawSecurity(
    state: VehicleTwinState,
    anim: VehicleTwinAnim,
) {
    val cx = 322f
    val cy = 132f
    if (state.sentryMode == true) {
        val sentryY = cy - 23f
        drawCircle(
            twinColor(TwinColors.sentryGlow).copy(alpha = anim.lightPulse),
            radius = 16f,
            center = Offset(cx, sentryY),
            style = Stroke(width = 1.2f),
        )
        drawShield(cx, sentryY, twinColor(TwinColors.sentryRed))
    }
    when (state.locked) {
        true -> drawLock(cx, cy, twinColor(TwinColors.lockedGreen), shackleClosed = true)
        false -> drawLock(cx, cy, twinColor(TwinColors.unlockedRed), shackleClosed = false)
        null -> Unit
    }
}

private fun DrawScope.drawShield(
    cx: Float,
    cy: Float,
    color: Color,
) {
    val shield =
        Path().apply {
            moveTo(cx, cy - 7f)
            lineTo(cx + 6f, cy - 4f)
            lineTo(cx + 6f, cy + 2f)
            cubicTo(cx + 6f, cy + 5f, cx + 3f, cy + 7f, cx, cy + 8f)
            cubicTo(cx - 3f, cy + 7f, cx - 6f, cy + 5f, cx - 6f, cy + 2f)
            lineTo(cx - 6f, cy - 4f)
            close()
        }
    drawPath(shield, color = color)
}

private fun DrawScope.drawLock(
    cx: Float,
    cy: Float,
    color: Color,
    shackleClosed: Boolean,
) {
    drawCircle(twinColor(TwinColors.appBackdrop), radius = 9f, center = Offset(cx, cy))
    drawRoundRect(
        color = color,
        topLeft = Offset(cx - 5f, cy - 1f),
        size = Size(10f, 8f),
        cornerRadius = CornerRadius(1.5f, 1.5f),
    )
    val shackleTop = if (shackleClosed) cy - 6f else cy - 8f
    val shackleLeft = if (shackleClosed) cx - 3f else cx - 1f
    drawArc(
        color = color,
        startAngle = 180f,
        sweepAngle = 180f,
        useCenter = false,
        topLeft = Offset(shackleLeft, shackleTop),
        size = Size(6f, 8f),
        style = Stroke(width = 1.6f, cap = StrokeCap.Round),
    )
}

// ── Brush helpers ────────────────────────────────────────────────────────────────────────────────────────────

private fun verticalBrush(
    stops: List<Long>,
    startY: Float,
    endY: Float,
): Brush =
    Brush.verticalGradient(
        colors = stops.map(::twinColor),
        startY = startY,
        endY = endY,
    )

private fun diagonalBrush(
    stops: List<Long>,
    start: Offset,
    end: Offset,
): Brush =
    Brush.linearGradient(
        colors = stops.map(::twinColor),
        start = start,
        end = end,
    )

private fun radialBrush(
    stops: List<Long>,
    center: Offset,
    radius: Float,
): Brush =
    Brush.radialGradient(
        colors = stops.map(::twinColor),
        center = center,
        radius = radius,
    )

/** The closed-window glass gradient fallback (web `glassGrad`) when a pane has no solid fill. */
private fun glassGradientBrushFallback(): Brush =
    Brush.verticalGradient(
        colors =
            listOf(
                twinColor(argb(148, 163, 184, 0.34)),
                twinColor(argb(15, 23, 42, 0.42)),
                twinColor(argb(2, 6, 23, 0.72)),
            ),
        startY = 113f,
        endY = 153f,
    )

// ── String + source builders ─────────────────────────────────────────────────────────────────────────────────

/** Builds the localized labels from the P1/S10 catalog; tests/previews pass a deterministic instance. */
@Composable
private fun rememberVehicleTwinStrings(): VehicleTwinStrings =
    VehicleTwinStrings(
        loadingLabel = stringResource(R.string.translation_common_loading),
        emptyTitle = stringResource(R.string.translation_digitalTwin_title),
        emptyDesc = stringResource(R.string.translation_digitalTwin_noVehicles),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        updatingLabel = stringResource(R.string.translation_freshness_updating),
        errorResource = stringResource(R.string.translation_common_vehicle),
        labels = rememberVehicleTwinLabels(),
    )

/** Builds the physical-state phrase set the accessible summary folds in, from the P1/S10 catalog. */
@Composable
private fun rememberVehicleTwinLabels(): VehicleTwinLabels =
    VehicleTwinLabels(
        twinTitle = stringResource(R.string.translation_digitalTwin_subtitle),
        open = stringResource(R.string.translation_common_open),
        closed = stringResource(R.string.translation_common_closed),
        partial = stringResource(R.string.translation_widget_doorWindow_partial),
        unknown = stringResource(R.string.translation_common_unknown),
        locked = stringResource(R.string.translation_digitalTwin_locked),
        unlocked = stringResource(R.string.translation_common_unlocked),
        charging = stringResource(R.string.translation_digitalTwin_charging),
        driving = stringResource(R.string.translation_digitalTwin_driving),
        sentry = stringResource(R.string.translation_digitalTwin_sentryMode),
        headlights = stringResource(R.string.translation_digitalTwin_headlights),
        doors = stringResource(R.string.translation_digitalTwin_doorsTitle),
        windows = stringResource(R.string.translation_digitalTwin_windowsTitle),
    )

/** Resolves the shared P1/S8 selection + fleet holders + the device-local paint store into the seam. */
@Composable
private fun rememberVehicleTwinSource(): VehicleTwinSource {
    val container = LocalDataContainer.current
    val paintStore = remember { inMemoryVehicleTwinPaintStore() }
    return remember(container, paintStore) {
        vehicleTwinSource(container.selectedVehicleStore, container.vehiclesStore, paintStore)
    }
}

// ── Tunables ─────────────────────────────────────────────────────────────────────────────────────────────────

private const val CHROME_ARC_ALPHA = 0.22f
private const val LOWER_SHADOW_ALPHA = 0.6f
private const val ARCH_ALPHA = 0.55f
private const val SURFACE_ALPHA = 0.27f
private const val ROCKER_ALPHA = 0.55f
private const val REFLECTION_ALPHA = 0.55f
private const val TAILLIGHT_INNER_ALPHA = 0.7f
private const val EMPTY_SILHOUETTE_ALPHA = 0.45f

private const val FULL_TURN = 360f
private const val FULL_TURN_INT = 360
private const val HALF_TURN_DEG = 180.0
private const val SPOKE_STEP = 36
private const val LUG_STEP = 72
private const val WHEEL_SPIN_MS = 900
private const val PULSE_MS = 1400
private const val PULSE_MIN = 0.35f
private const val CHARGE_MS = 1200
private const val CHARGE_MIN = 0.45f
private const val UNDERGLOW_MS = 2400
private const val UNDERGLOW_MIN = 0.2f
private const val UNDERGLOW_MAX = 0.55f
private const val DRIVE_IN_MS = 4200
private const val DRIVE_IN_START_FRACTION = 0.6f
private const val DRIVE_IN_ALPHA_MIN = 0.5f

private const val WHEEL_FRONT_X = 132f
private const val WHEEL_REAR_X = 430f
private const val WHEEL_Y = 226f

// ── Previews — one per rendered state + visual branch. ───────────────────────────────────────────────────────

private fun previewStrings(): VehicleTwinStrings =
    VehicleTwinStrings(
        loadingLabel = "Loading...",
        emptyTitle = "Digital Twin",
        emptyDesc = "No vehicles found. Add a vehicle to see its digital twin.",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        updatingLabel = "updating…",
        errorResource = "Vehicle",
        labels =
            VehicleTwinLabels(
                twinTitle = "Real-time vehicle physical state",
                open = "Open",
                closed = "Closed",
                partial = "Partial",
                unknown = "Unknown",
                locked = "Locked",
                unlocked = "Unlocked",
                charging = "Charging",
                driving = "Driving",
                sentry = "Sentry Mode",
                headlights = "Headlights",
                doors = "Doors & Openings",
                windows = "Windows",
            ),
    )

private fun previewData(
    id: PaintPaletteId,
    overridden: Boolean = false,
): VehicleTwinData = VehicleTwinData(PAINT_PALETTES.getValue(id), vehicleLabel = "Red Rocket", hasVehicle = true, overridden = overridden)

private val previewActiveState =
    VehicleTwinState(
        doors = DoorStates(driverFront = true, passengerFront = false, driverRear = false, passengerRear = false),
        windowFD = WindowState.Open,
        windowRD = WindowState.Closed,
        frunkOpen = true,
        trunkOpen = false,
        chargePortOpen = true,
        isCharging = true,
        isDriving = false,
        locked = false,
        sentryMode = true,
        headlights = true,
        hazards = false,
        turnSignal = TurnSignalState.Left,
        driverSeatOccupied = true,
    )

@Preview(name = "VehicleTwin · content (active)", showBackground = true, backgroundColor = 0xFF0B1120)
@Composable
private fun VehicleTwinContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleTwinContent(
            state = UiState(UiPhase.Content, data = previewData(PaintPaletteId.RedMulticoat)),
            twinState = previewActiveState,
            strings = previewStrings(),
            size = VehicleTwinSize.Lg,
            interactive = true,
        )
    }
}

@Preview(name = "VehicleTwin · idle (blue)", showBackground = true, backgroundColor = 0xFF0B1120)
@Composable
private fun VehicleTwinIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleTwinContent(
            state = UiState(UiPhase.Content, data = previewData(PaintPaletteId.DeepBlue)),
            twinState = EMPTY_TWIN_STATE.copy(locked = true),
            strings = previewStrings(),
            size = VehicleTwinSize.Md,
        )
    }
}

@Preview(name = "VehicleTwin · loading", showBackground = true, backgroundColor = 0xFF0B1120)
@Composable
private fun VehicleTwinLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleTwinContent(state = UiState.loading(), twinState = EMPTY_TWIN_STATE, strings = previewStrings())
    }
}

@Preview(name = "VehicleTwin · empty", showBackground = true, backgroundColor = 0xFF0B1120)
@Composable
private fun VehicleTwinEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleTwinContent(
            state = UiState(UiPhase.Empty, data = VehicleTwinData.EMPTY),
            twinState = EMPTY_TWIN_STATE,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleTwin · stale", showBackground = true, backgroundColor = 0xFF0B1120)
@Composable
private fun VehicleTwinStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleTwinContent(
            state = UiState(UiPhase.Content, data = previewData(PaintPaletteId.MidnightSilver), fetchedAt = 1L, stale = true),
            twinState = EMPTY_TWIN_STATE,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleTwin · error", showBackground = true, backgroundColor = 0xFF0B1120)
@Composable
private fun VehicleTwinErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleTwinContent(
            state = UiState(UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Http, httpStatus = PREVIEW_SERVER_ERROR),
            twinState = EMPTY_TWIN_STATE,
            strings = previewStrings(),
        )
    }
}

private const val PREVIEW_SERVER_ERROR = 503
