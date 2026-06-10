using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Driving;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>PowerOutputChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / error / empty / ready / stale / offline), the web <c>data.length &gt; 1</c> empty gate,
/// the two power area series (peak in the Power role, regen in the Regen role, raw samples, date labels, " kW"
/// unit, one-decimal tooltip), the accessible data table (Date / Peak (kW) / Regen (kW) columns and one row per
/// drive), the hidden-series legend parity (toggle a projected series by name), the per-state accessible names,
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class PowerOutputChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static PowerOutputPoint Point(string date = "Jan 1", double max = 25, double min = 0) =>
        new(date, max, min);

    private static PowerOutputChartModel Loaded(params PowerOutputPoint[] points) =>
        PowerOutputChartModel.Loaded(points);

    private static PowerOutputChartDisplay Project(PowerOutputChartModel model) =>
        PowerOutputChartProjection.Project(model, Localizer);

    // ── Branch precedence: phase wins (loading → error), then freshness over emptiness ───────────────

    [Fact]
    public void Loading_when_phase_is_loading()
    {
        Assert.Equal(PowerOutputChartState.Loading, Project(PowerOutputChartModel.Pending).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_points()
    {
        var model = new PowerOutputChartModel(
            PowerOutputPhase.Loading, [Point(), Point("Jan 2", 30)]);

        Assert.Equal(PowerOutputChartState.Loading, Project(model).State);
    }

    [Fact]
    public void Error_when_phase_is_error()
    {
        Assert.Equal(PowerOutputChartState.Error, Project(PowerOutputChartModel.Failed()).State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_points()
    {
        var display = Project(PowerOutputChartModel.Empty);

        Assert.Equal(PowerOutputChartState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.TableRows);
    }

    // ── Web empty gate: data.length > 1 (a single drive is too sparse to chart) ───────────────────────

    [Fact]
    public void Single_point_is_empty_two_points_is_ready()
    {
        Assert.Equal(PowerOutputChartState.Empty, Project(Loaded(Point())).State);

        var two = Project(Loaded(Point("Jan 1", 10), Point("Jan 2", 20)));
        Assert.Equal(PowerOutputChartState.Ready, two.State);
        Assert.True(two.HasData);
    }

    [Fact]
    public void Ready_when_two_or_more_points()
    {
        var display = Project(Loaded(Point("Jan 1", 10), Point("Jan 2", 30), Point("Jan 3", 5)));

        Assert.Equal(PowerOutputChartState.Ready, display.State);
        Assert.True(display.HasData);
        Assert.Equal(3, display.Series[0].Points.Count);
    }

    [Fact]
    public void Stale_when_ready_and_stale()
    {
        Assert.Equal(
            PowerOutputChartState.Stale,
            Project(PowerOutputChartModel.StaleSnapshot([Point(), Point("Jan 2", 30)])).State);
    }

    [Fact]
    public void Offline_when_ready_and_offline()
    {
        Assert.Equal(
            PowerOutputChartState.Offline,
            Project(PowerOutputChartModel.OfflineSnapshot([Point(), Point("Jan 2", 30)])).State);
    }

    [Fact]
    public void Offline_takes_precedence_over_stale()
    {
        var model = new PowerOutputChartModel(
            PowerOutputPhase.Ready, [Point(), Point("Jan 2", 30)], IsStale: true, IsOffline: true);

        Assert.Equal(PowerOutputChartState.Offline, Project(model).State);
    }

    // ── Visual-frame (container) state mapping ───────────────────────────────────────────────────────

    [Fact]
    public void Container_state_tracks_each_branch()
    {
        Assert.Equal(ChartState.Loading, Project(PowerOutputChartModel.Pending).ContainerState);
        Assert.Equal(ChartState.Error, Project(PowerOutputChartModel.Failed()).ContainerState);
        Assert.Equal(ChartState.Empty, Project(PowerOutputChartModel.Empty).ContainerState);
        Assert.Equal(ChartState.Ready, Project(Loaded(Point(), Point("Jan 2", 30))).ContainerState);
    }

    [Fact]
    public void Stale_with_points_still_draws_the_chart()
    {
        Assert.Equal(
            ChartState.Ready,
            Project(PowerOutputChartModel.StaleSnapshot([Point(), Point("Jan 2", 30)])).ContainerState);
    }

    [Fact]
    public void Offline_without_a_cached_history_falls_back_to_empty_body()
    {
        var model = new PowerOutputChartModel(PowerOutputPhase.Ready, [], IsOffline: true);
        var display = Project(model);

        Assert.Equal(PowerOutputChartState.Offline, display.State);
        Assert.Equal(ChartState.Empty, display.ContainerState);
        Assert.False(display.HasData);
    }

    // ── Two power area series (web violet powerMax → Power role, red powerMin → Regen role) ───────────

    [Fact]
    public void Two_series_peak_then_regen_in_power_and_regen_roles()
    {
        var display = Project(Loaded(Point(), Point("Jan 2", 30)));

        Assert.Equal(2, display.Series.Count);
        Assert.Equal(ChartRole.Power, display.Series[0].Role);
        Assert.Equal(ChartRole.Regen, display.Series[1].Role);
    }

    [Fact]
    public void Series_are_areas_with_kw_unit_and_one_decimal()
    {
        var display = Project(Loaded(Point(), Point("Jan 2", 30)));

        foreach (ChartSeries series in display.Series)
        {
            Assert.Equal(ChartSeriesKind.Area, series.Kind);
            Assert.Equal("kW", series.Unit);
            Assert.Equal(1, series.Decimals);
        }
    }

    [Fact]
    public void Series_carry_ordinal_index_raw_values_and_date_labels()
    {
        var display = Project(Loaded(new PowerOutputPoint("Jan 5", 45.06, -2.5), new PowerOutputPoint("Jan 6", 88.5, 0)));

        ChartSeries peak = display.Series[0];
        Assert.Equal(0, peak.Points[0].X); // ordinal index (web's categorical date axis)
        Assert.Equal(45.06, peak.Points[0].Y); // raw — the trace is not pre-rounded
        Assert.Equal("Jan 5", peak.Points[0].Label);
        Assert.Equal(1, peak.Points[1].X);
        Assert.Equal(88.5, peak.Points[1].Y);

        ChartSeries regen = display.Series[1];
        Assert.Equal(-2.5, regen.Points[0].Y);
        Assert.Equal(0, regen.Points[1].Y);
        Assert.Equal("Jan 5", regen.Points[0].Label);
    }

    [Fact]
    public void Series_names_resolve_from_the_facade()
    {
        var display = Project(Loaded(Point(), Point("Jan 2", 30)));

        Assert.Equal("Peak Power (kW)", display.Series[0].Name);
        Assert.Equal("Regen Power (kW)", display.Series[1].Name);
    }

    [Fact]
    public void Empty_model_yields_zero_point_series()
    {
        var display = Project(PowerOutputChartModel.Empty);

        Assert.Equal(2, display.Series.Count);
        Assert.All(display.Series, s => Assert.Empty(s.Points));
    }

    // ── Accessible data table (web ChartContainer dataColumns + data) ─────────────────────────────────

    [Fact]
    public void Table_columns_are_date_peak_regen()
    {
        var columns = Project(Loaded(Point(), Point("Jan 2", 30))).TableColumns;

        Assert.Equal(new[] { "Date", "Peak (kW)", "Regen (kW)" }, columns);
    }

    [Fact]
    public void Table_rows_mirror_each_drive_in_one_decimal_kilowatts()
    {
        var rows = Project(Loaded(
            new PowerOutputPoint("Jan 5", 150, 0),
            new PowerOutputPoint("Jan 6", 88.5, -12.4))).TableRows;

        Assert.Equal(2, rows.Count);

        Assert.Equal("Jan 5", rows[0].Date);
        Assert.Equal("150.0", rows[0].Peak);
        Assert.Equal("0.0", rows[0].Regen);

        Assert.Equal("Jan 6", rows[1].Date);
        Assert.Equal("88.5", rows[1].Peak);
        Assert.Equal("-12.4", rows[1].Regen);
    }

    [Fact]
    public void Table_row_automation_name_reads_date_then_labelled_values()
    {
        var rows = Project(Loaded(new PowerOutputPoint("Jan 5", 150, 0), Point("Jan 6", 30))).TableRows;

        Assert.Equal("Jan 5, Peak (kW): 150.0, Regen (kW): 0.0", rows[0].AutomationName);
    }

    // ── Hidden-series legend parity (web useHiddenSeries + <ChartLegend>) ─────────────────────────────

    [Fact]
    public void Both_series_visible_by_default()
    {
        var display = Project(Loaded(Point(), Point("Jan 2", 30)));
        var legend = new ChartLegendState();

        Assert.True(legend.IsVisible(display.Series[0].Name));
        Assert.True(legend.IsVisible(display.Series[1].Name));
        Assert.Equal(2, legend.VisibleSeries(display.Series).Count);
    }

    [Fact]
    public void Hidden_legend_toggles_a_projected_series_by_name()
    {
        var display = Project(Loaded(Point(), Point("Jan 2", 30)));
        var legend = new ChartLegendState();

        legend.Toggle(display.Series[1].Name); // declutter to the peak trace

        Assert.False(legend.IsVisible(display.Series[1].Name));
        var visible = legend.VisibleSeries(display.Series);
        Assert.Single(visible);
        Assert.Equal(display.Series[0].Name, visible[0].Name);
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_subtitle_aria_empty_and_data_table_label()
    {
        var display = Project(Loaded(Point(), Point("Jan 2", 30)));

        Assert.Equal("Power Output History", display.Title);
        Assert.Equal("Peak and regen power per drive over time", display.Subtitle);
        Assert.Equal("Per-drive peak and regen motor power output history area chart", display.AriaLabel);
        Assert.Equal("No data", display.EmptyMessage);
        Assert.Equal("Show data table", display.DataTableLabel);
    }

    [Fact]
    public void Error_message_prefers_the_model_detail_then_falls_back()
    {
        Assert.Equal(
            "Couldn't load power output history",
            Project(PowerOutputChartModel.Failed()).ErrorMessage);
        Assert.Equal(
            "You're offline",
            Project(PowerOutputChartModel.Failed("You're offline")).ErrorMessage);
    }

    // ── Freshness chip ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Freshness_chip_is_absent_when_ready()
    {
        Assert.Null(Project(Loaded(Point(), Point("Jan 2", 30))).FreshnessChip);
    }

    [Fact]
    public void Freshness_chip_labels_stale_and_offline_snapshots()
    {
        Assert.Equal(
            "Stale",
            Project(PowerOutputChartModel.StaleSnapshot([Point(), Point("Jan 2", 30)])).FreshnessChip);
        Assert.Equal(
            "Offline",
            Project(PowerOutputChartModel.OfflineSnapshot([Point(), Point("Jan 2", 30)])).FreshnessChip);
    }

    // ── Accessibility: every state exposes a descriptive Narrator name ───────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(PowerOutputChartModel.Pending),
                Project(PowerOutputChartModel.Failed()),
                Project(PowerOutputChartModel.Empty),
                Project(Loaded(Point(), Point("Jan 2", 30))),
                Project(PowerOutputChartModel.StaleSnapshot([Point(), Point("Jan 2", 30)])),
                Project(PowerOutputChartModel.OfflineSnapshot([Point(), Point("Jan 2", 30)])),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_aria_label()
    {
        var display = Project(Loaded(Point(), Point("Jan 2", 30)));

        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(PowerOutputChartModel.Empty);

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Error_automation_name_carries_the_error_message()
    {
        var display = Project(PowerOutputChartModel.Failed());

        Assert.Contains(display.ErrorMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_automation_name_carries_the_freshness_chip()
    {
        var display = Project(PowerOutputChartModel.StaleSnapshot([Point(), Point("Jan 2", 30)]));

        Assert.Contains("Stale", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Null safety ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_data_is_treated_as_empty()
    {
        var model = new PowerOutputChartModel(PowerOutputPhase.Ready, null!);
        var display = Project(model);

        Assert.Equal(PowerOutputChartState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.TableRows);
        Assert.All(display.Series, s => Assert.Empty(s.Points));
    }

    // ── Diagnostics (P1/S11): view.opened slug=PowerOutputChart, PII-safe ────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new PowerOutputChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PowerOutputChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_power_values()
    {
        var captured = new List<string>();
        var diagnostics = new PowerOutputChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=PowerOutputChart", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("PowerOutputChart", PowerOutputChartRegistration.Slug);
    }

    [Fact]
    public void Registration_name_resolves_from_the_facade()
    {
        Assert.Equal("Power Output History", PowerOutputChartRegistration.Name(Localizer));
    }
}
