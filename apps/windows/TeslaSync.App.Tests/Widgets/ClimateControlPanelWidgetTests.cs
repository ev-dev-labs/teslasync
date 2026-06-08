using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the ClimateControlPanelWidget's UI-thread-free logic — the JSON parse adapter (the
/// useClimateLatest read), the temperature / HVAC-power / fan / heat-level formatters, the HVAC-on guard, the
/// seat-heater builder, the conditional defrost / battery-heater chip guards, the projection, the compact and
/// full Narrator names, the result mapper, the single-endpoint per-vehicle data source (primary resolution +
/// the query-scoped climate read), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ClimateControlPanelWidget.tsx).
/// </summary>
public sealed class ClimateControlPanelWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string ClimateJson =
        """
        {"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","inside_temp":21,"outside_temp":15,"hvac_power":2.5,
        "hvac_ac_enabled":true,"hvac_fan_speed":5,"seat_heater_left":2,"seat_heater_rear_right":1,
        "hvac_steering_wheel_heat_level":3,"defrost_mode":"Front","battery_heater_on":true}
        """;

    private const string IdleJson =
        """
        {"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","inside_temp":18,"outside_temp":10,"hvac_power":0,
        "hvac_ac_enabled":false,"hvac_fan_speed":0,"hvac_steering_wheel_heat_level":0,"defrost_mode":"Off",
        "battery_heater_on":false}
        """;

    // ---- Parse adapter (web useClimateLatest read) ---------------------------------

    [Fact]
    public void FromResponse_reads_all_panel_fields()
    {
        using var doc = JsonDocument.Parse(ClimateJson);

        var reading = ClimateControlPanelReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(21, reading!.InsideTempC);
        Assert.Equal(15, reading.OutsideTempC);
        Assert.Equal(2.5, reading.HvacPowerKw);
        Assert.True(reading.HvacAcEnabled);
        Assert.Equal(5, reading.FanSpeed);
        Assert.Equal(2, reading.SeatHeaterLeft);
        Assert.Equal(1, reading.SeatHeaterRearRight);
        Assert.Equal(3, reading.SteeringWheelHeatLevel);
        Assert.Equal("Front", reading.DefrostMode);
        Assert.True(reading.BatteryHeaterOn);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"ts":"t"}""");

        var reading = ClimateControlPanelReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.InsideTempC);
        Assert.Null(reading.OutsideTempC);
        Assert.Null(reading.HvacPowerKw);
        Assert.False(reading.HvacAcEnabled);
        Assert.Null(reading.FanSpeed);
        Assert.Null(reading.SeatHeaterLeft);
        Assert.Null(reading.SteeringWheelHeatLevel);
        Assert.Null(reading.DefrostMode);
        Assert.False(reading.BatteryHeaterOn);
    }

    [Fact]
    public void FromResponse_treats_explicit_null_numbers_as_null()
    {
        // Web parity: `inside_temp != null` — a JSON null reads as "no value" → the em dash.
        using var doc = JsonDocument.Parse("""{"inside_temp":null,"hvac_power":null,"hvac_fan_speed":null,"seat_heater_left":null}""");

        var reading = ClimateControlPanelReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.InsideTempC);
        Assert.Null(reading.HvacPowerKw);
        Assert.Null(reading.FanSpeed);
        Assert.Null(reading.SeatHeaterLeft);
    }

    [Fact]
    public void FromResponse_rounds_non_integer_levels()
    {
        // Tesla reports integer levels; a JSON 3.0 / "2" still resolves to the integer level.
        using var doc = JsonDocument.Parse("""{"hvac_fan_speed":3.0,"seat_heater_left":"2","hvac_steering_wheel_heat_level":1}""");

        var reading = ClimateControlPanelReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(3, reading!.FanSpeed);
        Assert.Equal(2, reading.SeatHeaterLeft);
        Assert.Equal(1, reading.SteeringWheelHeatLevel);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(ClimateControlPanelReading.FromResponse(doc.RootElement));
    }

    // ---- Temperature formatter (web fmtInt(convertTempFromSI(…)) + unit) ------------

    [Fact]
    public void FormatTemperature_metric_rounds_to_celsius_integer()
    {
        Assert.Equal("21\u00B0C", ClimateControlPanelProjection.FormatTemperature(21.4, UnitPref.Metric));
        Assert.Equal("15\u00B0C", ClimateControlPanelProjection.FormatTemperature(15, UnitPref.Metric));
    }

    [Fact]
    public void FormatTemperature_imperial_converts_to_fahrenheit()
    {
        // 20°C → 68°F (web convertTempFromSI to '°F').
        Assert.Equal("68\u00B0F", ClimateControlPanelProjection.FormatTemperature(20, UnitPref.Imperial));
    }

    [Fact]
    public void FormatTemperature_null_is_em_dash() =>
        Assert.Equal("\u2014", ClimateControlPanelProjection.FormatTemperature(null, UnitPref.Metric));

    // ---- HVAC power formatter (web hvac_power > 0 ? fmtNumber(hvac_power, 1) + ' kW') --

    [Theory]
    [InlineData(2.5, "2.5 kW")]
    [InlineData(11.25, "11.3 kW")]
    public void FormatHvacPower_shows_when_positive(double kw, string expected) =>
        Assert.Equal(expected, ClimateControlPanelProjection.FormatHvacPower(kw));

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public void FormatHvacPower_hidden_when_not_positive(double kw) =>
        Assert.Null(ClimateControlPanelProjection.FormatHvacPower(kw));

    [Fact]
    public void FormatHvacPower_null_is_hidden() =>
        Assert.Null(ClimateControlPanelProjection.FormatHvacPower(null));

    // ---- Fan + heat-level formatters (web raw interpolation / `${level}/3`) ----------

    [Theory]
    [InlineData(5, "5")]
    [InlineData(0, "0")]
    public void FormatFanSpeed_shows_raw_level(int speed, string expected) =>
        Assert.Equal(expected, ClimateControlPanelProjection.FormatFanSpeed(speed));

    [Fact]
    public void FormatFanSpeed_null_is_em_dash() =>
        Assert.Equal("\u2014", ClimateControlPanelProjection.FormatFanSpeed(null));

    [Theory]
    [InlineData(3, "3/3")]
    [InlineData(1, "1/3")]
    public void FormatHeatLevel_positive_is_over_three(int level, string expected) =>
        Assert.Equal(expected, ClimateControlPanelProjection.FormatHeatLevel(level, "Off"));

    [Fact]
    public void FormatHeatLevel_zero_or_null_is_off()
    {
        Assert.Equal("Off", ClimateControlPanelProjection.FormatHeatLevel(0, "Off"));
        Assert.Equal("Off", ClimateControlPanelProjection.FormatHeatLevel(null, "Off"));
    }

    // ---- HVAC-on guard (web (hvac_power > 0) || hvac_ac_enabled) --------------------

    [Theory]
    [InlineData(2.5, false, true)]   // power on
    [InlineData(0.0, true, true)]    // a/c on
    [InlineData(null, true, true)]   // a/c on, no power reading
    [InlineData(0.0, false, false)]  // both off
    [InlineData(null, false, false)] // both unknown/off
    public void HvacOn_matches_web(double? power, bool ac, bool expected)
    {
        var reading = Reading() with { HvacPowerKw = power, HvacAcEnabled = ac };
        Assert.Equal(expected, ClimateControlPanelProjection.HvacOn(reading));
    }

    // ---- Defrost chip guard (web defrost_mode && defrost_mode !== 'Off') ------------

    [Theory]
    [InlineData("Front", true)]
    [InlineData("Rear", true)]
    [InlineData("Off", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void ShowDefrost_matches_web(string? mode, bool expected) =>
        Assert.Equal(expected, ClimateControlPanelProjection.ShowDefrost(mode));

    // ---- Seat-heater builder (web seatHeaters memo: order + > 0 guard) --------------

    [Fact]
    public void BuildSeats_keeps_only_active_seats_in_web_order()
    {
        var reading = Reading() with
        {
            SeatHeaterLeft = 2,
            SeatHeaterRight = 0,
            SeatHeaterRearLeft = null,
            SeatHeaterRearCenter = 1,
            SeatHeaterRearRight = 3,
        };

        var seats = ClimateControlPanelProjection.BuildSeats(reading, Localizer);

        Assert.Equal(3, seats.Count);
        Assert.Equal("FL", seats[0].Label);
        Assert.Equal("2/3", seats[0].LevelText);
        Assert.Equal("RC", seats[1].Label);
        Assert.Equal("1/3", seats[1].LevelText);
        Assert.Equal("RR", seats[2].Label);
        Assert.Equal("3/3", seats[2].LevelText);
    }

    [Fact]
    public void BuildSeats_is_empty_when_no_seat_active()
    {
        var reading = Reading() with
        {
            SeatHeaterLeft = null,
            SeatHeaterRight = 0,
            SeatHeaterRearLeft = null,
            SeatHeaterRearCenter = null,
            SeatHeaterRearRight = null,
        };

        Assert.Empty(ClimateControlPanelProjection.BuildSeats(reading, Localizer));
    }

    // ---- Projection (full panel) ----------------------------------------------------

    [Fact]
    public void Project_renders_full_panel()
    {
        var display = ClimateControlPanelProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal("Cabin", display.CabinLabel);
        Assert.Equal("21\u00B0C", display.CabinText);
        Assert.Equal("Outside", display.OutsideLabel);
        Assert.Equal("15\u00B0C", display.OutsideText);
        Assert.True(display.HvacOn);
        Assert.Equal("HVAC On", display.HvacBadgeText);
        Assert.Equal("2.5 kW", display.HvacPowerText);
        Assert.Equal("Fan Speed", display.FanLabel);
        Assert.Equal("5", display.FanText);
        Assert.Equal("Wheel Heat", display.SteeringLabel);
        Assert.Equal("3/3", display.SteeringText);
        Assert.Equal(2, display.Seats.Count);
        Assert.Equal("FL", display.Seats[0].Label);
        Assert.Equal("RR", display.Seats[1].Label);
        Assert.True(display.ShowDefrostChip);
        Assert.Equal("Defrost", display.DefrostChipText);
        Assert.True(display.ShowBatteryHeaterChip);
        Assert.Equal("Bat Heater", display.BatteryHeaterChipText);
    }

    [Fact]
    public void Project_idle_hides_power_and_chips()
    {
        var reading = new ClimateControlPanelReading(
            18, 10, 0, false, 0, null, null, null, null, null, 0, "Off", false);

        var display = ClimateControlPanelProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.False(display.HvacOn);
        Assert.Equal("HVAC Off", display.HvacBadgeText);
        Assert.Null(display.HvacPowerText);
        Assert.Equal("0", display.FanText);
        Assert.Equal("Off", display.SteeringText);
        Assert.Empty(display.Seats);
        Assert.Equal("No seat heaters active", display.NoSeatText);
        Assert.False(display.ShowDefrostChip);
        Assert.False(display.ShowBatteryHeaterChip);
    }

    [Fact]
    public void Project_em_dashes_null_temperatures()
    {
        var reading = new ClimateControlPanelReading(
            null, null, null, false, null, null, null, null, null, null, null, null, false);

        var display = ClimateControlPanelProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.Equal("\u2014", display.CabinText);
        Assert.Equal("\u2014", display.OutsideText);
        Assert.Equal("\u2014", display.FanText);
        Assert.Equal("Off", display.SteeringText);
        Assert.Empty(display.Seats);
    }

    [Fact]
    public void Project_imperial_reprojects_temperatures()
    {
        var display = ClimateControlPanelProjection.Project(Reading(), UnitPref.Imperial, Localizer);

        Assert.Equal("70\u00B0F", display.CabinText); // 21°C → 69.8 → 70
        Assert.Equal("59\u00B0F", display.OutsideText); // 15°C → 59
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_compact_automation_name_is_labelled_cabin()
    {
        var display = ClimateControlPanelProjection.Project(Reading(), UnitPref.Metric, Localizer);
        Assert.Equal("Cabin 21\u00B0C", display.CompactAutomationName);
    }

    [Fact]
    public void Project_full_automation_name_combines_every_section()
    {
        var display = ClimateControlPanelProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal(
            "HVAC On 2.5 kW, Cabin 21\u00B0C, Outside 15\u00B0C, Fan Speed 5, Wheel Heat 3/3, FL 2/3, RR 1/3, Defrost, Bat Heater",
            display.AutomationName);
    }

    [Fact]
    public void Project_automation_name_uses_no_seat_text_and_omits_inactive_chips()
    {
        var reading = new ClimateControlPanelReading(
            18, 10, 0, false, 0, null, null, null, null, null, 0, "Off", false);

        var display = ClimateControlPanelProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.Equal(
            "HVAC Off, Cabin 18\u00B0C, Outside 10\u00B0C, Fan Speed 0, Wheel Heat Off, No seat heaters active",
            display.AutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(ClimateJson);

        var cached = ClimateControlPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(21, cached.Value!.InsideTempC);

        var offline = ClimateControlPanelResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2.5, offline.Value!.HvacPowerKw);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(ClimateJson);

        Assert.Equal(LoadStatus.Loaded, ClimateControlPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ClimateControlPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ClimateControlPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no climate object (climateData == null) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = ClimateControlPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateControlPanelReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ClimateControlPanelState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_panel_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(ClimateControlPanelState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.Equal("21\u00B0C", vm.Display!.CabinText);
        Assert.True(vm.Display.ShowDefrostChip);
        Assert.Equal(2, vm.Display.Seats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateControlPanelReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ClimateControlPanelState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("No climate data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ClimateControlPanelReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ClimateControlPanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<ClimateControlPanelReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ClimateControlPanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateControlPanelReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ClimateControlPanelState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ClimateControlPanelReading>.Loading(),
            RepositoryResult<ClimateControlPanelReading>.Cached(
                new ClimateControlPanelReading(18, 10, 0, false, 0, null, null, null, null, null, 0, "Off", false), Now, stale: false),
            RepositoryResult<ClimateControlPanelReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();

        Assert.Equal(ClimateControlPanelState.Loaded, vm.State);
        Assert.True(vm.Display!.ShowDefrostChip);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperatures()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();
        Assert.Equal("21\u00B0C", vm.Display!.CabinText);

        vm.Units = UnitPref.Imperial; // 21°C → 70°F (fmtInt round)
        Assert.Equal("70\u00B0F", vm.Display!.CabinText);
        Assert.Equal(ClimateControlPanelState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_raises_property_changed()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.Size = new ClimateControlPanelSize(1, 1);

        Assert.Contains(nameof(ClimateControlPanelViewModel.Size), changed);
        Assert.True(vm.Size.IsCompact);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateControlPanelReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Climate Control", vm.Title);
        Assert.Equal("No climate data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ClimateControlPanelViewModel.State), changed);
        Assert.Contains(nameof(ClimateControlPanelViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("climate-control-panel", ClimateControlPanelRegistration.Id);
        Assert.Equal("climate", ClimateControlPanelRegistration.Category);
        Assert.Equal("ClimateControlPanelWidget", ClimateControlPanelRegistration.Slug);
        Assert.Equal(new ClimateControlPanelSize(2, 4), ClimateControlPanelRegistration.DefaultSize);
        Assert.Equal(new ClimateControlPanelSize(1, 2), ClimateControlPanelRegistration.MinSize);
        Assert.Equal(new ClimateControlPanelSize(4, 40), ClimateControlPanelRegistration.MaxSize);
        Assert.Equal("Climate Control Panel", ClimateControlPanelRegistration.Name(Localizer));
        Assert.Equal(
            "Inside/outside temp, HVAC on/off, fan speed, seat heaters, steering heat",
            ClimateControlPanelRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 4, true)]    // default
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ClimateControlPanelRegistration.IsWithinBounds(new ClimateControlPanelSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ClimateControlPanelSize(1, 2), ClimateControlPanelRegistration.Clamp(new ClimateControlPanelSize(0, 0)));
        Assert.Equal(new ClimateControlPanelSize(4, 40), ClimateControlPanelRegistration.Clamp(new ClimateControlPanelSize(9, 99)));
    }

    [Theory]
    [InlineData(1, 1, true)]
    [InlineData(1, 2, false)]
    [InlineData(2, 4, false)]
    public void Size_compact_branch_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new ClimateControlPanelSize(cols, rows).IsCompact);

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ClimateControlPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ClimateControlPanelWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ClimateControlPanelSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_climate()
    {
        using var climate = JsonDocument.Parse(ClimateJson);
        var api = new FakeApiClient().ReturnsValue(climate.RootElement);
        var source = new ClimateControlPanelSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(21, terminal.Value!.InsideTempC);
        Assert.Equal(3, terminal.Value.SteeringWheelHeatLevel);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_climate_latest", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var climate = JsonDocument.Parse(IdleJson);
        var api = new FakeApiClient().ReturnsValue(climate.RootElement);
        var source = new ClimateControlPanelSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(api.Requests[^1].Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("Off", results[^1].Value!.DefrostMode);
    }

    [Fact]
    public async Task Source_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new ClimateControlPanelSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ClimateControlPanelReading Reading() => new(
        InsideTempC: 21,
        OutsideTempC: 15,
        HvacPowerKw: 2.5,
        HvacAcEnabled: true,
        FanSpeed: 5,
        SeatHeaterLeft: 2,
        SeatHeaterRight: null,
        SeatHeaterRearLeft: null,
        SeatHeaterRearCenter: null,
        SeatHeaterRearRight: 1,
        SteeringWheelHeatLevel: 3,
        DefrostMode: "Front",
        BatteryHeaterOn: true);

    private static async Task<List<RepositoryResult<ClimateControlPanelReading>>> Drain(IClimateControlPanelSource source)
    {
        var list = new List<RepositoryResult<ClimateControlPanelReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<ClimateControlPanelReading> Loaded(ClimateControlPanelReading reading) =>
        RepositoryResult<ClimateControlPanelReading>.Loaded(reading, Now);

    private static ClimateControlPanelViewModel NewViewModel(params RepositoryResult<ClimateControlPanelReading>[] emissions) =>
        new(new FakeClimateControlPanelSource(emissions), Localizer, ClimateControlPanelRegistration.DefaultSize);

    private sealed class FakeClimateControlPanelSource(params RepositoryResult<ClimateControlPanelReading>[] emissions) : IClimateControlPanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<ClimateControlPanelReading>> StreamAsync(
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
}
