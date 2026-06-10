using System.Globalization;
using System.Runtime.CompilerServices;
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
/// Headless verification of the Driving-Dynamics summary surface's UI-thread-free logic — the motor-history JSON
/// parse adapter (the snake_case torque / motor-temp / power / regen reads), the <c>computeMotorStats</c>
/// reduction (the per-axle torque sum, the per-row hottest motor temperature, the power/regen extrema and the
/// high-torque percentage, including the web temperature-suffix regression "49.0°C" not "49.0°°C"), the
/// projection into the six web tiles (Total Readings, Avg Torque, Peak Power, Peak Regen, Avg Power, Avg Motor
/// Temp) with the SI→display temperature conversion, the cache-then-network result mapper, the per-vehicle data
/// source (primary resolution + query-scoped request incl. the limit window + disabled-when-no-vehicle
/// short-circuit), the registry metadata, the PII-safe diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/driving/components/driving-dynamics/SummaryStats.tsx + helpers.ts +
/// pages/DrivingDynamicsPage.tsx).
/// </summary>
public sealed class SummaryStatsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);
    private const string EmDash = "\u2014";

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"torque_nm_front":120.5,"torque_nm_rear":80,"motor_temp_c_front":41,"motor_temp_c_rear":55,"power_kw":63.2,"regen_kw":12.4}
        """);

        var s = MotorStatsSample.FromJson(doc.RootElement);

        Assert.Equal(120.5, s.TorqueNmFront);
        Assert.Equal(80, s.TorqueNmRear);
        Assert.Equal(41, s.MotorTempCFront);
        Assert.Equal(55, s.MotorTempCRear);
        Assert.Equal(63.2, s.PowerKw);
        Assert.Equal(12.4, s.RegenKw);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var s = MotorStatsSample.FromJson(doc.RootElement);

        Assert.Null(s.TorqueNmFront);
        Assert.Null(s.TorqueNmRear);
        Assert.Null(s.MotorTempCFront);
        Assert.Null(s.MotorTempCRear);
        Assert.Null(s.PowerKw);
        Assert.Null(s.RegenKw);
    }

    [Fact]
    public void FromJson_parses_numeric_string_values()
    {
        using var doc = JsonDocument.Parse("""{"power_kw":"75.5"}""");

        Assert.Equal(75.5, MotorStatsSample.FromJson(doc.RootElement).PowerKw);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"power_kw":10}, 7, {"power_kw":20}]""");

        var list = MotorStatsSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(10, list[0].PowerKw);
        Assert.Equal(20, list[1].PowerKw);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"power_kw":1}""");
        Assert.Empty(MotorStatsSample.ParseList(doc.RootElement));
    }

    // ---- computeMotorStats reduction (web helpers.ts) ------------------------------

    [Fact]
    public void Compute_returns_null_for_empty_series()
    {
        Assert.Null(SummaryMotorStats.Compute(Array.Empty<MotorStatsSample>()));
    }

    [Fact]
    public void Compute_matches_web_reduction()
    {
        var stats = SummaryMotorStats.Compute(Samples(
            new MotorStatsSample(100, 50, 40, 60, 30, 10),
            new MotorStatsSample(250, null, null, 50, 90, 5)));

        Assert.NotNull(stats);
        Assert.Equal(2, stats!.TotalReadings);
        Assert.Equal(200, stats.AvgTorque);   // (150 + 250) / 2
        Assert.Equal(250, stats.MaxTorque);
        Assert.Equal(55, stats.AvgMotorTemp);  // (max(40,60)=60 + max(-inf,50)=50) / 2
        Assert.Equal(60, stats.MaxMotorTemp);
        Assert.Equal(60, stats.AvgPower);      // (30 + 90) / 2
        Assert.Equal(90, stats.PeakPower);
        Assert.Equal(30, stats.MinPower);
        Assert.Equal(10, stats.PeakRegen);
        Assert.Equal(50, stats.HighTorquePct); // 1 of 2 torque samples above 200 Nm
    }

    [Fact]
    public void Compute_excludes_rows_with_no_torque_or_temp_reading()
    {
        // A row with neither axle torque nor either motor temp contributes only its power.
        var stats = SummaryMotorStats.Compute(Samples(
            new MotorStatsSample(null, null, null, null, 42, null)));

        Assert.NotNull(stats);
        Assert.Equal(1, stats!.TotalReadings);
        Assert.Equal(0, stats.AvgTorque);     // empty torque series → web avg([]) === 0
        Assert.Equal(0, stats.AvgMotorTemp);  // empty motor-temp series → 0
        Assert.Equal(42, stats.AvgPower);
        Assert.Equal(42, stats.PeakPower);
        Assert.Equal(0, stats.PeakRegen);
    }

    [Fact]
    public void Compute_torque_sums_present_axle_when_other_is_null()
    {
        // Web: f + r with f ?? 0 / r ?? 0, but only when at least one axle is present.
        var stats = SummaryMotorStats.Compute(Samples(new MotorStatsSample(null, 75, null, null, null, null)));

        Assert.Equal(75, stats!.AvgTorque);
    }

    // ---- Projection (web StatCard composition) -------------------------------------

    [Fact]
    public void Project_null_stats_is_empty()
    {
        var view = MotorSummaryProjection.Project(null, UnitPref.Metric, Localizer);

        Assert.False(view.HasData);
        Assert.Empty(view.Cards);
    }

    [Fact]
    public void Project_builds_six_cards_in_web_order_with_units()
    {
        var stats = SummaryMotorStats.Compute(Samples(
            new MotorStatsSample(100, 50, 40, 60, 30, 10),
            new MotorStatsSample(250, null, null, 50, 90, 5)));

        var view = MotorSummaryProjection.Project(stats, UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal(6, view.Cards.Count);

        Assert.Equal("Total Readings", view.Cards[0].Label);
        Assert.Equal("2", view.Cards[0].Value);

        Assert.Equal("Avg Torque", view.Cards[1].Label);
        Assert.Equal("200.0 Nm", view.Cards[1].Value);

        Assert.Equal("Peak Power", view.Cards[2].Label);
        Assert.Equal("90.0 kW", view.Cards[2].Value);

        Assert.Equal("Peak Regen", view.Cards[3].Label);
        Assert.Equal("10.0 kW", view.Cards[3].Value);

        Assert.Equal("Avg Power", view.Cards[4].Label);
        Assert.Equal("60.0 kW", view.Cards[4].Value);

        Assert.Equal("Avg Motor Temp", view.Cards[5].Label);
        Assert.Equal("55.0\u00B0C", view.Cards[5].Value);
    }

    [Fact]
    public void Project_tiles_carry_their_web_lucide_glyphs()
    {
        var stats = SummaryMotorStats.Compute(Samples(new MotorStatsSample(10, 10, 30, 30, 5, 1)));
        var view = MotorSummaryProjection.Project(stats, UnitPref.Metric, Localizer);

        Assert.Equal(MotorSummaryProjection.TotalReadingsGlyph, view.Cards[0].Glyph);
        Assert.Equal(MotorSummaryProjection.TorqueGlyph, view.Cards[1].Glyph);
        Assert.Equal(MotorSummaryProjection.PeakPowerGlyph, view.Cards[2].Glyph);
        Assert.Equal(MotorSummaryProjection.RegenGlyph, view.Cards[3].Glyph);
        Assert.Equal(MotorSummaryProjection.AvgPowerGlyph, view.Cards[4].Glyph);
        Assert.Equal(MotorSummaryProjection.TemperatureGlyph, view.Cards[5].Glyph);
    }

    // The web SummaryStats.test.tsx regression: "49.0°C" / "120.2°F", never a doubled "°°" degree sign.
    [Fact]
    public void Project_temperature_tile_renders_single_degree_in_celsius()
    {
        var stats = SummaryMotorStats.Compute(Samples(new MotorStatsSample(null, null, 49, null, null, null)));

        var view = MotorSummaryProjection.Project(stats, UnitPref.Metric, Localizer);

        Assert.Equal("49.0\u00B0C", view.Cards[5].Value);
        Assert.DoesNotContain("\u00B0\u00B0", AllText(view));
    }

    [Fact]
    public void Project_temperature_tile_converts_and_renders_single_degree_in_fahrenheit()
    {
        var stats = SummaryMotorStats.Compute(Samples(new MotorStatsSample(null, null, 49, null, null, null)));

        var view = MotorSummaryProjection.Project(stats, UnitPref.Imperial, Localizer);

        Assert.Equal("120.2\u00B0F", view.Cards[5].Value); // 49°C → 120.2°F
        Assert.DoesNotContain("\u00B0\u00B0", AllText(view));
    }

    [Fact]
    public void Project_cards_have_non_empty_accessibility_names()
    {
        var stats = SummaryMotorStats.Compute(Samples(new MotorStatsSample(120, 80, 41, 55, 63, 12)));
        var view = MotorSummaryProjection.Project(stats, UnitPref.Metric, Localizer);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Value, card.AutomationName, StringComparison.Ordinal);
        }
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"power_kw":40},{"power_kw":90}]""");

        var cached = MotorSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Count);

        var offline = MotorSummaryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2, offline.Value!.Count);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse("""[{"power_kw":1}]""");

        Assert.Equal(LoadStatus.Loaded, MotorSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, MotorSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, MotorSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, MotorSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorStatsSample>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(MotorSummaryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_six_cards()
    {
        using var vm = NewViewModel(Loaded(SampleSet()));
        await vm.LoadAsync();

        Assert.Equal(MotorSummaryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorStatsSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(MotorSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No motor telemetry recorded yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_but_empty_list_collapses_to_empty()
    {
        // Web parity: computeMotorStats(([])) === null → the empty state, never zeroed cards.
        using var vm = NewViewModel(Loaded(Array.Empty<MotorStatsSample>()));
        await vm.LoadAsync();

        Assert.Equal(MotorSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MotorStatsSample>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(MotorSummaryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MotorStatsSample>>.Cached(SampleSet(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(MotorSummaryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorStatsSample>>.OfflineCached(
            SampleSet(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(MotorSummaryState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MotorStatsSample>>.Loading(),
            RepositoryResult<IReadOnlyList<MotorStatsSample>>.Cached(SampleSet(), Now, stale: false),
            RepositoryResult<IReadOnlyList<MotorStatsSample>>.Loaded(SampleSet(), Now));
        await vm.LoadAsync();

        Assert.Equal(MotorSummaryState.Loaded, vm.State);
        Assert.Equal(6, vm.Display.Cards.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperature()
    {
        using var vm = NewViewModel(Loaded(Samples(new MotorStatsSample(null, null, 49, null, null, null))));
        await vm.LoadAsync();
        string metricTemp = vm.Display.Cards[5].Value;

        vm.Units = UnitPref.Imperial;

        Assert.NotEqual(metricTemp, vm.Display.Cards[5].Value);
        Assert.Equal("120.2\u00B0F", vm.Display.Cards[5].Value);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorStatsSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Motor Summary", vm.Title);
        Assert.Equal("No motor telemetry recorded yet", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(SampleSet()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SummaryStatsViewModel.State), changed);
        Assert.Contains(nameof(SummaryStatsViewModel.Display), changed);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_scopes_request_with_limit()
    {
        using var doc = JsonDocument.Parse("""[{"power_kw":30},{"power_kw":90}]""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: null, primary: new WidgetVehicleSnapshot { VehicleId = 7 });

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.Count);
        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_motor", request.OperationId);
        Assert.Equal(7L, (long)request.Query!["vehicle_id"]!);
        Assert.Equal(MotorSummarySource.DefaultLimit, (int)request.Query!["limit"]!);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"power_kw":12}]""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: 42, primary: null);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(42L, (long)client.Requests[^1].Query!["vehicle_id"]!);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_treats_an_empty_array_as_empty()
    {
        var client = new FakeApiClient().ReturnsValue(EmptyArray());
        var source = NewSource(client, vehicleId: 7);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var client = new FakeApiClient();
        var source = NewSource(client, vehicleId: null, primary: null);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(client.Requests);
    }

    // ---- Contract / registration / diagnostics -------------------------------------

    [Fact]
    public void Motor_history_operation_resolves_against_generated_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.Single(e => e.OperationId == "get_api_v1_motor");
        Assert.Equal("/motor/", descriptor.Path);
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor.Method);
    }

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("summary-stats", MotorSummaryRegistration.Id);
        Assert.Equal("driving", MotorSummaryRegistration.Category);
        Assert.Equal("SummaryStats", MotorSummaryRegistration.Slug);
        Assert.Equal("Motor Summary", MotorSummaryRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new MotorSummaryDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SummaryStats", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static IReadOnlyList<MotorStatsSample> Samples(params MotorStatsSample[] samples) => samples;

    private static IReadOnlyList<MotorStatsSample> SampleSet() => Samples(
        new MotorStatsSample(100, 50, 40, 60, 30, 10),
        new MotorStatsSample(250, null, null, 50, 90, 5));

    private static string AllText(MotorSummaryDisplay view)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var card in view.Cards)
        {
            sb.Append(card.Label).Append(card.Value).Append(card.AutomationName);
        }

        return sb.ToString();
    }

    private static RepositoryResult<IReadOnlyList<MotorStatsSample>> Loaded(IReadOnlyList<MotorStatsSample> samples) =>
        RepositoryResult<IReadOnlyList<MotorStatsSample>>.Loaded(samples, Now);

    private static SummaryStatsViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<MotorStatsSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private static MotorSummarySource NewSource(
        IApiClient client, long? vehicleId, WidgetVehicleSnapshot? primary = null)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new MotorSummarySource(new FakeWidgetVehicleSource(primary), client, engine, options, vehicleId);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<MotorStatsSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<MotorStatsSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<MotorStatsSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<MotorStatsSample>>[] emissions)
        : IMotorSummarySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MotorStatsSample>>> StreamAsync(
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
