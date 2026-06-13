using System.ComponentModel;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ActiveVehicleSegment"/> view — the native port of the
/// web component body (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx L27-L183). It binds the shared
/// P1/S8 <see cref="VehicleSelectState"/> holder (the native equivalent of the web <c>useSelectedVehicle()</c> /
/// <c>useVehicles()</c> store: the cached fleet plus the clamped scope id), the <see cref="IActiveVehicleUnitsSource"/>
/// seam (the web <c>useUnits()</c> distance preference) and the <see cref="IActiveVehicleStateSource"/> seam (the
/// web <c>useVehicleState(vehicleId)</c> live read), and projects every change through
/// <see cref="ActiveVehicleSegmentProjection"/> into a render-ready <see cref="Projection"/>: the hidden / single /
/// switcher status, the selected-or-first vehicle label, the optional battery / range metrics, the tooltip, the
/// accessible names and the popover rows. <see cref="Pick"/> commits a chosen vehicle back to the shared scope
/// (web <c>setVehicleId</c>). Every label resolves through the i18n facade (<see cref="ILocalizer"/>, P1/S10). The
/// view binds the projected state and performs no I/O; drive it from one confinement (the UI thread).
/// <see cref="Dispose"/> detaches from all three seams (the web effect cleanup); idempotent.
/// </summary>
public sealed class ActiveVehicleSegmentViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly VehicleSelectState _state;
    private readonly IActiveVehicleUnitsSource _units;
    private readonly IActiveVehicleStateSource _liveState;
    private readonly ILocalizer _localizer;
    private readonly bool _iconOnly;

    private ActiveVehicleSegmentProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the shared fleet state, the units seam, the live-state seam and the i18n facade.</summary>
    /// <param name="state">The shared P1/S8 fleet + scope holder (web <c>useSelectedVehicle()</c> / <c>useVehicles()</c>).</param>
    /// <param name="units">The unit-preference seam (web <c>useUnits()</c>).</param>
    /// <param name="liveState">The live-state seam (web <c>useVehicleState(vehicleId)</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="iconOnly">Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</param>
    public ActiveVehicleSegmentViewModel(
        VehicleSelectState state,
        IActiveVehicleUnitsSource units,
        IActiveVehicleStateSource liveState,
        ILocalizer localizer,
        bool iconOnly = false)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(liveState);
        ArgumentNullException.ThrowIfNull(localizer);

        _state = state;
        _units = units;
        _liveState = liveState;
        _localizer = localizer;
        _iconOnly = iconOnly;

        _projection = Compute();

        _state.PropertyChanged += OnStateChanged;
        _units.Changed += OnSourceChanged;
        _liveState.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>ActiveVehicleSegment</c>).</summary>
    public static string Slug => ActiveVehicleSegmentRegistration.Slug;

    /// <summary>The current render projection (status + label + metrics + tooltip + aria + popover rows).</summary>
    public ActiveVehicleSegmentProjection Projection => _projection;

    /// <summary>The resolved vehicle-count state (web <c>vehicles.length</c> branch).</summary>
    public ActiveVehicleSegmentStatus Status => _projection.Status;

    /// <summary>Whether the surface is shown at all (web: not the empty-fleet <c>return null</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>Whether the surface is the interactive switcher (web: the multi-vehicle popover button).</summary>
    public bool IsInteractive => _projection.IsInteractive;

    /// <summary>Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</summary>
    public bool IconOnly => _iconOnly;

    /// <summary>The effective selected vehicle id (web <c>vehicleId</c>), or null.</summary>
    public long? SelectedId => _projection.SelectedId;

    /// <summary>
    /// Commit a chosen vehicle back to the shared scope (web <c>pick</c> → <c>setVehicleId</c>). The id is clamped
    /// to a known fleet member by the holder; an unknown id clears the scope. Returns true when the committed scope
    /// id changed.
    /// </summary>
    /// <param name="id">The vehicle id to scope to (web <c>v.id</c>).</param>
    public bool Pick(long id)
    {
        var before = _state.SelectedId;
        _state.SelectedId = id;
        return _state.SelectedId != before;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _state.PropertyChanged -= OnStateChanged;
        _units.Changed -= OnSourceChanged;
        _liveState.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private ActiveVehicleSegmentProjection Compute() =>
        ActiveVehicleSegmentProjection.Project(
            _state.Vehicles,
            _state.SelectedId,
            _liveState.Current,
            _units.Preferences,
            _iconOnly,
            _localizer);

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e) => Reproject();

    private void OnSourceChanged(object? sender, EventArgs e) => Reproject();

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        _projection = Compute();
        PropertyChanged?.Invoke(this, AllProperties);
    }
}
