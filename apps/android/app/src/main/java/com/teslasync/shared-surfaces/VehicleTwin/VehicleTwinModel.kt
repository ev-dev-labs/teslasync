// Pure, framework-free model + projection + geometry + diagnostics for the VehicleTwin shared surface — the
// native analogue of everything web/src/components/vehicles/VehicleTwin.tsx (composed with
// web/src/lib/vehicleColors.ts, web/src/lib/vehicleState.ts and web/src/hooks/useVehiclePaint.ts) derives before
// it draws its layered SVG. No Compose, no Android framework, no HTTP: every declaration here is exercised
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin Canvas render layer over
// these pure functions.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a layered, original SVG
// "digital twin" of a Tesla-inspired crossover seen from the side. It is PRESENTATIONAL — it is handed the live
// physical state as props (doors, four windows, frunk/trunk, charge port, charging, driving, locked, sentry,
// headlights, hazards, turn signal, driver-seat occupancy) and draws every element's open/closed/active branch,
// animating charging underglow, wheel spin, headlight/taillight pulses, flashing turn signals and a drive-in
// entrance. Its ONLY internal data dependency is `useVehiclePaint(vehicleId, exteriorColor)`: the active paint is
// resolved as override > inferred(exterior color) > Pearl-White fallback, where the override is a per-vehicle,
// device-local choice and the inferred colour comes from the vehicle's Tesla `exterior_color` (native
// `Vehicle.color`). Because that colour is read from the cache-then-network vehicle record, the surface honestly
// drives the full loading / content / empty / stale / offline / error matrix off the vehicle feed while never
// fabricating a lifecycle the web spec lacks; the physical twin state is a render parameter, exactly as it is a
// prop in the web source.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/VehicleTwin — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling VehiclePicker / TeslaCarViz surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicletwin

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/**
 * Canonical registry metadata for the VehicleTwin surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`VehicleTwin`); [ID] is the stable
 * `viewModel` key the composable binds the surface with.
 */
object VehicleTwinRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "vehicle-twin"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleTwin"
}

// ── Colour packing ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Packs an `rgba(r,g,b,a)` web colour into a 0xAARRGGBB [Long] so the framework-free model can carry the verbatim
 * web palette without depending on Compose `Color`. The render boundary unpacks it with `Color(value.toInt())`.
 */
fun argb(
    r: Int,
    g: Int,
    b: Int,
    a: Double,
): Long {
    val alpha = (a * FULL_ALPHA).roundToInt().coerceIn(0, FULL_ALPHA).toLong()
    return (alpha shl SHIFT_A) or (r.toLong() shl SHIFT_R) or (g.toLong() shl SHIFT_G) or b.toLong()
}

private const val FULL_ALPHA = 255
private const val SHIFT_A = 24
private const val SHIFT_R = 16
private const val SHIFT_G = 8

/**
 * The static (paint-agnostic) accent colours — semantic state indicators that MUST stay consistent across paints
 * (web `VehicleTwin.tsx` `C` constant). Verbatim 1:1 with the web rgba values, packed as 0xAARRGGBB.
 */
