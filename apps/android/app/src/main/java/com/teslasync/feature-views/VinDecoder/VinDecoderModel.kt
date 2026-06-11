// Pure, framework-free model + projection for the VIN Decoder feature view — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/devtools/tools/VinDecoder.tsx) plus the lookup tables it imports
// from `../constants` (VIN_MANUFACTURERS / VIN_MODELS / VIN_DRIVE / VIN_YEAR / VIN_PLANT). No Compose,
// no Android, no HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web tool is purely client-side — it holds the typed VIN in `useState('')` and a `useMemo` returns
// `null` until the string reaches 11 characters, then uppercases it and reads five fixed positions
// (manufacturer = chars 0..2, model = char 3, drive = char 7, year = char 9, plant = char 10) against
// the constant maps, defaulting each unmatched lookup to `t('Unknown')`, and slices the serial from
// char 11 onward. This file owns exactly that derivation; the localized "Unknown" fallback is the one
// concern left to the composable (it needs the i18n catalog), so unmatched positions are modeled as
// `null` here and resolved to the localized string at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VinDecoder — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ColorConverter surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vindecoder

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object VinDecoderRegistration {
    /** Stable surface id. */
    const val ID: String = "vin-decoder"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VinDecoder"
}

/**
 * One fully decoded VIN — the native analogue of the web `useMemo`'s `{ mfr, model, drive, year, plant,
 * serial }` result. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * The five looked-up positions are `null` when the VIN character is not a known Tesla code; the render
 * layer maps `null` to the localized `Unknown` string (web `?? t('Unknown')`). [serial] is the raw
 * remainder of the VIN (web `upper.slice(11)`) and may be empty for an exactly-11-character input.
 *
 * @property mfr the manufacturing entity (chars 0..2), or `null` when unrecognized.
 * @property model the vehicle line (char 3), or `null` when unrecognized.
 * @property drive the drivetrain (char 7), or `null` when unrecognized.
 * @property year the model year (char 9), or `null` when unrecognized.
 * @property plant the assembly plant (char 10), or `null` when unrecognized.
 * @property serial the production serial (chars 11..end); may be empty.
 */
data class DecodedVin(
    val mfr: String?,
    val model: String?,
    val drive: String?,
    val year: String?,
    val plant: String?,
    val serial: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web tool's `useMemo` block.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object VinDecoderProjection {
    /** Minimum length before the web tool decodes anything (`if (vin.length < 11) return null`). */
    const val MIN_DECODE_LENGTH: Int = 11

    private const val MFR_LENGTH = 3
    private const val MODEL_INDEX = 3
    private const val DRIVE_INDEX = 7
    private const val YEAR_INDEX = 9
    private const val PLANT_INDEX = 10
    private const val SERIAL_START = 11

    /**
     * Decodes a Tesla VIN into a [DecodedVin], or `null` when the string is shorter than
     * [MIN_DECODE_LENGTH] — the native analogue of the web `useMemo` body. The input is uppercased
     * (web `vin.toUpperCase()`) before every lookup, so casing never affects the result. Each looked-up
     * position resolves to `null` when the character is not a known code (the render layer substitutes
     * the localized `Unknown`); the serial is the uppercased remainder from [SERIAL_START].
     */
    fun decode(vin: String): DecodedVin? {
        if (vin.length < MIN_DECODE_LENGTH) return null
        val upper = vin.uppercase()
        return DecodedVin(
            mfr = VinReference.MANUFACTURERS[upper.take(MFR_LENGTH)],
            model = VinReference.MODELS[upper[MODEL_INDEX].toString()],
            drive = VinReference.DRIVE[upper[DRIVE_INDEX].toString()],
            year = VinReference.YEAR[upper[YEAR_INDEX].toString()],
            plant = VinReference.PLANT[upper[PLANT_INDEX].toString()],
            serial = upper.substring(SERIAL_START),
        )
    }
}

/**
 * The static Tesla VIN lookup tables — a faithful port of the maps in
 * `web/src/features/admin/components/devtools/tools/../constants.ts` (VIN_MANUFACTURERS, VIN_MODELS,
 * VIN_DRIVE, VIN_YEAR, VIN_PLANT). These are reference data — proper nouns, drivetrain names, plant
 * cities, and model years — that the web tool renders verbatim from `constants.ts` rather than through
 * `t()`, so they are reproduced here as literal data (like the HTTP-status and endpoint tables that
 * share that source file), not routed through the i18n catalog.
 */
object VinReference {
    /** World-manufacturer identifier (VIN chars 0..2) → manufacturing entity. */
    val MANUFACTURERS: Map<String, String> =
        mapOf(
            "5YJ" to "Tesla (USA)",
            "LRW" to "Tesla (China)",
            "7SA" to "Tesla (EU/Berlin)",
            "XP7" to "Tesla (USA)",
        )

    /** Line code (VIN char 3) → Tesla model. */
    val MODELS: Map<String, String> =
        mapOf(
            "S" to "Model S",
            "3" to "Model 3",
            "X" to "Model X",
            "Y" to "Model Y",
        )

    /** Drive/restraint code (VIN char 7) → drivetrain. */
    val DRIVE: Map<String, String> =
        mapOf(
            "1" to "Single Motor RWD",
            "2" to "Dual Motor AWD",
            "3" to "Performance AWD",
            "4" to "Single Motor RWD (LFP)",
            "A" to "Dual Motor AWD",
            "B" to "Dual Motor AWD",
            "F" to "Performance AWD",
            "P" to "Performance",
            "E" to "Dual Motor",
            "N" to "Dual Motor",
        )

    /** Model-year code (VIN char 9) → calendar year. */
    val YEAR: Map<String, String> =
        mapOf(
            "H" to "2017",
            "J" to "2018",
            "K" to "2019",
            "L" to "2020",
            "M" to "2021",
            "N" to "2022",
            "P" to "2023",
            "R" to "2024",
            "S" to "2025",
            "T" to "2026",
        )

    /** Assembly-plant code (VIN char 10) → plant location. */
    val PLANT: Map<String, String> =
        mapOf(
            "F" to "Fremont, CA",
            "A" to "Austin, TX",
            "B" to "Berlin, Germany",
            "C" to "Shanghai, China",
            "G" to "Gigafactory",
            "E" to "Palo Alto, CA",
        )
}
