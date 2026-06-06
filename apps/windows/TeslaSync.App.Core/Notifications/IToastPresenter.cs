namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The rich OS-toast surface seam (P2/W8-0001). Unlike the basic W6 <c>IToastService</c> (title/body
/// only), this presents a fully-composed <see cref="ToastContent"/> with action buttons, a scenario
/// and a deep-link launch argument. The Windows implementation builds it with the Windows App SDK
/// <c>AppNotificationBuilder</c>; the headless default (<see cref="NullToastPresenter"/>) discards it
/// so the dispatcher resolves in tests and on hosts without package identity.
/// </summary>
public interface IToastPresenter
{
    /// <summary>Presents <paramref name="content"/> as a system toast.</summary>
    Task PresentAsync(ToastContent content, CancellationToken cancellationToken = default);
}

/// <summary>A null <see cref="IToastPresenter"/> that accepts and discards toasts (headless / test default).</summary>
public sealed class NullToastPresenter : IToastPresenter
{
    /// <summary>The shared singleton instance.</summary>
    public static NullToastPresenter Instance { get; } = new();

    private NullToastPresenter()
    {
    }

    /// <inheritdoc />
    public Task PresentAsync(ToastContent content, CancellationToken cancellationToken = default) => Task.CompletedTask;
}
