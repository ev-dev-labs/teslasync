// The native Jetpack Compose + Material 3 TeslaCarViz shared surface — a parity port of
// web/src/components/data-display/TeslaCarViz.tsx. The web component is a presentational vehicle illustration: it
// reads the active light/dark theme (web `useTheme` → `useSvgPalette`) and draws a per-model SVG car with a battery
// bar, charge cable, lock glyph, climate waves, sentry rings, speed lines and a status row, all keyed off the
// caller's live vehicle props. This file is the thin render layer over the pure TeslaCarVizModel.kt projection: it
// resolves the theme palette + the localized labels, parses the verbatim SVG geometry, and draws it on a Compose
// Canvas (no SVG runtime) with reduced-motion-aware animation.
//
// Parity choices:
//   • Theme binding (the only data source — web `useTheme`/`useSvgPalette`): the surface reads the active scheme via
//     [MaterialTheme] and rebuilds the full light/dark colour palette ([carVizPalette]); it performs no HTTP and no
//     data fetch, exactly the feed-less presentational contract the sibling Speed / AnimatedNumber surfaces follow.
//   • Geometry: the exact web path strings + wheel anchors are reused (CarVizGeometry) and rendered through the
//     platform [PathParser], so the native car is the same shape as the web SVG, scaled from the 560×290 viewBox.
//   • States: every visual branch the web draws is reproduced — idle vs driving, charging, locked vs unlocked,
//     climate, sentry, the three battery colour tiers, the five bodies, the three sizes, light vs dark — plus a
//     defensive empty (null state) neutral silhouette so the surface never renders a blank box.
//   • Battery readout: the colour-tiered fill bar is drawn in the illustration (web parity); the numeric percent is
//     surfaced as a legible status chip (an Android-idiomatic adaptation of the web's 3px in-SVG label), so the value
//     stays readable and screen-reader reachable instead of sub-pixel text.
//   • i18n: every status label resolves through the P1/S10 catalog (`common.*`); no English literal ships in code.
//   • Accessibility: the illustration exposes the full vehicle state as one spoken summary; the status chips are
//     real, font-scalable Text; reduced motion renders the final static frame (no wheel spin / pulse / waves).
//   • Diagnostics: the one-shot PII-safe `view.opened` event (P1/S11) is recorded on first composition.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/TeslaCarViz) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located stateless content, sub-composables and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.teslacarviz

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.drawBehind
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
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs

// ── Theme palette (the web useSvgPalette port) ───────────────────────────────────────────────────────────────

/** A fill + stroke colour pair (web `palette.body` / `glass` / `wind` / mini parts). */
data class StrokeFill(
    val fill: Color,
    val stroke: Color,
)

/** The wheel colour set (web `palette.wheel`). */
data class WheelColors(
    val outer: Color,
    val outerStroke: Color,
    val inner: Color,
    val innerStroke: Color,
    val hub: Color,
    val hubStroke: Color,
)

/** The body-detail line colours (web `palette.detail`). */
data class DetailColors(
    val line: Color,
    val lineFaint: Color,
    val lineSubtle: Color,
)

/** The headlight colour set (web `palette.headlight*`). */
data class HeadlightColors(
    val on: Color,
    val projectorOn: Color,
    val turnSignalOn: Color,
    val off: Color,
)

/** The battery-bar colours (web `palette.battery`). */
data class BatteryColors(
    val bg: Color,
    val text: Color,
)

/** The sentry-ring colours (web `palette.sentry`). */
data class SentryColors(
    val ring1: Color,
    val ring2: Color,
)

/** The ambient-glow centre colours per state (web `palette.ambient`). */
data class AmbientColors(
    val sentry: Color,
    val charging: Color,
    val driving: Color,
    val idle: Color,
)

/** The compact-silhouette colours (web `palette.miniBody` / `miniWheel` / `miniBatBg`). */
data class MiniColors(
    val body: StrokeFill,
    val wheel: StrokeFill,
    val batBg: Color,
)

/**
 * The theme-aware colour palette the surface draws with — the native port of the web `useSvgPalette` hook. Every
 * value is keyed off the active light/dark scheme so the illustration tracks the theme exactly as the web does.
 * `LongParameterList` is suppressed: this is a flat colour bundle (the web palette object), not a behavioural
 * constructor; the values are grouped into the same sub-structures the web palette uses.
 */
@Suppress("LongParameterList")
data class CarVizPalette(
    val isLight: Boolean,
    val body: StrokeFill,
    val glass: StrokeFill,
    val wind: StrokeFill,
    val wheel: WheelColors,
    val detail: DetailColors,
    val headlight: HeadlightColors,
    val battery: BatteryColors,
    val sentry: SentryColors,
    val ambient: AmbientColors,
    val mini: MiniColors,
    val shadow: Color,
    val falconMain: Color,
    val falconTip: Color,
    val speedLine: Color,
    val lockBg: Color,
    val climate: Color,
    val tread: Color,
    val statusInactive: Color,
    val statusTextInactive: Color,
)

private fun rgba(
    r: Int,
    g: Int,
    b: Int,
    a: Float,
): Color = Color(red = r / COLOR_MAX, green = g / COLOR_MAX, blue = b / COLOR_MAX, alpha = a)

private const val COLOR_MAX = 255f

/**
 * Build the full light or dark [CarVizPalette] — a verbatim transcription of the web `useSvgPalette` branches, so a
 * theme toggle re-tints the entire illustration with no other change. The semantic accent colours (battery, lock,
 * charge, sentry) are NOT here — they are theme-invariant and live in [CarVizColors].
 */
fun carVizPalette(isLight: Boolean): CarVizPalette = if (isLight) lightPalette() else darkPalette()

