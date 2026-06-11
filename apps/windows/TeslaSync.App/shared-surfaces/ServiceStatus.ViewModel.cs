using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ServiceStatusBanner"/> view — the native port of the
/// web <c>ServiceStatusBanner</c> body (web/src/components/data-display/ServiceStatus.tsx L7-41). It binds the
/// <see cref="IServiceStatusConnectionSource"/> (the P1/S8 connection seam, the web <c>onStatusChange</c>
/// subscription), recomputes the pure <see cref="ServiceStatusBannerProjection"/> whenever the connection moves,
/// and raises <see cref="PropertyChanged"/> so the view animates the banner in/out. <see cref="Dispose"/>
/// unsubscribes from the source (the web effect cleanup). The view performs no I/O of its own and reads no
/// connectivity itself; the show/hide animation (and its reduce-motion handling) is a view concern.
/// </summary>
public sealed class ServiceStatusBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IServiceStatusConnectionSource _source;
    private ServiceStatusBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and connection seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade the offline message resolves through.</param>
    /// <param name="source">The connection state-holder seam (web <c>onStatusChange</c>).</param>
    public ServiceStatusBannerViewModel(ILocalizer localizer, IServiceStatusConnectionSource source)
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

    /// <summary>The canonical surface slug (<c>ServiceStatus</c>).</summary>
    public static string Slug => ServiceStatusRegistration.Slug;

    /// <summary>The current render projection (visibility + message + accessible name + live setting).</summary>
    public ServiceStatusBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>isOffline</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized offline message (web literal).</summary>
    public string Message => _projection.Message;

    /// <summary>The accessible name a screen reader announces (the offline message).</summary>
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

    private ServiceStatusBannerProjection Compute() =>
        ServiceStatusBannerProjection.Project(_source.Current, _localizer);

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

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SystemHealthDot"/> view — the native port of the web
/// <c>SystemHealthDot</c> body (web/src/components/data-display/ServiceStatus.tsx L44-74). It binds the
/// <see cref="IServiceStatusHealthSource"/> (the P1/S8 query seam, the web <c>useQuery(['system-status'])</c>),
/// recomputes the pure <see cref="ServiceStatusHealthDotProjection"/> whenever the snapshot moves, and raises
/// <see cref="PropertyChanged"/> so the view re-renders. <see cref="RequestRefresh"/> forwards the 60-second poll
/// tick to the seam (web <c>refetchInterval</c> / <c>query.refetch()</c>); <see cref="Dispose"/> unsubscribes
/// (the web effect cleanup). The view performs no I/O of its own.
/// </summary>
public sealed class ServiceStatusHealthDotViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IServiceStatusHealthSource _source;
    private ServiceStatusHealthDotProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and health seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade the tooltip resolves through.</param>
    /// <param name="source">The system-health state-holder seam (web query result).</param>
    public ServiceStatusHealthDotViewModel(ILocalizer localizer, IServiceStatusHealthSource source)
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

    /// <summary>The canonical surface slug (<c>ServiceStatus</c>).</summary>
    public static string Slug => ServiceStatusRegistration.Slug;

    /// <summary>The current render projection (visibility + level + brush + tooltip + accessible name).</summary>
    public ServiceStatusHealthDotProjection Projection => _projection;

    /// <summary>Whether the dot is rendered (web <c>data</c> resolved).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The resolved health level (web healthy / degraded / else).</summary>
    public ServiceStatusHealthLevel Level => _projection.Level;

    /// <summary>The generated design-token brush key the dot tints from.</summary>
    public string AccentBrushKey => _projection.AccentBrushKey;

    /// <summary>The hover / Narrator tooltip and accessible name (web <c>title</c>).</summary>
    public string Tooltip => _projection.Tooltip;

    /// <summary>Forward the 60-second poll tick to the seam (web <c>refetchInterval</c> / <c>query.refetch()</c>).</summary>
    public void RequestRefresh()
    {
        if (_disposed)
        {
            return;
        }

        _source.Refresh();
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

    private ServiceStatusHealthDotProjection Compute() =>
        ServiceStatusHealthDotProjection.Project(_source.Current, _localizer);

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