object TwinColors {
    val cladding = argb(2, 6, 23, 0.7)
    val glassStroke = argb(125, 211, 252, 0.32)
    val glassOpen = argb(3, 7, 18, 0.72)
    val glassPartial = argb(100, 200, 255, 0.05)
    val glassUnknown = argb(255, 255, 255, 0.04)
    val glassPartialStroke = argb(245, 158, 11, 0.45)
    val glassUnknownStroke = argb(255, 255, 255, 0.08)
    val doorClosed = argb(255, 255, 255, 0.13)
    val doorOpen = argb(251, 191, 36, 0.72)
    val doorUnknown = argb(255, 255, 255, 0.07)
    val headlightOff = argb(255, 255, 255, 0.14)
    val headlightOn = argb(255, 255, 220, 0.9)
    val headlightBeam = argb(255, 255, 220, 0.08)
    val headlightGlow = argb(34, 211, 238, 0.35)
    val taillightBase = argb(239, 68, 68, 0.45)
    val taillightActive = argb(239, 68, 68, 0.85)
    val amber = argb(251, 191, 36, 0.78)
    val amberFill = argb(251, 191, 36, 0.18)
    val chargeGreen = argb(34, 197, 94, 0.82)
    val chargeGreenFill = argb(34, 197, 94, 0.22)
    val chargeUnderglow = argb(34, 197, 94, 0.18)
    val lockedGreen = argb(34, 197, 94, 0.9)
    val unlockedRed = argb(239, 68, 68, 0.9)
    val sentryRed = argb(239, 68, 68, 0.8)
    val sentryGlow = argb(239, 68, 68, 0.35)
    val seatOccupied = argb(34, 211, 238, 0.32)
    val seatOccupiedStroke = argb(34, 211, 238, 0.35)
    val frunkTrunkOpen = argb(251, 191, 36, 0.2)
    val neutral = argb(255, 255, 255, 0.05)
    val shadow = argb(0, 0, 0, 0.48)
    val shadowCore = argb(0, 0, 0, 0.56)
    val seamFaint = argb(255, 255, 255, 0.06)
    val white14 = argb(255, 255, 255, 0.14)
    val white18 = argb(255, 255, 255, 0.18)
    val white10 = argb(255, 255, 255, 0.1)
    val tireInner = argb(8, 12, 22, 0.95)
    val tireSidewallStroke = argb(255, 255, 255, 0.07)
    val spoke = argb(100, 116, 139, 0.32)
    val spokeStroke = argb(15, 23, 42, 0.55)
    val hub = argb(15, 23, 42, 0.94)
    val hubStroke = argb(255, 255, 255, 0.16)
    val lug = argb(148, 163, 184, 0.55)
    val cap = argb(51, 65, 85, 0.95)
    val capStroke = argb(255, 255, 255, 0.22)
    val cabinFill = argb(2, 6, 23, 0.74)
    val cabinStroke = argb(15, 23, 42, 0.65)
    val handleDark = argb(2, 6, 23, 0.55)
    val mirrorStroke = argb(255, 255, 255, 0.22)
    val glassPillarDark = argb(2, 6, 23, 0.6)
    val headlightAccent = argb(147, 197, 253, 0.55)
    val taillightHousing = argb(127, 29, 29, 0.25)
    val taillightAccent = argb(248, 113, 113, 0.55)
    val appBackdrop = argb(2, 6, 23, 0.92)
}

// ── Paint palettes (web vehicleColors.ts) ────────────────────────────────────────────────────────────────────

/** Stable paint ids (web `PaintPaletteId`) used for the override slot, inference and option keys. */
enum class PaintPaletteId(
    val wire: String,
) {
    PearlWhite("pearl-white"),
    MidnightSilver("midnight-silver"),
    DeepBlue("deep-blue"),
    SolidBlack("solid-black"),
    RedMulticoat("red-multicoat"),
}

/**
 * A complete vehicle paint — the native port of the web `PaintPalette`. The gradient stops ([body] 4, [lower] 3,
 * [surface] 3, [mirror] 3) and the accent strings are packed 0xAARRGGBB so the model stays framework-free; the
 * render boundary builds Compose brushes from them. [isDark] biases the headlight glow brighter (web parity).
 *
 * @property labelKey the web i18n key for the picker label (kept for round-tripping; the SVG itself is anonymous).
 */
data class PaintPalette(
    val id: PaintPaletteId,
    val labelKey: String,
    val defaultLabel: String,
    val swatch: Long,
    val body: List<Long>,
    val lower: List<Long>,
    val surface: List<Long>,
    val mirror: List<Long>,
    val bodyStroke: Long,
    val bodyHighlight: Long,
    val bodyChrome: Long,
    val bodyShadow: Long,
    val isDark: Boolean,
) {
    /** The headlight "on" colour — brighter/warmer on dark paint so the front stays legible (web `buildColorMap`). */
    val headlightOn: Long get() = if (isDark) argb(255, 250, 205, 0.95) else TwinColors.headlightOn

    /** The headlight beam colour — likewise warmed on dark paint (web `buildColorMap`). */
    val headlightBeam: Long get() = if (isDark) argb(255, 250, 205, 0.12) else TwinColors.headlightBeam
}