private fun lightPalette(): CarVizPalette =
    CarVizPalette(
        isLight = true,
        body = StrokeFill(Color(0xFFD4D8E0), rgba(0, 0, 0, 0.2f)),
        glass = StrokeFill(rgba(0, 120, 200, 0.15f), rgba(0, 120, 200, 0.25f)),
        wind = StrokeFill(rgba(0, 120, 200, 0.12f), rgba(0, 120, 200, 0.2f)),
        wheel =
            WheelColors(
                outer = rgba(0, 0, 0, 0.15f),
                outerStroke = rgba(0, 0, 0, 0.2f),
                inner = rgba(40, 40, 50, 0.6f),
                innerStroke = rgba(0, 0, 0, 0.3f),
                hub = rgba(50, 50, 60, 0.7f),
                hubStroke = rgba(0, 0, 0, 0.25f),
            ),
        detail = DetailColors(rgba(0, 0, 0, 0.1f), rgba(0, 0, 0, 0.06f), rgba(0, 0, 0, 0.04f)),
        headlight = HeadlightColors(Color.White, Color(0xFFFFFBE6), Color(0xFFFBBF24), rgba(0, 0, 0, 0.1f)),
        battery = BatteryColors(rgba(0, 0, 0, 0.08f), rgba(0, 0, 0, 0.7f)),
        sentry = SentryColors(rgba(239, 68, 68, 0.2f), rgba(239, 68, 68, 0.12f)),
        ambient =
            AmbientColors(
                sentry = rgba(239, 68, 68, 0.2f),
                charging = rgba(16, 185, 129, 0.2f),
                driving = rgba(0, 120, 200, 0.15f),
                idle = rgba(0, 0, 0, 0.03f),
            ),
        mini =
            MiniColors(
                body = StrokeFill(rgba(0, 0, 0, 0.06f), rgba(0, 0, 0, 0.25f)),
                wheel = StrokeFill(rgba(0, 0, 0, 0.15f), rgba(0, 0, 0, 0.2f)),
                batBg = rgba(0, 0, 0, 0.08f),
            ),
        shadow = rgba(0, 0, 0, 0.08f),
        falconMain = rgba(0, 120, 200, 0.15f),
        falconTip = rgba(0, 120, 200, 0.1f),
        speedLine = rgba(0, 120, 200, 0.3f),
        lockBg = rgba(0, 0, 0, 0.08f),
        climate = rgba(0, 120, 200, 0.4f),
        tread = rgba(0, 0, 0, 0.1f),
        statusInactive = rgba(0, 0, 0, 0.2f),
        statusTextInactive = rgba(0, 0, 0, 0.3f),
    )

private fun darkPalette(): CarVizPalette =
    CarVizPalette(
        isLight = false,
        body = StrokeFill(Color(0xFF2D3748), rgba(255, 255, 255, 0.08f)),
        glass = StrokeFill(rgba(15, 23, 42, 0.9f), rgba(255, 255, 255, 0.12f)),
        wind = StrokeFill(rgba(15, 23, 42, 0.85f), rgba(255, 255, 255, 0.1f)),
        wheel =
            WheelColors(
                outer = rgba(0, 0, 0, 0.6f),
                outerStroke = rgba(255, 255, 255, 0.1f),
                inner = rgba(30, 30, 40, 0.8f),
                innerStroke = rgba(255, 255, 255, 0.2f),
                hub = rgba(60, 60, 70, 0.9f),
                hubStroke = rgba(255, 255, 255, 0.15f),
            ),
        detail = DetailColors(rgba(255, 255, 255, 0.08f), rgba(255, 255, 255, 0.06f), rgba(255, 255, 255, 0.04f)),
        headlight = HeadlightColors(Color.White, Color(0xFFFFFBE6), Color(0xFFFBBF24), rgba(255, 255, 255, 0.08f)),
        battery = BatteryColors(rgba(255, 255, 255, 0.05f), Color.White),
        sentry = SentryColors(rgba(239, 68, 68, 0.15f), rgba(239, 68, 68, 0.08f)),
        ambient =
            AmbientColors(
                sentry = rgba(239, 68, 68, 0.4f),
                charging = rgba(16, 185, 129, 0.4f),
                driving = rgba(0, 240, 255, 0.3f),
                idle = rgba(255, 255, 255, 0.05f),
            ),
        mini =
            MiniColors(
                body = StrokeFill(rgba(255, 255, 255, 0.04f), rgba(255, 255, 255, 0.15f)),
                wheel = StrokeFill(rgba(0, 0, 0, 0.5f), rgba(255, 255, 255, 0.1f)),
                batBg = rgba(255, 255, 255, 0.05f),
            ),
        shadow = rgba(0, 0, 0, 0.3f),
        falconMain = rgba(0, 240, 255, 0.08f),
        falconTip = rgba(0, 240, 255, 0.06f),
        speedLine = rgba(0, 240, 255, 0.3f),
        lockBg = rgba(0, 0, 0, 0.4f),
        climate = rgba(0, 240, 255, 0.4f),
        tread = rgba(255, 255, 255, 0.06f),
        statusInactive = rgba(255, 255, 255, 0.2f),
        statusTextInactive = rgba(255, 255, 255, 0.3f),
    )

// ── Animation frame (reduced-motion-aware; web framer-motion port) ───────────────────────────────────────────

/**
 * One frame of the surface's continuous animations — the native analogue of the web framer-motion loops. The
 * default [Static] instance is the reduced-motion / preview / test frame: wheels at rest, lights/plug at full
 * opacity, rings unrotated, and waves at a mid phase so a static render still shows the wave/speed marks.
 *
 * @property wheelAngle wheel spin degrees (web wheel `rotate: 360` while driving).
 * @property lightPulse head/tail-light opacity multiplier (web light `opacity` pulse).
 * @property plugPulse charge-plug scale/opacity multiplier (web plug `scale`/`opacity` pulse).
 * @property sentryAngle1 outer sentry-ring rotation (web ring `rotate: 360`).
 * @property sentryAngle2 inner sentry-ring rotation (web ring `rotate: -360`).
 * @property wave 0..1 phase for the climate waves + speed lines (web wave/line loops).
 */
data class CarVizAnim(
    val wheelAngle: Float = 0f,
    val lightPulse: Float = 1f,
    val plugPulse: Float = 1f,
    val sentryAngle1: Float = 0f,
    val sentryAngle2: Float = 0f,
    val wave: Float = WAVE_STATIC,
) {
    companion object {
        /** The static (reduced-motion / preview / test) frame. */
        val Static: CarVizAnim = CarVizAnim()
    }
}

