using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="OfflineBanner"/> view — the native port of the web
/// <c>OfflineBanner</c> body (web/src/components/feedback/OfflineBanner.tsx L22-43). It binds the
/// <see cref="IOnlineStatusSource"/> (the P1/S8 connectivity seam, the web <c>useOnlineStatus()</c> subscription),
/// recomputes the pure <see cref="OfflineBannerProjection"/> whenever the connection moves, and raises
/// <see cref="PropertyChanged"/> so the view animates the banner in / out. <see cref="Dispose"/> unsubscribes from
/// the source (the web effect cleanup). The view performs no I/O of its own and reads no connectivity itself; the
/// show / hide animation (and its reduce-motion handling) is a view concern.
/// </summary>
public sealed class OfflineBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IOnlineStatusSource _source;
    private OfflineBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and connectivity seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade the title / body resolve through.</param>
    /// <param name="source">The online-status state-holder seam (web <c>useOnlineStatus()</c>).</param>
    public OfflineBannerViewModel(ILocalizer localizer, IOnlineStatusSource source)
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

    /// <summary>The canonical surface slug (<c>OfflineBanner</c>).</summary>
    public static string Slug => OfflineBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + title + body + accessible name + live setting).</summary>
    public OfflineBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>!online</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized banner title (web <c>t('pwa.offline.title')</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized banner body (web <c>t('pwa.offline.banner')</c>).</summary>
    public string Body => _projection.Body;

    /// <summary>The accessible name a screen reader announces (title + body).</summary>
    public string AccessibleName => _projection.AccessibleName;

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

    private OfflineBannerProjection Compute() => OfflineBannerProjection.Project(_source.Current, _localizer);

    private void OnSourceChanged(object? sender, EventArgs e) => Reproject();

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
