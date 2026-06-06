namespace TeslaSync.App.Core.Push;

/// <summary>
/// Orchestrates WNS device registration with TeslaSync (P2/W6-0002, ADR-009): it requests a channel
/// from the <see cref="IPushChannelProvider"/>, registers it with the backend
/// <c>/api/v1/devices</c> contract, renews it before expiry and after an auth/user change, and
/// unregisters it on sign-out (and after a revoke failure). All operations are serialized so a
/// renewal cannot race a sign-out cleanup.
/// </summary>
public interface IPushRegistrationService
{
    /// <summary>The current observable registration state (PII-safe).</summary>
    PushRegistrationState State { get; }

    /// <summary>Raised on every <see cref="State"/> transition.</summary>
    event EventHandler<PushRegistrationState>? StateChanged;

    /// <summary>Requests a channel and registers (upserts) this device with the backend.</summary>
    Task<PushRegistrationState> RegisterAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Renews the channel: requests a fresh channel and re-registers when the channel changed, is
    /// near/at expiry, or no prior registration exists; otherwise leaves the existing registration.
    /// </summary>
    Task<PushRegistrationState> RenewAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Unregisters this device with the backend (best-effort) and clears the channel and local
    /// metadata, ending in <see cref="PushRegistrationState.Unregistered"/>.
    /// </summary>
    Task UnregisterAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Reacts to an authentication change: a sign-in renews/registers the channel for the new user;
    /// a sign-out unregisters and clears it.
    /// </summary>
    Task OnAuthChangedAsync(bool signedIn, CancellationToken cancellationToken = default);
}
