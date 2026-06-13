//
//  SearchInput.Stores.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The persistence seam the recent-searches dropdown binds through — the native parity of the web
//  `@/lib/searchHistory` `localStorage` envelope (`{ scopes: { [scope]: [{ q, ts }] } }` under the key
//  `teslasync:search-history:v1`). Foundation only; no view logic. The production store is backed by
//  `UserDefaults` (the Apple peer of `localStorage`) and routes every mutation through the pure
//  ``SearchInputHistory`` engine so the dedup / cap / min-length rules have one source of truth; the
//  in-memory double backs previews + tests without touching `UserDefaults`. Both swallow decode failures
//  into an empty store, matching the web contract that malformed JSON, non-object payloads, and non-array
//  scope values degrade to "no history" rather than throwing.
//

import Foundation

// MARK: - Store seam (web `localStorage` envelope)

/// The seam that persists per-scope recent searches — the native parity of the web `searchHistory`
/// `localStorage` contract. Scopes are independent (`drives` does not bleed into `charging`); each call is
/// synchronous (the web reads/writes `localStorage` inline on focus / blur / Enter), so there is no async,
/// no loading, and no error surface — a storage failure simply yields an empty list.
public protocol SearchInputHistoryStore: Sendable {
    /// Up to `max` recent query strings for `scope`, newest-first (web `getRecentSearches`).
    func recent(scope: String, max: Int) -> [String]
    /// Records `query` in `scope`, applying the engine's trim / min-length / de-dup / cap (web
    /// `recordSearch`).
    func record(scope: String, query: String)
    /// Removes a single entry (matched case-insensitively) from `scope` (web `removeSearch`).
    func remove(scope: String, query: String)
    /// Wipes all entries for `scope` only, leaving other scopes intact (web `clearScope`).
    func clear(scope: String)
}

// MARK: - UserDefaults store (web `localStorage`)

/// Production store backed by `UserDefaults`, persisting the same envelope shape under the same key the web
/// uses (`teslasync:search-history:v1`) so the history contract is recognisably identical across platforms.
/// Every mutation reads the whole envelope, applies the pure ``SearchInputHistory`` transform for the one
/// scope, and writes back — the web `load` → mutate → `save` cycle. Decode is resilient: any failure
/// resolves to an empty store. `@unchecked Sendable` because `UserDefaults` is documented thread-safe and
/// the only other stored property is an immutable `@Sendable` clock.
public final class UserDefaultsSearchInputHistoryStore: SearchInputHistoryStore, @unchecked Sendable {
    /// The storage key — verbatim from the web `STORAGE_KEY`.
    public static let storageKey = "teslasync:search-history:v1"

    private let defaults: UserDefaults
    private let now: @Sendable () -> Double

    /// - Parameters:
    ///   - defaults: the backing store (default `.standard`); injectable so tests use a scratch suite.
    ///   - now: the wall-clock millisecond provider (web `Date.now()`); injectable for deterministic tests.
    public init(
        defaults: UserDefaults = .standard,
        now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }
    ) {
        self.defaults = defaults
        self.now = now
    }

    public func recent(scope: String, max: Int) -> [String] {
        guard !scope.isEmpty else { return [] }
        let scopes = load()
        return SearchInputHistory.recent(scopes[scope] ?? [], max: max)
    }

    public func record(scope: String, query: String) {
        guard !scope.isEmpty else { return }
        var scopes = load()
        let updated = SearchInputHistory.record(into: scopes[scope] ?? [], query: query, now: now())
        if updated.isEmpty {
            scopes.removeValue(forKey: scope)
        } else {
            scopes[scope] = updated
        }
        save(scopes)
    }

    public func remove(scope: String, query: String) {
        guard !scope.isEmpty else { return }
        var scopes = load()
        guard let existing = scopes[scope] else { return }
        let next = SearchInputHistory.remove(existing, query: query)
        guard next.count != existing.count else { return }
        if next.isEmpty {
            scopes.removeValue(forKey: scope)
        } else {
            scopes[scope] = next
        }
        save(scopes)
    }

    public func clear(scope: String) {
        guard !scope.isEmpty else { return }
        var scopes = load()
        guard scopes[scope] != nil else { return }
        scopes.removeValue(forKey: scope)
        save(scopes)
    }

    // MARK: Envelope persistence

    /// The persisted envelope — the web `{ scopes: { [scope]: HistoryEntry[] } }`.
    private struct Envelope: Codable {
        var scopes: [String: [SearchInputHistoryEntry]]
    }

    /// Reads + sanitises the envelope. Mirrors the web `load`: a missing key, malformed JSON, or any
    /// per-scope value that fails validation degrades to an empty store / scope rather than throwing.
    private func load() -> [String: [SearchInputHistoryEntry]] {
        guard let data = defaults.data(forKey: Self.storageKey),
              let decoded = try? JSONDecoder().decode(Envelope.self, from: data)
        else {
            return [:]
        }
        var cleaned: [String: [SearchInputHistoryEntry]] = [:]
        for (scope, entries) in decoded.scopes {
            let valid = SearchInputHistory.sanitize(entries)
            if !valid.isEmpty {
                cleaned[scope] = valid
            }
        }
        return cleaned
    }

    /// Writes the envelope. A failed encode is swallowed (web `save` quota / private-browsing fallback):
    /// history is purely additive UX, so dropping a write degrades gracefully.
    private func save(_ scopes: [String: [SearchInputHistoryEntry]]) {
        guard let data = try? JSONEncoder().encode(Envelope(scopes: scopes)) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }
}

