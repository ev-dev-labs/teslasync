using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TourOverlay"/> view — the native port of the web
/// <c>TourOverlay</c> body together with the navigation callbacks the parent wires (web/src/components/feedback/
/// TourOverlay.tsx). It binds the <see cref="ITourOverlaySource"/> (the P1/S8 content seam, the owner-held
/// <c>useTour</c> state), holds the current <see cref="Viewport"/> (a view-supplied measurement the tooltip clamps
/// against — see <see cref="SetViewport"/>), recomputes the pure <see cref="TourOverlayProjection"/> whenever either
/// moves, and raises <see cref="PropertyChanged"/> so the view re-renders and animates. <see cref="Next"/> /
/// <see cref="Prev"/> / <see cref="Skip"/> mirror the web <c>onNext</c> / <c>onPrev</c> / <c>onSkip</c> props:
/// rather than owning step state, they raise <see cref="NextRequested"/> / <see cref="PrevRequested"/> /
/// <see cref="SkipRequested"/> so the owner advances or ends the tour through the source — exactly as the web
/// overlay delegates to its parent's <c>useTour</c>. They are inert unless a tour is active. <see cref="Dispose"/>
/// unsubscribes from the source (the web effect cleanup). The show / hide animation and its reduce-motion handling
/// are view concerns.
/// </summary>
public sealed class TourOverlayViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ITourOverlaySource _source;
    private TourViewport _viewport;
    private TourOverlayProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and content seam, with the <see cref="DefaultViewport"/>.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The content state-holder seam (the owner-held tour state).</param>
    public TourOverlayViewModel(ILocalizer localizer, ITourOverlaySource source)
        : this(localizer, source, DefaultViewport)
    {
    }

    /// <summary>Creates the holder over its i18n facade, content seam and an initial viewport.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The content state-holder seam (the owner-held tour state).</param>
    /// <param name="viewport">The initial overlay viewport extent the tooltip clamps against.</param>
    public TourOverlayViewModel(ILocalizer localizer, ITourOverlaySource source, TourViewport viewport)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _viewport = viewport;

        _projection = Compute();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the surface requests the next step (the web <c>onNext</c> callback).</summary>
    public event EventHandler? NextRequested;

    /// <summary>Raised when the surface requests the previous step (the web <c>onPrev</c> callback).</summary>
    public event EventHandler? PrevRequested;

    /// <summary>Raised when the surface requests to skip / end the tour (the web <c>onSkip</c> callback).</summary>
    public event EventHandler? SkipRequested;

    /// <summary>The canonical surface slug (<c>TourOverlay</c>).</summary>
    public static string Slug => TourOverlayRegistration.Slug;

    /// <summary>The viewport used until the view supplies its measured size — a sensible desktop default.</summary>
    public static TourViewport DefaultViewport { get; } = new(1280, 800);

    /// <summary>The current render projection (visibility + spotlight + tooltip + content + navigation + a11y).</summary>
    public TourOverlayProjection Projection => _projection;

    /// <summary>The active-tour snapshot supplied by the source (null when no tour is running).</summary>
    public TourSnapshot? Snapshot => _source.Current;

    /// <summary>Whether the overlay is shown (a snapshot is present and its target has been measured).</summary>
    public bool IsActive => _projection.IsActive;

    /// <summary>The current overlay viewport extent the tooltip clamps against.</summary>
    public TourViewport Viewport => _viewport;

    /// <summary>
    /// Update the viewport the tooltip clamps against (the view's measured size, the native analogue of the web
    /// <c>window.innerWidth</c> / <c>innerHeight</c>). Re-projects when the extent actually changes; a no-op when it
    /// is unchanged or the holder is disposed.
    /// </summary>
    /// <param name="viewport">The new overlay viewport extent.</param>
    public void SetViewport(TourViewport viewport)
    {
        if (_disposed || _viewport == viewport)
        {
            return;
        }

        _viewport = viewport;
        Reproject();
    }

    /// <summary>Request the next step (the web <c>onNext</c> path). Inert unless a tour is active.</summary>
    public void Next()
    {
        if (_disposed || !_projection.IsActive)
        {
            return;
        }

        NextRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Request the previous step (the web <c>onPrev</c> path). Inert unless a tour is active.</summary>
    public void Prev()
    {
        if (_disposed || !_projection.IsActive)
        {
            return;
        }

        PrevRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Request to skip / end the tour (the web <c>onSkip</c> path). Inert unless a tour is active.</summary>
    public void Skip()
    {
        if (_disposed || !_projection.IsActive)
        {
            return;
        }

        SkipRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private TourOverlayProjection Compute() =>
        TourOverlayProjection.Project(_source.Current, _viewport, _localizer);

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        Reproject();
    }

    private void Reproject()
    {
        _projection = Compute();
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
