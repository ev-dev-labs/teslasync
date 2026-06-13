//
//  VehicleMultiSelect.Adapter.swift
//  TeslaSync — P4 shared surface · 0163 · VehicleMultiSelect (Apple)
//
//  The Foundation-only core for the Alert Studio multi-vehicle picker — the SwiftUI parity of
//  `components/forms/VehicleMultiSelect.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam (the native shape of the web `t(key, default)`), the discriminated-union selection value
//  (``VehicleMultiSelectValue`` — the web `{ kind: 'all_sticky' } | { kind: 'specific', vehicle_ids }`), the
//  fleet-row value type the option labels are derived from (``VehicleMultiSelectVehicle`` — the web
//  `v.display_name` / `v.model` / `v.vin` / `v.id`), the connectivity axis (``VehicleMultiSelectConnection``),
//  the render-ready row + projection value types, and the pure ``VehicleMultiSelectProjector`` — verbatim
//  ports of the web `vehicleLabel`, `dedupSort`, the trigger-summary branch, the unknown-id derivation, the
//  All-sentinel / per-vehicle toggles, and the `hydrateVehicleSelection` / `buildVehiclePayload` codec. No
//  SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum VehicleMultiSelectSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "VehicleMultiSelect"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias VehicleMultiSelectResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - VehicleMultiSelectValue (web `VehicleSelection` discriminated union)

/// The editor's selection value — the native peer of the web `VehicleSelection`:
/// `{ kind: 'all_sticky' } | { kind: 'specific'; vehicle_ids: number[] }`. The `allSticky` sentinel applies to
/// the whole fleet (current + future) and is mutually exclusive with a per-vehicle subset.
public enum VehicleMultiSelectValue: Sendable, Equatable {
    /// Applies to the fleet — every current and future vehicle (web `{ kind: 'all_sticky' }`).
    case allSticky
    /// An explicit subset of vehicle ids (web `{ kind: 'specific', vehicle_ids }`).
    case specific([Int])

    /// Whether this is the fleet-wide sentinel (web `value.kind === 'all_sticky'`).
    public var isAllSticky: Bool {
        if case .allSticky = self { return true }
        return false
    }

    /// The explicit ids, or `[]` for the sentinel (web `value.kind === 'specific' ? value.vehicle_ids : []`).
    public var selectedIDs: [Int] {
        if case let .specific(ids) = self { return ids }
        return []
    }
}

// MARK: - VehicleMultiSelectVehicle (web fleet row the labels read)

/// A fleet vehicle row — the minimal projection the option labels need, the native peer of the `Vehicle` the
/// web `vehicles.map(...)` reads. Carries exactly the four fields the web `vehicleLabel` fallback chain
/// consults: `display_name`, `model`, `vin`, and the `id` the selection is keyed on.
public struct VehicleMultiSelectVehicle: Sendable, Equatable, Identifiable {
    /// The vehicle's stable id (web `v.id`, the value the selection persists).
    public let id: Int
    /// The user-facing name (web `v.display_name`); `nil` / empty falls through to the model.
    public let displayName: String?
    /// The model (web `v.model`); the second label source, also shown after the name.
    public let model: String?
    /// The VIN (web `v.vin`); the last four characters augment the label when present.
    public let vin: String?

    public init(id: Int, displayName: String? = nil, model: String? = nil, vin: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.model = model
        self.vin = vin
    }
}

// MARK: - VehicleMultiSelectConnection (P4 connectivity axis)

/// The orthogonal freshness axis used by the P4 leaf-state contract: `live` (fresh), `stale` (older than the
/// freshness window — auto-refreshes once), `offline` (no connectivity — keeps the cached fleet). The web
/// component has no such axis; it is the native surface's always-render connectivity chip.
public enum VehicleMultiSelectConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - VehicleMultiSelectSummary (web `triggerSummary` branch, pre-localization)

/// The trigger summary variant — the pure, bundle-free result of the web `triggerSummary` `useMemo`. The
/// facade resolves each case to localized text (`vehiclesSummary*`), keeping this core translator-agnostic.
public enum VehicleMultiSelectSummary: Sendable, Equatable {
    /// The fleet sentinel is on (web `vehiclesSummaryAll` — "All vehicles").
    case all
    /// A specific selection with zero ids (web `vehiclesSummaryNone` — "No vehicles selected").
    case none
    /// Exactly one vehicle, shown by name (web `vehiclesSummaryOne` — "{{name}}").
    case one(name: String)
    /// Some-but-not-all selected (web `vehiclesSummaryPartial` — "{{count}} of {{total}} vehicles").
    case partial(count: Int, total: Int)
    /// All known vehicles individually selected (web `vehiclesSummaryCount` — "{{count}} vehicles").
    case count(Int)
}

// MARK: - Render-ready rows + projection

