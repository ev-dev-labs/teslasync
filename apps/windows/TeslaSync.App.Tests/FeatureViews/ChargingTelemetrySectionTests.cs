using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargingTelemetrySection</c> feature surface's UI-thread-free logic — the
/// per-state branch projection (loading / error / empty / stale / offline / ready), the eight metric tiles in the
/// web's fixed order, the bug-for-bug Charger Power (kW) / Energy Added (kWh) readouts the web source renders as a
/// raw SI magnitude beside a kilo-prefixed label, the genuinely-converted Charge Rate (metres-per-hour ÷ 3600 → SI
/// m/s → display speed) and Range Added (SI metres → display distance), the per-tile design-token accent that maps
/// the web <c>MetricCard color</c>, the freshness chip copy, the accessible names, and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx). The
/// WinUI view itself (ChargingTelemetrySection.cs) is exercised by the app build.
/// </summary>
public sealed class ChargingTelemetrySectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly UnitPref Units = UnitPref.Metric;

    private const string EmDash = "\u2014";

    private static ChargingTelemetryReadings Readings(
        double? powerW = 7600,
        double? voltageV = 240,
        double? currentA = 32,
        double? energyWh = 5000,
        string? state = "Charging",
        double? batteryLevel = 80,
        double? rangeMetersPerHour = 36_000,
        double? rangeMeters = 16_000) =>
        new(powerW, voltageV, currentA, energyWh, state, batteryLevel, rangeMetersPerHour, rangeMeters);

    private static ChargingTelemetrySectionDisplay Project(ChargingTelemetrySectionModel model) =>
        ChargingTelemetrySectionProjection.Project(model, Localizer, Units);

    private static ChargingTelemetrySectionDisplay Project(ChargingTelemetrySectionModel model, UnitPref units) =>
        ChargingTelemetrySectionProjection.Project(model, Localizer, units);

    private static ChargingTelemetrySectionDisplay Ready(ChargingTelemetryReadings? readings = null) =>
        Project(ChargingTelemetrySectionModel.Ready(readings ?? Readings()));

    private static ChargingTelemetryMetric Tile(
        ChargingTelemetrySectionDisplay display,
        ChargingTelemetryMetricKind kind) =>
        display.Metrics.Single(m => m.Kind == kind);

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ChargingTelemetrySectionState.Loading, Project(ChargingTelemetrySectionModel.Loading).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(ChargingTelemetrySectionState.Error, Project(ChargingTelemetrySectionModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(ChargingTelemetrySectionState.Empty, Project(ChargingTelemetrySectionModel.Empty).State);

    [Fact]
    public void Ready_when_a_reading_is_present() =>
        Assert.Equal(ChargingTelemetrySectionState.Ready, Ready().State);

    [Fact]
    public void Ready_status_with_a_null_reading_collapses_to_empty()
    {
        // Web parity: a null / undefined chargingTelemetry prop renders the : <EmptyState /> branch.
        var display = Project(new ChargingTelemetrySectionModel(ChargingTelemetrySectionState.Ready, null));

        Assert.Equal(ChargingTelemetrySectionState.Empty, display.State);
    }

    [Fact]
    public void Ready_even_when_every_field_is_null()
    {
        // Web parity: a truthy chargingTelemetry object with null fields still renders the grid (em dashes); only
        // a null / undefined prop collapses to the empty surface.
        var display = Project(ChargingTelemetrySectionModel.Ready(Readings(
            powerW: null, voltageV: null, currentA: null, energyWh: null,
            state: null, batteryLevel: null, rangeMetersPerHour: null, rangeMeters: null)));

        Assert.Equal(ChargingTelemetrySectionState.Ready, display.State);
        Assert.All(display.Metrics, m => Assert.Equal(EmDash, m.Value));
    }

    [Fact]
    public void Stale_keeps_its_branch_even_with_a_reading() =>
        Assert.Equal(
            ChargingTelemetrySectionState.Stale,
            Project(ChargingTelemetrySectionModel.Stale(Readings())).State);

    [Fact]
    public void Offline_keeps_its_branch_even_with_a_reading() =>
        Assert.Equal(
            ChargingTelemetrySectionState.Offline,
            Project(ChargingTelemetrySectionModel.Offline(Readings())).State);

    // ── Header ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Charging Telemetry", Ready().Title);

    [Fact]
    public void Header_carries_the_lightning_glyph() =>
        Assert.Equal(ChargingTelemetrySectionProjection.ZapGlyph, Ready().HeaderGlyph);

    // ── The eight tiles, in the web's fixed render order ───────────────────────────────────────────────

    [Fact]
    public void Tiles_are_in_the_web_render_order()
    {
        var kinds = Ready().Metrics.Select(m => m.Kind).ToArray();

        Assert.Equal(
            new[]
            {
                ChargingTelemetryMetricKind.ChargerPower,
                ChargingTelemetryMetricKind.Voltage,
                ChargingTelemetryMetricKind.Current,
                ChargingTelemetryMetricKind.EnergyAdded,
                ChargingTelemetryMetricKind.ChargingState,
                ChargingTelemetryMetricKind.BatteryLevel,
                ChargingTelemetryMetricKind.ChargeRate,
                ChargingTelemetryMetricKind.RangeAdded,
            },
            kinds);
    }

    [Fact]
    public void Tile_labels_resolve_from_the_facade()
    {
        var display = Ready();

        Assert.Equal("Charger Power", Tile(display, ChargingTelemetryMetricKind.ChargerPower).Label);
        Assert.Equal("Voltage", Tile(display, ChargingTelemetryMetricKind.Voltage).Label);
        Assert.Equal("Current", Tile(display, ChargingTelemetryMetricKind.Current).Label);
        Assert.Equal("Energy Added", Tile(display, ChargingTelemetryMetricKind.EnergyAdded).Label);
        Assert.Equal("Charging State", Tile(display, ChargingTelemetryMetricKind.ChargingState).Label);
        Assert.Equal("Battery Level", Tile(display, ChargingTelemetryMetricKind.BatteryLevel).Label);
        Assert.Equal("Charge Rate", Tile(display, ChargingTelemetryMetricKind.ChargeRate).Label);
        Assert.Equal("Range Added", Tile(display, ChargingTelemetryMetricKind.RangeAdded).Label);
    }

    // ── Bug-for-bug: Charger Power (kW) and Energy Added (kWh) are NOT scaled ─────────────────────────────

    [Fact]
    public void Charger_power_renders_raw_watts_beside_a_kw_label_bug_for_bug()
    {
        // Web `${fmtNumber(charger_power_w)} kW` appends the label WITHOUT scaling W→kW, so 7600 W → "7,600.00 kW".
        Assert.Equal("7,600.00 kW", Tile(Ready(Readings(powerW: 7600)), ChargingTelemetryMetricKind.ChargerPower).Value);
    }

    [Fact]
    public void Energy_added_renders_raw_watt_hours_beside_a_kwh_label_bug_for_bug()
    {
        // Web `${fmtNumber(charge_energy_added_wh)} kWh` appends the label WITHOUT scaling Wh→kWh.
        Assert.Equal("5,000.00 kWh", Tile(Ready(Readings(energyWh: 5000)), ChargingTelemetryMetricKind.EnergyAdded).Value);
    }

    [Fact]
    public void Power_and_energy_are_unaffected_by_the_imperial_unit_system()
    {
        // kW / kWh are hard-coded labels (the web has no user toggle for them); only locale + precision apply.
        var display = Project(ChargingTelemetrySectionModel.Ready(Readings(powerW: 7600, energyWh: 5000)), UnitPref.Imperial);

        Assert.Equal("7,600.00 kW", Tile(display, ChargingTelemetryMetricKind.ChargerPower).Value);
        Assert.Equal("5,000.00 kWh", Tile(display, ChargingTelemetryMetricKind.EnergyAdded).Value);
    }

    // ── Voltage / Current / Battery: a formatted magnitude beside a literal unit ──────────────────────────

    [Fact]
    public void Voltage_appends_a_volt_unit()
    {
        Assert.Equal("240.00 V", Tile(Ready(Readings(voltageV: 240)), ChargingTelemetryMetricKind.Voltage).Value);
    }

    [Fact]
    public void Current_appends_an_amp_unit()
    {
        Assert.Equal("32.00 A", Tile(Ready(Readings(currentA: 32)), ChargingTelemetryMetricKind.Current).Value);
    }

    [Fact]
    public void Battery_level_appends_a_percent_sign()
    {
        Assert.Equal("80.00%", Tile(Ready(Readings(batteryLevel: 80)), ChargingTelemetryMetricKind.BatteryLevel).Value);
    }

    [Fact]
    public void Non_finite_value_formats_as_zero_like_web_safeNumber()
    {
        // Web fmtNumber → safeNumber: NaN / Infinity render as 0, never "NaN".
        Assert.Equal("0.00 V", Tile(Ready(Readings(voltageV: double.NaN)), ChargingTelemetryMetricKind.Voltage).Value);
    }

    // ── Charging State: the raw backend string, em dash when null (NOT a localized "Unknown") ─────────────

    [Fact]
    public void Charging_state_shows_the_raw_backend_string()
    {
        Assert.Equal("Charging", Tile(Ready(Readings(state: "Charging")), ChargingTelemetryMetricKind.ChargingState).Value);
    }

    [Fact]
    public void Charging_state_falls_back_to_an_em_dash_when_null() =>
        Assert.Equal(EmDash, Tile(Ready(Readings(state: null)), ChargingTelemetryMetricKind.ChargingState).Value);

    // ── Charge Rate: metres-per-hour ÷ 3600 → SI m/s → display speed ─────────────────────────────────────

    [Fact]
    public void Charge_rate_converts_meters_per_hour_to_display_speed_metric()
    {
        // 36 000 m/h ÷ 3600 = 10 m/s → 36 km/h (speed default precision 0).
        Assert.Equal("36 km/h", Tile(Ready(Readings(rangeMetersPerHour: 36_000)), ChargingTelemetryMetricKind.ChargeRate).Value);
    }

    [Fact]
    public void Charge_rate_converts_meters_per_hour_to_display_speed_imperial()
    {
        // 36 000 m/h ÷ 3600 = 10 m/s ≈ 22.37 mph → "22 mph" (precision 0).
        var display = Project(ChargingTelemetrySectionModel.Ready(Readings(rangeMetersPerHour: 36_000)), UnitPref.Imperial);

        Assert.Equal("22 mph", Tile(display, ChargingTelemetryMetricKind.ChargeRate).Value);
    }

    [Fact]
    public void Charge_rate_falls_back_to_an_em_dash_when_null() =>
        Assert.Equal(EmDash, Tile(Ready(Readings(rangeMetersPerHour: null)), ChargingTelemetryMetricKind.ChargeRate).Value);

    // ── Range Added: SI metres → display distance ────────────────────────────────────────────────────────

    [Fact]
    public void Range_added_converts_meters_to_display_distance_metric()
    {
        // 16 000 m → 16.0 km (distance default precision 1).
        Assert.Equal("16.0 km", Tile(Ready(Readings(rangeMeters: 16_000)), ChargingTelemetryMetricKind.RangeAdded).Value);
    }

    [Fact]
    public void Range_added_converts_meters_to_display_distance_imperial()
    {
        // 16 000 m ÷ 1609.344 = 9.94 mi → "9.9 mi" (precision 1).
        var display = Project(ChargingTelemetrySectionModel.Ready(Readings(rangeMeters: 16_000)), UnitPref.Imperial);

        Assert.Equal("9.9 mi", Tile(display, ChargingTelemetryMetricKind.RangeAdded).Value);
    }

    [Fact]
    public void Range_added_falls_back_to_an_em_dash_when_null() =>
        Assert.Equal(EmDash, Tile(Ready(Readings(rangeMeters: null)), ChargingTelemetryMetricKind.RangeAdded).Value);

    // ── Precision follows the unit-pref global precision ─────────────────────────────────────────────────

    [Fact]
    public void Magnitude_values_follow_the_unit_pref_global_precision()
    {
        // Web fmtNumber uses the global decimal precision; the unit-pref Precision is that analogue.
        var display = Project(
            ChargingTelemetrySectionModel.Ready(Readings(powerW: 7600, voltageV: 240, batteryLevel: 80)),
            Units with { Precision = 0 });

        Assert.Equal("7,600 kW", Tile(display, ChargingTelemetryMetricKind.ChargerPower).Value);
        Assert.Equal("240 V", Tile(display, ChargingTelemetryMetricKind.Voltage).Value);
        Assert.Equal("80%", Tile(display, ChargingTelemetryMetricKind.BatteryLevel).Value);
    }

    // ── Per-tile accent maps the web MetricCard colour onto a design-token brush ─────────────────────────

    [Theory]
    [InlineData(ChargingTelemetryMetricKind.ChargerPower, "TsChartBatteryBrush")]   // web green
    [InlineData(ChargingTelemetryMetricKind.Voltage, "TsColorInfoBrush")]           // web cyan
    [InlineData(ChargingTelemetryMetricKind.Current, "TsChartPowerBrush")]          // web purple
    [InlineData(ChargingTelemetryMetricKind.EnergyAdded, "TsChartBatteryBrush")]    // web green
    [InlineData(ChargingTelemetryMetricKind.ChargingState, "TsColorInfoBrush")]     // web cyan
    [InlineData(ChargingTelemetryMetricKind.BatteryLevel, "TsChartBatteryBrush")]   // web green
    [InlineData(ChargingTelemetryMetricKind.ChargeRate, "TsColorInfoBrush")]        // web cyan
    [InlineData(ChargingTelemetryMetricKind.RangeAdded, "TsChartPowerBrush")]       // web purple
    public void Tile_accent_brush_matches_the_web_color(ChargingTelemetryMetricKind kind, string expected) =>
        Assert.Equal(expected, Tile(Ready(), kind).AccentBrushKey);

    // ── Freshness chip (stale / offline only) ────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Ready().ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(ChargingTelemetrySectionModel.Stale(Readings()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(ChargingTelemetrySectionModel.Offline(Readings()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_tiles()
    {
        var display = Project(ChargingTelemetrySectionModel.Offline(Readings(powerW: 7600, rangeMeters: 16_000)));

        Assert.Equal("7,600.00 kW", Tile(display, ChargingTelemetryMetricKind.ChargerPower).Value);
        Assert.Equal("16.0 km", Tile(display, ChargingTelemetryMetricKind.RangeAdded).Value);
    }

    // ── Fixed copy (loading / empty / error / retry) ───────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading...", Project(ChargingTelemetrySectionModel.Loading).LoadingLabel);

    [Fact]
    public void Empty_message_is_the_web_no_telemetry_string() =>
        Assert.Equal(
            "No charging telemetry available",
            Project(ChargingTelemetrySectionModel.Empty).EmptyMessage);

    [Fact]
    public void Error_title_resolves_from_the_query_error_facade() =>
        Assert.Equal("Failed to load data", Project(ChargingTelemetrySectionModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "Something went wrong on our end. Please try again.",
            Project(ChargingTelemetrySectionModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal(
            "Network unreachable",
            Project(ChargingTelemetrySectionModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(ChargingTelemetrySectionModel.Failed()).RetryLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(ChargingTelemetrySectionModel.Loading),
                Project(ChargingTelemetrySectionModel.Empty),
                Project(ChargingTelemetrySectionModel.Failed()),
                Project(ChargingTelemetrySectionModel.Stale(Readings())),
                Project(ChargingTelemetrySectionModel.Offline(Readings())),
                Ready(),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading...", Project(ChargingTelemetrySectionModel.Loading).AutomationName);

    [Fact]
    public void Empty_automation_name_pairs_the_title_and_empty_message() =>
        Assert.Equal(
            "Charging Telemetry. No charging telemetry available",
            Project(ChargingTelemetrySectionModel.Empty).AutomationName);

    [Fact]
    public void Error_automation_name_pairs_the_title_and_error_title() =>
        Assert.Equal(
            "Charging Telemetry. Failed to load data",
            Project(ChargingTelemetrySectionModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_the_title_and_each_tile()
    {
        var display = Ready(Readings(state: "Charging"));

        Assert.StartsWith("Charging Telemetry", display.AutomationName, StringComparison.Ordinal);
        foreach (var metric in display.Metrics)
        {
            Assert.Contains(metric.AutomationName, display.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.Contains("Stale", Project(ChargingTelemetrySectionModel.Stale(Readings())).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Tile_automation_name_is_label_then_value() =>
        Assert.Equal(
            "Charger Power: 7,600.00 kW",
            Tile(Ready(Readings(powerW: 7600)), ChargingTelemetryMetricKind.ChargerPower).AutomationName);

    // ── Diagnostics (P1/S11): view.opened slug=ChargingTelemetrySection, PII-safe ──────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChargingTelemetrySectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingTelemetrySection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_charging_behaviour()
    {
        var captured = new List<string>();
        var diagnostics = new ChargingTelemetrySectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=ChargingTelemetrySection", line);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
        Assert.DoesNotContain("%", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Complete", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ChargingTelemetrySection", ChargingTelemetrySectionRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargingTelemetrySectionProjection.Project(null!, Localizer, Units));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargingTelemetrySectionProjection.Project(ChargingTelemetrySectionModel.Loading, null!, Units));

    [Fact]
    public void Project_rejects_a_null_units() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargingTelemetrySectionProjection.Project(ChargingTelemetrySectionModel.Loading, Localizer, null!));
}
