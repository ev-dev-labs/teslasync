//
//  VehiclePaintPicker.Projector.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The pure projection from the paint-store state + the catalog to the view-ready
//  ``VehiclePaintPickerProjection`` — the surface's data adapter in the "cached selection → projection"
//  sense the acceptance calls for: it takes the selection a host already holds (the active paint id, the
//  inferred id, and the overridden flag) plus the palette catalog and derives the rendered picker (no
//  fetch, no clock). It also resolves the responsive swatch-row layout (a HIG sizing decision in place of
//  the web's fixed Tailwind `h-7 w-7` / `gap` classes). Foundation-only and side-effect-free, so every
//  rule is unit-tested in isolation.
//

import Foundation

// MARK: - State snapshot (the web `useVehiclePaint` read)

/// The current paint selection — the native peer of the values the web reads from `useVehiclePaint`
/// (`paint.id`, `inferred.id`, `isOverridden`). The store seam (VehiclePaintPicker.Seams.swift) supplies
/// this; the projector turns it (+ the catalog) into the view-ready projection.
public struct VehiclePaintState: Sendable, Equatable {
    /// The active paint id — override > inferred > fallback (web `paint.id`).
    public let selectedID: VehiclePaintPaletteID
    /// What auto-detection alone produces, ignoring any override (web `inferred.id`).
    public let inferredID: VehiclePaintPaletteID
    /// Whether the user has a manual override for this vehicle (web `isOverridden`).
    public let isOverridden: Bool

    public init(selectedID: VehiclePaintPaletteID, inferredID: VehiclePaintPaletteID, isOverridden: Bool) {
        self.selectedID = selectedID
        self.inferredID = inferredID
        self.isOverridden = isOverridden
    }
}

// MARK: - Layout (HIG sizing in place of the web Tailwind classes)

/// The resolved swatch-row metrics — the native peer of the web `h-7 w-7 rounded-full` dot + `gap-2` row
/// + `gap-3` outer spacing. Kept as tokens so the row reflows / scales with Dynamic Type rather than
/// porting fixed pixel classes.
public struct VehiclePaintLayout: Sendable, Equatable {
    public let swatchDiameter: Double
    public let swatchSpacing: Double
    public let selectedScale: Double

    public init(swatchDiameter: Double, swatchSpacing: Double, selectedScale: Double) {
        self.swatchDiameter = swatchDiameter
        self.swatchSpacing = swatchSpacing
        self.selectedScale = selectedScale
    }
}

// MARK: - Projector (web render body)

/// The pure projection logic ported from the web component: the swatch row (web `PAINT_PALETTE_LIST.map`
/// with the `selected` / `isInferred` flags), the live current-paint name (web `aria-live` span), the
/// Reset gate (web `{isOverridden && …}`), and the native empty guard. Each function is a direct
/// translation of a web branch so the view stays a pure function of these and every branch is unit-tested.
public enum VehiclePaintPickerProjector {
    /// The swatch-row layout (web `h-7 w-7` dot + selected `scale-110`).
    public static func layout() -> VehiclePaintLayout {
        VehiclePaintLayout(swatchDiameter: 28, swatchSpacing: TSSpacing.sm, selectedScale: 1.1)
    }

    /// Resolves the whole picker from the catalog + the current selection — the native peer of the web
    /// component's render decision. `resolve` localizes every label (the radiogroup label, the section
    /// caption, the per-swatch names, the current-paint name, and the Reset copy) through the P1/S10
    /// facade.
    public static func resolve(
        palettes: [VehiclePaintPalette],
        state: VehiclePaintState,
        resolve: VehiclePaintResolve
    ) -> VehiclePaintPickerProjection {
        let swatches = palettes.map { swatch(for: $0, state: state, resolve: resolve) }
        return VehiclePaintPickerProjection(
            pickerLabel: resolve("paint.pickerLabel", "Vehicle paint color"),
            sectionLabel: resolve("paint.label", "Paint"),
            swatches: swatches,
            currentPaintName: currentName(palettes: palettes, state: state, resolve: resolve),
            isOverridden: state.isOverridden,
            resetLabel: resolve("paint.reset", "Reset to auto-detected"),
            isEmpty: swatches.isEmpty
        )
    }

    // MARK: Per-option derivation

    private static func swatch(
        for palette: VehiclePaintPalette,
        state: VehiclePaintState,
        resolve: VehiclePaintResolve
    ) -> VehiclePaintSwatch {
        VehiclePaintSwatch(
            paletteID: palette.id,
            displayName: resolve(palette.nameKey, palette.nameFallback),
            swatchHex: palette.swatchHex,
            isSelected: palette.id == state.selectedID,
            isInferred: palette.id == state.inferredID
        )
    }

    /// The live current-paint name (web `aria-live` span `t(paint.labelKey, paint.defaultLabel)`).
    /// Resolves the active palette's name; falls back to the selected id's raw value for a degenerate
    /// catalog that does not contain the active id.
    private static func currentName(
        palettes: [VehiclePaintPalette],
        state: VehiclePaintState,
        resolve: VehiclePaintResolve
    ) -> String {
        guard let active = palettes.first(where: { $0.id == state.selectedID }) else {
            return state.selectedID.rawValue
        }
        return resolve(active.nameKey, active.nameFallback)
    }
}
