using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Driving;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SOCRouteChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / error / empty / ready / stale / offline), the one-decimal-rounded chartData feeding
/// both the battery-green area series and the accessible Distance / SOC % table, the reference-line
/// annotations (the min-arrival threshold plus the charge-stop matching walk), the per-state accessible names,
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/SOCRouteChart.tsx). The WinUI view itself is exercised by the app
/// build.
/// </summary>
public sealed class SOCRouteChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static RouteSocPoint Pt(double distance, double soc) => new(distance, soc);

    private static RouteChargeStop Stop(double chargeFromSoc) => new(chargeFromSoc);

    private static SOCRouteChartModel Loaded(
        RouteSocPoint[] curve,
        RouteChargeStop[]? stops = null,
        double minArrivalSoc = 20) =>
        SOCRouteChartModel.Loaded(curve, stops ?? Array.Empty<RouteChargeStop>(), minArrivalSoc);

    private static SOCRouteChartDisplay Project(SOCRouteChartModel model) =>
        SOCRouteChartProjection.Project(model, Localizer);

    private static ChartAnnotation MinArrival(SOCRouteChartDisplay display) =>
        display.Annotations.Single(a => a.Id == SOCRouteChartProjection.MinArrivalAnnotationId);

    private static IReadOnlyList<ChartAnnotation> Stops(SOCRouteChartDisplay display) =>
        display.Annotations.Where(a => a.Kind == ChartAnnotationKind.VerticalLine).ToList();

    // ── Branch precedence: phase wins (loading → error), then freshness over emptiness ───────────────

    [Fact]
    public void Loading_when_phase_is_loading()
    {
        Assert.Equal(SOCRouteChartState.Loading, Project(SOCRouteChartModel.Pending).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_samples()
    {
        var model = new SOCRouteChartModel(
            SOCRoutePhase.Loading,
            [Pt(0, 90), Pt(100, 60)],
            Array.Empty<RouteChargeStop>(),
            20);

        Assert.Equal(SOCRouteChartState.Loading, Project(model).State);
    }

    [Fact]
    public void Error_when_phase_is_error()
    {
        Assert.Equal(SOCRouteChartState.Error, Project(SOCRouteChartModel.Failed()).State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_samples()
    {
        var display = Project(SOCRouteChartModel.Empty);

        Assert.Equal(SOCRouteChartState.Empty, display.State);
        Assert.Empty(display.Rows);
        Assert.False(display.HasCurve);
    }

    [Fact]
    public void Ready_when_samples_present()
    {
        var display = Project(Loaded([Pt(0, 90), Pt(100, 60)]));

        Assert.Equal(SOCRouteChartState.Ready, display.State);
        Assert.True(display.HasCurve);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Stale_when_ready_and_stale()
    {
        var model = SOCRouteChartModel.StaleSnapshot([Pt(0, 90)], Array.Empty<RouteChargeStop>(), 20);

        Assert.Equal(SOCRouteChartState.Stale, Project(model).State);
    }

    [Fact]
    public void Offline_when_ready_and_offline()
    {
        var model = SOCRouteChartModel.OfflineSnapshot([Pt(0, 90)], Array.Empty<RouteChargeStop>(), 20);

        Assert.Equal(SOCRouteChartState.Offline, Project(model).State);
    }

    [Fact]
    public void Offline_takes_precedence_over_stale()
    {
        var model = new SOCRouteChartModel(
            SOCRoutePhase.Ready,
            [Pt(0, 90)],
            Array.Empty<RouteChargeStop>(),
            20,
            IsStale: true,
            IsOffline: true);

        Assert.Equal(SOCRouteChartState.Offline, Project(model).State);
    }

    // ── Visual-frame (container) state mapping ───────────────────────────────────────────────────────

    [Fact]
    public void Container_state_tracks_each_branch()
    {
        Assert.Equal(ChartState.Loading, Project(SOCRouteChartModel.Pending).ContainerState);
        Assert.Equal(ChartState.Error, Project(SOCRouteChartModel.Failed()).ContainerState);
        Assert.Equal(ChartState.Empty, Project(SOCRouteChartModel.Empty).ContainerState);
        Assert.Equal(ChartState.Ready, Project(Loaded([Pt(0, 90)])).ContainerState);
    }

    [Fact]
    public void Stale_with_samples_still_draws_the_chart()
    {
        var model = SOCRouteChartModel.StaleSnapshot([Pt(0, 90)], Array.Empty<RouteChargeStop>(), 20);

        Assert.Equal(ChartState.Ready, Project(model).ContainerState);
    }

    [Fact]
    public void Offline_without_a_cached_curve_falls_back_to_empty_body()
    {
        var model = new SOCRouteChartModel(
            SOCRoutePhase.Ready,
            Array.Empty<RouteSocPoint>(),
            Array.Empty<RouteChargeStop>(),
            20,
            IsOffline: true);
        var display = Project(model);

        Assert.Equal(SOCRouteChartState.Offline, display.State);
        Assert.Equal(ChartState.Empty, display.ContainerState);
        Assert.False(display.HasCurve);
    }

    // ── SOC area series (web <Area dataKey="soc" stroke="#22c55e">) ───────────────────────────────────

    [Fact]
    public void Series_is_a_battery_area_with_percent_unit_and_one_decimal()
    {
        ChartSeries series = Project(Loaded([Pt(0, 90)])).Series;

        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(ChartRole.Battery, series.Role);
        Assert.Equal("%", series.Unit);
        Assert.Equal(1, series.Decimals);
    }

    [Fact]
    public void Series_points_round_distance_and_soc_to_one_decimal()
    {
        ChartSeries series = Project(Loaded([Pt(1234.56, 87.64)])).Series;

        ChartPoint point = Assert.Single(series.Points);
        Assert.Equal(1234.6, point.X, 4); // round(1234.56, 1)
        Assert.Equal(87.6, point.Y, 4);   // round(87.64, 1)
    }

    [Fact]
    public void Series_name_resolves_from_the_facade()
    {
        Assert.Equal("SOC", Project(Loaded([Pt(0, 90)])).Series.Name);
    }

    [Fact]
    public void Empty_model_yields_a_zero_point_series()
    {
        Assert.Empty(Project(SOCRouteChartModel.Empty).Series.Points);
    }

    // ── Reference annotations: the min-arrival threshold (web red "Min N%") ──────────────────────────

    [Fact]
    public void Min_arrival_is_a_horizontal_temperature_line_at_the_threshold()
    {
        ChartAnnotation min = MinArrival(Project(Loaded([Pt(0, 90)], minArrivalSoc: 20)));

        Assert.Equal(ChartAnnotationKind.HorizontalLine, min.Kind);
        Assert.Equal(ChartRole.Temperature, min.Role);
        Assert.Equal(20, min.Value, 4);
        Assert.Equal("Min 20%", min.Label);
    }

    [Fact]
    public void Min_arrival_label_formats_a_fractional_threshold()
    {
        ChartAnnotation min = MinArrival(Project(Loaded([Pt(0, 90)], minArrivalSoc: 17.5)));

        Assert.Equal("Min 17.5%", min.Label);
    }

    [Fact]
    public void Min_arrival_is_omitted_when_threshold_is_not_finite()
    {
        var display = Project(Loaded([Pt(0, 90)], minArrivalSoc: double.NaN));

        Assert.DoesNotContain(
            display.Annotations,
            a => a.Id == SOCRouteChartProjection.MinArrivalAnnotationId);
    }

    // ── Reference annotations: charge stops (web blue "⚡ Stop N", the matching walk) ─────────────────

    [Fact]
    public void Charge_stops_anchor_to_the_first_matching_point_beyond_the_running_distance()
    {
        // Walk: stop(60) → first pt past 0 within 5% of 60 → (100,60); stop(50) → first pt past 100 within 5%
        // of 50 → (400,50). The intervening (200,30) / (300,80) are out of tolerance and skipped.
        var curve = new[] { Pt(0, 90), Pt(100, 60), Pt(200, 30), Pt(300, 80), Pt(400, 50) };
        var stops = new[] { Stop(60), Stop(50) };

        IReadOnlyList<ChartAnnotation> lines = Stops(Project(Loaded(curve, stops)));

        Assert.Equal(2, lines.Count);
        Assert.All(lines, a => Assert.Equal(ChartRole.Speed, a.Role));
        Assert.All(lines, a => Assert.Equal(ChartAnnotationKind.VerticalLine, a.Kind));
        Assert.Equal(100, lines[0].Value, 4);
        Assert.Equal("\u26A1 Stop 1", lines[0].Label);
        Assert.Equal(400, lines[1].Value, 4);
        Assert.Equal("\u26A1 Stop 2", lines[1].Label);
    }

    [Fact]
    public void Charge_stop_distance_is_rounded_to_a_whole_unit()
    {
        var curve = new[] { Pt(0, 90), Pt(150.6, 60) };
        var stops = new[] { Stop(60) };

        ChartAnnotation line = Assert.Single(Stops(Project(Loaded(curve, stops))));

        Assert.Equal(151, line.Value, 4); // round(150.6)
    }

    [Fact]
    public void Charge_stop_tolerance_is_strict_below_five_percent()
    {
        // |55 - 60| == 5 is NOT within tolerance (strict < 5), so the stop finds no anchor.
        var curve = new[] { Pt(0, 90), Pt(100, 55) };
        var stops = new[] { Stop(60) };

        Assert.Empty(Stops(Project(Loaded(curve, stops))));
    }

    [Fact]
    public void Charge_stop_requires_a_point_strictly_beyond_the_running_distance()
    {
        // The single curve point sits at distance 0; the running cumulative distance starts at 0, and the match
        // requires distance > cumulative, so the zero-distance sample cannot anchor a stop.
        var curve = new[] { Pt(0, 60) };
        var stops = new[] { Stop(60) };

        Assert.Empty(Stops(Project(Loaded(curve, stops))));
    }

    [Fact]
    public void Unmatched_charge_stops_produce_no_line()
    {
        var curve = new[] { Pt(0, 90), Pt(100, 60) };
        var stops = new[] { Stop(60), Stop(10) }; // second stop (10%) has no point within tolerance

        Assert.Single(Stops(Project(Loaded(curve, stops))));
    }

    [Fact]
    public void No_charge_stops_yields_only_the_min_arrival_line()
    {
        var display = Project(Loaded([Pt(0, 90), Pt(100, 60)]));

        Assert.Empty(Stops(display));
        Assert.Single(display.Annotations); // just the min-arrival threshold
    }

    // ── Accessible table rows (web dataColumns Distance / SOC %) ──────────────────────────────────────

    [Fact]
    public void Rows_mirror_the_rounded_chart_data()
    {
        var rows = Project(Loaded([Pt(10.25, 79.5), Pt(150.04, 80.04)])).Rows;

        Assert.Equal(2, rows.Count);
        Assert.Equal("10.3", rows[0].Distance);  // round(10.25, 1)
        Assert.Equal("79.5", rows[0].Soc);        // round(79.5, 1)
        Assert.Equal("150", rows[1].Distance);    // round(150.04, 1) → 150 (integer, no trailing zero)
        Assert.Equal("80", rows[1].Soc);          // round(80.04, 1) → 80
    }

    [Fact]
    public void Rows_have_stable_unique_keys()
    {
        var rows = Project(Loaded([Pt(0, 90), Pt(100, 70), Pt(200, 50)])).Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(rows.Count, rows.Select(r => r.RowKey).Distinct(StringComparer.Ordinal).Count());
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_and_aria_from_the_facade()
    {
        var display = Project(Loaded([Pt(0, 90)]));

        Assert.Equal("Battery Along Route", display.Title);
        Assert.Equal("Planned route battery state-of-charge area chart", display.AriaLabel);
    }

    [Fact]
    public void Resolves_axis_and_column_labels_from_the_facade()
    {
        var display = Project(Loaded([Pt(0, 90)]));

        Assert.Equal("km", display.AxisXTitle);
        Assert.Equal("SOC %", display.AxisYTitle);
        Assert.Equal("Distance", display.DistanceColumnLabel);
        Assert.Equal("SOC %", display.SocColumnLabel);
    }

    [Fact]
    public void Empty_message_uses_the_trip_planner_empty_string()
    {
        Assert.Equal("Plan a trip to see the SOC curve", Project(SOCRouteChartModel.Empty).EmptyMessage);
    }

    [Fact]
    public void Error_message_prefers_the_model_detail_then_falls_back()
    {
        Assert.Equal(
            "Couldn't load the route SOC curve",
            Project(SOCRouteChartModel.Failed()).ErrorMessage);
        Assert.Equal(
            "You're offline",
            Project(SOCRouteChartModel.Failed("You're offline")).ErrorMessage);
    }

    [Fact]
    public void Table_label_interpolates_the_title()
    {
        Assert.Equal("Battery Along Route \u2014 data table", Project(Loaded([Pt(0, 90)])).DataTableLabel);
    }

    // ── Freshness chip ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Freshness_chip_is_absent_when_ready()
    {
        Assert.Null(Project(Loaded([Pt(0, 90)])).FreshnessChip);
    }

    [Fact]
    public void Freshness_chip_labels_stale_and_offline_snapshots()
    {
        var stale = SOCRouteChartModel.StaleSnapshot([Pt(0, 90)], Array.Empty<RouteChargeStop>(), 20);
        var offline = SOCRouteChartModel.OfflineSnapshot([Pt(0, 90)], Array.Empty<RouteChargeStop>(), 20);

        Assert.Equal("Stale", Project(stale).FreshnessChip);
        Assert.Equal("Offline", Project(offline).FreshnessChip);
    }

    // ── Accessibility: every state exposes a descriptive Narrator name ───────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        var stale = SOCRouteChartModel.StaleSnapshot([Pt(0, 90)], Array.Empty<RouteChargeStop>(), 20);
        var offline = SOCRouteChartModel.OfflineSnapshot([Pt(0, 90)], Array.Empty<RouteChargeStop>(), 20);

        Assert.All(
            new[]
            {
                Project(SOCRouteChartModel.Pending),
                Project(SOCRouteChartModel.Failed()),
                Project(SOCRouteChartModel.Empty),
                Project(Loaded([Pt(0, 90)])),
                Project(stale),
                Project(offline),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_aria_label()
    {
        var display = Project(Loaded([Pt(0, 90)]));

        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(SOCRouteChartModel.Empty);

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Error_automation_name_carries_the_error_message()
    {
        var display = Project(SOCRouteChartModel.Failed());

        Assert.Contains(display.ErrorMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_automation_name_carries_the_freshness_chip()
    {
        var model = SOCRouteChartModel.StaleSnapshot([Pt(0, 90)], Array.Empty<RouteChargeStop>(), 20);
        var display = Project(model);

        Assert.Contains("Stale", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Null safety ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_curve_and_stops_are_treated_as_empty()
    {
        var model = new SOCRouteChartModel(SOCRoutePhase.Ready, null!, null!, 20);
        var display = Project(model);

        Assert.Equal(SOCRouteChartState.Empty, display.State);
        Assert.Empty(display.Rows);
        Assert.Empty(display.Series.Points);
        Assert.Empty(Stops(display));
    }

    // ── Diagnostics (P1/S11): view.opened slug=SOCRouteChart, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SOCRouteChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SOCRouteChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_route_data()
    {
        var captured = new List<string>();
        var diagnostics = new SOCRouteChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("90", line, StringComparison.Ordinal);
        Assert.DoesNotContain("100", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=SOCRouteChart", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("SOCRouteChart", SOCRouteChartRegistration.Slug);
    }
}
