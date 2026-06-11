using System.Collections.Generic;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data seam the <see cref="ElevationProfileViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the props the web <c>ElevationProfile</c> receives from its parent replay page
/// (web/src/components/charts/ElevationProfile.tsx L22-L29: <c>data</c>, <c>currentIndex</c>,
/// <c>distanceUnit</c>). The web component is presentational and never fetches; likewise this seam simply
/// holds the already-resolved elevation series, the selected cursor frame and the distance unit, and raises
/// <see cref="Changed"/> when any of them is reassigned (the analogue of the parent re-rendering with new
/// props). The view never touches HTTP or this seam directly — it observes the view-model.
/// </summary>
public interface IElevationProfileSource
{
    /// <summary>The elevation samples to plot (newest props win); never null.</summary>
    IReadOnlyList<ElevationSample> Samples { get; }

    /// <summary>The selected sample index for the cursor reference line, or null (web <c>currentIndex</c>).</summary>
    int? CurrentIndex { get; }

    /// <summary>The distance-axis display unit (web <c>distanceUnit</c>, e.g. <c>km</c>).</summary>
    string DistanceUnit { get; }

    /// <summary>Raised whenever the samples, cursor index or unit change.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IElevationProfileSource"/> — the canonical holder a replay page (or a test)
/// pushes the elevation series and the live playhead into. It mirrors a parent passing fresh props to the
/// web <c>ElevationProfile</c>: <see cref="SetData"/> replaces the series (and optionally the unit) and
/// <see cref="SetCurrentIndex"/> moves the cursor, each raising <see cref="Changed"/> so the bound
/// view-model re-projects. A null series collapses to an empty series so the view-model renders the empty
/// state rather than dereferencing null.
/// </summary>
public sealed class ElevationProfileSource : IElevationProfileSource
{
    private IReadOnlyList<ElevationSample> _samples;
    private int? _currentIndex;
    private string _distanceUnit;

    /// <summary>Creates an empty source (no samples, no cursor, the default distance unit).</summary>
    public ElevationProfileSource()
        : this([], currentIndex: null, distanceUnit: null)
    {
    }

    /// <summary>Creates a source seeded with an initial series, cursor frame and distance unit.</summary>
    public ElevationProfileSource(
        IReadOnlyList<ElevationSample> samples,
        int? currentIndex = null,
        string? distanceUnit = null)
    {
        _samples = samples ?? [];
        _currentIndex = currentIndex;
        _distanceUnit = string.IsNullOrEmpty(distanceUnit)
            ? ElevationProfileRegistration.DefaultDistanceUnit
            : distanceUnit;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<ElevationSample> Samples => _samples;

    /// <inheritdoc />
    public int? CurrentIndex => _currentIndex;

    /// <inheritdoc />
    public string DistanceUnit => _distanceUnit;

    /// <summary>
    /// Replace the plotted series (a null list becomes empty) and, when supplied, the distance unit, then
    /// notify — the analogue of the parent passing a new <c>data</c> / <c>distanceUnit</c> prop.
    /// </summary>
    public void SetData(IReadOnlyList<ElevationSample> samples, string? distanceUnit = null)
    {
        _samples = samples ?? [];
        if (!string.IsNullOrEmpty(distanceUnit))
        {
            _distanceUnit = distanceUnit;
        }

        RaiseChanged();
    }

    /// <summary>
    /// Move the cursor to <paramref name="index"/> (or clear it with null) — the analogue of the parent
    /// passing a new <c>currentIndex</c> prop as the replay playhead advances. No-ops when unchanged so a
    /// steady playhead does not churn the view.
    /// </summary>
    public void SetCurrentIndex(int? index)
    {
        if (_currentIndex == index)
        {
            return;
        }

        _currentIndex = index;
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
