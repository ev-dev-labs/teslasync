import Foundation

/// The seam the push layer registers APNs device tokens through (ADR-009). Kept as
/// a small protocol (rather than naming a shared-core type) so it stays Shared-free
/// and fakes trivially in tests: production binds `HTTPDeviceRegistrar` over the P5
/// auth seams; tests pass a recording double with no APNs/network runtime.
public protocol DeviceRegistering: Sendable {
    /// Registers (or idempotently refreshes) this device with TeslaSync. Returns the
    /// stored row; throws a `FacadeError` when the call cannot be completed.
    @discardableResult
    func register(_ registration: DeviceRegistration) async throws -> RegisteredDevice

    /// Removes this device's registration by its APNs token (sign-out / disable).
    func unregister(token: String) async throws
}
