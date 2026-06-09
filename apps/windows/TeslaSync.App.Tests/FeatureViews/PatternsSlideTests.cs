using System.Globalization;
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
/// Headless verification of the Patterns Slide surface's UI-thread-free logic — the year-review patterns
/// JSON parse adapter (the five pattern fields + the web <c>safe()</c> coercion + presence gate), the
/// SI→display projection (distance/efficiency unit conversion, the 12-hour peak-hour formatting, the favorite
/// day em-dash), the cache-then-network result mapper, the repository source's request shape, the
/// state-holder view-model's per-state matrix (loading / loaded / empty / error / stale / offline), the
/// registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/review/PatternsSlide.tsx).
/// </summary>
public sealed class PatternsSlideTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
    private const int Year = 2025;

    private const string YearReviewJson = """
    {
      "year": 2025,
      "total_drives": 412,
      "most_active_day_of_week": "Saturday",
      "most_active_hour": 17,
      "avg_drives_per_week": 4.2,
      "avg_distance_per_drive_km": 42.0,
      "avg_efficiency_wh_km": 165
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_the_five_pattern_fields()
    {
        using var doc = JsonDocument.Parse(YearReviewJson);
        var snapshot = YearReviewPatterns.FromJson(doc.RootElement);

        Assert.Equal("Saturday", snapshot.MostActiveDayOfWeek);
        Assert.Equal(17, snapshot.MostActiveHour);
        Assert.Equal(4.2, snapshot.AvgDrivesPerWeek);
        Assert.Equal(42.0, snapshot.AvgDistancePerDriveKm);
        Assert.Equal(165, snapshot.AvgEfficiencyWhKm);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_present_partial_block_stays_populated_with_zero_fallbacks()
    {
        // One pattern key present → HasData; the absent numerics coerce to 0, the absent day stays null.
        using var doc = JsonDocument.Parse("""{"most_active_hour": 9}""");
        var snapshot = YearReviewPatterns.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal(9, snapshot.MostActiveHour);
        Assert.Null(snapshot.MostActiveDayOfWeek);
        Assert.Equal(0, snapshot.AvgDrivesPerWeek);
        Assert.Equal(0, snapshot.AvgDistancePerDriveKm);
    }

    [Fact]
    public void FromJson_coerces_non_finite_and_string_numeric_fields()
    {
        using var doc = JsonDocument.Parse(
            """{"avg_drives_per_week":"4.5","most_active_hour":"21","avg_efficiency_wh_km":null}""");
        var snapshot = YearReviewPatterns.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal(4.5, snapshot.AvgDrivesPerWeek);  // numeric string parsed
        Assert.Equal(21, snapshot.MostActiveHour);     // numeric string parsed
        Assert.Equal(0, snapshot.AvgEfficiencyWhKm);   // null → 0
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_patterns_and_non_object()
    {
        using var noPatterns = JsonDocument.Parse("""{"year":2025,"total_drives":10}""");
        Assert.False(YearReviewPatterns.FromJson(noPatterns.RootElement).HasData);

        using var array = JsonDocument.Parse("[]");
        Assert.False(YearReviewPatterns.FromJson(array.RootElement).HasData);

        using var empty = JsonDocument.Parse("{}");
        Assert.False(YearReviewPatterns.FromJson(empty.RootElement).HasData);
    }

    [Theory]
    [InlineData("""{"avg_distance_per_drive_km":1}""", true)]
    [InlineData("""{"most_active_day_of_week":"Mon"}""", true)]
    [InlineData("""{"year":2025}""", false)]
    public void HasData_gate_matches_presence_of_any_pattern_key(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, YearReviewPatterns.FromJson(doc.RootElement).HasData);
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_formats_heading_rows_and_three_stats()
    {
        var view = PatternsSlideProjection.Project(Sample(), UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal("Your driving patterns", view.Heading);

        Assert.Equal("Favorite driving day", view.FavoriteDay.Label);
        Assert.Equal("Saturday", view.FavoriteDay.Value);

        Assert.Equal("Peak driving hour", view.PeakHour.Label);
        Assert.Equal("5 PM", view.PeakHour.Value);

        Assert.Equal(3, view.Metrics.Count);
        Assert.Equal("4.2", view.Metrics[0].Value);
        Assert.Equal("drives/week", view.Metrics[0].Label);
        Assert.Equal("42", view.Metrics[1].Value);
        Assert.Equal("km/drive avg", view.Metrics[1].Label);
        Assert.Equal("165", view.Metrics[2].Value);
        Assert.Equal("Wh/km avg", view.Metrics[2].Label);
    }

    // ---- Projection (imperial) -----------------------------------------------------

    [Fact]
    public void Project_imperial_converts_distance_and_efficiency_not_drives()
    {
        var view = PatternsSlideProjection.Project(Sample(), UnitPref.Imperial, Localizer);

        Assert.Equal("4.2", view.Metrics[0].Value);          // drives/week unchanged
        Assert.Equal("drives/week", view.Metrics[0].Label);

        Assert.Equal("26", view.Metrics[1].Value);           // 42 km -> 26.10 mi -> 26
        Assert.Equal("mi/drive avg", view.Metrics[1].Label);

        Assert.Equal("266", view.Metrics[2].Value);          // 165 Wh/km * 1.609344 -> 265.54 -> 266
        Assert.Equal("Wh/mi avg", view.Metrics[2].Label);
    }

    [Theory]
    [InlineData(0, "12 AM")]
    [InlineData(6, "6 AM")]
    [InlineData(11, "11 AM")]
    [InlineData(12, "12 PM")]
    [InlineData(13, "1 PM")]
    [InlineData(17, "5 PM")]
    [InlineData(23, "11 PM")]
    public void FormatHour_matches_web_12_hour_clock(int hour, string expected) =>
        Assert.Equal(expected, PatternsSlideProjection.FormatHour(hour));

    [Fact]
    public void Project_absent_favorite_day_renders_em_dash()
    {
        var blankDay = Sample() with { MostActiveDayOfWeek = "" };
        Assert.Equal(EmDash, PatternsSlideProjection.Project(blankDay, UnitPref.Metric, Localizer).FavoriteDay.Value);

        var nullDay = Sample() with { MostActiveDayOfWeek = null };
        Assert.Equal(EmDash, PatternsSlideProjection.Project(nullDay, UnitPref.Metric, Localizer).FavoriteDay.Value);
    }

    [Fact]
    public void Project_assigns_distinct_accent_indices_to_rows()
    {
        var view = PatternsSlideProjection.Project(Sample(), UnitPref.Metric, Localizer);

        Assert.Equal(0, view.FavoriteDay.ColorIndex);  // blue ≈ web indigo Calendar
        Assert.Equal(4, view.PeakHour.ColorIndex);     // sky ≈ web sky Clock
        Assert.NotEqual(view.FavoriteDay.ColorIndex, view.PeakHour.ColorIndex);
    }

    [Fact]
    public void Project_rows_and_metrics_have_non_empty_accessibility_names()
    {
        var view = PatternsSlideProjection.Project(Sample(), UnitPref.Metric, Localizer);

        Assert.Contains(view.FavoriteDay.Label, view.FavoriteDay.AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.FavoriteDay.Value, view.FavoriteDay.AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.PeakHour.Value, view.PeakHour.AutomationName, StringComparison.Ordinal);

        foreach (var metric in view.Metrics)
        {
            Assert.False(string.IsNullOrWhiteSpace(metric.AutomationName));
            Assert.Contains(metric.Value, metric.AutomationName, StringComparison.Ordinal);
            Assert.Contains(metric.Label, metric.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Project_constants_match_web()
    {
        Assert.Equal(1000.0, PatternsSlideProjection.MetersPerKm);
        Assert.Equal(1.609344, PatternsSlideProjection.KmPerMile);
        Assert.Equal("\u2014", PatternsSlideProjection.EmDash);
        Assert.Equal("Wh/km", PatternsSlideProjection.EfficiencyUnitMetric);
        Assert.Equal("Wh/mi", PatternsSlideProjection.EfficiencyUnitImperial);
    }

    [Fact]
    public void Project_i18n_keys_match_web_catalog_keys()
    {
        Assert.Equal("translation.yearReview.drivingPatterns", PatternsSlideProjection.HeadingKey);
        Assert.Equal("translation.yearReview.favoriteDay", PatternsSlideProjection.FavoriteDayKey);
        Assert.Equal("translation.yearReview.peakHour", PatternsSlideProjection.PeakHourKey);
        Assert.Equal("translation.yearReview.drivesWeek", PatternsSlideProjection.DrivesWeekKey);
        Assert.Equal("translation.yearReview.distancePerDrive", PatternsSlideProjection.DistancePerDriveKey);
        Assert.Equal("translation.yearReview.avg", PatternsSlideProjection.AvgKey);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(YearReviewJson);

        var cached = PatternsSlideResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal("Saturday", cached.Value!.MostActiveDayOfWeek);

        var offline = PatternsSlideResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(17, offline.Value!.MostActiveHour);
    }

    [Fact]
    public void Map_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(YearReviewJson);

        Assert.Equal(LoadStatus.Loaded, PatternsSlideResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, PatternsSlideResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, PatternsSlideResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, PatternsSlideResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<YearReviewPatterns>.Loading());
        await vm.LoadAsync();

        Assert.Equal(PatternsSlideState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_slide_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(PatternsSlideState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("Saturday", vm.Display.FavoriteDay.Value);
        Assert.Equal("5 PM", vm.Display.PeakHour.Value);
        Assert.Equal(3, vm.Display.Metrics.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(YearReviewPatterns.Empty));
        await vm.LoadAsync();

        Assert.Equal(PatternsSlideState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No driving data for 2025", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<YearReviewPatterns>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(PatternsSlideState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<YearReviewPatterns>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(PatternsSlideState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<YearReviewPatterns>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(PatternsSlideState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_chip()
    {
        using var vm = NewViewModel(RepositoryResult<YearReviewPatterns>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(PatternsSlideState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<YearReviewPatterns>.Loading(),
            RepositoryResult<YearReviewPatterns>.Cached(Sample(), Now, stale: false),
            RepositoryResult<YearReviewPatterns>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(PatternsSlideState.Loaded, vm.State);
        Assert.Equal("Saturday", vm.Display.FavoriteDay.Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("km/drive avg", vm.Display.Metrics[1].Label);
        Assert.Equal("42", vm.Display.Metrics[1].Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("mi/drive avg", vm.Display.Metrics[1].Label);
        Assert.Equal("26", vm.Display.Metrics[1].Value);
    }

    [Fact]
    public async Task ViewModel_title_loading_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<YearReviewPatterns>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Your driving patterns", vm.Title);
        Assert.Equal("Year in Review", vm.EmptyTitle);
        Assert.Equal("Building your year in review\u2026", vm.LoadingLabel);
        Assert.Equal("Retry", vm.RetryLabel);
        Assert.Equal(2025, vm.Year);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(PatternsSlideViewModel.State), changed);
        Assert.Contains(nameof(PatternsSlideViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_snapshot_and_targets_year_review_with_year_and_vehicle()
    {
        using var doc = JsonDocument.Parse(YearReviewJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: 7, year: 2025);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal("Saturday", emissions[^1].Value!.MostActiveDayOfWeek);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_analytics_year_review", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal(2025, Convert.ToInt32(request.Query!["year"], CultureInfo.InvariantCulture));
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_empty_body_streams_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: 3, year: 2024);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("patterns-slide", PatternsSlideRegistration.Id);
        Assert.Equal("analytics", PatternsSlideRegistration.Category);
        Assert.Equal("PatternsSlide", PatternsSlideRegistration.Slug);
        Assert.True(PatternsSlideRegistration.DefaultYear >= 2024);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new PatternsSlideDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PatternsSlide", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static YearReviewPatterns Sample() =>
        new(
            MostActiveDayOfWeek: "Saturday",
            MostActiveHour: 17,
            AvgDrivesPerWeek: 4.2,
            AvgDistancePerDriveKm: 42.0,
            AvgEfficiencyWhKm: 165,
            HasData: true);

    private static RepositoryResult<YearReviewPatterns> Loaded(YearReviewPatterns snapshot) =>
        RepositoryResult<YearReviewPatterns>.Loaded(snapshot, Now);

    private static PatternsSlideViewModel NewViewModel(
        params RepositoryResult<YearReviewPatterns>[] emissions) =>
        new(new FakeSource(emissions), Localizer, Year, UnitPref.Metric, () => Now);

    private static PatternsSlideSource NewSource(IApiClient client, long vehicleId, int year)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new PatternsSlideSource(client, engine, options, vehicleId, year);
    }

    private static async Task<IReadOnlyList<RepositoryResult<YearReviewPatterns>>> Collect(
        IAsyncEnumerable<RepositoryResult<YearReviewPatterns>> stream)
    {
        var list = new List<RepositoryResult<YearReviewPatterns>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<YearReviewPatterns>[] emissions)
        : IPatternsSlideSource
    {
        public async IAsyncEnumerable<RepositoryResult<YearReviewPatterns>> StreamAsync(
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
