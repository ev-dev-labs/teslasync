using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The repository-backed <see cref="IHeroGaugesSource"/> — the native data adapter for the drive-detail Hero
/// Gauges surface. It runs one cache-then-network read of <c>GET /drives/{driveID}</c> (generated operation
/// <c>get_api_v1_drives_driveID</c>) for a single drive — the native analogue of the web drive-detail page's
/// <c>useDrive(id)</c> query — caching the raw JSON so the snake_case wire shape (including the embedded
/// <c>telemetry</c> array the consumption fallback reads) round-trips losslessly, and projects each emission's
/// drive body into a <see cref="DriveGauges"/> via <see cref="HeroGaugesResultMapper"/>. No HTTP touches the
/// view.
/// </summary>
public sealed class HeroGaugesSource : IHeroGaugesSource
{
    private const string CacheKeyPrefix = "drives:detail:hero-gauges";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly ApiRequest _request;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine, JSON settings and drive.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="driveId">The drive whose gauges to read (web <c>driveID</c> route parameter).</param>
    public HeroGaugesSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long driveId)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;

        _request = ApiRequest.WithPath(
            Operations.Drives.Detail,
            "driveID",
            driveId.ToString(CultureInfo.InvariantCulture));
        _cacheKey = string.Format(CultureInfo.InvariantCulture, "{0}:{1}", CacheKeyPrefix, driveId);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<DriveGauges>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            _cacheKey,
            ct => _api.SendAsync<JsonElement>(_request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return HeroGaugesResultMapper.Map(emission);
        }
    }

    // The drive-detail endpoint returns a single JSON object; a null body or a property-less object carries no
    // drive to summarize (the web page renders nothing until the drive resolves). Any non-object body is also
    // treated as no-drive so the view-model surfaces the empty state rather than zeroed gauges.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => true,
    };
}
