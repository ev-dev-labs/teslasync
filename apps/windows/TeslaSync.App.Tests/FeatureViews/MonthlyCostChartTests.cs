using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MonthlyCostChart</c> feature surface's UI-thread-free logic — the branch
/// projection (empty / ready), the single cost area series (the web <c>palette[0]</c> index and the categorical
/// ordinal-X MM/YY month labels), the raw <c>String(value)</c> accessible-table formatting (the month verbatim
/// and the cost with no grouping / no forced decimals — web <c>ChartContainer</c> parity), the
/// <c>formatCurrency(v, 0)</c> currency summary (the spoken analogue of the web currency Y-axis), the
/// container-supplied annotation reference lines, the accessible names, and the PII-safe diagnostics. Mirrors
/// the web spec (web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx). The WinUI view itself
/// (MonthlyCostChart.cs) is exercised by the app build.
/// </summary>
public sealed class MonthlyCostChartTests
{
    private const string EnDash = "\u2013";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static MonthlyCostPoint Pt(string month = "2024-01", double cost = 120.5) => new(month, cost);

    private static MonthlyCostChartModel Ready(params MonthlyCostPoint[] points) => new(points);

    private static MonthlyCostChartDisplay Project(MonthlyCostChartModel model) =>
        MonthlyCostChartProjection.Project(model, Localizer);

    // ── Branch selection: web `data.length > 0 ? <AreaChart> : "Not enough data"` ─────────────────────

    [Fact]
    public void Empty_when_no_monthly_rows()
    {
        var display = Project(MonthlyCostChartModel.Empty);

        Assert.Equal(MonthlyCostChartState.Empty, display.State);
        Assert.Empty(display.Series);
        Assert.Empty(display.Rows);
        Assert.Empty(display.Annotations);
    }