private const val WAVE_STATIC = 0.5f

// ── Public composables ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The TeslaCarViz vehicle illustration — the Android port of the web `TeslaCarViz`. Renders the per-[model] car at
 * the chosen [size] for the supplied [state], tracking the active light/dark theme. A `null` [state] renders the
 * defensive empty (neutral silhouette) state. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11).
 *
 * @param state the live vehicle status, or `null` for the empty state.
 * @param model the body to draw (web `model`); default [TeslaModel.Model3].
 * @param size the render size (web `size`); default [TeslaCarVizSize.Md].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun TeslaCarViz(
    state: TeslaCarVizState?,
    modifier: Modifier = Modifier,
    model: TeslaModel = TeslaModel.Model3,
    size: TeslaCarVizSize = TeslaCarVizSize.Md,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TeslaCarVizDiagnostics.recordViewOpened(logger) }
    val isLight = MaterialTheme.colorScheme.background.luminance() > LIGHT_LUMINANCE_THRESHOLD
    val palette = remember(isLight) { carVizPalette(isLight) }
    val strings = rememberCarVizStrings()
    val anim = rememberCarVizAnim(state)
    TeslaCarVizContent(
        state = state,
        model = model,
        size = size,
        palette = palette,
        strings = strings,
        anim = anim,
        modifier = modifier,
    )
}

private const val LIGHT_LUMINANCE_THRESHOLD = 0.5f

/**
 * The stateless renderer — the preview / UI-test entry point. Draws the car illustration plus the localized status
 * row for a present [state], or the neutral empty silhouette for a `null` [state], using the supplied [palette],
 * [strings] and animation [anim]. Hoisted out of the stateful entry so every state is preview- and screenshot-able.
 */
@Composable
fun TeslaCarVizContent(
    state: TeslaCarVizState?,
    model: TeslaModel,
    size: TeslaCarVizSize,
    palette: CarVizPalette,
    strings: CarVizStrings,
    modifier: Modifier = Modifier,
    anim: CarVizAnim = CarVizAnim.Static,
) {
    if (state == null) {
        CarEmpty(model = model, sizeSpec = size, palette = palette, modifier = modifier)
        return
    }
    val batteryLabel = stringResource(R.string.translation_common_battery)
    val drivingLabel = stringResource(R.string.translation_Driving)
    val summary =
        remember(state, strings, batteryLabel, drivingLabel) {
            TeslaCarVizProjection.accessibleSummary(state, strings, batteryLabel, drivingLabel)
        }
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        CarIllustration(
            state = state,
            model = model,
            sizeSpec = size,
            palette = palette,
            anim = anim,
            contentDescription = summary,
        )
        CarStatusRow(state = state, strings = strings, palette = palette)
    }
}

/**
 * A compact list/card silhouette of the vehicle — the Android port of the web `TeslaCarMini`. Draws the model's
 * mini outline with a battery fill bar and an optional charging pip, tracking the active theme.
 */
@Composable
fun TeslaCarMini(
    batteryLevel: Int,
    isCharging: Boolean,
    modifier: Modifier = Modifier,
    model: TeslaModel = TeslaModel.Model3,
) {
    val isLight = MaterialTheme.colorScheme.background.luminance() > LIGHT_LUMINANCE_THRESHOLD
    val palette = remember(isLight) { carVizPalette(isLight) }
    val path = remember(model) { PathParser().parsePathString(CarVizGeometry.miniPath(model)).toPath() }
    val tall = model == TeslaModel.ModelX
    val fillColor = Color(TeslaCarVizProjection.batteryColorArgb(batteryLevel))
    val fraction = TeslaCarVizProjection.batteryFraction(batteryLevel)
    Canvas(
        modifier =
            modifier
                .width(MINI_WIDTH.dp)
                .aspectRatio(MINI_VIEW_W / (if (tall) MINI_VIEW_H_TALL else MINI_VIEW_H))
                .clearAndSetSemantics {},
    ) {
        val sx = size.width / MINI_VIEW_W
        val sy = size.height / (if (tall) MINI_VIEW_H_TALL else MINI_VIEW_H)
        scale(sx, sy, pivot = Offset.Zero) {
            drawPath(path, color = palette.mini.body.fill)
            drawPath(path, color = palette.mini.body.stroke, style = Stroke(width = MINI_STROKE))
            val wheelY = if (tall) MINI_WHEEL_Y_TALL else MINI_WHEEL_Y
            for (cx in listOf(MINI_WHEEL_FX, MINI_WHEEL_RX)) {
                drawCircle(palette.mini.wheel.fill, radius = MINI_WHEEL_R, center = Offset(cx, wheelY))
                drawCircle(
                    palette.mini.wheel.stroke,
                    radius = MINI_WHEEL_R,
                    center = Offset(cx, wheelY),
                    style = Stroke(width = MINI_WHEEL_STROKE),
                )
            }
            val barY = if (tall) MINI_BAR_Y_TALL else MINI_BAR_Y
            drawRoundedBar(MINI_BAR_X, barY, MINI_BAR_W, MINI_BAR_H, palette.mini.batBg)
            drawRoundedBar(MINI_BAR_X, barY, MINI_BAR_W * fraction, MINI_BAR_H, fillColor.copy(alpha = MINI_FILL_ALPHA))
            if (isCharging) {
                drawCircle(
                    Color(CarVizColors.CHARGING).copy(alpha = MINI_PIP_ALPHA),
                    radius = MINI_PIP_R,
                    center = Offset(MINI_PIP_X, if (tall) MINI_PIP_Y_TALL else MINI_PIP_Y),
                )
            }
        }
    }
}

