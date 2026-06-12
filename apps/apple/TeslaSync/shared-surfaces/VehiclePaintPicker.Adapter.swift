//
//  VehiclePaintPicker.Adapter.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The Foundation-only core for the Digital-Twin paint picker — the SwiftUI parity of
//  `components/vehicles/VehiclePaintPicker.tsx`. This file owns the surface identity (the diagnostics
//  slug), the i18n facade seam, the stable paint id (the native peer of the web `PaintPaletteId` from
//  `lib/vehicleColors.ts`), the picker-relevant palette value type (the native peer of `PaintPalette`,
//  carrying only what the picker reads — id, label, swatch dot — the full gradient stops belong to the
//  separate VehicleTwin surface), and the props value type (``VehiclePaintPickerInput``). No SwiftUI and
//  no `@Observable`, so every value is unit-testable in isolation (the pure projection + layout live in
//  VehiclePaintPicker.Projector.swift; the projection value types in VehiclePaintPicker.Projection.swift;
//  the default catalog + Tesla-code inference in VehiclePaintPicker.Catalog.swift — split to keep each
//  file inside the SwiftLint length budget).
//
//  Faithful-parity note: the web `<VehiclePaintPicker>` is a PURELY presentational control. It reads two
//  hooks — `useTranslation` (→ the P1/S10 facade) and `useVehiclePaint` (→ the synchronous, browser-local
//  paint-override store seam in VehiclePaintPicker.Seams.swift) — and renders a swatch row. There is no
//  fetch, no React-Query cache, and no Promise, so it has NO loading / error / stale / offline branch
//  (there is nothing to fetch, fail, age, or lose connectivity to; the override store is a synchronous
//  local-prefs seam that always has a current value, derived from the local override → the inferred Tesla
//  colour → the Pearl-White fallback). Inventing such chrome would fabricate states the source does not
//  have, so this surface reproduces only the source's REAL branches — exactly as the sibling presentational
//  surfaces ThemePicker (0228) and ThemeProvider (0229) did. The real branches: the always-present swatch
//  row (one radio per palette), the selected-vs-unselected swatch, the Auto-detected (inferred) swatch, the
//  live current-paint name, the Reset affordance shown only while a local override is active, plus the
//  native "never a blank box" empty leaf for a degenerate catalog with no palettes.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum VehiclePaintPickerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "VehiclePaintPicker"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a
/// plain closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade (`VehiclePaintPickerStrings.string`), tests pass an identity resolver.
public typealias VehiclePaintResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - PaintPaletteID (web `PaintPaletteId`)

/// The stable id used for the local override, the broadcast, and the option keys — the native peer of the
/// web `PaintPaletteId` union from `lib/vehicleColors.ts`. The raw values match the web ids verbatim so a
/// value persisted by either platform round-trips, and so ``parse(_:)`` is the native peer of the web
/// `isPaintPaletteId` type-guard (narrowing an arbitrary, possibly-stale stored string).
public enum VehiclePaintPaletteID: String, Sendable, Equatable, CaseIterable, Identifiable {
    case pearlWhite = "pearl-white"
    case midnightSilver = "midnight-silver"
    case deepBlue = "deep-blue"
    case solidBlack = "solid-black"
    case redMulticoat = "red-multicoat"

    public var id: String {
        rawValue
    }

    /// Narrows an arbitrary string (e.g. a stale stored value) into a known id, or `nil` — the native
    /// peer of the web `isPaintPaletteId`.
    public static func parse(_ raw: String?) -> VehiclePaintPaletteID? {
        guard let raw else { return nil }
        return VehiclePaintPaletteID(rawValue: raw)
    }

    /// Whether a string is a known palette id — the native peer of the web `isPaintPaletteId`.
    public static func isPaintPaletteID(_ raw: String?) -> Bool {
        parse(raw) != nil
    }
}

// MARK: - Palette (web `PaintPalette`, picker subset)

/// One paint option — the native peer of the web `PaintPalette`, carrying only the fields the PICKER
/// reads: the stable `id`, the `(labelKey, defaultLabel)` pair (so the name resolves through the P1/S10
/// facade rather than rendering a hardcoded literal, the same precedent as the ThemePicker accent labels),
/// and the opaque `swatchHex` the picker dot fills with (web `p.swatch`). The full body/lower/surface/
/// mirror gradient stops in `vehicleColors.ts` drive the VehicleTwin SVG, a separate surface, and are not
/// part of this picker's data.
public struct VehiclePaintPalette: Sendable, Equatable, Identifiable {
    public let id: VehiclePaintPaletteID
    public let nameKey: String
    public let nameFallback: String
    public let swatchHex: String

    public init(id: VehiclePaintPaletteID, nameKey: String, nameFallback: String, swatchHex: String) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.swatchHex = swatchHex
    }
}

// MARK: - VehiclePaintPickerInput (web props)

/// The component's props — the native peer of `VehiclePaintPickerProps`, minus the `className` (a web
/// styling hook with no native peer). A value type so the view, the state-holder, and the pure projection
/// agree on one shape. `vehicleID` keys the per-vehicle override slot; `exteriorColor` is the Tesla
/// `exterior_color` config code the inferred (Auto-detected) paint is derived from.
public struct VehiclePaintPickerInput: Sendable, Equatable {
    /// The vehicle whose paint override this picker edits (web `vehicleId`).
    public let vehicleID: Int
    /// The Tesla `exterior_color` code used to compute the inferred paint (web `exteriorColor`).
    public let exteriorColor: String?

    public init(vehicleID: Int, exteriorColor: String? = nil) {
        self.vehicleID = vehicleID
        self.exteriorColor = exteriorColor
    }
}
