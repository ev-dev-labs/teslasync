using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Review;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SlideRenderer</c> feature surface's UI-thread-free logic — the YearReview
/// JSON adapter, the <c>switch (slide.type)</c> kind dispatch, the <c>field ?? 'distance'</c> stat-hero
/// default, the <c>drive-highlight</c> selection (which drive + the <c>t()</c> label + the emoji), the
/// <c>bg-gradient-to-br</c> Tailwind-token parse, the never-blank empty fallback (web <c>default: null</c>),
/// the accessible names and the diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/review/SlideRenderer.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class SlideRendererTests
{
    private const string MountainEmoji = "\U0001F3D4\uFE0F";
    private const string HerbEmoji = "\U0001F33F";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static SlideDisplay Project(string type, string? field = null, string bg = "from-slate-900 to-slate-900", YearReviewSnapshot? data = null) =>
        SlideRendererProjection.Project(
            new SlideRenderModel(0, new SlideDescriptor(type, bg, field), data ?? YearReviewSnapshot.Empty),
            Localizer);

    // ── Adapter: YearReview snapshot parse (cached JSON → projection input) ──────────────────────────────

    private const string FullYearReview = """
    {
      "year": 2024,
      "longest_drive": {
        "drive_id": 42, "date": "2024-07-04", "distance_km": 512.5, "duration_min": 375,
        "start_address": "San Jose, CA", "end_address": "Los Angeles, CA", "efficiency_wh_km": 168.2
      },
      "most_efficient_drive": {
        "drive_id": 7, "date": "2024-03-12", "distance_km": 40.1, "duration_min": 55,
        "start_address": "Home", "end_address": "Office", "efficiency_wh_km": 121.0
      },
      "comparisons": [
        { "label": "Trees planted", "value": "37", "emoji": "🌳" },
        { "label": "Phones charged", "value": "1.2M", "emoji": "🔋" }
      ]
    }
    """;

    [Fact]
    public void Adapter_parses_year_drives_and_comparisons()
    {
        var snapshot = YearReviewSnapshot.FromJson(Json(FullYearReview));

        Assert.Equal(2024, snapshot.Year);
        Assert.NotNull(snapshot.LongestDrive);
        Assert.Equal(42, snapshot.LongestDrive!.DriveId);
        Assert.Equal("San Jose, CA", snapshot.LongestDrive.StartAddress);
        Assert.Equal(512.5, snapshot.LongestDrive.DistanceKm);
        Assert.Equal(375, snapshot.LongestDrive.DurationMin);
        Assert.NotNull(snapshot.MostEfficientDrive);
        Assert.Equal("Office", snapshot.MostEfficientDrive!.EndAddress);
        Assert.Collection(
            snapshot.Comparisons,
            c => Assert.Equal(("Trees planted", "37", "🌳"), (c.Label, c.Value, c.Emoji)),
            c => Assert.Equal(("Phones charged", "1.2M", "🔋"), (c.Label, c.Value, c.Emoji)));
    }

    [Fact]
    public void Adapter_is_null_tolerant_for_missing_drives_and_arrays()
    {
        var snapshot = YearReviewSnapshot.FromJson(Json("""{ "year": 2023, "longest_drive": null }"""));

        Assert.Equal(2023, snapshot.Year);
        Assert.Null(snapshot.LongestDrive);
        Assert.Null(snapshot.MostEfficientDrive);
        Assert.Empty(snapshot.Comparisons);
    }

    [Fact]
    public void Adapter_returns_empty_for_non_object_body()
    {
        Assert.Same(YearReviewSnapshot.Empty, YearReviewSnapshot.FromJson(Json("[]")));
        Assert.Equal(0, YearReviewSnapshot.FromJson(Json("\"nope\"")).Year);
    }

    [Fact]
    public void Adapter_coerces_non_finite_and_typed_scalars()
    {
        var drive = YearReviewDriveHighlight.FromJson(Json("""
        { "drive_id": "99", "distance_km": "Infinity", "duration_min": 12.7, "date": 5 }
        """));

        Assert.Equal(99, drive.DriveId);     // string → long
        Assert.Equal(0, drive.DistanceKm);   // non-finite → 0
        Assert.Equal(13, drive.DurationMin); // rounded
        Assert.Equal(string.Empty, drive.Date); // non-string → empty
    }

    // ── Dispatch: switch (slide.type) → the ten kinds + the default arm ─────────────────────────────────

    [Theory]
    [InlineData("title", SlideKind.Title)]
    [InlineData("stat-hero", SlideKind.StatHero)]
    [InlineData("stat-chart", SlideKind.StatChart)]
    [InlineData("drive-highlight", SlideKind.DriveHighlight)]
    [InlineData("charging-breakdown", SlideKind.ChargingBreakdown)]
    [InlineData("savings", SlideKind.Savings)]
    [InlineData("environment", SlideKind.Environment)]
    [InlineData("patterns", SlideKind.Patterns)]
    [InlineData("comparisons", SlideKind.Comparisons)]
    [InlineData("summary", SlideKind.Summary)]
    public void ParseKind_maps_each_web_type(string type, SlideKind expected)
    {
        Assert.Equal(expected, SlideRendererProjection.ParseKind(type));
    }

    [Theory]
    [InlineData("")]
    [InlineData("unknown-slide")]
    [InlineData(null)]
    public void ParseKind_unknown_type_is_Unknown(string? type)
    {
        Assert.Equal(SlideKind.Unknown, SlideRendererProjection.ParseKind(type));
    }

    [Fact]
    public void Dispatch_reproduces_the_canonical_slide_defs_order()
    {
        // The twelve web SLIDE_DEFS entries (web review/slides.ts) project to these kinds in order.
        var defs = new (string Type, string? Field)[]
        {
            ("title", null),
            ("stat-hero", "distance"),
            ("stat-chart", "drives"),
            ("drive-highlight", "longest"),
            ("stat-hero", "energy"),
            ("charging-breakdown", null),
            ("savings", null),
            ("environment", null),
            ("patterns", null),
            ("drive-highlight", "efficient"),
            ("comparisons", null),
            ("summary", null),
        };

        var kinds = defs.Select(d => Project(d.Type, d.Field).Kind).ToArray();

        Assert.Equal(
            new[]
            {
                SlideKind.Title, SlideKind.StatHero, SlideKind.StatChart, SlideKind.DriveHighlight,
                SlideKind.StatHero, SlideKind.ChargingBreakdown, SlideKind.Savings, SlideKind.Environment,
                SlideKind.Patterns, SlideKind.DriveHighlight, SlideKind.Comparisons, SlideKind.Summary,
            },
            kinds);
    }

    // ── Field default: web slide.field ?? 'distance' (stat-hero only) ───────────────────────────────────

    [Fact]
    public void StatHero_field_defaults_to_distance_when_absent()
    {
        Assert.Equal("distance", Project("stat-hero", field: null).Field);
        Assert.Equal("distance", Project("stat-hero", field: "").Field);
    }

    [Fact]
    public void StatHero_field_passes_through_when_present()
    {
        Assert.Equal("energy", Project("stat-hero", field: "energy").Field);
    }

    [Fact]
    public void Non_stat_hero_field_is_not_defaulted()
    {
        Assert.Equal(string.Empty, Project("title", field: null).Field);
        Assert.Equal("longest", Project("drive-highlight", field: "longest").Field);
    }

    // ── Drive-highlight selection: web slide.field === 'longest' branch ─────────────────────────────────

    [Fact]
    public void DriveHighlight_longest_selects_longest_drive_label_and_emoji()
    {
        var data = YearReviewSnapshot.FromJson(Json(FullYearReview));

        var display = Project("drive-highlight", field: "longest", data: data);

        var highlight = Assert.IsType<DriveHighlightSelection>(display.DriveHighlight);
        Assert.Equal(DriveHighlightKind.Longest, highlight.Kind);
        Assert.Equal("Longest Drive", highlight.Label);
        Assert.Equal(MountainEmoji, highlight.Emoji);
        Assert.Equal(42, highlight.Drive!.DriveId);
    }

    [Theory]
    [InlineData("efficient")]
    [InlineData(null)]
    [InlineData("anything-else")]
    public void DriveHighlight_non_longest_selects_most_efficient_drive(string? field)
    {
        var data = YearReviewSnapshot.FromJson(Json(FullYearReview));

        var highlight = Assert.IsType<DriveHighlightSelection>(Project("drive-highlight", field: field, data: data).DriveHighlight);

        Assert.Equal(DriveHighlightKind.MostEfficient, highlight.Kind);
        Assert.Equal("Most Efficient Drive", highlight.Label);
        Assert.Equal(HerbEmoji, highlight.Emoji);
        Assert.Equal(7, highlight.Drive!.DriveId);
    }

    [Fact]
    public void DriveHighlight_resolves_label_even_when_drive_is_null()
    {
        // web: the label/emoji resolve in SlideRenderer; the null drive is the child's empty branch.
        var highlight = Assert.IsType<DriveHighlightSelection>(Project("drive-highlight", field: "longest").DriveHighlight);

        Assert.Equal("Longest Drive", highlight.Label);
        Assert.Null(highlight.Drive);
    }

    [Fact]
    public void Non_drive_highlight_kinds_have_no_drive_highlight()
    {
        Assert.Null(Project("title").DriveHighlight);
        Assert.Null(Project("summary").DriveHighlight);
    }

    // ── Route summary used by the built-in caption + Narrator name ──────────────────────────────────────

    [Fact]
    public void RouteSummary_joins_start_and_end_with_an_arrow()
    {
        var drive = YearReviewSnapshot.FromJson(Json(FullYearReview)).LongestDrive;
        Assert.Equal("San Jose, CA \u2192 Los Angeles, CA", SlideRendererProjection.RouteSummary(drive));
    }

    [Fact]
    public void RouteSummary_is_empty_when_both_addresses_are_blank()
    {
        var drive = new YearReviewDriveHighlight(1, "2024-01-01", 0, 0, "", "", 0);
        Assert.Equal(string.Empty, SlideRendererProjection.RouteSummary(drive));
        Assert.Equal(string.Empty, SlideRendererProjection.RouteSummary(null));
    }

    // ── Gradient parse: web bg-gradient-to-br from-… via-… to-… ─────────────────────────────────────────

    [Fact]
    public void Gradient_parses_three_named_tailwind_stops()
    {
        var gradient = SlideRendererProjection.ParseGradient("from-blue-900 via-indigo-900 to-slate-900");

        Assert.Equal(new SlideColor(0x1E, 0x3A, 0x8A), gradient.From);
        Assert.Equal(new SlideColor(0x31, 0x2E, 0x81), gradient.Via);
        Assert.Equal(new SlideColor(0x0F, 0x17, 0x2A), gradient.To);
    }

    [Fact]
    public void Gradient_interpolates_a_missing_via_stop()
    {
        var gradient = SlideRendererProjection.ParseGradient("from-blue-900 to-slate-900");

        // midpoint of blue-900 (30,58,138) and slate-900 (15,23,42)
        Assert.Equal(new SlideColor(22, 40, 90), gradient.Via);
    }

    [Fact]
    public void Gradient_unknown_tokens_fall_back_to_slate()
    {
        var slate = new SlideColor(0x0F, 0x17, 0x2A);
        var gradient = SlideRendererProjection.ParseGradient("from-mauve-700 to-chartreuse-100");

        Assert.Equal(slate, gradient.From);
        Assert.Equal(slate, gradient.To);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Gradient_empty_input_is_the_slate_fallback(string? bg)
    {
        var slate = new SlideColor(0x0F, 0x17, 0x2A);
        var gradient = SlideRendererProjection.ParseGradient(bg);

        Assert.Equal(slate, gradient.From);
        Assert.Equal(slate, gradient.Via);
        Assert.Equal(slate, gradient.To);
    }

    [Fact]
    public void Every_slide_def_background_resolves_without_throwing()
    {
        var backgrounds = new[]
        {
            "from-blue-900 via-indigo-900 to-slate-900",
            "from-emerald-900 via-green-900 to-teal-900",
            "from-purple-900 via-violet-900 to-indigo-900",
            "from-amber-900 via-orange-900 to-yellow-900",
            "from-cyan-900 via-sky-900 to-blue-900",
            "from-orange-900 via-red-900 to-pink-900",
            "from-emerald-900 via-teal-900 to-cyan-900",
            "from-green-900 via-emerald-900 to-lime-900",
            "from-indigo-900 via-blue-900 to-violet-900",
            "from-teal-900 via-cyan-900 to-sky-900",
            "from-pink-900 via-rose-900 to-fuchsia-900",
            "from-blue-900 via-indigo-900 to-purple-900",
        };

        Assert.All(backgrounds, bg =>
        {
            var g = SlideRendererProjection.ParseGradient(bg);
            // a resolved gradient is never the all-zero default
            Assert.NotEqual(default, g.From);
        });
    }

    // ── Empty / never-blank fallback: web default: return null ──────────────────────────────────────────

    [Fact]
    public void Unknown_kind_is_marked_empty_with_a_friendly_message()
    {
        var display = Project("totally-unknown");

        Assert.True(display.IsEmpty);
        Assert.False(display.DelegatesContent);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
    }

    [Fact]
    public void Known_non_drive_highlight_kinds_delegate_their_body()
    {
        Assert.True(Project("title").DelegatesContent);
        Assert.True(Project("comparisons").DelegatesContent);
        Assert.False(Project("drive-highlight", field: "longest").DelegatesContent);
        Assert.False(Project("totally-unknown").DelegatesContent);
    }

    [Fact]
    public void Empty_message_is_always_available_as_the_no_body_fallback()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project("title").EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(Project("drive-highlight", field: "longest").EmptyMessage));
    }

    // ── Comparisons are forwarded for the ComparisonsSlide child ────────────────────────────────────────

    [Fact]
    public void Comparisons_are_forwarded_to_the_display()
    {
        var data = YearReviewSnapshot.FromJson(Json(FullYearReview));

        Assert.Equal(2, Project("comparisons", data: data).Comparisons.Count);
    }

    // ── Accessibility: every kind exposes a non-empty Narrator name ─────────────────────────────────────

    [Theory]
    [InlineData("title", null)]
    [InlineData("stat-hero", "distance")]
    [InlineData("stat-chart", null)]
    [InlineData("drive-highlight", "longest")]
    [InlineData("drive-highlight", "efficient")]
    [InlineData("charging-breakdown", null)]
    [InlineData("savings", null)]
    [InlineData("environment", null)]
    [InlineData("patterns", null)]
    [InlineData("comparisons", null)]
    [InlineData("summary", null)]
    [InlineData("totally-unknown", null)]
    public void Every_kind_exposes_a_non_empty_automation_name(string type, string? field)
    {
        var data = YearReviewSnapshot.FromJson(Json(FullYearReview));
        Assert.False(string.IsNullOrWhiteSpace(Project(type, field, data: data).AutomationName));
    }

    [Fact]
    public void DriveHighlight_automation_name_carries_the_label_and_route()
    {
        var data = YearReviewSnapshot.FromJson(Json(FullYearReview));

        var name = Project("drive-highlight", field: "longest", data: data).AutomationName;

        Assert.Contains("Longest Drive", name, StringComparison.Ordinal);
        Assert.Contains("San Jose, CA", name, StringComparison.Ordinal);
    }

    // ── i18n: every key from the web source maps to the translation.* catalog namespace ─────────────────

    [Fact]
    public void I18n_keys_match_the_web_source_under_the_translation_namespace()
    {
        Assert.Equal("translation.yearReview.longestDrive", SlideRendererProjection.LongestDriveKey);
        Assert.Equal("translation.yearReview.mostEfficient", SlideRendererProjection.MostEfficientKey);
        Assert.Equal("translation.yearReview.noData", SlideRendererProjection.NoDataKey);
        Assert.Equal("translation.yearReview.pageTitle", SlideRendererProjection.PageTitleKey);
    }

    [Fact]
    public void Emoji_constants_match_the_web_source()
    {
        Assert.Equal(MountainEmoji, SlideRendererProjection.LongestEmoji);
        Assert.Equal(HerbEmoji, SlideRendererProjection.MostEfficientEmoji);
    }

    // ── Diagnostics (P1/S11): view.opened slug=SlideRenderer, PII-safe ──────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SlideRendererDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SlideRenderer", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_and_id_are_stable()
    {
        Assert.Equal("SlideRenderer", SlideRendererRegistration.Slug);
        Assert.Equal("slide-renderer", SlideRendererRegistration.Id);
        Assert.Equal("analytics", SlideRendererRegistration.Category);
    }

    // ── Empty-message formatting carries the year (web noData "{0}") ─────────────────────────────────────

    [Fact]
    public void Empty_message_formats_with_the_snapshot_year()
    {
        var data = YearReviewSnapshot.FromJson(Json("""{ "year": 2024 }"""));

        var message = Project("totally-unknown", data: data).EmptyMessage;

        Assert.Contains(2024.ToString(CultureInfo.CurrentCulture), message, StringComparison.Ordinal);
    }
}