private const val MINI_WIDTH = 64f
private const val MINI_VIEW_W = 64f
private const val MINI_VIEW_H = 32f
private const val MINI_VIEW_H_TALL = 34f
private const val MINI_STROKE = 0.8f
private const val MINI_WHEEL_FX = 18f
private const val MINI_WHEEL_RX = 50f
private const val MINI_WHEEL_R = 4f
private const val MINI_WHEEL_STROKE = 0.5f
private const val MINI_WHEEL_Y = 22f
private const val MINI_WHEEL_Y_TALL = 24f
private const val MINI_BAR_X = 18f
private const val MINI_BAR_Y = 17f
private const val MINI_BAR_Y_TALL = 19f
private const val MINI_BAR_W = 28f
private const val MINI_BAR_H = 2f
private const val MINI_FILL_ALPHA = 0.8f
private const val MINI_PIP_X = 10f
private const val MINI_PIP_Y = 18f
private const val MINI_PIP_Y_TALL = 20f
private const val MINI_PIP_R = 2f
private const val MINI_PIP_ALPHA = 0.8f

// ── Animation wiring ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Drive the continuous animations from a single [rememberInfiniteTransition], collapsing every loop to its static
 * frame under reduced motion or when its feature is inactive — so an idle/parked surface schedules no frames.
 */
