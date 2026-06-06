namespace TeslaSync.App.Core.Data.Cache;

/// <summary>
/// The durable cache-then-network store (ADR-013). Implemented over SQLite by
/// <see cref="SqliteCacheStore"/>. Implementations must be safe to call concurrently,
/// must stamp every write with a <c>fetched_at</c> time, and must never persist token
/// or credential material.
/// </summary>
public interface ICacheStore
{
    /// <summary>Creates the schema if needed. Safe to call repeatedly.</summary>
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>Reads the cached entry for <paramref name="key"/>, or <see langword="null"/>.</summary>
    Task<CacheEntry?> ReadAsync(string key, CancellationToken cancellationToken = default);

    /// <summary>Inserts or replaces the payload for <paramref name="key"/>, stamping <paramref name="fetchedAt"/>.</summary>
    Task WriteAsync(string key, string payload, DateTimeOffset fetchedAt, CancellationToken cancellationToken = default);

    /// <summary>Removes the entry for <paramref name="key"/>. Returns <see langword="true"/> if a row was deleted.</summary>
    Task<bool> RemoveAsync(string key, CancellationToken cancellationToken = default);

    /// <summary>The current number of cached rows.</summary>
    Task<int> CountAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Enforces the configured bound by deleting the oldest rows (by <c>fetched_at</c>)
    /// until the row count is within the limit. Returns the number of rows evicted.
    /// </summary>
    Task<int> EvictAsync(CancellationToken cancellationToken = default);

    /// <summary>Removes every cached row (e.g. on sign-out).</summary>
    Task ClearAsync(CancellationToken cancellationToken = default);
}
