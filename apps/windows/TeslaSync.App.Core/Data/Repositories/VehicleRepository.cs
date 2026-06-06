using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for the vehicle list, detail, live state and subsystems.</summary>
public interface IVehicleRepository
{
    /// <summary>The enrolled vehicle list.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.Vehicle>>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>A single vehicle's detail.</summary>
    IAsyncEnumerable<RepositoryResult<GeneratedApi.Vehicle>> GetAsync(long vehicleId, CancellationToken cancellationToken = default);

    /// <summary>A vehicle's live state (subject to the two-minute live-state contract).</summary>
    IAsyncEnumerable<RepositoryResult<GeneratedApi.VehicleState>> GetStateAsync(long vehicleId, CancellationToken cancellationToken = default);

    /// <summary>A vehicle's battery summary.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetBatteryAsync(long vehicleId, CancellationToken cancellationToken = default);

    /// <summary>A vehicle's energy summary.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetEnergyAsync(long vehicleId, CancellationToken cancellationToken = default);

    /// <summary>A vehicle's recent positions.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetPositionsAsync(long vehicleId, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IVehicleRepository"/> over the generated client + SQLite cache.</summary>
public sealed class VehicleRepository : RepositoryBase, IVehicleRepository
{
    /// <summary>Creates the repository.</summary>
    public VehicleRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.Vehicle>>> ListAsync(CancellationToken cancellationToken = default) =>
        Stream<IReadOnlyList<GeneratedApi.Vehicle>>(
            "vehicles:list",
            new ApiRequest(Operations.Vehicles.List),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<GeneratedApi.Vehicle>> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<GeneratedApi.Vehicle>(
            $"vehicles:{vehicleId}:detail",
            ApiRequest.WithPath(Operations.Vehicles.Detail, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<GeneratedApi.VehicleState>> GetStateAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<GeneratedApi.VehicleState>(
            $"vehicles:{vehicleId}:state",
            ApiRequest.WithPath(Operations.Vehicles.State, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetBatteryAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"vehicles:{vehicleId}:battery",
            ApiRequest.WithPath(Operations.Vehicles.Battery, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetEnergyAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"vehicles:{vehicleId}:energy",
            ApiRequest.WithPath(Operations.Vehicles.Energy, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetPositionsAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"vehicles:{vehicleId}:positions",
            ApiRequest.WithPath(Operations.Vehicles.Positions, "vehicleID", Id(vehicleId)),
            cancellationToken: cancellationToken);
}
