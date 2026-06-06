namespace TeslaSync.App.Core.Push;

/// <summary>
/// The observable state of WNS device registration (P2/W6-0002). It is PII-safe — it never carries a
/// channel URI or token, only the backend registration id and the channel expiry — so it can drive
/// UI and diagnostics directly.
/// </summary>
public abstract record PushRegistrationState
{
    private PushRegistrationState()
    {
    }

    /// <summary>No active registration: the device has not registered (or was unregistered).</summary>
    public sealed record Unregistered : PushRegistrationState;

    /// <summary>A registration / renewal round-trip is in progress.</summary>
    public sealed record Registering : PushRegistrationState;

    /// <summary>Registered: the backend assigned <see cref="RegistrationId"/>; the channel expires at <see cref="ExpiresAt"/>.</summary>
    public sealed record Registered(string RegistrationId, DateTimeOffset? ExpiresAt) : PushRegistrationState;

    /// <summary>
    /// Registration could not complete. <see cref="Reason"/> is a short, PII-free code
    /// (e.g. <c>channel_unavailable</c>, <c>register_rejected</c>) suitable for logs and UI.
    /// </summary>
    public sealed record Failed(string Reason) : PushRegistrationState;

    /// <summary>True while a usable backend registration exists.</summary>
    public bool IsRegistered => this is Registered;
}
