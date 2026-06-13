// Pure, framework-free model + projection + geometry + diagnostics for the TeslaCarViz shared surface — the
// native analogue of everything web/src/components/data-display/TeslaCarViz.tsx derives before drawing its SVG.
// No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin Canvas render layer over these pure functions
// (the accepted feed-less presentational contract the sibling Speed / AnimatedNumber surfaces use).
//
// The web source is a PURELY PRESENTATIONAL vehicle illustration, not a data-fetching view. It accepts the live
// vehicle status as props (batteryLevel, isCharging, isLocked, isClimateOn, sentryMode, speed) plus a model + size,
// reads the active light/dark theme through `useTheme`/`useSvgPalette`, and renders a per-model car drawing with a
// battery bar, charge cable, lock glyph, climate waves, sentry rings, speed lines and a status row. Because it is
// handed finished props (no async cache-then-network feed), there is no loading / error / stale / offline lifecycle
// to model; inventing one would fabricate behaviour the web spec does not have, exactly as the accepted Speed /
// AnimatedNumber ports document. The surface's real, reproduced states are therefore the visual branches the web
// draws: idle vs driving (speed > 0), charging, locked vs unlocked, climate on, sentry mode, the three battery
// colour tiers, the five model bodies, the three sizes, light vs dark theme, and a defensive empty (null state)
// neutral silhouette. This file owns the parity logic: the model-key parser, the battery / boolean colour tiers,
// the driving predicate, the per-model aspect ratio, the battery fill fraction, the status-dot set, the ambient-glow
// selection, the screen-reader summary, and the per-model SVG geometry (wheel anchors + body paths) reused verbatim.
//
// The web renders its status labels as hardcoded English literals ('Charging' / 'Not Charging' / 'Locked' /
// 'Unlocked' / 'Climate' / 'Sentry'); native code may not ship English literals, so each resolves through the
// P1/S10 catalog at the render boundary (`common.*` keys) and is threaded in as [CarVizStrings] so this projection
// stays pure and locale-stable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/TeslaCarViz — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.teslacarviz

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the TeslaCarViz surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`TeslaCarViz`).
 */
object TeslaCarVizRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "teslaCarViz"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "TeslaCarViz"
}

/**
 * The five Tesla bodies the surface can draw — the native port of the web `TeslaModel` union
 * ('model3' | 'models' | 'modely' | 'modelx' | 'cybertruck'). [key] is the web string key, kept so a host that
 * already holds the web-style key can round-trip it.
 */
enum class TeslaModel(
    val key: String,
) {
    Model3("model3"),
    ModelS("models"),
    ModelY("modely"),
    ModelX("modelx"),
    Cybertruck("cybertruck"),
}

/**
 * Parse a vehicle model string like "Model 3 P", "Model Y", "Cybertruck" into a [TeslaModel] — a 1:1 port of the
 * web `parseModelKey`, including its match order (cybertruck → X → Y → S → default 3) and its substring aliases
 * (`ct` / `mx` / `my` / `ms`). A null or unrecognised string falls back to [TeslaModel.Model3], the web default.
 */
fun parseModelKey(modelStr: String?): TeslaModel {
    if (modelStr.isNullOrEmpty()) return TeslaModel.Model3
    val s = modelStr.lowercase().replace(WHITESPACE, "")
    return when {
        s.contains("cybertruck") || s.contains("ct") -> TeslaModel.Cybertruck
        s.contains("modelx") || s.contains("mx") -> TeslaModel.ModelX
        s.contains("modely") || s.contains("my") -> TeslaModel.ModelY
        s.contains("models") || s.contains("ms") -> TeslaModel.ModelS
        else -> TeslaModel.Model3
    }
}

private val WHITESPACE = Regex("\\s+")

/**
 * The three render sizes — the native port of the web `size` prop ('sm' | 'md' | 'lg'). [widthDp] is the rendered
 * width in dp (the web `sizeMap` px widths 180 / 280 / 380); the height is derived from the per-model aspect.
 */
enum class TeslaCarVizSize(
    val widthDp: Int,
) {
    Sm(SIZE_SM),
    Md(SIZE_MD),
    Lg(SIZE_LG),
}

private const val SIZE_SM = 180
private const val SIZE_MD = 280
private const val SIZE_LG = 380

