using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Data.Repositories;

/// <summary>Cache-then-network reads for charging sessions and their telemetry.</summary>
public interface IChargingRepository
{
    /// <summary>The charging-session list, optionally scoped to one vehicle.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.ChargingSession>>> ListSessionsAsync(long? vehicleId = null, CancellationToken cancellationToken = default);

    /// <summary>A single charging session's detail.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetSessionAsync(long sessionId, CancellationToken cancellationToken = default);

    /// <summary>A charging session's telemetry samples.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.ChargeTelemetryReading>>> GetTelemetryAsync(long sessionId, CancellationToken cancellationToken = default);

    /// <summary>The latest charging telemetry snapshot.</summary>
    IAsyncEnumerable<RepositoryResult<JsonElement>> GetLatestTelemetryAsync(CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IChargingRepository"/>.</summary>
public sealed class ChargingRepository : RepositoryBase, IChargingRepository
{
    /// <summary>Creates the repository.</summary>
    public ChargingRepository(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
        : base(api, engine, options)
    {
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.ChargingSession>>> ListSessionsAsync(long? vehicleId = null, CancellationToken cancellationToken = default)
    {
        var request = vehicleId is { } id
            ? ApiRequest.WithQuery(Operations.Charging.Sessions, "vehicle_id", id)
            : new ApiRequest(Operations.Charging.Sessions);
        var key = vehicleId is { } v ? $"charging:sessions:{v}" : "charging:sessions";
        return Stream<IReadOnlyList<GeneratedApi.ChargingSession>>(key, request, cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetSessionAsync(long sessionId, CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            $"charging:{sessionId}:detail",
            ApiRequest.WithPath(Operations.Charging.SessionDetail, "sessionID", Id(sessionId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeneratedApi.ChargeTelemetryReading>>> GetTelemetryAsync(long sessionId, CancellationToken cancellationToken = default) =>
        Stream<IReadOnlyList<GeneratedApi.ChargeTelemetryReading>>(
            $"charging:{sessionId}:telemetry",
            ApiRequest.WithPath(Operations.Charging.SessionTelemetry, "sessionID", Id(sessionId)),
            cancellationToken: cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<JsonElement>> GetLatestTelemetryAsync(CancellationToken cancellationToken = default) =>
        Stream<JsonElement>(
            "charging:telemetry:latest",
            new ApiRequest(Operations.Charging.TelemetryLatest),
            cancellationToken: cancellationToken);
}
