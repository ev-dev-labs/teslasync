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
/// Headless verification of the SpeedProfileWidget's UI-thread-free logic — the JSON parse adapter (the
/// useSpeedProfile normalisation of the snake_case <c>/analytics/speed-profile</c> body, including the
/// legacy <c>avg_power_kw</c> efficiency-overlay key the SI backend no longer emits), the
/// <c>buildChartData</c> / <c>formatBucketLabel</c> / <c>findSweetSpot</c> / <c>peakFreq</c> projection
/// with its speed-unit conversion across the compact / standard footprints and metric / imperial units, the
/// cache-then-network result mapper, the per-vehicle data source (primary resolution + query-scoped
/// request), the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline) including the web <c>hasData</c> gate.
/// Mirrors the web spec (web/src/features/dashboard/widgets/SpeedProfileWidget.tsx +
/// registry/driving.ts).
/// </summary>
public sealed class SpeedProfileWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private static readonly SpeedProfileSize StdSize = new(2, 4);
    private const string EmDash = "\u2014";

    // Three buckets totalling 100 readings → frequencies 10 / 30 / 60 %, peak at "30-45"; optimal 20 m/s.
    private static SpeedProfileData SampleData() => new(
        new[]
        {
            new SpeedProfileBucket("0-15", 10, null),
            new SpeedProfileBucket("15-30", 30, null),
            new SpeedProfileBucket("30-45", 60, null),
        },
        20);

    // ---- Parse adapter (web useSpeedProfile normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_distribution_and_optimal_speed()
    {
        using var doc = JsonDocument.Parse(
            """
            {"distribution":[{"speed_bucket":"15-30","readings":42,"avg_power_kw":12.5}],
             "categories":[],"points":[],"avg_speed_mps":18.0,"peak_speed_mps":33.0,"optimal_speed_mps":18.3}
            """);

        var data = SpeedProfileData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        var bucket = Assert.Single(data!.Distribution);
        Assert.Equal("15-30", bucket.SpeedBucket);
        Assert.Equal(42, bucket.Readings);
        Assert.Equal(12.5, bucket.AvgPowerKw);
        Assert.Equal(18.3, data.OptimalSpeedMps);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"distribution":[{"speed_bucket":"0-15"}]}""");

        var data = SpeedProfileData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        var bucket = Assert.Single(data!.Distribution);
        Assert.Equal("0-15", bucket.SpeedBucket);
        Assert.Equal(0, bucket.Readings);
        Assert.Null(bucket.AvgPowerKw);
        Assert.Equal(0, data.OptimalSpeedMps);
    }

    [Fact]
    public void FromResponse_reads_empty_object_as_usable_empty_snapshot()
    {
        // Web parity: with a vehicle the response is an object; an empty distribution is valid and the
        // projection's hasData gate (not the parse) decides the empty surface.
        using var doc = JsonDocument.Parse("{}");

        var data = SpeedProfileData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Empty(data!.Distribution);
        Assert.Equal(0, data.OptimalSpeedMps);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("42")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(SpeedProfileData.FromResponse(doc.RootElement));
    }

    [Fact]
    public void Bucket_reads_legacy_kilowatt_key_and_camel_fallback()
    {
        using var snake = JsonDocument.Parse("""{"speed_bucket":"x","readings":5,"avg_power_kw":9.0}""");
        using var camel = JsonDocument.Parse("""{"speedBucket":"y","readings":6,"avgPowerKw":11.0}""");

        Assert.Equal(9.0, SpeedProfileBucket.FromJson(snake.RootElement).AvgPowerKw);

        var camelBucket = SpeedProfileBucket.FromJson(camel.RootElement);
        Assert.Equal("y", camelBucket.SpeedBucket);
        Assert.Equal(11.0, camelBucket.AvgPowerKw);
    }

    [Fact]
    public void Bucket_does_not_read_si_avg_power_w_for_the_overlay()
    {
        // Honesty/parity: the web reads `avg_power_kw`, never the SI backend's `avg_power_w`
        // (internal/api/speedprofile/handler.go) — so the efficiency overlay degrades to 0, verbatim with
        // the web's documented graceful-degradation path.
        using var doc = JsonDocument.Parse("""{"speed_bucket":"15-30","readings":7,"avg_power_w":5400.0}""");

        var bucket = SpeedProfileBucket.FromJson(doc.RootElement);

        Assert.Null(bucket.AvgPowerKw);
    }

    // ---- Projection: chart data + bucket-label conversion (web parity) --------------

    [Fact]
    public void BuildChartData_derives_frequency_percentages_and_zero_overlay()
    {
        var points = SpeedProfileProjection.BuildChartData(SampleData(), SpeedUnit.Kmh);

        Assert.Equal(3, points.Count);
        Assert.Equal("0-54", points[0].Bucket);
        Assert.Equal(10.0, points[0].Frequency, 6);
        Assert.Equal(30.0, points[1].Frequency, 6);
        Assert.Equal(60.0, points[2].Frequency, 6);

        // Overlay is the absent legacy avg_power_kw → 0 for every bucket (web parity).
        Assert.All(points, p => Assert.Equal(0, p.Efficiency));
    }

    [Fact]
    public void BuildChartData_zero_total_readings_yields_zero_frequency()
    {
        var data = new SpeedProfileData(new[] { new SpeedProfileBucket("0-15", 0, null) }, 0);

        var points = SpeedProfileProjection.BuildChartData(data, SpeedUnit.Kmh);

        Assert.Equal(0, Assert.Single(points).Frequency);
    }

    [Theory]
    [InlineData("15-30", "34-67")]   // 15 mph→34, 30 mph→67 (SpeedFromSi treats the boundary as m/s, web parity)
    [InlineData("0-15", "0-34")]
    [InlineData("75+", "168+")]      // open bucket: 75→168
    public void FormatBucketLabel_converts_to_mph(string raw, string expected) =>
        Assert.Equal(expected, SpeedProfileProjection.FormatBucketLabel(raw, SpeedUnit.Mph));

    [Theory]
    [InlineData("15-30", "54-108")]  // 15→54, 30→108 km/h
    [InlineData("0-15", "0-54")]
    [InlineData("75+", "270+")]
    public void FormatBucketLabel_converts_to_kmh(string raw, string expected) =>
        Assert.Equal(expected, SpeedProfileProjection.FormatBucketLabel(raw, SpeedUnit.Kmh));

    [Theory]
    [InlineData("not-a-range")]
    [InlineData("")]
    public void FormatBucketLabel_passes_through_non_numeric(string raw) =>
        Assert.Equal(raw, SpeedProfileProjection.FormatBucketLabel(raw, SpeedUnit.Kmh));

    // ---- Projection: stats (web ChartSummaryStat) ----------------------------------

    [Fact]
    public void Project_standard_builds_three_stats_in_metric()
    {
        var view = SpeedProfileProjection.Project(SampleData(), StdSize, UnitPref.Metric, Localizer);

        Assert.False(view.IsEmpty);
        Assert.False(view.IsCompact);
        Assert.Equal(3, view.Stats.Count);

        Assert.Equal("Most Common", view.Stats[0].Label);
        Assert.Equal("108-162", view.Stats[0].Value); // peak bucket "30-45" → km/h
        Assert.Equal("km/h", view.Stats[0].Unit);

        Assert.Equal("Peak Freq", view.Stats[1].Label);
        Assert.Equal("60.0%", view.Stats[1].Value);
        Assert.Null(view.Stats[1].Unit);

        Assert.Equal("Sweet Spot", view.Stats[2].Label);
        Assert.Equal("72", view.Stats[2].Value); // optimal 20 m/s → 72 km/h
        Assert.Equal("km/h", view.Stats[2].Unit);
    }

    [Fact]
    public void Project_standard_converts_stats_to_imperial()
    {
        var view = SpeedProfileProjection.Project(SampleData(), StdSize, UnitPref.Imperial, Localizer);

        Assert.Equal("67-101", view.Stats[0].Value); // peak bucket "30-45" → mph
        Assert.Equal("mph", view.Stats[0].Unit);
        Assert.Equal("45", view.Stats[2].Value);      // optimal 20 m/s → 45 mph
        Assert.Equal("mph", view.Stats[2].Unit);
    }

    [Fact]
    public void Project_compact_drops_peak_freq_stat()
    {
        var view = SpeedProfileProjection.Project(SampleData(), new SpeedProfileSize(1, 4), UnitPref.Metric, Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(2, view.Stats.Count);
        Assert.Equal("Most Common", view.Stats[0].Label);
        Assert.Equal("Sweet Spot", view.Stats[1].Label);
    }

    [Fact]
    public void Project_sweet_spot_falls_back_to_lowest_efficiency_bucket()
    {
        // No optimal speed; the sweet spot is the bucket with the lowest positive overlay value.
        var data = new SpeedProfileData(
            new[]
            {
                new SpeedProfileBucket("0-15", 10, 50.0),
                new SpeedProfileBucket("15-30", 30, 20.0),  // lowest
                new SpeedProfileBucket("30-45", 60, 80.0),
            },
            0);

        var view = SpeedProfileProjection.Project(data, StdSize, UnitPref.Metric, Localizer);

        Assert.Equal("54-108", view.Stats[2].Value); // bucket "15-30" → km/h
    }

    [Fact]
    public void Project_sweet_spot_is_em_dash_without_optimal_or_overlay()
    {
        var data = new SpeedProfileData(new[] { new SpeedProfileBucket("0-15", 10, null) }, 0);

        var view = SpeedProfileProjection.Project(data, StdSize, UnitPref.Metric, Localizer);

        Assert.Equal(EmDash, view.Stats[2].Value);
    }

    [Fact]
    public void Project_peak_bucket_picks_the_most_frequent_range()
    {
        var view = SpeedProfileProjection.Project(SampleData(), StdSize, UnitPref.Metric, Localizer);

        // "30-45" has the most readings (60 of 100) → 60.0% peak frequency.
        Assert.Equal("60.0%", view.Stats[1].Value);
        Assert.Equal("108-162", view.Stats[0].Value);
    }

    // ---- Projection: empty gate (web hasData) --------------------------------------

    [Fact]
    public void Project_empty_distribution_is_empty()
    {
        var view = SpeedProfileProjection.Project(SpeedProfileData.Empty, StdSize, UnitPref.Metric, Localizer);

        Assert.True(view.IsEmpty);
        Assert.Empty(view.Points);
    }

    [Fact]
    public void Project_all_zero_readings_is_empty()
    {
        var data = new SpeedProfileData(
            new[]
            {
                new SpeedProfileBucket("0-15", 0, null),
                new SpeedProfileBucket("15-30", 0, null),
            },
            0);

        Assert.True(SpeedProfileProjection.Project(data, StdSize, UnitPref.Metric, Localizer).IsEmpty);
    }

    // ---- Projection: accessibility -------------------------------------------------

    [Fact]
    public void Project_every_stat_has_a_localized_label_and_measure_name()
    {
        var view = SpeedProfileProjection.Project(SampleData(), StdSize, UnitPref.Metric, Localizer);

        Assert.All(view.Stats, s =>
        {
            Assert.False(string.IsNullOrWhiteSpace(s.Label));
            Assert.False(string.IsNullOrWhiteSpace(s.AutomationName));
            Assert.Contains(s.Label, s.AutomationName, StringComparison.Ordinal);
        });
        Assert.False(string.IsNullOrWhiteSpace(view.CompactAutomationName));
    }

    [Fact]
    public void Project_series_names_resolve_through_i18n()
    {
        var view = SpeedProfileProjection.Project(SampleData(), StdSize, UnitPref.Metric, Localizer);

        Assert.Equal("Frequency", view.FrequencySeriesName);
        Assert.Equal("Wh/mi", view.EfficiencySeriesName);
    }

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(1, 2, true, false)]
    [InlineData(2, 4, false, false)]
    [InlineData(3, 4, false, true)]
    [InlineData(4, 40, false, true)]
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new SpeedProfileSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"distribution":[{"speed_bucket":"15-30","readings":12}],"optimal_speed_mps":18}""");

        var cached = SpeedProfileResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(18, cached.Value!.OptimalSpeedMps);

        var offline = SpeedProfileResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Distribution);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"distribution":[],"optimal_speed_mps":0}""");

        Assert.Equal(LoadStatus.Loaded, SpeedProfileResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, SpeedProfileResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SpeedProfileResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_loaded_body_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");

        var mapped = SpeedProfileResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedProfileData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_histogram_display()
    {
        using var vm = NewViewModel(Loaded(SampleData()));
        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.False(vm.Display.IsEmpty);
        Assert.Equal(3, vm.Display.Stats.Count);
        Assert.Equal(3, vm.Display.Points.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedProfileData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Display.IsEmpty);
        Assert.Equal("No speed data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_with_empty_distribution_renders_empty()
    {
        // Web parity: a successful object body with no readings still renders the empty surface (hasData gate).
        using var vm = NewViewModel(Loaded(SpeedProfileData.Empty));
        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Empty, vm.State);
        Assert.True(vm.Display.IsEmpty);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SpeedProfileData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<SpeedProfileData>.Cached(SampleData(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(vm.Display.IsEmpty);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedProfileData>.OfflineCached(
            SampleData(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SpeedProfileData>.Loading(),
            RepositoryResult<SpeedProfileData>.Cached(SampleData(), Now, stale: false),
            RepositoryResult<SpeedProfileData>.Loaded(SampleData(), Now));
        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Loaded, vm.State);
        Assert.Equal(3, vm.Display.Stats.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new SpeedProfileSize(2, 4), Loaded(SampleData()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);
        Assert.Equal(3, vm.Display.Stats.Count);

        vm.Size = new SpeedProfileSize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(2, vm.Display.Stats.Count); // Peak Freq dropped
        Assert.Equal(SpeedProfileState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_stats()
    {
        using var vm = new SpeedProfileViewModel(
            new FakeSpeedProfileSource(Loaded(SampleData())), Localizer, StdSize, UnitPref.Metric);
        await vm.LoadAsync();
        Assert.Equal("108-162", vm.Display.Stats[0].Value); // metric km/h

        vm.Units = UnitPref.Imperial;
        Assert.Equal("67-101", vm.Display.Stats[0].Value);  // imperial mph
        Assert.Equal("mph", vm.Display.Stats[0].Unit);
        Assert.Equal(SpeedProfileState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedProfileData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Speed Profile", vm.Title);
        Assert.Equal("No speed data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(SampleData()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SpeedProfileViewModel.State), changed);
        Assert.Contains(nameof(SpeedProfileViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("speed-profile", SpeedProfileRegistration.Id);
        Assert.Equal("driving", SpeedProfileRegistration.Category);
        Assert.Equal("SpeedProfileWidget", SpeedProfileRegistration.Slug);
        Assert.Equal(new SpeedProfileSize(2, 4), SpeedProfileRegistration.DefaultSize);
        Assert.Equal(new SpeedProfileSize(2, 4), SpeedProfileRegistration.MinSize);
        Assert.Equal(new SpeedProfileSize(4, 40), SpeedProfileRegistration.MaxSize);
        Assert.Equal("Speed Profile", SpeedProfileRegistration.Name(Localizer));
        Assert.Contains("histogram", SpeedProfileRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]    // min == default
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(2, 3, false)]   // below min rows
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SpeedProfileRegistration.IsWithinBounds(new SpeedProfileSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SpeedProfileSize(2, 4), SpeedProfileRegistration.Clamp(new SpeedProfileSize(0, 0)));
        Assert.Equal(new SpeedProfileSize(4, 40), SpeedProfileRegistration.Clamp(new SpeedProfileSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SpeedProfileDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SpeedProfileWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SpeedProfileSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_speed_profile_by_query()
    {
        using var doc = JsonDocument.Parse(
            """{"distribution":[{"speed_bucket":"15-30","readings":42}],"optimal_speed_mps":18.3}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SpeedProfileSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Single(terminal.Value!.Distribution);
        Assert.Equal(18.3, terminal.Value.OptimalSpeedMps);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_speed_profile", request.OperationId);
        Assert.Equal(7L, request.Query!["vehicle_id"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"distribution":[],"optimal_speed_mps":0}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SpeedProfileSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, request.Query!["vehicle_id"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_non_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SpeedProfileSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<SpeedProfileData>>> Drain(ISpeedProfileSource source)
    {
        var list = new List<RepositoryResult<SpeedProfileData>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<SpeedProfileData> Loaded(SpeedProfileData data) =>
        RepositoryResult<SpeedProfileData>.Loaded(data, Now);

    private static SpeedProfileViewModel NewViewModel(params RepositoryResult<SpeedProfileData>[] emissions) =>
        NewViewModel(StdSize, emissions);

    private static SpeedProfileViewModel NewViewModel(
        SpeedProfileSize size,
        params RepositoryResult<SpeedProfileData>[] emissions) =>
        new(new FakeSpeedProfileSource(emissions), Localizer, size, UnitPref.Metric);

    private sealed class FakeSpeedProfileSource(params RepositoryResult<SpeedProfileData>[] emissions) : ISpeedProfileSource
    {
        public async IAsyncEnumerable<RepositoryResult<SpeedProfileData>> StreamAsync(
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
