using Microsoft.UI.Dispatching;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Live;

namespace TeslaSync.App.Live;

/// <summary>
/// Binds the headless <see cref="LiveConnectionMonitor"/> to the W2 data-display freshness/live
/// chrome (P2/W6-0001 step 5): it drives a <see cref="TsLiveIndicator"/>'s health pill from the
/// SSE connection lifecycle and opens a <see cref="TsLiveStaleDataBanner"/> when the open stream
/// has been silent past the two-minute freshness window. The connection events are raised on a
/// background loop, so every update is marshalled onto the UI thread via the supplied
/// <see cref="DispatcherQueue"/>.
/// </summary>
public sealed class LiveConnectionPresenter : IDisposable
{
    private readonly DispatcherQueue _dispatcher;
    private readonly TsLiveIndicator _indicator;
    private readonly TsLiveStaleDataBanner _staleBanner;
    private LiveConnectionMonitor? _monitor;
    private bool _disposed;

    /// <summary>Creates the presenter over the UI dispatcher and the two live chrome components.</summary>
    public LiveConnectionPresenter(DispatcherQueue dispatcher, TsLiveIndicator indicator, TsLiveStaleDataBanner staleBanner)
    {
        ArgumentNullException.ThrowIfNull(dispatcher);
        ArgumentNullException.ThrowIfNull(indicator);
        ArgumentNullException.ThrowIfNull(staleBanner);
        _dispatcher = dispatcher;
        _indicator = indicator;
        _staleBanner = staleBanner;
    }

    /// <summary>Binds the chrome to <paramref name="monitor"/>, replacing any previous binding.</summary>
    public void Bind(LiveConnectionMonitor monitor)
    {
        ArgumentNullException.ThrowIfNull(monitor);
        Unbind();
        _monitor = monitor;
        monitor.Changed += OnChanged;
        Apply(monitor.Snapshot());
    }

    /// <summary>Detaches the current monitor, leaving the chrome at its last rendered state.</summary>
    public void Unbind()
    {
        if (_monitor is { } monitor)
        {
            monitor.Changed -= OnChanged;
            _monitor = null;
        }
    }

    private void OnChanged(LiveConnectionSnapshot snapshot)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Apply(snapshot);
            return;
        }

        _dispatcher.TryEnqueue(() => Apply(snapshot));
    }

    private void Apply(LiveConnectionSnapshot snapshot)
    {
        _indicator.State = LiveConnectionMapping.ToIndicatorState(snapshot.EffectiveState);
        _staleBanner.IsOpen = LiveConnectionMapping.ShouldShowStaleBanner(snapshot.EffectiveState);
    }

    /// <summary>Unbinds the monitor.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Unbind();
    }
}
