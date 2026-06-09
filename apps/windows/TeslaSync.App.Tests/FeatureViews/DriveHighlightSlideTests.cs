using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Review;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DriveHighlightSlide</c> feature surface's UI-thread-free logic — the
/// tolerant JSON parse adapter (<c>YearReviewDriveHighlight.FromJson</c> / <c>ParseNullable</c>), the
/// content/empty branch projection, the SI distance conversion (metric + imperial), the JavaScript-faithful
/// <c>Math.round</c> rendering, the duration formatting (hour rollover, sub-hour, zero), the efficiency em-dash
/// gate, the address em-dash fallbacks, the localized keys, the composed Narrator names and the diagnostics.
/// Mirrors the web spec (web/src/features/analytics/components/review/DriveHighlightSlide.tsx). The WinUI view
/// itself (feature-views\DriveHighlightSlide\DriveHighlightSlide.cs) is exercised by the app build.
/// </summary>
public sealed class DriveHighlightSlideTests
{
    private const string EmDash = "\u2014";
    private const string Arrow = "\u2192";
    private const string Flag = "\uD83C\uDFC1";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static YearReviewDriveHighlight Highlight(
        long driveId = 7,
        string date = "Jun 6, 2026",
        double distanceKm = 123.4,
        double durationMin = 95,
        string? start = "123 Market St",
        string? end = "1 Tesla Rd",
        double efficiencyWhKm = 150) =>
        new(driveId, date, distanceKm, durationMin, start, end, efficiencyWhKm);

    private static DriveHighlightSlideModel Model(
        YearReviewDriveHighlight? drive,
        string label = "Longest Drive",
        string emoji = Flag) =>
        new(drive, label, emoji);

    private static DriveHighlightSlideDisplay Project(DriveHighlightSlideModel model, UnitPref units) =>
        DriveHighlightSlideProjection.Project(model, units, Localizer);

    // ── Parse adapter (cached JSON → model) ─────────────────────────────────────────────────────────

    [Fact]
    public void FromJson_reads_snake_case_object()
    {
        const string json = """
        {
          "drive_id": 42,
          "date": "Jun 6, 2026",
          "distance_km": 123.4,
          "duration_min": 95,
          "start_address": "123 Market St",
          "end_address": "1 Tesla Rd",
          "efficiency_wh_km": 150
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var drive = YearReviewDriveHighlight.FromJson(doc.RootElement);

        Assert.Equal(42, drive.DriveId);
        Assert.Equal("Jun 6, 2026", drive.Date);
        Assert.Equal(123.4, drive.DistanceKm);
        Assert.Equal(95, drive.DurationMin);
        Assert.Equal("123 Market St", drive.StartAddress);
        Assert.Equal("1 Tesla Rd", drive.EndAddress);
        Assert.Equal(150, drive.EfficiencyWhKm);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"drive_id":3}""");

        var drive = YearReviewDriveHighlight.FromJson(doc.RootElement);

