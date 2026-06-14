// Pure, framework-free model + projection + diagnostics for the VehiclePaintPicker shared surface — the
// native analogue of web/src/components/vehicles/VehiclePaintPicker.tsx together with its data source
// web/src/hooks/useVehiclePaint.ts and the palette catalog web/src/lib/vehicleColors.ts. No Compose, no
// Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source IS (and therefore the COMPLETE behaviour this surface reproduces): a small swatch row
// that lets the user override the Digital-Twin paint colour for one vehicle. It renders a `radiogroup`
// (`aria-label` = `paint.pickerLabel`) holding a short `paint.label` caption, the five fixed Tesla paint
// swatches (each a `role="radio"` button whose `aria-checked` reflects the active paint, whose `aria-label`
// is the localized paint name, and whose `title` gains a `· {paint.detected}` suffix on the auto-detected
// swatch), a live (`aria-live="polite"`) label echoing the active paint name, and — only while an override
// is in effect — a `paint.reset` text button that reverts to the auto-detected colour. The active paint is
// `override ?? inferred`, the inferred paint is derived from the Tesla `exterior_color` code, and picking the
// inferred colour explicitly CLEARS the override so the picker stays in sync if Tesla later reports a paint.
//
// What the web source is NOT: it is not a cache-then-network feed. `useVehiclePaint` resolves the active
// paint SYNCHRONOUSLY from a browser-local per-vehicle override (localStorage) layered over the inferred
// colour, with a fixed five-entry palette that is always present. There is therefore no loading / error /
// stale / offline lifecycle and no empty palette to project — modelling those would fabricate behaviour the
// web spec does not have (the same rationale the accepted VisuallyHidden / VehicleSelect local-state ports
// document). The surface's REAL states are reproduced instead and all render with no hidden region: the
// auto-detected (un-overridden) state, the overridden state (which reveals the reset affordance), the
// per-swatch selected / unselected / auto-detected-tagged states, and the "no persistable vehicle yet"
// state (id <= 0) where the picker still renders the inferred / fallback paint exactly as the web hook does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/VehiclePaintPicker — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling VehiclePicker / VisuallyHidden
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepaintpicker

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the VehiclePaintPicker surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`VehiclePaintPicker`);
 * [ID] is the stable `viewModel` key the composable binds the surface with.
 */
object VehiclePaintPickerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "vehicle-paint-picker"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehiclePaintPicker"
}

/**
 * The five stock Tesla paint ids — the native tag for the web `PaintPaletteId` union. [wireId] is the exact
 * string the web stores in `localStorage` and broadcasts across tabs (`'pearl-white'`, …); keeping it verbatim
 * means a native override is byte-compatible with the web contract and the [paintPaletteIdOf] type-guard
 * matches the web `value in PAINT_PALETTES` check 1:1.
 */
enum class PaintPaletteId(
    val wireId: String,
) {
    PearlWhite("pearl-white"),
    MidnightSilver("midnight-silver"),
    DeepBlue("deep-blue"),
    SolidBlack("solid-black"),
    RedMulticoat("red-multicoat"),
}

/**
 * One paint option the picker renders — the projection-free subset of the web `PaintPalette` the swatch row
 * actually reads (the body / surface / mirror gradients in `vehicleColors.ts` drive the VehicleTwin SVG, not
 * this picker). [labelKey] is the P1/S10 resource name; [defaultLabel] is the English fallback the web
 * `t(key, default)` call uses; [swatchArgb] is the opaque swatch colour as a 0xAARRGGBB literal (web `swatch`
 * hex), converted to a Compose `Color` only at the render boundary so this stays framework-free.
 */
data class PaintPalette(
    val id: PaintPaletteId,
    val labelKey: String,
    val defaultLabel: String,
    val swatchArgb: Long,
)

/**
 * The five stock Tesla paints in display order — the native mirror of `PAINT_PALETTE_LIST`. Adding an entry
 * here makes it appear in the picker automatically, exactly as on the web. Swatch colours are the web
 * `swatch` hexes verbatim (pearl `#e9ecf2`, midnight `#5b6675`, deep-blue `#1f3a72`, black `#0d1117`, red
 * `#a3001a`).
 */