/** The five stock Tesla paints, hand-tuned for the twin SVG — verbatim from web `PAINT_PALETTES`. */
val PAINT_PALETTES: Map<PaintPaletteId, PaintPalette> =
    mapOf(
        PaintPaletteId.PearlWhite to
            PaintPalette(
                id = PaintPaletteId.PearlWhite,
                labelKey = "paint.pearlWhite",
                defaultLabel = "Pearl White Multi-Coat",
                swatch = 0xFFE9ECF2,
                body = listOf(argb(255, 255, 255, 0.95), argb(226, 232, 240, 0.85), argb(148, 163, 184, 0.65), argb(71, 85, 105, 0.55)),
                lower = listOf(argb(71, 85, 105, 0.18), argb(15, 23, 42, 0.5), argb(0, 0, 0, 0.78)),
                surface = listOf(argb(255, 255, 255, 0.4), argb(203, 213, 225, 0.18), argb(71, 85, 105, 0.16)),
                mirror = listOf(argb(255, 255, 255, 0.78), argb(148, 163, 184, 0.6), argb(51, 65, 85, 0.7)),
                bodyStroke = argb(255, 255, 255, 0.22),
                bodyHighlight = argb(255, 255, 255, 0.28),
                bodyChrome = argb(241, 245, 249, 0.9),
                bodyShadow = argb(15, 23, 42, 0.42),
                isDark = false,
            ),
        PaintPaletteId.MidnightSilver to
            PaintPalette(
                id = PaintPaletteId.MidnightSilver,
                labelKey = "paint.midnightSilver",
                defaultLabel = "Midnight Silver Metallic",
                swatch = 0xFF5B6675,
                body = listOf(argb(203, 213, 225, 0.92), argb(125, 144, 166, 0.82), argb(63, 82, 107, 0.78), argb(15, 23, 42, 0.85)),
                lower = listOf(argb(51, 65, 85, 0.16), argb(15, 23, 42, 0.5), argb(0, 0, 0, 0.82)),
                surface = listOf(argb(226, 232, 240, 0.32), argb(100, 116, 139, 0.18), argb(15, 23, 42, 0.22)),
                mirror = listOf(argb(241, 245, 249, 0.74), argb(100, 116, 139, 0.6), argb(15, 23, 42, 0.78)),
                bodyStroke = argb(203, 213, 225, 0.2),
                bodyHighlight = argb(255, 255, 255, 0.22),
                bodyChrome = argb(226, 232, 240, 0.85),
                bodyShadow = argb(15, 23, 42, 0.5),
                isDark = false,
            ),
        PaintPaletteId.DeepBlue to
            PaintPalette(
                id = PaintPaletteId.DeepBlue,
                labelKey = "paint.deepBlue",
                defaultLabel = "Deep Blue Metallic",
                swatch = 0xFF1F3A72,
                body = listOf(argb(96, 165, 250, 0.92), argb(37, 99, 235, 0.85), argb(29, 52, 124, 0.82), argb(15, 23, 42, 0.92)),
                lower = listOf(argb(30, 41, 99, 0.18), argb(15, 23, 42, 0.55), argb(0, 0, 0, 0.86)),
                surface = listOf(argb(147, 197, 253, 0.4), argb(59, 130, 246, 0.22), argb(15, 23, 75, 0.32)),
                mirror = listOf(argb(219, 234, 254, 0.7), argb(96, 134, 200, 0.55), argb(15, 23, 42, 0.78)),
                bodyStroke = argb(147, 197, 253, 0.22),
                bodyHighlight = argb(191, 219, 254, 0.28),
                bodyChrome = argb(226, 232, 240, 0.85),
                bodyShadow = argb(11, 18, 52, 0.62),
                isDark = false,
            ),
        PaintPaletteId.SolidBlack to
            PaintPalette(
                id = PaintPaletteId.SolidBlack,
                labelKey = "paint.solidBlack",
                defaultLabel = "Solid Black",
                swatch = 0xFF0D1117,
                body = listOf(argb(120, 134, 156, 0.78), argb(48, 58, 76, 0.86), argb(20, 26, 38, 0.92), argb(0, 0, 0, 0.96)),
                lower = listOf(argb(15, 17, 22, 0.22), argb(0, 0, 0, 0.62), argb(0, 0, 0, 0.96)),
                surface = listOf(argb(203, 213, 225, 0.4), argb(71, 85, 105, 0.18), argb(0, 0, 0, 0.42)),
                mirror = listOf(argb(226, 232, 240, 0.7), argb(71, 85, 105, 0.55), argb(0, 0, 0, 0.86)),
                bodyStroke = argb(148, 163, 184, 0.18),
                bodyHighlight = argb(226, 232, 240, 0.32),
                bodyChrome = argb(241, 245, 249, 0.92),
                bodyShadow = argb(0, 0, 0, 0.62),
                isDark = true,
            ),
        PaintPaletteId.RedMulticoat to
            PaintPalette(
                id = PaintPaletteId.RedMulticoat,
                labelKey = "paint.redMulticoat",
                defaultLabel = "Red Multi-Coat",
                swatch = 0xFFA3001A,
                body = listOf(argb(248, 113, 113, 0.92), argb(220, 38, 38, 0.88), argb(127, 17, 17, 0.85), argb(40, 5, 5, 0.92)),
                lower = listOf(argb(74, 7, 7, 0.2), argb(20, 3, 3, 0.6), argb(0, 0, 0, 0.88)),
                surface = listOf(argb(254, 202, 202, 0.4), argb(220, 38, 38, 0.22), argb(74, 7, 7, 0.36)),
                mirror = listOf(argb(254, 226, 226, 0.7), argb(190, 72, 72, 0.55), argb(40, 5, 5, 0.82)),
                bodyStroke = argb(254, 202, 202, 0.22),
                bodyHighlight = argb(255, 228, 228, 0.3),
                bodyChrome = argb(241, 245, 249, 0.85),
                bodyShadow = argb(40, 5, 5, 0.62),
                isDark = false,
            ),
    )