@Composable
private fun rememberCarVizAnim(state: TeslaCarVizState?): CarVizAnim {
    val reduce = rememberReducedMotion()
    if (reduce || state == null) return CarVizAnim.Static
    val driving = TeslaCarVizProjection.isDriving(state)
    val transition = rememberInfiniteTransition(label = "carviz")
    val wheelAngle by transition.animateFloat(
        initialValue = 0f,
        targetValue = if (driving) FULL_TURN else 0f,
        animationSpec = infiniteRepeatable(tween(WHEEL_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
        label = "wheel",
    )
    val lightPulse by transition.animateFloat(
        initialValue = 1f,
        targetValue = PULSE_MIN,
        animationSpec = infiniteRepeatable(tween(LIGHT_PERIOD_MS), RepeatMode.Reverse),
        label = "lightPulse",
    )
    val plugPulse by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (state.isCharging) PLUG_MIN else 1f,
        animationSpec = infiniteRepeatable(tween(PLUG_PERIOD_MS), RepeatMode.Reverse),
        label = "plugPulse",
    )
    val sentryAngle1 by transition.animateFloat(
        initialValue = 0f,
        targetValue = if (state.sentryMode) FULL_TURN else 0f,
        animationSpec = infiniteRepeatable(tween(SENTRY1_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
        label = "sentry1",
    )
    val sentryAngle2 by transition.animateFloat(
        initialValue = 0f,
        targetValue = if (state.sentryMode) -FULL_TURN else 0f,
        animationSpec = infiniteRepeatable(tween(SENTRY2_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
        label = "sentry2",
    )
    val wave by transition.animateFloat(
        initialValue = 0f,
        targetValue = if (state.isClimateOn || driving) 1f else WAVE_STATIC,
        animationSpec = infiniteRepeatable(tween(WAVE_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
        label = "wave",
    )
    return CarVizAnim(wheelAngle, lightPulse, plugPulse, sentryAngle1, sentryAngle2, wave)
}

private const val FULL_TURN = 360f
private const val PULSE_MIN = 0.85f
private const val PLUG_MIN = 0.8f
private const val WHEEL_PERIOD_MS = 800
private const val LIGHT_PERIOD_MS = 2000
private const val PLUG_PERIOD_MS = 1500
private const val SENTRY1_PERIOD_MS = 20000
private const val SENTRY2_PERIOD_MS = 30000
private const val WAVE_PERIOD_MS = 1600

// ── i18n labels ──────────────────────────────────────────────────────────────────────────────────────────────

/** Resolve the localized status labels from the P1/S10 catalog (`common.*`); tests pass a deterministic instance. */
@Composable
private fun rememberCarVizStrings(): CarVizStrings =
    CarVizStrings(
        charging = stringResource(R.string.translation_common_charging),
        notCharging = stringResource(R.string.translation_common_notCharging),
        locked = stringResource(R.string.translation_common_locked),
        unlocked = stringResource(R.string.translation_common_unlocked),
        climate = stringResource(R.string.translation_common_climate),
        sentry = stringResource(R.string.translation_common_sentry),
    )

// ── Illustration + status row + empty state ──────────────────────────────────────────────────────────────────

private const val VIEW_W = 560f
private const val VIEW_H = 290f
private const val EMPTY_ALPHA = 0.5f
private val SPOKE_ANGLES = listOf(0f, 72f, 144f, 216f, 288f)
private val CYBER_TREAD = listOf(-18f, -12f, -6f, 0f, 6f, 12f, 18f)
private const val AMBIENT_CX = 280f
private const val AMBIENT_CY = 160f
private const val AMBIENT_R = 170f
private const val TAIL_RED = 0xFFEF4444
private const val TAIL_CORE = 0xFFFF6B6B

/** The body / roof / windshield as parsed Compose [Path]s, memoized per model so they are not re-parsed per frame. */
data class CarBodyPaths(
    val body: Path,
    val roof: Path,
    val wind: Path,
)

private fun parsePath(data: String): Path = PathParser().parsePathString(data).toPath()

@Composable
private fun rememberBodyPaths(model: TeslaModel): CarBodyPaths =
    remember(model) {
        val p = CarVizGeometry.bodyPaths(model)
        CarBodyPaths(parsePath(p.body), parsePath(p.roof), parsePath(p.wind))
    }

private fun ambientColor(
    palette: CarVizPalette,
    kind: CarAmbient,
): Color =
    when (kind) {
        CarAmbient.Sentry -> palette.ambient.sentry
        CarAmbient.Charging -> palette.ambient.charging
        CarAmbient.Driving -> palette.ambient.driving
        CarAmbient.Idle -> palette.ambient.idle
    }

/** The car drawing — ambient glow, body, wheels, lights, battery bar and the active feature overlays on a Canvas. */
@Composable
private fun CarIllustration(
    state: TeslaCarVizState,
    model: TeslaModel,
    sizeSpec: TeslaCarVizSize,
    palette: CarVizPalette,
    anim: CarVizAnim,
    contentDescription: String,
) {
    val paths = rememberBodyPaths(model)
    val pos = remember(model) { CarVizGeometry.wheelPos(model) }
    val driving = TeslaCarVizProjection.isDriving(state)
    val batteryColor = Color(TeslaCarVizProjection.batteryColorArgb(state.batteryLevel))
    val fraction = TeslaCarVizProjection.batteryFraction(state.batteryLevel)
    val ambient = ambientColor(palette, TeslaCarVizProjection.ambientKind(state))
    Canvas(
        modifier =
            Modifier
                .width(sizeSpec.widthDp.dp)
                .aspectRatio(1f / TeslaCarVizProjection.aspect(model))
                .semantics { this.contentDescription = contentDescription },
    ) {
        scale(size.width / VIEW_W, size.height / VIEW_H, pivot = Offset.Zero) {
            drawAmbient(ambient)
            drawShadow(model, palette)
            drawCarBody(model, paths, palette)
            if (model != TeslaModel.Cybertruck) drawDetailLines(model, palette)
            drawWheel(pos.fx, pos.wy, model, palette, anim.wheelAngle)
            drawWheel(pos.rx, pos.wy, model, palette, anim.wheelAngle)
            drawHeadlight(pos, model, palette, driving, anim.lightPulse)
            if (driving) drawHeadlightBeam(pos)
            drawTaillight(pos, model, anim.lightPulse)
            drawDoorLine(model, palette)
            drawBatteryBar(pos, fraction, batteryColor, palette)
            if (state.isCharging) drawChargingCable(pos, anim.plugPulse)
            drawLock(pos, state.isLocked, palette)
            if (state.isClimateOn) drawClimateWaves(pos, palette, anim.wave)
            if (state.sentryMode) drawSentryRings(palette, anim.sentryAngle1, anim.sentryAngle2)
            if (driving) drawSpeedLines(palette, anim.wave)
        }
    }
}

/** The localized status chips below the car — a battery-percent chip plus the projected charge/lock/climate/sentry dots. */
@Composable
private fun CarStatusRow(
    state: TeslaCarVizState,
    strings: CarVizStrings,
    palette: CarVizPalette,
) {
    val dots = remember(state, strings) { TeslaCarVizProjection.statusDots(state, strings) }
    val batteryColor = Color(TeslaCarVizProjection.batteryColorArgb(state.batteryLevel))
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CarChip(label = "${state.batteryLevel}%", dotColor = batteryColor, labelColor = batteryColor)
        dots.forEach { dot ->
            val dotColor = if (dot.active) Color(dot.colorArgb) else palette.statusInactive
            val labelColor = if (dot.active) Color(dot.colorArgb) else palette.statusTextInactive
            CarChip(label = dot.label, dotColor = dotColor, labelColor = labelColor, glow = dot.active)
        }
    }
}

private val DOT_SIZE = 7.dp

/** A status chip: a leading colored dot (with an optional active glow) and a label. */
@Composable
private fun CarChip(
    label: String,
    dotColor: Color,
    labelColor: Color,
    modifier: Modifier = Modifier,
    glow: Boolean = false,
) {
    val dotModifier =
        if (glow) {
            Modifier.drawBehind { drawCircle(dotColor.copy(alpha = GLOW_ALPHA), radius = size.minDimension) }
        } else {
            Modifier
        }
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                dotModifier
                    .size(DOT_SIZE)
                    .clip(CircleShape)
                    .background(dotColor),
        )
        Text(label, style = MaterialTheme.typography.labelMedium, color = labelColor)
    }
}

private const val GLOW_ALPHA = 0.35f

/** The defensive empty state — a muted, status-free car silhouette plus a friendly caption; never a blank box. */
@Composable
private fun CarEmpty(
    model: TeslaModel,
    sizeSpec: TeslaCarVizSize,
    palette: CarVizPalette,
    modifier: Modifier = Modifier,
) {
    val paths = rememberBodyPaths(model)
    val pos = remember(model) { CarVizGeometry.wheelPos(model) }
    val message = stringResource(R.string.translation_common_noData)
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Canvas(
            modifier =
                Modifier
                    .width(sizeSpec.widthDp.dp)
                    .aspectRatio(1f / TeslaCarVizProjection.aspect(model))
                    .alpha(EMPTY_ALPHA)
                    .semantics { this.contentDescription = message },
        ) {
            scale(size.width / VIEW_W, size.height / VIEW_H, pivot = Offset.Zero) {
                drawShadow(model, palette)
                drawCarBody(model, paths, palette)
                drawWheel(pos.fx, pos.wy, model, palette, 0f)
                drawWheel(pos.rx, pos.wy, model, palette, 0f)
            }
        }
        Caption(message)
    }
}

// ── Canvas draw helpers (viewBox 560×290 coordinates; called inside the scaled DrawScope) ────────────────────

private fun DrawScope.drawAmbient(color: Color) {
    val center = Offset(AMBIENT_CX, AMBIENT_CY)
    drawCircle(
        brush = Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), center = center, radius = AMBIENT_R),
        radius = AMBIENT_R,
        center = center,
    )
}

private fun DrawScope.drawShadow(
    model: TeslaModel,
    palette: CarVizPalette,
) {
    val rx = if (model == TeslaModel.Cybertruck) 240f else 220f
    drawOval(palette.shadow, topLeft = Offset(AMBIENT_CX - rx, 258f), size = Size(rx * 2f, 24f))
}

private fun DrawScope.drawCarBody(
    model: TeslaModel,
    paths: CarBodyPaths,
    palette: CarVizPalette,
) {
    drawPath(paths.body, color = palette.body.fill)
    drawPath(paths.body, color = palette.body.stroke, style = Stroke(width = 1.5f))
    drawPath(paths.roof, color = palette.glass.fill)
    drawPath(paths.roof, color = palette.glass.stroke, style = Stroke(width = 1f))
    drawPath(paths.wind, color = palette.wind.fill)
    drawPath(paths.wind, color = palette.wind.stroke, style = Stroke(width = 0.8f))
    if (model == TeslaModel.Cybertruck) {
        drawLine(palette.detail.lineFaint, Offset(420f, 152f), Offset(420f, 200f), strokeWidth = 1f)
        drawLine(palette.detail.lineSubtle, Offset(121f, 180f), Offset(483f, 170f), strokeWidth = 0.5f)
    }
    if (model == TeslaModel.ModelX) drawFalconWing(palette)
}

private fun DrawScope.drawFalconWing(palette: CarVizPalette) {
    val main =
        Path().apply {
            moveTo(290f, 100f)
            lineTo(290f, 85f)
            cubicTo(290f, 78f, 300f, 75f, 310f, 78f)
            lineTo(340f, 88f)
        }
    drawPath(main, color = palette.falconMain, style = Stroke(width = 0.8f))
    val tip =
        Path().apply {
            moveTo(340f, 88f)
            lineTo(360f, 82f)
            cubicTo(365f, 80f, 370f, 82f, 370f, 87f)
        }
    drawPath(tip, color = palette.falconTip, style = Stroke(width = 0.8f))
}

private fun DrawScope.drawDetailLines(
    model: TeslaModel,
    palette: CarVizPalette,
) {
    drawRoofHighlight(model)
    drawDoorSeams(model, palette)
    drawSideSkirt(model, palette)
}

private fun DrawScope.drawRoofHighlight(model: TeslaModel) {
    val highlight =
        when (model) {
            TeslaModel.ModelS -> "M220 112 Q296 106 390 108"
            TeslaModel.ModelX, TeslaModel.ModelY -> "M220 108 Q296 102 380 104"
            else -> "M220 112 Q296 108 380 110"
        }
    drawPath(parsePath(highlight), color = rgba(255, 255, 255, 0.06f), style = Stroke(width = 1.5f, cap = StrokeCap.Round))
}

private fun DrawScope.drawDoorSeams(
    model: TeslaModel,
    palette: CarVizPalette,
) {
    val isS = model == TeslaModel.ModelS
    val frontTop =
        when (model) {
            TeslaModel.ModelX -> 120f
            TeslaModel.ModelY -> 122f
            else -> 126f
        }
    drawLine(
        palette.detail.lineFaint,
        Offset(if (isS) 270f else 265f, frontTop),
        Offset(if (isS) 268f else 260f, 205f),
        strokeWidth = 0.8f,
    )
    val rearTop =
        when (model) {
            TeslaModel.ModelX -> 122f
            TeslaModel.ModelY -> 124f
            else -> 128f
        }
    drawLine(
        palette.detail.lineFaint,
        Offset(if (isS) 355f else 345f, rearTop),
        Offset(if (isS) 358f else 348f, 205f),
        strokeWidth = 0.8f,
    )
}

private fun DrawScope.drawSideSkirt(
    model: TeslaModel,
    palette: CarVizPalette,
) {
    val skirt =
        when (model) {
            TeslaModel.ModelS -> "M120 202 Q200 208 296 208 Q430 208 498 202"
            TeslaModel.ModelX, TeslaModel.ModelY -> "M122 204 Q200 210 296 210 Q430 210 494 204"
            else -> "M120 202 Q200 208 296 208 Q430 208 496 202"
        }
    drawPath(parsePath(skirt), color = palette.detail.lineFaint, style = Stroke(width = 0.8f))
}

private fun DrawScope.drawWheel(
    cx: Float,
    cy: Float,
    model: TeslaModel,
    palette: CarVizPalette,
    wheelAngle: Float,
) {
    val cyber = model == TeslaModel.Cybertruck
    translate(cx, cy) {
        drawCircle(palette.wheel.outer, radius = 32f, center = Offset.Zero)
        drawCircle(palette.wheel.outerStroke, radius = 32f, center = Offset.Zero, style = Stroke(width = 1.5f))
        val innerR = if (cyber) 24f else 22f
        drawCircle(palette.wheel.inner, radius = innerR, center = Offset.Zero)
        drawCircle(palette.wheel.innerStroke, radius = innerR, center = Offset.Zero, style = Stroke(width = 2f))
        val spokeLen = if (cyber) 22f else 20f
        for (a in SPOKE_ANGLES) {
            rotate(a + wheelAngle, pivot = Offset.Zero) {
                drawLine(palette.wheel.hubStroke, Offset.Zero, Offset(0f, -spokeLen), strokeWidth = 2.5f, cap = StrokeCap.Round)
            }
        }
        drawCircle(palette.wheel.hub, radius = 8f, center = Offset.Zero)
        drawCircle(palette.wheel.hubStroke, radius = 8f, center = Offset.Zero, style = Stroke(width = 1.5f))
        drawCircle(palette.wheel.hubStroke.copy(alpha = palette.wheel.hubStroke.alpha * 0.5f), radius = 3f, center = Offset.Zero)
        if (cyber) {
            for (t in CYBER_TREAD) drawLine(palette.tread, Offset(t, -24f), Offset(t, -20f), strokeWidth = 2f)
        }
    }
}

private fun DrawScope.drawHeadlight(
    pos: WheelPos,
    model: TeslaModel,
    palette: CarVizPalette,
    driving: Boolean,
    pulse: Float,
) {
    val cyber = model == TeslaModel.Cybertruck
    drawDrl(pos, cyber, palette, driving, pulse)
    drawProjector(pos, cyber, palette, driving)
    drawTurnSignal(pos, cyber, palette, driving)
}

private fun DrawScope.drawDrl(
    pos: WheelPos,
    cyber: Boolean,
    palette: CarVizPalette,
    driving: Boolean,
    pulse: Float,
) {
    val drl =
        if (cyber) {
            Path().apply {
                moveTo(pos.headX, pos.headY - 3f)
                lineTo(pos.headX + 20f, pos.headY - 5f)
            }
        } else {
            Path().apply {
                moveTo(pos.headX - 2f, pos.headY - 14f)
                quadraticTo(pos.headX - 6f, pos.headY, pos.headX - 2f, pos.headY + 14f)
            }
        }
    val drlColor = if (driving) palette.headlight.on.copy(alpha = pulse) else palette.headlight.off
    drawPath(drl, color = drlColor, style = Stroke(width = if (cyber) 3f else 2.5f, cap = StrokeCap.Round))
}

private fun DrawScope.drawProjector(
    pos: WheelPos,
    cyber: Boolean,
    palette: CarVizPalette,
    driving: Boolean,
) {
    val px = pos.headX + if (cyber) 5f else 2f
    val prx = if (cyber) 3f else 4f
    val pry = if (cyber) 2.5f else 6f
    val color = (if (driving) palette.headlight.projectorOn else palette.headlight.off).copy(alpha = if (driving) 0.9f else 0.5f)
    drawOval(color, topLeft = Offset(px - prx, pos.headY - pry), size = Size(prx * 2f, pry * 2f))
}

private fun DrawScope.drawTurnSignal(
    pos: WheelPos,
    cyber: Boolean,
    palette: CarVizPalette,
    driving: Boolean,
) {
    val tx = pos.headX + if (cyber) 10f else 6f
    val ty = pos.headY + if (cyber) 0f else 12f
    val trx = if (cyber) 2f else 3f
    val tryy = if (cyber) 1.5f else 2f
    val color = (if (driving) palette.headlight.turnSignalOn else palette.headlight.off).copy(alpha = if (driving) 0.5f else 0.2f)
    drawOval(color, topLeft = Offset(tx - trx, ty - tryy), size = Size(trx * 2f, tryy * 2f))
}

private fun DrawScope.drawHeadlightBeam(pos: WheelPos) {
    val beam =
        Path().apply {
            moveTo(pos.headX - 5f, pos.headY - 8f)
            lineTo(pos.headX - 60f, pos.headY - 40f)
            lineTo(pos.headX - 60f, pos.headY + 20f)
            lineTo(pos.headX - 5f, pos.headY + 8f)
            close()
        }
    drawPath(beam, color = rgba(255, 251, 230, 0.05f))
}

private fun DrawScope.drawTaillight(
    pos: WheelPos,
    model: TeslaModel,
    pulse: Float,
) {
    val cyber = model == TeslaModel.Cybertruck
    val strip =
        if (cyber) {
            Path().apply {
                moveTo(pos.tailX, pos.tailY - 8f)
                lineTo(pos.tailX, pos.tailY + 12f)
            }
        } else {
            Path().apply {
                moveTo(pos.tailX + 3f, pos.tailY - 2f)
                quadraticTo(pos.tailX + 5f, pos.tailY + 9f, pos.tailX + 3f, pos.tailY + 20f)
            }
        }
    drawPath(strip, color = Color(TAIL_RED).copy(alpha = pulse), style = Stroke(width = if (cyber) 4f else 3f, cap = StrokeCap.Round))
    val core =
        if (cyber) {
            Path().apply {
                moveTo(pos.tailX, pos.tailY - 4f)
                lineTo(pos.tailX, pos.tailY + 8f)
            }
        } else {
            Path().apply {
                moveTo(pos.tailX + 3f, pos.tailY + 2f)
                quadraticTo(pos.tailX + 4f, pos.tailY + 9f, pos.tailX + 3f, pos.tailY + 16f)
            }
        }
    drawPath(core, color = Color(TAIL_CORE).copy(alpha = 0.8f), style = Stroke(width = 1.5f, cap = StrokeCap.Round))
    drawOval(rgba(239, 68, 68, 0.08f), topLeft = Offset(pos.tailX - 5f, pos.tailY - 5f), size = Size(16f, 28f))
}

private fun DrawScope.drawDoorLine(
    model: TeslaModel,
    palette: CarVizPalette,
) {
    if (model == TeslaModel.Cybertruck) {
        drawLine(palette.detail.lineFaint, Offset(210f, 162f), Offset(380f, 162f), strokeWidth = 1f)
    } else {
        drawLine(palette.detail.line, Offset(250f, 156f), Offset(340f, 154f), strokeWidth = 1f)
    }
}

private fun DrawScope.drawBatteryBar(
    pos: WheelPos,
    fraction: Float,
    color: Color,
    palette: CarVizPalette,
) {
    drawRoundedBar(pos.batX, pos.batY, 260f, 8f, palette.battery.bg)
    drawRoundedBar(pos.batX, pos.batY, 260f * fraction, 8f, color)
}

private fun DrawScope.drawRoundedBar(
    x: Float,
    y: Float,
    w: Float,
    h: Float,
    color: Color,
) {
    if (w <= 0f) return
    drawRoundRect(color, topLeft = Offset(x, y), size = Size(w, h), cornerRadius = CornerRadius(h / 2f, h / 2f))
}

private fun DrawScope.drawChargingCable(
    pos: WheelPos,
    plugPulse: Float,
) {
    val h = pos.headX
    val v = pos.headY
    val cable =
        Path().apply {
            moveTo(h - 10f, v + 5f)
            lineTo(h - 50f, v + 5f)
            cubicTo(h - 60f, v + 5f, h - 65f, v, h - 65f, v - 10f)
            lineTo(h - 65f, v - 45f)
        }
    drawPath(cable, color = Color(CarVizColors.CHARGING), style = Stroke(width = 3f, cap = StrokeCap.Round))
    drawCircle(Color(CarVizColors.CHARGING).copy(alpha = plugPulse), radius = 6f * plugPulse, center = Offset(h - 65f, v - 50f))
    val bolt =
        Path().apply {
            moveTo(h - 67f, v - 55f)
            lineTo(h - 64f, v - 51f)
            lineTo(h - 66f, v - 51f)
            lineTo(h - 63f, v - 46f)
            lineTo(h - 66f, v - 50f)
            lineTo(h - 64f, v - 50f)
            close()
        }
    drawPath(bolt, color = Color.White.copy(alpha = 0.9f))
}

private fun DrawScope.drawLock(
    pos: WheelPos,
    locked: Boolean,
    palette: CarVizPalette,
) {
    translate(pos.lockX, pos.lockY) {
        drawRoundRect(palette.lockBg, topLeft = Offset(-10f, -8f), size = Size(20f, 16f), cornerRadius = CornerRadius(4f, 4f))
        val color = if (locked) Color(CarVizColors.GOOD) else Color(CarVizColors.WARN)
        drawRoundRect(
            color,
            topLeft = Offset(-5f, -2f),
            size = Size(10f, 8f),
            cornerRadius = CornerRadius(2f, 2f),
            style = Stroke(width = 1.2f),
        )
        val shackle =
            Path().apply {
                moveTo(-3f, -2f)
                lineTo(-3f, -5f)
                cubicTo(-3f, -9f, 3f, -9f, 3f, -5f)
                lineTo(3f, if (locked) -2f else -6f)
            }
        drawPath(shackle, color = color, style = Stroke(width = 1.2f))
        drawCircle(color, radius = 1f, center = Offset(0f, 2f))
    }
}

private fun DrawScope.drawClimateWaves(
    pos: WheelPos,
    palette: CarVizPalette,
    wave: Float,
) {
    translate(pos.lockX - 5f, pos.lockY + 18f) {
        for (i in 0..2) {
            val phase = frac(wave - i * 0.15f)
            val dy = -8f * phase
            val baseX = -15f + i * 15f
            val p =
                Path().apply {
                    moveTo(baseX, dy)
                    cubicTo(baseX + 3f, dy - 4f, baseX + 7f, dy - 4f, baseX + 10f, dy)
                }
            drawPath(p, color = palette.climate.copy(alpha = triangle(phase) * 0.6f), style = Stroke(width = 1.2f))
        }
    }
}

private fun DrawScope.drawSentryRings(
    palette: CarVizPalette,
    angle1: Float,
    angle2: Float,
) {
    val center = Offset(AMBIENT_CX, AMBIENT_CY)
    rotate(angle1, pivot = center) {
        drawCircle(
            palette.sentry.ring1,
            radius = 90f,
            center = center,
            style = Stroke(width = 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 4f))),
        )
    }
    rotate(angle2, pivot = center) {
        drawCircle(
            palette.sentry.ring2,
            radius = 95f,
            center = center,
            style = Stroke(width = 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f))),
        )
    }
}

