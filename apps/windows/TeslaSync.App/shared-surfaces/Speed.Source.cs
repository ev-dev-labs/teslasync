using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The unit-preference seam the Speed surface binds through (P1/S8 state-holder layer) — the native analogue of
/// the web <c>useUnits()</c> hook the source consumes (web/src/components/data-display/format/Speed.tsx →
/// web/src/hooks/useUnits.ts). The web hook reads <c>useSettings()</c> once per render and derives a stable
/// <c>unitPrefs</c> bag; the Speed component uses only <c>unitPrefs.speed</c> (plus the precision) to convert and
/// format. This seam exposes the same: the current <see cref="UnitPref"/> and a subscription that fires when the
/// user changes their measurement system at runtime, so the WinUI view can re-render the converted readout — the
/// reactive behaviour <c>useUnits</c> gives for free via React's render cycle. The view never reads settings
/// directly; it binds through <see cref="SpeedViewModel"/> over this seam.
/// </summary>
public interface IUnitPreferenceSource
{
    /// <summary>The current unit preference bag (web <c>useUnits().unitPrefs</c>).</summary>
    UnitPref Current { get; }

    /// <summary>
    /// Subscribe to runtime changes of the unit preference. The callback receives the new <see cref="UnitPref"/>.
    /// Dispose the returned handle to unsubscribe (the web hook's implicit re-render / effect cleanup).
    /// </summary>
    IDisposable Observe(Action<UnitPref> onChanged);
}

/// <summary>
/// An <see cref="IUnitPreferenceSource"/> with a fixed preference and no runtime changes — the headless / unit-test
/// default. It lets the projection and view-model be verified for both metric and imperial without a settings host.
/// <see cref="Observe"/> returns an already-inert handle because the value never changes.
/// </summary>
public sealed class StaticUnitPreferenceSource : IUnitPreferenceSource
{
    /// <summary>Creates a source that always reports <paramref name="pref"/>.</summary>
    public StaticUnitPreferenceSource(UnitPref pref)
    {
        ArgumentNullException.ThrowIfNull(pref);
        Current = pref;
    }

    /// <summary>A shared source reporting the metric defaults (km/h) — a common test default.</summary>
    public static StaticUnitPreferenceSource Metric { get; } = new(UnitPref.Metric);

    /// <summary>A shared source reporting the imperial defaults (mph).</summary>
    public static StaticUnitPreferenceSource Imperial { get; } = new(UnitPref.Imperial);

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
/// The production <see cref="IUnitPreferenceSource"/> — the native port of the web <c>useUnits</c> → <c>useSettings</c>
/// binding (web/src/hooks/useUnits.ts, web/src/hooks/useSettings.ts). It projects the shared
/// <see cref="AppSettingsService"/>'s measurement-system preference to a <see cref="UnitPref"/> via
/// <see cref="AppSettings.ToUnitPref"/> and re-derives it whenever the service raises
/// <see cref="AppSettingsService.Changed"/>. Like the web hook — which memoises <c>unitPrefs</c> over the unit
/// primitives so unrelated settings changes don't churn consumers — it fires the observer callback only when the
/// derived <see cref="UnitPref"/> actually changes, so a theme or density toggle never forces a Speed re-render.
/// WinUI-free: it depends only on the shared settings/units core, so it is exercised headlessly by the test host.
/// </summary>
public sealed class AppSettingsUnitPreferenceSource : IUnitPreferenceSource
{
    private readonly AppSettingsService _service;

    /// <summary>Creates the source over the shared settings service (the process-singleton in production).</summary>
    public AppSettingsUnitPreferenceSource(AppSettingsService service)
    {
        ArgumentNullException.ThrowIfNull(service);
        _service = service;
    }

    /// <inheritdoc />
    public UnitPref Current => _service.Current.ToUnitPref();

    /// <inheritdoc />
    public IDisposable Observe(Action<UnitPref> onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);

        UnitPref last = _service.Current.ToUnitPref();

        void Handler(object? sender, AppSettings settings)
        {
            UnitPref next = settings.ToUnitPref();

            // web useUnits: unitPrefs is memoised over the unit primitives — only a real unit change propagates.
            if (next.Equals(last))
            {
                return;
            }

            last = next;
            onChanged(next);
        }

        _service.Changed += Handler;
        return new Subscription(() => _service.Changed -= Handler);
    }

    private sealed class Subscription : IDisposable
    {
        private Action? _unsubscribe;

        public Subscription(Action unsubscribe) => _unsubscribe = unsubscribe;

        public void Dispose()
        {
            Interlocked.Exchange(ref _unsubscribe, null)?.Invoke();
        }
    }
}
