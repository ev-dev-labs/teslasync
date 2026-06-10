//
//  VehicleHeader.Adapter.swift
//  TeslaSync — P4 feature view · 0305 · VehicleHeader (Apple)
//
//  The testable projection core for the vehicle header — the SwiftUI parity of
//  features/vehicles/components/VehicleHeader.tsx. Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the vehicle data model,
//  the status enum, the web `getVehicleStatus` → variant mapping, the title fallback
//  (`display_name || vin || 'Vehicle'`), the "model + trim" subtitle composition, and
//  the VoiceOver summary are all unit tested in isolation.
//
//  Parity note: the web header takes `vehicle`, `state`, and `onRefetchState`, derives
//  `status = vehicle ? getVehicleStatus(state) : 'offline'`, and renders an `h1` title
//  (`vehicle?.display_name || vehicle?.vin || t('common.vehicle', 'Vehicle')`), the
//  shared `StatusBadge` (size `md`), a muted subtitle `{model} {trim_badging} · {vin}`
//  with the VIN monospaced, and the "Wake Up" `Button` (which fires the internal
//  `useWakeVehicle` mutation and re-fetches state after it lands). This core reproduces
//  the data + derivations; the chrome lives in the view layer. The web `StatusBadge`
//  prints the raw status token capitalized; native resolves each status through the
//  project's canonical VEHICLE_STATE_LABELS map (web types/fsm/vehicle.ts) via the i18n
//  facade so the UI shows a localizable label rather than an untranslated lowercase
//  token — a documented, deliberate choice.
//

import Foundation

// MARK: - Vehicle model (web `Vehicle` fields the header consumes)

/// The slice of the web `Vehicle` interface the header renders — the `display_name`
/// (the `h1` title), the display `model`, the `trim_badging`, and the `vin`. Carried
/// verbatim from upstream (no SI conversion applies to identity strings). Optional
/// fields fall back to empty so the projection can compose the title, subtitle, and VIN
/// exactly as the web does (`?? ''`).
public struct VehicleHeaderVehicle: Equatable, Sendable {
    public let displayName: String
    public let model: String
    public let trimBadging: String
    public let vin: String

    public init(displayName: String = "", model: String, trimBadging: String, vin: String) {
        self.displayName = displayName
        self.model = model
        self.trimBadging = trimBadging
        self.vin = vin
    }
}

// MARK: - Status (web `VehicleStatus` = the FSM `VehicleState` union)

/// The vehicle status — the native mirror of the web `VehicleStatus` union
/// (`VEHICLE_STATES`, web types/fsm/vehicle.ts). `offline` is the web default when no
/// vehicle/state is resolved (`vehicle ? deriveStatus(state) : 'offline'`).
public enum VehicleHeaderStatus: String, Sendable, Equatable, CaseIterable {
    case online
    case driving
    case charging
    case parked
    case updating
    case asleep
    case offline
}

// MARK: - Badge variant (web `BadgeVariant`)

/// The badge tone — the native mirror of the web `BadgeVariant` union
/// (`'success' | 'warning' | 'danger' | 'info' | 'neutral'`). Mapped to a `TSTone` in
/// the view layer so this core stays presentation-free.
public enum VehicleHeaderBadgeVariant: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case danger
    case info
    case neutral
}

// MARK: - Status derivations (web `statusVariant` + VEHICLE_STATE_LABELS)

/// The pure mappings the web derives from a status: the badge variant
/// (`statusVariant`, web api/types.ts → `VEHICLE_STATE_ENTRIES[status].variant`) and
/// the canonical display-label key (web `VEHICLE_STATE_LABELS`). Unit tested across all
/// seven states.
public enum VehicleHeaderStatusMap {
    /// Web `statusVariant(status)` — the badge variant for the status dot + tint. The
    /// web map: online/driving → success, charging → warning, parked/updating → info,
    /// asleep → neutral, offline → danger (the web `?? 'danger'` fallback).
    public static func variant(_ status: VehicleHeaderStatus) -> VehicleHeaderBadgeVariant {
        switch status {
        case .online, .driving: .success
        case .charging: .warning
        case .parked, .updating: .info
        case .asleep: .neutral
        case .offline: .danger
        }
    }

