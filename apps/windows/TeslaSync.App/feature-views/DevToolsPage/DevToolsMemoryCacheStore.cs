using System.Collections.Concurrent;
using TeslaSync.App.Core.Data.Cache;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// A process-local, non-durable <see cref="ICacheStore"/> used to host the DevTools page's embedded
/// data surfaces (Fleet Telemetry health, Infrastructure tools) without provisioning the SQLite cache the
/// shell wires for live pages. It satisfies the cache-then-network contract — every write is stamped and
/// reads round-trip the payload — but holds nothing on disk and persists no credential material, so the
/// hosted sections render their honest loading / empty / error states when the API origin is unreachable.
/// This is the WinUI analogue of the web devtools sections mounting against the shared query client.
/// </summary>
internal sealed class DevToolsMemoryCacheStore : ICacheStore
{
    private readonly ConcurrentDictionary<string, CacheEntry> _entries = new(StringComparer.Ordinal);

    /// <inheritdoc />
    public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task<CacheEntry?> ReadAsync(string key, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        return Task.FromResult(_entries.TryGetValue(key, out var entry) ? entry : null);
    }

    /// <inheritdoc />
    public Task WriteAsync(string key, string payload, DateTimeOffset fetchedAt, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        _entries[key] = new CacheEntry(key, payload, fetchedAt);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task<bool> RemoveAsync(string key, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        return Task.FromResult(_entries.TryRemove(key, out _));
    }

    /// <inheritdoc />
    public Task<int> CountAsync(CancellationToken cancellationToken = default) => Task.FromResult(_entries.Count);

    /// <inheritdoc />
    public Task<int> EvictAsync(CancellationToken cancellationToken = default) => Task.FromResult(0);

    /// <inheritdoc />
    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        _entries.Clear();
        return Task.CompletedTask;
    }
}
