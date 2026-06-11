using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.ScoreBadgeSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>ScoreBadge</c> shared surface's UI-thread-free logic — the grade resolution
/// (score → grade via the default and custom thresholds, and the pre-computed grade path), the shared A–F
/// palette colours, the no-data "—" branch (the always-rendered empty state), the parity font-size scale (the
/// web <c>text-xs</c> / <c>text-xl</c> / <c>text-3xl</c> mapping), the interpolated and overridable
/// <c>score.aria</c> accessible name, the <c>testId</c> → automation-id passthrough, the registration metadata
/// and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (<c>web/src/components/data-display/ScoreBadge.tsx</c>). The WinUI view itself (ScoreBadge.cs) is exercised by
/// the app build.
/// </summary>
public sealed class ScoreBadgeTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ScoreBadgeDisplay Project(ScoreBadgeModel model) =>
        ScoreBadgeProjection.Project(model, Localizer);

    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ScoreBadge", ScoreBadgeRegistration.Slug);

    // ── grade-driven branch (web gradeInfo(props.grade)) ─────────────────────────────────────────────────

    [Theory]
    [InlineData(ScoreGrade.APlus, "A+", "#10b981")]
    [InlineData(ScoreGrade.A, "A", "#10b981")]
    [InlineData(ScoreGrade.B, "B", "#00f0ff")]
    [InlineData(ScoreGrade.C, "C", "#f59e0b")]
    [InlineData(ScoreGrade.D, "D", "#ef4444")]
    [InlineData(ScoreGrade.F, "F", "#b91c1c")]
    [InlineData(ScoreGrade.None, "\u2014", "#6b7280")]
    public void Grade_input_resolves_label_and_palette_colour(ScoreGrade grade, string label, string colorHex)
    {
        ScoreBadgeDisplay d = Project(ScoreBadgeModel.FromGrade(grade));

        Assert.Equal(grade, d.Grade);
        Assert.Equal(label, d.Label);
        Assert.Equal(colorHex, d.ColorHex);
    }

    [Fact]
    public void Grade_input_has_score_is_true_for_a_real_grade()
    {
        Assert.True(Project(ScoreBadgeModel.FromGrade(ScoreGrade.B)).HasScore);
        Assert.False(Project(ScoreBadgeModel.FromGrade(ScoreGrade.None)).HasScore);
    }

    // ── score-driven branch with the default 0–100 thresholds (web numericToGrade) ───────────────────────

    [Theory]
    [InlineData(95, "A+", "#10b981")]
    [InlineData(90, "A+", "#10b981")]   // lower bound inclusive
    [InlineData(85, "A", "#10b981")]
    [InlineData(80, "A", "#10b981")]
    [InlineData(70, "B", "#00f0ff")]
    [InlineData(65, "B", "#00f0ff")]
    [InlineData(55, "C", "#f59e0b")]
    [InlineData(50, "C", "#f59e0b")]
    [InlineData(40, "D", "#ef4444")]
    [InlineData(35, "D", "#ef4444")]
    [InlineData(10, "F", "#b91c1c")]
    [InlineData(0, "F", "#b91c1c")]
    public void Score_input_maps_to_the_default_grade(double score, string label, string colorHex)
    {
        ScoreBadgeDisplay d = Project(ScoreBadgeModel.FromScore(score));

        Assert.Equal(label, d.Label);
        Assert.Equal(colorHex, d.ColorHex);
        Assert.True(d.HasScore);
    }

    [Fact]
    public void Negative_score_falls_through_to_F()
    {
        // Web: no threshold's `min` is <= -5 (the >= 0 floor fails), so the loop falls through to 'F'.
        ScoreBadgeDisplay d = Project(ScoreBadgeModel.FromScore(-5));

        Assert.Equal("F", d.Label);
        Assert.Equal(ScoreGrade.F, d.Grade);
    }

    // ── no-data branch (web score == null / NaN → muted "—") — the always-rendered empty state ───────────

    [Fact]
    public void Null_score_renders_the_muted_dash()
    {
        ScoreBadgeDisplay d = Project(ScoreBadgeModel.Unknown);

        Assert.False(d.HasScore);
        Assert.Equal("\u2014", d.Label);
        Assert.Equal(ScoreGrade.None, d.Grade);
        Assert.Equal("#6b7280", d.ColorHex);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Non_finite_score_renders_the_muted_dash(double score)
    {
        ScoreBadgeDisplay d = Project(ScoreBadgeModel.FromScore(score));

        Assert.False(d.HasScore);
        Assert.Equal("\u2014", d.Label);
        Assert.Equal(ScoreGrade.None, d.Grade);
    }

    // ── custom thresholds (web thresholds override, e.g. inverse Wh/km efficiency) ───────────────────────

    [Fact]
    public void Custom_thresholds_override_the_default_scale()
    {
        var thresholds = new[]
        {
            new ScoreThreshold(50, ScoreGrade.APlus),
            new ScoreThreshold(0, ScoreGrade.F),
        };

        // 60 clears the custom A+ floor (50) — under the default scale 60 would only be a 'C'.
        Assert.Equal("A+", Project(ScoreBadgeModel.FromScore(60, thresholds)).Label);
        Assert.Equal("F", Project(ScoreBadgeModel.FromScore(10, thresholds)).Label);
    }

    // ── parity font-size scale (web SIZE_CLASS text-xs / text-xl / text-3xl) ──────────────────────────────

    [Theory]
    [InlineData(ScoreBadgeSize.Sm, 12)]
    [InlineData(ScoreBadgeSize.Md, 20)]
    [InlineData(ScoreBadgeSize.Lg, 30)]
    public void Size_maps_to_the_parity_font_size(ScoreBadgeSize size, double expected)
    {
        Assert.Equal(expected, ScoreBadgeProjection.FontSizeFor(size));
        Assert.Equal(expected, Project(ScoreBadgeModel.FromScore(87, size: size)).FontSize);
    }

    [Fact]
    public void Default_size_is_md()
    {
        // The web default size is 'md'; the factory default must match.
        Assert.Equal(ScoreBadgeSize.Md, ScoreBadgeModel.FromScore(87).Size);
        Assert.Equal(20, Project(ScoreBadgeModel.FromScore(87)).FontSize);
    }

    // ── accessibility: aria-label interpolated, overridable, never leaking tokens ────────────────────────

    [Fact]
    public void Aria_interpolates_the_grade_label()
    {
        Assert.Equal("Score A+", Project(ScoreBadgeModel.FromGrade(ScoreGrade.APlus)).AutomationName);
        Assert.Equal("Score B", Project(ScoreBadgeModel.FromScore(70)).AutomationName);
    }

    [Fact]
    public void Aria_describes_the_no_data_dash()
    {
        // Web passes info.label ("—") into the template even in the no-data branch.
        Assert.Equal("Score \u2014", Project(ScoreBadgeModel.Unknown).AutomationName);
    }

    [Fact]
    public void Aria_never_leaks_the_interpolation_token()
    {
        string name = Project(ScoreBadgeModel.FromScore(87)).AutomationName;

        Assert.DoesNotContain("{{", name, System.StringComparison.Ordinal);
        Assert.DoesNotContain("}}", name, System.StringComparison.Ordinal);
    }

    [Fact]
    public void Aria_override_replaces_the_generated_name()
    {
        ScoreBadgeDisplay d = Project(ScoreBadgeModel.FromScore(87, ariaLabel: "Drive efficiency grade"));

        Assert.Equal("Drive efficiency grade", d.AutomationName);
    }

    [Fact]
    public void Aria_is_non_empty_in_every_branch()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project(ScoreBadgeModel.Unknown).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(Project(ScoreBadgeModel.FromScore(87)).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(Project(ScoreBadgeModel.FromGrade(ScoreGrade.C)).AutomationName));
    }

    // ── test hook (web testId → AutomationProperties.AutomationId) ────────────────────────────────────────

    [Fact]
    public void Test_id_is_passed_through_as_the_automation_id()
    {
        Assert.Equal("drive-score", Project(ScoreBadgeModel.FromScore(87, testId: "drive-score")).AutomationId);
        Assert.Null(Project(ScoreBadgeModel.FromScore(87)).AutomationId);
    }

    // ── diagnostics (view.opened, PII-safe — never the score or grade) ───────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ScoreBadgeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ScoreBadge", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new ScoreBadgeDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => ScoreBadgeProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => ScoreBadgeProjection.Project(ScoreBadgeModel.Unknown, null!));
}
