using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TemperatureGauges</c> feature surface's UI-thread-free logic — the per-state
/// branch projection (loading / error / empty / stale / offline / ready), the web <c>tempSeverityColor</c>
/// threshold (computed from the SI Celsius ratio), the SI → display temperature conversion and clamped gauge
/// sweep (in display units, exactly like the web RadialGauge), the value + "Max" caption formatting, the
/// freshness chip copy, the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx). The WinUI view itself
/// (TemperatureGauges.cs) is exercised by the app build.
/// </summary>
public sealed class TemperatureGaugesTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static TemperatureGaugeSensor Sensor(
        double? value,
        double max = 60,
        string key = "battery",
        string labelKey = "drivetrain.battery",
        string label = "Battery") =>
        new(key, labelKey, label, value, max);

    private static TemperatureGaugesDisplay Project(TemperatureGaugesModel model) =>
        TemperatureGaugesProjection.Project(model, Localizer);

    private static TemperatureGaugeDisplayItem FirstGauge(TemperatureGaugesModel model) =>
        Assert.Single(Project(model).Gauges);

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(TemperatureGaugesState.Loading, Project(TemperatureGaugesModel.Loading()).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(TemperatureGaugesState.Error, Project(TemperatureGaugesModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(TemperatureGaugesState.Empty, Project(TemperatureGaugesModel.Empty()).State);

    [Fact]
    public void Ready_when_sensors_present() =>
        Assert.Equal(TemperatureGaugesState.Ready, Project(TemperatureGaugesModel.Ready([Sensor(40)])).State);

    [Fact]
    public void Fresh_snapshot_with_no_sensors_collapses_to_empty() =>
        Assert.Equal(TemperatureGaugesState.Empty, Project(TemperatureGaugesModel.Ready([])).State);

    [Fact]
    public void Stale_keeps_its_branch_even_with_sensors() =>
        Assert.Equal(TemperatureGaugesState.Stale, Project(TemperatureGaugesModel.Stale([Sensor(40)])).State);

    [Fact]
    public void Offline_keeps_its_branch_even_with_sensors() =>
        Assert.Equal(TemperatureGaugesState.Offline, Project(TemperatureGaugesModel.Offline([Sensor(40)])).State);

    // ── Severity threshold: web tempSeverityColor (computed from the SI Celsius ratio) ─────────────────────

    [Fact]
    public void Severity_is_neutral_when_value_is_null() =>
        Assert.Equal(StatusKind.Neutral, TemperatureGaugesProjection.SeverityFor(null, 100));

    [Fact]
    public void Severity_is_neutral_when_max_is_non_positive() =>
        Assert.Equal(StatusKind.Neutral, TemperatureGaugesProjection.SeverityFor(50, 0));

    [Theory]
    [InlineData(85, StatusKind.Danger)]   // 0.85 ratio → critical (inclusive)
    [InlineData(100, StatusKind.Danger)]
    [InlineData(84.9, StatusKind.Warning)]
    [InlineData(65, StatusKind.Warning)]  // 0.65 ratio → warning (inclusive)
    [InlineData(64.9, StatusKind.Success)]
    [InlineData(0, StatusKind.Success)]
    public void Severity_follows_the_web_threshold(double value, StatusKind expected) =>
        Assert.Equal(expected, TemperatureGaugesProjection.SeverityFor(value, 100));

    [Fact]
    public void Severity_uses_the_si_ratio_not_the_display_unit()
    {
        // 50 °C / 60 °C = 0.833 → warning. The °F display values (122/140) must NOT change the classification.
        var metric = FirstGauge(TemperatureGaugesModel.Ready([Sensor(50)]));
        var imperial = FirstGauge(TemperatureGaugesModel.Ready([Sensor(50)], UnitPref.Imperial));

        Assert.Equal(StatusKind.Warning, metric.Severity);
        Assert.Equal(StatusKind.Warning, imperial.Severity);
    }

    [Fact]
    public void Severity_thresholds_are_the_web_constants()
    {
        Assert.Equal(0.85, TemperatureGaugesProjection.CriticalRatio, 3);
        Assert.Equal(0.65, TemperatureGaugesProjection.WarningRatio, 3);
    }

    // ── Value + "Max" caption: SI → display conversion, clamping, formatting ───────────────────────────────

    [Fact]
    public void Metric_value_and_max_render_in_celsius()
    {
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(55, max: 60)]));

        Assert.Equal("55", gauge.ValueText);
        Assert.Equal("\u00B0C", gauge.UnitLabel);
        Assert.Equal("Max: 60\u00B0C", gauge.MaxText);
    }

    [Fact]
    public void Imperial_value_and_max_convert_to_fahrenheit()
    {
        // 50 °C → 122 °F, max 60 °C → 140 °F.
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(50, max: 60)], UnitPref.Imperial));

        Assert.Equal("122", gauge.ValueText);
        Assert.Equal("\u00B0F", gauge.UnitLabel);
        Assert.Equal("Max: 140\u00B0F", gauge.MaxText);
    }

    [Fact]
    public void Null_value_renders_zero_like_the_web()
    {
        // web: value={sensor.value !== null ? toTemperatureDisplay(sensor.value) : 0}
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(null, max: 60)]));

        Assert.Equal("0", gauge.ValueText);
        Assert.Equal(0.0, gauge.Fraction, 3);
        Assert.Equal("Max: 60\u00B0C", gauge.MaxText);
    }

    [Fact]
    public void Value_text_clamps_to_max_like_the_web()
    {
        // web RadialGauge clamps the centre readout to [0, max].
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(200, max: 150)]));

        Assert.Equal("150", gauge.ValueText);
        Assert.Equal(1.0, gauge.Fraction, 3);
    }

    [Fact]
    public void Non_integer_value_uses_the_default_global_precision()
    {
        // 46 °C → 114.8 °F; web globalPrecision default is 2 → "114.80".
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(46, max: 150)], UnitPref.Imperial));

        Assert.Equal("114.80", gauge.ValueText);
    }

    [Fact]
    public void Value_precision_honours_a_host_override()
    {
        var oneDecimal = UnitPref.Imperial with { Precision = 1 };
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(46, max: 150)], oneDecimal));

        Assert.Equal("114.8", gauge.ValueText);
    }

    // ── Gauge sweep: clamped fraction in DISPLAY units (web RadialGauge quirk) ──────────────────────────────

    [Fact]
    public void Fraction_is_value_over_max_in_metric()
    {
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(55, max: 60)]));

        Assert.Equal(0.917, gauge.Fraction, 3); // 55 / 60
    }

    [Fact]
    public void Fraction_is_computed_in_display_units()
    {
        // The web RadialGauge receives already-converted values, so the sweep is unit-dependent for temperature:
        // 122 °F / 140 °F = 0.871, not the SI 50/60 = 0.833.
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(50, max: 60)], UnitPref.Imperial));

        Assert.Equal(0.871, gauge.Fraction, 3);
    }

    // ── Multiple sensors + the canonical drivetrain set ────────────────────────────────────────────────────

    [Fact]
    public void Gauges_preserve_sensor_order()
    {
        var model = TemperatureGaugesModel.Ready(
            DrivetrainTemperatureSensors.Build(60, 70, 80, 30));

        Assert.Collection(
            Project(model).Gauges,
            g => Assert.Equal("Front Motor", g.Label),
            g => Assert.Equal("Rear Motor", g.Label),
            g => Assert.Equal("Inverter", g.Label),
            g => Assert.Equal("Battery", g.Label));
    }

    [Fact]
    public void Canonical_sensor_set_uses_the_web_keys_and_maxima()
    {
        var sensors = DrivetrainTemperatureSensors.Build(null, null, null, null);

        Assert.Collection(
            sensors,
            s => AssertSensor(s, "frontMotor", "drivetrain.frontMotor", 150),
            s => AssertSensor(s, "rearMotor", "drivetrain.rearMotor", 150),
            s => AssertSensor(s, "inverter", "drivetrain.inverter", 120),
            s => AssertSensor(s, "battery", "drivetrain.battery", 60));
    }

    private static void AssertSensor(TemperatureGaugeSensor sensor, string key, string labelKey, double max)
    {
        Assert.Equal(key, sensor.Key);
        Assert.Equal(labelKey, sensor.LabelKey);
        Assert.Equal(max, sensor.MaxTemperatureCelsius, 3);
    }

    // ── Title + freshness chip ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Temperature Gauges", Project(TemperatureGaugesModel.Ready([Sensor(40)])).Title);

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(TemperatureGaugesModel.Ready([Sensor(40)])).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(TemperatureGaugesModel.Stale([Sensor(40)]));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(TemperatureGaugesModel.Offline([Sensor(40)]));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_gauges()
    {
        var display = Project(TemperatureGaugesModel.Offline([Sensor(55, max: 60)]));

        var gauge = Assert.Single(display.Gauges);
        Assert.Equal("55", gauge.ValueText);
    }

    // ── Fixed copy (loading / empty / error / retry) ───────────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(TemperatureGaugesModel.Loading()).LoadingLabel);

    [Fact]
    public void Empty_message_is_a_drivetrain_specific_string() =>
        Assert.Equal("No drivetrain data", Project(TemperatureGaugesModel.Empty()).EmptyMessage);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Couldn't load temperature gauges", Project(TemperatureGaugesModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "We couldn't load the temperature gauges. Please try again.",
            Project(TemperatureGaugesModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal(
            "Network unreachable",
            Project(TemperatureGaugesModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(TemperatureGaugesModel.Failed()).RetryLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(TemperatureGaugesModel.Loading()),
                Project(TemperatureGaugesModel.Empty()),
                Project(TemperatureGaugesModel.Failed()),
                Project(TemperatureGaugesModel.Stale([Sensor(40)])),
                Project(TemperatureGaugesModel.Offline([Sensor(40)])),
                Project(TemperatureGaugesModel.Ready([Sensor(40)])),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_pairs_the_title_and_loading_label() =>
        Assert.Equal("Temperature Gauges. Loading", Project(TemperatureGaugesModel.Loading()).AutomationName);

    [Fact]
    public void Empty_automation_name_pairs_the_title_and_empty_message() =>
        Assert.Equal(
            "Temperature Gauges. No drivetrain data",
            Project(TemperatureGaugesModel.Empty()).AutomationName);

    [Fact]
    public void Error_automation_name_pairs_the_title_and_error_title() =>
        Assert.Equal(
            "Temperature Gauges. Couldn't load temperature gauges",
            Project(TemperatureGaugesModel.Failed()).AutomationName);

    [Fact]
    public void Gauge_automation_name_carries_label_value_and_max()
    {
        var gauge = FirstGauge(TemperatureGaugesModel.Ready([Sensor(55, max: 60)]));

        Assert.Equal("Battery, 55\u00B0C, Max: 60\u00B0C", gauge.AutomationName);
    }

    [Fact]
    public void Ready_automation_name_carries_title_and_every_gauge()
    {
        var display = Project(TemperatureGaugesModel.Ready(
            DrivetrainTemperatureSensors.Build(60, 70, 80, 30)));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        foreach (var gauge in display.Gauges)
        {
            Assert.Contains(gauge.AutomationName, display.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.Contains(
            "Stale",
            Project(TemperatureGaugesModel.Stale([Sensor(40)])).AutomationName,
            StringComparison.Ordinal);

    // ── Diagnostics (P1/S11): view.opened slug=TemperatureGauges, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new TemperatureGaugesDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TemperatureGauges", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_a_temperature_reading()
    {
        var captured = new List<string>();
        var diagnostics = new TemperatureGaugesDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=TemperatureGauges", line);
        Assert.DoesNotContain('\u00B0', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("TemperatureGauges", TemperatureGaugesRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => TemperatureGaugesProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => TemperatureGaugesProjection.Project(TemperatureGaugesModel.Loading(), null!));

    [Fact]
    public void Ready_rejects_a_null_sensor_list() =>
        Assert.Throws<ArgumentNullException>(() => TemperatureGaugesModel.Ready(null!));
}
