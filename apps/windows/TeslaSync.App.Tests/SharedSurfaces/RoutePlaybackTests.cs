using System.Collections.Generic;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the RoutePlayback surface's UI-thread-free logic — the registration slug + i18n keys
/// (<see cref="RoutePlaybackRegistration"/>), the metric-chip projection (<see cref="RoutePlaybackChip"/>), the
/// controlled state + transport logic (<see cref="RoutePlaybackViewModel"/> over the
/// <see cref="RoutePlaybackEngine"/>), the position seam (<see cref="IRoutePositionSink"/> and its delegate-backed
/// and inert implementations) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/maps/RoutePlayback.tsx): the per-state projections (empty / populated / playing / ended /
/// stopped) are the headless analogue of the per-state UI snapshots, and the a11y label is asserted through the
/// localizer. The WinUI view (RoutePlayback.cs, which composes the glass panel, the native map + overlays, the
/// metric chip and the transport bar and drives a 50 ms timer) is exercised by the app build.
/// </summary>
public sealed class RoutePlaybackTests
{
    private sealed class RecordingPositionSink : IRoutePositionSink
    {
        public List<(PlaybackPoint Point, int Index)> Calls { get; } = new();

        public void OnPositionChange(PlaybackPoint point, int index) => Calls.Add((point, index));
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

    private static PlaybackPoint Point(double lat, double lng, double tMs, double? speed = null, double? soc = null) =>
        new(lat, lng, tMs, speed, soc);

    private static IReadOnlyList<PlaybackPoint> ThreePoints() =>
    [
        Point(37.0, -122.0, 0, 10, 90),
        Point(37.1, -122.1, 500, 20, 80),
        Point(37.2, -122.2, 1000, 30, 70),
    ];

    private static RoutePlaybackViewModel NewViewModel(
        IRoutePositionSink? sink = null,
        ILocalizer? localizer = null,
        bool autoPlay = false) =>
        new(sink ?? NoOpRoutePositionSink.Instance, localizer ?? PassthroughLocalizer.Instance, autoPlay);

    // ── Registration / i18n keys ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_carries_slug_and_verbatim_web_copy()
    {
        Assert.Equal("RoutePlayback", RoutePlaybackRegistration.Slug);
        Assert.Equal("No GPS points to replay for this route.", RoutePlaybackRegistration.EmptyFallback);
        Assert.Equal("Route playback map", RoutePlaybackRegistration.MapLabelFallback);
        Assert.Equal("translation.maps.routePlayback.empty", RoutePlaybackRegistration.EmptyKey);
        Assert.Equal("translation.maps.routePlayback.mapLabel", RoutePlaybackRegistration.MapLabelKey);
    }

    [Fact]
    public void Registration_keys_all_carry_the_translation_catalog_prefix()
    {
        foreach (string key in new[]
        {
            RoutePlaybackRegistration.EmptyKey,
            RoutePlaybackRegistration.MapLabelKey,
            RoutePlaybackRegistration.ResetKey,
            RoutePlaybackRegistration.PlayKey,
            RoutePlaybackRegistration.PauseKey,
            RoutePlaybackRegistration.StopKey,
            RoutePlaybackRegistration.SpeedKey,
        })
        {
            Assert.StartsWith("translation.", key);
        }
    }

    // ── Metric chip projection ───────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, 120, "1/120")]
    [InlineData(2, 5, "3/5")]
    public void Chip_position_label_is_one_based(int index, int count, string expected) =>
        Assert.Equal(expected, RoutePlaybackChip.PositionLabel(index, count));

    [Fact]
    public void Chip_speed_text_matches_fmtNumber_with_km_per_hour_suffix() =>
        Assert.Equal($"{ScalarFormatters.FormatNumber(63.4, 1)} km/h", RoutePlaybackChip.SpeedText(63.4));

    [Fact]
    public void Chip_soc_text_matches_fmtNumber_with_percent_suffix() =>
        Assert.Equal($"{ScalarFormatters.FormatNumber(80, 0)}%", RoutePlaybackChip.SocText(80));

    // ── Empty state ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_when_no_points()
    {
        var vm = NewViewModel();

        Assert.True(vm.IsEmpty);
        Assert.False(vm.ShowChip);
        Assert.False(vm.CanPlay);
        Assert.Null(vm.CurrentPoint);
        Assert.Empty(vm.Trail);
        Assert.Equal(RoutePlaybackRegistration.EmptyFallback, vm.EmptyMessage);
    }

    [Fact]
    public void Empty_when_points_have_no_finite_coordinates()
    {
        var vm = NewViewModel();

        vm.SetPoints([Point(double.NaN, double.NaN, 0), Point(double.NaN, double.NaN, 100)]);

        Assert.True(vm.IsEmpty);
    }

