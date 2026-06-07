import Foundation
import Observation

/// The biometric-unlock surface the settings model needs, kept as a small seam so
/// the model never depends on the concrete `AuthCoordinator` (and stays testable).
/// `AuthCoordinator` conforms to it in the app wiring.
@MainActor
public protocol BiometricSettingControlling: AnyObject {
    var isBiometricAvailable: Bool { get }
    var isBiometricEnabled: Bool { get }
    func setBiometricEnabled(_ enabled: Bool)
}

/// The `@Observable` model the native Settings scene binds to. Owns the current
/// `AppSettings`, persists every change through the injected store, mirrors the
/// biometric toggle to the auth coordinator, and exposes cache-clear + a change
/// hook (so the app can re-apply units, re-index Spotlight, etc.).
@MainActor
@Observable
public final class AppSettingsModel {
    public private(set) var settings: AppSettings

    @ObservationIgnored private let storage: any AppSettingsStoring
    @ObservationIgnored private let biometric: (any BiometricSettingControlling)?
    @ObservationIgnored private let onChange: (@MainActor (AppSettings) -> Void)?
    @ObservationIgnored private let onClearCache: @MainActor () -> Void

    public init(
        storage: any AppSettingsStoring = UserDefaultsAppSettingsStore(),
        biometric: (any BiometricSettingControlling)? = nil,
        onClearCache: @escaping @MainActor () -> Void = {},
        onChange: (@MainActor (AppSettings) -> Void)? = nil
    ) {
        self.storage = storage
        self.biometric = biometric
        self.onClearCache = onClearCache
        self.onChange = onChange
        var loaded = storage.load()
        // The auth coordinator is the source of truth for whether biometric unlock
        // is actually active; reconcile the persisted mirror to it on launch.
        if let biometric {
            loaded.biometricUnlockEnabled = biometric.isBiometricEnabled
        }
        settings = loaded
    }

    /// Whether biometric unlock can be offered (Face ID / Touch ID present).
    public var isBiometricAvailable: Bool {
        biometric?.isBiometricAvailable ?? false
    }

    // MARK: - Appearance / units

    public func setAppearance(_ appearance: TSAppearance) {
        mutate { $0.appearance = appearance }
    }

    public func setMeasurementSystem(_ system: MeasurementSystem) {
        mutate { $0.measurementSystem = system }
    }

    // MARK: - Notifications

    public func setNotificationsEnabled(_ enabled: Bool) {
        mutate { $0.notificationsEnabled = enabled }
    }

    // MARK: - Privacy

    public func setAnalyticsOptIn(_ enabled: Bool) {
        mutate { $0.analyticsOptIn = enabled }
    }

    public func setRecordRecentActivity(_ enabled: Bool) {
        mutate { $0.recordRecentActivity = enabled }
    }

    public func setSpotlightIndexing(_ enabled: Bool) {
        mutate { $0.spotlightIndexingEnabled = enabled }
    }

    public func setHandoff(_ enabled: Bool) {
        mutate { $0.handoffEnabled = enabled }
    }

    // MARK: - Security

    /// Toggles biometric unlock through the auth coordinator, then mirrors the
    /// *actual* resulting state (the coordinator may refuse when unavailable).
    public func setBiometricUnlock(_ enabled: Bool) {
        biometric?.setBiometricEnabled(enabled)
        let resolved = biometric?.isBiometricEnabled ?? false
        mutate { $0.biometricUnlockEnabled = resolved }
    }

    // MARK: - Cache & offline

    public func setOfflineCache(_ enabled: Bool) {
        mutate { $0.offlineCacheEnabled = enabled }
    }

    /// Clears cached data (widget snapshot + any app caches) via the injected hook.
    public func clearCache() {
        onClearCache()
    }

    // MARK: - Diagnostics

    public func setDiagnosticsVerboseLogging(_ enabled: Bool) {
        mutate { $0.diagnosticsVerboseLogging = enabled }
    }

    // MARK: - Internals

    private func mutate(_ transform: (inout AppSettings) -> Void) {
        var next = settings
        transform(&next)
        guard next != settings else { return }
        settings = next
        storage.save(next)
        onChange?(next)
    }
}