/**
 * The live vehicle status the surface visualises — the native port of the web `TeslaCarViz` value props. A `null`
 * instance handed to the composable selects the defensive empty (neutral silhouette) state; a present instance
 * drives every visual branch.
 *
 * @property batteryLevel state of charge 0..100 (web `batteryLevel`); drives the bar width, colour tier and label.
 * @property isCharging whether a charge session is active (web `isCharging`); shows the charge cable + status dot.
 * @property isLocked whether the vehicle is locked (web `isLocked`); selects the lock glyph + status dot colour.
 * @property isClimateOn whether climate is running (web `isClimateOn`); shows the climate waves + status dot.
 * @property sentryMode whether Sentry Mode is armed (web `sentryMode`); shows the sentry rings + status dot.
 * @property speed current speed in the caller's unit (web `speed`); any value > 0 is "driving" (wheels spin, lights).
 */
data class TeslaCarVizState(
    val batteryLevel: Int,
    val isCharging: Boolean,
    val isLocked: Boolean,
    val isClimateOn: Boolean,
    val sentryMode: Boolean,
    val speed: Double,
)

/**
 * One rendered status chip below the car — the native port of the web `StatusDot`. [active] selects the lit colour
 * vs the inactive grey, [colorArgb] is the lit ARGB colour, and [label] is the already-localized text.
 */
data class CarStatusDot(
    val active: Boolean,
    val colorArgb: Long,
    val label: String,
)

/**
 * The localized status-row labels the surface folds in — the web hardcoded literals resolved through the P1/S10
 * catalog (`common.charging` / `common.notCharging` / `common.locked` / `common.unlocked` / `common.climate` /
 * `common.sentry`). Built from `stringResource` at the render boundary; tests pass a deterministic instance so the
 * projection stays pure.
 */
data class CarVizStrings(
    val charging: String,
    val notCharging: String,
    val locked: String,
    val unlocked: String,
    val climate: String,
    val sentry: String,
)

/** The ambient-glow tone behind the car — the native port of the web `palette.ambient.*` selection. */
enum class CarAmbient { Sentry, Charging, Driving, Idle }

/**
 * Theme-invariant semantic colours used by the surface, as packed ARGB longs — the web `@/lib/colors` constants the
 * SVG draws with (battery tiers, boolean lock state, the climate cyan and the sentry/charging accents). These are
 * intentionally NOT theme-derived (web: "green = good must stay green"), so they live in the pure model; the
 * theme-dependent body/glass/wheel palette is built in the composable from the active scheme.
 */
object CarVizColors {
    /** `COLOR.GOOD` (#10b981) — healthy battery, locked, charging. */
    const val GOOD: Long = 0xFF10B981

    /** `COLOR.WARN` (#f59e0b) — mid battery, unlocked. */
    const val WARN: Long = 0xFFF59E0B

    /** `COLOR.BAD` (#ef4444) — low battery. */
    const val BAD: Long = 0xFFEF4444

    /** The climate accent the web StatusDot/waves use (#00f0ff). */
    const val CLIMATE: Long = 0xFF00F0FF

    /** The sentry accent the web StatusDot/rings use (#ef4444). */
    const val SENTRY: Long = 0xFFEF4444

    /** The charging accent the web StatusDot/cable use (#10b981). */
    const val CHARGING: Long = 0xFF10B981
}

private const val BATTERY_GOOD_THRESHOLD = 60
private const val BATTERY_WARN_THRESHOLD = 25
private const val BATTERY_FULL_PERCENT = 100f

private const val ASPECT_CYBERTRUCK = 0.56f
private const val ASPECT_TALL = 0.55f
private const val ASPECT_DEFAULT = 0.52f

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's derivations:
 * the driving predicate, the battery / boolean colour tiers (`batteryColor` / `boolColor`), the per-model aspect
 * ratio, the battery fill fraction, the ambient-glow selection, the status-dot set, and the screen-reader summary.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only resolves
 * the live theme + labels and draws what these return.
 */
object TeslaCarVizProjection {
    /** Whether the vehicle is moving — the web `driving = speed > 0`; drives wheel spin, headlights and speed lines. */
    fun isDriving(state: TeslaCarVizState): Boolean = state.speed > 0.0

