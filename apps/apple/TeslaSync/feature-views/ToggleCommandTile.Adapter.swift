//
//  ToggleCommandTile.Adapter.swift
//  TeslaSync — P4 feature view · 0260 · ToggleCommandTile (Apple)
//
//  The testable projection core for the Vehicle-Commands toggle tile — the SwiftUI
//  parity of features/system/components/ToggleCommandTile.tsx. Holds the toggle
//  command definition the tile renders (web `def: CommandDef`, narrowed to the fields
//  the toggle uses), the command parameters value, the variant→tone map (web
//  `onStyles[variant]`), the on/off power label (web `t('commands.on'/'commands.off')`),
//  the active-tone styling rule (web `isOn ? styles : neutral`), the last-status outcome
//  projection (web `lastStatus.startsWith('✓')`), the render phase (idle / executing /
//  result), the freshness chip projection, and the VoiceOver builders (web `aria-label`).
//  All pure + dependency-free so the projections can be unit-tested without a seam, a
//  bundle, or a rendered view.
//

import Foundation

// MARK: - Command parameters (web `def.params?: Record<string, unknown>`)

/// A single command parameter value. Models the closed set of JSON scalars Tesla
/// command params carry so the payload stays `Sendable` + `Equatable` (no `Any`).
public enum ToggleCommandParameterValue: Equatable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
}

/// The opaque parameter bag forwarded to the dispatch seam on the on-command (web
/// `onExecute(def.command, def.params)`). The tile never inspects it — it carries the
/// bag straight through to `execute`. The off-command sends no params (web
/// `onExecute(def.commandOff!)`).
public struct ToggleCommandParameters: Equatable, Sendable {
    public let values: [String: ToggleCommandParameterValue]

    public init(_ values: [String: ToggleCommandParameterValue] = [:]) {
        self.values = values
    }

    public var isEmpty: Bool {
        values.isEmpty
    }
}

// MARK: - Variant (web `def.variant` → `onStyles[variant]`)

/// The toggle emphasis. Web maps it to the active (on) panel/icon/dot/text tint; the
/// native tile uses the same tone for the same active chrome.
public enum ToggleCommandTileVariant: String, Sendable, Equatable, CaseIterable {
    case `default`
    case danger
    case success

    /// The semantic tone for the variant when the toggle is on (web
    /// `onStyles.{default→cyan|danger→red|success→green}`).
    public var tone: TSTone {
        switch self {
        case .default: .accent
        case .danger: .danger
        case .success: .success
        }
    }
}

// MARK: - Command definition (web `CommandDef`, narrowed to the toggle's fields)

/// The toggle command the tile renders. A narrowed projection of the web `CommandDef`
/// to exactly the fields a toggle consumes: identity, the on/off commands (web
/// `command` / `commandOff`), the label i18n pair, the on/off SF Symbols (web `icon` /
/// `iconOff`), the variant, the bound state field (web `stateField`), whether turning
/// on opens an input dialog first (web `inputConfig != null`), and the opaque params
/// forwarded on the on-command.
public struct ToggleCommandTileDef: Equatable, Sendable {
    public let id: String
    public let command: String
    public let commandOff: String?
    public let labelKey: String
    public let labelFallback: String
    public let systemImageOn: String
    public let systemImageOff: String?
    public let variant: ToggleCommandTileVariant
    public let stateField: String?
    public let requiresInput: Bool
    public let parameters: ToggleCommandParameters?

    public init(
        id: String,
        command: String,
        commandOff: String? = nil,
        labelKey: String,
        labelFallback: String,
        systemImageOn: String,
        systemImageOff: String? = nil,
        variant: ToggleCommandTileVariant = .default,
        stateField: String? = nil,
        requiresInput: Bool = false,
        parameters: ToggleCommandParameters? = nil
    ) {
        self.id = id
        self.command = command
        self.commandOff = commandOff
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.systemImageOn = systemImageOn
        self.systemImageOff = systemImageOff
        self.variant = variant
        self.stateField = stateField
        self.requiresInput = requiresInput
        self.parameters = parameters
    }

