import Foundation

/// Force a Codable/Sendable shape onto the shared `TSAppearance` enum so it can be
/// persisted in `AppSettings`. `TSAppearance` is a payload-free `String`-raw enum:
/// `Codable` is synthesized via `RawRepresentable`, and it carries no reference
/// state, so the `@unchecked Sendable` (required for a cross-file conformance) is
/// sound.
extension TSAppearance: Codable {}
extension TSAppearance: @unchecked Sendable {}

/// The complete set of app-level preferences the native Settings scene owns.
///
/// Notification *content* preferences live in `PushSettings`; this only mirrors the
/// master notifications toggle. All values are non-sensitive (no tokens/PII).
public struct AppSettings: Codable, Equatable, Sendable {
    /// Appearance
    public var appearance: TSAppearance

    /// Units
    public var measurementSystem: MeasurementSystem

    /// Notifications (master mirror; channel detail lives in PushSettings)
    public var notificationsEnabled: Bool

    // Privacy
    public var analyticsOptIn: Bool
    public var recordRecentActivity: Bool
    public var spotlightIndexingEnabled: Bool
    public var handoffEnabled: Bool

    /// Security
    public var biometricUnlockEnabled: Bool

    /// Cache & offline
    public var offlineCacheEnabled: Bool

    /// Developer diagnostics
    public var diagnosticsVerboseLogging: Bool

    public init(
        appearance: TSAppearance = .system,
        measurementSystem: MeasurementSystem = .metric,
        notificationsEnabled: Bool = true,
        analyticsOptIn: Bool = false,
        recordRecentActivity: Bool = true,
        spotlightIndexingEnabled: Bool = true,
        handoffEnabled: Bool = true,
        biometricUnlockEnabled: Bool = false,
        offlineCacheEnabled: Bool = true,
        diagnosticsVerboseLogging: Bool = false
    ) {
        self.appearance = appearance
        self.measurementSystem = measurementSystem
        self.notificationsEnabled = notificationsEnabled
        self.analyticsOptIn = analyticsOptIn
        self.recordRecentActivity = recordRecentActivity
        self.spotlightIndexingEnabled = spotlightIndexingEnabled
        self.handoffEnabled = handoffEnabled
        self.biometricUnlockEnabled = biometricUnlockEnabled
        self.offlineCacheEnabled = offlineCacheEnabled
        self.diagnosticsVerboseLogging = diagnosticsVerboseLogging
    }

    /// Privacy-first defaults: analytics is opt-IN (off by default); continuity +
    /// cache convenience features are on.
    public static let `default` = AppSettings()

    private enum CodingKeys: String, CodingKey {
        case appearance, measurementSystem, notificationsEnabled, analyticsOptIn
        case recordRecentActivity, spotlightIndexingEnabled, handoffEnabled
        case biometricUnlockEnabled, offlineCacheEnabled, diagnosticsVerboseLogging
    }

    /// Per-field lenient decoding: any key missing from older persisted JSON falls
    /// back to its default, so adding a setting never strands an existing user.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let fallback = AppSettings.default
        appearance = try container.decodeIfPresent(TSAppearance.self, forKey: .appearance) ?? fallback.appearance
        measurementSystem = try container.decodeIfPresent(MeasurementSystem.self, forKey: .measurementSystem)
            ?? fallback.measurementSystem
        notificationsEnabled = try container.decodeIfPresent(Bool.self, forKey: .notificationsEnabled)
            ?? fallback.notificationsEnabled
        analyticsOptIn = try container.decodeIfPresent(Bool.self, forKey: .analyticsOptIn) ?? fallback.analyticsOptIn
        recordRecentActivity = try container.decodeIfPresent(Bool.self, forKey: .recordRecentActivity)
            ?? fallback.recordRecentActivity
        spotlightIndexingEnabled = try container.decodeIfPresent(Bool.self, forKey: .spotlightIndexingEnabled)
            ?? fallback.spotlightIndexingEnabled
        handoffEnabled = try container.decodeIfPresent(Bool.self, forKey: .handoffEnabled) ?? fallback.handoffEnabled
        biometricUnlockEnabled = try container.decodeIfPresent(Bool.self, forKey: .biometricUnlockEnabled)
            ?? fallback.biometricUnlockEnabled
        offlineCacheEnabled = try container.decodeIfPresent(Bool.self, forKey: .offlineCacheEnabled)
            ?? fallback.offlineCacheEnabled
        diagnosticsVerboseLogging = try container.decodeIfPresent(Bool.self, forKey: .diagnosticsVerboseLogging)
            ?? fallback.diagnosticsVerboseLogging
    }
}

public extension AppSettings {
    /// Decodes settings from JSON, falling back to defaults for any missing key so
    /// adding a field never strands an existing user.
    init(decodingLenient data: Data) {
        let decoder = JSONDecoder()
        if let decoded = try? decoder.decode(AppSettings.self, from: data) {
            self = decoded
        } else {
            self = .default
        }
    }
}