    /**
     * Battery colour for a state of charge — the web `batteryColor`: > 60 → [CarVizColors.GOOD], > 25 →
     * [CarVizColors.WARN], else [CarVizColors.BAD].
     */
    fun batteryColorArgb(level: Int): Long =
        when {
            level > BATTERY_GOOD_THRESHOLD -> CarVizColors.GOOD
            level > BATTERY_WARN_THRESHOLD -> CarVizColors.WARN
            else -> CarVizColors.BAD
        }

    /** Boolean on/off colour — the web `boolColor`: active → [CarVizColors.GOOD], else [CarVizColors.WARN]. */
    fun boolColorArgb(active: Boolean): Long = if (active) CarVizColors.GOOD else CarVizColors.WARN

    /**
     * The width:height aspect for a model — the web `aspect`: cybertruck 0.56, modelx/modely 0.55, else 0.52. The
     * rendered height is the size width times this factor.
     */
    fun aspect(model: TeslaModel): Float =
        when (model) {
            TeslaModel.Cybertruck -> ASPECT_CYBERTRUCK
            TeslaModel.ModelX, TeslaModel.ModelY -> ASPECT_TALL
            else -> ASPECT_DEFAULT
        }

    /** The 0..1 battery bar fill fraction — the web `(batteryLevel / 100)`, clamped so a stray value never overflows. */
    fun batteryFraction(level: Int): Float = (level.toFloat() / BATTERY_FULL_PERCENT).coerceIn(0f, 1f)

    /**
     * The ambient-glow tone — the web precedence `sentryMode ? sentry : isCharging ? charging : driving ? driving :
     * idle`. Sentry wins over charging wins over driving wins over idle.
     */
    fun ambientKind(state: TeslaCarVizState): CarAmbient =
        when {
            state.sentryMode -> CarAmbient.Sentry
            state.isCharging -> CarAmbient.Charging
            isDriving(state) -> CarAmbient.Driving
            else -> CarAmbient.Idle
        }

    /**
     * The ordered status-row chips — the native port of the web status row: a Charging dot (lit when charging) and a
     * Lock dot (colour follows lock state) are always shown; the Climate and Sentry dots appear only when active,
     * matching the web `{isClimateOn && …}` / `{sentryMode && …}` conditional render.
     */
    fun statusDots(
        state: TeslaCarVizState,
        strings: CarVizStrings,
    ): List<CarStatusDot> =
        buildList {
            add(
                CarStatusDot(
                    active = state.isCharging,
                    colorArgb = CarVizColors.CHARGING,
                    label = if (state.isCharging) strings.charging else strings.notCharging,
                ),
            )
            add(
                CarStatusDot(
                    active = state.isLocked,
                    colorArgb = boolColorArgb(state.isLocked),
                    label = if (state.isLocked) strings.locked else strings.unlocked,
                ),
            )
            if (state.isClimateOn) {
                add(CarStatusDot(active = true, colorArgb = CarVizColors.CLIMATE, label = strings.climate))
            }
            if (state.sentryMode) {
                add(CarStatusDot(active = true, colorArgb = CarVizColors.SENTRY, label = strings.sentry))
            }
        }

    /**
     * The screen-reader summary the composable exposes as the illustration's content description — a single
     * comma-joined sentence covering the battery level, charge state, lock state, and (when active) climate, sentry
     * and driving, all from the localized [strings] plus the caller-provided [batteryLabel] / [drivingLabel]. Pure,
     * so the a11y label is asserted off-device.
     */
    fun accessibleSummary(
        state: TeslaCarVizState,
        strings: CarVizStrings,
        batteryLabel: String,
        drivingLabel: String,
    ): String {
        val parts = mutableListOf<String>()
        parts += "$batteryLabel ${state.batteryLevel}%"
        parts += if (state.isCharging) strings.charging else strings.notCharging
        parts += if (state.isLocked) strings.locked else strings.unlocked
        if (state.isClimateOn) parts += strings.climate
        if (state.sentryMode) parts += strings.sentry
        if (isDriving(state)) parts += drivingLabel
        return parts.joinToString(", ")
    }
}

/**
 * Per-model wheel + feature anchor coordinates in the 560×290 viewBox — the native port of the web `WHEEL_POS`
 * record. `LongParameterList` is suppressed: this is a flat coordinate bundle (the web object literal), not a
 * behavioural constructor.
 *
 * @property fx front-wheel centre x, @property rx rear-wheel centre x, @property wy wheel centre y.
 * @property headX headlight anchor x, @property headY headlight anchor y.
 * @property tailX tail-light anchor x, @property tailY tail-light anchor y.
 * @property batX battery-bar origin x, @property batY battery-bar origin y.
 * @property lockX lock-glyph centre x, @property lockY lock-glyph centre y.
 */
