import AppIntents
import Foundation

/// The safe set of vehicle commands TeslaSync can start from App Intents,
/// Shortcuts, Siri, and the macOS Commands menu.
///
/// Each case is an actuation that the backend must authorize per-user ("where
/// backend permissions allow"), so every one is gated by `VehicleCommandGate`
/// (auth + permission) and confirmed before it runs. The enum is the single
/// source of truth for the command's display title, glyph, confirmation weight,
/// and whether it is surfaced as a top-level App Shortcut phrase.
public enum VehicleCommandKind: String, CaseIterable, Codable, Sendable {
    case wake
    case climateOn
    case climateOff
    case lockDoors
    case unlockDoors
    case startCharging
    case stopCharging
    case flashLights
    case honkHorn
    case ventWindows
    case closeWindows
    case openChargePort
    case closeChargePort

    /// SF Symbol used in menus, Shortcuts, and confirmation snippets.
    public var systemImage: String {
        switch self {
        case .wake: "moon.zzz.fill"
        case .climateOn: "fan.fill"
        case .climateOff: "fan.slash.fill"
        case .lockDoors: "lock.fill"
        case .unlockDoors: "lock.open.fill"
        case .startCharging: "bolt.fill"
        case .stopCharging: "bolt.slash.fill"
        case .flashLights: "headlight.high.beam.fill"
        case .honkHorn: "speaker.wave.2.fill"
        case .ventWindows: "wind"
        case .closeWindows: "windshield.front.and.wiper"
        case .openChargePort: "powerplug.fill"
        case .closeChargePort: "powerplug"
        }
    }

    /// A localized title resource (keys defined in `Localizable.xcstrings`).
    public var titleResource: LocalizedStringResource {
        LocalizedStringResource("intent.command.\(rawValue)")
    }

    /// A localized confirmation prompt shown before the command runs.
    public var confirmationPromptResource: LocalizedStringResource {
        LocalizedStringResource("intent.command.\(rawValue).confirm")
    }

    /// Security/exposure-sensitive commands (unlock, opening windows or the charge
    /// port) get an emphasized confirmation. Every command still confirms.
    public var isSensitive: Bool {
        switch self {
        case .unlockDoors, .ventWindows, .openChargePort: true
        case .wake, .climateOn, .climateOff, .lockDoors, .startCharging,
             .stopCharging, .flashLights, .honkHorn, .closeWindows, .closeChargePort: false
        }
    }

    /// The spec mandates confirmation for every actuation — there is no
    /// fire-and-forget command path.
    public var requiresConfirmation: Bool {
        true
    }

    /// The common commands surfaced as standalone App Shortcut phrases. Kept small
    /// and unambiguous so Siri disambiguation stays reliable.
    public static let commonShortcutCommands: [VehicleCommandKind] = [
        .wake, .climateOn, .climateOff, .lockDoors, .startCharging, .stopCharging, .flashLights
    ]
}

extension VehicleCommandKind: AppEnum {
    public static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "intent.command.typeName")
    }

    public static var caseDisplayRepresentations: [VehicleCommandKind: DisplayRepresentation] {
        var map: [VehicleCommandKind: DisplayRepresentation] = [:]
        for kind in allCases {
            map[kind] = DisplayRepresentation(
                title: kind.titleResource,
                image: .init(systemName: kind.systemImage)
            )
        }
        return map
    }
}
