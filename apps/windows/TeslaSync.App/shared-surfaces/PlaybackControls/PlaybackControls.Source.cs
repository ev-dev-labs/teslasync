namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The transport seam the playback bar announces user actions through (P1/S8 state-holder layer) — the native
/// union of the web component's callback props (web/src/components/data-display/PlaybackControls.tsx L25-L54:
/// <c>onPlay</c>, <c>onPause</c>, <c>onStop</c>, <c>onSpeedChange</c>, <c>onSeek</c>, and the optional
/// <c>onSeekBy</c> / <c>onSpeedRelative</c> / <c>onStepFrame</c>). The web bar is fully controlled — its buttons,
/// speed cycle, scrubber and keyboard shortcuts never mutate its own state, they invoke these callbacks and the
/// host feeds the new <c>isPlaying</c> / <c>speed</c> / <c>progress</c> / <c>elapsed</c> / <c>total</c> back down
/// as props. This seam is that callback set; a host wires it to its <c>useTripReplay</c> state. The view never
/// touches the seam directly — it binds through the <see cref="PlaybackControlsViewModel"/>.
///
/// <para>
/// The three optional callbacks are exposed as <see cref="CanSeekBy"/> / <see cref="CanSpeedRelative"/> /
/// <see cref="CanStepFrame"/> capability flags so the view-model can reproduce the web's
/// <c>if (onSeekBy) … else if (durationMs)</c>, <c>if (onSpeedRelative) … else onSpeedChange(shiftSpeed(…))</c>
/// and <c>if (onStepFrame)</c> branches exactly.
/// </para>
/// </summary>
public interface IPlaybackTransportSink
{
    /// <summary>Start playback (web <c>onPlay</c>).</summary>
    void Play();

    /// <summary>Pause playback (web <c>onPause</c>).</summary>
    void Pause();

    /// <summary>Stop / rewind to the start (web <c>onStop</c>).</summary>
    void StopPlayback();

    /// <summary>Announce a new playback speed (web <c>onSpeedChange(speed)</c>).</summary>
    void SpeedChange(int speed);

    /// <summary>Seek to a normalized 0..1 position (web <c>onSeek(progress)</c>).</summary>
    void Seek(double progress);

    /// <summary>Whether <see cref="SeekBy"/> is wired (web optional <c>onSeekBy</c> present).</summary>
    bool CanSeekBy { get; }

    /// <summary>Seek by a signed number of seconds (web <c>onSeekBy(deltaSeconds)</c>).</summary>
    void SeekBy(double deltaSeconds);

    /// <summary>Whether <see cref="SpeedRelative"/> is wired (web optional <c>onSpeedRelative</c> present).</summary>
    bool CanSpeedRelative { get; }

    /// <summary>Step the speed list by a signed number of slots (web <c>onSpeedRelative(delta)</c>).</summary>
    void SpeedRelative(int delta);

    /// <summary>Whether <see cref="StepFrame"/> is wired (web optional <c>onStepFrame</c> present).</summary>
    bool CanStepFrame { get; }

    /// <summary>Step the playhead by a signed number of frames (web <c>onStepFrame(delta)</c>).</summary>
    void StepFrame(int delta);
}

/// <summary>
/// A delegate-backed <see cref="IPlaybackTransportSink"/> — the canonical implementation a host builds from its
/// replay-state handlers (the native analogue of passing <c>onPlay</c> / <c>onPause</c> / … as the web
/// component's props). The three optional handlers default to <see langword="null"/> and, when omitted, set the
/// matching capability flag to <see langword="false"/> so the bar falls back exactly as the web does (duration-based
/// seek, <c>shiftSpeed</c> stepping, no frame step). Any null required handler degrades to a no-op so a
/// partially-wired host never throws.
/// </summary>
public sealed class DelegatePlaybackTransportSink : IPlaybackTransportSink
{
    private readonly Action? _onPlay;
    private readonly Action? _onPause;
    private readonly Action? _onStop;
    private readonly Action<int>? _onSpeedChange;
    private readonly Action<double>? _onSeek;
    private readonly Action<double>? _onSeekBy;
    private readonly Action<int>? _onSpeedRelative;
    private readonly Action<int>? _onStepFrame;

