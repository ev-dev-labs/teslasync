using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the More Details surface's UI-thread-free logic — the
/// <c>GET /drives/{driveID}</c> JSON parse adapter (the Drive aggregate plus the embedded
/// telemetry / position reduction that <c>useDriveDetailData</c> performs), the SI→display unit projection
/// of the two metric grids (odometer, range, elevation, energy, consumption, power, temperatures, min speed,
/// battery, net), the cache-then-network result mapper, the repository source's request shape (the
/// drive-detail operation with the <c>driveID</c> path parameter), the state-holder view-model's state matrix
/// (loading / loaded / empty / error / stale / offline), the registration metadata, the PII-safe diagnostics,
/// and the per-cell Narrator names. Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx).
/// </summary>
public sealed class MoreDetailsPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private const string CanonicalDrive = """
    {
      "distance_m": 10000,
      "duration_s": 1800,
      "energy_used_wh": 2000,
      "regen_energy_wh": 500,
      "avg_power_w": 12000,
      "start_battery_pct": 80,
      "end_battery_pct": 65,
      "telemetry": [
        {"speed": 0,  "power": 10, "elevation": 100, "outside_temp": 10, "inside_temp": 20, "ideal_range": 300000, "odometer": 50000},
        {"speed": 20, "power": 30, "elevation": 130, "outside_temp": 12, "inside_temp": 22, "ideal_range": 295000, "odometer": 55000},
        {"speed": 10, "power": -5, "elevation": 110, "outside_temp": 14, "inside_temp": 24, "rated_range": 290000, "odometer": 60000}
      ]
    }
    """;

    // ---- Parse adapter (drive aggregate + telemetry reduction) ---------------------

    [Fact]
    public void FromJson_reads_aggregate_fields()
    {
        var snapshot = Parse(CanonicalDrive);

        Assert.Equal(10000, snapshot.DistanceM);
        Assert.Equal(1800, snapshot.DurationS);
        Assert.Equal(2000, snapshot.EnergyUsedWh);
        Assert.Equal(500, snapshot.RegenEnergyWh);
        Assert.Equal(12000, snapshot.AvgPowerW);
        Assert.Equal(80, snapshot.StartBatteryPct);
        Assert.Equal(65, snapshot.EndBatteryPct);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_reduces_telemetry_rows_in_si()
    {
        var snapshot = Parse(CanonicalDrive);

        Assert.Equal(3, snapshot.RowCount);
        Assert.Equal(35, snapshot.SumPowerKw);          // 10 + 30 - 5
        Assert.Equal(5, snapshot.SumRegenPowerKw);      // |-5|
        Assert.Equal(30, snapshot.ElevGainM);           // 100→130
        Assert.Equal(20, snapshot.ElevLossM);           // 130→110
        Assert.Equal(10, snapshot.MinSpeedMps);         // min positive of {20,10}
        Assert.Equal(12, snapshot.AvgOutsideTempC);     // mean(10,12,14)
        Assert.Equal(22, snapshot.AvgInsideTempC);      // mean(20,22,24)
        Assert.Equal(50000, snapshot.OdometerStartM);
        Assert.Equal(60000, snapshot.OdometerEndM);
        Assert.Equal(300000, snapshot.StartRangeM);     // first ideal_range
        Assert.Equal(290000, snapshot.EndRangeM);       // last (rated_range fallback)
    }

    [Fact]
    public void FromJson_falls_back_to_positions_when_telemetry_empty()
    {
        const string json = """
        {"distance_m": 5000, "telemetry": [],
         "positions": [
           {"odometer": 1000, "elevation": 50, "speed": 5},
           {"odometer": 2000, "elevation": 60, "speed": 3}
         ]}
        """;

        var snapshot = Parse(json);

        Assert.Equal(2, snapshot.RowCount);
        Assert.Equal(1000, snapshot.OdometerStartM);
        Assert.Equal(2000, snapshot.OdometerEndM);
        Assert.Equal(10, snapshot.ElevGainM);
        Assert.Equal(3, snapshot.MinSpeedMps);
    }

    [Fact]
    public void FromJson_ignores_zero_and_missing_odometer_readings()
    {
        const string json = """
        {"distance_m": 1000, "telemetry": [
          {"odometer": 0, "speed": 4},
          {"speed": 4},
          {"odometer": 1234, "speed": 4}
        ]}
        """;

        var snapshot = Parse(json);

        Assert.Equal(1234, snapshot.OdometerStartM);
        Assert.Equal(1234, snapshot.OdometerEndM);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var arr = JsonDocument.Parse("[]");
        Assert.False(MoreDetailsSnapshot.FromJson(arr.RootElement).HasData);

        using var nul = JsonDocument.Parse("null");
        Assert.False(MoreDetailsSnapshot.FromJson(nul.RootElement).HasData);
    }

    [Fact]
    public void FromJson_with_no_distance_energy_or_rows_has_no_data()
    {
        var snapshot = Parse("""{"distance_m": 0, "duration_s": 0}""");
        Assert.False(snapshot.HasData);
    }

    [Fact]
    public void FromJson_parses_numeric_strings()
    {
        var snapshot = Parse("""{"distance_m": "2500", "start_battery_pct": "90", "end_battery_pct": "70"}""");

        Assert.Equal(2500, snapshot.DistanceM);
        Assert.Equal(90, snapshot.StartBatteryPct);
        Assert.Equal(70, snapshot.EndBatteryPct);
    }

    // ---- Projection (metric / imperial / em-dash / accents / a11y) -----------------

    [Fact]
    public void Project_metric_formats_primary_grid()
    {
        var display = MoreDetailsProjection.Project(Snap(), UnitPref.Metric, Localizer);

        Assert.True(display.HasData);
        Assert.Equal(6, display.Primary.Count);

        var odometer = display.Primary[0];
        Assert.Equal("Odometer (From \u2192 To)", odometer.Label);
        Assert.Equal("50 \u2192 60", odometer.Value);
        Assert.Equal("km", odometer.Unit);
        Assert.Equal("TsColorInfoBrush", odometer.AccentBrushKey);

        Assert.Equal("300 \u2192 290", display.Primary[1].Value);
        Assert.Equal("km", display.Primary[1].Unit);
        Assert.Equal("TsColorSuccessBrush", display.Primary[1].AccentBrushKey);

        var elevation = display.Primary[2];
        Assert.Equal("\u2191 30 m", elevation.Value);
        Assert.Equal("\u2193 20 m", elevation.SecondaryValue);
        Assert.Equal("TsColorSuccessBrush", elevation.AccentBrushKey);
        Assert.Equal("TsColorDangerBrush", elevation.SecondaryAccentBrushKey);

        Assert.Equal("2.0 kWh", display.Primary[3].Value);   // energy consumed > 1000 Wh
        Assert.Equal("TsColorWarningBrush", display.Primary[3].AccentBrushKey);
        Assert.Equal("500 Wh", display.Primary[4].Value);    // energy recovered <= 1000 Wh
        Assert.Equal("200", display.Primary[5].Value);       // 2000 Wh / 10 km
        Assert.Equal("Wh/km", display.Primary[5].Unit);
        Assert.Equal("TsChartPowerBrush", display.Primary[5].AccentBrushKey);
    }

    [Fact]
    public void Project_metric_formats_secondary_grid()
    {
        var display = MoreDetailsProjection.Project(Snap(), UnitPref.Metric, Localizer);

        Assert.Equal(6, display.Secondary.Count);

        Assert.Equal("Avg Power", display.Secondary[0].Label);
        Assert.Equal("12.0", display.Secondary[0].Value);
        Assert.Equal("kW", display.Secondary[0].Unit);

        Assert.Equal("12.0", display.Secondary[1].Value);    // outside temp
        Assert.Equal("\u00B0C", display.Secondary[1].Unit);
        Assert.Equal("TsChartSpeedBrush", display.Secondary[1].AccentBrushKey);

        Assert.Equal("22.0", display.Secondary[2].Value);    // inside temp
        Assert.Equal("TsColorWarningBrush", display.Secondary[2].AccentBrushKey);

        Assert.Equal("Min Speed", display.Secondary[3].Label);
        Assert.Equal("36", display.Secondary[3].Value);      // 10 m/s -> 36 km/h
        Assert.Equal("km/h", display.Secondary[3].Unit);
        Assert.Equal("TsColorTextSecondaryBrush", display.Secondary[3].AccentBrushKey);

        Assert.Equal("15%", display.Secondary[4].Value);     // 80 - 65
        Assert.Equal("1.5 kWh", display.Secondary[5].Value); // 2000 - 500 Wh
        Assert.Equal("TsColorInfoBrush", display.Secondary[5].AccentBrushKey);
    }

    [Fact]
    public void Project_imperial_converts_distance_speed_temperature_and_efficiency()
    {
        var display = MoreDetailsProjection.Project(Snap(), UnitPref.Imperial, Localizer);

        Assert.Equal("31 \u2192 37", display.Primary[0].Value);   // 50000/60000 m -> mi
        Assert.Equal("mi", display.Primary[0].Unit);
        Assert.Equal("186 \u2192 180", display.Primary[1].Value); // 300000/290000 m -> mi
        Assert.Equal("322", display.Primary[5].Value);            // 200 Wh/km * 1.609344
        Assert.Equal("Wh/mi", display.Primary[5].Unit);

        Assert.Equal("53.6", display.Secondary[1].Value);         // 12 C -> 53.6 F
        Assert.Equal("\u00B0F", display.Secondary[1].Unit);
        Assert.Equal("71.6", display.Secondary[2].Value);         // 22 C -> 71.6 F
        Assert.Equal("22", display.Secondary[3].Value);           // 10 m/s -> 22 mph
        Assert.Equal("mph", display.Secondary[3].Unit);

        // Elevation stays in raw metres regardless of unit system.
        Assert.Equal("\u2191 30 m", display.Primary[2].Value);
    }

    [Fact]
    public void Project_renders_em_dash_for_missing_metrics()
    {
        var snapshot = Snap(
            distanceM: 0, energyUsedWh: null, avgPowerW: null,
            startBatteryPct: null, endBatteryPct: null, rowCount: 4,
            sumPowerKw: 0, sumRegenPowerKw: 0, elevGainM: 0, elevLossM: 0,
            minSpeedMps: null, avgOutsideTempC: null, avgInsideTempC: null,
            odometerStartM: null, odometerEndM: null, startRangeM: null, endRangeM: null,
            regenEnergyWh: null);

        var display = MoreDetailsProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.True(display.HasData);                                  // rows present
        Assert.Equal("\u2014", display.Primary[0].Value);             // odometer
        Assert.Equal("\u2014", display.Primary[1].Value);             // range
        Assert.Equal("\u2014", display.Primary[5].Value);             // consumption (distance 0)
        Assert.Equal("0 Wh", display.Primary[3].Value);               // energy consumed
        Assert.Equal(4, display.Secondary.Count);                     // no temperatures
        Assert.Equal("\u2014", display.Secondary.Single(t => t.Label == "Battery Used").Value);
        Assert.Equal("0", display.Secondary.Single(t => t.Label == "Min Speed").Value);
    }

    [Fact]
    public void Project_range_shows_question_mark_when_end_absent()
    {
        var display = MoreDetailsProjection.Project(Snap(endRangeM: null), UnitPref.Metric, Localizer);

        Assert.Equal("300 \u2192 ?", display.Primary[1].Value);
    }

    [Fact]
    public void Project_temperature_cells_are_conditional()
    {
        var bothNull = MoreDetailsProjection.Project(
            Snap(avgOutsideTempC: null, avgInsideTempC: null), UnitPref.Metric, Localizer);
        Assert.Equal(4, bothNull.Secondary.Count);
        Assert.DoesNotContain(bothNull.Secondary, t => t.Label == "Avg Outside Temp");

        var outsideOnly = MoreDetailsProjection.Project(
            Snap(avgInsideTempC: null), UnitPref.Metric, Localizer);
        Assert.Equal(5, outsideOnly.Secondary.Count);
        Assert.Contains(outsideOnly.Secondary, t => t.Label == "Avg Outside Temp");
        Assert.DoesNotContain(outsideOnly.Secondary, t => t.Label == "Avg Inside Temp");
    }

    [Fact]
    public void Project_falls_back_to_telemetry_power_when_aggregate_absent()
    {
        // avg_power_w absent -> mean of telemetry power (SumPowerKw / RowCount = 35/3 = 11.67 kW).
        var display = MoreDetailsProjection.Project(Snap(avgPowerW: null), UnitPref.Metric, Localizer);

        Assert.Equal("11.7", display.Secondary[0].Value);
    }

    [Fact]
    public void Project_cells_have_accessibility_names()
    {
        var display = MoreDetailsProjection.Project(Snap(), UnitPref.Metric, Localizer);

        Assert.Equal("Odometer (From \u2192 To): 50 \u2192 60 km", display.Primary[0].AutomationName);
        Assert.Equal("Avg Power: 12.0 kW", display.Secondary[0].AutomationName);
        Assert.Contains("\u2191 30 m", display.Primary[2].AutomationName, StringComparison.Ordinal);
        Assert.Contains("\u2193 20 m", display.Primary[2].AutomationName, StringComparison.Ordinal);

        foreach (var tile in display.Primary.Concat(display.Secondary))
        {
            Assert.False(string.IsNullOrWhiteSpace(tile.AutomationName));
        }
    }

    [Fact]
    public void Project_em_dash_cell_omits_unit_from_narrator_name()
    {
        var display = MoreDetailsProjection.Project(Snap(odometerStartM: null, odometerEndM: null), UnitPref.Metric, Localizer);

        Assert.Equal("Odometer (From \u2192 To): \u2014", display.Primary[0].AutomationName);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(CanonicalDrive);

        var cached = MoreDetailsPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10000, cached.Value!.DistanceM);

        var offline = MoreDetailsPanelResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(CanonicalDrive);

        Assert.Equal(LoadStatus.Loaded, MoreDetailsPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, MoreDetailsPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, MoreDetailsPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new MoreDetailsPanelViewModel(new FakeSource(), Localizer);
        Assert.Equal(MoreDetailsState.Loading, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_both_grids()
    {
        using var vm = NewViewModel(Loaded(Snap()));

        await vm.LoadAsync();

        Assert.Equal(MoreDetailsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Primary.Count);
        Assert.Equal(6, vm.Display.Secondary.Count);
        Assert.Equal("50 \u2192 60", vm.Display.Primary[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_meaningful_stats_renders_empty()
    {
        using var vm = NewViewModel(Loaded(MoreDetailsSnapshot.Empty));

        await vm.LoadAsync();

        Assert.Equal(MoreDetailsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No drive details available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<MoreDetailsSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(MoreDetailsState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<MoreDetailsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(MoreDetailsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<MoreDetailsSnapshot>.Cached(Snap(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(MoreDetailsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<MoreDetailsSnapshot>.OfflineCached(
            Snap(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(MoreDetailsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<MoreDetailsSnapshot>.Loading(),
            RepositoryResult<MoreDetailsSnapshot>.Cached(Snap(odometerStartM: 10000, odometerEndM: 20000), Now, stale: false),
            RepositoryResult<MoreDetailsSnapshot>.Loaded(Snap(), Now));

        await vm.LoadAsync();

        Assert.Equal(MoreDetailsState.Loaded, vm.State);
        Assert.Equal("50 \u2192 60", vm.Display.Primary[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Snap()));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.Primary[0].Unit);
        Assert.Equal("50 \u2192 60", vm.Display.Primary[0].Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("mi", vm.Display.Primary[0].Unit);
        Assert.Equal("31 \u2192 37", vm.Display.Primary[0].Value);
        Assert.Equal(MoreDetailsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(Loaded(Snap()));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(MoreDetailsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<MoreDetailsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("More Details", vm.Title);
        Assert.Equal("No drive details available", vm.EmptyMessage);
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snap()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(MoreDetailsPanelViewModel.State), changed);
        Assert.Contains(nameof(MoreDetailsPanelViewModel.Display), changed);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_streams_and_targets_the_drive_detail_operation_with_path_param()
    {
        using var doc = JsonDocument.Parse(CanonicalDrive);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, "4321");

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.HasData);
        Assert.Equal(Operations.Drives.Detail, client.Requests[^1].OperationId);
        Assert.Equal("4321", client.Requests[^1].PathParams![MoreDetailsPanelSource.DriveIdParam]);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, "1");

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public void Source_exposes_its_drive_id() =>
        Assert.Equal("99", NewSource(new FakeApiClient(), "99").DriveId);

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("more-details-panel", MoreDetailsPanelRegistration.Id);
        Assert.Equal("MoreDetailsPanel", MoreDetailsPanelRegistration.Slug);
        Assert.Equal("More Details", MoreDetailsPanelRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MoreDetailsPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MoreDetailsPanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static MoreDetailsSnapshot Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return MoreDetailsSnapshot.FromJson(doc.RootElement);
    }

    private static MoreDetailsSnapshot Snap(
        double distanceM = 10000,
        long durationS = 1800,
        double? energyUsedWh = 2000,
        double? regenEnergyWh = 500,
        double? avgPowerW = 12000,
        long? startBatteryPct = 80,
        long? endBatteryPct = 65,
        int rowCount = 3,
        double sumPowerKw = 35,
        double sumRegenPowerKw = 5,
        double elevGainM = 30,
        double elevLossM = 20,
        double? minSpeedMps = 10,
        double? avgOutsideTempC = 12,
        double? avgInsideTempC = 22,
        double? odometerStartM = 50000,
        double? odometerEndM = 60000,
        double? startRangeM = 300000,
        double? endRangeM = 290000) =>
        new(distanceM, durationS, energyUsedWh, regenEnergyWh, avgPowerW, startBatteryPct, endBatteryPct,
            rowCount, sumPowerKw, sumRegenPowerKw, elevGainM, elevLossM, minSpeedMps,
            avgOutsideTempC, avgInsideTempC, odometerStartM, odometerEndM, startRangeM, endRangeM);

    private static RepositoryResult<MoreDetailsSnapshot> Loaded(MoreDetailsSnapshot snapshot) =>
        RepositoryResult<MoreDetailsSnapshot>.Loaded(snapshot, Now);

    private static MoreDetailsPanelViewModel NewViewModel(params RepositoryResult<MoreDetailsSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private static MoreDetailsPanelSource NewSource(IApiClient client, string driveId)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new MoreDetailsPanelSource(client, engine, options, driveId);
    }

    private static async Task<IReadOnlyList<RepositoryResult<MoreDetailsSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<MoreDetailsSnapshot>> stream)
    {
        var list = new List<RepositoryResult<MoreDetailsSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<MoreDetailsSnapshot>[] emissions) : IMoreDetailsPanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<MoreDetailsSnapshot>> StreamAsync(
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
}
