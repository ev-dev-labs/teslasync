namespace TeslaSync.App.Core.Push;

/// <summary>A toast to present through the platform notification surface (P2/W6-0002).</summary>
public sealed record PushToast(string Title, string Body, string? Category = null, string? LaunchArgument = null);

/// <summary>
/// The toast-service contract (P2/W6-0002). The Windows implementation builds and shows a toast via
/// <c>Microsoft.Windows.AppNotifications.AppNotificationManager</c>; the headless core registers a
/// null implementation so the router resolves in tests, and the App overrides it with the real one.
/// </summary>
public interface IToastService
{
    /// <summary>Presents <paramref name="toast"/> through the platform notification surface.</summary>
    Task ShowAsync(PushToast toast, CancellationToken cancellationToken = default);
}

/// <summary>
/// A null <see cref="IToastService"/> used when no platform toast surface is registered (the
/// headless core and unit tests). It is a deliberate Null-Object: it accepts and discards toasts.
/// </summary>
public sealed class NullToastService : IToastService
{
    /// <inheritdoc />
    public Task ShowAsync(PushToast toast, CancellationToken cancellationToken = default) => Task.CompletedTask;
}
