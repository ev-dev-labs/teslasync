using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for drive history, detail, telemetry and stats.</summary>
public interface IDriveRepository
{
    /// <summary>The drive list, optionally scoped to one vehicle.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.Drive>>> ListAsync(long? vehicleId = null, CancellationToken cancellationToken = default);

    /// <summary>A single drive's detail.</summary>
    IAsyncEnumerable<RepositoryResult<GeneratedApi.Drive>> GetAsync(long driveId, CancellationToken cancellationToken = default);

    /// <summary>A drive's telemetry samples.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.DriveTelemetryReading>>> GetTelemetryAsync(long driveId, CancellationToken cancellationToken = default);

    /// <summary>A drive's GPS positions.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetPositionsAsync(long driveId, CancellationToken cancellationToken = default);

    /// <summary>Aggregate driving statistics.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetStatsAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IDriveRepository"/>.</summary>
public sealed class DriveRepository : RepositoryBase, IDriveRepository
{
    /// <summary>Creates the repository.</summary>
    public DriveRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.Drive>>> ListAsync(long? vehicleId = null, CancellationToken cancellationToken = default)
    {
        var request = vehicleId is { } id
            ? ApiRequest.WithQuery(Operations.Drives.List, "vehicle_id", id)
            : new ApiRequest(Operations.Drives.List);
        var key = vehicleId is { } v ? $"drives:list:{v}" : "drives:list";
        return Stream<IReadOnlyList<GeneratedApi.Drive>>(key, request, cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<GeneratedApi.Drive>> GetAsync(long driveId, CancellationToken cancellationToken = default) =>
        Stream<GeneratedApi.Drive>(
            $"drives:{driveId}:detail",
            ApiRequest.WithPath(Operations.Drives.Detail, "driveID", Id(driveId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.DriveTelemetryReading>>> GetTelemetryAsync(long driveId, CancellationToken cancellationToken = default) =>
        Stream<IReadOnlyList<GeneratedApi.DriveTelemetryReading>>(
            $"drives:{driveId}:telemetry",
            ApiRequest.WithPath(Operations.Drives.Telemetry, "driveID", Id(driveId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetPositionsAsync(long driveId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"drives:{driveId}:positions",
            ApiRequest.WithPath(Operations.Drives.Positions, "driveID", Id(driveId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetStatsAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            "drives:stats",
            new ApiRequest(Operations.Drives.Stats),
            cancellationToken: cancellationToken);
}