    /// The i18n key for the status label — backs the localized, capitalized label from
    /// the web `VEHICLE_STATE_LABELS` map (Online, Driving, …) rather than the raw
    /// lowercase token the web Badge happens to print.
    public static func labelKey(_ status: VehicleHeaderStatus) -> String {
        "status.\(status.rawValue)"
    }

    /// The English fallback for the status label — the web `VEHICLE_STATE_LABELS`
    /// value, used as the `NSLocalizedString` default so the surface holds no
    /// hardcoded English in the view layer.
    public static func labelFallback(_ status: VehicleHeaderStatus) -> String {
        switch status {
        case .online: "Online"
        case .driving: "Driving"
        case .charging: "Charging"
        case .parked: "Parked"
        case .updating: "Updating"
        case .asleep: "Asleep"
        case .offline: "Offline"
        }
    }
}

// MARK: - Label formatting (web title + `{model} {trim_badging}` subtitle + VIN)

/// The header's text derivations. The web title is
/// `vehicle?.display_name || vehicle?.vin || t('common.vehicle', 'Vehicle')`; the
/// subtitle is `` `${vehicle?.model} ${vehicle?.trim_badging} · ${vehicle?.vin}` `` with
/// the VIN monospaced. This reproduces those, trimming so a missing part does not leave
/// dangling spacing and an absent vehicle yields an empty string (the view applies the
/// localized `common.vehicle` fallback for an empty title).
public enum VehicleHeaderFormat {
    /// Web `vehicle?.display_name || vehicle?.vin || …` — the first non-empty of the
    /// display name then the VIN, or empty when neither resolves (the view then shows
    /// the localized `common.vehicle` fallback). Trimmed so whitespace-only values fall
    /// through like the web's falsy `||` chain.
    public static func title(_ vehicle: VehicleHeaderVehicle?) -> String {
        guard let vehicle else { return "" }
        let name = vehicle.displayName.trimmingCharacters(in: .whitespaces)
        if !name.isEmpty { return name }
        return vehicle.vin.trimmingCharacters(in: .whitespaces)
    }

    /// Web `` `${model ?? ''} ${trim_badging ?? ''}` `` — the model and trim joined by a
    /// single space, with empty parts dropped so the subtitle never shows stray spacing.
    public static func modelLine(_ vehicle: VehicleHeaderVehicle?) -> String {
        guard let vehicle else { return "" }
        return [vehicle.model, vehicle.trimBadging]
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// Web `vehicle?.vin ?? ''` — the VIN string, or empty when no vehicle is resolved.
    public static func vin(_ vehicle: VehicleHeaderVehicle?) -> String {
        vehicle?.vin ?? ""
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the header's VoiceOver string from already-localized parts, so the spoken
/// content is asserted without rendering the view. Mirrors the web surface reading
/// order: the title, the status, the model/trim, and the VIN read as one sentence.
public enum VehicleHeaderAccessibility {
    /// The composed spoken label: "{title}, {statusLabel}, {modelLine}, VIN {vin}",
    /// dropping any empty parts so an unavailable vehicle still reads cleanly.
    public static func headerLabel(
        title: String,
        statusLabel: String,
        modelLine: String,
        vinLabel: String,
        vin: String
    ) -> String {
        var parts: [String] = []
        if !title.isEmpty { parts.append(title) }
        parts.append(statusLabel)
        if !modelLine.isEmpty { parts.append(modelLine) }
        if !vin.isEmpty { parts.append("\(vinLabel) \(vin)") }
        return parts.joined(separator: ", ")
    }
}
