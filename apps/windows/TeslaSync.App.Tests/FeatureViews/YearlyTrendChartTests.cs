using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.ChargingCurve;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>YearlyTrendChart</c> feature surface's UI-thread-free logic — the branch
/// projection (empty / ready), the composed series (the DC-session bar + the two charge-time lines, with the
/// web <c>CHART_COLORS</c> indices, the <c>" min"</c> unit and ordinal-X year labels), the raw
/// <c>String(value)</c> accessible-table formatting (no grouping, no forced decimals — web
/// <c>ChartContainer</c> parity), the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx). The WinUI view itself
/// (YearlyTrendChart.cs) is exercised by the app build.
/// </summary>
public sealed class YearlyTrendChartTests
{
    private const string Arrow = "\u2192";
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static YearlyTrendPoint Pt(
        string year = "2024",
        double avg10 = 32.5,
        double avg20 = 28.1,
        long count = 12) =>
        new(year, avg10, avg20, count);

    private static YearlyTrendChartModel Ready(params YearlyTrendPoint[] points) => new(points);

    private static YearlyTrendChartDisplay Project(YearlyTrendChartModel model) =>
        YearlyTrendChartProjection.Project(model, Localizer);

    // ── Branch selection: web `yearlyTrend.length > 0 ? chart : empty` ────────────────────────────────

