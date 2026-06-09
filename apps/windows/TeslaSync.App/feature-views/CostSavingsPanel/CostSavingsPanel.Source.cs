using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="CostSavingsPanelViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed drive-cost snapshots from <c>GET /drives/{driveID}</c> — the native
/// analogue of the web Drive-Detail page's <c>useDrive(id)</c> read whose <c>drive</c> + computed <c>stats</c>
/// the web <c>CostSavingsPanel</c> consumes as props. The view never performs HTTP itself; the concrete
/// <see cref="CostSavingsPanelSource"/> (or a test fake) drives this.
/// </summary>
public interface ICostSavingsPanelSource
{
    /// <summary>Stream the cache-then-network drive-cost snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<DriveCostSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ICostSavingsPanelSource"/> — the native data adapter for the
/// Cost-and-Savings panel. It runs one cache-then-network read of <c>GET /drives/{driveID}</c> (generated
/// operation <c>get_api_v1_drives_driveID</c>) for a single drive — mirroring the web hook
/// <c>useDrive(id)</c> — caching the raw JSON so the snake_case wire shape (including the embedded
/// <c>telemetry</c> array used by the energy fallback) round-trips losslessly, and parses each emission into a
/// <see cref="DriveCostSnapshot"/> via <see cref="CostSavingsResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class CostSavingsPanelSource : ICostSavingsPanelSource
{
    /// <summary>
    /// The generated drive-detail endpoint id (Generated/Api/ApiEndpoints.cs:
    /// <c>get_api_v1_drives_driveID → GET /drives/{driveID}/</c>). It is intentionally not surfaced as an
    /// <c>Operations.*</c> constant, so the canonical operation id is pinned here.
    /// </summary>
    public const string DriveDetailOperation = "get_api_v1_drives_driveID";

    private const string DriveIdPathParam = "driveID";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly ApiRequest _request;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine, JSON settings and drive id.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="driveId">The drive whose cost breakdown to read (web route <c>driveID</c>).</param>
    public CostSavingsPanelSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long driveId)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;

        string id = driveId.ToString(CultureInfo.InvariantCulture);
        _request = ApiRequest.WithPath(DriveDetailOperation, DriveIdPathParam, id);
        _cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:{driveId}:cost-savings");
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<DriveCostSnapshot>> StreamAsync(
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
            yield return CostSavingsResultMapper.Map(emission);
        }
    }

    // The drive endpoint returns a JSON object; a null body or an empty object carries no drive to price.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
