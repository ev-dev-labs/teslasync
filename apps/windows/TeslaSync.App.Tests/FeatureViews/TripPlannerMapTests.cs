using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TripPlannerMap</c> feature surface's UI-thread-free logic — the loading / route /
/// empty branch selection, the <c>polylinePoints</c> / <c>center</c> / <c>zoom</c> memos, the green origin / red
/// destination / blue charge-stop markers and their popup copy (the web <c>{from}% → {to}% ({min} min)</c> line with
/// JS half-up rounding), the localized i18n key set and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/TripPlannerMap.tsx). The WinUI view itself
/// (feature-views\TripPlannerMap\TripPlannerMap.cs) is exercised by the app build; its per-state branch selection is
/// driven entirely by the <see cref="TripPlannerMapState"/> asserted here.
/// </summary>
public sealed class TripPlannerMapTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly TripLocationInput SanFrancisco = new(37.7749, -122.4194, "San Francisco");
    private static readonly TripLocationInput LosAngeles = new(34.0522, -118.2437, "Los Angeles");

    private static TripPlannerMapDisplay Project(TripPlannerMapModel model) =>
        TripPlannerMapProjection.Project(model, Localizer);

    private static TripPlannerMapModel Model(TripPlannerRoute? route) => new(route);

    private static TripPlannerRoute Route(
        TripLocationInput? origin = null,
        TripLocationInput? destination = null,
        IReadOnlyList<TripLegInput>? legs = null,
        IReadOnlyList<TripChargeStopInput>? chargeStops = null) =>
        new(origin, destination, legs ?? Array.Empty<TripLegInput>(), chargeStops ?? Array.Empty<TripChargeStopInput>());

    // ── Loading (parent has not supplied a model — skeleton chrome, never a blank box) ───────────────

    [Fact]
    public void Pending_model_projects_the_loading_state()
    {
        var display = Project(TripPlannerMapModel.Pending);

        Assert.Equal(TripPlannerMapState.Loading, display.State);
        Assert.Equal("Loading", display.LoadingLabel);
        Assert.Equal("Loading", display.AutomationName);
        Assert.Equal("Trip route map", display.MapLabel);
        Assert.Empty(display.Markers);
        Assert.False(display.ShowPolyline);
    }

    // ── Empty (web `hasData === false` → "Enter origin and destination to see the route") ─────────────

    [Fact]
    public void A_route_with_no_endpoints_projects_the_empty_state()
    {
        var display = Project(Model(Route()));

        Assert.Equal(TripPlannerMapState.Empty, display.State);
        Assert.Equal("Enter origin and destination to see the route", display.EmptyMessage);
        Assert.Equal("Enter origin and destination to see the route", display.AutomationName);
        Assert.Empty(display.Markers);
    }

    [Fact]
    public void Legs_without_endpoints_still_project_the_empty_state()
    {
        // Web `hasData` checks only origin/destination — legs alone never make the map render.
        var legs = new[] { new TripLegInput(SanFrancisco, LosAngeles) };
        var display = Project(Model(Route(legs: legs)));

        Assert.Equal(TripPlannerMapState.Empty, display.State);
        Assert.Empty(display.Markers);
        Assert.False(display.ShowPolyline);
    }

    // ── Route: hasData when an origin and/or destination is set ───────────────────────────────────────

    [Fact]
    public void Both_endpoints_project_the_route_state_with_a_straight_line_and_two_markers()
    {
        var display = Project(Model(Route(SanFrancisco, LosAngeles)));

        Assert.Equal(TripPlannerMapState.Route, display.State);
        Assert.Equal("Trip route map", display.AutomationName);

        // Web: no legs + both endpoints → polylinePoints = [origin, destination].
        Assert.True(display.ShowPolyline);
        Assert.Equal(2, display.PolylinePoints.Count);
        Assert.Equal(SanFrancisco.ToGeoPoint(), display.PolylinePoints[0]);
        Assert.Equal(LosAngeles.ToGeoPoint(), display.PolylinePoints[1]);

        Assert.Equal(2, display.Markers.Count);
        Assert.Equal(SanFrancisco.ToGeoPoint(), display.Markers[0].Location);
        Assert.Equal(LosAngeles.ToGeoPoint(), display.Markers[1].Location);
        Assert.True(display.HasGeometry);
    }

    [Fact]
    public void An_origin_only_renders_the_map_without_a_polyline()
    {
        var display = Project(Model(Route(origin: SanFrancisco)));

        Assert.Equal(TripPlannerMapState.Route, display.State);
        Assert.Equal(SanFrancisco.ToGeoPoint(), display.Center);     // web: origin ? origin : US
        Assert.Equal(TripPlannerMapProjection.DefaultZoom, display.Zoom); // web: !destination → 5
        Assert.False(display.ShowPolyline);
        Assert.Empty(display.PolylinePoints);
        Assert.Single(display.Markers);
        Assert.Equal(TripPlannerMapRegistration.OriginColorHex, display.Markers[0].ColorHex);
        Assert.True(display.HasGeometry);
    }

    [Fact]
    public void A_destination_only_centres_on_the_united_states_and_renders_one_marker()
    {
        var display = Project(Model(Route(destination: LosAngeles)));

        Assert.Equal(TripPlannerMapState.Route, display.State);
        Assert.Equal(TripPlannerMapProjection.UnitedStatesCenter, display.Center); // web: !origin → US centre
        Assert.Equal(TripPlannerMapProjection.DefaultZoom, display.Zoom);
        Assert.False(display.ShowPolyline);
        Assert.Single(display.Markers);
        Assert.Equal(TripPlannerMapRegistration.DestinationColorHex, display.Markers[0].ColorHex);
    }

    // ── Center memo (web: both → midpoint, origin → origin, else → US centre) ─────────────────────────

    [Fact]
    public void The_center_is_the_midpoint_when_both_endpoints_are_set()
    {
        var center = TripPlannerMapProjection.ComputeCenter(SanFrancisco, LosAngeles);

        Assert.Equal((37.7749 + 34.0522) / 2, center.Lat, 9);
        Assert.Equal((-122.4194 + -118.2437) / 2, center.Lng, 9);
    }

    [Fact]
    public void The_center_falls_back_to_the_united_states_when_no_endpoint_is_set()
    {
        Assert.Equal(TripPlannerMapProjection.UnitedStatesCenter, TripPlannerMapProjection.ComputeCenter(null, null));
        Assert.Equal(new GeoPoint(39.8283, -98.5795), TripPlannerMapProjection.UnitedStatesCenter);
    }

    // ── Zoom memo (web step over the origin↔destination spread) ───────────────────────────────────────

    [Theory]
    [InlineData(0.5, 9)]
    [InlineData(3.0, 7)]
    [InlineData(7.0, 6)]
    [InlineData(15.0, 5)]
    [InlineData(25.0, 4)]
    public void The_zoom_steps_over_the_longitude_spread(double lngSpread, int expected)
    {
        var origin = new TripLocationInput(10, 10, "A");
        var destination = new TripLocationInput(10, 10 + lngSpread, "B");

        Assert.Equal(expected, TripPlannerMapProjection.ComputeZoom(origin, destination));
    }

    [Fact]
    public void The_zoom_is_the_default_when_an_endpoint_is_missing()
    {
        Assert.Equal(5, TripPlannerMapProjection.ComputeZoom(SanFrancisco, null));
        Assert.Equal(5, TripPlannerMapProjection.ComputeZoom(null, LosAngeles));
    }

    // ── Polyline memo (web: legs walk, else the two-point origin↔destination fallback) ────────────────

    [Fact]
    public void The_polyline_walks_the_legs_when_they_are_present()
    {
        var b = new TripLocationInput(36.0, -120.0, "B");
        var legs = new[]
        {
            new TripLegInput(SanFrancisco, b),
            new TripLegInput(b, LosAngeles),
        };

        var points = TripPlannerMapProjection.ComputePolyline(legs, SanFrancisco, LosAngeles);

        Assert.Equal(3, points.Count);
        Assert.Equal(SanFrancisco.ToGeoPoint(), points[0]);
        Assert.Equal(b.ToGeoPoint(), points[1]);
        Assert.Equal(LosAngeles.ToGeoPoint(), points[2]);
    }

    [Fact]
    public void The_polyline_is_a_straight_line_when_there_are_no_legs()
    {
        var points = TripPlannerMapProjection.ComputePolyline(
            Array.Empty<TripLegInput>(), SanFrancisco, LosAngeles);

        Assert.Equal(2, points.Count);
        Assert.Equal(SanFrancisco.ToGeoPoint(), points[0]);
        Assert.Equal(LosAngeles.ToGeoPoint(), points[1]);
    }

    [Fact]
    public void The_polyline_is_empty_with_no_legs_and_a_single_endpoint()
    {
        Assert.Empty(TripPlannerMapProjection.ComputePolyline(Array.Empty<TripLegInput>(), SanFrancisco, null));
        Assert.Empty(TripPlannerMapProjection.ComputePolyline(Array.Empty<TripLegInput>(), null, LosAngeles));
    }

    // ── Markers: colours, diameters and order (web CircleMarker set) ──────────────────────────────────

    [Fact]
    public void The_markers_carry_the_web_colours_and_radii_in_order()
    {
        var stop = new TripChargeStopInput("Harris Ranch", new TripLocationInput(36.25, -120.24, "Harris Ranch"), 15, 80, 1800);
        var display = Project(Model(Route(SanFrancisco, LosAngeles, chargeStops: new[] { stop })));

        Assert.Equal(3, display.Markers.Count);

        Assert.Equal(TripPlannerMapRegistration.OriginColorHex, display.Markers[0].ColorHex);
        Assert.Equal(TripPlannerMapProjection.EndpointMarkerDiameter, display.Markers[0].DiameterPx);

        Assert.Equal(TripPlannerMapRegistration.DestinationColorHex, display.Markers[1].ColorHex);
        Assert.Equal(TripPlannerMapProjection.EndpointMarkerDiameter, display.Markers[1].DiameterPx);

        Assert.Equal(TripPlannerMapRegistration.ChargeStopColorHex, display.Markers[2].ColorHex);
        Assert.Equal(TripPlannerMapProjection.ChargeStopMarkerDiameter, display.Markers[2].DiameterPx);
    }

    [Fact]
    public void The_polyline_colour_is_the_web_blue()
    {
        var display = Project(Model(Route(SanFrancisco, LosAngeles)));

        Assert.Equal("#3b82f6", display.PolylineColorHex);
        Assert.Equal("#3b82f6", TripPlannerMapRegistration.PolylineColorHex);
    }

    // ── Charge-stop popup (web `{from}% → {to}% ({min} min)` with JS half-up rounding) ────────────────

    [Fact]
    public void The_charge_stop_popup_reproduces_the_web_soc_and_duration_line()
    {
        var stop = new TripChargeStopInput("Kettleman City", new TripLocationInput(36.0, -119.9, "Kettleman City"), 20.5, 80.5, 1530);
        var display = Project(Model(Route(SanFrancisco, LosAngeles, chargeStops: new[] { stop })));

        var marker = display.Markers[^1];
        Assert.Equal("Kettleman City", marker.PopupTitle);

        // 20.5 → 21, 80.5 → 81 (half away from zero, like JS Math.round); 1530 s / 60 = 25.5 → 26 min.
        var detail = Assert.Single(marker.PopupDetailLines);
        Assert.Equal("21% \u2192 81% (26 min)", detail);
    }

    [Fact]
    public void The_charge_stop_popup_rounds_whole_values_cleanly()
    {
        var stop = new TripChargeStopInput("Buttonwillow", new TripLocationInput(35.4, -119.4, "Buttonwillow"), 10, 90, 1800);
        var display = Project(Model(Route(SanFrancisco, LosAngeles, chargeStops: new[] { stop })));

        Assert.Equal("10% \u2192 90% (30 min)", Assert.Single(display.Markers[^1].PopupDetailLines));
    }

    // ── Accessibility: markers carry their popup copy as a Narrator label ─────────────────────────────

    [Fact]
    public void The_endpoint_markers_use_the_place_name_as_the_popup_and_label()
    {
        var display = Project(Model(Route(SanFrancisco, LosAngeles)));

        Assert.Equal("San Francisco", display.Markers[0].PopupTitle);
        Assert.Equal("San Francisco", display.Markers[0].AriaLabel);
        Assert.Empty(display.Markers[0].PopupDetailLines);

        Assert.Equal("Los Angeles", display.Markers[1].PopupTitle);
        Assert.Equal("Los Angeles", display.Markers[1].AriaLabel);
    }

    [Fact]
    public void Unnamed_endpoints_fall_back_to_the_localized_origin_and_destination_labels()
    {
        var origin = new TripLocationInput(37.0, -122.0, "");
        var destination = new TripLocationInput(34.0, -118.0, null);
        var display = Project(Model(Route(origin, destination)));

        Assert.Equal("Origin", display.Markers[0].PopupTitle);
        Assert.Equal("Origin", display.Markers[0].AriaLabel);
        Assert.Equal("Destination", display.Markers[1].PopupTitle);
        Assert.Equal("Destination", display.Markers[1].AriaLabel);
    }

    [Fact]
    public void The_charge_stop_aria_label_combines_the_name_and_the_detail()
    {
        var stop = new TripChargeStopInput("Tejon Ranch", new TripLocationInput(34.9, -118.9, "Tejon Ranch"), 12, 72, 900);
        var display = Project(Model(Route(SanFrancisco, LosAngeles, chargeStops: new[] { stop })));

        var marker = display.Markers[^1];
        Assert.Equal("Tejon Ranch. 12% \u2192 72% (15 min)", marker.AriaLabel);
    }

    [Fact]
    public void The_route_automation_name_is_the_localized_map_label()
    {
        var display = Project(Model(Route(SanFrancisco, LosAngeles)));
        Assert.Equal("Trip route map", display.AutomationName);
        Assert.Equal("Trip route map", display.MapLabel);
    }

    // ── i18n: every key from the source resolves with the web default (P1/S10 catalog) ────────────────

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        // Loading, empty and an unnamed-endpoint route together exercise every t() the surface makes
        // (map label / loading / empty / origin / destination) across the projection branches.
        TripPlannerMapProjection.Project(TripPlannerMapModel.Pending, recorder);
        TripPlannerMapProjection.Project(new TripPlannerMapModel(new TripPlannerRoute(
            null, null, Array.Empty<TripLegInput>(), Array.Empty<TripChargeStopInput>())), recorder);
        TripPlannerMapProjection.Project(new TripPlannerMapModel(new TripPlannerRoute(
            new TripLocationInput(37, -122, ""),
            new TripLocationInput(34, -118, ""),
            Array.Empty<TripLegInput>(),
            Array.Empty<TripChargeStopInput>())), recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["tripPlanner.map.origin"] = "Origin",
            ["tripPlanner.map.destination"] = "Destination",
            ["tripPlanner.map.empty"] = "Enter origin and destination to see the route",
            ["tripPlanner.map.label"] = "Trip route map",
            ["common.loading"] = "Loading",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    [Fact]
    public void Source_i18n_keys_match_the_web_t_calls()
    {
        Assert.Equal("tripPlanner.map.origin", TripPlannerMapRegistration.OriginKey);
        Assert.Equal("Origin", TripPlannerMapRegistration.OriginFallback);
        Assert.Equal("tripPlanner.map.destination", TripPlannerMapRegistration.DestinationKey);
        Assert.Equal("Destination", TripPlannerMapRegistration.DestinationFallback);
        Assert.Equal("tripPlanner.map.empty", TripPlannerMapRegistration.EmptyKey);
        Assert.Equal("Enter origin and destination to see the route", TripPlannerMapRegistration.EmptyFallback);
    }

    // ── Diagnostics (P1/S11): PII-safe slugged events ────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new TripPlannerMapDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TripPlannerMap", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_and_glyph_are_stable()
    {
        Assert.Equal("TripPlannerMap", TripPlannerMapRegistration.Slug);
        Assert.Equal("\uE707", TripPlannerMapRegistration.MapPinGlyph);
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
