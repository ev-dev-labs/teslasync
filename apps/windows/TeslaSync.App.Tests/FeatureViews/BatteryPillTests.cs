using TeslaSync.App.Core;
using TeslaSync.App.FeatureViews.WeeklyDigest;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>BatteryPill</c> feature surface's UI-thread-free logic — the traffic-light
/// colour-tier selection, the token-brush mapping, the <c>fmtInt</c> percentage formatting (locale grouping,
/// half-expand rounding and the web <c>safeNumber</c> non-finite guard), the clamped progress-bar fraction,
/// the composed Narrator name, the diagnostics and the registration metadata. Mirrors the web spec
/// (web/src/features/analytics/components/weekly-digest/BatteryPill.tsx). The WinUI view itself
/// (feature-views\BatteryPill\BatteryPill.cs) is exercised by the app build.
/// </summary>
public sealed class BatteryPillTests
{
    private static BatteryPillDisplay Project(double level, string label = "State of Charge") =>
        BatteryPillProjection.Project(new BatteryPillModel(level, label));

    // ── Colour tier (web `level >= 60 ? good : level >= 30 ? warning : critical`) ───────────────────

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(60, StatusKind.Success)]   // lower boundary of the good tier
    [InlineData(59.9, StatusKind.Warning)]
    [InlineData(45, StatusKind.Warning)]
    [InlineData(30, StatusKind.Warning)]   // lower boundary of the warning tier
    [InlineData(29.9, StatusKind.Danger)]
    [InlineData(0, StatusKind.Danger)]
    [InlineData(-5, StatusKind.Danger)]
    [InlineData(double.NaN, StatusKind.Danger)] // both comparisons fail, exactly like the web ternary
    public void Tier_matches_the_web_status_color_thresholds(double level, StatusKind expected)
    {
        Assert.Equal(expected, BatteryPillProjection.Tier(level));
        Assert.Equal(expected, Project(level).Tier);
    }

    [Fact]
    public void Thresholds_match_the_web_constants()
    {
        Assert.Equal(60, BatteryPillProjection.GoodThreshold);
        Assert.Equal(30, BatteryPillProjection.WarningThreshold);
    }

    // ── Token-brush mapping (STATUS_COLORS good/warning/critical → token brushes) ────────────────────

    [Theory]
    [InlineData(85, "TsColorSuccessBrush")]
    [InlineData(45, "TsColorWarningBrush")]
    [InlineData(10, "TsColorDangerBrush")]
    public void AccentBrushKey_maps_each_tier_to_its_token_brush(double level, string expectedKey)
    {
        Assert.Equal(expectedKey, Project(level).AccentBrushKey);
    }

    // ── Per-tier "snapshot": every state renders a complete, distinct display ────────────────────────

    [Fact]
    public void Good_tier_renders_a_complete_display()
    {
        var d = Project(82, "Pack");

        Assert.Equal(StatusKind.Success, d.Tier);
        Assert.Equal("TsColorSuccessBrush", d.AccentBrushKey);
        Assert.Equal("82%", d.PercentText);
        Assert.Equal("Pack", d.Label);
        Assert.Equal(0.82, d.BarFraction, 10);
        Assert.Equal("Pack: 82%", d.AutomationName);
    }

    [Fact]
    public void Warning_tier_renders_a_complete_display()
    {
        var d = Project(42, "Pack");

        Assert.Equal(StatusKind.Warning, d.Tier);
        Assert.Equal("TsColorWarningBrush", d.AccentBrushKey);
        Assert.Equal("42%", d.PercentText);
        Assert.Equal(0.42, d.BarFraction, 10);
        Assert.Equal("Pack: 42%", d.AutomationName);
    }

    [Fact]
    public void Critical_tier_renders_a_complete_display()
    {
        var d = Project(12, "Pack");

        Assert.Equal(StatusKind.Danger, d.Tier);
        Assert.Equal("TsColorDangerBrush", d.AccentBrushKey);
        Assert.Equal("12%", d.PercentText);
        Assert.Equal(0.12, d.BarFraction, 10);
        Assert.Equal("Pack: 12%", d.AutomationName);
    }

    // ── Percentage text (web `${fmtInt(level)}%`) ───────────────────────────────────────────────────

    [Theory]
    [InlineData(85, "85%")]
    [InlineData(85.4, "85%")]
    [InlineData(85.5, "86%")]   // Intl.NumberFormat halfExpand rounds .5 away from zero
    [InlineData(0, "0%")]
    [InlineData(100, "100%")]
    [InlineData(12345, "12,345%")] // fmtInt groups in threes
    [InlineData(-5, "-5%")]
    public void PercentText_matches_fmtInt(double level, string expected)
    {
        Assert.Equal(expected, BatteryPillProjection.FormatPercent(level));
        Assert.Equal(expected, Project(level).PercentText);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void PercentText_coerces_non_finite_to_zero_like_safeNumber(double level)
    {
        // Web fmtInt → fmtNumber(safeNumber(level), 0); safeNumber maps non-finite to 0.
        Assert.Equal("0%", BatteryPillProjection.FormatPercent(level));
    }

    // ── Progress-bar fraction (web `width: min(level, 100)%`) ────────────────────────────────────────

    [Theory]
    [InlineData(50, 0.5)]
    [InlineData(0, 0.0)]
    [InlineData(60, 0.6)]
    [InlineData(100, 1.0)]
    [InlineData(150, 1.0)]   // Math.min caps the fill at the full track
    [InlineData(-5, 0.0)]    // a negative CSS width is invalid → empty bar
    public void BarFraction_clamps_like_the_web_inline_width(double level, double expected)
    {
        Assert.Equal(expected, BatteryPillProjection.BarFractionOf(level), 10);
        Assert.Equal(expected, Project(level).BarFraction, 10);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void BarFraction_is_zero_for_non_finite_levels(double level)
    {
        Assert.Equal(0.0, BatteryPillProjection.BarFractionOf(level), 10);
    }

    // ── Accessibility (Narrator name) ───────────────────────────────────────────────────────────────

    [Fact]
    public void AutomationName_composes_label_and_value()
    {
        Assert.Equal("State of Charge: 73%", Project(73, "State of Charge").AutomationName);
    }

    [Fact]
    public void AutomationName_is_the_value_alone_when_unlabeled()
    {
        Assert.Equal("73%", Project(73, string.Empty).AutomationName);
    }

    // ── i18n: the surface emits no English of its own — only the prop label and the "%" unit ─────────

    [Fact]
    public void Projection_injects_no_english_only_the_prop_label_and_percent()
    {
        // A non-ASCII caption (the parent already localized it) must pass through verbatim, proving the
        // component contributes no hardcoded English. The only literal the web source renders is "%".
        const string localized = "充電レベル";
        var d = Project(64, localized);

        Assert.Equal(localized, d.Label);
        Assert.Equal("64%", d.PercentText);
        Assert.Equal($"{localized}: 64%", d.AutomationName);
        Assert.EndsWith("%", d.PercentText, StringComparison.Ordinal);
    }

    // ── Model defaults ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_model_is_an_unlabeled_zero_pill()
    {
        Assert.Equal(0, BatteryPillModel.Empty.Level);
        Assert.Equal(string.Empty, BatteryPillModel.Empty.Label);

        var d = BatteryPillProjection.Project(BatteryPillModel.Empty);
        Assert.Equal(StatusKind.Danger, d.Tier);
        Assert.Equal("0%", d.PercentText);
        Assert.Equal(0.0, d.BarFraction, 10);
        Assert.Equal("0%", d.AutomationName);
    }

    [Fact]
    public void Project_rejects_a_null_model()
    {
        Assert.Throws<ArgumentNullException>(() => BatteryPillProjection.Project(null!));
    }

    // ── Diagnostics (P1/S11): view.opened slug=BatteryPill, PII-safe ────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new BatteryPillDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryPill", captured[0]);
        Assert.Equal("view.opened slug=BatteryPill", captured[1]);
    }

    // ── Registration metadata ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_and_battery_glyph()
    {
        Assert.Equal("BatteryPill", BatteryPillRegistration.Slug);
        Assert.Equal("\uE83F", BatteryPillRegistration.BatteryGlyph);
    }
}