private fun DrawScope.drawSpeedLines(
    palette: CarVizPalette,
    wave: Float,
) {
    for (i in 0..3) {
        val phase = frac(wave - i * 0.25f)
        val x1 = 530f + i * 8f + phase * 30f
        val y = 160f + i * 12f
        drawLine(
            palette.speedLine.copy(alpha = triangle(phase) * 0.6f),
            Offset(x1, y),
            Offset(x1 + 30f, y),
            strokeWidth = 1.5f,
            cap = StrokeCap.Round,
        )
    }
}

private fun frac(v: Float): Float = ((v % 1f) + 1f) % 1f

private fun triangle(phase: Float): Float = 1f - abs(phase * 2f - 1f)

// ── Previews — one per rendered state (idle / driving / charging / armed / light / cybertruck / empty / mini) ──

private fun previewStrings(): CarVizStrings =
    CarVizStrings(
        charging = "Charging",
        notCharging = "Not Charging",
        locked = "Locked",
        unlocked = "Unlocked",
        climate = "Climate",
        sentry = "Sentry",
    )

@Suppress("LongParameterList")
private fun demoState(
    battery: Int = 72,
    charging: Boolean = false,
    locked: Boolean = true,
    climate: Boolean = false,
    sentry: Boolean = false,
    speed: Double = 0.0,
): TeslaCarVizState = TeslaCarVizState(battery, charging, locked, climate, sentry, speed)

