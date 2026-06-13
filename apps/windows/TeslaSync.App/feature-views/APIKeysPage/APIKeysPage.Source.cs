// Admin / API Keys page — data ports.
//
// The data seam the ApiKeysPageViewModel binds to (P1/S8 state-holder seam) plus
// the two concrete sources: the inert default the shell-registered page feeds the
// view-model (so it renders its own states without a live host), and the
// repository-backed adapter that drives the cache-then-network key read and the
// create / delete / revoke mutations through the generated contract client. The
// view never performs HTTP itself.
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The data port the <see cref="ApiKeysPageViewModel"/> binds to. It yields the cache-then-network key read the web
/// <c>useApiKeys()</c> composes (<c>GET /api-keys</c>) and exposes the three mutations the page invokes: create (web
/// <c>useCreateApiKey</c>), delete (web <c>useDeleteApiKey</c>) and revoke (web <c>useRevokeApiKey</c>). The view
/// never performs HTTP itself; the concrete <see cref="ApiKeysSource"/> (or a test fake) drives this.
/// </summary>
public interface IApiKeysSource
{
    /// <summary>Stream the cache-then-network key-list snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<ApiKeyList>> StreamApiKeysAsync(CancellationToken cancellationToken = default);

    /// <summary>Create (<c>POST /api-keys</c>) a key and return the one-time secret (web <c>useCreateApiKey</c>).</summary>
    Task<CreatedApiKey> CreateAsync(string name, string permissions, CancellationToken cancellationToken = default);

    /// <summary>Delete a key (<c>DELETE /api-keys/{id}</c>, web <c>useDeleteApiKey</c>).</summary>
    Task DeleteAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Revoke a key (<c>POST /api-keys/{id}/revoke</c>, web <c>useRevokeApiKey</c>).</summary>
    Task RevokeAsync(long id, CancellationToken cancellationToken = default);
}

/// <summary>
/// The default inert <see cref="IApiKeysSource"/> — yields a single empty key list and treats every mutation as a
/// no-op. It is the safe default the shell-registered <see cref="APIKeysPage"/> feeds the view-model until a host
/// wires the repository-backed <see cref="ApiKeysSource"/>, mirroring the empty-source default the other W7 pages
/// use. The page's own empty surface renders from the single <see cref="RepositoryResult{T}.Empty()"/> emission.
/// </summary>
public sealed class EmptyApiKeysSource : IApiKeysSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyApiKeysSource Instance { get; } = new();

    private EmptyApiKeysSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ApiKeyList>> StreamApiKeysAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<ApiKeyList>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task<CreatedApiKey> CreateAsync(string name, string permissions, CancellationToken cancellationToken = default) =>
        Task.FromResult(new CreatedApiKey(0, string.Empty, name, string.Empty, permissions));

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task RevokeAsync(long id, CancellationToken cancellationToken = default) => Task.CompletedTask;
}

/// <summary>
/// The repository-backed <see cref="IApiKeysSource"/> — the native data adapter for the API-keys surface. The read
/// replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/> (the raw <c>GET /api-keys</c>
/// array cached under <see cref="ApiKeysRegistration.CacheKey"/>, then mapped by <see cref="ApiKeyList.FromJson"/>);
/// the create / delete / revoke mutations go straight through the generated contract client. No HTTP touches the
/// view.
/// </summary>
public sealed class ApiKeysSource : IApiKeysSource
{
    private static readonly ApiRequest ListRequest = new(ApiKeysRegistration.ListOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public ApiKeysSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ApiKeyList>> StreamApiKeysAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            ApiKeysRegistration.CacheKey,
            ct => _api.SendAsync<JsonElement>(ListRequest, ct),
            IsEmptyApiKeys,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return MapApiKeys(emission);
        }
    }

    /// <inheritdoc />
    public async Task<CreatedApiKey> CreateAsync(string name, string permissions, CancellationToken cancellationToken = default)
    {
        var payload = new JsonObject
        {
            ["name"] = name,
            ["permissions"] = permissions,
        };

        var request = new ApiRequest(ApiKeysRegistration.CreateOperation, Body: payload);
        var response = await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);

        return response is { } value
            ? CreatedApiKey.FromJson(value)
            : new CreatedApiKey(0, string.Empty, name, string.Empty, permissions);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(ApiKeysRegistration.DeleteOperation, PathParams: PathFor(id));
        await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RevokeAsync(long id, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(ApiKeysRegistration.RevokeOperation, PathParams: PathFor(id));
        await _api.SendAsync<JsonElement?>(request, cancellationToken).ConfigureAwait(false);
    }

    private static Dictionary<string, string> PathFor(long id) =>
        new(StringComparer.Ordinal)
        {
            [ApiKeysRegistration.IdParam] = id.ToString(CultureInfo.InvariantCulture),
        };

    private static bool IsEmptyApiKeys(JsonElement element) =>
        element.ValueKind != JsonValueKind.Array || element.GetArrayLength() == 0;

    private static RepositoryResult<ApiKeyList> MapApiKeys(RepositoryResult<JsonElement> raw)
    {
        ApiKeyList Parse() => raw.HasValue ? ApiKeyList.FromJson(raw.Value) : ApiKeyList.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ApiKeyList>.Loading(),
            LoadStatus.Cached => RepositoryResult<ApiKeyList>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ApiKeyList>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<ApiKeyList>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<ApiKeyList>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<ApiKeyList>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<ApiKeyList>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
