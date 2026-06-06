using TeslaSync.App.Core.Push;
using Windows.Networking.PushNotifications;

namespace TeslaSync.App.Platform;

/// <summary>
/// The Windows <see cref="IPushChannelProvider"/> (P2/W6-0002): it wraps the WNS
/// <see cref="PushNotificationChannelManager"/> to create the app's
/// <see cref="PushNotificationChannel"/> and surfaces its <see cref="PushChannel.ChannelUri"/> and
/// expiry to the headless registration service. It also implements
/// <see cref="IForegroundPushReceiver"/>: while the app runs it forwards each raw notification from
/// the channel's <see cref="PushNotificationChannel.PushNotificationReceived"/> event to the
/// foreground router (no background SSE stream is held open — ADR-009).
///
/// <para>This type deliberately lives in the UI-free <c>TeslaSync.App.Platform</c> assembly: the
/// WinUI XAML markup compiler crashes when an app-assembly type references the WNS
/// <see cref="PushNotificationChannel.PushNotificationReceived"/> generic event, so the reference is
/// isolated here. Creating a channel requires MSIX package identity; in an unpackaged run the WNS
/// call throws and is surfaced as <see cref="PushChannelUnavailableException"/>. The channel URI is
/// never logged.</para>
/// </summary>
public sealed class WnsPushChannelProvider : IPushChannelProvider, IForegroundPushReceiver, IDisposable
{
    private readonly object _gate = new();
    private PushNotificationChannel? _channel;
    private bool _disposed;

    /// <inheritdoc />
    public event EventHandler<string>? PayloadReceived;

    /// <inheritdoc />
    public async Task<PushChannel> CreateChannelAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        PushNotificationChannel channel;
        try
        {
            channel = await PushNotificationChannelManager
                .CreatePushNotificationChannelForApplicationAsync()
                .AsTask(cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // No package identity / no WNS connectivity — the documented "live WNS unavailable" path.
            throw new PushChannelUnavailableException("WNS channel could not be created.", ex);
        }

        AttachChannel(channel);
        return new PushChannel(channel.Uri, channel.ExpirationTime);
    }

    /// <inheritdoc />
    public Task CloseChannelAsync(CancellationToken cancellationToken = default)
    {
        PushNotificationChannel? channel;
        lock (_gate)
        {
            channel = _channel;
            _channel = null;
        }

        DetachAndClose(channel);
        return Task.CompletedTask;
    }

    /// <summary>Detaches and closes the active channel.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        PushNotificationChannel? channel;
        lock (_gate)
        {
            channel = _channel;
            _channel = null;
        }

        DetachAndClose(channel);
    }

    private void AttachChannel(PushNotificationChannel channel)
    {
        PushNotificationChannel? previous;
        lock (_gate)
        {
            previous = _channel;
            _channel = channel;
        }

        DetachAndClose(previous);
        channel.PushNotificationReceived += OnPushReceived;
    }

    private void DetachAndClose(PushNotificationChannel? channel)
    {
        if (channel is null)
        {
            return;
        }

        try
        {
            channel.PushNotificationReceived -= OnPushReceived;
            channel.Close();
        }
        catch (Exception)
        {
            // Closing an already-revoked channel is a no-op; never surface a teardown failure.
        }
    }

    private void OnPushReceived(PushNotificationChannel sender, PushNotificationReceivedEventArgs args)
    {
        // Only raw notifications carry an app payload to route in the foreground; toast/tile/badge
        // types are presented by the system. Suppress the system path for raw so the app owns it.
        if (args.NotificationType != PushNotificationType.Raw)
        {
            return;
        }

        var content = args.RawNotification?.Content;
        if (string.IsNullOrEmpty(content))
        {
            return;
        }

        args.Cancel = true;
        PayloadReceived?.Invoke(this, content);
    }
}
