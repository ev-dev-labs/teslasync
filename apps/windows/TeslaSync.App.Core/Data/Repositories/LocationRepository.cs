using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for saved locations and geofences.</summary>
public interface ILocationRepository
{
    /// <summary>Saved/known locations.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetLocationsAsync(CancellationToken cancellationToken = default);

    /// <summary>The geofence list.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetGeofencesAsync(CancellationToken cancellationToken = default);

    /// <summary>A single geofence's detail.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetGeofenceAsync(long geofenceId, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="ILocationRepository"/>.</summary>
public sealed class LocationRepository : RepositoryBase, ILocationRepository
{
    /// <summary>Creates the repository.</summary>
    public LocationRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetLocationsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("locations:list", new ApiRequest(Operations.Locations.List), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetGeofencesAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("geofences:list", new ApiRequest(Operations.Locations.Geofences), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetGeofenceAsync(long geofenceId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"geofences:{geofenceId}",
            ApiRequest.WithPath(Operations.Locations.GeofenceDetail, "geofenceID", Id(geofenceId)),
            cancellationToken: cancellationToken);
}
