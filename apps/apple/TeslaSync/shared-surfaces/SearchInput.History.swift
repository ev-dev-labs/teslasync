//
//  SearchInput.History.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The Foundation-only recent-search history engine — the pure parity of `web/src/lib/searchHistory.ts`.
//  It owns the per-scope entry value type (``SearchInputHistoryEntry`` = the web `{ q, ts }`), the capacity
//  + min-length + default-return constants (the web `CAP` / `MIN_QUERY_LEN` / `DEFAULT_RETURN`), and the
//  pure list transforms the persistence store binds through: `record` (trim → min-length floor →
//  case-insensitive de-dup, newest-first, capped), `recent` (newest-first, clamped to the capacity), and
//  `remove` (case-insensitive single-entry deletion). Splitting the rules into this clock-free, storage-
//  free engine makes them exhaustively unit-testable and lets the `UserDefaults` + in-memory stores share
//  one source of truth (DRY), exactly like the web component + lib split.
//

import Foundation

// MARK: - History entry (web `{ q, ts }`)

/// One recorded search — the native peer of the web `HistoryEntry`: the original-cased text the user
/// submitted (`q`) and the wall-clock millisecond of the most recent submission (`ts`, kept in the web's
/// `Date.now()` milliseconds so the persisted envelope is recognisably identical across platforms).
public struct SearchInputHistoryEntry: Sendable, Equatable, Codable {
    /// Original-cased text the user submitted (web `q`).
    public let query: String
    /// Wall-clock milliseconds of the most recent submission (web `ts`).
    public let timestamp: Double

    /// Codable keys mirror the web envelope shape (`{ "q": ..., "ts": ... }`) verbatim.
    private enum CodingKeys: String, CodingKey {
        case query = "q"
        case timestamp = "ts"
    }

    public init(query: String, timestamp: Double) {
        self.query = query
        self.timestamp = timestamp
    }

    /// Whether the entry is well-formed — the web `isEntry` guard: a non-empty string `q` and a finite
    /// numeric `ts`. Malformed entries are dropped on load rather than thrown, matching the web resilience.
    public var isValid: Bool {
        !query.isEmpty && timestamp.isFinite
    }
}

// MARK: - History engine (web `searchHistory.ts` transforms)

/// The pure, per-scope list transforms — the native parity of the web `recordSearch` / `getRecentSearches`
/// / `removeSearch` logic, lifted off `localStorage` so they can be unit-tested and shared by every store.
/// Every function is a pure mapping over a scope's entry list; persistence + the envelope live in the
/// store seam.
public enum SearchInputHistory {
    /// Maximum entries kept per scope; oldest entries are evicted FIFO (web `CAP`).
    public static let cap = 12
    /// Minimum length (after trim) for a query to be recorded (web `MIN_QUERY_LEN`).
    public static let minQueryLen = 2
    /// Default number of entries returned by ``recent(_:max:)`` (web `DEFAULT_RETURN`).
    public static let defaultReturn = 8

    /// Records `query` into a scope's entry list — the verbatim port of the web `recordSearch` body: trim
    /// the query; ignore it when shorter than ``minQueryLen``; drop any existing entry with the same
    /// case-folded text; prepend the new submission (original casing + `now`) to the top; cap at ``cap``.
    /// Returns the list unchanged when the query is too short, so callers can fire on every blur / Enter.
    public static func record(
        into entries: [SearchInputHistoryEntry],
        query: String,
        now: Double
    ) -> [SearchInputHistoryEntry] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= minQueryLen else { return entries }
        let lower = trimmed.lowercased()
        let filtered = entries.filter { $0.query.lowercased() != lower }
        let next = [SearchInputHistoryEntry(query: trimmed, timestamp: now)] + filtered
        return Array(next.prefix(cap))
    }

    /// Returns up to `max` recent query strings, newest-first — the web `getRecentSearches`: the return is
    /// clamped to `[0, cap]` so a caller can never read past the stored capacity.
    public static func recent(_ entries: [SearchInputHistoryEntry], max: Int) -> [String] {
        let limit = Swift.max(0, Swift.min(max, cap))
        return entries.prefix(limit).map(\.query)
    }

    /// Removes a single entry (matched case-insensitively, after trimming) — the web `removeSearch` body.
    /// A blank query or a miss returns the list unchanged.
    public static func remove(
        _ entries: [SearchInputHistoryEntry],
        query: String
    ) -> [SearchInputHistoryEntry] {
        let lower = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !lower.isEmpty else { return entries }
        return entries.filter { $0.query.lowercased() != lower }
    }

    /// Cleans a freshly-decoded scope list — the web `load` per-scope `value.filter(isEntry).slice(0, CAP)`:
    /// drop malformed entries and clamp to the capacity. Anything weird is treated as absent rather than
    /// thrown, mirroring the store's resilience contract.
    public static func sanitize(_ entries: [SearchInputHistoryEntry]) -> [SearchInputHistoryEntry] {
        Array(entries.filter(\.isValid).prefix(cap))
    }
}
