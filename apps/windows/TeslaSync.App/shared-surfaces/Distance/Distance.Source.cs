using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data seam the <see cref="DistanceViewModel"/> binds to (P1/S8 state-holder seam) — the native analogue
/// of the web <c>useUnits()</c> hook the <c>Distance</c> renderer reads
/// (web/src/components/data-display/format/Distance.tsx). The web component derives its display unit and
/// precision from the user's settings through <c>useUnits().unitPrefs</c> and re-renders when those change;
/// likewise this seam simply exposes the current <see cref="UnitPref"/> and raises <see cref="Changed"/> when
/// the user's preference is reassigned. The view never touches HTTP or this seam directly — it observes the
/// view-model, which projects the unit preference together with the caller-supplied distance.
/// </summary>
public interface IDistanceUnitsSource
{
    /// <summary>The current unit preference bag (the web <c>useUnits().unitPrefs</c>); never null.</summary>
    UnitPref Preferences { get; }

    /// <summary>Raised whenever <see cref="Preferences"/> changes (the web settings re-render).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IDistanceUnitsSource"/> — the canonical holder the app (or a test) pushes the
/// resolved <see cref="UnitPref"/> into. It mirrors <c>useUnits</c> recomputing <c>unitPrefs</c> when the user
/// changes their distance/precision settings: <see cref="SetPreferences"/> replaces the preference and raises
/// <see cref="Changed"/> so the bound view-model re-projects. It defaults to <see cref="UnitPref.Metric"/>
/// (km, the web default distance unit), so a freshly constructed source renders a meaningful value rather than
/// dereferencing null.
/// </summary>
public sealed class DistanceUnitsSource : IDistanceUnitsSource
{
    private UnitPref _preferences;

    /// <summary>Creates a source seeded with the metric default preference (km).</summary>
    public DistanceUnitsSource()
        : this(null)
    {
    }

    /// <summary>Creates a source seeded with an initial preference (null uses <see cref="UnitPref.Metric"/>).</summary>
    /// <param name="preferences">The initial unit preference, or null for the metric default.</param>
    public DistanceUnitsSource(UnitPref? preferences) => _preferences = preferences ?? UnitPref.Metric;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public UnitPref Preferences => _preferences;

    /// <summary>
    /// Replace the unit preference and notify — the analogue of <c>useUnits</c> recomputing <c>unitPrefs</c>
    /// after a settings change. No-ops when the preference is unchanged (record value equality) so a steady
    /// preference does not churn the view.
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
