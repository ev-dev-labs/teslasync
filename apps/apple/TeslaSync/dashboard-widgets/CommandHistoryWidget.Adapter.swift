//
//  CommandHistoryWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0029 · CommandHistoryWidget (Apple)
//
//  The testable projection core: cached `CommandInput` DTOs → the view-ready
//  `CommandFeedItem` rows. Reproduces the web `STATUS_MAP` (icon / color / severity)
//  and its `DEFAULT_STATUS` fallback, the `formatCommandName` title transform
//  (`\b\w` → upper, `_` → space), the compact badge tone/label mapping (web
//  `variant` / `label`), the feed's newest-first sort + `maxItems` cap (web
//  `WidgetEventFeed`), the relative-time formatter, and the VoiceOver summaries.
//  All pure + dependency-free so the adapter can be unit-tested without a store, a
//  bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Severity (web `EventFeedItem['severity']`)

/// Event severity carried through the projection, mapped to a shared `TSTone` for
/// any tinting/VoiceOver. Mirrors the web `'info' | 'warning' | 'critical'`.
public enum CommandSeverity: Sendable, Equatable {
    case info
    case warning
    case critical

    public var tone: TSTone {
        switch self {
        case .info: .info
        case .warning: .warning
        case .critical: .danger
        }
    }
}

// MARK: - Status kind (port of the web `STATUS_MAP` keys)

/// The resolved command outcome. `success` / `failed` / `pending` mirror the web
/// `STATUS_MAP` keys (matched verbatim against the raw `cmd.status` token, as the
/// web object lookup does); any other token resolves to `.unknown`, the web
/// `DEFAULT_STATUS` branch.
public enum CommandStatusKind: Equatable, Sendable {
    case success
    case failed
    case pending
    case unknown
}

// MARK: - Status → visual catalog (port of web `STATUS_MAP` / `DEFAULT_STATUS`)

/// Resolves a raw command status to its kind + the kind's SF Symbol, exact web dot
/// color, English fallback label, severity, and compact-badge tone — the native
/// port of the web `STATUS_MAP` lookup and the compact `CompactView` mapping. The
/// dot colors reproduce the exact web hex so the feed reads identically on both apps.
public enum CommandStatusCatalog {
    /// One resolved status presentation (icon + color + severity).
    public struct Visual: Sendable {
        public let systemImage: String
        public let dotColor: Color
        public let severity: CommandSeverity
    }

    // Web hex parity (STATUS_MAP `color`).
    private static let green = Color(red: 0.133, green: 0.773, blue: 0.369) // #22c55e
    private static let red = Color(red: 0.937, green: 0.267, blue: 0.267) // #ef4444
    private static let amber = Color(red: 0.961, green: 0.620, blue: 0.043) // #f59e0b
    private static let slate = Color(red: 0.420, green: 0.447, blue: 0.502) // #6b7280

    /// Maps a raw `cmd.status` token to its kind. The web `STATUS_MAP[cmd.status]`
    /// is an exact (case-sensitive) object lookup, so unrecognized tokens fall to
    /// `.unknown` (web `DEFAULT_STATUS`).
    public static func kind(forRawStatus raw: String?) -> CommandStatusKind {
        switch raw {
        case "success": .success
        case "failed": .failed
        case "pending": .pending
        default: .unknown
        }
    }

    /// The feed-row icon + color + severity for a resolved kind — the web
    /// `STATUS_MAP` entry, with `.unknown` using the `DEFAULT_STATUS` (terminal /
    /// slate / info) branch.
    public static func feedVisual(for kind: CommandStatusKind) -> Visual {
        switch kind {
        case .success:
            Visual(systemImage: "checkmark.circle.fill", dotColor: green, severity: .info)
        case .failed:
            Visual(systemImage: "xmark.circle.fill", dotColor: red, severity: .critical)
        case .pending:
            Visual(systemImage: "clock.fill", dotColor: amber, severity: .warning)
        case .unknown:
            Visual(systemImage: "terminal.fill", dotColor: slate, severity: .info)
        }
    }

    /// The compact-badge tone (web `CompactView` `variant`): `success` → success,
    /// `failed` → danger, everything else (pending + unknown) → warning.
    public static func compactTone(for kind: CommandStatusKind) -> TSTone {
        switch kind {
        case .success: .success
        case .failed: .danger
        case .pending, .unknown: .warning
        }
    }

    /// The localized compact-badge label (web `CompactView` `label`): `success` →
    /// "Success", `failed` → "Failed", everything else → "Pending". Resolved through
    /// the injected localizer so it is bundle-free in tests.
    public static func compactLabel(for kind: CommandStatusKind, localize: (String, String) -> String) -> String {
        switch kind {
        case .success: localize("widget.commandSuccess", "Success")
        case .failed: localize("widget.commandFailed", "Failed")
        case .pending, .unknown: localize("widget.commandPending", "Pending")
        }
    }
}

