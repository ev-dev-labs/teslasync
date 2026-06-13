//
//  ActiveVehicleSegment.Adapter.swift
//  TeslaSync — P4 shared surface · 0176 · ActiveVehicleSegment (Apple)
//
//  The testable, dependency-light core for the footer active-vehicle segment — the SwiftUI parity of
//  `components/layout/status-bar/ActiveVehicleSegment.tsx`. Everything here is pure (Foundation only): the
//  surface identity (the diagnostics slug + the canonical SI distance factors mirrored from
//  `unitConversion.ts`), the i18n facade seam (the native shape of the web `t(key, default)`), the fleet-row
//  value type the labels derive from (``ActiveVehicleSegmentVehicle`` — the web `display_name` / `vin` /
//  `model`), the live-state metrics carrier (``ActiveVehicleSegmentMetrics`` — the web `useVehicleState`
//  `battery_level` + `rated_range`), the connectivity axis (``ActiveVehicleSegmentConnection``), the menu
//  row (``ActiveVehicleSegmentOption``), and the pure projection the rest of the surface derives from: the
//  verbatim ports of the web label fallback (`display_name || vin || `Vehicle ${id}` || 'No vehicle'`), the
//  metrics line (`${battery ?? 0}% · ${round(convertDistanceFromSI(range ?? 0, unit))} ${unit}`), the
//  tooltip composition, and the single-vs-switcher decision (`vehicles.length === 1` vs `> 1`). No SwiftUI
//  and no `@Observable`, so every rule is unit-testable in isolation. The SI conversion is reproduced
//  locally (not routed through the KMP `Units` facade) so the rounding + unit label match the web source
//  exactly and the projection stays deterministic — the same disposition as the 0085 Distance surface.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug) + SI factors

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11) and the
/// canonical SI distance factors (mirroring `unitConversion.ts`). Kept SwiftUI-free so the state-holder can
/// emit telemetry and the projector can convert without depending on the view layer.
public enum ActiveVehicleSegmentSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ActiveVehicleSegment"

    /// Canonical SI factors (web `METERS_PER_MILE` / `METERS_PER_KM` / `METERS_PER_FOOT`).
    public static let metersPerMile = 1609.344
    public static let metersPerKm = 1000.0
    public static let metersPerFoot = 0.3048
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias ActiveVehicleSegmentResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - ActiveVehicleSegmentVehicle (web fleet row the labels read)

/// A fleet vehicle row — the minimal projection the labels need, the native peer of the `Vehicle` the web
/// `vehicles.map(...)` reads. Carries the four fields the web label chain consults: `display_name`, `vin`,
/// the `model` sublabel, and the `id` the selection is keyed on.
public struct ActiveVehicleSegmentVehicle: Sendable, Equatable, Identifiable {
    /// The vehicle's stable id (web `v.id`, the value the selection persists).
    public let id: Int
    /// The user-facing name (web `v.display_name`); `nil` / empty falls through to the `vin`.
    public let displayName: String?
    /// The VIN (web `v.vin`); the second fallback when there is no display name.
    public let vin: String?
    /// The model badge shown after the name (web `v.model`); `nil` / empty hides it.
    public let model: String?

    public init(id: Int, displayName: String? = nil, vin: String? = nil, model: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.model = model
    }
}

// MARK: - ActiveVehicleSegmentMetrics (web `useVehicleState` live state)

/// The selected vehicle's live-state metrics — the native peer of the web `stateData?.state` read. `present`
/// is the web `liveState` truthiness gate (the metrics line renders only when the live state exists);
/// `batteryLevel` is `state.battery_level` (web `?? 0`); `ratedRangeMeters` is `state.rated_range`, which —
/// per the source comment — arrives in SI metres (web `?? 0`).
public struct ActiveVehicleSegmentMetrics: Sendable, Equatable {
    /// Whether the live vehicle state exists (web `liveState ? … : null`). When `false` the metrics line is
    /// suppressed regardless of the numeric fields.
    public let present: Bool
    /// The battery percentage (web `state.battery_level`); `nil` is rendered as `0` (web `?? 0`).
    public let batteryLevel: Int?
    /// The rated range in SI metres (web `state.rated_range`); `nil` is rendered as `0` (web `?? 0`).
    public let ratedRangeMeters: Double?

    public init(present: Bool, batteryLevel: Int? = nil, ratedRangeMeters: Double? = nil) {
        self.present = present
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
    }

    /// The empty metrics carrier (web `liveState == null`) — no live state, so no metrics line.
    public static let absent = ActiveVehicleSegmentMetrics(present: false)
}

// MARK: - ActiveVehicleSegmentConnection (P4 connectivity axis)

/// The orthogonal freshness axis used by the P4 leaf-state contract: `live` (fresh), `stale` (older than the
/// freshness window — auto-refreshes once), `offline` (no connectivity — keeps the cached metrics). The web
/// component has no such axis (the footer-tier 60s poll just refreshes silently); it is the native surface's
/// always-render connectivity chip.
public enum ActiveVehicleSegmentConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - ActiveVehicleSegmentOption (web listbox row)

