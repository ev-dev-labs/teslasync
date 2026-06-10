using System.Globalization;
using System.Net.Http;
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
/// Headless verification of the frontend-errors surface's UI-thread-free logic — the JSON parse adapters
/// (offender / summary), the cache-then-network result mapper, the projection (the <c>fmtInt</c> grouping, the
/// <c>name/route || '—'</c> em-dash gates and the <c>top.length &gt; 0</c> list gate), the repository source's
/// request shape, the state-holder view-model's full state matrix (loading / loaded / empty / stale / offline /
/// error), the i18n facade key coverage, the registry metadata, the PII-safe diagnostics and the Narrator-name
/// composition. Mirrors the web spec
/// (web/src/features/system/components/status/FrontendErrorsCard.tsx + useWebErrorsSummary). The WinUI view
/// itself is exercised by the app build; its per-state branch selection is driven entirely by the view-model
/// <see cref="FrontendErrorsState"/> asserted here.
/// </summary>
public sealed class FrontendErrorsCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string SummaryJson = """
    {
      "window_seconds": 3600,
      "total": 42,
      "top": [
        {"name": "DashboardPage", "route": "/dashboard", "count": 30},
        {"name": "ChargingPage", "route": "/charging", "count": 12}
      ],
      "as_of": "2026-06-06T11:59:00Z"
    }
    """;

    // ---- Parse adapters --------------------------------------------------------------

    [Fact]
    public void Summary_parses_real_api_fields()
    {
        using var doc = JsonDocument.Parse(SummaryJson);

        var summary = WebErrorsSummary.FromJson(doc.RootElement);

        Assert.Equal(42, summary.Total);
        Assert.Equal(2, summary.Top.Count);
        Assert.Equal("DashboardPage", summary.Top[0].Name);
        Assert.Equal("/dashboard", summary.Top[0].Route);
        Assert.Equal(30, summary.Top[0].Count);
        Assert.Equal("ChargingPage", summary.Top[1].Name);
        Assert.Equal(12, summary.Top[1].Count);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 59, 0, TimeSpan.Zero), summary.AsOfInstant);
    }

    [Fact]
    public void Summary_is_tolerant_of_missing_fields_and_non_object()
    {
        using var partial = JsonDocument.Parse("""{"total":"7"}""");
        var summary = WebErrorsSummary.FromJson(partial.RootElement);
        Assert.Equal(7, summary.Total); // numeric-string tolerated
        Assert.Empty(summary.Top);
        Assert.Null(summary.AsOf);
        Assert.Null(summary.AsOfInstant);

        using var notObject = JsonDocument.Parse("5");
        var empty = WebErrorsSummary.FromJson(notObject.RootElement);
        Assert.Equal(0, empty.Total);
        Assert.Empty(empty.Top);
    }

    [Fact]
    public void Offender_tolerates_missing_fields_and_non_array()
    {
        using var partial = JsonDocument.Parse("""[{"name":"X"}]""");
        var offender = Assert.Single(WebErrorOffender.ParseList(partial.RootElement));
        Assert.Equal("X", offender.Name);
        Assert.Equal(string.Empty, offender.Route);
        Assert.Equal(0, offender.Count);

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(WebErrorOffender.ParseList(notArray.RootElement));
    }

    // ---- Result mapper ---------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(SummaryJson);
        var element = doc.RootElement.Clone();

        Assert.Equal(LoadStatus.Loading, FrontendErrorsResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);

        var loaded = FrontendErrorsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(element, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(42, loaded.Value!.Total);

        var cached = FrontendErrorsResultMapper.Map(RepositoryResult<JsonElement>.Cached(element, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Top.Count);

        var empty = FrontendErrorsResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now));
        Assert.Equal(LoadStatus.Empty, empty.Status);
        Assert.Null(empty.Value);

        var failure = FrontendErrorsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);

        var offline = FrontendErrorsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            element, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(42, offline.Value!.Total);
    }

    // ---- Repository source request shape ---------------------------------------------

    [Fact]
    public async Task Source_targets_the_web_errors_summary_endpoint()
    {
        using var doc = JsonDocument.Parse(SummaryJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new FrontendErrorsSource(api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamSummaryAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(42, emissions[^1].Value!.Total);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_admin_web_errors_summary", request.OperationId);
        Assert.True(request.Query is null || request.Query.Count == 0);
    }

    [Fact]
    public async Task Source_non_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new FrontendErrorsSource(api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamSummaryAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_falls_back_to_cache_when_the_network_fails()
    {
        using var doc = JsonDocument.Parse(SummaryJson);
        var cache = new InMemoryCacheStore();
        var options = new ApiClientOptions();
        var engine = new CacheThenNetworkEngine(cache, () => Now);

        var ok = new FrontendErrorsSource(new FakeApiClient().ReturnsValue(doc.RootElement.Clone()), engine, options);
        _ = await Collect(ok.StreamSummaryAsync()); // warm the cache

        var down = new FrontendErrorsSource(
            new FakeApiClient().Throws(new HttpRequestException("offline")), engine, options);
        var emissions = await Collect(down.StreamSummaryAsync());

        Assert.Equal(LoadStatus.Offline, emissions[^1].Status);
        Assert.Equal(42, emissions[^1].Value!.Total);
    }

    // ---- View-model state matrix (loading / loaded / empty / stale / offline / error) ----

    [Fact]
    public async Task ViewModel_loading_then_loaded_shows_total_and_offenders()
    {
        var source = new FakeFrontendErrorsSource(
            RepositoryResult<WebErrorsSummary>.Loading(),
            RepositoryResult<WebErrorsSummary>.Loaded(Sample(), Now));
        using var vm = new FrontendErrorsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FrontendErrorsState.Loaded, vm.State);
        Assert.True(vm.Display.HasOffenders);
        Assert.Equal(2, vm.Display.Offenders.Count);
        Assert.Equal("42", vm.Display.TotalText);
        Assert.False(vm.IsFetching);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_null_body_is_whole_surface_empty()
    {
        var source = new FakeFrontendErrorsSource(RepositoryResult<WebErrorsSummary>.Empty(Now));
        using var vm = new FrontendErrorsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FrontendErrorsState.Empty, vm.State);
        Assert.False(string.IsNullOrEmpty(vm.EmptyText));
        Assert.Equal(vm.EmptyText, vm.StatusAnnouncement);
    }

    [Fact]
    public async Task ViewModel_loaded_with_zero_offenders_stays_loaded_with_no_errors_copy()
    {
        // Web parity: data present (total 0, top empty) renders the card with the "No frontend errors…" copy,
        // NOT the whole-surface empty surface.
        var source = new FakeFrontendErrorsSource(
            RepositoryResult<WebErrorsSummary>.Loaded(WebErrorsSummary.Empty, Now));
        using var vm = new FrontendErrorsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FrontendErrorsState.Loaded, vm.State);
        Assert.False(vm.Display.HasOffenders);
        Assert.Equal("0", vm.Display.TotalText);
        Assert.False(string.IsNullOrEmpty(vm.NoErrorsText));
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_content_and_sets_stale_flag()
    {
        var source = new FakeFrontendErrorsSource(
            RepositoryResult<WebErrorsSummary>.Cached(Sample(), Now, stale: true));
        using var vm = new FrontendErrorsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FrontendErrorsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasOffenders);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_content_and_sets_error_flag()
    {
        var source = new FakeFrontendErrorsSource(RepositoryResult<WebErrorsSummary>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new FrontendErrorsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FrontendErrorsState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.HasOffenders);
        Assert.Equal(vm.OfflineLabel, vm.StatusAnnouncement);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache_shows_retry_state()
    {
        var source = new FakeFrontendErrorsSource(RepositoryResult<WebErrorsSummary>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new FrontendErrorsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FrontendErrorsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.Display.HasOffenders);
        Assert.Equal(vm.ErrorMessageDefault, vm.StatusAnnouncement);
    }

    [Fact]
    public async Task ViewModel_retry_reloads_from_the_source()
    {
        var source = new FakeFrontendErrorsSource(RepositoryResult<WebErrorsSummary>.Loaded(Sample(), Now));
        using var vm = new FrontendErrorsViewModel(source, Localizer);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, source.Calls);
        Assert.Equal(FrontendErrorsState.Loaded, vm.State);
    }

    // ---- Projection ------------------------------------------------------------------

    [Fact]
    public void Projection_groups_counts_like_fmtInt()
    {
        var summary = new WebErrorsSummary(
            12345,
            new[] { new WebErrorOffender("Big", "/big", 12345) },
            null);

        var display = FrontendErrorsProjection.Project(summary, Localizer);

        Assert.Equal("12,345", display.TotalText);
        Assert.Equal("12,345", display.Offenders[0].CountText);
    }

    [Fact]
    public void Projection_em_dashes_blank_name_and_route()
    {
        var summary = new WebErrorsSummary(
            5,
            new[] { new WebErrorOffender(string.Empty, string.Empty, 5) },
            null);

        var offender = Assert.Single(FrontendErrorsProjection.Project(summary, Localizer).Offenders);

        Assert.Equal(FrontendErrorsProjection.EmDash, offender.Name);
        Assert.Equal(FrontendErrorsProjection.EmDash, offender.Route);
        Assert.Equal("5", offender.CountText);
    }

    [Fact]
    public void Projection_offender_automation_name_includes_name_route_and_count()
    {
        var summary = new WebErrorsSummary(
            3,
            new[] { new WebErrorOffender("Dash", "/d", 3) },
            null);

        var offender = Assert.Single(FrontendErrorsProjection.Project(summary, Localizer).Offenders);

        Assert.Contains("Dash", offender.AutomationName, StringComparison.Ordinal);
        Assert.Contains("/d", offender.AutomationName, StringComparison.Ordinal);
        Assert.Contains("3", offender.AutomationName, StringComparison.Ordinal);
    }

    // ---- Registry + i18n key coverage -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("frontend-errors-card", FrontendErrorsRegistration.Id);
        Assert.Equal("FrontendErrorsCard", FrontendErrorsRegistration.Slug);
        Assert.False(string.IsNullOrWhiteSpace(FrontendErrorsRegistration.TitleGlyph));
    }

    [Fact]
    public void Registration_routes_every_region_through_the_expected_catalog_keys()
    {
        var echo = KeyEchoLocalizer.Instance;

        Assert.Equal("admin.errors.title", FrontendErrorsRegistration.Title(echo));
        Assert.Equal("admin.errors.subtitle", FrontendErrorsRegistration.Subtitle(echo));
        Assert.Equal("admin.errors.totalLastHour", FrontendErrorsRegistration.TotalLabel(echo));
        Assert.Equal("admin.errors.topOffenders", FrontendErrorsRegistration.TopOffendersLabel(echo));
        Assert.Equal("admin.errors.noErrors", FrontendErrorsRegistration.NoErrorsText(echo));
        Assert.Equal("admin.errors.unableToLoad", FrontendErrorsRegistration.UnableToLoadText(echo));
        Assert.Equal("common.loading", FrontendErrorsRegistration.LoadingLabel(echo));
        Assert.Equal("common.offline", FrontendErrorsRegistration.OfflineLabel(echo));
        Assert.Equal("common.retry", FrontendErrorsRegistration.RetryLabel(echo));
    }

    [Fact]
    public void Registration_falls_back_to_english_copy_when_unlocalized()
    {
        Assert.Equal("Frontend Errors (Last Hour)", FrontendErrorsRegistration.Title(Localizer));
        Assert.Equal("Errors in last hour", FrontendErrorsRegistration.TotalLabel(Localizer));
        Assert.Equal("Top error sources", FrontendErrorsRegistration.TopOffendersLabel(Localizer));
        Assert.Equal("No frontend errors reported in the last hour.", FrontendErrorsRegistration.NoErrorsText(Localizer));
        Assert.Equal("Unable to load error summary.", FrontendErrorsRegistration.UnableToLoadText(Localizer));
    }

    // ---- Diagnostics ------------------------------------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug_and_no_payload()
    {
        var sink = new List<string>();
        var diagnostics = new FrontendErrorsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        var line = Assert.Single(sink);
        Assert.Equal("view.opened slug=FrontendErrorsCard", line);
        Assert.DoesNotContain("/dashboard", line, StringComparison.Ordinal);
    }

    // ---- Helpers ----------------------------------------------------------------------

    private static WebErrorsSummary Sample()
    {
        using var doc = JsonDocument.Parse(SummaryJson);
        return WebErrorsSummary.FromJson(doc.RootElement);
    }

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<IReadOnlyList<RepositoryResult<WebErrorsSummary>>> Collect(
        IAsyncEnumerable<RepositoryResult<WebErrorsSummary>> stream)
    {
        var list = new List<RepositoryResult<WebErrorsSummary>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeFrontendErrorsSource(params RepositoryResult<WebErrorsSummary>[] results)
        : IFrontendErrorsSource
    {
        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<WebErrorsSummary>> StreamSummaryAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            foreach (var result in results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public static KeyEchoLocalizer Instance { get; } = new();

        public string GetString(string key, string fallback) => key;
    }
}
