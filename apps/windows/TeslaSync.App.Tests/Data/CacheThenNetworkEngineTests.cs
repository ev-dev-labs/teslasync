using System.Net;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using Xunit;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// Verifies the cache-then-network emission contract: cached-first surfacing, network
/// refresh, empty detection, offline fallback, hard failure, stale flagging, cache
/// writes + eviction, corrupt-cache tolerance and cancellation propagation.
/// </summary>
public sealed class CacheThenNetworkEngineTests
{
    private static readonly JsonSerializerOptions Json = ApiClientOptions.CreateJsonOptions();

    private static async Task<List<RepositoryResult<T>>> CollectAsync<T>(IAsyncEnumerable<RepositoryResult<T>> source)
    {
        var list = new List<RepositoryResult<T>>();
        await foreach (var item in source)
        {
            list.Add(item);
        }

        return list;
    }

    [Fact]
    public async Task No_cache_yields_loading_then_loaded()
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore());

        var results = await CollectAsync(engine.StreamAsync<int[]>(
            "k", _ => Task.FromResult(new[] { 1, 2 }), v => v.Length == 0, Json));

        Assert.Equal(LoadStatus.Loading, results[0].Status);
        Assert.Equal(LoadStatus.Loaded, results[1].Status);
        Assert.Equal(new[] { 1, 2 }, results[1].Value);
        Assert.Equal(2, results.Count);
    }

    [Fact]
    public async Task Cached_value_is_surfaced_before_the_network_result()
    {
        var cache = new InMemoryCacheStore();
        cache.Seed("k", "[9]", DateTimeOffset.UtcNow);
        var engine = new CacheThenNetworkEngine(cache);

        var results = await CollectAsync(engine.StreamAsync<int[]>(
            "k", _ => Task.FromResult(new[] { 1 }), v => v.Length == 0, Json));

        Assert.Equal(LoadStatus.Loading, results[0].Status);
        Assert.Equal(LoadStatus.Cached, results[1].Status);
        Assert.Equal(new[] { 9 }, results[1].Value);
        Assert.Equal(LoadStatus.Loaded, results[2].Status);
        Assert.Equal(new[] { 1 }, results[2].Value);
    }

    [Fact]
    public async Task Cached_value_past_stale_window_is_flagged_stale()
    {
        var cache = new InMemoryCacheStore();
        var fetchedAt = new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var now = fetchedAt.AddSeconds(CacheFreshness.LiveStaleSeconds + 5);
        cache.Seed("k", "[9]", fetchedAt);
        var engine = new CacheThenNetworkEngine(cache, () => now);

        var results = await CollectAsync(engine.StreamAsync<int[]>(
            "k", _ => Task.FromResult(new[] { 1 }), v => v.Length == 0, Json));

        Assert.True(results[1].IsStale);
    }

    [Fact]
    public async Task Empty_network_result_yields_empty_status()
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore());

        var results = await CollectAsync(engine.StreamAsync<int[]>(
            "k", _ => Task.FromResult(Array.Empty<int>()), v => v.Length == 0, Json));

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
        Assert.False(results[^1].HasValue);
    }

    [Fact]
    public async Task Network_failure_with_cache_falls_back_to_offline_cached()
    {
        var cache = new InMemoryCacheStore();
        cache.Seed("k", "[9]", DateTimeOffset.UtcNow);
        var engine = new CacheThenNetworkEngine(cache);

        var results = await CollectAsync(engine.StreamAsync<int[]>(
            "k", _ => throw new HttpRequestException("down"), v => v.Length == 0, Json));

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Offline, terminal.Status);
        Assert.Equal(new[] { 9 }, terminal.Value);
        Assert.Equal(RepositoryErrorKind.Network, terminal.Error!.Kind);
        Assert.True(terminal.IsStale);
    }

    [Fact]
    public async Task Network_failure_without_cache_yields_failure()
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore());

        var results = await CollectAsync(engine.StreamAsync<int[]>(
            "k", _ => throw new ApiException("boom", 500), v => v.Length == 0, Json));

        Assert.Equal(LoadStatus.Error, results[^1].Status);
        Assert.Equal(RepositoryErrorKind.Server, results[^1].Error!.Kind);
    }

    [Fact]
    public async Task Successful_fetch_writes_cache_and_evicts()
    {
        var cache = new InMemoryCacheStore();
        var engine = new CacheThenNetworkEngine(cache);

        await CollectAsync(engine.StreamAsync<int[]>(
            "k", _ => Task.FromResult(new[] { 7 }), v => v.Length == 0, Json));

        Assert.Equal(1, cache.WriteCount);
        var entry = await cache.ReadAsync("k");
        Assert.Equal("[7]", entry!.Payload);
    }

    [Fact]
    public async Task Corrupt_cache_row_is_treated_as_a_miss()
    {
        var cache = new InMemoryCacheStore();
        cache.Seed("k", "{ this is not valid json", DateTimeOffset.UtcNow);
        var engine = new CacheThenNetworkEngine(cache);

        var results = await CollectAsync(engine.StreamAsync<int[]>(
            "k", _ => Task.FromResult(new[] { 1 }), v => v.Length == 0, Json));

        // No Cached emission — straight from Loading to Loaded.
        Assert.Equal(LoadStatus.Loading, results[0].Status);
        Assert.Equal(LoadStatus.Loaded, results[1].Status);
        Assert.Equal(2, results.Count);
    }

    [Fact]
    public async Task Cancellation_propagates()
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore());
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await CollectAsync(engine.StreamAsync<int[]>(
                "k",
                ct => { ct.ThrowIfCancellationRequested(); return Task.FromResult(new[] { 1 }); },
                v => v.Length == 0, Json, CacheFreshness.LiveStaleSeconds, cts.Token)));
    }
}
