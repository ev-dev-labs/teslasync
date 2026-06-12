using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RoutePlayback"/> view — the native port of the web
/// component body (web/src/components/maps/RoutePlayback.tsx L158-L412). It wraps the headless
/// <see cref="RoutePlaybackEngine"/> (the ported playback maths) and projects everything the view binds:
/// <list type="bullet">
///   <item>the empty/populated split (<see cref="IsEmpty"/>, web <c>trail.length === 0</c>) and the geometry the
///   map overlays draw — <see cref="Trail"/>, <see cref="StartPoint"/>, <see cref="EndPoint"/>,
///   <see cref="CenterPoint"/>, <see cref="Zoom"/>;</item>
///   <item>the live cursor — <see cref="CurrentPoint"/>, <see cref="CurrentIndex"/>, <see cref="Heading"/>,
///   <see cref="Progress"/>, <see cref="ElapsedText"/>, <see cref="TotalText"/>;</item>
///   <item>the transport state — <see cref="IsPlaying"/>, <see cref="Speed"/>, <see cref="CanPlay"/> — driven by
///   <see cref="Play"/> / <see cref="Pause"/> / <see cref="Stop"/> / <see cref="SeekToProgress"/> /
///   <see cref="CycleSpeed"/> / <see cref="CycleSpeedForward"/> and the per-tick <see cref="Advance"/>, mirroring
///   the web <c>play</c> / <c>pause</c> / <c>stop</c> / <c>seekToProgress</c> / <c>cycleSpeed</c> / <c>tick</c>;</item>
///   <item>the inline metric chip (<see cref="ShowChip"/>, <see cref="PositionLabel"/>, <see cref="SpeedText"/>,
///   <see cref="SocText"/>) and the floating layer-switcher selection (<see cref="MapStyle"/>);</item>
///   <item>the localized accessible map label (<see cref="AccessibleMapLabel"/>, web
///   <c>ariaLabel ?? t('maps.routePlayback.mapLabel', …)</c>) and empty-state message
///   (<see cref="EmptyMessage"/>, web <c>emptyMessage ?? t('maps.routePlayback.empty', …)</c>).</item>
/// </list>
/// Every cursor move is announced through the injected <see cref="IRoutePositionSink"/> (the web
/// <c>onPositionChange</c>), de-duplicated so the same index is never announced twice. The view owns only the
/// 50 ms timer (it calls <see cref="Advance"/>) and the rendering; this holder performs no I/O. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RoutePlaybackViewModel : INotifyPropertyChanged
{
    private static readonly PropertyChangedEventArgs AllChanged = new(null);

    private readonly IRoutePositionSink _sink;
    private readonly ILocalizer _localizer;

    private RoutePlaybackEngine _engine;
    private IReadOnlyList<GeoPoint> _trail;
    private MapStyleKind _mapStyle;
    private string? _ariaLabel;
    private string? _emptyMessage;
    private bool _isPlaying;
    private int _lastFiredIndex = -1;

    /// <summary>Creates the holder over its position seam, i18n facade and auto-play preference.</summary>
    /// <param name="sink">The position seam (web <c>onPositionChange</c>); pass <see cref="NoOpRoutePositionSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade the accessible label + empty message resolve through.</param>
    /// <param name="autoPlay">Whether replay should auto-start once two or more points are loaded (web <c>autoPlay</c>).</param>
    public RoutePlaybackViewModel(IRoutePositionSink sink, ILocalizer localizer, bool autoPlay = false)
    {
        ArgumentNullException.ThrowIfNull(sink);
        ArgumentNullException.ThrowIfNull(localizer);

        _sink = sink;
        _localizer = localizer;
        AutoPlay = autoPlay;
        _engine = new RoutePlaybackEngine([]);
        _trail = _engine.Trail();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Whether replay auto-starts when two or more points are loaded (web <c>autoPlay</c> prop). Read by
    /// <see cref="SetPoints"/>, so changing it takes effect on the next dataset.
    /// </summary>
    public bool AutoPlay { get; set; }

    /// <summary>Available replay speed multipliers, slowest → fastest (web <c>SPEEDS</c>).</summary>
    public static IReadOnlyList<int> Speeds => RoutePlaybackEngine.Speeds;

    /// <summary>Resolve a localized string through the surface's i18n facade (web <c>t(key, fallback)</c>).</summary>
    public string Localize(string key, string fallback) => _localizer.GetString(key, fallback);

    /// <summary>The time-ordered samples currently loaded (web <c>points</c> prop).</summary>
    public IReadOnlyList<PlaybackPoint> Points => _engine.Points;

    /// <summary>The finite-coordinate trail for the polyline overlay (web <c>trail</c>).</summary>
    public IReadOnlyList<GeoPoint> Trail => _trail;

    /// <summary>True when there is no finite GPS geometry to replay (web <c>trail.length === 0</c>).</summary>
    public bool IsEmpty => _trail.Count == 0;

    /// <summary>The first trail coordinate (web <c>startPos</c>), or null when the trail is empty.</summary>
    public GeoPoint? StartPoint => _trail.Count > 0 ? _trail[0] : null;

    /// <summary>The last trail coordinate when more than one point exists (web <c>endPos</c>), else null.</summary>
    public GeoPoint? EndPoint => _trail.Count > 1 ? _trail[^1] : null;

    /// <summary>The initial map centre — the start coordinate, falling back to (0, 0) (web <c>centerPos</c>).</summary>
    public GeoPoint CenterPoint => StartPoint ?? new GeoPoint(0, 0);

    /// <summary>The initial map zoom — 13 for a multi-point trail, 15 for a single point (web <c>zoom</c>).</summary>
    public int Zoom => _trail.Count > 1
        ? RoutePlaybackRegistration.MultiPointZoom
        : RoutePlaybackRegistration.SinglePointZoom;

    /// <summary>The sample at the current cursor, or null when empty (web <c>cp</c>).</summary>
    public PlaybackPoint? CurrentPoint => _engine.Current;

    /// <summary>The current cursor index into <see cref="Points"/> (web <c>currentIndex</c>).</summary>
    public int CurrentIndex => _engine.CurrentIndex;

    /// <summary>The number of loaded samples (web <c>points.length</c>).</summary>
    public int PointCount => _engine.Points.Count;

    /// <summary>The marker heading in degrees (0–360) at the current cursor (web <c>heading</c>).</summary>
    public double Heading => _engine.Heading;

    /// <summary>Replay progress in the range [0, 1] (web <c>progress</c>).</summary>
    public double Progress => _engine.Progress;

    /// <summary>The elapsed transport clock (web <c>fmtDuration(elapsedRef.current)</c>).</summary>
    public string ElapsedText => RoutePlaybackEngine.FormatDuration(_engine.ElapsedMs);

    /// <summary>The total transport clock (web <c>fmtDuration(totalMs)</c>).</summary>
    public string TotalText => RoutePlaybackEngine.FormatDuration(_engine.TotalMs);

    /// <summary>Whether replay is running (web <c>isPlaying</c>).</summary>
    public bool IsPlaying => _isPlaying;

    /// <summary>The active replay speed multiplier (web <c>speed</c>); defaults to the slowest slot.</summary>
    public int Speed { get; private set; } = 1;

    /// <summary>True when there are at least two samples to replay (web <c>points.length &gt;= 2</c>).</summary>
    public bool CanPlay => PointCount >= 2;

    /// <summary>The selected base-map style (web <c>mapStyle</c>); defaults to dark (web <c>initialMapStyle = 'dark'</c>).</summary>
    public MapStyleKind MapStyle
    {
        get => _mapStyle;
        set
        {
            if (_mapStyle == value)
            {
                return;
            }

            _mapStyle = value;
            RaiseAll();
        }
    }

    /// <summary>
    /// Optional accessible-name override for the map landmark (web <c>ariaLabel</c> prop). When null or empty the
    /// localized <see cref="RoutePlaybackRegistration.MapLabelKey"/> is used.
    /// </summary>
    public string? AriaLabelOverride
    {
        get => _ariaLabel;
        set
        {
            _ariaLabel = value;
            RaiseAll();
        }
    }

    /// <summary>
    /// Optional empty-state message override (web <c>emptyMessage</c> prop). When null or empty the localized
    /// <see cref="RoutePlaybackRegistration.EmptyKey"/> is used.
    /// </summary>
    public string? EmptyMessageOverride
    {
        get => _emptyMessage;
        set
        {
            _emptyMessage = value;
            RaiseAll();
        }
    }

    /// <summary>Whether the inline metric chip is shown (web <c>cp &amp;&amp; …</c>): there is a current sample.</summary>
    public bool ShowChip => _engine.Current is not null;

    /// <summary>The chip's "{index + 1}/{count}" position label (web <c>{currentIndex + 1}/{points.length}</c>).</summary>
    public string PositionLabel => RoutePlaybackChip.PositionLabel(_engine.CurrentIndex, PointCount);

    /// <summary>Whether the chip shows a speed readout (web <c>cp.speed != null</c>).</summary>
    public bool ShowSpeed => _engine.Current is { Speed: not null };

    /// <summary>The chip's speed readout, or the empty string when none (web <c>{fmtNumber(cp.speed, 1)} km/h</c>).</summary>
    public string SpeedText =>
        _engine.Current is { Speed: { } speed } ? RoutePlaybackChip.SpeedText(speed) : string.Empty;

    /// <summary>Whether the chip shows a state-of-charge readout (web <c>cp.soc != null</c>).</summary>
    public bool ShowSoc => _engine.Current is { Soc: not null };

    /// <summary>The chip's state-of-charge readout, or the empty string when none (web <c>{fmtNumber(cp.soc, 0)}%</c>).</summary>
    public string SocText =>
        _engine.Current is { Soc: { } soc } ? RoutePlaybackChip.SocText(soc) : string.Empty;

    /// <summary>
    /// The map landmark's accessible name — the override when supplied, else the localized map label (web
    /// <c>ariaLabel ?? t('maps.routePlayback.mapLabel', 'Route playback map')</c>).
    /// </summary>
    public string AccessibleMapLabel => string.IsNullOrEmpty(_ariaLabel)
        ? _localizer.GetString(RoutePlaybackRegistration.MapLabelKey, RoutePlaybackRegistration.MapLabelFallback)
        : _ariaLabel;

    /// <summary>
    /// The empty-state message — the override when supplied, else the localized empty copy (web
    /// <c>emptyMessage ?? t('maps.routePlayback.empty', 'No GPS points to replay for this route.')</c>).
    /// </summary>
    public string EmptyMessage => string.IsNullOrEmpty(_emptyMessage)
        ? _localizer.GetString(RoutePlaybackRegistration.EmptyKey, RoutePlaybackRegistration.EmptyFallback)
        : _emptyMessage;

    /// <summary>
    /// Load a trip's GPS samples and reset replay to the start (web mounting with a fresh <c>points</c> prop):
    /// rebuilds the engine + trail, sets <see cref="IsPlaying"/> from the auto-play preference, and announces the
    /// initial cursor through the position seam.
    /// </summary>
    public void SetPoints(IReadOnlyList<PlaybackPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);

        _engine = new RoutePlaybackEngine(points);
        _trail = _engine.Trail();
        _isPlaying = AutoPlay && CanPlay;
        _lastFiredIndex = -1;
        RaiseAll();
        FirePositionIfChanged();
    }

    /// <summary>
    /// Start replay (web <c>play</c>): a no-op below two samples; rewinds to the start first when the cursor sits
    /// at the end, then begins playing.
    /// </summary>
    public void Play()
    {
        if (!CanPlay)
        {
            return;
        }

        if (_engine.AtEnd)
        {
            _engine.Reset();
        }

        _isPlaying = true;
        RaiseAll();
        FirePositionIfChanged();
    }

    /// <summary>Pause replay, holding the current cursor (web <c>pause</c>).</summary>
    public void Pause()
    {
        if (!_isPlaying)
        {
            return;
        }

        _isPlaying = false;
        RaiseAll();
    }

    /// <summary>Stop replay and rewind the cursor to the start (web <c>stop</c>).</summary>
    public void Stop()
    {
        _isPlaying = false;
        _engine.Reset();
        RaiseAll();
        FirePositionIfChanged();
    }

    /// <summary>Seek to a normalized progress value in [0, 1] (web <c>seekToProgress</c>).</summary>
    public void SeekToProgress(double progress)
    {
        _engine.SeekToProgress(progress);
        RaiseAll();
        FirePositionIfChanged();
    }

    /// <summary>
    /// Select a replay speed (web <c>cycleSpeed</c>): an off-scale value falls back to the slowest slot
    /// (web <c>SPEEDS.includes(next) ? next : 1</c>).
    /// </summary>
    public void CycleSpeed(int next)
    {
        Speed = IsKnownSpeed(next) ? next : 1;
        RaiseAll();
    }

    /// <summary>
    /// Step to the next-fastest speed, wrapping past the top back to the slowest (the web
    /// <c>PlaybackSpeedMenu</c> click behaviour the transport bar drives <c>onSpeedChange</c> with).
    /// </summary>
    public void CycleSpeedForward()
    {
        var speeds = RoutePlaybackEngine.Speeds;
        int index = IndexOfSpeed(Speed);
        int nextIndex = (index + 1) % speeds.Count;
        Speed = speeds[nextIndex];
        RaiseAll();
    }

    /// <summary>
    /// Advance the cursor by one 50 ms tick at the active speed (web <c>tick</c>): stops at the end and reports
    /// whether the end was reached so the view can halt its timer. Announces the new cursor.
    /// </summary>
    public bool Advance()
    {
        bool done = _engine.Advance(Speed);
        if (done)
        {
            _isPlaying = false;
        }

        RaiseAll();
        FirePositionIfChanged();
        return done;
    }

    private static bool IsKnownSpeed(int speed) => IndexOfSpeed(speed) >= 0;

    private static int IndexOfSpeed(int speed)
    {
        var speeds = RoutePlaybackEngine.Speeds;
        for (int i = 0; i < speeds.Count; i++)
        {
            if (speeds[i] == speed)
            {
                return i;
            }
        }

        return -1;
    }

    private void FirePositionIfChanged()
    {
        if (_engine.Current is { } point && _engine.CurrentIndex != _lastFiredIndex)
        {
            _lastFiredIndex = _engine.CurrentIndex;
            _sink.OnPositionChange(point, _engine.CurrentIndex);
        }
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllChanged);
}
