import Foundation

/// Persistence seam for `AppSettings` — one injectable boundary so the model
/// persists through `UserDefaults` in production and an in-memory double in tests.
public protocol AppSettingsStoring: Sendable {
    func load() -> AppSettings
    func save(_ settings: AppSettings)
}

/// `UserDefaults`-backed `AppSettings` persistence. `UserDefaults` is thread-safe,
/// so `@unchecked Sendable` is sound (no mutable Swift state).
public struct UserDefaultsAppSettingsStore: AppSettingsStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = "io.teslasync.app.settings") {
        self.defaults = defaults
        self.key = key
    }

    public func load() -> AppSettings {
        guard let data = defaults.data(forKey: key) else { return .default }
        return AppSettings(decodingLenient: data)
    }

    public func save(_ settings: AppSettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults.set(data, forKey: key)
    }
}

/// In-memory `AppSettingsStoring` for previews and tests.
public final class InMemoryAppSettingsStore: AppSettingsStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var settings: AppSettings

    public init(settings: AppSettings = .default) {
        self.settings = settings
    }

    public func load() -> AppSettings {
        lock.lock(); defer { lock.unlock() }
        return settings
    }

    public func save(_ settings: AppSettings) {
        lock.lock()
        self.settings = settings
        lock.unlock()
    }
}
