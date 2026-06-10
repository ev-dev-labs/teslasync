using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="PrivacySectionViewModel"/> binds to for the deployment-wide cookie-consent
/// requirement (P1/S8 state-holder seam) — the native analogue of the web <c>useVersionInfo</c> query the
/// privacy surface reads <c>require_cookie_consent</c> from
/// (web/src/features/settings/components/PrivacySection.tsx). It yields the cache-then-network sequence of the
/// boolean requirement flag. The view never performs HTTP itself; the concrete
/// <see cref="ConsentRequirementSource"/> (or a test fake) drives this.
/// </summary>
public interface IConsentRequirementSource
{
    /// <summary>Stream the cache-then-network <c>require_cookie_consent</c> readings, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<bool>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IConsentRequirementSource"/> — the native data adapter for the privacy
/// surface's consent-requirement read. It runs one cache-then-network stream of the server version rollup
/// (<c>GET /system/version</c>, generated operation <c>get_api_v1_system_version</c>, the web
/// <c>useVersionInfo</c> query) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON
/// so the snake_case wire shape round-trips losslessly, then projects each emission to the
/// <c>require_cookie_consent</c> boolean via <see cref="ConsentRequirementResultMapper"/>. The endpoint is not
/// vehicle-scoped, so no vehicle resolution is required. No HTTP touches the view.
/// </summary>
public sealed class ConsentRequirementSource : IConsentRequirementSource
{
    // Shares the version cache key with the VersionInfo surface: both read GET /system/version, so a single
    // cached body serves every consumer (web parity: useVersionInfo is one shared query).
    private const string CacheKey = "system:version";

    private static readonly ApiRequest VersionRequest = new(Operations.SystemAdmin.Version);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public ConsentRequirementSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<bool>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(VersionRequest, ct),
            IsEmptyBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ConsentRequirementResultMapper.Map(emission);
        }
    }

    // Web parity: only an absent / null body counts as empty. A populated object that omits
    // require_cookie_consent is NOT empty — it reads as false (Boolean(undefined)), i.e. the "preview" body.
    private static bool IsEmptyBody(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
}
