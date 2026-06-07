using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the BatteryHealthAnalyticsWidget's UI-thread-free logic — the JSON parse adapter
/// (the useBatteryHealthAnalytics normalisation), the score-colour threshold helper, the value formatting, the
/// projection of the gauge + six stat tiles across the compact / standard footprints, the cache-then-network
/// result mapper, the per-vehicle data source (primary resolution + query-scoped request), the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx).
/// </summary>
public sealed class BatteryHealthAnalyticsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (web useBatteryHealthAnalytics normalisation) ----------------

    [Fact]
    public void FromResponse_reads_all_consumed_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"current_soh":87.5,"total_cycles":412,"full_charge_pct":90,"avg_depth_of_discharge":55,
             "fast_charge_pct":30,"temp_exposure_score":78,"charge_habits_score":64,
             "estimated_capacity":71.2,"history":[]}
            """);

        var data = BatteryHealthAnalytics.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(87.5, data!.CurrentSoh);
        Assert.Equal(412, data.TotalCycles);
        Assert.Equal(90, data.FullChargePct);
        Assert.Equal(55, data.AvgDepthOfDischarge);
        Assert.Equal(30, data.FastChargePct);
        Assert.Equal(78, data.TempExposureScore);
        Assert.Equal(64, data.ChargeHabitsScore);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"current_soh":80}""");

        var data = BatteryHealthAnalytics.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(80, data!.CurrentSoh);
        Assert.Equal(0, data.TotalCycles);
        Assert.Equal(0, data.ChargeHabitsScore);
    }

    [Fact]
    public void FromResponse_reads_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"current_soh":"82.4","total_cycles":"300"}""");

        var data = BatteryHealthAnalytics.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(82.4, data!.CurrentSoh);
        Assert.Equal(300, data.TotalCycles);
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(BatteryHealthAnalytics.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_present_object_is_data_even_when_all_zero()
    {
        // Web parity: hasData = !!data — a present analytics object (even all-zero) renders the gauge.
        using var doc = JsonDocument.Parse("""{"history":[]}""");

        var data = BatteryHealthAnalytics.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(0, data!.CurrentSoh);
    }

    // ---- Score colour thresholds (web scoreColor) -----------------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(80, StatusKind.Success)]   // web: >= 80
    [InlineData(79, StatusKind.Warning)]
    [InlineData(50, StatusKind.Warning)]   // web: >= 50
    [InlineData(49, StatusKind.Danger)]
    [InlineData(0, StatusKind.Danger)]
    public void StatusFor_classifies_by_threshold(double score, StatusKind expected) =>
        Assert.Equal(expected, BatteryHealthAnalyticsProjection.StatusFor(score));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(80, BatteryHealthAnalyticsProjection.HealthyThresholdScore);
        Assert.Equal(50, BatteryHealthAnalyticsProjection.WarningThresholdScore);
        Assert.Equal(100, BatteryHealthAnalyticsProjection.MaxScore);
    }

    // ---- Value formatting (web RadialGauge fmtNumber) -------------------------------

    [Theory]
    [InlineData(87, "87")]        // integer -> 0 decimals
    [InlineData(100, "100")]
    [InlineData(0, "0")]
    [InlineData(87.5, "87.50")]   // non-integer -> 2 decimals (global precision)
    public void FormatScore_matches_web(double value, string expected) =>
        Assert.Equal(expected, BatteryHealthAnalyticsProjection.FormatScore(value));

    [Theory]
    [InlineData(double.NaN, "0")]
    [InlineData(double.PositiveInfinity, "0")]
    public void FormatScore_coerces_non_finite_to_zero(double value, string expected) =>
        Assert.Equal(expected, BatteryHealthAnalyticsProjection.FormatScore(value));

    // ---- Size / footprint flags (web isCompact / gauge diameter) --------------------

    [Theory]
    [InlineData(1, 2, true, 70)]    // 1 col -> compact, 70px gauge
    [InlineData(1, 4, true, 70)]
    [InlineData(2, 4, false, 100)]  // default -> 100px gauge
    [InlineData(4, 40, false, 100)]
    public void Size_flags_match_web(int cols, int rows, bool compact, double diameter)
    {
        var size = new BatteryHealthAnalyticsSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(diameter, size.GaugeDiameter);
    }

    // ---- Projection -----------------------------------------------------------------

    [Fact]
    public void Project_standard_builds_gauge_and_six_stats()
    {
        var view = BatteryHealthAnalyticsProjection.Project(Sample(), BatteryHealthAnalyticsSize.Default, Localizer);

        Assert.Equal(87, view.GaugeValue);
        Assert.Equal(100, view.GaugeMax);
        Assert.Equal("87", view.GaugeValueText);
        Assert.Equal("health", view.GaugeUnit);
        Assert.Equal("87", view.GaugeCaption);
        Assert.Equal(StatusKind.Success, view.Status);
        Assert.False(view.IsCompact);
        Assert.Equal(100, view.GaugeDiameter);
        Assert.Equal(6, view.Stats.Count);
    }

    [Fact]
    public void Project_stats_match_web_order_labels_values_and_units()
    {
        var view = BatteryHealthAnalyticsProjection.Project(Sample(), BatteryHealthAnalyticsSize.Default, Localizer);

        AssertStat(view.Stats[0], "Cycles", "412", null);
        AssertStat(view.Stats[1], "Charge Depth", "90", "%");
        AssertStat(view.Stats[2], "Discharge", "55", "%");
        AssertStat(view.Stats[3], "DC Fast", "30", "%");
        AssertStat(view.Stats[4], "Temp Score", "78", "/ 100");
        AssertStat(view.Stats[5], "Habits", "64", "/ 100");
    }

    [Theory]
    [InlineData(95, StatusKind.Success)]
    [InlineData(60, StatusKind.Warning)]
    [InlineData(20, StatusKind.Danger)]
    public void Project_colours_gauge_by_score(double score, StatusKind expected)
    {
        var view = BatteryHealthAnalyticsProjection.Project(Sample(score), BatteryHealthAnalyticsSize.Default, Localizer);
        Assert.Equal(expected, view.Status);
    }

    [Fact]
    public void Project_clamps_gauge_value_into_zero_hundred()
    {
        var over = BatteryHealthAnalyticsProjection.Project(Sample(150), BatteryHealthAnalyticsSize.Default, Localizer);
        Assert.Equal(100, over.GaugeValue);
        Assert.Equal("100", over.GaugeValueText);

        var under = BatteryHealthAnalyticsProjection.Project(Sample(-10), BatteryHealthAnalyticsSize.Default, Localizer);
        Assert.Equal(0, under.GaugeValue);
        Assert.Equal("0", under.GaugeValueText);
    }

    [Fact]
    public void Project_compact_keeps_gauge_and_stats_but_flags_compact()
    {
        var view = BatteryHealthAnalyticsProjection.Project(Sample(), new BatteryHealthAnalyticsSize(1, 2), Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(70, view.GaugeDiameter);
        Assert.Equal(6, view.Stats.Count); // the view hides them when compact; the projection still computes them
    }

    [Fact]
    public void Project_fractional_score_uses_two_decimals()
    {
        var view = BatteryHealthAnalyticsProjection.Project(Sample(87.5), BatteryHealthAnalyticsSize.Default, Localizer);
        Assert.Equal("87.50", view.GaugeValueText);
    }

    // ---- Accessibility names --------------------------------------------------------

    [Fact]
    public void Project_gauge_has_non_empty_accessibility_name_containing_value()
    {
        var view = BatteryHealthAnalyticsProjection.Project(Sample(64), BatteryHealthAnalyticsSize.Default, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains(view.GaugeValueText, view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.GaugeUnit, view.GaugeAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_every_stat_has_accessibility_name_with_label_and_value()
    {
        var view = BatteryHealthAnalyticsProjection.Project(Sample(), BatteryHealthAnalyticsSize.Default, Localizer);

        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"current_soh":62,"total_cycles":210}""");

        var cached = BatteryHealthAnalyticsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(62, cached.Value!.CurrentSoh);
        Assert.Equal(210, cached.Value.TotalCycles);

        var offline = BatteryHealthAnalyticsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(62, offline.Value!.CurrentSoh);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"current_soh":40}""");

        Assert.Equal(LoadStatus.Loaded, BatteryHealthAnalyticsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, BatteryHealthAnalyticsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, BatteryHealthAnalyticsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ----------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryHealthAnalytics>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BatteryHealthAnalyticsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauge_and_stats()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(BatteryHealthAnalyticsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("87", vm.Display!.GaugeValueText);
        Assert.Equal(StatusKind.Success, vm.Display.Status);
        Assert.Equal(6, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryHealthAnalytics>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryHealthAnalyticsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No battery health data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryHealthAnalytics>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BatteryHealthAnalyticsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryHealthAnalytics>.Cached(Sample(55), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BatteryHealthAnalyticsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(StatusKind.Warning, vm.Display!.Status); // 55 -> amber
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryHealthAnalytics>.OfflineCached(
            Sample(30), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BatteryHealthAnalyticsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.Equal(StatusKind.Danger, vm.Display!.Status); // 30 -> red
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryHealthAnalytics>.Loading(),
            RepositoryResult<BatteryHealthAnalytics>.Cached(Sample(60), Now, stale: false),
            RepositoryResult<BatteryHealthAnalytics>.Loaded(Sample(72), Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryHealthAnalyticsState.Loaded, vm.State);
        Assert.Equal("72", vm.Display!.GaugeValueText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(BatteryHealthAnalyticsSize.Default, Loaded(Sample()));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);
        Assert.Equal(100, vm.Display.GaugeDiameter);

        vm.Size = new BatteryHealthAnalyticsSize(1, 2);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(70, vm.Display.GaugeDiameter);
        Assert.Equal(BatteryHealthAnalyticsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryHealthAnalytics>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Battery Analytics", vm.Title);
        Assert.Equal("No battery health data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryHealthAnalyticsViewModel.State), changed);
        Assert.Contains(nameof(BatteryHealthAnalyticsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) --------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("battery-health-analytics", BatteryHealthAnalyticsRegistration.Id);
        Assert.Equal("battery", BatteryHealthAnalyticsRegistration.Category);
        Assert.Equal("BatteryHealthAnalyticsWidget", BatteryHealthAnalyticsRegistration.Slug);
        Assert.Equal(new BatteryHealthAnalyticsSize(2, 4), BatteryHealthAnalyticsRegistration.DefaultSize);
        Assert.Equal(new BatteryHealthAnalyticsSize(1, 2), BatteryHealthAnalyticsRegistration.MinSize);
        Assert.Equal(new BatteryHealthAnalyticsSize(4, 40), BatteryHealthAnalyticsRegistration.MaxSize);
        Assert.Equal("Battery Analytics", BatteryHealthAnalyticsRegistration.Name(Localizer));
        Assert.Contains("cycles", BatteryHealthAnalyticsRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(2, 4, true)]    // default
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, BatteryHealthAnalyticsRegistration.IsWithinBounds(new BatteryHealthAnalyticsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new BatteryHealthAnalyticsSize(1, 2), BatteryHealthAnalyticsRegistration.Clamp(new BatteryHealthAnalyticsSize(0, 0)));
        Assert.Equal(new BatteryHealthAnalyticsSize(4, 40), BatteryHealthAnalyticsRegistration.Clamp(new BatteryHealthAnalyticsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ----------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryHealthAnalyticsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryHealthAnalyticsWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) -----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new BatteryHealthAnalyticsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_query()
    {
        using var doc = JsonDocument.Parse("""{"current_soh":87,"total_cycles":412}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryHealthAnalyticsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(87, terminal.Value!.CurrentSoh);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_battery_health", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"current_soh":90}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryHealthAnalyticsSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryHealthAnalyticsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers ------------------------------------------------------------

    private static BatteryHealthAnalytics Sample(double soh = 87) => new(soh, 412, 90, 55, 30, 78, 64);

    private static void AssertStat(BatteryHealthHeroStat stat, string label, string value, string? unit)
    {
        Assert.Equal(label, stat.Label);
        Assert.Equal(value, stat.Value);
        Assert.Equal(unit, stat.Unit);
    }

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<BatteryHealthAnalytics>>> Drain(IBatteryHealthAnalyticsSource source)
    {
        var list = new List<RepositoryResult<BatteryHealthAnalytics>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<BatteryHealthAnalytics> Loaded(BatteryHealthAnalytics data) =>
        RepositoryResult<BatteryHealthAnalytics>.Loaded(data, Now);

    private static BatteryHealthAnalyticsViewModel NewViewModel(params RepositoryResult<BatteryHealthAnalytics>[] emissions) =>
        NewViewModel(BatteryHealthAnalyticsSize.Default, emissions);

    private static BatteryHealthAnalyticsViewModel NewViewModel(
        BatteryHealthAnalyticsSize size,
        params RepositoryResult<BatteryHealthAnalytics>[] emissions) =>
        new(new FakeBatteryHealthAnalyticsSource(emissions), Localizer, size);

    private sealed class FakeBatteryHealthAnalyticsSource(params RepositoryResult<BatteryHealthAnalytics>[] emissions)
        : IBatteryHealthAnalyticsSource
    {
        public async IAsyncEnumerable<RepositoryResult<BatteryHealthAnalytics>> StreamAsync(
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
