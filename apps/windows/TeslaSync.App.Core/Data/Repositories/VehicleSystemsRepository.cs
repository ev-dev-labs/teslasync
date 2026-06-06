using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for vehicle subsystem snapshots (media, guard, specs, options).</summary>
public interface IVehicleSystemsRepository
{
    /// <summary>The latest media/now-playing snapshot.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetMediaLatestAsync(CancellationToken cancellationToken = default);

    /// <summary>A vehicle's sentry/guard state.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetGuardAsync(long vehicleId, CancellationToken cancellationToken = default);

    /// <summary>A vehicle's hardware specifications.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetSpecsAsync(long vehicleId, CancellationToken cancellationToken = default);

    /// <summary>A vehicle's option codes / configuration.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetOptionsAsync(long vehicleId, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IVehicleSystemsRepository"/>.</summary>
public sealed class VehicleSystemsRepository : RepositoryBase, IVehicleSystemsRepository
{
    /// <summary>Creates the repository.</summary>
    public VehicleSystemsRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetMediaLatestAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>("systems:media:latest", new ApiRequest(Operations.VehicleSystems.MediaLatest), cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetGuardAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"systems:{vehicleId}:guard",
            ApiRequest.WithPath(Operations.Vehicles.Guard, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetSpecsAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"systems:{vehicleId}:specs",
            ApiRequest.WithPath(Operations.Vehicles.Specs, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetOptionsAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"systems:{vehicleId}:options",
            ApiRequest.WithPath(Operations.Vehicles.Options, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);
}
