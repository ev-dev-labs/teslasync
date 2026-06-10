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
/// Headless verification of the Helix usage card's UI-thread-free logic — the <c>/ai/usage/today</c> JSON
/// parse adapter (call count + input/output tokens + cost micro-cents, the web zero-coercion, the
/// micro-cents-to-dollars derivation), the projection (the three formatted cells, the live "{n} Helix calls
/// today." / placeholder caption branch, the currency symbol, the a11y names), the cache-then-network result
/// mapper, the repository source's request shape, the state-holder view-model's per-state matrix (loading /
/// loaded / empty / error / stale / offline), the registry metadata and the PII-safe diagnostics. Mirrors the
/// web spec (web/src/features/settings/components/AIUsageCard.tsx).
/// </summary>
public sealed class AIUsageCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string UsageJson = """
    {
      "user_subject": "user-1",
      "call_count": 5,
      "input_tokens": 12345,
      "output_tokens": 6789,
      "cost_micro_cents": 2500000,
      "error_count": 1,
      "avg_latency_ms": 250
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromResponse_reads_all_four_figures()
    {
        using var doc = JsonDocument.Parse(UsageJson);
        var usage = AiUsageToday.FromResponse(doc.RootElement);

        Assert.NotNull(usage);
        Assert.Equal(5, usage!.CallCount);
        Assert.Equal(12345, usage.InputTokens);
        Assert.Equal(6789, usage.OutputTokens);
        Assert.Equal(2_500_000, usage.CostMicroCents);
    }

    [Fact]
    public void CostDollars_divides_micro_cents_by_a_million_like_web()
    {
        using var doc = JsonDocument.Parse(UsageJson);
        var usage = AiUsageToday.FromResponse(doc.RootElement)!;

        // web: microCentsToDollars(cost_micro_cents) = mc / 1_000_000
        Assert.Equal(2.5, usage.CostDollars, 6);
        Assert.Equal(1_000_000d, AiUsageToday.MicroCentsPerDollar);
    }

    [Fact]
    public void FromResponse_coerces_absent_and_non_numeric_fields_to_zero()
    {
        using var doc = JsonDocument.Parse("""{"call_count":"oops","input_tokens":null}""");
        var usage = AiUsageToday.FromResponse(doc.RootElement);

        Assert.NotNull(usage);
        Assert.Equal(0, usage!.CallCount);
        Assert.Equal(0, usage.InputTokens);
        Assert.Equal(0, usage.OutputTokens);
        Assert.Equal(0, usage.CostMicroCents);
    }

    [Fact]
    public void FromResponse_parses_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"input_tokens":"123","cost_micro_cents":"4500000"}""");
        var usage = AiUsageToday.FromResponse(doc.RootElement)!;

        Assert.Equal(123, usage.InputTokens);
        Assert.Equal(4_500_000, usage.CostMicroCents);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("\"x\"")]
    [InlineData("null")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(AiUsageToday.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_empty_object_yields_all_zero_snapshot()
    {
        using var doc = JsonDocument.Parse("{}");
        var usage = AiUsageToday.FromResponse(doc.RootElement);

        // web renders an all-zero card (0 / 0 / $0.00) when data is a present object.
        Assert.NotNull(usage);
        Assert.Equal(AiUsageToday.Empty, usage);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_formats_token_counts_and_cost()
    {
        var cells = AiUsageCardProjection.Project(Sample(), Localizer).Cells;

        Assert.Equal(3, cells.Count);
        Assert.Equal("12,345", cells[0].Value); // tokens in (grouped integer)
        Assert.Equal("6,789", cells[1].Value);  // tokens out
        Assert.Equal("$2.50", cells[2].Value);   // estimated cost (micro-cents -> dollars)
    }

    [Fact]
    public void Project_caption_shows_live_suffix_when_calls_positive()
    {
        var display = AiUsageCardProjection.Project(Sample(), Localizer);

        Assert.True(display.HasData);
        Assert.Equal("5 Helix calls today.", display.Caption);
    }

    [Fact]
    public void Project_caption_shows_placeholder_when_no_calls()
    {
        var display = AiUsageCardProjection.Project(Sample() with { CallCount = 0 }, Localizer);

        Assert.Equal(AiUsageCardProjection.EmptyCaptionFallback, display.Caption);
    }

    [Fact]
    public void Project_builds_accessible_cell_names_with_label_and_value()
    {
        var cells = AiUsageCardProjection.Project(Sample(), Localizer).Cells;

        Assert.Equal("Tokens in: 12,345", cells[0].AutomationName);
        Assert.Equal("Tokens out: 6,789", cells[1].AutomationName);
        Assert.Equal("Estimated cost: $2.50", cells[2].AutomationName);
    }

    [Fact]
    public void Project_currency_symbol_overrides_the_default_dollar()
    {
        var cells = AiUsageCardProjection.Project(Sample(), Localizer, "\u20ac").Cells;

        Assert.Equal("\u20ac2.50", cells[2].Value);
    }

    [Fact]
    public void EmptyDisplay_has_em_dash_cells_and_placeholder_caption()
    {
        var display = AiUsageCardProjection.EmptyDisplay(Localizer);

        Assert.False(display.HasData);
        Assert.Equal("Usage today", display.Title);
        Assert.All(display.Cells, cell => Assert.Equal(AiUsageCardProjection.EmDash, cell.Value));
        Assert.Equal(AiUsageCardProjection.EmptyCaptionFallback, display.Caption);
    }

    [Fact]
    public void Projection_constants_match_web_i18n_keys()
    {
        Assert.Equal("translation.ai.settings.usage.title", AiUsageCardProjection.TitleKey);
        Assert.Equal("translation.ai.settings.usage.tokensIn", AiUsageCardProjection.TokensInKey);
        Assert.Equal("translation.ai.settings.usage.tokensOut", AiUsageCardProjection.TokensOutKey);
        Assert.Equal("translation.ai.settings.usage.cost", AiUsageCardProjection.CostKey);
        Assert.Equal("translation.ai.settings.usage.liveSuffix", AiUsageCardProjection.LiveSuffixKey);
        Assert.Equal("translation.ai.settings.usage.placeholder", AiUsageCardProjection.EmptyCaptionKey);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(UsageJson);

        var cached = AiUsageResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(12345, cached.Value!.InputTokens);

        var offline = AiUsageResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(6789, offline.Value!.OutputTokens);
    }

    [Fact]
    public void Map_collapses_non_object_payload_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var loaded = AiUsageResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, loaded.Status);
    }

    [Fact]
    public void Map_maps_empty_failure_and_loading()
    {
        Assert.Equal(LoadStatus.Empty, AiUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, AiUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, AiUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageToday>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AiUsageCardState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
        Assert.False(vm.HasData);
        Assert.False(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_cells()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(AiUsageCardState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Cells.Count);
        Assert.Equal("12,345", vm.Display.Cells[0].Value);
        Assert.Equal("$2.50", vm.Display.Cells[2].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageToday>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AiUsageCardState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal(AiUsageCardProjection.EmptyCaptionFallback, vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<AiUsageToday>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AiUsageCardState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageToday>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AiUsageCardState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Cells.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageToday>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AiUsageCardState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<AiUsageToday>.Loading(),
            RepositoryResult<AiUsageToday>.Cached(Sample(), Now, stale: false),
            RepositoryResult<AiUsageToday>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(AiUsageCardState.Loaded, vm.State);
        Assert.Equal("12,345", vm.Display.Cells[0].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost_cell()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("$2.50", vm.Display.Cells[2].Value);

        vm.CurrencySymbol = "\u20ac";

        Assert.Equal("\u20ac2.50", vm.Display.Cells[2].Value);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<AiUsageToday>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Usage today", vm.Title);
        Assert.Equal(AiUsageCardProjection.EmptyCaptionFallback, vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AiUsageCardViewModel.State), changed);
        Assert.Contains(nameof(AiUsageCardViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_snapshot_and_targets_the_usage_today_operation_without_params()
    {
        using var doc = JsonDocument.Parse(UsageJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(12345, emissions[^1].Value!.InputTokens);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_ai_usage_today", request.OperationId);
        Assert.Null(request.PathParams);
        Assert.Null(request.Query);
    }

    [Fact]
    public async Task Source_non_object_body_streams_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public void Source_exposes_canonical_operation_id_and_cache_key()
    {
        Assert.Equal("get_api_v1_ai_usage_today", AiUsageTodaySource.UsageTodayOperation);
        Assert.Equal("ai:usage:today", AiUsageTodaySource.CacheKey);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("ai-usage-card", AiUsageCardRegistration.Id);
        Assert.Equal("settings", AiUsageCardRegistration.Category);
        Assert.Equal("AIUsageCard", AiUsageCardRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new AiUsageCardDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIUsageCard", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static AiUsageToday Sample() => new(
        CallCount: 5, InputTokens: 12345, OutputTokens: 6789, CostMicroCents: 2_500_000);

    private static RepositoryResult<AiUsageToday> Loaded(AiUsageToday usage) =>
        RepositoryResult<AiUsageToday>.Loaded(usage, Now);

    private static AiUsageCardViewModel NewViewModel(params RepositoryResult<AiUsageToday>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static AiUsageTodaySource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new AiUsageTodaySource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<AiUsageToday>>> Collect(
        IAsyncEnumerable<RepositoryResult<AiUsageToday>> stream)
    {
        var list = new List<RepositoryResult<AiUsageToday>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<AiUsageToday>[] emissions) : IAiUsageTodaySource
    {
        public async IAsyncEnumerable<RepositoryResult<AiUsageToday>> StreamAsync(
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