/** All paints in display order (web `PAINT_PALETTE_LIST`). */
val PAINT_PALETTE_LIST: List<PaintPalette> =
    listOf(
        PAINT_PALETTES.getValue(PaintPaletteId.PearlWhite),
        PAINT_PALETTES.getValue(PaintPaletteId.MidnightSilver),
        PAINT_PALETTES.getValue(PaintPaletteId.DeepBlue),
        PAINT_PALETTES.getValue(PaintPaletteId.SolidBlack),
        PAINT_PALETTES.getValue(PaintPaletteId.RedMulticoat),
    )

/** High-contrast default for cars with no colour metadata — Pearl White (web `FALLBACK_PAINT`). */
val FALLBACK_PAINT: PaintPalette = PAINT_PALETTES.getValue(PaintPaletteId.PearlWhite)

/**
 * Maps a Tesla exterior-colour code to a palette — a 1:1 port of the web `inferPaintFromTesla`, including its
 * forgiving normalisation (case-insensitive, strips spaces/dashes/underscores) and the same prefix/alias rules.
 * Unknown codes fall back to [FALLBACK_PAINT].
 */
fun inferPaintFromTesla(code: String?): PaintPalette {
    if (code.isNullOrEmpty()) return FALLBACK_PAINT
    val n = code.lowercase().replace(NON_ALNUM, "")
    val match = PAINT_MATCHERS.firstOrNull { it.predicate(n) }
    return match?.let { PAINT_PALETTES.getValue(it.id) } ?: FALLBACK_PAINT
}

private class PaintMatcher(
    val id: PaintPaletteId,
    val predicate: (String) -> Boolean,
)

/** The web `inferPaintFromTesla` branch table, as data so the resolver stays a simple lookup. */
private val PAINT_MATCHERS: List<PaintMatcher> =
    listOf(
        PaintMatcher(PaintPaletteId.PearlWhite) { it.startsWith("pearl") || it == "white" },
        PaintMatcher(PaintPaletteId.MidnightSilver) { it.startsWith("midnightsilver") || it == "silver" },
        PaintMatcher(PaintPaletteId.DeepBlue) { it.startsWith("deepblue") || it == "blue" || it == "darkblue" },
        PaintMatcher(PaintPaletteId.SolidBlack) { it.startsWith("solidblack") || it == "black" || it == "obsidianblack" },
        PaintMatcher(PaintPaletteId.RedMulticoat) { it.startsWith("red") || it == "multicoatred" },
    )

private val NON_ALNUM = Regex("[\\s_-]")

/** Narrows an arbitrary persisted string to a known [PaintPaletteId] (web `isPaintPaletteId`). */
fun paintPaletteIdOrNull(value: String?): PaintPaletteId? = PaintPaletteId.entries.firstOrNull { it.wire == value }

/**
 * Resolves the active paint — the pure mirror of `useVehiclePaint`: a valid per-vehicle [overrideId] wins,
 * otherwise the paint inferred from the vehicle's [exteriorColor], otherwise [FALLBACK_PAINT].
 */
fun resolvePaint(
    overrideId: PaintPaletteId?,
    exteriorColor: String?,
): PaintPalette = overrideId?.let { PAINT_PALETTES[it] } ?: inferPaintFromTesla(exteriorColor)

// ── Twin physical state (web vehicleState.ts) ────────────────────────────────────────────────────────────────

/** A window's normalised state (web `WindowState` — `'open' | 'closed' | 'partial' | null`). */
enum class WindowState { Open, Closed, Partial, Unknown }

/** A turn-signal's normalised state (web `TurnSignalState`). */
enum class TurnSignalState { Left, Right, Both, Off, Unknown }

