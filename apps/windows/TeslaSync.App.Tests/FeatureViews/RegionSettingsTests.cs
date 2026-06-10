using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>RegionSettings</c> feature surface's UI-thread-free logic — the region
/// envelope JSON parse adapter (the inner <c>data.region</c> / <c>data.fleet_api_base_url</c> + the envelope
/// <c>fetched_at</c>), the cache-then-network result mapper, the repository source's request shapes (the region
/// read + the refresh mutation), the state-holder view-model's state matrix (loading / ready / empty / error /
/// stale / offline) and refresh → notice → reload flow, the registry metadata + i18n facade copy (including the
/// exact <c>translation.*</c> catalog keys), the rendered values + accessible labels, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/settings/components/RegionSettings.tsx). The web component
/// renders only the populated and empty branches; the loading / error / stale / offline surfaces are the native
/// cache-then-network states, reproduced in full (never a blank box). The WinUI view itself (RegionSettings.cs)
/// is exercised by the app build.
/// </summary>
public sealed class RegionSettingsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string Region = "NA";
    private const string FleetUrl = "https://fleet-api.prd.na.vn.cloud.tesla.com";
    private const string EmDash = "\u2014";

    // ── Region envelope parse adapter ────────────────────────────────────────────────────────────────

    [Fact]
    public void Config_parses_full_envelope()
    {
        using var doc = JsonDocument.Parse(
            """{"data":{"region":"NA","fleet_api_base_url":"https://fleet-api.prd.na.vn.cloud.tesla.com"},"fetched_at":"2026-06-06T12:00:00Z"}""");

        var config = RegionConfig.FromJson(doc.RootElement);

        Assert.Equal(Region, config.Region);
        Assert.Equal(FleetUrl, config.FleetApiBaseUrl);
        Assert.True(config.HasRegion);
        Assert.True(config.HasSyncTime);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), config.SyncedAt);
    }

    [Fact]
    public void Config_tolerates_null_data_and_missing_fetched_at()
    {
        using var doc = JsonDocument.Parse("""{"data":null,"fetched_at":null}""");

        var config = RegionConfig.FromJson(doc.RootElement);

        Assert.Null(config.Region);
        Assert.Null(config.FleetApiBaseUrl);
        Assert.False(config.HasRegion);
        Assert.False(config.HasSyncTime);
        Assert.Null(config.SyncedAt);
    }

    [Fact]
    public void Config_partial_data_keeps_region_and_nulls_url()
    {
        using var doc = JsonDocument.Parse("""{"data":{"region":"EU"}}""");

        var config = RegionConfig.FromJson(doc.RootElement);

        Assert.Equal("EU", config.Region);
        Assert.Null(config.FleetApiBaseUrl);
        Assert.True(config.HasRegion);
    }

    [Fact]
    public void Config_non_object_body_is_empty()
    {
        using var doc = JsonDocument.Parse("null");

        Assert.Same(RegionConfig.Empty, RegionConfig.FromJson(doc.RootElement));
    }

    [Fact]
    public void Config_blank_region_string_is_not_a_region()
    {
        using var doc = JsonDocument.Parse("""{"data":{"region":"   ","fleet_api_base_url":"x"}}""");

        var config = RegionConfig.FromJson(doc.RootElement);

        Assert.False(config.HasRegion);
    }

    // ── Result mapper ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Mapper_passes_through_transient_and_terminal_status()
    {
        Assert.Equal(LoadStatus.Loading, RegionResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, RegionResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = RegionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    [Fact]
    public void Mapper_loaded_and_offline_carry_typed_config()
    {
        using var doc = JsonDocument.Parse(
            """{"data":{"region":"NA","fleet_api_base_url":"https://fleet-api.prd.na.vn.cloud.tesla.com"},"fetched_at":null}""");

        var loaded = RegionResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(Region, loaded.Value!.Region);

        var offline = RegionResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(FleetUrl, offline.Value!.FleetApiBaseUrl);
    }

    [Fact]
    public void Mapper_cached_preserves_stale_flag()
    {
        using var doc = JsonDocument.Parse("""{"data":{"region":"NA"}}""");

        var cached = RegionResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(Region, cached.Value!.Region);
    }

    // ── Repository source request shapes ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Source_streams_region_and_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse(
            """{"data":{"region":"NA","fleet_api_base_url":"https://fleet-api.prd.na.vn.cloud.tesla.com"},"fetched_at":null}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamRegionAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(Region, emissions[^1].Value!.Region);
        Assert.Equal("get_api_v1_tesla_user_region", client.Requests[^1].OperationId);
        Assert.Equal(RegionSettingsSource.RegionOperation, client.Requests[^1].OperationId);
        Assert.Null(client.Requests[^1].Body);
    }

    [Fact]
    public async Task Source_empty_region_streams_empty_terminal()
    {
        using var doc = JsonDocument.Parse("""{"data":{"region":""},"fetched_at":null}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamRegionAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_refresh_posts_to_the_generated_operation_with_no_body()
    {
        using var doc = JsonDocument.Parse("""{"data":{"region":"NA"},"fetched_at":null}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var outcome = await source.RefreshAsync();

        Assert.True(outcome.Success);
        var request = Assert.Single(client.Requests);
        Assert.Equal("post_api_v1_tesla_user_region_refresh", request.OperationId);
        Assert.Equal(RegionSettingsSource.RefreshOperation, request.OperationId);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task Source_refresh_failure_is_classified_not_thrown()
    {
        var client = new FakeApiClient().Throws(new ApiException("server", 500, null, null));
        var source = NewSource(client);

        var outcome = await source.RefreshAsync();

        Assert.False(outcome.Success);
        Assert.Equal(RepositoryErrorKind.Server, outcome.Error!.Kind);
    }

    // ── View-model: state matrix ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = NewViewModel();
        Assert.Equal(RegionSettingsSurfaceState.Loading, vm.State);
        Assert.Equal(EmDash, vm.RegionValue);
    }

    [Fact]
    public async Task ViewModel_ready_when_region_loaded()
    {
        using var vm = NewViewModel(Loaded(FullConfig()));

        await vm.LoadAsync();

        Assert.Equal(RegionSettingsSurfaceState.Ready, vm.State);
        Assert.Equal(Region, vm.RegionValue);
        Assert.Equal(FleetUrl, vm.FleetApiUrlValue);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_when_no_region()
    {
        using var vm = NewViewModel(RepositoryResult<RegionConfig>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(RegionSettingsSurfaceState.Empty, vm.State);
        Assert.Equal(EmDash, vm.RegionValue);
        Assert.Equal(EmDash, vm.FleetApiUrlValue);
        Assert.Equal("No region data yet. Click Refresh to fetch from Tesla.", vm.NoDataMessage);
    }

    [Fact]
    public async Task ViewModel_error_when_read_fails_hard()
    {
        using var vm = NewViewModel(RepositoryResult<RegionConfig>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(RegionSettingsSurfaceState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("Failed to load data", vm.ErrorMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_region_visible()
    {
        using var vm = NewViewModel(RepositoryResult<RegionConfig>.Cached(FullConfig(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(RegionSettingsSurfaceState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Equal(Region, vm.RegionValue);
    }

    [Fact]
    public async Task ViewModel_offline_shows_cached_region_with_error_flag()
    {
        using var vm = NewViewModel(RepositoryResult<RegionConfig>.OfflineCached(
            FullConfig(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(RegionSettingsSurfaceState.Offline, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal(Region, vm.RegionValue);
        Assert.Equal("Offline", vm.OfflineLabel);
    }

    [Fact]
    public async Task ViewModel_loading_then_loaded_sequence_settles_ready()
    {
        using var vm = NewViewModel(RepositoryResult<RegionConfig>.Loading(), Loaded(FullConfig()));

        await vm.LoadAsync();

        Assert.Equal(RegionSettingsSurfaceState.Ready, vm.State);
        Assert.Equal(Region, vm.RegionValue);
    }

    // ── View-model: refresh → notice → reload flow ───────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_refresh_success_raises_success_notice_and_reloads()
    {
        var source = new FakeRegionSettingsSource(refresh: () => RegionRefreshOutcome.Ok(), Loaded(FullConfig()));
        var diagnostics = new RegionSettingsDiagnostics();
        using var vm = new RegionSettingsViewModel(source, Localizer, diagnostics, () => Now);
        await vm.LoadAsync();

        await vm.RefreshAsync();

        Assert.Equal(1, source.RefreshCount);
        Assert.NotNull(vm.RefreshNotice);
        Assert.Equal(RegionRefreshNoticeKind.Success, vm.RefreshNotice!.Kind);
        Assert.Equal("Region info refreshed", vm.RefreshNotice.Message);
        Assert.Equal(1, diagnostics.RefreshesSucceeded);
        Assert.False(vm.IsRefreshing);
        Assert.Equal(RegionSettingsSurfaceState.Ready, vm.State);
    }

    [Fact]
    public async Task ViewModel_refresh_failure_raises_error_notice()
    {
        var source = new FakeRegionSettingsSource(
            refresh: () => RegionRefreshOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            Loaded(FullConfig()));
        var diagnostics = new RegionSettingsDiagnostics();
        using var vm = new RegionSettingsViewModel(source, Localizer, diagnostics, () => Now);
        await vm.LoadAsync();

        await vm.RefreshAsync();

        Assert.Equal(RegionRefreshNoticeKind.Error, vm.RefreshNotice!.Kind);
        Assert.Equal("Failed to refresh region", vm.RefreshNotice.Message);
        Assert.Equal(1, diagnostics.RefreshesFailed);
    }

    [Fact]
    public async Task ViewModel_retry_reruns_the_read()
    {
        var source = new FakeRegionSettingsSource(
            RepositoryResult<RegionConfig>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new RegionSettingsViewModel(source, Localizer, clock: () => Now);
        await vm.LoadAsync();
        Assert.Equal(RegionSettingsSurfaceState.Error, vm.State);

        await vm.RetryAsync();

        Assert.True(source.StreamCount >= 2);
    }

    [Fact]
    public async Task ViewModel_refresh_is_a_no_op_while_already_refreshing()
    {
        var gate = new TaskCompletionSource<RegionRefreshOutcome>();
        var source = new FakeRegionSettingsSource(refreshAsync: () => gate.Task, Loaded(FullConfig()));
        using var vm = new RegionSettingsViewModel(source, Localizer, clock: () => Now);
        await vm.LoadAsync();

        var first = vm.RefreshAsync();
        Assert.True(vm.IsRefreshing);
        Assert.False(vm.IsRefreshEnabled);

        await vm.RefreshAsync(); // second call must short-circuit while the first is in flight

        gate.SetResult(RegionRefreshOutcome.Ok());
        await first;

        Assert.Equal(1, source.RefreshCount);
        Assert.True(vm.IsRefreshEnabled);
    }

    // ── Rendered values + accessibility ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_synced_label_prefixes_and_formats_the_fetched_at()
    {
        using var vm = NewViewModel(Loaded(FullConfig()));

        await vm.LoadAsync();

        Assert.True(vm.HasSyncTime);
        Assert.NotNull(vm.SyncedLabel);
        Assert.StartsWith("Synced ", vm.SyncedLabel);
    }

    [Fact]
    public async Task ViewModel_missing_url_renders_em_dash()
    {
        using var vm = NewViewModel(Loaded(new RegionConfig(Region, null, null)));

        await vm.LoadAsync();

        Assert.Equal(Region, vm.RegionValue);
        Assert.Equal(EmDash, vm.FleetApiUrlValue);
        Assert.False(vm.HasSyncTime);
        Assert.Null(vm.SyncedLabel);
    }

    [Fact]
    public void ViewModel_exposes_localized_labels()
    {
        using var vm = NewViewModel();

        Assert.Equal("Region & API", vm.Title);
        Assert.Equal("Tesla account region and Fleet API endpoint", vm.Subtitle);
        Assert.Equal("Refresh", vm.RefreshLabel);
        Assert.Equal("Region", vm.RegionCodeLabel);
        Assert.Equal("Fleet API Base URL", vm.FleetApiUrlLabel);
    }

    // ── Registration: i18n copy + exact catalog keys ─────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("region-settings", RegionSettingsRegistration.Id);
        Assert.Equal("RegionSettings", RegionSettingsRegistration.Slug);
    }

    [Fact]
    public void Registration_resolves_every_web_string_through_the_facade()
    {
        Assert.Equal("Region & API", RegionSettingsRegistration.Title(Localizer));
        Assert.Equal("Tesla account region and Fleet API endpoint", RegionSettingsRegistration.Subtitle(Localizer));
        Assert.Equal("Synced", RegionSettingsRegistration.LastSynced(Localizer));
        Assert.Equal("Refresh", RegionSettingsRegistration.Refresh(Localizer));
        Assert.Equal("Region", RegionSettingsRegistration.RegionCode(Localizer));
        Assert.Equal("Fleet API Base URL", RegionSettingsRegistration.FleetApiUrl(Localizer));
        Assert.Equal("No region data yet. Click Refresh to fetch from Tesla.", RegionSettingsRegistration.NoData(Localizer));
        Assert.Equal("Region info refreshed", RegionSettingsRegistration.RefreshSucceeded(Localizer));
        Assert.Equal("Failed to refresh region", RegionSettingsRegistration.RefreshFailed(Localizer));
    }

    [Fact]
    public void Registration_feeds_the_exact_catalog_translation_keys()
    {
        var echo = new KeyEchoLocalizer();

        Assert.Equal("translation.region.title", RegionSettingsRegistration.Title(echo));
        Assert.Equal("translation.region.subtitle", RegionSettingsRegistration.Subtitle(echo));
        Assert.Equal("translation.region.lastSynced", RegionSettingsRegistration.LastSynced(echo));
        Assert.Equal("translation.region.refresh", RegionSettingsRegistration.Refresh(echo));
        Assert.Equal("translation.region.regionCode", RegionSettingsRegistration.RegionCode(echo));
        Assert.Equal("translation.region.fleetApiUrl", RegionSettingsRegistration.FleetApiUrl(echo));
        Assert.Equal("translation.region.noData", RegionSettingsRegistration.NoData(echo));
        Assert.Equal("translation.toast.regionRefreshed", RegionSettingsRegistration.RefreshSucceeded(echo));
        Assert.Equal("translation.toast.regionFailed", RegionSettingsRegistration.RefreshFailed(echo));
        Assert.Equal("translation.common.loading", RegionSettingsRegistration.Loading(echo));
        Assert.Equal("translation.common.offline", RegionSettingsRegistration.Offline(echo));
        Assert.Equal("translation.common.retry", RegionSettingsRegistration.Retry(echo));
        Assert.Equal("translation.error.loadFailed", RegionSettingsRegistration.LoadFailed(echo));
    }

    // ── Diagnostics (PII-safe) ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new RegionSettingsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RegionSettings", Assert.Single(sink));
    }

    [Fact]
    public async Task Diagnostics_records_refresh_resolution_without_leaking_account_detail()
    {
        var sink = new List<string>();
        var diagnostics = new RegionSettingsDiagnostics(sink.Add);
        var source = new FakeRegionSettingsSource(refresh: () => RegionRefreshOutcome.Ok(), Loaded(FullConfig()));
        using var vm = new RegionSettingsViewModel(source, Localizer, diagnostics, () => Now);
        await vm.LoadAsync();

        await vm.RefreshAsync();

        Assert.Equal(1, diagnostics.RefreshesRequested);
        Assert.Equal(1, diagnostics.RefreshesSucceeded);
        Assert.Equal(0, diagnostics.RefreshesFailed);
        Assert.DoesNotContain(sink, line => line.Contains(Region, StringComparison.Ordinal));
        Assert.DoesNotContain(sink, line => line.Contains(FleetUrl, StringComparison.Ordinal));
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────

    private static RegionSettingsViewModel NewViewModel(params RepositoryResult<RegionConfig>[] stream) =>
        new(new FakeRegionSettingsSource(stream), Localizer, clock: () => Now);

    private static RegionSettingsSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new RegionSettingsSource(client, engine, options);
    }

    private static RegionConfig FullConfig() => new(Region, FleetUrl, "2026-06-06T12:00:00Z");

    private static RepositoryResult<RegionConfig> Loaded(RegionConfig config) =>
        RepositoryResult<RegionConfig>.Loaded(config, Now);

    private static async Task<IReadOnlyList<RepositoryResult<RegionConfig>>> Collect(
        IAsyncEnumerable<RepositoryResult<RegionConfig>> stream)
    {
        var list = new List<RepositoryResult<RegionConfig>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    /// <summary>An <see cref="ILocalizer"/> that echoes the requested key, to assert the exact catalog keys.</summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }

    private sealed class FakeRegionSettingsSource : IRegionSettingsSource
    {
        private readonly IReadOnlyList<RepositoryResult<RegionConfig>> _stream;
        private readonly Func<RegionRefreshOutcome>? _refresh;
        private readonly Func<Task<RegionRefreshOutcome>>? _refreshAsync;

        public FakeRegionSettingsSource(params RepositoryResult<RegionConfig>[] stream)
            : this(refresh: null, stream)
        {
        }

        public FakeRegionSettingsSource(
            Func<RegionRefreshOutcome>? refresh,
            params RepositoryResult<RegionConfig>[] stream)
        {
            _stream = stream;
            _refresh = refresh;
        }

        public FakeRegionSettingsSource(
            Func<Task<RegionRefreshOutcome>>? refreshAsync,
            params RepositoryResult<RegionConfig>[] stream)
        {
            _stream = stream;
            _refreshAsync = refreshAsync;
        }

        public int StreamCount { get; private set; }

        public int RefreshCount { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<RegionConfig>> StreamRegionAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            StreamCount++;
            foreach (var result in _stream)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public Task<RegionRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
        {
            RefreshCount++;
            if (_refreshAsync is { } async)
            {
                return async();
            }

            return Task.FromResult(_refresh?.Invoke() ?? RegionRefreshOutcome.Ok());
        }
    }
}
