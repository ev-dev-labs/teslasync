import Foundation

/// The safe, glanceable actions a user can trigger from the watch. Two are local
/// to the companion (refresh the cache, ask the phone to open the app); the rest
/// are confirmed *vehicle* commands relayed to the iPhone, which runs them through
/// its authenticated command facade and the server-side permission check. The
/// watch never talks to the vehicle directly.
///
/// The vehicle-command `rawValue`s are kept identical to the phone's
/// `VehicleCommandKind` raw values so the phone can reconstruct the command without
/// a second mapping table.
public enum WatchQuickAction: String, Codable, CaseIterable, Sendable, Identifiable {
    /// Re-request the latest cached snapshot from the phone (foreground refresh).
    case refresh
    /// Ask the paired iPhone to open the TeslaSync app.
    case openOnPhone
    /// Wake the vehicle from sleep.
    case wake
    /// Start climate conditioning.
    case climateOn
    /// Lock the doors.
    case lockDoors
    /// Flash the lights to locate the vehicle.
    case flashLights

    public var id: String {
        rawValue
    }

    /// Whether this action actuates the vehicle (vs. a companion-local action).
    public var isVehicleCommand: Bool {
        switch self {
        case .refresh, .openOnPhone: false
        case .wake, .climateOn, .lockDoors, .flashLights: true
        }
    }

    /// Vehicle commands require a valid phone session; local actions never do.
    public var requiresAuthentication: Bool {
        isVehicleCommand
    }

    /// Every vehicle command is confirmed before it is relayed — there is no
    /// fire-and-forget path from the wrist. Local actions need no confirmation.
    public var requiresConfirmation: Bool {
        isVehicleCommand
    }

    /// SF Symbol used on the action button.
    public var systemImage: String {
        switch self {
        case .refresh: "arrow.clockwise"
        case .openOnPhone: "iphone"
        case .wake: "moon.zzz.fill"
        case .climateOn: "fan.fill"
        case .lockDoors: "lock.fill"
        case .flashLights: "headlight.high.beam.fill"
        }
    }

    /// Localization key for the action's short title.
    public var titleKey: String {
        "watch.action.\(rawValue)"
    }

    /// Localization key for the confirmation prompt (vehicle commands only).
    public var confirmKey: String {
        "watch.action.\(rawValue).confirm"
    }

    /// The actions surfaced in the watch action list, in display order.
    public static let menu: [WatchQuickAction] = [
        .refresh, .climateOn, .lockDoors, .flashLights, .wake, .openOnPhone
    ]
}

/// A confirmed request the watch relays to the phone. `id` is an idempotency key so
/// a re-delivered request is never executed twice.
public struct WatchCommandRequest: Codable, Equatable, Sendable {
    public let id: String
    public let action: WatchQuickAction
    public let requestedAt: Date

    public init(id: String = UUID().uuidString, action: WatchQuickAction, requestedAt: Date = Date()) {
        self.id = id
        self.action = action
        self.requestedAt = requestedAt
    }
}

/// The result the phone returns for a relayed command. `outcomeKey` is a
/// localization key (mirroring the phone's `VehicleCommandOutcome.messageKey`),
/// never a raw server message, so nothing sensitive crosses the link.
public struct WatchCommandResult: Codable, Equatable, Sendable {
    public let requestID: String
    public let success: Bool
    public let outcomeKey: String

    public init(requestID: String, success: Bool, outcomeKey: String) {
        self.requestID = requestID
        self.success = success
        self.outcomeKey = outcomeKey
    }
}
