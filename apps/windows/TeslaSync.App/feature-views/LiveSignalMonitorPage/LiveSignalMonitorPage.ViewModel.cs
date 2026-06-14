using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>LiveSignalMonitorPage</c> view — the native port of the
/// web page's tail state (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx +
/// web/src/features/telemetry/hooks/useLiveSignalStream.ts). It owns the newest-first rolling buffer
/// (capped at <see cref="LiveSignalMonitorRegistration.TailMax"/>, web <c>TAIL_MAX</c>), the signals/sec
/// rate counter (web's 1 Hz reset), the pause / auto-scroll / filter controls and the connection state, and
/// projects the result through <see cref="LiveSignalMonitorProjection"/> so the view is a thin renderer.
/// The view subscribes to the <see cref="ILiveSignalMonitorFeed"/>, marshals each event onto the UI thread,
/// and feeds it here (<see cref="ApplyVehicleUpdate"/> / <see cref="SetConnected"/>); drive it from one
/// confinement (the UI thread) — it is not internally synchronised. Observable via <see cref="PropertyChanged"/>.
/// </summary>
public sealed class LiveSignalMonitorPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly int _bufferMax;

    private long _vehicleId;
    private bool _connected;
    private bool _connecting;
    private bool _errored;
    private bool _paused;
    private bool _autoScroll = true;
    private string _filter = string.Empty;
    private IReadOnlyList<SignalTailEntry> _entries = Array.Empty<SignalTailEntry>();
    private int _rate;
    private int _rateAccumulator;
    private long _idSeed;

    private LiveSignalMonitorDisplay _display;

    /// <summary>Creates the holder over its localizer, the selected vehicle and the buffer cap.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The selected vehicle id (web <c>useSelectedVehicle</c>); 0 = none/all.</param>
    /// <param name="bufferMax">The rolling-buffer cap (web <c>TAIL_MAX</c>); defaults to 500.</param>
    public LiveSignalMonitorPageViewModel(
        ILocalizer localizer,
        long vehicleId = 0,
        int bufferMax = LiveSignalMonitorRegistration.TailMax)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _vehicleId = vehicleId;
        _bufferMax = bufferMax > 0 ? bufferMax : LiveSignalMonitorRegistration.TailMax;
        _display = LiveSignalMonitorProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public LiveSignalMonitorDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The page title (web <c>liveMonitor.title</c>) — the PageContainer chrome.</summary>
    public string Title => _localizer.GetString("liveMonitor.title", "Live Signal Monitor");

    /// <summary>The page subtitle (web <c>liveMonitor.subtitle</c>) — the PageContainer chrome.</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>Whether auto-scroll keeps the newest row in view (web local <c>autoScroll</c>).</summary>
    public bool IsAutoScroll => _autoScroll;

    /// <summary>Point the tail at a different vehicle (web vehicle-picker change); clears the buffer.</summary>
    public void SetVehicle(long vehicleId)
    {
        if (_vehicleId == vehicleId)
        {
            return;
        }

        _vehicleId = vehicleId;
        ResetBuffers();
        Reproject();
    }

    /// <summary>Mark the SSE connection state (web <c>live.connected</c>); a live stream clears the shimmer.</summary>
    public void SetConnected(bool connected)
    {
        bool changed = _connected != connected;
        if (connected && _connecting)
        {
            _connecting = false;
            changed = true;
        }

        if (!changed)
        {
            return;
        }

        _connected = connected;
        Reproject();
    }

    /// <summary>Mark that the first connection is being established (drives the loading shimmer).</summary>
    public void SetConnecting(bool connecting)
    {
        if (_connecting == connecting)
        {
            return;
        }

        _connecting = connecting;
        Reproject();
    }

    /// <summary>Mark the stream as failed (drives the error/retry branch) or recovered.</summary>
    public void SetErrored(bool errored)
    {
        if (_errored == errored)
        {
            return;
        }

        _errored = errored;
        if (!errored)
        {
            // Recovered: drop the shimmer too so the body resolves to waiting/streaming.
            _connecting = false;
        }

        Reproject();
    }

    /// <summary>
    /// Apply one batched <c>vehicle_update</c> (web <c>handleVehicleUpdate</c>): when not paused, extract the
    /// tail rows scoped to the selected vehicle, stamp them with monotonic ids, prepend them newest-first,
    /// cap the buffer, and add their count to the rate accumulator. A paused tail or an empty batch is a no-op.
    /// </summary>
    public void ApplyVehicleUpdate(VehicleUpdateSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        if (_paused)
        {
            return;
        }

        var parsed = LiveSignalTailParser.Extract(snapshot.Data, _vehicleId, snapshot.ReceivedAt);
        if (parsed.Count == 0)
        {
            return;
        }

        var batch = new List<SignalTailEntry>(parsed.Count);
        foreach (var signal in parsed)
        {
            _idSeed++;
            batch.Add(new SignalTailEntry(_idSeed, signal.Name, signal.Value, signal.Type, signal.Timestamp));
        }

        var combined = new List<SignalTailEntry>(batch.Count + _entries.Count);
        combined.AddRange(batch);
        combined.AddRange(_entries);
        if (combined.Count > _bufferMax)
        {
            combined.RemoveRange(_bufferMax, combined.Count - _bufferMax);
        }

        _entries = combined;
        _rateAccumulator += batch.Count;
        _connecting = false;
        Reproject();
    }

    /// <summary>Advance the 1 Hz rate window (web's per-second interval): publish the accumulated count and reset.</summary>
    public void AdvanceRateWindow()
    {
        int next = _rateAccumulator;
        _rateAccumulator = 0;
        if (next == _rate)
        {
            return;
        }

        _rate = next;
        Reproject();
    }

    /// <summary>Set the signal-name filter (web local <c>filter</c>).</summary>
    public void SetFilter(string? filter)
    {
        string next = filter ?? string.Empty;
        if (string.Equals(_filter, next, StringComparison.Ordinal))
        {
            return;
        }

        _filter = next;
        Reproject();
    }

    /// <summary>Toggle the tail pause state (web <c>onPauseToggle</c>).</summary>
    public void TogglePaused() => SetPaused(!_paused);

    /// <summary>Set the tail pause state (web <c>setTailPaused</c>).</summary>
    public void SetPaused(bool paused)
    {
        if (_paused == paused)
        {
            return;
        }

        _paused = paused;
        Reproject();
    }

    /// <summary>Toggle auto-scroll (web local <c>setAutoScroll</c>).</summary>
    public void ToggleAutoScroll() => SetAutoScroll(!_autoScroll);

    /// <summary>Set auto-scroll (web local <c>autoScroll</c>).</summary>
    public void SetAutoScroll(bool autoScroll)
    {
        if (_autoScroll == autoScroll)
        {
            return;
        }

        _autoScroll = autoScroll;
        Reproject();
    }

    /// <summary>Clear the tail buffer (web <c>clearTail</c>): empties the rows and resets the id counter.</summary>
    public void Clear()
    {
        if (_entries.Count == 0)
        {
            return;
        }

        _entries = Array.Empty<SignalTailEntry>();
        _idSeed = 0;
        Reproject();
    }

    private void ResetBuffers()
    {
        _entries = Array.Empty<SignalTailEntry>();
        _idSeed = 0;
        _rate = 0;
        _rateAccumulator = 0;
    }

    private LiveSignalMonitorModel BuildModel() => new(
        VehicleId: _vehicleId,
        Connected: _connected,
        Connecting: _connecting,
        Errored: _errored,
        Paused: _paused,
        AutoScroll: _autoScroll,
        Filter: _filter,
        Entries: _entries,
        Rate: _rate,
        BufferMax: _bufferMax);

    private void Reproject() => Display = LiveSignalMonitorProjection.Project(BuildModel(), _localizer);

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