    [Fact]
    public void Empty_message_override_wins_over_localized_copy()
    {
        var vm = NewViewModel();

        vm.EmptyMessageOverride = "No route recorded.";

        Assert.Equal("No route recorded.", vm.EmptyMessage);
    }

    // ── Populated geometry ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Populated_projects_trail_endpoints_and_multi_point_zoom()
    {
        var vm = NewViewModel();

        vm.SetPoints(ThreePoints());

        Assert.False(vm.IsEmpty);
        Assert.Equal(3, vm.Trail.Count);
        Assert.Equal(new GeoPoint(37.0, -122.0), vm.StartPoint);
        Assert.Equal(new GeoPoint(37.2, -122.2), vm.EndPoint);
        Assert.Equal(new GeoPoint(37.0, -122.0), vm.CenterPoint);
        Assert.Equal(RoutePlaybackRegistration.MultiPointZoom, vm.Zoom);
        Assert.True(vm.CanPlay);
    }

    [Fact]
    public void Single_point_has_no_end_and_uses_single_point_zoom()
    {
        var vm = NewViewModel();

        vm.SetPoints([Point(37.0, -122.0, 0)]);

        Assert.False(vm.IsEmpty);
        Assert.Null(vm.EndPoint);
        Assert.Equal(RoutePlaybackRegistration.SinglePointZoom, vm.Zoom);
        Assert.False(vm.CanPlay);
    }

    [Fact]
    public void Chip_reflects_current_sample_speed_and_soc()
    {
        var vm = NewViewModel();

        vm.SetPoints(ThreePoints());

        Assert.True(vm.ShowChip);
        Assert.Equal("1/3", vm.PositionLabel);
        Assert.True(vm.ShowSpeed);
        Assert.Equal(RoutePlaybackChip.SpeedText(10), vm.SpeedText);
        Assert.True(vm.ShowSoc);
        Assert.Equal(RoutePlaybackChip.SocText(90), vm.SocText);
    }

    [Fact]
    public void Chip_hides_speed_and_soc_when_sample_lacks_them()
    {
        var vm = NewViewModel();

        vm.SetPoints([Point(37.0, -122.0, 0), Point(37.1, -122.1, 500)]);

        Assert.True(vm.ShowChip);
        Assert.False(vm.ShowSpeed);
        Assert.Equal(string.Empty, vm.SpeedText);
        Assert.False(vm.ShowSoc);
        Assert.Equal(string.Empty, vm.SocText);
    }

    // ── Transport: play / pause / stop / seek / speed ────────────────────────────────────────────────────────

    [Fact]
    public void Play_is_a_no_op_below_two_points()
    {
        var vm = NewViewModel();
        vm.SetPoints([Point(37.0, -122.0, 0)]);

        vm.Play();

        Assert.False(vm.IsPlaying);
    }

    [Fact]
    public void Play_then_pause_toggles_running_state()
    {
        var vm = NewViewModel();
        vm.SetPoints(ThreePoints());

        vm.Play();
        Assert.True(vm.IsPlaying);

        vm.Pause();
        Assert.False(vm.IsPlaying);
    }

    [Fact]
    public void Advance_reaches_the_end_then_stops()
    {
        var vm = NewViewModel();
        vm.SetPoints(ThreePoints());
        vm.CycleSpeed(100); // 50ms * 100 = 5000ms >= 1000ms total → ends in one tick.
        vm.Play();

        bool done = vm.Advance();

        Assert.True(done);
        Assert.False(vm.IsPlaying);
        Assert.Equal(2, vm.CurrentIndex);
        Assert.Equal(1.0, vm.Progress, 3);
        Assert.Equal(vm.TotalText, vm.ElapsedText);
    }

    [Fact]
    public void Advance_progresses_gradually_at_one_x()
    {
        var vm = NewViewModel();
        vm.SetPoints(ThreePoints());

        // 10 ticks * 50ms = 500ms → the middle sample.
        for (int i = 0; i < 10; i++)
        {
            vm.Advance();
        }

        Assert.Equal(1, vm.CurrentIndex);
        Assert.False(vm.Progress >= 1.0);
    }

    [Fact]
    public void Stop_rewinds_to_the_start()
    {
        var vm = NewViewModel();
        vm.SetPoints(ThreePoints());
        vm.SeekToProgress(1.0);

        vm.Stop();

        Assert.False(vm.IsPlaying);
        Assert.Equal(0, vm.CurrentIndex);
        Assert.Equal(0.0, vm.Progress, 3);
    }

    [Fact]
    public void Seek_moves_the_cursor_to_the_ends()
    {
        var vm = NewViewModel();
        vm.SetPoints(ThreePoints());

        vm.SeekToProgress(1.0);
        Assert.Equal(2, vm.CurrentIndex);

        vm.SeekToProgress(0.0);
        Assert.Equal(0, vm.CurrentIndex);
    }

