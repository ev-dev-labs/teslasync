using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BrowserCompatBanner"/> view — the native port of the
/// web <c>BrowserCompatBanner</c> body (web/src/components/feedback/BrowserCompatBanner.tsx L46-98). It binds the
/// <see cref="IBrowserCompatSource"/> (the P1/S8 capability seam, the web <c>detectMissingFeatures()</c> read) and
/// the <see cref="IBrowserCompatDismissalStore"/> (the P1/S8 persisted-dismissal seam, the web localStorage flag),
/// recomputes the pure <see cref="BrowserCompatBannerProjection"/> whenever either moves, and raises
/// <see cref="PropertyChanged"/> so the view animates the banner in / out. <see cref="Dismiss"/> persists the
/// acknowledgement (web <c>handleDismiss</c>) which collapses the banner and keeps it hidden across relaunches.
/// <see cref="Dispose"/> unsubscribes from both seams (the web effect cleanup). The view performs no detection or
/// persistence of its own; the show / hide animation (and its reduce-motion handling) is a view concern.
/// </summary>
public sealed class BrowserCompatBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IBrowserCompatSource _source;
    private readonly IBrowserCompatDismissalStore _dismissalStore;
    private BrowserCompatBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, capability seam, and dismissal seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade the title / body / dismiss strings resolve through.</param>
    /// <param name="source">The host-capability state-holder seam (web <c>detectMissingFeatures()</c>).</param>
    /// <param name="dismissalStore">The persisted-dismissal seam (web localStorage flag).</param>
    public BrowserCompatBannerViewModel(
        ILocalizer localizer,
        IBrowserCompatSource source,
        IBrowserCompatDismissalStore dismissalStore)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(dismissalStore);

        _localizer = localizer;
        _source = source;
        _dismissalStore = dismissalStore;

        _projection = Compute();
        _source.Changed += OnSeamChanged;
        _dismissalStore.Changed += OnSeamChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>BrowserCompatBanner</c>).</summary>
    public static string Slug => BrowserCompatRegistration.Slug;

    /// <summary>The current render projection (visibility + title + body + feature list + dismiss label + live setting).</summary>
    public BrowserCompatBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>!dismissed &amp;&amp; missing.length &gt; 0</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized banner title (web <c>t('compat.banner.title')</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized banner body with the feature list + recommendation interpolated (web <c>body</c>).</summary>
    public string Body => _projection.Body;

    /// <summary>The joined missing-feature list (web <c>featureList</c> / <c>data-missing</c>).</summary>
    public string FeatureList => _projection.FeatureList;

    /// <summary>The localized dismiss-control accessible name (web <c>t('compat.banner.dismiss')</c>).</summary>
    public string DismissLabel => _projection.DismissLabel;

    /// <summary>The accessible name a screen reader announces (title + body).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// Persist the dismissal (web <c>handleDismiss</c> -> <c>dismissCompatWarning()</c> + <c>setDismissed(true)</c>).
    /// The dismissal seam raises its change event, which reprojects and collapses the banner.
    /// </summary>
    public void Dismiss()
    {
        if (_disposed)
        {
            return;
        }

        _dismissalStore.Dismiss();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSeamChanged;
        _dismissalStore.Changed -= OnSeamChanged;
        GC.SuppressFinalize(this);
    }

    private BrowserCompatBannerProjection Compute() =>
        BrowserCompatBannerProjection.Project(_source.Current, _dismissalStore.IsDismissed, _localizer);

    private void OnSeamChanged(object? sender, EventArgs e) => Reproject();

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