    [Fact]
    public void Ready_when_rows_present()
    {
        var display = Project(Ready(Pt("2024-01"), Pt("2024-02")));

        Assert.Equal(MonthlyCostChartState.Ready, display.State);
        var series = Assert.Single(display.Series);
        Assert.Equal(2, series.Points.Count);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Ready_is_a_function_of_row_count_not_value()
    {
        // Web parity: emptiness is `data.length === 0`, so a single all-zero month still renders the chart
        // (a flat zero-height area) rather than collapsing to the empty state.
        var display = Project(Ready(new MonthlyCostPoint("2024-01", 0)));

        Assert.Equal(MonthlyCostChartState.Ready, display.State);
        Assert.Single(display.Series);
    }

    // ── Cost series: single area on web palette[0] (web <Area dataKey="cost" stroke={palette[0]}>) ─────

    [Fact]
    public void Ready_builds_a_single_cost_area_on_palette_index_zero()
    {
        var series = Assert.Single(Project(Ready(Pt())).Series);

        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(MonthlyCostChartProjection.CostColorIndex, series.ColorIndex);
        Assert.Equal(0, series.ColorIndex);
        Assert.Equal("Cost ($)", series.Name);
    }

    [Fact]
    public void Series_points_use_ordinal_x_with_mm_yy_labels()
    {
        var series = Assert.Single(Project(Ready(
            new MonthlyCostPoint("2024-01", 80),
            new MonthlyCostPoint("2024-02", 140),
            new MonthlyCostPoint("2025-03", 95))).Series);

        Assert.Collection(
            series.Points,
            p => Assert.Equal((0.0, 80.0, "01/24"), (p.X, p.Y, p.Label)),
            p => Assert.Equal((1.0, 140.0, "02/24"), (p.X, p.Y, p.Label)),
            p => Assert.Equal((2.0, 95.0, "03/25"), (p.X, p.Y, p.Label)));
    }

    [Fact]
    public void Series_carries_cent_precision_for_the_tooltip()
    {
        var series = Assert.Single(Project(Ready(Pt())).Series);

        Assert.Equal(MonthlyCostChartProjection.CostTooltipDecimals, series.Decimals);
        Assert.Equal(2, series.Decimals);
        Assert.Null(series.Unit);
    }

    [Fact]
    public void Series_sanitizes_non_finite_costs_to_zero()
    {
        var series = Assert.Single(Project(Ready(new MonthlyCostPoint("2024-01", double.NaN))).Series);

        Assert.Equal(0, series.Points[0].Y);
    }

    // ── X-axis tick formatter: web `${parts[1]}/${parts[0].slice(2)}` ─────────────────────────────────

    [Fact]
    public void FormatMonthAxis_reduces_year_month_to_mm_yy()
    {
        Assert.Equal("01/24", MonthlyCostChartProjection.FormatMonthAxis("2024-01"));
        Assert.Equal("12/99", MonthlyCostChartProjection.FormatMonthAxis("1999-12"));
    }

    [Fact]
    public void FormatMonthAxis_returns_non_two_part_values_verbatim()
    {
        Assert.Equal("2024", MonthlyCostChartProjection.FormatMonthAxis("2024"));
        Assert.Equal("2024-01-15", MonthlyCostChartProjection.FormatMonthAxis("2024-01-15"));
        Assert.Equal(string.Empty, MonthlyCostChartProjection.FormatMonthAxis(string.Empty));
    }

    // ── Accessible-table cells: web `String(raw)` (month verbatim, cost ungrouped, no forced decimals) ─

    [Fact]
    public void FormatCostCell_matches_javascript_string_number()
    {
        Assert.Equal("120.5", MonthlyCostChartProjection.FormatCostCell(120.5));
        Assert.Equal("120", MonthlyCostChartProjection.FormatCostCell(120.0));
        Assert.Equal("0", MonthlyCostChartProjection.FormatCostCell(0.0));
        Assert.Equal("1234.5", MonthlyCostChartProjection.FormatCostCell(1234.5));
        Assert.DoesNotContain(",", MonthlyCostChartProjection.FormatCostCell(1234.5), StringComparison.Ordinal);
    }

    [Fact]
    public void Row_carries_the_month_verbatim_and_the_raw_cost()
    {
        var row = Assert.Single(Project(Ready(new MonthlyCostPoint("2024-07", 1234.5))).Rows);

        Assert.Equal("2024-07", row.Cells[MonthlyCostChartProjection.MonthKey]);
        Assert.Equal("1234.5", row.Cells[MonthlyCostChartProjection.CostKey]);
    }

    [Fact]
    public void Rows_have_stable_unique_keys()
    {
        var rows = Project(Ready(Pt("2024-01"), Pt("2024-02"), Pt("2024-03"))).Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(rows.Count, rows.Select(r => r.RowKey).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Empty_state_has_no_rows()
    {
        Assert.Empty(Project(MonthlyCostChartModel.Empty).Rows);
    }

    // ── Accessible data table columns (web dataColumns Month / Cost ($)) ──────────────────────────────

    [Fact]
    public void Columns_match_the_web_two_columns()
    {
        var columns = Project(Ready(Pt())).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((MonthlyCostChartProjection.MonthKey, "Month"), (c.Key, c.Header)),
            c => Assert.Equal((MonthlyCostChartProjection.CostKey, "Cost ($)"), (c.Key, c.Header)));
    }

    [Fact]
    public void Table_label_interpolates_the_title()
    {
        Assert.Equal("Monthly Cost Trend \u2014 data table", Project(Ready(Pt())).TableLabel);
    }

    // ── Currency summary: web Y-axis `formatCurrency(v, 0)` ───────────────────────────────────────────

    [Fact]
    public void FormatCurrency_prefixes_the_symbol_and_groups_like_intl()
    {
        Assert.Equal("$120", MonthlyCostChartProjection.FormatCurrency(120, "$", 0));
        Assert.Equal("$1,234", MonthlyCostChartProjection.FormatCurrency(1234, "$", 0));
        Assert.Equal("$1,235", MonthlyCostChartProjection.FormatCurrency(1234.5, "$", 0));
        Assert.Equal("$120.50", MonthlyCostChartProjection.FormatCurrency(120.5, "$", 2));
    }

    [Fact]
    public void FormatCurrency_honors_a_custom_symbol()
    {
        Assert.Equal("\u20AC80", MonthlyCostChartProjection.FormatCurrency(80, "\u20AC", 0));
    }

    [Fact]
    public void Ready_chart_summary_states_the_currency_cost_range_at_zero_decimals()
    {
        var display = Project(Ready(
            new MonthlyCostPoint("2024-01", 80.4),
            new MonthlyCostPoint("2024-02", 140.9),
            new MonthlyCostPoint("2024-03", 110)));

        Assert.Equal($"Monthly charging cost trend area chart. $80{EnDash}$141", display.ChartSummary);
    }

    [Fact]
    public void Currency_summary_uses_the_supplied_symbol()
    {
        var model = Ready(new MonthlyCostPoint("2024-01", 80), new MonthlyCostPoint("2024-02", 140));

        var display = MonthlyCostChartProjection.Project(model, Localizer, "\u00A3");

        Assert.Equal($"Monthly charging cost trend area chart. \u00A380{EnDash}\u00A3140", display.ChartSummary);
    }

    [Fact]
    public void Empty_chart_summary_falls_back_to_the_aria_label()
    {
        Assert.Equal(
            "Monthly charging cost trend area chart",
            Project(MonthlyCostChartModel.Empty).ChartSummary);
    }

    // ── Annotations: container-supplied reference lines (web renderAnnotationLines) ───────────────────

    [Fact]
    public void Annotations_default_to_empty()
    {
        Assert.Empty(Project(Ready(Pt("2024-01"), Pt("2024-02"))).Annotations);
    }

    [Fact]
    public void Annotation_on_a_charted_month_becomes_a_vertical_reference_line_at_its_ordinal()
    {
        var model = new MonthlyCostChartModel(
            new[] { new MonthlyCostPoint("2024-01", 80), new MonthlyCostPoint("2024-02", 140) },
            VehicleId: 7,
            Annotations: new[] { new MonthlyCostAnnotation("a1", "2024-02", "Rate change") });

        var line = Assert.Single(Project(model).Annotations);

        Assert.Equal("a1", line.Id);
        Assert.Equal(ChartAnnotationKind.VerticalLine, line.Kind);
        Assert.Equal(1, line.Value);
        Assert.Equal("Rate change", line.Label);
    }

    [Fact]
    public void Annotation_off_the_charted_months_is_dropped()
    {
        var model = new MonthlyCostChartModel(
            new[] { new MonthlyCostPoint("2024-01", 80) },
            VehicleId: null,
            Annotations: new[] { new MonthlyCostAnnotation("a1", "2030-09", "Future") });

        Assert.Empty(Project(model).Annotations);
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_and_aria_label_from_the_facade()
    {
        var display = Project(Ready(Pt()));

        Assert.Equal("Monthly Cost Trend", display.Title);
        Assert.Equal("Monthly charging cost trend area chart", display.AriaLabel);
    }

    [Fact]
    public void Empty_message_uses_the_web_not_enough_data_string()
    {
        Assert.Equal("Not enough data", Project(MonthlyCostChartModel.Empty).EmptyMessage);
    }

    // ── Accessibility: every state exposes a non-empty Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(MonthlyCostChartModel.Empty),
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
        var display = Project(MonthlyCostChartModel.Empty);

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_row_exposes_a_descriptive_automation_name()
    {
        var row = Assert.Single(Project(Ready(new MonthlyCostPoint("2024-09", 99.5))).Rows);

        Assert.Contains("2024-09", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("99.5", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Cost ($)", row.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=MonthlyCostChart, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new MonthlyCostChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MonthlyCostChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_month_or_cost_data()
    {
        var captured = new List<string>();
        var diagnostics = new MonthlyCostChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("2024", line, StringComparison.Ordinal);
        Assert.DoesNotContain("$", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=MonthlyCostChart", line);
    }

    [Fact]
    public void Registration_exposes_the_stable_slug_scope_and_chart_id()
    {
        Assert.Equal("MonthlyCostChart", MonthlyCostChartRegistration.Slug);
        Assert.Equal("cost", MonthlyCostChartRegistration.AnnotationScope);
        Assert.Equal("cost-monthly-trend", MonthlyCostChartRegistration.ChartId);
        Assert.Equal("$", MonthlyCostChartRegistration.DefaultCurrencySymbol);
    }
}
