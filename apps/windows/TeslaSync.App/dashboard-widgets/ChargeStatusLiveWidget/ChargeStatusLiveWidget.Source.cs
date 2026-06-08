using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IChargeStatusLiveSource"/> — the native data adapter for the Charge Status
/// Live surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the
/// native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then composes the web's two
/// queries:
/// <list type="number">
///   <item>One best-effort cache-then-network read of the newest charging session (generated operation
///         <c>get_api_v1_charging_sessions</c>, scoped by <c>vehicle_id</c>) — the web
///         <c>useChargingSessionsPaginated(id, { limit: 1 })</c> first row. This supplements the live state
///         with the "energy added" figure; any failure or empty result simply yields a <see langword="null"/>
///         session (the web <c>latestSession</c> being undefined), never failing the surface.</item>
///   <item>The primary cache-then-network read of <c>GET /vehicles/{vehicleID}/state</c> (generated operation
///         <c>get_api_v1_vehicles_vehicleID_state</c>) — the web <c>useVehicleState</c> query that drives the
///         charging metrics and the freshness/error chrome.</item>
/// </list>
/// Each state emission is combined with the resolved session via <see cref="ChargeStatusLiveResultMapper"/>.
/// When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring
/// the web hooks' disabled queries (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class ChargeStatusLiveSource : IChargeStatusLiveSource
{
    // Generated operation ids (TeslaSync.App.Core.Data.Net.Operations); asserted by the source tests.
    private const string StateOperation = "get_api_v1_vehicles_vehicleID_state";
    private const string VehiclePathParam = "vehicleID";
    private const string VehicleQueryParam = "vehicle_id";

    // Web parity: useChargingSessionsPaginated(id, { limit: 1 }) reads only the newest session.
    private const int SessionLimit = 1;

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public ChargeStatusLiveSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _vehicles = vehicles;
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ChargeStatusLiveSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useVehicleState query is disabled and `state` is undefined.
            yield return RepositoryResult<ChargeStatusLiveSnapshot>.Empty();
            yield break;
        }

        // Resolve the newest charging session first (best-effort; supplementary, never fails the surface).
        var session = await ResolveLatestSessionAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:charge-status-live");
        var request = new ApiRequest(
            StateOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyState,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ChargeStatusLiveResultMapper.Map(emission, session);
        }
    }

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    /// <summary>
    /// Drain a best-effort cache-then-network read of the newest charging session, returning the freshest
    /// available row or <see langword="null"/>. The session is supplementary (web <c>latestSession</c>), so any
    /// network/parse failure or empty result collapses to <see langword="null"/> rather than propagating —
    /// cancellation still propagates so a superseded load is dropped.
    /// </summary>
    private async Task<ChargeStatusLiveSession?> ResolveLatestSessionAsync(long vid, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charging:{vid}:charge-status-live");
        var request = new ApiRequest(
            Operations.Charging.Sessions,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
                ["limit"] = SessionLimit,
            });

        ChargeStatusLiveSession? latest = null;
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptySessions,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                if (emission.HasValue && ChargeStatusLiveSession.ParseLatest(emission.Value) is { } parsed)
                {
                    latest = parsed;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: the session is supplementary, so a failure leaves the live state intact (web
            // `latestSession` undefined → energy added defaults to 0, no "Last Session" line).
        }

        return latest;
    }

    // Web parity: an absent/stateless body collapses to the empty surface (web `state` undefined).
    private static bool IsEmptyState(JsonElement element) => VehicleChargeState.FromResponse(element) is null;

    private static bool IsEmptySessions(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
