using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The unit-preference seam the <see cref="ActiveVehicleSegmentViewModel"/> binds through (P1/S8 state-holder
/// layer) — the native analogue of the web <c>useUnits()</c> hook the segment reads
/// (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx L41-L42). The web component derives its distance
/// unit and label from the user's settings through <c>useUnits().unitPrefs.distance</c> and re-renders when those
/// change; this seam simply exposes the current <see cref="UnitPref"/> and raises <see cref="Changed"/> when the
/// preference is reassigned. The view never touches HTTP or this seam directly — it observes the view-model, which
/// projects the unit preference together with the selected vehicle and its live state. The headless / preview /
/// unit-test default is <see cref="InMemoryActiveVehicleUnitsSource"/>.
/// </summary>
public interface IActiveVehicleUnitsSource
{
    /// <summary>The current unit preference bag (the web <c>useUnits().unitPrefs</c>); never null.</summary>
    UnitPref Preferences { get; }

    /// <summary>Raised whenever <see cref="Preferences"/> changes (the web settings re-render).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IActiveVehicleUnitsSource"/> — the canonical holder the app (or a test) pushes the
/// resolved <see cref="UnitPref"/> into. It mirrors <c>useUnits</c> recomputing <c>unitPrefs</c> when the user
/// changes their distance settings: <see cref="SetPreferences"/> replaces the preference and raises
/// <see cref="Changed"/> so the bound view-model re-projects. It defaults to <see cref="UnitPref.Metric"/>
/// (km, the web default distance unit), so a freshly constructed source renders a meaningful value rather than
/// dereferencing null.
/// </summary>
public sealed class InMemoryActiveVehicleUnitsSource : IActiveVehicleUnitsSource
{
    private UnitPref _preferences;

    /// <summary>Creates a source seeded with the metric default preference (km).</summary>
    public InMemoryActiveVehicleUnitsSource()
        : this(null)
    {
    }

    /// <summary>Creates a source seeded with an initial preference (null uses <see cref="UnitPref.Metric"/>).</summary>
    /// <param name="preferences">The initial unit preference, or null for the metric default.</param>
    public InMemoryActiveVehicleUnitsSource(UnitPref? preferences) => _preferences = preferences ?? UnitPref.Metric;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public UnitPref Preferences => _preferences;

    /// <summary>
    /// Replace the unit preference and notify — the analogue of <c>useUnits</c> recomputing <c>unitPrefs</c> after
    /// a settings change. No-ops when the preference is unchanged (record value equality) so a steady preference
    /// does not churn the view.
    /// </summary>
    /// <param name="preferences">The new unit preference.</param>
    public void SetPreferences(UnitPref preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        if (_preferences.Equals(preferences))
        {
            return;
        }

        _preferences = preferences;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The live-state seam the <see cref="ActiveVehicleSegmentViewModel"/> binds through (P1/S8 state-holder layer) —
/// the native analogue of the web <c>useVehicleState(vehicleId)</c> query the segment reads
/// (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx L36). The web hook returns the selected
/// vehicle's current <c>state</c> (battery level + rated range in SI metres) on a footer-tier polling interval and
/// re-renders the segment when a fresh sample lands; this seam exposes the latest <see cref="ActiveVehicleLiveState"/>
/// for the currently scoped vehicle (or <see langword="null"/> when the query has produced no state — the web
/// <c>liveState</c> falsy case that omits the metrics) and raises <see cref="Changed"/> when it moves. The host
/// keeps <see cref="Current"/> aligned with the scoped vehicle (re-keying the query as the selection changes,
/// matching <c>useVehicleState(vehicleId)</c>); the view never issues the query itself. The headless / preview /
/// unit-test default is <see cref="InMemoryActiveVehicleStateSource"/>.
/// </summary>
public interface IActiveVehicleStateSource
{
    /// <summary>The selected vehicle's latest live state (web <c>useVehicleState().data.state</c>), or null when none.</summary>
    ActiveVehicleLiveState? Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IActiveVehicleStateSource"/> — the canonical holder the app (or a test) pushes the
/// scoped vehicle's live state into. It mirrors the web <c>useVehicleState</c> query result moving: <see cref="Set"/>
/// replaces the snapshot and raises <see cref="Changed"/> so the bound view-model re-projects its metrics. It
/// starts with no state (<see langword="null"/> — the web pre-first-sample default), so a segment bound to it
/// renders without a metrics sub-label until the host supplies a sample.
/// </summary>
public sealed class InMemoryActiveVehicleStateSource : IActiveVehicleStateSource
{
    private ActiveVehicleLiveState? _current;

    /// <summary>Creates a source seeded with an optional initial live state (defaults to none).</summary>
    /// <param name="current">The initial live state, or null for no metrics.</param>
    public InMemoryActiveVehicleStateSource(ActiveVehicleLiveState? current = null) => _current = current;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public ActiveVehicleLiveState? Current => _current;

    /// <summary>
    /// Replace the scoped vehicle's live state and notify — the analogue of the web <c>useVehicleState</c> query
    /// re-resolving as a fresh sample lands (or re-keying to a newly scoped vehicle). No-ops when the snapshot is
    /// unchanged (record value equality / both null) so a steady sample does not churn the view.
    /// </summary>
    /// <param name="current">The new live state, or null to clear the metrics.</param>
    public void Set(ActiveVehicleLiveState? current)
    {
        if (Equals(_current, current))
        {
            return;
        }

        _current = current;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
