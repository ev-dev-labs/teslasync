//
//  VehicleSelect.Adapter.swift
//  TeslaSync — P4 shared surface · 0164 · VehicleSelect (Apple)
//
//  The Foundation-only core for the canonical per-page vehicle scope picker — the SwiftUI parity of
//  `components/forms/VehicleSelect.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam (the native shape of the web `t(key, default)`), the fleet-row value type the option label is
//  derived from (``VehicleSelectVehicle`` — the web `v.display_name` / `v.vin` / `v.id`), the option value
//  type (``VehicleSelectOption`` — the web `{ value, label }`), the connectivity axis
//  (``VehicleSelectConnection``), and the pure projection the rest of the surface derives from: the verbatim
//  ports of the web option mapping (`display_name || vin || `Vehicle ${id}``), the controlled value
//  (`vehicleId != null ? String(vehicleId) : ''`), and the change parser
//  (`Number(value); isFinite && > 0 ? n : null`). No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum VehicleSelectSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "VehicleSelect"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias VehicleSelectResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - VehicleSelectVehicle (web fleet row the label fallback reads)

/// A fleet vehicle row — the minimal projection the option label needs, the native peer of the `Vehicle`
/// the web `vehicles.map(...)` reads. Carries exactly the three fields the web fallback chain consults:
/// `display_name`, `vin`, and the `id` the selection is keyed on.
public struct VehicleSelectVehicle: Sendable, Equatable, Identifiable {
    /// The vehicle's stable id (web `v.id`, the value the selection persists).
    public let id: Int
    /// The user-facing name (web `v.display_name`); `nil` / empty falls through to the `vin`.
    public let displayName: String?
    /// The VIN (web `v.vin`); the second fallback when there is no display name.
    public let vin: String?

    public init(id: Int, displayName: String? = nil, vin: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }
}

// MARK: - VehicleSelectConnection (P4 connectivity axis)

/// The orthogonal freshness axis used by the P4 leaf-state contract: `live` (fresh), `stale` (older than the
/// freshness window — auto-refreshes once), `offline` (no connectivity — keeps the cached fleet). The web
/// component has no such axis; it is the native surface's always-render connectivity chip.
public enum VehicleSelectConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - VehicleSelectOption (web `{ value, label }`)

/// One resolved dropdown option — the native peer of the web `{ value: String(v.id), label: … }`. A value
/// type so the projection, the view, and the tests all agree on one shape.
public struct VehicleSelectOption: Sendable, Equatable, Identifiable {
    /// The vehicle id this option selects (the `Identifiable` key and the parsed `value`).
    public let id: Int
    /// The control value (web `String(v.id)`) — the string the native `Picker` tags each row with.
    public let value: String
    /// The resolved, display-ready label (web `display_name || vin || `Vehicle ${id}``).
    public let label: String

    public init(id: Int, value: String, label: String) {
        self.id = id
        self.value = value
        self.label = label
    }
}

// MARK: - VehicleSelectProjection (render-ready)

/// The render-ready projection the surface's content state switches over: the resolved option list and the
/// controlled selected value (web `value={vehicleId != null ? String(vehicleId) : ''}`).
public struct VehicleSelectProjection: Sendable, Equatable {
    /// The vehicle options in fleet order (web `vehicles.map(...)`).
    public let options: [VehicleSelectOption]
    /// The controlled value of the select (web `value`), `""` when nothing is selected.
    public let selectedValue: String

    public init(options: [VehicleSelectOption], selectedValue: String) {
        self.options = options
        self.selectedValue = selectedValue
    }

    /// Whether the fleet is empty (web `vehicles.length === 0`, where the web returns `null`). The native
    /// surface renders a friendly empty state instead of a blank box.
    public var isEmpty: Bool {
        options.isEmpty
    }
}

// MARK: - VehicleSelectProjector (web option mapping + controlled value + change parser)

/// The pure option/value resolver — the verbatim port of the web component's render + `onChange` math. Every
/// function is a free, bundle-free transform so the unit tests reach it without a rendered view; the
/// localized `Vehicle {id}` fallback is injected as a closure so the core stays free of `NSLocalizedString`.
public enum VehicleSelectProjector {
    /// The option label with the web fallback chain `display_name || vin || `Vehicle ${id}`` — an empty
    /// string is falsy in the web `||`, so a present-but-empty `display_name` correctly falls through to the
    /// `vin`, then to the localized `Vehicle {id}` produced by `fallbackName`.
    public static func label(
        displayName: String?,
        vin: String?,
        id: Int,
        fallbackName: (Int) -> String
    ) -> String {
        if let displayName, !displayName.isEmpty { return displayName }
        if let vin, !vin.isEmpty { return vin }
        return fallbackName(id)
    }

    /// One resolved option for a fleet row (web `{ value: String(v.id), label: … }`).
    public static func option(for vehicle: VehicleSelectVehicle, fallbackName: (Int) -> String) -> VehicleSelectOption {
        VehicleSelectOption(
            id: vehicle.id,
            value: String(vehicle.id),
            label: label(displayName: vehicle.displayName, vin: vehicle.vin, id: vehicle.id, fallbackName: fallbackName)
        )
    }

    /// The full option list in fleet order (web `vehicles.map(...)`).
    public static func options(
        from vehicles: [VehicleSelectVehicle],
        fallbackName: (Int) -> String
    ) -> [VehicleSelectOption] {
        vehicles.map { option(for: $0, fallbackName: fallbackName) }
    }

    /// The controlled select value (web `value={vehicleId != null ? String(vehicleId) : ''}`).
    public static func selectedValue(for selectedId: Int?) -> String {
        selectedId.map(String.init) ?? ""
    }

    /// The committed id for a chosen control value — the verbatim port of the web `onChange` body
    /// `const next = Number(value); Number.isFinite(next) && next > 0 ? next : null`. A blank, non-numeric,
    /// zero, or negative value resolves to `nil` (clear the selection); an overflowing magnitude is rejected
    /// rather than trapped.
    public static func parseSelection(_ value: String) -> Int? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let next = Double(trimmed), next.isFinite, next > 0, next <= Double(Int.max) else { return nil }
        return Int(next)
    }

    /// The full render-ready projection from the bound fleet + the current selection.
    public static func projection(
        vehicles: [VehicleSelectVehicle],
        selectedId: Int?,
        fallbackName: (Int) -> String
    ) -> VehicleSelectProjection {
        VehicleSelectProjection(
            options: options(from: vehicles, fallbackName: fallbackName),
            selectedValue: selectedValue(for: selectedId)
        )
    }
}