/// One per-vehicle option row in the popover — the native peer of the web
/// `<button role="checkbox" aria-checked>` mapped from `vehicles.map`.
public struct VehicleMultiSelectRow: Sendable, Equatable, Identifiable {
    /// The vehicle id the row toggles (web `v.id`).
    public let id: Int
    /// The resolved label (web `vehicleLabel(v)`).
    public let label: String
    /// Whether the row is selected (web `value.kind === 'specific' && vehicle_ids.includes(v.id)`).
    public let checked: Bool

    public init(id: Int, label: String, checked: Bool) {
        self.id = id
        self.label = label
        self.checked = checked
    }
}

/// One unknown-id row — a selected id that is not in the current fleet (web "Decision D10": a deleted /
/// re-VINed vehicle still on a server-stored rule). Always rendered checked so it is never silently dropped.
public struct VehicleMultiSelectUnknownRow: Sendable, Equatable, Identifiable {
    /// The orphaned vehicle id (web `unknownIds`).
    public let id: Int
    /// The resolved label (web `vehiclesUnknownLabel` — "Vehicle #{{id}}").
    public let label: String

    public init(id: Int, label: String) {
        self.id = id
        self.label = label
    }
}

/// The render-ready projection the popover and trigger switch over — everything the SwiftUI body needs as a
/// pure function of the value + fleet (no derivation in the view).
public struct VehicleMultiSelectProjection: Sendable, Equatable {
    /// The trigger summary variant (web `triggerSummary`).
    public let summary: VehicleMultiSelectSummary
    /// Whether the All sentinel is checked (web `value.kind === 'all_sticky'`).
    public let allSelected: Bool
    /// The per-vehicle option rows in fleet order (web `vehicles.map(...)`).
    public let rows: [VehicleMultiSelectRow]
    /// The unknown-id rows shown at the bottom (web `unknownIds.map(...)`).
    public let unknownRows: [VehicleMultiSelectUnknownRow]
    /// Whether the fleet is empty (web `vehicles.length === 0` — disables the trigger + shows the help line).
    public let isFleetEmpty: Bool

    public init(
        summary: VehicleMultiSelectSummary,
        allSelected: Bool,
        rows: [VehicleMultiSelectRow],
        unknownRows: [VehicleMultiSelectUnknownRow],
        isFleetEmpty: Bool
    ) {
        self.summary = summary
        self.allSelected = allSelected
        self.rows = rows
        self.unknownRows = unknownRows
        self.isFleetEmpty = isFleetEmpty
    }

    /// Whether any orphaned ids are present (web `unknownIds.length > 0` — renders the divider + the rows).
    public var hasUnknown: Bool {
        !unknownRows.isEmpty
    }
}

// MARK: - VehicleMultiSelectProjector (web render body + codec)

/// The pure projection from the value + fleet to the view-ready model — the surface's data adapter in the
/// "cached → projection" sense the acceptance calls for. Every function is a free, bundle-free transform so
/// the unit tests reach it without a rendered view; the localized `Vehicle #{id}` / unknown labels are
/// injected as closures so the core stays free of `NSLocalizedString`.
public enum VehicleMultiSelectProjector {
    /// Trims to `nil` when a string is absent or empty — the native peer of the web `||` falsy-empty fallback.
    static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// The last four VIN characters, or `nil` when the VIN is absent or shorter than four (web `lastFourVin`).
    public static func lastFourVIN(_ vin: String?) -> String? {
        guard let vin, vin.count >= 4 else { return nil }
        return String(vin.suffix(4))
    }

    /// The popover row label — the verbatim port of the web `vehicleLabel(v)`:
    /// `base = display_name || model || `Vehicle #${id}``; with no VIN suffix, append `— model` when present;
    /// otherwise append `(VIN ...last4)`, prefixing `— model` only when a model exists and differs from the
    /// display name (web `!v.model || v.display_name === v.model`).
    public static func vehicleLabel(
        displayName: String?,
        model: String?,
        vin: String?,
        id: Int,
        fallbackName: (Int) -> String
    ) -> String {
        let last4 = lastFourVIN(vin)
        let base = nonEmpty(displayName) ?? nonEmpty(model) ?? fallbackName(id)
        guard let last4 else {
            if let model = nonEmpty(model) { return "\(base) — \(model)" }
            return base
        }
        guard let model = nonEmpty(model), displayName != model else {
            return "\(base) (VIN ...\(last4))"
        }
        return "\(base) — \(model) (VIN ...\(last4))"
    }

    /// The short trigger name for one vehicle (web `display_name || model || `Vehicle #${id}``) — note this is
    /// the bare name, NOT the VIN-augmented `vehicleLabel` used in the popover rows.
    public static func shortName(
        for vehicle: VehicleMultiSelectVehicle?,
        id: Int,
        fallbackName: (Int) -> String
    ) -> String {
        guard let vehicle else { return fallbackName(id) }
        return nonEmpty(vehicle.displayName) ?? nonEmpty(vehicle.model) ?? fallbackName(id)
    }

    /// De-duplicate (keeping ids `> 0`) and sort ascending — the verbatim port of the web `dedupSort`.
    public static func dedupSort(_ ids: [Int]) -> [Int] {
        var seen = Set<Int>()
        var out: [Int] = []
        for id in ids where id > 0 && !seen.contains(id) {
            seen.insert(id)
            out.append(id)
        }
        return out.sorted()
    }

