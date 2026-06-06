import Foundation
import Observation

/// The `@Observable` settings model the push-settings screen binds to. It owns the
/// current `PushSettings`, persists every change through the injected store, and
/// reports the live authorization status. Mutations notify an optional `onChange`
/// hook so the coordinator can re-sync the OS authorization options (e.g. when the
/// user toggles critical alerts).
@MainActor
@Observable
public final class PushSettingsModel {
    public private(set) var settings: PushSettings
    public private(set) var authorizationStatus: PushAuthorizationStatus

    @ObservationIgnored private let storage: any PushSettingsStoring
    @ObservationIgnored private let onChange: (@MainActor (PushSettings) -> Void)?

    public init(
        storage: any PushSettingsStoring = UserDefaultsPushSettingsStore(),
        authorizationStatus: PushAuthorizationStatus = .notDetermined,
        onChange: (@MainActor (PushSettings) -> Void)? = nil
    ) {
        self.storage = storage
        settings = storage.load()
        self.authorizationStatus = authorizationStatus
        self.onChange = onChange
    }

    public func setCategory(_ category: PushCategory, enabled: Bool) {
        mutate { $0.setCategory(category, enabled: enabled) }
    }

    public func setSoundEnabled(_ enabled: Bool) {
        mutate { $0.soundEnabled = enabled }
    }

    public func setBadgeEnabled(_ enabled: Bool) {
        mutate { $0.badgeEnabled = enabled }
    }

    public func setCriticalAlertsEnabled(_ enabled: Bool) {
        mutate { $0.criticalAlertsEnabled = enabled }
    }

    public func setQuietHoursEnabled(_ enabled: Bool) {
        mutate { $0.quietHours.isEnabled = enabled }
    }

    public func setQuietHoursStart(hour: Int, minute: Int) {
        mutate { $0.quietHours.setStart(hour: hour, minute: minute) }
    }

    public func setQuietHoursEnd(hour: Int, minute: Int) {
        mutate { $0.quietHours.setEnd(hour: hour, minute: minute) }
    }

    /// Records the latest OS authorization status (driven by the coordinator).
    public func updateAuthorization(_ status: PushAuthorizationStatus) {
        authorizationStatus = status
    }

    private func mutate(_ transform: (inout PushSettings) -> Void) {
        var next = settings
        transform(&next)
        guard next != settings else { return }
        settings = next
        storage.save(next)
        onChange?(next)
    }
}
