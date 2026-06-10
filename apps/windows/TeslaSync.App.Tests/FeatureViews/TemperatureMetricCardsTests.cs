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
/// Headless verification of the Temperature Metric Cards surface's UI-thread-free logic — the
/// drivetrain-health JSON parse adapter (snake_case temps + motor status + overall health), the recent-drives
/// Peak Power aggregation (the native port of the web <c>peakPower</c> memo: 30-day window, ascending sort,
/// 30-point cap, <c>avg_power_w / 1000</c> max), the SI→display projection into the six web tiles (Front Motor,
/// Rear Motor, Inverter, Battery, Health Score, Peak Power) with the <c>tempNeonColor</c> / health accents, the
/// cache-then-network result mapper, the two-read repository source's request shape, the state-holder
/// view-model's per-state matrix (loading / loaded / empty / error / stale / offline), the registry metadata
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx).
/// </summary>
public sealed class TemperatureMetricCardsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);
    private const string DegreeEmpty = "\u2014";

    private static TemperatureMetricCardsSnapshot Snapshot(
        double? front = 40,
        double? rear = 50,
        double? inverter = 60,
        double? battery = 30,
        DrivetrainHealthStatus health = DrivetrainHealthStatus.Good,
        double peakKw = 120) =>
        new(front, rear, inverter, battery, "Normal", health, peakKw);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"front_motor_temp_c":40.5,"rear_motor_temp_c":50,"inverter_temp_c":61,"battery_temp_c":30,"motor_status":"Warm","overall_health":"warning"}
        """);

        var s = TemperatureMetricCardsSnapshot.FromJson(doc.RootElement, 88);

        Assert.Equal(40.5, s.FrontMotorTempC);
        Assert.Equal(50, s.RearMotorTempC);
        Assert.Equal(61, s.InverterTempC);
        Assert.Equal(30, s.BatteryTempC);
        Assert.Equal("Warm", s.MotorStatus);
        Assert.Equal(DrivetrainHealthStatus.Warning, s.OverallHealth);
        Assert.Equal(88, s.PeakPowerKw);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":1}""");

        var s = TemperatureMetricCardsSnapshot.FromJson(doc.RootElement, 0);

        Assert.Null(s.FrontMotorTempC);
        Assert.Null(s.RearMotorTempC);
        Assert.Null(s.InverterTempC);
        Assert.Null(s.BatteryTempC);
        Assert.Equal(string.Empty, s.MotorStatus);
        Assert.Equal(DrivetrainHealthStatus.Good, s.OverallHealth);
        Assert.Equal(0, s.PeakPowerKw);
    }

    [Fact]
    public void FromJson_non_object_yields_neutral_snapshot()
    {
        using var doc = JsonDocument.Parse("[]");

        var s = TemperatureMetricCardsSnapshot.FromJson(doc.RootElement, 12);

        Assert.Null(s.FrontMotorTempC);
        Assert.Equal(DrivetrainHealthStatus.Good, s.OverallHealth);
        Assert.Equal(12, s.PeakPowerKw);
    }

    [Theory]
    [InlineData("good", DrivetrainHealthStatus.Good)]
    [InlineData("warning", DrivetrainHealthStatus.Warning)]
    [InlineData("critical", DrivetrainHealthStatus.Critical)]
    [InlineData("unknown", DrivetrainHealthStatus.Good)]
    [InlineData(null, DrivetrainHealthStatus.Good)]
    public void ParseHealth_matches_web_default(string? value, DrivetrainHealthStatus expected)
    {
        Assert.Equal(expected, TemperatureMetricCardsSnapshot.ParseHealth(value));
    }

    [Theory]
    [InlineData(DrivetrainHealthStatus.Good, 95)]
    [InlineData(DrivetrainHealthStatus.Warning, 60)]
    [InlineData(DrivetrainHealthStatus.Critical, 25)]
    public void HealthScore_matches_web_constants(DrivetrainHealthStatus status, int expected)
    {
        Assert.Equal(expected, DrivetrainHealthScore.For(status));
    }

    // ---- Peak power aggregation (web peakPower memo) --------------------------------

    [Fact]
    public void PeakPower_takes_max_kw_within_window()
    {
        using var doc = JsonDocument.Parse("""
        [{"start_ts":"2026-06-01T10:00:00Z","avg_power_w":120000},
         {"start_ts":"2026-06-05T10:00:00Z","avg_power_w":80000}]
        """);

        Assert.Equal(120, DrivetrainPeakPower.FromDrives(doc.RootElement, Now));
    }

    [Fact]
    public void PeakPower_excludes_drives_outside_the_30_day_window()
    {
        using var doc = JsonDocument.Parse("""
        [{"start_ts":"2026-01-01T10:00:00Z","avg_power_w":250000}]
        """);

        Assert.Equal(0, DrivetrainPeakPower.FromDrives(doc.RootElement, Now));
    }

    [Fact]
    public void PeakPower_missing_power_contributes_zero()
    {
        using var doc = JsonDocument.Parse("""
        [{"start_ts":"2026-06-02T10:00:00Z"}]
        """);

        Assert.Equal(0, DrivetrainPeakPower.FromDrives(doc.RootElement, Now));
    }

    [Fact]
    public void PeakPower_non_array_is_zero()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Equal(0, DrivetrainPeakPower.FromDrives(doc.RootElement, Now));
    }

    [Fact]
    public void PeakPower_caps_at_30_most_recent_points()
    {
        // 31 in-window drives (hourly, all inside the 30-day window) sorted ascending; the OLDEST carries the
        // global max (999 kW). After the web's slice(-30) the oldest is dropped, so the max becomes the
        // 30th-newest value (30 kW).
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

        Assert.Equal(30, DrivetrainPeakPower.FromDrives(doc.RootElement, Now));
    }

    // ---- Projection (web MetricCard composition) -----------------------------------

    [Fact]
    public void Project_builds_six_cards_in_web_order()
    {
        var view = TemperatureMetricCardsProjection.Project(Snapshot(), UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal(6, view.Cards.Count);
        Assert.Equal("Front Motor", view.Cards[0].Label);
        Assert.Equal("Rear Motor", view.Cards[1].Label);
        Assert.Equal("Inverter", view.Cards[2].Label);
        Assert.Equal("Battery", view.Cards[3].Label);
        Assert.Equal("Health Score", view.Cards[4].Label);
        Assert.Equal("Peak Power", view.Cards[5].Label);
    }

    [Fact]
    public void Project_sensor_values_use_temperature_units_and_of_max_subtitle()
    {
        var view = TemperatureMetricCardsProjection.Project(
            Snapshot(front: 40, rear: 100, inverter: 110, battery: null), UnitPref.Metric, Localizer);

        // Front motor 40/150 = 0.27 → green; value via the SI temperature formatter; subtitle "27% of max".
        Assert.Equal(UnitFormatters.FormatTemperature(40, UnitPref.Metric), view.Cards[0].Value);
        Assert.Equal("TsColorSuccessBrush", view.Cards[0].AccentBrushKey);
        Assert.Equal("27% of max", view.Cards[0].Subtitle);

        // Rear motor 100/150 = 0.67 → amber; subtitle "67% of max".
        Assert.Equal("TsColorWarningBrush", view.Cards[1].AccentBrushKey);
        Assert.Equal("67% of max", view.Cards[1].Subtitle);

        // Inverter 110/120 = 0.92 → red; subtitle "92% of max".
        Assert.Equal("TsColorDangerBrush", view.Cards[2].AccentBrushKey);
        Assert.Equal("92% of max", view.Cards[2].Subtitle);

        // Battery null → em-dash value, green accent, "No data" subtitle (web displayTemp / tempNeonColor null).
        Assert.Equal(DegreeEmpty, view.Cards[3].Value);
        Assert.Equal("TsColorSuccessBrush", view.Cards[3].AccentBrushKey);
        Assert.Equal("No data", view.Cards[3].Subtitle);
    }

    [Fact]
    public void Project_sensor_values_convert_in_imperial()
    {
        var metric = TemperatureMetricCardsProjection.Project(Snapshot(front: 40), UnitPref.Metric, Localizer);
        var imperial = TemperatureMetricCardsProjection.Project(Snapshot(front: 40), UnitPref.Imperial, Localizer);

        Assert.NotEqual(metric.Cards[0].Value, imperial.Cards[0].Value);
        Assert.Equal(UnitFormatters.FormatTemperature(40, UnitPref.Imperial), imperial.Cards[0].Value);
    }

    [Theory]
    [InlineData(DrivetrainHealthStatus.Good, "95%", "TsColorSuccessBrush")]
    [InlineData(DrivetrainHealthStatus.Warning, "60%", "TsColorWarningBrush")]
    [InlineData(DrivetrainHealthStatus.Critical, "25%", "TsColorDangerBrush")]
    public void Project_health_score_tile_matches_web(DrivetrainHealthStatus status, string value, string accent)
    {
        var view = TemperatureMetricCardsProjection.Project(Snapshot(health: status), UnitPref.Metric, Localizer);

        Assert.Equal(value, view.Cards[4].Value);
        Assert.Equal(accent, view.Cards[4].AccentBrushKey);
        Assert.Equal(string.Empty, view.Cards[4].Subtitle);
    }

    [Fact]
    public void Project_peak_power_tile_renders_kw_or_dash()
    {
        var withPower = TemperatureMetricCardsProjection.Project(Snapshot(peakKw: 240), UnitPref.Metric, Localizer);
        Assert.Equal("240 kW", withPower.Cards[5].Value);
        Assert.Equal("TsChartPowerBrush", withPower.Cards[5].AccentBrushKey);

        var noPower = TemperatureMetricCardsProjection.Project(Snapshot(peakKw: 0), UnitPref.Metric, Localizer);
        Assert.Equal(DegreeEmpty, noPower.Cards[5].Value);
    }

    [Fact]
    public void Project_cards_have_non_empty_accessibility_names()
    {
        var view = TemperatureMetricCardsProjection.Project(Snapshot(), UnitPref.Metric, Localizer);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Value, card.AutomationName, StringComparison.Ordinal);
            if (!string.IsNullOrEmpty(card.Subtitle))
            {
                Assert.Contains(card.Subtitle, card.AutomationName, StringComparison.Ordinal);
            }
        }
    }

    [Fact]
    public void Project_constants_match_web()
    {
        Assert.Equal(150, TemperatureMetricCardsProjection.FrontMotorMaxC);
        Assert.Equal(150, TemperatureMetricCardsProjection.RearMotorMaxC);
        Assert.Equal(120, TemperatureMetricCardsProjection.InverterMaxC);
        Assert.Equal(60, TemperatureMetricCardsProjection.BatteryMaxC);
        Assert.Equal(0.85, TemperatureMetricCardsProjection.CriticalRatio);
        Assert.Equal(0.65, TemperatureMetricCardsProjection.WarningRatio);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_parses_payload_and_injects_peak_power()
    {
        using var doc = JsonDocument.Parse("""{"front_motor_temp_c":42,"overall_health":"warning"}""");

        var cached = TemperatureMetricCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), 175);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(42, cached.Value!.FrontMotorTempC);
        Assert.Equal(DrivetrainHealthStatus.Warning, cached.Value.OverallHealth);
        Assert.Equal(175, cached.Value.PeakPowerKw);

        var offline = TemperatureMetricCardsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")), 10);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(10, offline.Value!.PeakPowerKw);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse("""{"overall_health":"good"}""");

        Assert.Equal(LoadStatus.Loaded, TemperatureMetricCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), 0).Status);

        Assert.Equal(LoadStatus.Empty, TemperatureMetricCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now), 0).Status);

        Assert.Equal(LoadStatus.Error, TemperatureMetricCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), 0).Status);

        Assert.Equal(LoadStatus.Loading, TemperatureMetricCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Loading(), 0).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<TemperatureMetricCardsSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TemperatureMetricCardsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_six_cards()
    {
        using var vm = NewViewModel(Loaded(Snapshot()));
        await vm.LoadAsync();

        Assert.Equal(TemperatureMetricCardsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<TemperatureMetricCardsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TemperatureMetricCardsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No drivetrain health data available yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<TemperatureMetricCardsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TemperatureMetricCardsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<TemperatureMetricCardsSnapshot>.Cached(Snapshot(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TemperatureMetricCardsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<TemperatureMetricCardsSnapshot>.OfflineCached(
            Snapshot(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TemperatureMetricCardsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<TemperatureMetricCardsSnapshot>.Loading(),
            RepositoryResult<TemperatureMetricCardsSnapshot>.Cached(Snapshot(), Now, stale: false),
            RepositoryResult<TemperatureMetricCardsSnapshot>.Loaded(Snapshot(), Now));
        await vm.LoadAsync();

        Assert.Equal(TemperatureMetricCardsState.Loaded, vm.State);
        Assert.Equal(6, vm.Display.Cards.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperature()
    {
        using var vm = NewViewModel(Loaded(Snapshot(front: 40)));
        await vm.LoadAsync();
        string metricValue = vm.Display.Cards[0].Value;

        vm.Units = UnitPref.Imperial;

        Assert.NotEqual(metricValue, vm.Display.Cards[0].Value);
        Assert.Equal(UnitFormatters.FormatTemperature(40, UnitPref.Imperial), vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<TemperatureMetricCardsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Temperature & Power", vm.Title);
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

        Assert.Contains(nameof(TemperatureMetricCardsViewModel.State), changed);
        Assert.Contains(nameof(TemperatureMetricCardsViewModel.Display), changed);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new TemperatureMetricCardsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_drives_then_health()
    {
        using var drives = JsonDocument.Parse("""[{"start_ts":"2026-06-02T10:00:00Z","avg_power_w":150000}]""");
        using var health = JsonDocument.Parse("""{"front_motor_temp_c":35,"overall_health":"good"}""");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement).ReturnsValue(health.RootElement);
        var source = new TemperatureMetricCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null, clock: () => Now);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(35, terminal.Value!.FrontMotorTempC);
        Assert.Equal(150, terminal.Value.PeakPowerKw); // 150000 W → 150 kW

        Assert.Equal(2, api.Requests.Count);
        Assert.Equal(Operations.Drives.List, api.Requests[0].OperationId);
        Assert.Equal("get_api_v1_drivetrain_health", api.Requests[1].OperationId);
        Assert.Equal(7L, Convert.ToInt64(api.Requests[1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var drives = JsonDocument.Parse("[]");
        using var health = JsonDocument.Parse("""{"overall_health":"good"}""");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement).ReturnsValue(health.RootElement);
        var source = new TemperatureMetricCardsSource(
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
        using var health = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement).ReturnsValue(health.RootElement);
        var source = new TemperatureMetricCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions(), clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_drives_failure_leaves_peak_power_zero_but_still_loads_health()
    {
        using var health = JsonDocument.Parse("""{"overall_health":"good"}""");
        var api = new FakeApiClient()
            .Throws(new ApiException("drives down"))
            .ReturnsValue(health.RootElement);
        var source = new TemperatureMetricCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 9 }),
            api, NewEngine(), new ApiClientOptions(), clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(0, results[^1].Value!.PeakPowerKw);
    }

    // ---- Contract / registration / diagnostics -------------------------------------

    [Fact]
    public void Drivetrain_health_operation_resolves_against_generated_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.Single(e => e.OperationId == "get_api_v1_drivetrain_health");
        Assert.Equal("/drivetrain/health", descriptor.Path);
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor.Method);
    }

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("temperature-metric-cards", TemperatureMetricCardsRegistration.Id);
        Assert.Equal("driving", TemperatureMetricCardsRegistration.Category);
        Assert.Equal("TemperatureMetricCards", TemperatureMetricCardsRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new TemperatureMetricCardsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TemperatureMetricCards", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<TemperatureMetricCardsSnapshot> Loaded(TemperatureMetricCardsSnapshot snapshot) =>
        RepositoryResult<TemperatureMetricCardsSnapshot>.Loaded(snapshot, Now);

    private static TemperatureMetricCardsViewModel NewViewModel(
        params RepositoryResult<TemperatureMetricCardsSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<TemperatureMetricCardsSnapshot>>> Drain(ITemperatureMetricCardsSource source)
    {
        var list = new List<RepositoryResult<TemperatureMetricCardsSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<TemperatureMetricCardsSnapshot>[] emissions)
        : ITemperatureMetricCardsSource
    {
        public async IAsyncEnumerable<RepositoryResult<TemperatureMetricCardsSnapshot>> StreamAsync(
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
