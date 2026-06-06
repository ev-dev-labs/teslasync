namespace TeslaSync.App.Core.Push;

/// <summary>
/// A platform-agnostic projection of a Windows Push Notification Services (WNS) channel
/// (P2/W6-0002). The Windows app obtains one from a <see cref="IPushChannelProvider"/> wrapping
/// <c>Windows.Networking.PushNotifications.PushNotificationChannelManager</c>; the headless core and
/// the tests consume only this immutable shape so the registration logic never depends on WinRT.
///
/// <para><see cref="ChannelUri"/> is the secret push address WNS assigns — it is treated as a
/// credential: it is sent to the backend over TLS but is never persisted locally in plaintext nor
/// written to any log (see <see cref="PushRedaction"/>).</para>
/// </summary>
public sealed record PushChannel(string ChannelUri, DateTimeOffset ExpiresAt)
{
    /// <summary>True when the channel expires at or before <paramref name="window"/> from <paramref name="now"/>.</summary>
    public bool IsExpiringWithin(TimeSpan window, DateTimeOffset now) => ExpiresAt - now <= window;
}
