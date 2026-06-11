namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The seam the scrubber announces a committed playback position through (P1/S8 state-holder layer) — the native
/// port of the web component's <c>onSeek</c> callback prop
/// (web/src/components/data-display/TimelineScrubber.tsx L59-L60). The web scrubber is fully controlled: a click,
/// a drag-release and the intermediate drag samples all call <c>onSeek(normalized)</c>, and the parent feeds the
/// new playhead back down as the <c>progress</c> prop. This seam is that callback; a host wires it to its replay
/// state (the web <c>useTripReplay().seekTo</c>). The view never touches this seam directly — it binds through
/// the <see cref="TimelineScrubberViewModel"/>.
/// </summary>
public interface ITimelineSeekSink
{
    /// <summary>Announce that the user committed <paramref name="normalized"/> (0..1) as the playhead (web <c>onSeek</c>).</summary>
    void OnSeek(double normalized);
}

/// <summary>
/// A delegate-backed <see cref="ITimelineSeekSink"/> — the canonical implementation a host builds from its replay
/// seek setter (the native analogue of passing <c>onSeek={seekTo}</c> as the web component's prop). A
/// <see langword="null"/> delegate degrades to a no-op so a partially-wired host never throws.
/// </summary>
public sealed class DelegateTimelineSeekSink : ITimelineSeekSink
{
    private readonly Action<double>? _onSeek;

    /// <summary>Creates the sink from its seek delegate (web <c>onSeek</c>); a null delegate is inert.</summary>
    public DelegateTimelineSeekSink(Action<double>? onSeek) => _onSeek = onSeek;

    /// <inheritdoc />
    public void OnSeek(double normalized) => _onSeek?.Invoke(normalized);
}

/// <summary>
/// The inert seek sink — every announcement is dropped. Used as the safe default when a host has not wired a seek
/// handler yet (e.g. a gallery / design host, or the parameterless view), so the scrubber still renders and
/// scrubs its displayed playhead without an outward seam to drive. The native analogue of mounting the web
/// component in isolation with a no-op <c>onSeek</c>.
/// </summary>
public sealed class NoOpTimelineSeekSink : ITimelineSeekSink
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpTimelineSeekSink Instance { get; } = new();

    private NoOpTimelineSeekSink()
    {
    }

    /// <inheritdoc />
    public void OnSeek(double normalized)
    {
        // No host handler wired — the announcement is dropped, like a web onSeek that does nothing.
    }
}

/// <summary>
/// The sampler the scrubber calls to populate the hover preview tooltip (P1/S8 state-holder layer) — the native
/// port of the web component's <c>getPreviewAt</c> callback prop
/// (web/src/components/data-display/TimelineScrubber.tsx L52-L58). Given a normalised 0..1 position it returns a
/// pre-formatted <see cref="TimelinePreviewPoint"/> (or null when the caller has nothing to show), called on
/// hover and during a drag. The lookup is expected to be cheap (a binary search into a pre-built array). The
/// view never calls this seam directly — it binds through the <see cref="TimelineScrubberViewModel"/>.
/// </summary>
public interface ITimelinePreviewSource
{
    /// <summary>Return the pre-formatted preview for <paramref name="normalized"/> (0..1), or null (web <c>getPreviewAt</c>).</summary>
    TimelinePreviewPoint? Sample(double normalized);
}

/// <summary>
/// A delegate-backed <see cref="ITimelinePreviewSource"/> — the canonical implementation a host builds from its
/// preview lookup (the native analogue of passing <c>getPreviewAt={sampler}</c> as the web component's prop). A
/// <see langword="null"/> delegate degrades to "no preview", exactly like the web optional prop being omitted.
/// </summary>
public sealed class DelegateTimelinePreviewSource : ITimelinePreviewSource
{
    private readonly Func<double, TimelinePreviewPoint?>? _sampler;

    /// <summary>Creates the source from its sampler delegate (web <c>getPreviewAt</c>); a null delegate yields no preview.</summary>
    public DelegateTimelinePreviewSource(Func<double, TimelinePreviewPoint?>? sampler) => _sampler = sampler;

    /// <inheritdoc />
    public TimelinePreviewPoint? Sample(double normalized) => _sampler?.Invoke(normalized);
}

/// <summary>
/// The empty preview source — always returns null, the native analogue of the web component being mounted without
/// a <c>getPreviewAt</c> prop. With it, the hover tooltip still shows the formatted time (when a duration is
/// known) but no speed / power / SoC / elevation rows.
/// </summary>
public sealed class NullTimelinePreviewSource : ITimelinePreviewSource
{
    /// <summary>The shared empty instance.</summary>
    public static NullTimelinePreviewSource Instance { get; } = new();

    private NullTimelinePreviewSource()
    {
    }

    /// <inheritdoc />
    public TimelinePreviewPoint? Sample(double normalized) => null;
}
