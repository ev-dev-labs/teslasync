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
/// The repository-backed <see cref="ISignalLogSource"/> — the native data adapter for the Signal Log
/// feed. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the
/// native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then performs the
/// single cache-then-network read of <c>GET /signals/observations?vehicle_id={id}&amp;limit=20</c>
/// (generated operation <c>get_api_v1_signals_observations</c>) — the web <c>useSignalObservations</c>
/// query that drives the feed and the freshness / error chrome. Each emission is parsed through
/// <see cref="SignalLogResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query (<c>enabled: !!vehicleId</c>).
/// No HTTP touches the view.
/// </summary>
public sealed class SignalLogSource : ISignalLogSource
{
    private const string ObservationsOperation = "get_api_v1_signals_observations";
    private const int ObservationLimit = 20;

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public SignalLogSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalLogObservation>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useSignalObservations query is disabled and `data` is undefined.
            yield return RepositoryResult<IReadOnlyList<SignalLogObservation>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"signals:observations:{vid}:limit:{ObservationLimit}");
        var request = new ApiRequest(
            ObservationsOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["vehicle_id"] = vid,
                ["limit"] = ObservationLimit,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SignalLogResultMapper.Map(emission);
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

    // Web parity: an absent / empty observations array collapses to the feed's empty state.
    private static bool IsEmptyResponse(JsonElement element) => SignalLogObservation.ParseEnvelope(element).Count == 0;
}

/// <summary>
/// The repository-backed <see cref="ISignalRateSource"/> — the native data adapter for the compact
/// view's signals/second readout. It runs one cache-then-network read of <c>GET /telemetry/</c>
/// (generated operation <c>get_api_v1_telemetry</c>) through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and aggregates each emission
/// into the fleet-wide rate via <see cref="SignalLogRate"/> — the web <c>useMQTTStatus</c> + <c>rate</c>
/// memo. No HTTP touches the view.
/// </summary>
public sealed class SignalRateSource : ISignalRateSource
{
    private const string TelemetryOperation = "get_api_v1_telemetry";
    private const string CacheKey = "telemetry:status";
    private static readonly ApiRequest TelemetryRequest = new(TelemetryOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public SignalRateSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<double>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(TelemetryRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SignalLogRate.Map(emission);
        }
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        _ => false,
    };
}