/// One resolved switcher row — the native peer of the web `vehicles.map((v) => …)` listbox option. A value
/// type so the projection, the menu, and the tests all agree on one shape.
public struct ActiveVehicleSegmentOption: Sendable, Equatable, Identifiable {
    /// The vehicle id this row selects (the `Identifiable` key, web `v.id`).
    public let id: Int
    /// The resolved row name (web `v.display_name || v.vin || `Vehicle ${v.id}``).
    public let name: String
    /// The model badge after the name (web `v.model`), `nil` when absent / empty.
    public let model: String?
    /// Whether this row is the current selection (web `v.id === vehicleId` → the trailing check).
    public let isSelected: Bool

    public init(id: Int, name: String, model: String? = nil, isSelected: Bool) {
        self.id = id
        self.name = name
        self.model = model
        self.isSelected = isSelected
    }
}

// MARK: - ActiveVehicleSegmentProjection (render-ready)

/// The render-ready projection the surface's content state composes from — the resolved active-vehicle
/// label, the model sublabel, the metrics line, the tooltip, the switcher rows, and the single-vs-switcher
/// decision. A pure function of the bound fleet + selection + metrics (web render output).
public struct ActiveVehicleSegmentProjection: Sendable, Equatable {
    /// The active-vehicle label (web `vehicle?.display_name || vehicle?.vin || `Vehicle ${id}` ||
    /// 'No vehicle'`).
    public let label: String
    /// The model sublabel (web `vehicle?.model || ''`), empty when absent.
    public let subLabel: String
    /// The `battery% · range unit` line (web `metricsLabel`), `nil` when there is no live state.
    public let metricsLabel: String?
    /// The composed hover/VoiceOver tooltip (web `Active vehicle · label · sub · metrics`).
    public let tooltip: String
    /// The switcher rows in fleet order (web `vehicles.map(...)`), empty for a 0/1-vehicle fleet.
    public let options: [ActiveVehicleSegmentOption]
    /// Whether the segment is an interactive switcher (web `vehicles.length > 1`) vs a static chip
    /// (`length === 1`).
    public let isSwitchable: Bool

    public init(
        label: String,
        subLabel: String,
        metricsLabel: String?,
        tooltip: String,
        options: [ActiveVehicleSegmentOption],
        isSwitchable: Bool
    ) {
        self.label = label
        self.subLabel = subLabel
        self.metricsLabel = metricsLabel
        self.tooltip = tooltip
        self.options = options
        self.isSwitchable = isSwitchable
    }
}

// MARK: - ActiveVehicleSegmentCopy (the localized reads the projection needs)

/// The localized copy the projection consumes — the native bundle of the web `t()` reads: the `Vehicle
/// {id}` fallback name, the `No vehicle` label, and the `Active vehicle` tooltip prefix. Bundled into one
/// value so the pure projector stays within the parameter budget; the closures keep the core free of
/// `NSLocalizedString` (the production app passes the P1/S10 facade, tests pass identity-fallback closures).
public struct ActiveVehicleSegmentCopy {
    /// The `Vehicle {id}` fallback name (web `${t('statusBar.vehicle.fallback', 'Vehicle')} ${id}`).
    public let fallbackName: (Int) -> String
    /// The `No vehicle` label (web `t('statusBar.vehicle.none', 'No vehicle')`).
    public let noneLabel: () -> String
    /// The tooltip prefix (web `t('statusBar.vehicle.tooltip', 'Active vehicle')`).
    public let activeVehicleText: String

    public init(
        fallbackName: @escaping (Int) -> String,
        noneLabel: @escaping () -> String,
        activeVehicleText: String
    ) {
        self.fallbackName = fallbackName
        self.noneLabel = noneLabel
        self.activeVehicleText = activeVehicleText
    }
}

// MARK: - ActiveVehicleSegmentProjector (web label chain + metrics + tooltip + options)

