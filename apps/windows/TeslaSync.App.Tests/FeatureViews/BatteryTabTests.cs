using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>BatteryTab</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the five hero-metric formatters (the web
/// <c>fmtNumber</c>/<c>fmtInt</c>, the kWh-pinned <c>formatEnergy</c>, and the <c>convertDistanceFromSI</c>
/// range conversion), the four chart series (web <c>dataKey</c>s + <c>CHART_COLORS</c> indices + ordinal X),
/// the accent-rail token keys, the accessible names and the diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/analytics/BatteryTab.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class BatteryTabTests
{
    private const string Percent = "%";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static BatteryTrendPoint Pt(
        string date = "2026-06-08",
        double health = 95.5,
        double capacityWh = 74000,
        double degradation = 3.25,
        double rangeKm = 400,
        double cycles = 1250) =>
        new(date, health, capacityWh, degradation, rangeKm, cycles);

    private static BatteryTabModel Loaded(params BatteryTrendPoint[] points) => new(false, points);

    private static BatteryTabModel Loading(params BatteryTrendPoint[] points) => new(true, points);

    private static BatteryTabDisplay Project(BatteryTabModel model, UnitPref? units = null) =>
        BatteryTabProjection.Project(model, Localizer, units ?? UnitPref.Metric);

    // ── Branch precedence: loading → empty → ready (web source order) ────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading()
    {
        Assert.Equal(BatteryTabState.Loading, Project(Loading()).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_trend()
    {
        // Web checks the parent's loading state before the data branch, so loading wins even with cached rows.
        Assert.Equal(BatteryTabState.Loading, Project(Loading(Pt(), Pt())).State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_trend()
    {
        var display = Project(Loaded());

        Assert.Equal(BatteryTabState.Empty, display.State);
        Assert.Empty(display.Metrics);
        Assert.Empty(display.Charts);
    }

    [Fact]
    public void Ready_when_trend_present()
    {
        var display = Project(Loaded(Pt()));

        Assert.Equal(BatteryTabState.Ready, display.State);
        Assert.Equal(5, display.Metrics.Count);
        Assert.Equal(4, display.Charts.Count);
    }

    [Fact]
    public void Pending_model_is_loading()
    {
        Assert.Equal(BatteryTabState.Loading, Project(BatteryTabModel.Pending).State);
    }

    [Fact]
    public void Empty_static_model_is_empty()
    {
        Assert.Equal(BatteryTabState.Empty, Project(BatteryTabModel.Empty).State);
    }

    // ── Hero metrics read from the LAST trend sample (web `latest`) ──────────────────────────────────

    [Fact]
    public void Metrics_are_computed_from_the_last_trend_sample()
    {
        var display = Project(Loaded(
            Pt(health: 10, capacityWh: 10, degradation: 10, rangeKm: 10, cycles: 10),
            Pt(health: 95.5, capacityWh: 74000, degradation: 3.25, rangeKm: 400, cycles: 1250)));

        Assert.Equal("95.5", display.Metrics[0].Value);
        Assert.Equal("74.0 kWh", display.Metrics[1].Value);
        Assert.Equal("3.25", display.Metrics[2].Value);
        Assert.Equal("400", display.Metrics[3].Value);
        Assert.Equal("1,250", display.Metrics[4].Value);
    }

    [Fact]
    public void Metric_labels_resolve_from_the_facade()
    {
        var metrics = Project(Loaded(Pt())).Metrics;

        Assert.Equal("Health Score", metrics[0].Label);
        Assert.Equal("Capacity", metrics[1].Label);
        Assert.Equal("Degradation", metrics[2].Label);
        Assert.Equal("Est. Range", metrics[3].Label);
        Assert.Equal("Cycles", metrics[4].Label);
    }

    [Fact]
    public void Health_score_renders_one_decimal_with_percent_subtitle()
    {
        var health = Project(Loaded(Pt(health: 98.27))).Metrics[0];

        Assert.Equal("98.3", health.Value);
        Assert.Equal(Percent, health.Subtitle);
    }

    [Fact]
    public void Degradation_renders_two_decimals_with_percent_subtitle()
    {
        var degradation = Project(Loaded(Pt(degradation: 2.5))).Metrics[2];

        Assert.Equal("2.50", degradation.Value);
        Assert.Equal(Percent, degradation.Subtitle);
    }

    [Fact]
    public void Cycles_render_grouped_integer_with_no_subtitle()
    {
        var cycles = Project(Loaded(Pt(cycles: 1234567))).Metrics[4];

        Assert.Equal("1,234,567", cycles.Value);
        Assert.Equal(string.Empty, cycles.Subtitle);
    }

    [Fact]
    public void Capacity_is_always_kwh_even_with_a_watt_hour_default_pref()
    {
        // Web `useUnits` pins energy display to kWh (DEFAULT_ENERGY_PREF), so a Wh-default pref still shows kWh.
        var metricCapacity = Project(Loaded(Pt(capacityWh: 74000)), UnitPref.Metric).Metrics[1];

        Assert.Equal("74.0 kWh", metricCapacity.Value);
        Assert.Equal(string.Empty, metricCapacity.Subtitle);
    }

    // ── Range conversion through the SI display boundary (web fromKm = convertDistanceFromSI(km*1000)) ─

    [Fact]
    public void Range_metric_is_kilometres_under_the_metric_pref()
    {
        var range = Project(Loaded(Pt(rangeKm: 400)), UnitPref.Metric).Metrics[3];

        Assert.Equal("400", range.Value);
        Assert.Equal("km", range.Subtitle);
    }

    [Fact]
    public void Range_metric_converts_to_miles_under_the_imperial_pref()
    {
        // 400 km → 400000 m / 1609.344 = 248.55 mi → fmtNumber(.., 0) = "249".
        var range = Project(Loaded(Pt(rangeKm: 400)), UnitPref.Imperial).Metrics[3];

        Assert.Equal("249", range.Value);
        Assert.Equal("mi", range.Subtitle);
    }

    // ── safe(): non-finite values coerce to 0 before formatting (web `safe`) ─────────────────────────

    [Fact]
    public void Non_finite_metric_values_coerce_to_zero()
    {
        var metrics = Project(Loaded(Pt(
            health: double.NaN,
            capacityWh: double.PositiveInfinity,
            degradation: double.NegativeInfinity,
            rangeKm: double.NaN,
            cycles: double.NaN))).Metrics;

        Assert.Equal("0.0", metrics[0].Value);
        Assert.Equal("0.0 kWh", metrics[1].Value);
        Assert.Equal("0.00", metrics[2].Value);
        Assert.Equal("0", metrics[3].Value);
        Assert.Equal("0", metrics[4].Value);
    }

    // ── Accent rails map the web MetricCard colors onto token brush keys ─────────────────────────────

    [Fact]
    public void Metric_accent_rails_map_the_web_colors()
    {
        var metrics = Project(Loaded(Pt())).Metrics;

        Assert.Equal(BatteryTabProjection.AccentHealth, metrics[0].AccentBrushKey);
        Assert.Equal(BatteryTabProjection.AccentCapacity, metrics[1].AccentBrushKey);
        Assert.Equal(BatteryTabProjection.AccentDegradation, metrics[2].AccentBrushKey);
        Assert.Equal(BatteryTabProjection.AccentRange, metrics[3].AccentBrushKey);
        Assert.Equal(BatteryTabProjection.AccentCycles, metrics[4].AccentBrushKey);
    }

    // ── Charts: titles, kinds, series count, palette indices, ordinal X (web dataKeys / CHART_COLORS) ─

    [Fact]
    public void Four_chart_panels_with_the_web_titles_and_kinds()
    {
        var charts = Project(Loaded(Pt(), Pt())).Charts;

        Assert.Collection(
            charts,
            c => Assert.Equal(("Health Score Timeline", BatteryChartKind.Area), (c.Title, c.Kind)),
            c => Assert.Equal(("Capacity Trend", BatteryChartKind.Line), (c.Title, c.Kind)),
            c => Assert.Equal(("Range Trend", BatteryChartKind.Line), (c.Title, c.Kind)),
            c => Assert.Equal(("Degradation & Cycles", BatteryChartKind.Composed), (c.Title, c.Kind)));
    }

    [Fact]
    public void Single_series_panels_carry_the_web_color_indices_and_kinds()
    {
        var charts = Project(Loaded(Pt())).Charts;

        var health = Assert.Single(charts[0].Series);
        Assert.Equal(BatteryTabProjection.ColorHealth, health.ColorIndex);
        Assert.Equal(ChartSeriesKind.Area, health.Kind);

        var capacity = Assert.Single(charts[1].Series);
        Assert.Equal(BatteryTabProjection.ColorCapacity, capacity.ColorIndex);
        Assert.Equal(ChartSeriesKind.Line, capacity.Kind);

        var range = Assert.Single(charts[2].Series);
        Assert.Equal(BatteryTabProjection.ColorRange, range.ColorIndex);
        Assert.Equal(ChartSeriesKind.Line, range.Kind);
    }

    [Fact]
    public void Composed_panel_pairs_a_degradation_area_with_a_cycle_count_line()
    {
        var composed = Project(Loaded(Pt())).Charts[3];

        Assert.Equal(2, composed.Series.Count);

        Assert.Equal("Degradation %", composed.Series[0].Name);
        Assert.Equal(BatteryTabProjection.ColorDegradation, composed.Series[0].ColorIndex);
        Assert.Equal(ChartSeriesKind.Area, composed.Series[0].Kind);

        Assert.Equal("Cycle Count", composed.Series[1].Name);
        Assert.Equal(BatteryTabProjection.ColorCycles, composed.Series[1].ColorIndex);
        Assert.Equal(ChartSeriesKind.Line, composed.Series[1].Kind);
    }

    [Fact]
    public void Chart_x_is_the_ordinal_sample_index_with_dated_point_labels()
    {
        var health = Project(Loaded(
            Pt(date: "2026-06-06", health: 80),
            Pt(date: "2026-06-07", health: 90),
            Pt(date: "2026-06-08", health: 100))).Charts[0].Series[0];

        Assert.Collection(
            health.Points,
            p => Assert.Equal((0.0, 80.0, "2026-06-06"), (p.X, p.Y, p.Label)),
            p => Assert.Equal((1.0, 90.0, "2026-06-07"), (p.X, p.Y, p.Label)),
            p => Assert.Equal((2.0, 100.0, "2026-06-08"), (p.X, p.Y, p.Label)));
    }

    [Fact]
    public void Capacity_chart_plots_raw_watt_hours_unconverted()
    {
        // Web capacity chart dataKey="capacity_wh" plots the raw SI value (the kWh conversion is card-only).
        var capacity = Project(Loaded(Pt(capacityWh: 74000))).Charts[1].Series[0];

        Assert.Equal(74000.0, Assert.Single(capacity.Points).Y);
    }

    [Fact]
    public void Range_chart_series_converts_and_labels_its_unit()
    {
        var metric = Project(Loaded(Pt(rangeKm: 400)), UnitPref.Metric).Charts[2].Series[0];
        Assert.Equal("Range (km)", metric.Name);
        Assert.Equal(400.0, Assert.Single(metric.Points).Y, 3);

        var imperial = Project(Loaded(Pt(rangeKm: 400)), UnitPref.Imperial).Charts[2].Series[0];
        Assert.Equal("Range (mi)", imperial.Name);
        Assert.Equal(248.548, Assert.Single(imperial.Points).Y, 3);
    }

    [Fact]
    public void Every_chart_series_has_one_point_per_trend_sample()
    {
        var charts = Project(Loaded(Pt(), Pt(), Pt(), Pt())).Charts;

        foreach (var chart in charts)
        {
            foreach (var series in chart.Series)
            {
                Assert.Equal(4, series.Points.Count);
            }
        }
    }

    // ── Section titles + the Range series unit suffix resolve from the facade ────────────────────────

    [Fact]
    public void Chart_titles_resolve_from_the_facade()
    {
        var charts = Project(Loaded(Pt())).Charts;

        Assert.Equal("Health Score Timeline", charts[0].Title);
        Assert.Equal("Capacity Trend", charts[1].Title);
        Assert.Equal("Range Trend", charts[2].Title);
        Assert.Equal("Degradation & Cycles", charts[3].Title);
    }

    // ── Accessibility: every state + region exposes a non-empty Narrator name ────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[] { Project(Loading()), Project(Loaded()), Project(Loaded(Pt())) },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(Loaded());

        Assert.Equal("No battery trend data available", display.EmptyMessage);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Loading_automation_name_carries_the_loading_label()
    {
        var display = Project(Loading());

        Assert.Contains(display.LoadingLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_is_the_surface_label()
    {
        var display = Project(Loaded(Pt()));

        Assert.Equal("Battery", display.SurfaceName);
        Assert.Equal(display.SurfaceName, display.AutomationName);
    }

    [Fact]
    public void Each_metric_exposes_a_descriptive_automation_name()
    {
        var metrics = Project(Loaded(Pt(health: 95.5, rangeKm: 400)), UnitPref.Metric).Metrics;

        Assert.Equal("Health Score: 95.5 %", metrics[0].AutomationName);
        Assert.Equal("Est. Range: 400 km", metrics[3].AutomationName);
        Assert.DoesNotContain(" %", metrics[1].AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_chart_panel_exposes_a_descriptive_accessible_summary()
    {
        var charts = Project(Loaded(Pt(), Pt())).Charts;

        Assert.All(charts, chart =>
        {
            Assert.False(string.IsNullOrWhiteSpace(chart.AccessibleSummary));
            Assert.Contains(chart.Title, chart.AccessibleSummary, StringComparison.Ordinal);
            Assert.False(string.IsNullOrWhiteSpace(chart.AutomationName));
        });
    }

    // ── Diagnostics (P1/S11): view.opened slug=BatteryTab, PII-safe ──────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new BatteryTabDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryTab", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_trend_values()
    {
        var captured = new List<string>();
        var diagnostics = new BatteryTabDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=BatteryTab", line);
        Assert.DoesNotContain("74", line, StringComparison.Ordinal);
        Assert.DoesNotContain("400", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("BatteryTab", BatteryTabRegistration.Slug);
    }
}
