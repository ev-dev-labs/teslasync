using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The repository-backed <see cref="IGlanceVehiclesSource"/> — the native data adapter for the glance page's
/// <c>useVehicles</c> read. It runs one cache-then-network read of <c>GET /vehicles</c> (generated operation
/// <c>get_api_v1_vehicles</c>, <see cref="Operations.Vehicles.List"/>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON under the shared <c>vehicles:list</c> key so the
/// snake_case wire shape round-trips losslessly, and resolves <c>vehicleId ?? vehicles?.[0]</c> through
/// <see cref="GlanceVehicle.Resolve(JsonElement, long?)"/>. A response that resolves no vehicle collapses to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web <c>!vehicle</c> empty surface. No HTTP touches the view.
/// </summary>
public sealed class GlanceVehiclesSource : IGlanceVehiclesSource
{
    private const string VehiclesListKey = "vehicles:list";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the contract client, engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id (web <c>?vehicle_id=</c>); when null the first listed vehicle is used.</param>
    public GlanceVehiclesSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
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
    public async IAsyncEnumerable<RepositoryResult<GlanceVehicle>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(Operations.Vehicles.List);

        var raw = _engine.StreamAsync<JsonElement>(
            VehiclesListKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return GlanceResultMapper.Map(emission, root => GlanceVehicle.Resolve(root, _vehicleId));
        }
    }

    // Web parity: with no resolvable vehicle the page short-circuits to "No vehicle found".
    private bool IsEmpty(JsonElement vehicles) => GlanceVehicle.Resolve(vehicles, _vehicleId) is null;
}

/// <summary>
/// The repository-backed <see cref="IGlanceVehicleStateSource"/> — the native data adapter for the glance page's
/// <c>useVehicleState</c> read. It runs one cache-then-network read of <c>GET /vehicles/{vehicleID}/state</c>
/// (generated operation <c>get_api_v1_vehicles_vehicleID_state</c>, <see cref="Operations.Vehicles.State"/>) through
/// the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, and parses each emission into a <see cref="GlanceVehicleState"/>. No HTTP touches the view.
/// </summary>
public sealed class GlanceVehicleStateSource : IGlanceVehicleStateSource
{
    private const string VehiclePathParam = "vehicleID";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, engine and JSON settings.</summary>
    public GlanceVehicleStateSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<GlanceVehicleState>> StreamAsync(
        long vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vehicleId}:state");
        var request = new ApiRequest(
            Operations.Vehicles.State,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return GlanceResultMapper.Map(emission, GlanceVehicleState.FromResponse);
        }
    }

    // Web parity: an absent/stateless body collapses to the empty surface (web `state` undefined).
    private static bool IsEmpty(JsonElement element) => GlanceVehicleState.FromResponse(element) is null;
}

/// <summary>
/// The repository-backed <see cref="IGlanceLocationSource"/> — the native data adapter for the glance page's
/// <c>useLocationSnapshotLatest</c> read. It runs one cache-then-network read of
/// <c>GET /location-snapshots/latest?vehicle_id={id}</c> (generated operation
/// <c>get_api_v1_location_snapshots_latest</c>, <see cref="Operations.Locations.SnapshotLatest"/>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips losslessly,
/// and parses each emission into a <see cref="GlanceLocation"/>. No HTTP touches the view.
/// </summary>
public sealed class GlanceLocationSource : IGlanceLocationSource
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, engine and JSON settings.</summary>
    public GlanceLocationSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<GlanceLocation>> StreamAsync(
        long vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vehicleId}:location-snapshot-latest");
        var request = new ApiRequest(
            Operations.Locations.SnapshotLatest,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return GlanceResultMapper.Map(emission, GlanceLocation.FromResponse);
        }
    }

    // Web parity: a null/non-object body collapses to the "—" location label (web `!location`).
    private static bool IsEmpty(JsonElement element) => GlanceLocation.FromResponse(element) is null;
}

/// <summary>
/// The single real <see cref="IGlanceCommandSender"/> — the native data adapter for a glance quick-action command.
/// It POSTs <c>{ "command": "&lt;wire&gt;" }</c> to <c>/vehicles/{vehicleID}/command</c> (generated operation
/// <c>post_api_v1_vehicles_vehicleID_command</c>) through the shared contract client — the native analogue of the
/// web <c>useVehicleCommand</c> mutation's <c>request('/vehicles/{id}/command', { method: 'POST', body:
/// JSON.stringify({ command }) })</c>. The response's <c>success</c> flag (when present) classifies the outcome; a
/// thrown error is mapped through <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class GlanceVehicleCommandSender : IGlanceCommandSender
{
    // Generated operation id (asserted by the widget command tests) + its path parameter. Not in Operations.cs,
    // which catalogs only GET reads, so it is named locally exactly like the other write-path adapters.
    private const string CommandOperation = "post_api_v1_vehicles_vehicleID_command";
    private const string VehiclePathParam = "vehicleID";

    private readonly IApiClient _api;

    /// <summary>Creates the sender over the generated contract client.</summary>
    public GlanceVehicleCommandSender(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<GlanceCommandOutcome> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(command);

        var request = new ApiRequest(
            CommandOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            },
            Body: new CommandRequestBody(command));

        try
        {
            var response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseSuccess(response)
                ? GlanceCommandOutcome.Ok
                : GlanceCommandOutcome.Failure(new RepositoryError(RepositoryErrorKind.Server, "Command failed"));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return GlanceCommandOutcome.Failure(ApiErrorMapper.Map(ex));
        }
    }

    // Web parity: `data.success` drives the result. The backend returns { success, result | error }; a body with no
    // explicit `success` field is treated as accepted (the request returned 2xx without throwing).
    private static bool ParseSuccess(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("success", out var s))
        {
            return true;
        }

        return s.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when s.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(s.GetString(), out var b) && b,
            _ => true,
        };
    }

    // The POST body shape the Go handler decodes ({ command, params }); params is omitted (web sends undefined).
    private sealed record CommandRequestBody([property: JsonPropertyName("command")] string Command);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;T&gt;</c>, preserving every freshness flag (cached / refreshing / stale / offline). A
/// successful emission whose body parses to <see langword="null"/> collapses to <see cref="RepositoryResult{T}.Empty"/>
/// — the native analogue of the web optional-read empty branch. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class GlanceResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) with <paramref name="parse"/> while preserving its status.</summary>
    public static RepositoryResult<T> Map<T>(RepositoryResult<JsonElement> raw, Func<JsonElement, T?> parse)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(raw);
        ArgumentNullException.ThrowIfNull(parse);

        T? Parse() => raw.HasValue ? parse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<T>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<T>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<T>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<T>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<T>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<T>.Empty(raw.FetchedAt),
            _ => RepositoryResult<T>.Failure(raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
