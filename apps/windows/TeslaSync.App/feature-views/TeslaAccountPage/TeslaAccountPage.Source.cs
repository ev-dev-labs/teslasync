using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The data port the <see cref="TeslaAccountPageViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the two operations the web page composes through its hooks: a cache-then-network read of the Tesla account
/// profile (web <c>useTeslaUserProfile</c> → <c>GET /tesla/user/profile</c>) and the "Refresh from Tesla"
/// mutation (web <c>useRefreshTeslaProfile</c> → <c>POST /tesla/user/profile/refresh</c>). The view never
/// performs HTTP itself; the concrete <see cref="TeslaAccountSource"/> (or a test fake) drives this.
/// </summary>
public interface ITeslaAccountSource
{
    /// <summary>Stream the cache-then-network profile snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<TeslaProfile>> StreamProfileAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Ask the server to re-pull the profile from Tesla (web POST <c>/tesla/user/profile/refresh</c>). Returns
    /// a classified <see cref="TeslaProfileRefreshOutcome"/> — it never throws for an HTTP fault (web parity:
    /// the mutation resolves to a toast). The caller re-reads the profile afterwards to reflect the
    /// authoritative state (web <c>invalidateQueries</c> → refetch).
    /// </summary>
    Task<TeslaProfileRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ITeslaAccountSource"/> — the native data adapter for the Tesla Account
/// surface. The profile read runs one cache-then-network stream through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case envelope shape round-trips
/// losslessly, then maps each emission to a typed <see cref="TeslaProfile"/> result via
/// <see cref="TeslaProfileResultMapper"/> (generated operation <c>get_api_v1_tesla_user_profile</c>). The
/// refresh mutation posts the generated refresh operation (<c>post_api_v1_tesla_user_profile_refresh</c>) and
/// classifies any fault through the shared <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class TeslaAccountSource : ITeslaAccountSource
{
    /// <summary>The generated OpenAPI operation id for the profile read.</summary>
    public const string ProfileOperation = "get_api_v1_tesla_user_profile";

    /// <summary>The generated OpenAPI operation id for the profile refresh mutation.</summary>
    public const string RefreshOperation = "post_api_v1_tesla_user_profile_refresh";

    private const string CacheKey = "tesla:user:profile";

    private static readonly ApiRequest ProfileRequest = new(ProfileOperation);
    private static readonly ApiRequest RefreshRequest = new(RefreshOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public TeslaAccountSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<TeslaProfile>> StreamProfileAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(ProfileRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TeslaProfileResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task<TeslaProfileRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await _api.SendAsync<JsonElement>(RefreshRequest, cancellationToken).ConfigureAwait(false);
            return TeslaProfileRefreshOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return TeslaProfileRefreshOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return TeslaProfileRefreshOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    // The envelope always carries a `profile` object (or null) + `fetched_at`; it is "empty" (web parity: the
    // else branch renders the EmptyState) when no profile object is present. A non-object body is empty too.
    private static bool IsEmptyResponse(JsonElement element) => !TeslaProfile.FromJson(element).HasProfile;
}
