using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The seam the surface announces a scrub-position change through (P1/S8 state-holder layer) — the native port of
/// the web component's <c>onPositionChange</c> callback prop
/// (web/src/components/maps/RoutePlayback.tsx L47-L51). The web widget fires the callback whenever its playback
/// cursor moves (a tick, a seek, a stop or a fresh dataset) so a hosting page can sync a chart cursor (e.g. move
/// a <c>TimeMarker</c> on a recharts axis). This seam is that callback; a host wires it to its page state. The
/// view never touches this seam directly — it binds through the <see cref="RoutePlaybackViewModel"/>.
/// </summary>
public interface IRoutePositionSink
{
    /// <summary>Announce that the cursor moved to <paramref name="point"/> at <paramref name="index"/> (web <c>onPositionChange</c>).</summary>
    void OnPositionChange(PlaybackPoint point, int index);
}

/// <summary>
/// A delegate-backed <see cref="IRoutePositionSink"/> — the canonical implementation a host builds from its
/// position handler (the native analogue of passing <c>onPositionChange={handler}</c> as the web component's
/// prop). A <see langword="null"/> delegate degrades to a no-op so a partially-wired host never throws, exactly
/// like the web optional prop being omitted.
/// </summary>
public sealed class DelegateRoutePositionSink : IRoutePositionSink
{
    private readonly Action<PlaybackPoint, int>? _onPositionChange;

    /// <summary>Creates the sink from its position delegate (web <c>onPositionChange</c>); a null delegate is inert.</summary>
    public DelegateRoutePositionSink(Action<PlaybackPoint, int>? onPositionChange) =>
        _onPositionChange = onPositionChange;

    /// <inheritdoc />
    public void OnPositionChange(PlaybackPoint point, int index) => _onPositionChange?.Invoke(point, index);
}

/// <summary>
/// The inert position sink — every announcement is dropped. Used as the safe default when a host has not wired a
/// position handler yet (e.g. a gallery / design host, or the parameterless view), so the surface still renders
/// and replays its cursor without an outward seam to drive. The native analogue of mounting the web component in
/// isolation with no <c>onPositionChange</c>.
/// </summary>
public sealed class NoOpRoutePositionSink : IRoutePositionSink
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpRoutePositionSink Instance { get; } = new();

    private NoOpRoutePositionSink()
    {
    }

    /// <inheritdoc />
    public void OnPositionChange(PlaybackPoint point, int index)
    {
        // No host handler wired — the announcement is dropped, like a web onPositionChange that does nothing.
    }
}
