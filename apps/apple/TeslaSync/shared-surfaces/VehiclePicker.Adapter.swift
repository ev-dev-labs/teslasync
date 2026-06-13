//
//  VehiclePicker.Adapter.swift
//  TeslaSync — P4 shared surface · 0183 · VehiclePicker (Apple)
//
//  The testable, dependency-light core for the persistent app-wide vehicle selector — the SwiftUI parity of
//  `components/layout/VehiclePicker.tsx`. Everything here is pure (Foundation only): the surface identity (the
//  diagnostics slug), the i18n facade seam (the native shape of the web `t(key, default)`), the fleet-row
//  value type the labels derive from (``VehiclePickerVehicle`` — the web `display_name` / `vin` / `id`), the
//  pin row (``VehiclePickerPin`` — the web `usePinned('vehicle')` `item_id` + `position`), the connectivity
//  axis (``VehiclePickerConnection``), the resolved option (``VehiclePickerOption``), and the pure projection
//  the rest of the surface derives from: the verbatim ports of the web pin-aware ordering (pinned vehicles
//  float to the top in pin-position order, the rest follow in original fleet order), the falsy-aware label
//  chain (`display_name || vin || `Vehicle ${id}``), the pin flag (the web `📌` prefix), and the single-vs-
//  picker decision (`vehicles.length <= 1` → hidden in web; here a static chip / empty leaf so it never
//  blanks). No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum VehiclePickerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "VehiclePicker"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias VehiclePickerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - VehiclePickerVehicle (web fleet row the labels read)

/// A fleet vehicle row — the minimal projection the labels need, the native peer of the `Vehicle` the web
/// `vehicles.map(...)` reads. Carries the three fields the web label chain consults: `display_name`, `vin`,
/// and the `id` the selection is keyed on.
public struct VehiclePickerVehicle: Sendable, Equatable, Identifiable {
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

// MARK: - VehiclePickerPin (web `usePinned('vehicle')` row)

/// One pinned-item row — the native peer of the web `PinnedItem` returned by `usePinned('vehicle')`. Only the
/// two fields the picker's ordering consults are carried: the `item_id` (a string, compared against the
/// stringified vehicle id, mirroring the web `String(p.item_id) === String(v.id)`) and the `position` that
/// orders the pinned rows.
public struct VehiclePickerPin: Sendable, Equatable {
    /// The pinned item's id as a string (web `p.item_id`).
    public let itemId: String
    /// The pin's order position (web `p.position`), ascending.
    public let position: Int

    public init(itemId: String, position: Int) {
        self.itemId = itemId
        self.position = position
    }
}

// MARK: - VehiclePickerConnection (P4 connectivity axis)

/// The orthogonal freshness axis used by the P4 leaf-state contract: `live` (fresh), `stale` (older than the
/// freshness window — auto-refreshes once), `offline` (no connectivity — keeps the cached fleet). The web
/// component has no such axis; it is the native surface's always-render connectivity chip.
public enum VehiclePickerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - VehiclePickerOption (web `<Select>` option / listbox row)

/// One resolved picker row — the native peer of the web `sorted.map((v) => ({ value, label }))` option. A
/// value type so the projection, the menu, and the tests all agree on one shape.
public struct VehiclePickerOption: Sendable, Equatable, Identifiable {
    /// The vehicle id this row selects (the `Identifiable` key, web `String(v.id)` → `Number(value)`).
    public let id: Int
    /// The resolved row label (web `v.display_name || v.vin || `Vehicle ${v.id}``), WITHOUT the pin glyph —
    /// the glyph is carried separately as ``isPinned`` so the native row renders an idiomatic pin symbol.
    public let label: String
    /// Whether this vehicle is pinned (web `pins.some(...)` → the `📌` label prefix).
    public let isPinned: Bool
    /// Whether this row is the current selection (web `value === String(vehicleId)`).
    public let isSelected: Bool

    public init(id: Int, label: String, isPinned: Bool, isSelected: Bool) {
        self.id = id
        self.label = label
        self.isPinned = isPinned
        self.isSelected = isSelected
    }
}

// MARK: - VehiclePickerProjection (render-ready)

/// The render-ready projection the surface's content state composes from — the sorted+labeled rows (web
/// `options`), the current selection's id + collapsed label + pin flag (web `<Select value>`), and the
/// single-vs-picker decision (web `vehicles.length <= 1` hides; here it drives the static-chip vs picker
/// split). A pure function of the bound fleet + pins + selection (web render output).
public struct VehiclePickerProjection: Sendable, Equatable {
    /// The picker rows in pin-aware order (web `sorted.map(...)`).
    public let options: [VehiclePickerOption]
    /// The currently-selected id (web `vehicleId`), `nil` when nothing is selected.
    public let selectedId: Int?
    /// The collapsed selector label (web `<Select>` value's option label), or the placeholder when nothing
    /// matches.
    public let selectedLabel: String
    /// Whether the selected vehicle is pinned (drives the collapsed-chip pin glyph).
    public let selectedIsPinned: Bool
    /// Whether the surface is an interactive picker (web renders when `vehicles.length > 1`) vs a static chip
    /// (`length === 1`, where the web returns `null`).
    public let isPickable: Bool

