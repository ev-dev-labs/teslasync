//
//  CommandSearch.Adapter.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  The testable projection core for the vehicle-command search — the faithful port of the web
//  `VehicleCommandCenter` `filteredCommands` memo that the `CommandSearch` box drives. The projector
//  reproduces the filter VERBATIM:
//
//      const filteredCommands = useMemo(() => {
//        if (!search.trim()) return null;            // empty box → idle (favorites / categories)
//        const q = search.toLowerCase();
//        return COMMANDS.filter(c =>
//          t(c.labelKey, c.labelFallback).toLowerCase().includes(q) ||
//          c.category.includes(q) ||
//          c.command.includes(q));
//      }, [search, t]);
//
//  …in catalog order, with no result cap (the web grid shows every match). Foundation-only so it is
//  unit-tested without a bundle or a rendered view.
//

import Foundation

/// The dependency-free projection from the cached command catalog to the matched rows, plus the
/// result-phase resolver. Every value uses the same match predicate + order as the web component so
/// the web and native result lists resolve identically for identical input.
public enum CommandSearchProjector {
    /// Whether the box is non-empty enough to search — the web `!search.trim()` guard (any non-blank
    /// query searches; there is no minimum length).
    public static func isSearching(_ query: String) -> Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The lowercased needle used by the web filter (`const q = search.toLowerCase()`). Not trimmed —
    /// only the search/idle decision trims, matching the web precisely.
    public static func needle(_ query: String) -> String {
        query.lowercased()
    }

    /// Whether one command matches the query, reproducing the web `||` chain: the localized title
    /// (lowercased) contains the needle, OR the category token contains it, OR the command token does.
    public static func matches(_ command: CommandDTO, needle: String) -> Bool {
        command.title.lowercased().contains(needle)
            || command.category.contains(needle)
            || command.command.contains(needle)
    }

    /// Builds the match projection from the catalog: an empty box yields no rows (the view renders the
    /// idle hint, web favorites/categories); otherwise the commands whose title / category / command
    /// contains the needle, in catalog order, each mapped to its row + `view`-ready VoiceOver label.
    public static func project(
        commands: [CommandDTO],
        query: String,
        copy: CommandSearchCopy = .fallback
    ) -> CommandSearchProjection {
        guard isSearching(query) else { return .empty }
        let needle = needle(query)
        let rows = commands
            .filter { matches($0, needle: needle) }
            .map { command in
                CommandMatch(
                    id: command.id,
                    title: command.title,
                    subtitle: command.subtitle,
                    category: command.category,
                    systemImage: command.systemImage,
                    accessibilityLabel: accessibilityLabel(for: command, copy: copy)
                )
            }
        return CommandSearchProjection(matches: rows)
    }

    /// Resolves the result phase, mirroring the web precedence: a failed catalog short-circuits to
    /// error; an unresolved catalog is loading; a resolved catalog is idle when the box is empty (web
    /// `null` → favorites), content when matches exist, and empty when the search matched nothing.
    public static func resolvePhase(
        _ status: CommandSearchLoadStatus,
        isSearching searching: Bool,
        hasMatches: Bool
    ) -> CommandSearchPhase {
        switch status {
        case let .failed(message):
            return .error(message)
        case .idle, .loading:
            return .loading
        case .loaded:
            guard searching else { return .idle }
            return hasMatches ? .content : .empty
        }
    }

    /// The combined VoiceOver label for a matched command: the injected role word, the title, and the
    /// sub-label when present (native a11y enrichment over the web tile's visual-only label).
    static func accessibilityLabel(for command: CommandDTO, copy: CommandSearchCopy) -> String {
        var label = "\(copy.commandRole): \(command.title)"
        if let subtitle = command.subtitle, !subtitle.isEmpty {
            label += ", \(subtitle)"
        }
        return label
    }
}

// MARK: - Stale-age label (web `commands.staleData` `{{age}}`)

/// Formats the cached-data age for the stale banner — the native parity of the web command center's
/// `ageLabel` interpolated into `commands.staleData`. Dependency-free + deterministic (`now` injected)
/// so it is host-testable; rounds down to the largest whole unit (seconds → minutes → hours → days).
public enum CommandSearchAge {
    /// A compact age string ("just now", "5 min", "2 hr", "3 days") for the time elapsed since
    /// `updatedAt`. Returns a neutral "unknown" when no timestamp is available, and clamps negatives
    /// (a future timestamp) to "just now".
    public static func compactLabel(since updatedAt: Date?, relativeTo now: Date = Date()) -> String {
        guard let updatedAt else { return "unknown" }
        let seconds = max(0, now.timeIntervalSince(updatedAt))
        switch seconds {
        case ..<60:
            return "just now"
        case ..<3600:
            return "\(Int(seconds / 60)) min"
        case ..<86400:
            return "\(Int(seconds / 3600)) hr"
        default:
            return "\(Int(seconds / 86400)) days"
        }
    }
}
