namespace TeslaSync.App.Core.DataDisplay;

/// <summary>
/// Time-based trip-replay clock — the WinUI-free native port of the web
/// <c>useTripReplay</c> hook (web/src/hooks/useTripReplay.ts). It maintains a virtual
/// clock (scaled by the <see cref="Speed"/> multiplier) mapped onto a drive's position
/// timeline; every consumer (the map playhead, the chart cursor, the current-stat cards
/// and the scrubber) derives its state from <see cref="CurrentIndex"/> / <see cref="Progress"/>.
/// <para>
/// The engine is deliberately timer-free so it stays pure and unit-testable: the host owns
/// the frame timer and calls <see cref="Tick"/> at the <see cref="TickMs"/> cadence while
/// <see cref="IsPlaying"/> is true. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </para>
/// </summary>
public sealed class TripReplayEngine
{
    /// <summary>The frame interval in milliseconds (web <c>TICK_MS</c> — 20 fps).</summary>
    public const int TickMs = 50;

    private long[] _offsetsMs = Array.Empty<long>();
    private long _totalMs;
    private double _elapsedMs;
    private int _speed = 1;
    private int _currentIndex;
    private bool _isPlaying;

    /// <summary>The number of samples on the current timeline (web <c>positions.length</c>).</summary>
    public int PositionCount => _offsetsMs.Length;

    /// <summary>True while the clock is advancing (web <c>isPlaying</c>).</summary>
    public bool IsPlaying => _isPlaying;

    /// <summary>The active speed multiplier (web <c>speed</c>; one of <see cref="PlaybackSpeed.Speeds"/>).</summary>
    public int Speed => _speed;

    /// <summary>The current playhead sample index (web <c>currentIndex</c>).</summary>
    public int CurrentIndex => _currentIndex;

    /// <summary>Elapsed virtual time in milliseconds since the drive start (web <c>elapsedTime</c>).</summary>
    public double ElapsedMs => _elapsedMs;

    /// <summary>Total virtual time in milliseconds (web <c>totalTime</c>; 0 when there is nothing to replay).</summary>
    public long TotalMs => _totalMs;

    /// <summary>Fraction of the drive elapsed, clamped to <c>[0, 1]</c> (web <c>progress</c>).</summary>
    public double Progress => _totalMs > 0 ? Math.Min(_elapsedMs / _totalMs, 1.0) : 0.0;

    /// <summary>
    /// Load the timeline from the position timestamps (web <c>buildTimeline</c>). The first finite timestamp is
    /// the zero point; every sample's offset is its delta from that zero, with an unparseable timestamp collapsing
    /// to 0 so one bad row can't poison <see cref="TotalMs"/> (the web's NaN guard). With no finite timestamp the
    /// timeline is empty and the engine has nothing to replay. Preserves the current play state but re-clamps the
    /// playhead / elapsed clock into the new range.
    /// </summary>
    /// <param name="timestamps">The per-sample timestamps in recorded order (nulls tolerated).</param>
    public void SetTimeline(IReadOnlyList<DateTimeOffset?> timestamps)
    {
        if (timestamps is null || timestamps.Count == 0)
        {
            Reset();
            return;
        }

        long? zero = null;
        foreach (var ts in timestamps)
        {
            if (ts is { } value)
            {
                zero = value.ToUnixTimeMilliseconds();
                break;
            }
        }

        if (zero is not { } start)
        {
            Reset();
            return;
        }

        var offsets = new long[timestamps.Count];
        for (int i = 0; i < timestamps.Count; i++)
        {
            offsets[i] = timestamps[i] is { } value ? value.ToUnixTimeMilliseconds() - start : 0;
        }

        _offsetsMs = offsets;
        _totalMs = offsets.Length > 0 ? offsets[^1] : 0;
        _currentIndex = Math.Clamp(_currentIndex, 0, offsets.Length - 1);
        _elapsedMs = Math.Clamp(_elapsedMs, 0, _totalMs <= 0 ? 0 : _totalMs);
    }

    /// <summary>
    /// Advance the clock by one frame (web interval callback). Returns true when the playhead index or the play
    /// state changed, so the host can repaint only when needed. Reaching the end stops playback and snaps the
    /// playhead to the final sample (web <c>elapsed &gt;= total</c> branch).
    /// </summary>
    public bool Tick()
    {
        if (_offsetsMs.Length == 0 || _totalMs == 0)
        {
            return false;
        }

        int previousIndex = _currentIndex;
        bool wasPlaying = _isPlaying;

        _elapsedMs += TickMs * (double)_speed;

        if (_elapsedMs >= _totalMs)
        {
            _elapsedMs = _totalMs;
            _currentIndex = _offsetsMs.Length - 1;
            _isPlaying = false;
        }
        else
        {
            _currentIndex = IndexAtTime(_elapsedMs);
        }

        return _currentIndex != previousIndex || _isPlaying != wasPlaying;
    }