    [Fact]
    public void Empty_when_no_yearly_rows()
    {
        var display = Project(YearlyTrendChartModel.Empty);

        Assert.Equal(YearlyTrendChartState.Empty, display.State);
        Assert.Empty(display.Series);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Ready_when_rows_present()
    {
        var display = Project(Ready(Pt(year: "2023"), Pt(year: "2024")));

        Assert.Equal(YearlyTrendChartState.Ready, display.State);
        Assert.Equal(3, display.Series.Count);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Ready_is_a_function_of_row_count_not_value()
    {
        // Web parity: emptiness is `yearlyTrend.length === 0`, so a single all-zero year still renders the
        // chart (with zero-height bars / flat lines) rather than collapsing to the empty state.
        var display = Project(Ready(new YearlyTrendPoint("2024", 0, 0, 0)));

        Assert.Equal(YearlyTrendChartState.Ready, display.State);
        Assert.Equal(3, display.Series.Count);
    }

    // ── Composed series: bar drawn first, then the two lines (web Bar → Line → Line) ──────────────────

    [Fact]
    public void Ready_builds_bar_then_two_lines_in_web_order()
    {
        var series = Project(Ready(Pt())).Series;

        Assert.Equal(ChartSeriesKind.Bar, series[0].Kind);
        Assert.Equal(ChartSeriesKind.Line, series[1].Kind);
        Assert.Equal(ChartSeriesKind.Line, series[2].Kind);
        Assert.Equal("DC Sessions", series[0].Name);
        Assert.Equal($"10{Arrow}80% avg", series[1].Name);
        Assert.Equal($"20{Arrow}80% avg", series[2].Name);
    }

    [Fact]
    public void Series_colors_match_web_chart_color_indices()
    {
        var series = Project(Ready(Pt())).Series;

        Assert.Equal(YearlyTrendChartProjection.CountColorIndex, series[0].ColorIndex);
        Assert.Equal(YearlyTrendChartProjection.Avg10To80ColorIndex, series[1].ColorIndex);
        Assert.Equal(YearlyTrendChartProjection.Avg20To80ColorIndex, series[2].ColorIndex);
        Assert.Equal(5, series[0].ColorIndex);
        Assert.Equal(0, series[1].ColorIndex);
        Assert.Equal(2, series[2].ColorIndex);
    }

    [Fact]
    public void Bar_series_carries_session_counts_no_unit()
    {
        var bar = Project(Ready(
            new YearlyTrendPoint("2023", 30, 25, 10),
            new YearlyTrendPoint("2024", 32.5, 28.1, 12))).Series[0];

        Assert.Equal(10, bar.Points[0].Y);
        Assert.Equal(12, bar.Points[1].Y);
        Assert.Null(bar.Unit);
        Assert.Equal(0, bar.Decimals);
    }

    [Fact]
    public void Line_series_carry_minutes_unit_and_one_decimal()
    {
        var series = Project(Ready(
            new YearlyTrendPoint("2023", 30, 25, 10),
            new YearlyTrendPoint("2024", 32.5, 28.1, 12))).Series;

        Assert.Equal("min", series[1].Unit);
        Assert.Equal("min", series[2].Unit);
        Assert.Equal(YearlyTrendChartProjection.MinutesDecimals, series[1].Decimals);
        Assert.Equal(1, series[2].Decimals);
        Assert.Equal(30, series[1].Points[0].Y);
        Assert.Equal(28.1, series[2].Points[1].Y);
    }

    [Fact]
    public void Series_points_use_ordinal_x_with_year_label()
    {
        var series = Project(Ready(Pt(year: "2022"), Pt(year: "2023"), Pt(year: "2024"))).Series;

        Assert.Collection(
            series[0].Points,
            p => Assert.Equal((0.0, "2022"), (p.X, p.Label)),
            p => Assert.Equal((1.0, "2023"), (p.X, p.Label)),
            p => Assert.Equal((2.0, "2024"), (p.X, p.Label)));
    }

    // ── Accessible-table cell formatting: web `String(raw)` (no grouping, no forced trailing decimals) ─

    [Fact]
    public void FormatMinutes_drops_trailing_zero_and_does_not_group()
    {
        Assert.Equal("32.5", YearlyTrendChartProjection.FormatMinutes(32.5));
        Assert.Equal("32", YearlyTrendChartProjection.FormatMinutes(32.0));
        Assert.Equal("0", YearlyTrendChartProjection.FormatMinutes(0.0));
        Assert.Equal("7.1", YearlyTrendChartProjection.FormatMinutes(7.1));
        Assert.Equal("1234.5", YearlyTrendChartProjection.FormatMinutes(1234.5));
    }

    [Fact]
    public void FormatMinutes_renders_em_dash_for_non_finite()
    {
        Assert.Equal(EmDash, YearlyTrendChartProjection.FormatMinutes(double.NaN));
        Assert.Equal(EmDash, YearlyTrendChartProjection.FormatMinutes(double.PositiveInfinity));
    }

    [Fact]
    public void FormatCount_is_a_plain_ungrouped_integer()
    {
        Assert.Equal("120", YearlyTrendChartProjection.FormatCount(120));
        Assert.Equal("0", YearlyTrendChartProjection.FormatCount(0));

        string big = YearlyTrendChartProjection.FormatCount(1500);
        Assert.Equal("1500", big);
        Assert.DoesNotContain(",", big, StringComparison.Ordinal);
    }

    // ── Accessible data table (web dataColumns Year / 10→80% / 20→80% / DC Sessions) ──────────────────

    [Fact]
    public void Columns_match_the_web_four_columns()
    {
        var columns = Project(Ready(Pt())).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((YearlyTrendChartProjection.YearKey, "Year"), (c.Key, c.Header)),
            c => Assert.Equal((YearlyTrendChartProjection.Avg10To80Key, $"10{Arrow}80% avg min"), (c.Key, c.Header)),
            c => Assert.Equal((YearlyTrendChartProjection.Avg20To80Key, $"20{Arrow}80% avg min"), (c.Key, c.Header)),
            c => Assert.Equal((YearlyTrendChartProjection.CountKey, "DC Sessions"), (c.Key, c.Header)));
    }

    [Fact]
    public void Row_carries_the_year_and_formatted_cells()
    {
        var row = Assert.Single(Project(Ready(new YearlyTrendPoint("2024", 32.5, 28.0, 12))).Rows);

        Assert.Equal("2024", row.Cells[YearlyTrendChartProjection.YearKey]);
        Assert.Equal("32.5", row.Cells[YearlyTrendChartProjection.Avg10To80Key]);
        Assert.Equal("28", row.Cells[YearlyTrendChartProjection.Avg20To80Key]);
        Assert.Equal("12", row.Cells[YearlyTrendChartProjection.CountKey]);
    }

    [Fact]
    public void Rows_have_stable_unique_keys()
    {
        var rows = Project(Ready(Pt(year: "2022"), Pt(year: "2023"), Pt(year: "2024"))).Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(rows.Count, rows.Select(r => r.RowKey).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Empty_state_has_no_rows()
    {
        Assert.Empty(Project(YearlyTrendChartModel.Empty).Rows);
    }

    [Fact]
    public void Table_label_interpolates_the_title()
    {
        Assert.Equal("Yearly Charging Speed Trend \u2014 data table", Project(Ready(Pt())).TableLabel);
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_subtitle_and_aria_label_from_the_facade()
    {
        var display = Project(Ready(Pt()));

        Assert.Equal("Yearly Charging Speed Trend", display.Title);
        Assert.Equal("Average time-to-charge and session count by year", display.Subtitle);
        Assert.Equal("Yearly average charge-time and session-count composed chart", display.AriaLabel);
    }

    [Fact]
    public void Resolves_both_dual_axis_labels_from_the_facade()
    {
        var display = Project(Ready(Pt()));

        Assert.Equal("Minutes", display.MinutesAxisLabel);
        Assert.Equal("Sessions", display.SessionsAxisLabel);
    }

    [Fact]
    public void Empty_message_uses_the_shared_common_no_data_string()
    {
        Assert.Equal("No data available", Project(YearlyTrendChartModel.Empty).EmptyMessage);
    }

    // ── Accessibility: every state exposes a non-empty Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(YearlyTrendChartModel.Empty),
                Project(Ready(Pt())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_aria_label()
    {
        var display = Project(Ready(Pt()));

        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(YearlyTrendChartModel.Empty);

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_row_exposes_a_descriptive_automation_name()
    {
        var row = Assert.Single(Project(Ready(new YearlyTrendPoint("2024", 32.5, 28.1, 12))).Rows);

        Assert.Contains("2024", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("32.5", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("DC Sessions", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("12", row.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=YearlyTrendChart, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new YearlyTrendChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=YearlyTrendChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_year_or_count_data()
    {
        var captured = new List<string>();
        var diagnostics = new YearlyTrendChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("2024", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=YearlyTrendChart", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("YearlyTrendChart", YearlyTrendChartRegistration.Slug);
    }
}
