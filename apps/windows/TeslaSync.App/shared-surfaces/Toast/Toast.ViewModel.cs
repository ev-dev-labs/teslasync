using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Toast"/> overlay — the native port of the web
/// <c>ToastProvider</c> body (web/src/components/feedback/Toast.tsx L130-237). It binds an
/// <see cref="IToastController"/> (the P1/S8 toast queue seam, the web <c>useToast()</c> context), recomputes the
/// pure <see cref="ToastProjection"/> whenever the queue changes, and raises <see cref="PropertyChanged"/> so the
/// view animates toasts in / out. <see cref="Dismiss"/> forwards to the controller (the web <c>dismiss(id)</c>
/// invoked by a card's close button or its action). <see cref="Dispose"/> unsubscribes from the controller (the
/// web effect cleanup). The view performs no queue mutation of its own beyond forwarding dismiss intents; the
/// per-toast auto-dismiss timing and the entrance/exit animation (and its reduce-motion handling) are view
/// concerns.
/// </summary>
public sealed class ToastViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IToastController _controller;
    private ToastProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and the toast queue seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade the dismiss label resolves through.</param>
    /// <param name="controller">The toast queue seam (web <c>useToast()</c>).</param>
    public ToastViewModel(ILocalizer localizer, IToastController controller)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(controller);

        _localizer = localizer;
        _controller = controller;

        _projection = Compute();
        _controller.Changed += OnControllerChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Toast</c>).</summary>
    public static string Slug => ToastRegistration.Slug;

    /// <summary>The current render projection (the ordered toasts + the shared dismiss label).</summary>
    public ToastProjection Projection => _projection;

    /// <summary>The ordered render-ready toasts (oldest first, newest last).</summary>
    public IReadOnlyList<ToastItemProjection> Items => _projection.Items;

    /// <summary>True while the overlay shows at least one toast (web <c>toasts.length &gt; 0</c>).</summary>
    public bool HasToasts => _projection.HasToasts;

    /// <summary>The number of toasts currently shown.</summary>
    public int Count => _projection.Count;

    /// <summary>The localized dismiss-button accessible name shared by every card.</summary>
    public string DismissLabel => _projection.DismissLabel;

    /// <summary>Dismiss the toast with the given id (web <c>dismiss(id)</c>), forwarding to the controller.</summary>
    /// <param name="id">The queue id to remove.</param>
    public void Dismiss(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        _controller.Dismiss(id);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _controller.Changed -= OnControllerChanged;
        GC.SuppressFinalize(this);
    }

    private ToastProjection Compute() => ToastProjection.Project(_controller.Snapshot, _localizer);

    private void OnControllerChanged(object? sender, EventArgs e) => Reproject();

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        // Every controller change is a real queue mutation (add / drop / dismiss), so always reproject and notify.
        _projection = Compute();
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
