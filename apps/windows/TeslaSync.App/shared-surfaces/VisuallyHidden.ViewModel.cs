using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.VisuallyHiddenSurface;

/// <summary>
/// The live-region state holder bound to the announcer data source (P1/S8) — the native port of the web
/// <c>AnnouncerRegion</c> component's state (web/src/components/a11y/AnnouncerRegion.tsx). It keeps one
/// polite and one assertive message string (web <c>useState('')</c> twice) and, like the web
/// <c>useEffect(() =&gt; subscribeAnnouncer(...))</c>, subscribes to an <see cref="IAnnouncer"/> on
/// construction and routes each announcement to the matching message by priority. It is
/// <see cref="INotifyPropertyChanged"/> so the WinUI surface refreshes its hidden live regions when a
/// message arrives; every announcement raises a change even when the visible text looks identical, because
/// the announcer's rotating zero-width-space suffix differs — mirroring the web re-render that forces the
/// assistive technology to re-announce duplicates. <see cref="Dispose"/> unsubscribes (the web effect
/// cleanup). The view performs no I/O of its own; it binds to this holder.
/// </summary>
public sealed class AnnouncerRegionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDisposable _subscription;
    private string _politeMessage = string.Empty;
    private string _assertiveMessage = string.Empty;
    private bool _disposed;

    /// <summary>Creates the holder and subscribes it to <paramref name="announcer"/> (the web mount effect).</summary>
    public AnnouncerRegionViewModel(IAnnouncer announcer)
    {
        ArgumentNullException.ThrowIfNull(announcer);
        _subscription = announcer.Subscribe(OnAnnounced);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current polite live-region text (web <c>polite</c> state; starts empty).</summary>
    public string PoliteMessage => _politeMessage;

    /// <summary>The current assertive live-region text (web <c>assertive</c> state; starts empty).</summary>
    public string AssertiveMessage => _assertiveMessage;

    /// <summary>Stop listening to the announcer (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _subscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnAnnounced(string message, AnnouncerPriority priority)
    {
        // web AnnouncerRegion: assertive -> setAssertive(message); else setPolite(message).
        if (priority == AnnouncerPriority.Assertive)
        {
            _assertiveMessage = message;
            Raise(nameof(AssertiveMessage));
        }
        else
        {
            _politeMessage = message;
            Raise(nameof(PoliteMessage));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
