using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>EnvironmentSlide</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the SI offset formatter (the web <c>AnimatedNumber</c>'s
/// <c>fmtNumber(_, 0)</c> + literal " kg" suffix), the tree-count maths (web
/// <c>Math.round(co2_offset_kg / 21)</c> capped at 30 icons), the <c>{0}</c>-interpolated "Like planting N
/// trees" caption, the "+N more" overflow, the accessible names and the <c>view.opened</c> diagnostics.
/// Mirrors the web spec (web/src/features/analytics/components/review/EnvironmentSlide.tsx). The WinUI view
/// itself (EnvironmentSlide.cs) is exercised by the app build.
/// </summary>
public sealed class EnvironmentSlideTests
{
    private const string Co2Label = "CO\u2082 offset";
    private const string Suffix = " kg";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static EnvironmentSlideDisplay Project(EnvironmentSlideModel model) =>
        EnvironmentSlideProjection.Project(model, Localizer);

    private static EnvironmentSlideDisplay Ready(double co2) =>
        Project(EnvironmentSlideModel.Resolved(co2));

    // ── Branch precedence: loading → empty → ready (web parent contract) ──────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading()
    {
        Assert.Equal(EnvironmentSlideState.Loading, Project(new EnvironmentSlideModel(true, null)).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_a_present_value()
    {
        Assert.Equal(EnvironmentSlideState.Loading, Project(new EnvironmentSlideModel(true, 500)).State);
    }

    [Fact]
    public void Pending_model_is_loading()
    {
        Assert.Equal(EnvironmentSlideState.Loading, Project(EnvironmentSlideModel.Pending).State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_value()
    {
        var display = Project(EnvironmentSlideModel.Empty);

        Assert.Equal(EnvironmentSlideState.Empty, display.State);
        Assert.Equal(0, display.TreeCount);
        Assert.False(display.HasOverflow);
    }

    [Fact]
    public void Ready_when_value_present()
    {
        Assert.Equal(EnvironmentSlideState.Ready, Ready(420).State);
    }

    [Fact]
    public void Ready_when_value_is_zero()
    {
        // The web always renders the composition for a numeric co2_offset_kg, including 0.
        var display = Ready(0);

        Assert.Equal(EnvironmentSlideState.Ready, display.State);
        Assert.Equal("0", display.Co2ValueText);
        Assert.Equal("0 kg", display.Co2DisplayText);
        Assert.Equal(0, display.TreeCount);
        Assert.False(display.HasOverflow);
        Assert.Equal("Like planting 0 trees", display.TreesEquivText);
    }

    // ── Offset value: web fmtNumber(co2, 0) (grouped) + literal " kg" suffix ───────────────────────────

    [Fact]
    public void Offset_value_is_grouped_with_zero_fraction_digits()
    {
        var display = Ready(21000);

        Assert.Equal("21,000", display.Co2ValueText);
        Assert.Equal(Suffix, display.Co2Suffix);
        Assert.Equal("21,000 kg", display.Co2DisplayText);
        Assert.Equal(21000, display.Co2Value);
    }

    [Fact]
    public void Offset_value_rounds_half_away_from_zero()
    {
        // NumberFormatting halfExpand: 1234.5 → 1,235 (matches the web Intl.NumberFormat contract).
        Assert.Equal("1,235 kg", Ready(1234.5).Co2DisplayText);
    }

    [Fact]
    public void Non_finite_value_is_coerced_to_zero()
    {
        Assert.Equal("0 kg", Ready(double.NaN).Co2DisplayText);
        Assert.Equal("0 kg", Ready(double.PositiveInfinity).Co2DisplayText);
        Assert.Equal(0, Ready(double.NaN).TreeCount);
    }

    // ── Tree count: web Math.round(co2 / 21) ──────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, 0)]      // round(0/21) = 0
    [InlineData(10, 0)]     // round(0.476) = 0
    [InlineData(21, 1)]     // round(1.0) = 1
    [InlineData(31.5, 2)]   // round(1.5) = 2 (half rounds up, like JS Math.round)
    [InlineData(210, 10)]   // round(10.0) = 10
    public void Tree_count_mirrors_the_web_round_of_co2_over_21(double co2, int expectedIcons)
    {
        Assert.Equal(expectedIcons, Ready(co2).TreeCount);
    }

    [Fact]
    public void Tree_icons_cap_at_thirty_without_overflow_at_the_boundary()
    {
        // 630 / 21 = 30 exactly — capped at 30 icons, but no "+N more" (web `treesPlanted > 30`).
        var display = Ready(630);

        Assert.Equal(30, display.TreeCount);
        Assert.False(display.HasOverflow);
        Assert.Equal(string.Empty, display.OverflowText);
        Assert.Equal("Like planting 30 trees", display.TreesEquivText);
    }

    [Fact]
    public void Tree_icons_cap_at_thirty_with_overflow_beyond_the_cap()
    {
        // 1239 / 21 = 59 → 30 icons shown, "+29 more", caption keeps the full count.
        var display = Ready(1239);

        Assert.Equal(30, display.TreeCount);
        Assert.True(display.HasOverflow);
        Assert.Equal("+29 more", display.OverflowText);
        Assert.Equal("Like planting 59 trees", display.TreesEquivText);
    }

    [Fact]
    public void Tree_caption_count_is_ungrouped_even_when_large()
    {
        // web {{count}} renders the raw number (no grouping), unlike the grouped hero value.
        var display = Ready(21000);

        Assert.Equal("Like planting 1000 trees", display.TreesEquivText);
        Assert.Equal("+970 more", display.OverflowText);
    }

    // ── i18n: every label resolves through the facade with the web keys ────────────────────────────────

    [Fact]
    public void Labels_resolve_from_the_facade()
    {
        var display = Ready(420);

        Assert.Equal(Co2Label, display.Co2Label);
        Assert.Equal(Co2Label, display.SurfaceName);
    }

    [Fact]
    public void Chrome_messages_resolve_from_the_facade()
    {
        Assert.Equal("Loading...", Project(EnvironmentSlideModel.Pending).LoadingLabel);
        Assert.Equal("No data available", Project(EnvironmentSlideModel.Empty).EmptyMessage);
    }

    // ── Accessibility: every branch carries a composed Narrator name ───────────────────────────────────

    [Fact]
    public void Ready_automation_name_summarizes_the_offset_and_trees()
    {
        Assert.Equal("CO\u2082 offset: 1,239 kg. Like planting 59 trees", Ready(1239).AutomationName);
    }

    [Fact]
    public void Loading_automation_name_pairs_the_label_with_the_loading_text()
    {
        Assert.Equal("CO\u2082 offset. Loading...", Project(EnvironmentSlideModel.Pending).AutomationName);
    }

    [Fact]
    public void Empty_automation_name_is_the_empty_message()
    {
        Assert.Equal("No data available", Project(EnvironmentSlideModel.Empty).AutomationName);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project(EnvironmentSlideModel.Pending).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(Project(EnvironmentSlideModel.Empty).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(Ready(420).AutomationName));
    }

    // ── Diagnostics: PII-safe view.opened only ─────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_view_opened_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EnvironmentSlideDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnvironmentSlide", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_count_multiple_opens()
    {
        var diagnostics = new EnvironmentSlideDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── Registration metadata ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_and_glyphs()
    {
        Assert.Equal("EnvironmentSlide", EnvironmentSlideRegistration.Slug);
        Assert.Equal("\U0001F30D", EnvironmentSlideRegistration.GlobeGlyph);
        Assert.Equal("\U0001F333", EnvironmentSlideRegistration.TreeGlyph);
    }
}
