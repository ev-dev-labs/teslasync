using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
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
/// Headless verification of the Detail Cards surface's UI-thread-free logic — the drivetrain-health JSON parse
/// adapter (snake_case temps), the recent-drives Power-Summary aggregation (the native port of the web
/// <c>peakPower</c> / <c>avgPowerMax</c> / <c>minRegenPower</c> memos: 30-day window, ascending sort, 30-point
/// cap, <c>avg_power_w / 1000</c>), the lifetime driving-stats parse, the SI→display projection into the two
/// web cards (Temperature Details, Power Summary) with the kWh-pinned Total Regen, the cache-then-network
/// result mapper, the three-read repository source's request shape, the state-holder view-model's per-state
/// matrix (loading / loaded / empty / error / stale / offline), the registry metadata and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/DetailCards.tsx).
/// </summary>
public sealed class DetailCardsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);
    private const string Dash = "\u2014";

    private static DetailCardsSnapshot Snapshot(
        double? front = 40,
        double? rear = 50,
        double? inverter = 60,
        double? battery = 30,
        DrivetrainPowerSummary? power = null,
        DetailCardsStats? stats = null) =>
        new(front, rear, inverter, battery, power ?? new DrivetrainPowerSummary(240, 12.5, 0), stats);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_temperatures()
    {
        using var doc = JsonDocument.Parse("""
        {"front_motor_temp_c":40.5,"rear_motor_temp_c":50,"inverter_temp_c":61,"battery_temp_c":30}
        """);

        var s = DetailCardsSnapshot.FromJson(doc.RootElement, DrivetrainPowerSummary.Zero, null);

        Assert.Equal(40.5, s.FrontMotorTempC);
        Assert.Equal(50, s.RearMotorTempC);
        Assert.Equal(61, s.InverterTempC);
        Assert.Equal(30, s.BatteryTempC);
        Assert.Same(DrivetrainPowerSummary.Zero, s.Power);
        Assert.Null(s.Stats);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":1}""");

        var s = DetailCardsSnapshot.FromJson(doc.RootElement, new DrivetrainPowerSummary(1, 2, 0), null);

        Assert.Null(s.FrontMotorTempC);
        Assert.Null(s.RearMotorTempC);
        Assert.Null(s.InverterTempC);
        Assert.Null(s.BatteryTempC);
        Assert.Equal(1, s.Power.PeakKw);
    }

    [Fact]
    public void FromJson_non_object_yields_neutral_snapshot()
    {
        using var doc = JsonDocument.Parse("[]");
        var power = new DrivetrainPowerSummary(3, 4, 0);

        var s = DetailCardsSnapshot.FromJson(doc.RootElement, power, null);

        Assert.Null(s.FrontMotorTempC);
        Assert.Same(power, s.Power);
    }

    [Fact]
    public void Stats_FromJson_reads_snake_case_and_tolerates_absence()
    {
        using var full = JsonDocument.Parse("""{"regen_energy_wh":12345.6,"co2_saved_kg":4.5}""");
        var stats = DetailCardsStats.FromJson(full.RootElement);
        Assert.NotNull(stats);
        Assert.Equal(12345.6, stats!.RegenEnergyWh);
        Assert.Equal(4.5, stats.Co2SavedKg);

        using var empty = JsonDocument.Parse("{}");
        var sparse = DetailCardsStats.FromJson(empty.RootElement);
        Assert.NotNull(sparse);
        Assert.Null(sparse!.RegenEnergyWh);
        Assert.Null(sparse.Co2SavedKg);

        using var notObject = JsonDocument.Parse("[]");
        Assert.Null(DetailCardsStats.FromJson(notObject.RootElement));
    }

    // ---- Power-Summary aggregation (web peakPower/avgPowerMax/minRegenPower memos) ---

    [Fact]
    public void Power_takes_peak_and_mean_kw_within_window()
    {
        using var doc = JsonDocument.Parse("""
        [{"start_ts":"2026-06-01T10:00:00Z","avg_power_w":120000},
         {"start_ts":"2026-06-05T10:00:00Z","avg_power_w":80000}]
        """);

        var power = DrivetrainPowerSummary.FromDrives(doc.RootElement, Now);

        Assert.Equal(120, power.PeakKw);
        Assert.Equal(100, power.AvgKw);
        Assert.Equal(0, power.MinRegenKw);
    }

    [Fact]
    public void Power_excludes_drives_outside_the_30_day_window()
    {
        using var doc = JsonDocument.Parse("""[{"start_ts":"2026-01-01T10:00:00Z","avg_power_w":250000}]""");

        Assert.Same(DrivetrainPowerSummary.Zero, DrivetrainPowerSummary.FromDrives(doc.RootElement, Now));
    }

    [Fact]
    public void Power_missing_power_contributes_zero()
    {
        using var doc = JsonDocument.Parse("""[{"start_ts":"2026-06-02T10:00:00Z"}]""");

        var power = DrivetrainPowerSummary.FromDrives(doc.RootElement, Now);

        Assert.Equal(0, power.PeakKw);
        Assert.Equal(0, power.AvgKw);
        Assert.Equal(0, power.MinRegenKw);
    }

    [Fact]
    public void Power_non_array_is_zero()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Same(DrivetrainPowerSummary.Zero, DrivetrainPowerSummary.FromDrives(doc.RootElement, Now));
    }

    [Fact]
    public void Power_caps_at_30_most_recent_points()
    {
        // 31 in-window drives (hourly) ascending; the OLDEST carries the global max (999 kW). After the web's
        // slice(-30) the oldest is dropped, so the peak becomes the 30th value (30 kW) and the mean is over 1..30.
        var sb = new StringBuilder("[");
        for (int i = 0; i < 31; i++)
        {
            var t = new DateTimeOffset(2026, 5, 20, 0, 0, 0, TimeSpan.Zero).AddHours(i);
            int powerW = i == 0 ? 999_000 : i * 1000;
            if (i > 0)
            {
                sb.Append(',');
            }

            sb.Append("{\"start_ts\":\"")
                .Append(t.ToString("o", CultureInfo.InvariantCulture))
                .Append("\",\"avg_power_w\":")
                .Append(powerW.ToString(CultureInfo.InvariantCulture))
                .Append('}');
        }

        sb.Append(']');
        using var doc = JsonDocument.Parse(sb.ToString());

        var power = DrivetrainPowerSummary.FromDrives(doc.RootElement, Now);

        Assert.Equal(30, power.PeakKw);
        Assert.Equal(15.5, power.AvgKw); // mean of 1..30
        Assert.Equal(0, power.MinRegenKw);
    }

    // ---- Projection (web Card / KVList composition) --------------------------------

    [Fact]
    public void Project_builds_two_cards_in_web_order()
    {
        var view = DetailCardsProjection.Project(Snapshot(), UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal(2, view.Cards.Count);
        Assert.Equal("Temperature Details", view.Cards[0].Title);
        Assert.Equal("Power Summary", view.Cards[1].Title);
    }

    [Fact]
    public void Project_temperature_card_rows_use_units_and_dash_for_null()
    {
        var view = DetailCardsProjection.Project(
            Snapshot(front: 40, rear: 50, inverter: 60, battery: null), UnitPref.Metric, Localizer);
        var temps = view.Cards[0].Rows;

        Assert.Equal(4, temps.Count);
        Assert.Equal("Front Motor Temp", temps[0].Label);
        Assert.Equal("Rear Motor Temp", temps[1].Label);
        Assert.Equal("Inverter Temp", temps[2].Label);
        Assert.Equal("Battery Temp", temps[3].Label);
        Assert.Equal(UnitFormatters.FormatTemperature(40, UnitPref.Metric), temps[0].Value);
        Assert.Equal(UnitFormatters.FormatTemperature(60, UnitPref.Metric), temps[2].Value);
        Assert.Equal(Dash, temps[3].Value); // null battery → em-dash (web displayTemp)
    }

    [Fact]
    public void Project_temperatures_convert_in_imperial()
    {
        var metric = DetailCardsProjection.Project(Snapshot(front: 40), UnitPref.Metric, Localizer);
        var imperial = DetailCardsProjection.Project(Snapshot(front: 40), UnitPref.Imperial, Localizer);

        Assert.NotEqual(metric.Cards[0].Rows[0].Value, imperial.Cards[0].Rows[0].Value);
        Assert.Equal(UnitFormatters.FormatTemperature(40, UnitPref.Imperial), imperial.Cards[0].Rows[0].Value);
    }

    [Fact]
    public void Project_power_card_rows_match_web_formatting()
    {
        var stats = new DetailCardsStats(RegenEnergyWh: 12345, Co2SavedKg: 4.567);
        var view = DetailCardsProjection.Project(
            Snapshot(power: new DrivetrainPowerSummary(PeakKw: 240, AvgKw: 12.5, MinRegenKw: 0), stats: stats),
            UnitPref.Metric, Localizer);
        var rows = view.Cards[1].Rows;

        Assert.Equal(5, rows.Count);
        Assert.Equal("Peak Power", rows[0].Label);
        Assert.Equal("240 kW", rows[0].Value);
        Assert.Equal("Avg Peak Power", rows[1].Label);
        Assert.Equal("12.5 kW", rows[1].Value);
        // web Max Regen: minRegenPower < 0 ? … : '—'; the page hard-codes powerMin = 0 so it is always the dash.
        Assert.Equal("Max Regen", rows[2].Label);
        Assert.Equal(Dash, rows[2].Value);
        // web Total Regen: formatEnergy(regenEnergyWh, { precision: 1 }) — useUnits forces kWh.
        Assert.Equal("Total Regen", rows[3].Label);
        Assert.Equal(
            UnitFormatters.FormatEnergy(12345, UnitPref.Metric with { Energy = EnergyUnit.Kwh }, 1),
            rows[3].Value);
        Assert.Equal("CO\u2082 Saved", rows[4].Label);
        Assert.Equal("4.6 kg", rows[4].Value);
    }

    [Fact]
    public void Project_power_rows_dash_when_zero_or_stats_absent()
    {
        var view = DetailCardsProjection.Project(
            Snapshot(power: DrivetrainPowerSummary.Zero, stats: null), UnitPref.Metric, Localizer);
        var rows = view.Cards[1].Rows;

        Assert.Equal(Dash, rows[0].Value); // Peak Power 0 → '—'
        Assert.Equal(Dash, rows[1].Value); // Avg Peak Power 0 → '—'
        Assert.Equal(Dash, rows[2].Value); // Max Regen → '—'
        Assert.Equal(Dash, rows[3].Value); // Total Regen (no stats) → '—'
        Assert.Equal(Dash, rows[4].Value); // CO2 (no stats) → '—'
    }

    [Fact]
    public void Project_co2_treats_sparse_stats_as_zero()
    {
        // web: stats truthy but co2SavedKg undefined → fmtNumber(undefined, 1) = "0.0"; regen → formatEnergy(undefined) = '—'.
        var view = DetailCardsProjection.Project(
            Snapshot(stats: new DetailCardsStats(RegenEnergyWh: null, Co2SavedKg: null)), UnitPref.Metric, Localizer);
        var rows = view.Cards[1].Rows;

        Assert.Equal(Dash, rows[3].Value);  // Total Regen: FormatEnergy(null) → '—'
        Assert.Equal("0.0 kg", rows[4].Value);
    }

    [Fact]
    public void Project_rows_have_non_empty_accessibility_names()
    {
        var view = DetailCardsProjection.Project(Snapshot(), UnitPref.Metric, Localizer);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            foreach (var row in card.Rows)
            {
                Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
                Assert.Contains(row.Label, row.AutomationName, StringComparison.Ordinal);
                Assert.Contains(row.Value, row.AutomationName, StringComparison.Ordinal);
            }
        }
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_parses_payload_and_injects_power_and_stats()
    {
        using var doc = JsonDocument.Parse("""{"front_motor_temp_c":42}""");
        var power = new DrivetrainPowerSummary(175, 90, 0);
        var stats = new DetailCardsStats(1000, 2);

        var cached = DetailCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), power, stats);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(42, cached.Value!.FrontMotorTempC);
        Assert.Same(power, cached.Value.Power);
        Assert.Same(stats, cached.Value.Stats);

        var offline = DetailCardsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")), power, stats);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Same(power, offline.Value!.Power);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse("""{"front_motor_temp_c":1}""");
        var power = DrivetrainPowerSummary.Zero;

        Assert.Equal(LoadStatus.Loaded, DetailCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), power, null).Status);

        Assert.Equal(LoadStatus.Empty, DetailCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now), power, null).Status);

        Assert.Equal(LoadStatus.Error, DetailCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), power, null).Status);

        Assert.Equal(LoadStatus.Loading, DetailCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Loading(), power, null).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DetailCardsSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DetailCardsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_two_cards()
    {
        using var vm = NewViewModel(Loaded(Snapshot()));
        await vm.LoadAsync();

        Assert.Equal(DetailCardsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DetailCardsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DetailCardsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No drivetrain health data available yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DetailCardsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DetailCardsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<DetailCardsSnapshot>.Cached(Snapshot(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DetailCardsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<DetailCardsSnapshot>.OfflineCached(
            Snapshot(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DetailCardsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DetailCardsSnapshot>.Loading(),
            RepositoryResult<DetailCardsSnapshot>.Cached(Snapshot(), Now, stale: false),
            RepositoryResult<DetailCardsSnapshot>.Loaded(Snapshot(), Now));
        await vm.LoadAsync();

        Assert.Equal(DetailCardsState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Cards.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperature()
    {
        using var vm = NewViewModel(Loaded(Snapshot(front: 40)));
        await vm.LoadAsync();
        string metricValue = vm.Display.Cards[0].Rows[0].Value;

        vm.Units = UnitPref.Imperial;

        Assert.NotEqual(metricValue, vm.Display.Cards[0].Rows[0].Value);
        Assert.Equal(UnitFormatters.FormatTemperature(40, UnitPref.Imperial), vm.Display.Cards[0].Rows[0].Value);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DetailCardsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Drivetrain Details", vm.Title);
        Assert.Equal("No drivetrain health data available yet", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DetailCardsViewModel.State), changed);
        Assert.Contains(nameof(DetailCardsViewModel.Display), changed);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new DetailCardsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_drives_stats_then_health()
    {
        using var drives = JsonDocument.Parse("""[{"start_ts":"2026-06-02T10:00:00Z","avg_power_w":150000}]""");
        using var stats = JsonDocument.Parse("""{"regen_energy_wh":5000,"co2_saved_kg":3.2}""");
        using var health = JsonDocument.Parse("""{"front_motor_temp_c":35}""");
        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(stats.RootElement)
            .ReturnsValue(health.RootElement);
        var source = new DetailCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null, clock: () => Now);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(35, terminal.Value!.FrontMotorTempC);
        Assert.Equal(150, terminal.Value.Power.PeakKw); // 150000 W → 150 kW
        Assert.NotNull(terminal.Value.Stats);
        Assert.Equal(5000, terminal.Value.Stats!.RegenEnergyWh);

        Assert.Equal(3, api.Requests.Count);
        Assert.Equal(Operations.Drives.List, api.Requests[0].OperationId);
        Assert.Equal(Operations.Drives.Stats, api.Requests[1].OperationId);
        Assert.Equal("get_api_v1_drivetrain_health", api.Requests[2].OperationId);
        Assert.Equal(7L, Convert.ToInt64(api.Requests[2].Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var drives = JsonDocument.Parse("[]");
        using var stats = JsonDocument.Parse("{}");
        using var health = JsonDocument.Parse("""{"front_motor_temp_c":12}""");
        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(stats.RootElement)
            .ReturnsValue(health.RootElement);
        var source = new DetailCardsSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42, clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(42L, Convert.ToInt64(api.Requests[^1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_empty_health_body_collapses_to_empty()
    {
        using var drives = JsonDocument.Parse("[]");
        using var stats = JsonDocument.Parse("{}");
        using var health = JsonDocument.Parse("null");
        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(stats.RootElement)
            .ReturnsValue(health.RootElement);
        var source = new DetailCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions(), clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_drives_failure_leaves_power_zero_but_still_loads_health()
    {
        using var stats = JsonDocument.Parse("""{"regen_energy_wh":1,"co2_saved_kg":2}""");
        using var health = JsonDocument.Parse("""{"front_motor_temp_c":20}""");
        var api = new FakeApiClient()
            .Throws(new ApiException("drives down"))
            .ReturnsValue(stats.RootElement)
            .ReturnsValue(health.RootElement);
        var source = new DetailCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 9 }),
            api, NewEngine(), new ApiClientOptions(), clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Same(DrivetrainPowerSummary.Zero, results[^1].Value!.Power);
        Assert.NotNull(results[^1].Value!.Stats);
    }

    [Fact]
    public async Task Source_stats_failure_leaves_stats_null_but_still_loads_health()
    {
        using var drives = JsonDocument.Parse("""[{"start_ts":"2026-06-02T10:00:00Z","avg_power_w":100000}]""");
        using var health = JsonDocument.Parse("""{"front_motor_temp_c":20}""");
        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .Throws(new ApiException("stats down"))
            .ReturnsValue(health.RootElement);
        var source = new DetailCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 9 }),
            api, NewEngine(), new ApiClientOptions(), clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(100, results[^1].Value!.Power.PeakKw);
        Assert.Null(results[^1].Value!.Stats);
    }

    // ---- Contract / registration / diagnostics -------------------------------------

    [Fact]
    public void Drivetrain_health_and_stats_operations_resolve_against_generated_table()
    {
        var health = GeneratedApi.ApiEndpoints.All.Single(e => e.OperationId == "get_api_v1_drivetrain_health");
        Assert.Equal("/drivetrain/health", health.Path);
        Assert.Equal(GeneratedApi.HttpMethod.Get, health.Method);

        var statsDescriptor = GeneratedApi.ApiEndpoints.All.Single(e => e.OperationId == Operations.Drives.Stats);
        Assert.Equal("/drives/stats", statsDescriptor.Path);
    }

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("detail-cards", DetailCardsRegistration.Id);
        Assert.Equal("driving", DetailCardsRegistration.Category);
        Assert.Equal("DetailCards", DetailCardsRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new DetailCardsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DetailCards", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<DetailCardsSnapshot> Loaded(DetailCardsSnapshot snapshot) =>
        RepositoryResult<DetailCardsSnapshot>.Loaded(snapshot, Now);

    private static DetailCardsViewModel NewViewModel(params RepositoryResult<DetailCardsSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<DetailCardsSnapshot>>> Drain(IDetailCardsSource source)
    {
        var list = new List<RepositoryResult<DetailCardsSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<DetailCardsSnapshot>[] emissions)
        : IDetailCardsSource
    {
        public async IAsyncEnumerable<RepositoryResult<DetailCardsSnapshot>> StreamAsync(
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
