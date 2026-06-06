namespace TeslaSync.App.Core.Push;

/// <summary>
/// The port the registration service uses to register and unregister this device with TeslaSync's
/// additive <c>/api/v1/devices</c> endpoint (P2/W6-0002, ADR-009). It is a focused seam — separate
/// from the generated <c>IApiClient</c> — so the registration logic is testable with a fake and so
/// the single real implementation (<see cref="DeviceRegistrationClient"/>) can be swapped for a
/// generated descriptor the moment the contract is emitted into the OpenAPI client.
/// </summary>
public interface IDeviceRegistrationClient
{
    /// <summary>Registers (upserts) this device's channel; returns the backend registration id.</summary>
    Task<DeviceRegistrationResponse> RegisterAsync(
        DeviceRegistrationRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Unregisters the device session identified by <paramref name="registrationId"/> so the backend
    /// stops fanning push to this channel. A <c>404</c> is treated as already-removed (idempotent).
    /// </summary>
    Task UnregisterAsync(string registrationId, CancellationToken cancellationToken = default);
}
