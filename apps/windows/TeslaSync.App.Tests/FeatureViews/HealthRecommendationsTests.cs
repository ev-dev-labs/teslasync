using System.Globalization;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Health Recommendations surface's UI-thread-free logic — the drivetrain-health
/// JSON parse adapter (<c>overall_health</c> → level), the tip-derivation projection (the critical/warning/low
/// branch set reproduced verbatim from the web <c>useMemo</c>), the cache-then-network result mapper, the
/// repository source's vehicle-scoped request shape, the state-holder view-model's per-state matrix (loading /
/// loaded / empty / error / stale / offline), the registry metadata, the PII-safe diagnostics and the
/// generated-operation contract guard. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx).
/// </summary>
public sealed class HealthRecommendationsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string GoodJson = """{"overall_health":"good","motor_status":"Idle","front_motor_temp_c":20}""";
    private const string WarningJson = """{"overall_health":"warning","motor_status":"Warm"}""";
    private const string CriticalJson = """{"overall_health":"critical","motor_status":"Overheating"}""";

    // ---- Parse adapter -------------------------------------------------------------

    [Theory]
    [InlineData(GoodJson, DrivetrainHealth.Good)]
    [InlineData(WarningJson, DrivetrainHealth.Warning)]
    [InlineData(CriticalJson, DrivetrainHealth.Critical)]
    public void FromJson_reads_the_overall_health_level(string json, DrivetrainHealth expected)
    {
        using var doc = JsonDocument.Parse(json);
        var snapshot = DrivetrainHealthSnapshot.FromJson(doc.RootElement);

        Assert.Equal(expected, snapshot.OverallHealth);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_missing_field_stays_empty()
    {
        using var doc = JsonDocument.Parse("""{"motor_status":"Normal"}""");
        var snapshot = DrivetrainHealthSnapshot.FromJson(doc.RootElement);

        Assert.Null(snapshot.OverallHealth);
        Assert.False(snapshot.HasData);
    }

    [Fact]
    public void FromJson_unknown_level_is_treated_as_empty()
    {
        using var doc = JsonDocument.Parse("""{"overall_health":"meltdown"}""");
        Assert.False(DrivetrainHealthSnapshot.FromJson(doc.RootElement).HasData);
    }

    [Fact]
    public void FromJson_is_tolerant_of_non_object_and_non_string_field()
    {
        using var array = JsonDocument.Parse("[]");
        Assert.False(DrivetrainHealthSnapshot.FromJson(array.RootElement).HasData);

        using var numberField = JsonDocument.Parse("""{"overall_health":3}""");
        Assert.False(DrivetrainHealthSnapshot.FromJson(numberField.RootElement).HasData);

        using var empty = JsonDocument.Parse("{}");
        Assert.False(DrivetrainHealthSnapshot.FromJson(empty.RootElement).HasData);
    }

    // ---- Projection (tip derivation) -----------------------------------------------

    [Fact]
    public void Project_empty_snapshot_yields_empty_display()
    {
        var display = HealthRecommendationsProjection.Project(DrivetrainHealthSnapshot.Empty, Localizer);

        Assert.False(display.HasData);
        Assert.Empty(display.Recommendations);
    }

    [Fact]
    public void Project_good_yields_only_the_four_low_tips()
    {
        var display = HealthRecommendationsProjection.Project(new DrivetrainHealthSnapshot(DrivetrainHealth.Good), Localizer);

        Assert.True(display.HasData);
        Assert.Equal(DrivetrainHealth.Good, display.OverallHealth);
        Assert.Equal(
            new[] { "regular-service", "gentle-accel", "precondition", "monitor-temps" },
            display.Recommendations.Select(r => r.Key).ToArray());
        Assert.All(display.Recommendations, r => Assert.Equal(RecommendationPriority.Low, r.Priority));
    }

    [Fact]
    public void Project_warning_adds_the_three_medium_tips_before_the_low_tips()
    {
        var display = HealthRecommendationsProjection.Project(new DrivetrainHealthSnapshot(DrivetrainHealth.Warning), Localizer);

        Assert.Equal(7, display.Recommendations.Count);
        Assert.Equal(
            new[] { "reduce-load", "check-coolant", "avoid-supercharging", "regular-service", "gentle-accel", "precondition", "monitor-temps" },
            display.Recommendations.Select(r => r.Key).ToArray());
        Assert.Equal(3, display.Recommendations.Count(r => r.Priority == RecommendationPriority.Medium));
        Assert.Equal(4, display.Recommendations.Count(r => r.Priority == RecommendationPriority.Low));
        Assert.DoesNotContain(display.Recommendations, r => r.Priority == RecommendationPriority.High);
    }

    [Fact]
    public void Project_critical_leads_with_two_high_tips_then_medium_then_low()
    {
        var display = HealthRecommendationsProjection.Project(new DrivetrainHealthSnapshot(DrivetrainHealth.Critical), Localizer);

        Assert.Equal(9, display.Recommendations.Count);
        Assert.Equal(
            new[]
            {
                "critical-stop", "service-urgent",
                "reduce-load", "check-coolant", "avoid-supercharging",
                "regular-service", "gentle-accel", "precondition", "monitor-temps",
            },
            display.Recommendations.Select(r => r.Key).ToArray());
        Assert.Equal(
            new[]
            {
                RecommendationPriority.High, RecommendationPriority.High,
                RecommendationPriority.Medium, RecommendationPriority.Medium, RecommendationPriority.Medium,
                RecommendationPriority.Low, RecommendationPriority.Low, RecommendationPriority.Low, RecommendationPriority.Low,
            },
            display.Recommendations.Select(r => r.Priority).ToArray());
    }

    [Fact]
    public void Project_resolves_web_tip_text_through_the_facade()
    {
        var display = HealthRecommendationsProjection.Project(new DrivetrainHealthSnapshot(DrivetrainHealth.Critical), Localizer);

        var criticalStop = display.Recommendations.Single(r => r.Key == "critical-stop");
        Assert.Equal(
            "Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down.",
            criticalStop.Text);

        var monitor = display.Recommendations.Single(r => r.Key == "monitor-temps");
        Assert.Equal(
            "Monitor drivetrain temperatures after spirited driving sessions or long highway stretches.",
            monitor.Text);
    }

    [Fact]
    public void Project_uses_the_keyed_tip_resources_with_web_fallbacks()
    {
        var recording = new RecordingLocalizer();

        _ = HealthRecommendationsProjection.Project(new DrivetrainHealthSnapshot(DrivetrainHealth.Critical), recording);

        foreach (var key in new[]
        {
            "drivetrain.tips.criticalStop", "drivetrain.tips.serviceUrgent",
            "drivetrain.tips.reduceLoad", "drivetrain.tips.checkCoolant", "drivetrain.tips.avoidSupercharging",
            "drivetrain.tips.regularService", "drivetrain.tips.gentleAccel", "drivetrain.tips.precondition",
            "drivetrain.tips.monitorTemps",
        })
        {
            Assert.Contains(key, recording.Keys);
        }
    }

    // ---- Projection (accessibility) ------------------------------------------------

    [Fact]
    public void Project_rows_have_priority_prefixed_accessibility_names()
    {
        var display = HealthRecommendationsProjection.Project(new DrivetrainHealthSnapshot(DrivetrainHealth.Critical), Localizer);

        foreach (var row in display.Recommendations)
        {
            Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
            Assert.Contains(row.Text, row.AutomationName, StringComparison.Ordinal);
            Assert.Contains(
                HealthRecommendationsProjection.PriorityLabel(row.Priority, Localizer),
                row.AutomationName,
                StringComparison.Ordinal);
        }
    }

    [Theory]
    [InlineData(RecommendationPriority.High, "High priority")]
    [InlineData(RecommendationPriority.Medium, "Medium priority")]
    [InlineData(RecommendationPriority.Low, "Recommendation")]
    public void PriorityLabel_resolves_each_priority(RecommendationPriority priority, string expected)
    {
        Assert.Equal(expected, HealthRecommendationsProjection.PriorityLabel(priority, Localizer));
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(WarningJson);

        var cached = HealthRecommendationsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(DrivetrainHealth.Warning, cached.Value!.OverallHealth);

        var offline = HealthRecommendationsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(DrivetrainHealth.Warning, offline.Value!.OverallHealth);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse(CriticalJson);

        Assert.Equal(LoadStatus.Loaded, HealthRecommendationsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, HealthRecommendationsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, HealthRecommendationsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, HealthRecommendationsResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DrivetrainHealthSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_recommendations()
    {
        using var vm = NewViewModel(Loaded(new DrivetrainHealthSnapshot(DrivetrainHealth.Critical)));
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(9, vm.Display.Recommendations.Count);
        Assert.Equal(DrivetrainHealth.Critical, vm.Display.OverallHealth);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_health_renders_empty()
    {
        using var vm = NewViewModel(Loaded(DrivetrainHealthSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No drivetrain health data available yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DrivetrainHealthSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivetrainHealthSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivetrainHealthSnapshot>.Cached(new DrivetrainHealthSnapshot(DrivetrainHealth.Warning), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(7, vm.Display.Recommendations.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<DrivetrainHealthSnapshot>.OfflineCached(
            new DrivetrainHealthSnapshot(DrivetrainHealth.Good), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_offline_without_health_falls_back_to_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DrivetrainHealthSnapshot>.OfflineCached(
            DrivetrainHealthSnapshot.Empty, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivetrainHealthSnapshot>.Loading(),
            RepositoryResult<DrivetrainHealthSnapshot>.Cached(new DrivetrainHealthSnapshot(DrivetrainHealth.Warning), Now, stale: false),
            RepositoryResult<DrivetrainHealthSnapshot>.Loaded(new DrivetrainHealthSnapshot(DrivetrainHealth.Critical), Now));
        await vm.LoadAsync();

        Assert.Equal(HealthRecommendationsState.Loaded, vm.State);
        Assert.Equal(DrivetrainHealth.Critical, vm.Display.OverallHealth);
        Assert.Equal(9, vm.Display.Recommendations.Count);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DrivetrainHealthSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Health Recommendations", vm.Title);
        Assert.Equal("No drivetrain health data available yet", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new DrivetrainHealthSnapshot(DrivetrainHealth.Warning)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(HealthRecommendationsViewModel.State), changed);
        Assert.Contains(nameof(HealthRecommendationsViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_snapshot_and_targets_the_drivetrain_operation_scoped_by_vehicle()
    {
        using var doc = JsonDocument.Parse(WarningJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new HealthRecommendationsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(DrivetrainHealth.Warning, emissions[^1].Value!.OverallHealth);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_drivetrain_health", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new HealthRecommendationsSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_empty_object_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new HealthRecommendationsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
        Assert.Equal(42L, Convert.ToInt64(Assert.Single(api.Requests).Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_offline_after_warm_cache_keeps_last_snapshot()
    {
        using var doc = JsonDocument.Parse(CriticalJson);
        var engine = NewEngine();
        var options = new ApiClientOptions();

        var ok = new HealthRecommendationsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            new FakeApiClient().ReturnsValue(doc.RootElement.Clone()), engine, options);
        _ = await Collect(ok.StreamAsync()); // warm the cache

        var down = new HealthRecommendationsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            new FakeApiClient().Throws(new HttpRequestException("offline")), engine, options);
        var emissions = await Collect(down.StreamAsync());

        Assert.Equal(LoadStatus.Offline, emissions[^1].Status);
        Assert.Equal(DrivetrainHealth.Critical, emissions[^1].Value!.OverallHealth);
    }

    // ---- Registration + diagnostics + contract guard --------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("health-recommendations", HealthRecommendationsRegistration.Id);
        Assert.Equal("driving", HealthRecommendationsRegistration.Category);
        Assert.Equal("HealthRecommendations", HealthRecommendationsRegistration.Slug);
        Assert.Equal("get_api_v1_drivetrain_health", HealthRecommendationsRegistration.DrivetrainHealthOperation);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new HealthRecommendationsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HealthRecommendations", Assert.Single(sink));
    }

    [Fact]
    public void DrivetrainHealthOperation_resolves_against_the_generated_endpoint_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(
            e => e.OperationId == HealthRecommendationsRegistration.DrivetrainHealthOperation);

        Assert.True(descriptor is not null, "GET /drivetrain/health must exist in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
        Assert.Equal(descriptor.Path.Count(c => c == '{'), descriptor.PathParams.Count);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<DrivetrainHealthSnapshot> Loaded(DrivetrainHealthSnapshot snapshot) =>
        RepositoryResult<DrivetrainHealthSnapshot>.Loaded(snapshot, Now);

    private static HealthRecommendationsViewModel NewViewModel(
        params RepositoryResult<DrivetrainHealthSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<IReadOnlyList<RepositoryResult<DrivetrainHealthSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<DrivetrainHealthSnapshot>> stream)
    {
        var list = new List<RepositoryResult<DrivetrainHealthSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<DrivetrainHealthSnapshot>[] emissions)
        : IHealthRecommendationsSource
    {
        public async IAsyncEnumerable<RepositoryResult<DrivetrainHealthSnapshot>> StreamAsync(
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

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
