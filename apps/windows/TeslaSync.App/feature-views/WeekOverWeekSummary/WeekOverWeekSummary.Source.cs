using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="WeekOverWeekSummaryViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed weekly-digest snapshots from
/// <c>GET /vehicles/{vehicleID}/weekly-digest</c> — the native analogue of the Weekly Digest analytics page's
/// <c>useWeeklyDigest</c> read whose <c>metrics</c> the web <c>WeekOverWeekSummary</c> consumes as a prop. The
/// view never performs HTTP itself; the concrete <see cref="WeekOverWeekSummarySource"/> (or a test fake)
/// drives this.
/// </summary>
public interface IWeekOverWeekSummarySource
{
    /// <summary>Stream the cache-then-network weekly-digest snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<WeekOverWeekMetrics>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IWeekOverWeekSummarySource"/> — the native data adapter for the
/// Week-over-Week Comparison surface. It runs one cache-then-network read of
/// <c>GET /vehicles/{vehicleID}/weekly-digest</c> (generated operation
/// <see cref="WeeklyDigestOperation"/>) for the supplied vehicle — the native analogue of the web page's
/// <c>useWeeklyDigest</c> read that resolves the selected (or first) vehicle — caching the raw JSON so the
/// snake_case wire shape round-trips losslessly, and parses each emission into a
/// <see cref="WeekOverWeekMetrics"/> via <see cref="WeekOverWeekResultMapper"/>. When no vehicle is supplied
/// the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query
/// (<c>enabled: !!selectedVehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class WeekOverWeekSummarySource : IWeekOverWeekSummarySource
{
    /// <summary>
    /// The generated weekly-digest endpoint id (Generated/Api/ApiEndpoints.cs:
    /// <c>get_api_v1_vehicles_vehicleID_weekly_digest → GET /vehicles/{vehicleID}/weekly-digest</c>). The
    /// request() client auto-adds the /api/v1 prefix.
    /// </summary>
    public const string WeeklyDigestOperation = "get_api_v1_vehicles_vehicleID_weekly_digest";

    private const string VehiclePathParam = "vehicleID";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the contract client, cache-then-network engine, JSON settings and vehicle.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">The vehicle to scope the digest to; when null the read streams empty.</param>
    public WeekOverWeekSummarySource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
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
    public async IAsyncEnumerable<RepositoryResult<WeekOverWeekMetrics>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        if (_vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useWeeklyDigest query is disabled and `metrics` is absent.
            yield return RepositoryResult<WeekOverWeekMetrics>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:weekly-digest");
        var request = new ApiRequest(
            WeeklyDigestOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
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
            yield return WeekOverWeekResultMapper.Map(emission);
        }
    }

    // Web parity: a non-object body (metrics falsy) collapses to the "No data" empty surface.
    private static bool IsEmptyResponse(JsonElement element) => WeekOverWeekMetrics.FromResponse(element) is null;
}
