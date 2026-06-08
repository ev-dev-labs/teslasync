//
//  SignalCatalogWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0087 · SignalCatalogWidget (Apple)
//
//  The pure adapter (cached DTO → projection). A 1:1 port of the derivation logic
//  in the web source: observation tallying, case-insensitive search across
//  name/description/source_module, category grouping with the "Uncategorized"
//  fallback and the alphabetical category sort, the integer count formatter, the
//  responsive compact split, and the shell phase / freshness resolution.
//  Foundation-only and side-effect-free so it is unit-tested by an executed
//  headless harness.
//

import Foundation

/// Stateless projector that turns a `SignalCatalogUpdate` (+ the view's search
/// text) into the grouped row list + chrome state the SwiftUI surface renders.
/// Every function is pure.
public enum SignalCatalogBuilder {
    // MARK: Observation tally (port of the `observationCounts` memo)

    /// Tallies the per-signal observation counts from the flat observation stream,
    /// a port of the web `for (const obs of observations) counts.set(obs.signal_name,
    /// (counts.get(obs.signal_name) ?? 0) + 1)`.
    public static func observationCounts(_ observations: [String]) -> [String: Int] {
        var counts: [String: Int] = [:]
        for name in observations {
            counts[name, default: 0] += 1
        }
        return counts
    }

    // MARK: Responsive layout (port of `isCompact = size.cols <= 1`)

    /// The web collapses to the single big-number layout at one column. The shared
    /// registry min size is two columns, so this is a defensive branch the grid
    /// never instantiates on either platform — reproduced for source parity.
    public static func isCompact(cols: Int) -> Bool {
        cols <= 1
    }

    // MARK: Search (port of the `filtered` memo)

    /// Whether an entry matches the (already trimmed + lower-cased) query, testing
    /// the name, description, and source module — a port of the web `.filter` over
    /// `s.name`, `s.description ?? ''`, and `s.source_module ?? ''`.
    public static func matches(_ entry: SignalCatalogEntry, query: String) -> Bool {
        if entry.name.lowercased().contains(query) {
            return true
        }
        if (entry.description ?? "").lowercased().contains(query) {
            return true
        }
        if (entry.sourceModule ?? "").lowercased().contains(query) {
            return true
        }
        return false
    }

