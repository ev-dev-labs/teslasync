import SwiftUI

/// The notification categories TeslaSync pushes, each mapped to the deep-link
/// `AppRoute` its tap should open (web `App.tsx` route groups). The raw value is
/// the stable wire identifier the backend sets on `aps.category`; `identifier`
/// adds the reverse-DNS prefix used when registering `UNNotificationCategory`s.
public enum PushCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case alert
    case charging
    case command
    case automation
    case security
    case trip
    case generic

    public var id: String {
        rawValue
    }

    /// The route a tap on this category's notification deep-links to.
    public var route: AppRoute {
        switch self {
        case .alert: .notifications
        case .charging: .charging
        case .command: .vehicles
        case .automation: .automations
        case .security: .vehicleSystems
        case .trip: .trips
        case .generic: .dashboard
        }
    }

    /// The reverse-DNS `UNNotificationCategory` identifier registered at launch and
    /// matched against `aps.category`.
    public var identifier: String {
        "io.teslasync." + rawValue
    }

    public var titleKey: LocalizedStringKey {
        LocalizedStringKey("push.category." + rawValue)
    }

    public var systemImage: String {
        switch self {
        case .alert: "bell.badge.fill"
        case .charging: "bolt.fill"
        case .command: "terminal.fill"
        case .automation: "wand.and.stars"
        case .security: "lock.shield.fill"
        case .trip: "map.fill"
        case .generic: "app.badge.fill"
        }
    }

    /// Resolves a server category string into a known category, tolerating the
    /// reverse-DNS id form and common aliases; unknown values fall back to
    /// `.generic` so an unrecognised push still routes somewhere sensible.
    public static func parse(_ raw: String?) -> PushCategory {
        guard let lowered = raw?.lowercased(), !lowered.isEmpty else { return .generic }
        let prefix = "io.teslasync."
        let trimmed = lowered.hasPrefix(prefix) ? String(lowered.dropFirst(prefix.count)) : lowered
        return PushCategory(rawValue: trimmed) ?? aliases[trimmed] ?? .generic
    }

    static let aliases: [String: PushCategory] = [
        "alerts": .alert,
        "notification": .alert,
        "notifications": .alert,
        "charge": .charging,
        "charge_complete": .charging,
        "command_result": .command,
        "commands": .command,
        "automations": .automation,
        "security_event": .security,
        "sentry": .security,
        "drive": .trip,
        "trips": .trip
    ]
}
