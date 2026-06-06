using System.Text.Json;
using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Widgets;
using GeneratedApi = TeslaSync.Windows.Generated.Api;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Verifies the cache-backed widget source reads real serialized state from the W5 response cache,
/// selects the primary vehicle, and prefers the newer W6 live receive time for freshness — without any
/// network or SSE access.
/// </summary>
public sealed class CacheWidgetVehicleSourceTests
{
    private static readonly JsonSerializerOptions Json = ApiClientOptions.CreateJsonOptions();
    private static readonly DateTimeOffset CacheTime = DateTimeOffset.UnixEpoch.AddHours(2);

    private static async Task SeedAsync(
        FakeCacheStore cache,
        IEnumerable<GeneratedApi.Vehicle> vehicles,
        params GeneratedApi.VehicleState[] states)
    {
        await cache.WriteAsync("vehicles:list", JsonSerializer.Serialize(vehicles, Json), CacheTime);
        foreach (var state in states)
        {
            await cache.WriteAsync($"vehicles:{state.VehicleId}:state", JsonSerializer.Serialize(state, Json), CacheTime);
        }
    }

    [Fact]
    public async Task GetPrimary_reads_cached_state_and_uses_cache_time_for_freshness()
    {
        var cache = new FakeCacheStore();
        await SeedAsync(
            cache,
            new[] { WidgetTestData.MakeVehicle(7, "Model 3", "VIN0000007") },
            WidgetTestData.MakeState(7, battery: 64));

        var snapshot = await new CacheWidgetVehicleSource(cache, Json).GetPrimaryAsync();

        Assert.NotNull(snapshot);
        Assert.Equal(7, snapshot!.VehicleId);
        Assert.Equal("Model 3", snapshot.DisplayName);
        Assert.Equal(64, snapshot.BatteryLevel);
        Assert.Equal(CacheTime, snapshot.ObservedAt);
    }

    [Fact]
    public async Task GetPrimary_skips_archived_vehicles()
    {
        var cache = new FakeCacheStore();
        await SeedAsync(
            cache,
            new[]
            {
                WidgetTestData.MakeVehicle(1, "Retired", "VIN0000001", archivedAt: CacheTime),
                WidgetTestData.MakeVehicle(7, "Active", "VIN0000007"),
            },
            WidgetTestData.MakeState(7));

        var snapshot = await new CacheWidgetVehicleSource(cache, Json).GetPrimaryAsync();

        Assert.NotNull(snapshot);
        Assert.Equal(7, snapshot!.VehicleId);
        Assert.Equal("Active", snapshot.DisplayName);
    }

    [Fact]
    public async Task Missing_cache_returns_null()
    {
        var snapshot = await new CacheWidgetVehicleSource(new FakeCacheStore(), Json).GetPrimaryAsync();

        Assert.Null(snapshot);
    }

    [Fact]
    public async Task Live_receive_time_supersedes_cache_age()
    {
        var liveTime = CacheTime.AddHours(1);
        var cache = new FakeCacheStore();
        await SeedAsync(cache, new[] { WidgetTestData.MakeVehicle(7, "Model 3", "VIN0000007") }, WidgetTestData.MakeState(7));

        var live = new LiveSignalStore(() => liveTime);
        live.Apply(new LiveEvent.Signal(
            new SignalEnvelope(7, "battery_level", SignalKind.Int, new SignalValue.Number(64), "2026-06-06T14:00:00Z"),
            null));

        var snapshot = await new CacheWidgetVehicleSource(cache, Json, live).GetAsync(7);

        Assert.NotNull(snapshot);
        Assert.Equal(liveTime, snapshot!.ObservedAt);
    }
}

/// <summary>An in-memory <see cref="ICacheStore"/> for the widget source tests (no SQLite dependency).</summary>
internal sealed class FakeCacheStore : ICacheStore
{
    private readonly Dictionary<string, CacheEntry> _rows = new(StringComparer.Ordinal);

    public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task<CacheEntry?> ReadAsync(string key, CancellationToken cancellationToken = default) =>
        Task.FromResult(_rows.TryGetValue(key, out var entry) ? entry : null);

    public Task WriteAsync(string key, string payload, DateTimeOffset fetchedAt, CancellationToken cancellationToken = default)
    {
        _rows[key] = new CacheEntry(key, payload, fetchedAt);
        return Task.CompletedTask;
    }

    public Task<bool> RemoveAsync(string key, CancellationToken cancellationToken = default) =>
        Task.FromResult(_rows.Remove(key));

    public Task<int> CountAsync(CancellationToken cancellationToken = default) => Task.FromResult(_rows.Count);

    public Task<int> EvictAsync(CancellationToken cancellationToken = default) => Task.FromResult(0);

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        _rows.Clear();
        return Task.CompletedTask;
    }
}
