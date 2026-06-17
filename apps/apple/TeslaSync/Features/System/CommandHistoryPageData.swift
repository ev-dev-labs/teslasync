//
//  CommandHistoryPageData.swift
//  TeslaSync — P4 feature view · P7 · system/CommandHistory (Apple) — Formatters & Sample
//
//  Pure display-boundary formatters ported from `CommandHistoryPage.tsx`
//  (`COMMAND_LABELS` / `formatCommandName` / `buildSubtitle`) plus the date helpers from
//  `web/src/lib/dateFormat.ts`, and the representative sample data source the page/preview
//  use until the KMP-backed source is injected. No SI conversion applies — these are
//  unit-agnostic control-plane values.
//

import Foundation
import SwiftUI

// MARK: - Display formatters (web `formatCommandName` / `buildSubtitle` / `formatRelative`)

/// Pure, testable formatters for the command-log surface. Mirrors the web helpers 1:1 so
/// the rendered copy matches the React page.
public enum CommandHistoryFormat {
    /// The em-dash shown for absent stat values (web `'—'`).
    public static let emptyValue = "—"

    /// Human labels for known command identifiers (web `COMMAND_LABELS`).
    public static let commandLabels: [String: String] = [
        "lock": "Lock", "unlock": "Unlock", "wake_up": "Wake Up",
        "climate_on": "Climate ON", "climate_off": "Climate OFF",
        "honk_horn": "Honk Horn", "flash_lights": "Flash Lights",
        "charge_start": "Start Charging", "charge_stop": "Stop Charging",
        "set_charge_limit": "Set Charge Limit", "set_temps": "Set Temperature",
        "actuate_trunk": "Open/Close Trunk", "actuate_frunk": "Open Frunk",
        "window_control": "Window Control", "sun_roof_control": "Sunroof Control",
        "remote_start_drive": "Remote Start", "set_sentry_mode": "Sentry Mode",
        "set_speed_limit": "Speed Limit", "clear_speed_limit": "Clear Speed Limit",
        "set_valet_mode": "Valet Mode", "reset_valet_pin": "Reset Valet PIN",
        "schedule_software_update": "Schedule Update",
        "cancel_software_update": "Cancel Update",
        "media_toggle_playback": "Media Play/Pause", "media_next_track": "Next Track",
        "media_prev_track": "Previous Track", "media_volume_up": "Volume Up",
        "media_volume_down": "Volume Down", "adjust_volume": "Adjust Volume",
        "navigation_request": "Navigate", "share": "Share to Vehicle",
        "trigger_homelink": "Trigger HomeLink", "set_bioweapon_mode": "Bioweapon Defense",
        "set_climate_keeper": "Climate Keeper", "set_cop_temp": "Cabin Overheat Protection",
        "dog_mode_on": "Dog Mode ON", "dog_mode_off": "Dog Mode OFF",
        "camp_mode_on": "Camp Mode ON", "camp_mode_off": "Camp Mode OFF",
        "set_scheduled_departure": "Scheduled Departure",
        "set_scheduled_charging": "Scheduled Charging",
        "set_preconditioning_max": "Max Preconditioning",
        "auto_conditioning_start": "Start Preconditioning",
        "auto_conditioning_stop": "Stop Preconditioning",
        "remote_seat_heater_request": "Seat Heater",
        "remote_seat_cooler_request": "Seat Cooler",
        "remote_steering_wheel_heater_request": "Steering Wheel Heater",
        "close_charge_port": "Close Charge Port", "open_charge_port": "Open Charge Port",
        "set_pin_to_drive": "PIN to Drive"
    ]

