using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Driving;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the drive-detail Hero Gauges feature surface's UI-thread-free logic — the
/// drive-detail JSON parse (distance / duration / max-speed / energy / power / battery / telemetry fallback),
/// the gauge projection in both metric and imperial units (values, full-sweep maxima, unit suffixes, neon
/// accents, decimal precision, accessible names), the cache-then-network result mapper, the localized labels +
/// i18n key set, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/HeroGauges.tsx and its useDriveDetailData stats). The
/// WinUI view itself (HeroGauges.cs) is exercised by the app build.
/// </summary>
public sealed class DrivingHeroGaugesTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // A 20 mi / 32186.88 m, 30 min drive: 6 kWh used, 12 kW average, 80% -> 70% battery, mean telemetry 12 kW.
    private const string SampleDrive = """
    {
      "id": 42,
      "distance_m": 32186.88,
      "duration_s": 1800,
      "max_speed_mps": 30,
      "energy_used_wh": 6000,
      "avg_power_w": 12000,
      "start_battery_pct": 80,
      "end_battery_pct": 70,
      "telemetry": [ {"power": 10}, {"power": 14} ]
    }
    """;

    private static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static DriveGauges Sample() => DriveGauges.FromDriveJson(Parse(SampleDrive));

    // ---- Parse adapter --------------------------------------------------------------

    [Fact]
    public void FromDriveJson_reads_the_canonical_si_fields()
    {
        var drive = Sample();

        Assert.True(drive.HasData);
        Assert.Equal(32186.88, drive.DistanceM);
        Assert.Equal(1800, drive.DurationS);
        Assert.Equal(30, drive.MaxSpeedMps);
        Assert.Equal(6000, drive.EnergyUsedWh);
        Assert.Equal(12000, drive.AvgPowerW);
        Assert.Equal(80, drive.StartBatteryPct);
        Assert.Equal(70, drive.EndBatteryPct);
        Assert.Equal(12, drive.FallbackAvgPowerKw); // mean(10, 14)
    }

    [Fact]
    public void FromDriveJson_is_tolerant_of_missing_optional_fields()
    {
        var drive = DriveGauges.FromDriveJson(Parse("""{"id": 7, "distance_m": 1000, "duration_s": 600}"""));

        Assert.True(drive.HasData);
        Assert.Equal(1000, drive.DistanceM);
        Assert.Equal(600, drive.DurationS);
        Assert.Null(drive.MaxSpeedMps);
        Assert.Null(drive.EnergyUsedWh);
        Assert.Null(drive.AvgPowerW);
        Assert.Null(drive.StartBatteryPct);
        Assert.Null(drive.EndBatteryPct);
        Assert.Equal(0, drive.FallbackAvgPowerKw);
    }

    [Fact]
    public void FromDriveJson_averages_only_telemetry_power_for_the_fallback()
    {
        // web parity: chartData.reduce(power) / length over the telemetry array; null powers count as zero.
        var drive = DriveGauges.FromDriveJson(Parse("""
        {"id": 1, "distance_m": 1000, "duration_s": 100,
         "telemetry": [ {"power": 20}, {"power": null}, {} ]}
        """));

        Assert.Equal(20.0 / 3, drive.FallbackAvgPowerKw, 6); // (20 + 0 + 0) / 3
    }

    [Theory]
    [InlineData("{}")]    // property-less object
    [InlineData("[]")]    // array, not a drive object
    [InlineData("null")]  // null body
    [InlineData("\"x\"")] // scalar
    public void FromDriveJson_returns_empty_for_no_drive(string json)
    {
        var drive = DriveGauges.FromDriveJson(Parse(json));

        Assert.False(drive.HasData);
        Assert.Same(DriveGauges.Empty, DriveGauges.FromDriveJson(Parse(json)));
    }

    // ---- Projection (metric) --------------------------------------------------------

    [Fact]
    public void Project_renders_the_five_drive_gauges_in_metric()
    {
        var view = HeroGaugesProjection.Project(Sample(), UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal(5, view.Gauges.Count);

        Assert.Equal("Distance", view.Gauges[0].Label);
        Assert.Equal(32, view.Gauges[0].Value);      // round(32.18688 km)
        Assert.Equal(100, view.Gauges[0].Max);       // max(32.18688 * 1.5, 100)
        Assert.Equal("km", view.Gauges[0].Unit);

        Assert.Equal("Max Speed", view.Gauges[1].Label);
        Assert.Equal(108, view.Gauges[1].Value);     // 30 m/s -> 108 km/h
        Assert.Equal(900, view.Gauges[1].Max);       // 250 m/s -> 900 km/h
        Assert.Equal("km/h", view.Gauges[1].Unit);

        Assert.Equal("Duration", view.Gauges[2].Label);
        Assert.Equal(30, view.Gauges[2].Value);      // 1800 s / 60
        Assert.Equal(60, view.Gauges[2].Max);        // max(30 * 1.5, 60)
        Assert.Equal("min", view.Gauges[2].Unit);

        Assert.Equal("Consumption", view.Gauges[3].Label);
        Assert.Equal(186, view.Gauges[3].Value);     // 6000 Wh / 32.18688 km
        Assert.Equal(300, view.Gauges[3].Max);       // max(186.41 * 1.5, 300)
        Assert.Equal("Wh/km", view.Gauges[3].Unit);

        Assert.Equal("Efficiency", view.Gauges[4].Label);
        Assert.Equal(3.11, view.Gauges[4].Value);    // (80 - 70) / 32.18688 km * 10
        Assert.Equal(30, view.Gauges[4].Max);
        Assert.Equal("%/100km", view.Gauges[4].Unit);
    }

    [Fact]
    public void Project_converts_to_imperial_units()
    {
        var view = HeroGaugesProjection.Project(Sample(), UnitPref.Imperial, Localizer);

        Assert.Equal(20, view.Gauges[0].Value);      // 32186.88 m -> 20 mi
        Assert.Equal("mi", view.Gauges[0].Unit);

        Assert.Equal(67, view.Gauges[1].Value);      // 30 m/s -> 67.108 mph
        Assert.Equal("mph", view.Gauges[1].Unit);

        Assert.Equal(30, view.Gauges[2].Value);      // duration is unit-independent
        Assert.Equal("min", view.Gauges[2].Unit);

        Assert.Equal(300, view.Gauges[3].Value);     // 6000 Wh / 20 mi
        Assert.Equal("Wh/mi", view.Gauges[3].Unit);

        Assert.Equal(5, view.Gauges[4].Value);       // (80 - 70) / 20 mi * 10
        Assert.Equal("%/100mi", view.Gauges[4].Unit);
    }

    [Fact]
    public void Project_assigns_the_web_neon_accents_per_gauge()
    {
        var view = HeroGaugesProjection.Project(Sample(), UnitPref.Metric, Localizer);

        Assert.Equal(
            new[]
            {
                HeroGaugeAccent.Cyan,    // distance #00f0ff
                HeroGaugeAccent.Purple,  // max speed #a855f7
                HeroGaugeAccent.Amber,   // duration #f59e0b
                HeroGaugeAccent.Red,     // consumption #ef4444
                HeroGaugeAccent.Green,   // efficiency #10b981
            },
            view.Gauges.Select(g => g.Accent).ToArray());
    }

    [Fact]
    public void Project_uses_web_decimal_rules_per_gauge()
    {
        var metric = HeroGaugesProjection.Project(Sample(), UnitPref.Metric, Localizer);
        // The four rounded gauges show integers (0 decimals); metric efficiency 3.11 is fractional (2 decimals).
        Assert.Equal(0, metric.Gauges[0].Decimals);
        Assert.Equal(0, metric.Gauges[1].Decimals);
        Assert.Equal(0, metric.Gauges[2].Decimals);
        Assert.Equal(0, metric.Gauges[3].Decimals);
        Assert.Equal(2, metric.Gauges[4].Decimals);

        // Imperial efficiency is exactly 5 -> integer -> 0 decimals.
        var imperial = HeroGaugesProjection.Project(Sample(), UnitPref.Imperial, Localizer);
        Assert.Equal(0, imperial.Gauges[4].Decimals);
    }

    [Fact]
    public void Project_omits_the_efficiency_gauge_without_both_battery_endpoints()
    {
        var drive = DriveGauges.FromDriveJson(Parse("""
        {"id": 9, "distance_m": 10000, "duration_s": 900, "max_speed_mps": 25, "energy_used_wh": 2000}
        """));

        var view = HeroGaugesProjection.Project(drive, UnitPref.Metric, Localizer);

        Assert.Equal(4, view.Gauges.Count);
        Assert.DoesNotContain(view.Gauges, g => g.Label == "Efficiency");
    }

    [Fact]
    public void Project_falls_back_to_average_power_for_consumption_when_energy_is_absent()
    {
        // No energy_used_wh: energyWh = |avgPowerW / 1000| * hours * 1000 = 12 kW * 0.5 h * 1000 = 6000 Wh.
        var drive = DriveGauges.FromDriveJson(Parse("""
        {"id": 3, "distance_m": 32186.88, "duration_s": 1800, "avg_power_w": 12000}
        """));

        var view = HeroGaugesProjection.Project(drive, UnitPref.Metric, Localizer);

        Assert.Equal(186, view.Gauges[3].Value); // same 186 Wh/km as the energy-reported drive
    }

    [Fact]
    public void Project_falls_back_to_telemetry_power_when_no_aggregate_power_exists()
    {
        // Neither energy_used_wh nor avg_power_w: energy uses the telemetry mean (12 kW) * 0.5 h * 1000 = 6000 Wh.
        var drive = DriveGauges.FromDriveJson(Parse("""
        {"id": 4, "distance_m": 32186.88, "duration_s": 1800,
         "telemetry": [ {"power": 10}, {"power": 14} ]}
        """));

        var view = HeroGaugesProjection.Project(drive, UnitPref.Metric, Localizer);

        Assert.Equal(186, view.Gauges[3].Value);
    }

    [Fact]
    public void ConsumptionWhKm_is_zero_for_a_zero_distance_drive()
    {
        var drive = DriveGauges.FromDriveJson(Parse("""{"id": 5, "distance_m": 0, "duration_s": 600, "energy_used_wh": 100}"""));

        Assert.Equal(0, HeroGaugesProjection.ConsumptionWhKm(drive));
    }

    [Fact]
    public void Project_empty_drive_is_not_data_but_still_projects_the_base_gauges()
    {
        var view = HeroGaugesProjection.Project(DriveGauges.Empty, UnitPref.Metric, Localizer);

        Assert.False(view.HasData);
        Assert.Equal(4, view.Gauges.Count); // distance, max speed, duration, consumption (all zero)
        Assert.Equal(0, view.Gauges[0].Value);
        Assert.Equal(100, view.Gauges[0].Max); // floor still applies when value is zero
    }

    // ---- Accessibility --------------------------------------------------------------

    [Fact]
    public void Every_gauge_exposes_a_descriptive_automation_name()
    {
        var view = HeroGaugesProjection.Project(Sample(), UnitPref.Metric, Localizer);

        Assert.All(view.Gauges, g => Assert.False(string.IsNullOrWhiteSpace(g.AutomationName)));
        Assert.Equal("Distance: 32 km", view.Gauges[0].AutomationName);
        Assert.Equal("Max Speed: 108 km/h", view.Gauges[1].AutomationName);
        Assert.Equal("Duration: 30 min", view.Gauges[2].AutomationName);
        Assert.Equal("Consumption: 186 Wh/km", view.Gauges[3].AutomationName);
        Assert.Equal("Efficiency: 3.11 %/100km", view.Gauges[4].AutomationName);
        Assert.Equal("Drive statistics", view.AutomationName);
    }

    // ---- i18n -----------------------------------------------------------------------

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        HeroGaugesProjection.Project(Sample(), UnitPref.Metric, recorder);
        using var vm = new HeroGaugesViewModel(new FakeHeroGaugesSource(), recorder);
        _ = vm.EmptyMessage;

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["driveDetail.distance"] = "Distance",
            ["driveDetail.maxSpeed"] = "Max Speed",
            ["driveDetail.duration"] = "Duration",
            ["driveDetail.consumption"] = "Consumption",
            ["driveDetail.efficiency"] = "Efficiency",
            ["driveDetail.gauges.aria"] = "Drive statistics",
            ["driveDetail.gauges.empty"] = "No drive data available yet",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    // ---- Result mapper --------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_projects_payload()
    {
        var drive = Parse(SampleDrive);

        var cached = HeroGaugesResultMapper.Map(RepositoryResult<JsonElement>.Cached(drive, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);
        Assert.Equal(32186.88, cached.Value.DistanceM);

        var offline = HeroGaugesResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            drive, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        var drive = Parse(SampleDrive);

        Assert.Equal(LoadStatus.Loaded, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(drive, Now)).Status);

        Assert.Equal(LoadStatus.Empty, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ----------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DriveGauges>.Loading());
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauges()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(5, vm.Display.Gauges.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_a_drive_renders_empty()
    {
        using var vm = NewViewModel(Loaded(DriveGauges.Empty));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No drive data available yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DriveGauges>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DriveGauges>.Failure(new RepositoryError(RepositoryErrorKind.NotFound, "missing")));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("We couldn't find that drive", vm.ErrorMessage);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<DriveGauges>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<DriveGauges>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DriveGauges>.Loading(),
            RepositoryResult<DriveGauges>.Cached(Sample(), Now, stale: false),
            RepositoryResult<DriveGauges>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loaded, vm.State);
        Assert.Equal(5, vm.Display.Gauges.Count);
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_gauges()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.Gauges[0].Unit);
        Assert.Equal(32, vm.Display.Gauges[0].Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.Gauges[0].Unit);
        Assert.Equal(20, vm.Display.Gauges[0].Value);
    }

    [Fact]
    public async Task ViewModel_surface_name_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DriveGauges>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Drive statistics", vm.SurfaceName);
        Assert.Equal("No drive data available yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(HeroGaugesViewModel.State), changed);
        Assert.Contains(nameof(HeroGaugesViewModel.Display), changed);
    }

    // ---- Registration / diagnostics -------------------------------------------------

    [Fact]
    public void Registration_slug_and_category_are_stable()
    {
        Assert.Equal("HeroGauges", HeroGaugesRegistration.Slug);
        Assert.Equal("driving", HeroGaugesRegistration.Category);
        Assert.Equal("Drive statistics", HeroGaugesRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new HeroGaugesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HeroGauges", Assert.Single(lines));
    }

    // ---- Fakes / helpers ------------------------------------------------------------

    private static RepositoryResult<DriveGauges> Loaded(DriveGauges drive) =>
        RepositoryResult<DriveGauges>.Loaded(drive, Now);

    private static HeroGaugesViewModel NewViewModel(params RepositoryResult<DriveGauges>[] emissions) =>
        new(new FakeHeroGaugesSource(emissions), Localizer);

    private sealed class FakeHeroGaugesSource(params RepositoryResult<DriveGauges>[] emissions) : IHeroGaugesSource
    {
        public async IAsyncEnumerable<RepositoryResult<DriveGauges>> StreamAsync(
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

    private sealed class RecordingLocalizer : ILocalizer
    {
        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return fallback;
        }
    }
}
