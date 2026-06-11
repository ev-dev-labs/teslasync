using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TimelineScrubber"/> view — the native port of the web
/// component body (web/src/components/data-display/TimelineScrubber.tsx L110-L262). It mirrors the web source's
/// behaviour exactly:
/// <list type="bullet">
///   <item>the controlled <see cref="Progress"/> / <see cref="Buffered"/> / <see cref="Duration"/> /
///   <see cref="Markers"/> "props" drive the projected fill, buffered bar, marker ticks and
///   <see cref="AriaValueText"/>;</item>
///   <item><see cref="Hover"/> / <see cref="EndHover"/> reproduce the web mouse-move / mouse-leave preview
///   (web L141-L155): they set <see cref="HoverAt"/> + <see cref="HoverPreview"/> only while not dragging;</item>
///   <item><see cref="BeginScrub"/> / <see cref="Scrub"/> / <see cref="EndScrub"/> / <see cref="CancelScrub"/>
///   reproduce the web pointer-down / move / up drag (web L169-L238), emitting a seek on press, then at most
///   every <see cref="TimelineScrubberRegistration.SmoothScrubIntervalMs"/> ms while dragging, then on release;</item>
///   <item><see cref="Click"/> and <see cref="SeekToMarker"/> reproduce the web click-to-seek and marker click
///   (web L158-L166, L403-L406);</item>
///   <item><see cref="SeekTo"/> / <see cref="Nudge"/> back the native keyboard accessibility of a Windows slider
///   (Home/End/arrows/page), committing through the same seam.</item>
/// </list>
/// Every committed position is announced through the <see cref="ITimelineSeekSink"/> (the web <c>onSeek</c>);
/// assigning <see cref="Progress"/> programmatically (the controlled-prop echo the parent performs after a seek)
/// re-renders without re-announcing. The throttle reads a monotonic millisecond clock injected as a delegate so
/// the smooth-scrub cadence is deterministic under test. The view binds the projected values and never performs
/// I/O. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TimelineScrubberViewModel : INotifyPropertyChanged
{
    private static readonly PropertyChangedEventArgs AllChanged = new(null);

    private readonly ITimelineSeekSink _seek;
    private readonly ITimelinePreviewSource _preview;
    private readonly ILocalizer _localizer;
    private readonly Func<long> _nowMs;

    private double _progress;
    private double? _buffered;
    private double _duration;
    private IReadOnlyList<TimelineMarker> _markers = [];

    private double? _hoverAt;
    private bool _isDragging;
    private TimelinePreviewPoint? _hoverPreview;
    private long _lastEmitMs;

    /// <summary>Creates the holder over its seek seam, preview sampler, i18n facade and an optional clock.</summary>
    /// <param name="seek">The seek seam (web <c>onSeek</c>); pass <see cref="NoOpTimelineSeekSink.Instance"/> when none is wired.</param>
    /// <param name="preview">The preview sampler (web <c>getPreviewAt</c>); pass <see cref="NullTimelinePreviewSource.Instance"/> for none.</param>
    /// <param name="localizer">The i18n facade the accessible names resolve through.</param>
    /// <param name="nowMs">Monotonic millisecond clock for the smooth-scrub throttle; defaults to <see cref="Environment.TickCount64"/>.</param>
    public TimelineScrubberViewModel(
        ITimelineSeekSink seek,
        ITimelinePreviewSource preview,
        ILocalizer localizer,
        Func<long>? nowMs = null)
    {
        ArgumentNullException.ThrowIfNull(seek);
        ArgumentNullException.ThrowIfNull(preview);
        ArgumentNullException.ThrowIfNull(localizer);

        _seek = seek;
        _preview = preview;
        _localizer = localizer;
        _nowMs = nowMs ?? (static () => Environment.TickCount64);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// The current playhead position 0..1 (web <c>progress</c> prop). Assigning it is the controlled-prop echo a
    /// parent performs after a seek fires: it re-renders the fill / playhead / aria but never re-announces.
    /// </summary>
    public double Progress
    {
        get => _progress;
        set
        {
            if (_progress.Equals(value))
            {
                return;
            }

            _progress = value;
            RaiseAll();
        }
    }

    /// <summary>The buffered position 0..1, or null (web <c>buffered</c> prop, reserved for streaming).</summary>
    public double? Buffered
    {
        get => _buffered;
        set
        {
            if (Nullable.Equals(_buffered, value))
            {
                return;
            }

            _buffered = value;
            RaiseAll();
        }
    }

    /// <summary>Drive duration in seconds, used for the accessible playback time (web <c>duration</c> prop).</summary>
    public double Duration
    {
        get => _duration;
        set
        {
            if (_duration.Equals(value))
            {
                return;
            }

            _duration = value;
            RaiseAll();
        }
    }

    /// <summary>The keyframe markers along the track (web <c>markers</c> prop); a null assignment becomes empty.</summary>
    public IReadOnlyList<TimelineMarker> Markers
    {
        get => _markers;
        set
        {
            _markers = value ?? [];
            RaiseAll();
        }
    }

    /// <summary>The hover/scrub position 0..1, or null when neither hovering nor dragging (web <c>hoverAt</c>).</summary>
    public double? HoverAt => _hoverAt;

    /// <summary>Whether a drag-to-scrub is in progress (web <c>isDragging</c>).</summary>
    public bool IsDragging => _isDragging;

    /// <summary>The preview sampled at <see cref="HoverAt"/>, or null (web <c>hoverPreview</c>).</summary>
    public TimelinePreviewPoint? HoverPreview => _hoverPreview;

    /// <summary>The progress clamped to 0..1 (web <c>clampedProgress</c>).</summary>
    public double ClampedProgress => TimelineScrubberMath.Clamp01(_progress);

    /// <summary>The buffered position clamped to 0..1, preserving null (web <c>clampedBuffered</c>).</summary>
    public double? ClampedBuffered => TimelineScrubberMath.ClampBuffered(_buffered);

    /// <summary>The playhead fill width as a percent 0..100 (web <c>playheadLeft</c>).</summary>
    public double PlayheadPercent => TimelineScrubberMath.PercentExact(_progress);

    /// <summary>The buffered bar width as a percent 0..100, or null (web buffered width).</summary>
    public double? BufferedPercent =>
        ClampedBuffered is { } buffered ? TimelineScrubberMath.PercentExact(buffered) : null;

    /// <summary>The hover ghost / preview horizontal position as a percent 0..100 (web <c>previewLeft</c>).</summary>
    public double PreviewPercent => TimelineScrubberMath.PercentExact(_hoverAt ?? ClampedProgress);

    /// <summary>The slider <c>aria-valuenow</c> — the integer progress percent (web <c>Math.round(clampedProgress * 100)</c>).</summary>
    public int AriaValueNow => TimelineScrubberMath.Percent(_progress);

    /// <summary>The slider <c>aria-valuetext</c> — the formatted playback time, or null (web <c>ariaValueText</c>).</summary>
    public string? AriaValueText => TimelineScrubberMath.AriaValueText(_duration, _progress);

    /// <summary>The preview tooltip's time line, or null (web <c>previewTimeStr</c>).</summary>
    public string? PreviewTimeText =>
        TimelineScrubberMath.PreviewTimeText(_duration, _hoverAt ?? ClampedProgress);

    /// <summary>
    /// Whether the hover preview tooltip is shown (web <c>showPreview</c>): hovering or dragging, and there is at
    /// least a formatted time or sampled readouts to display.
    /// </summary>
    public bool ShowPreview =>
        (_hoverAt is not null || _isDragging) &&
        (_hoverPreview is not null || PreviewTimeText is not null);

    /// <summary>Whether the hover ghost playhead is shown (web: <c>hoverAt != null &amp;&amp; !isDragging</c>).</summary>
    public bool ShowGhost => _hoverAt is not null && !_isDragging;

    /// <summary>The slider's accessible name (web <c>aria-label={t('replay.controls.progress', 'Playback progress')}</c>).</summary>
    public string AccessibleName =>
        _localizer.GetString(TimelineScrubberRegistration.ProgressKey, TimelineScrubberRegistration.ProgressFallback);

    /// <summary>
    /// Hover preview at <paramref name="at"/> (web <c>handleMouseMove</c>): while not dragging, set the hover
    /// position and sample the preview. Ignored mid-drag, where the drag path owns the preview.
    /// </summary>
    public void Hover(double at)
    {
        if (_isDragging)
        {
            return;
        }

        _hoverAt = TimelineScrubberMath.Clamp01(at);
        _hoverPreview = _preview.Sample(_hoverAt.Value);
        RaiseAll();
    }

    /// <summary>Clear the hover preview (web <c>handleMouseLeave</c>): ignored mid-drag.</summary>
    public void EndHover()
    {
        if (_isDragging)
        {
            return;
        }

        if (_hoverAt is null && _hoverPreview is null)
        {
            return;
        }

        _hoverAt = null;
        _hoverPreview = null;
        RaiseAll();
    }

    /// <summary>Commit a click-to-seek at <paramref name="at"/> without starting a drag (web <c>handleClick</c>).</summary>
    public void Click(double at) => _seek.OnSeek(TimelineScrubberMath.Clamp01(at));

    /// <summary>
    /// Begin a drag-to-scrub at <paramref name="at"/> (web <c>handlePointerDown</c>): mark dragging, set the hover
    /// position, sample the preview, reset the throttle window and emit the initial seek.
    /// </summary>
    public void BeginScrub(double at)
    {
        double clamped = TimelineScrubberMath.Clamp01(at);
        _isDragging = true;
        _hoverAt = clamped;
        _hoverPreview = _preview.Sample(clamped);
        _lastEmitMs = _nowMs();
        RaiseAll();
        _seek.OnSeek(clamped);
    }

    /// <summary>
    /// Continue a drag at <paramref name="at"/> (web <c>handlePointerMove</c>): update the hover position + preview
    /// every move, but emit an intermediate seek at most every
    /// <see cref="TimelineScrubberRegistration.SmoothScrubIntervalMs"/> ms. No-op when not dragging.
    /// </summary>
    public void Scrub(double at)
    {
        if (!_isDragging)
        {
            return;
        }

        double clamped = TimelineScrubberMath.Clamp01(at);
        _hoverAt = clamped;
        _hoverPreview = _preview.Sample(clamped);
        RaiseAll();

        long now = _nowMs();
        if (now - _lastEmitMs >= TimelineScrubberRegistration.SmoothScrubIntervalMs)
        {
            _lastEmitMs = now;
            _seek.OnSeek(clamped);
        }
    }

    /// <summary>
    /// End a drag at <paramref name="at"/> (web <c>handlePointerUp</c>): emit the final seek, clear dragging and
    /// the hover preview. No-op when not dragging.
    /// </summary>
    public void EndScrub(double at)
    {
        if (!_isDragging)
        {
            return;
        }

        double clamped = TimelineScrubberMath.Clamp01(at);
        _seek.OnSeek(clamped);
        _isDragging = false;
        _hoverAt = null;
        _hoverPreview = null;
        RaiseAll();
    }

    /// <summary>
    /// Abort a drag without a final seek (web window-level <c>pointerup</c> / <c>pointercancel</c> cleanup, and the
    /// native pointer-capture-lost path): clear dragging and the hover preview.
    /// </summary>
    public void CancelScrub()
    {
        if (!_isDragging && _hoverAt is null && _hoverPreview is null)
        {
            return;
        }

        _isDragging = false;
        _hoverAt = null;
        _hoverPreview = null;
        RaiseAll();
    }

    /// <summary>Commit a seek to a marker's position (web marker <c>onClick</c> → <c>onSeek(marker.at)</c>).</summary>
    public void SeekToMarker(TimelineMarker marker)
    {
        ArgumentNullException.ThrowIfNull(marker);
        _seek.OnSeek(marker.At);
    }

    /// <summary>Commit a seek to an absolute normalised position (keyboard Home/End and programmatic seeks).</summary>
    public void SeekTo(double normalized) => _seek.OnSeek(TimelineScrubberMath.Clamp01(normalized));

    /// <summary>
    /// Commit a seek relative to the current progress by <paramref name="delta"/> (keyboard arrows / page keys),
    /// clamped to 0..1. The native keyboard affordance of a Windows slider, committed through the same seam.
    /// </summary>
    public void Nudge(double delta) => _seek.OnSeek(TimelineScrubberMath.Clamp01(ClampedProgress + delta));

    /// <summary>The accessible name for a marker tick (web marker <c>aria-label</c>).</summary>
    public string MarkerAccessibleName(TimelineMarker marker) =>
        TimelineScrubberMath.MarkerAccessibleName(marker, _localizer);

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllChanged);
}
