//
//  VehicleHeader.Adapter.swift
//  TeslaSync — P4 feature view · 0301 · VehicleHeader (Apple)
//
//  The testable projection core for the vehicle-detail header — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/VehicleHeader.tsx. Everything here is
//  pure + dependency-free (no store, no bundle, no rendered view) so the vehicle data
//  model, the status enum, the web `statusVariant` mapping, the "model + trim" label
//  composition, and the VoiceOver summary are all unit tested in isolation.
//
//  Parity note: the web header is a presentational leaf fed `vehicle`, `status`,
//  `onWake`, and `waking` by its parent (the Vehicle Detail page). It renders a status
//  `Badge` (variant = `statusVariant(status)`, with a dot, size `lg`), a neutral badge
//  carrying `{vehicle?.model} {vehicle?.trim_badging}`, the monospaced VIN, and the
//  "Wake Up" button. This core reproduces the data + derivations; the chrome lives in
//  the view layer. The web Badge prints the raw status token; native resolves each
//  status through the project's canonical VEHICLE_STATE_LABELS map (web
//  types/fsm/vehicle.ts) via the i18n facade so the UI shows a localizable label
//  rather than an untranslated lowercase token — a documented, deliberate choice.
//

import Foundation

// MARK: - Vehicle model (web `Vehicle` fields the header consumes)

/// The slice of the web `Vehicle` interface the header renders — the display `model`,
/// the `trim_badging`, and the `vin`. Carried verbatim from upstream (no SI conversion
/// applies to identity strings). Optional fields fall back to empty so the projection
/// can compose the badge + VIN exactly as the web does (`?? ''`).
public struct VehicleHeaderVehicle: Equatable, Sendable {
    public let model: String
    public let trimBadging: String
    public let vin: String

    public init(model: String, trimBadging: String, vin: String) {
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

// MARK: - Label formatting (web `{model} {trim_badging}` + VIN `?? ''`)

/// The header's text derivations. The web composes the neutral badge as
/// `` `${vehicle?.model ?? ''} ${vehicle?.trim_badging ?? ''}` `` and prints
/// `vehicle?.vin ?? ''`. This reproduces that, trimming so a missing trim does not
/// leave a dangling space and an absent vehicle yields an empty string.
public enum VehicleHeaderFormat {
    /// Web `` `${model ?? ''} ${trim_badging ?? ''}` `` — the model and trim joined by a
    /// single space, with empty parts dropped so the badge never shows stray spacing.
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
/// content is asserted without rendering the view. Mirrors the web surface: the status,
/// the model/trim, and the VIN read as one sentence.
public enum VehicleHeaderAccessibility {
    /// The composed spoken label: "{statusLabel}, {modelLine}, VIN {vin}", dropping any
    /// empty parts so an unavailable vehicle still reads cleanly.
    public static func headerLabel(statusLabel: String, modelLine: String, vinLabel: String, vin: String) -> String {
        var parts = [statusLabel]
        if !modelLine.isEmpty { parts.append(modelLine) }
        if !vin.isEmpty { parts.append("\(vinLabel) \(vin)") }
        return parts.joined(separator: ", ")
    }
}
