using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data port the <see cref="ImpersonationBannerViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// two operations the web banner composes through its hooks: a cache-then-network read of the impersonation status
/// (web <c>useImpersonationStatus</c> → <c>GET /admin/impersonate/</c>, the source of the active claim, its subject
/// and its <c>expires_at</c>) and the idempotent end mutation (web <c>useEndImpersonation</c> →
/// <c>POST /admin/impersonate/end</c>). The view never performs HTTP itself; the concrete
/// <see cref="ImpersonationBannerSource"/> (or a test fake) drives this.
/// </summary>
public interface IImpersonationBannerSource
{
    /// <summary>Stream the cache-then-network impersonation status snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    IAsyncEnumerable<RepositoryResult<ImpersonationStatusSnapshot>> StreamStatusAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// End the current impersonation session (web <c>useEndImpersonation().mutate()</c>). The endpoint is
    /// idempotent — the backend returns <c>204</c> even when no claim is active — so it never throws for "nothing to
    /// end". Returns a successful outcome on a 2xx, or a classified error on an HTTP fault (web parity: the mutation
    /// resolves to a toast, not an unhandled rejection).
    /// </summary>
    /// <param name="cancellationToken">Cancels the in-flight mutation.</param>
    Task<ImpersonationEndOutcome> EndAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The outcome of an end-impersonation mutation (<c>POST /admin/impersonate/end</c>). On success the banner clears
/// its claim and disappears (web parity: <c>useEndImpersonation</c> primes the status cache with
/// <c>{ mode: 'inactive' }</c>); on failure it carries the privacy-safe <see cref="RepositoryError"/> and the banner
/// stays visible with its end button re-enabled.
/// </summary>
/// <param name="Success">Whether the end mutation succeeded.</param>
/// <param name="Error">The classified failure, when <paramref name="Success"/> is false.</param>
public sealed record ImpersonationEndOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful end.</summary>
    public static ImpersonationEndOutcome Ok() => new(true, null);

    /// <summary>A failed end carrying the classified error.</summary>
    public static ImpersonationEndOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>
/// The repository-backed <see cref="IImpersonationBannerSource"/> — the native data adapter for the impersonation
/// banner. The status read runs one cache-then-network stream through the shared
/// <see cref="CacheThenNetworkEngine"/> (sharing the <c>admin:impersonate:status</c> cache row with the sibling
/// impersonate-button surface so both read one cached status), caching the raw JSON so the snake_case wire shape
/// round-trips losslessly, then maps each emission to a typed <see cref="ImpersonationStatusSnapshot"/> via
/// <see cref="ImpersonationStatusResultMapper"/> (generated operation <c>get_api_v1_admin_impersonate</c>). The end
/// mutation posts to the dedicated end operation (<c>post_api_v1_admin_impersonate_end</c>) and classifies any fault
/// through the shared <see cref="ApiErrorMapper"/>. The end response is read as a nullable reference type so the
/// backend's empty <c>204</c> body resolves to success rather than a decode fault. No HTTP touches the view.
/// </summary>
public sealed class ImpersonationBannerSource : IImpersonationBannerSource
{
    /// <summary>The generated OpenAPI operation id for the impersonation status read.</summary>
    public const string StatusOperation = "get_api_v1_admin_impersonate";

    /// <summary>The generated OpenAPI operation id for the end-impersonation mutation.</summary>
    public const string EndOperation = "post_api_v1_admin_impersonate_end";

    private const string CacheKey = "admin:impersonate:status";

    private static readonly ApiRequest StatusRequest = new(StatusOperation);
    private static readonly ApiRequest EndRequest = new(EndOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (carries the JSON settings).</param>
    public ImpersonationBannerSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ImpersonationStatusSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(StatusRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ImpersonationStatusResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task<ImpersonationEndOutcome> EndAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            // The end endpoint returns 204 with no body; reading it as a nullable reference type yields null instead
            // of a decode fault, so a successful idempotent end is a success rather than an exception.
            await _api.SendAsync<JsonNode?>(EndRequest, cancellationToken).ConfigureAwait(false);
            return ImpersonationEndOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return ImpersonationEndOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return ImpersonationEndOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    // A null / non-object body carries no usable status (web parity: the query has no data → the banner stays
    // hidden). A valid object — including {"mode":"inactive"} — is NOT empty.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
