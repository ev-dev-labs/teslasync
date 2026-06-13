using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The repository-backed <see cref="IArchivedContextSource"/> — the native data adapter for the Archived
/// notifications page's page-level context. One logical read assembles the web page's two hooks into a single
/// snapshot:
/// <list type="number">
///   <item>the vehicle roster from <c>GET /vehicles</c> (web <c>useVehicles</c>), projected to the
///         <c>vehicleMap</c>;</item>
///   <item>the alert-rule roster from <c>GET /alerts/rules</c> (web <c>useAlertRules</c>), projected to the
///         <c>ruleMap</c>.</item>
/// </list>
/// Neither read is vehicle-scoped, so no per-vehicle source is required. The assembled
/// <see cref="ArchivedContext"/> replays cache-then-network through the shared
/// <see cref="CacheThenNetworkEngine"/>; no HTTP touches the view.
/// </summary>
public sealed class ArchivedContextSource : IArchivedContextSource
{
    private static readonly ApiRequest VehiclesRequest = new(Operations.Vehicles.List);
    private static readonly ApiRequest RulesRequest = new(ArchivedRegistration.AlertRulesOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    public ArchivedContextSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ArchivedContext>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<ArchivedContext>(
            ArchivedRegistration.CacheKey,
            FetchAsync,
            static context => !context.HasData,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<ArchivedContext> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. Vehicle roster → the vehicle id → display-name map (web useVehicles, vehicleMap).
        var vehiclesJson = await _api.SendAsync<JsonElement>(VehiclesRequest, cancellationToken).ConfigureAwait(false);

        // 2. Alert-rule roster → the rule id → name map (web useAlertRules, ruleMap).
        var rulesJson = await _api.SendAsync<JsonElement>(RulesRequest, cancellationToken).ConfigureAwait(false);

        return ArchivedContext.FromResponses(vehiclesJson, rulesJson);
    }
}
