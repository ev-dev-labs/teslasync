using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The announcer surface's state holder — the native port of the web <c>AnnouncerRegion</c> component body
/// (web/src/components/a11y/AnnouncerRegion.tsx L17-L29). The web component keeps two pieces of local state,
/// <c>polite</c> and <c>assertive</c>, and on mount subscribes to the announcer; each fan-out routes to
/// <c>setAssertive</c> when the priority is assertive and <c>setPolite</c> otherwise. This holder reproduces
/// that exactly over an injected <see cref="IAnnouncerBus"/> (the P1/S8 seam): it subscribes on construction,
/// exposes the two most-recent messages as <see cref="INotifyPropertyChanged"/> properties (the empty / polite
/// / assertive render states), raises <see cref="Announced"/> so the mounted view can voice each message on
/// the correct region, and unsubscribes on <see cref="Dispose"/> (the web effect cleanup).
/// </summary>
/// <remarks>
/// This holder is deliberately free of any view-framework dependency so it can be verified headlessly. It
/// raises its notifications on whichever thread the bus fans out on; marshalling onto the UI thread is the
/// mounted view's responsibility, mirroring the way the web component's <c>setState</c> calls are reconciled
/// by React rather than by the announcer module.
/// </remarks>
public sealed class AnnouncerRegionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDisposable _subscription;
    private string _polite = string.Empty;
    private string _assertive = string.Empty;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its announcer seam and subscribes to it (the web component's
    /// <c>useEffect(() =&gt; subscribeAnnouncer(...), [])</c> mount).
    /// </summary>
    public AnnouncerRegionViewModel(IAnnouncerBus bus)
    {
        ArgumentNullException.ThrowIfNull(bus);
        _subscription = bus.Subscribe(OnAnnounce);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised once per announcement with the padded text and its priority, so the mounted view can voice it
    /// on the matching live region (the imperative analogue of the web region re-rendering with new text).
    /// </summary>
    public event EventHandler<AnnouncerMessageEventArgs>? Announced;

    /// <summary>The most recent polite-region text (web <c>polite</c> state); empty until the first polite announcement.</summary>
    public string Polite => _polite;

    /// <summary>The most recent assertive-region text (web <c>assertive</c> state); empty until the first assertive announcement.</summary>
    public string Assertive => _assertive;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // web effect cleanup: the returned unsubscribe runs on unmount.
        _subscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnAnnounce(string message, AnnouncerPriority priority)
    {
        // web: `if (priority === 'assertive') setAssertive(message); else setPolite(message);`
        if (priority == AnnouncerPriority.Assertive)
        {
            _assertive = message;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Assertive)));
        }
        else
        {
            _polite = message;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Polite)));
        }

        Announced?.Invoke(this, new AnnouncerMessageEventArgs(message, priority));
    }
}
