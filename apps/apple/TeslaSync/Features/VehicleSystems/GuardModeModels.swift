//
//  GuardModeModels.swift
//  TeslaSync — P4 feature view · P7 · GuardMode (Apple) — Data Models
//
//  Wire-faithful Swift peers of the web Guard Mode contract. Field names and
//  JSON keys mirror `web/src/api/hooks/useGuard.ts` (`GuardConfig`,
//  `GuardEvent`) and `web/src/api/types.ts` (`Geofence`) exactly — snake_case
//  on the wire, SI on disk (geofence `radius` is meters). Types are prefixed
//  `GuardMode*` to avoid colliding with the dashboard widget's `Guard*` types.
//

import Foundation
import SwiftUI

// MARK: - Sensitivity (web SENSITIVITY_OPTIONS)

/// Guard movement sensitivity. Raw values match the backend tokens
/// (`low` / `medium` / `high`) carried by `GuardConfig.sensitivity`.
enum GuardModeSensitivity: String, Codable, CaseIterable, Identifiable, Equatable {
    case low
    case medium
    case high

    var id: String { rawValue }

    /// Localized option label (web `SENSITIVITY_OPTIONS[*].label`).
    var label: String {
        switch self {
        case .low:
            return String(localized: "translation.guard.sensitivityLow", defaultValue: "Low — Movement > 1km")
        case .medium:
            return String(localized: "translation.guard.sensitivityMedium", defaultValue: "Medium — Movement > 200m")
        case .high:
            return String(localized: "translation.guard.sensitivityHigh", defaultValue: "High — Any movement")
        }
    }
}

// MARK: - Guard config (web GuardConfig)

/// `GET /vehicles/{vehicleId}/guard`. Mirrors `database.GuardConfig`.
struct GuardModeConfig: Codable, Equatable {
    let vehicleID: Int64
    let enabled: Bool
    let homeGeofenceID: Int64?
    let sensitivity: GuardModeSensitivity
    let autoPanic: Bool
    let createdAt: Date?
    let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case vehicleID = "vehicle_id"
        case enabled
        case homeGeofenceID = "home_geofence_id"
        case sensitivity
        case autoPanic = "auto_panic"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// MARK: - Guard event (web GuardEvent)

/// One state-change record from `GET /vehicles/{vehicleId}/guard/events`.
/// `acknowledged` is DERIVED from `acknowledgedAt != nil` (see web
/// `isGuardEventAcknowledged`); the backend emits no separate boolean.
struct GuardModeEvent: Codable, Identifiable, Equatable {
    let id: Int64
    let vehicleID: Int64
    let ts: Date
    let eventType: String
    let fromState: String?
    let toState: String?
    let acknowledgedAt: Date?
    let acknowledgedBy: String?

    enum CodingKeys: String, CodingKey {
        case id
        case vehicleID = "vehicle_id"
        case ts
        case eventType = "event_type"
        case fromState = "from_state"
        case toState = "to_state"
        case acknowledgedAt = "acknowledged_at"
        case acknowledgedBy = "acknowledged_by"
    }
}

/// Web `isGuardEventAcknowledged` — kept under the same name at the call site.
/// A guard event is "acknowledged" iff `acknowledgedAt` is set.
func isGuardEventAcknowledged(_ event: GuardModeEvent) -> Bool {
    event.acknowledgedAt != nil
}

// MARK: - Geofence (web Geofence — SI radius in meters)

/// `GET /geofences`. `radius` is meters (SI, ADR-005). Mirrors the Go
/// `models.Geofence` JSON tags.
struct GuardModeGeofence: Codable, Identifiable, Equatable {
    let id: Int64
    let name: String
    let latitude: Double
    let longitude: Double
    let radius: Double
}

// MARK: - Vehicle live state (web useVehicleState slice)

/// The fields the page reads off the vehicle state envelope: position plus the
/// lock / sentry booleans. Position is omitted when the vehicle is asleep.
struct GuardModeVehicleSnapshot: Codable, Equatable {
    let latitude: Double?
    let longitude: Double?
    let isLocked: Bool
    let sentryMode: Bool

    enum CodingKeys: String, CodingKey {
        case latitude
        case longitude
        case isLocked = "is_locked"
        case sentryMode = "sentry_mode"
    }

    /// Web `hasLocation`: a non-zero, present coordinate pair.
    var hasLocation: Bool {
        guard let latitude, let longitude else { return false }
        return latitude != 0 || longitude != 0
    }
}

/// Minimal vehicle identity for the selector (web `display_name`).
struct GuardModeVehicle: Codable, Identifiable, Equatable {
    let id: Int64
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
}

// MARK: - Event presentation (web EVENT_LABELS / EVENT_BADGE_VARIANT)

/// Badge tone for an event (web `'danger' | 'warning' | 'info'`).
enum GuardModeBadgeTone: Equatable {
    case danger
    case warning
    case info

    var color: Color {
        switch self {
        case .danger: return .red
        case .warning: return .orange
        case .info: return .blue
        }
    }
}

/// Lookup-with-fallback presentation for backend event tokens — the native peer
/// of the web `EVENT_LABELS` / `EVENT_BADGE_VARIANT` maps. New backend tokens
/// render as a humanized fallback instead of crashing (web parity).
enum GuardModeEventDisplay {
    private static let labels: [String: String] = [
        "vehicle_moved": "Vehicle Moved",
        "unauthorized_unlock": "Unauthorized Unlock",
        "unauthorized_drive": "Unauthorized Drive",
        "sentry_triggered": "Sentry Triggered",
        "manual_panic": "Manual Panic",
        "test_alert": "Test Alert",
        "locked": "Lock State Changed",
        "sentry_mode": "Sentry Mode",
        "valet_mode_enabled": "Valet Mode"
    ]

    private static let tones: [String: GuardModeBadgeTone] = [
        "vehicle_moved": .danger,
        "unauthorized_unlock": .danger,
        "unauthorized_drive": .danger,
        "sentry_triggered": .warning,
        "manual_panic": .danger,
        "test_alert": .info,
        "locked": .info,
        "sentry_mode": .warning,
        "valet_mode_enabled": .info
    ]

    /// Display label for a token, humanizing unknown tokens (web fallback).
    static func label(for type: String) -> String {
        if let known = labels[type] { return known }
        return type
            .split(separator: "_")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    static func tone(for type: String) -> GuardModeBadgeTone {
        tones[type] ?? .info
    }

    /// SF Symbol for the event leading icon (web lucide icon selection).
    static func symbol(for type: String, acknowledged: Bool) -> String {
        if acknowledged { return "checkmark.circle.fill" }
        if type == "manual_panic" { return "exclamationmark.triangle.fill" }
        if type.contains("unlock") { return "lock.open.fill" }
        if type.contains("drive") { return "car.fill" }
        return "exclamationmark.triangle"
    }
}
