import Foundation

/// Watch-local persistence of the last payload the phone delivered. It lets the
/// companion render last-known values instantly on launch (before any fresh sync)
/// and lets the complication extension read the same cache. Backed by the watch's
/// App Group so the watch app and its complication extension share one container; a
/// missing entitlement degrades to standard defaults rather than crashing.
/// `UserDefaults` is thread-safe, so `@unchecked Sendable` is sound (no mutable
/// Swift state of our own).
public struct WatchCacheStore: @unchecked Sendable {
    public static let defaultKey = "io.teslasync.watch.payload"

    private let defaults: UserDefaults
    private let key: String

    /// Production initializer: the watch App Group suite, falling back to standard.
    public init(suiteName: String = WidgetAppGroup.identifier, key: String = WatchCacheStore.defaultKey) {
        defaults = UserDefaults(suiteName: suiteName) ?? .standard
        self.key = key
    }

    /// Test/preview initializer pointed at an explicit defaults instance.
    public init(defaults: UserDefaults, key: String = WatchCacheStore.defaultKey) {
        self.defaults = defaults
        self.key = key
    }

    /// The cached payload, or `nil` when absent/unreadable/too new.
    public func load() -> WatchSyncPayload? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return WatchSyncCoder.decode(data)
    }

    /// Persists the latest payload.
    public func save(_ payload: WatchSyncPayload) {
        guard let data = try? WatchSyncCoder.encode(payload) else { return }
        defaults.set(data, forKey: key)
    }

    /// Removes the cached payload (used on sign-out to drop last-known values).
    public func clear() {
        defaults.removeObject(forKey: key)
    }
}
