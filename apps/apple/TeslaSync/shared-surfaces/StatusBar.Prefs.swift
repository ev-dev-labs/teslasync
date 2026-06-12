//
//  StatusBar.Prefs.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The persisted-preferences state-holder seam (P1/S8) — the native peer of the web `useStatusBarPrefs` /
//  `setStatusBarPrefs` external store (a `localStorage` value with cross-tab sync). `StatusBarPrefsStore` is
//  the injectable read/write port the model binds to; `UserDefaultsStatusBarPrefsStore` is the production
//  implementation (JSON in `UserDefaults` under the same `teslasync-status-bar-prefs` key the web uses), and
//  `InMemoryStatusBarPrefsStore` keeps previews + tests deterministic. The store is `@MainActor`-isolated
//  (the bar reads it on the main actor only), which keeps it strict-concurrency-clean without any `Sendable`
//  closure plumbing.
//

import Foundation

// MARK: - StatusBarPrefsStore (P1/S8 read/write port)

/// The persisted status-bar preferences port — the native peer of the web external store. The model reads
/// `current` on bind + on `syncPrefs()` (the cross-tab analog: the host calls it on scene activation) and
/// writes through `update` when the user toggles a preference.
@MainActor
public protocol StatusBarPrefsStore: AnyObject {
    /// The latest persisted preferences — web `getPrefsSnapshot()`.
    var current: StatusBarPrefs { get }
    /// Persists the merged preferences — web `setStatusBarPrefs`.
    func update(_ prefs: StatusBarPrefs)
}

// MARK: - UserDefaultsStatusBarPrefsStore (production)

/// `UserDefaults`-backed store — the native peer of the web `localStorage` JSON. Reads decode live so an
/// external writer (another scene / an app extension) is observed the next time the bar calls `syncPrefs()`,
/// mirroring the web `storage`-event re-read. A malformed / absent value falls back to the defaults, exactly
/// like the web `readPrefs()` boolean-validating guard.
@MainActor
public final class UserDefaultsStatusBarPrefsStore: StatusBarPrefsStore {
    /// The persistence key — VERBATIM from the web `STORAGE_KEY`.
    public static let storageKey = "teslasync-status-bar-prefs"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var current: StatusBarPrefs {
        guard
            let data = defaults.data(forKey: Self.storageKey),
            let decoded = try? JSONDecoder().decode(StatusBarPrefs.self, from: data)
        else {
            return .defaults
        }
        return decoded
    }

    public func update(_ prefs: StatusBarPrefs) {
        guard let data = try? JSONEncoder().encode(prefs) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }
}

// MARK: - InMemoryStatusBarPrefsStore (previews + tests)

/// A process-memory store — keeps previews + tests deterministic with no `UserDefaults` side effects.
@MainActor
public final class InMemoryStatusBarPrefsStore: StatusBarPrefsStore {
    private var stored: StatusBarPrefs

    public init(_ initial: StatusBarPrefs = .defaults) {
        stored = initial
    }

    public var current: StatusBarPrefs {
        stored
    }

    public func update(_ prefs: StatusBarPrefs) {
        stored = prefs
    }
}