        Assert.Equal(3, drive.DriveId);
        Assert.Equal(string.Empty, drive.Date);
        Assert.Equal(0, drive.DistanceKm);
        Assert.Equal(0, drive.DurationMin);
        Assert.Null(drive.StartAddress);
        Assert.Null(drive.EndAddress);
        Assert.Equal(0, drive.EfficiencyWhKm);
    }

    [Fact]
    public void FromJson_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"drive_id":"9","distance_km":"123.4","duration_min":"95","efficiency_wh_km":"150"}""");

        var drive = YearReviewDriveHighlight.FromJson(doc.RootElement);

        Assert.Equal(9, drive.DriveId);
        Assert.Equal(123.4, drive.DistanceKm);
        Assert.Equal(95, drive.DurationMin);
        Assert.Equal(150, drive.EfficiencyWhKm);
    }

    [Fact]
    public void ParseNullable_maps_object_to_highlight()
    {
        using var doc = JsonDocument.Parse("""{"drive_id":1}""");

        Assert.NotNull(YearReviewDriveHighlight.ParseNullable(doc.RootElement));
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("123")]
    [InlineData("\"x\"")]
    public void ParseNullable_maps_non_object_to_null(string json)
    {
        using var doc = JsonDocument.Parse(json);

        Assert.Null(YearReviewDriveHighlight.ParseNullable(doc.RootElement));
    }

    // ── Content projection (metric) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_content_metric()
    {
        var display = Project(Model(Highlight()), UnitPref.Metric);

        Assert.Equal(DriveHighlightSlideState.Content, display.State);
        Assert.Equal(Flag, display.Emoji);
        Assert.Equal("Longest Drive", display.Label);
        Assert.Equal("123 Market St", display.RouteStart);
        Assert.Equal("1 Tesla Rd", display.RouteEnd);
        Assert.Equal("123", display.DistanceText);
        Assert.Equal("km", display.DistanceUnit);
        Assert.Equal("1h 35m", display.DurationText);
        Assert.Equal("duration", display.DurationLabel);
        Assert.Equal("150", display.EfficiencyText);
        Assert.Equal("Wh/km", display.EfficiencyUnit);
        Assert.Equal("Jun 6, 2026", display.DateText);
        Assert.Equal(string.Empty, display.EmptyMessage);
    }

    // ── Content projection (imperial) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Project_content_imperial_converts_distance_and_efficiency()
    {
        var display = Project(Model(Highlight()), UnitPref.Imperial);

        // 123.4 km → 123_400 m → 76.677 mi → round 77.
        Assert.Equal("77", display.DistanceText);
        Assert.Equal("mi", display.DistanceUnit);

        // 150 Wh/km × 1.609344 = 241.4 → round 241.
        Assert.Equal("241", display.EfficiencyText);
        Assert.Equal("Wh/mi", display.EfficiencyUnit);

        // Duration is unit-independent.
        Assert.Equal("1h 35m", display.DurationText);
    }

    // ── Empty projection (web !drive) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Project_empty_when_no_drive()
    {
        var display = Project(Model(null), UnitPref.Metric);

        Assert.Equal(DriveHighlightSlideState.Empty, display.State);
        Assert.Equal(Flag, display.Emoji);
        Assert.Equal("No drive data for this year", display.EmptyMessage);
        Assert.Equal("No drive data for this year", display.AutomationName);
        Assert.Equal(string.Empty, display.DistanceText);
    }

    // ── Duration formatting (web hours/mins) ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(45, "45m")]
    [InlineData(59, "59m")]
    [InlineData(60, "1h 0m")]
    [InlineData(95, "1h 35m")]
    [InlineData(120, "2h 0m")]
    [InlineData(0, "0m")]
    public void FormatDuration_matches_web(double minutes, string expected)
    {
        Assert.Equal(expected, DriveHighlightSlideProjection.FormatDuration(minutes));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void FormatDuration_non_finite_is_em_dash(double minutes)
    {
        Assert.Equal(EmDash, DriveHighlightSlideProjection.FormatDuration(minutes));
    }

    // ── Rounding (JavaScript Math.round — round half up) ────────────────────────────────────────────

    [Theory]
    [InlineData(2.5, "3")]
    [InlineData(2.49, "2")]
    [InlineData(3.5, "4")]
    [InlineData(0.0, "0")]
    [InlineData(123.4, "123")]
    public void FormatRounded_rounds_half_up(double value, string expected)
    {
        Assert.Equal(expected, DriveHighlightSlideProjection.FormatRounded(value));
    }

    // ── Efficiency gate + address fallbacks ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void Efficiency_em_dash_when_not_positive(double efficiency)
    {
        var display = Project(Model(Highlight(efficiencyWhKm: efficiency)), UnitPref.Metric);

        Assert.Equal(EmDash, display.EfficiencyText);
    }

    [Fact]
    public void Missing_addresses_render_em_dash()
    {
        var display = Project(Model(Highlight(start: null, end: "")), UnitPref.Metric);

        Assert.Equal(EmDash, display.RouteStart);
        Assert.Equal(EmDash, display.RouteEnd);
    }

    // ── Accessibility (Narrator name) ───────────────────────────────────────────────────────────────

    [Fact]
    public void AutomationName_content_composes_label_route_stats_and_date()
    {
        var display = Project(Model(Highlight()), UnitPref.Metric);

        Assert.Equal(
            $"Longest Drive, 123 Market St {Arrow} 1 Tesla Rd, 123 km, 1h 35m duration, 150 Wh/km, Jun 6, 2026",
            display.AutomationName);
    }

    // ── i18n keys (every source key resolves through the facade) ────────────────────────────────────

    [Fact]
    public void Projection_requests_the_catalog_keys()
    {
        var recorder = new RecordingLocalizer();

        DriveHighlightSlideProjection.Project(Model(Highlight()), UnitPref.Metric, recorder);
        DriveHighlightSlideProjection.Project(Model(null), UnitPref.Metric, recorder);

        Assert.Contains(DriveHighlightSlideProjection.DurationKey, recorder.Keys);
        Assert.Contains(DriveHighlightSlideProjection.NoDriveDataKey, recorder.Keys);
        Assert.Equal("yearReview.duration", DriveHighlightSlideProjection.DurationKey);
        Assert.Equal("yearReview.noDriveData", DriveHighlightSlideProjection.NoDriveDataKey);
    }

    // ── Diagnostics (PII-safe view.opened) ──────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened()
    {
        var emitted = new List<string>();
        var diagnostics = new DriveHighlightSlideDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveHighlightSlide", Assert.Single(emitted));
    }

    // ── Registration metadata ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_slug_and_glyphs()
    {
        Assert.Equal("DriveHighlightSlide", DriveHighlightSlideRegistration.Slug);
        Assert.Equal("\uE81D", DriveHighlightSlideRegistration.MapPinGlyph);
        Assert.Equal("\uE72A", DriveHighlightSlideRegistration.ArrowRightGlyph);
        Assert.Equal("\uE823", DriveHighlightSlideRegistration.ClockGlyph);
        Assert.Equal("\uE945", DriveHighlightSlideRegistration.ZapGlyph);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