// MARK: - In-memory store (previews + tests)

/// In-memory store for previews + unit tests — the same engine-backed semantics as the production store
/// without touching `UserDefaults`. Records the mutation counts so the persistence contract can be asserted
/// directly. Lock-guarded so it satisfies the `Sendable` store seam under Swift 6 strict concurrency.
public final class InMemorySearchInputHistoryStore: SearchInputHistoryStore, @unchecked Sendable {
    private let lock = NSLock()
    private var scopes: [String: [SearchInputHistoryEntry]]
    private var now: Double
    private var recordCountStorage = 0
    private var removeCountStorage = 0
    private var clearCountStorage = 0

    /// - Parameters:
    ///   - seed: initial per-scope entries (preview fixtures); sanitised on construction.
    ///   - now: the starting wall-clock millisecond; each `record` advances it by 1 so seeded fixtures keep
    ///     a stable newest-first order.
    public init(seed: [String: [SearchInputHistoryEntry]] = [:], now: Double = 0) {
        scopes = seed.mapValues(SearchInputHistory.sanitize)
        self.now = now
    }

    /// Convenience preview/test seed from plain strings (newest-first), assigning descending timestamps.
    public convenience init(scope: String, queries: [String]) {
        var entries: [SearchInputHistoryEntry] = []
        for (index, query) in queries.enumerated() {
            entries.append(SearchInputHistoryEntry(query: query, timestamp: Double(queries.count - index)))
        }
        self.init(seed: [scope: entries], now: Double(queries.count + 1))
    }

    public var recordCount: Int {
        lock.withLock { recordCountStorage }
    }

    public var removeCount: Int {
        lock.withLock { removeCountStorage }
    }

    public var clearCount: Int {
        lock.withLock { clearCountStorage }
    }

    public func recent(scope: String, max: Int) -> [String] {
        guard !scope.isEmpty else { return [] }
        return lock.withLock { SearchInputHistory.recent(scopes[scope] ?? [], max: max) }
    }

    public func record(scope: String, query: String) {
        guard !scope.isEmpty else { return }
        lock.withLock {
            recordCountStorage += 1
            now += 1
            let updated = SearchInputHistory.record(into: scopes[scope] ?? [], query: query, now: now)
            if updated.isEmpty {
                scopes.removeValue(forKey: scope)
            } else {
                scopes[scope] = updated
            }
        }
    }

    public func remove(scope: String, query: String) {
        guard !scope.isEmpty else { return }
        lock.withLock {
            removeCountStorage += 1
            guard let existing = scopes[scope] else { return }
            let next = SearchInputHistory.remove(existing, query: query)
            if next.isEmpty {
                scopes.removeValue(forKey: scope)
            } else {
                scopes[scope] = next
            }
        }
    }

    public func clear(scope: String) {
        guard !scope.isEmpty else { return }
        lock.withLock {
            clearCountStorage += 1
            scopes.removeValue(forKey: scope)
        }
    }
}