    public init(
        options: [VehiclePickerOption],
        selectedId: Int?,
        selectedLabel: String,
        selectedIsPinned: Bool,
        isPickable: Bool
    ) {
        self.options = options
        self.selectedId = selectedId
        self.selectedLabel = selectedLabel
        self.selectedIsPinned = selectedIsPinned
        self.isPickable = isPickable
    }
}

// MARK: - VehiclePickerCopy (the localized reads the projection needs)

/// The localized copy the projection consumes — the native bundle of the web reads the projector needs: the
/// `Vehicle {id}` fallback name (web's hardcoded `Vehicle ${id}`, routed through the facade so the native
/// code holds no English literal) and the collapsed-selector placeholder. Bundled into one value so the pure
/// projector stays within the parameter budget; the closure keeps the core free of `NSLocalizedString`.
public struct VehiclePickerCopy {
    /// The `Vehicle {id}` fallback name (web `\`Vehicle ${v.id}\``).
    public let fallbackName: (Int) -> String
    /// The collapsed-selector placeholder when nothing is selected (web empty `<Select value="">`).
    public let placeholder: String

    public init(fallbackName: @escaping (Int) -> String, placeholder: String) {
        self.fallbackName = fallbackName
        self.placeholder = placeholder
    }
}

// MARK: - VehiclePickerProjector (web sort + label chain + option map)

/// The pure ordering/label resolver — the verbatim port of the web component's render math. Every function is
/// a free, bundle-free transform so the unit tests reach it without a rendered view; the localized
/// `Vehicle {id}` string is injected as a closure so the core stays free of `NSLocalizedString`.
public enum VehiclePickerProjector {
    /// The web `||` falsy-aware name chain `display_name || vin || `Vehicle ${id}`` — an empty string is
    /// falsy in JS, so a present-but-empty `display_name` correctly falls through to the `vin`, then to the
    /// localized `Vehicle {id}` produced by `fallbackName`.
    public static func name(
        displayName: String?,
        vin: String?,
        id: Int,
        fallbackName: (Int) -> String
    ) -> String {
        if let displayName, !displayName.isEmpty { return displayName }
        if let vin, !vin.isEmpty { return vin }
        return fallbackName(id)
    }

    /// Whether a vehicle is pinned (web `pins.some((p) => String(p.item_id) === String(v.id))`).
    public static func isPinned(vehicleId: Int, pins: [VehiclePickerPin]) -> Bool {
        let key = String(vehicleId)
        return pins.contains { $0.itemId == key }
    }

    /// The pin-aware ordering — the verbatim, STABLE port of the web comparator: with no pins the fleet is
    /// returned unchanged (web `if (pins.length === 0) return vehicles`); otherwise pinned vehicles float to
    /// the top in ascending `position` order and the rest follow in their original fleet order. The original
    /// index is the tiebreaker so the sort is stable (web relies on `Array.prototype.sort` stability for the
    /// `return 0` branch).
    public static func sortedVehicles(
        _ vehicles: [VehiclePickerVehicle],
        pins: [VehiclePickerPin]
    ) -> [VehiclePickerVehicle] {
        guard !pins.isEmpty else { return vehicles }
        var order: [String: Int] = [:]
        for pin in pins {
            order[pin.itemId] = pin.position
        }
        return vehicles.enumerated().sorted { lhs, rhs in
            let lhsPos = order[String(lhs.element.id)]
            let rhsPos = order[String(rhs.element.id)]
            if let lhsPos, let rhsPos {
                return lhsPos != rhsPos ? lhsPos < rhsPos : lhs.offset < rhs.offset
            }
            if lhsPos != nil { return true }
            if rhsPos != nil { return false }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }

    /// One resolved picker row for a fleet vehicle (web option: label + pin prefix + selection).
    public static func option(
        for vehicle: VehiclePickerVehicle,
        selectedId: Int?,
        pins: [VehiclePickerPin],
        fallbackName: (Int) -> String
    ) -> VehiclePickerOption {
        VehiclePickerOption(
            id: vehicle.id,
            label: name(displayName: vehicle.displayName, vin: vehicle.vin, id: vehicle.id, fallbackName: fallbackName),
            isPinned: isPinned(vehicleId: vehicle.id, pins: pins),
            isSelected: vehicle.id == selectedId
        )
    }

    /// The full picker row list in pin-aware order (web `sorted.map(...)`).
    public static func options(
        vehicles: [VehiclePickerVehicle],
        pins: [VehiclePickerPin],
        selectedId: Int?,
        fallbackName: (Int) -> String
    ) -> [VehiclePickerOption] {
        sortedVehicles(vehicles, pins: pins).map {
            option(for: $0, selectedId: selectedId, pins: pins, fallbackName: fallbackName)
        }
    }

    /// The full render-ready projection from the bound fleet + pins + selection (web render output). The
    /// collapsed selector label is the selected row's label (web `<Select>` shows the matching option), or
    /// the placeholder when nothing matches.
    public static func projection(
        vehicles: [VehiclePickerVehicle],
        pins: [VehiclePickerPin],
        selectedId: Int?,
        copy: VehiclePickerCopy
    ) -> VehiclePickerProjection {
        let rows = options(vehicles: vehicles, pins: pins, selectedId: selectedId, fallbackName: copy.fallbackName)
        let selected = rows.first { $0.id == selectedId }
        return VehiclePickerProjection(
            options: rows,
            selectedId: selectedId,
            selectedLabel: selected?.label ?? copy.placeholder,
            selectedIsPinned: selected?.isPinned ?? false,
            isPickable: vehicles.count >= 2
        )
    }
}
