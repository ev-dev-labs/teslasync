using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Charging;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SessionCurveChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / error / empty / ready / stale / offline), the single accent area series (raw
/// samples, " kW" unit, one-decimal tooltip), the accessible SOC % / Power (kW) table (column keys, row
/// formatting, half-away-from-zero power rounding), the per-state accessible names, and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-curve/SessionCurveChart.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class SessionCurveChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static CurvePoint Pt(double soc = 80, double power = 45) => new(soc, power);

    private static SessionCurveChartModel Loaded(params CurvePoint[] curve) =>
        SessionCurveChartModel.Loaded(curve);

    private static SessionCurveChartDisplay Project(SessionCurveChartModel model) =>
        SessionCurveChartProjection.Project(model, Localizer);

    // ── Branch precedence: phase wins (loading → error), then freshness over emptiness ───────────────

    [Fact]
    public void Loading_when_phase_is_loading()
    {
        Assert.Equal(SessionCurveChartState.Loading, Project(SessionCurveChartModel.Pending).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_samples()
    {
        var model = new SessionCurveChartModel(SessionCurvePhase.Loading, [Pt(), Pt(soc: 81)]);

        Assert.Equal(SessionCurveChartState.Loading, Project(model).State);
    }

    [Fact]
    public void Error_when_phase_is_error()
    {
        Assert.Equal(SessionCurveChartState.Error, Project(SessionCurveChartModel.Failed()).State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_samples()
    {
        var display = Project(SessionCurveChartModel.Empty);

        Assert.Equal(SessionCurveChartState.Empty, display.State);
        Assert.Empty(display.Rows);
        Assert.False(display.HasCurve);
    }

    [Fact]
    public void Ready_when_samples_present()
    {
        var display = Project(Loaded(Pt(), Pt(soc: 90, power: 30)));

        Assert.Equal(SessionCurveChartState.Ready, display.State);
        Assert.True(display.HasCurve);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Stale_when_ready_and_stale()
    {
        Assert.Equal(
            SessionCurveChartState.Stale,
            Project(SessionCurveChartModel.StaleSnapshot([Pt()])).State);
    }

    [Fact]
    public void Offline_when_ready_and_offline()
    {
        Assert.Equal(
            SessionCurveChartState.Offline,
            Project(SessionCurveChartModel.OfflineSnapshot([Pt()])).State);
    }

    [Fact]
    public void Offline_takes_precedence_over_stale()
    {
        var model = new SessionCurveChartModel(SessionCurvePhase.Ready, [Pt()], IsStale: true, IsOffline: true);

        Assert.Equal(SessionCurveChartState.Offline, Project(model).State);
    }

    // ── Visual-frame (container) state mapping ───────────────────────────────────────────────────────

    [Fact]
    public void Container_state_tracks_each_branch()
    {
        Assert.Equal(ChartState.Loading, Project(SessionCurveChartModel.Pending).ContainerState);
        Assert.Equal(ChartState.Error, Project(SessionCurveChartModel.Failed()).ContainerState);
        Assert.Equal(ChartState.Empty, Project(SessionCurveChartModel.Empty).ContainerState);
        Assert.Equal(ChartState.Ready, Project(Loaded(Pt())).ContainerState);
    }

    [Fact]
    public void Stale_with_samples_still_draws_the_chart()
    {
        Assert.Equal(ChartState.Ready, Project(SessionCurveChartModel.StaleSnapshot([Pt()])).ContainerState);
    }

    [Fact]
    public void Offline_without_a_cached_curve_falls_back_to_empty_body()
    {
        var model = new SessionCurveChartModel(SessionCurvePhase.Ready, [], IsOffline: true);
        var display = Project(model);

        Assert.Equal(SessionCurveChartState.Offline, display.State);
        Assert.Equal(ChartState.Empty, display.ContainerState);
        Assert.False(display.HasCurve);
    }

    // ── Area series (web <Area> with CHART_COLORS[0]) ────────────────────────────────────────────────

    [Fact]
    public void Series_is_an_area_in_the_first_palette_slot()
    {
        ChartSeries series = Project(Loaded(Pt())).Series;

        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(0, series.ColorIndex);
    }

    [Fact]
    public void Series_carries_raw_samples_kw_unit_and_one_decimal()
    {
        ChartSeries series = Project(Loaded(new CurvePoint(80, 45.06))).Series;

        ChartPoint point = Assert.Single(series.Points);
        Assert.Equal(80, point.X);
        Assert.Equal(45.06, point.Y); // raw — the curve is not pre-rounded (web feeds raw curveData)
        Assert.Equal("kW", series.Unit);
        Assert.Equal(1, series.Decimals);
    }

    [Fact]
    public void Series_name_resolves_from_the_facade()
    {
        Assert.Equal("Power", Project(Loaded(Pt())).Series.Name);
    }

    [Fact]
    public void Empty_model_yields_a_zero_point_series()
    {
        Assert.Empty(Project(SessionCurveChartModel.Empty).Series.Points);
    }

    // ── Accessible table rows (web dataColumns SOC % / Power (kW)) ────────────────────────────────────

    [Fact]
    public void Row_power_is_rounded_to_one_decimal_half_away_from_zero()
    {
        var rows = Project(Loaded(new CurvePoint(50, 45.25), new CurvePoint(60, 45.04))).Rows;

        Assert.Equal("45.3", rows[0].Power);
        Assert.Equal("45.0", rows[1].Power);
    }

    [Fact]
    public void Row_soc_uses_its_natural_precision()
    {
        var rows = Project(Loaded(new CurvePoint(80, 45), new CurvePoint(79.5, 40))).Rows;

        Assert.Equal("80", rows[0].Soc);
        Assert.Equal("79.5", rows[1].Soc);
    }

    [Fact]
    public void Rows_have_stable_unique_keys()
    {
        var rows = Project(Loaded(Pt(soc: 80), Pt(soc: 85), Pt(soc: 90))).Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(rows.Count, rows.Select(r => r.RowKey).Distinct(StringComparer.Ordinal).Count());
    }

    // ── Resolved labels (i18n facade fallbacks) ─────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_subtitle_and_aria_from_the_facade()
    {
        var display = Project(Loaded(Pt()));

        Assert.Equal("Power vs SOC", display.Title);
        Assert.Equal("Charging power curve for selected session", display.Subtitle);
        Assert.Equal(
            "Charging power versus state-of-charge area chart for the selected session",
            display.AriaLabel);
    }

    [Fact]
    public void Resolves_axis_and_column_labels_from_the_facade()
    {
        var display = Project(Loaded(Pt()));

        Assert.Equal("SOC (%)", display.AxisXTitle);
        Assert.Equal("Power (kW)", display.AxisYTitle);
        Assert.Equal("SOC %", display.SocColumnLabel);
        Assert.Equal("Power (kW)", display.PowerColumnLabel);
    }

    [Fact]
    public void Empty_message_uses_the_shared_chart_no_data_string()
    {
        Assert.Equal("No data available", Project(SessionCurveChartModel.Empty).EmptyMessage);
    }

    [Fact]
    public void Error_message_prefers_the_model_detail_then_falls_back()
    {
        Assert.Equal(
            "Couldn't load the charging curve",
            Project(SessionCurveChartModel.Failed()).ErrorMessage);
        Assert.Equal(
            "You're offline",
            Project(SessionCurveChartModel.Failed("You're offline")).ErrorMessage);
    }

    [Fact]
    public void Table_label_interpolates_the_title()
    {
        Assert.Equal("Power vs SOC \u2014 data table", Project(Loaded(Pt())).DataTableLabel);
    }

    // ── Freshness chip ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Freshness_chip_is_absent_when_ready()
    {
        Assert.Null(Project(Loaded(Pt())).FreshnessChip);
    }

    [Fact]
    public void Freshness_chip_labels_stale_and_offline_snapshots()
    {
        Assert.Equal("Stale", Project(SessionCurveChartModel.StaleSnapshot([Pt()])).FreshnessChip);
        Assert.Equal("Offline", Project(SessionCurveChartModel.OfflineSnapshot([Pt()])).FreshnessChip);
    }

    // ── Accessibility: every state exposes a descriptive Narrator name ───────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(SessionCurveChartModel.Pending),
                Project(SessionCurveChartModel.Failed()),
                Project(SessionCurveChartModel.Empty),
                Project(Loaded(Pt())),
                Project(SessionCurveChartModel.StaleSnapshot([Pt()])),
                Project(SessionCurveChartModel.OfflineSnapshot([Pt()])),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_aria_label()
    {
        var display = Project(Loaded(Pt()));

        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(SessionCurveChartModel.Empty);

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Error_automation_name_carries_the_error_message()
    {
        var display = Project(SessionCurveChartModel.Failed());

        Assert.Contains(display.ErrorMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_automation_name_carries_the_freshness_chip()
    {
        var display = Project(SessionCurveChartModel.StaleSnapshot([Pt()]));

        Assert.Contains("Stale", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Null safety ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_curve_data_is_treated_as_empty()
    {
        var model = new SessionCurveChartModel(SessionCurvePhase.Ready, null!);
        var display = Project(model);

        Assert.Equal(SessionCurveChartState.Empty, display.State);
        Assert.Empty(display.Rows);
        Assert.Empty(display.Series.Points);
    }

    // ── Diagnostics (P1/S11): view.opened slug=SessionCurveChart, PII-safe ───────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SessionCurveChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SessionCurveChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_curve_data()
    {
        var captured = new List<string>();
        var diagnostics = new SessionCurveChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("45", line, StringComparison.Ordinal);
        Assert.DoesNotContain("80", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=SessionCurveChart", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("SessionCurveChart", SessionCurveChartRegistration.Slug);
    }
}