    /// Filters the catalog by the search box. An empty/whitespace query returns the
    /// full list (web `if (!search.trim()) return entries`).
    public static func filter(_ entries: [SignalCatalogEntry], search: String) -> [SignalCatalogEntry] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else {
            return entries
        }
        return entries.filter { matches($0, query: query) }
    }

    // MARK: Grouping (port of the `grouped` memo)

    /// The category an entry groups under: its non-empty source module, else the
    /// localized "Uncategorized" label (web `entry.source_module || t(…)`).
    public static func category(for entry: SignalCatalogEntry, uncategorized: String) -> String {
        if let module = entry.sourceModule, !module.isEmpty {
            return module
        }
        return uncategorized
    }

    /// Filters + groups the catalog into alphabetically-sorted category sections,
    /// each row carrying its observation count. Rows keep their catalog order within
    /// a category (web pushes in iteration order); categories are sorted with a
    /// localized compare (web `a.localeCompare(b)`).
    public static func groups(
        entries: [SignalCatalogEntry],
        search: String,
        counts: [String: Int],
        uncategorized: String
    ) -> [SignalCatalogGroup] {
        let filtered = filter(entries, search: search)
        var byCategory: [String: [SignalCatalogRow]] = [:]
        for entry in filtered {
            let key = category(for: entry, uncategorized: uncategorized)
            let row = SignalCatalogRow(
                name: entry.name,
                unit: entry.unit,
                observationCount: counts[entry.name] ?? 0
            )
            byCategory[key, default: []].append(row)
        }
        return byCategory
            .map { SignalCatalogGroup(category: $0.key, rows: $0.value) }
            .sorted { $0.category.localizedCompare($1.category) == .orderedAscending }
    }

    // MARK: Shell phase + freshness resolution

    /// Resolves the shell render branch. Whenever the catalog has entries the
    /// content (search + list, or the compact count) shows — only an empty resolved
    /// catalog shows the empty state and only a rowless initial fetch shows the
    /// skeleton (errors/staleness surface in the chip, matching the web shell).
    public static func resolvePhase(status: CatalogLoadStatus, entryCount: Int) -> CatalogRenderPhase {
        if entryCount > 0 {
            return .content
        }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded, .empty:
            return .empty
        }
    }

    /// Resolves the freshness chip status (offline ▸ error ▸ fetching ▸ stale ▸
    /// fresh), mirroring the web `DataFreshness` precedence with the native offline
    /// addition.
    public static func resolveFreshness(_ update: SignalCatalogUpdate) -> CatalogFreshness {
        if update.connection == .offline {
            return .offline
        }
        if update.isError {
            return .error
        }
        if update.isFetching {
            return .fetching
        }
        if update.connection == .stale {
            return .stale
        }
        return .fresh
    }

    // MARK: Count formatting (port of `fmtInt`)

    /// Formats an integer with locale grouping separators (port of the web
    /// `fmtInt` → `toLocaleString` with 0 fraction digits).
    public static func formatInt(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    // MARK: Relative time (port of the web `formatRelativeTime`)

    /// A localized "just now / 5m ago / 2h ago / 3d ago / 1w ago" label for the
    /// freshness chip, matching the web minute/hour/day/week buckets.
    public static func relativeTime(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return SignalCatalogStrings.string("widget.signalCatalog.freshness.justNow", "just now")
        }
        if seconds < 3600 {
            return SignalCatalogStrings.count("widget.signalCatalog.freshness.minutes", "%lldm ago", seconds / 60)
        }
        if seconds < 86400 {
            return SignalCatalogStrings.count("widget.signalCatalog.freshness.hours", "%lldh ago", seconds / 3600)
        }
        if seconds < 604_800 {
            return SignalCatalogStrings.count("widget.signalCatalog.freshness.days", "%lldd ago", seconds / 86400)
        }
        return SignalCatalogStrings.count("widget.signalCatalog.freshness.weeks", "%lldw ago", seconds / 604_800)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver copy spoken for a catalog row, a category header, and the
/// freshness chip. Pure + public so the spoken content can be unit-tested without
/// rendering the view.
public enum SignalCatalogAccessibility {
    /// "BatteryLevel, kW, 128 observations" — name, optional unit, observation count.
    public static func rowLabel(for row: SignalCatalogRow) -> String {
        var parts = [row.name]
        if let unit = row.unit, !unit.isEmpty {
            parts.append(unit)
        }
        parts.append(
            SignalCatalogStrings.count(
                "widget.signalCatalog.observationsA11y",
                "%lld observations",
                row.observationCount
            )
        )
        return parts.joined(separator: ", ")
    }

    /// "Drive, 12 signals" — the category label and its signal count.
    public static func groupLabel(for group: SignalCatalogGroup) -> String {
        let countPhrase = SignalCatalogStrings.count(
            "widget.signalCatalog.signalsCountA11y",
            "%lld signals",
            group.count
        )
        return "\(group.category), \(countPhrase)"
    }

    /// The localized freshness label spoken by the chip / used as its value.
    public static func freshnessLabel(_ freshness: CatalogFreshness) -> String {
        switch freshness {
        case .fresh:
            SignalCatalogStrings.string("widget.signalCatalog.freshness.live", "Live")
        case .fetching:
            SignalCatalogStrings.string("widget.signalCatalog.freshness.updating", "Updating…")
        case .stale:
            SignalCatalogStrings.string("widget.signalCatalog.freshness.stale", "Stale")
        case .error:
            SignalCatalogStrings.string("widget.signalCatalog.freshness.error", "Error")
        case .offline:
            SignalCatalogStrings.string("widget.signalCatalog.freshness.offline", "Offline")
        }
    }
}
