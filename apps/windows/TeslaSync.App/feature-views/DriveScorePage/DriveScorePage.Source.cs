using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The two-source data port the <see cref="DriveScorePageViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields one combined <see cref="DriveScoreSnapshot"/> — the parsed drive list (web <c>useDrives</c>) plus the
/// optional server score (web <c>useDriveScore</c>). The view never performs HTTP itself; the concrete
/// <see cref="DriveScoreClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface IDriveScoreFeed
{
    /// <summary>Fetch the combined drives + score snapshot for the active vehicle.</summary>
    Task<DriveScoreSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The empty <see cref="IDriveScoreFeed"/> — the default with no selected vehicle (web disabled query). Always
/// yields <see cref="DriveScoreSnapshot.Empty"/> so the page renders its friendly empty surface without HTTP.
/// </summary>
public sealed class EmptyDriveScoreFeed : IDriveScoreFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDriveScoreFeed Instance { get; } = new();

    private EmptyDriveScoreFeed()
    {
    }

    /// <inheritdoc />
    public Task<DriveScoreSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(DriveScoreSnapshot.Empty);
}

/// <summary>
/// The generated-client-backed <see cref="IDriveScoreFeed"/> — the native data adapter for the Drive Score page
/// (ADR-004). It binds to the generated OpenAPI contract client for the two reads the web page performs, both
/// scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /drives</c> (<see cref="DriveScoreRegistration.DrivesOperation"/>, web <c>useDrives</c>) is the
/// primary read whose failure surfaces the page error, and <c>GET /drives/score</c>
/// (<see cref="DriveScoreRegistration.ScoreOperation"/>, web <c>useDriveScore</c>) is the best-effort
/// supplementary read whose failure degrades silently to the client-computed averages (web <c>retry:false</c>).
/// The raw JSON round-trips through the tolerant parsers so the snake_case wire shape is preserved losslessly;
/// no HTTP touches the view.
/// </summary>
public sealed class DriveScoreClientFeed : IDriveScoreFeed
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public DriveScoreClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<DriveScoreSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var drivesRequest = new ApiRequest(DriveScoreRegistration.DrivesOperation, Query: VehicleQuery());
        var drivesJson = await _api.SendAsync<JsonElement>(drivesRequest, cancellationToken).ConfigureAwait(false);
        IReadOnlyList<DriveSample> drives = DriveScoreJson.ParseDrives(drivesJson);

        ApiDriveScore? score = await FetchScoreAsync(cancellationToken).ConfigureAwait(false);
        return DriveScoreSnapshot.Compose(drives, score);
    }

    private async Task<ApiDriveScore?> FetchScoreAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(DriveScoreRegistration.ScoreOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ApiDriveScore.FromJson(json);
        }
        catch (ApiException)
        {
            // The score read is the web's separate best-effort query (retry:false) — a transport failure here
            // must never sink the page, so every panel falls back to the client-computed averages.
            return null;
        }
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
