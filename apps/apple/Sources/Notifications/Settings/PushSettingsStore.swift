import Foundation

/// Persistence seam for `PushSettings`. A protocol so the settings model and
/// coordinator persist through one injectable boundary — production uses
/// `UserDefaults`; tests use an in-memory double with no global state.
public protocol PushSettingsStoring: Sendable {
    func load() -> PushSettings
    func save(_ settings: PushSettings)
}

/// `UserDefaults`-backed `PushSettings` persistence. `UserDefaults` is thread-safe,
/// so the `@unchecked Sendable` is sound (it carries no mutable Swift state).
public struct UserDefaultsPushSettingsStore: PushSettingsStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = "io.teslasync.push.settings") {
        self.defaults = defaults
        self.key = key
    }

    public func load() -> PushSettings {
        guard let data = defaults.data(forKey: key),
              let settings = try? JSONDecoder().decode(PushSettings.self, from: data)
        else {
            return .default
        }
        return settings
    }

    public func save(_ settings: PushSettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults.set(data, forKey: key)
    }
}

/// An in-memory `PushSettingsStoring` for previews and tests.
public final class InMemoryPushSettingsStore: PushSettingsStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var settings: PushSettings

    public init(settings: PushSettings = .default) {
        self.settings = settings
    }

    public func load() -> PushSettings {
        lock.lock()
        defer { lock.unlock() }
        return settings
    }

    public func save(_ settings: PushSettings) {
        lock.lock()
        self.settings = settings
        lock.unlock()
    }
}
