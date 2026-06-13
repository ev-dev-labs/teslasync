using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AlertBanner"/> view — the native port of the web
/// <c>AlertBanner</c> body (web/src/components/feedback/AlertBanner.tsx L39-54). It binds the
/// <see cref="IAlertBannerSource"/> (the P1/S8 content seam, the web parent-owned props), recomputes the pure
/// <see cref="AlertBannerProjection"/> whenever the source moves, and raises <see cref="PropertyChanged"/> so the
/// view animates the banner in / out. <see cref="Dismiss"/> mirrors the web <c>onClose</c>: it collapses the
/// current alert for this session and raises <see cref="Closed"/> so a host can react; because the web dismissal is
/// ephemeral (the parent removes the element, nothing is persisted), a subsequent source change — the parent
/// supplying fresh content — re-arms the banner. <see cref="Dispose"/> unsubscribes from the source (the web effect
/// cleanup). The show / hide animation (and its reduce-motion handling) is a view concern.
/// </summary>
public sealed class AlertBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IAlertBannerSource _source;
    private AlertBannerProjection _projection;
    private bool _dismissed;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and content seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade the dismiss label resolves through.</param>
    /// <param name="source">The content state-holder seam (the web parent-owned props).</param>
    public AlertBannerViewModel(ILocalizer localizer, IAlertBannerSource source)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;

        _projection = Compute();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the banner is dismissed (the web <c>onClose</c> callback).</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>AlertBanner</c>).</summary>
    public static string Slug => AlertBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + variant + title + body + icon + dismiss + a11y).</summary>
    public AlertBannerProjection Projection => _projection;

    /// <summary>The alert currently supplied by the source (null when there is no alert).</summary>
    public AlertBannerModel? CurrentModel => _source.Current;

    /// <summary>Whether the banner is shown (content present and not dismissed).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>Whether the banner exposes a dismiss affordance (web <c>onClose</c> supplied).</summary>
    public bool Dismissible => _projection.Dismissible;

    /// <summary>The banner title (web <c>title</c>); empty when absent.</summary>
    public string Title => _projection.Title;

    /// <summary>The banner body (web <c>children</c>).</summary>
    public string Body => _projection.Body;

    /// <summary>The localized dismiss-control accessible name.</summary>
    public string DismissLabel => _projection.DismissLabel;

    /// <summary>The accessible name a screen reader announces (title + body).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// Dismiss the current alert (the web <c>onClose</c> path): collapses the banner for this session and raises
    /// <see cref="Closed"/>. No-op when the banner is not dismissible or is already dismissed.
    /// </summary>
    public void Dismiss()
    {
        if (_disposed || !_projection.Dismissible || _dismissed)
        {
            return;
        }

        _dismissed = true;
        Reproject();
        Closed?.Invoke(this, EventArgs.Empty);
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

    private AlertBannerProjection Compute() =>
        AlertBannerProjection.Project(_source.Current, _dismissed, _localizer);

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        // The parent supplying fresh content re-arms the banner (the web ephemeral dismissal does not persist).
        _dismissed = false;
        Reproject();
    }

    private void Reproject()
    {
        AlertBannerProjection next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
