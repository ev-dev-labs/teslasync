using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The generated-client-backed <see cref="IEnergyStatsSource"/> — the native data adapter for the Energy page's
/// energy-stats read and the C# port of the web <c>useEnergyStats</c> hook composition
/// (web/src/api/hooks/useEnergy.ts + web/src/hooks/useSelectedVehicle.ts). It resolves the scoped (or primary)
/// vehicle from the shared <see cref="IWidgetVehicleSource"/> — the native analogue of the page's
/// <c>useSelectedVehicle()</c> — then runs one cache-then-network read of
/// <c>GET /vehicles/{vehicleID}/energy?days=30</c> (generated operation
/// <c>get_api_v1_vehicles_vehicleID_energy</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching
/// the raw JSON so the snake_case wire shape round-trips losslessly, and parsing each emission into an
/// <see cref="EnergyStats"/> via <see cref="EnergyResultMapper"/>. When no vehicle is available the read
/// short-circuits to <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's disabled query
/// (<c>enabled: vehicleId !== null</c>). No HTTP touches the view.
/// </summary>
public sealed class EnergyStatsClientSource : IEnergyStatsSource
{
    private const string VehiclePathParam = "vehicleID";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    public EnergyStatsClientSource(
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
    public async IAsyncEnumerable<RepositoryResult<EnergyStats>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await EnergyVehicleScope.ResolveAsync(_vehicles, _vehicleId, cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            yield return RepositoryResult<EnergyStats>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"energy:stats:{vid}:{EnergyProjection.WindowDays}");
        var request = new ApiRequest(
            Operations.Vehicles.Energy,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            },
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["days"] = EnergyProjection.WindowDays,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            EnergyEmptiness.IsEmptyObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return EnergyResultMapper.MapStats(emission);
        }
    }
}

/// <summary>
/// The generated-client-backed <see cref="IChargingSessionsSource"/> — the native data adapter for the Energy
/// page's charging-sessions read and the C# port of the web <c>useChargingSessionsPaginated</c> hook. It
/// resolves the scoped (or primary) vehicle, then runs one cache-then-network read of
/// <c>GET /charging-sessions?vehicle_id=…&amp;limit=100&amp;offset=0&amp;start=…&amp;end=…</c> (generated operation
/// <c>get_api_v1_charging_sessions</c>) over the rolling <see cref="EnergyProjection.WindowDays"/> window,
/// passing the snake_case query parameters exactly as the web hook does, and parsing each emission into a
/// charging-session list via <see cref="EnergyResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class ChargingSessionsClientSource : IChargingSessionsSource
{
    private const int SessionLimit = 100;

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the source over the vehicle source, contract client, engine, JSON settings and clock.</summary>
    public ChargingSessionsClientSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null,
        Func<DateTimeOffset>? clock = null)
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
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<EnergyChargingSession>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await EnergyVehicleScope.ResolveAsync(_vehicles, _vehicleId, cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            yield return RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Empty();
            yield break;
        }

        DateTimeOffset now = _clock();
        string end = now.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string start = now.UtcDateTime.AddDays(-EnergyProjection.WindowDays).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"energy:sessions:{vid}:{start}:{end}:{SessionLimit}");
        var request = new ApiRequest(
            Operations.Charging.Sessions,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["vehicle_id"] = vid,
                ["limit"] = SessionLimit,
                ["offset"] = 0,
                ["start"] = start,
                ["end"] = end,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            EnergyEmptiness.IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return EnergyResultMapper.MapSessions(emission);
        }
    }
}

/// <summary>
/// The generated-client-backed <see cref="IChargingTelemetryLatestSource"/> — the native data adapter for the
/// Energy page's lifetime-energy read and the C# port of the web <c>useChargingTelemetryLatest</c> hook. It
/// resolves the scoped (or primary) vehicle, then runs one cache-then-network read of
/// <c>GET /charging-telemetry/latest?vehicle_id=…</c> (generated operation
/// <c>get_api_v1_charging_telemetry_latest</c>) and parses each emission into an <see cref="EnergyLiveCharging"/>
/// via <see cref="EnergyResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class ChargingTelemetryLatestClientSource : IChargingTelemetryLatestSource
{
    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    public ChargingTelemetryLatestClientSource(
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
    public async IAsyncEnumerable<RepositoryResult<EnergyLiveCharging>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await EnergyVehicleScope.ResolveAsync(_vehicles, _vehicleId, cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            yield return RepositoryResult<EnergyLiveCharging>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"energy:live:{vid}");
        var request = new ApiRequest(
            Operations.Charging.TelemetryLatest,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["vehicle_id"] = vid,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            EnergyEmptiness.IsEmptyObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return EnergyResultMapper.MapLive(emission);
        }
    }
}

/// <summary>Resolves the vehicle the Energy reads scope to — an explicit id, else the cached primary vehicle.</summary>
internal static class EnergyVehicleScope
{
    public static async Task<long?> ResolveAsync(IWidgetVehicleSource vehicles, long? explicitId, CancellationToken cancellationToken)
    {
        if (explicitId is { } id)
        {
            return id;
        }

        var primary = await vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }
}

/// <summary>Cache-then-network emptiness predicates shared by the three Energy sources.</summary>
internal static class EnergyEmptiness
{
    /// <summary>True for a null / undefined / property-less object response (web "no data" body).</summary>
    public static bool IsEmptyObject(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };

    /// <summary>True for a null response or an empty session array (web <c>safeArray</c> with no rows).</summary>
    public static bool IsEmptyArray(JsonElement element)
    {
        if (element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return true;
        }

        var arr = element;
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                arr = data;
            }
            else if (element.TryGetProperty("sessions", out var sessions) && sessions.ValueKind == JsonValueKind.Array)
            {
                arr = sessions;
            }
            else
            {
                return !element.EnumerateObject().MoveNext();
            }
        }

        return arr.ValueKind == JsonValueKind.Array && arr.GetArrayLength() == 0;
    }
}
