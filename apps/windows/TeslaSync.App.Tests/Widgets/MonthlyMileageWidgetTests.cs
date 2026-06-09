using System.Globalization;
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
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the MonthlyMileageWidget's UI-thread-free logic — the <c>{vehicle_id, months}</c>
/// envelope parse adapter (year_month / total_km), the last-12-month window, the km→SI→display distance
/// conversion, the current-month highlight + color-coding, the per-bar height-ratio, the two-stat projection
/// (This Month / 12-Mo Total) across the compact / standard / wide footprints (including the web
/// <c>hasData = chartData.length &gt; 0 &amp;&amp; some(d =&gt; d.distance &gt; 0)</c> gate and the
/// <c>isCompact = cols &lt;= 1</c> / <c>isWide = cols &gt;= 3</c> branches), the cache-then-network result
/// mapper, the per-vehicle data source (primary resolution + query-scoped request + contract id), the
/// registry metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading /
/// loaded / empty / error / stale / offline + size/units reprojection). Mirrors the web spec
/// (web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx + api/hooks/useAnalytics.ts).
/// </summary>
public sealed class MonthlyMileageWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Fixed reference clock: June 2026 -> current-month key "2026-06".
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private static IReadOnlyList<MonthlyMileageBucket> Buckets(params (string YearMonth, double Km)[] rows)
    {
        var list = new List<MonthlyMileageBucket>(rows.Length);
        foreach (var (ym, km) in rows)
        {
            list.Add(new MonthlyMileageBucket(ym, km));
        }

        return list;
    }

    private static MonthlyMileageDisplay Project(IReadOnlyList<MonthlyMileageBucket> buckets, int cols, int rows, UnitPref? units = null) =>
        MonthlyMileageProjection.Project(buckets, new MonthlyMileageSize(cols, rows), units ?? UnitPref.Metric, Localizer, Now);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_year_month_and_total_km()
    {
        using var doc = JsonDocument.Parse("""{"year_month":"2026-04","total_km":1234.5,"drive_count":9}""");

        var bucket = MonthlyMileageBucket.FromJson(doc.RootElement);

        Assert.Equal("2026-04", bucket.YearMonth);
        Assert.Equal(1234.5, bucket.TotalKm);
    }

    [Fact]
    public void FromJson_defaults_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"drive_count":3}""");

        var bucket = MonthlyMileageBucket.FromJson(doc.RootElement);

        Assert.Equal(string.Empty, bucket.YearMonth);
        Assert.Equal(0, bucket.TotalKm);
    }

    [Fact]
    public void FromJson_parses_numeric_string_total_km()
    {
        using var doc = JsonDocument.Parse("""{"year_month":"2026-02","total_km":"450"}""");

        Assert.Equal(450, MonthlyMileageBucket.FromJson(doc.RootElement).TotalKm);
    }

    [Fact]
    public void ParseEnvelope_reads_months_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle_id":7,"months":[{"year_month":"2026-01","total_km":10}, 7, {"year_month":"2026-02","total_km":20}]}""");

        var list = MonthlyMileageBucket.ParseEnvelope(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal("2026-01", list[0].YearMonth);
        Assert.Equal(10, list[0].TotalKm);
        Assert.Equal("2026-02", list[1].YearMonth);
        Assert.Equal(20, list[1].TotalKm);
    }

    [Theory]
    [InlineData("""{"vehicle_id":7}""")]
    [InlineData("""{"months":null}""")]
    [InlineData("""{"months":42}""")]
    [InlineData("[]")]
    public void ParseEnvelope_returns_empty_for_missing_or_non_array_months(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Empty(MonthlyMileageBucket.ParseEnvelope(doc.RootElement));
    }

    // ---- Short month / current month (web shortMonth + currentMonthKey) ------------

    [Theory]
    [InlineData("2026-01", "Jan")]
    [InlineData("2026-04", "Apr")]
    [InlineData("2026-12", "Dec")]
    public void ShortMonth_maps_year_month_to_short_name(string iso, string expected) =>
        Assert.Equal(expected, MonthlyMileageProjection.ShortMonth(iso));

    [Theory]
    [InlineData("2026-13")]
    [InlineData("2026")]
    [InlineData("not-a-month")]
    [InlineData("")]
    public void ShortMonth_falls_back_to_raw_for_unparseable(string iso) =>
        Assert.Equal(iso, MonthlyMileageProjection.ShortMonth(iso));

    [Fact]
    public void CurrentMonthKey_reads_clock_year_and_month() =>
        Assert.Equal("2026-06", MonthlyMileageProjection.CurrentMonthKey(Now));

    // ---- Projection: conversion / window -------------------------------------------

    [Fact]
    public void Project_metric_distance_equals_total_km()
    {
        var view = Project(Buckets(("2026-01", 100), ("2026-02", 200)), 2, 4);

        Assert.Equal(new[] { 100.0, 200.0 }, view.Bars.Select(b => b.Distance));
        Assert.Equal("km", view.DistanceUnitLabel);
    }

    [Fact]
    public void Project_imperial_converts_km_to_miles()
    {
        // 160.9344 km = 100 mi exactly (1 mi = 1.609344 km).
        var view = Project(Buckets(("2026-03", 160.9344)), 2, 4, UnitPref.Imperial);

        Assert.Equal("mi", view.DistanceUnitLabel);
        Assert.Equal(100.0, Assert.Single(view.Bars).Distance, 6);
    }

    [Fact]
    public void Project_keeps_only_the_last_twelve_months()
    {
        var rows = new (string, double)[13];
        for (int i = 0; i < 13; i++)
        {
            // 2025-01 .. 2026-01, distances 1..13 km.
            int month = (i % 12) + 1;
            int year = 2025 + (i / 12);
            rows[i] = ($"{year}-{month:D2}", i + 1);
        }

        var view = Project(Buckets(rows), 2, 4);

        Assert.Equal(12, view.Bars.Count);
        // The oldest bucket (1 km) is dropped; the kept twelve are 2..13 km.
        Assert.DoesNotContain(1.0, view.Bars.Select(b => b.Distance));
        Assert.Equal(2.0, view.Bars[0].Distance);
        Assert.Equal(13.0, view.Bars[^1].Distance);
    }

    // ---- Projection: hasData gate --------------------------------------------------

    [Fact]
    public void Project_hasData_false_when_no_buckets()
    {
        var view = Project(Buckets(), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
        Assert.Empty(view.Bars);
    }

    [Fact]
    public void Project_hasData_false_when_all_months_zero_distance()
    {
        // Web parity: hasData also requires some(d => d.distance > 0); bars still exist but the surface is empty.
        var view = Project(Buckets(("2026-05", 0), ("2026-06", 0)), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
        Assert.Equal(2, view.Bars.Count);
        Assert.All(view.Bars, b => Assert.Equal(0, b.Distance));
    }

    [Fact]
    public void Project_hasData_true_with_a_single_nonzero_month()
    {
        var view = Project(Buckets(("2026-06", 42)), 2, 4);

        Assert.True(view.HasData);
        Assert.Single(view.Bars);
        Assert.Equal(2, view.Stats.Count);
    }

    // ---- Projection: stats (This Month / 12-Mo Total) ------------------------------

    [Fact]
    public void Project_builds_this_month_and_twelve_month_total_stats()
    {
        // Current month (2026-06) = 50 km; total = 100 + 50 = 150 km.
        var view = Project(Buckets(("2026-05", 100), ("2026-06", 50)), 2, 4);

        Assert.Equal(2, view.Stats.Count);

        Assert.Equal("This Month", view.Stats[0].Label);
        Assert.Equal("50", view.Stats[0].Value);
        Assert.Equal("km", view.Stats[0].Unit);
        Assert.Equal("This Month: 50 km", view.Stats[0].AutomationName);

        Assert.Equal("12-Mo Total", view.Stats[1].Label);
        Assert.Equal("150", view.Stats[1].Value);
        Assert.Equal("km", view.Stats[1].Unit);
        Assert.Equal("12-Mo Total: 150 km", view.Stats[1].AutomationName);
    }

    [Fact]
    public void Project_this_month_is_zero_when_current_month_absent()
    {
        // No 2026-06 bucket -> This Month = 0, total = 250.
        var view = Project(Buckets(("2026-03", 100), ("2026-04", 150)), 2, 4);

        Assert.Equal("0", view.Stats[0].Value);
        Assert.Equal("250", view.Stats[1].Value);
    }

    [Fact]
    public void Project_stats_round_to_integer_with_grouping()
    {
        // 1234.6 km current; 1234.6 total -> fmtInt -> "1,235".
        var view = Project(Buckets(("2026-06", 1234.6)), 2, 4);

        Assert.Equal("1,235", view.Stats[0].Value);
        Assert.Equal("1,235", view.Stats[1].Value);
    }

    // ---- Projection: bar geometry --------------------------------------------------

    [Fact]
    public void Project_scales_bar_height_ratio_to_the_tallest_bar()
    {
        var view = Project(Buckets(("2026-01", 100), ("2026-02", 200), ("2026-03", 50)), 2, 4);

        Assert.Equal(0.5, view.Bars[0].HeightRatio, 3);
        Assert.Equal(1.0, view.Bars[1].HeightRatio, 3);
        Assert.Equal(0.25, view.Bars[2].HeightRatio, 3);
    }

    [Fact]
    public void Project_bar_value_text_uses_one_decimal()
    {
        var view = Project(Buckets(("2026-06", 42)), 2, 4);

        Assert.Equal("42.0", Assert.Single(view.Bars).ValueText);
    }

    // ---- Projection: current-month color + automation ------------------------------

    [Fact]
    public void Project_tints_current_month_accent_and_others_faint()
    {
        var view = Project(Buckets(("2026-05", 100), ("2026-06", 200)), 2, 4);

        Assert.False(view.Bars[0].IsCurrent);
        Assert.Equal("TsColorBorderBrush", view.Bars[0].ColorBrushKey);

        Assert.True(view.Bars[1].IsCurrent);
        Assert.Equal("TsColorAccentBrush", view.Bars[1].ColorBrushKey);
    }

    [Fact]
    public void Project_bar_automation_name_marks_the_current_month()
    {
        var view = Project(Buckets(("2026-05", 100), ("2026-06", 200)), 2, 4);

        Assert.Equal("May: 100.0 km", view.Bars[0].AutomationName);
        Assert.Equal("Jun: 200.0 km, This Month", view.Bars[1].AutomationName);
    }

    [Fact]
    public void Project_bar_label_uses_short_month_name()
    {
        var view = Project(Buckets(("2026-04", 100)), 2, 4);

        Assert.Equal("Apr", Assert.Single(view.Bars).MonthLabel);
    }

    [Fact]
    public void Project_exposes_distance_series_label()
    {
        var view = Project(Buckets(("2026-06", 100)), 2, 4);

        Assert.Equal("Distance", view.DistanceSeriesLabel);
    }

    // ---- Projection: compact / wide branches ---------------------------------------

    [Theory]
    [InlineData(1, 4, true, false)]
    [InlineData(2, 4, false, false)]
    [InlineData(3, 4, false, true)]
    [InlineData(4, 40, false, true)]
    public void Project_compact_and_wide_track_column_count(int cols, int rows, bool compact, bool wide)
    {
        var view = Project(Buckets(("2026-06", 100)), cols, rows);

        Assert.Equal(compact, view.IsCompact);
        Assert.Equal(wide, view.IsWide);
    }

    [Fact]
    public void Project_compact_automation_name_lists_stats()
    {
        var view = Project(Buckets(("2026-05", 100), ("2026-06", 50)), 1, 4);

        Assert.True(view.IsCompact);
        Assert.Contains("This Month: 50 km", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("12-Mo Total: 150 km", view.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_envelope()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle_id":7,"months":[{"year_month":"2026-05","total_km":100},{"year_month":"2026-06","total_km":50}]}""");

        var cached = MonthlyMileageResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Count);

        var offline = MonthlyMileageResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2, offline.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"months":[{"year_month":"2026-06","total_km":10}]}""");

        Assert.Equal(LoadStatus.Loaded, MonthlyMileageResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, MonthlyMileageResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, MonthlyMileageResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Buckets(("2026-05", 100), ("2026-06", 50))));
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(2, vm.Display.Stats.Count);
        Assert.Equal("50", vm.Display.Stats[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_resolved_empty_list_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Buckets()));
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Empty, vm.State);
        Assert.Equal("No mileage data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_all_zero_distance_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Buckets(("2026-05", 0), ("2026-06", 0))));
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Cached(Buckets(("2026-06", 100)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.OfflineCached(
            Buckets(("2026-06", 100)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Loading(),
            RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Cached(Buckets(("2026-06", 40)), Now, stale: false),
            RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Loaded(Buckets(("2026-06", 90)), Now));
        await vm.LoadAsync();

        Assert.Equal(MonthlyMileageState.Loaded, vm.State);
        Assert.Equal("90", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new MonthlyMileageSize(2, 4), Loaded(Buckets(("2026-06", 100))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new MonthlyMileageSize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(MonthlyMileageState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(Buckets(("2026-06", 100))));
        await vm.LoadAsync();
        Assert.Equal("100", vm.Display.Stats[0].Value);
        Assert.Equal("km", vm.Display.DistanceUnitLabel);

        vm.Units = UnitPref.Imperial;

        // 100 km = 62.137 mi -> fmtInt -> "62".
        Assert.Equal("62", vm.Display.Stats[0].Value);
        Assert.Equal("mi", vm.Display.DistanceUnitLabel);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Monthly Mileage", vm.Title);
        Assert.Equal("No mileage data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Buckets(("2026-06", 100))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(MonthlyMileageViewModel.State), changed);
        Assert.Contains(nameof(MonthlyMileageViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("monthly-mileage", MonthlyMileageRegistration.Id);
        Assert.Equal("analytics", MonthlyMileageRegistration.Category);
        Assert.Equal("MonthlyMileageWidget", MonthlyMileageRegistration.Slug);
        Assert.Equal(new MonthlyMileageSize(2, 4), MonthlyMileageRegistration.DefaultSize);
        Assert.Equal(new MonthlyMileageSize(2, 4), MonthlyMileageRegistration.MinSize);
        Assert.Equal(new MonthlyMileageSize(4, 40), MonthlyMileageRegistration.MaxSize);
        Assert.Equal("Monthly Mileage", MonthlyMileageRegistration.Name(Localizer));
        Assert.Equal(
            "Bar chart of monthly driving distance over last 12 months",
            MonthlyMileageRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 4, true)]    // min / default
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 12, true)]   // mid
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(5, 40, false)]  // above max cols
    [InlineData(2, 3, false)]   // below min rows
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, MonthlyMileageRegistration.IsWithinBounds(new MonthlyMileageSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new MonthlyMileageSize(2, 4), MonthlyMileageRegistration.Clamp(new MonthlyMileageSize(0, 0)));
        Assert.Equal(new MonthlyMileageSize(4, 40), MonthlyMileageRegistration.Clamp(new MonthlyMileageSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MonthlyMileageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MonthlyMileageWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new MonthlyMileageSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_monthly_mileage_by_query()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle_id":7,"months":[{"year_month":"2026-05","total_km":100},{"year_month":"2026-06","total_km":50}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MonthlyMileageSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_mileage_monthly", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle_id":42,"months":[{"year_month":"2026-06","total_km":10}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MonthlyMileageSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_months_envelope_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":3,"months":[]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MonthlyMileageSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public void Source_operation_resolves_against_the_generated_endpoint_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(e => e.OperationId == "get_api_v1_mileage_monthly");

        Assert.True(descriptor is not null, "Operation 'get_api_v1_mileage_monthly' is not in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>>> Drain(IMonthlyMileageSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<MonthlyMileageBucket>> Loaded(IReadOnlyList<MonthlyMileageBucket> buckets) =>
        RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Loaded(buckets, Now);

    private static MonthlyMileageViewModel NewViewModel(params RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>[] emissions) =>
        NewViewModel(MonthlyMileageSize.Default, emissions);

    private static MonthlyMileageViewModel NewViewModel(
        MonthlyMileageSize size,
        params RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>[] emissions) =>
        new(new FakeMonthlyMileageSource(emissions), Localizer, size, UnitPref.Metric, () => Now);

    private sealed class FakeMonthlyMileageSource(params RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>[] emissions) : IMonthlyMileageSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>> StreamAsync(
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