/// The pure label/metrics/tooltip resolver — the verbatim port of the web component's render math. Every
/// function is a free, bundle-free transform so the unit tests reach it without a rendered view; the
/// localized `Vehicle {id}` / `No vehicle` strings are injected as closures so the core stays free of
/// `NSLocalizedString`.
public enum ActiveVehicleSegmentProjector {
    /// Web `convertDistanceFromSI(meters, to)` — metres → km / mi / ft, defaulting an unknown label to km
    /// (the SI-adjacent metric base) so a stray preference never crashes the renderer.
    public static func convertDistanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / ActiveVehicleSegmentSurface.metersPerMile
        case "ft": meters / ActiveVehicleSegmentSurface.metersPerFoot
        default: meters / ActiveVehicleSegmentSurface.metersPerKm
        }
    }

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

    /// The active-vehicle label (web `vehicle?.display_name || vehicle?.vin || (vehicleId != null ? `Vehicle
    /// ${vehicleId}` : 'No vehicle')`). With no selected vehicle row, a non-nil id still yields `Vehicle
    /// {id}`, and a nil id yields the localized `No vehicle`.
    public static func label(
        vehicle: ActiveVehicleSegmentVehicle?,
        selectedId: Int?,
        fallbackName: (Int) -> String,
        noneLabel: () -> String
    ) -> String {
        if let vehicle {
            if let displayName = vehicle.displayName, !displayName.isEmpty { return displayName }
            if let vin = vehicle.vin, !vin.isEmpty { return vin }
        }
        if let selectedId { return fallbackName(selectedId) }
        return noneLabel()
    }

    /// The model sublabel (web `vehicle?.model || ''`) — empty for a missing / blank model.
    public static func subLabel(vehicle: ActiveVehicleSegmentVehicle?) -> String {
        guard let model = vehicle?.model, !model.isEmpty else { return "" }
        return model
    }

    /// The `battery% · range unit` line (web `liveState ? `${battery_level ?? 0}% ·
    /// ${Math.round(convertDistanceFromSI(rated_range ?? 0, unit))} ${unit}` : null`). `nil` when there is
    /// no live state. The range is rounded half-away-from-zero to match JS `Math.round` for the
    /// non-negative ranges this surface shows.
    public static func metricsLabel(metrics: ActiveVehicleSegmentMetrics, distanceUnit: String) -> String? {
        guard metrics.present else { return nil }
        let battery = metrics.batteryLevel ?? 0
        let converted = convertDistanceFromSI(metrics.ratedRangeMeters ?? 0, to: distanceUnit)
        let range = Int(converted.rounded())
        return "\(battery)% · \(range) \(distanceUnit)"
    }

    /// The composed tooltip (web `{tooltipText} · {label}{sub ? ` · ${sub}` : ''}{metrics ? ` · ${metrics}`
    /// : ''}`).
    public static func tooltip(
        activeVehicleText: String,
        label: String,
        subLabel: String,
        metricsLabel: String?
    ) -> String {
        var parts = ["\(activeVehicleText) · \(label)"]
        if !subLabel.isEmpty { parts.append(subLabel) }
        if let metricsLabel, !metricsLabel.isEmpty { parts.append(metricsLabel) }
        return parts.joined(separator: " · ")
    }

    /// One switcher row for a fleet vehicle (web listbox option: name + model + selected check).
    public static func option(
        for vehicle: ActiveVehicleSegmentVehicle,
        selectedId: Int?,
        fallbackName: (Int) -> String
    ) -> ActiveVehicleSegmentOption {
        ActiveVehicleSegmentOption(
            id: vehicle.id,
            name: name(displayName: vehicle.displayName, vin: vehicle.vin, id: vehicle.id, fallbackName: fallbackName),
            model: (vehicle.model?.isEmpty == false) ? vehicle.model : nil,
            isSelected: vehicle.id == selectedId
        )
    }

    /// The full switcher row list in fleet order (web `vehicles.map(...)`). Returned empty for a 0/1-vehicle
    /// fleet (the web only renders the popover when `vehicles.length > 1`).
    public static func options(
        vehicles: [ActiveVehicleSegmentVehicle],
        selectedId: Int?,
        fallbackName: (Int) -> String
    ) -> [ActiveVehicleSegmentOption] {
        guard vehicles.count > 1 else { return [] }
        return vehicles.map { option(for: $0, selectedId: selectedId, fallbackName: fallbackName) }
    }

    /// The full render-ready projection from the bound fleet + selection + metrics. `selectedVehicle` is the
    /// fleet row matching `selectedId` (web `vehicle`), resolved by the caller; this keeps the projector a
    /// single pure transform over already-resolved inputs.
    public static func projection(
        vehicles: [ActiveVehicleSegmentVehicle],
        selectedId: Int?,
        metrics: ActiveVehicleSegmentMetrics,
        distanceUnit: String,
        copy: ActiveVehicleSegmentCopy
    ) -> ActiveVehicleSegmentProjection {
        let selectedVehicle = vehicles.first { $0.id == selectedId }
        let label = label(
            vehicle: selectedVehicle,
            selectedId: selectedId,
            fallbackName: copy.fallbackName,
            noneLabel: copy.noneLabel
        )
        let sub = subLabel(vehicle: selectedVehicle)
        let metricsLine = metricsLabel(metrics: metrics, distanceUnit: distanceUnit)
        let tooltipLine = tooltip(
            activeVehicleText: copy.activeVehicleText,
            label: label,
            subLabel: sub,
            metricsLabel: metricsLine
        )
        return ActiveVehicleSegmentProjection(
            label: label,
            subLabel: sub,
            metricsLabel: metricsLine,
            tooltip: tooltipLine,
            options: options(vehicles: vehicles, selectedId: selectedId, fallbackName: copy.fallbackName),
            isSwitchable: vehicles.count > 1
        )
    }
}
