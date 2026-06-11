using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The pressure-unit preference seam the Pressure surface binds through (P1/S8 state-holder layer) — the
/// native analogue of the web <c>useUnits()</c> hook the source reads (<c>unitPrefs.pressure</c> in
/// <c>web/src/components/data-display/format/Pressure.tsx</c>, which itself derives from
/// <c>useSettings()</c>). The web component reads the preference synchronously per render and re-renders when
/// the user changes it; the WinUI view sources the current <see cref="UnitPref"/> and reacts to runtime
/// changes through this small seam so the view never touches settings or the network directly. The production
/// implementation (<see cref="SettingsPressureUnitSource"/>) adapts the W8 <see cref="AppSettingsService"/>;
/// <see cref="StaticPressureUnitSource"/> stands in for headless hosts and unit tests so the projection /
/// view-model can be exercised without a settings store.
/// </summary>
public interface IPressureUnitSource
{
    /// <summary>The current unit preference bag (the web <c>useUnits().unitPrefs</c> snapshot).</summary>
    UnitPref Current { get; }

    /// <summary>
    /// Subscribe to runtime changes of the unit preference. The callback receives the new bag. Dispose the
    /// returned handle to unsubscribe (the web <c>useSettings</c> subscription / effect cleanup).
    /// </summary>
    IDisposable Observe(Action<UnitPref> onChanged);
}

/// <summary>
/// An <see cref="IPressureUnitSource"/> with a fixed preference and no runtime changes — the headless /
/// unit-test default. It lets the projection and view-model be verified for the metric (kPa), imperial (psi)
/// and bar branches without a settings host. <see cref="Observe"/> returns an already-inert handle because the
/// value never changes.
/// </summary>
public sealed class StaticPressureUnitSource : IPressureUnitSource
{
    /// <summary>Creates a source that always reports <paramref name="pref"/>.</summary>
    /// <param name="pref">The fixed unit preference bag.</param>
    public StaticPressureUnitSource(UnitPref pref)
    {
        ArgumentNullException.ThrowIfNull(pref);
        Current = pref;
    }

    /// <summary>A shared source reporting the metric defaults (pressure renders in kPa).</summary>
    public static StaticPressureUnitSource Metric { get; } = new(UnitPref.Metric);

    /// <summary>A shared source reporting the imperial defaults (pressure renders in psi).</summary>
    public static StaticPressureUnitSource Imperial { get; } = new(UnitPref.Imperial);

    /// <inheritdoc />
    public UnitPref Current { get; }

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
/// The production <see cref="IPressureUnitSource"/> — the native analogue of the web <c>useUnits()</c> bridge
/// from <c>useSettings()</c> to the formatters. It reads the current <see cref="UnitPref"/> from the W8
/// <see cref="AppSettingsService"/> (via <see cref="AppSettings.ToUnitPref"/>) and forwards every committed
/// settings change (<see cref="AppSettingsService.Changed"/>) so the surface re-renders live when the user
/// flips the measurement system — mirroring the shell's "re-apply units live" contract. It is WinUI-free so it
/// is exercised headlessly; the view binds through it rather than reaching into settings itself.
/// </summary>
public sealed class SettingsPressureUnitSource : IPressureUnitSource
{
    private readonly AppSettingsService _settings;

    /// <summary>Creates the source over the W8 settings service.</summary>
    /// <param name="settings">The application settings service (the units state holder).</param>
    public SettingsPressureUnitSource(AppSettingsService settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _settings = settings;
    }

    /// <inheritdoc />
    public UnitPref Current => _settings.Current.ToUnitPref();

    /// <inheritdoc />
    public IDisposable Observe(Action<UnitPref> onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);

        void Handler(object? sender, AppSettings settings) => onChanged(settings.ToUnitPref());
        _settings.Changed += Handler;
        return new Subscription(_settings, Handler);
    }

    private sealed class Subscription : IDisposable
    {
        private readonly AppSettingsService _settings;
        private EventHandler<AppSettings>? _handler;

        public Subscription(AppSettingsService settings, EventHandler<AppSettings> handler)
        {
            _settings = settings;
            _handler = handler;
        }

        public void Dispose()
        {
            if (_handler is null)
            {
                return;
            }

            _settings.Changed -= _handler;
            _handler = null;
        }
    }
}
