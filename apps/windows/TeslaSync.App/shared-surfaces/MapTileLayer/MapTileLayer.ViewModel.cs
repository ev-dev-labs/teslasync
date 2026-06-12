using System.ComponentModel;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="MapTileLayer"/> view — the native port of the web
/// <c>MapTileLayer</c> body (web/src/components/maps/MapTileLayer.tsx L54-69). It binds the
/// <see cref="IMapTileLayerSource"/> (the P1/S8 map-config seam, the web <c>useQuery(['map-config'])</c>),
/// recomputes the pure <see cref="MapTileLayerProjection"/> whenever the snapshot moves, and raises
/// <see cref="PropertyChanged"/> so the view re-renders the tiles and overlay chrome. <see cref="RequestRefresh"/>
/// forwards a manual refresh to the seam (web <c>query.refetch()</c>); <see cref="Dispose"/> unsubscribes (the web
/// effect cleanup). The view performs no I/O of its own.
/// </summary>
public sealed class MapTileLayerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IMapTileLayerSource _source;
    private MapTileLayerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and map-config seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The map-config state-holder seam (web query result).</param>
    public MapTileLayerViewModel(ILocalizer localizer, IMapTileLayerSource source)
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

    /// <summary>The canonical surface slug (<c>MapTileLayer</c>).</summary>
    public static string Slug => MapTileLayerRegistration.Slug;

    /// <summary>The current render projection (state + config + attribution + overlay gates + localized strings).</summary>
    public MapTileLayerProjection Projection => _projection;

    /// <summary>The resolved render state (web query lifecycle).</summary>
    public MapTileLayerVisualState State => _projection.State;

    /// <summary>The map configuration the tile renderer consumes (carries the provider key; never logged).</summary>
    public MapConfig Config => _projection.Config;

    /// <summary>The active base-map style.</summary>
    public MapStyleKind Style => _projection.Style;

    /// <summary>The provider's required attribution text (a brand string).</summary>
    public string Attribution => _projection.Attribution;

    /// <summary>The accessible name a screen reader announces (provider + style; no key material).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>Whether the busy overlay shows (web query in flight with no value).</summary>
    public bool ShowLoading => _projection.ShowLoading;

    /// <summary>Whether the error overlay + retry show (config query hard-failed with no value).</summary>
    public bool ShowError => _projection.ShowError;

    /// <summary>Whether the stale-cache chip shows.</summary>
    public bool ShowStaleChip => _projection.ShowStaleChip;

    /// <summary>Whether the offline chip shows.</summary>
    public bool ShowOfflineChip => _projection.ShowOfflineChip;

    /// <summary>Whether the empty-state note shows (no provider configured, free tiles shown).</summary>
    public bool ShowEmptyNote => _projection.ShowEmptyNote;

    /// <summary>Forward a manual refresh to the seam (web <c>query.refetch()</c>).</summary>
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

    private MapTileLayerProjection Compute() => MapTileLayerProjection.Project(_source.Current, _localizer);

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