val PAINT_PALETTE_LIST: List<PaintPalette> =
    listOf(
        PaintPalette(
            id = PaintPaletteId.PearlWhite,
            labelKey = VehiclePaintPickerKeys.PEARL_WHITE,
            defaultLabel = VehiclePaintPickerDefaults.PEARL_WHITE,
            swatchArgb = 0xFFE9ECF2,
        ),
        PaintPalette(
            id = PaintPaletteId.MidnightSilver,
            labelKey = VehiclePaintPickerKeys.MIDNIGHT_SILVER,
            defaultLabel = VehiclePaintPickerDefaults.MIDNIGHT_SILVER,
            swatchArgb = 0xFF5B6675,
        ),
        PaintPalette(
            id = PaintPaletteId.DeepBlue,
            labelKey = VehiclePaintPickerKeys.DEEP_BLUE,
            defaultLabel = VehiclePaintPickerDefaults.DEEP_BLUE,
            swatchArgb = 0xFF1F3A72,
        ),
        PaintPalette(
            id = PaintPaletteId.SolidBlack,
            labelKey = VehiclePaintPickerKeys.SOLID_BLACK,
            defaultLabel = VehiclePaintPickerDefaults.SOLID_BLACK,
            swatchArgb = 0xFF0D1117,
        ),
        PaintPalette(
            id = PaintPaletteId.RedMulticoat,
            labelKey = VehiclePaintPickerKeys.RED_MULTICOAT,
            defaultLabel = VehiclePaintPickerDefaults.RED_MULTICOAT,
            swatchArgb = 0xFFA3001A,
        ),
    )

/** The five paints keyed by id — the native mirror of `PAINT_PALETTES`. */
val PAINT_PALETTES: Map<PaintPaletteId, PaintPalette> = PAINT_PALETTE_LIST.associateBy { it.id }

/**
 * High-contrast default for cars with no `exterior_color` metadata — Pearl White, the web `FALLBACK_PAINT`.
 * It pops on the dark TeslaSync UI rather than blending into the panel like Midnight Silver would.
 */
val FALLBACK_PAINT: PaintPalette = PAINT_PALETTES.getValue(PaintPaletteId.PearlWhite)

/** Resolves a [PaintPaletteId] for its [id] palette — total over the fixed catalog. */
fun paintOf(id: PaintPaletteId): PaintPalette = PAINT_PALETTES.getValue(id)

/**
 * Narrows an arbitrary [value] (e.g. a stale persisted override) into a known [PaintPaletteId], or `null`
 * when it matches no paint — the native mirror of the web `isPaintPaletteId` type-guard. Matched against the
 * stored [PaintPaletteId.wireId] so it accepts exactly the strings the web persisted.
 */
fun paintPaletteIdOf(value: String?): PaintPaletteId? = PaintPaletteId.entries.firstOrNull { it.wireId == value }

/** Whether [value] is a known persisted paint id — the boolean form of [paintPaletteIdOf] (web type-guard). */
fun isPaintPaletteId(value: String?): Boolean = paintPaletteIdOf(value) != null

/**
 * A single forgiving Tesla `exterior_color` → paint inference rule: the [normalized] code matches when any of
 * [prefixes] is a prefix of it or any of [exacts] equals it. Data-driven so the matcher stays simple and each
 * paint's accepted spellings live in one readable place (the native shape of the web `inferPaintFromTesla`
 * `if`-ladder).
 */
private data class PaintInferenceRule(
    val prefixes: List<String>,
    val exacts: List<String>,
    val id: PaintPaletteId,
)

/** The Tesla-code → paint rules in priority order — the verbatim native port of the web `inferPaintFromTesla`. */
private val PAINT_INFERENCE_RULES: List<PaintInferenceRule> =
    listOf(
        PaintInferenceRule(prefixes = listOf("pearl"), exacts = listOf("white"), id = PaintPaletteId.PearlWhite),
        PaintInferenceRule(prefixes = listOf("midnightsilver"), exacts = listOf("silver"), id = PaintPaletteId.MidnightSilver),
        PaintInferenceRule(prefixes = listOf("deepblue"), exacts = listOf("blue", "darkblue"), id = PaintPaletteId.DeepBlue),
        PaintInferenceRule(prefixes = listOf("solidblack"), exacts = listOf("black", "obsidianblack"), id = PaintPaletteId.SolidBlack),
        PaintInferenceRule(prefixes = listOf("red"), exacts = listOf("multicoatred"), id = PaintPaletteId.RedMulticoat),
    )

/** Whether the [normalized] Tesla code satisfies [rule] — any prefix matches or any exact equals. */
private fun matchesInferenceRule(
    normalized: String,
    rule: PaintInferenceRule,
): Boolean = rule.prefixes.any(normalized::startsWith) || normalized in rule.exacts

