//
//  CommandTile.Adapter.swift
//  TeslaSync — P4 feature view · 0226 · CommandTile (Apple)
//
//  The testable projection core for the Vehicle-Commands tile — the SwiftUI parity
//  of features/system/components/CommandTile.tsx. Holds the command definition the
//  tile renders (web `def: CommandDef`, narrowed to the fields the tile uses), the
//  command parameters value, the variant→tone map (web `hoverStyles[variant]`), the
//  last-status outcome projection (web `lastStatus.startsWith('✓')`), the render
//  phase (idle / executing / result), the freshness chip projection, and the
//  VoiceOver builders (web `aria-label`). All pure + dependency-free so the
//  projections can be unit-tested without a seam, a bundle, or a rendered view.
//

import Foundation

// MARK: - Command parameters (web `def.params?: Record<string, unknown>`)

/// A single command parameter value. Models the closed set of JSON scalars Tesla
/// command params carry so the payload stays `Sendable` + `Equatable` (no `Any`).
public enum CommandParameterValue: Equatable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
}

/// The opaque parameter bag forwarded to the dispatch seam (web `def.params`). The
/// tile never inspects it — it carries the bag straight through to `execute`.
public struct CommandParameters: Equatable, Sendable {
    public let values: [String: CommandParameterValue]

    public init(_ values: [String: CommandParameterValue] = [:]) {
        self.values = values
    }

    public var isEmpty: Bool {
        values.isEmpty
    }
}

// MARK: - Variant (web `def.variant` → `hoverStyles[variant]`)

/// The tile emphasis. Web maps it to a hover border tint only; the native tile uses
/// the same tone for its pointer-hover border and the danger affordance.
public enum CommandTileVariant: String, Sendable, Equatable, CaseIterable {
    case `default`
    case danger
    case success

    /// The semantic tone for the variant (web `hover:border-neon-{cyan|red|green}`).
    public var tone: TSTone {
        switch self {
        case .default: .accent
        case .danger: .danger
        case .success: .success
        }
    }
}

// MARK: - Command definition (web `CommandDef`, narrowed to the tile's fields)

/// The command the tile renders. A narrowed projection of the web `CommandDef` to
/// exactly the fields the tile consumes: identity, the label/sublabel i18n pairs,
/// the SF Symbol (web Lucide `def.icon`), the variant, the danger flag (web
/// `def.dangerous`), and the opaque params forwarded on execute.
public struct CommandTileDef: Equatable, Sendable {
    public let id: String
    public let command: String
    public let labelKey: String
    public let labelFallback: String
    public let sublabelKey: String?
    public let sublabelFallback: String?
    public let systemImage: String
    public let variant: CommandTileVariant
    public let isDangerous: Bool
    public let parameters: CommandParameters?

    public init(
        id: String,
        command: String,
        labelKey: String,
        labelFallback: String,
        sublabelKey: String? = nil,
        sublabelFallback: String? = nil,
        systemImage: String,
        variant: CommandTileVariant = .default,
        isDangerous: Bool = false,
        parameters: CommandParameters? = nil
    ) {
        self.id = id
        self.command = command
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.sublabelKey = sublabelKey
        self.sublabelFallback = sublabelFallback
        self.systemImage = systemImage
        self.variant = variant
        self.isDangerous = isDangerous
        self.parameters = parameters
    }

    /// Whether a sublabel line should render (web `def.sublabelFallback && …`).
    public var hasSublabel: Bool {
        guard let sublabelFallback else { return false }
        return !sublabelFallback.isEmpty
    }
}

// MARK: - Last-status outcome (web `lastStatus` + `startsWith('✓')`)

/// The settled outcome of the last command send, projected from the web `lastStatus`
/// string. Web colors it green when it starts with `✓`, red otherwise; the native
/// tile maps that to a tone + an SF Symbol and keeps the human-readable detail.
public enum CommandTileOutcome: Equatable, Sendable {
    case succeeded(detail: String?)
    case failed(detail: String?)

    /// The success marker the web checks for (`lastStatus.startsWith('✓')`).
    public static let successMarker: Character = "✓"
    private static let failureMarkers: Set<Character> = ["✗", "×", "✕", "⚠"]

    /// Projects the web `lastStatus` string. `nil`/blank → no outcome (web hides the
    /// status line). A leading status glyph is stripped so the native tile can render
    /// its own SF Symbol while preserving the message text.
    public static func parse(_ lastStatus: String?) -> CommandTileOutcome? {
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

/// What the tile's icon/status region shows, projected from the execution flag and
/// the last outcome. `idle` is the resting tile (icon + label, never blank).
public enum CommandTilePhase: Equatable, Sendable {
    case idle
    case executing
    case result(CommandTileOutcome)

    /// Executing wins (web spinner + dimmed); else a settled outcome; else idle.
    public static func project(isExecuting: Bool, outcome: CommandTileOutcome?) -> CommandTilePhase {
        if isExecuting { return .executing }
        if let outcome { return .result(outcome) }
        return .idle
    }
}

// MARK: - Freshness / connectivity (mirrors LiveConnectionState, ADR-013)

/// Live-state freshness for the last outcome, layered on top of the phase so the
/// tile can surface a stale/offline chip (native chrome over the controlled web prop).
public enum CommandTileConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness chip shown when the last outcome is stale or the tile is offline.
public struct CommandTileConnectionChip: Equatable {
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
    public static func project(_ connection: CommandTileConnection) -> CommandTileConnectionChip? {
        switch connection {
        case .live:
            nil
        case .stale:
            CommandTileConnectionChip(
                tone: .warning,
                labelKey: "commands.tile.freshness.stale",
                labelFallback: "Stale",
                systemImage: "clock.arrow.circlepath"
            )
        case .offline:
            CommandTileConnectionChip(
                tone: .neutral,
                labelKey: "commands.tile.freshness.offline",
                labelFallback: "Offline",
                systemImage: "wifi.slash"
            )
        }
    }
}

// MARK: - Accessibility builders (testable seam)

/// Builds the VoiceOver strings for the tile. Pure + public so the spoken content
/// can be unit-tested without rendering the view.
public enum CommandTileAccessibility {
    /// The favorite toggle's spoken label (web `aria-label={t('commands.toggleFavorite')}`).
    public static func favoriteLabel(localize: (String, String) -> String) -> String {
        localize("commands.toggleFavorite", "Toggle favorite")
    }

    /// The tile's spoken hint, reflecting whether activation confirms (dangerous) or
    /// executes directly. Pure projection so it can be asserted without a view.
    public static func activationHint(isDangerous: Bool, localize: (String, String) -> String) -> String {
        isDangerous
            ? localize("commands.tile.hint.confirm", "Asks for confirmation before running")
            : localize("commands.tile.hint.run", "Runs the command")
    }

    /// The stable automation identifier (web `data-testid` analogue).
    public static func testID(commandID: String) -> String {
        "command-tile-\(commandID)"
    }

    /// The favorite control's automation identifier.
    public static func favoriteTestID(commandID: String) -> String {
        "command-tile-favorite-\(commandID)"
    }
}