@Suppress("LongParameterList")
data class WheelPos(
    val fx: Float,
    val rx: Float,
    val wy: Float,
    val headX: Float,
    val headY: Float,
    val tailX: Float,
    val tailY: Float,
    val batX: Float,
    val batY: Float,
    val lockX: Float,
    val lockY: Float,
)

/** The three SVG path strings that make up a model's body, roof glass and windshield (web `bodies[model]`). */
data class ModelBodyPaths(
    val body: String,
    val roof: String,
    val wind: String,
)

/**
 * Per-model render geometry reused verbatim from the web source so the native Canvas draws the identical shapes:
 * the wheel/feature anchors ([wheelPos]), the body/roof/windshield paths ([bodyPaths]), and the compact list
 * silhouette ([miniPath]). All coordinates are in the 560×290 (full) / 64×32 (mini) viewBox the composable scales.
 */
object CarVizGeometry {
    /** The wheel + feature anchors for [model] (web `WHEEL_POS[model]`). */
    fun wheelPos(model: TeslaModel): WheelPos = WHEEL_POS.getValue(model)

    /** The body / roof / windshield paths for [model] (web `bodies[model]`). */
    fun bodyPaths(model: TeslaModel): ModelBodyPaths = BODIES.getValue(model)

    /** The compact silhouette path for [model] (web `TeslaCarMini` `miniPaths[m]`). */
    fun miniPath(model: TeslaModel): String = MINI_PATHS.getValue(model)

    private val WHEEL_POS: Map<TeslaModel, WheelPos> =
        mapOf(
            TeslaModel.Model3 to WheelPos(160f, 432f, 210f, 112f, 180f, 488f, 178f, 158f, 172f, 296f, 108f),
            TeslaModel.ModelS to WheelPos(160f, 432f, 210f, 108f, 180f, 490f, 178f, 158f, 172f, 296f, 108f),
            TeslaModel.ModelY to WheelPos(160f, 432f, 210f, 112f, 178f, 486f, 176f, 158f, 170f, 296f, 104f),
            TeslaModel.ModelX to WheelPos(160f, 432f, 210f, 112f, 176f, 486f, 174f, 158f, 168f, 296f, 100f),
            TeslaModel.Cybertruck to WheelPos(160f, 432f, 210f, 108f, 176f, 480f, 165f, 158f, 172f, 296f, 108f),
        )

