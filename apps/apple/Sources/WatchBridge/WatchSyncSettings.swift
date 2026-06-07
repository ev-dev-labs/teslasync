import Foundation

/// The lean slice of the user's preferences the iPhone mirrors to the Apple Watch.
///
/// The watch never converts SI itself — the cached glance summaries arrive already
/// formatted in the user's units (ADR-016 keeps the conversion boundary on the
/// phone). This carries only the *core* preferences the watch surfaces: the unit
/// system (so the watch can label which units it is showing), whether
/// notifications are enabled, whether the app-lock (biometric) is on, and whether
/// offline caching is allowed. It deliberately omits phone-only concerns
/// (Spotlight, Handoff, appearance) so the watch stays decoupled from the full
/// `AppSettings` model and its UI dependencies.
public struct WatchSyncSettings: Codable, Equatable, Sendable {
    public var measurementSystem: MeasurementSystem
    public var notificationsEnabled: Bool
    public var appLockEnabled: Bool
    public var offlineCacheEnabled: Bool

    public init(
        measurementSystem: MeasurementSystem = .metric,
        notificationsEnabled: Bool = true,
        appLockEnabled: Bool = false,
        offlineCacheEnabled: Bool = true
    ) {
        self.measurementSystem = measurementSystem
        self.notificationsEnabled = notificationsEnabled
        self.appLockEnabled = appLockEnabled
        self.offlineCacheEnabled = offlineCacheEnabled
    }

    /// Privacy-first defaults used until the first sync arrives.
    public static let `default` = WatchSyncSettings()

    private enum CodingKeys: String, CodingKey {
        case measurementSystem, notificationsEnabled, appLockEnabled, offlineCacheEnabled
    }

    /// Per-field lenient decoding so adding a field never strands an older payload
    /// produced by a not-yet-updated phone build.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let fallback = WatchSyncSettings.default
        measurementSystem = try container.decodeIfPresent(MeasurementSystem.self, forKey: .measurementSystem)
            ?? fallback.measurementSystem
        notificationsEnabled = try container.decodeIfPresent(Bool.self, forKey: .notificationsEnabled)
            ?? fallback.notificationsEnabled
        appLockEnabled = try container.decodeIfPresent(Bool.self, forKey: .appLockEnabled)
            ?? fallback.appLockEnabled
        offlineCacheEnabled = try container.decodeIfPresent(Bool.self, forKey: .offlineCacheEnabled)
            ?? fallback.offlineCacheEnabled
    }
}
