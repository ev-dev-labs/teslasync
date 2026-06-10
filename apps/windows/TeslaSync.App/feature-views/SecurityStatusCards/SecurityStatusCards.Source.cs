using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="SecurityStatusCardsViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of <see cref="SecurityStatusCardsData"/> snapshots — the native analogue of
/// the <c>latest</c> security event the web Security &amp; Access page hands
/// <c>&lt;SecurityStatusCards /&gt;</c> (web/src/features/admin/components/security-access/SecurityStatusCards.tsx).
/// The view never performs HTTP itself; the concrete <see cref="SecurityStatusCardsSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface ISecurityStatusCardsSource
{
    /// <summary>Stream the cache-then-network security snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<SecurityStatusCardsData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISecurityStatusCardsSource"/> — the native data adapter for the
/// Security-status cards. One logical read resolves the primary vehicle from <c>GET /vehicles</c> (exactly as
/// the web admin page scopes its security query to a vehicle) and then reads <c>GET /security/latest</c> for
/// that vehicle, which returns the forward-folded live security state as a snake_case object. The assembled
/// <see cref="SecurityStatusCardsData"/> is cached as JSON so the snapshot round-trips losslessly and the whole
/// read replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. No HTTP touches the
/// view.
/// </summary>
public sealed class SecurityStatusCardsSource : ISecurityStatusCardsSource
{
    // The /security/latest OpenAPI operation id (internal/api/router.go -> "/security/latest"); the generated
    // endpoint table declares it as get_api_v1_security_latest.
    private const string SecurityLatestOperation = "get_api_v1_security_latest";
    private const string CacheKey = "admin:security-status-cards";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public SecurityStatusCardsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<SecurityStatusCardsData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<SecurityStatusCardsData>(
            CacheKey,
            FetchAsync,
            static data => !data.HasData,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<SecurityStatusCardsData> FetchAsync(CancellationToken cancellationToken)
    {
        // The web admin page reads /security/latest for a selected vehicle; the endpoint requires a vehicle_id,
        // so the roster is resolved first and the security read is scoped to the primary vehicle (vehicles[0]).
        var vehicles = await _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), cancellationToken)
            .ConfigureAwait(false);

        if (FirstVehicleId(vehicles) is not { } vehicleId)
        {
            return SecurityStatusCardsData.Empty;
        }

        var latest = await _api.SendAsync<JsonElement>(
            new ApiRequest(
                SecurityLatestOperation,
                Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = vehicleId }),
            cancellationToken).ConfigureAwait(false);

        return SecurityStatusCardsData.FromJson(latest);
    }

    // web: vehicles?.[0]?.id — the primary vehicle's database id, used as the security read's vehicle filter.
    private static long? FirstVehicleId(JsonElement vehicles)
    {
        if (vehicles.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var v in vehicles.EnumerateArray())
        {
            if (v.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (TryReadId(v, "id", out long id) || TryReadId(v, "vehicle_id", out id))
            {
                return id;
            }

            // Only the first roster entry is the primary; a malformed first row yields no primary.
            return null;
        }

        return null;
    }

    private static bool TryReadId(JsonElement obj, string name, out long id)
    {
        id = 0;
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out id) => true,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out id) => true,
            _ => false,
        };
    }
}
