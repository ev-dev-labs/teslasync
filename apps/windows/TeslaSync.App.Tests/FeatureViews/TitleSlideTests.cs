using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Review;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TitleSlide</c> feature surface's UI-thread-free logic — the tolerant JSON
/// parse adapter (<c>TitleSlideModel.FromJson</c> / <c>Parse</c>, including the nested
/// <c>vehicle.display_name</c>), the content/empty branch projection, the en-US grouped year rendering that
/// matches the web <c>AnimatedNumber</c>, the blank-vehicle em-dash fallback, the localized keys, the composed
/// Narrator names, the registration metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/review/TitleSlide.tsx). The WinUI view itself
/// (feature-views\TitleSlide\TitleSlide.cs) is exercised by the app build.
/// </summary>
public sealed class TitleSlideTests
{
    private const string EmDash = "\u2014";
    private const string Car = "\uD83D\uDE97";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static TitleSlideDisplay Project(TitleSlideModel model) =>
        TitleSlideProjection.Project(model, Localizer);

    // ── Parse adapter (cached JSON → model) ─────────────────────────────────────────────────────────

    [Fact]
    public void FromJson_reads_year_and_nested_vehicle_name()
    {
        const string json = """
        {
          "year": 2026,
          "vehicle": { "id": 1, "display_name": "My Model 3", "model": "model3" }
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var model = TitleSlideModel.FromJson(doc.RootElement);

        Assert.Equal(2026, model.Year);
        Assert.Equal("My Model 3", model.VehicleName);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"year":2025}""");

        var model = TitleSlideModel.FromJson(doc.RootElement);

        Assert.Equal(2025, model.Year);
        Assert.Null(model.VehicleName);
    }

    [Fact]
    public void FromJson_accepts_numeric_string_year()
    {
        using var doc = JsonDocument.Parse("""{"year":"2024","vehicle":{"display_name":"Plaid"}}""");

        var model = TitleSlideModel.FromJson(doc.RootElement);

        Assert.Equal(2024, model.Year);
        Assert.Equal("Plaid", model.VehicleName);
    }

    [Fact]
    public void FromJson_ignores_non_string_display_name()
    {
        using var doc = JsonDocument.Parse("""{"year":2026,"vehicle":{"display_name":123}}""");

        var model = TitleSlideModel.FromJson(doc.RootElement);

        Assert.Null(model.VehicleName);
    }

    [Fact]
    public void Parse_maps_object_to_model()
    {
        using var doc = JsonDocument.Parse("""{"year":2026,"vehicle":{"display_name":"Roadster"}}""");

        var model = TitleSlideModel.Parse(doc.RootElement);

        Assert.Equal(2026, model.Year);
        Assert.Equal("Roadster", model.VehicleName);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("123")]
    [InlineData("\"x\"")]
    public void Parse_maps_non_object_to_empty(string json)
    {
        using var doc = JsonDocument.Parse(json);

        Assert.Equal(TitleSlideModel.Empty, TitleSlideModel.Parse(doc.RootElement));
    }

    // ── Content projection ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_content_groups_year_and_shows_vehicle()
    {
        var display = Project(new TitleSlideModel(2026, "My Model 3"));

        Assert.Equal(TitleSlideState.Content, display.State);
        Assert.Equal(Car, display.Emoji);
        Assert.Equal(2026, display.YearValue);
        Assert.Equal("2,026", display.YearText);
        Assert.Equal("Year in Review", display.Title);
        Assert.Equal("My Model 3", display.VehicleName);
        Assert.Equal(string.Empty, display.EmptyMessage);
    }

    [Fact]
    public void Project_content_blank_vehicle_falls_back_to_em_dash()
    {
        var display = Project(new TitleSlideModel(2026, "   "));

        Assert.Equal(TitleSlideState.Content, display.State);
        Assert.Equal(EmDash, display.VehicleName);
    }

    // ── Empty projection (absent / sentinel model) ──────────────────────────────────────────────────

    [Fact]
    public void Project_empty_when_no_year_and_no_vehicle()
    {
        var display = Project(TitleSlideModel.Empty);

        Assert.Equal(TitleSlideState.Empty, display.State);
        Assert.Equal(Car, display.Emoji);
        Assert.Equal("Year in Review", display.Title);
        Assert.Equal("No drive data for this year", display.EmptyMessage);
        Assert.Equal(string.Empty, display.VehicleName);
        Assert.Equal(string.Empty, display.YearText);
    }

    [Fact]
    public void Project_content_when_year_present_without_vehicle()
    {
        var display = Project(new TitleSlideModel(2026, null));

        Assert.Equal(TitleSlideState.Content, display.State);
        Assert.Equal("2,026", display.YearText);
        Assert.Equal(EmDash, display.VehicleName);
    }

    // ── Year formatting (en-US grouping, web fmtNumber parity) ──────────────────────────────────────

    [Theory]
    [InlineData(2026, "2,026")]
    [InlineData(999, "999")]
    [InlineData(12345, "12,345")]
    [InlineData(0, "0")]
    public void FormatYear_matches_web_grouping(int year, string expected)
    {
        Assert.Equal(expected, TitleSlideProjection.FormatYear(year));
    }

    // ── Accessibility (Narrator name) ───────────────────────────────────────────────────────────────

    [Fact]
    public void AutomationName_content_composes_year_title_and_vehicle()
    {
        var display = Project(new TitleSlideModel(2026, "My Model 3"));

        Assert.Equal("2,026, Year in Review, My Model 3", display.AutomationName);
    }

    [Fact]
    public void AutomationName_empty_composes_title_and_message()
    {
        var display = Project(TitleSlideModel.Empty);

        Assert.Equal("Year in Review, No drive data for this year", display.AutomationName);
    }

    // ── i18n keys (every source key resolves through the facade) ────────────────────────────────────

    [Fact]
    public void Projection_requests_the_catalog_keys()
    {
        var recorder = new RecordingLocalizer();

        TitleSlideProjection.Project(new TitleSlideModel(2026, "My Model 3"), recorder);
        TitleSlideProjection.Project(TitleSlideModel.Empty, recorder);

        Assert.Contains(TitleSlideProjection.TitleKey, recorder.Keys);
        Assert.Contains(TitleSlideProjection.NoDataKey, recorder.Keys);
        Assert.Equal("yearReview.title", TitleSlideProjection.TitleKey);
        Assert.Equal("yearReview.noDriveData", TitleSlideProjection.NoDataKey);
    }

    // ── Diagnostics (PII-safe view.opened) ──────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened()
    {
        var emitted = new List<string>();
        var diagnostics = new TitleSlideDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TitleSlide", Assert.Single(emitted));
    }

    // ── Registration metadata ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_slug_and_emoji()
    {
        Assert.Equal("TitleSlide", TitleSlideRegistration.Slug);
        Assert.Equal("\uD83D\uDE97", TitleSlideRegistration.CarEmoji);
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
