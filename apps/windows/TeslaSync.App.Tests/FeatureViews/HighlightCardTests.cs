using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>HighlightCard</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the web <c>glowMap</c> colour→glow mapping, the success/danger change
/// tone, the verbatim value / change / subtitle passthrough, the accessible names, and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/weekly-digest/HighlightCard.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class HighlightCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static HighlightCardModel Ready(
        string label = "Distance",
        string value = "1,234 mi",
        string? icon = "\uE945",
        string? change = null,
        bool positive = true,
        string? subtitle = null,
        HighlightColor color = HighlightColor.Cyan) =>
        new(false, icon, label, value, change, positive, subtitle, color);

    private static HighlightCardDisplay Project(HighlightCardModel model) =>
        HighlightCardProjection.Project(model, Localizer);

    // ── Branch precedence: loading → empty → ready ──────────────────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(HighlightCardState.Loading, Project(HighlightCardModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_a_present_value()
    {
        var display = Project(new HighlightCardModel(
            true, null, "Distance", "1,234 mi", "+12%", true, "vs last week", HighlightColor.Green));

        Assert.Equal(HighlightCardState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_value_is_blank() =>
        Assert.Equal(HighlightCardState.Empty, Project(HighlightCardModel.Blank).State);

    [Fact]
    public void Empty_when_value_is_whitespace() =>
        Assert.Equal(HighlightCardState.Empty, Project(Ready(value: "   ")).State);

    [Fact]
    public void Ready_when_value_is_present()
    {
        var display = Project(Ready());

        Assert.Equal(HighlightCardState.Ready, display.State);
        Assert.Equal("1,234 mi", display.Value);
    }

    // ── Glow: the web glowMap (cyan/green/purple keep glow; amber/red → none) ────────────────────────────

    [Theory]
    [InlineData(HighlightColor.Cyan, HighlightGlow.Cyan)]
    [InlineData(HighlightColor.Green, HighlightGlow.Green)]
    [InlineData(HighlightColor.Purple, HighlightGlow.Purple)]
    [InlineData(HighlightColor.Amber, HighlightGlow.None)]
    [InlineData(HighlightColor.Red, HighlightGlow.None)]
    public void Glow_follows_the_web_glow_map(HighlightColor color, HighlightGlow expected)
    {
        Assert.Equal(expected, HighlightCardProjection.GlowFor(color));
        Assert.Equal(expected, Project(Ready(color: color)).Glow);
    }

    [Fact]
    public void Glow_is_resolved_in_every_state()
    {
        Assert.Equal(HighlightGlow.Purple, Project(Ready(value: string.Empty, color: HighlightColor.Purple)).Glow);
        Assert.Equal(
            HighlightGlow.Green,
            Project(new HighlightCardModel(true, null, "L", "V", null, true, null, HighlightColor.Green)).Glow);
    }

    // ── Label + icon ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Label_is_passed_through_verbatim() =>
        Assert.Equal("Total Distance", Project(Ready(label: "Total Distance")).Label);

    [Fact]
    public void HasLabel_is_false_for_a_blank_label() =>
        Assert.False(Project(Ready(label: "  ")).HasLabel);

    [Fact]
    public void Icon_glyph_is_passed_through() =>
        Assert.Equal("\uE945", Project(Ready(icon: "\uE945")).IconGlyph);

    [Fact]
    public void Icon_glyph_is_null_when_absent()
    {
        Assert.Null(Project(Ready(icon: null)).IconGlyph);
        Assert.Null(Project(Ready(icon: string.Empty)).IconGlyph);
    }

    // ── Value ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Value_is_rendered_verbatim_without_reformatting() =>
        Assert.Equal("3.4 kWh/100km", Project(Ready(value: "3.4 kWh/100km")).Value);

    [Fact]
    public void Empty_value_text_is_an_em_dash()
    {
        Assert.Equal("\u2014", Project(HighlightCardModel.Blank).EmptyValueText);
        Assert.Equal("\u2014", HighlightCardProjection.EmDash);
    }

    // ── Change: web change.positive → emerald-400 / red-400, value verbatim ──────────────────────────────

    [Fact]
    public void Change_is_absent_when_not_supplied()
    {
        var display = Project(Ready(change: null));

        Assert.False(display.HasChange);
        Assert.Equal(string.Empty, display.ChangeText);
    }

    [Fact]
    public void Change_is_absent_when_blank() =>
        Assert.False(Project(Ready(change: "   ")).HasChange);

    [Fact]
    public void Change_text_is_rendered_verbatim()
    {
        var display = Project(Ready(change: "+12.5%"));

        Assert.True(display.HasChange);
        Assert.Equal("+12.5%", display.ChangeText);
    }

    [Fact]
    public void Positive_change_tints_success()
    {
        var display = Project(Ready(change: "+12%", positive: true));

        Assert.True(display.ChangePositive);
        Assert.Equal("TsColorSuccessBrush", display.ChangeAccentKey);
    }

    [Fact]
    public void Negative_change_tints_danger()
    {
        var display = Project(Ready(change: "-8%", positive: false));

        Assert.False(display.ChangePositive);
        Assert.Equal("TsColorDangerBrush", display.ChangeAccentKey);
    }

    // ── Subtitle ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Subtitle_is_passed_through_when_present()
    {
        var display = Project(Ready(subtitle: "vs last week"));

        Assert.True(display.HasSubtitle);
        Assert.Equal("vs last week", display.Subtitle);
    }

    [Fact]
    public void Subtitle_is_absent_when_blank()
    {
        Assert.False(Project(Ready(subtitle: null)).HasSubtitle);
        Assert.False(Project(Ready(subtitle: "   ")).HasSubtitle);
    }

    // ── Shared loading / empty copy ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_message_uses_the_shared_chart_no_data_string() =>
        Assert.Equal("No data available", Project(HighlightCardModel.Blank).EmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(HighlightCardModel.Pending).LoadingLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ─────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(HighlightCardModel.Pending),
                Project(HighlightCardModel.Blank),
                Project(Ready(change: "+12%", subtitle: "vs last week")),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(HighlightCardModel.Pending).AutomationName);

    [Fact]
    public void Empty_automation_name_carries_the_label_and_empty_message() =>
        Assert.Equal("Distance. No data available", Project(Ready(value: string.Empty, label: "Distance")).AutomationName);

    [Fact]
    public void Empty_automation_name_is_just_the_empty_message_without_a_label() =>
        Assert.Equal("No data available", Project(HighlightCardModel.Blank).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_label_value_change_and_subtitle()
    {
        var display = Project(Ready(label: "Distance", value: "1,234 mi", change: "+12%", subtitle: "vs last week"));

        Assert.Equal("Distance. 1,234 mi. +12%. vs last week", display.AutomationName);
    }

    [Fact]
    public void Ready_automation_name_omits_optional_parts_when_absent()
    {
        var display = Project(Ready(label: "Distance", value: "1,234 mi", change: null, subtitle: null));

        Assert.Equal("Distance. 1,234 mi", display.AutomationName);
    }

    [Fact]
    public void Ready_automation_name_is_just_the_value_without_a_label()
    {
        var display = Project(Ready(label: string.Empty, value: "1,234 mi", change: null, subtitle: null));

        Assert.Equal("1,234 mi", display.AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=HighlightCard, PII-safe ───────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new HighlightCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HighlightCard", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_card_content()
    {
        var captured = new List<string>();
        var diagnostics = new HighlightCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=HighlightCard", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("mi", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("HighlightCard", HighlightCardRegistration.Slug);

    [Fact]
    public void Registration_exposes_distinct_trend_glyphs() =>
        Assert.NotEqual(HighlightCardRegistration.TrendingUpGlyph, HighlightCardRegistration.TrendingDownGlyph);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => HighlightCardProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => HighlightCardProjection.Project(HighlightCardModel.Pending, null!));
}
