using System.Globalization;
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
/// Headless verification of the operator-grade Helix usage card's UI-thread-free logic — the
/// <c>/ai/usage/{today,by-feature,recent}</c> JSON parse adapters, the projection (three bands, four detail
/// cells, the feature / recent top-lists with their ✓ / ✗ markers, the relative-time tiers, the currency
/// symbol and the a11y names), the combined cache-then-network source (request shapes + best-effort
/// breakdowns), the cache round-trip, the state-holder view-model's per-state matrix
/// (loading / loaded / empty / error / stale / offline), the registry metadata and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/system/components/status/AiUsageCard.tsx). Distinct from the
/// settings Helix usage card verified by <c>AIUsageCardTests</c>.
/// </summary>
public sealed class AiUsageDetailCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string TodayJson = """
    {
      "user_subject": "user-1",
      "call_count": 40,
      "input_tokens": 12345,
      "output_tokens": 6789,
      "cost_micro_cents": 2500000,
      "error_count": 1,
      "avg_latency_ms": 250.4
    }
    """;

    private const string ByFeatureJson = """
    {
      "since": "2026-05-30T00:00:00Z",
      "rows": [
        { "feature_id": "chat",    "call_count": 12, "input_tokens": 100, "output_tokens": 50, "cost_micro_cents": 1000, "error_count": 0 },
        { "feature_id": "summary", "call_count": 30, "input_tokens": 200, "output_tokens": 80, "cost_micro_cents": 2000, "error_count": 1 },
        { "feature_id": "vision",  "call_count": 3,  "input_tokens": 10,  "output_tokens": 5,  "cost_micro_cents": 100,  "error_count": 0 }
      ]
    }
    """;

    private const string RecentJson = """
    {
      "limit": 10,
      "rows": [
        { "id": 7, "feature_id": "chat", "provider": "helix", "model": "gpt", "input_tokens": 100, "output_tokens": 23, "error": "",         "started_at": "2026-06-06T11:59:30Z" },
        { "id": 8, "feature_id": "summary", "provider": "helix", "model": "claude", "input_tokens": 0, "output_tokens": 0, "error": "boom", "started_at": "2026-06-06T11:30:00Z" }
      ]
    }
    """;

    // ---- Today parse adapter --------------------------------------------------------

    [Fact]
    public void TodayStats_FromResponse_reads_all_six_figures()
    {
        var today = ParseToday(TodayJson)!;

        Assert.Equal(40, today.CallCount);
        Assert.Equal(12345, today.InputTokens);
        Assert.Equal(6789, today.OutputTokens);
        Assert.Equal(2_500_000, today.CostMicroCents);
        Assert.Equal(1, today.ErrorCount);
        Assert.Equal(250.4, today.AvgLatencyMs, 6);
    }

    [Fact]
    public void TodayStats_derives_totals_cost_and_error_intent_like_web()
    {
        var today = ParseToday(TodayJson)!;

        Assert.Equal(19134, today.TotalTokens);            // 12345 + 6789
        Assert.Equal(2.5, today.CostDollars, 6);           // 2_500_000 / 1_000_000
        Assert.Equal(AiUsageTodayStats.MicroCentsPerDollar, 1_000_000d);
        Assert.Equal(AiUsageIntent.Warn, today.ErrorIntent); // 1/40 = 2.5% < 5% -> warn
    }

    [Theory]
    [InlineData(0, 40, AiUsageIntent.Normal)]   // no errors
    [InlineData(1, 40, AiUsageIntent.Warn)]     // 2.5% < 5% -> warn
    [InlineData(2, 40, AiUsageIntent.Danger)]   // 5% boundary (>= 0.05) -> danger
    [InlineData(3, 40, AiUsageIntent.Danger)]   // 7.5% -> danger
    [InlineData(1, 0, AiUsageIntent.Normal)]    // errors but no calls -> normal (web guard)
    public void TodayStats_error_intent_matches_web_thresholds(double errors, double calls, AiUsageIntent expected)
    {
        var stats = AiUsageTodayStats.Empty with { ErrorCount = errors, CallCount = calls };
        Assert.Equal(expected, stats.ErrorIntent);
    }

    [Fact]
    public void TodayStats_coerces_absent_and_non_numeric_fields_to_zero()
    {
        var today = ParseToday("""{"call_count":"oops","input_tokens":null}""")!;

        Assert.Equal(0, today.CallCount);
        Assert.Equal(0, today.InputTokens);
        Assert.Equal(0, today.OutputTokens);
        Assert.Equal(0, today.ErrorCount);
        Assert.Equal(0, today.AvgLatencyMs);
    }

    [Fact]
    public void TodayStats_parses_numeric_strings()
    {
        var today = ParseToday("""{"input_tokens":"123","avg_latency_ms":"42.5"}""")!;

        Assert.Equal(123, today.InputTokens);
        Assert.Equal(42.5, today.AvgLatencyMs, 6);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("\"x\"")]
    [InlineData("null")]
    public void TodayStats_FromResponse_returns_null_for_non_object(string json)
    {
        Assert.Null(ParseToday(json));
    }

    // ---- Breakdown parse adapters ---------------------------------------------------

    [Fact]
    public void FeatureStat_ListFromResponse_reads_rows_and_skips_rows_without_id()
    {
        var rows = ParseFeatures(ByFeatureJson);
        Assert.Equal(3, rows.Count);
        Assert.Equal("chat", rows[0].FeatureId);
        Assert.Equal(30, rows[1].CallCount);

        var skipped = ParseFeatures("""{"rows":[{"call_count":5},{"feature_id":"ok","call_count":1}]}""");
        Assert.Single(skipped);
        Assert.Equal("ok", skipped[0].FeatureId);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("""{"rows":null}""")]
    [InlineData("42")]
    public void FeatureStat_ListFromResponse_tolerates_absent_rows(string json)
    {
        Assert.Empty(ParseFeatures(json));
    }

    [Fact]
    public void RecentCall_ListFromResponse_reads_rows_and_failure_flag()
    {
        var rows = ParseRecent(RecentJson);

        Assert.Equal(2, rows.Count);
        Assert.Equal(7, rows[0].Id);
        Assert.False(rows[0].Failed);
        Assert.Equal(123, rows[0].TotalTokens);  // 100 + 23
        Assert.True(rows[1].Failed);             // error == "boom"
    }

    // ---- Overview gate + cache round-trip ------------------------------------------

    [Fact]
    public void Overview_HasUsage_matches_web_today_gate()
    {
        Assert.False(AiUsageOverview.Empty.HasUsage);
        Assert.False(new AiUsageOverview(AiUsageTodayStats.Empty, null, null).HasUsage);    // call_count 0
        Assert.True(new AiUsageOverview(ParseToday(TodayJson), null, null).HasUsage);       // call_count 40
    }

    [Fact]
    public void Overview_constructor_normalises_null_breakdowns_to_empty()
    {
        var overview = new AiUsageOverview(ParseToday(TodayJson), null, null);
        Assert.NotNull(overview.Features);
        Assert.NotNull(overview.Recent);
        Assert.Empty(overview.Features);
        Assert.Empty(overview.Recent);
    }

    [Fact]
    public void Overview_round_trips_through_the_cache_json_losslessly()
    {
        var options = ApiClientOptions.CreateJsonOptions();
        var original = new AiUsageOverview(ParseToday(TodayJson), ParseFeatures(ByFeatureJson), ParseRecent(RecentJson));

        string payload = JsonSerializer.Serialize(original, options);
        var restored = JsonSerializer.Deserialize<AiUsageOverview>(payload, options)!;

        Assert.Equal(original.Today, restored.Today);
        Assert.Equal(original.Features.Count, restored.Features.Count);
        Assert.Equal(original.Recent.Count, restored.Recent.Count);
        Assert.Equal("summary", restored.Features[1].FeatureId);
        Assert.True(restored.Recent[1].Failed);
        Assert.True(restored.HasUsage);
    }

    // ---- Projection: bands ----------------------------------------------------------

    [Fact]
    public void Project_builds_three_bands_with_values_units_and_subs()
    {
        var bands = Project().Bands;

        Assert.Equal(3, bands.Count);

        Assert.Equal(AiUsageDetailProjection.TodayLabelFallback, bands[0].Label);
        Assert.Equal("40", bands[0].Value);
        Assert.Equal(AiUsageDetailProjection.CallsUnitFallback, bands[0].Unit);
        Assert.Equal("1 error", bands[0].Sub);             // singular
        Assert.Equal(AiUsageIntent.Warn, bands[0].Intent); // 1/40 = 2.5%

        Assert.Equal(AiUsageDetailProjection.TokensLabelFallback, bands[1].Label);
        Assert.Equal("19,134", bands[1].Value);            // grouped total
        Assert.Equal(AiUsageDetailProjection.TotalUnitFallback, bands[1].Unit);
        Assert.Equal("12,345 in \u00b7 6,789 out", bands[1].Sub);

        Assert.Equal(AiUsageDetailProjection.CostLatencyLabelFallback, bands[2].Label);
        Assert.Equal("$2.50", bands[2].Value);
        Assert.Equal(string.Empty, bands[2].Unit);
        Assert.Equal("250 ms avg", bands[2].Sub);          // round(250.4)
    }

    [Fact]
    public void Project_pluralises_errors_and_honours_currency_symbol()
    {
        var overview = new AiUsageOverview(
            ParseToday(TodayJson)! with { ErrorCount = 2 }, null, null);
        var bands = AiUsageDetailProjection.Project(overview, Localizer, Now, "\u20ac").Bands;

        Assert.Equal("2 errors", bands[0].Sub);  // plural
        Assert.Equal("\u20ac2.50", bands[2].Value);
    }

    [Fact]
    public void Project_band_automation_name_reads_label_value_unit_and_sub()
    {
        var band = Project().Bands[0];
        Assert.Equal("Today: 40 calls, 1 error", band.AutomationName);
    }

    // ---- Projection: details --------------------------------------------------------

    [Fact]
    public void Project_builds_four_detail_cells_with_error_intent()
    {
        var details = Project().Details;

        Assert.Equal(4, details.Count);
        Assert.Equal("250 ms", details[0].Value);
        Assert.Equal(AiUsageDetailProjection.ErrorsLabelFallback, details[1].Label);
        Assert.Equal("1", details[1].Value);
        Assert.Equal(AiUsageIntent.Danger, details[1].Intent);  // any errors -> danger value
        Assert.Equal("12,345", details[2].Value);
        Assert.Equal("6,789", details[3].Value);
        Assert.Equal("Errors: 1", details[1].AutomationName);
    }

    [Fact]
    public void Project_error_detail_intent_is_normal_when_no_errors()
    {
        var overview = new AiUsageOverview(ParseToday(TodayJson)! with { ErrorCount = 0 }, null, null);
        var details = AiUsageDetailProjection.Project(overview, Localizer, Now).Details;
        Assert.Equal(AiUsageIntent.Normal, details[1].Intent);
    }

    // ---- Projection: top-lists ------------------------------------------------------

    [Fact]
    public void Project_feature_top_list_sorts_by_calls_and_caps_at_five()
    {
        var many = Enumerable.Range(0, 8)
            .Select(i => new AiUsageFeatureStat($"f{i}", i, 0, 0, 0, 0))
            .ToList();
        var overview = new AiUsageOverview(ParseToday(TodayJson), many, null);

        var list = AiUsageDetailProjection.Project(overview, Localizer, Now).TopLists
            .Single(t => t.Key == "features");

        Assert.Equal(AiUsageDetailProjection.ByFeatureTitleFallback, list.Title);
        Assert.Equal(5, list.Items.Count);
        Assert.Equal("f7", list.Items[0].Label);  // highest call count first
        Assert.Equal("7", list.Items[0].Value);
        Assert.Equal("f3", list.Items[4].Label);  // 8,7,6,5,4,3 -> top five ends at f3
    }

    [Fact]
    public void Project_recent_top_list_marks_success_and_failure_and_caps_at_five()
    {
        var overview = new AiUsageOverview(ParseToday(TodayJson), null, ParseRecent(RecentJson));
        var list = AiUsageDetailProjection.Project(overview, Localizer, Now).TopLists
            .Single(t => t.Key == "recent");

        Assert.Equal(2, list.Items.Count);
        Assert.Equal(AiUsageDetailProjection.SuccessMark, list.Items[0].Value);
        Assert.Equal(AiUsageDetailProjection.FailureMark, list.Items[1].Value);
        // summary: "{feature} · {model} · {tokens} tok · {relative}"
        Assert.Equal("chat \u00b7 gpt \u00b7 123 tok \u00b7 30s ago", list.Items[0].Label);
        Assert.Equal("summary \u00b7 claude \u00b7 0 tok \u00b7 30m ago", list.Items[1].Label);
        // a11y spells out the marker
        Assert.EndsWith(", succeeded", list.Items[0].AutomationName);
        Assert.EndsWith(", failed", list.Items[1].AutomationName);
    }

    [Fact]
    public void Project_omits_top_lists_when_breakdowns_empty()
    {
        var overview = new AiUsageOverview(ParseToday(TodayJson), null, null);
        Assert.Empty(AiUsageDetailProjection.Project(overview, Localizer, Now).TopLists);
    }

    // ---- Relative-time tiers (web formatRelativeTime parity) ------------------------

    [Theory]
    [InlineData(0, "0s ago")]
    [InlineData(30_000, "30s ago")]
    [InlineData(90_000, "2m ago")]      // round(1.5) -> 2
    [InlineData(3_600_000, "1h ago")]
    [InlineData(9_000_000, "3h ago")]   // round(2.5) -> 3
    [InlineData(172_800_000, "2d ago")]
    public void RelativeTime_matches_web_tiers(long ageMs, string expected)
    {
        var started = Now.AddMilliseconds(-ageMs).ToString("o", CultureInfo.InvariantCulture);
        Assert.Equal(expected, AiUsageDetailProjection.RelativeTime(started, Localizer, Now));
    }

    [Fact]
    public void RelativeTime_returns_input_verbatim_when_unparseable()
    {
        Assert.Equal("not-a-date", AiUsageDetailProjection.RelativeTime("not-a-date", Localizer, Now));
    }

    [Fact]
    public void Projection_constants_expose_web_i18n_keys()
    {
        Assert.Equal("translation.system.status.aiUsage.title", AiUsageDetailProjection.TitleKey);
        Assert.Equal("translation.system.status.aiUsage.byFeature", AiUsageDetailProjection.ByFeatureTitleKey);
        Assert.Equal("translation.system.status.aiUsage.recent", AiUsageDetailProjection.RecentTitleKey);
        Assert.Equal("Helix usage", AiUsageDetailProjection.Title(Localizer));
        Assert.Equal(
            "No Helix calls yet \u2014 turn on a feature to start.",
            AiUsageDetailProjection.EmptyMessage(Localizer));
    }

    // ---- View-model state matrix ----------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AiUsageDetailState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
        Assert.False(vm.HasData);
        Assert.Empty(vm.Display.Bands);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_bands_details_and_top_lists()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Loaded(FullOverview(), Now));
        await vm.LoadAsync();

        Assert.Equal(AiUsageDetailState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Bands.Count);
        Assert.Equal(4, vm.Display.Details.Count);
        Assert.Equal(2, vm.Display.TopLists.Count);
        Assert.Equal("$2.50", vm.Display.Bands[2].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_zero_call_overview_renders_empty()
    {
        var overview = new AiUsageOverview(AiUsageTodayStats.Empty, null, null);
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Loaded(overview, Now));
        await vm.LoadAsync();

        // web: !today || call_count === 0 -> empty surface
        Assert.Equal(AiUsageDetailState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_cached_zero_call_overview_also_renders_empty()
    {
        var overview = new AiUsageOverview(AiUsageTodayStats.Empty, null, null);
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Cached(overview, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AiUsageDetailState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AiUsageDetailState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal(
            "No Helix calls yet \u2014 turn on a feature to start.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<AiUsageOverview>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AiUsageDetailState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Cached(FullOverview(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AiUsageDetailState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Bands.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.OfflineCached(
            FullOverview(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AiUsageDetailState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<AiUsageOverview>.Loading(),
            RepositoryResult<AiUsageOverview>.Cached(FullOverview(), Now, stale: false),
            RepositoryResult<AiUsageOverview>.Loaded(FullOverview(), Now));
        await vm.LoadAsync();

        Assert.Equal(AiUsageDetailState.Loaded, vm.State);
        Assert.Equal("40", vm.Display.Bands[0].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost_band()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Loaded(FullOverview(), Now));
        await vm.LoadAsync();
        Assert.Equal("$2.50", vm.Display.Bands[2].Value);

        vm.CurrencySymbol = "\u20ac";

        Assert.Equal("\u20ac2.50", vm.Display.Bands[2].Value);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Helix usage", vm.Title);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageOverview>.Loaded(FullOverview(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AiUsageDetailViewModel.State), changed);
        Assert.Contains(nameof(AiUsageDetailViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_combined_overview_and_targets_the_three_operations()
    {
        var client = new FakeApiClient()
            .ReturnsValue(Element(TodayJson))
            .ReturnsValue(Element(ByFeatureJson))
            .ReturnsValue(Element(RecentJson));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var overview = emissions[^1].Value!;
        Assert.Equal(40, overview.Today!.CallCount);
        Assert.Equal(3, overview.Features.Count);
        Assert.Equal(2, overview.Recent.Count);

        Assert.Equal("get_api_v1_ai_usage_today", client.Requests[0].OperationId);
        Assert.Equal("get_api_v1_ai_usage_by_feature", client.Requests[1].OperationId);
        Assert.Equal("get_api_v1_ai_usage_recent", client.Requests[2].OperationId);
        Assert.Null(client.Requests[0].Query);
        Assert.NotNull(client.Requests[2].Query);
        Assert.True(client.Requests[2].Query!.TryGetValue("limit", out var limit));
        Assert.Equal(10, Convert.ToInt32(limit, CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_breakdown_failures_are_best_effort_and_still_load_today()
    {
        var client = new FakeApiClient()
            .ReturnsValue(Element(TodayJson))
            .Throws(new InvalidOperationException("by-feature down"))
            .ReturnsValue(Element(RecentJson));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var overview = emissions[^1].Value!;
        Assert.Equal(40, overview.Today!.CallCount);
        Assert.Empty(overview.Features);    // breakdown failure folded to empty
        Assert.Equal(2, overview.Recent.Count);
    }

    [Fact]
    public async Task Source_non_object_today_streams_empty()
    {
        var client = new FakeApiClient()
            .ReturnsValue(Element("[]"))
            .ReturnsValue(Element(ByFeatureJson))
            .ReturnsValue(Element(RecentJson));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_zero_call_today_streams_empty()
    {
        var client = new FakeApiClient()
            .ReturnsValue(Element("""{"call_count":0}"""))
            .ReturnsValue(Element(ByFeatureJson))
            .ReturnsValue(Element(RecentJson));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        // web: today present but call_count === 0 -> empty surface
        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public void Source_exposes_canonical_operation_ids_and_cache_key()
    {
        Assert.Equal("get_api_v1_ai_usage_today", AiUsageDetailSource.UsageTodayOperation);
        Assert.Equal("get_api_v1_ai_usage_by_feature", AiUsageDetailSource.UsageByFeatureOperation);
        Assert.Equal("get_api_v1_ai_usage_recent", AiUsageDetailSource.UsageRecentOperation);
        Assert.Equal("ai:usage:overview", AiUsageDetailSource.CacheKey);
        Assert.Equal(10, AiUsageDetailSource.RecentLimit);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("ai-usage-detail-card", AiUsageDetailRegistration.Id);
        Assert.Equal("system", AiUsageDetailRegistration.Category);
        Assert.Equal("AiUsageCard", AiUsageDetailRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new AiUsageDetailDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AiUsageCard", Assert.Single(sink));
    }

    // ---- Fakes / helpers ------------------------------------------------------------

    private static AiUsageTodayStats? ParseToday(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return AiUsageTodayStats.FromResponse(doc.RootElement);
    }

    private static IReadOnlyList<AiUsageFeatureStat> ParseFeatures(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return AiUsageFeatureStat.ListFromResponse(doc.RootElement);
    }

    private static IReadOnlyList<AiUsageRecentCall> ParseRecent(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return AiUsageRecentCall.ListFromResponse(doc.RootElement);
    }

    private static JsonElement Element(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static AiUsageOverview FullOverview() =>
        new(ParseToday(TodayJson), ParseFeatures(ByFeatureJson), ParseRecent(RecentJson));

    private static AiUsageDetailDisplay Project() =>
        AiUsageDetailProjection.Project(FullOverview(), Localizer, Now);

    private static AiUsageDetailViewModel NewViewModel(params RepositoryResult<AiUsageOverview>[] emissions) =>
        new(new FakeSource(emissions), Localizer, currencySymbol: null, clock: () => Now);

    private static AiUsageDetailSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new AiUsageDetailSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<AiUsageOverview>>> Collect(
        IAsyncEnumerable<RepositoryResult<AiUsageOverview>> stream)
    {
        var list = new List<RepositoryResult<AiUsageOverview>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<AiUsageOverview>[] emissions) : IAiUsageDetailSource
    {
        public async IAsyncEnumerable<RepositoryResult<AiUsageOverview>> StreamAsync(
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
