using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChartsRow</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the per-panel data gating, the energy/cost trend point mapping, the
/// categorical date-range, the donut wedge palette-by-order colouring, the grouped count + 2-decimal value
/// formatting (web <c>fmtNumber</c> / <c>fmtWithUnit</c> at the default precision), the localized series names
/// and cost-row strings, the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-list/ChartsRow.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class ChartsRowTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ChartsRowModel Ready() => new(
        false,
        [new EnergyTrendPoint("Jun 1", 10, 2), new EnergyTrendPoint("Jun 5", 20, 4), new EnergyTrendPoint("Jun 9", 15, 3)],
        [new ChargerBreakdownEntry("Supercharger", 12), new ChargerBreakdownEntry("DC Fast", 5), new ChargerBreakdownEntry("Home / AC", 8)],
        [new CostByTypeEntry("Supercharger", 42.5, 12.34, 0.456), new CostByTypeEntry("Home / AC", 8.0, 1.5, 0.18)]);

    private static ChartsRowDisplay Project(ChartsRowModel model) =>
        ChartsRowProjection.Project(model, Localizer);

    // ── Branch precedence: loading → empty → ready (web data lifecycle) ────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ChartsRowState.Loading, Project(ChartsRowModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        var model = Ready() with { Loading = true };

        Assert.Equal(ChartsRowState.Loading, Project(model).State);
    }

    [Fact]
    public void Empty_when_nothing_to_chart_in_either_panel() =>
        Assert.Equal(ChartsRowState.Empty, Project(ChartsRowModel.Empty).State);

    [Fact]
    public void Ready_when_any_panel_has_data() =>
        Assert.Equal(ChartsRowState.Ready, Project(Ready()).State);

    [Fact]
    public void Ready_when_only_the_trend_panel_has_data()
    {
        var model = new ChartsRowModel(false, [new EnergyTrendPoint("Jun 1", 10, 2)], [], []);

        var display = Project(model);

        Assert.Equal(ChartsRowState.Ready, display.State);
        Assert.True(display.EnergyPanel.HasData);
        Assert.False(display.ChargerPanel.HasData);
    }

    [Fact]
    public void Ready_when_only_the_charger_panel_has_data()
    {
        var model = new ChartsRowModel(false, [], [new ChargerBreakdownEntry("Supercharger", 3)], []);

        var display = Project(model);

        Assert.Equal(ChartsRowState.Ready, display.State);
        Assert.False(display.EnergyPanel.HasData);
        Assert.True(display.ChargerPanel.HasData);
    }

    // ── Energy & Cost Trend panel ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Energy_panel_title_resolves_from_the_facade() =>
        Assert.Equal("Energy & Cost Trend", Project(Ready()).EnergyPanel.Title);

    [Fact]
    public void Energy_panel_series_names_match_the_web_labels()
    {
        var panel = Project(Ready()).EnergyPanel;

        Assert.Equal("Energy (kWh)", panel.EnergySeriesName);
        Assert.Equal("Cost ($)", panel.CostSeriesName);
    }

    [Fact]
    public void Energy_points_carry_ordinal_x_value_and_date_label()
    {
        var panel = Project(Ready()).EnergyPanel;

        Assert.Collection(
            panel.EnergyPoints,
            p => Assert.Equal((0d, 10d, "Jun 1"), (p.X, p.Value, p.DateLabel)),
            p => Assert.Equal((1d, 20d, "Jun 5"), (p.X, p.Value, p.DateLabel)),
            p => Assert.Equal((2d, 15d, "Jun 9"), (p.X, p.Value, p.DateLabel)));
    }

    [Fact]
    public void Cost_points_share_the_dates_but_carry_the_cost_value()
    {
        var panel = Project(Ready()).EnergyPanel;

        Assert.Collection(
            panel.CostPoints,
            p => Assert.Equal((0d, 2d, "Jun 1"), (p.X, p.Value, p.DateLabel)),
            p => Assert.Equal((1d, 4d, "Jun 5"), (p.X, p.Value, p.DateLabel)),
            p => Assert.Equal((2d, 3d, "Jun 9"), (p.X, p.Value, p.DateLabel)));
    }

    [Fact]
    public void Date_range_spans_first_to_last_with_an_en_dash() =>
        Assert.Equal("Jun 1 \u2013 Jun 9", Project(Ready()).EnergyPanel.DateRangeText);

    [Fact]
    public void Date_range_is_a_single_date_when_there_is_one_point()
    {
        var model = new ChartsRowModel(false, [new EnergyTrendPoint("Jun 1", 10, 2)], [], []);

        Assert.Equal("Jun 1", Project(model).EnergyPanel.DateRangeText);
    }

    [Fact]
    public void Date_range_is_empty_with_no_trend() =>
        Assert.Equal(string.Empty, Project(ChartsRowModel.Empty).EnergyPanel.DateRangeText);

    [Fact]
    public void Blank_trend_date_falls_back_to_an_em_dash()
    {
        var model = new ChartsRowModel(false, [new EnergyTrendPoint("  ", 10, 2)], [], []);

        var panel = Project(model).EnergyPanel;

        Assert.Equal("\u2014", panel.EnergyPoints[0].DateLabel);
        Assert.Equal("\u2014", panel.DateRangeText);
    }

    [Fact]
    public void Energy_panel_empty_message_uses_the_shared_no_data_string()
    {
        var panel = Project(ChartsRowModel.Empty).EnergyPanel;

        Assert.False(panel.HasData);
        Assert.Equal("No data available", panel.EmptyMessage);
        Assert.Equal("No data available", panel.ChartSummary);
    }

    // ── Charger Breakdown panel: donut wedges ───────────────────────────────────────────────────────────

    [Fact]
    public void Charger_panel_title_resolves_from_the_facade() =>
        Assert.Equal("Charger Breakdown", Project(Ready()).ChargerPanel.Title);

    [Fact]
    public void Slices_keep_order_and_colour_by_position()
    {
        var slices = Project(Ready()).ChargerPanel.Slices;

        Assert.Collection(
            slices,
            s => Assert.Equal(("Supercharger", 0), (s.Name, s.ColorIndex)),
            s => Assert.Equal(("DC Fast", 1), (s.Name, s.ColorIndex)),
            s => Assert.Equal(("Home / AC", 2), (s.Name, s.ColorIndex)));
    }

    [Fact]
    public void Slice_value_text_groups_thousands_as_an_integer()
    {
        var model = new ChartsRowModel(false, [], [new ChargerBreakdownEntry("Supercharger", 1234)], []);

        Assert.Equal("1,234", Project(model).ChargerPanel.Slices[0].ValueText);
    }

    [Fact]
    public void Slice_automation_name_carries_name_and_count() =>
        Assert.Equal("Supercharger, 12", Project(Ready()).ChargerPanel.Slices[0].AutomationName);

    [Fact]
    public void Charger_chart_summary_lists_every_wedge() =>
        Assert.Equal(
            "Supercharger 12, DC Fast 5, Home / AC 8",
            Project(Ready()).ChargerPanel.ChartSummary);

    // ── Charger Breakdown panel: cost-by-type rows ──────────────────────────────────────────────────────

    [Fact]
    public void Cost_row_energy_text_is_the_value_with_the_kwh_unit() =>
        Assert.Equal("42.50 kWh", Project(Ready()).ChargerPanel.CostRows[0].EnergyText);

    [Fact]
    public void Cost_row_cost_text_is_dollar_value_then_total() =>
        Assert.Equal("$12.34 total", Project(Ready()).ChargerPanel.CostRows[0].CostText);

    [Fact]
    public void Cost_row_per_kwh_text_rounds_to_two_decimals_with_the_per_kwh_suffix() =>
        // 0.456 → 0.46 (half away from zero), prefixed "$" and suffixed "/kWh".
        Assert.Equal("$0.46/kWh", Project(Ready()).ChargerPanel.CostRows[0].PerKwhText);

    [Fact]
    public void Cost_row_automation_name_folds_every_figure()
    {
        var row = Project(Ready()).ChargerPanel.CostRows[0];

        Assert.Equal("Supercharger: 42.50 kWh, $12.34 total, $0.46/kWh", row.AutomationName);
    }

    // ── Per-half gating: never a blank box ──────────────────────────────────────────────────────────────

    [Fact]
    public void Charger_panel_has_pie_and_rows_when_both_present()
    {
        var panel = Project(Ready()).ChargerPanel;

        Assert.True(panel.HasPie);
        Assert.True(panel.HasRows);
        Assert.True(panel.HasData);
    }

    [Fact]
    public void Charger_panel_pie_only_when_no_cost_rows()
    {
        var model = new ChartsRowModel(false, [], [new ChargerBreakdownEntry("Supercharger", 3)], []);

        var panel = Project(model).ChargerPanel;

        Assert.True(panel.HasPie);
        Assert.False(panel.HasRows);
        Assert.True(panel.HasData);
    }

    [Fact]
    public void Charger_panel_rows_only_when_no_breakdown()
    {
        var model = new ChartsRowModel(false, [], [], [new CostByTypeEntry("Home / AC", 8, 1.5, 0.18)]);

        var panel = Project(model).ChargerPanel;

        Assert.False(panel.HasPie);
        Assert.True(panel.HasRows);
        Assert.True(panel.HasData);
        Assert.Equal("Home / AC", panel.ChartSummary);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_surface_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(ChartsRowModel.Pending),
                Project(ChartsRowModel.Empty),
                Project(Ready()),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_surface_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading...", Project(ChartsRowModel.Pending).AutomationName);

    [Fact]
    public void Empty_surface_automation_name_is_the_empty_message() =>
        Assert.Equal("No data available", Project(ChartsRowModel.Empty).AutomationName);

    [Fact]
    public void Ready_surface_automation_name_carries_both_panel_titles() =>
        Assert.Equal("Energy & Cost Trend. Charger Breakdown", Project(Ready()).AutomationName);

    [Fact]
    public void Panel_automation_names_pair_title_with_summary()
    {
        var display = Project(Ready());

        Assert.StartsWith("Energy & Cost Trend.", display.EnergyPanel.AutomationName, StringComparison.Ordinal);
        Assert.StartsWith("Charger Breakdown.", display.ChargerPanel.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_panel_automation_names_name_the_empty_state()
    {
        var display = Project(ChartsRowModel.Empty);

        Assert.Equal("Energy & Cost Trend. No data available", display.EnergyPanel.AutomationName);
        Assert.Equal("Charger Breakdown. No data available", display.ChargerPanel.AutomationName);
    }

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading...", Project(ChartsRowModel.Pending).LoadingLabel);

    // ── i18n: the projection feeds the web/source keys to the facade ────────────────────────────────────

    [Fact]
    public void Projection_resolves_every_label_through_the_documented_keys()
    {
        var display = ChartsRowProjection.Project(Ready(), new KeyEchoLocalizer());

        Assert.Equal("charging.charts.energyCostTrend", display.EnergyPanel.Title);
        Assert.Equal("charging.charts.chargerBreakdown", display.ChargerPanel.Title);
        Assert.Equal("common.energy (units.kwh)", display.EnergyPanel.EnergySeriesName);
        Assert.Equal("common.cost ($)", display.EnergyPanel.CostSeriesName);
        Assert.Equal("chart.noData", display.EnergyPanel.EmptyMessage);
        Assert.Equal("common.loading", display.LoadingLabel);
    }

    [Fact]
    public void Cost_strings_use_the_total_and_kwh_keys()
    {
        var row = ChartsRowProjection.Project(Ready(), new KeyEchoLocalizer()).ChargerPanel.CostRows[0];

        // "$12.34 {total-key}" and "42.50 {kwh-key}" and "$0.46/{kwh-key}".
        Assert.Equal("$12.34 total", row.CostText);
        Assert.Equal("42.50 units.kwh", row.EnergyText);
        Assert.Equal("$0.46/units.kwh", row.PerKwhText);
    }

    // ── Diagnostics (P1/S11): view.opened slug=ChartsRow, PII-safe ──────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChartsRowDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChartsRow", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_charging_figures()
    {
        var captured = new List<string>();
        var diagnostics = new ChartsRowDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=ChartsRow", line);
        Assert.DoesNotContain('$', line);
        Assert.DoesNotContain('%', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ChartsRow", ChartsRowRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => ChartsRowProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => ChartsRowProjection.Project(ChartsRowModel.Empty, null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that echoes the requested key (ignoring the fallback), proving the
    /// projection feeds the documented i18n keys — not ad-hoc English literals — into the facade.
    /// </summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
