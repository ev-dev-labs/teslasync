using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.DriveScoreSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>DriveScore</c> shared surface's UI-thread-free logic — the
/// <c>computeDriveScore</c> port (the SI fallbacks, the four weighted components and the JS half-up rounding), the
/// <c>getScoreColor</c> threshold ladder, the i18n keys / fallbacks, the projected breakdown rows (label, value,
/// max, palette colour, bar fraction, visible figure and accessible name), the gauge sweep fraction and accessible
/// name, the registration metadata and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (<c>web/src/components/data-display/DriveScore.tsx</c>); the expected score vectors were cross-checked against
/// a faithful JavaScript replica of <c>computeDriveScore</c>. The WinUI view itself (DriveScore.cs) is exercised
/// by the app build.
/// </summary>
public sealed class DriveScoreTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static DriveScoreDisplay Project(DriveScoreModel model) =>
        DriveScoreProjection.Project(model, Localizer);

    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("DriveScore", DriveScoreRegistration.Slug);

    // ── i18n keys + fallbacks match the web source exactly ───────────────────────────────────────────────

    [Fact]
    public void I18n_keys_match_the_web_source()
    {
        Assert.Equal("driveScore.title", DriveScoreProjection.TitleKey);
        Assert.Equal("driveScore.score", DriveScoreProjection.ScoreKey);
        Assert.Equal("driveScore.efficiency", DriveScoreProjection.EfficiencyKey);
        Assert.Equal("driveScore.speedDiscipline", DriveScoreProjection.SpeedDisciplineKey);
        Assert.Equal("driveScore.rangePreservation", DriveScoreProjection.RangePreservationKey);
        Assert.Equal("driveScore.tripLength", DriveScoreProjection.TripLengthKey);
    }

    [Fact]
    public void I18n_fallbacks_match_the_web_defaults()
    {
        Assert.Equal("Drive Score", DriveScoreProjection.TitleFallback);
        Assert.Equal("Score", DriveScoreProjection.ScoreFallback);
        Assert.Equal("Efficiency", DriveScoreProjection.EfficiencyFallback);
        Assert.Equal("Speed Discipline", DriveScoreProjection.SpeedDisciplineFallback);
        Assert.Equal("Range Preservation", DriveScoreProjection.RangePreservationFallback);
        Assert.Equal("Trip Length", DriveScoreProjection.TripLengthFallback);
    }

    // ── computeDriveScore port (vectors cross-checked against the JS replica) ─────────────────────────────

    [Theory]
    [InlineData(50000, 3600, 30, 80, 70, 87, 40, 9, 18, 20)]   // a clean, efficient 50 km drive
    [InlineData(30000, 1800, 25, 60, 50, 53, 13, 13, 15, 12)]  // a middling 30 km drive
    [InlineData(5000, 600, 40, 50, 40, 6, 0, 4, 0, 2)]         // a short, wasteful 5 km drive
    [InlineData(60000, 3600, 16.7, 90, 81, 89, 30, 20, 19, 20)] // a long, smooth, optimal drive
    public void Compute_reproduces_the_web_score(
        double distanceM,
        double durationS,
        double maxSpeedMps,
        double startPct,
        double endPct,
        int total,
        int efficiency,
        int speed,
        int range,
        int trip)
    {
        DriveScoreBreakdown b = DriveScoreProjection.Compute(
            DriveScoreModel.FromDrive(distanceM, durationS, maxSpeedMps, startPct, endPct));

        Assert.Equal(total, b.Total);
        Assert.Equal(efficiency, b.Efficiency);
        Assert.Equal(speed, b.Speed);
        Assert.Equal(range, b.Range);
        Assert.Equal(trip, b.Trip);
    }

    [Fact]
    public void Compute_scores_the_all_defaults_drive()
    {
        // Web computeDriveScore({}) — every field falls back (distance/duration 0, battery 100 → 100).
        DriveScoreBreakdown b = DriveScoreProjection.Compute(DriveScoreModel.Unknown);

        Assert.Equal(23, b.Total);
        Assert.Equal(13, b.Efficiency);
        Assert.Equal(10, b.Speed);
        Assert.Equal(0, b.Range);
        Assert.Equal(0, b.Trip);
    }

    [Fact]
    public void Compute_clamps_each_component_to_its_ceiling()
    {
        DriveScoreBreakdown b = DriveScoreProjection.Compute(
            DriveScoreModel.FromDrive(50000, 3600, 30, 80, 70));

        Assert.InRange(b.Total, 0, 100);
        Assert.InRange(b.Efficiency, 0, DriveScoreProjection.EfficiencyMax);
        Assert.InRange(b.Speed, 0, DriveScoreProjection.SpeedMax);
        Assert.InRange(b.Range, 0, DriveScoreProjection.RangeMax);
        Assert.InRange(b.Trip, 0, DriveScoreProjection.TripMax);
    }

    [Fact]
    public void Component_maxima_match_the_web_weights()
    {
        Assert.Equal(40, DriveScoreProjection.EfficiencyMax);
        Assert.Equal(20, DriveScoreProjection.SpeedMax);
        Assert.Equal(20, DriveScoreProjection.RangeMax);
        Assert.Equal(20, DriveScoreProjection.TripMax);
    }

    // ── getScoreColor threshold ladder ───────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "#ef4444")]
    [InlineData(39, "#ef4444")]
    [InlineData(40, "#f59e0b")]   // lower warn bound inclusive
    [InlineData(53, "#f59e0b")]
    [InlineData(69, "#f59e0b")]
    [InlineData(70, "#10b981")]   // lower good bound inclusive
    [InlineData(87, "#10b981")]
    [InlineData(100, "#10b981")]
    public void Score_colour_follows_the_web_thresholds(int total, string expectedHex) =>
        Assert.Equal(expectedHex, DriveScoreProjection.ScoreColorHex(total));

    // ── projection: title, caption, gauge ────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_resolves_the_localized_title_and_caption()
    {
        DriveScoreDisplay d = Project(DriveScoreModel.FromDrive(50000, 3600, 30, 80, 70));

        Assert.Equal("Drive Score", d.Title);
        Assert.Equal("Score", d.ScoreCaption);
    }

    [Fact]
    public void Project_exposes_the_total_and_its_text()
    {
        DriveScoreDisplay d = Project(DriveScoreModel.FromDrive(50000, 3600, 30, 80, 70));

        Assert.Equal(87, d.Total);
        Assert.Equal("87", d.TotalText);
        Assert.Equal("#10b981", d.ScoreColorHex);
    }

    [Fact]
    public void Project_gauge_fraction_is_total_over_one_hundred()
    {
        Assert.Equal(0.87, Project(DriveScoreModel.FromDrive(50000, 3600, 30, 80, 70)).GaugeFraction, 6);
        Assert.Equal(0.23, Project(DriveScoreModel.Unknown).GaugeFraction, 6);
    }

    [Fact]
    public void Project_gauge_accessible_name_composes_caption_and_total()
    {
        Assert.Equal("Score 87", Project(DriveScoreModel.FromDrive(50000, 3600, 30, 80, 70)).GaugeAccessibleName);
        Assert.Equal("Score 23", Project(DriveScoreModel.Unknown).GaugeAccessibleName);
    }

    // ── projection: breakdown rows (label, value, max, palette colour, fraction, figure, a11y) ────────────

    [Fact]
    public void Project_builds_the_four_breakdown_rows_in_web_order()
    {
        DriveScoreDisplay d = Project(DriveScoreModel.FromDrive(50000, 3600, 30, 80, 70));

        Assert.Equal(4, d.Components.Count);
        Assert.Collection(
            d.Components,
            c => AssertComponent(c, "Efficiency", 40, 40, "#00f0ff", 1.0, "40/40", "Efficiency 40 / 40"),
            c => AssertComponent(c, "Speed Discipline", 9, 20, "#a855f7", 0.45, "9/20", "Speed Discipline 9 / 20"),
            c => AssertComponent(c, "Range Preservation", 18, 20, "#10b981", 0.9, "18/20", "Range Preservation 18 / 20"),
            c => AssertComponent(c, "Trip Length", 20, 20, "#f59e0b", 1.0, "20/20", "Trip Length 20 / 20"));
    }

    [Fact]
    public void Project_breakdown_palette_matches_the_web_colours()
    {
        Assert.Equal("#00f0ff", DriveScoreProjection.EfficiencyColorHex);
        Assert.Equal("#a855f7", DriveScoreProjection.SpeedColorHex);
        Assert.Equal("#10b981", DriveScoreProjection.RangeColorHex);
        Assert.Equal("#f59e0b", DriveScoreProjection.TripColorHex);
    }

    [Fact]
    public void Project_breakdown_fraction_is_zero_for_a_zero_component()
    {
        // The short wasteful drive scores 0 on efficiency and range.
        DriveScoreDisplay d = Project(DriveScoreModel.FromDrive(5000, 600, 40, 50, 40));

        Assert.Equal(0.0, d.Components[0].Fraction, 6);   // efficiency 0/40
        Assert.Equal("0/40", d.Components[0].ValueText);
        Assert.Equal(0.0, d.Components[2].Fraction, 6);   // range 0/20
    }

    // ── model factory + value equality ───────────────────────────────────────────────────────────────────

    [Fact]
    public void From_drive_factory_equals_the_positional_record()
    {
        Assert.Equal(
            new DriveScoreModel(50000, 3600, 30, 80, 70),
            DriveScoreModel.FromDrive(50000, 3600, 30, 80, 70));
    }

    [Fact]
    public void Unknown_model_has_every_field_absent()
    {
        Assert.Null(DriveScoreModel.Unknown.DistanceM);
        Assert.Null(DriveScoreModel.Unknown.DurationS);
        Assert.Null(DriveScoreModel.Unknown.MaxSpeedMps);
        Assert.Null(DriveScoreModel.Unknown.StartBatteryPct);
        Assert.Null(DriveScoreModel.Unknown.EndBatteryPct);
    }

    [Fact]
    public void Max_speed_falls_back_to_the_average_speed()
    {
        // With max speed absent the web uses the average, so the speed ratio is exactly 1 → full 20 points.
        DriveScoreBreakdown b = DriveScoreProjection.Compute(
            DriveScoreModel.FromDrive(50000, 3600, null, 80, 70));

        Assert.Equal(DriveScoreProjection.SpeedMax, b.Speed);
    }

    // ── pure helpers (clamp + JS half-up rounding) ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(5, 0, 40, 5)]
    [InlineData(50, 0, 40, 40)]
    [InlineData(-3, 0, 40, 0)]
    public void Clamp_constrains_to_the_inclusive_bounds(double value, double min, double max, double expected) =>
        Assert.Equal(expected, DriveScoreProjection.Clamp(value, min, max), 6);

    [Theory]
    [InlineData(12.5, 13)]   // JS Math.round rounds the midpoint up
    [InlineData(12.4, 12)]
    [InlineData(0.5, 1)]
    [InlineData(0, 0)]
    [InlineData(19.96, 20)]
    public void Round_half_up_matches_javascript_math_round(double value, int expected) =>
        Assert.Equal(expected, DriveScoreProjection.RoundHalfUp(value));

    // ── diagnostics (view.opened, PII-safe — never the drive inputs or score) ────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DriveScoreDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveScore", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new DriveScoreDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Compute_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => DriveScoreProjection.Compute(null!));

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => DriveScoreProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => DriveScoreProjection.Project(DriveScoreModel.Unknown, null!));

    private static void AssertComponent(
        DriveScoreComponent component,
        string label,
        int value,
        int max,
        string colorHex,
        double fraction,
        string valueText,
        string accessibleName)
    {
        Assert.Equal(label, component.Label);
        Assert.Equal(value, component.Value);
        Assert.Equal(max, component.Max);
        Assert.Equal(colorHex, component.ColorHex);
        Assert.Equal(fraction, component.Fraction, 6);
        Assert.Equal(valueText, component.ValueText);
        Assert.Equal(accessibleName, component.AccessibleName);
    }
}
