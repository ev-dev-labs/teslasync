using System.Text.Json;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>
/// Shared base for the cache-then-network repositories. It owns the
/// <see cref="IApiClient"/> (the generated contract client) and the
/// <see cref="CacheThenNetworkEngine"/>, and exposes a single <see cref="Stream{T}"/>
/// helper so each domain repository is a thin, declarative mapping from a cache key +
/// generated operation to a typed <see cref="RepositoryResult{T}"/> sequence.
/// </summary>
public abstract class RepositoryBase
{
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the base over the contract client, engine and JSON settings.</summary>
    protected RepositoryBase(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        Api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <summary>The generated contract client used to fetch fresh data.</summary>
    protected IApiClient Api { get; }

    /// <summary>Formats a numeric id as an invariant path-parameter string.</summary>
    protected static string Id(long value) =>
        value.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// Runs a cache-then-network read for <paramref name="cacheKey"/> against the
    /// endpoint described by <paramref name="request"/>, deserializing into
    /// <typeparamref name="T"/>.
    /// </summary>
    protected IAsyncEnumerable<RepositoryResult<T>> Stream<T>(
        string cacheKey,
        ApiRequest request,
        Func<T, bool>? isEmpty = null,
        int staleSeconds = CacheFreshness.LiveStaleSeconds,
        CancellationToken cancellationToken = default)
        => _engine.StreamAsync<T>(
            cacheKey,
            ct => Api.SendAsync<T>(request, ct),
            isEmpty ?? IsEmptyValue,
            _json,
            staleSeconds,
            cancellationToken);

    /// <summary>
    /// Default emptiness test: null, an empty collection, or an empty/null JSON element.
    /// </summary>
    protected static bool IsEmptyValue<T>(T value) => value switch
    {
        null => true,
        System.Collections.ICollection collection => collection.Count == 0,
        JsonElement element => IsEmptyJson(element),
        _ => false,
    };

    private static bool IsEmptyJson(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
