using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Data.State;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// Verifies a representative cross-section of the cache-then-network repositories built
/// on <see cref="RepositoryBase"/>: typed list reads (vehicles), typed single-object
/// reads (share token), path-parameter wiring (signals history) and offline fallback —
/// all over the real engine + in-memory cache + a scripted client.
/// </summary>
public sealed class RepositoryTests
{
    private static readonly ApiClientOptions Options = new();

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
    public async Task Vehicle_repository_emits_loaded_typed_list()
    {
        var vehicle = new GeneratedApi.Vehicle(
            DateTimeOffset.UtcNow, "Car", DateTimeOffset.UtcNow, 7, 99, "UTC", DateTimeOffset.UtcNow, "VIN7");
        var api = new FakeApiClient().ReturnsValue<IReadOnlyList<GeneratedApi.Vehicle>>(new List<GeneratedApi.Vehicle> { vehicle });
        var repo = new VehicleRepository(api, new CacheThenNetworkEngine(new InMemoryCacheStore()), Options);

        var results = await CollectAsync(repo.ListAsync());

        Assert.Equal(LoadStatus.Loading, results[0].Status);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Single(results[^1].Value!);
        Assert.Equal(7, results[^1].Value![0].Id);
    }

    [Fact]
    public async Task Vehicle_repository_emits_empty_for_empty_list()
    {
        var api = new FakeApiClient().ReturnsValue<IReadOnlyList<GeneratedApi.Vehicle>>(new List<GeneratedApi.Vehicle>());
        var repo = new VehicleRepository(api, new CacheThenNetworkEngine(new InMemoryCacheStore()), Options);

        var results = await CollectAsync(repo.ListAsync());

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Sharing_repository_reads_typed_share_token()
    {
        var token = new GeneratedApi.ShareToken(
            DateTimeOffset.UtcNow, 1, 2, true, true, false, "abc", 0);
        var api = new FakeApiClient().ReturnsValue(token);
        var repo = new SharingRepository(api, new CacheThenNetworkEngine(new InMemoryCacheStore()), Options);

        var results = await CollectAsync(repo.GetShareAsync("abc"));

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("abc", results[^1].Value!.Token);
    }

    [Fact]
    public async Task Signals_history_passes_both_path_parameters()
    {
        var api = new FakeApiClient().ReturnsValue(JsonDocument.Parse("[1,2]").RootElement);
        var repo = new TelemetrySignalsRepository(api, new CacheThenNetworkEngine(new InMemoryCacheStore()), Options);

        await CollectAsync(repo.GetHistoryAsync(42, "VehicleSpeed"));

        var request = api.Requests[0];
        Assert.Equal("get_api_v1_signals_vehicleID_signalName_history", request.OperationId);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        Assert.Equal("VehicleSpeed", request.PathParams!["signalName"]);
    }

    [Fact]
    public async Task Offline_fallback_surfaces_cached_value_when_network_fails()
    {
        var cache = new InMemoryCacheStore();
        var json = Options.Json;
        var cached = new List<GeneratedApi.Vehicle>
        {
            new(DateTimeOffset.UtcNow, "Cached", DateTimeOffset.UtcNow, 3, 1, "UTC", DateTimeOffset.UtcNow, "VINC"),
        };
        cache.Seed("vehicles:list", JsonSerializer.Serialize(cached, json), DateTimeOffset.UtcNow);
        var api = new FakeApiClient().Throws(new HttpRequestException("offline"));
        var repo = new VehicleRepository(api, new CacheThenNetworkEngine(cache), Options);

        var results = await CollectAsync(repo.ListAsync());

        Assert.Equal(LoadStatus.Cached, results[1].Status);
        Assert.Equal(LoadStatus.Offline, results[^1].Status);
        Assert.Equal(3, results[^1].Value![0].Id);
        Assert.Equal(RepositoryErrorKind.Network, results[^1].Error!.Kind);
    }
}
