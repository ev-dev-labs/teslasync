//
//  VehiclePaintPicker.Catalog.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The default paint catalog + the Tesla `exterior_color` inference — the native peer of the
//  `PAINT_PALETTES` / `PAINT_PALETTE_LIST` records and the `inferPaintFromTesla` function in
//  `lib/vehicleColors.ts`. The production app injects its own catalog through the model (so a
//  server-driven palette set can extend it); previews, tests, and the default mount use this catalog.
//  The display names are carried as `(key, fallback)` pairs so they resolve through the P1/S10 facade.
//  The `swatchHex` values are the verbatim opaque picker dots from the web `swatch` fields. Inference
//  mirrors the web matcher exactly: case-insensitive, ignoring spaces / dashes / underscores, accepting
//  the bare name and the `Metallic` / `MultiCoat` suffix variants Tesla emits inconsistently; unknown
//  codes fall back to Pearl White (the high-contrast default — web `FALLBACK_PAINT`).
//

import Foundation

/// The bundled defaults the surface ships with — the native peer of the `vehicleColors.ts` records.
public enum VehiclePaintCatalog {
    /// The high-contrast default for cars with no / unknown `exterior_color` — the web `FALLBACK_PAINT`
    /// (Pearl White pops on the dark TeslaSync UI rather than blending into the panel).
    public static let fallbackID: VehiclePaintPaletteID = .pearlWhite

    /// The 5 stock Tesla paints in display order — the web `PAINT_PALETTE_LIST`. The `swatchHex` values
    /// are the verbatim web `swatch` dots.
    public static let list: [VehiclePaintPalette] = [
        VehiclePaintPalette(
            id: .pearlWhite,
            nameKey: "paint.pearlWhite",
            nameFallback: "Pearl White Multi-Coat",
            swatchHex: "#e9ecf2"
        ),
        VehiclePaintPalette(
            id: .midnightSilver,
            nameKey: "paint.midnightSilver",
            nameFallback: "Midnight Silver Metallic",
            swatchHex: "#5b6675"
        ),
        VehiclePaintPalette(
            id: .deepBlue,
            nameKey: "paint.deepBlue",
            nameFallback: "Deep Blue Metallic",
            swatchHex: "#1f3a72"
        ),
        VehiclePaintPalette(
            id: .solidBlack,
            nameKey: "paint.solidBlack",
            nameFallback: "Solid Black",
            swatchHex: "#0d1117"
        ),
        VehiclePaintPalette(
            id: .redMulticoat,
            nameKey: "paint.redMulticoat",
            nameFallback: "Red Multi-Coat",
            swatchHex: "#a3001a"
        )
    ]

    /// Maps a Tesla `exterior_color` code to a palette id — the verbatim native peer of the web
    /// `inferPaintFromTesla`. Forgiving: case-insensitive, ignores spaces / dashes / underscores, accepts
    /// the bare name and the `Metallic` / `MultiCoat` suffix variants. Unknown / empty codes fall back to
    /// ``fallbackID`` (Pearl White).
    public static func infer(fromTeslaCode code: String?) -> VehiclePaintPaletteID {
        guard let code, !code.isEmpty else { return fallbackID }
        let normalized = code.lowercased().filter { !($0 == " " || $0 == "_" || $0 == "-") }
        if normalized.hasPrefix("pearl") || normalized == "white" { return .pearlWhite }
        if normalized.hasPrefix("midnightsilver") || normalized == "silver" { return .midnightSilver }
        if normalized.hasPrefix("deepblue") || normalized == "blue" || normalized == "darkblue" {
            return .deepBlue
        }
        if normalized.hasPrefix("solidblack") || normalized == "black" || normalized == "obsidianblack" {
            return .solidBlack
        }
        if normalized.hasPrefix("red") || normalized == "multicoatred" { return .redMulticoat }
        return fallbackID
    }
}
