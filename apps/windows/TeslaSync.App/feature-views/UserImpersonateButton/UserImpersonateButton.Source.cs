using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="UserImpersonateButtonViewModel"/> binds to (P1/S8 state-holder seam). It
/// exposes the two operations the web component composes through its hooks: a cache-then-network read of the
/// impersonation status (web <c>useImpersonationStatus</c> → <c>GET /admin/impersonate/</c>) and the
/// fire-once start mutation (web <c>useStartImpersonation</c> → <c>POST /admin/impersonate/</c>). The view
/// never performs HTTP itself; the concrete <see cref="ImpersonationSource"/> (or a test fake) drives this.
/// </summary>
public interface IImpersonationSource
{
    /// <summary>Stream the cache-then-network impersonation status snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<ImpersonationStatusSnapshot>> StreamStatusAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Start an impersonation session for <paramref name="subject"/> (the start mutation). The endpoint is
    /// sudo-gated upstream; the shared HTTP pipeline surfaces the re-auth challenge before the POST lands.
    /// Returns the new status on success, or a classified error on failure — it never throws for an HTTP
    /// fault (web parity: the mutation resolves to a toast, not an unhandled rejection).
    /// </summary>
    Task<ImpersonationStartOutcome> StartAsync(string subject, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IImpersonationSource"/> — the native data adapter for the impersonate
/// button. The status read runs one cache-then-network stream through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, then maps each emission to a typed <see cref="ImpersonationStatusSnapshot"/> via
/// <see cref="ImpersonationStatusResultMapper"/> (generated operation
/// <c>get_api_v1_admin_impersonate</c>). The start mutation posts the subject directly (generated operation
/// <c>post_api_v1_admin_impersonate</c>) and classifies any fault through the shared
/// <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class ImpersonationSource : IImpersonationSource
{
    /// <summary>The generated OpenAPI operation id for the impersonation status read.</summary>
    public const string StatusOperation = "get_api_v1_admin_impersonate";

    /// <summary>The generated OpenAPI operation id for the start-impersonation mutation.</summary>
    public const string StartOperation = "post_api_v1_admin_impersonate";

    private const string CacheKey = "admin:impersonate:status";

    private static readonly ApiRequest StatusRequest = new(StatusOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public ImpersonationSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
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
    public async Task<ImpersonationStartOutcome> StartAsync(
        string subject,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(subject);

        var request = new ApiRequest(StartOperation, Body: new StartImpersonationBody(subject));
        try
        {
            var element = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ImpersonationStartOutcome.Ok(ImpersonationStatusSnapshot.FromJson(element));
        }
        catch (ApiException ex)
        {
            return ImpersonationStartOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return ImpersonationStartOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    // A null / non-object body carries no usable status (web parity: the query has no data → the surface
    // shows its empty/unknown chrome). A valid object — including {"mode":"inactive"} — is NOT empty.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind != JsonValueKind.Object;

    /// <summary>The start-mutation request body. Serialised as <c>{"subject":"…"}</c> (web parity).</summary>
    private sealed record StartImpersonationBody(
        [property: JsonPropertyName("subject")] string Subject);
}
