using System;
using System.ComponentModel;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AnimatedMarker"/> view — the native port of the web
/// component body (web/src/components/maps/AnimatedMarker.tsx). It binds the <see cref="IAnimatedMarkerSource"/>
/// (the P1/S8 live-position seam) and the <see cref="IAnimatedMarkerMap"/> (the P1/S8 <c>useMap</c> analogue),
/// recomputes the pure <see cref="AnimatedMarkerProjection"/> whenever the fix moves, and — reproducing the web
/// effect — asks the map to pan whenever a fresh fix has scrolled out of the visible bounds
/// (<c>!map.getBounds().contains(target)</c> → <c>map.panTo</c>). It raises <see cref="PropertyChanged"/> so the
/// view re-renders. <see cref="Dispose"/> unsubscribes from the source (the web effect cleanup). The view performs
/// no I/O of its own.
/// </summary>
public sealed class AnimatedMarkerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IAnimatedMarkerSource _source;
    private readonly IAnimatedMarkerMap _map;
    private readonly Func<bool> _reduceMotion;
    private AnimatedMarkerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, live-position seam and map seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The live-position state-holder seam (web <c>position</c> stream).</param>
    /// <param name="map">The map-viewport seam (web <c>useMap()</c>): visible bounds + pan.</param>
    /// <param name="reduceMotion">
    /// Supplies the OS reduced-motion preference each reproject (gates the halo pulse). Defaults to "animate".
    /// </param>
    public AnimatedMarkerViewModel(
        ILocalizer localizer,
        IAnimatedMarkerSource source,
        IAnimatedMarkerMap map,
        Func<bool>? reduceMotion = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(map);

        _localizer = localizer;
        _source = source;
        _map = map;
        _reduceMotion = reduceMotion ?? (static () => false);

        _projection = Compute();
        KeepInView();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>AnimatedMarker</c>).</summary>
    public static string Slug => AnimatedMarkerRegistration.Slug;

    /// <summary>The current render projection (marker placement + chrome + tint + a11y).</summary>
    public AnimatedMarkerProjection Projection => _projection;

    /// <summary>The resolved render state.</summary>
    public AnimatedMarkerVisualState State => _projection.State;

    /// <summary>True when a fix is available to pin the marker to.</summary>
    public bool HasPosition => _projection.HasPosition;

    /// <summary>The geographic fix the marker is pinned to.</summary>
    public GeoPoint Position => _projection.Position;

    /// <summary>True when the coordinate marker is drawn.</summary>
    public bool ShowMarker => _projection.ShowMarker;

    /// <summary>The composed accessible name the view exposes to Narrator.</summary>
    public string AutomationName => _projection.AutomationName;

    /// <summary>Re-attempt the fix after a failure (the error-state retry affordance forwards to the seam).</summary>
    public void Retry()
    {
        if (_disposed)
        {
            return;
        }

        _source.Retry();
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

    private AnimatedMarkerProjection Compute() =>
        AnimatedMarkerProjection.Project(_source.Current, _reduceMotion(), _localizer);

    private void OnSourceChanged(object? sender, EventArgs e) => Reproject();

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        var next = Compute();
        bool changed = next != _projection;
        _projection = next;

        // Reproduce the web effect: keep a fresh fix in view even when it has scrolled off the map.
        KeepInView();

        if (changed)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(State)));
        }
    }

    private void KeepInView()
    {
        if (_projection.HasPosition &&
            AnimatedMarkerGeometry.ShouldPanToKeepInView(_map.VisibleBounds, _projection.Position))
        {
            _map.PanTo(_projection.Position);
        }
    }
}