    /// <summary>Start (or resume) playback; restart from the beginning when already parked at the end (web <c>play</c>).</summary>
    public void Play()
    {
        if (_totalMs > 0 && _elapsedMs >= _totalMs)
        {
            _elapsedMs = 0;
            _currentIndex = 0;
        }

        _isPlaying = true;
    }

    /// <summary>Pause playback, holding the current playhead (web <c>pause</c>).</summary>
    public void Pause() => _isPlaying = false;

    /// <summary>Pause and rewind to the first sample (web <c>stop</c>).</summary>
    public void Stop()
    {
        _isPlaying = false;
        _elapsedMs = 0;
        _currentIndex = 0;
    }

    /// <summary>Set the absolute speed multiplier (web <c>setSpeed</c>), snapped to the nearest known slot.</summary>
    public void SetSpeed(int speed) => _speed = NormalizeSpeed(speed);

    /// <summary>Step the speed up/down by <paramref name="delta"/> slots, clamped (web <c>setSpeedRelative</c>).</summary>
    public void SetSpeedRelative(int delta) => _speed = PlaybackSpeed.Shift(_speed, delta);

    /// <summary>Seek the playhead to <paramref name="index"/> (web <c>seekTo</c>); clamps to the sample range.</summary>
    public void SeekTo(int index)
    {
        if (_offsetsMs.Length == 0)
        {
            _currentIndex = 0;
            _elapsedMs = 0;
            return;
        }

        int clamped = Math.Clamp(index, 0, _offsetsMs.Length - 1);
        _currentIndex = clamped;
        _elapsedMs = _offsetsMs[clamped];
    }

    /// <summary>Seek by normalized progress in <c>[0, 1]</c> (web <c>seekToProgress</c>).</summary>
    public void SeekToProgress(double progress)
    {
        double targetMs = Math.Clamp(progress, 0.0, 1.0) * _totalMs;
        _elapsedMs = targetMs;
        _currentIndex = IndexAtTime(targetMs);
    }

    /// <summary>Seek by a signed offset in seconds, clamped to <c>[0, total]</c> (web <c>seekBy</c>).</summary>
    public void SeekBy(double deltaSeconds)
    {
        if (_totalMs <= 0 || _offsetsMs.Length == 0)
        {
            return;
        }

        double targetMs = Math.Clamp(_elapsedMs + (deltaSeconds * 1000.0), 0.0, _totalMs);
        _elapsedMs = targetMs;
        _currentIndex = IndexAtTime(targetMs);
    }

    /// <summary>Step the playhead by <paramref name="delta"/> samples, clamped (web <c>stepFrame</c>).</summary>
    public void StepFrame(int delta)
    {
        if (_offsetsMs.Length == 0)
        {
            return;
        }

        int next = Math.Clamp(_currentIndex + delta, 0, _offsetsMs.Length - 1);
        _currentIndex = next;
        _elapsedMs = _offsetsMs[next];
    }

    /// <summary>
    /// Binary-search the offsets for the sample whose time is closest to <paramref name="targetMs"/> — the native
    /// port of the web <c>indexAtTime</c>. The offsets are non-decreasing, so the search is O(log n); on a tie the
    /// earlier sample wins (web's <c>&lt;</c> comparison + closer-of-neighbours pick).
    /// </summary>
    public int IndexAtTime(double targetMs)
    {
        if (_offsetsMs.Length == 0)
        {
            return 0;
        }

        int lo = 0;
        int hi = _offsetsMs.Length - 1;
        while (lo < hi)
        {
            int mid = (lo + hi) >> 1;
            if (_offsetsMs[mid] < targetMs)
            {
                lo = mid + 1;
            }
            else
            {
                hi = mid;
            }
        }

        if (lo > 0 && targetMs - _offsetsMs[lo - 1] < _offsetsMs[lo] - targetMs)
        {
            return lo - 1;
        }

        return lo;
    }

    private static int NormalizeSpeed(int speed)
    {
        foreach (int known in PlaybackSpeed.Speeds)
        {
            if (known == speed)
            {
                return speed;
            }
        }

        // Snap an out-of-band request to the nearest known slot (defensive; web only ever sets a valid slot).
        int best = PlaybackSpeed.Speeds[0];
        int bestDelta = Math.Abs(speed - best);
        foreach (int known in PlaybackSpeed.Speeds)
        {
            int delta = Math.Abs(speed - known);
            if (delta < bestDelta)
            {
                best = known;
                bestDelta = delta;
            }
        }

        return best;
    }

    private void Reset()
    {
        _offsetsMs = Array.Empty<long>();
        _totalMs = 0;
        _elapsedMs = 0;
        _currentIndex = 0;
    }
}