/** The six door/opening booleans (web `DoorStates`); `null` is "unknown", never assumed closed. */
data class DoorStates(
    val driverFront: Boolean? = null,
    val passengerFront: Boolean? = null,
    val driverRear: Boolean? = null,
    val passengerRear: Boolean? = null,
    val trunkFront: Boolean? = null,
    val trunkRear: Boolean? = null,
)

/**
 * The merged physical state the twin draws — the native port of the web `VehicleTwinState`. Every field maps to a
 * conditional render branch in the SVG; `null` booleans render the neutral "unknown" treatment.
 */
data class VehicleTwinState(
    val doors: DoorStates = DoorStates(),
    val windowFD: WindowState = WindowState.Unknown,
    val windowFP: WindowState = WindowState.Unknown,
    val windowRD: WindowState = WindowState.Unknown,
    val windowRP: WindowState = WindowState.Unknown,
    val frunkOpen: Boolean? = null,
    val trunkOpen: Boolean? = null,
    val chargePortOpen: Boolean? = null,
    val isCharging: Boolean = false,
    val isDriving: Boolean = false,
    val locked: Boolean? = null,
    val sentryMode: Boolean? = null,
    val headlights: Boolean? = null,
    val hazards: Boolean? = null,
    val turnSignal: TurnSignalState = TurnSignalState.Unknown,
    val driverSeatOccupied: Boolean? = null,
)

/** The neutral, all-unknown physical state (web `EMPTY_TWIN_STATE`) — the surface still renders the silhouette. */
val EMPTY_TWIN_STATE: VehicleTwinState = VehicleTwinState()

/** True when any flashing element should blink (web `hazards === true || turnSignal left/right/both`). */
fun frontFlashing(state: VehicleTwinState): Boolean =
    state.hazards == true || state.turnSignal == TurnSignalState.Left || state.turnSignal == TurnSignalState.Both

/** Rear flashing predicate (web `TaillightGlows` — `hazards || right || both`). */
fun rearFlashing(state: VehicleTwinState): Boolean =
    state.hazards == true || state.turnSignal == TurnSignalState.Right || state.turnSignal == TurnSignalState.Both

/** Whether any passenger-side window is open/partial (web `SideWindows` `passengerAlert`). */
fun passengerWindowAlert(state: VehicleTwinState): Boolean = state.windowFP in OPEN_OR_PARTIAL || state.windowRP in OPEN_OR_PARTIAL

private val OPEN_OR_PARTIAL = setOf(WindowState.Open, WindowState.Partial)

/** Glass fill for a window state (web `windowFill`); `closed` defers to the per-twin glass gradient. */
fun windowFillArgb(state: WindowState): Long? =
    when (state) {
        WindowState.Closed -> null
        WindowState.Open -> TwinColors.glassOpen
        WindowState.Partial -> TwinColors.glassPartial
        WindowState.Unknown -> TwinColors.glassUnknown
    }

/** Glass stroke for a window state (web `windowStroke`). */
fun windowStrokeArgb(state: WindowState): Long =
    when (state) {
        WindowState.Open -> TwinColors.amber
        WindowState.Partial -> TwinColors.glassPartialStroke
        WindowState.Closed -> TwinColors.glassStroke
        WindowState.Unknown -> TwinColors.glassUnknownStroke
    }

/** Door seam stroke for an open/closed/unknown door (web `doorStroke`). */
fun doorStrokeArgb(open: Boolean?): Long =
    when (open) {
        null -> TwinColors.doorUnknown
        true -> TwinColors.doorOpen
        false -> TwinColors.doorClosed
    }

// ── Sizing + viewBox (web VehicleTwin.tsx constants) ─────────────────────────────────────────────────────────

/** Render size (web `size` — sm/md/lg, widths 300/440/560). */
enum class VehicleTwinSize(
    val widthDp: Int,
) {
    Sm(SIZE_SM),
    Md(SIZE_MD),
    Lg(SIZE_LG),
}

private const val SIZE_SM = 300
private const val SIZE_MD = 440
private const val SIZE_LG = 560

/** The SVG viewBox the geometry is authored in: `0 52 560 220` (web `VIEWBOX_*`). */
const val VIEWBOX_WIDTH = 560f
const val VIEWBOX_MIN_Y = 52f
const val VIEWBOX_HEIGHT = 220f

/** The aspect ratio (height / width) used to derive the rendered height from the width. */
const val TWIN_ASPECT_RATIO = VIEWBOX_HEIGHT / VIEWBOX_WIDTH

// ── Surface payload + projection ─────────────────────────────────────────────────────────────────────────────