    /// Whether the tile reflects a live vehicle-state boolean (web `def.stateField`).
    /// When absent the tile falls back to a local optimistic toggle.
    public var hasStateBinding: Bool {
        guard let stateField else { return false }
        return !stateField.isEmpty
    }

    /// The SF Symbol for the current power state (web `isOn ? def.icon : def.iconOff ??
    /// def.icon`). The off symbol falls back to the on symbol when none is supplied.
    public func systemImage(isOn: Bool) -> String {
        isOn ? systemImageOn : (systemImageOff ?? systemImageOn)
    }
}

// MARK: - Power label (web `isOn ? t('commands.on','ON') : t('commands.off','OFF')`)

/// The on/off power state the tile labels. Carries the verbatim web i18n key + English
/// fallback so the label resolves identically across web and native.
public enum ToggleCommandPower: Equatable, Sendable {
    case on
    case off

    public static func from(isOn: Bool) -> ToggleCommandPower {
        isOn ? .on : .off
    }

    /// The i18n key for the label (web `commands.on` / `commands.off`).
    public var labelKey: String {
        switch self {
        case .on: "commands.on"
        case .off: "commands.off"
        }
    }

    /// The English fallback (web `'ON'` / `'OFF'`).
    public var labelFallback: String {
        switch self {
        case .on: "ON"
        case .off: "OFF"
        }
    }
}

// MARK: - Active-tone styling (web `isOn ? onStyles[variant] : neutral`)

/// The tile's chrome tint rule. When the toggle is on, the panel border/fill, icon box,
/// status dot, and power label all take the variant tone (web `onStyles[variant]`); when
/// off they fall to the neutral glass surface (web `bg-[var(--surface-2)]` / muted text).
public enum ToggleCommandTileStyle {
    /// The active tone when on, or `nil` when off (neutral surface).
    public static func activeTone(isOn: Bool, variant: ToggleCommandTileVariant) -> TSTone? {
        isOn ? variant.tone : nil
    }
}

// MARK: - Last-status outcome (web `lastStatus` + `startsWith('✓')`)

/// The settled outcome of the last command send, projected from the web `lastStatus`
/// string. Web colors it green when it starts with `✓`, red otherwise; the native tile
/// maps that to a tone + an SF Symbol and keeps the human-readable detail.
public enum ToggleCommandOutcome: Equatable, Sendable {
    case succeeded(detail: String?)
    case failed(detail: String?)

    /// The success marker the web checks for (`lastStatus.startsWith('✓')`).
    public static let successMarker: Character = "✓"
    private static let failureMarkers: Set<Character> = ["✗", "×", "✕", "⚠"]

    /// Projects the web `lastStatus` string. `nil`/blank → no outcome (web hides the
    /// status line). A leading status glyph is stripped so the native tile can render
    /// its own SF Symbol while preserving the message text.
    public static func parse(_ lastStatus: String?) -> ToggleCommandOutcome? {
        guard let raw = lastStatus?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        let succeeded = raw.first == successMarker
        let detail = stripMarker(raw)
        return succeeded ? .succeeded(detail: detail) : .failed(detail: detail)
    }

