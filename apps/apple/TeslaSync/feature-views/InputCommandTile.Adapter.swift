//
//  InputCommandTile.Adapter.swift
//  TeslaSync — P4 feature view · 0232 · InputCommandTile (Apple)
//
//  The testable projection core for the vehicle-command input tile — the SwiftUI
//  parity of features/system/components/InputCommandTile.tsx. Everything here is
//  pure + dependency-free (no SwiftUI, no store, no bundle) so the command model,
//  the variant accent, the last-result status parsing (the web
//  `lastStatus.startsWith('✓')` convention), and the VoiceOver summaries are unit
//  tested in isolation.
//
//  Parity note: the web tile is a presentational leaf fed a `CommandDef` plus the
//  parent's `loading` / `lastStatus` / `isFavorite` props. This core mirrors the
//  subset the tile actually reads (label/sublabel i18n keys, icon, variant) and
//  carries the icon as an SF Symbol name — the native counterpart of the web
//  `LucideIcon` — since the full 72-command catalog is owned by the page surface
//  (out of scope here).
//

import Foundation

// MARK: - Variant (web `'default' | 'danger' | 'success'`)

/// The command tile's emphasis — the native mirror of the web `CommandDef.variant`.
/// The wire raw value is preserved (`"default"`) for parity with the source config.
public enum CommandTileVariant: String, Sendable, Equatable, CaseIterable {
    case standard = "default"
    case danger
    case success

    /// The semantic accent the tile uses for its border + pressed highlight — the
    /// native, hover-free mapping of the web `hover:border-neon-{tone}` styles.
    public var accent: CommandTileAccent {
        switch self {
        case .standard: .neutral
        case .danger: .danger
        case .success: .success
        }
    }
}

/// The semantic accent role for a tile, resolved to a token colour in the view.
public enum CommandTileAccent: String, Sendable, Equatable {
    case neutral
    case danger
    case success
}

// MARK: - Command definition (web `CommandDef` subset the tile reads)

/// One input-command tile's definition — the native mirror of the web `CommandDef`
/// fields the tile renders. The numeric/string command identity stays raw; the
/// label/sublabel are carried as i18n key + English fallback (resolved in the view).
public struct CommandTileDef: Identifiable, Equatable, Sendable {
    public let id: String
    public let command: String
    public let labelKey: String
    public let labelFallback: String
    public let sublabelKey: String?
    public let sublabelFallback: String?
    public let systemImage: String
    public let variant: CommandTileVariant

    public init(
        id: String,
        command: String,
        labelKey: String,
        labelFallback: String,
        sublabelKey: String? = nil,
        sublabelFallback: String? = nil,
        systemImage: String,
        variant: CommandTileVariant = .standard
    ) {
        self.id = id
        self.command = command
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.sublabelKey = sublabelKey
        self.sublabelFallback = sublabelFallback
        self.systemImage = systemImage
        self.variant = variant
    }

    /// Whether the tile renders a sublabel line (web `def.sublabelFallback && …`).
    public var hasSublabel: Bool {
        guard let sublabelFallback else { return false }
        return !sublabelFallback.isEmpty
    }
}

// MARK: - Last-result status (web `lastStatus` ✓/✗ convention)

/// The outcome of the most recent command run. The web tile tints the status line
/// green when the string starts with `✓` and red otherwise; this makes the prefix
/// convention explicit and testable.
public enum CommandTileOutcome: String, Sendable, Equatable {
    case success
    case failure
}

/// A parsed last-result status — the native mirror of the web `lastStatus` prop.
public struct CommandTileStatus: Equatable, Sendable {
    public static let successMarker = "✓"
    public static let failureMarker = "✗"

    public let outcome: CommandTileOutcome
    public let detail: String

    public init(outcome: CommandTileOutcome, detail: String) {
        self.outcome = outcome
        self.detail = detail
    }

    /// Parses the web `lastStatus` prop. `nil` / empty ⇒ no status (the web falsy
    /// branch that hides the line). A leading `✓` ⇒ success; anything else ⇒ failure
    /// (web `startsWith('✓') ? green : red`). The marker is stripped from `detail`.
    public static func parse(_ raw: String?) -> CommandTileStatus? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix(successMarker) {
            return CommandTileStatus(outcome: .success, detail: strip(trimmed, successMarker))
        }
        let detail = trimmed.hasPrefix(failureMarker) ? strip(trimmed, failureMarker) : trimmed
        return CommandTileStatus(outcome: .failure, detail: detail)
    }

    /// The rendered line, e.g. "✓ 2m ago" — reconstructs the web string shape.
    public var displayText: String {
        let marker = outcome == .success ? Self.successMarker : Self.failureMarker
        return detail.isEmpty ? marker : "\(marker) \(detail)"
    }

    private static func strip(_ value: String, _ marker: String) -> String {
        String(value.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings from already-localised parts, so the spoken content
/// is asserted without rendering the view.
public enum CommandTileAccessibility {
    /// The tile's spoken label: "{label}" or "{label}, {sublabel}".
    public static func tileLabel(label: String, sublabel: String?) -> String {
        guard let sublabel, !sublabel.isEmpty else { return label }
        return "\(label), \(sublabel)"
    }

    /// The status line's spoken label, built from the localised outcome wording so
    /// the raw `✓` / `✗` glyph is not read aloud.
    public static func statusLabel(outcomeWording: String, detail: String) -> String {
        detail.isEmpty ? outcomeWording : "\(outcomeWording) \(detail)"
    }
}
