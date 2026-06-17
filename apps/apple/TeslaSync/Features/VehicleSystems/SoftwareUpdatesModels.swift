//
//  SoftwareUpdatesModels.swift
//  TeslaSync — P4 feature view · P7 · SoftwareUpdates (Apple) — Data Models
//
//  Wire-faithful Swift peers of the web Software Updates contract. Field names
//  and JSON keys mirror web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx
//  (`SoftwareUpdate`) exactly — snake_case on the wire. Types are prefixed
//  `SoftwareUpdates*` (the record is `SoftwareUpdatesItem`) to avoid colliding
//  with the dashboard widget's public `SoftwareUpdate` projection.
//

import Foundation
import SwiftUI

// MARK: - Software update record (web `SoftwareUpdate`)

/// One firmware record from `GET /software-updates`. Mirrors the web
/// `SoftwareUpdate` interface; `installedAt` / `scheduledAt` are nullable
/// (a scheduled-but-not-installed update has only `scheduledAt`). Named
/// `SoftwareUpdatesItem` so it does not clash with the widget's `SoftwareUpdate`.
struct SoftwareUpdatesItem: Codable, Identifiable, Equatable {
    let id: Int64
    let vehicleID: Int64
    let version: String
    let status: String
    let installedAt: Date?
    let scheduledAt: Date?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case vehicleID = "vehicle_id"
        case version
        case status
        case installedAt = "installed_at"
        case scheduledAt = "scheduled_at"
        case createdAt = "created_at"
    }

    /// Web `https://www.notateslaapp.com/software-updates/version/{version}/release-notes`.
    /// The public release-notes deep link opened by the per-row external-link button.
    var releaseNotesURL: URL? {
        let encoded = version.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? version
        return URL(string: "https://www.notateslaapp.com/software-updates/version/\(encoded)/release-notes")
    }
}

// MARK: - Vehicle identity (web `useSelectedVehicle` roster)

/// Minimal vehicle identity for the toolbar selector + timeline labels.
/// Mirrors the web `{ id, display_name, vin }` shape.
struct SoftwareUpdatesVehicle: Codable, Identifiable, Equatable {
    let id: Int64
    let displayName: String
    let vin: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case vin
    }
}

// MARK: - Status presentation (web `STATUS_CONFIG`)

/// Badge tone for an update status (web Badge `success | info | warning | neutral`).
/// Tones resolve to the adaptive design-token status colors (P2; light/dark/contrast).
enum SoftwareUpdateBadgeTone: Equatable {
    case success
    case info
    case warning
    case neutral

    var color: Color {
        switch self {
        case .success: return Color.TS.statusSuccess
        case .info: return Color.TS.statusInfo
        case .warning: return Color.TS.statusWarning
        case .neutral: return Color.TS.textMuted
        }
    }
}

/// Lookup-with-fallback presentation for backend status tokens — the native peer
/// of the web `STATUS_CONFIG` map (`installed` / `installing` / `downloading` /
/// `available` / `scheduled`). Unknown tokens fall back to `available`
/// (web `STATUS_CONFIG[status] ?? STATUS_CONFIG.available`), so a new backend
/// token renders gracefully instead of crashing.
enum SoftwareUpdateStatusDisplay {
    /// Localized badge label (web `STATUS_CONFIG[*].label`, rendered via `t(s.label)`).
    static func label(for status: String) -> String {
        switch status {
        case "installed":
            return String(localized: "Installed", defaultValue: "Installed")
        case "installing":
            return String(localized: "Installing", defaultValue: "Installing")
        case "downloading":
            return String(localized: "Downloading", defaultValue: "Downloading")
        case "scheduled":
            return String(localized: "Scheduled", defaultValue: "Scheduled")
        default:
            return String(localized: "Available", defaultValue: "Available")
        }
    }

    /// Badge tone (web `STATUS_CONFIG[*].badgeVariant`).
    static func tone(for status: String) -> SoftwareUpdateBadgeTone {
        switch status {
        case "installed": return .success
        case "installing", "downloading": return .info
        case "scheduled": return .neutral
        default: return .warning
        }
    }

    /// Leading SF Symbol (web lucide icon: CheckCircle / Download / ArrowUpCircle / Clock).
    static func symbol(for status: String) -> String {
        switch status {
        case "installed": return "checkmark.circle.fill"
        case "installing", "downloading": return "arrow.down.circle.fill"
        case "scheduled": return "clock"
        default: return "arrow.up.circle.fill"
        }
    }
}

// MARK: - Summary metric tone (web `MetricCard` color prop)

/// The three summary-card accent tones (web `color="cyan|green|purple"`),
/// resolved to adaptive design tokens.
enum SoftwareUpdatesMetricTone: Equatable {
    case cyan
    case green
    case purple

    var color: Color {
        switch self {
        case .cyan: return Color.TS.accent
        case .green: return Color.TS.statusSuccess
        case .purple: return Color.TS.chartSeriesPower
        }
    }
}
