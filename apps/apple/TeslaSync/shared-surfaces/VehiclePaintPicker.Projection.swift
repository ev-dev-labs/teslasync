//
//  VehiclePaintPicker.Projection.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The view-ready projection value types — everything the SwiftUI body needs as a pure function of the
//  paint-store state + the catalog, with no derivation in the view. These are the resolved peers of the
//  web render output: ``VehiclePaintSwatch`` is one `<button role="radio">` in the swatch row (web
//  `PAINT_PALETTE_LIST.map`), and ``VehiclePaintPickerProjection`` bundles the whole control (the
//  radiogroup label, the section caption, the swatch row, the live current-paint name, and the Reset
//  affordance). Foundation-only + `Equatable` so the projection is diffable and unit-tested; the pure
//  derivation lives in VehiclePaintPicker.Projector.swift.
//

import Foundation

// MARK: - Swatch (web `<button role="radio">`)

/// One paint swatch — the resolved peer of a web swatch `<button>`: the palette id, the localized
/// display name (web `t(p.labelKey, p.defaultLabel)`), the opaque fill hex (web `p.swatch`), whether it
/// is the active paint (web `p.id === paint.id`), and whether it is the Auto-detected / inferred paint
/// (web `p.id === inferred.id`, which the web surfaces through the `title` tooltip). The view turns
/// `isSelected` / `isInferred` into the spoken VoiceOver value + hint through the P1/S10 facade.
public struct VehiclePaintSwatch: Sendable, Equatable, Identifiable {
    public let paletteID: VehiclePaintPaletteID
    public let displayName: String
    public let swatchHex: String
    public let isSelected: Bool
    public let isInferred: Bool

    public init(
        paletteID: VehiclePaintPaletteID,
        displayName: String,
        swatchHex: String,
        isSelected: Bool,
        isInferred: Bool
    ) {
        self.paletteID = paletteID
        self.displayName = displayName
        self.swatchHex = swatchHex
        self.isSelected = isSelected
        self.isInferred = isInferred
    }

    /// Stable identity for `ForEach` — the palette id raw value (web `key={p.id}`).
    public var id: String {
        paletteID.rawValue
    }
}

// MARK: - Projection (web render body)

/// The resolved, view-ready picker — a pure function of the paint-store state + the catalog.
/// `pickerLabel` is the radiogroup label (web `aria-label={t('paint.pickerLabel', …)}`); `sectionLabel`
/// is the uppercase caption (web `t('paint.label', 'Paint')`); `swatches` is the radio row;
/// `currentPaintName` is the live selection name (web `aria-live` span `t(paint.labelKey, …)`);
/// `isOverridden` gates the Reset affordance (web `{isOverridden && …}`) with `resetLabel` its copy
/// (web `t('paint.reset', …)`); `isEmpty` is the native "never a blank box" guard for a degenerate
/// catalog that exposes no palettes at all.
public struct VehiclePaintPickerProjection: Sendable, Equatable {
    public let pickerLabel: String
    public let sectionLabel: String
    public let swatches: [VehiclePaintSwatch]
    public let currentPaintName: String
    public let isOverridden: Bool
    public let resetLabel: String
    public let isEmpty: Bool

    public init(
        pickerLabel: String,
        sectionLabel: String,
        swatches: [VehiclePaintSwatch],
        currentPaintName: String,
        isOverridden: Bool,
        resetLabel: String,
        isEmpty: Bool
    ) {
        self.pickerLabel = pickerLabel
        self.sectionLabel = sectionLabel
        self.swatches = swatches
        self.currentPaintName = currentPaintName
        self.isOverridden = isOverridden
        self.resetLabel = resetLabel
        self.isEmpty = isEmpty
    }

    /// Whether the Reset affordance renders — only while a local override is active and there is content
    /// to reset (web `{isOverridden && <button>Reset…</button>}`).
    public var showsReset: Bool {
        isOverridden && !isEmpty
    }
}
