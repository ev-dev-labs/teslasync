//
//  CommandQuickActionsWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0030 · CommandQuickActionsWidget (Apple)
//
//  Pure (Foundation-only) projection for the Quick Actions surface: the canonical
//  command catalog (parity with the web `COMMANDS` array), the size → layout ladder
//  (web `isCompact` / `isWide`), the view-ready item builder, the success/failure
//  feedback resolver (web `useVehicleCommand` toast), and the VoiceOver copy.
//
//  Deliberately free of SwiftUI so the catalog + layout + feedback logic can be
//  compiled and executed on a plain host and pinned by unit tests. Tones carry their
//  exact web hex as `rgb` components; the view resolves them to a `Color`.
//

import Foundation

// MARK: - sRGB components (web hex → 0…1)

/// The sRGB components (0…1) of a tone's web hex. A small value type rather than a
/// 3-member tuple so it stays `Equatable` for the catalog tests and satisfies the
/// linter's tuple-arity rule; the view feeds it straight into `Color(.sRGB,…)`.
public struct CommandQuickActionsRGB: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }
}

// MARK: - Accent tone (web per-command Tailwind/neon color)

/// The accent tone of a command button — the native port of the web per-command
/// `color` class (`text-neon-green`, `text-blue-400`, …). Each case carries the
/// exact web hex as `sRGB` components so the grid reads identically on both apps; a
/// dynamic, per-item palette value (not a static semantic token), resolved to a
/// concrete `Color` in the view.
public enum CommandQuickActionsTone: String, Equatable, Sendable, CaseIterable {
    case green
    case red
    case cyan
    case blue
    case purple
    case amber
    case yellow
    case indigo

    /// The exact web hex (Tailwind/neon) this tone reproduces.
    public var hex: String {
        switch self {
        case .green: "#10b981" // neon-green
        case .red: "#ef4444" // neon-red
        case .cyan: "#00f0ff" // neon-cyan
        case .blue: "#60a5fa" // blue-400
        case .purple: "#c084fc" // purple-400
        case .amber: "#fbbf24" // amber-400
        case .yellow: "#facc15" // yellow-400
        case .indigo: "#818cf8" // indigo-400
        }
    }

    /// The sRGB components of `hex`, in 0…1 — consumed by the view's `Color(.sRGB,…)`
    /// and pinned by the catalog tests so the palette never drifts from the web.
    public var rgb: CommandQuickActionsRGB {
        switch self {
        case .green: CommandQuickActionsRGB(red: 0.063, green: 0.725, blue: 0.506)
        case .red: CommandQuickActionsRGB(red: 0.937, green: 0.267, blue: 0.267)
        case .cyan: CommandQuickActionsRGB(red: 0.000, green: 0.941, blue: 1.000)
        case .blue: CommandQuickActionsRGB(red: 0.376, green: 0.647, blue: 0.980)
        case .purple: CommandQuickActionsRGB(red: 0.753, green: 0.518, blue: 0.988)
        case .amber: CommandQuickActionsRGB(red: 0.984, green: 0.749, blue: 0.141)
        case .yellow: CommandQuickActionsRGB(red: 0.980, green: 0.800, blue: 0.082)
        case .indigo: CommandQuickActionsRGB(red: 0.506, green: 0.549, blue: 0.973)
        }
    }
}

// MARK: - Command catalog (web `COMMANDS`)

/// One quick-action command — the native port of a web `COMMANDS` entry. Carries the
/// stable web `id` (the enum rawValue), the API `command` string sent to
/// `POST /vehicles/{id}/command`, the web i18n key + English fallback, the SF Symbol
/// (closest HIG metaphor to the web lucide icon), and the accent tone (web color).
public enum CommandQuickAction: String, CaseIterable, Sendable, Identifiable, Equatable {
    case lock
    case unlock
    case climateOn = "climate_on"
    case climateOff = "climate_off"
    case frunk
    case honk
    case flash
    case trunk

    public var id: String {
        rawValue
    }

