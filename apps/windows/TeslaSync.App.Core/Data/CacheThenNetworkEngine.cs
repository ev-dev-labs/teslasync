using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data;

/// <summary>
/// The cache-then-network read engine (ADR-013) shared by every repository. For one
/// logical read it emits a short sequence of <see cref="RepositoryResult{T}"/> snapshots:
/// <list type="number">
///   <item><see cref="RepositoryResult{T}.Loading"/> immediately.</item>
///   <item>If a cached payload exists, <see cref="RepositoryResult{T}.Cached"/> (flagged
///         stale past the freshness window) so the UI shows content at once.</item>
///   <item>Then the network result: <see cref="RepositoryResult{T}.Loaded"/> /
///         <see cref="RepositoryResult{T}.Empty"/> on success (the payload is written to
///         the cache and bounded eviction runs), or — when the network fails and a cached
///         value exists — <see cref="RepositoryResult{T}.OfflineCached"/>, otherwise
///         <see cref="RepositoryResult{T}.Failure"/>.</item>
/// </list>
/// Corrupt cache rows are ignored rather than thrown. Cancellation propagates.
/// </summary>
public sealed class CacheThenNetworkEngine
{
    private readonly ICacheStore _cache;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the engine over a cache store and (optional) clock.</summary>
    public CacheThenNetworkEngine(ICacheStore cache, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(cache);
        _cache = cache;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <summary>
    /// Runs one cache-then-network read for <paramref name="cacheKey"/>, fetching fresh
    /// data via <paramref name="fetch"/> and treating values for which
    /// <paramref name="isEmpty"/> is true as empty results.
    /// </summary>
    public async IAsyncEnumerable<RepositoryResult<T>> StreamAsync<T>(
        string cacheKey,
        Func<CancellationToken, Task<T>> fetch,
        Func<T, bool> isEmpty,
        JsonSerializerOptions json,
        int staleSeconds = CacheFreshness.LiveStaleSeconds,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(cacheKey);
        ArgumentNullException.ThrowIfNull(fetch);
        ArgumentNullException.ThrowIfNull(isEmpty);
        ArgumentNullException.ThrowIfNull(json);

        yield return RepositoryResult<T>.Loading();

        var (cachedValue, cachedAt) = await ReadCacheAsync<T>(cacheKey, json, cancellationToken).ConfigureAwait(false);
        if (cachedValue is not null && cachedAt is { } at)
        {
            var stale = CacheFreshness.IsStale(at, _clock(), staleSeconds);
            yield return RepositoryResult<T>.Cached(cachedValue, at, stale);
        }

        var terminal = await FetchAsync(cacheKey, fetch, isEmpty, json, cachedValue, cachedAt, cancellationToken)
            .ConfigureAwait(false);
        yield return terminal;
    }

    private async Task<RepositoryResult<T>> FetchAsync<T>(
        string cacheKey,
        Func<CancellationToken, Task<T>> fetch,
        Func<T, bool> isEmpty,
        JsonSerializerOptions json,
        T? cachedValue,
        DateTimeOffset? cachedAt,
        CancellationToken cancellationToken)
    {
        try
        {
            var fresh = await fetch(cancellationToken).ConfigureAwait(false);
            var now = _clock();
            var payload = JsonSerializer.Serialize(fresh, json);
            await _cache.WriteAsync(cacheKey, payload, now, cancellationToken).ConfigureAwait(false);
            await _cache.EvictAsync(cancellationToken).ConfigureAwait(false);
            return isEmpty(fresh)
                ? RepositoryResult<T>.Empty(now)
                : RepositoryResult<T>.Loaded(fresh, now);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var error = ApiErrorMapper.Map(ex);
            if (cachedValue is not null && cachedAt is { } at)
            {
                return RepositoryResult<T>.OfflineCached(cachedValue, at, error);
            }

            return RepositoryResult<T>.Failure(error);
        }
    }

    private async Task<(T? Value, DateTimeOffset? FetchedAt)> ReadCacheAsync<T>(
        string cacheKey,
        JsonSerializerOptions json,
        CancellationToken cancellationToken)
    {
        var entry = await _cache.ReadAsync(cacheKey, cancellationToken).ConfigureAwait(false);
        if (entry is null)
        {
            return (default, null);
        }

        try
        {
            var value = JsonSerializer.Deserialize<T>(entry.Payload, json);
            return value is null ? (default, null) : (value, entry.FetchedAt);
        }
        catch (JsonException)
        {
            // A corrupt or schema-drifted cache row is treated as a miss.
            return (default, null);
        }
    }
}