    /// <summary>Creates the sink from its transport delegates; the three optional ones may be null (inert + uncapable).</summary>
    /// <param name="onPlay">Web <c>onPlay</c>.</param>
    /// <param name="onPause">Web <c>onPause</c>.</param>
    /// <param name="onStop">Web <c>onStop</c>.</param>
    /// <param name="onSpeedChange">Web <c>onSpeedChange</c>.</param>
    /// <param name="onSeek">Web <c>onSeek</c>.</param>
    /// <param name="onSeekBy">Web optional <c>onSeekBy</c>; null leaves <see cref="CanSeekBy"/> false.</param>
    /// <param name="onSpeedRelative">Web optional <c>onSpeedRelative</c>; null leaves <see cref="CanSpeedRelative"/> false.</param>
    /// <param name="onStepFrame">Web optional <c>onStepFrame</c>; null leaves <see cref="CanStepFrame"/> false.</param>
    public DelegatePlaybackTransportSink(
        Action? onPlay,
        Action? onPause,
        Action? onStop,
        Action<int>? onSpeedChange,
        Action<double>? onSeek,
        Action<double>? onSeekBy = null,
        Action<int>? onSpeedRelative = null,
        Action<int>? onStepFrame = null)
    {
        _onPlay = onPlay;
        _onPause = onPause;
        _onStop = onStop;
        _onSpeedChange = onSpeedChange;
        _onSeek = onSeek;
        _onSeekBy = onSeekBy;
        _onSpeedRelative = onSpeedRelative;
        _onStepFrame = onStepFrame;
    }

    /// <inheritdoc />
    public bool CanSeekBy => _onSeekBy is not null;

    /// <inheritdoc />
    public bool CanSpeedRelative => _onSpeedRelative is not null;

    /// <inheritdoc />
    public bool CanStepFrame => _onStepFrame is not null;

    /// <inheritdoc />
    public void Play() => _onPlay?.Invoke();

    /// <inheritdoc />
    public void Pause() => _onPause?.Invoke();

    /// <inheritdoc />
    public void StopPlayback() => _onStop?.Invoke();

    /// <inheritdoc />
    public void SpeedChange(int speed) => _onSpeedChange?.Invoke(speed);

    /// <inheritdoc />
    public void Seek(double progress) => _onSeek?.Invoke(progress);

    /// <inheritdoc />
    public void SeekBy(double deltaSeconds) => _onSeekBy?.Invoke(deltaSeconds);

    /// <inheritdoc />
    public void SpeedRelative(int delta) => _onSpeedRelative?.Invoke(delta);

    /// <inheritdoc />
    public void StepFrame(int delta) => _onStepFrame?.Invoke(delta);
}

/// <summary>
/// The inert transport sink — every action is dropped and no optional capability is advertised. Used as the safe
/// default when a host has not wired the transport yet (e.g. a gallery / design host, or the parameterless view),
/// so the bar still renders and operates its own visuals without an outward seam to drive. The native analogue of
/// mounting the web component in isolation with no-op callbacks.
/// </summary>
public sealed class NoOpPlaybackTransportSink : IPlaybackTransportSink
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpPlaybackTransportSink Instance { get; } = new();

    private NoOpPlaybackTransportSink()
    {
    }

    /// <inheritdoc />
    public bool CanSeekBy => false;

    /// <inheritdoc />
    public bool CanSpeedRelative => false;

    /// <inheritdoc />
    public bool CanStepFrame => false;

    /// <inheritdoc />
    public void Play()
    {
        // No host handler wired — the action is dropped, like a web onPlay that does nothing.
    }

    /// <inheritdoc />
    public void Pause()
    {
        // No host handler wired — the action is dropped, like a web onPause that does nothing.
    }

    /// <inheritdoc />
    public void StopPlayback()
    {
        // No host handler wired — the action is dropped, like a web onStop that does nothing.
    }

    /// <inheritdoc />
    public void SpeedChange(int speed)
    {
        // No host handler wired — the action is dropped, like a web onSpeedChange that does nothing.
    }

    /// <inheritdoc />
    public void Seek(double progress)
    {
        // No host handler wired — the action is dropped, like a web onSeek that does nothing.
    }

    /// <inheritdoc />
    public void SeekBy(double deltaSeconds)
    {
        // Optional capability not advertised — never invoked.
    }

    /// <inheritdoc />
    public void SpeedRelative(int delta)
    {
        // Optional capability not advertised — never invoked.
    }

    /// <inheritdoc />
    public void StepFrame(int delta)
    {
        // Optional capability not advertised — never invoked.
    }
}
