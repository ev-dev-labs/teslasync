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
/// The data port the <see cref="MediaHistoryViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed media-history lists for the primary (or explicit) vehicle —
/// the native analogue of the web <c>useVehicles</c> + <c>useMediaHistory</c> hook composition
/// (web/src/features/dashboard/widgets/MediaHistoryWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="MediaHistorySource"/> (or a test fake) drives this.
/// </summary>
public interface IMediaHistorySource
{
    /// <summary>Stream the cache-then-network media-history snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<MediaHistorySample>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IMediaHistorySource"/> — the native data adapter for the Media
/// History surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then runs one
/// cache-then-network read of the media change feed (generated operation <c>get_api_v1_media</c> —
/// <c>GET /api/v1/media?vehicle_id={id}</c>, the web <c>useMediaHistory</c> query) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, and parses each emission into <see cref="MediaHistorySample"/> rows via
/// <see cref="MediaHistoryResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query (<c>enabled: !!vehicleId</c>).
/// No HTTP touches the view.
/// </summary>
public sealed class MediaHistorySource : IMediaHistorySource
{
    // GET /api/v1/media (the media playback-history change feed). The generated endpoint declares no
    // query parameters, so the engine passes vehicle_id through verbatim — the backend's List handler
    // requires it.
    private const string MediaHistoryOperation = "get_api_v1_media";
    private const string VehicleQueryParam = "vehicle_id";

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
    public MediaHistorySource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MediaHistorySample>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useMediaHistory query is disabled and `data` is undefined.
            yield return RepositoryResult<IReadOnlyList<MediaHistorySample>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"media:{vid}:history");
        var request = new ApiRequest(
            MediaHistoryOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
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
            yield return MediaHistoryResultMapper.Map(emission);
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

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