/**
 * The projected surface payload: the resolved [paint] (override > inferred > fallback) plus the resolving
 * vehicle's [vehicleLabel] and whether a [hasVehicle] backed the colour. The physical twin state is a render
 * parameter (web prop), not part of this feed, so the feed's loading/empty/error lifecycle is driven purely by
 * the cache-then-network vehicle record the paint is inferred from.
 */
data class VehicleTwinData(
    val paint: PaintPalette,
    val vehicleLabel: String?,
    val hasVehicle: Boolean,
    val overridden: Boolean,
) {
    companion object {
        /** The neutral payload shown before any vehicle loads / when the fleet is empty. */
        val EMPTY: VehicleTwinData = VehicleTwinData(FALLBACK_PAINT, vehicleLabel = null, hasVehicle = false, overridden = false)
    }
}

/** The currently-active vehicle from the enrolled [vehicles] given the persisted [selectedId] (else the first). */
fun resolveSelectedVehicle(
    vehicles: List<Vehicle>,
    selectedId: Long?,
): Vehicle? =
    when {
        vehicles.isEmpty() -> null
        selectedId != null -> vehicles.firstOrNull { it.id == selectedId } ?: vehicles.first()
        else -> vehicles.first()
    }

/** The option label for a vehicle (web `display_name || vin || 'Vehicle {id}'`). */
fun vehicleTwinLabel(vehicle: Vehicle): String = vehicle.displayName.ifBlank { vehicle.vin.ifBlank { "Vehicle ${vehicle.id}" } }

/**
 * Projects the enrolled [vehicles] + persisted [selectedId] + per-vehicle [overrideId] onto the [VehicleTwinData]
 * the surface renders: the active vehicle's colour is inferred and combined with any override into the resolved
 * paint (web `useVehiclePaint`), and the vehicle label is folded in for the accessible summary.
 */
fun projectVehicleTwin(
    vehicles: List<Vehicle>,
    selectedId: Long?,
    overrideId: PaintPaletteId?,
): VehicleTwinData {
    val vehicle = resolveSelectedVehicle(vehicles, selectedId)
    return VehicleTwinData(
        paint = resolvePaint(overrideId, vehicle?.color),
        vehicleLabel = vehicle?.let(::vehicleTwinLabel),
        hasVehicle = vehicle != null,
        overridden = overrideId != null,
    )
}

/**
 * Maps a raw `GET /vehicles` [Resource] onto a typed [Resource] of [VehicleTwinData], preserving the
 * cache-then-network envelope (cached value, freshness stamp, staleness, error) so the downstream
 * [io.teslasync.android.data.UiState] projection still drives loading / content / empty / stale / offline / error
 * correctly. The persisted [selectedId] + [overrideId] are folded into every branch so the resolved paint is
 * reflected even while showing a cached / last-known list.
 */