    private static func stripMarker(_ raw: String) -> String? {
        var text = raw
        if let first = text.first, first == successMarker || failureMarkers.contains(first) {
            text.removeFirst()
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// The tone the status line renders in (web green / red).
    public var tone: TSTone {
        switch self {
        case .succeeded: .success
        case .failed: .danger
        }
    }

    /// The SF Symbol for the outcome (native replacement for the inline `✓` glyph).
    public var systemImage: String {
        switch self {
        case .succeeded: "checkmark.circle.fill"
        case .failed: "exclamationmark.circle.fill"
        }
    }

    /// The human-readable detail, if any (the message minus the leading glyph).
    public var detail: String? {
        switch self {
        case let .succeeded(detail), let .failed(detail): detail
        }
    }
}

// MARK: - Render phase (web `loading` + `lastStatus` → what the tile shows)

/// What the tile's icon/status region shows, projected from the execution flag and the
/// last outcome. `idle` is the resting tile (icon + label + power, never blank).
public enum ToggleCommandTilePhase: Equatable, Sendable {
    case idle
    case executing
    case result(ToggleCommandOutcome)

    /// Executing wins (web spinner + dimmed); else a settled outcome; else idle.
    public static func project(isExecuting: Bool, outcome: ToggleCommandOutcome?) -> ToggleCommandTilePhase {
        if isExecuting { return .executing }
        if let outcome { return .result(outcome) }
        return .idle
    }
}

// MARK: - Freshness / connectivity (mirrors LiveConnectionState, ADR-013)

/// Live-state freshness for the last outcome, layered on top of the phase so the tile
/// can surface a stale/offline chip (native chrome over the controlled web prop).
public enum ToggleCommandConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness chip shown when the last outcome is stale or the tile is offline.
public struct ToggleCommandConnectionChip: Equatable {
    public let tone: TSTone
    public let labelKey: String
    public let labelFallback: String
    public let systemImage: String

    public init(tone: TSTone, labelKey: String, labelFallback: String, systemImage: String) {
        self.tone = tone
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.systemImage = systemImage
    }

    /// The chip for a connection state, or `nil` when live (no chip rendered).
    public static func project(_ connection: ToggleCommandConnection) -> ToggleCommandConnectionChip? {
        switch connection {
        case .live:
            nil
        case .stale:
            ToggleCommandConnectionChip(
                tone: .warning,
                labelKey: "commands.tile.freshness.stale",
                labelFallback: "Stale",
                systemImage: "clock.arrow.circlepath"
            )
        case .offline:
            ToggleCommandConnectionChip(
                tone: .neutral,
                labelKey: "commands.tile.freshness.offline",
                labelFallback: "Offline",
                systemImage: "wifi.slash"
            )
        }
    }
}

// MARK: - Accessibility builders (testable seam)

/// Builds the VoiceOver strings for the toggle tile. Pure + public so the spoken content
/// can be unit-tested without rendering the view.
public enum ToggleCommandTileAccessibility {
    /// The favorite toggle's spoken label (web `aria-label={t('commands.toggleFavorite')}`).
    public static func favoriteLabel(localize: (String, String) -> String) -> String {
        localize("commands.toggleFavorite", "Toggle favorite")
    }

    /// The tile's spoken value — the current power state (web `ON` / `OFF`).
    public static func powerValue(isOn: Bool, localize: (String, String) -> String) -> String {
        isOn
            ? localize("commands.toggleTile.state.on", "On")
            : localize("commands.toggleTile.state.off", "Off")
    }

    /// The tile's spoken hint, reflecting what a tap does: turn off (when on), open the
    /// options dialog (when off + input-gated), or turn on (when off). Pure projection so
    /// it can be asserted without a view.
    public static func activationHint(
        isOn: Bool,
        requiresInput: Bool,
        localize: (String, String) -> String
    ) -> String {
        if isOn {
            return localize("commands.toggleTile.hint.turnOff", "Turns the command off")
        }
        if requiresInput {
            return localize("commands.toggleTile.hint.configure", "Opens options before turning on")
        }
        return localize("commands.toggleTile.hint.turnOn", "Turns the command on")
    }

    /// The stable automation identifier (web `data-testid` analogue).
    public static func testID(commandID: String) -> String {
        "toggle-command-tile-\(commandID)"
    }

    /// The favorite control's automation identifier.
    public static func favoriteTestID(commandID: String) -> String {
        "toggle-command-tile-favorite-\(commandID)"
    }
}
