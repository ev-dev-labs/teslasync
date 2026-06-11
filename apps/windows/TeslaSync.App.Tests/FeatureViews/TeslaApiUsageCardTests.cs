using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the operator-grade Tesla Fleet API usage card's UI-thread-free logic — the
/// <c>/system/api-usage</c> + <c>/api-logs/stats</c> JSON parse adapters, the projection (budget bar with the
/// billing-window maths, three bands, four detail cells, the service / method top-lists, the over-budget
/// banner, the footer links and the a11y names), the combined cache-then-network source (request shapes +
/// best-effort stats), the cache round-trip, the state-holder view-model's per-state matrix
/// (loading / loaded / empty / error / stale / offline), the registry metadata and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/system/components/status/TeslaApiUsageCard.tsx).
/// </summary>
public sealed class TeslaApiUsageCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Jan 15 2025 12:00Z -> day 15 of 31, resets in 16 days (web test parity).
    private static readonly DateTimeOffset Now = new(2025, 1, 15, 12, 0, 0, TimeSpan.Zero);

    // estimated_cost 87.55 over a 10.00 monthly credit -> 875.5% used, $77.55 overage (web test parity).
    private const string UsageJson = """
    {
      "total_requests": 39436,
      "skipped_polls": 1436,
      "estimated_cost": 87.55,
      "cost_per_request": 0.00222,
      "monthly_credit": 10,
      "estimated_remaining": 0
    }
    """;

    private const string StatsJson = """
    {
      "last_24h": 2800,
      "avg_duration_ms": 184.7,
      "error_rate": 7.0,
      "error_count": 200,
      "total_calls": 39436,
      "by_service": { "tesla_fleet": 28000, "tesla_streaming": 8000, "geocoding": 3000, "webhooks": 436 },
      "by_method": { "GET": 30000, "POST": 9000, "DELETE": 436 }
    }
    """;

    // ---- Snapshot parse adapter ------------------------------------------------------

    [Fact]
    public void Snapshot_FromResponse_reads_all_six_figures()
    {
        var snapshot = ParseUsage(UsageJson)!;

        Assert.Equal(39436, snapshot.TotalRequests);
        Assert.Equal(1436, snapshot.SkippedPolls);
        Assert.Equal(87.55, snapshot.EstimatedCost, 6);
        Assert.Equal(0.00222, snapshot.CostPerRequest, 6);
        Assert.Equal(10, snapshot.MonthlyCredit);
        Assert.Equal(0, snapshot.EstimatedRemaining);
    }

    [Fact]
    public void Snapshot_coerces_absent_and_non_numeric_fields_to_zero()
    {
        var snapshot = ParseUsage("""{"total_requests":"oops","estimated_cost":null}""")!;

        Assert.Equal(0, snapshot.TotalRequests);
        Assert.Equal(0, snapshot.EstimatedCost);
        Assert.Equal(0, snapshot.MonthlyCredit);
    }

    [Fact]
    public void Snapshot_parses_numeric_strings()
    {
        var snapshot = ParseUsage("""{"total_requests":"1234","cost_per_request":"0.5"}""")!;

        Assert.Equal(1234, snapshot.TotalRequests);
        Assert.Equal(0.5, snapshot.CostPerRequest, 6);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("\"x\"")]
    [InlineData("null")]
    public void Snapshot_FromResponse_returns_null_for_non_object(string json)
    {
        Assert.Null(ParseUsage(json));
    }

    // ---- Stats parse adapter ---------------------------------------------------------

    [Fact]
    public void Stats_FromResponse_reads_figures_and_breakdowns()
    {
        var stats = ParseStats(StatsJson)!;

        Assert.Equal(2800, stats.Last24h);
        Assert.Equal(184.7, stats.AvgDurationMs!.Value, 6);
        Assert.Equal(7.0, stats.ErrorRate!.Value, 6);
        Assert.Equal(200, stats.ErrorCount);
        Assert.Equal(4, stats.ByService.Count);
        Assert.Equal(3, stats.ByMethod.Count);
        Assert.Contains(stats.ByService, g => g.Name == "tesla_fleet" && g.Count == 28000);
    }

    [Fact]
    public void Stats_absent_numeric_fields_stay_null_for_em_dash()
    {
        var stats = ParseStats("""{"by_service":{}}""")!;

        Assert.Null(stats.Last24h);
        Assert.Null(stats.AvgDurationMs);
        Assert.Null(stats.ErrorRate);
        Assert.Empty(stats.ByService);
        Assert.Empty(stats.ByMethod);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("42")]
    public void Stats_FromResponse_returns_null_for_non_object(string json)
    {
        Assert.Null(ParseStats(json));
    }

    // ---- Overview gate + cache round-trip --------------------------------------------

    [Fact]
    public void Overview_HasUsage_matches_web_snapshot_gate()
    {
        Assert.False(TeslaApiUsageOverview.Empty.HasUsage);
        Assert.False(new TeslaApiUsageOverview(null, ParseStats(StatsJson)).HasUsage);
        Assert.True(new TeslaApiUsageOverview(ParseUsage(UsageJson), null).HasUsage);
    }

    [Fact]
    public void Overview_round_trips_through_the_cache_json_losslessly()
    {
        var options = ApiClientOptions.CreateJsonOptions();
        var original = new TeslaApiUsageOverview(ParseUsage(UsageJson), ParseStats(StatsJson));

        string payload = JsonSerializer.Serialize(original, options);
        var restored = JsonSerializer.Deserialize<TeslaApiUsageOverview>(payload, options)!;

        Assert.Equal(original.Snapshot, restored.Snapshot);
        Assert.Equal(original.Stats!.ByService.Count, restored.Stats!.ByService.Count);
        Assert.Equal(original.Stats.ByMethod.Count, restored.Stats.ByMethod.Count);
        Assert.True(restored.HasUsage);
    }

    // ---- Billing-window maths (web startOfMonth / endOfMonth parity) -----------------

    [Fact]
    public void BillingWindow_mid_january_is_day_15_of_31_resets_in_16()
    {
        var window = BillingWindow.For(Now);

        Assert.Equal(31, window.TotalDays);
        Assert.Equal(15, window.DaysElapsed);
        Assert.Equal(16, window.DaysRemaining);
    }

    [Fact]
    public void BillingWindow_first_of_month_floors_days_elapsed_at_one()
    {
        var window = BillingWindow.For(new DateTimeOffset(2025, 2, 1, 0, 0, 0, TimeSpan.Zero));

        Assert.Equal(28, window.TotalDays);
        Assert.Equal(1, window.DaysElapsed);
        Assert.Equal(27, window.DaysRemaining);
    }

    [Fact]
    public void BillingWindow_last_day_has_zero_days_remaining()
    {
        var window = BillingWindow.For(new DateTimeOffset(2025, 1, 31, 23, 0, 0, TimeSpan.Zero));

        Assert.Equal(0, window.DaysRemaining);
    }

    // ---- Projection: budget ----------------------------------------------------------

    [Fact]
    public void Project_budget_headline_percent_caption_and_aria()
    {
        var budget = Project().Budget!;

        Assert.Equal("$87.55 of $10.00", budget.Headline);
        Assert.Equal(875.5, budget.Percent, 4);
        Assert.Equal(TeslaApiUsageIntent.Danger, budget.Intent); // 87.55 > 10 -> over budget
        Assert.Contains("of monthly credit", budget.RightLabel, StringComparison.Ordinal);
        Assert.Contains("Day 15 of 31", budget.Caption, StringComparison.Ordinal);
        Assert.Contains("resets in 16 days", budget.Caption, StringComparison.Ordinal);
        Assert.Equal(TeslaApiUsageProjection.BudgetAriaFallback, budget.AriaLabel);
        Assert.StartsWith("Tesla API budget used:", budget.AutomationName, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(5, 10, TeslaApiUsageIntent.Normal)]   // 50% -> normal
    [InlineData(9, 10, TeslaApiUsageIntent.Warn)]     // 90% (> 80) -> warn
    [InlineData(11, 10, TeslaApiUsageIntent.Danger)]  // over budget -> danger
    public void Project_budget_intent_matches_web_thresholds(double cost, double credit, TeslaApiUsageIntent expected)
    {
        var overview = new TeslaApiUsageOverview(
            ParseUsage(UsageJson)! with { EstimatedCost = cost, MonthlyCredit = credit }, null);

        Assert.Equal(expected, TeslaApiUsageProjection.Project(overview, Localizer, Now).Budget!.Intent);
    }

    [Fact]
    public void Project_budget_caption_says_resets_tomorrow_on_last_day()
    {
        var lastDay = new DateTimeOffset(2025, 1, 31, 23, 0, 0, TimeSpan.Zero);
        var budget = TeslaApiUsageProjection.Project(FullOverview(), Localizer, lastDay).Budget!;

        Assert.Contains(TeslaApiUsageProjection.ResetsTomorrowFallback, budget.Caption, StringComparison.Ordinal);
    }

    // ---- Projection: bands -----------------------------------------------------------

    [Fact]
    public void Project_builds_three_bands_with_values_units_and_subs()
    {
        var bands = Project().Bands;

        Assert.Equal(3, bands.Count);

        Assert.Equal(TeslaApiUsageProjection.ThisMonthFallback, bands[0].Label);
        Assert.Equal("39,436", bands[0].Value);
        Assert.Equal(TeslaApiUsageProjection.RequestsUnitFallback, bands[0].Unit);
        Assert.Equal("$5.84/day avg", bands[0].Sub); // 87.55 / 15 days

        Assert.Equal(TeslaApiUsageProjection.Last24hFallback, bands[1].Label);
        Assert.Equal("2,800", bands[1].Value);
        Assert.Equal("$6.22/day burn", bands[1].Sub); // 2800 * 0.00222

        Assert.Equal(TeslaApiUsageProjection.ForecastFallback, bands[2].Label);
        Assert.Equal("$180.94", bands[2].Value);             // dailyAvgCost * 31
        Assert.Equal(string.Empty, bands[2].Unit);
        Assert.Equal(TeslaApiUsageIntent.Danger, bands[2].Intent); // forecast > monthly credit
    }

    [Fact]
    public void Project_last24h_band_is_em_dash_without_stats()
    {
        var bands = TeslaApiUsageProjection.Project(new TeslaApiUsageOverview(ParseUsage(UsageJson), null), Localizer, Now).Bands;

        Assert.Equal(TeslaApiUsageProjection.EmDash, bands[1].Value);
    }

    [Fact]
    public void Project_band_automation_name_reads_label_value_unit_and_sub()
    {
        var band = Project().Bands[0];
        Assert.Equal("This month: 39,436 requests, $5.84/day avg", band.AutomationName);
    }

    [Fact]
    public void Project_honours_currency_symbol()
    {
        var bands = TeslaApiUsageProjection.Project(FullOverview(), Localizer, Now, "\u20ac").Bands;
        Assert.Equal("\u20ac180.94", bands[2].Value);
    }

    // ---- Projection: details ---------------------------------------------------------

    [Fact]
    public void Project_builds_four_detail_cells()
    {
        var details = Project().Details;

        Assert.Equal(4, details.Count);
        Assert.Equal(TeslaApiUsageProjection.UsefulFallback, details[0].Label);
        Assert.Equal("38,000", details[0].Value);                 // 39436 - 1436
        Assert.Equal("1,436", details[1].Value);                  // skipped
        Assert.Equal("185 ms", details[2].Value);                 // round(184.7)
        Assert.Equal("7.0% (200)", details[3].Value);             // errorRate + errorCount
        Assert.Equal(TeslaApiUsageIntent.Danger, details[3].Intent); // 7% >= 5%
        Assert.Equal("Useful: 38,000", details[0].AutomationName);
    }

    [Fact]
    public void Project_detail_latency_and_error_rate_em_dash_without_stats()
    {
        var details = TeslaApiUsageProjection.Project(new TeslaApiUsageOverview(ParseUsage(UsageJson), null), Localizer, Now).Details;

        Assert.Equal(TeslaApiUsageProjection.EmDash, details[2].Value);
        Assert.Equal(TeslaApiUsageProjection.EmDash, details[3].Value);
        Assert.Equal(TeslaApiUsageIntent.Normal, details[3].Intent);
    }

    [Theory]
    [InlineData(0.5, TeslaApiUsageIntent.Normal)]
    [InlineData(2.0, TeslaApiUsageIntent.Warn)]
    [InlineData(7.0, TeslaApiUsageIntent.Danger)]
    public void Project_error_rate_intent_matches_web_thresholds(double rate, TeslaApiUsageIntent expected)
    {
        var stats = ParseStats(StatsJson)! with { ErrorRate = rate };
        var details = TeslaApiUsageProjection.Project(new TeslaApiUsageOverview(ParseUsage(UsageJson), stats), Localizer, Now).Details;

        Assert.Equal(expected, details[3].Intent);
    }

    // ---- Projection: top-lists -------------------------------------------------------

    [Fact]
    public void Project_top_services_sorts_by_count_and_caps_at_three()
    {
        var services = Project().TopLists.Single(t => t.Key == "services");

        Assert.Equal(TeslaApiUsageProjection.TopServicesFallback, services.Title);
        Assert.Equal(3, services.Items.Count);                 // webhooks (436) dropped
        Assert.Equal("tesla_fleet", services.Items[0].Label);
        Assert.Equal("28,000", services.Items[0].Value);
        Assert.Equal("geocoding", services.Items[2].Label);
    }

    [Fact]
    public void Project_by_method_lists_all_methods_sorted()
    {
        var methods = Project().TopLists.Single(t => t.Key == "methods");

        Assert.Equal(3, methods.Items.Count);
        Assert.Equal("GET", methods.Items[0].Label);
        Assert.Equal("30,000", methods.Items[0].Value);
        Assert.Equal("tesla_fleet: 28,000", Project().TopLists.Single(t => t.Key == "services").Items[0].AutomationName);
    }

    [Fact]
    public void Project_omits_top_lists_without_stats()
    {
        var display = TeslaApiUsageProjection.Project(new TeslaApiUsageOverview(ParseUsage(UsageJson), null), Localizer, Now);
        Assert.Empty(display.TopLists);
    }

    // ---- Projection: banner + footer -------------------------------------------------

    [Fact]
    public void Project_over_budget_banner_states_the_overage()
    {
        var banner = Project().Banner!;

        Assert.Equal(TeslaApiUsageProjection.OverBudgetTitleFallback, banner.Title);
        Assert.Equal(TeslaApiUsageIntent.Danger, banner.Intent);
        Assert.Contains("$10.00", banner.Description, StringComparison.Ordinal);
        Assert.Contains("$77.55", banner.Description, StringComparison.Ordinal); // 87.55 - 10.00
    }

    [Fact]
    public void Project_omits_banner_when_within_budget()
    {
        var overview = new TeslaApiUsageOverview(
            ParseUsage(UsageJson)! with { EstimatedCost = 5, MonthlyCredit = 10 }, ParseStats(StatsJson));
        Assert.Null(TeslaApiUsageProjection.Project(overview, Localizer, Now).Banner);
    }

    [Fact]
    public void Project_renders_both_footer_links()
    {
        var footer = Project().Footer;

        Assert.Equal(2, footer.Count);
        Assert.Equal(TeslaApiUsageProjection.ApiLogsRoute, footer[0].Route);
        Assert.Equal(TeslaApiUsageProjection.FooterLogsFallback, footer[0].Label);
        Assert.True(footer[0].Primary);
        Assert.Equal(TeslaApiUsageProjection.TeslaAccountRoute, footer[1].Route);
        Assert.Equal(TeslaApiUsageProjection.FooterTeslaFallback, footer[1].Label);
        Assert.False(footer[1].Primary);
        Assert.All(footer, link => Assert.False(string.IsNullOrWhiteSpace(link.AutomationName)));
    }

    [Fact]
    public void Project_every_region_carries_an_automation_name()
    {
        var display = Project();

        Assert.False(string.IsNullOrWhiteSpace(display.Budget!.AutomationName));
        Assert.All(display.Bands, b => Assert.False(string.IsNullOrWhiteSpace(b.AutomationName)));
        Assert.All(display.Details, d => Assert.False(string.IsNullOrWhiteSpace(d.AutomationName)));
        Assert.All(display.TopLists, t => Assert.All(t.Items, i => Assert.False(string.IsNullOrWhiteSpace(i.AutomationName))));
    }

    [Fact]
    public void Projection_constants_expose_web_i18n_keys()
    {
        Assert.Equal("translation.system.status.teslaApiUsage.title", TeslaApiUsageProjection.TitleKey);
        Assert.Equal("translation.system.status.teslaApiUsage.empty", TeslaApiUsageProjection.EmptyKey);
        Assert.Equal("Tesla API usage data is not available yet.", TeslaApiUsageProjection.EmptyMessage(Localizer));
        Assert.Equal("Tesla API usage", TeslaApiUsageProjection.Title(Localizer));
    }

    // ---- View-model state matrix -----------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display.Budget);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_every_region()
    {
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.Loaded(FullOverview(), Now));
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display.Budget);
        Assert.Equal(3, vm.Display.Bands.Count);
        Assert.Equal(4, vm.Display.Details.Count);
        Assert.Equal(2, vm.Display.TopLists.Count);
        Assert.NotNull(vm.Display.Banner);
        Assert.Equal(2, vm.Display.Footer.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_missing_snapshot_renders_empty()
    {
        var overview = new TeslaApiUsageOverview(null, ParseStats(StatsJson));
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.Loaded(overview, Now));
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_cached_missing_snapshot_also_renders_empty()
    {
        var overview = new TeslaApiUsageOverview(null, null);
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.Cached(overview, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Empty, vm.State);
        Assert.Equal("Tesla API usage data is not available yet.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<TeslaApiUsageOverview>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.Cached(FullOverview(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display.Budget);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.OfflineCached(
            FullOverview(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_money()
    {
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.Loaded(FullOverview(), Now));
        await vm.LoadAsync();
        Assert.Equal("$87.55 of $10.00", vm.Display.Budget!.Headline);

        vm.CurrencySymbol = "\u20ac";

        Assert.Equal("\u20ac87.55 of \u20ac10.00", vm.Display.Budget!.Headline);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<TeslaApiUsageOverview>.Loaded(FullOverview(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TeslaApiUsageViewModel.State), changed);
        Assert.Contains(nameof(TeslaApiUsageViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<TeslaApiUsageOverview>.Loading(),
            RepositoryResult<TeslaApiUsageOverview>.Cached(FullOverview(), Now, stale: false),
            RepositoryResult<TeslaApiUsageOverview>.Loaded(FullOverview(), Now));
        await vm.LoadAsync();

        Assert.Equal(TeslaApiUsageState.Loaded, vm.State);
        Assert.Equal("39,436", vm.Display.Bands[0].Value);
    }

    // ---- Repository source request shape (engine + fake client) ----------------------

    [Fact]
    public async Task Source_streams_combined_overview_and_targets_both_operations()
    {
        var client = new FakeApiClient()
            .ReturnsValue(Element(UsageJson))
            .ReturnsValue(Element(StatsJson));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var overview = emissions[^1].Value!;
        Assert.Equal(39436, overview.Snapshot!.TotalRequests);
        Assert.Equal(2800, overview.Stats!.Last24h);

        Assert.Equal(TeslaApiUsageSource.ApiUsageOperation, client.Requests[0].OperationId);
        Assert.Equal(TeslaApiUsageSource.ApiLogStatsOperation, client.Requests[1].OperationId);
    }

    [Fact]
    public async Task Source_stats_failure_is_best_effort_and_still_loads_snapshot()
    {
        var client = new FakeApiClient()
            .ReturnsValue(Element(UsageJson))
            .Throws(new InvalidOperationException("api-logs down"));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var overview = emissions[^1].Value!;
        Assert.Equal(39436, overview.Snapshot!.TotalRequests);
        Assert.Null(overview.Stats); // best-effort stats failure folds to null
    }

    [Fact]
    public async Task Source_non_object_usage_streams_empty()
    {
        var client = new FakeApiClient()
            .ReturnsValue(Element("[]"))
            .ReturnsValue(Element(StatsJson));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public void Source_exposes_canonical_operation_ids_and_cache_key()
    {
        Assert.Equal("get_api_v1_system_api_usage", TeslaApiUsageSource.ApiUsageOperation);
        Assert.Equal("get_api_v1_api_logs_stats", TeslaApiUsageSource.ApiLogStatsOperation);
        Assert.Equal("system:api-usage:overview", TeslaApiUsageSource.CacheKey);
    }

    // ---- Registration + diagnostics --------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("tesla-api-usage-card", TeslaApiUsageRegistration.Id);
        Assert.Equal("system", TeslaApiUsageRegistration.Category);
        Assert.Equal("TeslaApiUsageCard", TeslaApiUsageRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new TeslaApiUsageDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TeslaApiUsageCard", Assert.Single(sink));
    }

    // ---- Fakes / helpers -------------------------------------------------------------

    private static ApiUsageSnapshot? ParseUsage(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return ApiUsageSnapshot.FromResponse(doc.RootElement);
    }

    private static ApiLogStats? ParseStats(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return ApiLogStats.FromResponse(doc.RootElement);
    }

    private static JsonElement Element(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static TeslaApiUsageOverview FullOverview() =>
        new(ParseUsage(UsageJson), ParseStats(StatsJson));

    private static TeslaApiUsageDisplay Project() =>
        TeslaApiUsageProjection.Project(FullOverview(), Localizer, Now);

    private static TeslaApiUsageViewModel NewViewModel(params RepositoryResult<TeslaApiUsageOverview>[] emissions) =>
        new(new FakeSource(emissions), Localizer, currencySymbol: null, clock: () => Now);

    private static TeslaApiUsageSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new TeslaApiUsageSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<TeslaApiUsageOverview>>> Collect(
        IAsyncEnumerable<RepositoryResult<TeslaApiUsageOverview>> stream)
    {
        var list = new List<RepositoryResult<TeslaApiUsageOverview>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<TeslaApiUsageOverview>[] emissions) : ITeslaApiUsageSource
    {
        public async IAsyncEnumerable<RepositoryResult<TeslaApiUsageOverview>> StreamAsync(
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
