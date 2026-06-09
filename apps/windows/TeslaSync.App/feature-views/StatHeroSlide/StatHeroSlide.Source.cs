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
/// The repository-backed <see cref="IStatHeroSlideSource"/> — the native data adapter for the StatHeroSlide
/// surface. It resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the native
/// analogue of the web year-in-review page's <c>vehicleId</c>, whose <c>useYearReview</c> query is
/// <c>enabled: !!vehicleId</c>), then runs one cache-then-network read of
/// <c>GET /analytics/year-review?vehicle_id={id}&amp;year={year}</c> (generated operation
/// <c>get_api_v1_analytics_year_review</c>), caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, and parses each emission into a <see cref="YearReviewTotals"/> via
/// <see cref="StatHeroResultMapper"/>. When no vehicle is cached the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web disabled query. No HTTP touches the view.
/// </summary>
public sealed class StatHeroSlideSource : IStatHeroSlideSource
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string YearQueryParam = "year";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;
    private readonly int _year;

    /// <summary>Creates the source over the vehicle source, contract client, engine, JSON settings and window.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="year">The calendar year; when null the current year is used (web default).</param>
    /// <param name="clock">An optional clock used to derive the default year, for deterministic tests.</param>
    public StatHeroSlideSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null,
        int? year = null,
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
        _year = year ?? StatHeroSlideRegistration.CurrentYear(clock);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<YearReviewTotals>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useYearReview query is disabled and the slide shows nothing.
            yield return RepositoryResult<YearReviewTotals>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"analytics:year-review:{vid}:{_year}");
        var request = new ApiRequest(
            StatHeroSlideRegistration.YearReviewOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
                [YearQueryParam] = _year,
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
            yield return StatHeroResultMapper.Map(emission);
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
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
