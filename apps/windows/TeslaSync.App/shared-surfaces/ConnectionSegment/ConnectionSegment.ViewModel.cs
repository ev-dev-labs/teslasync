using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ConnectionSegment"/> view — the native port of the
/// web component body (web/src/components/layout/status-bar/ConnectionSegment.tsx L29-L86). It binds the
/// <see cref="IConnectionSegmentSource"/> (the P1/S8 <c>useApiHealth</c> seam), recomputes the pure
/// <see cref="ConnectionSegmentProjection"/> for the surface's <see cref="IconOnly"/> mode whenever a fresh probe
/// moves the health, and raises <see cref="PropertyChanged"/> so the view re-renders. <see cref="Dispose"/>
/// unsubscribes from the seam (the web effect cleanup). The view performs no I/O of its own.
/// </summary>
public sealed class ConnectionSegmentViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IConnectionSegmentSource _source;
    private readonly IConnectionSegmentNavigator _navigator;
    private readonly bool _iconOnly;
    private ConnectionSegmentProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, API-connection seam and navigation seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The API-connection state-holder seam (web <c>useApiHealth</c>).</param>
    /// <param name="iconOnly">Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</param>
    /// <param name="navigator">The navigation seam link activation routes through; defaults to <see cref="NullConnectionSegmentNavigator"/>.</param>
    public ConnectionSegmentViewModel(
        ILocalizer localizer,
        IConnectionSegmentSource source,
        bool iconOnly = false,
        IConnectionSegmentNavigator? navigator = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _iconOnly = iconOnly;
        _navigator = navigator ?? NullConnectionSegmentNavigator.Instance;

        _projection = Compute();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>ConnectionSegment</c>).</summary>
    public static string Slug => ConnectionSegmentRegistration.Slug;

    /// <summary>The current render projection (status + brush + glyph + labels + suffix flags + tooltip + aria).</summary>
    public ConnectionSegmentProjection Projection => _projection;

    /// <summary>Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</summary>
    public bool IconOnly => _iconOnly;

    /// <summary>The resolved API-connection health (web <c>status</c>).</summary>
    public ApiHealthStatus Status => _projection.Status;

    /// <summary>The generated design-token brush key the dot, icon and label tint from.</summary>
    public string AccentBrushKey => _projection.AccentBrushKey;

    /// <summary>The Segoe Fluent glyph for the current status.</summary>
    public string IconGlyph => _projection.IconGlyph;

    /// <summary>The localized short "API" label (web <c>cfg[status].short</c>).</summary>
    public string ShortLabel => _projection.ShortLabel;

    /// <summary>The localized state label: Online / Degraded / Offline / Connecting… (web <c>stateLabel[status]</c>).</summary>
    public string StateLabel => _projection.StateLabel;

    /// <summary>The latency display, "{n}ms" or the em dash (web <c>latencyLabel</c>).</summary>
    public string LatencyLabel => _projection.LatencyLabel;

    /// <summary>Whether the chip short label is drawn (web <c>!iconOnly</c>).</summary>
    public bool ShowShortLabel => _projection.ShowShortLabel;

    /// <summary>Whether the latency suffix is drawn (web not-offline / not-unknown with a measurement).</summary>
    public bool ShowLatencySuffix => _projection.ShowLatencySuffix;

    /// <summary>The composed latency suffix, "· {n}ms" (web <c>· {latencyLabel}</c>).</summary>
    public string LatencySuffixText => _projection.LatencySuffixText;

    /// <summary>Whether the offline suffix is drawn (web <c>status === 'offline'</c>).</summary>
    public bool ShowOfflineSuffix => _projection.ShowOfflineSuffix;

    /// <summary>The composed offline suffix, "· Offline" (web <c>· {stateLabel.offline}</c>).</summary>
    public string OfflineSuffixText => _projection.OfflineSuffixText;

    /// <summary>The hover tooltip text (web <c>&lt;Tooltip content&gt;</c>).</summary>
    public string TooltipText => _projection.TooltipText;

    /// <summary>The accessible name (web <c>aria-label</c>).</summary>
    public string AutomationName => _projection.AutomationName;

    /// <summary>The route the link navigates to (web <c>to="/system-status"</c>).</summary>
    public string NavigationTarget => _projection.NavigationTarget;

    /// <summary>
    /// Activate the segment's link — route to <see cref="NavigationTarget"/> through the navigation seam
    /// (web <c>&lt;Link to="/system-status"&gt;</c> click). A no-op when no host router is wired.
    /// </summary>
    public void Navigate() => _navigator.Navigate(_projection.NavigationTarget);

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

    private ConnectionSegmentProjection Compute() =>
        ConnectionSegmentProjection.Project(_source.Current, _iconOnly, _localizer);

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