    /// The API command string (web `COMMANDS[].command`). Distinct from `id` for the
    /// actuate/horn/lights commands (web `actuate_frunk`, `honk_horn`, `flash_lights`,
    /// `actuate_trunk`).
    public var command: String {
        switch self {
        case .lock: "lock"
        case .unlock: "unlock"
        case .climateOn: "climate_on"
        case .climateOff: "climate_off"
        case .frunk: "actuate_frunk"
        case .honk: "honk_horn"
        case .flash: "flash_lights"
        case .trunk: "actuate_trunk"
        }
    }

    /// Web `t(labelKey, labelFallback)` key (web `COMMANDS[].labelKey`).
    public var labelKey: String {
        switch self {
        case .lock: "widget.quickActions.lock"
        case .unlock: "widget.quickActions.unlock"
        case .climateOn: "widget.quickActions.climateOn"
        case .climateOff: "widget.quickActions.climateOff"
        case .frunk: "widget.quickActions.frunk"
        case .honk: "widget.quickActions.horn"
        case .flash: "widget.quickActions.flash"
        case .trunk: "widget.quickActions.trunk"
        }
    }

    /// English fallback for the label (web `COMMANDS[].labelFallback`).
    public var labelFallback: String {
        switch self {
        case .lock: "Lock"
        case .unlock: "Unlock"
        case .climateOn: "Climate On"
        case .climateOff: "Climate Off"
        case .frunk: "Frunk"
        case .honk: "Horn"
        case .flash: "Flash"
        case .trunk: "Trunk"
        }
    }

    /// SF Symbol mapped from the web lucide icon, chosen for the closest HIG metaphor
    /// on iOS 18 / macOS 15 (web Lock / Unlock / Thermometer / ThermometerSnowflake /
    /// Container / Volume2 / Flashlight / Container).
    public var systemImage: String {
        switch self {
        case .lock: "lock.fill"
        case .unlock: "lock.open.fill"
        case .climateOn: "thermometer.sun.fill"
        case .climateOff: "thermometer.snowflake"
        case .frunk: "shippingbox.fill"
        case .honk: "speaker.wave.2.fill"
        case .flash: "flashlight.on.fill"
        case .trunk: "car.rear.fill"
        }
    }

    /// The accent tone (web `COMMANDS[].color`).
    public var tone: CommandQuickActionsTone {
        switch self {
        case .lock: .green
        case .unlock: .red
        case .climateOn: .cyan
        case .climateOff: .blue
        case .frunk: .purple
        case .honk: .amber
        case .flash: .yellow
        case .trunk: .indigo
        }
    }
}

/// The canonical command catalog, in web `COMMANDS` order. The dashboard registry
/// enumerates the surface, not the commands.
public enum CommandQuickActionsCatalog {
    /// All eight commands in the stable web order.
    public static let all: [CommandQuickAction] = CommandQuickAction.allCases

    /// The commands shown for a given layout — the web size-based slice
    /// (`isCompact ? slice(0,4) : isWide ? all : slice(0,6)`).
    public static func visible(for layout: CommandQuickActionsLayout) -> [CommandQuickAction] {
        Array(all.prefix(layout.visibleCount))
    }
}

// MARK: - Layout (web `isCompact` / `isWide`)

/// The widget's render layout, resolved from its grid footprint exactly as the web
/// source does (`isCompact = cols <= 1 && rows <= 1`, `isWide = cols >= 3`). Pure +
/// testable; the registry's `minSize` of 1×2 means the live dashboard never resolves
/// to `.compact`, but the full ladder is implemented for parity with the web source.
public enum CommandQuickActionsLayout: Equatable {
    case compact
    case standard
    case wide

    public static func resolve(_ size: DashboardWidgetSize) -> CommandQuickActionsLayout {
        if size.cols <= 1, size.rows <= 1 { return .compact }
        if size.cols >= 3 { return .wide }
        return .standard
    }

