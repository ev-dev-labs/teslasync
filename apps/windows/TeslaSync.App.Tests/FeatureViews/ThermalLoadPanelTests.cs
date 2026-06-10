using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ThermalLoadPanel</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / ready / empty / error / stale / offline), the web <c>tempSeverityColor</c> severity
/// bands and their token brushes, the user-unit temperature read-outs (web <c>displayTemp</c>), the four
/// inline metrics (Peak / Avg power with the literal <c>kW</c> suffix, Drives, Regen Ratio) and their
/// glyph / accent mapping, the freshness chip, the accessible names, the canonical sensor metadata and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx plus its constants / helpers).
/// The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class ThermalLoadPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ThermalLoadPanelDisplay Project(ThermalLoadPanelModel model, UnitPref? units = null) =>
        ThermalLoadPanelProjection.Project(model, units ?? UnitPref.Metric, Localizer);

    private static IReadOnlyList<ThermalSensorInput> Sensors() =>
        ThermalLoadPanelRegistration.BuildSensors(57, 62, 84, 31);

    private static ThermalLoadPanelModel Ready() =>
        ThermalLoadPanelModel.Ready(Sensors(), 240, 42.567, new ThermalDrivingStats(1234, 0.1234));

    // ── Branch precedence: parent lifecycle drives the state ──────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ThermalLoadPanelState.Loading, Project(ThermalLoadPanelModel.Loading).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(ThermalLoadPanelState.Empty, Project(ThermalLoadPanelModel.Empty).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(ThermalLoadPanelState.Error, Project(ThermalLoadPanelModel.Failed()).State);

    [Fact]
    public void Ready_when_model_is_ready() =>
        Assert.Equal(ThermalLoadPanelState.Ready, Project(Ready()).State);

    [Fact]
    public void Stale_when_model_is_stale() =>
        Assert.Equal(
            ThermalLoadPanelState.Stale,
            Project(ThermalLoadPanelModel.Stale(Sensors(), 240, 42.5, new ThermalDrivingStats(10, 0.2))).State);

    [Fact]
    public void Offline_when_model_is_offline() =>
        Assert.Equal(
            ThermalLoadPanelState.Offline,
            Project(ThermalLoadPanelModel.Offline(Sensors(), 240, 42.5, new ThermalDrivingStats(10, 0.2))).State);

    // ── HasData drives the content-vs-empty body branch ───────────────────────────────────────────────

    [Fact]
    public void Ready_with_sensors_has_data()
    {
        var display = Project(Ready());
        Assert.True(display.HasData);
        Assert.Equal(4, display.Sensors.Count);
    }

    [Fact]
    public void Ready_without_sensors_keeps_state_but_has_no_data()
    {
        // Parent says Ready but the drivetrain-health payload carried no sensors — the surface stays Ready
        // and the view renders the friendly empty body (web parity: never a blank box).
        var display = Project(ThermalLoadPanelModel.Ready(Array.Empty<ThermalSensorInput>(), 0, 0, null));
        Assert.Equal(ThermalLoadPanelState.Ready, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.Sensors);
    }

    [Fact]
    public void Empty_state_has_no_data() =>
        Assert.False(Project(ThermalLoadPanelModel.Empty).HasData);

    // ── Severity bands: the web tempSeverityColor (null grey / ≥.85 crit / ≥.65 warn / else good) ──────

    [Theory]
    [InlineData(null, 150.0, ThermalSeverity.Unknown)]
    [InlineData(50.0, 150.0, ThermalSeverity.Good)]       // ratio 0.33
    [InlineData(100.0, 150.0, ThermalSeverity.Warning)]   // ratio 0.67
    [InlineData(140.0, 150.0, ThermalSeverity.Critical)]  // ratio 0.93
    [InlineData(97.5, 150.0, ThermalSeverity.Warning)]    // ratio exactly 0.65
    [InlineData(127.5, 150.0, ThermalSeverity.Critical)]  // ratio exactly 0.85
    public void Severity_follows_the_web_temp_severity_color(double? value, double max, ThermalSeverity expected) =>
        Assert.Equal(expected, ThermalLoadPanelProjection.Severity(value, max));

    [Fact]
    public void Severity_is_unknown_when_max_is_non_positive() =>
        Assert.Equal(ThermalSeverity.Unknown, ThermalLoadPanelProjection.Severity(50, 0));

    [Theory]
    [InlineData(ThermalSeverity.Critical, "TsColorDangerBrush")]
    [InlineData(ThermalSeverity.Warning, "TsColorWarningBrush")]
    [InlineData(ThermalSeverity.Good, "TsColorSuccessBrush")]
    [InlineData(ThermalSeverity.Unknown, "TsColorTextMutedBrush")]
    public void Severity_brush_key_maps_to_the_token(ThermalSeverity severity, string expected) =>
        Assert.Equal(expected, ThermalLoadPanelTokens.SeverityBrushKey(severity));

    // ── Sensor bars: label, value, max, severity + the user-unit temperature read-out ─────────────────

    [Fact]
    public void Sensor_bars_carry_label_value_max_and_severity()
    {
        var display = Project(ThermalLoadPanelModel.Ready(
            ThermalLoadPanelRegistration.BuildSensors(140, null, 84, 31), 0, 0, null));

        var front = display.Sensors[0];
        Assert.Equal("Front Motor", front.Label);
        Assert.Equal(140, front.Value);
        Assert.Equal(150, front.Max);
        Assert.Equal(ThermalSeverity.Critical, front.Severity);       // 140/150 = 0.93
        Assert.Equal("TsColorDangerBrush", front.SeverityBrushKey);

        var inverter = display.Sensors[2];
        Assert.Equal(84, inverter.Value);
        Assert.Equal(120, inverter.Max);
        Assert.Equal(ThermalSeverity.Warning, inverter.Severity);     // 84/120 = 0.70
    }

    [Fact]
    public void Null_sensor_reads_as_zero_bar_value_em_dash_and_unknown_severity()
    {
        var display = Project(ThermalLoadPanelModel.Ready(
            ThermalLoadPanelRegistration.BuildSensors(57, null, 84, 31), 0, 0, null));

        var rear = display.Sensors[1];
        Assert.Equal(0, rear.Value);                       // web value ?? 0
        Assert.Equal("\u2014", rear.ValueText);            // web displayTemp(null) → em dash
        Assert.Equal(ThermalSeverity.Unknown, rear.Severity);
    }

    [Fact]
    public void Sensor_read_out_uses_metric_temperature_by_default()
    {
        var display = Project(ThermalLoadPanelModel.Ready(
            ThermalLoadPanelRegistration.BuildSensors(85, 62, 84, 31), 0, 0, null));
        Assert.Equal("85.0\u00B0C", display.Sensors[0].ValueText);
    }

    [Fact]
    public void Sensor_read_out_converts_to_the_user_temperature_unit()
    {
        var display = Project(
            ThermalLoadPanelModel.Ready(ThermalLoadPanelRegistration.BuildSensors(85, 62, 84, 31), 0, 0, null),
            UnitPref.Imperial);
        Assert.Equal("185.0\u00B0F", display.Sensors[0].ValueText); // 85°C → 185°F
    }

    // ── Inline metrics: Peak / Avg power (literal kW), Drives, Regen Ratio ─────────────────────────────

    [Fact]
    public void Four_inline_metrics_are_projected_in_order()
    {
        var metrics = Project(Ready()).Metrics;
        Assert.Equal(4, metrics.Count);
        Assert.Equal(new[] { "peakPower", "avgPower", "drives", "regenRatio" }, metrics.Select(m => m.Key));
    }

    [Fact]
    public void Peak_power_formats_as_grouped_integer_kilowatts()
    {
        // web: peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—' — fmtInt groups thousands.
        var display = Project(ThermalLoadPanelModel.Ready(Sensors(), 12345.6, 0, null));
        Assert.Equal("12,346 kW", Metric(display, "peakPower").Value);
    }

    [Fact]
    public void Avg_power_formats_with_one_decimal_kilowatts()
    {
        // web: avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—'
        var display = Project(ThermalLoadPanelModel.Ready(Sensors(), 0, 42.567, null));
        Assert.Equal("42.6 kW", Metric(display, "avgPower").Value);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void Non_positive_power_renders_an_em_dash(double power)
    {
        var display = Project(ThermalLoadPanelModel.Ready(Sensors(), power, power, null));
        Assert.Equal("\u2014", Metric(display, "peakPower").Value);
        Assert.Equal("\u2014", Metric(display, "avgPower").Value);
    }

    [Fact]
    public void Power_is_not_unit_converted_under_imperial_units()
    {
        // web hardcodes ' kW' and never routes power through useUnits — imperial must not change it.
        var display = Project(ThermalLoadPanelModel.Ready(Sensors(), 240, 0, null), UnitPref.Imperial);
        Assert.Equal("240 kW", Metric(display, "peakPower").Value);
    }

    [Fact]
    public void Drives_uses_stats_total_drives_or_an_em_dash()
    {
        Assert.Equal("1,234", Metric(Project(Ready()), "drives").Value);

        var noStats = Project(ThermalLoadPanelModel.Ready(Sensors(), 240, 42.5, null));
        Assert.Equal("\u2014", Metric(noStats, "drives").Value);
    }

    [Fact]
    public void Regen_ratio_renders_a_percentage_or_an_em_dash()
    {
        // web: stats ? `${fmtNumber(stats.regenRatio * 100, 1)}%` : '—' — 0.1234 → "12.3%".
        Assert.Equal("12.3%", Metric(Project(Ready()), "regenRatio").Value);

        var noStats = Project(ThermalLoadPanelModel.Ready(Sensors(), 240, 42.5, null));
        Assert.Equal("\u2014", Metric(noStats, "regenRatio").Value);
    }

    [Fact]
    public void Inline_metric_glyphs_and_accents_map_to_the_web_icons()
    {
        var display = Project(Ready());

        Assert.Equal(ThermalLoadPanelRegistration.ZapGlyph, Metric(display, "peakPower").Glyph);
        Assert.Equal("TsColorAccentBrush", Metric(display, "peakPower").IconBrushKey);

        Assert.Equal(ThermalLoadPanelRegistration.TrendingUpGlyph, Metric(display, "avgPower").Glyph);
        Assert.Equal("TsColorInfoBrush", Metric(display, "avgPower").IconBrushKey);

        Assert.Equal(ThermalLoadPanelRegistration.ActivityGlyph, Metric(display, "drives").Glyph);
        Assert.Equal("TsColorSuccessBrush", Metric(display, "drives").IconBrushKey);

        Assert.Equal(ThermalLoadPanelRegistration.ShieldGlyph, Metric(display, "regenRatio").Glyph);
        Assert.Equal("TsColorWarningBrush", Metric(display, "regenRatio").IconBrushKey);
    }

    [Fact]
    public void Inline_metric_labels_use_the_web_copy()
    {
        var display = Project(Ready());
        Assert.Equal("Peak Power", Metric(display, "peakPower").Label);
        Assert.Equal("Avg Power", Metric(display, "avgPower").Label);
        Assert.Equal("Drives", Metric(display, "drives").Label);
        Assert.Equal("Regen Ratio", Metric(display, "regenRatio").Label);
    }

    [Fact]
    public void Title_uses_the_web_thermal_metrics_copy() =>
        Assert.Equal("Thermal Load Indicators", Project(Ready()).Title);

    // ── Freshness chip (stale / offline only) ─────────────────────────────────────────────────────────

    [Fact]
    public void Freshness_chip_is_hidden_for_a_fresh_snapshot() =>
        Assert.False(Project(Ready()).ShowFreshnessChip);

    [Fact]
    public void Stale_snapshot_shows_a_warning_stale_chip()
    {
        var display = Project(ThermalLoadPanelModel.Stale(Sensors(), 240, 42.5, new ThermalDrivingStats(10, 0.2)));
        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_snapshot_shows_a_danger_offline_chip()
    {
        var display = Project(ThermalLoadPanelModel.Offline(Sensors(), 240, 42.5, new ThermalDrivingStats(10, 0.2)));
        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    // ── Shared empty / loading / error copy + freshness passthrough ────────────────────────────────────

    [Fact]
    public void Empty_message_uses_the_drivetrain_no_data_fallback() =>
        Assert.Equal("No drivetrain data available", Project(ThermalLoadPanelModel.Empty).EmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_fallback() =>
        Assert.Equal("Loading", Project(ThermalLoadPanelModel.Loading).LoadingLabel);

    [Fact]
    public void Error_uses_the_default_title_message_and_retry()
    {
        var display = Project(ThermalLoadPanelModel.Failed());
        Assert.Equal("Couldn't load thermal load indicators", display.ErrorTitle);
        Assert.Equal(
            "We couldn't load the thermal load indicators right now. Please try again.",
            display.ErrorMessage);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void Error_prefers_the_model_supplied_message() =>
        Assert.Equal("Sensor bus offline", Project(ThermalLoadPanelModel.Failed("Sensor bus offline")).ErrorMessage);

    [Fact]
    public void Freshness_timestamp_and_fetching_flag_are_passed_through()
    {
        var now = DateTimeOffset.UnixEpoch;
        var display = Project(ThermalLoadPanelModel.Ready(Sensors(), 240, 42.5, null, now, isFetching: true));
        Assert.Equal(now, display.UpdatedAt);
        Assert.True(display.IsFetching);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(ThermalLoadPanelModel.Loading),
                Project(ThermalLoadPanelModel.Empty),
                Project(ThermalLoadPanelModel.Failed()),
                Project(Ready()),
                Project(ThermalLoadPanelModel.Stale(Sensors(), 240, 42.5, new ThermalDrivingStats(10, 0.2))),
                Project(ThermalLoadPanelModel.Offline(Sensors(), 240, 42.5, new ThermalDrivingStats(10, 0.2))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(ThermalLoadPanelModel.Loading).AutomationName);

    [Fact]
    public void Error_automation_name_is_the_error_title() =>
        Assert.Equal("Couldn't load thermal load indicators", Project(ThermalLoadPanelModel.Failed()).AutomationName);

    [Fact]
    public void Empty_automation_name_is_the_empty_message() =>
        Assert.Equal("No drivetrain data available", Project(ThermalLoadPanelModel.Empty).AutomationName);

    [Fact]
    public void Ready_automation_name_is_just_the_title() =>
        Assert.Equal("Thermal Load Indicators", Project(Ready()).AutomationName);

    [Fact]
    public void Ready_without_data_automation_name_appends_the_empty_copy() =>
        Assert.Equal(
            "Thermal Load Indicators. No drivetrain data available",
            Project(ThermalLoadPanelModel.Ready(Array.Empty<ThermalSensorInput>(), 0, 0, null)).AutomationName);

    [Fact]
    public void Stale_automation_name_leads_with_the_freshness_chip() =>
        Assert.Equal(
            "Stale. Thermal Load Indicators",
            Project(ThermalLoadPanelModel.Stale(Sensors(), 240, 42.5, new ThermalDrivingStats(10, 0.2))).AutomationName);

    [Fact]
    public void Offline_automation_name_leads_with_the_freshness_chip() =>
        Assert.Equal(
            "Offline. Thermal Load Indicators",
            Project(ThermalLoadPanelModel.Offline(Sensors(), 240, 42.5, new ThermalDrivingStats(10, 0.2))).AutomationName);

    [Fact]
    public void Sensor_bar_automation_name_reads_label_and_temperature() =>
        Assert.Equal("Front Motor: 85.0\u00B0C", Project(
            ThermalLoadPanelModel.Ready(ThermalLoadPanelRegistration.BuildSensors(85, 62, 84, 31), 0, 0, null))
            .Sensors[0].AutomationName);

    [Fact]
    public void Inline_metric_automation_name_reads_label_and_value() =>
        Assert.Equal("Peak Power: 240 kW", Metric(Project(Ready()), "peakPower").AutomationName);

    // ── Canonical sensor metadata (the web parent's sensors memo) ─────────────────────────────────────

    [Fact]
    public void Build_sensors_produces_the_four_canonical_sensors()
    {
        var sensors = ThermalLoadPanelRegistration.BuildSensors(57, 62, 84, 31);

        Assert.Equal(new[] { "frontMotor", "rearMotor", "inverter", "battery" }, sensors.Select(s => s.Key));
        Assert.Equal(new[] { 150.0, 150.0, 120.0, 60.0 }, sensors.Select(s => s.MaxTempC));
        Assert.Equal(
            new[]
            {
                "drivetrain.frontMotor",
                "drivetrain.rearMotor",
                "drivetrain.inverter",
                "drivetrain.battery",
            },
            sensors.Select(s => s.LabelKey));
        Assert.Equal(new double?[] { 57, 62, 84, 31 }, sensors.Select(s => s.ValueC));
    }

    // ── Diagnostics (P1/S11): view.opened slug=ThermalLoadPanel, PII-safe ──────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ThermalLoadPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ThermalLoadPanel", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_a_temperature_power_or_drive_count()
    {
        var captured = new List<string>();
        var diagnostics = new ThermalLoadPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=ThermalLoadPanel", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
        Assert.DoesNotContain('\u00B0', line);
    }

    [Fact]
    public void Registration_slug_and_id_are_stable()
    {
        Assert.Equal("ThermalLoadPanel", ThermalLoadPanelRegistration.Slug);
        Assert.Equal("thermal-load-panel", ThermalLoadPanelRegistration.Id);
    }

    [Fact]
    public void Registration_exposes_four_distinct_glyphs()
    {
        var glyphs = new[]
        {
            ThermalLoadPanelRegistration.ActivityGlyph,
            ThermalLoadPanelRegistration.ZapGlyph,
            ThermalLoadPanelRegistration.TrendingUpGlyph,
            ThermalLoadPanelRegistration.ShieldGlyph,
        };
        Assert.Equal(glyphs.Length, glyphs.Distinct().Count());
    }

    // ── Argument validation ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => ThermalLoadPanelProjection.Project(null!, UnitPref.Metric, Localizer));

    [Fact]
    public void Project_rejects_null_units() =>
        Assert.Throws<ArgumentNullException>(
            () => ThermalLoadPanelProjection.Project(ThermalLoadPanelModel.Loading, null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ThermalLoadPanelProjection.Project(ThermalLoadPanelModel.Loading, UnitPref.Metric, null!));

    private static ThermalInlineMetric Metric(ThermalLoadPanelDisplay display, string key) =>
        display.Metrics.Single(m => m.Key == key);
}
