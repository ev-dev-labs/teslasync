using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MotorEfficiencyInsights</c> feature surface's UI-thread-free logic — the
/// <c>computeMotorStats</c> data adapter, the per-state branch projection (loading / error / empty / stale /
/// offline / ready), the web throttle / thermal thresholds, the SI → display temperature conversion (with the
/// degree-suffix regression guard), the value formatting, the freshness chip copy, the accessible names, and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx + helpers.ts and its
/// __tests__). The WinUI view itself (MotorEfficiencyInsights.cs) is exercised by the app build.
/// </summary>
public sealed class MotorEfficiencyInsightsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private const string DegreeC = "\u00B0C";
    private const string DegreeF = "\u00B0F";

    // Mirrors the web __tests__ baseStats (avg torque 50, max torque 200, avg/max motor temp 49/64, high-torque 10%).
    private static MotorEfficiencyStats BaseStats(double avgPowerKw = 0) => new(
        TotalReadings: 100,
        AvgTorqueNm: 50,
        MaxTorqueNm: 200,
        AvgMotorTempCelsius: 49,
        MaxMotorTempCelsius: 64,
        AvgPowerKw: avgPowerKw,
        PeakPowerKw: 0,
        MinPowerKw: 0,
        PeakRegenKw: 0,
        HighTorquePct: 10);

    private static MotorEfficiencyInsightsDisplay Project(MotorEfficiencyInsightsModel model) =>
        MotorEfficiencyInsightsProjection.Project(model, Localizer);

    // ── Data adapter: computeMotorStats (cached telemetry → projection) ────────────────────────────────────

    [Fact]
    public void Compute_returns_null_for_null_history() =>
        Assert.Null(MotorStatsComputation.Compute(null));

    [Fact]
    public void Compute_returns_null_for_empty_history() =>
        Assert.Null(MotorStatsComputation.Compute(Array.Empty<MotorHistorySample>()));

    [Fact]
    public void Compute_aggregates_torque_temp_power_and_regen_like_the_web()
    {
        var samples = new[]
        {
            new MotorHistorySample(100, 120, 40, 50, 30, 5),       // torque 220, temp 50, power 30, regen 5
            new MotorHistorySample(null, null, null, null, 10, null), // no torque / temp / regen, power 10
            new MotorHistorySample(50, null, 60, null, null, 8),   // torque 50 (rear missing → 0), temp 60, regen 8
        };

        var stats = MotorStatsComputation.Compute(samples);

        Assert.NotNull(stats);
        Assert.Equal(3, stats!.TotalReadings);
        Assert.Equal(135, stats.AvgTorqueNm, 3);   // (220 + 50) / 2
        Assert.Equal(220, stats.MaxTorqueNm, 3);
        Assert.Equal(55, stats.AvgMotorTempCelsius, 3); // (50 + 60) / 2
        Assert.Equal(60, stats.MaxMotorTempCelsius, 3);
        Assert.Equal(20, stats.AvgPowerKw, 3);      // (30 + 10) / 2
        Assert.Equal(30, stats.PeakPowerKw, 3);
        Assert.Equal(10, stats.MinPowerKw, 3);
        Assert.Equal(8, stats.PeakRegenKw, 3);
        Assert.Equal(50, stats.HighTorquePct, 3);   // one of two torque samples > 200
    }

    [Fact]
    public void Compute_skips_samples_with_both_axles_null_but_sums_a_single_axle()
    {
        var samples = new[]
        {
            new MotorHistorySample(null, null, null, null, null, null), // fully skipped (no series gains a value)
            new MotorHistorySample(null, 90, null, null, null, null),   // rear-only torque → 90 (front counts as 0)
        };

        var stats = MotorStatsComputation.Compute(samples);

        Assert.NotNull(stats);
        Assert.Equal(2, stats!.TotalReadings);
        Assert.Equal(90, stats.AvgTorqueNm, 3);
        Assert.Equal(90, stats.MaxTorqueNm, 3);
        Assert.Equal(0, stats.HighTorquePct, 3); // 90 is not above the 200 threshold
    }

    [Fact]
    public void Compute_high_torque_pct_is_zero_when_no_sample_exceeds_the_threshold()
    {
        var samples = new[]
        {
            new MotorHistorySample(100, 50, null, null, null, null), // torque 150
            new MotorHistorySample(100, 100, null, null, null, null), // torque 200 (not > 200)
        };

        var stats = MotorStatsComputation.Compute(samples);

        Assert.NotNull(stats);
        Assert.Equal(0, stats!.HighTorquePct, 3);
    }

    [Fact]
    public void Compute_threshold_constant_matches_the_web()
    {
        Assert.Equal(200, MotorStatsComputation.HighTorqueThresholdNm, 3);
    }

    // ── Throttle style classification (web getThrottleStyle) ───────────────────────────────────────────────

    [Theory]
    [InlineData(0, ThrottleStyle.Conservative)]
    [InlineData(19.9, ThrottleStyle.Conservative)]
    [InlineData(20, ThrottleStyle.Moderate)]   // < 20 is conservative; 20 is moderate (web `avgPower < 20`)
    [InlineData(79.9, ThrottleStyle.Moderate)]
    [InlineData(80, ThrottleStyle.Aggressive)] // < 80 is moderate; 80 is aggressive (web `avgPower < 80`)
    [InlineData(200, ThrottleStyle.Aggressive)]
    public void Throttle_style_follows_the_web_thresholds(double avgPowerKw, ThrottleStyle expected) =>
        Assert.Equal(expected, ThrottleStyles.FromAveragePower(avgPowerKw));

    [Fact]
    public void Throttle_style_ceilings_are_the_web_constants()
    {
        Assert.Equal(20, ThrottleStyles.ConservativeCeilingKw, 3);
        Assert.Equal(80, ThrottleStyles.ModerateCeilingKw, 3);
    }

    [Theory]
    [InlineData(ThrottleStyle.Conservative, StatusKind.Success)]
    [InlineData(ThrottleStyle.Moderate, StatusKind.Warning)]
    [InlineData(ThrottleStyle.Aggressive, StatusKind.Danger)]
    public void Throttle_status_maps_like_the_web_badge(ThrottleStyle style, StatusKind expected) =>
        Assert.Equal(expected, MotorEfficiencyInsightsProjection.ThrottleStatusFor(style));

    // ── Thermal severity (web maxMotorTemp threshold on raw SI Celsius) ────────────────────────────────────

    [Theory]
    [InlineData(0, StatusKind.Success)]
    [InlineData(99.9, StatusKind.Success)]
    [InlineData(100, StatusKind.Warning)]  // < 100 good; 100 warm (web `< 100`)
    [InlineData(139.9, StatusKind.Warning)]
    [InlineData(140, StatusKind.Danger)]   // < 140 warm; 140 hot (web `< 140`)
    [InlineData(180, StatusKind.Danger)]
    public void Thermal_status_follows_the_web_threshold(double maxCelsius, StatusKind expected) =>
        Assert.Equal(expected, MotorEfficiencyInsightsProjection.ThermalStatusFor(maxCelsius));

    [Fact]
    public void Thermal_ceilings_are_the_web_constants()
    {
        Assert.Equal(100, MotorEfficiencyInsightsProjection.ThermalGoodCeilingCelsius, 3);
        Assert.Equal(140, MotorEfficiencyInsightsProjection.ThermalWarmCeilingCelsius, 3);
    }

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(MotorEfficiencyInsightsState.Loading, Project(MotorEfficiencyInsightsModel.Loading()).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(MotorEfficiencyInsightsState.Error, Project(MotorEfficiencyInsightsModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(MotorEfficiencyInsightsState.Empty, Project(MotorEfficiencyInsightsModel.Empty()).State);

    [Fact]
    public void Ready_when_stats_present() =>
        Assert.Equal(MotorEfficiencyInsightsState.Ready, Project(MotorEfficiencyInsightsModel.Ready(BaseStats())).State);

    [Fact]
    public void Fresh_snapshot_with_no_stats_collapses_to_empty()
    {
        var model = new MotorEfficiencyInsightsModel(
            MotorEfficiencyInsightsState.Ready, null, null, UnitPref.Metric);

        Assert.Equal(MotorEfficiencyInsightsState.Empty, Project(model).State);
    }

    [Fact]
    public void Stale_keeps_its_branch_even_with_stats() =>
        Assert.Equal(MotorEfficiencyInsightsState.Stale, Project(MotorEfficiencyInsightsModel.Stale(BaseStats())).State);

    [Fact]
    public void Offline_keeps_its_branch_even_with_stats() =>
        Assert.Equal(MotorEfficiencyInsightsState.Offline, Project(MotorEfficiencyInsightsModel.Offline(BaseStats())).State);

    // ── Panels show data when present, the empty surface otherwise (never hidden) ──────────────────────────

    [Fact]
    public void Ready_panels_all_have_data()
    {
        var display = Project(MotorEfficiencyInsightsModel.Ready(BaseStats()));

        Assert.True(display.Torque.HasData);
        Assert.True(display.Throttle.HasData);
        Assert.True(display.Thermal.HasData);
    }

    [Fact]
    public void Empty_panels_render_the_no_data_message()
    {
        var display = Project(MotorEfficiencyInsightsModel.Empty());

        Assert.False(display.Torque.HasData);
        Assert.False(display.Throttle.HasData);
        Assert.False(display.Thermal.HasData);
        Assert.Equal("No motor data recorded yet", display.Torque.EmptyMessage);
        Assert.Equal("No motor data recorded yet", display.Throttle.EmptyMessage);
        Assert.Equal("No motor data recorded yet", display.Thermal.EmptyMessage);
    }

    [Fact]
    public void Panel_titles_resolve_from_the_facade()
    {
        var display = Project(MotorEfficiencyInsightsModel.Ready(BaseStats()));

        Assert.Equal("Torque Distribution", display.Torque.Title);
        Assert.Equal("Throttle Behavior", display.Throttle.Title);
        Assert.Equal("Motor Thermal", display.Thermal.Title);
    }

    // ── Torque panel readouts (web "{n} Nm" / "{n}%") ──────────────────────────────────────────────────────

    [Fact]
    public void Torque_panel_formats_torque_and_high_torque_share()
    {
        var torque = Project(MotorEfficiencyInsightsModel.Ready(BaseStats())).Torque;

        Assert.Equal("Avg Torque", torque.AvgLabel);
        Assert.Equal("50.0 Nm", torque.AvgValueText);
        Assert.Equal("Max Torque", torque.MaxLabel);
        Assert.Equal("200.0 Nm", torque.MaxValueText);
        Assert.Equal("High Torque Time", torque.HighLabel);
        Assert.Equal("10.0%", torque.HighValueText);
    }

    // ── Throttle panel: avg power, style badge, MetricBar (web sublabel="" → no stray readout) ─────────────

    [Fact]
    public void Throttle_panel_formats_power_in_kilowatts()
    {
        var throttle = Project(MotorEfficiencyInsightsModel.Ready(BaseStats(avgPowerKw: 0))).Throttle;

        Assert.Equal("Avg Power", throttle.AvgPowerLabel);
        Assert.Equal("0.0 kW", throttle.AvgPowerValueText);
    }

    [Fact]
    public void Throttle_panel_power_is_not_converted_for_imperial_units()
    {
        // web shows avgPower in kW regardless of unit preference — never a converted value.
        var throttle = Project(MotorEfficiencyInsightsModel.Ready(BaseStats(avgPowerKw: 12.5), units: UnitPref.Imperial)).Throttle;

        Assert.Equal("12.5 kW", throttle.AvgPowerValueText);
    }

    [Fact]
    public void Throttle_panel_carries_no_stray_zero_readout_for_the_metric_bar()
    {
        // web regression: MetricBar sublabel="" must not fall through to fmtNumber(0) = "0.00".
        var throttle = Project(MotorEfficiencyInsightsModel.Ready(BaseStats(avgPowerKw: 0))).Throttle;

        Assert.Equal(0, throttle.BarValue, 3);
        Assert.Equal(200, throttle.BarMax, 3);
        Assert.DoesNotContain("0.00", throttle.AvgPowerValueText, StringComparison.Ordinal);
        Assert.DoesNotContain("0.00", throttle.AutomationName, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(0, "Conservative", StatusKind.Success)]
    [InlineData(50, "Moderate", StatusKind.Warning)]
    [InlineData(120, "Aggressive", StatusKind.Danger)]
    public void Throttle_panel_derives_the_style_badge_from_average_power(
        double avgPowerKw, string expectedText, StatusKind expectedStatus)
    {
        var throttle = Project(MotorEfficiencyInsightsModel.Ready(BaseStats(avgPowerKw))).Throttle;

        Assert.Equal("Style", throttle.StyleLabel);
        Assert.Equal(expectedText, throttle.StyleBadgeText);
        Assert.Equal(expectedStatus, throttle.StyleStatus);
        Assert.Equal(StatusResources.AccentBrushKey(expectedStatus), throttle.BarAccentBrushKey);
    }

    [Fact]
    public void Throttle_panel_honours_an_explicit_style_over_the_derived_one()
    {
        // web parent passes throttleStyle as a prop; an explicit value wins over the power-derived default.
        var throttle = Project(
            MotorEfficiencyInsightsModel.Ready(BaseStats(avgPowerKw: 0), style: ThrottleStyle.Aggressive)).Throttle;

        Assert.Equal("Aggressive", throttle.StyleBadgeText);
        Assert.Equal(StatusKind.Danger, throttle.StyleStatus);
    }

    // ── Thermal panel: SI → display temperature (with the °°-doubling regression guard) ───────────────────

    [Fact]
    public void Thermal_panel_renders_celsius_without_doubling_the_degree_sign()
    {
        var thermal = Project(MotorEfficiencyInsightsModel.Ready(BaseStats())).Thermal;

        Assert.Equal("Avg Motor Temp", thermal.AvgTempLabel);
        Assert.Equal("49.0" + DegreeC, thermal.AvgTempValueText);
        Assert.Equal("Max Motor Temp", thermal.MaxTempLabel);
        Assert.Equal("64.0" + DegreeC, thermal.MaxTempValueText);
        Assert.DoesNotContain("\u00B0\u00B0", thermal.AvgTempValueText, StringComparison.Ordinal);
        Assert.DoesNotContain("\u00B0\u00B0", thermal.MaxTempValueText, StringComparison.Ordinal);
    }

    [Fact]
    public void Thermal_panel_converts_to_fahrenheit_without_doubling_the_degree_sign()
    {
        // 49 °C → 120.2 °F, 64 °C → 147.2 °F (web toTemperatureDisplay + tempUnit, '°' never doubled).
        var thermal = Project(MotorEfficiencyInsightsModel.Ready(BaseStats(), units: UnitPref.Imperial)).Thermal;

        Assert.Equal("120.2" + DegreeF, thermal.AvgTempValueText);
        Assert.Equal("147.2" + DegreeF, thermal.MaxTempValueText);
        Assert.DoesNotContain("\u00B0\u00B0", thermal.AvgTempValueText, StringComparison.Ordinal);
        Assert.DoesNotContain("\u00B0\u00B0", thermal.MaxTempValueText, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(64, "Thermal: Good", StatusKind.Success)]
    [InlineData(120, "Thermal: Warm", StatusKind.Warning)]
    [InlineData(150, "Thermal: Hot", StatusKind.Danger)]
    public void Thermal_panel_badge_follows_the_raw_celsius_peak(
        double maxCelsius, string expectedText, StatusKind expectedStatus)
    {
        var stats = BaseStats() with { MaxMotorTempCelsius = maxCelsius };
        var thermal = Project(MotorEfficiencyInsightsModel.Ready(stats)).Thermal;

        Assert.Equal(expectedText, thermal.ThermalBadgeText);
        Assert.Equal(expectedStatus, thermal.ThermalStatus);
    }

    [Fact]
    public void Thermal_badge_classification_uses_the_si_peak_not_the_display_value()
    {
        // 64 °C = 147.2 °F. The °F display value (147 > 140) must NOT flip the classification to "Hot".
        var thermal = Project(MotorEfficiencyInsightsModel.Ready(BaseStats(), units: UnitPref.Imperial)).Thermal;

        Assert.Equal("Thermal: Good", thermal.ThermalBadgeText);
        Assert.Equal(StatusKind.Success, thermal.ThermalStatus);
    }

    // ── Freshness chip (stale / offline) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(MotorEfficiencyInsightsModel.Ready(BaseStats())).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(MotorEfficiencyInsightsModel.Stale(BaseStats()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(MotorEfficiencyInsightsModel.Offline(BaseStats()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_readouts()
    {
        var display = Project(MotorEfficiencyInsightsModel.Offline(BaseStats()));

        Assert.True(display.Torque.HasData);
        Assert.Equal("50.0 Nm", display.Torque.AvgValueText);
    }

    // ── Fixed copy (loading / error / retry) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(MotorEfficiencyInsightsModel.Loading()).LoadingLabel);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Couldn't load motor insights", Project(MotorEfficiencyInsightsModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "We couldn't load the motor efficiency insights. Please try again.",
            Project(MotorEfficiencyInsightsModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal(
            "Network unreachable",
            Project(MotorEfficiencyInsightsModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(MotorEfficiencyInsightsModel.Failed()).RetryLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(MotorEfficiencyInsightsModel.Loading()),
                Project(MotorEfficiencyInsightsModel.Empty()),
                Project(MotorEfficiencyInsightsModel.Failed()),
                Project(MotorEfficiencyInsightsModel.Stale(BaseStats())),
                Project(MotorEfficiencyInsightsModel.Offline(BaseStats())),
                Project(MotorEfficiencyInsightsModel.Ready(BaseStats())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_pairs_the_panel_titles_and_loading_label()
    {
        var display = Project(MotorEfficiencyInsightsModel.Loading());

        Assert.Contains("Torque Distribution", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Throttle Behavior", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Motor Thermal", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Loading", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Error_automation_name_is_the_error_title() =>
        Assert.Equal(
            "Couldn't load motor insights",
            Project(MotorEfficiencyInsightsModel.Failed()).AutomationName);

    [Fact]
    public void Ready_panel_automation_names_carry_label_value_pairs()
    {
        var display = Project(MotorEfficiencyInsightsModel.Ready(BaseStats()));

        Assert.Contains("Avg Torque 50.0 Nm", display.Torque.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Avg Power 0.0 kW", display.Throttle.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Avg Motor Temp 49.0" + DegreeC, display.Thermal.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_panel_automation_name_carries_the_empty_message() =>
        Assert.Contains(
            "No motor data recorded yet",
            Project(MotorEfficiencyInsightsModel.Empty()).Torque.AutomationName,
            StringComparison.Ordinal);

    [Fact]
    public void Ready_surface_automation_name_carries_every_panel()
    {
        var display = Project(MotorEfficiencyInsightsModel.Ready(BaseStats()));

        Assert.Contains(display.Torque.AutomationName, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Throttle.AutomationName, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Thermal.AutomationName, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_surface_automation_name_includes_the_chip() =>
        Assert.Contains(
            "Stale",
            Project(MotorEfficiencyInsightsModel.Stale(BaseStats())).AutomationName,
            StringComparison.Ordinal);

    // ── Diagnostics (P1/S11): view.opened slug=MotorEfficiencyInsights, PII-safe ──────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new MotorEfficiencyInsightsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MotorEfficiencyInsights", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_a_motor_reading()
    {
        var captured = new List<string>();
        var diagnostics = new MotorEfficiencyInsightsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=MotorEfficiencyInsights", line);
        Assert.DoesNotContain("Nm", line, StringComparison.Ordinal);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
        Assert.DoesNotContain('\u00B0', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("MotorEfficiencyInsights", MotorEfficiencyInsightsRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => MotorEfficiencyInsightsProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => MotorEfficiencyInsightsProjection.Project(MotorEfficiencyInsightsModel.Loading(), null!));

    [Fact]
    public void Ready_rejects_null_stats() =>
        Assert.Throws<ArgumentNullException>(() => MotorEfficiencyInsightsModel.Ready(null!));

    [Fact]
    public void Stale_rejects_null_stats() =>
        Assert.Throws<ArgumentNullException>(() => MotorEfficiencyInsightsModel.Stale(null!));

    [Fact]
    public void Offline_rejects_null_stats() =>
        Assert.Throws<ArgumentNullException>(() => MotorEfficiencyInsightsModel.Offline(null!));
}
