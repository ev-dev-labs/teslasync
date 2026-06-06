namespace TeslaSync.App.Core.Push;

/// <summary>
/// The seam over the platform WNS channel APIs (P2/W6-0002). The Windows implementation
/// (<c>WnsPushChannelProvider</c>) wraps
/// <c>Windows.Networking.PushNotifications.PushNotificationChannelManager
/// .CreatePushNotificationChannelForApplicationAsync()</c>; the headless core and the unit tests use
/// a fake so the registration logic is verified without a packaged host.
/// </summary>
public interface IPushChannelProvider
{
    /// <summary>
    /// Requests (or renews) the application's WNS channel. Throws
    /// <see cref="PushChannelUnavailableException"/> when no channel can be created (e.g. no package
    /// identity). The returned <see cref="PushChannel.ChannelUri"/> is credential-grade material.
    /// </summary>
    Task<PushChannel> CreateChannelAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Closes the current channel so WNS stops routing to it (used during unregister / sign-out
    /// cleanup). Best-effort: a missing or already-closed channel completes without error.
    /// </summary>
    Task CloseChannelAsync(CancellationToken cancellationToken = default);
}