    /// Web `formatCommandName`: known label, else Title-Cased snake_case.
    public static func commandName(_ command: String) -> String {
        if let label = commandLabels[command] { return label }
        return command
            .split(separator: "_")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    /// Web `buildSubtitle`: params summary · error · falls back to the formatted timestamp.
    public static func subtitle(for entry: CommandLogEntry) -> String {
        var parts: [String] = []

        let params = entry.params
        if !params.isEmpty, params != "{}" {
            if let data = params.data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               !object.isEmpty {
                parts.append(
                    object.sorted { $0.key < $1.key }
                        .map { "\($0.key): \(stringify($0.value))" }
                        .joined(separator: ", ")
                )
            } else {
                parts.append(params)
            }
        }

        if !entry.error.isEmpty { parts.append("Error: \(entry.error)") }
        if parts.isEmpty { parts.append(dateTime(entry.createdAt)) }
        return parts.joined(separator: " · ")
    }

    /// Web `formatRelative(date, { tz: 'UTC' })` — abbreviated relative time.
    public static func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    /// Web `formatDateTime(date, { tz: 'UTC' })` — short date + time, UTC.
    public static func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "MMM d, yyyy, HH:mm"
        return formatter.string(from: date)
    }

    /// Web `commandHistory.showing` count template, key-stable (renders "N commands").
    public static func showing(count: Int) -> String {
        let template = String(localized: "commandHistory.showing", defaultValue: "%lld commands")
        return String(format: template, count)
    }

    private static func stringify(_ value: Any) -> String {
        switch value {
        case let bool as Bool: bool ? "true" : "false"
        case let int as Int: String(int)
        case let number as NSNumber: number.stringValue
        case let string as String: string
        default: "\(value)"
        }
    }
}

// MARK: - Sample data source (representative seed; replaced by the KMP adapter in prod)

/// A representative local seed used as the page/preview default until the KMP-backed source
/// is injected at composition time. It is NOT production telemetry — it exists so the
/// surface renders its populated state out of the box (mirroring `SampleVehicleCostDataSource`).
public struct SampleCommandHistoryDataSource: CommandHistoryDataSource {
    public init() {}

    public func vehicles() async throws -> [CommandHistoryVehicle] {
        [
            CommandHistoryVehicle(id: 1, displayName: "Model 3 Performance"),
            CommandHistoryVehicle(id: 2, displayName: "Model Y Long Range")
        ]
    }

    public func commandHistory(vehicleID: Int64, limit: Int) async throws -> [CommandLogEntry] {
        let now = Date()
        var entries: [CommandLogEntry] = []
        for (offset, spec) in Self.seed.enumerated() {
            entries.append(
                CommandLogEntry(
                    id: Int64(1000 - offset),
                    vehicleID: vehicleID,
                    command: spec.command,
                    params: spec.params,
                    status: spec.failed ? "failed" : "success",
                    error: spec.failed ? "vehicle_unavailable: asleep" : "",
                    createdAt: now.addingTimeInterval(-Double(offset) * spec.minutesGap * 60)
                )
            )
        }
        return Array(entries.prefix(limit))
    }

    private struct Seed {
        let command: String
        let params: String
        let failed: Bool
        let minutesGap: Double
    }

    private struct Template {
        let command: String
        let params: String
        let canFail: Bool
    }

    private static let templates: [Template] = [
        Template(command: "wake_up", params: "{}", canFail: false),
        Template(command: "climate_on", params: "{}", canFail: false),
        Template(command: "set_temps", params: "{\"driver_temp\": 21}", canFail: false),
        Template(command: "lock", params: "{}", canFail: false),
        Template(command: "charge_start", params: "{}", canFail: false),
        Template(command: "set_charge_limit", params: "{\"percent\": 80}", canFail: false),
        Template(command: "flash_lights", params: "{}", canFail: false),
        Template(command: "honk_horn", params: "{}", canFail: true),
        Template(command: "unlock", params: "{}", canFail: false),
        Template(command: "actuate_trunk", params: "{\"which_trunk\": \"rear\"}", canFail: false),
        Template(command: "set_sentry_mode", params: "{\"on\": true}", canFail: false),
        Template(command: "charge_stop", params: "{}", canFail: false),
        Template(command: "media_toggle_playback", params: "{}", canFail: false),
        Template(command: "remote_start_drive", params: "{}", canFail: true)
    ]

    private static let seed: [Seed] = {
        var seeds: [Seed] = []
        for index in 0 ..< 42 {
            let template = templates[index % templates.count]
            seeds.append(
                Seed(
                    command: template.command,
                    params: template.params,
                    failed: template.canFail && index % 3 == 0,
                    minutesGap: Double(35 + (index % 7) * 18)
                )
            )
        }
        return seeds
    }()
}
