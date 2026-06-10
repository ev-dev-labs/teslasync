using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Driving;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SocChart</c> feature surface's UI-thread-free logic — the branch projection
/// (loading / error / empty / ready / stale / offline), the web <c>chartData.length &gt; 1</c> draw gate, the
/// single emerald battery-green area series feeding the SOC-over-time trace (ordinal X, raw un-rounded battery
/// percent on Y, the pre-formatted time string carried as each point's label, the "%" unit), the resolved
/// chrome / per-state labels, the freshness chip, the per-state accessible names and the PII-safe diagnostics.
/// Mirrors the web spec (<c>web/src/features/driving/components/drive-detail/SocChart.tsx</c>). The WinUI view
/// itself is exercised by the app build.
/// </summary>
public sealed class SocChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SocSample Sample(string time, double battery) => new(time, battery);

    private static SocChartModel Loaded(params SocSample[] samples) => SocChartModel.Loaded(samples);

    private static SocChartDisplay Project(SocChartModel model) => SocChartProjection.Project(model, Localizer);

    private static SocSample[] Trace() => new[] { Sample("10:00", 90), Sample("10:05", 84) };

    // ── Branch precedence: phase wins (loading → error), then freshness over emptiness ───────────────

    [Fact]
    public void Loading_when_phase_is_loading()
    {
        Assert.Equal(SocChartState.Loading, Project(SocChartModel.Pending).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_samples()
    {
        var model = new SocChartModel(SocChartPhase.Loading, Trace());

        Assert.Equal(SocChartState.Loading, Project(model).State);
    }

    [Fact]
    public void Error_when_phase_is_error()
    {
        Assert.Equal(SocChartState.Error, Project(SocChartModel.Failed()).State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_samples()
    {
        var display = Project(SocChartModel.Empty);

        Assert.Equal(SocChartState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.Series.Points);
    }

    [Fact]
    public void Ready_when_two_or_more_samples()
    {
        var display = Project(Loaded(Trace()));

        Assert.Equal(SocChartState.Ready, display.State);
        Assert.True(display.HasData);
    }

    [Fact]
    public void Stale_when_ready_and_stale()
    {
        Assert.Equal(SocChartState.Stale, Project(SocChartModel.StaleSnapshot(Trace())).State);
    }

    [Fact]
    public void Offline_when_ready_and_offline()
    {
        Assert.Equal(SocChartState.Offline, Project(SocChartModel.OfflineSnapshot(Trace())).State);
    }

    [Fact]
    public void Offline_takes_precedence_over_stale()
    {
        var model = new SocChartModel(SocChartPhase.Ready, Trace(), IsStale: true, IsOffline: true);

        Assert.Equal(SocChartState.Offline, Project(model).State);
    }

    // ── Web draw gate: chartData.length > 1 (fewer than two samples render the empty surface) ─────────

    [Fact]
    public void Zero_samples_render_empty()
    {
        Assert.Equal(SocChartState.Empty, Project(Loaded()).State);
    }

    [Fact]
    public void One_sample_renders_empty_per_the_web_length_gate()
    {
        // Web parity: `chartData.length > 1` — a single sample cannot draw a trace, so the empty surface shows.
        var display = Project(Loaded(Sample("10:00", 90)));

        Assert.Equal(SocChartState.Empty, display.State);
        Assert.False(display.HasData);
    }

    [Fact]
    public void Two_samples_clear_the_draw_gate()
    {
        var display = Project(Loaded(Sample("10:00", 90), Sample("10:05", 88)));

        Assert.Equal(SocChartState.Ready, display.State);
        Assert.True(display.HasData);
    }

    [Fact]
    public void One_sample_while_stale_keeps_the_stale_state_but_empty_body()
    {
        // The freshness chip survives an under-gated snapshot; the chart body still falls back to empty.
        var display = Project(SocChartModel.StaleSnapshot(new[] { Sample("10:00", 90) }));

        Assert.Equal(SocChartState.Stale, display.State);
        Assert.Equal(ChartState.Empty, display.ContainerState);
        Assert.False(display.HasData);
        Assert.Equal("Stale", display.FreshnessChip);
    }

    // ── Visual-frame (container) state mapping ───────────────────────────────────────────────────────

    [Fact]
    public void Container_state_tracks_each_branch()
    {
        Assert.Equal(ChartState.Loading, Project(SocChartModel.Pending).ContainerState);
        Assert.Equal(ChartState.Error, Project(SocChartModel.Failed()).ContainerState);
        Assert.Equal(ChartState.Empty, Project(SocChartModel.Empty).ContainerState);
        Assert.Equal(ChartState.Ready, Project(Loaded(Trace())).ContainerState);
    }

    [Fact]
    public void Stale_with_samples_still_draws_the_chart()
    {
        Assert.Equal(ChartState.Ready, Project(SocChartModel.StaleSnapshot(Trace())).ContainerState);
    }

    [Fact]
    public void Offline_without_a_cached_trace_falls_back_to_empty_body()
    {
        var model = new SocChartModel(SocChartPhase.Ready, Array.Empty<SocSample>(), IsOffline: true);
        var display = Project(model);

        Assert.Equal(SocChartState.Offline, display.State);
        Assert.Equal(ChartState.Empty, display.ContainerState);
        Assert.False(display.HasData);
    }

    // ── SOC area series (web <Area dataKey="battery" stroke="#10b981">) ───────────────────────────────

    [Fact]
    public void Series_is_a_battery_area_with_percent_unit_and_no_decimals()
    {
        ChartSeries series = Project(Loaded(Trace())).Series;

        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(ChartRole.Battery, series.Role);
        Assert.Equal("%", series.Unit);
        Assert.Equal(0, series.Decimals);
    }

    [Fact]
    public void Series_name_is_soc_with_a_percent_suffix()
    {
        // Web parity: `name={`${t('driveDetail.soc')} %`}` → "SOC %".
        Assert.Equal("SOC %", Project(Loaded(Trace())).SeriesName);
        Assert.Equal("SOC %", Project(Loaded(Trace())).Series.Name);
    }

    [Fact]
    public void Series_points_carry_ordinal_x_battery_y_and_the_time_label()
    {
        ChartSeries series = Project(Loaded(Sample("10:00", 90), Sample("10:05", 84), Sample("10:10", 80))).Series;

        Assert.Equal(3, series.Points.Count);
        Assert.Equal(0, series.Points[0].X);
        Assert.Equal(90, series.Points[0].Y);
        Assert.Equal("10:00", series.Points[0].Label);
        Assert.Equal(1, series.Points[1].X);
        Assert.Equal("10:05", series.Points[1].Label);
        Assert.Equal(2, series.Points[2].X);
        Assert.Equal(80, series.Points[2].Y);
        Assert.Equal("10:10", series.Points[2].Label);
    }

    [Fact]
    public void Battery_values_are_not_rounded()
    {
        // Web parity: SocChart passes `tp.batteryLevel ?? 0` straight through — no rounding.
        ChartSeries series = Project(Loaded(Sample("10:00", 87.6), Sample("10:05", 84.25))).Series;

        Assert.Equal(87.6, series.Points[0].Y, 4);
        Assert.Equal(84.25, series.Points[1].Y, 4);
    }

    [Fact]
    public void Series_points_mirror_every_sample_even_below_the_draw_gate()
    {
        // The series is built from all samples; the gate only governs which surface renders.
        Assert.Single(Project(Loaded(Sample("10:00", 90))).Series.Points);
        Assert.Empty(Project(SocChartModel.Empty).Series.Points);
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_and_aria_from_the_facade()
    {
        var display = Project(Loaded(Trace()));

        Assert.Equal("SOC % Over Time", display.Title);
        Assert.Equal("State of charge percent over time area chart", display.AriaLabel);
    }

    [Fact]
    public void Empty_message_uses_the_no_telemetry_string()
    {
        Assert.Equal("No telemetry data available", Project(SocChartModel.Empty).EmptyMessage);
    }

    [Fact]
    public void Error_message_prefers_the_model_detail_then_falls_back()
    {
        Assert.Equal("SOC chart failed to load", Project(SocChartModel.Failed()).ErrorMessage);
        Assert.Equal("You're offline", Project(SocChartModel.Failed("You're offline")).ErrorMessage);
    }

    [Fact]
    public void Loading_and_retry_labels_resolve_from_the_shared_facade()
    {
        var display = Project(SocChartModel.Failed());

        Assert.Equal("Loading", display.LoadingMessage);
        Assert.Equal("Retry", display.RetryLabel);
    }

    // ── Freshness chip ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Freshness_chip_is_absent_when_ready()
    {
        Assert.Null(Project(Loaded(Trace())).FreshnessChip);
    }

    [Fact]
    public void Freshness_chip_is_absent_in_loading_error_and_empty()
    {
        Assert.Null(Project(SocChartModel.Pending).FreshnessChip);
        Assert.Null(Project(SocChartModel.Failed()).FreshnessChip);
        Assert.Null(Project(SocChartModel.Empty).FreshnessChip);
    }

    [Fact]
    public void Freshness_chip_labels_stale_and_offline_snapshots()
    {
        Assert.Equal("Stale", Project(SocChartModel.StaleSnapshot(Trace())).FreshnessChip);
        Assert.Equal("Offline", Project(SocChartModel.OfflineSnapshot(Trace())).FreshnessChip);
    }

    // ── Accessibility: every state exposes a descriptive Narrator name ───────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(SocChartModel.Pending),
                Project(SocChartModel.Failed()),
                Project(SocChartModel.Empty),
                Project(Loaded(Trace())),
                Project(SocChartModel.StaleSnapshot(Trace())),
                Project(SocChartModel.OfflineSnapshot(Trace())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_aria_label()
    {
        var display = Project(Loaded(Trace()));

        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(SocChartModel.Empty);

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Error_automation_name_carries_the_error_message()
    {
        var display = Project(SocChartModel.Failed());

        Assert.Contains(display.ErrorMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Loading_automation_name_carries_the_loading_message()
    {
        var display = Project(SocChartModel.Pending);

        Assert.Contains(display.LoadingMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_automation_name_carries_the_freshness_chip_and_aria()
    {
        var display = Project(SocChartModel.StaleSnapshot(Trace()));

        Assert.Contains("Stale", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Offline_automation_name_carries_the_freshness_chip_and_aria()
    {
        var display = Project(SocChartModel.OfflineSnapshot(Trace()));

        Assert.Contains("Offline", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Null safety ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_samples_are_treated_as_empty()
    {
        var model = new SocChartModel(SocChartPhase.Ready, null!);
        var display = Project(model);

        Assert.Equal(SocChartState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.Series.Points);
    }

    // ── Diagnostics (P1/S11): view.opened slug=SocChart, PII-safe ────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SocChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SocChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_telemetry()
    {
        var captured = new List<string>();
        var diagnostics = new SocChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("90", line, StringComparison.Ordinal);
        Assert.DoesNotContain("10:00", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=SocChart", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("SocChart", SocChartRegistration.Slug);
    }
}
