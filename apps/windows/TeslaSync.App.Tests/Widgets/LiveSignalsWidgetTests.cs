using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the LiveSignalsWidget's UI-thread-free logic — the four JSON parse adapters (the
/// useMotorLatest / useClimateLatest / useSecurityLatest / useLatestTirePressure reads), the torque / temperature
/// / HVAC / pressure / gear formatters, the security chip mapping, the projection + per-section skeleton gate, the
/// Narrator name, the motor-driven four-source combine mapper, the concurrent per-vehicle data source (primary
/// resolution + the four scoped reads), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/LiveSignalsWidget.tsx).
/// </summary>
public sealed class LiveSignalsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string MotorJson = """{"vehicle_id":7,"di_torque":300,"di_stator_temp":45,"gear":"D"}""";
    private const string ClimateJson = """{"vehicle_id":7,"inside_temp":21,"outside_temp":15,"hvac_power":2.5}""";
    private const string SecurityJson = """{"vehicle_id":7,"locked":true,"sentry_mode":false}""";
    private const string TireJson = """{"vehicle_id":7,"front_left":280,"front_right":280,"rear_left":270,"rear_right":270}""";

    // ---- Parse adapters (web hook reads) -------------------------------------------

    [Fact]
    public void MotorReading_reads_torque_temp_gear()
    {
        using var doc = JsonDocument.Parse(MotorJson);
        var reading = LiveMotorReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(300, reading!.TorqueNm);
        Assert.Equal(45, reading.StatorTempC);
        Assert.Equal("D", reading.Gear);
    }

    [Fact]
    public void ClimateReading_reads_inside_outside_hvac()
    {
        using var doc = JsonDocument.Parse(ClimateJson);
        var reading = LiveClimateReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(21, reading!.InsideTempC);
        Assert.Equal(15, reading.OutsideTempC);
        Assert.Equal(2.5, reading.HvacPowerKw);
    }

    [Fact]
    public void SecurityReading_reads_locked_and_sentry()
    {
        using var doc = JsonDocument.Parse(SecurityJson);
        var reading = LiveSecurityReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.True(reading!.Locked);
        Assert.False(reading.SentryMode);
    }

    [Fact]
    public void TireReading_reads_four_corners()
    {
        using var doc = JsonDocument.Parse(TireJson);
        var reading = LiveTireReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(280, reading!.FrontLeftKpa);
        Assert.Equal(280, reading.FrontRightKpa);
        Assert.Equal(270, reading.RearLeftKpa);
        Assert.Equal(270, reading.RearRightKpa);
    }

    [Fact]
    public void Readings_are_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var motor = LiveMotorReading.FromResponse(doc.RootElement);
        Assert.NotNull(motor);
        Assert.Null(motor!.TorqueNm);
        Assert.Null(motor.StatorTempC);
        Assert.Null(motor.Gear);

        var security = LiveSecurityReading.FromResponse(doc.RootElement);
        Assert.NotNull(security);
        Assert.Null(security!.Locked);
        Assert.Null(security.SentryMode);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void Readings_return_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(LiveMotorReading.FromResponse(doc.RootElement));
        Assert.Null(LiveClimateReading.FromResponse(doc.RootElement));
        Assert.Null(LiveSecurityReading.FromResponse(doc.RootElement));
        Assert.Null(LiveTireReading.FromResponse(doc.RootElement));
    }

    // ---- Torque formatter (web `${di_torque} Nm`, raw) -----------------------------

    [Theory]
    [InlineData(300, "300 Nm")]
    [InlineData(42.5, "42.5 Nm")]
    [InlineData(0, "0 Nm")]
    public void FormatTorque_matches_web(double nm, string expected) =>
        Assert.Equal(expected, LiveSignalsProjection.FormatTorque(nm));

    [Fact]
    public void FormatTorque_null_is_em_dash() =>
        Assert.Equal("\u2014", LiveSignalsProjection.FormatTorque(null));

    // ---- Temperature formatter (web fmtInt(convertTempFromSI(…)) + unit) -----------

    [Fact]
    public void FormatTemperature_metric_rounds_to_celsius_integer()
    {
        Assert.Equal("21\u00B0C", LiveSignalsProjection.FormatTemperature(21.4, UnitPref.Metric));
        Assert.Equal("45\u00B0C", LiveSignalsProjection.FormatTemperature(45, UnitPref.Metric));
    }

    [Fact]
    public void FormatTemperature_imperial_converts_to_fahrenheit() =>
        Assert.Equal("68\u00B0F", LiveSignalsProjection.FormatTemperature(20, UnitPref.Imperial));

    [Fact]
    public void FormatTemperature_null_is_em_dash() =>
        Assert.Equal("\u2014", LiveSignalsProjection.FormatTemperature(null, UnitPref.Metric));

    // ---- HVAC formatter (web fmtNumber(hvac_power, 1) + ' kW') ----------------------

    [Theory]
    [InlineData(2.5, "2.5 kW")]
    [InlineData(0, "0.0 kW")]
    [InlineData(11.25, "11.3 kW")]
    public void FormatHvac_matches_web(double kw, string expected) =>
        Assert.Equal(expected, LiveSignalsProjection.FormatHvac(kw));

    [Fact]
    public void FormatHvac_null_is_em_dash() =>
        Assert.Equal("\u2014", LiveSignalsProjection.FormatHvac(null));

    // ---- Pressure formatter (web fmtNumber(convertPressureFromSI(…), 1) + ' ' + unit) --

    [Fact]
    public void FormatPressure_metric_keeps_kpa()
    {
        Assert.Equal("280.0 kPa", LiveSignalsProjection.FormatPressure(280, UnitPref.Metric));
    }

    [Fact]
    public void FormatPressure_imperial_converts_to_psi()
    {
        // 280 kPa / 6.894757 = 40.61 psi → fmtNumber(…, 1) = "40.6".
        Assert.Equal("40.6 psi", LiveSignalsProjection.FormatPressure(280, UnitPref.Imperial));
    }

    [Fact]
    public void FormatPressure_null_is_em_dash() =>
        Assert.Equal("\u2014", LiveSignalsProjection.FormatPressure(null, UnitPref.Metric));

    // ---- Gear formatter (web cleanNil(gear) ?? '—') --------------------------------

    [Theory]
    [InlineData("D", "D")]
    [InlineData("R", "R")]
    [InlineData("<nil>", "\u2014")]
    [InlineData("nil", "\u2014")]
    [InlineData("null", "\u2014")]
    [InlineData("", "\u2014")]
    [InlineData(null, "\u2014")]
    public void FormatGear_strips_nil_like_values(string? gear, string expected) =>
        Assert.Equal(expected, LiveSignalsProjection.FormatGear(gear));

    // ---- Projection (rows + chips + per-section skeleton gate) ----------------------

    [Fact]
    public void Project_renders_all_four_sections()
    {
        var display = LiveSignalsProjection.Project(FullReading(), UnitPref.Metric, Localizer);

        Assert.Equal("Motor", display.MotorLabel);
        Assert.NotNull(display.MotorRows);
        Assert.Collection(
            display.MotorRows!,
            r => AssertRow(r, "Torque", "300 Nm"),
            r => AssertRow(r, "Temp", "45\u00B0C"),
            r => AssertRow(r, "Gear", "D"));

        Assert.NotNull(display.ClimateRows);
        Assert.Collection(
            display.ClimateRows!,
            r => AssertRow(r, "Cabin", "21\u00B0C"),
            r => AssertRow(r, "Outside", "15\u00B0C"),
            r => AssertRow(r, "HVAC", "2.5 kW"));

        Assert.NotNull(display.TireRows);
        Assert.Collection(
            display.TireRows!,
            r => AssertRow(r, "FL", "280.0 kPa"),
            r => AssertRow(r, "FR", "280.0 kPa"),
            r => AssertRow(r, "RL", "270.0 kPa"),
            r => AssertRow(r, "RR", "270.0 kPa"));

        Assert.NotNull(display.SecurityChips);
        Assert.Collection(
            display.SecurityChips!,
            c => AssertChip(c, "Lock", "Locked", StatusKind.Success),
            c => AssertChip(c, "Sentry", "Off", StatusKind.Neutral));
    }

    [Fact]
    public void Project_null_section_yields_null_rows_for_skeleton()
    {
        // Web parity: a null slice renders the cell's <Skeleton/> — modelled as a null row list.
        var reading = new LiveSignalsReading(Motor(), null, null, null);

        var display = LiveSignalsProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.NotNull(display.MotorRows);
        Assert.Null(display.ClimateRows);
        Assert.Null(display.TireRows);
        Assert.Null(display.SecurityChips);
    }

    [Fact]
    public void Project_em_dashes_null_readings_within_a_present_section()
    {
        var reading = new LiveSignalsReading(new LiveMotorReading(null, null, null), null, null, null);

        var display = LiveSignalsProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.NotNull(display.MotorRows);
        Assert.All(display.MotorRows!, r => Assert.Equal("\u2014", r.Value));
    }

    [Theory]
    [InlineData(true, "Locked", false, "Off")]
    [InlineData(false, "Unlocked", true, "Active")]
    public void Project_security_chip_text_matches_web(bool locked, string lockText, bool sentry, string sentryText)
    {
        var reading = new LiveSignalsReading(null, null, new LiveSecurityReading(locked, sentry), null);

        var display = LiveSignalsProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.NotNull(display.SecurityChips);
        Assert.Equal(lockText, display.SecurityChips![0].Text);
        Assert.Equal(sentryText, display.SecurityChips[1].Text);
    }

    [Fact]
    public void Project_security_null_booleans_render_locked_off_branch()
    {
        // Web parity: security.locked / sentry_mode are read truthily, so null → "Unlocked" / "Off".
        var reading = new LiveSignalsReading(null, null, new LiveSecurityReading(null, null), null);

        var display = LiveSignalsProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.NotNull(display.SecurityChips);
        AssertChip(display.SecurityChips![0], "Lock", "Unlocked", StatusKind.Danger);
        AssertChip(display.SecurityChips[1], "Sentry", "Off", StatusKind.Neutral);
    }

    // ---- Accessibility (Narrator name) ---------------------------------------------

    [Fact]
    public void Project_automation_name_summarises_present_sections()
    {
        var reading = new LiveSignalsReading(Motor(), null, Security(), null);

        var display = LiveSignalsProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.Equal(
            "Motor: Torque 300 Nm, Temp 45\u00B0C, Gear D; Security: Lock Locked, Sentry Off",
            display.AutomationName);
    }

    // ---- Result mapper (motor-driven freshness + hasData gate) ----------------------

    [Fact]
    public void Combine_motor_only_loaded_renders_grid()
    {
        using var motor = JsonDocument.Parse(MotorJson);
        var combined = LiveSignalsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(motor.RootElement, Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Loaded, combined.Status);
        Assert.NotNull(combined.Value);
        Assert.NotNull(combined.Value!.Motor);
        Assert.Null(combined.Value.Climate);
        Assert.Equal(Now, combined.FetchedAt);
    }

    [Fact]
    public void Combine_no_content_collapses_to_empty()
    {
        var combined = LiveSignalsResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Empty, combined.Status);
        Assert.Null(combined.Value);
    }

    [Fact]
    public void Combine_motor_error_with_no_content_collapses_to_failure()
    {
        var combined = LiveSignalsResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Error, combined.Status);
        Assert.NotNull(combined.Error);
    }

    [Fact]
    public void Combine_motor_error_but_other_content_keeps_grid_offline()
    {
        using var climate = JsonDocument.Parse(ClimateJson);
        var combined = LiveSignalsResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Network, "down")),
            RepositoryResult<JsonElement>.Loaded(climate.RootElement, Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Offline, combined.Status);
        Assert.NotNull(combined.Value!.Climate);
        Assert.Null(combined.Value.Motor);
    }

    [Fact]
    public void Combine_motor_stale_marks_grid_stale()
    {
        using var motor = JsonDocument.Parse(MotorJson);
        var combined = LiveSignalsResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(motor.RootElement, Now, stale: true),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Cached, combined.Status);
        Assert.True(combined.IsStale);
    }

    [Fact]
    public void Combine_motor_offline_marks_grid_offline()
    {
        using var motor = JsonDocument.Parse(MotorJson);
        var combined = LiveSignalsResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(motor.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Offline, combined.Status);
        Assert.NotNull(combined.Value!.Motor);
    }

    [Fact]
    public void Combine_motor_loading_but_other_content_keeps_grid_refreshing()
    {
        using var tires = JsonDocument.Parse(TireJson);
        var combined = LiveSignalsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loading(),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Loaded(tires.RootElement, Now));

        Assert.Equal(LoadStatus.Refreshing, combined.Status);
        Assert.NotNull(combined.Value!.Tires);
        Assert.Null(combined.Value.Motor);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<LiveSignalsReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_grid_display()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("300 Nm", vm.Display!.MotorRows![0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<LiveSignalsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No live signal data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<LiveSignalsReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<LiveSignalsReading>.Cached(FullReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<LiveSignalsReading>.OfflineCached(
            FullReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<LiveSignalsReading>.Loading(),
            RepositoryResult<LiveSignalsReading>.Cached(new LiveSignalsReading(Motor(), null, null, null), Now, stale: false),
            RepositoryResult<LiveSignalsReading>.Loaded(FullReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(LiveSignalsState.Loaded, vm.State);
        Assert.NotNull(vm.Display!.SecurityChips);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperatures_and_pressures()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        await vm.LoadAsync();
        Assert.Equal("45\u00B0C", vm.Display!.MotorRows![1].Value);
        Assert.Equal("280.0 kPa", vm.Display.TireRows![0].Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("113\u00B0F", vm.Display!.MotorRows![1].Value); // 45°C → 113°F
        Assert.Equal("40.6 psi", vm.Display.TireRows![0].Value);
        Assert.Equal(LiveSignalsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<LiveSignalsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Live Signals", vm.Title);
        Assert.Equal("No live signal data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(LiveSignalsViewModel.State), changed);
        Assert.Contains(nameof(LiveSignalsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("live-signals", LiveSignalsRegistration.Id);
        Assert.Equal("telemetry", LiveSignalsRegistration.Category);
        Assert.Equal("LiveSignalsWidget", LiveSignalsRegistration.Slug);
        Assert.Equal(new LiveSignalsSize(2, 4), LiveSignalsRegistration.DefaultSize);
        Assert.Equal(new LiveSignalsSize(2, 2), LiveSignalsRegistration.MinSize);
        Assert.Equal(new LiveSignalsSize(4, 40), LiveSignalsRegistration.MaxSize);
        Assert.Equal("Live Signals", LiveSignalsRegistration.Name(Localizer));
        Assert.Equal("Real-time signal values with sparklines", LiveSignalsRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(2, 1, false)]   // below min rows
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, LiveSignalsRegistration.IsWithinBounds(new LiveSignalsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new LiveSignalsSize(2, 2), LiveSignalsRegistration.Clamp(new LiveSignalsSize(0, 0)));
        Assert.Equal(new LiveSignalsSize(4, 40), LiveSignalsRegistration.Clamp(new LiveSignalsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LiveSignalsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveSignalsWidget", Assert.Single(lines));
    }

    // ---- Source (concurrent four-endpoint per-vehicle adapter) ----------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new KeyedFakeApiClient();
        var source = new LiveSignalsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_then_merges_four_reads()
    {
        using var motor = JsonDocument.Parse(MotorJson);
        using var climate = JsonDocument.Parse(ClimateJson);
        using var security = JsonDocument.Parse(SecurityJson);
        using var tires = JsonDocument.Parse(TireJson);
        var api = new KeyedFakeApiClient()
            .Returns(MotorOperation, motor.RootElement)
            .Returns(Operations.Climate.Latest, climate.RootElement)
            .Returns(SecurityOperation, security.RootElement)
            .Returns(TireOperation, tires.RootElement);

        var source = new LiveSignalsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);
        var terminal = results[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.NotNull(terminal.Value!.Motor);
        Assert.NotNull(terminal.Value.Climate);
        Assert.NotNull(terminal.Value.Security);
        Assert.NotNull(terminal.Value.Tires);
        Assert.Equal("D", terminal.Value.Motor!.Gear);

        Assert.Equal(7L, Convert.ToInt64(Request(api, MotorOperation).Query!["vehicle_id"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(7L, Convert.ToInt64(Request(api, Operations.Climate.Latest).Query!["vehicle_id"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(7L, Convert.ToInt64(Request(api, SecurityOperation).Query!["vehicle_id"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(7L, Convert.ToInt64(Request(api, TireOperation).Query!["vehicle_id"], System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_scopes_every_read()
    {
        using var motor = JsonDocument.Parse(MotorJson);
        using var climate = JsonDocument.Parse(ClimateJson);
        using var security = JsonDocument.Parse(SecurityJson);
        using var tires = JsonDocument.Parse(TireJson);
        var api = new KeyedFakeApiClient()
            .Returns(MotorOperation, motor.RootElement)
            .Returns(Operations.Climate.Latest, climate.RootElement)
            .Returns(SecurityOperation, security.RootElement)
            .Returns(TireOperation, tires.RootElement);

        var source = new LiveSignalsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(42L, Convert.ToInt64(Request(api, MotorOperation).Query!["vehicle_id"], System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_motor_only_content_renders_grid_with_other_skeletons()
    {
        using var motor = JsonDocument.Parse(MotorJson);
        using var nullBody = JsonDocument.Parse("null");
        var api = new KeyedFakeApiClient()
            .Returns(MotorOperation, motor.RootElement)
            .Returns(Operations.Climate.Latest, nullBody.RootElement)
            .Returns(SecurityOperation, nullBody.RootElement)
            .Returns(TireOperation, nullBody.RootElement);

        var source = new LiveSignalsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);
        var terminal = results[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.NotNull(terminal.Value!.Motor);
        Assert.Null(terminal.Value.Climate);
        Assert.Null(terminal.Value.Security);
        Assert.Null(terminal.Value.Tires);
    }

    [Fact]
    public async Task Source_all_empty_bodies_collapse_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new KeyedFakeApiClient()
            .Returns(MotorOperation, nullBody.RootElement)
            .Returns(Operations.Climate.Latest, nullBody.RootElement)
            .Returns(SecurityOperation, nullBody.RootElement)
            .Returns(TireOperation, nullBody.RootElement);

        var source = new LiveSignalsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private const string MotorOperation = "get_api_v1_motor_latest";
    private const string SecurityOperation = "get_api_v1_security_latest";
    private const string TireOperation = "get_api_v1_tire_pressure_latest";

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static LiveMotorReading Motor() => new(300, 45, "D");

    private static LiveClimateReading Climate() => new(21, 15, 2.5);

    private static LiveSecurityReading Security() => new(true, false);

    private static LiveTireReading Tires() => new(280, 280, 270, 270);

    private static LiveSignalsReading FullReading() => new(Motor(), Climate(), Security(), Tires());

    private static RepositoryResult<LiveSignalsReading> Loaded(LiveSignalsReading reading) =>
        RepositoryResult<LiveSignalsReading>.Loaded(reading, Now);

    private static LiveSignalsViewModel NewViewModel(params RepositoryResult<LiveSignalsReading>[] emissions) =>
        new(new FakeLiveSignalsSource(emissions), Localizer, LiveSignalsRegistration.DefaultSize);

    private static async Task<List<RepositoryResult<LiveSignalsReading>>> DrainAsync(ILiveSignalsSource source)
    {
        var list = new List<RepositoryResult<LiveSignalsReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static ApiRequest Request(KeyedFakeApiClient api, string operationId) =>
        api.Requests.First(r => r.OperationId == operationId);

    private static void AssertRow(LiveSignalRow row, string label, string value)
    {
        Assert.Equal(label, row.Label);
        Assert.Equal(value, row.Value);
    }

    private static void AssertChip(LiveSecurityChip chip, string label, string text, StatusKind variant)
    {
        Assert.Equal(label, chip.Label);
        Assert.Equal(text, chip.Text);
        Assert.Equal(variant, chip.Variant);
    }

    private sealed class FakeLiveSignalsSource(params RepositoryResult<LiveSignalsReading>[] emissions) : ILiveSignalsSource
    {
        public async IAsyncEnumerable<RepositoryResult<LiveSignalsReading>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }

    private sealed class KeyedFakeApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<object?>> _responses = new(StringComparer.Ordinal);
        private readonly object _gate = new();

        public List<ApiRequest> Requests { get; } = new();

        public KeyedFakeApiClient Returns<T>(string operationId, T value)
        {
            _responses[operationId] = () => value;
            return this;
        }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (_gate)
            {
                Requests.Add(request);
            }

            if (!_responses.TryGetValue(request.OperationId, out var factory))
            {
                throw new InvalidOperationException($"No scripted response for {request.OperationId}");
            }

            return Task.FromResult((T)factory()!);
        }
    }
}
