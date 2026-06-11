using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>EnergyChargingPanel</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the two metric tiles (Charger Voltage / Charger Current with their unit
/// subtitles), the bug-for-bug Charger Power (kW) and Energy Added (kWh) readouts that the web source renders as a
/// raw SI magnitude beside a kilo-prefixed label, the Battery Level percentage, the Charge Rate
/// (metres-per-hour ÷ 3600 → SI m/s → display speed) conversion at the boundary, the tri-state charging chip, the
/// accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class EnergyChargingPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly UnitPref Units = UnitPref.Metric;

    private static EnergyChargingReadings Readings(
        double? voltageV = 240,
        double? currentA = 32,
        double? powerW = 7600,
        double? energyWh = 5000,
        string? state = "Charging",
        double? batteryLevel = 80,
        double? rangeMetersPerHour = 36_000) =>
        new(voltageV, currentA, powerW, energyWh, state, batteryLevel, rangeMetersPerHour);

    private static EnergyChargingPanelModel Model(bool loading = false, EnergyChargingReadings? readings = null) =>
        new(loading, readings);

    private static EnergyChargingPanelDisplay Project(EnergyChargingPanelModel model) =>
        EnergyChargingPanelProjection.Project(model, Localizer, Units);

    private static EnergyChargingPanelDisplay Project(EnergyChargingPanelModel model, UnitPref units) =>
        EnergyChargingPanelProjection.Project(model, Localizer, units);

    // ── Branch precedence: loading → empty → ready (web lifecycle) ──────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(EnergyChargingState.Loading, Project(EnergyChargingPanelModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_readings()
    {
        var display = Project(Model(loading: true, readings: Readings()));

        Assert.Equal(EnergyChargingState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_no_readings() =>
        Assert.Equal(EnergyChargingState.Empty, Project(EnergyChargingPanelModel.Empty).State);

    [Fact]
    public void Ready_when_readings_present() =>
        Assert.Equal(EnergyChargingState.Ready, Project(Model(readings: Readings())).State);

    [Fact]
    public void Ready_even_when_all_readings_are_null()
    {
        // Web parity: a truthy chargingTelemetry object with null fields still renders the body (em dashes), it is
        // only a null/undefined prop that collapses to the empty surface.
        var display = Project(Model(readings: Readings(
            voltageV: null, currentA: null, powerW: null, energyWh: null,
            state: null, batteryLevel: null, rangeMetersPerHour: null)));

        Assert.Equal(EnergyChargingState.Ready, display.State);
    }

    // ── Header ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Energy & Charging", Project(Model(readings: Readings())).Title);

    [Fact]
    public void Header_carries_the_battery_glyph() =>
        Assert.Equal(EnergyChargingPanelProjection.HeaderGlyph, Project(Model(readings: Readings())).HeaderGlyph);

    // ── Metric tiles: Charger Voltage / Charger Current ──────────────────────────────────────────────────

    [Fact]
    public void Voltage_tile_shows_formatted_value_and_volt_subtitle()
    {
        EnergyChargingMetric voltage = Project(Model(readings: Readings(voltageV: 240))).Voltage;

        Assert.Equal("Charger Voltage", voltage.Label);
        Assert.Equal("240.00", voltage.Value);
        Assert.Equal("V", voltage.Subtitle);
    }

    [Fact]
    public void Current_tile_shows_formatted_value_and_amp_subtitle()
    {
        EnergyChargingMetric current = Project(Model(readings: Readings(currentA: 32))).Current;

        Assert.Equal("Charger Current", current.Label);
        Assert.Equal("32.00", current.Value);
        Assert.Equal("A", current.Subtitle);
    }

    [Fact]
    public void Null_metric_values_fall_back_to_an_em_dash()
    {
        var display = Project(Model(readings: Readings(voltageV: null, currentA: null)));

        Assert.Equal("\u2014", display.Voltage.Value);
        Assert.Equal("\u2014", display.Current.Value);
        // The subtitle (unit) is always present, exactly as the web passes subtitle unconditionally.
        Assert.Equal("V", display.Voltage.Subtitle);
        Assert.Equal("A", display.Current.Subtitle);
    }

    [Fact]
    public void Non_finite_metric_value_formats_as_zero_like_web_safeNumber()
    {
        // Web fmtNumber → safeNumber: NaN / Infinity render as 0, never "NaN".
        EnergyChargingMetric voltage = Project(Model(readings: Readings(voltageV: double.NaN))).Voltage;

        Assert.Equal("0.00", voltage.Value);
    }

    // ── Bug-for-bug: Charger Power (kW) and Energy Added (kWh) are NOT scaled ─────────────────────────────

    [Fact]
    public void Charger_power_renders_raw_watts_beside_a_kw_label_bug_for_bug()
    {
        // Web fmtWithUnit(charger_power_w, 'kW') appends the label WITHOUT scaling W→kW, so 7600 W → "7,600.00 kW".
        EnergyChargingStat power = Project(Model(readings: Readings(powerW: 7600))).Power;

        Assert.Equal("Charger Power", power.Label);
        Assert.Equal("7,600.00 kW", power.Value);
    }

    [Fact]
    public void Energy_added_renders_raw_watt_hours_beside_a_kwh_label_bug_for_bug()
    {
        // Web fmtWithUnit(charge_energy_added_wh, 'kWh') appends the label WITHOUT scaling Wh→kWh.
        EnergyChargingStat energy = Project(Model(readings: Readings(energyWh: 5000))).Energy;

        Assert.Equal("Energy Added", energy.Label);
        Assert.Equal("5,000.00 kWh", energy.Value);
    }

    [Fact]
    public void Power_and_energy_fall_back_to_an_em_dash_when_null()
    {
        var display = Project(Model(readings: Readings(powerW: null, energyWh: null)));

        Assert.Equal("\u2014", display.Power.Value);
        Assert.Equal("\u2014", display.Energy.Value);
    }

    [Fact]
    public void Power_and_energy_are_unaffected_by_the_imperial_unit_system()
    {
        // kW / kWh are hard-coded labels (the web has no user toggle); only locale + precision apply, so an
        // imperial preference still renders the same raw magnitude.
        var display = Project(Model(readings: Readings(powerW: 7600, energyWh: 5000)), UnitPref.Imperial);

        Assert.Equal("7,600.00 kW", display.Power.Value);
        Assert.Equal("5,000.00 kWh", display.Energy.Value);
    }

    // ── Battery Level ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Battery_level_renders_a_formatted_percentage()
    {
        EnergyChargingStat battery = Project(Model(readings: Readings(batteryLevel: 80))).Battery;

        Assert.Equal("Battery Level", battery.Label);
        Assert.Equal("80.00%", battery.Value);
    }

    [Fact]
    public void Battery_level_falls_back_to_an_em_dash_when_null() =>
        Assert.Equal("\u2014", Project(Model(readings: Readings(batteryLevel: null))).Battery.Value);

    // ── Charge Rate: metres-per-hour ÷ 3600 → SI m/s → display speed ─────────────────────────────────────

    [Fact]
    public void Charge_rate_converts_meters_per_hour_to_display_speed_metric()
    {
        // 36 000 m/h ÷ 3600 = 10 m/s → 36 km/h (speed default precision 0).
        EnergyChargingStat rate = Project(Model(readings: Readings(rangeMetersPerHour: 36_000))).ChargeRate;

        Assert.Equal("Charge Rate", rate.Label);
        Assert.Equal("36 km/h", rate.Value);
    }

    [Fact]
    public void Charge_rate_converts_meters_per_hour_to_display_speed_imperial()
    {
        // 36 000 m/h ÷ 3600 = 10 m/s → 22 mph (10 m/s ≈ 22.37 mph, precision 0).
        EnergyChargingStat rate = Project(Model(readings: Readings(rangeMetersPerHour: 36_000)), UnitPref.Imperial).ChargeRate;

        Assert.Equal("22 mph", rate.Value);
    }

    [Fact]
    public void Charge_rate_carries_the_lightning_glyph()
    {
        EnergyChargingStat rate = Project(Model(readings: Readings())).ChargeRate;

        Assert.Equal(EnergyChargingPanelProjection.ChargeRateGlyph, rate.Glyph);
    }

    [Fact]
    public void Charge_rate_falls_back_to_an_em_dash_when_null() =>
        Assert.Equal("\u2014", Project(Model(readings: Readings(rangeMetersPerHour: null))).ChargeRate.Value);

    [Fact]
    public void Only_the_charge_rate_row_carries_a_glyph()
    {
        var display = Project(Model(readings: Readings()));

        Assert.Equal(string.Empty, display.Power.Glyph);
        Assert.Equal(string.Empty, display.Energy.Glyph);
        Assert.Equal(string.Empty, display.Battery.Glyph);
        Assert.NotEqual(string.Empty, display.ChargeRate.Glyph);
    }

    // ── Charging State chip: tri-state tone + text ───────────────────────────────────────────────────────

    [Fact]
    public void Charging_state_is_cyan_when_charging()
    {
        EnergyChargingChip chip = Project(Model(readings: Readings(state: "Charging"))).ChargingState;

        Assert.Equal("Charging State", chip.Label);
        Assert.Equal("Charging", chip.Value);
        Assert.Equal(ChargingStateTone.Charging, chip.Tone);
    }

    [Fact]
    public void Charging_state_is_green_when_complete()
    {
        EnergyChargingChip chip = Project(Model(readings: Readings(state: "Complete"))).ChargingState;

        Assert.Equal("Complete", chip.Value);
        Assert.Equal(ChargingStateTone.Complete, chip.Tone);
    }

    [Fact]
    public void Charging_state_is_neutral_for_any_other_state()
    {
        EnergyChargingChip chip = Project(Model(readings: Readings(state: "Disconnected"))).ChargingState;

        Assert.Equal("Disconnected", chip.Value);
        Assert.Equal(ChargingStateTone.Neutral, chip.Tone);
    }

    [Fact]
    public void Charging_state_falls_back_to_unknown_when_null()
    {
        // Web: charging_state ?? t('common.unknown'); the null state also lands in the neutral tone else-branch.
        EnergyChargingChip chip = Project(Model(readings: Readings(state: null))).ChargingState;

        Assert.Equal("Unknown", chip.Value);
        Assert.Equal(ChargingStateTone.Neutral, chip.Tone);
    }

    // ── Precision follows the unit-pref global precision ─────────────────────────────────────────────────

    [Fact]
    public void Metric_and_unit_values_follow_the_unit_pref_global_precision()
    {
        // Web fmtNumber uses the global decimal precision; the unit-pref Precision is that analogue.
        var display = Project(Model(readings: Readings(voltageV: 240, powerW: 7600, batteryLevel: 80)), Units with { Precision = 0 });

        Assert.Equal("240", display.Voltage.Value);
        Assert.Equal("7,600 kW", display.Power.Value);
        Assert.Equal("80%", display.Battery.Value);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(EnergyChargingPanelModel.Pending),
                Project(EnergyChargingPanelModel.Empty),
                Project(Model(readings: Readings())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label()
    {
        var display = Project(EnergyChargingPanelModel.Pending);

        Assert.Equal("Loading...", display.LoadingLabel);
        Assert.Equal("Loading...", display.AutomationName);
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_message()
    {
        var display = Project(EnergyChargingPanelModel.Empty);

        Assert.Equal("No charging telemetry available", display.EmptyMessage);
        Assert.Equal("Energy & Charging. No charging telemetry available", display.AutomationName);
    }

    [Fact]
    public void Ready_automation_name_carries_the_title_and_each_row()
    {
        var display = Project(Model(readings: Readings(state: "Charging")));

        Assert.StartsWith("Energy & Charging", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Charger Voltage: 240.00 V", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Charging State: Charging", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Charge Rate: 36 km/h", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stat_automation_name_is_label_then_value()
    {
        var display = Project(Model(readings: Readings(powerW: 7600)));

        Assert.Equal("Charger Power: 7,600.00 kW", display.Power.AutomationName);
    }

    [Fact]
    public void Metric_automation_name_includes_the_unit_subtitle()
    {
        var display = Project(Model(readings: Readings(currentA: 32)));

        Assert.Equal("Charger Current: 32.00 A", display.Current.AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=EnergyChargingPanel, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new EnergyChargingPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnergyChargingPanel", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_charging_behaviour()
    {
        var captured = new List<string>();
        var diagnostics = new EnergyChargingPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=EnergyChargingPanel", line);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Complete", line, StringComparison.Ordinal);
        Assert.DoesNotContain("%", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("EnergyChargingPanel", EnergyChargingPanelRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => EnergyChargingPanelProjection.Project(null!, Localizer, Units));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => EnergyChargingPanelProjection.Project(EnergyChargingPanelModel.Pending, null!, Units));

    [Fact]
    public void Project_rejects_a_null_units() =>
        Assert.Throws<ArgumentNullException>(
            () => EnergyChargingPanelProjection.Project(EnergyChargingPanelModel.Pending, Localizer, null!));
}
