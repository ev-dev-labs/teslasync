//
//  VehiclePaintPicker.Seams.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The dependency seam the VehiclePaintPicker view-model binds through, kept apart from the model for the
//  lint length budget. The web `<VehiclePaintPicker>` reads two hooks; one of them is injected here (the
//  other, `useTranslation`, is the P1/S10 facade in VehiclePaintPicker.Model.swift):
//    • `useVehiclePaint` → ``VehiclePaintStore`` — the synchronous, browser-local per-vehicle paint
//      override store. The web hook resolves the active paint (override > inferred > fallback), exposes
//      `isOverridden`, and applies `setPaint(id)` / `reset()`; crucially `setPaint(inferred.id)` is
//      normalized to "clear the override" so the picker stays in sync if Tesla later reports a paint. The
//      web persistence is `localStorage` keyed per-vehicle with a cross-tab `broadcast`; the native peer
//      is a synchronous store the production app backs with `UserDefaults` + an App-Group / Notification
//      republish. The view never persists prefs directly.
//  The production app wires this to the real per-vehicle paint controller; previews and tests use the
//  in-memory double below, which reproduces the SAME resolution + normalization the web hook performs.
//

import Foundation

// MARK: - Paint store seam (native `useVehiclePaint`) — P1/S8

/// The seam the model reads + mutates the paint override through — the native shape of the web
/// `useVehiclePaint`. Exposes the resolved ``VehiclePaintState`` (active id, inferred id, overridden
/// flag) and applies the two mutations. `setPaint` MUST normalize "select the inferred colour" to
/// "clear the override" (web `id === inferred.id ? null : id`). `@MainActor` because every read/write is
/// a UI interaction on the main thread.
@MainActor
public protocol VehiclePaintStore: AnyObject {
    /// The resolved selection — override > inferred > fallback (web `{ paint, inferred, isOverridden }`).
    var state: VehiclePaintState { get }
    /// Sets the override, normalizing a pick of the inferred colour to a clear (web `setPaint`).
    func setPaint(_ id: VehiclePaintPaletteID)
    /// Clears the override, reverting to the inferred colour (web `reset` / `setPaint(null)`).
    func reset()
}

// MARK: - In-memory store double (previews + tests)

/// In-memory ``VehiclePaintStore`` for previews + unit tests. Reproduces the web `useVehiclePaint`
/// resolution exactly: the active paint is the local override if set, else the colour inferred from the
/// Tesla `exterior_color` code, else Pearl White. `setPaint(inferred)` clears the override (web parity),
/// and it records every written override value so tests can assert the exact normalized writes (web
/// `writeOverride(vehicleId, normalized)`).
@MainActor
public final class InMemoryVehiclePaintStore: VehiclePaintStore {
    /// The colour inferred from the vehicle's `exterior_color` (web `inferred`).
    public let inferredID: VehiclePaintPaletteID
    /// The current local override, or `nil` when none is set (web `overrideId`).
    public private(set) var overrideID: VehiclePaintPaletteID?
    /// Every normalized override value written through ``setPaint(_:)`` / ``reset()`` (web
    /// `writeOverride`), so tests can assert the exact persistence the surface drove.
    public private(set) var writtenOverrides: [VehiclePaintPaletteID?] = []

    /// Seeds the double from a Tesla `exterior_color` code + an optional initial override. The default
    /// `nil` code infers Pearl White, matching the web fallback for cars with no colour metadata.
    public init(exteriorColor: String? = nil, override: VehiclePaintPaletteID? = nil) {
        inferredID = VehiclePaintCatalog.infer(fromTeslaCode: exteriorColor)
        overrideID = override
    }

    public var state: VehiclePaintState {
        VehiclePaintState(
            selectedID: overrideID ?? inferredID,
            inferredID: inferredID,
            isOverridden: overrideID != nil
        )
    }

    public func setPaint(_ id: VehiclePaintPaletteID) {
        // Treat "set to the inferred color" as "clear the override" (web `id === inferred.id ? null : id`).
        let normalized: VehiclePaintPaletteID? = id == inferredID ? nil : id
        overrideID = normalized
        writtenOverrides.append(normalized)
    }

    public func reset() {
        overrideID = nil
        writtenOverrides.append(nil)
    }
}
