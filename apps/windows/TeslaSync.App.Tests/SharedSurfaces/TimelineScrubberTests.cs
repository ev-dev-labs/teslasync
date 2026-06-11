using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the TimelineScrubber surface's UI-thread-free logic — the registration slug + i18n
/// keys (<see cref="TimelineScrubberRegistration"/>), the marker kind wire/brush mapping
/// (<see cref="TimelineMarkerKinds"/>), the pure geometry + clock/aria formatting (<see cref="TimelineScrubberMath"/>),
/// the controlled state + interaction logic with its throttled smooth-scrub
/// (<see cref="TimelineScrubberViewModel"/>), the seek + preview seams
/// (<see cref="ITimelineSeekSink"/> / <see cref="ITimelinePreviewSource"/> and their delegate-backed and inert
/// implementations) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/data-display/TimelineScrubber.tsx). The WinUI view (TimelineScrubber.cs, which lays out the
/// groove / fill / marker ticks / ghost / thumb / preview tooltip and wires pointer + keyboard input through a
/// Slider RangeValue automation peer) is exercised by the app build.
/// </summary>
public sealed class TimelineScrubberTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingSeekSink : ITimelineSeekSink
    {
        public List<double> Seeks { get; } = new();

        public void OnSeek(double normalized) => Seeks.Add(normalized);
    }

    private sealed class StubPreviewSource : ITimelinePreviewSource
    {
        private readonly TimelinePreviewPoint? _point;

        public StubPreviewSource(TimelinePreviewPoint? point = null) => _point = point;

        public List<double> SampledAt { get; } = new();

        public TimelinePreviewPoint? Sample(double normalized)
        {
            SampledAt.Add(normalized);
            return _point is null ? null : new TimelinePreviewPoint(normalized, _point.Speed, _point.Power, _point.Soc, _point.Elevation);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeClock
    {
        public long NowMs { get; set; }
    }

    private static TimelineScrubberViewModel NewViewModel(
        RecordingSeekSink? seek = null,
        ITimelinePreviewSource? preview = null,
        ILocalizer? localizer = null,
        FakeClock? clock = null) =>
        new(
            seek ?? new RecordingSeekSink(),
            preview ?? NullTimelinePreviewSource.Instance,
            localizer ?? new RecordingLocalizer(),
            clock is null ? null : () => clock.NowMs);

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_ExposesTheCanonicalSlug()
    {
        Assert.Equal("TimelineScrubber", TimelineScrubberRegistration.Slug);
    }

    [Fact]
    public void Registration_ExposesTheWebProgressKeyAndFallback()
    {
        Assert.Equal("translation.replay.controls.progress", TimelineScrubberRegistration.ProgressKey);
        Assert.Equal("Playback progress", TimelineScrubberRegistration.ProgressFallback);
    }

    [Fact]
    public void Registration_ExposesTheWebAtPercentKeyAndDotNetFallback()
    {
        Assert.Equal("translation.replay.markers.atPercent", TimelineScrubberRegistration.AtPercentKey);
        Assert.Equal("at {0}%", TimelineScrubberRegistration.AtPercentFallback);
    }

    [Fact]
    public void Registration_ExposesTheWebSmoothScrubInterval()
    {
        Assert.Equal(50, TimelineScrubberRegistration.SmoothScrubIntervalMs);
    }

    // ── marker kind mapping ──────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(TimelineMarkerKind.Start, "start")]
    [InlineData(TimelineMarkerKind.Stop, "stop")]
    [InlineData(TimelineMarkerKind.ChargeStart, "charge-start")]
    [InlineData(TimelineMarkerKind.ChargeStop, "charge-stop")]
    [InlineData(TimelineMarkerKind.FastSegment, "fast-segment")]
    [InlineData(TimelineMarkerKind.RegenPeak, "regen-peak")]
    [InlineData(TimelineMarkerKind.LowSoc, "low-soc")]
    [InlineData(TimelineMarkerKind.Event, "event")]
    public void MarkerKinds_Wire_MatchesTheWebUnion(TimelineMarkerKind kind, string expected)
    {
        Assert.Equal(expected, TimelineMarkerKinds.Wire(kind));
    }

    [Theory]
    [InlineData(TimelineMarkerKind.Start, "TsColorSuccessBrush")]
    [InlineData(TimelineMarkerKind.Stop, "TsColorDangerBrush")]
    [InlineData(TimelineMarkerKind.ChargeStart, "TsColorSuccessBrush")]
    [InlineData(TimelineMarkerKind.ChargeStop, "TsColorWarningBrush")]
    [InlineData(TimelineMarkerKind.FastSegment, "TsColorWarningBrush")]
    [InlineData(TimelineMarkerKind.RegenPeak, "TsChartRegenBrush")]
    [InlineData(TimelineMarkerKind.LowSoc, "TsColorDangerBrush")]
    [InlineData(TimelineMarkerKind.Event, "TsColorTextMutedBrush")]
    public void MarkerKinds_BrushKey_MapsToThemeTokens(TimelineMarkerKind kind, string expected)
    {
        Assert.Equal(expected, TimelineMarkerKinds.BrushKey(kind));
    }

    // ── pure math: clamp + position ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0.3, 0.3)]
    [InlineData(-0.5, 0.0)]
    [InlineData(1.5, 1.0)]
    [InlineData(double.NaN, 0.0)]
    public void Clamp01_ClampsAndTreatsNaNAsZero(double input, double expected)
    {
        Assert.Equal(expected, TimelineScrubberMath.Clamp01(input));
    }

    [Fact]
    public void ClampBuffered_PreservesNull()
    {
        Assert.Null(TimelineScrubberMath.ClampBuffered(null));
        Assert.Equal(1.0, TimelineScrubberMath.ClampBuffered(2.0));
    }

    [Theory]
    [InlineData(50, 0, 200, 0.25)]
    [InlineData(0, 0, 200, 0.0)]
    [InlineData(200, 0, 200, 1.0)]
    [InlineData(-10, 0, 200, 0.0)]
    [InlineData(300, 0, 200, 1.0)]
    [InlineData(50, 0, 0, 0.0)] // zero width → 0 (web rect.width <= 0)
    public void NormalizedFromX_MapsPointerToPosition(double x, double left, double width, double expected)
    {
        Assert.Equal(expected, TimelineScrubberMath.NormalizedFromX(x, left, width));
    }

    [Theory]
    [InlineData(0.5, 50)]
    [InlineData(0.0, 0)]
    [InlineData(1.0, 100)]
    [InlineData(0.005, 1)] // JS Math.round half away from zero
    [InlineData(0.004, 0)]
    public void Percent_RoundsLikeJsMathRound(double normalized, int expected)
    {
        Assert.Equal(expected, TimelineScrubberMath.Percent(normalized));
    }

    // ── pure math: clock + aria text ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(65, "1:05")]
    [InlineData(90, "1:30")]
    [InlineData(3599, "59:59")]
    [InlineData(3600, "60:00")] // web does not roll into hours: minutes may exceed 59
    public void FormatClock_MatchesTheWebTemplate(double seconds, string expected)
    {
        Assert.Equal(expected, TimelineScrubberMath.FormatClock(seconds));
    }

    [Fact]
    public void AriaValueText_NullWhenDurationNonPositiveOrNonFinite()
    {
        Assert.Null(TimelineScrubberMath.AriaValueText(0, 0.5));
        Assert.Null(TimelineScrubberMath.AriaValueText(-10, 0.5));
        Assert.Null(TimelineScrubberMath.AriaValueText(double.NaN, 0.5));
        Assert.Null(TimelineScrubberMath.AriaValueText(double.PositiveInfinity, 0.5));
    }

    [Fact]
    public void AriaValueText_FormatsTimeAtProgress()
    {
        Assert.Equal("1:00", TimelineScrubberMath.AriaValueText(120, 0.5));
        Assert.Equal("2:00", TimelineScrubberMath.AriaValueText(120, 1.0));
        Assert.Equal("0:00", TimelineScrubberMath.AriaValueText(120, 0.0));
    }

    [Fact]
    public void PreviewTimeText_FormatsTimeAtPreviewPosition()
    {
        Assert.Equal("0:30", TimelineScrubberMath.PreviewTimeText(120, 0.25));
        Assert.Null(TimelineScrubberMath.PreviewTimeText(0, 0.25));
    }

    // ── pure math: marker accessible name + tooltip ──────────────────────────────────────────────────────

    [Fact]
    public void MarkerAccessibleName_WithLabel_ResolvesAtPercentKey()
    {
        var localizer = new RecordingLocalizer();
        var marker = new TimelineMarker(0.5, TimelineMarkerKind.ChargeStart, label: "Charge start");

        string name = TimelineScrubberMath.MarkerAccessibleName(marker, localizer);

        Assert.Equal("Charge start at 50%", name);
        Assert.Contains(TimelineScrubberRegistration.AtPercentKey, localizer.RequestedKeys);
    }

    [Fact]
    public void MarkerAccessibleName_WithoutLabel_UsesRawWireKind()
    {
        var localizer = new RecordingLocalizer();
        var marker = new TimelineMarker(0.5, TimelineMarkerKind.ChargeStart);

        string name = TimelineScrubberMath.MarkerAccessibleName(marker, localizer);

        Assert.Equal("charge-start 50%", name);
        Assert.DoesNotContain(TimelineScrubberRegistration.AtPercentKey, localizer.RequestedKeys);
    }

    [Fact]
    public void MarkerTooltip_FallsBackToWireKind()
    {
        Assert.Equal("Charge start", TimelineScrubberMath.MarkerTooltip(new TimelineMarker(0.5, TimelineMarkerKind.ChargeStart, "Charge start")));
        Assert.Equal("charge-start", TimelineScrubberMath.MarkerTooltip(new TimelineMarker(0.5, TimelineMarkerKind.ChargeStart)));
    }

    // ── marker + preview models ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Marker_ClampsPositionAndShowsBadgeOnlyAboveOne()
    {
        Assert.Equal(1.0, new TimelineMarker(2.0, TimelineMarkerKind.Event).At);
        Assert.Equal(0.0, new TimelineMarker(-1.0, TimelineMarkerKind.Event).At);
        Assert.False(new TimelineMarker(0.5, TimelineMarkerKind.Event, count: 1).ShowCountBadge);
        Assert.True(new TimelineMarker(0.5, TimelineMarkerKind.Event, count: 4).ShowCountBadge);
        Assert.False(new TimelineMarker(0.5, TimelineMarkerKind.Event).ShowCountBadge);
    }

    [Fact]
    public void PreviewPoint_HasReadouts_ReflectsAnyFormattedValue()
    {
        Assert.False(new TimelinePreviewPoint(0.5).HasReadouts);
        Assert.True(new TimelinePreviewPoint(0.5, speed: "63 mph").HasReadouts);
        Assert.True(new TimelinePreviewPoint(0.5, elevation: "120 m").HasReadouts);
    }

    // ── view-model: construction guards ──────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_NullSeek_Throws()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new TimelineScrubberViewModel(null!, NullTimelinePreviewSource.Instance, new RecordingLocalizer()));
    }

    [Fact]
    public void ViewModel_NullPreview_Throws()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new TimelineScrubberViewModel(new RecordingSeekSink(), null!, new RecordingLocalizer()));
    }

    [Fact]
    public void ViewModel_NullLocalizer_Throws()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new TimelineScrubberViewModel(new RecordingSeekSink(), NullTimelinePreviewSource.Instance, null!));
    }

    // ── view-model: default state projection ─────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_DefaultState_ProjectsIdlePlayhead()
    {
        TimelineScrubberViewModel vm = NewViewModel();
        vm.Progress = 0.5;
        vm.Duration = 120;

        Assert.Equal(0.5, vm.ClampedProgress);
        Assert.Equal(50, vm.PlayheadPercent);
        Assert.Equal(50, vm.AriaValueNow);
        Assert.Equal("1:00", vm.AriaValueText);
        Assert.False(vm.IsDragging);
        Assert.Null(vm.HoverAt);
        Assert.False(vm.ShowPreview);
        Assert.False(vm.ShowGhost);
    }

    [Fact]
    public void ViewModel_ClampsProgressForProjection()
    {
        TimelineScrubberViewModel vm = NewViewModel();
        vm.Progress = 1.5;

        Assert.Equal(1.0, vm.ClampedProgress);
        Assert.Equal(100, vm.PlayheadPercent);
        Assert.Equal(100, vm.AriaValueNow);
    }

    // ── view-model: buffered state ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_Buffered_ProjectsClampedPercentOrNull()
    {
        TimelineScrubberViewModel vm = NewViewModel();
        Assert.Null(vm.ClampedBuffered);
        Assert.Null(vm.BufferedPercent);

        vm.Buffered = 0.4;
        Assert.Equal(0.4, vm.ClampedBuffered);
        Assert.Equal(40, vm.BufferedPercent);

        vm.Buffered = 2.0;
        Assert.Equal(1.0, vm.ClampedBuffered);
        Assert.Equal(100, vm.BufferedPercent);
    }

    // ── view-model: hover state ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Hover_SetsPositionSamplesPreviewAndShowsTooltip()
    {
        var preview = new StubPreviewSource(new TimelinePreviewPoint(0, speed: "63 mph"));
        TimelineScrubberViewModel vm = NewViewModel(preview: preview);
        vm.Duration = 120;

        vm.Hover(0.5);

        Assert.Equal(0.5, vm.HoverAt);
        Assert.Equal(50, vm.PreviewPercent);
        Assert.Equal("1:00", vm.PreviewTimeText);
        Assert.Equal("63 mph", vm.HoverPreview?.Speed);
        Assert.True(vm.ShowPreview);
        Assert.True(vm.ShowGhost);
        Assert.Equal(new[] { 0.5 }, preview.SampledAt);
    }

    [Fact]
    public void Hover_WithNoDurationAndNoSample_HidesPreview()
    {
        TimelineScrubberViewModel vm = NewViewModel(preview: NullTimelinePreviewSource.Instance);
        // duration 0 → no preview time; null sampler → no readouts.
        vm.Hover(0.5);

        Assert.Equal(0.5, vm.HoverAt);
        Assert.Null(vm.PreviewTimeText);
        Assert.Null(vm.HoverPreview);
        Assert.False(vm.ShowPreview);
        Assert.True(vm.ShowGhost); // ghost shows on hover regardless of tooltip content
    }

    [Fact]
    public void EndHover_ClearsHoverState()
    {
        TimelineScrubberViewModel vm = NewViewModel();
        vm.Duration = 120;
        vm.Hover(0.5);

        vm.EndHover();

        Assert.Null(vm.HoverAt);
        Assert.Null(vm.HoverPreview);
        Assert.False(vm.ShowPreview);
        Assert.False(vm.ShowGhost);
    }

    [Fact]
    public void Hover_IsIgnoredWhileDragging()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);
        vm.BeginScrub(0.2);

        vm.Hover(0.9);

        // dragging path owns the position; the mouse-move hover is ignored (web handleMouseMove early-return)
        Assert.Equal(0.2, vm.HoverAt);
        Assert.True(vm.IsDragging);
    }

    // ── view-model: click-to-seek ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Click_EmitsSeekWithoutDragging()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);

        vm.Click(0.42);

        Assert.Equal(new[] { 0.42 }, seek.Seeks);
        Assert.False(vm.IsDragging);
        Assert.Null(vm.HoverAt);
    }

    [Fact]
    public void Click_ClampsPosition()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);

        vm.Click(1.4);

        Assert.Equal(new[] { 1.0 }, seek.Seeks);
    }

    // ── view-model: drag-to-scrub with throttle ──────────────────────────────────────────────────────────

    [Fact]
    public void BeginScrub_StartsDraggingAndEmitsInitialSeek()
    {
        var seek = new RecordingSeekSink();
        var preview = new StubPreviewSource(new TimelinePreviewPoint(0, soc: "82%"));
        var clock = new FakeClock { NowMs = 1000 };
        TimelineScrubberViewModel vm = NewViewModel(seek, preview, clock: clock);
        vm.Duration = 120;

        vm.BeginScrub(0.3);

        Assert.True(vm.IsDragging);
        Assert.Equal(0.3, vm.HoverAt);
        Assert.Equal("82%", vm.HoverPreview?.Soc);
        Assert.True(vm.ShowPreview);
        Assert.False(vm.ShowGhost); // ghost hides while dragging (web hoverAt != null && !isDragging)
        Assert.Equal(new[] { 0.3 }, seek.Seeks);
    }

    [Fact]
    public void Scrub_ThrottlesIntermediateSeeksToTheInterval()
    {
        var seek = new RecordingSeekSink();
        var clock = new FakeClock { NowMs = 1000 };
        TimelineScrubberViewModel vm = NewViewModel(seek, clock: clock);

        vm.BeginScrub(0.10);          // emit @1000 → [0.10], lastEmit=1000
        clock.NowMs = 1010;
        vm.Scrub(0.20);               // delta 10 < 50 → no emit (but hover updates)
        Assert.Equal(0.20, vm.HoverAt);
        clock.NowMs = 1060;
        vm.Scrub(0.30);               // delta 60 ≥ 50 → emit, lastEmit=1060
        clock.NowMs = 1080;
        vm.Scrub(0.40);               // delta 20 < 50 → no emit
        clock.NowMs = 1120;
        vm.Scrub(0.50);               // delta 60 ≥ 50 → emit, lastEmit=1120

        Assert.Equal(new[] { 0.10, 0.30, 0.50 }, seek.Seeks);
    }

    [Fact]
    public void Scrub_IsIgnoredWhenNotDragging()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);

        vm.Scrub(0.5);

        Assert.Empty(seek.Seeks);
        Assert.Null(vm.HoverAt);
    }

    [Fact]
    public void EndScrub_EmitsFinalSeekAndClearsDragState()
    {
        var seek = new RecordingSeekSink();
        var clock = new FakeClock { NowMs = 1000 };
        TimelineScrubberViewModel vm = NewViewModel(seek, clock: clock);

        vm.BeginScrub(0.10);
        clock.NowMs = 1005;
        vm.EndScrub(0.95);            // final seek emitted regardless of throttle

        Assert.Equal(new[] { 0.10, 0.95 }, seek.Seeks);
        Assert.False(vm.IsDragging);
        Assert.Null(vm.HoverAt);
        Assert.Null(vm.HoverPreview);
    }

    [Fact]
    public void EndScrub_IsIgnoredWhenNotDragging()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);

        vm.EndScrub(0.5);

        Assert.Empty(seek.Seeks);
    }

    [Fact]
    public void CancelScrub_ClearsDragWithoutEmitting()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);
        vm.BeginScrub(0.3);

        vm.CancelScrub();

        Assert.Equal(new[] { 0.3 }, seek.Seeks); // only the BeginScrub seek; cancel does not emit
        Assert.False(vm.IsDragging);
        Assert.Null(vm.HoverAt);
    }

    // ── view-model: marker + keyboard seeks ──────────────────────────────────────────────────────────────

    [Fact]
    public void SeekToMarker_EmitsTheMarkerPosition()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);

        vm.SeekToMarker(new TimelineMarker(0.65, TimelineMarkerKind.RegenPeak));

        Assert.Equal(new[] { 0.65 }, seek.Seeks);
    }

    [Fact]
    public void SeekTo_ClampsAndEmits()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);

        vm.SeekTo(1.5);
        vm.SeekTo(-0.5);
        vm.SeekTo(0.25);

        Assert.Equal(new[] { 1.0, 0.0, 0.25 }, seek.Seeks);
    }

    [Fact]
    public void Nudge_StepsRelativeToClampedProgress()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);
        vm.Progress = 0.5;

        vm.Nudge(0.01);
        vm.Nudge(-0.10);

        Assert.Equal(0.51, seek.Seeks[0], 5);
        Assert.Equal(0.40, seek.Seeks[1], 5);
    }

    [Fact]
    public void Nudge_ClampsAtTheEnds()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);
        vm.Progress = 0.995;

        vm.Nudge(0.01);

        Assert.Equal(1.0, seek.Seeks[0]);
    }

    // ── view-model: controlled-prop echo never emits ─────────────────────────────────────────────────────

    [Fact]
    public void Progress_ProgrammaticAssignment_DoesNotEmitSeek()
    {
        var seek = new RecordingSeekSink();
        TimelineScrubberViewModel vm = NewViewModel(seek);

        vm.Progress = 0.7;

        Assert.Empty(seek.Seeks);
        Assert.Equal(0.7, vm.ClampedProgress);
    }

    [Fact]
    public void Progress_RaisesChangeNotification()
    {
        TimelineScrubberViewModel vm = NewViewModel();
        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.Progress = 0.3;

        Assert.True(raised > 0);
    }

    // ── view-model: accessibility names ──────────────────────────────────────────────────────────────────

    [Fact]
    public void AccessibleName_ResolvesTheWebProgressAriaLabelKey()
    {
        var localizer = new RecordingLocalizer();
        TimelineScrubberViewModel vm = NewViewModel(localizer: localizer);

        Assert.Equal("Playback progress", vm.AccessibleName);
        Assert.Contains(TimelineScrubberRegistration.ProgressKey, localizer.RequestedKeys);
    }

    [Fact]
    public void MarkerAccessibleName_FromViewModel_ResolvesAtPercentKey()
    {
        var localizer = new RecordingLocalizer();
        TimelineScrubberViewModel vm = NewViewModel(localizer: localizer);

        string name = vm.MarkerAccessibleName(new TimelineMarker(0.25, TimelineMarkerKind.Start, "Start"));

        Assert.Equal("Start at 25%", name);
        Assert.Contains(TimelineScrubberRegistration.AtPercentKey, localizer.RequestedKeys);
    }

    [Fact]
    public void MarkerAccessibleName_FromViewModel_NoLabel_UsesRawWireKind()
    {
        var localizer = new RecordingLocalizer();
        TimelineScrubberViewModel vm = NewViewModel(localizer: localizer);

        string name = vm.MarkerAccessibleName(new TimelineMarker(1.0, TimelineMarkerKind.Stop));

        Assert.Equal("stop 100%", name);
        Assert.DoesNotContain(TimelineScrubberRegistration.AtPercentKey, localizer.RequestedKeys);
    }

    // ── seams: seek sink ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void DelegateSeekSink_ForwardsToTheDelegate()
    {
        double? captured = null;
        var sink = new DelegateTimelineSeekSink(v => captured = v);

        sink.OnSeek(0.33);

        Assert.Equal(0.33, captured);
    }

    [Fact]
    public void DelegateSeekSink_NullDelegate_IsInert()
    {
        var sink = new DelegateTimelineSeekSink(null);

        sink.OnSeek(0.5); // must not throw
    }

    [Fact]
    public void NoOpSeekSink_IsASharedInertSingleton()
    {
        Assert.Same(NoOpTimelineSeekSink.Instance, NoOpTimelineSeekSink.Instance);

        NoOpTimelineSeekSink.Instance.OnSeek(0.5); // must not throw
    }

    // ── seams: preview source ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void DelegatePreviewSource_ForwardsToTheSampler()
    {
        var point = new TimelinePreviewPoint(0.5, speed: "60 mph");
        var source = new DelegateTimelinePreviewSource(_ => point);

        Assert.Same(point, source.Sample(0.5));
    }

    [Fact]
    public void DelegatePreviewSource_NullDelegate_ReturnsNull()
    {
        var source = new DelegateTimelinePreviewSource(null);

        Assert.Null(source.Sample(0.5));
    }

    [Fact]
    public void NullPreviewSource_IsASharedSingletonReturningNull()
    {
        Assert.Same(NullTimelinePreviewSource.Instance, NullTimelinePreviewSource.Instance);
        Assert.Null(NullTimelinePreviewSource.Instance.Sample(0.5));
    }

    // ── diagnostics ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_RecordViewOpened_EmitsTheSluggedEvent()
    {
        var lines = new List<string>();
        var diagnostics = new TimelineScrubberDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=TimelineScrubber" }, lines);
    }

    [Fact]
    public void Diagnostics_CountsRepeatedOpens()
    {
        var diagnostics = new TimelineScrubberDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_NullSink_StillCounts()
    {
        var diagnostics = new TimelineScrubberDiagnostics();

        diagnostics.RecordViewOpened(); // must not throw

        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── parity guard: the two surface i18n keys exist in the shared catalog values ───────────────────────

    [Fact]
    public void AtPercentFallback_ComposesWithDotNetPositionalToken()
    {
        string composed = string.Format(
            CultureInfo.InvariantCulture,
            TimelineScrubberRegistration.AtPercentFallback,
            75);

        Assert.Equal("at 75%", composed);
    }
}
