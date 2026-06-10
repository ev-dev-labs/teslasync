using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>RouteMapSection</c> feature surface's UI-thread-free logic — the empty / route /
/// stationary / loading branch selection, the meaningful-route vs frozen-fix geometry (web <c>geo.ts</c>), the
/// viewport (web <c>zoom = trail.length &gt; 1 ? 13 : 3</c> + the stationary anchor view), the live-vs-completed
/// end-time fallback, the speed legend's SI→display unit conversion, the marker / popup copy, the localized i18n key
/// set and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/RouteMapSection.tsx). The WinUI view itself
/// (feature-views\RouteMapSection\RouteMapSection.cs) is exercised by the app build; its per-state branch selection is
/// driven entirely by the <see cref="RouteMapSectionState"/> asserted here.
/// </summary>
public sealed class RouteMapSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Start = new(2026, 4, 4, 14, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset End = new(2026, 4, 4, 15, 15, 0, TimeSpan.Zero);

    // Two coordinates ~111 m apart (0.001° latitude) — a meaningful route.
    private static readonly GeoPoint A = new(37.7000, -122.4000);
    private static readonly GeoPoint B = new(37.7010, -122.4000);

    // Two coordinates ~1.1 m apart (0.00001° latitude) — a frozen single GPS fix.
    private static readonly GeoPoint Frozen1 = new(37.7000, -122.4000);
    private static readonly GeoPoint Frozen2 = new(37.70001, -122.4000);

    private static RouteMapSectionDisplay Project(RouteMapSectionModel model, UnitPref? pref = null) =>
        RouteMapSectionProjection.Project(model, Localizer, pref ?? UnitPref.Imperial, Now);

    private static RouteSnapshot RouteData(
        IReadOnlyList<GeoPoint>? positions = null,
        IReadOnlyList<GeoPoint>? trail = null,
        GeoPoint? startPos = null,
        GeoPoint? endPos = null,
        GeoPoint? center = null,
        IReadOnlyList<RouteSpeedSegment>? segments = null,
        DateTimeOffset? startTs = null,
        DateTimeOffset? endTs = null,
        bool liveDrive = false)
    {
        var pos = positions ?? new[] { A, B };
        var path = trail ?? new[] { A, B };
        return new RouteSnapshot(
            pos,
            path,
            startPos ?? (path.Count > 0 ? path[0] : null),
            endPos ?? (path.Count > 1 ? path[^1] : null),
            center ?? A,
            segments ?? new[] { new RouteSpeedSegment(new[] { A, B }, "#10b981") },
            startTs ?? Start,
            liveDrive ? null : (endTs ?? End));
    }

    private static RouteMapSectionModel Model(RouteSnapshot? route) => new(route);

    // ── Loading (parent has not resolved the drive — skeleton chrome, never a blank box) ─────────────

    [Fact]
    public void Pending_model_projects_the_loading_state()
    {
        var display = Project(RouteMapSectionModel.Pending);

        Assert.Equal(RouteMapSectionState.Loading, display.State);
        Assert.Equal("Route", display.Title);
        Assert.Equal("Loading", display.LoadingLabel);
        Assert.Equal("Loading", display.AutomationName);
        Assert.False(display.HasRoute);
    }

    // ── Empty (web `trail.length === 0` → "No route data available for this drive") ──────────────────

    [Fact]
    public void An_empty_trail_projects_the_empty_state()
    {
        var display = Project(Model(RouteData(trail: Array.Empty<GeoPoint>())));

        Assert.Equal(RouteMapSectionState.Empty, display.State);
        Assert.Equal("No route data available for this drive", display.EmptyMessage);
        Assert.Equal("No route data available for this drive", display.AutomationName);
        Assert.False(display.HasRoute);
    }

    // ── Route (a meaningful GPS trail → polylines + markers + speed legend) ──────────────────────────

    [Fact]
    public void A_meaningful_trail_projects_the_route_state()
    {
        var segments = new[] { new RouteSpeedSegment(new[] { A, B }, "#ef4444") };
        var display = Project(Model(RouteData(segments: segments)));

        Assert.Equal(RouteMapSectionState.Route, display.State);
        Assert.True(display.HasRoute);
        Assert.True(display.FitToTrail);
        Assert.Equal(13, display.Zoom);
        Assert.Equal(A, display.Center);
        Assert.Same(segments, display.SpeedSegments);
        Assert.Equal(A, display.StartMarker);
        Assert.Equal(B, display.EndMarker);
        Assert.Null(display.AnchorMarker);
        Assert.True(display.ShowSpeedLegend);
    }

    [Fact]
    public void Route_with_a_single_point_trail_uses_the_sparse_zoom_and_hides_the_speed_legend()
    {
        // hasRoute is derived from positions (two valid points 111 m apart), but the trail itself has one point —
        // web `zoom={trail.length > 1 ? 13 : 3}` and `hasRoute && trail.length > 1` for the legend.
        var display = Project(Model(RouteData(positions: new[] { A, B }, trail: new[] { A })));

        Assert.Equal(RouteMapSectionState.Route, display.State);
        Assert.True(display.HasRoute);
        Assert.Equal(3, display.Zoom);
        Assert.False(display.ShowSpeedLegend);
    }

    // ── Stationary (a frozen single GPS fix → anchor marker + "route can't be plotted") ──────────────

    [Fact]
    public void A_frozen_single_fix_projects_the_stationary_state()
    {
        var display = Project(Model(RouteData(positions: new[] { Frozen1, Frozen2 }, trail: new[] { Frozen1, Frozen2 })));

        Assert.Equal(RouteMapSectionState.Stationary, display.State);
        Assert.False(display.HasRoute);
        Assert.False(display.FitToTrail);
        Assert.Equal(15, display.Zoom);
        Assert.Equal(Frozen1, display.AnchorMarker);
        Assert.Null(display.StartMarker);
        Assert.Null(display.EndMarker);
        Assert.False(display.ShowSpeedLegend);
        Assert.Equal("Route can't be plotted", display.StationaryTitle);
        Assert.StartsWith("Only one GPS coordinate was recorded", display.StationaryBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_stationary_anchor_is_the_first_valid_position()
    {
        // The first coordinate is the (0,0) "GPS not yet fixed" sentinel, so the anchor is the next valid fix.
        var display = Project(Model(RouteData(
            positions: new[] { new GeoPoint(0, 0), Frozen1, Frozen2 },
            trail: new[] { Frozen1 })));

        Assert.Equal(RouteMapSectionState.Stationary, display.State);
        Assert.Equal(Frozen1, display.AnchorMarker);
    }

    [Fact]
    public void The_stationary_legend_still_shows_the_start_time()
    {
        var display = Project(Model(RouteData(positions: new[] { Frozen1, Frozen2 }, trail: new[] { Frozen1 })));

        Assert.Equal("Start", display.StartLabel);
        Assert.NotEqual(string.Empty, display.StartLegendTime);
        Assert.NotEqual("\u2014", display.StartLegendTime);
    }

    // ── Live vs completed end time (web `drive.endTs ? formatDateTime : t('inProgress')`) ────────────

    [Fact]
    public void A_live_drive_falls_back_to_in_progress_and_hides_the_end_legend()
    {
        var display = Project(Model(RouteData(liveDrive: true)));

        Assert.Equal("In progress", display.EndPopupDetail);
        Assert.False(display.ShowEndLegend);
        Assert.Equal("\u2014", display.EndLegendTime); // em dash for a null timestamp
    }

    [Fact]
    public void A_completed_drive_shows_the_end_time_and_legend()
    {
        var display = Project(Model(RouteData(endTs: End)));

        Assert.True(display.ShowEndLegend);
        Assert.NotEqual("In progress", display.EndPopupDetail);
        Assert.NotEqual("\u2014", display.EndPopupDetail);
        Assert.NotEqual("\u2014", display.EndLegendTime);
    }

    [Fact]
    public void The_start_popup_detail_resolves_from_the_start_timestamp()
    {
        var display = Project(Model(RouteData(startTs: Start)));

        Assert.NotEqual(string.Empty, display.StartPopupDetail);
        Assert.NotEqual("\u2014", display.StartPopupDetail);
    }

    // ── Speed legend: SI thresholds converted to the display unit (web `fmtNumber(toSpeedDisplay(…))`) ─

    [Fact]
    public void The_speed_legend_converts_the_thresholds_to_imperial()
    {
        var display = Project(Model(RouteData()), UnitPref.Imperial);

        Assert.Equal("30.00", display.SpeedLowDisplay);
        Assert.Equal("60.00", display.SpeedMedDisplay);
        Assert.Equal("100.00", display.SpeedHighDisplay);
        Assert.Equal("mph", display.SpeedUnitLabel);
    }

    [Fact]
    public void The_speed_legend_converts_the_thresholds_to_metric()
    {
        var display = Project(Model(RouteData()), UnitPref.Metric);

        Assert.Equal("48.28", display.SpeedLowDisplay);
        Assert.Equal("96.56", display.SpeedMedDisplay);
        Assert.Equal("160.93", display.SpeedHighDisplay);
        Assert.Equal("km/h", display.SpeedUnitLabel);
    }

    [Fact]
    public void The_si_speed_thresholds_match_the_web_constants()
    {
        Assert.Equal(30 * 0.44704, RouteMapSectionProjection.SpeedSegmentLowMps, 10);
        Assert.Equal(60 * 0.44704, RouteMapSectionProjection.SpeedSegmentMedMps, 10);
        Assert.Equal(100 * 0.44704, RouteMapSectionProjection.SpeedSegmentHighMps, 10);
    }

    // ── Geometry (web geo.ts: isValidLatLng / hasMeaningfulRoute / firstValidIndex) ──────────────────

    [Theory]
    [InlineData(0, 0, false)]            // the "GPS not yet fixed" sentinel
    [InlineData(37.7, -122.4, true)]
    [InlineData(-90, 180, true)]
    [InlineData(91, 0, false)]           // out of latitude bounds
    [InlineData(0, 181, false)]          // out of longitude bounds
    [InlineData(double.NaN, 1, false)]
    [InlineData(1, double.PositiveInfinity, false)]
    public void IsValid_matches_the_web_isValidLatLng(double lat, double lng, bool expected)
    {
        Assert.Equal(expected, RouteGeometry.IsValid(new GeoPoint(lat, lng)));
    }

    [Fact]
    public void HasMeaningfulRoute_is_true_when_two_points_are_at_least_ten_metres_apart()
    {
        Assert.True(RouteGeometry.HasMeaningfulRoute(new[] { A, B }));
    }

    [Fact]
    public void HasMeaningfulRoute_is_false_for_a_frozen_cluster()
    {
        Assert.False(RouteGeometry.HasMeaningfulRoute(new[] { Frozen1, Frozen2 }));
    }

    [Fact]
    public void HasMeaningfulRoute_is_false_when_there_is_no_valid_coordinate()
    {
        Assert.False(RouteGeometry.HasMeaningfulRoute(new[] { new GeoPoint(0, 0) }));
        Assert.False(RouteGeometry.HasMeaningfulRoute(Array.Empty<GeoPoint>()));
    }

    [Fact]
    public void FirstValidIndex_skips_the_zero_sentinel()
    {
        Assert.Equal(1, RouteGeometry.FirstValidIndex(new[] { new GeoPoint(0, 0), A, B }));
        Assert.Equal(-1, RouteGeometry.FirstValidIndex(new[] { new GeoPoint(0, 0) }));
    }

    // ── i18n: every key from the source resolves with the web default (P1/S10 catalog) ──────────────

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        // A live stationary drive exercises every t() the surface makes (route / start / end / inProgress /
        // lastKnown / stationaryRoute* / noRouteData / loading) across the projection branches.
        RouteMapSectionProjection.Project(
            new RouteMapSectionModel(new RouteSnapshot(
                new[] { Frozen1, Frozen2 },
                new[] { Frozen1 },
                Frozen1,
                null,
                Frozen1,
                Array.Empty<RouteSpeedSegment>(),
                Start,
                null)),
            recorder,
            UnitPref.Imperial,
            Now);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["driveDetail.route"] = "Route",
            ["driveDetail.start"] = "Start",
            ["driveDetail.end"] = "End",
            ["driveDetail.inProgress"] = "In progress",
            ["driveDetail.lastKnown"] = "Last known location",
            ["driveDetail.stationaryRouteTitle"] = "Route can't be plotted",
            ["driveDetail.noRouteData"] = "No route data available for this drive",
            ["common.loading"] = "Loading",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }

        Assert.True(recorder.Requested.ContainsKey("driveDetail.stationaryRouteBody"));
    }

    [Fact]
    public void Source_i18n_keys_match_the_web_t_calls()
    {
        Assert.Equal("driveDetail.route", RouteMapSectionRegistration.RouteKey);
        Assert.Equal("driveDetail.start", RouteMapSectionRegistration.StartKey);
        Assert.Equal("driveDetail.end", RouteMapSectionRegistration.EndKey);
        Assert.Equal("driveDetail.inProgress", RouteMapSectionRegistration.InProgressKey);
        Assert.Equal("driveDetail.lastKnown", RouteMapSectionRegistration.LastKnownKey);
        Assert.Equal("driveDetail.stationaryRouteTitle", RouteMapSectionRegistration.StationaryTitleKey);
        Assert.Equal("driveDetail.stationaryRouteBody", RouteMapSectionRegistration.StationaryBodyKey);
        Assert.Equal("driveDetail.noRouteData", RouteMapSectionRegistration.NoRouteDataKey);
    }

    // ── Accessibility: markers carry their popup copy as a Narrator name ─────────────────────────────

    [Fact]
    public void Route_markers_and_anchor_carry_their_localized_labels()
    {
        var route = Project(Model(RouteData()));
        Assert.Equal("Start", route.StartLabel);
        Assert.Equal("End", route.EndLabel);

        var stationary = Project(Model(RouteData(positions: new[] { Frozen1, Frozen2 }, trail: new[] { Frozen1 })));
        Assert.Equal("Last known location", stationary.AnchorLabel);
    }

    [Fact]
    public void The_route_automation_name_is_the_section_title()
    {
        var display = Project(Model(RouteData()));
        Assert.Equal("Route", display.AutomationName);
    }

    // ── Diagnostics (P1/S11): PII-safe slugged events ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new RouteMapSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RouteMapSection", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("RouteMapSection", RouteMapSectionRegistration.Slug);
    }

    [Fact]
    public void Glyphs_map_to_the_expected_segoe_fluent_code_points()
    {
        Assert.Equal("\uE707", RouteMapSectionRegistration.MapPinGlyph);
        Assert.Equal("\uEB4F", RouteMapSectionRegistration.FlagGlyph);
        Assert.Equal("\uE809", RouteMapSectionRegistration.NavigationGlyph);
    }

    /// <summary>An <see cref="ILocalizer"/> that returns the fallback and records each requested key.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return fallback;
        }
    }
}