fun projectVehicleTwinResource(
    resource: Resource<List<Vehicle>>,
    selectedId: Long?,
    overrideId: PaintPaletteId?,
): Resource<VehicleTwinData> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = resource.cached?.let { projectVehicleTwin(it, selectedId, overrideId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = projectVehicleTwin(resource.data, selectedId, overrideId),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = resource.cached?.let { projectVehicleTwin(it, selectedId, overrideId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
                error = resource.error,
            )
    }

/** Empty predicate for [VehicleTwinData]: no resolving vehicle ⇒ the friendly empty state. */
fun isVehicleTwinEmpty(data: VehicleTwinData): Boolean = !data.hasVehicle

/**
 * Classifies a `/vehicles` failure into the recovery-oriented [QueryErrorKind] the error surface renders — the
 * same fold the sibling vehicle surfaces use.
 */
fun vehicleTwinErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

// ── Accessibility summary (web role=img aria-label, expanded) ─────────────────────────────────────────────────

/**
 * The localized phrases the accessible summary is built from — supplied by the render boundary (`stringResource`)
 * so this projection stays pure and locale-stable. Each maps to a label the web hardcodes in its SVG `<title>` /
 * tooltip strings, resolved here through the P1/S10 catalog.
 */
data class VehicleTwinLabels(
    val twinTitle: String,
    val open: String,
    val closed: String,
    val partial: String,
    val unknown: String,
    val locked: String,
    val unlocked: String,
    val charging: String,
    val driving: String,
    val sentry: String,
    val headlights: String,
    val doors: String,
    val windows: String,
)

/** Three-way label for a nullable boolean (web `stateLabel`). */
fun boolLabel(
    value: Boolean?,
    trueText: String,
    falseText: String,
    unknownText: String,
): String =
    when (value) {
        true -> trueText
        false -> falseText
        null -> unknownText
    }

/** Localized label for a window state. */
fun windowLabel(
    state: WindowState,
    labels: VehicleTwinLabels,
): String =
    when (state) {
        WindowState.Open -> labels.open
        WindowState.Closed -> labels.closed
        WindowState.Partial -> labels.partial
        WindowState.Unknown -> labels.unknown
    }

/**
 * Builds the single spoken description for the whole twin (web `role="img"` `aria-label`, expanded so TalkBack
 * announces the physical state rather than a bare "digital twin"). Pure, so the a11y label is asserted off-device.
 */
fun vehicleTwinAccessibilitySummary(
    state: VehicleTwinState,
    labels: VehicleTwinLabels,
): String {
    val parts = mutableListOf(labels.twinTitle)
    parts += "${labels.doors}: ${doorsSummary(state.doors, labels)}"
    parts += "${labels.windows}: ${windowsSummary(state, labels)}"
    if (state.locked != null) parts += if (state.locked) labels.locked else labels.unlocked
    if (state.isCharging) parts += labels.charging
    if (state.isDriving) parts += labels.driving
    if (state.sentryMode == true) parts += labels.sentry
    if (state.headlights == true) parts += labels.headlights
    return parts.joinToString(". ")
}

private fun doorsSummary(
    doors: DoorStates,
    labels: VehicleTwinLabels,
): String {
    val open =
        listOf(doors.driverFront, doors.passengerFront, doors.driverRear, doors.passengerRear, doors.trunkFront, doors.trunkRear)
            .count { it == true }
    return if (open > 0) "$open ${labels.open}" else labels.closed
}

private fun windowsSummary(
    state: VehicleTwinState,
    labels: VehicleTwinLabels,
): String {
    val anyOpen =
        listOf(state.windowFD, state.windowFP, state.windowRD, state.windowRP)
            .any { it == WindowState.Open || it == WindowState.Partial }
    return if (anyOpen) labels.open else labels.closed
}

// ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────────────

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** Diagnostics event emitted when the user overrides the paint (web `setPaint`). */
const val EVENT_SET_PAINT: String = "vehicleTwin.setPaint"

/** Diagnostics event emitted on a manual refresh / retry of the vehicle feed. */
const val EVENT_REFRESH: String = "vehicleTwin.refresh"

/** Structured-log field key carrying the surface slug on every diagnostic. */
const val SURFACE_KEY: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [VehicleTwinRegistration.SLUG]
 * (P1/S11) — never a vehicle id, VIN or colour, so a diagnostics line can never leak the fleet's posture.
 */
fun recordVehicleTwinOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_KEY to VehicleTwinRegistration.SLUG))
}

// ── Geometry (verbatim web SVG path strings) ─────────────────────────────────────────────────────────────────

/**
 * The verbatim SVG `d=` path strings from the web `VehicleTwin.tsx`, reused so the native Canvas draws the exact
 * same shapes (scaled from the `0 52 560 220` viewBox via the platform `PathParser`). Grouped by the web
 * sub-component that owns each path. Coordinates are the raw SVG space; the render boundary applies the viewBox
 * transform. No behaviour lives here — only shape data.
 */
object VehicleTwinGeometry {
    // BodyShell
    const val BODY =
        "M 42 208 C 40 196 50 184 72 171 C 100 157 140 149 190 145 C 225 118 282 104 335 106 C 392 108 443 129 " +
            "493 153 C 526 157 550 173 558 191 C 563 207 552 218 532 224 C 505 232 480 231 456 228 C 452 198 429 " +
            "178 430 178 C 399 178 375 201 372 229 L 190 229 C 187 201 163 179 132 179 C 101 179 80 201 77 228 L " +
            "63 226 C 49 224 42 217 42 208 Z"
    const val BODY_CHROME_ARC =
        "M 64 174 C 100 157 139 149 190 145 C 228 120 284 108 335 109 C 391 111 438 129 492 153"
    const val LOWER_SHADOW =
        "M 70 211 C 164 216 291 216 387 213 C 468 210 523 205 556 198 L 548 214 C 488 227 391 231 278 230 C 187 " +
            "229 107 224 48 214 Z"
    const val MIRROR = "M 177 153 C 191 145 208 147 221 156 C 205 161 190 160 177 155 Z"
    const val FRONT_HANDLE = "M 107 161 L 125 154 L 144 157 L 128 166 Z"
    const val FRONT_ARCH = "M 74 228 C 79 195 103 173 132 173 C 164 173 188 198 192 228"
    const val REAR_ARCH = "M 371 229 C 376 196 400 173 430 173 C 462 173 486 199 490 228"
    const val FRUNK_SEAM = "M 62 176 C 100 156 139 148 190 145"
    const val FRUNK_OPEN = "M 62 176 C 92 146 140 134 190 145 L 181 158 C 132 153 93 161 62 184 Z"
    const val TRUNK_SEAM = "M 469 148 C 508 150 542 165 558 188"
    const val TRUNK_OPEN = "M 470 148 C 510 126 548 137 560 169 L 557 188 C 535 169 503 155 470 156 Z"

