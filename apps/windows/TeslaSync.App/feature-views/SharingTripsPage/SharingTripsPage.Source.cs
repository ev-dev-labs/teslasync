using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Sharing;

/// <summary>
/// The repository-backed <see cref="ISharingTripsSource"/> — the native data adapter for the Trip Sharing
/// page's recent-trips list. It first resolves the in-scope vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web page's <c>useSelectedVehicle</c>), then
/// runs one cache-then-network read of the trip list (generated operation <c>get_api_v1_trips</c>) through the
/// shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, and parses each emission into <see cref="SharingTrip"/> rows via
/// <see cref="SharingTripsResultMapper"/>. Faithful to the web hook <c>useTrips({ vehicle_id, limit: 20 })</c>,
/// the query is <b>not</b> disabled when no vehicle is selected — it simply omits the <c>vehicle_id</c>
/// parameter and reads the fleet-wide list, while a resolved vehicle scopes the read to that vehicle. The
/// <c>limit</c> is always sent. No HTTP touches the view.
/// </summary>
public sealed class SharingTripsSource : ISharingTripsSource
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";

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
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle (if any) is used.</param>
    public SharingTripsSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SharingTrip>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);

        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [LimitQueryParam] = SharingTripsProjection.FetchLimit,
        };
        if (vehicleId is { } vid)
        {
            query[VehicleQueryParam] = vid;
        }

        string scope = vehicleId is { } id
            ? id.ToString(CultureInfo.InvariantCulture)
            : "all";
        string cacheKey = string.Create(
            CultureInfo.InvariantCulture,
            $"{SharingTripsRegistration.CacheKeyPrefix}:{scope}");

        var request = new ApiRequest(Operations.Trips.List, Query: query);

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SharingTripsResultMapper.Map(emission);
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

    // The trips endpoint returns an array; a null / non-array / empty body carries no shareable trips
    // (the recent-trips empty state), mirroring the web hook's safeArray default + empty-list gate.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SharingTrip&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can fold them into the loading / success / empty
/// states. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SharingTripsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The parsed emission with the same lifecycle status.</returns>
    public static RepositoryResult<IReadOnlyList<SharingTrip>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SharingTrip> Parse() =>
            raw.HasValue ? SharingTrip.ParseList(raw.Value) : Array.Empty<SharingTrip>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SharingTrip>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SharingTrip>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SharingTrip>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<SharingTrip>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SharingTrip>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SharingTrip>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SharingTrip>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The off-mode <see cref="IAiTripPostcardTransport"/> the page wires into the hosted trip-postcard drafter
/// when no AI backend is composed. Mirrors how the shell binds the empty data sources for default page
/// construction: with the AI feature gate closed (the ADR-015 "AI default off" contract, the native analogue
/// of the web <c>withAiFeature</c> HOC returning <c>null</c>), the drafter collapses to nothing and never
/// opens a stream, so this transport is never invoked. It yields no chunks. A host that composes a real AI
/// backend wires <see cref="HttpClientAiTripPostcardTransport"/> through
/// <see cref="AITripPostcardShareCardImageGeneration.Create"/> instead.
/// </summary>
public sealed class OffModeAiTripPostcardTransport : IAiTripPostcardTransport
{
    /// <summary>The shared singleton instance.</summary>
    public static OffModeAiTripPostcardTransport Instance { get; } = new();

    private OffModeAiTripPostcardTransport()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<string> OpenAsync(
        AiTripPostcardRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();
        await Task.CompletedTask.ConfigureAwait(false);
        yield break;
    }
}
