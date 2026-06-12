//
//  VehicleTwin.Paint.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The vehicle-paint model — the native port of web/src/lib/vehicleColors.ts (the five stock Tesla
//  paint palettes + the forgiving `inferPaintFromTesla` matcher + `FALLBACK_PAINT`) and the
//  resolution order of web/src/hooks/useVehiclePaint.ts (per-vehicle override > Tesla-inferred >
//  fallback). The surface binds the resolved option's `exteriorColorCode` into the shared
//  `VehicleTwinView`, whose `TwinPalette.paint(for:)` turns the code into the body gradient — so the
//  override/inference drives the rendered car color exactly as the web hook does.
//
//  This file is pure value logic (Foundation + a SwiftUI `Color` swatch); the override persistence
//  itself lives behind the state-holder seam (`VehicleTwinSource`), never in the view.
//

import Foundation
import SwiftUI

// MARK: - Paint identity (web `PaintPaletteId`)

/// Stable identity for the five stock Tesla paints. The raw value is the storage / broadcast key the
/// web hook persists (web `PaintPaletteId`), so a resolved override round-trips by id.
public enum VehicleTwinPaintID: String, Sendable, Equatable, CaseIterable {
    case pearlWhite = "pearl-white"
    case midnightSilver = "midnight-silver"
    case deepBlue = "deep-blue"
    case solidBlack = "solid-black"
    case redMulticoat = "red-multicoat"
}

// MARK: - Paint option (web `PaintPalette`, adapted to the native renderer)

/// One resolved paint option — the native peer of the web `PaintPalette`. The web palette carries a
/// full set of SVG gradient stops; the native `VehicleTwinView` instead resolves its body gradient
/// from a Tesla `exterior_color` code via `TwinPalette.paint(for:)`, so this option carries the
/// canonical `exteriorColorCode` to feed it plus the localized name + picker swatch.
public struct VehicleTwinPaintOption: Sendable, Equatable, Identifiable {
    public let id: VehicleTwinPaintID
    /// i18n key for the display name (web `PaintPalette.labelKey`).
    public let labelKey: String
    /// Web English fallback for the name (web `PaintPalette.defaultLabel`).
    public let defaultLabel: String
    /// Canonical Tesla `exterior_color` code recognized by `TwinPalette.paint(for:)`.
    public let exteriorColorCode: String
    /// Opaque swatch color for a picker dot (web `PaintPalette.swatch`).
    public let swatch: Color

    public init(
        id: VehicleTwinPaintID,
        labelKey: String,
        defaultLabel: String,
        exteriorColorCode: String,
        swatch: Color
    ) {
        self.id = id
        self.labelKey = labelKey
        self.defaultLabel = defaultLabel
        self.exteriorColorCode = exteriorColorCode
        self.swatch = swatch
    }
}

// MARK: - Paint catalog + resolution (web `PAINT_PALETTES` + `useVehiclePaint`)

/// The paint catalog + the resolver. Reproduces the web `PAINT_PALETTES` table, the forgiving
/// `inferPaintFromTesla` matcher, the `FALLBACK_PAINT` (Pearl White — high contrast on the dark UI),
/// and the `useVehiclePaint` resolution order (override > inferred > fallback).
public enum VehicleTwinPaint {
    /// The five options in web display order (web `PAINT_PALETTE_LIST`).
    public static let all: [VehicleTwinPaintOption] = [
        VehicleTwinPaintOption(
            id: .pearlWhite,
            labelKey: "paint.pearlWhite",
            defaultLabel: "Pearl White Multi-Coat",
            exteriorColorCode: "PearlWhite",
            swatch: Color(red: 0.914, green: 0.925, blue: 0.949)
        ),
        VehicleTwinPaintOption(
            id: .midnightSilver,
            labelKey: "paint.midnightSilver",
            defaultLabel: "Midnight Silver Metallic",
            exteriorColorCode: "MidnightSilver",
            swatch: Color(red: 0.357, green: 0.400, blue: 0.459)
        ),
        VehicleTwinPaintOption(
            id: .deepBlue,
            labelKey: "paint.deepBlue",
            defaultLabel: "Deep Blue Metallic",
            exteriorColorCode: "DeepBlue",
            swatch: Color(red: 0.122, green: 0.227, blue: 0.447)
        ),
        VehicleTwinPaintOption(
            id: .solidBlack,
            labelKey: "paint.solidBlack",
            defaultLabel: "Solid Black",
            exteriorColorCode: "SolidBlack",
            swatch: Color(red: 0.051, green: 0.067, blue: 0.090)
        ),
        VehicleTwinPaintOption(
            id: .redMulticoat,
            labelKey: "paint.redMulticoat",
            defaultLabel: "Red Multi-Coat",
            exteriorColorCode: "RedMulticoat",
            swatch: Color(red: 0.639, green: 0.000, blue: 0.102)
        )
    ]

    /// High-contrast default for cars with no usable `exterior_color` (web `FALLBACK_PAINT`).
    public static let fallback: VehicleTwinPaintID = .pearlWhite

    /// The option for an id (total — every id has an entry).
    public static func option(for id: VehicleTwinPaintID) -> VehicleTwinPaintOption {
        all.first { $0.id == id } ?? option(for: fallback)
    }

    /// Narrows an arbitrary stored string into a known id (web `isPaintPaletteId`).
    public static func id(fromStored raw: String?) -> VehicleTwinPaintID? {
        guard let raw else { return nil }
        return VehicleTwinPaintID(rawValue: raw)
    }

    /// Maps a Tesla `exterior_color` code to a palette id (web `inferPaintFromTesla`). Case- and
    /// separator-insensitive; accepts the bare name and the `Metallic` / `MultiCoat` suffix variants
    /// Tesla emits inconsistently. Unknown / empty codes fall back to Pearl White.
    public static func inferID(from code: String?) -> VehicleTwinPaintID {
        guard let code, !code.isEmpty else { return fallback }
        let normalized = code.lowercased().filter { !" _-".contains($0) }
        if normalized.hasPrefix("pearl") || normalized == "white" { return .pearlWhite }
        if normalized.hasPrefix("midnightsilver") || normalized == "silver" { return .midnightSilver }
        if normalized.hasPrefix("deepblue") || normalized == "blue" || normalized == "darkblue" {
            return .deepBlue
        }
        if normalized.hasPrefix("solidblack") || normalized == "black" || normalized == "obsidianblack" {
            return .solidBlack
        }
        if normalized.hasPrefix("red") || normalized == "multicoatred" { return .redMulticoat }
        return fallback
    }

    /// Resolves the active paint the way `useVehiclePaint` does: a valid per-vehicle override wins,
    /// else the Tesla-inferred color, else the fallback (folded into `inferID`).
    public static func resolve(
        override: VehicleTwinPaintID?,
        exteriorColor: String?
    ) -> VehicleTwinPaintOption {
        if let override { return option(for: override) }
        return option(for: inferID(from: exteriorColor))
    }
}
