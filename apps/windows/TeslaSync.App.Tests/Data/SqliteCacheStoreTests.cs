using TeslaSync.App.Core.Data.Cache;
using Xunit;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// Verifies the SQLite cache store: fetched_at stamping, insert-or-replace, removal,
/// counting, bounded oldest-first eviction and clearing. Each test uses a private
/// temp-file database that is deleted on dispose.
/// </summary>
public sealed class SqliteCacheStoreTests : IAsyncLifetime
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"tscache-{Guid.NewGuid():N}.db");
    private SqliteCacheStore _store = null!;

    public async Task InitializeAsync()
    {
        _store = new SqliteCacheStore(new CacheOptions { ConnectionString = $"Data Source={_dbPath}", MaxEntries = 3 });
        await _store.InitializeAsync();
    }

    public async Task DisposeAsync()
    {
        await _store.DisposeAsync();
        TryDelete(_dbPath);
    }

    [Fact]
    public async Task Write_then_read_round_trips_payload_and_fetched_at()
    {
        var stamp = DateTimeOffset.UtcNow.AddMinutes(-1);
        await _store.WriteAsync("vehicles:list", "[1,2,3]", stamp);

        var entry = await _store.ReadAsync("vehicles:list");

        Assert.NotNull(entry);
        Assert.Equal("vehicles:list", entry!.Key);
        Assert.Equal("[1,2,3]", entry.Payload);
        // Stored as Unix milliseconds, so compare at ms resolution.
        Assert.Equal(stamp.ToUnixTimeMilliseconds(), entry.FetchedAt.ToUnixTimeMilliseconds());
    }

    [Fact]
    public async Task Read_missing_key_returns_null()
    {
        Assert.Null(await _store.ReadAsync("nope"));
    }

    [Fact]
    public async Task Write_same_key_replaces_payload()
    {
        await _store.WriteAsync("k", "old", DateTimeOffset.UtcNow.AddMinutes(-5));
        await _store.WriteAsync("k", "new", DateTimeOffset.UtcNow);

        var entry = await _store.ReadAsync("k");
        Assert.Equal("new", entry!.Payload);
        Assert.Equal(1, await _store.CountAsync());
    }

    [Fact]
    public async Task Remove_deletes_row()
    {
        await _store.WriteAsync("k", "v", DateTimeOffset.UtcNow);
        Assert.True(await _store.RemoveAsync("k"));
        Assert.False(await _store.RemoveAsync("k"));
        Assert.Null(await _store.ReadAsync("k"));
    }

    [Fact]
    public async Task Evict_removes_oldest_rows_beyond_the_bound()
    {
        var now = DateTimeOffset.UtcNow;
        await _store.WriteAsync("oldest", "1", now.AddMinutes(-30));
        await _store.WriteAsync("older", "2", now.AddMinutes(-20));
        await _store.WriteAsync("recent", "3", now.AddMinutes(-10));
        await _store.WriteAsync("newest", "4", now);

        var evicted = await _store.EvictAsync();

        Assert.Equal(1, evicted);
        Assert.Equal(3, await _store.CountAsync());
        Assert.Null(await _store.ReadAsync("oldest"));
        Assert.NotNull(await _store.ReadAsync("newest"));
    }

    [Fact]
    public async Task Clear_removes_everything()
    {
        await _store.WriteAsync("a", "1", DateTimeOffset.UtcNow);
        await _store.WriteAsync("b", "2", DateTimeOffset.UtcNow);
        await _store.ClearAsync();
        Assert.Equal(0, await _store.CountAsync());
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
            // Best-effort cleanup; the OS temp sweeper will reclaim it.
        }
    }
}
