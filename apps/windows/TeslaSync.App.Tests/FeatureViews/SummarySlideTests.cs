using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Review;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SummarySlide</c> feature surface's UI-thread-free logic — the tolerant JSON
/// parse adapter (<c>YearReviewSummary.FromJson</c> / <c>ParseNullable</c>, including the nested vehicle), the
/// content/empty branch projection, the SI distance conversion (metric + imperial), the canonical-unit headline
/// stats with en-US grouping, the JavaScript-faithful <c>Math.round</c> gas-savings gate and line, the localized
/// keys, the composed Narrator name and the diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/review/SummarySlide.tsx). The WinUI view itself
/// (feature-views\SummarySlide\SummarySlide.cs) is exercised by the app build.
/// </summary>
public sealed class SummarySlideTests
{
    private const string EmDash = "\u2014";
    private const string Co2Saved = "kg CO\u2082 saved";
    private const string MoneyEmoji = "\U0001F4B0";
    private const string CameraEmoji = "\U0001F4F8";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static YearReviewSummary Summary(
        int year = 2025,
        string vehicleName = "My Model 3",
        string vehicleModel = "Model 3",
        long totalDrives = 350,
        double totalDistanceKm = 1609.344,
        double totalEnergyKwh = 3200,
        long totalChargeSessions = 88,
        double co2OffsetKg = 1450,
        double gasSavings = 1234.5) =>
        new(year, vehicleName, vehicleModel, totalDrives, totalDistanceKm, totalEnergyKwh, totalChargeSessions, co2OffsetKg, gasSavings);

    private static SummarySlideModel Model(YearReviewSummary? review) => new(review);

    private static SummarySlideDisplay Project(SummarySlideModel model, UnitPref units) =>
        SummarySlideProjection.Project(model, units, Localizer);

    // ── Parse adapter (cached JSON → model) ─────────────────────────────────────────────────────────

    [Fact]
    public void FromJson_reads_snake_case_object_with_nested_vehicle()
    {
        const string json = """
        {
          "year": 2025,
          "vehicle": { "id": 7, "display_name": "My Model 3", "model": "Model 3" },
          "total_drives": 350,
          "total_distance_km": 1609.344,
          "total_energy_kwh": 3200,
          "total_charge_sessions": 88,
          "co2_offset_kg": 1450,
          "gas_savings": 1234.5
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var review = YearReviewSummary.FromJson(doc.RootElement);

        Assert.Equal(2025, review.Year);
        Assert.Equal("My Model 3", review.VehicleName);
        Assert.Equal("Model 3", review.VehicleModel);
        Assert.Equal(350, review.TotalDrives);
        Assert.Equal(1609.344, review.TotalDistanceKm);
        Assert.Equal(3200, review.TotalEnergyKwh);
        Assert.Equal(88, review.TotalChargeSessions);
        Assert.Equal(1450, review.Co2OffsetKg);
        Assert.Equal(1234.5, review.GasSavings);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"year":2024}""");

        var review = YearReviewSummary.FromJson(doc.RootElement);

