using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the live-telemetry Climate panel's UI-thread-free logic — the latest-snapshot
/// JSON parse adapter (temperatures, HVAC / defrost text, climate / precondition flags, fan level), the SI
/// Celsius → display-unit temperature conversion, the <c>hvac_state ?? '—'</c> fallback, the
/// <c>fan_status ?? 0</c> bar level, the Defrost / Climate / Precondition badge selection, the
/// cache-then-network result mapper, the vehicle-resolving data source (explicit vehicle, primary-vehicle
/// resolution, disabled-when-no-vehicle short-circuit), the registry metadata, the PII-safe diagnostics, the
/// Narrator automation names and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline + unit re-projection). Mirrors the web spec
/// (web/src/features/vehicles/components/telemetry-panels/ClimatePanel.tsx).
/// </summary>
public sealed class ClimatePanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";

    // A populated snapshot: climate on, defrost off, preconditioning off, fan level 3.
    private const string HealthySnapshot =
        """{"vehicle_id":7,"ts":"2026-06-06T11:59:00Z","inside_temp_c":21.5,"outside_temp_c":14.0,"driver_setpoint_c":22.0,"passenger_setpoint_c":21.0,"hvac_state":"On","defrost_mode":"Off","is_climate_on":true,"is_preconditioning":false,"fan_status":3}""";

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_every_field()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);

        var reading = ClimateReading.FromJson(doc.RootElement);

        Assert.Equal(21.5, reading.InsideTempC);
        Assert.Equal(14.0, reading.OutsideTempC);
        Assert.Equal(22.0, reading.DriverSetpointC);
        Assert.Equal(21.0, reading.PassengerSetpointC);
        Assert.Equal("On", reading.HvacState);
        Assert.Equal("Off", reading.DefrostMode);
        Assert.True(reading.IsClimateOn);
        Assert.False(reading.IsPreconditioning);
        Assert.Equal(3, reading.FanStatus);
    }

    [Fact]
    public void FromJson_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"inside_temp_c":19.0}""");

        var reading = ClimateReading.FromJson(doc.RootElement);

        Assert.Equal(19.0, reading.InsideTempC);
        Assert.Null(reading.OutsideTempC);
        Assert.Null(reading.HvacState);
        Assert.Null(reading.DefrostMode);
        Assert.Null(reading.IsClimateOn);
        Assert.Null(reading.IsPreconditioning);
        Assert.Null(reading.FanStatus);
    }

    [Fact]
    public void FromJson_reads_numeric_string_and_bool_string()
    {
        using var doc = JsonDocument.Parse(
            """{"inside_temp_c":"20.5","fan_status":"4","is_climate_on":"true"}""");

        var reading = ClimateReading.FromJson(doc.RootElement);

        Assert.Equal(20.5, reading.InsideTempC);
        Assert.Equal(4, reading.FanStatus);
        Assert.True(reading.IsClimateOn);
    }

    [Fact]
    public void FromJson_blank_hvac_state_is_null()
    {
        using var doc = JsonDocument.Parse("""{"hvac_state":"   "}""");
        Assert.Null(ClimateReading.FromJson(doc.RootElement).HvacState);
    }

    [Fact]
    public void FromJson_non_object_yields_all_null()
    {
        using var doc = JsonDocument.Parse("null");

        var reading = ClimateReading.FromJson(doc.RootElement);

        Assert.Null(reading.InsideTempC);
        Assert.Null(reading.OutsideTempC);
        Assert.Null(reading.HvacState);
        Assert.Null(reading.FanStatus);
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = Project(HealthySnapshot);

        Assert.True(display.HasData);
        Assert.Equal("Climate", display.Title);
        Assert.Equal("Climate", display.PanelAutomationName);
        Assert.Equal("No climate data available", display.EmptyMessage);
    }

    // ---- Projection: temperatures (SI Celsius → display) ---------------------------

    [Fact]
    public void Project_formats_temperatures_in_metric()
    {
        var display = Project(HealthySnapshot);

        Assert.Equal("Cabin", display.Cabin!.Label);
        Assert.Equal(UnitFormatters.FormatTemperature(21.5, UnitPref.Metric), display.Cabin.Value);
        Assert.Equal("Outside", display.Outside!.Label);
        Assert.Equal(UnitFormatters.FormatTemperature(14.0, UnitPref.Metric), display.Outside.Value);
        Assert.Equal(UnitFormatters.FormatTemperature(22.0, UnitPref.Metric), display.DriverSetpoint!.Value);
        Assert.Equal(UnitFormatters.FormatTemperature(21.0, UnitPref.Metric), display.PassengerSetpoint!.Value);
    }

    [Fact]
    public void Project_converts_temperatures_to_fahrenheit_in_imperial()
    {
        var display = Project(HealthySnapshot, UnitPref.Imperial);

        Assert.Equal(UnitFormatters.FormatTemperature(21.5, UnitPref.Imperial), display.Cabin!.Value);
        Assert.NotEqual(
            UnitFormatters.FormatTemperature(21.5, UnitPref.Metric),
            display.Cabin.Value);
    }

    [Fact]
    public void Project_null_temperature_shows_em_dash()
    {
        var display = Project("""{"outside_temp_c":12.0}""");
        Assert.Equal(EmDash, display.Cabin!.Value);
    }

    // ---- Projection: HVAC state row ------------------------------------------------

    [Fact]
    public void Project_hvac_state_shows_text_when_present()
    {
        var display = Project(HealthySnapshot);

        Assert.Equal("HVAC State", display.HvacState!.Label);
        Assert.Equal("On", display.HvacState.Value);
    }

    [Fact]
    public void Project_hvac_state_shows_em_dash_when_absent()
    {
        var display = Project("""{"inside_temp_c":20.0}""");
        Assert.Equal(EmDash, display.HvacState!.Value);
    }

    // ---- Projection: fan readout ---------------------------------------------------

    [Fact]
    public void Project_fan_reads_level_and_value()
    {
        var display = Project(HealthySnapshot);

        Assert.Equal("Fan Speed", display.Fan!.Label);
        Assert.Equal(3, display.Fan.ActiveLevel);
        Assert.Equal("3", display.Fan.Value);
    }

    [Fact]
    public void Project_fan_null_status_defaults_to_zero()
    {
        var display = Project("""{"inside_temp_c":20.0}""");

        Assert.Equal(0, display.Fan!.ActiveLevel);
        Assert.Equal("0", display.Fan.Value);
    }

    // ---- Projection: system badges -------------------------------------------------

    [Fact]
    public void Project_badges_are_defrost_climate_precondition_in_order()
    {
        var keys = Project(HealthySnapshot).Badges.Select(b => b.Key).ToArray();
        Assert.Equal(new[] { "defrost", "climate", "precondition" }, keys);
    }

    [Fact]
    public void Project_defrost_off_is_inactive_neutral()
    {
        var defrost = BadgeByKey(Project(HealthySnapshot), "defrost");

        Assert.False(defrost.Active);
        Assert.Equal(StatusKind.Neutral, defrost.Status);
        Assert.Equal("Defrost Off", defrost.Label);
    }

    [Fact]
    public void Project_defrost_mode_is_active_info_and_shows_mode()
    {
        var defrost = BadgeByKey(
            Project("""{"defrost_mode":"Front"}"""), "defrost");

        Assert.True(defrost.Active);
        Assert.Equal(StatusKind.Info, defrost.Status);
        Assert.Equal("Defrost Front", defrost.Label);
    }

    [Fact]
    public void Project_climate_on_is_active_success()
    {
        var climate = BadgeByKey(Project(HealthySnapshot), "climate");

        Assert.True(climate.Active);
        Assert.Equal(StatusKind.Success, climate.Status);
        Assert.Equal("Climate On", climate.Label);
    }

    [Fact]
    public void Project_climate_off_is_inactive_neutral()
    {
        var climate = BadgeByKey(
            Project("""{"is_climate_on":false}"""), "climate");

        Assert.False(climate.Active);
        Assert.Equal(StatusKind.Neutral, climate.Status);
        Assert.Equal("Climate Off", climate.Label);
    }

    [Fact]
    public void Project_precondition_on_is_active_warning()
    {
        var precondition = BadgeByKey(
            Project("""{"is_preconditioning":true}"""), "precondition");

        Assert.True(precondition.Active);
        Assert.Equal(StatusKind.Warning, precondition.Status);
        Assert.Equal("Precondition On", precondition.Label);
    }

    [Fact]
    public void Project_precondition_off_is_inactive_neutral()
    {
        var precondition = BadgeByKey(Project(HealthySnapshot), "precondition");

        Assert.False(precondition.Active);
        Assert.Equal(StatusKind.Neutral, precondition.Status);
        Assert.Equal("Precondition Off", precondition.Label);
    }

    // ---- Projection: empty ---------------------------------------------------------

    [Fact]
    public void Project_empty_reports_no_data_and_no_content()
    {
        var display = ClimatePanelProjection.Empty(Localizer);

        Assert.False(display.HasData);
        Assert.Null(display.Cabin);
        Assert.Null(display.Outside);
        Assert.Null(display.DriverSetpoint);
        Assert.Null(display.HvacState);
        Assert.Null(display.Fan);
        Assert.Empty(display.Badges);
        Assert.Equal("No climate data available", display.EmptyMessage);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_metrics_details_fan_and_badges_carry_narrator_names()
    {
        var display = Project(HealthySnapshot);

        Assert.Contains(display.Cabin!.Value, display.Cabin.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Cabin.Label, display.Cabin.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.HvacState!.Value, display.HvacState.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Fan!.Value, display.Fan.AutomationName, StringComparison.Ordinal);
        Assert.All(display.Badges, b => Assert.False(string.IsNullOrWhiteSpace(b.AutomationName)));
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = ClimatePanelResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(21.5, mapped.Value!.InsideTempC);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);

        Assert.Equal(LoadStatus.Loaded, ClimatePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, ClimatePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = ClimatePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    [Fact]
    public void Mapper_offline_preserves_cached_snapshot()
    {
        using var doc = JsonDocument.Parse(HealthySnapshot);
        var offline = RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline"));

        var mapped = ClimatePanelResultMapper.Map(offline);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.Equal(21.5, mapped.Value!.InsideTempC);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new ClimatePanelViewModel(new FakeSource(), Localizer);
        Assert.Equal(ClimatePanelState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_content()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.Loaded(Reading(), Now));

        await vm.LoadAsync();

        Assert.Equal(ClimatePanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Badges.Count);
        Assert.NotNull(vm.Display.Cabin);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(ClimatePanelState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No climate data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(ClimatePanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.Cached(Reading(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(ClimatePanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(ClimatePanelState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ClimateReading>.Loading(),
            RepositoryResult<ClimateReading>.Cached(Reading(), Now, stale: false),
            RepositoryResult<ClimateReading>.Loaded(Reading(), Now));

        await vm.LoadAsync();

        Assert.Equal(ClimatePanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(ClimatePanelState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_temperatures_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();
        Assert.Equal(UnitFormatters.FormatTemperature(21.5, UnitPref.Metric), vm.Display.Cabin!.Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal(UnitFormatters.FormatTemperature(21.5, UnitPref.Imperial), vm.Display.Cabin!.Value);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.Loaded(Reading(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ClimatePanelViewModel.State), changed);
        Assert.Contains(nameof(ClimatePanelViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ClimateReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Climate", vm.Title);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorTitle));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- Repository source ---------------------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_then_reads_latest_snapshot()
    {
        using var snapshot = JsonDocument.Parse(HealthySnapshot);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement.Clone());
        var source = new ClimatePanelSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(21.5, emissions[^1].Value!.InsideTempC);

        var request = Assert.Single(api.Requests);
        Assert.Equal(ClimatePanelSource.LatestOperation, request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_skips_primary_resolution()
    {
        using var snapshot = JsonDocument.Parse(HealthySnapshot);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement.Clone());
        var source = new ClimatePanelSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var api = new FakeApiClient();
        var source = new ClimatePanelSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_null_snapshot_yields_empty()
    {
        using var snapshot = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement.Clone());
        var source = new ClimatePanelSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: 5);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Contract-drift guard ------------------------------------------------------

    [Fact]
    public void LatestOperation_resolves_against_the_generated_endpoint_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(
            e => e.OperationId == ClimatePanelSource.LatestOperation);

        Assert.True(descriptor is not null, "Operation is not in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("climate-panel", ClimatePanelRegistration.Id);
        Assert.Equal("ClimatePanel", ClimatePanelRegistration.Slug);
        Assert.Equal("Climate", ClimatePanelRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ClimatePanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ClimatePanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static ClimatePanelDisplay Project(string json) => Project(json, UnitPref.Metric);

    private static ClimatePanelDisplay Project(string json, UnitPref units)
    {
        using var doc = JsonDocument.Parse(json);
        var reading = ClimateReading.FromJson(doc.RootElement);
        return ClimatePanelProjection.Project(reading, units, Localizer);
    }

    private static ClimateReading Reading() =>
        new(21.5, 14.0, 22.0, 21.0, "On", "Off", true, false, 3);

    private static ClimatePanelBadge BadgeByKey(ClimatePanelDisplay display, string key) =>
        Assert.Single(display.Badges, b => b.Key == key);

    private static ClimatePanelViewModel NewViewModel(
        params RepositoryResult<ClimateReading>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<ClimateReading>>> Collect(
        IAsyncEnumerable<RepositoryResult<ClimateReading>> stream)
    {
        var list = new List<RepositoryResult<ClimateReading>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<ClimateReading>[] emissions)
        : IClimatePanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<ClimateReading>> StreamAsync(
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

    private sealed class FakeVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
