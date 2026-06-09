//
//  VinDecoder.Adapter.swift
//  TeslaSync — P4 feature view · 0025 · VinDecoder (Apple)
//
//  Pure (Foundation-only) VIN decode pipeline: a Tesla VIN string → its
//  manufacturer, model, drivetrain, model year, assembly plant, and serial,
//  reproducing the web source's positional lookup chain so the native surface
//  shows the same data as
//  features/admin/components/devtools/tools/VinDecoder.tsx.
//
//  Deliberately free of SwiftUI/Observation so the decode can be compiled and
//  executed on a plain host and pinned by unit tests.
//
//  Parity notes:
//    • The reference tables (WMI → manufacturer, position 4 → model, position 8
//      → drive, position 10 → model year, position 11 → plant) are ported
//      verbatim from the web `VIN_*` constants — they are vehicle reference data,
//      not localized UI copy, exactly as the web hardcodes them.
//    • The web guards `vin.length < 11` and returns no result; shorter input
//      resolves to `nil` here (the surface's no-result state).
//    • A position with no table entry resolves to `nil` for that field; the view
//      renders the localized "Unknown" the web composes via `?? t('Unknown')`.
//    • The serial is the substring from position 12 onward (web `slice(11)`),
//      present once the VIN is long enough to decode.
//

import Foundation

// MARK: - Decoded result

/// A decoded Tesla VIN. Each lookup field is `nil` when the corresponding VIN
/// position has no reference-table entry — the view renders the localized
/// "Unknown" the web composes via `?? t('Unknown')`. `serial` is always present.
public struct VinDecoded: Equatable, Sendable {
    public let manufacturer: String?
    public let model: String?
    public let drive: String?
    public let year: String?
    public let plant: String?
    public let serial: String

    public init(
        manufacturer: String?,
        model: String?,
        drive: String?,
        year: String?,
        plant: String?,
        serial: String
    ) {
        self.manufacturer = manufacturer
        self.model = model
        self.drive = drive
        self.year = year
        self.plant = plant
        self.serial = serial
    }

    /// The decoded values as ordered label/value rows, mirroring the web
    /// `Object.entries(decoded)` iteration order (mfr, model, drive, year, plant,
    /// serial). Each row carries the web `devtools.utils.vin_<key>` label key.
    public var fields: [VinField] {
        [
            VinField(key: "mfr", value: manufacturer),
            VinField(key: "model", value: model),
            VinField(key: "drive", value: drive),
            VinField(key: "year", value: year),
            VinField(key: "plant", value: plant),
            VinField(key: "serial", value: serial)
        ]
    }
}

/// One decoded VIN row: the web `devtools.utils.vin_<key>` label and its value.
/// A `nil` value means the position had no reference-table match and the view
/// shows the localized "Unknown".
public struct VinField: Identifiable, Equatable, Sendable {
    /// The web entry key (`mfr`, `model`, `drive`, `year`, `plant`, `serial`).
    public let key: String
    /// The decoded value, or `nil` when the position has no table entry.
    public let value: String?

    public init(key: String, value: String?) {
        self.key = key
        self.value = value
    }

    public var id: String {
        key
    }

    /// The web i18n key for this row's label (`devtools.utils.vin_<key>`).
    public var labelKey: String {
        "devtools.utils.vin_\(key)"
    }
}

// MARK: - Adapter

/// Pure decoder: a raw VIN string → `VinDecoded?`. The exact port of the web
/// tool's synchronous `useMemo`: input shorter than ``minimumLength`` resolves to
/// `nil` (no result), otherwise the positional lookups are resolved against
/// ``VinReference``.
public enum VinDecoderAdapter {
    /// The shortest input the web decodes (`vin.length < 11` returns no result).
    public static let minimumLength = 11

    /// Decodes a VIN into its component fields, reproducing the web pipeline.
    ///
    /// - Input shorter than ``minimumLength`` resolves to `nil` (no result).
    /// - Otherwise the VIN is upper-cased and read positionally: the world
    ///   manufacturer identifier (first three characters), model (4th), drive
    ///   (8th), model year (10th), plant (11th), and serial (12th onward).
    public static func decode(_ raw: String) -> VinDecoded? {
        guard raw.count >= minimumLength else { return nil }
        let characters = Array(raw.uppercased())
        guard characters.count >= minimumLength else { return nil }

        return VinDecoded(
            manufacturer: VinReference.manufacturers[String(characters[0 ..< 3])],
            model: VinReference.models[String(characters[3])],
            drive: VinReference.drive[String(characters[7])],
            year: VinReference.year[String(characters[9])],
            plant: VinReference.plant[String(characters[10])],
            serial: String(characters[11...])
        )
    }
}

// MARK: - Reference tables (web `VIN_*` constants)

/// Tesla VIN reference tables, ported verbatim from the web devtools
/// `constants.ts`. These are vehicle reference data (not localized UI copy), so
/// they live as Swift constants exactly as the web hardcodes them.
public enum VinReference {
    /// World manufacturer identifier (VIN positions 1–3) → manufacturer + region.
    public static let manufacturers: [String: String] = [
        "5YJ": "Tesla (USA)",
        "LRW": "Tesla (China)",
        "7SA": "Tesla (EU/Berlin)",
        "XP7": "Tesla (USA)"
    ]

    /// VIN position 4 → model line.
    public static let models: [String: String] = [
        "S": "Model S",
        "3": "Model 3",
        "X": "Model X",
        "Y": "Model Y"
    ]

    /// VIN position 8 → drivetrain.
    public static let drive: [String: String] = [
        "1": "Single Motor RWD",
        "2": "Dual Motor AWD",
        "3": "Performance AWD",
        "4": "Single Motor RWD (LFP)",
        "A": "Dual Motor AWD",
        "B": "Dual Motor AWD",
        "F": "Performance AWD",
        "P": "Performance",
        "E": "Dual Motor",
        "N": "Dual Motor"
    ]

    /// VIN position 10 → model year.
    public static let year: [String: String] = [
        "H": "2017",
        "J": "2018",
        "K": "2019",
        "L": "2020",
        "M": "2021",
        "N": "2022",
        "P": "2023",
        "R": "2024",
        "S": "2025",
        "T": "2026"
    ]

    /// VIN position 11 → assembly plant.
    public static let plant: [String: String] = [
        "F": "Fremont, CA",
        "A": "Austin, TX",
        "B": "Berlin, Germany",
        "C": "Shanghai, China",
        "G": "Gigafactory",
        "E": "Palo Alto, CA"
    ]
}
