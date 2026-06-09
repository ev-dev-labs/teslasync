using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>CostPerKwhChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the ordinal point indexing + date passthrough, the non-finite
/// guard, the currency-formatted range summary (the spoken analogue of the web's <c>formatCurrency</c> value
/// axis), the resolved i18n labels, the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class CostPerKwhChartTests
{
    private const string EmDash = "\u2014";
    private const string EnDash = "\u2013";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static CostPerKwhPoint P(string date, double cost) => new(date, cost);

    private static CostPerKwhChartModel Loaded(params CostPerKwhPoint[] points) => new(false, points);

    private static CostPerKwhChartModel Loading(params CostPerKwhPoint[] points) => new(true, points);

    private static CostPerKwhChartDisplay Project(CostPerKwhChartModel model) =>
        CostPerKwhChartProjection.Project(model, Localizer);

    // ── Branch precedence: loading → empty → ready (web data lifecycle) ────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(CostPerKwhChartState.Loading, Project(CostPerKwhChartModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_points()
    {
        // Web gates the whole chart behind its query state, so loading wins even with points already cached.
        var display = Project(Loading(P("Jan", 0.14), P("Feb", 0.16)));

        Assert.Equal(CostPerKwhChartState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_points()
    {
        var display = Project(CostPerKwhChartModel.Empty);

        Assert.Equal(CostPerKwhChartState.Empty, display.State);
        Assert.Empty(display.Points);
    }

    [Fact]
    public void Ready_when_a_single_point_is_present()
    {
        // Web gate is `data.length > 0`, so one sample is enough to draw the line.
        var display = Project(Loaded(P("Jan", 0.15)));

        Assert.Equal(CostPerKwhChartState.Ready, display.State);
        Assert.Single(display.Points);
    }

    // ── Points: indexing, date passthrough, non-finite guard ─────────────────────────────────────────

    [Fact]
    public void Point_count_matches_input()
    {
        var display = Project(Loaded(P("Jan", 0.12), P("Feb", 0.13), P("Mar", 0.14)));

        Assert.Equal(3, display.Points.Count);
    }

    [Fact]
    public void Point_index_is_sequential_from_zero()
    {
        var display = Project(Loaded(P("Jan", 0.12), P("Feb", 0.13), P("Mar", 0.14)));

        Assert.Equal(0, display.Points[0].Index);
        Assert.Equal(1, display.Points[1].Index);
        Assert.Equal(2, display.Points[2].Index);
    }

    [Fact]
    public void Point_carries_the_date_label()
    {
        var point = Assert.Single(Project(Loaded(P("2025-03", 0.17))).Points);

        Assert.Equal("2025-03", point.DateLabel);
        Assert.Equal(0.17, point.CostPerKwh);
    }

    [Fact]
    public void Point_renders_em_dash_for_a_blank_date()
    {
        var point = Assert.Single(Project(Loaded(P("   ", 0.17))).Points);

        Assert.Equal(EmDash, point.DateLabel);
    }

    [Fact]
    public void Non_finite_cost_is_zeroed()
    {
        // A stray NaN / Infinity never reaches the chart geometry; it floors at zero.
        var display = Project(Loaded(P("Jan", double.NaN), P("Feb", double.PositiveInfinity)));

        Assert.Equal(CostPerKwhChartState.Ready, display.State);
        Assert.Equal(0.0, display.Points[0].CostPerKwh);
        Assert.Equal(0.0, display.Points[1].CostPerKwh);
    }

    // ── Range summary: the spoken currency analogue of the web formatCurrency axis ───────────────────

    [Fact]
    public void Range_summary_spans_min_to_max_in_currency()
    {
        var display = Project(Loaded(P("Jan", 0.10), P("Feb", 0.20), P("Mar", 0.15)));

        Assert.Equal($"$0.10{EnDash}$0.20", display.RangeSummary);
    }

    [Fact]
    public void Range_summary_is_a_single_value_when_every_sample_rounds_the_same()
    {
        var display = Project(Loaded(P("Jan", 0.15), P("Feb", 0.15)));

        Assert.Equal("$0.15", display.RangeSummary);
    }

    [Fact]
    public void Range_summary_is_empty_when_there_is_nothing_to_plot()
    {
        Assert.Equal(string.Empty, Project(CostPerKwhChartModel.Empty).RangeSummary);
        Assert.Equal(string.Empty, Project(CostPerKwhChartModel.Pending).RangeSummary);
    }

    [Fact]
    public void Range_summary_pads_to_two_decimals_like_format_currency()
    {
        var display = Project(Loaded(P("Jan", 0.1), P("Feb", 0.2)));

        Assert.Equal($"$0.10{EnDash}$0.20", display.RangeSummary);
    }

    // ── Resolved labels (i18n facade fallbacks mirror the web `t(...)` defaults) ──────────────────────

    [Fact]
    public void Resolves_title_and_rate_label_from_the_facade()
    {
        var display = Project(Loaded(P("Jan", 0.15)));

        Assert.Equal("Cost per kWh Trend", display.Title);
        Assert.Equal("$/kWh", display.RateLabel);
    }

    [Fact]
    public void Empty_message_uses_the_cost_analysis_no_data_string() =>
        Assert.Equal("Not enough data", Project(CostPerKwhChartModel.Empty).EmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(CostPerKwhChartModel.Pending).LoadingLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(CostPerKwhChartModel.Pending),
                Project(CostPerKwhChartModel.Empty),
                Project(Loaded(P("Jan", 0.12), P("Feb", 0.18))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_carries_the_title_and_loading_label()
    {
        var display = Project(CostPerKwhChartModel.Pending);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.LoadingLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_message()
    {
        var display = Project(CostPerKwhChartModel.Empty);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_carries_the_title_rate_and_range()
    {
        var display = Project(Loaded(P("Jan", 0.10), P("Feb", 0.20)));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.RateLabel, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.RangeSummary, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=CostPerKwhChart, PII-safe ──────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new CostPerKwhChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CostPerKwhChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_date_or_rate_data()
    {
        var captured = new List<string>();
        var diagnostics = new CostPerKwhChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=CostPerKwhChart", line);
        Assert.DoesNotContain('$', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("CostPerKwhChart", CostPerKwhChartRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => CostPerKwhChartProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => CostPerKwhChartProjection.Project(CostPerKwhChartModel.Pending, null!));
}