    /// The ids selected on a rule but absent from the current fleet (web `unknownIds`) — preserved, in their
    /// original selection order, so the payload never silently drops a deleted / re-VINed vehicle.
    public static func unknownIDs(value: VehicleMultiSelectValue, knownIDs: Set<Int>) -> [Int] {
        value.selectedIDs.filter { !knownIDs.contains($0) }
    }

    /// The trigger summary variant (web `triggerSummary`): the sentinel → `.all`; an empty subset → `.none`; a
    /// single id → `.one(name)`; a strict subset of a non-empty fleet → `.partial`; otherwise `.count`.
    public static func summary(
        value: VehicleMultiSelectValue,
        vehicles: [VehicleMultiSelectVehicle],
        fallbackName: (Int) -> String
    ) -> VehicleMultiSelectSummary {
        if value.isAllSticky { return .all }
        let ids = value.selectedIDs
        let total = vehicles.count
        let count = ids.count
        if count == 0 { return .none }
        if count == 1 {
            let id = ids[0]
            let vehicle = vehicles.first { $0.id == id }
            return .one(name: shortName(for: vehicle, id: id, fallbackName: fallbackName))
        }
        if total > 0, count < total { return .partial(count: count, total: total) }
        return .count(count)
    }

    /// Toggle the All sentinel (web `handleToggleAll`): when on, restore the remembered specific subset (web
    /// "Decision D13", empty when none); otherwise move to the fleet sentinel.
    public static func toggleAll(
        _ value: VehicleMultiSelectValue,
        previousSpecific: [Int]
    ) -> VehicleMultiSelectValue {
        value.isAllSticky ? .specific(previousSpecific) : .allSticky
    }

    /// Toggle one vehicle (web `handleToggleVehicle`): remove it when present, otherwise add it (de-duped +
    /// sorted). Toggling from the sentinel starts a fresh specific subset of just that id.
    public static func toggleVehicle(_ value: VehicleMultiSelectValue, id: Int) -> VehicleMultiSelectValue {
        let current = value.selectedIDs
        if current.contains(id) {
            return .specific(current.filter { $0 != id })
        }
        return .specific(dedupSort(current + [id]))
    }

    /// The full render-ready projection from the value + fleet — the native peer of the web render decision.
    public static func projection(
        value: VehicleMultiSelectValue,
        vehicles: [VehicleMultiSelectVehicle],
        fallbackName: (Int) -> String,
        unknownLabel: (Int) -> String
    ) -> VehicleMultiSelectProjection {
        let selected = Set(value.selectedIDs)
        let knownIDs = Set(vehicles.map(\.id))
        let rows = vehicles.map { vehicle in
            VehicleMultiSelectRow(
                id: vehicle.id,
                label: vehicleLabel(
                    displayName: vehicle.displayName,
                    model: vehicle.model,
                    vin: vehicle.vin,
                    id: vehicle.id,
                    fallbackName: fallbackName
                ),
                checked: !value.isAllSticky && selected.contains(vehicle.id)
            )
        }
        let unknownRows = unknownIDs(value: value, knownIDs: knownIDs).map { id in
            VehicleMultiSelectUnknownRow(id: id, label: unknownLabel(id))
        }
        return VehicleMultiSelectProjection(
            summary: summary(value: value, vehicles: vehicles, fallbackName: fallbackName),
            allSelected: value.isAllSticky,
            rows: rows,
            unknownRows: unknownRows,
            isFleetEmpty: vehicles.isEmpty
        )
    }

    // MARK: Codec (web `hydrateVehicleSelection` / `buildVehiclePayload`)

    /// Hydrate a server-stored rule into the editor value — the verbatim port of `hydrateVehicleSelection`:
    /// honour the new `all_vehicles` flag when present (with a deduped+sorted subset), else fall back to the
    /// legacy single `vehicle_id` (`nil` → the fleet sentinel; otherwise a one-id subset).
    public static func hydrate(
        allVehicles: Bool?,
        vehicleIDs: [Int]?,
        vehicleID: Int?
    ) -> VehicleMultiSelectValue {
        if let allVehicles {
            if allVehicles { return .allSticky }
            return .specific(dedupSort(vehicleIDs ?? []))
        }
        guard let vehicleID else { return .allSticky }
        return .specific([vehicleID])
    }

    /// Build the wire sub-payload from the editor value — the verbatim port of `buildVehiclePayload`: always
    /// emit BOTH `all_vehicles` and a deduped+sorted `vehicle_ids`; never the legacy `vehicle_id`.
    public static func buildPayload(_ value: VehicleMultiSelectValue) -> (allVehicles: Bool, vehicleIDs: [Int]) {
        switch value {
        case .allSticky:
            (allVehicles: true, vehicleIDs: [])
        case let .specific(ids):
            (allVehicles: false, vehicleIDs: dedupSort(ids))
        }
    }
}
