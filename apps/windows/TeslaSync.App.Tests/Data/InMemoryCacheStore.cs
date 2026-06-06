using System.Collections.Concurrent;
using TeslaSync.App.Core.Data.Cache;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// A trivial in-memory <see cref="ICacheStore"/> for engine/repository tests, so the
/// cache-then-network behavior can be asserted without touching disk. Supports the same
/// bounded oldest-first eviction contract as the SQLite store.
/// </summary>
internal sealed class InMemoryCacheStore : ICacheStore
{
    private readonly ConcurrentDictionary<string, CacheEntry> _entries = new(StringComparer.Ordinal);
    private readonly int _maxEntries;

    public InMemoryCacheStore(int maxEntries = 500) => _maxEntries = Math.Max(1, maxEntries);

    public int WriteCount { get; private set; }

    public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task<CacheEntry?> ReadAsync(string key, CancellationToken cancellationToken = default) =>
        Task.FromResult(_entries.TryGetValue(key, out var entry) ? entry : null);

    public Task WriteAsync(string key, string payload, DateTimeOffset fetchedAt, CancellationToken cancellationToken = default)
    {
        WriteCount++;
        _entries[key] = new CacheEntry(key, payload, fetchedAt);
        return Task.CompletedTask;
    }

    public Task<bool> RemoveAsync(string key, CancellationToken cancellationToken = default) =>
        Task.FromResult(_entries.TryRemove(key, out _));

    public Task<int> CountAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_entries.Count);

    public Task<int> EvictAsync(CancellationToken cancellationToken = default)
    {
        var evicted = 0;
        foreach (var stale in _entries.Values.OrderBy(e => e.FetchedAt).Take(Math.Max(0, _entries.Count - _maxEntries)).ToList())
        {
            if (_entries.TryRemove(stale.Key, out _))
            {
                evicted++;
            }
        }

        return Task.FromResult(evicted);
    }

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        _entries.Clear();
        return Task.CompletedTask;
    }

    public void Seed(string key, string payload, DateTimeOffset fetchedAt) =>
        _entries[key] = new CacheEntry(key, payload, fetchedAt);
}
