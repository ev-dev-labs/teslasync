using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the APIUsageWidget's UI-thread-free logic — the JSON parse adapter, the
/// stat projection (calls / average response / error rate / error count, with the danger-alert and
/// "High" chip branches), the cache-then-network result mapper, the footprint flags, the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading /
/// loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/APIUsageWidget.tsx).
/// </summary>
public sealed class APIUsageWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static ApiUsageStats Stats(
        int last24h = 12345,
        double avgDurationMs = 42.5,
        double errorRate = 6.5,
        int errorCount = 12,
        int totalCalls = 20000) =>
        new(last24h, avgDurationMs, errorRate, errorCount, totalCalls);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"total_calls":20000,"error_count":12,"error_rate":6.5,
         "avg_duration_ms":42.5,"last_24h":12345,"by_method":{"GET":10},"by_service":{"tesla":5}}
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = ApiUsageStats.FromJson(doc.RootElement);

        Assert.Equal(12345, stats.Last24h);
        Assert.Equal(42.5, stats.AvgDurationMs);
        Assert.Equal(6.5, stats.ErrorRate);
        Assert.Equal(12, stats.ErrorCount);
        Assert.Equal(20000, stats.TotalCalls);
        Assert.True(stats.HasData);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"last_24h":7}""");

        var stats = ApiUsageStats.FromJson(doc.RootElement);

        Assert.Equal(7, stats.Last24h);
        Assert.Equal(0, stats.AvgDurationMs);
        Assert.Equal(0, stats.ErrorRate);
        Assert.Equal(0, stats.ErrorCount);
        Assert.Equal(0, stats.TotalCalls);
        Assert.True(stats.HasData); // a present object renders (web shows zeros, not empty)
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var stats = ApiUsageStats.FromJson(doc.RootElement);
        Assert.False(stats.HasData);
        Assert.Equal(0, stats.Last24h);
    }

    [Fact]
    public void FromJson_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"last_24h":"50","error_rate":"3.5"}""");
        var stats = ApiUsageStats.FromJson(doc.RootElement);
        Assert.Equal(50, stats.Last24h);
        Assert.Equal(3.5, stats.ErrorRate);
    }

    [Fact]
    public void Empty_snapshot_has_no_data()
    {
        Assert.False(ApiUsageStats.Empty.HasData);
        Assert.True(Stats().HasData);
    }

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(1, 2, true, false, 2)]   // compact
    [InlineData(2, 2, false, false, 2)]  // standard 2-up
    [InlineData(3, 2, false, true, 4)]   // wide at 3 cols (web isWide = cols >= 3)
    [InlineData(4, 2, false, true, 4)]   // wide
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide, int gridCols)
    {
        var size = new ApiUsageSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
        Assert.Equal(gridCols, size.GridColumns);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_formats_four_stats()
    {
        var view = ApiUsageProjection.Project(Stats(), new ApiUsageSize(2, 2), Localizer);

        Assert.Equal(4, view.Stats.Count);

        Assert.Equal("Total Calls (24h)", view.Stats[0].Label);
        Assert.Equal("12,345", view.Stats[0].Value); // web totalCalls reads data.last24h
        Assert.Null(view.Stats[0].Unit);
        Assert.False(view.Stats[0].IsAlert);

        Assert.Equal("Avg Response", view.Stats[1].Label);
        Assert.Equal("42.5", view.Stats[1].Value);
        Assert.Equal("ms", view.Stats[1].Unit);

        Assert.Equal("Error Rate", view.Stats[2].Label);
        Assert.Equal("6.5", view.Stats[2].Value);
        Assert.Equal("%", view.Stats[2].Unit);

        Assert.Equal("Errors", view.Stats[3].Label);
        Assert.Equal("12", view.Stats[3].Value);
        Assert.Null(view.Stats[3].Unit);
    }

    [Fact]
    public void Project_flags_high_error_rate_with_alert_and_trend()
    {
        var view = ApiUsageProjection.Project(
            Stats(errorRate: 6.5, errorCount: 12), new ApiUsageSize(2, 2), Localizer);

        Assert.True(view.Stats[2].IsAlert);          // error rate > 5 -> red value
        Assert.Equal("High", view.Stats[2].TrendLabel);
        Assert.True(view.Stats[3].IsAlert);          // error count > 0 -> red value
        Assert.Null(view.Stats[3].TrendLabel);       // no trend chip on the count tile
    }

    [Fact]
    public void Project_does_not_flag_low_error_rate()
    {
        var view = ApiUsageProjection.Project(
            Stats(errorRate: 2.0, errorCount: 0), new ApiUsageSize(2, 2), Localizer);

        Assert.False(view.Stats[2].IsAlert);
        Assert.Null(view.Stats[2].TrendLabel);
        Assert.False(view.Stats[3].IsAlert);
    }

    [Fact]
    public void Project_compact_reads_last24h_and_label()
    {
        var view = ApiUsageProjection.Project(
            Stats(last24h: 12345, errorRate: 2.0), new ApiUsageSize(1, 2), Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal("12,345", view.CompactValue);
        Assert.Equal("Calls (24h)", view.CompactLabel);
        Assert.False(view.ShowCompactError);
        Assert.Equal(string.Empty, view.CompactErrorText);
    }

    [Fact]
    public void Project_compact_shows_error_line_when_high()
    {
        var view = ApiUsageProjection.Project(
            Stats(errorRate: 6.5), new ApiUsageSize(1, 2), Localizer);

        Assert.True(view.ShowCompactError);
        Assert.Equal("6.5% errors", view.CompactErrorText);
    }

    [Fact]
    public void Project_stats_have_non_empty_accessibility_names()
    {
        var view = ApiUsageProjection.Project(Stats(), new ApiUsageSize(2, 2), Localizer);

        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains("Calls (24h)", view.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_automation_name_includes_error_when_high()
    {
        var view = ApiUsageProjection.Project(
            Stats(last24h: 100, errorRate: 9.0), new ApiUsageSize(1, 2), Localizer);

        Assert.Contains("Calls (24h)", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("errors", view.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_each_stat_has_a_glyph()
    {
        var view = ApiUsageProjection.Project(Stats(), new ApiUsageSize(2, 2), Localizer);
        Assert.All(view.Stats, s => Assert.False(string.IsNullOrEmpty(s.Glyph)));
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"last_24h":10,"error_count":2}""");

        var cached = ApiUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10, cached.Value!.Last24h);

        var offline = ApiUsageResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2, offline.Value!.ErrorCount);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"last_24h":10}""");

        Assert.Equal(LoadStatus.Loaded, ApiUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ApiUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ApiUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ApiUsageStats>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ApiUsageState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_stats()
    {
        using var vm = NewViewModel(Loaded(Stats()));
        await vm.LoadAsync();

        Assert.Equal(ApiUsageState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_payload_renders_empty()
    {
        using var vm = NewViewModel(Loaded(ApiUsageStats.Empty));
        await vm.LoadAsync();

        Assert.Equal(ApiUsageState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No API usage data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ApiUsageStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ApiUsageState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ApiUsageStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ApiUsageState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<ApiUsageStats>.Cached(Stats(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ApiUsageState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ApiUsageStats>.OfflineCached(
            Stats(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ApiUsageState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ApiUsageStats>.Loading(),
            RepositoryResult<ApiUsageStats>.Cached(Stats(last24h: 5), Now, stale: false),
            RepositoryResult<ApiUsageStats>.Loaded(Stats(last24h: 9876), Now));
        await vm.LoadAsync();

        Assert.Equal(ApiUsageState.Loaded, vm.State);
        Assert.Equal("9,876", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new ApiUsageSize(2, 2), Loaded(Stats()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ApiUsageSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ApiUsageState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_wide_grid()
    {
        using var vm = NewViewModel(new ApiUsageSize(2, 2), Loaded(Stats()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsWide);

        vm.Size = new ApiUsageSize(3, 2);
        Assert.True(vm.Display.IsWide);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ApiUsageStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("API Usage", vm.Title);
        Assert.Equal("No API usage data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Stats()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ApiUsageViewModel.State), changed);
        Assert.Contains(nameof(ApiUsageViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("api-usage", ApiUsageRegistration.Id);
        Assert.Equal("system", ApiUsageRegistration.Category);
        Assert.Equal("APIUsageWidget", ApiUsageRegistration.Slug);
        Assert.Equal(new ApiUsageSize(2, 2), ApiUsageRegistration.DefaultSize);
        Assert.Equal(new ApiUsageSize(1, 2), ApiUsageRegistration.MinSize);
        Assert.Equal(new ApiUsageSize(4, 40), ApiUsageRegistration.MaxSize);
        Assert.Equal("API Usage", ApiUsageRegistration.Name(Localizer));
        Assert.Contains("error", ApiUsageRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ApiUsageRegistration.IsWithinBounds(new ApiUsageSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ApiUsageSize(1, 2), ApiUsageRegistration.Clamp(new ApiUsageSize(0, 0)));
        Assert.Equal(new ApiUsageSize(4, 40), ApiUsageRegistration.Clamp(new ApiUsageSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ApiUsageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=APIUsageWidget", Assert.Single(lines));
    }

    // ---- Constants (web parity) ----------------------------------------------------

    [Fact]
    public void Projection_error_threshold_matches_web_constant() =>
        Assert.Equal(5.0, ApiUsageProjection.ErrorRateAlertThreshold);

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<ApiUsageStats> Loaded(ApiUsageStats stats) =>
        RepositoryResult<ApiUsageStats>.Loaded(stats, Now);

    private static ApiUsageViewModel NewViewModel(params RepositoryResult<ApiUsageStats>[] emissions) =>
        NewViewModel(ApiUsageSize.Default, emissions);

    private static ApiUsageViewModel NewViewModel(
        ApiUsageSize size,
        params RepositoryResult<ApiUsageStats>[] emissions) =>
        new(new FakeApiUsageSource(emissions), Localizer, size, () => Now);

    private sealed class FakeApiUsageSource(params RepositoryResult<ApiUsageStats>[] emissions) : IApiUsageSource
    {
        public async IAsyncEnumerable<RepositoryResult<ApiUsageStats>> StreamAsync(
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
