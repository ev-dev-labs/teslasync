using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The data port the <see cref="DriveDetailPageViewModel"/> reads through — the native parity of the web page's
/// two hooks (web/src/features/driving/components/drive-detail/useDriveDetailData.ts): <c>useDrive</c> (the
/// required <c>GET /drives/{id}</c> read) and <c>useVehicle</c> (<c>GET /vehicles/{id}</c>). The view never
/// performs HTTP itself; the default <see cref="EmptyDriveDetailPageFeed"/> resolves to the empty state and the
/// generated-client-backed <see cref="DriveDetailPageClientFeed"/> binds the OpenAPI contract client (ADR-004). A
/// failing primary read throws so the view-model can surface the never-blank error branch.
/// </summary>
public interface IDriveDetailPageFeed
{
    /// <summary>Resolve the two-source snapshot for a drive id (web's <c>useDrive</c> + <c>useVehicle</c> fused).</summary>
    Task<DriveDetailSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to the empty snapshot (the loading/empty state the shell shows by default).</summary>
public sealed class EmptyDriveDetailPageFeed : IDriveDetailPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDriveDetailPageFeed Instance { get; } = new();

    private EmptyDriveDetailPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<DriveDetailSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(DriveDetailSnapshot.Empty);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IDriveDetailPageFeed"/> — the native data adapter for the Drive-detail
/// page (ADR-004). It binds to the generated OpenAPI contract client for the two reads the web page performs. The
/// drive read (<see cref="DriveDetailPageRegistration.DriveOperation"/>) is the primary query whose failure
/// surfaces the page error; the vehicle read is a best-effort supplementary query (mirroring the web's separate
/// <c>useVehicle</c> query) that degrades to null on a transport failure so the header falls back to the generic
/// "Vehicle" label instead of sinking the whole page. Every response round-trips through the tolerant
/// <see cref="DriveData"/> / <see cref="DriveVehicleData"/> parsers so the snake_case wire shape is preserved
/// losslessly; no HTTP touches the view.
/// </summary>
public sealed class DriveDetailPageClientFeed : IDriveDetailPageFeed
{
    private const string DriveIdParam = "driveID";
    private const string VehicleIdParam = "vehicleID";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public DriveDetailPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<DriveDetailSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken)
    {
        var driveRequest = ApiRequest.WithPath(
            DriveDetailPageRegistration.DriveOperation,
            DriveIdParam,
            driveId.ToString(CultureInfo.InvariantCulture));
        var driveJson = await _api.SendAsync<JsonElement>(driveRequest, cancellationToken).ConfigureAwait(false);
        DriveData? drive = DriveData.FromJson(driveJson);

        DriveVehicleData? vehicle = drive is { } d
            ? await FetchVehicleAsync(d.VehicleId, cancellationToken).ConfigureAwait(false)
            : null;

        return new DriveDetailSnapshot(drive, vehicle);
    }

    private async Task<DriveVehicleData?> FetchVehicleAsync(long vehicleId, CancellationToken cancellationToken)
    {
        if (vehicleId <= 0)
        {
            return null;
        }

        try
        {
            var request = ApiRequest.WithPath(
                DriveDetailPageRegistration.VehicleOperation,
                VehicleIdParam,
                vehicleId.ToString(CultureInfo.InvariantCulture));
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return DriveVehicleData.FromJson(json);
        }
        catch (ApiException)
        {
            // Best-effort, like the web's separate vehicle query — a transport failure leaves the header on its
            // generic "Vehicle" label instead of sinking the whole page.
            return null;
        }
    }
}