@Composable
private fun CarVizPreviewHost(
    state: TeslaCarVizState?,
    model: TeslaModel,
    dark: Boolean,
) {
    TeslaSyncTheme(darkTheme = dark, dynamicColor = false) {
        TeslaCarVizContent(
            state = state,
            model = model,
            size = TeslaCarVizSize.Md,
            palette = carVizPalette(!dark),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Idle · Model 3 · dark", showBackground = true)
@Composable
private fun TeslaCarVizIdlePreview() {
    CarVizPreviewHost(state = demoState(battery = 72, locked = true), model = TeslaModel.Model3, dark = true)
}

@Preview(name = "Driving · Model Y · dark", showBackground = true)
@Composable
private fun TeslaCarVizDrivingPreview() {
    CarVizPreviewHost(state = demoState(battery = 48, locked = true, speed = 65.0), model = TeslaModel.ModelY, dark = true)
}

@Preview(name = "Charging · Model S · dark", showBackground = true)
@Composable
private fun TeslaCarVizChargingPreview() {
    CarVizPreviewHost(
        state = demoState(battery = 18, charging = true, locked = true, climate = true),
        model = TeslaModel.ModelS,
        dark = true,
    )
}

@Preview(name = "Armed · Model X · dark", showBackground = true)
@Composable
private fun TeslaCarVizArmedPreview() {
    CarVizPreviewHost(
        state = demoState(battery = 90, locked = false, climate = true, sentry = true),
        model = TeslaModel.ModelX,
        dark = true,
    )
}

@Preview(name = "Idle · Model 3 · light", showBackground = true)
@Composable
private fun TeslaCarVizLightPreview() {
    CarVizPreviewHost(state = demoState(battery = 55, locked = true), model = TeslaModel.Model3, dark = false)
}

@Preview(name = "Driving · Cybertruck · dark", showBackground = true)
@Composable
private fun TeslaCarVizCybertruckPreview() {
    CarVizPreviewHost(
        state = demoState(battery = 33, locked = false, speed = 40.0),
        model = TeslaModel.Cybertruck,
        dark = true,
    )
}

@Preview(name = "Empty · null state · dark", showBackground = true)
@Composable
private fun TeslaCarVizEmptyPreview() {
    CarVizPreviewHost(state = null, model = TeslaModel.Model3, dark = true)
}

@Preview(name = "Mini · charging · dark", showBackground = true)
@Composable
private fun TeslaCarMiniPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        TeslaCarMini(batteryLevel = 64, isCharging = true, model = TeslaModel.Model3)
    }
}
