using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces.TemperatureSurface;

/// <summary>
/// The unit-preference seam the <see cref="TemperatureViewModel"/> binds through (P1/S8 state-holder layer) —
/// the native analogue of the web <c>useUnits()</c> hook the source relies on
/// (web/src/components/data-display/format/Temperature.tsx reads <c>unitPrefs.temperature</c> for both the
/// conversion target and the unit suffix). The web component reads the preference declaratively through the
/// hook and re-renders when the user changes their °C/°F setting; the WinUI view has to source the current
/// <see cref="UnitPref"/> and react when it changes at runtime, so that responsibility is expressed as this
/// small seam. The production implementation is supplied by the host (the app's <c>useUnits</c>-equivalent
/// settings state-holder); <see cref="StaticUnitPreferenceSource"/> stands in for headless hosts and unit
/// tests so the projection / view-model can be exercised without the settings store, and
/// <see cref="MutableUnitPreferenceSource"/> drives the runtime-change branch.
/// </summary>
public interface IUnitPreferenceSource
{
    /// <summary>The current unit preference bag (web <c>useUnits().unitPrefs</c>).</summary>
    UnitPref Preferences { get; }

    /// <summary>
    /// Subscribe to runtime changes of the unit preference. The callback receives the new
    /// <see cref="UnitPref"/>. Dispose the returned handle to unsubscribe (the web hook re-render / effect
    /// cleanup).
    /// </summary>
    /// <param name="onChanged">Invoked with the new preference whenever it changes.</param>
    IDisposable Observe(Action<UnitPref> onChanged);
}

/// <summary>
/// An <see cref="IUnitPreferenceSource"/> with a fixed <see cref="UnitPref"/> and no runtime changes — the
/// headless / unit-test default. It lets the projection and view-model be verified for both the metric (°C)
/// and imperial (°F) branches without a settings host. <see cref="Observe"/> returns an already-inert handle
/// because the value never changes.
/// </summary>
public sealed class StaticUnitPreferenceSource : IUnitPreferenceSource
{
    /// <summary>Creates a source that always reports <paramref name="preferences"/>.</summary>
    /// <param name="preferences">The fixed unit preference.</param>
    public StaticUnitPreferenceSource(UnitPref preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        Preferences = preferences;
    }

    /// <summary>A shared source reporting the metric defaults (°C) — the common test default.</summary>
    public static StaticUnitPreferenceSource Metric { get; } = new(UnitPref.Metric);

    /// <summary>A shared source reporting the imperial defaults (°F).</summary>
    public static StaticUnitPreferenceSource Imperial { get; } = new(UnitPref.Imperial);

    /// <inheritdoc />
    public UnitPref Preferences { get; }

    /// <inheritdoc />
    public IDisposable Observe(Action<UnitPref> onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);
        return NoOpSubscription.Instance;
    }

    private sealed class NoOpSubscription : IDisposable
    {
        public static NoOpSubscription Instance { get; } = new();

        private NoOpSubscription()
        {
        }

        public void Dispose()
        {
            // The value never changes, so nothing was subscribed.
        }
    }
}

/// <summary>
/// A mutable in-memory <see cref="IUnitPreferenceSource"/> — the headless analogue of the web settings
/// preference changing at runtime. It starts at an initial <see cref="UnitPref"/> and exposes
/// <see cref="Set"/> to simulate the user switching °C ⇄ °F, notifying observers exactly once per distinct
/// change. Used by tests (and hosts that own their own settings stream) to drive the unit re-projection; the
/// production host supplies its own settings-backed implementation.
/// </summary>
public sealed class MutableUnitPreferenceSource : IUnitPreferenceSource
{
    private readonly List<Action<UnitPref>> _observers = new();
    private UnitPref _preferences;

    /// <summary>Creates the source at an initial preference.</summary>
    /// <param name="preferences">The initial unit preference.</param>
    public MutableUnitPreferenceSource(UnitPref preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        _preferences = preferences;
    }

    /// <inheritdoc />
    public UnitPref Preferences => _preferences;

    /// <summary>The number of live observers (test introspection).</summary>
    public int ObserverCount => _observers.Count;

    /// <inheritdoc />
    public IDisposable Observe(Action<UnitPref> onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);
        _observers.Add(onChanged);
        return new Subscription(this, onChanged);
    }

    /// <summary>
    /// Push a new unit preference (the user switching °C ⇄ °F). Notifies observers once with the new value; a
    /// no-op when the preference is unchanged.
    /// </summary>
    /// <param name="preferences">The new unit preference.</param>
    public void Set(UnitPref preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        if (_preferences == preferences)
        {
            return;
        }

        _preferences = preferences;
        foreach (Action<UnitPref> observer in _observers.ToArray())
        {
            observer(preferences);
        }
    }

    private sealed class Subscription : IDisposable
    {
        private readonly MutableUnitPreferenceSource _owner;
        private readonly Action<UnitPref> _observer;
        private bool _disposed;

        public Subscription(MutableUnitPreferenceSource owner, Action<UnitPref> observer)
        {
            _owner = owner;
            _observer = observer;
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _owner._observers.Remove(_observer);
        }
    }
}
