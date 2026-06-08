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
/// Headless verification of the ClimateStatusWidget's UI-thread-free logic — the JSON parse adapter (the
/// useClimateLatest read), the temperature / HVAC formatters, the conditional defrost / heater chip guards, the
/// projection, the Narrator name, the result mapper, the single-endpoint per-vehicle data source (primary
/// resolution + the query-scoped climate read), the registry metadata, the diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ClimateStatusWidget.tsx).
/// </summary>
public sealed class ClimateStatusWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string ClimateJson =
        """{"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","inside_temp":21,"outside_temp":15,"hvac_power":2.5,"defrost_mode":"Front","battery_heater_on":true}""";

    private const string IdleJson =
        """{"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","inside_temp":18,"outside_temp":10,"hvac_power":0,"defrost_mode":"Off","battery_heater_on":false}""";

    // ---- Parse adapter (web useClimateLatest read) ---------------------------------

    [Fact]
    public void FromResponse_reads_all_climate_fields()
    {
        using var doc = JsonDocument.Parse(ClimateJson);

        var reading = ClimateStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(21, reading!.InsideTempC);
        Assert.Equal(15, reading.OutsideTempC);
        Assert.Equal(2.5, reading.HvacPowerKw);
        Assert.Equal("Front", reading.DefrostMode);
        Assert.True(reading.BatteryHeaterOn);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"ts":"t"}""");

        var reading = ClimateStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.InsideTempC);
        Assert.Null(reading.OutsideTempC);
        Assert.Null(reading.HvacPowerKw);
        Assert.Null(reading.DefrostMode);
        Assert.False(reading.BatteryHeaterOn);
    }

    [Fact]
    public void FromResponse_treats_explicit_null_numbers_as_null()
    {
        // Web parity: `inside_temp != null` — a JSON null reads as "no value" → the em dash.
        using var doc = JsonDocument.Parse("""{"inside_temp":null,"outside_temp":null,"hvac_power":null}""");

        var reading = ClimateStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.InsideTempC);
        Assert.Null(reading.OutsideTempC);
        Assert.Null(reading.HvacPowerKw);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(ClimateStatusReading.FromResponse(doc.RootElement));
    }

    // ---- Temperature formatter (web fmtInt(convertTempFromSI(…)) + unit) ------------

    [Fact]
    public void FormatTemperature_metric_rounds_to_celsius_integer()
    {
        Assert.Equal("21\u00B0C", ClimateStatusProjection.FormatTemperature(21.4, UnitPref.Metric));
        Assert.Equal("15\u00B0C", ClimateStatusProjection.FormatTemperature(15, UnitPref.Metric));
    }

    [Fact]
    public void FormatTemperature_imperial_converts_to_fahrenheit()
    {
        // 20°C → 68°F (web convertTempFromSI to '°F').
        Assert.Equal("68\u00B0F", ClimateStatusProjection.FormatTemperature(20, UnitPref.Imperial));
    }

    [Fact]
    public void FormatTemperature_null_is_em_dash()
    {
        Assert.Equal("\u2014", ClimateStatusProjection.FormatTemperature(null, UnitPref.Metric));
    }

    // ---- HVAC formatter (web fmtNumber(hvac_power, 1) + ' kW') ----------------------

    [Theory]
    [InlineData(2.5, "2.5 kW")]
    [InlineData(0, "0.0 kW")]
    [InlineData(11.25, "11.3 kW")]
    public void FormatHvac_matches_web(double kw, string expected) =>
        Assert.Equal(expected, ClimateStatusProjection.FormatHvac(kw));

    [Fact]
    public void FormatHvac_null_is_em_dash() =>
        Assert.Equal("\u2014", ClimateStatusProjection.FormatHvac(null));

    // ---- Defrost chip guard (web defrost_mode && defrost_mode !== 'Off') ------------

    [Theory]
    [InlineData("Front", true)]
    [InlineData("Rear", true)]
    [InlineData("Off", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void ShowDefrost_matches_web(string? mode, bool expected) =>
        Assert.Equal(expected, ClimateStatusProjection.ShowDefrost(mode));

    // ---- Projection (rows + chips) -------------------------------------------------

    [Fact]
    public void Project_renders_rows_and_both_chips()
    {
        var display = ClimateStatusProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal("Cabin", display.CabinLabel);
        Assert.Equal("21\u00B0C", display.CabinText);
        Assert.Equal("Outside", display.OutsideLabel);
        Assert.Equal("15\u00B0C", display.OutsideText);
        Assert.Equal("HVAC", display.HvacLabel);
        Assert.Equal("2.5 kW", display.HvacText);
        Assert.True(display.ShowDefrostChip);
        Assert.Equal("Defrost", display.DefrostChipText);
        Assert.True(display.ShowHeaterChip);
        Assert.Equal("Heater", display.HeaterChipText);
    }

    [Fact]
    public void Project_hides_chips_when_idle()
    {
        var reading = new ClimateStatusReading(18, 10, 0, "Off", false);

        var display = ClimateStatusProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.False(display.ShowDefrostChip);
        Assert.False(display.ShowHeaterChip);
        Assert.Equal("0.0 kW", display.HvacText);
    }

    [Fact]
    public void Project_em_dashes_null_readings()
    {
        var reading = new ClimateStatusReading(null, null, null, null, false);

        var display = ClimateStatusProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.Equal("\u2014", display.CabinText);
        Assert.Equal("\u2014", display.OutsideText);
        Assert.Equal("\u2014", display.HvacText);
        Assert.False(display.ShowDefrostChip);
        Assert.False(display.ShowHeaterChip);
    }

    // ---- Accessibility (Narrator name) ---------------------------------------------

    [Fact]
    public void Project_automation_name_combines_rows_and_active_chips()
    {
        var display = ClimateStatusProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal("Cabin 21\u00B0C, Outside 15\u00B0C, HVAC 2.5 kW, Defrost, Heater", display.AutomationName);
    }

    [Fact]
    public void Project_automation_name_omits_inactive_chips()
    {
        var reading = new ClimateStatusReading(18, 10, 0, "Off", false);

        var display = ClimateStatusProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.Equal("Cabin 18\u00B0C, Outside 10\u00B0C, HVAC 0.0 kW", display.AutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(ClimateJson);

        var cached = ClimateStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(21, cached.Value!.InsideTempC);

        var offline = ClimateStatusResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2.5, offline.Value!.HvacPowerKw);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(ClimateJson);

        Assert.Equal(LoadStatus.Loaded, ClimateStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ClimateStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ClimateStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no climate object (climateData == null) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = ClimateStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateStatusReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ClimateStatusState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_climate_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(ClimateStatusState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.Equal("21\u00B0C", vm.Display!.CabinText);
        Assert.True(vm.Display.ShowDefrostChip);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateStatusReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ClimateStatusState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("No climate data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ClimateStatusReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ClimateStatusState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<ClimateStatusReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ClimateStatusState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateStatusReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ClimateStatusState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ClimateStatusReading>.Loading(),
            RepositoryResult<ClimateStatusReading>.Cached(new ClimateStatusReading(18, 10, 0, "Off", false), Now, stale: false),
            RepositoryResult<ClimateStatusReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();

        Assert.Equal(ClimateStatusState.Loaded, vm.State);
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
        Assert.Equal(ClimateStatusState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateStatusReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Climate", vm.Title);
        Assert.Equal("No climate data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ClimateStatusViewModel.State), changed);
        Assert.Contains(nameof(ClimateStatusViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("climate-status", ClimateStatusRegistration.Id);
        Assert.Equal("climate", ClimateStatusRegistration.Category);
        Assert.Equal("ClimateStatusWidget", ClimateStatusRegistration.Slug);
        Assert.Equal(new ClimateStatusSize(1, 2), ClimateStatusRegistration.DefaultSize);
        Assert.Equal(new ClimateStatusSize(1, 2), ClimateStatusRegistration.MinSize);
        Assert.Equal(new ClimateStatusSize(2, 40), ClimateStatusRegistration.MaxSize);
        Assert.Equal("Climate", ClimateStatusRegistration.Name(Localizer));
        Assert.Equal("Inside/outside temp, HVAC state", ClimateStatusRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(2, 40, true)]   // max
    [InlineData(1, 10, true)]   // inside
    [InlineData(3, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ClimateStatusRegistration.IsWithinBounds(new ClimateStatusSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ClimateStatusSize(1, 2), ClimateStatusRegistration.Clamp(new ClimateStatusSize(0, 0)));
        Assert.Equal(new ClimateStatusSize(2, 40), ClimateStatusRegistration.Clamp(new ClimateStatusSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ClimateStatusDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ClimateStatusWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ClimateStatusSource(
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
        var source = new ClimateStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(21, terminal.Value!.InsideTempC);
        Assert.True(terminal.Value.BatteryHeaterOn);

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
        var source = new ClimateStatusSource(
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
        var source = new ClimateStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ClimateStatusReading Reading() => new(21, 15, 2.5, "Front", true);

    private static async Task<List<RepositoryResult<ClimateStatusReading>>> Drain(IClimateStatusSource source)
    {
        var list = new List<RepositoryResult<ClimateStatusReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<ClimateStatusReading> Loaded(ClimateStatusReading reading) =>
        RepositoryResult<ClimateStatusReading>.Loaded(reading, Now);

    private static ClimateStatusViewModel NewViewModel(params RepositoryResult<ClimateStatusReading>[] emissions) =>
        new(new FakeClimateStatusSource(emissions), Localizer, ClimateStatusSize.Default);

    private sealed class FakeClimateStatusSource(params RepositoryResult<ClimateStatusReading>[] emissions) : IClimateStatusSource
    {
        public async IAsyncEnumerable<RepositoryResult<ClimateStatusReading>> StreamAsync(
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