    private val BODIES: Map<TeslaModel, ModelBodyPaths> =
        mapOf(
            TeslaModel.Model3 to
                ModelBodyPaths(
                    body =
                        "M 118 210 Q 104 186 122 170 L 181 166 Q 201 148 228 132 Q 263 118 304 116 L 385 116 " +
                            "Q 416 118 444 132 Q 467 148 483 168 Q 492 180 494 194 Q 496 202 496 210 L 118 210 Z",
                    roof =
                        "M 214 144 Q 232 130 263 120 Q 296 116 337 114 L 381 114 Q 412 116 438 130 L 461 150 " +
                            "L 459 160 Q 418 164 329 164 Q 259 164 226 162 L 216 154 Z",
                    wind =
                        "M 218 148 L 238 130 Q 265 118 298 116 L 378 116 L 436 132 L 430 138 C 414 132 386 124 " +
                            "356 120 C 326 118 296 119 272 124 L 222 148 Z",
                ),
            TeslaModel.ModelS to
                ModelBodyPaths(
                    body =
                        "M 112 210 Q 96 184 116 170 L 181 166 Q 201 148 228 132 Q 263 118 303 116 L 387 116 " +
                            "Q 418 118 446 132 Q 469 148 484 168 Q 494 180 496 194 Q 498 202 498 210 L 112 210 Z",
                    roof =
                        "M 214 144 Q 232 130 263 120 Q 296 116 337 114 L 383 114 Q 414 116 440 130 L 463 150 " +
                            "L 461 160 Q 420 164 329 164 Q 259 164 226 162 L 216 154 Z",
                    wind =
                        "M 218 148 L 238 130 Q 265 118 298 116 L 380 116 L 438 132 L 432 138 C 416 132 388 124 " +
                            "358 120 C 328 118 298 119 274 124 L 222 148 Z",
                ),
            TeslaModel.ModelY to
                ModelBodyPaths(
                    body =
                        "M 118 210 Q 104 186 122 168 L 179 164 Q 199 146 226 130 Q 261 116 300 114 L 375 114 " +
                            "Q 410 116 440 130 Q 465 146 481 168 Q 490 182 492 196 Q 494 204 494 210 L 118 210 Z",
                    roof =
                        "M 210 142 Q 228 128 259 118 Q 292 114 331 112 L 372 112 Q 405 114 432 128 L 455 148 " +
                            "L 453 158 Q 414 162 319 162 Q 249 162 220 160 L 212 150 Z",
                    wind =
                        "M 214 146 L 234 128 Q 261 116 294 114 L 370 114 L 430 130 L 424 136 C 408 128 380 120 " +
                            "350 118 C 320 116 292 117 268 122 L 218 146 Z",
                ),
            TeslaModel.ModelX to
                ModelBodyPaths(
                    body =
                        "M 118 210 Q 104 186 122 168 L 179 164 Q 199 146 226 130 Q 259 116 298 112 L 375 112 " +
                            "Q 410 114 440 130 Q 463 146 479 166 Q 488 180 492 194 Q 494 202 494 210 L 118 210 Z",
                    roof =
                        "M 210 140 Q 228 126 257 118 Q 288 112 327 110 L 372 110 Q 405 112 432 126 L 455 144 " +
                            "L 453 156 Q 412 160 317 160 Q 247 160 218 158 L 212 150 Z",
                    wind =
                        "M 214 144 L 234 126 Q 259 116 290 112 L 370 112 L 430 128 L 424 134 C 408 126 380 118 " +
                            "350 116 C 320 114 290 115 268 120 L 218 144 Z",
                ),
            TeslaModel.Cybertruck to
                ModelBodyPaths(
                    body =
                        "M 104 210 L 109 200 L 121 186 L 170 166 L 220 152 L 434 152 L 468 164 L 483 182 " +
                            "L 487 200 L 488 210 L 104 210 Z",
                    roof = "M 225 156 L 259 152 L 419 152 L 439 164 L 434 178 L 234 178 L 228 168 Z",
                    wind = "M 230 160 L 262 152 L 420 152 L 436 162 L 432 170 L 240 170 L 232 164 Z",
                ),
        )

    private val MINI_PATHS: Map<TeslaModel, String> =
        mapOf(
            TeslaModel.Model3 to
                "M8 22 C8 22 9 18 13 16 L20 12 C22 11 26 9 30 8.5 C34 8 40 7.8 44 8 C48 8.2 51 9.5 53 11 " +
                "L57 14 C58.5 15 59.5 16.5 59.8 18 L60 22 L8 22 Z",
            TeslaModel.ModelS to
                "M6 22 C6 22 7 17 11 15 L17 11 C19 10 24 8 28 7.5 C33 7 40 6.8 46 7 C50 7.2 53 8.5 55 10 " +
                "L59 13 C60.5 14 61.5 15.5 61.8 17 L62 22 L6 22 Z",
            TeslaModel.ModelY to
                "M8 23 C8 23 9 17 13 14 L19 10 C21 9 25 7 29 6.5 C33 6 40 5.8 44 6 C48 6.2 51 7.5 53 9 " +
                "L57 12 C58.5 13 59.5 14.5 59.8 16 L60 23 L8 23 Z",
            TeslaModel.ModelX to
                "M7 24 C7 24 8 17 12 14 L18 9 C20 8 24 6 28 5.5 C32 5 39 4.8 44 5 C48 5.2 51 6.5 53 8 " +
                "L57 11 C58.5 12 59.5 14 59.8 16 L60 24 L7 24 Z",
            TeslaModel.Cybertruck to
                "M7 22 L7 17 L10 16 L16 12 L26 9 L34 8 L48 8 L52 8 L58 12 L60 16 L60 22 L7 22 Z",
        )
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event tagged
 * with the surface [TeslaCarVizRegistration.SLUG] — never the battery level, lock state, or any other vehicle datum
 * — so a diagnostics line can never leak a fleet figure. Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the composable calls it once per surface open.
 */
object TeslaCarVizDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to TeslaCarVizRegistration.SLUG))
    }
}
