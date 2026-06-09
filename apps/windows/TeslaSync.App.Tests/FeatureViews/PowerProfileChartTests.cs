using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Driving;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>PowerProfileChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / error / empty / ready / stale / offline), the web <c>chartData.length &gt; 1</c>
/// empty gate, the single Power area series (raw samples, time labels, " kW" unit, one-decimal tooltip,
/// platform Power role), the three summary figures (whole-kW peaks, two-decimal average, web amber/cyan/primary
/// brushes), the per-state accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/PowerProfileChart.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class PowerProfileChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static PowerSample Sample(string time = "00:00", double power = 25) => new(time, power);

    private static PowerProfileStats Stats(double max = 250, double min = -60, double avg = 12.34) =>
        new(max, min, avg);

    private static PowerProfileChartModel Loaded(params PowerSample[] samples) =>
        PowerProfileChartModel.Loaded(samples, Stats());

    private static PowerProfileChartDisplay Project(PowerProfileChartModel model) =>
        PowerProfileChartProjection.Project(model, Localizer);

    // ── Branch precedence: phase wins (loading → error), then freshness over emptiness ───────────────

    [Fact]
    public void Loading_when_phase_is_loading()
    {
        Assert.Equal(PowerProfileChartState.Loading, Project(PowerProfileChartModel.Pending).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_samples()
    {
        var model = new PowerProfileChartModel(
            PowerProfilePhase.Loading, [Sample(), Sample("00:01", 30)], Stats());

        Assert.Equal(PowerProfileChartState.Loading, Project(model).State);
    }

    [Fact]
    public void Error_when_phase_is_error()
    {
        Assert.Equal(PowerProfileChartState.Error, Project(PowerProfileChartModel.Failed()).State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_samples()
    {
        var display = Project(PowerProfileChartModel.Empty);

        Assert.Equal(PowerProfileChartState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.Series.Points);
    }

    // ── Web empty gate: chartData.length > 1 (a single sample is too sparse to chart) ────────────────

    [Fact]
    public void Single_sample_is_empty_two_samples_is_ready()
    {
        Assert.Equal(PowerProfileChartState.Empty, Project(Loaded(Sample())).State);

        var two = Project(Loaded(Sample("00:00", 10), Sample("00:01", 20)));
        Assert.Equal(PowerProfileChartState.Ready, two.State);
        Assert.True(two.HasData);
    }

    [Fact]
    public void Ready_when_two_or_more_samples()
    {
        var display = Project(Loaded(Sample("00:00", 10), Sample("00:01", 30), Sample("00:02", -5)));

        Assert.Equal(PowerProfileChartState.Ready, display.State);
        Assert.True(display.HasData);
        Assert.Equal(3, display.Series.Points.Count);
    }

    [Fact]
    public void Stale_when_ready_and_stale()
    {
        Assert.Equal(
            PowerProfileChartState.Stale,
            Project(PowerProfileChartModel.StaleSnapshot([Sample(), Sample("00:01", 30)], Stats())).State);
    }

    [Fact]
    public void Offline_when_ready_and_offline()
    {
        Assert.Equal(
            PowerProfileChartState.Offline,
            Project(PowerProfileChartModel.OfflineSnapshot([Sample(), Sample("00:01", 30)], Stats())).State);
    }

    [Fact]
    public void Offline_takes_precedence_over_stale()
    {
        var model = new PowerProfileChartModel(
            PowerProfilePhase.Ready, [Sample(), Sample("00:01", 30)], Stats(), IsStale: true, IsOffline: true);

        Assert.Equal(PowerProfileChartState.Offline, Project(model).State);
    }

    // ── Visual-frame (container) state mapping ───────────────────────────────────────────────────────

    [Fact]
    public void Container_state_tracks_each_branch()
    {
        Assert.Equal(ChartState.Loading, Project(PowerProfileChartModel.Pending).ContainerState);
        Assert.Equal(ChartState.Error, Project(PowerProfileChartModel.Failed()).ContainerState);
        Assert.Equal(ChartState.Empty, Project(PowerProfileChartModel.Empty).ContainerState);
        Assert.Equal(ChartState.Ready, Project(Loaded(Sample(), Sample("00:01", 30))).ContainerState);
    }

    [Fact]
    public void Stale_with_samples_still_draws_the_chart()
    {
        Assert.Equal(
            ChartState.Ready,
            Project(PowerProfileChartModel.StaleSnapshot([Sample(), Sample("00:01", 30)], Stats())).ContainerState);
    }

    [Fact]
    public void Offline_without_a_cached_trace_falls_back_to_empty_body()
    {
        var model = new PowerProfileChartModel(
            PowerProfilePhase.Ready, [], PowerProfileStats.Zero, IsOffline: true);
        var display = Project(model);

        Assert.Equal(PowerProfileChartState.Offline, display.State);
        Assert.Equal(ChartState.Empty, display.ContainerState);
        Assert.False(display.HasData);
    }

    // ── Power area series (web <Area dataKey="power"> drawn with the platform Power accent) ───────────

    [Fact]
    public void Series_is_an_area_in_the_power_role()
    {
        ChartSeries series = Project(Loaded(Sample(), Sample("00:01", 30))).Series;

        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(ChartRole.Power, series.Role);
    }

    [Fact]
    public void Series_carries_raw_samples_time_labels_kw_unit_and_one_decimal()
    {
        ChartSeries series = Project(Loaded(new PowerSample("12:30", 45.06), new PowerSample("12:31", -18.2))).Series;

        Assert.Equal(2, series.Points.Count);
        Assert.Equal(0, series.Points[0].X); // ordinal index (web's categorical time axis)
        Assert.Equal(45.06, series.Points[0].Y); // raw — the trace is not pre-rounded
        Assert.Equal("12:30", series.Points[0].Label);
        Assert.Equal(1, series.Points[1].X);
        Assert.Equal(-18.2, series.Points[1].Y);
        Assert.Equal("12:31", series.Points[1].Label);
        Assert.Equal("kW", series.Unit);
        Assert.Equal(1, series.Decimals);
    }

    [Fact]
    public void Series_name_resolves_from_the_facade()
    {
        Assert.Equal("Power", Project(Loaded(Sample(), Sample("00:01", 30))).Series.Name);
    }

    [Fact]
    public void Empty_model_yields_a_zero_point_series()
    {
        Assert.Empty(Project(PowerProfileChartModel.Empty).Series.Points);
    }

    // ── Summary figures (web Max Power / Max Regen / Avg row) ─────────────────────────────────────────

    [Fact]
    public void Stats_resolve_labels_values_and_brushes()
    {
        var model = PowerProfileChartModel.Loaded(
            [Sample(), Sample("00:01", 30)], new PowerProfileStats(250, -60, 12.34));
        var stats = Project(model).Stats;

        Assert.Equal(3, stats.Count);

        Assert.Equal("Max Power", stats[0].Label);
        Assert.Equal("250 kW", stats[0].Value);
        Assert.Equal("TsChartPowerBrush", stats[0].ColorBrushKey);

        Assert.Equal("Max Regen", stats[1].Label);
        Assert.Equal("-60 kW", stats[1].Value);
        Assert.Equal("TsChartRegenBrush", stats[1].ColorBrushKey);

        Assert.Equal("Avg", stats[2].Label);
        Assert.Equal("12.34 kW", stats[2].Value);
        Assert.Equal("TsColorTextPrimaryBrush", stats[2].ColorBrushKey);
    }

    [Fact]
    public void Peak_figures_round_to_whole_kilowatts_average_keeps_two_decimals()
    {
        var model = PowerProfileChartModel.Loaded(
            [Sample(), Sample("00:01", 30)], new PowerProfileStats(250.7, -59.6, 12.5));
        var stats = Project(model).Stats;

        Assert.Equal("251 kW", stats[0].Value);   // fmtInt(powerMax)
        Assert.Equal("-60 kW", stats[1].Value);   // fmtInt(powerMin)
        Assert.Equal("12.50 kW", stats[2].Value);  // fmtNumber(avgPower)
    }

    [Fact]
    public void Stat_automation_names_read_label_then_value()
    {
        var stats = Project(Loaded(Sample(), Sample("00:01", 30))).Stats;

        Assert.Equal("Max Power: 250 kW", stats[0].AutomationName);
        Assert.Equal("Max Regen: -60 kW", stats[1].AutomationName);
        Assert.Equal("Avg: 12.34 kW", stats[2].AutomationName);
    }

    [Fact]
    public void Stats_are_present_even_in_empty_and_error_states()
    {
        // The projection always computes the summary; the view only renders it in the chart states. Computing
        // it unconditionally keeps the projection branch-free and lets the view decide visibility.
        Assert.Equal(3, Project(PowerProfileChartModel.Empty).Stats.Count);
        Assert.Equal(3, Project(PowerProfileChartModel.Failed()).Stats.Count);
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_aria_and_empty_message_from_the_facade()
    {
        var display = Project(Loaded(Sample(), Sample("00:01", 30)));

        Assert.Equal("Power Profile", display.Title);
        Assert.Equal("Drive power profile area chart over time", display.AriaLabel);
        Assert.Equal("No telemetry data available", display.EmptyMessage);
    }

    [Fact]
    public void Error_message_prefers_the_model_detail_then_falls_back()
    {
        Assert.Equal(
            "Couldn't load the power profile",
            Project(PowerProfileChartModel.Failed()).ErrorMessage);
        Assert.Equal(
            "You're offline",
            Project(PowerProfileChartModel.Failed("You're offline")).ErrorMessage);
    }

    // ── Freshness chip ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Freshness_chip_is_absent_when_ready()
    {
        Assert.Null(Project(Loaded(Sample(), Sample("00:01", 30))).FreshnessChip);
    }

    [Fact]
    public void Freshness_chip_labels_stale_and_offline_snapshots()
    {
        Assert.Equal(
            "Stale",
            Project(PowerProfileChartModel.StaleSnapshot([Sample(), Sample("00:01", 30)], Stats())).FreshnessChip);
        Assert.Equal(
            "Offline",
            Project(PowerProfileChartModel.OfflineSnapshot([Sample(), Sample("00:01", 30)], Stats())).FreshnessChip);
    }

    // ── Accessibility: every state exposes a descriptive Narrator name ───────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(PowerProfileChartModel.Pending),
                Project(PowerProfileChartModel.Failed()),
                Project(PowerProfileChartModel.Empty),
                Project(Loaded(Sample(), Sample("00:01", 30))),
                Project(PowerProfileChartModel.StaleSnapshot([Sample(), Sample("00:01", 30)], Stats())),
                Project(PowerProfileChartModel.OfflineSnapshot([Sample(), Sample("00:01", 30)], Stats())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_aria_label()
    {
        var display = Project(Loaded(Sample(), Sample("00:01", 30)));

        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(PowerProfileChartModel.Empty);

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Error_automation_name_carries_the_error_message()
    {
        var display = Project(PowerProfileChartModel.Failed());

        Assert.Contains(display.ErrorMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_automation_name_carries_the_freshness_chip()
    {
        var display = Project(PowerProfileChartModel.StaleSnapshot([Sample(), Sample("00:01", 30)], Stats()));

        Assert.Contains("Stale", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Null safety ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_chart_data_is_treated_as_empty()
    {
        var model = new PowerProfileChartModel(PowerProfilePhase.Ready, null!, PowerProfileStats.Zero);
        var display = Project(model);

        Assert.Equal(PowerProfileChartState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.Series.Points);
    }

    // ── Diagnostics (P1/S11): view.opened slug=PowerProfileChart, PII-safe ───────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new PowerProfileChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PowerProfileChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_power_values()
    {
        var captured = new List<string>();
        var diagnostics = new PowerProfileChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("250", line, StringComparison.Ordinal);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=PowerProfileChart", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("PowerProfileChart", PowerProfileChartRegistration.Slug);
    }

    [Fact]
    public void Registration_name_resolves_from_the_facade()
    {
        Assert.Equal("Power Profile", PowerProfileChartRegistration.Name(Localizer));
    }
}
