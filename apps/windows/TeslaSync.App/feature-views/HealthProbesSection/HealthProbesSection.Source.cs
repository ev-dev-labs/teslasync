using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="HealthProbesSectionViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed <see cref="HealthProbesSnapshot"/> values — the native analogue
/// of the web component's single polled <c>useQuery(getExtendedHealth)</c>
/// (web/src/features/system/components/status/HealthProbesSection.tsx). The view never performs HTTP itself;
/// the concrete <see cref="HealthProbesSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface IHealthProbesSectionSource
{
    /// <summary>Stream the cache-then-network system-health snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<HealthProbesSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IHealthProbesSectionSource"/> — the native data adapter for the Health
/// Probes Section surface. It is the native analogue of the web component's single
/// <c>useQuery(getExtendedHealth)</c> hook: one cache-then-network read of <c>GET /system/health</c> (generated
/// operation <see cref="Operations.SystemAdmin.Health"/>, the web <c>getExtendedHealth</c> call) through the
/// shared <see cref="CacheThenNetworkEngine"/>, with each raw body parsed into a
/// <see cref="HealthProbesSnapshot"/> via <see cref="HealthProbesResultMapper"/>. The raw JSON is cached under a
/// surface-private key so the whole section restores instantly and never collides with the sibling
/// system-health readers (the Uptime Monitor / System Health widgets cache a different shape under their own
/// keys). A non-object body is reported empty so the view renders the friendly empty surface rather than a
/// blank panel. No HTTP ever touches the view.
/// </summary>
public sealed class HealthProbesSectionSource : IHealthProbesSectionSource
{
    private static readonly ApiRequest HealthRequest = new(Operations.SystemAdmin.Health);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public HealthProbesSectionSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<HealthProbesSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            HealthProbesSectionRegistration.CacheKey,
            FetchAsync,
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return HealthProbesResultMapper.Map(emission);
        }
    }

    private async Task<JsonElement> FetchAsync(CancellationToken cancellationToken)
    {
        // Clone so the cached / yielded element survives the response document's disposal.
        var body = await _api.SendAsync<JsonElement>(HealthRequest, cancellationToken).ConfigureAwait(false);
        return body.Clone();
    }

    // Web parity: the section shows the probe cards whenever the query resolves with a body; a non-object body
    // (a JSON null / 204) carries no health, so it is reported empty and the view renders the empty surface.
    private static bool IsEmptyResponse(JsonElement element) => !HealthProbesSnapshot.FromJson(element).HasData;
}