    [Fact]
    public void Cycle_speed_accepts_scale_values_and_clamps_off_scale_to_one()
    {
        var vm = NewViewModel();

        vm.CycleSpeed(25);
        Assert.Equal(25, vm.Speed);

        vm.CycleSpeed(7);
        Assert.Equal(1, vm.Speed);
    }

    [Fact]
    public void Cycle_speed_forward_wraps_through_the_scale()
    {
        var vm = NewViewModel();

        Assert.Equal(1, vm.Speed);
        vm.CycleSpeedForward();
        Assert.Equal(10, vm.Speed);
        vm.CycleSpeedForward();
        Assert.Equal(25, vm.Speed);
        vm.CycleSpeedForward();
        Assert.Equal(50, vm.Speed);
        vm.CycleSpeedForward();
        Assert.Equal(100, vm.Speed);
        vm.CycleSpeedForward();
        Assert.Equal(1, vm.Speed);
    }

    [Fact]
    public void AutoPlay_starts_running_once_enough_points_load()
    {
        var vm = NewViewModel(autoPlay: true);

        vm.SetPoints(ThreePoints());

        Assert.True(vm.IsPlaying);
    }

    // ── Position seam (web onPositionChange) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Position_sink_fires_for_the_initial_cursor_on_load()
    {
        var sink = new RecordingPositionSink();
        var vm = NewViewModel(sink);

        vm.SetPoints(ThreePoints());

        var first = Assert.Single(sink.Calls);
        Assert.Equal(0, first.Index);
        Assert.Equal(37.0, first.Point.Lat, 6);
    }

    [Fact]
    public void Position_sink_fires_once_per_distinct_index()
    {
        var sink = new RecordingPositionSink();
        var vm = NewViewModel(sink);
        vm.SetPoints(ThreePoints());

        vm.SeekToProgress(1.0); // index 0 → 2.
        vm.SeekToProgress(1.0); // no change → no extra fire.

        Assert.Equal(2, sink.Calls.Count);
        Assert.Equal(0, sink.Calls[0].Index);
        Assert.Equal(2, sink.Calls[1].Index);
    }

    [Fact]
    public void Position_sink_fires_on_stop_back_to_start()
    {
        var sink = new RecordingPositionSink();
        var vm = NewViewModel(sink);
        vm.SetPoints(ThreePoints());
        vm.SeekToProgress(1.0);

        vm.Stop();

        Assert.Equal(0, sink.Calls[^1].Index);
    }

    [Fact]
    public void Delegate_sink_with_null_delegate_is_inert()
    {
        var sink = new DelegateRoutePositionSink(null);

        var ex = Record.Exception(() => sink.OnPositionChange(Point(0, 0, 0), 0));

        Assert.Null(ex);
    }

    [Fact]
    public void Delegate_sink_forwards_to_its_handler()
    {
        int captured = -1;
        var sink = new DelegateRoutePositionSink((_, index) => captured = index);

        sink.OnPositionChange(Point(0, 0, 0), 4);

        Assert.Equal(4, captured);
    }

    [Fact]
    public void NoOp_sink_is_inert()
    {
        var ex = Record.Exception(() => NoOpRoutePositionSink.Instance.OnPositionChange(Point(0, 0, 0), 0));

        Assert.Null(ex);
    }

    // ── Accessibility / localization ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_map_label_resolves_the_localized_key()
    {
        var localizer = new RecordingLocalizer();
        var vm = NewViewModel(localizer: localizer);

        string label = vm.AccessibleMapLabel;

        Assert.Equal(RoutePlaybackRegistration.MapLabelFallback, label);
        Assert.Contains(RoutePlaybackRegistration.MapLabelKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Aria_label_override_wins_over_localized_label()
    {
        var vm = NewViewModel();

        vm.AriaLabelOverride = "Trip route map";

        Assert.Equal("Trip route map", vm.AccessibleMapLabel);
    }

    [Fact]
    public void Localize_delegates_to_the_facade()
    {
        var localizer = new RecordingLocalizer();
        var vm = NewViewModel(localizer: localizer);

        string reset = vm.Localize(RoutePlaybackRegistration.ResetKey, RoutePlaybackRegistration.ResetFallback);

        Assert.Equal(RoutePlaybackRegistration.ResetFallback, reset);
        Assert.Contains(RoutePlaybackRegistration.ResetKey, localizer.RequestedKeys);
    }

    // ── Map style ────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Map_style_defaults_to_dark_and_is_settable()
    {
        var vm = NewViewModel();

        Assert.Equal(MapStyleKind.Dark, vm.MapStyle);

        vm.MapStyle = MapStyleKind.Satellite;

        Assert.Equal(MapStyleKind.Satellite, vm.MapStyle);
    }

    // ── Diagnostics ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RoutePlaybackDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RoutePlayback", Assert.Single(lines));
    }
}
