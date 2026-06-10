using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="AutopilotSectionViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed cruise/autopilot snapshots — the native analogue of the web
/// component's three live queries (<c>useVehicleState</c> for the current speed, plus the two
/// <c>useSignalObservations</c> cold-signal reads for the cruise set-speed and follow distance, see
/// web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx). The view never performs HTTP
/// itself; the concrete <see cref="AutopilotSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface IAutopilotSectionSource
{
    /// <summary>Stream the cache-then-network autopilot snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<AutopilotSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IAutopilotSectionSource"/> — the native data adapter for the Autopilot
/// Section surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId</c> prop), then runs one cache-then-network cycle
/// whose fetch fans out to the same three endpoints the web component reads:
/// <list type="bullet">
///   <item><c>GET /vehicles/{id}/state</c> (the current vehicle speed, web <c>useVehicleState</c> — the
///   dominant read whose failure surfaces the error/offline state);</item>
///   <item><c>GET /signals/observations?vehicle_id={id}&amp;field=CruiseSetSpeed&amp;limit=1</c> and</item>
///   <item><c>GET /signals/observations?vehicle_id={id}&amp;field=CruiseFollowDistance&amp;limit=1</c> (the two
///   cold-signal reads, web <c>useSignalObservations</c> — independently fault-tolerant, mirroring the web's
///   three separate queries: a failed observation just leaves that value absent).</item>
/// </list>
/// The three raw bodies are merged into a single JSON envelope so the snake_case wire shapes round-trip
/// losslessly through the SQLite cache, then each emission is parsed into an <see cref="AutopilotSnapshot"/>
/// via <see cref="AutopilotResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hooks' disabled queries
/// (<c>enabled: !!vehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class AutopilotSectionSource : IAutopilotSectionSource
{
    // The web reads /signals/observations; the generated endpoint table exposes this id but Operations.cs
    // carries no Signals.Observations entry yet, so it is referenced verbatim here (scoped to this surface),
    // exactly as the sibling LiveMotorStatusSource references get_api_v1_motor_latest. It resolves against
    // TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string ObservationsOperation = "get_api_v1_signals_observations";

    private const string VehicleQueryParam = "vehicle_id";
    private const string FieldQueryParam = "field";
    private const string LimitQueryParam = "limit";
    private const string VehiclePathParam = "vehicleID";

    // A standalone, reusable empty-observations body for the graceful-degradation path (a failed cold-signal
    // read). Cloned off a throwaway document so it survives that document's disposal.
    private static readonly JsonElement EmptyObservations = ParseEmptyObservations();

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
    /// <param name="vehicleId">An explicit vehicle id (the web <c>vehicleId</c> prop); when null the primary
    /// cached vehicle is used.</param>
    public AutopilotSectionSource(
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
    public async IAsyncEnumerable<RepositoryResult<AutopilotSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the three queries are disabled and hasAny is false → the empty surface.
            yield return RepositoryResult<AutopilotSnapshot>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:autopilot-section");

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => FetchMergedAsync(vid, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return AutopilotResultMapper.Map(emission);
        }
    }

    private async Task<JsonElement> FetchMergedAsync(long vid, CancellationToken cancellationToken)
    {
        // Primary read — the current vehicle state. A failure here propagates to the engine so the surface
        // shows error/offline, mirroring the dominant web query (useVehicleState).
        var stateBody = await _api
            .SendAsync<JsonElement>(StateRequest(vid), cancellationToken)
            .ConfigureAwait(false);

        // Supplementary cold-signal reads — independently fault-tolerant (web parity: three separate hooks).
        var cruiseBody = await TryObservationAsync(AutopilotSectionRegistration.CruiseSetField, vid, cancellationToken)
            .ConfigureAwait(false);
        var followBody = await TryObservationAsync(AutopilotSectionRegistration.FollowDistanceField, vid, cancellationToken)
            .ConfigureAwait(false);

        var merged = new Dictionary<string, JsonElement>(StringComparer.Ordinal)
        {
            [AutopilotSnapshot.StateKey] = stateBody.Clone(),
            [AutopilotSnapshot.CruiseSetKey] = cruiseBody,
            [AutopilotSnapshot.FollowKey] = followBody,
        };

        return JsonSerializer.SerializeToElement(merged, _json);
    }

    private async Task<JsonElement> TryObservationAsync(string field, long vid, CancellationToken cancellationToken)
    {
        try
        {
            var body = await _api
                .SendAsync<JsonElement>(ObservationRequest(field, vid), cancellationToken)
                .ConfigureAwait(false);
            return body.Clone();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Web parity: a failed (or empty) observation query just leaves that value absent — the panel still
            // renders whatever the other reads provided.
            return EmptyObservations;
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

    private static ApiRequest StateRequest(long vid) => ApiRequest.WithPath(
        Operations.Vehicles.State,
        VehiclePathParam,
        vid.ToString(CultureInfo.InvariantCulture));

    private static ApiRequest ObservationRequest(string field, long vid) => new(
        ObservationsOperation,
        Query: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = vid,
            [FieldQueryParam] = field,
            [LimitQueryParam] = AutopilotSectionRegistration.ObservationLimit,
        });

    // Web parity: when the merged body carries no speed and no observation value, hasAny is false → empty.
    private static bool IsEmptyResponse(JsonElement element) => !AutopilotSnapshot.FromJson(element).HasData;

    private static JsonElement ParseEmptyObservations()
    {
        using var doc = JsonDocument.Parse("""{"observations":[]}""");
        return doc.RootElement.Clone();
    }
}
