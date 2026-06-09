using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="TimeToChargeSectionViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed charging-session lists — the native analogue of the web
/// Charging-Curve page's <c>useChargingSessionsPaginated</c> query whose result the web
/// <c>TimeToChargeSection</c> consumes as its <c>sessions</c> prop
/// (web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx). The view never performs
/// HTTP itself; the concrete <see cref="TimeToChargeSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface ITimeToChargeSource
{
    /// <summary>Stream the cache-then-network charging-session snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ITimeToChargeSource"/> — the native data adapter for the Time-to-Charge
/// surface. It runs one cache-then-network read of the charging-sessions list (generated operation
/// <c>get_api_v1_charging_sessions</c>), optionally scoped to one vehicle (web parity: the Charging-Curve
/// page scopes its query to the active vehicle; a null id reads the whole fleet's sessions, matching the
/// shared <see cref="TeslaSync.App.Core.Data.Repositories.ChargingRepository"/>), caching the raw JSON so the
/// snake_case wire shape round-trips losslessly, and parses each emission into
/// <see cref="TimeToChargeSessionRow"/> rows via <see cref="TimeToChargeResultMapper"/>. No HTTP touches the
/// view.
/// </summary>
public sealed class TimeToChargeSectionSource : ITimeToChargeSource
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the contract client, engine, JSON settings and optional vehicle scope.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id to scope the read to; null reads all sessions.</param>
    public TimeToChargeSectionSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = _vehicleId is { } vid
            ? new ApiRequest(
                Operations.Charging.Sessions,
                Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = vid })
            : new ApiRequest(Operations.Charging.Sessions);

        string cacheKey = _vehicleId is { } v
            ? string.Create(CultureInfo.InvariantCulture, $"charging:sessions:{v}:time-to-charge")
            : "charging:sessions:time-to-charge";

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TimeToChargeResultMapper.Map(emission);
        }
    }

    // The charging-sessions endpoint returns a JSON array; a null body or an empty array carries no sessions.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
