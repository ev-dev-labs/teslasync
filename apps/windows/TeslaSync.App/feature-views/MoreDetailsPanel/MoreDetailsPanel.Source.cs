using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="MoreDetailsPanelViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed <see cref="MoreDetailsSnapshot"/> values for a single drive —
/// the native analogue of the web per-drive query (<c>useDrive</c> feeding <c>useDriveDetailData</c>) whose
/// resolved <c>drive</c> + computed <c>stats</c> the web <c>MoreDetailsPanel</c> receives as props. The view
/// never performs HTTP itself; the concrete <see cref="MoreDetailsPanelSource"/> (or a test fake) drives this.
/// </summary>
public interface IMoreDetailsPanelSource
{
    /// <summary>Stream the cache-then-network drive snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<MoreDetailsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IMoreDetailsPanelSource"/> — the native data adapter for the More Details
/// surface. It runs one cache-then-network read of <c>GET /drives/{driveID}</c> (generated operation
/// <see cref="Operations.Drives.Detail"/>) for the drive the surface was opened for, caching the raw JSON so
/// the snake_case wire shape (the Drive aggregate plus its embedded <c>telemetry[]</c> / <c>positions[]</c>)
/// round-trips losslessly, and parses each emission into a <see cref="MoreDetailsSnapshot"/> via
/// <see cref="MoreDetailsPanelResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class MoreDetailsPanelSource : IMoreDetailsPanelSource
{
    /// <summary>The path-parameter name the drive-detail route binds (<c>/drives/{driveID}</c>).</summary>
    public const string DriveIdParam = "driveID";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly string _driveId;
    private readonly string _cacheKey;
    private readonly ApiRequest _request;

    /// <summary>Creates the source over the contract client, cache-then-network engine, settings and drive id.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The API client options (provides JSON settings).</param>
    /// <param name="driveId">The drive whose detail this surface reads (web route param).</param>
    public MoreDetailsPanelSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, string driveId)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentException.ThrowIfNullOrWhiteSpace(driveId);

        _api = api;
        _engine = engine;
        _json = options.Json;
        _driveId = driveId;
        _cacheKey = $"drives:detail:more-details:{driveId}";
        _request = ApiRequest.WithPath(Operations.Drives.Detail, DriveIdParam, driveId);
    }

    /// <summary>The drive id this source reads.</summary>
    public string DriveId => _driveId;

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<MoreDetailsSnapshot>> StreamAsync(
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
            yield return MoreDetailsPanelResultMapper.Map(emission);
        }
    }

    // A null / non-object body carries no drive; a populated drive object that merely lacks telemetry is NOT
    // empty here — it is parsed and the empty state is derived downstream from the snapshot's HasData gate
    // (web's hasMeaningfulDriveStats), exactly mirroring the parent page.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
