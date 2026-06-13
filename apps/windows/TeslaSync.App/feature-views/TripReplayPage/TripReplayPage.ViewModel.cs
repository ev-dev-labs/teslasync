using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>TripReplayPage</c> view — the native port of the web page's
/// data flow (web/src/features/trips/pages/TripReplayPage.tsx). It reads one drive snapshot through the injected
/// <see cref="ITripReplayPageFeed"/> (the native <c>useDrive(id)</c>), projects it through
/// <see cref="TripReplayPageProjection"/> with the active units and clock, and owns the shared replay clock
/// (<see cref="TripReplayEngine"/>, the native <c>useTripReplay</c>) that threads a single source of truth —
/// <see cref="CurrentIndex"/> — through the map playhead, the chart cursor, the scrubber and the per-frame
/// current-stat tiles. Observable so the view re-renders on <see cref="PropertyChanged"/>; replay-clock changes
/// fan out through <see cref="ReplayStateChanged"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class TripReplayPageViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly IReadOnlyList<TripReplayPagePosition> NoPositions = Array.Empty<TripReplayPagePosition>();

    private readonly ITripReplayPageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly TripReplayPageDiagnostics _diagnostics;
    private readonly TripReplayEngine _engine = new();
    private readonly long _driveId;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private TripReplayPageSnapshot _snapshot = TripReplayPageSnapshot.Empty;
    private IReadOnlyList<TripReplayPagePosition> _positions = NoPositions;
    private bool _hasData;
    private bool _loading = true;
    private string? _errorDetail;

    private TripReplayPageState _state = TripReplayPageState.Loading;
    private TripReplayPageDisplay _display;
    private IReadOnlyList<TripReplayMetric> _currentStats;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer, drive id, units and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The drive data port (native <c>useDrive</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="driveId">The drive id from the route (web <c>:id</c> param).</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="clock">Injectable clock for deterministic freshness / date formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TripReplayPageViewModel(
        ITripReplayPageFeed feed,
        ILocalizer localizer,
        long driveId,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        TripReplayPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _driveId = driveId;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new TripReplayPageDiagnostics();
        _display = TripReplayPageProjection.Project(BuildModel(), _units, _localizer, _clock());
        _currentStats = TripReplayPageProjection.CurrentStats(_positions, 0, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised whenever the replay clock changes (play/pause/seek/tick/speed) — the view repaints the playhead-derived surfaces.</summary>
    public event EventHandler? ReplayStateChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public TripReplayPageState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready page content the view binds to.</summary>
    public TripReplayPageDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The six current-position metric tiles for the current playhead (web "Current Position Stats").</summary>
    public IReadOnlyList<TripReplayMetric> CurrentStats
    {
        get => _currentStats;
        private set => Set(ref _currentStats, value);
    }

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _errorDetail is not null;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The drive id this holder is bound to.</summary>
    public long DriveId => _driveId;

    // ── Replay clock (web useTripReplay) ──────────────────────────────────────────────────────────────────

    /// <summary>True while the replay clock is advancing (web <c>isPlaying</c>).</summary>
    public bool IsPlaying => _engine.IsPlaying;

    /// <summary>The active speed multiplier (web <c>speed</c>).</summary>
    public int Speed => _engine.Speed;

    /// <summary>The playhead sample index (web <c>currentIndex</c>) the map / chart / scrubber all track.</summary>
    public int CurrentIndex => _engine.CurrentIndex;

    /// <summary>Elapsed replay time in seconds (web <c>elapsedTime</c> / 1000).</summary>
    public double ElapsedSeconds => _engine.ElapsedMs / 1000.0;

    /// <summary>Total replay time in seconds (web <c>totalTime</c> / 1000).</summary>
    public double TotalSeconds => _engine.TotalMs / 1000.0;

    /// <summary>Fraction of the drive elapsed, clamped to <c>[0, 1]</c> (web <c>progress</c>).</summary>
    public double Progress => _engine.Progress;

    /// <summary>True when there is a plottable timeline to replay.</summary>
    public bool HasTimeline => _engine.PositionCount > 0;

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the drive load and fold the result into the data state + replay timeline.</summary>
    /// <param name="cancellationToken">Cancels the load (a newer load supersedes an older one).</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasData)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(_driveId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _positions = snapshot.Drive?.Positions ?? NoPositions;
            _hasData = snapshot.HasDrive;
            _errorDetail = null;
            _loading = false;
            _updatedAt = _clock();
            ResetTimeline();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            SetError(ex.Message);
        }
        catch (Exception ex)
        {
            SetError(ex.Message);
        }

        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
        RaiseReplayChanged();
    }

    /// <summary>Refresh the drive (web query refetch / Retry).</summary>
    /// <param name="cancellationToken">Cancels the refresh.</param>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    // ── Replay commands (web ReplayControls) ──────────────────────────────────────────────────────────────

    /// <summary>Toggle play/pause (web play / pause).</summary>
    public void TogglePlay()
    {
        if (_engine.IsPlaying)
        {
            _engine.Pause();
        }
        else
        {
            _engine.Play();
        }

        RaiseReplayChanged();
    }

    /// <summary>Start (or resume) playback (web <c>play</c>).</summary>
    public void Play()
    {
        _engine.Play();
        RaiseReplayChanged();
    }

    /// <summary>Pause playback (web <c>pause</c>).</summary>
    public void Pause()
    {
        _engine.Pause();
        RaiseReplayChanged();
    }

    /// <summary>Stop and rewind to the start (web <c>stop</c>).</summary>
    public void Stop()
    {
        _engine.Stop();
        RaiseReplayChanged();
    }

    /// <summary>Set the absolute speed multiplier (web <c>setSpeed</c>).</summary>
    /// <param name="speed">The speed multiplier (a <see cref="PlaybackSpeed.Speeds"/> slot).</param>
    public void SetSpeed(int speed)
    {
        _engine.SetSpeed(speed);
        RaiseReplayChanged();
    }

    /// <summary>Step the speed by <paramref name="delta"/> slots, clamped (web <c>setSpeedRelative</c>).</summary>
    /// <param name="delta">Signed slot delta.</param>
    public void SetSpeedRelative(int delta)
    {
        _engine.SetSpeedRelative(delta);
        RaiseReplayChanged();
    }

    /// <summary>Seek the playhead to <paramref name="index"/> (web <c>seekTo</c>); the single seek seam the map / chart raise into.</summary>
    /// <param name="index">The target sample index.</param>
    public void SeekToIndex(int index)
    {
        _engine.SeekTo(index);
        RaiseReplayChanged();
    }

    /// <summary>Seek by normalized progress in <c>[0, 1]</c> (web <c>seekToProgress</c>).</summary>
    /// <param name="progress">The normalized progress.</param>
    public void SeekToProgress(double progress)
    {
        _engine.SeekToProgress(progress);
        RaiseReplayChanged();
    }

    /// <summary>Seek the scrubber to <paramref name="seconds"/> elapsed (web scrubber drag).</summary>
    /// <param name="seconds">The target elapsed seconds.</param>
    public void SeekToSeconds(double seconds)
    {
        double totalMs = _engine.TotalMs;
        double progress = totalMs > 0 ? seconds * 1000.0 / totalMs : 0;
        _engine.SeekToProgress(progress);
        RaiseReplayChanged();
    }

    /// <summary>Step the playhead by <paramref name="delta"/> samples (web <c>stepFrame</c>).</summary>
    /// <param name="delta">Signed sample delta.</param>
    public void StepFrame(int delta)
    {
        _engine.StepFrame(delta);
        RaiseReplayChanged();
    }

    /// <summary>Advance the replay clock by one frame (the host's frame timer calls this while playing).</summary>
    public void Tick()
    {
        if (_engine.Tick())
        {
            RaiseReplayChanged();
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private void ResetTimeline()
    {
        var timestamps = new DateTimeOffset?[_positions.Count];
        for (int i = 0; i < _positions.Count; i++)
        {
            timestamps[i] = _positions[i].TimestampUtc;
        }

        _engine.Stop();
        _engine.SetTimeline(timestamps);
    }

    private void SetError(string? detail)
    {
        _errorDetail = string.IsNullOrWhiteSpace(detail) ? "unknown error" : detail;
        _snapshot = TripReplayPageSnapshot.Empty;
        _positions = NoPositions;
        _hasData = false;
        _loading = false;
        ResetTimeline();
    }

    private TripReplayPageModel BuildModel() => new(_snapshot, _loading, _errorDetail);

    private void Reproject()
    {
        var display = TripReplayPageProjection.Project(BuildModel(), _units, _localizer, _clock());
        Display = display;
        State = display.State;
        RecomputeStats();
    }

    private void RecomputeStats() =>
        CurrentStats = TripReplayPageProjection.CurrentStats(_positions, _engine.CurrentIndex, _units, _localizer);

    private void RaiseReplayChanged()
    {
        RecomputeStats();
        Raise(nameof(IsPlaying));
        Raise(nameof(Speed));
        Raise(nameof(CurrentIndex));
        Raise(nameof(Progress));
        Raise(nameof(ElapsedSeconds));
        ReplayStateChanged?.Invoke(this, EventArgs.Empty);
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