        Assert.Equal(2024, review.Year);
        Assert.Equal(string.Empty, review.VehicleName);
        Assert.Equal(string.Empty, review.VehicleModel);
        Assert.Equal(0, review.TotalDrives);
        Assert.Equal(0, review.TotalDistanceKm);
        Assert.Equal(0, review.TotalEnergyKwh);
        Assert.Equal(0, review.TotalChargeSessions);
        Assert.Equal(0, review.Co2OffsetKg);
        Assert.Equal(0, review.GasSavings);
    }

    [Fact]
    public void FromJson_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"year":"2025","total_drives":"350","total_distance_km":"1609.344","total_charge_sessions":"88","gas_savings":"1234.5"}""");

        var review = YearReviewSummary.FromJson(doc.RootElement);

        Assert.Equal(2025, review.Year);
        Assert.Equal(350, review.TotalDrives);
        Assert.Equal(1609.344, review.TotalDistanceKm);
        Assert.Equal(88, review.TotalChargeSessions);
        Assert.Equal(1234.5, review.GasSavings);
    }

    [Fact]
    public void ParseNullable_maps_object_to_summary()
    {
        using var doc = JsonDocument.Parse("""{"year":2025}""");

        Assert.NotNull(YearReviewSummary.ParseNullable(doc.RootElement));
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("123")]
    [InlineData("\"x\"")]
    public void ParseNullable_maps_non_object_to_null(string json)
    {
        using var doc = JsonDocument.Parse(json);

        Assert.Null(YearReviewSummary.ParseNullable(doc.RootElement));
    }

    // ── Content projection (metric) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_content_metric_header_and_vehicle()
    {
        var display = Project(Model(Summary()), UnitPref.Metric);

        Assert.Equal(SummarySlideState.Content, display.State);
        Assert.Equal("2025", display.YearText);
        Assert.Equal("Year in Review", display.Title);
        Assert.Equal("My Model 3", display.VehicleName);
        Assert.Equal("Model 3", display.VehicleModel);
        Assert.Equal("TeslaSync \u2022 Year in Review", display.BrandText);
        Assert.Equal(CameraEmoji + " Screenshot to share your year!", display.ScreenshotText);
        Assert.Equal(string.Empty, display.EmptyMessage);
    }

    [Fact]
    public void Project_content_metric_stats_values_labels_and_glyphs()
    {
        var display = Project(Model(Summary()), UnitPref.Metric);

        Assert.Equal(5, display.Stats.Count);

        // Drives (count, no conversion) with the Car glyph.
        Assert.Equal(SummarySlideRegistration.CarGlyph, display.Stats[0].Glyph);
        Assert.Equal(350, display.Stats[0].Value);
        Assert.Equal("350", display.Stats[0].ValueText);
        Assert.Equal("Drives", display.Stats[0].Label);
        Assert.Equal(0, display.Stats[0].Decimals);

        // Distance (SI km → display unit) with the Car glyph and the unit label (not a translation key).
        Assert.Equal(SummarySlideRegistration.CarGlyph, display.Stats[1].Glyph);
        Assert.Equal("1,609", display.Stats[1].ValueText);
        Assert.Equal("km", display.Stats[1].Label);

        // Energy shown verbatim as kWh.
        Assert.Equal(SummarySlideRegistration.ZapGlyph, display.Stats[2].Glyph);
        Assert.Equal("3,200", display.Stats[2].ValueText);
        Assert.Equal("kWh", display.Stats[2].Label);

        // Charges (count) with the Plug glyph.
        Assert.Equal(SummarySlideRegistration.PlugGlyph, display.Stats[3].Glyph);
        Assert.Equal("88", display.Stats[3].ValueText);
        Assert.Equal("Charges", display.Stats[3].Label);

        // CO₂ (kg) with the Leaf glyph.
        Assert.Equal(SummarySlideRegistration.LeafGlyph, display.Stats[4].Glyph);
        Assert.Equal("1,450", display.Stats[4].ValueText);
        Assert.Equal(Co2Saved, display.Stats[4].Label);
    }

    // ── Content projection (imperial) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Project_content_imperial_converts_only_distance()
    {
        var display = Project(Model(Summary()), UnitPref.Imperial);

        // 1609.344 km → 1,609,344 m → exactly 1000 mi.
        Assert.Equal(1000.0, display.Stats[1].Value, 6);
        Assert.Equal("1,000", display.Stats[1].ValueText);
        Assert.Equal("mi", display.Stats[1].Label);

        // Counts and canonical-unit figures are unit-independent.
        Assert.Equal("350", display.Stats[0].ValueText);
        Assert.Equal("3,200", display.Stats[2].ValueText);
        Assert.Equal("kWh", display.Stats[2].Label);
        Assert.Equal("1,450", display.Stats[4].ValueText);
    }

    // ── Gas-savings line (web gas_savings > 0) ──────────────────────────────────────────────────────

    [Fact]
    public void Project_shows_rounded_savings_line_when_positive()
    {
        var display = Project(Model(Summary(gasSavings: 1234.5)), UnitPref.Metric);

        Assert.True(display.ShowSavings);
        Assert.Equal("Saved $1235 vs. gas", display.SavingsAnnouncement);
        Assert.Equal(MoneyEmoji + " Saved $1235 vs. gas", display.SavingsText);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void Project_hides_savings_line_when_not_positive(double gasSavings)
    {
        var display = Project(Model(Summary(gasSavings: gasSavings)), UnitPref.Metric);

        Assert.False(display.ShowSavings);
        Assert.Equal(string.Empty, display.SavingsText);
        Assert.Equal(string.Empty, display.SavingsAnnouncement);
    }

    [Theory]
    [InlineData(1234.5, 1235)]
    [InlineData(1234.4, 1234)]
    [InlineData(0.5, 1)]
    [InlineData(2.5, 3)]
    [InlineData(0.0, 0)]
    public void JsRound_rounds_half_up(double value, long expected)
    {
        Assert.Equal(expected, SummarySlideProjection.JsRound(value));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void JsRound_non_finite_is_zero(double value)
    {
        Assert.Equal(0, SummarySlideProjection.JsRound(value));
    }

    // ── Empty projection (native robustness for a null summary) ─────────────────────────────────────

    [Fact]
    public void Project_empty_when_no_summary()
    {
        var display = Project(Model(null), UnitPref.Metric);

        Assert.Equal(SummarySlideState.Empty, display.State);
        Assert.Equal("No drive data for this year", display.EmptyMessage);
        Assert.Equal("No drive data for this year", display.AutomationName);
        Assert.Empty(display.Stats);
        Assert.False(display.ShowSavings);
    }

    // ── Missing vehicle copy falls back to an em dash (never a blank box) ────────────────────────────

    [Fact]
    public void Project_missing_vehicle_strings_render_em_dash()
    {
        var display = Project(Model(Summary(vehicleName: "", vehicleModel: "")), UnitPref.Metric);

        Assert.Equal(EmDash, display.VehicleName);
        Assert.Equal(EmDash, display.VehicleModel);
    }

    // ── Accessibility (Narrator name) ───────────────────────────────────────────────────────────────

    [Fact]
    public void AutomationName_content_composes_header_vehicle_stats_and_savings()
    {
        var display = Project(Model(Summary()), UnitPref.Metric);

        Assert.Equal(
            "2025 Year in Review, My Model 3 Model 3, 350 Drives, 1,609 km, 3,200 kWh, 88 Charges, "
                + "1,450 " + Co2Saved + ", Saved $1235 vs. gas",
            display.AutomationName);
    }

    [Fact]
    public void AutomationName_omits_savings_when_not_positive()
    {
        var display = Project(Model(Summary(gasSavings: 0)), UnitPref.Metric);

        Assert.DoesNotContain("Saved $", display.AutomationName);
        Assert.EndsWith("1,450 " + Co2Saved, display.AutomationName);
    }

    // ── i18n keys (every source key resolves through the facade) ────────────────────────────────────

    [Fact]
    public void Projection_requests_the_catalog_keys()
    {
        var recorder = new RecordingLocalizer();

        SummarySlideProjection.Project(Model(Summary()), UnitPref.Metric, recorder);
        SummarySlideProjection.Project(Model(null), UnitPref.Metric, recorder);

        Assert.Contains(SummarySlideProjection.TitleKey, recorder.Keys);
        Assert.Contains(SummarySlideProjection.TotalDrivesKey, recorder.Keys);
        Assert.Contains(SummarySlideProjection.EnergyKwhKey, recorder.Keys);
        Assert.Contains(SummarySlideProjection.ChargesKey, recorder.Keys);
        Assert.Contains(SummarySlideProjection.Co2KgSavedKey, recorder.Keys);
        Assert.Contains(SummarySlideProjection.SavedSummaryKey, recorder.Keys);
        Assert.Contains(SummarySlideProjection.ScreenshotKey, recorder.Keys);
        Assert.Contains(SummarySlideProjection.NoDataKey, recorder.Keys);

        Assert.Equal("yearReview.title", SummarySlideProjection.TitleKey);
        Assert.Equal("yearReview.totalDrives", SummarySlideProjection.TotalDrivesKey);
        Assert.Equal("yearReview.energyKwh", SummarySlideProjection.EnergyKwhKey);
        Assert.Equal("yearReview.charges", SummarySlideProjection.ChargesKey);
        Assert.Equal("yearReview.co2KgSaved", SummarySlideProjection.Co2KgSavedKey);
        Assert.Equal("yearReview.savedSummary", SummarySlideProjection.SavedSummaryKey);
        Assert.Equal("yearReview.screenshot", SummarySlideProjection.ScreenshotKey);
        Assert.Equal("yearReview.noDriveData", SummarySlideProjection.NoDataKey);
    }

    // ── Diagnostics (PII-safe view.opened) ──────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened()
    {
        var emitted = new List<string>();
        var diagnostics = new SummarySlideDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SummarySlide", Assert.Single(emitted));
    }

    // ── Registration metadata ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_slug_and_glyphs()
    {
        Assert.Equal("SummarySlide", SummarySlideRegistration.Slug);
        Assert.Equal("\uE804", SummarySlideRegistration.CarGlyph);
        Assert.Equal("\uE945", SummarySlideRegistration.ZapGlyph);
        Assert.Equal("\uE7E8", SummarySlideRegistration.PlugGlyph);
        Assert.Equal("\uE909", SummarySlideRegistration.LeafGlyph);
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
