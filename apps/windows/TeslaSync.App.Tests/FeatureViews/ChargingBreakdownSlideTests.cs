using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargingBreakdownSlide</c> feature surface's UI-thread-free logic — the
/// branch projection (loading / empty / ready), the web zero-share segment filter + palette-by-filtered-
/// position colouring, the <c>Math.round</c> percentage + grouped session-count formatting, the
/// <c>yearReview.avgStartSOC</c> token interpolation (web <c>{{soc}}</c> and resw <c>{0}</c> forms), the
/// accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class ChargingBreakdownSlideTests
{
    private const string PlugEmoji = "\U0001F50C";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ChargingBreakdownSlideModel Ready(
        long sessions = 100,
        double soc = 64,
        double supercharger = 60,
        double dcFast = 30,
        double acOther = 10) =>
        new(false, sessions, soc, supercharger, dcFast, acOther);

    private static ChargingBreakdownSlideDisplay Project(ChargingBreakdownSlideModel model) =>
        ChargingBreakdownSlideProjection.Project(model, Localizer);

    // ── Branch precedence: loading → empty → ready (web data lifecycle) ───────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ChargingBreakdownSlideState.Loading, Project(ChargingBreakdownSlideModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        var display = Project(new ChargingBreakdownSlideModel(true, 120, 70, 60, 30, 10));

        Assert.Equal(ChargingBreakdownSlideState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_no_charge_sessions() =>
        Assert.Equal(ChargingBreakdownSlideState.Empty, Project(ChargingBreakdownSlideModel.Empty).State);

    [Fact]
    public void Empty_when_session_count_is_zero_even_if_shares_present()
    {
        // No sessions ⇒ no charging story to break down, regardless of any stray percentages.
        var display = Project(new ChargingBreakdownSlideModel(false, 0, 50, 100, 0, 0));

        Assert.Equal(ChargingBreakdownSlideState.Empty, display.State);
    }

    [Fact]
    public void Ready_when_sessions_present()
    {
        var display = Project(Ready());

        Assert.Equal(ChargingBreakdownSlideState.Ready, display.State);
        Assert.Equal(3, display.Segments.Count);
    }

    // ── Segments: web filter(d => d.value > 0) + palette by filtered position ─────────────────────────

    [Fact]
    public void Segments_drop_zero_value_shares()
    {
        var segments = Project(Ready(supercharger: 70, dcFast: 0, acOther: 30)).Segments;

        Assert.Collection(
            segments,
            s => Assert.Equal("Supercharger", s.Name),
            s => Assert.Equal("AC / Other", s.Name));
    }

    [Fact]
    public void Segments_drop_negative_shares()
    {
        var segments = Project(Ready(supercharger: -5, dcFast: 50, acOther: 50)).Segments;

        Assert.Collection(
            segments,
            s => Assert.Equal("DC Fast", s.Name),
            s => Assert.Equal("AC / Other", s.Name));
    }

    [Fact]
    public void Segment_color_index_follows_filtered_position_not_category()
    {
        // Web parity: COLORS[i] is applied to the FILTERED array, so dropping Supercharger shifts DC Fast
        // into palette slot 0 (not its categorical slot 1).
        var segments = Project(Ready(supercharger: 0, dcFast: 70, acOther: 30)).Segments;

        Assert.Equal(("DC Fast", 0), (segments[0].Name, segments[0].ColorIndex));
        Assert.Equal(("AC / Other", 1), (segments[1].Name, segments[1].ColorIndex));
    }

    [Fact]
    public void All_present_segments_keep_their_categorical_order_and_palette()
    {
        var segments = Project(Ready(supercharger: 60, dcFast: 30, acOther: 10)).Segments;

        Assert.Equal(("Supercharger", 0), (segments[0].Name, segments[0].ColorIndex));
        Assert.Equal(("DC Fast", 1), (segments[1].Name, segments[1].ColorIndex));
        Assert.Equal(("AC / Other", 2), (segments[2].Name, segments[2].ColorIndex));
    }

    [Fact]
    public void Segment_percent_text_rounds_half_away_from_zero()
    {
        var segments = Project(Ready(supercharger: 60.5, dcFast: 30, acOther: 9.4)).Segments;

        Assert.Equal("61%", segments[0].PercentText); // 60.5 → 61
        Assert.Equal("9%", segments[2].PercentText);  // 9.4 → 9
    }

    [Fact]
    public void Segment_legend_text_matches_the_web_name_and_percent_format()
    {
        var segment = Project(Ready(supercharger: 60)).Segments[0];

        Assert.Equal("Supercharger (60%)", segment.LegendText);
    }

    [Fact]
    public void Segment_automation_name_carries_name_and_percent()
    {
        var segment = Project(Ready(supercharger: 60)).Segments[0];

        Assert.Equal("Supercharger, 60%", segment.AutomationName);
    }

    [Fact]
    public void Tiny_nonzero_share_survives_the_filter_but_rounds_to_zero_percent()
    {
        // Web filters on value > 0 (not >= 0.5), so a 0.4% share is kept and renders "(0%)".
        var segments = Project(Ready(supercharger: 0.4, dcFast: 99.6, acOther: 0)).Segments;

        Assert.Equal("Supercharger (0%)", segments[0].LegendText);
    }

    // ── Headline: "{count} charge sessions" ──────────────────────────────────────────────────────────

    [Fact]
    public void Sessions_value_groups_thousands_like_the_native_number_formatter()
    {
        var display = Project(Ready(sessions: 1234));

        Assert.Equal("1,234", display.SessionsValueText);
        Assert.Equal("1,234 charge sessions", display.SessionsLine);
    }

    [Fact]
    public void Sessions_label_resolves_from_the_facade()
    {
        Assert.Equal("charge sessions", Project(Ready()).SessionsLabel);
    }

    // ── Average start-of-charge SoC interpolation ────────────────────────────────────────────────────

    [Fact]
    public void Average_soc_fills_the_web_double_brace_token()
    {
        // Passthrough localizer returns the web fallback "Average plug-in at {{soc}}% battery".
        Assert.Equal("Average plug-in at 64% battery", Project(Ready(soc: 64)).AverageSocText);
    }

    [Fact]
    public void Average_soc_fills_the_resw_indexed_token()
    {
        // Production resolves the catalog's indexed "{0}" form — the projection must fill that too.
        var display = ChargingBreakdownSlideProjection.Project(Ready(soc: 64), new ReswLocalizer());

        Assert.Equal("Average plug-in at 64% battery", display.AverageSocText);
    }

    [Fact]
    public void Average_soc_rounds_half_away_from_zero()
    {
        Assert.Contains("64", Project(Ready(soc: 63.6)).AverageSocText, StringComparison.Ordinal);
        Assert.Contains("63", Project(Ready(soc: 63.4)).AverageSocText, StringComparison.Ordinal);
    }

    // ── Fixed copy / emoji ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Emoji_is_the_electric_plug()
    {
        Assert.Equal(PlugEmoji, Project(Ready()).Emoji);
        Assert.Equal(PlugEmoji, ChargingBreakdownSlideProjection.Emoji);
    }

    [Fact]
    public void Empty_message_uses_the_shared_chart_no_data_string()
    {
        Assert.Equal("No data available", Project(ChargingBreakdownSlideModel.Empty).EmptyMessage);
    }

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string()
    {
        Assert.Equal("Loading", Project(ChargingBreakdownSlideModel.Pending).LoadingLabel);
    }

    // ── Chart summary (donut Narrator description) ───────────────────────────────────────────────────

    [Fact]
    public void Chart_summary_lists_every_present_segment()
    {
        Assert.Equal(
            "Supercharger 60%, DC Fast 30%, AC / Other 10%",
            Project(Ready(supercharger: 60, dcFast: 30, acOther: 10)).ChartSummary);
    }

    [Fact]
    public void Chart_summary_is_empty_when_no_segments_survive_the_filter()
    {
        var display = Project(Ready(sessions: 5, supercharger: 0, dcFast: 0, acOther: 0));

        Assert.Equal(ChargingBreakdownSlideState.Ready, display.State);
        Assert.Empty(display.Segments);
        Assert.Equal(string.Empty, display.ChartSummary);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(ChargingBreakdownSlideModel.Pending),
                Project(ChargingBreakdownSlideModel.Empty),
                Project(Ready()),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label()
    {
        Assert.Equal("Loading", Project(ChargingBreakdownSlideModel.Pending).AutomationName);
    }

    [Fact]
    public void Empty_automation_name_is_the_empty_message()
    {
        Assert.Equal("No data available", Project(ChargingBreakdownSlideModel.Empty).AutomationName);
    }

    [Fact]
    public void Ready_automation_name_carries_sessions_soc_and_chart_summary()
    {
        var display = Project(Ready(sessions: 100, soc: 64, supercharger: 60, dcFast: 30, acOther: 10));

        Assert.Contains(display.SessionsLine, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.AverageSocText, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.ChartSummary, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_omits_the_summary_when_no_segments()
    {
        var display = Project(Ready(sessions: 5, supercharger: 0, dcFast: 0, acOther: 0));

        Assert.Equal($"{display.SessionsLine}. {display.AverageSocText}", display.AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=ChargingBreakdownSlide, PII-safe ───────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChargingBreakdownSlideDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingBreakdownSlide", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_charging_behaviour()
    {
        var captured = new List<string>();
        var diagnostics = new ChargingBreakdownSlideDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=ChargingBreakdownSlide", line);
        Assert.DoesNotContain('%', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ChargingBreakdownSlide", ChargingBreakdownSlideRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargingBreakdownSlideProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargingBreakdownSlideProjection.Project(ChargingBreakdownSlideModel.Pending, null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that returns the catalog's indexed <c>{0}</c> form for the SoC template
    /// (as <c>Strings/{lang}/Resources.resw</c> does in production) and the English fallback for every other
    /// key — proving the projection fills both the resw and web token shapes.
    /// </summary>
    private sealed class ReswLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) =>
            key == "yearReview.avgStartSOC" ? "Average plug-in at {0}% battery" : fallback;
    }
}