// MARK: - Command name formatter (web `formatCommandName`)

/// Formats a raw command token for display — the native port of the web
/// `formatCommandName`: replace `_` with a space, then upper-case the first
/// word-character at every word boundary (`replace(/\b\w/g, c => c.toUpperCase())`),
/// leaving every other character untouched. `wake_up` → `Wake Up`, `flash_lights`
/// → `Flash Lights`, `—` → `—`.
public enum CommandNameFormatter {
    public static func format(_ raw: String) -> String {
        let spaced = raw.replacingOccurrences(of: "_", with: " ")
        var result = ""
        result.reserveCapacity(spaced.count)
        var previousWasWord = false
        for character in spaced {
            let isWord = character.isLetter || character.isNumber
            if isWord, !previousWasWord {
                result.append(contentsOf: String(character).uppercased())
            } else {
                result.append(character)
            }
            previousWasWord = isWord
        }
        return result
    }
}

// MARK: - Feed item projection (web `feedItems` map)

/// One row in the command feed — the native port of the web `EventFeedItem`,
/// carrying the resolved (display-formatted) command title, the raw status token
/// (web subtitle `cmd.status ?? '—'`), the status `kind` so the view can re-derive
/// icon + color, and the metadata for sorting + VoiceOver.
public struct CommandFeedItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: CommandStatusKind
    public let title: String
    public let statusRaw: String
    public let timestamp: Date
    public let severity: CommandSeverity

    public init(
        id: String,
        kind: CommandStatusKind,
        title: String,
        statusRaw: String,
        timestamp: Date,
        severity: CommandSeverity
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.statusRaw = statusRaw
        self.timestamp = timestamp
        self.severity = severity
    }
}

/// Builds the command feed projection. `build` mirrors the web `list.map(...)` in
/// source order (so the compact view's `latest` matches web `list[0]`); `feed`
/// reproduces the `WidgetEventFeed` newest-first sort + `maxItems` slice the
/// expanded layout applies. Kept split + pure so both halves are unit-tested.
public enum CommandFeedBuilder {
    /// Source-order projection of the cached commands (web `feedItems`). The title
    /// is `formatCommandName(cmd.command ?? '—')`; the subtitle is the raw status
    /// token (`cmd.status ?? '—'`); the severity comes from the resolved kind.
    public static func build(commands: [CommandInput]) -> [CommandFeedItem] {
        commands.map { command in
            let kind = CommandStatusCatalog.kind(forRawStatus: command.status)
            return CommandFeedItem(
                id: command.stableID,
                kind: kind,
                title: CommandNameFormatter.format(command.command ?? "—"),
                statusRaw: command.status ?? "—",
                timestamp: command.displayTimestamp,
                severity: CommandStatusCatalog.feedVisual(for: kind).severity
            )
        }
    }

    /// Newest-first, capped slice for the expanded feed (web `WidgetEventFeed`'s
    /// internal `sort((a,b) => b.ts - a.ts).slice(0, maxItems)`).
    public static func feed(items: [CommandFeedItem], limit: Int) -> [CommandFeedItem] {
        let sorted = items.sorted { $0.timestamp > $1.timestamp }
        return Array(sorted.prefix(max(0, limit)))
    }
}

// MARK: - Size-derived layout (web `isCompact` / `maxItems`)

/// The pure size → layout rules the view applies, kept testable + separate from the
/// (size-agnostic) model. Mirrors the web `isCompact = size.cols <= 1` and the
/// expanded feed's fixed `maxItems={10}`.
public enum CommandLayout {
    /// Web `isCompact = size.cols <= 1` — at one column the surface collapses to the
    /// single latest command + a status badge.
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Web `<WidgetEventFeed maxItems={10} />` — the expanded feed shows at most ten
    /// rows regardless of grid height.
    public static let feedLimit = 10
}

// MARK: - Relative time (web `formatRelativeTime`)

/// Locale-aware relative timestamp for a feed row (web `formatRelativeTime`'s
/// "Just now / Nm ago / Nh ago" intent), delegated to the OS so it is localized
/// without hardcoded English. `now` is injectable for deterministic tests.
public enum CommandRelativeTime {
    public static func string(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the surface's rows. Pure + public so the spoken
/// content can be unit-tested without rendering the view.
public enum CommandAccessibility {
    /// The expanded feed-row summary: the command title plus its status token when
    /// present (the web row pairs the title with the `cmd.status` subtitle).
    public static func feedSummary(for item: CommandFeedItem) -> String {
        guard item.statusRaw != "—", !item.statusRaw.isEmpty else { return item.title }
        return "\(item.title). \(item.statusRaw)"
    }

    /// The compact-row summary: the latest command title plus its localized status
    /// label (web compact `lastCommand` + `Badge` label).
    public static func compactSummary(command: String, statusLabel: String) -> String {
        "\(command). \(statusLabel)"
    }
}