/**
 * Maps a Tesla `exterior_color` code (e.g. `"PearlWhite"`, `"MidnightSilverMetallic"`, `"DeepBlueMetallic"`)
 * to a paint id — the exact native port of the web `inferPaintFromTesla`. The matching is forgiving:
 * case-insensitive, ignoring spaces / dashes / underscores, accepting both the bare name and the
 * `Metallic` / `MultiCoat` suffix variants Tesla emits inconsistently across models. An unknown or missing
 * code falls back to Pearl White (web `FALLBACK_PAINT`).
 */
fun inferPaintIdFromTesla(code: String?): PaintPaletteId {
    if (code.isNullOrEmpty()) return PaintPaletteId.PearlWhite
    val normalized = code.lowercase().replace(Regex("[\\s_-]"), "")
    return PAINT_INFERENCE_RULES.firstOrNull { matchesInferenceRule(normalized, it) }?.id ?: PaintPaletteId.PearlWhite
}

/**
 * Whether [vehicleId] can persist an override — the native mirror of the web `storageKey` guard
 * (`typeof id === 'number' && Number.isFinite(id) && id > 0`). A `null`, zero or negative id is "no vehicle
 * yet": persistence is disabled but the picker still renders the inferred / fallback paint, exactly as the
 * web hook does.
 */
fun isPersistableVehicleId(vehicleId: Long?): Boolean = vehicleId != null && vehicleId > 0

/**
 * Normalises a freshly-picked [picked] override against the [inferred] paint — the native mirror of the web
 * `setPaint` rule `const normalized = id === inferred.id ? null : id`. Picking the auto-detected colour (or
 * `null`) clears the override so the picker re-syncs if Tesla later reports a different paint; any other pick
 * is kept as an explicit override.
 */
fun normalizeOverride(
    picked: PaintPaletteId?,
    inferred: PaintPaletteId,
): PaintPaletteId? = if (picked == inferred) null else picked

/**
 * One swatch the picker renders, projected framework-free so the adapter is asserted off-device. [selected]
 * reflects the active paint (web `aria-checked`), [inferred] marks the auto-detected swatch (web `title`
 * suffix). [swatchArgb] is the dot colour; [labelKey] / [defaultLabel] resolve the localized paint name.
 */
data class PaintSwatch(
    val id: PaintPaletteId,
    val labelKey: String,
    val defaultLabel: String,
    val swatchArgb: Long,
    val selected: Boolean,
    val inferred: Boolean,
)

/**
 * The projected surface payload the view renders. [swatches] is the fixed five-paint row with each entry
 * tagged [PaintSwatch.selected] / [PaintSwatch.inferred]; [activeId] / [activeLabelKey] / [activeDefaultLabel]
 * are the live (`aria-live`) active-paint label; [inferredId] is the auto-detected paint; [isOverridden] is
 * true only when the user has manually picked a colour (web `isOverridden`), which gates the reset
 * affordance. The palette is always present, so there is no empty / loading shape to model.
 */
data class VehiclePaintPickerData(
    val swatches: List<PaintSwatch>,
    val activeId: PaintPaletteId,
    val activeLabelKey: String,
    val activeDefaultLabel: String,
    val inferredId: PaintPaletteId,
    val isOverridden: Boolean,
) {
    /** The active paint palette (override > inferred), never `null` over the fixed catalog. */
    val active: PaintPalette get() = paintOf(activeId)
}

/**
 * Projects the persisted [overrideId] + the Tesla [exteriorColor] onto the [VehiclePaintPickerData] the view
 * renders — the pure mirror of everything `useVehiclePaint` derives before the component returns JSX. The
 * inferred paint is [inferPaintIdFromTesla]; the active paint is `override ?? inferred` (web `paint`); each
 * swatch is tagged selected against the active paint and inferred against the auto-detected paint; and
 * [VehiclePaintPickerData.isOverridden] is `override != null` (web `overrideId !== null`).
 */
