using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.RouteDisplaySurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>RouteDisplay</c> shared surface's UI-thread-free logic — the three resolved
/// render branches (no-location / round-trip / point-to-point), the ordered text runs and their muted flags (the
/// web <c>opacity-60</c> emphasis split), the "↻ round trip" note (only when an explicit <c>end</c> is supplied),
/// the U+2192 point-to-point arrow and the coordinate-fallback labels, the line's accessible name (the web
/// element has no separate <c>aria-label</c>, so the name is its text content), the <c>route.noLocationData</c> /
/// <c>route.roundTrip</c> i18n keys flowing through the facade, the icon passthrough, the registration metadata
/// and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (<c>web/src/components/data-display/RouteDisplay.tsx</c>). The endpoint labelling / haversine / round-trip
/// resolution itself is covered by <c>RouteLogicTests</c>; the WinUI view (RouteDisplay.cs) is exercised by the
/// app build.
/// </summary>
public sealed class RouteDisplayTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static RouteDisplayDisplay Project(RouteDisplayModel model) =>
        RouteDisplayProjection.Project(model, Localizer);

    // ── registration (diagnostics slug + map-pin glyph) ──────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("RouteDisplay", RouteDisplayRegistration.Slug);

    [Fact]
    public void Registration_uses_the_shared_map_pin_glyph() =>
        Assert.Equal("\uE707", RouteDisplayRegistration.MapPinGlyph);

    // ── i18n key contract (the exact keys + fallbacks the web source uses) ───────────────────────────────

    [Fact]
    public void No_location_i18n_key_matches_the_web_source()
    {
        Assert.Equal("route.noLocationData", RouteDisplayProjection.NoLocationKey);
        Assert.Equal("No location data", RouteDisplayProjection.NoLocationFallback);
    }

    [Fact]
    public void Round_trip_i18n_key_matches_the_web_source()
    {
        Assert.Equal("route.roundTrip", RouteDisplayProjection.RoundTripKey);
        Assert.Equal("round trip", RouteDisplayProjection.RoundTripFallback);
    }

    [Fact]
    public void Glyph_and_arrow_constants_use_the_web_code_points()
    {
        Assert.Equal("\u21BB", RouteDisplayProjection.RoundTripGlyph); // ↻ clockwise open circle arrow
        Assert.Equal(" \u2192 ", RouteDisplayProjection.Arrow);         // rightwards arrow with surrounding spaces
    }

    // ── no-location branch (web !startLabel && !endLabel → muted "No location data") ─────────────────────

    [Fact]
    public void Empty_start_renders_the_muted_no_location_line()
    {
        RouteDisplayDisplay d = Project(RouteDisplayModel.None);

        Assert.Equal(RouteKind.None, d.Kind);
        RouteDisplaySegment only = Assert.Single(d.Segments);
        Assert.Equal("No location data", only.Text);
        Assert.True(only.Muted);
        Assert.Equal("No location data", d.VisibleText);
    }

    [Fact]
    public void Both_endpoints_unresolved_is_still_no_location()
    {
        // web: an empty `end` object is still "no location data" when the start is also empty.
        RouteDisplayDisplay d = Project(new RouteDisplayModel(new RouteEndpoint(), new RouteEndpoint()));

        Assert.Equal(RouteKind.None, d.Kind);
        Assert.Equal("No location data", d.VisibleText);
    }

    // ── round-trip branch (single location, matching addresses, or close coordinates) ────────────────────

    [Fact]
    public void Single_location_renders_just_the_start_with_no_note()
    {
        RouteDisplayDisplay d = Project(RouteDisplayModel.SingleLocation(new RouteEndpoint("Home")));

        Assert.Equal(RouteKind.RoundTrip, d.Kind);
        RouteDisplaySegment only = Assert.Single(d.Segments);
        Assert.Equal("Home", only.Text);
        Assert.False(only.Muted);
        Assert.Equal("Home", d.VisibleText);
    }

    [Fact]
    public void Matching_addresses_render_the_start_plus_a_muted_round_trip_note()
    {
        RouteDisplayDisplay d = Project(
            RouteDisplayModel.Between(new RouteEndpoint("Home"), new RouteEndpoint("Home")));

        Assert.Equal(RouteKind.RoundTrip, d.Kind);
        Assert.Equal(2, d.Segments.Count);

        Assert.Equal("Home", d.Segments[0].Text);
        Assert.False(d.Segments[0].Muted);

        Assert.Equal(" \u21BB round trip", d.Segments[1].Text);
        Assert.True(d.Segments[1].Muted);

        Assert.Equal("Home \u21BB round trip", d.VisibleText);
    }

    [Fact]
    public void Close_coordinates_collapse_to_a_round_trip_with_a_note()
    {
        var start = new RouteEndpoint(Lat: 37.0000, Lon: -122.0000);
        var end = new RouteEndpoint(Lat: 37.0001, Lon: -122.0001);

        RouteDisplayDisplay d = Project(RouteDisplayModel.Between(start, end));

        Assert.Equal(RouteKind.RoundTrip, d.Kind);
        Assert.Equal(2, d.Segments.Count);
        Assert.False(d.Segments[0].Muted);
        Assert.True(d.Segments[1].Muted);
        Assert.Equal(" \u21BB round trip", d.Segments[1].Text);
    }

    [Fact]
    public void Coordinate_only_endpoint_falls_back_to_a_pin_label()
    {
        RouteDisplayDisplay d = Project(
            RouteDisplayModel.SingleLocation(new RouteEndpoint(Lat: 37.42, Lon: -122.08)));

        Assert.Equal(RouteKind.RoundTrip, d.Kind);
        Assert.Equal("\uD83D\uDCCD 37.42, -122.08", Assert.Single(d.Segments).Text);
    }

    // ── point-to-point branch (web {startLabel ?? noLocation} → {endLabel ?? noLocation}) ─────────────────

    [Fact]
    public void Distinct_endpoints_render_one_full_emphasis_start_arrow_end_run()
    {
        RouteDisplayDisplay d = Project(
            RouteDisplayModel.Between(new RouteEndpoint("Home"), new RouteEndpoint("Office")));

        Assert.Equal(RouteKind.PointToPoint, d.Kind);
        RouteDisplaySegment only = Assert.Single(d.Segments);
        Assert.Equal("Home \u2192 Office", only.Text);
        Assert.False(only.Muted);
        Assert.Equal("Home \u2192 Office", d.VisibleText);
    }

    [Fact]
    public void Point_to_point_arrow_is_the_unicode_rightwards_arrow_not_a_hyphen()
    {
        RouteDisplayDisplay d = Project(
            RouteDisplayModel.Between(new RouteEndpoint("A"), new RouteEndpoint("B")));

        Assert.Contains("\u2192", d.VisibleText, System.StringComparison.Ordinal);
        Assert.DoesNotContain("->", d.VisibleText, System.StringComparison.Ordinal);
    }

    [Fact]
    public void Missing_start_with_a_present_end_renders_no_location_on_the_start_side()
    {
        // web: startLabel ?? noLocation when only the end resolves.
        RouteDisplayDisplay d = Project(new RouteDisplayModel(new RouteEndpoint(), new RouteEndpoint("Office")));

        Assert.Equal(RouteKind.PointToPoint, d.Kind);
        Assert.Equal("No location data \u2192 Office", d.VisibleText);
    }

    // ── i18n facade (every string resolves through the localizer, never hardcoded) ───────────────────────

    [Fact]
    public void Labels_resolve_through_the_localizer_facade()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>
        {
            ["route.noLocationData"] = "Keine Standortdaten",
            ["route.roundTrip"] = "Rundfahrt",
        });

        Assert.Equal(
            "Keine Standortdaten",
            RouteDisplayProjection.Project(RouteDisplayModel.None, localizer).VisibleText);

        Assert.Equal(
            "Home \u21BB Rundfahrt",
            RouteDisplayProjection.Project(
                RouteDisplayModel.Between(new RouteEndpoint("Home"), new RouteEndpoint("Home")),
                localizer).VisibleText);
    }

    // ── icon passthrough ─────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Show_icon_flag_is_passed_through(bool showIcon)
    {
        Assert.Equal(showIcon, Project(RouteDisplayModel.SingleLocation(new RouteEndpoint("Home"), showIcon)).ShowIcon);
        Assert.Equal(showIcon, Project(new RouteDisplayModel(new RouteEndpoint(), ShowIcon: showIcon)).ShowIcon);
    }

    [Fact]
    public void Display_carries_the_map_pin_glyph_in_every_branch()
    {
        Assert.Equal("\uE707", Project(RouteDisplayModel.None).IconGlyph);
        Assert.Equal("\uE707", Project(RouteDisplayModel.SingleLocation(new RouteEndpoint("Home"))).IconGlyph);
        Assert.Equal(
            "\uE707",
            Project(RouteDisplayModel.Between(new RouteEndpoint("Home"), new RouteEndpoint("Office"))).IconGlyph);
    }

    // ── accessibility: accessible name present and equal to the line text in every branch ────────────────

    [Fact]
    public void Automation_name_equals_the_visible_line_in_every_branch()
    {
        Assert.Equal(
            Project(RouteDisplayModel.None).VisibleText,
            Project(RouteDisplayModel.None).AutomationName);

        RouteDisplayDisplay single = Project(RouteDisplayModel.SingleLocation(new RouteEndpoint("Home")));
        Assert.Equal(single.VisibleText, single.AutomationName);

        RouteDisplayDisplay pair =
            Project(RouteDisplayModel.Between(new RouteEndpoint("Home"), new RouteEndpoint("Office")));
        Assert.Equal(pair.VisibleText, pair.AutomationName);
    }

    [Fact]
    public void Automation_name_is_non_empty_in_every_branch()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project(RouteDisplayModel.None).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(
            Project(RouteDisplayModel.SingleLocation(new RouteEndpoint("Home"))).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(
            Project(RouteDisplayModel.Between(new RouteEndpoint("Home"), new RouteEndpoint("Office"))).AutomationName));
    }

    // ── diagnostics (view.opened, PII-safe — never the addresses or coordinates) ─────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RouteDisplayDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RouteDisplay", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new RouteDisplayDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => RouteDisplayProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(
            () => RouteDisplayProjection.Project(RouteDisplayModel.None, null!));

    /// <summary>An <see cref="ILocalizer"/> backed by a fixed key → value map, falling back to the English default.</summary>
    private sealed class MapLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public MapLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out string? value) ? value : fallback;
    }
}
