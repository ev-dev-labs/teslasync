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

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the RegenEfficiencyWidget's UI-thread-free logic — the JSON parse adapter (the
/// useRegenEfficiency normalisation of the snake_case <c>/analytics/regen</c> body), the <c>regenColor</c>
/// threshold helper, the <c>regenPct = regenRatio * 100</c> derivation, the clamped gauge value / "%" caption /
/// "recovery" unit, the unit-formatted stats across the compact / wide footprints, the cache-then-network
/// result mapper, the per-vehicle data source (primary resolution + query-scoped request), the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty
/// / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx).
/// </summary>
public sealed class RegenEfficiencyWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private static readonly RegenEfficiencySize StdSize = new(2, 2);

    // ---- Parse adapter (web useRegenEfficiency normalisation) -----------------------

    [Fact]
    public void FromResponse_reads_all_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(
            """{"total_regen_wh":15000,"regen_ratio":0.23,"monthly_avg_regen":2000,"free_charges":3,"total_drive_wh":75000}""");

        var data = RegenEfficiencyData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(15000, data!.TotalRegenWh);
        Assert.Equal(0.23, data.RegenRatio);
        Assert.Equal(2000, data.MonthlyAvgRegen);
        Assert.Equal(3, data.FreeCharges);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_regen_wh":1200}""");

        var data = RegenEfficiencyData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(1200, data!.TotalRegenWh);
        Assert.Equal(0, data.RegenRatio);
        Assert.Equal(0, data.MonthlyAvgRegen);
        Assert.Equal(0, data.FreeCharges);
    }

    [Fact]
    public void FromResponse_reads_empty_object_as_usable_zero_summary()
    {
        // Web parity: with a vehicle the response is always an object; `data` is truthy so the gauge renders at
        // 0% — the widget does NOT show the empty surface for an object body.
        using var doc = JsonDocument.Parse("{}");

        var data = RegenEfficiencyData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(0, data!.RegenRatio);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("42")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(RegenEfficiencyData.FromResponse(doc.RootElement));
    }

    // ---- Recovery colour thresholds (web regenColor) -------------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(31, StatusKind.Success)]
    [InlineData(30, StatusKind.Warning)]   // web: strict > 30
    [InlineData(16, StatusKind.Warning)]
    [InlineData(15, StatusKind.Danger)]    // web: strict > 15
    [InlineData(0, StatusKind.Danger)]
    public void StatusFor_classifies_by_threshold(double percent, StatusKind expected) =>
        Assert.Equal(expected, RegenEfficiencyProjection.StatusFor(percent));

    [Theory]
    [InlineData(StatusKind.Success, "TsColorSuccessBrush")]
    [InlineData(StatusKind.Warning, "TsColorWarningBrush")]
    [InlineData(StatusKind.Danger, "TsColorDangerBrush")]
    public void Status_maps_to_themed_status_brush(StatusKind status, string brushKey) =>
        Assert.Equal(brushKey, StatusResources.AccentBrushKey(status));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(30, RegenEfficiencyProjection.GreenThreshold);
        Assert.Equal(15, RegenEfficiencyProjection.AmberThreshold);
        Assert.Equal(100, RegenEfficiencyProjection.MaxPercent);
    }

    // ---- Projection: regenPct derivation (web parity) ------------------------------

    [Fact]
    public void Project_multiplies_ratio_by_hundred_for_gauge_and_caption()
    {
        // Web parity (RegenEfficiencyWidget.tsx L32): regenPct = regenRatio * 100.
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(0, 0.234, 0, 0), StdSize, UnitPref.Metric, Localizer);

        Assert.Equal(23, view.GaugeValue);
        Assert.Equal(100, view.GaugeMax);
        Assert.Equal("23", view.GaugeValueText);
        Assert.Equal("23%", view.GaugeCaption);
        Assert.Equal("recovery", view.GaugeUnit);
        Assert.Equal(StatusKind.Warning, view.Status); // 23.4 -> > 15, not > 30
    }

    [Fact]
    public void Project_clamps_gauge_value_but_caption_shows_raw_rounded_percent()
    {
        // A larger ratio drives regenPct past the gauge max: the centre value clamps to 100, while the caption
        // mirrors the web RadialGauge `label = ${Math.round(regenPct)}%` (unclamped).
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(0, 23.4, 0, 0), StdSize, UnitPref.Metric, Localizer);

        Assert.Equal(100, view.GaugeValue);
        Assert.Equal("100", view.GaugeValueText);
        Assert.Equal("2,340%", view.GaugeCaption);
        Assert.Equal(StatusKind.Success, view.Status); // 2340 -> > 30
    }

    [Theory]
    [InlineData(0.35, StatusKind.Success)] // 35% -> green
    [InlineData(0.20, StatusKind.Warning)] // 20% -> amber
    [InlineData(0.10, StatusKind.Danger)]  // 10% -> red
    public void Project_colours_arc_by_recovery_percent(double ratio, StatusKind expected)
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(0, ratio, 0, 0), StdSize, UnitPref.Metric, Localizer);
        Assert.Equal(expected, view.Status);
    }

    [Fact]
    public void Project_coerces_non_finite_ratio_to_zero()
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(0, double.NaN, 0, 0), StdSize, UnitPref.Metric, Localizer);

        Assert.Equal(0, view.GaugeValue);
        Assert.Equal("0", view.GaugeValueText);
        Assert.Equal("0%", view.GaugeCaption);
        Assert.Equal(StatusKind.Danger, view.Status);
    }

    // ---- Projection: stats (web GaugeHeroStat + useUnits) --------------------------

    [Fact]
    public void Project_formats_stats_in_metric_units()
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(15000, 0.2, 2000, 3), StdSize, UnitPref.Metric, Localizer);

        Assert.Equal(3, view.Stats.Count);
        Assert.Equal("Total Recovered", view.Stats[0].Label);
        Assert.Equal("15,000.0 Wh", view.Stats[0].ValueText);
        Assert.Equal("Monthly Avg", view.Stats[1].Label);
        Assert.Equal("2,000.0 W", view.Stats[1].ValueText);
        Assert.Equal("Free Charges", view.Stats[2].Label);
        Assert.Equal("3", view.Stats[2].ValueText);
        Assert.True(view.ShowStats);
    }

    [Fact]
    public void Project_formats_energy_and_power_stats_in_imperial_units()
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(15000, 0.2, 2000, 3), StdSize, UnitPref.Imperial, Localizer);

        Assert.Equal("15.0 kWh", view.Stats[0].ValueText);
        Assert.Equal("2.0 kW", view.Stats[1].ValueText);
    }

    [Theory]
    [InlineData(2.3, "2")]
    [InlineData(2.7, "3")]
    public void Project_free_charges_renders_as_integer(double freeCharges, string expected)
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(0, 0.2, 0, freeCharges), StdSize, UnitPref.Metric, Localizer);
        Assert.Equal(expected, view.Stats[2].ValueText);
    }

    [Fact]
    public void Project_every_stat_has_a_localized_label_and_measure_name()
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(1, 0.2, 1, 1), StdSize, UnitPref.Metric, Localizer);

        Assert.All(view.Stats, s =>
        {
            Assert.False(string.IsNullOrWhiteSpace(s.Label));
            Assert.False(string.IsNullOrWhiteSpace(s.AutomationName));
            Assert.Contains(s.Label, s.AutomationName, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Project_has_accessibility_name_containing_caption_and_unit()
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(0, 0.23, 0, 0), StdSize, UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains("23%", view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains("recovery", view.GaugeAutomationName, StringComparison.Ordinal);
    }

    // ---- Size / footprint flags (web isCompact / gauge diameter) -------------------

    [Theory]
    [InlineData(1, 2, true, 70)]    // default -> compact (cols <= 1) -> 70px, no stats
    [InlineData(1, 1, true, 70)]
    [InlineData(2, 2, false, 100)]  // wide -> 100px, stats
    [InlineData(3, 40, false, 100)] // max
    public void Size_flags_match_web(int cols, int rows, bool compact, double diameter)
    {
        var size = new RegenEfficiencySize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(diameter, size.GaugeDiameter);
    }

    [Fact]
    public void Project_compact_hides_stats_and_shrinks_gauge()
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(15000, 0.2, 2000, 3), new RegenEfficiencySize(1, 2), UnitPref.Metric, Localizer);

        Assert.True(view.IsCompact);
        Assert.False(view.ShowStats);
        Assert.Equal(70, view.GaugeDiameter);
        Assert.Equal(3, view.Stats.Count); // still projected, just not shown
    }

    [Fact]
    public void Project_wide_shows_stats_at_full_diameter()
    {
        var view = RegenEfficiencyProjection.Project(
            new RegenEfficiencyData(15000, 0.2, 2000, 3), new RegenEfficiencySize(2, 2), UnitPref.Metric, Localizer);

        Assert.False(view.IsCompact);
        Assert.True(view.ShowStats);
        Assert.Equal(100, view.GaugeDiameter);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"regen_ratio":0.2,"total_regen_wh":1000}""");

        var cached = RegenEfficiencyResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(0.2, cached.Value!.RegenRatio);

        var offline = RegenEfficiencyResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(1000, offline.Value!.TotalRegenWh);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"regen_ratio":0.1}""");

        Assert.Equal(LoadStatus.Loaded, RegenEfficiencyResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, RegenEfficiencyResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, RegenEfficiencyResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_loaded_body_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");

        var mapped = RegenEfficiencyResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<RegenEfficiencyData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauge_display()
    {
        using var vm = NewViewModel(Loaded(new RegenEfficiencyData(15000, 0.35, 2000, 3)));
        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("35%", vm.Display!.GaugeCaption);
        Assert.Equal(StatusKind.Success, vm.Display.Status);
        Assert.True(vm.Display.ShowStats);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<RegenEfficiencyData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No regen data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<RegenEfficiencyData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<RegenEfficiencyData>.Cached(new RegenEfficiencyData(8000, 0.2, 1500, 1), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(StatusKind.Warning, vm.Display!.Status); // 20% -> amber
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<RegenEfficiencyData>.OfflineCached(
            new RegenEfficiencyData(5000, 0.1, 800, 0), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.Equal(StatusKind.Danger, vm.Display!.Status); // 10% -> red
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<RegenEfficiencyData>.Loading(),
            RepositoryResult<RegenEfficiencyData>.Cached(new RegenEfficiencyData(1000, 0.2, 100, 0), Now, stale: false),
            RepositoryResult<RegenEfficiencyData>.Loaded(new RegenEfficiencyData(2000, 0.34, 200, 1), Now));
        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Loaded, vm.State);
        Assert.Equal("34%", vm.Display!.GaugeCaption);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new RegenEfficiencySize(2, 2), Loaded(new RegenEfficiencyData(15000, 0.2, 2000, 3)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display.ShowStats);

        vm.Size = new RegenEfficiencySize(1, 2);
        Assert.True(vm.Display!.IsCompact);
        Assert.False(vm.Display.ShowStats);
        Assert.Equal(70, vm.Display.GaugeDiameter);
        Assert.Equal(RegenEfficiencyState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_stats()
    {
        using var vm = new RegenEfficiencyViewModel(
            new FakeRegenEfficiencySource(Loaded(new RegenEfficiencyData(15000, 0.2, 2000, 3))),
            Localizer, StdSize, UnitPref.Metric);
        await vm.LoadAsync();
        Assert.Equal("15,000.0 Wh", vm.Display!.Stats[0].ValueText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("15.0 kWh", vm.Display!.Stats[0].ValueText);
        Assert.Equal("2.0 kW", vm.Display.Stats[1].ValueText);
        Assert.Equal(RegenEfficiencyState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_help_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<RegenEfficiencyData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Regen Braking", vm.Title);
        Assert.Equal("No regen data", vm.EmptyMessage);
        Assert.False(string.IsNullOrWhiteSpace(vm.HelpText));
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new RegenEfficiencyData(2000, 0.2, 200, 1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(RegenEfficiencyViewModel.State), changed);
        Assert.Contains(nameof(RegenEfficiencyViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("regen-efficiency", RegenEfficiencyRegistration.Id);
        Assert.Equal("driving", RegenEfficiencyRegistration.Category);
        Assert.Equal("RegenEfficiencyWidget", RegenEfficiencyRegistration.Slug);
        Assert.Equal(new RegenEfficiencySize(1, 2), RegenEfficiencyRegistration.DefaultSize);
        Assert.Equal(new RegenEfficiencySize(1, 2), RegenEfficiencyRegistration.MinSize);
        Assert.Equal(new RegenEfficiencySize(3, 40), RegenEfficiencyRegistration.MaxSize);
        Assert.Equal("Regen Braking", RegenEfficiencyRegistration.Name(Localizer));
        Assert.Contains("regen", RegenEfficiencyRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min == default
    [InlineData(3, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(4, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, RegenEfficiencyRegistration.IsWithinBounds(new RegenEfficiencySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new RegenEfficiencySize(1, 2), RegenEfficiencyRegistration.Clamp(new RegenEfficiencySize(0, 0)));
        Assert.Equal(new RegenEfficiencySize(3, 40), RegenEfficiencyRegistration.Clamp(new RegenEfficiencySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RegenEfficiencyDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RegenEfficiencyWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new RegenEfficiencySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_regen_by_query()
    {
        using var doc = JsonDocument.Parse(
            """{"total_regen_wh":15000,"regen_ratio":0.23,"monthly_avg_regen":2000,"free_charges":3}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RegenEfficiencySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(15000, terminal.Value!.TotalRegenWh);
        Assert.Equal(0.23, terminal.Value.RegenRatio);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_regen", request.OperationId);
        Assert.Equal(7L, request.Query!["vehicle_id"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"regen_ratio":0.2}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RegenEfficiencySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, request.Query!["vehicle_id"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_object_body_still_loads_zero_summary()
    {
        // Web parity: an object body (even {}) is truthy -> the gauge renders at 0%, NOT the empty surface.
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RegenEfficiencySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(0, results[^1].Value!.RegenRatio);
    }

    [Fact]
    public async Task Source_non_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RegenEfficiencySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<RegenEfficiencyData>>> Drain(IRegenEfficiencySource source)
    {
        var list = new List<RepositoryResult<RegenEfficiencyData>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<RegenEfficiencyData> Loaded(RegenEfficiencyData data) =>
        RepositoryResult<RegenEfficiencyData>.Loaded(data, Now);

    private static RegenEfficiencyViewModel NewViewModel(params RepositoryResult<RegenEfficiencyData>[] emissions) =>
        NewViewModel(StdSize, emissions);

    private static RegenEfficiencyViewModel NewViewModel(
        RegenEfficiencySize size,
        params RepositoryResult<RegenEfficiencyData>[] emissions) =>
        new(new FakeRegenEfficiencySource(emissions), Localizer, size, UnitPref.Metric);

    private sealed class FakeRegenEfficiencySource(params RepositoryResult<RegenEfficiencyData>[] emissions) : IRegenEfficiencySource
    {
        public async IAsyncEnumerable<RepositoryResult<RegenEfficiencyData>> StreamAsync(
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
