namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The change seam the playback-speed control announces a new speed through (P1/S8 state-holder layer) — the
/// native port of the web component's <c>onChange</c> callback prop
/// (web/src/components/data-display/PlaybackSpeedMenu.tsx L32). The web control is fully controlled: clicking or
/// right-clicking never mutates its own state, it calls <c>onChange(nextSpeed(speed))</c> /
/// <c>onChange(shiftSpeed(speed, -1))</c> and the parent feeds the new speed back down as the <c>speed</c> prop.
/// This seam is that callback; a host wires it to its replay state (the web <c>useTripReplay().setSpeed</c>).
/// The view never touches this seam directly — it binds through the <see cref="PlaybackSpeedMenuViewModel"/>.
/// </summary>
public interface IPlaybackSpeedSink
{
    /// <summary>Announce that the user picked <paramref name="speed"/> (web <c>onChange(speed)</c>).</summary>
    void OnSpeedChanged(int speed);
}

/// <summary>
/// A delegate-backed <see cref="IPlaybackSpeedSink"/> — the canonical implementation a host builds from its
/// replay state setter (the native analogue of passing <c>onChange={setSpeed}</c> as the web component's prop).
/// A <see langword="null"/> delegate degrades to a no-op so a partially-wired host never throws.
/// </summary>
public sealed class DelegatePlaybackSpeedSink : IPlaybackSpeedSink
{
    private readonly Action<int>? _onSpeedChanged;

    /// <summary>Creates the sink from its change delegate (web <c>onChange</c>); a null delegate is inert.</summary>
    public DelegatePlaybackSpeedSink(Action<int>? onSpeedChanged) => _onSpeedChanged = onSpeedChanged;

    /// <inheritdoc />
    public void OnSpeedChanged(int speed) => _onSpeedChanged?.Invoke(speed);
}

/// <summary>
/// The inert change sink — every announcement is dropped. Used as the safe default when a host has not wired a
/// speed handler yet (e.g. a gallery / design host, or the parameterless view), so the control still renders and
/// cycles its displayed value without an outward seam to drive. This is the native analogue of mounting the web
/// component in isolation with a no-op <c>onChange</c>.
/// </summary>
public sealed class NoOpPlaybackSpeedSink : IPlaybackSpeedSink
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpPlaybackSpeedSink Instance { get; } = new();

    private NoOpPlaybackSpeedSink()
    {
    }

    /// <inheritdoc />
    public void OnSpeedChanged(int speed)
    {
        // No host handler wired — the announcement is dropped, like a web onChange that does nothing.
    }
}