fun projectVehiclePaintPicker(
    overrideId: PaintPaletteId?,
    exteriorColor: String?,
): VehiclePaintPickerData {
    val inferredId = inferPaintIdFromTesla(exteriorColor)
    val activeId = overrideId ?: inferredId
    val active = paintOf(activeId)
    val swatches =
        PAINT_PALETTE_LIST.map { palette ->
            PaintSwatch(
                id = palette.id,
                labelKey = palette.labelKey,
                defaultLabel = palette.defaultLabel,
                swatchArgb = palette.swatchArgb,
                selected = palette.id == activeId,
                inferred = palette.id == inferredId,
            )
        }
    return VehiclePaintPickerData(
        swatches = swatches,
        activeId = activeId,
        activeLabelKey = active.labelKey,
        activeDefaultLabel = active.defaultLabel,
        inferredId = inferredId,
        isOverridden = overrideId != null,
    )
}

/**
 * Folds a swatch's localized [label] and its [inferred] flag into the swatch's accessible description — the
 * native mirror of the web `title = isInferred ? `${label} · ${detected}` : label`. The [detectedWord] is the
 * localized `paint.detected` string supplied by the render boundary so this stays framework-free; the
 * auto-detected swatch therefore announces "{paint} · Auto-detected" to TalkBack and shows the same in its
 * tooltip, while every other swatch announces just its paint name.
 */
fun paintSwatchAccessibilityLabel(
    label: String,
    inferred: Boolean,
    detectedWord: String,
): String = if (inferred) "$label · $detectedWord" else label

/**
 * The Android string-resource names the surface resolves through the i18n facade (P1/S10). Each maps a web
 * `t(key, default)` key (dots → underscores, prefixed `translation_`) onto a `translation_*` resource that
 * already ships in `values/`, `values-ar/` and `values-he/`; each name is asserted by value in the unit test.
 */
object VehiclePaintPickerKeys {
    /** Radiogroup accessible label — web `t('paint.pickerLabel', 'Vehicle paint color')`. */
    const val PICKER_LABEL: String = "translation_paint_pickerLabel"

    /** Leading caption — web `t('paint.label', 'Paint')`. */
    const val LABEL: String = "translation_paint_label"

    /** Auto-detected suffix — web `t('paint.detected', 'Auto-detected')`. */
    const val DETECTED: String = "translation_paint_detected"

    /** Reset affordance — web `t('paint.reset', 'Reset to auto-detected')`. */
    const val RESET: String = "translation_paint_reset"

    /** Pearl White paint name — web `paint.pearlWhite`. */
    const val PEARL_WHITE: String = "translation_paint_pearlWhite"

    /** Midnight Silver paint name — web `paint.midnightSilver`. */
    const val MIDNIGHT_SILVER: String = "translation_paint_midnightSilver"

    /** Deep Blue paint name — web `paint.deepBlue`. */
    const val DEEP_BLUE: String = "translation_paint_deepBlue"

    /** Solid Black paint name — web `paint.solidBlack`. */
    const val SOLID_BLACK: String = "translation_paint_solidBlack"

    /** Red Multi-Coat paint name — web `paint.redMulticoat`. */
    const val RED_MULTICOAT: String = "translation_paint_redMulticoat"
}

/** The English source strings the web `t(key, default)` calls fall back to (off-device contract). */
object VehiclePaintPickerDefaults {
    const val PICKER_LABEL: String = "Vehicle paint color"
    const val LABEL: String = "Paint"
    const val DETECTED: String = "Auto-detected"
    const val RESET: String = "Reset to auto-detected"
    const val PEARL_WHITE: String = "Pearl White Multi-Coat"
    const val MIDNIGHT_SILVER: String = "Midnight Silver Metallic"
    const val DEEP_BLUE: String = "Deep Blue Metallic"
    const val SOLID_BLACK: String = "Solid Black"
    const val RED_MULTICOAT: String = "Red Multi-Coat"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever the user changes the paint override. */
const val EVENT_PAINT_SET: String = "vehiclePaintPicker.set"

/** The diagnostics event emitted (PII-free) whenever the user resets to the auto-detected paint. */
const val EVENT_PAINT_RESET: String = "vehiclePaintPicker.reset"

/** Structured-log field key carrying the surface slug on every diagnostic. */
const val SURFACE_KEY: String = "surface"

/** Structured-log field key carrying the chosen paint id (a non-PII cosmetic enum value). */
const val PAINT_KEY: String = "paint"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [VehiclePaintPickerRegistration.SLUG] (P1/S11) — never a vehicle id or VIN, so a diagnostics line can never
 * leak which vehicle was viewed. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * ViewModel calls it once per surface open.
 */
fun recordVehiclePaintPickerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_KEY to VehiclePaintPickerRegistration.SLUG))
}
