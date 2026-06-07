import Foundation

/// Adapts the auth coordinator to the settings layer's biometric seam so the
/// native Settings ▸ Security toggle drives the real biometric-unlock preference,
/// while `AppSettingsModel` depends only on the small `BiometricSettingControlling`
/// protocol (not the concrete coordinator).
extension AuthCoordinator: BiometricSettingControlling {
    public var isBiometricAvailable: Bool {
        biometricAvailability.isAvailable
    }

    public var isBiometricEnabled: Bool {
        biometricUnlockEnabled
    }

    public func setBiometricEnabled(_ enabled: Bool) {
        setBiometricUnlock(enabled)
    }
}