    /// The grid column count (web `grid-cols-2` compact / `@xs:grid-cols-3` standard /
    /// `@xs:grid-cols-4` wide).
    public var columns: Int {
        switch self {
        case .compact: 2
        case .standard: 3
        case .wide: 4
        }
    }

    /// How many commands the layout shows (web slice: 4 / 6 / 8).
    public var visibleCount: Int {
        switch self {
        case .compact: 4
        case .standard: 6
        case .wide: 8
        }
    }

    /// Whether button labels render (web hides them when `isCompact`).
    public var showsLabels: Bool {
        self != .compact
    }

    /// Whether the header title/icon render (web passes `undefined` when `isCompact`).
    public var showsHeader: Bool {
        self != .compact
    }
}

// MARK: - View-ready item projection (web mapped `COMMANDS` row)

/// A fully-resolved, view-ready command button: the localized label, the SF Symbol +
/// accent tone, the API command string, and the pre-built VoiceOver label/hint — so
/// the view holds no formatting or localization logic.
public struct CommandQuickActionItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let command: String
    public let label: String
    public let systemImage: String
    public let tone: CommandQuickActionsTone
    public let accessibilityLabel: String
    public let accessibilityHint: String

    public init(
        action: CommandQuickAction,
        label: String,
        accessibilityLabel: String,
        accessibilityHint: String
    ) {
        id = action.id
        command = action.command
        self.label = label
        systemImage = action.systemImage
        tone = action.tone
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
    }
}

/// Projects commands into localized, view-ready items. Mirrors the web
/// `visibleCommands.map(...)` render: it resolves each label through the injected
/// localizer (so it is bundle-free in tests) and pre-builds the a11y copy.
public enum CommandQuickActionItemBuilder {
    public static func build(
        actions: [CommandQuickAction] = CommandQuickActionsCatalog.all,
        localize: (String, String) -> String
    ) -> [CommandQuickActionItem] {
        actions.map { action in
            let label = localize(action.labelKey, action.labelFallback)
            return CommandQuickActionItem(
                action: action,
                label: label,
                accessibilityLabel: label,
                accessibilityHint: CommandQuickActionsAccessibility.buttonHint(label: label, localize: localize)
            )
        }
    }
}

// MARK: - Command feedback (web `useVehicleCommand` success/error toast)

/// Resolves the success/failure outcome of a dispatched command, mirroring the web
/// `onSuccess` / `onError` toast text: the server message wins when present, else the
/// localized default (`Command sent successfully` / `Command failed`). Pure + testable.
public enum CommandFeedback {
    public static func outcome(command: String, result: CommandDispatchResult) -> CommandDispatchOutcome {
        CommandDispatchOutcome(command: command, success: result.success, message: message(for: result))
    }

    /// `data.message || 'Command sent successfully'` / `data.message || 'Command failed'`.
    public static func message(for result: CommandDispatchResult) -> String {
        let trimmed = result.message.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        return result.success
            ? CommandQuickActionsStrings.string("widget.quickActions.commandSent", "Command sent successfully")
            : CommandQuickActionsStrings.string("widget.quickActions.commandFailed", "Command failed")
    }
}

// MARK: - Accessibility copy (testable seam)

/// Builds the VoiceOver label/hint/announcement copy. Pure + public so the spoken
/// content can be unit-tested without rendering the view.
public enum CommandQuickActionsAccessibility {
    /// A command button's spoken hint: "Sends the <label> command".
    public static func buttonHint(label: String, localize: (String, String) -> String) -> String {
        String(format: localize("widget.quickActions.actionHint", "Sends the %@ command"), label)
    }

    /// The spoken label while a command is in flight: "Sending <label>…".
    public static func runningLabel(label: String, localize: (String, String) -> String) -> String {
        String(format: localize("widget.quickActions.sending", "Sending %@…"), label)
    }

    /// The announcement spoken when a dispatch settles — the success/failure message.
    public static func outcomeAnnouncement(_ outcome: CommandDispatchOutcome) -> String {
        outcome.message
    }
}