    // Body3DDetails
    const val HOOD_SURFACE = "M 64 176 C 96 158 138 149 190 145 L 205 157 C 147 157 100 165 58 188 Z"
    const val FRONT_DOOR_SURFACE = "M 205 158 L 316 155 L 307 221 L 201 218 C 199 197 200 176 205 158 Z"
    const val REAR_DOOR_SURFACE = "M 320 155 L 458 154 L 450 220 L 311 221 Z"
    const val QUARTER_SURFACE = "M 456 154 C 486 150 523 159 558 190 C 550 207 518 216 483 219 C 480 193 470 171 456 154 Z"
    const val BELTLINE = "M 58 191 C 136 180 248 178 352 181 C 447 184 520 193 556 203"
    const val ROCKER_DEPTH =
        "M 53 215 C 120 226 214 230 332 229 C 432 228 513 221 552 211 L 542 224 C 476 238 361 243 219 239 C 131 " +
            "236 75 229 44 219 Z"
    const val DOOR_CUT_FRONT = "M 205 156 L 307 155"
    const val DOOR_CUT_REAR = "M 320 154 L 456 154"
    const val DOOR_HANDLE_FRONT = "M 254 174 L 275 173"
    const val DOOR_HANDLE_REAR = "M 374 174 L 397 173"

    // BodyReflections
    const val SHOULDER_HIGHLIGHT = "M 65 185 C 140 169 246 166 356 170 C 452 174 525 184 557 198"
    const val SOFT_REFLECTION = "M 208 156 C 276 152 374 153 461 160 L 453 168 C 366 162 277 161 214 164 Z"

    // SideWindows
    const val CABIN = "M 194 148 C 230 121 276 108 331 108 C 386 109 431 126 478 151 L 448 159 L 207 159 Z"
    const val WINDOW_FD = "M 202 147 C 232 124 274 113 316 113 L 307 152 L 212 153 Z"
    const val WINDOW_RD = "M 327 113 C 382 114 424 128 469 149 L 441 153 L 318 152 Z"
    const val B_PILLAR = "M 316 114 L 318 153"
    const val ROOF_LINE = "M 212 153 L 441 153"
    const val GLASS_REFLECTION = "M 222 139 C 286 126 381 128 448 143"
    const val A_PILLAR = "M 348 116 L 334 148"
    const val PASSENGER_ALERT = "M 210 141 C 268 126 363 126 449 144"

    // HeadlightGlows
    const val HEADLIGHT_LENS = "M 52 188 C 67 181 85 179 101 183"
    const val HEADLIGHT_ACCENT = "M 56 191 C 69 185 86 183 99 186"
    const val HEADLIGHT_BEAM = "M 51 188 L 0 174 L 0 210 Z"

    // TaillightGlows
    const val TAILLIGHT = "M 527 158 C 542 162 554 171 560 183"
    const val TAILLIGHT_INNER = "M 531 167 C 543 172 553 178 559 185"
    const val TAILLIGHT_ACCENT = "M 532 161 C 543 165 554 173 559 181 C 549 177 540 172 531 169"

    // ChargingUnderglow
    const val UNDERGLOW_TRACE = "M 154 232 C 236 239 354 239 440 231"

    // ChargePortIndicator bolt
    const val CHARGE_BOLT = "M 498 153 L 492 162 L 498 162 L 495 169 L 505 158 L 499 158 Z"

    // DoorOverlay open panels
    const val DOOR_FRONT_OPEN = "M 318 154 L 232 138 L 213 217 L 307 224 Z"
    const val DOOR_REAR_OPEN = "M 444 154 L 501 140 L 514 216 L 450 224 Z"
    const val PASSENGER_FRONT_ALERT = "M 318 154 L 233 136"
    const val PASSENGER_REAR_ALERT = "M 444 154 L 501 138"
}
